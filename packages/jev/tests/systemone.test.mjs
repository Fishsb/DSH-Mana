/**
 * dsh-mana-jev · B1.4 判据 —— **真 JEV 通道**（`/api/v1/systemone`）的形态映射面。
 *
 * ## 本文件的核心纪律：**零网络**（与 `framework.test.mjs` 同款）
 * 全部判定走**注入接缝** `fetchImpl` 桩；端点字面量不出现（交给 `gate.mjs` 静态腿）。
 * ⇒ 拔掉网线后本文件仍应全绿；真通道那一条腿在 `tests/live/`（不在本文件的零网络面里）。
 *
 * ## 为什么桩要**断言请求体内容**（M6，本轮最重要的一条判据缺口）
 * 实测：把请求体里的 question 掏空，**旧的 23 条桩判据全绿** —— 因为桩只验"调用发生了"，
 * 不验"发出去的东西对不对"。而"多问被静默压成单问"恰好落在那个盲区里。
 * ⇒ 本文件**每一条**都断言桩收到的 `body`：`model` / `state` / `questions` 三件齐、
 *   **题目个数**、每题的 `type`/`instructions`（choice 还要 `criteria`）、`state` 是否原样。
 *
 * ## 形态映射的四条决策（判据逐条钉住）
 * ① `choice`/`score` **不是降级**：HTTP 200 + 答案完整 ⇒ `degraded:false`；
 *    但无 yes/no 语义 ⇒ `value:'unknown'`、`probability:null`（契约：不得默认 `'no'`、不得用 0 冒充）。
 * ② 真实取值**不丢**：落在适配层自己的 `answers`（`choice`/`probabilities`/`confidence`/`legend`）。
 * ③ **多问不压扁**：`answers` 全量保留；契约单值面只取 `primaryQuestion`；
 *    主问题缺失 ⇒ **显式降级**（不偷偷挑第一个键）；认不出的**次要**答案 ⇒ `unusableAnswers` 可枚举。
 * ④ 无凭据 ⇒ **不发请求** + 显式降级 `systemone-no-api-key`（不许静默 skip，也不许回落 Ollama）。
 *
 * ⚠ 本注释块内**不得出现**星号加斜杠的字符组合（本仓踩过一次：块注释提前终止）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after } from 'node:test'

const SYS = new URL('../src/systemone.ts', import.meta.url).href
const IDX = new URL('../src/index.ts', import.meta.url).href
const OLL = new URL('../src/ollama.ts', import.meta.url).href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const LIVE = new URL('./live/systemone-live.test.mjs', import.meta.url).href

const {
  judgeWithSystemone,
  normalizeAnswers,
  readApiKey,
  systemoneUrl,
  buildSystemoneBody,
  extractCost,
  extractServedModel,
  isNoulAnswer,
  SYSTEMONE_DEGRADED_REASONS,
  SYSTEMONE_ALLOWED_MODELS,
  SYSTEMONE_DEFAULT_ENDPOINT,
  SYSTEMONE_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_PATH,
  SYSTEMONE_DEFAULT_PRIMARY,
  SYSTEMONE_API_KEY_ENV,
  SYSTEMONE_CHANNEL,
  OLLAMA_CHANNEL,
  parseEnvFile,
  resolveSystemoneCredential,
  readEnvFileText,
  SYSTEMONE_ENV_FILE_VAR,
  SYSTEMONE_DEFAULT_ENV_FILE,
} = await import(SYS)
const { JEV_DEFAULT_MODEL, OLLAMA_DEFAULT_ENDPOINT } = await import(OLL)

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

// ── 夹具（全部离线）─────────────────────────────────────────────────────────

/** 主问题缺省键；判据不重复写死字面量。 */
const Q = SYSTEMONE_DEFAULT_PRIMARY

/** 真 JEV 的实测返回形状（**来自真调用**，不是编的）。 */
function noulReply(p, extra = {}) {
  return { model: 'typesafe/jev-1.13-20260917', answers: { [Q]: { type: 'noul', noul: p } }, ...extra }
}
function choiceReply(choice, probabilities, extra = {}) {
  return {
    model: 'typesafe/jev-1.13-20260917',
    answers: { [Q]: { type: 'choice', choice, probabilities, confidence: 1 } },
    ...extra,
  }
}

/** 计数桩：记录**完整请求**（url + headers + 解析后的 body），供请求体断言。 */
function makeStub(reply) {
  const calls = []
  return {
    calls,
    /** 最近一次请求体（没有调用则 null），断言用。 */
    lastBody: () => (calls.length ? calls[calls.length - 1].body : null),
    lastInit: () => (calls.length ? calls[calls.length - 1].init : null),
    fetchImpl: async (url, init) => {
      const raw = init?.body
      calls.push({ url: String(url), init, body: typeof raw === 'string' ? JSON.parse(raw) : raw })
      const r = typeof reply === 'function' ? reply(calls.length) : reply
      if (r instanceof Error) throw r
      return r
    },
  }
}

/**
 * 200 响应桩。
 *
 * ⚠ 两条通道的读法**不同**（这正是"形态不同"的一个侧面，实测踩过）：
 *   ollama 读 `res.json()`；systemone 读 `res.text()` 再自己 `JSON.parse`。
 * ⇒ 桩必须**同时**提供两者，否则会出现"某个通道因为桩不全而假装失败"的假红。
 */
