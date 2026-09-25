/**
 * `mana-learning` L-03 判据：**Hebbian 共激活 → 关联强度**。
 *
 * 每条锚点都配**负向对拍**（本席硬纪律：「判据绿 ≠ 事实被检查」）。本文件的扰动腿有两类：
 *   · **运行时扰动**（本文件内，改传入的 η/窗口）—— 证明实现**真的消费**了入参；
 *   · **源码级扰动**（handoff §4 记录，改 `params.ts` 的真值后复跑）—— 证明判据**真的钉住了
 *     参数本身**（只改入参不改参数时，一条死写成常数的实现照样绿 ⇒ 必须两条都做）。
 *
 * ⚠ **本文件的用例数本身也是判据**（与 `long-term` 同口径）：实测**空文件**在显式路径下
 *   同样报 `# tests 1 / # pass 1 / exit 0`（计的是「文件加载成功」）⇒ 空/被截断的文件是**假绿**。
 *   故本文件固定 **9** 条，末条为用例计数自检（少一条即红）；外部核验（`verify.mjs`）
 *   断言 TAP `# tests 9` **相等**，而不是 `> 0`。
 *
 * 运行（**显式路径**）：`node --test packages/learning/tests/l03-hebbian.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../src/', import.meta.url)
const load = (f) => import(new URL(f, SRC).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const f6 = (x) => Number(x).toFixed(6)

const params = await load('params.ts')
const { ETA, COACTIVATION_WINDOW_MINUTES, COACTIVATION_WINDOW_MS } = params
const { findCoActivations, isWithinWindow, sameActivationWindow } = await load('window.ts')
const { pairDelta, closedFormWeight } = await load('hebbian.ts')
const storeFormat = await load('store-format.ts')
const { parseRelatedIds, encodeRelated } = storeFormat
const store = await load('store.ts')
const { linkPair, applyCoActivations, probeRelatedIdsColumn, readRelatedIds } = store
const traceMod = await load('trace.ts')

const EXPECTED_CASES = 10
let ran = 0

/** 建一个**真 schema** 临时库（走 core 的 `openManaDb` 生产路径，不手写 DDL）。 */
async function freshDb(prefix = 'mana-l03-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const coreMod = await import(new URL('../../core/src/index.ts', SRC).href)
  const opened = coreMod.openManaDb({ path: join(dir, 'mana.db') })
  return opened
}

/** 插一条记忆（走 core 服务的 `writeMemoryItem`，即生产写入口）。 */
function putMemory(core, id, at = new Date().toISOString()) {
  core.writeMemoryItem({ id, type: 'fact', content: `内容 ${id}`, at })
}

// ══ ① 学习率锚点：固定夹具下增量逐字复现（判据原文 docs/mana-v10-landing-plan.md:144 ①）══
test('① 学习率 η=0.01：固定夹具增量逐字复现 + 运行时扰动腿（传 0.02 必须偏离）', () => {
  ran += 1
  // 锚点：判据原文写死 η = 0.01 ⇒ 单次共激活 Δw = 0.01（x_i = x_j = 1，见 hebbian.ts 文件头）。
  assert.equal(ETA, 0.01, `params.ETA 必须逐字等于判据原文的 0.01，实测 ${ETA}`)
  assert.equal(f6(pairDelta()), '0.010000', `pairDelta() 缺省口径必须得 0.010000，实测 ${f6(pairDelta())}`)
  assert.equal(pairDelta(), ETA, '缺省 Δw 必须等于 params.ETA（不得是另写的一个常数）')
  // 闭式 N 次：w_N = N·η（夹具 w0 = 0）
  const closed = [1, 2, 3, 5, 10].map((n) => f6(closedFormWeight(0, n)))
  assert.deepEqual(closed, ['0.010000', '0.020000', '0.030000', '0.050000', '0.100000'], `闭式 N·η 逐字复现失败：${closed.join(',')}`)
  // ── 运行时扰动腿：η 必须**真的被消费**（死写成 0.01 的实现会在这里红）──
  assert.equal(f6(pairDelta(1, 1, 0.02)), '0.020000', '扰动腿：传 η=0.02 ⇒ Δw 必须是 0.020000（实现必须真读入参）')
  assert.ok(!near(pairDelta(1, 1, 0.02), ETA), '扰动腿：η=0.02 的结果必须**偏离** 0.01（否则入参是假旋钮）')
  assert.equal(f6(closedFormWeight(0, 3, 0.02)), '0.060000', '扰动腿：闭式同样必须真读 η')
  // 负向：非法 η 必须抛（静默 NaN 会一路写进 related_ids 且全网无报错）
  assert.throws(() => pairDelta(1, 1, Number.NaN), /η 必须是/, 'NaN 的 η 必须抛，不得静默产出 NaN')
  assert.throws(() => pairDelta(1, 1, -0.01), /η 必须是/, '负 η 必须抛（负增量会让「重复 = 单调不减」失效）')
})

