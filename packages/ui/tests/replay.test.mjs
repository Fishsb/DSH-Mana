/**
 * `dsh-mana-ui` **B6.2 判据**：认知轨迹回放（A5-3）+ 与状态回放的**分流** + R5 反证 + A5-2/4/5 复核。
 *
 * 判据原文（`docs/mana-rollout-plan.md:629`）：
 *   **A5-3**：取一段已知 `mana_trace` 片段回放，比对回放产出的状态序列与原始序列
 *           ⇒ 状态序列**逐项相等**；且回放**不得写回** `memory_items`（**只读回放**）。
 *
 * ⚠ **语义冲突（本文件存在的理由）**：判据说「回放不得写回」，而 `册:176`（G10）说
 *   「方案 §12.3 的**插件重启后从 `mana_trace` 回放**会**复活旧状态**」。同一句「回放」，
 *   **语义相反**：
 *     · **审计回放**（本包实现）：读 trace ⇒ 产出状态序列，**只读、可复现**；
 *     · **状态回放**（G10，本包**不实现**）：把 trace 里的状态**写回**记忆库 ⇒ 复活旧状态。
 *   本文件把两者的**差别做成断言**（命名、端点、`data-mode`、写目标清单四处分流），
 *   而不是在注释里含糊过去。
 *
 * ⚠ 库一律是**临时库**（本仓硬纪律）：**绝不**指向 `$DSH_HOME/memory/mana.db`。
 *   数据由**真装配链**产生（core → perception → attention，走真 Loader 按包名解析），
 *   不是测试自己 INSERT 的夹具行 —— 夹具绿 ≠ 真数据绿。
 *
 * 运行：`node --test "tests/*.test.mjs"`（glob 形式；**禁**目录形式，见 A0-7）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 宿主 checkout（与 `ui.test.mjs` / `assembly.test.mjs` 同一路径口径）。 */
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BASE_URL = pathToFileURL(REPO).href + '/'
const PKG = new URL('../', import.meta.url)

// 契约真源：五类标签不在本文件手写第三套（本仓踩过「判据验的是另外三个东西」）。
const { MANA_STAGES } = await import(new URL('../../core/src/domain.ts', import.meta.url).href)
// 被测实现取 **src** 直读（产物陈旧时不该让判据测到旧码）。
const replayMod = await import(new URL('src/replay.ts', PKG).href)
const panelMod = await import(new URL('src/panel.ts', PKG).href)

const cleanups = []
function tempStore(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(dir)
  return { dir, path: join(dir, 'mana.db') }
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/** 造一个能读到 `mana_trace` / `memory_items` 的**独立只读**连接（不复用插件句柄）。 */
function openReadOnly(storePath) {
  return new DatabaseSync(storePath, { readOnly: true })
}

/** `memory_items` 的**库镜像**：逐行全文 + 行数摘要（只读回放的独立证据）。 */
function mirror(storePath) {
  const db = openReadOnly(storePath)
  const rows = db.prepare('SELECT * FROM memory_items ORDER BY id').all()
  const traceCount = db.prepare('SELECT count(*) c FROM mana_trace').get().c
  const renderCount = db.prepare("SELECT count(*) c FROM mana_trace WHERE event_type = 'ui/render'").get().c
  db.close()
  // ⚠ 对**行内容**取哈希（不是只看行数）：`UPDATE` 改一行不改行数，只数行会漏掉写回。
  const blob = JSON.stringify(rows)
  return {
    rows: rows.length,
    hash: createHash('sha256').update(blob).digest('hex'),
    traceCount,
    renderCount,
  }
}

/**
 * **真装配链**产生 trace 数据（core / perception / attention，真 Loader 按包名解析）。
 *
 * ⚠ 顺序敏感：core 最先（其余 inject `mana-core`）。`decision`/`injection` 两类只产生于
 *   `agent/pre-step` ⇒ 走宿主的真 waterfall 通道补一次（口径与
 *   `packages/core/tests/chain-e2e.test.mjs:93` 的 `firePreStep` 逐条一致）。
 */
async function bootChain(storePath) {
  const { Context } = await import(`${DSH}/cordis/lib/index.js`)
  const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default
  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)
  const CHAIN = ['dsh-mana-core', 'dsh-mana-perception', 'dsh-mana-attention']
  for (const pkg of CHAIN) {
    await ctx.loader.create({ name: pkg, config: pkg === 'dsh-mana-core' ? { storePath } : {} })
    await settle(150)
  }
  const missing = CHAIN.filter((p) => !ctx.get(p.replace('dsh-mana-', 'mana-')))
  assert.deepEqual(missing, [], `未装配的包：${missing.join(', ')}`)
  return ctx
}

