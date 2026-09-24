/**
 * `mana-forgetting` 骨架判据（P1 · R2 订正）。
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
 * 运行（**显式路径**）：node --test packages/forgetting/tests/skeleton.test.mjs
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
  const mod = await load('forgetting')
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

test('① behavior 由运行时服务面机检（填了实现在忘改 ⇒ 必红）', async () => {
  ran += 1
  const { ctx } = await mount()
  const svc = ctx.get('mana-forgetting')
  assert.ok(svc, 'mana-forgetting 服务必须可读（未 provide = 插件没真跑起来）')
  const st = svc.status()
  assert.equal(st.behavior, 'skeleton', `本包尚无行为 ⇒ behavior 必须为 'skeleton'，实测 ${st.behavior}`)
  assert.equal(st.wired, true)
  assert.equal(typeof st.behavior, 'string', 'behavior 不得为 undefined（undefined 会被 JSON 静默丢键）')
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
  assert.ok(ctx.get('mana-forgetting'), 'config 不得影响服务提供')
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

test('⑧ 行为面缺席：本包不写任何 mana_trace 行（与 ⑦ 互补）', async () => {
  ran += 1
  // 与 ⑦ 互补：⑦ 查"没加东西"，⑧ 查"真没写行"。二者合起来使"空壳"成为机检事实。
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
})

test('⑥ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
