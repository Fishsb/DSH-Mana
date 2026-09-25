# Mana v6.3：LLM 与 JEV 接入点细化方案（**实况订正版**）

> 版本：v6.3-实况（按仓库 HEAD 实测订正；原文骨架保留，内容逐条改写）
> 核心原则：JEV 做判断，LLM 做生成，插件做控制
> 订正基准：`acdcabe` · 13 包 · 2026-09-25 实测
> **本文件的读法**：章节与表格骨架沿用参考文档，表内每一项的「类型 / 内容」按本仓**实际代码与实测读数**改写。
> 凡本仓尚未实现者，如实写「未实现」并给出协议层是否支持，**不以设计意图冒充现状**。

---

## 一、JEV 批量调用设计

### 1.1 并行问题评估

**原文前提不成立，已订正**：参考文档写「JEV 在一次请求中并行评估所有问题，发送 50 个问题和发送 1 个问题耗时相近」。
本仓实测（`qwen3.5:0.8b`、`think:false`、`temperature:0`）为 **50 问单次 `1046–1228ms`**，而 50 个并发单问 = `7599ms`
⇒ 批量**不是"耗时相近"，而是"省往返"**（约 6×）。且**本仓当前未实现任何批量路径**：
`framework.ts` 的 `judgeSeries()` 是**显式串行**（注释原文「同一时刻只让一个在飞」），
`judgeWithGuard()` 每次调用 = 1 次 HTTP 往返。下表为参考文档的设想场景与本仓落点现状：

| 场景 | 批量方式 | 问题数 | 本仓现状 |
|---|---|---|---|
| Write Gate | worth_keeping + supersedes | 2 | **未实现**（无该 prompt、无调用点；`jev_log` 仅有 `result_value/probability` 单值面） |
| Recall Gate | rel_<id> 对 Top-50 | 50 | **未实现**；且 Top-50 fan-out 已实测不可达（见下） |
| 注意力门控 | relevant_<id> | N | **未实现**；`attention.jevThreshold=0.7` 已就位但**无判定链消费它** |
| 遗忘扫描 | decay_priority_<id> | N | **未实现**（`forgetting` 为 74 行骨架，无行为） |
| 工具路由 | tool_choice + urgency + safety | 3 | **未实现**（全仓无 `tool_choice`/`urgency` 命中） |

> ⚠ **Top-50 fan-out 的实测更正**：50 个**并发单问**实测 `wall=7599ms / p50=5756ms`，而方案 §13.2 目标是 `<500ms`。
> 更正结论：真因不是"50 个判断太贵"而是**"50 次 HTTP 往返"贵**（单次带 50 问仅 `1046–1228ms`）；
> 但**即便合并为单次往返，`<500ms` 在 50 问规模下仍不可达**。
> ⇒ 本仓口径 = **「少往返 + 分批 + 预算」**，而非「早停以省判定次数」。

### 1.2 批量调用实现

**参考文档的写法不可用（三处硬冲突），本仓真实形态如下**：

| # | 参考文档原文 | 本仓实际 | 冲突性质 |
|---|---|---|---|
| ① | `https://openrouter.ai/api/v1/systemone` | `https://nano-gpt.com/api/v1/systemone` | 端点不同（OpenRouter **全仓 0 命中**） |
| ② | `ctx.credentials.get('openrouter')` | **无 `ctx.credentials` 调用点**；key 只从环境变量 `NANOGPT_API_KEY` 读，判据面另有 `~/jev/.env` 只读回退 | 凭据面不存在：本仓**配置里只存变量名，不存 key** |
| ③ | `{ model, state, questions }` 一次多问 | 请求体**逐字相同**（`buildSystemoneBody`）✅，但**默认通道不是它** | 缺省通道 = `ollama`，真通道须**显式** `channel:'systemone'` |

本仓**真实**的两条通道（各自单一出口，都是 1 次 HTTP 往返；批量合并**尚未实现**）：

