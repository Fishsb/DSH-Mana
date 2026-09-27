/**
 * Write Gate **预过滤换靶**判据（F1）—— bigram 口径 → 信号词口径。
 *
 * ── 本文件要证的三件事（缺一条则"归位"只是自述）──────────────────────────────
 *   ① **换靶了**：同一批语料在新旧两口径下**结论不同**，且差多少**可逐条复算**；
 *   ② **靶是对的**：该过的进判定（含"记住：项目根目录…"这类单信号词持久事实），
 *      该挡的被挡（寒暄/命令类）—— **两个方向都判**，不作"全放过去"的放宽；
 *   ③ **词表没另立**：long-term 里**零信号词字面量**，词表与匹配函数都取自 perception。
 *
 * ── 为什么"旧口径"必须可复算（而不是删掉了事）────────────────────────────────
 *   只保留新口径 ⇒ "换靶前后差多少"无从复算 ⇒ 归位与否只能靠自述。本仓纪律：
 *   放行不等于抵达，**没有对照读数的"归位"不是证据**。故实现侧刻意保留了旧口径的
 *   可调用件（prefilterByBigramOverlap + PREFILTER_BANK + PREFILTER_MIN_OVERLAP）。
 *
 * ── 判据纪律（逐条对应本批硬约束）────────────────────────────────────────────
 *   · **不断言中间量冒充结论**：核心读数是"同一语料在两口径下各放行几条"（实测数字），
 *     不是"函数存在"。
 *   · **反证腿**：调高阈值/换词表必须能改变结论 ⇒ 证明比对靶**真的是词表**，
 *     而不是一个恒真的空跑（"全放过去"与"换靶成功"必须可分辨）。
 *   · **负控**：旧口径若与新口径恒同结论，说明换靶没发生 —— 判据必须能抓到。
 *
 * 运行（显式路径）：node --test packages/long-term/tests/write-gate-prefilter.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const mod = await import(new URL('../src/write-gate.ts', import.meta.url).href)
const SRC = fileURLToPath(new URL('../src/write-gate.ts', import.meta.url))

const EXPECTED_CASES = 7
let ran = 0

/**
 * **同一批**真实风格语料（≥6 条；本批 16 条）。
 *
 * ⚠ 选材纪律：**不以"能否过闸"为选材标准**（那是"为评估而设计输入"的假绿形态，本仓点名）。
 *   本批取**真实会话里实际会出现的句子**，并显式覆盖三类：
 *   · keep  —— 含跨会话可复用信息（偏好/决策/持久事实/纠正）：**该过**；
 *   · drop  —— 寒暄/命令/短指令：**该挡**；
 *   · eval  —— tools/eval-l1-l4.mjs 的现役种子（与本卡"L2 命中率 0/4"直接相关）：**现状如实记**。
 *   其中 legacy-* 两条取自**既有判据正在用的串**（skeleton.test.mjs / write-gate.test.mjs），
 *   使"换靶有没有把既有判据的样本挪走"也可复算。
 */
