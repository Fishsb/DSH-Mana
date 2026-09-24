#!/usr/bin/env node
/**
 * Mana 阶段 1 验收判据机检器（A1-4 / A1-5 / A1-11 / A1-12）。
 *
 * 存在的理由：A0 级有统一入口（`tools/a0-check.mjs`），A1 级**没有** ——
 * 判据散在 `packages/vector/tests/b11-vector.test.mjs` 的用例里与各源码文件的注释里。
 * 「散在测试里」与「可重复机检」是两件事：后者才能被**别的席**在**自己那轮**跑出红。
 *
 * 真源（本脚本逐条对齐，不采信任何转述）：
 *  · 判据表：`docs/mana-rollout-plan.md:454-462`（A1-4 / A1-5 / A1-11 / A1-12 四行）
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
 *
 * ── 纪律（与 a0-check 同口径）─────────────────────────────────────────────
 *  ① 退出码：0 = 无 FAIL 且项集等式通过且变异自证腿通过（可含挂账）；1 = 有 FAIL 或项集等式不等；
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
 *  ④ 本脚本另带两条**不会自己变绿**的腿：`ARTIFACTS`（产物新鲜度，挂账态，可用
 *     `--require-fresh-artifacts` 升级为 FAIL）与 `A1-5` 的「无实现者」态 —— 都不许被读成 PASS。
 *
 * ⚠ **变异为纯内存注入**（本脚本的一条硬纪律）：
 *   变异时把被测源文件**原文读进内存**、替换锚点、写进临时目录的**克隆副本**再 import
 *   （相对 import 改写成绝对 file: URL），**绝不写回仓内任何源文件**。
 *   理由：`packages/vector/**` 是他席写面（且在途改动未提交）⇒ 判据不得为了自证去改它。
 *   取证：变异跑前/跑后 `git status --porcelain packages/vector packages/jev` 逐字相同。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const P = (...p) => join(ROOT, ...p)
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
const record = (id, title, state, detail, evidence = '') => results.push({ id, title, state, detail, evidence })
const pass = (id, t, d, e) => record(id, t, 'PASS', d, e)
const fail = (id, t, d, e) => record(id, t, 'FAIL', d, e)
const hang = (id, t, d, e) => record(id, t, 'HANG', d, e)
const none = (id, t, d, e) => record(id, t, 'NONE', d, e)

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
  'a1-5': {
    target: 'A1-5',
    selfKernel: true,
    why: 'A1-5 仓内无实现 ⇒ 变异注入到**判据内联核**（半衰期由 14 变 7）。这是判据自证，不是实现变异 —— 如实标注',
  },
}

/** 变异生效登记：克隆体**真的**与真源不同才记（锚点未命中 ⇒ 不许当成"变异成功"）。 */
const mutApplied = new Set()
/** 按「被判项」反查它的变异器（同一项可有多个变异器，一次只准注入一个）。 */
const mutOf = (checkId) => [...MUTATES].find((m) => MUTATORS[m]?.target === checkId) ?? null

/** 本次运行创建过的临时克隆目录（收尾逐个删；不用通配，避免误删同名目录）。 */
const createdDirs = []

/** 克隆一份被测源文件到临时目录（可选注入变异），返回可 import 的模块。 */
async function loadCloned(file, mutId) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-a1-'))
  createdDirs.push(dir)
  let txt = readFileSync(join(SRC, file), 'utf8')
  if (mutId) {
    const m = MUTATORS[mutId]
    if (!m || m.file !== file) throw new Error(`变异器 ${mutId} 与被测文件 ${file} 不匹配`)
    for (const [find, rep] of m.edits) {
      const hits = txt.split(find).length - 1
      if (hits !== 1) throw new Error(`变异锚点已过期：在 ${file} 命中 ${hits} 次（须恰好 1 次，否则注入的不是预注册的那个缺陷）：${JSON.stringify(find.slice(0, 60))}`)
      txt = txt.replace(find, rep)
    }
  }
  // 相对 import 改写成绝对 file: URL —— 克隆体不在原目录，相对路径会失配。
  txt = txt.replace(/from '\.\/([\w.-]+\.ts)'/g, (_all, f) => `from '${url(join(SRC, f))}'`)
  const out = join(dir, file)
  writeFileSync(out, txt)
  if (mutId) mutApplied.add(mutId)
  return { mod: await import(url(out)), dir }
}

