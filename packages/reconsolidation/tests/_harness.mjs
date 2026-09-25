/**
 * 本包测试的共用夹具（**不以 `.test.mjs` 结尾** ⇒ 不会被 `node --test "tests/*.test.mjs"` 当作用例文件）。
 *
 * ── 夹具纪律（本仓血的教训，逐条对应）───────────────────────────────────────────────────
 *   ① **夹具绿 ≠ 真数据绿**：本包所有"窗口开/关"与"内容更新"用例都**走生产路径**
 *      （`core.writeMemoryItem` 建行 + 本包服务面写列 + **回读**断言），
 *      没有一条是"测试自己直写列再自己读"的自证。
 *   ② **两列不在是本仓现状**：`makeDb({columns:false})` 建的是**真现状库**
 *      （只有 core 的 26 列）；`makeDb({columns:true})` 用真 DDL + 真 `ALTER TABLE`
 *      模拟 L-00 补列之后。两条路径都由本包的生产代码处理，夹具只提供前提。
 *   ③ **负向对拍要打对靶**：判据读的是 `src/`（判据器 a1 的内容腿读 `lib/`），
 *      故 `runWithMutation` 改的是 **src 文件**并**同时改 lib 是不可能**的 ——
 *      它只跑 `node --test`（import src），不跑任何按包名解析到 lib 的判据。
 *      ⚠ 对拍前后 **sha256 必须逐字节相同**（`restore()` 返回值里带证据）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PKG_DIR = fileURLToPath(new URL('../', import.meta.url))

/**
 * ⚠ **不能**用 `new URL('../../', import.meta.url)` 推 packages 根：
 *   本文件在 `node --test` 里会被 **`typescript` 的 loader 编译到 /tmp** 再执行（本包 src 是 .ts），
 *   此时 `import.meta.url` 指向的是**编译产物**的位置（/tmp/...），推出来的"包根"是假的 ——
 *   实测表现是 `loadPackage('core')` 抛 `ERR_MODULE_NOT_FOUND: /tmp/core/src/index.ts`。
 *   ⇒ 从**本文件所在目录**（`tests/`，真路径）向上找第一个同时含 `core` 与 `reconsolidation` 的目录。
 *     `PKG_DIR` 已由 `new URL('../')` 给出，而 `fileURLToPath` 在 /tmp 情形下仍是**真路径**
 *     （本包实测可用），故此定位是确定性的、不依赖 cwd。
 */
function findPackagesDir(start) {
  let dir = start
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'core', 'src', 'index.ts')) && existsSync(join(dir, 'reconsolidation', 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`找不到 packages 根（自 ${start} 向上 8 层）—— 夹具定位假设已失效`)
}
export const PACKAGES_DIR = findPackagesDir(PKG_DIR)
export const loadPackage = (dir) => import(new URL(`${dir}/src/index.ts`, pathToFileURL(PACKAGES_DIR + '/').href).href)
export const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/** 本包显式依赖的两列（夹具与判据共用；与 `src/columns.ts` 的清单**各自独立写一遍**）。 */
export const TWO_COLUMNS = ['reconsolidation_window_until', 'update_history']

const tmpDirs = []
export function cleanupAll() {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  tmpDirs.length = 0
}

// ══ 装配（真 core + 真本包）══════════════════════════════════════════════════
/**
 * 装配 core + 本包，返回服务面。
 * @param {{columns:boolean, rawCore?:boolean}} opts
 *   `columns:true` 时先建库并 `ALTER TABLE` 补两列（**再**交给 core 装配）。
 *   `rawCore:true` 时不走 cordis，直接执行 `coreMod.apply` 到一个最小 ctx 上
 *   （用于"降级腿要有真服务面"的对照，仍走 core 的真 apply）。
 */
