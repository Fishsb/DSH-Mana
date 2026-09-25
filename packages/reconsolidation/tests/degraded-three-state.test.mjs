/**
 * 判据④：**三态降级**（列缺失 ⇒ `degraded:true` + **非空 reason** + **留痕**，三条都要真）。
 *
 * ⚠ 本文件跑的是**本仓真现状**：`packages/core/src/schema.ts` 的 `memory_items` 实测没有
 *   `reconsolidation_window_until` / `update_history` 两列（L-00 未执行）。
 *   故"降级腿"不是构造出来的场景，而是**本包此刻在真库上的真实行为**——
 *   它之所以能被判据抓住，靠的是下面第 ① 条先把"真缺列"这个前提**取数**（不是假设）。
 *
 * ⚠ 降级与"没发生"必须可分辨：降级必须**留痕**（`mana-reconsolidation/degraded`），
 *   否则事后取证时与"这条记忆从来没被注入过"完全同形。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount, cleanupAll, maxSeq, traceSince } from './_harness.mjs'

const EXPECTED_CASES = 5
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

test('① 前提取数：本仓真库**确实缺这两列**（不假设；缺列清单逐字可读）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: false })
  const cols = core.db.prepare('PRAGMA table_info(memory_items)').all().map((r) => String(r.name))
  assert.equal(cols.includes(W_COL), false, `本仓现状：${W_COL} 不在 schema（若已在 ⇒ L-00 已执行，本文件的降级腿前提已变，必须同步改）`)
  assert.equal(cols.includes(H_COL), false, `本仓现状：${H_COL} 不在 schema`)
  /**
   * ⚠ **两处数字不一致，取数优先于转述**（本席 2026-09-25 实测）：
   *   `docs/mana-v10-landing-plan.md` 与本席派单都写「`memory_items` **26 列**」，
   *   而**真库 `PRAGMA table_info` 读回 = 23 列**（DDL 文本 `schema.ts:37-61` 逐列数也是 23）。
   *   ⇒ 断言只钉"**不得少于 23**"（DDL 只会增列）：钉死 ==26/==23 会在 L-00 补列或别批加列时
   *     造出「一会儿过一会儿不过」的腿（threshold-discipline 明令禁止），也会误伤别席。
   *     实测值写进消息，供复核席一眼看到差异。
   */
  assert.ok(cols.length >= 23, `core 的 memory_items 不得少于 23 列（实测 ${cols.length}；派单写 26，实测 23 —— 取数优先）`)
  const probe = svc.columnsPresent()
  assert.equal(probe.ok, false)
  assert.deepEqual(probe.missing, [W_COL, H_COL], '缺列清单必须逐字点名两列（顺序按 REQUIRED_COLUMNS 真源）')
  assert.deepEqual(probe.columns, cols, '探测读回的列清单必须与 PRAGMA 一致（不得缓存/自报）')
})

test('② 开窗降级：degraded:true + reason 非空且可辨 + **一条留痕** + 库内零改动', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: false })
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
  const { core, svc } = await mount({ columns: false })
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
  const { core, svc } = await mount({ columns: false })
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
  // 对照：列齐时同一调用是 applied（拿真库补列后的夹具做同口径对照，避免"恒降级"辩解）
  const { svc: ok } = await mount({ columns: true })
  const applied = ok.closeDueWindows({ now: 1_800_000_000_000 })
  assert.equal(applied.channel, 'applied')
  assert.equal(applied.degraded, false)
  assert.equal(applied.reason, null)
})

test('⑤ 降级**不得崩**、也不得"什么都不抛"（对照：未知类型仍必须抛）', async () => {
  ran += 1
  const { core, svc } = await mount({ columns: false })
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
