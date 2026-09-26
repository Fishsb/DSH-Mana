/**
 * **蒸馏链通电判据（v10 §12.3 · E1）** —— 「链在跑」，不是「链可用」。
 *
 * ── 本文件防的形态（上一批交付留下的）────────────────────────────────────────────
 *   `packages/consolidation/src/distill.ts`（868 行 / 六步链 / 18 条判据）交付时**零生产触发者**：
 *   它的单测全绿，但它自己的文件头就写着「**不注册监听器、不起定时器**：触发源归 scheduler」。
 *   ⇒ 「链有了」与「链在跑」在报告层面**同形** —— 与它自己要修的缺陷
 *   （`perception/src/signal.ts#prefilterBySignalWords` 零消费方）是**同一形态**。
 *
 * ── 为什么本文件不直接 import distillSession 来断言（这条是本文件的存在理由）──────────
 *   「测试直接 import 这个函数并调用它」证明的是**函数可用**，不是**链在跑**。
 *   故本文件从**宿主事件**出发造输入（`agent/inbox/inserted` + `agent/turn-stopping`），
 *   真装配 core/perception/attention/consolidation/scheduler，并**在运行期把 LLM 换成会计数
 *   的桩**，断言：
 *     ① 预筛**未命中** ⇒ LLM 桩**零调用**（v10 §12.3「零 LLM 成本」的落点）；
 *     ② 同一批里只要一条命中 ⇒ 桩恰好 1 次（**证明上面的 0 不是"链压根没跑"**）。
 *   两条合起来，"零 LLM 成本"才是**实测读数**。
 *
 * ── 三个通道各自的职责（互不冒充）────────────────────────────────────────────────
 *   | 通道 | 替换的是谁 | 计数的是谁 | 缺了它就只能证明 |
 *   |---|---|---|---|
 *   | `registerHooks` 拦 `dsh-mana-perception` | 链内**运行期解析**到的预筛实现 | 预筛**真被调用** | 否则「零 LLM」可能只是预筛没跑 |
 *   | `ctx.provide('mana-llm')` | 链内**现解析**的判定通道 | LLM **真被调用** | 否则「零调用」可能只是通道不通 |
 *   | `node:test` 的 `mock.timers`（Date） | 时钟 | 空闲时长 | 否则 10 分钟阈值在本判据里不可达 |
 *
 *   ⚠ **桩是透明的**：它 `createRequire` 真实现后**逐字转发**（只多一次计数/可选抛错），
 *     故「预筛真的跑了」与「用的是真词表」两件事同时成立（`prefilterTable='builtin'` 可查）。
 *
 * ── 装配口径 ────────────────────────────────────────────────────────────────
 *   · 临时库（本仓硬纪律：绝不指向 `$DSH_HOME/memory/mana.db`）；
 *   · 生产链从 **lib** 直读（`load('consolidation')` ⇒ `lib/index.js`）—— 本文件判的是
 *     **产物在跑**，故 `npm run build` 必须在前（改 src 不重建 ⇒ 本文件红，正是想要的方向）；
 *   · 触发走宿主**真分发语义**：`agent/inbox/inserted` 是 emit 型（`ctx.emit`），
 *     `agent/turn-stopping` 是 **serial 型**（`ctx.serial`，宿主 `await`）。
 *
 * 运行（显式路径）：npm run build && node --test packages/consolidation/tests/distill-wiring.test.mjs
 */
