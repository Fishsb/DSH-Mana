/**
 * `dsh-mana-perception` 包内判据（F4 · 源头席 · 本包此前零判据）
 *
 * 覆盖（对应派单 ①–④）：
 *   ① 真生产路径：`perceive(input)` 发出的 `mana/observation` **真落** `mana_trace`，且 `event_type` 正确；
 *   ② `chunkText()` 闭式锚点：固定夹具下分块边界**逐字复现**（空串 / 单字 / 恰满 / 超一 / 超长 / 多段）；
 *   ③ `observation` 类的**可达性**（与 A1-1 同口径，但**本包自证**，不借 chain-e2e 的链级覆盖）；
 *   ④ 形态面：`ctx.effect` 注册点数、`mana_trace` 写入类型落在 S1 五类内。
 *
 * ⚠ **为什么"真生产路径"必须走真 `Loader`**：直接 `import` src 再手调 `perceive` 只能证明
 *   "这个函数会 emit"，证明不了"装配后这条链真的接上了"。本用例用真 `Context` + 真 cordis
 *   `Loader` 按**包名**解析（与 `tools/r0-assembly-check.mjs` 同口径），装配判据 = **服务可读**。
 *
 * ⚠ 读的是 **src** 不是 lib（与 `packages/core/tests/chain-e2e.test.mjs:42` 同口径）：产物陈旧时
 *   判据会去测旧代码；本文件是 perception 的判据源，必须直读 src。
 *   ⇒ 负向对拍改 src 后须重建该包 lib（`npm run build -w dsh-mana-perception`），否则 mtime 腿假红。
 *
 * ⚠ 库一律用**临时库**（本仓硬纪律：绝不指向 `$DSH_HOME/memory/mana.db`）。
 * 运行（**禁止管道取退出码**）：node --test packages/perception/tests/*.test.mjs ; echo $?
 * 或：node packages/perception/verify.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ⚠ `cordis` / `cordis-plugin-loader` 不是本仓 workspace 依赖（是宿主的），按包名 import 会
//   ERR_MODULE_NOT_FOUND ⇒ 从 DSH 安装目录按绝对路径取（先例：core/tests/chain-e2e.test.mjs:26）。
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const BASE_URL = pathToFileURL(REPO + '/').href

const { Context } = await import(DSH + '/cordis/lib/index.js')
const Loader = (await import(DSH + '/cordis-plugin-loader/lib/index.js')).default

/** 五类的**唯一真源** = 契约的 MANA_STAGES（core/src/domain.ts:18）。本文件不手写第三套字面量。 */
const { MANA_STAGES } = await import(new URL('../../core/src/domain.ts', import.meta.url).href)

const mod = await import(new URL('../src/index.ts', import.meta.url).href)
const { chunkText } = mod

const cleanups = []
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/**
 * 起一条真装配链：core → attention → perception。
 *
 * ⚠ attention 必须在链上：`observation` 这一类的 `mana_trace` 行**由 attention 写**
 *   （attention/src/index.ts:165），perception 自己只 `ctx.emit('mana/observation', obs)`。
 *   这正是 ④ 要钉的形态事实：源头包**不直接写库**，它的可观测性由事件链承载。
 */
async function bootChain({ maxChunkChars = 1200, chunkOverlapChars = 120 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-perception-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: store } })
  await settle(150)
  await ctx.loader.create({ name: 'dsh-mana-attention', config: {} })
  await settle(150)
  await ctx.loader.create({ name: 'dsh-mana-perception', config: { maxChunkChars, chunkOverlapChars } })
  await settle(150)
  const missing = ['mana-core', 'mana-attention', 'mana-perception'].filter((s) => !ctx.get(s))
  assert.deepEqual(missing, [], `未装配的服务：${missing.join(', ')}`)
  return { ctx, store }
}

/** 独立只读连接读库（不复用插件句柄：卸载即净会关掉它）。 */
function readTrace(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  const rows = db.prepare('SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace ORDER BY seq').all()
  db.close()
  return rows
}

