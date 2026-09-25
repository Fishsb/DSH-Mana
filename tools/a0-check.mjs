#!/usr/bin/env node
/**
 * Mana 阶段 0 验收判据机检器（A0-1 … A0-14 + R0 + **A1 入口**）。
 *
 * 存在的理由：落地册的判据表是**给执行者看的**，而「照着执行」与「可重复机检」
 * 是两件事。本脚本把每条判据变成**可重跑的检查**，输出 PASS/FAIL/挂账三态。
 *
 * 用法：
 *   node tools/a0-check.mjs                  # 全量
 *   node tools/a0-check.mjs --json           # 机读输出
 *   node tools/a0-check.mjs --only A0-3,A0-8 # 只跑指定项（也可 --only A1 / R0）
 *   node tools/a0-check.mjs --record-baseline --expect <前缀> --accept-dirty "<理由>"
 *                                            # 重取基线（A0-10 的两仓基线 + A0-12 三件套 + 追加流水）
 *                                            # ⚠ 只由「唯一基线席」执行；--expect 为必填（本批预期写面前缀，可重复）
 *
 * ⚠ 纪律：
 *  · **不得用管道取退出码**（`node x.mjs | tail` 的 `$?` 是 tail 的）。要判真值须
 *    `node x.mjs >out 2>err; echo $?`。
 *  · **退出码语义表（三态，互不可混）**：
 *      `0` = 16 项判据无 FAIL（可含挂账）**且**（若带 `--record-baseline`）基线记录成功；
 *      `1` = 有判据 FAIL（无论基线记录成功与否 —— 判据结果不被记录动作掩盖）；
 *      `3` = **另一个 a0-check 实例正在运行**（单实例锁，并发纪律 §1）—— 本实例**不排队**、
 *    ⚠ 记录失败**不混进那 16 项**：一旦混进去，「判据绿但基线没记」与「判据真红」
 *      就不可分辨了 —— 那是另一种不可观测。两者必须能分开读（见文件末 `[baseline status]`）。
 *  · 「挂账」是**一等状态**，不等于通过（G14 挂账到阶段 1）。
 *  · **A1 腿**（`A1`）把 `tools/a1-check.mjs` 接进本链：建了却没被任何入口跑到的判据，
 *    等于没建（本会议实测：加 `check:a1` 之前它零调用者）。
 *
 * ⚠ 项数：**16 项**（A0-1…A0-14 计 14 + R0 + A1 入口）。本文件 2026-09-25 的两处改动
 *   （A0-10 加本仓腿 / A0-12 加流水腿）**不增删判据项** ⇒ 项数 16 → 16（无变化）。
 *   纪律见 `docs/contract/concurrency-discipline.md` §6：改 checker 须写明期望项数变化。
 */
import { execFileSync } from 'node:child_process'

import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const P = (...p) => join(ROOT, ...p)

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const ONLY = (() => {
  const i = argv.indexOf('--only')
  return i >= 0 ? new Set(String(argv[i + 1] ?? '').split(',').map((s) => s.trim())) : null
})()

/**
 * 本批**预期写面**前缀（`--expect <前缀>`，可重复）。
 * ⚠ `--record-baseline` 把它设为**必填** —— 见文件末「唯一基线席」前置门。
 */
const EXPECT = (() => {
  const out = []
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--expect') out.push(String(argv[i + 1] ?? '').trim())
  return out.filter(Boolean)
})()
/** `--accept-dirty "<理由>"`：允许在**脏树**上记录（收工录本批最终态用）。理由为空即拒绝 —— 空理由等于静默绕过。 */
const RECORD_MODE_ARG = argv.includes('--record-baseline')
const ACCEPT_DIRTY = argv.includes('--accept-dirty')
const ACCEPT_DIRTY_REASON = (() => {
  const i = argv.indexOf('--accept-dirty')
  return i >= 0 ? String(argv[i + 1] ?? '').trim() : ''
})()

const results = []
/** 记一条判据结果。state: 'PASS' | 'FAIL' | 'HANG'（挂账） */
function record(id, title, state, detail, evidence = '') {
  // ⚠ detail 统一追加取数坐标（F-06）：16 项**每项**都带，避免「有的项带、有的项不带」的漂移。
  results.push({ id, title, state, detail: withCoord(detail), evidence })
}
const pass = (id, t, d, e) => record(id, t, 'PASS', d, e)
const fail = (id, t, d, e) => record(id, t, 'FAIL', d, e)
const hang = (id, t, d, e) => record(id, t, 'HANG', d, e)

function run(cmd, args, opts = {}) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, ...opts }) }
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? ''), err: String(error.stderr ?? '') }
  }
}
function node(args, opts) {
  return run(process.execPath, args, opts)
}
/**
 * 跑一个探针脚本并取回它的 JSON 输出（最后一行）。
 *
 * ⚠ 之所以把探针做成**真文件**而不是内联字符串：内联时外层是模板字符串，
 *   内层探针里的 `${...}` 与反引号会被外层吞掉/截断（本仓实测踩过一次），
 *   表现为**语法错误**而非判据失败。真文件没有这层耦合。
 */
function evalJson(scriptPath) {
  const r = node([scriptPath])
  if (!r.ok) return { ok: false, error: (r.err || r.out).slice(0, 400) }
  try {
    return { ok: true, value: JSON.parse(r.out.trim().split('\n').pop()) }
  } catch (error) {
    return { ok: false, error: `输出解析失败: ${r.out.slice(0, 300)}` }
  }
}
const want = (id) => !ONLY || ONLY.has(id)

// ══ 单实例锁（并发纪律 §1 的机器落点；F-05b，主持人拍板口径 A）════════════════
//
// ⚠ 为什么必须「非零退出 + 打印持有者」而不是「静默排队」：并发实例会互相把对方的在途码
//   读进自己的读数（会议期间 ps 实拍三方并发跑同一 checker ⇒ 同 HEAD 下红绿互异、
//   _freeze.head 被写→回滚）。排队会把「两个实例同时在跑」变成不可见 —— 那正是要防的形态。
//
// ⚠ 锁对象含 `--record-baseline`：判据跑与录基线**互斥**（口径 A 的明确要求）。
// ⚠ 本闸在**任何判据腿之前**跑失败，避免把「拿不到锁」拖到最后才说。
// ⚠ 退出码语义**不变**（0/1/2 三态见文件头）；拿不到锁走 **3**（新形态，与既有三态不混）。
let lockRelease = null
/**
 * ⚠ **a0 两把锁一起拿**（本席实测踩到的一个真交互，不是想当然）：
 *   a0-check 的 A1 腿会 **spawn 一个 a1-check**（见下面 `if (want('A1'))` 段）。
 *   若 a0 只锁自己，跑 a0 的同时另一个席跑 a1 ⇒ 子进程 a1 拿不到锁、
 *   A1 腿**报红**，而 a0 自己会打印「可含挂账」之类别的字样 —— 读者会把
 *   「有人并发跑 a1」误读成「A1 判据真的挂了」（本席实拍：第一次对拍 D 正是这个形态）。
 *   ⇒ a0 必须**同时**持有 a0-lock 与 a1-lock；它 spawn 的子 a1 通过 `--held-lock <token>`
 *     证明「锁是父进程持有的」，从而**只校验、不重复获取**（见 a1 的锁段）。
 *   顺序固定（先 a0 后 a1）以避免两个方向各拿一把造成死锁；拿不到第二把则回退释放第一把。
 */
const LOCK_TOKEN = randomUUID()
try {
  const { acquireLock, processStartToken, lockPathFor } = await import('./checker-lock.mjs')
  const meta = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    commit: (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '?' } })(),
    argv: process.argv.slice(2).join(' ') || '(无参数)',
    checker: 'tools/a0-check.mjs',
    mode: RECORD_MODE_ARG ? 'record-baseline' : 'judge',
    startToken: processStartToken(process.pid),
  }
  const l0 = acquireLock(lockPathFor(ROOT, 'a0-check'), meta)
  let l1 = null
  try {
    l1 = acquireLock(lockPathFor(ROOT, 'a1-check'), { ...meta, checker: 'tools/a0-check.mjs(A1 腿)', token: LOCK_TOKEN })
  } catch (error) {
    l0.release()
    throw error
  }
  lockRelease = { release() { try { l1.release() } catch { /* ignore */ } try { l0.release() } catch { /* ignore */ } } }
} catch (error) {
  if (error.name === 'LockHeldError') {
    const h = error.holder ?? {}
    const who = String(h.checker ?? '').includes('a0') ? 'a0-check' : 'a1-check'
    console.error(`✗ 另一个 ${who} 实例正在运行 —— 本实例拒绝启动（**不排队**）`)
    console.error(`  持有者：pid=${h.pid} 起始时刻=${h.startedAt} commit=${h.commit} 模式=${h.mode} 参数=${h.argv}`)
    console.error(`  锁文件：${error.lockPath}`)
    console.error('  为什么拒绝排队：并发实例会互相把对方的在途码读进读数，判据红绿不可归因（并发纪律 §1）')
    console.error('  处置：等它跑完，或确认它已死（kill -9 后残留的锁会在下一次运行时被**留痕接管**）')
    process.exit(3)
  }
  throw error
}
// 正常路径与异常路径都要释放锁（否则一次崩溃会把后续全部挡死 —— 虽有接管兜底，也应及时释放）
process.on('exit', () => { try { lockRelease?.release() } catch { /* ignore */ } })


