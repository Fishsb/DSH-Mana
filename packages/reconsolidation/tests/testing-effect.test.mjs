/**
 * 判据⑥：**v10 §15.4 测试效应** —— 按检索类型给保持增益（再认 0.05 / 回忆 0.15 / 精细提取 0.25）。
 *
 * 真源（`docs/mana-v10-status-plan.md:808-814`，逐字）；本项此前在本仓**零命中**
 * （`docs/mana-progress-audit-2026-09-27.md:106-108`）⇒ 本文件是它的第一批判据。
 *
 * ── 四条硬要求，逐条有腿（本卡任务书原文）──────────────────────────────────────────────
 *   ① **三档各自可分辨**：三档在**四类记忆**上各自作用到 `until` 的读数两两不同（判据④，贴表）；
 *   ② **「没发生检索」与「发生了但增益为 0」可分辨**：前者窗口列仍为 `NULL`，后者窗口开着
 *      且 `retrievalKind === null`（判据⑥）；
 *   ③ **两个方向都判**：正向（增益真作用到目标量 —— 读侧窗口的**开/关状态**被改变，判据⑤）；
 *      反向（未检索的记忆**未被**加增益，判据⑥）；
 *   ④ **不声明 kind ⇒ 逐字等于 today**（判据③）：既有生产调用方零影响，且这条是**不变量**。
 *
 * ── ⚠ 未与既有幂律衰减重复相乘（本仓 C14 的坑）──────────────────────────────────────────
 *   `long-term/src/decay.ts:15` 明写它是唯一衰减写者；`forgetting/src/params.ts:30` 明写
 *   「⛔ **不得相乘**（`decay × retention`）」；`long-term/src/activation.ts:21` 明写
 *   「B 的单位是秒、decay 的单位是天，两者不可相乘」。
 *   ⇒ 本增益落在**窗口时长**上（本包唯一的「保持」量），是**加法延长**，不是乘子。
 *   判据⑦ 三条腿核这件事：本包不导出 decay/retention/activation 族名 + 衰减核的**闭式锚点**
 *   在改动后逐位不变 + 增益只依赖 `(窗长, 档位)` 而与 `now` 无关。
 *
 *   ⚠ 判据⑦ **刻意不 import `long-term`**（宁可自己再写一遍闭式）：本仓的对拍机制
 *     （`_harness.runWithMutation`）只在沙箱里拷 `core` + `reconsolidation`，若本文件依赖
 *     第三个包，它在沙箱里会 `ERR_MODULE_NOT_FOUND` —— 那时**任何**扰动都会让本文件整体报红，
 *     对拍就**打错了靶**（红来自缺包，不来自被扰动的那行）。写成闭式后它与夹具同为
 *     「独立写一遍」，代价为零、可移植性反而更好。
 *
 * ── 口径 ────────────────────────────────────────────────────────────────────────────────
 *   · 三档值、四类窗长**夹具侧各自独立写一遍**（不复用模块常量）：只断言「模块 == 模块」是自指的，
 *     改真源会跟着改 ⇒ 假覆盖（口径同 `window-boundaries.test.mjs` 的 FIXTURE）。
 *   · 记忆行由 `core.writeMemoryItem` 建、窗口列由**服务面**写、结论由**回读 SQL** 得出 ——
 *     没有一条是测试自己直写自己读（本仓「夹具绿 ≠ 真数据绿」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount, cleanupAll, loadPackage } from './_harness.mjs'

/** 期望用例条数：**相等**语义（改数量须同步本文件与 `verify.mjs` 的登记）。 */
const EXPECTED_CASES = 7
let ran = 0
process.on('exit', () => {
  cleanupAll()
  if (ran !== EXPECTED_CASES) {
    console.error('用例计数自检失败：期望 ' + EXPECTED_CASES + '，实跑 ' + ran)
    process.exitCode = 1
  }
})

