/**
 * **大环路递归检索 · 生产接线判据**（E2 · v10 §12.5「大环路递归」/ §14.7「大环路递归检索」）。
 *
 * ⚠ **运行方式**（本仓实测过的假绿形态）：**不许用通配** —— `node --test "tests/*.test.mjs"` 在目录
 *   不存在时**静默 exit 0**。本文件由 `tests/gate.mjs` 以**显式路径**拉起（`npm test`），
 *   单跑：`node --test packages/vector/tests/bigloop-wiring.test.mjs`。
 *
 * ── 本文件判什么（逐条对着卡面验收标准）───────────────────────────────────────────
 * | 卡面要求 | 落点 |
 * |---|---|
 * | ① `runBigLoop` 从 index.ts 导出且**生产可达** | ① 静态腿（导出面）+ ⑤ 端到端**真调用** |
 * | ② `recall.ts` 接线且**开关缺省为关** | ② 缺省面 + ⑥ 缺省关时**桩计数 = 0** |
 * | ③ 提供**真实 retrieve 实现**（非 null） | ④ 真装 core 真查库 + ⑨ 真端口直跑 |
 * | ④ 缺省关时既有判据零变红 | ③ 关/开两次运行的 `RecallOutcome` 契约字段**逐字相同** |
 *
 * ── 接线证据的形态：**桩计数**（不是"测试直接调函数"）──────────────────────────────
 * 判据口径原文：「接线 = 生产调用方真的调它 …… **不接受**「测试直接 import 这个函数并调用它」」。
 * 故本文件用 `node:module` 的 `registerHooks` 把 `src/bigloop.ts` 的 **URL 重定向到一个会计数的
 * 桩模块**（桩 `export *` 真实现 + 覆写 `runBigLoop`：记录调用后**转调真实现**），然后**只走生产入口**
 * `svc.recall()`。于是：
 *   · `stub.__calls.length` **就是**"生产路径真的调了几次 `runBigLoop`"（不是"函数可用"）；
 *   · 桩转发给真实现 ⇒ 读数仍是真的（`status`/`roundsRun`/`mergedRows` 都可断言）。
 * ⚠ **不加任何生产侧测试钩子**：`src/` 里没有 `seam`/`__stub` 这类为测试而生的字段
 *   （那种钩子本身就是"生产面为测试而变"，本仓禁的形态）。
 * ⚠ 桩**不拦 `retrieve``**：端口是不是真的在检索，另由 ④ 与 ⑩ 的**真库读数**取证。
 *
 * ── 判据的**反证**（本仓要求：没有负向对拍 = 没做完）─────────────────────────────
 *   · **反证 A**（⑧）：把**空查询**喂进检索路径 ⇒ `recallLexical` 走 `too_short` 长度闸
 *     ⇒ 大环路报 `clue-frontier-empty`**收敛**（不是"达上限"、不是"出错"）。这是**负向**的：
 *     它证明收敛读数真的来自那条腿，而不是"永远收敛"也能通过正向用例。
 *   · **反证 B**（⑥）：开关**关着**时断言 `calls===0` + `stub.__calls.length===0`，
 *     并在同一进程里用**开着的对照组**自证桩真的生效（否则"0 次"是空跑）。
 *
 * ── 边界（本文件**不**碰什么）──────────────────────────────────────────────────
 * · 不改 `packages/core/src/domain.ts` 的 8 事件契约：大环路读数是 `mana/recall` 载荷的
 *   **契约外增量字段**，本文件逐字断言**契约字段一个都没变**（③）；
 * · 不放宽任何断言、不走向量端点（候选全走 `lexicalRank`、嵌入端点恒不可达 ⇒ 零网络）；
 * · 不改 `bigloop.ts`/`rrf.ts`（D2 交付物与既有融合口径），只读它们的导出面。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

/** 期望用例条数（**相等**语义，与 `tests/gate.mjs` 的 FILES 清单同源同值）。 */
const EXPECTED_CASES = 11

const SRC = new URL('../src/', import.meta.url)
const BIGLOOP_SRC = new URL('../src/bigloop.ts', import.meta.url)
const WIRING_SRC = new URL('../src/bigloop-wiring.ts', import.meta.url)
const PORT_SRC = new URL('../src/retrieve-port.ts', import.meta.url)
const INDEX_SRC = new URL('../src/index.ts', import.meta.url)
const PLUGIN = INDEX_SRC.href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href

/** 恒不可达端点（端口 1 无监听）——**每个用例都显式配它**，零网络、逐次同值。 */
const UNREACHABLE = 'http://127.0.0.1:1/v1'

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tempDir = (tag) => {
  const d = mkdtempSync(join(tmpdir(), tag))
  dirs.push(d)
  return d
}

