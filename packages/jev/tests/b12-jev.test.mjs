/**
 * dsh-mana-jev · B1.2 判据测试 —— 单 token logprob 原语 + 降级留痕。
 *
 * 判据口径（与 docs/handoff/S2.md 对齐）：
 *  · **A 档确定性**：归一化是纯算术（`exp` + 求和），逐字可复现，容差 ≤1e-9。
 *  · **真实返回优先**：`yes/no` 归一的断言**跑在真调 Ollama 的返回上**，不用手写夹具顶替。
 *    （手写候选只作**负向补例**，见最后一条用例，且已显式标注。）
 *  · **和守恒**：`pYes + pNo + Σunmatched === Σ exp(全部候选)`。
 *    这一条是结构性兜底 —— 「只匹小写 ⇒ 静默漏掉 `Yes`」会让和变小，**必被此断言抓住**。
 *  · **降级留痕（A1-14 / G8）**：降级时 `degraded===true` + `reason` 非空字符串
 *    **并且**仍写一行 `jev_log`（两条都要真，缺一即失败）。
 *  · **正常反例**：正常路径 `degraded===false` 且 `reason===null`；
 *    概率不可用时为 `null`（契约明令**不得用 `0` 冒充**）。
 *
 * ⚠ 落痕用**临时库**（经 core 的 `createSchema` 建同一份 schema）。
 *   本仓已有教训：夹具不得写生产库（`$DSH_HOME/memory/mana.db`）。
 *   生产库是 0 行的只读核验对象，见 handoff 的零越界证据。
 *
 * ⚠ 本注释块内**不得出现**星号加斜杠的字符组合（glob 路径里很容易带上），
 *   否则块注释会被提前终止、残留文本变成代码（本仓实测踩过一次）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after } from 'node:test'

const OLLAMA = new URL('../src/ollama.ts', import.meta.url).href
const JEV = new URL('../src/index.ts', import.meta.url).href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
// 真端点判据的**归因读数**（口径：docs/mana-endpoint-attribution.md）：
// 环境态与行为态不同形、红文案给"下一步查什么"。**一处实现**（与 vector 侧共用同一模块），
// 免得两个包各写一套措辞而漂移。
import { attributionText, behaviorWrongText } from '../../vector/tests/_live-endpoints.mjs'

const { judgeWithOllama, normalizeYesNo, extractPos0Candidates, stateHash, chatUrl, DEGRADED_REASONS } =
  await import(OLLAMA)

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/**
 * 建一个**临时** mana 库（schema 来自 core 的 `createSchema` —— 与生产库同一份 DDL）。
 * 返回 db 与关闭函数。**绝不指向 $DSH_HOME**。
 */
async function tempDb() {
  const core = await import(CORE)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-'))
  dirs.push(dir)
  const path = join(dir, 'mana.db')
  const db = new DatabaseSync(path)
  core.createSchema(db)
  const count = () => Number(db.prepare('SELECT count(*) c FROM jev_log').get().c)
  return { db, path, count, close: () => db.close() }
}

/**
 * 端点层前置：不可达 ⇒ **显式失败**（不许静默跳过，否则判据假绿 —— 假绿② 的防线一字未动），
 * 但红文案必须让读者一眼看出这是**测量环境**坏了，并给出下一步动作。
 * 口径：docs/mana-endpoint-attribution.md。
 */
async function requireOllama(title) {
  // ⚠ **极性**：不可达 ⇒ 走到 assert.fail（**红**）；可达 ⇒ 什么也不做、继续跑。
  //   这里刻意**不写** `if (可达) return` 之外的任何形态，也**不写** t.skip —— 见口径文档 §5 硬边界 1。
  if (!(await ollamaReachable())) assert.fail(attributionText(lastReachFailure, { title }))
}

/** 真调一次 Ollama；不可达则**显式失败**（不许静默跳过，否则判据假绿）。 */
async function liveJudge(extra = {}) {
  const q = 'Is the statement true? Answer strictly yes or no.'
  const out = await judgeWithOllama({ state: 'the sky is blue on a clear day', question: q, ...extra })
  return out
}

