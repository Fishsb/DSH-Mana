#!/usr/bin/env node
/**
 * R0 反证判据 · 真装配链版（阶段 0 专属）
 *
 * 与其他验收的差别：**这一条走真正的 cordis Loader 装配链** ——
 * 用 `loader.create({ name })` 按**包名**解析（与宿主装 bundle 同一条路），
 * 而不是 `import` 源码文件。判据（落地册 阶段 0 · 反证判据 R0）：
 *
 *   ① 六个骨架**逐个**注入 → 装配计数记为 N
 *   ② 再**逐个**卸载 → 装配计数归零
 *   ③ 且 `mana_trace` **无新增行**（仍产生新行即判不通过）
 *
 * ⚠ 为什么必须走 Loader 而不是 import：
 *   实测（2026-09-24）`loader.create` **立即返回字符串 id**，真正的模块加载与
 *   fiber 激活是**异步**的 ⇒ 只看调用返回就断言"装上了"会**假绿**。
 *   本脚本因此用「**服务是否可读**」([`ctx.get(name)`]) 作为**装配计数的真判据**，
 *   而不是调用是否抛错。
 *
 * 用法：node tools/r0-assembly-check.mjs
 * 退出码：0 = 通过；1 = 不通过。
 */
import { mkdtempSync, rmSync } from 'node:fs'
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
 *   R0 会以「装配 0/6」失败 —— 那是**判据自身的环境依赖**，不是被测对象的缺陷。
 *   判据必须**自足**：装配链的解析面应来自本仓（npm workspaces 已建好
 *   `node_modules/dsh-mana-* → packages/*` 的链接）。
 */
const WORKSPACE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = pathToFileURL(WORKSPACE_DIR).href + '/'

/** 包名 → 它应提供的服务名（缓存的是"真跑起来"的判据，不是调用是否成功）。 */
const PKGS = [
  ['dsh-mana-core', 'mana-core'],
  ['dsh-mana-jev', 'mana-jev'],
  ['dsh-mana-vector', 'mana-vector'],
  ['dsh-mana-perception', 'mana-perception'],
  ['dsh-mana-attention', 'mana-attention'],
  ['dsh-mana-working-memory', 'mana-working-memory'],
]

const store = mkdtempSync(join(tmpdir(), 'mana-r0-'))
const DB = join(store, 'mana.db')
const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms))

const ctx = new Context()
ctx.baseUrl = BASE_URL
ctx.plugin(Loader, { baseUrl: BASE_URL })
await settle(250)

/** 装配计数 = 当前可读到的 Mana 服务数（**真判据**）。 */
const assemblyCount = () => PKGS.filter(([, svc]) => Boolean(ctx.get(svc))).length

/** 逐个注入：**core 必须最先**（其余 inject 它，否则停在 waiting）。 */
const injected = []
for (const [pkg] of PKGS) {
  await ctx.loader.create({ name: pkg, config: pkg === 'dsh-mana-core' ? { storePath: DB } : {} })
  await settle(200)
  injected.push(pkg)
}

const N = assemblyCount()
console.log(`① 注入 ${injected.length} 个 → 装配计数 N = ${N}`)
if (N !== PKGS.length) {
  const missing = PKGS.filter(([, svc]) => !ctx.get(svc)).map(([p]) => p)
  console.error(`✗ FAIL：期望装配 ${PKGS.length}，实测 ${N}；未激活：${missing.join(', ')}`)
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
  .filter((e) => PKGS.some(([p]) => p === e.name))
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

const afterUnloadCount = assemblyCount()
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
console.log(`  装配计数归零（N=${N} → 0）：${zeroAssembly ? '✓ 通过' : '✗ 不通过'}`)
console.log(`  卸载后不再产生新行      ：${noNewRows ? '✓ 通过' : '✗ 不通过'}`)
if (!zeroAssembly || !noNewRows) process.exitCode = 1
else console.log('  ⇒ R0 通过')

// 收尾：删临时库（本判据不碰真实数据面）
try { core?.db?.close?.() } catch { /* ignore */ }
rmSync(store, { recursive: true, force: true })