import { test, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

/** 本文件在 `packages/consolidation/tests/` ⇒ 上溯三级到**仓根**（`packages/` 的父目录）。 */
const REPO = new URL('../../../', import.meta.url)
/** 从**产物**直读（判「产物在跑」；src 未重建即红 —— 见文件头）。 */
const load = (dir) => import(new URL(`packages/${dir}/lib/index.js`, REPO).href)
const EXPECTED_CASES = 9
let ran = 0

const cleanups = []
after(() => {
  mock.timers.reset()
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

// ── 预筛桩（运行期拦截 `dsh-mana-perception`）──────────────────────────────────
/** ⚠ 真实现入口**在注册 hook 之前**取 —— 之后再取会解析到桩自己（自引用）。 */
const REAL_PERCEPTION_INDEX = fileURLToPath(import.meta.resolve('dsh-mana-perception'))
const stubHome = mkdtempSync(join(tmpdir(), 'mana-distill-wiring-'))
cleanups.push(stubHome)
writeFileSync(join(stubHome, 'package.json'), JSON.stringify({ name: 'mana-perception-spy', type: 'module' }))
writeFileSync(
  join(stubHome, 'index.js'),
  [
    "import { createRequire } from 'node:module'",
    'const req = createRequire(import.meta.url)',
    `const real = req(${JSON.stringify(REAL_PERCEPTION_INDEX)})`,
    'export const BUILTIN_SIGNAL_TABLE = real.BUILTIN_SIGNAL_TABLE',
    'export function __calls() { return globalThis.__manaPrefilterCalls ?? 0 }',
    'export function prefilterBySignalWords(text, table) {',
    '  globalThis.__manaPrefilterCalls = (globalThis.__manaPrefilterCalls ?? 0) + 1',
    "  if (globalThis.__manaPrefilterThrow === true) throw new Error('预筛桩按设计抛错')",
    '  return real.prefilterBySignalWords(text, table)',
    '}',
    '',
  ].join('\n'),
)
const prefilterSpyCalls = () => globalThis.__manaPrefilterCalls ?? 0
const resetPrefilterSpy = (throwOnCall = false) => {
  globalThis.__manaPrefilterCalls = 0
  globalThis.__manaPrefilterThrow = throwOnCall
}
let intercepted = 0
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'dsh-mana-perception') {
      intercepted += 1
      return { url: pathToFileURL(join(stubHome, 'index.js')).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

// ── 计数 LLM 桩（链内现解析 `mana-llm`）────────────────────────────────────────
function makeLlm(reply) {
  const stub = {
    calls: 0,
    prompts: [],
    async generate(req) {
      stub.calls += 1
      stub.prompts.push(req.prompt)
      if (reply === 'throw') throw new Error('LLM 桩按设计抛错')
      return { ok: true, text: typeof reply === 'string' ? reply : JSON.stringify(reply), callId: 'spy-call-' + String(stub.calls) }
    },
  }
  return stub
}

/** 一条**确定性命中**内置信号词表（含「偏好」）的输入。 */
const HIT_INPUT = '[偏好] 清单格式·以后逐条复核再交付'
/** 一条**确定性不命中**的输入（不含任何内置信号词）。 */
const MISS_INPUT = 'mvn clean verify ran fine again today'
/**
 * 一条**能过全部四道门**的蒸馏产出（逐门核对，不是"试着写一条"）：
 *   地址 `notes/user.md` ∈ 白名单；标签 `偏好` ∈ 14 类；长度 ≥8 且含「·」；
 *   粗粒度（无日期戳 / 无路径 / 无行号 / ≤120 码点）；编码侧码判 bigram 重叠 5 ≥ 2（实测）。
 */
const ADMITTED_TEXT = '[偏好] 长期记忆·值得长期记住的交付纪律'

// ── 宿主载荷（按契约形状，不自造）────────────────────────────────────────────
const fakeAgent = (sessionId) => ({ session: { id: sessionId } })
const userMessage = (text) => ({ id: 'm-' + text.length, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })

/** 起一条**完整生产链**：core + 宿主事件面 + perception/attention + consolidation + scheduler。 */
async function boot({ chains = true, scheduler = {}, llm = makeLlm('{"proposals":[]}') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-distill-wiring-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)
  if (chains) {
    for (const dirName of ['perception', 'attention', 'consolidation']) {
      ctx.plugin(await load(dirName), {})
      await settle(90)
    }
    ctx.provide('mana-llm', llm)
  }
  const schedFiber = ctx.plugin(await load('scheduler'), scheduler)
  await settle(200)
  return { ctx, store, dir, schedFiber, llm }
}

/** 驱动者写下的 distillat* 行（按 chain 名认领，不按 phase 抽查）。 */
function chainRows(store, chain) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db
      .prepare("SELECT seq, event_type, session_id, payload FROM mana_trace WHERE event_type LIKE 'mana-scheduler/chain%' ORDER BY seq")
      .all()
      .map((r) => ({ ...r, parsed: JSON.parse(r.payload ?? '{}') }))
      .filter((r) => r.parsed.chain === chain)
  } finally {
    db.close()
  }
}
/**
 * 错误行**按 event_type 认领**，不按 `payload.chain` —— 错误行的 `chain` 字段是**出错的那条链**
 * （`'distillation'`），拿 `chainRows(store,'error')` 去找会**永远找不到**（实测踩到：
 * 计数已是 `distillationErrors=1`，而按 chain 过滤的行数是 0）。
 */
function errorRows(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db
      .prepare("SELECT seq, session_id, payload FROM mana_trace WHERE event_type = 'mana-scheduler/chain/error' ORDER BY seq")
      .all()
      .map((r) => ({ ...r, parsed: JSON.parse(r.payload ?? '{}') }))
  } finally {
    db.close()
  }
}

const memoryRows = (store) => {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db.prepare('SELECT id, type, content FROM memory_items').all()
  } finally {
    db.close()
  }
}

