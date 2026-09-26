/**
 * dsh-mana-jev · B1.4 **真通道腿** —— 对 `jev-1.13` 本体发真请求（`/api/v1/systemone`）。
 *
 * ## 为什么单独一个目录（`tests/live/`）
 * 零网络是 根目录 tests 下的**硬纪律**（拔网线仍须全绿）。真通道判据**必然**要联网，
 * 混在一起只有两种结局：要么零网络纪律被稀释，要么真通道判据被静默跳过。
 * ⇒ 分目录 + **分命令**：根 `npm test` 的 glob 只扫 `packages/<包>/tests/` 的**第一层**，
 *   不会扫到本目录；本文件只由显式命令跑。
 *
 * ## ⚠ 无凭据 ⇒ **显式红**（`assert.fail`），**绝不静默跳过**
 * 实测过的假绿形态：「不可达就 `return`」⇒ 离线时 `exit 0 / 11 pass / skipped 0`，
 * 而外部闸照抄旧文案仍说"非 skip"。⇒ 本文件的每一条都以 `requireCredential()` 开头，
 * 它**要么返回真 key，要么 `assert.fail`**（没有第三条路）。S1-18 那条离线判据
 * 用源码扫描把"必须有 assert.fail、不得出现 skip"钉住，所以这条纪律不是注释承诺。
 *
 * ## 凭据从哪来
 * `~/jev/.env` 里是 **OS 环境变量之外的第二处**（该文件由用户维护，600 权限）。本文件
 * **不读它**：要么环境变量在，要么红。用户可复跑命令里给出 `set -a; . ~/jev/.env; set +a` 的注入写法。
 * **key 永不回显**（只可能出现在请求头里；诊断输出只给长度与端点）。
 *
 * ## A 档锚点（与 `~/jev/jev_client.py selftest` 同口径）
 * noul 正向 `>0.5`、反向 `<0.5`、choice 三例取值正确（bug/feature/question）。
 * 成本与延迟是 **B 档浮动量**，只作 `t.diagnostic` 打印，**不进任何阈值断言**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after } from 'node:test'

const SYS = new URL('../../src/systemone.ts', import.meta.url).href
const CORE = new URL('../../../core/src/index.ts', import.meta.url).href

const {
  judgeWithSystemone,
  resolveSystemoneCredential,
  parseEnvFile,
  SYSTEMONE_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_ENDPOINT,
  SYSTEMONE_API_KEY_ENV,
  SYSTEMONE_DEFAULT_ENV_FILE,
  SYSTEMONE_ALLOWED_MODELS,
  // W1-2：live 腿要用到通道常量与"真发出去的形状"（L6 比 status() 同源、L9 造坏请求）
  SYSTEMONE_CHANNEL,
  SYSTEMONE_DEFAULT_PATH,
} = await import(SYS)

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/**
 * 凭据：**要么真 key，要么显式红**。
 *
 * ⚠ 与探针 `scripts/probe-systemone.mjs` **同一个解析入口**（`resolveSystemoneCredential`）：
 *   实测踩过一次"探针能过、判据全红" —— 因为两处各自读凭据（一处环境变量、一处别的来源）。
 *   同源入口后，两者**结构上**不可能再分叉。
 * ⚠ 顺序：环境变量 → `$JEV_ENV_FILE` → `~/jev/.env`（用户配置位，只读；**key 永不回显**）。
 */
function requireCredential() {
  const cred = resolveSystemoneCredential()
  if ('missing' in cred) {
    assert.fail(
      `真通道判据拿不到凭据：试过 ${cred.tried.join(' → ')} —— ` +
        '**本判据不静默跳过**（没有凭据就是没验证过，必须红）。' +
        `\n  ① 该文件应由用户维护（600），本判据默认读它：${SYSTEMONE_DEFAULT_ENV_FILE}` +
        `\n  ② 或注入环境变量：set -a; . ~/jev/.env; set +a` +
        `\n  ③ 或指定别处：JEV_ENV_FILE=/path/to/.env` +
        `\n  复跑：node --test ${new URL(import.meta.url).pathname}`,
    )
  }
  return cred.key
}

async function tempDb() {
  const core = await import(CORE)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-live-'))
  dirs.push(dir)
  const db = new DatabaseSync(join(dir, 'mana.db'))
  core.createSchema(db)
  const rows = () => db.prepare('SELECT result_value, probability, degraded, cost_usd FROM jev_log ORDER BY rowid').all()
  return { db, rows, close: () => db.close() }
}