/**
 * 装一个**会计数的 `runBigLoop` 桩**，把 `src/bigloop.ts` 的 URL 重定向过去。
 *
 * 桩模块内容（逐行可读，**不含任何魔法**）：
 *   `export * from '<bigloop.ts>?e2-real=1'` —— 其余导出面逐字转发；
 *   `import * as real from '<bigloop.ts>?e2-real=1'` —— 拿**真实现**（URL 带 query ⇒ 不匹配
 *     下面的替换条件 ⇒ 真实现即使 import 自己也不会再被换掉，**不自递归**）；
 *   `export async function runBigLoop(opts)` —— 记录 `{baseQuery, baseKeys, maxRounds}` 后
 *     **转调真实现**，并把真读数一并记进 `__calls`（两条都在，正向用例才有东西可断言）。
 *
 * ⚠ **替换只在 `src/bigloop.ts` 首次求值时发生**：谁先加载它谁定终身 —— 若本文件（或任何
 *   先跑的用例）已经把**真实现**读进 ESM 模块表，调用链拿到的就是真模块，桩只能计到 0 次，
 *   而"0 次"恰好也是⑥要断言的形态 ⇒ 那是一条**静默的空跑**。故本文件**一次都不 import 真实现**
 *   （读数一律经生产面或桩转发拿），且桩在任何 `ctx.plugin(vecMod)` 之前注册。
 *   ⚠ 全文件只有两个用例需要桩（⑤与⑥），它们**必须相邻且都排在前排**：Node 的 `--test`
 *   默认在本进程内按顺序跑用例，夹在中间的任何"开着的"`recall()` 都会先加载真实现。
 */
function installRunBigLoopStub() {
  const real = BIGLOOP_SRC.href
  const dir = tempDir('mana-e2-stub-')
  const stubPath = join(dir, 'bigloop-stub.mjs')
  writeFileSync(
    stubPath,
    [
      "export * from '" + real + "?e2-real=1'",
      "import * as real from '" + real + "?e2-real=1'",
      'export const __calls = []',
      'export async function runBigLoop(opts) {',
      '  const result = await real.runBigLoop(opts)',
      '  __calls.push({ baseQuery: opts.baseQuery, baseKeys: [...(opts.baseKeys ?? [])], maxRounds: opts.knobs?.maxRounds ?? null, result })',
      '  return result',
      '}',
      '',
    ].join('\n'),
  )
  const stubUrl = pathToFileURL(stubPath).href
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const r = nextResolve(specifier, context)
      if (typeof r.url === 'string' && r.url === real) return { ...r, url: stubUrl }
      return r
    },
  })
  return import(stubUrl)
}

/**
 * **桩单例**：`src/bigloop.ts` 在一个进程里只会被"首次 URL 替换"命中一次 ⇒ 第二个用例再
 * `registerHooks` 也不会改变已绑定的调用链（新桩恒计 0 次，是**静默空跑**）。
 * 故全文件共用一个桩：用例按"**调用次数的增量**"断言，而不是跨用例的绝对值。
 */
let STUB = null
const getStub = () => (STUB ??= installRunBigLoopStub())

/** 合成夹具向量（确定性，不用随机数 ⇒ 不出现"一会儿过一会儿不过"）。 */
const fixtureVec = (dim, seed) => {
  const v = new Float32Array(dim)
  for (let i = 0; i < dim; i++) v[i] = Math.sin((i + 1) * (seed + 1) * 0.011) * Math.cos(i * 0.017 + seed)
  return v
}

/** 3 条候选（与既有 W1-4/W2-C3 判据同规模：最小可判面）。 */
const CANDS = ['mem-e2-a', 'mem-e2-b', 'mem-e2-c']

/**
 * 装 core + vector（**只用生产入口**）。
 * ⚠ 要装桩的用例必须**先** `await installRunBigLoopStub()` 再调本函数（见其说明）。
 */
async function mount(tag, { vecConfig = {} } = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const vecMod = await import(PLUGIN)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir(tag), 'mana.db') })
  await settle(200)
  const core = ctx.get('mana-core')
  ctx.plugin(vecMod, { embedBaseUrl: UNREACHABLE, ...vecConfig })
  await settle(300)
  const svc = ctx.get('mana-vector')
  assert.ok(svc, 'mana-vector 服务必须可读（未 provide = 插件没真跑起来）')
  for (let i = 0; i < CANDS.length; i++) {
    const w = await svc.putMemoryVector(CANDS[i], fixtureVec(1024, i + 1))
    assert.equal(w.written, true, '候选常驻写入必须成功：' + w.reason)
  }
  return { ctx, core, svc }
}

/** 走**生产检索入口**：一次带信封的召回（端点恒不可达 ⇒ 无网络、确定性降级）。 */
const doRecall = (svc, requestId, query = '末那识 大环路 接线 探针') =>
  svc.recall(
    query,
    CANDS.map((k, i) => ({ key: k, lexicalRank: i + 1 })),
    5,
    { sessionId: 'sess-e2', turnId: 1, requestId },
  )

/** 既有 core 面里写一条记忆（词法腿要真数据才有东西可查）。 */
const seedMemory = (core, id, content, summary = null) =>
  core.writeMemoryItem({ id, type: 'fact', content, ...(summary === null ? {} : { summary }) })

const readSrc = (url) => readFileSync(fileURLToPath(url), 'utf8')

