/**
 * 包名注册守卫（**B3.2-R 的装配面判据**）。
 *
 * ── 为什么需要它（本轮实测的事实，不是设想）────────────────────────────────
 * 本仓的 TS 导入面有**两套词法**，同一句 `import ... from 'dsh-mana-vector'` 在它们下面
 * 解析到**两个不同的文件**：
 *
 * | 词法 | 解析结果 | 证据（本轮实测） |
 * |---|---|---|
 * | `tsc --noEmit -p packages/<pkg>/tsconfig.json` | `packages/<pkg>/src/index.ts`（**真源**） | `tsconfig.base.json` 的 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`；编译产物 `lib/index.d.ts` 同名 `.d.ts` 优先于 `.ts` |
 * | `node --test packages/<pkg>/tests/*.test.mjs`（**类型剥离直接跑 .ts**） | `packages/<pkg>/lib/index.js`（**产物**） | 实测：`packages/attention/lib/` 与 `packages/consolidation/lib/` **整个目录不存在**（`ls` 实测），其测试里的按包名 import 因而拿不到任何导出 |
 *
 * ⇒ 只改 `src/` 不重建 `lib/` 时：**typecheck 通过而测试全红**（或反过来，取决于走哪条腿）。
 *   这正是「改了 src ≠ 生效」在本仓的具体形态，且它**静默**——两条腿各绿各的。
 *
 * ── 本守卫做什么 ───────────────────────────────────────────────────────────
 * 对每个**测试文件里按包名 import 过的** Mana 包，断言：
 *   ① `package.json` 的 `main` == `./lib/index.js`（装载面硬约束）；
 *   ② 该 `lib/index.js` **真存在且非零字节**；
 *   ③ `lib/index.js` 被 `import` 后**真能拿到** `name` / `inject` / `apply` 三个成员
 *      （本仓插件入口的固定导出面，与 `tools/a1-check.mjs` 的 W2-5 同口径）
 *      ⇒ 把「按包名解析到空模块」变成**点名到包 + 点名缺哪个成员**的红。
 *
 * ⚠ **mtime 腿为什么只作提示、不作判据**（本席独立复跑实测，2026-09-26）：
 *   判据 `packages/core/lib/index.js` mtime **15:55:49** 早于其 `src` 最新 .ts **17:15:07**，
 *   表面像「产物过期」；把当前 src **重新编译**后与 `lib` 逐字节比对 ⇒
 *   **emitted=6 / identical=6 / differing=[] / missingInLib=[]**
 *   ⇒ 内容完全一致，mtime 腿报的是**假红**。反向亦成立：`cp`（不带 `-p`）/ `touch`
 *   可让旧产物 mtime = NOW ⇒ **假绿**。
 *   ⇒ 以 mtime 判红会在本仓现行工具链下产生**假红**，而那正是「让真红被当噪声忽略」的入口。
 *   ⇒ 本守卫把 mtime 降为**提示行**（不影响退出码），可靠判定留给 ② 与 ③。
 *   内容级判定见 `tools/a1-check.mjs` 的 ARTIFACTS 内容腿（逐字节重编译对拍）。
 * 它**不**碰任何既有文件，**不**判任何既有判据的语义，**只**读文件系统。
 *
 * 用法：`node packages/vector/tests/pkg-registration.guard.mjs`
 *   exit 0 = 全部登记包可按包名解析；exit 1 = 至少一个不成立（逐包点名）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES = join(HERE, '..', '..')
const ROOT = join(PACKAGES, '..')

/**
 * 受检包清单 = **测试文件里按包名 import 过的 Mana 包**（本轮 `grep` 实测的并集）。
 * ⚠ 逐个列名而不是扫描：扫描会把「没被任何测试引用的包」也算进来，
 *   而它坏了不影响任何判据 —— 那属于另一种面（装配面），不属本守卫。
 */
export const GUARDED_PACKAGES = [
  'dsh-mana-core',
  'dsh-mana-jev',
  'dsh-mana-vector',
  'dsh-mana-long-term',
  'dsh-mana-forgetting',
  'dsh-mana-attention',
]