```typescript
// packages/jev/src/index.ts —— 通道是可换的**驱动**，护栏只有一套
const ollamaDriver = (o: JudgeOptions): Promise<JevJudgeOutcome> =>
  judgeWithOllama({
    ...o,
    endpoint: o.endpoint ?? OLLAMA_DEFAULT_ENDPOINT,   // http://127.0.0.1:11434
    model: o.model ?? JEV_DEFAULT_MODEL,               // qwen3.5:0.8b
  })

const systemoneDriver = (o: JudgeOptions): Promise<JevJudgeOutcome> =>
  judgeWithSystemone({
    ...(o as SystemoneJudgeOptions),
    endpoint: o.endpoint ?? SYSTEMONE_DEFAULT_ENDPOINT, // https://nano-gpt.com
    model: o.model ?? SYSTEMONE_DEFAULT_MODEL,          // jev-1.13
    path: (o as SystemoneJudgeOptions).path ?? SYSTEMONE_DEFAULT_PATH,        // /api/v1/systemone
    primaryQuestion: (o as SystemoneJudgeOptions).primaryQuestion ?? SYSTEMONE_DEFAULT_PRIMARY, // 'v'
  })

// 护栏与通道**分离**：judgeGuarded 按 config.channel 选驱动
judgeGuarded: (options) =>
  judgeWithGuard({
    ...options,
    guard,
    judgeFn: options.judgeFn ?? (config.channel === 'systemone' ? systemoneDriver : ollamaDriver),
    // …
  }),
```

**护栏六项配置（B1.3）—— 全部真被 `apply()` 消费**（原先末行是 `void config`）：

| 配置键 | 缺省值 | 语义 |
|---|---|---|
| `cacheTtlSeconds` | 300 | 判定缓存 TTL（键 = `state_hash` + `\u0000` + question） |
| `circuitBreakerFailures` | 5 | 连续失败达此值 ⇒ 熔断打开 |
| `circuitBreakerCooldownSeconds` | 60 | 冷却到点后进入 half-open，且**只放行一个试探** |
| `maxConcurrency` | 4 | 全局同时在飞上限（并发是硬约束，非偏好） |
| `sessionBudget` | 200 | 每 session 判定**次数**上限（含缓存命中与拒绝） |
| `concurrencyWaitTimeoutMs` | 30000 | 等槽位超时；`<=0` = 永久等待（不加超时会让满载**无声挂起**） |

> ⚠ **准入顺序本身就是语义**（判据逐条钉住）：`预算 → 缓存 → 熔断 → 半开探针 → 并发槽 → 模型`。
> 缓存命中**不受熔断阻断**（代价 0 次 fetch，服务于"熔断开时仍可给上一次的好答案"）。
> 缓存命中 / 熔断拒绝 / 超预算 / 并发超时 / 模型降级**五条非正常路径都会落一行 `jev_log`**，
> 由 `makeJevOutcome()` **唯一出口**结构性保证 —— 不存在"什么都没发生"的静默分支。

---

## 二、完整 Prompt 模板库

> **本节的实况总述**：参考文档列出的 21 个 Prompt **在本仓一个都不存在**。
> 逐条核实方式：`grep -rn 'worth_keeping|decay_priority|relevant_|rel_|tool_choice|urgency' packages/*/src`
> ⇒ **全仓唯一命中**是 `schema.ts` 的两个列名 `jev_relevance` / `jev_worth_keeping`（**列在，写者不在**）。
> 协议层支持的是**三种问题类型**（`noul` / `choice` / `score`，实测合法集，未知 type ⇒ 400 `invalid_question_type`），
> 而非某一批固定 Prompt。故下表保留原「Prompt | 类型 | 内容」三列，**「内容」列改写为实况**。

### 2.1 编码链条

