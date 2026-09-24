#!/usr/bin/env node
/**
 * R0 反证判据 · 真装配链版（阶段 0 专属）
 *
 * 与其他验收的差别：**这一条走真正的 cordis Loader 装配链** ——
 * 用 `loader.create({ name })` 按**包名**解析（与宿主装 bundle 同一条路），
 * 而不是 `import` 源码文件。判据（落地册 阶段 0 · 反证判据 R0）：
 *
 *   ① 全部 Mana 包**逐个**注入 → 装配计数记为 N
 *   ② 再**逐个**卸载 → 装配计数归零
 *   ③ 且 `mana_trace` **无新增行**（仍产生新行即判不通过）
 *
 * ⚠ 为什么必须走 Loader 而不是 import：
 *   实测（2026-09-24）`loader.create` **立即返回字符串 id**，真正的模块加载与
 *   fiber 激活是**异步**的 ⇒ 只看调用返回就断言"装上了"会**假绿**。
 *   本脚本因此用「**服务是否可读**」([`ctx.get(name)`]) 作为**装配计数的真判据**，
 *   而不是调用是否抛错。
 *
 * ⚠⚠ **覆盖清单不得是自指等式**（本会议 2026-09-24 判红事实，两轮都栽在这里）：
 *   旧版 `const PKGS = [...]` 手写 7 行，判据是 `N !== PKGS.length` —— 而 `N` 又是
 *   在**同一份 PKGS** 上数出来的 ⇒ **删掉清单里任何一行，"期望"与"实测"同时少 1，恒等成立**。
 *   实测：`sed -i "/dsh-mana-ui/d"` 删掉整行后仍打印 `N=6 → 0` 并 `⇒ R0 通过`（exit 0）；
 *   删掉既有的 `working-memory` 同样绿。这与 W2-2 的 a1-check 是**同一个病**。
 *   现改为**三源互证**（任一条腿红即判红、且点名到包）：
 *     ① **真源 = 盘上目录集**：`readdirSync(packages/*)`（不采信任何手写清单）；
 *     ② **声明式映射** `MANIFEST`：目录 → 服务名。它与 ① **必须互相覆盖**
 *        （盘上有而清单缺 ⇒ 红；清单有而盘上无 ⇒ 红 —— 这就是当年 `sed` 能删掉的那类行）；
 *     ③ **逐包独立派生**：从每个包自己的 `package.json.name` 与 `src/index.ts` 的
 *        `provide(...)` 面反推包名/服务名，与 ② 比对 —— 清单**不能自说自话**。
 *   服务名之所以不直接"纯派生"而不留清单：`provide` 的实参形态有二（字面量、`SERVICE_NAME`
 *   常量），且判据需要**先于**被测对象成立（清单被删/被改正是要被抓住的形态）。
 *
 * 用法：node tools/r0-assembly-check.mjs
 * 退出码：0 = 通过；1 = 不通过。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const { Context } = await import(`${DSH}/cordis/lib/index.js`)
const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default

/**
 * baseUrl 指向**本仓工作区**，而不是 `~/.dsh/profiles/web/`。
 *
 * ⚠ 为什么（本仓实测踩到）：原先指向 profile 目录 ⇒ 该判据**依赖 profile 里的
 *   junction 是否存在**。一旦有别的步骤（如 dev_uninject_plugin）把 junction 清掉，
 *   R0 会以「装配 0/N」失败 —— 那是**判据自身的环境依赖**，不是被测对象的缺陷。
 *   判据必须**自足**：装配链的解析面应来自本仓（npm workspaces 已建好
 *   `node_modules/dsh-mana-* → packages/*` 的链接）。
 */
const WORKSPACE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = pathToFileURL(WORKSPACE_DIR).href + '/'
const PKG_ROOT = join(WORKSPACE_DIR, 'packages')

/**
 * 声明式映射：**包目录名 → 它应提供的服务名**。
 * ⚠ 它不是真源（真源 = 下面扫出来的 `SCANNED_DIRS`）。加包/删包时**两边都要改**，
 *   只改一边 ⇒ 下面的互覆盖断言报红并点名。这是刻意的：本文件上一版就是被
 *   「清单即真源」坑掉的（删一行 → 判据跟着少一行 → 恒绿）。
 */
const MANIFEST = {
  core: 'mana-core',
  jev: 'mana-jev',
  vector: 'mana-vector',
  perception: 'mana-perception',
  attention: 'mana-attention',
  'working-memory': 'mana-working-memory',
  // P2 的 ui（S4 席交付；W2-3 的装配证据面）：它 provides('mana-ui')，与其余包同一条 Loader 通道。
  ui: 'mana-ui',
  // P1 三骨架（B2.2 建，lib 由 `npm run build --workspace` 直出）。
  'long-term': 'mana-long-term',
  consolidation: 'mana-consolidation',
  forgetting: 'mana-forgetting',
  scheduler: 'mana-scheduler',
  'user-model': 'mana-user-model',
  metacognition: 'mana-metacognition',
}