function okResponse(obj) {
  const body = JSON.stringify(obj)
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: { get: () => null },
  }
}
function errResponse(status, obj) {
  const body = JSON.stringify(obj)
  return { ok: false, status, text: async () => body, json: async () => JSON.parse(body), headers: { get: () => null } }
}
function badJsonResponse(status, text) {
  return {
    ok: status < 400,
    status,
    text: async () => text,
    json: async () => {
      throw new Error('not json')
    },
    headers: { get: () => null },
  }
}

/** 临时库（schema 取自 core 的 `createSchema`；**绝不指向 $DSH_HOME**）。 */
async function tempDb() {
  const core = await import(CORE)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-sys-'))
  dirs.push(dir)
  const db = new DatabaseSync(join(dir, 'mana.db'))
  core.createSchema(db)
  const count = () => Number(db.prepare('SELECT count(*) c FROM jev_log').get().c)
  const all = () => db.prepare('SELECT result_value, probability, degraded, cost_usd FROM jev_log ORDER BY rowid').all()
  return { db, count, all, close: () => db.close() }
}

let idSeq = 0
const nextId = () => `sys-${++idSeq}`
/** 桩 key（**不是**真 key：真 key 只从环境变量读，永不进仓库）。 */
const STUB_KEY = 'stub-key-not-a-secret'

const judge = (over = {}) =>
  judgeWithSystemone({ state: 'S', question: 'Q', apiKey: STUB_KEY, idFactory: nextId, ...over })

// ── ① 单问：请求体三件齐 + 映射 ─────────────────────────────────────────────

test('S1-1 noul 单问：桩收到的 body 三件齐（model/state/questions）、题数=1、type/instructions 逐字；映射为 yes + 概率', async (t) => {
  const stub = makeStub(okResponse(noulReply(0.97)))
  const STATE = '系统崩了三天无法收款，紧急！'
  const out = await judge({ state: STATE, question: '是否紧急或时间敏感？', fetchImpl: stub.fetchImpl })

  // ── 请求体（M6：这是旧判据的盲区，必须逐字段断言）──
  assert.equal(stub.calls.length, 1, '必须恰好发一次请求')
  const body = stub.lastBody()
  assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state'], `请求体必须恰是 model/state/questions 三件：${Object.keys(body)}`)
  assert.equal(body.state, STATE, 'state 必须**原样**送达（截断/替换都不行）')
  assert.ok(SYSTEMONE_ALLOWED_MODELS.includes(body.model), `model 必须在服务端自报白名单内：${body.model}（白名单 ${SYSTEMONE_ALLOWED_MODELS.join('/')}）`)
  assert.deepEqual(Object.keys(body.questions), [Q], `question 键集合必须恰为 [${Q}]`)
  assert.equal(Object.keys(body.questions).length, 1, '题数必须为 1')
  assert.equal(body.questions[Q].type, 'noul')
  assert.equal(body.questions[Q].instructions, '是否紧急或时间敏感？', 'instructions 必须逐字送达（问句被掏空是实测过的假绿形态）')
  // 认证头：只写 Bearer 一种形态
  assert.equal(stub.lastInit().headers.authorization, `Bearer ${STUB_KEY}`, '认证头必须是 Authorization: Bearer <key>')

  // ── 响应映射 ──
  assert.equal(out.value, 'yes', 'noul=0.97 ≥ threshold 0.5 ⇒ yes')
  assert.equal(out.probability, 0.97, '概率必须逐字来自服务端（本通道不做任何 token 归一）')
  assert.equal(out.degraded, false)
  assert.equal(out.reason, null, '正常路径 reason 必须为 null')
  assert.equal(out.channel, SYSTEMONE_CHANNEL, 'channel 必须可枚举，标出真通道')
  assert.equal(out.servedModel, 'typesafe/jev-1.13-20260917', '服务端自报的模型名必须带出（与请求名互为反证）')
  assert.equal(out.primaryQuestion, Q)
  assert.ok(String(stub.calls[0].url).endsWith(SYSTEMONE_DEFAULT_PATH), `URL 必须落在 systemone 路径上：${stub.calls[0].url}`)
  t.diagnostic(`[S1-1] url=${stub.calls[0].url} value=${out.value} p=${out.probability}`)
})

test('S1-2 反向：noul=0.06 ⇒ no（阈值语义与旧通道一致）', async () => {
  const stub = makeStub(okResponse(noulReply(0.06)))
  const out = await judge({ fetchImpl: stub.fetchImpl })
  assert.equal(out.value, 'no')
  assert.equal(out.probability, 0.06)
  assert.equal(out.degraded, false)
})

// ── ② 多问不压扁（本轮 competence 核心）────────────────────────────────────

