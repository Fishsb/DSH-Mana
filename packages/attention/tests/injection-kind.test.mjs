/**
 * **v10 §15.4 检索类型 · 信号源判据**（本批新建）。
 *
 * ── 本文件钉住的四件事（每件都可能是「恒真的假判据」，故逐条写明靶子）────────────
 *  ① **生产链真定档**：真实走两段生产路径 ——
 *     一次性行由 **attention 的 pre-step 门控**真注入产生（`inject_log` 是它的主审计行），
 *     链读数由 scheduler 驱动者消费 `mana/injection` 后回显。
 *     inject_log 里**有/无**该记忆的 `gate='injected'` 行 ⇒ 同一段生产代码必须给出**不同**的
 *     retrievalKind / retentionGainMs / until。直接调 service 只能证明「我调的函数返回了什么」，
 *     证明不了「宿主循环走到它了」（本包既有教训）。
 *  ② **本会话排除**：定档必须排除**本次注入自己**刚写下的那行。不排除 ⇒ 计数恒 ≥1 ⇒ **恒判再认**
 *     ⇒ 这条轴等于死掉。判据用**同一函数**在「本会话已有一行 injected」上仍必须吐 recall 来钉它。
 *  ③ **不变量不许破**：定档**查不到**（kind=null）⇒ kind=null / gain=0 / until===untilBase。
 *  ④ **「没定档」与「判为回忆」可分辨**：两者都不带增益，但只有后者 retrievalKind==='recall'；
 *     前者必须留下具名原因（kindProbe）—— 折成两态就等于让库故障静默白送 0.15 增益。
 *
 * ── 为什么在 attention 包内（而不是 scheduler）────────────────────────────────
 *   链条是 attention.retrievalKindFor **决策** + scheduler **接线**，两半都要有牙。
 *   本文件从宿主事件面起把两半一起断言（装配口径同 chains-e2e.test.mjs：**src 直读**，
 *   不走包名 —— 走包名会解析到 lib/ 产物，判据测的就成了旧代码）。
 *
 * ── ⚠ 如实标注的**未覆盖**（不得假装覆盖）──────────────────────────────────────
 *   · **「精细提取」（elaboration，增益 0.25）本仓当前无信号源** ⇒ 本批只接两档。
 *     理由：它要求「提取时做了精细加工」，而全仓没有任何地方记录这次提取**有没有被加工过**。
 *     编一个假信号（例如按窗长/按类型凑一档）比判不出来更坏。第三档的**可达性**因此**无法判定**。
 *   · 一个审计行只装得下**一个** memory_id（既有缺口，见 attention finish 处的说明）
 *     ⇒ 一块多条的注入只按**首条**定档。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(dir + '/src/index.ts', ROOT).href)
/** 同一链路的**两条腿**：scheduler 只报 string，故档位集合在判据侧固化（不 import 实现类型）。 */
const KINDS = ['recognition', 'recall', 'elaboration']
/** 驱动者写入 `mana_trace` 的命名空间前缀（与 scheduler 的 DRIVER_NAMESPACE 同源）。 */
const DRIVER_PREFIX = 'mana-scheduler/chain'

const cleanups = []
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

async function boot({ withAttention = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-kind-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')

  const ctx = new Context()
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)
  /**
   * 判定链桩注册在**装载本包之前** ⇒ 位于内层：attention 调的 `next()` 落到本桩。
   * 没有它 ⇒ 门控走不了注入分支 ⇒ `inject_log` 里一行都很不出来（K1 会退化成"空库对照"）。
   */
  ctx.on('mana/jev/judge', async (req) => ({
    requestId: req.requestId,
    source: 'test-stub-judge',
    value: 'yes',
    probability: 0.95,
    degraded: false,
    reason: null,
  }))
  if (withAttention) {
    ctx.plugin(await load('attention'), { judgeState: 'S' })
    await settle(150)
  }
  ctx.plugin(await load('reconsolidation'), {})
  await settle(150)
  ctx.plugin(await load('scheduler'), { maxGoals: 8, maxCycles: 2, driverEnabled: true })
  await settle(250)
  return { ctx, store }
}

/** 只读连接读 trace（**不复用插件句柄**：卸载即净会把它关掉）。 */
function readTrace(store, eventTypePrefix) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db
      .prepare('SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace WHERE event_type LIKE ? ORDER BY seq')
      .all(eventTypePrefix + '%')
  } finally {
    db.close()
  }
}

