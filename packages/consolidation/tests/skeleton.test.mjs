/**
 * `mana-consolidation` 骨架判据（P1 · R2 订正）。
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
 * ── B4.1（S16 席）对本文件的处置：**改期望值 + 补牙，不改判据形态** ──────────────────
 * · 判据①：期望值 `'skeleton'` → `'active'`，**理由与取证见 `docs/handoff/S16.md` §回归自检**；
 *   同时在同一条用例里补了"反方向"的牙（自称 active ⇒ 服务面必须有实现成员）。
 * · 判据⑦⑧：**一字未动**（⑦ 数 effect 恰好 3 条、⑧ 的 ① 段断言空转 0 行）。
 *   B4.1 的交付不含监听器/定时器，故 ⑦ 天然仍成立；⑧ 的 ① 段在 ⑧ 的 **② 段之后**仍成立
 *   （② 段是 S16 **追加**的：显式巩固一次 ⇒ 只有 production_rules 多一行，mana_trace 仍 0）。
 * · 用例数仍为 **8**（无删减；verify.mjs 侧已扩为清单式，见该文件）。
 *
 * 运行（**显式路径**）：node --test packages/consolidation/tests/skeleton.test.mjs
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
  const mod = await load('consolidation')
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

test('① behavior 由运行时服务面机检（B4.1 起期望值 = active，见改值理由）+ 反方向补牙', async () => {
  ran += 1
  // ── 本用例的期望值由 S16 席（B4.1）从 'skeleton' 改为 'active'。**改的是期望值，不是判据形态**：
  //    先改实现 ⇒ 本用例按设计报红（实跑复现：`本包尚无行为 ⇒ behavior 必须为 'skeleton'，实测 active`），
  //    再由实现事实把期望值改成 'active'。处置理由与反方向补牙见下，以及 docs/handoff/S16.md §回归自检。
  const { ctx, mod } = await mount()
  const svc = ctx.get('mana-consolidation')
  assert.ok(svc, 'mana-consolidation 服务必须可读（未 provide = 插件没真跑起来）')
  const st = svc.status()
  assert.equal(st.behavior, 'active', `B4.1 已填实现（合并 + chunking）⇒ behavior 必须为 'active'，实测 ${st.behavior}`)
  assert.equal(st.wired, true)
  assert.equal(typeof st.behavior, 'string', 'behavior 不得为 undefined（undefined 会被 JSON 静默丢键）')

  // ⚠ **反方向补牙**（S16 补，不替代 ⑦⑧）：文件头自认的反向「填了真行为却把 behavior 留成 'skeleton'」
  //   其实是**静态期望值**问题，真正的盲区在**另一头** —— 「自称 active 而背后无事」。
  //   这一头此前零机检。故并列断言：服务面必须真有实现成员，且实现面清单非空。
  for (const key of ['select', 'ripple', 'chunk', 'plan', 'writeRules', 'vectorRoute']) {
    assert.equal(typeof svc[key], 'function', `自称 active ⇒ 服务面必须有 ${key}()（自称 active 而背后无事 ⇒ 必红）`)
  }
  assert.ok(
    Array.isArray(mod.IMPLEMENTED_EXPORTS) && mod.IMPLEMENTED_EXPORTS.length >= 7,
    `实现面清单不得为空/被挖空；实测 ${JSON.stringify(mod.IMPLEMENTED_EXPORTS)}`,
  )
  assert.equal(mod.Config, undefined, '本包仍不导出 Config（阈值走 params 常量，不进配置面）')
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
  assert.ok(ctx.get('mana-consolidation'), 'config 不得影响服务提供')
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

test('⑦ effect 面精确计数：本包仍是空壳（多一条行为即红 ⇒ 强制交代）', async () => {
  ran += 1
  // R2b 新增：把"本包仍是空壳"从 `behavior` 常量自称，升级为**可证事实**。
  // 空壳的可观察面恰好三项：service effect / ctx.provide / ctx.on('agent/pre-step')。
  // 任何真行为（真写行路径、业务事件监听、定时器）都会改变该集合 ⇒ 本判据必红。
  const { fiber } = await mount()
  const labels = (fiber.getEffects() ?? []).map((e) => String(e.label)).sort()
  assert.equal(
    labels.length,
    3,
    `空壳的 effect 面必须恰好 3 条；实测 ${labels.length}：${JSON.stringify(labels)}。` +
      '若这是新增的真行为 ⇒ 须同步把 status().behavior 改为 \'active\' 并补 R 形态反证判据',
  )
  assert.ok(labels.some((l) => l.includes(': service')), `须含 service effect；实测 ${JSON.stringify(labels)}`)
  assert.ok(labels.some((l) => l.includes('ctx.provide(')), `须 provide 服务；实测 ${JSON.stringify(labels)}`)
  assert.ok(labels.some((l) => l.includes('agent/pre-step')), `须注册 pre-step 监听器；实测 ${JSON.stringify(labels)}`)
})

test('⑧ 行为面缺席：本包不写任何 mana_trace 行（与 ⑦ 互补）+ S16 补：唯一写入面恰为 production_rules', async () => {
  ran += 1
  // 与 ⑦ 互补：⑦ 查"没加东西"，⑧ 查"真没写行"。二者合起来使"空壳"成为机检事实。
  // ⚠ **S16 席在原用例之后追加了 ② 段**（原标题与 ① 段一字未动）：
  //   B4.1 之后本包不再"零写入"，而是"**唯一**写入面是 production_rules（显式调用才发生）"。
  //   若不追加这段，⑧ 会停在"空转时 0 行"的弱形态上 —— 那对"写入面四处开花"是盲的。
  //   追加使两条同时成为机检事实：① 空转 0 行（原样保留）；② 显式巩固一次 ⇒ 只多 control 表一行。
  const { ctx } = await mount()
  const core = ctx.get('mana-core')
  assert.ok(core, 'core 服务须可读')
  const tables = core.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  assert.ok(tables.includes('mana_trace'), 'mana_trace 表须存在（否则本判据平凡通过）')
  const before = core.db.prepare('SELECT count(*) c FROM mana_trace').get().c
  ctx.emit('mana/observation', {
    sessionId: 's-p1', turnId: 1, requestId: 'r-p1', at: new Date().toISOString(),
    content: 'P1 空壳行为面探针', source: 'test',
  })
  await settle(200)
  const after = core.db.prepare('SELECT count(*) c FROM mana_trace').get().c
  assert.equal(
    after, before,
    `空壳不得写任何行（实测 before=${before} after=${after}）；` +
      `若本包已有真行为 ⇒ 须改 status().behavior 并补 R 形态反证判据（"卸载后不再产生新行"）`,
  )
  assert.equal(before, 0, `本探针期间 mana_trace 应为空；实测 ${before}`)

  // ── ② 段（S16 补）：显式走一次真巩固 + 落库，断言"写入面唯一"与"行为面仍 0 行" ────────────
  const svc = ctx.get('mana-consolidation')
  assert.ok(svc, '服务须可读（否则下面的 ② 段是平凡通过）')
  const cnt = (t) => core.db.prepare(`SELECT count(*) AS c FROM ${t}`).get().c
  const TABLES = ['mana_trace', 'production_rules', 'memory_items', 'inject_log', 'jev_log']
  const plan = svc.plan({
    periodId: 'skeleton-⑧-2',
    items: [{ id: 'm1', activation: 1, vector: [1, 0] }],
    neocortex: [{ id: 'n1', vector: [1, 0] }],
    runs: [
      { id: 'r1', goalId: 'g-⑧', steps: ['a'], endedAt: '2026-09-25T00:00:01.000Z' },
      { id: 'r2', goalId: 'g-⑧', steps: ['a'], endedAt: '2026-09-25T00:00:02.000Z' },
    ],
  })
  assert.equal(plan.ripple.stats.merged, 1, '夹具：cos([1,0],[1,0])=1 ⇒ 必合并（否则本段测的不是真路径）')
  assert.equal(plan.chunking.rules.length, 1, '夹具：同序列重复 2 次 ⇒ 恰 1 条规则')
  // ⚠ 变量名不得与上面 ① 段的 `before`/`after`（mana_trace 行数）重名 —— 重名会 ESM 编译期报
  //   `Identifier 'before' has already been declared`，而 node --test 把它报成整个文件失败
  //   （`# tests 1 / fail 1`，指不到真因）。本席实跑踩过一次，故用 `countsBefore`/`countsAfter`。
  const countsBefore = Object.fromEntries(TABLES.map((t) => [t, cnt(t)]))
  const written = svc.writeRules(plan.chunking.rules)
  assert.equal(written.inserted.length, 1, `显式落库必须真的插入 1 行；实测 ${JSON.stringify(written)}`)
  assert.deepEqual(written.failures, [], '不得有写失败')
  const countsAfter = Object.fromEntries(TABLES.map((t) => [t, cnt(t)]))
  assert.equal(
    countsAfter.production_rules,
    countsBefore.production_rules + 1,
    `唯一写入面须生效（production_rules +1）；实测 ${countsBefore.production_rules} → ${countsAfter.production_rules}`,
  )
  for (const t of ['mana_trace', 'memory_items', 'inject_log', 'jev_log']) {
    assert.equal(
      countsAfter[t],
      countsBefore[t],
      `${t} 必须一行不动（写入面只许是 production_rules）；实测 ${countsBefore[t]} → ${countsAfter[t]}`,
    )
  }
  assert.equal(countsAfter.mana_trace, 0, '走完整条巩固路径仍不得写 mana_trace（"行为面缺席"在 B4.1 后仍成立）')
})

test('⑥ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
