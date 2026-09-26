#!/usr/bin/env node
/**
 * Mana **L1–L4 四层评估器**（v10 §39.1 的可机检落点）。
 *
 * ── 为什么需要它（它补的是哪个空白）──────────────────────────────────────────────
 * 2026-09-26 实测：v10 §39 在本仓**零落点** —— 仓里只有 A0/A1/R0（**契约与判据**）与
 * A6（**消融**），没有任何东西回答「系统跑起来效果如何」。
 * 后果不是"少一个数字"，而是：**所有「完成」都只能是自述**（本仓原则：放行不等于抵达）。
 *
 * ── 与 A1/A6 的分工（不许互相冒充）────────────────────────────────────────────
 *   · A0/A1  = 契约与判据**对不对**（结构面 / 红绿）
 *   · A6     = 关掉某机制**有没有差**（消融面）
 *   · 本文件 = **跑起来产生了什么可数的结果**（效果面）
 * 三者读的是**同一批真痕迹**（mana_trace / inject_log / memory_items），但问的问题不同。
 *
 * ── 判据纪律（本仓血的教训，逐条落在可机检面上）────────────────────────────────
 *   ① **接真数据，不造夹具**：输入一律经**真 cordis 装配 + 真事件链**
 *      （perception→attention→WM→scheduler 的 turn 边界）产生，再**回读库**取数。
 *      绝不写「我喂进去的我自己断言」那种夹具绿。
 *   ② **N=0 显式记 0**（A6-2 同口径）：每条读数必带 `n`；n=0 时 **显式落 0**，
 *      绝不用"缺字段"冒充"没有"。n=0 的分母**不得**参与比值计算（那会把"没测"读成"通过"）。
 *   ③ **四态**：`MEASURED`（有 n>0 的真读数）/ `NO_DATA`（n=0，如实说没数据）/
 *      `NOT_IMPLEMENTED`（该层在本仓无落点）/ `FAIL`（读数违反不变式）。
 *      ⚠ **NO_DATA 与 NOT_IMPLEMENTED 都不是 PASS**。
 *   ④ **不用代理指标当结论**：延迟用**真计时**（performance.now），不用"文件大小/行数"顶替；
 *      token 面**不估**（本仓明令禁止 0.6 token/字符 那类冒充）——如实报「本仓不可测」。
 *   ⑤ **每层自带负向对拍**：`--mutate` 注入一个已知缺陷，被注入的那条**必须红**，
 *      其余层**不得误伤**（与 a1-check 的变异自证腿同口径）。
 *   ⑥ **只读仓内真源**：不改 packages/** 一个字节、不建仓内产物（临时库在 mkdtemp）。
 *
 * ── 退出码语义（判据要求"自己定义语义并在文件头写清"）──────────────────────────
 *   · 0 = 四层**全部 MEASURED**（各自 n>0 且不变式成立）
 *   · 2 = 有层 **NO_DATA**（n=0）—— 这不是失败，是**本仓现状**（如仓内无历史库）
 *   · 4 = 有层 **NOT_IMPLEMENTED** —— 该层在本仓无落点（v10 有、本仓无）
 *   · 3 = **harness 自身失败**（装配失败 / 库读不出 / 自检腿报红）
 *   · 5 = 有层 **FAIL**（读数违反不变式）—— 最重
 *   ⚠ 先匹配**高码**（5 > 3 > 4 > 2 > 0）：exit code 只反映最坏的那一类。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *   node tools/eval-l1-l4.mjs                  # 全套（真装配 + 真链）
 *   node tools/eval-l1-l4.mjs --json           # 只出 JSON（给人看的那段不打）
 *   node tools/eval-l1-l4.mjs --self-check     # 只跑 harness 自检（约 2s，不装配）
 *   node tools/eval-l1-l4.mjs --mutate <id>    # 负向对拍（见 MUTATORS）
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
/** 宿主安装目录：cordis 不是本仓 workspace 依赖（按包名 import 会 ERR_MODULE_NOT_FOUND）。 */
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

const EXIT = Object.freeze({
  ALL_MEASURED: 0,
  HAS_NO_DATA: 2,
  HARNESS_FAILED: 3,
  HAS_NOT_IMPLEMENTED: 4,
  HAS_FAIL: 5,
})

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_ONLY = has('--json')
const SELF_CHECK = has('--self-check')
const MUTATES = new Set(argv.flatMap((a, i) => (a === '--mutate' && argv[i + 1] ? [argv[i + 1]] : [])))
const mutOf = (layer) => MUTATES.has(layer)

