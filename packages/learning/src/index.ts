/**
 * `dsh-mana-learning` —— Mana 学习链：**Hebbian 共激活 → 关联强度**（L-03，**不含 FSRS**）。
 *
 * 真源：`docs/mana-v10-landing-plan.md:137-147`（L-03 行）：
 *   目标「两个记忆在 **5 分钟窗口**内被同时激活 ⇒ 增加关联强度」（v10 §12.6 / §17.1 路径二），
 *   落进 `memory_items.related_ids`（`packages/core/src/schema.ts:59` 实测该列存在）。
 *
 * ── 实现面（`src/`，判据在 `tests/l03-hebbian.test.mjs`）────────────────────────────
 *  · `params.ts`       —— η=0.01、窗口 5 分钟、权重容差的**唯一出处**（C14 唯一写者）
 *  · `window.ts`       —— 共激活检测：时间簇 + occasion 定义 + 窗口闭区间边界（判据 ②/③）
 *  · `hebbian.ts`      —— `Δw = η·x_i·x_j` 与闭式期望 `w_N = w_0 + N·η`（判据 ①/③）
 *  · `store-format.ts` —— **`related_ids` 的编码格式定义**（此前该列无写者、无格式）
 *  · `store.ts`        —— 落库（唯一写者）+ 列缺失三态 + 四条显式拒绝
 *  · `trace.ts`        —— 降级留痕（命名空间 `mana/learning/*`，**不侵占 S1 五类**）
 *
 * ── ⚠ 与既有实现的关系：**判据先查过，不是推测**（本仓已有「三套衰减公式并存」的教训）──
 *  ① **`long-term` 的 ACT-R 面（`associativeActivation`）= 同一件事的「读」阶段**：
 *     实测 `packages/long-term/src/activation.ts:66` 是 `Σ W_k·S_kj` —— **只读**，
 *     且它的 `W_k` **全仓无产出者**（`related_ids` 此前无写者）。
 *     ⇒ 本包做的是**它的上游写面**，一个 `weight`、两个阶段；**不是两套关联强度**。
 *     故本包不导出任何 `activation`/`decay` 形状的名字（测试 ⑧ 有命名空间腿钉住）。
 *  ② **`forgetting/src/strength.ts` 的 Pavlik `ΔS` = 另一个状态量**：
 *     实测该式**不含时间项**、更新的是**单条记忆自己的**强度（落 `memory_items.strength`）；
 *     本包更新**一对记忆之间**的权重（落 `related_ids`）。状态变量不同（节点 vs 边）⇒
 *     `η` 与 `a/b/S_max` 不可互代。本包**不 import 也不重实现** Pavlik。
 *  ③ **`consolidation` 的 chunking（B4.1）= 把「算子序列」压成「程序性规则」**：
 *     实测 `packages/consolidation/src/chunking.ts` 产出 `ProductionRuleDraft` 落
 *     `production_rules` 表，**不碰 `memory_items.related_ids`**，也不做任何共激活检测。
 *     ⇒ 两者**不同层、不同表、不同输入**：chunking 是「序列 → 规则」（程序性记忆），
 *     本包是「共现 → 边权」（陈述性记忆的关联面）。**无重叠、无先后依赖**，
 *     故本批**不接线**（L-03 的依赖行里 B4.1 只被列为「在途」）。
 *  ⇒ 结论：本包**新建**，不新增任何「同一条记忆被两家乘过」的通道（C14）。
 *
 * ── ⛔ 明确不做（与 `docs/mana-v10-landing-plan.md:145` 的边界行逐字一致）──────────
 *  · **不做 FSRS**（评审已裁定：与已冻结的 A1-5 `decay(14)=0.500000` 冲突；
 *    落地册 C14 正要求衰减公式**收敛为一套**）—— 本包**不含任何时间衰减核**；
 *  · **不新建 `fsrs_schedule` 表**；**不写任何 DDL**（schema 归 core）；
 *  · **不改 `long-term/src/decay.ts`**（那是 A1-5 的实现者）—— 本包零改动他包。
 *
 * ⚠ **本包不导出 `Config`**（与 `long-term` / `consolidation` 三个骨架同口径）：
 *   本轮新增的能力全是**纯函数 + 显式 `db` 入参**，没有真旋钮可关。
 *   若哪天确需配置，必须同时补一条「该配置改变了可观测行为」的判据 —— 否则即
 *   `long-term/src/index.ts:41-48` 抓到的「假旋钮」形态（`enabled=false` 与 `true` 完全同形）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { DatabaseSync } from 'node:sqlite'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import { COACTIVATION_WINDOW_MS, ETA, LEARNING_PARAMS } from './params.ts'
import { clusterEvents, findCoActivations, gapMs, isWithinWindow, sameActivationWindow } from './window.ts'
import { assertPair, closedFormWeight, mergeWeights, pairDelta } from './hebbian.ts'
import { encodeRelated, parseRelatedIds, weightOf } from './store-format.ts'
import { applyCoActivations, linkPair, probeRelatedIdsColumn, readRelatedIds } from './store.ts'
import { GATE_FALLBACK, listDegradationRows, recordDegradation, TRACE_EVENT_DEGRADED, TRACE_EVENT_PREFIX } from './trace.ts'

export const name = 'mana-learning'

/** 依赖 core（方案 §9.1）。本包**不**声明 `long-term`/`forgetting`/`consolidation`：
 *  与它们是**只读的数学关系**（判据在文件头），不是装配依赖 —— 声明了会让装配期停 waiting。 */
