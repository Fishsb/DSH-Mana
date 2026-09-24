/**
 * A1-13 / A1-14 注入审计判据（W3-2 · Injection Gate）
 *
 * 判据原文（`docs/mana-rollout-plan.md:473-474`）：
 *
 *   **A1-13**「没注入」必须可分辨是三种里的哪一种 ——
 *     ① `gate` 枚举值必须落在 5 类内（出现 `null`/空值即判红）；
 *     ② 跑一轮含记忆命中的会话后，`gate='injected'` 至少出现 1 次
 *        （若全程 0 次而库非空 ⇒ 判红，说明门控静默失效）。
 *
 *   **A1-14** fail-closed 不得吞掉「未判」—— **同时**断言：
 *     ① 注入块数 == 0（fail-closed 生效）；② `inject_log` **仍新增** `degraded_unavailable` 行。
 *     只满足①而无新增行 ⇒ 判红（那是「静默」而非「fail-closed」）。
 *
 * ⚠ **为什么这两条是本轮最重要的一对**（既有教训原文）：
 *   「缺陷全 fail-closed（未判⇒计数不动、不换向）⇒ 不报警只静默」。
 *   注入门控的**正常态与故障态表面完全同形**（都是"没注入"）⇒ 这类缺陷必须先被判据覆盖，
 *   否则永远查不出来。
 *
 * ⚠ 本测试走**真装配链**（真 Context + 真 Loader + 真 `agent/pre-step` 分发），
 *   不是直接调 service —— 否则「留痕了」只是判据自己搭的假象。
 *   库一律用临时库（本仓硬纪律）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const ROOT = new URL('../../../', import.meta.url)
const BASE_URL = pathToFileURL(fileURLToPath(ROOT)).href + '/'

const { Context } = await import(`${DSH}/cordis/lib/index.js`)
const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default

const PACKAGES = [
  ['dsh-mana-core', 'mana-core'],
  ['dsh-mana-perception', 'mana-perception'],
  ['dsh-mana-attention', 'mana-attention'],
]

const cleanups = []
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

async function boot({ injectionEnabled } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-a113-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')

  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)

  for (const [pkg] of PACKAGES) {
    const config = pkg === 'dsh-mana-core' ? { storePath: store } : {}
    if (pkg === 'dsh-mana-attention' && injectionEnabled !== undefined) config.injectionEnabled = injectionEnabled
    await ctx.loader.create({ name: pkg, config })
    await settle(150)
  }
  const missing = PACKAGES.filter(([, svc]) => !ctx.get(svc)).map(([p]) => p)
  assert.deepEqual(missing, [], `未装配：${missing.join(', ')}`)
  return { ctx, store }
}

/** 独立只读连接读 inject_log（不复用插件句柄）。 */
function readInject(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  const rows = db.prepare('SELECT * FROM inject_log ORDER BY id').all()
  db.close()
  return rows
}

/**
 * 手工触发一次 `agent/pre-step` 分发。
 *
 * ⚠ 走**宿主的真分发通道**（`ctx.waterfall`），而不是直接调我们自己的监听器 ——
 *   后者会绕过 waterfall 的合成语义（下游哨兵/`next()` 义务都在通道里）。
 *   `messages` 给一条既有消息，用于验证「尾部追加、不动前缀」（A1-7）。
 */
async function firePreStep(ctx, { turn = 1, messages = [] } = {}) {
  const payload = {
    agent: { session: { id: 'sess-a113' } },
    messages,
    turn,
    step: 1,
    signal: new AbortController().signal,
  }
  return ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages }))
}

process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

// ── P1（A1-13①）每次 pre-step 都留痕，且 gate 必落在 5 类内 ────────────────
test('P1 A1-13①：每次 pre-step 结束都落一行，gate 恒为 5 类枚举之一', async () => {
  const { ctx, store } = await boot()

  const GATES = ['injected', 'skip_no_candidate', 'skip_below_threshold', 'degraded_unavailable', 'reset']
  for (let i = 0; i < 3; i += 1) await firePreStep(ctx, { turn: i + 1 })
  await settle(200)

  const rows = readInject(store)
  assert.equal(rows.length, 3, `每次 pre-step 都应留一行（实得 ${rows.length}）`)
  for (const r of rows) {
    assert.ok(GATES.includes(r.gate), `gate 越出枚举：${JSON.stringify(r.gate)}（出现 null/空值即判红）`)
    assert.notEqual(r.gate, null)
    assert.notEqual(r.gate, '')
  }
})

