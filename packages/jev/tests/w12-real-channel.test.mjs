/**
 * dsh-mana-jev · **W1-2 判据** —— 真 JEV 通道可启用/可验证 + 并发能力可配到 120 + 批次与扇出。
 *
 * ## 本文件的核心纪律：**零网络**（与 `framework.test.mjs` / `systemone.test.mjs` 同款）
 * 端点字面量不出现（用常量拼），全部判定走注入接缝 `fetchImpl` 桩 +
 * 显式通道声明 ⇒ 拔掉网线仍应全绿。真机读数在 `tests/live/`（不在本文件的能力面里）。
 *
 * ## 为什么这四条各自要有判据（不是"顺手加几条"）────────────────────────────
 * | 判据 | 抓的形态 |
 * |---|---|
 * | W1-2-1 | **配置与能力不匹配**：有真 JEV 却缺省跑替身（进程照起、判定照出，只有 model 列看得出来） |
 * | W1-2-2 | **读数与实发分叉**：`status()` 说一套、真发出去的请求是另一套（最难查的一类） |
 * | W1-2-3 | **假旋钮**：并发写着"可配"但没有上限/没有缺省依据（配 121 静默生效 = 打到服务端被限流才发现） |
 * | W1-2-4 | **上限是装饰**：数值配到 120，实际在飞仍是 4（本批之前正是 4） |
 * | W1-2-5 | **槽位移交被改成先减后加** ⇒ 出现**过订窗口**（峰值超过上限，负载下随机超限） |
 * | W1-2-6 | **批量被压成单问**：`questions` 的 N 个键只剩 1 个（"看起来成功、实际只判了一问"） |
 * | W1-2-7 | **偷偷换路**：替身通道上的"批量"用 N 次往返假装实现（返回形状一样、语义完全不同） |
 * | W1-2-8 | **一颗老鼠屎坏一锅汤**：扇出里一项失败把整批打成降级；且逐项不与落痕行对得上 |
 *
 * ⚠ 本注释块内**不得出现**星号加斜杠的字符组合（本仓踩过一次：块注释提前终止）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const IDX = new URL('../src/index.ts', import.meta.url).href
const FW = new URL('../src/framework.ts', import.meta.url).href
const SYS = new URL('../src/systemone.ts', import.meta.url).href
const OLL = new URL('../src/ollama.ts', import.meta.url).href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href

const {
  Config,
  JEV_BATCH_CHANNEL_REASON,
} = await import(IDX)
const {
  JevGuard,
  JEV_DEFAULT_MAX_CONCURRENCY,
  JEV_MAX_CONCURRENCY_LIMIT,
} = await import(FW)
const {
  SYSTEMONE_DEFAULT_ENDPOINT,
  SYSTEMONE_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_PATH,
  SYSTEMONE_CHANNEL,
} = await import(SYS)
const { OLLAMA_DEFAULT_ENDPOINT, OLLAMA_CHANNEL, JEV_DEFAULT_MODEL } = await import(OLL)

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 夹具（全部离线；两个通道的响应形状各一套，**不得混用**）────────────────────

/** 替身（本机单 token logprob）的 200 响应：读 `res.json()`。 */
function ollamaReply(pYes) {
  const body = JSON.stringify({
    message: { role: 'assistant', content: 'yes' },
    logprobs: [
      {
        token: 'yes',
        logprob: Math.log(pYes),
        top_logprobs: [
          { token: 'yes', logprob: Math.log(pYes) },
          { token: 'no', logprob: Math.log(1 - pYes) },
        ],
      },
    ],
  })
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) }
}

/** 真 JEV 的 200 响应（实测形状）：读 `res.text()` 再自己 parse。 */
function noulReply(p, key = 'v') {
  const body = JSON.stringify({
    model: 'typesafe/jev-1.13-20260917',
    answers: { [key]: { type: 'noul', noul: p } },
  })
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) }
}