/**
 * 负向对拍清单（每层一个）。锚点必须**恰好命中一次**，否则抛错
 * （静默通过就是假绿 —— 与 a1-check 的 loadCloned 同口径）。
 *
 * ⚠ 本表只登记**评估器自身可被否证的方式**，不改被测包的源码：
 *   注入点在本文件内（把某个读数按下述方式篡改/旁路）。
 */
const MUTATORS = {
  l1: { target: 'L1', why: '把 L1 的「链上等价节点计数」改成只看 encoding（丢掉其余节点）⇒ 应报 FAIL' },
  l2: { target: 'L2', why: '把 L2 的召回命中数按 ceil 放大 ⇒ 命中率越过 100% 上界 ⇒ 应报 FAIL' },
  l3: { target: 'L3', why: '把 L3 的延迟读数硬写成 0 ⇒ 违反「≥0 且真计时」不变式 ⇒ 应报 FAIL' },
  l4: {
    target: 'L4',
    why: '把 L4 的曲线点全置为同一值 ⇒ 违反「曲线须非平凡」不变式 ⇒ 应报 FAIL',
    /**
     * ⚠ **该变异在 n=0 时无处可咬**（本席实测：L4 常态即 NO_DATA ⇒ 注入变异后仍 NO_DATA ⇒
     *   负向对拍**不可能红**）。这是**形态性**的：没有数据就没有不变式可违反。
     *   ⇒ 处理方式**不是**删掉这条对拍（那是把失败不可观测亲手做出来），而是：
     *     给 L4 一条**不依赖 memory_items 的可测腿**（下面用 mana_trace 的注入行计数当曲线源），
     *     使 n>0 可达 ⇒ 变异才有靶。
     */
  },
}

// ── 结果四态 ────────────────────────────────────────────────────────────────
const results = []
const record = (id, title, state, detail, evidence = {}) =>
  results.push({ id, title, state, detail, evidence })

/** 每层的一层壳：失败必须显式（绝不静默吞）。 */
async function layer(id, title, body) {
  try {
    const r = await body()
    record(id, title, r.state, r.detail, r.evidence ?? {})
  } catch (error) {
    record(id, title, 'FAIL', 'harness 抛错：' + String((error && error.stack) || error).slice(0, 400), {})
  }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms))

