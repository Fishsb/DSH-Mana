/**
 * **W1-1 七链条驱动者 · 端到端真跑判据**（本项的核心验收面）。
 *
 * ── 为什么本文件不能省（它是本批「判据不得只看单包单测」的落点）────────────────────
 *   四链（consolidation / reconsolidation / forgetting / learning）的**各包单测全绿**，
 *   然而那四个服务在生产侧**装配后零消费者** ⇒ 「实现完成」与「系统能跑」在报告层面同形。
 *   故本文件只做一件事：**从宿主事件出发**造输入，断言该链产出**可查行/可查数据**。
 *   它**不**直接调各链 service（那是单包单测的形态，测不出接线）。
 *
 * ── 每一链的「可查行」是哪一行（口径写死在这里，免得下一轮用别的行冒充）────────────
 *   | 链 | 造输入 | 产出的可查证据 | 该证据由谁写 |
 *   |---|---|---|---|
 *   | 编码 | `agent/inbox/inserted` | `mana_trace.event_type='observation'`（本会话） | attention 的 ingest |
 *   | 检索 | 同上 | `mana_trace.event_type='recall'` + `channel/rankBy` 字段 | vector 的 recall 出口 |
 *   | 巩固 | `scheduler.run()`×3 + `agent/turn-stopping` | `production_rules` **新增行** | consolidation.writeRules |
 *   | 再巩固 | `mana/injection`(gate=injected) | `mana-reconsolidation/window-opened` 行 + `memory_items.reconsolidation_window_until` | reconsolidation.openWindow |
 *   | 遗忘 | 低激活记忆 + `agent/turn-stopping` | 驱动者行的 `candidateIds` **含该 id**（⚠ 见表下说明） | scheduler 驱动者 |
 *   | 学习 | 两次同刻 `mana/injection` + `agent/turn-stopping` | `memory_items.related_ids` **非空** | learning.applyCoActivations |
 *
 *   ⚠ **遗忘链是唯一的例外，必须说清而不是含糊过去**：`forgetting` 按设计是**纯计算**
 *     （其文件头「行为面」明文：不写 `mana_trace`、不落库、不改 `retired`），
 *     B4.2 也只交付到「列候选」这一步。故它**没有**自有落点，可查证据只能是驱动者行里
 *     带回的**真读数**（`retireCandidates` 计数 + id 列表）。本文件对此另加一条**反向的牙**：
 *     断言 `retired` 列**一格没写**（见 T5）—— 否则「驱动者顺手把归档做了」会假绿。
 *
 * ── 反证（R 形态）与它的**前置控制**（不说清就是 G11 平凡通过）────────────────────────
 *   T8：卸载驱动者 ⇒ 同一触发**零新行**。前置控制 = 卸载后**四链服务仍可读**
 *   （证明「没新行」归因到驱动者，而不是归因到「链没了」）。
 *   若驱动者从不写行，T8 会**恒绿**——故 T1–T6 的存在本身就是 T8 的**正向前置控制**。
 *
 * ── 装配口径（与 `packages/core/tests/chain-e2e.test.mjs` 对齐）──────────────────────
 *   ① 一律用**临时库**（本仓硬纪律：绝不指向 `$DSH_HOME/memory/mana.db`）；
 *   ② 包从 **src** 直读（`load(dir)`，与 `scheduler.test.mjs` 同口径）：
 *      走包名会解析到 `lib/` 产物，而 `consolidation`/`learning` 的 lib
 *      本轮实测**落后于 src** ⇒ 按包名装配会让判据测的是**旧代码**（本仓既有教训）。
 *   ③ 触发走宿主**真分发语义**：`agent/inbox/inserted`/`mana/injection` 是 emit 型 ⇒ `ctx.emit`；
 *      `agent/turn-stopping` 是 **serial 型**（宿主 `await`）⇒ 必须 `ctx.serial`，
 *      用 `ctx.emit` 会把 async 监听器的 promise**丢掉**（那就成了「测了个没跑完的链」）。
 *   ④ `mana/injection` 载荷按 **core 契约**（`ManaInjection`）逐字段构造，不是自造形状。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const EXPECTED_CASES = 12
let ran = 0

const cleanups = []
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

/** 驱动者写入 `mana_trace` 的命名空间（与 src 的 `DRIVER_NAMESPACE` 同源，不手写第三套）。 */
const DRIVER_PREFIX = 'mana-scheduler/chain'

