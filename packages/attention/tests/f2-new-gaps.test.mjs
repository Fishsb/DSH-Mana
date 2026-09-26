/**
 * 面⑩ **f2 席（2026-09-26 第 5 轮）补的三条新缺口** —— N1′ / D3′ / D4′。
 *
 * 来源：risk 席对本席第 3 轮交付的**第二轮复审**（N1/N3/N4 判"真修好，不回退"；以下三条为新发现）。
 *
 * | 编号 | 缺口 | 本档怎么钉 |
 * |---|---|---|
 * | **N1′** | 逐出的 `lossFree` 算式只看 `injectedRequests`/`injectedBlocks`，**漏 `pending`** ⇒ "有候选但还没注入"的会话被判成无损、逐出时**静默丢候选**，那一步随后记 `skip_no_candidate`（与"本来就没候选"同形） | W-①：造"有候选未注入"的会话 + 触发上界逐出 ⇒ 断言 ① 它**不**被判为无损 ② `droppedPending` **报出**丢了几条 ③ 该量**同时进 trace 载荷** |
 * | **D3′** | 无 sid 分支 `return await next()` **原样透传 `undefined`** ⇒ 上游吞决策时**不抛**，而对照分支**抛**（同一病因两副面孔） | W-②：`agent` 为空 + 下游吞返回值 ⇒ **必须抛具名错**（与有 sid 分支同一条判据） |
 * | **D4′** | 逐出与 N4 的旁路 `ctx.emit` 在 `ingest` **同步栈内** ⇒ 监听器抛错**冒泡进 `perceive()`** | W-③：在旁路事件上挂**必抛**监听器 ⇒ 调用方**不得**收到异常，且异常进 `deferredEmitFailures`（兜住 + 留读数） |
 *
 * ## 同一病因的**普查**（派单要求自问"还有几处"），两条都以判据落地
 *   · **"丢东西不报数"**：除逐出（丢候选/去重键/块跟踪）外还有一处 —— `maxFocusItems` 超限 `shift()` 掉最旧候选。⇒ W-④ 断言它同样报数（`focusDropLog`）。
 *   · **"旁路 emit 在同步栈内"**：全文件 8 处 `ctx.emit` 中**旁路 4 处**全部改出同步栈 ⇒ W-⑤ 逐类验证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, firePreStep, perceive, readInject, readTrace, judgedSurface, ROOT } from './_harness.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const S_HOT = 'sess-hot'
const traceRowsOf = (store, reason) =>
  readTrace(store).filter((r) => { try { return JSON.parse(r.payload ?? '{}').reason === reason } catch { return false } })
/** 旁路 emit 走 queueMicrotask ⇒ 断言前必须让它有机会跑完。 */
const flush = () => new Promise((r) => setTimeout(r, 0))

// ══ W-① N1′：pending 计入 lossFree，丢了必须报数（内存 + 库两处）══════════════
test('W-① 逐出丢 pending：不得判为"无损"，且 droppedPending 必须同时可读（内存 + trace）', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  const att = ctx.get('mana-attention')
  const cap = att.maxSessions
  perceive(ctx, { content: '未注入的候选', requestId: 'pending-req', sessionId: S_HOT })
  assert.equal(att.hasPending(S_HOT), true, '前置：热会话应持有未注入的候选')
  for (let i = 0; i < cap; i += 1) {
    perceive(ctx, { content: 'c-' + i, requestId: 'r-' + i, sessionId: 'sess-' + i })
    await firePreStep(ctx, { turn: 1, sessionId: 'sess-' + i })
  }
  const rec = att.evictionLog()[att.evictionLog().length - 1]
  assert.equal(rec.sessionId, S_HOT, 'FIFO：被让路的应是**最旧**那条（持有未注入候选的热会话）')
  assert.equal(rec.lossFree, false, '有未注入候选不得被判成无损（旧算式漏 pending = N1′）；实得 ' + rec.lossFree)
  assert.equal(rec.droppedPending, 1, '必须报出丢了 1 条候选（实得 ' + rec.droppedPending + '）')
  const evRows = traceRowsOf(store, att.evictionReason)
  assert.equal(evRows.length, 1, '逐出必须写 1 行 trace（实得 ' + evRows.length + '）')
  const payload = JSON.parse(evRows[0].payload)
  assert.equal(payload.droppedPending, 1, 'droppedPending 必须落进 trace 载荷（否则内存报了库里看不见）')
  assert.equal(payload.lossFree, false)
  assert.equal(JSON.stringify(payload).includes('未注入的候选'), false, '留痕不得含记忆正文（A1-9）')
  const before = readInject(store).filter((r) => r.session_id === S_HOT).length
  await firePreStep(ctx, { turn: 1, sessionId: S_HOT })
  const after = readInject(store).filter((r) => r.session_id === S_HOT)
  assert.equal(after.length, before + 1, '该会话仍必须留痕（不得静默）')
  assert.equal(after[after.length - 1].gate, 'skip_no_candidate', '如实钉住后果：候选被丢后那一步只能记 skip_no_candidate')
})