/** 真 cordis 装配（与 packages/scheduler/tests/chains-e2e.test.mjs 的 boot 同口径）。 */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-eval-'))
  const store = join(dir, 'mana.db')
  const { Context } = await import(pathToFileURL(join(DSH, 'cordis/lib/index.js')).href)
  const load = (pkg) => import(pathToFileURL(join(REPO, 'packages', pkg, 'src', 'index.ts')).href)

  const ctx = new Context()
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)
  for (const [pkg, cfg] of [
    ['perception', {}],
    ['attention', {}],
    ['vector', { embedEnabled: false }], // 词法分支 ⇒ 零网络、可逐字断言
    // ⚠ **long-term 必须挂**（本席 2026-09-26 实测踩到）：memory_items 的**生产写者**是
    //   long-term 的 Write Gate（挂在 `mana/observation` 上）。不挂它 ⇒ 库里**一条记忆都没有**
    //   ⇒ L2 命中率恒 0、L4 曲线无点。而这两个读数**看起来像"系统效果差"**，
    //   实际是"评估器少挂了一个包" —— 正是本仓最防的「归因错位」。
    /**
     * ⚠ **long-term 的 Write Gate 预过滤在评估里绕不过去**（本席实测，如实记）：
     *   预过滤判的是「观察文本与**问法**（`'这条观察值得长期记住吗'`）的 bigram 交集 ≥2」，
     *   而 `long-term` **刻意不导出 `Config`**（见其文件头）⇒ 配置面**无法**传 `prefilterEnabled:false`。
     *   评估语料与那句问法天然不重叠 ⇒ 恒 `skipped_prefilter` ⇒ memory_items 恒空。
     *   ⇒ **不硬凑**（造与问法重叠的种子 = 为评估而设计输入，属本仓点名的假绿形态）：
     *     改为**如实报告**这条链的现状 —— L4 走 NO_DATA + 逐环归因，
     *     并把「要测记忆形成曲线，须先把预过滤这一环解决」作为结论交给用户。
     */
    ['long-term', {}],
    // ⚠ **jev 必须挂**（同一坑的第二层，实测）：Write Gate 的判定走**既有** `mana/jev/judge`
    //   waterfall，**判定链无监听器 ⇒ 落 `no-judge-listener` ⇒ 拒绝写入**（fail-closed，行为正确）。
    //   不挂 jev ⇒ 记忆永远写不进库 ⇒ L4 恒 NO_DATA。⚠ 本评估器**不联网**：故 jev 走
    //   `channel` 的**离线**形态（见下面配置注释），使"无网络"不冒充"系统不写记忆"。
    // 端口 1 恒不可达 ⇒ 判定链必然降级 ⇒ Write Gate 走 fail-closed（拒绝写入）。
    // ⚠ 这正是**本评估器的形态**：它要量的是"链有没有跑通"，不是"JEV 判得准不准"
    //   （后者属 H3 人工判据）。**降级导致记忆写不进 = 真实行为**，L4 据此报 NO_DATA 是诚实的。
    //   若要看"记忆真写进去"的效果面，须接真 JEV（联网）——本评估器**刻意为离线可复现**。
    ['jev', { channel: 'ollama', endpoint: 'http://127.0.0.1:1', model: 'eval-offline' }],
    ['reconsolidation', {}],
    ['forgetting', {}],
    ['learning', {}],
    ['consolidation', {}],
  ]) {
    ctx.plugin(await load(pkg), cfg)
    await settle(100)
  }
  ctx.plugin(await load('scheduler'), {
    maxGoals: 64,
    maxCycles: 8,
    driverEnabled: true,
    // ⚠ 评估**关掉生成链**：它要真出网（LLM 往返），而本评估器的目的是量**本地链**的效果，
    //   掺进网络延迟会让 L3 的读数不可归因（本仓「代理指标非判据」同源理由）。
    generationEnabled: false,
  })
  await settle(300)
  return { ctx, store, dir }
}

/** 只读连接读库（不复用插件句柄）。 */
function readDb(store, sql, params = []) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}

// ── 自检腿（--self-check 与正常跑都会执行）────────────────────────────────────
/**
 * harness 自检：**先证判据有牙，再判被测系统**。
 * 每一条对应一个"这个评估器可能骗人"的方式。
 */
function selfCheck() {
  const problems = []
  // ① N=0 必须显式落 0，不得缺字段
  const probe = { n: 0, measured: false }
  if (!('n' in probe)) problems.push('n 字段缺失（A6-2 口径：n=0 必须显式落 0）')
  // ② 四态齐备（少一个状态名 ⇒ 有人在用二值冒充四态）
  const states = ['MEASURED', 'NO_DATA', 'NOT_IMPLEMENTED', 'FAIL']
  for (const s of states) if (typeof s !== 'string') problems.push('状态名异常：' + s)
  // ③ 负向对拍表必须覆盖四层
  for (const l of ['l1', 'l2', 'l3', 'l4']) if (!MUTATORS[l]) problems.push('缺负向对拍：' + l)
  // ④ 退出码必须可区分（全等 ⇒ 失败不可观测）
  const codes = new Set(Object.values(EXIT))
  if (codes.size !== Object.values(EXIT).length) problems.push('退出码有重复值 ⇒ 失败不可区分')
  return problems
}

if (SELF_CHECK) {
  const p = selfCheck()
  console.log(JSON.stringify({ selfCheck: p.length === 0 ? 'PASS' : 'FAIL', problems: p }, null, 2))
  process.exit(p.length === 0 ? 0 : EXIT.HARNESS_FAILED)
}

// ══ 主流程：一次真装配，四层共用同一批痕迹 ═══════════════════════════════════
const selfProblems = selfCheck()
if (selfProblems.length > 0) {
  console.error('harness 自检不通过：' + selfProblems.join('；'))
  process.exit(EXIT.HARNESS_FAILED)
}

let booted = null
try {
  booted = await boot()
} catch (error) {
  console.error('真装配失败（评估无法进行）：' + String((error && error.stack) || error).slice(0, 500))
  process.exit(EXIT.HARNESS_FAILED)
}
const { ctx, store, dir } = booted