const LIVE_TIMEOUT_MS = 60_000

/** 真调一次（key 从环境变量来；**不经手、不回显**）。 */
function liveJudge(options, extra = {}) {
  return judgeWithSystemone({
    apiKey: requireCredential(),
    timeoutMs: LIVE_TIMEOUT_MS,
    ...extra,
    ...options,
  })
}

/** 真通道不可达/HTTP 错时给出**可读的红**（而不是一句 "degraded"）。 */
function assertNotDegraded(out, label) {
  assert.equal(
    out.degraded,
    false,
    `${label} 不得降级；reason=${out.reason}（若为 httpError，先看 reason 里的服务端正文——401=凭据、400=模型名/请求形态）`,
  )
  assert.equal(out.reason, null, `${label} 正常路径 reason 必须为 null`)
}

test('L1 真通道 · noul **正向**：紧急陈述 ⇒ noul > 0.5（A 档锚点，与用户 selftest 同口径）', async (t) => {
  const out = await liveJudge({
    state: '系统崩了三天无法收款，紧急！',
    questions: { v: { type: 'noul', instructions: '是否紧急或时间敏感？' } },
    primaryQuestion: 'v',
  })
  assertNotDegraded(out, 'noul 正向')
  assert.equal(out.value, 'yes', `noul=${out.probability} 必须 > 0.5 ⇒ yes（实测基准 ~0.97）`)
  assert.ok(out.probability > 0.5, `A 档锚点：正向必须 >0.5，实测 ${out.probability}`)
  assert.equal(out.channel, 'systemone')
  assert.ok(String(out.servedModel).includes('jev-1.13'), `服务端自报模型必须含 jev-1.13：${out.servedModel}`)
  t.diagnostic(`[L1] url=${SYSTEMONE_DEFAULT_ENDPOINT} model=${out.servedModel} noul=${out.probability} ${out.latencyMs}ms cost=${out.costUsd}`)
})

test('L2 真通道 · noul **反向**：不着急 ⇒ noul < 0.5（与 L1 构成"有区分度"的证据）', async (t) => {
  const out = await liveJudge({
    state: '有个错别字，不着急，有空再说。',
    questions: { v: { type: 'noul', instructions: '是否紧急或时间敏感？' } },
    primaryQuestion: 'v',
  })
  assertNotDegraded(out, 'noul 反向')
  assert.equal(out.value, 'no', `noul=${out.probability} 必须 < 0.5 ⇒ no（实测基准 ~0.06）`)
  assert.ok(out.probability < 0.5, `A 档锚点：反向必须 <0.5，实测 ${out.probability}`)
  t.diagnostic(`[L2] noul=${out.probability} ${out.latencyMs}ms cost=${out.costUsd}`)
})

test('L3 真通道 · choice 三例取值全对（bug / feature / question）且取值**不丢**（degraded=false）', async (t) => {
  const CRITERIA = { bug: '报错崩溃', feature: '功能请求', question: '使用咨询' }
  const CASES = [
    ['bug', '装了插件启动直接崩溃报错。'],
    ['feature', '希望增加深色模式。'],
    ['question', '请问 API 速率限制是多少？'],
  ]
  const seen = []
  for (const [want, state] of CASES) {
    const out = await liveJudge({
      state,
      questions: { v: { type: 'choice', instructions: '归类', criteria: CRITERIA } },
      primaryQuestion: 'v',
    })
    assertNotDegraded(out, `choice(${want})`)
    assert.equal(out.answers.v.choice, want, `choice 必须判成 "${want}"，实测 "${out.answers.v.choice}"（state=${state}）`)
    assert.equal(out.value, 'unknown', 'choice 无 yes/no 语义 ⇒ 契约面必须 unknown（不得默认 no）')
    assert.equal(out.probability, null, '概率不可用 ⇒ null（不得用 0 冒充）')
    assert.ok(out.answers.v.probabilities, 'probabilities 必须带出（否则无法分辨"很确信"与"勉强")')
    seen.push(`${want}→${out.answers.v.choice}(conf=${out.answers.v.confidence})`)
  }
  t.diagnostic(`[L3] ${seen.join(' · ')}`)
})

