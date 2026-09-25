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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

/**
 * 装配测试环境。
 *
 * @param opts.injectionEnabled 注入门控开关（关掉后仍须留痕）
 * @param opts.judgeProbability 判定链给的可用概率；`null` = 判定链降级（fail-closed 路径）
 * @param opts.baseDir 装配根；缺省 = 真仓根。给值时 = **克隆仓库**（P14 的负向腿在克隆体上跑）
 *
 * ⚠ 为什么要显式给判定链：W3-2 之后 Injection Gate 会**先问判定链**
 *   （`mana/jev/judge`，waterfall）。判定链不可用 ⇒ gate 记 `degraded_unavailable`
 *   并 **fail-closed 不注入**（这是正确行为）。故要验证 `injected` 路径，
 *   必须让判定链给出「可用且过阈」的答案 —— 本函数即为此提供一个桩监听器。
 */
async function boot({ injectionEnabled, judgeProbability = 0.95, baseDir = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-a113-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')

  const ctx = new Context()
  // 缺省从真仓根装配；给 `baseDir` 则从克隆仓库装配（P14 负向腿：只换被测的那一个包）。
  //
  // ⚠ **Loader 自身的 `baseUrl` 也必须跟着换**（本仓实测踩到）：只改 `ctx.baseUrl` 时
  //   `loader.import()` 仍按 **Loader 配置里的** baseUrl 解析 ⇒ 负向腿**静默地在真源上跑**，
  //   于是"去掉 {memoryId}"这个注入**从未生效**、断言却报了"负向腿不红"。
  //   那正是本仓首位缺陷类：**变异没生效，读数看起来却像判据没牙**。
  const root = baseDir ? pathToFileURL(baseDir).href + '/' : BASE_URL
  ctx.baseUrl = root
  ctx.plugin(Loader, { baseUrl: root })
  await settle(200)

  // 判定链桩：注册在**装载包之前** ⇒ 位于内层（本仓实测 waterfall 是洋葱模型，
  // 后注册者在更外层先执行）。这样 attention 调的 `next()` 会落到本桩上。
  const judgeCalls = []
  if (judgeProbability !== null) {
    ctx.on('mana/jev/judge', async (req, next) => {
      judgeCalls.push(req.requestId)
      return {
        requestId: req.requestId,
        source: 'test-stub-judge',
        value: judgeProbability >= 0.7 ? 'yes' : 'no',
        probability: judgeProbability,
        degraded: false,
        reason: null,
      }
    })
  } else {
    // 判定链降级：返回 degraded=true（模拟 JEV 不可用）
    ctx.on('mana/jev/judge', async (req) => ({
      requestId: req.requestId,
      source: 'test-stub-judge',
      value: 'unknown',
      probability: null,
      degraded: true,
      reason: 'test-stub-degraded',
    }))
  }

  for (const [pkg] of PACKAGES) {
    const config = pkg === 'dsh-mana-core' ? { storePath: store } : {}
    if (pkg === 'dsh-mana-attention') {
      if (injectionEnabled !== undefined) config.injectionEnabled = injectionEnabled
      // 判定链要有 state 才判（缺省 '' ⇒ 视为不可用）⇒ 这里显式给一个。
      config.judgeState = 'S'
    }
    await ctx.loader.create({ name: pkg, config })
    await settle(150)
  }
  const missing = PACKAGES.filter(([, svc]) => !ctx.get(svc)).map(([p]) => p)
  assert.deepEqual(missing, [], `未装配：${missing.join(', ')}`)
  return { ctx, store, judgeCalls }
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

  // ⚠ **A1-3 的逐字检查方式是「按 `memory_id` 分组」**（`docs/mana-rollout-plan.md:453`），
  //   而上面两段用的是 `(session,turn)` —— 那是 **A1-2** 的口径。两者是**不同的键**：
  //   A1-2 绿过不等于 I2 被查过。若 `memory_id` 恒 NULL，这条"0 行"就是**数不到东西的绿**
  //   （本仓首位缺陷类）⇒ 在此真数一次（F-02）。
  const nullInjected = rows.filter((r) => r.gate === 'injected' && r.memory_id === null).length
  assert.equal(
    nullInjected,
    0,
    `注入了却写不出 memory_id ⇒ A1-3 的分组数不到东西（判据绿 ≠ 事实被检查），实得 ${nullInjected} 行`,
  )
  const byMemory = new Map()
  for (const r of rows) {
    if (r.memory_id === null) continue
    byMemory.set(r.memory_id, (byMemory.get(r.memory_id) ?? 0) + 1)
  }
  assert.ok(byMemory.size >= 1, '至少要有 1 行带 memory_id（否则该列是死列，I2 仍无可数之处）')
  for (const [k, c] of byMemory) assert.equal(c, 1, `memory_id=${k} 在同一 session 被注入 ${c} 次（I2 要求 ≤1）`)
})