// ══ W-② D3′：无 sid 分支必须与主分支共用同一条守卫 ═══════════════════════════
test('W-② 无 sid 分支也要过 D2 守卫：下游吞掉返回值时必须抛具名错（不得原样透传 undefined）', async () => {
  const { ctx, attention } = await boot({ judge: 'ok' })
  const swallower = ctx.on('agent/pre-step', async (_p, next) => { await next() })
  let threw = null
  let decision
  try {
    decision = await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  } catch (e) { threw = e }
  swallower()
  assert.ok(threw, '无 sid 分支必须与主分支一样抛（修前原样透传 undefined ⇒ 同病因两副面孔）')
  assert.equal(String(threw.message), attention.upstreamSwallowedError, '必须是同一个具名错误（唯一判据、唯一错误）')
  assert.equal(decision, undefined, '不得把 undefined 决策交给宿主（那会让宿主本步消息被吃掉）')
})

// ══ W-③ D4′：旁路 emit 在同步栈内 ⇒ 必抛监听器不得冒泡进调用方 ══════════════
test('W-③ 逐出旁路 emit 出同步栈：旁路监听器抛错不得冒泡进调用方，且异常被计数', async () => {
  const { ctx } = await boot({ judge: 'ok' })
  const att = ctx.get('mana-attention')
  const cap = att.maxSessions
  const off = ctx.on('mana/injection', () => { throw new Error('boom-from-injection-listener') })
  perceive(ctx, { content: '热', requestId: 'hot', sessionId: S_HOT })
  let threw = null
  try {
    for (let i = 0; i < cap; i += 1) await firePreStep(ctx, { turn: 1, sessionId: 'k-' + i })
    perceive(ctx, { content: '触发逐出', requestId: 'boom', sessionId: 'k-newest' })
  } catch (e) { threw = e }
  off()
  await flush()
  assert.equal(threw, null, '旁路监听器抛错不得冒泡进调用方（= D4′ 原缺陷）：' + (threw && threw.message))
  const failures = att.deferredEmitFailures()
  assert.ok(failures.length >= 1, '被兜住的异常必须留下读数（吞掉就算了 = 另一种静默）')
  assert.ok(failures.some((f) => f.event === 'mana/injection' && f.message.includes('boom-from-injection-listener')), '读数应点名事件与错误：' + JSON.stringify(failures))
})