// ── 时钟（`mock.timers` 的 Date 通道）────────────────────────────────────────
/**
 * ⚠ `mock.timers` 是**进程级**的：同文件多用例里重复 `enable` 会抛
 *   `MockTimers is already enabled`。故`startClock` 先 reset 再 enable（幂等），
 *   每个用例都从"干净时钟"开始 —— 否则第二个用例起全部报错（实测踩到）。
 */
let clock = 0
const startClock = () => {
  mock.timers.reset()
  mock.timers.enable({ apis: ['Date'] })
  clock = Date.now()
}
const advance = (ms) => {
  clock += ms
  mock.timers.setTime(clock)
}

/** 造一次活动（真用户输入）⇒ 驱动者记下"最近活动时刻"。 */
const userInput = (ctx, sessionId, text) => ctx.emit('agent/inbox/inserted', { agent: fakeAgent(sessionId), message: userMessage(text) })
/** 真宿主分发语义：turn-stopping 是 serial 型（宿主 await）。 */
const turnBoundary = async (ctx, sessionId, turn) => {
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent(sessionId), turn })
  // 蒸馏是**不 await** 的（见 chains.ts 的 runDistillation 注释）⇒ 给收敛留窗口。
  await settle(250)
}

// ══ ① 两处阈值同源（触发侧 vs 链内）══════════════════════════════════════════
test('① 阈值两处一致：触发侧常量 === 链内 DISTILL_IDLE_THRESHOLD_MS，且 === Config 缺省', async () => {
  ran += 1
  const chains = await import(new URL('packages/scheduler/lib/chains.js', REPO).href)
  const distill = await import(new URL('packages/consolidation/lib/distill.js', REPO).href)
  assert.equal(
    chains.DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS,
    distill.DISTILL_IDLE_THRESHOLD_MS,
    '触发侧与链内的空闲阈值**必须是同一个数**（两处落点：' +
      String(chains.DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS) + ' vs ' + String(distill.DISTILL_IDLE_THRESHOLD_MS) + '）',
  )
  assert.equal(chains.DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS, 10 * 60 * 1000, 'v10 §12.3 原文是「空闲 10 分钟」')
  // 缺省不得是**第二份**字面量：DISTILL_DEFAULTS 必须引同一个常量。
  assert.equal(
    chains.DISTILL_DEFAULTS.distillIdleThresholdMs,
    chains.DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS,
    'DISTILL_DEFAULTS 的阈值必须引常量而不是再写一遍字面量（两处真源必然漂开）',
  )
  const { ctx } = await boot({ chains: false })
  const svc = ctx.get('mana-scheduler')
  assert.equal(svc.status().driver.distillationDispatched, 0, '未触发前计数必须是 0（显式记 0，不是省略）')
})