/**
 * 驱动者写入的再巩固链行（解析失败**抛**，不静默当空对象）。
 *
 * ⚠ 驱动者行的 `event_type` 是 **`mana-scheduler/chain/<链名>`**（前缀式），故按**前缀**取行、
 *   再按 payload 的 `chain` 字段认领。按等于号取会取到 0 行，而那个错看起来像「该链无触发者」
 *   （假归因——本席实测踩到过一次）。
 */
function lastReconsolidationRow(store) {
  const rows = readTrace(store, DRIVER_PREFIX).filter((r) => {
    try {
      return JSON.parse(r.payload ?? '{}').chain === 'reconsolidation'
    } catch {
      return false
    }
  })
  assert.ok(rows.length > 0, '未找到 chain=reconsolidation 的驱动者行 —— 该链仍无生产触发者')
  return JSON.parse(rows[rows.length - 1].payload)
}

function seedMemory(core, { id, content, type = 'semantic' }) {
  core.writeMemoryItem({ id, type, content })
}

/**
 * **真**注入一次：走宿主 `agent/pre-step` waterfall（不是直接调监听器）。
 * 这是 `inject_log` 行的**唯一**生产来源（core 的 `writeInjectLog` 只被 attention 调用）。
 *
 * ⚠ `content` 须含 `requestId` 同名串：attention 的 `finish` 把 `pending[0].requestId`
 *   写进 `inject_log.memory_id`（**真实现状**：`requestId` `'m1'` ⇒ 该行 `memory_id='m1'`），
 *   而 `pending` 的 requestId 由 `recall` 的 `key` 经 `buildInjectionBlock` 认领
 *   ⇒ 只有串匹配才对得上。**这不改生产行为**，只是让夹具造出「该记忆以前被取出来过」这一事实。
 */
function preStepInject(ctx, { sessionId, requestId, content }) {
  ctx.emit('mana/observation', { content, sessionId, turnId: 1, requestId, source: 'user-message', at: new Date().toISOString() })
  const payload = { agent: { session: { id: sessionId } }, messages: [], turn: 1, step: 1, signal: new AbortController().signal }
  return ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }))
}

/** 按 core 契约 `ManaInjection` 逐字段构造载荷（emit 型 ⇒ ctx.emit）。 */
function injection(sessionId, memoryId, turnId = 1) {
  return {
    sessionId,
    turnId,
    requestId: 'req-' + sessionId + '-' + String(turnId),
    at: new Date().toISOString(),
    gate: 'injected',
    blockId: 'blk-' + sessionId + '-' + String(turnId),
    memoryId,
    degraded: false,
  }
}

/** 直接读库上的窗口终点（取证面 = 真落库的那一列）。 */
function windowUntil(store, memoryId) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const row = db.prepare('SELECT reconsolidation_window_until AS w FROM memory_items WHERE id = ?').get(memoryId)
    return row?.w ?? null
  } finally {
    db.close()
  }
}

/** 该记忆的 `gate='injected'` 注入行数（可带会话过滤）。 */
function injectedRows(store, memoryId, sessionId = null) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const rows =
      sessionId === null
        ? db.prepare("SELECT id FROM inject_log WHERE memory_id = ? AND gate = 'injected'").all(memoryId)
        : db
            .prepare("SELECT id FROM inject_log WHERE memory_id = ? AND gate = 'injected' AND session_id = ?")
            .all(memoryId, sessionId)
    return rows.length
  } finally {
    db.close()
  }
}

const SEMANTIC_MS = 2 * 60 * 60 * 1000 // 语义 2h（reconsolidation 的裁定值）
const RECOGNITION_GAIN = Math.round(SEMANTIC_MS * 0.05) // 360000
const RECALL_GAIN = Math.round(SEMANTIC_MS * 0.15) // 1080000

