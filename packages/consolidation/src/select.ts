/**
 * **Spindle 层**：按激活值降序选 Top-N（记忆选择）。
 *
 * 出处：`docs/mana-rollout-plan.md:546` B4.1 行 ③ 的「改造后用」条目 ——
 * 睡眠振荡取 **Spindle + Ripple 两层**，v10:509「按激活值降序选 Top-N」= 本文件。
 * ⚠ **SO 90 分钟节律不移植**：故本层**不收任何时间参数、不按时间分桶**，只回答
 * 「这一轮重放选哪几条」。传入周期标识 `periodId` 只为可追溯（是谁发起的这一轮）。
 *
 * ⚠ **本层不做相似度判断**：选择（Spindle）与比对/合并（Ripple，见 `consolidate.ts`）
 * 必须分得开 —— 二是同一机制的两层，混成一个函数后就无法分别证伪。
 */
import { CONSOLIDATION_PARAMS } from './params.ts'

/** 参与选择的一条记忆项（字段取自 `memory_items`；本层**只读**，不写库）。 */
export interface SelectableMemory {
  readonly id: string
  /** ACT-R 激活值 `A`。⚠ 由 long-term 计算（B3.1 ② 派生量唯一写者）——本包只消费。 */
  readonly activation: number
  /** 嵌入向量；`null`/`undefined` = 未嵌入（Ripple 层会显式跳过，不静默当正交）。 */
  readonly vector?: ArrayLike<number> | null
  readonly content?: string
  readonly type?: string
  /** 已退休（含已被合并走）的项不参与重放。 */
  readonly retired?: boolean
}

/** 未选中项须带**原因**（G8）：`retired` / `non_finite_activation` / `rank_below_top_n`。 */
export type SkipReason = 'retired' | 'non_finite_activation' | 'rank_below_top_n'

export interface SpindleSelection {
  readonly periodId: string
  /** 调用方要求的 N（原样回显，便于断言「用了传入的 N」而不是缺省值）。 */
  readonly requestedN: number
  readonly selected: readonly SelectableMemory[]
  readonly skipped: readonly { readonly id: string; readonly reason: SkipReason; readonly detail?: string }[]
  /** 候选总数（含被跳过的），使「N=0」与「候选为空」可分辨。 */
  readonly population: number
}

/** 按激活值降序、同值按 id 升序 —— **全序**，使同输入必得同输出（可复算）。 */
function compareActivation(a: SelectableMemory, b: SelectableMemory): number {
  if (b.activation !== a.activation) return b.activation - a.activation
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 选择。
 *
 * @param periodId 本轮重放周期标识（可追溯用；**无语义**，不参与计算）
 * @param items    候选记忆项
 * @param n        Top-N 的上界；缺省 `CONSOLIDATION_PARAMS.SPINDLE_TOP_N`
 *
 * `n <= 0` ⇒ 选中集为空（**不是**「返回全部」）：0 是有意义的上界 = 本轮不重放，
 * 把它解释成"没有限制"是本仓反复出现的静默反转。
 */
export function selectTopN(
  periodId: string,
  items: readonly SelectableMemory[],
  n: number = CONSOLIDATION_PARAMS.SPINDLE_TOP_N,
): SpindleSelection {
  const skipped: { id: string; reason: SkipReason; detail?: string }[] = []
  const eligible: SelectableMemory[] = []
  for (const item of items) {
    if (item.retired === true) {
      skipped.push({ id: item.id, reason: 'retired' })
      continue
    }
    if (!Number.isFinite(item.activation)) {
      skipped.push({ id: item.id, reason: 'non_finite_activation', detail: String(item.activation) })
      continue
    }
    eligible.push(item)
  }
  eligible.sort(compareActivation)
  const take = Math.max(0, Math.trunc(n))
  const selected = eligible.slice(0, take)
  for (const item of eligible.slice(take)) {
    skipped.push({ id: item.id, reason: 'rank_below_top_n' })
  }
  return { periodId, requestedN: n, selected, skipped, population: items.length }
}