test('L4 真通道 · **多问同调**：一次调用两问，两个答案都在（"多问被压成单问"的真机反证）', async (t) => {
  const out = await liveJudge({
    state: '系统崩了三天无法收款，紧急！',
    questions: {
      urgent: { type: 'noul', instructions: '是否紧急或时间敏感？' },
      kind: { type: 'choice', instructions: '归类', criteria: { bug: '报错崩溃', feature: '功能请求', question: '使用咨询' } },
    },
    primaryQuestion: 'urgent',
  })
  assertNotDegraded(out, '多问同调')
  assert.deepEqual(Object.keys(out.answers).sort(), ['kind', 'urgent'], `两问都必须有答案（实测 ${Object.keys(out.answers).join('|')}）`)
  assert.equal(out.primaryQuestion, 'urgent', '契约单值面必须取自显式声明的主问题')
  assert.ok(out.probability > 0.5, `主问题 noul=${out.probability} 应当 >0.5`)
  assert.ok(['bug', 'feature', 'question'].includes(out.answers.kind.choice), `次要答案的取值必须可读：${out.answers.kind.choice}`)
  t.diagnostic(`[L4] urgent=${out.answers.urgent.noul} kind=${out.answers.kind.choice} ${out.latencyMs}ms cost=${out.costUsd}`)
})

test('L5 真通道 · 落痕 + 成本口径：jev_log 落真行，cost_usd **不为 0**（拿不到则 null）', async (t) => {
  const { db, rows, close } = await tempDb()
  try {
    const out = await liveJudge(
      {
        state: '系统崩了三天无法收款，紧急！',
        questions: { v: { type: 'noul', instructions: '是否紧急或时间敏感？' } },
        primaryQuestion: 'v',
      },
      { db, source: 'mana-jev-systemone-live' },
    )
    assertNotDegraded(out, '落痕腿')
    assert.equal(out.traceError, null, `落痕不得失败：${out.traceError}`)
    const all = rows()
    assert.equal(all.length, 1, `真判定必须恰落一行（实测 ${all.length}）`)
    assert.equal(all[0].result_value, out.value)
    assert.equal(all[0].degraded, 0)
    if (out.costUsd !== null) {
      // ⚠ 只断"不是 0 冒充" + 有限，**不**给成本设阈值（B 档浮动量）
      assert.ok(Number.isFinite(out.costUsd) && out.costUsd > 0, `成本必须为正的有限数（不得用 0 冒充）：${out.costUsd}`)
      assert.equal(all[0].cost_usd, out.costUsd, '库里的 cost_usd 必须与返回值一致')
    } else {
      assert.equal(all[0].cost_usd, null, '拿不到成本 ⇒ 库里必须是 null（不得写 0）')
    }
    t.diagnostic(`[L5] rows=${all.length} cost_usd=${all[0].cost_usd} 白名单=${SYSTEMONE_ALLOWED_MODELS.join('/')} 缺省模型=${SYSTEMONE_DEFAULT_MODEL}`)
  } finally {
    close()
  }
})

// ══ W1-2 真跑腿：真 JEV 缺失的那三项能力必须**真机可验**（不是"代码写了"）════════
//
// 为什么这四条必须真跑（而不是加到离线文件里）：它们要证的三件事**本质上只有真端点能证**——
//   ① 真通道被启用后，`status()` 报的通道/模型**就是真发出去的那一套**；
//   ② 「一次请求塞 N 问」在**真服务端**上确实比一问一请求快一个量级（批量是真的）；
//   ③ 「120 并发」在**真服务端**上确实吃得住（并发是真的），而不是本机替身的平坦读数。
// 离线桩对这三件事**只能**证明"代码按我写的形状拼了请求"，证明不了服务端收下了它。
//
// ⚠ 成本与延迟是 **B 档浮动量**：只打印与被比**数量级**，不进绝对阈值断言
//   （唯一例外是"数组必 400"——那是**协议面**的事实，端点一改就必须红）。

/** 走**服务面**（真装配 core + jev）真跑：这才是"通道被启用且可验证"的端到端形态。 */
async function mountLive(overrides = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(new URL('../../src/index.ts', import.meta.url).href)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-live-w12-'))
  dirs.push(dir)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await new Promise((r) => setTimeout(r, 150))
  ctx.plugin(jevMod, overrides)
  await new Promise((r) => setTimeout(r, 300))
  const svc = ctx.get('mana-jev')
  if (!svc) assert.fail('mana-jev 服务不可读（真跑腿无法成立）')
  return { ctx, svc, db: ctx.get('mana-core').db, stop: () => ctx.stop?.() }
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]