/** 真端点（本机 Ollama）：**环境态**那一腿的读数源。 */
const OLLAMA_BASE = 'http://127.0.0.1:11434'
const OLLAMA_TAGS = OLLAMA_BASE + '/api/tags'
/** 端点层最近一次失败的**读数**（形状与 vector 侧的读数是同一把标尺）。 */
let lastReachFailure = null

/** 预检：Ollama 是否达。**判定与改前逐字相同**（r.ok），只是把"哪一步没达"记下来供归因文案用。 */
async function ollamaReachable() {
  try {
    const r = await fetch(OLLAMA_TAGS, { signal: AbortSignal.timeout(5000) })
    lastReachFailure = r.ok
      ? null
      : { baseUrl: OLLAMA_TAGS, model: '(端点预检面)', degraded: true, failureKind: null, reason: 'GET ' + OLLAMA_TAGS + ' → HTTP ' + r.status }
    return r.ok
  } catch (error) {
    lastReachFailure = {
      baseUrl: OLLAMA_TAGS,
      model: '(端点预检面)',
      degraded: true,
      failureKind: null,
      reason: 'GET ' + OLLAMA_TAGS + ' 不可达：' + (error instanceof Error ? error.message : String(error)),
    }
    return false
  }
}

// ── 1. 单 token 原语：真调用 + 逐项对账 ─────────────────────────────────────

test('B1.2-1 真调 Ollama：pos0 取到候选，且 yes/no 归一对得上原始 top_logprobs', async (t) => {
  await requireOllama('B1.2-1 真调 Ollama 的测量条件')

  const out = await liveJudge()

  // 正常路径：不得降级
  // ⚠ 前置已过（环境可用）⇒ 这里的红**只能是行为面**：文案点"查被测代码"，不再与"环境不可用"同形。
  assert.equal(out.degraded, false, behaviorWrongText('B1.2-1 正常路径', 'latencyMs=' + out.latencyMs + ' · reason=' + String(out.reason)))
  assert.equal(out.reason, null, '正常路径 reason 必须是 null（非空字符串只在降级时出现）')
  assert.notEqual(out.probability, null, '正常路径必须给出概率（null 表示"概率不可用"）')
  assert.equal(out.value, out.probability >= 0.5 ? 'yes' : 'no')

  // 候选非空，且含 pos0 的 5 档
  assert.ok(out.candidates.length > 0, 'pos0 候选不得为空')
  assert.ok(out.candidates.every((c) => typeof c.token === 'string' && Number.isFinite(c.logprob)))

  const norm = out.normalization
  assert.ok(norm, '正常路径必须给出归一结果')

  // ── 逐项对账（真返回，不是夹具）─────────────────────────────────────────
  const expectedYes = out.candidates.filter((c) => c.token.trim().toLowerCase() === 'yes')
  const expectedNo = out.candidates.filter((c) => c.token.trim().toLowerCase() === 'no')
  const expectedUnmatched = out.candidates.filter((c) => !['yes', 'no'].includes(c.token.trim().toLowerCase()))

  assert.deepEqual(
    norm.yesFamily.map((c) => c.token),
    expectedYes.map((c) => c.token),
    'yes 族必须**逐项**等于真返回里小写化后为 yes 的全部 token',
  )
  assert.deepEqual(norm.noFamily.map((c) => c.token), expectedNo.map((c) => c.token))
  assert.deepEqual(norm.unmatched.map((c) => c.token), expectedUnmatched.map((c) => c.token))

  // 和守恒：pYes + pNo + Σunmatched === Σ exp(全部候选)（容差 1e-9，A 档）
  const refAll = out.candidates.reduce((a, c) => a + Math.exp(c.logprob), 0)
  const sumUnmatched = norm.unmatched.reduce((a, c) => a + Math.exp(c.logprob), 0)
  assert.ok(
    Math.abs(norm.pYes + norm.pNo + sumUnmatched - refAll) <= 1e-9,
    `和守恒失败 ⇒ 有 token 被静默丢弃：pYes+pNo+unmatched=${norm.pYes + norm.pNo + sumUnmatched} vs 全部=${refAll}`,
  )

  // A 档锚点：归一值必须与"按原始 logprob 独立重算"逐字一致（差 ≤1e-9）
  const refYes = expectedYes.reduce((a, c) => a + Math.exp(c.logprob), 0)
  const refNo = expectedNo.reduce((a, c) => a + Math.exp(c.logprob), 0)
  assert.ok(Math.abs(norm.pYes - refYes) <= 1e-9, `pYes 偏差过大：${norm.pYes} vs ${refYes}`)
  assert.ok(Math.abs(norm.pNo - refNo) <= 1e-9, `pNo 偏差过大：${norm.pNo} vs ${refNo}`)

  // 取证：B 档浮动量（绝对毫秒）只打印，**不进任何阈值列**
  t.diagnostic(`[测量条件说明 · B 档，非阈值] latency_ms=${out.latencyMs} model=${out.model}`)
  t.diagnostic(
    `[真返回 pos0] ${out.candidates.map((c) => `${c.token}:${c.logprob.toFixed(4)}`).join(' ')} → pYes=${norm.pYes.toFixed(4)}`,
  )
})