export const inject: string[] = ['mana-core']

/**
 * 本包的**实现面**（导出名的机检清单）。
 *
 * ⚠ 它是一等判据面，不是文档：`tests/l03-hebbian.test.mjs` ⑧ 逐个断言「是函数」，
 *   把实现搬走/改名而判据不同步 ⇒ 必红（一条反「实现被挖空」的腿）。
 *   与 `long-term` 的 `IMPLEMENTED_EXPORTS` 同形，且**独立成清单**：本包与他包的
 *   清单互不覆盖，改一处不会让另一处跟着变。
 */
export const IMPLEMENTED_EXPORTS = [
  // window.ts —— 共激活检测
  'findCoActivations',
  'clusterEvents',
  'isWithinWindow',
  'sameActivationWindow',
  'gapMs',
  // hebbian.ts —— 权重更新
  'pairDelta',
  'closedFormWeight',
  // store-format.ts —— 落点列的编码
  'parseRelatedIds',
  'encodeRelated',
  'weightOf',
  // store.ts —— 落库
  'applyCoActivations',
  'probeRelatedIdsColumn',
  'readRelatedIds',
] as const

/** 冻结参数快照（只读）。**判据读它**（而不是自己去 import params）以机检「服务面与实现同源」。 */
export interface ManaLearningSvc {
  readonly plugin: string
  /**
   * `'skeleton'` = 本包尚无行为；`'active'` = 已填实现。
   *
   * ⚠ **与 `long-term` 的 `behavior` 语义分辨率不同，故刻意不写 `active`**：
   *   `long-term` 判 `'active'` 的那条腿（`tests/skeleton.test.mjs` ⑦）断言的是
   *   **effect 面恰好 3 条 + `mana_trace` 0 行**——即「本包零行为」。而本包**有真行为**
   *   （降级时写 `mana/learning/*` 行），把 `'skeleton'` 读成「没实现」会掩盖这个事实。
   *   ⇒ 本包**不用那个二值枚举**：行为面由 `behaviors`（下面）**逐条列出**，
   *     不留一个可以被误读的单词。`schemas` 同时给出。
   */
  status(): {
    readonly plugin: string
    readonly wired: boolean
    /** 本包真有的行为面（逐条，不是布尔）。 */
    readonly behaviors: readonly string[]
    /** 本包会写的 `mana_trace.event_type`（空数组 = 不写 —— **必须是显式空，不是缺字段**）。 */
    readonly traceEvents: readonly string[]
  }
  /** η / 窗口 / 容差的冻结快照（唯一出处 `params.ts`）。 */
  readonly params: typeof LEARNING_PARAMS
  /** 共激活检测面。 */
  readonly window: {
    findCoActivations(events: readonly { id: string; at: number }[], windowMs?: number): ReturnType<typeof findCoActivations>
    clusterEvents(events: readonly { id: string; at: number }[], windowMs?: number): ReturnType<typeof clusterEvents>
    isWithinWindow(gap: number, windowMs?: number): boolean
    sameActivationWindow(tA: number, tB: number, windowMs?: number): boolean
    gapMs(tA: number, tB: number): number
  }
  /** 权重面。 */
  readonly hebbian: {
    pairDelta(xI?: number, xJ?: number, eta?: number): number
    closedFormWeight(w0?: number, n?: number, eta?: number, cap?: number): number
    mergeWeights(rows: readonly { id: string; weight: number }[]): ReturnType<typeof mergeWeights>
    assertPair(i: string, j: string): readonly [string, string]
  }
  /** 落点列格式面。 */
  readonly format: {
    parseRelatedIds(raw: string | null | undefined): ReturnType<typeof parseRelatedIds>
    encodeRelated(entries: readonly { id: string; weight: number }[]): string
    weightOf(items: readonly { id: string; weight: number }[], id: string): number | null
  }
  /** 落库面 —— `related_ids` 的**唯一写者**（`db` 是显式入参，本包不持有库句柄）。 */
  readonly store: {
    applyCoActivations(db: DatabaseSync, events: readonly { id: string; at: number }[], opts?: Parameters<typeof applyCoActivations>[2]): ReturnType<typeof applyCoActivations>
    linkPair(db: DatabaseSync, i: string, j: string, n?: number, opts?: Parameters<typeof linkPair>[4]): ReturnType<typeof linkPair>
    probeRelatedIdsColumn(db: DatabaseSync): ReturnType<typeof probeRelatedIdsColumn>
    readRelatedIds(db: DatabaseSync, id: string): ReturnType<typeof readRelatedIds>
  }
  /** 降级留痕面。 */
  readonly trace: {
    recordDegradation(core: ManaCoreService | undefined, notice: { reason: string; ids?: readonly string[] }, at?: string): ReturnType<typeof recordDegradation>
    listDegradationRows(db: DatabaseSync): ReturnType<typeof listDegradationRows>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-learning': ManaLearningSvc
  }
}

