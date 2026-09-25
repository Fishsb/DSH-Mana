/**
 * **`related_ids` 的编码格式** —— 本批**首次定义**（此前该列**无写者、无格式**）。
 *
 * ⚠ **为什么格式必须由本文件显式定义并写进 handoff**：在本包之前，全仓 `related_ids` 的
 *   命中**只有** `packages/core/src/schema.ts:59` 的 DDL（`related_ids TEXT`）一处。
 *   （本条原写作 `packages` + 通配 + `/src` 的检索式，而那个通配的收尾（星号紧跟斜杠）**会提前终止块注释**
 *    —— 这正是 `packages/core/src/schema.ts:104-106` 记的反引号陷阱的**同一类**：
 *    注释里的字面量会终止模板串/注释，且报出的错**指不到真因**。此处改写为文字描述。）
 *   ⇒ 下游（关联激活的读侧、任何报表）要读它时，**只能照这里读**；格式改一次，
 *   两侧必须同时改。故本文件是**契约面**，不是实现细节。
 *
 * ── 选定格式（**带权 JSON 数组**）─────────────────────────────────────────────────
 * ```json
 *   [{"id":"m-a","w":0.03},{"id":"m-b","w":0.01}]
 * ```
 *
 * **三条选型理由（逐条对着本仓已有事实）**：
 *  ① **必须带权重**：`related_ids` 是 `long-term/src/activation.ts:66` 的
 *     `associativeActivation` 的 `weight` 的唯一来源。该函数要的是 `W_k`，**不是布尔"相关"**
 *     —— 只存 id 列表就等于把「关联强度」这个 L-03 的全部产出丢掉，下游只能填默认值，
 *     那与「没实现」在数据上同形。
 *  ② **必须是数组而不是对象 map**：本机实测（Node v22.22.1）**整数样字符串键会被重排到前面** ——
 *     `{m2, "mem-b", "123", "7"}` 的 `JSON.stringify` 结果是
 *     `{"7":0.04,"123":0.03,"m2":0.01,"mem-b":0.02}`（**7/123 被提到最前**）。
 *     记忆 id 完全可能是数字串 ⇒ 用对象 map 会让「按插入序落库」与「按读回序渲染」
 *     **不一致**，且 `JSON.stringify` 永远无法产出逐字节相同的两个等价输入。
 *   ⇒ 数组**显式按 id 字典序**排（下方 `encodeRelated`），使同一组关系**只有一个字节串**，
 *     「同一对 (i,j) 重复 N 次」的落库结果可直接逐字节比对（判据④ 的落点）。
 *  ③ **为什么不用「逗号分隔」**：`schema` 里 `tags` 列用的是逗号分隔，但那是**无序标签**；
 *     本列要表达 `{id → 权重}` 的有序映射，逗号分隔就需要「`id1:w1,id2:w2`」这类**自定义微语法**
 *     —— 而 id 本身若含 `,` 或 `:` 即**解析歧义且无报错**（静默错位，本仓最防的形态）。
 *     JSON 只需 `JSON.parse` 一处，非法输入会**抛**而不是错位。
 *
 * ── 解析的**显式三态**（`null` / 空串 / 非法，三者**不得**混同）────────────────────
 *   · `NULL`     ⇒ `state: 'null'`（列从未被写过 —— 与「写成了空关系」是两件事）；
 *   · `''`       ⇒ `state: 'empty'`（写者写过，内容是「没有关系」）；
 *   · 合法 JSON   ⇒ `state: 'ok'`；
 *   · 其它任何   ⇒ `state: 'invalid'` + **非空 reason**，且 **items 恒为 `[]`**。
 *   ⚠ `invalid` **绝不**降级成 `[]`（那会让「列里的值读不懂」与「本来没有关系」完全同形 ——
 *     `catch { return null }` 的教科书形态，见 `docs/contract/degradation.md` 硬约定 1/2）。
 *     本仓 S26 做法：**探测 + degraded + 非空 reason + 留痕**，本文件照办（留痕在 `store.ts`）。
 */

/** 一条关联：id + 权重。 */
export interface RelatedEntry {
  readonly id: string
  /** 关联强度 `w ≥ 0`（由 `η` 累积而来；本包**不设上界**，见 `hebbian.ts`）。 */
  readonly weight: number
}

