/**
 * A1-8 判据：门控失败可区分（`jev_log.gate` 取值域 + degraded 至少一个非空）
 *
 * 判据原文（`docs/mana-rollout-plan.md:458`）：
 *   Write → `gate in (unavailable,budget)` 且行仍写入；
 *   Recall → `degraded=1` 且返回有序 items；
 *   Injection → 注入块数 **== 0**。
 *   且 `jev_log.degraded` 与 `gate` **至少一个非空**。
 *
 * ⚠ **本判据的机制前置是本仓 2026-09-25 实测修出来的**：
 *   原文声称要读 `jev_log.gate`，而 **该列从未建过** —— DDL 注释里甚至写着
 *   「A1-8 要求 degraded 与 gate 至少一个非空」，但列不存在 ⇒ 判据**结构上不可执行**
 *   （查一列不存在的列）。这正是本仓反复出现的「声明与生效不一致」。
 *   ⇒ 补列（含 CHECK 限定 + 经 ADR-6 迁移机制对存量库生效），并为本判据建可执行测试。
 *
 * ⚠ **2026-09-25 第二轮实测修出的第二种缺陷：夹具自证**（本席 S7 的写面之一）。
 *   补列之后本文件是**自己写 SQL 直塞 gate**（`insert()` 夹具）——
 *   于是 A1-8 的绿只能推出「列存在 + CHECK 约束存在」，
 *   **推不出「运行态可归因」**：生产写者 `writeJevLog` 的 INSERT 列清单里根本没有 gate，
 *   真降级跑一百次也不会落一个 gate 值，而判据照样全绿（夹具替生产写了）。
 *   ⇒ 本轮做了三件事，**缺一不可**：
 *     ① 生产侧补写 gate（`packages/jev/src/jev-log-gate.ts`：列清单 + 归因规则 + 写口；
 *        `ollama.ts` 的 `writeJevLog` 复用它）——非降级**显式 null**，不用 0/空串冒充；
 *     ② 本文件**删掉夹具直写**：库里的行**一律**由生产通道写（G1/G2/G3 全部走生产写口）；
 *     ③ 加**负向腿 G6**：把 gate 从生产 INSERT 列清单里去掉 ⇒ 本文件的判据必须判红，
 *        并断言「判据真的在检查这件事」而不是在检查夹具。
 *
 * ⚠ A1-8 的三条支路里，**Injection 那一支已由 `injection-gate.test.mjs` 覆盖**
 *   （fail-closed 块数 == 0 且留痕）；本文件聚焦 **Write 支路**（fail-open 仍写入 + gate 归因）
 *   与 **字段层不变式**（degraded/gate 至少一个非空）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const CORE = new URL('../src/index.ts', import.meta.url).href
const JEV_OLLAMA = new URL('../../jev/src/ollama.ts', import.meta.url).href
const JEV_FRAMEWORK = new URL('../../jev/src/framework.ts', import.meta.url).href
const JEV_PRODUCER = new URL('../../jev/src/jev-log-gate.ts', import.meta.url).href

const { openManaDb, createSchema } = await import(CORE)
const { judgeWithOllama } = await import(JEV_OLLAMA)
const { JevGuard, judgeWithGuard } = await import(JEV_FRAMEWORK)
const { writeJevLogRow, jevLogColumnCount } = await import(JEV_PRODUCER)

const cleanups = []
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'mana-a18-'))
  cleanups.push(d)
  return d
}

/** A1-8 的词表（判据原文：gate in (unavailable,budget)）。 */
const GATE_VOCAB = ['unavailable', 'budget']

/** 开一个临时库（走 core 的真 schema），返回句柄与读行口。 */
function openTmp() {
  const dir = tmpDir()
  const opened = openManaDb({ path: join(dir, 'mana.db') })
  const db = opened.db
  return {
    db,
    close: () => opened.close(),
    rows: (where = '') => db.prepare(`SELECT * FROM jev_log${where ? ` WHERE ${where}` : ''} ORDER BY rowid`).all(),
  }
}

