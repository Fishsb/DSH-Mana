/**
 * B1.0 · 开库前置判据测试（阶段 1 首批）
 *
 * 覆盖：① 开库器封装 ② WAL 读回 ③ busy_timeout ④ 定期 backup
 *
 * 每条判据都对应一条**本仓实测**语义（见 src/open.ts 文件头表格），
 * 不写"应该"类断言。
 *
 * 运行：见根 package.json 的 test 脚本（glob 形式；禁止目录形式，见 A0-7）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const OPEN = new URL('../src/open.ts', import.meta.url).href
const DB = new URL('../src/db.ts', import.meta.url).href

const cleanups = []
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'mana-b10-'))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/** 造一个带数据的 WAL 库。 */
async function seeded(rows = 20) {
  const { openManaDb } = await import(DB)
  const dir = tmp()
  const opened = openManaDb({ path: join(dir, 'mana.db') })
  for (let i = 0; i < rows; i += 1) {
    opened.db
      .prepare(
        'INSERT INTO mana_trace (event_type, payload, session_id, turn_id, timestamp) VALUES (?,?,?,?,?)',
      )
      .run('observation', JSON.stringify({ i }), 's1', 1, new Date().toISOString())
  }
  return { opened, dir }
}

// ── ① 开库器封装：不可后补的窗口 ────────────────────────────────────────────
test('B1.0-① openManaDb 一律带 allowExtension 窗口（G4 不可后补）', async () => {
  const { openManaDb } = await import(DB)
  const dir = tmp()
  const opened = openManaDb({ path: join(dir, 'a.db') })
  assert.equal(opened.extensionWindowOpen, true)
  assert.doesNotThrow(() => opened.db.enableLoadExtension(true), '窗口必须在开库时就开着')
  opened.close()
})

test('B1.0-① 备份件也走同一开库口径（还原后仍可上扩展）', async () => {
  const { backupNow, restoreBackup } = await import(OPEN)
  const { opened, dir } = await seeded(5)
  const bak = await backupNow(opened.db, opened.path, join(dir, 'b.db'))
  opened.close()

  const restored = restoreBackup(bak.path, join(dir, 'restored.db'))
  assert.equal(restored.extensionWindowOpen, true, '还原件必须保有扩展窗口，否则永久上不了 vec0')
  assert.doesNotThrow(() => restored.db.enableLoadExtension(true))
  restored.close()
})

// ── ② WAL 读回必须走 prepare().get() ───────────────────────────────────────
test('B1.0-② WAL 生效且读回走 prepare().get()（exec 返回 undefined ⇒ 不能用 exec 判）', async () => {
  const { opened } = await seeded(1)
  assert.equal(opened.journalMode, 'wal')
  assert.equal(opened.db.exec('PRAGMA journal_mode=WAL'), undefined, 'exec 就读回值 ⇒ 拿它判 WAL 会恒假')
  opened.close()
})

// ── ③ busy_timeout ─────────────────────────────────────────────────────────
test('B1.0-③ busy_timeout 已设且可读回（默认 0 会立即 database is locked）', async () => {
  const { opened } = await seeded(1)
  assert.equal(opened.busyTimeoutMs, 5000)
  opened.close()
})

// ── ④ backup：四条实测语义 ─────────────────────────────────────────────────
test('B1.0-④ backup 返回 Promise<页数>，且备份件可读、行数对得上', async () => {
  const { backupNow } = await import(OPEN)
  const { opened, dir } = await seeded(20)
  const r = await backupNow(opened.db, opened.path, join(dir, 'b.db'))

  assert.ok(Number.isFinite(r.pages) && r.pages > 0, `pages 必须是有限数（实测 ${r.pages}）`)
  assert.ok(r.bytes > 0, '备份文件不得为 0 字节')
  assert.equal(r.traceRows, 20, '备份后的回读校验：行数必须与源一致')
  assert.equal(r.journalMode, 'wal', '备份件 journal_mode 实测继承 wal')
  opened.close()
})