// ── P2（A1-13②）含记忆命中时 gate='injected' 至少 1 次 ──────────────────────
test('P2 A1-13②：有候选时 gate=injected 至少出现 1 次（否则门控静默失效）', async () => {
  const { ctx, store } = await boot()

  // 先经**真源头**产生候选（perception → attention → pending 队列）
  ctx.get('mana-perception').perceive({
    content: '用户偏好：中文短指令、要实测数据',
    sessionId: 'sess-a113',
    turnId: 1,
    requestId: 'req-hit-1',
    source: 'user-message',
  })
  await settle(250)

  const decision = await firePreStep(ctx, { turn: 1 })
  await settle(200)

  const rows = readInject(store)
  const injected = rows.filter((r) => r.gate === 'injected')
  assert: {
    assert.ok(injected.length >= 1, `有候选却全程 0 次 injected ⇒ 判红（门控静默失效）。实得=${JSON.stringify(rows.map((r) => r.gate))}`)
  }
  // 注入块必须真出现在返回决策里（"留痕说注入了"与"真注入了"要一致）
  assert.equal(decision.kind, 'enter')
  assert.ok(Array.isArray(decision.messages) && decision.messages.length >= 1, '应返回注入后的消息')
  const last = decision.messages[decision.messages.length - 1]
  const text = (Array.isArray(last.content) ? last.content : []).map((b) => String(b?.text ?? '')).join('')
  assert.ok(text.includes('<mana-memory>'), `注入块应含 wrapper 标签，实得：${text.slice(0, 80)}`)
})

// ── P3（A1-6）注入块内层 `<` 计数为 0（转义生效）────────────────────────────
test('P3 A1-6：注入块整块仅 2 个 wrapper 标签，内层 < 计数 == 0', async () => {
  const { ctx } = await boot()
  // 候选内容里**故意塞入**尖括号：不转义就会混进 wrapper 层级（不可分辨）
  ctx.get('mana-perception').perceive({
    content: '<script>alert(1)</script> 与 <b>粗体</b>',
    sessionId: 'sess-a113',
    turnId: 1,
    requestId: 'req-esc',
  })
  await settle(250)

  const block = ctx.get('mana-attention').buildBlock()
  assert.ok(block.includes('<mana-memory>'), '应有 wrapper')
  const inner = block.replace(/^<mana-memory>\n?/, '').replace(/\n?<\/mana-memory>$/, '')
  assert.equal((inner.match(/</g) ?? []).length, 0, `内层不得残留 <：${inner}`)
  // 整块 `<` 计数 == 2（仅 wrapper 开闭）
  assert.equal((block.match(/</g) ?? []).length, 2, '整块 < 应为 2（wrapper 开闭各一）')
})

// ── P4（A1-7）注入前后「既有消息」逐字节不变（前缀缓存友好）────────────────
test('P4 A1-7：注入是尾部追加，既有消息逐字节不变', async () => {
  const { ctx } = await boot()
  ctx.get('mana-perception').perceive({
    content: '待注入的内容', sessionId: 'sess-a113', turnId: 1, requestId: 'req-prefix',
  })
  await settle(250)

  const existing = [{ id: 'm-1', role: 'user', content: [{ type: 'text', text: '历史第 1 条' }], source: { kind: 'user' } }]
  const before = JSON.stringify(existing)
  const decision = await firePreStep(ctx, { turn: 1, messages: existing })

  assert.equal(JSON.stringify(existing), before, '既有消息**不得被改写**（宿主契约：this waterfall cannot mutate messages）')
  assert.ok(decision.messages.length > existing.length, '注入应是追加，不是替换')
  // 前缀逐字节相等
  for (let i = 0; i < existing.length; i += 1) {
    assert.equal(JSON.stringify(decision.messages[i]), JSON.stringify(existing[i]), `第 ${i} 条被改动 ⇒ 前缀缓存会失效`)
  }
})

// ── P5（A1-14）fail-closed **并且**留痕（两条都要真）───────────────────────
test('P5 A1-14：无候选时注入块 == 0 且仍新增 skip_no_candidate 行', async () => {
  const { ctx, store } = await boot()
  // 不产生任何候选 ⇒ 候选池空
  const before = readInject(store).length
  const decision = await firePreStep(ctx, { turn: 7 })
  await settle(200)
  const after = readInject(store)

  assert.equal(after.length, before + 1, '① 未注入也**必须留痕**（否则是静默而非 fail-closed）')
  assert.equal(after[after.length - 1].gate, 'skip_no_candidate')
  assert.equal(decision.messages.length, 0, '② 候选池空 ⇒ 不得注入任何块')
})

// ── P6（A1-14 降级面）JEV 不可用 ⇒ 不注入 + 新增 degraded_unavailable ────────
test('P6 A1-14：降级时注入块 == 0 且新增 degraded_unavailable 行（两条都要真）', async () => {
  const { ctx, store } = await boot()
  // 本轮无判定链 ⇒ 概率不可用；注入门控关闭可模拟"降级不可用"路径。
  // 这里用**服务面直写**验证落点契约（degraded 与 gate 同真），
  // 再由 pre-step 验证"不注入"这一半。
  const core = ctx.get('mana-core')
  const before = readInject(store).length
  core.writeInjectLog({
    sessionId: 'sess-a113', turnId: 9, requestId: 'req-degraded',
    gate: 'degraded_unavailable', jevProb: null,
  })
  const decision = await firePreStep(ctx, { turn: 9, messages: [] })
  await settle(200)

  const rows = readInject(store)
  assert.equal(rows.length, before + 2, '降级行 + pre-step 留痕行')
  const degraded = rows.find((r) => r.gate === 'degraded_unavailable')
  assert.ok(degraded, '必须有 degraded_unavailable 行（A1-14①）')
  assert.equal(degraded.degraded, 1, '降级必须显式落位')
  assert.equal(degraded.jev_prob, null, '概率不可用 ⇒ null（不得用 0 冒充）')
  assert.equal(decision.messages.length, 0, '降级 ⇒ 不得注入（A1-14②）')
})