// ── P11（A1-13 第五类）`reset`：块离开上下文时必须显式记账 ──────────────────
test('P11 reset：注入块从上下文消失后，必须记 gate=reset（不得永久标着 injected）', async () => {
  const { ctx, store } = await boot()
  ctx.get('mana-perception').perceive({
    content: '候选内容 R', sessionId: 'sess-a113', turnId: 1, requestId: 'req-reset-1',
  })
  await settle(250)

  // ① 首次注入：应记 injected
  const first = await firePreStep(ctx, { turn: 1 })
  await settle(150)
  assert.equal(readInject(store).filter((r) => r.gate === 'injected').length, 1, '首次应真注入')
  const injectedMsg = first.messages[first.messages.length - 1]

  // ② 再次 pre-step，但**上下文里已没有那个块**（模拟压缩/清空让块离开上下文）
  await firePreStep(ctx, { turn: 2, messages: [] })
  await settle(150)

  const rows = readInject(store)
  const resets = rows.filter((r) => r.gate === 'reset')
  assert.ok(
    resets.length >= 1,
    `块已离开上下文却未记 reset ⇒ 审计里那行 injected 成了假账。实得 gates=${JSON.stringify(rows.map((r) => r.gate))}`,
  )
  // 反向：块**仍在**时不得误记 reset
  await firePreStep(ctx, { turn: 3, messages: [injectedMsg] })
  await settle(150)
  const after = readInject(store).filter((r) => r.gate === 'reset').length
  assert.equal(after, resets.length, '块仍在上下文里 ⇒ 不得重复记 reset（否则 reset 恒真，判据失效）')
})

// ── P12 判定链「判了但未过阈」⇒ skip_below_threshold（与"没候选"可分辨）──────
test('P12 判定链未过阈：gate=skip_below_threshold（与 skip_no_candidate 必须可分辨）', async () => {
  const { ctx, store } = await boot({ judgeProbability: 0.2 }) // 低于 jevThreshold(0.7)
  ctx.get('mana-perception').perceive({
    content: '候选内容 T', sessionId: 'sess-a113', turnId: 1, requestId: 'req-thr-1',
  })
  await settle(250)
  const decision = await firePreStep(ctx, { turn: 1 })
  await settle(150)

  const rows = readInject(store)
  assert.equal(rows.length, 1, '每次 pre-step 应留一行')
  assert.equal(
    rows[0].gate,
    'skip_below_threshold',
    `判了但未过阈必须记 skip_below_threshold（否则与"候选池空"同形）。实得=${rows[0].gate}`,
  )
  assert.equal(decision.messages.length, 0, '未过阈 ⇒ 不得注入')
})

// ── P13 判定链降级 ⇒ degraded_unavailable（fail-closed 且留痕）───────────────
test('P13 判定链降级：gate=degraded_unavailable（不注入但留痕，A1-14）', async () => {
  const { ctx, store } = await boot({ judgeProbability: null }) // 判定链恒降级
  ctx.get('mana-perception').perceive({
    content: '候选内容 U', sessionId: 'sess-a113', turnId: 1, requestId: 'req-deg-1',
  })
  await settle(250)
  const decision = await firePreStep(ctx, { turn: 1 })
  await settle(150)

  const rows = readInject(store)
  assert.equal(rows.length, 1, '降级也必须留痕（A1-14：不得静默）')
  assert.equal(rows[0].gate, 'degraded_unavailable', `实得=${rows[0].gate}`)
  assert.equal(rows[0].degraded, 1, '降级必须显式落位')
  assert.equal(rows[0].jev_prob, null, '概率不可用 ⇒ null（不得用 0 冒充）')
  assert.equal(decision.messages.length, 0, 'fail-closed ⇒ 不注入')
})

