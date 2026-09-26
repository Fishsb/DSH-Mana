/**
 * 面⑧ **会话分区面（D1）** 与 **上游吞掉 next() 返回值的防御面（D2）**（impl 席新建 · 2026-09-26）。
 *
 * ## D1 · 四处门控状态必须**按会话**分区
 *   修前：`pending` / `injectedRequests` / `injectedBlocks` / `lastJudgeProbability` 都是**插件实例级**。
 *   两条后果都必须被本档钉住，而不是只在报告里说：
 *     ① **串档**：A 会话的候选被注入 B 会话的步（X-①）；
 *     ② **I2 假绿**：I2 是「每条记忆**每 session** 最多注入一次」，实例级去重把它退化成
 *        **跨会话全局去重** —— A 会话注入过的 requestId，B 会话**永不再注入**（X-②）。
 *        这一条尤其危险：判据读到的仍是"没有重复注入"，看上去完全正常。
 *
 * ## D2 · 调了 `next()` 却不 return 其结果的上游
 *   这不是变异体 —— 它是**真实存在**的上游写法（观察者式：只想看一眼，忘了 `return`）。
 *   修前：本包把 `undefined` 当「决策里没有消息」⇒ 返回 `{kind:'enter', messages:[注入块]}`
 *   ⇒ 宿主本步要进模型的既有消息**整批消失**，且 `inject_log` 还写着 `injected`。
 *   修后：**大声抛**具名错误，且抛点在写审计**之前** ⇒ 不留假账（Y-①）。
 *
 * ## 纪律（沿用本包既有教训）
 *   · 变异打在 **lib**（判据真正读取的那一层），仓内零写入（`judgedSurface()` 前后逐字节比对）。
 *   · 每条对拍都先断言**前置成立**（真发生过多会话 / 真有上游），否则「没数到」会被读成「有牙」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, firePreStep, perceive, readInject, messageText, judgedSurface, ROOT } from './_harness.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const S1 = 'sess-alpha'
const S2 = 'sess-beta'
const injectedOf = (rows) => rows.filter((r) => r.gate === 'injected')
const rowOf = (rows, sid) => rows.filter((r) => r.session_id === sid)

// ══ X-① 双会话交错：候选池按会话分区（不串档）═══════════════════════════════
test('X-① 双会话交错：B 会话注入的是**自己的**候选，A 会话的候选不得串进 B', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })

  // s1 先有候选，并**保持不注入**（前置：分区里 s1 有 pending、s2 没有）
  perceive(ctx, { content: '甲会话的候选', requestId: 'req-alpha', sessionId: S1 })
  assert.equal(ctx.get('mana-attention').hasPending(S1), true, '前置：s1 应有待注入候选')
  assert.equal(ctx.get('mana-attention').hasPending(S2), false, '前置：s2 尚无任何候选')

  // s2 也来一条
  perceive(ctx, { content: '乙会话的候选', requestId: 'req-beta', sessionId: S2 })

  // s2 先走 pre-step：它只能看到自己的候选
  const d2 = await firePreStep(ctx, { turn: 1, sessionId: S2 })
  const text2 = messageText(d2.messages[d2.messages.length - 1])
  assert.ok(text2.includes('乙会话的候选'), `s2 的块里应有自己的候选，实得：${text2}`)
  assert.ok(!text2.includes('甲会话的候选'), `**串档**：s2 的块里出现了 s1 的候选 ⇒ 实例级状态未分区：${text2}`)

  // s1 再走：拿到自己的候选
  const d1 = await firePreStep(ctx, { turn: 1, sessionId: S1 })
  const text1 = messageText(d1.messages[d1.messages.length - 1])
  assert.ok(text1.includes('甲会话的候选'), `s1 的块里应有自己的候选，实得：${text1}`)

  // 审计面也按会话分开
  const rows = readInject(store)
  assert.equal(rowOf(rows, S1).length, 1, 's1 恰好 1 行审计')
  assert.equal(rowOf(rows, S2).length, 1, 's2 恰好 1 行审计')
  assert.equal(rowOf(rows, S1)[0].gate, 'injected')
  assert.equal(rowOf(rows, S2)[0].gate, 'injected')
})

// ══ X-② I2 是「每 session 一次」，不是「全进程一次」══════════════════════════
test('X-② I2 不得退化为跨会话全局去重：同一 requestId 在两个会话里**各自**可注入一次', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })

  perceive(ctx, { content: '共享候选内容', requestId: 'shared-req', sessionId: S1 })
  await firePreStep(ctx, { turn: 1, sessionId: S1 })
  // 同一 requestId 出现在**另一个**会话：I2 的口径是"每 session 一次" ⇒ 这里必须仍注入
  perceive(ctx, { content: '共享候选内容', requestId: 'shared-req', sessionId: S2 })
  const d2 = await firePreStep(ctx, { turn: 1, sessionId: S2 })

  const rows = readInject(store)
  assert.equal(injectedOf(rows).length, 2, `两个会话各应注入 1 次（实得 ${injectedOf(rows).length}）⇒ 若为 1，即'跨会话全局去重'把 I2 变成了别的东西：${JSON.stringify(rows.map((r) => [r.session_id, r.gate]))}`)
  assert.ok(messageText(d2.messages[d2.messages.length - 1]).includes('共享候选内容'), 's2 应真拿到块（被全局去重掐掉时会记 skip_no_candidate）')

  // 反面：**同一会话内**同 requestId 仍必须只注一次（I2 的本体，不得被本批改动放宽）
  perceive(ctx, { content: '共享候选内容', requestId: 'shared-req', sessionId: S2 })
  const d3 = await firePreStep(ctx, { turn: 2, sessionId: S2 })
  assert.equal(messageText(d3.messages[d3.messages.length - 1]).includes('共享候选内容'), false, '同会话内重复 requestId 不得再注入（I2 本体）')
})

// ══ X-③ reset 检测按会话：别的会话的块不在我的上下文里 ═══════════════════════
test('X-③ reset 逐块检测必须按会话：s1 的块不在 s2 的上下文里，不得记成 reset', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '甲块', requestId: 'req-r1', sessionId: S1 })
  const d1 = await firePreStep(ctx, { turn: 1, messages: [], sessionId: S1 })
  const blk1 = d1.messages[d1.messages.length - 1]

  // s2 走一步，**上下文里没有 s1 的块**：实例级实现会据此记一行 reset（假账）
  await firePreStep(ctx, { turn: 1, messages: [], sessionId: S2 })
  // s1 自己的块仍应被跟踪（下两步后它离开上下文时必须记 reset —— 证明跟踪没被分区弄丢）
  await firePreStep(ctx, { turn: 2, messages: [blk1], sessionId: S1 })
  const rows = readInject(store)
  assert.equal(rowOf(rows, S2).filter((r) => r.gate === 'reset').length, 0, 's2 里不得出现 s1 的 reset 行')
  assert.equal(rowOf(rows, S1).filter((r) => r.gate === 'reset').length, 0, 's1 的块仍在上下文里 ⇒ 不得记 reset')

  await firePreStep(ctx, { turn: 3, messages: [], sessionId: S1 })
  const after = readInject(store)
  assert.equal(rowOf(after, S1).filter((r) => r.gate === 'reset').length, 1, 's1 的块真离开上下文后，分区跟踪必须仍能记出 1 行 reset')
})

// ══ X-④ 会话结束释放分区（有界、显式）═══════════════════════════════════════
test('X-④ 会话分区可释放且有上界读数（"该清没清"必须可观测）', async () => {
  const { ctx } = await boot({ judge: 'ok' })
  const att = ctx.get('mana-attention')
  perceive(ctx, { content: '候选·释放', requestId: 'req-rel', sessionId: 'sess-tmp' })
  assert.equal(att.hasPending('sess-tmp'), true, '前置：该会话应有分区')
  const before = att.sessionCount()
  assert.ok(before >= 1, `分区表应在动（实得 ${before}）`)

  assert.equal(att.releaseSession('sess-tmp'), true, '释放已存在的会话分区应返回 true（不静默）')
  assert.equal(att.hasPending('sess-tmp'), false, '释放后该会话不得再有候选')
  assert.equal(att.sessionCount(), before - 1, '分区数应减 1')
  assert.equal(att.releaseSession('sess-tmp'), false, '重复释放应返回 false（"删了"与"本来就没有"必须可分辨）')
  assert.equal(att.maxSessions >= 1, true, `上界必须是可读的真值，实得 ${att.maxSessions}`)
})

// ══ Y-① **下游**调 next() 却不 return ⇒ 大声抛、不留假账、下游确实被调到 ═════
/**
 * ⚠ **触发条件必须写对（本席第一版写错了，如实记下）**：`downstream` 变 `undefined` 的那个监听器
 *   必须是本包的**下游**（在本包**之后**注册 = 洋葱的内层）。
 *   若把吞返回值的监听器挂在本包**之前**（外层），那影响的是它**上面**的调用者，
 *   本包收到的 `downstream` 仍是良定义的 —— 那是**另一个**缺陷类（宿主看到 undefined），
 *   不是本批要修的 D2。判据若按错的位置写，就会变成"打错靶的绿"。
 *   ⇒ 本档用真分发通道注册**内层**观察者式监听器（`await next()` 但 `return` 缺省）。
 */
