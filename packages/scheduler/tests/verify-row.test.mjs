/**
 * **验证行判据（VERIFYING 第一刀）**：把「本回合执行结果验证了没有」从**不可见**变**可数**。
 *
 * ── 这条判据要修的形态（本仓首位缺陷类）────────────────────────────────────────
 *   本仓此前**没有任何东西在追踪执行结果**：`TRACE_EVENTS` 恰好 10 个键，无 verify/result 类；
 *   `SEVEN_CHAIN_TABLE` 无「验证」行；`agent/error`/`agent/request-error` 本仓零监听
 *   ⇒ 「压根没验证」在库里**完全没有痕迹**（它与「验证了没问题」在报告层面同形）。
 *
 * ── 判据骨架（每条都配反证）────────────────────────────────────────────────────────
 *   ① **三态可分辨**：`verified` / `unverified` / `not-attempted` 三者**不得同形**
 *      —— 同一次触发、同一份 log，只改 log 里有没有失败证据，status 必须跟着变。
 *   ② **真转发**：开关经 `Config`（`index.ts` 的 Config + `createChainDriver` 实参）真到位
 *      —— 关掉 ⇒ `disabled` 行，且 `status()` 读数里 **0 次 verified/unverified**
 *      （证明"生产可调项"没被复制成蒸馏链那种"写了不生效"）。
 *   ③ **n=0 显式记 0**：没材料那态里 `verifications === 0` 是**写进 payload 的数**，不是缺字段
 *      （缺字段会让「没验证」与「没读出来」同形）。
 *   ④ **不进七行表 / 不进 coverage**：`SEVEN_CHAIN_TABLE.length===7` 且 `sched.chains()` 仍是 7 行
 *      —— 复刻 `DISTILL_CHAIN_ROW` 的"独立声明"先例，不得篡改 §18.2 那张表。
 *   ⑤ **不 await**：`agent/turn-stopping` 是 serial 型且由宿主 await；本次同时挂上一个
 *      1500ms 的慢监听器，本驱动者**不排在它后面** ⇒ 「阻塞宿主」是可分辨的失败。
 *   ⑥ **反证（卸载即净）**：卸载 scheduler ⇒ 同一触发零新 `verification` 行。
 *   ⑦ **既有用例不被误收**：新标签必须仍在 `mana-scheduler/chain` 命名空间下
 *      （`chains-e2e.test.mjs` 的 `driverRows()` 按前缀认领 —— 换前缀会让新行**逃出**判据视野）。
 *
 * 运行：`node --test packages/scheduler/tests/verify-row.test.mjs`
 * ⚠ 本文件**已登记**进 `packages/scheduler/verify.mjs` 的 `EXPECTED` —— 不登记的文件
 *   外部防线**压根不看它**（`generation-chain.test.mjs` 就是这么漏掉的）。
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
const EXPECTED_CASES = 6
let ran = 0

const cleanups = []
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

const DRIVER_PREFIX = 'mana-scheduler/chain'
const { CHAIN_TRACE_EVENTS, SEVEN_CHAIN_TABLE } = await load('scheduler')
/** 验证行的标签 —— 从 src 的常量取，**不手写第三套字面量**（漂开即判据失效）。 */
const VERIFICATION_TAG = CHAIN_TRACE_EVENTS.verification
const { VERIFICATION_STATUSES } = await load('scheduler')

/**
 * 造一条**结构上像宿主会话**的 `agent`。
 *
 * ⚠ 宿主 `SessionEvent` 的形状是 `{ type, seq, time, data }`
 *   （`node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:489`），
 *   `tool/result.data` 带 `{ turn, step, message }`（`:374`），
 *   `message.isError` 见 `dsh-llm/lib/types/message.d.ts:159`。
 *   ⇒ 本夹具**逐字对齐宿主声明**，不自己发明一个更顺手的形状
 *   （换形状会让判据测的是一个不存在的契约 = 假绿）。
 */
function fakeAgent(sessionId, events) {
  return { session: { id: sessionId, snapshotEvents: () => events } }
}
const toolResult = (turn, step, isError) => ({
  type: 'tool/result',
  seq: 0,
  time: Date.now(),
  data: { turn, step, message: { isError } },
})
const assistantMessage = (turn, step) => ({
  type: 'assistant/message',
  seq: 0,
  time: Date.now(),
  data: { turn, step, message: {} },
})