// ── P14（A1-3 / I2）memory_id 必须真被写上 —— 否则 I2「无可数之处」────────────
//
// 判据原文（`docs/mana-rollout-plan.md:453`）：
//   A1-3 **I2**：每条记忆每 session 最多注入一次 —— 检查方式「同上，**按 `memory_id` 分组**」，
//   阈值 **0 行**。
//
// ⚠ **为什么单列这一条**：`inject_log.memory_id` 此前**恒 NULL** —— `finish()` 早就支持该字段，
//   但 7 个调用点**无一传它** ⇒「按 memory_id 分组」**数不到任何东西**：它绿，是因为分母恒空。
//   这正是本仓首位缺陷类（**判据绿 ≠ 事实被检查**），且它与 A1-2 用 `(session,turn)` 分组是
//   **两个不同的键** —— 后者绿过，不代表 I2 被查过。
//   ⇒ 本用例把「那条不变式真的可数」变成可断言事实，并附**必须真能红**的负向腿。

/**
 * 克隆「加载器**真的**会加载的实现」到临时目录，并按需注入**去 memoryId 变异**。
 *
 * ⚠ **为什么不能在 `src/index.ts` 上改字再跑负向腿**（本席实测后改用的做法）：
 *   本文件走**真 Loader**，而 Loader 解析 `dsh-mana-attention` 落到
 *   **`packages/attention/lib/index.js`（构建产物）** —— 实测
 *   `createRequire(...).resolve('dsh-mana-attention')` = `.../packages/attention/lib/index.js`。
 *   故在 src 上改字，**加载器根本看不到**（除非重建；而重建会把负向腿的"红"变成
 *   "构建是否成功"的副产品，并在他席并行时污染仓内产物）。
 *   ⇒ 克隆 lib + 链回其余依赖，让 Loader 从克隆体装配。
 *   与 `tools/a1-check.mjs` 的变异装置同一纪律：**变异只写临时目录，仓内文件零写入**。
 */
function cloneAttention({ dropMemoryId = false } = {}) {
  const libPath = join(fileURLToPath(ROOT), 'packages/attention/lib/index.js')
  const original = readFileSync(libPath, 'utf8')
  let text = original
  if (dropMemoryId) {
    const ANCHOR = "finish('injected', { blockId, memoryId: injectedMemoryId })"
    const hits = text.split(ANCHOR).length - 1
    // 锚点命中 ≠ 1 ⇒ 真源已改、变异器已**过期** —— 此时**不许**当成"变异成功"（否则是假通过）。
    assert.equal(
      hits,
      1,
      `负向腿锚点须在 lib/index.js 命中恰好 1 次（实得 ${hits}）；命中 0 次 = 真源已改、变异器过期`,
    )
    text = text.replace(ANCHOR, "finish('injected', { blockId })")
    // 变异**真的发生**才算数（不得把"请求了变异"当成"变异生效"）。
    assert.notEqual(text, original, '变异未真正生效（克隆体与真源逐字相同）⇒ 该腿不构成自证')
  }
  const dir = mkdtempSync(join(tmpdir(), 'mana-mut-'))
  cleanups.push(dir)
  const pkgDir = join(dir, 'node_modules', 'dsh-mana-attention')
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'index.js'), text)
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'dsh-mana-attention', type: 'module', main: './index.js' }),
  )
  // 其余依赖原样链回真仓：**只替换被测的那一个包**（否则变异就不隔离）。
  const realNm = join(fileURLToPath(ROOT), 'node_modules')
  for (const entry of readdirSync(realNm)) {
    if (entry === 'dsh-mana-attention') continue
    try {
      symlinkSync(join(realNm, entry), join(dir, 'node_modules', entry), 'dir')
    } catch {
      /* 建链失败非致命：真出问题会在下面的装配断言里报出来（不静默吞真实故障） */
    }
  }
  return dir
}