// ══ K1 真跑对照：同一记忆「以前取出过」vs「从没有过」⇒ 三档读数必须不同 ══════════
test('K1 真跑对照：跨会话曾有注入行 ⇒ recognition(+360000)；从没有 ⇒ recall(+1080000)', async () => {
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'm1', content: '跨会话曾经被取出来过的这条记忆' })
  seedMemory(core, { id: 'm2', content: '从来没有被取出来过的这条记忆' })

  // 前置控制：两条都**没有**注入历史 —— 否则「有/无」对照不成立（G11 平凡通过防线）。
  assert.equal(injectedRows(store, 'm1'), 0, '前置：m1 开跑前不得有任何 injected 行')
  assert.equal(injectedRows(store, 'm2'), 0, '前置：m2 开跑前不得有任何 injected 行')

  // 真注入 m1（在 **s-A** 名下落一行）—— 这是 m1「以前取出过」的来源。
  await preStepInject(ctx, { sessionId: 's-A', requestId: 'm1', content: '跨会话曾经被取出来过的这条记忆' })
  await settle(400)
  assert.equal(injectedRows(store, 'm1', 's-A'), 1, 's-A 必须落一行 injected（否则「跨会话历史」无从谈起）')
  // 真注入 m2（只在 **s-B** 名下留一行）—— 它对 s-B 定档而言必须**等于没有**（本会话排除的靶子）。
  await preStepInject(ctx, { sessionId: 's-B', requestId: 'm2', content: '从来没有被取出来过的这条记忆' })
  await settle(400)
  assert.equal(injectedRows(store, 'm2', 's-B'), 1, 'm2 必须在 s-B 名下有一行（它正是「排除本会话」这条牙的靶子）')
  // 两条前置事实都成立（m1 有别的会话的行／m2 只有本会话的行），对照才有意义。
  assert.equal(injectedRows(store, 'm1', 's-B'), 0, 'm1 在 s-B 下必须**没有**行（它的历史只在 s-A）')

  // 链读数：同一段生产代码，两条记忆 → 两档。
  ctx.emit('mana/injection', injection('s-B', 'm1', 2))
  await settle(400)
  const seen = lastReconsolidationRow(store)
  assert.equal(seen.memoryId, 'm1', '本行须是 m1 那次（否则下面的断言打错靶）')
  assert.equal(seen.retrievalKind, 'recognition', '跨会话有前次注入 ⇒ 必须定档为再认；实测 ' + JSON.stringify(seen))
  assert.equal(seen.retentionGainMs, RECOGNITION_GAIN, '再认增益必须逐字 = round(2h×0.05) = ' + String(RECOGNITION_GAIN))

  ctx.emit('mana/injection', injection('s-B', 'm2', 3))
  await settle(400)
  const fresh = lastReconsolidationRow(store)
  assert.equal(fresh.memoryId, 'm2', '本行须是 m2 那次（否则下面的断言打错靶）')
  assert.equal(fresh.retrievalKind, 'recall', '除本会话外从无前次注入 ⇒ 必须定档为回忆；实测 ' + JSON.stringify(fresh))
  assert.equal(fresh.retentionGainMs, RECALL_GAIN, '回忆增益必须逐字 = round(2h×0.15) = ' + String(RECALL_GAIN))

  // 两档必须**真不同**（恒真判据/常量在链上会立刻现形）。
  assert.ok(
    seen.retentionGainMs !== fresh.retentionGainMs && seen.retrievalKind !== fresh.retrievalKind,
    '再认与回忆在真跑中必须产生不同读数（相同 ⇒ 定档没接上或恒真）',
  )

  // 真落库对拍：until === untilBase + 增益（逐字）。
  const untilIso = windowUntil(store, 'm2')
  assert.equal(
    untilIso,
    new Date(fresh.untilBase + fresh.retentionGainMs).toISOString(),
    'm2 的 untilBase+增益 必须与落库值逐字相同（口径取自 m2 那行自身读数，不引第二真源）',
  )
})

// ══ K2 本会话排除：**本会话自己**的既有行不得算作「以前取出过」 ═══════════════════
test('K2 定档排除本会话：本会话已有一行 injected ⇒ 仍判 recall（不得恒判再认）', async () => {
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'm3', content: '本会话自己留过一行的这条记忆' })
  const attention = ctx.get('mana-attention')
  assert.equal(typeof attention?.retrievalKindFor, 'function', '服务面必须暴露 retrievalKindFor（缺失即未接线）')

  // 本会话 s-C 已有一行（模拟「本次注入自己」那行 / 同会话重放）。
  core.writeInjectLog({ sessionId: 's-C', turnId: 1, requestId: 'req-c', gate: 'injected', memoryId: 'm3', blockId: 'blk-c' })
  assert.equal(injectedRows(store, 'm3', 's-C'), 1, '前置：s-C 上必须真有一行')

  const own = attention.retrievalKindFor('m3', 's-C')
  assert.equal(own.error, '', '定档必须查得到（error 空 = 查到了，不是「查不到」）')
  assert.equal(own.kind, 'recall', '**本会话**的行不得算作「以前取出过」⇒ 必须 recall；否则恒判再认')
  assert.equal(own.priorInjectedRows, 0, '排除本会话后可见的先前行数必须是 0（实测 ' + String(own.priorInjectedRows) + '）')

  // 同一行换个会话看 ⇒ 立刻变 recognition（证明对照是「会话口径」而非「没查到」）。
  const other = attention.retrievalKindFor('m3', 's-D')
  assert.equal(other.kind, 'recognition', '别的会话看到 s-C 那行 ⇒ 必须 recognition')
  assert.equal(other.priorInjectedRows, 1, '别的会话看到的先前行数必须是 1')

  // 第三态：查不到 ⇒ kind=null 且 error 非空（**不得**折成 recall）。
  const bad = attention.retrievalKindFor(null, 's-C')
  assert.equal(bad.kind, null, '入参非法/查询失败 ⇒ kind 必须为 null（不是 recall）')
  assert.notEqual(bad.error, '', '查不到必须留具名原因 —— 空原因 = 分辨不出来')
})

