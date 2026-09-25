/**
 * 面③ **`next()` 调用面**（G9 核心 · 本席最重要的产出）。
 *
 * 判据原文（`docs/mana-rollout-plan.md:175` G9）：`agent/pre-step` 是官方 **waterfall** 扩展点，
 * Mana 的 Injection Gate 与用户既有 shoucang 的两条**互相独立**注册链争同一扩展点
 * （`panel-inject.js:773` 与 `mcl.js:372`）——
 * 「Mana 若漏调 `next()` → **静默掐死用户现有的热记忆注入与 MCL 慢通道**，且不报错。
 *  ⚠ **只盯 773 一条链取证会假绿**（漏调时 773 可能仍绿而 372 已被掐死）。」
 *
 * 本档把「静默掐死下游」变成**必红**：三条腿合起来才算立住 ——
 *   ① 下游监听器**确实被调到**（含五类 gate 各路径）；
 *   ② 故障路径（判定链抛错 / 留痕失败）之后**仍**被调到；
 *   ③ **变异腿**：把 `await next()` 摘掉 ⇒ 下游**收不到** ⇒ 证明这条判据有牙。
 *
 * ⚠ 关于「下游」的定义（本席用真 waterfall 实测钉住，见 `_harness.mjs` 的注释）：
 *   cordis 的 `waterfall()` **按注册序**调用监听器，**没调 `next()` 的监听器否定整条链**
 *   （含内置默认行为）。⇒ 下单在**本包之后**注册的监听器才是「被掐死的下游」真身。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, firePreStep, perceive, readInject } from './_harness.mjs'

/** 单轮内驱动五条路径（candidate-empty / injected / reset / below-threshold / degraded）。 */
async function driveFivePaths(ctx, store, steer) {
  const seen = []
  // t1 候选池空
  await firePreStep(ctx, { turn: 1 })
  // t2 真注入
  perceive(ctx, { content: '候选·下游腿', requestId: 'req-ds-1' })
  await firePreStep(ctx, { turn: 2 })
  // t3 块离开上下文
  await firePreStep(ctx, { turn: 3, messages: [] })
  // t4 判了未过阈
  steer('below')
  perceive(ctx, { content: '候选·阈值', requestId: 'req-ds-2' })
  await firePreStep(ctx, { turn: 4 })
  // t5 判定链降级
  steer('degraded')
  perceive(ctx, { content: '候选·降级', requestId: 'req-ds-3' })
  await firePreStep(ctx, { turn: 5 })

  for (const r of readInject(store)) seen.push(r.gate)
  return seen
}

const EXPECTED_FIVE = ['skip_no_candidate', 'injected', 'reset', 'skip_below_threshold', 'degraded_unavailable']
/** 变异锚点：把「调用 next()」这一行摘掉（= 真源里 `const downstream = await next()`）。 */
const DROP_NEXT = { replace: [['const downstream = await next();', 'const downstream = undefined;']] }

// ── ① 五类路径下下游都拿得到控制权 ─────────────────────────────────────────
test('G3-① 五类 gate 路径下，下游监听器**每一次**都被调到（各 1 次，共 5 次）', async () => {
  const { ctx, store, arm, downstreamCount } = await boot({ judge: 'none' })
  let mode = 'ok'
  ctx.on('mana/jev/judge', async (req) => {
    if (mode === 'ok') return { requestId: req.requestId, source: 'steered', value: 'yes', probability: 0.95, degraded: false, reason: null }
    if (mode === 'below') return { requestId: req.requestId, source: 'steered', value: 'no', probability: 0.2, degraded: false, reason: null }
    return { requestId: req.requestId, source: 'steered', value: 'unknown', probability: null, degraded: true, reason: 'steered' }
  })
  const off = arm()
  const gates = await driveFivePaths(ctx, store, (m) => { mode = m })
  const hits = downstreamCount()
  off()

  // 夹具前置：五类确实都到达了（否则本腿只是在给「没注入」也数不出东西）
  assert.deepEqual(gates, EXPECTED_FIVE, `前置：五类未按预期到达 ${JSON.stringify(gates)}`)
  assert.equal(hits, 5, `下游哨兵只被调到 ${hits}/5 次 ⇒ 有路径没把控制权交出去（G9：静默掐死下游）`)
})

// ── ② 两条**独立**下游链都必须被调到（G9 的「只盯一条链会假绿」）────────────
test('G3-② 两条互相独立的下游链（模拟 shoucang 773 与 372）**各自**都被调到', async () => {
  const { ctx, store, arm } = await boot({ judge: 'ok' })
  const chain = { 'chain-A(panel-inject:773 形态)': 0, 'chain-B(mcl:372 形态)': 0 }
  const offA = ctx.on('agent/pre-step', async (_p, next) => {
    chain['chain-A(panel-inject:773 形态)'] += 1
    return await next()
  })
  const offB = ctx.on('agent/pre-step', async (_p, next) => {
    chain['chain-B(mcl:372 形态)'] += 1
    return await next()
  })
  const outer = arm()
  perceive(ctx, { content: '候选·双链', requestId: 'req-two' })
  await firePreStep(ctx, { turn: 1 })
  outer(); offA(); offB()

  for (const [name, n] of Object.entries(chain)) {
    assert.equal(n, 1, `${name} 未被调到 ⇒ 该链被静默掐死（「只盯另一条链取证」会假绿）`)
  }
})