/** 包 id → 目录名（本仓为 `packages/<dir>`；id 去掉 `dsh-mana-` 前缀**不总是**成立，故显式列表）。 */
const DIR_OF = {
  'dsh-mana-core': 'core',
  'dsh-mana-jev': 'jev',
  'dsh-mana-vector': 'vector',
  'dsh-mana-long-term': 'long-term',
  'dsh-mana-forgetting': 'forgetting',
  'dsh-mana-attention': 'attention',
}

/** 递归收集 dir 下 .ts（**排除 lib/**，与 tools/a1-check.mjs 的口径一致）。 */
function collectTs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'lib' || e.name === 'types') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) collectTs(full, out)
    else if (e.name.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 本仓插件入口的**固定导出面**（与 tools/a1-check.mjs 的 W2-5 逐名同口径）。 */
export const REQUIRED_EXPORTS = ['name', 'inject', 'apply']

const bad = []
const hints = []
const lines = []
for (const pkg of GUARDED_PACKAGES) {
  const dir = DIR_OF[pkg]
  if (!dir) { bad.push(`${pkg}: 守卫清单里未登记目录名（新增包必须同步补最上面的 DIR_OF）`); continue }
  const pkgJsonPath = join(PACKAGES, dir, 'package.json')
  if (!existsSync(pkgJsonPath)) { bad.push(`${pkg}: 缺 packages/${dir}/package.json`); continue }
  const main = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).main
  if (main !== './lib/index.js') bad.push(`${pkg}: main=${main}（按包名解析的落点必须是 ./lib/index.js）`)
  const libEntry = join(PACKAGES, dir, 'lib', 'index.js')
  if (!existsSync(libEntry)) {
    bad.push(`${pkg}: 缺 ${libEntry.slice(ROOT.length + 1)} —— 按包名 import 的测试会**加载失败**，而 typecheck 走 src 仍会绿（两条腿两个真源）`)
    lines.push(`${pkg}: lib 缺`)
    continue
  }
  const size = statSync(libEntry).size
  if (size === 0) bad.push(`${pkg}: lib/index.js 是 0 字节（空模块会被当成"导出为空"而不是"没编译"）`)
  // ── ③ 真 import：拿不到入口三件套即红（**有牙腿**，不看 mtime）──────────
  let keys = []
  try {
    const mod = await import(pkg)
    keys = Object.keys(mod).sort()
    for (const k of REQUIRED_EXPORTS) {
      if (!(k in mod)) bad.push(`${pkg}: lib/index.js 缺导出成员 ${k}（按包名解析到的是空/不完整的模块）`)
    }
  } catch (error) {
    bad.push(`${pkg}: import 失败 ${error.code ?? error.message}（lib/index.js 存在但不等于可装载）`)
  }
  // ── mtime 腿：**只作提示**（实测会假红，见文件头）─────────────────────────
  const srcs = collectTs(join(PACKAGES, dir, 'src'))
  let stale = null
  if (srcs.length) {
    const maxSrc = Math.max(...srcs.map((x) => statSync(x).mtimeMs))
    if (statSync(libEntry).mtimeMs < maxSrc) stale = new Date(maxSrc).toISOString().slice(11, 19)
  }
  if (stale) hints.push(`${pkg}: mtime 提示 —— lib(${new Date(statSync(libEntry).mtimeMs).toISOString().slice(11, 19)}) 早于 src(${stale})；**不是判据**（实测可假红），要确认请跑 a1-check 的 ARTIFACTS 内容腿`)
  lines.push(`${pkg}: main=✓ lib=${size}B exports=[${keys.join(',')}] mtime${stale ? '提示:src更新' : ':✓'}`)
}

for (const h of hints) console.warn('  ⚠ ' + h)
if (bad.length) {
  console.error(`[pkg-registration·guard] 红：${bad.length} 项\n` + bad.map((b) => '  · ' + b).join('\n'))
  process.exit(1)
}
console.log(`[pkg-registration·guard] 通过：${GUARDED_PACKAGES.length} 个按包名可解析的包均可 import 且入口三件套齐备`)
for (const l of lines) console.log('  · ' + l)