const CORPUS = Object.freeze([
  { text: '记住：项目根目录在 /home/lk/Mana', kind: 'keep', why: '持久事实（单信号词"记住"）' },
  { text: '跑一下测试', kind: 'drop', why: '命令' },
  { text: '以后提交用 git add <显式清单>，不要用 git add -A', kind: 'keep', why: '偏好/约定' },
  { text: '用户偏好开源方案，拒绝 Docker 与向量库', kind: 'keep', why: '偏好' },
  { text: '决定采用 SQLite FTS5，因为个人自用需要轻量', kind: 'keep', why: '决策含理由' },
  { text: '今天天气不错，我们继续吧', kind: 'drop', why: '寒暄' },
  { text: '帮我看看这个文件', kind: 'drop', why: '指令礼貌词（词表刻意不收"帮我"）' },
  { text: 'prefer tabs over spaces in this repo', kind: 'keep', why: '英文偏好（大小写不敏感腿）' },
  { text: '评估器输入：认知记忆架构需要可观测的度量，检索链的命中率必须能够复算，遗忘曲线要能用手算值对拍。', kind: 'eval', why: 'eval-l1-l4 现役种子 1' },
  { text: '评估器输入：认知记忆架构需要可观测的度量，检索链的命中率必须能够复算，这样评估才有意义。', kind: 'eval', why: 'eval-l1-l4 现役种子 2' },
  { text: '评估器输入：认知记忆架构需要可观测的度量，遗忘曲线要能用手算值对拍，检索与遗忘都要能复算。', kind: 'eval', why: 'eval-l1-l4 现役种子 3' },
  { text: '评估器输入：记忆质量的核心指标是召回命中率，它必须能够复算，否则度量就只是自述。', kind: 'eval', why: 'eval-l1-l4 现役种子 4' },
  { text: '这条观察值得长期记住：Mana 的写入门控接线完成', kind: 'legacy-keep', why: '既有判据 KEEPABLE（为过问法 bigram 而写）' },
  { text: 'P1 空壳行为面探针', kind: 'legacy-drop', why: '既有判据 BLOCKED' },
  { text: '系统提示词更新接口缺席，走就地替换分支', kind: 'drop', why: '真实教训句，但**不含信号词** ⇒ 新口径也不放行（如实记，不粉饰）' },
  { text: '沙箱边界 EPERM 属拒绝非 bug，先改路径', kind: 'keep', why: '真实教训句，含"路径"' },
])

/**
 * 剥注释的**真扫描器**（逐字符状态机）。
 *
 * ⚠ **块注释不嵌套**（JS 规范如此）—— 本席初版按"支持嵌套"写，实测当场踩坑：
 *   被扫的那份源码，其文件头注释里出现了形如 "mana/long-term" 后面紧跟一个星号的**散文**
 *   （即一段刚好长得像"开注释符"的文字）；嵌套版便把它当成又开了一层注释，
 *   于是要等第二个收尾符才闭合 ⇒ 头注释的收尾符只把深度降到 1 ⇒ 剥完是**0 字节**
 *   ⇒ 腿 A/A2 在空串上恒绿（假绿），而本腿末尾那条"真读到源码"前置断言把它抓了出来
 *   （判据自己逮住了自己的 bug —— 那正是那条前置断言存在的理由）。
 *   ⇒ 现值 = 标准非嵌套语义。
 *
 * ⚠ 本函数存在的理由（本席实测踩到的判据自身缺陷，如实记）：
 *   初版腿 A 把源码**整体**当字符串搜"词表里的词"，于是文件头注释里的
 *   「这条观察值得长期记住吗」「判定**结论**未被应用」「**不得**用 0 冒充」三处
 *   **恰好含**词表词 —— 判据红，而源码里**并没有**第二份词表。
 *   那是**假红**（扫描器太粗），而同一条腿若因怕红而放宽成"只搜代码里有没有词表变量名"，
 *   就会变成**假绿**（真的另立词表也抓不到）。⇒ 修法是**把扫描器做准**，不是放宽断言：
 *     · 先剥**注释**（逐字符、支持嵌套）⇒ 注释里出现这些词**合法**（那是在讨论这件事本身）；
 *     · 再分两档精确判定（见腿 A / 腿 A2）；
 *     · 扫描器自带**负控**（喂一个真·第二份词表，必须抓到）。
 */
function stripComments(src) {
  let out = ''
  let i = 0
  let inBlock = false
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    // ⚠ 块注释**不嵌套**（JS 规范）：注释内的 /* 只是散文，不得再开一层
    if (!inBlock && c === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (inBlock && c === '*' && n === '/') { inBlock = false; i += 2; continue }
    if (inBlock) { i += 1; continue }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue }
    out += c
    i += 1
  }
  return out
}

/** 判据：源码里是否出现了**恰好等于**某个词表词的字符串字面量（= 第二份词表的形态）。 */
function exactWordLiterals(code, words) {
  const literals = new Set()
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    literals.add(m[1] !== undefined ? m[1] : m[2])
  }
  return words.filter((w) => literals.has(w))
}

