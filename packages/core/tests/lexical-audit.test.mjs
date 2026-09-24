/**
 * A1-9 / A1-10 判据：审计不泄内容 + 中文召回非静默归零
 *
 * 判据原文（`docs/mana-rollout-plan.md:459-460`）：
 *
 *   **A1-9** 审计不泄内容 —— 对已知记忆内容做 ≤32 字节 n-gram 子串匹配
 *     ⇒ 命中 **0** 条内容片段（只应出现 id/哈希）。
 *
 *   **A1-10** 中文召回非静默归零（**负向判据**）—— 已知在库的中文串查询
 *     ⇒ 命中 **≥1**；若为 0 且库非空即判红。
 *
 * ⚠ **A1-10 背后的机制缺陷（本仓 2026-09-25 实测并修复）**：
 *   `memory_items_fts` 是 **external content** 虚表。它**不自动跟随主表** ——
 *   往 `memory_items` 插一行后，FTS 查询**仍返回 0 命中且不报错**。
 *   ⇒ 「中文召回恒 0」与「库里根本没有这条记忆」**表面完全同形**。
 *   修法 = 三个同步触发器（增/删/改）。本文件即该修复的判据。
 *
 * ⚠ trigram 语义（实测，用于避免假红）：索引按**连续 3 字滑窗**建，
 *   查询串的每个 3 字窗口都须命中（AND 语义）⇒ 跨词边界的子串（如
 *   `'末那识记'` 对文本 `'末那识的记忆'`）**本来就不该命中**，那不是缺陷。
 *   本判据只用**连续子串**，避免把 trigram 的正常行为误判为失败。
 */
import { test } from 'node:test'
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

function makeService() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-a1910-'))
  cleanups.push(dir)
  const opened = openManaDb({ path: join(dir, 'mana.db') })
  let svc = null
  const ctx = {
    effect(fn) {
      const d = fn()
      return () => (typeof d === 'function' ? d() : undefined)
    },
    provide(_n, s) {
      svc = s
      return () => {
        svc = null
      }
    },
    get: (n) => (n === 'mana-core' ? svc : undefined),
    on: () => () => {},
  }
  apply(ctx, {
    storePath: opened.path,
    busyTimeoutMs: 5000,
    autoMigrate: true,
    backupEnabled: false,
    backupIntervalMs: 3600000,
    backupKeep: 2,
    backupDir: '',
  })
  assert.ok(svc, 'apply() 应 provide mana-core')
  return { svc, close: () => opened.close() }
}

// ── F1（A1-10 正向）中文串真能召回 ≥1 ──────────────────────────────────────
test('F1 A1-10：库非空时中文串查询命中 ≥1（非静默归零）', () => {
  const { svc, close } = makeService()
  svc.writeMemoryItem({ id: 'm1', type: 'note', content: '末那识的记忆注入机制说明' })
  svc.writeMemoryItem({ id: 'm2', type: 'note', content: '工作记忆容量上限是四组块' })

  const r = svc.recallLexical('末那识的') // 连续子串（trigram 安全）
  assert.ok(r.hits.length >= 1, `库非空却 0 命中 ⇒ 判红（静默归零）。reason=${r.reason} librarySize=${r.librarySize}`)
  assert.equal(r.hits[0].id, 'm1')
  assert.equal(r.reason, null, '有命中时 reason 应为 null')

  const r2 = svc.recallLexical('工作记忆')
  assert.ok(r2.hits.length >= 1, '第二条也应可召回')
  assert.equal(r2.hits[0].id, 'm2')
  close()
})

// ── F2（A1-10 负向）0 命中的三种原因必须可分辨 ─────────────────────────────
test('F2 A1-10：0 命中的原因可分辨（库空 / 查询过短 / 真查不到）', () => {
  const { svc, close } = makeService()
  // ① 库空 ⇒ empty_library（0 命中是正常的）
  const empty = svc.recallLexical('末那识的记忆')
  assert.equal(empty.reason, 'empty_library')
  assert.equal(empty.librarySize, 0)

  // ② 查询过短 ⇒ too_short（trigram 下 2 字恒 0 且不报错 ⇒ 必须显式分类）
  svc.writeMemoryItem({ id: 'm1', type: 'note', content: '末那识的记忆注入机制说明' })
  const short = svc.recallLexical('末那')
  assert.equal(short.reason, 'too_short', '2 字查询必须被显式归类，不得混进"查不到"')
  assert.equal(short.normalizedQuery, null)

  // ③ 库非空但确实查不到 ⇒ reason='ok'（**这才是 A1-10 判红的形态**，判据侧据此区分）
  const miss = svc.recallLexical('量子纠缠退相干')
  assert.equal(miss.reason, 'ok')
  assert.ok(miss.librarySize > 0, 'librarySize 必须 >0 ⇒ 才能与 empty_library 分辨')
  assert.equal(miss.hits.length, 0)
  close()
})