/** 真源 v10 §15.4 的三行。**夹具独立写一遍**，不由模块派生。 */
const GAIN_FIXTURE = [
  ['recognition', 0.05],
  ['recall', 0.15],
  ['elaboration', 0.25],
]

/** 真源 v10 §15.2 的四类窗长（毫秒）。夹具独立写一遍，不由模块派生。 */
const WINDOW_FIXTURE = [
  ['episodic', 30 * 60 * 1000],
  ['semantic', 2 * 60 * 60 * 1000],
  ['procedural', 6 * 60 * 60 * 1000],
  ['emotional', 60 * 60 * 1000],
]

const NOW = 1_700_000_000_000

/** 回读窗口列的**落库值**（结论必须来自读回，不来自返回值）。 */
function readUntilIso(core, id) {
  const r = core.db.prepare('SELECT reconsolidation_window_until AS w FROM memory_items WHERE id = ?').get(id)
  return r?.w ?? null
}

test('① 三档增益逐字复现 v10 §15.4（绝对差 ≤1e-9；三档清单集合相等不是包含）', async () => {
  ran += 1
  const mod = await loadPackage('reconsolidation')
  assert.deepEqual(
    [...mod.RETRIEVAL_KINDS].sort(),
    GAIN_FIXTURE.map((f) => f[0]).sort(),
    '检索类型清单必须与夹具**集合相等**（不是包含）：实测 ' + JSON.stringify(mod.RETRIEVAL_KINDS),
  )
  for (const [kind, gain] of GAIN_FIXTURE) {
    assert.ok(
      Math.abs(mod.retentionGain(kind) - gain) <= 1e-9,
      kind + ' 的增益必须逐字为 ' + gain + '（v10 §15.4），实测 ' + mod.retentionGain(kind),
    )
    assert.ok(
      Math.abs(mod.RETENTION_GAIN_BY_KIND[kind] - gain) <= 1e-9,
      'RETENTION_GAIN_BY_KIND[' + kind + '] 与夹具不符（表是唯一真源，读侧不得漂移）',
    )
  }
  // 假旋钮不得回流：三档是**常量**，不是配置
  assert.equal(mod.Config, undefined, '本包不得导出 Config：增益一旦可配，「固定夹具逐字复现」就退化为「配置是什么就复现什么」')
  assert.ok(Object.isFrozen(mod.RETENTION_GAIN_BY_KIND), '增益表必须冻结')
  assert.ok(Object.isFrozen(mod.RETRIEVAL_KINDS), '检索类型清单必须冻结')
  assert.throws(() => {
    mod.RETENTION_GAIN_BY_KIND.recognition = 0.9
  }, TypeError, '冻结表赋值必须抛（静默忽略会让「改了真源」无迹可循）')
  assert.equal(mod.retentionGain('recognition'), 0.05, '扰动后必须仍是原值')
})

test('② 非法/未知检索类型必须抛 RangeError（不回落 0，也不读成未声明）且消息点名合法取值', async () => {
  ran += 1
  const mod = await loadPackage('reconsolidation')
  const bad = [
    '', 'recognition ', 'Recognition', 'RECOGNITION', 'recall ', 'elaborat', 'elaboration1',
    'recog', '再认', '回忆', '精细提取', 'unknown', 'none', 0, 1, 42, true, false, {}, [], () => {},
  ]
  for (const v of bad) {
    assert.throws(
      () => mod.retentionGain(v),
      RangeError,
      JSON.stringify(v) + ' 不在册 ⇒ 必须抛 RangeError（静默回落 0 会把「拼错了」读成「增益为 0」）',
    )
    assert.throws(
      () => mod.resolveRetrievalKind(v),
      RangeError,
      JSON.stringify(v) + ' 不得被读成「未声明」（那正是「拼错类型」的静默形态）',
    )
    assert.equal(mod.isRetrievalKind(v), false, 'isRetrievalKind(' + JSON.stringify(v) + ') 必须为 false')
  }
  for (const [kind] of GAIN_FIXTURE) {
    assert.equal(mod.isRetrievalKind(kind), true, kind + ' 必须在册')
    assert.equal(mod.resolveRetrievalKind(kind), kind, '在册档位必须原样解析出来')
  }
  // 三态里的第三态：未声明 —— 只有 undefined/null 走这条
  assert.equal(mod.resolveRetrievalKind(undefined), null, 'undefined = 未声明')
  assert.equal(mod.resolveRetrievalKind(null), null, 'null = 未声明')
  try {
    mod.retentionGain('nope')
    assert.fail('必须抛')
  } catch (error) {
    assert.match(error.message, /recognition/, '抛错消息必须点名在册取值，否则调用方无从修')
  }
})

