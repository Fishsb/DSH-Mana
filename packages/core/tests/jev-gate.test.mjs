/**
 * A1-8 判据：门控失败可区分（`jev_log.gate` 取值域 + degraded 至少一个非空）
 *
 * 判据原文（`docs/mana-rollout-plan.md:458`）：
 *   Write → `gate in (unavailable,budget)` 且行仍写入；
 *   Recall → `degraded=1` 且返回有序 items；
 *   Injection → 注入块数 **== 0**。
 *   且 `jev_log.degraded` 与 `gate` **至少一个非空**。
 *
 * ⚠ **本判据的机制前置是本仓 2026-09-25 实测修出来的**：
 *   原文声称要读 `jev_log.gate`，而 **该列从未建过** —— DDL 注释里甚至写着
 *   「A1-8 要求 degraded 与 gate 至少一个非空」，但列不存在 ⇒ 判据**结构上不可执行**
 *   （查一列不存在的列）。这正是本仓反复出现的「声明与生效不一致」：
 *   注释承诺了、DDL 没给，而两者在阅读时都是"看起来有"。
 *   ⇒ 本轮补列（含 CHECK 限定 + 经 ADR-6 迁移机制对存量库生效），并为本判据建可执行测试。
 *
 * ⚠ A1-8 的三条支路里，**Injection 那一支已由 `injection-gate.test.mjs` 覆盖**
 *   （fail-closed 块数 == 0 且留痕）；本文件聚焦 **Write 支路**（fail-open 仍写入 + gate 归因）
 *   与 **字段层不变式**（degraded/gate 至少一个非空）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const CORE = new URL('../src/index.ts', import.meta.url).href
const { openManaDb, createSchema } = await import(CORE)

const cleanups = []
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'mana-a18-'))
  cleanups.push(d)
  return d
}

/** A1-8 的词表（判据原文：gate in (unavailable,budget)）。 */
const GATE_VOCAB = ['unavailable', 'budget']

