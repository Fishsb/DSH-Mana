/**
 * `mana-long-term` 骨架判据（P1 · R2 订正）。
 *
 * 六条里有**三条是被独立复核抓出的缺陷的回填**（见 `docs/handoff/S3.md` §R2 追加节）：
 *   ① `behavior` 必须**读运行时服务面**断言 —— 不是 grep 源码里有这个字符串（注释级证据）；
 *   ② G9 义务必须**证明本包真在 `agent/pre-step` 链上** —— 只数"哨兵被走到"**不够**：
 *      实测哨兵=1 只说明**链没断**，本包若压根没注册监听器，哨兵照样是 1（假绿，见 §R2 的 N3）；
 *      故用 `fiber.getEffects()`（cordis **公开 API**）读 effect 标签，并**卸载后必须消失**；
 *   ③ 本包**不得导出 `Config`** —— 已删除的假旋钮不得回流。
 *
 * ⚠ **本文件的用例数本身也是判据**：实测**空文件**在显式路径下同样报
 *   `# tests 1 / # pass 1 / exit 0`（计的是"文件加载成功"）⇒ 空/被截断的文件是**假绿**。
 *   故本文件固定 **8 条**，末条为用例计数自检（少一条即红）；外部核验请断言
 *   `# tests 8` **相等**，而不是 `> 0`。
 *
 * 运行（**显式路径**）：node --test packages/long-term/tests/skeleton.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const payload = () => ({ agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal })
const EXPECTED_CASES = 8
let ran = 0

async function mount(withConfig) {
  const ctx = new Context()
  const core = await load('core')
  const mod = await load('long-term')
  ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-p1-')), 'mana.db') })
  await settle(200)
  const fiber = withConfig === undefined ? ctx.plugin(mod) : ctx.plugin(mod, withConfig)
  await settle(300)
  return { ctx, mod, fiber }
}

/**
 * 走一次真 waterfall，返回链尾哨兵与最内层各走了几次。
 *
 * 计数学义（本席实测定案，纠正了本人上一轮的错断言）：哨兵是链尾观察者，
 * 它**整条链只执行一次** ⇒ `sentinel` 恒为 **1**（链完好）= 证明"它前面每一条都调了 next()"；
 * 任一监听器漏调 next() ⇒ 哨兵**一次也不走** ⇒ 0。`sentinel` 无法区分"链上有几条"。
 */
async function probeChain(ctx) {
  let sentinel = 0
  let inner = 0
  ctx.on('agent/pre-step', async (_p, next) => { sentinel += 1; return await next() })
  const r = await ctx.waterfall('agent/pre-step', payload(), async () => { inner += 1; return { messages: [] } })
  return { sentinel, inner, r }
}

test('① behavior 由运行时服务面机检（填了实现在忘改 ⇒ 必红）+ 反方向补牙', async () => {
  ran += 1
  const { ctx, mod } = await mount()
  const svc = ctx.get('mana-long-term')
  assert.ok(svc, 'mana-long-term 服务必须可读（未 provide = 插件没真跑起来）')
  const st = svc.status()
  // ── B3.1（S14 席）：本包已填实现（ACT-R 激活方程 + 时间衰减），故期望值由 'skeleton' 改 'active'。
  //    这条判据**按设计红了**（它抓的就是「填了实现而忘记交代」）—— 本席是被它叫醒的，不是绕过它。
  assert.equal(st.behavior, 'active', `B3.1 已填实现 ⇒ behavior 必须为 'active'，实测 ${st.behavior}`)
  assert.equal(st.wired, true)
  assert.equal(typeof st.behavior, 'string', 'behavior 不得为 undefined（undefined 会被 JSON 静默丢键）')
  /**
   * ── **反方向补牙**（B3.1 新增 · 对文件头「反向不可机检」那条残留盲区的部分修复）──
   * 原文承认：「填了真行为却把 behavior 留成 'skeleton' ⇒ 判据必红」**原句是空的**，
   * 反向（自称 'active' 而背后无事）**无判据**。上面改成 'active' 之后，这个盲区就正对着本判据。
   * 故此处并列断言 **'active' 必须有实现面背书**：服务面可读、7 个实现导出逐个是函数。
   * ⇒ 若有人把实现搬走/改名/挖空而 behavior 仍写 'active'，本判据**报红**。
   * ⚠ **仍未覆盖**（如实记，不许读成已全覆盖）：实现**还在**、behavior 却手写回 'skeleton'
   *   —— 那一条仍然只靠下面 ⑦⑧ 间接抓，本补牙没有解决它。
   */
  const A = svc.activation
  assert.ok(A && typeof A === 'object', 'behavior=active 必须有实现面背书：service.activation 不得缺席')
  const face = ['decay', 'baseLevel', 'associativeActivation', 'activation', 'noiseTerm', 'retrievalProbability', 'latencyMs']
  for (const n of face) {
    assert.equal(typeof A[n], 'function', `behavior=active 必须有实现面背书：service.activation.${n} 必须是函数`)
  }
  assert.ok(
    Array.isArray(mod.IMPLEMENTED_EXPORTS) && mod.IMPLEMENTED_EXPORTS.length === face.length,
    '实现面清单 IMPLEMENTED_EXPORTS 必须与上面逐名对照的集合等长（防「清单少列一项即恒绿」）',
  )
})