test('S1-3 **多问不压扁**：桩收到的 body 恰有 3 题且逐题 type/instructions/criteria 对上；返回 answers 三键全在', async (t) => {
  const QUESTIONS = {
    urgent: { type: 'noul', instructions: '是否紧急？' },
    kind: { type: 'choice', instructions: '归类', criteria: { bug: '报错崩溃', feature: '功能请求' } },
    weight: { type: 'score', instructions: '重要程度', criteria: ['低', '中', '高'] },
  }
  const reply = {
    model: 'typesafe/jev-1.13-20260917',
    answers: {
      urgent: { type: 'noul', noul: 0.94 },
      kind: { type: 'choice', choice: 'bug', probabilities: { feature: 0, bug: 1 }, confidence: 1 },
      weight: { type: 'score', score: 2, legend: { 0: '低', 1: '中', 2: '高' }, probabilities: { 0: 0, 1: 0, 2: 1 }, confidence: 1 },
    },
  }
  const stub = makeStub(okResponse(reply))
  const out = await judge({ questions: QUESTIONS, primaryQuestion: 'urgent', fetchImpl: stub.fetchImpl })

  // ── 请求体：题数与内容（"多问丢成单问"**必在此红**）──
  const body = stub.lastBody()
  assert.deepEqual(Object.keys(body.questions).sort(), ['kind', 'urgent', 'weight'], `题数必须为 3（实测 ${Object.keys(body.questions).length}）`)
  assert.deepEqual(body.questions.urgent, { type: 'noul', instructions: '是否紧急？' }, 'noul 题必须逐字送达')
  assert.deepEqual(
    body.questions.kind,
    { type: 'choice', instructions: '归类', criteria: { bug: '报错崩溃', feature: '功能请求' } },
    'choice 题必须带 criteria（**缺 criteria 服务端 400**）且逐字一致',
  )
  assert.deepEqual(
    body.questions.weight,
    { type: 'score', instructions: '重要程度', criteria: ['低', '中', '高'] },
    'score 题的 criteria 必须是**数组**（对象会 400，实测）',
  )

  // ── 响应：三问全在（不压扁的可断言证据）──
  assert.deepEqual(Object.keys(out.answers).sort(), ['kind', 'urgent', 'weight'], '答案键集合必须与问题键集合一一对应（**不许静默丢**）')
  assert.equal(isNoulAnswer(out.answers.urgent), true)
  assert.equal(out.answers.urgent.noul, 0.94)
  assert.equal(out.answers.kind.choice, 'bug', 'choice 的真实取值必须在（压扁成 yes/no 就是编造）')
  assert.equal(out.answers.weight.score, 2, 'score 的取值（索引）必须在')
  assert.deepEqual(out.answers.weight.legend, { 0: '低', 1: '中', 2: '高' }, 'legend 必须原样保留（否则 score=2 无法解释）')
  // 契约面只取主问题
  assert.equal(out.value, 'yes')
  assert.equal(out.probability, 0.94)
  assert.equal(out.primaryQuestion, 'urgent')
  t.diagnostic(`[S1-3] 3 题同调 → answers=${Object.keys(out.answers).join('|')}；契约面取 primary=urgent`)
})

test('S1-4 `question` 缺省合成：不给 questions 时用契约面的 question 合成一个 noul 问（映射：question → instructions）', async () => {
  const stub = makeStub(okResponse(noulReply(0.5)))
  await judge({ question: '这句话值得长期记住吗？', fetchImpl: stub.fetchImpl })
  const body = stub.lastBody()
  assert.deepEqual(body.questions, { [Q]: { type: 'noul', instructions: '这句话值得长期记住吗？' } })
})

// ── ③ choice / score 的映射决策（不是降级 + 取值不丢）────────────────────────

test('S1-5 choice：value=unknown + probability=null（不用 0 冒充）+ **degraded=false**（链路健康，不是降级）+ 取值在 answers', async () => {
  const { db, count, all, close } = await tempDb()
  try {
    const stub = makeStub(okResponse(choiceReply('bug', { feature: 0, bug: 1, question: 0 })))
    const out = await judge({ fetchImpl: stub.fetchImpl, db })
    assert.equal(out.value, 'unknown', 'choice 没有 yes/no 语义 ⇒ 必须 unknown（契约：不得默认成 no）')
    assert.equal(out.probability, null, '概率不可用 ⇒ null（契约：不得用 0 冒充）')
    assert.equal(out.degraded, false, 'HTTP 200 且答案完整 ⇒ **不是降级**（标成降级会稀释真降级）')
    assert.equal(out.reason, null, '非降级 ⇒ reason 必须为 null')
    assert.equal(out.answers[Q].type, 'choice')
    assert.equal(out.answers[Q].choice, 'bug', '真实取值不得丢')
    assert.deepEqual(out.answers[Q].probabilities, { feature: 0, bug: 1, question: 0 }, 'probabilities 必须逐项保留')
    assert.equal(out.answers[Q].confidence, 1)
    // 留痕：unknown 行必须落，且 degraded 与 value 各自可查
    assert.equal(count(), 1)
    const row = all()[0]
    assert.equal(row.result_value, 'unknown')
    assert.equal(row.probability, null, '库里概率列必须为 null（不是 0）')
    assert.equal(row.degraded, 0, 'choice 不是降级 ⇒ 库里 degraded=0')
    assert.equal(row.cost_usd, null, '桩里没给 usage.cost ⇒ null（不得写 0）')
  } finally {
    close()
  }
})

test('S1-6 score：同上（unknown/null/非降级），且 legend + 索引 score 都在', async () => {
  const reply = {
    model: 'typesafe/jev-1.13-20260917',
    answers: { [Q]: { type: 'score', score: 2, legend: { 0: '完全不重要', 1: '有点重要', 2: '极其重要' }, probabilities: { 0: 0, 1: 0, 2: 1 }, confidence: 1 } },
  }
  const out = await judge({ fetchImpl: makeStub(okResponse(reply)).fetchImpl })
  assert.equal(out.value, 'unknown')
  assert.equal(out.probability, null)
  assert.equal(out.degraded, false)
  assert.equal(out.answers[Q].score, 2)
  assert.equal(out.answers[Q].legend['2'], '极其重要', 'legend 必须能把索引翻回人话')
})