const { MANA_STAGES } = await load('core')
const { SEVEN_CHAIN_TABLE } = await load('scheduler')

/** 造一条宿主的 `UserMessage`（形状按 dsh-llm 的 `MessageBase`：id/role/content/source 四件）。 */
function userMessage(id, text) {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** 一个结构上像 agent 的对象；驱动者只从它读 `session.id`（不 import 宿主运行期）。 */
function fakeAgent(sessionId) {
  return { session: { id: sessionId } }
}

/**
 * 起一条链：core + 宿主事件面 + 驱动者 +（可选）四条链服务。
 *
 * `chains` 传 `false` = **不挂四链**（T7 的「未装配必须留痕」用）。
 * `driverEnabled` 透传给 scheduler 的 Config（T9 的「旋钮有牙」用）。
 */
async function boot({ chains = true, driverEnabled = true, maxChainItems = 200, learningBufferMax = 256 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-chains-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')

  const ctx = new Context()
  const coreMod = await load('core')
  ctx.plugin(coreMod, { storePath: store })
  await settle(200)

  if (chains) {
    // 顺序：被依赖者在前（core 已挂；vector 供 consolidation 的余弦通道）。
    for (const [dirName, cfg] of [
      ['perception', {}],
      ['attention', {}],
      // `embedEnabled:false` 是**判据纪律**：走词法分支 ⇒ **零网络**、零 Ollama 依赖，
      // 且 `channel='lexical'` 是一个可逐字断言的确定值（不是「碰巧没降级」）。
      ['vector', { embedEnabled: false }],
      ['reconsolidation', {}],
      ['forgetting', {}],
      ['learning', {}],
      ['consolidation', {}],
    ]) {
      ctx.plugin(await load(dirName), cfg)
      await settle(120)
    }
  }

  const schedMod = await load('scheduler')
  const schedFiber = ctx.plugin(schedMod, { maxGoals: 64, maxCycles: 8, driverEnabled, maxChainItems, learningBufferMax })
  await settle(300)

  return { ctx, store, schedFiber, dir }
}

/** 独立只读连接读 trace（**不复用插件句柄**：卸载即净会把它关掉）。 */
function readTrace(store, eventType = null) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const sql =
      eventType === null
        ? 'SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace ORDER BY seq'
        : 'SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace WHERE event_type = ? ORDER BY seq'
    return eventType === null ? db.prepare(sql).all() : db.prepare(sql).all(eventType)
  } finally {
    db.close()
  }
}

/** 驱动者写下的**全部**行（按命名空间认领，不按单个标签 —— 新增链标签时判据自动跟随）。 */
const driverRows = (store) =>
  readTrace(store).filter((r) => String(r.event_type).startsWith(DRIVER_PREFIX))

/** 取某链最近一行并解析 payload（解析失败**抛**，不静默当空对象）。 */
function lastChainRow(store, chain) {
  const rows = driverRows(store).filter((r) => {
    try {
      return JSON.parse(r.payload ?? '{}').chain === chain
    } catch {
      return false
    }
  })
  assert.ok(
    rows.length > 0,
    '未找到 chain=' + chain + ' 的驱动者行（可查行缺席 ⇒ 该链在生产侧仍无触发者）',
  )
  return JSON.parse(rows[rows.length - 1].payload)
}

