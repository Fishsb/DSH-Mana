/**
 * dsh-mana-ui B6.1 判据测试。
 *
 * 每条断言都对应一条**可复跑的命令面**，不写「应该」类判断：
 *  · **A5-1** client 半区可渲染：产物存在且字节数 > 0，且**真被求值**（工厂壳能跑通）
 *  · **A5-2** client 产物**不得**含宿主专有 API（真调用 AST + 令牌字面量两层，见 `scripts/check-client-api.mjs`），且判据自身有四种变异可红
 *  · **A5-4** Host 入口体积同量级（对标样板 `dsh-frozen-injection` 的 `src/index.ts` = 5002 B）
 *  · **A5-5** client 产物**唯一**（单入口、单文件）
 *  · **R5**  自建产物侧落点：`mana_trace` 的 `ui/render` 行随渲染增长；卸载后**不再产生新行**
 *  · **I-8** 降级必须落显式字段（`degraded === true` 且 `reason` 非空字符串），
 *           不接受「看着像降级了」
 *
 * 运行：`node --test "tests/*.test.mjs"`（glob 形式；**禁**目录形式，见 A0-7）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

const ROOT = new URL('../../', import.meta.url) // packages/
const PKG = new URL('../', import.meta.url) // packages/ui/
const LOAD = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)

const cleanups = []
function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-ui-'))
  cleanups.push(dir)
  return { path: join(dir, 'mana.db'), dir }
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/** 真 cordis Context 装载 core + ui（假 ctx 只能证明"函数在"，证明不了契约通）。 */
async function mountStack() {
  const store = tempStore()
  const ctx = new Context()
  const core = await LOAD('core')
  const ui = await LOAD('ui')
  const coreFiber = ctx.plugin(core, { storePath: store.path })
  await new Promise((r) => setTimeout(r, 150))
  const uiFiber = ctx.plugin(ui, {})
  await new Promise((r) => setTimeout(r, 250))
  return { ctx, store, coreFiber, uiFiber }
}

const countRender = (db) =>
  db.prepare("SELECT count(*) c FROM mana_trace WHERE event_type = 'ui/render'").get().c

