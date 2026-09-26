// writeMemoryItem UPSERT 判据 —— 重写不得清空未提供的列（2026-09-26）
//
// ⚠ 本判据的**要害**：修前用 `INSERT OR REPLACE`（= DELETE + INSERT）且只列 5 列，
//   对同一 id 重写会把**未列出的列全部重置**。实测真库上被静默清空 7 列，其中 `vector` BLOB→null
//   会让**向量检索的数据源被打空，而读侧只看到「没命中」**——与「库本来就空」同形。
//
// 反证对拍（不得只信注释）：把 src 的 UPSERT 变异回 `INSERT OR REPLACE` ⇒ 本文件必红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const CORE = new URL('../src/index.ts', import.meta.url).href
const { openManaDb, apply } = await import(CORE)

const cleanups = []
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/** 临时库 + 真 core 服务面。⚠ 绝不指向真实库：路径由 mkdtempSync 生成，用后即删。 */
function withCore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-upsert-'))
  cleanups.push(dir)
  const dbPath = join(dir, 'mana.db')
  assert.ok(dbPath.startsWith(tmpdir()), `临时库必须在 tmpdir 内，实测 ${dbPath}`)
  const opened = openManaDb({ path: dbPath })
  let svc = null
  const ctx = {
    effect(f) { const d = f(); return () => (typeof d === 'function' ? d() : undefined) },
    provide(_n, s) { svc = s; return () => { svc = null } },
    get: (n) => (n === 'mana-core' ? svc : undefined),
    on: () => () => {},
  }
  apply(ctx, {
    storePath: dbPath, busyTimeoutMs: 5000, autoMigrate: true,
    backupEnabled: false, backupIntervalMs: 3600000, backupKeep: 2, backupDir: '',
  })
  assert.ok(svc, 'apply() 应 provide mana-core')
  try { return fn(svc, opened) } finally { opened.close() }
}

test('① 重写：未提供的列必须原样保留（修前 7 列被静默清空）', () => {
  withCore((svc) => {
    svc.writeMemoryItem({ id: 'm1', type: 'note', content: '原始', summary: 's0' })
    // 模拟正常生命周期：这些列由别的路径回填
    svc.db.prepare(
      'UPDATE memory_items SET retired = 1, access_count = 7, base_level_activation = -1.5, ' +
      'reconsolidation_window_until = ?, update_history = ?, vector = ?, created_at = ? WHERE id = ?',
    ).run('2026-02-01T00:00:00.000Z', '["a"]', new Uint8Array([1, 2, 3]), '2026-01-01T00:00:00.000Z', 'm1')

    // ⚠ 断言要用到的列都必须在 cols 里（我第一版漏了 content ⇒ after.content 恒 undefined）
    const cols = 'content, summary, retired, access_count, base_level_activation, reconsolidation_window_until, update_history, vector, created_at'
    const before = svc.db.prepare(`SELECT ${cols} FROM memory_items WHERE id = ?`).get('m1')
    assert.equal(Number(before.retired), 1, '前置：retired 应为 1')

    // ★ 重写（同 id）—— 修前这一步会把上面 7 列全部打回默认
    svc.writeMemoryItem({ id: 'm1', type: 'note', content: '改过', summary: 's1' })
    const after = svc.db.prepare(`SELECT ${cols} FROM memory_items WHERE id = ?`).get('m1')

    assert.equal(Number(after.retired), 1, 'retired 不得被静默复活（软删除可逆但不得自发撤销）')
    assert.equal(Number(after.access_count), 7, 'access_count 不得被清零')
    assert.equal(after.base_level_activation, -1.5, 'base_level_activation（ACT-R）不得被清零')
    assert.equal(after.reconsolidation_window_until, '2026-02-01T00:00:00.000Z', '再巩固窗口不得丢失')
    assert.equal(after.update_history, '["a"]', 'update_history 不得丢失')
    assert.ok(after.vector && after.vector.length > 0, '★ vector BLOB 不得被打空（否则向量检索数据源没了，读侧只见「没命中」）')
    assert.equal(after.created_at, '2026-01-01T00:00:00.000Z', 'created_at 是首见时刻，重写不得篡改')

    // 而本次真正提供的列必须更新
    assert.equal(after.content, '改过', 'content 应被更新')
    assert.equal(after.summary, 's1', 'summary 应被更新')
  })
})

test('② 首次写入仍应正常落值（UPSERT 不得把 INSERT 路径弄坏）', () => {
  withCore((svc) => {
    svc.writeMemoryItem({ id: 'new1', type: 'note', content: 'c', summary: null, at: '2026-03-03T00:00:00.000Z' })
    const row = svc.db.prepare('SELECT content, created_at, retired FROM memory_items WHERE id = ?').get('new1')
    assert.equal(row.content, 'c')
    assert.equal(row.created_at, '2026-03-03T00:00:00.000Z', '首次写入 created_at 必须用 provided at')
    assert.equal(Number(row.retired), 0)
  })
})

test('③ 重写不产生重复行（主键仍唯一）', () => {
  withCore((svc) => {
    svc.writeMemoryItem({ id: 'dup', type: 'note', content: 'a' })
    svc.writeMemoryItem({ id: 'dup', type: 'note', content: 'b' })
    const n = svc.db.prepare('SELECT count(*) n FROM memory_items WHERE id = ?').get('dup').n
    assert.equal(Number(n), 1, 'UPSERT 必须仍只留一行')
  })
})