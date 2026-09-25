/**
 * `mana-long-term` 软删除判据（**A2-6 / A2-7 的实现侧机检**）。
 *
 * 判据原文（`docs/mana-rollout-plan.md:521-522`，逐字）：
 *   · **A2-6 软删除可逆（字节级）**：`mem_forget` 后查 `retired`；`mem_restore` 后对
 *     `content` 取 `sha256` ⇒ **行数不变且 `retired=1`；恢复后哈希与删前相等**。
 *   · **A2-7 退休行不泄漏进检索**：检索 SQL 须 `AND retired=0` ⇒ 结果中 `retired=1`
 *     的 id 计数 **== 0**（附实测警告：**FTS 索引不会因 retired 自动剔除**）。
 *
 * ── 本文件守的四条纪律（逐条都有对应腿，不是声明）────────────────────────────────
 * ① **真数据经生产路径产生**：库一律由**真 core 插件**开（`ctx.plugin(coreMod)` 走
 *    `openManaDb`），行由 **`core.writeMemoryItem()`** 写入 —— 不是测试直写 INSERT。
 *    如此才测得到 FTS 同步触发器（触发器只对生产写入路径生效）。
 * ② **绝不指向生产库**：`storePath` 一律落在 `mkdtempSync(tmpdir())` 的新目录。
 * ③ **A2-7 双读法**：结果里自报的 `retiredIdsInHits` **不足以自证** ⇒ 另用
 *    `listRetiredIds()` 独立查得退休 id 集，再与 hits 求交（`leakedRetiredIds`）。
 * ④ **负向对拍打在真断言上**：对拍调用的是**判据本体**（`assertSoftDeleteReversible` /
 *    `assertRestoreByteIdentical`），不是另写一条弱断言 —— 否则"对拍绿"可能只是
 *    对拍自己没牙。（本仓纪律：没有负向对拍 = 没做完。）
 *
 * ⚠ **本文件的用例数本身也是判据**（与两份既有文件同口径）：实测**空文件**在显式路径下
 *   同样报 `# tests 1 / # pass 1 / exit 0`（计的是"文件加载成功"）⇒ 空/被截断是**假绿**。
 *   故本文件固定 **7** 条，末条为用例计数自检（少一条即红）。
 *   ⚠ 计数**必须同步登记**进 `verify.mjs` 的 `TEST_FILES`，否则本文件被清空时外部防线不报。
 *
 * 运行（**显式路径**）：node --test packages/long-term/tests/retirement.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url) // packages/
const SRC = new URL('../src/', import.meta.url)
const loadCore = () => import(new URL('core/src/index.ts', ROOT).href)
const loadSelf = (f) => import(new URL(f, SRC).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const R = await loadSelf('retirement.ts')
const { retireMemory, restoreMemory, searchLiveMemories, selectLiveMemoryById, readMemoryRow, countMemories,
  listRetiredIds, probeFtsIndex, leakedRetiredIds, sha256Hex, contentBytes,
  LIVE_SEARCH_SQL, LIVE_SELECT_SQL, RETIRED_FILTER_CLAUSE } = R

/**
 * 三条记忆的**中文**正文（trigram 检索需要 ≥3 字，且本仓实测默认分词器下中文恒 0 命中，
 * 必须走 `tokenize='trigram'` —— 见 `schema.ts` 的 G5 说明）。
 * ⚠ `HIT_A` 与 `HIT_R` **共享同一个 4 字词**，这样"去掉过滤腿"时**恰好多出那一条退休行**
 *   —— 泄漏与"查询本身没命中"在结果里可分辨，而不是一样都返回空。
 */