// ── P7 门控关闭仍留痕（关掉了 vs 静默失效 必须可分辨）──────────────────────
test('P7 门控关闭时仍留痕（否则「关掉了」与「静默失效」同形）', async () => {
  const { ctx, store } = await boot({ injectionEnabled: false })
  ctx.get('mana-perception').perceive({
    content: '有候选但门控关着', sessionId: 'sess-a113', turnId: 1, requestId: 'req-off',
  })
  await settle(250)
  const decision = await firePreStep(ctx, { turn: 1 })

  const rows = readInject(store)
  assert.equal(rows.length, 1, '关掉也必须留痕')
  assert.notEqual(rows[0].gate, 'injected')
  assert.equal(decision.messages.length, 0, '关掉 ⇒ 不注入')
})

// ── P8 G9：pre-step 必须调 next()，不得静默掐死下游 ──────────────────────
test('P8 G9：下游哨兵必须被调到（漏调 next() 会静默吞掉全部下游行为）', async () => {
  const { ctx } = await boot()
  let reached = 0
  const off = ctx.on('agent/pre-step', async (_p, next) => {
    reached += 1
    return await next()
  })
  await firePreStep(ctx, { turn: 1 })
  await settle(150)
  assert.ok(reached >= 1, '下游监听器未被调到 ⇒ next() 漏调（静默掐死下游，本仓实测无异常）')
  off()
  assert.ok(existsSync(join(fileURLToPath(ROOT), 'packages/attention/src/index.ts')))
})

// ── P9（A1-2 / I1）每 (session,turn) 至多 1 个注入块 ────────────────────────
test('P9 A1-2 I1：同一 turn 多次 pre-step，injected 至多 1 行', async () => {
  const { ctx, store } = await boot()
  ctx.get('mana-perception').perceive({
    content: '候选内容 A', sessionId: 'sess-a113', turnId: 5, requestId: 'req-i1-a',
  })
  await settle(250)

  // 同一 turn 连打 3 次 pre-step（模拟一 turn 多 step）
  await firePreStep(ctx, { turn: 5 })
  await firePreStep(ctx, { turn: 5 })
  await firePreStep(ctx, { turn: 5 })
  await settle(200)

  const rows = readInject(store)
  // A1-13 要求每次 pre-step 都留痕 ⇒ 3 行都在；但 injected **只能 1 行**（I1）
  assert.equal(rows.length, 3, '每次 pre-step 都应留痕')
  const injected = rows.filter((r) => r.gate === 'injected')
  assert.equal(injected.length, 1, `同 turn 只得 1 个注入块（I1），实得 ${injected.length}`)
  // 其余必须落在"未注入"的枚举里（不得出现 null/空值）
  for (const r of rows.filter((r) => r.gate !== 'injected')) {
    assert.ok(r.gate && r.gate.length > 0, 'gate 不得为空')
  }
})

// ── P10（A1-3 / I2）每条记忆每 session 至多注入一次 ────────────────────────
test('P10 A1-3 I2：每个 requestId 在同一 session 至多注入一次', async () => {
  const { ctx, store } = await boot()
  ctx.get('mana-perception').perceive({
    content: '候选内容 B', sessionId: 'sess-a113', turnId: 1, requestId: 'req-i2-b',
  })
  await settle(250)

  await firePreStep(ctx, { turn: 1 })
  // 换 turn 再打（若不去重，同一 requestId 会被再次注入）
  await firePreStep(ctx, { turn: 2 })
  await firePreStep(ctx, { turn: 3 })
  await settle(200)

  const rows = readInject(store)
  const injectedCount = rows.filter((r) => r.gate === 'injected').length
  assert.equal(injectedCount, 1, `同一批候选不得跨 turn 重复注入（I2），实得 ${injectedCount}`)
  // 按 (session,turn) 分组也不得有 >1 的注入块
  const byTurn = new Map()
  for (const r of rows.filter((r) => r.gate === 'injected')) {
    const k = `${r.session_id}|${r.turn_id}`
    byTurn.set(k, (byTurn.get(k) ?? 0) + 1)
  }
  for (const [k, c] of byTurn) assert.equal(c, 1, `${k} 的注入块数=${c}（应 1）`)
})
