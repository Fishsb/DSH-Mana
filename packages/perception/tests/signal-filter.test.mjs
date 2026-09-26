/**
 * 信号词预筛判据（v10 §12.3）—— **把粗筛放回 perception 层级**。
 *
 * ── 为什么这条判据必须存在 ────────────────────────────────────────────────────
 * v10 附录 A 把「**信号词预筛**」写进 `dsh-mana-perception` 的职责，而本仓 2026-09-26 实测
 * 该环**零落点**。其后果不是"少个优化"，而是本席亲测的一条**归因错位链**：
 *   观察**无条件**流到 long-term 的 Write Gate ⇒ 那道门拿文本与**判定问法本身**
 *   （`'这条观察值得长期记住吗'`）比 bigram ⇒ 8 条真实风格内容**放行率仅 1/8**
 *   ⇒ memory_items 几乎不生长 ⇒ 评估面 L4 恒 NO_DATA。
 * ⚠ 而 `1/8` **看起来像"系统效果差"**，真因是**层级错位**（该在采集侧做的粗筛被放到判定侧）。
 *   ⇒ 本文件既判"预筛有效"，也判"**它的效果可被归因**"（读数不让两种事实同形）。
 *
 * ── 用真数据，不用夹具 ──────────────────────────────────────────────────────
 * 下面 `REALISTIC` 是**真实风格**的输入（偏好/决策/事实/纠正 + 寒暄/命令），
 * 不是为通过而编的字符串。判据同时断言**两类都必须被正确分流**：
 *   该过的过（否则会漏记）、该挡的挡（否则预筛等于装饰）。
 *
 * 运行：`node --test packages/perception/tests/signal-filter.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import {
  prefilterBySignalWords,
  mergeSignalTables,
  BUILTIN_SIGNAL_TABLE,
} from '../src/signal.ts'
import { DEFAULT_SIGNAL_WORDS } from '../src/signal-words.ts'

const EXPECTED_CASES = 9
let ran = 0

/** 真实风格输入：**该过的**（含跨会话可复用信息）。 */
const SHOULD_HIT = [
  '用户偏好开源方案，长期使用 WSL 做主力开发环境',
  '我决定采用方案 A，因为它的回归面更小',
  '记住：项目根目录在 /home/lk/Mana，测试用 npm test',
  '以后请用中文回复我，不要长篇大论',
  '纠正一下：那条断言不是漏了，其实是口径写反了',
  '重要：所有断言必须带可复跑命令',
]
/** 真实风格输入：**该挡的**（指令礼貌词/过程性闲聊，不含跨会话可复用信息）。 */
const SHOULD_MISS = [
  '帮我看看这个函数为什么报错',
  '跑一下测试',
  '嗯',
  '继续',
  '把那个文件打开',
  '现在几点了',
]

// ══ ① 纯函数面：该过的过 ══════════════════════════════════════════════════════
test('① 信号词预筛（真数据）：6 条应命中的真实风格输入**全部命中**', () => {
  ran += 1
  const got = SHOULD_HIT.map((t) => prefilterBySignalWords(t).state)
  const missed = SHOULD_HIT.filter((t) => prefilterBySignalWords(t).state !== 'hit')
  assert.equal(
    got.filter((x) => x === 'hit').length,
    SHOULD_HIT.length,
    '应命中的必须全中（**漏掉该记的东西**才是本环最坏的方向）；未命中=' + JSON.stringify(missed),
  )
})

// ══ ② 纯函数面：该挡的挡 ══════════════════════════════════════════════════════
test('② 信号词预筛（真数据）：6 条应挡下的真实风格输入**全部未命中**', () => {
  ran += 1
  const leaked = SHOULD_MISS.filter((t) => prefilterBySignalWords(t).state === 'hit')
  assert.equal(
    leaked.length,
    0,
    '应挡下的不得漏（否则预筛等于装饰）；漏网=' + JSON.stringify(leaked),
  )
})