/** 解析结果：**四态**（不是「有/没有」），`ok=false` 时 `reason` 必非空。 */
export type ParsedRelatedIds =
  | { readonly state: 'ok'; readonly items: readonly RelatedEntry[]; readonly reason: null }
  | { readonly state: 'null'; readonly items: readonly RelatedEntry[]; readonly reason: null }
  | { readonly state: 'empty'; readonly items: readonly RelatedEntry[]; readonly reason: null }
  | { readonly state: 'invalid'; readonly items: readonly RelatedEntry[]; readonly reason: string }

/** 列在该行上**根本不存在**（老库建于补列之前）—— 与「列存在但为 NULL」是两件事。 */
export const MISSING_COLUMN_REASON = 'memory_items.related_ids 列不存在' as const

/**
 * 解析 `related_ids` 单元格。
 *
 * @param raw 单元格原文：`string`（含 `''`）或 `null`。**列不存在**的情形由调用方
 *   （`store.ts` 的 `probeRelatedIdsColumn`）先探到并传 `undefined`。
 */
export function parseRelatedIds(raw: string | null | undefined): ParsedRelatedIds {
  if (raw === undefined) {
    return { state: 'invalid', items: [], reason: MISSING_COLUMN_REASON }
  }
  if (raw === null) return { state: 'null', items: [], reason: null }
  if (raw.trim() === '') return { state: 'empty', items: [], reason: null }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch (error) {
    return {
      state: 'invalid',
      items: [],
      reason: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!Array.isArray(decoded)) {
    return { state: 'invalid', items: [], reason: `顶层必须是数组，实测 ${typeof decoded}` }
  }
  const seen = new Set<string>()
  const items: RelatedEntry[] = []
  for (let i = 0; i < decoded.length; i++) {
    const row = decoded[i] as { id?: unknown; w?: unknown } | null
    if (!row || typeof row !== 'object') {
      return { state: 'invalid', items: [], reason: `第 ${i} 项不是对象` }
    }
    const id = row.id
    const w = row.w
    if (typeof id !== 'string' || id === '') {
      return { state: 'invalid', items: [], reason: `第 ${i} 项 id 非法（实测 ${JSON.stringify(id)}）` }
    }
    if (seen.has(id)) {
      return { state: 'invalid', items: [], reason: `第 ${i} 项 id 重复（${JSON.stringify(id)}）—— 同一对关系占两格会让读侧取哪一格都不对` }
    }
    seen.add(id)
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      return { state: 'invalid', items: [], reason: `第 ${i} 项 w 非法（实测 ${JSON.stringify(w)}）` }
    }
    items.push({ id, weight: w })
  }
  items.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return { state: 'ok', items, reason: null }
}

/**
 * 编码 `related_ids` 单元格 —— **规范唯一形式**。
 *
 * · 恒按 id 字典序排（与输入顺序无关）；
 * · 恒用 `JSON.stringify` 的紧凑形式（无空格）；
 * · 空集合 ⇒ `'[]'`（**不是 `''`，也不是 `null`**：写者写过且结论是「没有关系」，
 *   与「列从未被写过」必须可分辨）。
 *
 * @throws id 空/重复、权重非有限或为负 —— 写入口**宁可不写，也不写一个读不懂的值**
 *   （非法值一旦落库，解析侧只能报 `invalid`，而那时已经分不清是谁写的）。
 */
export function encodeRelated(entries: readonly RelatedEntry[]): string {
  const seen = new Set<string>()
  // 落库行用短键 `w`（单元格是 `[{"id":..,"w":..}]`，见文件头）；入参面向外是 `weight`。
  const normalized: { id: string; w: number }[] = []
  for (const e of entries) {
    if (typeof e.id !== 'string' || e.id === '') throw new Error(`encodeRelated: id 必须是非空字符串（实测 ${JSON.stringify(e.id)}）`)
    if (seen.has(e.id)) throw new Error(`encodeRelated: id 重复（${JSON.stringify(e.id)}）`)
    if (!Number.isFinite(e.weight) || e.weight < 0) {
      throw new Error(`encodeRelated: 权重必须是 ≥0 的有限数（实测 ${String(e.weight)}）`)
    }
    seen.add(e.id)
    normalized.push({ id: e.id, w: e.weight })
  }
  normalized.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return JSON.stringify(normalized)
}

/** 从已解析项里取某 id 的权重；**不存在**返回 `null`（不是 0 —— 0 是一个合法权重）。 */
export function weightOf(items: readonly RelatedEntry[], id: string): number | null {
  const hit = items.find((e) => e.id === id)
  return hit ? hit.weight : null
}