/** 起 core + scheduler（**不挂七链服务**：验证链按设计不依赖它们 ⇒ 装配面更小）。 */
async function boot({ verificationEnabled = true, verificationMaxEvents = 2000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-verify-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)
  const schedFiber = ctx.plugin(await load('scheduler'), {
    maxGoals: 64,
    maxCycles: 8,
    driverEnabled: true,
    verificationEnabled,
    verificationMaxEvents,
  })
  await settle(300)
  return { ctx, store, schedFiber }
}

/** 独立只读连接读 trace（不复用插件句柄 —— 卸载即净会把它关掉）。 */
function readTrace(store, eventType) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db
      .prepare('SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace WHERE event_type = ? ORDER BY seq')
      .all(eventType)
  } finally {
    db.close()
  }
}

/**
 * 验证行（按 src 常量给的标签认领，不按别的行冒充）。
 *
 * ⚠ `sessionId`/`turnId` 取**列**（`core.writeTrace` 把它们写入 `mana_trace` 的列，
 *   **不在 payload 里**）。按 payload 取会得到 undefined ⇒ 本文件第一版就撞过这一下
 *   （过滤全空、断言全落在 undefined 上）—— 这不是排版细节，是"读错面"。
 */
const verifyRows = (store) =>
  readTrace(store, VERIFICATION_TAG).map((r) => ({
    ...JSON.parse(r.payload ?? '{}'),
    sessionId: r.session_id,
    turnId: r.turn_id,
  }))

/** 触发一次回合边界；`agent` 由调用方给（它决定本回合的 log 里有什么）。 */
const tick = async (ctx, agent, turn = 1) => {
  await ctx.serial('agent/turn-stopping', { agent, turn })
  await settle(200)
}

// ══ ① 三态可分辨：同一次触发、只改 log ⇒ status 必须跟着变 ══════════════════════
test('① 三态可分辨：verified / unverified / not-attempted 三者不得同形（n=0 显式记 0）', async () => {
  ran += 1
  const { ctx, store } = await boot()

  // 态 3：本回合 log 里**没有**可验材料（只有一条别回合的事件）。
  await tick(ctx, fakeAgent('s-not', [toolResult(9, 1, false)]), 1)
  // 态 1：本回合有材料、**没有**失败证据。
  await tick(ctx, fakeAgent('s-ok', [toolResult(2, 1, false), assistantMessage(2, 2)]), 2)
  // 态 2：本回合有材料、**有**失败证据。
  await tick(ctx, fakeAgent('s-bad', [toolResult(3, 1, false), toolResult(3, 2, true)]), 3)

  const bySession = (id) => verifyRows(store).filter((p) => p.sessionId === id)
  const [notAttempted] = [...bySession('s-not')].reverse()
  const [verified] = [...bySession('s-ok')].reverse()
  const [unverified] = [...bySession('s-bad')].reverse()

  assert.equal(notAttempted.status, VERIFICATION_STATUSES.notAttempted, '无可验材料 ⇒ not-attempted')
  assert.equal(verified.status, VERIFICATION_STATUSES.verified, '有材料且无失败证据 ⇒ verified')
  assert.equal(unverified.status, VERIFICATION_STATUSES.unverified, '有材料且有失败证据 ⇒ unverified')

  // **三者互不相等** —— 这是本卡的核心要求，不是"各自对了就算"。
  assert.equal(
    new Set([notAttempted.status, verified.status, unverified.status]).size,
    3,
    '三态必须互不相等（实得 ' + JSON.stringify([notAttempted.status, verified.status, unverified.status]) + '）',
  )
  // n=0 是**显式记 0**（不是缺字段、不是 null）。
  assert.equal(notAttempted.verifications, 0, 'n=0 必须显式记 0（不得缺字段/写 null）')
  assert.equal(notAttempted.failures, 0, 'failures 也必须显式记 0')
  assert.equal(typeof notAttempted.reason, 'string', '每态都必须带非空 reason（不是留白）')
  assert.ok(notAttempted.reason.length > 0, 'not-attempted 不得空 reason')
  // 三态的读数**分列**：verified 那行数到 2 条材料，unverified 那行数到 2 条材料 + 1 条失败。
  assert.equal(verified.verifications, 2, 'verified 行的材料条数必须是真读数')
  assert.equal(unverified.verifications, 2, 'unverified 行的材料条数必须是真读数')
  assert.equal(unverified.failures, 1, 'unverified 行的失败条数必须是真读数')

  // 分列读数（readings）：三态各占一列，且任一为 0 时**显式记 0**。
  const d = ctx.get('mana-scheduler').status().driver
  assert.equal(d.verificationScanned, 3, '扫了 3 次（每次触发各一行）')
  assert.equal(d.verificationAttempted, 2, '有材料的 2 次 —— 与 scanned 的差就是「扫了但没材料」')
  assert.equal(d.verificationVerified, 1, '三态分列：verified')
  assert.equal(d.verificationUnverified, 1, '三态分列：unverified')
  assert.equal(d.verificationNotAttempted, 1, '三态分列：not-attempted（显式记 1，不是缺字段）')
  assert.equal(d.lastVerification.status, VERIFICATION_STATUSES.unverified, 'lastVerification 必须回显最近一次')
})

