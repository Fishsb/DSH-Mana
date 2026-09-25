/**
 * **SOAR chunking**：把反复出现的算子序列压成一条**程序性规则**（B4.1 行「chunking 重复 ≥2」）。
 *
 * 触发条件（判据原文，`docs/mana-rollout-plan.md:546` 引方案 §5.2）：
 *   ① 子目标 `active→done`（由**调用方**筛选后传入 —— 本包不读 goals 表，见文件尾「边界」）；
 *   ② 算子序列长度 **≤ `MAX_OPERATOR_SEQUENCE`（7）**；
 *   ③ 同一模式重复 **≥ `MIN_PATTERN_REPEATS`（2）**。
 *
 * ⚠ **三个数字都从 `params.ts` 取，本文件零字面量** —— 改阈值必须改一处，
 *   否则「改 7 → 8 判据必红」这条负向对拍就变成了改两处才红（对拍会假绿）。
 *
 * ⚠ **本层不写库**：产出的是**草稿**（`ProductionRuleDraft`），落库在 `rules.ts`（唯一写者）。
 *
 * ── 边界（如实声明，不许读成已覆盖）──────────────────────────────────────────────
 * · **不做语义等价归并**：签名按算子序列的**逐字相等**取（`["a","b"]` 与 `["b","a"]` 是两组）。
 *   语义等价归并需要算子词表与等价关系，本批无着落 ⇒ 未实现，且**不得**用「大致相似」冒充。
 * · **不做加速率测量**：判据 `A3-3`（Chunking 加速）在册上写明「待定，需首测后自设」，
 *   故本批只给**闭式可复算的压缩比** `seen/rules`（N 次出现压成 1 条规则），
 *   **不声称**任何性能收益 —— 声称了就是拿无基线的数当阈值。
 */
import { CONSOLIDATION_PARAMS } from './params.ts'
import type { CosineFn } from './vector-cosine.ts'

/** 一次已完成子目标的过程记录（算子序列）。字段取自 `goals`/`mana_trace` 的口径。 */
export interface OperatorRun {
  /** 唯一 id（可为 trace seq 的字符串化）。 */
  readonly id: string
  readonly goalId: string
  /** 算子序列（有序）。 */
  readonly steps: readonly string[]
  readonly endedAt: string
}

/** 落 `production_rules` 的草稿。⚠ **列名与 `packages/core/src/schema.ts:64` 的 DDL 逐字对齐**——不得臆造。 */
export interface ProductionRuleDraft {
  readonly id: string
  /** `conditions` 列（TEXT NOT NULL）：本规则的适用条件（JSON 文本）。 */
  readonly conditions: string
  /** `actions` 列（TEXT NOT NULL）：被压缩的算子序列（JSON 文本）。 */
  readonly actions: string
  /** `source_goal_id` 列（TEXT，可空）：来源子目标。 */
  readonly sourceGoalId: string
  /** `created_at` 列（TEXT NOT NULL）：ISO 时刻。 */
  readonly createdAt: string
}

export type DropReason = 'too_long' | 'below_repeats'

export interface ChunkingPlan {
  /** 出现过的过程总数（含被丢掉的）。 */
  readonly seen: number
  /** 通过长度闸、进入分组的过程数。 */
  readonly grouped: number
  readonly rules: readonly ProductionRuleDraft[]
  /** 被丢掉的**带原因**（G8：「没成规则」必须能说清是哪一种没成）。 */
  readonly dropped: readonly { readonly runId: string; readonly reason: DropReason; readonly detail: string }[]
  readonly stats: {
    readonly patterns: number
    readonly rules: number
    /** 压缩比 = 分组内过程数 / 规则数；无规则时 `null`（**不是 0**，0 会把"没压"说成"压没了"）。 */
    readonly compression: number | null
  }
}

/** FNV-1a 32 位：**确定性** id 生成（同一模式必得同一 id ⇒ 重跑幂等、可复算）。 */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 模式签名：算子序列的**规范化**文本（去首尾空白、用 \u0001 分隔）。全序、无歧义。 */
export function signatureOf(steps: readonly string[]): string {
  return steps.map((s) => s.trim()).join('\u0001')
}

/** 触发条件②：序列长度 ≤ 上限。**返回 boolean 而不是抛错**（超长是正常输入，不是异常）。 */
export function isCandidateSequence(
  steps: readonly string[],
  maxSteps: number = CONSOLIDATION_PARAMS.MAX_OPERATOR_SEQUENCE,
): boolean {
  return steps.length > 0 && steps.length <= maxSteps
}

/**
 * 按重复次数把过程压成规则草稿。
 *
 * @param runs     已完成子目标的过程（**调用方须已按 ①「子目标 active→done」筛过**）
 * @param minRepeats 重复阈值，缺省 `MIN_PATTERN_REPEATS`（2）
 * @param maxSteps   长度上限，缺省 `MAX_OPERATOR_SEQUENCE`（7）
 * @param cosine / @param noveltyThreshold —— **语义归并未实现**：二者是留给后续批次的**显式空位**，
 *   本批传什么都**不改变输出**（这点由判据的「空位不得改变输出」用例钉住，防它们变成假旋钮）。
 */
export function chunkSequences(
  runs: readonly OperatorRun[],
  opts: {
    readonly minRepeats?: number
    readonly maxSteps?: number
    readonly cosine?: CosineFn
    readonly noveltyThreshold?: number
    readonly at?: string
  } = {},
): ChunkingPlan {
  const minRepeats = opts.minRepeats ?? CONSOLIDATION_PARAMS.MIN_PATTERN_REPEATS
  const maxSteps = opts.maxSteps ?? CONSOLIDATION_PARAMS.MAX_OPERATOR_SEQUENCE
  const createdAt = opts.at ?? new Date().toISOString()

  const dropped: { runId: string; reason: DropReason; detail: string }[] = []
  const groups = new Map<string, OperatorRun[]>()
  for (const run of runs) {
    if (!isCandidateSequence(run.steps, maxSteps)) {
      dropped.push({ runId: run.id, reason: 'too_long', detail: `长度 ${run.steps.length} > 上限 ${maxSteps}` })
      continue
    }
    const sig = signatureOf(run.steps)
    const bucket = groups.get(sig)
    if (bucket) bucket.push(run)
    else groups.set(sig, [run])
  }

  const rules: ProductionRuleDraft[] = []
  for (const [sig, members] of groups) {
    if (members.length < minRepeats) {
      for (const m of members) {
        dropped.push({ runId: m.id, reason: 'below_repeats', detail: `重复 ${members.length} < 阈值 ${minRepeats}` })
      }
      continue
    }
    // 来源子目标与算子序列取**排序后第一条**（全序 ⇒ 与输入顺序无关 ⇒ 可复算）
    const ordered = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const head = ordered[0] as OperatorRun
    rules.push({
      id: `rule-${fnv1a(sig).toString(16).padStart(8, '0')}`,
      conditions: JSON.stringify({ pattern: 'operator-sequence', signature: sig, steps: head.steps, repeats: members.length }),
      actions: JSON.stringify({ kind: 'replay-sequence', steps: head.steps }),
      sourceGoalId: head.goalId,
      createdAt,
    })
  }
  rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const grouped = runs.length - dropped.filter((d) => d.reason === 'too_long').length
  return {
    seen: runs.length,
    grouped,
    rules,
    dropped,
    stats: {
      patterns: groups.size,
      rules: rules.length,
      compression: rules.length > 0 ? grouped / rules.length : null,
    },
  }
}
