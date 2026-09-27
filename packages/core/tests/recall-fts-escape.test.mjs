/**
 * H1 判据：`recallLexical` 的 **FTS5 MATCH 表达式转义**（2026-09-27）
 *
 * ── 被判的缺陷（修前实测原文，非推测）──────────────────────────────────────────
 * `recallLexical` 曾把**原始用户查询**直接绑进 `memory_items_fts MATCH ?`。
 * 而 `MATCH` 的参数是**查询表达式**，不是纯文本 ⇒ 两个后果：
 *
 *   ① 含 FTS5 语法字符的查询**直接抛错**（修前原始输出）：
 *        RAW "/home/lk/Mana"  =>  ERR fts5: syntax error near "/"
 *        RAW "a\"b"           =>  ERR unterminated string
 *      ⇒ 用户问一句**含路径**的话，召回**整个失败**。
 *
 *   ② 空格被当 **AND** 运算符 ⇒ 短语被拆成词与：
 *        RAW "方案 A"  =>  0 条      引 "方案 A"  =>  1 条命中
 *      ⇒「库里有却查不出」——"召回效果差"的**假象来源**。
 *
 * ── 修法 ──────────────────────────────────────────────────────────────────────
 * 绑定的仍是参数（SQL 串恒为 `MATCH ?`，**不引入注入面**），只把**参数内容**
 * 换成合法短语 `buildFtsPhrase(checked.query)`（双引号包裹、内部 `"` 双写）。
 * FTS5 若**仍**拒绝该表达式 ⇒ 抛**具名** `FtsQueryError`（`isFtsQueryError` 可判）。
 *
 * ── 本文件的判据纪律 ──────────────────────────────────────────────────────────
 * · **有牙**：F1/F2/F4/F7 在修前的实现上**必红**（不是"跑过就算"）；
 * · **两向都判**：该命中的必须命中（F1/F2），**确实无关的必须仍 0 命中**（F3）
 *   —— 不许为了"不抛错"退化成"永不空手"；
 * · **不改写触发面**：全程走生产入口 `svc.recallLexical`，不手搓 SQL 绕过被测路径。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CORE = new URL('../src/index.ts', import.meta.url).href
const { openManaDb, apply, buildFtsPhrase, FtsQueryError, isFtsQueryError } = await import(CORE)

const cleanups = []
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

function makeService() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-ftsesc-'))
  cleanups.push(dir)
  const opened = openManaDb({ path: join(dir, 'mana.db') })
  let svc = null
  const ctx = {
    effect(fn) {
      const d = fn()
      return () => (typeof d === 'function' ? d() : undefined)
    },
    provide(_n, s) {
      svc = s
      return () => {
        svc = null
      }
    },
    get: (n) => (n === 'mana-core' ? svc : undefined),
    on: () => () => {},
  }
  apply(ctx, {
    storePath: opened.path,
    busyTimeoutMs: 5000,
    autoMigrate: true,
    backupEnabled: false,
    backupIntervalMs: 3600000,
    backupKeep: 2,
    backupDir: '',
  })
  assert.ok(svc, 'apply() 应 provide mana-core')
  return { svc, close: () => opened.close() }
}

/** 修前实测会抛错的"含路径"查询 —— 本文件的头号正例。 */
const PATH_QUERY = '/home/lk/Mana'
/** 修前实测 0 命中（被当 AND）的含空格短语。 */
const SPACE_QUERY = '方案 A'

function seed(svc) {
  svc.writeMemoryItem({ id: 'm-path', type: 'note', content: '项目根目录在 /home/lk/Mana/.dsh 下面' })
  svc.writeMemoryItem({ id: 'm-phrase', type: 'note', content: 'Mana 清单：方案 A 已经落地' })
  // ⚠ **判据的牙**：本条**同时含** `方案` 与 `A`，但**不含**短语 `方案 A`。
  //   修前（空格=AND）它会**被命中**；修后（短语）它**必须落空** ⇒ 二者可分辨。
  svc.writeMemoryItem({ id: 'm-andonly', type: 'note', content: '方案已定，A 组负责' })
  svc.writeMemoryItem({ id: 'm-npm', type: 'note', content: 'npm test 与 npm run build 的差别' })
}

