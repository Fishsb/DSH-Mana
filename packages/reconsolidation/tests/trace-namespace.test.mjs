/**
 * 判据⑤：**本包写入 `mana_trace` 的标签全部在自有命名空间内**（不冒充 S1 五类）。
 *
 * ⚠ 为什么这条是真判据而不是格式洁癖：S1 五类（observation/attention/decision/recall/injection）
 *   是 **A1-1 端到端事件链**的计数面。本包若把"窗口开了/降级了"写进那五类，
 *   A1-1 的计数会**变大**——而变大的方向正是"看起来更活跃"的假绿方向，且**无人会因此报错**。
 *
 * ⚠ 判据的两条腿都必须真：
 *   ① **真数据**：从 `mana_trace` 读回本包这段调用期间写入的**全部**行（不是查表里的常量）；
 *   ② **负向对照**：与 `mana-core` 的 `MANA_STAGES`（**运行时读真源**）逐字对拍，且本包常量表
 *      `S1_STAGE_TAGS` 也必须与真源**集合相等**——否则真源加了第六类而本表没跟，
 *      负向判据会**变松**（漏抓冒充），而它看起来仍然在跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount, cleanupAll, maxSeq, traceSince, loadPackage } from './_harness.mjs'

const EXPECTED_CASES = 5
let ran = 0
process.on('exit', () => {
  cleanupAll()
  if (ran !== EXPECTED_CASES) {
    console.error(`\n用例计数自检失败：期望 ${EXPECTED_CASES}，实跑 ${ran}`)
    process.exitCode = 1
  }
})

const PREFIX = 'mana-reconsolidation/'

test('① 自有常量表与核心的 S1 五类**集合相等**（负向对照表不得漂移）', async () => {
  ran += 1
  const coreMod = await loadPackage('core')
  const mod = await loadPackage('reconsolidation')
  assert.deepEqual(
    [...mod.S1_STAGE_TAGS].sort(),
    [...coreMod.MANA_STAGES].sort(),
    '本包的负向对照表必须与 mana-core 的真源集合相等（漂移 ⇒ 负向判据变松）',
  )
  assert.equal(mod.OWNED_TRACE_PREFIX, PREFIX)
  assert.ok(mod.OWNED_TRACE_EVENTS.length >= 4, `本包标签至少 4 个（开/关/更新/降级），实测 ${mod.OWNED_TRACE_EVENTS.length}`)
  for (const t of mod.OWNED_TRACE_EVENTS) {
    assert.ok(t.startsWith(PREFIX), `${t} 不在自有命名空间内`)
    assert.equal(mod.isOwnedTraceEvent(t), true)
  }
})

test('② 真数据腿：走**全部**三条生产路径后，`mana_trace` 新增行逐行带自有前缀', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: '原始' })
  const before = maxSeq(core)
  const now = 1_700_000_000_000
  svc.openWindow({ memoryId: 'm1', type: 'episodic', now }) // 开窗
  svc.applyContentUpdate({ memoryId: 'm1', content: '更新', now: now + 1000 }) // 更新
  svc.closeDueWindows({ now: now + 30 * 60 * 1000 }) // 关窗

  const rows = traceSince(core, before)
  assert.equal(rows.length, 3, `三条路径各一条痕，实测 ${rows.length}`)
  for (const r of rows) {
    assert.ok(
      String(r.event_type).startsWith(PREFIX),
      `本包写的 event_type 必须全在 ${PREFIX} 命名空间内；实测 ${r.event_type}`,
    )
    assert.equal(mod_isS1(r.event_type), false, `${r.event_type} 不得冒充 S1 五类`)
  }
  assert.deepEqual(
    rows.map((r) => r.event_type),
    ['mana-reconsolidation/window-opened', 'mana-reconsolidation/content-updated', 'mana-reconsolidation/window-closed'],
    '三条路径的标签必须与 OWNED_TRACE_EVENTS 定义一致（顺序即调用顺序）',
  )
})

test('③ 降级路径同样在命名空间内（降级留痕最容易写成"借用"别的标签）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: false })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: 'x' })
  const before = maxSeq(core)
  svc.openWindow({ memoryId: 'm1', type: 'episodic', now: 1_700_000_000_000 })
  svc.applyContentUpdate({ memoryId: 'm1', content: 'y', now: 1_700_000_001_000 })
  svc.closeDueWindows({ now: 1_800_000_000_000 })
  const rows = traceSince(core, before)
  assert.equal(rows.length, 3)
  for (const r of rows) assert.equal(r.event_type, 'mana-reconsolidation/degraded', '降级留痕必须统一用它自己的标签')
})

test('④ 负向对照必须真能否证：把 S1 五类逐个喂进判定函数 ⇒ 全部为 false', async () => {
  ran += 1
  const mod = await loadPackage('reconsolidation')
  const coreMod = await loadPackage('core')
  for (const stage of coreMod.MANA_STAGES) {
    assert.equal(mod.isOwnedTraceEvent(stage), false, `S1 五类 ${stage} 绝不能被判成本包标签`)
    // 前缀相同的"近似冒充"也不得通过
    assert.equal(mod.isOwnedTraceEvent(`${stage}`), false)
    assert.equal(mod.isOwnedTraceEvent(`mana/${stage}`), false, 'DSH/自定义事件前缀 mana/ 不得混入本包命名空间')
  }
  for (const v of [null, undefined, 42, {}, [], '', 'mana-reconsolidation', 'mana-reconsolidation']) {
    if (v === 'mana-reconsolidation') continue
    assert.equal(mod.isOwnedTraceEvent(v), false, `${JSON.stringify(v)} 不是本包标签`)
  }
})

test('⑤ 本包**装配期不写任何 trace**（"插件已加载"不是认知事件，写它即污染计数）', async () => {
  ran += 1
  const { mount: m } = await import('./_harness.mjs')
  const dir = await m({ columns: true })
  // 装配已完成（mount 内部 settle 过）⇒ 到此刻为止 mana_trace 必须仍是 0 行
  const n = Number(dir.core.db.prepare('SELECT COUNT(*) AS c FROM mana_trace').get().c)
  assert.equal(n, 0, `装配期不得写 trace（实测 ${n} 行）。若确有装配事件要记，须在 OWNED_TRACE_EVENTS 里显式登记并说明它属于哪类认知事件`)
})

function mod_isS1(t) {
  return ['observation', 'attention', 'decision', 'recall', 'injection'].includes(t)
}