async function firePreStep(ctx, { turn = 1, messages = [] } = {}) {
  const payload = { agent: { session: { id: 'sess-replay' } }, messages, turn, step: 1 }
  return ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages }))
}

/** 生产路径造数据：一次观察 → 一次 pre-step ⇒ trace 上出现五类中的若干类。 */
async function produceTrace(storePath) {
  const ctx = await bootChain(storePath)
  ctx.get('mana-perception').perceive({
    content: '用户问：末那识的记忆如何注入上下文？',
    sessionId: 'sess-replay',
    turnId: 1,
    requestId: 'req-replay-1',
    source: 'user-message',
  })
  await settle()
  await firePreStep(ctx, { turn: 1 })
  await settle()
  return ctx
}

/** 读回放的原料（**独立只读连接**，不复用插件句柄；带 payload）。 */
function readRows(storePath) {
  const db = openReadOnly(storePath)
  const rows = db
    .prepare('SELECT seq, event_type, payload, session_id, turn_id, timestamp FROM mana_trace ORDER BY seq ASC')
    .all()
  db.close()
  return rows.map((r) => ({
    seq: r.seq,
    eventType: r.event_type,
    payload: r.payload,
    sessionId: r.session_id ?? '',
    turnId: r.turn_id ?? 0,
    at: r.timestamp,
  }))
}

// ══ A5-3：可复现（状态序列逐项相等）══════════════════════════════════════════
test('A5-3① 回放产出的状态序列与原始序列**逐项相等**（数据来自真装配链，非夹具）', async () => {
  const store = tempStore('mana-ui-rp-')
  const ctx = await produceTrace(store.path)
  const rows = readRows(store.path)

  // 前置：生产路径**真的**产出了 trace（否则下面的相等是 0 == 0 的平凡绿）
  assert.ok(rows.length >= 4, `真链应产出 ≥4 行 trace，实测 ${rows.length}（前置不足 ⇒ 判据平凡通过）`)
  const kinds = [...new Set(rows.map((r) => r.eventType))]
  assert.deepEqual(
    kinds.filter((k) => !MANA_STAGES.includes(k)),
    [],
    `trace 上出现了契约五类之外的标签（归并不完整）：${JSON.stringify(kinds)}`,
  )

  const frame = replayMod.replayWindow(rows, { limit: 256 })

  // ★ 判定动作：逐项相等 —— 与**原始序列**（同一次读库的原始行）比，不比中间产物。
  assert.deepEqual(
    frame.steps.map((s) => s.seq),
    rows.map((r) => r.seq),
    '回放状态序列的 seq 必须与原序列逐项相等（丢一项/多一项都在这里红）',
  )
  assert.equal(frame.from, rows[0].seq)
  assert.equal(frame.to, rows[rows.length - 1].seq)
  assert.deepEqual(frame.gaps, [], '连续编号下窗口内不得有缺口')
  assert.equal(frame.unknownPayloads, 0, '生产路径写出的 payload 必须都是可解析 JSON')

  // 逐步：状态必须由**该行原始 payload** 推出（独立读原始字节，不对着实现抄）
  for (let i = 0; i < rows.length; i += 1) {
    const step = frame.steps[i]
    const raw = JSON.parse(rows[i].payload)
    assert.equal(step.seq, rows[i].seq)
    assert.equal(step.eventType, rows[i].eventType)
    assert.equal(step.kind, rows[i].eventType, '类别必须落在契约五类内')
    if (typeof raw.requestId === 'string') assert.equal(step.state.requestId, raw.requestId)
    if (typeof raw.gate === 'string') assert.equal(step.state.gate, raw.gate)
    if (typeof raw.degraded === 'boolean') assert.equal(step.state.degraded, raw.degraded)
    if (raw.gate === undefined) assert.equal(step.state.gate, null, '非 injection 段的 gate 必须是 null（不是空串）')
  }

  // 降级链路的可观测性：decision/injection 两段本轮走的是缺省 next（unknown / 降级），
  //   它们**必须**在回放面上如实可见，而不是被抹平成 0/false。
  const decision = frame.steps.find((s) => s.kind === 'decision')
  assert.ok(decision, '真链应产出 decision 段（经 pre-step 分发）')
  assert.equal(decision.state.degraded, true, '缺省判定链是降级态 ⇒ 回放面必须如实显示 degraded=true')
  const injection = frame.steps.find((s) => s.kind === 'injection')
  assert.ok(injection, '真链应产出 injection 段')
  assert.deepEqual(
    ['injected', 'skip_no_candidate', 'skip_below_threshold', 'degraded_unavailable', 'reset'].includes(
      String(injection.state.gate),
    ),
    true,
    `injection 段的 gate 必须落在契约五类枚举内，实测 ${String(injection.state.gate)}`,
  )

  await ctx.loader.remove([...ctx.loader.entries()][0]?.id ?? '')
  void ctx
})