/** 判据：把字符串字面量也抹掉后，源码里是否还有词表词的裸出现（防"藏在标识符里"）。 */
function bareWordOccurrences(code, words) {
  const noStrings = code.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  const lower = noStrings.toLowerCase()
  return words.filter((w) => lower.includes(String(w).toLowerCase()))
}

const oldCaliber = (t) => mod.prefilterByBigramOverlap(t)
const newCaliber = (t) => mod.prefilterWorthKeeping(t)
const releasedBy = (fn) => CORPUS.filter((c) => fn(c.text).hit).length
/** 行内小表（判据失败时把原始读数带出来，避免"只说数字不对"）。 */
const rows = (fn) =>
  CORPUS.map((c, i) => String(i + 1) + '.' + (fn(c.text).hit ? 'PASS' : 'block') + '(' + c.kind + ')').join(' ')

// ══ ① ★ 新旧口径对照：同一批语料，两口径各放行几条（**本卡最关键的一条证据**）══
test('① ★ 新旧口径对照：同一批语料两口径结论不同，且差异可逐条复算', () => {
  ran += 1
  const oldN = releasedBy(oldCaliber)
  const newN = releasedBy(newCaliber)
  const total = CORPUS.length

  assert.ok(total >= 6, '语料规模须 ≥6 条（本卡硬要求）；实测 ' + String(total))
  assert.notEqual(
    oldN,
    newN,
    '★ 两口径必须给出**不同**的放行数 —— 相同即说明换靶没有发生（或新口径退化成了恒等放行）。' +
      '实测 旧=' + String(oldN) + '/' + String(total) + ' 新=' + String(newN) + '/' + String(total) +
      '；逐条：旧[' + rows(oldCaliber) + '] 新[' + rows(newCaliber) + ']',
  )
  assert.ok(
    newN > oldN,
    '★ 新口径必须比旧口径**多**放行（旧口径把绝大多数真实语料挡在判定之外是本次归位要解决的现象）。' +
      '实测 旧=' + String(oldN) + ' 新=' + String(newN),
  )
  // 旧口径的读数须仍是"几乎全挡"（这不是抱怨，是本卡事实链第 4 条的复现）
  assert.ok(
    oldN <= 2,
    '旧口径在这批真实语料上应当几乎不放行（本卡事实链第 4 条）；实测 ' + String(oldN) + '/' + String(total),
  )
  // ⚠ 新口径**不是**全放过去（否则只是把闸拆了）
  assert.ok(
    newN < total,
    '★ 新口径**不得**全放行（全放行 = 撤闸，本卡明令不许）；实测 ' + String(newN) + '/' + String(total),
  )
  // 打印原始读数（判据自证：数字不是从别处抄的）
  console.log(
    '   [①对照] 旧口径放行 ' + String(oldN) + '/' + String(total) + ' · 新口径放行 ' + String(newN) + '/' + String(total),
  )
  console.log('   [①对照] 逐条 旧[' + rows(oldCaliber) + ']')
  console.log('   [①对照] 逐条 新[' + rows(newCaliber) + ']')
})

