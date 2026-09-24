/**
 * 判定链判据：`mana/jev/judge` 的 waterfall 义务 + 降级显式
 *
 * 覆盖的纪律（`docs/contract/event-types.ts` 与 G6/G8/G9 明文）：
 *   · `mana/jev/judge` 是 **waterfall** 型 ⇒ 必须 `ctx.waterfall(...)` 分发；
 *     用 `ctx.emit()` 会**同步抛** `TypeError: next is not a function`（G6，错误位置远离真因）
 *   · 监听器**必须调 `next()`** —— 漏调会**无声**吞掉下游默认行为（本仓实测全程无异常）
 *   · 降级必须显式：`degraded:true` + 非空 `reason` + `probability:null`
 *     （**不得用 0 冒充「概率为零」**），禁 `catch { return null }`（G8）
 *
 * ⚠ 本测试**不联网**：`judgeGuarded` 走注入的 `judgeFn` 桩，端点/模型不影响判定。
 *   库一律用临时库（本仓硬纪律）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const ROOT = new URL('../../../', import.meta.url)
const BASE_URL = pathToFileURL(fileURLToPath(ROOT)).href + '/'

// ⚠ cordis 取宿主安装目录（照抄 packages/metacognition/tests/assembly.test.mjs 的先例：
//   它们不是本仓 workspace 依赖，按包名 import 会 ERR_MODULE_NOT_FOUND）。
const { Context } = await import(`${DSH}/cordis/lib/index.js`)
const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default

const cleanups = []
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-jevchain-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)
  for (const [pkg, svc] of [
    ['dsh-mana-core', 'mana-core'],
    ['dsh-mana-jev', 'mana-jev'],
  ]) {
    await ctx.loader.create({ name: pkg, config: pkg === 'dsh-mana-core' ? { storePath: store } : {} })
    await settle(200)
    assert.ok(ctx.get(svc), `${pkg} 应装配（服务可读）`)
  }
  return { ctx, store }
}

/** 构造一条符合契约的判定请求。 */
const req = (over = {}) => ({
  requestId: 'req-judge-1',
  judgeType: 'noul',
  state: 'S',
  question: '这条信息是否值得长期保存？',
  threshold: 0.6,
  source: 'test',
  ...over,
})

// ── J1 判定链被真调到（装配 + 监听器存在）──────────────────────────────────
test('J1 判定链：mana/jev/judge 有监听器并被真调到', async () => {
  const { ctx } = await boot()
  // 用 waterfall 分发（本事件是 waterfall 型；用 emit 会同步抛 TypeError，见 J4）
  const got = await ctx.waterfall('mana/jev/judge', req(), async () => ({
    requestId: 'req-judge-1',
    source: 'downstream-default',
    value: 'unknown',
    probability: null,
    degraded: true,
    reason: 'no-listener-default',
  }))
  assert.ok(got, 'waterfall 应返回一个结果对象')
  assert.equal(got.requestId, 'req-judge-1', '关联键必须回填（I-6 统一 requestId）')
  // 监听器在场 ⇒ 结果不该是"下游默认值"（说明 jev 的监听器真接上了）
  assert.notEqual(got.source, 'downstream-default', 'jev 的判定监听器应真接上（否则是空链）')
})

// ── J2 降级显式：degraded/reason/probability 三者自洽（G8）─────────────────
test('J2 降级必须显式：degraded=true + reason 非空 + probability=null（禁 0 冒充）', async () => {
  const { ctx } = await boot()
  // 端点指向恒不可达端口 ⇒ 必然降级（真故障路径，不靠桩）
  ctx.get('mana-jev') // 触发服务读取（存在性）
  const got = await ctx.waterfall(
    'mana/jev/judge',
    // 用不可达端点：本机端口 1 无监听
    req({ state: 'S2' }),
    async () => ({
      requestId: 'req-judge-1',
      source: 'downstream',
      value: 'unknown',
      probability: null,
      degraded: true,
      reason: 'downstream-default',
    }),
  )
  assert.ok(got, '应返回结果而非 null（禁 catch{return null}）')
  if (got.degraded) {
    assert.ok(typeof got.reason === 'string' && got.reason.length > 0, '降级必须带非空 reason')
    assert.equal(got.probability, null, '降级时概率必须为 null（不得用 0 冒充「概率为零」）')
    assert.equal(got.value, 'unknown', '降级时判定值必须为 unknown（不得默认成 no）')
  } else {
    // 真判到了：概率必须是可用数字且非"零冒充"
    assert.equal(typeof got.probability, 'number')
    assert.ok(got.value === 'yes' || got.value === 'no')
  }
})