test('B1.2-2 大小写变体不得被静默漏掉（真返回上的直接断言）', async (t) => {
  await requireOllama('B1.2-2 大小写变体判据的测量条件')

  const out = await liveJudge()
  const candidates = out.candidates
  const upperYes = candidates.filter((c) => c.token === 'Yes')
  const lowerYes = candidates.filter((c) => c.token === 'yes')

  t.diagnostic(
    `[真返回] 大写 Yes=${upperYes.length} 小写 yes=${lowerYes.length} | ` +
      `大写 No=${candidates.filter((c) => c.token === 'No').length} 小写 no=${candidates.filter((c) => c.token === 'no').length}`,
  )

  // ⚠ 本判据的核心：`Yes` 与 `yes` 是**两个不同 token**（真返回同时含二者即为证据）。
  //   若归一化只匹小写，下面两条会失败：大写那条会落到 unmatched 且 pYes 偏小。
  for (const c of upperYes) {
    assert.ok(
      out.normalization.yesFamily.some((x) => x.token === c.token),
      `大写 ${c.token}（logprob=${c.logprob}）必须计入 yes 族 —— 只匹小写会静默漏掉它`,
    )
  }
  for (const c of lowerYes) {
    assert.ok(out.normalization.yesFamily.some((x) => x.token === c.token), `小写 ${c.token} 必须计入 yes 族`)
  }

  // 反向：不属于 yes/no 族的 token 不得被吞进任一族
  for (const c of candidates) {
    const k = c.token.trim().toLowerCase()
    const inYes = out.normalization.yesFamily.some((x) => x.token === c.token)
    const inNo = out.normalization.noFamily.some((x) => x.token === c.token)
    assert.equal(inYes, k === 'yes', `token ${c.token} 的 yes 族归属错误`)
    assert.equal(inNo, k === 'no', `token ${c.token} 的 no 族归属错误`)
  }
})

// ── 2. 降级必须留痕（A1-14 / G8）───────────────────────────────────────────

