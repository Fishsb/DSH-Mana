/**
 * schema 迁移判据测试（ACT-4 · 修复「存量库静默不生效」）
 *
 * 覆盖的三条缺陷：
 *   ① `SCHEMA_SQL` 全 `IF NOT EXISTS` ⇒ 对**已存在的表**是静默空操作，
 *      存量库永远得不到后加的列，且不报错；
 *   ② 索引语句排在 DDL 末尾 ⇒ 列缺失时 `CREATE INDEX` 立即抛 `no such column`，
 *      补列根本轮不到执行（**顺序是正确性的一部分**）；
 *   ③ SQLite 硬限制：`ADD COLUMN NOT NULL` 无 `DEFAULT` 不可施加 ⇒
 *      边查边加会留下**半迁移库**（前面几列已加、后面的没加）。
 *
 * ⚠ 本测试的对照物**不是**「重新实现一遍预期」——那会与被测实现共享同一个盲区。
 *   对照物是**两条独立路径**：① 全新库（DDL 完整施加）的列集合；② 迁移后旧库的列集合。
 *   两者逐表 diff。这也是 `tools/probes/a08-schema.mjs` 采用的差分口径。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = new URL('../src/schema.ts', import.meta.url).href
const DB = new URL('../src/db.ts', import.meta.url).href

const { createSchema, parseSchema, splitStatements, SCHEMA_SQL } = await import(SCHEMA)
const { openManaDb } = await import(DB)

const cleanups = []
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'mana-schema-'))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

const colsOf = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => String(r.name))
const tablesOf = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => String(r.name))
    .filter((n) => !/_data$|_idx$|_content$|_docsize$|_config$/.test(n))
    .filter((n) => !n.endsWith('_fts'))
    .sort()

/** 建一个「写实的老库」：保留 NOT NULL/PK 列，省略后加的 nullable 列。 */
function makeLegacyDb(path, tables = ['jev_log', 'mana_trace']) {
  const db = new DatabaseSync(path, { allowExtension: true })
  const target = parseSchema().tables
  for (const t of tables) {
    const keep = (target.get(t) ?? []).filter(
      (c) => /\bNOT\s+NULL\b/i.test(c.def) || /\bPRIMARY\s+KEY\b/i.test(c.def),
    )
    db.exec(`CREATE TABLE ${t} (${keep.map((c) => c.def).join(', ')})`)
  }
  return db
}

// ── M1 存量库补列**真生效**（差分辨据）────────────────────────────────────────
test('M1 存量库补列真生效：迁移后旧库列集合 == 全新库列集合', () => {
  const dir = tmp()
  const fresh = openManaDb({ path: join(dir, 'fresh.db') })
  const old = makeLegacyDb(join(dir, 'old.db'))

  const before = colsOf(old, 'jev_log').length
  const res = createSchema(old)

  // 补列必须非零 —— 否则说明根本没走迁移（这正是缺陷①的表现）。
  assert.ok(res.applied.length > 0, `应补上若干列，实际 applied=${res.applied.length}`)
  assert.ok(
    colsOf(old, 'jev_log').length > before,
    'jev_log 列数应增加（旧实现下 `IF NOT EXISTS` 会让它保持不变）',
  )

  // 差分辨据：新旧库逐表列集合必须完全一致。
  const mismatches = []
  for (const t of tablesOf(fresh.db)) {
    const want = colsOf(fresh.db, t)
    const got = colsOf(old, t)
    if (!got.length) {
      mismatches.push(`${t}: 迁移后不存在`)
      continue
    }
    const missing = want.filter((c) => !got.includes(c))
    if (missing.length) mismatches.push(`${t}: 缺 ${missing.join(',')}`)
  }
  assert.deepEqual(mismatches, [], `迁移后仍与全新库不一致：${JSON.stringify(mismatches)}`)
  fresh.close()
  old.close()
})

// ── M2 幂等：二次施加补 0 列 ────────────────────────────────────────────────
test('M2 幂等：对已迁移的库存再施加 createSchema 补 0 列', () => {
  const db = makeLegacyDb(join(tmp(), 'idem.db'))
  const first = createSchema(db)
  assert.ok(first.applied.length > 0, '首次应补列')
  const second = createSchema(db)
  assert.deepEqual(second.applied, [], '二次施加不应再补任何列')
  db.close()
})