| Prompt | 类型 | 内容 |
|---|---|---|
| Write Gate | Noul | **未实现**。协议支持 `noul`（服务端直给 0..1）；本仓无该 prompt 文本、无调用点 |
| Supersedes | Choice | **未实现**。协议支持 `choice`（取值 = `criteria` 的键） |
| 情绪效价 | Score | **未实现**。`memory_items.emotional_valence` **列已建**，无写者 |
| 情绪唤醒 | Score | **未实现**。`memory_items.emotional_arousal` **列已建**，无写者。⚠ `score.criteria` 必须是**数组**（对象会 400） |

### 2.2 巩固链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 巩固触发 | Noul | **未实现**（`consolidation` = 74 行骨架，`behavior:'skeleton'`） |
| Chunking 效用 | Score | **未实现**（同包） |
| 深度睡眠归纳 | LLM | **未实现**（本仓无 LLM 生成调用点） |

### 2.3 检索链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 意图识别 | LLM | **未实现**（无 LLM 生成调用点；`ctx.llm` 仅被用于构造注入消息） |
| Recall Gate | Noul | **未实现**。检索路已通但**不含 JEV 判定**：`recallVector()` 走 词法 → 向量 → 余弦 → RRF，排序依据是 `'rrf'` 或降级时的 `'local_score'` |
| Injection Gate | Noul | **部分落地**：门控与留痕**已实现**（五类枚举 gate + 每次 pre-step 必留痕），但**判定源不是 JEV** —— 当前依据「候选池是否为空 + 开关」，故 `jevProb` 恒落 `null`（**不得用 0 冒充**） |

### 2.4 再巩固链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 更新判断 | Noul | **未实现** |

### 2.5 遗忘链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 活性分级 | Choice | **未实现**（`forgetting` = 74 行骨架） |
| 压缩摘要 | LLM | **未实现** |

### 2.6 学习链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 原则提炼 | LLM | **未实现** |
| 路径归纳 | LLM | **未实现** |
| 原则有效性 | Noul | **未实现** |
| FSRS 难度 | Score | **未实现** |

### 2.7 调度链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 不熟悉检测 | Noul | **未实现** |
| 工具路由 | Choice | **未实现** |
| 安全守门 | Noul | **未实现** |

> **本仓已存在的"判据注册表"与本节的关系（避免误认）**：`packages/metacognition/skill/engine/criteria.json`
> 是 **shoucang 判据注册表**的移植（`version v2.2.0`，含 `ingest`/`consolidate` 等域的 `judgeText`），
> 由 `scripts/gen-criteria.mjs` 生成、`src/criteria.generated.ts` 投影、`src/criteria.ts` 唯一读口。
> 它是**归属/阈值判据**，**不是**本节的 LLM Prompt 模板库，两者不可互相冒充。

---

## 三、DSH 插件实现

**实况**：本仓 **13 个插件包**（参考文档只画了 3 个），全部 `lib/index.js` 入口、全部已建软链、全部可按包名解析。

| 包 id | 插件 `name` | 服务名 | 源码行 | `lib/` | 测试文件 | 状态 |
|---|---|---|---|---|---|---|
| `dsh-mana-core` | `mana-core` | `mana-core` | 1452 | ✅ | 7 | 已交付（契约 + 开库器 + 迁移） |
| `dsh-mana-jev` | `mana-jev` | `mana-jev` | 1816 | ✅ | 5 | 已交付（原语 + 护栏 + 真通道） |
| `dsh-mana-vector` | `mana-vector` | `mana-vector` | 940 | ✅ | 2 | 已交付（B1.1） |
| `dsh-mana-perception` | `mana-perception` | `mana-perception` | 118 | ✅ | 0 | **已接链**（真发 `mana/observation`） |
| `dsh-mana-attention` | `mana-attention` | `mana-attention` | 256 | ✅ | 0 | **半成品**（真发 `mana/attention` + Injection Gate；无本包测试） |
| `dsh-mana-working-memory` | `mana-working-memory` | `mana-working-memory` | 146 | ✅ | 0 | **已接链**（消费 `mana/attention` + 容量闸） |
| `dsh-mana-scheduler` | `mana-scheduler` | `mana-scheduler` | 378 | ✅ | 1 | 已交付（B2.2） |
| `dsh-mana-metacognition` | `mana-metacognition` | `mana-metacognition` | 1751 | ✅ | 3 | 已交付（B5.1 判据阈值层） |
| `dsh-mana-user-model` | `mana-user-model` | `mana-user-model` | 92 | ✅ | 2 | 骨架 + 判据 |
| `dsh-mana-ui` | `mana-ui` | `mana-ui` | 906 | ✅ | 2 | 已交付（B6.1） |
| `dsh-mana-long-term` | `mana-long-term` | `mana-long-term` | 74 | ✅ | 1 | **仅骨架**（待 B3.1） |
| `dsh-mana-consolidation` | `mana-consolidation` | `mana-consolidation` | 74 | ✅ | 1 | **仅骨架**（待 B4.1） |
| `dsh-mana-forgetting` | `mana-forgetting` | `mana-forgetting` | 74 | ✅ | 1 | **仅骨架**（待 B4.2） |