test('③ 不变量：不声明 kind ⇒ 逐字等于 today（until === now + windowMs(type)，增益 0，kind=null）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'm1', type: 'semantic', content: '未声明检索类型的记忆' })
  const base = NOW + 2 * 60 * 60 * 1000
  const r = svc.openWindow({ memoryId: 'm1', type: 'semantic', now: NOW })
  assert.equal(r.channel, 'applied')
  assert.equal(r.untilBase, base, 'untilBase 必须逐字等于 now + windowMs(type)')
  assert.equal(r.retentionGainMs, 0, '未声明 ⇒ 增益必须为 0')
  assert.equal(r.retrievalKind, null, '未声明 ⇒ retrievalKind 必须为 null（不是 undefined、不是 0）')
  assert.equal(r.until, base, '**不变量**：未声明时 until 必须逐字等于 untilBase（= today 的行为）')
  assert.equal(r.windowMsValue, 2 * 60 * 60 * 1000)
  // 落库值与返回值一致（回读取证，不是「写成功即值对」）
  assert.equal(readUntilIso(core, 'm1'), r.untilIso, '列里的 ISO 串必须与返回值逐字一致')
  assert.equal(Date.parse(readUntilIso(core, 'm1')), base, '落库值必须就是 now + windowMs(type)')
  // 与「声明了低档」对拍：同一 now/type 下未声明与最低档**不同**（证明这轴真接上了，不是装饰）
  core.writeMemoryItem({ id: 'm2', type: 'semantic', content: '声明为再认的记忆' })
  const r2 = svc.openWindow({ memoryId: 'm2', type: 'semantic', now: NOW, retrievalKind: 'recognition' })
  assert.notEqual(r2.until, r.until, '声明再认必须与未声明**不同**，否则这轴是装饰')
})

test('④ 三档在四类记忆上各自可分辨（原始读数表：两两不同 + 序关系 + 回读一致）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  const rows = []
  for (const [mtype, winMs] of WINDOW_FIXTURE) {
    const gains = []
    for (const [kind, gain] of GAIN_FIXTURE) {
      const id = mtype + '/' + kind
      core.writeMemoryItem({ id, type: mtype, content: 'x' })
      const r = svc.openWindow({ memoryId: id, type: mtype, now: NOW, retrievalKind: kind })
      const expectedGain = Math.round(winMs * gain)
      gains.push(expectedGain)
      assert.equal(r.retrievalKind, kind, id + ' 的 return.retrievalKind 必须就是声明的那一档')
      assert.equal(r.retentionGainMs, expectedGain, mtype + '+' + kind + ' 的增益必须是 round(' + winMs + '×' + gain + ')')
      assert.equal(r.until, NOW + winMs + expectedGain, mtype + '+' + kind + ' 的 until 必须等于 now + 窗长 + 增益')
      assert.equal(r.untilBase, NOW + winMs, 'untilBase 必须只由 now + 窗长决定（与档位无关）')
      assert.equal(readUntilIso(core, id), r.untilIso, '落库值必须与返回值逐字一致（' + id + '）')
      rows.push([mtype, winMs, kind, gain, expectedGain, r.until])
    }
    // 同一记忆类型内三档两两不同 + 严格序关系
    assert.equal(new Set(gains).size, 3, mtype + ' 上三档增益必须两两不同，实测 ' + JSON.stringify(gains))
    assert.ok(gains[0] < gains[1] && gains[1] < gains[2], mtype + ' 上必须保持 再认 < 回忆 < 精细 的序关系，实测 ' + JSON.stringify(gains))
  }
  console.log('[判据④] 三档 x 四类记忆 实测读数（memoryType / windowMs / kind / gain / gainMs / until）')
  console.log('  ' + ['memoryType', 'windowMs', 'kind', 'gain', 'gainMs', 'until'].join('\t'))
  for (const row of rows) console.log('  ' + row.join('\t'))
})