// ── ① 真源：盘上的包目录集 ─────────────────────────────────────────────────
const SCANNED_DIRS = existsSync(PKG_ROOT)
  ? readdirSync(PKG_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  : []
const DECLARED_DIRS = Object.keys(MANIFEST).sort()

/** 互覆盖断言：缺项/多项各自点名（**不许**写成 `count === N`）。 */
const dirsMissingFromManifest = SCANNED_DIRS.filter((d) => !DECLARED_DIRS.includes(d))
const dirsMissingOnDisk = DECLARED_DIRS.filter((d) => !SCANNED_DIRS.includes(d))

// ── ③ 逐包独立派生（清单不能自说自话）──────────────────────────────────────
/**
 * 从包自己的两份文件反推：`package.json.name`（包名）与 `src/index.ts` 的服务名。
 * 服务名的三种既有形态（本仓 2026-09-25 普查）：
 *   · `ctx.provide('mana-x', service)` —— 字面量（12/13 包）；
 *   · `export const SERVICE_NAME = 'mana-x'` + `ctx.provide(SERVICE_NAME, service)`（core）；
 *   · `declare module` 的接口键 `'mana-x':`（全包都有，作最后兜底）。
 */
function derive(dir) {
  const pkgJsonPath = join(PKG_ROOT, dir, 'package.json')
  const srcPath = join(PKG_ROOT, dir, 'src/index.ts')
  const out = { dir, pkgJsonPath, srcPath, pkgName: null, serviceName: null, inject: null, problems: [] }
  if (!existsSync(pkgJsonPath)) {
    out.problems.push(`缺 ${pkgJsonPath}`)
    return out
  }
  try {
    out.pkgName = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).name ?? null
  } catch (error) {
    out.problems.push(`${pkgJsonPath} 解析失败：${error.message}`)
  }
  if (!existsSync(srcPath)) {
    out.problems.push(`缺 ${srcPath}`)
    return out
  }
  const src = readFileSync(srcPath, 'utf8')
  const mProvide = /ctx\.provide\(\s*'([^']+)'/.exec(src)
  const mConst = /SERVICE_NAME\s*=\s*'([^']+)'/.exec(src)
  const mDecl = /interface Context\s*\{[\s\S]*?'(mana-[a-z0-9-]+)'\s*:/.exec(src)
  out.serviceName = mProvide?.[1] ?? mConst?.[1] ?? mDecl?.[1] ?? null
  if (!out.serviceName) out.problems.push(`${srcPath} 取不到服务名（provide 字面量 / SERVICE_NAME / declare module 三形态皆无）`)
  const mInject = /export const inject\s*(?::\s*string\[\])?\s*=\s*\[([^\]]*)\]/.exec(src)
  out.inject = mInject ? [...mInject[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null
  if (out.inject === null) out.problems.push(`${srcPath} 取不到 inject 面`)
  return out
}

const derived = SCANNED_DIRS.map(derive)
const derivedProblems = []
for (const d of derived) {
  for (const p of d.problems) derivedProblems.push(p)
  const wantPkg = `dsh-mana-${d.dir}` // docs/contract/naming.md：目录名 → 包名
  if (d.pkgName && d.pkgName !== wantPkg) derivedProblems.push(`packages/${d.dir}/package.json: name=${d.pkgName} ≠ 目录推导值 ${wantPkg}`)
  // ⚠ 包名腿：覆盖集里用的包名必须逐个等于包自己声明的 name（上面那个 pkg/svc 混用的 bug 就靠它抓）
  const derivedPkg = `dsh-mana-${d.dir}`
  if (d.pkgName && derivedPkg !== d.pkgName) derivedProblems.push(`覆盖集包名 ${derivedPkg} ≠ packages/${d.dir}/package.json name=${d.pkgName}`)
  const declaredSvc = MANIFEST[d.dir]
  if (declaredSvc && d.serviceName && declaredSvc !== d.serviceName) {
    derivedProblems.push(`packages/${d.dir}/src/index.ts: 实际 provide「${d.serviceName}」≠ 清单声明「${declaredSvc}」`)
  }
}

/** 装配顺序：**按 inject 依赖深度**（core 无依赖 ⇒ 最先；其余 inject mana-core ⇒ 其后），同深度按目录名。 */
const depthOf = (dir, seen = new Set()) => {
  if (seen.has(dir)) return 0 // 环：不追（本仓无环；有环也不会卡死判据）
  seen.add(dir)
  const d = derived.find((x) => x.dir === dir)
  const deps = (d?.inject ?? []).map((svc) => derived.find((x) => MANIFEST[x.dir] === svc)?.dir).filter(Boolean)
  if (!deps.length) return 0
  return 1 + Math.max(...deps.map((x) => depthOf(x, seen)))
}
const ORDERED = [...SCANNED_DIRS].sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : a > b ? 1 : 0))
/** 覆盖集 = 盘上目录集（**不是**清单）：装配与计数都只看这一份。 */
const PKGS = ORDERED.map((dir) => ({
  dir,
  // ⚠ 包名由目录按 `docs/contract/naming.md` 的契约派生（`dsh-mana-<dir>`），**不是**清单值：
  //   清单里存的是**服务名**。这两者混用会让 `loader.create({name:'mana-core'})` 去解析一个
  //   不存在的包 —— 本席 2026-09-25 初版就是这么写的，实测症状=13 包全部「create 未抛错但服务不可读」。
  pkg: `dsh-mana-${dir}`,
  svc: MANIFEST[dir] ?? derived.find((d) => d.dir === dir)?.serviceName ?? null,
}))

