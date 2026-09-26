/**
 * 面⑨ **上界逐出（N1/N2）· 无会话身份（N3）· 无效 sessionId（N4）**（impl 席 · 2026-09-26 · c1 补缺口）。
 *
 * 这四条来自 risk 席对本席上一批 D1/D2 的独立审查（判「根因解决、非补丁」，但列出 4 条真缺口）。
 * 本档**逐条把它们变成必红的读数**，而不是"报告里写着已修"：
 *
 * | 编号 | 缺口 | 本档怎么钉 |
 * |---|---|---|
 * | **N1** | 256 会话上界逐出**无留痕** ⇒ 热分区被删 ⇒ 同一 requestId **再注入一次** ⇒ I2 静默被破坏 | V-①：造 256+ 会话把热会话逐出 ⇒ 断言 `inject_log` **真的出现 2 行同 requestId**（= I2 让路**已被观测到**）**并且**逐出在 `mana_trace` 里有 1 行留痕 |
 * | **N2** | 逐出丢 `injectedBlocks` ⇒ `reset` 检测永久漏报 | V-②：逐出后旧块的 `reset` 不再由**新分区**负责（这是**如实**的后果）⇒ 逐出留痕里必须**报出丢了几块**（`droppedTrackedBlocks`），使"漏报"变成可数事实而不是静默 |
 * | **N3** | 无 sid 分支**零痕迹**（`mana/plugin/inactive` 全仓零消费方） | V-③：`agent` 为空 → 断言 `mana_trace` 有 1 行点名真因 **且** `inject_log` 新增 1 行 `sky`/`degraded_unavailable`（并验证下游仍被进入 = G9 不回退） |
 * | **N4** | 空 `sessionId` 在 `emit` 内**抛** ⇒ `perceive()` 收到异常且零 trace | V-④：`ctx.emit('mana/observation', …sessionId:''…)` **不得抛**；断言**不建分区** + trace 有一行点名 + 旁路事件发出 |
 *
 * ⚠ **不得回退**（risk 席会专门核）：本档 V-⑤/V-⑥ 在**同一次运行**里重跑会话隔离与 D2 守卫的主读数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, firePreStep, perceive, readInject, readTrace, messageText, judgedSurface, ROOT } from './_harness.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const S_HOT = 'sess-hot'
const rowsOf = (rows, sid) => rows.filter((r) => r.session_id === sid)
const injectedRows = (rows) => rows.filter((r) => r.gate === 'injected')

// ══ V-① N1：逐出**先挑无损候选**；无可避免时才让路且必留痕 ═════════════════
test('V-①a 上界逐出先挑"无损"候选：只是过了几步的会话被逐出，热会话的 I2 账目一个字不动', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  const att = ctx.get('mana-attention')
  const cap = att.maxSessions
  perceive(ctx, { content: '热候选', requestId: 'hot-req', sessionId: S_HOT })
  await firePreStep(ctx, { turn: 1, sessionId: S_HOT })

  /**
   * ⚠ **本批（N1′）改变了"无损"的定义**：现在 `pending` 计入 `lossFree` ⇒ "被 perceive 过但还没注入"
   *   的会话**不再是无损候选**（它们有候选，逐出就是丢候选）。
   *   ⇒ 本腿要造**真无损**候选，只能让填充会话"有分区、但既没有候选也没有账目"：
   *     走一次 pre-step（建分区）而不 `perceive`（不入队）。
   *   ⚠ 这正是 N1′ 的意图：旧定义把"有候选"当无损，于是丢候选没有任何读数。
   */
  for (let i = 0; i < cap; i += 1) await firePreStep(ctx, { turn: 1, sessionId: `sess-fill-${i}` })
  const log = att.evictionLog()
  assert.ok(log.length >= 1, '前置：灌满上界必须真的发生逐出')
  assert.equal(log[log.length - 1].lossFree, true, `逐出应优先挑无损候选（实得 lossFree=${log[log.length - 1].lossFree}）`)
  assert.equal(log[log.length - 1].droppedDuplicateKeys, 0, '无损逐出不得丢任何去重键')
  assert.equal(att.sessionCount(), cap, `分区数仍须被夹在上界 ${cap}`)

  // 热会话的账目完好 ⇒ 同 requestId 再注入**不会**发生
  perceive(ctx, { content: '热候选', requestId: 'hot-req', sessionId: S_HOT })
  await firePreStep(ctx, { turn: 2, sessionId: S_HOT })
  assert.equal(injectedRows(rowsOf(readInject(store), S_HOT)).length, 1, '热会话的 I2 去重集未被逐出波及 ⇒ 仍只注入 1 次（这是首选路径）')
})

