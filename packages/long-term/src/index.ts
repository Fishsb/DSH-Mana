/**
 * `dsh-mana-long-term` —— Mana 长时记忆：编码 + ACT-R 激活方程 + 三路混合检索
 *
 * ── 当前状态：**B3.1 已填实现 + W1-3 已接线写入路径**（本条与下面的历史记录并列，不覆盖）──
 * 本包曾长期是 74 行"诚实的空壳"。B3.1 落地了 **ACT-R 激活方程 + 时间衰减**，
 * 故 `status().behavior` 由 `'skeleton'` 改为 **`'active'`**（改为据实现事实回报，见下 §行为面）。
 *
 * ⚠ **W1-3（2026-09-26）改变了本包的形态面，必须交代**：此前 `memory_items` 在生产侧
 *   **没有任何写者**（`core.writeMemoryItem` 的 3 个 `packages/<pkg>/src` 命中**全是注释**——
 *   `metacognition/src/profile-pipeline.ts:14`、`user-model/src/index.ts:28/106` 都在说
 *   "本模块不调用它"）⇒「记忆写入路径」整条是断的，而「表是空的」与「Write Gate 把一切都判掉了」
 *   **同形**。W1-3 把 `perception(输入采集) → Write Gate(判值不值得留) → 本包(编码落库)` 接上：
 *   · 新增 `write-gate.ts`（判定面，见该文件头：bigram 预过滤 + 一次 `worth_keeping` fan-out + fail-open）；
 *   · `apply` 新增**一条** `mana/observation` 监听器（`ctx.on` **直挂**，与
 *     `attention/src/index.ts:806` 同一条路径；`inject` 仍只声明 `['mana-core']`）。
 *   ⇒ 三条既有判据**按设计红了**（它们抓的正是"多了一条行为而没人交代"），本批**同步改写口径**
 *     而不是删：⑦/`RG-⑤`/`retirement ⑥` 的 effect 计数 **3 → 4**（多出的那条即 `ctx.on`，
 *     且**逐条点名**三个旧标签仍在 ⇒"删掉一条旧行为来给新行为腾位置"同样会红）；
 *     ⑧ 保留"**本包不写 `mana_trace` 一行**"的读数，但把探针触发串换成**预过滤不可能命中**的串
 *     并**先断言该前提**（原串在启用预过滤后进不了判定 ⇒ 该判据会因**错误的原因**变绿 = 假绿）。
 *     ⚠ 为什么必须改而不是绕：⑦ 的意图是"**多一条行为即红 ⇒ 强制交代**"，本批正是被它叫醒的。
 *   · `status()` 新增 `writeGate` 读数（`registered` / `degradedCount` / `lastFailure` /
 *     `lastState`）：`registered=false` ⇒ **要么没挂上、要么 `ctx.on` 抛了**（后者计数在
 *     `degradedCount` + 具名 `lastFailure`）。为什么必须分态：cordis 的 `ctx.emit` 无接收者时
 *     **不报错、不计数** ⇒ 只看事件面，"没挂上"与"挂了但没有输入"**同形**（都是"没写行"）。
 *
 * 尚未实现（仍属后续批次，**不得**读作已完成）：三路混合检索（B3.2）、
 *   `base_level_activation` 列的生产写者、`supersedes` 分支（rollout:103 的 fan-out 只接了
 *   `worth_keeping` 一路，`choice` 那一路未接 ⇒ 本批**不声称**三道门控齐活）、
 *   `S` 的 Pavlik–Anderson 更新（B4.2）。
 *
 * ── 实现面（`src/`，判据在 `tests/activation.test.mjs`；软删除面在 `tests/retirement.test.mjs`）
 *  · `params.ts`      —— 5 个工程参数 + 1 个派生量 `s` 的**唯一出处**（C14 唯一写者）
 *  · `decay.ts`       —— 时间衰减核 `decay(t,h)`，**A1-5 的实现者**（此前该项在
 *                        `tools/a1-check.mjs` 里报 NONE「无实现者」⇒ 本文件出现后转 HANG）
 *  · `activation.ts`  —— `baseLevel`(A2-1) / `retrievalProbability`+`latencyMs`(A2-2) / `noiseTerm`
 *  · `retirement.ts`  —— 软删除/恢复原语 + 退休过滤检索，**A2-6 / A2-7 的实现者**
 *                        （此前这两条在落地册里"已写但无实现者"）。**只改 `retired` 位、永不删行**。
 * 公式与判据原文见各文件头；`baseLevel` 的 `t_j` 单位是**秒**、`decay` 的是**天**，不可相乘。
 *
 * ⚠ **两条实现面各有各的清单，不合并**（`IMPLEMENTED_EXPORTS` = ACT-R 面；
 *   `IMPLEMENTED_RETIREMENT_EXPORTS` = 软删除面）：合并会让 `skeleton.test.mjs:87`
 *   的「清单长度 == 逐名对照集合长度」**与 `activation.test.mjs:232` 的逐名 deepEqual
 *   同时失效** —— 那两条断言是**既有判据**，本席不得为了放下新实现而去改它们。
 *   加一张独立清单 = 新面独立可检，旧面一个字不动。
 *
 * ── 历史记录（P1 骨架期，保留原文）─────────────────────────────────────────────────
 * ⚠ **本骨架曾是"诚实的空壳"，且"没有行为"本身是机检事实**（R2 订正）：
 *   它**不写任何 `mana_trace` 行** ⇒ 「卸载后同一触发不再产生新行」这条反证判据在本包上
 *   **平凡通过**（成立的原因是"它从来没生效过"，G11）。故 `status()` **显式**回报
 *   `behavior: 'skeleton'`，并由 `tests/skeleton.test.mjs` **读运行时服务面**断言该值，
 *   且**并列断言"本包仍是空壳"**（判据⑦ effect 面恰好 3 条、判据⑧ 行为面 0 行）——
 *   一旦有人加进真行为而忘记改它，判据即变红（R2b 前这里只是注释承诺，零机检）。
 *
 *   ⚠ **反向不可机检，此处如实声明**（R2b 订正，删去原先的空承诺）：
 *     「填了真行为却把 `behavior` 留成 `'skeleton'` ⇒ 判据必红」**原句是空的** —— 实测
 *     （注入真行为、`behavior` 不动）六条全绿。真因是 **A 方案在此结构上不可行**：
 *     `behavior` 要"由实现事实推导"，就得先定"什么是本包的真行为"，而那是**阶段 2/3 的交付物**
 *     （写什么 `mana_trace` 行）⇒ 预写它即越界。
 *     现由 ⑦⑧ **间接**覆盖：**新增行为**（监听器/定时器/写行）必被 ⑦ 或 ⑧ 抓到；
 *     **残留盲区（如实记）**：若把行为换成"effect 数不变的同形实现"，⑦⑧ 抓不到。
 *
 * ⚠ **本包刻意不导出 `Config`**（R2 订正 · 删除一个假旋钮）：
 *   本轮一度导出 `enabled: boolean`，但它 `apply` 里零消费 —— `enabled=false` 与 `true`
 *   **完全同形**（监听器照注册、事件照透传），即"假旋钮"。两条修法（做真 vs 删掉）本席选**删掉**：
 *   ① `册:318` 要求骨架 `apply` **必须**注册 waterfall 监听器并调 `next()`（把 G9 钉成**结构约束**）。
 *      若让 `enabled` 去门控这条监听器 ⇒ G9 义务变成"可由配置关掉"，与结构约束的本意相悖；
 *      一枚配置就能静默取消 next() 纪律，正是本仓最要防的那类失败。
 *   ② 对一个零行为的空壳，可"关掉"的东西只剩服务提供面本身 ⇒ `enabled=false` 的形态与
 *      "插件根本没装/装失败"**同形**，等于新增一条静默通道。空壳本就够小，无需灰度旋钮。
 *   ⚠ **B3.1 未推翻这条**：新增能力全是**纯函数**（无 IO、无监听器、无定时器），
 *   仍然没有真旋钮可关 ⇒ 依旧不导出 `Config`（`skeleton.test.mjs` 判据⑤ 继续有效）。
 *
 * ⚠ 硬结构约束（G9 / `册:318`）：`apply` 必须注册一条 waterfall 监听器并调 `next()`，
 *   走 core 的 `registerPassThroughPreStep`（唯一写点）。漏调的后果**不报错**：
 *   本仓实测上游不调 `next()` ⇒ 下游哨兵 reached=0、返回 undefined、全程无异常。
 *
 * ── 行为面（覆盖边界，如实声明）───────────────────────────────────────────────────
 * **B3.1 期**：交付是**纯计算** —— 不写 `mana_trace`、不落库、不注册业务监听器，
 * 故当时 ⑦（effect 面恰好 3 条）与 ⑧（`mana_trace` 0 行）**成立且无需改动**
 * （见 `docs/handoff/S14.md` §4 对"⑦⑧要不要改"的逐条判断）。
 *
 * **W1-3 期（本批）**：本包**第一次有了写行为** ⇒ 上面两条判据**按设计红了**（⑦ 抓的正是
 * "多了一条行为而没人交代"）。本批的处理是**同步改写口径并把新旧形态都钉住**：
 *   · ⑦ → **恰 4 条** effect（多出的那条 `ctx.on('mana/observation')` 即本批新增），
 *     并**逐条点名** `service` / `ctx.provide(` / `agent/pre-step` 三个旧标签仍在
 *     ⇒「删掉一条旧行为来给新行为腾位置」同样会红（不是"只查数量"）。
 *   · ⑧ → **保留**"本包不写 `mana_trace` 一行"的读数（写记忆 ≠ 写 trace，两者是**两张表**），
 *     但把探针的触发串换成**预过滤不可能命中**的串并**先断言该前提**：原串在启用预过滤后
 *     根本进不了判定 ⇒ 该判据会**因为错误的原因变绿**（假绿，本仓最忌）。改写后它测的仍是
 *     "本包不写 trace"，而"写了记忆"这一新事实由**新增的** `tests/write-gate.test.mjs` 覆盖。
 *
 * ⚠ 诚实边界（未修）：`behavior: 'active'` 的反方向仍**没有判据强制**它。
 *   本包有 `tests/activation.test.mjs` 判据⑥：**导出面被挖空即红** —— 它覆盖的是
 *   "实现被搬走"，**不**覆盖"实现还在而 behavior 写回 skeleton"。后者仍是盲区，未修。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { DatabaseSync } from 'node:sqlite'
import { registerPassThroughPreStep, type ManaCoreService, type ManaObservation } from 'dsh-mana-core'
import { ACTR_PARAMS } from './params.ts'
import { decay } from './decay.ts'
import {
  encodeIdPart,
  JEVD_TRACE_WRITTEN_KEY,
  judgeIdFor,
  judgeIdParts,
  recallGate,
  traceWrittenOf,
  RECALL_GATE_DEFAULTS,
  RECALL_GATE_DEFAULT_THRESHOLD,
  RECALL_GATE_QUESTION,
  RECALL_GATE_SOURCE,
  RECALL_GATE_STATES,
  sortByLocalScore,
  type RecallGateCandidate,
  type RecallGateConfig,
  type RecallGateHit,
  type RecallGateOutcome,
  type RecallGateRequest,
  type RecallGateState,
} from './recall-gate.ts'
import {
  activation,
  associativeActivation,
  baseLevel,
  latencyMs,
  noiseTerm,
  retrievalProbability,
} from './activation.ts'
import {
  assertNoRetiredLeak,
  contentBytes,
  countMemories,
  leakedRetiredIds,
  listRetiredIds,
  LIVE_SEARCH_SQL,
  LIVE_SELECT_SQL,
  probeFtsIndex,
  readMemoryRow,
  RETIRED_FILTER_CLAUSE,
  restoreMemory,
  retireMemory,
  searchLiveMemories,
  selectLiveMemoryById,
  sha256Hex,
  type LiveSearchResult,
  type MemoryCounts,
  type MemoryRow,
  type SoftDeleteOutcome,
} from './retirement.ts'
import {
  bigrams,
  coreSink,
  deriveMemoryId,
  prefilterWorthKeeping,
  // ⚠ `traceWrittenOf` **不在此重复 import**：它已由上面 recall-gate 的 import 带进来
  //   （同一个实现，两处 import 会 TS2300 duplicate —— 也正是"别立第二份"的编译期证据）。
  vectorizeMemory,
  writeGate,
  writeJudgeIdFor,
  WRITE_GATE_DEFAULTS,
  WRITE_GATE_DEFAULT_THRESHOLD,
  WRITE_GATE_FAILURE_KINDS,
  WRITE_GATE_JUDGE_TYPE,
  WRITE_GATE_QUESTION,
  WRITE_GATE_SOURCE,
  WRITE_GATE_STATES,
  WRITE_GATE_TRACE_EVENT,
  PREFILTER_BANK,
  PREFILTER_MIN_OVERLAP,
  type PrefilterResult,
  type WriteGateConfig,
  type WriteGateFailureKind,
  type WriteGateOutcome,
  type WriteGateSink,
  type WriteGateState,
} from './write-gate.ts'

export const name = 'mana-long-term'

/**
 * 依赖 core（方案 §9.1）。方案 §9.1 写 `core, jev, vector`。
 *
 * ⚠ **本批不追加任何新依赖**（`mana-jev` / 宿主服务都不加）。理由：本包**只经契约事件面**
 *   `mana/jev/judge` 用判定链（靠 `ctx.waterfall` 走），**不需要** jev 的服务对象；
 *   写进 `inject` 会让"没装 jev"变成**装配期停等待** —— 而判定链缺席本来就是一个**合法
 *   且可分辨**的状态（`failureKind='no-judge-listener'` + fail-open 仍写入），
 *   不该被升级成"插件起不来"。依赖方向也因此保持单向（不引 `dsh-mana-jev`）。
 */