// ══ W-④ 普查（同病因第一类）：maxFocusItems 超限丢候选也必须报数 ═════════════
test('W-④ 普查：聚焦项上限丢弃候选必须报数（同一病因的第二处，不得只修逐出那处）', async () => {
  const { ctx } = await boot({ judge: 'ok', extraConfig: { maxFocusItems: 2 } })
  const att = ctx.get('mana-attention')
  assert.equal(att.focusDropLog().length, 0, '前置：还没丢过')
  for (let i = 0; i < 5; i += 1) perceive(ctx, { content: '候选-' + i, requestId: 'fd-' + i, sessionId: 'sess-focus' })
  const log = att.focusDropLog()
  // ⚠ 实测口径（第一版我按"合并成 1 条、dropped=3"写，实测是"每次超限丢 1 条记 1 条"）：
  //   5 条入队、上限 2 ⇒ 第 3/4/5 条各触发一次 shift ⇒ 3 条流水、每条 dropped=1、合计 3。
  //   逐条记比分批更要辨识度（能看出丢弃发生的时间分布），故**按实测改正断言**，不改实现。
  assert.equal(log.length, 3, '超限丢弃应逐次记账（实得 ' + log.length + ' 条）')
  assert.deepEqual(log.map((x) => x.sessionId), ['sess-focus', 'sess-focus', 'sess-focus'])
  assert.deepEqual(log.map((x) => x.dropped), [1, 1, 1], '每条流水报出这次丢了 1 条')
  assert.equal(log.reduce((n, x) => n + x.dropped, 0), 3, '合计应报出丢了 3 条')
  assert.equal(att.buildBlock('sess-focus').includes('候选-4'), true, '保留的应是**最新**的候选（既有语义不变）')
})

// ══ W-⑤ 普查（同病因第二类）：四类旁路路径逐类验证不外溢 ══════════════════════
test('W-⑤ 普查：四类旁路路径的必抛监听器都不得冒泡进调用方', async () => {
  const cases = [
    ['逐出留痕', async () => {
      const { ctx } = await boot({ judge: 'ok' })
      const off = ctx.on('mana/injection', () => { throw new Error('boom-evict') })
      perceive(ctx, { content: '热', requestId: 'h', sessionId: S_HOT })
      for (let i = 0; i < ctx.get('mana-attention').maxSessions; i += 1) await firePreStep(ctx, { turn: 1, sessionId: 'e-' + i })
      perceive(ctx, { content: 'x', requestId: 'x', sessionId: 'e-newest' })
      off()
      return ctx.get('mana-attention')
    }],
    ['无 sid 分支', async () => {
      const { ctx } = await boot({ judge: 'ok' })
      const off = ctx.on('mana/plugin/inactive', () => { throw new Error('boom-nosid') })
      await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
      off()
      return ctx.get('mana-attention')
    }],
    ['N4 无效 sessionId', async () => {
      const { ctx } = await boot({ judge: 'ok' })
      const off = ctx.on('mana/plugin/inactive', () => { throw new Error('boom-badsid') })
      perceive(ctx, { content: 'x', requestId: 'b', sessionId: '' })
      await flush() // ⚠ 旁路 emit 是 queueMicrotask ⇒ 必须等它跑完再摘监听器（顺序错会让读数恒 0）
      off()
      return ctx.get('mana-attention')
    }],
    ['留痕失败兜底', async () => {
      const { ctx } = await boot({ judge: 'ok', coreMutant: { replace: [['INSERT INTO inject_log', 'INSERT INTO no_such_table_xyz']] } })
      const off = ctx.on('mana/plugin/inactive', () => { throw new Error('boom-catch') })
      perceive(ctx, { content: 'x', requestId: 'c', sessionId: 'sess-catch' })
      await firePreStep(ctx, { turn: 1, sessionId: 'sess-catch' })
      off()
      return ctx.get('mana-attention')
    }],
  ]
  for (const [name, run] of cases) {
    let threw = null
    let att = null
    try { att = await run() } catch (e) { threw = e }
    await flush()
    assert.equal(threw, null, '【' + name + '】旁路监听器抛错冒泡进了调用方：' + (threw && threw.message))
    assert.ok(att && att.deferredEmitFailures().length >= 1, '【' + name + '】被兜住的异常必须留下读数（否则不外溢就变成静默吞掉）')
  }
})