const observationRows = (rows) => rows.filter((r) => r.event_type === MANA_STAGES[0])

// ── ① 真生产路径：observation 真落库，且内容逐块对得上 ────────────────────────
test('P1 ①真生产路径：经真 Loader 链 perceive ⇒ mana_trace 出现 observation 行，块数与内容逐块对上', async () => {
  const { ctx, store } = await bootChain({ maxChunkChars: 8, chunkOverlapChars: 2 })
  const before = observationRows(readTrace(store)).length
  assert.equal(before, 0, '前置：链刚起来时不应已有 observation 行（否则"增量"不可归因）')

  const out = ctx.get('mana-perception').perceive({
    content: '0123456789ABCDEFGHIJ', // 20 字
    sessionId: 'sess-p1',
    turnId: 1,
    requestId: 'req-p1',
    source: 'user-message',
  })
  await settle(300)

  // 闭式锚点（与 P2 同源）：max=8 / overlap=2 ⇒ step=6 ⇒ i=0,6,12 → 3 块
  assert.equal(out, 3, 'perceive 返回的块数应与闭式锚点一致')

  const rows = observationRows(readTrace(store))
  assert.equal(rows.length, 3, '3 块必须落 3 行 observation —— 逐块发事件，不是把原文塞进一条')
  const got = rows.map((r) => JSON.parse(r.payload))
  assert.deepEqual(
    got.map((p) => p.content),
    ['01234567', '6789ABCD', 'CDEFGHIJ'],
    '每行的 content 必须是**闭式锚点**的那一块（逐字，含 overlap 复用）',
  )
  assert.deepEqual(
    got.map((p) => p.requestId),
    ['req-p1#1', 'req-p1#2', 'req-p1#3'],
    '多块必须派生可分辨的 requestId（共用同一 id ⇒ 审计上分不出是哪一块）',
  )
  for (const p of got) {
    assert.equal(p.sessionId, 'sess-p1')
    assert.equal(p.turnId, 1)
    assert.equal(p.source, 'user-message')
    assert.equal(typeof p.at, 'string')
    assert.ok(!Number.isNaN(Date.parse(p.at)), 'at 必须是可解析的时间戳')
  }
  // seq 连续无洞（A1-1 原文口径；本链只此三包在写）
  const seqs = readTrace(store).map((r) => r.seq)
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), `seq 有洞：${JSON.stringify(seqs)}`)
})

test('P2 ①配置面：maxChunkChars 真生效（声明了却不产生可观测差异 = 死开关）', async () => {
  const { ctx, store } = await bootChain({ maxChunkChars: 4, chunkOverlapChars: 0 })
  const n = ctx.get('mana-perception').perceive({
    content: '0123456789', sessionId: 'sess-p2', turnId: 1, requestId: 'r2',
  })
  await settle(250)
  assert.equal(n, 3, 'max=4/overlap=0 ⇒ step=4 ⇒ 3 块')
  assert.deepEqual(
    observationRows(readTrace(store)).map((r) => JSON.parse(r.payload).content),
    ['0123', '4567', '89'],
    '配置真进到分块里（否则"配置项"只是装饰）',
  )
  // 对照：同一条输入在**缺省**配置（1200）下只发 1 条 ⇒ 配置确有可观测差异
  const { ctx: ctx2, store: store2 } = await bootChain()
  const n2 = ctx2.get('mana-perception').perceive({
    content: '0123456789', sessionId: 'sess-p2b', turnId: 1, requestId: 'r2b',
  })
  await settle(250)
  assert.equal(n2, 1, '缺省 1200 下 10 字不切')
  assert.equal(observationRows(readTrace(store2)).length, 1)
})