### 3.1 JEV 统一适配插件

| # | 参考文档原文 | 本仓实际 |
|---|---|---|
| ① | `ctx.on('mana/jev/judge', async (req, next) => …)` | **不存在该监听器**。`mana/jev/judge` 是 **waterfall** 型，**必须** `ctx.waterfall(…)` 分发；用 `emit` 会**同步抛** `TypeError: next is not a function` |
| ② | `new DecisionCache(config.cacheTTL)` | 真名 `JevGuard`（五件合一的**纯状态机**：缓存 / 熔断 / 冷却半开 / 并发 / 预算），缓存是 `Map` |
| ③ | `catch { if (config.fallbackEnabled) return localFallback(req); throw err }` | **无 `localFallback`、无 `fallbackEnabled`**。本仓**禁止**沉默兜底：所有降级落 `degraded:true` + **非空 `reason`**，且**每一条路径都写 `jev_log`** |

真实入口形态（`packages/jev/src/index.ts`）：

```typescript
export const name = 'mana-jev'
/** 依赖 core（方案 §9.1）。缺 core 时本插件停在 waiting，不半启动。 */
export const inject: string[] = ['mana-core']

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-jev: 缺少 mana-core 服务（inject 未满足，不应半启动）')

  const guard = new JevGuard({ cacheTtlSeconds: config.cacheTtlSeconds, /* … 五项 */ })
  guard.setWaitTimeoutMs(config.concurrencyWaitTimeoutMs)

  // 判定/落痕同源：库句柄直接取自 core
  const service: ManaJevService = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, coreStorePath: core.storePath,
                     channel: config.channel, systemoneApiKeyEnv: config.systemoneApiKeyEnv }), // 只回**变量名**
    judge:          (o) => judgeWithOllama({ ...o, endpoint: o.endpoint ?? config.endpoint,
                                            model: o.model ?? config.model, db: core.db }),
    judgeSystemone: (o) => judgeWithSystemone({ ...o, endpoint: o.endpoint ?? config.systemoneEndpoint,
                                            model: o.model ?? config.systemoneModel,
                                            path: o.path ?? config.systemonePath,
                                            primaryQuestion: o.primaryQuestion ?? config.systemonePrimaryQuestion,
                                            apiKeyEnv: o.apiKeyEnv ?? config.systemoneApiKeyEnv, db: core.db }),
    judgeGuarded:   (o) => judgeWithGuard({ ...o, guard,
                                            judgeFn: o.judgeFn ?? (config.channel === 'systemone' ? systemoneDriver : ollamaDriver),
                                            channel: o.channel ?? config.channel, db: core.db }),
    guardState: () => guard.snapshot(),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-jev', service)
    return () => dispose()
  }, 'dsh-mana-jev: service')

  registerPassThroughPreStep(ctx, name)   // 必须调 next()，否则静默掐死下游
}
```

### 3.2 LLM 适配器插件

