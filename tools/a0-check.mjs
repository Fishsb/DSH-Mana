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
 *   node tools/a0-check.mjs --record-baseline # 重取基线（A0-10 与 A0-12 的快照三件套）
 *
 * ⚠ 纪律：
 *  · **不得用管道取退出码**（`node x.mjs | tail` 的 `$?` 是 tail 的）。要判真值须
 *    `node x.mjs >out 2>err; echo $?`。
 *  · **退出码语义表（三态，互不可混）**：
 *      `0` = 16 项判据无 FAIL（可含挂账）**且**（若带 `--record-baseline`）基线记录成功；
 *      `1` = 有判据 FAIL（无论基线记录成功与否 —— 判据结果不被记录动作掩盖）；
 *      `2` = 判据无 FAIL，但 `--record-baseline` **记录失败**（= 基线仍是旧值或缺失）。
 *    ⚠ 记录失败**不混进那 16 项**：一旦混进去，「判据绿但基线没记」与「判据真红」
 *      就不可分辨了 —— 那是另一种不可观测。两者必须能分开读（见文件末 `[baseline status]`）。
 *  · 「挂账」是**一等状态**，不等于通过（G14 挂账到阶段 1）。
 *  · **A1 腿**（`A1`）把 `tools/a1-check.mjs` 接进本链：建了却没被任何入口跑到的判据，
 *    等于没建（本会议实测：加 `check:a1` 之前它零调用者）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const P = (...p) => join(ROOT, ...p)

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const ONLY = (() => {
  const i = argv.indexOf('--only')
  return i >= 0 ? new Set(String(argv[i + 1] ?? '').split(',').map((s) => s.trim())) : null
})()