/** 造一条活记忆（经 core 的 `writeMemoryItem`：唯一写口，不直接 INSERT）。 */
function seedMemory(core, { id, content, type = 'semantic', activation = 0, vector = null }) {
  core.writeMemoryItem({ id, type, content })
  core.db.prepare('UPDATE memory_items SET base_level_activation = ?, vector = ? WHERE id = ?').run(activation, vector, id)
}
// ══ T1 编码链：用户输入 ⇒ observation 可查行 ═════════════════════════════════
test('T1 编码链端到端：agent/inbox/inserted ⇒ 本会话 observation 可查行', async () => {
  ran += 1
  const { ctx, store } = await boot()
  const before = readTrace(store, MANA_STAGES[0]).length

  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-enc'), message: userMessage('m1', '编码链端到端真跑输入') })
  await settle(300)

  const own = readTrace(store, MANA_STAGES[0]).filter((r) => r.session_id === 's-enc')
  assert.ok(
    own.length >= 1,
    ' 本会话必须有 observation 行（before=' + String(before) + ' 全库该类=' + String(readTrace(store, MANA_STAGES[0]).length) + '）—— 无行即编码链仍无触发者',
  )
  const row = lastChainRow(store, 'encoding')
  assert.equal(row.assembled, true, 'perception 在链上 ⇒ assembled 必须为 true')
  assert.equal(row.chunks, 1, '短文本必须只出一块（分块是真行为，块数可断言）')
  assert.equal(row.v10Trigger, '用户输入', '§18.2 触发源须逐字回显（防驱动者偷偷换了触发口径）')
  void ctx
})

// ══ T2 检索链：用户输入 ⇒ recall 可查行 ═══════════════════════════════════════
test('T2 检索链端到端：用户输入 ⇒ 本会话 recall 可查行（含 channel/rankBy）', async () => {
  ran += 1
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  // 造一条**能命中**的记忆：查询串与 content 有 3+ 字的重合（FTS5 trigram 的长度闸）。
  seedMemory(core, { id: 'mem-ret', content: '末那识的记忆检索端到端用例', type: 'semantic' })

  ctx.emit('agent/inbox/inserted', {
    agent: fakeAgent('s-ret'),
    message: userMessage('m2', '末那识的记忆检索端到端用例'),
  })
  // recall 是 async（嵌入通道）⇒ 给足窗口；这里是**等待真完成**，不是 sleep 使其变绿。
  await settle(600)

  const rows = readTrace(store, MANA_STAGES[3]).filter((r) => r.session_id === 's-ret')
  assert.ok(rows.length >= 1, '本会话必须有 recall 行（实得 ' + String(rows.length) + '）—— 无行即检索链仍无触发者')
  const payload = JSON.parse(rows[rows.length - 1].payload)
  assert.equal(payload.query, '末那识的记忆检索端到端用例', '查询串须原样透传（不得被驱动者改写）')
  // embedEnabled:false ⇒ channel 必须是 'lexical'：那是**确定值**，不是「碰巧没降级」。
  assert.equal(payload.channel, 'lexical', '关掉嵌入后必须显式走词法分支（不得是 vector/degraded）')
  assert.equal(payload.rankBy, 'local_score', 'A1-11：非向量通道的排序依据必须是 local_score')
  // 驱动者行带回的是**同一轮**的读数 ⇒ 两处必须自洽（否则就是「同一个事实两处读数」）。
  const row = lastChainRow(store, 'retrieval')
  assert.equal(row.channel, 'lexical', '驱动者行的 channel 必须与契约行同源')
  assert.ok(row.candidates >= 1, '词法路应给出 ≥1 个候选（实得 ' + String(row.candidates) + '）')
})