// ── F1（卡①）含 `/` 的路径查询：不抛错 **且** 命中 ──────────────────────────
test('F1 含 / 的路径查询不再抛错且命中（修前：ERR fts5 syntax error near "/"）', () => {
  const { svc, close } = makeService()
  seed(svc)

  // 修前此处**直接抛**（整个召回失败）；断言"不抛"本身就是判据的一半。
  let r
  assert.doesNotThrow(() => {
    r = svc.recallLexical(PATH_QUERY)
  }, '含 / 的查询不得再抛错（修前抛 fts5: syntax error near "/"）')

  assert.ok(r.hits.length >= 1, `路径查询必须命中（修前抛错，命中无从谈起）。reason=${r.reason}`)
  assert.equal(r.hits[0].id, 'm-path')
  assert.equal(r.reason, null, '有命中时 reason 必须为 null')
  close()
})

// ── F2（卡②）含空格短语：按**短语**匹配，不按词与 ────────────────────────────
test('F2 含空格短语按短语匹配（方案 A 修前 0 条 → 修后命中；且不误命中词与项）', () => {
  const { svc, close } = makeService()
  seed(svc)

  const r = svc.recallLexical(SPACE_QUERY)
  const ids = r.hits.map((h) => h.id)
  // ① 正例：短语真在库里的必须命中（修前 0 条）
  assert.ok(ids.includes('m-phrase'), `「${SPACE_QUERY}」必须命中 m-phrase（修前被当 AND 而 0 命中）：${JSON.stringify(ids)}`)
  // ② 负例（**判据的牙**）：只有 `方案`+`A` 两个词、没有该短语的行**不得**被命中。
  //    若实现退回"词与"语义，本断言必红。
  assert.ok(!ids.includes('m-andonly'), `短语语义被破坏：「方案」与「A」同现但无该短语的行被误命中：${JSON.stringify(ids)}`)
  assert.equal(r.reason, null)
  close()
})

// ── F3（卡③ 负向）确实无关的查询必须**仍 0 命中**（不得退化成"永不空手"）──────
test('F3 无关查询仍 0 命中（未为了"不抛错"退化成永不空手）', () => {
  const { svc, close } = makeService()
  seed(svc)

  for (const q of ['量子纠缠退相干', '拜占庭将军问题的解法', '/nonexistent/zzz/path']) {
    let r
    assert.doesNotThrow(() => {
      r = svc.recallLexical(q)
    }, `「${q}」不得抛错`)
    assert.equal(r.hits.length, 0, `「${q}」与库内容无关 ⇒ 必须 0 命中（否则判据失去否定面）`)
    // 库非空 ⇒ 0 命中的分类必须是 ok（"真查了就是 0"），不得是 empty_library
    assert.equal(r.reason, 'ok', `「${q}」0 命中的分类应为 ok（库非空）`)
    assert.ok(r.librarySize > 0, '库非空（否则本负向判据不成立）')
  }
  close()
})

// ── F4（卡④）FTS5 拒绝表达式 ⇒ **具名**失败，且**不混进 0 命中** ──────────────
test('F4 FTS5 拒绝表达式时失败态有名字，不混进 0 命中', () => {
  const { svc, close } = makeService()
  seed(svc)

  // 实测：内含 U+0000 的文本 ⇒ 即便包成短语，FTS5 仍拒绝（unterminated string）。
  const BAD = '\u0000\u0000\u0000'
  let caught = null
  try {
    const r = svc.recallLexical(BAD)
    // 走到这里说明**被吞成了 0 命中** —— 正是本判据要判红的形态
    assert.fail(`FTS5 拒绝表达式时不得返回结果（那会把"查询坏了"与"库里没有"压成同形）：${JSON.stringify(r)}`)
  } catch (error) {
    caught = error
  }

  // ① 必须是**具名**错误（不是裸 SQLite 错）
  assert.equal(caught.name, 'FtsQueryError')
  assert.ok(caught instanceof FtsQueryError, '应抛出 FtsQueryError 实例')
  assert.ok(isFtsQueryError(caught), 'isFtsQueryError 必须认得自家错误')
  // ② 必须**指出肇事查询**（裸错做不到这点）
  assert.equal(caught.query, BAD, 'FtsQueryError 必须带上原始查询串')
  // ③ 必须保留 FTS5 的原因原文（可归因）
  assert.match(caught.message, /FTS5 拒绝了查询表达式/, 'message 须说明这是"查询被拒"')
  assert.ok(caught.phrase.length > 0, '须带实际绑定的短语形态')
  close()
})