// ══ ② 两个方向都判：该过的过、该挡的挡（**不许只判一边**）════════════════════
test('② 两个方向：该过的必须进判定，该挡的必须被挡（双向）', () => {
  ran += 1
  // ── 方向 A：该过的过（含**单信号词**的持久事实 —— 阈值取 1 才过，取 2 会漏，见 ③）──
  const MUST_PASS = [
    '记住：项目根目录在 /home/lk/Mana',
    '用户偏好开源方案，拒绝 Docker 与向量库',
    '决定采用 SQLite FTS5，因为个人自用需要轻量',
    'prefer tabs over spaces in this repo',
  ]
  const missed = MUST_PASS.filter((t) => !newCaliber(t).hit)
  assert.equal(
    missed.length,
    0,
    '★ 该过的没过（新口径漏掉真实信号）：' + JSON.stringify(missed) +
      '；逐条 ' + JSON.stringify(MUST_PASS.map((t) => ({ t: t.slice(0, 18), ...newCaliber(t) }))),
  )
  // ── 方向 B：该挡的挡（寒暄/命令/短指令）──
  const MUST_BLOCK = ['跑一下测试', '今天天气不错，我们继续吧', '帮我看看这个文件', 'P1 空壳行为面探针']
  const leaked = MUST_BLOCK.filter((t) => newCaliber(t).hit)
  assert.equal(
    leaked.length,
    0,
    '★ 该挡的没挡住（新口径把寒暄/命令放进判定 = 白花模型往返）：' + JSON.stringify(leaked),
  )
  // 逐条原因非空且可读（"为什么放行/为什么挡"必须可解释 —— 换靶的直接收益）
  for (const t of MUST_PASS) {
    const r = newCaliber(t)
    assert.ok(r.hits.length >= 1, '放行必须给出命中的信号词（否则"为什么放行"不可读）：' + t + ' ⇒ ' + JSON.stringify(r))
    assert.ok(r.overlap >= r.threshold, '放行时命中数须 >= 阈值：' + JSON.stringify(r))
  }
  for (const t of MUST_BLOCK) {
    const r = newCaliber(t)
    assert.equal(r.hits.length, 0, '被挡时不得有命中词（否则读数自相矛盾）：' + t + ' ⇒ ' + JSON.stringify(r))
    assert.equal(r.table, 'builtin', '被挡时词表名须可读（不得与"预筛不可用"同形）：' + JSON.stringify(r))
  }
  // ── 双向合一的**反证**：若把新口径替换成"恒 true"，方向 B 必红；恒 false 则方向 A 必红
  //    ⇒ 上面两条断言各自都非平凡（这条说明本用例不是单边断言）
  assert.ok(
    MUST_PASS.length > 0 && MUST_BLOCK.length > 0,
    '本用例必须同时含"该过"与"该挡"两组（少一组即退化为单边断言）',
  )
  console.log('   [②双向] 该过 ' + String(MUST_PASS.length) + ' 条全过 · 该挡 ' + String(MUST_BLOCK.length) + ' 条全挡')
})

// ══ ③ 换靶换的是**词表**不是别处：阈值/词表任一变，结论随之变（反"空跑"）═══════
test('③ 比对靶真是"信号词表"：阈值可调、词表可换、表名可读（三条反证）', () => {
  ran += 1
  const SINGLE = '记住：项目根目录在 /home/lk/Mana'
  // 反证 1：阈值是真的（同一条文本，阈值 1 过、阈值 2 挡）
  assert.equal(newCaliber(SINGLE).hit, true, '前置：该串在阈值 1 下须放行（实测命中 ' + JSON.stringify(newCaliber(SINGLE).hits) + '）')
  assert.equal(
    mod.prefilterWorthKeeping(SINGLE, 2).hit,
    false,
    '★ 阈值必须真生效：该串信号词命中数 = ' + String(newCaliber(SINGLE).overlap) + '，阈值调到 2 后必须挡住',
  )
  assert.equal(mod.prefilterWorthKeeping(SINGLE, 99).hit, false, '阈值调到不可达 ⇒ 必须全挡（否则阈值是装饰）')
  // 反证 2：**比对靶是词表本身**——换一张自定义表，结论立刻反转（证明没有别的隐藏判据在起作用）
  const FAKE_TABLE = { name: 'probe-table', words: Object.freeze(['勾稽']) }
  const PROBE_TEXT = '把两边的数勾稽一下'
  assert.equal(newCaliber(PROBE_TEXT).hit, false, '前置：该串不含内置信号词 ⇒ 内置表下必须被挡')
  const withFake = mod.prefilterWorthKeeping(PROBE_TEXT, 1, {
    prefilter: (t, table) => {
      const hay = String(t).toLowerCase()
      const hits = table.words.filter((w) => hay.includes(String(w).toLowerCase()))
      return hits.length > 0
        ? { state: 'hit', hits, score: hits.length, table: table.name }
        : { state: 'miss', hits: [], score: 0, table: table.name, textChars: String(t).length, tableSize: table.words.length }
    },
    table: FAKE_TABLE,
    source: 'probe',
  })
  assert.equal(withFake.hit, true, '★ 换表必须改变结论（否则说明判据不看词表 —— 那本判据测的就不是"比对靶"）')
  assert.deepEqual([...withFake.hits], ['勾稽'], '换表后的命中词必须来自**新表**：' + JSON.stringify(withFake))
  // 反证 3：表名进读数 ⇒「用的哪张表」可分辨（两张表同表不同词是两件事）
  assert.equal(newCaliber(PROBE_TEXT).table, 'builtin', '内置表下 table 须为 builtin')
  assert.equal(withFake.table, 'probe-table', '自定义表下 table 须为该表名（否则"用错表"不可观测）')
  assert.notEqual(newCaliber(PROBE_TEXT).table, withFake.table, '两次调用的表名必须不同')
})