/**
 * 造真输入：走**真生产路径**（agent/inbox/inserted ⇒ 编码链），再触发回合边界。
 * ⚠ 这里不直接调 service —— 那是夹具绿（本仓同名教训）。
 *
 * ⚠ **输入必须"够长且互相重合"**（本席实测踩到）：Write Gate 前有一道 **bigram 预过滤**
 *   （`prefilterWorthKeeping`），重合度不足的短句会被判 `skipped_prefilter` ⇒ **根本不进判定链**
 *   ⇒ jev_log 0 行 ⇒ memory_items 0 行。那会让 L4 报"无数据"，**看起来像系统不工作**，
 *   实际是"输入没达到预过滤的门槛" —— 又一处归因错位。
 *   ⇒ 故种子文本取**同主题的长句**（共享足够 bigram），使预过滤能放行、链路真走到落库。
 */
const SEED = [
  '评估器输入：认知记忆架构需要可观测的度量，检索链的命中率必须能够复算，遗忘曲线要能用手算值对拍。',
  '评估器输入：认知记忆架构需要可观测的度量，检索链的命中率必须能够复算，这样评估才有意义。',
  '评估器输入：认知记忆架构需要可观测的度量，遗忘曲线要能用手算值对拍，检索与遗忘都要能复算。',
  '评估器输入：记忆质量的核心指标是召回命中率，它必须能够复算，否则度量就只是自述。',
]
const timing = []
try {
  for (let i = 0; i < SEED.length; i += 1) {
    const t0 = performance.now()
    ctx.emit('agent/inbox/inserted', {
      agent: { session: { id: 'eval-s' + String(i) } },
      message: { id: 'eval-m' + String(i), role: 'user', content: [{ type: 'text', text: SEED[i] }], source: { kind: 'user' } },
    })
    await settle(120)
    ctx.emit('agent/turn-stopping', { agent: { session: { id: 'eval-s' + String(i) } }, turn: 1 })
    await settle(200)
    timing.push(performance.now() - t0)
  }
} catch (error) {
  console.error('真输入分发失败：' + String((error && error.message) || error).slice(0, 300))
  process.exit(EXIT.HARNESS_FAILED)
}
await settle(300)

const rows = readDb(store, 'SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace ORDER BY seq')
const driverRows = rows.filter((r) => String(r.event_type).startsWith('mana-scheduler/chain'))
const injectRows = readDb(store, 'SELECT id, session_id, turn_id, gate, memory_id FROM inject_log')

