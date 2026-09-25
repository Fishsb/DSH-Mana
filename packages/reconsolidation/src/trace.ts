/**
 * **本包自有命名空间**的 trace 标签 —— 留痕用。
 *
 * ── 为什么要单独一个模块 + 单独一套常量（三条，逐条有理由）─────────────────────────────
 *   ① **不得冒充 S1 五类**：core `domain.ts` 的 `MANA_STAGES` =
 *      observation / attention / decision / recall / injection —— 那是 **S1 的判据面**
 *      （A1-1 端到端事件链按它们计数）。本包的"窗口开了/关了/降级了"**不是**认知阶段，
 *      写进那五类会**污染 S1 的计数**，把判据变成"数得更多"的假绿。
 *      ⇒ 本包一律用 `mana-reconsolidation/` 前缀（见 `OWNED_TRACE_PREFIX`）。
 *   ② **前缀可机检**：判据读回 `mana_trace` 里本包写入的行，断言**每一行** `event_type`
 *      都带该前缀。写成自然语言约定（"我们用 rcn/xxx"）就只是注释，没有牙。
 *   ③ `connector ('/')`：与 DSH 的 `mana/observation` 形态同构（前缀 + 分段），
 *      不与任何既有标签撞名（全仓 grep 证据见 handoff）。
 */

/** 本包写 `mana_trace.event_type` 时**必须**带的唯一前缀（判据逐行核）。 */
export const OWNED_TRACE_PREFIX = 'mana-reconsolidation/' as const

export const TRACE_EVENTS = Object.freeze({
  /** 窗口开启（去稳定化开始）。 */
  windowOpened: 'mana-reconsolidation/window-opened',
  /** 窗口关闭（重新稳定化）。 */
  windowClosed: 'mana-reconsolidation/window-closed',
  /** 内容更新（含旧值/新值的可追溯记录）。 */
  contentUpdated: 'mana-reconsolidation/content-updated',
  /** **降级留痕**：条件不具备（如两列缺失）而**未执行**的动作。 */
  degraded: 'mana-reconsolidation/degraded',
})

export type TraceEvent = (typeof TRACE_EVENTS)[keyof typeof TRACE_EVENTS]

/** 本包写入的**全部**标签（判据按它核集合，而不是"抽查几个"）。 */
export const OWNED_TRACE_EVENTS: readonly string[] = Object.freeze(Object.values(TRACE_EVENTS))

/** 标签是否在本包命名空间内。 */
export function isOwnedTraceEvent(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(OWNED_TRACE_PREFIX)
}

/**
 * S1 五类（core `domain.ts:MANA_STAGES`）的**副本**，只用于「不得冒充」的负向判据。
 *
 * ⚠ 为什么这里敢抄一份：它是**负向对照表**，不是真源。真源在 `mana-core` 的
 *   `MANA_STAGES`；本表若与真源漂移，效果是**负向判据变松**（漏抓冒充）——
 *   故判据侧**同时**读真源（`mod.MANA_STAGES`）与本表，两者都必须不被命中。
 */
export const S1_STAGE_TAGS: readonly string[] = Object.freeze([
  'observation',
  'attention',
  'decision',
  'recall',
  'injection',
] as const)