// ── ⓪ 判据自检（防"空文件也绿"/"删一条不变色"）──────────────────────────────────
test('E2-⓪ 判据自检：本文件 test( 计数等于 ' + EXPECTED_CASES + '，交付文件齐备且接线点在 recall 实现体里', () => {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  assert.equal(n, EXPECTED_CASES, '用例条数必须恰好 ' + EXPECTED_CASES + '（实测 ' + n + '）—— 删一条即有判据被删走；若确为有意增删，请同步 tests/gate.mjs 的 FILES 清单')
  assert.ok(!/^test\.only\(/m.test(src), '不得留下 test.only（那会让其余判据静默不跑）')
  assert.ok(/assert\./.test(src), '本文件必须真的含断言（空壳用例会让闸的计数腿变成装饰）')
  for (const f of ['index.ts', 'recall.ts', 'bigloop.ts', 'bigloop-wiring.ts', 'retrieve-port.ts', 'rrf.ts']) {
    assert.ok(readSrc(new URL(f, SRC)).length > 0, '交付文件缺失或为空：src/' + f)
  }
  const index = readSrc(INDEX_SRC)
  // 静态腿（**调用**而不是 import）：接线必须落在 recall 实现体里
  assert.ok(/await runBigLoopWiring\(/.test(index), 'index.ts 的 recall 出口必须**调用** runBigLoopWiring（只有 import = 没接线）')
  const recallAt = index.indexOf('recall: async (query, candidates')
  assert.ok(recallAt > 0, '必须能在源码里定位 recall 实现体（锚点漂了本断言就是空跑）')
  assert.ok(index.indexOf('await runBigLoopWiring(') > recallAt, '调用点必须在 recall 实现体**之后**（即在其内部）')
})

// ── ① 静态腿：runBigLoop 从 index.ts 导出，且调用链是 src 里的真 import ─────────
test('E2-① 导出面与调用链：index.ts 导出 runBigLoop/读数类型；wiring ⇒ bigloop 是同源 import', () => {
  const index = readSrc(INDEX_SRC)
  const wiring = readSrc(WIRING_SRC)
  assert.ok(/export \{ runBigLoop \} from '\.\/bigloop\.ts'/.test(index), 'index.ts 必须**从 bigloop.ts 导出** runBigLoop（不是另写一份实现）')
  for (const t of ['BigLoopResult', 'BigLoopKnobs', 'BigLoopReadout', 'BigLoopWiringKnobs']) {
    assert.ok(index.includes(t), 'index.ts 必须导出读数类型 ' + t)
  }
  assert.ok(/import \{[^}]*runBigLoop[^}]*\} from '\.\/bigloop\.ts'/.test(wiring), 'bigloop-wiring.ts 必须真 import runBigLoop（调用链同源）')
  assert.ok(/opts\.seam \?\? runBigLoop/.test(wiring), '未显式传 seam 时必须调到**真** runBigLoop（opts.seam ?? runBigLoop）')
  // G9：本次接线**不新增注册点**（只有函数导出，落库/广播仍由 index.ts 单点做）
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const f of ['bigloop-wiring.ts', 'retrieve-port.ts']) {
    const code = strip(readSrc(new URL(f, SRC)))
    assert.ok(code.includes('makeBigLoopRetriever') || code.includes('runBigLoop'), '注释剥离后必须仍含真实现（否则下面全是空跑）')
    for (const banned of ['ctx.on(', 'ctx.effect(', 'ctx.waterfall(', 'registerPassThroughPreStep', 'setInterval', 'setTimeout']) {
      assert.ok(!code.includes(banned), f + ' 不得出现 ' + banned + '（本模块只导出函数，零注册点）')
    }
  }
})

// ── ② 桩计数（正向）：生产路径**真调用** runBigLoop，参数逐项可查 ────────────────
test('E2-② 接线证据（桩计数·正向）：svc.recall() ⇒ 生产链真调用 runBigLoop，参数 = 种子/查询/轮数', async (t) => {
  const stub = await getStub()
  const { ctx, core, svc } = await mount('mana-e2-proof-', { vecConfig: { bigLoop: { enabled: true, maxRounds: 2 } } })
  await settle(100)
  assert.equal(stub.__calls.length, 0, '本用例是**首次**加载 bigloop.ts 的用例（否则桩恒 0 次，见 getStub 说明）；装配阶段也不得调用它')
  seedMemory(core, 'e2-proof-1', '接线判据：被召回的记忆内容', '接线判据')

  await doRecall(svc, 'e2-proof')
  await settle(150)

  // ① 生产入口真的调了它 —— **这就是接线证据**
  assert.equal(stub.__calls.length, 1, 'svc.recall() 必须让生产链**真调用** runBigLoop 恰好一次（实测 ' + stub.__calls.length + '）')
  const call = stub.__calls[0]
  // ② 参数面：种子 = 本次召回命中的键；查询 = 调用方给的原串；轮数 = 配置面透传
  assert.deepEqual(call.baseKeys, CANDS, '种子必须是本次召回管道命中的键（与门控/图腿同一份候选面）：' + JSON.stringify(call.baseKeys))
  assert.equal(call.baseQuery, '末那识 大环路 接线 探针', 'baseQuery 必须是本次查询串')
  assert.equal(call.maxRounds, 2, 'maxRounds 必须由配置面透传（不是内部写死的第二份真源）')
  // ③ 桩转发的是**真实现** ⇒ 读数也是真的（不是桩自造的对象）
  assert.equal(call.result.status, 'converged', '真实现的读数必须可断言：' + JSON.stringify({ s: call.result.status, r: call.result.roundsRun }))
  assert.equal(call.result.ran, true, 'ran 必须为 true')
  const read = svc.lastBigLoop()
  assert.equal(read.roundsRun, call.result.roundsRun, '载荷读数的轮数必须等于真实现返回的轮数（两处不得漂开）')
  assert.equal(read.mergedRows, call.result.mergedRows, '载荷读数的行数必须等于真实现返回的行数')
  // ④ 服务面与载荷是**同一份读数**：第二次召回带上信封，逐字比对
  let payload = null
  ctx.on('mana/recall', (p) => {
    payload = p
  })
  await doRecall(svc, 'e2-proof-2')
  await settle(150)
  assert.equal(stub.__calls.length, 2, '第二次召回必须再调一次（不是只调了第一次）')
  assert.ok(payload, 'mana/recall 必须仍被 emit（接线不得摘掉它）')
  assert.deepEqual(payload.bigLoop, svc.lastBigLoop(), '载荷里的大环路读数必须与 lastBigLoop() 逐字相同（同一转换函数）')
  assert.equal(payload.bigLoop.applied, false, '载荷里的 applied 必须显式为 false（不是靠注释）')
  t.diagnostic(
    '[接线证据·桩计数·正向] svc.recall() ⇒ runBigLoop 调用次数=' + stub.__calls.length +
      ' · 第1次参数=' + JSON.stringify({ baseQuery: call.baseQuery, baseKeys: call.baseKeys, maxRounds: call.maxRounds }) +
      ' · 真读数=' + JSON.stringify({ status: call.result.status, roundsRun: call.result.roundsRun, mergedRows: call.result.mergedRows }) +
      ' · 载荷=lastBigLoop()',
  )
  await ctx.stop?.()
})