// ── ③ 故障路径（判定链抛错 / 留痕失败）之后仍必须交出控制权 ─────────────────
test('G3-③ 判定链抛错路径：下游**仍**必须被调到（异常不得吃掉 next()）', async () => {
  const { ctx, store, arm, downstreamCount } = await boot({ judge: 'throw' })
  perceive(ctx, { content: '候选·抛错', requestId: 'req-throw-ds' })
  const off = arm()
  const decision = await firePreStep(ctx, { turn: 1 })
  const hits = downstreamCount()
  off()

  assert.equal(decision.messages.length, 0, '前置：抛错 ⇒ fail-closed 不注入')
  assert.equal(readInject(store).length, 1, '前置：抛错路径仍留痕')
  assert.equal(hits, 1, '判定链抛错后就吞掉下游 ⇒ 一个插件故障掐死整条 pre-step 链')
})

test('G3-③′ 留痕失败路径：下游**仍**必须被调到（catch 之后不得吞掉控制权）', async () => {
  const { ctx, store, arm, downstreamCount } = await boot({
    judge: 'ok',
    coreMutant: { replace: [['INSERT INTO inject_log', 'INSERT INTO no_such_table_xyz']] },
  })
  perceive(ctx, { content: '候选·留痕失败', requestId: 'req-catch-ds' })
  const off = arm()
  const decision = await firePreStep(ctx, { turn: 1 })
  const hits = downstreamCount()
  off()

  assert.equal(readInject(store).length, 0, '前置：留痕确实失败')
  assert.equal(hits, 1, '留痕失败被 catch 吞掉后就吞掉下游 ⇒ 「记账」与「交出控制权」必须分开')
  assert.equal(decision.messages.length, 1, '留痕失败不得连带改变注入决策')
})

// ── ④ 变异腿：摘掉 `await next()` ⇒ 下游收不到（**本条判据的牙**）─────────
test('G3-④ 变异腿：摘掉 next() ⇒ 下游收不到、**不报错**、且宿主本步的消息被静默丢弃', async () => {
  /** 宿主本步送进来的既有消息：不调 next() 时它会被**静默丢掉**（见下方 (b)）。 */
  const existing = { id: 'm-1', role: 'user', content: [{ type: 'text', text: '历史第 1 条' }], source: { kind: 'user' } }

  // (a) 正向对照：同一份夹具、同一套驱动，未变异时：下游 1 次 + 既有消息原样出现在返回值里
  {
    const { ctx, store, arm, downstreamCount } = await boot({ judge: 'ok' })
    perceive(ctx, { content: '候选·正对照', requestId: 'req-ctl' })
    const off = arm()
    const decision = await firePreStep(ctx, { turn: 1, messages: [existing] })
    const hits = downstreamCount()
    off()
    assert.equal(hits, 1, '正向对照腿就该被调到 1 次 —— 否则后面的 0 次不能归因于变异')
    assert.equal(decision.kind, 'enter')
    assert.equal(decision.messages.length, 2, '对照腿：既有 1 条 + 注入 1 条')
    assert.equal(decision.messages[0].id, 'm-1', '对照腿：既有消息必须原样在返回值里')
  }

  // (b) 变异体：`const downstream = await next()` → `const downstream = undefined`
  const { ctx, store, arm, downstreamCount, dir } = await boot({ judge: 'ok', mutant: DROP_NEXT })
  assert.ok(dir, '变异体应从临时目录装载（仓内零写入）')
  perceive(ctx, { content: '候选·变异体', requestId: 'req-mut' })
  const off = arm()
  let threw = null
  let decision
  try {
    decision = await firePreStep(ctx, { turn: 1, messages: [existing] })
  } catch (e) {
    threw = e
  }
  const hits = downstreamCount()
  off()

  assert.equal(threw, null, `变异体不应抛错（G9 的要害正是「**不报错**」）：${threw && threw.message}`)
  assert.equal(hits, 0, `变异体仍把控制权交给了下游（${hits} 次）⇒ 本判据无牙，或变异没打对靶`)
  /**
   * ⚠ **实测读数（比"返回 undefined"更糟，故按实测改写断言）**：
   *   宿主送进来的既有消息**被静默丢弃** —— 变异体返回的是
   *   `{kind:'enter', messages:[注入块]}`（它把 `downstream?.messages` 当成了空数组），
   *   于是本步真正该进入模型的那批消息**一条都不剩**。
   *   ⇒ 「不调 next()」不是"少做一件事"，而是**把宿主本步的输入吃掉**。
   */
  assert.equal(decision.messages.length, 1, `变异体返回值应只剩注入块（实得 ${decision.messages.length} 条）`)
  assert.ok(
    !decision.messages.some((m) => m.id === 'm-1'),
    '变异体竟保留了宿主消息 ⇒ 说明它是从别处拿到的（本腿的因果链不成立，须重新定位）',
  )
  // 审计面仍写着 injected（门控自己以为成功了）—— 「看起来成功」与「下游全死」同形
  const rows = readInject(store)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].gate, 'injected', '变异体自己仍记 injected ⇒ 「自己以为注入了」不能作为下游存活的证据')
})

// ── ⑤ 每步恰好调用一次（不得 0 次、也不得把下游调两次）─────────────────────
test('G3-⑤ next() 恰好 1 次/步：下游不得被重复调用（重复 = 下游行为跑两遍）', async () => {
  const { ctx, store, arm, downstreamCount } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选·计数', requestId: 'req-once' })
  const off = arm()
  await firePreStep(ctx, { turn: 1 })
  const afterOne = downstreamCount()
  perceive(ctx, { content: '候选·计数乙', requestId: 'req-once-2' })
  await firePreStep(ctx, { turn: 2 })
  const afterTwo = downstreamCount()
  off()

  assert.equal(afterOne, 1, `单步应恰好把下游调 1 次（实得 ${afterOne}）`)
  assert.equal(afterTwo, 2, `两步累计应恰好 2 次（实得 ${afterTwo}）`)
  assert.equal(readInject(store).length, 2, '每次 pre-step 一行')
})