// ══ 取数三元组（并发纪律 §3 的机器落点；F-06）══════════════════════════════════
//
// ⚠ 为什么每条 detail 都要带它：会议期间 **HEAD 移动 3 次**、a1-check 项数 15→16，
//   而该变化**不是机器报警发现的，是人工比对发现的**。同一工作树 30 分钟内 A0 全量可翻转 ⇒
//   没有 commit + checker 指纹的读数**无法复现也无法归因**。
// 四元组：commit / checker-md5 / 关键环境变量 / 时刻（缺任一项即「浮动读数」）。
const COORD = (() => {
  const md5 = (p) => {
    try { return createHash('md5').update(readFileSync(p)).digest('hex') } catch { return '?' }
  }
  const envKeys = ['NODE_USE_ENV_PROXY', 'no_proxy', 'NO_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY']
  return {
    commit: (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '?' } })(),
    /** checker 自身的 md5（含本文件与它依赖的锁模块）—— 判据器改了而报告不变，是同一类不可归因。 */
    checkers: Object.fromEntries(
      ['tools/a0-check.mjs', 'tools/a1-check.mjs', 'tools/checker-lock.mjs'].map((f) => [f, md5(P(f))]),
    ),
    node: process.version,
    env: Object.fromEntries(envKeys.map((k) => [k, process.env[k] === undefined ? null : process.env[k]])),
    at: new Date().toISOString(),
  }
})()
/** 给任何 detail 追加取数坐标（统一一处实现，避免各处格式漂移）。 */
const withCoord = (detail) =>
  `${detail}｜取数坐标 commit=${COORD.commit} checker-md5=${COORD.checkers['tools/a0-check.mjs']?.slice(0, 12)} ` +
  `node=${COORD.node} NODE_USE_ENV_PROXY=${COORD.env.NODE_USE_ENV_PROXY ?? '(未设)'} at=${COORD.at}`
// ══ 共享小工具：单仓 git 探针 / 磁盘指纹 / 三件套路径 ═══════════════════════════
//
// ⚠ A0-10 与 A0-12 共用「同一时刻的同一取数面」——两处各写一份会立刻漂移，
//   且基线记录腿（文件末）是**第三处**使用点。故抽成模块级函数（本仓纪律：
//   逼近装配上限时抽模块级函数，而不是把同一段逻辑内联三遍）。
const gitProbe = (repo) => {
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.replace(/\s+$/, ''))
    // 拆成「**既有件**被动过」（`git status` 的已跟踪部分）与「新增未跟踪」两类。
    // ⚠ 「不碰既有件」判的是**前者**：一个新出现的未跟踪文件**不是**既有件
    //   （在并行波次里别席新建文件是正常现象）—— 但两者都要**如实报告**，不静默丢弃。
    const tracked = dirty.filter((l) => !l.startsWith('??'))
    const untracked = dirty.filter((l) => l.startsWith('??'))
    return {
      ok: true,
      head: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      dirty,
      tracked,
      untracked,
    }
  } catch (error) {
    return { ok: false, head: '?', dirty: [], tracked: [], untracked: [], error: String(error.message).split('\n')[0] }
  }
}
/** 脏树行里抽出文件路径（` M path` / `?? path` → `path`；重命名取新名）。 */
const dirtyPaths = (lines) => lines.map((l) => l.slice(3).trim().replace(/^.* -> /, ''))
/** 磁盘字节指纹：**读自磁盘**，不是调用方手里的内存值 —— 后者会掩盖「写失败但报了成功」。 */
const fpOf = (p) => {
  const buf = readFileSync(p)
  const st = statSync(p)
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, mtimeMs: Math.round(st.mtimeMs) }
}
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
/** A0-10 两仓基线的落盘位置（`tools/.a0-10-baseline.json`，*.gitignore:8* 已忽略）。 */
const A010_BASELINE = () => P('tools/.a0-10-baseline.json')
/** 契约快照三件套路径（**唯一真源** —— A0-12 与基线记录腿都取自这里，不得各写一份）。 */
const FREEZE_FILES = () => ({
  sha256: P('docs/contract/_freeze.sha256'),
  list: P('docs/contract/_freeze.files.txt'),
  head: P('docs/contract/_freeze.head'),
})
/** 快照变更流水（append-only JSON Lines）——见 `docs/contract/concurrency-discipline.md` §二。 */
const FREEZE_LEDGER = () => P('docs/contract/_freeze.log')
/**
 * **基线机制自身的产物**（重取基线时按设计会被改写的那几件）。
 *
 * ⚠ A0-10「不碰既有件」判的是**别的既有件**有没有被动过；这几件是**记录动作本身**的产物，
 *   若把它们计进「已跟踪脏行」，则**每一次合法的重取基线都会把下一轮 A0-10 判红** ——
 *   自指闭环，且是假红（记录成功反而报红）。
 *   但**不能因此留下盲区**：这几件的「记录之后又被改写」由 **A0-12 的流水腿**逐字看守
 *   （磁盘指纹 vs 流水末条），覆盖更强 —— 故此处排除它们**不产生静默漏洞**，
 *   只把看守责任从 A0-10 移交给 A0-12。两处必须一起读，见本文件 A0-12 块头注。
 */
const FREEZE_OWN = ['docs/contract/_freeze.sha256', 'docs/contract/_freeze.files.txt', 'docs/contract/_freeze.head', 'docs/contract/_freeze.log']
/** 清单腿的权威 walk（**唯一真源**：不得在第二处手写同一串 find 参数）。 */
const canonWalk = () =>
  execFileSync('bash', ['-lc', "find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/lib/*' | sort"], {
    cwd: ROOT,
    encoding: 'utf8',
  })

/**
 * 读快照流水（容错：坏行**不静默丢弃** —— 返回 `badLines` 由调用方报红）。
 * ⚠ 「读不到/坏行」与「没有流水」是两件事：前者不许当成后者（否则删掉流水即可免检）。
 */
const readLedger = (p) => {
  if (!existsSync(p)) return { exists: false, entries: [], badLines: [] }
  const raw = readFileSync(p, 'utf8')
  const entries = []
  const badLines = []
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return
    try {
      entries.push(JSON.parse(stripBom(line)))
    } catch {
      badLines.push(i + 1)
    }
  })
  return { exists: true, entries, badLines }
}

/** ref 是否**仍是现 HEAD 的祖先** —— 兼容短哈希与全哈希两种落盘形态。 */
const isAncestor = (ref) => isAncestorOf(ref, 'HEAD')
/** a 是否为 b 的祖先（同仓）。用于流水「锚点只能向前」腿。 */
const isAncestorOf = (a, b) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', String(a).trim(), String(b).trim()], { cwd: ROOT, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// ══ A0-1 环境钉点一致 ═══════════════════════════════════════════════════════
if (want('A0-1')) {
  const v = process.version
  const exp = 'v22.22.1'
  const sqliteKeys = (() => {
    const r = node(['-e', "const s=require('node:sqlite');console.log(Object.keys(s).join(','))"])
    return r.ok ? r.out.trim().split('\n').pop() : '(读不到)'
  })()
  const expExports = 'DatabaseSync,StatementSync,constants,backup'
  const dsh = run('npm', ['ls', '-g', '@deepseek-ai/dsh', '--depth=0'])
  const dshDir = '/usr/local/lib/node_modules/@deepseek-ai/dsh'
  let dshVer = '?'
  let cordisVer = '?'
  try {
    dshVer = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8')).version
    cordisVer = JSON.parse(
      readFileSync(join(dshDir, 'node_modules/@deepseek-ai/cordis/package.json'), 'utf8'),
    ).version
  } catch {
    /* 读不到即上层判 FAIL */
  }
  const ok = v === exp && sqliteKeys === expExports && Boolean(dshVer !== '?')
  const detail = `node ${v}（期望 ${exp}）· node:sqlite 导出「${sqliteKeys}」· DSH ${dshVer} / cordis ${cordisVer}`
  if (ok) {
    pass('A0-1', '环境钉点一致', detail, `$ node -v; node -e "…Object.keys(require('node:sqlite'))"; 版本已记入 §2.1`)
  } else {
    fail('A0-1', '环境钉点一致', `${detail}｜dsh ls ok=${dsh.ok}`, '环境已变，须按 §2.1 版本纪律重跑受影响判据')
  }
}

// ══ A0-2 扩展加载窗口未走错（负向判据）════════════════════════════════════════
if (want('A0-2')) {
  const r = evalJson(P('tools/probes/a02-extension-window.mjs'))
  const v = r.value ?? {}
  if (v.defaultCtorThrew === true && v.allowExtOk === true && /disabled at database creation/.test(v.msg ?? '')) {
    pass('A0-2', '扩展加载窗口未走错（负向）', `默认 ctor 抛「${String(v.msg).slice(0, 58)}…」；{allowExtension:true} 成功`, '两者都要真（G4，不可后补）')
  } else {
    fail('A0-2', '扩展加载窗口未走错（负向）', JSON.stringify(v) + (r.error ? ` 错误:${r.error}` : ''), '修开库点；不可后补')
  }
}

// ══ A0-3 中文分词口径（负向判据）════════════════════════════════════════════
if (want('A0-3')) {
  const r = evalJson(P('tools/probes/a03-tokenizer.mjs'))
  const v = r.value ?? {}
  if (v.tri4 >= 1 && v.def4 === 0 && v.defEn === 1 && v.tri2 === 0) {
    pass('A0-3', '中文分词口径（负向）', `trigram 4字命中=${v.tri4}；默认分词器中文=${v.def4}；英文证明非库空=${v.defEn}；trigram 2字静默空=${v.tri2}`, '契约锁定 tokenize=trigram + MIN_QUERY_CHARS=3（G5）')
  } else {
    fail('A0-3', '中文分词口径（负向）', JSON.stringify(v), '契约冻结前改 tokenizer + 最小长度')
  }
}

// ══ A0-4 typecheck 真接了宿主类型（负向判据）══════════════════════════════════
if (want('A0-4')) {
  // 负向探针是一份**真源文件**（tools/probes/a04-negative-typecheck.mjs），
  // 它故意引用不存在的宿主事件名 ⇒ tsc **必须**报错。
  const r = node([
    P('node_modules/typescript/bin/tsc'),
    '-p',
    P('tools/probes/a04-tsconfig.json'),
  ])
  if (!r.ok && /not assignable to parameter of type 'keyof Events'/.test(r.out)) {
    pass('A0-4', 'typecheck 真接了宿主类型（负向）', '引用不存在的宿主事件名 ⇒ tsc 正确报 keyof Events 不匹配', '反向：不报错即「类型检查未接上宿主类型」，后续 typecheck 判据全不可信')
  } else {
    fail('A0-4', 'typecheck 真接了宿主类型（负向）', `tsc 未按预期报错（ok=${r.ok}）：${(r.out || r.err).slice(0, 240)}`, '修 tsconfig/依赖')
  }
}