const HIT_A = '用户偏好开源免费优先，这条记忆用于验证软删除可逆性。'
const HIT_R = '已退休样本：也讲开源免费，但必须被检索过滤掉。'
const PLAIN = '无关记忆甲乙丙丁戊己'
const PLAIN_R = '无关记忆庚辛壬癸子丑'
const Q = '开源免费'
/**
 * 第二条查询词：**活行与退休行都含它**。
 *
 * ⚠ 为什么要第二条：只用 `Q` 时，"过滤腿把活行也滤掉"与"过滤腿正确"在结果上**同形**
 *   （都是只剩那条活行）。第二条词下 活行 2→1、退休行 1→0，两个方向同时可分辨。
 * ⚠ 查询串一律**不含标点**：trigram 分词对标点的处置不是本判据要测的东西，
 *   混进来只会让"0 命中"变成分词问题而不是过滤问题。
 */
const Q2 = '无关记忆'

const EXPECTED_CASES = 7
let ran = 0

/** 开一个**只属于本次用例**的真库（真 core 插件 → openManaDb → 建表 + FTS 触发器）。 */
async function mountCore(tag) {
  const ctx = new Context()
  const coreMod = await loadCore()
  const dir = mkdtempSync(join(tmpdir(), `mana-${tag}-`))
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(250)
  const core = ctx.get('mana-core')
  assert.ok(core, 'core 服务必须可读（未 provide = core 没跑起来，本用例会平凡通过）')
  // ⚠ 硬护栏：测试库**绝不**指向 $DSH_HOME/memory/mana.db（否则会把真库的 retired 位改掉）
  assert.ok(core.storePath.startsWith(dir), `测试库必须落在本用例的临时目录内；实测 ${core.storePath}`)
  return { ctx, core, db: core.db }
}

/** 经**生产写入路径**灌入 4 条（2 活 2 退休），返回 id 与删前读数。 */
async function seed(tag) {
  const { ctx, core, db } = await mountCore(tag)
  core.writeMemoryItem({ id: 'live1', type: 'episodic', content: HIT_A, summary: null })
  core.writeMemoryItem({ id: 'live2', type: 'episodic', content: PLAIN, summary: null })
  core.writeMemoryItem({ id: 'retired1', type: 'episodic', content: HIT_R, summary: null })
  core.writeMemoryItem({ id: 'retired2', type: 'episodic', content: PLAIN_R, summary: null })
  const beforeHash = sha256Hex(readMemoryRow(db, 'live1').content)
  const beforeBytes = contentBytes(readMemoryRow(db, 'live1').content)
  const beforeRows = countMemories(db).total
  retireMemory(db, 'retired1')
  retireMemory(db, 'retired2')
  return { ctx, core, db, beforeHash, beforeBytes, beforeRows }
}

// ══ 判据本体（负向对拍要**原样调用**它们，所以提成具名函数，不内联）══════════════
/** **A2-6 的断言体**：软删除后 ⇒ 行数不变 且 retired=1。 */
function assertSoftDeleteReversible(rowsBefore, outcome) {
  assert.equal(outcome.changed, true, 'A2-6：软删除必须真的改动了 retired 位')
  assert.equal(outcome.rowsAfter, rowsBefore, `A2-6：软删除后**行数必须不变**（删前 ${rowsBefore} / 删后 ${outcome.rowsAfter}）—— 不等即"物理删除永不发生"被违反`)
  assert.equal(outcome.retiredAfter, 1, `A2-6：软删除后 retired 必须为 1，实测 ${outcome.retiredAfter}`)
}
/** **A2-6 的恢复断言体**：恢复后 content 的 sha256 与删前**逐字节相等**。 */
function assertRestoreByteIdentical(hashBefore, hashAfter, bytesBefore, bytesAfter) {
  assert.equal(hashAfter, hashBefore, `A2-6：恢复后 content 的 sha256 必须与删前相等（删前 ${hashBefore} / 恢复后 ${hashAfter}）`)
  assert.equal(bytesAfter, bytesBefore, 'A2-6：字节数也须相等（哈希的互补读数）')
}