// ── F3（A1-10 机制）触发器真同步：插入即可查、删除即失效 ────────────────────
test('F3 A1-10 机制：FTS 同步触发器真生效（插即可查、删即失效）', () => {
  const { svc, close } = makeService()
  svc.writeMemoryItem({ id: 'x1', type: 'note', content: '记忆巩固与遗忘曲线模型' })
  assert.ok(svc.recallLexical('记忆巩固').hits.length >= 1, '插入后立即可查（否则是静默归零）')

  svc.db.prepare('DELETE FROM memory_items WHERE id = ?').run('x1')
  assert.equal(svc.recallLexical('记忆巩固').hits.length, 0, '删除后必须从索引移除')

  // 更新也应同步（改内容后旧串失效、新串可查）
  svc.writeMemoryItem({ id: 'x2', type: 'note', content: '原始内容甲' })
  svc.db.prepare('UPDATE memory_items SET content = ? WHERE id = ?').run('更新后的内容乙', 'x2')
  assert.equal(svc.recallLexical('原始内容').hits.length, 0, '更新后旧内容应失效')
  assert.ok(svc.recallLexical('更新后的').hits.length >= 1, '更新后新内容应可查')
  close()
})

// ── F4（A1-9）审计载荷不泄内容：inject_log 只留 id/数值 ────────────────────
test('F4 A1-9：inject_log 不含记忆内容（≤32 字节 n-gram 命中 0）', () => {
  const { svc, close } = makeService()
  // 造一条**内容独特**的记忆，再把它的 id 写进审计（内容不得进审计）
  const SECRET = '这是一段绝不应出现在审计表里的记忆原文内容'
  svc.writeMemoryItem({ id: 'mem-secret', type: 'note', content: SECRET })
  svc.writeInjectLog({
    sessionId: 's1',
    turnId: 1,
    requestId: 'req-1',
    gate: 'injected',
    memoryId: 'mem-secret', // 只允许 id
    blockId: 'blk-1',
  })

  // 取审计行的**全部字段值**序列化，做 ≤32 字节 n-gram 子串匹配
  const rows = svc.listInjectLog('s1')
  assert.equal(rows.length, 1)
  const haystack = JSON.stringify(rows[0])
  const grams = []
  for (let i = 0; i + 3 <= SECRET.length; i += 1) grams.push(SECRET.slice(i, i + 3))
  const leaked = grams.filter((g) => haystack.includes(g))
  assert.equal(leaked.length, 0, `审计泄漏了内容片段：${JSON.stringify(leaked.slice(0, 3))}`)
  // 但 id 必须在（否则"不泄内容"被实现成"什么都不记"）
  assert.ok(haystack.includes('mem-secret'), '审计必须留 id（否则退化为"什么都不记"）')
  close()
})

// ── F5（A1-9）crafted 负例：若审计真写了内容，判据必须能抓到 ────────────────
test('F5 A1-9 判据有牙：审计写入内容时 n-gram 匹配必须命中', () => {
  const { svc, close } = makeService()
  const SECRET = '这是用于验证判据有牙的原文内容片段'
  // 变异形态：把内容写进 memory_id（正是要防的形态）
  svc.writeInjectLog({ sessionId: 's2', turnId: 1, requestId: 'r', gate: 'injected', memoryId: SECRET })
  const haystack = JSON.stringify(svc.listInjectLog('s2')[0])
  const grams = []
  for (let i = 0; i + 3 <= SECRET.length; i += 1) grams.push(SECRET.slice(i, i + 3))
  const leaked = grams.filter((g) => haystack.includes(g))
  assert.ok(leaked.length > 0, '判据必须有牙：内容若进了审计，n-gram 匹配必须命中（否则判据是摆设）')
  close()
})

// ── F6（A1-10 迁移面）存量行经迁移必须纳入索引（触发器只对新写入生效）────────
test('F6 A1-10：存量库迁移后，**存量行**也可召回（rebuild 承接）', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { createSchema } = await import(CORE)
  const { mkdtempSync: mk } = await import('node:fs')
  const { tmpdir: td } = await import('node:os')
  const { join: jn } = await import('node:path')
  const dir = mk(jn(td(), 'mana-f6-'))
  const db = new DatabaseSync(jn(dir, 'old.db'), { allowExtension: true })
  // 造「阶段 0 早期」的库：有表与虚表，**无触发器**
  db.exec(
    'CREATE TABLE memory_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, content TEXT NOT NULL, summary TEXT, created_at TEXT NOT NULL)',
  )
  db.exec(
    "CREATE VIRTUAL TABLE memory_items_fts USING fts5(content, summary, content='memory_items', content_rowid='rowid', tokenize='trigram')",
  )
  db.prepare('INSERT INTO memory_items (id,type,content,created_at) VALUES (?,?,?,?)').run(
    'old1', 'note', '存量库里的中文记忆内容', '2026-01-01',
  )
  const q = (t) => Number(db.prepare(`SELECT count(*) n FROM memory_items_fts WHERE memory_items_fts MATCH ?`).get(t).n)
  assert.equal(q('存量库里'), 0, '前置：无触发器 ⇒ 存量行不在索引里')

  createSchema(db)
  // ⚠ 触发器只对**之后的**写入生效；若不在迁移时 rebuild，存量记忆将**静默不可检索**。
  assert.ok(q('存量库里') >= 1, '迁移后存量行必须可召回（否则"迁移成功"与"存量静默丢失"同时成立）')
  db.close()
  rmSync(jn(dir, 'old.db'), { force: true })
  rmSync(dir, { recursive: true, force: true })
})