// ══ ② 真转发：开关经 Config 真到位（不是"写了不生效"）══════════════════════════
test('② 真转发：经 Config 关掉 ⇒ 落 disabled 行且零 verified/unverified（开关有牙）', async () => {
  ran += 1
  const { ctx, store } = await boot({ verificationEnabled: false })
  await tick(ctx, fakeAgent('s-off', [toolResult(1, 1, true)]), 1)

  const rows = verifyRows(store)
  assert.equal(rows.length, 1, '关掉也**必须**留一行（静默 = 把"开关关着"与"压根没接"同形）')
  assert.equal(rows[0].status, 'disabled', '关闭态必须有自己的 status（不得折进 not-attempted）')
  assert.ok(String(rows[0].reason).includes('verificationEnabled=false'), 'reason 必须点名开关（实得 ' + String(rows[0].reason) + '）')

  const d = ctx.get('mana-scheduler').status().driver
  assert.equal(d.verificationVerified, 0, '关掉后零 verified（开关真的改变了可观测行为）')
  assert.equal(d.verificationUnverified, 0, '关掉后零 unverified')
  assert.equal(d.verificationNotAttempted, 0, '关掉后也不得记成 not-attempted（三种"没验证"必须分列）')
  assert.equal(d.verificationScanned, 1, '扫了 1 次（开关事实本身也要可数）')
})

// ══ ③ 开关**缺省**可调：显式给 true 时行为与缺省一致（防"缺省即不可调"）══════════
test('③ 缺省即生效值：不传 verificationEnabled 时缺省为 true（与 index.ts 的 Config 缺省同源）', async () => {
  ran += 1
  const { ctx, store } = await boot()
  await tick(ctx, fakeAgent('s-default', [toolResult(1, 1, false)]), 1)
  const rows = verifyRows(store)
  assert.equal(rows.length, 1, '缺省必须发起（缺省关掉 = 交付一个不生效的开关）')
  assert.equal(rows[0].status, VERIFICATION_STATUSES.verified, '缺省态下正常判定（实得 ' + String(rows[0].status) + '）')
  assert.equal(ctx.get('mana-scheduler').status().driver.verificationAttempted, 1, '读数必须真的动起来')
})

// ══ ④ 不进七行表 / 不进 coverage（复刻 DISTILL_CHAIN_ROW 的独立声明先例）═══════
test('④ 不进七行表：SEVEN_CHAIN_TABLE 仍恰好 7 行，chains()/coverage 仍是 7 行', async () => {
  ran += 1
  const { ctx, store } = await boot()
  await tick(ctx, fakeAgent('s-table', [toolResult(1, 1, false)]), 1)

  assert.equal(SEVEN_CHAIN_TABLE.length, 7, '§18.2 触发时机表必须仍是 7 行（T10 四条钉死它）')
  const sched = ctx.get('mana-scheduler')
  assert.equal(sched.chains().length, 7, '覆盖面必须仍是 7 行（验证行不得挤进去冒充 §18.2 的行）')
  // coverage 行里的 rows 也必须还是 7 条：验证行若被塞进 coverage，这条会红。
  const db = new DatabaseSync(store, { readOnly: true })
  let cov
  try {
    cov = JSON.parse(
      db
        .prepare("SELECT payload FROM mana_trace WHERE event_type = ? ORDER BY seq DESC LIMIT 1")
        .get(`${DRIVER_PREFIX}/coverage`).payload ?? '{}',
    )
  } finally {
    db.close()
  }
  assert.equal(cov.rows.length, 7, 'coverage 行必须逐行只落七行状态（实得 ' + String(cov.rows.length) + '）')
  assert.ok(
    !cov.rows.some((r) => String(r.id).includes('verif')),
    'coverage 的七行里不得出现验证行（那会篡改 §18.2 的口径）',
  )
  // 但验证链**必须**有它自己的声明面（否则就是"有链无声明"）。
  const rows = verifyRows(store)
  assert.equal(rows[0].notInSevenChainTable, true, '验证行必须**自述**不进七行表（可读事实，不是注释承诺）')
})