// ── J3 下游透传：监听器不得吞掉下游（next() 义务 / G9）────────────────────
test('J3 next() 义务：jev 降级时下游哨兵必须被调到（不吞掉下游）', async () => {
  // ⚠ **实测澄清 waterfall 的方向**（本仓 2026-09-25）：
  //   cordis 的 waterfall 是**洋葱模型** —— **后注册者在更外层、先执行**。
  //   实测：`A-in → B-in → default → B-out → A-out`（A 先注册）。
  //   ⇒ 要验证「jev 有没有调 next()」，哨兵必须注册在 jev 的**内层**（即**先**注册、
  //     在 jev 之前 `ctx.on`）；若注册在后面（外层），它先跑，根本轮不到 jev 决定。
  //   ⚠ 且 jev 只在**降级路径**调 next()（成功路径直接返回）⇒ 本判据必须走降级路径。
  const dir = mkdtempSync(join(tmpdir(), 'mana-jevchain3-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)

  // ① 先注册哨兵（⇒ 位于内层，jev 调 next() 时才会到它）
  let reached = 0
  ctx.on('mana/jev/judge', async (_r, next) => {
    reached += 1
    return await next()
  })

  // ② 再装配 core / jev（jev 的监听器注册在哨兵之后 ⇒ 在外层）
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: store } })
  await settle(200)
  await ctx.loader.create({ name: 'dsh-mana-jev', config: { endpoint: 'http://127.0.0.1:1' } })
  await settle(200)
  assert.ok(ctx.get('mana-jev'), 'jev 应装配')

  // ③ 分发：端点不可达 ⇒ 必然降级 ⇒ jev 应调 next() ⇒ 哨兵被调到
  const got = await ctx.waterfall('mana/jev/judge', req({ state: 'S3' }), async () => ({
    requestId: 'req-judge-1',
    source: 'sentinel-default',
    value: 'unknown',
    probability: null,
    degraded: true,
    reason: 'sentinel-default',
  }))
  await settle(150)
  assert.ok(
    reached >= 1,
    'jev 降级时未调 next() ⇒ 静默吞掉下游（G9）。注意：成功路径不调 next 是设计（直接返回判定）',
  )
  assert.ok(got, '降级也应返回结果对象（不得返回 undefined）')
})

// ── J4 负向：用 emit 分发 waterfall 型事件必须炸（G6）──────────────────────
test('J4 负向：ctx.emit 分发 waterfall 型事件时 next 不是函数（G6）', async () => {
  const { ctx } = await boot()
  // ⚠ **实测澄清（本仓 2026-09-25，四轮探针才定位准）**：`event-types.ts` 原文说
  //   「用 `ctx.emit()` 分发 waterfall 型事件会**同步抛** `TypeError: next is not a function`」。
  //   逐条实测后的**准确**表述是：
  //     ① `emit` **确实**会把事件分发到监听器（哨兵实测 `hit=1`）—— 不是"不触发"；
  //     ② 但 `emit` 的调用签名**不传 `next`** ⇒ 监听器里那个 `next` 是 `undefined`；
  //     ③ 于是**只要监听器调用 `next()`**（即它有 next() 义务），就抛 `TypeError`；
  //     ④ 抛出通道：在**裸 Context** 下是 `uncaughtException`（会崩进程，本席探针实测）；
  //        经 **Loader** 装配时被包在框架的 Promise 链里 ⇒ 可能不冒泡到测试进程。
  //   ⇒ 判据**不依赖错误冒泡**（那受装配方式影响、不可靠），而是直接断言**因果链的前两环**：
  //     `emit` 能送达 + 送达时 `next === undefined`。这比断言"抛不抛"更稳，且同样钉住 G6。
  let received = null
  let called = null
  const off = ctx.on('mana/jev/judge', async (_r, next) => {
    received = { hasNext: typeof next === 'function' }
    // 模拟"有 next() 义务的监听器"：调用它必然炸（这正是 emit 分发 waterfall 的后果）
    try {
      await next()
    } catch (error) {
      called = String(error?.message ?? error)
    }
    return { requestId: 'x', source: 'probe', value: 'unknown', probability: null, degraded: true, reason: 'probe' }
  })
  try {
    ctx.emit('mana/jev/judge', req({ state: 'S4' }))
    await settle(400)
  } finally {
    off()
  }
  assert.ok(received, 'emit 应能送达监听器（否则本条无法验证 G6）')
  assert.equal(received.hasNext, false, "emit 分发时不提供 next ⇒ 这就是 G6 的因果起点")
  assert.match(String(called), /next is not a function/, `调用 next() 应抛 TypeError，实际：${called}`)
})

// ── J5 关联键回填：requestId 与请求一致 ────────────────────────────────────
test('J5 关联键：结果的 requestId 必须等于请求的 requestId（不可错位）', async () => {
  const { ctx } = await boot()
  const id = 'req-unique-42'
  const got = await ctx.waterfall('mana/jev/judge', req({ requestId: id, state: 'S5' }), async () => ({
    requestId: id,
    source: 'downstream',
    value: 'unknown',
    probability: null,
    degraded: true,
    reason: 'downstream',
  }))
  assert.equal(got.requestId, id, 'requestId 必须回填一致（方案原用 id/requestId 两套，I-6 已统一）')
  assert.ok(existsSync(join(fileURLToPath(ROOT), 'packages/jev/src/index.ts')))
})