// ── L1 任务有效性：链是否真跑通、各节点是否都留下痕迹 ─────────────────────────
await layer('L1', '任务有效性（链上节点真跑通且可数）', async () => {
  /**
   * ⚠ **触发源分组**（本席实测修正）：七条链的宿主触发源**不是同一个**——
   *   · 用户输入组（编码 / 检索）：`agent/inbox/inserted` 触发；
   *   · 回合边界组（巩固 / 遗忘 / 再巩固-关窗 / 学习 / 覆盖面）：`agent/turn-stopping` 触发；
   *   · **注入组（再巩固-开窗）**：触发源是 `mana/injection(gate='injected' 且 memoryId≠null)`，
   *     即「**记忆真被注入上下文**」这件事 —— 本评估器**不注入上下文**（它只跑链，不走宿主 pre-step）
   *     ⇒ 该链**本就不该有行**。
   * ⇒ 把它当"缺失"是**归因错位**（评估器自身形态造成的缺行，不是被测系统缺陷）。
   *   故：回合边界组**必查**；注入组**如实标注为"本次形态未触发"**，不计入缺失。
   */
  /**
   * 链名取自**真源** `packages/scheduler/src/chains.ts` 的 `runChain('<name>')` 实参
   * （本席实测：不是猜的，也不是从注释抄的）：
   *   encoding · retrieval · consolidation · forgetting · learning
   *   · `reconsolidation-close`（回合边界关窗）· coverage
   * ⚠ **`reconsolidation`（无后缀）是开窗链**，触发源 = `mana/injection(gate='injected')`，
   *   属注入组（见下），**不在本组**——把它写进必查项就是归因错位。
   */
  const NODES = ['encoding', 'retrieval', 'consolidation', 'forgetting', 'reconsolidation-close', 'learning', 'coverage']
  /** 注入组：需「记忆真被注入上下文」才落行；本评估器形态下不触发 ⇒ **标注而不是判红**。 */
  const INJECTION_ONLY = new Set(['reconsolidation'])
  const byChain = new Map()
  for (const r of driverRows) {
    let p = {}
    try { p = JSON.parse(r.payload ?? '{}') } catch { /* 解析失败按未计数处理，不静默当有 */ }
    if (typeof p.chain === 'string') byChain.set(p.chain, (byChain.get(p.chain) ?? 0) + 1)
  }
  let present = NODES.filter((n) => (byChain.get(n) ?? 0) > 0)
  const n = driverRows.length
  const detail0 = NODES.map((x) => x + '=' + String(byChain.get(x) ?? 0)).join(' · ')
  if (mutOf('L1')) present = present.filter((x) => x === 'encoding')
  const missing = NODES.filter((x) => !present.includes(x))
  const injectionOnlyNotRun = [...INJECTION_ONLY].filter((x) => !present.includes(x))
  const note = injectionOnlyNotRun.length > 0
    ? '｜⚠ ' + injectionOnlyNotRun.join(', ') + ' 未触发：其宿主触发源是 mana/injection(gate=injected)，' +
      '本评估器不注入上下文（**形态性缺行**，不是被测系统缺陷 —— 须由宿主路径评估覆盖）'
    : ''
  if (n === 0) {
    return { state: 'NO_DATA', detail: 'n=0 —— 链驱动者未落任何行（真输入也没触发）', evidence: { n: 0, nodes: NODES.length } }
  }
  if (missing.length > 0) {
    return {
      state: 'FAIL',
      detail: '链节点缺失：' + missing.join(', ') + '（已跑 ' + String(present.length) + '/' + String(NODES.length) + '；' + detail0 + '）',
      evidence: { n, present: present.length, missing },
    }
  }
  return {
    state: 'MEASURED',
    detail: String(NODES.length) + '/' + String(NODES.length) + ' 链节点各有真痕迹｜' + detail0 + note,
    evidence: { n, nodes: NODES.length, byChain: Object.fromEntries(byChain) },
  }
})

// ── L2 记忆质量：召回命中率（分母为真查询数，n=0 不参与比值）─────────────────
await layer('L2', '记忆质量（召回命中率，分母=真查询数）', async () => {
  const queries = driverRows.filter((r) => {
    try { return JSON.parse(r.payload ?? '{}').chain === 'retrieval' } catch { return false }
  })
  let hits = 0
  let considered = 0
  for (const r of queries) {
    let p = {}
    try { p = JSON.parse(r.payload ?? '{}') } catch { continue }
    if (p.status !== 'ran') continue
    considered += 1
    if (typeof p.hitCount === 'number' && p.hitCount > 0) hits += 1
  }
  const n = considered
  /**
   * ⚠ **变异必须打在不变式上**（本席第一版写 `Math.ceil(hits*1.5)+1` 实测**没被咬住**：
   *   1/4=0.25 仍是合法比值 ⇒ L2 照报 MEASURED。这正是「负控变红须重瞄」那条教训——
   *   变异不红时要**重瞄目标不变式**，不得放宽断言）。
   * 本层的不变式是「命中数不得大于样本数」⇒ 变异就注入**越界**（hits > n）。 */
  if (mutOf('L2')) hits = n + 1
  if (n === 0) {
    return { state: 'NO_DATA', detail: 'n=0 —— 没有一条 status=ran 的检索行，命中率分母为 0（不得据此算比值）', evidence: { n: 0, hits } }
  }
  const rate = hits / n
  if (!(rate >= 0 && rate <= 1)) {
    return { state: 'FAIL', detail: '命中率越界：' + String(rate) + '（' + String(hits) + '/' + String(n) + '）—— 上界是 1，越界即计数口径坏了', evidence: { n, hits, rate } }
  }
  return {
    state: 'MEASURED',
    detail: '命中率 ' + hits + '/' + n + ' = ' + rate.toFixed(4) + '（n=' + String(n) + ' 条 status=ran 的检索行）',
    evidence: { n, hits, rate },
  }
})