| # | 参考文档原文 | 本仓实际 |
|---|---|---|
| ① | 包 `dsh-mana-llm` | **该包不存在**（13 包清单内无此目录） |
| ② | `class ManaAdapter extends LlmAdapter` + `stream()` | **形态正确**：`dsh-llm` 的 `LlmAdapter` 确为抽象类，`stream()` 是**唯一必实现方法**（其余 `providerInfo`/`resolveModel`/`prepareCall` 等有缺省） |
| ③ | `ctx.llm.registerAdapter(['mana'], new ManaAdapter(config))` | **API 正确但未调用**：`ctx.llm` 真实存在（`LlmRuntime`，`registerAdapter(providers, adapter)` 返回可 `replace()` 的 handle），**本仓零调用点** |

**本仓对 `dsh-llm` 的真实用法**（与"注册适配器"完全不同的一件事）：

```typescript
// packages/attention/src/index.ts —— 用宿主官方构造函数，不手搓消息对象
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// ⚠ 必须用宿主官方的 createUserMessage，**不能**手搓 {role, content}：
//   手搓对象缺宿主消息基类字段，注入块会在宿主侧被拒绝/静默丢弃。
const injected = createUserMessage({ /* 注入块内容 */ })
```

> **结论**：3.2 的设计**尚未落地**，但**接口面已核实可用**（不是"查无此物"）。
> 真要做的是**新增一个 `dsh-mana-llm` 包并注册 `'mana'` 路由**，而非修改既有包。

### 3.3 编码插件

| # | 参考文档原文 | 本仓实际 |
|---|---|---|
| ① | 包 `dsh-mana-perception` 里 `ctx.on('mana/observation', async (obs) => …)` | **角色错位**：`mana/observation` 的**监听者是 `mana-attention`**，不是 perception。perception 是**发出方**（`perceive()` 逐块 `ctx.emit('mana/observation', obs)`） |
| ② | `await generateSummary(ctx, obs.content)` | **未实现**（全仓无摘要生成） |
| ③ | `ctx.emit('mana/jev/write-gate', {…})` | **该事件未声明**。S1 五类 + JEV 两事件 + inactive 共 8 个事件里没有 `mana/jev/write-gate` |
| ④ | `gateResult.answers.worth_keeping?.noul >= 0.6` | **取值形状正确** ✅（真通道 `answers.<key>.noul` 确为 0..1），但**无该调用点、无该 prompt** |
| ⑤ | `await writeMemory(ctx, { content, summary })` | **未实现**。`memory_items` 表已建，**无生产侧写入者** |

真实的 perception 形态：