// ══ ① 过滤腿在册（判据自检：腿被删掉即红，而不是悄悄不生效）══════════════════════
test('① 过滤腿在册：LIVE_SEARCH_SQL / LIVE_SELECT_SQL 必须带 AND retired=0（判据自检）', () => {
  ran += 1
  assert.equal(typeof RETIRED_FILTER_CLAUSE, 'string', '过滤腿字面量必须导出（测试与调用方按此断言）')
  assert.ok(
    LIVE_SEARCH_SQL.includes(RETIRED_FILTER_CLAUSE),
    `A2-7 的检索 SQL **必须**含 "${RETIRED_FILTER_CLAUSE}"；实测 SQL 缺该腿 ⇒ 退休行会泄漏。SQL 原文：
${LIVE_SEARCH_SQL}`,
  )
  assert.ok(LIVE_SELECT_SQL.includes('retired = 0'), '按 id 读的查询同样必须带过滤腿（"任何返回记忆的查询"）')
  // 反向：腿若被写成 retired=1 或注释掉，本腿必须能分辨（防"含子串即通过"的假绿）
  assert.ok(!LIVE_SEARCH_SQL.includes('retired = 1'), '检索 SQL 不得出现 retired = 1（那是"只查退休行"，是反面）')
  assert.ok(!LIVE_SEARCH_SQL.includes('--'), 'SQL 常量内不得写行注释（本仓 DDL 半角注释已被切分器坑过）')
})

// ══ ② A2-6 软删除可逆（字节级）════════════════════════════════════════════════
test('② A2-6 软删除可逆（字节级）：行数不变 + retired=1 + 恢复后 sha256 相等', async () => {
  ran += 1
  const { db, beforeHash, beforeBytes, beforeRows } = await seed('a26')

  // ── 删前：该行活着、内容哈希在册
  const pre = readMemoryRow(db, 'live1')
  assert.equal(pre.retired, 0, '删前 live1 必须是 retired=0')
  assert.equal(sha256Hex(pre.content), beforeHash, '删前哈希须与取样一致（防取样到别的行）')

  // ── retire
  const out = retireMemory(db, 'live1')
  assertSoftDeleteReversible(beforeRows, out)
  // 软删除**不得**碰内容（A2-6 的"字节级"是对称的：删与恢复都不许动 content）
  assert.equal(out.contentSha256, beforeHash, 'retire 本身不得改动 content（只置位）')
  assert.equal(out.contentBytes, beforeBytes, 'retire 不得改动 content 的字节数')
  assert.equal(readMemoryRow(db, 'live1').content, HIT_A, 'retire 后 content 必须逐字节还是原文')

  // ── restore
  const back = restoreMemory(db, 'live1')
  assert.equal(back.changed, true, '恢复必须真的改动了 retired 位')
  assert.equal(back.retiredAfter, 0, '恢复后 retired 必须为 0')
  assert.equal(back.rowsAfter, beforeRows, '恢复后行数仍必须不变')
  assertRestoreByteIdentical(beforeHash, back.contentSha256, beforeBytes, back.contentBytes)
  // 逐字节相等（不止哈希相等）：哈希相等 + 原文相等两条腿合起来才排除"碰撞"与"取样错行"
  assert.equal(readMemoryRow(db, 'live1').content, HIT_A, '恢复后 content 必须与删前**逐字节**相等')

  // ── 幂等与非存在 id：不得静默当成功
  const again = restoreMemory(db, 'live1')
  assert.equal(again.changed, false, '已在目标态 ⇒ changed=false（"改过"与"本来就是"可分辨）')
  const ghost = retireMemory(db, 'not-in-db')
  assert.equal(ghost.existed, false, `id 不存在必须显式回报 existed=false（实测 ${ghost.existed}）—— 静默当成功会让"删了"与"啥也没删"同形`)
  assert.equal(ghost.contentSha256, null, 'id 不存在 ⇒ 不得给出哈希（null 而不是空串）')
  // 非法入参必须抛错，不得静默命中 0 行
  assert.throws(() => retireMemory(db, ''), /非空字符串/, '空 id 必须抛错（静默命中 0 行 = 静默失败）')
})