test('Y-① 下游吞掉 next() 返回值：本包必须**响亮失败**且 inject_log 不得新增行', async () => {
  const { ctx, store, attention, arm, downstreamCount } = await boot({ judge: 'ok' })
  /** 越内层越晚注册：这条挂在本包（已装载）之后 ⇒ 本包的 `next()` 会**落到它上面**。 */
  const swallower = ctx.on('agent/pre-step', async (_p, next) => { await next() /* 忘了 return */ })
  perceive(ctx, { content: '候选·下游吞决策', requestId: 'req-swallow', sessionId: S1 })
  const off = arm() // 更内层哨兵：证明控制权确实交到了下游
  const before = readInject(store).length
  let threw = null
  try {
    await firePreStep(ctx, { turn: 1, sessionId: S1 })
  } catch (e) { threw = e }
  const hits = downstreamCount()
  off(); swallower()

  assert.equal(hits, 1, `前置：更内层的哨兵应被进入 1 次（实得 ${hits}）—— 0 次说明这是"漏调 next()"而不是"吞掉返回值"`)
  assert.ok(threw, '下游把 next() 的返回值丢掉时，本包**必须抛**（静默吃掉宿主消息 = 首位缺陷类）')
  assert.equal(String(threw.message), attention.upstreamSwallowedError, `抛出的应是本包的具名错误（可被上层分类），实得：${String(threw.message).slice(0, 80)}`)
  assert.equal(readInject(store).length, before, '抛点在写审计之前 ⇒ inject_log **不得**新增任何行（"没做"不许留成"做了"）')
})