export const inject: string[] = ['mana-core']

/**
 * 本包的**实现面**（导出名的机检清单）。
 *
 * ⚠ 它是一等判据面，不是文档：`tests/activation.test.mjs` 判据⑥ 逐个断言"是函数"，
 *   把实现搬走/改名而判据不同步 ⇒ 必红（一条反"实现被挖空"的腿）。
 */
export const IMPLEMENTED_EXPORTS = [
  'decay',
  'baseLevel',
  'associativeActivation',
  'activation',
  'noiseTerm',
  'retrievalProbability',
  'latencyMs',
] as const

/**
 * **软删除面**的实现清单（A2-6 / A2-7）——与 `IMPLEMENTED_EXPORTS` **并列不合并**。
 *
 * 为什么另起一张而不是往上面那张里加：上面那张被**两条既有判据**逐名钉死
 * （`skeleton.test.mjs:87` 长度相等、`activation.test.mjs:232` 逐名 deepEqual）。
 * 往它里面加名字会让**既有判据红**，而"改判据让它变绿"正是本仓禁止的动作。
 * ⇒ 新面独立清单 + 新面独立判据文件，旧面零改动。
 *
 * ⚠ 它是**一等判据面**：`tests/retirement.test.mjs` ① 逐个断言"是函数/是串"，
 *   把实现搬走/改名而判据不同步 ⇒ 必红（反"实现被挖空"的同一条腿）。
 *   `LIVE_SEARCH_SQL` / `LIVE_SELECT_SQL` / `RETIRED_FILTER_CLAUSE` 三个 SQL 常量**不在
 *   本清单里**（它们不是函数），但同样被 `tests/retirement.test.mjs` ① 直接断言
 *   —— 过滤腿是**被判据按字面量点名的导出**，不是躺在函数体里等人删的一行字符串。
 */