test('② 本包真在 agent/pre-step 链上：effect 面出现监听器 + 卸载后消失', async () => {
  ran += 1
  const { ctx, fiber } = await mount()
  const labels = (fiber.getEffects() ?? []).map((e) => String(e.label))
  assert.ok(
    labels.some((l) => l.includes('agent/pre-step')),
    `本包必须注册 pre-step 监听器（G9 / 册:318）；实测 effect 标签 = ${JSON.stringify(labels)}`,
  )
  await fiber.dispose()
  await settle(300)
  const after = (fiber.getEffects() ?? []).map((e) => String(e.label))
  assert.ok(
    !after.some((l) => l.includes('agent/pre-step')),
    `卸载后监听器必须随 fiber 释放（"卸载即净"）；实测 = ${JSON.stringify(after)}`,
  )
  void ctx
})

test('③ 链完整性：哨兵与最内层各走一次（漏调 next() ⇒ 哨兵 0）', async () => {
  ran += 1
  const { ctx } = await mount()
  const probe = await probeChain(ctx)
  assert.equal(probe.sentinel, 1, `链完好 ⇒ 链尾哨兵整条链执行一次；实测 ${probe.sentinel}（0 = 有监听器漏调 next()）`)
  assert.equal(probe.inner, 1, '最内层 next 必须被走到（链未断）')
  assert.deepEqual(probe.r, { messages: [] }, '直通链不得改写 next 的返回值')
})

test('④ 传 {enabled:false} 不得关掉 G9 义务（本包无 Config，该键必须被无视）', async () => {
  ran += 1
  // 刻意传一个"看起来像关闭开关"的 config：它必须被无视，而不是被静默当成开关
  // —— 后者会造出"一枚配置即可取消 next() 纪律"的静默通道。
  const { ctx, fiber } = await mount({ enabled: false })
  assert.ok(ctx.get('mana-long-term'), 'config 不得影响服务提供')
  const labels = (fiber.getEffects() ?? []).map((e) => String(e.label))
  assert.ok(
    labels.some((l) => l.includes('agent/pre-step')),
    `{enabled:false} 下 pre-step 监听器仍必须注册；实测 = ${JSON.stringify(labels)}`,
  )
  const probe = await probeChain(ctx)
  assert.equal(probe.sentinel, 1, `{enabled:false} 下链仍须完好；实测哨兵 = ${probe.sentinel}`)
})

test('⑤ 不得导出 Config（假旋钮不得回流）', async () => {
  ran += 1
  const { mod } = await mount()
  assert.equal(
    mod.Config,
    undefined,
    '本包不导出 Config：若确需新增配置，必须同时补一条"该配置改变了可观测行为"的判据，' +
      '否则即回到 R2 抓到的"声明了但零消费"缺陷',
  )
})