test('L6 服务面真跑：status() 报的通道/模型就是真发出去的那一套（含落痕 model 列）', async (t) => {
  requireCredential()
  const { svc, db, stop } = await mountLive({ channel: 'systemone' })
  try {
    const s = svc.status()
    assert.equal(s.channel, SYSTEMONE_CHANNEL, 'status().channel 必须是真通道')
    assert.ok(s.model.startsWith('jev-'), `status().model 必须是 JEV 本体名：${s.model}`)
    assert.equal(s.credentialPresent, true, `凭据已在 ~/jev/.env 里却报 present=false（探测口径与判据面必须同源）`)
    assert.equal(JSON.stringify(s).includes('sk-'), false, 'status() 不得回显任何 key 形态')

    const out = await svc.judgeGuarded({
      state: '系统崩了三天无法收款，紧急！',
      question: '是否紧急或时间敏感？',
      apiKey: requireCredential(),
      source: 'mana-jev-w12-live',
    })
    assertNotDegraded(out, 'L6 服务面真跑')
    assert.equal(out.channel, SYSTEMONE_CHANNEL, '落痕的通道标注必须是 systemone')
    assert.equal(out.endpoint, s.endpoint, '实发端点必须等于 status() 报的端点')
    assert.equal(out.model, s.model, '实发模型必须等于 status() 报的模型')
    assert.ok(String(out.servedModel).includes('typesafe/jev-1.13-'), `服务端自报模型必须含 typesafe/jev-1.13-*：${out.servedModel}`)
    const rows = db.prepare('SELECT result_value, degraded, cost_usd FROM jev_log ORDER BY rowid').all()
    assert.equal(rows.length, 1, `真判定必须恰落一行（实测 ${rows.length}）`)
    assert.equal(rows[0].degraded, 0)
    t.diagnostic(`[L6] channel=${s.channel} model=${s.model} served=${out.servedModel} noul=${out.probability} ${out.latencyMs}ms cost=${out.costUsd}`)
  } finally {
    await stop()
  }
})

test('L7 批量真跑：50 问**一次请求**全部返回（≈1.7s 量级），一问一请求做同量级对照', async (t) => {
  const key = requireCredential()
  const { svc, db, stop } = await mountLive({ channel: 'systemone', sessionBudget: 100, cacheTtlSeconds: 0 })
  try {
    const N = 50
    const questions = {}
    for (let i = 0; i < N; i += 1) questions[`q${i}`] = { type: 'noul', instructions: `第 ${i} 问：该陈述是否涉及主题 ${i}？` }
    const t0 = Date.now()
    const out = await svc.judgeBatch({
      state: '系统崩了三天无法收款，紧急！',
      question: '（批量主问回退文本）',
      questions,
      primaryQuestion: 'q0',
      apiKey: key,
      source: 'mana-jev-w12-live',
    })
    const batchMs = Date.now() - t0
    assert.equal(out.degraded, false, `批量真跑不得降级：${out.reason}`)
    const got = Object.keys(out.answers ?? {})
    assert.equal(got.length, N, `50 问必须**全回**（实测 ${got.length}）`)
    assert.ok(out.probability !== null, '主问题必须有可达的契约单值面')

    // 对照：**一次一问**（同一服务面、同一通道、同量级输入）—— 只取前 3 问，避免把对照本身变成负担
    const single = []
    for (let i = 0; i < 3; i += 1) {
      const a = Date.now()
      const one = await svc.judgeGuarded({
        state: `单问对照 ${i}`,
        question: `该陈述是否涉及主题 ${i}？`,
        apiKey: key,
        source: 'mana-jev-w12-live',
      })
      assertNotDegraded(one, `L7 对照单问#${i}`)
      single.push(Date.now() - a)
    }
    const rows = db.prepare('SELECT count(*) c FROM jev_log').get().c
    assert.equal(Number(rows), 4, `批量 1 行 + 对照 3 行（实测 ${rows}）`)
    t.diagnostic(
      `[L7] 50问单请求=${batchMs}ms（${(batchMs / N).toFixed(1)}ms/问） · 单问均值=${Math.round(single.reduce((a, b) => a + b, 0) / single.length)}ms · ` +
        `模型=${out.servedModel} · 成本=${out.costUsd}`,
    )
    // ⚠ 断的是**数量级**（B 档浮动量不做绝对阈值）：批量把 50 问压进一次往返，
    //   其总耗时不应当高于"一问一请求"的单次耗时量级 —— 真退回串行时这条必红。
    const singleAvg = single.reduce((a, b) => a + b, 0) / single.length
    assert.ok(
      batchMs < singleAvg * N * 0.5,
      `50 问单请求若退化成 N 次往返，总耗时会到 ${Math.round(singleAvg * N)}ms 量级；实测 ${batchMs}ms`,
    )
  } finally {
    await stop()
  }
})