// ── ② chunkText 闭式锚点（纯函数，逐字复现）──────────────────────────────────
test('P3 ②chunkText 闭式锚点：空串/单字/恰满/超一/超长/多段，边界逐字复现', () => {
  // 不进切分的四类边界：`maxChunkChars <= 0` 或 `src.length <= maxChunkChars`
  assert.deepEqual(chunkText('', 8, 2), { chunks: [''], split: false }, '空串 ⇒ 一块空串（不是零块）')
  assert.deepEqual(chunkText('a', 8, 2), { chunks: ['a'], split: false }, '单字 ⇒ 原样一块')
  assert.deepEqual(chunkText('a', 1, 0), { chunks: ['a'], split: false }, '单字恰满容量 ⇒ 不切')
  assert.deepEqual(
    chunkText('01234567', 8, 2),
    { chunks: ['01234567'], split: false },
    '长度 == max 是**闭区间上界**：不切（边界挪 1 就红）',
  )
  assert.deepEqual(chunkText('x'.repeat(9), 0, 0), { chunks: ['x'.repeat(9)], split: false }, 'max<=0 ⇒ 恒不切')
  assert.deepEqual(chunkText(null, 8, 2), { chunks: [''], split: false }, 'null 归一为空串（不得抛）')

  // 超一个字符即切：闭式 = ['01234567', '678']
  assert.deepEqual(
    chunkText('012345678', 8, 2),
    { chunks: ['01234567', '678'], split: true },
    '长度 == max+1 ⇒ 切两块，第二块 = overlap 尾巴 + 新字',
  )

  // 多段固定夹具（与 P1 同源，三处共用同一闭式）
  assert.deepEqual(
    chunkText('0123456789ABCDEFGHIJ', 8, 2),
    { chunks: ['01234567', '6789ABCD', 'CDEFGHIJ'], split: true },
  )
  assert.deepEqual(
    chunkText('0123456789ABCDEFGHIJ', 8, 0),
    { chunks: ['01234567', '89ABCDEF', 'GHIJ'], split: true },
    'overlap=0 ⇒ step=max（尾块可短于 max）',
  )
  assert.deepEqual(
    chunkText('0123456789ABCDEFGHIJ', 7, 0),
    { chunks: ['0123456', '789ABCD', 'EFGHIJ'], split: true },
    'max 挪 1 ⇒ 全部边界跟着挪 1（本条的负向对拍靶）',
  )

  // 超长：5000/1200/120 ⇒ step=1080；闭式块数与首尾长度
  const long = chunkText('a'.repeat(5000), 1200, 120)
  assert.equal(long.split, true)
  assert.equal(long.chunks.length, 5, '5000/1200/120 ⇒ 5 块')
  assert.deepEqual(long.chunks.map((c) => c.length), [1200, 1200, 1200, 1200, 680])
  assert.equal(long.chunks.every((c) => c.length <= 1200), true, '每块不得超 max')
  // 覆盖完备：最后一块的**新**内容必须抵达源末尾
  assert.equal(long.chunks[long.chunks.length - 1].endsWith('a'), true)
  const covered = long.chunks[long.chunks.length - 1]
  assert.equal(covered.length > 0, true)

  // 死循环防线：overlap >= max 必须被夹到 [0, max-1]（否则 index 不前进 ⇒ 静默挂死）
  const clamped = chunkText('y'.repeat(50), 10, 99)
  assert.equal(clamped.chunks.length, 41, 'overlap 夹到 9 ⇒ step=1 ⇒ 41 块（有限，不是挂死）')
  // 50/10/overlap<0 ⇒ 夹到 0 ⇒ step=10；i=0,10,20,30,40 五块各满 10 字，i=40 处触 break ⇒ **5 块**
  assert.deepEqual(chunkText('y'.repeat(50), 10, -5).chunks.map((c) => c.length), [10, 10, 10, 10, 10], 'overlap<0 夹到 0 ⇒ step=10 ⇒ 5 块满长')
})

