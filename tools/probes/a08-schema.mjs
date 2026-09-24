// A0-8 session_id/turn_id 已补 + inject_log 表已建 + **存量库补列真生效**
//
// ⚠ 本探针修的是一处**盲区**（本仓 2026-09-24 实测）：
//   旧版只查 `inject_log` 的列，于是 `createSchema` 对存量库**静默空操作**
//   这件事**任何机检都发现不了**。落地册明文要求阶段 1 给 `jev_log` 补
//   `input_chars`/`trimmed`、阶段 3 补 `verdict`/`verify_state`（§1 条 6/8）
//   ⇒ 旧实现下这些列**永远不会出现在存量库**，且不报错。
//
// ⚠ 反「自证」纪律：**不用本仓解析器交叉验证本仓解析器**（那是循环论证 ——
//   解析器漏掉的列，判据也会一起漏掉）。这里用**差分判据**：
//   故意造一个「缺列的旧库」→ 施加 createSchema → 与「全新库」的列集合**逐表比对**。
//   两者不一致即证明迁移没生效；这个判据无法被解析器的盲区骗过。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const here = new URL('../../packages/core/src/db.ts', import.meta.url).href
const { openManaDb } = await import(here)
const { createSchema } = await import(new URL('../../packages/core/src/schema.ts', import.meta.url).href)

const dir = mkdtempSync(join(tmpdir(), 'mana-a08-'))
const opts = { allowExtension: true }

/** 各表实际列名（按 cid 序）。 */
const colsOf = (db, t) =>
  db
    .prepare(`PRAGMA table_info(${t})`)
    .all()
    .map((x) => String(x.name))

/** 库里的普通表名（排除 fts5 影子表）。 */
const tablesOf = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => String(r.name))
    .filter((n) => !/_data$|_idx$|_content$|_docsize$|_config$/.test(n))
    .filter((n) => !n.endsWith('_fts'))
    .sort()

// ── 基准：全新库（DDL 完整施加）──────────────────────────────────────────────
const fresh = openManaDb({ path: join(dir, 'fresh.db') })
const freshCols = {}
for (const t of tablesOf(fresh.db)) freshCols[t] = colsOf(fresh.db, t)

// ── 对照：故意「缺列的旧库」────────────────────────────────────────────────
// ⚠ 必须**写实地**模拟存量库：保留全部 `NOT NULL` / `PRIMARY KEY` 列（真实的旧库由
//   同一份 DDL 建出，这些列必然在），只省略**后加的 nullable 列**（阶段 1/3 要补的
//   `input_chars`/`trimmed`/`verdict`/`verify_state` 正是 nullable）。
//   ⇒ 若把 NOT NULL 列也省掉，测的就不是迁移而是 SQLite 硬限制（见下方负例）。
//   列清单由**目标 schema 自身**推出，避免手写第二份清单（那会引入漂移面）。
const { parseSchema } = await import(new URL('../../packages/core/src/schema.ts', import.meta.url).href)
const target = parseSchema().tables
const old = new DatabaseSync(join(dir, 'old.db'), opts)
/** 只保留 NOT NULL / PRIMARY KEY 列 —— 即「旧库本来就有」的那批。 */
const keepOnlyRequired = (cols) =>
  cols.filter((c) => /\bNOT\s+NULL\b/i.test(c.def) || /\bPRIMARY\s+KEY\b/i.test(c.def))

for (const t of ['jev_log', 'mana_trace']) {
  const cols = keepOnlyRequired(target.get(t) ?? [])
  old.exec(`CREATE TABLE ${t} (${cols.map((c) => c.def).join(', ')})`)
}
// 补一行「迁移前就存在」的数据：证明**补列不毁数据**（迁移最该守住的底线）。
// ⚠ 该行必须在 createSchema **之前**插入才能证明这一点。INSERT 的列由目标 schema 的
//   NOT NULL 列自动生成 —— 手写列名会在 DDL 变化时静默失配（本仓踩过同类）。
const requiredCols = keepOnlyRequired(target.get('jev_log') ?? [])
const names = requiredCols.map((c) => c.name)
const values = names.map((n) => {
  if (n === 'id') return 'sentinel-row'
  if (/\bTEXT\b/i.test(requiredCols.find((c) => c.name === n)?.def ?? '')) return 'sentinel'
  return '1'
})
old.exec(
  `INSERT INTO jev_log (${names.join(', ')}) VALUES (${values.map((v) => `'${v}'`).join(', ')})`,
)