// ══ ⑤ 不 await：宿主 await 的那个事件不得被本驱动者堵住 ════════════════════════
test('⑤ 不 await：慢监听器在场时，回合边界不得被本驱动者排在它后面', async () => {
  ran += 1
  const { ctx, store } = await boot()
  // serial 型事件按注册序依次 await ⇒ 这个 1200ms 的监听器排在驱动者**之前**。
  ctx.on('agent/turn-stopping', async () => {
    await new Promise((r) => setTimeout(r, 1200))
  })
  const agent = fakeAgent('s-slow', [toolResult(1, 1, false)])
  const began = Date.now()
  await ctx.serial('agent/turn-stopping', { agent, turn: 1 })
  const elapsed = Date.now() - began
  await settle(200)

  assert.ok(elapsed >= 1200, '前置控制：慢监听器**真被 await 了**（否则本用例是平凡通过）实得 ' + String(elapsed) + 'ms')
  const rows = verifyRows(store)
  assert.equal(rows.length, 1, '慢监听器在前 ⇒ 验证行仍必须落下（驱动者没被跳过）')
  assert.equal(rows[0].status, VERIFICATION_STATUSES.verified, '状态必须照常判定')
  assert.ok(
    elapsed < 3000,
    '回合边界总耗时不得被验证链再加一段（本链是同步结构读数）；实得 ' + String(elapsed) + 'ms',
  )
})

// ══ ⑥ 反证（卸载即净）＋ ⑦ 既有前缀认领不被破坏 ══════════════════════════════
test('⑥⑦ 反证：卸载后零新行；且新标签仍在既有命名空间前缀内（既有判据仍认领它）', async () => {
  ran += 1
  const { ctx, store, schedFiber } = await boot()
  const agent = fakeAgent('s-unload', [toolResult(1, 1, false)])
  await tick(ctx, agent, 1)
  assert.equal(verifyRows(store).length, 1, '前置：挂载期必须真写行（否则下面的反证是平凡通过）')

  await schedFiber.dispose()
  await settle(300)
  const atUnload = verifyRows(store).length
  await tick(ctx, agent, 2)
  assert.equal(verifyRows(store).length, atUnload, '卸载后同一触发 ⇒ 零新 verification 行（挂点真释放）')

  // ⑦：新标签仍在 `mana-scheduler/chain` 命名空间下 —— `chains-e2e` 的 driverRows() 按前缀认领，
  //   换前缀会让新行**逃出**既有判据的视野（用户可读的集合与判据看的集合就漂开了）。
  assert.ok(
    VERIFICATION_TAG.startsWith(DRIVER_PREFIX + '/'),
    '验证标签必须在既有命名空间内（实得 ' + VERIFICATION_TAG + '），否则既有 driverRows() 不再跟随它',
  )
  assert.equal(
    Object.keys(CHAIN_TRACE_EVENTS).length,
    11,
    'TRACE_EVENTS 必须是 11 个键（第 11 键 = verification；键集减少说明有一条链被摘掉了）',
  )
})

// ══ 自我核验：用例数必须与 EXPECTED_CASES 相等（防「用例被删/被截断」）═════════
test('Z1 自我核验：本文件声明的用例数等于实际执行数', () => {
  assert.equal(ran, EXPECTED_CASES, '用例数 ' + String(ran) + ' ≠ 声明值 ' + String(EXPECTED_CASES) + '（有用例被删/被截断）')
})