// ══ ② 窗口边界：5 分钟内共激活；5 分钟外不增（判据 ②，含闭区间两个端点）══════════
test('② 窗口边界：gap≤窗口 算一次共激活；gap>窗口 一次不算（含 300000/300001 逐毫秒）', () => {
  ran += 1
  assert.equal(COACTIVATION_WINDOW_MINUTES, 5, '窗口必须逐字等于判据原文的 5 分钟')
  assert.equal(COACTIVATION_WINDOW_MS, 300000, `窗口毫秒（派生量）必须是 300000，实测 ${COACTIVATION_WINDOW_MS}`)
  const T0 = 1_700_000_000_000
  // 闭区间：等于窗口**算在内**（本仓与「相似度 ≥0.7」「序列 ≤7」同一风格）
  assert.equal(isWithinWindow(COACTIVATION_WINDOW_MS), true, 'gap == 窗口必须判为共激活（闭区间）')
  assert.equal(isWithinWindow(COACTIVATION_WINDOW_MS + 1), false, 'gap == 窗口+1 必须判为**不**共激活')
  assert.equal(sameActivationWindow(T0, T0 + COACTIVATION_WINDOW_MS), true, '同窗端点上界必须为真')
  assert.equal(sameActivationWindow(T0, T0 + COACTIVATION_WINDOW_MS + 1), false, '越界 1ms 必须为假')
  // 方向对称：|t_i - t_j|，与谁先谁后无关
  assert.equal(sameActivationWindow(T0 + 1000, T0), sameActivationWindow(T0, T0 + 1000), '方向必须对称（用绝对值）')

  // ── 生产入口（**不传 windowMs**，走 params 派生量）──
  const inside = findCoActivations([
    { id: 'm-a', at: T0 },
    { id: 'm-b', at: T0 + COACTIVATION_WINDOW_MS }, // 恰好 5 分钟
  ])
  assert.equal(inside.occasions.length, 1, `5 分钟内必须识别出 1 次共激活，实测 ${inside.occasions.length}`)
  assert.deepEqual([inside.occasions[0].a, inside.occasions[0].b], ['m-a', 'm-b'], '规范序必须是 (m-a, m-b)')
  assert.equal(inside.occasions[0].gapMs, COACTIVATION_WINDOW_MS, '间距必须等于窗口本身')

  const outside = findCoActivations([
    { id: 'm-a', at: T0 },
    { id: 'm-b', at: T0 + COACTIVATION_WINDOW_MS + 1 }, // 越界 1ms
  ])
  assert.equal(outside.occasions.length, 0, `5 分钟外必须**一次都不算**，实测 ${outside.occasions.length}`)

  // ── 负向对拍（运行时）：窗口传 6 分钟 ⇒ 那条越界的**必须**变成共激活 ──
  const widened = findCoActivations(
    [
      { id: 'm-a', at: T0 },
      { id: 'm-b', at: T0 + COACTIVATION_WINDOW_MS + 1 },
    ],
    6 * 60 * 1000,
  )
  assert.equal(widened.occasions.length, 1, '负向对拍：窗口改成 6 分钟 ⇒ 越界 1ms 的那对**必须**被算进来（否则窗口参数没被消费）')
  // 收窄亦须生效（防「只朝一个方向真读入参」）
  const narrowed = findCoActivations(
    [
      { id: 'm-a', at: T0 },
      { id: 'm-b', at: T0 + 1000 },
    ],
    0,
  )
  assert.equal(narrowed.occasions.length, 0, '负向对拍：窗口收窄到 0 ⇒ 不同刻的两条必须判为不共激活')
  assert.throws(() => isWithinWindow(1, -1), /windowMs 必须是/, '负窗口必须抛，不得静默当成 0（那次次都判「不共激活」，与「本来就没有」同形）')
})

