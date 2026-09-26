#!/usr/bin/env node
/**
 * Mana 阶段 1 验收判据机检器（A1-4 / A1-5 / A1-11 / A1-12）。
 *
 * 存在的理由：A0 级有统一入口（`tools/a0-check.mjs`），A1 级**没有** ——
 * 判据散在 `packages/vector/tests/b11-vector.test.mjs` 的用例里与各源码文件的注释里。
 * 「散在测试里」与「可重复机检」是两件事：后者才能被**别的席**在**自己那轮**跑出红。
 *
 * 真源（本脚本逐条对齐，不采信任何转述）：
 *  · 判据表：`docs/mana-rollout-plan.md` §1.2 自动判据表（A1-1 … A1-14 各行）
 *    ⚠ **行号不再写死**（K1 件 2）：册是活文档，写死的 `:454` 会在册一动之后指向**别的判据行**
 *      （实测：工作树与 HEAD 已差 1 行 ⇒ 12 处引用全部指偏）。行号每次**现读**，
 *      各项「依据」里的 `判据表 L<n>（<commit> 现读）` 就是当次量出来的坐标。
 *  · 可执行断言：`packages/vector/tests/b11-vector.test.mjs`（① ② ⑦ ⑧ ⑩ 等用例）
 *  · 阈值分档：`docs/contract/threshold-discipline.md`（A 档可进阈值列，B 档只进测量条件说明）
 *  · 降级约定：`docs/contract/degradation.md`
 *
 * 用法（根 `scripts` 里有同族入口 `npm run check:a1` —— 本脚本不是「我知道才跑」的私货）：
 *   npm run check:a1                             # = node tools/a1-check.mjs
 *   node tools/a1-check.mjs                      # 全量，逐项 PASS/FAIL
 *   node tools/a1-check.mjs --json               # 机读输出（含 itemSet / mutationSelfCheck）
 *   node tools/a1-check.mjs --mutate a1-4        # 变异自证：注入缺陷后**该项必须报红**
 *   node tools/a1-check.mjs --require-fresh-artifacts   # 把「产物过期」挂账升级为 FAIL
 *   node tools/a1-check.mjs --print-failure-dump [<路径>]   # 回读**上一次失败**的 not ok 明细（缺省取最近一份）
 *
 * ── 纪律（与 a0-check 同口径）─────────────────────────────────────────────
 *     2 = 用法错（未知变异器 / 同一判据被注入多个变异器）；3 = 变异自证腿不过。
 *     2 = 用法错（未知变异器 / 同一判据被注入多个变异器）；3 = 变异自证腿不过。
 *     **不得用管道取退出码**
 *     （`node x.mjs | tail` 的 `$?` 是 tail 的）。
 *  ② 「挂账」是**一等状态**，不等于通过（同 a0-check 的 HANG 语义）。
 *  ②′ **项集等式是门的一条腿**（实测判红事实 2026-09-24）：本脚本早前只用 `results.length`
 *     打印计数 ⇒ 复核席把 A1-11 整块（3108 B）删掉后仍打印「共 5 项 · ✅ 无 FAIL」且 exit 0。
 *     现改为与 `EXPECTED_IDS` **集合相等**（缺项/多项/重复各自点名）。⚠ 不许退回 `length === 6`：
 *     那是弱形态 —— 删一项再加一项仍为 6 项，实测仍会被抓（因按 id 对拍），但长度等式抓不到。
 *  ③ 每条判据都必须能**真跑出红**：`--mutate <id>` 是它的自证开关，且**跑完由脚本自己核验**
 *     「注入项确实红了、别的项没被误伤」（预注册 + 机检，见文末「变异自证腿」）。只做字符串常量比对、
 *     或断言「函数存在」，只能证明文件在长，不能证明行为对 —— 那类写法本脚本不收。
 *  ④ 本脚本另带两条**不会自己变绿**的腿：`ARTIFACTS`（产物**内容级**判定，挂账态，可用
 *     `--require-fresh-artifacts` 升级为 FAIL）与 `A1-5` 的「无实现者」态 —— 都不许被读成 PASS。
 *     ⚠ ARTIFACTS 的**主判定已从 mtime 改为内容**（F-04a，2026-09-25）：原腿只比 mtime，
 *       而 mtime 可被 `cp`（不带 -p）/`touch` 任意伪造 —— 旧产物 cp 回来即报「新鲜」（假绿），
 *       内容同步却 touch 成旧值即报「过期」（假红）。现把当前 src **重新编译**后与 lib **逐字节**比。
 *       档位语义**不变**：仍为挂账态，仍可被 `--require-fresh-artifacts` 升级为 FAIL。
 *
 * ⚠ **变异为纯内存注入**（本脚本的一条硬纪律）：
 *   变异时把被测源文件**原文读进内存**、替换锚点、写进临时目录的**克隆副本**再 import
 *   （相对 import 改写成绝对 file: URL），**绝不写回仓内任何源文件**。
 *   理由：`packages/vector/**` 是他席写面（且在途改动未提交）⇒ 判据不得为了自证去改它。
 *   取证：变异跑前/跑后 `git status --porcelain packages/vector packages/jev` 逐字相同。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
/** 本脚本自身路径：探针模式**重新起同一份脚本**（同一个实现，不另写探针文件 ⇒ 不会两处漂移）。 */
const HERE_ENTRY = fileURLToPath(import.meta.url)
const P = (...p) => join(ROOT, ...p)

/**
 * 递归收集 `dir` 下所有 `.ts` 文件（**必须递归**，本仓 2026-09-25 实测的漏检事实）。
 *
 * ⚠ 为什么不能只 `readdirSync(dir)`：
 *   `packages/ui/src/client/` 是**子目录**，其 `index.ts`/`host.ts` 是 client 半区的真源码。
 *   旧实现只扫 `src/` 顶层 ⇒ 改动 `src/client/index.ts` 后，`ARTIFACTS` 腿**不报 ui 过期**，
 *   而 `ui` 的 `lib/` 正是由这些子目录源码经 `scripts/build-client.mjs` 产出的
 *   ⇒ 「装了旧码」这件事在判据上不可见（本会议 `[env] 产物新鲜度` 那条教训的同一形态）。
 *   实测复现（本机）：`touch packages/ui/src/client/index.ts`（08:00）后，
 *   旧实现仍只报 core/user-model/vector，**不含 ui**。
 *
 * 排除 `node_modules` 与 `lib`：前者非本源、后者是产物（比产物自己比产物会平凡成立）。
 */
function collectTsFiles(dir) {
  const out = []
  const walk = (cur) => {
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'lib') continue
      const full = join(cur, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.ts')) out.push(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}
const SRC = P('packages/vector/src')
const url = (f) => pathToFileURL(f).href

/**
 * 跑一个子进程（node 命令）。
 *
 * ⚠ **不得用管道取退出码**（本仓硬纪律）：`node x.mjs | tail` 的 `$?` 是 `tail` 的。
 *   本函数用 `spawnSync` 直接取 `status`，不经 shell，故不存在该陷阱。
 * ⚠ 只传数组参数、不经 shell ⇒ 无引号/通配注入面。
 */
function node(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...opts })
  return { ok: r.status === 0, code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const REQUIRE_FRESH = argv.includes('--require-fresh-artifacts')
const MUTATES = (() => {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mutate') {
      const v = String(argv[i + 1] ?? '')
      out.push(...v.split(',').map((s) => s.trim()).filter(Boolean))
    }
  }
  return new Set(out)
})()

const results = []
/** state: 'PASS' | 'FAIL' | 'HANG'（挂账：本项无仓内实现可测，或环境性缺口）| 'NONE'（无实现者，见 A1-5） */
const record = (id, title, state, detail, evidence = '') =>
  // ⚠ detail 统一追加取数坐标（F-06）：16 项**每项**都带，避免「有的项带、有的项不带」的漂移。
  results.push({ id, title, state, detail: withCoord(detail), evidence })
const pass = (id, t, d, e) => record(id, t, 'PASS', d, e)
const fail = (id, t, d, e) => record(id, t, 'FAIL', d, e)
/**
 * 挂账项：第 5 参 = **溯源字段**（加固 1，见 `hangProv`）。
 * ⚠ 缺它 ⇒ 挂账自检腿 `hangProvenance` 点名（只报不拦：这是可读性/可追溯性的补强，
 *   不是新判据档位；把「没写溯源」升级成 FAIL 会与「不改判据档位」的约束冲突）。
 */
const hang = (id, t, d, e, prov) => record(id, t, 'HANG', prov ? d + hangProv(prov) : d, e)
const none = (id, t, d, e) => record(id, t, 'NONE', d, e)

// ══ 挂账项的溯源字段（加固 1；主持人裁定 2026-09-25）══════════════════════════
/**
 * ⚠ **为什么挂账项必须有这两行**（主持人实读，不是推测）：挂账项此前只有一句话描述，
 *   后果**不是「字少」，是跨阶段静默**：
 *     · `A1-5` 在 a1-check 里记 HANG，而它的实现/验收归属落在**阶段 3** 的 `B4.2`
 *       ⇒ **阶段 1 的门读它通过**，只读报告的人看不见「它原定根本不在阶段 1 验收」；
 *     · `ARTIFACTS` 的挂账已跨多次提交，同样没有「什么时候开始挂的」。
 *   ⇒ 每个 HANG 的 detail 必须能回答两句：**首现时刻**、**原定验收阶段**。
 *
 * ⚠ **只加可读信息，不改任何判据档位**（HANG 仍是 HANG，不许变 FAIL）—— 档位属拍板面。
 * ⚠ **阶段号不硬编码**：`sectionSlice` / `critAnchor` / `batchAnchor` 都**从
 *   `docs/mana-rollout-plan.md` 现读** —— 「判据表行 → 所属阶段段 → 该阶段批次」是那份
 *   文档的结构事实，不是本脚本的常量。写不出就**显式标「待补」**，绝不编一个
 *   （编出来的比空着更坏：它会被当成已核事实读走）。
 * ⚠ 读文档失败**不是**本项判红条件（本项是挂账态、且判据表不是本脚本的写面）；
 *   失败表现为那两行里出现 `待补`，并由挂账自检腿 `hangProvenance` 点名（非阻断）。
 */