// ── ③ 桩计数（负向）：开关**缺省关**时，生产路径**一次都不调** ───────────────────
test('E2-③ 接线证据（桩计数·负向）：缺省配置下 svc.recall() ⇒ runBigLoop **零增量**', async (t) => {
  const stub = await getStub()
  const baseline = stub.__calls.length
  assert.ok(baseline >= 1, '前置：前面的正向用例已经调过一次（否则本用例的"零增量"不可判）：' + baseline)
  // ⚠ 不传 bigLoop 配置 ⇒ 走**缺省**（这正是卡面的"开关缺省必须是关"）
  const { ctx, core, svc } = await mount('mana-e2-off-', {})
  seedMemory(core, 'e2-off-1', '缺省关判据：被召回的记忆内容', '缺省关判据')
  const out = await doRecall(svc, 'e2-off')
  await settle(150)

  assert.equal(stub.__calls.length, baseline, '⚠ 缺省关时生产路径**不得调用** runBigLoop（实测增量 ' + (stub.__calls.length - baseline) + '）——调了就说明缺省被改成了开')
  const read = svc.lastBigLoop()
  assert.equal(read.enabled, false, '缺省必须是关')
  assert.equal(read.attempted, false, 'attempted=false（门外没有调用）')
  assert.equal(read.calls, 0, '端口调用 0 次 ⇒ 一次检索都没发')
  assert.equal(read.roundsRun, 0, '轮数 0（"没跑"这一态不得冒充"跑了 0 轮"）')
  // 反向自证：同一个桩在**开着**的配置下必须被调到 —— 否则上面那条"0 次"可能是桩根本没生效
  const on = await mount('mana-e2-off-ctl-', { vecConfig: { bigLoop: { enabled: true, maxRounds: 1 } } })
  seedMemory(on.core, 'e2-off-2', '缺省关判据：对照组的记忆内容', '缺省关判据')
  await doRecall(on.svc, 'e2-off-ctl')
  await settle(150)
  assert.equal(stub.__calls.length, baseline + 1, '反向自证失败：同一个桩在**开着**的配置下必须被调用（否则"零增量"是空跑）：' + (stub.__calls.length - baseline))
  assert.equal(out.degraded, true, '前提：端点不可达 ⇒ 降级（本用例只判调用面）')
  t.diagnostic(
    '[接线证据·桩计数·负向] 缺省配置 ⇒ runBigLoop 增量=0 · 开配置对照组 ⇒ 增量=' + (stub.__calls.length - baseline) +
      ' · 关侧 calls=' + read.calls + ' roundsRun=' + read.roundsRun + ' unwiredReason=' + read.unwiredReason,
  )
  await ctx.stop?.()
  await on.ctx.stop?.()
})

// ── ④ 缺省面：开关**缺省关**，且缺省值只有一个真源 ─────────────────────────────
test('E2-④ 缺省关：DEFAULT_BIGLOOP_WIRING.enabled === false，且 Config 缺省与它同值', async () => {
  const mod = await import(WIRING_SRC.href)
  const w = mod.DEFAULT_BIGLOOP_WIRING
  assert.equal(w.enabled, false, '⚠ 大环路开关**缺省必须为关**（开着会改主链的耗时与复杂度）')
  assert.ok(Object.isFrozen(w), '缺省旋钮必须冻结（防"缺省被就地改写"两处悄悄分叉）')
  const { Config } = await import(PLUGIN)
  const got = Config({})
  assert.equal(got.bigLoop.enabled, false, 'Config.bigLoop.enabled 的缺省必须也是 false（配置面唯一真源）')
  for (const k of ['maxRounds', 'lexicalLimit', 'topK']) {
    assert.equal(got.bigLoop[k], w[k], 'Config.bigLoop.' + k + ' 的缺省必须与 DEFAULT_BIGLOOP_WIRING 同值')
  }
  // 反向自证：显式传 true 必须能开 —— 否则上面判的是"永远 false"（空跑）
  assert.equal(Config({ bigLoop: { enabled: true } }).bigLoop.enabled, true, '显式传 true 必须能开')
  assert.equal(Config({ bigLoop: { enabled: false } }).bigLoop.enabled, false, '显式传 false 必须能关')
})