test('B1.2-3 真故障（不可达端点）：degraded=true + reason 非空 + **仍写一行 jev_log**', async () => {
  const { db, count, close, path } = await tempDb()
  try {
    assert.equal(count(), 0, '前置：临时库 jev_log 必须为空')

    // 真故障：127.0.0.1:1 必然 ECONNREFUSED（不是 mock 出来的"失败"）
    const out = await judgeWithOllama({
      state: 's', question: 'q', db,
      endpoint: 'http://127.0.0.1:1',
      requestType: 'jev', source: 'test', sessionId: 's-degrade', turnId: 7,
    })

    // ① 显式降级字段
    assert.equal(out.degraded, true, '真故障必须 degraded===true')
    assert.equal(typeof out.reason, 'string', 'reason 必须是字符串')
    assert.ok(out.reason.length > 0, 'reason 必须**非空**（空字符串 == 不可分辨）')
    assert.ok(
      out.reason.startsWith(DEGRADED_REASONS.requestFailed),
      `reason 必须带可枚举前缀：实测 ${out.reason}`,
    )
    // 契约：概率不可用 ⇒ null，**不得用 0 冒充**
    assert.equal(out.probability, null, '概率不可用必须是 null，不得用 0 冒充')
    assert.equal(out.value, 'unknown', '判定失败 ⇒ unknown，不得默认成 no')

    // ② 仍然留痕（两条**都要真**）
    assert.equal(count(), 1, '降级**也必须**写一行 jev_log（A1-14：沉默地不注入但必须留痕）')

    const row = db
      .prepare('SELECT request_type, source, state_hash, result_value, probability, degraded, latency_ms, session_id, turn_id, created_at FROM jev_log')
      .get()
    assert.equal(row.result_value, 'unknown')
    assert.equal(row.probability, null, '落库概率必须是 NULL 而不是 0')
    assert.equal(row.degraded, 1, 'jev_log.degraded 必须为 1')
    assert.equal(row.source, 'test')
    assert.equal(row.session_id, 's-degrade')
    assert.equal(row.turn_id, 7)
    assert.equal(row.state_hash, stateHash('s'))
    assert.ok(typeof row.created_at === 'string' && row.created_at.length > 0, 'created_at 必须落值')
    assert.equal(out.traceError, null, `落痕自身不得失败：${out.traceError}`)
    assert.ok(typeof path === 'string')
  } finally {
    close()
  }
})

test('B1.2-4 骨架测试同款口径的 fetch stub（500）也走同一降级+留痕路径', async () => {
  const { db, count, close } = await tempDb()
  try {
    const out = await judgeWithOllama({
      state: 's', question: 'q', db,
      fetchImpl: async () => new Response('boom', { status: 500 }),
    })
    assert.equal(out.degraded, true)
    assert.ok(out.reason.startsWith(DEGRADED_REASONS.httpError), `实测 reason=${out.reason}`)
    assert.ok(out.reason.length > 0, 'reason 非空')
    assert.equal(out.probability, null)
    assert.equal(count(), 1, '降级仍须留痕')
  } finally {
    close()
  }
})

test('B1.2-5 正常反例：degraded=false 且 reason===null，并落一行 degraded=0 的痕', async (t) => {
  await requireOllama('B1.2-5 正常反例的测量条件')

  const { db, count, close } = await tempDb()
  try {
    const out = await liveJudge({ db, sessionId: 's-ok', turnId: 3 })

    assert.equal(out.degraded, false, behaviorWrongText('B1.2-5 正常反例', 'reason=' + String(out.reason)))
    assert.equal(out.reason, null, '正常路径 reason 必须是 null')
    assert.notEqual(out.probability, null, '正常路径概率不得为 null')
    assert.ok(['yes', 'no'].includes(out.value), `正常路径 value 必须是 yes/no，实测 ${out.value}`)
    assert.equal(count(), 1, '正常路径也应留痕（jev_log 是判定日志，不只是失败日志）')

    const row = db.prepare('SELECT result_value, probability, degraded FROM jev_log').get()
    assert.equal(row.degraded, 0)
    assert.equal(row.result_value, out.value)
    assert.ok(Math.abs(row.probability - out.probability) <= 1e-9, '落库概率必须与返回概率一致（A 档）')
    t.diagnostic(`[测量条件说明 · B 档] latency_ms=${out.latencyMs}`)
  } finally {
    close()
  }
})