/** 计数桩：记录**完整请求**（url + headers + 解析后的 body），并跟踪**同时在飞峰值**。 */
function makeStub(replyFor) {
  const calls = []
  let inFlight = 0
  let peak = 0
  return {
    calls,
    peak: () => peak,
    lastBody: () => (calls.length ? calls[calls.length - 1].body : null),
    lastUrl: () => (calls.length ? calls[calls.length - 1].url : null),
    fetchImpl: async (url, init) => {
      const raw = init?.body
      // ⚠ 本次调用**自己的**记录：并发下 `calls[calls.length-1]` 可能是别人的
      //   （本判据实测踩过：写成后者时，"按 state 决定行为"静默退回成"按随机项决定行为"）
      const record = { url: String(url), init, body: typeof raw === 'string' ? JSON.parse(raw) : raw }
      calls.push(record)
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      try {
        // 每一项的延迟不同 ⇒ 谁先谁后不完全确定，逼出"结果不得按到达顺序对位"的形态
        await sleep(3 + (calls.length % 3))
        const r = typeof replyFor === 'function' ? replyFor(calls.length, record) : replyFor
        if (r instanceof Error) throw r
        return r
      } finally {
        inFlight -= 1
      }
    },
  }
}

/** 装一次真 Context（core + jev），返回服务面与库读数。**绝不指向 $DSH_HOME**。 */
async function mount(cfg = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(IDX)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-w12-'))
  dirs.push(dir)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await sleep(150)
  ctx.plugin(jevMod, cfg)
  await sleep(300)
  const svc = ctx.get('mana-jev')
  assert.ok(svc, 'mana-jev 服务必须可读')
  const db = ctx.get('mana-core').db
  const rows = () => db.prepare('SELECT id, result_value, degraded, source FROM jev_log ORDER BY rowid').all()
  const count = () => Number(db.prepare('SELECT count(*) c FROM jev_log').get().c)
  const ids = () => db.prepare('SELECT id FROM jev_log ORDER BY rowid').all().map((r) => r.id)
  return { ctx, svc, rows, count, ids, stop: () => ctx.stop?.() }
}

// ── ① 缺省通道：能力最强的那个 ────────────────────────────────────────────────

test('W1-2-1 缺省通道是真 JEV（不是替身）：Config 缺省 + 未显式配通道的装配，status() 必须报 systemone', async () => {
  const d = Config(undefined)
  assert.equal(d.channel, 'systemone', '缺省通道必须是真 JEV 本体（旧缺省 ollama 是替身，非 JEV 模型）')
  assert.equal(d.systemoneModel, SYSTEMONE_DEFAULT_MODEL, '缺省腿的模型必须是 JEV 本体常量')
  assert.notEqual(d.systemoneEndpoint, d.endpoint, '两条通道的端点必须各是各的（串用会 400/连不上）')

  const { svc, stop } = await mount()
  try {
    const s = svc.status()
    assert.equal(s.channel, SYSTEMONE_CHANNEL, 'status().channel 必须如实报出生效通道')
    // ⚠ 只报通道名不够：模型/端点配错时进程照起、判定每次 400 ⇒ 这两项必须**可读**
    assert.equal(s.model, SYSTEMONE_DEFAULT_MODEL, 'status() 必须报出**生效**模型')
    assert.equal(s.endpoint, SYSTEMONE_DEFAULT_ENDPOINT, 'status() 必须报出**生效**端点')
    assert.equal(s.path, SYSTEMONE_DEFAULT_PATH, 'status() 必须报出真通道路径')
    assert.notEqual(s.endpoint, OLLAMA_DEFAULT_ENDPOINT, '缺省腿不得仍指向本机替身端点')
    // 凭据就绪度**只回布尔**：key 本身永不经过服务面
    assert.equal(typeof s.credentialPresent, 'boolean', '凭据就绪度必须是布尔（不得回显 key）')
    assert.equal(JSON.stringify(s).includes('sk-'), false, 'status() 的 JSON 里不得出现任何 key 形态')
  } finally {
    await stop()
  }
})