export const IMPLEMENTED_RETIREMENT_EXPORTS = [
  'retireMemory',
  'restoreMemory',
  'searchLiveMemories',
  'selectLiveMemoryById',
  'readMemoryRow',
  'countMemories',
  'listRetiredIds',
  'probeFtsIndex',
  'leakedRetiredIds',
  'assertNoRetiredLeak',
  'sha256Hex',
  'contentBytes',
] as const

/**
 * **Recall Gate 面**的实现清单（B3.2-R）——与上面两张清单**并列不合并**（同一条纪律：
 * 往既有清单里加名字会让 `skeleton.test.mjs:87` 与 `activation.test.mjs:232` 两条既有判据红，
 * 而"改判据让它变绿"正是本仓禁止的动作 ⇒ 新面独立清单 + 新面独立判据文件，旧面零改动）。
 *
 * ⚠ 它是**一等判据面**：`tests/recall-gate.test.mjs` ① 逐个断言"是函数"，把实现搬走即红。
 *   ⚠ 也登记 `RECALL_GATE_STATES` 与三个问法常量：它们是**被判据点名的字面量面**
 *   （`rel_<id>` 的问法与三态枚举若从实现里消失，判据必须红，而不是"值恰好兜住了"）。
 */
export const IMPLEMENTED_RECALL_GATE_EXPORTS = [
  'recallGate',
  'sortByLocalScore',
  // ⚠ 本批新增（c2）：判定键派生是**落痕唯一性**的真源，必须能被判据按字面量点名
  //   —— 否则「逐候选是否唯一」只能靠人读代码（同 retirement 的 SQL 常量口径）。
  'judgeIdFor',
  // ⚠ 本批新增（f3）：单射化所需的转义与反解 —— 它们把「id 唯一」从"靠调用方自觉"
  //   变成"结构上不可能"，故与派生函数同列在册（搬走任一个 ⇒ 判据红）。
  'encodeIdPart',
  'judgeIdParts',
  // ⚠ 本批 f3 收尾：**反向**不变量的读侧原语（生产者写、本模块读；`Symbol.for` 免 import）。
  'traceWrittenOf',
] as const