test('B1.2-6 无 yes/no 族候选 ⇒ unknown + 降级留痕（不得默认成 no）', async () => {
  const { db, count, close } = await tempDb()
  try {
    const out = await judgeWithOllama({
      state: 's', question: 'q', db,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: '<think>' },
            logprobs: [{ token: '<think>', logprob: -0.1, top_logprobs: [{ token: '<think>', logprob: -0.1 }] }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })
    assert.equal(out.degraded, true)
    assert.ok(out.reason.startsWith(DEGRADED_REASONS.noYesNoToken), `实测 reason=${out.reason}`)
    assert.equal(out.value, 'unknown', '判不了必须是 unknown，不得默认 no')
    assert.equal(out.probability, null)
    assert.equal(count(), 1, '此路径同样必须留痕')
  } finally {
    close()
  }
})

// ── 3. 原语内部件的确定性（A 档）─────────────────────────────────────────

test('B1.2-7 stateHash 是 A 档确定性值；chatUrl 幂等拼接', () => {
  assert.equal(stateHash('the sky is blue on a clear day'), stateHash('the sky is blue on a clear day'))
  assert.equal(stateHash('a').length, 16)
  assert.notEqual(stateHash('a'), stateHash('b'))
  assert.equal(chatUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434/api/chat')
  assert.equal(chatUrl('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434/api/chat')
  assert.equal(chatUrl('http://127.0.0.1:11434/api/chat'), 'http://127.0.0.1:11434/api/chat')
})

test('B1.2-8 pos0 提取对异常形态返回空数组（不抛，交给调用方转显式降级）', () => {
  assert.deepEqual(extractPos0Candidates(null), [])
  assert.deepEqual(extractPos0Candidates({}), [])
  assert.deepEqual(extractPos0Candidates({ logprobs: [] }), [])
  assert.deepEqual(extractPos0Candidates({ logprobs: [{ top_logprobs: 'x' }] }), [])
  // 非有限 logprob 必须被剔除（NaN/Infinity 会污染和守恒）
  assert.deepEqual(extractPos0Candidates({ logprobs: [{ top_logprobs: [{ token: 'yes', logprob: Number.NaN }] }] }), [])
})

// ── 4. 负向补例（**手写候选，不替代真返回断言**）────────────────────────────

test('B1.2-9 负向补例：手写大小写混合候选的归一（补充，不替代真返回断言）', () => {
  // 这条**刻意**用手写候选，用于钉死"只匹小写"这个具体 bug 形态；
  // 主断言在 B1.2-1/2，跑在真返回上。
  const cands = [
    { token: 'Yes', logprob: Math.log(0.6) },
    { token: 'yes', logprob: Math.log(0.1) },
    { token: 'No', logprob: Math.log(0.2) },
    { token: 'no', logprob: Math.log(0.05) },
    { token: '<think>', logprob: Math.log(0.05) },
  ]
  const n = normalizeYesNo(cands)
  assert.ok(Math.abs(n.pYes - 0.7) <= 1e-9, `pYes 必须同时含 Yes 与 yes：实测 ${n.pYes}（只匹小写得 0.1）`)
  assert.ok(Math.abs(n.pNo - 0.25) <= 1e-9, `pNo 必须同时含 No 与 no：实测 ${n.pNo}`)
  assert.equal(n.yesFamily.length, 2, 'yes 族必须含 2 个词表项（Yes + yes）')
  assert.equal(n.noFamily.length, 2, 'no 族必须含 2 个词表项（No + no）')
  assert.deepEqual(n.unmatched.map((c) => c.token), ['<think>'], '未命中的 token 必须显式列出而非丢弃')
})

// ── 5. 插件面：服务接上（不是"函数在"）─────────────────────────────────────

test('B1.2-10 服务面 judge 真写进 core 的库（装配态证据，非机制自证）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(JEV)

  // 回归自检：既有骨架形状**不得**因本批改动而失效
  assert.equal(jevMod.name, 'mana-jev', 'name 不得变')
  assert.deepEqual(jevMod.inject, ['mana-core'], 'inject 不得变')
  assert.ok(jevMod.Config, 'Config 必须仍在')

  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-asm-'))
  dirs.push(dir)
  const storePath = join(dir, 'mana.db')

  const ctx = new Context()
  ctx.plugin(coreMod, { storePath }) // ⚠ 显式传临时库，绝不写生产库
  await new Promise((r) => setTimeout(r, 150))
  ctx.plugin(jevMod, {})
  await new Promise((r) => setTimeout(r, 300))

  const svc = ctx.get('mana-jev')
  assert.ok(svc, 'mana-jev 服务必须可读')
  assert.equal(svc.status().wired, true, '既有 status() 必须仍为 true（骨架判据不得失效）')

  await requireOllama('B1.2-8 服务面判据的测量条件')

  const before = Number(ctx.get('mana-core').db.prepare('SELECT count(*) c FROM jev_log').get().c)
  const out = await svc.judge({ state: 'the sky is blue', question: 'Is the statement true? yes or no', sessionId: 'svc', turnId: 1 })
  const afterCount = Number(ctx.get('mana-core').db.prepare('SELECT count(*) c FROM jev_log').get().c)

  assert.equal(out.degraded, false, behaviorWrongText('B1.2-8 服务面正常路径', 'reason=' + String(out.reason)))
  assert.equal(afterCount, before + 1, '服务面调用必须经 core 的库落一行 jev_log（"接上"的产物证据）')
  t.diagnostic(`[服务面] pYes=${out.probability?.toFixed(4)} value=${out.value} rows ${before}→${afterCount}`)
})

// ── 6. 反证判据（R0 / handoff 第 3 段）─────────────────────────────────────

test('B1.2-11 反证：卸载 jev 后同一触发不再产生新行（附**正向对照**防平凡通过）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(JEV)

  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-r0-'))
  dirs.push(dir)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await new Promise((r) => setTimeout(r, 150))
  const jevFiber = ctx.plugin(jevMod, {})
  await new Promise((r) => setTimeout(r, 300))

  const core = ctx.get('mana-core')
  const rows = () => Number(core.db.prepare('SELECT count(*) c FROM jev_log').get().c)

  // 触发用**降级路径**（不可达端点）：不依赖 Ollama 在线，且同样必落一行痕。
  // 用降级路径做反证反而更严 —— 留痕是 G8 的硬义务，不是"顺手写的成功日志"。
  const trigger = async (state) => {
    const svc = ctx.get('mana-jev')
    if (!svc) return null
    return await svc.judge({ state, question: 'q', endpoint: 'http://127.0.0.1:1' })
  }

  // ① 正向对照：装载态下同一触发**必须**产生新行（否则反证平凡通过 = G11 假绿）
  const base0 = rows()
  const first = await trigger('r0-a')
  const base1 = rows()
  assert.ok(first, '装载态下服务必须可读')
  assert.equal(first.degraded, true, '不可达端点必须走降级（这是本用例的触发前提）')
  assert.equal(base1, base0 + 1, `装载态下同一触发必须新增行：${base0} → ${base1}`)

  // ② 卸载（cordis 的插件层卸载语义 = fiber.dispose）
  await jevFiber.dispose()
  await new Promise((r) => setTimeout(r, 200))
  const afterUnload = rows()
  assert.equal(ctx.get('mana-jev'), undefined, '卸载后服务必须不可读（未卸干净则本判据无意义）')

  // ③ 同一触发再走一次
  const second = await trigger('r0-b')
  assert.equal(second, null, '卸载后触发应取不到服务')
  const afterSecond = rows()
  assert.equal(afterSecond, afterUnload, `卸载后同一触发不得再产生新行：${afterUnload} → ${afterSecond}`)

  t.diagnostic(
    `[反证 · 进程内装配] 装载态 +1 行（${base0}→${base1}）；卸载后 0 新行（${afterUnload}→${afterSecond}）`,
  )
  await ctx.stop?.()
})