// ── ③ 五类之一的可达性（与 A1-1 同口径，本包自证）────────────────────────────
test('P4 ③observation 类真在 mana_trace 上出现，且类名取自 MANA_STAGES（不手写第三套）', async () => {
  const { ctx, store } = await bootChain()
  ctx.get('mana-perception').perceive({
    content: '本包自证：observation 这一类必须真的可达', sessionId: 'sess-p4', turnId: 3, requestId: 'r4',
  })
  await settle(250)

  // 真源本身没被改动（若有人把五类删成三类，这里先红 —— 而不是报一个看不出原因的缺失）
  assert.deepEqual(
    [...MANA_STAGES],
    ['observation', 'attention', 'decision', 'recall', 'injection'],
    'MANA_STAGES 是 A1-1 五类标签的唯一真源，被改动即判红',
  )
  const rows = readTrace(store)
  const types = [...new Set(rows.map((r) => r.event_type))]
  assert.ok(
    types.includes(MANA_STAGES[0]),
    `本包未能让「${MANA_STAGES[0]}」类出现在 mana_trace 上：实有=${JSON.stringify(types)}`,
  )
  // 每一行的 event_type 都必须落在五类内（越界标签 = 绕过 A1-1 的口子）
  const outside = types.filter((t) => !MANA_STAGES.includes(t))
  assert.deepEqual(outside, [], `mana_trace 出现五类之外的标签：${JSON.stringify(outside)}`)
  // 本包的会话行里必须真有它
  const own = rows.filter((r) => r.session_id === 'sess-p4')
  assert.ok(own.some((r) => r.event_type === MANA_STAGES[0]), '本会话内必须有 observation 行（不是别的插件写的）')
})

