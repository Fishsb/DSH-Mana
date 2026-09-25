/**
 * 双画像判据的**共享夹具**（非测试文件：文件名不以 `.test.mjs` 结尾，
 * `npm test` 的 `tests/*.test.mjs` 不会把它当用例文件跑）。
 *
 * ── 为什么不用假 ctx 直调 apply ─────────────────────────────────────────────
 * 「追加非覆盖」「退场不静默」判的是**库里真新增一行**。假的库句柄会让这两条腿
 * 变成"我喂进去的行数"——夹具绿 ≠ 真数据绿（本仓血的教训）。
 * 故这里挂**真 core 插件 + 真 openManaDb**，库指向 `mkdtempSync` 的临时目录。
 * ⚠ **绝不指向 `$DSH_HOME/memory/mana.db`**（本仓硬纪律；且该库是用户在用的活库）。
 *
 * ── 三件工具 ───────────────────────────────────────────────────────────────
 * ① `mount()`            —— 真 core + 真 metacognition 装配，库在临时目录
 * ② `cloneAndMutate()`   —— **负向对拍**：把源码读进内存 → 在**临时目录的克隆副本**上
 *                            打补丁 → 在克隆体上跑**原判据**，断言它必须报红
 * ③ `assertWriteIntegrity()` —— 写面完整性哨兵（见下）
 *
 * ⚠ ②**绝不写回仓内任何源文件**：变异跑前/跑后仓内 `src/**` 的 sha256 必须逐字相同
 *   （`srcFingerprint()` 对拍）—— 那是"卸载即净"在测试层的对应物。
 *   克隆副本靠**符号链接** node_modules 解析 `@deepseek-ai/schemastery` / `dsh-mana-core`，
 *   并把源码里的相对 import 改写成**绝对 file: URL**（否则克隆目录里解析不到邻居模块）。
 *
 * ── 写面完整性哨兵（本仓第 5 种失败形态）────────────────────────────────────
 * 实测事实：往本仓写文件时，一个**未转义的反引号**会让 `write` 的内容在反引号处
 * **静默截断**，而工具仍回 "create ok" —— 落盘的是半个文件，报出来的却是
 * `SyntaxError: Unexpected end of input`（指不到真因）。本仓已有同族教训
 * （「文本改动先定编码 · 改后回验」）。
 * ⚠ 口径必须是**真解析**（`node --check`），不是"数字符"：`_harness.mjs` 首版用
 *   "反引号必须是偶数个"当证据，结果误报（JSDoc 行内代码天然是奇数个）——
 *   代理指标非判据（该教训来自 packages/user-model/tests/_harness.mjs:198-212）。
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 包根：`packages/metacognition/tests/` 往上两层。 */
export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 仓库根。 */
export const REPO = resolve(PKG, '..', '..')
export const P = (...p) => join(REPO, ...p)
/** 本包 src 目录（内部模块过滤 + 变异范围的事实源）。 */
export const SRC = join(PKG, 'src')

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

export function tmpDir(prefix = 'mana-mc-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(d)
  return d
}

export const settle = (ms = 220) => new Promise((r) => setTimeout(r, ms))

/** 单文件 sha256（复原证据用）。 */
export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** `src/*.ts` 的 sha256 映射（变异前后对拍用）。 */
export function srcFingerprint() {
  const out = {}
  for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts')).sort()) out[f] = sha256(join(SRC, f))
  return out
}

/**
 * 造运行态：真 core + 真 metacognition（源码面），库在临时目录。
 *
 * @param {{coreConfig?: object, mcConfig?: object, storePath?: string}} [opts]
 * @returns 运行态（含 core 服务、装配好的 `mounts` 探针面、以及库句柄）
 */