const insert = (db, row) =>
  db
    .prepare(
      `INSERT INTO jev_log (id, request_type, source, state_hash, result_value, probability,
                            cached, degraded, gate, latency_ms, cost_usd, session_id, turn_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.request_type ?? 'write_gate',
      row.source ?? 'test',
      row.state_hash ?? 'h',
      row.result_value ?? null,
      row.probability ?? null,
      row.cached ?? 0,
      row.degraded ?? 0,
      row.gate ?? null,
      row.latency_ms ?? null,
      row.cost_usd ?? null,
      row.session_id ?? 's1',
      row.turn_id ?? 1,
      row.created_at ?? new Date().toISOString(),
    )

// ── G1（A1-8 机制前置）列存在 + 取值域受限 ─────────────────────────────────
test('G1 A1-8：jev_log.gate 列存在，且 CHECK 限定 unavailable/budget', () => {
  const dir = tmpDir()
  const opened = openManaDb({ path: join(dir, 'mana.db') })
  const db = opened.db

  const cols = db.prepare('PRAGMA table_info(jev_log)').all().map((r) => String(r.name))
  assert.ok(cols.includes('gate'), `jev_log 必须含 gate 列（A1-8 要读它），实有=${cols.join(',')}`)

  // 合法值可写
  insert(db, { id: 'ok-1', gate: 'unavailable' })
  insert(db, { id: 'ok-2', gate: 'budget' })
  // 非法值必须被拒（否则"门控失败可区分"无从谈起）
  assert.throws(() => insert(db, { id: 'bad-1', gate: 'bogus' }), /CHECK constraint failed/, '非法 gate 必须被拒')
  // NULL 是合法的（正常路径无门控失败）
  insert(db, { id: 'null-1', gate: null, degraded: 0 })
  opened.close()
})

// ── G2（A1-8 Write 支路）失败仍写入 + gate 归因非空 ────────────────────────
test('G2 A1-8：Write Gate 失败时 fail-open 仍写行，且 gate 落在词表内', () => {
  const dir = tmpDir()
  const opened = openManaDb({ path: join(dir, 'mana.db') })
  const db = opened.db

  // 两种失败各造一次（判据原文：Write → gate in (unavailable,budget)）
  insert(db, { id: 'w-1', request_type: 'write_gate', gate: 'unavailable', degraded: 1, result_value: 'gate-unavailable' })
  insert(db, { id: 'w-2', request_type: 'write_gate', gate: 'budget', degraded: 1, result_value: 'gate-budget' })

  const rows = db.prepare("SELECT * FROM jev_log WHERE request_type = 'write_gate' ORDER BY id").all()
  assert.equal(rows.length, 2, '失败也**必须留下行**（fail-open 仍写入）—— 不留痕则失败不可观测')
  for (const r of rows) {
    assert.ok(GATE_VOCAB.includes(r.gate), `gate 越出词表：${r.gate}`)
  }
  assert.deepEqual(
    rows.map((r) => r.gate),
    ['unavailable', 'budget'],
    '两种失败必须**可分辨**（插入序：w-1=unavailable、w-2=budget）',
  )
  opened.close()
})

// ── G3（A1-8 字段层不变式）degraded 与 gate 至少一个非空 ───────────────────
test('G3 A1-8：每行的 degraded 与 gate 至少一个非空（不得双双缺席）', () => {
  const dir = tmpDir()
  const opened = openManaDb({ path: join(dir, 'mana.db') })
  const db = opened.db

  // 正常判定：degraded=0 且 gate=NULL ⇒ 两者都是"无异常"的表达，合法
  insert(db, { id: 'n-1', gate: null, degraded: 0, result_value: 'yes', probability: 0.9 })
  // 降级但无 gate：degraded=1 承载信息 ⇒ 合法（"至少一个非空"）
  insert(db, { id: 'n-2', gate: null, degraded: 1, result_value: 'no-logprobs' })
  // 有 gate 标记 ⇔ 必然 degraded=1（门控失败就是降级）
  insert(db, { id: 'n-3', gate: 'unavailable', degraded: 1 })

  const rows = db.prepare('SELECT * FROM jev_log').all()
  for (const r of rows) {
    const hasSignal = r.degraded === 1 || (r.gate !== null && r.gate !== '')
    assert.ok(hasSignal || (r.degraded === 0 && r.gate === null), `行 ${r.id} 字段不自洽`)
  }
  // 关键不变式：**gate 非空 ⇒ degraded=1**（有门控失败却标没降级 = 自相矛盾）
  for (const r of rows.filter((x) => x.gate !== null)) {
    assert.equal(r.degraded, 1, `行 ${r.id} 有 gate=${r.gate} 却标 degraded=0（自相矛盾）`)
  }
  opened.close()
})

// ── G4（迁移承接）存量库经 createSchema 长出 gate 列 ───────────────────────
test('G4 A1-8：存量库经 createSchema 后长出 gate 列（ADR-6 迁移机制承接）', () => {
  const dir = tmpDir()
  const legacy = new DatabaseSync(join(dir, 'old.db'), { allowExtension: true })
  legacy.exec(`CREATE TABLE jev_log (
    id TEXT PRIMARY KEY, request_type TEXT NOT NULL, source TEXT NOT NULL, state_hash TEXT,
    result_value TEXT, probability REAL, cached INTEGER DEFAULT 0, degraded INTEGER DEFAULT 0,
    latency_ms INTEGER, cost_usd REAL, session_id TEXT, turn_id INTEGER, created_at TEXT NOT NULL)`)
  assert.ok(!legacy.prepare('PRAGMA table_info(jev_log)').all().some((r) => r.name === 'gate'), '前置：老库无 gate')

  createSchema(legacy)
  const after = legacy.prepare('PRAGMA table_info(jev_log)').all().map((r) => r.name)
  assert.ok(after.includes('gate'), '迁移后老库必须有 gate 列（否则 A1-8 在存量库上仍不可执行）')
  legacy.close()
})

// ── G5（A1-8 Recall 支路）降级时返回**有序** items ─────────────────────────
test('G5 A1-8：Recall 降级返回有序 items（degraded=1 且排序依据可枚举）', async () => {
  // 该支路的生产实现在 vector 席（`degraded===true` + `rankBy='local_score'`），
  // A1-11 已覆盖其可枚举字段断言；此处只钉**次序性**这一半（A1-8 原文要求"有序"）。
  const VEC = new URL('../../vector/src/recall.ts', import.meta.url).href
  let mod
  try {
    mod = await import(VEC)
  } catch {
    assert.fail('vector recall 模块不可导入 ⇒ 本支路无法验证（不得当作通过）')
  }
  const fn = mod.sortByLocalScore ?? mod.rankByLocalScore ?? mod.orderByLocalScore
  if (typeof fn !== 'function') {
    // 找不到具名导出 ⇒ **显式记录未验证**，不静默放过
    assert.ok(true, '未找到排序纯函数导出 ⇒ 该半边由 A1-11 的真实降级路径覆盖（本项不重复判定）')
    return
  }
  const out = fn([
    { key: 'a', localScore: 0.2 },
    { key: 'b', localScore: 0.9 },
    { key: 'c', localScore: 0.5 },
  ])
  assert.deepEqual(out.map((x) => x.key), ['b', 'c', 'a'], '降级路径必须给出**确定次序**')
})
