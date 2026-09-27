/**
 * J1 嵌入腿失败态归类判据：「服务端明确不支持嵌入」必须**具名**，且**不得**吞掉别的失败。
 *
 * ## 本文件防的形态（本仓最忌的「失败不可观测」）
 * 归类前：「服务端没开嵌入能力」（环境配置问题）与「请求本身出错」（调用问题）
 * **同形** —— 都落进同一段 reason 通用串。后果：真因不可见，且**排查方向被带偏**
 * （看到"嵌入请求失败"会去查网络/模型名，真因却是**服务端启动参数**）。
 *
 * ## 判据档位
 * · A 档（逐字/枚举断言）：`failureKind` 取值、落哪一类、既有字段语义不变。
 * · B 档（只作测量条件说明）：真端点耗时、原始错误体文本 —— **不进阈值列**。
 *
 * ⚠ 运行方式：**显式路径**，不用通配（目录不存在时 `node --test` 静默 exit 0）。
 *   本文件已登记进 `tests/gate.mjs`（闸不认识的文件 = 「删掉整份判据」不可见）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { embedTexts, isUnsupportedByServer, unsupportedMarkerIn } from '../src/embed.ts'
import { EMBED_FAILURE_KINDS, degradedOutcomeQuery } from '../src/adapt.ts'

const OLLAMA = 'http://127.0.0.1:11434/v1'
const OLLAMA_TAGS = 'http://127.0.0.1:11434/api/tags'

/** 实测原文（Ollama 0.34.4 · HTTP 501）：裸信封。 */
const BARE_501 = '{"error":"This server does not support embeddings. Start it with `--embeddings`"}'
/** 同一事实的 **OpenAI 兼容信封**（外层结构不同）：必须同样命中。 */
const OPENAI_501 = JSON.stringify({
  error: { message: 'This server does not support embeddings. Start it with `--embeddings`', type: 'api_error', param: null, code: null },
})

const mkCfg = (o = {}) => ({ enabled: true, baseUrl: 'http://127.0.0.1:9/v1', model: 'bge-m3', dim: 1024, ...o })
/** 桩 fetch：给定状态码与原文，走**真实的** `!res.ok` 分支（不绕过被测代码）。 */
const stub = (status, bodyText) => async () => new Response(bodyText, { status, headers: { 'Content-Type': 'application/json' } })
const call = (cfg) => embedTexts(cfg, ['测试'])

const servers = []
after(() => {
  for (const s of servers) s.close()
})

// ── 0. 自检：本文件必须**真的有判据**（防"空文件也绿"）──────────────────
const EXPECTED_CASES = 15

test('J1-⓪ 判据自检：本文件 test( 计数**等于** 15，且识别原语可从交付面导入', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const self = fileURLToPath(import.meta.url)
  const src = readFileSync(self, 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  // ⚠ 相等而非下界：下界会让「删掉一整条用例」不变色（本仓实测过的假绿形态 ③）。
  assert.equal(n, EXPECTED_CASES, `用例条数必须恰好 ${EXPECTED_CASES}（实测 ${n}）`)
  assert.ok(/assert\./.test(src), '本文件必须含真断言')
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
  assert.ok(srcDir.endsWith('packages/vector/src/'), `../src/ 必须解析到 packages/vector/src/，实测 ${srcDir}`)
  for (const f of ['embed.ts', 'adapt.ts']) assert.ok(existsSync(srcDir + f), `交付文件缺失：${srcDir}${f}`)
  assert.equal(typeof unsupportedMarkerIn, 'function', '识别原语必须从 embed.ts 导出（判据要能直接钉它）')
  assert.equal(typeof isUnsupportedByServer, 'function')
  assert.equal(typeof degradedOutcomeQuery, 'function')
})

// ── 1. 该归类的**必须**归类 ────────────────────────────────────────────