export async function mount({ columns = false } = {}) {
  const mod = await loadPackage('reconsolidation')
  const coreMod = await loadPackage('core')
  const dir = mkdtempSync(join(tmpdir(), 'rcn-'))
  tmpDirs.push(dir)
  const path = join(dir, 'mana.db')

  if (columns) {
    // 先按 core 的真 DDL 建库，再补两列 ⇒ 与"L-00 之后的存量库"同形。
    const raw = new DatabaseSync(path)
    coreMod.createSchema(raw)
    for (const c of TWO_COLUMNS) raw.exec(`ALTER TABLE memory_items ADD COLUMN ${c} TEXT`)
    raw.close()
  }

  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: path })
  await settle(250)
  const fiber = ctx.plugin(mod)
  await settle(300)
  const core = ctx.get('mana-core')
  const svc = ctx.get('mana-reconsolidation')
  return { ctx, core, svc, mod, fiber, path, dir }
}

/** 走一次真 waterfall，返回链尾哨兵与最内层次数（口径同 forgetting/skeleton.test.mjs:52）。 */
export async function probeChain(ctx) {
  let sentinel = 0
  let inner = 0
  ctx.on('agent/pre-step', async (_p, next) => { sentinel += 1; return await next() })
  const payload = { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }
  const r = await ctx.waterfall('agent/pre-step', payload, async () => { inner += 1; return { messages: [] } })
  return { sentinel, inner, r }
}