// ══ ④ 词表**不另立**：long-term 源码里零信号词字面量，真源在 perception ════════
test('④ 词表唯一真源在 perception：long-term 源码零信号词字面量（结构腿）', () => {
  ran += 1
  const src = readFileSync(SRC, 'utf8')
  const code = stripComments(src)
  // ── 前置：取 perception 的**真词表**（本腿的比对基准；取不到则本腿平凡通过）──
  const entry = fileURLToPath(import.meta.resolve('dsh-mana-perception'))
  const tableMod = createRequire(import.meta.url)(entry.replace(/index\.js$/, 'signal-words.js'))
  const WORDS = tableMod.DEFAULT_SIGNAL_WORDS
  assert.ok(Array.isArray(WORDS) && WORDS.length > 0, '前置：须取到 perception 的真词表（否则本腿平凡通过）')
  assert.ok(WORDS.length >= 20, '前置：词表规模须 >=20（本批实测 46）；实测 ' + String(WORDS.length))
  // ── 腿 A：源码里不得出现**恰好等于**词表词的字符串字面量（= 第二份词表的形态）──
  const offenders = exactWordLiterals(code, WORDS)
  assert.deepEqual(
    offenders,
    [],
    '★ long-term 源码里不得出现恰好等于词表词的字符串字面量（那是第二份词表的形态）：' + JSON.stringify(offenders),
  )
  // ── 腿 A2：连"藏在标识符/裸文本里"也不许（字符串也抹掉后再搜一遍）──
  const bare = bareWordOccurrences(code, WORDS)
  assert.deepEqual(bare, [], '★ 剥字符串后源码里仍不得裸现词表词：' + JSON.stringify(bare))
  /**
   * ⚠ **本腿的负控 —— 扫描器必须对"真·第二份词表"报警**。
   *   喂两个合成源码：一个真含第二份词表（必须被抓到），一个只是注释里提到（必须**不**被抓到）。
   *   前一条防假绿（扫描器失效），后一条防**假红**（本席实测踩到的正是后者的反面）。
   */
  const SYNTH_BAD = 'const SECOND_TABLE = [' + WORDS.slice(0, 3).map((w) => JSON.stringify(w)).join(', ') + ']\n'
  assert.ok(
    exactWordLiterals(stripComments(SYNTH_BAD), WORDS).length >= 1,
    '★ 负控 A：真·第二份词表必须被本扫描器抓到（抓不到 ⇒ 本腿是恒绿的假绿）',
  )
  const SYNTH_OK = '/* 讨论用：' + WORDS[0] + ' 与 ' + WORDS[1] + ' 是词表词 */\nconst x = 1\n'
  assert.deepEqual(
    exactWordLiterals(stripComments(SYNTH_OK), WORDS),
    [],
    '★ 负控 B：**注释里**提到词表词不得被判红（否则本腿会因"注释恰好含词"而假红 —— 本席实测踩到过）',
  )
  assert.ok(
    bareWordOccurrences(stripComments(SYNTH_BAD), WORDS).length === 0,
    '★ 负控 C：腿 A2 只搜"非字符串"区 ⇒ 合法字符串字面量不误报',
  )
  // ── 前置：本腿确实读到了真源码（0 字节/读错文件 ⇒ 平凡通过）──
  //   ⚠ 这两条不是形式主义：本席初版把整份源码剥成 0 字节，正是这两条把假绿抓了出来。
  assert.ok(code.length > 3000, '前置：须真读到 write-gate.ts 剥注释后的源码；实测 ' + String(code.length) + ' 字节')
  assert.ok(
    code.length < src.length && src.length - code.length > 2000,
    '前置：注释剥离须真发生（否则是不是"剥了个寂寞"无从判断）：src ' + String(src.length) + ' → code ' + String(code.length),
  )
  // ── 腿 B：真源必须**经运行期解析**取（值 import 会把可选依赖变成装配前置）──
  assert.ok(
    code.includes('resolveSignalLegs') && code.includes('prefilterBySignalWords'),
    '必须经 resolveSignalLegs 从 perception 取真函数（不是自己实现一份匹配）',
  )
  assert.ok(
    /import type \{[^}]*\} from 'dsh-mana-perception'/.test(code),
    '对 perception 只允许 import type（值 import 会让"没装 perception"变成"long-term 起不来"）',
  )
  assert.ok(
    !/^[ \t]*import \{(?![^}]*\btype\b)[^}]*\} from 'dsh-mana-perception'/m.test(code),
    '不得出现对 perception 的**值** import（同上）',
  )
})

