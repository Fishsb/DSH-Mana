/**
 * **Ripple 层**：对 Top-N 逐条重放 —— 重新激活 → 与新皮层语义记忆比对 → 相似度判定。
 *
 * 出处：`docs/mana-rollout-plan.md:546` B4.1 行 ③（v10:511 逐条重放）与同行的
 * 「相似度 **≥0.7** 合并」。两条是同一件事：**相似 ⇒ 合并 / 新颖 ⇒ 建新关联**。
 *
 * ⚠ **阈值来自 `params.ts`，本文件不写字面量**（唯一出处）；`similarity` 由**调用方注入的
 * `cosine`** 计算 —— 本包不自己实现余弦（口径复用 `packages/vector`，见 `vector-cosine.ts`）。
 * 这使"换一份余弦"与"换一个阈值"在判据里是**两件可分别证伪的事**。
 *
 * ⚠ **本层不写库**：合并/新颖只是**计划**（`MergePlan`）。落库是唯一写者的事
 * （规则落 `production_rules`、轨迹落 `mana_trace`，见 `index.ts` 与 `rules.ts`）。
 * 把"判定"与"写入"分开，是为了让判定的判据能在**零副作用**下跑（否则夹具测试会污染真库）。
 */
import { CONSOLIDATION_PARAMS } from './params.ts'
import type { CosineFn } from './vector-cosine.ts'
import type { SelectableMemory } from './select.ts'

/** 新皮层语义记忆（已巩固的项；Ripple 拿它作比对靶）。 */
export interface NeocortexEntry {
  readonly id: string
  readonly vector: ArrayLike<number> | null | undefined
  readonly content?: string
}

/** 一条重放结论。 */
export type RippleVerdict =
  | {
      readonly kind: 'merge'
      readonly memoryId: string
      /** 并入的靶（新皮层项 id）。 */
      readonly intoId: string
      readonly similarity: number
    }
  | {
      readonly kind: 'novel'
      readonly memoryId: string
      readonly reason: 'no_neocortex' | 'below_threshold'
      /** 最高相似度；无靶可依时为 `null`（**不是 0** —— 「没比过」与「比了得 0」必须可分辨）。 */
      readonly bestSimilarity: number | null
      readonly bestId: string | null
    }
  | {
      readonly kind: 'skipped'
      readonly memoryId: string
      readonly reason: 'no_vector'
    }

export interface MergePlan {
  readonly periodId: string
  readonly threshold: number
  readonly verdicts: readonly RippleVerdict[]
  /** 比对靶里**无向量**被跳过的条数（并入 skipped，使靶侧缺口可见）。 */
  readonly skippedNeocortex: readonly { readonly id: string; readonly reason: 'no_vector' }[]
  readonly stats: {
    readonly replayed: number
    readonly merged: number
    readonly novel: number
    readonly skipped: number
  }
}

export interface RippleInput {
  readonly periodId: string
  /** Top-N（Spindle 层的产出）。 */
  readonly selected: readonly SelectableMemory[]
  /** 新皮层靶集合。 */
  readonly neocortex: readonly NeocortexEntry[]
  /** **注入**的余弦（口径复用；不注入 = 本层无法判定，调用方必须显式提供）。 */
  readonly cosine: CosineFn
  /** 阈值缺省 `CONSOLIDATION_PARAMS.MERGE_SIMILARITY`（0.7）。 */
  readonly similarityThreshold?: number
}

function hasVector(v: ArrayLike<number> | null | undefined): v is ArrayLike<number> {
  return v !== null && v !== undefined && v.length > 0
}

/**
 * 逐条重放。**判定口径**：
 * · 本项无向量 ⇒ `skipped(no_vector)`（**不得**当成"与所有靶都正交"）；
 * · 靶集合为空 ⇒ `novel(no_neocortex)`，`bestSimilarity = null`；
 * · 否则取**最高**相似度 `s*`：`s* >= threshold` ⇒ `merge`；`s* < threshold` ⇒ `novel(below_threshold)`。
 *
 * ⚠ 边界取 **≥**（判据原文「相似度 ≥0.7 合并」），故 `s* === 0.7` 必须**合并** ——
 * 这条边界由 `tests/b41-fixed-points.test.mjs` 用**能算到恰好 0.7 的整数夹具**钉住。
 */
export function ripple(input: RippleInput): MergePlan {
  const threshold = input.similarityThreshold ?? CONSOLIDATION_PARAMS.MERGE_SIMILARITY
  const targets: NeocortexEntry[] = []
  const skippedNeocortex: { id: string; reason: 'no_vector' }[] = []
  for (const entry of input.neocortex) {
    if (hasVector(entry.vector)) targets.push(entry)
    else skippedNeocortex.push({ id: entry.id, reason: 'no_vector' })
  }

  const verdicts: RippleVerdict[] = []
  let merged = 0
  let novel = 0
  let skipped = 0
  for (const item of input.selected) {
    if (!hasVector(item.vector)) {
      verdicts.push({ kind: 'skipped', memoryId: item.id, reason: 'no_vector' })
      skipped += 1
      continue
    }
    if (targets.length === 0) {
      verdicts.push({ kind: 'novel', memoryId: item.id, reason: 'no_neocortex', bestSimilarity: null, bestId: null })
      novel += 1
      continue
    }
    let bestId: string | null = null
    let bestSim = Number.NEGATIVE_INFINITY
    for (const target of targets) {
      const sim = input.cosine(item.vector, target.vector as ArrayLike<number>)
      // 同分取 id 升序（全序 ⇒ 可复算；不得依赖 Object/Map 的遍历顺序）
      if (sim > bestSim || (sim === bestSim && bestId !== null && target.id < bestId)) {
        bestSim = sim
        bestId = target.id
      }
    }
    if (bestId !== null && bestSim >= threshold) {
      verdicts.push({ kind: 'merge', memoryId: item.id, intoId: bestId, similarity: bestSim })
      merged += 1
    } else {
      verdicts.push({
        kind: 'novel',
        memoryId: item.id,
        reason: 'below_threshold',
        bestSimilarity: Number.isFinite(bestSim) ? bestSim : null,
        bestId,
      })
      novel += 1
    }
  }
  return {
    periodId: input.periodId,
    threshold,
    verdicts,
    skippedNeocortex,
    stats: { replayed: input.selected.length, merged, novel, skipped },
  }
}
