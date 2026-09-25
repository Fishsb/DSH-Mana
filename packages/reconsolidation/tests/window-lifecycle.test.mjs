/**
 * 判据②：**窗口开闭走生产路径**（注入一条 ⇒ `until === now + windowMs(type)`，真写库并回读）。
 *
 * ⚠ "生产路径"的判据含义（本仓"夹具绿 ≠ 真数据绿"）：记忆行由 `core.writeMemoryItem` 建，
 *   窗口列由**本包服务面**写，结论由**回读 SQL** 得出 —— 没有一条是测试自己直写自己读。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount, cleanupAll, TWO_COLUMNS } from './_harness.mjs'

const EXPECTED_CASES = 4
let ran = 0
process.on('exit', () => {
  cleanupAll()
  if (ran !== EXPECTED_CASES) {
    console.error(`\n用例计数自检失败：期望 ${EXPECTED_CASES}，实跑 ${ran}`)
    process.exitCode = 1
  }
})

test('① 注入一条 ⇒ 开窗：until === now + windowMs(type)，列里的值可回读且与之逐字一致', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: '被检索并注入的记忆' })
  const now = 1_700_000_000_000
  const r = svc.openWindow({ memoryId: 'm1', type: 'semantic', now, trigger: 'inject:log:1' })
  assert.equal(r.channel, 'applied')
  assert.equal(r.degraded, false)
  assert.equal(r.reason, null)
  assert.equal(r.until, now + mod_ms('semantic'), 'until 必须等于 now + windowMs(type)')
  assert.equal(r.persisted, true, 'persisted 必须来自**回读**（写成功 ≠ 值对）')
  const row = core.db.prepare('SELECT reconsolidation_window_until AS w FROM memory_items WHERE id = ?').get('m1')
  assert.equal(row.w, r.untilIso, '列里的 ISO 串必须与返回值逐字一致')
  assert.ok(Math.abs(Date.parse(row.w) - r.until) <= 1e-6, 'ISO ↔ 毫秒换算绝对差 ≤1e-6')
  assert.equal(svc.isWindowOpen('m1', now + 1), true, '开窗后读侧必须为开')
})

test('② 到点关闭（重新稳定化）：未到点不关，到点关且列回读为 NULL', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'procedural', content: '程序性记忆' })
  const now = 1_700_000_000_000
  const open = svc.openWindow({ memoryId: 'm1', type: 'procedural', now })
  assert.equal(open.until, now + 6 * 60 * 60 * 1000)
  // 未到点（差 1ms）⇒ 一条都不该关
  const early = svc.closeDueWindows({ now: open.until - 1 })
  assert.deepEqual(early.closed, [], '未到点不得关闭')
  assert.equal(early.scanned, 0)
  assert.equal(readW(core, 'm1'), open.untilIso, '未到点 ⇒ 列值必须逐字不变')
  // 到点（边界：now === until 即算到点，口径同 windowOpen）
  const due = svc.closeDueWindows({ now: open.until })
  assert.deepEqual(due.closed, ['m1'], '到点必须关闭，且以**回读**为准')
  assert.equal(readW(core, 'm1'), null, '关闭后列必须回读为 NULL')
  assert.equal(svc.isWindowOpen('m1', open.until), false)
})

test('③ 关窗是幂等读改：重复调用不重复计（"以为关了"不得冒充关过）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: 'x' })
  core.writeMemoryItem({ id: 'm2', type: 'semantic', content: 'y' })
  const now = 1_700_000_000_000
  svc.openWindow({ memoryId: 'm1', type: 'episodic', now })
  svc.openWindow({ memoryId: 'm2', type: 'semantic', now })
  const far = now + 10 * 60 * 60 * 1000
  assert.deepEqual(svc.closeDueWindows({ now: far }).closed, ['m1', 'm2'], '两条都到点（按 id 升序回读）')
  const again = svc.closeDueWindows({ now: far })
  assert.deepEqual(again.closed, [], '第二次不得再报"关闭了"（幂等）')
  assert.equal(again.scanned, 0)
  assert.equal(again.traced, false, '无动作就不得写 trace（否则 trace 表被空动作灌水）')
})

test('④ 两条记忆各自的窗口互不串台（类型不同 ⇒ 窗长不同 ⇒ 到点时刻不同）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'e1', type: 'episodic', content: 'e' })
  core.writeMemoryItem({ id: 'p1', type: 'procedural', content: 'p' })
  const now = 1_700_000_000_000
  const a = svc.openWindow({ memoryId: 'e1', type: 'episodic', now })
  const b = svc.openWindow({ memoryId: 'p1', type: 'procedural', now })
  assert.equal(a.until, now + 30 * 60 * 1000)
  assert.equal(b.until, now + 6 * 60 * 60 * 1000)
  // 情景到点而程序性未到点 ⇒ 只关前者
  const mid = svc.closeDueWindows({ now: now + 60 * 60 * 1000 })
  assert.deepEqual(mid.closed, ['e1'], '只有到点的那条被关')
  assert.equal(readW(core, 'p1'), b.untilIso, '另一条的窗口必须逐字不变（不得被顺带清掉）')
})

/** 夹具自带的毫秒换算（**不**复用模块导出，避免自指）。 */
function mod_ms(type) {
  const T = { episodic: 1800000, semantic: 7200000, procedural: 21600000, emotional: 3600000 }
  return T[type]
}
function readW(core, id) {
  const r = core.db.prepare('SELECT reconsolidation_window_until AS w FROM memory_items WHERE id = ?').get(id)
  return r?.w ?? null
}
void TWO_COLUMNS