// ── A5-1 / A5-5：产物存在、可求值、单件 ──────────────────────────────────────
test('A5-1/A5-5 client 产物存在、字节数 > 0、且是单一产物', async () => {
  const libDir = new URL('lib/', PKG)
  assert.ok(existsSync(libDir), 'lib/ 不存在 ⇒ 未跑 bundle:client')
  const files = readdirSync(libDir)
  // ⚠ 谓词必须是「前缀族」，不能是 `f === 'client.js'`：后者对每个目录项恒真或恒假，
  //   变成**恒绿断言**（本仓实测：目录里再放一个含 `node:fs` 的 `client-2.js`，判定一分不变）。
  const clients = files.filter((f) => /^client.*\.js$/.test(f))
  assert.deepEqual(clients, ['client.js'], `client 产物必须唯一且名为 client.js，实测：${files.join(', ')}`)
  const size = statSync(new URL('client.js', libDir)).size
  assert.ok(size > 0, `A5-1 产物字节数必须 > 0，实测 ${size}`)
  // 工厂壳形态：首行必须是 ModuleLoader.load（DSH 客户端模块表契约）
  const head = readFileSync(new URL('client.js', libDir), 'utf8').split('\n')[0]
  assert.match(head, /window\.__ModuleLoader__\.load\(\{\s*id:/, `产物首行须是工厂壳，实测：${head}`)
  assert.match(head, /"dsh-mana-ui"/, '工厂 id 必须是包名')
})

test('A5-1 产物可真求值（在假浏览器壳里工厂能执行完并导出 apply）', async () => {
  const code = readFileSync(new URL('lib/client.js', PKG), 'utf8')
  let registered
  const sandbox = { __ModuleLoader__: { load: (entry) => (registered = entry) } }
  // 产物只依赖 window.__ModuleLoader__；用 Function 造一个最小宿主壳。
  const run = new Function('window', 'globalThis', code)
  run(sandbox, sandbox)
  assert.ok(registered, '工厂必须注册（load 未被调用 = 产物形态错）')
  assert.equal(registered.id, 'dsh-mana-ui')
  const exports = registered.factory((id) => {
    throw new Error(`本产物不得在求值期 require：${id}`)
  })
  assert.equal(typeof exports.apply, 'function', '浏览器半区必须导出 apply')
  assert.equal(typeof exports.render, 'function')
  // 纯函数直测：热力色阶与目标树（不依赖 DOM ⇒ 可确定性断言）
  assert.equal(exports.heatLevel(0.5, 0, 1), 0.5)
  assert.equal(exports.heatLevel(5, 0, 1), 1, '越界必须夹取')
  const tree = exports.buildTree([
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'ghost' },
  ])
  assert.deepEqual(tree.roots, ['a', 'c'], '孤儿必须挂根（不许静默丢节点）')
})

test('A5-2 client 产物不得含宿主专有 API（真调用 AST + 令牌字面量两层）', async () => {
  // ⚠ 本判据已换实现（`scripts/check-client-api.mjs`），原因（本仓实测）：
  //   旧版对**产物字节**直接正则 grep ⇒ 注释里写一次 `node:fs` 就被数成违规
  //   （`lib/panel.js:8` 正是这种自我说明行）；旧规避办法是**改注释措辞**——
  //   那是改被测对象去迁就判据。新版分两层：AST 真调用（零误报）+ 令牌面字面量（不漏报），
  //   失败消息直接说明红在哪一层。
  const { checkArtifact, discoverArtifacts } = await import('../scripts/check-client-api.mjs')
  const files = discoverArtifacts()
  assert.equal(files.length, 1, `client 产物必须恰好 1 件（枚举 /^client.*\\.js$/），实测：${files.join(', ') || '(空集)'}`)
  const r = checkArtifact(readFileSync(files[0], 'utf8'), files[0])
  assert.equal(r.verdict, 'PASS', `A5-2 不通过：${r.cause}`)
})

test('A5-2 判据自身可红：四种变异逐条变色 + 注释假阳性不得回归（防判据恒绿）', async () => {
  const { checkArtifact } = await import('../scripts/check-client-api.mjs')
  const code = readFileSync(new URL('lib/client.js', PKG), 'utf8')
  const at = code.indexOf('var module = { exports: {} };')
  assert.ok(at > 0, '产物结构变了：找不到工厂体锚点，本判据的变异锚需要更新')
  const inject = (snippet) => code.slice(0, at) + snippet + code.slice(at)
  const cases = [
    ['真调用 require', inject("var fs = require('node:fs');\n")],
    ['真调用动态 import', inject('var l = () => import("node:sqlite");\n')],
    ['真调用 process.env', inject('var h = process.env.HOME;\n')],
    ['仅字面量（非调用面）', inject('const note = "node:fs";\n')],
  ]
  for (const [label, mutant] of cases) {
    assert.equal(checkArtifact(mutant).verdict, 'FAIL', `${label} 必须判红（判据变色能力）`)
  }
  // 反面：注释里写同样的字面量 ⇒ **不得**判红（旧判据的假阳性形态）
  const commented = code.replace(
    'window.__ModuleLoader__.load({',
    '/* 本文件不含 node:fs / process.env */\nwindow.__ModuleLoader__.load({',
  )
  assert.equal(checkArtifact(commented).verdict, 'PASS', '注释里的字面量不得判红（假阳性回归）')
})

test('A5-4 Host 入口体积同量级（样板 src/index.ts = 5002 B）', () => {
  const bytes = statSync(new URL('src/index.ts', PKG)).size
  assert.ok(bytes < 50_000, `A5-4：入口 ≥50KB 须写明理由，实测 ${bytes} B`)
  assert.ok(bytes > 0)
  // 面板逻辑不得塞进入口：入口必须显著小于「逻辑模块之和」，并落在个位数 KB。
  const logic = statSync(new URL('src/panel.ts', PKG)).size + statSync(new URL('src/store.ts', PKG)).size
  assert.ok(bytes < logic, `入口(${bytes}) 必须小于逻辑模块之和(${logic}) —— 否则逻辑被塞进入口`)
  const built = statSync(new URL('lib/index.js', PKG)).size
  assert.ok(built < 50_000, `构建产物 ${built} B 超一个数量级`)
})

// ── 服务装配与形状 ─────────────────────────────────────────────────────────
test('ui 插件在真 Context 中装载并 provide mana-ui（装配判据=服务可读）', async () => {
  const { ctx, coreFiber, uiFiber } = await mountStack()
  const svc = ctx.get('mana-ui')
  assert.ok(svc, 'mana-ui 服务必须可读（未 provide = 插件没真跑起来）')
  const st = svc.status()
  assert.equal(st.plugin, 'mana-ui')
  assert.equal(st.wired, true, 'status().wired 必须为 true')
  assert.equal(st.renderTrace, true)
  assert.equal(typeof st.channel, 'boolean', 'channel 必须是布尔（不可用 undefined 表状态）')
  // ⚠ 本行是**声明式枚举**（不是"看着像就够了"）：新增协议方法必须在这里显式登记，
  //   否则「方法默默加了一个」在判据上不可见。B6.2 新增 `mana-ui/replay`（审计回放，只读）；
  //   本卡新增 `mana-ui/channel`（模型通道读写 —— 用户设置入口）。
  assert.deepEqual(
    [...svc.methods].sort(),
    ['mana-ui/channel', 'mana-ui/meta', 'mana-ui/panels', 'mana-ui/render', 'mana-ui/replay'],
  )
  await uiFiber.dispose()
  await coreFiber.dispose()
  void ctx
})

// ── R5：自建产物侧落点（**不照抄 shoucang 端点**）────────────────────────────
test('R5 落点：渲染一次即在 mana_trace 新增一行 ui/render', async () => {
  const { ctx, coreFiber, uiFiber } = await mountStack()
  const core = ctx.get('mana-core')
  const before = countRender(core.db)

  // 走真正的 Host 半区协议面（不是直接 INSERT）：装配 wire → 调 handler。
  const { registerPanels, METHODS } = await import(new URL('src/panel.ts', PKG).href)
  const { createPanelStore } = await import(new URL('src/store.ts', PKG).href)
  const handlers = new Map()
  registerPanels({ handle: (m, h) => handlers.set(m, h) }, createPanelStore(core.db))

  const ack = await handlers.get(METHODS.render)({ panel: 'mana-ui', rendered: 3, sessionId: 's5', turnId: 1 })
  assert.equal(ack.ok, true, `落点必须成功：${JSON.stringify(ack)}`)
  assert.equal(ack.degraded, false)
  assert.equal(ack.reason, '', '成功时 reason 必须为空串（不许 undefined）')
  assert.ok(typeof ack.traceSeq === 'number' && ack.traceSeq > 0, 'traceSeq 必须是真 rowid')

  const after = countRender(core.db)
  assert.equal(after, before + 1, `渲染一次必须恰好新增一行：before=${before} after=${after}`)

  // 落点内容可对账：event_type = ui/render，payload 是无损 JSON
  const row = core.db.prepare("SELECT payload FROM mana_trace WHERE event_type='ui/render' ORDER BY seq DESC LIMIT 1").get()
  assert.deepEqual(JSON.parse(row.payload), { panel: 'mana-ui', rendered: 3 })

  await uiFiber.dispose()
  await coreFiber.dispose()
  void ctx
})

test('R5 反证判据：卸载 ui 后同一触发不再产生新行', async () => {
  const { ctx, coreFiber, uiFiber } = await mountStack()
  const core = ctx.get('mana-core')
  const { registerPanels, METHODS } = await import(new URL('src/panel.ts', PKG).href)
  const { createPanelStore } = await import(new URL('src/store.ts', PKG).href)
  const handlers = new Map()
  registerPanels({ handle: (m, h) => handlers.set(m, h) }, createPanelStore(core.db))

  const trigger = () => handlers.get(METHODS.render)({ panel: 'mana-ui', rendered: 1, sessionId: 's5', turnId: 2 })

  await trigger()
  const loaded = countRender(core.db)
  assert.ok(loaded > 0, '装载态必须先产生新行，否则反证判据平凡通过（G11）')

  // 「卸载」在测试面 = 撤掉本包的全部协议注册（真装配面即 fiber dispose 带走的注册）。
  handlers.clear()
  await uiFiber.dispose()
  await new Promise((r) => setTimeout(r, 200))

  const beforeUnload = countRender(core.db)
  assert.equal(handlers.get(METHODS.render), undefined, '卸载后协议面必须不可达')
  const afterTrigger = countRender(core.db)
  assert.equal(afterTrigger, beforeUnload, `卸载后同一触发不得再产生新行：${beforeUnload} → ${afterTrigger}`)

  await coreFiber.dispose()
  void ctx
})

// ── 降级：可枚举字段断言（不接受「看着像降级」）──────────────────────────────
test('I-8 降级落显式字段：读路面失败时 degraded===true 且 reason 非空', async () => {
  const { registerPanels, METHODS } = await import(new URL('src/panel.ts', PKG).href)
  const handlers = new Map()
  /** 故意坏的存储端口：读路抛错（模拟库不可达）。 */
  const broken = {
    heatmap() { throw new Error('boom-heatmap') },
    goals() { return [] },
    timeline() { return [] },
    writeRender() { throw new Error('boom-write') },
  }
  registerPanels({ handle: (m, h) => handlers.set(m, h) }, broken)

  const snap = await handlers.get(METHODS.panels)({ limit: 8 })
  assert.equal(snap.degraded, true, '降级必须落显式字段 degraded===true')
  assert.equal(typeof snap.reason, 'string')
  assert.ok(snap.reason.length > 0, '降级必须给非空 reason（禁 catch{return null}）')
  assert.equal(snap.reason, 'boom-heatmap', 'reason 必须携带原始成因，不许换成泛化文案')
  assert.deepEqual(snap.heatmap, [])

  const ack = await handlers.get(METHODS.render)({ rendered: 1 })
  assert.equal(ack.ok, false)
  assert.equal(ack.degraded, true)
  assert.ok(ack.reason.length > 0, '落点失败同样必须可读')
  assert.equal(ack.traceSeq, -1, '失败时 traceSeq 必须是哨兵值，不得伪装成有效 rowid')
})

test('读上限必须夹取（不设无界读）', async () => {
  const { registerPanels, METHODS, READ_LIMIT_MAX } = await import(new URL('src/panel.ts', PKG).href)
  const seen = []
  const port = {
    heatmap: (n) => { seen.push(n); return [] },
    goals: () => [],
    timeline: () => [],
    writeRender: () => 1,
  }
  const handlers = new Map()
  registerPanels({ handle: (m, h) => handlers.set(m, h) }, port)
  await handlers.get(METHODS.panels)({ limit: 99999 })
  await handlers.get(METHODS.panels)({ limit: -3 })
  await handlers.get(METHODS.panels)({})
  assert.equal(seen[0], READ_LIMIT_MAX, `超限必须夹到 ${READ_LIMIT_MAX}`)
  assert.equal(seen[1], 32, '非法值回落默认')
  assert.equal(seen[2], 32, '缺省值回落默认')
})

test('目标栈摊平带 depth 且不成环（邻接表防环）', async () => {
  const { flattenGoals } = await import(new URL('src/store.ts', PKG).href)
  const nodes = flattenGoals(
    [
      { id: 'g1', parent_id: null, title: '根', status: 'active', priority: 3 },
      { id: 'g2', parent_id: 'g1', title: '子', status: 'active', priority: 2 },
      { id: 'g3', parent_id: 'g2', title: '孙', status: 'paused', priority: 1 },
    ],
    10,
  )
  assert.deepEqual(nodes.map((n) => n.depth), [0, 1, 2], 'depth 必须按 parent_id 链推导')
  assert.equal(nodes[2].title, '孙')
  // 造一个环：不得死循环（能返回即证明）
  const cyclic = flattenGoals(
    [
      { id: 'a', parent_id: 'b', title: 'A', status: '', priority: 0 },
      { id: 'b', parent_id: 'a', title: 'B', status: '', priority: 0 },
    ],
    10,
  )
  assert.equal(cyclic.length, 2)
})

// ── d2 新增：slot 真注册（对**真**槽机制取证，不用假面）────────────────────────
//
// ⚠ 为什么用 `@deepseek-ai/dsh-client-ui-slots` 的 `SlotCore` 而不是假对象：
//   假面只能证明「我调了 register」，证明不了「槽机制**接受了**这次注册」；
//   而「调用没抛错」正是本仓明令不许当作通过依据的形态（G11：装配清单 ≠ 生效）。
//   `SlotCore` 是宿主自带的 node 侧纯核心，可 import、可注册、可读回 ⇒ 用它做出**可枚举断言**。
const SLOTS_MOD = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js'

/** 造一个「声明了 conversation.view 子槽」的根条目，返回 core 与清理器。 */
async function slotHarness() {
  const { SlotCore } = await import(SLOTS_MOD)
  const core = new SlotCore()
  const rootDispose = core.register(
    { name: 'root', id: 'harness-root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } },
    function HarnessRoot() { return null },
  )
  return { core, rootDispose }
}

/** 把真 SlotCore 适配成 client 半区要的槽面（inject 立即回调 = 声明已就绪）。 */
function coreSlotsFace(core) {
  const calls = []
  return {
    calls,
    inject: (key, cb) => {
      calls.push({ kind: 'inject', key })
      return cb()
    },
    register: (spec, component) => {
      calls.push({ kind: 'register', spec })
      return core.register(spec, component)
    },
  }
}

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

test('d2-① 槽真注册：SlotCore 台账里能读到本条目，且参数逐字一致', async () => {
  const exports = loadArtifact()
  const { core, rootDispose } = await slotHarness()
  const face = coreSlotsFace(core)
  // 用真 React 面造组件（从模块表取；取不到即显式失败，不静默跳过）
  const reactFaceMod = exports.reactFace()
  assert.equal(reactFaceMod.ok, false, '此环境无模块工厂 ⇒ 应显式不可用（不作为跳过理由）')

  // 直接注入一个最小 React 面，避免依赖模块表；槽机制的取证与 React 无关。
  const seen = []
  const result = exports.mountPanelWith(face, {
    createElement: (type, props, ...kids) => ({ type, props, kids }),
  }, () => Promise.resolve({ generatedAt: '', heatmap: [], goalTree: [], timeline: [], degraded: false, reason: '' }))
  seen.push(result)

  assert.equal(result.registered, true, `槽注册必须真发生：${JSON.stringify(result)}`)
  assert.equal(result.slot, 'conversation.view')
  assert.equal(result.id, 'mana-ui')
  assert.equal(result.order, 30)
  assert.equal(result.reason, '')

  // ★ 关键：从**真槽机制台账**读回，而不是信任返回值
  const entries = core.entriesOfSlot('conversation.view')
  assert.equal(entries.length, 1, `SlotCore 台账必须有 1 条，实测 ${entries.length}`)
  assert.equal(entries[0].options.id, 'mana-ui', 'SDK 台账里的 id 必须逐字等于 SLOT_ID')
  assert.equal(entries[0].options.order, 30, 'order 必须逐字等于 SLOT_ORDER')
  assert.equal(typeof entries[0].component, 'function', 'component 必须是可渲染的组件函数')

  // 调用序列也要可枚举（inject 先于 register）
  assert.deepEqual(face.calls.map((c) => c.kind), ['inject', 'register'])
  assert.equal(face.calls[0].key, 'conversation.view')
  assert.equal(face.calls[1].spec.name, 'conversation.view')

  // 释放链路：根条目撤下 → 子槽折叠 → 台账清空（不留下悬空状态）
  rootDispose()
  assert.equal(core.entriesOfSlot('conversation.view').length, 0, '根撤下后子槽条目必须清空')
  void seen
})

test('d2-② 负向控制：槽面不可读时必须 registered=false，且台账为空', async () => {
  const exports = loadArtifact()
  const { core, rootDispose } = await slotHarness()
  const React = { createElement: (type, props, ...kids) => ({ type, props, kids }) }

  // 负向 A：完全没有 slots 服务
  const noSlots = exports.mountPanelWith({}, React, () => Promise.resolve(null))
  assert.equal(noSlots.registered, false, '无 slots 服务必须 registered=false')
  assert.ok(noSlots.reason.length > 0, '必须给出非空原因')
  assert.equal(core.entriesOfSlot('conversation.view').length, 0, '失败路径不得留下台账条目')

  // 负向 B：slots 面存在但 register 抛错（模拟槽未声明）
  const throwing = exports.mountPanelWith(
    { inject: (_k, cb) => cb(), register: () => { throw new Error('slot "conversation.view" is not declared') } },
    React,
    () => Promise.resolve(null),
  )
  assert.equal(throwing.registered, false, '注册抛错必须 registered=false（不得假装成功）')
  assert.match(throwing.reason, /not declared/, '原因必须携带原始报错，不许泛化')
  assert.equal(core.entriesOfSlot('conversation.view').length, 0)

  rootDispose()
})

test('d2-③ 渲染树可枚举：三面板节点带稳定标记，降级态有可读提示', async () => {
  const exports = loadArtifact()
  const React = { createElement: (type, props, ...kids) => ({ type, props, kids }) }
  const snap = {
    generatedAt: 't',
    heatmap: [
      { memoryId: 'm1', activation: 1, strength: 0.5, type: 'episodic' },
      { memoryId: 'm2', activation: 0, strength: 0.5, type: 'semantic' },
    ],
    goalTree: [
      { id: 'g1', parentId: null, title: '根', status: 'active', priority: 1, depth: 0 },
      { id: 'g2', parentId: 'g1', title: '子', status: 'active', priority: 0, depth: 1 },
    ],
    timeline: [{ seq: 7, eventType: 'ui/render', at: 't', sessionId: 's', turnId: 1 }],
    // ⚠ 本快照**故意不带 `replay` 键**（缺键 = 旧版 Host 的形态）⇒ 回放面板必须落
    //   「无回放面」而不是**抛错白屏**。这是本席实测咬出来的真缺陷：缺键时 renderReplay
    //   抛 TypeError，四块面板**一起**不可观测 —— 正是 degradation 契约禁掉的形态。
    degraded: false,
    reason: '',
  }
  const tree = exports.renderPanels(React, snap)
  assert.equal(tree.props['data-panel'], 'mana-ui', '根节点必须带稳定标记')
  assert.equal(tree.props['data-degraded'], 'false')

  /** 递归收集带某属性的节点（产物是嵌套树，扁平过滤会漏层 —— 本轮实测踩到）。 */
  const walk = (node, pred, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (pred(node)) out.push(node)
    for (const kid of node.kids ?? []) walk(kid, pred, out)
    return out
  }
  const panels = walk(tree, (n) => n.props && n.props['data-panel'])
  // ⚠ 枚举面随实现扩到五块面板（B6.2「认知轨迹回放」；本卡「模型通道」）——这是**声明**，
  //   不是放宽：旧版写成三块，新增面板会在这里红；反过来漏挂一块也红。
  assert.deepEqual(
    panels.map((p) => p.props['data-panel']),
    ['mana-ui', 'model-channel', 'heatmap', 'goal-tree', 'timeline', 'replay'],
    '根 + 五块面板必须各出现一次且有稳定标记',
  )
  // 回放面板**必须**带 `data-mode` 且逐字等于审计回放：渲染树上也能把「只读审计回放」
  //   与「写回状态回放」（G10，会复活旧状态）分开。
  const replayPanel = panels.find((p) => p.props['data-panel'] === 'replay')
  assert.equal(replayPanel?.props['data-mode'], 'audit-replay', '回放面板必须自报为审计（只读）回放')
  // 热力图：两格，且色阶按 min/max 归一（1 → 1，0 → 0）
  const heatCells = walk(tree, (n) => n.props && 'data-cell' in n.props)
  assert.equal(heatCells.length, 2, '每一行一个格子')
  assert.deepEqual(heatCells.map((c) => c.props['data-level']), ['1', '0'], '色阶必须按实测 min/max 归一')
  // 目标树：递归出两层，深度可枚举
  const uls = walk(tree, (n) => n.type === 'ul')
  assert.deepEqual(uls.map((u) => u.props['data-depth']), ['0', '1'], '子层必须带 depth=1（结构可枚举）')
  const goalItems = walk(tree, (n) => n.props && 'data-goal' in n.props)
  assert.deepEqual(goalItems.map((g) => g.props['data-goal']), ['g1', 'g2'], '两个目标节点都要出现')

  // 降级态：必须渲染可读提示，而不是空白
  const degraded = exports.renderPanels(React, { ...snap, degraded: true, reason: 'boom' })
  assert.equal(degraded.props['data-degraded'], 'true')
  assert.equal(degraded.props['data-reason'], 'boom')
  const hint = degraded.kids.find((k) => k && typeof k === 'object' && k.props && k.props['data-state'] === 'degraded')
  assert.ok(hint, '降级态必须渲染一条可读提示（白屏=失败不可观测）')
  assert.match(String(hint.kids[0]), /boom/, '提示里必须带原始原因')
})