// ══ ② 口径表新增行：v10Trigger / hostTrigger / requires / substitution 齐备 ═══
test('② 蒸馏链的触发声明齐备（v10 触发源逐字/宿主面/替代/依赖），且**七行表未被改动**', async () => {
  ran += 1
  const chains = await import(new URL('packages/scheduler/lib/chains.js', REPO).href)
  const row = chains.DISTILL_CHAIN_ROW
  assert.ok(row, '必须有 DISTILL_CHAIN_ROW（缺了 = 蒸馏链仍无触发归属）')
  assert.equal(row.v10Trigger, '空闲 10 分钟', '触发源须逐字取 v10 §12.3 原文；实测 ' + String(row.v10Trigger))
  assert.equal(row.hostTrigger, 'agent/turn-stopping', '本仓无定时器 ⇒ 由回合边界承担；实测 ' + String(row.hostTrigger))
  assert.ok(
    typeof row.substitution === 'string' && row.substitution.length > 0,
    '**替代**（回合边界 ≠ v10 定时器）必须显式写明，不得静默替代',
  )
  assert.ok(
    row.requires.includes('mana-consolidation'),
    '依赖必须声明 mana-consolidation（该行据此判 unassembled）；实测 ' + JSON.stringify(row.requires),
  )
  assert.ok(row.v10Chains.includes('会话蒸馏'), '链条列须点名它驱动的是哪条链；实测 ' + JSON.stringify(row.v10Chains))

  // ── 反向的牙（拆东墙补西墙的判据）：`SEVEN_CHAIN_TABLE` 是 §18.2 的**唯一口径表**，
  //    它必须仍然**恰好七行**且 id/顺序逐字未动 —— 蒸馏不属那七行，塞进去就是篡改那张表
  //    （既有判据 chains-e2e T10 会红，那正是「为了给自己的改动腾位置而弄坏别处」的形态）。
  assert.equal(chains.SEVEN_CHAIN_TABLE.length, 7, '§18.2 七行表必须仍是恰好七行；实测 ' + String(chains.SEVEN_CHAIN_TABLE.length))
  assert.deepEqual(
    chains.SEVEN_CHAIN_TABLE.map((r) => r.id),
    ['user-input', 'tool-result', 'scheduled', 'goal-done', 'user-emphasis', 'memory-retrieved', 'retrieval-hit'],
    '七行的 id 与顺序不得被本次改动碰过',
  )
  assert.ok(
    !chains.SEVEN_CHAIN_TABLE.some((r) => r.id === 'idle-distillation'),
    '蒸馏行**不得**混进 §18.2 的七行表（它由 §12.3 自己规定触发；混进去即篡改口径）',
  )

  // 生产装配下，该声明必须能按 requires 判出"链在不在"
  const { ctx } = await boot()
  const svc = ctx.get('mana-scheduler')
  assert.equal(typeof svc.chains, 'function', 'chains() 仍是 §18.2 七行的覆盖面（本卡不改它的语义）')
  assert.equal(svc.chains().length, 7, '覆盖面行数必须仍是 7（蒸馏不并进去）')
  assert.equal(svc.driverReadings().distillationDispatched, 0, '未触发前蒸馏计数显式记 0')
})

