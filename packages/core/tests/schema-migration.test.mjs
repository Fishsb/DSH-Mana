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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = new URL('../src/schema.ts', import.meta.url).href
const DB = new URL('../src/db.ts', import.meta.url).href

const { createSchema, parseSchema, splitStatements, SCHEMA_SQL } = await import(SCHEMA)
const { openManaDb } = await import(DB)

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

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

// ── M8 L-00 两列：存量库补列**真生效**、旧数据行仍在、列集合 == 全新库（差分）──────
test('M8 存量库补 memory_items 两列：旧行仍在且逐字不变，列集合 == 全新库', () => {
  const dir = tmp()
  const TWO = ['reconsolidation_window_until', 'update_history']

  // 前置控制①：真 DDL 必须**声明**这两列 —— 否则"补列"无事可做，且下面所有断言都会在
  //   "两边都没有"的情况下平凡通过（本仓最防的形态：判据绿 ≠ 事实被检查）。
  const target = parseSchema().tables.get('memory_items') ?? []
  for (const c of TWO) {
    assert.ok(target.some((x) => x.name === c), `DDL 必须声明 memory_items.${c}（列没进表定义 ⇒ 迁移面根本不覆盖它）`)
  }

  // 前置控制②：造**写实的旧库** —— 用真 DDL 的列定义，但**去掉这两列**（= L-00 之前的形态）。
  const old = new DatabaseSync(join(dir, 'mem-old.db'), { allowExtension: true })
  const legacyCols = target.filter((c) => !TWO.includes(c.name))
  old.exec(`CREATE TABLE memory_items (${legacyCols.map((c) => c.def).join(', ')})`)
  const stamp = '2026-01-02T03:04:05.000Z'
  // 旧库**必须有数据行**：没有行时"补列不毁数据"这条腿无法被否证（重建表式实现照样全绿）。
  old.exec(
    `INSERT INTO memory_items (id, type, content, summary, created_at)
     VALUES ('keep-me', 'episodic', 'L-00 之前写入的内容', '旧摘要', '${stamp}')`,
  )
  // 前置控制③：此刻两列**确实不在**（否则本用例证明不了"迁移真做了事"）。
  const beforeCols = colsOf(old, 'memory_items')
  for (const c of TWO) assert.equal(beforeCols.includes(c), false, `补列前 ${c} 不得存在`)

  const res = createSchema(old)

  // ① 两列**已存在**，且 applied 逐字点名它们（"补了什么"是可断言的值，不是靠猜）。
  const afterCols = colsOf(old, 'memory_items')
  for (const c of TWO) assert.equal(afterCols.includes(c), true, `补列后 ${c} 必须存在`)
  assert.deepEqual(
    res.applied.filter((a) => a.table === 'memory_items').map((a) => a.column).sort(),
    [...TWO].sort(),
    `本次迁移必须**恰好**补上这两列，实测 ${JSON.stringify(res.applied)}`,
  )

  // ② **旧数据行仍在且逐字不变** —— 这是 ADD COLUMN 与"重建表"的分界（重建会丢行/丢值）。
  const kept = old.prepare('SELECT id, type, content, summary, created_at FROM memory_items WHERE id = ?').get('keep-me')
  assert.ok(kept, '迁移不得丢行（重建表式实现会在这里报红）')
  assert.equal(String(kept.content), 'L-00 之前写入的内容', '内容必须逐字不变')
  assert.equal(String(kept.summary), '旧摘要', '摘要必须逐字不变')
  assert.equal(String(kept.created_at), stamp, '时间戳必须逐字不变')
  assert.equal(Number(old.prepare('SELECT COUNT(*) c FROM memory_items').get().c), 1, '行数不得变化')

  // ③ 差分判据：迁移后的列集合 == 全新库的列集合（逐列相等，不写死数字）。
  const fresh = openManaDb({ path: join(dir, 'mem-fresh.db') })
  assert.deepEqual(
    [...afterCols].sort(),
    [...colsOf(fresh.db, 'memory_items')].sort(),
    '存量库补列后的列集合必须与全新库**完全相等**',
  )

  // ④ 列**可用**（列存在 ≠ 能用）：真写一次再读回（两列各自的落库形态）。
  old.prepare('UPDATE memory_items SET reconsolidation_window_until = ?, update_history = ? WHERE id = ?').run(
    stamp,
    `[{"previous":"a","next":"b","at":"${stamp}","trigger":null}]`,
    'keep-me',
  )
  const written = old
    .prepare('SELECT reconsolidation_window_until w, update_history h FROM memory_items WHERE id = ?')
    .get('keep-me')
  assert.equal(String(written.w), stamp, 'reconsolidation_window_until 必须可写可读回')
  assert.equal(JSON.parse(String(written.h)).length, 1, 'update_history 必须可写可读回（JSON 数组）')

  // ⑤ 幂等：列齐之后再施加补 0 列。
  assert.deepEqual(createSchema(old).applied, [], '二次施加不得再补列')
  fresh.close()
  old.close()
})
// ══ 负向对拍（L-00 两列）：造扰动 ⇒ 指定腿**必须报红** ⇒ 逐字节恢复 + sha256 证据 ══
//
// ⚠ 靶子一致：判据腿 M8 读的是 `src/schema.ts` 的真源（本文件直接 import 它），
//   故扰动**也打在** `src/schema.ts` 上 —— 这就是"对拍要打对靶"。
// ⚠ 扰动**不写真源**：先把真源读进内存 → 把扰动版写进**临时副本** → `import()` 该副本跑断言。
//   于是仓内真源**全程只读**（sha256 逐字节可证），不会把半路状态留给并发跑着的别席用例。
// ⚠ 恢复动作不碰真源 ⇒ 不产生 mtime 漂移（本仓教训：恢复动作会改 mtime 而造出 mtime 假红）。
const SRC = new URL('../src/schema.ts', import.meta.url)