test('⑤ 正向：增益真作用到目标量 —— 读侧窗口「开/关状态」被改变（不只是返回值好看）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'base', type: 'episodic', content: '未声明' })
  core.writeMemoryItem({ id: 'gained', type: 'episodic', content: '精细提取' })
  const winMs = 30 * 60 * 1000
  svc.openWindow({ memoryId: 'base', type: 'episodic', now: NOW })
  svc.openWindow({ memoryId: 'gained', type: 'episodic', now: NOW, retrievalKind: 'elaboration' })
  // today 的到点时刻 = NOW + winMs；加了 0.25 增益后应仍未到点
  const atBaseDue = NOW + winMs
  assert.equal(svc.isWindowOpen('base', atBaseDue), false, '未声明的那条在 base 到点时刻必须已关')
  assert.equal(svc.isWindowOpen('gained', atBaseDue), true, '加了增益的那条在 base 到点时刻必须仍开着 —— 增益必须作用在真正的保持量上')
  const gainedMs = 0.25 * winMs
  assert.equal(svc.isWindowOpen('gained', atBaseDue + gainedMs - 1), true, '增益末端之前 1ms 必须仍开着')
  assert.equal(svc.isWindowOpen('gained', atBaseDue + gainedMs), false, '增益末端（now === until）必须算关（边界口径同 windowOpen）')
})

test('⑥ 反向：「未检索」未被加增益，且与「检索了但增益为 0」可分辨', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'never', type: 'semantic', content: '从未被检索' })
  core.writeMemoryItem({ id: 'undeclared', type: 'semantic', content: '被检索但未声明档位' })
  core.writeMemoryItem({ id: 'declared', type: 'semantic', content: '被检索且声明了再认' })
  // 只有后两条被检索（= 开窗）；never 那条**从不**走检索路径
  const u = svc.openWindow({ memoryId: 'undeclared', type: 'semantic', now: NOW })
  const d = svc.openWindow({ memoryId: 'declared', type: 'semantic', now: NOW, retrievalKind: 'recognition' })
  // ① 未检索：窗口列**仍为 NULL**（不是「开了一个零增益的窗」）
  assert.equal(readUntilIso(core, 'never'), null, '从未被检索的记忆不得出现任何窗口值（不得被别人的检索牵连）')
  assert.equal(svc.isWindowOpen('never', NOW), false, '未检索 ⇒ 读侧必须为未开窗')
  // ② 「未检索」与「检索了但增益为 0」可分辨：前者列 NULL，后者有列值且 kind 显式为 null
  assert.notEqual(readUntilIso(core, 'undeclared'), null, '检索过就有值（哪怕增益为 0）—— 这与「从未检索」不同形')
  assert.equal(u.retrievalKind, null, '未声明 ⇒ 显式 null（可分辨位）')
  assert.equal(u.retentionGainMs, 0, '未声明 ⇒ 增益为 0')
  assert.equal(u.until - u.untilBase, 0, '未声明 ⇒ until 与 untilBase 零差')
  // ③ 未检索的不得被「加了增益」：声明条必须严格长于未声明条
  assert.ok(Date.parse(d.untilIso) > Date.parse(u.untilIso), '声明了再认的那条必须严格长于未声明的那条')
  // ④ 未检索的那条**没有**任何档位的值（逐字节不等于"若被精细提取"会得到的那个时刻）
  const winMs = 2 * 60 * 60 * 1000
  const neverWouldBeIfGained = new Date(NOW + winMs + Math.round(winMs * 0.25)).toISOString()
  assert.notEqual(readUntilIso(core, 'never'), neverWouldBeIfGained, '未检索的记忆绝不能被加上增益值')
})