export async function mount(opts = {}) {
  const store = opts.storePath ?? join(tmpDir(), 'mana.db')
  const ctx = new Context()
  const coreMod = await import(pathToFileURL(P('packages/core/src/index.ts')).href)
  ctx.plugin(coreMod, { storePath: store, backupEnabled: false, ...(opts.coreConfig ?? {}) })
  await settle(250)
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mount 失败：core 服务不可读（前置不满足）')
  return {
    ctx,
    core,
    store,
    /** 表行数（判"新增一行"的事实源）。 */
    count: (table) => Number(core.db.prepare('SELECT COUNT(*) c FROM ' + table).get().c),
    close: () => core.db.close(),
  }
}

/**
 * 取「双通道句柄」：走**真判定实现**（`dsh-mana-user-model` 的 `injectionVerdict`）。
 *
 * ⚠ 这是"跨包复用"的**判据侧**用法，不是生产装配路径：本包 `inject` 只声明 mana-core，
 *   生产路径由宿主取 `ctx.get('mana-user-model')` 注入（见 `src/index.ts` 的 profileIndex()）。
 *   判据显式注入同一份实现，测的是"**本包不写第二份判定**"这条事实。
 */
export async function withVerdict({ confidenceFloor = null } = {}) {
  const umMod = await import(pathToFileURL(P('packages/user-model/src/index.ts')).href)
  return { injectionVerdict: umMod.injectionDecision, confidenceFloor }
}

/** `profile:` 键的当前主表值（`undefined` = 无该键，与"值是空串"可分辨）。 */
export function mainValue(core, fullKey) {
  const row = core.db.prepare('SELECT value, confidence FROM user_model WHERE key = ?').get(fullKey)
  return row ? { value: row.value, confidence: row.confidence } : undefined
}

/**
 * `memory_items.content` 行数（A4-3 的唯一读数）。
 * ⚠ 用 `COUNT(*)` 数的是**行**：`content` 是 NOT NULL 列，"写了空串"也是写。
 */
export function contentRows(core) {
  return Number(core.db.prepare('SELECT COUNT(*) c FROM memory_items').get().c)
}

/** `mana_trace` 里某 event_type 的行数。 */
export function traceCount(core, eventType) {
  return Number(core.db.prepare('SELECT COUNT(*) c FROM mana_trace WHERE event_type = ?').get(eventType).c)
}

/** 某 event_type 的全部载荷（解析失败的行**如实报告**，不静默跳过）。 */
export function tracePayloads(core, eventType) {
  const rows = core.db.prepare('SELECT seq, payload FROM mana_trace WHERE event_type = ? ORDER BY seq ASC').all(eventType)
  return rows.map((r) => {
    try {
      return { seq: r.seq, payload: JSON.parse(r.payload) }
    } catch (error) {
      return { seq: r.seq, payload: null, parseError: String(error.message) }
    }
  })
}

/**
 * 把一组源文件克隆进临时目录并打补丁，返回可 import 的克隆入口路径。
 *
 * ⚠ **锚点零命中必须抛错**（逐条断言，不是在某个文件上断言）：锚点漂移会让变异
 *   **静默失效**（补丁没打上，测试照绿）—— 那正是"负向对拍"变成假绿的形态。
 */