// ══ ③ A2-7 退休行不泄漏 + 机制腿（FTS 索引不因 retired 自动剔除）══════════════════
test('③ A2-7 退休行不泄漏：结果中 retired=1 计数 == 0；且退休行**确实还在 FTS 索引里**', async () => {
  ran += 1
  const { db } = await seed('a27')
  const counts = countMemories(db)
  assert.equal(counts.total, 4, `种下的物理行数须为 4，实测 ${counts.total}`)
  assert.equal(counts.retired, 2, `退休行须为 2，实测 ${counts.retired}`)
  assert.equal(counts.live, 2, `活行须为 2，实测 ${counts.live}`)

  // ── 生产检索
  const res = searchLiveMemories(db, Q)
  assert.ok(res.hits.length > 0, `Q='${Q}' 必须至少命中 1 条（0 命中时本判据平凡通过，不可接受）；实测 reason=${res.reason}`)
  assert.deepEqual(res.hits.map((h) => h.id), ['live1'], `命中集须恰为 ['live1']，实测 ${JSON.stringify(res.hits.map((h) => h.id))}`)

  // ── 双读法：结果自报 + **独立查得的退休 id 集**求交
  assert.deepEqual(res.retiredIdsInHits, [], 'A2-7：结果里 retired=1 的 id 计数必须 == 0（自报腿）')
  const retiredIds = listRetiredIds(db)
  assert.ok(retiredIds.length > 0, `本用例的退休 id 集必须非空（否则外部复核腿平凡通过）；实测 ${JSON.stringify(retiredIds)}`)
  assert.deepEqual(
    leakedRetiredIds(res.hits, new Set(retiredIds)),
    [],
    `A2-7：**外部复核**也必须为 0 泄漏；实测退休集=${JSON.stringify(retiredIds)}`,
  )
  // ── id 通道同样不得漏
  assert.equal(selectLiveMemoryById(db, 'retired1'), null, 'A2-7：按 id 读也必须过滤（否则泄漏换个通道继续）')
  assert.ok(readMemoryRow(db, 'retired1') !== null, '不过滤的读必须仍能看到该行（否则上一条会因为"行没了"而假绿）')

  // ── **机制腿**（A2-7 警告句「实测 FTS 索引不会因 retired 自动剔除」的可机检化）
  const rawIndex = probeFtsIndex(db, Q)
  assert.ok(
    rawIndex.includes('retired1'),
    `机制腿：退休行 **必须仍在 FTS 索引里**（实测 Q 的原始索引命中 = ${JSON.stringify(rawIndex)}）。` +
      '若这里红了，说明 FTS 的同步机制变了（例如触发器被改成按 retired 剔除）—— 那要**重新判定**过滤腿是否仍必要，' +
      '而不是顺手删掉它；本条是**机制哨兵**，红了要先看机制、再决定判据。',
  )
  // ── **去掉过滤腿即泄漏**（同一份数据、同一条 SQL，只差那一行）
  const filterless = LIVE_SEARCH_SQL.replace(RETIRED_FILTER_CLAUSE, '')
  assert.notEqual(filterless, LIVE_SEARCH_SQL, '负向对拍：去掉过滤腿必须真的改动了 SQL（否则测的是原 SQL）')
  const leaky = db.prepare(filterless).all(Q, 50).map((r) => String(r.id))
  assert.ok(leaky.includes('retired1'), `负向对拍：去掉过滤腿后**必须**泄漏出 retired1（实测 ${JSON.stringify(leaky)}）—— 这就是过滤腿的全部理由`)
  assert.ok(
    leakedRetiredIds(res.hits, new Set(retiredIds)).length === 0 && leakedRetiredIds(leaky.map((id) => ({ id })), new Set(retiredIds)).length > 0,
    '两条腿必须**可分辨**：带过滤腿 0 泄漏 / 去过滤腿 >0 泄漏（否则本用例证明不了过滤腿在起作用）',
  )
  // ── 0 命中的原因仍可分辨（不得只返回空数组）
  const none = searchLiveMemories(db, '库里绝对没有的词条')
  assert.equal(none.hits.length, 0, '无关词必须 0 命中')
  assert.equal(none.reason, 'ok', `库非空却 0 命中 ⇒ reason 须为 'ok'（真查过），实测 ${none.reason}`)
  assert.equal(none.librarySize, 4, 'reason 必须可被库规模交叉核对')
  assert.equal(searchLiveMemories(db, '短').reason, 'too_short', '过短查询必须是 too_short（trigram 下静默返回空集与"没有"同形）')
  // ── 第二条查询词：活行 2 条里 1 条命中，退休行 1 条必须被滤掉（两个方向都可分辨）
  const res2 = searchLiveMemories(db, Q2)
  assert.deepEqual(
    res2.hits.map((h) => h.id),
    ['live2'],
    `第二条词 '${Q2}' 下命中集须恰为 ['live2']（退休的 retired2 被滤掉、活行 live2 未被误滤）；实测 ${JSON.stringify(res2.hits.map((h) => h.id))}`,
  )
  const leaky2 = db.prepare(LIVE_SEARCH_SQL.replace(RETIRED_FILTER_CLAUSE, '')).all(Q2, 50).map((r) => String(r.id))
  assert.deepEqual(
    leaky2.sort(),
    ['live2', 'retired2'],
    `第二条词去过滤腿后**必须**同时命中活行与退休行（实测 ${JSON.stringify(leaky2)}）—— 这一对差值就是过滤腿的净效果`,
  )
})

