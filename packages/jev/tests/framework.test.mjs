/**
 * dsh-mana-jev · B1.3 判据 —— **模型无关的功能框架**（缓存 / 熔断 / 冷却半开 / 并发 / 预算）。
 *
 * ## 本文件的核心纪律：**零网络**
 * 全部判定都走 `judgeWithGuard` 的**注入接缝**（`fetchImpl` 桩 + `now()` 假时钟 +
 * `idFactory`），**没有任何一条**用例去连真 Ollama 端点（端点字面量在本文件里也不出现，
 * 交给 `tests/gate.mjs` 静态核）。
 * ⇒ 拔掉 Ollama 后本文件仍应全绿 —— 这是「框架好不好」与「模型好不好」**解耦**的唯一硬证据。
 * （上一轮 11 条判据把它们绑在一起：模型一换就红，框架的缺陷被模型的缺陷盖住。）
 *
 * ## 时间量一律用**注入时钟**推进
 * TTL 299s/301s、冷却 59s/60s 都是 `clock.set(...)` 跳过去的，**不写** `setTimeout(300_000)`。
 *
 * ## 每条护栏路径都必须留痕（A1-14 / G8）
 * 缓存命中、熔断拒绝、半开已有试探、超预算、等槽超时 —— 五条**都不是**「什么都没发生」：
 * 各写一行 `jev_log`（`degraded=1` 或 `cached=1`）。F16 用**计数守恒**兜住这一条：
 * 调用 N 次 ⇒ 恰好 N 行，既不许有沉默分支，也不许重复落痕。
 *
 * ⚠ 本文件**不碰**模型适配面：不换模型、不调提示词、不追概率质量。
 *   桩返回的 logprob 是**判据自己的输入**，不是对模型质量的任何主张。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const FW = new URL('../src/framework.ts', import.meta.url).href
const CHECKS = new URL('./gate-checks.mjs', import.meta.url).href
const { checkConfigConsumed } = await import(CHECKS)
const { readFileSync } = await import('node:fs')

const {
  JevGuard,
  judgeWithGuard,
  cacheKey,
  JEV_GUARD_REASONS,
  JEV_UNSCOPED_SESSION,
} = await import(FW)
const { stateHash } = await import(new URL('../src/ollama.ts', import.meta.url).href)

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

// ── 共享夹具（全部离线）─────────────────────────────────────────────────────

/** 假时钟起点：固定值 ⇒ 判据可复现，不用「现在」。 */
const T0 = Date.UTC(2026, 8, 24, 12, 0, 0)

function makeClock(startMs = T0) {
  let ms = startMs
  return {
    now: () => new Date(ms),
    set: (v) => {
      ms = v
    },
    advance: (d) => {
      ms += d
    },
    ms: () => ms,
  }
}