// ══ ③ 核心：生产路径真调用 ⇒ 预筛 miss 时 **零 LLM 调用** ════════════════════
test('③ 核心：空闲到点 ⇒ 生产路径调 distillSession；预筛 miss ⇒ LLM 桩零调用', async () => {
  ran += 1
  resetPrefilterSpy()
  const llm = makeLlm('throw') // 桩**会抛**：真被调到就不会以"零调用"的形态收场
  const { ctx, store } = await boot({ llm })
  const sched = ctx.get('mana-scheduler')

  startClock()
  await turnBoundary(ctx, 's-idle', 1) // 第一个回合边界：建立活动打点（尚无活动 ⇒ 如实 skipped）
  userInput(ctx, 's-idle', MISS_INPUT)
  await settle(250)
  const before = sched.driverReadings()
  assert.equal(before.distillationDispatched, 0, '未到空闲阈值前**不得**发起（前置控制）')
  resetPrefilterSpy() // 只统计"到点"这一次之后的桩调用

  advance(10 * 60 * 1000) // 恰好 10 分钟（边界值）
  await turnBoundary(ctx, 's-idle', 2)

  const rows = chainRows(store, 'distillation')
  const settled = rows.filter((r) => r.parsed.phase === 'settled')
  assert.equal(settled.length, 1, '必须恰好有一行 settled（发起了且收敛了；实测 ' + String(settled.length) + ' 行）')
  const p = settled[0].parsed
  // ── 核心断言（「零 LLM 成本」的落点）──
  assert.equal(p.state, 'prefiltered-out', '全 miss ⇒ 终态必须是 prefiltered-out；实测 ' + String(p.state) + ' / ' + String(p.reason))
  assert.equal(p.llmCalls, 0, '**核心判据**：预筛 miss ⇒ 链内 LLM 调用计数必须为 0；实测 ' + String(p.llmCalls))
  assert.equal(llm.calls, 0, '**桩自身计数也必须为 0**（两处读数不得漂开）；实测 ' + String(llm.calls))
  // ── 前置控制：0 不是"链没跑"冒出来的 ──
  assert.ok(intercepted > 0, '运行期拦截必须真的生效（否则本判据测的是真 perception，无法计数）')
  assert.ok(prefilterSpyCalls() > 0, '预筛**必须真被调用过**（实测 ' + String(prefilterSpyCalls()) + ' 次）—— 否则上面的 0 只是"预筛没跑"')
  assert.equal(p.prefilterRan, true, '预筛必须 ran=true（它不是"没跑"，是"跑了没命中"）')
  assert.equal(p.prefilterHit, 0, '本条腿全部未命中；实测 hit=' + String(p.prefilterHit))
  assert.ok(p.prefilterScanned >= 1, '扫描条数必须 ≥1（0 会让本腿退化成空跑）；实测 ' + String(p.prefilterScanned))
  assert.equal(p.prefilterTable, 'builtin', '词表必须来自真实现（桩转发的是真表）；实测 ' + String(p.prefilterTable))
  // 两处阈值在**同一行**里可见 ⇒ 漂开一眼可读。
  assert.equal(p.thresholdMs, p.chainThresholdMs, '触发侧阈值与链内阈值必须相等；实测 ' + String(p.thresholdMs) + ' vs ' + String(p.chainThresholdMs))
  const r2 = sched.driverReadings()
  assert.equal(r2.distillationDispatched, 1, '发起次数必须记 1（实测 ' + String(r2.distillationDispatched) + '）')
  assert.equal(r2.distillationSettled, 1, '收敛次数必须记 1；实测 ' + String(r2.distillationSettled))
  assert.equal(r2.lastDistillation.outcome.llmCalls, 0, 'lastDistillation 读数与 trace 行**同源**，不得漂开')
  console.log('[桩计数证据] prefilter 桩被调用 ' + String(prefilterSpyCalls()) + ' 次，LLM 桩被调用 ' + String(llm.calls) + ' 次 ⇒ llmCalls=' + String(p.llmCalls))
})

// ══ ④ 反方向：一条命中 ⇒ LLM 桩恰好 1 次 + 真落库 ════════════════════════════
test('④ 反方向：预筛命中 ⇒ LLM 桩恰好 1 次，产出过门并真落库（memory_items 新增行）', async () => {
  ran += 1
  resetPrefilterSpy()
  const llm = makeLlm(JSON.stringify({ proposals: [{ from: 'c1', text: ADMITTED_TEXT, target: 'notes/user.md', coarse: true }] }))
  const { ctx, store } = await boot({ llm })
  const before = memoryRows(store).length

  startClock()
  await turnBoundary(ctx, 's-hit', 1)
  userInput(ctx, 's-hit', HIT_INPUT)
  await settle(250)
  advance(11 * 60 * 1000)
  await turnBoundary(ctx, 's-hit', 2)

  const settled = chainRows(store, 'distillation').filter((r) => r.parsed.phase === 'settled')
  assert.equal(settled.length, 1, '恰好一行 settled；实测 ' + String(settled.length))
  const p = settled[0].parsed
  assert.equal(p.state, 'adjudicated', '命中且过门 ⇒ adjudicated；实测 ' + String(p.state) + ' / ' + String(p.reason))
  assert.equal(p.llmCalls, 1, '命中 ⇒ 恰好 1 次 LLM 调用（**证明③的 0 不是"链压根没跑"**）；实测 ' + String(p.llmCalls))
  assert.equal(llm.calls, 1, '桩自身计数必须同样是 1；实测 ' + String(llm.calls))
  assert.ok(prefilterSpyCalls() > 0, '本腿同样经过真预筛（命中不是跳过预筛）')
  assert.equal(p.writeEnabled, true, '生产写面必须开着（coreDistillStore）')
  assert.equal(p.inserted, 1, '必须真落库 1 条；实测 ' + String(p.inserted))
  // 库上回读：**驱动者自称的写入数必须等于库上真新增的行**（两处读数不得漂开）。
  const after = memoryRows(store)
  assert.equal(after.length, before + 1, 'memory_items 必须真新增 1 行（before=' + String(before) + ' after=' + String(after.length) + '）')
  const written = after.find((r) => r.content === ADMITTED_TEXT)
  assert.ok(written, '新增行的内容必须逐字等于过门的那条产出')
  assert.ok(String(written.id).startsWith('dist_'), '蒸馏写回的行必须带 dist_ 前缀（与 Write Gate 的 mem_ 分属两条生产者）；实测 ' + String(written.id))
  assert.equal(p.vetoedBy[0], null, '放行 ⇒ vetoedBy[0] 必须是 null（不是省略）；实测 ' + JSON.stringify(p.vetoedBy))
  console.log('[桩计数证据] hit 腿：LLM 桩被调用 ' + String(llm.calls) + ' 次 ⇒ llmCalls=' + String(p.llmCalls) + '，落库 ' + String(p.inserted) + ' 条')
})

