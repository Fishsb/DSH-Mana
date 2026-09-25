/**
 * 判据④：**三态降级**（列缺失 ⇒ `degraded:true` + **非空 reason** + **留痕**，三条都要真）。
 *
 * ── L-00 契约补列**已执行**（2026-09-25，F1 席）⇒ 本文件的前提**整体改写** ──────────────────
 *   旧写法：`mount({columns:false})` 建出"真现状库"，靠"真库确实没有这两列"**顺带**得到降级腿。
 *   补列之后这条路**断了**（真 DDL 建出来就有两列）。
 *   新写法：降级腿由 `mount({legacy:true})` 提供 —— 真 DDL 建库 → `DROP COLUMN` 摘掉两列
 *   → `autoMigrate:false` 装配 ⇒ 该库**逐字**等于"L-00 未执行的存量库"，且补列**不会**发生。
 *
 *   ⚠ 为什么不继续用 `autoMigrate:true`（那样补列会真跑、库会变回有列）：降级腿要判的是
 *     **"列不在时本包怎么办"**。若补列同时发生，被测的就是"补完之后"的形态 ——
 *     判据的靶子被换掉，而它看上去仍在跑（本仓最防的形态）。
 *   ⚠ 前置控制**不可省**：`legacy` 库必须先证明它**真的缺列**（下面第 ① 条取数），
 *     否则"降级腿绿"无法区分于"其实列在、走了 applied"。
 *
 * ⚠ 降级与"没发生"必须可分辨：降级必须**留痕**（`mana-reconsolidation/degraded`），
 *   否则事后取证时与"这条记忆从来没被注入过"完全同形。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount, cleanupAll, maxSeq, traceSince } from './_harness.mjs'

const EXPECTED_CASES = 6
let ran = 0
process.on('exit', () => {
  cleanupAll()
  if (ran !== EXPECTED_CASES) {
    console.error(`\n用例计数自检失败：期望 ${EXPECTED_CASES}，实跑 ${ran}`)
    process.exitCode = 1
  }
})

const W_COL = 'reconsolidation_window_until'
const H_COL = 'update_history'

test('① 前提取数：legacy 库**确实缺这两列**，而契约库**确实有这两列**（不假设，两处都取数）', async () => {
  ran += 1
  // ── 腿 A：L-00 未执行的存量库 ⇒ 真缺列（**降级腿的全部前提**）─────────────────
  const legacyMount = await mount({ legacy: true })
  const lcols = legacyMount.coreColumns
  assert.equal(lcols.includes(W_COL), false, `legacy 库必须**真的**没有 ${W_COL}（若在 ⇒ 本文件后面四条降级腿判的不是降级）`)
  assert.equal(lcols.includes(H_COL), false, `legacy 库必须**真的**没有 ${H_COL}`)
  // 前置控制的**前置**：摘列发生在装配**之前**（`preColumns` 是交给 core 前的读回值）。
  assert.equal(legacyMount.preColumns.includes(W_COL), false, '装配**前**就必须已缺列（否则"缺列"是装配造成的假象）')
  // `autoMigrate:false` ⇒ 本次装配**一列都没加**（补列真的没发生，不是"补了又不知道"）。
  //   ⚠ 这条与下面腿 B 的那条**是同一个计算的两面**：同一段代码在 legacy 形态给空、在存量库形态给两列
  //     ⇒ 它证明的是"补列确实只发生在该发生的时候"，而不是一个恒真的空数组。
  assert.deepEqual(
    legacyMount.columnsAddedByMount,
    [],
    `legacy 形态不得加列，实测加了 ${JSON.stringify(legacyMount.columnsAddedByMount)}`,
  )
  assert.deepEqual(legacyMount.coreColumns, legacyMount.preColumns, 'legacy 装配前后列集合必须**逐字不变**')
  const probe = legacyMount.svc.columnsPresent()
  assert.equal(probe.ok, false)
  assert.deepEqual(probe.missing, [W_COL, H_COL], '缺列清单必须逐字点名两列（顺序按 REQUIRED_COLUMNS 真源）')
  assert.deepEqual(probe.columns, lcols, '探测读回的列清单必须与 PRAGMA 一致（不得缓存/自报）')

  // ── 腿 B：契约库（L-00 之后）⇒ 真有两列，且**补列是 core 干的**──────────────────
  //   ⚠ 这条是"L-00 之后本包自动转 applied"的**机制前提**：补列由 `createSchema` 的列 diff 完成，
  //     夹具不代劳（旧夹具手写 `ALTER TABLE ADD COLUMN`，验的是"手写 ALTER 能补"，不是本仓机制）。
  const migrated = await mount({ columns: false })
  assert.equal(migrated.preColumns.includes(W_COL), false, '交给 core 之前必须缺列（前置控制）')
  assert.deepEqual(
    [...migrated.columnsAddedByMount].sort(),
    [H_COL, W_COL].sort(),
    `存量库经 createSchema 必须**恰好补上这两列**（实测 ${JSON.stringify(migrated.columnsAddedByMount)}）`,
  )
  assert.equal(migrated.coreColumns.includes(W_COL), true, '补列后库里必须真有两列（读回，不是自报）')
  assert.equal(migrated.coreColumns.includes(H_COL), true, '补列后库里必须真有两列（读回，不是自报）')
  // 差分辨据：补列后的列集合与**全新库**逐列相等（补列没有把别的列弄丢/弄乱）。
  const freshMount = await mount({ columns: true })
  assert.deepEqual(
    [...migrated.coreColumns].sort(),
    [...freshMount.coreColumns].sort(),
    '存量库补列后的列集合必须与全新库**完全相等**（差分口径，见 core/tests/schema-migration.test.mjs）',
  )
  assert.equal(freshMount.svc.columnsPresent().ok, true, '全新库两列齐 ⇒ columnsPresent 必须 ok:true')
})

test('② 开窗降级：degraded:true + reason 非空且可辨 + **一条留痕** + 库内零改动', async () => {
  ran += 1
  const { core, svc } = await mount({ legacy: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: '真库里的记忆' })
  const before = maxSeq(core)
  const now = 1_700_000_000_000
  const r = svc.openWindow({ memoryId: 'm1', type: 'episodic', now, trigger: 'inject:1' })

  assert.equal(r.channel, 'degraded')
  assert.equal(r.degraded, true, '列缺 ⇒ degraded 必须为 true')
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason 必须**非空**（空 reason 的降级不可辨）')
  assert.match(r.reason, /^schema-missing:/, 'reason 必须带可机读前缀，与别的失败可分辨')
  assert.match(r.reason, new RegExp(W_COL))
  assert.equal(r.persisted, false, '降级 ⇒ 没有写库')
  // 窗长仍按类型算（降级只影响"落库与留痕"，不影响纯函数面）
  assert.equal(r.until, now + 1800000)

  const rows = traceSince(core, before)
  assert.equal(rows.length, 1, `降级必须**恰好**留一条痕，实测 ${rows.length}`)
  assert.equal(rows[0].event_type, 'mana-reconsolidation/degraded')
  const payload = JSON.parse(rows[0].payload)
  assert.equal(payload.reason, r.reason, '留痕里的 reason 必须与返回值逐字一致（不得两套口径）')
  assert.deepEqual(payload.missing, [W_COL, H_COL])
  assert.equal(payload.action, 'open-window')
  // 库内零改动：内容列逐字不变（缺列时本包**一条写 SQL 都不发**）
  assert.equal(core.db.prepare('SELECT content AS c FROM memory_items WHERE id = ?').get('m1').c, '真库里的记忆')
})

test('③ 内容更新降级：同样三态齐（reason 非空 / 留痕 / 段数落 null 不用 0 冒充）', async () => {
  ran += 1
  const { core, svc } = await mount({ legacy: true })
  core.writeMemoryItem({ id: 'm1', type: 'semantic', content: '更新前' })
  const before = maxSeq(core)
  const r = svc.applyContentUpdate({ memoryId: 'm1', content: '更新后', now: 1_700_000_000_000 })
  assert.equal(r.channel, 'degraded')
  assert.equal(r.degraded, true)
  assert.ok(r.reason && r.reason.startsWith('schema-missing:'))
  assert.equal(r.updated, false)
  assert.equal(r.previousContent, '更新前', '降级时旧值仍可读（content 列本身不缺口）')
  assert.equal(r.content, '更新前', '没写就是没写：返回的"当前内容"必须是旧值')
  assert.equal(r.historyCount, null, '段数**不可知**必须落 null —— 用 0 会与"本来 0 段"同形')
  assert.equal(r.historyAppended, null)
  assert.equal(core.db.prepare('SELECT content AS c FROM memory_items WHERE id = ?').get('m1').c, '更新前', '库内必须零改动')
  const rows = traceSince(core, before)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].event_type, 'mana-reconsolidation/degraded')
  assert.equal(JSON.parse(rows[0].payload).action, 'content-update')
})

test('④ 关窗降级：扫不到窗口不是"没有到期"，而是"两列不在"——必须区分', async () => {
  ran += 1
  const { core, svc } = await mount({ legacy: true })
  const before = maxSeq(core)
  const r = svc.closeDueWindows({ now: 1_800_000_000_000 })
  assert.equal(r.channel, 'degraded')
  assert.equal(r.degraded, true)
  assert.equal(r.reason.startsWith('schema-missing:'), true)
  // ⚠ 与"扫了但没有到期窗口"的可分辨点：applied 态 reason 为 null、scanned 可为 0，
  //   而降级态 reason 非空且**留痕**。两者若同形，就无法回答"窗口到底关没关"。
  assert.deepEqual(r.closed, [], '降级 ⇒ 不得报"关闭了任何窗口"')
  const rows = traceSince(core, before)
  assert.equal(rows.length, 1)
  assert.equal(JSON.parse(rows[0].payload).action, 'close-window')
  // 对照：列齐时同一调用是 applied（拿**补列后的存量库**做同口径对照，避免"恒降级"辩解）。
  // ⚠ 用 `columns:false`（= 走 createSchema 真补列）而不是 `columns:true`（全新库）：
  //   对照物与生产场景同形 —— 存量库补列之后应当转 applied。
  const { svc: ok, columnsAddedByMount: okAdded } = await mount({ columns: false })
  assert.deepEqual(
    [...okAdded].sort(),
    ['reconsolidation_window_until', 'update_history'].sort(),
    '对照库必须是**补列真跑过**的（否则这个对照与生产场景不同形）',
  )
  const applied = ok.closeDueWindows({ now: 1_800_000_000_000 })
  assert.equal(applied.channel, 'applied')
  assert.equal(applied.degraded, false)
  assert.equal(applied.reason, null)
})

test('⑤ 降级**不得崩**、也不得"什么都不抛"（对照：未知类型仍必须抛）', async () => {
  ran += 1
  const { core, svc } = await mount({ legacy: true })
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: 'x' })
  const now = 1_700_000_000_000
  // 缺列时三条调用都必须**返回**（降级是三态之一，不是异常）
  assert.doesNotThrow(() => svc.openWindow({ memoryId: 'm1', type: 'episodic', now }))
  assert.doesNotThrow(() => svc.applyContentUpdate({ memoryId: 'm1', content: 'y', now }))
  assert.doesNotThrow(() => svc.closeDueWindows({ now }))
  // 反向：类型不在册时仍必须抛（说明本包不是"一律吞掉异常"）
  assert.throws(() => svc.openWindow({ memoryId: 'm1', type: '不存在的类型', now }), RangeError)
  assert.throws(() => svc.windowMs('不存在的类型'), RangeError)
  // 且抛错发生在写库之前 ⇒ 不留半开窗、不留痕
  const before = maxSeq(core)
  try {
    svc.openWindow({ memoryId: 'm1', type: 'bad-type', now })
  } catch {
    /* 预期 */
  }
  assert.equal(traceSince(core, before).length, 0, '校验失败不得留痕（没发生的事不得被记成发生了）')
})
// ── ⑥ L-02 自动转 applied：**存量库经补列之后**，三条生产路径都不再降级（走真路径）────────
test('⑥ 补列后自动转 applied：存量库经 createSchema 补列 ⇒ 三态从 degraded 转 applied（无需改码）', async () => {
  ran += 1
  const { core, svc, preColumns, coreColumns, columnsAddedByMount } = await mount({ columns: false })

  // 前置控制：这个库**确实是从缺列状态**升上来的（否则"转 applied"无从谈起）。
  for (const c of [W_COL, H_COL]) assert.equal(preColumns.includes(c), false, `补列前必须缺 ${c}`)
  assert.deepEqual([...columnsAddedByMount].sort(), [H_COL, W_COL].sort(), '两列必须由 createSchema 补上')
  assert.equal(svc.columnsPresent().ok, true, `补列后 columnsPresent 必须报 ok:true；实测 missing=${JSON.stringify(svc.columnsPresent().missing)}`)

  // 三条生产路径逐条转 applied（**真写库 + 回读**，不是看返回值自称）。
  core.writeMemoryItem({ id: 'm1', type: 'episodic', content: 'L-00 之前的行' })
  const now = 1_700_000_000_000
  const w = svc.openWindow({ memoryId: 'm1', type: 'episodic', now, trigger: 'inject:1' })
  assert.equal(w.channel, 'applied', '开窗必须转 applied')
  assert.equal(w.degraded, false, '不得再报降级')
  assert.equal(w.reason, null, 'applied 态 reason 必须为 null（与降级态可分辨）')
  assert.equal(w.persisted, true, 'persisted 必须来自回读')
  // 列里真有值：这一条是"转 applied"与"自称转 applied"的分界。
  assert.equal(
    core.db.prepare('SELECT reconsolidation_window_until w FROM memory_items WHERE id=?').get('m1').w,
    w.untilIso,
    '窗口列必须真写了库且与返回值逐字一致',
  )

  const u1 = svc.applyContentUpdate({ memoryId: 'm1', content: '一', now })
  const u2 = svc.applyContentUpdate({ memoryId: 'm1', content: '二', now: now + 1000 })
  assert.equal(u1.channel, 'applied', '内容更新必须转 applied')
  assert.equal(u1.degraded, false)
  assert.equal(u1.historyCount, 1, '回读段数必须为 1')
  assert.equal(u2.historyCount, 2, '连续两次更新 ⇒ 两段（追加而非覆盖）')

  const closed = svc.closeDueWindows({ now: w.until })
  assert.equal(closed.channel, 'applied', '关窗必须转 applied')
  assert.deepEqual(closed.closed, ['m1'], '到点窗口必须被真关掉')

  // 反向腿：整段过程中**一条降级痕都不该有**（转 applied 不是"多写几条降级痕"）。
  const degradedRows = core.db.prepare("SELECT COUNT(*) n FROM mana_trace WHERE event_type = 'mana-reconsolidation/degraded'").get()
  assert.equal(Number(degradedRows.n), 0, '补列后不得再有降级留痕')
  // 而生产痕必须有（否则"无降级"可能只是"什么都没记"）。
  const prodRows = core.db.prepare("SELECT COUNT(*) n FROM mana_trace WHERE event_type LIKE 'mana-reconsolidation/%'").get()
  assert.ok(Number(prodRows.n) >= 4, `三条路径的留痕必须都在，实测 ${Number(prodRows.n)} 条`)
  void coreColumns
})