// ══ ④ 负向对拍 A：把 `AND retired=0` 去掉 ⇒ A2-7 必须报红 ══════════════════════════
test('④ 负向对拍A：去掉过滤腿 ⇒ A2-7 的「泄漏 == 0」断言必须报红（打真断言）', async () => {
  ran += 1
  const { db } = await seed('mut-a27')
  const retiredIds = listRetiredIds(db)
  // ── A2-7 的断言体（与 ③ 同形）：命中里落在退休集内的必须为空
  const assertNoLeak = (hits) =>
    assert.deepEqual(leakedRetiredIds(hits, new Set(retiredIds)), [], 'A2-7：结果中 retired=1 的 id 计数必须 == 0')
  // 真（带腿）⇒ 不抛
  assert.doesNotThrow(() => assertNoLeak(searchLiveMemories(db, Q).hits), '带过滤腿时 A2-7 必须成立（否则 ③ 红了是别的原因）')
  // 变异（去腿）⇒ **必须**报红
  const filterless = LIVE_SEARCH_SQL.replace(RETIRED_FILTER_CLAUSE, '')
  const leakyHits = db.prepare(filterless).all(Q, 50)
  assert.throws(
    () => assertNoLeak(leakyHits),
    /A2-7/,
    '负向对拍失败：去掉过滤腿后 A2-7 **没有**报红 ⇒ 该判据没有牙（或对拍拍错了靶）',
  )
  // 变异 2：把腿改成恒真（retired = 0 写成 1 = 1）⇒ 同样必须报红
  const tautology = LIVE_SEARCH_SQL.replace(RETIRED_FILTER_CLAUSE, 'AND 1 = 1')
  assert.throws(() => assertNoLeak(db.prepare(tautology).all(Q, 50)), /A2-7/, '腿被换成恒真式也必须报红（防"外形还在、语义没了"）')
})

