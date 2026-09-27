# 端点判据的归因读数：分清「环境坏了」与「代码坏了」

> 适用对象：一切**跑真端点**的判据（本机 Ollama 的嵌入面 / 聊天面）。
> 状态：2026-09-27 落地（卡 `t-mujtowyp-3dcdhz`）；实现见 `packages/vector/tests/_live-endpoints.mjs`。

## 1. 由来（先把"别改错方向"钉住）

本席实测（宿主 Ollama 负载抖动时）：**同一提交、同一命令**连续三次跑出 **1 红 → 4 红 → 0 红**，
红的全在真端点判据（`B1.1-⑩` / `B1.2-*` / `J1-⑫` / `dense` / `dual` 的真数据前提）。环境恢复后 846/846/0。

⚠ 初判**被实测推翻**，如实记：我原以为缺口是「环境不可用时该报 NO_DATA 而不是 FAIL」。
本仓对此早有明确立场，且**带判据**：

| 位置 | 原话 |
|---|---|
| `packages/jev/tests/gate.mjs:11` | 「④ **显式红腿**：现场用**无凭据**环境跑真通道判据，要求它 **必须红且零跳过**」；能力边界栏写明「**凭据存在但服务端真的坏了 —— 那由真通道判据本体的读数负责**」 |
| `packages/jev/tests/gate-checks.mjs:16` | 「**抓不到**：`assert.fail` 存在但被 `if` 包住；以及"凭据在但服务端坏了"⇒ ……后者由**判据本体的读数**负责」 |

⇒ **「环境不可用时判据变红」是刻意设计，不是缺陷**。改它 = 拆 ④ 显式红腿那道防线（假绿②）。
⇒ 真缺口只有一条：**红的时候读者分不清是哪一种红**。改前的形态把环境事实塞在 `reason` 字符串里
（例：`'本机 bge-m3 必须可达（这是测量条件）：' + emb.reason`），**读者要自己翻**才知道是环境问题。

## 2. 三态（**前两者都仍然是红**，区别只在文案与诊断）

| 类别 | 何时 | 颜色 | 下一步动作（文案里必须写出来） |
|---|---|---|---|
| `env-unavailable` | 传输出错 / 端点不可达 / 超时 / 服务端明确回「不支持嵌入」 | **红** | 查**测量环境**：宿主 Ollama 是否在跑 · 端点是否指对 · 是否以 `--embeddings` 启动 · 所选模型是否具嵌入能力 |
| `behavior-wrong` | 环境已应答且格式合法，读数仍不达 | **红** | 查**被测代码**：缺陷在被测面，别去重启服务 |
| `ok` | 测量条件成立且读数达 | 绿 | 无需动作 |

三条**不得同形**的判据（可机检）：
1. 类别名不同（`[live-endpoint · env-unavailable]` / `[live-endpoint · behavior-wrong]`）；
2. 判定语不同（`环境不可用` / `环境可用但被测行为不对`）；
3. **下一步动作不同**，且**互斥**：环境态文案含「不是被测代码的问题」，行为态文案含「不是环境问题」。

## 3. 读数形状（一把标尺，两边共用）

```js
{ baseUrl, model, degraded, failureKind, reason, ms, vectorCount, dims }
```

⚠ 命名陷阱（**踩过**）：向量管道里也有一个 `degraded`（`AdaptOutcome.degraded`，A1-11 契约字段）。
那是**被测面**的事，这里是**环境态**的事。本模块的输入里 `degraded === true` 只表示
「这一次真调用没拿到可用应答」；`out.degraded`（RecallOutcome）走的是 `.out` 那条路，两者**不得混读**。

## 4. 怎么写（照抄即可）

```js
import { assertLiveEmbed, attributionText, behaviorWrongText, readLiveService, classifyLiveEndpoint }
  from './_live-endpoints.mjs'

// ① 测量条件那一腿（真端点可达性）：期望值恒为 false —— 与改前的 assert.equal(x.degraded, false, ...) 逐字同义
assertLiveEmbed(probe, { title: 'B1.1-⑩ 嵌入端点的测量条件', baseUrl: cfg.baseUrl, model: cfg.model })

// ② 环境已应答之后的读数：用 behavior-wrong 文案（读者不会又去查 Ollama）
assert.equal(dim, 1024, behaviorWrongText('维度契约（A1-12）', 'dim=' + dim))

// ③ 端点层前置（要"显式红"而不是断言读数时，如 jev 的真调用腿）：
await requireOllama('B1.2-1 真调 Ollama 的测量条件')   // 内部仍走 assert.fail ⇒ ④ 显式红腿的扫描面一字未动
```

