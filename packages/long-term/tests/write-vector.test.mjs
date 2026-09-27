/**
 * v10 §12.1 第 ⑤ 步「向量化（vector）」判据 —— 证明 `memory_items.vector` **首次有生产写者**。
 *
 * ── 为什么这条判据必须存在（本席 2026-09-27 亲跑取证的原文）───────────────────────
 *   · `memory_items` **有 vector 列**（PRAGMA 实测在册）；
 *   · `vector` 包提供 `putMemoryVector`（packages/vector/src/index.ts:184/440）；
 *   · 而**全仓生产侧零调用方**（`grep putMemoryVector` 只命中 4 处**测试**）⇒ 库里所有行
 *     `vector` 恒为 NULL ⇒ 召回恒走降级：
 *     `"候选常驻向量全未命中（1/1 条）：k1(memory_items.vector 为 NULL（该行尚未嵌入）)"`；
 *   · 而**嵌入通道本身完全正常**（`embedOne` ⇒ `degraded:false` + 1024 维）。
 * ⇒ 修法**不是**再写一份向量化逻辑（那会长出第二个真源：编码器/维度契约/落库点各会漂），
 *   而是把落库路径**接到** vector 包既有的唯一写库点上。
 *
 * ── 本判据判什么（**不判"代码里有调用"**）──────────────────────────────────────
 *   只判**真装配 + 真写入之后，库里那一列到底有没有值** —— 即 `SELECT length(vector)`。
 *   ⚠ 这是刻意的「夹具绿 ≠ 真数据绿」取法：接口成功（`vectorWritten=true`）**不算**抵达，
 *     必须以**库读数**取证（`length(vector) = dim×4 = 4096`），并**回解**该 BLOB 证明它是
 *     合法的 1024 维 Float32 向量而不是一段恰好 4096 字节的垃圾。
 *
 * ── 两个方向都判（只判一个方向会漏掉最坏的那种）────────────────────────────────
 *   · **正向**：装配 vector + 上游正常 ⇒ 库里 `length(vector)=4096`，且能解码回我们的嵌入；
 *   · **反向（四种，逐态具名）**：
 *       关掉本步 / 向量腿缺席 / 嵌入调用失败 / 写入失败
 *     ⇒ **落库照常成功**（行在、content 在）、`vector` 为 NULL，且 `vectorSkip` + `vectorReason`
 *       逐态点名真因 —— 使「列是空的」与「这一步没跑」**可分辨**（本仓头号形态）。
 *   · 另有**"没跑"与"跑了跳过"**的第五态：被预过滤/过短挡下时 `vectorSkip===null`（如实表示没跑）。
 *
 * ⚠ 嵌入端点本判据**不打网络**：正向/失败腿用 `globalThis.fetch` 桩（vector 包的 `embed`
 *   用全局 fetch，且不暴露 fetchImpl 到 Config）。**真端点**（本机 Ollama bge-m3）的端到端
 *   读数由外部一次性探针给出，见本卡交付说明 —— 夹具绿不充当真数据绿。
 *
 * 运行：`node --test packages/long-term/tests/write-vector.test.mjs`
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)

/** ⚠ 必须用仓内导出的 `coreSink`（与 summarize.test.mjs 同因：自造桩会漂，漂开表现为崩或假绿）。 */
const { coreSink } = await load('long-term')
const { decodeVector } = await import(new URL('vector/src/vec-blob.ts', ROOT).href)
const wgMod = await import(new URL('long-term/src/write-gate.ts', ROOT).href)

const EXPECTED_CASES = 11
const DIM = 1024
const BYTES = DIM * 4
let ran = 0