/**
 * **Write Gate 面**的实现清单（W1-3）——与上面三张清单**并列不合并**（同一条纪律：
 * 往既有清单里加名字会让 `skeleton.test.mjs:87` 与 `activation.test.mjs:232` 两条既有判据红，
 * 而"改判据让它变绿"正是本仓禁止的动作 ⇒ 新面独立清单 + 新面独立判据文件，旧面零改动）。
 *
 * ⚠ 它是**一等判据面**：`tests/write-gate.test.mjs` ① 逐个断言"是函数/是串"，
 *   把实现搬走/改名即红。`WRITE_GATE_STATES` / `WRITE_GATE_QUESTION` / `WRITE_GATE_JUDGE_TYPE`
 *   是**被判据点名的字面量面**：三态枚举与问法若从实现里消失，判据必须红，
 *   而不是"值恰好兜住了"（与 `RECALL_GATE_STATES` 同口径）。
 *
 * ⚠ **`traceWrittenOf` 不重复登记**（它已在上面那张 Recall Gate 的清单里）：同一个导出
 *   名字登记两次会让"这一面被挖空"的断言出现两个归属地。
 */
export const IMPLEMENTED_WRITE_GATE_EXPORTS = [
  'writeGate',
  'prefilterWorthKeeping',
  'bigrams',
  'deriveMemoryId',
  'writeJudgeIdFor',
  'coreSink',
  'traceWrittenOf',
  'WRITE_GATE_STATES',
  'WRITE_GATE_FAILURE_KINDS',
  'WRITE_GATE_SOURCE',
  'WRITE_GATE_QUESTION',
  'WRITE_GATE_JUDGE_TYPE',
  // ⚠ 留痕标签是**被判据点名的字面量面**：它冒充 S1 五类与否必须可断言。
  'WRITE_GATE_TRACE_EVENT',
  'WRITE_GATE_DEFAULT_THRESHOLD',
  'PREFILTER_BANK',
  'PREFILTER_MIN_OVERLAP',
  // ⚠ 第 ⑤ 步「向量化」的接线面同样登记为**被判据点名的实现面**：
  //   四个符号任一被搬走/改名，判据即红（反"实现被挖空"的同一条腿）。
  'VECTOR_SERVICE',
  'VECTOR_WRITE_SKIPS',
  'resolveVectorLegs',
  'vectorizeMemory',
  'vectorizeSkipReason',
] as const

/** ACT-R 纯函数面（只读）。**派生量唯一写者**在此：`A`/`B`/`decay` 只在本包计算。 */
export interface ManaLongTermActivation {
  /** 冻结参数快照（含派生量 `s = √3σ/π`）。 */
  readonly params: typeof ACTR_PARAMS
  /** `B = ln(Σ_j t_j^(-d))`，`t_j` 单位**秒**。 */
  baseLevel(practiceTimes: readonly number[], d?: number): number
  /** `S = Σ_k W_k·S_kj`。 */
  associativeActivation(sources?: readonly { weight: number; strength: number }[]): number
  /** `A = B + S + P + ε`（ε 缺省 0 = 期望值口径）。 */
  activation(opts: Parameters<typeof activation>[0]): number
  /** `ε ~ Logistic(0, s)`；`rng` 显式传入以便可复现。 */
  noiseTerm(rng?: () => number): number
  /** `P = 1/(1+exp(-(A-τ)/s))`。 */
  retrievalProbability(a: number, tau?: number, s?: number): number
  /** `lat`（毫秒）；`A < τ` 时按公式**钳到 τ**（`lat(-3) === lat(-2)`）。 */
  latencyMs(a: number, tau?: number): number
  /** 时间衰减核 `exp(-t·ln2/h)`，`t` 单位**天**。 */
  decay(t: number, halfLifeDays?: number): number
}