// ── F4b（F4 的**负控**）分类器不得靠字符串匹配去猜 ───────────────────────────
test('F4b isFtsQueryError 只认具名类：裸 SQLite 错不得被认成"查询被拒"', () => {
  // 若哪天有人把判据改成 `/syntax error/.test(message)`，这两条必红（**判据的牙**）。
  assert.equal(isFtsQueryError(new Error('fts5: syntax error near "/"')), false, '裸错不得被归入 FtsQueryError')
  assert.equal(isFtsQueryError(new Error('no such function: vec_version')), false, '别的错不得被归入 FtsQueryError')
  assert.equal(isFtsQueryError(null), false)
  assert.equal(isFtsQueryError(undefined), false)
  assert.equal(isFtsQueryError('syntax error'), false)
})

// ── F5 短语转义规则本身（`"` 双写）+ 含引号查询不再抛 `unterminated string` ──
test('F5 短语转义：内部双引号双写；含引号的查询不再抛 unterminated string', () => {
  // 规则层面（可直接断言的字符串事实）
  assert.equal(buildFtsPhrase('abc'), '"abc"')
  assert.equal(buildFtsPhrase('a"b'), '"a""b"', '内部 " 必须双写（FTS5 转义规则）')
  // 两个源引号各双写 = 4 个，加收尾的 1 个 ⇒ 尾部共 5 个引号（用 repeat 写死数量，避免数错）
  assert.equal(buildFtsPhrase('he said ""'), '"he said ' + '"'.repeat(5))
  assert.equal(buildFtsPhrase('方案 A'), '"方案 A"')

  // 端到端：修前 `a"b` 抛 ERR unterminated string
  const { svc, close } = makeService()
  seed(svc)
  let r
  assert.doesNotThrow(() => {
    r = svc.recallLexical('a"b')
  }, '含引号的查询不得再抛 unterminated string')
  assert.equal(r.hits.length, 0, '库里没有 a"b ⇒ 0 命中')
  assert.equal(r.reason, 'ok', '库非空 ⇒ 分类为 ok（真查了就是 0）')
  close()
})

// ── F6（卡要求 #2 回归）`too_short` 那条腿**不许被改坏** ─────────────────────
test('F6 回归：短查询仍走 too_short（trigram 既有语义未被本次改动碰坏）', () => {
  const { svc, close } = makeService()
  seed(svc)

  const short = svc.recallLexical('末那')
  assert.equal(short.reason, 'too_short', '2 字查询必须仍被显式归类')
  assert.equal(short.hits.length, 0)
  assert.equal(short.normalizedQuery, null, '被长度闸挡下时 normalizedQuery 仍为 null')

  // 库空那条腿也不许被碰坏
  const { svc: svc2, close: close2 } = makeService()
  const empty = svc2.recallLexical('末那识的记忆')
  assert.equal(empty.reason, 'empty_library', '库空仍应为 empty_library')
  assert.equal(empty.librarySize, 0)
  close2()
  assert.ok(svc.recallLexical('npm test').hits.length >= 1, '正常查询仍可召回（未把整条腿改死）')
  close()
})

// ── F7（卡要求 #3）SQL 注入面：仍走参数绑定，注入形态串只被当**文本** ────────
test('F7 参数绑定未被绕过：注入形态串被当普通文本，表结构完好', () => {
  const { svc, close } = makeService()
  seed(svc)

  const INJ = "'; DROP TABLE memory_items; --"
  let r
  assert.doesNotThrow(() => {
    r = svc.recallLexical(INJ)
  }, '注入形态串不得让查询炸掉（那说明它被当成了语法）')
  assert.equal(r.hits.length, 0, '注入串不是库中内容 ⇒ 0 命中')
  assert.equal(r.reason, 'ok')

  // 表必须还在（真被当 SQL 执行的话，这里就查不到了）
  for (const t of ['memory_items', 'memory_items_fts']) {
    const row = svc.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
      .get(t)
    assert.ok(row, `表 ${t} 必须完好（注入串不得被当 SQL 执行）`)
  }
  // 且检索腿在注入尝试后**仍正常工作**（不是"没删表但腿废了"）
  assert.ok(svc.recallLexical('npm test').hits.length >= 1, '注入尝试后检索腿必须仍可用')
  close()
})