test('W1-2-2 status() 不是复述配置：它报的端点/模型必须与**真发出去**的请求逐字一致', async () => {
  const { svc, stop } = await mount()
  try {
    const s = svc.status()
    const stub = makeStub(noulReply(0.83))
    const out = await svc.judgeGuarded({
      state: 'S-同源',
      question: '是否紧急？',
      apiKey: 'stub-key',
      fetchImpl: stub.fetchImpl,
    })
    assert.equal(out.degraded, false, `缺省腿必须走真通道且不降级：${out.reason}`)
    assert.equal(stub.calls.length, 1)
    assert.equal(stub.lastUrl(), `${s.endpoint}${s.path}`, '实发 URL 必须逐字等于 status() 报的 端点+路径')
    assert.equal(stub.lastBody().model, s.model, '实发的 model 必须逐字等于 status() 报的模型')
    assert.equal(s.model, SYSTEMONE_DEFAULT_MODEL, '缺省腿的生效模型必须是 JEV 本体')
    assert.notEqual(s.model, JEV_DEFAULT_MODEL, '缺省腿**不得**仍在用本地替身的模型名（串名会 400 model_not_supported）')
    assert.equal(out.channel, SYSTEMONE_CHANNEL, '判定结果自己的通道标注必须与 status() 一致')
    assert.equal(out.servedModel, 'typesafe/jev-1.13-20260917', '服务端自报模型必须被带出（与请求名互为反证）')
  } finally {
    await stop()
  }
})

// ── ② 并发能力：可配、有缺省依据、有配置面红线 ────────────────────────────────

test('W1-2-3 并发上限可配到 120 且**配置面**有红线：缺省 32、超 120 必须抛（不许静默夹到 120）', async () => {
  assert.equal(JEV_DEFAULT_MAX_CONCURRENCY, 32, '缺省并发必须提到 32（旧值 4 是替身时代的约束）')
  assert.equal(JEV_MAX_CONCURRENCY_LIMIT, 120, '硬上限必须是真 JEV 实测吃满的 120')
  assert.equal(Config(undefined).maxConcurrency, 32, 'Schema 缺省必须与常量同值（不是两处各写一份）')
  assert.equal(Config({ maxConcurrency: JEV_MAX_CONCURRENCY_LIMIT }).maxConcurrency, 120, '120 必须被接受')
  assert.throws(
    () => Config({ maxConcurrency: 121 }),
    /120/,
    '超过服务端能力必须在**配置面**就红 —— 静默夹到 120 会让"我配了 500"变成一句谎话',
  )
  assert.throws(() => Config({ maxConcurrency: 0 }), /1/, '0 并发会让每次判定都排队超时，必须在配置面拒绝')

  const { svc, stop } = await mount({ maxConcurrency: JEV_MAX_CONCURRENCY_LIMIT })
  try {
    const s = svc.status()
    assert.equal(s.maxConcurrency, JEV_MAX_CONCURRENCY_LIMIT, 'status() 必须报出生效并发上限（读得到的配置才是被消费的配置）')
    assert.equal(s.maxConcurrencyLimit, JEV_MAX_CONCURRENCY_LIMIT)
    assert.equal(svc.guardState().config.maxConcurrency, 120, '护栏实例里的生效值必须一致（两处读数不得分叉）')
  } finally {
    await stop()
  }
})