// ══ Z-④ 负控：摘掉 droppedPending ⇒ W-① 的读数必红 ═══════════════════════════
test('Z-④ 负控：摘掉 droppedPending（退回只数去重集/块表的旧算式）⇒ W-① 的读数必红', async () => {
  const before = judgedSurface()
  const b = await boot({
    judge: 'ok',
    mutant: { replace: [['const droppedPending = evicted?.pending.length ?? 0', 'const droppedPending = 0']] },
  })
  assert.ok(b.attention, 'Z-④：变异体必须真被装载')
  assert.notEqual(readFileSync(join(b.dir, 'attention-mutant.mjs'), 'utf8'), readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'), 'Z-④：变异未生效')
  const att = b.ctx.get('mana-attention')
  const cap = att.maxSessions
  perceive(b.ctx, { content: '未注入的候选', requestId: 'pending-req', sessionId: S_HOT })
  for (let i = 0; i < cap; i += 1) {
    perceive(b.ctx, { content: 'c-' + i, requestId: 'r-' + i, sessionId: 'sess-' + i })
    await firePreStep(b.ctx, { turn: 1, sessionId: 'sess-' + i })
  }
  const rec = att.evictionLog()[att.evictionLog().length - 1]
  assert.equal(rec.droppedPending, 0, '变异体下丢候选不报数（= 修前形态）⇒ W-① 的断言会红')
  assert.equal(JSON.parse(traceRowsOf(b.store, att.evictionReason)[0].payload).droppedPending, 0, 'trace 载荷同样为 0（库面读数也会红）')
  assert.deepEqual(judgedSurface(), before, 'Z-④：对拍不得写仓')
})


// ══ 收尾批 ① 残码真删：守卫之后不得再有"归一化"救场路径 ══════════════════════
test('X-① 残码真删：源码与产物里都不得再有 swallowedUpstream 归一化（代码级，不是注释级）', async () => {
  const SRC = readFileSync(join(ROOT, 'packages', 'attention', 'src', 'index.ts'), 'utf8')
  const LIB = readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8')
  /** 剥掉注释后再判：注释里可以**说明**这段残码已删（本批正是这么写的），代码里不许有。 */
  const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.equal(codeOnly(SRC).includes('swallowedUpstream'), false, 'src 代码里仍残留归一化路径 ⇒ 潜在可绕（必须真删，不是注释掉）')
  assert.equal(codeOnly(LIB).includes('swallowedUpstream'), false, 'lib 代码里仍残留归一化路径 ⇒ 产物没重建或没删干净')
})

// ══ 收尾批 ② 归因不污染：谁失败就记谁 ═══════════════════════════════════════
test('X-② 归因不污染：mana_trace 写失败不得被记成 inject_log 写入失败（且 inject_log 确实有 1 行）', async () => {
  const inactive = []
  const { ctx, store } = await boot({
    judge: 'ok',
    // ⚠ **所有** trace 写入都失败（不止一处）：`mana_trace` 是本包的主记账面；
    //   `INSERT INTO mana_trace` 在 core lib 里对**每一个** writeTrace 调用点的 SQL 都相同
    //   ⇒ 一个锚点即可让全部 trace 写失败（本席第一版多加了一个锚点，命中 0 次 ⇒ 变异器直接抛，
    //     这正是"锚点必须与产物逐字一致"的机制在起作用）。
    coreMutant: { replace: [['INSERT INTO mana_trace', 'INSERT INTO no_such_trace_xyz']] },
    hook: (c) => c.on('mana/plugin/inactive', (ev) => inactive.push(ev)),
  })
  perceive(ctx, { content: '归因候选', requestId: 'req-attr', sessionId: 'sess-attr' })
  await firePreStep(ctx, { turn: 1, sessionId: 'sess-attr' })
  await flush()
  const rows = readInject(store)
  assert.equal(rows.length, 1, '前置：inject_log 主审计行应当**写成功**（实得 ' + rows.length + '）')
  assert.equal(rows[0].gate, 'injected')
  assert.ok(inactive.length >= 1, 'mana_trace 写失败必须被记账（不得静默）')
  const msg = inactive.map((e) => (e.missing ?? []).join(' ')).join(' | ')
  assert.ok(msg.includes('mana_trace 写入失败'), '归因必须点名是 **mana_trace** 写失败：实得 ' + msg)
  assert.equal(msg.includes('inject_log 写入失败'), false, '不得把别的失败记成 inject_log 写入失败（原因记错比没记更坏）：' + msg)
  // ⚠ 关键读数：trace 全坏时，**主审计行仍在**（inject_log 与 trace 是两条独立的记账通道）
  assert.ok(readInject(store).some((r) => r.session_id === 'sess-attr'), 'trace 全坏不得牵连 inject_log 主审计行')
})

// ══ 收尾批 ③ 主广播：同步可见 + 兜异常 + 计数 ═══════════════════════════════
test('X-③ 主广播抛错不得炸宿主：mana/decision 的必抛监听器不外溢，且进读数（sync: 前缀）', async () => {
  const { ctx, attention } = await boot({ judge: 'ok' })
  const off = ctx.on('mana/decision', () => { throw new Error('boom-decision-listener') })
  perceive(ctx, { content: '主广播候选', requestId: 'req-sync', sessionId: 'sess-sync' })
  let threw = null
  let decision = null
  try { decision = await firePreStep(ctx, { turn: 1, sessionId: 'sess-sync' }) } catch (e) { threw = e }
  off()
  assert.equal(threw, null, '主广播监听器抛错不得冒泡炸掉 pre-step（宿主整步失败）：' + (threw && threw.message))
  assert.equal(decision.kind, 'enter', '本步仍须正常返回决策（可见性与异常处理是两件事）')
  const failures = attention.deferredEmitFailures()
  assert.ok(failures.some((f) => f.event === 'sync:mana/decision' && f.message.includes('boom-decision-listener')), '同步派发的失败必须被计数（前缀 sync: 与旁路区分）：' + JSON.stringify(failures))
})

// ══ Z-⑤ 负控：摘掉同步派发的兜底 ⇒ X-③ 必红 ═════════════════════════════════
test('Z-⑤ 负控：摘掉 emitSyncGuarded 的 try/catch（退回裸 ctx.emit）⇒ X-③ 必红', async () => {
  const before = judgedSurface()
  const b = await boot({
    judge: 'ok',
    mutant: { replace: [['emitSyncGuarded(\'mana/decision\', decision)', 'ctx.emit(\'mana/decision\', decision)']] },
  })
  assert.ok(b.attention, 'Z-⑤：变异体必须真被装载')
  assert.notEqual(readFileSync(join(b.dir, 'attention-mutant.mjs'), 'utf8'), readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'), 'Z-⑤：变异未生效')
  const off = b.ctx.on('mana/decision', () => { throw new Error('boom-decision-listener') })
  perceive(b.ctx, { content: '主广播候选', requestId: 'req-sync', sessionId: 'sess-sync' })
  let threw = null
  try { await firePreStep(b.ctx, { turn: 1, sessionId: 'sess-sync' }) } catch (e) { threw = e }
  off()
  assert.ok(threw, '裸露的同步派发下，监听器异常会冒泡炸掉 pre-step（= 修前形态）⇒ X-③ 的断言会红')
  assert.deepEqual(judgedSurface(), before, 'Z-⑤：对拍不得写仓')
})


// ══ 收尾补齐 F-1/F-2：写失败**必须有点名归因**（不得零留痕、不得归因错）════════
test('Y-① F-1：逐出留痕写失败必须有点名归因（修前：空 catch ⇒ 逐出 32 次零留痕零事件）', async () => {
  const inactive = []
  const { ctx, store } = await boot({
    judge: 'ok',
    coreMutant: { replace: [['INSERT INTO mana_trace', 'INSERT INTO no_such_trace_xyz']] },
    hook: (c) => c.on('mana/plugin/inactive', (ev) => inactive.push(ev)),
  })
  const att = ctx.get('mana-attention')
  const cap = att.maxSessions
  perceive(ctx, { content: '热', requestId: 'hot', sessionId: 'sess-hot' })
  for (let i = 0; i < cap; i += 1) await firePreStep(ctx, { turn: 1, sessionId: 'e-' + i })
  perceive(ctx, { content: 'x', requestId: 'x', sessionId: 'e-newest' })
  await flush()
  assert.equal(att.evictionLog().length >= 1, true, '前置：必须真的发生过逐出')
  const traced = traceRowsOf(store, att.evictionReason)
  assert.equal(traced.length, 0, '前置：trace 写坏 ⇒ 库里确实没有逐出行')
  const msg = inactive.map((e) => (e.missing ?? []).join(' ')).join(' | ')
  assert.ok(inactive.length >= 1, '逐出留痕失败**必须**有归因（修前是空 catch ⇒ 什么都看不到）')
  assert.ok(msg.includes('mana_trace 写入失败(逐出留痕)'), '归因必须点名是「逐出留痕」这一路（与别处的 trace 失败可分辨）：' + msg)
})

test('Y-② F-2：无 sid 分支两条记账写失败必须各自点名（不得只报 ERR_NO_SESSION_ID）', async () => {
  const inactive = []
  const { ctx, store } = await boot({
    judge: 'ok',
    coreMutant: { replace: [['INSERT INTO mana_trace', 'INSERT INTO no_such_trace_xyz'], ['INSERT INTO inject_log', 'INSERT INTO no_such_inject_xyz']] },
    hook: (c) => c.on('mana/plugin/inactive', (ev) => inactive.push(ev)),
  })
  await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  await flush()
  assert.equal(readInject(store).length, 0, '前置：inject_log 确实写失败（0 行）')
  const msg = inactive.map((e) => (e.missing ?? []).join(' ')).join(' | ')
  assert.ok(msg.includes('mana_trace 写入失败(无会话身份)'), '必须点名 trace 那一路：' + msg)
  assert.ok(msg.includes('inject_log 写入失败(无会话身份)'), '必须点名 inject_log 那一路（两条各自归因）：' + msg)
  assert.ok(msg.includes('取不到会话 id'), '仍须保留「为何走到本分支」（ERR_NO_SESSION_ID）——两件事都要有')
})

test('Y-③ ③读数竞争：两张失败表独立计数，主广播高频抛错不得挤掉旁路读数', async () => {
  const { ctx, attention } = await boot({ judge: 'ok' })
  // ⚠ 本席第一版把 `mana/decision` 当"旁路"挂了必抛监听器 —— 它是**主广播**（走 emitSyncGuarded），
  //   于是 bypass 表恒 0、本腿假红。旁路事件是 `mana/plugin/inactive`（本包旁路路径全部走它）。
  //   ⇒ 按实测改正：同步噪声挂主广播 `mana/injection`（每次 pre-step 必发），旁路噪声挂 `mana/plugin/inactive`。
  const offSync = ctx.on('mana/injection', () => { throw new Error('sync-noise') })
  const offBypass = ctx.on('mana/plugin/inactive', () => { throw new Error('bypass-noise') })
  perceive(ctx, { content: '候选', requestId: 'req-split', sessionId: 'sess-split' })
  for (let i = 0; i < 40; i += 1) {
    await firePreStep(ctx, { turn: i + 1, sessionId: 'sess-split' })
  }
  // 触发**旁路**路径：空 sessionId 的 observation（N4 分支走 safeEmitDeferred('mana/plugin/inactive')）
  for (let i = 0; i < 3; i += 1) perceive(ctx, { content: '空会话', requestId: 'bad-' + i, sessionId: '' })
  await flush()
  offSync(); offBypass()
  const counts = attention.emitFailureCounts()
  assert.ok(counts.cap > 0, '上限必须是可读真值')
  assert.ok(counts.sync > 0, '主广播（同步派发）的失败必须被计数：' + JSON.stringify(counts))
  assert.ok(counts.bypass > 0, '旁路失败同样必须被计数（分表后不被同步噪声挤掉）：' + JSON.stringify(counts))
  assert.equal(attention.deferredEmitFailures().some((f) => f.event.startsWith('sync:')), true, '合并视图仍须含 sync: 前缀条目（兼容既有消费者）')
})

// ══ Z-⑥ 负控：把逐出留痕退回"不写"⇒ Y-① 的归因断言必红 ═══════════════════
test('Z-⑥ 负控：逐出留痕退回空 catch（修前形态）⇒ Y-① 的归因断言必红', async () => {
  const before = judgedSurface()
  const b = await boot({
    judge: 'ok',
    mutant: { replace: [["writeTraceGuarded('mana_trace 写入失败(逐出留痕)', {", 'void ({']] },
  })
  assert.ok(b.attention, 'Z-⑥：变异体必须真被装载')
  assert.notEqual(readFileSync(join(b.dir, 'attention-mutant.mjs'), 'utf8'), readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'), 'Z-⑥：变异未生效')
  const att = b.ctx.get('mana-attention')
  const cap = att.maxSessions
  perceive(b.ctx, { content: '热', requestId: 'hot', sessionId: 'sess-hot' })
  for (let i = 0; i < cap; i += 1) await firePreStep(b.ctx, { turn: 1, sessionId: 'e-' + i })
  perceive(b.ctx, { content: 'x', requestId: 'x', sessionId: 'e-newest' })
  await flush()
  assert.equal(att.evictionLog().length >= 1, true, '前置：逐出仍发生（变异只摘留痕）')
  assert.equal(att.deferredEmitFailures().some((f) => f.message.includes('逐出留痕')), false, '变异体下不得再有点名「逐出留痕」的归因（= 修前的空 catch）⇒ Y-① 会红')
  assert.deepEqual(judgedSurface(), before, 'Z-⑥：对拍不得写仓')
})


// ══ 不变量普查（本轮）：「静默丢东西 / 归因错」逐处点名 ══════════════════════
test('Y-④ 普查：有界窗口淘汰也必须报数（丢读数不可与「正好没丢」同形）', async () => {
  const { ctx, attention } = await boot({ judge: 'ok' })
  assert.deepEqual(attention.windowDroppedCounts(), { failureSync: 0, failureBypass: 0, evictionLog: 0, focusDropLog: 0 }, '前置：尚无淘汰')
  const off = ctx.on('mana/injection', () => { throw new Error('noise') })
  perceive(ctx, { content: '候选', requestId: 'req-drop', sessionId: 'sess-drop' })
  for (let i = 0; i < 40; i += 1) await firePreStep(ctx, { turn: i + 1, sessionId: 'sess-drop' })
  off()
  const c = attention.emitFailureCounts()
  assert.equal(c.sync, c.cap, '同步表应被填满到上限：' + JSON.stringify(c))
  assert.ok(c.windowDropped.sync >= 1, '被窗口挤掉的条目数必须报出来（否则「丢过读数」与「正好 32 次」同形）')
  assert.equal(attention.windowDroppedCounts().failureSync >= 1, true, '独立读数入口同样要报出该量')
})

test('Y-⑤ 普查：同文件里的空 catch / 死代码已清零（结构性断言，不是印象）', async () => {
  const SRC = readFileSync(join(ROOT, 'packages', 'attention', 'src', 'index.ts'), 'utf8')
  const stripped = SRC.split(String.fromCharCode(47, 42)).map((chunk) => chunk.split(String.fromCharCode(42, 47)).slice(1).join(String.fromCharCode(42, 47))).join(String.fromCharCode(32))
  const code = stripped.split('\n').map((l) => l.split('//')[0]).join('\n')
  const emptyCatch = code.split('catch {').filter((_, i) => true).length - 1
  assert.equal(code.includes('catch {'), false, '不得残留 catch { 形态（本仓纪律：catch 必须带变量并记账）；空 catch 的检出由 Y-①/Y-② 的行为判据承担，实得 emptyCatch=' + emptyCatch)
  for (const name of ['blockPre', 'overBudgetPre', 'swallowedUpstream']) {
    assert.equal(code.includes(name), false, '不得残留未被读的 ' + name + '（不可达代码 = 下一次改动的现成绕过件）')
  }
})


// ══ 最后一批 R-1 / R-2 ═══════════════════════════════════════════════════════
test('Y-⑥ R-1：广播失败只有**唯一**归因入口（死 catch 已真删，无二次记账）', async () => {
  const { ctx, attention } = await boot({ judge: 'ok' })
  const off = ctx.on('mana/injection', () => { throw new Error('boom-inject-broadcast') })
  perceive(ctx, { content: '候选', requestId: 'req-r1', sessionId: 'sess-r1' })
  let threw = null
  try { await firePreStep(ctx, { turn: 1, sessionId: 'sess-r1' }) } catch (e) { threw = e }
  off()
  assert.equal(threw, null, '广播失败不得冒泡（R-1 未回退）')
  const failures = attention.deferredEmitFailures().filter((f) => f.message.includes('boom-inject-broadcast'))
  assert.equal(failures.length, 1, '同一次失败**只能**留 1 条读数（两处归因记同一件事必然漂开）：' + JSON.stringify(failures))
  assert.equal(failures[0].event, 'sync:mana/injection', '归因入口是 sync: 前缀（emitSyncGuarded 的计数）')
  // 结构性：被删掉的那条归因**调用**不得复活 —— 必须**剥注释**后再判。
  // ⚠ 本席第一版直接在整份文本里 includes，结果被**我自己的说明注释**命中（源码注释里引用了那行被删的代码）
  //   ⇒ 假红。这与前几轮"锚点被同名用例灌水"是同一类错误：**判据必须钉在代码上，不能钉在文本上**。
  //   同时：断言里的字面量本身也不能是"可被自己命中"的形态 ⇒ 用拼接构造，避免判据自我命中。
  const strippedOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const SRC_CODE = strippedOf(readFileSync(join(ROOT, 'packages', 'attention', 'src', 'index.ts'), 'utf8'))
  const LIB_CODE = strippedOf(readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'))
  const DEAD_LABEL = '注入审计广播' + '失败'
  assert.equal(LIB_CODE.includes('reportBypass(\'' + DEAD_LABEL + '\''), false, 'lib 代码里不得再有第二处广播失败归因（= 死 catch 复活）')
  assert.equal(SRC_CODE.includes('reportBypass(\'' + DEAD_LABEL + '\''), false, 'src 代码里不得再有第二处广播失败归因')
  assert.equal(LIB_CODE.includes('reportBypass('), true, 'reportBypass 仍须用于两段记账（不得被整块删掉）')
})

test('Y-⑦ R-2：文档与实现逐行一致（`finish` 是**两段**记账，不是三段）', async () => {
  const SRC = readFileSync(join(ROOT, 'packages', 'attention', 'src', 'index.ts'), 'utf8')
  assert.equal(SRC.includes('三段各自 try/catch'), false, '陈旧表述「三段各自 try/catch」必须消失（R-2）')
  assert.equal(SRC.includes('内三段记账各自的失败兜底'), false, '分类表第 7 行的陈旧表述必须消失（R-2）')
  assert.equal(SRC.includes('两段各自 try/catch'), true, '必须已改成与实现一致的「两段」')
  // 实现侧计数：finish 函数体内应恰好有 2 处 try/ catch(带变量)
  const finishStart = SRC.indexOf('const finish = (')
  const finishEnd = SRC.indexOf('const nextResult: unknown = await next()')
  assert.ok(finishStart > 0 && finishEnd > finishStart, '前置：能定位 finish 函数体')
  const body = SRC.slice(finishStart, finishEnd)
  const tryCount = (body.match(/try \{/g) ?? []).length
  assert.equal(tryCount, 2, 'finish 体内应恰好 2 处 try（两段各自归因）；实得 ' + tryCount)
})