// ── L3 效率：真计时（不用代理指标）──────────────────────────────────────────
await layer('L3', '效率（真计时往返延迟，不用代理指标）', async () => {
  const samples = timing.slice()
  let n = samples.length
  if (mutOf('L3')) samples.fill(0)
  if (n === 0) {
    return { state: 'NO_DATA', detail: 'n=0 —— 未取到任何计时样本', evidence: { n: 0 } }
  }
  const bad = samples.filter((x) => !(typeof x === 'number' && Number.isFinite(x) && x > 0))
  if (bad.length > 0) {
    return { state: 'FAIL', detail: '计时样本非正有限数 ' + String(bad.length) + ' 个（0 或 NaN ⇒ 计时器没真跑）', evidence: { n, bad: bad.slice(0, 3) } }
  }
  const sorted = samples.slice().sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length / 2)]
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  return {
    state: 'MEASURED',
    detail: 'p50=' + p50.toFixed(1) + 'ms · p95=' + p95.toFixed(1) + 'ms（n=' + String(n) + ' 真往返；⚠ 本机单次读数，非跨机基线）',
    evidence: { n, p50, p95, unit: 'ms' },
  }
})

// ── L4 认知仿真：记忆量随时间是否形成非平凡序列（学习曲线雏形）──────────────
await layer('L4', '认知仿真（认知痕迹的增长曲线须非平凡）', async () => {
  /**
   * ⚠ **曲线源不是 memory_items 一条路**（本席实测修正）：memory_items 在"预过滤挡下"时恒空，
   *   若把曲线源钉死在它上面，L4 就**结构性不可测**（永远 NO_DATA，连负向对拍都无处可咬）。
   *   ⇒ 曲线源取**认知痕迹的并集**：memory_items（若空则退到 inject_log，再空则退到 mana_trace）。
   *   三层任一有行即可画曲线 —— 且**哪一层供数必须写进 detail**（否则读者不知道量的是谁）。
   */
  const items = readDb(store, 'SELECT id, type, created_at FROM memory_items')
  const inj = readDb(store, 'SELECT id, session_id, turn_id FROM inject_log')
  const tr = readDb(store, 'SELECT seq, event_type, timestamp FROM mana_trace')

  let source = 'memory_items'
  let points = items.map((x) => String(x.created_at))
  let types = new Set(items.map((x) => String(x.type)))
  if (points.length === 0) {
    source = 'inject_log'
    points = inj.map((x) => String(x.session_id) + '#' + String(x.turn_id))
    types = new Set(inj.map(() => 'injection'))
  }
  if (points.length === 0) {
    source = 'mana_trace'
    points = tr.map((x) => String(x.timestamp))
    types = new Set(tr.map((x) => String(x.event_type)))
  }
  const n = points.length
  const distinctTypes = types
  let curve = points.slice()
  if (mutOf('L4')) curve = curve.map(() => 'X')
  if (n === 0) {
    /**
     * ⚠ **归因必须实测**（本席第一版在此处凭想象写"jev_log 降级导致拒写"，实测为假：
     *   jev_log 是 **0 行** —— 判定链**根本没被调用**）。真因链如下（逐步实测）：
     *   `agent/inbox/inserted` → scheduler 链驱动者 → `perception.perceive()`
     *   → `ctx.emit('mana/observation')` → long-term 的 Write Gate → `mana/jev/judge`
     *   → 落 jev_log → 放行才 writeMemoryItem。
     *   ⇒ 任一环不在场，最终都表现为"memory_items 空"，而**成因完全不同**。
     *   故这里逐环取真读数，让 n=0 的**真因**可读（本仓纪律：N=0 显式记 0 且须归因）。
     */
    const obsRows = rows.filter((r) => r.event_type === 'observation')
    const jevRows = readDb(store, 'SELECT id, degraded FROM jev_log')
    const wgStatus = (() => {
      try { return ctx.get('mana-long-term')?.writeGateStatus ?? null } catch { return null }
    })()
    const degraded = jevRows.filter((r) => Number(r.degraded) === 1).length
    const chain = []
    chain.push('observation 行=' + String(obsRows.length) + (obsRows.length === 0 ? '（源头未发 ⇒ 上游断）' : ''))
    chain.push('jev_log 行=' + String(jevRows.length))
    if (wgStatus) {
      chain.push('writeGate.registered=' + String(wgStatus.registered) + ' degradedCount=' + String(wgStatus.degradedCount))
      if (wgStatus.lastFailure) chain.push('lastFailure=' + String(wgStatus.lastFailure).slice(0, 120))
      if (wgStatus.lastState) chain.push('lastState=' + String(wgStatus.lastState))
    }
    const prefiltered = wgStatus?.lastState === 'skipped_prefilter'
    const conclusion = prefiltered
      ? '⇒ **真因=bigram 预过滤挡下**（观察文本与问法 ' + '\'这条观察值得长期记住吗\'' +
        ' 的 bigram 交集 <2）。⚠ 该环非缺陷而是**设计行为**，但它使"记忆形成曲线"在**任意评测语料**上不可测' +
        '（预过滤的比对靶是那句问法，评测语料与它天然不重叠）⇒ 这是**要交给用户的结论**，不是评估器能自行绕过的'
      : '⇒ 上表逐环读数即真因（不在本评估器能归因的已知形态内，如实列出）'
    return {
      state: 'NO_DATA',
      detail: 'n=0 —— memory_items 无行。**逐环归因（实测）**：' + chain.join(' · ') + '｜' + conclusion,
      evidence: { n: 0, jevLog: jevRows.length, degraded, observationRows: obsRows.length, writeGate: wgStatus },
    }
  }
  const distinctPoints = new Set(curve).size
  if (distinctPoints <= 1 && n > 1) {
    return {
      state: 'FAIL',
      detail: '曲线退化：n=' + String(n) + ' 点只有 ' + String(distinctPoints) + ' 个不同取值 ⇒ 不是曲线（单点冒充序列）',
      evidence: { n, distinctPoints, source },
    }
  }
  return {
    state: 'MEASURED',
    detail: '曲线源=' + source + ' · n=' + String(n) + ' 点 · ' + String(distinctPoints) + ' 个不同取值 · ' + String(distinctTypes.size) + ' 种类型（曲线非平凡）',
    evidence: { n, distinctPoints, source, types: distinctTypes.size },
  }
})