/** 取一条被测模块：无变异时走真源本体，有变异时走克隆体。 */
async function vecModule(file, mutId) {
  if (!mutId) return await import(url(join(SRC, file)))
  const { mod } = await loadCloned(file, mutId)
  return mod
}

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
    else pass(id, title, detail, '判据表 docs/mana-rollout-plan.md:454；与 packages/vector/tests/b11-vector.test.mjs ① ② 同口径')
  } catch (error) {
    fail(id, title, `加载/执行失败：${error.message}`, '先修源文件可解析性')
  }
}

// ══ A1-5 时间衰减确定性（A 档）══════════════════════════════════════════════
{
  const id = 'A1-5'
  const title = '时间衰减确定性（h=14 三锚点，绝对差 ≤1e-6）'
  /**
   * ⚠ 本项当前**无仓内实现可测者**（如实报，不假装测了实现）：
   *   衰减核（半衰期 h=14 天）按依赖链属 `B4.2`（`forgetting`，见落地册:547），前置于 `B3.1`；
   *   而 `B3.1/B4.2` 均是阶段 2/3 的批次。仓内现只有 `packages/core/src/schema.ts:48` 的
   *   `decay_factor` 列名与 `packages/forgetting/src/index.ts` 文件头的「待 W5」字样。
   *   ⇒ 本项测的是**闭式核与判据表锚点**，并**实时扫描**仓内是否已出现实现者：
   *     一旦出现，本项自动转 HANG（判据必须改接真实现，不许继续对闭式核自证）。
   */
  const decay = (t, h) => Math.exp((-t * Math.LN2) / h) // 半衰期定义式，与 docs/mana-v5-plan.md:533 逐字同形
  /** `--mutate a1-5`：判据内联核的变异（本项无实现可变异，见上面 caveat；如实标注）。 */
  const H = mutOf('A1-5') ? 7 : 14
  if (mutOf('A1-5')) mutApplied.add(mutOf('A1-5'))
  const anchors = [
    ['decay(0)', decay(0, H), 1.0],
    ['decay(14)', decay(14, H), 0.5],
    ['decay(90)', decay(90, H), 0.011609],
  ]
  const bad = anchors.filter(([, got, want]) => !near(got, want)).map(([n, got, want]) => `${n}=${got}（应 ${want}）`)
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
  const detail = anchors.map(([n, g, w]) => `${n}=${fixed(g)}（差 ${Math.abs(g - w).toExponential(2)}）`).join(' · ')
  if (bad.length) fail(id, title, `闭式核不符：${bad.join('；')}`, '回排序步骤（衰减核参数 h=14 天）')
  else if (impls.length) hang(id, title, `${detail}｜⚠ 仓内已出现衰减核实现者：${impls.join(', ')}`, '本项须改接真实现后再判；对闭式核自证不再是有效判据')
  else
    none(
      id,
      title,
      `${detail}｜仓内**无实现者**（依赖链：B4.2 前置于 B3.1，落地册:547 / :503）`,
      '只此一处不合格：本项证明的是「判据锚点成立」，不是「实现正确」——实现落地时本项须改接真实现',
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
    else pass(id, title, detail, '判据表 docs/mana-rollout-plan.md:461；负向判据须造**真**故障路径（不可达端点）')
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

    // 真机面（本机 Ollama bge-m3）：不可达即红，不静默跳过
    const cfg = { enabled: true, baseUrl: OLLAMA, model: 'bge-m3', dim: 1024, timeoutMs: 30000 }
    const probe = await embedTexts(cfg, ['向量适配判据探针'])
    if (probe.degraded) bad.push(`本机 Ollama 必须可达（测量条件）：${probe.reason}`)
    else {
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
      const detail = `纯函数面 4/4 · 真机 dim=${probe.vectors[0].length} · ${bNote}`
      if (bad.length) fail(id, title, `不符：${bad.join('；')}`, '回嵌入适配步骤（packages/vector/src/embed.ts / adapt.ts）')
      else pass(id, title, detail, '判据表 docs/mana-rollout-plan.md:462；阈值分档见 docs/contract/threshold-discipline.md')
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
    const srcDir = P('packages', dir, 'src')
    const libEntry = P('packages', dir, 'lib/index.js')
    let fresh = null
    if (existsSync(libEntry) && existsSync(srcDir)) {
      const maxSrc = Math.max(...readdirSync(srcDir).filter((f) => f.endsWith('.ts')).map((f) => statSync(join(srcDir, f)).mtimeMs))
      fresh = statSync(libEntry).mtimeMs >= maxSrc
    }
    if (fresh === false) bad.push(`${pkg}: lib/index.js 早于 src ⇒ 解析到的是过期产物`)
    lines.push(`${pkg} → ${resolved} [${keys.join(',')}]${fresh === false ? ' ⚠过期' : ''}`)
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
function runCases(file, cases) {
  const r = node(['--test', file])
  const out = `${r.out ?? ''}${r.err ?? ''}`
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
    pass(id, title, '从 perception 真触发走通全链（三段各写库）；seq 连续无洞', '判据表 docs/mana-rollout-plan.md:451；走真 cordis Loader 装配链，装配判据=服务可读')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `用例未命中（tests=${r.tests}）`, '回 B2.1 接线步骤')
  }
}

{
  const id = 'A1-13'
  const title = 'A1-13 注入审计：每次 pre-step 都留痕且 gate 恒落 5 类枚举'
  const r = runCases(W3_TESTS.gate, ['P1 A1-13①', 'P2 A1-13②', 'P7 门控关闭'])
  if (r.failed.length === 0 && r.passed.length === 3) {
    pass(id, title, '3 条用例全绿：gate 恒落枚举、每次 pre-step 均留痕、关掉门控也留痕', '判据表 docs/mana-rollout-plan.md:473；跑真 agent/pre-step 分发，非直接调 service')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/3）`, '回 Injection Gate（packages/attention）')
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
    pass(id, title, 'jev_log.gate 列存在且 CHECK 限定 unavailable/budget；失败行仍写入；degraded 与 gate 至少一非空', '判据表 docs/mana-rollout-plan.md:458；补列经 ADR-6 迁移机制对存量库同样生效')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/${cases.length}）`, '回 jev_log 表结构 / JEV 适配层降级链')
  }
}