test('A5-3② 可复现：同一片段回放两次，结果**逐字节相同**（回放是顺序器具，不是随机取样）', async () => {
  const store = tempStore('mana-ui-rp2-')
  const ctx = await produceTrace(store.path)
  const rows = readRows(store.path)

  const a = replayMod.replayWindow(rows, { limit: 256 })
  const b = replayMod.replayWindow(rows, { limit: 256 })
  assert.equal(JSON.stringify(a), JSON.stringify(b), '两次回放必须完全一致（含字段顺序）')

  // 窗口过滤也必须确定：会话过滤不丢行、不串行
  const filtered = replayMod.replayWindow(rows, { limit: 256, sessionId: 'sess-replay' })
  assert.deepEqual(filtered.steps.map((s) => s.seq), a.steps.map((s) => s.seq))
  const other = replayMod.replayWindow(rows, { limit: 256, sessionId: 'sess-不存在' })
  assert.deepEqual(other.steps, [], '不存在的会话必须回放出**空窗口**（而不是全部行）')
  assert.equal(other.from, null)

  // 左闭下界：从第 2 行的 seq 起 ⇒ 首项必须正是它（不许偏移一格）
  const from2 = replayMod.replayWindow(rows, { limit: 256, fromSeq: rows[1].seq })
  assert.equal(from2.steps[0].seq, rows[1].seq, 'fromSeq 是左闭下界')

  void ctx
})