// ══ K3 不变量：定档不了 ⇒ kind=null / gain=0 / until===untilBase ════════════════
test('K3 链路不变量：attention 未装配 ⇒ 未声明，kind=null / gain=0 / until===untilBase', async () => {
  const { ctx, store } = await boot({ withAttention: false })
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'm4', content: '未装配 attention 时这条记忆' })

  ctx.emit('mana/injection', injection('s-E', 'm4', 1))
  await settle(400)

  const row = lastReconsolidationRow(store)
  assert.equal(row.retrievalKind, null, '未声明 ⇒ retrievalKind 必须显式 null（不是 undefined、不是某一档）')
  assert.equal(row.retentionGainMs, 0, '未声明 ⇒ 增益必须为 0')
  const until = windowUntil(store, 'm4')
  assert.equal(until, new Date(row.untilBase).toISOString(), '未声明 ⇒ until === untilBase（逐字）')
  // ④ 可分辨：「没定档」必须带具名原因（而不是静默等同「判为回忆」）。
  assert.notEqual(row.kindProbe, 'ok', '定档失败必须留下具名原因（否则与「判为回忆」同形）')
  assert.match(row.kindProbe, /未装配/, '原因须点名「未装配」：实测 ' + String(row.kindProbe))

  // 反证：真装了服务时 kindProbe === 'ok'（证明上一条不是因为该字段恒为失败态）。
  const b = await boot()
  seedMemory(b.ctx.get('mana-core'), { id: 'm5', content: '装了服务时这条记忆' })
  b.ctx.emit('mana/injection', injection('s-F', 'm5', 1))
  await settle(400)
  const ok = lastReconsolidationRow(b.store)
  assert.equal(ok.kindProbe, 'ok', '服务在装配时定档必须成功（否则上面的失败态是恒真）')
  assert.ok(KINDS.includes(ok.retrievalKind), '定档成功后必须是三档之一，实测 ' + String(ok.retrievalKind))
})

// ══ K4 三档可达性：**如实标注未覆盖**（不得假装覆盖）═════════════════════════════
test('K4 三档可达性：recall/recognition 真跑可达；elaboration **当前无信号源 ⇒ 未覆盖**', async () => {
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'm6', content: '可达性这条记忆' })
  const attention = ctx.get('mana-attention')

  // 先真注入一次（在 s-G 名下留一行）⇒ 之后的两次链读数必须分别落在两档上。
  await preStepInject(ctx, { sessionId: 's-G', requestId: 'm6', content: '可达性这条记忆' })
  await settle(400)
  assert.equal(injectedRows(store, 'm6', 's-G'), 1, '前置：s-G 名下必须真有一行')

  ctx.emit('mana/injection', injection('s-G', 'm6', 2)) // 本会话那行被排除 ⇒ 无历史 ⇒ 回忆
  await settle(400)
  const first = lastReconsolidationRow(store)
  ctx.emit('mana/injection', injection('s-H', 'm6', 3)) // 别的会话看到 s-G 那行 ⇒ 再认
  await settle(400)
  const second = lastReconsolidationRow(store)
  const reached = [...new Set([first.retrievalKind, second.retrievalKind])]
  assert.ok(reached.includes('recall') && reached.includes('recognition'), '两档必须真跑可达，实测 ' + JSON.stringify(reached))

  // 第三档：全仓无生产者 —— 断言「探针**不**产出它」（这条是**如实标注**，不是覆盖）。
  const kind = attention.retrievalKindFor('m6', 's-Z').kind
  assert.notEqual(kind, 'elaboration', 'elaboration 当前无信号源 ⇒ 绝不许由别处「顺手」产出（那是假信号）')
  console.log(
    JSON.stringify({
      elaboration: 'unreachable',
      reason: '全仓无「这次提取是否经过精细加工」的记录 ⇒ 当前无法判定（未编假信号）',
      reached,
      gains: [first.retentionGainMs, second.retentionGainMs],
    }),
  )
})
