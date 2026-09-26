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
/**
 * 变异锚点（本批 impl 席**同步改名并写明理由** —— 原锚点是 `const downstream = await next();`，
 * 本批把 D2 守卫需要的运行时接住点改成 `const nextResult = await next()`）。
 * ⚠ 本批**没有搬动 next() 的调用位置**：lib:363 仍是那唯一一行，仍是自包门控内；
 *   改的只是接住变量的名字（因为返回值现在要先按 `unknown` 接、再由 D2 守卫判可用性）。
 * ⚠ 新锚点同样必须**恰好命中 1 次** —— 否则 applyMutation 会抛（这正是"变异没生效不可静默"的机制）。
 */
const DROP_NEXT = { replace: [['const nextResult = await next()', 'const nextResult = undefined']] }

/**
 * ⚠ **本批（impl 席 · attention D2）对该变异腿的**重定位**记录 —— 逐条说明，不是"顺带改好了"：
 *
 * 1. 变异体**仍然必须存在**：它证明「漏调 `next()` ⇒ 下游收不到控制权」。这是 G9 的本体，本批没碰。
 * 2. 本批**新增了 D2 守卫**（`downstream` 不是可用决策时**大声抛**）。于是同一个变异体
 *    **多出一个症状**：它现在**会抛**（修前是"静默吃掉宿主消息"）。两者都是"失败"，但形态不同：
 *       · G9 本体   = 控制权没交出去（下游 0 次）—— 由本腿的 `hits === 0` 断言钉住（不变）；
 *       · D2 新增面 = 上游丢了决策对象时必须**响亮**，不许静默吃消息（由 `Y-①`/`Z-②` 钉住）。
 * 3. 故本腿改判的是**症状描述**（"不报错"→"必须报错"），**不是**放宽要求：
 *    `hits === 0` 与 `审计仍写 injected 的第一行是"自己以为成功"` 两条都保留。
 *    ⚠ 若**不**改这一行，读到的会是"变异腿没牙"的假象 —— 而事实上是判据跟着实现变准了。
 * 4. 真正的"修前形态"由 `session-isolation.test.mjs` 的 `Z-②` 负控承担（它绕开守卫，
 *    露出"宿主消息被吃掉 + 审计写 injected"的真读数）。
 */
const DROP_NEXT_NOW_THROWS = '本批新增的 D2 守卫使该变异体从"静默"变为"响亮失败"（见上）'

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

  /**
   * ⚠ **本批（impl 席 · attention D2）改判此处 —— 逐条说明，不是"顺带修好了"**：
   *
   * 1. 变异体**仍然存在且仍然必须存在**：它证明「漏调 `next()` ⇒ 下游拿不到控制权」（G9 本体）。
   *    本腿的 `hits === 0` 断言**原样保留**，一个字没放宽。
   * 2. 本批**新增了 D2 守卫**（`next()` 返回值不是可用决策时**大声抛**）。同一个变异体因此
   *    **多出**一个症状：它现在**会抛**。修前它"静默吃掉宿主消息"，修后它"响亮失败" ——
   *    两者都是失败，但**可观测性不同**，而"让失败可观测"正是本批的标的。
   * 3. 故这里改判的是**症状描述**（"不报错"→"必须报错"），不是判据的牙：
   *    ① 控制权没交出去（`hits === 0`）② 门控自己仍以为成功（审计面读数）—— 两条都还在。
   *    ⚠ 若**不**改这一行，读数会变成"变异腿没牙"的假象；事实上是判据跟着实现变准了。
   * 4. **"修前形态"的证据没有丢**：由 `session-isolation.test.mjs` 的 `Z-②` 负控承担 ——
   *    它专挑守卫那一行做变异（同一行、单一变量），露出"宿主消息被整批吃掉 + 审计写 injected"的真读数。
   */
  assert.ok(threw, `变异体（漏调 next()）必须**响亮失败**（修后形态：D2 守卫把"上游吞掉决策"变成可观测错误）：实得 threw=${threw && threw.message}`)
  assert.equal(hits, 0, `变异体仍把控制权交给了下游（${hits} 次）⇒ 本判据无牙，或变异没打对靶`)
  /**
   * 审计面读数（**改判后的真实取值**，本席实测）：
   *   D2 守卫的**抛点在任何审计写入之前** ⇒ 变异体这里 `inject_log` 是 **0 行**。
   * ⚠ 这正是本批要的形态：修前是"写一行 injected 的假账、同时把宿主消息吃掉"（看起来成功）；
   *   修后是"**零行 + 响亮失败**"（没做就不留账）。两者**都**要能被判据分辨，故：
   *     · 本腿钉「漏调 next() ⇒ 下游 0 次 + 响亮失败 + 零行审计」；
   *     · "修前那条假账形态"由 `session-isolation.test.mjs` 的 `Z-②` 负控钉住
   *       （它绕开守卫 ⇒ 露出"1 行 injected 假账 + 宿主消息被吃掉"）。
   */
  const rows = readInject(store)
  assert.equal(rows.length, 0, `抛点在任何审计写入之前 ⇒ 不得留行（实得 ${rows.length}）—— "没做"不许留成"做了"的假账`)
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