/** 在**临时副本**上施加扰动，返回该副本的 file:// URL；真源全程只读。 */
function mutateCopy(find, replace) {
  const original = readFileSync(SRC, 'utf8')
  const hits = original.split(find).length - 1
  assert.equal(hits, 1, `扰动锚点必须**恰好命中 1 次**，实测 ${hits}：若为 0 则变异器已过期（静默通过 = 假绿）`)
  const dir = tmp()
  const copy = join(dir, 'schema-mutated.ts')
  writeFileSync(copy, original.replace(find, replace))
  return { url: pathToFileURL(copy).href, sha: sha256(original) }
}

/** 真源 sha256（对拍前后必须逐字节相同）。 */
const srcSha = () => sha256(readFileSync(SRC))

/** M8 的前置控制 + ①②③ 腿，抽出来供正向与负向**同一份代码**跑（避免两套口径各自漂移）。 */
function assertTwoColumnsMigrated(mod, dir, label) {
  const TWO = ['reconsolidation_window_until', 'update_history']
  const target = mod.parseSchema().tables.get('memory_items') ?? []
  const declared = TWO.filter((c) => target.some((x) => x.name === c))
  assert.deepEqual(declared.sort(), [...TWO].sort(), `【${label}】DDL 必须声明这两列，实测声明了 ${JSON.stringify(declared)}`)

  const old = new DatabaseSync(join(dir, `neg-${label}.db`), { allowExtension: true })
  old.exec(`CREATE TABLE memory_items (${target.filter((c) => !TWO.includes(c.name)).map((c) => c.def).join(', ')})`)
  old.exec("INSERT INTO memory_items (id, type, content, created_at) VALUES ('keep-me','episodic','旧内容','2026-01-02T03:04:05.000Z')")
  for (const c of TWO) assert.equal(colsOf(old, 'memory_items').includes(c), false, '前置：补列前必须缺列')
  const res = mod.createSchema(old)
  for (const c of TWO) assert.equal(colsOf(old, 'memory_items').includes(c), true, `【${label}】${c} 补后必须存在`)
  assert.equal(
    Number(old.prepare('SELECT COUNT(*) c FROM memory_items').get().c),
    1,
    `【${label}】**旧数据行必须仍在** —— 这一条正是"重建表"与"ADD COLUMN"的分界`,
  )
  assert.equal(String(old.prepare('SELECT content c FROM memory_items WHERE id=?').get('keep-me').c), '旧内容', '旧值必须逐字不变')
  assert.ok(res.applied.some((a) => a.table === 'memory_items' && TWO.includes(a.column)), 'applied 必须点名补上的列')
  old.close()
}