test('W1-2-4 上限是**真的**：配到 120 ⇒ 120 项扇出同时在飞（峰值恰为 120，不是 4、也不是 32）', async () => {
  const N = JEV_MAX_CONCURRENCY_LIMIT
  const { svc, count, stop } = await mount({ maxConcurrency: N, sessionBudget: N * 2, cacheTtlSeconds: 0 })
  try {
    const stub = makeStub(noulReply(0.7))
    const outs = await svc.judgeFanout(
      Array.from({ length: N }, (_, i) => ({
        key: `f${i}`,
        state: `state-${i}`,
        question: '是否紧急？',
        sessionId: 'W12',
        apiKey: 'stub-key',
        fetchImpl: stub.fetchImpl,
      })),
    )
    assert.equal(outs.length, N, '扇出必须逐项返回（一项都不能少）')
    assert.equal(outs.filter((o) => o.degraded).length, 0, `120 项都不许降级：${outs.find((o) => o.degraded)?.reason}`)
    assert.equal(stub.peak(), N, `桩观测的在飞峰值必须恰为 ${N}（上限是装饰时会停在 4/32）实测 ${stub.peak()}`)
    assert.equal(svc.guardState().peakInFlight, N, '护栏自己的峰值读数必须与桩一致（两处互证）')
    assert.equal(svc.guardState().inFlight, 0, '跑完不得漏槽位')
    assert.equal(svc.guardState().waiting, 0, '跑完不得留排队者')
    assert.equal(count(), N, '逐项落痕：120 项必须恰 120 行')
  } finally {
    await stop()
  }
})

test('W1-2-5 槽位**移交**语义未变：释放时 inFlight 不减 ⇒ 不存在过订窗口（改成先减后加必红）', async () => {
  const guard = new JevGuard({ maxConcurrency: 2, sessionBudget: 100 })
  const r1 = await guard.begin()
  const r2 = await guard.begin()
  assert.equal(guard.snapshot().inFlight, 2, '两槽占满')

  let thirdGranted = false
  const third = guard.begin().then((rel) => {
    thirdGranted = true
    return rel
  })
  await sleep(5)
  assert.equal(thirdGranted, false, '满员时第三个必须排队（不得先授予）')
  assert.equal(guard.snapshot().waiting, 1)

  r1() // 释放 → **移交**给队首
  // ⚠ 紧随其后（同一 tick、队首的 continuation 还没跑）的新调用者：移交语义下它必须**排队**。
  //   若 #release 改成"先 inFlight-=1 再唤醒"，这里会看到空位而抢到槽位 ⇒ 峰值过订到 3。
  const fourth = guard.begin().then((rel) => rel)
  await sleep(5)
  assert.equal(thirdGranted, true, '释放必须把槽位移交给队首')
  assert.equal(guard.snapshot().inFlight, 2, '移交语义：inFlight 保持 2（先减后加会短暂降到 1 = 过订窗口）')
  assert.equal(guard.snapshot().waiting, 1, '新调用者必须排队（空位被移交给队首了）')
  assert.ok(guard.snapshot().peakInFlight <= 2, `峰值不得越过上限（过订窗口会把它顶到 3）：${guard.snapshot().peakInFlight}`)

  r2()
  const r4 = await fourth
  await sleep(5)
  assert.equal(guard.snapshot().inFlight, 2, '第四位被授予后仍不得越过上限')
  const r3 = await third
  r3()
  r4()
  await sleep(5)
  assert.equal(guard.snapshot().inFlight, 0, '全部释放后必须回到 0（无槽位泄漏）')
  assert.equal(guard.snapshot().waiting, 0)
})

// ── ③ 批次接口：一次请求塞 N 问（map 形态），逐问不丢 ─────────────────────────

