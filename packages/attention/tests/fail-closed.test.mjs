/**
 * 面② **fail-closed 双向腿**（本包自有判据面 · F2 席新建）。
 *
 * 判据原文：`docs/contract/degradation.md:23`「Injection Gate 的失败策略是 fail-closed
 * （不注入、沉默优于噪音）。其**正常态与故障态在表面上完全同形**（都是「没注入」）」
 * 与 `:18-19`（A1-14：注入块数 == 0 **并且** `inject_log` 仍新增 `degraded_unavailable` 行，两条都要真）。
 *
 * ⚠ **本档的重心是「反向腿」**：只证明「故障时不注入」是**平凡通过** ——
 *   一个永远不注入的实现同样满足它。必须同时证明「正常态**必须**注入」，
 *   两条腿合起来才把「沉默优于噪音」与「静默失效」分开。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, firePreStep, perceive, readInject, readTrace, messageText } from './_harness.mjs'

// ── ① 故障态：判定链降级 ⇒ 不注入（fail-closed）────────────────────────────
test('G2-① 故障态 fail-closed：判定链降级 ⇒ 注入块 == 0，但**必须**新增留痕行', async () => {
  const { ctx, store } = await boot({ judge: 'degraded' })
  perceive(ctx, { content: '候选·故障态', requestId: 'req-down' })

  const before = readInject(store).length
  const decision = await firePreStep(ctx, { turn: 1 })
  const rows = readInject(store)

  assert.equal(decision.messages.length, 0, '① 降级却注入了 ⇒ fail-open（把「沉默优于噪音」违反成「宁滥勿缺」）')
  assert.equal(rows.length, before + 1, '② 不注入就了事 ⇒ 那是「静默」不是「fail-closed」（A1-14 两条都要真）')
  assert.equal(rows[rows.length - 1].gate, 'degraded_unavailable', `实得 ${rows[rows.length - 1].gate}`)
  assert.equal(rows[rows.length - 1].degraded, 1)
})

// ── ② 正常态：判定链可用且过阈 ⇒ **必须**注入（反向腿）──────────────────────
test('G2-② 正常态必须注入（反向腿）：不注入的实现无法通过本条', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选·正常态', requestId: 'req-up' })

  const decision = await firePreStep(ctx, { turn: 1 })
  const rows = readInject(store)

  assert.equal(decision.messages.length, 1, '正常态却不注入 ⇒ 门控恒闭（与 fail-closed 表面同形，但那是失效）')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].gate, 'injected', `正常态实得 ${rows[0].gate}`)
  // 注入的**是那一条**：内容真进了块，不是空块占位
  const text = messageText(decision.messages[0])
  assert.ok(text.includes('候选·正常态'), `注入块里没有候选内容 ⇒ 注入了个空壳：${text}`)
})

// ── ③ 两条腿必须**可分辨**（这正是 fail-closed 存在的理由）──────────────────
test('G2-③ 故障态与正常态必须可分辨：二者的 inject_log 读数不得同形', async () => {
  const down = await boot({ judge: 'degraded' })
  perceive(down.ctx, { content: '同一候选', requestId: 'req-same' })
  const dDown = await firePreStep(down.ctx, { turn: 1 })
  const rDown = readInject(down.store)

  const up = await boot({ judge: 'ok' })
  perceive(up.ctx, { content: '同一候选', requestId: 'req-same' })
  const dUp = await firePreStep(up.ctx, { turn: 1 })
  const rUp = readInject(up.store)

  // 表面同形：两条路径都不「报错」、返回类型同为 enter
  assert.equal(dDown.kind, 'enter')
  assert.equal(dUp.kind, 'enter')
  assert.equal(dDown.messages.length + 1, dUp.messages.length, '前置：差别只在块数上')
  // 但审计面必须**可分**：gate / degraded / jev_prob 三列各自有值
  assert.notEqual(rDown[0].gate, rUp[0].gate, '故障态与正常态在 gate 上同形 ⇒ 这类缺陷永远查不出来')
  assert.notEqual(rDown[0].degraded, rUp[0].degraded, 'degraded 列必须把两者分开（G8）')
  assert.equal(rDown[0].jev_prob, null, '降级 ⇒ 概率 null（不得用 0 冒充）')
  assert.equal(typeof rUp[0].jev_prob, 'number', '正常态 ⇒ 概率必须是真读数（不是 null）')
})

// ── ④ 降级必须同时有 degraded=true 与**非空 reason**（degradation.md:13）─────
test('G2-④ 每次降级同时给 degraded 与非空 reason（且 reason 真落在 trace 里）', async () => {
  const { ctx, store } = await boot({ judge: 'degraded' })
  perceive(ctx, { content: '候选·留痕理由', requestId: 'req-reason' })
  await firePreStep(ctx, { turn: 1 })

  const rows = readInject(store)
  assert.equal(rows[0].gate, 'degraded_unavailable')
  assert.equal(rows[0].degraded, 1, 'degraded 列必须为真')

  // `inject_log` 没有 reason 列 ⇒ 理由的落点是 decision 段（mana_trace），在此真读一次：
  const decisions = readTrace(store).filter((t) => t.event_type === 'decision')
  assert.equal(decisions.length, 1, `降级轮应恰好有一条 decision 段（实得 ${decisions.length}）`)
  const payload = JSON.parse(decisions[0].payload)
  assert.equal(payload.degraded, true, '降级必须显式落位到事件载荷')
  assert.equal(typeof payload.reason, 'string', `reason 必须是非空字符串（degradation.md:13），实得 ${JSON.stringify(payload.reason)}`)
  assert.ok(payload.reason.length > 0, 'reason 不得为空串')
  assert.equal(payload.value, 'unknown', "降级时 value 必须是 'unknown'（不得默认成 'no'：那会把故障读成一个正常的否定结论）")
  assert.equal(payload.probability, null, '概率不可用 ⇒ null')
})

// ── ⑤ 判定链**抛错** ⇒ 同样 fail-closed 且留痕（异常路径不得吞掉下游）────────
test('G2-⑤ 判定链抛错：仍不注入、仍留痕，且**不得**把异常抛穿 pre-step', async () => {
  const { ctx, store } = await boot({ judge: 'throw' })
  perceive(ctx, { content: '候选·判定链爆炸', requestId: 'req-boom' })

  // 不 await 断言「不抛」是弱形态 —— 直接 await，抛了本用例就红（这才是断言的牙）
  const decision = await firePreStep(ctx, { turn: 1 })
  const rows = readInject(store)

  assert.equal(decision.kind, 'enter', '判定链抛错不得让整个 pre-step 炸掉（宿主循环优先）')
  assert.equal(decision.messages.length, 0, '判定链不可用 ⇒ fail-closed 不注入')
  assert.equal(rows.length, 1, '抛错路径同样必须留痕')
  assert.equal(rows[0].gate, 'degraded_unavailable', `抛错应归入不可用：实得 ${rows[0].gate}`)
  assert.equal(rows[0].jev_prob, null)

  const decisions = readTrace(store).filter((t) => t.event_type === 'decision')
  const payload = JSON.parse(decisions[0].payload)
  assert.ok(String(payload.reason).includes('judge-threw'), `reason 应如实记下异常来源，实得 ${JSON.stringify(payload.reason)}`)
})

// ── ⑥ 留痕失败**不得**吞掉下游（G8 显式记账 + next() 义务）───────────────────
//
// 变异的对象是 **core 的 lib**：把 `insertInjectLog` 的 INSERT 打到不存在的表上 ⇒
// `writeInjectLog` 抛错 ⇒ 走 attention 的 catch 分支（`ctx.emit('mana/plugin/inactive', …)`）。
// ⚠ 这条腿同时是 G9 的一次真实演练：**catch 之后仍必须把控制权交给下游**。
test('G2-⑥ 写 inject_log 失败：下游仍必须被调到，且失败走 mana/plugin/inactive 显式记账', async () => {
  const inactive = []
  const { ctx, store, arm, downstreamCount } = await boot({
    judge: 'ok',
    hook: (c) => c.on('mana/plugin/inactive', (p) => inactive.push(p)),
    coreMutant: { replace: [['INSERT INTO inject_log', 'INSERT INTO no_such_table_xyz']] },
  })
  perceive(ctx, { content: '候选·留痕会失败', requestId: 'req-inactive' })
  const off = arm()

  const decision = await firePreStep(ctx, { turn: 1 })
  const rows = readInject(store)
  const hits = downstreamCount()
  off()

  assert.equal(rows.length, 0, '前置：留痕确实失败了（否则本腿没打到靶上）')
  assert.equal(inactive.length, 1, '留痕失败必须在 mana/plugin/inactive 上显式记账（不得静默吞掉）')
  assert.equal(inactive[0].id, 'mana-attention')
  assert.ok(
    inactive[0].missing.some((m) => m.includes('inject_log 写入失败')),
    `missing 应点明失败面，实得 ${JSON.stringify(inactive[0].missing)}`,
  )
  assert.equal(hits, 1, '留痕失败**不得**连带吞掉下游（G8 记账与 G9 的 next() 义务是两件事）')
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1, '留痕失败不得连带吞掉正常注入决策')
})