const migration = createSchema(old)

const degraded = {}
for (const t of tablesOf(old)) degraded[t] = colsOf(old, t)

/** 逐表比对「迁移后的旧库」vs「全新库」。 */
const mismatches = []
for (const [t, want] of Object.entries(freshCols)) {
  const got = degraded[t]
  if (!got) {
    mismatches.push(`${t}: 迁移后仍不存在`)
    continue
  }
  const missing = want.filter((c) => !got.includes(c))
  if (missing.length) mismatches.push(`${t}: 缺 ${missing.join(',')}`)
}

// ── 负例：不可补的列必须**整体拒绝**且不留半迁移态（原子性判据）────────────
// 造一个缺 `NOT NULL` 列的库：SQLite 不允许 ADD，实现必须先预检再拒绝。
const bad = new DatabaseSync(join(dir, 'blocked.db'), opts)
bad.exec('CREATE TABLE mana_trace (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL)')
let blockedThrew = false
let blockedLeftPartial = false
try {
  createSchema(bad)
} catch {
  blockedThrew = true
  // 拒绝后该表**一列都不该被加上**（连可补的列也不能先加上去）。
  const after = colsOf(bad, 'mana_trace')
  blockedLeftPartial = after.length !== 2
}
bad.close()

// ── A0-8 原有的硬判据（保留，不因新判据而放松）──────────────────────────────
const need = ['session_id', 'turn_id', 'memory_id', 'block_id', 'injected_at', 'gate', 'degraded', 'local_score', 'jev_prob', 'reset']
const injCols = colsOf(fresh.db, 'inject_log')
let badGateRejected = false
try {
  fresh.db
    .prepare('INSERT INTO inject_log (session_id,turn_id,request_id,injected_at,gate) VALUES (?,?,?,?,?)')
    .run('s', 1, 'r', 't', 'bogus')
} catch {
  badGateRejected = true
}
const traceCols = colsOf(fresh.db, 'mana_trace')
const memCols = colsOf(fresh.db, 'memory_items')
const jevCols = colsOf(fresh.db, 'jev_log')
const fts = fresh.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_items_fts'").get()

// 索引：旧库补列后索引必须也建起来（顺序错则建索引时报 `no such column`）。
const idxCount = old.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").get().c
// 数据未毁：补列前的那行必须还在。
const sentinel = old.prepare('SELECT COUNT(*) c FROM jev_log WHERE id=?').get('sentinel-row').c

console.log(
  JSON.stringify({
    missing: need.filter((c) => !injCols.includes(c)),
    hasTraceST: traceCols.includes('session_id') && traceCols.includes('turn_id'),
    hasMemST: memCols.includes('session_id') && memCols.includes('turn_id'),
    hasJevST: jevCols.includes('session_id') && jevCols.includes('turn_id'),
    badGateRejected,
    fts: !!fts,
    journalMode: fresh.journalMode,
    schemaVersion: fresh.schemaVersion,
    // ── 新增：存量库迁移真生效的差分证据 ──
    migrationApplied: migration.applied.length,
    migrationMismatches: mismatches,
    migrationIndexes: Number(idxCount),
    migrationSentinelKept: Number(sentinel) === 1,
    // 不可补的列 ⇒ 必须整体拒绝且不留半迁移态
    blockedThrew,
    blockedLeftPartial,
  }),
)

fresh.close()
old.close()
rmSync(dir, { recursive: true, force: true })