const results = []
/** 记一条判据结果。state: 'PASS' | 'FAIL' | 'HANG'（挂账） */
function record(id, title, state, detail, evidence = '') {
  results.push({ id, title, state, detail, evidence })
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

// ══ A0-10 不碰既有件 ════════════════════════════════════════════════════════
if (want('A0-10')) {
  const SAMPLE = '/home/lk/dsh-src/dsh-plugin-roundtable'
  const base = (() => {
    const f = P('tools/.a0-10-baseline.json')
    try {
      return JSON.parse(readFileSync(f, 'utf8'))
    } catch {
      return null
    }
  })()
  let head = '?'
  let dirty = -1
  try {
    head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: SAMPLE, encoding: 'utf8' }).trim()
    dirty = execFileSync('git', ['status', '--porcelain'], { cwd: SAMPLE, encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim()).length
  } catch {
    /* 目录不存在即 FAIL */
  }
  if (!base) {
    fail('A0-10', '不碰既有件', `基线未记录（head=${head} dirty=${dirty}）；先跑 --record-baseline`, '判据形态 = 与开工前实测值相等，不是与固定数字相等')
  } else if (base.head === head && base.dirty === dirty) {
    pass('A0-10', '不碰既有件', `样板 HEAD=${head}、dirty=${dirty} 与开工前基线（${base.head}/${base.dirty}）相等`, '')
  } else {
    fail('A0-10', '不碰既有件', `漂移：HEAD ${base.head}→${head}、dirty ${base.dirty}→${dirty}`, '先查是否本轮造成；确属本轮 → 回滚并写报告')
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
if (want('A0-12')) {
  const contractDir = P('docs/contract')
  const snap = join(contractDir, '_freeze.sha256')
  const listFile = join(contractDir, '_freeze.files.txt')
  const headFile = join(contractDir, '_freeze.head')
  const srcFiles = ['event-types.ts', 'domain.ts'].map((f) => P('packages/core/src', f))
  const { createHash } = await import('node:crypto')
  const { execFileSync } = await import('node:child_process')
  const rel = (f) => f.slice(ROOT.length + 1)
  const now = srcFiles
    .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${rel(f)}`)
    .join('\n')

  // 清单腿：与权威 walk 逐行 diff（**排除 lib/**：构建产物会让清单随 build 漂移）。
  const CANON_WALK = "find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/lib/*'"
  const canonList = execFileSync('bash', ['-lc', `${CANON_WALK} | sort`], { cwd: ROOT, encoding: 'utf8' })
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
  const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const storedHead = existsSync(headFile) ? readFileSync(headFile, 'utf8').trim() : null
  const headIsAncestor =
    storedHead !== null &&
    storedHead.length > 0 &&
    (() => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', storedHead, 'HEAD'], { cwd: ROOT, stdio: 'pipe' })
        return true
      } catch {
        return false
      }
    })()

  const missing = []
  if (!existsSync(snap)) missing.push(`_freeze.sha256（当前值=\n${now}）`)
  if (storedList === null) missing.push('_freeze.files.txt')
  if (storedHead === null) missing.push('_freeze.head')
  if (missing.length) {
    fail('A0-12', '契约快照三件套已存且已核', `缺 ${missing.join(' / ')}`, '跑 tools/a0-check.mjs --record-baseline 生成')
  } else {
    const hashOk = readFileSync(snap, 'utf8').trim() === now.trim()
    const hashOnlyAdd = (storedList ?? []).filter((l) => !canonList.includes(l))
    const hashOnlyDel = canonList.filter((l) => !(storedList ?? []).includes(l))
    const listOk = hashOnlyAdd.length === 0 && hashOnlyDel.length === 0
    const headOk = headIsAncestor
    const detail =
      `哈希腿=${hashOk ? '逐字相等' : '已漂移'}（${now.split('  ')[0].slice(0, 16)}…）；` +
      `清单腿=${listOk ? `一致（${canonList.length} 件）` : `漂移：多 ${hashOnlyAdd.length}/少 ${hashOnlyDel.length} 件`}` +
      `${listOk ? '' : ` ⇒ 多=${JSON.stringify(hashOnlyAdd.slice(0, 3))} 少=${JSON.stringify(hashOnlyDel.slice(0, 3))}`}；` +
      `HEAD 腿=${headOk ? `快照锚点仍是祖先（存 ${String(storedHead).slice(0, 7)} ⊑ 现 ${actualHead.slice(0, 7)}）` : `锚点不在历史中：存 ${String(storedHead).slice(0, 7)} 不是现 ${actualHead.slice(0, 7)} 的祖先`}`
    if (hashOk && listOk && headOk) {
      pass('A0-12', '契约快照三件套已存且已核', detail, '三条腿都必须被机检真读 —— 只存不验等于漂移不可见')
    } else {
      const which = [!hashOk && '哈希腿', !listOk && '清单腿', !headOk && 'HEAD 腿'].filter(Boolean).join('+')
      fail('A0-12', '契约快照三件套已存且已核', `${which}漂移；${detail}`, '比对上一版并记录差异（旧值存档不覆盖）')
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
  const r = node([P('tools/a1-check.mjs')])
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
      `ok=${r.ok} 门判定两腿=${gate} 报告项数=${countM?.[1] ?? '?'} / 声明=${Number.isFinite(declared) ? declared : '?'} / 实测=${Number.isFinite(measured) ? measured : '?'}｜${tail.slice(0, 300)}`,
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
  console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
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
  const { writeFileSync } = await import('node:fs')
  const SAMPLE = '/home/lk/dsh-src/dsh-plugin-roundtable'
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: SAMPLE, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: SAMPLE, encoding: 'utf8' })
      .split('\n').filter((l) => l.trim()).length
    execFileSync('mkdir', ['-p', P('tools')])
    writeFileSync(P('tools/.a0-10-baseline.json'), JSON.stringify({ head, dirty, recordedAt: new Date().toISOString() }, null, 2))
    recordSteps.push('tools/.a0-10-baseline.json')
    const { createHash } = await import('node:crypto')
    const now = ['packages/core/src/event-types.ts', 'packages/core/src/domain.ts']
      .map((f) => `${createHash('sha256').update(readFileSync(P(f))).digest('hex')}  ${f}`)
      .join('\n')
    // ⚠ 此处原为 `execFileSync('mkdir', ['-p', P('contract')])` —— 指向**仓根** `contract/`，
    //   而下面三行写的全是 `docs/contract/*`。取证（2026-09-25）：
    //     ① `git ls-files contract/ | wc -l` = **0**（仓根该目录从未入库、也无人跟踪）；
    //     ② 全仓搜 `P('contract')` 只命中这一行自身（无任何读取方）；
    //     ③ 真目标 `docs/contract/` 是入库目录（9 件）且由下面三行直接写。
    //   ⇒ 它是**死代码**：`mkdir -p` 幂等地造出一个无人使用的空目录（实测跑一次后
    //     `ls -d contract` 真的出现了该目录，纯污染 —— 且会让 `git status` 多一个未跟踪项）。
    //   处置：**删除**（不改成 `P('docs/contract')`：真目标目录已入库存在，
    //     且 `docs/contract/` 缺失属契约面异常，应由 A0-12 报红而不是被静默 mkdir 补上）。
    writeFileSync(P('docs/contract/_freeze.sha256'), now + '\n')
    // ⚠ 三件套必须**一起重取**：只更哈希腿而清单腿/HEAD 腿留旧值，就是让判据三腿互相矛盾。
    const list = execFileSync('bash', ['-lc', "find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/lib/*' | sort"], {
      cwd: P('.'), encoding: 'utf8',
    })
    writeFileSync(P('docs/contract/_freeze.files.txt'), list)
    writeFileSync(P('docs/contract/_freeze.head'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: P('.'), encoding: 'utf8' }))
    recordSteps.push('docs/contract/_freeze.{sha256,files.txt,head}')
    console.log(
      `\n[baseline recorded] sample HEAD=${head} dirty=${dirty}；契约快照三件套已重取` +
        `（sha256 / files.txt ${list.split('\n').filter(Boolean).length} 件 / head）`,
    )
  } catch (error) {
    recordFailed = true
    // 机器可读标记行（固定前缀，便于 grep/CI 判读）+ 精确到「哪一步没写成」。
    console.error(
      `[baseline FAILED] ${error.message}｜已写成 ${recordSteps.length ? recordSteps.join(' + ') : '（无）'}` +
        `｜⚠ 基线**未**完整记录：A0-10 下次运行将按旧值/缺失判，不得当作本次已记录`,
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
        : '✓ OK —— 基线已记录'
    }`,
  )
}

process.exitCode = results.some((r) => r.state === 'FAIL') ? 1 : recordFailed ? 2 : 0
