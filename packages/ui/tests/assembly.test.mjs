/**
 * `dsh-mana-ui` 的**真装配证据**（走 cordis Loader 的**包名解析**通道）。
 *
 * ⚠ **为什么这条不能由既有 13 例顶替**：`tests/ui.test.mjs` 的 `mountStack()` 是
 *   `ctx.plugin(await import('../../ui/src/index.ts'))` —— 它证明的是「源码函数跑得通」，
 *   证明不了「宿主按**包名**能从盘上找到并装上这个包」。
 *   两者是不同面：前者管逻辑，后者管**可装配性**（`exports`/`main`/`lib` 产物齐不齐、
 *   入口是否 ESM 正确、`inject` 是否在真装配序下满足）。本仓的形态叫 G11：装配清单 ≠ 生效。
 *
 * 口径与 `tools/r0-assembly-check.mjs`（另一席写面）**逐条对齐**：
 *   · baseUrl 指向**本仓工作区**（`node_modules/dsh-mana-* → packages/*`），不指向任何 profile；
 *   · 装配计数 = `ctx.get(服务名)` 可读的真包数（**不以 `loader.create` 返回成功为判据**——
 *     该调用立即返回字符串 id，真加载是异步的，只看它必然假绿）；
 *   · 反证：逐个 `loader.remove(entryId)` 后装配计数必须归零、服务必须不可读。
 *
 * 红线自答：本文件**不碰** `~/.dsh/profiles/**`（baseUrl 是本仓）、不碰 `packages/core/**`
 *   （只读地把它装进临时 Context，配置指向临时目录的库）、不碰 `tools/**`、不碰 `docs/contract/**`。
 */
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 宿主 checkout（与既有 `SLOTS_MOD` 同一条路径口径：本仓测试已依赖宿主自带模块）。 */
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
/** 仓库根：`packages/ui/tests/` 往上**三层**（少退一层会解析不到包 —— 本仓踩过的坑）。 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** 装载序：core 必须最先（ui `inject = ['mana-core']`，否则停在 waiting）。 */
const PKGS = [
  ['dsh-mana-core', 'mana-core'],
  ['dsh-mana-ui', 'mana-ui'],
]

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms))

let ctx
let store
let DB

/** 装配计数 = 当前**真可读**的服务数（不是"调用过"的数）。 */
const assemblyCount = () => PKGS.filter(([, svc]) => Boolean(ctx.get(svc))).length

before(async () => {
  assert.ok(
    existsSync(join(REPO, 'node_modules', 'dsh-mana-ui')),
    `仓内缺 dsh-mana-ui 链接 ⇒ 无法走包名解析（REPO=${REPO}）`,
  )
  // 前置显式化：宿主 checkout / Loader 缺失要报「缺什么」，而不是抛一个指不到真因的
  // ERR_MODULE_NOT_FOUND（本仓纪律：失败必须可观测、成因可读）。
  for (const rel of ['cordis/lib/index.js', 'cordis-plugin-loader/lib/index.js']) {
    assert.ok(existsSync(join(DSH, rel)), `宿主缺 ${rel}（DSH=${DSH}）⇒ 本判据无可信运行环境`)
  }
  const { Context } = await import(`${DSH}/cordis/lib/index.js`)
  const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default
  const BASE_URL = pathToFileURL(REPO).href + '/'

  store = mkdtempSync(join(tmpdir(), 'mana-ui-asm-'))
  DB = join(store, 'mana.db')
  ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(250)
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: DB } })
  await settle(250)
})

after(() => {
  try { ctx?.get('mana-core')?.db?.close?.() } catch { /* 已关：卸载即净的正常形态 */ }
  if (store) rmSync(store, { recursive: true, force: true })
})

test('装配① 正向前置：ui **未装配**时服务必须不可读（否则判据平凡通过）', () => {
  assert.ok(ctx.get('mana-core'), 'core 必须先装上（否则后续判据测的不是 ui）')
  assert.equal(ctx.get('mana-ui'), undefined, 'ui 尚未 create，服务却已可读 ⇒ 判据平凡通过（G11）')
  assert.equal(assemblyCount(), 1, `前置装配计数须为 1，实测 ${assemblyCount()}`)
})

test('装配② ui 经 Loader 按包名解析并 provide mana-ui（装配计数 1 → 2）', async () => {
  await ctx.loader.create({ name: 'dsh-mana-ui', config: {} })
  await settle(300)
  const svc = ctx.get('mana-ui')
  assert.ok(svc, '装配计数判据=服务可读：mana-ui 读不到 ⇒ 没真装上（源码能跑不等于装得上）')
  assert.equal(svc.plugin, 'mana-ui')
  assert.deepEqual(
    [...svc.methods].sort(),
    ['mana-ui/channel', 'mana-ui/meta', 'mana-ui/panels', 'mana-ui/render', 'mana-ui/replay'],
  )
  assert.equal(svc.status().wired, true)
  assert.equal(assemblyCount(), 2, `装配计数须为 2，实测 ${assemblyCount()}`)
})

test('装配③ 反证（卸载即净）：逐个 remove entry 后装配计数归零、服务不可读', async () => {
  const targets = [...ctx.loader.entries()]
    .map((e) => ({ id: e.id, name: e.options?.name }))
    .filter((e) => PKGS.some(([p]) => p === e.name))
  assert.equal(targets.length, 2, `loader 台账里应能按包名找到 2 个 entry，实测 ${targets.length}`)
  for (const t of targets) ctx.loader.remove(t.id)
  await settle(400)
  assert.equal(assemblyCount(), 0, `卸载后装配计数必须归零，实测 ${assemblyCount()}`)
  assert.equal(ctx.get('mana-ui'), undefined, '卸载后 mana-ui 必须不可读（残留 = 卸载没真做）')
})