const PLAN_PATH = P('docs/mana-rollout-plan.md')
let _planLines = undefined
function planLines() {
  if (_planLines === undefined) {
    try { _planLines = readFileSync(PLAN_PATH, 'utf8').split(/\r?\n/) } catch { _planLines = null }
  }
  return _planLines
}
/** 顶级节切片：`top` = '4' ⇒ { start, end, text }（1-based 行号，覆盖 `## 4. …` 到下一个 `## N. `）。 */
function sectionSlice(top) {
  const ls = planLines()
  if (!ls) return null
  const heads = []
  ls.forEach((l, i) => { const m = l.match(/^##\s+(\d+)\./); if (m) heads.push({ num: m[1], i }) })
  const at = heads.findIndex((h) => h.num === String(top))
  if (at < 0) return null
  const end = at + 1 < heads.length ? heads[at + 1].i : ls.length
  const slice = ls.slice(heads[at].i, end)
  return { start: heads[at].i + 1, end, text: slice.join('\n'), lines: slice }
}
/** 某顶级节里全部 `§N.M` 引用的去重集合（供 C16 致盲腿用；`可见` = C16 正则会匹配的那些）。 */
function sectionSectionRefs(top) {
  const s = sectionSlice(top)
  if (!s) return null
  const all = new Set(); const visible = new Set()
  for (const l of s.lines) {
    for (const m of l.matchAll(/§(\d+(?:\.\d+)*)/g)) all.add(m[1])
    for (const m of l.matchAll(/(?:见|读|跳|按|回|阅)\s*(?:本册\s*)?§(\d+(?:\.\d+)*)/g)) visible.add(m[1])
  }
  return { start: s.start, all, visible }
}
/** 判据表里 `id` 那一行的锚点 + 它所在**阶段段**的批次清单（全部现读，读不到返回 null）。 */
function critAnchor(id) {
  const ls = planLines()
  if (!ls) return null
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rx = new RegExp('^\\|\\s*\\**' + esc + '\\**\\s*\\|')
  const at = ls.findIndex((l) => rx.test(l))
  if (at < 0) return null
  let stage = null; let stageAt = -1
  for (let i = at; i >= 0; i -= 1) {
    const m = ls[i].match(/^###\s+阶段\s+(\d+)/)
    if (m) { stage = Number(m[1]); stageAt = i; break }
  }
  const batches = []
  if (stageAt >= 0) {
    for (let i = stageAt; i < ls.length; i += 1) {
      const h = ls[i].match(/^###\s+阶段\s+(\d+)/)
      if (h && Number(h[1]) !== stage) break
      const b = ls[i].match(/^\|\s*\*\*(B\d+\.\d+)\*\*\s*\|/)
      if (b) batches.push({ code: b[1], line: i + 1 })
    }
  }
  return { line: at + 1, stage, batches }
}
/** 批次号（如 B4.2）在 §4 的锚点行与**它自己所属的阶段**（现读）。 */
function batchAnchor(code) {
  const ls = planLines()
  if (!ls) return null
  const rx = new RegExp('^\\|\\s*\\*\\*' + code.replace('.', '\\.') + '\\*\\*\\s*\\|')
  const at = ls.findIndex((l) => rx.test(l))
  if (at < 0) return null
  let stage = null
  for (let i = at; i >= 0; i -= 1) {
    const m = ls[i].match(/^###\s+阶段\s+(\d+)/)
    if (m) { stage = Number(m[1]); break }
  }
  return { line: at + 1, stage }
}
/** 挂账溯源的统一渲染（一处实现，避免三处格式漂移）。 */
function hangProv({ token, crit, implBatch, note }) {
  // 首现时刻：git log -S <token> 取**最早**那条 commit（该字符串首次进入本文件的提交）。
  let first = '**待补**（git 历史不可得）'
  try {
    const r = spawnSync('git', ['log', '--format=%h|%ad', '--date=short', '-S', token, '--', 'tools/a1-check.mjs'], { cwd: ROOT, encoding: 'utf8' })
    const row = String(r.stdout ?? '').trim().split('\n').filter(Boolean).pop()
    if (row) { const [h, d] = row.split('|'); first = `${h} (${d})` }
  } catch { /* 保持待补 */ }
  const bits = [`⏱ 首现 ${first}（git log -S "${token}" 实测）`]
  const c = crit ? critAnchor(crit) : null
  const b = implBatch ? batchAnchor(implBatch) : null
  if (crit) {
    bits.push(c
      ? `判据表行 ${crit}@L${c.line}（所在阶段段 = 阶段 ${c.stage}）`
      : `判据表行 ${crit} **待补**（本册现读不到该行 —— 表被改名/移动）`)
  } else {
    bits.push('本项**不在判据表内**（本册未给「' + (token === 'ARTIFACTS' ? '产物新鲜度' : 'vec0 语义') + '」立独立验收条）')
  }
  if (implBatch) {
    bits.push(b
      ? `实现/验收归属批次 ${implBatch}@L${b.line}（阶段 ${b.stage}）`
      : `实现/验收归属批次 ${implBatch} **待补**（本册现读不到该批次行）`)
    if (b && c && b.stage !== c.stage) {
      bits.push(`⚠ **跨阶段**：本项在阶段 ${c.stage} 的判据表里、由阶段 ${c.stage} 的门读；而实现与验收归属在阶段 ${b.stage} ⇒ 阶段 ${c.stage} 的绿**不构成**本项被验收`)
    } else if (b && !c) {
      bits.push(`⚠ 归期：本项无判据表行，验收归属阶段 ${b.stage}`)
    }
  } else if (!crit) {
    bits.push('原定验收阶段 = **待补**（触发式项，本册未给「何时启用」的验收阶段）')
  }
  if (note) bits.push(note)
  return `｜⏱ 挂账溯源：${bits.join('｜')}`
}
/**
 * 挂账 detail 的**字段存在性判定**（一处实现：`--self-test` 与真数据检查共用同一个函数
 * —— 两处各写一遍会让「自测绿而真数据没查」这种假覆盖重新长出来）。
 *
 * `hasFirst` 对「首现 = 待补」判**假**：首现时刻由 `git log -S` 现算，在本仓内**总该有值**，
 *   待补意味着历史丢失或函数被绕过 ⇒ 必须红（这正是「清空首现 ⇒ 报红」的落点）。
 * `hasTarget` 只要求**给出了归属**（判据表行 / 归属批次 / 跨阶段 / 归期任一），
 *   不要求阶段号一定存在 —— 「本册没有」时如实写待补是正确口径，不算缺字段。
 */
function provFieldsOf(detail) {
  const d = String(detail ?? '')
  return {
    hasProv: /挂账溯源/.test(d),
    hasFirst: /首现/.test(d) && !/首现 \*\*待补\*\*/.test(d),
    hasTarget: /判据表行|归属批次|跨阶段|归期|不在判据表内/.test(d),
  }
}

// ── 变异装置（内存克隆，零磁盘写入仓内文件）──────────────────────────────────
/**
 * 每个变异器 = 一份「锚点 → 替换」清单。锚点必须**恰好命中一次**（命中 0 次即抛：
 * 说明真源已改，变异器已过期 —— 此时静默通过就是假绿）。
 */
const MUTATORS = {
  'a1-4': {
    target: 'A1-4',
    file: 'rrf.ts',
    why: '把真源默认常数 RRF_DEFAULT_K 由 60 改成 59（判据表 A1-4 原文 k=60）',
    edits: [['export const RRF_DEFAULT_K = 60', 'export const RRF_DEFAULT_K = 59']],
  },
  'a1-4-num': {
    target: 'A1-4',
    file: 'rrf.ts',
    why: '把 RRF 分量算式由 1/(k+rank) 篡改为 1/(k+rank+1)（数值腿，常量不动）',
    edits: [['return 1 / (k + rank)', 'return 1 / (k + rank + 1)']],
  },
  'a1-11': {
    target: 'A1-11',
    file: 'recall.ts',
    why: '把降级信封的 channel 由 degraded 篡改为 vector（=「看起来跑通、实际全走词法」的经典形态）',
    edits: [["    channel: 'degraded',", "    channel: 'vector',"]],
  },
  'a1-11-rankby': {
    target: 'A1-11',
    file: 'recall.ts',
    // ⚠ 锚点必须**含上下文**才能唯一：`rankBy: 'local_score'` 在 recall.ts 里出现两次
    //   （降级信封 :41 与词法分支 :83）⇒ 只写一行会命中 2 次，注入即失败。
    why: "把**降级信封**的 rankBy 由 'local_score' 篡改为 'jev_prob'（判据表 A1-11 点名的错值；锚点带上一行 channel 以唯一化）",
    edits: [
      [
        "    channel: 'degraded',\n    rankBy: 'local_score',",
        "    channel: 'degraded',\n    rankBy: 'jev_prob',",
      ],
    ],
  },
  'a1-12': {
    target: 'A1-12',
    file: 'cosine.ts',
    why: '删掉维度契约检查（dim 必须 == 1024 的那条腿）',
    edits: [['  if (vec.length !== dim) return `嵌入维度不符：期望 ${dim} 维，实际 ${vec.length} 维`', '  void dim']],
  },
  /**
   * ── A1-5 的两条**实现变异**（本轮替代原 `selfKernel: true` 的"判据内联核自证"）────────
   * 为什么换掉：旧块无仓内实现可测，变异只能打在**判据自己的**闭式核上 ⇒ 它证明的是
   *   "判据的算式会随常量变红"，**不是**"真实现被扰动时判据会红"。真核出现后前者已无意义。
   * ⚠ 两条**必须都留**（缺一条即有盲区，均由实现面反例实证）：
   *   · `a1-5-halflife`：改 `params.ts` 的 `HALF_LIFE_DAYS` 14→7。**这正是改前反证所用的扰动**
   *     ——旧块在该扰动下仍报 `decay(14)=0.500000`、仍 HANG、exit 0（对真源失明）。
   *   · `a1-5-num`：改真核算式 `exp(-t·ln2/h)` → `…+1`（**常量全不动**）。只留 halflife 一条时，
   *     一个把 h 用错（如 h→h²）的核仍可能过锚点 ⇒ 算式级缺陷无人覆盖。
   * ⚠ 一条判据一次只注入一个缺陷（用法闸 exit 2 强制），故两条各自单独跑、**各自登记**。
   */
  'a1-5-halflife': {
    target: 'A1-5',
    pkg: 'long-term',
    // ⚠ 锚点住在 `params.ts`（`decay.ts` 顶部只是 `import { HALF_LIFE_DAYS } from './params.ts'`）。
    //   第一版把锚点写成 `file:'decay.ts'` ⇒ 在**错的文件**里找锚点 ⇒ 命中 0 次 ⇒ 抛「锚点已过期」；
    //   那次运行由变异自证腿报「变异**未真正注入**」（exit 3），**没有**静默通过。
    //   ⇒ **锚点归属必须与常量归属一致**；主文件仍是真核（观测点），依赖文件由 also 带进克隆目录。
    file: 'params.ts',
    also: [{ file: 'decay.ts' }],
    numberWitness: true,
    edits: [['export const HALF_LIFE_DAYS = 14', 'export const HALF_LIFE_DAYS = 7']],
    why: '把真核的冻结半衰期由 14 天篡改为 7 天（判据表 A1-5 原文 h=14）—— 锚点 decay(14) 须由 0.500000 变为 0.250000 ⇒ 本项必红',
  },
  'a1-5-num': {
    target: 'A1-5',
    pkg: 'long-term',
    file: 'decay.ts',
    numberWitness: true,
    edits: [['return Math.exp((-t * Math.LN2) / halfLifeDays)', 'return Math.exp((-t * Math.LN2) / halfLifeDays + 1)']],
    why: '把真核算式由 exp(−t·ln2/h) 篡改为 exp(−t·ln2/h + 1)（**常量全不动**）⇒ 锚点必红 —— 常量腿抓不到算式级缺陷',
  },
  'a1-5-knob': {
    /**
     * ── **死旋钮核**（N3 合并轮新增；来历：另一条独立实现线实测复现）──────────────────
     * ⚠ **它与上面两条都不重叠**，故必须单列：
     *   · `a1-5-halflife` 改**常量** ⇒ 三锚点全变值 ⇒ 咬住；
     *   · `a1-5-num` 改**算式**（+1）⇒ 三锚点全变值 ⇒ 咬住；
     *   · **本条**改的是**参数消费**：让核**忽略传入的 `halfLifeDays`**、恒用缺省 14。
     *     ⇒ 三锚点（全是单参调用，本来就用缺省）**原样通过**；
     *        `paramsOk` 腿（判"缺省值来自 params"）**也通过** —— 缺省值确实来自 params；
     *        带牙腿 `consumes-half-life` 的**自洽式**在 h₂=h₁ 时平凡成立 ⇒ **也通过**。
     *     ⇒ 唯一能咬住它的就是**死旋钮探针**（同 t、h 减半 ⇒ 留存率必须变小）。
     * ⚠ 本变异器是那条探针**存在的证明**：没有它，探针就是一条"永远绿且不可能红"的死腿
     *   （本仓对死分支有实测教训）。
     */
    target: 'A1-5',
    pkg: 'long-term',
    file: 'decay.ts',
    numberWitness: true,
    edits: [
      [
        'return Math.exp((-t * Math.LN2) / halfLifeDays)',
        // 忽略参数：恒用半衰期 14（= 缺省值），使"参数被消费"这条关系失效。
        'void halfLifeDays; return Math.exp((-t * Math.LN2) / 14)',
      ],
    ],
    why: '让真核**忽略 halfLifeDays 参数**（恒用 14）⇒ 三锚点与 paramsOk 腿**全过**，只有死旋钮探针咬得住 —— 证明该探针不是死腿',
  },
}

/**
 * ── 用法闸（0 号闸）：**在判据腿之前**失败 ────────────────────────────────────
 *
 * ⚠ 本仓 2026-09-25 实测的「失败不可观测」：这两道闸原先写在文末 ——
 *   报告已经把「✅ 门通过」印完、16 项判据全跑完（约 2 分钟），**才** `exit 2`。
 *   只读报告的人（或把 stdout 贴给别人看、管道取退出码 `| tail` 的人）看到的是**全绿**。
 *   ⇒ 闸前移到**任何判据被执行之前**：用法错时既不跑腿、也不产生报告，
 *     只打印错误并以 exit 2 结束（不进入下面的判据块与输出段）。
 */
const usageErrorEarly = (() => {
  const dup = Object.entries(
    [...MUTATES].reduce((acc, m) => {
      const t = MUTATORS[m]?.target
      if (t) (acc[t] ??= []).push(m)
      return acc
    }, {}),
  ).filter(([, ms]) => ms.length > 1)
  const unknown = [...MUTATES].filter((m) => !MUTATORS[m])
  if (unknown.length) return `✗ 未知变异器：${unknown.join(', ')}（可用：${Object.keys(MUTATORS).join(', ')}）`
  if (dup.length)
    return (
      `✗ 同一判据被注入多个变异器：${dup.map(([t, ms]) => `${t}←${ms.join('+')}`).join('，')}` +
      `（一次只判一个缺陷，否则"哪条腿有牙"不可分辨）`
    )
  return ''
})()
if (usageErrorEarly) {
  // process.exit 而非 exitCode：**判据腿一条都不跑**（用法错的运行不产生任何判据结论）
  console.error(usageErrorEarly)
  console.error('（用法错 ⇒ 本次运行不跑判据腿、不产生报告；修正参数后重跑，避免把上一次的全绿当成本次结论）')
  process.exit(2)
}
// ── 嵌入可达性探针模式（A1-12 的网络腿：把「不可达」与「可达但超时」分开）─────────
/**
 * ⚠ 为什么必须是**子进程**：undici 的 EnvHttpProxyAgent 在进程启动时读环境变量，
 *   本进程内改 process.env 不会改变已建好的 dispatcher ⇒ 「两态对照」只能靠重新起进程。
 *   `env -u NODE_USE_ENV_PROXY` 与 `delete env.NODE_USE_ENV_PROXY` 是同一件事。
 *
 * 输出：**单行 JSON**（stdout）。判据只读这一行，不解析人话 —— 人话是给人看的。
 *
 * ⚠ 本模式**不改任何超时**（F-07a 明确禁止「调大 timeout 当修法」）：
 *   超时值由调用方传入并**原样打印**，供读报告的人判断「这次红是服务真不可达，还是被拖慢」。
 */
if (argv.includes('--embed-reach-probe')) {
  const getArg = (name, def) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def
  }
  const baseUrl = getArg('--base-url', 'http://127.0.0.1:11434/v1')
  const timeoutMs = Number(getArg('--timeout-ms', '30000'))
  const text = getArg('--text', '向量适配判据探针')
  const connTimeoutMs = Math.min(2000, timeoutMs)
  const { connect } = await import('node:net')
  const u = new URL(baseUrl)
  const host = u.hostname
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  /** TCP 层可达性：**与嵌入请求分开测** —— 这是把「连不上」与「连上了但慢」分开的唯一实证。 */
  const connT0 = Date.now()
  const conn = await new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    const sock = connect({ host, port, timeout: connTimeoutMs })
    sock.once('connect', () => { sock.destroy(); done({ ok: true, kind: 'connected', ms: Date.now() - connT0 }) })
    sock.once('timeout', () => { sock.destroy(); done({ ok: false, kind: 'timeout', ms: Date.now() - connT0 }) })
    sock.once('error', (e) => done({ ok: false, kind: String(e.code ?? e.name ?? 'error'), ms: Date.now() - connT0 }))
  })
  let embed = { ok: false, degraded: null, ms: null, reason: '(未执行)' }
  /**
   * ⚠ **不能只看 embed.ts 的 reason**（本仓 2026-09-25 实测踩到）：
   *   embed.ts 的 catch 只存 `${error.name}: ${error.message}` ⇒ undici 的包装错
   *   把真因藏在 **cause 链**里，外面看到的恒为 `TypeError: fetch failed`。
   *   实测三例（`node -e` 直测）：端口 45999 → cause.message=`ECONNREFUSED`；
   *   端口 65500 → cause.code=`UND_ERR_CONNECT_TIMEOUT`；端口 1/9 → cause.name=`Error`
   *   （**连 cause 都没有**，因为 undici 对「低端口」直接以 `bad port` 拒绝，不发起连接）。
   *   ⇒ 归因改用**独立的** raw fetch 探针读 cause 链；那一路**不经过 embed.ts**，
   *     但**用的是同一份环境**（同在探针进程内），故「两态」对照的变量仍是干净的。
   */
  const causeChain = async (u) => {
    const parts = []
    try {
      await fetch(`${baseUrl}/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(timeoutMs) })
      parts.push('（raw fetch 未抛）')
    } catch (error) {
      parts.push(`${error.name}: ${error.message}`)
      let c = error.cause
      for (let i = 0; c && i < 5; i++) {
        parts.push(`${c.code ?? c.name ?? 'cause'}: ${String(c.message ?? '').slice(0, 80)}`)
        c = c.cause
      }
    }
    void u
    return parts.join(' <- ')
  }
  const rawCause = await causeChain(baseUrl)
  try {
    const { embedTexts } = await import(url(join(SRC, 'embed.ts')))
    const out = await embedTexts({ enabled: true, baseUrl, model: 'bge-m3', dim: 1024, timeoutMs }, [text])
    embed = { ok: !out.degraded, degraded: out.degraded, ms: out.ms, reason: out.reason, dim: out.vectors?.[0]?.length ?? null }
  } catch (error) {
    embed = { ok: false, degraded: null, ms: null, reason: `探针加载/执行失败：${error.message}` }
  }
  /**
   * 归因：**reason 字符串 + cause 链 + TCP 实测**三者合看 —— 只看 reason 会把两类事混成一种红
   *（F-07a 的原缺陷正是这个）。类别与判据：
   *   · REFUSED      = 连接被拒（`ECONNREFUSED`）：端口上真没服务；
   *   · DNS          = 主机名解析不了；
   *   · TIMEOUT_AFTER_CONNECT = **TCP 已连上**却在 timeoutMs 内没答完 ⇒ 服务在、就是慢；
   *   · TIMEOUT_BEFORE_CONNECT = TCP 没连上且没拿到明确拒绝 ⇒ 「慢」与「不可达」**不可分辨**；
   *   · LOWPORT      = undici 以 `bad port` 直接拒绝（**低端口**实测形态，不发起连接）——
   *                    与「服务不可达」不是一类：那是在**判据刚起步**就被客户端挡下；
   *   · OTHER / OK。
   * ⚠ 本仓实测（2026-09-25）：**TCP 对低端口（1/9/80/443/8080）实测 1.5s 静默超时**
   *   （无监听也不回 RST；只有 4 万以上的高位端口才给 ECONNREFUSED）。故 TCP 腿的 `timeout`
   *   **不能**读成「不可达」—— 必须如实标注不可分辨，而不是替读者下结论。
   */
  const r = String(embed.reason ?? '')
  const causeText = `${rawCause} ${r}`
  let kind = 'OK'
  if (embed.degraded) {
    if (/bad port/i.test(causeText)) kind = 'LOWPORT'
    else if (/缺 apiKey|嵌入已禁用|未配置嵌入模型|未配置嵌入端点/.test(r)) kind = 'CONFIG'
    else if (/ENOTFOUND|EAI_AGAIN|ERR_INVALID_URL/.test(causeText) || /ENOTFOUND|EAI_AGAIN/.test(String(conn.kind))) kind = 'DNS'
    else if (/ECONNREFUSED/.test(causeText)) kind = 'REFUSED'
    else if (/TimeoutError|AbortError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|fetch failed/.test(causeText)) kind = conn.ok ? 'TIMEOUT_AFTER_CONNECT' : 'TIMEOUT_BEFORE_CONNECT'
    else kind = 'OTHER'
  }
  const attribution = {
    OK: `可达（dim=${embed.dim}，嵌入耗时 ${embed.ms}ms，TCP ${conn.ms}ms）`,
    REFUSED: `**连接被拒**（端口 ${port} 无监听；cause=${causeText}）—— 是服务没在跑，不是被拖慢`,
    DNS: `**无法解析主机** ${host}（TCP 层 kind=${conn.kind}，${conn.ms}ms；cause=${causeText}）—— 不是超时`,
    CONFIG: `**配置面失败、请求根本没发出**（${r.slice(0, 120)}）—— 与「服务不可达」「服务慢」都不同类，先看配置`,
    TIMEOUT_AFTER_CONNECT: `**已连接但超时**（TCP 连接 ${conn.ms}ms 成功 ⇒ 服务在本端口上；嵌入请求在 timeoutMs=${timeoutMs} 内未返回，实测 ${embed.ms}ms）—— 与「服务不可达」不是一类`,
    TIMEOUT_BEFORE_CONNECT: `**连接阶段超时或不可达**（TCP ${connTimeoutMs}ms 内未建立连接，kind=${conn.kind}；cause=${causeText}）—— 本探针**无法分辨**「服务慢」与「服务不可达」，如实标注`,
    LOWPORT: `**被客户端按「bad port」挡下**（端口 ${port}；cause=${causeText}）—— 请求**根本没发出**，因此这不是「服务不可达」，也不是「服务慢」`,
    OTHER: `其他失败（自定义归因缺省；cause=${causeText}）：${r.slice(0, 200)}`,
  }[kind]
  const envKeys = ['NODE_USE_ENV_PROXY', 'no_proxy', 'NO_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY']
  const env = Object.fromEntries(envKeys.map((k) => [k, process.env[k] === undefined ? null : process.env[k]]))
  console.log(
    JSON.stringify({
      phase: 'embed-reach',
      at: new Date().toISOString(),
      baseUrl,
      host,
      port,
      timeoutMs,
      connect: conn,
      rawCause,
      embed,
      kind,
      attribution,
      env,
    }),
  )
  process.exit(0)
}

/**
 * `--print-failure-dump [<路径>]`：把留档**读回来**（缺省取最近一份）。
 *
 * ⚠ 这条通道是「明细可被重新读到」这句话的**机器落点** —— 没有它，留档就只是「文件在长」，
 *   与「代理指标非判据」是同一条纪律（文件在长 ≠ 有人能读回失败原因）。
 * ⚠ 本模式**在锁之前**分流（与 `--embed-reach-probe` 同族）：它只读文件、不跑判据腿、
 *   不碰工作树 ⇒ 让判据器正忙时读回上一次的失败留档，是**该支持**的动作；
 *   若放到锁之后，这条通道会在最需要它的时候（有实例在跑）报 exit 4。
 * ⚠ 读不到 ≠ 没有失败：读不到时 exit 2 并**明说**这一条，不许让它看起来像「判据全绿」。
 */
if (argv.includes('--print-failure-dump')) {
  const i = argv.indexOf('--print-failure-dump')
  const dir = process.env.MANA_A1_FAILURE_DIR || join(homedir(), '.cache', 'mana', 'a1-check')
  const explicit = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
  let target = explicit
  if (!target) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
      target = files.length ? join(dir, files[files.length - 1]) : null
    } catch { target = null }
  }
  if (!target || !existsSync(target)) {
    console.error(`✗ 读不到失败留档：${target ?? `（目录为空或不存在：${dir}）`}`)
    console.error('  ⚠ 这不是「没有失败」—— 本模式只读**已经落盘的**留档；未落盘时它就是读不到（不得读成判据全绿）')
    process.exit(2)
  }
  const raw = JSON.parse(readFileSync(target, 'utf8'))
  console.log(`══════ 失败留档回读：${target}（${statSync(target).size} B）══════`)
  console.log(`坐标：${JSON.stringify(raw.coord ?? {})}`)
  console.log(`留档退出码=${raw.exitCode} 变异自证腿不通过=${raw.harnessFail} 判据项 FAIL ${raw.items?.length ?? 0} 项 [${(raw.items ?? []).map((x) => x.id).join(', ')}]`)
  console.log(`原始 TAP 里 not ok 共 ${(raw.raw ?? []).reduce((a, r) => a + r.notOk.length, 0)} 条，分布在：${(raw.raw ?? []).map((r) => `${r.file}×${r.notOk.length}`).join(' / ') || '（无）'}`)
  for (const r of raw.raw ?? []) {
    for (const n2 of r.notOk) {
      console.log(`\n── ✗ ${n2.name}（${r.file}:${n2.at}）──`)
      console.log(n2.block)
    }
  }
  for (const it of raw.items ?? []) {
    console.log(`\n── ✗ 判据项 ${it.id}：${it.detail}`)
    if (it.evidence) console.log(`   依据: ${it.evidence}`)
  }
  process.exit(0)
}
// ══ K1 件 3：判据器失败时留存 `not ok` 明细（失败可事后归因）════════════════════
/**
 * ⚠ **为什么必须落盘、且必须可重读**（本仓纪律「代理指标非判据」的同一形态）：
 *   此前只有一处正则从 TAP 里抠 `not ok` 行，抠完就只用于拼一句 detail —— **明细不留存**。
 *   判据器一红，能带走的只有「哪几个用例名挂了」，而挂的**原因**（断言消息 / 期望值 / 实际栈）
 *   随子进程一起消失 ⇒ 事后归因只能复跑，而复跑时工作树可能已经变了（本仓并发纪律下这是常态）。
 *
 * ⚠ **不得只写 stderr**（K1 卡面明确要求）：stderr 在管道/CI 里会被截断或根本没人接，
 *   更关键的是**重开一次进程读不回来**。故这里落**文件** + 在报告里印出**绝对路径**，
 *   并在摘录里同时给出读回方式（`--print-failure-dump [<路径>]`）。
 *
 * ⚠ 落点**不在仓内**（本脚本的写面只有它自己这一个文件；写仓内其它路径是越界）：
 *   `\$MANA_A1_FAILURE_DIR` → 否则 `~/.cache/mana/a1-check/`。
 *   （同族先例：`checker-lock.mjs:1-30` 把锁放 `tmpdir()` 而不放仓内 —— 都是「运行态不污染工作树」）
 *
 * ⚠ **落盘本身不得改变判据结论**：写失败只降级为 `writeError` 字段 + stdout 一行警告，
 *   绝不让「归档失败」伪装成「判据失败」，也绝不让它把判据的绿变红。
 */
function failureDumpPath() {
  const dir = process.env.MANA_A1_FAILURE_DIR || join(homedir(), '.cache', 'mana', 'a1-check')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(dir, `failures-${stamp}.json`)
}
/** 从一段 TAP 里逐条抠 `not ok` 明细（**全文**，不截断 —— 截断本身就是「让失败不可观测」）。 */
function extractNotOk(text) {
  const ls = String(text ?? '').split(/\r?\n/)
  const out = []
  for (let i = 0; i < ls.length; i += 1) {
    const m = /^not ok \d+ - (.*)$/.exec(ls[i])
    if (!m) continue
    const after = ls.slice(i + 1, i + 16)
    const stop = after.findIndex((x) => /^(ok|not ok) \d+ - /.test(x))
    const block = (stop >= 0 ? after.slice(0, stop) : after).join('\n').replace(/\s+$/, '')
    out.push({ name: m[1], at: i + 1, block })
  }
  return out
}
function writeFailureDump(payload) {
  const path = failureDumpPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(payload, null, 2) + '\n')
    return { path, writeError: null }
  } catch (error) {
    return { path: null, writeError: `${error.code ?? error.name}: ${error.message}` }
  }
}

// ══ 单实例锁（并发纪律 §1 的机器落点；F-05b，主持人拍板口径 A）════════════════
//
// ⚠ 为什么必须「非零退出 + 打印持有者」而不是「静默排队」：并发实例会互相把对方的在途码
//   读进自己的读数（会议期间 ps 实拍三方并发跑同一 checker ⇒ 同 HEAD 下红绿互异、
//   _freeze.head 被写→回滚）。排队会把「两个实例同时在跑」变成不可见 —— 那正是要防的形态。
//
// ⚠ 锁对象含 `--record-baseline`（本脚本虽无该开关，但**同一台机上 a0 的录基线**与 a1 的判据
//   也会争抢同一工作树；故锁文件的 `mode` 字段如实标注本次模式，便于读报告的人判断冲突性质）。
// ⚠ 本闸在**任何判据腿之前**跑失败；退出码 3 = 拿不到锁（与既有 0/1/2 三态不混，见文件头）。
let lockRelease = null
/**
 * `--held-lock <token>`：**父进程已持有 a1 锁**时的「校验型」入口。
 *
 * ⚠ 为什么需要它（不是为方便，是为了让**覆盖关系**可机检）：
 *   a0-check 的 A1 腿会 spawn 本脚本。若子 a1 也去**获取**锁，a0 跑的同时另一个席跑 a1
 *   就会让 A1 腿报红 —— 而那是**并发冲突**，不是判据挂（本席实拍过这个形态）。
 *   ⇒ a0 同时持有 a0-lock 与 a1-lock，并把 token 传下来；子 a1 **只校验**：
 *     锁文件存在、pid 是父进程、token 逐字相等。校验不过一律按「拿不到锁」处理（exit 4）。
 *   ⚠ 这不是「给子进程开后门」：token 由**当次运行**的 randomUUID 生成，
 *     外部无法先猜到并伪造；校验失败即退出，不会出现「两个实例都跑起来」。
 */
const HELD_LOCK = (() => {
  const i = argv.indexOf('--held-lock')
  return i >= 0 ? String(argv[i + 1] ?? '') : null
})()
try {
  const { acquireLock, processStartToken, lockPathFor, lockStatus } = await import('./checker-lock.mjs')
  const lp = lockPathFor(ROOT, 'a1-check')
  if (HELD_LOCK !== null) {
    const st = lockStatus(lp)
    const h = st.holder ?? {}
    const okHeld = st.held && h.token === HELD_LOCK && h.pid === process.ppid
    if (!okHeld) {
      console.error('✗ --held-lock 校验失败：锁并非由本进程的父进程持有（token/pid 不符）')
      console.error(`  期望 pid=${process.ppid} token=${HELD_LOCK?.slice(0, 8)}…；锁内 pid=${h.pid ?? '?'} token=${String(h.token ?? '').slice(0, 8)}… 存在=${st.held}`)
      console.error(`  锁文件：${lp}`)
      process.exit(4)
    }
  } else {
    lockRelease = acquireLock(lp, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      commit: (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '?' } })(),
      argv: process.argv.slice(2).join(' ') || '(无参数)',
      checker: 'tools/a1-check.mjs',
      mode: MUTATES.size ? `mutate:${[...MUTATES].join(',')}` : JSON_OUT ? 'judge(--json)' : 'judge',
      startToken: processStartToken(process.pid),
    })
  }
} catch (error) {
  if (error.name === 'LockHeldError') {
    const h = error.holder ?? {}
    console.error('✗ 另一个 a1-check 实例正在运行 —— 本实例拒绝启动（**不排队**）')
    console.error(`  持有者：pid=${h.pid} 起始时刻=${h.startedAt} commit=${h.commit} 模式=${h.mode} 参数=${h.argv}`)
    console.error(`  锁文件：${error.lockPath}`)
    console.error('  为什么拒绝排队：并发实例会互相把对方的在途码读进读数，判据红绿不可归因（并发纪律 §1）')
    console.error('  处置：等它跑完，或确认它已死（kill -9 后残留的锁会在下一次运行时被**留痕接管**）')
    process.exit(4)
  }
  throw error
}
process.on('exit', () => { try { lockRelease?.release() } catch { /* ignore */ } })

/** 变异生效登记：克隆体**真的**与真源不同才记（锚点未命中 ⇒ 不许当成"变异成功"）。 */
const mutApplied = new Set()
/**
 * **读数见证**生效登记 —— 与 `mutApplied` **是两回事**，故分成两个集合。
 *
 * · `mutApplied` = 「源文件**克隆体**被写出来并被加载」：证据在**文件系统**上（锚点必须恰好命中一次）。
 * · `selfApplied` = 「扰动确实改变了**该项算出来的那个数**」：唯一客观证据是**读数变成了
 *   换过之后的那个**（如 A1-5 的 `decay(14)` 由 0.500000 变 0.250000）—— 于是登记点写在
 *   "数出来是这样"上，而不是写在"请求了变异"上（后者恒真：请求标志与赋值条件本来就是同一个表达式）。
 *
 * ⚠ 这个区分是本轮（S7）修出来的：此前自证腿的分支写成
 *   `mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)` —— **两个分支字面相同**，
 *   自证分支是死功能（分支形式还在、语义已经丢了）。而那唯一被它覆盖的 `a1-5`，
 *   其登记当时又写在**请求标志**上（`if (mutOf('A1-5')) mutApplied.add(...)`）⇒ 恒真。
 *   两处叠加的结果：这条腿永远绿，且**不可能**红 —— 正是本仓最忌的"失败不可观测"。
 *
 * ⚠ **本轮（A1-5 清账）改了它的用途、但没让它变成只写不读**：A1-5 转 PASS 后，它的两个变异器
 *   都是**实现变异**（打真核），`selfKernel` 分支因而无变异器使用。若维持旧调用形态，
 *   本集合会退化成**只写不读**（登记了却没人查）—— 那与死功能同型，只是更隐蔽。
 *   ⇒ 故给实现变异加了 `numberWitness` 声明：声明它的变异器**两重证据都要**
 *     （克隆体加载 ✅ **且** 读数确实变了 ✅）。缺第二重时，"克隆体加载了但判据其实没读真核"
 *     （例如本项又退回内联闭式）会被读成注入成功 —— 而那时本项绿得毫无意义。
 */
const selfApplied = new Set()
/** 按「被判项」反查它的变异器（同一项可有多个变异器，一次只准注入一个）。 */
const mutOf = (checkId) => [...MUTATES].find((m) => MUTATORS[m]?.target === checkId) ?? null

/** 本次运行创建过的临时克隆目录（收尾逐个删；不用通配，避免误删同名目录）。 */
const createdDirs = []

/**
 * 克隆一份被测源文件到临时目录（可选注入变异），返回可 import 的模块。
 *
 * ⚠ `srcDir` 缺省 = `SRC`（vector）⇒ 既有变异器（a1-4 / a1-4-num / a1-11 / a1-11-rankby / a1-12）
 *   的路径与改写口径**逐字不变**；它存在的理由是 A1-5：真核在 `packages/long-term/src/`，
 *   不在 `SRC` 下 —— 而「判据腿必须能对**真核**做实现变异」正是本项由 HANG 转 PASS 的条件之一。
 *
 * ── ⚠ **为什么克隆的是「一个文件集」而不是一个文件**（本轮实修，踩过一次）──────────────
 *   `decay.ts` 顶部写着 `import { HALF_LIFE_DAYS } from './params.ts'` —— 半衰期常量住在
 *   **params.ts**，不在 decay.ts 里。第一版把 `a1-5-halflife` 的锚点写在 `m.file`（= decay.ts）
 *   上，结果在**错的文件**里找锚点 ⇒ 命中 0 次 ⇒ 抛「锚点已过期」。
 *   而那次运行**没有静默通过**：它走到了变异自证腿并报「变异**未真正注入**」⇒ 退出码 3
 *   （这正是自证腿存在的意义）。但「碰巧报红」不能当判据 —— **锚点归属必须与常量归属一致**。
 *   ⇒ 本地图：`{ 文件名 → 该文件上的替换 }`，**每个文件各自校验「锚点恰好命中一次」**，
 *     整个文件集写进**同一个临时目录**，于是克隆体内的 `./params.ts` 按相对路径解析到
 *     **同目录的克隆副本**（带上变异），而不是回落到真源 —— 否则红态会**假绿**。
 */
async function loadCloned(file, mutId, srcDir = SRC) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-a1-'))
  createdDirs.push(dir)
  /**
   * 文件 → 替换清单。**entry（观测点）恒进克隆集**；变异目标可能是**另一个**文件
   * （`a1-5-halflife`：entry=`decay.ts`、目标=`params.ts`）—— 两者都要进，
   * 因为克隆体要能 import 到**带变异的**依赖，否则变异对观测点不可见（红态假绿）。
   * `also` 是给「变异目标不在 entry 的依赖链上、但仍需一起进集」的显式声明。
   */
  const editsByFile = new Map([[file, []]])
  if (mutId) {
    const m = MUTATORS[mutId]
    if (!m) throw new Error(`未知变异器 ${mutId}`)
    editsByFile.set(m.file, m.edits ?? [])
    for (const extra of m.also ?? []) if (!editsByFile.has(extra.file)) editsByFile.set(extra.file, [])
  }
  for (const [name, edits] of editsByFile) {
    let txt = readFileSync(join(srcDir, name), 'utf8')
    for (const [find, rep] of edits) {
      const hits = txt.split(find).length - 1
      if (hits !== 1) throw new Error(`变异锚点已过期：在 ${name} 命中 ${hits} 次（须恰好 1 次，否则注入的不是预注册的那个缺陷）：${JSON.stringify(find.slice(0, 60))}`)
      txt = txt.replace(find, rep)
    }
    writeFileSync(join(dir, name), txt)
  }
  /**
   * 相对 import 改写：**只改写不在本文件集里的目标**。
   * 集内成员保持相对（`./params.ts`）⇒ 解析到同目录克隆副本（这正是变异随行传递的机制）；
   * 集外目标才改成绝对 file: URL（否则克隆体不在原目录、相对路径会失配）。
   */
  const inSet = new Set(editsByFile.keys())
  for (const name of inSet) {
    const p = join(dir, name)
    const txt = readFileSync(p, 'utf8').replace(/from '\.\/([\w.-]+\.ts)'/g, (all, f) =>
      inSet.has(f) ? all : `from '${url(join(srcDir, f))}'`,
    )
    writeFileSync(p, txt)
  }
  if (mutId) mutApplied.add(mutId)
  return { mod: await import(url(join(dir, file))), dir }
}

/** 取一条被测模块：无变异时走真源本体，有变异时走克隆体。 */
async function vecModule(file, mutId) {
  if (!mutId) return await import(url(join(SRC, file)))
  const { mod } = await loadCloned(file, mutId)
  return mod
}

/**
 * 取**任意包**的 src 模块（A1-5 的真核在 `packages/long-term/src/`，不属 `SRC`）。
 * ⚠ 与 `vecModule` **同一条**克隆路径（复用 `loadCloned`，只换 srcDir）：
 *   两处各写一份"读源→替换锚点→写临时副本→import"必然漂移 —— 那正是下一个漂移点。
 * ⚠ 锚点命中数仍由 `loadCloned` 强制**恰好 1 次**（未命中即抛 ⇒ 不会把"没注入"读成"注入了"）。
 */
async function pkgModule(pkg, file, mutId) {
  const dir = P('packages', pkg, 'src')
  if (!mutId) return await import(url(join(dir, file)))
  const { mod } = await loadCloned(file, mutId, dir)
  return mod
}


// ══ 产物**内容腿**（F-04a：把 ARTIFACTS 从「比 mtime」升级为「比内容」）══════════
/**
 * ⚠ 为什么必须有这一腿（**两个独立席位的隔离对照**实证，不是推测）：
 *   ARTIFACTS 原腿只比 lib/index.js 与 src 最新文件的 **mtime**。mtime 是**代理指标**，
 *   cp（不带 -p）/ touch 都能任意摆布它 ⇒ 结构上同时存在两种假象：
 *     · **假绿**：旧产物 cp 回来（mtime = NOW，比 src 新）⇒ 原腿报「新鲜」，
 *       而现实里所有「按包名解析到 lib/」的判据都在测**旧实现**；
 *     · **假红**：内容同步但 mtime 被改成很旧 ⇒ 原腿报「过期」。
 *   隔离对照（S9 席，/tmp 整仓副本，唯一变量 = lib 内容）：换回旧 lib ⇒
 *     A1-2 / A1-13 / A1-14 **三项 FAIL**；换回新 lib ⇒ 全 PASS。
 *   ⇒ 判据必须落在**内容**上：把**当前 src 重新编译一遍**，与 lib 产物**逐字节**比对。
 *     这是「lib 是不是由当前 src 产出的」的直接证据，**不需要任何缓存/基线文件**——
 *     落一个指纹文件反而引入「该文件自己会过期」的新一代代理指标（本仓已吃过这个亏）。
 *
 * ⚠ 为什么能被判定、且**不会**被 tsc 的无关波动误伤：
 *   比较对象恒为「**同一份 src 现编出来的产物**」，不是「某个历史指纹」⇒
 *   注释/空白/时间戳的改动只会在 src 与产物**真的**不同步时才让两者不等；
 *   tsc 的 emit 是确定性的（本机实测：12 个 tsc 包、42 个 .js 逐个 sha256 相同 ⇒
 *   与仓内 lib 逐字节相等，见 handoff 的负向对拍记录）。故「不等」只有一个含义：
 *   **产物不是当前 src 编出来的**（过期，或构建口径不同）。
 *   ⚠ 不用「按包名 import 后比导出符号」当主判据：导出面对**方法级**改动无感 ——
 *     本仓的实证恰是 writeInjectLog（packages/core/src/index.ts:271，**服务方法**，
 *     ManaCoreService 的成员）与 gate 分支，它们不改变任何模块导出名。
 *     那一路只作辅助信息（导出面差分），主判据是字节比对。
 *
 * ⚠ 只读：重编译写进 mkdtemp 临时目录（--outDir 覆盖），**绝不**写仓内 lib。
 */
const TS_BIN = P('node_modules/typescript/bin/tsc')
const HAS_TS = existsSync(TS_BIN)
/**
 * 由**真 builder 脚本**产出、而非 tsc 的产物（ui 的单产物契约 A5-5）。
 * ⚠ 重放必须跑**真脚本本体**（拷进临时目录跑，import.meta.url 相对路径自洽），
 *   不得在判据器里二次实现那个文本变换 —— 那会造出**两个真源**，改一处漏一处即漂移。
 */
const BUILT_BY_SCRIPT = {
  ui: { out: 'lib/client.js', script: 'scripts/build-client.mjs', inputs: ['src/client/index.ts', 'src/client/host.ts'] },
}
/** 递归收集 dir 下指定扩展名的文件，返回**相对 base 的路径**。 */
function walkFiles(dir, exts, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'types') continue
      walkFiles(full, exts, base, out)
    } else if (exts.some((x) => e.name.endsWith(x))) out.push(relative(base, full))
  }
  return out
}

/** 每个包的产物判定缓存（同一轮内只算一次：ARTIFACTS 与 W2-5 都取它）。 */
const artifactVerdicts = new Map()
/**
 * 重放「由脚本产出」的那件产物，返回逐字节比对结论。
 * 跑真脚本（拷到临时目录，相对布局照抄）⇒ 产物出自当前脚本源码，判据不另写一份变换。
 */
function replayScriptArtifact(pkg, dir) {
  const spec = BUILT_BY_SCRIPT[pkg]
  const tmp = mkdtempSync(join(tmpdir(), 'mana-artb-'))
  createdDirs.push(tmp)
  try {
    const scriptBase = spec.script.split('/').pop()
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    copyFileSync(join(dir, spec.script), join(tmp, 'scripts', scriptBase))
    for (const inp of spec.inputs) {
      mkdirSync(dirname(join(tmp, inp)), { recursive: true })
      copyFileSync(join(dir, inp), join(tmp, inp))
    }
    const r = node([join(tmp, 'scripts', scriptBase)], { cwd: tmp })
    const fresh = join(tmp, spec.out)
    const actual = join(dir, spec.out)
    if (!existsSync(fresh)) return { ok: false, why: '重放未产出 ' + spec.out + '（exit=' + r.code + '）：' + (r.err || r.out).slice(0, 160) }
    if (!existsSync(actual)) return { ok: false, why: 'lib 缺 ' + spec.out }
    return readFileSync(fresh).equals(readFileSync(actual))
      ? { ok: true, why: spec.out + ' 复放逐字节一致（' + statSync(actual).size + ' B）' }
      : { ok: false, why: spec.out + ' 与真 builder 复放结果**不一致**（产物非当前脚本所出）' }
  } catch (error) {
    return { ok: false, why: '重放失败：' + error.message }
  }
}

/**
 * 判定一个包的产物是否**真由当前 src 产出**（内容级）。返回：
 *   { state: 'PASS' | 'FAIL' | 'unknown', identical, differing[], missingInLib[], extraInLib[], unknown, ms, note }
 * unknown 是**一等状态**：判不了就如实报「未判定」，**不得读成一致**
 *（本仓纪律：挂账/无实现者都不是 PASS，同源）。
 */
function artifactVerdict(pkg) {
  const cached = artifactVerdicts.get(pkg)
  if (cached) return cached
  const dir = P('packages', pkg)
  const libDir = join(dir, 'lib')
  const tsconfig = join(dir, 'tsconfig.json')
  const v = { pkg, state: 'PASS', identical: 0, differing: [], missingInLib: [], extraInLib: [], unknown: '', ms: 0, note: '', files: 0 }
  artifactVerdicts.set(pkg, v) // 先登记：异常路径也不会被重复计算
  const t0 = Date.now()
  if (!HAS_TS) {
    v.state = 'unknown'
    v.unknown = '仓内无 node_modules/typescript/bin/tsc ⇒ 内容腿**未判定**（不得读成一致）'
    return v
  }
  if (!existsSync(tsconfig)) {
    v.state = 'unknown'
    v.unknown = '无 ' + relative(ROOT, tsconfig) + ' ⇒ 无「重新编译」的可执行口径'
    return v
  }
  const outRoot = mkdtempSync(join(tmpdir(), 'mana-art-'))
  createdDirs.push(outRoot)
  // ⚠ --outDir/--declarationDir 只覆盖**本次临时重编译**的输出位置；tsconfig 本体不动，
  //   故「编译口径」与构建时逐字相同（这正是能逐字节比对的前提）。
  const r = node([TS_BIN, '-p', tsconfig, '--outDir', outRoot, '--declarationDir', join(outRoot, 'types')])
  const emitted = walkFiles(outRoot, ['.js'], outRoot)
  v.ms = Date.now() - t0
  if (!emitted.length) {
    v.state = 'unknown'
    v.unknown = 'tsc 未产出任何 .js（exit=' + r.code + '）：' + String((r.err || r.out) || '').trim().split('\n').slice(0, 2).join(' / ').slice(0, 200)
    return v
  }
  for (const rel of emitted) {
    const libFile = join(libDir, rel)
    if (!existsSync(libFile)) {
      v.missingInLib.push(rel)
      continue
    }
    if (readFileSync(libFile).equals(readFileSync(join(outRoot, rel)))) v.identical += 1
    else v.differing.push(rel)
  }
  // 反向：lib 里存在、而当前 src 已编不出来的 .js（src 删了/改名了，产物没清）
  const scriptOuts = new Set(BUILT_BY_SCRIPT[pkg] ? [BUILT_BY_SCRIPT[pkg].out] : [])
  const emittedSet = new Set(emitted)
  for (const rel of walkFiles(libDir, ['.js'], libDir)) {
    if (scriptOuts.has(join('lib', rel)) || emittedSet.has(rel)) continue
    v.extraInLib.push(rel)
  }
  // 由脚本产出的那件（ui client）：跑真脚本重放后逐字节比
  if (BUILT_BY_SCRIPT[pkg]) {
    const rep = replayScriptArtifact(pkg, dir)
    if (rep.ok) v.identical += 1
    else {
      v.differing.push(BUILT_BY_SCRIPT[pkg].out)
      v.note = rep.why
    }
  }
  if (v.differing.length || v.missingInLib.length || v.extraInLib.length) v.state = 'FAIL'
  v.files = v.identical + v.differing.length + v.missingInLib.length
  return v
}

/** 内容腿的人类可读摘要（ARTIFACTS 与 W2-5 共用同一实现，避免两处口径漂移）。 */
function contentBad(v) {
  if (v.state === 'unknown') return '未判定（' + v.unknown + '）'
  return [
    v.differing.length ? '与重编译产物不一致：' + v.differing.join(', ') : '',
    v.missingInLib.length ? 'lib 缺产物：' + v.missingInLib.join(', ') : '',
    v.extraInLib.length ? 'lib 多出当前 src 编不出的产物：' + v.extraInLib.join(', ') : '',
    v.note,
  ]
    .filter(Boolean)
    .join('；')
}

/**
 * 取数坐标（并发纪律 §3 的机器落点；F-06）——**每条 detail 都要带**。
 *
 * ⚠ 为什么：会议期间 **HEAD 移动 3 次**、本脚本项数 15→16，而该变化**不是机器报警发现的，
 *   是人工比对发现的**。同一工作树 30 分钟内 A0 全量可翻转 ⇒ 没有 commit + checker 指纹的
 *   读数**无法复现也无法归因**。四元组 = commit / checker-md5 / 关键环境变量 / 时刻。
 */
const COORD = (() => {
  const md5 = (p) => {
    try { return createHash('md5').update(readFileSync(p)).digest('hex') } catch { return '?' }
  }
  const envKeys = ['NODE_USE_ENV_PROXY', 'no_proxy', 'NO_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY']
  return {
    commit: (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '?' } })(),
    /** checker 自身 md5（含它依赖的锁模块）—— 判据器改了而报告不变，是同一类不可归因。 */
    checkers: Object.fromEntries(
      ['tools/a1-check.mjs', 'tools/a0-check.mjs', 'tools/checker-lock.mjs'].map((f) => [f, md5(P(f))]),
    ),
    node: process.version,
    env: Object.fromEntries(envKeys.map((k) => [k, process.env[k] === undefined ? null : process.env[k]])),
    at: new Date().toISOString(),
  }
})()
/** 给任何 detail 追加取数坐标（统一一处实现，避免各处格式漂移）。 */
const withCoord = (detail) =>
  `${detail}｜取数坐标 commit=${COORD.commit} checker-md5=${COORD.checkers['tools/a1-check.mjs']?.slice(0, 12)} ` +
  `node=${COORD.node} NODE_USE_ENV_PROXY=${COORD.env.NODE_USE_ENV_PROXY ?? '(未设)'} at=${COORD.at}`

/**
 * ── 册行号**现读锚**（K1 件 2）────────────────────────────────────────────────
 * ⚠ 为什么行号不能再写死（本席 2026-09-26 实测）：`docs/mana-rollout-plan.md` 是**活文档**
 *   （本批就有他席在途改动：工作树 vs HEAD 已差 1 行）⇒ 写死的 `:454` 一旦册动一行，
 *   12 处引用**全部指偏**，而且指偏之后**没有任何机检会报**（引用是注释/依据字段，不参与判定）。
 *   行号是**代理**，不是判据本体 —— 与 ARTIFACTS 的 mtime 腿同型：可读、但无牙。
 * ⇒ 每次运行从册上**现读**该 id 所在行，读数带坐标（`L<n>（<commit> 现读）`）；
 *   读不到即如实写「**未判定**」，并由 `册行号腿` 抬成 FAIL（引用锚点不成立 ⇒ 报告不可复核）。
 * ⚠ 本腿**不是新判据项**（不进 `results`）：它判的是「引用锚点是否成立」，与 C16-GUARD /
 *   项集等式同族的**元检查**，因此只进 `gateOk`、不进 EXPECTED_IDS。
 */
const PLAN_COORD = { commit: COORD.commit }
/** 12 处引用对应的册行（判据 id）；批次行只用批次号。 */
const PLAN_REF_IDS = ['A1-1', 'A1-2', 'A1-3', 'A1-4', 'A1-5', 'A1-6', 'A1-7', 'A1-8', 'A1-9', 'A1-10', 'A1-11', 'A1-12', 'A1-13', 'A1-14']
const PLAN_REF_PROBLEMS = new Set()
function planLineNote(...ids) {
  const got = ids.map((id) => {
    const a = critAnchor(id)
    if (!a) {
      PLAN_REF_PROBLEMS.add(`${id}：本册**现读不到**该判据行（表被改名/移动 ⇒ 该处引用不可复核）`)
      return null
    }
    return a.line
  })
  const coord = `（${PLAN_COORD.commit} 现读）`
  if (got.every((x) => x !== null)) {
    if (got.length === 2 && got[1] === got[0] + 1) return `判据表 L${got[0]}–${got[1]}${coord}`
    return `判据表 ${ids.map((x, i) => `${x}@L${got[i]}`).join(' + ')}${coord}`
  }
  return `判据表 ${ids.map((x, i) => `${x}@${got[i] === null ? '**未判定**' : 'L' + got[i]}`).join(' + ')}${coord}`
}
/**
 * 全部引用锚点**预检**（与各 pass 分支的展示调用同源 —— 只此一处实现）。
 * ⚠ 必须**独立于 pass/fail 分支**：若只在 pass 时调用，判据一红就没人读锚点 ⇒
 *   锚点漂移会在最需要它的那次运行里**不可见**（本仓「让失败不可观测」的同型）。
 */
for (const _id of PLAN_REF_IDS) critAnchor(_id) || PLAN_REF_PROBLEMS.add(`${_id}：本册**现读不到**该判据行（表被改名/移动 ⇒ 该处引用不可复核）`)
const planRefsOk = PLAN_REF_PROBLEMS.size === 0
const planRefsDetail =
  // ⚠ 计数必须与判定**同源**：本席反证对拍实测踩到 —— 旧文案恒说「N 处全部命中」，
  //   而 1 处未判定时它照样印「全部命中」⇒ 报告自相矛盾（读者只读前半句就会以为锚点没问题）。
  `册行号腿：引用锚点现读命中 ${PLAN_REF_IDS.length - PLAN_REF_PROBLEMS.size}/${PLAN_REF_IDS.length} 处（${PLAN_COORD.commit}）` +
  (planRefsOk ? ' ⇒ 全部命中' : `｜**${PLAN_REF_PROBLEMS.size} 处未判定**：${[...PLAN_REF_PROBLEMS].join('；')}`)

/**
 * ⚠ **stdout 必须只承载结论**（F-06 的硬要求，实测踩到）：
 *   Node 22 的 undici 会在进程启动/退出时往 **stderr** 打 `[UNDICI-EHPA] Warning: ...`；
 *   本脚本会 spawn 子进程 ⇒ 那些告警会出现在子进程 stderr 里。处置：
 *   **stdout 只留 JSON**，人读输出一律走 `if (!JSON_OUT)` 分支，子进程 stderr 不转发到 stdout。
 */
const EPS = 1e-6
const near = (got, want, eps = EPS) => Math.abs(got - want) <= eps
const fixed = (x, n = 6) => Number(x).toFixed(n)

// ══ A1-4 RRF 确定性（A 档）══════════════════════════════════════════════════
{
  const id = 'A1-4'
  const title = 'RRF 确定性（k=60 三锚点，绝对差 ≤1e-6）'
  try {
    const { rrfTerm, rrfFuse, rrfFuseRanked, RRF_DEFAULT_K } = await vecModule('rrf.ts', mutOf('A1-4'))
    const cases = [
      ['[1,1]', rrfTerm(1, 60) + rrfTerm(1, 60), 0.032787],
      ['[1,50]', rrfTerm(1, 60) + rrfTerm(50, 60), 0.025484],
      ['[50,50]', rrfTerm(50, 60) + rrfTerm(50, 60), 0.018182],
    ]
    const bad = []
    for (const [name, got, want] of cases) if (!near(got, want)) bad.push(`${name}=${got}（应 ${want}）`)
    // 默认常数腿：判据表写 k=60 ⇒ 只测显式传参是不够的（"判据绿、实现另一套"的入口）。
    if (RRF_DEFAULT_K !== 60) bad.push(`RRF_DEFAULT_K=${RRF_DEFAULT_K}（应 60）`)
    // 融合路径必须吃到同一个 k：用**默认值**（不显式传）走一次。
    const fused = rrfFuseRanked({ x: 1, y: 1 }, { x: 1, y: 1 })
    for (const it of fused) if (!near(it.score, 0.032787)) bad.push(`融合分(${it.key})=${it.score}`)
    // 确定性与并列裁决（与 b11-vector.test.mjs ② 同口径）
    const a = JSON.stringify(rrfFuseRanked({ p: 1, q: 2 }, { q: 1, p: 2 }, 60))
    const b = JSON.stringify(rrfFuseRanked({ p: 1, q: 2 }, { q: 1, p: 2 }, 60))
    if (a !== b) bad.push('同一输入两次结果不同（判据会一会儿过一会儿不过）')
    const tie = rrfFuseRanked({ a: 1, b: 1 }, { a: 1, b: 1 }, 60)
    if (tie.map((x) => x.key).join(',') !== 'a,b') bad.push(`完全并列未按 key 升序：${tie.map((x) => x.key)}`)
    // 重复键：先去重、再对去重序列重排（`['k','k','j']` ⇒ j 的名次是 2，不是 3）
    const dup = rrfFuse([{ name: 'L', keys: ['k', 'k', 'j'] }], 60)
    const j = dup.find((x) => x.key === 'j')
    if (j?.rank['L'] !== 2) bad.push(`去重未重排：j.rank=${j?.rank['L']}（应 2）`)

    const detail =
      cases.map(([n, g, w]) => `${n}=${fixed(g)}（差 ${Math.abs(g - w).toExponential(2)}）`).join(' · ') +
      ` · 默认 k=${RRF_DEFAULT_K} · 融合路径同 k=${fused.length}/2 项命中`
    if (bad.length) fail(id, title, `不符：${bad.join('；')}`, '回向量融合步骤（packages/vector/src/rrf.ts）')
    else pass(id, title, detail, `${planLineNote('A1-4')}；与 packages/vector/tests/b11-vector.test.mjs ① ② 同口径`)
  } catch (error) {
    fail(id, title, `加载/执行失败：${error.message}`, '先修源文件可解析性')
  }
}

// ══ A1-5 时间衰减确定性（A 档）══════════════════════════════════════════════
{
  const id = 'A1-5'
  const title = '时间衰减确定性（h=14 三锚点，绝对差 ≤1e-6）'
  /**
   * ── 本项由 HANG 转 PASS 的**判据依据**（不是「等级改了」就算数）────────────────────
   * 原状（真缺陷，原文记在提交 3028bfa）：本块**从头到尾没有 import 过 `packages/long-term`**
   *   —— 它算的是块内自己内联的闭式 `exp(-t·ln2/14)`。两条后果都是「让失败不可观测」：
   *     ① 真核算错锚点，本项照样绿；② 三条分支里没有一条能把「真核算对了」判成 PASS
   *     ⇒ 挂账成了终态，本项**永远绿不了**。
   * 3028bfa 把「读数面」（`decayAnchorReadings`）与「齿」（`decayKernelTeeth`）做进了
   *   `packages/forgetting/src/retention.ts`，但**没有接上来**；该提交明文写着
   *   「⚠ 本块本轮**不动四态等级**（HANG→PASS 的定级属判据登记席，**另派**）」。
   *   **本轮就是那一席**：① 把读数面接到真核；② 补「判据腿能对**真核**做实现变异」这条
   *   （`MUTATORS` 的 `a1-5-halflife` / `a1-5-num`）；③ 等级随之由 HANG 转 PASS。
   *
   * ⚠ **改前反证（本轮实跑留档）**：把真核的 `HALF_LIFE_DAYS` 由 14 改成 7 后，
   *   旧块仍打印 `decay(14)=0.500000`、仍记 HANG、退出码仍 0 ⇒ 它对**真源完全失明**。
   *   同一次扰动现在必红（`--mutate a1-5-halflife` 的两态输出即该证明）。
   *
   * ── 判据腿**不得再弱于实现面**（本项历史上的原话，3028bfa）────────────────────────
   *   上文那三条锚点**不构成对核的充分检查**：它们全部取在 `t ≥ 0` 且用**同一个** `h` ⇒ 两种坏核
   *   能把三条**全过**：① **忽略 `halfLifeDays` 的死旋钮核**（与 budgetChars 同一形态）；
   *   ② **无 `t<0` guard 的核**。这两条当时只由包内测试兜 ⇒ 判据腿比实现面**更弱**。
   *   ⇒ 本块补两条牙，且**齿只有一份真源**：调 `packages/forgetting/src/retention.ts` 的 `decayKernelTeeth()`，
   *     判据腿与包内测试用**同一个**函数（避免两处各写一份齿 —— 那正是下一个漂移点）。
   *
   * ⚠ **本块只允许读，不许改源文件**（写面纪律）：真核一律经 `pkgModule()` 取；
   *   `--mutate` 时走 `loadCloned()` 的**内存克隆副本**（相对 import 改写为绝对 file: URL），
   *   仓内 `packages/**` 零写入 —— 取证：变异跑前/跑后 `git status --porcelain packages` 逐字相同。
   */
  /**
   * 判据表 A1-5 的冻结半衰期（**逐字**，不从这里反算）。
   * ⚠ 它**不是**真核的缺省值来源 —— 缺省值唯一出处是 `packages/long-term/src/params.ts` 的
   *   `HALF_LIFE_DAYS`。本常量只用来（a）标称"判据表说的 h 是多少"，（b）给带牙腿当探针基准。
   *   「真核的缺省 h 恰为 14」这条**必须由读数证明**（见下面三锚点的**单参**调用），
   *   不许由本常量代替 —— 那正是旧块"对闭式核自证"的形态。
   */
  const FROZEN_H = 14
  /**
   * 真核与齿的**包路径**（相对 ROOT，经 `pkgModule` 取）。
   * ⚠ 本仓工作树/会话可位于多份物理副本下（本任务即以 git worktree 隔离运行）；
   *   写死绝对路径会让判据去读**另一份工作树**的文件 —— 那是"判据读的不是被测物"，
   *   且这种失配在报告里**不可见**（读的还是同一份内容）。包路径 + `ROOT` 是唯一正确口径。
   */
  const KERNEL = { pkg: 'long-term', file: 'decay.ts' }
  const TEETH = { pkg: 'forgetting', file: 'retention.ts' }
  /**
   * ── 取真核与齿（**同一实例**：齿必须判的就是本项要判的那个核）─────────────────────
   * `--mutate a1-5-halflife` / `a1-5-num` 经 `pkgModule` 走**内存克隆**，其余走真源本体。
   * 两种加载都是 await import ⇒ 不可能"上游 await 写错、下游却报绿"（本仓踩过的形态）。
   * ⚠ **失败态必须显式**（`kernelOk:false` ⇒ FAIL）：把"核没接上"读成 PASS 正是旧块的病。
   */
  let kernel = null
  let kernelErr = ''
  try {
    // entry 恒为观测点（KERNEL.file）；变异目标（可能是 params.ts）在 loadCloned 内解析，
    // 两者一起进同一克隆目录 ⇒ 克隆体的 './params.ts' 解析到带变异的副本。
    kernel = await pkgModule(KERNEL.pkg, KERNEL.file, mutOf('A1-5'))
  } catch (error) {
    kernelErr = String((error && error.message) || error).slice(0, 200)
  }
  let teethText = ''
  let teethOk = null
  try {
    if (!kernel || typeof kernel.decay !== 'function') throw new Error(`真核未接上：${kernelErr || '无 decay 导出'}`)
    const mod = await pkgModule(TEETH.pkg, TEETH.file, null)
    if (typeof mod.decayKernelTeeth !== 'function') {
      teethText = '带牙腿真源缺 decayKernelTeeth 导出（判据面被削）'
      teethOk = false
    } else {
      const r = mod.decayKernelTeeth(kernel, { frozenHalfLife: FROZEN_H, probeHalfLife: FROZEN_H / 2 })
      teethOk = r.ok === true
      teethText = r.teeth.map((x) => (x.ok ? '✓' : '✗') + x.id).join(' · ')
      if (!teethOk) teethText += '｜违规：' + r.violations.join('；')
    }
  } catch (error) {
    teethText = '带牙腿**未判定**（' + String((error && error.message) || error).slice(0, 140) + '）'
    teethOk = null
  }
  /**
   * ── 三锚点：读数**由真核算出**（单参调用 ⇒ 走真核自己的缺省半衰期路径）───────────────
   * ⚠ 期望值是**判据表逐字复本**（`A1_5_ANCHOR_POINTS` 侧另有独立对照），
   *   **不从实现反算** —— 反算会让"改常量时期望值跟着走"，判据必然恒绿。
   * ⚠ 逐点 `kernel.decay(t)` **不传 h**：传了就等于用判据的猜测替掉
   *   「缺省值真来自 `params.ts`」这条腿。
   */
  const GOT = []
  if (kernel && typeof kernel.decay === 'function') {
    for (const [label, t, want] of [['decay(0)', 0, 1.0], ['decay(14)', 14, 0.5], ['decay(90)', 90, 0.011609]]) {
      let got = NaN
      let threw = null
      try { got = kernel.decay(t) } catch (error) { threw = String((error && error.message) || error).slice(0, 120) }
      GOT.push({ label, t, got, want, threw, ok: threw === null && Number.isFinite(got) && near(got, want) })
    }
  }
  /**
   * ── **死旋钮探针**（N3 合并轮并入；来历：另一条独立实现线实测复现）────────────────────
   *
   * ⚠ 三锚点**全部单参调用**（`decay(t)`，不传 h）⇒ 它们用的是**同一个**缺省 h。
   *   于是「**忽略 halfLifeDays 参数的核**」（`decay:(t,_h)=>exp(-t·ln2/14)`）能把三条
   *   **全过** —— 这是 c3 席点名的形态①，与 `budgetChars` 同一类"死旋钮"。
   *   ⚠ 上面那条 `paramsOk` 腿**抓不到它**：它判的是「缺省值来自 params」，而死旋钮核的
   *   缺省值**确实**来自 params（它只是忽略显式传入的参数）。
   *   ⚠ 带牙腿的 `consumes-half-life` 判的是**自洽式** `f(t,h₂)=f(t,h₁)^(h₁/h₂)`，
   *   死旋钮核在 h₂=h₁ 时自洽式平凡成立 ⇒ **也抓不到**（这就是为什么必须单列本条）。
   *   ⇒ 本条判的是**关系**而非某个具体数：同 t=14、h 减半 ⇒ 留存率必须**变小**（半衰期短 ⇒ 衰减快）。
   *     它不写死期望值（写死会让判据表与实现各说各话）。
   */
  const knobProbe = (() => {
    if (!kernel || typeof kernel.decay !== 'function') return null
    try {
      const at14 = kernel.decay(14, FROZEN_H)
      const atHalf = kernel.decay(14, FROZEN_H / 2)
      return { at14, atHalf, consumed: atHalf < at14 - 1e-9 }
    } catch (error) {
      return { error: String((error && error.message) || error).slice(0, 120) }
    }
  })()
  const bad = GOT.filter((g) => !g.ok).map((g) => `${g.label}=${g.threw ? '抛错(' + g.threw + ')' : g.got}（应 ${g.want}）`)
  /**
   * 自证变异的**注入证据**：读的是**算出来的数**变成 0.25（h=7 ⇒ 14 天恰两个半衰期），
   * 不是"请求了变异"这个标志（后者恒真 —— 本脚本已修过一次这种死分支，见 `selfApplied` 的注释）。
   * 反例（本腿要抓的缺陷）：孤立化（逐点传参、不碰真核缺省）一旦丢失 ⇒ 真实现变异不再改数 ⇒
   *   本登记不发生 ⇒ 变异自证腿报「变异未真正注入」。**两条变异器各自登记**：
   *   只登记 a1-5-halflife 会让 a1-5-num 经由 mutOf 回退路径**冒充**注入成功。
   */
  /**
   * ⚠ **注入证据有两条通道，缺一即误报「未注入」**（N3 合并轮实测踩到）：
   *   · **锚点通道**（既有）：三锚点读数被改动 ⇒ `GOT[1].got ≠ 0.5`。
   *     适用于 `a1-5-halflife`（改常量）与 `a1-5-num`（改算式）—— 它们都让锚点变值。
   *   · **参数消费通道**（本轮新增）：`a1-5-knob`（死旋钮核）**故意不改锚点**
   *     （它的全部意义就是"三锚点照样全过"）⇒ 只认锚点通道会把**真注入**误判成"未注入"，
   *     进而让变异自证腿报红 —— 而那次运行里**判据其实已经正确咬住了**（A1-5 FAIL）。
   *     ⇒ 该通道的注入证据 = `knobProbe.consumed === false`（参数真被忽略）。
   *   ⚠ 两通道**都必须读"算出来的事实"**，不许读"请求了变异"这个标志（那是恒真死分支，
   *     本脚本已修过一次，见 `selfApplied` 的注释）。
   */
  for (const m of MUTATES) {
    if (MUTATORS[m]?.target !== 'A1-5') continue
    const anchorChanged = GOT.length > 0 && !near(GOT[1].got, 0.5)
    const knobBroken = knobProbe !== null && !('error' in knobProbe) && knobProbe.consumed === false
    if (anchorChanged || knobBroken) selfApplied.add(m)
  }
  // 实时扫描实现者：导出名像衰减核的函数/常量
  const impls = []
  for (const pkg of readdirSync(P('packages'))) {
    const dir = P('packages', pkg, 'src')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue
      const txt = readFileSync(join(dir, f), 'utf8')
      if (/export (?:function|const)\s+(?:decay|timeDecay|decayOf|retentionOf|halfLifeDecay)\b/.test(txt)) impls.push(`packages/${pkg}/src/${f}`)
    }
  }
  const detail = GOT.length
    ? GOT.map((g) => `${g.label}=${g.threw ? '**抛错**' : fixed(g.got)}（差 ${g.threw ? '—' : Math.abs(g.got - g.want).toExponential(2)}）`).join(' · ')
    : '**真核不可加载**：' + (kernelErr || '未知原因')
  /**
   * 牙读数的**唯一渲染口**（三处分支共用一份，避免「有的分支带、有的不带」的漂移）。
   * ⚠ 未判定（`null`）**不算过**：文案里显式写「未判定」——
   *   本仓四态语义要求「判不了」与「过了」必须能分开读。
   */
  const teethNote =
    '带牙腿：' + (teethOk === true ? '两条牙全过' : teethOk === false ? '**有牙咬住**' : '**未判定**') + ' —— ' + teethText
  /**
   * ── 四态落点（**四条腿全过才 PASS**，任一不过即 FAIL）────────────────────────────
   *   · 真核可加载（`kernelOk`）—— 否则"核没接上"会被读成 PASS（旧块的病）
   *   · 三锚点由**真核**读出且与判据表逐点相符（`bad`）
   *   · 带牙腿两条牙全过（`teethOk === true`；`null` = **未判定 ≠ 过**）
   *   · 真核的**缺省半衰期**恰为判据表的 14（`paramsOk`）—— 锚点全部单参调用，
   *     这条与它们**不是同一件事**：若 `params.ts` 的 14 被改成别的数，三条锚点会先红；
   *     但若有人给 `decay` 换成自带缺省 14 的第二份实现（`params` 不再是唯一出处），
   *     锚点仍会绿 ⇒ 必须另有一条腿钉住"缺省值来自 params"。
   */
  /**
   * ── 覆盖率**边界披露**（「判据腿不得比实现面更弱」的**可读化**落点）─────────────────
   * ⚠ 本轮（N3 清账）对两条牙做了**逐守卫摘除实证**，结论必须随 PASS 一起印出来，
   *   否则「PASS」会被读成「衰减核任意损坏都会被咬住」。
   *   实测（每条守卫单独摘掉、其余不动，跑 node tools/a1-check.mjs）：
   *     · 摘 t<0 守卫                      ⇒ 牙②咬住 ⇒ **A1-5 FAIL**（有牙）
   *     · 摘 halfLifeDays 正性/非有限守卫   ⇒ 牙①的自洽式咬住 ⇒ **A1-5 FAIL**（有牙）
   *     · 摘 Number.isFinite(t) 守卫        ⇒ **A1-5 仍 PASS**（本判据腿**不覆盖**该面）
   *   ⇒ 不覆盖 ≠ 没关系：它意味着「该面坏了本项也不响」，故**显式印在 detail 里**，
   *     不让读者从 PASS 反推出「三条守卫都已被覆盖」—— 那正是本仓最忌的「失败不可观测」。
   *
   * ── 具名挂账（本仓「挂账≠通过」纪律；不许静默保留）───────────────────────────
   *   · **名**：`A1-5-TEETH-GAP-1`（衰减核输入契约的第三条守卫无判据）
   *   · **首现**：2026-09-26（N3 清账席，逐守卫摘除实证；`Number.isFinite(t)` 摘除后
   *     `node tools/a1-check.mjs` 仍报 A1-5 PASS、退出码 0 —— 即该面坏了本门不响）
   *   · **原定阶段**：A1-5 的验收归属批次 **B4.2（阶段 3）**（判据表 A1-5@L456 / 归属 B4.2@L548）
   *   · **落点**：`packages/forgetting/src/retention.ts` 的 `decayKernelTeeth()` 增第三条牙
   *     `rejects-non-finite-time`（齿的唯一真源仍只此一份，判据腿与包内测试共用）
   *   · **为何本轮不改**：该文件**不在本卡写面**（写面 = packages/long-term/** ·
   *     tools/a1-check.mjs）。越界改动须先停下报告 ⇒ 本轮只披露、不越界。
   *   · **不静默**：本条已印进 A1-5 的 PASS detail（凡读本项读数者必然看到）。
   */
  /**
   * ⚠ **本条披露已随牙③落地而更新**（N3 合并轮）。
   *   旧文写的是「**不覆盖** Number.isFinite(t) …… 属已知覆盖缺口」—— 那是 N3 席当时的事实。
   *   本席已在 `packages/forgetting/src/retention.ts` 的 `decayKernelTeeth()` **补上第三条牙**
   *   `rejects-non-finite-time`（牙的唯一真源仍只此一份，判据腿与包内测试共用）⇒ 该缺口**已闭合**。
   *   ⚠ 披露文案**必须跟着事实走**：留着旧文会让读者以为缺口仍在（**过时披露与假绿同类**：
   *     它让人对"已覆盖"与"未覆盖"的判断失真）。故此处改为如实陈述三段覆盖面。
   */
  /**
   * ── 覆盖边界（**逐守卫摘除实证**，事实已更新）──────────────────────────────────
   *   实测（每条守卫单独摘掉、其余不动，跑 node tools/a1-check.mjs）：
   *     · 摘 t<0 守卫                       ⇒ 牙②咬住 ⇒ **A1-5 FAIL**（有牙）
   *     · 摘 halfLifeDays 正性/非有限守卫    ⇒ 牙①的自洽式咬住 ⇒ **A1-5 FAIL**（有牙）
   *     · 摘 Number.isFinite(t) 守卫         ⇒ **牙③咬住 ⇒ A1-5 FAIL**（本合并轮闭合；
   *       闭合前实测该项仍 PASS ⇒ 那是真缺口，不是误报）
   *     · 摘 `halfLifeDays` 的**消费**（改成忽略参数）⇒ **死旋钮探针**咬住 ⇒ A1-5 FAIL
   *   ⇒ 四条面各有独立判据，互不冒充。
   */
  const TEETH_COVERAGE_BOUNDARY =
    '｜**覆盖边界（逐守卫摘除实证）**：四条面**各有独立判据**——' +
    't<0（牙②）· halfLifeDays 正性/非有限（牙①自洽式）· **t 非有限数（牙③，本合并轮闭合）** · **halfLifeDays 是否被消费（死旋钮探针）**；' +
    '四者各自摘除后本项均实测 FAIL ⇒ 互不冒充。' +
    '⚠ **本条披露随事实更新**：上一版此处的原文是「**不覆盖** Number.isFinite(t) …… 属已知覆盖缺口」——' +
    '那是 N3 席当时的实测事实（其写面不含 forgetting 包，故只披露不越界）。本席已在该文件补上牙③ ' +
    '`rejects-non-finite-time` ⇒ **该缺口已闭合**，披露同步改写（留着旧文会让读者以为缺口仍在）。' +
    '｜**挂账 `A1-5-TEETH-GAP-1` 已闭合**：首现 2026-09-26（N3 清账席）· 闭合 2026-09-26（N3 合并轮）· ' +
    '落点 packages/forgetting/src/retention.ts 的 decayKernelTeeth 第三条牙（牙的唯一真源仍只此一份）'
  const kernelOk = Boolean(kernel && typeof kernel.decay === 'function')
  const paramsOk = kernelOk && near(kernel.decay(FROZEN_H, undefined), kernel.decay(FROZEN_H, FROZEN_H), 0)
  /** 死旋钮探针的一句话读数（进 detail）。`null` = 核不可用（此时已由 kernelOk 判 FAIL）。 */
  const knobNote = knobProbe === null
    ? '死旋钮探针：未判定（核不可用）'
    : 'error' in knobProbe
      ? '死旋钮探针：**抛错** ' + knobProbe.error
      : knobProbe.consumed
        ? '死旋钮探针：✓（h 减半 ⇒ ' + fixed(knobProbe.atHalf) + ' < ' + fixed(knobProbe.at14) + '）'
        : '死旋钮探针：✗ **参数被忽略**（h=14 与 h=7 在 t=14 处同值 ' + fixed(knobProbe.at14) + '）'
  const evidence =
    `${planLineNote('A1-5')}；读数由**真核**（packages/${KERNEL.pkg}/src/${KERNEL.file}）算出，期望值逐字取判据表；` +
    '带牙腿与包内测试共用同一份齿（packages/' + TEETH.pkg + '/src/' + TEETH.file + ' 的 decayKernelTeeth）'
  if (!kernelOk)
    fail(id, title, `真核不可加载 ⇒ **本项未判定**（不得读成通过）：${kernelErr}｜${teethNote}`, '先修 packages/' + KERNEL.pkg + '/src/' + KERNEL.file + ' 的可加载性')
  else if (bad.length)
    fail(id, title, `真核读数不符判据表：${bad.join('；')}｜${teethNote}｜${knobNote}`, '回排序步骤（衰减核参数 h=14 天，唯一出处 params.ts 的 HALF_LIFE_DAYS）')
  else if (knobProbe !== null && 'error' in knobProbe)
    fail(id, title, `死旋钮探针抛错：${knobProbe.error}｜${teethNote}`, '回 packages/' + KERNEL.pkg + '/src/' + KERNEL.file + '（半衰期参数必须可被消费）')
  else if (knobProbe !== null && knobProbe.consumed !== true)
    fail(
      id,
      title,
      `**死旋钮核**：同 t=14 下 h=14 与 h=7 给出同一个数（${fixed(knobProbe.at14)}）⇒ \`halfLifeDays\` 被忽略｜${teethNote}`,
      '回 packages/' + KERNEL.pkg + '/src/' + KERNEL.file + '（核必须消费 halfLifeDays 参数，不得硬编码半衰期）',
    )
  else if (teethOk !== true)
    fail(id, title, `${detail}｜**带牙腿未过** ⇒ 本项不得判 PASS（"判不了"与"过了"必须分开读）`, '回 packages/' + TEETH.pkg + '/src/' + TEETH.file + ' 的 decayKernelTeeth')
  else if (!paramsOk)
    fail(id, title, `${detail}｜**缺省半衰期不来自 params**：decay(t) 与 decay(t, HALF_LIFE_DAYS) 不同值 ⇒ 半衰期有了第二个出处（C14）`, '回 packages/long-term/src/params.ts 的 HALF_LIFE_DAYS（唯一出处）')
  else
    pass(
      id,
      title,
      `${detail}｜${teethNote}｜真核缺省 h 与 params.HALF_LIFE_DAYS 同值（单参 vs 显式传参逐位相同）｜真核 = packages/${KERNEL.pkg}/src/${KERNEL.file}` +
        (impls.length > 1 ? `｜⚠ 扫描到多个候选实现者：${impls.join(', ')}（本项判的是上列真核，其余候选须由他项覆盖）` : '') +
        TEETH_COVERAGE_BOUNDARY,
      evidence,
    )
}

// ══ A1-11 降级可区分（可枚举字段断言）═══════════════════════════════════════
{
  const id = 'A1-11'
  const title = '向量路径真被走到（负向：degraded===true 且字段可枚举）'
  const UNREACHABLE = 'http://127.0.0.1:1/v1' // 恒不可达（端口 1 无监听）
  try {
    const { recallVector } = await vecModule('recall.ts', mutOf('A1-11'))
    const { VectorStore } = await vecModule('vec-blob.ts', null)
    const cands = [
      { key: 'a', lexicalRank: 1 },
      { key: 'b', lexicalRank: 2 },
      { key: 'c', lexicalRank: 3 },
    ]
    const store = new VectorStore({ dim: 1024 })
    const fixture = (dim, seed) => {
      const v = new Float32Array(dim)
      for (let i = 0; i < dim; i++) v[i] = Math.sin((i + 1) * (seed + 1) * 0.011) * Math.cos(i * 0.017 + seed)
      return v
    }
    for (const c of cands) store.put(c.key, fixture(1024, c.lexicalRank))

    const cfg = { enabled: true, baseUrl: UNREACHABLE, model: 'bge-m3', dim: 1024, rrfK: 60, timeoutMs: 2000 }
    const out = await recallVector(cfg, store, '查询', cands, 3)

    const bad = []
    if (out.degraded !== true) bad.push(`degraded=${out.degraded}（应 true）`)
    if (typeof out.reason !== 'string' || !out.reason.length) bad.push(`reason=${JSON.stringify(out.reason)}（应非空字符串）`)
    if (!String(out.reason ?? '').includes(UNREACHABLE)) bad.push(`reason 未含端点（"哪个端点不通"不可查）：${out.reason}`)
    if (out.channel !== 'degraded') bad.push(`channel=${out.channel}（应 'degraded'）`)
    if (out.rankBy !== 'local_score') bad.push(`rankBy=${out.rankBy}（应 'local_score'，而非 'jev_prob'）`)
    if (!out.items.length) bad.push('降级路径未返回有序本地分结果（items 为空）')
    if (out.items.map((i) => i.key).join(',') !== 'a,b,c') bad.push(`降级时未按词法名次排序：${out.items.map((i) => i.key)}`)
    // 反向对照：1024 维 ⇒ 必须**不**降级（否则"永远降级"也能骗过上面那条）
    const fakeFetch = async () =>
      new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.1) }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    const ok = await recallVector({ ...cfg, baseUrl: 'http://127.0.0.1:9/v1', fetchImpl: fakeFetch }, store, '查询', cands, 3)
    if (ok.degraded !== false) bad.push(`1024 维仍判降级（reason=${ok.reason}）`)
    if (ok.reason !== null) bad.push(`未降级时 reason=${JSON.stringify(ok.reason)}（应 null）`)

    /**
     * ⚠ 载体口径（如实标注，不掩饰）：判据表 A1-11 原文的字段面含 `gate` 非空，而
     * `packages/core/src/domain.ts:102-110` 的 `ManaRecall` **没有** `gate` 字段
     * （`gate` 在 `ManaInjection`，domain.ts:118）。故本项在**向量适配面**上逐条断言
     * 它与 b11-vector.test.mjs:302-311 相同；`gate` 那一面属 inject_log 侧（A1-13/A1-14）。
     */
    const gateNote = '载体=RecallOutcome（b11-vector.test.mjs 同口径；domain.ManaRecall 无 gate 字段 ⇒ 该面属 A1-13/A1-14 的 inject_log）'
    const detail = `degraded=${out.degraded} · channel=${out.channel} · rankBy=${out.rankBy} · items=${out.items.length} 条有序 · 反向对照 degraded=${ok.degraded} · ${gateNote}`
    if (bad.length) fail(id, title, `不符：${bad.join('；')}`, '回向量适配层（packages/vector/src/recall.ts 的降级信封）')
    else pass(id, title, detail, `${planLineNote('A1-11')}；负向判据须造**真**故障路径（不可达端点）`)
  } catch (error) {
    fail(id, title, `加载/执行失败：${error.message}`, '先修源文件可解析性')
  }
}

// ══ A1-12 嵌入维度与语义间距 ════════════════════════════════════════════════
{
  const id = 'A1-12'
  const title = '嵌入维度契约（dim==1024，A 档）+ 语义间距（B 档只作说明）'
  const OLLAMA = 'http://127.0.0.1:11434/v1'
  try {
    const { assertDim } = await vecModule('cosine.ts', mutOf('A1-12'))
    const { embedTexts } = await vecModule('embed.ts', null)
    const { cosine } = await vecModule('cosine.ts', null)
    const bad = []
    // 纯函数面（不依赖网络）：维度契约必须在入口判，且原因里带实测值
    if (assertDim(new Float32Array(1024), 1024) !== null) bad.push('1024 维未通过（应返回 null）')
    const r768 = assertDim(new Float32Array(768), 1024)
    if (!r768 || !r768.includes('768') || !r768.includes('1024')) bad.push(`768 维原因不具诊断力：${r768}`)
    if (!assertDim(null, 1024)) bad.push('null 输入未给原因')
    if (!assertDim(Float32Array.from([1, NaN]), 2)) bad.push('含 NaN 未给原因')

    // ══ 真机面（本机 Ollama bge-m3）：**两态可分辨**（F-07a）══════════════════
    /**
     * ⚠ 上一版把两类完全不同的事**混成同一种红**（实测形态）：
     *   ① 本地服务真的不可达（连接被拒 / 解析不了）；
     *   ② 服务可达但**被环境拖慢到超时**。
     *   两者原先都走 `probe.degraded` 一条 `bad.push`，report 上只有一句「Ollama 必须可达」
     *   ⇒ 读报告的人**无法判断该去查服务还是查环境**。
     *
     * 现改为：**A 腿（主判定，同进程）**判「能不能真取到 1024 维向量」；
     *   **B 腿（归因与留档，子进程探针）**给出 TCP 层实测 + 归因类别 + 两态读数。
     * ⚠ 超时值**原样记录**、**不得调大当修法**（判据表 F-07a 明禁）：本处与探针都用 30000，
     *   与 packages/vector/src/embed.ts 的本地缺省一致 —— 改它就是把测量条件改掉。
     */
    const cfg = { enabled: true, baseUrl: OLLAMA, model: 'bge-m3', dim: 1024, timeoutMs: 30000 }
    const probe = await embedTexts(cfg, ['向量适配判据探针'])
    /** 跑一次子进程探针（两态：原样 env / 去掉 NODE_USE_ENV_PROXY）。NaN = 探针没跑成。 */
    const reachProbe = (extraEnv) => {
      const r = node([HERE_ENTRY, '--embed-reach-probe', '--base-url', OLLAMA, '--timeout-ms', '30000'], extraEnv ? { env: extraEnv } : {})
      try {
        return JSON.parse((r.out ?? '').trim().split('\n').pop())
      } catch {
        return { kind: 'PROBE_FAILED', attribution: `探针输出不可解析（exit=${r.code}）：${((r.err || r.out) || '').slice(0, 200)}` }
      }
    }
    const envDefault = reachProbe(null)
    const envNoProxy = reachProbe({ ...process.env, NODE_USE_ENV_PROXY: undefined })
    const bothStates =
      `两态留档：默认态=${envDefault.kind}（TCP ${envDefault.connect?.ms ?? '?'}ms / 嵌入 ${envDefault.embed?.ms ?? '?'}ms）· ` +
      `env -u NODE_USE_ENV_PROXY=${envNoProxy.kind}（TCP ${envNoProxy.connect?.ms ?? '?'}ms / 嵌入 ${envNoProxy.embed?.ms ?? '?'}ms）`
    if (probe.degraded) {
      // ⚠ 报错文本必须**点名延迟来源**（归因由子进程探针的 TCP 实测给出），且**带实测耗时**。
      bad.push(
        `本机 Ollama 不可达/未按期应答（测量条件）—— 归因=${envDefault.kind}：${envDefault.attribution}｜` +
          `实测：嵌入 ${probe.ms}ms（timeoutMs=${cfg.timeoutMs}）、TCP ${envDefault.connect?.ms ?? '?'}ms｜原始 reason：${probe.reason}｜${bothStates}`,
      )
    } else {
      if (probe.vectors.length !== 1) bad.push(`vectors.length=${probe.vectors.length}（应 1）`)
      else if (probe.vectors[0].length !== 1024) bad.push(`dim=${probe.vectors[0].length}（应 1024）`)
      const again = await embedTexts(cfg, ['向量适配判据探针'])
      const other = await embedTexts(cfg, ['完全换一句别的意思的话'])
      const unrelated = await embedTexts(cfg, ['量子色动力学与格点规范场的重整化群方程'])
      const simSame = cosine(probe.vectors[0], again.vectors[0])
      const simOther = cosine(probe.vectors[0], other.vectors[0])
      const simUnrelated = cosine(probe.vectors[0], unrelated.vectors[0])
      if (!(simSame >= 0.999999)) bad.push(`同文重复 cos=${simSame}（应 ≥0.999999，A 档）`)
      if (!(simSame > simOther)) bad.push(`同文相似度未高于改写句：${simSame} vs ${simOther}`)
      // B 档：相似度采样是浮动量（threshold-discipline.md 明列 bge-m3 采样浮动）⇒ 只记测量条件说明。
      // ⚠ 判据表 A1-12 的第二条腿「改写 − 无关 ≥ 0.2」（表内标 B 档）在本仓**没有标定夹具**：
      //   哪两句算「改写 / 无关」未固化，w1 实测同机两轮采样已见 0.784 vs 0.979 的漂移
      //   ⇒ 本脚本**如实标「未验证」**，既不据此判红也不据此判绿（把浮动量当阈值正是 threshold-discipline 明禁的形态）。
      const bNote =
        `[B 档 只作测量条件说明] 同文 cos=${fixed(simSame)} · 改写句 cos=${fixed(simOther)} · 无关句 cos=${fixed(simUnrelated)} · ` +
        `改写−无关=${fixed(simOther - simUnrelated)} · ⚠ 判据表第二条腿「改写−无关 ≥ 0.2」**未验证**（仓内无标定夹具；两个探针句由本脚本自拟）· ` +
        `耗时 ${probe.ms}/${again.ms}/${other.ms}/${unrelated.ms}ms`
      const detail = `纯函数面 4/4 · 真机 dim=${probe.vectors[0].length} · ${bothStates} · ${bNote}`
      if (bad.length) fail(id, title, `不符：${bad.join('；')}`, '回嵌入适配步骤（packages/vector/src/embed.ts / adapt.ts）')
      else pass(id, title, detail, `${planLineNote('A1-12')}；阈值分档见 docs/contract/threshold-discipline.md`)
    }
    if (bad.length && probe.degraded) fail(id, title, `不符：${bad.join('；')}`, '测得条件不具备时须红，不得静默跳过')
  } catch (error) {
    fail(id, title, `加载/执行失败：${error.message}`, '先修源文件可解析性')
  }
}

// ══ W2-5 P1 三骨架：按包名可解析且导出真成员 ══════════════════════════════════
{
  const id = 'W2-5'
  const title = 'P1 三骨架按包名可解析（long-term / consolidation / forgetting）'
  const PKGS = [
    ['dsh-mana-long-term', 'long-term', 'mana-long-term'],
    ['dsh-mana-consolidation', 'consolidation', 'mana-consolidation'],
    ['dsh-mana-forgetting', 'forgetting', 'mana-forgetting'],
  ]
  const lines = []
  const bad = []
  for (const [pkg, dir, svcName] of PKGS) {
    const pj = P('packages', dir, 'package.json')
    const wantEntry = `./lib/index.js`
    const main = existsSync(pj) ? JSON.parse(readFileSync(pj, 'utf8')).main : null
    if (main !== wantEntry) bad.push(`${pkg}: main=${main}（应 ${wantEntry}）`)
    let resolved = '(未解析)'
    try {
      resolved = relative(ROOT, fileURLToPath(import.meta.resolve(pkg)))
    } catch (error) {
      bad.push(`${pkg}: 按包名解析失败（${error.code ?? error.message}）`)
    }
    let keys = []
    try {
      const mod = await import(pkg)
      keys = Object.keys(mod).sort()
      for (const k of ['name', 'inject', 'apply']) if (!(k in mod)) bad.push(`${pkg}: 缺导出成员 ${k}`)
      if (mod.name !== svcName) bad.push(`${pkg}: name=${mod.name}（应 ${svcName}）`)
    } catch (error) {
      bad.push(`${pkg}: import 失败 ${error.code ?? error.message}`)
    }
    // 产物新鲜度：产物比源文件旧 ⇒ 解析到的是**过期实现**（判据绿但测的不是真源）
    // ⚠ 递归收集（含 `src/client/` 这类子目录）—— 见 collectTsFiles 注释里的漏检实测。
    const srcDir = P('packages', dir, 'src')
    const libEntry = P('packages', dir, 'lib/index.js')
    let fresh = null
    if (existsSync(libEntry) && existsSync(srcDir)) {
      const srcFiles = collectTsFiles(srcDir)
      if (srcFiles.length) {
        const maxSrc = Math.max(...srcFiles.map((f) => statSync(f).mtimeMs))
        fresh = statSync(libEntry).mtimeMs >= maxSrc
      }
    }
    // ── 产物过期判定：**内容腿优先，mtime 只作附加证据**（V1 修）─────────────────
    //
    // ⚠ 修的是什么（两位审查席独立报告，本席独立复现）：
    //   原实现 `if (fresh === false) bad.push(...)` 对 mtime **直接判红**，而**同一份实现、同一轮**
    //   的 ARTIFACTS 腿已把 mtime 定性为「可被 cp/touch 伪造的代理指标」并给 HANG
    //   ⇒ 同一现象一处判红、一处挂账。实测形态：` M packages/long-term/src/index.ts`（别席在途编辑）
    //   会让 mtime 腿报「过期」，而内容腿（真 tsc 重编 + 逐字节比）同时报 ✓ —— 那是**假红**。
    // ⚠ **不得**改成「不看 mtime」（那是拆东墙：把一条能抓真过期的腿变成永远绿的腿）。
    //   新口径是**两级**，且**只有两级**：
    //     · 内容腿 FAIL（与当前 src 重编译产物字节不等 / lib 缺产物 / lib 多出当前 src 编不出的产物）
    //       ⇒ **判红**（这是「产物不是当前 src 编出来的」的直接证据，不可被 mtime 掩盖）；
    //     · 内容腿 PASS 而 mtime 报旧 ⇒ **不判红**，在行内标注 `mtime=⚠（内容✓⇒mtime假红）`；
    //     · 内容腿 unknown（无 tsc / 无 tsconfig / 重编未产出）⇒ **不得读成一致**：
    //       此时 mtime 旧就**仍然判红**（mtime 是唯一可用证据，不能因为「内容腿判不了」而放行）。
    //   ⇒ 真过期（改 src 不重建）在下述两种情形都仍会红：内容腿直接红；或内容腿判不了时 mtime 红。
    const cv = artifactVerdict(dir)
    const mtimeStale = fresh === false
    if (cv.state === 'FAIL') {
      bad.push(`${pkg}: 产物过期（**内容腿**：与当前 src 重编译产物不一致）—— ${contentBad(cv)}`)
    } else if (mtimeStale && cv.state !== 'PASS') {
      // 内容腿 unknown ⇒ mtime 是当轮唯一证据 ⇒ 保留原判红口径（不因「判不了」而放行）。
      bad.push(`${pkg}: lib/index.js 早于 src 且内容腿**未判定**（${contentBad(cv)}）⇒ 按 mtime 判过期`)
    }
    const cNote = cv.state === 'PASS' ? '内容=✓' : cv.state === 'unknown' ? '内容=未判定' : '内容=✗'
    const mNote = !mtimeStale ? '✓' : cv.state === 'PASS' ? '⚠（内容✓⇒mtime假红）' : '⚠过期'
    lines.push(`${pkg} → ${resolved} [${keys.join(',')}] mtime=${mNote} ${cNote}${cv.state === 'FAIL' ? ' ⚠' + contentBad(cv) : ''}`)
  }
  if (bad.length) fail(id, title, `不符：${bad.join('；')}｜${lines.join(' | ')}`, '回构建步骤（npm run build --workspace dsh-mana-<pkg>）')
  else pass(id, title, lines.join(' | '), '判据表 docs/session-allocation.md W2-5；「文件在长」不算通过 —— 断言到导出符号与产物新鲜度')
}

// ══ W3 注入审计：A1-13 / A1-14 / A1-6+A1-7 / A1-1（走真装配链 + 真 agent/pre-step 分发）══
//
// ⚠ 本组的判据**不重写**业务断言，而是把两个测试文件**真跑一遍**并解析 TAP 结果。
//   理由：判据逻辑（枚举校验、fail-closed 留痕、尾部追加、seq 无洞）必须只有一份实现；
//   在机检器里再写一遍就是**两个真源**，改一处漏一处即漂移（本仓 ADR-10 的同型教训）。
//   ⇒ 机检器在此只做「跑 + 解析 + 归因到具体用例」，不复制断言。
// ⚠ 归因要求：挂的时候必须**点名到用例**，不能只说"文件红了"（否则真因仍不可观测）。
const W3_TESTS = {
  chain: P('packages/core/tests/chain-e2e.test.mjs'),
  gate: P('packages/core/tests/injection-gate.test.mjs'),
  // P5（S4 席交付，装配证据面）：ui 的**装配**与**产物侧落点**两份判据。
  // ⚠ 这两份此前**没有任何机检入口**（只在本席口头汇报里）——「建了判据却没人跑」
  //   等于没建（本仓既有教训：`check:a1` 之前 a1-check 零调用者）。此处接进 A1 门链。
  uiAssembly: P('packages/ui/tests/assembly.test.mjs'),
  uiRender: P('packages/ui/tests/ui.test.mjs'),
}

/**
 * 跑一个测试文件，返回 { ok, out, failed(cases), passed }。
 *
 * ⚠ **判据只看「本项关心的用例」**，不看整个文件的 exit code（本仓 2026-09-25 实测踩到）：
 *   同一文件里既有 A1-13 的用例也有 A1-14 的用例 ⇒ 若把 `r.ok`（文件级退出码）计入，
 *   删掉留痕会让 **A1-6 也报红**，而 A1-6 的 2 条用例其实**全过**（实测 `passed=2/2` 且
 *   被判 FAIL）—— 那是**假红**，会把排查者引向错误的位置。
 *   ⇒ 本项成功的定义是：**我关心的那几条用例全绿**（且数量对得上，防"用例被删光")。
 */
/** 本次运行里跑过的子进程原始输出（供失败留档逐条抠 `not ok` 明细；见文末 K1 件 3）。 */
const RAW_RUNS = []
function runCases(file, cases) {
  const r = node(['--test', file])
  const out = `${r.out ?? ''}${r.err ?? ''}`
  RAW_RUNS.push({ file, out, fileOk: r.ok, code: r.code })
  const failed = cases.filter((name) => new RegExp(`not ok \\d+ - ${name}`).test(out))
  const passed = cases.filter((name) => new RegExp(`ok \\d+ - ${name}`).test(out))
  const tests = Number((/# tests (\d+)/.exec(out) ?? [])[1] ?? -1)
  // 用例被删光/改名 ⇒ `passed` 长度不足，调用方按 `passed.length === cases.length` 判红。
  return { out, failed, passed, tests, fileOk: r.ok }
}

{
  const id = 'A1-1'
  const title = 'A1-1 端到端事件链：perception→attention→WM→scheduler 且 seq 连续无洞'
  const r = runCases(W3_TESTS.chain, ['C1 A1-1'])
  if (r.failed.length === 0 && r.passed.length === 1) {
    pass(id, title, `从 perception 真触发走通全链（三段各写库）；seq 连续无洞`, `${planLineNote('A1-1')}；走真 cordis Loader 装配链，装配判据=服务可读`)
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `用例未命中（tests=${r.tests}）`, '回 B2.1 接线步骤')
  }
}

{
  const id = 'A1-13'
  const title = 'A1-13 注入审计：每次 pre-step 都留痕；5 类 gate 枚举**均有生产侧写入点**'
  // ⚠ 本项覆盖**五类枚举各自可达**（不是只验"取值合法"）：
  //   P1 留痕+枚举合法 / P2 injected / P7 门控关闭 / P9·P10 不变式 / P11 reset /
  //   P12 skip_below_threshold / P13 degraded_unavailable
  //   —— 「枚举有 5 类」与「5 类都真能出现」是两回事；后者才说明门控的每种结局都可观测。
  const cases = ['P1 A1-13①', 'P2 A1-13②', 'P7 门控关闭', 'P11 reset', 'P12 判定链未过阈', 'P13 判定链降级']
  const r = runCases(W3_TESTS.gate, cases)
  if (r.failed.length === 0 && r.passed.length === cases.length) {
    pass(id, title, `6 条用例全绿：每次 pre-step 均留痕；injected / skip_no_candidate / skip_below_threshold / degraded_unavailable / reset 五类各有写入点与判据`, `${planLineNote('A1-13')}；跑真 agent/pre-step 分发 + 判定链桩，非直接调 service`)
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/${cases.length}）`, '回 Injection Gate（packages/attention）')
  }
}

{
  const id = 'A1-8'
  const title = 'A1-8 门控失败可区分：jev_log 有 gate 列且取值域受限、degraded 与 gate 至少一个非空'
  // ⚠ 本项的**机制前置**是本仓 2026-09-25 实测修出来的：判据原文要求
  //   「Write → gate in (unavailable,budget) 且行仍写入」，而 jev_log **从未建 gate 列**
  //   ⇒ 该判据结构上不可执行（查一列不存在的列）。已补列 + CHECK + 迁移承接。
  const cases = ['G1 A1-8', 'G2 A1-8', 'G3 A1-8']
  const r = runCases(P('packages/core/tests/jev-gate.test.mjs'), cases)
  if (r.failed.length === 0 && r.passed.length === cases.length) {
    pass(id, title, 'jev_log.gate 列存在且 CHECK 限定 unavailable/budget；失败行仍写入；degraded 与 gate 至少一非空', `${planLineNote('A1-8')}；补列经 ADR-6 迁移机制对存量库同样生效`)
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/${cases.length}）`, '回 jev_log 表结构 / JEV 适配层降级链')
  }
}

/**
 * ── A1-9 的**生产链路腿**（K1 件 1）────────────────────────────────────────
 *
 * ⚠ **为什么单元腿不够**（本席 2026-09-26 实测，两态读数见 handoff）：
 *   判据表 A1-9 判的是「**审计表**里不出现记忆原文」。而审计表的生产者是 attention 的
 *   注入链（`finish('injected', { blockId, memoryId })` → `core.writeInjectLog`）。
 *   F4/F5 全是 `core.writeInjectLog({...})` 的**直写单元腿** ⇒ 它们判的是「契约怎么写」，
 *   判不了「生产链路上写出去的是什么」。
 *   ⇒ 实测形态：把块身份换成**内容水印**（`block_id` 里塞块正文）后，审计行经真链路泄漏
 *     原文 3-gram，而 F4/F5 **仍然全绿** —— 那个绿**不是「事实被检查」，是「根本没打在那条腿上」**。
 *
 * ⚠ **本腿不是新判据项**：它不新增 id（项集等式不动），而是把 A1-9 从「单元腿绿」升级为
 *   「单元腿 **且** 生产链路腿都真」。两腿缺一即 A1-9 判红（不是挂账 —— 能测而不测就是漏判）。
 *
 * ⚠ **不许用「跑别人的测试文件 + 数 TAP」当本腿**（那是弱链接，本仓已修过同类）：
 *   本腿**自己起 Loader、自己分发 agent/pre-step、自己数 n-gram**，不依赖任何测试文件的 TAP。
 *   与 `packages/attention/tests/defect-report.test.mjs` D1 ⑤ 的**独立复算**只作旁证（不影响档位）。
 *
 * ⚠ **自带扰动对拍**（本仓「判据变异验证」纪律）：本腿若只跑一遍正样本，「恒绿」与「有牙」外观相同。
 *   故再起一个**真变异体**（改 attention lib 的块身份为内容水印，写临时目录、仓内零写入）：
 *   变异体下本腿的 n-gram 扫描**必须命中**，否则本腿判红（无牙）。
 */
async function a1RuntimeAuditLeak() {
  const out = { note: '', why: '' }
  const gramsOf = (s) => { const g = []; for (let i = 0; i + 3 <= s.length; i += 1) g.push(s.slice(i, i + 3)); return g }
  const SECRET = '这是一段绝不应出现在审计表里的记忆原文内容'
  /** 相邻断言的独立复算（旁证）：defect-report D1 ⑤ 判的是同一件事。读**活代码**，不算注释里的声明。 */
  const corroborate = () => {
    try {
      const live = readFileSync(P('packages/attention/tests/defect-report.test.mjs'), 'utf8')
        .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      const hit = live.includes('走**真注入链路**后 inject_log 泄漏了内容片段') &&
        /assert\.equal\(\s*leaked\.length,\s*0\s*,/.test(live)
      return hit ? '相邻断言（defect-report D1 ⑤）在真源里**仍在**、与本次读数同口径' :
        '⚠ **相邻断言不在真源里**（该文件被清空/断言被删或被注掉）—— 本腿读数不受影响，但「该面另有覆盖」这句声明已不成立'
    } catch (error) {
      return '⚠ 相邻断言**读不到**（defect-report.test.mjs 缺失：' + String(error.message).slice(0, 80) + '）'
    }
  }
  let h = null
  try {
    h = await import(url(P('packages/attention/tests/_harness.mjs')))
  } catch (error) {
    out.note = '**未判定**：夹具加载失败 ' + String(error.message).slice(0, 140)
    out.why = `生产链路腿**未判定**：${String(error.message).slice(0, 120)} ⇒ 本项不得只凭单元腿判绿`
    return out
  }
  /**
   * ⚠ **正样本与扰动样本必须各自 try/catch**（本席 2026-09-26 对抗实测踩到）：
   *   第一版把两段裹在同一个 try 里，于是在「真源**已经**是泄漏形态」的树上（正是最该报红的时候），
   *   扰动体因锚点已被真源占用而**抛错**，异常把**已经量出来的泄漏读数一起吞掉** ——
   *   报告只留下「未判定」，而事实是「真的在泄漏 6 个 3-gram」。
   *   ⇒ 两条独立：谁失败都不许遮住另一条的结论；判红优先级 = 真泄漏 > 无到达证据 > 扰动无牙 > 未判定。
   */
  let leaked = null
  let injected = null
  let rows = null
  try {
    const b = await h.boot({ judge: 'ok' })
    h.perceive(b.ctx, { content: SECRET, requestId: 'k1-runtime-secret' })
    await h.firePreStep(b.ctx, { turn: 1, messages: [] })
    rows = h.readInject(b.store)
    leaked = gramsOf(SECRET).filter((g) => JSON.stringify(rows).includes(g))
    injected = rows.filter((r) => r.gate === 'injected').length
  } catch (error) {
    out.note = '**未判定（正样本装载/分发失败）**：' + String(error.message).slice(0, 150)
    out.why = `生产链路腿**未判定**：正样本夹具装载/分发失败（${String(error.message).slice(0, 120)}）⇒ 本项不得只凭单元腿判绿`
    return out
  }
  let mLeaked = null
  let mInjected = null
  let mutErr = null
  try {
    const MUT = [['const blockId = `blk-${injections}`', 'const blockId = block.slice(0, 24)']]
    const m = await h.boot({ judge: 'ok', mutant: { replace: MUT } })
    h.perceive(m.ctx, { content: SECRET, requestId: 'k1-runtime-secret' })
    await h.firePreStep(m.ctx, { turn: 1, messages: [] })
    const mRows = h.readInject(m.store)
    mLeaked = gramsOf(SECRET).filter((g) => JSON.stringify(mRows).includes(g))
    mInjected = mRows.filter((r) => r.gate === 'injected').length
  } catch (error) {
    mutErr = String(error.message).slice(0, 150)
  }
  /**
   * ⚠ `mLeaked` 是**数组**：第一版硬化时写成 `${mLeaked}` 与 `mLeaked === 0`，
   *   后果两条都坏 —— 报告印出数组内容（读起来像乱码），而「无牙」判定 `数组 === 0` **恒为假**
   *   ⇒ 牙齿检查变成死功能，判据在扰动体不泄漏时照样判绿（本仓「两个分支字面相同」的同型）。
   *   本席 2026-09-26 复跑整份报告时从输出里读出来（`--self-test` 的 ⑧ 也同时变红）。
   *   故此处一律用 `.length`，并由 ⑧ 用例把「命中数必须是数字」钉死。
   */
  const mutNote = mutErr
    ? `扰动对拍**跑不起来**：${mutErr}` +
      `（⚠ 常见成因：**真源里已经是**水印形态 ⇒ 锚点被占用。此时**不影响正样本读数**，但它意味着这次无法自证有牙）`
    : `扰动对拍（块身份→内容水印，真变异）：命中 ${mLeaked.length} 个 3-gram ⇒ ${mLeaked.length > 0 ? '该腿有牙' : '**该腿无牙**'}`
  out.note =
    `真 Loader + 真 agent/pre-step：inject_log ${rows.length} 行（injected ${injected}）· 原文 3-gram 命中 ${leaked.length}` +
    `｜${mutNote}｜${corroborate()}`
  out.why = runtimeAuditVerdict({
    leaked: leaked.length,
    injected,
    mLeaked: mutErr ? -1 : mLeaked.length,
    mInjected: mutErr ? -1 : mInjected,
    mutErr,
  })
  return out
}

/**
 * 生产链路腿的**判定函数**（K1 件 1 的判定面）。
 *
 * ⚠ **为什么必须抽成具名函数、且判定输入必须是计数**（本席 2026-09-26 实测踩到的自身缺陷）：
 *   第一版把判定写在腿里、且对**数组**判 `mLeaked === 0` —— 那**恒为假**（数组永不等于 0），
 *   于是「扰动对拍无牙」这条分支**结构性不可达**：扰动体一个 3-gram 都没命中时判据照样绿。
 *   这是本仓已修过两次的老形态（两个分支字面相同 ⇒ 死功能）。
 *   ⚠ 更坏的是：`--self-test` 的 ⑧ 当时**读的是人读文本**而不是判定结果 ⇒ 它跟着一起绿，
 *     把「腿无牙」读成了「两态可分辨」（本席对拍 6 实测复现）。故同时做两件事：
 *       ① 判定收进本函数，输入**必须是计数（number）**：传数组即报内部错误 ⇒ 那种死法不可复现；
 *       ② `--self-test` ⑧ **直接调本函数**做合成两态，不再解析人读文本。
 *
 * 判红优先级（最可信、最要紧的结论放最前）：
 *   ① 类型错 → 内部错误（读数不可信时不许下任何结论）；
 *   ② 真泄漏 —— 无论扰动跑没跑成，泄漏就是泄漏（实测：正因它排在扰动之后，差点把「真泄漏 6 个」读成「未判定」）；
 *   ③ 无到达证据 —— 链路没跑到 ⇒ 读不出「没泄漏」，如实说没打到靶；
 *   ④ 扰动未判定 / 无牙 —— 正样本干净但证明不了判据有牙 ⇒ 本项不得据此判绿。
 */
function runtimeAuditVerdict({ leaked, injected, mLeaked, mInjected, mutErr }) {
  const bad = Object.entries({ leaked, injected, mLeaked, mInjected }).filter(([, v]) => typeof v !== 'number' || !Number.isFinite(v))
  if (bad.length) {
    return `生产链路腿**内部错误**：判定输入必须是**计数（number）**，实得 ${bad.map(([k2, v]) => `${k2}=${Array.isArray(v) ? `数组(${v.length})` : typeof v}`).join(' / ')}` +
      ' ⇒ 输入形态不对时**不得**下「审计干净」的结论（历史缺陷：对数组判 `=== 0` 恒为假 ⇒ 无牙分支不可达）'
  }
  if (leaked > 0) return `生产链路腿判红：真注入链路下 inject_log 泄漏了 ${leaked} 个原文 3-gram`
  if (injected === 0) return '生产链路腿**无到达证据**：真链路上一行 injected 都没有 ⇒ 本腿没打到靶上（不得读成"没泄漏"）'
  if (mutErr) return `生产链路腿的**扰动对拍未判定**（${String(mutErr).slice(0, 90)}）⇒ 本次无法自证有牙，本项不得据此判绿`
  if (mInjected === 0 || mLeaked === 0) return '生产链路腿的**扰动对拍无牙**：把块身份换成内容水印后仍一个 3-gram 都没命中 ⇒ 该腿恒绿（不得读成"审计干净"）'
  return ''
}
{
  const id = 'A1-9'
  const title = 'A1-9 审计不泄内容：inject_log 全文做 ≤32 字节 n-gram 匹配命中 0（单元腿 + **生产链路腿**）'
  const cases = ['F4 A1-9', 'F5 A1-9']
  const r = runCases(P('packages/core/tests/lexical-audit.test.mjs'), cases)
  const unitOk = r.failed.length === 0 && r.passed.length === 2
  /** ⚠ **生产链路腿**（K1 件 1）：判据表 A1-9 判的是**审计表**，而审计表的生产者是 attention 的写入链。
   *  F4/F5 是 core 直写单元腿 ⇒ 只判「契约怎么写」，判不了「生产链路上写出去的是什么」。
   *  本腿真起 Loader + 真 agent/pre-step 分发，再对审计行数 3-gram。两腿都真才 PASS。 */
  const rt = await a1RuntimeAuditLeak()
  const bad = []
  if (!unitOk) bad.push(r.failed.length ? `单元腿挂：${r.failed.join(' / ')}` : `单元腿用例未命中（passed=${r.passed.length}/2）`)
  if (rt.why) bad.push(rt.why)
  const detail = `单元腿 F4/F5=${unitOk ? '2/2 全绿' : `passed=${r.passed.length}/2`}｜生产链路腿：${rt.note}`
  if (bad.length) {
    fail(id, title, `${detail}｜不符：${bad.join('；')}`, '回审计写入步骤（core.writeInjectLog 契约 / attention 的块身份口径）')
  } else {
    pass(id, title, `${detail}｜审计行序列化后对记忆原文做 3-gram 匹配命中 0；但 id 必须保留（防"什么都不记"冒充合规）`, `${planLineNote('A1-9')}；F5=单元腿自身的**有牙自证**（内容一旦进审计必须命中）；生产链路腿走真 Loader + 真 agent/pre-step，且**自带扰动对拍**（块身份→内容水印必红）`)
  }
}

{
  const id = 'A1-10'
  const title = 'A1-10 中文召回非静默归零（负向）：库非空时中文串必须命中 ≥1'
  const cases = ['F1 A1-10', 'F2 A1-10', 'F3 A1-10']
  const r = runCases(P('packages/core/tests/lexical-audit.test.mjs'), cases)
  if (r.failed.length === 0 && r.passed.length === 3) {
    pass(id, title, '中文串真召回 ≥1；0 命中的三种原因（库空/查询过短/真查不到）可分辨；FTS 同步触发器增删改均生效', `${planLineNote('A1-10')}；机制根因=external content 虚表不自动跟随主表（实测静默 0 命中）`)
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/3）`, '回 FTS5 建表/触发器口径')
  }
}

{
  const id = 'W-1..3'
  const title = 'vec0 三语义负例（W-1 度量 / W-2 rowid BigInt / W-3 KNN LIMIT）'
  // ⚠ 本项**允许 HANG**：§8 C4 把 vec0 定为规模化升级项（>10 万条才启用），
  //   故"扩展未安装"是**合规现状**。但「未装」与「装了且语义对」绝不可同形
  //   ⇒ 探针在未装时报 HANG 并给出安装命令，而不是 PASS/skip。
  const r = node([P('tools/probes/vec0-semantics.mjs'), '--json'])
  RAW_RUNS.push({ file: P('tools/probes/vec0-semantics.mjs'), out: `${r.out ?? ''}${r.err ?? ''}`, fileOk: r.ok, code: r.code })
  let parsed = null
  try {
    parsed = JSON.parse((r.out ?? '').trim())
  } catch {
    parsed = null
  }
  const states = (parsed?.results ?? []).map((x) => x.state)
  const fails = (parsed?.results ?? []).filter((x) => x.state === 'FAIL')
  if (!parsed) {
    fail(id, title, `探针输出不可解析（exit=${r.ok ? 0 : 1}）`, '回 tools/probes/vec0-semantics.mjs')
  } else if (fails.length === 0 && states.length === 3) {
    const hangs = states.filter((x) => x === 'HANG').length
    if (hangs === 3) {
      hang(
        id,
        title,
        '扩展未安装（候选路径均不存在）⇒ 三语义**未验证**；装 sqlite-vec-linux-x64@0.1.9 后自动转 PASS/FAIL',
        '§8 C4：vec0 为规模化升级项（>10 万条启用），当前不装合规；但"未装"报 HANG 而非 PASS',
        {
          token: 'W-1..3',
          crit: null,
          implBatch: null,
          note: '原定验收阶段 = **被启用时**（本册 §4 阶段 1 / B1.1 的验收挂钩：「启用 vec0 时须补一条 W-1/W-2/W-3 各造一次负例」）—— 属**触发式**验收条，本册未给它固定阶段号，故如实标此口径而不编阶段号',
        },
      )
    } else {
      pass(id, title, `三条负例全部实测复现（vec_version=${parsed.vecVersion}）：W-1 缺省=L2、W-2 rowid 须 BigInt、W-3 KNN 须带 LIMIT`, `扩展=${parsed.extension}`)
    }
  } else {
    fail(id, title, fails.map((x) => `${x.id}: ${x.detail.slice(0, 60)}`).join(' / '), '回 vec0 适配层')
  }
}

{
  const id = 'P5-UI'
  const title = 'P5 UI 装配证据：装配三态（未装不可读/按包名装上/卸载即净）+ 产物侧落点随渲染增长'
  // ⚠ 本项的两份判据此前**不在任何机检入口**里 —— 只在本席的汇报口述中。
  //   「建了判据却没人跑」等于没建（本仓既有的 `check:a1` 教训）。此处接进门链。
  const aCases = ['装配①', '装配②', '装配③']
  const rCases = ['R5 落点', 'R5 反证判据']
  const a = runCases(W3_TESTS.uiAssembly, aCases)
  const r = runCases(W3_TESTS.uiRender, rCases)
  const bad = []
  if (a.failed.length) bad.push(`装配：${a.failed.join(' / ')}`)
  if (r.failed.length) bad.push(`落点：${r.failed.join(' / ')}`)
  if (bad.length === 0 && a.passed.length === aCases.length && r.passed.length === rCases.length) {
    pass(id, title, `装配三态 3/3 + 落点 2/2 全绿：未装配时服务不可读（防平凡通过）→ 经 Loader 按包名真装上 → 卸载即净；渲染一次即写一行 ui/render，卸载后不再新增`, '判据见 packages/ui/tests/assembly.test.mjs 与 ui.test.mjs；装配面另有 R0 三源互证（13/13 含 ui）')
  } else {
    fail(id, title, bad.join('；') || `用例未全绿（装配 ${a.passed.length}/${aCases.length}、落点 ${r.passed.length}/${rCases.length}）`, '回 packages/ui 装配/落点实现或启用步骤')
  }
}

{
  const id = 'A1-14'
  const title = 'A1-14 fail-closed 不得吞掉「未判」：不注入 **且** 仍留痕（两条都要真）'
  // ⚠ 本轮（S7）修的**夹具自证**：此前本批只取 P5 + P6，其中
  //   · P5 是"候选池空"（不是 JEV 降级面）；
  //   · **P6 是测试自己用 `core.writeInjectLog()` 直写降级行**（服务面直写），
  //     它自认"这里用服务面直写验证落点契约" ⇒ **没有真正制造判决链降级**。
  //   ⇒ 两项都是绿的时候，A1-14 的"造一次 JEV 不可用"其实一次都没造过。
  //   真用例**本来就在同一个文件里**：`P13 判定链降级`（boot({judgeProbability:null}) ⇒
  //   判定链桩恒返回 degraded:true ⇒ 门控真走 `degraded_unavailable` 并留痕），
  //   且它已被 A1-13 的批调用。故本批改为 P5 + P6 + P13（**不新写用例**）。
  const cases = ['P5 A1-14', 'P6 A1-14', 'P13 判定链降级']
  const r = runCases(W3_TESTS.gate, cases)
  if (r.failed.length === 0 && r.passed.length === cases.length) {
    pass(id, title, `${cases.length} 条用例全绿：无候选 / 服务面直写 / **真判定链降级**三条路径：注入块 == 0 **且** inject_log 均新增对应枚举行（只满足前者即静默）`, `${planLineNote('A1-14')}；G8「降级必须落显式字段」；P13 经真 agent/pre-step 分发触发判定链降级（非测试直写）`)
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/${cases.length}）`, '回 Injection Gate 的留痕路径')
  }
}

{
  const id = 'A1-2'
  const title = 'A1-2/A1-3 注入不变式 I1/I2：每 (session,turn) ≤1 注入块、每条记忆每 session ≤1 次'
  const r = runCases(W3_TESTS.gate, ['P9 A1-2', 'P10 A1-3'])
  if (r.failed.length === 0 && r.passed.length === 2) {
    pass(id, title, '同一 turn 连打 3 次 pre-step：3 行留痕但 injected **仅 1 行**；跨 turn 不重复注入同一批候选', `${planLineNote('A1-2', 'A1-3')}；前置 A0-8（表 + 列）已具备`)
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/2）`, '回 Injection Gate 的去重/清空步骤')
  }
}

{
  const id = 'A1-6'
  const title = 'A1-6/A1-7 注入块转义（内层 < = 0）+ 尾部追加（前缀逐字节不变）'
  const r = runCases(W3_TESTS.gate, ['P3 A1-6', 'P4 A1-7'])
  if (r.failed.length === 0 && r.passed.length === 2) {
    pass(id, title, '含尖括号内容被转义（内层 < = 0）；注入为尾部追加、既有消息逐字节不变', `${planLineNote('A1-6', 'A1-7')}；宿主契约「this waterfall cannot mutate messages」`)
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/2）`, '回注入块组装/追加步骤')
  }
}

// ══ 自测腿：C16 的**致盲形态**（加固 2；S20 上报、主持人已复现）════════════════
/**
 * ⚠ 要抓的不是「引用写错」，是**判据看不见**：
 *   `docs/_check-consistency.mjs:357` 的 C16 正则是
 *     `/(?:见|读|跳|按|回|阅)\s*(?:本册\s*)?§(\d+(?:\.\d+)*)/`
 *   —— 触发词与 `§` 之间**只允许空白（与 `本册`）**。插进任何别的字符（哪怕只是加粗标记），
 *   该引用就**完全不进入匹配**。主持人决定性复现两态：
 *     `按 §6.4`      ⇒ C16 看得见（本册无 §6.4 ⇒ 报红，好事）
 *     `按**** §6.4`  ⇒ **exit=0 / C16 PASS** —— 那个 PASS 是「**看不见**」，不是「已解析」。
 *   那一处正则**不是本脚本的写面**（归文档侧），故这里只做一件事：
 *   **把该形态本身钉成可机检的红**，并点名到行号。
 *
 * ⚠ 判据形态（**只对「本册内部引用」断言**，避免把合法的外部/中性引用判红）：
 *   ① 触发词 + 若干非空白字符 + `§N`，且顶级号 N **属本册**（与 C16 同一口径）；
 *   ② 触发词与 `§` 之间**不含**分句/分栏标记（`；。，、）｜`）—— 含则说明该触发词并不支配这个 §
 *      （例：「再跳到 §4 …；要查…→ 读 §6」里那个被命中的「按」属于更早的「按方案」）；
 *   ③ 触发词与 `§` 之间**不含** `方案` —— 明示外部（`按方案 §6.4` 是**正确写法**，不是缺陷）；
 *   ④ `§N` 旁另有 `本册` 字样 ⇒ 显式本册引用，**任何间隔都不许**（哪怕只多一个空格）。
 *   本册**当前实测该集合为空**（见 detail）⇒ 这条腿现在绿；但那是「眼下没有」，不是「永远没有」：
 *   文档里一出现 `按**X** §6.1` 就立刻红。
 *
 * ⚠ **不调用** `docs/_check-consistency.mjs` 代替本腿：C16 对顶级 `§N` 只看「有没有同名小节」，
 *   对 **`§N.M` 才做存在性校验** ⇒ 调它**在结构上答不了**本腿要问的问题（两态实证见 handoff 对拍 B）。
 * ⚠ 本腿内嵌的 C16 正则**是一份副本，会漂** ⇒ 由 `--self-test` 的 `c16pattern` 用例直接读原文比对，
 *   把「副本过期」也变成红（否则原文改了、这里还在按老规则护，是同一类假绿）。
 */
const C16_RX = /(?:见|读|跳|按|回|阅)\s*(?:本册\s*)?§(\d+(?:\.\d+)*)/g
const TRIG_CHARS = '见读跳按回阅'
const CLAUSE_MARKS = /[；。，、）)｜|]/
/**
 * 扫一份文本，返回全部「触发词与 § 之间有内容 ⇒ C16 看不见」的**本册**引用。
 *
 * 规则（每条都对应一个「不判红」的正当情形 —— 宁可少报也不误报，
 * 因为**误报会把真缺陷淹掉**，那正是本腿要防的形态）：
 *   ① 触发词与 § 之间**只允许空白**（与 `本册`）；其余任何内容 ⇒ 候选；
 *   ② 间隔里含分句/分栏标记 ⇒ **不算**：说明该触发词并不支配这个 §
 *      （例「再跳到 §4 ……；要查…→ 读 §6」里，向前找最近触发词会命中更早的『按』）；
 *   ③ 间隔里含 `方案` ⇒ **不算**：明示外部，`按方案 §6.4` 是**正确写法**；
 *   ④ 顶级号不属本册、且 § 旁无 `本册` 字样 ⇒ **不算**（与 C16 同为「顶级号不属本册 ⇒ 交 C8」）；
 *   ⑤ **枚举串**：触发词与本 § 之间已有**另一个** `§N`，且到它之间无分句标记 ⇒ **不算**
 *      （「按 §6.0 分档纪律与 §6.1 清单」里的 `与` 不是触发词，向前找会命中 `按`）。
 *
 * ⚠ 本册 **2026-09-25 实测命中 2 处**（L6/L79，见 handoff 对拍 A）—— 都是**真**致盲，不是误报：
 *   两处的渲染结果分别是「跳到 §4」「见 §2 G9」，引用**又正确又必要**、但不会进 C16。
 * ⚠ `nearby` 为真时跳过规则③④（离线自测用：合成文本无章节表，无法用『顶级号属本册』判断）。
 */