/**
 * 直接守门：覆盖集里用的**包名**必须逐个等于「目录按 naming 契约派生」与「包自己声明的 name」。
 * 本席 2026-09-25 初版把清单里的**服务名**当成包名传给 `loader.create` ⇒ 13 包全装配不上
 * （症状：create 不抛错、服务不可读）。这一条让那类 bug 立刻点名，而不是靠 N 少了再回查。
 */
for (const p of PKGS) {
  const want = `dsh-mana-${p.dir}`
  const declared = derived.find((d) => d.dir === p.dir)?.pkgName ?? null
  if (p.pkg !== want) derivedProblems.push(`覆盖集包名 ${p.pkg} ≠ packages/${p.dir} 按契约派生值 ${want}`)
  if (declared && p.pkg !== declared) derivedProblems.push(`覆盖集包名 ${p.pkg} ≠ packages/${p.dir}/package.json name=${declared}`)
}

const coverageProblems = []
if (dirsMissingFromManifest.length) coverageProblems.push(`盘上有、清单缺 ${dirsMissingFromManifest.length} 个：${dirsMissingFromManifest.join(', ')}`)
if (dirsMissingOnDisk.length) coverageProblems.push(`清单有、盘上无 ${dirsMissingOnDisk.length} 个：${dirsMissingOnDisk.join(', ')}`)

console.log('──── R0 覆盖核对（三源互证：盘上目录集 / 声明清单 / 逐包派生）────')
console.log(`  盘上 packages/*：${SCANNED_DIRS.length} 个 [${SCANNED_DIRS.join(',')}]`)
console.log(`  声明清单 MANIFEST：${DECLARED_DIRS.length} 个`)
console.log(`  互覆盖：${coverageProblems.length ? `✗ ${coverageProblems.join('；')}` : '✓ 集合相等（逐目录在册）'}`)
console.log(`  逐包派生：${derivedProblems.length ? `✗ ${derivedProblems.length} 处不符` : '✓ 包名/服务名/ inject 面与清单逐个一致'}`)
for (const p of derivedProblems) console.log(`      · ${p}`)

let coverageFail = coverageProblems.length > 0 || derivedProblems.length > 0
if (coverageFail) {
  console.error('✗ FAIL：覆盖核对不通过 —— 覆盖清单与盘上真源不一致（判据不得在被改的那份清单上自证）')
  process.exitCode = 1
} else {
  console.log(`  装配顺序（按 inject 深度，core 最先）：${ORDERED.join(' → ')}`)
}

const store = mkdtempSync(join(tmpdir(), 'mana-r0-'))
const DB = join(store, 'mana.db')
const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms))

const ctx = new Context()
ctx.baseUrl = BASE_URL
ctx.plugin(Loader, { baseUrl: BASE_URL })
await settle(250)

/** 装配计数 = 当前可读到的 Mana 服务数（**真判据**）。口径未变：只数覆盖集里的服务。 */
const readableCount = () => PKGS.filter((p) => p.svc && Boolean(ctx.get(p.svc))).length

/** 逐个注入：**core 必须最先**（其余 inject 它，否则停在 waiting）。config 口径未变。 */
const injected = []
const perPkg = []
for (const { dir, pkg, svc } of PKGS) {
  let createError = null
  try {
    await ctx.loader.create({ name: pkg, config: pkg === 'dsh-mana-core' ? { storePath: DB } : {} })
  } catch (error) {
    createError = error.message
  }
  await settle(200)
  const readable = Boolean(svc) && Boolean(ctx.get(svc))
  perPkg.push({ dir, pkg, svc, readable, createError })
  injected.push(pkg)
}