export function cloneAndMutate(files, patches = [], entryFile = files[0]) {
  const dir = tmpDir('mana-mc-mut-')
  mkdirSync(join(dir, 'src'), { recursive: true })
  symlinkSync(P('node_modules'), join(dir, 'node_modules'), 'dir')

  /**
   * 相对 import 改写：**只在目标不在本次克隆集里时**才改写成绝对 file: URL。
   *
   * ⚠ 本席实测踩到的限制（改进记）：若**无条件**把相对 import 指向仓内 `src/`，
   *   那么「克隆 A + 克隆 B，只变异 B」时，A 里的相对 import 仍指向**仓内未变异的 B**
   *   ⇒ 变异**根本没被跑到**，而负向对拍会以"原判据没报红"的形态失败（或者更坏：
   *   判据恰好因为别的原因红了，给出**假信心**）。
   *   ⇒ 同批克隆的兄弟模块保持**相对**引用（克隆目录里彼此相邻），集外的才绝对化。
   */
  // ⚠ 本席实测踩到（记在这里防复发）：首版写成 `(...p) => files.some((f) => p === f)` ——
  //   用了 rest 参数 `p` 之后它是**数组**，`p === f` 恒 false ⇒ 判断恒假 ⇒
  //   **克隆体里的兄弟 import 仍指向仓内未变异的模块**，变异根本没被跑到。
  //   症状极具误导性：三条负向对拍同时报"原判据没报红"，看起来像**判据没有牙**，
  //   实际是**对拍打错靶**（本仓明文警告过的那一类）。故这里显式写出单参形态。
  const inSet = (name) => files.some((f) => f === name)
  const absolutize = (txt) =>
    txt.replace(/(from\s+|import\s*\()(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, pre, q, rel) => {
      const base = rel.split('/').pop()
      if (inSet(base)) return _m // 同批克隆：保持相对，解析到克隆目录里的那一份
      const abs = resolve(SRC, rel)
      return pre === '(' ? 'import(' + JSON.stringify(pathToFileURL(abs).href) : pre + q + pathToFileURL(abs).href + q
    })

  const texts = {}
  const hits = patches.map(() => 0)
  for (const f of files) {
    let txt = absolutize(readFileSync(join(SRC, f), 'utf8'))
    for (const [i, [from, to]] of patches.entries()) {
      const count = typeof from === 'string' ? txt.split(from).length - 1 : (txt.match(from) ?? []).length
      if (count === 0) continue
      hits[i] += count
      txt = typeof from === 'string' ? txt.split(from).join(to) : txt.replace(from, to)
    }
    texts[f] = txt
    writeFileSync(join(dir, 'src', f), txt)
  }
  for (const [i, [from]] of patches.entries()) {
    if (hits[i] === 0) {
      throw new Error(
        'cloneAndMutate: 补丁【' + String(from) + '】在 packages/metacognition/src/{' + files.join(',') + '} 全部零命中 —— ' +
          '锚点漂移会让变异静默失效，使"负向对拍"变成假绿（本仓：锚点必须显式断言命中）',
      )
    }
  }
  // ⚠ 入口文件可指定：多模块克隆时 `files[0]` 未必是暴露被测 API 的那一个
  //   （实测踩到：克隆 [profile, profile-pipeline, profile-index] 却 import 到 profile.ts，
  //    报 `createProfileIndex is not a function` —— 那是**对拍打错靶**，不是判据没牙）。
  if (!files.includes(entryFile)) {
    throw new Error('cloneAndMutate: entryFile(' + entryFile + ') 不在克隆集 {' + files.join(',') + '} 内')
  }
  return { entry: join(dir, 'src', entryFile), dir, texts, hits }
}

/**
 * **负向对拍的直接形态**：在**变异体**上跑**原判据**，断言它**必须报红**，并把红的内容回传。
 *
 * ⚠ 为什么必须有这个 helper（packages/user-model/tests/_harness.mjs:168-190 的实测教训）：
 *   把负向对拍写成"在变异体上再断言一次正确行为"，等于要求变异体也合格 ⇒ 它**永远红**，
 *   而与"原判据有没有牙"这件事**无关**——那种红给的是假信心。
 *   正确形态是：变异体 ⇒ 原判据 ⇒ **捕获到断言失败** ⇒ 才算这条腿有牙。
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
 * 写面完整性哨兵：落盘必须完整且可被引擎解析。
 * 口径 = `node --check`（引擎自己的解析器），不是字符计数（代理指标非判据）。
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

/** 断言文件存在（前置不满足时给出可读原因，而不是 ENOENT）。 */
export function mustExist(file) {
  assert.ok(existsSync(file), '缺文件 ' + file)
}