// ══ ⑤ 端到端：换靶真的改变了 writeGate 的**状态**（不是只改了纯函数）═══════════
test('⑤ 端到端：同一文本在新口径下进判定、在旧口径口径下不进（状态可分辨）', async () => {
  ran += 1
  const judged = []
  /** 记录型判定链：本腿测的是"**进没进**判定"，不是"判得准不准"（后者归 write-gate.test.mjs ④）。 */
  const ctx = {
    async waterfall(_name, req) {
      judged.push(req.requestId)
      return { requestId: req.requestId, source: 'mana-long-term', value: 'yes', probability: 0.95, degraded: false, reason: null }
    },
  }
  const written = []
  const sink = { isRetired: () => null, write: (item) => written.push(item) }
  const obs = (text, requestId) => ({ sessionId: 's-pf', turnId: 1, requestId, at: new Date().toISOString(), content: text, source: 'test' })
  // summarizeEnabled:false —— 摘要面不属本卡写面，显式关掉使读数只反映预过滤
  const OPTS = { summarizeEnabled: false }

  // ── 方向 A：含信号词的真实内容 ⇒ **必须进判定**（旧口径下它 overlap=1 < 2，会落 skipped_prefilter）
  const KEEP = '记住：项目根目录在 /home/lk/Mana'
  const a = await mod.writeGate(ctx, null, sink, obs(KEEP, 'r-pf-a'), OPTS)
  assert.equal(a.state, 'written', '★ 含信号词的内容必须进判定并写入；实测 ' + a.state + ' / ' + String(a.reason))
  assert.equal(judged.length, 1, '★ 该过的必须**真进判定链**（judge 被调用一次）；实测 ' + String(judged.length))
  assert.equal(a.skipped, false, '进判定 ⇒ skipped 必须为 false')
  assert.ok(a.prefilterHits.includes('记住'), '读数必须给出命中的信号词：' + JSON.stringify(a.prefilterHits))
  assert.equal(a.prefilterTable, 'builtin', '读数必须给出词表名：' + String(a.prefilterTable))
  assert.equal(a.prefilterOverlap, 1, '命中数读数须与纯函数一致；实测 ' + String(a.prefilterOverlap))

  // ── 方向 B：寒暄/命令 ⇒ **不得进判定**，且原因可读
  const DROP = '跑一下测试'
  const b = await mod.writeGate(ctx, null, sink, obs(DROP, 'r-pf-b'), OPTS)
  assert.equal(b.state, 'skipped_prefilter', '★ 寒暄/命令必须被挡在判定之前；实测 ' + b.state)
  assert.equal(judged.length, 1, '★ 被挡者**不得**进判定（判定链调用数须仍为 1）；实测 ' + String(judged.length))
  assert.equal(b.wroteRow, false, '被挡 ⇒ 不得写行')
  assert.equal(b.skipped, true, '被挡 ⇒ skipped 必须为 true')
  assert.ok(b.reason && b.reason.includes('信号词'), 'reason 必须点名真因（"信号词预过滤"，不得只说"跳过"）：' + String(b.reason))
  assert.ok(b.reason.includes('unavailable') === false, '被挡**不是**"预筛不可用"（两者不得同形）：' + String(b.reason))

  // ── 方向 C：**旧口径口径的现实性反证** —— 同一条 KEEP 在旧口径下 overlap < 阈值
  const oldOnKeep = oldCaliber(KEEP)
  assert.equal(oldOnKeep.hit, false, '前置：同一条 KEEP 在旧口径下必须**不**放行（这正是本卡要修的现象）')
  assert.ok(oldOnKeep.overlap < oldOnKeep.threshold, '旧口径下 overlap 须低于其阈值：' + JSON.stringify(oldOnKeep))
  // ⇒ 两口径在**同一条真实文本**上给出相反结论 ⇒ 换靶是实质性的（不只是读数变好看）
  assert.notEqual(newCaliber(KEEP).hit, oldOnKeep.hit, '★ 换靶必须在同一文本上产生相反结论')
  console.log('   [⑤端到端] written=' + a.state + ' skipped=' + b.state + ' judgeCalls=' + String(judged.length) + ' oldOnKeep=' + JSON.stringify(oldOnKeep))
})

