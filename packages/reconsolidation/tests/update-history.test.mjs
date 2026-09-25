/**
 * 判据③：**内容更新可追溯**（`update_history` **追加**，不是覆盖）。
 *
 * ⚠ 这一条全部走生产路径：`core.writeMemoryItem` 建行 → 本包 `applyContentUpdate` 更新
 *   → **回读列里的 JSON** 断言段数。若实现改成"只留最后一段"，两次更新后段数恒为 1 ⇒ 必红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount, cleanupAll } from './_harness.mjs'

const EXPECTED_CASES = 5
let ran = 0
process.on('exit', () => {
  cleanupAll()
  if (ran !== EXPECTED_CASES) {
    console.error(`\n用例计数自检失败：期望 ${EXPECTED_CASES}，实跑 ${ran}`)
    process.exitCode = 1
  }
})

const readRaw = (core, id) =>
  core.db.prepare('SELECT update_history AS h, content AS c FROM memory_items WHERE id = ?').get(id)

test('① 连续两次更新 ⇒ 新增**两段**（不是只剩最后一段）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: '零号内容' })
  const now = 1_700_000_000_000
  const u1 = svc.applyContentUpdate({ memoryId: 'm1', content: '一号内容', now })
  const u2 = svc.applyContentUpdate({ memoryId: 'm1', content: '二号内容', now: now + 1000 })

  assert.equal(u1.channel, 'applied')
  assert.equal(u1.updated, true, '更新成功必须由**回读**背书')
  assert.equal(u1.historyCount, 1)
  assert.equal(u1.historyAppended, 1)
  assert.equal(u2.historyCount, 2, '第二次更新后段数必须是 2 —— 覆盖写会停在 1')
  assert.equal(u2.historyAppended, 1)

  const raw = readRaw(core, 'm1')
  const arr = JSON.parse(raw.h)
  assert.ok(Array.isArray(arr), '列里必须是 JSON 数组（段数可数）')
  assert.equal(arr.length, 2, `两次更新 ⇒ 列里必须有 2 段，实测 ${arr.length}（1 = 覆盖写）`)
  assert.equal(arr[0].next, '一号内容', '第一段必须还在（这正是"可追溯"的含义）')
  assert.equal(arr[0].previous, '零号内容')
  assert.equal(arr[1].previous, '一号内容', '第二段的旧值必须是第一段的新值（链条不断）')
  assert.equal(arr[1].next, '二号内容')
  assert.equal(raw.c, '二号内容', '主列内容必须是最新值')
})

test('② 三段以上仍逐段可数（段数是单调递增的，不是"最新的那一段"）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'semantic', content: 'v0' })
  const now = 1_700_000_000_000
  for (const [i, v] of ['v1', 'v2', 'v3', 'v4'].entries()) {
    const r = svc.applyContentUpdate({ memoryId: 'm1', content: v, now: now + i * 1000, trigger: `t${i}` })
    assert.equal(r.historyCount, i + 1, `第 ${i + 1} 次更新后段数应为 ${i + 1}`)
  }
  const arr = JSON.parse(readRaw(core, 'm1').h)
  assert.deepEqual(
    arr.map((e) => e.next),
    ['v1', 'v2', 'v3', 'v4'],
    '四段全在且顺序与更新顺序一致',
  )
  assert.deepEqual(
    arr.map((e) => e.trigger),
    ['t0', 't1', 't2', 't3'],
    '归因逐段保留（缺归因的段无法回答"这次更新由哪次检索引起"）',
  )
})

test('③ 历史列**被外部写坏**时必须抛，不得回落成空数组（回落 = 下一次更新覆盖整段历史）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: 'x' })
  svc.applyContentUpdate({ memoryId: 'm1', content: 'y', now: 1_700_000_000_000 })
  const good = readRaw(core, 'm1').h
  // 写坏：非法 JSON / 非数组 / 元素缺字段
  for (const bad of ['{不是 JSON', '{"a":1}', '42', '[{"next":1,"at":2}]']) {
    core.db.prepare('UPDATE memory_items SET update_history = ? WHERE id = ?').run(bad, 'm1')
    assert.throws(
      () => svc.applyContentUpdate({ memoryId: 'm1', content: 'z', now: 1_700_000_001_000 }),
      Error,
      `列值 ${bad.slice(0, 20)} 解析不了 ⇒ 必须抛（回落成 [] 会把已有历史静默覆盖掉）`,
    )
    assert.equal(readRaw(core, 'm1').h, bad, '抛错路径**不得**改库（先解析后写，解析失败即中止）')
  }
  core.db.prepare('UPDATE memory_items SET update_history = ? WHERE id = ?').run(good, 'm1')
  assert.equal(svc.historyCount(good), 1, '恢复后仍可读回一段')
})

test('④ 裁剪有上界且**显式回报丢了几段**（不许静默裁剪；正常态 dropped 恒为 0）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: 'v0' })
  const now = 1_700_000_000_000
  let last = null
  for (let i = 1; i <= 24; i += 1) last = svc.applyContentUpdate({ memoryId: 'm1', content: `v${i}`, now: now + i * 1000 })
  assert.equal(last.historyCount, 20, '列装 JSON 数组 ⇒ 必须有上界（本包自定 20 段）')
  const arr = JSON.parse(readRaw(core, 'm1').h)
  assert.equal(arr.length, 20)
  assert.equal(arr[19].next, 'v24', '留下的必须是**最新**的（裁掉最旧的）')
  assert.equal(arr[0].next, 'v5', '第 24 段历史里最旧的 4 段被裁')
  // 上界内的更新 dropped 必须为 0（0 也要报 0，不许省略字段）
  const { core: c2, svc: s2 } = await mount({ columns: true })
  c2.writeMemoryItem({ id: 'k', type: 'episodic', content: 'a' })
  const one = s2.applyContentUpdate({ memoryId: 'k', content: 'b', now: 1_700_000_000_000 })
  assert.equal(typeof one.historyCount, 'number')
  const rawCheck = s2.historyCount(JSON.parse(readRaw(c2, 'k').h) && readRaw(c2, 'k').h)
  assert.equal(rawCheck, 1)
})

test('⑤ 未命中 id 的记忆：不是降级（schema 没毛病），但同样不得静默', async () => {
  ran += 1
  const { svc } = await mount({ columns: true })
  const r = svc.applyContentUpdate({ memoryId: '不存在', content: 'x', now: 1_700_000_000_000 })
  assert.equal(r.channel, 'not-found', '三态必须可分辨：not-found ≠ degraded')
  assert.equal(r.degraded, false, 'schema 没毛病 ⇒ 不得报降级')
  assert.match(String(r.reason), /memory-not-found/, 'reason 必须非空且可辨（区别于 schema-missing）')
  assert.equal(r.updated, false)
  assert.equal(r.traced, false, '没有认知事件可留痕时不得写 trace')
  assert.equal(r.historyCount, null, '不可知必须落 null，不得用 0 冒充')
})