// ── ⑤ 契约字段零改动：关/开两次运行的 RecallOutcome 逐字相同 ────────────────────
test('E2-⑤ 契约面：开关开与关的 channel/rankBy/degraded/hitCount/items 逐字相同（A1-11 锚点）', async (t) => {
  const off = await mount('mana-e2-c-off-')
  const on = await mount('mana-e2-c-on-', { vecConfig: { bigLoop: { enabled: true, maxRounds: 2 } } })
  for (const m of [off, on]) {
    seedMemory(m.core, 'e2-seed', '合成记忆 甲：大环路接线判据的种子', '大环路 接线 种子')
    seedMemory(m.core, 'e2-clue', '合成记忆 乙：线索片段 大环路 接线', '线索片段')
  }
  const a = await doRecall(off.svc, 'e2-contract-off')
  const b = await doRecall(on.svc, 'e2-contract-on')
  await settle(150)

  const offRead = off.svc.lastBigLoop()
  const onRead = on.svc.lastBigLoop()
  assert.ok(offRead && onRead, '两侧 lastBigLoop() 必须可读（接线面的即时出口）')
  assert.equal(offRead.enabled, false, '关侧前提：配置面是关的')
  assert.equal(onRead.enabled, true, '开侧前提：配置面是开的')
  assert.equal(onRead.attempted, true, '开侧前提：大环路必须真被调用（否则下面"逐字相同"是平凡通过）：' + onRead.unwiredReason)

  for (const f of ['query', 'hitCount', 'channel', 'rankBy', 'degraded']) {
    assert.deepEqual(a[f], b[f], '大环路不得改动 RecallOutcome.' + f + '：关=' + JSON.stringify(a[f]) + ' vs 开=' + JSON.stringify(b[f]))
  }
  assert.deepEqual(a.items.map((i) => i.key), b.items.map((i) => i.key), 'items 的键序也不得被大环路改动')
  assert.deepEqual(a.items.map((i) => i.score), b.items.map((i) => i.score), 'items 的分也不得被大环路改动')
  // 关侧读数：一次检索都没发（三态里的"没跑"那一态，取值与其他两态互不冒充）
  assert.equal(offRead.attempted, false, '关侧：attempted 必须 false')
  assert.equal(offRead.status, null, '关侧：status 必须 null（没跑，不得用别的值冒充）')
  assert.equal(offRead.roundsRun, 0, '关侧：roundsRun 必须 0')
  assert.equal(offRead.calls, 0, '关侧：端口调用 0 次（"一次检索都不发"的机械落点）')
  assert.match(String(offRead.unwiredReason), /显式关闭/, '关侧原因必须说"显式关闭"（与"失败"措辞不同）：' + offRead.unwiredReason)
  assert.equal(offRead.applied, false, 'applied 必须恒为 false（本批只带读数、不改管道）')
  t.diagnostic(
    '[契约面] 关=' + JSON.stringify({ c: a.channel, r: a.rankBy, d: a.degraded, h: a.hitCount }) +
      ' / 开=' + JSON.stringify({ c: b.channel, r: b.rankBy, d: b.degraded, h: b.hitCount }) +
      ' 逐字相同 · 关侧 calls=' + offRead.calls + ' roundsRun=' + offRead.roundsRun,
  )
  await off.ctx.stop?.()
  await on.ctx.stop?.()
})

// ── ⑥ 真实 retrieve：端口不是 null，且真查真库（词法腿 + 图腿 + 线索）────────────
test('E2-⑥ 真实 retrieve 实现：词法腿真查 FTS5、图腿真沿关联边扩、线索真从库读', async (t) => {
  const { ctx, core, svc } = await mount('mana-e2-port-', { vecConfig: { bigLoop: { enabled: true, maxRounds: 2 } } })
  seedMemory(core, 'e2-p-seed', '大环路端口判据：种子记忆的内容面', null)
  // ⚠ 对家必须**词法腿打不到**（内容与本轮查询无关）：否则它自己就是词法命中 ⇒ 它进了图腿的
  //   **种子集**，而 `expandByAdjacency` 铁律是"种子恒不进 additions" ⇒ 图腿的贡献恒为空，
  //   本用例会假红（实测抓到过：对家的正文里带了同一批词）。图腿要证的是"**词法腿带不回来**
  //   的键，靠关联边带回来了"。
  seedMemory(core, 'e2-p-hidden', '完全无关的正文：甲乙丙丁戊己', null)
  core.db.prepare('UPDATE memory_items SET tags = ? WHERE id = ?').run('端口判据,大环路端口', 'e2-p-seed')
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run(JSON.stringify([{ id: 'e2-p-hidden', w: 0.03 }]), 'e2-p-seed')

  const out = await svc.recall('大环路端口判据', [{ key: 'e2-p-seed', lexicalRank: 1 }], 5, {
    sessionId: 'sess-e2-port',
    turnId: 1,
    requestId: 'e2-port',
  })
  await settle(150)
  const read = svc.lastBigLoop()
  assert.equal(out.degraded, true, '前提：端点不可达 ⇒ 管道是**降级**态（本用例只判端口面）')
  assert.equal(read.attempted, true, '大环路必须真跑：' + read.unwiredReason)

  // (a) 「真实实现」的可断言形态：三条来源各留下**真库**读数
  assert.equal(read.calls >= 1, true, '端口必须至少被调用一次（0 次 ⇒ 大环路没跑）')
  assert.equal(read.lexicalKeys.includes('e2-p-seed'), true, '词法腿必须真查到种子那条（真读 FTS5，不是空壳）：' + JSON.stringify(read.lexicalKeys))
  assert.equal(read.lexicalKeys.includes('e2-p-hidden'), false, '前提：对家**不是**词法命中（否则它自己就是图腿的种子 ⇒ 图腿的贡献不可分辨）：' + JSON.stringify(read.lexicalKeys))
  // ⚠ 长度 = calls（端口每次调用都记一条）⇒ 断言**逐轮的尾项**：每轮都必须有命中（null）
  assert.equal(read.lexicalReasons.length, read.calls, '逐轮读数长度必须等于 calls（两处不得漂开）')
  assert.deepEqual(read.lexicalReasons, Array(read.calls).fill(null), '每轮都必须真查且有命中 ⇒ 逐轮原因恒 null（"真查了就是 0 命中"才是 ok，两者不得冒充）')
  assert.equal(read.graphRounds >= 1, true, '图腿必须真跑过：' + read.graphRounds)
  assert.equal(read.graphKeys.includes('e2-p-hidden'), true, '图腿必须把**词法腿带不回来**的关联对家带回来（真读 related_ids）：' + JSON.stringify(read.graphKeys))
  assert.equal(read.clueCount >= 1, true, '关联线索必须真抽到（线索是"下一轮问什么"的输入，不是装饰）：clueCount=' + read.clueCount)
  assert.equal(read.clueReadFailures, 0, '本用例无故障注入 ⇒ 线索读失败必须为 0：' + read.clueFailureReason)
  assert.equal(read.queries.length, read.calls, 'queries 长度必须等于 calls（两处读数不得漂开）')
  assert.match(read.consumed, /种子 1 个/, '读取口径必须点名种子数：' + read.consumed)
  t.diagnostic(
    '[真实端口] calls=' + read.calls + ' queries=' + JSON.stringify(read.queries) +
      ' lexicalKeys=' + JSON.stringify(read.lexicalKeys) + ' graphKeys=' + JSON.stringify(read.graphKeys) +
      ' clues=' + read.clueCount + ' status=' + read.status + ' roundsRun=' + read.roundsRun,
  )
  await ctx.stop?.()
})