// ══ A0-5 插件形状静态可证（**扫实际目录**，不再硬编码清单）══════════════════════
//
// ⚠ 历史缺陷（本仓 2026-09-24 实测）：旧版 `DIRS` 是**硬编码 6 元素**，而仓库已有 13 个包
//   ⇒ 7 个后建包（P1/P2）的形状与命名**从未被机检过**。同一时刻 `docs/contract/naming.md`
//   也只列 6 个包 ⇒ 「契约表」与「机检」**互为盲区**。按该契约开头的成因说明，
//   三者名字不一致「只在运行期表现为插件不启动」，编译期完全看不出来 —— 正是最该防的形态。
//   现改为：① 扫实际 `packages/*` 目录（真源）；② 逐包核四要素；③ patch id 必须与 `name` 一致；
//   ④ `naming.md` 必须覆盖每个包（契约漂移也能被发现）。
if (want('A0-5')) {
  const pkgRoot = P('packages')
  const dirs = existsSync(pkgRoot)
    ? readdirSync(pkgRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : []
  const bad = []
  const naming = existsSync(P('docs/contract/naming.md'))
    ? readFileSync(P('docs/contract/naming.md'), 'utf8')
    : ''
  for (const dir of dirs) {
    const src = P('packages', dir, 'src/index.ts')
    const patch = P('packages', dir, 'cordis.patch.yml')
    const txt = existsSync(src) ? readFileSync(src, 'utf8') : ''
    // 形状判据（**区分合法形态**，本仓 2026-09-24 普查后定）：
    //   · `name` / `inject` / `apply` —— 全部包必备（cordis 三要素）。
    //   · `Config` —— **三形态都合法**：① schemastery `export const Config`；
    //     ② 纯类型 `export interface Config` + 代码内缺省（如 ui 的 `DEFAULT_CONFIG`）；
    //     ③ 完全无配置（如 long-term/consolidation/forgetting 三个骨架）。
    //     ⚠ 因此**不能**硬性要求 `export const Config` —— 那会造出 4 个假红。
    //     真约束是：**若声明了 `export const Config`，它必须是 schemastery schema**（可被宿主校验）。
    const hasBase =
      /export const name/.test(txt) && /export const inject/.test(txt) && /export function apply/.test(txt)
    if (!hasBase) {
      bad.push(`${dir}: name/inject/apply 不齐`)
      continue
    }
    if (/export const Config\s*=/.test(txt) && !/Schema\.object\(|Schema\.union\(|Schema\.boolean\(/.test(txt)) {
      bad.push(`${dir}: export const Config 存在但不像 schemastery schema`)
      continue
    }
    if (!existsSync(patch)) {
      bad.push(`${dir}: 缺 cordis.patch.yml`)
      continue
    }
    // patch id 必须与插件 name 一致（不一致 ⇒ 装配面与 inject 面各说各话）。
    const name = (/export const name\s*=\s*['"]([^'"]+)['"]/.exec(txt) ?? [])[1]
    const patchId = (/^\s*-\s*id:\s*(\S+)/m.exec(readFileSync(patch, 'utf8')) ?? [])[1]
    if (!name) bad.push(`${dir}: 取不到 name`)
    else if (patchId !== name) bad.push(`${dir}: patch id(${patchId}) ≠ name(${name})`)
    // 契约表必须覆盖（否则命名契约本身漂移）。
    if (!naming.includes(`packages/${dir}\``)) bad.push(`${dir}: naming.md 未登记`)
  }
  if (bad.length === 0 && dirs.length > 0) {
    pass('A0-5', '插件形状静态可证', `${dirs.length}/${dirs.length} 包 name/inject/apply 齐 + Config 形态合法 + patch id 与 name 一致 + naming.md 全覆盖`, '')
  } else {
    fail('A0-5', '插件形状静态可证', `共 ${dirs.length} 个包；问题: ${bad.join(' / ') || '(目录为空)'}`, '回骨架/命名契约步骤')
  }
}

// ══ A0-6 CI 绿（新仓自测）════════════════════════════════════════════════════
if (want('A0-6')) {
  const tc = run('npm', ['run', 'typecheck', '--silent'])
  const tt = run('npm', ['test', '--silent'])
  const tcOk = tc.ok
  const ttOk = tt.ok
  // 抽出测试计数
  const m = /# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/.exec(tt.out + tt.err)
  const counts = m ? `tests ${m[1]} / pass ${m[2]} / fail ${m[3]}` : '（计数未解析到）'
  if (tcOk && ttOk && m && Number(m[3]) === 0) {
    pass('A0-6', 'CI 绿（新仓自测）', `typecheck exit 0；test exit 0（${counts}）`, '⚠ 不以样板为绿基线；本值产自本仓')
  } else {
    fail('A0-6', 'CI 绿（新仓自测）', `typecheck ok=${tcOk}；test ok=${ttOk}；${counts}`, '先修宿主 API 类错误再进阶段 1')
  }
}

// ══ A0-7 测试命令写法正确（负向判据）════════════════════════════════════════
if (want('A0-7')) {
  const good = run('npm', ['test', '--silent'])
  // 注意：本仓测试在各 workspace 内，故此处的"错误写法"探针直接在 core 包内构造
  const bad = node(['--test', 'packages/core/tests/'], { cwd: ROOT })
  const badLooksLikeFailure = /# fail [1-9]/.test(bad.err + bad.out) || /Cannot find module/.test(bad.err + bad.out)
  if (good.ok && badLooksLikeFailure) {
    pass('A0-7', '测试命令写法正确（负向）', '正确写法 exit 0；`node --test <目录>/` 形似失败（Cannot find module / # fail 1）', '禁止写成目录形式：会把执行者误导去查测试代码')
  } else {
    fail('A0-7', '测试命令写法正确（负向）', `good.ok=${good.ok}; bad 形似失败=${badLooksLikeFailure}`, '改 CI 脚本写法')
  }
}

// ══ A0-8 session_id/turn_id 列已补 + inject_log 表已建 + 存量库迁移真生效 ═══════
if (want('A0-8')) {
  const r = evalJson(P('tools/probes/a08-schema.mjs'))
  const v = r.value ?? {}
  // ⚠ 判据分三层，**缺一不可**：
  //   ① 列已补 / inject_log 已建 / gate 枚举被拒 / FTS 虚表在（原有的「静态面」）；
  //   ② **存量库补列真生效**（差分判据：迁移后的旧库列集合 == 全新库列集合）。
  //   只判 ① 曾经放过一个真缺陷：`createSchema` 对存量库是静默空操作（`IF NOT EXISTS`
  //   对已存在的表不施加任何变更），而落地册明文要求阶段 1/3 给 `jev_log` 补列 ⇒
  //   那些列**永远不会出现在存量库且不报错**。② 让这件事可机检。
  //   ③ 迁移**原子性**：不可补的列（SQLite 不许 ADD NOT NULL 无 DEFAULT）必须整体拒绝，
  //   不得留下「前几列已加、后面没加」的半迁移库。
  const staticOk =
    r.ok && v.missing?.length === 0 && v.hasTraceST && v.hasMemST && v.hasJevST && v.badGateRejected && v.fts
  const migrationOk =
    Array.isArray(v.migrationMismatches) &&
    v.migrationMismatches.length === 0 &&
    Number(v.migrationApplied) > 0 &&
    Number(v.migrationIndexes) >= 4 &&
    v.migrationSentinelKept === true
  const atomicOk = v.blockedThrew === true && v.blockedLeftPartial === false
  const ok = staticOk && migrationOk && atomicOk
  const detail =
    `inject_log 缺列=${JSON.stringify(v.missing)}；` +
    `mana_trace/jev_log/memory_items 含 session_id+turn_id=${v.hasTraceST}/${v.hasJevST}/${v.hasMemST}；` +
    `非法 gate 被拒=${v.badGateRejected}；FTS5 虚表=${v.fts}；journal_mode=${v.journalMode}；` +
    `存量库补列=${v.migrationApplied} 且与全新库差异=${JSON.stringify(v.migrationMismatches)}；` +
    `索引重建=${v.migrationIndexes}；旧行保留=${v.migrationSentinelKept}；` +
    `不可补列整体拒绝=${v.blockedThrew}/留半迁移态=${v.blockedLeftPartial}`
  const TITLE = '补列 + inject_log 表已建 + 存量库迁移生效'
  if (ok) {
    pass('A0-8', TITLE, detail, '')
  } else {
    const why = !staticOk
      ? '静态面不合格'
      : !migrationOk
        ? '存量库补列未生效（旧实现会静默放过此类失败）'
        : '迁移原子性不合格（拒绝时留下半迁移态）'
    fail('A0-8', TITLE, `${why}；${detail}${r.ok ? '' : ` 错误:${r.error}`}`, '未补前 I1/I2（A1-2/A1-3）不得放行')
  }
}

// ══ A0-9 方案 §14 落点齐备 ═══════════════════════════════════════════════════
if (want('A0-9')) {
  const mapFile = P('docs/arch/spec14-observability-map.md')
  if (existsSync(mapFile)) {
    const txt = readFileSync(mapFile, 'utf8')
    const rows = txt.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l))
    const unobservable = (txt.match(/不可观测/g) ?? []).length
    if (rows.length >= 10) {
      pass('A0-9', '方案 §14 落点齐备', `${rows.length} 条故障模式各有落点；其中标「不可观测」${unobservable} 处`, '给不出落点者不得静默通过')
    } else {
      fail('A0-9', '方案 §14 落点齐备', `仅 ${rows.length} 条有病模式行（需 10）`, `补 ${mapFile}`)
    }
  } else {
    fail('A0-9', '方案 §14 落点齐备', `缺对照表：${mapFile}`, '每条故障模式必须给出表/字段名，给不出即标「不可观测」')
  }
}

// ══ A0-10 不碰既有件（**两仓都判**）════════════════════════════════════════════
//
// ⚠ 本批（2026-09-25）修掉的缺陷：本判据原只判 `/home/lk/dsh-src/dsh-plugin-roundtable`
//   一个**仓外**样板仓，而 Mana **本仓无人看守** —— 判据名叫「不碰既有件」，
//   实际检查的是「另一个仓没被动过」，而本批全部工作在**本仓**。
//   这是本项目最在意的形态：**判据绿 ≠ 事实被检查**。
//   实测取证：`docs/mana-v10-review-and-allocation.md:82`（§D6：工作树无独占期）。
//
// 语义（**不是与固定数字相等**，原文 `docs/mana-rollout-plan.md:374`）：
//   两仓各自的 (HEAD, 已跟踪脏行集合) ⇒ 与「本批开工前实测值」相等。
//
// ⚠ **被检查量为什么是「已跟踪脏行」而不是「dirty 行数」**（本批实测踩到的坑）：
//   本仓**工作树无独占期**（并发纪律 §4），开工基线记录那一刻起，别席随时会新建
//   **未跟踪**文件（`?? path`）。若把 `??` 行计进基线，则**任何一个别席新建文件**
//   都会让本判据报红 —— 那是**假红**，很快会退化成「噪声判据」（`threshold-discipline.md` 明令禁止）。
//   「不碰既有件」的原文语义指向**既有件** ⇒ 被检查量 = 已跟踪文件的脏行集合。
//   未跟踪文件**如实报告但不判红**（v10 评审 §D7 的教训正是「报告了却没进判定」的反面，
//   这里两条都要：**看得见**，且**不制造假红**）。
// ⚠ **未覆盖面（如实标注）**：本判据看不见「当次运行开始时树是什么样」——
//   若别席在本判据**前后两次运行之间**新建又删除文件，两次读数完全相同 ⇒ 不可见。
//   该形态需更上层取证（filesystem 审计 / git 对象层），此处**不假装已覆盖**。
//   （本判据能覆盖的：HEAD 移动、既有件被改/被删、既有在途件消失、基线缺失 —— 四条均有负向探针实测。）
//
// 生效条件（**不隐藏判据腿**）：
//   · 本仓腿 **常开** —— 本批工作全在本仓，它必须每跑必判；
//   · 样板腿 仅当基线里**真存有**该仓基线时才判 —— 否则「该仓此刻是脏是净」与本批无关，
//     拿一个从未记过基线的仓去判红是**假红**。
if (want('A0-10')) {
  const SAMPLE = '/home/lk/dsh-src/dsh-plugin-roundtable'
  const REQUIRED = 'docs/contract/concurrency-discipline.md'
  const base = (() => {
    try {
      const raw = JSON.parse(readFileSync(A010_BASELINE(), 'utf8'))
      // 兼容本批之前的旧格式（顶层 {head,dirty}，只含样板仓）
      if (raw && raw.head !== undefined && !raw.sample) {
        return { self: raw.self ?? null, sample: { head: raw.head, dirty: raw.dirty } }
      }
      return { self: raw?.self ?? null, sample: raw?.sample ?? null, expect: raw?.expect ?? null }
    } catch {
      return null
    }
  })()
  const self = gitProbe(ROOT)
  const sample = gitProbe(SAMPLE)
  // ⚠ **本席声明的写面**取自**基线**（记录时由唯一基线席声明），不是本次运行再声明 ——
  //   判据跑起来时（`node tools/a0-check.mjs`）**没有人再声明**写面；
  //   若此处退回本地 `EXPECT`（空），则最常见的用法必然报「全部越界」= 假红。
  //   运行时 `--expect` 只在**显式覆盖**（换一批）时用。
  const writeFace = EXPECT.length ? EXPECT : (base?.expect ?? [])
  const desc = (p) => (p.ok ? `HEAD=${p.head}、已跟踪脏 ${p.tracked.length}、未跟踪 ${p.untracked.length}` : `读取失败（${p.error}）`)
  const detail = `本仓 ${desc(self)}；样板 ${desc(sample)}`
  if (!base) {
    fail('A0-10', '不碰既有件', `基线未记录（${detail}）；先跑 --record-baseline --expect <本批写面>`, '判据形态 = 与开工前实测值相等，不是与固定数字相等')
  } else {
    const drift = []
    const freezeOwnNoise = dirtyPaths(self.tracked).filter((p) => FREEZE_OWN.includes(p)).length
    const beforeCount = (base.self?.trackedPaths ?? []).filter((p) => !FREEZE_OWN.includes(p)).length
    if (!base.self) {
      drift.push('本仓腿**无基线**（带本仓基线的 --record-baseline 尚未跑过 ⇒ Mana 本仓无人看守）')
    } else if (!base.self.headFull) {
      drift.push('本仓基线**缺 headFull**（越界腿需要它枚举「基线锚点..HEAD」的提交）⇒ 不可判；重取基线补齐')
    } else if (!isAncestorOf(base.self.headFull ?? base.self.head, 'HEAD')) {
      // 锚点语义（与 A0-12 的 HEAD 腿同源）：基线锚点必须仍在历史里。
      // ⚠ **不**要求「HEAD 逐字不变」：本仓 HEAD 本来就会因本席的收工提交而前进，
      //   把「HEAD 变了」判红会造出「一会儿过一会儿不过」的腿（threshold-discipline.md 明令禁止）。
      drift.push(`本仓基线锚点已不在历史中：${String(base.self.headFull ?? base.self.head).slice(0, 7)} 不是现 ${self.head} 的祖先`)
    }

    // ── 越界腿（A0-10 本仓腿的**真正判据**）────────────────────────────────
    //
    // 判什么：「本批动过的**既有件**，必须每一件都有主」——
    //   · 落在本席声明的写面内（`--expect`），**或**
    //   · 在**基线时刻就已是别席的在途件**（基线已记录在案，本批开工前就在脏着），**或**
    //   · 是**新增未跟踪文件**（不是「既有件」，见块头注）。
    // 三者之外 = **无主的既有件改动** ⇒ FAIL。
    //
    // ⚠ 为什么不判「所有改动都必须是我的」：本仓**工作树无独占期**（并发纪律 §4），
    //   同时有 4–6 席在写同一棵树；那样判会让**每一次**运行都红（别席的在途件永远在），
    //   是纯假红。真正该抓的是「**有人碰了既有件而没人认领**」——那才是「不碰既有件」的失效形态。
    // ⚠ 为什么提交面与脏面**分开**判：本仓**只有一个 git 写席**（并发纪律 §4）⇒
    //   `基线锚点..HEAD` 区间内的提交**只能是本席的** ⇒ 其内容必须**全部**落在声明写面内；
    //   而脏面允许含别席在途件（须在基线里已记录在案）。
    // ⚠ 未覆盖面（如实标注）：本判据看不见「当次运行开始时树是什么样」——
    //   别席在**两次运行之间**新建又删除文件，两次读数完全相同 ⇒ 不可见；需更上层取证。
    let anchorUnreachable = null
    const faceReportExtra = []
    // ⚠ 必须 try/catch：基线锚点若已不可达（被抛弃 / 打进 rebase / 对象缺失），
    //   `git diff <锚点>..HEAD` 会**抛错**；不接住的话整个判据器**崩溃退出** ——
    //   那是「失败不可观测」的另一种形态：不是红，而是**没有读数**。
    //   实测（本批负向对拍 E）：`fatal: Invalid revision range deadbeef..HEAD` + node 栈。
    const changedInCommits = (() => {
      if (!base.self?.headFull) return []
      try {
        return execFileSync('git', ['diff', '--name-only', `${base.self.headFull}..HEAD`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .filter((p) => !FREEZE_OWN.includes(p))
      } catch (error) {
        anchorUnreachable = String(error.message).split('\n')[0]
        return []
      }
    })()
    const dirtyNow = dirtyPaths(self.tracked).filter((p) => !FREEZE_OWN.includes(p))
    const inFlightAtBaseline = new Set((base.self?.trackedPaths ?? []).filter((p) => !FREEZE_OWN.includes(p)))
    const committedOutside = changedInCommits.filter((p) => !writeFace.some((pre) => p.startsWith(pre)))
    const dirtyUnattributed = dirtyNow.filter(
      (p) => !writeFace.some((pre) => p.startsWith(pre)) && !inFlightAtBaseline.has(p),
    )
    const noFace = Boolean(base.self) && writeFace.length === 0
    if (anchorUnreachable) {
      // 锚点不可达时提交面**无法枚举** ⇒ 如实标注「本轮不可判」，不假装枚举到了 0 件。
      faceReportExtra.push(`提交面**不可枚举**（锚点不可达：${anchorUnreachable}）⇒ 越界腿本轮只覆盖脏面`)
    }
    const faceOk = !base.self || (!noFace && committedOutside.length === 0 && dirtyUnattributed.length === 0)
    if (noFace) {
      drift.push('基线**未声明写面**（--expect 为空）⇒ 越界腿不可判（不得静默通过）；重取基线时须声明本批写面')
    } else if (base.self && committedOutside.length) {
      drift.push(
        `**提交里夹带了写面外文件**（${committedOutside.length} 件，本仓只有本席一个 git 写席 ⇒ 只能是本席所为）` +
          `：${JSON.stringify(committedOutside.slice(0, 8))}｜声明写面 = ${JSON.stringify(writeFace)}`,
      )
    } else if (base.self && dirtyUnattributed.length) {
      drift.push(
        `**无主的既有件改动**（${dirtyUnattributed.length} 件：既不在声明写面内，基线时刻也不在途）` +
          `：${JSON.stringify(dirtyUnattributed.slice(0, 8))}｜声明写面 = ${JSON.stringify(writeFace)}`,
      )
    }
    // 已记在案、现又变干净的在途件（被提交或被执行者还原）—— **报告但不判红**：
    // 归属已知、且有单一 git 写席兜底（若它进了提交，上一条会抓）。
    const settled = [...inFlightAtBaseline].filter((p) => !dirtyNow.includes(p) && !changedInCommits.includes(p))
    const faceReport =
      `越界腿=${
        !base.self
          ? '无基线'
          : noFace
            ? '**不可判**（基线未声明写面）'
            : faceOk
              ? `通过：提交 ${changedInCommits.length} 件 ⊆ 写面；脏 ${dirtyNow.length} 件中 ${
                  dirtyNow.filter((p) => writeFace.some((pre) => p.startsWith(pre))).length
                } 件属本席、${dirtyNow.filter((p) => !writeFace.some((pre) => p.startsWith(pre))).length} 件为基线在途（有主）`
              : `${committedOutside.length} 件提交越界 + ${dirtyUnattributed.length} 件无主脏`
      }` +
      `${settled.length ? `｜已有主而在途结束 ${settled.length} 件（报告不判红）：${JSON.stringify(settled.slice(0, 4))}` : ''}` +
      `${faceReportExtra.length ? `｜${faceReportExtra.join('；')}` : ''}` +
      `${changedInCommits.length ? `｜锚点 ${String(base.self.headFull).slice(0, 7)}→现 ${self.head}（本席收工提交，锚点语义允许）` : ''}`

    const legs = `本仓腿=${base.self ? '已判' : '无基线'}；样板腿=${base.sample ? '已判' : '无基线（不判）'}`
    const extra = `本轮未跟踪新增 ${self.untracked.length} 件（**不判红**，见本块头注：`??` 不是既有件）：${JSON.stringify(dirtyPaths(self.untracked).slice(0, 4))}`
    if (drift.length === 0) {
      pass('A0-10', '不碰既有件', `${faceReport}｜${detail}｜${legs}｜${extra}`, `基线 = ${REQUIRED} §2 的唯一基线席落于 tools/.a0-10-baseline.json（*.gitignore:8* 已忽略）`)
    } else {
      fail('A0-10', '不碰既有件', `${drift.join('；')}｜${faceReport}｜${detail}｜${legs}｜${extra}`, '先按**路径**判归属：属本批预期写面 = 记入收工复核；属别席在途 = 不改状态、写入报告；属写面外 = 真越界')
    }
  }
}

// ══ A0-11 独立心跳存在且新鲜 ════════════════════════════════════════════════
if (want('A0-11')) {
  const heartbeat = join(process.env.DSH_HOME?.trim() || join(process.env.HOME ?? '', '.dsh'), 'memory', 'mana.heartbeat')
  const script = P('tools/mana-heartbeat.mjs')
  const cronHint = '（须由 Mana 之外的东西定时运行：crontab 或 systemd timer）'
  if (!existsSync(script)) {
    fail('A0-11', '独立心跳存在且新鲜', `缺心跳脚本 ${script}`, '心跳必须外部写，否则会在最需要它时一起死')
  } else if (!existsSync(heartbeat)) {
    fail('A0-11', '独立心跳存在且新鲜', `心跳文件不存在：${heartbeat}${cronHint}`, '装上定时任务后重跑本判据')
  } else {
    const txt = readFileSync(heartbeat, 'utf8').trim()
    let ageMin = Number.POSITIVE_INFINITY
    try {
      ageMin = (Date.now() - statSync(heartbeat).mtimeMs) / 60000
    } catch {
      /* ignore */
    }
    if (ageMin <= 10) {
      pass('A0-11', '独立心跳存在且新鲜', `新鲜度 ${ageMin.toFixed(1)} 分钟（≤10）；内容 ${txt.slice(0, 120)}`, '独立性判据须在「卸载全部 Mana 插件」后重跑：仍更新才算外部写')
    } else {
      fail('A0-11', '独立心跳存在且新鲜', `新鲜度 ${ageMin.toFixed(1)} 分钟（>10）${cronHint}`, '回阶段 0 心跳步骤')
    }
  }
}

// ══ A0-12 契约快照三件套（哈希 + 清单 + HEAD）**三条腿都必须被真读** ═══════════
//
// ⚠ 历史缺陷（本仓 2026-09-24 实测）：旧判据只哈希 2 个**硬编码**文件，
//   `_freeze.files.txt` 与 `_freeze.head` **全仓无人读取** —— 于是清单腿漂了 25 行
//   （10 → 35 件）**没有任何判据报警**，而是 7 个会话各自在交接单里手写「清单腿已漂」。
//   教训：**只存不验 = 漂移不可见**。存下来的快照必须由机检真正比对。
//
// ⚠ 第二轮缺陷（本批 2026-09-25 修，v10 评审 §D7）：上面三条腿**都只看「现值像不像初始态」**，
//   于是**「写了又回滚」走完一个完整循环后照样绿**。实测（`docs/mana-v10-review-and-allocation.md:84-90`）：
//     `_freeze.head` 07:30:31 被 `--record-baseline` 写入（当时 HEAD `76fcce7`）
//     → 07:53:27 被回滚回 `ee9e22e`；回滚后 ① 文件值 = 初始值 ② `git status docs/contract/` 为空
//     ③ 三件套内容与 HEAD 版一致 —— 三种常规检查**全看不出**，而 HEAD 腿（「锚点仍是祖先」）
//     **回滚后依然成立** ⇒ 一个什么都没做的动作被判通过。
//   处置（两条新腿，**不降级**原三腿；判据仍为 16 项之 1，不新增项）：
//     · **流水腿**：`docs/contract/_freeze.log` 末条 `files` 指纹必须与**当前磁盘**三件套逐字相等
//       ⇒ 「记录之后又被改写」（含写了又回滚）立即报红；
//     · **锚点不回退腿**：流水内 head 锚点只能**向前** ⇒ 「回滚到旧锚点后重新记录」仍留痕。
//   ⚠ **不得**改用 mtime 判红：mtime 可被 `touch` 伪造、`git checkout/clone` 会整体重置
//     ⇒ 会造出「一会儿过一会儿不过」的判据（`threshold-discipline.md` 明令禁止）。
//     mtime **只作提示性证据**（同批性提示），不参与判定。
//   ⚠ **未覆盖面（如实标注）**：完全绕开记录路径的「手工写 → 手工回滚」
//     （或写入后逐字节还原）不进入流水 ⇒ 本判据检出不了。原因与上面「不得用 mtime 判红」同源；
//     要闭合需更上层取证（git 对象层 / 审计日志），此处**不假装已覆盖**。
if (want('A0-12')) {
  const { sha256: snap, list: listFile, head: headFile } = FREEZE_FILES()
  const ledgerFile = FREEZE_LEDGER()
  const srcFiles = ['event-types.ts', 'domain.ts'].map((f) => P('packages/core/src', f))
  const rel = (f) => f.slice(ROOT.length + 1)
  const now = srcFiles
    .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${rel(f)}`)
    .join('\n')

  // 清单腿：与权威 walk 逐行 diff（**排除 lib/**：构建产物会让清单随 build 漂移）。
  const canonList = canonWalk()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const storedList = existsSync(listFile)
    ? readFileSync(listFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : null
  // HEAD 腿：判「快照锚点仍在历史里」而**不是**「等于当前 HEAD」。
  //
  // ⚠ 这里踩过一次「坏判据」（本席 2026-09-24 自纠）：最初写成 `storedHead === actualHead`，
  //   但**每次提交 HEAD 都会前进** ⇒ 该判据会在每次提交后变红，成为「一会儿过一会儿不过」
  //   的判据（`threshold-discipline.md` 明令禁止：最终会被当成噪声忽略）。
  //   正确语义 = **锚点单调性**：存下的 HEAD 必须仍是当前 HEAD 的祖先（快照可回滚到它）。
  //   这样提交不会误红，而「快照指向一个不存在/已被抛弃的提交」仍会被抓住。
  //   ⚠ 它**单独不足以**发现 D7 的回滚 —— 见上方第二轮缺陷说明（故有下面两条新腿）。
  const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const storedHead = existsSync(headFile) ? readFileSync(headFile, 'utf8').trim() : null
  const headIsAncestor = storedHead !== null && storedHead.length > 0 && isAncestor(storedHead)

  const missing = []
  if (!existsSync(snap)) missing.push(`_freeze.sha256（当前值=\n${now}）`)
  if (storedList === null) missing.push('_freeze.files.txt')
  if (storedHead === null) missing.push('_freeze.head')
  if (missing.length) {
    fail('A0-12', '契约快照三件套已存且已核', `缺 ${missing.join(' / ')}`, '跑 tools/a0-check.mjs --record-baseline --expect <本批写面> 生成')
  } else {
    const hashOk = readFileSync(snap, 'utf8').trim() === now.trim()
    const hashOnlyAdd = (storedList ?? []).filter((l) => !canonList.includes(l))
    const hashOnlyDel = canonList.filter((l) => !(storedList ?? []).includes(l))
    const listOk = hashOnlyAdd.length === 0 && hashOnlyDel.length === 0
    const headOk = headIsAncestor

    // ── 新腿 ①：流水腿（磁盘三件套 vs 流水末条记录）──────────────────────────
    const ledger = readLedger(ledgerFile)
    const trio = [
      { key: 'sha256', fp: fpOf(snap) },
      { key: 'files.txt', fp: fpOf(listFile) },
      { key: 'head', fp: fpOf(headFile) },
    ]
    const ledgerBad = ledger.badLines.length > 0
    // ⚠ 指纹只比**机器写的 record 条目**：`incident` 是**人工追加的追溯注解**
    //   （带 files:null，锚点指向历史 HEAD 是它的**用途**，如前一条记的是 D7 的回滚前锚点）。
    //   把它计进来会把「如实记录历史事故」这件正确的事判红 —— 且会诱使人**不记**事故。
    const last = [...ledger.entries].reverse().find((e) => e.kind === 'record') ?? null
    const mismatched = []
    if (last) {
      for (const t of trio) {
        const rec = last.files?.[t.key]
        if (!rec) mismatched.push(`${t.key}:末条未记录指纹`)
        else if (rec.sha256 !== t.fp.sha256 || rec.bytes !== t.fp.bytes) mismatched.push(`${t.key}:${String(rec.sha256).slice(0, 12)}…≠磁盘 ${t.fp.sha256.slice(0, 12)}…`)
      }
    }
    // ── 新腿 ③：时序腿（**能抓住「逐字节还原」的写了又回滚**）────────────────
    //
    // 为什么需要它（本批实测踩到的边界）：流水腿比的是**内容**。若扰动方「写下 B → 再原样写回 A」，
    //   末条记录的指纹与磁盘**仍然相等** ⇒ 流水腿看不出 ⇒ 内容比较**原理上**抓不住逐字节还原。
    //   唯一还活着的证据是**时间**：这两次写发生在记录**之后**，故
    //     三件套 mtime > 末条 `record` 的 `at` ⇒ 记录之后**确实有人写过**。
    // ⚠ 判红方向与「不得用 mtime 判红」的纪律不冲突：
    //   那条纪律针对的是「mtime **相等**才判绿」这种**可伪造**的腿（touch 能骗过相等性）；
    //   这里判的是「**有写发生**」，而 `touch` **本身就是一次写** —— 它想让这个腿报红，
    //   而这个腿报红**正是它想要的结论**。方向相反的两种腿，伪造性结论不同，故可安全加入。
    // ⚠ 未覆盖面：mtime **变小**（回退）不判红（时钟回拨 / `git checkout` 会重置它，
    //   据此判红会造出「一会儿过一会儿不过」的腿）；流水 `incident` 条目由人工加，不参与本腿。
    const lastRecord = [...ledger.entries].reverse().find((e) => e.kind === 'record')
    const lastRecordAt = lastRecord?.at ? Date.parse(lastRecord.at) : null
    const afterRecord = Number.isFinite(lastRecordAt) ? trio.filter((t) => t.fp.mtimeMs > lastRecordAt + 1500) : []
    const timeOk = afterRecord.length === 0
    const timeDetail = !Number.isFinite(lastRecordAt)
      ? '无 record 条目可比（仅 incident/init）⇒ 不判'
      : timeOk
        ? `三件套 mtime 均 ≤ 末条 record（${lastRecord.at}）⇒ 记录之后无新写入`
        : `**记录之后仍被写过**：${afterRecord.map((t) => `${t.key}(+${Math.round((t.fp.mtimeMs - lastRecordAt) / 1000)}s)`).join('、')}` +
          ` ⇒ 内容虽与记录相符，但「写了又回滚（逐字节还原）」正落在这一形态 ⇒ 必须报红`

    const ledgerOk = ledger.exists && !ledgerBad && Boolean(last) && mismatched.length === 0
    const incidentCount = ledger.entries.filter((e) => e.kind === 'incident').length
    const ledgerDetail = !ledger.exists
      ? '流水缺失（docs/contract/_freeze.log 不存在）'
      : ledgerBad
        ? `流水有 ${ledger.badLines.length} 行不可解析（行 ${ledger.badLines.slice(0, 4).join(',')}）⇒ 坏行不得静默丢弃`
        : !last
          ? '流水无 record 条目（只有 incident/init 注解）⇒ 无机器记录可核'
          : ledgerOk
            ? `末条 seq=${last.seq}（${last.kind}/${last.at}）与磁盘三件套逐字相等`
            : `末条 seq=${last.seq} 的指纹≠磁盘 ⇒ **记录后被改写**（含「写了又回滚」）：${mismatched.join('；')}`
    // 提示性证据（**不参与判定**）：三件套 mtime 是否同批。
    const mts = trio.map((t) => t.fp.mtimeMs)
    const spreadSec = Math.round((Math.max(...mts) - Math.min(...mts)) / 1000)
    const mtimeHint = `三件套 mtime 跨 ${spreadSec}s${spreadSec > 60 ? '（**不同批**，提示可能被单独改过；不判红）' : '（同批）'}`

    // ── 新腿 ②：锚点不回退腿（流水内 head 锚点只能向前）──────────────────────
    // ⚠ 只走**机器写的 record**：incident 的锚点是「历史事故当时的 HEAD」，回退是它的**正常形态**。
    const anchors = ledger.entries
      .filter((e) => e.kind === 'record')
      .map((e) => String(e.headShort ?? String(e.head ?? '').slice(0, 7)))
    let anchorBadAt = null
    for (let i = 1; i < anchors.length; i += 1) {
      if (anchors[i - 1] && anchors[i] && !isAncestorOf(anchors[i - 1], anchors[i])) {
        anchorBadAt = `第 ${i}→${i + 1} 条：${anchors[i - 1]} ⊄ ${anchors[i]}`
        break
      }
    }
    const anchorOk = !ledgerBad && anchorBadAt === null

    // ── 新腿 ④：锚点跃迁腿（让「提交面」的看守**跨记录存活**）──────────────────
    //
    // 为什么需要它（本批实测发现的漏洞）：A0-10 的越界腿用**当前**基线锚点枚举提交区间
    //   ⇒ 「记录 → 提交 → **再记录**」这个顺序会把提交面的证据洗掉：重新记录后锚点前移到
    //   提交之后，区间变成空集，越界腿只看得见脏面。而流水是 append-only 的 ⇒
    //   相邻两条 record 的 head 之间**恰恰就是那批提交**，拿前一条声明的写面（`expect`）去比，
    //   证据就永久留在流水里，**不因后续重取基线而消失**。
    // ⚠ 与锚点腿互补：锚点腿判「顺序合法」，本腿判「区间内容合规」。
    const recordEntries = ledger.entries.filter((e) => e.kind === 'record')
    const leaps = []
    for (let i = 1; i < recordEntries.length; i += 1) {
      const prev = recordEntries[i - 1]
      const cur = recordEntries[i]
      // ⚠ 旧条目（本批加 `expect` 字段之前写入的）没有该字段 —— 回退用它同时写的
      //   `reason`（= `EXPECT.join(',')`，内容相同）。**不回填历史条目**：流水是 append-only，
      //   改写已落盘的历史就毁了它作为证据的价值。回退状态在明细里**显式标注**，不静默。
      const legacyFace = typeof prev.reason === 'string' && prev.reason.trim() ? prev.reason.split(',').map((s) => s.trim()).filter(Boolean) : []
      const face = Array.isArray(prev.expect) ? prev.expect : legacyFace
      const faceSource = Array.isArray(prev.expect) ? 'expect' : legacyFace.length ? 'reason（旧条目回退）' : '缺失'
      if (!prev.head || !cur.head) continue
      let files = null
      try {
        files = execFileSync('git', ['diff', '--name-only', `${prev.head}..${cur.head}`], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .filter((p) => !FREEZE_OWN.includes(p))
      } catch {
        leaps.push({ from: String(prev.head).slice(0, 7), to: String(cur.head).slice(0, 7), note: '区间不可枚举（锚点已被抛弃）' })
        continue
      }
      const out = face.length ? files.filter((p) => !face.some((pre) => p.startsWith(pre))) : files
      if (files.length) leaps.push({ from: String(prev.head).slice(0, 7), to: String(cur.head).slice(0, 7), files, out, face, faceSource })
    }
    const leapBad = leaps.filter((l) => (l.note ? true : l.out.length > 0))
    const leapOk = leapBad.length === 0
    const leapDetail = !leaps.length
      ? '无跨记录提交区间可核（≤1 条 record）'
      : leapOk
        ? `${leaps.length} 段区间全部 ⊆ 各段声明写面（共 ${leaps.reduce((s, l) => s + l.files.length, 0)} 件提交；写面来源：${[...new Set(leaps.map((l) => l.faceSource))].join('/')}）`
        : `${leapBad.length} 段越界：${leapBad
            .map((l) => (l.note ? `${l.from}→${l.to} ${l.note}` : `${l.from}→${l.to} 越界 ${JSON.stringify(l.out.slice(0, 4))}（声明写面 ${JSON.stringify(l.face)}，来源 ${l.faceSource}）`))
            .join('；')}`
    const anchorDetail = anchorBadAt
      ? `锚点**回退**（${anchorBadAt}）⇒ 有人记录过更早的 HEAD`
      : anchors.length >= 2
        ? `${anchors.length} 条锚点单调向前（末 ${anchors[anchors.length - 1]}）`
        : `${anchors.length} 条锚点（暂无可比对的前序）`

    const detail =
      `哈希腿=${hashOk ? '逐字相等' : '已漂移'}（${now.split('  ')[0].slice(0, 16)}…）；` +
      `清单腿=${listOk ? `一致（${canonList.length} 件）` : `漂移：多 ${hashOnlyAdd.length}/少 ${hashOnlyDel.length} 件`}` +
      `${listOk ? '' : ` ⇒ 多=${JSON.stringify(hashOnlyAdd.slice(0, 3))} 少=${JSON.stringify(hashOnlyDel.slice(0, 3))}`}；` +
      `HEAD 腿=${headOk ? `快照锚点仍是祖先（存 ${String(storedHead).slice(0, 7)} ⊑ 现 ${actualHead.slice(0, 7)}）` : `锚点不在历史中：存 ${String(storedHead).slice(0, 7)} 不是现 ${actualHead.slice(0, 7)} 的祖先`}；` +
      `流水腿=${ledgerDetail}（另有 ${incidentCount} 条人工 incident 注解，不参与指纹比对）；锚点腿=${anchorDetail}；时序腿=${timeDetail}；跃迁腿=${leapDetail}；${mtimeHint}`
    if (hashOk && listOk && headOk && ledgerOk && anchorOk && timeOk && leapOk) {
      pass('A0-12', '契约快照三件套已存且已核', detail, `七条腿都必须被机检真读 —— 只存不验等于漂移不可见；**写了又回滚**由流水腿 + 时序腿（docs/contract/concurrency-discipline.md §二）承接`)
    } else {
      const which = [!hashOk && '哈希腿', !listOk && '清单腿', !headOk && 'HEAD 腿', !ledgerOk && '流水腿', !anchorOk && '锚点腿', !timeOk && '时序腿', !leapOk && '跃迁腿'].filter(Boolean).join('+')
      fail('A0-12', '契约快照三件套已存且已核', `${which}漂移；${detail}`, '比对上一版并记录差异（旧值存档不覆盖）；若属记录后又被改写 ⇒ 查并发写者，勿只重取基线覆盖证据')
    }
  }
}

// ══ A0-13 G1–G15 全数归属 ══════════════════════════════════════════════════
if (want('A0-13')) {
  const f = P('docs/arch/phase0-g15-attribution.md')
  if (existsSync(f)) {
    const txt = readFileSync(f, 'utf8')
    const rows = txt.split(/\r?\n/).filter((l) => /^\|\s*\*{0,2}G\d+\*{0,2}\s*\|/.test(l))
    const withArtifact = rows.filter((l) => /✅|产物/.test(l)).length
    const hung = rows.filter((l) => /⏳|挂账/.test(l)).length
    if (rows.length === 15) {
      hang('A0-13', 'G1–G15 全数归属', `15/15 有归宿（产物 ${withArtifact} / 挂账 ${hung}）；⚠ 挂账项不计入"已解决"`, '不得以「已在正文提过」代替归属')
    } else {
      fail('A0-13', 'G1–G15 全数归属', `仅 ${rows.length}/15 条有归属行`, '回 §2 补归属')
    }
  } else {
    fail('A0-13', 'G1–G15 全数归属', `缺归属表 ${f}`, '回 §2 补归属')
  }
}

// ══ A0-14 源文件可解析（元门禁：块注释早终止）════════════════════════════════
if (want('A0-14')) {
  const r = node([P('tools/check-comment-guard.mjs')])
  const out = (r.out ?? '') + (r.err ?? '')
  const scan = /扫描 (\d+) 个源文件/.exec(out)
  if (r.ok) {
    pass('A0-14', '源文件可解析（块注释早终止元门禁）', `扫描 ${scan?.[1] ?? '?'} 个源文件，无语法类错误`, '该陷阱本仓踩过两次：注释里写 glob 路径 ⇒ 注释提前终止 ⇒ 报「X is not defined」指不到真因')
  } else {
    fail('A0-14', '源文件可解析（块注释早终止元门禁）', out.split('\n').filter((l) => l.startsWith('✗')).join(' / ').slice(0, 200) || '有文件不可解析', '查块注释里的星号+斜杠组合')
  }
}

// ══ A1 判据入口（`tools/a1-check.mjs`）接入门链 ═══════════════════════════════
//
// ⚠ 为什么必须进这条链（本会议 2026-09-24 判红事实）：a1-check 建好后一度**零调用者** ——
//   `grep -rn "a1-check" tools/ package.json packages/*/package.json` 只命中它自己的注释。
//   在根 `package.json` 加 `check:a1` 只解决「可发现」，**不解决「被自动跑到」**：
//   跑 `a0-check` 的人不会知道还有一条 A1 门没跑。此处按 R0 腿的既有形态接入 ——
//   跑 a0-check 即**自动跑** a1-check，且把它的项集等式腿与 FAIL 都带进本报告。
//
// 判据（三条腿都要真读，缺一即红）：
//   ① 退出码 0（a1-check 自身口径：无 FAIL **且** 判据项集等式通过）；
//   ② 输出里「门判定」段两条腿都是 ✓（`判据腿` 与 `项集腿`）；
//   ③ 报告里「共 N 项」的 N 等于 **a1-check 自己声明的期望项数**（交叉核对，不只看它自己说通过）。
//
// ⚠ **不要在 a0-check 里硬编码期望项数**（本仓 2026-09-25 实测踩到）：
//   原先写 `=== 6`，本轮 W3 给 a1-check 加了 4 项（6 → 10）⇒ **a0 的 A1 腿立刻假红**，
//   而 a1-check 自身全绿。这与本仓已修过两次的缺陷同型（清单各自硬编码、互为盲区 ⇒
//   `naming.md` 6 包 vs 13 包、`_freeze.files.txt` 无人读）。
//   ⇒ 改为**从 a1-check 输出里读它自己声明的期望项数**，交叉核对三方一致（报告/声明/实测）；
//     a0 不另存一份清单。
if (want('A1')) {
  // ⚠ 把 a0 持有的 a1 锁 token 传给子进程：子 a1 只**校验**、不重复获取（见 a0 锁段的长注释）
  const r = node([P('tools/a1-check.mjs'), '--held-lock', LOCK_TOKEN])
  const out = r.out ?? ''
  const gate = /✓ 判据腿：无 FAIL/.test(out) && /✓ 项集腿：期望 == 实测/.test(out)
  const countM = /共 (\d+) 项：PASS/.exec(out)
  // a1-check 项集腿原文：`期望 10 项 [...] ／ 实测 10 项 [...]`
  const declared = Number((/期望 (\d+) 项 \[/.exec(out) ?? [])[1] ?? NaN)
  const measured = Number((/实测 (\d+) 项 \[/.exec(out) ?? [])[1] ?? NaN)
  const itemsOk =
    countM != null && Number.isFinite(declared) && Number.isFinite(measured) &&
    Number(countM[1]) === declared && measured === declared
  const nCount = /PASS (\d+) · FAIL (\d+) · 挂账 (\d+) · 无实现者 (\d+)/.exec(out)
  if (r.ok && gate && itemsOk) {
    pass(
      'A1',
      'A1 判据入口（a1-check 已进自动门链）',
      `共 ${countM?.[1]} 项（= 其声明的期望 ${declared}）· PASS ${nCount?.[1]} / FAIL ${nCount?.[2]} / 挂账 ${nCount?.[3]} / 无实现者 ${nCount?.[4]} · 判据腿与项集腿皆 ✓`,
      '条目由 a1-check 自报并与实测交叉核对（**本处不另存一份清单**）；⚠ 「无实现者」与「挂账」都不是 PASS',
    )
  } else {
    const tail = out.split('\n').filter((l) => /FAIL|项集腿|不通过|缺 |多 /.test(l)).slice(0, 4).join(' / ')
    fail(
      'A1',
      'A1 判据入口（a1-check 已进自动门链）',
      (r.code === 4
        ? '⚠ **未能判定**：子进程 a1-check 因**单实例锁被占**（exit=4）未运行 ⇒ 这不是判据 FAIL，是并发冲突（读法见 stderr）。' +
          `持有者信息见子进程 stderr｜${tail.slice(0, 240)}`
        : `ok=${r.ok} 门判定两腿=${gate} 报告项数=${countM?.[1] ?? '?'} / 声明=${Number.isFinite(declared) ? declared : '?'} / 实测=${Number.isFinite(measured) ? measured : '?'}｜${tail.slice(0, 300)}`),
      '回 tools/a1-check.mjs；若项集腿红 ⇒ 判据块被删或期望集未同步',
    )
  }
}

if (want('R0')) {
  const r = node([P('tools/r0-assembly-check.mjs')])
  const out = r.out ?? ''
  const zero = /装配计数归零（N=\d+ → 0）：✓ 通过/.test(out)
  const noNew = /卸载后不再产生新行\s*：✓ 通过/.test(out)
  const m = /装配计数 N = (\d+)/.exec(out)
  if (r.ok && zero && noNew) {
    pass('R0', '反证判据（卸载即净 · 真装配链）', `注入 ${m?.[1] ?? '?'} 个 → 装配归零 → 卸载后同一触发无新增行`, '走真 cordis Loader 按包名解析；装配计数以「服务可读」为判据，不以调用成功为判据')
  } else {
    fail('R0', '反证判据（卸载即净 · 真装配链）', `zero=${zero} noNew=${noNew}｜${out.split('\n').slice(-6).join(' / ').slice(0, 300)}`, '回阶段 0 骨架 / 装配步骤')
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────────
const order = { FAIL: 0, HANG: 1, PASS: 2 }
results.sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id))

if (JSON_OUT) {
  // ⚠ 顶层也带坐标：只读 results 的人能逐项归因，顶层给一个『这份报告是什么时候/在哪个 commit 下出的』
  console.log(JSON.stringify({ at: new Date().toISOString(), coord: COORD, results }, null, 2))
} else {
  const n = { PASS: 0, FAIL: 0, HANG: 0 }
  for (const r of results) n[r.state] += 1
  console.log('══════ Mana 阶段验收判据机检（A0-1 … A0-14 + R0 + A1 入口）══════')
  console.log(`共 ${results.length} 项：PASS ${n.PASS} · FAIL ${n.FAIL} · 挂账 ${n.HANG}`)
  console.log('（挂账 ≠ 通过：挂账项须在原定阶段验收）\n')
  for (const r of results) {
    const mark = r.state === 'PASS' ? '  PASS' : r.state === 'FAIL' ? '✗ FAIL' : '  HANG'
    console.log(`${mark}  [${r.id}] ${r.title}`)
    console.log(`        ${r.detail}`)
    if (r.evidence) console.log(`        依据: ${r.evidence}`)
  }
  console.log(`\n${n.FAIL === 0 ? '✅ 无 FAIL' : `❌ 有 ${n.FAIL} 项 FAIL`}${n.HANG ? `（另有 ${n.HANG} 项挂账）` : ''}`)
}

// ══ 基线记录辅助（A0-10 / A0-12）════════════════════════════════════════════
//
// ⚠ **记录动作的成功/失败必须可观测**（本会议 f5 修的缺陷，实测形态）：
//   旧实现在 `catch` 里只 `console.error('基线记录失败: …')`，**不改退出码** ⇒
//   `chmod 444 tools/.a0-10-baseline.json && node tools/a0-check.mjs --record-baseline`
//   打印「✅ 无 FAIL」并 **exit 0**，而基线根本没写成。后果不是"少一个文件"：
//   A0-10 的语义是「与本批开工前实测值相等」⇒ **记录失败却被读成成功，会让后续所有
//   「不碰既有件」的门在错误基线上继续判绿**。同一形态本仓已修过多次（判据绿但没生效）。
//
// 处置（**甲+乙 并用**，理由见下）：
//   · 甲：记录失败 ⇒ 退出码 **2**（与判据 FAIL 的 **1** 区分开）—— 机器可判；
//   · 乙：失败时打印**机器可读标记行** `[baseline FAILED] …`，且**绝不**打印
//     `[baseline recorded]`；顺序保证「记录状态」行出现在总结段。
//   为什么不只用乙：CI/脚本读的是退出码，只靠人看标记仍会"沉默地成功"。
//   为什么不只用甲：退出码只有一位信息，读日志的人分不清"基线没记"与"判据真红"。
//   ⚠ **不把记录失败混进那 16 项判据** —— 那会让「判据绿但基线没记」与「判据真红」
//     不可分辨，是另一种不可观测（本会议 g8 一条纪律：两者要能分辨）。
//
// 退出码语义（**三态可分辨**，见文件头）：
//   0 = 判据无 FAIL 且（若带 --record-baseline）记录成功
//   1 = 有判据 FAIL（无论记录是否成功）
//   2 = 判据无 FAIL，但 --record-baseline **记录失败**（基线仍可能是旧值/缺失）
const RECORD_MODE = argv.includes('--record-baseline')
let recordFailed = false
/** 记录动作的产物清单（用于失败时精确指出**哪一步**没写成，而不是笼统一句"失败"）。 */
const recordSteps = []
if (RECORD_MODE) {
  const SAMPLE = '/home/lk/dsh-src/dsh-plugin-roundtable'
  const self = gitProbe(ROOT)
  const sample = gitProbe(SAMPLE)
  try {
    // ── 前置门①：唯一基线席必须声明本批预期写面 ────────────────────────────
    //   理由：没有它就无法区分「脏树里的别席在途」与「本席记录动作本身造成的脏」——
    //   而这个区分正是并发纪律第 2 条要的东西（见 concurrency-discipline.md §2）。
    if (EXPECT.length === 0) {
      throw new Error('缺 --expect <本批预期写面前缀>（并发纪律 §2：基线对象必须显式声明，否则无法判「谁把树搞脏的」）')
    }
    // ── 前置门②：`git status --porcelain` 必须为空（本仓腿）────────────────
    //   实测来源：`_freeze.head` 曾在**脏树**上被写并回滚（v10 评审 §D7）。
    //   例外：`--accept-dirty "<理由>"`（理由必填）—— 收工「录本批最终态」须在脏树上记录；
    //   届时把**预期处**（`--expect`）之外的脏行当作「别席在途」打印出来，而不是假装树是干净的。
    //   ⚠ 被检查量 = **已跟踪脏行**（`??` 未跟踪新增只报告不拦）—— 同 A0-10 块头注的理由：
    //     并行波次里别席新建未跟踪文件是常态，拿它拦记录会造出「假红」，最终被当成噪声忽略。
    const selfTracked = dirtyPaths(self.tracked).filter((p) => !FREEZE_OWN.includes(p))
    if (selfTracked.length > 0) {
      const outside = selfTracked.filter((p) => !EXPECT.some((pre) => p.startsWith(pre)))
      if (!ACCEPT_DIRTY) {
        throw new Error(
          `工作树有既有件被动过（已跟踪脏 ${selfTracked.length} 项；预期处之外 ${outside.length} 项）⇒ 拒绝记录。` +
            `\n        预期处（--expect）：${EXPECT.join(' / ')}` +
            `\n        处之外：${JSON.stringify(outside.slice(0, 8))}` +
            `\n        处置：并发纪律 §2 要求**干净树上记录**（先提交/移开在途改动）。` +
            `\n        ⚠ 若确要「录本批最终态」（收工录），加 --accept-dirty "<理由>" —— 理由必填，空理由即拒绝。`,
        )
      }
      if (!ACCEPT_DIRTY_REASON) throw new Error('--accept-dirty 必须带一句理由（空理由 = 静默绕过前置门）')
      console.log(`\n[baseline dirty-accepted] ${ACCEPT_DIRTY_REASON}`)
      console.log(`        预期处（--expect）：${EXPECT.join(' / ')}`)
      console.log(`        处之外（别席在途，如实列出）：${outside.length ? JSON.stringify(outside.slice(0, 8)) : '（无）'}`)
    }
    // ── ① A0-10 两仓基线（含**本仓**）────────────────────────────────────────
    //   ⚠ 本仓路径必须进基线：原实现只存样板仓 ⇒ Mana 本仓「不碰既有件」无人看守
    //     （v10 评审 §D6；本批 F-09-a）。
    if (!self.ok) throw new Error(`本仓 git 探针失败：${self.error}`)
    writeFileSync(
      A010_BASELINE(),
      JSON.stringify(
        {
          self: {
            head: self.head,
            headFull: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
            tracked: self.tracked.length,
            trackedPaths: dirtyPaths(self.tracked).filter((p) => !FREEZE_OWN.includes(p)),
            untracked: self.untracked.length,
            untrackedPaths: dirtyPaths(self.untracked),
          },
          sample: sample.ok ? { head: sample.head, dirty: sample.dirty.length } : { head: '?', dirty: -1, error: sample.error },
          expect: EXPECT,
          acceptDirtyReason: ACCEPT_DIRTY ? ACCEPT_DIRTY_REASON : null,
          recordedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    )
    recordSteps.push('tools/.a0-10-baseline.json')

    // ── ② 契约快照三件套 ────────────────────────────────────────────────────
    const now = ['packages/core/src/event-types.ts', 'packages/core/src/domain.ts']
      .map((f) => `${createHash('sha256').update(readFileSync(P(f))).digest('hex')}  ${f}`)
      .join('\n')
    const { sha256: snapFile, list: listFile, head: headFile } = FREEZE_FILES()
    writeFileSync(snapFile, now + '\n')
    // ⚠ 三件套必须**一起重取**：只更哈希腿而清单腿/HEAD 腿留旧值，就是让判据三腿互相矛盾。
    writeFileSync(listFile, canonWalk())
    writeFileSync(headFile, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }))
    const filesFp = { sha256: fpOf(snapFile), 'files.txt': fpOf(listFile), head: fpOf(headFile) }
    const listCount = readFileSync(listFile, 'utf8').split('\n').filter(Boolean).length
    recordSteps.push('docs/contract/_freeze.{sha256,files.txt,head}')

    // ── ③ 快照变更流水（append-only）─────────────────────────────────────────
    //   ⚠ 三件套的**写成功**与流水的**记成功**是两件事：流水是「记录之后又被改写」的
    //     唯一机器证据（v10 评审 §D7：写了又回滚走完整循环后三件套与 HEAD 版一致 ⇒ 看不出）。
    //     故这一步失败必须让整次记录**失败**（recordFailed ⇒ exit 2），不得只 warning。
    const seq = (() => {
      const cur = readLedger(FREEZE_LEDGER())
      if (cur.badLines.length) throw new Error(`流水有 ${cur.badLines.length} 行不可解析 ⇒ 追加前先修/归档（坏行不得静默丢弃）`)
      return cur.entries.length + 1
    })()
    const entry = {
      seq,
      // ⚠ `at` 必须在**三件套写完并取完指纹之后**取：A0-12 的「时序腿」判
      //   「三件套 mtime ≤ 末条 record 的 at」，若 at 取在写之前，每一次**合法**记录
      //   都会让该腿假红（自指的假红，本仓明令禁止把这种腿放进阈值列）。
      at: new Date().toISOString(),
      kind: 'record',
      actor: 'tools/a0-check.mjs --record-baseline（唯一基线席）',
      reason: EXPECT.join(','),
      expect: EXPECT,
      acceptDirtyReason: ACCEPT_DIRTY ? ACCEPT_DIRTY_REASON : null,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      headShort: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      files: filesFp,
      // 提示性证据，不参与判定（见 A0-12「不得用 mtime 判红」的理由）
      mtimeSpreadSec: Math.round(
        (Math.max(...Object.values(filesFp).map((f) => f.mtimeMs)) -
          Math.min(...Object.values(filesFp).map((f) => f.mtimeMs))) /
          1000,
      ),
    }
    appendFileSync(FREEZE_LEDGER(), JSON.stringify(entry) + '\n')
    recordSteps.push('docs/contract/_freeze.log')
    // ⚠ 回读闸：**写成功 ≠ 记成功**。写完后必须重读磁盘，断言末条指纹与磁盘逐字相等；
    //   不等 ⇒ 记录**未生效**（正是退出码 2 要抓的形态）。
    const verify = readLedger(FREEZE_LEDGER())
    const vLast = verify.entries[verify.entries.length - 1]
    for (const k of ['sha256', 'files.txt', 'head']) {
      const okRec = vLast?.files?.[k]?.sha256 === filesFp[k].sha256
      if (!okRec) throw new Error(`流水回读闸失败：${k} 末条指纹 ≠ 磁盘（记录未生效）`)
    }

    console.log(
      `\n[baseline recorded] 本仓 HEAD=${self.head} 已跟踪脏=${self.tracked.length} 未跟踪=${self.untracked.length}；样板 HEAD=${sample.ok ? sample.head : '?'} dirty=${sample.ok ? sample.dirty.length : '?'}；` +
        `契约快照三件套已重取（sha256 / files.txt ${listCount} 件 / head）· 流水 seq=${entry.seq}（head ${entry.headShort}）· 回读闸 ✓`,
    )
  } catch (error) {
    recordFailed = true
    // 机器可读标记行（固定前缀，便于 grep/CI 判读）+ 精确到「哪一步没写成」。
    console.error(
      `[baseline FAILED] ${error.message}｜已写成 ${recordSteps.length ? recordSteps.join(' + ') : '（无）'}` +
        `｜⚠ 基线**未**完整记录：A0-10/A0-12 下次运行将按旧值/缺失判，不得当作本次已记录`,
    )
    console.error('基线记录失败:', error.message)
  }
  // 总结段之后的**单列状态行**（stdout，故「只读 stdout」的人也看得到）：
  // ⚠ 必须与上面的判据总结**分开**呈现 —— 判据腿与记录腿是两件事，合并即不可分辨。
  // ⚠ 不得在这里写死「退出码 2」：判据也红时真实退出码是 **1**（判据优先，不被记录掩盖）。
  //   写死会造出一句**与事实不符**的自述 —— 本仓一路在防的形态。故按实际组合陈述。
  const judgeFailed = results.some((r) => r.state === 'FAIL')
  console.log(
    `\n[baseline status] ${
      recordFailed
        ? `✗ FAILED —— 基线**未完整记录**（真实退出码 ${judgeFailed ? '1 = 判据红优先；记录失败虽已发生但未取 2' : '2 = 判据绿、仅记录失败'}；` +
          `上面那句判据结论只针对判据项，不代表基线已记）`
        : `✓ OK —— 基线已记录（本仓 HEAD=${self.head} 已跟踪脏=${self.tracked.length}；预期处：${EXPECT.join(' / ') || '（未声明）'}）`
    }`,
  )
}

process.exitCode = results.some((r) => r.state === 'FAIL') ? 1 : recordFailed ? 2 : 0