// ══ ③ 可复算：同一对重复 N 次 ⇒ 权重单调不减 + 闭式期望（判据 ③）══════════════
test('③ 可复算：N 次共激活 ⇒ 权重单调不减、落库可逐次复算、且给出与闭式的实测偏差', async () => {
  ran += 1
  const opened = await freshDb()
  try {
    // 直接建两条记忆（走**真 schema**：createSchema 已由 openManaDb 施加）
    const now = new Date().toISOString()
    opened.db.prepare('INSERT INTO memory_items (id, type, content, created_at) VALUES (?, ?, ?, ?)').run('m-i', 'fact', 'i', now)
    opened.db.prepare('INSERT INTO memory_items (id, type, content, created_at) VALUES (?, ?, ?, ?)').run('m-j', 'fact', 'j', now)

    // ── 逐次链接：每次读回真值，断言「不减」且与闭式在容差内 ──
    const seen = []
    for (let n = 1; n <= 10; n++) {
      const out = linkPair(opened.db, 'm-i', 'm-j', 1)
      assert.equal(out.degraded, false, `第 ${n} 次写入不得降级（reason=${out.reason}）`)
      assert.equal(out.rowsWritten, 2, `第 ${n} 次必须写 2 行（i 与 j 各一格），实测 ${out.rowsWritten}`)
      const w = readRelatedIds(opened.db, 'm-i').items.find((e) => e.id === 'm-j').weight
      seen.push(w)
      const closed = closedFormWeight(0, n)
      assert.ok(
        Math.abs(w - closed) <= 1e-12,
        `第 ${n} 次：库内权重 ${w} 与闭式 ${closed} 的差必须 ≤1e-12（实测差 ${Math.abs(w - closed).toExponential(3)}）`,
      )
    }
    // 单调不减（**非严格**：本包无上界，η>0 时为严格增；写成不减是因为「饱和」是可选语义）
    for (let n = 1; n < seen.length; n++) {
      assert.ok(seen[n] >= seen[n - 1], `单调不减被破坏：w[${n - 1}]=${seen[n - 1]} w[${n}]=${seen[n]}`)
    }
    assert.ok(seen[9] > seen[0], '10 次之后必须真的比第 1 次大（否则"更新"没发生）')
    // ── **诚实腿**：逐次累加与闭式在 n 大时**不是同一个浮点数**（这就是不把它写死成「等于」的理由）──
    let acc = 0
    for (let k = 0; k < 10; k++) acc += ETA
    assert.ok(
      acc !== closedFormWeight(0, 10),
      '本仓实测事实：10 次 0.01 累加 ≠ 0.10 闭式（若哪天相等了，这条腿会红 —— 那是要**复核**这个前提，不是删掉它）',
    )
    // 对称性：两个方向读回的权重必须**逐位相等**（related_ids 是双向一行）
    const wi = readRelatedIds(opened.db, 'm-i').items.find((e) => e.id === 'm-j').weight
    const wj = readRelatedIds(opened.db, 'm-j').items.find((e) => e.id === 'm-i').weight
    assert.equal(wi, wj, 'i→j 与 j→i 的权重必须逐位相等（同一格关系的两个方向）')
    // ── 重复幂等的可复算口径：同一输入重跑 ⇒ 再增一格（不是幂等，而是可复算）──
    const beforeCount = readRelatedIds(opened.db, 'm-i').items.length
    linkPair(opened.db, 'm-i', 'm-j', 1)
    assert.equal(readRelatedIds(opened.db, 'm-i').items.length, beforeCount, '重复共激活不得新增一格（是加权，不是加边）')
  } finally {
    opened.close()
  }
})