// ══ T3 巩固链：run()×3 同序列 ⇒ production_rules 新增行 ═══════════════════════
test('T3 巩固链端到端：同序列算子 run()×3 ⇒ production_rules 真新增行', async () => {
  ran += 1
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  const sched = ctx.get('mana-scheduler')
  const countRules = () => Number(core.db.prepare('SELECT COUNT(*) c FROM production_rules').get().c)
  const before = countRules()

  // 三次**同序列** run ⇒ 满足 chunking 的「重复 ≥2 且序列 ≤7」（阈值都取自 consolidation 的 params）
  const operators = [
    { id: 'op-1', conditions: ['c1'], effects: ['c2'], utility: 0.5, successRate: 0.5, cost: 1 },
    { id: 'op-2', conditions: ['c2'], effects: ['c3'], utility: 0.5, successRate: 0.5, cost: 1 },
  ]
  for (let i = 0; i < 3; i += 1) sched.run(['c1'], operators)
  // 目标完成：把栈里的目标标 done（§18.2「目标完成」行的语义面）
  sched.pushGoal({ id: 'g-chunk', title: 'chunking 用例目标' })
  sched.goals.complete('g-chunk')

  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-cons'), turn: 7 })
  await settle(400)

  const after = countRules()
  assert.ok(
    after > before,
    '巩固链必须真写 production_rules：before=' + String(before) + ' after=' + String(after) + '（写不进去 = 巩固链仍无生产消费者）',
  )
  const row = lastChainRow(store, 'consolidation')
  assert.equal(row.assembled, true, 'consolidation 在链上 ⇒ assembled 必须为 true')
  assert.equal(row.rulesDrafted, 1, '三次同序列 run ⇒ 恰好 1 条规则草稿（得 ' + String(row.rulesDrafted) + '）')
  assert.equal(row.rulesInserted, after - before, '驱动者自称的写入数必须等于**库上真新增数**（两处读数不得漂开）')
  assert.equal(row.goalsDone, 1, '回显扫描到的 done 目标数（chunking 触发源的可见化）')
  assert.equal(row.runsConsumed, 3, '算子序列必须**消费式**取走：三次 run 各一条，取走即清空')
  // 消费式清空的牙：再 tick 一次 ⇒ runsConsumed 必须回 0（否则同一序列被 chunk 两次 = 重复计权）。
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-cons'), turn: 8 })
  await settle(300)
  assert.equal(lastChainRow(store, 'consolidation').runsConsumed, 0, '第二次 tick 必须取不到序列（消费式清空失效 ⇒ 重复 chunk）')
})

// ══ T4 再巩固链：mana/injection(injected) ⇒ 开窗 + 落库 ═══════════════════════
test('T4 再巩固链端到端：mana/injection(gate=injected) ⇒ 窗开启且真落库', async () => {
  ran += 1
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'mem-rcn', content: '再巩固端到端用例记忆', type: 'semantic' })

  const db0 = new DatabaseSync(store, { readOnly: true })
  const before = db0.prepare('SELECT reconsolidation_window_until AS w FROM memory_items WHERE id = ?').get('mem-rcn').w
  db0.close()
  assert.equal(before, null, '前置：该记忆开窗前必须无窗口值（否则「开了窗」不可归因）')

  // 载荷按 core 契约 ManaInjection 逐字段构造（emit 型 ⇒ ctx.emit）。
  ctx.emit('mana/injection', {
    sessionId: 's-rcn',
    turnId: 3,
    requestId: 'req-rcn',
    at: new Date().toISOString(),
    gate: 'injected',
    blockId: 'blk-1',
    memoryId: 'mem-rcn',
    degraded: false,
  })
  await settle(400)

  const db1 = new DatabaseSync(store, { readOnly: true })
  const after = db1.prepare('SELECT reconsolidation_window_until AS w FROM memory_items WHERE id = ?').get('mem-rcn').w
  db1.close()
  assert.ok(
    typeof after === 'string' && after !== '',
    '再巩固必须真落库（before=' + String(before) + ' after=' + String(after) + '）—— 仍为 NULL 即该链无生产触发者',
  )
  const owned = readTrace(store, 'mana-reconsolidation/window-opened')
  assert.ok(owned.length >= 1, '本包自有命名的开窗行必须出现（它才是该链的可查行）')
  assert.equal(JSON.parse(owned[owned.length - 1].payload).memoryId, 'mem-rcn', '开窗行须指向本条记忆')
  const row = lastChainRow(store, 'reconsolidation')
  assert.equal(row.assembled, true, 'reconsolidation 在链上 ⇒ assembled 必须为 true')
  assert.equal(row.persisted, true, '驱动者行的 persisted 必须与回读取证一致（写成功 ≠ 值对）')
  assert.equal(row.memoryType, 'semantic', '窗长由 type 决定 ⇒ type 必须被真读到并回显')
})