// ── ④ 多问的失败面：主问题缺失 / 次要答案认不出 ─────────────────────────────

test('S1-7 主问题缺失 ⇒ **显式降级**并列出可用键（**不偷偷挑第一个键**）', async () => {
  const reply = { model: 'x', answers: { other: { type: 'noul', noul: 0.9 } } }
  const out = await judge({ primaryQuestion: 'v', fetchImpl: makeStub(okResponse(reply)).fetchImpl })
  assert.equal(out.degraded, true, '主问题不在 answers 里 ⇒ 必须显式降级（静默挑第一个键是"看起来正常"的缺陷形态）')
  assert.ok(String(out.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.primaryMissing), `reason 前缀：${out.reason}`)
  assert.match(String(out.reason), /other/, 'reason 必须带可用键清单（便于定位配置错）')
  assert.equal(out.value, 'unknown')
  assert.equal(out.probability, null)
  assert.equal(out.answers.other.noul, 0.9, '拿不到主问题**不等于**要把其他答案丢掉')
})

test('S1-8 次要答案形状认不出 ⇒ 进 `unusableAnswers`（可枚举）+ 原样留 raw，不静默丢', async () => {
  const reply = {
    model: 'x',
    answers: { [Q]: { type: 'noul', noul: 0.8 }, weird: { type: 'future-type', payload: 42 } },
  }
  const out = await judge({ fetchImpl: makeStub(okResponse(reply)).fetchImpl })
  assert.equal(out.degraded, false, '主问题正常 ⇒ 不降级')
  assert.equal(out.value, 'yes')
  assert.deepEqual(out.unusableAnswers, ['weird'], '认不出的答案必须在可枚举清单里')
  const w = out.answers.weird
  assert.equal(w.unusableReason.includes('future-type'), true)
  assert.equal(JSON.stringify(w.raw), JSON.stringify({ type: 'future-type', payload: 42 }), 'raw 必须原样保留（服务端加新类型时不能靠猜）')
})

test('S1-9 `normalizeAnswers` 纯函数面：非对象 ⇒ 空；缺 type ⇒ 记 (missing)', async () => {
  assert.deepEqual(normalizeAnswers(null), { answers: {}, unusableKeys: [] })
  assert.deepEqual(normalizeAnswers('x'), { answers: {}, unusableKeys: [] })
  const r = normalizeAnswers({ a: { noul: 0.3 }, b: { type: 'noul', noul: 'NaN-ish' } })
  assert.equal(r.answers.a.unusableReason.includes('(missing)'), true)
  assert.deepEqual(r.unusableKeys, ['a', 'b'], 'type 缺失与 noul 非数值都必须进清单')
})

// ── ⑤ 凭据与故障面：每条都是**显式降级**（不许静默）────────────────────────

test('S1-10 无凭据 ⇒ **一次请求都不发** + 显式降级 systemone-no-api-key（不许静默 skip、不许回落 Ollama）', async () => {
  const stub = makeStub(okResponse(noulReply(0.99)))
  const out = await judge({ apiKey: undefined, apiKeyEnv: 'MANA_TEST_KEY_ABSENT', fetchImpl: stub.fetchImpl })
  assert.equal(stub.calls.length, 0, '无 key 时**不得**发请求（发出去才失败 = 泄露面 + 无谓计费）')
  assert.equal(out.degraded, true)
  assert.ok(String(out.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.noApiKey), `reason：${out.reason}`)
  assert.match(String(out.reason), /MANA_TEST_KEY_ABSENT/, 'reason 必须点出**哪个环境变量**没设')
  assert.equal(out.value, 'unknown')
  assert.equal(out.probability, null)
  assert.equal(out.channel, SYSTEMONE_CHANNEL, '降级也要标出通道（否则分不清是哪个通道坏了）')
})

test('S1-11 401 ⇒ httpError + reason 带服务端正文（实测形态：missing_api_key）', async () => {
  const stub = makeStub(errResponse(401, { error: { message: 'Invalid Authentication', code: 'missing_api_key' } }))
  const out = await judge({ fetchImpl: stub.fetchImpl })
  assert.equal(out.degraded, true)
  assert.ok(String(out.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.httpError))
  assert.match(String(out.reason), /status=401/)
  assert.match(String(out.reason), /missing_api_key/, '服务端正文必须带进 reason（否则 401 与 400 无法分辨）')
})

test('S1-12 400 错模型 ⇒ reason 带**服务端自报白名单**，且与本地常量逐项对账', async () => {
  const body = {
    error: {
      message: `Model must be one of: ${SYSTEMONE_ALLOWED_MODELS.join(', ')}.`,
      code: 'model_not_supported',
      param: 'model',
    },
  }
  const out = await judge({ model: 'no-such-model', fetchImpl: makeStub(errResponse(400, body)).fetchImpl })
  assert.equal(out.degraded, true)
  for (const m of SYSTEMONE_ALLOWED_MODELS) {
    assert.match(String(out.reason), new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `白名单项 ${m} 必须出现在 reason 里`)
  }
  assert.match(String(out.reason), /model_not_supported/)
})