/**
 * 软删除 / 恢复面 —— **A2-6 / A2-7 的服务侧落点**（实现在 `retirement.ts`）。
 *
 * ⚠ 与 `ManaLongTermActivation` 并列，**不并入**它：两者判据文件不同、失效模式也不同
 *   （前者算错值，后者丢数据/漏行）。合成一个面会让"ACT-R 面绿"掩盖"检索漏行"。
 *
 * ⚠ **库句柄是显式入参**（`db`），不是本包持有的状态：`apply` 仍然不 `openManaDb`、
 *   不注册 effect ⇒ 本包"零行为"的形态面判据（⑦⑧）继续成立。
 */
export interface ManaLongTermRetirement {
  /** **软删除**：置 `retired=1`。只改位，**不发 DELETE、不删行**（§8.3）。 */
  retire(db: DatabaseSync, id: string): SoftDeleteOutcome
  /** **恢复**：置 `retired=0`。`content` 逐字节不动。 */
  restore(db: DatabaseSync, id: string): SoftDeleteOutcome
  /** **生产检索**：FTS 命中 ∩ `retired=0`（A2-7）。 */
  search(db: DatabaseSync, rawQuery: string, limit?: number): LiveSearchResult
  /** 按 id 读**未退休**记忆（带过滤腿的 id 通道）。 */
  selectById(db: DatabaseSync, id: string): MemoryRow | null
  /** 按 id 读任意行（**不过滤**，软删除原语自身取证用）。 */
  readRow(db: DatabaseSync, id: string): MemoryRow | null
  /** 库内计数三态（total / live / retired 分列）。 */
  counts(db: DatabaseSync): MemoryCounts
  /** 全部已退休 id（供**外部复核**结果里有没有退休行）。 */
  retiredIds(db: DatabaseSync): string[]
  /** ⚠ **诊断探针，不是检索入口**：直查 FTS 索引，证"退休行仍在索引里"。 */
  probeIndex(db: DatabaseSync, rawQuery: string, limit?: number): string[]
  /** 命中 ∩ 退休 id 集 —— A2-7 的外部复核口径。 */
  leaked(hits: readonly { id: string }[], retiredIds: ReadonlySet<string> | readonly string[]): string[]
  /** 检出泄漏即抛错（生产路径用：宁可炸，不可静默交出退休行）。 */
  assertNoLeak(hits: readonly { id: string }[], retiredIds: ReadonlySet<string> | readonly string[]): void
  /** `content` 的 utf8 sha256（A2-6 字节级取证原语）。 */
  hash(text: string): string
  /** `content` 的 utf8 字节数。 */
  bytes(text: string): number
  /** 生产检索 SQL 原文（**含过滤腿**；测试按此断言"腿还在"）。 */
  readonly liveSearchSql: string
  /** 按 id 读的未退休 SQL 原文。 */
  readonly liveSelectSql: string
  /** 过滤腿字面量。 */
  readonly filterClause: string
}