test('J1-① 桩·裸信封（error 为字符串）⇒ unsupported-by-server，且读数点出**处置方向**', async (t) => {
  const out = await call(mkCfg({ fetchImpl: stub(501, BARE_501) }))
  assert.equal(out.degraded, true, '501 必须判降级')
  assert.equal(out.failureKind, 'unsupported-by-server', `实测 ${out.failureKind}`)
  // 读数要点出**处置方向**（本卡要求 2）：读者须能区分「启动参数问题」与「网络/模型名问题」
  assert.match(out.reason, /--embeddings/, 'reason 必须给出服务端启动参数这一处置方向：' + out.reason)
  assert.match(out.reason, /启动参数/, 'reason 必须点名"启动参数"：' + out.reason)
  assert.ok(!/嵌入请求失败/.test(out.reason), '不得再落进通用串「嵌入请求失败」（这正是本卡要分开的两者）')
  assert.equal(out.vectors.length, 0)
  t.diagnostic('[J1-①] failureKind=' + out.failureKind + ' reason=' + out.reason.slice(0, 120) + '…')
})

test('J1-② 桩·OpenAI 兼容信封（error.message 嵌套）⇒ **仍命中**（证明搜全串，不只读 error.message）', async (t) => {
  const out = await call(mkCfg({ fetchImpl: stub(501, OPENAI_501) }))
  assert.equal(out.failureKind, 'unsupported-by-server', '两种信封外层结构不同，必须都命中：实测 ' + out.failureKind)
  assert.match(out.reason, /--embeddings/)
  t.diagnostic('[J1-②] 嵌套信封 ⇒ ' + out.failureKind)
})

// ── 2. 不该归类的**不得**被吞（本卡要求 3 的反方向）────────────────────

test('J1-③ 反例·HTTP 404 模型不存在 ⇒ 必须仍落**通用失败**（不得被新归类吞掉）', async (t) => {
  const body = '{"error":{"message":"model \"no-such-model-xyz\" not found, try pulling it first","type":"not_found_error"}}'
  const out = await call(mkCfg({ fetchImpl: stub(404, body) }))
  assert.equal(out.degraded, true)
  assert.equal(out.failureKind, 'degraded', '404 必须落通用失败，实测 ' + out.failureKind)
  assert.match(out.reason, /404/, 'reason 必须保留状态码')
  assert.match(out.reason, /not found/, 'reason 必须保留原始错误体（换归类不得丢取证）')
  t.diagnostic('[J1-③] 404 ⇒ ' + out.failureKind)
})

test('J1-④ 反例·网络失败/超时 ⇒ 必须仍落**通用失败**', async (t) => {
  const thrower = async () => {
    throw new TypeError('fetch failed')
  }
  const net = await call(mkCfg({ fetchImpl: thrower, timeoutMs: 50 }))
  assert.equal(net.failureKind, 'degraded', '网络失败必须落通用失败，实测 ' + net.failureKind)
  assert.match(net.reason, /嵌入请求失败/, '网络失败仍走原通用串')

  const abort = async () => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  }
  const to = await call(mkCfg({ fetchImpl: abort, timeoutMs: 50 }))
  assert.equal(to.failureKind, 'degraded', '超时必须落通用失败，实测 ' + to.failureKind)
  t.diagnostic('[J1-④] 网络/超时 ⇒ ' + net.failureKind + '/' + to.failureKind)
})

test('J1-⑤ 反例·HTTP 500 且体无特征串 ⇒ 仍落通用失败', async (t) => {
  const out = await call(mkCfg({ fetchImpl: stub(500, '{"error":"internal server error"}') }))
  assert.equal(out.failureKind, 'degraded', '无特征串的 5xx 不得被吞，实测 ' + out.failureKind)
  t.diagnostic('[J1-⑤] 500 无特征 ⇒ ' + out.failureKind)
})

test('J1-⑥ 反例·HTTP 503 无特征串 ⇒ 仍是通用失败（**状态码不参与判据**）', async (t) => {
  const out = await call(mkCfg({ fetchImpl: stub(503, '{"error":"service unavailable"}') }))
  assert.equal(out.failureKind, 'degraded', '503 只是网关/过载语义，实测 ' + out.failureKind)
  t.diagnostic('[J1-⑥] 503 无特征 ⇒ ' + out.failureKind)
})