test('S1-13 非 JSON 响应 / 网络异常 ⇒ 各自可枚举 reason，且**本函数不抛**', async () => {
  const a = await judge({ fetchImpl: makeStub(badJsonResponse(200, '<html>gateway</html>')).fetchImpl })
  assert.equal(a.degraded, true)
  assert.ok(String(a.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.invalidJson))
  assert.match(String(a.reason), /gateway/, '原文必须带出（否则"哪来的 HTML"无从查）')

  const b = await judge({ fetchImpl: makeStub(new Error('ECONNREFUSED 1.2.3.4:443')).fetchImpl })
  assert.equal(b.degraded, true)
  assert.ok(String(b.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.requestFailed))
  assert.match(String(b.reason), /ECONNREFUSED/)
  assert.equal(b.value, 'unknown')
})

test('S1-14 无 answers / noul 越界 ⇒ 各自显式降级（不得当成 0 或 no）', async () => {
  const a = await judge({ fetchImpl: makeStub(okResponse({ model: 'x' })).fetchImpl })
  assert.ok(String(a.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.noAnswers))
  const b = await judge({ fetchImpl: makeStub(okResponse(noulReply(1.7))).fetchImpl })
  assert.ok(String(b.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.invalidProbability))
  assert.equal(b.probability, null, '越界概率不得被当成 1 用')
})

// ── ⑥ 留痕守恒（A1-14 / G8）────────────────────────────────────────────────

test('S1-15 落痕守恒：6 条路径各落一行、降级行 degraded=1、cost_usd 落真实成本（拿不到则 null）', async (t) => {
  const { db, count, all, close } = await tempDb()
  try {
    const paths = [
      ['正常', makeStub(okResponse(noulReply(0.9, { usage: { cost: 1.2e-5 } }))), false],
      ['choice', makeStub(okResponse(choiceReply('bug', { bug: 1 }, { usage: { cost: 1.4e-5 } }))), false],
      ['401', makeStub(errResponse(401, { error: { code: 'missing_api_key' } })), true],
      ['无key', makeStub(okResponse(noulReply(0.9))), true],
      ['非JSON', makeStub(badJsonResponse(200, 'nope')), true],
      ['主问题缺失', makeStub(okResponse({ answers: { z: { type: 'noul', noul: 1 } } })), true],
    ]
    for (const [name, stub, wantDegraded] of paths) {
      const out = await judge({
        state: `s-${name}`,
        fetchImpl: stub.fetchImpl,
        db,
        apiKey: name === '无key' ? undefined : STUB_KEY,
        apiKeyEnv: 'MANA_TEST_KEY_ABSENT',
      })
      assert.equal(out.degraded, wantDegraded, `${name} 的 degraded 必须为 ${wantDegraded}：reason=${out.reason}`)
      assert.equal(out.traceError, null, `${name} 的落痕不得失败：${out.traceError}`)
      // G8：degraded 或 value 至少一个可分辨（降级 ⇒ degraded=1；正常 ⇒ value 非 unknown 或有 answers）
      if (wantDegraded) assert.equal(out.reason === null, false, `${name} 降级必须有非空 reason`)
    }
    assert.equal(count(), paths.length, `调用 ${paths.length} 次必须恰落 ${paths.length} 行（不许有沉默分支，也不许重复落痕）`)
    const rows = all()
    assert.deepEqual(rows.map((r) => r.degraded), [0, 0, 1, 1, 1, 1], '降级行必须标 degraded=1（否则"降级"与"正常"在库层面同形）')
    assert.equal(rows[0].cost_usd, 1.2e-5, '真 JEV 有计费 ⇒ 必须落真实成本（不是 null）')
    assert.equal(rows[2].cost_usd, null, '拿不到成本 ⇒ null（不得用 0 冒充）')
    t.diagnostic(`[S1-15] ${count()} 行：degraded=${rows.map((r) => r.degraded).join(',')}`)
  } finally {
    close()
  }
})

// ── ⑦ 通道选择器（M3：双通道都得在，且各自端点/模型正确）─────────────────────