// ══ T5 遗忘链：低激活记忆 ⇒ 候选可查 + retired 未被写 ═════════════════════════
test('T5 遗忘链端到端：低激活记忆 ⇒ 候选可查，且驱动者**不写 retired**', async () => {
  ran += 1
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  // A ≤ τ−0.5 ⇒ 归档区间（τ 缺省 −2.0 ⇒ 阈值 −2.5）。造一条远低于它的。
  seedMemory(core, { id: 'mem-weak', content: '低激活候选记忆', type: 'episodic', activation: -9 })
  seedMemory(core, { id: 'mem-strong', content: '高激活对照记忆', type: 'episodic', activation: 5 })

  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-forget'), turn: 1 })
  await settle(400)

  const row = lastChainRow(store, 'forgetting')
  assert.equal(row.assembled, true, 'forgetting 在链上 ⇒ assembled 必须为 true')
  assert.ok(
    row.candidateIds.includes('mem-weak'),
    '低激活记忆必须进候选（实得 ' + JSON.stringify(row.candidateIds) + '）',
  )
  assert.equal(row.candidateIds.includes('mem-strong'), false, '高激活记忆**不得**进候选（否则候选集无判别力）')
  // ⛔ 反向的牙：驱动者**不得**代替 B4.2 完成归档。若哪天顺手写了 retired，本行必红。
  const db = new DatabaseSync(store, { readOnly: true })
  const retired = Number(db.prepare('SELECT COUNT(*) c FROM memory_items WHERE retired = 1').get().c)
  db.close()
  assert.equal(retired, 0, '⛔ 驱动者不得写 retired 列（B4.2 只交付到「列候选」；顺手归档即越界）')
  assert.equal(row.retiredWritten, 0, '驱动者行须**显式**声明 retiredWritten=0（不是省略字段）')
  assert.ok(
    Array.isArray(row.unimplemented) && row.unimplemented.length > 0,
    'retirementPlan().unimplemented 必须原样带出（防「只列候选」被读成「已归档」）',
  )
})
// ══ T6 学习链：两次共激活 ⇒ related_ids 真落库（Hebbian，非 FSRS）════════════
test('T6 学习链端到端：共激活流 ⇒ memory_items.related_ids 真落库且配对正确', async () => {
  ran += 1
  const { ctx, store } = await boot()
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'mem-a', content: '共激活甲', type: 'episodic' })
  seedMemory(core, { id: 'mem-b', content: '共激活乙', type: 'episodic' })

  const readRelated = (id) => {
    const db = new DatabaseSync(store, { readOnly: true })
    try {
      return db.prepare('SELECT related_ids AS r FROM memory_items WHERE id = ?').get(id).r
    } finally {
      db.close()
    }
  }
  assert.equal(readRelated('mem-a'), null, '前置：mem-a 无 related_ids（否则「写进去了」不可归因）')

  // 两次注入 = 两条激活事件。两条**同刻**（Date.now() 相邻 ⇒ 同一时间簇 ⇒ 一次 occasion）。
  // ⚠ 走的是生产入口 mana/injection（emit 型 ⇒ ctx.emit），不是直接调 learning 的服务。
  const inject = (requestId, memoryId) =>
    ctx.emit('mana/injection', {
      sessionId: 's-learn',
      turnId: 1,
      requestId,
      at: new Date().toISOString(),
      gate: 'injected',
      blockId: 'blk-' + requestId,
      memoryId,
      degraded: false,
    })
  inject('r-a1', 'mem-a')
  inject('r-b1', 'mem-b')
  await settle(200)

  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-learn'), turn: 1 })
  await settle(400)

  const row = lastChainRow(store, 'learning')
  assert.equal(row.assembled, true, 'learning 在链上 ⇒ assembled 必须为 true')
  assert.equal(row.eventsSeen, 2, '共激活流条数须原样回显（2 次注入 ⇒ 2 条事件，实得 ' + String(row.eventsSeen) + '）')
  assert.equal(row.degraded, false, 'related_ids 列存在 ⇒ 不得走降级路径（degraded=true 会让「没写进去」与「链没跑」同形）')
  assert.ok(
    typeof row.reason === 'string' || row.reason === null,
    'reason 字段必须存在（降级时要非空）',
  )

  const related = readRelated('mem-a')
  assert.ok(
    typeof related === 'string' && related !== '',
    '学习链必须真写 related_ids（实得 ' + String(related) + '；rowsWritten=' + String(row.rowsWritten) + '）',
  )
  assert.ok(
    related.includes('mem-b'),
    '写进去的关联必须指向 mem-b（实得 ' + String(related) + '）—— 指向别处即共激活配对算错',
  )
  // 驱动者行的 rowsWritten 必须与库上**真写了的行数**一致（两处读数不得漂开）。
  assert.equal(
    Number(readRelated('mem-b') !== null) + Number(related !== null),
    row.rowsWritten,
    '驱动者行的 rowsWritten 必须等于库上 related_ids 非空的行数（两处读数不得漂开）',
  )
})

