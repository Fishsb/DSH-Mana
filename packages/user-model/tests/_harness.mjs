/**
 * `dsh-mana-user-model` 判据的**共享夹具**（非测试文件：文件名不以 `.test.mjs` 结尾，
 * `npm test` 的 `tests/*.test.mjs` 不会把它当用例文件跑）。
 *
 * ── 两件工具，各对应一条本仓纪律 ────────────────────────────────────────────
 *
 * ① `mount()` —— 用**真 cordis Context + 真 core 插件 + 真 openManaDb** 造运行态，
 *    库指向 `mkdtempSync` 的临时目录。
 *    ⚠ **绝不指向 `$DSH_HOME/memory/mana.db`**（本仓硬纪律）。
 *    ⚠ 为什么不用假 ctx 直调 `apply`：A4-4 判的是"**更新后真新增一行**"，
 *      假的库句柄会让这条腿变成"我喂进去的行数"——夹具绿 ≠ 真数据绿。
 *
 * ② `cloneAndMutate()` —— **变异自证**（本仓 `tools/a1-check.mjs` 的 `--mutate` 同形态）：
 *    把源码原文读进内存 → 在**临时目录的克隆副本**上打补丁 → import 克隆。
 *    ⚠ **绝不写回仓内任何源文件**（`packages/**` 他席可能正在写）。
 *    ⇒ 变异跑前/跑后仓内文件的 sha256 **逐字相同**，这是"卸载即净"在测试层的对应物。
 *    克隆副本靠**符号链接** node_modules 解析 `@deepseek-ai/schemastery` / `dsh-mana-core`，
 *    并把源码里的相对 import 改写成**绝对 file: URL**（否则克隆目录里解析不到邻居模块）。
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 仓库根：`packages/user-model/tests/` 往上三层。 */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const P = (...p) => join(REPO, ...p)

const cleanups = []
process.on('exit', () => {
  for (const d of cleanups) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* 清理失败不掩盖断言结果 */
    }
  }
})

/** 造一个临时目录（进程退出时递归删除）。 */
export function tmpDir(prefix = 'mana-um-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(d)
  return d
}

export const settle = (ms = 220) => new Promise((r) => setTimeout(r, ms))

/**
 * 挂真 core + 真 user-model，库指向临时目录。
 *
 * @param {{config?: object, storePath?: string}} [opts]
 */
export async function mount(opts = {}) {
  const store = opts.storePath ?? join(tmpDir(), 'mana.db')
  const ctx = new Context()
  const coreMod = await import(pathToFileURL(P('packages/core/src/index.ts')).href)
  const umMod = await import(pathToFileURL(P('packages/user-model/src/index.ts')).href)
  ctx.plugin(coreMod, { storePath: store, backupEnabled: false })
  await settle(250)
  ctx.plugin(umMod, opts.config ?? {})
  await settle(250)
  const core = ctx.get('mana-core')
  const um = ctx.get('mana-user-model')
  if (!core || !um) throw new Error('mount 失败：core 或 user-model 服务不可读（前置不满足）')
  return { ctx, core, um, umMod, store, close: () => core.db.close() }
}

/** 单文件 sha256（复原证据用）。 */
export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 目录下每个 `.ts` 的 sha256 映射（变异前后对拍用）。 */
export function srcFingerprint(pkg) {
  const dir = P('packages', pkg, 'src')
  const out = {}
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts')).sort()) {
    out[f] = sha256(join(dir, f))
  }
  return out
}

/**
 * 把一组源文件克隆进临时目录并打补丁，返回可 import 的克隆入口路径。
 *
 * @param {string} pkg        包目录名（如 `user-model` / `core`）
 * @param {string[]} files    要克隆的 `src/` 文件名
 * @param {Array<[RegExp|string, string]>} patches  补丁（按要求逐条**必须命中**，否则抛错）
 * @returns {{entry: string, dir: string, texts: Record<string,string>}}
 */
