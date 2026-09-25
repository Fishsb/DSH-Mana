/**
 * `production_rules` 的**唯一写者**（B4.1 ③：chunking 产出的规则落这张表）。
 *
 * ── 列清单**以 schema 为准**（`packages/core/src/schema.ts:64`），逐列核对，不得臆造 ─────────
 *   `id TEXT PRIMARY KEY` · `conditions TEXT NOT NULL` · `actions TEXT NOT NULL` ·
 *   `utility REAL DEFAULT 0.5` · `success_rate REAL DEFAULT 0.5` · `cost REAL DEFAULT 0` ·
 *   `strength REAL DEFAULT 0.5` · `source_goal_id TEXT` · `created_at TEXT NOT NULL`
 *
 * ⚠ **只写 5 列，其余 4 列走 DDL 缺省**：`utility`/`success_rate`/`cost`/`strength` 是
 *   「这条规则有多好」的判据面，而本批**无任何实测基线**（A3-3 在册上写明「待定，需首测后自设」）⇒
 *   写 0.5 与**不写**的差别是「假装测过」与「明说没测」。本层选择**不写**，
 *   由 DDL 缺省承担，并在读回校验里把它**原样报出**（`unmeasured` 字段），使"没测"可查。
 *
 * ⚠ 写库经 `core.db`（core 是开库器/事务的唯一写点），本包**不自己开库**。
 */
import type { ManaCoreService } from 'dsh-mana-core'
import type { ProductionRuleDraft } from './chunking.ts'

/** 本层写入的列（**唯一**一份清单；读回校验与 INSERT 共用它，防两处漂移）。 */
export const WRITTEN_COLUMNS = ['id', 'conditions', 'actions', 'source_goal_id', 'created_at'] as const

/** 走 DDL 缺省、本批**未测量**的列（读回时原样报出，使"没测"可查）。 */
export const UNMEASURED_COLUMNS = ['utility', 'success_rate', 'cost', 'strength'] as const

const INSERT_SQL =
  `INSERT OR IGNORE INTO production_rules (${WRITTEN_COLUMNS.join(', ')}) VALUES (${WRITTEN_COLUMNS.map(() => '?').join(', ')})`
const SELECT_SQL = `SELECT ${[...WRITTEN_COLUMNS, ...UNMEASURED_COLUMNS].join(', ')} FROM production_rules WHERE id = ?`

export interface WriteRulesResult {
  readonly inserted: readonly string[]
  /** 已存在的同 id 规则（`INSERT OR IGNORE` 的产物）；**不是失败**，但必须与 `inserted` 分开计数。 */
  readonly existing: readonly string[]
  readonly failures: readonly { readonly id: string; readonly reason: string }[]
  /**
   * 写后**读回**的实测行（`id` → 各列实测值）。
   *
   * 为什么要读回：`INSERT` 成功 ≠ 列写对了。插入语句里列名拼错会在 `prepare()` 抛错（好），
   * 但**列序错**（如 conditions 与 actions 对调）不会抛错、只会静默写反 —— 读回校验是
   * 「写入生效」这条判据的唯一落点（本仓「接口成功非达成」的落点）。
   */
  readonly readBack: readonly { readonly id: string; readonly row: Record<string, unknown> }[]
}

/** 按列清单装配参数（**与 INSERT_SQL 同源**，顺序由 `WRITTEN_COLUMNS` 决定）。 */
function paramsFor(rule: ProductionRuleDraft): (string | null)[] {
  return [rule.id, rule.conditions, rule.actions, rule.sourceGoalId, rule.createdAt]
}

/**
 * 落库 + 读回校验。
 *
 * @param core  `ctx.get('mana-core')` 拿到的服务（本层不自己开库）
 * @param rules chunking 的草稿
 */
export function writeProductionRules(core: ManaCoreService, rules: readonly ProductionRuleDraft[]): WriteRulesResult {
  const inserted: string[] = []
  const existing: string[] = []
  const failures: { id: string; reason: string }[] = []
  const readBack: { id: string; row: Record<string, unknown> }[] = []

  for (const rule of rules) {
    try {
      const info = core.db.prepare(INSERT_SQL).run(...paramsFor(rule))
      if (Number(info.changes) > 0) inserted.push(rule.id)
      else existing.push(rule.id)
      const row = core.db.prepare(SELECT_SQL).get(rule.id) as Record<string, unknown> | undefined
      if (row === undefined) {
        failures.push({ id: rule.id, reason: '写后读回为空 —— 行未真正落库（INSERT 返回成功但行不存在）' })
      } else {
        readBack.push({ id: rule.id, row })
      }
    } catch (error) {
      // 不吞错：写失败必须**指名道姓**（哪条规则、为什么），不得静默跳过
      failures.push({ id: rule.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { inserted, existing, failures, readBack }
}

/** 读回一条规则（判据用；`undefined` = 不存在，与"存在但值不同"可分辨）。 */
export function readProductionRule(core: ManaCoreService, id: string): Record<string, unknown> | undefined {
  return core.db.prepare(SELECT_SQL).get(id) as Record<string, unknown> | undefined
}

/** 全表计数（判据用：证"合并/新颖**不**写这张表"，防混淆面）。 */
export function countProductionRules(core: ManaCoreService): number {
  return (core.db.prepare('SELECT count(*) AS c FROM production_rules').get() as { c: number }).c
}