```typescript
// packages/perception/src/index.ts —— 分块是"真行为"不是装饰
export function chunkText(text: string, maxChunkChars: number, chunkOverlapChars: number): ChunkResult {
  const src = String(text ?? '')
  if (maxChunkChars <= 0 || src.length <= maxChunkChars) return { chunks: [src], split: false }
  // ⚠ 步长必须 > 0：overlap >= maxChunkChars 会让 index 不前进 ⇒ 无限循环（静默挂死）
  const overlap = Math.min(Math.max(chunkOverlapChars, 0), maxChunkChars - 1)
  const step = maxChunkChars - overlap
  const chunks: string[] = []
  for (let i = 0; i < src.length; i += step) {
    chunks.push(src.slice(i, i + maxChunkChars))
    if (i + maxChunkChars >= src.length) break
  }
  return { chunks, split: chunks.length > 1 }
}

const perceive: ManaPerceptionService['perceive'] = (input) => {
  const { chunks } = chunkText(input.content, config.maxChunkChars, config.chunkOverlapChars)
  for (const [i, chunk] of chunks.entries()) {
    ctx.emit('mana/observation', {
      sessionId: input.sessionId, turnId: input.turnId,
      // 多块时 requestId 派生后缀，使各块在审计上**可分辨**
      requestId: chunks.length > 1 ? `${input.requestId}#${i + 1}` : input.requestId,
      at, content: chunk, source: input.source ?? 'unknown',
    })
  }
  return chunks.length
}
```

缺省值（真被消费，不是死开关）：`maxChunkChars=1200`、`chunkOverlapChars=120`；
`attention`：`maxFocusItems=4`、`jevThreshold=0.7`、`injectionEnabled=true`、`injectionBudgetChars=4000`。

---

## 四、置信度阈值校准

### 4.1 校准原则

1. 在数据的一半上选阈值，在另一半上验证 —— **本仓未实现任何校准代码**（`grep -rn 'calibrate' packages/` 零命中）。
2. 低置信度意味着概率分布分散，应升级处理 —— 本仓以**显式降级 + 非空 reason + 落痕**表达"低置信"，不引入第二套语义。
3. 保守策略：要求 95% 置信下界通过 —— 与本仓**分档纪律**一致（见 4.3）。

### 4.2 Mana 各场景阈值

> **实况**：参考文档 8 个场景里，本仓**只有 3 个数字真实存在于代码**，其余 5 个**未实现**。
> 且本仓纪律：**阈值必须可判定才进放行闸**；无本机基线的目标值一律标「待定，需首测后自设」，
> **不得以"未超标"放过**。

| 场景 | 参考文档阈值 | 本仓实况 | 失败策略 |
|---|---|---|---|
| Write Gate | 0.6 | **未实现**（无 prompt/无调用点） | — |
| Recall Gate | 0.5 | **未实现**（检索路无 JEV 判定） | — |
| Injection Gate | 0.6 | **门控已实现、判定源未接**：`gate` 五类枚举 + 每次 pre-step 必留痕**已真**；`jevProb` 恒 `null` | **fail-closed** ✅ 已实现（沉默地不注入 + **必须留痕**） |
| 注意力门控 | 0.7 | **配置在、消费方无**：`attention.jevThreshold = 0.7` 已声明；**无判定链读它** | 未实现 |
| 安全守门 | 0.8 | **未实现** | — |
| 遗忘优先级 | 0.3 | **未实现** | — |
| 再巩固更新 | 0.6 | **未实现** | — |
| 原则有效性 | 0.6 | **未实现** | — |

**本仓真实存在的三个数字**（A 档，可逐字复现）：

| 数字 | 值 | 位置 |
|---|---|---|
| 判定门限缺省 | `0.5` | `judgeWithOllama(options.threshold = 0.5)`（`pYes >= threshold ⇒ 'yes'`） |
| ACT-R 检索阈值 τ | `-2.0` | `schema.ts: retrieval_threshold REAL DEFAULT -2.0` |
| 注意力 JEV 阈值 | `0.7` | `attention/src/index.ts: jevThreshold`（**当前零消费者**） |

### 4.3 动态校准

**参考文档的 SQL 与真表可对上**（`jev_log.source` 列确实存在 ✅），但校准代码**未实现**：

```typescript
// 参考文档写法（本仓**未实现**）
async function calibrateThreshold(ctx, scene) {
  const logs = await ctx.db.query('SELECT * FROM jev_log WHERE source = ?', [scene])
  const [calibrationSet, validationSet] = splitHalf(logs)
  return { scene, threshold, precision, recall }
}
```

**本仓真实的取值口径**（校准要接的真实数据面）：

```sql
-- jev_log 真实列（schema.ts）
CREATE TABLE IF NOT EXISTS jev_log (
  id TEXT PRIMARY KEY, request_type TEXT NOT NULL, source TEXT NOT NULL,
  state_hash TEXT, result_value TEXT, probability REAL,
  cached INTEGER DEFAULT 0, degraded INTEGER DEFAULT 0, latency_ms INTEGER,
  cost_usd REAL, session_id TEXT, turn_id INTEGER, created_at TEXT NOT NULL
);
```

> ⚠ **校准前必须先过阈值分档纪律**（本仓 `docs/contract/threshold-discipline.md` 是冻结契约）：
> - **A 档**（确定性、跨运行逐字复现：计数 / exit code / 版本号 / 闭式数学值）→ **可进阈值列**；
> - **B 档**（浮动量，同机跨采样差 **1.2–13 倍**：各类绝对毫秒、相似度采样值）→ **不可进阈值列**，只能写**比值上界**或作测量条件说明。
> - 例如 `cost_usd` 是 **B 档**（实测 ~`1.2e-5` USD/次）⇒ **不得当阈值判据用**。
> - **缓存命中率必须限定口径**：`jev_log.cached`（JEV 判定缓存，TTL 300s）与"LLM 前缀缓存"是**两个不同的缓存共用一个词**；后者在本仓**无落点** ⇒ 若取不到，**如实标「不可观测」**，**不得用代理量当判据**。

---

## 五、JEV 通道选择

**实况**：参考文档列 4 条通道，本仓**只实现 2 条**，且**首选不是 OpenRouter**。

| 通道 | 参考文档写法 | 本仓实况 | 判定 |
|---|---|---|---|
| OpenRouter | `POST /api/v1/systemone` 首选 | **未使用**（全仓 0 命中） | ❌ 与实况不符 |
| TypeSafe API | `POST /v1/systemone`（有 TypeSafe 账号） | **不是独立通道**：仅以**模型别名**形式出现在服务端白名单（`typesafe/jev-1.13`、`~typesafe/jev-latest`、`typesafe/jev-latest`） | ⚠ 降格为模型名 |
| AI Gateway | `POST /v1/evaluate`（Vercel 用户） | **未实现** | ❌ |
| LitJev | Qwen 本地推理（隐私敏感） | **已否决**：需 `Qwen3.8-27B` + **H100 80GB**；本机 **RTX 2070S 8GB**，且 `uv`/`python` 均未找到 | ✅ 已拍板另走 |

**本仓真实的 2 条通道**：

| 通道 | 方式 | 适用场景 | 缺省 |
|---|---|---|---|
| `'ollama'` | `POST http://127.0.0.1:11434/api/chat` + `think:false` + `logprobs:true` + `top_logprobs:5` + `num_predict:1` + `temperature:0`；从 **pos0** 取候选、按 `trim().toLowerCase()` 归 `yes/no` 族求和 | **缺省**；本机、免费、隐私不出机 | ✅ `channel:'ollama'` |
| `'systemone'` | `POST https://nano-gpt.com/api/v1/systemone`，`{model, state, questions}`，服务端直接给概率/取值 | 真 JEV 本体（`jev-1.13`） | 须**显式**开启 |