// ══ ⑤ 未到点：不发起，但**照写行**（不静默）═══════════════════════════════════
test('⑤ 未到空闲阈值 ⇒ 不发起且零桩调用，但**照写 skipped 行**（带 idleMs 与原因）', async () => {
  ran += 1
  resetPrefilterSpy()
  const llm = makeLlm('throw')
  const { ctx, store } = await boot({ llm })
  const sched = ctx.get('mana-scheduler')

  startClock()
  await turnBoundary(ctx, 's-early', 1)
  userInput(ctx, 's-early', HIT_INPUT)
  await settle(250)
  resetPrefilterSpy()
  advance(10 * 60 * 1000 - 1) // 阈值**下界外侧**
  await turnBoundary(ctx, 's-early', 2)

  const rows = chainRows(store, 'distillation')
  const last = rows[rows.length - 1].parsed
  assert.equal(last.phase, 'skipped', '未到点 ⇒ 本回合不得发起；实测 phase=' + String(last.phase))
  assert.equal(last.status, 'not-idle', '状态必须是 not-idle（它**不是** prefiltered-out）；实测 ' + String(last.status))
  assert.equal(last.idleMs, 10 * 60 * 1000 - 1, '空闲读数必须**原样**回显；实测 ' + String(last.idleMs))
  assert.equal(last.thresholdMs, 10 * 60 * 1000, '阈值必须回显（判据要能复算"为什么没到点"）')
  assert.ok(typeof last.reason === 'string' && last.reason.length > 0, 'skipped 必须带非空 reason（静默返回 = 失败不可观测）')
  assert.equal(sched.driverReadings().distillationDispatched, 0, '未到点 ⇒ 发起次数必须仍是 0；实测 ' + String(sched.driverReadings().distillationDispatched))
  assert.equal(prefilterSpyCalls(), 0, '未到点 ⇒ **连预筛都不该跑**（不给 LLM 预筛前的任何工作）；实测 ' + String(prefilterSpyCalls()))
  assert.equal(llm.calls, 0, '未到点 ⇒ LLM 桩零调用；实测 ' + String(llm.calls))
})