/** 造一个「像真 Ollama 单 token 返回」的 200 响应（夹具，不是对模型能力的主张）。 */
const okResponse = (pYes) =>
  new Response(
    JSON.stringify({
      message: { role: 'assistant', content: 'yes' },
      logprobs: [{ token: 'yes', logprob: Math.log(pYes), top_logprobs: [
        { token: 'yes', logprob: Math.log(pYes) },
        { token: 'no', logprob: Math.log(1 - pYes) },
      ] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

/** 故障响应（→ `ollama-http-error`，即一条**降级**）。 */
const failResponse = () => new Response('boom', { status: 500 })

/** 200 但 pos0 无 yes/no 族（→ `ollama-no-yes-no-token`，同样是降级）。 */
const noTokenResponse = () =>
  new Response(
    JSON.stringify({
      message: { role: 'assistant', content: '<think>' },
      logprobs: [{ token: '<think>', logprob: -0.1, top_logprobs: [{ token: '<think>', logprob: -0.1 }] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

/**
 * fetch 桩：记录**调用次数**，并记录**同时在飞峰值**（并发判据的可数断言对象）。
 * `set(fn)` 可中途换行为 —— 用于「先失败 5 次打开熔断，再让试探成功」这类序列。
 */
function makeFetch(behavior) {
  const calls = []
  let cur = behavior
  let inFlight = 0
  let peak = 0
  return {
    calls,
    peak: () => peak,
    set: (fn) => {
      cur = fn
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      try {
        return await cur(calls.length)
      } finally {
        inFlight -= 1
      }
    },
  }
}

/**
 * 可复现 id（避免随机 uuid 污染对账）。
 *
 * ⚠ 必须是**全局单调**计数器：判据第一版把它写成"每次 run() 都新建一个从 1 开始的计数器"，
 *   `jev_log.id` 是主键 ⇒ 第 2 行起主键冲突 ⇒ `writeJevLog` 抛错 ⇒ 落痕只成功 1 行。
 *   缺陷是被「行数守恒」断言抓到的（不是看代码看出来的），教训留此。
 */
let idSeq = 0
const nextId = () => `req-${++idSeq}`

/** 临时库（schema 取自 core 的 `createSchema`，与生产库同一份 DDL；**绝不指向 $DSH_HOME**）。 */
async function tempDb() {
  const core = await import(new URL('../../core/src/index.ts', import.meta.url).href)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-fw-'))
  dirs.push(dir)
  const db = new DatabaseSync(join(dir, 'mana.db'))
  core.createSchema(db)
  const rows = () => db.prepare('SELECT cached, degraded, result_value FROM jev_log ORDER BY rowid').all()
  const count = () => Number(db.prepare('SELECT count(*) c FROM jev_log').get().c)
  return { db, count, all: rows, close: () => db.close() }
}

/** 一次带护栏判定（默认带 db ⇒ 落痕可数）。 */
const run = (guard, over = {}) =>
  judgeWithGuard({ state: 'S', question: 'Q', guard, idFactory: nextId, ...over })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── ① 缓存（TTL 300s）──────────────────────────────────────────────────────

test('F1 缓存：同 state_hash+question 在 299s 内命中、301s 过期未命中；cached 列 0→1；命中同样留痕', async (t) => {
  const clock = makeClock()
  const { db, count, all, close } = await tempDb()
  try {
    const stub = makeFetch(() => okResponse(0.8))
    const guard = new JevGuard({ cacheTtlSeconds: 300, sessionBudget: 100 }, clock.now)
    const opts = { guard, db, fetchImpl: stub.fetchImpl, now: clock.now }

    const first = await run(guard, opts)
    assert.equal(first.fromCache, false, '首次必须未命中')
    assert.equal(first.degraded, false, `首次不得降级：${first.reason}`)
    assert.equal(stub.calls.length, 1, '首次必须真打一次模型')

    clock.set(T0 + 299_000)
    const second = await run(guard, opts)
    assert.equal(second.fromCache, true, '注入时钟推进 299s（< TTL 300s）必须命中缓存')
    assert.equal(stub.calls.length, 1, '命中不得再打模型 —— 否则缓存是空的')
    assert.equal(second.value, first.value, '命中值必须与首次一致')
    assert.ok(Math.abs(second.probability - first.probability) <= 1e-9, '命中概率必须与首次一致（A 档）')
    assert.equal(second.degraded, false, '命中不是降级')

    clock.set(T0 + 301_000)
    const third = await run(guard, opts)
    assert.equal(third.fromCache, false, '注入时钟推进 301s（> TTL 300s）必须过期未命中')
    assert.equal(stub.calls.length, 2, '过期后必须再去问模型')

    assert.equal(count(), 3, '三次调用三次留痕（命中也是调用，A1-14）')
    assert.deepEqual(
      all().map((r) => r.cached),
      [0, 1, 0],
      'jev_log.cached 必须真实反映命中（B1.2 时该列恒 0 —— 这列是不是活的，靠这一行证据）',
    )
    assert.deepEqual(all().map((r) => r.degraded), [0, 0, 0], '三条都是正常判定')
    t.diagnostic(`[F1] fetch 调用 ${stub.calls.length} 次 / jev_log ${count()} 行（cached=0,1,0）`)
  } finally {
    close()
  }
})

test('F2 缓存键含 question：同 state 不同 question 不得互相当作命中', async () => {
  const clock = makeClock()
  const stub = makeFetch(() => okResponse(0.8))
  const guard = new JevGuard({ cacheTtlSeconds: 300 }, clock.now)
  const base = { guard, fetchImpl: stub.fetchImpl, now: clock.now }

  await run(guard, { ...base, state: 'S', question: 'Q1' })
  const other = await run(guard, { ...base, state: 'S', question: 'Q2' })
  assert.equal(other.fromCache, false, '同 state 但 question 不同 ⇒ 不得命中（方案 §6.4 是 "state hash + question"）')
  assert.equal(stub.calls.length, 2)
})

test('F3 TTL=0 ⇒ 缓存结构性失效（同一毫秒的第二次调用也必须再问模型）', async () => {
  const clock = makeClock()
  const stub = makeFetch(() => okResponse(0.8))
  const guard = new JevGuard({ cacheTtlSeconds: 0 }, clock.now)
  const opts = { guard, fetchImpl: stub.fetchImpl, now: clock.now }
  const a = await run(guard, opts)
  const b = await run(guard, opts)
  assert.equal(a.fromCache, false)
  assert.equal(b.fromCache, false, 'TTL=0 必须让缓存**结构性**失效（不是"看起来有缓存"）')
  assert.equal(stub.calls.length, 2)
  // TTL=0 的正确口径：**存**仍发生，但任何一次 `lookup` 都必须判定过期并顺带清除
  // （不能靠"看起来有缓存"糊过去；也不能因为过期就不写，否则同一批内的第二次也失去意义）
  assert.equal(guard.cacheLookup(cacheKey(stateHash('S'), 'Q'), clock.now().getTime() + 1), null, 'TTL=0 ⇒ 1ms 后必须 miss')
  assert.equal(guard.cacheSize(), 0, '过期即清：lookup 之后不得留下命中不了的残留项')
})

// ── ②③ 熔断 + 冷却半开 ────────────────────────────────────────────────────

/** 造出「已打开」态：连续 N 次真失败。返回 stub 与 guard。 */
async function openBreaker(n = 5, cfg = {}) {
  const clock = makeClock()
  const stub = makeFetch(() => failResponse())
  const guard = new JevGuard({ circuitBreakerFailures: n, circuitBreakerCooldownSeconds: 60, ...cfg }, clock.now)
  for (let i = 1; i <= n; i += 1) {
    const out = await run(guard, { guard, state: `fail-${i}`, fetchImpl: stub.fetchImpl, now: clock.now })
    assert.equal(out.degraded, true, `第 ${i} 次故障必须降级：${out.reason}`)
    assert.ok(
      String(out.reason).startsWith('ollama-'),
      `模型面故障的 reason 必须保持 ollama- 前缀（不许被框架改写）：实测 ${out.reason}`,
    )
  }
  return { clock, stub, guard }
}

test('F4 熔断：连续 5 次失败才打开（第 4 次仍 closed）；打开后第 6 次直接拒绝且不打模型', async (t) => {
  const { db, count, close } = await tempDb()
  try {
    const clock = makeClock()
    const stub = makeFetch(() => failResponse())
    const guard = new JevGuard({ circuitBreakerFailures: 5, circuitBreakerCooldownSeconds: 60, sessionBudget: 100 }, clock.now)
    const opts = (i) => ({ guard, db, state: `s${i}`, fetchImpl: stub.fetchImpl, now: clock.now })

    for (let i = 1; i <= 4; i += 1) {
      await run(guard, opts(i))
      assert.equal(guard.circuitState(), 'closed', `第 ${i} 次失败后仍必须是 closed（阈值是 5，不是 4）`)
      assert.equal(guard.snapshot().failures, i, '连续失败计数必须可枚举')
    }
    await run(guard, opts(5))
    assert.equal(guard.circuitState(), 'open', '第 5 次失败后必须打开')

    const rejected = await run(guard, opts(6))
    assert.equal(rejected.reason, JEV_GUARD_REASONS.circuitOpen, `拒绝原因必须可枚举：${rejected.reason}`)
    assert.equal(rejected.value, 'unknown', '被熔断拒绝 ⇒ unknown，不得默认成 no')
    assert.equal(rejected.probability, null, '拒给不了概率 ⇒ null，不得用 0 冒充')
    assert.equal(rejected.degraded, true)
    assert.equal(rejected.circuitState, 'open', '返回值里必须带上熔断态（可枚举字段，不是日志文案）')
    assert.equal(stub.calls.length, 5, '打开后**不得再打模型**（熔断若还打模型就是装饰品）')

    assert.equal(count(), 6, '被拒的那次同样留痕（沉默地不判，但必须留痕）')
    t.diagnostic(`[F4] failures=${guard.snapshot().failures} state=${guard.circuitState()} fetch=${stub.calls.length} rows=${count()}`)
  } finally {
    close()
  }
})

test('F5 熔断：中途成功一次即清零（4 次失败 + 1 次成功 + 4 次失败 ⇒ 仍 closed）', async () => {
  const clock = makeClock()
  const stub = makeFetch(() => failResponse())
  const guard = new JevGuard({ circuitBreakerFailures: 5 }, clock.now)
  for (let i = 0; i < 4; i += 1) await run(guard, { guard, state: `f${i}`, fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(guard.snapshot().failures, 4)

  stub.set(() => okResponse(0.9))
  const ok = await run(guard, { guard, state: 'ok', fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(ok.degraded, false)
  assert.equal(guard.snapshot().failures, 0, '成功必须把连续失败清零（"连续"二字的判据）')

  stub.set(() => failResponse())
  for (let i = 0; i < 4; i += 1) await run(guard, { guard, state: `g${i}`, fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(guard.circuitState(), 'closed', '清零后再 4 次失败仍不得打开')
})

test('F6 冷却/半开：59s 仍 open（且拒绝）、60s 转 half-open 放行一次试探、试探成功即 closed', async (t) => {
  const { clock, stub, guard } = await openBreaker(5)
  assert.equal(guard.circuitState(), 'open')

  clock.set(T0 + 59_000)
  assert.equal(guard.circuitState(), 'open', '冷却 59s（< 60s）必须仍为 open')
  const early = await run(guard, { guard, state: 'early', fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(early.reason, JEV_GUARD_REASONS.circuitOpen)
  assert.equal(stub.calls.length, 5, '冷却未到不得放行试探')

  clock.set(T0 + 60_000)
  assert.equal(guard.circuitState(), 'half-open', '冷却 60s 到点必须转 half-open（不是仍 open）')

  stub.set(() => okResponse(0.7))
  const probe = await run(guard, { guard, state: 'probe', fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(probe.degraded, false, `半开试探必须真被放行：${probe.reason}`)
  assert.equal(stub.calls.length, 6, '试探必须真打一次模型（否则"半开"是假的）')
  assert.equal(guard.circuitState(), 'closed', '试探成功 ⇒ 关闸恢复')
  assert.equal(guard.snapshot().failures, 0)
  t.diagnostic(`[F6] 59s=open / 60s=half-open / 试探成功=${probe.value} → closed`)
})

test('F7 冷却：半开试探**失败** ⇒ 重新打开，且冷却**重新计时**（不是停在旧时刻）', async () => {
  const { clock, guard, stub } = await openBreaker(5)
  clock.set(T0 + 60_000)
  assert.equal(guard.circuitState(), 'half-open')

  const T1 = clock.ms()
  const probe = await run(guard, { guard, state: 'probe-fail', fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(probe.degraded, true)
  assert.equal(guard.circuitState(), 'open', '试探失败必须重新打开')

  clock.set(T1 + 59_000)
  assert.equal(guard.circuitState(), 'open', '失败时刻起重新计时：59s 仍须 open')
  clock.set(T1 + 60_000)
  assert.equal(guard.circuitState(), 'half-open', '失败时刻起 60s 才可再次试探（用 === 而非 >= 的实现会在这里卡死为 half-open）')
})

test('F8 半开单探针闸：冷却到点后**只放行一个**试探，其余拒绝且不打模型（可枚举 reason）', async () => {
  const { clock, guard, stub } = await openBreaker(5)
  clock.set(T0 + 60_000)
  assert.equal(guard.circuitState(), 'half-open')

  const before = stub.calls.length
  stub.set(async () => {
    await sleep(15)
    return okResponse(0.6)
  })
  const outs = await Promise.all(
    ['a', 'b', 'c'].map((s) => run(guard, { guard, state: s, fetchImpl: stub.fetchImpl, now: clock.now })),
  )
  const probed = outs.filter((o) => !o.degraded)
  const gated = outs.filter((o) => o.reason === JEV_GUARD_REASONS.circuitProbeInFlight)
  assert.equal(probed.length, 1, `半开态只许 1 个试探在飞，实测 ${probed.length}`)
  assert.equal(gated.length, 2, `其余必须被单探针闸拦下并给出可枚举 reason，实测 ${JSON.stringify(outs.map((o) => o.reason))}`)
  assert.equal(stub.calls.length, before + 1, '被拦下的那两个不得打模型（否则熔断等于白开）')
  assert.equal(guard.circuitState(), 'closed', '成功试探后关闸')
  assert.equal(guard.snapshot().probeInFlight, 0, '试探计数必须归零（否则半开闸永久卡死）')
})

// ── ④ 全局并发上限 ────────────────────────────────────────────────────────

test('F9 并发：maxConcurrency=4 ⇒ 桩观测的在飞峰值**恰为 4**；结束后无槽位泄漏', async (t) => {
  const { db, close } = await tempDb()
  try {
    let inFlight = 0
    let peak = 0
    const fetchImpl = async () => {
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      await sleep(20)
      inFlight -= 1
      return okResponse(0.6)
    }
    const guard = new JevGuard({ maxConcurrency: 4, sessionBudget: 100 }, () => new Date())
    const outs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => run(guard, { guard, db, state: `c${i}`, fetchImpl })),
    )
    assert.equal(peak, 4, `同时在上界的在飞峰值必须恰为 4（实测 ${peak}）—— 断言"≤4"而不给下界会让"根本没并发"也通过`)
    assert.equal(guard.snapshot().peakInFlight, 4, '护栏自己的峰值读数必须与桩一致')
    assert.equal(guard.snapshot().inFlight, 0, '全部完成后在飞数必须归零（槽位泄漏 = 之后全部卡死）')
    assert.equal(guard.snapshot().waiting, 0, '不得留下无人认领的排队者')
    assert.equal(outs.filter((o) => o.degraded).length, 0, '等候者都必须最终拿到槽位（默认永久等待）')
    assert.equal(outs.length, 10)
    t.diagnostic(`[F9] 峰值=${peak} 上限=${guard.snapshot().config.maxConcurrency} 完成=${outs.length}`)
  } finally {
    close()
  }
})

test('F10 并发：等槽超时 ⇒ 可枚举 reason + 仍留痕（不引入"无声挂起"这一新失败模式）', async () => {
  const { db, count, close } = await tempDb()
  try {
    const guard = new JevGuard({ maxConcurrency: 1, sessionBudget: 100 }, () => new Date())
    guard.setWaitTimeoutMs(10)
    const slow = async () => {
      await sleep(60)
      return okResponse(0.6)
    }
    const holder = run(guard, { guard, db, state: 'hold', fetchImpl: slow })
    await sleep(5)
    const waiter = await run(guard, { guard, db, state: 'wait', fetchImpl: slow })
    assert.equal(waiter.reason, JEV_GUARD_REASONS.concurrencyTimeout, `实测 reason=${waiter.reason}`)
    assert.equal(waiter.degraded, true)
    assert.equal(waiter.value, 'unknown')
    await holder
    assert.equal(count(), 2, '超时那次同样留痕（否则"为什么没判定"永远查不出来）')
  } finally {
    close()
  }
})

// ── ⑤ 每 session 预算 ─────────────────────────────────────────────────────

test('F11 预算：session 上限 3 ⇒ 第 4 次拒绝；**按 session 分桶**；拒绝同样留痕', async (t) => {
  const { db, count, close } = await tempDb()
  try {
    const stub = makeFetch(() => okResponse(0.8))
    const guard = new JevGuard({ sessionBudget: 3 }, () => new Date())
    const opts = (over) => ({ guard, db, fetchImpl: stub.fetchImpl, ...over })

    for (let i = 1; i <= 3; i += 1) {
      const out = await run(guard, opts({ state: `s${i}`, sessionId: 'A' }))
      assert.equal(out.degraded, false, `预算内第 ${i} 次必须正常判定：${out.reason}`)
      assert.equal(out.sessionSpend, i, '消耗计数必须可枚举且逐步递增')
    }
    const fourth = await run(guard, opts({ state: 's4', sessionId: 'A' }))
    assert.equal(fourth.reason, JEV_GUARD_REASONS.sessionBudgetExceeded, `实测 reason=${fourth.reason}`)
    assert.equal(fourth.value, 'unknown')
    assert.equal(stub.calls.length, 3, '超预算不得打模型')

    const other = await run(guard, opts({ state: 's5', sessionId: 'B' }))
    assert.equal(other.degraded, false, '另一个 session 的预算必须独立（"每 session"三字的判据）')
    assert.equal(other.sessionSpend, 1, 'B 桶从 1 开始')

    assert.equal(guard.sessionSpend('A'), 3)
    assert.equal(guard.sessionSpend(undefined), 0, `未带 sessionId 的调用归到显式桶 ${JEV_UNSCOPED_SESSION}`)
    assert.equal(count(), 5, '5 次调用 5 行痕（含被拒的那次）')

    const rows = db
      .prepare("SELECT degraded, result_value FROM jev_log WHERE session_id = 'A' ORDER BY rowid")
      .all()
    assert.equal(rows.length, 4)
    assert.deepEqual(rows.map((r) => r.degraded), [0, 0, 0, 1], '第 4 行必须标 degraded=1（拒绝留了痕）')
    assert.equal(rows[3].result_value, 'unknown')
    t.diagnostic(`[F11] A 桶 3/3 后拒绝；B 桶独立；rows=${count()}`)
  } finally {
    close()
  }
})

test('F12 预算=0 ⇒ 每次都拒（配置项"关掉"的可观测差异）；resetSession 后可放行一次', async () => {
  const guard = new JevGuard({ sessionBudget: 0 }, () => new Date())
  const stub = makeFetch(() => okResponse(0.8))
  const first = await run(guard, { guard, state: 'z', fetchImpl: stub.fetchImpl })
  assert.equal(first.reason, JEV_GUARD_REASONS.sessionBudgetExceeded)
  assert.equal(stub.calls.length, 0, '预算 0 ⇒ 一次模型调用都不许发生')
  assert.equal(guard.snapshot().config.sessionBudget, 0, '生效配置必须可读（假旋钮的第一道反证）')

  // ⚠ 预算=0 时 `reset` **不该**解锁：`used(0) >= budget(0)` 恒真 ⇒ 0 就是"全程关闸"。
  //   （判据第一版把 reset 当成解锁器，被这条断言拦下 —— 记在这里以免后人重犯。）
  guard.resetSession()
  const stillClosed = await run(guard, { guard, state: 'z2', fetchImpl: stub.fetchImpl })
  assert.equal(stillClosed.reason, JEV_GUARD_REASONS.sessionBudgetExceeded, '预算 0 ⇒ reset 也不得放行')
  assert.equal(stub.calls.length, 0)

  // reset 的真实语义用**非零预算**验证：耗尽 → 拒绝；reset → 放行
  const g2 = new JevGuard({ sessionBudget: 1 }, () => new Date())
  const o1 = await run(g2, { guard: g2, state: 'a', sessionId: 'X', fetchImpl: stub.fetchImpl })
  assert.equal(o1.degraded, false)
  const o2 = await run(g2, { guard: g2, state: 'b', sessionId: 'X', fetchImpl: stub.fetchImpl })
  assert.equal(o2.reason, JEV_GUARD_REASONS.sessionBudgetExceeded)
  g2.resetSession('X')
  const o3 = await run(g2, { guard: g2, state: 'c', sessionId: 'X', fetchImpl: stub.fetchImpl })
  assert.equal(o3.degraded, false, 'reset 后必须放行（新的一轮预算）')
})

// ── 接缝与留痕计数（结构性兜底）───────────────────────────────────────────

test('F13 熔断开时缓存仍可服务：命中路径不碰模型 ⇒ 断路器**未被绕过**（fetch 计数不变）', async () => {
  const clock = makeClock()
  const stub = makeFetch(() => okResponse(0.85))
  const guard = new JevGuard({ circuitBreakerFailures: 5, cacheTtlSeconds: 300, sessionBudget: 100 }, clock.now)

  const warm = await run(guard, { guard, state: 'W', question: 'Q', fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(warm.degraded, false)

  stub.set(() => failResponse())
  for (let i = 0; i < 5; i += 1) {
    await run(guard, { guard, state: `x${i}`, fetchImpl: stub.fetchImpl, now: clock.now })
  }
  assert.equal(guard.circuitState(), 'open')

  const callsBefore = stub.calls.length
  const cached = await run(guard, { guard, state: 'W', question: 'Q', fetchImpl: stub.fetchImpl, now: clock.now })
  assert.equal(cached.fromCache, true, '熔断开时，已有的缓存结果仍应可服务（代价 0 次模型调用）')
  assert.equal(cached.value, warm.value)
  assert.equal(stub.calls.length, callsBefore, '命中路径**不得**打模型 —— 否则熔断被缓存路径绕过')
})

test('F16 留痕计数守恒：N 次调用恰好 N 行 —— 无沉默分支、无重复落痕', async (t) => {
  const { db, count, close } = await tempDb()
  try {
    const clock = makeClock()
    const stub = makeFetch(() => failResponse())
    const guard = new JevGuard({ circuitBreakerFailures: 2, circuitBreakerCooldownSeconds: 30, cacheTtlSeconds: 300 }, clock.now)
    const opts = (state) => ({ guard, db, state, fetchImpl: stub.fetchImpl, now: clock.now })

    const seq = [await run(guard, opts('a')), await run(guard, opts('b')), await run(guard, opts('c'))] // 2 次失败 → 打开，第 3 次被拒
    assert.equal(seq[2].reason, JEV_GUARD_REASONS.circuitOpen)
    clock.advance(30_000)
    stub.set(() => okResponse(0.9))
    const probe = await run(guard, opts('d')) // 半开试探成功
    assert.equal(probe.degraded, false)
    const cached = await run(guard, opts('d')) // 同键命中
    assert.equal(cached.fromCache, true)

    assert.equal(count(), 5, '5 次调用必须恰好 5 行（少一行 = 有沉默路径；多一行 = 重复落痕）')
    const rows = db.prepare('SELECT cached, degraded, result_value FROM jev_log ORDER BY rowid').all()
    assert.deepEqual(rows.map((r) => [r.cached, r.degraded, r.result_value]), [
      [0, 1, 'unknown'],
      [0, 1, 'unknown'],
      [0, 1, 'unknown'],
      [0, 0, 'yes'],
      [1, 0, 'yes'],
    ])
    t.diagnostic(`[F16] 5 次调用 → ${count()} 行（含 1 次熔断拒绝 + 1 次缓存命中）`)
  } finally {
    close()
  }
})

// ── 装配面：配置项是否**真被消费**（假旋钮的反证）─────────────────────────
//
// ⚠ 这一节把「配置项被读」与「配置项被用」分开证：
//   ① `guardState().config` 逐项等于传入值 —— 读到了；
//   ② 同一份配置**通过服务面**跑一次真判定，桩观测到的并发峰值恰为配置值 —— 用上了。
// 只做①等于只证"旋钮接上了线"；只做②无法分辨是哪个旋钮在起作用。两条都要。

test('F14/F15 装配面：apply(config) 六项配置真被消费（guardState 逐项对账 + 并发上限端到端生效）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(new URL('../../core/src/index.ts', import.meta.url).href)
  const jevMod = await import(new URL('../src/index.ts', import.meta.url).href)

  // 回归自检：既有骨架形状**不得**因本批改动而失效
  assert.equal(jevMod.name, 'mana-jev', 'name 不得变')
  assert.deepEqual(jevMod.inject, ['mana-core'], 'inject 不得变')

  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-cfg-'))
  dirs.push(dir)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await sleep(150)

  const CFG = {
    cacheTtlSeconds: 7,
    circuitBreakerFailures: 3,
    circuitBreakerCooldownSeconds: 11,
    maxConcurrency: 2,
    sessionBudget: 5,
    concurrencyWaitTimeoutMs: 0,
    // ⚠ W1-2：**显式**声明替身通道。本节判的是**护栏**（与通道无关），而夹具是 Ollama
    //   单 token 形状（okResponse 带 logprobs）。W1-2 起插件缺省通道已是 systemone（真 JEV）
    //   ⇒ 不写这一行时，驱动与桩形状不匹配、且无 key ⇒ 每次判定都在**进护栏之前**降级，
    //   观测到的峰值恒 0（实测：期望 2 / 实际 0）。那会让"护栏失效"与"通道没配"互相遮蔽。
    //   ⚠ 这里**只声明通道**：护栏语义与全部断言一字未改。
    channel: 'ollama',
  }
  ctx.plugin(jevMod, CFG)
  await sleep(300)

  const svc = ctx.get('mana-jev')
  assert.ok(svc, 'mana-jev 服务必须可读')
  assert.equal(svc.status().wired, true, 'status().wired 必须仍为 true（骨架判据不得失效）')

  // ① 读到了：六项逐项对账（五项在 config 里，等待超时是独立读数）
  const snap = svc.guardState()
  assert.deepEqual(
    snap.config,
    {
      cacheTtlSeconds: CFG.cacheTtlSeconds,
      circuitBreakerFailures: CFG.circuitBreakerFailures,
      circuitBreakerCooldownSeconds: CFG.circuitBreakerCooldownSeconds,
      maxConcurrency: CFG.maxConcurrency,
      sessionBudget: CFG.sessionBudget,
    },
    '生效配置必须逐项等于装配传入值（`void config` 时代这里全是缺省值）',
  )
  assert.equal(snap.waitTimeoutMs, CFG.concurrencyWaitTimeoutMs, 'concurrencyWaitTimeoutMs 也必须真被消费')

  // ② 用上了：并发上限 2 通过**服务面**产生可观测差异（桩峰值）
  let inFlight = 0
  let peak = 0
  const fetchImpl = async () => {
    inFlight += 1
    if (inFlight > peak) peak = inFlight
    await sleep(20)
    inFlight -= 1
    return okResponse(0.75)
  }
  const outs = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      svc.judgeGuarded({ state: `svc-${i}`, question: 'q', sessionId: 'S', fetchImpl }),
    ),
  )
  assert.equal(peak, 2, `服务面观测到的在飞峰值必须恰为配置的 2（实测 ${peak}）`)
  assert.equal(svc.guardState().peakInFlight, 2)
  assert.equal(outs.filter((o) => o.degraded).length, 0, `concurrencyWaitTimeoutMs=0 应表示永久等待：${outs.map((o) => o.reason)}`)
  assert.equal(outs.length, 5)

  const rows = Number(ctx.get('mana-core').db.prepare('SELECT count(*) c FROM jev_log').get().c)
  assert.equal(rows, 5, '服务面 5 次调用必须落 5 行（库句柄来自 core）')
  t.diagnostic(`[F14/F15] config 逐项对账通过；并发峰值=${peak}；jev_log=${rows} 行`)
  await ctx.stop?.()
})

/**
 * 装一次真 `Context`（core + jev），返回服务面与库读数。
 * **每个配置键各有一条判据**，都经此装配 —— 不许再出现"整轮只有一条防线"。
 */
async function mountJev(cfg) {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(new URL('../../core/src/index.ts', import.meta.url).href)
  const jevMod = await import(new URL('../src/index.ts', import.meta.url).href)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-key-'))
  dirs.push(dir)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await sleep(150)
  // ⚠ W1-2：缺省通道已是 systemone（真 JEV）⇒ 本节的替身形状桩必须**显式**声明 ollama 腿。
  //   理由同 F14/F15 的长注：不然 8 条护栏判据会被"通道没配"遮蔽（看起来像护栏失效）。
  ctx.plugin(jevMod, { channel: 'ollama', ...cfg })
  await sleep(300)
  const svc = ctx.get('mana-jev')
  assert.ok(svc, 'mana-jev 服务必须可读')
  const rows = () => Number(ctx.get('mana-core').db.prepare('SELECT count(*) c FROM jev_log').get().c)
  return { ctx, svc, rows, stop: () => ctx.stop?.() }
}

/** 带在飞计数的 fetch 桩（装配面判据共用）。 */
function countingFetch(okPYes = 0.7, delayMs = 5) {
  let inFlight = 0
  let peak = 0
  return {
    peak: () => peak,
    fetchImpl: async () => {
      inFlight += 1
      if (inFlight > peak) peak = inFlight
      await sleep(delayMs)
      inFlight -= 1
      return okResponse(okPYes)
    },
  }
}

test('F17 护栏不偷改模型面：正常判定的 value/probability 与纯原语逐字一致（缓存只复制、不重算）', async () => {
  const { judgeWithOllama } = await import(new URL('../src/ollama.ts', import.meta.url).href)
  const clock = makeClock()
  const stub = makeFetch(() => okResponse(0.62))
  const guard = new JevGuard({ cacheTtlSeconds: 300 }, clock.now)
  const args = { state: 'S', question: 'Q', fetchImpl: stub.fetchImpl, now: clock.now, idFactory: nextId }

  const bare = await judgeWithOllama({ ...args, db: undefined })
  const guarded = await run(guard, { ...args, guard })
  assert.equal(guarded.value, bare.value, '护栏不得改变判定值')
  assert.ok(Math.abs(guarded.probability - bare.probability) <= 1e-9, '护栏不得改变概率（A 档 ≤1e-9）')
  assert.deepEqual(guarded.candidates, bare.candidates, '候选必须逐项一致（护栏不是"再判一次"）')
  assert.equal(guarded.stateHash, bare.stateHash)

  clock.set(T0 + 1)
  const hit = await run(guard, { ...args, guard })
  assert.equal(hit.fromCache, true)
  assert.ok(Math.abs(hit.probability - bare.probability) <= 1e-9, '缓存命中必须逐字复制原概率，不得重算/重归一')
  assert.deepEqual(hit.candidates, [], '缓存命中不持有候选（如实为空，不伪造）')
})


// ── R2 加固：配置项"真被消费"**不再单点** ───────────────────────────────────
//
// 复核指出的单点缺陷：整轮只有 F14/F15 一条走 `apply(config)`。**每个键各一条行为判据**，
// 且每条都给出**与缺省值不同的可观测差异** —— 键没被消费时，该条必红（负向控制在 /tmp 变异里跑）。
// ⚠ 与 F14/F15 的分工：F14/F15 证"配置**读得到**"（guardState 逐项对账）；
//   本节证"配置**用得上**"（行为随配置值变）。两条腿都要，缺一不可。

test('F18 结构性：src/index.ts 里无 `void config`，且每个 Config 键都被 config.<key> 引用（附闸自身负向控制）', async () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url).pathname, 'utf8')
  const keys = [...src.matchAll(/^\s{2}([A-Za-z_$][\w$]*): Schema\./gm)].map((m) => m[1])
  assert.ok(keys.length >= 6, `抽键正则必须能抽出 Config 键表（抽到 ${keys.length} 个 ⇒ 抽不出时本判据会静默空转）`)

  const real = checkConfigConsumed(src, keys)
  assert.deepEqual(real, [], `真实源码必须无配置消费缺陷：${real.join('；')}`)

  // 负向控制：**改坏了必须红**（证明这条检查器有负荷，不是恒绿）
  assert.ok(
    checkConfigConsumed(`${src}\nvoid config\n`, keys).some((f) => f.includes('void config')),
    '负向控制1：注入 `void config` 后必须红',
  )
  const dropped = src.replace(new RegExp(`config\\.${keys[0]}\\b`), 'config.__gone__')
  assert.ok(
    checkConfigConsumed(dropped, keys).some((f) => f.includes(keys[0])),
    `负向控制2：删掉 config.${keys[0]} 的引用后必须红`,
  )
  assert.ok(
    checkConfigConsumed('export function apply(ctx, config) { use(config.alpa) }', ['alpha']).length > 0,
    '负向控制3：config.<拼错> 必须红',
  )
})

// 六个配置键，**各一条**行为判据：每条都把键设成与缺省值不同的值，
// 断言"行为**确实随该值变**"。键没被消费 ⇒ 对应的那条必红（单一防线从此不存在）。

test('F19 键 cacheTtlSeconds 真被消费：设为 0 ⇒ 同 state+question 连续两次都不命中（缺省 300 会命中）', async () => {
  const { svc, stop } = await mountJev({ cacheTtlSeconds: 0, sessionBudget: 50 })
  try {
    const stub = makeFetch(() => okResponse(0.8))
    const a = await svc.judgeGuarded({ state: 'same', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    const b = await svc.judgeGuarded({ state: 'same', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(a.degraded, false, `前置：不得降级 ${a.reason}`)
    assert.equal(b.fromCache, false, 'cacheTtlSeconds=0 ⇒ 第二次**不得**命中（键没被消费时会命中 ⇒ 必红）')
    assert.equal(stub.calls.length, 2, '两次都必须真打模型')
  } finally {
    await stop()
  }
})

test('F20 键 circuitBreakerFailures 真被消费：设为 2 ⇒ 第 2 次失败即打开（缺省 5 时会是 closed）', async () => {
  const { svc, stop, rows } = await mountJev({ circuitBreakerFailures: 2, circuitBreakerCooldownSeconds: 60, sessionBudget: 50 })
  try {
    const stub = makeFetch(() => failResponse())
    await svc.judgeGuarded({ state: 'f1', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(svc.guardState().circuitState, 'closed', '第 1 次失败后仍须 closed')
    await svc.judgeGuarded({ state: 'f2', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(svc.guardState().circuitState, 'open', '阈值 2 ⇒ 第 2 次失败后必须打开（键没被消费时会停在 closed ⇒ 必红）')
    const rejected = await svc.judgeGuarded({ state: 'f3', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(rejected.reason, JEV_GUARD_REASONS.circuitOpen)
    assert.equal(stub.calls.length, 2, '打开后不得再打模型')
    assert.equal(rows(), 3, '被拒的那次同样留痕')
  } finally {
    await stop()
  }
})

test('F21 键 circuitBreakerCooldownSeconds 真被消费：设 1 ⇒ 冷却按配置走（不是写死 60）；设 0 ⇒ 打开即半开', async () => {
  // ⚠ 结构性事实（本轮实测）：`apply()` 里构造的护栏用**系统时钟** —— 注入时钟只在 `judgeGuarded` 的
  //   判定链路上（F6/F7 用它做 59s/60s 边界）。跨服务边界无法虚拟化时间 ⇒ 本条用**短冷却 + 真等 1.1s**。
  //   这是本文件**唯一**的真实等待，且仅 1.1 秒（不是 60s）——如实写在 handoff 里。
  const { svc, stop } = await mountJev({ circuitBreakerFailures: 1, circuitBreakerCooldownSeconds: 1, sessionBudget: 50 })
  try {
    const stub = makeFetch(() => failResponse())
    await svc.judgeGuarded({ state: 'f1', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(svc.guardState().circuitState, 'open', '阈值 1 ⇒ 首次失败即打开')

    await sleep(1100)
    assert.equal(
      svc.guardState().circuitState,
      'half-open',
      '冷却 1s（配置值）过后必须半开 —— 若实现写死 60s（键没被消费）这里仍是 open ⇒ 必红',
    )
    stub.set(() => okResponse(0.9))
    const probe = await svc.judgeGuarded({ state: 'p', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(probe.degraded, false, `半开试探必须被放行：${probe.reason}`)
    assert.equal(svc.guardState().circuitState, 'closed')
  } finally {
    await stop()
  }

  // 零冷却口径：`0` ⇒ 打开即半开（与 `sessionBudget:0` / `concurrencyWaitTimeoutMs:0` 同为"关掉"语义）。
  // 这条**不依赖任何计时**，故不存在抖动；键没被消费时（缺省 60）这里必为 open ⇒ 必红。
  const zero = await mountJev({ circuitBreakerFailures: 1, circuitBreakerCooldownSeconds: 0, sessionBudget: 50 })
  try {
    const stub = makeFetch(() => failResponse())
    await zero.svc.judgeGuarded({ state: 'z1', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(
      zero.svc.guardState().circuitState,
      'half-open',
      '冷却 0 ⇒ 打开后立刻半开（无计时依赖；键没被消费时仍是 open）',
    )
  } finally {
    await zero.stop()
  }
})

test('F22 键 maxConcurrency 真被消费：设为 2 ⇒ 服务面桩观测峰值**恰为 2**（缺省 32 时会是全部 6 个在飞）', async () => {
  const { svc, stop } = await mountJev({ maxConcurrency: 2, sessionBudget: 50, concurrencyWaitTimeoutMs: 0 })
  try {
    const stub = countingFetch(0.75, 20)
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        svc.judgeGuarded({ state: `c${i}`, question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl }),
      ),
    )
    assert.equal(stub.peak(), 2, `峰值必须**恰为**配置的 2（键没被消费时会按缺省 4 跑 ⇒ 必红）`)
    assert.equal(svc.guardState().peakInFlight, 2)
  } finally {
    await stop()
  }
})

test('F23 键 sessionBudget 真被消费：设为 2 ⇒ 第 3 次拒绝（缺省 200 会放行）', async () => {
  const { svc, stop, rows } = await mountJev({ sessionBudget: 2, maxConcurrency: 4 })
  try {
    const stub = makeFetch(() => okResponse(0.8))
    for (let i = 1; i <= 2; i += 1) {
      const o = await svc.judgeGuarded({ state: `s${i}`, question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
      assert.equal(o.degraded, false, `预算内第 ${i} 次必须正常：${o.reason}`)
      assert.equal(o.sessionSpend, i)
    }
    const third = await svc.judgeGuarded({ state: 's3', question: 'q', sessionId: 'K', fetchImpl: stub.fetchImpl })
    assert.equal(third.reason, JEV_GUARD_REASONS.sessionBudgetExceeded, `键没被消费时会放行 ⇒ 必红（实测 ${third.reason}）`)
    assert.equal(svc.guardState().config.sessionBudget, 2, '生效配置必须可读（与行为断言互为交叉验证）')
    assert.equal(stub.calls.length, 2, '超预算不得打模型')
    assert.equal(rows(), 3, '被拒的那次同样留痕')
  } finally {
    await stop()
  }
})

test('F24 键 concurrencyWaitTimeoutMs 真被消费：设为 80ms ⇒ 满载时等候者被拒（缺省 30s 会一直等）', async () => {
  const { svc, stop, rows } = await mountJev({ maxConcurrency: 1, concurrencyWaitTimeoutMs: 80, sessionBudget: 50 })
  try {
    let calls = 0
    const slow = async () => {
      calls += 1
      await sleep(150)
      return okResponse(0.7)
    }
    const holder = svc.judgeGuarded({ state: 'hold', question: 'q', sessionId: 'K', fetchImpl: slow })
    await sleep(10)
    const waiter = await svc.judgeGuarded({ state: 'wait', question: 'q', sessionId: 'K', fetchImpl: slow })
    assert.equal(
      waiter.reason,
      JEV_GUARD_REASONS.concurrencyTimeout,
      `80ms 等不到槽位必须显式拒绝（键没被消费时会用缺省 30s 一直等 —— 那就是"无声挂起"）实测 ${waiter.reason}`,
    )
    assert.equal(waiter.degraded, true)
    assert.equal(svc.guardState().waitTimeoutMs, 80, '生效读数字段必须与行为一致')
    await holder
    assert.equal(calls, 1, '被拒的等候者不得打模型')
    assert.equal(rows(), 2, '超时那次同样留痕')
  } finally {
    await stop()
  }
})