// ── M3 顺序：补列后才建索引（否则 `no such column`）────────────────────────
test('M3 索引在补列之后建立：旧库迁移后索引数与 DDL 声明一致', () => {
  const db = makeLegacyDb(join(tmp(), 'idx.db'))
  createSchema(db)
  const idx = Number(
    db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").get().c,
  )
  // ⚠ 期望值**从 DDL 派生**，不写死数字：写死会在每次新增索引时假红
  //   （本仓 2026-09-25 实测踩到：加了 user_model_history 的索引后本用例变红，
  //     而实现完全正确 —— 那是判据过严，不是回归）。
  const declared = (SCHEMA_SQL.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length
  assert.equal(idx, declared, `应建起 ${declared} 个索引（DDL 声明数）；顺序错会在补列前抛 no such column`)
  assert.ok(declared > 0, 'DDL 里应至少声明一个索引（防正则失配导致 0 == 0 平凡通过）')
  db.close()
})

// ── M4 数据不毁：迁移前的行必须原样存活 ─────────────────────────────────────
test('M4 补列不毁数据：迁移前插入的行在迁移后仍在', () => {
  const db = makeLegacyDb(join(tmp(), 'data.db'))
  const target = parseSchema().tables.get('jev_log') ?? []
  const required = target.filter((c) => /\bNOT\s+NULL\b/i.test(c.def) || /\bPRIMARY\s+KEY\b/i.test(c.def))
  const names = required.map((c) => c.name)
  const vals = names.map((n) => (n === 'id' ? 'keep-me' : 'x'))
  db.exec(`INSERT INTO jev_log (${names.join(',')}) VALUES (${vals.map((v) => `'${v}'`).join(',')})`)

  createSchema(db)
  const kept = db.prepare('SELECT COUNT(*) c FROM jev_log WHERE id=?').get('keep-me').c
  assert.equal(Number(kept), 1, '迁移不得丢弃已有行')
  db.close()
})

// ── M5 原子性：不可补的列 ⇒ 整体拒绝且不留半迁移态 ───────────────────────────
test('M5 不可补列必须整体拒绝，且不留半迁移态', () => {
  const dir = tmp()
  const db = new DatabaseSync(join(dir, 'blocked.db'), { allowExtension: true })
  // 只建 `seq`/`event_type` 两列 ⇒ mana_trace 的 `payload`/`timestamp` 是 NOT NULL 无 DEFAULT，
  // SQLite 不允许 ADD 这类列 ⇒ 实现应在**动手前**预检并整体拒绝。
  db.exec('CREATE TABLE mana_trace (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL)')
  const beforeCols = colsOf(db, 'mana_trace').length

  assert.throws(() => createSchema(db), /无法用 ALTER TABLE 补|SQLite 硬限制/, '应抛出可读的拒绝原因')
  assert.equal(colsOf(db, 'mana_trace').length, beforeCols, '拒绝后不得留下任何半迁移列')
  db.close()
})

// ── M6 `autoMigrate` 必须是**真开关**（声明了就要产生可观测差异）───────────
test('M6 autoMigrate=false 不建表；=true 建表（开关必须有可观测差异）', () => {
  const dir = tmp()
  const mk = (flag) => openManaDb({ path: join(dir, `am-${flag}.db`), migrate: flag })
  const off = mk(false)
  const on = mk(true)
  const countTables = (db) =>
    db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c
  assert.equal(Number(countTables(off.db)), 0, 'autoMigrate=false 不应建表')
  assert.ok(Number(countTables(on.db)) > 0, 'autoMigrate=true 应建表')
  off.close()
  on.close()
})

// ── S1 语句切分：引号/注释感知（否则切错位静默产出错误语句）─────────────────
test('S1 splitStatements 引号与注释感知', () => {
  assert.equal(splitStatements("INSERT INTO t VALUES (';')").length, 1, '字符串内分号不分句')
  assert.equal(splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;").length, 2, '字符串内分号 + 正常分句')
  assert.equal(splitStatements('-- c; with semi\nSELECT 1').length, 1, '行注释内分号不分句')
  assert.equal(splitStatements('SELECT 1 /* ; */; SELECT 2').length, 2, '块注释内分号不分句')
  assert.equal(splitStatements("INSERT INTO t VALUES ('it''s; ok')").length, 1, '转义单引号')
})

// ── S2 解析器：跳过表级约束（列入会造出必然失败的 ADD COLUMN）───────────────
test('S2 parseSchema 跳过表级约束、表数从 DDL 派生', () => {
  const p = parseSchema()
  // ⚠ 期望值**从 DDL 派生**（`CREATE TABLE IF NOT EXISTS` 的出现次数），不写死 7：
  //   写死会在每次新增表时假红（本仓 2026-09-25 实测：加 user_model_history 后变红，
  //   而实现正确）。同时排除 `CREATE VIRTUAL TABLE`（FTS5 虚表不参与补列）。
  const declared = (SCHEMA_SQL.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/g) ?? []).length
  assert.ok(declared > 0, 'DDL 里应有普通表（防正则失配导致 0 == 0 平凡通过）')
  assert.equal(p.tables.size, declared, `应解析出 ${declared} 张普通表（虚表 FTS5 不参与）`)
  const inject = p.tables.get('inject_log').map((c) => c.name)
  assert.ok(inject.includes('gate'), 'inject_log.gate 应在列清单内')
  // CHECK 约束是表级项，不得被当成列名（否则会生成 `ADD COLUMN CHECK (...)`）。
  assert.ok(!inject.some((n) => /^check$/i.test(n)), '表级 CHECK 不应被当作列')
  // 新增表必须也被解析到（否则迁移不会给它补列）
  for (const t of ['user_model_history', 'jev_log']) {
    assert.ok(p.tables.has(t), `${t} 应被解析（否则迁移不覆盖它）`)
  }
})
