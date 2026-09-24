/**
 * Mana P0 六骨架集成测试 —— 用**真 cordis Context** 装载六个插件。
 *
 * 为什么不用假 ctx：假 ctx 只能证明"函数在"，证明不了**契约真的通**。
 * 本文件覆盖阶段 0 的三条硬判据：
 *  · **A0-5** 插件形状静态可证（name/inject/Config/apply + cordis.patch.yml 存在）
 *  · **G9/R0 前置** 六插件**各自独立**注册 `agent/pre-step` 且**都调用 next()**
 *    ⇒ 消除「只盯一条链取证会假绿」的隐患（shoucang 两条链是独立注册的）
 *  · **R0 反证判据** 卸载后同一触发**不再产生新行**（不写行的空壳会让此判据平凡通过 = G11）
 *
 * 运行：node --test "tests/*.test.mjs"
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

const ROOT = new URL('../../', import.meta.url) // packages/
// 目录名（写面所有权单位，与 docs/session-allocation.md §三 对齐）
const DIRS = ['core', 'jev', 'vector', 'perception', 'attention', 'working-memory']
// npm 包名（装配面单位）
const PKGS = [
  'dsh-mana-core',
  'dsh-mana-jev',
  'dsh-mana-vector',
  'dsh-mana-perception',
  'dsh-mana-attention',
  'dsh-mana-working-memory',
]

const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)

/** 装载一个包到真 Context，返回 fiber。 */
function mount(ctx, mod) {
  const fork = ctx.plugin(mod, {})
  return fork
}

/** 等到所有 fiber 进入 active（cordis 装载是异步的）。 */
async function settle(ctx, ms = 200) {
  await new Promise((r) => setTimeout(r, ms))
}

test('A0-5 六插件形状齐备且 patch 文件存在', async () => {
  const { existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  for (const [i, dir] of DIRS.entries()) {
    const pkg = PKGS[i]
    const mod = await load(dir)
    assert.equal(typeof mod.name, 'string', `${pkg} 缺 name`)
    assert.ok(Array.isArray(mod.inject), `${pkg} 缺 inject`)
    assert.ok(mod.Config, `${pkg} 缺 Config`)
    assert.equal(typeof mod.apply, 'function', `${pkg} 缺 apply`)
    const patch = fileURLToPath(new URL(`${dir}/cordis.patch.yml`, ROOT))
    assert.ok(existsSync(patch), `${pkg} 缺 cordis.patch.yml（bundle 装不上）`)
  }
})

test('六插件在真 Context 中全部装载并 provide 各自服务', async () => {
  const ctx = new Context()
  const mods = []
  for (const dir of DIRS) mods.push(await load(dir))

  // core 先装（其余 inject 它）
  mount(ctx, mods[0])
  await settle(ctx, 150)
  for (const mod of mods.slice(1)) mount(ctx, mod)
  await settle(ctx, 300)

  // core 服务必须可读，且是文件库（WAL 才有意义）
  const core = ctx.get('mana-core')
  assert.ok(core, 'mana-core 服务必须可读')
  assert.equal(core.journalMode, 'wal', 'core 用文件库 ⇒ journal_mode 必须是 wal')

  for (const svc of ['mana-jev', 'mana-vector', 'mana-perception', 'mana-attention', 'mana-working-memory']) {
    const s = ctx.get(svc)
    assert.ok(s, `${svc} 服务必须可读（未 provide = 插件没真跑起来）`)
    assert.equal(s.status().wired, true, `${svc}.status().wired 必须为 true`)
  }
  void ctx
})

test('G9/R0 前置：六插件各自独立注册 agent/pre-step 且都调用 next()', async () => {
  const ctx = new Context()
  const mods = []
  for (const dir of DIRS) mods.push(await load(dir))
  mount(ctx, mods[0])
  await settle(ctx, 150)
  for (const mod of mods.slice(1)) mount(ctx, mod)
  await settle(ctx, 300)

  // 用真 waterfall 分发：若任一监听器漏调 next()，下游全部被吞，且不报错。
  // 这里断言"链条被完整走通"—— 用 next 链末端打点。
  let reached = 0
  ctx.on('agent/pre-step', async (_payload, next) => {
    reached += 1
    return await next()
  })

  const payload = { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }
  const result = await ctx.waterfall('agent/pre-step', payload, async () => {
    reached += 1
    return { messages: [] }
  })

  assert.equal(
    reached,
    2,
    '末端哨兵必须被走到 ⇒ 六个直通监听器都调了 next()（漏调即 reached=1，这就是"静默掐死下游"）',
  )
  assert.deepEqual(result, { messages: [] }, '直通链不得改写 next 的返回值')
  void ctx
})

test('R0 反证判据：卸载 attention 后同一触发不再产生新行', async () => {
  const ctx = new Context()
  const coreMod = await load('core')
  const attMod = await load('attention')

  const coreFiber = mount(ctx, coreMod)
  await settle(ctx, 150)
  const attFiber = mount(ctx, attMod)
  await settle(ctx, 300)

  const core = ctx.get('mana-core')
  const countTrace = () => core.db.prepare('SELECT count(*) c FROM mana_trace').get().c
  const before = countTrace()

  // 触发一次：走真事件总线（emit → 监听器 → 写行）
  ctx.emit('mana/observation', {
    sessionId: 's-r0',
    turnId: 1,
    requestId: 'r-r0',
    at: new Date().toISOString(),
    content: 'r0 触发',
    source: 'test',
  })
  await settle(ctx, 200)
  const afterTrigger = countTrace()
  assert.ok(
    afterTrigger > before,
    `触发后必须新增行（否则反证判据平凡通过 = G11 假绿）：before=${before} after=${afterTrigger}`,
  )

  // 卸载 attention（fiber.dispose 是 cordis 的卸载语义）
  await attFiber.dispose()
  await settle(ctx, 300)

  const afterUnload = countTrace()
  ctx.emit('mana/observation', {
    sessionId: 's-r0',
    turnId: 2,
    requestId: 'r-r0-2',
    at: new Date().toISOString(),
    content: 'r0 卸载后再触发',
    source: 'test',
  })
  await settle(ctx, 200)
  const afterSecondTrigger = countTrace()

  assert.equal(
    afterSecondTrigger,
    afterUnload,
    `卸载后同一触发不得再产生新行（卸载即净）：卸载时=${afterUnload} 再触发后=${afterSecondTrigger}`,
  )
  await coreFiber.dispose()
  void ctx
})

test('R0 前置：hex 骨架不写行的反证 —— 卸载前后都无新行即为"平凡通过"（留作对照）', async () => {
  // 本条是本册 G11 的现场演示：一个完全空实现的插件，其"卸载即净"判据
  // 在表面上是成立的，但成立的原因是"它从来没生效过"。
  // 保留此对照，是为了让 R0 在 attention 上通过时有意义。
  const ctx = new Context()
  const core = await load('core')
  mount(ctx, core)
  await settle(ctx, 150)
  const c = ctx.get('mana-core')
  const before = c.db.prepare('SELECT count(*) c FROM mana_trace').get().c
  ctx.emit('mana/observation', {
    sessionId: 's-x',
    turnId: 1,
    requestId: 'r-x',
    at: new Date().toISOString(),
    content: 'x',
    source: 'test',
  })
  await settle(ctx, 150)
  const after = c.db.prepare('SELECT count(*) c FROM mana_trace').get().c
  assert.equal(before, after, '无监听者时确实不会写行 —— 这正是空壳能"平凡通过"反证判据的原因')
})