/**
 * ⑦ effect 面精确计数 —— **W1-3 由 3 → 4，口径与理由（本批交代）**
 *
 * 本判据的设计意图是「**多一条行为即红 ⇒ 强制交代**」，不是"永久锁死 3 条"。
 * W1-3 给本包加上了**第一条真写行为**（`mana/observation` → Write Gate → `memory_items`），
 * 它**按设计红了**（这正是本判据存在的意义），故本批**同步改写口径而不是删判据**。
 *
 * ⚠ **为什么仍要逐条点名三个旧标签**：只断言"数量 == 4"的话，「删掉 `agent/pre-step` 那条
 *   （G9 结构义务）来给新监听器腾位置」也会**绿** —— 那是"拆东墙补西墙"的形态。
 *   逐条点名 ⇒ 少任何一条旧的都红。
 *
 * ⚠ **数量 4 的口径**：`ctx.on` 在 cordis 里**自带一条 effect**（本批实测：
 *   `fiber.getEffects()` 里就是 `ctx.on("mana/observation")`），故新监听器 +1 而不是 +2；
 *   本批**没有**额外 `ctx.effect` 包裹它。
 */
test('⑦ effect 面精确计数：本包仍拒绝未交代的行为（多一条行为即红 ⇒ 强制交代）', async () => {
  ran += 1
  // W1-3：本包已有一条真写行为 ⇒ 期望值由 3 改 4（旧标签逐条点名，见上）。
  const { fiber } = await mount()
  const labels = (fiber.getEffects() ?? []).map((e) => String(e.label)).sort()
  assert.equal(
    labels.length,
    4,
    `本包的 effect 面必须恰好 4 条（W1-3 起：空壳三项 + Write Gate 监听器）；` +
      `实测 ${labels.length}：${JSON.stringify(labels)}。` +
      '再有新增的真行为 ⇒ 本判据必红，须同步交代（改口径 + 补 R 形态反证判据），不得直接放宽数量',
  )
  // ── 三个旧标签逐条点名（防"删旧行为给新行为腾位置"）────────────────────────
  assert.ok(labels.some((l) => l.includes(': service')), `须含 service effect；实测 ${JSON.stringify(labels)}`)
  assert.ok(labels.some((l) => l.includes('ctx.provide(')), `须 provide 服务；实测 ${JSON.stringify(labels)}`)
  assert.ok(labels.some((l) => l.includes('agent/pre-step')), `G9 义务：须注册 pre-step 监听器；实测 ${JSON.stringify(labels)}`)
  // ── 新增的那一条单独点名（它才是 W1-3 的行为面）────────────────────────────
  assert.ok(
    labels.some((l) => l.includes('mana/observation')),
    `W1-3 起本包须注册 mana/observation 监听器（写入路径的触发点）；实测 ${JSON.stringify(labels)}`,
  )
})