test('V-①b 无可避免的让路：热分区被 FIFO 逐出 ⇒ **留痕 + I2 让路同时可观测**', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  const att = ctx.get('mana-attention')
  const cap = att.maxSessions

  // 把上界全部填成**有账目**的会话（每个都注入过 ⇒ 没有无损候选）…
  for (let i = 0; i < cap; i += 1) {
    perceive(ctx, { content: `c-${i}`, requestId: `r-${i}`, sessionId: `sess-${i}` })
    await firePreStep(ctx, { turn: 1, sessionId: `sess-${i}` })
  }
  assert.equal(injectedRows(readInject(store)).length, cap, `前置：${cap} 个会话各注入 1 次`)
  const evBefore = att.evictionLog().length

  // …再来一个新会话 ⇒ 必须 FIFO 让路
  perceive(ctx, { content: '新会话候选', requestId: 'new-req', sessionId: 'sess-newest' })
  const log = att.evictionLog()
  assert.equal(log.length, evBefore + 1, '必须恰好再逐出一个')
  const rec = log[log.length - 1]
  assert.equal(rec.lossFree, false, '没有无损候选时只能让路')
  assert.equal(rec.droppedDuplicateKeys, 1, `让路必须报出丢了 1 条去重键（实得 ${rec.droppedDuplicateKeys}）—— 这就是 I2 让路的**量**`)

  // 留痕：库里必须有 1 行（点名 sessionId 且 gate=reset），且**不含记忆正文**（A1-9）
  const evRows = readTrace(store).filter((r) => { try { return JSON.parse(r.payload ?? '{}').reason === att.evictionReason } catch { return false } })
  assert.equal(evRows.length, 1, `逐出必须写 1 行 mana_trace（实得 ${evRows.length}）`)
  assert.equal(evRows[0].session_id, 'sess-0', 'FIFO：被逐出的应是最旧那条')
  const evPayload = JSON.parse(evRows[0].payload)
  assert.equal(evPayload.gate, 'reset', 'gate 取既有 reset 类')
  assert.equal(evPayload.droppedDuplicateKeys, 1)
  assert.equal(JSON.stringify(evPayload).includes('c-0'), false, '留痕不得含记忆正文（A1-9）')

  // I2 让路必须真的发生（并且**已被上面的留痕记账**）
  perceive(ctx, { content: 'c-0', requestId: 'r-0', sessionId: 'sess-0' })
  await firePreStep(ctx, { turn: 2, sessionId: 'sess-0' })
  const zeroRows = injectedRows(rowsOf(readInject(store), 'sess-0'))
  assert.equal(zeroRows.length, 2, `被逐出会话的同 requestId 应被**再注入一次**（实得 ${zeroRows.length} 行）⇒ I2 让路是事实，不是假设`)
  assert.deepEqual(zeroRows.map((r) => r.memory_id), ['r-0', 'r-0'], '两行必须指回同一条记忆（I2 被破坏的形态）')
})