/** 恒不可达的通道（判据原文: Write → gate='unavailable'）。 */
const unreachableFetch = async () => {
  throw new Error('ECONNREFUSED 127.0.0.1:11434')
}
/** 一个**正常**响应（判据原文的反面对照：非降级行不得被记成门控失败）。 */
const okFetch = async () =>
  new Response(
    JSON.stringify({
      logprobs: [{ top_logprobs: [{ token: 'Yes', logprob: Math.log(0.9) }, { token: 'No', logprob: Math.log(0.05) }] }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )

/**
 * A1-8 的判据本体（G2/G3/G6 共用；G6 拿它去证明「它有牙」）。
 *
 * 断言的是**生产路径写入的行**：`degraded=1 ⟺ gate 非空`。
 * 这条比原文的「至少一个非空」更强，且它是**可判定**的：
 *   · 降级却 gate 为 null ⇒ 门控失败没有归因（判据原文要的正是这条）；
 *   · 不降级却带 gate ⇒ gate 被当装饰，真实失败反而认不出来。
 */
function assertGateAttribution(rows) {
  assert.ok(rows.length > 0, '库里必须有行（否则是空集上平凡通过）')
  for (const r of rows) {
    if (r.degraded === 1) {
      assert.ok(
        GATE_VOCAB.includes(r.gate),
        `行 ${r.id}：degraded=1 但 gate=${JSON.stringify(r.gate)}（须落在词表 ${GATE_VOCAB.join('/')} 内）`,
      )
    } else {
      assert.equal(
        r.gate,
        null,
        `行 ${r.id}：非降级却带 gate=${JSON.stringify(r.gate)}（"无门控失败"与"有失败"必须可分辨）`,
      )
    }
  }
  return rows
}

// ── G1（A1-8 机制前置）列存在 + 取值域受限（写入一律经生产写口）──────────────
test('G1 A1-8：jev_log.gate 列存在，且 CHECK 限定 unavailable/budget', () => {
  const { db, close, rows } = openTmp()

  const cols = db.prepare('PRAGMA table_info(jev_log)').all().map((r) => String(r.name))
  assert.ok(cols.includes('gate'), `jev_log 必须含 gate 列（A1-8 要读它），实有=${cols.join(',')}`)

  // 列清单与取值数**同源**（加列忘了加值时 jevLogRowParams 抛错，不静默少写一列）
  assert.equal(jevLogColumnCount(), 14, `生产 INSERT 列清单应为 14 列（含 gate），实得 ${jevLogColumnCount()}`)

  // 合法值可写 —— 用**生产写口**（不是测试自拼 SQL）
  const mk = (id, gate, degraded) => ({
    id,
    requestType: 'write_gate',
    source: 'test',
    stateHash: 'h',
    value: degraded ? 'unknown' : 'yes',
    probability: null,
    cached: false,
    degraded,
    gate,
    latencyMs: null,
    costUsd: null,
    sessionId: 's1',
    turnId: 1,
    atIso: new Date().toISOString(),
  })
  writeJevLogRow(db, mk('ok-1', 'unavailable', true))
  writeJevLogRow(db, mk('ok-2', 'budget', true))
  // 非法值必须被拒（否则"门控失败可区分"无从谈起）—— 走的还是生产写口，故验的是 DB 的第二道防线
  assert.throws(() => writeJevLogRow(db, mk('bad-1', 'bogus', true)), /CHECK constraint failed/, '非法 gate 必须被拒')
  // NULL 是合法的（正常路径无门控失败）
  writeJevLogRow(db, mk('null-1', null, false))
  assert.equal(rows().length, 3, '两行合法 + 一行 null；非法那行不得落库')
  close()
})

// ── G2（A1-8 Write 支路 · 生产路径）真降级 ⇒ fail-open 仍写行，且 gate 落在词表内 ──
test('G2 A1-8：Write Gate 失败时 fail-open 仍写行，且 gate 落在词表内', async () => {
  const { db, close, rows } = openTmp()

  // 两种失败各造一次（判据原文：Write → gate in (unavailable,budget)）。
  // ⚠ 都不是夹具：值是**生产写者**按降级原因归因出来的。
  // ① unavailable：判定通道真不可达（注入 fetchImpl 抛 ECONNREFUSED）
  const outA = await judgeWithGuard({
    guard: new JevGuard(),
    state: 'S',
    question: 'Q-unavailable',
    db,
    sessionId: 's1',
    // ⚠ 用 idFactory 而不是 requestId：护栏的**拒绝路径**（预算/熔断）不走判定通道，
    //   它的 id 只认 idFactory（见 framework.ts 的 refused()）——只给 requestId 会得到一个随机 uuid，
    //   于是"按 id 找行"会静默找不到（实测踩到：byId.get('w-budget') === undefined）。
    idFactory: () => 'w-unavail',
    requestType: 'write_gate',
    fetchImpl: unreachableFetch,
  })
  // ② budget：护栏预算闸拒绝（sessionBudget=0 ⇒ 一次都不放行，reason 可枚举）
  const outB = await judgeWithGuard({
    guard: new JevGuard({ sessionBudget: 0 }),
    state: 'S',
    question: 'Q-budget',
    db,
    sessionId: 's1',
    idFactory: () => 'w-budget',
    requestType: 'write_gate',
    fetchImpl: unreachableFetch,
  })
  // ③ 反面对照：**正常**判定不得被记成门控失败（否则"永远记 unavailable"也能骗过上面两条）
  const outC = await judgeWithOllama({
    state: 'S',
    question: 'Q-ok',
    db,
    idFactory: () => 'n-ok',
    requestType: 'write_gate',
    fetchImpl: okFetch,
  })
  assert.equal(outA.degraded, true, '① 前置：通道不可达必须是降级')
  assert.equal(outB.degraded, true, '② 前置：预算用尽必须是降级')
  assert.equal(outC.degraded, false, '③ 前置：正常响应必须不降级')

  const all = rows("request_type = 'write_gate'")
  assert.equal(all.length, 3, '失败也**必须留下行**（fail-open 仍写入）—— 不留痕则失败不可观测')
  assertGateAttribution(all)

  const byId = new Map(all.map((r) => [r.id, r]))
  assert.deepEqual(
    [byId.get('w-unavail').gate, byId.get('w-budget').gate, byId.get('n-ok').gate],
    ['unavailable', 'budget', null],
    '两种失败必须**可分辨**（通道不可用 / 预算用尽），且正常路径必须是 null（不可用与零值可分辨）',
  )
  // 归因与 reason 对得上（gate 不是装饰：它必须能从可枚举的 reason 推出来）
  assert.match(String(outA.reason), /^ollama-/, '① 的降级原因应可枚举（ollama-* 前缀）')
  assert.match(String(outB.reason), /^jev-session-budget-exceeded/, '② 的降级原因应可枚举（jev- 前缀）')
  close()
})

// ── G3（A1-8 字段层不变式 · 生产路径）degraded 与 gate 的关系 ────────────────
test('G3 A1-8：每行的 degraded 与 gate 至少一个非空（不得双双缺席）', async () => {
  const { db, close, rows } = openTmp()

  // 正常判定：degraded=0 且 gate=null ⇒ 两者都是"无异常"的表达，合法
  await judgeWithOllama({ state: 'S', question: 'Q1', db, requestId: 'n-1', requestType: 'write_gate', fetchImpl: okFetch })
  // 降级（通道不可用）：degraded=1 承载信息 ⇒ 合法（"至少一个非空"）
  await judgeWithOllama({ state: 'S', question: 'Q2', db, requestId: 'n-2', requestType: 'write_gate', fetchImpl: unreachableFetch })
  // 门控失败（预算）：gate='budget' 且 degraded=1
  await judgeWithGuard({
    guard: new JevGuard({ sessionBudget: 0 }),
    state: 'S',
    question: 'Q3',
    db,
    sessionId: 's3',
    idFactory: () => 'n-3',
    requestType: 'write_gate',
    fetchImpl: unreachableFetch,
  })

  const all = rows()
  for (const r of all) {
    const hasSignal = r.degraded === 1 || (r.gate !== null && r.gate !== '')
    assert.ok(hasSignal || (r.degraded === 0 && r.gate === null), `行 ${r.id} 字段不自洽`)
  }
  // 关键不变式：**gate 非空 ⇒ degraded=1**（有门控失败却标没降级 = 自相矛盾）
  for (const r of all.filter((x) => x.gate !== null)) {
    assert.equal(r.degraded, 1, `行 ${r.id} 有 gate=${r.gate} 却标 degraded=0（自相矛盾）`)
  }
  assertGateAttribution(all)
  close()
})

// ── G4（迁移承接）存量库经 createSchema 长出 gate 列 ───────────────────────
test('G4 A1-8：存量库经 createSchema 后长出 gate 列（ADR-6 迁移机制承接）', () => {
  const dir = tmpDir()
  const legacy = new DatabaseSync(join(dir, 'old.db'), { allowExtension: true })
  legacy.exec(`CREATE TABLE jev_log (
    id TEXT PRIMARY KEY, request_type TEXT NOT NULL, source TEXT NOT NULL, state_hash TEXT,
    result_value TEXT, probability REAL, cached INTEGER DEFAULT 0, degraded INTEGER DEFAULT 0,
    latency_ms INTEGER, cost_usd REAL, session_id TEXT, turn_id INTEGER, created_at TEXT NOT NULL)`)
  assert.ok(!legacy.prepare('PRAGMA table_info(jev_log)').all().some((r) => r.name === 'gate'), '前置：老库无 gate')

  createSchema(legacy)
  const after = legacy.prepare('PRAGMA table_info(jev_log)').all().map((r) => r.name)
  assert.ok(after.includes('gate'), '迁移后老库必须有 gate 列（否则 A1-8 在存量库上仍不可执行）')
  legacy.close()
})

// ── G5（A1-8 Recall 支路）降级时返回**有序** items ─────────────────────────
test('G5 A1-8：Recall 降级返回有序 items（degraded=1 且排序依据可枚举）', async (t) => {
  // 该支路的生产实现在 vector 席（`degraded===true` + `rankBy='local_score'`），
  // A1-11 已覆盖其可枚举字段断言；此处只钉**次序性**这一半（A1-8 原文要求"有序"）。
  const VEC = new URL('../../vector/src/recall.ts', import.meta.url).href
  let mod
  try {
    mod = await import(VEC)
  } catch {
    assert.fail('vector recall 模块不可导入 ⇒ 本支路无法验证（不得当作通过）')
  }
  const fn = mod.sortByLocalScore ?? mod.rankByLocalScore ?? mod.orderByLocalScore
  if (typeof fn !== 'function') {
    // 找不到具名导出 ⇒ **显式记录未验证**，不静默放过。
    // ⚠ 如实标注：这一支**本文件不检查任何东西**（它是挂账态，不是 PASS）——
    //   下面这条 assert 恒真，只用于把 t.diagnostic 带出来，使"空过"在 TAP 输出里可见
    //   （本仓纪律：夹具绿 ≠ 真数据绿；判据不得以"没断言"冒充"断过了"）。
    t.diagnostic(
      'G5 未验证：vector/src/recall.ts 未导出排序纯函数（sortByLocalScore/rankByLocalScore/orderByLocalScore 皆无）' +
        ' ⇒ 本项只证明"该支路当前无独立可判对象"，不代表 Recall 降级有序性成立',
    )
    assert.ok(true, '未找到排序纯函数导出 ⇒ 该半边挂账（不构成 PASS；A1-11 覆盖真实降级路径的字段面）')
    return
  }
  const out = fn([
    { key: 'a', localScore: 0.2 },
    { key: 'b', localScore: 0.9 },
    { key: 'c', localScore: 0.5 },
  ])
  assert.deepEqual(out.map((x) => x.key), ['b', 'c', 'a'], '降级路径必须给出**确定次序**')
})

// ── G6（A1-8 负向腿 · 有牙自证）gate 从生产 INSERT 列清单去掉 ⇒ 本判据必须红 ────
/**
 * 这一条是 G2/G3 的**有牙自证**：判据不能只在"生产写者写对了"的世界上绿。
 * 做法（纯内存克隆，**不写回仓内任何源文件**，与 `tools/a1-check.mjs` 同口径）：
 *   ① 把 `jev-log-gate.ts` 的列清单里 `gate` 去掉（连同对应的值）—— 那是"忘了写 gate"这个真缺陷；
 *   ② 把 `ollama.ts` 的 `./jev-log-gate.ts` import 改指克隆体 ⇒ 拿到的是**同一个生产函数**
 *      （`writeJevLog`），只是列清单被注入了缺陷；
 *   ③ 拿**真降级**的 outcome 经它落库 ⇒ 若判据仍有牙，`assertGateAttribution` 必须抛。
 * ⚠ 若这条腿不抛（或克隆体根本没被注上），说明 A1-8 检查的是别的东西 —— 那时它绿也不可信。
 */
test('G6 A1-8（负向）：gate 从生产 INSERT 列清单里去掉 ⇒ 本判据必须判红', async () => {
  const producerSrc = readFileSync(new URL(JEV_PRODUCER).pathname, 'utf8')
  const ollamaSrc = readFileSync(new URL(JEV_OLLAMA).pathname, 'utf8')

  // ① 注入缺陷 —— **逐字复现修复前的生产写者**（13 列 / 13 占位符 / 13 值，无 gate）。
  //    ⚠ 三处都要改：只改列名会让列数与占位符数不等，那是我注入的畸形，
  //    不是"忘了写 gate"这个真缺陷（实测踩到：SQLite 报 "14 values for 13 columns"，
  //    于是负向腿验的是畸形、不是缺陷）。
  const cutCols = producerSrc.replace(
    ' degraded, gate, latency_ms, cost_usd, session_id, turn_id, created_at)',
    ' degraded, latency_ms, cost_usd, session_id, turn_id, created_at)',
  )
  const cutValues = cutCols.replace(
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const cutParams = cutValues.replace(/\n\s*v\.gate,/, '')
  assert.notEqual(cutCols, producerSrc, '负向腿前置：列清单锚点必须命中（否则本腿在自欺）')
  assert.notEqual(cutValues, cutCols, '负向腿前置：占位符锚点必须命中（否则本腿在自欺）')
  assert.notEqual(cutParams, cutValues, '负向腿前置：取值锚点必须命中（否则本腿在自欺）')

  const dir = tmpDir()
  const prodCopy = join(dir, 'jev-log-gate.ts')
  writeFileSync(prodCopy, cutParams)
  const ollamaCopy = join(dir, 'ollama.ts')
  const rewritten = ollamaSrc.replace("from './jev-log-gate.ts'", `from '${pathToFileURL(prodCopy).href}'`)
  assert.notEqual(rewritten, ollamaSrc, '负向腿前置：ollama.ts 的 import 必须被改指克隆体')
  writeFileSync(ollamaCopy, rewritten)

  const mutant = await import(pathToFileURL(ollamaCopy).href)
  // 列数要问**克隆的记录器本体**（ollama.ts 只复用它，不 re-export 它的符号）
  const mutantProducer = await import(pathToFileURL(prodCopy).href)
  assert.equal(mutantProducer.jevLogColumnCount(), 13, '负向腿前置：克隆体的列清单应少一列（gate 已去掉）')

  const { db, close, rows } = openTmp()
  // ③ 真降级 outcome（不落库），经**被注入缺陷的生产写口**写入
  const degraded = await judgeWithOllama({
    state: 'S',
    question: 'Q-neg',
    requestId: 'neg-1',
    requestType: 'write_gate',
    fetchImpl: unreachableFetch,
  })
  assert.equal(degraded.degraded, true, '负向腿前置：outcome 必须是真降级')
  mutant.writeJevLog(db, degraded)

  const written = rows()
  assert.equal(written.length, 1, '负向腿：行仍会写入（fail-open）')
  assert.equal(written[0].degraded, 1, '负向腿：行确实是降级行')
  assert.equal(written[0].gate, null, '负向腿：gate 列被去掉 ⇒ 落库为 NULL（正是"归因缺失"这个真缺陷）')
  // 判据本体面对这个缺陷行**必须**报红 —— 它若还绿，A1-8 就是无牙的
  assert.throws(
    () => assertGateAttribution(written),
    /degraded=1 但 gate=null/,
    '判据本体必须判红：否则 A1-8 的绿不能推出"运行态可归因"',
  )
  close()
})