**选择器纪律（本仓的硬约束）**：

```typescript
// 非法值**抛错**而不是静默回落（静默回落 = "配置点了没反应"的经典形态）
channel: Schema.union([Schema.const('ollama'), Schema.const('systemone')]).default('ollama'),
```

- 缺省**不变**：既有装配与既有判据走 `'ollama'`，换通道是**显式**动作；
- 反向也成立：`'systemone'` **不会静默降级回 Ollama**（无凭据 ⇒ 显式降级留痕 `systemone-no-api-key`）；
- **凭据纪律**：配置里存的是**变量名**（缺省 `NANOGPT_API_KEY`），**key 永不进仓库、永不进配置文件**；
  服务面 `status()` **只回变量名**。判据/探针面另有唯一入口 `resolveSystemoneCredential()`（显式入参 → 环境变量 → `~/jev/.env`），
  **同源**是为了防"探针能过、判据全红"（该形态本仓实测踩过一次）。

**实测契约（`systemone`，2026-09-24 亲探，非转述）**：

- 三种合法 `type`：`noul` / `choice` / `score`（未知 ⇒ 400 `invalid_question_type`）；
- `choice` 的 `criteria` 是**对象**（键=返回值）；`score` 的 `criteria` 必须是**数组**（对象会 400），服务端回填 `legend`，`score` 是索引；
- 错误形态：`401 missing_api_key` / `400 model_not_supported|invalid_question|invalid_questions`；
- **`choice`/`score` 不是降级**（HTTP 200、答案完整 ⇒ `degraded:false`），但它们没有 yes/no 语义
  ⇒ 契约单值面 `value:'unknown'` + `probability:null`（**不得用 0 冒充**），真实取值进 `answers` **不丢**。

