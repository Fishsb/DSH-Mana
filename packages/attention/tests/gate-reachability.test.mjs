/**
 * 面① **Injection Gate 五类 gate 可达性**（本包自有判据面 · F2 席新建）。
 *
 * 判据原文：`docs/contract/degradation.md:14-19`（5 类枚举、不得留空、fail-closed 不吞「未判」）
 * 与 `docs/mana-rollout-plan.md:473`（A1-13：每次 pre-step 留痕 + 5 类各有生产侧写入点）。
 *
 * ⚠ 本档的**关键纪律**：每一类都要有「**到达该类的证据**」，不许只断言「值合法」。
 *   判定值落在枚举内 ≠ 那条路径真的被走到过 —— 后者才是「失败可观测」的前提。
 *   故每类除断言 gate 取值外，另断言**让它走到那一类的那个事由确实是真发生的**
 *   （判定链桩真被调到 / 判定链真返回了 degraded / 块真的不在上下文里 / 宿主真的 reject 了）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GATES, boot, firePreStep, perceive, readInject, messageText } from './_harness.mjs'

const gatesOf = (rows) => rows.map((r) => r.gate)

// ── ① injected —— 真注入 ────────────────────────────────────────────────────
test('G1-① injected：真注入时既有审计行、又有消息块，且「注入了哪条」写得出来', async () => {
  const { ctx, store, judgeCalls } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选内容甲', requestId: 'req-alpha' })

  const before = readInject(store).length
  const decision = await firePreStep(ctx, { turn: 1 })
  const rows = readInject(store)

  // 到达该类的证据（不是「值合法」）：这一行是**本次分发**新增的，且 return 里真有块。
  assert.equal(rows.length, before + 1, `本次 pre-step 未新增审计行（前 ${before} → 后 ${rows.length}）`)
  assert.equal(rows[0].gate, 'injected', `实得 gate=${rows[0].gate}`)
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1, 'injected 却没返回块 ⇒ 审计说注入了、实际没注入')
  const block = messageText(decision.messages[0])
  assert.ok(block.includes('<mana-memory>'), `注入块缺 wrapper 标签：${block.slice(0, 80)}`)

  // 「判了才注入」也必须是真事实：判定链桩确实被调到，且读数落库。
  assert.equal(judgeCalls.length, 1, `判定链未被调却记 injected ⇒ 到达证据不成立（实得 ${judgeCalls.length} 次）`)
  assert.equal(judgeCalls[0].threshold, 0.7, '请求应带阈值（配置真源）')
  assert.equal(rows[0].memory_id, 'req-alpha', 'injected 行必须指回本次真被注入的那条候选')
  assert.equal(rows[0].block_id, 'blk-1', 'injected 行必须带块 id（reset 检测靠它）')
  assert.equal(rows[0].jev_prob, 0.95, 'jev_prob 应是判定链给的真读数（不得恒 null/用 0 冒充）')
  assert.equal(rows[0].degraded, 0)
})

// ── ② skip_below_threshold —— 判了但未过阈 ──────────────────────────────────
test('G1-② skip_below_threshold：判定链**真判过**且未过阈（与「没候选」必须可分辨）', async () => {
  const { ctx, store, judgeCalls } = await boot({ judge: 'below' }) // 0.2 < jevThreshold 0.7
  perceive(ctx, { content: '候选内容乙', requestId: 'req-beta' })

  const decision = await firePreStep(ctx, { turn: 1 })
  const rows = readInject(store)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].gate, 'skip_below_threshold', `实得 gate=${rows[0].gate}`)
  assert.notEqual(rows[0].gate, 'skip_no_candidate', '「判了没过阈」被记成「没候选」⇒ 门控为何没注入就说不清')
  assert.equal(decision.messages.length, 0, '未过阈 ⇒ 不得注入')
  // 到达证据：这条路径的语义是「判了」，故判定链**必须真被调到**且给出未过阈的概率。
  assert.equal(judgeCalls.length, 1, `判定链一次都没被调却记这一类 ⇒ 该腿无牙（实得 ${judgeCalls.length}）`)
  assert.equal(judgeCalls[0].state, 'S', '送判定链的 state 应是配置真值')
  assert.equal(rows[0].jev_prob, 0.2, '判过就必须留下真读数（恒 null 会把「判了」抹成「没判」）')
  assert.equal(rows[0].memory_id, null, '未注入 ⇒ memory_id 按政策表留 null（填了会让 A1-3 假红）')
})

// ── ③ degraded_unavailable —— 判定链明确说「不可用」 ────────────────────────
test('G1-③ degraded_unavailable：判定链**真返回 degraded**（非「没监听器」兜底），fail-closed 且留痕', async () => {
  const { ctx, store, judgeCalls } = await boot({ judge: 'degraded' })
  perceive(ctx, { content: '候选内容丙', requestId: 'req-gamma' })

  const decision = await firePreStep(ctx, { turn: 1 })
  const rows = readInject(store)

  assert.equal(rows.length, 1, '降级也必须留痕（A1-14：不得静默）')
  assert.equal(rows[0].gate, 'degraded_unavailable', `实得 gate=${rows[0].gate}`)
  assert.equal(rows[0].degraded, 1, '降级必须落显式字段（G8）')
  assert.equal(rows[0].jev_prob, null, '概率不可用 ⇒ null（不得用 0 冒充）')
  assert.equal(decision.messages.length, 0, 'fail-closed ⇒ 不注入')
  // 到达证据：本条锚定的是「判定链**明确降级**」这条路径 ⇒ 桩必须真被调到。
  assert.equal(judgeCalls.length, 1, '判定链未被调却记降级 ⇒ 与「没有监听器」的兜底混为一谈')

  // 旁证（同一类 gate 的第二条到达路径）：**无任何判定链监听器**时由本包自带的默认 next 兜底，
  // 仍落同一类 —— 两条路径都留痕，才说明 fail-closed 不是靠「恰好有人回话」。
  const bare = await boot({ judge: 'none' })
  perceive(bare.ctx, { content: '候选内容丁', requestId: 'req-delta' })
  const bareDecision = await firePreStep(bare.ctx, { turn: 1 })
  const bareRows = readInject(bare.store)
  assert.equal(bareRows.length, 1, '无判定链监听器时也必须留痕（否则是静默而非 fail-closed）')
  assert.equal(bareRows[0].gate, 'degraded_unavailable', `无监听器兜底路径实得 ${bareRows[0].gate}`)
  assert.equal(bareDecision.messages.length, 0, '兜底路径同样不得注入')
})

// ── ④ skip_no_candidate —— 三条**不同**事由都落这一类 ───────────────────────
test('G1-④ skip_no_candidate：候选池空 / 门控关闭 / 宿主 reject 三条事由各自真到达', async () => {
  // (a) 候选池空
  const a = await boot({ judge: 'ok' })
  const aDecision = await firePreStep(a.ctx, { turn: 1 })
  const aRows = readInject(a.store)
  assert.equal(aRows.length, 1)
  assert.equal(aRows[0].gate, 'skip_no_candidate', `(a) 候选池空实得 ${aRows[0].gate}`)
  assert.equal(aDecision.messages.length, 0, '(a) 无候选 ⇒ 不得注入')
  assert.equal(a.judgeCalls.length, 0, '(a) 候选池空就不该去问判定链（问了是多余往返）')

  // (b) 门控关闭：有候选但开关关掉 —— **仍须留痕**（「关掉了」与「静默失效」必须可分辨）
  const b = await boot({ judge: 'ok', injectionEnabled: false })
  perceive(b.ctx, { content: '有候选但门控关着', requestId: 'req-off' })
  const bDecision = await firePreStep(b.ctx, { turn: 1 })
  const bRows = readInject(b.store)
  assert.equal(bRows.length, 1, '(b) 开关关掉也必须留痕')
  assert.equal(bRows[0].gate, 'skip_no_candidate', `(b) 实得 ${bRows[0].gate}`)
  assert.notEqual(bRows[0].gate, 'injected', '(b) 关掉了却记 injected ⇒ 开关是死开关')
  assert.equal(bDecision.messages.length, 0, '(b) 关掉 ⇒ 不注入')

  // (c) 宿主 reject：更内层的监听器不调 next() 直接拒 —— 本门控必须**尊重宿主决策**且留痕
  const c = await boot({ judge: 'ok' })
  perceive(c.ctx, { content: '宿主会拒绝这一步', requestId: 'req-rej' })
  let sentinel = 0
  const off = c.ctx.on('agent/pre-step', async () => {
    sentinel += 1
    return { kind: 'reject' }
  })
  const cDecision = await firePreStep(c.ctx, { turn: 1 })
  off()
  const cRows = readInject(c.store)
  assert.equal(sentinel, 1, '(c) 下游哨兵未被调到 ⇒ 夹具没造出 reject 场景')
  assert.equal(cDecision.kind, 'reject', '(c) 夹具前置：宿主决策应为 reject')
  assert.equal(cRows.length, 1, '(c) 宿主 reject 也必须留痕')
  assert.equal(cRows[0].gate, 'skip_no_candidate', `(c) 实得 ${cRows[0].gate}`)
  assert.equal(cRows[0].memory_id, null, '(c) 没有记忆被注入 ⇒ memory_id 留 null')
})

// ── ⑤ reset —— 块离开上下文 ────────────────────────────────────────────────
test('G1-⑤ reset：块从上下文消失才记 reset；块仍在时**不得**记（否则 reset 恒真）', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选内容戊', requestId: 'req-eps' })

  const first = await firePreStep(ctx, { turn: 1 })
  assert.equal(readInject(store).filter((r) => r.gate === 'injected').length, 1, '前置：首次应真注入')
  const injectedMsg = first.messages[first.messages.length - 1]

  // ② 上下文里已没有那个块（模拟压缩/清空）⇒ 必须显式记 reset
  await firePreStep(ctx, { turn: 2, messages: [] })
  const rows = readInject(store)
  const resets = rows.filter((r) => r.gate === 'reset')
  assert.equal(resets.length, 1, `块已离开上下文却未记 reset ⇒ 那行 injected 成假账：${JSON.stringify(gatesOf(rows))}`)
  assert.equal(resets[0].turn_id, 2, 'reset 行应记在**发现它不在**的那一轮（到达证据：时序可读）')
  assert.equal(resets[0].memory_id, null, 'reset 行记的是「事件」不是注入 ⇒ memory_id 按政策表留 null')

  // ③ 反向腿：块**仍在**上下文里时不得误记（否则 reset 恒真 ⇒ 判据失效）
  await firePreStep(ctx, { turn: 3, messages: [injectedMsg] })
  const after = readInject(store).filter((r) => r.gate === 'reset').length
  assert.equal(after, 1, '块仍在上下文却重复记 reset ⇒ 「块消失」这件事被读成恒真')
})

// ── ⑥ 五类齐（单轮内驱动全部五类，逐类给出到达证据表）──────────────────────
test('G1-⑥ 五类枚举**全部可达**，且单轮举证全覆盖、无第六类', async () => {
  // 判定链用**本席可操纵的桩**（注册在包之后 ⇒ 更外层 ⇒ 先执行），以便在同一轮内逐类驱动。
  const { ctx, store } = await boot({ judge: 'none' })
  let mode = 'ok'
  ctx.on('mana/jev/judge', async (req) => {
    if (mode === 'ok') return { requestId: req.requestId, source: 'steered', value: 'yes', probability: 0.95, degraded: false, reason: null }
    if (mode === 'below') return { requestId: req.requestId, source: 'steered', value: 'no', probability: 0.2, degraded: false, reason: null }
    return { requestId: req.requestId, source: 'steered', value: 'unknown', probability: null, degraded: true, reason: 'steered-degraded' }
  })

  // t1 候选池空
  await firePreStep(ctx, { turn: 1 })
  // t2 真注入
  perceive(ctx, { content: '候选·甲', requestId: 'req-1' })
  const d2 = await firePreStep(ctx, { turn: 2 })
  // t3 块离开上下文
  await firePreStep(ctx, { turn: 3, messages: [] })
  // t4 判了未过阈
  mode = 'below'
  perceive(ctx, { content: '候选·乙', requestId: 'req-2' })
  await firePreStep(ctx, { turn: 4 })
  // t5 判定链降级
  mode = 'degraded'
  perceive(ctx, { content: '候选·丙', requestId: 'req-3' })
  const d5 = await firePreStep(ctx, { turn: 5 })

  const rows = readInject(store)
  const byTurn = Object.fromEntries(rows.map((r) => [r.turn_id, r.gate]))
  assert.deepEqual(
    byTurn,
    { 1: 'skip_no_candidate', 2: 'injected', 3: 'reset', 4: 'skip_below_threshold', 5: 'degraded_unavailable' },
    `五类未按预期逐类到达：${JSON.stringify(byTurn)}`,
  )
  // 集合等式：五类**全部**出现过（缺一类即判红），且**没有**枚举外的取值。
  assert.deepEqual(new Set(gatesOf(rows)), new Set(GATES), `五类可达性不成立：${JSON.stringify(gatesOf(rows))}`)
  for (const r of rows) {
    assert.ok(GATES.includes(r.gate), `枚举外取值：${JSON.stringify(r.gate)}`)
    assert.notEqual(r.gate, '')
    assert.notEqual(r.gate, null)
  }
  // 逐类到达证据：每类至少一行；且只有 injected 那一行带 memory_id（政策表可机检）。
  const named = rows.filter((r) => r.memory_id !== null).map((r) => r.gate)
  assert.deepEqual(named, ['injected'], `只有真注入那一类可带 memory_id，实得 ${JSON.stringify(named)}`)
  assert.equal(d2.messages.length, 1, 't2 应真注入一块')
  assert.equal(d5.messages.length, 0, 't5 降级 ⇒ 不得注入')
})