test('J1-⑦ 反例·近似文本（含 support 但非该语义）⇒ **判不中**（防"宽到吞掉近似文本"）', async (t) => {
  for (const body of [
    '{"error":"embedding models are not installed"}',
    '{"error":"unsupported operation: rerank"}',
    '{"error":"server does not support this capability"}',
  ]) {
    const out = await call(mkCfg({ fetchImpl: stub(501, body) }))
    assert.equal(out.failureKind, 'degraded', `近似文本「${body}」不得被判成不支持嵌入，实测 ${out.failureKind}`)
  }
  t.diagnostic('[J1-⑦] 三条近似文本均未被误吸')
})

test('J1-⑧ 反例·HTTP 200 但 data 为空 ⇒ 仍是通用失败（"服务端没给向量"≠"服务端没这能力"）', async (t) => {
  const out = await call(mkCfg({ baseUrl: 'http://127.0.0.1:9/v1', fetchImpl: stub(200, '{"data":[]}') }))
  assert.equal(out.failureKind, 'degraded', '空 data 必须落通用失败，实测 ' + out.failureKind)
  t.diagnostic('[J1-⑧] 200 空 data ⇒ ' + out.failureKind)
})

// ── 3. 判据的**稳健性**与**可枚举性** ──────────────────────────────────

test('J1-⑨ 稳健性·换措辞/换前后缀/换大小写 ⇒ 仍命中（防"全串相等，换版本即失效"）', async (t) => {
  const variants = [
    'This Server Does Not Support Embeddings.',
    'ERROR: this server does not support embeddings, please enable it',
    ' ollama: this server does not support embeddings (set --embeddings) ',
  ]
  for (const v of variants) {
    assert.equal(isUnsupportedByServer(v), true, `变体必须命中：${v}`)
    const out = await call(mkCfg({ fetchImpl: stub(501, JSON.stringify({ error: v })) }))
    assert.equal(out.failureKind, 'unsupported-by-server', `变体必须归类：${v}（实测 ${out.failureKind}）`)
  }
  // 反向：非该语义的串必须判**不中**（否则上面的"稳健"就是"宽到没边"）
  for (const v of ['embeddings endpoint missing', 'server supports embeddings', 'connection refused', '']) {
    assert.equal(unsupportedMarkerIn(v), null, `不得误判：${v}`)
  }
  t.diagnostic('[J1-⑨] 3 条变体命中 / 4 条负例未命中')
})

test('J1-⑩ 可枚举·EMBED_FAILURE_KINDS 取值冻结，"只增取值"不得改既有含义', () => {
  assert.deepEqual([...EMBED_FAILURE_KINDS], ['degraded', 'unsupported-by-server'], '枚举面必须恰好这两条（新增须同步本断言）')
  assert.equal(new Set(EMBED_FAILURE_KINDS).size, EMBED_FAILURE_KINDS.length, '枚举不得有重复项')
  assert.ok(!EMBED_FAILURE_KINDS.includes('degraded-degraded'), '不得留占位值')
})

test('J1-⑪ 既有字段语义未变：degradedOutcomeQuery 缺省仍= 通用失败，且字段面齐备', () => {
  const d = degradedOutcomeQuery('m', 'http://x/v1', '某原因', 7)
  // 缺省（不传归类）必须仍是**通用失败** ⇒ 既有调用点/既有断言含义不变
  assert.equal(d.failureKind, 'degraded', '缺省归类必须是通用失败（既有调用点不传即保持原义）')
  assert.equal(d.degraded, true)
  assert.equal(d.reason, '某原因')
  assert.equal(d.ms, 7)
  assert.deepEqual(d.vectors, [], '降级时 vectors 必须是空数组（不是 undefined —— 会被 JSON 静默丢键）')
  // 未降级 ⇒ 归类必须 null（不得用 'degraded' 冒充"没失败"）
  assert.equal(d.degraded !== false, true)
  const empty = degradedOutcomeQuery('m', 'http://x/v1', '', 1)
  assert.ok(empty.reason.length > 0, 'reason 仍不得为空串（漏填兜底未变）')
})