// ══ ③ 三态可分辨：空文本 ≠ 未命中 ════════════════════════════════════════════
test('③ 三态：空文本是 empty（**不是** miss）—— "没内容"与"不重要"必须能分辨', () => {
  ran += 1
  assert.equal(prefilterBySignalWords('').state, 'empty', '空串必须落 empty')
  assert.equal(prefilterBySignalWords('   \n  ').state, 'empty', '纯空白必须落 empty')
  assert.equal(prefilterBySignalWords('跑一下测试').state, 'miss', '有内容但不含信号词 ⇒ miss')
  // 二者**不得**同名（同形即失败不可观测）
  assert.notEqual(prefilterBySignalWords('').state, prefilterBySignalWords('跑一下测试').state)
})

// ══ ④ 读数可归因：命中要说清命中了什么 ═══════════════════════════════════════
test('④ 可归因：命中时 hits 非空且逐词可查；未命中时给出文本长度与词表大小', () => {
  ran += 1
  const hit = prefilterBySignalWords('用户偏好开源方案')
  assert.ok(hit.state === 'hit' && hit.hits.length > 0, '命中必须给出命中的词')
  assert.ok(hit.hits.includes('偏好'), '实测命中词=' + JSON.stringify(hit.hits))
  const miss = prefilterBySignalWords('跑一下测试')
  assert.ok(miss.state === 'miss', '应为 miss')
  assert.equal(typeof miss.textChars, 'number', '未命中必须带 textChars（否则"为什么没中"不可查）')
  assert.ok(miss.tableSize > 0, '未命中必须带词表大小')
})

// ══ ⑤ 大小写不敏感（英文信号词在句首会大写）══════════════════════════════════
test('⑤ 大小写归一：句首大写的英文信号词必须命中（否则词表在一半输入上失效）', () => {
  ran += 1
  assert.equal(prefilterBySignalWords('Remember this: the port is 3088').state, 'hit', 'Remember 必须命中')
  assert.equal(prefilterBySignalWords('remember this').state, 'hit', '小写同样命中')
  assert.equal(prefilterBySignalWords('I prefer tabs').state, 'hit', 'prefer 必须命中')
})

// ══ ⑥ 词表可替换 + 领域词扩展（**预留扩展面**的判据）═════════════════════════
test('⑥ 扩展面：extraSignalWords 合并生效，且表名随之改变（"用的哪张表"可分辨）', () => {
  ran += 1
  const base = prefilterBySignalWords('这句含领域词：勾稽')
  assert.equal(base.state, 'miss', '内置词表不含「勾稽」⇒ 应 miss')
  const merged = mergeSignalTables(['勾稽'])
  const withExtra = prefilterBySignalWords('这句含领域词：勾稽', merged)
  assert.equal(withExtra.state, 'hit', '注入领域词后必须命中')
  assert.equal(withExtra.table, merged.name, '读数必须带**实际用的表名**')
  assert.notEqual(merged.name, BUILTIN_SIGNAL_TABLE.name, '扩展表的表名必须与内置不同（否则两件事同形）')
  // 只传空/无效词时**不换表**（免得表名虚增）
  assert.equal(mergeSignalTables([]).name, BUILTIN_SIGNAL_TABLE.name, '空扩展必须回退内置表名')
})