test('N⑤ 负向：**把两列从表定义里注释掉** ⇒ 补列腿必须报红（且真源逐字节未变）', async () => {
  const before = srcSha()
  // 扰动语义：两列定义被注释掉（= "忘了把列写进表定义"的真实形态）
  const m = mutateCopy(
    '  reconsolidation_window_until TEXT,\n  update_history TEXT',
    '  -- reconsolidation_window_until TEXT,\n  -- update_history TEXT',
  )
  const mod = await import(m.url)
  // 前置控制：扰动版自己必须**真的**不再声明这两列（否则这条对拍是空的）。
  const declaredInMutant = (mod.parseSchema().tables.get('memory_items') ?? []).map((c) => c.name)
  assert.equal(declaredInMutant.includes('reconsolidation_window_until'), false, '扰动版必须不再声明这两列')
  // ⇒ 判据腿必须**报红**（与 M8 同一份断言代码）
  assert.throws(
    () => assertTwoColumnsMigrated(mod, tmp(), 'mutant'),
    /必须声明这两列|补后必须存在/,
    '列被注掉后，补列腿必须报红 —— 若仍绿，说明判据在"两边都没有"时平凡通过（假绿）',
  )
  // 真源全程只读 + 逐字节恢复（本测试**从不**写真源，故这里是"未被写过"的直接证据）
  assert.equal(srcSha(), before, `真源必须逐字节未变：before=${before} after=${srcSha()}`)
  assert.equal(m.sha, before, '扰动所依据的原文 sha 必须等于真源当前 sha')
})

test('N⑥ 负向：**补列实现成重建表**（DROP + CREATE）⇒ "旧数据行仍在"腿必须报红', async () => {
  const before = srcSha()
  // 扰动语义：把 `ADD COLUMN` 换成"**重建表**"写法 —— 原表 DROP 掉，再按**完整列定义**建一张同名新表。
  //   ⚠ 必须带**完整列定义**：只按 `p.def`（单列）重建会把表结构也弄坏（后续建索引报
  //     `no such column: session_id`），那样报红的是**索引腿**，抓不到本条要打的**数据腿**
  //     —— 这正是"对拍打错靶"。带完整列定义后，结构完全正常、只有**行**丢了。
  const m = mutateCopy(
    '    db.exec(`ALTER TABLE ${p.table} ADD COLUMN ${p.def}`)',
    '    db.exec(`DROP TABLE ${p.table}`)\n' +
      '    db.exec(`CREATE TABLE ${p.table} (${(target.tables.get(p.table) ?? []).map((c) => c.def).join(", ")})`)',
  )
  const mod = await import(m.url)
  const dir = tmp()
  const TWO = ['reconsolidation_window_until', 'update_history']
  const target = mod.parseSchema().tables.get('memory_items') ?? []
  const old = new DatabaseSync(join(dir, 'rebuild.db'), { allowExtension: true })
  old.exec(`CREATE TABLE memory_items (${target.filter((c) => !TWO.includes(c.name)).map((c) => c.def).join(', ')})`)
  old.exec("INSERT INTO memory_items (id, type, content, created_at) VALUES ('keep-me','episodic','旧内容','2026-01-02T03:04:05.000Z')")
  mod.createSchema(old)
  // ⚠ 先证明**扰动真的跑到了**（否则"报红"可能来自别的原因，属对拍打错靶）：
  //   行数为 0 只可能来自那条 DROP —— 这同时是"坏实现确实坏"的证据。
  assert.equal(
    Number(old.prepare('SELECT COUNT(*) c FROM memory_items').get().c),
    0,
    '扰动版必须真的把行 DROP 掉了（行非 0 ⇒ 扰动没生效，后面的"报红"不成立）',
  )
  // 重建表式实现的结果：列**在**（所以"列已存在"那条腿抓不住它），但行**没了**。
  assert.equal(colsOf(old, 'memory_items').includes(TWO[0]), true, '重建式实现照样能让列存在（故必须有数据腿）')
  assert.throws(
    () => assertTwoColumnsMigrated(mod, dir, 'rebuild'),
    /旧数据行必须仍在/,
    '"旧数据行仍在"腿必须报红 —— 只判"列在不在"会放过把数据 DROP 掉的实现',
  )
  assert.equal(srcSha(), before, '真源必须逐字节未变')
  old.close()
})