// ══ V-② N2：逐出与块跟踪的两条事实（无损优先 / 让路时报出丢块数）════════════
test('V-② 逐出与 injectedBlocks：无损优先不丢块；让路时**必须报出丢了几块**', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  const att = ctx.get('mana-attention')
  const cap = att.maxSessions

  // 热会话持有 2 条未核对的块跟踪
  perceive(ctx, { content: '块甲', requestId: 'blk-a', sessionId: S_HOT })
  const d1 = await firePreStep(ctx, { turn: 1, messages: [], sessionId: S_HOT })
  perceive(ctx, { content: '块乙', requestId: 'blk-b', sessionId: S_HOT })
  await firePreStep(ctx, { turn: 2, messages: [d1.messages[d1.messages.length - 1]], sessionId: S_HOT })

  // ① 无损优先：填进来的会话都**没有**块跟踪 ⇒ 被逐出的应是无损候选，热会话的块跟踪不动
  // ⚠ 同上（N1′）：要造"无损"候选必须**不给候选** ⇒ 只建分区（pre-step），不 `perceive`。
  for (let i = 0; i < cap; i += 1) await firePreStep(ctx, { turn: 1, sessionId: `s-${i}` })
  const first = att.evictionLog()[att.evictionLog().length - 1]
  assert.equal(first.lossFree, true, `应优先逐出无损候选（实得 lossFree=${first.lossFree}）：带块跟踪的会话先被牺牲就是 N2 的原缺陷`)
  assert.equal(first.droppedTrackedBlocks, 0, '无损逐出不得丢任何块跟踪')
  // 热会话的块跟踪仍在 ⇒ 块离开上下文时 reset 仍能被记出
  await firePreStep(ctx, { turn: 3, messages: [], sessionId: S_HOT })
  const hotResets = rowsOf(readInject(store), S_HOT).filter((r) => r.gate === 'reset')
  assert.equal(hotResets.length >= 1, true, `热会话的块跟踪未被逐出波及 ⇒ 块离开仍须记 reset（实得 ${hotResets.length}）`)

  // ② 无可避免时：把上界全填成**带块跟踪**的会话，再触发一次 ⇒ 必须让路并报出丢块数
  const { ctx: ctx2, store: store2 } = await boot({ judge: 'ok' })
  const att2 = ctx2.get('mana-attention')
  const cap2 = att2.maxSessions
  // ⚠ 每个会话**只走一步**（不再走第二步）：走第二步会因"块不在上下文里"把跟踪项**正常摘掉**
  //   ⇒ 被逐出时 droppedTrackedBlocks 会是 0，本腿就打空了（我第一版就是这么写的，如实记下）。
  for (let i = 0; i < cap2; i += 1) {
    perceive(ctx2, { content: `块-${i}`, requestId: `rq-${i}`, sessionId: `h-${i}` })
    await firePreStep(ctx2, { turn: 1, messages: [], sessionId: `h-${i}` })
  }
  const before = att2.evictionLog().length
  perceive(ctx2, { content: '新', requestId: 'newly', sessionId: 'h-newest' })
  const rec = att2.evictionLog()[att2.evictionLog().length - 1]
  assert.equal(att2.evictionLog().length, before + 1, '必须再发生一次逐出')
  assert.equal(rec.lossFree, false, '全部候选都有块跟踪 ⇒ 没有办法做到无损（这就是 N2 的边界）')
  assert.equal(rec.droppedTrackedBlocks, 1, `必须**报出**丢了几块（实得 ${rec.droppedTrackedBlocks}）—— "重置跟踪导致 reset 漏报"从此是可数事实，不是静默`)
  // 该量也进了库（不只是内存读数）
  const evRows = readTrace(store2).filter((r) => { try { return JSON.parse(r.payload ?? '{}').reason === att2.evictionReason } catch { return false } })
  assert.ok(evRows.some((r) => JSON.parse(r.payload).droppedTrackedBlocks === 1), '丢块数必须落进 trace 载荷（否则"内存里报了、库里看不见"）')
  // ⚠ 如实标注（不假装修好）：被逐出会话的块离开上下文时**不会**再有 reset 行 ——
  //   内存上界与逐块跟踪无法两全；本档钉的是"漏报量被报出来"，不是"漏报消失了"。
  const evictedSid = rec.sessionId
  const resetsForEvicted = rowsOf(readInject(store2), evictedSid).filter((r) => r.gate === 'reset').length
  assert.equal(resetsForEvicted, 0, '如实钉住该边界：被逐出会话此后不再产出 reset 行')
})