{
  const id = 'A1-9'
  const title = 'A1-9 审计不泄内容：inject_log 全文做 ≤32 字节 n-gram 匹配命中 0'
  const cases = ['F4 A1-9', 'F5 A1-9']
  const r = runCases(P('packages/core/tests/lexical-audit.test.mjs'), cases)
  if (r.failed.length === 0 && r.passed.length === 2) {
    pass(id, title, '审计行序列化后对记忆原文做 3-gram 匹配命中 0；但 id 必须保留（防"什么都不记"冒充合规）', '判据表 docs/mana-rollout-plan.md:459；F5 是判据自身的**有牙自证**（内容一旦进审计必须命中）')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/2）`, '回审计写入步骤')
  }
}

{
  const id = 'A1-10'
  const title = 'A1-10 中文召回非静默归零（负向）：库非空时中文串必须命中 ≥1'
  const cases = ['F1 A1-10', 'F2 A1-10', 'F3 A1-10']
  const r = runCases(P('packages/core/tests/lexical-audit.test.mjs'), cases)
  if (r.failed.length === 0 && r.passed.length === 3) {
    pass(id, title, '中文串真召回 ≥1；0 命中的三种原因（库空/查询过短/真查不到）可分辨；FTS 同步触发器增删改均生效', '判据表 docs/mana-rollout-plan.md:460；机制根因=external content 虚表不自动跟随主表（实测静默 0 命中）')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/3）`, '回 FTS5 建表/触发器口径')
  }
}