## 5. 硬边界（改判据时逐条自检）

1. **不许 skip**：不得出现 `t.skip` / 静默 `return` / `if (可达) { … }` 包整个用例。
   环境不可用仍是红 ⇒ 该断言**必红**这一性质不变。
2. **不改被测读数**：本模块只产出文案与类别；被断言字段与期望值一字不动。
3. **不自己发请求**：判据自己发（或调用方已发的那一份读数），本模块只读
   （vector 侧有「一次真端点请求都不发」的硬约束，见 `embed-unsupported.test.mjs` 的 J1-⓪ 自检）。
4. **不另立失败判据**：归类复用被测面已有的 `failureKind` 与 `unsupportedMarkerIn`（直接 import，不抄第二份特征串）。
5. **stub 端点的调用方也要用同一把标尺**：同进程 stub 的红一律落 `behavior-wrong`
   （例：`recall-graph.test.mjs` 的 W2-C3-⑩ 前提腿）。否则"有的红归因得了、有的归因不了"。
6. **一处实现**：两包（vector / jev）共用 `packages/vector/tests/_live-endpoints.mjs`，
   不各写一套措辞（措辞漂移 = 又一种"同形"）。

## 6. 盲区（如实登记，不许当成已解决）

- **「服务端活着但回得慢」**：读到的是 `degraded:true + reason='嵌入请求失败（…）：TimeoutError'`，
  按本口径归 `env-unavailable`（下一步查环境）—— **类别对，但文案点的是"服务在不在"，
  不是"为什么慢"**。`docs/handoff/S12.md` 记录过该腿在 `npm test` 负载下从 23ms 飙到 6581/7055ms。

  ⚠ 2026-09-27 本席**当场观测到这一类**（不是复述旧记录），原始读数：

  | 时刻 | 并发 | 宿主单次嵌入 | 判据读数 |
  |---|---|---|---|
  | 21:15 | 另一工作树正跑 `npm test` | 超 8s | `ms=8004 · TimeoutError` |
  | 21:19 | 同上（load 2.25） | **26.9s** | `ms=30003 · TimeoutError`（30000ms 阈值被打穿） |
  | 21:21 | 并发退去 | — | 判据全绿 `95/95` |

  ⇒ 这类红的**归因方向是对的**（查环境），但它与被测代码问题的**分辨力来自 timeout 是否被打穿**：
  `embed.ts` 的本地缺省 30000ms **不得调大**（调大 = 改测量条件，
  `docs/handoff/w4-session-prompts.md:157` 明禁），正确处置是**等负载退去后复跑**并比对。
  `a1-check.mjs` 的 A1-12 已用 TCP 探针 + 两态留档正面处理这一类（能报出"TCP 通但嵌入慢"），
  测试面本期**未做**同名探针 —— 这是本改造**未覆盖**的一段，如实登记。
- **本模块不覆盖「判据根本没跑到端点」的形态**（如被测面在更早处就降级为环境态）：那由被测面读数负责。
- **`behavior-wrong` 的自动判定**只覆盖「应答里没有向量」；其余读数缺失需调用方用
  `behaviorWrongText` 显式标注（给不出就写「未验证」，不许默认成通过）。
- **登记表**（本仓两次栽在"新文件没登记 ⇒ 外部防线不看它"，故逐处核对，不只写一句"无需同步"）：
  | 登记表 | 管什么 | 本次是否需要同步 | 核对方式 |
  |---|---|---|---|
  | `packages/vector/tests/gate.mjs` 的 `FILES` | 逐文件**用例条数等式** | **否**（未新增用例文件、未改条数） | 现值与登记值逐字相同，见 §7 自证输出 |
  | `packages/jev/tests/gate.mjs` 的 `OFFLINE`/`COUNTED_OTHER` | 同上（+ 总和等式） | **否** | `b12-jev.test.mjs` 仍 11 条 |
  | `packages/vector/tests/pkg-registration.guard.mjs` | **包**（`packages/*/package.json` 的 main） | 不适用 | `_live-endpoints.mjs` 不是包 ⇒ 无需登记 |
  | `tools/a1-check.mjs` 的 `readdirSync('packages')` | 只扫 `packages/*/src` | 不适用 | 不扫 tests ⇒ 无涉 |
  ⚠ 将来若**新增**测试文件或**增删用例**，上表前两行必须同步（改条数要**同时**改闸与文件内 ⓪ 自检）。