// ══ V-③ N3：无会话身份 ⇒ 必须**落 trace + 落 inject_log**，且下游仍被进入 ══════
test('V-③ 无 session 身份：不得静默（trace + inject_log 各一行），且下游仍必须被进入', async () => {
  const { ctx, store, arm, downstreamCount } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选·无身份', requestId: 'req-n3', sessionId: S_HOT })
  const before = readInject(store).length
  const off = arm()
  // agent 为空对象 ⇒ resolvePreStepSessionId 取不到（sessionId 与 session.id 都缺）
  const decision = await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  const hits = downstreamCount()
  off()

  assert.equal(decision?.kind, 'enter', '本分支仍须交出控制权（G9：不得因为身份缺失就掐死下游）')
  assert.equal(hits, 1, `下游必须被进入 1 次（实得 ${hits}）—— 若为 0，本分支就成了另一种"静默掐死"`)
  const rows = readInject(store)
  assert.equal(rows.length, before + 1, `必须新增 1 行 inject_log（实得 ${rows.length - before}）—— 零消费方的事件不算"看见了"`)
  assert.equal(rows[rows.length - 1].gate, 'degraded_unavailable', '该行的形态：本步确实没能判定注入（fail-closed 但留痕）')
  assert.equal(rows[rows.length - 1].degraded, 1)
  assert.equal(rows[rows.length - 1].session_id, '', '不得把空串**冒充**成某个正常会话（本行诚实写空）')
  const noSidTrace = readTrace(store).filter((r) => {
    try { return JSON.parse(r.payload ?? '{}').reason === 'attention:no-session-id' } catch { return false }
  })
  assert.equal(noSidTrace.length, 1, `必须写 1 行 mana_trace 点名真因（实得 ${noSidTrace.length}）`)
})

// ══ V-④ N4：空 sessionId 不得在 emit 链内抛 ═════════════════════════════════
test('V-④ 空 sessionId 的 observation：不得抛（源头不炸），且不建分区 + 留痕可查', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  const att = ctx.get('mana-attention')
  const before = att.sessionCount()
  let threw = null
  try {
    perceive(ctx, { content: '无效会话的候选', requestId: 'req-bad-sid', sessionId: '' })
  } catch (e) { threw = e }
  assert.equal(threw, null, `空 sessionId 不得在 emit 分发链内抛（否则 perception.perceive 收到异常且观测不可得）：${threw && threw.message}`)
  assert.equal(att.sessionCount(), before, '不得为无效 id 建分区（那会让"取不到身份"表现成一个正常会话）')
  assert.equal(att.hasPending(''), false, '更不得把候选塞进空串分区')

  const badRows = readTrace(store).filter((r) => {
    try { return JSON.parse(r.payload ?? '{}').reason === 'attention:no-session-id' && JSON.parse(r.payload ?? '{}').invalid === 'empty-session-id' } catch { return false }
  })
  assert.equal(badRows.length, 1, `必须留 1 行 trace 点名（实得 ${badRows.length}）—— "零 trace"是本条要修的缺陷本身`)
})