// ══ ⑥ 降级可分辨：预筛实现不可解析 ⇒ fail-open 放行，但**不是**静默 ═══════════
test('⑥ 预筛不可用：fail-open 放行 + 可分辨读数（不得退化成静默 0 行）', async () => {
  ran += 1
  // ── 腿 A：不可解析的 specifier ⇒ resolveSignalLegs 返回 null（不抛）
  assert.equal(mod.resolveSignalLegs('dsh-mana-nonexistent-zzz'), null, '解析失败必须返回 null（不得抛 —— 抛会让"没装 perception"变成"包起不来"）')
  assert.equal(typeof mod.resolveSignalLegs().prefilter, 'function', '正常 specifier 必须解析到真函数')
  // ── 腿 B：腿为 null ⇒ **fail-open**（放行），且 table 记号与"不含信号词"**不同形**
  const fo = mod.prefilterWorthKeeping('跑一下测试', 1, null)
  const miss = mod.prefilterWorthKeeping('跑一下测试')
  assert.equal(fo.hit, true, '★ 预筛不可用必须 **fail-open 放行**（否则"少一个词表"退化成"什么都记不下"）')
  assert.equal(fo.table, 'unavailable', 'fail-open 必须带可分辨记号：' + JSON.stringify(fo))
  assert.equal(miss.hit, false, '前置：同串在词表可用时必须被挡')
  assert.notEqual(fo.table, miss.table, '★「预筛不可用」与「文本不含信号词」必须可分辨（表名不同形）')
  assert.notEqual(fo.hit, miss.hit, '★ 两者的放行结论也必须不同')
  // ── 腿 C：端到端 —— prefilterEnabled:false ⇒ 文本**进判定**（开关有可观测差异）
  const judged = []
  const ctx = { async waterfall(_n, req) { judged.push(req.requestId); return { requestId: req.requestId, source: 'mana-long-term', value: 'yes', probability: 0.95, degraded: false, reason: null } } }
  const off = await mod.writeGate(ctx, null, { isRetired: () => null, write: () => {} },
    { sessionId: 's-pf', turnId: 1, requestId: 'r-pf-off', at: new Date().toISOString(), content: '跑一下测试', source: 'test' },
    { summarizeEnabled: false, prefilterEnabled: false })
  assert.equal(off.state, 'written', 'prefilterEnabled:false ⇒ 每条都进判定（开关的可观测差异）；实测 ' + off.state)
  assert.equal(judged.length, 1, '关掉预过滤 ⇒ 必须真进判定')
  assert.equal(off.prefilterOverlap, null, '未启用时 prefilterOverlap 必须为 null（"没测"不得冒充 0）')
  assert.equal(off.prefilterTable, null, '未启用时 prefilterTable 必须为 null')
})

// ══ ⑦ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1/pass 1 的假绿）═
test('⑦ 用例计数自检', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, '本文件声明 ' + String(EXPECTED_CASES) + ' 条，实跑 ' + String(ran) + ' 条 —— 数量不符说明有用例被删或被跳过')
})
