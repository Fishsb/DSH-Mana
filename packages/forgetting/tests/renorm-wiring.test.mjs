/**
 * **E3 · §13.6 重归一化 —— 接线判据**（导出面可达 + 包内调用点就绪）。
 *
 * ── 本文件为什么必须存在（D3 席的交付缺口）────────────────────────────────────────
 *   D3 席交付了 `renorm.ts`（424 行 / 12 条判据全绿），但**零导出、零消费者**：
 *   包外 `grep renormalizeSynapses` 命中 0 ⇒ 那些判据证的是「**函数可用**」，
 *   不是「**链在跑**」。两者在报告层面同形 —— 正是本仓反复点名的形态。
 *
 * ── 硬口径（任务卡冻结契约，逐条落成本文件的腿）──────────────────────────────────
 *   ⛔ 任务卡明文：**不接受**「测试直接 import 函数并调用它」当作接线证据。
 *   ✅ 故本文件的动态腿一律走**真装配后的服务面**（`svc.forgetting.renormalizeSynapses`）——
 *      那正是驱动者 `scheduler/src/chains.ts` 取用的同一个对象（`svc(NAME).forgetting.<member>`）；
 *      「服务面真通到模块」由 **renorm.ts 内部的计数桩**记账（在函数体首行注入），
 *      而不是靠"调用没报错"推断。
 *
 *   | # | 腿 | 判什么 | 退化形态（没有它会怎样） |
 *   |---|---|---|---|
 *   | ① | 装配 | 真 Context + core + forgetting ⇒ 服务面方法存在 | 挂在别处/拼错名 ⇒ 驱动者取到 undefined |
 *   | ② | **桩计数（核心）** | 经服务面调用 ⇒ 模块内的桩**恰好记 1 次**，参数逐位一致 | 无桩 ⇒ 只能证明"没抛"，不能证明"调到了 renorm.ts" |
 *   | ②′ | 计量前置控制 | **装配本身 0 次调用** ⇒ 计数不是常数 | 计数恒 ≥1 ⇒ ② 平凡通过 |
 *   | ③ | 同一性 | 服务面方法 ≡ **src 入口导出**（同一引用） | 服务面另写一份实现 ⇒ 接线指向别处 |
 *   | ③′ | 包名可达（**lib**） | 按包名 import ⇒ 可读 + 读数与 src **逐位相同** | 产物落后 ⇒ 判据测的是**旧代码**（本仓既有教训） |
 *   | ④ | **无缺省（挡）** | `arity === 2` 且不传 capacity **必抛** | 有人加缺省 ⇒ 在注册表外造第二份参数真源 |
 *   | ⑤ | 失败面（挡） | 非法入参经**服务面**全部抛 | 服务面把 fail-closed 吞成静默返回 |
 *   | ⑥ | 不吞异常（挡） | 下游抛错**原样穿透**服务面 | 转成 no-op/undefined ⇒ 故障不可观测 |
 *   | ⑦ | 驱动侧对账（只读） | 驱动者解析的服务名 == 本包注册名；调用形状 == `.forgetting.<member>` | "待哪一卡"变成空话 |
 *   | ⑧ | **当前状态钉** | chains.ts 尚未出现 renorm 调用（**事实**） | 驱动侧接上后本腿必红 ⇒ 强制交代（同 skeleton ⑦ 口径） |
 *   | ⑨ | 反证：卸载即净 | dispose 后服务不可读 | "接线"是残留而非装配产物 |
 *   | ⑩ | 用例计数自检 | — | 空文件在 `node --test` 下报 tests 1/pass 1 的假绿 |
 *
 * ── 桩接缝怎么做的（以及它的**局限**，如实写）────────────────────────────────────
 *   用 `node:module` 的 `registerHooks({ load })` 在**加载期**给 `src/renorm.ts` 的
 *   `renormalizeSynapses` 函数体首行注入一行 `globalThis.__RENORM_STUB__.record(...)`。
 *   · 锚点用**签名正则**（不是写死一行的字面量全文），且要求**恰好命中 1 处** ⇒ 锚点漂了会**抛**（fail-closed），
 *     不会静默变成"没注入 ⇒ 计数恒 0 ⇒ 判据红"，也不会"注入错地方 ⇒ 假绿"。
 *   · ⚠ **局限（不许读成全覆盖）**：这是**源码级**注入，不是运行期 monkey-patch。
 *     若有人把 renorm.ts 的实现搬到**别的模块**再让 index.ts 指过去，本文件会红（② 计数 0）；
 *     但若有人**保留**renorm.ts 而又在服务面**另接一份**实现，③ 的同一性腿会红。
 *     两条腿合起来才覆盖"接线指向真身"，单看任一条都不够。
 *
 * ── 运行（**显式路径**）：`node --test packages/forgetting/tests/renorm-wiring.test.mjs`
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { registerHooks } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_CASES = 12
let ran = 0

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const RENORM_SRC = fileURLToPath(new URL('../src/renorm.ts', import.meta.url))
const INDEX_SRC = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const CHAINS_SRC = fileURLToPath(new URL('../../scheduler/src/chains.ts', import.meta.url))
/** 本包在**驱动者侧**被解析的服务名（⑦ 与 src 的 `name` 对账，不手写第三套）。 */
const SERVICE_NAME = 'mana-forgetting'
/**
 * 本包的 **npm 包名**（≠ 服务名）。③′ 用它判「包外可达」。
 * ⚠ 两者不可混用：服务面走 `ctx.get('mana-forgetting')`，包家具走 `import 'dsh-mana-forgetting'`。
 */