---

## 六、降级链路

**实况**：参考文档两行的"最终兜底"（向量相似度 / 模板回复）在本仓**均未实现**；
本仓降级的真实形态是**可枚举 reason + 强制留痕**，且**三条前缀互不混淆**。

| 组件 | 正常路径 | 降级路径 | 最终兜底 | 本仓实况 |
|---|---|---|---|---|
| JEV 判断 | JEV API | 缓存 → 本地规则 | 向量相似度 | **缓存 ✅ 已实现**（TTL 300s，仅正常判定且概率非 null 才进缓存）；**本地规则 ❌ 未实现**；**向量相似度兜底 ❌ 未实现** |
| LLM 生成 | `ctx.llm` | 小模型降级 | 模板回复 | **❌ 整条未实现**（无 `dsh-mana-llm` 包、无适配器注册、无调用点） |

**本仓真实的降级原因清单（可枚举、可按前缀统计）**：

| 前缀 | 条数 | 取值 | 归属模块 |
|---|---|---|---|
| `ollama-` | 6 | `request-failed` / `http-error` / `invalid-json` / `no-logprobs` / `no-candidates` / `no-yes-no-token` | `ollama.ts`（token 面） |
| `systemone-` | 8 | `no-api-key` / `request-failed` / `http-error` / `invalid-json` / `no-answers` / `primary-missing` / `primary-not-noul` / `invalid-probability` | `systemone.ts`（答案面） |
| `jev-` | 4 | `circuit-open` / `circuit-probe-in-flight` / `session-budget-exceeded` / `concurrency-timeout` | `framework.ts`（护栏面） |

**降级的三条硬纪律（本仓契约，非建议）**：

1. **禁止 `catch { return null }`** —— 降级**必须**落显式字段。
   反例就在本机生态里：shoucang `lib/vec.js:254` 原文 `catch { return null }` 把「provider 失败」与「正常空结果」混为一谈，
   后果是向量档**看起来跑通、实际全走词法**。
2. **「不可用」与「零值」必须可分辨**：概率不可用 ⇒ `null`（**不得用 0 冒充**）；判定失败 ⇒ `value:'unknown'`（**不得默认成 'no'**）。
   每一处降级必须**同时**给 `degraded: true` 与**非空** `reason`。
3. **降级不缓存**：网络类失败更**不得**缓存 —— 那会把一次瞬时故障**放大成 TTL 内的持续故障**。
   `unknown` 同理：宁可下次再问模型，也不把 unknown 当结论。

**向量路的降级（与 JEV 路并列的另一条链）**——三态明确、**不是同义词**：

| `channel` | 触发条件 | `rankBy` | `degraded` |
|---|---|---|---|
| `'vector'` | 查询嵌入成功**且**至少一条候选常驻命中 | `'rrf'` | `false` |
| `'lexical'` | **调用方显式要求跳过向量**（本来就不走） | `'local_score'` | `false`（**不是故障**） |
| `'degraded'` | 嵌入失败（端点不通/维度不符/未配置）**或**候选常驻全未命中 | `'local_score'` | `true`（**想走但没走成**，必须留痕） |

> ⚠ **降级时 `rankBy` 必须是 `'local_score'`**：降级路径上没有 JEV 概率，若仍标 `jev_prob`，
> 下游会把「没判」读成「判了且低分」—— 这正是降级纪律要防的形态。

---

> Mana（末那识）：JEV 做判断，LLM 做生成，插件做控制——完整接入点细化。
> **本文件为实况订正版**：骨架沿用 v6.3，内容以仓库实测为准；未实现者如实标注，不以设计意图冒充现状。