// ══ ⑤ 负向对拍 B/C：真 DELETE ⇒ 行数断言红；恢复动一字节 ⇒ sha256 断言红 ══════════════
test('⑤ 负向对拍B/C：retire 改真 DELETE / 恢复动一字节 ⇒ A2-6 的断言必须报红', async () => {
  ran += 1
  const { db, beforeHash, beforeBytes, beforeRows } = await seed('mut-a26')

  // ── B：把 retire 实现成**真 DELETE** ⇒ 「行数不变」必须报红（防 §8.3「物理删除永不发生」被违反）
  const victim = readMemoryRow(db, 'live2')
  assert.ok(victim, '对拍前置：live2 必须存在')
  db.prepare('DELETE FROM memory_items WHERE id = ?').run('live2')
  const rowsAfterDelete = countMemories(db).total
  assert.equal(rowsAfterDelete, beforeRows - 1, '对拍前置：真 DELETE 确实减了一行（否则本对拍测的不是 DELETE）')
  assert.throws(
    () =>
      assertSoftDeleteReversible(beforeRows, {
        changed: true,
        rowsAfter: rowsAfterDelete,
        retiredAfter: 0, // 物理删除后没有行可读 ⇒ 连 retired 也无处可谈
      }),
    /A2-6/,
    '负向对拍失败：把 retire 换成真 DELETE 后「行数不变」**没有**报红 ⇒ 该腿没有牙',
  )

  // ── C：restore 写回一个"副本"，只动**一个字节** ⇒ sha256 必须报红
  const ok = restoreMemory(db, 'live1')
  assert.doesNotThrow(() => assertRestoreByteIdentical(beforeHash, ok.contentSha256, beforeBytes, ok.contentBytes), '对照组：真 restore 必须过')
  // 造扰动：换掉一个**同字节长度**的字（'开源' → '開源'，两字皆 3 字节）⇒ 字节数不变而哈希必变
  const mutated = HIT_A.replace('开源', '開源')
  assert.notEqual(mutated, HIT_A, '对拍前置：扰动串必须真的不同')
  assert.equal(contentBytes(mutated), beforeBytes, '对拍前置：扰动串**字节数须与原文相同**（这样"字节数腿"抓不到，只有哈希腿能抓）')
  db.prepare('UPDATE memory_items SET content = ? WHERE id = ?').run(mutated, 'live1')
  const doctored = readMemoryRow(db, 'live1')
  assert.throws(
    () => assertRestoreByteIdentical(beforeHash, sha256Hex(doctored.content), beforeBytes, contentBytes(doctored.content)),
    /A2-6|字节数/,
    '负向对拍失败：恢复时动了一个字节却**没有**报红 ⇒ sha256 腿没有牙（或被字节数腿掩盖）',
  )
  // 反向补牙：**只**动一个字节的扰动必须同时被两条腿分别抓住（哈希腿独立成立）
  assert.notEqual(sha256Hex(doctored.content), beforeHash, '同长不同字 ⇒ 哈希必须变（证明哈希不是字节数的同义反复）')
})