// ══ A5-3：只读回放（不写回）══════════════════════════════════════════════════
test('A5-3③ **审计回放不写库**：memory_items 库镜像逐字节不变（含行内容哈希）', async () => {
  const store = tempStore('mana-ui-ro-')
  const ctx = await produceTrace(store.path)

  // 先落一条记忆项 ⇒ 镜像非空，「没写」才有意义（对空表断言相等是平凡绿）
  const core = ctx.get('mana-core')
  core.writeMemoryItem({ id: 'm-1', type: 'episodic', content: '末那识的注入是门控的' })
  core.writeMemoryItem({ id: 'm-2', type: 'semantic', content: '回放是只读的' })
  await settle(120)

  const before = mirror(store.path)
  assert.equal(before.rows, 2, '前置：镜像里必须有 2 行（否则相等断言平凡成立）')

  const frame = replayMod.replayWindow(readRows(store.path), { limit: 256 })
  assert.ok(frame.steps.length > 0)

  // 再走**协议端点**回放一次（不只调纯函数）：端点是生产接线，纯函数只是它的内核。
  const handlers = new Map()
  panelMod.registerPanels({ handle: (m, h) => handlers.set(m, h) }, await makeStore(core))
  const viaEndpoint = await handlers.get(panelMod.METHODS.replay)({ limit: 256 })
  assert.equal(viaEndpoint.steps.length, frame.steps.length, '端点回放与纯函数回放必须同结果')
  await settle(120)

  const after = mirror(store.path)
  assert.equal(after.rows, before.rows, `审计回放不得增删 memory_items 行：${before.rows} → ${after.rows}`)
  assert.equal(after.hash, before.hash, 'memory_items **行内容**必须逐字节不变（UPDATE 改一行不改行数，故必须比哈希）')
  assert.equal(after.traceCount, before.traceCount, '回放连 mana_trace 也不得追加行（它只读，落点是另一条路径）')

  void ctx
})

// ══ 分流：审计回放 vs 状态回放 ══════════════════════════════════════════════
test('A5-3④ 分流可判定：审计回放自报写目标恒空，且与「状态回放会写的表」交集为空', () => {
  const frame = replayMod.replayWindow([
    { seq: 1, eventType: 'injection', payload: '{"gate":"injected"}', sessionId: 's', turnId: 1, at: 't' },
  ])
  assert.deepEqual(frame.scanTargets, [], '审计回放的写目标清单必须恒为空数组（A5-3「只读回放」的机检落点）')
  assert.deepEqual(replayMod.AUDIT_REPLAY_WRITE_TARGETS, [])
  assert.deepEqual(replayMod.STATE_REPLAY_WRITE_TARGETS, ['memory_items'], '状态回放写的表必须被点名（用来做交集断言）')
  const inter = frame.scanTargets.filter((t) => replayMod.STATE_REPLAY_WRITE_TARGETS.includes(t))
  assert.deepEqual(inter, [], '审计回放的写目标与状态回放的写目标**交集必须为空**')
  assert.notEqual(replayMod.REPLAY_MODES.audit, replayMod.REPLAY_MODES.state, '两种回放必须能被命名区分')
})

test('A5-3⑤ 守卫有牙：回放面自报写目标时 assertAuditReplayReadOnly **必须抛**', () => {
  const clean = replayMod.replayWindow([])
  assert.deepEqual(replayMod.assertAuditReplayReadOnly(clean), [])
  // 负向：把写目标塞进去（= 状态回放形态）⇒ 必须抛，且报错文本要**指名**那是状态回放
  const dirty = { ...clean, scanTargets: ['memory_items'] }
  assert.throws(
    () => replayMod.assertAuditReplayReadOnly(dirty),
    /状态回放|只读/,
    '自报写目标却静默通过 = 守卫没牙（判据恒绿）',
  )
})

/**
 * ★ **负扫探针**：对面板实现的源码做写口扫描，查它是否具备「写 memory_items」的能力。
 *
 * ⚠ 为什么不能只断言 `scanTargets`：那是**回放面自报**的字段（自我声明）。
 *   本探针问的是**更硬的问题**：这段实现里**有没有一条能把 memory_items 写掉的 SQL**。
 *   · INSERT / UPDATE / DELETE / REPLACE / DROP 目标表含 `memory_items` ⇒ 命中即红；
 *   · 写口白名单 `PanelStore.writeRender`（它写的是 `mana_trace` 的落点行，见 R5）。
 */