// ── ④ 形态面：注册点、事件名、不越界写库 ────────────────────────────────────
test('P5 ④形态：ctx.effect 注册 1 点、agent/pre-step 直通 1 条且真调 next()、事件名在契约内', () => {
  const effects = []
  const provides = new Map()
  const listeners = []
  const emitted = []
  const traceWrites = []
  const fakeCore = { plugin: 'mana-core', writeTrace: (e) => { traceWrites.push(e); return 1 } }
  const ctx = {
    get: (n) => (n === 'mana-core' ? fakeCore : undefined),
    on: (evt, fn) => listeners.push({ evt, fn }),
    effect: (fn, desc) => { effects.push(desc); return fn() },
    provide: (n, s) => { provides.set(n, s); return () => provides.delete(n) },
    emit: (n, p) => emitted.push({ n, p }),
  }
  mod.apply(ctx, { maxChunkChars: 8, chunkOverlapChars: 2 })

  assert.equal(effects.length, 1, '只应有 1 个 effect 注册点（服务装配）；多出来的注册点会随卸载留下残留')
  assert.ok(provides.has('mana-perception'), '必须 provide mana-perception（未 provide = 没跑起来）')
  assert.deepEqual(mod.inject, ['mana-core'])

  const preSteps = listeners.filter((l) => l.evt === 'agent/pre-step')
  assert.equal(preSteps.length, 1, 'agent/pre-step 直通监听器应恰好 1 条')
  // G9：不调 next() 会静默掐死下游（shoucang 热注入 / MCL 慢通道）
  const sentinel = { kind: 'enter', messages: ['下游'] }
  return Promise.resolve(preSteps[0].fn({}, async () => sentinel)).then((ret) => {
    assert.equal(ret, sentinel, '直通监听器必须原样返回 next() 的结果（漏调 next = 静默掐死下游）')
    assert.equal(listeners.length, 1, '本包除 pre-step 外不应注册其它事件监听器')

    const svc = provides.get('mana-perception')
    /**
     * ⚠ **status() 的形状已扩展**（v10 §12.3 信号词预筛落地）：新增 `filterEnabled` 与 `tableName`。
     *   本条断言原为 `deepEqual({plugin, wired})` ⇒ 扩展后**按设计变红** —— 那是判据正确报告
     *   「形态变了」（本仓明令：多一条行为而没人交代即红），**不是**缺陷。
     *   ⇒ 修法**不是**删字段凑旧值，而是**把新字段一并钉住**（否则下次删掉它们不会有任何判据响）。
     *   ⚠ 这里用**显式键值逐条断言**而不是再写一份 deepEqual 字面量：后者每逢加字段都要人肉同步
     *   （本席在同批的 `a15-anchor` 上刚踩过"写死数字"的坑）。
     */
    const st = svc.status()
    assert.equal(st.plugin, 'mana-perception')
    assert.equal(st.wired, true)
    /**
     * ⚠ 本用例传的是**裸对象**（`{maxChunkChars, chunkOverlapChars}`）⇒ **schemastery 的缺省不生效**
     *   ⇒ `config.signalFilterEnabled` 为 `undefined`。这是**真实的边界**（真宿主经 schema 装配时
     *   才会填 false），本断言如实钉住它：
     *   · `undefined` **不是** true ⇒ 生产路径上"没配该键"等于**不筛**（行为面正确）；
     *   · 但它**不是**显式 false ⇒ status() 必须如实回报 `undefined` 而不是替它编一个 false。
     *   ⇒ 断言"非 true"（行为正确性）**且**"与 config 同源"（读数诚实性），而不是写死某个值。
     */
    assert.notEqual(st.filterEnabled, true, '裸 config 下不得视为"开"（undefined 不是 true ⇒ 不筛）')
    assert.equal(st.filterEnabled, undefined, '读数必须如实反映传入配置（不得替调用方编一个缺省值）')
    assert.equal(st.tableName, 'builtin', '未注入领域词 ⇒ 表名必须是内置表（"用的哪张表"可查）')
    assert.ok(
      Object.keys(st).length === 4,
      'status() 的键集合变了就必须在此交代（实测键=' + JSON.stringify(Object.keys(st)) + '）',
    )

    const n = svc.perceive({ content: '0123456789ABCDEFGHIJ', sessionId: 's', turnId: 1, requestId: 'r' })
    assert.equal(n, 3)
    // 事件名：必须正好是契约里的 mana/observation（八名之一），且每条都带 ManaObservation 的信封字段
    const CONTRACT_EVENTS = [
      'mana/observation', 'mana/attention', 'mana/decision', 'mana/recall', 'mana/injection',
      'mana/jev/judge', 'mana/jev/judged', 'mana/plugin/inactive',
    ]
    assert.deepEqual([...new Set(emitted.map((e) => e.n))], ['mana/observation'], '源头只应 emit mana/observation')
    for (const e of emitted) {
      assert.ok(CONTRACT_EVENTS.includes(e.n), `事件名越出契约：${e.n}`)
      assert.equal(typeof e.p.content, 'string')
      assert.equal(e.p.sessionId, 's')
      assert.equal(e.p.turnId, 1)
      assert.equal(typeof e.p.at, 'string')
    }
    // 源头包**不直接写库**：observation 行由 attention 写（见 bootChain 注释）
    assert.deepEqual(traceWrites, [], 'perception 不得自己写 mana_trace（写入点归 attention，双写会让 A1-1 数重）')
  })
})

// ── 反证：卸载即净（R 形态在本包上同样成立）─────────────────────────────────
test('P6 反证：卸载 perception 后服务不可读，且同一触发不再产生新 observation 行', async () => {
  const { ctx, store } = await bootChain()
  ctx.get('mana-perception').perceive({ content: 'before', sessionId: 's6', turnId: 1, requestId: 'r6' })
  await settle(250)
  const beforeRows = observationRows(readTrace(store)).length
  assert.equal(beforeRows, 1)

  const target = [...ctx.loader.entries()].find((e) => String(e.options?.name ?? '').includes('perception'))
  assert.ok(target, '应能按包名找到 perception 条目')
  ctx.loader.remove(target.id)
  await settle(300)

  assert.equal(ctx.get('mana-perception'), undefined, '卸载后服务必须不可读（残留 = 卸载不净）')
  const afterUnload = observationRows(readTrace(store)).length
  await settle(200)
  assert.equal(observationRows(readTrace(store)).length, afterUnload, '卸载后不得再产生新 observation 行')
  // 正向对照：证明"没新行"是卸载所致，不是整条链死掉
  assert.ok(ctx.get('mana-attention'), 'attention 仍在（对照）')
})