test('L8 并发真跑：120 项扇出（缺省通道）⇒ ok=120/120、p95 < 5s、逐项留痕 120 行', async (t) => {
  const key = requireCredential()
  const N = 120
  const { svc, db, stop } = await mountLive({
    channel: 'systemone',
    maxConcurrency: N,
    sessionBudget: N * 2,
    cacheTtlSeconds: 0,
    concurrencyWaitTimeoutMs: 120_000,
  })
  try {
    const t0 = Date.now()
    const outs = await svc.judgeFanout(
      Array.from({ length: N }, (_, i) => ({
        key: `w12-live-${i}`,
        state: `系统崩了三天无法收款，紧急 #${i}（并发腿）`,
        question: '是否紧急或时间敏感？',
        sessionId: 'w12-live',
        apiKey: key,
        source: 'mana-jev-w12-live',
      })),
    )
    const wallMs = Date.now() - t0
    const ok = outs.filter((o) => !o.degraded)
    const lat = ok.map((o) => o.latencyMs).sort((a, b) => a - b)
    const rows = Number(db.prepare('SELECT count(*) c FROM jev_log').get().c)
    t.diagnostic(
      `[L8] ok=${ok.length}/${N} wall=${wallMs}ms p50=${pct(lat, 0.5)}ms p95=${pct(lat, 0.95)}ms max=${lat[lat.length - 1]}ms ` +
        `${(N / (wallMs / 1000)).toFixed(1)} req/s 行=${rows} 峰值在飞=${svc.guardState().peakInFlight}`,
    )
    assert.equal(outs.length, N, '扇出不得丢项')
    assert.equal(ok.length, N, `必须 120/120 成功；降级样本：${outs.filter((o) => o.degraded).slice(0, 2).map((o) => o.reason).join(' | ')}`)
    assert.equal(rows, N, `逐项落痕：120 项恰 120 行（实测 ${rows}）`)
    assert.equal(svc.guardState().peakInFlight, N, `护栏峰值必须恰为 ${N}（真并发而非排队）`)
    assert.ok(pct(lat, 0.95) < 5000, `p95 必须 < 5000ms，实测 ${pct(lat, 0.95)}ms`)
  } finally {
    await stop()
  }
})

test('L9 反证：`questions` 传**数组** ⇒ 服务端必 400（协议面事实，端点一改必须红）', async (t) => {
  const key = requireCredential()
  // ⚠ 这是本批唯一**故意发坏请求**的腿：它要证的是"map 不是风格偏好，而是协议要求"。
  //   用裸 fetch 而不是经服务面 —— 服务面的 TS 类型已经不允许数组，构造不出这个请求。
  const res = await fetch(`${SYSTEMONE_DEFAULT_ENDPOINT}${SYSTEMONE_DEFAULT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: SYSTEMONE_DEFAULT_MODEL,
      state: '反证：数组形态',
      questions: [{ type: 'noul', instructions: '是否紧急？' }],
    }),
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
  })
  const text = await res.text()
  t.diagnostic(`[L9] 数组形态 ⇒ status=${res.status} body=${text.slice(0, 160)}`)
  assert.equal(res.status, 400, `数组形态必须被 400 拒绝（实测 ${res.status}）—— 若这里变绿，说明协议变了，` +
    'BatchJudgeOptions.questions 的类型与注释都要跟着改')
  // ⚠ 断言的是**参数名**而不是那段英文散文：服务端文案会改（"Questions must be a non-empty
  //   object." → 别的说法），但 `param:"questions"`/`code:"invalid_questions"` 是**协议面**的锚点。
  //   实测正文：{"error":{"message":"Questions must be a non-empty object.","type":
  //   "invalid_request_error","code":"invalid_questions","param":"questions"}}
  assert.match(
    text,
    /"param"\s*:\s*"questions"|invalid_questions/i,
    `400 正文必须把 questions 参数点出来（协议面锚点，不是散文）：${text.slice(0, 160)}`,
  )
})