/** 装配纯函数/落库面。**不写库、不开库、不注册业务监听器**（`db` 一律显式入参）。 */
function makeService(): Omit<ManaLearningSvc, 'status' | 'plugin'> {
  return Object.freeze({
    params: LEARNING_PARAMS,
    window: Object.freeze({ findCoActivations, clusterEvents, isWithinWindow, sameActivationWindow, gapMs }),
    hebbian: Object.freeze({ pairDelta, closedFormWeight, mergeWeights, assertPair }),
    format: Object.freeze({ parseRelatedIds, encodeRelated, weightOf }),
    store: Object.freeze({ applyCoActivations, linkPair, probeRelatedIdsColumn, readRelatedIds }),
    trace: Object.freeze({ recordDegradation, listDegradationRows }),
  })
}

export function apply(ctx: Context): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-learning: 缺少 mana-core 服务（inject 未满足）')

  const service: ManaLearningSvc = {
    plugin: name,
    status: () => ({
      plugin: name,
      wired: true,
      behaviors: [
        '共激活检测（时间簇 + occasion，窗口闭区间）',
        'Hebbian 权重更新 Δw = η·x_i·x_j 与闭式期望',
        'related_ids 落库（唯一写者；纯函数 + 显式 db 入参）',
        '降级留痕（列缺失时写 mana/learning/related_ids_unavailable）',
      ],
      traceEvents: [TRACE_EVENT_DEGRADED],
    }),
    ...makeService(),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-learning', service)
    return () => dispose()
  }, 'dsh-mana-learning: service')

  // G9：waterfall 直通 + next()。**无条件注册**（不得由任何配置门控，与其余包同一条结构约束）。
  registerPassThroughPreStep(ctx, name)
}

// 公共导出面（供其它包**只读**消费；η/窗口的写者仍只在本包）。
export { COACTIVATION_WINDOW_MINUTES, COACTIVATION_WINDOW_MS, ETA, LEARNING_PARAMS, WEIGHT_EPS } from './params.ts'
export { canonicalPair, clusterEvents, findCoActivations, gapMs, isWithinWindow, sameActivationWindow } from './window.ts'
export { assertPair, closedFormWeight, mergeWeights, pairDelta } from './hebbian.ts'
export { encodeRelated, MISSING_COLUMN_REASON, parseRelatedIds, weightOf } from './store-format.ts'
export { applyCoActivations, linkPair, probeRelatedIdsColumn, readRelatedIds } from './store.ts'
export { GATE_FALLBACK, listDegradationRows, recordDegradation, TRACE_EVENT_DEGRADED, TRACE_EVENT_PREFIX } from './trace.ts'
export type { ActivationEvent, CoActivation, CoActivationScan, DroppedEvent, TimeCluster } from './window.ts'
export type { Pair } from './hebbian.ts'
export type { ParsedRelatedIds, RelatedEntry } from './store-format.ts'
export type { ApplyOptions, ColumnProbe, LinkOutcome, PairWrite, RelatedRead } from './store.ts'
export type { DegradationNotice, TraceOutcome } from './trace.ts'
