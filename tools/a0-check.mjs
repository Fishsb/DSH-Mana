#!/usr/bin/env node
/**
 * Mana 阶段 0 验收判据机检器（A0-1 … A0-13）。
 *
 * 存在的理由：落地册的判据表是**给执行者看的**，而「照着执行」与「可重复机检」
 * 是两件事。本脚本把每条判据变成**可重跑的检查**，输出 PASS/FAIL/挂账三态。
 *
 * 用法：
 *   node tools/a0-check.mjs                  # 全量
 *   node tools/a0-check.mjs --json           # 机读输出
 *   node tools/a0-check.mjs --only A0-3,A0-8 # 只跑指定项
 *
 * ⚠ 纪律：
 *  · **不得用管道取退出码**（`node x.mjs | tail` 的 `$?` 是 tail 的）。要判真值须
 *    `node x.mjs >out 2>err; echo $?`。
 *  · 退出码：0 = 无 FAIL（可含挂账）；1 = 有 FAIL。
 *  · 「挂账」是**一等状态**，不等于通过（G14 挂账到阶段 1）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

// ══ A0-5 插件形状静态可证 ════════════════════════════════════════════════════
if (want('A0-5')) {
  // 目录名与包名分离（写面所有权用目录名，装配面用包名，见 docs/contract/naming.md）
  const DIRS = ['core', 'jev', 'vector', 'perception', 'attention', 'working-memory']
  const bad = []
  for (const dir of DIRS) {
    const src = P('packages', dir, 'src/index.ts')
    const patch = P('packages', dir, 'cordis.patch.yml')
    const txt = existsSync(src) ? readFileSync(src, 'utf8') : ''
    const has4 =
      /export const name/.test(txt) && /export const inject/.test(txt) &&
      /export const Config/.test(txt) && /export function apply/.test(txt)
    if (!has4 || !existsSync(patch)) bad.push(dir)
  }
  if (bad.length === 0) pass('A0-5', '插件形状静态可证', `6/6 包 name/inject/Config/apply 齐 + cordis.patch.yml 存在`, '')
  else fail('A0-5', '插件形状静态可证', `缺项: ${bad.join(', ')}`, '回骨架步骤')
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

// ══ R0 反证判据（阶段 0 专属 · 真装配链）═════════════════════════════════════
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
  console.log('══════ Mana 阶段 0 验收判据机检（A0-1 … A0-13）══════')
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

// 基线记录辅助（A0-10 / A0-12）
if (argv.includes('--record-baseline')) {
  const { writeFileSync } = await import('node:fs')
  const SAMPLE = '/home/lk/dsh-src/dsh-plugin-roundtable'
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: SAMPLE, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: SAMPLE, encoding: 'utf8' })
      .split('\n').filter((l) => l.trim()).length
    execFileSync('mkdir', ['-p', P('tools')])
    writeFileSync(P('tools/.a0-10-baseline.json'), JSON.stringify({ head, dirty, recordedAt: new Date().toISOString() }, null, 2))
    const { createHash } = await import('node:crypto')
    const now = ['packages/core/src/event-types.ts', 'packages/core/src/domain.ts']
      .map((f) => `${createHash('sha256').update(readFileSync(P(f))).digest('hex')}  ${f}`)
      .join('\n')
    execFileSync('mkdir', ['-p', P('contract')])
    writeFileSync(P('docs/contract/_freeze.sha256'), now + '\n')
    // ⚠ 三件套必须**一起重取**：只更哈希腿而清单腿/HEAD 腿留旧值，就是让判据三腿互相矛盾。
    const list = execFileSync('bash', ['-lc', "find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/lib/*' | sort"], {
      cwd: P('.'), encoding: 'utf8',
    })
    writeFileSync(P('docs/contract/_freeze.files.txt'), list)
    writeFileSync(P('docs/contract/_freeze.head'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: P('.'), encoding: 'utf8' }))
    console.log(
      `\n[baseline recorded] sample HEAD=${head} dirty=${dirty}；契约快照三件套已重取` +
        `（sha256 / files.txt ${list.split('\n').filter(Boolean).length} 件 / head）`,
    )
  } catch (error) {
    console.error('基线记录失败:', error.message)
  }
}

process.exitCode = results.some((r) => r.state === 'FAIL') ? 1 : 0