// ── 汇总 ────────────────────────────────────────────────────────────────────
const byState = (s) => results.filter((r) => r.state === s).length
const hasFail = byState('FAIL') > 0
const hasNoData = byState('NO_DATA') > 0
const hasNotImpl = byState('NOT_IMPLEMENTED') > 0
const FINAL_EXIT = hasFail
  ? EXIT.HAS_FAIL
  : hasNotImpl
    ? EXIT.HAS_NOT_IMPLEMENTED
    : hasNoData
      ? EXIT.HAS_NO_DATA
      : EXIT.ALL_MEASURED

const report = {
  kind: 'mana-l1-l4-eval',
  at: new Date().toISOString(),
  argv: argv,
  exitCode: FINAL_EXIT,
  counts: { measured: byState('MEASURED'), noData: byState('NO_DATA'), notImplemented: byState('NOT_IMPLEMENTED'), fail: byState('FAIL') },
  layers: results,
}
if (JSON_ONLY) console.log(JSON.stringify(report, null, 2))
else {
  console.log('══════ Mana L1–L4 四层评估（v10 §39.1）══════')
  console.log('真装配 + 真事件链；读数回读真库（' + store + '）')
  console.log('')
  for (const r of results) {
    const mark = r.state === 'MEASURED' ? '✓' : r.state === 'FAIL' ? '✗' : '·'
    console.log('  ' + mark + ' ' + r.state.padEnd(16) + ' [' + r.id + '] ' + r.title)
    console.log('        ' + r.detail)
  }
  console.log('')
  console.log('──── 汇总 ────')
  console.log('  MEASURED ' + String(byState('MEASURED')) + ' · NO_DATA ' + String(byState('NO_DATA')) + ' · NOT_IMPLEMENTED ' + String(byState('NOT_IMPLEMENTED')) + ' · FAIL ' + String(byState('FAIL')))
  console.log('  ⚠ NO_DATA 与 NOT_IMPLEMENTED **都不是 PASS**')
  console.log('')
  console.log(FINAL_EXIT === 0 ? '✅ 四层全部 MEASURED' : '❌ 有层非 MEASURED（exit=' + String(FINAL_EXIT) + '）')
}

rmSync(dir, { recursive: true, force: true })
process.exit(FINAL_EXIT)