test('S1-16 缺省值钉死：Config 缺省 = **ollama 通道 + 本地端点 + 本地模型**；systemone 常量独立且正确', async () => {
  // ⚠ 这里**用 URL 解析**而不是写字面量端点：本文件是零网络文件，端点字面量会被闸的
  //   静态腿判红。用解析后的 host/port 断言，同样"钉住缺省 = 本地"，且不靠注释承诺。
  const local = new URL(OLLAMA_DEFAULT_ENDPOINT)
  assert.equal(local.hostname, '127.0.0.1', '**缺省通道必须仍是本机**（静默变成云端是本轮要防的形态之一）')
  assert.equal(local.port, '11434')
  assert.equal(local.protocol, 'http:')
  assert.equal(JEV_DEFAULT_MODEL, 'qwen3.5:0.8b', '本地缺省模型不得因本轮改动而变（旧判据的口径）')

  // 真通道常量：端点/模型/key 变量名/路径/主问题键
  assert.equal(SYSTEMONE_DEFAULT_ENDPOINT, 'https://nano-gpt.com')
  assert.equal(SYSTEMONE_DEFAULT_MODEL, 'jev-1.13', '真通道缺省必须是 JEV **本体**（不是平替、不是 -free）')
  assert.equal(SYSTEMONE_API_KEY_ENV, 'NANOGPT_API_KEY')
  assert.equal(SYSTEMONE_DEFAULT_PATH, '/api/v1/systemone')
  assert.equal(SYSTEMONE_DEFAULT_PRIMARY, 'v')
  assert.equal(SYSTEMONE_CHANNEL, 'systemone')
  assert.equal(OLLAMA_CHANNEL, 'ollama')
  assert.equal(systemoneUrl(SYSTEMONE_DEFAULT_ENDPOINT), `${SYSTEMONE_DEFAULT_ENDPOINT}${SYSTEMONE_DEFAULT_PATH}`)

  // Config schema 的缺省（真源是 src/index.ts 的 Config，不是这份测试的复述）
  const { Config } = await import(IDX)
  const d = Config(undefined)
  assert.equal(d.channel, 'ollama', '`channel` 缺省必须是 ollama（**不许**静默只剩云端）')
  assert.equal(d.endpoint, OLLAMA_DEFAULT_ENDPOINT)
  assert.equal(d.model, JEV_DEFAULT_MODEL)
  assert.equal(d.systemoneEndpoint, SYSTEMONE_DEFAULT_ENDPOINT)
  assert.equal(d.systemoneModel, SYSTEMONE_DEFAULT_MODEL)
  assert.equal(d.systemoneApiKeyEnv, SYSTEMONE_API_KEY_ENV)
  assert.equal(d.systemonePath, SYSTEMONE_DEFAULT_PATH)
  assert.equal(d.systemonePrimaryQuestion, SYSTEMONE_DEFAULT_PRIMARY)
  // 非法通道值必须**抛**（静默回落 = "配置点了没反应"）
  assert.throws(() => Config({ channel: 'cloud' }), /ollama|systemone/, '非法 channel 必须抛错，不许静默回落')
})

test('S1-17 双通道**都能被选中**且各自端点/模型正确（经 apply 装配 + 桩；不静默只剩云端）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(IDX)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function mount(channel) {
    const dir = mkdtempSync(join(tmpdir(), 'mana-jev-ch-'))
    dirs.push(dir)
    const ctx = new Context()
    ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
    await sleep(120)
    ctx.plugin(jevMod, { channel })
    await sleep(250)
    const svc = ctx.get('mana-jev')
    assert.ok(svc, `channel=${channel} 时服务必须可读`)
    return { ctx, svc }
  }

  // ── 腿 1：缺省（ollama）⇒ 打 /api/chat，body 有 messages ──
  const a = await mount('ollama')
  const stubA = makeStub(okResponse({ logprobs: [{ top_logprobs: [{ token: 'yes', logprob: Math.log(0.7) }, { token: 'no', logprob: Math.log(0.3) }] }] }))
  const outA = await a.svc.judgeGuarded({ state: 'S1', question: 'Q1', fetchImpl: stubA.fetchImpl })
  assert.equal(outA.degraded, false, `ollama 腿不得降级：${outA.reason}`)
  assert.ok(String(stubA.calls[0].url).endsWith('/api/chat'), `缺省通道必须打 /api/chat：${stubA.calls[0].url}`)
  assert.ok(Array.isArray(stubA.lastBody().messages), 'ollama 通道的请求体必须有 messages（形态与真通道不同）')
  assert.equal(stubA.lastBody().questions, undefined, 'ollama 通道**不该**出现 questions 字段')
  assert.equal(outA.channel, 'ollama')
  assert.equal(a.svc.status().channel, 'ollama', 'status().channel 必须如实报出生效通道')

  // ── 腿 2：systemone ⇒ 打 /api/v1/systemone，body 有 questions 且**没有** messages ──
  const b = await mount('systemone')
  const stubB = makeStub(okResponse(noulReply(0.88)))
  const outB = await b.svc.judgeGuarded({ state: 'S2', question: 'Q2', fetchImpl: stubB.fetchImpl, apiKey: STUB_KEY })
  assert.equal(outB.degraded, false, `systemone 腿不得降级：${outB.reason}`)
  assert.equal(String(stubB.calls[0].url), `${SYSTEMONE_DEFAULT_ENDPOINT}${SYSTEMONE_DEFAULT_PATH}`)
  assert.deepEqual(Object.keys(stubB.lastBody()).sort(), ['model', 'questions', 'state'])
  assert.equal(stubB.lastBody().messages, undefined, '真通道**不该**出现 messages 字段')
  assert.equal(stubB.lastBody().model, SYSTEMONE_DEFAULT_MODEL, '真通道必须用**自己的**缺省模型（串成 Ollama 的模型名会 400）')
  assert.equal(outB.value, 'yes')
  assert.equal(outB.probability, 0.88)
  assert.equal(outB.channel, 'systemone')
  assert.equal(b.svc.status().channel, 'systemone')
  // 无凭据时真通道**显式降级**（不发请求、不回落 Ollama）
  const stubC = makeStub(okResponse(noulReply(0.9)))
  const outC = await b.svc.judgeGuarded({ state: 'S3', question: 'Q3', fetchImpl: stubC.fetchImpl, apiKeyEnv: 'MANA_TEST_KEY_ABSENT' })
  assert.equal(outC.degraded, true, '无凭据必须降级')
  assert.equal(stubC.calls.length, 0, '无凭据时不得发请求，**更不得**偷偷回落去打本地 Ollama')
  assert.ok(String(outC.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.noApiKey))

  // ── 腿 3：旧通道的**既有**能力仍在（11+23 条旧判据之外的一条端到端反证）──
  assert.equal(a.svc.status().channel, 'ollama', '另一条腿装完后，缺省腿的状态不得被改写')
  t.diagnostic(`[S1-17] ollama→${stubA.calls[0].url} · systemone→${stubB.calls[0].url}`)
  await a.ctx.stop?.()
  await b.ctx.stop?.()
})