test('N⑦ 负向：某列定义成 **NOT NULL 且无 DEFAULT** ⇒ 迁移必须**显式拒绝**（不许静默跳过）', async () => {
  const before = srcSha()
  // 扰动语义：把可选列写成 NOT NULL 无 DEFAULT —— SQLite 的 ADD COLUMN 硬限制
  //   （本仓实测：Cannot add a NOT NULL column with default value NULL）。
  const m = mutateCopy('  reconsolidation_window_until TEXT,', '  reconsolidation_window_until TEXT NOT NULL,')
  const mod = await import(m.url)
  const dir = tmp()
  const target = mod.parseSchema().tables.get('memory_items') ?? []
  //   ⚠ 旧库必须**两列都缺**（否则 update_history 本来就在，"不许先加上去"这条腿自相矛盾）。
  const old = new DatabaseSync(join(dir, 'notnull.db'), { allowExtension: true })
  const absent = ['reconsolidation_window_until', 'update_history']
  old.exec(`CREATE TABLE memory_items (${target.filter((c) => !absent.includes(c.name)).map((c) => c.def).join(', ')})`)
  const beforeCols = colsOf(old, 'memory_items').length
  for (const c of absent) assert.equal(colsOf(old, 'memory_items').includes(c), false, `前置：${c} 必须缺（不然"半迁移态"无从谈起）`)
  // ⚠ 证明**扰动进了运行中的代码**：扰动版的表定义里那一列必须真的带上了 NOT NULL
  //   （否则报红可能来自别处，属打错靶）。
  const mutantDef = (mod.parseSchema().tables.get('memory_items') ?? []).find((c) => c.name === 'reconsolidation_window_until')
  assert.match(String(mutantDef?.def ?? ''), /NOT\s+NULL/i, '扰动版必须真的把该列写成 NOT NULL（扰动未生效 ⇒ 本对拍无效）')
  // 必须**抛**（拒绝），不得静默跳过该列后"装作成功"。
  assert.throws(
    () => mod.createSchema(old),
    /SQLite 硬限制|无法用 ALTER TABLE 补/,
    '不可补的列必须**显式拒绝**并给可读原因，不得静默跳过',
  )
  // 且不留半迁移态：其余本想补的列（update_history）也不得被加上去。
  assert.equal(colsOf(old, 'memory_items').length, beforeCols, '拒绝后不得留下任何半迁移列')
  assert.equal(colsOf(old, 'memory_items').includes('update_history'), false, '整体拒绝 ⇒ 同批的其它列也不许先加上去')
  assert.equal(srcSha(), before, '真源必须逐字节未变')
  old.close()
})