// ══ Z-① 负控：把分区改回**全局** ⇒ X-② 的 I2 腿必红 ═════════════════════════
test('Z-① 负控：门控状态改回实例级（全局去重）⇒ 跨会话注入被掐掉（X-② 必红）', async () => {
  const before = judgedSurface()
  const b = await boot({
    judge: 'ok',
    // 一个锚点：把「按会话取分区」改成「所有会话共用同一个分区」——即修前的形态。
    mutant: { replace: [['const state = sessionStateFor(sid);', "const state = sessionStateFor('GLOBAL');"]] },
  })
  assert.ok(b.attention, 'Z-①：变异体必须真被装载')
  assert.notEqual(readFileSync(join(b.dir, 'attention-mutant.mjs'), 'utf8'), readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'), 'Z-①：变异未生效')

  perceive(b.ctx, { content: '共享候选内容', requestId: 'shared-req', sessionId: S1 })
  await firePreStep(b.ctx, { turn: 1, sessionId: S1 })
  perceive(b.ctx, { content: '共享候选内容', requestId: 'shared-req', sessionId: S2 })
  await firePreStep(b.ctx, { turn: 1, sessionId: S2 })
  const rows = readInject(b.store)

  assert.equal(rowOf(rows, S1).filter((r) => r.gate === 'injected').length, 1, '前置：s1 仍应注入 1 次')
  assert.equal(
    rowOf(rows, S2).filter((r) => r.gate === 'injected').length,
    0,
    '变异体（全局去重）下 s2 **不得**注入成功 —— 若这里仍为 1，说明 X-② 这条腿没打到靶上',
  )
  assert.deepEqual(judgedSurface(), before, 'Z-①：对拍不得写仓（sha256 逐字节比对）')
})

// ══ Z-② 负控：摘掉 D2 守卫 ⇒ 下游吞决策时静默吃掉宿主消息 + inject_log 写假账 ══
test('Z-② 负控：摘掉 D2 守卫 ⇒ 宿主本步消息被静默吃掉，且审计仍写 injected（假账）', async () => {
  const before = judgedSurface()
  const b = await boot({
    judge: 'ok',
    /**
     * 一个锚点：把守卫的**第一个分支**摘掉 —— 即修前的形态（把 `undefined` 当"决策里没有消息"）。
     * ⚠ 锚点随实现改名同步（f2 席）：守卫现在拆成两条具名错误（`ERR_UPSTREAM_SWALLOWED` 真·吞决策 /
     *   `ERR_MALFORMED_DECISION` 形状不合契约），本负控要复现的是**前者**（`undefined` 那条）。
     *   若锚点失配，`applyMutation` 会直接抛（不静默）——这正是本仓变异器的设计。
     */
    /**
     * 一个锚点：摘掉**整个守卫调用**（即修前形态：没有任何守卫）。
     * ⚠ 锚点 = `assertUsableDecision(downstream)`，在本包 lib 里**恰好 1 次**（另一处传的是 `noSidNext`）。
     *   f2 席如实记：本轮守卫被收成一个共享函数后，先前"摘 throw 那一行"的锚点分裂成两条具名错误，
     *   只摘一条会让另一条接管并抛 `ERR_MALFORMED_DECISION` ⇒ 负控不再是"修前形态"。
     *   锚点随实现同步改成"摘调用"，**语义不变**（仍是"把守卫从这条路径上拿掉"）。
     */
    mutant: { replace: [['assertUsableDecision(downstream)', '/* 守卫已摘（负控） */']] },
  })
  assert.ok(b.attention, 'Z-②：变异体必须真被装载')
  assert.notEqual(readFileSync(join(b.dir, 'attention-mutant.mjs'), 'utf8'), readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'), 'Z-②：变异未生效')
  const swallower = b.ctx.on('agent/pre-step', async (_p, next) => { await next() /* 忘了 return */ })

  const hostMsg = { id: 'm-host', role: 'user', content: [{ type: 'text', text: '宿主本步的既有消息' }], source: { kind: 'user' } }
  perceive(b.ctx, { content: '候选·假账', requestId: 'req-fake', sessionId: S1 })
  let threw = null
  let decision = null
  try {
    decision = await firePreStep(b.ctx, { turn: 1, messages: [hostMsg], sessionId: S1 })
  } catch (e) { threw = e }
  swallower()
  const rows = readInject(b.store)

  assert.equal(threw, null, '变异体不会抛（这正是修前的形态：**全程无异常**）')
  assert.equal(decision.kind, 'enter', '变异体照样返回 enter（宿主看起来一切正常）')
  assert.equal(decision.messages.length, 1, `变异体返回值只剩注入块（实得 ${decision.messages.length}）`)
  assert.ok(!decision.messages.some((m) => m.id === 'm-host'), '宿主本步的消息被静默吃掉 —— 这正是 Y-① 要防的形态')
  assert.equal(rows.length, 1, '前置：变异体自己仍留了一行')
  assert.equal(rows[0].gate, 'injected', '变异体把**没做成的注入**记成 injected ⇒ 假账（这正是"看起来成功"与"事实失败"同形）')
  assert.deepEqual(judgedSurface(), before, 'Z-②：对拍不得写仓（sha256 逐字节比对）')
})
