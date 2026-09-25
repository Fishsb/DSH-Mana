/**
 * **Hebbian 权重更新**（L-03 判据 ①/③ 的实现者）—— `Δw = η · x_i · x_j`，纯函数、无 IO。
 *
 * 真源：`docs/mana-v10-landing-plan.md:141`（L-03 目标）+ `:144`（判据 ① 学习率 η=0.01）。
 *
 * ── ⚠ 与 `long-term` 的关系：**同一件事的两个阶段**（读 vs 写），不是两套公式 ─────────
 *   本包**先读**了 `packages/long-term/src/activation.ts:66` 的
 *   `associativeActivation(sources) = Σ_k W_k·S_kj`（v5:341-343）。判据：
 *     · 它**只读**：入参是 `{weight, strength}[]`，函数体只做加权求和，**没有任何写者**；
 *     · 它的 `weight` **没有产出者** —— 全仓 `related_ids` 在本次开工前**无写者**
 *       （`grep -rn related_ids packages` 时只有 `schema.ts:59` 的 DDL 一行命中）。
 *   ⇒ 本包做的是**它的上游**：把 `weight` 生产出来并落进 `memory_items.related_ids`。
 *     下游读 `related_ids` 构造成 `sources` 喂给 `associativeActivation` —— 一个 S、两个阶段，
 *     **不是两套关联强度**。故本包**不导出任何**名字叫 `activation`/`decay`/`strength` 的量，
 *     也不重复实现它（见 `tests/l03-hebbian.test.mjs` ⑧ 的命名空间腿）。
 *
 * ── ⚠ 与 `forgetting/src/strength.ts`（Pavlik `ΔS = a·(S_max − S)^b`）的关系：**两个不同的状态量** ──
 *   实测该文件的定义式**不含任何时间项**，它更新的是**单条记忆自己的**间隔重复强度 `S`
 *   （落 `memory_items.strength`）；本包更新的是**一对记忆之间**的关联权重 `w`（落 `related_ids`）。
 *   两者的**状态变量不同**（一条记忆 vs 一条边），故 `η` 与 `a/b/S_max` 不是同一组系数、
 *   也不可互相代入（代入即「同一条记忆被两家乘过」，C14）。
 *   ⇒ 本包**不 import 也不重新实现** Pavlik；`related_ids` 的写者**只有本包**。
 *
 * ── ⚠ 为什么 `x_i = x_j = 1` 而不是把 ACT-R 的激活值 `A` 代进来 ──────────────────────
 *   判据①要求「固定夹具下关联强度增量**逐字复现**」。`A` 含逻辑噪声项 ε（`activation.ts:78`
 *   的 `noiseTerm`，默认 `Math.random`）——用它当 `x` 会让判据变成抛硬币。
 *   `long-term` 对同一问题已定过口径：判据锚点全部取 **ε=0 的期望值口径**
 *   （`activation.ts:89`：「ε 缺省 0（不传即『期望值口径』）」）。
 *   ⇒ 本包取 `x_i = x_j = 1`（「两条记忆都被激活」这一事实的二值化，乘积 = 1），
 *     即 `Δw = η = 0.01`，与 `docs/mana-v10-landing-plan.md:144` ①「学习率 η = 0.01」逐字一致。
 *     `x` 是**显式入参**（`pairDelta`），需要「激活强度加权」的调用方自己传 —— 但**判据面
 *     不用它**，故不存在「判据靠一个可变的 x 撑着」的假绿。
 *
 * ⚠ **本文件不抛错处理非法 `w`**：钳位发生在 `store-format.ts` 的解析处与 `store.ts` 的写入口
 *   （一次处置口径），避免两处各写一套钳位规则而漂移。
 */

import { ETA } from './params.ts'
import { canonicalPair } from './window.ts'

/** 一对有序 id（规范序）。 */
export type Pair = readonly [string, string]

/**
 * 单次共激活的权重增量 `Δw = η · x_i · x_j`。
 *
 * @param xI 记忆 i 的激活量。**判据口径取 1**（见文件头）。
 * @param xJ 记忆 j 的激活量。
 * @param eta 学习率，缺省 `params.ETA`（0.01）。⚠ 判据**不传它** —— 改 `ETA` 必须让判据红。
 * @throws 任一非有限数（静默 NaN 会一路写进 `related_ids`，且 `NaN.toFixed(6)` 得 `'NaN'`、
 *   落库后读回仍是 `NaN`，全程不报错 —— 本仓「静默失效查被吞异常」的典型形态，故抛）。
 */