// ── ⑧ M5：把"显式红"本身钉住（不许靠注释声明）───────────────────────────────

test('S1-18 真通道判据的**显式红**是结构性事实：live 文件必须含 assert.fail、且**不得**出现静默跳过', async () => {
  const src = readFileSync(new URL(LIVE).pathname, 'utf8')
  assert.match(src, /assert\.fail\(/, 'live 判据在无凭据/不可达时必须 `assert.fail`（**显式红**），否则离线时假绿')
  for (const token of ['t.skip(', 'context.skip(', 'it.skip(', 'skip: true', 'TODO']) {
    assert.equal(src.includes(token), false, `live 判据不得出现 "${token}"（静默跳过 = 本轮点名的假绿形态）`)
  }
  // 必须真的读环境变量（而不是把 key 写进文件）
  assert.match(src, /NANOGPT_API_KEY|SYSTEMONE_API_KEY_ENV/, 'live 判据必须从环境变量读凭据')
  assert.equal(/sk-[A-Za-z0-9]{12,}/.test(src), false, 'live 判据**不得**内联任何 key 形态的字符串')
})

// ── ⑨ 契约边界（本轮不许碰 core）──────────────────────────────────────────

test('S1-19 契约未越界：本通道只产出 `JevJudgeResult` 的**超集**，core 的三态取值一字未增', async () => {
  const coreSrc = readFileSync(new URL('../../core/src/domain.ts', import.meta.url).pathname, 'utf8')
  const m = coreSrc.match(/export interface JevJudgeResult \{([\s\S]*?)\n\}/)
  assert.ok(m, '必须能从 core 抽到 JevJudgeResult（抽不到 ⇒ 本判据会静默空转）')
  assert.match(m[1], /value: 'yes' \| 'no' \| 'unknown'/, '契约三态必须原样（本通道未新增取值）')
  assert.match(m[1], /probability: number \| null/, '契约概率必须原样（null = 不可用）')
  // 适配层的 choice/score 取值**不在契约里** —— 它落在适配层自己的 answers 字段
  assert.equal(m[1].includes('choice'), false, 'choice/score 不得混进 core 契约（那是适配层自己的返回类型）')
  const out = await judge({ fetchImpl: makeStub(okResponse(choiceReply('bug', { bug: 1 }))).fetchImpl })
  assert.equal(['yes', 'no', 'unknown'].includes(out.value), true, '契约面取值必须落在三态内')
})

// ── ⑩ 凭据解析（判据面与探针面**同源**；实测踩过"探针能过、判据全红"）────────

test('S1-20 凭据解析优先级：显式入参 > 环境变量 > env 文件；来源**可枚举**且不含 key 本身', async () => {
  const FILE = '/tmp/mana-jev-fake.env'
  const text = '# comment\nexport NANOGPT_API_KEY="file-key"\nOTHER=1\n'
  const readTextFile = (p) => (p === FILE ? text : undefined)

  // ① 显式优先
  const a = resolveSystemoneCredential({ explicit: 'explicit-key', envName: 'NANOGPT_API_KEY', env: { NANOGPT_API_KEY: 'env-key' }, envFile: FILE, readTextFile })
  assert.equal(a.key, 'explicit-key')
  assert.equal(a.from, 'explicit')

  // ② 环境变量次之（**不读文件**：文件读取器被换成会抛的实现，读它必炸）
  const b = resolveSystemoneCredential({
    envName: 'NANOGPT_API_KEY',
    env: { NANOGPT_API_KEY: 'env-key' },
    envFile: FILE,
    readTextFile: () => assert.fail('环境变量已有 ⇒ 不得再去读文件（读盘是多余的凭据面）'),
  })
  assert.equal(b.key, 'env-key')
  assert.equal(b.from, 'env:NANOGPT_API_KEY')

  // ③ 文件回退（`export ` 前缀 + 引号都要能解析）
  const c = resolveSystemoneCredential({ envName: 'NANOGPT_API_KEY', env: {}, envFile: FILE, readTextFile })
  assert.equal(c.key, 'file-key')
  assert.equal(c.from, `file:${FILE}`)
  assert.equal(String(c.from).includes('file-key'), false, '来源描述**不得**含 key 本身（否则日志一打就泄）')

  // ④ 都没有 ⇒ missing + **试过哪些来源**（供显式红的报错逐条列出）
  const d = resolveSystemoneCredential({ envName: 'NANOGPT_API_KEY', env: {}, envFile: FILE, readTextFile: () => undefined })
  assert.equal(d.missing, true)
  assert.deepEqual(d.tried, ['env:NANOGPT_API_KEY', `file:${FILE}`], '必须列出全部尝试过的来源')

  // ⑤ 文件路径可由 `$JEV_ENV_FILE` 覆盖；`''` 表示禁用文件回退
  const e = resolveSystemoneCredential({ envName: 'NANOGPT_API_KEY', env: { [SYSTEMONE_ENV_FILE_VAR]: FILE }, envFile: undefined, readTextFile })
  assert.equal(e.from, `file:${FILE}`, `环境变量 ${SYSTEMONE_ENV_FILE_VAR} 必须能改路径`)
  const f = resolveSystemoneCredential({ envName: 'NANOGPT_API_KEY', env: {}, envFile: '', readTextFile: () => assert.fail('envFile=空串 ⇒ 禁用文件回退，不得读盘') })
  assert.equal(f.missing, true, 'envFile="" ⇒ 结构性禁用文件回退')
  assert.deepEqual(f.tried, ['env:NANOGPT_API_KEY'], '禁用时不该把 file: 列进"试过"')
})

test('S1-21 `parseEnvFile` 纯函数面：注释/空行/export 前缀/单双引号/非法行', async () => {
  const parsed = parseEnvFile(
    ['# 注释行', '', '  NANOGPT_API_KEY=plain  ', 'export QUOTED="with space"', "SINGLE='x=y'", 'NOEQUALS', '=novalue'].join('\n'),
  )
  assert.deepEqual(parsed, { NANOGPT_API_KEY: 'plain', QUOTED: 'with space', SINGLE: 'x=y' }, '非法行必须被跳过（不得把 "NOEQUALS" 当成键）')
  assert.deepEqual(parseEnvFile(''), {})
  // 读不到文件 ⇒ undefined（**不抛、也不静默当成空 key**）
  assert.equal(readEnvFileText('/definitely/not/here.env'), undefined)
  assert.equal(SYSTEMONE_DEFAULT_ENV_FILE.endsWith('/jev/.env'), true, '缺省用户配置位必须是 ~/jev/.env（边界原话指定的位置）')
})

test('S1-22 同源硬件约束：判据面与探针面读凭据走**同一个函数**（结构上不可能再分叉）', async () => {
  const liveSrc = readFileSync(new URL('./live/systemone-live.test.mjs', import.meta.url).pathname, 'utf8')
  const probeSrc = readFileSync(new URL('../scripts/probe-systemone.mjs', import.meta.url).pathname, 'utf8')
  for (const [name, src] of [['live 判据', liveSrc], ['探针', probeSrc]]) {
    assert.match(src, /resolveSystemoneCredential\(/, `${name} 必须经 resolveSystemoneCredential 读凭据（同源入口）`)
    assert.equal(/process\.env\[SYSTEMONE_API_KEY_ENV\]/.test(src), false, `${name} **不得**自己直读环境变量（那正是分叉的起点）`)
  }
  // 运行态口径**相反**：插件代码只读环境变量，不读用户的 env 文件
  const srcSrc = readFileSync(new URL('../src/systemone.ts', import.meta.url).pathname, 'utf8')
  // ⚠ 判据口径必须精确到"**调用** vs 提名字"：运行态的降级文案里**正当**提到过
  //   `resolveSystemoneCredential()`（告诉使用者怎么补凭据）。第一版用 `includes('…(')`，
  //   结果被一句**提示文案**判红 —— 那是假红，实测踩过。下面两条各自只钉真正的越界形态：
  //   ① 文件读取原语（读盘的真动作）；② 解析器的**调用语法**（赋值/await/return 位置）。
  const runtime = srcSrc.slice(srcSrc.indexOf('export async function judgeWithSystemone'))
  assert.match(runtime, /readApiKey\(/, '运行态必须走只读环境变量的 readApiKey（边界：插件代码只读环境变量）')
  assert.equal(/\breadEnvFileText\s*\(|\bparseEnvFile\s*\(/.test(runtime), false, '运行态**不得**调用文件读取原语（边界原话：插件代码只读环境变量）')
  assert.equal(
    /(=|await\s+|\breturn\s+)resolveSystemoneCredential\s*\(/.test(runtime),
    false,
    '运行态**不得**调用 resolveSystemoneCredential()（它是判据/探针面入口；提名字可以，调用不行）',
  )
})

test('S1-23 主问题形状**认不出**（服务端可能新增 type）⇒ 显式降级 + reason 可枚举（不得当正常路径放行）', async (t) => {
  // 这一条是**变异测试逼出来的**：把"choice/score 之外的形状要降级"这个分支改成恒 null 时，
  // 原判据面**全绿**（22/22）—— 即"主问题认不出"这一支没有任何用例覆盖。
  const reply = { model: 'x', answers: { v: { type: 'quantum', payload: 1 } } }
  const out = await judge({ fetchImpl: makeStub(okResponse(reply)).fetchImpl })
  assert.equal(out.degraded, true, '主问题形状认不出 ⇒ 必须降级（静默放行等于把"读不懂"当成"判完了"）')
  assert.ok(String(out.reason).startsWith(SYSTEMONE_DEGRADED_REASONS.primaryNotNoul), `reason 前缀：${out.reason}`)
  assert.match(String(out.reason), /quantum/, 'reason 必须点名认不出的 type')
  assert.equal(out.value, 'unknown', '不得默认成 no')
  assert.equal(out.probability, null, '不得用 0 冒充')
  assert.equal(out.answers.v.type, 'quantum', '原始形状仍须原样保留（好让人知道服务端加了什么）')
  assert.equal(out.answers.v.unusableReason.includes('quantum'), true)
  t.diagnostic(`[S1-23] 认不出的主问题 ⇒ ${out.reason}`)
})