const N = readableCount()
console.log(`\n① 注入 ${injected.length} 个 → 装配计数 N = ${N}`)
for (const r of perPkg) {
  console.log(`     ${r.readable ? '✓ 装配' : '✗ 未装配'}  ${r.pkg.padEnd(26)} svc=${String(r.svc).padEnd(22)}${r.readable ? '' : ` ${r.createError ?? '（create 未抛错，但服务不可读 ⇒ 停在 waiting / 依赖未满足）'}`}`)
}
/** 期望值 = **盘上包数**（不是清单条数）：这样"清单少一行"由上面的覆盖核对抓，而不是自指抵消。 */
const expectedCount = SCANNED_DIRS.length
if (N !== expectedCount) {
  const missing = perPkg.filter((p) => !p.readable).map((p) => p.pkg)
  console.error(`✗ FAIL：期望装配 ${expectedCount}（= 盘上 packages/* 目录数），实测 ${N}；未装配：${missing.join(', ')}`)
  process.exitCode = 1
} else if (PKGS.length !== expectedCount) {
  console.error(`✗ FAIL：覆盖集 ${PKGS.length} ≠ 盘上包数 ${expectedCount}（覆盖与真源不等）`)
  process.exitCode = 1
}

const core = ctx.get('mana-core')
/**
 * ⚠ 行数一律用**独立只读连接**读，而不是 `core.db`。
 *   原因（本仓实测）：卸载 core 时它会正确关闭自己的库句柄 ⇒ 之后再拿旧句柄读会报
 *   `database is not open`。这恰恰是「卸载即净」生效的证据，但会让判据脚本自己崩。
 *   独立连接还顺带保证：判据读的是**盘上真数据**，不是内存里的缓存态。
 */
const count = (table) => {
  const ro = new DatabaseSync(DB)
  try {
    return ro.prepare(`SELECT count(*) c FROM ${table}`).get().c
  } finally {
    ro.close()
  }
}
const before = count('mana_trace')

// 正向前置：触发一次必须真产生新行（否则反证判据"平凡通过"，即 G11）
ctx.emit('mana/observation', {
  sessionId: 'r0', turnId: 1, requestId: 'r0-1',
  at: new Date().toISOString(), content: 'r0 注入后触发', source: 'r0-check',
})
await settle(250)
const afterTrigger = count('mana_trace')
if (afterTrigger <= before) {
  console.error(`✗ FAIL：触发后无新增行（反证判据将平凡通过 = G11 假绿）；before=${before} after=${afterTrigger}`)
  process.exitCode = 1
} else {
  console.log(`② 正向前置：触发后 mana_trace ${before} → ${afterTrigger}（+${afterTrigger - before}，证明链路真的通）`)
}

// ── 卸载：逐个移除 loader entry ────────────────────────────────────────────
// ⚠ API 形态（实测，易错）：`ctx.loader.entries` 是**方法**不是数组；
//   `group.remove(id)` 收的是 **entry id**，不是 entry 对象或 options。
//   写错会得 `entries is not iterable` / 静默无操作 ⇒ 卸载"看起来做了"其实没做。
const targets = [...ctx.loader.entries()]
  .map((e) => ({ id: e.id, name: e.options?.name }))
  .filter((e) => PKGS.some((p) => p.pkg === e.name))
let removed = 0
for (const t of targets) {
  try {
    ctx.loader.remove(t.id)
    removed += 1
  } catch (error) {
    console.log(`  ⚠ 卸载 ${t.name} 失败：${error.message}`)
  }
}
await settle(400)

const afterUnloadCount = readableCount()
console.log(`③ 卸载 ${removed} 个 entry → 装配计数 = ${afterUnloadCount}`)

const beforeSecond = count('mana_trace')
ctx.emit('mana/observation', {
  sessionId: 'r0', turnId: 2, requestId: 'r0-2',
  at: new Date().toISOString(), content: 'r0 卸载后触发', source: 'r0-check',
})
await settle(250)
const afterSecond = count('mana_trace')

const zeroAssembly = afterUnloadCount === 0
const noNewRows = afterSecond === beforeSecond
console.log(`④ 反证判据：卸载后同一触发 → mana_trace ${beforeSecond} → ${afterSecond}（${noNewRows ? '无新增 ✓' : '仍新增 ✗'}）`)

console.log('\n──── R0 判定 ────')
console.log(`  覆盖核对（三源互证）    ：${coverageFail ? '✗ 不通过' : '✓ 通过'}`)
console.log(`  装配计数归零（N=${N} → 0）：${zeroAssembly ? '✓ 通过' : '✗ 不通过'}`)
console.log(`  卸载后不再产生新行      ：${noNewRows ? '✓ 通过' : '✗ 不通过'}`)
if (!zeroAssembly || !noNewRows || coverageFail) process.exitCode = 1
else console.log('  ⇒ R0 通过')

// 收尾：删临时库（本判据不碰真实数据面）
try { core?.db?.close?.() } catch { /* ignore */ }
rmSync(store, { recursive: true, force: true })