{
  const id = 'A1-14'
  const title = 'A1-14 fail-closed 不得吞掉「未判」：不注入 **且** 仍留痕（两条都要真）'
  const r = runCases(W3_TESTS.gate, ['P5 A1-14', 'P6 A1-14'])
  if (r.failed.length === 0 && r.passed.length === 2) {
    pass(id, title, '无候选/降级两条路径：注入块 == 0 **且** inject_log 均新增对应枚举行（只满足前者即静默）', '判据表 docs/mana-rollout-plan.md:474；G8「降级必须落显式字段」')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/2）`, '回 Injection Gate 的留痕路径')
  }
}

{
  const id = 'A1-2'
  const title = 'A1-2/A1-3 注入不变式 I1/I2：每 (session,turn) ≤1 注入块、每条记忆每 session ≤1 次'
  const r = runCases(W3_TESTS.gate, ['P9 A1-2', 'P10 A1-3'])
  if (r.failed.length === 0 && r.passed.length === 2) {
    pass(id, title, '同一 turn 连打 3 次 pre-step：3 行留痕但 injected **仅 1 行**；跨 turn 不重复注入同一批候选', '判据表 docs/mana-rollout-plan.md:452-453；前置 A0-8（表 + 列）已具备')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/2）`, '回 Injection Gate 的去重/清空步骤')
  }
}

{
  const id = 'A1-6'
  const title = 'A1-6/A1-7 注入块转义（内层 < = 0）+ 尾部追加（前缀逐字节不变）'
  const r = runCases(W3_TESTS.gate, ['P3 A1-6', 'P4 A1-7'])
  if (r.failed.length === 0 && r.passed.length === 2) {
    pass(id, title, '含尖括号内容被转义（内层 < = 0）；注入为尾部追加、既有消息逐字节不变', '判据表 docs/mana-rollout-plan.md:456-457；宿主契约「this waterfall cannot mutate messages」')
  } else {
    fail(id, title, r.failed.length ? `挂的用例：${r.failed.join(' / ')}` : `本项用例未全绿（passed=${r.passed.length}/2）`, '回注入块组装/追加步骤')
  }
}