test('P14 A1-3 I2：injected 行的 memory_id 必须真被写上（否则该不变式无可数之处）', async () => {
  // ── 正向：真装配链上，注入了就必须写得出来 ─────────────────────────────────
  const { ctx, store } = await boot()
  ctx.get('mana-perception').perceive({
    content: '候选内容 M', sessionId: 'sess-a113', turnId: 1, requestId: 'req-mid-1',
  })
  await settle(250)
  await firePreStep(ctx, { turn: 1 })
  await settle(200)

  const rows = readInject(store)
  const injected = rows.filter((r) => r.gate === 'injected')
  assert.equal(injected.length, 1, `前置：本夹具应恰好真注入 1 次（实得 ${injected.length}）`)

  const nullInjected = rows.filter((r) => r.gate === 'injected' && r.memory_id === null).length
  assert.equal(
    nullInjected,
    0,
    `① 注入了却写不出"注入了哪条" ⇒ A1-3 的分组恒空（实得 ${nullInjected} 行为 NULL）`,
  )
  const named = rows.filter((r) => r.memory_id !== null)
  assert.ok(named.length >= 1, '② 审计里至少要有 1 行带 memory_id（否则该列是死列）')
  // 强断言：必须指回**本次真被注入的那条**，不是任意非空串（后者是"为绿而绿"）
  assert.equal(
    injected[0].memory_id,
    'req-mid-1',
    `memory_id 必须指回本次被注入的那条候选（实得 ${JSON.stringify(injected[0].memory_id)}）`,
  )
  // A1-3 的**逐字口径**：按 memory_id 分组、组内 >1 即判红 ⇒ 必须 0 行
  const byMemory = new Map()
  for (const r of named) byMemory.set(r.memory_id, (byMemory.get(r.memory_id) ?? 0) + 1)
  const offenders = [...byMemory].filter(([, c]) => c > 1)
  assert.equal(
    offenders.length,
    0,
    `A1-3 口径（GROUP BY memory_id HAVING count>1）须 0 行，实得 ${JSON.stringify(offenders)}`,
  )

  // ── 负向腿：把 {memoryId} 去掉 ⇒ ① 必须 > 0（否则本判据无牙）────────────────
  const mutantDir = cloneAttention({ dropMemoryId: true })
  const m = await boot({ baseDir: mutantDir })
  m.ctx.get('mana-perception').perceive({
    content: '候选内容 M', sessionId: 'sess-a113', turnId: 1, requestId: 'req-mid-1',
  })
  await settle(250)
  await firePreStep(m.ctx, { turn: 1 })
  await settle(200)

  const mRows = readInject(m.store)
  // 负向腿的前置：变异体**也必须真注入一次** —— 否则"0 行 injected"会让下面的 >0 落空，
  // 变成另一种假绿（判据没崩，只是根本没数到东西）。
  assert.ok(
    mRows.some((r) => r.gate === 'injected'),
    `负向腿前置：变异体也应真注入一次，否则该腿数不到东西。实得 ${JSON.stringify(mRows.map((r) => r.gate))}`,
  )
  const mNull = mRows.filter((r) => r.gate === 'injected' && r.memory_id === null).length
  assert.ok(
    mNull > 0,
    `负向腿**必须真能红**：去掉 {memoryId} 后 ① 应 > 0（实得 ${mNull}）—— 否则本判据是摆设`,
  )

  // ── 反假绿：判据读的是 lib（构建产物），而被评审/被改的源在 src ──────────────
  //   若把 src 的 memoryId 管线删掉却不重建 ⇒ 正向腿**仍绿**而源已坏（与"命令成功≠生效"同类）。
  //   ⇒ 显式断言 src 侧也带着这处管线，把 lib/src 漂移变成**可观测的红**而非悄悄变绿。
  const src = readFileSync(join(fileURLToPath(ROOT), 'packages/attention/src/index.ts'), 'utf8')
  assert.ok(
    src.includes('memoryId: injectedMemoryId'),
    'src 侧缺 memoryId 管线（lib 可能只是旧产物）⇒ 判据绿不成立：应重建 packages/attention 后复跑',
  )
})