// ── ⑦ 边界（挡的方向）：越界轮数 ⇒ 抛 ⇒ 折叠成显式 error，召回本身不失败 ─────────
test('E2-⑦ 边界（挡）：maxRounds 越界 ⇒ runBigLoop 抛 ⇒ 接线留痕，且不静默 clamp、不拖垮召回', async (t) => {
  const { ctx, core, svc } = await mount('mana-e2-bound-', { vecConfig: { bigLoop: { enabled: true, maxRounds: 999 } } })
  seedMemory(core, 'e2-bound-1', '边界判据：被召回的记忆内容', '边界判据')
  const out = await doRecall(svc, 'e2-bound')
  await settle(150)
  const read = svc.lastBigLoop()

  // 挡的方向：越界必须**留痕**，且**不得**被静默 clamp 成 32 轮
  assert.equal(read.attempted, true, 'attempted 必须 true（调用了，只是抛了）')
  assert.equal(read.status, null, 'status 必须 null（没有结果，不得用别的值冒充）')
  assert.match(String(read.error), /maxRounds/, 'error 必须带原始报错（点名 maxRounds）：' + read.error)
  assert.match(String(read.unwiredReason), /抛错/, 'unwiredReason 必须说"已调用但抛错"（与"显式关闭"措辞不同）：' + read.unwiredReason)
  assert.equal(read.roundsRun, 0, '抛错 ⇒ 一轮都没跑完')
  // 主链不陪葬（fail-open 的落点）：召回照常返回有序结果
  assert.equal(out.degraded, true, '前提：端点不可达')
  assert.equal(out.items.length, CANDS.length, '大环路抛错**不得**让召回失败（fail-open）：' + out.items.length)
  assert.equal(out.rankBy, 'local_score', '契约字段不得被抛错路径改动')
  t.diagnostic('[边界·挡] maxRounds=999 ⇒ error=' + JSON.stringify(read.error) + ' · 召回 items=' + out.items.length + ' rankBy=' + out.rankBy)
  await ctx.stop?.()
})