test('B1.0-④ WAL 未 checkpoint 的数据也进备份（不必先 checkpoint）', async () => {
  const { backupNow } = await import(OPEN)
  const { opened, dir } = await seeded(500)
  const walExists = existsSync(opened.path + '-wal')
  const r = await backupNow(opened.db, opened.path, join(dir, 'b.db'))
  assert.equal(r.traceRows, 500, `WAL 中存在未落主文件的数据（wal=${walExists}），备份必须仍拿到 500`)
  opened.close()
})

test('B1.0-④ 目标目录不存在时自动自建（否则是「静默的备份缺失」）', async () => {
  const { backupNow } = await import(OPEN)
  const { opened, dir } = await seeded(3)
  const nested = join(dir, 'deep', 'nested')
  assert.equal(existsSync(nested), false, '前置：目录确实不存在')
  const r = await backupNow(opened.db, opened.path, join(nested, 'x.db'))
  assert.equal(existsSync(r.path), true, '必须自动建父目录并落盘')
  opened.close()
})

test('B1.0-④ 备份后源库继续写，已完成的备份不受影响（快照语义）', async () => {
  const { backupNow } = await import(OPEN)
  const { opened, dir } = await seeded(10)
  const r = await backupNow(opened.db, opened.path, join(dir, 'b.db'))
  opened.db
    .prepare('INSERT INTO mana_trace (event_type,payload,session_id,turn_id,timestamp) VALUES (?,?,?,?,?)')
    .run('observation', '{}', 's1', 1, new Date().toISOString())
  const snapshot = new DatabaseSync(r.path)
  const c = snapshot.prepare('SELECT count(*) c FROM mana_trace').get().c
  snapshot.close()
  assert.equal(c, 10, '备份是快照：源库后续写入不得回头影响它')
  opened.close()
})

// ── 轮转：只留最近的，且删的是最旧的 ───────────────────────────────────────
test('B1.0-④ 轮转保留最近 keep 个，删的是最旧（字典序即时间序）', async () => {
  const { pruneBackups, backupNow } = await import(OPEN)
  const { opened, dir } = await seeded(2)
  const bdir = join(dir, 'backups')
  // 造 5 个时间递增的备份（文件名时间戳精确到毫秒 ⇒ 天然有序）
  for (let i = 0; i < 5; i += 1) {
    await backupNow(opened.db, opened.path, join(bdir, `mana-2026-01-0${i + 1}T00-00-00-000Z.db`))
    await new Promise((r) => setTimeout(r, 5))
  }
  const removed = pruneBackups(bdir, 2)
  assert.equal(removed.length, 3, '5 个留 2 ⇒ 删 3')
  assert.deepEqual(removed, [
    'mana-2026-01-01T00-00-00-000Z.db',
    'mana-2026-01-02T00-00-00-000Z.db',
    'mana-2026-01-03T00-00-00-000Z.db',
  ], '必须删最旧的三个')
  const left = (await import('node:fs')).readdirSync(bdir).filter((f) => f.endsWith('.db'))
  assert.equal(left.length, 2)
  opened.close()
})

test('B1.0-④ 半截备份不留残骸：.partial 不会被当成一次备份', async () => {
  const { backupNow, pruneBackups } = await import(OPEN)
  const { opened, dir } = await seeded(2)
  const bdir = join(dir, 'backups')
  await backupNow(opened.db, opened.path, join(bdir, 'mana-2026-02-01T00-00-00-000Z.db'))
  // 模拟上一轮崩在 .partial 上
  writeFileSync(join(bdir, 'mana-2026-02-02T00-00-00-000Z.db.partial'), 'half-baked')
  const removed = pruneBackups(bdir, 1)
  assert.deepEqual(removed, [], '.partial 不计入轮转（只有 1 个真备份）')
  const files = (await import('node:fs')).readdirSync(bdir)
  assert.ok(files.some((f) => f.endsWith('.partial')), '本函数不负责清 .partial（由 backupNow 在下次备份时清）')
  opened.close()
})