export function pairDelta(xI: number = 1, xJ: number = 1, eta: number = ETA): number {
  if (!Number.isFinite(xI) || !Number.isFinite(xJ)) {
    throw new Error(`pairDelta: 激活量必须是有限数（实测 xI=${String(xI)} xJ=${String(xJ)}）`)
  }
  if (!Number.isFinite(eta) || eta < 0) {
    throw new Error(`pairDelta: η 必须是 ≥0 的有限数（实测 ${String(eta)}）`)
  }
  return eta * xI * xJ
}

/**
 * **闭式期望**：`w_N = clamp(w_0 + N·η)` —— 判据③「重复 N 次共激活 ⇒ 有闭式期望」的落点。
 *
 * ⚠ **闭式与「逐次累加实现」在浮点上不是同一个数**（本机实测，见 handoff §判据）：
 *   ```
 *     累加到第 10 次 = 0.09999999999999999        （10 次 0.01 相加）
 *     0.01 × 10     = 0.1                        （闭式）
 *     相等？        false
 *   ```
 *   ⇒ 判据必须**分两条腿**（本包测试③就这么写）：闭式腿用 `1e-12` 容差；
 *     单调腿只断言**相邻两步不减**（`w_{n+1} ≥ w_n`）。把两者合成一条断言
 *     （例如要求 `累加值 === 闭式值`）就是一条**会在 n=10 假红**的断言。
 *   `tests/l03-hebbian.test.mjs` ③ 的实测输出逐字打印了这条差，使该事实可被读者复核。
 *
 * @param w0 初始权重（默认 **0** = 「此前无关」；这是本包对 `related_ids` 的缺省口径）。
 * @param n 共激活次数，须为 ≥0 的整数。
 * @param eta 学习率（缺省 `ETA`）。
 * @param cap 权重上界（缺省 **无上界**）。⚠ 饱和是**可选**的：判据面不设 cap
 *   （原文「单调不减」是**无上界**的表述），设了 cap 才能说「饱和」，两者不许混同。
 */
export function closedFormWeight(w0: number = 0, n: number = 0, eta: number = ETA, cap?: number): number {
  if (!Number.isFinite(w0)) throw new Error(`closedFormWeight: w0 必须是有限数（实测 ${String(w0)}）`)
  if (!Number.isInteger(n) || n < 0) throw new Error(`closedFormWeight: n 必须是 ≥0 的整数（实测 ${String(n)}）`)
  if (!Number.isFinite(eta) || eta < 0) throw new Error(`closedFormWeight: η 必须是 ≥0 的有限数（实测 ${String(eta)}）`)
  const w = w0 + n * eta
  if (cap === undefined) return w
  if (!Number.isFinite(cap) || cap < 0) throw new Error(`closedFormWeight: cap 必须是 ≥0 的有限数（实测 ${String(cap)}）`)
  return Math.min(w, cap)
}

/**
 * 把一批权重合并成**同一 id 一行**（后写者胜 + 显式记录被压掉的冲突）。
 *
 * ⚠ **为什么不是「权重相加」**：若两条来源行给同一 id 各带一个权重，
 *   「相加」会让「(i,j) 共激活 1 次」与「(i,j) 各来自两行、各半次」得到不同的权重 ——
 *   而后者不是一个可解释的物理量。本包取**后者覆盖**（`related_ids` 是同一对关系的**当前**权重），
 *   并把被压掉的值记进 `collapsed`（G8：静默丢值 = 不可观测）。
 */
export function mergeWeights(
  rows: readonly { id: string; weight: number }[],
): { readonly merged: readonly { id: string; weight: number }[]; readonly collapsed: readonly { id: string; kept: number; dropped: number }[] } {
  const byId = new Map<string, number>()
  const collapsed: { id: string; kept: number; dropped: number }[] = []
  for (const row of rows) {
    const previous = byId.get(row.id)
    if (previous === undefined) {
      byId.set(row.id, row.weight)
      continue
    }
    collapsed.push({ id: row.id, kept: row.weight, dropped: previous })
    byId.set(row.id, row.weight)
  }
  const merged = [...byId.entries()]
    .map(([id, weight]) => ({ id, weight }))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return { merged, collapsed }
}

/** 校验一对 id：非空、不相等、规范序。违者抛（静默接受会让「自环」写进关系面）。 */
export function assertPair(i: string, j: string): Pair {
  if (typeof i !== 'string' || typeof j !== 'string' || i.trim() === '' || j.trim() === '') {
    throw new Error(`assertPair: 两个 id 都必须是非空字符串（实测 ${JSON.stringify(i)} / ${JSON.stringify(j)}）`)
  }
  if (i === j) throw new Error(`assertPair: 不允许自环（i === j === ${JSON.stringify(i)}）—— 一条记忆与自己的关联无定义`)
  return canonicalPair(i, j)
}