export interface ManaSvc {
  readonly plugin: string
  /**
   * `'skeleton'` = 本包**尚无行为**；`'active'` = 已填实现。
   *
   * B3.1 起为 `'active'`：本包已导出 7 个可复算的 ACT-R 纯函数
   * （`IMPLEMENTED_EXPORTS`，由 `tests/activation.test.mjs` 判据⑥ 逐个断言）。
   * ⚠ 仍**不**写 `mana_trace`、仍**不**落库 ⇒ "active" 的边界是「真实现存在且可机检」，
   *   **不是**「已在生产链路上生效」。把本值读成后者是误读。
   */
  status(): { plugin: string; wired: boolean; behavior: 'skeleton' | 'active' }
  /** B3.1 新增：ACT-R 纯函数面（只读，见 `ManaLongTermActivation`）。 */
  readonly activation: ManaLongTermActivation
  /**
   * **软删除 / 恢复面**（A2-6 / A2-7）。见 `ManaLongTermRetirement`。
   *
   * ⚠ 服务面**不持有库句柄**：库由调用方（core 服务）注入。
   *   本包仍是"纯函数 + 显式入参"的形态 —— 不新增 effect、不开库、不注册监听器
   *   （`skeleton.test.mjs` ⑦ 的 effect 恰好 3 条因此**不受本批影响**，实测保持 3）。
   */
  readonly retirement: ManaLongTermRetirement
  /**
   * **Recall Gate 面**（B3.2-R）——按 `rel_<id>` 逐候选走既有 `mana/jev/judge` waterfall。
   *
   * ⚠ **ctx 是显式入参**（与 `retirement` 的 `db` 同一形态）：本包**不持有** ctx、
   *   **不注册**监听器、**不写库**、**不 emit** ⇒ effect 面仍恰好 3 条、`mana_trace` 仍 0 行。
   *   ⚠ 代价（如实记）：`apply(ctx)` **无条件**注册了 `agent/pre-step` 的直通监听器（G9 要求），
   *   在该链上**无法**拿到 ctx ⇒ 本服务**不被 pre-step 链消费**；要接进 pre-step 须另开一批
   *   （届时必须重新审 effect 面与 ⑦⑧ 两条判据）。本批**不**做这件事。
   */
  recallGate(ctx: Context, req: RecallGateRequest, overrides?: Partial<RecallGateConfig>): Promise<RecallGateOutcome>
  /**
   * **Write Gate 面（W1-3）** —— 判「这条观察值不值得留」并**落库**。
   *
   * `ctx` / `db` / `sink` 三个都是**显式入参**（与 `retirement` 的 `db`、`recallGate` 的 `ctx`
   * 同一形态）：本包的服务面**不持有**库句柄、**不**自己开库 ⇒ `apply` 的 effect 面保持可数。
   *
   * ⚠ **本面是"接口"，不是"已发生"**：它被调用才产生写入。生产侧的**自动**触发是下面
   *   `status().writeGate.registered` 描述的那条 `mana/observation` 监听器；
   *   两者缺一都不能读成"写入路径是通的"。
   */
  writeGate(db: DatabaseSync, sink: WriteGateSink, obs: ManaObservation, overrides?: Partial<WriteGateConfig>): Promise<WriteGateOutcome>
  /**
   * **本包写入路径的运行期读数**（W1-3）。三态**必须可分辨**：
   *
   * | 字段 | 含义 | 读错的后果 |
   * |---|---|---|
   * | `registered` | `mana/observation` 监听器**是否已挂上** | false 而当作"都正常" ⇒ 静默 0 行 |
   * | `degradedCount` | 监听器**注册失败/写门抛错**的累计次数 | 不读它 ⇒ 失败与"没有输入"同形 |
   * | `lastFailure` | 最近一次失败的**具名真因**（无失败时 null） | 不读它 ⇒ 只能知道"有错"不知道"错在哪" |
   * | `lastState` | 最近一次判定的 `WriteGateState`（没判过时 null） | 与 `registered=false` **必须分辨**：一个是没挂上，一个是挂上了但没输入 |
   *
   * ⚠ `registered` 在 `apply` **内同步置位**（监听器直挂，不经懒挂通道）⇒ 读到 false 就是
   *   真的没挂上（`ctx.on` 抛了），不会是"还没来得及挂"。
   */
  readonly writeGateStatus: {
    registered: boolean
    degradedCount: number
    lastFailure: string | null
    lastState: WriteGateState | null
    /** 本门问法（语料面唯一真源，判据按此断言问法没被改）。 */
    question: string
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-long-term': ManaSvc
  }
}

/** 装配纯函数面。**不写库、不注册业务监听器**（见文件头 §行为面）。 */
function makeActivation(): ManaLongTermActivation {
  return Object.freeze({
    params: ACTR_PARAMS,
    baseLevel,
    associativeActivation,
    activation,
    noiseTerm,
    retrievalProbability,
    latencyMs,
    decay,
  })
}

/**
 * 装配软删除 / 恢复面（A2-6 / A2-7）。
 *
 * **同样不写库、不注册业务监听器**：每个方法都接显式 `db` 入参，本包不持有库句柄
 * ⇒ `skeleton.test.mjs` ⑦ 的 effect 面精确计数（3 条）不受影响。
 */
function makeRetirement(): ManaLongTermRetirement {
  return Object.freeze({
    retire: retireMemory,
    restore: restoreMemory,
    search: searchLiveMemories,
    selectById: selectLiveMemoryById,
    readRow: readMemoryRow,
    counts: countMemories,
    retiredIds: listRetiredIds,
    probeIndex: probeFtsIndex,
    leaked: leakedRetiredIds,
    assertNoLeak: assertNoRetiredLeak,
    hash: sha256Hex,
    bytes: contentBytes,
    liveSearchSql: LIVE_SEARCH_SQL,
    liveSelectSql: LIVE_SELECT_SQL,
    filterClause: RETIRED_FILTER_CLAUSE,
  })
}