// ══ ⑥ 旋钮有牙：distillationEnabled=false ⇒ 零桩调用 + 显式 skipped ══════════
test('⑥ 装配层旋钮有牙 + 边界显式：distillationEnabled=false ⇒ 零桩调用；且该参数不经生产装配', async () => {
  ran += 1
  resetPrefilterSpy()
  const llm = makeLlm('throw')
  const chains = await import(new URL('packages/scheduler/lib/chains.js', REPO).href)
  const { ctx, store } = await boot({ llm })

  /**
   * ⚠ 为什么这里**经 `createChainDriver` 直接装配**（而不是改 scheduler 的 Config）：
   *   四个蒸馏参数是**装配层**参数，生产装配（`scheduler/src/index.ts`）**不转发**它们
   *   —— 那条边界是接线写面决定的（本卡写面只含 chains.ts），**不是疏漏**。若在生产配置里
   *   传它们，会被静默忽略（下面最后一段就是钉这条事实的牙，防"以为能调"）。
   */
  const driver = chains.createChainDriver({
    ctx,
    core: ctx.get('mana-core'),
    config: {
      driverEnabled: true,
      learningBufferMax: 256,
      retrievalTopK: 10,
      maxChainItems: 200,
      generationEnabled: true,
      generationMaterialMaxChars: 4000,
      distillationEnabled: false, // ← 被检的旋钮
    },
    goals: ctx.get('mana-scheduler').goals,
    takeRuns: () => [],
    runCalls: () => 0,
  })

  startClock()
  await driver.onTurnBoundary({ agent: fakeAgent('s-off'), turn: 1 })
  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-off'), message: userMessage(HIT_INPUT) })
  await settle(250)
  advance(99 * 60 * 1000) // 远超阈值
  await driver.onTurnBoundary({ agent: fakeAgent('s-off'), turn: 2 })
  await settle(250)

  const rows = chainRows(store, 'distillation')
  assert.equal(rows.filter((r) => r.parsed.phase === 'settled').length, 0, '开关关着 ⇒ **不得**有 settled 行')
  const skipped = rows.filter((r) => r.parsed.phase === 'skipped')
  assert.ok(skipped.length >= 2, '每回合仍必须照写 skipped 行（实测 ' + String(skipped.length) + ' 行）')
  const last = skipped[skipped.length - 1].parsed
  assert.equal(last.status, 'disabled', '状态须显式是 disabled（不得与 not-idle 同形）；实测 ' + String(last.status))
  assert.ok(String(last.reason).includes('distillationEnabled'), 'reason 必须点名是**开关**造成的；实测 ' + String(last.reason))
  assert.equal(prefilterSpyCalls(), 0, '开关关着 ⇒ 预筛桩零调用；实测 ' + String(prefilterSpyCalls()))
  assert.equal(llm.calls, 0, '开关关着 ⇒ LLM 桩零调用；实测 ' + String(llm.calls))
  assert.equal(driver.readings().distillationSettled, 0, '开关关着 ⇒ 收敛计数必须为 0')
  // ── 对照腿：同一装配下把开关打开 ⇒ 同一输入**必须**发起（证明上面的 0 归因到开关，而不是"装配坏了"）──
  const driverOn = chains.createChainDriver({
    ctx,
    core: ctx.get('mana-core'),
    config: {
      driverEnabled: true, learningBufferMax: 256, retrievalTopK: 10, maxChainItems: 200,
      generationEnabled: true, generationMaterialMaxChars: 4000,
      distillationEnabled: true,
    },
    goals: ctx.get('mana-scheduler').goals,
    takeRuns: () => [],
    runCalls: () => 0,
  })
  // ⚠ 新 driver 的活动表是**空的** ⇒ 先经过一个回合边界建立打点（第一次必然 untracked，
  //   那是它自己的诚实读数），再推进时钟才会到点。
  await driverOn.onTurnBoundary({ agent: fakeAgent('s-off'), turn: 3 })
  await settle(200)
  advance(99 * 60 * 1000)
  await driverOn.onTurnBoundary({ agent: fakeAgent('s-off'), turn: 4 })
  await settle(300)
  const settledOn = chainRows(store, 'distillation').filter((r) => r.parsed.phase === 'settled')
  assert.equal(settledOn.length, 1, '对照腿：开关打开后同一输入必须发起并收敛（实得 ' + String(settledOn.length) + ' 行）')
  assert.ok(prefilterSpyCalls() > 0, '对照腿：预筛桩必须被真调到（实测 ' + String(prefilterSpyCalls()) + ' 次）')

  // ── 边界显式（不是静默陷阱）：生产装配**不转发**这四个参数 ⇒ 在 profile 配置里传它们不生效 ──
  const prodDriver = chains.resolveDistillConfig({ distillationEnabled: false })
  assert.equal(prodDriver.distillationEnabled, false, '解析器必须认传入的覆盖值（它是旋钮的入口）')
  assert.equal(
    chains.resolveDistillConfig({}).distillationEnabled,
    chains.DISTILL_DEFAULTS.distillationEnabled,
    '不传 ⇒ 取 DISTILL_DEFAULTS（生产生效值）；这条同时钉住"缺省只有一个出处"',
  )
  const idx = await import(new URL('packages/scheduler/lib/index.js', REPO).href)
  assert.ok(idx.Config, 'scheduler 仍导出 Config（生产装配面）')
})