// ══ ⑦ 真装配：**显式开启**预筛后，perceive 真按预筛分流 ═══════════════════════
test('⑦ 真装配（显式开预筛）：emitted+filteredBySignal == 块数，且事件真只发通过的', async () => {
  ran += 1
  const ctx = new Context()
  ctx.plugin(await import('dsh-mana-core'), { storePath: ':memory:' })
  await new Promise((r) => setTimeout(r, 250))
  const perceptionMod = await import('../src/index.ts')
  ctx.plugin(perceptionMod, { maxChunkChars: 1200, chunkOverlapChars: 120, signalFilterEnabled: true, extraSignalWords: [] })
  await new Promise((r) => setTimeout(r, 250))

  const seen = []
  ctx.on('mana/observation', (obs) => seen.push(obs))
  const svc = ctx.get('mana-perception')
  // ⚠ 契约面：perceive 返回**发出块数**（number）；读数走 lastReading()
  //   （本席实测教训：把它改成对象会让全仓 20 处消费方连带失败 —— 那是拆东墙补西墙）
  assert.equal(typeof svc.lastReading(), 'object', '调用前：lastReading 必须可读（初始 null 也算可读）')
  assert.equal(svc.lastReading(), null, '"还没调用过" 必须是 null —— 与"调用过但全挡下"可分辨')

  // 该过的
  const passN = svc.perceive({ content: '记住：项目根目录在 /home/lk/Mana', sessionId: 's1', turnId: 1, requestId: 'r1' })
  assert.equal(passN, 1, '契约面：返回值恒为**发出块数**（number），含信号词 ⇒ 1')
  const passReading = svc.lastReading()
  assert.equal(passReading.emitted, 1, '读数 emitted 必须与返回值同源')
  assert.equal(passReading.filteredBySignal, 0, '这条不该被挡')

  // 该挡的
  const blockedN = svc.perceive({ content: '跑一下测试', sessionId: 's1', turnId: 2, requestId: 'r2' })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(blockedN, 0, '契约面：不含信号词的 ⇒ 返回 0（**不得**发出，否则预筛是装饰）')
  const blockedReading = svc.lastReading()
  assert.equal(blockedReading.emitted, 0, '读数 emitted=0')
  assert.equal(blockedReading.filteredBySignal, 1, '被挡的必须**可数**')
  assert.equal(seen.length, 1, '真事件条数必须等于 emitted 总数（读数与事实同源）')
  assert.equal(seen[0].content, '记住：项目根目录在 /home/lk/Mana', '发出的必须是**通过**的那条')
  // 逐块判定可复算
  assert.equal(blockedReading.verdicts.length, 1, '读数须带逐块判定')
  assert.equal(blockedReading.verdicts[0].state, 'miss', '被挡那条的判定必须是 miss')
})

// ══ ⑧ 开关有牙：关掉后同一输入必须全放行，且读数显示"没筛" ═══════════════════
test('⑧ 开关有牙：signalFilterEnabled=false ⇒ 该挡的也放行，且 filteredBySignal=0', async () => {
  ran += 1
  const ctx = new Context()
  ctx.plugin(await import('dsh-mana-core'), { storePath: ':memory:' })
  await new Promise((r) => setTimeout(r, 250))
  const perceptionMod = await import('../src/index.ts')
  ctx.plugin(perceptionMod, { maxChunkChars: 1200, chunkOverlapChars: 120, signalFilterEnabled: false, extraSignalWords: [] })
  await new Promise((r) => setTimeout(r, 250))
  const seen = []
  ctx.on('mana/observation', (obs) => seen.push(obs))
  const svc = ctx.get('mana-perception')
  const n = svc.perceive({ content: '跑一下测试', sessionId: 's1', turnId: 1, requestId: 'r1' })
  await new Promise((r2) => setTimeout(r2, 150))
  assert.equal(n, 1, '关掉预筛后必须全放行（返回值 = 1）')
  const r = svc.lastReading()
  assert.equal(r.emitted, 1, '关掉预筛后 emitted=1')
  assert.equal(r.filteredBySignal, 0, '关掉后 filteredBySignal 必须为 0')
  assert.equal(r.filterEnabled, false, '读数必须自带 filterEnabled（否则"关着"与"没筛"同形）')
  assert.equal(seen.length, 1, '关闭态下事件也必须真发出')
})

// ══ ⑨ 词表自检 + 用例计数（防本文件被截断）═══════════════════════════════════
test('⑨ 词表自检：无空词、无重复、数量与声明一致；用例计数相符', () => {
  ran += 1
  const words = DEFAULT_SIGNAL_WORDS
  assert.ok(words.length > 0, '词表不得为空（空表 ⇒ 预筛恒 miss ⇒ 假故障）')
  assert.equal(new Set(words).size, words.length, '词表不得有重复项（重复会虚增 score）')
  for (const w of words) {
    assert.ok(typeof w === 'string' && w.trim().length > 0, '不得含空词/纯空白词，实测=' + JSON.stringify(w))
  }
  assert.equal(ran, EXPECTED_CASES, `本文件声明 ${EXPECTED_CASES} 条用例，实跑 ${ran} 条`)
})