// ══ ⑥ 真装配：软删除面经**服务面**可用（防"导出对了但没接进服务面"）══════════════════
test('⑥ 真装配：svc.retirement 逐项可用 + 经服务面复算 A2-6/A2-7', async () => {
  ran += 1
  const ctx = new Context()
  const coreMod = await loadCore()
  const mod = await loadSelf('index.ts')
  const dir = mkdtempSync(join(tmpdir(), 'mana-s21-svc-'))
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(250)
  const fiber = ctx.plugin(mod)
  await settle(300)
  const core = ctx.get('mana-core')
  const svc = ctx.get('mana-long-term')
  assert.ok(svc, 'mana-long-term 服务必须可读（未 provide = 插件没真跑起来）')
  const face = svc.retirement
  assert.ok(face && typeof face === 'object', '实现面清单已登记 retirement ⇒ service.retirement 不得缺席')
  for (const n of ['retire', 'restore', 'search', 'selectById', 'readRow', 'counts', 'retiredIds', 'probeIndex', 'leaked', 'assertNoLeak', 'hash', 'bytes']) {
    assert.equal(typeof face[n], 'function', `service.retirement.${n} 必须是函数（被搬走/改名即红）`)
  }
  assert.equal(face.filterClause, RETIRED_FILTER_CLAUSE, '服务面必须吐出同一份过滤腿字面量（不得另起一份）')
  assert.ok(face.liveSearchSql.includes(RETIRED_FILTER_CLAUSE), '服务面吐出的检索 SQL 必须带过滤腿')
  assert.ok(Array.isArray(mod.IMPLEMENTED_RETIREMENT_EXPORTS) && mod.IMPLEMENTED_RETIREMENT_EXPORTS.length === 12,
    `IMPLEMENTED_RETIREMENT_EXPORTS 必须登记 12 项，实测 ${mod.IMPLEMENTED_RETIREMENT_EXPORTS?.length}`)
  for (const n of mod.IMPLEMENTED_RETIREMENT_EXPORTS) {
    assert.notEqual(mod[n], undefined, `IMPLEMENTED_RETIREMENT_EXPORTS 里的 ${n} 必须真导出（清单写了个不存在的东西 ⇒ 清单失去意义）`)
  }
  // 服务面必须复用同一实现（不得另起一份）
  assert.equal(face.retire, retireMemory, '服务面须复用 retirement.ts 的同一实现')

  // ── 经服务面复算 A2-6
  core.writeMemoryItem({ id: 'svc1', type: 'episodic', content: HIT_A, summary: null })
  const rows0 = face.counts(core.db).total
  const h0 = face.hash(face.readRow(core.db, 'svc1').content)
  const out = face.retire(core.db, 'svc1')
  assertSoftDeleteReversible(rows0, out)
  const back = face.restore(core.db, 'svc1')
  assertRestoreByteIdentical(h0, back.contentSha256, face.bytes(HIT_A), back.contentBytes)

  // ── 经服务面复算 A2-7
  core.writeMemoryItem({ id: 'svc2', type: 'episodic', content: HIT_R, summary: null })
  face.retire(core.db, 'svc2')
  const res = face.search(core.db, Q)
  assert.deepEqual(face.leaked(res.hits, new Set(face.retiredIds(core.db))), [], 'A2-7（服务面）：0 泄漏')
  assert.doesNotThrow(() => face.assertNoLeak(res.hits, new Set(face.retiredIds(core.db))), 'assertNoLeak 在无泄漏时不得抛')
  assert.throws(
    () => face.assertNoLeak([{ id: 'svc2' }], new Set(face.retiredIds(core.db))),
    /泄漏/,
    '负向对拍：把一个退休 id 塞进 hits ⇒ assertNoLeak **必须**抛（否则它是条恒绿的装饰）',
  )

  // ── 形态面不得被本批改变：effect 仍恰好 3 条、服务卸载即净
  const labels = (fiber.getEffects() ?? []).map((e) => String(e.label))
  assert.equal(labels.length, 3, `本批不得新增 effect（仍须 3 条）；实测 ${labels.length}：${JSON.stringify(labels)}`)
  await fiber.dispose()
  await settle(300)
  assert.equal(ctx.get('mana-long-term'), undefined, '卸载后服务必须消失（"卸载即净"）')
})

// ══ ⑦ 用例计数自检（防本文件被截断/掏空）════════════════════════════════════════
test('⑦ 用例计数自检 + 判据字面量在册', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const declared = (self.match(/^test\(/gm) ?? []).length
  assert.equal(declared, EXPECTED_CASES, `本文件 test( 声明数须为 ${EXPECTED_CASES}，实测 ${declared}`)
  for (const s of ['assertSoftDeleteReversible', 'assertRestoreByteIdentical', 'sha256Hex', 'leakedRetiredIds', 'probeFtsIndex']) {
    assert.ok(self.includes(s), `${s} 必须出现在本文件里（判据被换成软断言即红）`)
  }
  for (const helper of ['assert.ok(', 'assert.equal(', 'assert.throws(']) {
    assert.ok(self.split(helper).length - 1 >= 5, `${helper} 调用数过少（判据被掏空即红）`)
  }
})
