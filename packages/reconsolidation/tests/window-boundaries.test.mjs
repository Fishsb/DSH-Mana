/**
 * 判据①：**四类窗口时长逐字复现**（v10 §15.2：情景 30min / 语义 2h / 程序性 6h / 情绪 1h）。
 *
 * ⚠ 夹具侧**独立写一遍**四个值（不复用模块常量）：只断言"模块常量 == 模块常量"是自指的，
 *   改了真源也跟着改 —— 那是假覆盖。这里的两份清单**集合相等 + 数值逐字相等**双重对拍。
 * ⚠ 未知类型必须**抛**，不得回落缺省（回落会让"类型写错"与"该类型窗就是缺省长"同形）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPackage } from './_harness.mjs'

const EXPECTED_CASES = 5
let ran = 0
const mod = await loadPackage('reconsolidation')

/** 真源：v10 §15.2（落地册 L-02 逐字引用）。**单位换算写死在夹具里**，不由模块派生。 */
const FIXTURE = [
  ['episodic', 30 * 60 * 1000, 1800],
  ['semantic', 2 * 60 * 60 * 1000, 7200],
  ['procedural', 6 * 60 * 60 * 1000, 21600],
  ['emotional', 60 * 60 * 1000, 3600],
]

test('① 四值逐字复现（固定夹具，绝对差 ≤1e-6；毫秒与秒两套口径同时断言）', () => {
  ran += 1
  assert.deepEqual(
    [...mod.MEMORY_TYPES].sort(),
    FIXTURE.map((f) => f[0]).sort(),
    `类型清单必须与夹具集合**相等**（不是包含）：实测 ${JSON.stringify(mod.MEMORY_TYPES)}`,
  )
  for (const [type, ms, sec] of FIXTURE) {
    assert.ok(
      Math.abs(mod.windowMs(type) - ms) <= 1e-6,
      `${type} 的窗口必须为 ${ms} ms（v10 §15.2），实测 ${mod.windowMs(type)}`,
    )
    assert.ok(Math.abs(mod.WINDOW_MS_BY_TYPE[type] - ms) <= 1e-6, `WINDOW_MS_BY_TYPE[${type}] 与夹具不符`)
    assert.ok(
      Math.abs(mod.WINDOW_SECONDS_BY_TYPE[type] - sec) <= 1e-6,
      `${type} 的秒级表示必须为 ${sec}（实测 ${mod.WINDOW_SECONDS_BY_TYPE[type]}）—— 派生量不得与真源漂移`,
    )
    assert.ok(Math.abs(mod.WINDOW_SECONDS_BY_TYPE[type] * 1000 - mod.WINDOW_MS_BY_TYPE[type]) <= 1e-6, '秒/毫秒两套必须同源')
  }
})

test('② 未知类型必须抛 RangeError（不得静默回落缺省窗）+ 抛错消息点名合法取值', () => {
  ran += 1
  const bad = ['episodical', '', 'EPISODIC', 'semantic ', ' default', null, undefined, 42, {}, [], true]
  for (const v of bad) {
    assert.throws(
      () => mod.windowMs(v),
      RangeError,
      `${JSON.stringify(v)} 不在册 ⇒ 必须抛 RangeError（静默回落缺省 = 判据① 的靶子被换掉）`,
    )
    assert.equal(mod.isMemoryType(v), false, `isMemoryType(${JSON.stringify(v)}) 必须为 false`)
  }
  for (const [type] of FIXTURE) assert.equal(mod.isMemoryType(type), true, `${type} 必须在册`)
  try {
    mod.windowMs('nope')
    assert.fail('必须抛')
  } catch (error) {
    assert.match(error.message, /episodic/, '抛错消息必须点名在册类型，否则调用方无从修')
  }
})

test('③ until 只能等于 now + windowMs（纯函数，固定 now；逐字相等不是近似）', () => {
  ran += 1
  for (const now of [0, 1, 1_700_000_000_000, 2 ** 40]) {
    for (const [type] of FIXTURE) {
      const until = mod.windowUntil(now, type)
      assert.equal(until, now + mod.windowMs(type), `until 必须逐字等于 now + windowMs(${type})`)
      assert.ok(Math.abs(until - now - mod.windowMs(type)) <= 1e-6, '绝对差必须 ≤1e-6')
    }
  }
  // ISO 落库形态必须与毫秒同源（判据不在两处各算一遍）
  const now = 1_700_000_000_000
  assert.equal(Date.parse(mod.isoAt(mod.windowUntil(now, 'semantic'))), now + 7200 * 1000)
})

test('④ 窗口开闭的**边界语义**：until 严格大于 now 才算开（相等即已关）', () => {
  ran += 1
  const until = 1000
  assert.equal(mod.windowOpen(until, 999), true, 'now < until ⇒ 开着')
  assert.equal(mod.windowOpen(until, 1000), false, 'now === until ⇒ 已到点，必须算关（边界不得含糊）')
  assert.equal(mod.windowOpen(until, 1001), false, 'now > until ⇒ 已关')
  for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '1000', {}]) {
    assert.equal(mod.windowOpen(v, 0), false, `非数值/非法值 ${JSON.stringify(v)} 必须读成"未开窗"，不得抛也不得读成开`)
  }
})

test('⑤ 窗口时长是**常量**不是配置项（假旋钮不得回流：冻结表 + 无 Config 导出）', () => {
  ran += 1
  assert.equal(mod.Config, undefined, '本包不得导出 Config：窗口时长一旦可变，判据① 的靶子就跟着变（恒真）')
  assert.ok(Object.isFrozen(mod.WINDOW_MS_BY_TYPE), '毫秒表必须冻结（可改的表 = 可被静默改掉的靶子）')
  assert.ok(Object.isFrozen(mod.WINDOW_SECONDS_BY_TYPE), '秒表必须冻结')
  assert.ok(Object.isFrozen(mod.MEMORY_TYPES), '类型清单必须冻结')
  assert.throws(() => {
    mod.WINDOW_MS_BY_TYPE.episodic = 1
  }, TypeError, '冻结表赋值必须抛（静默忽略会让"改了真源"无迹可循）')
  assert.equal(mod.windowMs('episodic'), 30 * 60 * 1000, '扰动后必须仍是原值')
})

process.on('exit', () => {
  if (ran !== EXPECTED_CASES) {
    console.error(`\n用例计数自检失败：期望 ${EXPECTED_CASES}，实跑 ${ran} —— 本文件的用例数本身是判据`)
    process.exitCode = 1
  }
})