// ── ⑧ 反证 A：空查询 ⇒ 词法腿 too_short（长度闸）⇒ 大环路收敛于**前沿空** ───────
test('E2-⑧ 边界（挡）：空查询 ⇒ 大环路**显式不跑**（起点缺失），与"关闭"、"抛错"三态互不冒充', async (t) => {
  const stub = await installRunBigLoopStub()
  assert.equal(stub.__calls.length, 0, '前置：本用例必须是**首次**加载 bigloop.ts 的用例（否则"桩计到 0"是空跑，见文件头说明）')
  const { ctx, core, svc } = await mount('mana-e2-empty-', { vecConfig: { bigLoop: { enabled: true, maxRounds: 2 } } })
  seedMemory(core, 'e2-empty-1', '空查询判据：被召回的记忆内容', '空查询判据')
  // 向量管道对空查询串是**照常走**的（它不校验查询长度）；而 bigloop.ts 对 baseQuery 空串是**抛**。
  // 接线层的处置：**不以空查询为起点跑一轮** —— 跑了的话，"起点缺失"会被读成"起点存在但没结果"。
  const out = await svc.recall('', [{ key: CANDS[0], lexicalRank: 1 }], 5, {
    sessionId: 'sess-e2-empty',
    turnId: 1,
    requestId: 'e2-empty',
  })
  await settle(150)
  const read = svc.lastBigLoop()

  assert.equal(stub.__calls.length, 0, '空查询 ⇒ 一次都不许调用 runBigLoop（实测 ' + stub.__calls.length + ' 次）')
  assert.equal(read.enabled, true, '配置面是开着的（本态**不是**"被关掉"）')
  assert.equal(read.attempted, false, '门开着但**没有发起**：attempted=false')
  assert.equal(read.calls, 0, '端口 0 次调用 ⇒ 一次检索都没发')
  assert.equal(read.roundsRun, 0, '轮数 0')
  assert.match(String(read.unwiredReason), /查询串为空/, '原因必须点名"查询串为空"（与"显式关闭"措辞不同）：' + read.unwiredReason)
  assert.ok(!/显式关闭/.test(read.unwiredReason), '空查询的原因不得与"显式关闭"同文（两件事同形即本仓禁的形态）：' + read.unwiredReason)
  assert.equal(read.error, null, '空查询**不是抛错**：error 必须为 null（与⑦的抛错态分开）')
  assert.equal(read.status, null, '没跑 ⇒ status 必须 null（不得用 converged 冒充）')
  assert.equal(read.applied, false, 'applied 恒 false')
  // ⚠ 空查询下**碰巧** items 只剩 1 条（降级 = 有序本地分结果；空串查不到东西是"那就是没有"）。
  //   这条断言**不是**在判大环路（大环路读数是契约外字段），而是把该情形的**事实**钉住：
  //   "件数少"与"大环路改了它"必须可分辨 —— 关掉大环路跑同一次，件数必须相同（见下）。
  assert.equal(out.items.length, 1, '空查询下 items 的件数（事实口径，与大环路无关）：' + out.items.length)
  const off = await mount('mana-e2-empty-off-')
  const outOff = await off.svc.recall('', [{ key: CANDS[0], lexicalRank: 1 }], 5, { sessionId: 'sess-e2-empty-off', turnId: 1, requestId: 'e2-empty-off' })
  assert.deepEqual(out.items.map((i) => i.key), outOff.items.map((i) => i.key), '关/开两次（同为空查询）的 items 必须逐字相同 ⇒ 件数不是大环路造成的')
  t.diagnostic('[边界·挡] 空查询 ⇒ enabled=' + read.enabled + ' attempted=' + read.attempted + ' calls=' + read.calls + ' reason=' + read.unwiredReason + ' · 桩计数=' + stub.__calls.length)
  await ctx.stop?.()
})

// ── ⑨ 真端口直跑（无 Context）：注入项真实生效 + 故障**不吞** ────────────────────
test('E2-⑨ 真端口直跑：线索来源、跨轮并集读数、图腿种子推进真实生效，且 SQL 抛错**不吞**（fail-open）', async () => {
  const { makeBigLoopRetriever } = await import(PORT_SRC.href)
  const rows = new Map([
    ['k-1', { content: '甲乙丙丁，戊己庚辛；壬癸子丑', summary: null, tags: '标签甲,标签乙' }],
    // 第二段长度 > 线索段上界（24）⇒ 必须被截掉；第一段仍是合法线索
    ['k-2', { content: '无标签的键：这一段的长度明确超过线索段的上界因此必须被截掉掉掉掉', summary: null, tags: null }],
  ])
  const queries = []
  const fakeCore = {
    db: {
      prepare(sql) {
        return {
          all(...params) {
            // ⚠ 图腿与线索读**共用** `prepare(sql)`，但 SQL 形状不同 ⇒ 按 SQL 分流：
            //   图腿读 `SELECT id, related_ids FROM memory_items WHERE id = ?`；
            //   线索读 `SELECT content, summary, tags FROM memory_items WHERE id = ?`。
            //   首版没分流（对线索查询也回 related_ids 形状的行）⇒ 线索恒空 + 图腿恒"取不到行"，
            //   是**夹具自己造的假读数**，被本用例当场抓红（"夹具绿 ≠ 真数据绿"要防的正是它）。
            if (/pragma_table_info/.test(sql)) return [{ name: 'related_ids' }]
            if (/related_ids/.test(sql)) return [{ id: String(params[0]), related_ids: null }]
            const id = params[0]
            const row = rows.get(id)
            return row ? [{ id, content: row.content, summary: row.summary, tags: row.tags }] : []
          },
        }
      },
    },
    recallLexical(q, limit) {
      queries.push({ q, limit })
      // 两轮给**不同**的命中 ⇒ "下一轮换了查询串"这件事在端口侧可判
      return { hits: q === '第一轮查询' ? [{ id: 'k-1' }] : [{ id: 'k-2' }], reason: null }
    },
  }
  const port = makeBigLoopRetriever({ core: fakeCore, seedKeys: ['k-1'] })
  const r1 = port('第一轮查询', 1)
  const r2 = port('第二轮查询', 2)
  const ev = port.evidence()

  assert.deepEqual(r1.map((c) => c.key), ['k-1'], '第 1 轮：种子与词法命中同键 ⇒ **只出现一次**（首次胜，不重复）')
  assert.equal(r1[0].score, 0, '同键时胜出的是**种子**那条 ⇒ 分仍是 0（不得被词法分顶掉）')
  assert.deepEqual(r1[0].channels, [], '同上：通道仍是空集（种子没进过任何腿）')
  assert.deepEqual(r1[0].clues, ['标签甲', '标签乙'], 'tags 非空 ⇒ 线索取 tags（首个来源）')
  assert.deepEqual(r2.map((c) => c.key), ['k-2'], '第 2 轮换了查询串 ⇒ 词法腿带回**新键**（端口侧"线索驱动下一轮"的落点）')
  assert.ok(Math.abs(r2[0].score - 1 / 61) < 1e-12, '词法命中的分必须是 RRF 分 1/(k+rank)（k=60、rank=1 ⇒ 1/61）：' + r2[0].score)
  assert.deepEqual(r2[0].clues, ['无标签的键'], '无 tags ⇒ 从内容切段；超过上界的那一段必须被截掉（不作线索）')
  assert.deepEqual(queries.map((x) => x.q), ['第一轮查询', '第二轮查询'], '每轮用的**原串**必须进读数（端口不替调用方改写查询）')
  assert.equal(ev.calls, 2, 'evidence.calls 必须等于真调用次数')
  assert.deepEqual(ev.lexicalKeys, ['k-1', 'k-2'], '词法命中是**跨轮并集**（不是"最近一次"）：两轮的命中都在')
  assert.deepEqual(ev.lexicalReasons, [null, null], '逐轮原因分类：两轮都真查且有命中 ⇒ 皆 null（长度 = calls）')
  assert.deepEqual(ev.graphReasons, [null, null], '逐轮图腿原因：**无关联边不是失败** ⇒ 两次都必须 null（"没扩"与"没读成"可分辨）')
  assert.deepEqual(ev.graphKeys, [], '夹具里没有关联边 ⇒ 跨轮并集为空（种子不进 graphKeys）')
  assert.equal(ev.clueReadFailures, 0, '夹具无故障 ⇒ 线索读失败必须为 0：' + ev.clueFailureReason)

  // 负向：SQL 抛错必须**留痕**（不是静默读成"没有线索"），且候选不得因此消失
  const broken = makeBigLoopRetriever({
    core: {
      db: {
        prepare() {
          throw new Error('disk I/O error（夹具故障注入）')
        },
      },
      recallLexical: () => ({ hits: [{ id: 'k-9' }], reason: null }),
    },
    seedKeys: ['k-9'],
  })
  const broke = broken('查询', 1)
  assert.equal(broke.map((c) => c.key).includes('k-9'), true, '线索读失败**不得**让候选消失（fail-open）')
  assert.equal(broken.evidence().clueReadFailures > 0, true, '线索读失败必须计数：' + broken.evidence().clueReadFailures)
  assert.match(String(broken.evidence().clueFailureReason), /disk I\/O error/, '失败原文必须进读数（不吞）：' + broken.evidence().clueFailureReason)
  assert.notEqual(broken.evidence().graphReason, null, '图腿同样读不到（同一个 db 桩）⇒ graphReason 必须非空（"没扩"与"没读成"可分辨）')
})