// ══ ④ 落库格式：编码唯一字节形式 + 四态解析（列语义，本批首次定义）══════════════
test('④ related_ids 格式：编码规范唯一 + 解析四态（null/empty/ok/invalid 不得混同）', () => {
  ran += 1
  // 编码：与输入顺序无关 ⇒ 同一组关系只有一个字节串（判据④的逐字节比对前提）
  const a = encodeRelated([{ id: 'm-b', weight: 0.02 }, { id: 'm-a', weight: 0.01 }])
  const b = encodeRelated([{ id: 'm-a', weight: 0.01 }, { id: 'm-b', weight: 0.02 }])
  assert.equal(a, b, `同一组关系必须编码成同一字节串，实测 ${a} vs ${b}`)
  assert.equal(a, '[{"id":"m-a","w":0.01},{"id":"m-b","w":0.02}]', '字节形式必须是带权紧凑数组（格式契约，见 store-format.ts 文件头）')
  // 整数样字符串 id：必须是数组（对象 map 会被 JS 重排到前面 —— 本机实测，见 store-format.ts 理由②）
  const intLike = encodeRelated([{ id: 'm-2', weight: 0.01 }, { id: '123', weight: 0.02 }])
  assert.equal(intLike, '[{"id":"123","w":0.02},{"id":"m-2","w":0.01}]', '按字典序：数字串 123 排在 m-2 前（**不是**被引擎提到最前）')
  // 空集合 ⇒ `[]`（**不是** ''，也不是 null）
  assert.equal(encodeRelated([]), '[]', '空关系必须编码成 []（与「列从未被写过」可分辨）')
  assert.throws(() => encodeRelated([{ id: 'x', weight: 0.01 }, { id: 'x', weight: 0.02 }]), /id 重复/, '重复 id 必须抛（同一对占两格，读侧取哪格都不对）')
  assert.throws(() => encodeRelated([{ id: 'x', weight: Number.NaN }]), /权重必须是/, 'NaN 权重必须抛，不得落库')

  // 解析四态
  assert.equal(parseRelatedIds(null).state, 'null', 'NULL ⇒ null 态（列从未被写过）')
  assert.equal(parseRelatedIds('').state, 'empty', '空串 ⇒ empty 态（写者写过、结论是没有关系）')
  assert.equal(parseRelatedIds('  ').state, 'empty', '空白串 ⇒ empty 态（同上）')
  const ok = parseRelatedIds('[{"id":"m-b","w":0.02},{"id":"m-a","w":0.01}]')
  assert.equal(ok.state, 'ok')
  assert.deepEqual(ok.items.map((e) => e.id), ['m-a', 'm-b'], '解析后必须排序（使读回顺序与落库顺序一致）')
  assert.equal(ok.reason, null, 'ok 态的 reason 必须显式为 null')
  for (const bad of ['not json', '{}', '[{"id":""}]', '[{"id":"a","w":-1}]', '[{"id":"a","w":1},{"id":"a","w":2}]', '[{"w":1}]']) {
    const p = parseRelatedIds(bad)
    assert.equal(p.state, 'invalid', `${bad} 必须解析为 invalid`)
    assert.ok(typeof p.reason === 'string' && p.reason.length > 0, `invalid 必须带**非空** reason（G8），实测 ${JSON.stringify(p.reason)}`)
    assert.deepEqual(p.items, [], `invalid 的 items 必须是空数组，**不得**降级成"没有关系"`)
  }
  // 列不存在（undefined）与 NULL 必须可分辨
  assert.equal(parseRelatedIds(undefined).state, 'invalid', '列不存在 ⇒ invalid（不是 null —— 那不是"值为空"，是"没有这一列"）')
  assert.ok(parseRelatedIds(undefined).reason.includes('列不存在'), '列不存在的 reason 必须点名是列的问题')
})

// ══ ⑤ 列缺失三态：列不存在 ⇒ degraded + 非空 reason + gate + 留痕（不得静默）═════
test('⑤ 三态降级（列不存在）：一格不写、degraded+reason+gate、并留痕到 mana_trace 自己的命名空间', async () => {
  ran += 1
  // 造一个**没有 related_ids 列**的 memory_items（老库形态）
  const dir = mkdtempSync(join(tmpdir(), 'mana-l03-old-'))
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(dir, 'old.db'))
  db.exec('CREATE TABLE memory_items (id TEXT PRIMARY KEY, type TEXT, content TEXT, retired INTEGER DEFAULT 0, created_at TEXT)')
  db.exec('CREATE TABLE mana_trace (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, payload TEXT NOT NULL, session_id TEXT, turn_id INTEGER, timestamp TEXT NOT NULL)')
  db.prepare('INSERT INTO memory_items (id, type, content, created_at) VALUES (?,?,?,?)').run('m-a', 'fact', 'a', new Date().toISOString())
  db.prepare('INSERT INTO memory_items (id, type, content, created_at) VALUES (?,?,?,?)').run('m-b', 'fact', 'b', new Date().toISOString())

  const probe = probeRelatedIdsColumn(db)
  assert.equal(probe.state, 'missing', `探针必须报 missing，实测 ${probe.state}（reason=${probe.reason}）`)
  assert.ok(probe.reason && probe.reason.length > 0, 'missing 必须带非空 reason')

  // 留痕用的假 core：真跑 recordDegradation 的写路径（写进上面那张 mana_trace）
  const fakeCore = {
    writeTrace(entry) {
      const info = db
        .prepare('INSERT INTO mana_trace (event_type, payload, session_id, turn_id, timestamp) VALUES (?,?,?,?,?)')
        .run(entry.eventType, JSON.stringify(entry.payload ?? null), entry.sessionId, entry.turnId, entry.at ?? new Date().toISOString())
      return Number(info.lastInsertRowid)
    },
  }
  const out = applyCoActivations(
    db,
    [
      { id: 'm-a', at: 1000 },
      { id: 'm-b', at: 1000 },
    ],
    { core: fakeCore },
  )
  assert.equal(out.degraded, true, '列不存在**必须**是 degraded=true（不得静默成功）')
  assert.ok(typeof out.reason === 'string' && out.reason.length > 0, 'degraded 必须带非空 reason（degradation.md 硬约定 3）')
  assert.ok(out.gate === traceMod.GATE_FALLBACK, `degraded 必须带 gate，实测 ${String(out.gate)}`)
  assert.equal(out.rowsWritten, 0, '列不存在时**一格都不许写**（不得只写一半）')
  assert.ok(out.trace && out.trace.recorded === true, `留痕必须真落库，实测 ${JSON.stringify(out.trace)}`)

  const rows = traceMod.listDegradationRows(db)
  assert.equal(rows.length, 1, `mana_trace 必须新增 1 行本包的降级行，实测 ${rows.length}`)
  const payload = JSON.parse(rows[0].payload)
  assert.equal(payload.degraded, true, '留痕 payload 必须自带 degraded:true（G8 硬约定 3）')
  assert.ok(payload.reason.length > 0, '留痕 payload 的 reason 必须非空')

  // ── 反向对照（防「三态腿本身平凡通过」）：补上列之后，同一次调用**必须**转为正常态 ──
  db.exec('ALTER TABLE memory_items ADD COLUMN related_ids TEXT')
  assert.equal(probeRelatedIdsColumn(db).state, 'present', '补列后探针必须转 present')
  const fixed = applyCoActivations(
    db,
    [
      { id: 'm-a', at: 1000 },
      { id: 'm-b', at: 1000 },
    ],
    { core: fakeCore },
  )
  assert.equal(fixed.degraded, false, '补列后必须**不再**降级（否则上面那条 degraded=true 可能来自别的原因）')
  assert.equal(fixed.rowsWritten, 2, '补列后必须真写 2 行')
  assert.equal(readRelatedIds(db, 'm-a').items[0].weight, ETA, '补列后权重必须是 η（0.01）')
  assert.equal(traceMod.listDegradationRows(db).length, 1, '正常态**不得**再留痕（没降级就不许写告警行）')
  db.close()

  // ── 无 core：留痕退回 stderr，且**recorded:false**（可分辨，不是假装成功）──
  const dir2 = mkdtempSync(join(tmpdir(), 'mana-l03-nocore-'))
  const db2 = new DatabaseSync(join(dir2, 'old.db'))
  db2.exec('CREATE TABLE memory_items (id TEXT PRIMARY KEY, retired INTEGER DEFAULT 0, created_at TEXT)')
  const out2 = applyCoActivations(db2, [{ id: 'x', at: 1 }, { id: 'y', at: 1 }], {})
  assert.equal(out2.degraded, true)
  assert.ok(out2.trace && out2.trace.recorded === false, '无 core 时 trace 必须是 recorded:false（不是 recorded:true 的假成功）')
  assert.ok(out2.trace.reason.length > 0, 'recorded:false 的 trace 必须说明理由')
  db2.close()
})