export function apply(ctx: Context): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-long-term: 缺少 mana-core 服务（inject 未满足）')
  // ⚠ 窄化别名：下面的监听器/闭包里 `core` 会退回 `| undefined`（TS 不做跨闭包窄化），
  //   而运行期上面已抛过 ⇒ 该断言是**结构性**的，不是"应该不会"。
  const coreSvc: ManaCoreService = core

  /**
   * ── Write Gate 的运行期账目（W1-3）──────────────────────────────────────────
   * ⚠ `lastFailure` 存的是**具名真因**（不是布尔）：本仓 `mana/plugin/inactive` 全仓零消费方
   *   （见 attention 文件头的普查），故"发一条没人听的归因事件"等于没归因 ——
   *   这里改为**值本身**就是归因，且由 `status()` 与 `mana_trace` **两处**可读。
   */
  const wg = {
    registered: false,
    degradedCount: 0,
    lastFailure: null as string | null,
    lastState: null as WriteGateState | null,
  }

  const service: ManaSvc = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, behavior: 'active' }),
    activation: makeActivation(),
    retirement: makeRetirement(),
    recallGate: (ctx, req, overrides) => recallGate(ctx, req, overrides),
    // 显式入参三个（ctx/db/sink 都由调用方给）⇒ 服务面不持有库句柄。
    // ⚠ 与事件监听器走**同一条** runGate：两个入口各自记账，`writeGateStatus` 才有意义
    //   （若服务面绕过它，"手动调用"就不会进 degradedCount —— 那是两个真源）。
    writeGate: (db, sink, obs, overrides) => runGate(db, sink, obs, overrides),
    get writeGateStatus() {
      return {
        registered: wg.registered,
        degradedCount: wg.degradedCount,
        lastFailure: wg.lastFailure,
        lastState: wg.lastState,
        question: WRITE_GATE_QUESTION,
      }
    },
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-long-term', service)
    return () => dispose()
  }, 'dsh-mana-long-term: service')

  /**
   * ── 把 `perception → Write Gate → 本包(编码落库)` 接上（W1-3）──────────────────
   *
   * ⚠ **接线形态照既有先例**（`attention/src/index.ts:806`）：`apply` 内**直接**
   *   `ctx.on('mana/observation', …)`，`inject` 仍只声明 `['mana-core']`。
   *   本批**一度**写成 `ctx.inject(['mana-agent'], …)`（以为要等宿主的 agent 服务）
   *   —— 那是**错的**：`mana-agent` **全仓零命中**，是我凭空想的服务名，
   *   而 `ctx.inject` 等不到服务就**永不回调** ⇒ 监听器永远不挂、`registered` 恒 false。
   *   那正是本包最忌的形态：**接线看起来接好了、其实从不执行**。
   *   （本仓改名纪律：拿不准的服务名先用 grep 证伪，别按语义自己造一个。）
   *   ⇒ 改回直挂：`inject:['mana-core']` 满足后监听器即生效，与 attention 同一条路径。
   *
   * ⚠ **"有没有监听器"如何可观测**：cordis 的 `ctx.emit` 无接收者时**不报错、不返回计数**
   *   ⇒ 单看事件面，"监听器没挂上"与"挂了但没有输入"**同形**。故新增
   *   `status().writeGate.registered`（挂没挂）+ `lastState`（挂上了但没判过 = null）
   *   两态并读 —— 这是本仓"让失败不可观测"纪律在本门上的落点。
   *
   * ⚠ `ctx.on` **自带一条 effect**（实测：`fiber.getEffects()` 里就是
   *   `ctx.on("mana/observation")`，卸载随 fiber 释放）⇒ 无需额外 `ctx.effect` 包裹，
   *   本包的 effect 数因此由 3 → **4**（`skeleton.test.mjs` ⑦ 与 `recall-gate.test.mjs` RG-⑤
   *   已按新口径同步改写，并**逐条点名**三个旧标签仍在）。
   */
  try {
    ctx.on('mana/observation', (obs: ManaObservation) => {
      // ⚠ 监听器**同步返回**（`mana/observation` 是 emit 型，见 event-types.ts）：体内只派发，
      //   真正的判定/落库在异步链上 ⇒ `perception.perceive` 的同步栈不会被本包阻塞，
      //   本包的异常也不会冒泡进采集方（采集方不该因为"记忆写不进去"而失败）。
      void runGate(coreSvc.db, coreSink(coreSvc), obs)
    })
    wg.registered = true
  } catch (error) {
    // 注册失败必须**可读**：否则 `registered=false` 会被读成"还没挂上"（与"挂不上"同形）。
    wg.degradedCount += 1
    wg.lastFailure = 'ctx.on(mana/observation) 注册失败：' + (error instanceof Error ? error.message : String(error))
    recordFailure(wg.lastFailure)
  }

  /**
   * **本包唯一的写门入口**（服务面与事件监听器**都**走这里）。
   *
   * ⚠ 为什么必须收成一处：若监听器走一条、服务面走另一条，则
   *   `writeGateStatus.degradedCount` 只统计得到其中一条 —— 两个入口的失败就有了**两个真源**，
   *   而"从事件进来的失败看不见"正是本仓最忌的静默形态。
   *
   * ⚠ 只记账 `lastState`/`degradedCount`，**不改写 outcome**：返回值如实反映本次判定，
   *   服务面调用方拿到的仍是发`writeGate()`的原始读数（记账是旁路，不是二次加工）。
   */
  async function runGate(
    db: DatabaseSync,
    sink: WriteGateSink,
    obs: ManaObservation,
    overrides?: Partial<WriteGateConfig>,
  ): Promise<WriteGateOutcome> {
    try {
      const outcome = await writeGate(ctx, db, sink, obs, overrides)
      wg.lastState = outcome.state
      // 写门自己已经把归因放进 outcome（state / degraded / reason / failureKind）。
      // 这里只在**真的出了问题**时把它抬到服务面 + 归因面，判据是**两个可枚举量**：
      //   · failureKind !== null ⇒ 判定链那一侧坏了（抛错/无监听器/降级/落痕失败）；
      //   · state === 'unavailable' ⇒ 写面没成（含 write=false 的只判不写）。
      // ⚠ 之所以用"失败种类"而不是"有没有写行"来判：rejected / skipped_* 都是**正常**
      //   的不写（判过不值得 / 已退休 / 没过预过滤），把它们算进降级计数会让真故障被淹没。
      const failed = outcome.failureKind !== null || outcome.state === 'unavailable'
      if (failed) {
        wg.degradedCount += 1
        wg.lastFailure =
          outcome.state + ' / ' + String(outcome.failureKind) + '：' +
          String(outcome.reason === null ? '（无 reason）' : outcome.reason)
        recordFailure(wg.lastFailure)
      }
      return outcome
    } catch (error) {
      wg.degradedCount += 1
      wg.lastFailure = '写门抛错：' + (error instanceof Error ? error.message : String(error))
      recordFailure(wg.lastFailure)
      // ⚠ 抛出而不是吞掉：调用方（服务面）必须能分辨"写门自己炸了"。
      //   事件路径的调用方已经用 `void` 显式忽略了它（采集方不因记忆写不进失败），
      //   但**抛出的同时**上面已记账 ⇒ 不会静默。
      throw error
    }
  }

  /**
   * 归因落 `mana_trace`：`event_type` 用**本包自有命名空间**（`WRITE_GATE_TRACE_EVENT`）。
   *
   * ⚠ **不得写成裸名五类之一**（本批一度写 `'injection'`，是错的）：
   *   五类那五个裸名是 **S1 契约**的，`chain-e2e` 只断言「各 ≥1」（下界）⇒ 本包的降级行
   *   去冒充 `injection` 会**替真链凑数**，把"真链为什么缺这一类"掩盖掉。
   *   （与 `learning/src/trace.ts:10-15` 逐条同因。）
   */
  function recordFailure(reason: string): void {
    try {
      coreSvc.writeTrace({
        eventType: WRITE_GATE_TRACE_EVENT,
        sessionId: '',
        turnId: 0,
        payload: { plugin: WRITE_GATE_SOURCE, stage: 'write-gate', degraded: true, reason },
      })
    } catch {
      // trace 也写不成时**不抛**：本函数本身就在失败路径上，再抛会盖掉原始真因。
      // 但把失败**累加进内存计数**（degradedCount 已 +1），由 status() 可读 —— 不是静默。
    }
  }

  // G9：waterfall 直通 + next()。**无条件注册**（不得由任何配置门控，见文件头）。
  registerPassThroughPreStep(ctx, name)
}