// ══ trace 取证 ═══════════════════════════════════════════════════════════════
export function maxSeq(core) {
  return Number((core.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM mana_trace').get() ?? {}).s ?? 0)
}
/** 读 `seq > since` 的新增行 —— **本包这段调用期间写的、一条不漏**（不是按前缀过滤后再断言）。 */
export function traceSince(core, since) {
  return core.db.prepare('SELECT seq, event_type, payload FROM mana_trace WHERE seq > ? ORDER BY seq').all(since)
}

// ══ 文件级扰动（负向对拍用）════════════════════════════════════════════════════
export function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}
export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/**
 * 造扰动 → 跑指定用例文件（**必须报红**）→ 真源**全程只读**，并给 sha256 证据。
 *
 * ── ⚠ 为什么扰动必须在**沙箱副本**里做（本席 2026-09-25 实测踩到的真竞态）───────────────
 *   第一版是"改真源 src → 跑 → 拷回"。它与 **`node --test` 的多文件并行**直接冲突：
 *   test runner 会**同时**跑多个用例文件，而本文件改的 `src/params.ts` 是**共享真源** ——
 *   并行着的 `window-boundaries.test.mjs` 会读到**扰动到一半的值**，报出
 *   `实测 1801000`（正是扰动值）这类**假红**（实测：`# pass 24 / # fail 5`）。
 *   ⇒ 两个后果都坏：① 判据变成"一会儿过一会儿不过"；② 若有人把这当成"对拍成功"，
 *     他拿到的红其实来自别的测试读到了半路状态 —— **证据是假的**。
 *   ⇒ 处置：把 `tests/` 与 `src/` 拷进 `/tmp` 沙箱（沙箱内放一个指向仓内
 *     `node_modules` 的软链，使裸包名 `@deepseek-ai/cordis` 仍可解析），
 *     **只在沙箱内**写入扰动再跑 ⇒ 真源从头到尾**没被打开写**。
 *
 * ── 三条可机检证据（缺一即不算做完）──────────────────────────────────────────────────
 *   ① 扰动锚点恰好命中 1 次（命中 0 次说明变异器已过期，静默通过即假绿）；
 *   ② `sourceUnchanged`：跑完真源 sha256 与跑前**逐字相同**；
 *   ③ `sandboxGone`：沙箱已删净（不留下会被下轮读到的残留）。
 *
 * @returns {{code:number, failed:string[], ran:boolean, sourceUnchanged:boolean, sandboxGone:boolean, before:string, after:string}}
 */
export function runWithMutation({ file, find, replace, testFile }) {
  const target = join(PKG_DIR, file)
  const original = readFileSync(target, 'utf8')
  const beforeSha = sha256(original)
  const hits = original.split(find).length - 1
  if (hits !== 1) throw new Error(`扰动锚点必须恰好命中 1 次，实测 ${hits}：${file}（真源已改 ⇒ 变异器过期）`)

  const sandbox = mkdtempSync(join(tmpdir(), 'rcn-neg-'))
  const sandboxPkg = join(sandbox, 'packages', 'reconsolidation')
  let result
  try {
    mkdirSync(join(sandbox, 'packages'), { recursive: true })
    // 裸包名解析：从沙箱向上找不到仓内 node_modules，故显式软链一份（**只链接，不复制**）。
    symlinkSync(join(PACKAGES_DIR, '..', 'node_modules'), join(sandbox, 'node_modules'), 'dir')
    // core 的**真源码**也拷进来：本包测试走真 core（`loadPackage('core')`），沙箱里必须同样成立。
    cpSync(join(PACKAGES_DIR, 'core'), join(sandbox, 'packages', 'core'), {
      recursive: true,
      filter: (p) => !p.includes(`${sep}node_modules`) && !p.includes(`${sep}lib`),
    })
    mkdirSync(sandboxPkg, { recursive: true })
    cpSync(join(PKG_DIR, 'src'), join(sandboxPkg, 'src'), { recursive: true })
    cpSync(join(PKG_DIR, 'tests'), join(sandboxPkg, 'tests'), { recursive: true })
    cpSync(join(PKG_DIR, 'package.json'), join(sandboxPkg, 'package.json'))
    // 扰动**只写沙箱**
    writeFileSync(join(sandboxPkg, file), original.replace(find, replace))
    result = runNodeTest(testFile, sandboxPkg)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
  const afterSha = sha256File(target)
  return {
    ...result,
    sourceUnchanged: afterSha === beforeSha,
    sandboxGone: !existsSync(sandbox),
    before: beforeSha,
    after: afterSha,
    target,
  }
}

/**
 * 跑一个用例文件（**子进程**），返回退出码 + 用例计数 + 失败的用例名。
 *
 * ⚠ 本函数踩过一个**真陷阱，记在这里防复发**（2026-09-25 本席实测）：
 *   在 `node --test` 里再 `spawn` 一个 `node --test` 时，**环境变量 `NODE_TEST_CONTEXT`
 *   会随环境继承**（Node 的 test runner 给每个测试子进程都设它）。子进程带着它启动时
 *   会**走"测试子进程"分支、不执行任何用例、exit 0、零输出** ⇒
 *   对拍侧看到的是「扰动后仍然绿」——一个**完全静默的假绿**：
 *   四条负向对拍会集体失效，而它们看上去仍在运行（本席第一次跑正是五条全红）。
 *   ⇒ 两条处置（都要）：
 *     ① `env`：显式剥掉 `NODE_TEST_CONTEXT`（不假设它不存在）；
 *     ② **不信退出码本身**：解析 TAP 的 `# tests N`。解析不到 `N` 的跑法**是未判定**，
 *        一律记成 `code:-1`（**不是 0**）——"没跑成"绝不能被读成"跑过了、绿"。
 */
function sanitizeEnv() {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return env
}

/** 跑一个用例文件（`cwd` = 沙箱包目录），返回退出码 + 失败的用例名（TAP 的 `not ok` 行）。 */
function runNodeTest(testFile, cwd = PKG_DIR) {
  let code = 0
  let out = ''
  try {
    out = execFileSync(process.execPath, ['--test', testFile], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sanitizeEnv(),
    })
  } catch (error) {
    code = typeof error.status === 'number' ? error.status : 1
    out = String(error.stdout ?? '') + String(error.stderr ?? '')
  }
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
  const m = /# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/.exec(out)
  if (!m) {
    // "跑了但没解析到计数" ⇒ **未判定**，不得读成通过（挂账/无实现者不是 PASS，同源）。
    return { code: -1, failed, tests: null, passed: null, failedCount: null, ran: false, output: out }
  }
  return { code, failed, tests: Number(m[1]), passed: Number(m[2]), failedCount: Number(m[3]), ran: true, output: out }
}