const PKG_NAME = 'dsh-mana-forgetting'

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tempDb = () => {
  const d = mkdtempSync(join(tmpdir(), 'mana-e3-'))
  dirs.push(d)
  return join(d, 'mana.db')
}

// ══ 桩接缝：加载期注入计数行（唯一改动 renorm.ts 的通道，且只在**内存**里）══════════
/**
 * 计价桩。`mode='pass'` 记账后放行（读数仍是**真算**的）；
 * `mode='throw'` 记账后即抛 ⇒ 用于判"下游异常是否被服务面吞掉"。
 */
const stub = {
  calls: [],
  mode: 'pass',
  record(items, capacity) {
    const list = Array.isArray(items) ? items : []
    this.calls.push({
      count: list.length,
      capacity,
      ids: list.map((it) => (it && typeof it === 'object' ? it.memoryId : undefined)),
    })
    if (this.mode === 'throw') {
      const e = new Error('RENORM-STUB-EXPLODE')
      e.renormStub = true
      throw e
    }
  },
}
globalThis.__RENORM_STUB__ = stub

/** 签名锚点（**正则**，不写死全文）：须恰好命中 1 处，否则抛（fail-closed）。 */
const ANCHOR_RE = /export function renormalizeSynapses\([^)]*\)[^{]*\{/
let injected = 0
registerHooks({
  load(url, ctx, nextLoad) {
    const r = nextLoad(url, ctx)
    if (!url.includes('/forgetting/src/renorm.ts')) return r
    const src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8')
    const hits = src.match(new RegExp(ANCHOR_RE.source, 'g')) ?? []
    if (hits.length !== 1) {
      throw new Error(
        `接线桩锚点失效：renorm.ts 里 renormalizeSynapses 的签名命中 ${hits.length} 处（须恰好 1 处）。` +
          '签名变了就把本文件的 ANCHOR_RE 同步过来 —— **不许**把锚点放宽成"匹配不到就跳过"（那会让计数恒 0 且原因不可分辨）。',
      )
    }
    injected += 1
    return { ...r, source: src.replace(ANCHOR_RE, (m) => m + '\n  globalThis.__RENORM_STUB__.record(items, capacity)') }
  },
})

/** 真装配：Context + core + forgetting（**不 mock 任何装配件**；库走临时文件）。 */
async function mount() {
  const ctx = new Context()
  const core = await load('core')
  const mod = await load('forgetting')
  ctx.plugin(core, { storePath: tempDb() })
  await settle(200)
  const fiber = ctx.plugin(mod)
  await settle(300)
  return { ctx, mod, fiber }
}

/** 典型批次：μ=7、γ_raw=4.6 被下界钳到 1.4 ⇒ 同时覆盖"钳位可见"与"守恒"两面。 */
const BATCH = [
  { memoryId: 'e3-a', strength: 2 },
  { memoryId: 'e3-b', strength: 6 },
  { memoryId: 'e3-c', strength: 8 },
  { memoryId: 'e3-d', strength: 12 },
]
const CAPACITY = 30

/** 读数投影（两处来源对拍用；逐位相等，不做四舍五入 —— 容差会掩盖"改了公式"）。 */
const project = (v) => ({
  outcome: v.outcome,
  capacity: v.capacity,
  mean: v.mean,
  minBefore: v.minBefore,
  maxBefore: v.maxBefore,
  minAfter: v.minAfter,
  maxAfter: v.maxAfter,
  scale: v.scale,
  scaleRaw: v.scaleRaw,
  scaleFloor: v.scaleFloor,
  clamped: v.clamped,
  totalBefore: v.totalBefore,
  totalAfter: v.totalAfter,
  conservationResidual: v.conservationResidual,
  snrGain: v.snrGain,
  inputCount: v.inputCount,
  resolved: v.resolved.map((r) => [r.memoryId, r.strength, r.after, r.delta, r.rank, r.factor]),
})

// ══ ① 装配：服务面方法存在 ═══════════════════════════════════════════════════════
test('① 真装配后服务面有 renormalizeSynapses（驱动者取的就是这个对象）', async () => {
  ran += 1
  const { ctx, mod } = await mount()
  const svc = ctx.get(SERVICE_NAME)
  assert.ok(svc, 'mana-forgetting 服务必须可读（未 provide = 插件没真跑起来）')
  const F = svc.forgetting
  assert.ok(F && typeof F === 'object', 'service.forgetting 不得缺席')
  assert.equal(typeof F.renormalizeSynapses, 'function', '服务面必须暴露 renormalizeSynapses（驱动者按 .forgetting.<member> 取用）')
  // 导出面可达（模块级）—— 与 ③ 的同一性腿配对，缺一不可
  assert.equal(typeof mod.renormalizeSynapses, 'function', 'index.ts 必须导出 renormalizeSynapses（包外可达）')
})

// ══ ②′ 计量前置控制：装配本身 0 次调用 ════════════════════════════════════════════
test('②′ 前置控制：仅仅装配**不得**产生调用（否则 ② 的计数是常数、平凡通过）', async () => {
  ran += 1
  const before = stub.calls.length
  await mount()
  assert.equal(
    stub.calls.length,
    before,
    `装配不得调用重归一化（实测 ${stub.calls.length - before} 次）—— 它是**被调用**的维护动作，不是装配期副作用`,
  )
})

// ══ ② 桩计数（核心接线腿）════════════════════════════════════════════════════════
test('② **桩计数**：经服务面调用 ⇒ renorm.ts 内的桩恰好记 1 次，且参数逐位一致', async () => {
  ran += 1
  const { ctx } = await mount()
  stub.calls = []
  stub.mode = 'pass'
  const F = ctx.get(SERVICE_NAME).forgetting
  const v = F.renormalizeSynapses(BATCH, CAPACITY)
  assert.equal(
    stub.calls.length,
    1,
    `经**服务面**调用必须让 renorm.ts 内的桩记 **1** 次（实测 ${stub.calls.length}）——` +
      '0 次说明服务面没通到 renorm.ts（接线是假的）；>1 说明被重复执行',
  )
  const rec = stub.calls[0]
  assert.equal(rec.count, BATCH.length, '桩收到的**条数**必须与传入批次一致')
  assert.equal(rec.capacity, CAPACITY, '桩收到的 **capacity** 必须逐位等于调用方给的值（不得被缺省顶替）')
  assert.deepEqual(
    rec.ids,
    BATCH.map((b) => b.memoryId),
    '桩收到的 **memoryId 序列**必须与传入逐位一致（顺序/丢项都会在此暴露）',
  )
  // 读数是**真算**的（桩是放行式，不是替身）：守恒 + 钳位可见 两条硬读数
  assert.equal(v.inputCount, BATCH.length)
  assert.ok(Math.abs(v.conservationResidual) <= 1e-9, `守恒残差须在容差内；实测 ${v.conservationResidual}`)
  assert.equal(v.totalBefore, 28)
  assert.equal(v.totalAfter, 28)
  assert.equal(v.scale, 1.4, '夹具 [2,6,8,12]/cap30 的 γ 被下界钳到 1.4（判据侧独立字面量）')
  assert.equal(v.scaleRaw, 4.6)
  assert.equal(v.clamped, true, '被非负下界截住必须可见（静默钳位是本仓最防的形态）')
  // ⚠ 这里**必须用容差**（实测 4.440892098500626e-16，不是逐位 0）：下界是「贴住」而非「等于」，
  //   逐位断言会变成一条**随夹具浮点尾数变色**的判据（本仓明令禁止「一会儿过一会儿不过」）。
  //   口径与 renorm.test.mjs ⑥ 一致：`near(a.resolved[0].after, 0, 1e-9)`。
  assert.ok(Math.abs(v.minAfter) <= 1e-9, `钳位态最弱一条须贴住 0（容差 1e-9）；实测 ${v.minAfter}`)
  assert.ok(v.minAfter >= 0, `钳位**不得**把强度推成负数（那正是下界存在的理由）；实测 ${v.minAfter}`)
  assert.equal(v.maxAfter, 14)
})

// ══ ③ 同一性：服务面方法 ≡ src 入口导出 ══════════════════════════════════════════
test('③ 同一性：服务面方法与 index.ts 导出是**同一引用**（服务面不得另写一份实现）', async () => {
  ran += 1
  const { ctx, mod } = await mount()
  const F = ctx.get(SERVICE_NAME).forgetting
  assert.equal(
    F.renormalizeSynapses,
    mod.renormalizeSynapses,
    '服务面入口必须**就是**包导出的那个函数（=== 同一引用）—— 相等为假说明服务面接了另一份实现，' +
      '那样"包外可达的那个"与"链上跑的那个"是两个东西',
  )
})

// ══ ③′ 包名可达（lib 产物）+ src/lib 读数逐位相同 ════════════════════════════════
test('③′ 包名可达（lib）：按包名 import 可读，且读数与 src 面**逐位相同**（产物落后即红）', async () => {
  ran += 1
  const { mod } = await mount()
  // ⚠ 按**包名**解析 = 别的包在生产里的真实解析路径（本仓 tests 直读 src 是为了防产物落后，
  //   但"包外可达"这件事本身只能在包名路径上判）。
  const pkg = await import(PKG_NAME)
  assert.equal(typeof pkg.renormalizeSynapses, 'function', `${SERVICE_NAME} 的包入口必须导出 renormalizeSynapses（未 build 或未导出 ⇒ 包外不可达）`)
  assert.equal(pkg.renormalizeSynapses.length, 2, '(items, capacity) 两参签名 —— 见 ④ 的无缺省腿')
  assert.deepEqual(
    project(pkg.renormalizeSynapses(BATCH, CAPACITY)),
    project(mod.renormalizeSynapses(BATCH, CAPACITY)),
    'lib 产物与 src 的读数必须**逐位相同** —— 不同即「改了 src 没 rebuild」，' +
      '此时包外的消费者跑的是**旧代码**而单包判据看着 src 全绿（本仓既有教训）',
  )
})

// ══ ④ 无缺省（挡）：arity === 2 且不传 capacity 必抛 ══════════════════════════════
test('④ 无缺省（挡）：arity 恰为 2；不传 capacity **必抛**（不许在注册表外造第二份真源）', async () => {
  ran += 1
  const { ctx, mod } = await mount()
  const F = ctx.get(SERVICE_NAME).forgetting
  /**
   * `arity` 是这条硬边界**唯一可靠的机检形态**：JS 里 `f(a, b = X)` 的 `length` 会变成 1。
   * ⇒ 只要有人在 renorm.ts 里给 capacity 加缺省，本腿立刻红（比"读源码里有没有 = "更硬）。
   */
  assert.equal(
    mod.renormalizeSynapses.length,
    2,
    'renormalizeSynapses 的 arity 必须恰好 2 —— 变成 1 即"capacity 被加了缺省值"，' +
      '那会在 params.ts / criteria.ts 之外新造第二个参数真源（D3 席的硬边界）',
  )
  assert.equal(F.renormalizeSynapses.length, 2, '服务面上的同一函数，arity 必须同为 2')
  /**
   * ── 前置控制（防"这条腿是恒真的"）────────────────────────────────────────────
   * 断言 `fn.length === 2` 只在**它真的会因缺省值而变小**时才有意义。
   * JS 语义：形参表里任一参数带缺省值/解构/剩余参数 ⇒ `length` 在**该位置之前**截断。
   * 故这里就地造一个**同形状但带缺省**的函数，证明本判据的分辨力（不是"随便一个数")：
   *   `(items, capacity = 30) => {}` 的 `length` 必为 **1** —— 正是 M-变体要被抓到的形态。
   * ⚠ 这是**语义控制**，不是"改 renorm.ts 跑一次"：renorm.ts 不在本卡写面，
   *   故不靠临时改它来取红；此处断言的是"若那样改，本判据必然报红"的**可复算前提**。
   */
  const withDefault = (items, capacity = 30) => ({ items, capacity })
  assert.equal(
    withDefault.length,
    1,
    '前置控制：带缺省值的同形状函数 arity 必须为 1 —— 若这都不成立，上面两条 length===2 就是恒真断言（无牙）',
  )
  assert.notEqual(
    withDefault.length,
    mod.renormalizeSynapses.length,
    '前置控制：带缺省 vs 真实实现，arity 必须**可分辨** —— 这是 ④ 能挡住"加缺省造第二份真源"的全部依据',
  )
  // 不传 capacity：必须抛，**不得**静默用某个缺省容量算出读数
  assert.throws(
    () => F.renormalizeSynapses(BATCH),
    /capacity/,
    '缺 capacity 必须抛（fail-closed）—— 静默缺省会把"调用方没给上界"读成"归一化成功"',
  )
  assert.throws(
    () => F.renormalizeSynapses(BATCH, undefined),
    /capacity/,
    'capacity=undefined 必须抛（与"没传"同一条腿，防止 undefined 被当成"用缺省"）',
  )
})

// ══ ⑤ 失败面（挡）：非法入参经服务面全部抛 ═══════════════════════════════════════
test('⑤ 失败面（挡）：非法入参经**服务面**全部抛（服务面不得把 fail-closed 吞掉）', async () => {
  ran += 1
  const { ctx } = await mount()
  const F = ctx.get(SERVICE_NAME).forgetting
  const cases = [
    ['capacity 非有限数', () => F.renormalizeSynapses(BATCH, Number.NaN)],
    ['capacity 非正', () => F.renormalizeSynapses(BATCH, 0)],
    ['capacity ≤ μ（次序反转）', () => F.renormalizeSynapses(BATCH, 3)],
    ['strength 为负', () => F.renormalizeSynapses([{ memoryId: 'n', strength: -1 }], CAPACITY)],
    ['strength 非有限', () => F.renormalizeSynapses([{ memoryId: 'i', strength: Infinity }], CAPACITY)],
      ]
  // ⚠ memoryId 重复那条用**显式构造**（上面 case 表里不写函数调用之外的魔法）
  cases[cases.length - 1] = [
    'memoryId 重复',
    () => F.renormalizeSynapses([{ memoryId: 'dup', strength: 1 }, { memoryId: 'dup', strength: 9 }], CAPACITY),
  ]
  for (const [label, fn] of cases) {
    assert.throws(fn, /renormalizeSynapses/, `${label} 必须抛且消息点名函数（fail-closed 一路到服务面）`)
  }
  // 反向：合法入参**不**抛（两个方向都判）
  assert.doesNotThrow(() => F.renormalizeSynapses(BATCH, CAPACITY), '合法入参不得抛')
  // 「没得做」不是「坏了」：空批次走 no-op 且**点名**成因（不合并、不抛）
  const empty = F.renormalizeSynapses([], CAPACITY)
  assert.equal(empty.outcome.kind, 'no-op')
  assert.equal(empty.outcome.reason, 'empty-input')
  assert.equal(empty.inputCount, 0, '输入量须**显式记 0**（「无输入」与「未消费」可分辨）')
})

// ══ ⑥ 不吞异常（挡）：下游抛错原样穿透服务面 ═════════════════════════════════════
test('⑥ 不吞异常（挡）：下游抛错必须**原样穿透**服务面（不得转成 no-op / undefined）', async () => {
  ran += 1
  const { ctx } = await mount()
  const F = ctx.get(SERVICE_NAME).forgetting
  stub.calls = []
  stub.mode = 'throw'
  try {
    let got = null
    try {
      got = F.renormalizeSynapses(BATCH, CAPACITY)
    } catch (e) {
      got = e
    }
    assert.ok(got instanceof Error, `下游异常必须抛到调用方；实测得到 ${JSON.stringify(got)}`)
    assert.equal(got.renormStub, true, '抛出的必须是下游那个错误本身（不是被包成另一个）')
    assert.equal(got.message, 'RENORM-STUB-EXPLODE')
    // 桩确实被走到过（否则上面是"还没到下游就抛了"的平凡通过）
    assert.equal(stub.calls.length, 1, '抛错前桩必须已被调用 1 次（证明异常来自**下游**）')
  } finally {
    stub.mode = 'pass'
    stub.calls = []
  }
})

// ══ ⑦ 驱动侧对账（只读）══════════════════════════════════════════════════════════
test('⑦ 驱动侧对账（只读）：服务名与调用形状对得上 ⇒「驱动侧接线」有确定落点', async () => {
  ran += 1
  const mod = await load('forgetting')
  const sched = await load('scheduler')
  assert.equal(mod.name, SERVICE_NAME, '本包注册名（⑦ 的对账基准）')
  assert.equal(
    sched.CHAIN_SERVICES.forgetting,
    SERVICE_NAME,
    '调度器解析遗忘链服务用的键必须**等于**本包注册名 —— 不等则驱动者取到 undefined（静默不执行）',
  )
  const chains = readFileSync(CHAINS_SRC, 'utf8')
  // 驱动者的调用形状：`<svc>.forgetting.<member>(...)`（本包服务面的形状必须与之一致）
  const shape = /\bforgetting\.forgetting\.[A-Za-z_]+\(/g
  const shapeHits = chains.match(shape) ?? []
  assert.ok(
    shapeHits.length >= 1,
    `驱动者的遗忘链调用形状必须是 \`<svc>.forgetting.<member>()\`；实测命中 ${shapeHits.length}（脚本对不上源码 ⇒ 本腿要同步）`,
  )
  // ⚠ 服务名/形状都对得上，**但**本卡不许改 scheduler ⇒ 落点是"待另一卡"（⑧ 把它钉成事实）
  assert.ok(
    !/renormalizeSynapses/.test(chains),
    '⚠ 本卡写面**不含** scheduler/src/chains.ts ⇒ 该文件里不应出现 renorm 调用；' +
      '出现了说明有人越界改了驱动侧，本条与卡面的写面边界冲突',
  )
})

// ══ ⑧ 当前状态钉：驱动侧尚未接线（**事实**，接上后必红 ⇒ 强制交代）══════════════════
test('⑧ 当前状态钉：§13.6 在**遗忘链驱动侧**尚未接线（接上后本腿必红 ⇒ 强制同步台账）', async () => {
  ran += 1
  const chains = readFileSync(CHAINS_SRC, 'utf8')
  assert.ok(
    !/renormalizeSynapses/.test(chains),
    '本腿把「驱动侧尚未接线」钉成**可断言的事实**（口径同 skeleton.test.mjs ⑦「多一条行为即红 ⇒ 强制交代」）。' +
      '⇒ 若驱动侧接上了 renorm，**本文件必须同步更新**：把落点从「包内就绪」改成「端到端真跑」，' +
      '并按冻结契约补桩计数腿。**不许**为了让本文件变绿而把 renorm 调用从 chains.ts 撤掉。',
  )
  // 本包侧必须已就绪：导出 + 服务面成员两条都在（与 ①② 互为正反）
  const idx = readFileSync(INDEX_SRC, 'utf8')
  assert.ok(/export \{[^}]*renormalizeSynapses/.test(idx), 'index.ts 必须有一条**导出**语句点名 renormalizeSynapses（包外可达的唯一通道）')
  assert.ok(injected >= 1, `桩必须真被注入过（实测 ${injected} 次）—— 0 次说明接线腿是在**未插桩**的模块上跑的`)
})

// ══ ⑨ 反证：卸载即净 ════════════════════════════════════════════════════════════
test('⑨ 反证：dispose 后服务不可读（接线是装配产物，不是残留）', async () => {
  ran += 1
  const { ctx, fiber } = await mount()
  assert.ok(ctx.get(SERVICE_NAME), '卸载前服务须可读')
  await fiber.dispose()
  await settle(300)
  assert.equal(ctx.get(SERVICE_NAME), undefined, '卸载后服务必须消失（"卸载即净"）—— 否则"接线"可能是别处留下的残留')
})

// ══ ⑩ 用例计数自检 ══════════════════════════════════════════════════════════════
test('⑩ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