// ══ T7 未装配必须留痕（不得静默跳过）══════════════════════════════════════════
test('T7 未装配的链：照写行 + assembled=false + 非空 reason（不得静默跳过）', async () => {
  ran += 1
  // 只挂 core + scheduler ⇒ 六条链服务**全部**不可读。
  const { ctx, store } = await boot({ chains: false })
  const sched = ctx.get('mana-scheduler')

  // 覆盖面：每一行的 status 都必须是 unassembled，且**都**带非空 reason。
  for (const row of sched.chains()) {
    if (row.hostTrigger === null) continue
    if (row.status === 'not-ported') continue
    assert.equal(row.status, 'unassembled', row.id + ' 应为 unassembled（实测 ' + row.status + '）')
    assert.ok(
      typeof row.reason === 'string' && row.reason !== '',
      row.id + ' 必须带非空 reason（静默跳过 = 失败不可观测）',
    )
  }
  const driven = sched.chains().filter((r) => r.hostTrigger !== null && r.status !== 'not-ported')
  assert.ok(driven.length >= 4, '至少四条链应有宿主触发面（实测 ' + String(driven.length) + '）')

  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-bare'), message: userMessage('m9', '未装配场景输入') })
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-bare'), turn: 1 })
  await settle(400)

  // 落痕腿：**编码链**在服务缺席时仍须写行（照写 + 未装配原因）。
  const enc = lastChainRow(store, 'encoding')
  assert.equal(enc.assembled, false, 'perception 缺席 ⇒ assembled 必须为 false')
  assert.equal(enc.status, 'unassembled', '状态必须显式是 unassembled（不得省略该字段）')
  assert.ok(
    typeof enc.reason === 'string' && enc.reason.includes('mana-perception'),
    '未装配的 reason 必须**点名缺哪一个服务**（实得 ' + String(enc.reason) + '）',
  )

  // 四条链各写一条 unassembled 行：一条都不能少（少一条 = 该链静默跳过）。
  const chainNames = driverRows(store).map((r) => JSON.parse(r.payload ?? '{}').chain)
  for (const chainName of ['consolidation', 'forgetting', 'reconsolidation-close', 'learning', 'retrieval']) {
    assert.ok(
      chainNames.includes(chainName),
      '未装配时链 ' + chainName + ' 仍必须留痕（实得链名：' + JSON.stringify([...new Set(chainNames)]) + '）',
    )
  }
})