const cleanups = []
after(() => {
  globalThis.fetch = realFetch
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const realFetch = globalThis.fetch
/** 桩住**网络边**（只桩 fetch，不桩 vector 包的任何函数）。 */
function stubFetch(impl) {
  globalThis.fetch = impl
}
const restoreFetch = () => {
  globalThis.fetch = realFetch
}

/** 正常嵌入端点桩：返回 DIM 维、取值可辨识的向量（证明"库里那段就是我们嵌的"）。 */
const EMB_VALUE = 0.25
const okFetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'))
  const n = Array.isArray(body.input) ? body.input.length : 0
  return new Response(
    JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: new Array(DIM).fill(EMB_VALUE) })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/**
 * 真装配：core ⇒（可选）vector ⇒ long-term。
 * ⚠ 装 vector 时**显式给配置**（embedEnabled 缺省 true；端点缺省指向本机 Ollama）——
 *   正/负两条腿各自覆盖它，避免"碰巧连上了本机 Ollama"这种不可复现的假绿。
 */
async function boot({ vector = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-wv-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)
  if (vector !== null) {
    ctx.plugin(await load('vector'), vector)
    await settle(200)
  }
  ctx.plugin(await load('long-term'), {})
  await settle(250)
  const core = ctx.get('mana-core')
  assert.ok(core, '夹具必须真装起 mana-core（否则下面全是空跑）')
  return { ctx, store, core }
}

const obsOf = (content, i = 1) => ({
  sessionId: 's-wv',
  turnId: i,
  requestId: 'r-wv-' + String(i),
  at: new Date().toISOString(),
  content,
  source: 'test',
})

/**
 * 直接调服务面 `writeGate`（与 `mana/observation` 监听器**同一条** runGate），写面用生产同款 coreSink。
 * ⚠ `prefilterEnabled:false`：本判据测的是**向量步**，短文本会被信号词预过滤挡下（那是另一件事，
 *   见 write-gate.test.mjs 与下面的 ⑩）⇒ 显式关掉，使读数只反映本步。
 */
async function writeOne(b, content, i = 1, overrides = {}) {
  const lt = b.ctx.get('mana-long-term')
  return lt.writeGate(b.core.db, coreSink(b.core), obsOf(content, i), { prefilterEnabled: false, ...overrides })
}

/** 独立只读连接读库（**不复用插件句柄**：卸载即净会关掉它的句柄）。 */
function readRow(store, id) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db.prepare('SELECT id, content, summary, length(vector) AS bytes, vector FROM memory_items WHERE id = ?').get(id)
  } finally {
    db.close()
  }
}

// ══ ① 实现面逐名在册（反「实现被挖空」）═══════════════════════════════════════
test('① 实现面：IMPLEMENTED_WRITE_GATE_EXPORTS 逐名真导出，且第 ⑤ 步的符号在册', async () => {
  ran += 1
  const lt = await load('long-term')
  for (const n of lt.IMPLEMENTED_WRITE_GATE_EXPORTS) {
    assert.notEqual(lt[n], undefined, `清单里的 ${n} 必须真导出（清单写了个不存在的东西 ⇒ 清单失去意义）`)
  }
  for (const n of ['vectorizeMemory', 'resolveVectorLegs', 'vectorizeSkipReason', 'VECTOR_WRITE_SKIPS', 'VECTOR_SERVICE']) {
    assert.notEqual(lt[n], undefined, `第 ⑤ 步的 ${n} 必须登记在实现面清单里（被搬走/改名即红）`)
  }
  assert.deepEqual([...lt.VECTOR_WRITE_SKIPS], [...wgMod.VECTOR_WRITE_SKIPS], '跳过枚举必须与实现同源')
  assert.equal(lt.VECTOR_SERVICE, 'mana-vector', '服务名必须与 vector 包 apply 注册名同值')
})