test('W1-2-6 judgeBatch：一次请求带 50 问且**逐键对位**返回（多问不得被压成单问）', async () => {
  const { svc, stop } = await mount({ sessionBudget: 100 })
  try {
    const N = 50
    const questions = {}
    for (let i = 0; i < N; i += 1) questions[`q${i}`] = { type: 'noul', instructions: `第 ${i} 问` }
    const stub = makeStub(() => {
      const body = stub.lastBody()
      const answers = {}
      for (const k of Object.keys(body.questions)) answers[k] = { type: 'noul', noul: 0.5 + Object.keys(answers).length / 1000 }
      return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'typesafe/jev-1.13-20260917', answers }), json: async () => ({}) }
    })
    const out = await svc.judgeBatch({
      state: '批量态',
      question: '（批量主问回退文本）',
      questions,
      primaryQuestion: 'q7',
      sessionId: 'W12B',
      apiKey: 'stub-key',
      fetchImpl: stub.fetchImpl,
    })
    assert.equal(out.degraded, false, `批量判定不得降级：${out.reason}`)
    assert.equal(stub.calls.length, 1, '**一次**请求（不是 50 次往返）')
    const sent = stub.lastBody().questions
    assert.equal(Array.isArray(sent), false, 'questions 必须是**对象 map**（数组会被服务端 400）')
    assert.deepEqual(Object.keys(sent).sort(), Object.keys(questions).sort(), '50 个键必须一个不少地发出去')
    assert.equal(stub.lastBody().state, '批量态', 'state 必须原样发出去')
    assert.equal(Object.keys(out.answers ?? {}).length, N, `50 个答案必须一个不丢地回来（实测 ${Object.keys(out.answers ?? {}).length}）`)
    assert.equal(out.primaryQuestion, 'q7', '契约单值面必须取自显式声明的主问题')
    assert.equal(out.probability, out.answers.q7.noul, '契约概率必须等于主问题那一问的值')
    assert.equal(count_of_answers_ge(out, 50), true, '逐问取值都必须落在 [0,1]')
  } finally {
    await stop()
  }
})

/** 逐问取值必须都是合法概率（辅助断言，避免在测试体里写一长串内联）。 */
function count_of_answers_ge(out, n) {
  const vals = Object.values(out.answers ?? {})
  return vals.length === n && vals.every((a) => typeof a.noul === 'number' && a.noul >= 0 && a.noul <= 1)
}

test('W1-2-7 替身通道上的"批量"必须**显式降级**（绝不偷偷循环 N 次假装实现）', async () => {
  const { svc, count, stop } = await mount({ channel: 'ollama', sessionBudget: 50 })
  try {
    const stub = makeStub(ollamaReply(0.8))
    const out = await svc.judgeBatch({
      state: 'S',
      question: 'Q',
      questions: { a: { type: 'noul', instructions: 'A' }, b: { type: 'noul', instructions: 'B' } },
      fetchImpl: stub.fetchImpl,
    })
    assert.equal(out.degraded, true, '替身通道没有"一次多问"的语义 ⇒ 必须显式降级')
    assert.equal(out.reason, JEV_BATCH_CHANNEL_REASON, `降级原因必须可枚举：${out.reason}`)
    assert.equal(stub.calls.length, 0, '降级路径**不得**发请求，更不得循环 N 次偷偷实现')
    assert.equal(out.value, 'unknown', '降级必须给 unknown（不得默认 no）')
    assert.equal(out.probability, null, '降级概率必须是 null（不得用 0 冒充）')
    assert.equal(count(), 1, '降级同样要留痕（A1-14：沉默地不判可以，但必须留一行）')
  } finally {
    await stop()
  }
})

// ── ④ 扇出：逐项归因 + 部分失败不中断整批 ────────────────────────────────────