// 公共导出面（供其它包**只读**消费；派生量写者仍只在本包）。
export { ACTR_PARAMS, HALF_LIFE_DAYS } from './params.ts'
export { decay } from './decay.ts'
export {
  activation,
  associativeActivation,
  baseLevel,
  latencyMs,
  noiseTerm,
  retrievalProbability,
} from './activation.ts'
// Recall Gate 面（B3.2-R）—— 公共导出，供其它包**只读**消费。
export {
  encodeIdPart,
  JEVD_TRACE_WRITTEN_KEY,
  judgeIdFor,
  judgeIdParts,
  recallGate,
  traceWrittenOf,
  sortByLocalScore,
  RECALL_GATE_DEFAULTS,
  RECALL_GATE_DEFAULT_THRESHOLD,
  RECALL_GATE_QUESTION,
  RECALL_GATE_SOURCE,
  RECALL_GATE_STATES,
} from './recall-gate.ts'
export { RECALL_GATE_FAILURE_KINDS } from './recall-gate.ts'
export type {
  RecallGateCandidate,
  RecallGateFailureKind,
  RecallGateConfig,
  RecallGateHit,
  RecallGateOutcome,
  RecallGateRequest,
  RecallGateState,
} from './recall-gate.ts'
// 软删除 / 恢复面（A2-6 / A2-7）—— 公共导出，供其它包**只读**消费。
export {
  assertNoRetiredLeak,
  contentBytes,
  countMemories,
  leakedRetiredIds,
  listRetiredIds,
  LIVE_SEARCH_SQL,
  LIVE_SELECT_SQL,
  probeFtsIndex,
  readMemoryRow,
  restoreMemory,
  RETIRED_FILTER_CLAUSE,
  retireMemory,
  searchLiveMemories,
  selectLiveMemoryById,
  sha256Hex,
} from './retirement.ts'
export type { LiveSearchResult, MemoryCounts, MemoryRow, SoftDeleteOutcome } from './retirement.ts'
// ── Write Gate 面（W1-3）—— 公共导出，供其它包**只读**消费 / 判据按字面量点名 ──────────
export {
  bigrams,
  coreSink,
  deriveMemoryId,
  prefilterWorthKeeping,
  vectorizeMemory,
  writeGate,
  writeJudgeIdFor,
  PREFILTER_BANK,
  PREFILTER_MIN_OVERLAP,
  WRITE_GATE_DEFAULTS,
  WRITE_GATE_DEFAULT_THRESHOLD,
  WRITE_GATE_FAILURE_KINDS,
  WRITE_GATE_JUDGE_TYPE,
  WRITE_GATE_QUESTION,
  WRITE_GATE_SOURCE,
  WRITE_GATE_STATES,
  // ⚠ 留痕标签是**被判据点名的字面量面**：它是否冒充 S1 五类必须可断言（故与实现同源导出）。
  WRITE_GATE_TRACE_EVENT,
} from './write-gate.ts'
// ── 第 ⑤ 步「向量化」的接线面（2026-09-27）——复用 vector 包既有面前的唯一落点，判据按名点名 ──
export { VECTOR_SERVICE, VECTOR_WRITE_SKIPS, resolveVectorLegs, vectorizeSkipReason } from './write-gate.ts'
export type { VectorEmbedLike, VectorLegs, VectorWriteSkip, VectorWriterLike } from './write-gate.ts'
export type {
  PrefilterResult,
  WriteGateConfig,
  WriteGateFailureKind,
  WriteGateOutcome,
  WriteGateSink,
  WriteGateState,
} from './write-gate.ts'