// ══ ② 正向：向量**真落进库**（4096 字节 + 可解码回嵌入）════════════════════════
test('② 正向：装配 vector + 上游正常 ⇒ 库里 length(vector)=4096 且能解码回 1024 维', async () => {
  ran += 1
  stubFetch(okFetch)
  try {
    const b = await boot({ vector: { embedBaseUrl: 'http://127.0.0.1:9/v1' } }) // 端点故意写死：本腿只信桩
    const out = await writeOne(b, '这条观察值得长期记住吗：向量化这一步必须真落库')
    assert.equal(out.wroteRow, true, '必须真落库；实测=' + JSON.stringify(out))
    assert.equal(out.vectorWritten, true, 'vectorWritten 必须为 true；实测 skip=' + String(out.vectorSkip) + ' reason=' + String(out.vectorReason))
    assert.equal(out.vectorDim, DIM, '读数所指维度必须是 ' + DIM)
    assert.equal(out.vectorBytes, BYTES, '读数所指字节数必须是 ' + BYTES)
    assert.equal(out.vectorSkip, null, '写成了就不得再带跳过归类')
    assert.equal(out.vectorReason, null, '写成了就不得再带跳过原因')

    const row = readRow(b.store, out.memoryId)
    assert.ok(row, '库里必须查到该行')
    assert.equal(row.bytes, BYTES, '库里 length(vector) 必须等于 dim×4=' + BYTES + '；实测=' + String(row.bytes))
    const dec = decodeVector(row.vector, DIM)
    assert.equal(dec.ok, true, '库里那段必须是可解码的 Float32 向量：' + JSON.stringify(dec))
    assert.equal(dec.vec.length, DIM, '解码后的维度必须是 ' + DIM)
    assert.equal(dec.vec[0], EMB_VALUE, '解码后首元素必须等于上游给的嵌入值（证明这段就是我们嵌的，不是凑字节数）')

    // 既有落库语义**未被本批改变**：
    // ⚠ 不做"恒等于 written"的断言 —— 本夹具**没装判定链** ⇒ 既有 fail-open 口径本来就会给
    //   `degraded_written`（那是 W1-3 的既有行为，不是本批引入的）。本批要证的是"加不加本步，
    //   既有读数不变"，故与**同一夹具里关掉本步的第二次写入**逐字段对拍 —— 这比断言一个
    //   写死的 state 更强，且不受既有 fail-open 口径变化的影响。
    assert.ok(['written', 'degraded_written'].includes(out.state), '必须真写出了一行；实测 state=' + out.state)
    assert.equal(out.summaryWritten, false, '未装 llm ⇒ 摘要步如实为 false（既有读数含义不变）')
    assert.equal(out.summarySkip, 'no-channel', '摘要跳过归类不变；实测=' + String(out.summarySkip))

    const off = await writeOne(b, '这条观察值得长期记住吗：向量化这一步必须真落库', 99, { vectorizeEnabled: false })
    assert.equal(off.vectorSkip, 'disabled', '对照组必须真的没跑本步；实测=' + String(off.vectorSkip))
    for (const k of ['state', 'value', 'probability', 'degraded', 'failureKind', 'wroteRow', 'summarySkip', 'summaryWritten', 'overwroteLiveRow']) {
      assert.deepEqual(out[k], off[k], `既有读数 ${k} 不得因本步开关而变（实测 ${JSON.stringify(out[k])} vs ${JSON.stringify(off[k])}）`)
    }
  } finally {
    restoreFetch()
  }
})

// ══ ③ 反向对照：关掉本步 ⇒ 具名 disabled + 库里 NULL + **行仍在** ═════════════
test('③ 反向对照：vectorizeEnabled=false ⇒ skip=disabled、库里 NULL，且**照常落库**', async () => {
  ran += 1
  stubFetch(okFetch)
  try {
    const b = await boot({ vector: {} })
    const out = await writeOne(b, '这条观察值得长期记住吗：关掉向量化步时', 2, { vectorizeEnabled: false })
    assert.equal(out.wroteRow, true, '**关掉本步也必须照常落库**（不得因少个派生优化而丢数据）')
    assert.equal(out.vectorWritten, false, '未生成时必须如实为 false')
    assert.equal(out.vectorSkip, 'disabled', '必须点名 disabled；实测=' + String(out.vectorSkip))
    assert.ok(String(out.vectorReason).length > 0, '必须带非空 reason')
    assert.ok(String(out.vectorReason).includes('vectorizeEnabled=false'), 'reason 必须点名那个开关；实测=' + String(out.vectorReason))
    const row = readRow(b.store, out.memoryId)
    assert.ok(row, '库里必须仍有该行（落库未被本步影响）')
    assert.equal(row.bytes, null, '库里 vector 必须为 NULL；实测=' + String(row.bytes))
  } finally {
    restoreFetch()
  }
})

// ══ ④ 缺腿：没装 vector ⇒ no-service（**不是**"嵌入了但失败"）═════════════════
test('④ 缺腿：未装配 mana-vector ⇒ skip=no-service，落库仍成功且 NULL', async () => {
  ran += 1
  const b = await boot({ vector: null })
  const out = await writeOne(b, '这条观察值得长期记住吗：向量腿没装时', 3)
  assert.equal(out.wroteRow, true, '缺腿时仍须落库（否则本步会把"少个优化"变成"丢数据"）')
  assert.equal(out.vectorWritten, false)
  assert.equal(out.vectorSkip, 'no-service', '实测=' + String(out.vectorSkip))
  assert.ok(String(out.vectorReason).includes('mana-vector'), 'reason 必须点名缺的是哪个服务；实测=' + String(out.vectorReason))
  assert.notEqual(out.vectorSkip, 'generate-failed', '"没装配"与"嵌入了但失败"不得同名（排查方向完全不同）')
  const row = readRow(b.store, out.memoryId)
  assert.ok(row, '库里必须仍有该行')
  assert.equal(row.bytes, null, '库里 vector 必须为 NULL')
})