// ══ V-⑤ 不得回退：双会话隔离（上一批 D1 的主读数）════════════════════════════
test('V-⑤ 不回退（D1）：双会话交错下 B 会话拿自己的候选，且同一 requestId 各注入一次', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '甲的候选', requestId: 'same-req', sessionId: 'sess-A' })
  perceive(ctx, { content: '乙的候选', requestId: 'same-req', sessionId: 'sess-B' })
  const db = await firePreStep(ctx, { turn: 1, sessionId: 'sess-B' })
  const tB = messageText(db.messages[db.messages.length - 1])
  assert.ok(tB.includes('乙的候选'), `B 会话应拿到自己的候选：${tB}`)
  assert.equal(tB.includes('甲的候选'), false, 'B 会话不得看到 A 的候选（串档回退）')
  await firePreStep(ctx, { turn: 1, sessionId: 'sess-A' })
  assert.equal(injectedRows(readInject(store)).length, 2, '两个会话各注入一次（I2 是"每 session 一次"，不是全进程一次）')
})

// ══ V-⑥ 不得回退：D2 守卫（上一批的抛点与零假账）════════════════════════════
test('V-⑥ 不回退（D2）：下游吞掉 next() 返回值 ⇒ 抛具名错 + inject_log 零新增行', async () => {
  const { ctx, store, attention, arm, downstreamCount } = await boot({ judge: 'ok' })
  const swallower = ctx.on('agent/pre-step', async (_p, next) => { await next() /* 忘了 return */ })
  perceive(ctx, { content: '候选·吞决策', requestId: 'req-swallow2', sessionId: 'sess-D2' })
  const off = arm()
  const before = readInject(store).length
  let threw = null
  try { await firePreStep(ctx, { turn: 1, sessionId: 'sess-D2' }) } catch (e) { threw = e }
  const hits = downstreamCount()
  off(); swallower()
  assert.equal(hits, 1, '前置：内层哨兵应被进入 1 次（证明这不是"漏调 next()"）')
  assert.ok(threw, '必须抛（D2 守卫不得回退）')
  assert.equal(String(threw.message), attention.upstreamSwallowedError, '抛出的应是本包具名错误')
  assert.equal(readInject(store).length, before, '抛点在写审计之前 ⇒ 零新增行（不得回退成假账）')
})

// ══ Z-③ 负控：摘掉逐出留痕 ⇒ V-① 的"库里有行"必红 ═════════════════════════╗
test('Z-③ 负控：摘掉逐出留痕调用 ⇒ V-①b 的"库里有行"读数必红（修前的静默逐出）', async () => {
  const before = judgedSurface()
  const b = await boot({
    judge: 'ok',
    /**
     * 一个锚点：摘掉**留痕调用**本身 ⇒ 退化成修前形态（逐出照做、但库里一个字都没有）。
     * ⚠ 锚点必须与断言对齐：上一版锚在 `evictionLog.push` 上，而留痕写作是**另一行**
     *   ⇒ 变异体仍写 trace，"库面无行"这条就假红（判据打错靶）。已按实测改正。
     */
    mutant: { replace: [['logSessionEviction(record)', 'void record /* 留痕已摘（负控） */']] },
  })
  assert.ok(b.attention, 'Z-③：变异体必须真被装载')
  assert.notEqual(readFileSync(join(b.dir, 'attention-mutant.mjs'), 'utf8'), readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'), 'Z-③：变异未生效')
  const att = b.ctx.get('mana-attention')
  const cap = att.maxSessions
  perceive(b.ctx, { content: '热候选', requestId: 'hot-req', sessionId: S_HOT })
  await firePreStep(b.ctx, { turn: 1, sessionId: S_HOT })
  for (let i = 0; i < cap; i += 1) perceive(b.ctx, { content: 'x', requestId: `f-${i}`, sessionId: `s-${i}` })
  assert.equal(att.evictionLog().length, 1, '前置：变异体**只**摘掉留痕，逐出本身照做（流水仍有 1 条）⇒ 因果链唯一')
  const evRows = readTrace(b.store).filter((r) => { try { return JSON.parse(r.payload ?? '{}').reason === att.evictionReason } catch { return false } })
  assert.equal(evRows.length, 0, '变异体下不得有逐出留痕行（这就是修前的"静默逐出"）')
  assert.deepEqual(judgedSurface(), before, 'Z-③：对拍不得写仓（sha256 逐字节比对）')
})
