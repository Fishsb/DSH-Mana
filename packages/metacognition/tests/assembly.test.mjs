/**
 * `dsh-mana-metacognition` 的**宿主解析面**证据（走 cordis Loader 的**包名解析**通道）。
 *
 * ⚠ **为什么这条不能由 `tests/skeleton.test.mjs` 的 16 条顶替**（本轮 D2 红）：
 *   `skeleton.test.mjs:14` 是 `import(new URL('../src/index.ts', …))` —— 源码面；
 *   宿主按**包名**解析 ⇒ 走 `package.json#main` = `./lib/index.js` ⇒ **产物面**。
 *   独立复核实测：`src 已修 + lib 陈旧` 时 `npm test` 全绿而宿主仍读旧行为。
 *   形态与 `packages/ui/tests/assembly.test.mjs`、`packages/user-model/tests/assembly.test.mjs` 对齐。
 *
 * ⚠ 本包比 user-model 多一条**更强的**产物面断言：`./criteria` 子路径导出（`exports` 第二条）
 *   与 `threshold()` 读口都走 `lib/`。故本条同时覆盖**产物新鲜度**与**子路径导出是否真在产物里**——
 *   这两件事只有按包名/子路径解析才测得到。
 *
 * 红线自答：不碰 `~/.dsh/profiles/**`（baseUrl 是本仓）、不写 `packages/core/**`、不碰 `tools/**`。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
/** 仓库根：`packages/metacognition/tests/` 往上三层。 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** 注册表真源（本包内）——用于断言"宿主面读到的值 == 真源登记值"。 */
const REGISTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'engine', 'criteria.json')

const PKGS = [
  ['dsh-mana-core', 'mana-core'],
  ['dsh-mana-metacognition', 'mana-metacognition'],
]

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms))

let ctx
let store

const assemblyCount = () => PKGS.filter(([, svc]) => Boolean(ctx.get(svc))).length

before(async () => {
  assert.ok(
    existsSync(join(REPO, 'node_modules', 'dsh-mana-metacognition')),
    `仓内缺 dsh-mana-metacognition 链接 ⇒ 无法走包名解析（REPO=${REPO}）`,
  )
  for (const rel of ['cordis/lib/index.js', 'cordis-plugin-loader/lib/index.js']) {
    assert.ok(existsSync(join(DSH, rel)), `宿主缺 ${rel}（DSH=${DSH}）⇒ 本判据无可信运行环境`)
  }
  const { Context } = await import(`${DSH}/cordis/lib/index.js`)
  const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default
  const BASE_URL = pathToFileURL(REPO).href + '/'

  store = mkdtempSync(join(tmpdir(), 'mana-mc-asm-'))
  ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(250)
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: join(store, 'mana.db') } })
  await settle(250)
})

after(() => {
  try { ctx?.get('mana-core')?.db?.close?.() } catch { /* 已关闭属正常 */ }
  if (store) rmSync(store, { recursive: true, force: true })
})

test('宿主装配① 前置：metacognition **未装配**时服务必须不可读', () => {
  assert.ok(ctx.get('mana-core'), 'core 必须先装上')
  assert.equal(ctx.get('mana-metacognition'), undefined, '未 create 却已可读 ⇒ 判据平凡通过（G11）')
  assert.equal(assemblyCount(), 1, `前置装配计数须为 1，实测 ${assemblyCount()}`)
})

test('宿主装配② 按包名解析成功（装配计数 1 → 2）', async () => {
  await ctx.loader.create({ name: 'dsh-mana-metacognition', config: {} })
  await settle(300)
  const svc = ctx.get('mana-metacognition')
  assert.ok(svc, '装配计数判据=服务可读：读不到 ⇒ 没真装上')
  assert.equal(svc.plugin, 'mana-metacognition')
  assert.equal(svc.status().wired, true)
  assert.equal(assemblyCount(), 2, `装配计数须为 2，实测 ${assemblyCount()}`)
})

test('宿主装配③ **宿主产物**上的判据读口 == 注册表真源（D2 的落点）', () => {
  // 走宿主解析出的服务（= lib 产物）。若 lib 陈旧，这里的读数会与真源对不上。
  const svc = ctx.get('mana-metacognition')
  assert.ok(svc, '上一条未通过 ⇒ 本条无从判起')
  const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'))
  // 逐值对账（不写死数字：真源改了就跟着变，判据不会腐）
  const entries = reg.thresholds.entries.filter((e) => typeof e.value === 'number')
  assert.ok(entries.length > 0, '注册表里应有数值型登记项')
  const mismatch = entries
    .filter((e) => svc.threshold(e.id, Symbol.for('absent')) !== e.value)
    .map((e) => `${e.id}: 期望 ${e.value} / 产物面读到 ${String(svc.threshold(e.id, null))}`)
  assert.deepEqual(
    mismatch,
    [],
    `宿主产物面与注册表真源不一致（${mismatch.join('；')}）⇒ src 与 lib 不同步。`
      + '修法：npm run build --workspace dsh-mana-metacognition',
  )
  assert.equal(svc.status().criteriaVersion, reg.version, '判据版本号在产物面上必须与真源一致')
})

test('宿主装配④ 子路径导出 `./criteria` 在产物面可真解析', async () => {
  // `exports` 的第二条指向 `./lib/criteria.js`；这条只有**按包名**解析才测得到（源码面永远绿）。
  const mod = await import('dsh-mana-metacognition/criteria')
  assert.equal(typeof mod.thresholdValue, 'function', '子路径导出缺 thresholdValue（产物没建齐？）')
  assert.equal(typeof mod.splitLawOf, 'function', '子路径导出缺 splitLawOf')
  const svc = ctx.get('mana-metacognition')
  assert.equal(
    mod.thresholdValue('mcl.familiarThreshold', Symbol.for('absent')),
    svc.threshold('mcl.familiarThreshold', null),
    '子路径导出与服务面读口必须同源（否则是两份实现）',
  )
})

test('宿主装配⑤ 反证（卸载即净）：remove entry 后装配计数归零、服务不可读', async () => {
  const targets = [...ctx.loader.entries()]
    .map((e) => ({ id: e.id, name: e.options?.name }))
    .filter((e) => PKGS.some(([p]) => p === e.name))
  assert.equal(targets.length, 2, `应能按包名找到 2 个 entry，实测 ${targets.length}`)
  for (const t of targets) ctx.loader.remove(t.id)
  await settle(400)
  assert.equal(assemblyCount(), 0, `卸载后装配计数必须归零，实测 ${assemblyCount()}`)
  assert.equal(ctx.get('mana-metacognition'), undefined, '卸载后服务必须不可读')
})