// ══ ⑤ 桩掉嵌入（本卡点名的降级腿）：落库仍成功 + NULL + 原因具名 ══════════════
test('⑤ 嵌入调用抛错 ⇒ skip=generate-failed，**落库照常成功**、NULL、原因带真因', async () => {
  ran += 1
  stubFetch(async () => {
    throw new Error('桩：嵌入端点故意不可达')
  })
  try {
    const b = await boot({ vector: { embedBaseUrl: 'http://127.0.0.1:9/v1' } })
    const out = await writeOne(b, '这条观察值得长期记住吗：嵌入桩成失败时', 4)
    assert.equal(out.wroteRow, true, '★ 嵌入不可用**不得阻断落库**（与摘要步同口径）')
    assert.equal(out.vectorWritten, false, '未生成时必须如实为 false（不许把"没生成"报成"已生成"）')
    assert.equal(out.vectorSkip, 'generate-failed', '实测=' + String(out.vectorSkip))
    assert.ok(String(out.vectorReason).includes('嵌入调用失败'), 'reason 必须点名失败环节；实测=' + String(out.vectorReason))
    assert.ok(String(out.vectorReason).includes('桩：嵌入端点故意不可达'), 'reason 必须带上游真因；实测=' + String(out.vectorReason))
    const row = readRow(b.store, out.memoryId)
    assert.ok(row, '库里必须仍有该行')
    assert.equal(row.content, '这条观察值得长期记住吗：嵌入桩成失败时', 'content 必须完整落库（不被本步影响）')
    assert.equal(row.bytes, null, '库里 vector 必须为 NULL；实测=' + String(row.bytes))
  } finally {
    restoreFetch()
  }
})

// ══ ⑥ 真降级路径（不打桩）：端点不可达 ⇒ 上游自己的归类进入 reason ════════════
test('⑥ 端点不可达（真 fetch）⇒ skip=generate-failed 且 reason 带上游归类与端点', async () => {
  ran += 1
  const b = await boot({ vector: { embedBaseUrl: 'http://127.0.0.1:9/v1', embedTimeoutMs: 1500 } })
  const out = await writeOne(b, '这条观察值得长期记住吗：端点不可达时', 5)
  assert.equal(out.wroteRow, true, '端点不通也必须落库')
  assert.equal(out.vectorSkip, 'generate-failed', '实测=' + String(out.vectorSkip))
  assert.ok(String(out.vectorReason).includes('嵌入调用失败'), '实测=' + String(out.vectorReason))
  assert.ok(String(out.vectorReason).includes('http://127.0.0.1:9/v1'), 'reason 必须带上端点（否则"哪个端点不通"不可查）；实测=' + String(out.vectorReason))
  const row = readRow(b.store, out.memoryId)
  assert.equal(row.bytes, null, '库里 vector 必须为 NULL')
})

// ══ ⑦ 嵌入成功但**写库失败** ⇒ put-failed（与 generate-failed 不同名）═════════
test('⑦ 写库失败（单元腿注入）⇒ skip=put-failed，与 generate-failed 不得同名', async () => {
  ran += 1
  const legs = {
    embed: async () => ({ vectors: [new Float32Array(DIM).fill(0.5)], degraded: false, failureKind: null, reason: null, model: 'stub-model', baseUrl: 'http://stub/v1' }),
    put: async () => ({ written: false, reason: '维度 512 ≠ 配置 dim 1024' }),
    source: 'stub',
  }
  const r = await wgMod.vectorizeMemory(legs, 'mem-unit-1', '一段文本')
  assert.equal(r.ok, false, '写库失败不得报成成功')
  assert.equal(r.skip, 'put-failed', '实测=' + String(r.skip))
  assert.equal(r.dim, null, '未写成 ⇒ 维度必须为 null')
  assert.equal(r.bytes, null, '未写成 ⇒ 字节数必须为 null')
  assert.ok(String(r.reason).includes('写库失败'), '实测=' + String(r.reason))
  assert.ok(String(r.reason).includes('512'), 'reason 必须带上游真因；实测=' + String(r.reason))
  assert.notEqual(r.skip, 'generate-failed', '"写不进去"与"嵌不出来"是两件事，不得同名')

  // 反向：同一条腿 put 成功 ⇒ 必须 ok（否则上面那条可以被"永远失败"骗过）
  const good = { ...legs, put: async () => ({ written: true, reason: null }) }
  const g = await wgMod.vectorizeMemory(good, 'mem-unit-2', '一段文本')
  assert.equal(g.ok, true, 'put 成功时必须 ok（否则"永远 put-failed"也能骗过上面那条）')
  assert.equal(g.bytes, BYTES, '实测=' + String(g.bytes))
})