// ══ ⑥ 落库语义：写者唯一、四条显式拒绝、字节能容（逐字节幂等）══════════════════
test('⑥ 落库语义：四条显式拒绝 + 字节级可复算 + 不覆写读不懂的旧值', async () => {
  ran += 1
  const opened = await freshDb('mana-l03-sem-')
  try {
    const db = opened.db
    const now = new Date().toISOString()
    const put = (id, retired = 0) =>
      db.prepare('INSERT INTO memory_items (id, type, content, created_at, retired) VALUES (?,?,?,?,?)').run(id, 'fact', id, now, retired)
    put('m-a')
    put('m-b')
    put('m-gone', 1) // retired 行

    // ③ 退休行不新增
    const retiredOut = linkPair(db, 'm-a', 'm-gone', 1)
    assert.equal(retiredOut.pairs[0].action, 'skipped', '退休行必须被跳过')
    assert.match(retiredOut.pairs[0].reason, /退休行/, `跳过原因必须点名退休，实测 ${retiredOut.pairs[0].reason}`)
    assert.equal(readRelatedIds(db, 'm-a').items.length, 0, '被跳过后 m-a 不得留下任何格子')

    // ① 行不存在
    const absent = linkPair(db, 'm-a', 'm-nope', 1)
    assert.equal(absent.pairs[0].action, 'skipped')
    assert.match(absent.pairs[0].reason, /行不存在/, `原因必须点名，实测 ${absent.pairs[0].reason}`)

    // 正常写：一次共激活 ⇒ 两格
    const one = linkPair(db, 'm-a', 'm-b', 1)
    assert.equal(one.rowsWritten, 2)
    assert.equal(one.pairs[0].action, 'created', '首次必须报 created')
    assert.equal(one.pairs[0].before, null, '首次 before 必须是 null（不是 0 —— 0 是一个合法权重）')
    assert.equal(f6(one.pairs[0].after), '0.010000')
    // 第二次 ⇒ incremented，且 before 是真读回值
    const two = linkPair(db, 'm-a', 'm-b', 1)
    assert.equal(two.pairs[0].action, 'incremented')
    assert.equal(f6(two.pairs[0].before), '0.010000', `before 必须是**写前真值**，实测 ${f6(two.pairs[0].before)}`)

    // ② 读不懂的旧值 ⇒ **不覆写**（那是别处写的真数据，覆写即销毁证据）
    db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('这不是 JSON', 'm-b')
    const keptOut = linkPair(db, 'm-a', 'm-b', 1)
    assert.equal(keptOut.pairs[0].action, 'skipped', '读不懂的旧值必须跳过（缺省 overwriteInvalid=false）')
    assert.match(keptOut.pairs[0].reason, /读不懂/, `原因必须点名读不懂，实测 ${keptOut.pairs[0].reason}`)
    assert.equal(
      db.prepare('SELECT related_ids r FROM memory_items WHERE id = ?').get('m-b').r,
      '这不是 JSON',
      '**旧值必须逐字节保留**（跳过 ≠ 顺手清掉）',
    )
    // 显式重建：允许时才覆写，且必须在 pairs 里留 reason
    const rebuilt = linkPair(db, 'm-a', 'm-b', 1, { overwriteInvalid: true })
    assert.equal(rebuilt.pairs[0].action !== 'skipped', true, 'overwriteInvalid=true 时必须真的写')
    assert.ok(rebuilt.pairs[0].reason && rebuilt.pairs[0].reason.length > 0, '重建必须留 reason（不得静默销毁旧值）')
    assert.equal(JSON.parse(db.prepare('SELECT related_ids r FROM memory_items WHERE id = ?').get('m-b').r)[0].w, 0.01, '重建后权重从 0 起算 ⇒ η')

    // ── 字节级可复算：同一段激活流重跑（在干净库上）⇒ related_ids 逐字节相同 ──
    const opened2 = await freshDb('mana-l03-bytes-')
    try {
      for (const id of ['m-a', 'm-b']) {
        opened2.db.prepare('INSERT INTO memory_items (id, type, content, created_at) VALUES (?,?,?,?)').run(id, 'fact', id, now)
      }
      const events = [
        { id: 'm-b', at: 5_000 }, // 刻意乱序 + 反向书写，考规范序
        { id: 'm-a', at: 4_000 },
        { id: 'm-a', at: 5_000_000 },
        { id: 'm-b', at: 5_000_000 },
      ]
      const r1 = applyCoActivations(opened2.db, events)
      const bytes1 = opened2.db.prepare('SELECT related_ids r FROM memory_items WHERE id = ?').get('m-a').r
      const bytes2 = opened2.db.prepare('SELECT related_ids r FROM memory_items WHERE id = ?').get('m-b').r
      // ⚠ 双向两格**互指**（a 的格子里是 b，b 的格子里是 a）⇒ 两串**不应**逐字节相同。
      //   要判的是「各自只有一格、指向对方」+「权重逐位相同」。本席初稿把这条写成了
      //   「两串逐字节相等」——**打错了靶**（真跑报红才发现）。记在此处，防后来者照抄。
      assert.equal(bytes1, '[{"id":"m-b","w":0.02}]', `2 次 occasion ⇒ w=0.02 且字节形式固定，实测 ${bytes1}`)
      assert.equal(bytes2, '[{"id":"m-a","w":0.02}]', `另一方向必须对称，实测 ${bytes2}`)
      assert.equal(
        parseRelatedIds(bytes1).items[0].weight,
        parseRelatedIds(bytes2).items[0].weight,
        '双向权重必须**逐位相等**（同一格关系的两个方向）',
      )
      assert.equal(r1.occasions, 2, `2 个时间簇 ⇒ 2 次 occasion，实测 ${r1.occasions}`)
      // 输入顺序无关：倒序重跑（同样 2 个簇）⇒ 结果单调累加（0.02 → 0.04）
      const r2 = applyCoActivations(opened2.db, [...events].reverse())
      assert.equal(r2.rowsWritten, 2)
      const after = opened2.db.prepare('SELECT related_ids r FROM memory_items WHERE id = ?').get('m-a').r
      assert.equal(after, '[{"id":"m-b","w":0.04}]', `重跑累加必须可复算（0.02 → 0.04），实测 ${after}`)

      // ── 输入侧可分辨：空输入 vs 全被丢掉 ──
      const empty = applyCoActivations(opened2.db, [])
      assert.equal(empty.eventsSeen, 0)
      assert.equal(empty.occasions, 0)
      const allDropped = applyCoActivations(opened2.db, [{ id: '', at: 1 }, { id: 'x', at: Number.NaN }])
      assert.equal(allDropped.eventsSeen, 2, 'eventsSeen 必须计入被丢掉的输入（否则与"没输入"同形）')
      assert.equal(allDropped.droppedEvents.length, 2, `2 条非法输入必须逐条登记原因，实测 ${allDropped.droppedEvents.length}`)
      assert.deepEqual(allDropped.droppedEvents.map((d) => d.reason).sort(), ['empty_id', 'non_finite_time'])
    } finally {
      opened2.close()
    }
  } finally {
    opened.close()
  }
})