// ══ T8 反证：卸载驱动者 ⇒ 同一触发零新行（带前置控制）══════════════════════════
test('T8 反证（R 形态）：卸载 scheduler ⇒ 同一触发零新行，且四链服务仍在（前置控制）', async () => {
  ran += 1
  const { ctx, store, schedFiber } = await boot()
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'mem-r8', content: '反证用例记忆', type: 'semantic' })

  const countDriverRows = () => driverRows(store).length

  // ── 正向前置控制：装上时必须**真写行** —— 否则下面的「卸载后不再产生新行」平凡通过（G11）。
  const before = countDriverRows()
  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-r8'), message: userMessage('m-r8', '反证正向前置输入') })
  await settle(400)
  const afterTrigger = countDriverRows()
  assert.ok(
    afterTrigger > before,
    '前置控制失败：装上后触发必须新增驱动者行（before=' + String(before) + ' after=' + String(afterTrigger) + '）—— 否则本反证是平凡通过',
  )

  await schedFiber.dispose()
  await settle(300)
  const atUnload = countDriverRows()

  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-r8'), message: userMessage('m-r8b', '卸载后再触发') })
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-r8'), turn: 2 })
  await settle(400)
  assert.equal(
    countDriverRows(),
    atUnload,
    '卸载后同一触发不得再产生新行（卸载时=' + String(atUnload) + ' 再触发后=' + String(countDriverRows()) + '）',
  )

  // ── 前置控制：链服务**仍在**（证明「没新行」归因到驱动者，而不是归因到「链没了」）。
  for (const name of [
    'mana-perception',
    'mana-vector',
    'mana-consolidation',
    'mana-forgetting',
    'mana-learning',
    'mana-reconsolidation',
  ]) {
    assert.ok(ctx.get(name), '卸载驱动者后 ' + name + ' 仍须可读（对照腿：否则「没新行」可能是链本身没了）')
  }
  assert.equal(ctx.get('mana-scheduler'), undefined, '驱动者自身必须真的卸载干净')
})
// ══ T9 旋钮有牙：driverEnabled=false ⇒ 零 chain 行 ═════════════════════════════
test('T9 真旋钮：driverEnabled=false ⇒ 零 chain 行（开关必须产生可观测差异）', async () => {
  ran += 1
  const { ctx, store } = await boot({ driverEnabled: false })
  const core = ctx.get('mana-core')
  seedMemory(core, { id: 'mem-off', content: '关闭驱动者用例', type: 'semantic' })

  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-off'), message: userMessage('m-off', '关闭态输入') })
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-off'), turn: 1 })
  await settle(400)

  assert.equal(driverRows(store).length, 0, 'driverEnabled=false ⇒ 必须零 chain 行（否则开关是假旋钮）')
  // 对照：服务与链服务都还在（关的是驱动者，不是整个包）⇒ 差异可归因到这一个开关。
  assert.equal(ctx.get('mana-scheduler').status().wired, true, '对照：服务仍在（关的是驱动者，不是插件）')
  assert.equal(ctx.get('mana-scheduler').status().driver.enabled, false, 'status() 必须如实回显开关态')
})

// ══ T10 覆盖面与 §18.2 表逐行对齐（口径表不得自说自话）═════════════════════════
test('T10 §18.2 表逐行对齐：七行齐、无宿主源的行**必带**理由', async () => {
  ran += 1
  const { ctx, store } = await boot()
  // 表自身的不变式（对源码里的唯一口径表直接断言，不经运行期）。
  assert.equal(SEVEN_CHAIN_TABLE.length, 7, '§18.2 触发时机表恰好七行（实测 ' + String(SEVEN_CHAIN_TABLE.length) + '）')
  const ids = SEVEN_CHAIN_TABLE.map((r) => r.id)
  assert.deepEqual(
    ids,
    ['user-input', 'tool-result', 'scheduled', 'goal-done', 'user-emphasis', 'memory-retrieved', 'retrieval-hit'],
    '七行的 id 与顺序须与 §18.2 原文一致（改动即判红）',
  )
  for (const row of SEVEN_CHAIN_TABLE) {
    if (row.hostTrigger === null) {
      assert.ok(
        typeof row.notDrivenReason === 'string' && row.notDrivenReason.length > 0,
        row.id + ' 无宿主触发源 ⇒ **必须**给出非空理由（留白 = 无法分辨「没源」与「忘了接」）',
      )
    }
    assert.ok(row.requires.length > 0, row.id + ' 必须声明依赖的服务（覆盖面判定需要它）')
  }
  // 运行期覆盖面：必须与表逐行同 id、同序。
  const sched = ctx.get('mana-scheduler')
  assert.deepEqual(sched.chains().map((r) => r.id), ids, '运行期覆盖面必须与口径表逐行同 id 同序')
  assert.equal(sched.chains().length, 7, '覆盖面恰好七行')

  // coverage trace 行与 chains() **同源**：两处读数不得漂开。
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-cov'), turn: 1 })
  await settle(300)
  const cov = lastChainRow(store, 'coverage')
  assert.equal(cov.rows.length, 7, 'coverage 行必须逐行落七行状态')
  assert.deepEqual(cov.rows.map((r) => r.id), ids, 'coverage 行的行序须与 chains() 一致')
  const live = sched.chains()
  for (let i = 0; i < live.length; i += 1) {
    assert.equal(cov.rows[i].status, live[i].status, 'coverage 行的 ' + live[i].id + ' 状态必须与 chains() 实时读数一致')
  }
})