// ══ ⑧ 六态原因互不冒充（逐态非空 + 两两不同）═════════════════════════════════
test('⑧ 跳过原因唯一构造出口：六态逐态非空且两两不同（防"什么都报成一句"）', () => {
  ran += 1
  const reasons = wgMod.VECTOR_WRITE_SKIPS.map((s) =>
    wgMod.vectorizeSkipReason(s, { upstream: '上游原文', failureKind: 'unsupported-by-server', model: 'bge-m3', baseUrl: 'http://x/v1' }),
  )
  for (let i = 0; i < reasons.length; i += 1) {
    assert.ok(String(reasons[i]).length > 0, `${wgMod.VECTOR_WRITE_SKIPS[i]} 的原因不得为空`)
  }
  assert.equal(new Set(reasons).size, reasons.length, '六态原因必须两两不同；实测=' + JSON.stringify(reasons))
  const gf = wgMod.vectorizeSkipReason('generate-failed', { failureKind: 'unsupported-by-server', upstream: '端点说它不支持嵌入', model: 'm', baseUrl: 'http://x/v1' })
  assert.ok(gf.includes('unsupported-by-server'), '上游归类必须原样带出（否则"端点不通"与"服务端不支持"不可分辨）：' + gf)
})

// ══ ⑨ 中性方向：**没跑**与**跑了跳过**必须可分辨（⑩ 之前先钉住含义）════════════
test('⑨ 没有落库 ⇒ vectorSkip 保持 null（如实表示"这一步没跑"，不是"跑了被跳过"）', async () => {
  ran += 1
  const b = await boot({ vector: { embedBaseUrl: 'http://127.0.0.1:9/v1' } })
  // 写面不可用（write=false：只判不写）⇒ 没有行 ⇒ 本步不该跑，也不该留下"跳过"读数
  const out = await writeOne(b, '这条观察值得长期记住吗：只判不写时', 6, { write: false })
  assert.equal(out.state, 'unavailable', '实测=' + out.state)
  assert.equal(out.wroteRow, false, '本次不得写行')
  assert.equal(out.vectorWritten, false, '没有行 ⇒ 不得声称写了向量')
  assert.equal(out.vectorSkip, null, '★ 没有行时必须是 null（"没跑"），不得与"跑了但跳过"同形')
  assert.equal(out.vectorReason, null, '同上：没有跑就不得编一个原因')
})

// ══ ⑩ 被预过滤挡下 ⇒ 同样"没跑"（与 ⑨ 互补的第二条路径）═════════════════════
test('⑩ 被预过滤挡下（生产缺省开预过滤）⇒ 不落库、vectorSkip 仍为 null', async () => {
  ran += 1
  const b = await boot({ vector: {} })
  const out = await writeOne(b, 'xyzzy plugh frobnicate quux', 7, { prefilterEnabled: true })
  assert.equal(out.state, 'skipped_prefilter', '实测=' + out.state + ' overlap=' + String(out.prefilterOverlap))
  assert.equal(out.wroteRow, false, '未落库')
  assert.equal(out.vectorSkip, null, '★ 未进落库 ⇒ 本步没跑（null），不得留"跳过"读数')
  assert.equal(out.vectorWritten, false, '不得声称写了向量')
})

// ══ ⑪ 用例计数自检（防本文件被截断 / 空文件假绿）══════════════════════════════
test('⑪ 用例计数自检', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本文件声明 ${EXPECTED_CASES} 条用例，实跑 ${ran} 条`)
})