function c16BlindRefs(text, { nearby = false } = {}) {
  const ls = String(text).split(/\r?\n/)
  const ownTop = new Set()
  for (const l of ls) { const m = l.match(/^##\s+(\d+)\./); if (m) ownTop.add(m[1]) }
  const out = []
  ls.forEach((l, i) => {
    for (const m of l.matchAll(/§(\d+(?:\.\d+)*)/g)) {
      const idx = m.index
      const before = l.slice(Math.max(0, idx - 32), idx)
      let gi = -1
      for (let k = before.length - 1; k >= 0; k -= 1) if (TRIG_CHARS.includes(before[k])) { gi = k; break }
      if (gi < 0) continue
      const gap = before.slice(gi + 1)
      if (/^\s*(?:本册\s*)?$/.test(gap)) continue           // C16 看得见 ⇒ 不是致盲形态（规则①）
      if (CLAUSE_MARKS.test(gap)) continue                   // 规则②
      if (!nearby && /方案/.test(gap)) continue               // 规则③
      const top = m[1].split('.')[0]
      const explicitThis = /本册/.test(l.slice(Math.max(0, idx - 18), idx + 1 + m[1].length))
      if (!nearby && !ownTop.has(top) && !explicitThis) continue   // 规则④
      const firstSec = gap.search(/§\d/)                     // 规则⑤：枚举串
      if (firstSec >= 0 && !CLAUSE_MARKS.test(gap.slice(firstSec))) continue
      out.push({ ln: i + 1, trig: before[gi], gap, sec: m[1], explicitThis })
    }
  })
  return out
}
const blindRefs = c16BlindRefs(planLines() ? planLines().join('\n') : '')
/**
 * 读 C16 的**正则原文**并与本腿的副本比对（原文改了而这里不知道 ⇒ 假护）。
 *
 * ⚠ 本函数第一版**抓错了正则**（实测踩到，是「对拍打错靶」的同型）：
 *   原来用 `/for \(const m of l\.matchAll\((\/.*?\/g)\)\)/` 全文件找**第一个** matchAll，
 *   而那个 loop 里第一个 matchAll 是 **C8 的**（`_check-consistency.mjs:230`，形如 § 加数字的全局正则）
 *   ⇒ 比对结果恒为「副本过期」，本腿**结构性恒红**、且报的是**错的那条判据**。
 *   ⇒ 改为**先定位 C16 段**（按注释文本），再在段内取正则；取不到就返回 null（=未判定，
 *     由调用方报「未判定」而不是编一个结论）。同一纪律：**锚点必须锚到被判对象本身**。
 */
function readC16PatternFromDoc() {
  try {
    const src = readFileSync(P('docs/_check-consistency.mjs'), 'utf8')
    const at = src.indexOf('C16 本册内部')
    const scope = at >= 0 ? src.slice(at) : src
    const m = scope.match(/matchAll\((\/(?:[^/\\]|\\.)*\/[gimsuy]*)\)/)
    return m ? m[1] : null
  } catch { return null }
}
{
  const id = 'C16-GUARD'
  const title = 'C16 致盲形态守卫：触发词与 § 之间不得有内容（对**本册内部**引用）'
  const docPattern = readC16PatternFromDoc()
  const docErr = []
  if (!docPattern) docErr.push('**未判定**：读不到 docs/_check-consistency.mjs 里 C16 的正则原文（文件被改名/移动）')
  else {
    let docRh = null
    try { docRh = new RegExp(docPattern.replace(/^\//, '').replace(/\/g$/, '')) } catch { docRh = null }
    if (!docRh) docErr.push(`**未判定**：原文正则不可解析：${docPattern}`)
    else if (docRh.source !== C16_RX.source) {
      docErr.push(`**副本过期**：原文 = ${docPattern} ／ 本腿副本 = /${C16_RX.source}/g ⇒ 本腿护的不是当前判据（先同步再谈绿）`)
    }
  }
  // `c16BlindRefs` 已把「间隔含『方案』」的情形按正确写法排除（规则③）⇒ 此处直取，不再二次过滤
  const byLine = blindRefs
  const pts = byLine.map((x) => `L${x.ln}「${x.trig}${x.gap}§${x.sec}」`.replace(/\s+/g, '·'))
  const guardScope =
    `扫描范围：${planLines() ? planLines().length : 0} 行全册；判据口径 = 触发词与 § 之间非空、**不含**分句标记与「方案」、非枚举串、且顶级号属本册（或显式带「本册」）`
  const evidence =
    '主持人已两态复现（派单原文）：`按 §6.4` ⇒ C16 报红；`按**** §6.4` ⇒ exit=0 / C16 PASS；' +
    '且 `按 §?6.4` 式的改写**证实**调用 _check-consistency 也不能替代本腿（C16 对 §N.M 才做存在性校验，对顶级 §N 不看存在性）'
  const detail = `${guardScope}｜致盲引用 ${byLine.length} 处${pts.length ? '：' + pts.join(' / ') : ''}｜C16 正则副本核验：${docErr.length ? docErr.join('；') : '与原文同源'}`
  if (byLine.length) {
    fail(id, title, `${detail}｜⇒ 这些引用**完全不进入 C16 匹配**（「判据绿」会是「看不见」而非「已解析」）`, evidence)
  } else if (docErr.length) {
    // ⚠ 不写成 PASS：正则副本是否同源**未判定**时，绿只能读成「眼下没发现致盲引用」，
    //   不能读成「本腿在护当前判据」—— 这正是本仓「判不了不等于通过」的口径。
    hang(id, title, `${detail}｜⇒ 0 处致盲引用，但**副本同源性未判定** ⇒ 本腿的保护范围未知（不得读成「已护住」）`, evidence)
  } else {
    pass(id, title, `${detail}｜⇒ 0 处致盲引用，且本腿副本与原文同源`, evidence)
  }
}

// ══ 附加腿：全仓 lib 产物新鲜度（挂账状态，可用 --require-fresh-artifacts 升级为 FAIL）══
{
  const id = 'ARTIFACTS'
  const title = '全仓 lib 产物新鲜度（过期产物会让「按包名解析」的判据测到旧代码）'
  const stale = []
  const missing = []
  const contentFail = []
  const contentUnknown = []
  const contentOk = []
  let contentMs = 0
  let contentFiles = 0
  for (const pkg of readdirSync(P('packages'))) {
    const srcDir = P('packages', pkg, 'src')
    const libEntry = P('packages', pkg, 'lib')
    if (!existsSync(srcDir)) continue
    // ⚠ 递归收集（含 `src/client/` 这类子目录）—— 旧的非递归实现会漏掉它们，
    //    实测：`touch packages/ui/src/client/index.ts` 后本项不报 ui 过期（见 collectTsFiles 注释）。
    const srcs = collectTsFiles(srcDir)
    if (!srcs.length) continue
    if (!existsSync(join(libEntry, 'index.js'))) {
      missing.push(`packages/${pkg}`)
      continue
    }
    const maxSrc = Math.max(...srcs.map((f) => statSync(f).mtimeMs))
    if (statSync(join(libEntry, 'index.js')).mtimeMs < maxSrc) {
      stale.push(
        `packages/${pkg}（src ${new Date(maxSrc).toISOString().slice(11, 19)} → lib ${new Date(statSync(join(libEntry, 'index.js')).mtimeMs).toISOString().slice(11, 19)}）`,
      )
    }
    /**
     * ⚠ **主判定是内容腿，不是上面那条 mtime 腿**（F-04a，本仓「代理指标非判据」的落点）：
     *   mtime 腿保留为**快速提示**（它便宜、能在报告里直读时刻），但它**无牙** ——
     *   `cp`（不带 -p）把旧产物换回来会让 mtime = NOW ⇒ mtime 腿报「新鲜」而现实是旧实现。
     *   内容腿把当前 src **重新编译**一遍再逐字节比 ⇒ 伪造 mtime 不再能改变结论。
     */
    const cv = artifactVerdict(pkg)
    contentMs += cv.ms
    contentFiles += cv.files
    if (cv.state === 'FAIL') contentFail.push(`packages/${pkg}：${contentBad(cv)}`)
    else if (cv.state === 'unknown') contentUnknown.push(`packages/${pkg}：${contentBad(cv)}`)
    else contentOk.push(pkg)
  }
  const parts = []
  if (missing.length) parts.push(`无产物：${missing.join(', ')}`)
  if (stale.length) parts.push(`mtime 腿报过期：${stale.join(' · ')}`)
  if (contentFail.length) parts.push(`内容腿红：${contentFail.join(' · ')}`)
  if (contentUnknown.length) parts.push(`内容腿未判定（**不是一致**）：${contentUnknown.join(' · ')}`)
  const contentSummary =
    `内容腿：${contentOk.length}/13 包逐字节一致（${contentFiles} 个产物文件；重编 ${contentMs}ms，仓内 lib 零写入）` +
    (contentFail.length ? `｜**${contentFail.length} 包不一致**` : '')
  if (!parts.length) pass(id, title, `${contentSummary}；mtime 腿同为新鲜（无过期、无缺产物）`, '')
  else {
    /**
     * ⚠ **文案与标题必须同义**（本仓 2026-09-25 实测的自相矛盾）：
     *   此前的 detail 写「过期产物**不改变任何判据的绿**」，而标题同一行写着
     *   「过期产物**会让**「按包名解析」的判据测到旧代码」—— 读者相信哪一句取决于读到哪。
     *   两句话各对一半，合成一个假象：**必须说准「什么变、什么不变」**，且**按内容腿的
     *   实际状态**说（F-04a 之后主判定是内容腿，不是那条会被 cp/touch 摆布的 mtime 腿）：
     *     · **不变**：本报告自己的绿/红（本项是挂账态，判据腿照旧跑、照旧判）；
     *     · **变**：**按包名解析到 `lib/` 的那些判据**测的是旧实现 ⇒ 它们的绿不再证明「真源正确」。
     *     · **内容腿绿而 mtime 腿报旧**：那是 **mtime 的假红** —— 不得据此说「产物过期」
     *       （内容层证据强于 mtime；这正是把主判定改成内容的原因）。
     *   故下面**点名受影响 id**，而不是留一句含糊的「都会吃到旧实现」。
     *
     * 受影响面由 S7 席本轮按**静态解析路径**逐批复核（不是引用他席结论）：
     *   · chain-e2e / injection-gate / assembly / ui 装配腿：`ctx.loader.create({name})` +
     *     `baseUrl` ⇒ 按包名 → `package.json main` → `lib/index.js` ⇒ **受影响**；
     *   · W2-5：`import.meta.resolve(pkg)` + `await import(pkg)`（a1-check.mjs:471/477）⇒ **受影响**；
     *   · 仓外 `tools/r0-assembly-check.mjs`（`:217` 按包名装全 13 包）⇒ **受影响**；
     *   · lexical-audit 直 `import('../src/index.ts')`（`:29`）、a1-check 的 A1-4/11/12 腿直
     *     `import(packages/<pkg>/src/<file>.ts)`（`SRC` 常量 `:80`）⇒ **不受影响**（白盒）。
     * ⚠ 本段**不得出现星号加斜杠**的字符组合（哪怕在注释里）：它会提前终止块注释、
     *   把后面的释义变成代码（本轮实测踩到，`ReferenceError: src is not defined`）。
     */
    const affectedNote =
      '解析型受影响面：A1-1 / A1-2 / A1-6 / A1-13 / A1-14 / P5-UI / W2-5 + 仓外 tools/r0-assembly-check.mjs；' +
      '白盒型（直 import packages/*/src/*.ts）不受影响：A1-4 / A1-8 / A1-9 / A1-10 / A1-11 / A1-12；' +
      'A1-5 已接真核并按内容判（本轮转 PASS）、W-1..3 与 lib 无关'
    const consequence = contentFail.length
      ? '内容腿红 = 产物**不是当前 src 编出来的**（不是「旧」这种代理读数，是字节不等）⇒ 那时按包名解析到 lib/ 的判据测的是旧实现、它们的绿不构成「真源正确」的证据。' + affectedNote
      : contentUnknown.length
        ? '内容腿**未判定** ⇒ 「产物是否出自当前 src」**未知**（不得读成一致；逐包原因见上）。' + affectedNote
        : '内容腿全一致 ⇒ 产物确由当前 src 产出；上面 mtime 腿报的「过期」是 **mtime 的假红**（mtime 是代理指标，内容层证据更强），本轮**不存在**产物过期这回事。' + affectedNote
    const detail = `${contentSummary}｜${parts.join('；')}｜⚠ 后果要说准：本项**仍是挂账态**（档位语义不变，判据腿照旧）—— ${consequence}`
    const evidence =
      '挂账≠通过：本项不改判任何绿，但**必须有人看** —— 受影响面清单由 S7 席按**静态解析路径**逐批复核' +
      '（chain-e2e / injection-gate / assembly 装配腿用 ctx.loader.create(baseUrl) 按包名加载；' +
      'W2-5 走 import.meta.resolve + import(pkg)；a1-check 的 SRC 腿与 lexical-audit 直指 src ⇒ 不在受影响面）'
    if (REQUIRE_FRESH) fail(id, title, detail, '跑一次工作区 build 后复跑；或本项保持挂账并显式记录')
    else
      hang(id, title, detail, evidence, {
        token: 'ARTIFACTS',
        crit: null,
        implBatch: null,
        note: '原定验收阶段 = **待补**：本册 §3.1 / §4 只把「产物是否出自当前 src」当**各批次的构建前置**，未给它立独立验收条 ⇒ 不编阶段号（这一点本身即缺口，见 handoff 未决项）',
      })
  }
}

// ── 判据项集等式（**双向**：缺项红、多项也红）────────────────────────────────
/**
 * ⚠ 为什么必须有这一腿（本会议 2026-09-24 实测的判红事实）：
 *   本脚本此前只用 `results.length` **打印**计数，没有任何「期望项集」断言 ⇒
 *   复核席把 A1-11 整块（3108 字节）删掉后，脚本仍输出「共 5 项 · ✅ 无 FAIL」并 **exit 0**
 *   （本席已在 /tmp 副本复现，见 handoff 记录）⇒ 判据块可以整块消失而无人报警，
 *   正是最该防的「让失败不可观测」形态。
 *   对照同仓既有做法：`packages/vector/tests/gate.mjs:20` 的 `EXPECTED_CASES = 15`
 *   与 `packages/jev/tests/gate.mjs` 的逐文件等式，用的都是**等式**而非下界。
 *
 * ⚠ 也不许写成 `results.length === 6` —— 那是**弱形态**：删一项再加一项仍过。
 *   必须**集合相等**（按 id 逐项对拍），失败消息点名缺了/多了哪个 id。
 *
 * ⚠ 本腿是**元判据**，不进 `results`（判定项集必须恰好是 EXPECTED_IDS 这 6 项，
 *   报告里的「共 N 项」也就是判据项数，不得被元判据灌水）。
 */
const EXPECTED_IDS = [
  'A1-1', 'A1-2', 'A1-4', 'A1-5', 'A1-6', 'A1-8', 'A1-9', 'A1-10', 'A1-11', 'A1-12',
  'A1-13', 'A1-14', 'ARTIFACTS', 'W2-5', 'W-1..3', 'P5-UI',
  // ⚠ 加固 2 新加的**腿**，不是新的 A1 判据项：它判的是「C16 这条判据会不会被致盲」。
  //   项数 16 → 17 是**声明集与实测集同步 +1**，不是判据项增删（A1 判据项仍 16 条）。
  //   ⚠ 该变化会走进 a0-check 的 A1 腿（它读本脚本自报的期望项数做三方交叉核对，不另存清单）
  //     ⇒ a0 侧自动跟随，无需改 a0（改了反而会造出第二份清单）。
  'C16-GUARD',
]
const ids = results.map((r) => r.id)
const missingIds = EXPECTED_IDS.filter((x) => !ids.includes(x))
const extraIds = [...new Set(ids)].filter((x) => !EXPECTED_IDS.includes(x))
const dupIds = [...new Set(ids)].filter((x) => ids.filter((y) => y === x).length > 1)
const itemSetProblems = []
if (missingIds.length)
  itemSetProblems.push(`缺 ${missingIds.length} 项：${missingIds.join(', ')}（判据块被删或被条件短路 ⇒ **该项从未被判**）`)
if (extraIds.length)
  itemSetProblems.push(`多 ${extraIds.length} 项：${extraIds.join(', ')}（期望集外的 id ⇒ 偷偷加判据，或新判据漏登记进 EXPECTED_IDS）`)
if (dupIds.length) itemSetProblems.push(`重复 ${dupIds.length} 项：${dupIds.join(', ')}（同一 id 记两次会让计数虚高，掩盖真缺失）`)
const itemSetOk = itemSetProblems.length === 0
const itemSetDetail = `期望 ${EXPECTED_IDS.length} 项 [${EXPECTED_IDS.join(',')}] ／ 实测 ${results.length} 项 [${ids.join(',')}]`
/**
 * ── 项集等式自检（加固 3）────────────────────────────────────────────────────
 * ⚠ 上面的 `EXPECTED_IDS` 是**代码内常量**：若有人同时改常量与实现，两侧一起漂，
 *   「判据项集变了」这件事在报告里**不可见**。故这里把**显式差集**做成字段与一行输出：
 *     `itemSet.seen` / `itemSet.expected` / `itemSet.missing` / `itemSet.extra` / `itemSet.dupes`
 *   —— 与既有 `missingIds/extraIds/dupIds` 同源（不是第二份实现），只是**显式落到 JSON 与 stdout**。
 * ⚠ 现有项集腿**不削弱**（仍是集合相等、仍点名具体 id）；这是加法。
 */
const itemSet = {
  expected: EXPECTED_IDS,
  seen: ids,
  missing: missingIds,
  extra: extraIds,
  dupes: dupIds,
  counts: { expected: EXPECTED_IDS.length, seen: ids.length },
  problems: itemSetProblems,
  ok: itemSetOk,
}
/** 差集非空即 FAIL —— 一行，机读与人读同一来源。 */
const itemSetDiffLine =
  `项集：期望 ${EXPECTED_IDS.length} / 实测 ${ids.length} / 差集 [${[...missingIds.map((x) => '-' + x), ...extraIds.map((x) => '+' + x), ...dupIds.map((x) => '×' + x)].join(',')}]` +
  (itemSetOk ? ' ⇒ 相等（无缺项/多项/重复项）' : ' ⇒ **不等**（缺 = 期望里有而实测没有；+ = 实测多出；× = 重复）')

// ── 变异自证腿（预注册：注入的项**必须**红、且不得误伤别的项）───────────────────
// ⚠ 这一腿是 `--mutate` 的全部意义：没有它，`--mutate` 只是一段会打印字的代码。
let harnessFail = false
const selfCheck = []
/** 本次变异实际涉及的取证范围（`git status` 快照命令据它渲染 —— 见 `mutationEvidenceFiles`）。 */
const SNAPSHOT_FILES = []
/**
 * 「变异是否真被注入」的**判定函数**（加固 2 的 `--self-test` 要对拍它，故抽成具名函数——
 * 内联三元表达式无法被两态调用）。
 *
 * ⚠ 这一行**本身曾是缺陷现场**（2026-09-25 实修）：旧写法是
 *   `mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)` —— **两个分支字面相同**，
 *   selfKernel 分支是**死功能**；而唯一走它的 `a1-5` 其登记又写在**请求标志**上（恒真）
 *   ⇒ 这条腿永远绿且**不可能**红。故 `--self-test` 的 `mutation-branch` 用例
 *   直接调本函数、用**合成输入**做出「两分支必须给出不同答案」的对照。
 */
const mutationInjected = (mt, m, selfSet = selfApplied, mutSet = mutApplied) => {
  // ① 判据内联核变异（无克隆体可比）：唯一证据是"数变了"。
  if (mt.selfKernel) return selfSet.has(m)
  // ② 实现变异的第一重证据：克隆体真被写出来并加载（锚点恰好命中一次）。
  if (!mutSet.has(m)) return false
  // ③ 实现变异的第二重证据（仅 `numberWitness` 声明的变异器要求）：
  //    "克隆体加载了"**不等于**"判据真的读了它" —— 判据若退回内联闭式，第一重仍为真而本项照样恒绿。
  if (mt.numberWitness === true) return selfSet.has(m)
  return true
}
/**
 * 变异的**取证文件集**（单一真源：变异器声明的包 + 同包附属件）。
 *
 * ⚠ 为什么必须按 `pkg` 分流（本轮实修）：旧写法在变异跑前/跑后一律
 *   `git status --porcelain packages/vector packages/jev` —— 那是**实现变异只落在 vector** 时代的
 *   取证口径。本轮的 A1-5 变异打在 `packages/long-term/**` ⇒ 若仍只查 vector/jev，
 *   「变异期真核被写坏」这件事**不可见**，而取证行照样打印（比不取证更坏）。
 * ⚠ 只查 `pkg` 而不查全 `packages`：本仓并行席多，全包状态**会因他席在途件而波动** ⇒
 *   那是假红源。本项只声明自己碰得到的那一个包。
 */
const mutationEvidenceFiles = (mt) => {
  const pkgs = [mt.pkg ?? 'vector', ...(mt.also ?? []).map((x) => x.pkg ?? 'vector')]
  return [...new Set(pkgs)].map((p) => `packages/${p}`)
}
/**
 * ⚠ 两个登记集是**可注入参数**（默认仍是本进程真实的那两个）：这不是为测试开后门，
 *   而是让「两分支会不会给出不同答案」**可被离线两态检验**——
 *   不给参数时本函数闭包到的是**真实的空集**（非 `--mutate` 运行时两集都空），
 *   于是一个只喂合成 id 的用例**永远拿不到 true**，会变成结构性假红
 *   （本席第一版正是这样：`mutation-branch` 报『selfKernel=true/已登记 ⇒ false（须 true）』，
 *   错的是用例的输入，不是被测代码）。**判据自身出假红，与出假绿同样要修** ——
 *   只不过修法是补足输入，不是放宽断言。
 */
if (MUTATES.size) {
  for (const m of MUTATES) {
    const mt = MUTATORS[m]
    if (!mt) continue
    const tgt = results.find((r) => r.id === mt.target)
    /**
     * 「变异是否真被注入」——**两条判定路径本就不同**（本仓 2026-09-25 实测：
     * 此前这里写的是 `mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)`，
     * 两个分支字面相同 ⇒ 自证分支是**死功能**，分支形式还在，语义已经丢了）。
     *
     * · **判据内联核变异**（`selfKernel:true`）：变异打在**本脚本自己的内联核**上，
     *   这条路径**不经 `loadCloned()`** ⇒ 不依赖 `mutApplied`，基准是"数变了"。
     *   ⚠ **当前无变异器使用它**（A1-5 转 PASS 后改打真核）—— 分支保留是为了
     *     `--self-test` 的 `mutation-branch` 用例仍能对"两分支是否同源"做两态检验。
     * · **实现变异**（A1-4 / A1-11 / A1-12 / **A1-5 的两条**）：必须经 `loadCloned()` 真读源文件、
     *   真替换、真写克隆副本，并在成功后把 mutId 记进 `mutApplied`。锚点未命中会在
     *   `loadCloned()` 里抛错，若那条错误被吞掉，就会走到这里 ⇒ **不检查登记等于把"没注入"读成"注入了"**。
     * · **`numberWitness:true` 的变异器**（A1-5 两条）**两重证据都要**：克隆体加载 ✅ **且**
     *   该项算出来的数确实变了 ✅。理由见 `selfApplied` 的注释（"加载了"≠"判据读了它"）。
     *
     * ⇒ 三条路径的判据各不相同，不是同一个条件（这正是原死分支想表达而没写成的东西）。
     * ⚠ 登记是**全局**的：同一个变异器若出现在两处、第二处被锚点过期弄失败，
     *   全局登记仍为真 ⇒ 这一腿只能证明"至少注入过一次"，故另有下面的重复变异器闸（exit 2）。
     */
    const injected = mutationInjected(mt, m)
    if (!injected) selfCheck.push(`${m}：变异**未真正注入**（锚点未命中或未加载克隆体）⇒ 本次运行不能作为自证`)
    SNAPSHOT_FILES.push(...mutationEvidenceFiles(mt))
    if (tgt && tgt.state !== 'FAIL') selfCheck.push(`${m}：被注入的 ${mt.target} 实测 ${tgt.state}（**应 FAIL**）⇒ 该项判据无牙`)
    for (const r of results) {
      if (r.state === 'FAIL' && r.id !== mt.target) selfCheck.push(`${m}：误伤 ${r.id}（应为 PASS/HANG/NONE）⇒ 变异不隔离`)
    }
  }
  if (selfCheck.length) harnessFail = true
}

/**
 * ⚠ 留档点**必须在 `results` 与 `harnessFail` 都已定稿之后、`// ── 输出` 之前**：
 *   早了 `results` 还是空的（留档里 items=[] ⇒ 看起来像「没有 FAIL」，比不落盘更坏）；
 *   晚了则被 `--json` 分支的提前打印越过（JSON 里那个字段会是初始空对象）。
 *   ——本席第一版正是放晚了，整份报告在第 1919 行被 `ReferenceError: Cannot access 'failureDump'` 截断，
 *   而 exit code 只有 1、stdout 停在半句话上：那是**比不落盘更坏**的形态，故此处写明位置约束。
 */
/**
 * 退出码**先算出来**（K1 件 3 的留档要记它，且不许记成 `null`）。
 * ⚠ 单一真源：下面的赋值直接用它，不重写一遍表达式（两处各写一遍必然漂）。
 */
/**
 * ⚠ 册行号腿（`planRefsOk`）**必须进退出码**：本席反证对拍实测踩到 ——
 *   第一版只把它挂进 `gateOk`，于是「门不通过：册行号腿」时 `exit` 仍是 **0**：
 *   自动化侧（CI / a0-check 的 A1 腿 / 任何读退出码的人）看到的全是成功。
 *   那正是本仓最忌的「让失败不可观测」，故与 `itemSetOk` 同等对待（都是元检查腿）。
 */
const FINAL_EXIT = harnessFail ? 3 : !itemSetOk || !planRefsOk || results.some((r) => r.state === 'FAIL') ? 1 : 0
const FAILING_ITEMS = results.filter((r) => r.state === 'FAIL')
const RAW_FAILS = RAW_RUNS.map((r) => ({ ...r, notOk: extractNotOk(r.out) })).filter((r) => r.notOk.length > 0)
/** 落盘判据：**有失败就落**。两类失败都算 —— 判据项 FAIL，或变异自证腿不过（后者更坏但有同样的归因需求）。 */
const failureArchive = FAILING_ITEMS.length > 0 || harnessFail
let failureDump = { archived: false, path: null, writeError: null, bytes: null, items: [], notOk: 0, files: [] }
if (failureArchive) {
  const payload = {
    kind: 'mana-a1-check-failure-dump',
    at: COORD.at,
    coord: COORD,
    argv: process.argv.slice(2),
    exitCode: FINAL_EXIT,
    mutates: [...MUTATES],
    harnessFail,
    selfCheck,
    items: FAILING_ITEMS,
    itemSet: { ok: itemSetOk, missing: missingIds, extra: extraIds, dupes: dupIds },
    planRefs: { ok: planRefsOk, problems: [...PLAN_REF_PROBLEMS] },
    raw: RAW_FAILS,
  }
  const w = writeFailureDump(payload)
  failureDump = {
    archived: w.path !== null,
    path: w.path,
    writeError: w.writeError,
    bytes: w.path ? statSync(w.path).size : null,
    items: FAILING_ITEMS.map((r) => r.id),
    notOk: RAW_FAILS.reduce((a, r) => a + r.notOk.length, 0),
    files: RAW_FAILS.map((r) => `${r.file}×${r.notOk.length}`),
  }
}
// ── 输出（用法闸已在文件头部执行：走到这里说明参数合法）───────────────────────
const order = { FAIL: 0, HANG: 1, NONE: 2, PASS: 3 }
results.sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id))
const n = { PASS: 0, FAIL: 0, HANG: 0, NONE: 0 }
for (const r of results) n[r.state] += 1

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        coord: COORD,
        mutates: [...MUTATES],
        itemSet,
        itemSetDiff: itemSetDiffLine,
        // K1：引用锚点腿与失败留档的位置——机读侧也要看得到（否则只有人读 stdout 才知道）。
        planRefs: { ok: planRefsOk, detail: planRefsDetail, problems: [...PLAN_REF_PROBLEMS], lineMap: Object.fromEntries(PLAN_REF_IDS.map((x) => [x, critAnchor(x)?.line ?? null])) },
        failureDump,
        mutationSelfCheck: { ok: !harnessFail, problems: selfCheck },
        results,
      },
      null,
      2,
    ),
  )
} else {
  console.log('══════ Mana 阶段 1 验收判据机检（A1-4 / A1-5 / A1-11 / A1-12 + W2-5）══════')
  console.log(`共 ${results.length} 项：PASS ${n.PASS} · FAIL ${n.FAIL} · 挂账 ${n.HANG} · 无实现者 ${n.NONE}`)
  if (MUTATES.size) {
    for (const m of MUTATES) {
      const mt = MUTATORS[m]
      console.log(`⚗ 变异模式：--mutate ${m} ⇒ ${mt ? `${mt.file ?? '(判据内联核)'}：${mt.why}` : '**未知变异器**'}`)
    }
    console.log('  （内存克隆注入，源文件零写入；被注入的项必须变红，其余项不受影响）')
    console.log(`  取证（跑前/跑后各跑一次、输出须逐字相同）：git status --porcelain ${[...new Set(SNAPSHOT_FILES)].join(' ')}`)
  }
  console.log('（挂账 ≠ 通过；无实现者 = 本项无仓内实现可测，只证判据锚点）')
  // 加固 3：项集差集**每次运行都印一行**（不看门判定段也能读出差集非空）
  console.log(itemSetDiffLine + '\n')
  for (const r of results) {
    const mark = r.state === 'PASS' ? '  PASS' : r.state === 'FAIL' ? '✗ FAIL' : r.state === 'HANG' ? '  HANG' : '  NONE'
    console.log(`${mark}  [${r.id}] ${r.title}`)
    console.log(`        ${r.detail}`)
    if (r.evidence) console.log(`        依据: ${r.evidence}`)
  }
  /**
   * ⚠ 顺序有讲究（本会议 2026-09-24 复核席实测的缺陷）：变异自证腿的结果**必须先打印**，
   *   门判定段**最后**打印。旧版把 `✅ 门通过` 印在 `✗ …无牙` 之前 —— 只读「门判定」段的
   *   人会看到通过而漏掉「判据无牙」这条更坏的消息（判据无牙 = 它绿也不可信）。
   *   现在：门判定段在最后，且 harnessFail 时**不允许**出现「门通过」字样。
   */
  if (MUTATES.size) {
    console.log(`\n──── 变异自证腿（预注册：注入项必须红、且不得误伤别项）────`)
    if (!harnessFail) console.log(`  ✅ 全部通过：${[...MUTATES].map((m) => `${m}→${MUTATORS[m]?.target} 红`).join(' · ')}；其余项状态不变`)
    else {
      for (const s of selfCheck) console.log(`  ✗ ${s}`)
      console.log('  ⇒ 变异自证腿**不通过**：本次运行的「无 FAIL」不构成通过依据（判据可能无牙）')
    }
  }
  const gateOk = itemSetOk && n.FAIL === 0 && !harnessFail && planRefsOk
  const gateWhy = [
    n.FAIL ? `${n.FAIL} 项 FAIL` : '',
    itemSetOk ? '' : '项集等式不等',
    planRefsOk ? '' : '册行号腿：引用锚点未判定',
    harnessFail ? '变异自证腿不通过（判据无牙）' : '',
  ].filter(Boolean)
  console.log(`\n──── 门判定（判据腿 + 项集腿${MUTATES.size ? ' + 变异自证腿' : ''}，**都要过**）────`)
  if (n.FAIL === 0) console.log(`  ✓ 判据腿：无 FAIL${n.HANG ? `（另有 ${n.HANG} 项挂账，挂账≠通过）` : ''}${n.NONE ? `（另有 ${n.NONE} 项无实现者可测）` : ''}`)
  else console.log(`  ✗ 判据腿：有 ${n.FAIL} 项 FAIL`)
  if (itemSetOk) console.log(`  ✓ 项集腿：期望 == 实测（${EXPECTED_IDS.length} 项逐 id 在册）`)
  else console.log(`  ✗ 项集腿：${itemSetProblems.join('；')}`)
  console.log(`  ${itemSetDetail}`)
  console.log(`  ${itemSetDiffLine}`)
  // ⚠ 册行号腿（K1 件 2）**在门判定段里可读**：引用锚点不成立 ⇒ 那些「依据」不可复核 ⇒ 门不通过。
  //   它不进 results（不是判据项），但**必须与项集腿并列可见**，否则锚点漂移只在报告角落一闪而过。
  console.log(`  ${planRefsOk ? '✓' : '✗'} ${planRefsDetail}`)
  if (MUTATES.size) console.log(`  ${harnessFail ? '✗' : '✓'} 变异自证腿：${harnessFail ? '不通过（见上）' : '注入项皆红、其余项未误伤'}`)
  /**
   * K1 件 3 的**可发现性**：留档写在哪、怎么读回来，必须印在报告里。
   * ⚠ 只在「有失败」时印（全绿时印一条空路径只会变成噪声，最后没人看）。
   * ⚠ 失败留档**不等于**门不通过（它是归因通道，不是判据）；这里只做如实报告。
   */
  if (failureArchive) {
    console.log(
      failureDump.archived
        ? `  ⤓ 失败留档：${failureDump.path}（${failureDump.bytes} B；判据项 FAIL ${failureDump.items.length} 个 [${failureDump.items.join(', ')}]` +
          `${failureDump.notOk ? `；原始 TAP not ok ${failureDump.notOk} 条（${failureDump.files.join(' / ')}）` : '；**原始 TAP 里 0 条 not ok**（失败不在跑出来的 TAP 里 ⇒ 别去那找原因）'}` +
          `）⇒ 回读：node tools/a1-check.mjs --print-failure-dump`
        : `  ⚠ 失败留档**写失败**（${failureDump.writeError}）⇒ 本次运行的失败明细**没有留存**（这不是判据红，是归因通道坏了）`,
    )
  }
  console.log(`\n${gateOk ? '✅ 门通过' : `❌ 门不通过：${gateWhy.join(' + ')}`}`)
  // ⚠ 门被拒时**把留档路径再点一次名**：走到这里的人多半已经只读最后一段了。
  if (!gateOk && failureDump.archived) console.log(`  ⤓ 失败留档（含 not ok 全文与坐标）：${failureDump.path} ⇒ node tools/a1-check.mjs --print-failure-dump`)
}