// ══ ⑦ 预筛自身抛错：**不吞**，落 chain/error 行（故障可观测）══════════════════
test('⑦ 预筛实现抛错 ⇒ 落 chain/error 行且计数可查（不得被读成"未命中"）', async () => {
  ran += 1
  resetPrefilterSpy(true) // 桩**按设计抛错**
  const llm = makeLlm('throw')
  const { ctx, store } = await boot({ llm })
  const sched = ctx.get('mana-scheduler')

  startClock()
  await turnBoundary(ctx, 's-boom', 1)
  userInput(ctx, 's-boom', HIT_INPUT)
  await settle(250)
  advance(11 * 60 * 1000)
  await turnBoundary(ctx, 's-boom', 2)

  const errs = errorRows(store).filter((r) => r.session_id === 's-boom')
  assert.ok(errs.length >= 1, '预筛抛错必须落一行 chain/error（吞掉就成 unhandledRejection 或"看起来没命中"）')
  const e = errs[errs.length - 1].parsed
  assert.equal(e.chain, 'distillation', '错误行必须点名是哪条链；实测 ' + String(e.chain))
  assert.ok(String(e.message).includes('预筛桩按设计抛错'), '错误行必须带**真因**；实测 ' + String(e.message))
  const settled = chainRows(store, 'distillation').filter((r) => r.parsed.phase === 'settled')
  assert.equal(settled.length, 0, '抛错的那次**不得**留下 settled 行（否则"失败"与"跑完"同形）')
  const r = sched.driverReadings()
  assert.equal(r.distillationErrors, 1, '错误计数必须记 1；实测 ' + String(r.distillationErrors))
  assert.equal(r.errors, 0, 'errors 是**别的链**的计数器，不得把蒸馏的错算进去（两者分列）')
  assert.equal(llm.calls, 0, '抛错发生在预筛 ⇒ LLM 桩仍零调用；实测 ' + String(llm.calls))
})

// ══ ⑧ 反证（R 形态）：卸载调度器 ⇒ 同一触发零新行（带前置控制）═══════════════
test('⑧ 反证：卸载 scheduler ⇒ 同一触发零新 distillation 行，且 consolidation 服务仍在', async () => {
  ran += 1
  resetPrefilterSpy()
  const llm = makeLlm('throw')
  const { ctx, store, schedFiber } = await boot({ llm })

  startClock()
  await turnBoundary(ctx, 's-un', 1)
  userInput(ctx, 's-un', MISS_INPUT)
  await settle(250)
  advance(11 * 60 * 1000)
  // ── 正向前置控制：装着时必须**真写行** —— 否则下面的"卸载后零新行"平凡通过（G11）──
  await turnBoundary(ctx, 's-un', 2)
  const before = chainRows(store, 'distillation').length
  assert.ok(before >= 2, '前置控制失败：装着时必须真写 distillation 行（实得 ' + String(before) + '）—— 否则本反证平凡通过')

  await schedFiber.dispose()
  await settle(200)
  advance(11 * 60 * 1000)
  ctx.emit('agent/inbox/inserted', { agent: fakeAgent('s-un'), message: userMessage(MISS_INPUT + ' again') })
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent('s-un'), turn: 3 })
  await settle(300)
  assert.equal(chainRows(store, 'distillation').length, before, '卸载后同一触发不得再产生新行')

  // ── 前置控制：链服务**仍在**（证明"没新行"归因到驱动者，而不是"链没了"）──
  assert.ok(ctx.get('mana-consolidation'), '卸载驱动者后 mana-consolidation 仍须可读（对照腿）')
  assert.equal(typeof ctx.get('mana-consolidation').distillProduce, 'function', '对照腿：生产入口仍在（探针仍在售）')
  assert.equal(ctx.get('mana-scheduler'), undefined, '驱动者自身必须真的卸载干净')
})

// ══ ⑨ 用例计数自检 ═══════════════════════════════════════════════════════════
test('⑨ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1/pass 1 的假绿）', () => {
  ran += 1
  assert.equal(
    ran,
    EXPECTED_CASES,
    '本文件声明 ' + String(EXPECTED_CASES) + ' 条，实跑 ' + String(ran) + ' 条 —— 数量不符说明有用例被删或被跳过',
  )
})