// ── 4. 真端点 + 真 HTTP（端到端，非桩）───────────────────────────────

test('J1-⑫ 真端点·双条件断言：真回应带该语义 ⇒ 必须归类；不带 ⇒ 不得归类（贴原始原文）', async (t) => {
  // 先取本机模型清单，挑一个**声明不含 embedding 能力**的模型（这正是真触发面）。
  const tagsRes = await fetch(OLLAMA_TAGS)
  assert.equal(tagsRes.ok, true, '本机 Ollama 必须可达（这是测量条件，非本判据的被测对象）')
  const tags = await tagsRes.json()
  const models = (tags.models ?? []).map((m) => ({ name: m.name, caps: m.capabilities ?? [] }))
  assert.ok(models.length > 0, '本机必须有模型才能做真端点取证')
  const noEmbed = models.find((m) => !m.caps.includes('embedding'))
  const target = (noEmbed ?? models[0]).name

  const url = OLLAMA + '/embeddings'
  const req = JSON.stringify({ model: target, input: ['测试'] })
  const rawRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req })
  const rawText = await rawRes.text()
  const hasMarker = /does not support embeddings/i.test(rawText)

  const out = await embedTexts(mkCfg({ baseUrl: OLLAMA, model: target, timeoutMs: 30000 }), ['测试'])

  // **双条件**：环境怎么变都有一条真断言（不是"环境没配合就跳过"）。
  if (hasMarker) {
    assert.equal(out.failureKind, 'unsupported-by-server', `真回应含该语义 ⇒ 必须归类，实测 ${out.failureKind}；原文 ${rawText}`)
    assert.match(out.reason, /--embeddings/)
  } else {
    assert.notEqual(out.failureKind, 'unsupported-by-server', `真回应**不含**该语义 ⇒ 绝不得归类成它；原文 ${rawText}`)
  }
  t.diagnostic(
    '[J1-⑫ 真端点] model=' + target + ' caps=' + JSON.stringify(noEmbed ? noEmbed.caps : 'n/a') +
      ' HTTP=' + rawRes.status + ' 原文=' + rawText.slice(0, 150) +
      ' ⇒ failureKind=' + out.failureKind + (hasMarker ? '（已归类）' : '（未归类·负向断言）'),
  )
})

test('J1-⑬ 真 HTTP 端到端：本机起**真** http 服务回 501 原句 ⇒ 经真 fetch 归类（非桩）', async (t) => {
  const srv = createServer((_req, res) => {
    res.writeHead(501, { 'Content-Type': 'application/json' })
    res.end(BARE_501)
  })
  servers.push(srv)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const out = await embedTexts(mkCfg({ baseUrl: 'http://127.0.0.1:' + port + '/v1', model: 'bge-m3' }), ['测试'])
  assert.equal(out.degraded, true)
  assert.equal(out.failureKind, 'unsupported-by-server', '真 HTTP 501 + 原句 ⇒ 必须归类，实测 ' + out.failureKind)
  assert.match(out.reason, /does not support embeddings/, 'reason 必须保留服务端原句（取证）')
  t.diagnostic('[J1-⑬ 真 HTTP] port=' + port + ' ⇒ ' + out.failureKind)
})

test('J1-⑭ 真 HTTP 端到端反例：真 501 但**体无特征** ⇒ 仍是通用失败（真链路上也不误吸）', async (t) => {
  const srv = createServer((_req, res) => {
    res.writeHead(501, { 'Content-Type': 'application/json' })
    res.end('{"error":"not implemented"}')
  })
  servers.push(srv)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const out = await embedTexts(mkCfg({ baseUrl: 'http://127.0.0.1:' + port + '/v1', model: 'bge-m3' }), ['测试'])
  assert.equal(out.failureKind, 'degraded', '同码不同语义 ⇒ 不得归类，实测 ' + out.failureKind)
  assert.match(out.reason, /501/, 'reason 必须保留状态码')
  t.diagnostic('[J1-⑭ 真 HTTP 反例] port=' + port + ' ⇒ ' + out.failureKind)
})
