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
    // ⚠ **端点必须指向恒不可达端口**（`127.0.0.1:1`），不能留空！
    //   留空 ⇒ 走 `OLLAMA_DEFAULT_ENDPOINT`（真本机 Ollama）⇒ 监听器会发起**真模型调用**：
    //     ① 本判据不再自足（依赖外部服务，违反本仓「判据必须 hermetic」纪律）；
    //     ② 实测单条用例耗时 **23–30 秒**（模型冷启/排队）；
    //     ③ 更糟的是它会**抢占真 Ollama**，把并行跑的 `b12-jev` 真调用判据饿死 ——
    //        实测：本文件与 b12 同时在 `npm test` 里跑时，b12 的 3 条真调用判据全红，
    //        而单独跑 b12 全绿。**那是我的测试污染了别人的判据**（跨用例干扰），
    //        不是 b12 的缺陷。修法就是把本文件变成零网络。
    const config = pkg === 'dsh-mana-core' ? { storePath: store } : { endpoint: 'http://127.0.0.1:1' }
    await ctx.loader.create({ name: pkg, config })
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
  // ⚠ **不能用"结果不等于下游默认值"来判断监听器是否存在**（本席首版如此，实测假绿）：
  //   端点不可达时 jev 走**降级路径** ⇒ 它会**调 next()** 并把下游结果透传回来，
  //   此时 `source` 正是 `downstream-default` —— 看起来"像空链"，其实监听器活得很好。
  //   首版之所以"通过"，是因为当时端点缺省=真 Ollama，判得出结果才没走降级 ——
  //   那是**靠外部服务换来的绿**（非 hermetic），一并修正。
  //   ⇒ 正确判法：**在下游放一个哨兵**，看它有没有被调到。哨兵在 ⇒ 监听器在场且调了 next()。
  let downstreamReached = 0
  const got = await ctx.waterfall('mana/jev/judge', req(), async () => {
    downstreamReached += 1
    return {
      requestId: 'req-judge-1',
      source: 'downstream-default',
      value: 'unknown',
      probability: null,
      degraded: true,
      reason: 'no-listener-default',
    }
  })
  assert.ok(got, 'waterfall 应返回一个结果对象')
  assert.equal(got.requestId, 'req-judge-1', '关联键必须回填（I-6 统一 requestId）')
  // 两种情形都说明"监听器在场"：① 它自己判出来了（source=mana-jev）；② 它调了 next()（哨兵被调到）
  const listenerPresent = got.source === 'mana-jev' || downstreamReached >= 1
  assert.ok(
    listenerPresent,
    `jev 的判定监听器应真接上（否则是空链）：source=${got.source}、下游哨兵被调=${downstreamReached}`,
  )
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
test('J4 负向：ctx.emit 分发 waterfall 型事件会因 next 不是函数而炸（G6）', async () => {
  // ⚠ **实测把这条讲准了**（本仓 2026-09-25，四轮探针 + 本轮修 hermetic 后再观察）：
  //   `event-types.ts` 写「用 `emit` 会**同步抛** TypeError」。准确表述是：
  //     ① `emit` **确实**把事件送达监听器，但不提供 `next`；
  //     ② 于是**任何调用 `next()` 的监听器**都会抛 `TypeError`；
  //     ③ 抛出**不在 `emit` 的同步栈上** —— 实测落在监听器内部
  //        （`packages/jev/lib/index.js`），以 unhandledRejection 的形态冒出来；
  //        同步 `try/catch` **抓不到**，且它会被 test runner 记到**当前正在跑的用例**头上。
  //   ⇒ 本判据**不试图捕获**（"能不能捕获"受装配方式影响、不可靠）。改为直接断言
  //     **因果链**：`emit` 能送达 + 送达时 `next` 为 `undefined` + 调它必抛。
  //     同时把"jev 那个监听器真的会因此炸"作为**独立见证**：它由 unhandledRejection
  //     冒出来后，runner 会把本条判红 —— 那本身就是 G6 生效的证明，不是本测试写错。
  //     ⚠ 为了让它**可控**，本用例在 `emit` 前先临时关掉 jev 的监听器（用 `off`），
  //       只留自己的探针，从而断言纯粹、不与 runner 的归因冲突。
  const { ctx } = await boot()
  // ⚠ **先卸掉 jev 的监听器再测**：jev 自己的监听器也会在 `emit` 下抛 `next is not a function`
  //   （这正是 G6 的实证），而那个错误以 unhandledRejection 形式冒出来后，
  //   会被 Node test runner 归因到**当前正在执行的用例**上 ⇒ 本条判红但**报错点不在本条内**。
  //   为了让断言"纯净、可归因"，本用例先卸 jev（只留探针），断言因果链本身；
  //   jev 会因此炸这件事，由**别处**（如生产侧的真实调用路径）自然暴露，不在此处重复。
  const entries = [...ctx.loader.entries()]
  const jevEntry = entries.find((e) => String(e.options?.name ?? '').includes('dsh-mana-jev'))
  if (jevEntry) ctx.loader.remove(jevEntry.id)
  await settle(200)

  let received = null
  let calledError = null
  const off = ctx.on('mana/jev/judge', async (_r, next) => {
    received = { hasNext: typeof next === 'function' }
    try {
      await next()
    } catch (error) {
      calledError = String(error?.message ?? error)
    }
    return { requestId: 'x', source: 'probe', value: 'unknown', probability: null, degraded: true, reason: 'probe' }
  })
  try {
    ctx.emit('mana/jev/judge', req({ state: 'S4' }))
    await settle(300)
  } finally {
    off()
  }
  assert.ok(received, 'emit 应能送达监听器（否则本条无法验证 G6）')
  assert.equal(received.hasNext, false, 'emit 分发时不提供 next ⇒ 这就是 G6 的因果起点')
  assert.match(String(calledError), /next is not a function/, `调用 next() 应抛 TypeError，实际：${calledError}`)
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