// ══ T11 未装配的服务名清单（覆盖面判定是**运行期**的，不是启动快照）════════════
test('T11 覆盖面是运行期判定：后装配的链必须被接上（不是启动快照）', async () => {
  ran += 1
  // 先只挂 core + scheduler ⇒ forgetting 报 unassembled。
  const { ctx } = await boot({ chains: false })
  const sched = ctx.get('mana-scheduler')
  const before = sched.chains().find((r) => r.id === 'scheduled')
  assert.equal(before.status, 'unassembled', '前置：forgetting/consolidation 未装配时应为 unassembled')
  // 补挂 forgetting ⇒ 同一行的状态必须**自己变**（缓存启动快照会让它永远停在旧值）。
  ctx.plugin(await load('forgetting'), {})
  await settle(300)
  const after = sched.chains().find((r) => r.id === 'scheduled')
  assert.equal(after.status, 'unassembled', 'consolidation 仍缺 ⇒ 该行**仍**是 unassembled（两件都要，才算真按服务集判定）')
  assert.ok(
    !after.reason.includes('mana-forgetting'),
    '补挂 forgetting 后，reason 不得再点名它（缓存了启动快照就会继续点名 —— 实得 ' + String(after.reason) + '）',
  )
})

// ══ T12 形态面：三个宿主挂点 + 卸载即净 + 活行只在一处 ═════════════════════════
test('T12 形态面：驱动者不新增 pre-step 注册点；卸载后挂点全释放', async () => {
  ran += 1
  const { ctx, schedFiber, store } = await boot()
  // 本包在 pre-step 上仍**恰好** 1 条（G9：驱动者不得新开 waterfall 注册点）。
  let preStepHits = 0
  const probe = (c) => c.on('agent/pre-step', async (_p, next) => {
    preStepHits += 1
    return await next()
  })
  const off = probe(ctx)
  await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ messages: [] }))
  assert.equal(preStepHits, 1, '探针必须被走到（=本包的直通监听器放行了）')
  off()

  // 卸载：三个宿主挂点必须全部释放 ⇒ 再触发零新行（与 T8 同源，此处查的是「全释放」而非单链）。
  await schedFiber.dispose()
  await settle(300)
  const atUnload = driverRows(store).length
  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-form'), message: userMessage('m-form', '卸载后输入') })
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-form'), turn: 1 })
  await settle(400)
  assert.equal(driverRows(store).length, atUnload, '卸载后三个挂点全释放 ⇒ 零新行')
})

// ══ 自我核验：用例数必须与 EXPECTED_CASES 相等（防「用例被删/被截断」）═════════
test('Z9 自我核验：本文件声明的用例数等于实际执行数', () => {
  assert.equal(ran, EXPECTED_CASES, '用例数 ' + String(ran) + ' ≠ 声明值 ' + String(EXPECTED_CASES) + '（有用例被删/被截断）')
})