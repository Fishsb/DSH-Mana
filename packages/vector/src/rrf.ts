/**
 * RRF（Reciprocal Rank Fusion）—— **自实现**（B1.1，`docs/mana-rollout-plan.md` §1.1 原文口径「约 30 行，k=60」）。
 *
 * 口径逐字对齐本机 shoucang `lib/vec.js:361`（只读参考）：
 *   `1 / (k + rank) + 1 / (k + rank)`，**rank 从 1 起**，多路名次相加。
 *
 * **与上游的两处差异（逐行复核后改写，不是"顺手优化"）**：
 * 1. **缺失名次的处理**：上游写 `denseRank.get(key) || dense.length + 1` —— 缺失时给一个
 *    **很大的名次**（分极小但不为 0），即"未命中该路"仍吃到一份**微量分**；本实现改为
 *    **不加分且不写该键**（`rank` 里连键都没有）。判因：G8 要求「未命中」与「命中得很差」
 *    可分辨 —— 上游那个 `dense.length + 1` 把两件事压成同一个数，事后无法反查是哪一种。
 *    ⚠ 本文件早前注释误称上游是 `|| 0`（"rank 0 与缺失同义"）。**该描述不实，已更正**：
 *    上游给的是 `dense.length + 1`，不是 0。2026-09-24 复核 `lib/vec.js:361` 原文确认。
 * 2. **重复键：先去重，**再对去重后的序列重新编号**（重排）。上游在 `Map` 上迭代，键天然唯一，
 *    不面对此情形；本实现入参是数组，若只去重不重排，`['x','x','y']` 会让 `y` 拿到 rank 3
 *    —— 那是**输入数组里的下标**，不是"排序结果里的名次"，而 RRF 的定义域是后者。
 *    重排后 `y` 得 rank 2，与"上游直接拿到去重数组"的结果**完全一致**。
 *    （等价性取证：`tests/b11-vector.test.mjs` 的 ② 与 ⑤b，**带负向控制** —— 退回"不重排"即红。）
 *
 * **为什么不用加权和**：dense 与 lexical 的分数尺度不可比，加权和要池内归一化 ⇒ 跨查询不可比、
 * 且对离群分敏感；RRF 只看名次，跨查询稳定。故本仓排序只用 RRF，不引入分数融合。
 *
 * 纯函数、无 IO、无随机 —— 故 A1-4 的三个锚点可逐字复现（这是 A 档判据的前提）。
 */

/** 一路排序结果：`keys` 已按分数**降序**排好，`keys[0]` 的名次是 1。 */
export interface RankedList {
  /** 路名（如 `'vector'` / `'lexical'`）；同名两路会被各自的 `RankedList` 携带，不参与计算。 */
  readonly name?: string
  /** 有序键列表（降序）。**重复键只取首次**，且**去重后重新编号**（`['x','x','y']` ⇒ `x`=1、`y`=2）。 */
  readonly keys: readonly string[]
}

/** 单条融合结果。 */
export interface FusedItem {
  readonly key: string
  /** 各路名次：`rank[name]`；某路未命中则**该键不存在**（不是 0，不是 Infinity —— 不可分辨是 G8 禁的）。 */
  readonly rank: Record<string, number>
  /** RRF 原始分 = Σ 1/(k+rank)。 */
  readonly score: number
  /** RRF 与 k 无关的另一种读法：该条命中的路数。 */
  readonly hits: number
}

/** RRF 默认常数（`册:394` 原文 k=60；上游 `criteria.json` 的 `surface.fusion.k` 亦为 60）。 */
export const RRF_DEFAULT_K = 60

/** 计算单路单名次的 RRF 分量。导出以便 A1-4 判据能直接调它，不必绕整个融合。 */
export function rrfTerm(rank: number, k: number = RRF_DEFAULT_K): number {
  return 1 / (k + rank)
}

/**
 * 多路融合并按 RRF 分降序返回。
 *
 * 平局裁决（**必须显式，否则结果不稳定 ⇒ 判据会"一会儿过一会儿不过"**）：
 *   ① `score` 降序；② `hits` 降序；③ `key` 字典序升序。
 *   ⇒ 同一输入**逐位可复现**（A 档），不依赖 `Array.prototype.sort` 的稳定性。
 */
export function rrfFuse(
  lists: readonly RankedList[],
  k: number = RRF_DEFAULT_K,
  topK?: number,
): FusedItem[] {
  if (!Number.isFinite(k) || k <= 0) throw new RangeError(`rrfFuse: k 必须为正有限数，实测 ${String(k)}`)

  const merged = new Map<string, { rank: Record<string, number>; score: number; hits: number }>()

  lists.forEach((list, li) => {
    const name = list.name ?? `list${li}`
    // ① 先去重（保持首次出现的相对次序）。
    const deduped = [...new Set(list.keys)]
    // ② **再去重后的序列重新编号** —— 名次是"排序结果里的名次"，不是"输入数组里的下标"。
    //    不重排的话 `['x','x','y']` 会让 y 拿 rank 3（= 输入的第二个位置之后），语义错。
    deduped.forEach((key, idx) => {
      const rank = idx + 1
      const cur = merged.get(key) ?? { rank: {}, score: 0, hits: 0 }
      cur.rank[name] = rank
      cur.score += rrfTerm(rank, k)
      cur.hits += 1
      merged.set(key, cur)
    })
  })

  const out = [...merged.entries()].map(([key, v]) => ({ key, rank: v.rank, score: v.score, hits: v.hits }))
  out.sort((a, b) => b.score - a.score || b.hits - a.hits || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return topK === undefined ? out : out.slice(0, Math.max(0, topK))
}

/**
 * 两路（同时出现在**同一个池子**里）的融合便捷式，专为 A1-4 的形态而生：
 * 上游把`dense` 与 `lexical` 两套名次都挂在**同一批候选**上 ⇒ 传两组名次表即可。
 *
 * ⚠ 与 `rrfFuse` 的差别仅在输入形态：`rankOf` 是「键 → 名次」的显式表（名次缺失即不加分）。
 */
export function rrfFuseRanked(
  denseRank: ReadonlyMap<string, number> | Record<string, number>,
  lexRank: ReadonlyMap<string, number> | Record<string, number>,
  k: number = RRF_DEFAULT_K,
): FusedItem[] {
  const get = (m: ReadonlyMap<string, number> | Record<string, number>, key: string): number | undefined =>
    m instanceof Map ? m.get(key) : (m as Record<string, number>)[key]

  const keys = new Set<string>()
  for (const key of denseRank instanceof Map ? denseRank.keys() : Object.keys(denseRank)) keys.add(key)
  for (const key of lexRank instanceof Map ? lexRank.keys() : Object.keys(lexRank)) keys.add(key)

  const out: FusedItem[] = []
  for (const key of keys) {
    const d = get(denseRank, key)
    const l = get(lexRank, key)
    const rank: Record<string, number> = {}
    let score = 0
    let hits = 0
    if (d !== undefined) (rank['dense'] = d), (score += rrfTerm(d, k)), (hits += 1)
    if (l !== undefined) (rank['lexical'] = l), (score += rrfTerm(l, k)), (hits += 1)
    out.push({ key, rank, score, hits })
  }
  out.sort((a, b) => b.score - a.score || b.hits - a.hits || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return out
}