test('⑧ 行为面缺席：本包不写任何 mana_trace 行（与 ⑦ 互补）', async () => {
  ran += 1
  /**
   * ⚠ **W1-3 改写（原判据：`ctx.emit('mana/observation') ⇒ mana_trace 增量 0`）**。
   *
   * 原判据在 W1-3 之后会变成**假绿**：它用的探针串 `'P1 空壳行为面探针'` 与问法
   *   `WRITE_GATE_QUESTION` 的 bigram 交集为 **0** ⇒ 被 bigram 预过滤挡下 ⇒ 写门**压根没进**。
   *   于是"没有新行"成立的原因是"**这一步没发生**"，而不是"本包不写" —— 判据绿，
   *   但它想测的东西一次都没被测到（本仓最忌的形态，故本席主动改写而不是留着）。
   *
   * 新口径 = **成对两条腿**（都非平凡）：
   *   ⓐ 预过滤**未命中** ⇒ 写门未进入 ⇒ `mana_trace` / `memory_items` **双双 0 增量**；
   *   ⓑ 预过滤**命中** ⇒ 写门**真进入**（`memory_items` +1，这一腿证明 ⓐ 不是平凡通过），
   *      且 **`mana_trace` 恰好 1 行**（降级留痕），**标签必须是本包命名空间**，
   *      **不得是 S1 五类裸名之一**（否则会替真链凑数，掩盖 A1-1 的缺失）。
   *
   * ⚠ ⓑ 的 1 行是**刻意的**：本包此时无判定链 ⇒ `failureKind='no-judge-listener'` ⇒
   *   按"降级必须显式"落 1 行归因。它与 ⓐ 的 0 行合起来才说明"留痕只在真出问题时发生"。
   */
  const { ctx } = await mount()
  const core = ctx.get('mana-core')
  assert.ok(core, 'core 服务须可读')
  const tables = core.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  assert.ok(tables.includes('mana_trace'), 'mana_trace 表须存在（否则本判据平凡通过）')
  const traceCount = () => Number(core.db.prepare('SELECT count(*) c FROM mana_trace').get().c)
  const itemCount = () => Number(core.db.prepare('SELECT count(*) c FROM memory_items').get().c)
  const mod = await import(new URL('../src/write-gate.ts', import.meta.url).href)

  // ── ⓐ 预过滤未命中的串：写门不得进入（且这一点必须被断言，不能靠"恰好是 0"）
  const BLOCKED = 'P1 空壳行为面探针'
  assert.equal(
    mod.prefilterWorthKeeping(BLOCKED).hit,
    false,
    '前置：本探针串必须被预过滤挡下（否则 ⓐ 测的不是"没进入"）',
  )
  const t0 = traceCount()
  const i0 = itemCount()
  ctx.emit('mana/observation', {
    sessionId: 's-p1', turnId: 1, requestId: 'r-p1', at: new Date().toISOString(),
    content: BLOCKED, source: 'test',
  })
  await settle(250)
  assert.equal(traceCount(), t0, `ⓐ 被预过滤挡下 ⇒ mana_trace 不得新增（实测 ${traceCount() - t0} 行）`)
  assert.equal(itemCount(), i0, `ⓐ 被预过滤挡下 ⇒ memory_items 不得新增（实测 ${itemCount() - i0} 行）`)

  // ── ⓑ 预过滤命中的串：写门真进入 ⇒ ⓐ 的"0"才有意义
  const ENTERS = '这条观察值得长期记住：⑧ 探针'
  assert.equal(
    mod.prefilterWorthKeeping(ENTERS).hit,
    true,
    '前置：本探针串必须通过预过滤（否则 ⓑ 测的不是"进去了"）',
  )
  const t1 = traceCount()
  const i1 = itemCount()
  ctx.emit('mana/observation', {
    sessionId: 's-p1', turnId: 1, requestId: 'r-p1b', at: new Date().toISOString(),
    content: ENTERS, source: 'test',
  })
  await settle(350)
  // ⓑ-1 写门**真进入**了（这是 ⓐ 非平凡的证据：同一接口、只换了串就产生了行）
  assert.equal(itemCount() - i1, 1, `ⓑ 预过滤命中 ⇒ memory_items 必须真增 1 行（实测 ${itemCount() - i1}）`)
  // ⓑ-2 留痕恰 1 行，且标签在本包命名空间内（**不冒充 S1 五类**）
  const added = traceCount() - t1
  assert.equal(added, 1, `ⓑ 无判定链 ⇒ 降级留痕应恰 1 行（实测 ${added}）`)
  const rows = core.db.prepare('SELECT event_type, payload FROM mana_trace ORDER BY seq DESC LIMIT 1').all()
  assert.equal(
    rows[0].event_type,
    mod.WRITE_GATE_TRACE_EVENT,
    '留痕标签必须是本包命名空间常量：' + rows[0].event_type,
  )
  assert.ok(
    rows[0].event_type.startsWith('mana/long-term/'),
    '留痕标签必须在 mana/long-term/ 命名空间内：' + rows[0].event_type,
  )
  // ⚠ 要害：**不得**是 S1 五类裸名之一（否则会替真链凑数，掩盖 A1-1 的缺失）
  assert.ok(
    !['observation', 'attention', 'decision', 'recall', 'injection'].includes(rows[0].event_type),
    '★ 本包留痕**不得冒充 S1 五类裸名**（会掩盖 chain-e2e 的五类判据）：' + rows[0].event_type,
  )
  assert.ok(String(rows[0].payload).includes('no-judge-listener'), '归因载荷必须点名真因：' + rows[0].payload)
})

test('⑥ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