export function cloneAndMutate(pkg, files, patches = []) {
  const srcDir = P('packages', pkg, 'src')
  const dir = tmpDir(`mana-mut-${pkg}-`)
  mkdirSync(join(dir, 'src'), { recursive: true })
  symlinkSync(P('node_modules'), join(dir, 'node_modules'), 'dir')

  const url = (f) => pathToFileURL(join(srcDir, f)).href
  /** 相对 import → 绝对 file: URL（克隆目录里没有邻居模块）。 */
  const absolutize = (txt) =>
    txt.replace(/(from\s+|import\s*\()(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, pre, q, rel) => {
      const abs = resolve(srcDir, rel.replace('\.ts', '.ts'))
      return pre === '(' ? `import(${JSON.stringify(pathToFileURL(abs).href)}` : `${pre}${q}${pathToFileURL(abs).href}${q}`
    })

  const texts = {}
  const hits = patches.map(() => 0)
  for (const f of files) {
    let txt = absolutize(readFileSync(join(srcDir, f), 'utf8'))
    for (const [i, [from, to]] of patches.entries()) {
      const count = typeof from === 'string' ? txt.split(from).length - 1 : (txt.match(from) ?? []).length
      if (count === 0) continue
      hits[i] += count
      txt = typeof from === 'string' ? txt.split(from).join(to) : txt.replace(from, to)
    }
    texts[f] = txt
    writeFileSync(join(dir, 'src', f), txt)
  }
  // ⚠ **锚点零命中必须抛错**（逐条断言，不是在某个文件上断言）：
  //   锚点漂移会让变异**静默失效**（补丁没打上，测试照绿）—— 那正是"负向对拍"变成假绿的形态。
  for (const [i, [from]] of patches.entries()) {
    if (hits[i] === 0) {
      throw new Error(
        `cloneAndMutate: 补丁【${String(from)}】在 packages/${pkg}/src/{` + files.join(',') + `} 全部零命中 —— ` +
          '锚点漂移会让变异静默失效，使"负向对拍"变成假绿（本仓：锚点必须显式断言命中）',
      )
    }
  }
  return { entry: join(dir, 'src', files[0]), dir, texts, srcDir, hits }
}

/** 克隆包 + 用假 ctx 直跑 `apply`（纯逻辑变异用，不需要真库）。 */
export async function mountedClone(pkg, files, patches, config = {}) {
  const { entry } = cloneAndMutate(pkg, files, patches)
  const mod = await import(entry)
  return { mod, fake: fakeCtx() }
}

/** 最小假 ctx：只实现 `apply` 用到的 get / effect / provide / on。 */
export function fakeCtx({ withCore = true, core = { plugin: 'mana-core' } } = {}) {
  const provides = new Map()
  const listeners = []
  const effects = []
  return {
    provides,
    listeners,
    effects,
    on: (evt, fn) => {
      listeners.push({ evt, fn })
      return () => undefined
    },
    get: (n) => (withCore && n === 'mana-core' ? core : undefined),
    provide: (n, svc) => {
      provides.set(n, svc)
      return () => provides.delete(n)
    },
    effect: (fn) => {
      effects.push(fn())
      return () => undefined
    },
  }
}

/**
 * **负向对拍的直接形态**：在**变异体**上跑**原判据**，断言它**必须报红**，并把红的内容回传。
 *
 * ⚠ 为什么必须有这个 helper（本席实测踩到的第 4 种失败形态）：
 *   把负向对拍写成"在变异体上再断言一次正确行为"，等于要求变异体也合格 ⇒ 它**永远红**，
 *   而与"原判据有没有牙"这件事**无关** —— 那种红给的是假信心。
 *   正确形态是：变异体 ⇒ 原判据 ⇒ **捕获到断言失败** ⇒ 才算这条腿有牙。
 *
 * @param {() => void} fn  在变异体上执行的**原判据**
 * @param {string} why     失败时提示（应说明"本判据测的是哪个事实"）
 * @returns {Error} 捕获到的红（带原文，供 handoff 引用）
 */
export function expectRed(fn, why) {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error(
    '负向对拍失效：原判据在**变异体**上没有报红 ⇒ 这条判据是空的（' + why + '）。' +
      '本仓纪律：没有负向对拍的判据不算判据 —— 它只证明"代码在长"，不证明"行为对"。',
  )
}

/**
 * **写面完整性哨兵**（本席实测踩到的第五种失败形态）。
 *
 * 实测事实：往本仓写测试文件时，一个**未转义的反引号**会让 `write` 的内容在反引号处
 * **静默截断**，而工具仍回 "create/update ok" —— 于是落盘的是**半个文件**，
 * 报出来的是 `SyntaxError: Unexpected end of input`（指不到真因）。
 * 本仓已有同族教训（"文本改动先定编码 · 改后回验"）。
 *
 * ⇒ 本哨兵把"落盘完整"变成一条**可机检**的事实。
 *
 * ⚠ **口径必须用"真解析"而不是"数字符"**（本席实测踩到）：
 *   首版用"反引号必须是偶数个"当证据，结果 `_harness.mjs` **误报**（63 个）——
 *   因为源码里有**成对但语义无关**的反引号（JSDoc 行内代码 `foo`），它天然是奇数个。
 *   同族纪律：**代理指标非判据**。字符计数只是"像不像残缺"的代理，
 *   而"这个文件能不能被 JS 引擎解析"才是残缺的**本体**。
 *   ⇒ 改用 **`node --check`**（= 引擎自己的解析器，ESM 也认）。
 *
 * ⚠ **为什么不是 `new Function`**：本席实测第二次踩到 —— `new Function` 只吃**脚本**，
 *   碰到 ESM 的顶层 import/export 就抛 `Unexpected token`，于是**好文件被误判成残缺**
 *   （7 个文件全红）。把"引擎真解析"换成"能塞进 Function 的近似解析"，
 *   正是本仓说的**用代理指标顶替判据**。`node --check` 直接调真解析器，无此问题。
 */
export function assertWriteIntegrity(files) {
  for (const f of files) {
    const name = f.split('/').pop()
    const txt = readFileSync(f, 'utf8')
    assert.ok(txt.endsWith('\n'), name + ' 未以换行结尾 ⇒ 疑似被静默截断（写面完整性）')
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
    } catch (error) {
      const detail = String(error?.stderr ?? error?.message ?? error).trim().split('\n').slice(-3).join(' | ')
      assert.fail(name + ' 未通过 node --check ⇒ 文件残缺（疑似写面静默截断）：' + detail.slice(0, 200))
    }
  }
}

/** 某张表当前行数。 */
export function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c)
}

/** 一张表的列名。 */
export function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => String(r.name))
}

/** 某类 trace 行数。 */
export function traceCount(db, eventType) {
  return Number(db.prepare('SELECT COUNT(*) c FROM mana_trace WHERE event_type = ?').get(eventType).c)
}