test('A5-3⑥ ★负扫探针：面板实现内不存在任何写 memory_items 的 SQL 语句', () => {
  const files = ['src/panel.ts', 'src/store.ts', 'src/replay.ts']
  const WRITE = /\b(INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO|DROP\s+TABLE)\s+(?:IF\s+EXISTS\s+)?([\w"\`[\]]+)/gi
  const hits = []
  const sqlSeen = []
  for (const rel of files) {
    const text = readFileSync(new URL(rel, PKG), 'utf8')
    for (const m of text.matchAll(WRITE)) {
      const table = String(m[2]).replace(/["\`[\]]/g, '')
      sqlSeen.push(`${rel}:${m[1].split(/\s+/)[0]}→${table}`)
      if (table === 'memory_items') hits.push(`${rel} → ${m[0].trim()}`)
    }
  }
  // 探针自检：它必须**真的能看见**语句（若一条都没扫到，说明正则没对上 → 不许当绿）
  assert.ok(sqlSeen.length >= 1, `负扫探针未扫到任何写语句（探针失效，不许当绿）；扫描范围=${files.join(', ')}`)
  assert.deepEqual(hits, [], `面板实现内不得存在写 memory_items 的语句：${hits.join(' | ')}`)
  // 且那条唯一写口写的是落点表，不是记忆表
  assert.deepEqual(sqlSeen, ['src/store.ts:INSERT→mana_trace'], `写口清单变了，须显式复核：${JSON.stringify(sqlSeen)}`)
})

// ══ R5：产物侧落点（卸载后不再产生新行）═════════════════════════════════════
/** 载入 client 产物（走真工厂壳），返回 exports。 */
function loadArtifact() {
  const code = readFileSync(new URL('lib/client.js', PKG), 'utf8')
  let registered
  const sandbox = { __ModuleLoader__: { load: (entry) => (registered = entry) } }
  new Function('window', 'globalThis', code)(sandbox, sandbox)
  return registered.factory(() => {
    throw new Error('本产物不得在求值期 require')
  })
}

/** 由协议表造一个 host 面（= 插件装载时才存在的那条通道；空表 = 路由不可达）。 */
function hostFaceOf(handlers) {
  return {
    call: async (method) => {
      const h = handlers.get(method)
      if (h === undefined) throw new Error(`路由不可达（method=${method}）`)
      return h({ limit: 32, panel: 'mana-ui', rendered: 0 })
    },
  }
}

test('R5① 装载态：client 产物真跑一次渲染 ⇒ 落点新增一行 ui/render（正向前置）', async () => {
  const store = tempStore('mana-ui-r5a-')
  const ctx = await produceTrace(store.path)
  const core = ctx.get('mana-core')
  const handlers = new Map()
  const panelStore = await makeStore(core)
  panelMod.registerPanels({ handle: (m, h) => handlers.set(m, h) }, panelStore)

  const before = mirror(store.path).renderCount
  const exports = loadArtifact()
  const report = await exports.render({ ctx: { host: hostFaceOf(handlers) }, limit: 32 })
  await settle(120)
  const after = mirror(store.path).renderCount
  assert.equal(report.traceSeq > 0, true, `落点必须成功：${JSON.stringify(report)}`)
  assert.equal(after, before + 1, `装载态渲染一次必须恰好新增一行：${before} → ${after}`)
  assert.ok(report.replaySteps > 0, '渲染回执必须带审计回放的步数（回放面进了渲染面）')

  void ctx
})

test('R5② **反证**：卸载 mana-ui 后，同一触发不再产生新行（临时库，不碰 $DSH_HOME）', async () => {
  const store = tempStore('mana-ui-r5b-')
  const { Context } = await import(`${DSH}/cordis/lib/index.js`)
  const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default
  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: store.path } })
  await settle(200)
  await ctx.loader.create({ name: 'dsh-mana-ui', config: {} })
  await settle(300)

  // 卸载判据 = 服务不可读（**不是**「调用没抛错」）
  assert.ok(ctx.get('mana-ui'), '装载态：mana-ui 必须可读（否则本反证测的不是它）')
  const entries = [...ctx.loader.entries()].filter((e) => e.options?.name === 'dsh-mana-ui')
  assert.equal(entries.length, 1, `loader 台账里应有 1 个 ui entry，实测 ${entries.length}`)

  const core = ctx.get('mana-core')
  const handlers = new Map()
  panelMod.registerPanels({ handle: (m, h) => handlers.set(m, h) }, await makeStore(core))
  const exports = loadArtifact()
  const trigger = () => exports.render({ ctx: { host: hostFaceOf(handlers) }, limit: 32 })

  await trigger()
  await settle(120)
  const loaded = mirror(store.path).renderCount
  assert.ok(loaded > 0, '装载态必须先产生新行，否则反证判据平凡通过（G11）')

  // 卸载：撤 loader entry（真装配面）+ 撤协议路由（插件带走的那条通道）
  ctx.loader.remove(entries[0].id)
  handlers.clear()
  await settle(300)
  assert.equal(ctx.get('mana-ui'), undefined, '卸载后 mana-ui 必须不可读（残留 = 卸载没真做）')

  const beforeUnload = mirror(store.path).renderCount
  const report = await trigger()
  await settle(150)
  const afterUnload = mirror(store.path).renderCount
  assert.equal(
    afterUnload,
    beforeUnload,
    `卸载后同一触发不得再产生新行：${beforeUnload} → ${afterUnload}`,
  )
  assert.equal(report.degraded, true, '卸载后渲染必须显式降级（不许静默当成成功）')
  assert.match(report.reason, /路由不可达/, '降级原因必须携带原始成因（路由没了），不许泛化')
})

/** 造面板存储适配器（走 `store.ts` 真实现）。 */
async function makeStore(core) {
  const storeMod = await import(new URL('src/store.ts', PKG).href)
  return storeMod.createPanelStore(core.db)
}

// ══ A5-4 / A5-5 / A5-2 复核（数字与理由一起给）═══════════════════════════════
const SAMPLE_BYTES = 5002 // 样板 dsh-frozen-injection/src/index.ts（A5-4 判据原文点名）

test('A5-4 复核：入口体积同量级（给数字，不给「差不多」）', () => {
  const entry = statSync(new URL('src/index.ts', PKG)).size
  const built = statSync(new URL('lib/index.js', PKG)).size
  const logic = statSync(new URL('src/panel.ts', PKG)).size + statSync(new URL('src/store.ts', PKG)).size
  const replay = statSync(new URL('src/replay.ts', PKG)).size
  assert.ok(entry < 50_000, `入口 ≥50KB 须写明理由，实测 ${entry} B`)
  assert.ok(entry < logic + replay, `入口(${entry}) 必须小于逻辑模块之和(${logic + replay}) —— 否则逻辑被塞进入口`)
  // 与样板同量级：个位数 KB（样板 5002 B）
  assert.ok(entry < 10_000, `入口应落在个位数 KB（样板 ${SAMPLE_BYTES} B），实测 ${entry} B`)
  assert.ok(built < 50_000, `构建产物 ${built} B 超一个数量级`)
  console.log(
    `[A5-4] src/index.ts=${entry} B（样板 ${SAMPLE_BYTES} B，比值 ${(entry / SAMPLE_BYTES).toFixed(2)}×）· lib/index.js=${built} B · panel+store=${logic} B · replay=${replay} B`,
  )
})

test('A5-5 复核：client 产物唯一，且清单可枚举（多产物须写明理由）', () => {
  const lib = new URL('lib/', PKG)
  const files = readdirSync(lib)
  const clients = files.filter((f) => /^client.*\.js$/.test(f))
  assert.deepEqual(clients, ['client.js'], `client 产物必须唯一：${files.join(', ')}`)
  const size = statSync(new URL('client.js', lib)).size
  assert.ok(size > 0)
  console.log(`[A5-5] lib/ 根下 client 产物 = ${clients.join(', ')}（${size} B）；目录内其它条目：${files.filter((f) => !/^client/.test(f)).join(', ')}`)
})

test('A5-2 复核：client 产物对三个模式命中 0（AST 真调用 + 令牌字面量两层）', async () => {
  const { checkArtifact, discoverArtifacts } = await import('../scripts/check-client-api.mjs')
  const files = discoverArtifacts()
  assert.equal(files.length, 1, `产物必须恰好 1 件，实测 ${files.join(', ')}`)
  const code = readFileSync(files[0], 'utf8')
  const r = checkArtifact(code, files[0])
  assert.equal(r.verdict, 'PASS', `A5-2 不通过：${r.cause}`)
  // 三模式**逐个**报数（合并成一句「无命中」看不出是哪种没命中）
  for (const pat of [/node:fs/g, /node:sqlite/g, /process\.env/g]) {
    const n = code.match(pat)?.length ?? 0
    assert.equal(n, 0, `产物字节上 ${pat} 必须 0 命中，实测 ${n}`)
  }
})

// ══ 消费侧分流：Client 半区拿到「写回式」回放面时必须拒绝 ════════════════════
test('A5-3⑦ 消费侧：回放面若自报写目标，Client 半区必须判降级并拒绝使用', async () => {
  const exports = loadArtifact()
  // ① 正常帧 ⇒ 直接用
  const okHost = { call: async () => ({ from: 1, to: 2, sessionId: null, steps: [], gaps: [], unknownPayloads: 0, scanTargets: [] }) }
  const okRep = await exports.replay({ host: okHost }, { limit: 8 })
  assert.equal(okRep.degraded, false)
  assert.deepEqual(okRep.frame.scanTargets, [])

  // ② 写回式帧（状态回放形态）⇒ 拒绝并给可读原因
  const badHost = { call: async () => ({ from: 1, to: 2, sessionId: null, steps: [], gaps: [], unknownPayloads: 0, scanTargets: ['memory_items'] }) }
  const badRep = await exports.replay({ host: badHost }, { limit: 8 })
  assert.equal(badRep.degraded, true, '自报写目标的回放面必须被拒绝（不许静默接受）')
  assert.equal(badRep.frame, null)
  assert.match(badRep.reason, /memory_items/, '拒绝原因必须点名写目标表')

  // ③ 通道不可达 ⇒ 显式降级（不伪装成空回放）
  const none = await exports.replay({}, { limit: 8 })
  assert.equal(none.degraded, true)
  assert.ok(none.reason.length > 0)

  // ④ 渲染侧：缺 replay 键（旧版 Host）必须落「无回放面」而不是抛错白屏
  const React = { createElement: (type, props, ...kids) => ({ type, props, kids }) }
  const tree = exports.renderPanels(React, {
    generatedAt: 't', heatmap: [], goalTree: [], timeline: [], degraded: false, reason: '',
  })
  const walk = (node, pred, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (pred(node)) out.push(node)
    for (const kid of node.kids ?? []) walk(kid, pred, out)
    return out
  }
  const replayPanel = walk(tree, (n) => n.props && n.props['data-panel'] === 'replay')
  assert.equal(replayPanel.length, 1, '缺 replay 键时回放面板仍必须渲染（白屏 = 失败不可观测）')
  assert.equal(replayPanel[0].props['data-mode'], 'audit-replay')
})

// ══ 负向对拍（判据自身可红）═════════════════════════════════════════════════
test('A5-3⑧ 判据自检：造扰动 ⇒ 「逐项相等」与「不写库」两条腿**必须**各自报红', () => {
  const rows = [
    { seq: 1, eventType: 'observation', payload: '{"requestId":"r1"}', sessionId: 's', turnId: 1, at: 't1' },
    { seq: 2, eventType: 'attention', payload: '{"requestId":"r1","size":1}', sessionId: 's', turnId: 1, at: 't2' },
    { seq: 3, eventType: 'injection', payload: '{"gate":"injected","memoryId":"m1"}', sessionId: 's', turnId: 1, at: 't3' },
  ]
  const original = replayMod.replayWindow(rows, { limit: 8 }).steps
  assert.deepEqual(replayMod.diffSequences(original, replayMod.replayWindow(rows, { limit: 8 }).steps), [])

  // 扰动 A：**丢**一条 ⇒ 必须报红，且点名丢了哪一条
  const dropped = [original[0], original[2]]
  const dA = replayMod.diffSequences(original, dropped)
  assert.ok(dA.length > 0, '丢一条必须报红')
  assert.match(dA.join('\n'), /缺 seq=2/, `差异必须点名缺哪一步，实测：${dA.join(' | ')}`)

  // 扰动 B：改一个字段 ⇒ 必须报红，且点名字段与两侧取值
  const mutated = original.map((s, i) => (i === 2 ? { ...s, state: { ...s.state, memoryId: 'WRONG' } } : s))
  const dB = replayMod.diffSequences(original, mutated)
  assert.ok(dB.length > 0, '字段被改必须报红')
  assert.match(dB.join('\n'), /state\.memoryId 不等/, `差异必须点名到字段，实测：${dB.join(' | ')}`)

  // 扰动 C：多一条 ⇒ 也必须报红（多记与漏记是不同的缺陷）
  const extra = [...original, { seq: 4, eventType: 'observation', kind: 'observation', at: 't4', state: original[0].state }]
  assert.ok(replayMod.diffSequences(original, extra).length > 0, '多一条必须报红')

  // 扰动 D：`scanTargets` 被改成非空 ⇒ 守卫必须抛（「不写库」那条腿的牙）
  assert.throws(() => replayMod.assertAuditReplayReadOnly({ ...replayMod.replayWindow(rows), scanTargets: ['memory_items'] }))
})

test('A5-3⑨ 边界如实计数：空窗口 / 不可解析 payload / seq 缺口都落**显式数字**', () => {
  const empty = replayMod.replayWindow([])
  assert.equal(empty.from, null)
  assert.equal(empty.to, null)
  assert.deepEqual(empty.steps, [])
  assert.equal(empty.unknownPayloads, 0, '空窗口的未解析计数是 0（不是 undefined）')

  const mixed = replayMod.replayWindow([
    { seq: 1, eventType: 'observation', payload: '{"requestId":"r"}', sessionId: 's', turnId: 1, at: 't' },
    { seq: 2, eventType: 'attention', payload: '这不是 JSON', sessionId: 's', turnId: 1, at: 't' },
    { seq: 5, eventType: 'injection', payload: '{"gate":"reset"}', sessionId: 's', turnId: 1, at: 't' },
  ])
  assert.equal(mixed.unknownPayloads, 1, '不可解析的 payload 必须被**计数**，不是静默丢弃')
  assert.equal(mixed.steps[1].state.requestId, null, '不可解析时状态字段落 null（不是空串冒充）')
  assert.deepEqual(mixed.gaps, [[3, 5]], 'seq 缺口必须显式列出（左闭右开）')
  assert.equal(mixed.steps[1].kind, 'attention')
})

test('A5-3⑩ 类别真源：未归类标签落 null，不静默归并进五类', () => {
  assert.equal(replayMod.eventKind('injection'), 'injection')
  assert.equal(replayMod.eventKind('mana/plugin/inactive'), null, '契约外的标签必须显式未归类')
  assert.equal(
    replayMod.eventKind('mana/working-memory'),
    null,
    '历史标签（F-01 归并前的旧值）不得被当成五类之一',
  )
  const frame = replayMod.replayWindow([
    { seq: 1, eventType: 'mana/plugin/inactive', payload: '{}', sessionId: 's', turnId: 1, at: 't' },
  ])
  assert.equal(frame.steps[0].kind, null, '未归类必须是 null（判据据此点得出来）')
})