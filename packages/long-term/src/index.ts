/**
 * `dsh-mana-long-term` —— Mana 长时记忆：编码 + ACT-R 激活方程 + 三路混合检索
 *
 * ── 当前状态：**B3.1 已填实现**（本条与下面的历史记录并列，不覆盖）─────────────────────
 * 本包曾长期是 74 行"诚实的空壳"。B3.1 落地了 **ACT-R 激活方程 + 时间衰减**，
 * 故 `status().behavior` 由 `'skeleton'` 改为 **`'active'`**（改为据实现事实回报，见下 §行为面）。
 * 尚未实现（仍属后续批次，**不得**读作已完成）：三道门控（B3.2）、三路混合检索（B3.2）、
 *   落库写入（`base_level_activation` 列的写者）、`S` 的 Pavlik–Anderson 更新（B4.2）。
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
 * ── 行为面（B3.1 的覆盖边界，如实声明）─────────────────────────────────────────────
 * B3.1 的交付是**纯计算**：不写 `mana_trace`、不落库、不注册业务监听器。
 * 故 `skeleton.test.mjs` 判据⑦（effect 面恰好 3 条）与 ⑧（`mana_trace` 0 行）**仍然成立**，
 * 无需改动 —— 见 `docs/handoff/S14.md` §4 对"⑦⑧要不要改"的逐条判断。
 * ⚠ 诚实边界：`behavior: 'active'` 目前**没有任何判据强制它**（这正是 R2b 说的"反向不可机检"）。
 *   本包新增了 `tests/activation.test.mjs` 判据⑥：**导出面被挖空即红** —— 它覆盖的是
 *   "实现被搬走"，**不**覆盖"实现还在而 behavior 写回 skeleton"。后者仍是盲区，未修。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { DatabaseSync } from 'node:sqlite'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import { ACTR_PARAMS } from './params.ts'
import { decay } from './decay.ts'
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

export const name = 'mana-long-term'

/** 依赖 core（方案 §9.1）。方案 §9.1 写 `core, jev, vector`；本轮仍未接线 ⇒ 先只声明 core，接线期再追加（避免装配期停 waiting）。 */
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

  const service: ManaSvc = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, behavior: 'active' }),
    activation: makeActivation(),
    retirement: makeRetirement(),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-long-term', service)
    return () => dispose()
  }, 'dsh-mana-long-term: service')

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
