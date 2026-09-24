/**
 * `dsh-mana-user-model` 的**宿主解析面**证据（走 cordis Loader 的**包名解析**通道）。
 *
 * ⚠ **为什么这条不能由 `tests/skeleton.test.mjs` 的 8 条顶替**（本轮 D2 红）：
 *   `skeleton.test.mjs:14` 是 `import(new URL('../src/index.ts', …))` —— 它证明的是
 *   **源码函数跑得通**；而宿主（与 `tools/r0-assembly-check.mjs:69` 同一条链）按
 *   **包名**解析 ⇒ 走 `package.json#main` = `./lib/index.js`。
 *   两者是**不同面**。独立复核实测：`src 已修 + lib 陈旧` 时，
 *   `npm test` 全绿而宿主仍读到旧行为 ⇒ **夹具绿 ≠ 宿主绿**。
 *   形态与本仓 `packages/ui/tests/assembly.test.mjs`（另一席已立的同款腿）逐条对齐。
 *
 * ⚠ 这条腿**不替代** `skeleton.test.mjs`（那 8 条断言的是逻辑与声明，源码面更细）；
 *   本腿只补一件事：**宿主真加载的那份产物**上，契约行为也得对。
 *
 * 口径（与 `tools/r0-assembly-check.mjs` 对齐）：
 *   · baseUrl 指向**本仓工作区**（`node_modules/dsh-mana-* → packages/*`），不指向任何 profile；
 *   · 判据 = `ctx.get(服务名)` **可读**（`loader.create` 立即返回 id、真加载是异步的，只看它必假绿）；
 *   · 反证：`loader.remove(entryId)` 后服务必须不可读。
 *
 * 红线自答：本文件**不碰** `~/.dsh/profiles/**`（baseUrl 是本仓）、不写 `packages/core/**`
 *   （只把它装进临时 Context，库指向临时目录）、不碰 `tools/**`、不碰 `docs/contract/**`。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 宿主 checkout（与 `packages/ui/tests/assembly.test.mjs` 同一条路径口径）。 */
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
/** 仓库根：`packages/user-model/tests/` 往上**三层**（少退一层会解析不到包）。 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** 装载序：core 最先（两包 `inject = ['mana-core']`，否则停在 waiting）。 */
const PKGS = [
  ['dsh-mana-core', 'mana-core'],
  ['dsh-mana-user-model', 'mana-user-model'],
]

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms))

let ctx
let store

const assemblyCount = () => PKGS.filter(([, svc]) => Boolean(ctx.get(svc))).length

before(async () => {
  assert.ok(
    existsSync(join(REPO, 'node_modules', 'dsh-mana-user-model')),
    `仓内缺 dsh-mana-user-model 链接 ⇒ 无法走包名解析（REPO=${REPO}）`,
  )
  // 前置显式化：宿主 checkout / Loader 缺失要报「缺什么」，而不是抛一个指不到真因的
  // ERR_MODULE_NOT_FOUND（本仓纪律：失败必须可观测、成因可读）。
  for (const rel of ['cordis/lib/index.js', 'cordis-plugin-loader/lib/index.js']) {
    assert.ok(existsSync(join(DSH, rel)), `宿主缺 ${rel}（DSH=${DSH}）⇒ 本判据无可信运行环境`)
  }
  const { Context } = await import(`${DSH}/cordis/lib/index.js`)
  const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default
  const BASE_URL = pathToFileURL(REPO).href + '/'

  store = mkdtempSync(join(tmpdir(), 'mana-um-asm-'))
  ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(250)
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: join(store, 'mana.db') } })
  await settle(250)
})

after(() => {
  try { ctx?.get('mana-core')?.db?.close?.() } catch { /* 已关：卸载即净的正常形态 */ }
  if (store) rmSync(store, { recursive: true, force: true })
})

test('宿主装配① 前置：user-model **未装配**时服务必须不可读（否则判据平凡通过）', () => {
  assert.ok(ctx.get('mana-core'), 'core 必须先装上（否则后续判据测的不是 user-model）')
  assert.equal(ctx.get('mana-user-model'), undefined, '未 create 却已可读 ⇒ 判据平凡通过（G11）')
  assert.equal(assemblyCount(), 1, `前置装配计数须为 1，实测 ${assemblyCount()}`)
})

test('宿主装配② 按包名解析成功（装配计数 1 → 2，判据=服务可读）', async () => {
  await ctx.loader.create({ name: 'dsh-mana-user-model', config: {} })
  await settle(300)
  const svc = ctx.get('mana-user-model')
  assert.ok(svc, '装配计数判据=服务可读：读不到 ⇒ 没真装上（源码能跑不等于装得上）')
  assert.equal(svc.plugin, 'mana-user-model')
  assert.equal(svc.status().wired, true)
  assert.equal(assemblyCount(), 2, `装配计数须为 2，实测 ${assemblyCount()}`)
})

test('宿主装配③ **宿主真加载的那份产物**上，未校准态必须是 null（D2 的落点）', () => {
  // 这是本文件存在的理由。`skeleton.test.mjs` 读 `src/`（源码面），宿主读 `lib/`（产物面）；
  // 两者不同步时**只有本条会红** —— 已用「src 已修 + lib 陈旧」的副本实证（红→重建后绿）。
  const svc = ctx.get('mana-user-model')
  assert.ok(svc, '上一条未通过 ⇒ 本条无从判起（先修装配）')
  const p = svc.status().precisionTarget
  assert.equal(
    p,
    null,
    `宿主按包名解析读到 precisionTarget=${String(p)}（期望 null）⇒ src 与 lib 不同步，`
      + '即"夹具绿 ≠ 宿主绿"。修法：npm run build --workspace dsh-mana-user-model',
  )
})

test('宿主装配④ 反证（卸载即净）：remove entry 后装配计数归零、服务不可读', async () => {
  const targets = [...ctx.loader.entries()]
    .map((e) => ({ id: e.id, name: e.options?.name }))
    .filter((e) => PKGS.some(([p]) => p === e.name))
  assert.equal(targets.length, 2, `loader 台账里应能按包名找到 2 个 entry，实测 ${targets.length}`)
  for (const t of targets) ctx.loader.remove(t.id)
  await settle(400)
  assert.equal(assemblyCount(), 0, `卸载后装配计数必须归零，实测 ${assemblyCount()}`)
  assert.equal(ctx.get('mana-user-model'), undefined, '卸载后服务必须不可读（残留 = 卸载没真做）')
})