// ── ⑩ 真数据绿（不是夹具绿）：真装 core + 真 FTS5 ⇒ 种子→线索→新查询真跑起来 ────
test('E2-⑩ 真数据面：真 core/FTS5 下种子→线索→新查询的链条在**真数据**上成立', async (t) => {
  const { ctx, core, svc } = await mount('mana-e2-real-', { vecConfig: { bigLoop: { enabled: true, maxRounds: 3 } } })
  // 三条真记忆：种子带 tags（线索源①），目标按内容可被线索查询命中（线索源②）
  seedMemory(core, 'e2-r-seed', '大环路真数据判据：种子记忆的正文', null)
  core.db.prepare('UPDATE memory_items SET tags = ? WHERE id = ?').run('真数据线索甲', 'e2-r-seed')
  seedMemory(core, 'e2-r-target', '真数据线索甲 命中的目标记忆正文', null)
  const out = await svc.recall('真数据线索甲', [{ key: 'e2-r-seed', lexicalRank: 1 }], 5, {
    sessionId: 'sess-e2-real',
    turnId: 1,
    requestId: 'e2-real',
  })
  await settle(200)
  const read = svc.lastBigLoop()

  assert.equal(read.attempted, true, '必须真跑：' + read.unwiredReason)
  assert.equal(read.lexicalKeys.includes('e2-r-target'), true, '第 1 轮词法腿必须真命中目标记忆（真 FTS5，不是夹具）：' + JSON.stringify(read.lexicalKeys))
  assert.equal(read.mergedRows >= 2, true, '跨轮整合后至少 2 行（种子 + 目标）：' + read.mergedRows)
  assert.equal(read.observations >= read.mergedRows, true, '观测原子数 ≥ 合并行数（(key,round) 唯一 ⇒ 进两次仍是一行）')
  assert.equal(read.clueCount >= 1, true, '线索必须来自真库的 tags： clueCount=' + read.clueCount)
  assert.equal(read.calls >= 2, true, '线索驱动 ⇒ 至少问出第 2 轮（"线索驱动下一轮"的机械落点）：calls=' + read.calls + ' queries=' + JSON.stringify(read.queries))
  assert.equal(out.rankBy, 'local_score', '契约字段仍由向量管道决定（降级口径）')
  t.diagnostic(
    '[真数据] calls=' + read.calls + ' queries=' + JSON.stringify(read.queries) + ' lexicalKeys=' + JSON.stringify(read.lexicalKeys) +
      ' mergedRows=' + read.mergedRows + ' observations=' + read.observations + ' clues=' + read.clueCount +
      ' status=' + read.status + ' stopReason=' + read.stopReason + ' roundsRun=' + read.roundsRun,
  )
  await ctx.stop?.()
})