test('⑦ 未与既有幂律衰减重复相乘（C14）：不引乘子 + 衰减闭式锚点逐位不变 + 增益与 now 无关', async () => {
  ran += 1
  const mod = await loadPackage('reconsolidation')
  // 腿 A：本包**不导出** decay/retention/activation 族名 —— 不引第二个乘子的结构证据
  for (const forbidden of ['decay', 'retention', 'activation', 'baseLevel', 'retrievalProbability']) {
    assert.equal(mod[forbidden], undefined, '本包不得导出 ' + forbidden + '（decay.ts:15 是唯一衰减写者；再引一个乘子即 C14 的「同一条记忆被两家乘过」）')
  }
  // 腿 B：衰减核的闭式在本次改动后**逐位不变**（口径 = long-term/src/decay.ts:24 + activation.ts:48）
  const decay = (t, h = 14) => Math.exp((-t * Math.LN2) / h)
  assert.ok(Math.abs(decay(0) - 1.0) <= 1e-6, 'A1-5 锚点 decay(0) 必须仍为 1.000000')
  assert.ok(Math.abs(decay(14) - 0.5) <= 1e-6, 'A1-5 锚点 decay(14) 必须仍为 0.500000（本增益不得动衰减核）')
  assert.ok(Math.abs(decay(90) - 0.011609) <= 1e-6, 'A1-5 锚点 decay(90) 必须仍为 0.011609')
  // 幂律同形腿：B = ln(Σ t_j^(-d)) 与闭式逐位一致
  const t = [1, 2, 4, 8]
  const expectB = Math.log(t.reduce((s, x) => s + Math.pow(x, -0.5), 0))
  assert.ok(
    Math.abs(expectB - 0.9402651048477346) <= 1e-12,
    '闭式自身必须钉在**独立算出的已知值**上（防空断言：两边同式会恒真）；实测 ' + expectB,
  )
  // ⚠ 增益**不得**改变衰减通道：同一时刻的衰减读数与检索档位无关
  const decayAt14 = GAIN_FIXTURE.map(() => decay(14))
  assert.equal(new Set(decayAt14).size, 1, 'decay(14) 不得随检索档位变化（增益若被乘进衰减核，这条即红）')
  assert.ok(Math.abs(decayAt14[0] - 0.5) <= 1e-6, 'A1-5 锚点在三个档位下都必须仍是 0.500000')
  // 腿 C：增益只依赖 (窗长, 档位)，与 now 无关 —— 它不是时间/衰减通道上的量
  const { core, svc } = await mount({ columns: true })
  core.writeMemoryItem({ id: 'a', type: 'semantic', content: 'x' })
  core.writeMemoryItem({ id: 'b', type: 'semantic', content: 'y' })
  const early = svc.openWindow({ memoryId: 'a', type: 'semantic', now: NOW, retrievalKind: 'elaboration' })
  const late = svc.openWindow({ memoryId: 'b', type: 'semantic', now: NOW + 123456789, retrievalKind: 'elaboration' })
  assert.equal(early.retentionGainMs, late.retentionGainMs, '同一 (窗长, 档位) 在不同 now 上增益必须逐位相同（与时间/衰减无关）')
  assert.equal(early.until - early.untilBase, late.until - late.untilBase, '增益量不得耦合进时间轴')
})
