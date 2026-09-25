/**
 * **列存在性探测（三态）**与列清单 —— 本包对 L-00（契约补列）的**显式依赖面**。
 *
 * ── 为什么必须探测而不是直接假设「列在」（本仓 2026-09-25 实测）────────────────────────
 *   `packages/core/src/schema.ts` 的 `memory_items` **实测只有 26 列**，
 *   v10 §36 的 12 列（含 `reconsolidation_window_until` / `update_history`）**一个都没有**
 *   （逐列 grep 命中 = 0；证据见 `docs/handoff/S26.md`）。
 *   ⇒ 本包若直接 `UPDATE memory_items SET reconsolidation_window_until = ?`：
 *      · SQLite 会在 `prepare()` 抛错（列不存在）—— 那是**崩**，不是降级；
 *      · 若被 try/catch 吞掉写成"没开窗"，则「列没补」与「本条不该开窗」**表面完全同形**
 *        —— 正是本仓最防的形态（失败不可观测）。
 *   ⇒ 故 `columnsPresent()` 把三态**显式化**：`{ok:true}` / `{ok:false, missing:[...]}`，
 *     调用方据此返回 `degraded:true` + **非空 reason** + 留痕，**不静默空转也不崩**。
 *
 * ⚠ **本模块不自建列、不改 schema**（`packages/core` 是契约真源，属契约席独占写面）。
 *   本包只**探测**，补列由 L-00 批次完成。
 */

/** 本包依赖的两列（**唯一清单**；探测与判据都读它，避免两处各写一份）。 */
export const REQUIRED_COLUMNS: readonly string[] = Object.freeze([
  'reconsolidation_window_until',
  'update_history',
] as const)

/** 缺列时的 reason 前缀：与「别的失败」可分辨（不靠自然语言描述区分）。 */
export const SCHEMA_MISSING_PREFIX = 'schema-missing:' as const

/** 只看 `PRAGMA table_info` 所需的最小句柄面（`node:sqlite` 的 `DatabaseSync` 满足它）。 */
export interface ColumnProbeDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

export type ColumnsPresent =
  | { ok: true; missing: []; columns: string[] }
  | { ok: false; missing: string[]; columns: string[] }

/**
 * 探测 `memory_items` 的两列是否都在。
 *
 * ⚠ 实现口径（三条，都有理由）：
 *   ① 走 `PRAGMA table_info(memory_items)` 的**读回值**，不用 `SELECT ... LIMIT 0` 试探：
 *      后者在列缺失时抛错，要靠 catch 分辨「缺列」与「表都没建」—— 两种失败会混成一个 catch；
 *      `table_info` 的返回行**本身就是事实**（列名逐字），可与 `REQUIRED_COLUMNS` 点名校验。
 *   ② 表不存在时返回的同样是 `ok:false` 且 `missing` = 全部两列 —— 这是**正确**语义：
 *      「表都没有」比「列缺」更不足以开窗，且 reason 里点名的是列，不会把调用方引向错误方向。
 *   ③ **不吞异常**：句柄坏了就该抛（那是环境故障，不是 schema 缺口）；只有"真探测出缺列"
 *      才走降级路径。把环境故障也吞成 degraded 会让两者不可分辨。
 */
export function columnsPresent(db: ColumnProbeDb): ColumnsPresent {
  const rows = db.prepare('PRAGMA table_info(memory_items)').all() as { name?: unknown }[]
  const columns = rows.map((r) => String(r?.name ?? '')).filter(Boolean)
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c))
  if (missing.length === 0) return { ok: true, missing: [], columns }
  return { ok: false, missing, columns }
}

/** 由缺列清单构造**非空** reason（空 reason 会被判据判红：降级态必须可读）。 */
export function missingColumnsReason(missing: readonly string[]): string {
  return `${SCHEMA_MISSING_PREFIX}${missing.join(',')}`
}