// ── 退出码 ──────────────────────────────────────────────────────────────────
// 用法错 ⇒ 2（在文件头 fail-fast，**不跑判据腿、不产生报告**）；
// 变异自证腿不过 ⇒ 3（判据无牙 = 比判据红更坏的形态）；项集等式红 / 有 FAIL ⇒ 1；否则 0。
process.exitCode = FINAL_EXIT // 值与上面留档记的那个是**同一个**（单一真源）

// 收尾：删本次创建的临时克隆目录（逐个删；本脚本不写仓内任何文件）
for (const d of createdDirs) {
  try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ══ `--self-test`：判据器自测表（加固 2）════════════════════════════════════
/**
 * ⚠ **为什么自测不能只看那三条腿自己的读数**：本脚本里已经修过**两处「形式还在、语义已丢」**
 *   （变异自证腿的死分支、夹具自证）—— 它们的共同形态是：**腿还在跑、也没报错，只是不可能红**。
 *   只看「腿这次绿了」永远发现不了这种缺陷，因为那正是缺陷的表现形式。
 *   ⇒ 这里把「腿**会不会红**」本身变成可机检的两态表：每个用例都给出
 *     **扰动输入 → 必须红** 与 **干净输入 → 必须绿** 两侧，缺一侧即判该用例无牙。
 *
 * ⚠ 本模式**不新增判据项**（逐用例结果打在独立段，不进 `results` ⇒ 项集等式不受影响）。
 * ⚠ 它会**先跑完整判据腿**（依赖 itemSet / 变异自证腿的实算结果）⇒ 耗时与一次全量相当，
 *   这是刻意的：自测表要对的靶是**本次运行真的算出来的**东西，不是另写一份期望值。
 * ⚠ 退出码：全部用例 PASS ⇒ 0；任一用例不能两态 ⇒ 3（与「变异自证腿不过」同码：**判据无牙**）。
 */
if (argv.includes('--self-test')) {
  const cases = []
  const caseAdd = (name, ok, detail) => cases.push({ name, ok, detail })

  // ① C16 副本同源：本腿护的正则 == docs/_check-consistency.mjs 里的原文
  {
    const p = readC16PatternFromDoc()
    const wantSrc = C16_RX.source
    let gotSrc = null
    if (p) { try { gotSrc = new RegExp(p.replace(/^\//, '').replace(/\/([a-z]*)$/, '')).source } catch { gotSrc = null } }
    caseAdd(
      'c16pattern',
      gotSrc !== null && gotSrc === wantSrc,
      gotSrc === null
        ? `**不能两态**：读不到原文正则（${p === null ? '文件缺失/正则不匹配' : p}）⇒ 本腿在护什么无法判定`
        : `原文=${gotSrc} ／ 副本=${wantSrc} ⇒ ${gotSrc === wantSrc ? '同源' : '**副本已漂**（本腿护的不是当前判据）'}`,
    )
  }

  // ② C16 致盲探测器的**两态**（离线合成输入，不碰文档）
  {
    const clean =
      '## 2. 批次\n## 6. 阈值\n\n> 读 §3.1 找到你的批次号，再按 §6 查阈值。\n| 见 §8 C8 |\n| 按方案 §6.4 原样实现必然不可达 |'
    const dirty = clean + '\n> 按**X** §6.1 与 跳到 §2 都要被发现。'
    const a = c16BlindRefs(clean)
    const b = c16BlindRefs(dirty)
    const hit = b.filter((x) => x.ln === 7)
    caseAdd(
      'c16guard-twostate',
      a.length === 0 && hit.length === 2 && hit.some((x) => x.gap === '**X** ') && hit.some((x) => x.gap === '到 '),
      `干净输入命中 ${a.length} 处（须 0：「按方案 §6.4」是正确写法、不得误伤；「读 §3.1」「按 §6」是 C16 看得见的正形）／扰动输入 L7 命中 ${hit.length} 处（须 2：gap 分别为 **X**␣ 与 ␣到␣）⇒ ${a.length === 0 && hit.length === 2 ? '两态可分辨' : '**不能两态**（探测器无牙）'}`,
    )
  }

  // ③ 项集差集：字段 → 那一行输出必须**逐字可复算**（防手写文案与字段漂开）
  {
    const redrive =
      `项集：期望 ${itemSet.counts.expected} / 实测 ${itemSet.counts.seen} / 差集 [${[...itemSet.missing.map((x) => '-' + x), ...itemSet.extra.map((x) => '+' + x), ...itemSet.dupes.map((x) => '×' + x)].join(',')}]` +
      (itemSet.ok ? ' ⇒ 相等（无缺项/多项/重复项）' : ' ⇒ **不等**（缺 = 期望里有而实测没有；+ = 实测多出；× = 重复）')
    const consistent =
      redrive === itemSetDiffLine &&
      itemSet.ok === (itemSet.missing.length === 0 && itemSet.extra.length === 0 && itemSet.dupes.length === 0) &&
      itemSet.counts.seen === results.length &&
      itemSet.seen.length === results.length
    // 负向侧：合成一组含「缺/多/重复」的 id，确认**差集非空 ⇒ 该 FAIL** 的规则真的成立
    const syn = ['A', 'B', 'B', 'C']
    const synExpected = ['A', 'B', 'D']
    const synMissing = synExpected.filter((x) => !syn.includes(x))
    const synExtra = [...new Set(syn)].filter((x) => !synExpected.includes(x))
    const synDup = [...new Set(syn)].filter((x) => syn.filter((y) => y === x).length > 1)
    const synRed = synMissing.length + synExtra.length + synDup.length > 0
    caseAdd(
      'itemset-diff',
      consistent && synRed && synMissing.join() === 'D' && synDup.join() === 'B',
      `字段→输出行可逐字复算=${redrive === itemSetDiffLine}、ok 与差集同源=${itemSet.ok === (itemSet.missing.length + itemSet.extra.length + itemSet.dupes.length === 0)}、实测数与 results 一致=${itemSet.counts.seen === results.length}` +
        `｜负向侧合成 [A,B,B,C] vs 期望 [A,B,D] ⇒ 缺 ${synMissing.join()} / 多 ${synExtra.join()} / 重复 ${synDup.join()} ⇒ ${synRed ? '规则会判红' : '**规则恒绿**'}`,
    )
  }

  // ④ 变异注入判定：**两个分支必须给出不同答案**（旧缺陷是两分支字面相同 ⇒ 死功能）
  {
    const selfSet = new Set(['x'])   // 合成：「数变了」登记集
    const mutSet = new Set(['x'])    // 合成：「克隆体加载了」登记集
    const t1 = mutationInjected({ selfKernel: true }, 'x', selfSet, mutSet)   // ⇒ 必须 true（内联核：只认数变）
    const t2 = mutationInjected({ selfKernel: false }, 'x', selfSet, mutSet)  // ⇒ 必须 true（实现变异：两重都有）
    const f1 = mutationInjected({ selfKernel: true }, 'y', selfSet, mutSet)   // ⇒ 必须 false（内联核：y 未登记）
    const f2 = mutationInjected({ selfKernel: false }, 'y', selfSet, mutSet)  // ⇒ 必须 false（实现变异：y 克隆体未加载）
    // ── 第三态：**克隆体加载了、但数没变**（本轮新增，防「判据退回内联闭式」这种退化）──
    //    numberWitness 声明的变异器：只有 mutSet 有登记（selfSet 空）⇒ 必须判「未注入」。
    //    这条腿就是 selfApplied 不再「只写不读」的证据：若实现变异退回不消费 selfSet，下面这行会变 true。
    const w1 = mutationInjected({ selfKernel: false, numberWitness: true }, 'x', new Set(), mutSet)  // ⇒ 必须 false
    const w2 = mutationInjected({ selfKernel: false, numberWitness: true }, 'x', selfSet, mutSet)    // ⇒ 必须 true
    caseAdd(
      'mutation-branch',
      t1 === true && t2 === true && f1 === false && f2 === false && w1 === false && w2 === true,
      `selfKernel=true/数变了 ⇒ ${t1}（须 true）；实现变异/两重登记齐 ⇒ ${t2}（须 true）` +
        `｜**numberWitness 且「克隆体加载了但数没变」**（selfSet 空）⇒ ${w1}（须 false —— 这一态即「判据退回内联闭式」：克隆体加载成功却没人读它，旧写法会把它读成注入成功）／两重齐 ⇒ ${w2}（须 true）` +
        `｜合成登记集 self=${JSON.stringify([...selfSet])} / mut=${JSON.stringify([...mutSet])}` +
        `｜若代码回退成\`mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)\` 那种两分支同源的死形态，判定不再消费 selfSet ⇒ w1 会变 true ⇒ 本用例立刻红`,
    )
  }

  // ⑤ 挂账溯源：每个 HANG 都要答得出「首现时刻」与「原定验收阶段」
  {
    const hangs = results.filter((r) => r.state === 'HANG')
    const evals = hangs.map((r) => ({ id: r.id, ...provFieldsOf(r.detail) }))
    const missing = evals.filter((x) => !x.hasProv)
    const noWhen = evals.filter((x) => !x.hasFirst)
    const noTarget = evals.filter((x) => !x.hasTarget)
    /**
     * ⚠ **负向侧用合成输入，不打真数据**（这是本条腿能被否证的唯一方式）：
     *   「首现时刻字段被清空 ⇒ 报红」若只对**真** detail 断言，就必须真去改数据才能对拍 ——
     *   而改数据会把「判据红了」与「数据被改坏了」混成一件事。故这里对**同一判定函数**
     *   喂两条合成 detail：一条正常、一条把首现清成 `待补` ⇒ 后者必须被判红。
     */
    const goodSynth = 'x｜⏱ 挂账溯源：⏱ 首现 abc1234 (2026-09-25)（git log -S "x" 实测）｜判据表行 A1-5@L455（所在阶段段 = 阶段 1）｜实现/验收归属批次 B4.2@L547（阶段 3）'
    const badSynthFirst = goodSynth.replace('abc1234 (2026-09-25)', '**待补**（git 历史不可得）')
    const badSynthProv = 'x｜（只有一句话描述，没有溯源段）'
    const synTwoState =
      Object.values(provFieldsOf(goodSynth)).every(Boolean) &&
      provFieldsOf(badSynthFirst).hasProv && !provFieldsOf(badSynthFirst).hasFirst &&
      !provFieldsOf(badSynthProv).hasProv
    caseAdd(
      'hang-provenance',
      hangs.length > 0 && missing.length === 0 && noWhen.length === 0 && noTarget.length === 0 && synTwoState,
      `HANG ${hangs.length} 项 / 缺溯源段 ${missing.length}（${missing.map((x) => x.id).join(',') || '无'}）/ 首现被清空或缺失 ${noWhen.length}（${noWhen.map((x) => x.id).join(',') || '无'}）/ 缺原定验收阶段 ${noTarget.length}（${noTarget.map((x) => x.id).join(',') || '无'}）` +
        `｜**两态（合成输入，不动真数据）**：正常 detail ⇒ 三项全真；首现清成「待补」⇒ hasFirst 转假（即判红）；整段溯源缺失 ⇒ hasProv 转假 ⇒ ${synTwoState ? '两态可分辨' : '**不能两态**（本条腿恒绿）'}` +
        `｜⚠ 「原定验收阶段 = 待补」对 hasTarget **不算通过**：待补只在『原定验收阶段』那一栏作如实口径，而 hasTarget 要求的是「已给出归属（判据表行/归属批次/跨阶段/归期）」`,
    )
  }

  // ⑥ K1 件 2：册行号引用锚点的**两态**（现读命中 vs 现读不命中）
  {
    /**
     * ⚠ 要证的不是「这次 N 处都命中」（那只是眼下的事实），而是**「读不到时会不会报」**：
     *   若 `critAnchor()` 退化成「永远返回一个对象」，引用锚点腿就恒绿，
     *   而它绿的时候正是「册被改名/移动、所有依据都不可复核」的时候 —— 那是最坏形态。
     *   故用**确定不存在的判据 id** 合成扰动：它必须返回 null。
     */
    const goodHit = critAnchor('A1-9')
    const badHit = critAnchor('A1-99（合成扰动，本册不存在）')
    const twoState = badHit === null && goodHit !== null && Number.isFinite(goodHit.line)
    caseAdd(
      'planrefs-two-state',
      planRefsOk && twoState,
      `真实读数：${PLAN_REF_IDS.length} 处引用现读命中=${planRefsOk}` +
        `｜合成扰动（本册不存在的 id）⇒ ${badHit === null ? 'null ⇒ 会被记成「未判定」⇒ 该腿判红' : '**仍返回对象** ⇒ 该腿恒绿、无牙'}` +
        `｜对照：A1-9 ⇒ ${goodHit ? `L${goodHit.line}` : 'null'}（须非空且带行号）⇒ ${twoState ? '两态可分辨' : '**不能两态**'}`,
    )
  }

  // ⑦ K1 件 3：失败留档的**两态**（抽取器有牙 + 真写/真读回）
  {
    /**
     * 两段都要真：
     *   ① 抽取器：合成 TAP 里**必须**抠出 `not ok` 的**全文块**（含断言消息）；干净 TAP 必须抠出 0（不得无中生有）。
     *   ② 归档通道：真写一份、真读回来、逐字段比对 —— 「可被重新读到」这句话的机器落点。
     *      ⚠ 用临时目录 + `MANA_A1_FAILURE_DIR`，跑完复原环境变量（不许把自测痕迹留在真实归档目录里）。
     */
    const tap = ['TAP version 13', 'not ok 3 - X 用例', '  ---', '  error: "boom"', '  expected: 1', '  actual: 2', '  ...', 'ok 4 - Y 用例', '1..4'].join('\n')
    const got = extractNotOk(tap)
    const clean = extractNotOk('ok 1 - A\n1..1')
    const extractorTwoState = got.length === 1 && got[0].name === 'X 用例' && /expected: 1/.test(got[0].block) && clean.length === 0
    let ioTwoState = false
    let ioDetail = ''
    const prevDir = process.env.MANA_A1_FAILURE_DIR
    try {
      const dir = mkdtempSync(join(tmpdir(), 'mana-a1-dump-'))
      createdDirs.push(dir)
      process.env.MANA_A1_FAILURE_DIR = dir
      const probe = { kind: 'mana-a1-check-failure-dump', exitCode: 1, items: [{ id: 'A1-X' }], raw: [{ file: 'f', notOk: got }] }
      const w = writeFailureDump(probe)
      const back = w.path ? JSON.parse(readFileSync(w.path, 'utf8')) : null
      ioTwoState = Boolean(w.path && back && back.exitCode === 1 && back.raw[0].notOk[0].name === 'X 用例' && /expected: 1/.test(back.raw[0].notOk[0].block))
      ioDetail = w.path ? `写入 ${statSync(w.path).size} B ⇒ 读回：exitCode=${back?.exitCode} notOk=${back?.raw?.[0]?.notOk?.[0]?.name}` : `写失败：${w.writeError}`
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      ioDetail = `归档两态**未判定**：${String(error.message).slice(0, 100)}`
    } finally {
      if (prevDir === undefined) delete process.env.MANA_A1_FAILURE_DIR
      else process.env.MANA_A1_FAILURE_DIR = prevDir
    }
    caseAdd(
      'failure-dump-two-state',
      extractorTwoState && ioTwoState,
      `抽取器：合成 TAP ⇒ ${got.length} 条（须 1；名字=${got[0]?.name}，块内含断言消息=${/expected: 1/.test(got[0]?.block ?? '')}）／干净 TAP ⇒ ${clean.length} 条（须 0，不得无中生有）｜归档：${ioDetail} ⇒ ${extractorTwoState && ioTwoState ? '两态可分辨' : '**不能两态**'}`,
    )
  }

  // ⑧ K1 件 1：生产链路腿**判定函数**的合成两态（含「输入形态退化」那一态）
  {
    /**
     * ⚠ 本用例防三种退化（前两种是**本席实测踩到过的真缺陷**）：
     *   ① 判定写在腿里、且对**数组**判 `=== 0` ⇒ 「无牙」分支不可达 ⇒ 判据恒绿（v1 的真身）；
     *   ② 用例只解析**人读文本** ⇒ 文本印得好看、判定却是死的，用例跟着一起绿（⑧ v1 的真身，对拍 6 复现）；
     *   ③ 扰动体没跑成（锚点过期）却被当成「扰动通过」。
     *   ⇒ 故这里**直接调判定函数**，喂计数与数组两种输入，要求各合成态给出不同答案。
     */
    const clean = { leaked: 0, injected: 1, mLeaked: 6, mInjected: 1, mutErr: null }
    const vClean = runtimeAuditVerdict(clean)
    const vNoTeeth = runtimeAuditVerdict({ ...clean, mLeaked: 0 })
    const vNoArrival = runtimeAuditVerdict({ ...clean, injected: 0 })
    const vMutantDown = runtimeAuditVerdict({ ...clean, mutErr: '变异锚点命中 0 次' })
    const vArrayShape = runtimeAuditVerdict({ ...clean, mLeaked: [1, 2, 3] })
    const vLeak = runtimeAuditVerdict({ ...clean, leaked: 6 })
    const twoState =
      vClean === '' && vNoTeeth !== '' && vNoArrival !== '' && vMutantDown !== '' &&
      vArrayShape.includes('内部错误') && vLeak.includes('泄漏') &&
      vNoTeeth !== vClean && vNoArrival !== vNoTeeth && vMutantDown !== vNoTeeth
    let real = null
    try { real = await a1RuntimeAuditLeak() } catch (error) { real = { note: `抛错：${error.message}`, why: String(error.message) } }
    const ok = twoState && real.why === ''
    caseAdd('runtime-audit-two-state', ok,
      `合成两态：干净 ⇒ ${JSON.stringify(vClean)}（须空）／扰动无命中 ⇒ ${JSON.stringify(vNoTeeth).slice(0, 60)}（须非空）／无到达 ⇒ ${JSON.stringify(vNoArrival).slice(0, 50)}（须非空）／扰动未跑成 ⇒ ${JSON.stringify(vMutantDown).slice(0, 50)}（须非空）／**数组输入** ⇒ ${JSON.stringify(vArrayShape).slice(0, 70)}（须报内部错误 —— 这一态正是 v1 的死法）｜真实运行：${real.why ? `红（${real.why.slice(0, 60)}）` : '绿'} ⇒ ${ok ? '两态可分辨' : '**不能两态**'}`,
    )
  }

  const bad = cases.filter((c) => !c.ok)
  console.log('══════ 判据器自测表（--self-test：每条腿的「会不会红」本身要被机检）══════')
  for (const c of cases) console.log(`  ${c.ok ? '✓' : '✗'} [${c.name}] ${c.detail}`)
  console.log(`\n${bad.length ? `❌ 自测不通过：${bad.map((c) => c.name).join(', ')}（该腿**不能两态** ⇒ 它绿也不可信）` : `✅ 自测通过：${cases.length}/${cases.length} 条腿两态可分辨`}`)
  process.exit(bad.length ? 3 : 0)
}