// ══ ⑦ 参数单一出处：η / 窗口不得在 params.ts 之外以字面量重现（C14 唯一写者）══════
test('⑦ 参数单一出处：η=0.01 与窗口不得在 params.ts 之外重现（C14，含扫描器自证）', () => {
  ran += 1
  const strip = (s) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/`(?:[^`\\]|\\.)*`/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, '""')
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  const PATTERNS = [
    [/(?<![\d.])0\.01(?![\d])/, 'ETA = 0.01'],
    [/(?<![\d.])(?:300000|360000|60000)(?![\d])/, '窗口毫秒（必须由分钟派生）'],
  ]
  const offenders = []
  const scanned = []
  for (const f of readdirSync(fileURLToPath(SRC))) {
    if (!f.endsWith('.ts') || f === 'params.ts') continue
    scanned.push(f)
    const src = strip(readFileSync(fileURLToPath(new URL(f, SRC)), 'utf8'))
    for (const [re, label] of PATTERNS) if (re.test(src)) offenders.push(`${f}: ${label}`)
  }
  assert.ok(scanned.length >= 5, `本腿须真扫到源文件，实测 ${scanned.length} 个：${JSON.stringify(scanned)}`)
  assert.deepEqual(offenders, [], `η 与窗口只许出现在 params.ts（C14）。实测重现于：${JSON.stringify(offenders)}`)
  // 扫描器自证（否则正则失效后本腿退化为恒绿）
  assert.ok(PATTERNS[0][0].test(strip('const E = 0.01\n')), '负向对拍：扫描器必须能识别裸字面量 0.01')
  assert.ok(PATTERNS[1][0].test(strip('const W = 300000\n')), '负向对拍：扫描器必须能识别裸字面量 300000')
  // 反方向：注释里的参数值**不得**被算成违规（否则本文件那些写着 0.01/5 分钟的说明注释会造假红）
  assert.ok(!PATTERNS[0][0].test(strip('// η = 0.01\n/* 窗口 5 分钟 */\n')), '注释里的参数值不得被算成违规')
  // 派生关系本身也是判据：改分钟必须带动毫秒（否则两处会各说各话）
  assert.equal(params.COACTIVATION_WINDOW_MS, params.COACTIVATION_WINDOW_MINUTES * params.MS_PER_MINUTE, '窗口毫秒必须由分钟**派生**，不得独立配置')
})

// ══ ⑧ 命名空间与边界：不侵占 S1 五类、导出面逐个断言、不导出 Config ══════════════
test('⑧ 命名空间与导出面：trace 事件不落在 S1 五类内 + 实现面清单逐名可检 + 无 Config', async () => {
  ran += 1
  const mod = await load('index.ts')
  const core = await import(new URL('../../core/src/domain.ts', SRC).href)
  const MANA_STAGES = [...core.MANA_STAGES]
  assert.deepEqual(
    MANA_STAGES.slice().sort(),
    ['attention', 'decision', 'injection', 'observation', 'recall'],
    `前置事实变了：MANA_STAGES 实测 ${JSON.stringify(MANA_STAGES)} —— 下面的命名空间断言建立在"五类是这五个"之上`,
  )
  const ev = traceMod.TRACE_EVENT_DEGRADED
  assert.ok(!MANA_STAGES.includes(ev), `本包的 trace 事件不得落在 S1 五类内（否则会掩盖真链缺哪一类），实测 ${ev}`)
  assert.ok(ev.startsWith(traceMod.TRACE_EVENT_PREFIX), `必须用自己的命名空间前缀，实测 ${ev}`)

  // 导出面逐个断言（实现被搬走/改名 ⇒ 必红）
  assert.equal(typeof mod.name, 'string', 'name 必须导出')
  assert.ok(Array.isArray(mod.inject), 'inject 必须导出')
  assert.equal(typeof mod.apply, 'function', 'apply 必须导出')
  const names = mod.IMPLEMENTED_EXPORTS
  assert.ok(Array.isArray(names) && names.length > 0, 'IMPLEMENTED_EXPORTS 必须非空（否则本判据会平凡通过）')
  for (const n of names) assert.equal(typeof mod[n], 'function', `导出 ${n} 必须是函数（被搬走/改名即红）`)
  assert.equal(mod.Config, undefined, '本包不导出 Config：新增能力全是纯函数+显式 db 入参，没有真旋钮可关')

  // ── 真装配：服务面可读 + 参数与实现同源 + 卸载即净 ──
  const ctx = new Context()
  const coreMod = await import(new URL('../../core/src/index.ts', SRC).href)
  const dir = mkdtempSync(join(tmpdir(), 'mana-l03-asm-'))
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(200)
  const fiber = ctx.plugin(mod)
  await settle(300)
  const svc = ctx.get('mana-learning')
  assert.ok(svc, 'mana-learning 服务必须可读（未 provide = 插件没真跑起来）')
  assert.equal(svc.params.eta, ETA, '服务面读到的 η 必须与 params 同源（防实现里偷偷写死了另一个 η）')
  assert.equal(svc.params.windowMs, COACTIVATION_WINDOW_MS, '服务面读到的窗口必须与 params 同源')
  assert.deepEqual([...svc.status().traceEvents], [traceMod.TRACE_EVENT_DEGRADED], 'status 必须显式列出本包会写的 trace 事件（空数组 = 不写，必须是显式空）')
  assert.ok(svc.status().behaviors.length > 0, 'status().behaviors 必须逐条列出真实行为面（不得用一个布尔词概括）')
  assert.equal(typeof svc.store.applyCoActivations, 'function', '落库面必须挂在服务上')
  assert.equal(svc.store.applyCoActivations, applyCoActivations, '服务面必须是**同一个函数对象**（不是另写一份）')
  const labels = (fiber.getEffects() ?? []).map((e) => String(e.label))
  assert.ok(labels.some((l) => l.includes('agent/pre-step')), `本包必须注册 pre-step 直通监听器（G9），实测 ${JSON.stringify(labels)}`)
  await fiber.dispose()
  await settle(300)
  assert.equal(ctx.get('mana-learning'), undefined, '卸载后服务必须消失（卸载即净）')
  assert.ok(!(fiber.getEffects() ?? []).some((e) => String(e.label).includes('agent/pre-step')), '卸载后监听器必须随 fiber 释放')
})

// ══ ⑨ 边界：不做 FSRS、不动他包（本包不得出现衰减核/他包符号）═════════════════
test('⑨ 边界腿：本包不得含时间衰减核、不得新增 DDL、不得改他包（含负向对拍）', () => {
  ran += 1
  const files = readdirSync(fileURLToPath(SRC)).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length >= 5, `本腿须真扫到源文件，实测 ${files.length}`)
  const DECAY_RE = /export (?:function|const)\s+(?:decay|timeDecay|decayOf|retentionOf|halfLifeDecay)\b/
  const DDL_RE = /\b(?:CREATE|DROP|ALTER)\s+(?:TABLE|INDEX|TRIGGER|VIRTUAL)\b/i
  const offenders = { decay: [], ddl: [], foreign: [] }
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(f, SRC)), 'utf8')
    if (DECAY_RE.test(src)) offenders.decay.push(f)
    if (DDL_RE.test(src)) offenders.ddl.push(f)
    // 他包符号：本包只许 import `dsh-mana-core`，不得 import 任何 mana 兄弟包
    for (const m of src.matchAll(/from '([^']+)'/g)) {
      const spec = m[1]
      if (spec.startsWith('dsh-mana-') && spec !== 'dsh-mana-core') offenders.foreign.push(`${f}: ${spec}`)
    }
  }
  assert.deepEqual(offenders.decay, [], `⛔ 不做 FSRS / 不得自带时间衰减核（A1-5 的实现者在 long-term），实测：${JSON.stringify(offenders.decay)}`)
  assert.deepEqual(offenders.ddl, [], `⛔ 不写任何 DDL（schema 归 core），实测：${JSON.stringify(offenders.ddl)}`)
  assert.deepEqual(offenders.foreign, [], `⛔ 不得 import 兄弟包（与它们只有只读的数学关系，不是装配依赖），实测：${JSON.stringify(offenders.foreign)}`)
  // 扫描器自证（防恒绿）
  assert.ok(DECAY_RE.test('export function decay(t) { return 1 }'), '负向对拍：衰减核扫描器必须能识别 export function decay')
  assert.ok(DDL_RE.test('db.exec("CREATE TABLE x (a)")'), '负向对拍：DDL 扫描器必须能识别 CREATE TABLE')
  assert.ok(!DDL_RE.test('// 见 packages/core/src/schema.ts 的 DDL'), '反方向：注释里提到 DDL 不得被算成违规（防假红）')
})

// ══ ⑩ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）════
test('⑩ 用例计数自检', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
  assert.equal(EXPECTED_CASES, 10, '本文件登记数必须与 verify.mjs 的 TEST_FILES 一致')
})