test('W1-2-8 扇出：一项失败不拖垮整批，且每项与自己的落痕行**逐键对位**', async () => {
  const { svc, ids, rows, count, stop } = await mount({ maxConcurrency: 8, sessionBudget: 100, cacheTtlSeconds: 0 })
  try {
    // 第 2 项抛网络错误（判据夹具造的**瞬时故障**）、第 4 项 500 —— 两种失败形态都必须只落在自己头上
    const keys = ['k0', 'k1', 'k2', 'k3', 'k4']
    // ⚠ 按**请求内容**决定行为（state 里带项键），不按 fetch 序号 —— 并发下序号与项无关。
    const stub = makeStub((_n, call) => {
      if (call.body.state === 'st-k1') return new Error('fixture-transient-network-error')
      if (call.body.state === 'st-k3') return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }
      return noulReply(0.9)
    })
    const outs = await svc.judgeFanout(
      keys.map((k) => ({
        key: k,
        state: `st-${k}`,
        question: 'Q',
        sessionId: 'W12F',
        apiKey: 'stub-key',
        fetchImpl: stub.fetchImpl,
      })),
    )
    assert.equal(outs.length, keys.length, '部分失败不得让整批变短')
    assert.deepEqual(outs.map((o) => o.requestId), keys, '结果必须与入参**逐键对位**（不得按到达顺序重排）')
    assert.deepEqual(
      outs.map((o) => o.degraded),
      [false, true, false, true, false],
      '只有第 2/4 项降级，其余三项必须照常成功（一项失败不得传染整批）',
    )
    // ⚠ 前缀是 **systemone-**（缺省腿是真通道）：前缀把"哪条通道出的问题"编码进 reason，
    //   判据必须按真通道的前缀断言 —— 写成 ollama-* 会让"通道串了"这件事反过来被通过。
    assert.ok(String(outs[1].reason).startsWith('systemone-request-failed'), `瞬时网络错误的原因必须可枚举：${outs[1].reason}`)
    assert.ok(String(outs[3].reason).startsWith('systemone-http-error'), `500 的原因必须可枚举：${outs[3].reason}`)
    // ⚠ 比**集合**不比顺序：并发下写入顺序本就按完成时刻排列，断言顺序等于在断言调度细节
    //   （那是抖动，不是判据）。这里要的是"每项恰一行、无重无漏"。
    assert.deepEqual(ids().slice().sort(), keys.slice().sort(), '逐项落痕：每项恰一行，行的 id 与项键一一对应（无重无漏）')
    assert.equal(count(), keys.length)
    const byId = new Map(rows().map((r) => [r.id, r]))
    assert.equal(byId.get('k1').degraded, 1, '失败项那一行必须记成 degraded')
    assert.equal(byId.get('k0').degraded, 0, '成功项那一行不得被邻居带成 degraded')
  } finally {
    await stop()
  }
})

test('W1-2-9 扇出兜底：驱动**在护栏之外**抛错时也只降级该项（带上可枚举前缀），其余项照常', async () => {
  const { svc, count, stop } = await mount({ maxConcurrency: 4, sessionBudget: 20 })
  try {
    const out = await svc.judgeFanout([
      { key: 'g0', state: 's0', question: 'Q', sessionId: 'W12G', judgeFn: async () => noulReplyResult(0.6) },
      {
        key: 'g1',
        state: 's1',
        question: 'Q',
        sessionId: 'W12G',
        judgeFn: async () => {
          throw new Error('driver-exploded')
        },
      },
    ])
    assert.equal(out.length, 2)
    assert.equal(out[0].degraded, false, `邻居不得被带坏：${out[0].reason}`)
    assert.equal(out[1].degraded, true, '抛错的那一项必须转成**该项**的降级')
    assert.ok(String(out[1].reason).startsWith('jev-fanout-item-threw'), `兜底原因必须可枚举且**不像**模型面故障：${out[1].reason}`)
    assert.equal(count(), 2, '兜底那一项同样留痕（不得沉默）')
  } finally {
    await stop()
  }
})

/** 判定函数的正常返回（给"驱动抛错"那条对照用；形状与 `JevJudgeOutcome` 一致）。 */
function noulReplyResult(p) {
  return {
    requestId: 'stub',
    requestType: 'jev',
    source: 'stub-judge',
    value: 'yes',
    probability: p,
    degraded: false,
    reason: null,
    stateHash: 'stub',
    candidates: [],
    normalization: null,
    latencyMs: 0,
    model: 'stub',
    endpoint: 'stub',
    atIso: new Date(0).toISOString(),
    traceError: null,
  }
}