// ── 还原：必须先保住现状（G10 回滚失败不可观测）─────────────────────────────
test('B1.0-④ 还原前把现有库另存（避免还原失败且原库已毁）', async () => {
  const { backupNow, restoreBackup } = await import(OPEN)
  const { opened, dir } = await seeded(7)
  const bak = await backupNow(opened.db, opened.path, join(dir, 'b.db'))
  opened.close()

  const target = join(dir, 'target.db')
  // 造一个"现状"目标库，行数不同
  const { openManaDb } = await import(DB)
  const pre = openManaDb({ path: target })
  pre.db.prepare('INSERT INTO mana_trace (event_type,payload,session_id,turn_id,timestamp) VALUES (?,?,?,?,?)')
    .run('observation', '{}', 's', 1, new Date().toISOString())
  pre.close()

  const r = restoreBackup(bak.path, target)
  r.close()
  const files = (await import('node:fs')).readdirSync(dir)
  assert.ok(
    files.some((f) => f.startsWith('target.db.pre-restore-')),
    '还原前必须留下现状副本，否则回滚失败不可观测',
  )
  const check = new DatabaseSync(target)
  assert.equal(check.prepare('SELECT count(*) c FROM mana_trace').get().c, 7, '还原后行数 = 备份时行数')
  check.close()
})

test('B1.0-④ 空备份文件必须被拒（不得静默还原出一个空库）', async () => {
  const { restoreBackup } = await import(OPEN)
  const dir = tmp()
  const empty = join(dir, 'empty.db')
  writeFileSync(empty, '')
  assert.throws(() => restoreBackup(empty, join(dir, 'x.db')), /空文件/)
  assert.throws(() => restoreBackup(join(dir, 'missing.db'), join(dir, 'y.db')), /备份不存在/)
})

// ── 定期备份定时器 ─────────────────────────────────────────────────────────
test('B1.0-④ 定期备份：未启用时不起定时器；启用后真落盘', async () => {
  const { startBackupTimer, DEFAULT_BACKUP_POLICY, resolveBackupDir } = await import(OPEN)
  const { opened, dir } = await seeded(3)

  const off = startBackupTimer(opened.db, opened.path, DEFAULT_BACKUP_POLICY, () => {})
  assert.equal(typeof off, 'function')
  const bdir = resolveBackupDir(opened.path, '')
  assert.equal(existsSync(bdir), false, '未启用时不得产生备份目录')

  const stop = startBackupTimer(
    opened.db,
    opened.path,
    { enabled: true, intervalMs: 60, keep: 3, dir: '' },
    (e) => { throw e },
  )
  await new Promise((r) => setTimeout(r, 250))
  stop()
  assert.equal(existsSync(bdir), true, '启用后必须真落盘')
  const n = (await import('node:fs')).readdirSync(bdir).filter((f) => f.endsWith('.db')).length
  assert.ok(n >= 1, `至少落一个备份（实测 ${n}）`)
  opened.close()
})

test('B1.0-④ 备份失败必须显式上报，不得静默（G8）', async () => {
  const { startBackupTimer } = await import(OPEN)
  const { opened, dir } = await seeded(1)
  const errors = []
  // ⚠ 失败场景必须选**真实且可复现**的：这里用「父路径是一个文件」⇒ mkdir 报 ENOTDIR。
  //   早期版本用 /proc/nonexistent/... —— 那个路径会让 node 进程**静默死掉**
  //   （无输出、无异常、exit 0），表现为"测试卡住"，完全指不到真因。
  //   判据的失败工况也必须是可解释的，否则会把工具怪癖当成被测对象的缺陷。
  const blocker = join(dir, 'i-am-a-file')
  writeFileSync(blocker, 'not a directory')
  const stop = startBackupTimer(
    opened.db,
    opened.path,
    { enabled: true, intervalMs: 50, keep: 1, dir: join(blocker, 'backups') },
    (e) => errors.push(e),
  )
  await new Promise((r) => setTimeout(r, 300))
  stop()
  assert.ok(errors.length >= 1, '备份失败必须走 onError 上报（静默失败正是 G8 要防的）')
  assert.ok(errors[0], '上报的应当是错误对象')
  opened.close()
})