// ══ 附加腿：全仓 lib 产物新鲜度（挂账状态，可用 --require-fresh-artifacts 升级为 FAIL）══
{
  const id = 'ARTIFACTS'
  const title = '全仓 lib 产物新鲜度（过期产物会让「按包名解析」的判据测到旧代码）'
  const stale = []
  const missing = []
  for (const pkg of readdirSync(P('packages'))) {
    const srcDir = P('packages', pkg, 'src')
    const libEntry = P('packages', pkg, 'lib')
    if (!existsSync(srcDir)) continue
    const srcs = readdirSync(srcDir).filter((f) => f.endsWith('.ts'))
    if (!srcs.length) continue
    if (!existsSync(join(libEntry, 'index.js'))) {
      missing.push(`packages/${pkg}`)
      continue
    }
    const maxSrc = Math.max(...srcs.map((f) => statSync(join(srcDir, f)).mtimeMs))
    if (statSync(join(libEntry, 'index.js')).mtimeMs < maxSrc) {
      stale.push(
        `packages/${pkg}（src ${new Date(maxSrc).toISOString().slice(11, 19)} → lib ${new Date(statSync(join(libEntry, 'index.js')).mtimeMs).toISOString().slice(11, 19)}）`,
      )
    }
  }
  const parts = []
  if (missing.length) parts.push(`无产物：${missing.join(', ')}`)
  if (stale.length) parts.push(`过期：${stale.join(' · ')}`)
  if (!parts.length) pass(id, title, '13 包逐个比 src/lib 最新 mtime：无过期、无缺产物', '')
  else {
    const detail = `${parts.join('；')}｜⚠ 过期产物**不改变任何判据的绿**（r0 的按包名装配、本脚本的解析腿都会吃到旧实现）`
    if (REQUIRE_FRESH) fail(id, title, detail, '跑一次工作区 build 后复跑；或本项保持挂账并显式记录')
    else hang(id, title, detail, '挂账≠通过：本项不改判任何绿，但**必须有人看**（r0 6/6 与本脚本 W2-5 都建立在它之上）')
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
const EXPECTED_IDS = ['A1-1', 'A1-2', 'A1-4', 'A1-5', 'A1-6', 'A1-8', 'A1-9', 'A1-10', 'A1-11', 'A1-12', 'A1-13', 'A1-14', 'ARTIFACTS', 'W2-5']
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

// ── 变异自证腿（预注册：注入的项**必须**红、且不得误伤别的项）───────────────────
// ⚠ 这一腿是 `--mutate` 的全部意义：没有它，`--mutate` 只是一段会打印字的代码。
let harnessFail = false
const selfCheck = []
if (MUTATES.size) {
  for (const m of MUTATES) {
    const mt = MUTATORS[m]
    if (!mt) continue
    const tgt = results.find((r) => r.id === mt.target)
    const injected = mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)
    if (!injected) selfCheck.push(`${m}：变异**未真正注入**（锚点未命中或未加载克隆体）⇒ 本次运行不能作为自证`)
    if (tgt && tgt.state !== 'FAIL') selfCheck.push(`${m}：被注入的 ${mt.target} 实测 ${tgt.state}（**应 FAIL**）⇒ 该项判据无牙`)
    for (const r of results) {
      if (r.state === 'FAIL' && r.id !== mt.target) selfCheck.push(`${m}：误伤 ${r.id}（应为 PASS/HANG/NONE）⇒ 变异不隔离`)
    }
  }
  if (selfCheck.length) harnessFail = true
}

// ── 输出 ────────────────────────────────────────────────────────────────────
const order = { FAIL: 0, HANG: 1, NONE: 2, PASS: 3 }
results.sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id))
const n = { PASS: 0, FAIL: 0, HANG: 0, NONE: 0 }
for (const r of results) n[r.state] += 1

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mutates: [...MUTATES],
        itemSet: { expected: EXPECTED_IDS, actual: ids, ok: itemSetOk, problems: itemSetProblems },
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
  }
  console.log('（挂账 ≠ 通过；无实现者 = 本项无仓内实现可测，只证判据锚点）\n')
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
  const gateOk = itemSetOk && n.FAIL === 0 && !harnessFail
  const gateWhy = [
    n.FAIL ? `${n.FAIL} 项 FAIL` : '',
    itemSetOk ? '' : '项集等式不等',
    harnessFail ? '变异自证腿不通过（判据无牙）' : '',
  ].filter(Boolean)
  console.log(`\n──── 门判定（判据腿 + 项集腿${MUTATES.size ? ' + 变异自证腿' : ''}，**都要过**）────`)
  if (n.FAIL === 0) console.log(`  ✓ 判据腿：无 FAIL${n.HANG ? `（另有 ${n.HANG} 项挂账，挂账≠通过）` : ''}${n.NONE ? `（另有 ${n.NONE} 项无实现者可测）` : ''}`)
  else console.log(`  ✗ 判据腿：有 ${n.FAIL} 项 FAIL`)
  if (itemSetOk) console.log(`  ✓ 项集腿：期望 == 实测（${EXPECTED_IDS.length} 项逐 id 在册）`)
  else console.log(`  ✗ 项集腿：${itemSetProblems.join('；')}`)
  console.log(`  ${itemSetDetail}`)
  if (MUTATES.size) console.log(`  ${harnessFail ? '✗' : '✓'} 变异自证腿：${harnessFail ? '不通过（见上）' : '注入项皆红、其余项未误伤'}`)
  console.log(`\n${gateOk ? '✅ 门通过' : `❌ 门不通过：${gateWhy.join(' + ')}`}`)
}

// 未知变异器**必须显式失败**（静默忽略 = 变异自证变假绿）
const dupTargets = Object.entries(
  [...MUTATES].reduce((acc, m) => {
    const t = MUTATORS[m]?.target
    if (t) (acc[t] ??= []).push(m)
    return acc
  }, {}),
).filter(([, ms]) => ms.length > 1)
const unknownMut = [...MUTATES].filter((m) => !MUTATORS[m])
if (unknownMut.length) {
  console.error(`✗ 未知变异器：${unknownMut.join(', ')}（可用：${Object.keys(MUTATORS).join(', ')}）`)
  process.exitCode = 2
} else if (dupTargets.length) {
  console.error(
    `✗ 同一判据被注入多个变异器：${dupTargets.map(([t, ms]) => `${t}←${ms.join('+')}`).join('，')}` +
      `（一次只判一个缺陷，否则"哪条腿有牙"不可分辨）`,
  )
  process.exitCode = 2
} else {
  // 退出码口径：项集等式红 / 有 FAIL ⇒ 1；变异自证腿不过 ⇒ 3（判据无牙 = 比判据红更坏的形态）
  process.exitCode = harnessFail ? 3 : !itemSetOk || results.some((r) => r.state === 'FAIL') ? 1 : 0
}

// 收尾：删本次创建的临时克隆目录（逐个删；本脚本不写仓内任何文件）
for (const d of createdDirs) {
  try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
}
