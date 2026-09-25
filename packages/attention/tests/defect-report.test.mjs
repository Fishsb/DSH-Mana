/**
 * 面⑦ **缺陷报告腿**（本席 F2 实测发现，**不是**判据写错）—— 一红一档，如实标注。
 *
 * ⚠ 本文件与其余五档的分工：其余五档判「实现**做到了**它承诺的事」；
 *   本档判「实现**没做到**它承诺的事」——即本席**带证据的缺陷报告**，由主持人派单修。
 *   本席写面不含 `packages/attention/src/**` ⇒ **不改实现**，只把事实钉成可机检的红。
 *
 * 若哪天实现被修好，本档会**变红**（断言的是当下的缺陷读数）——
 * 那时应把结论从「缺陷」改成「已修」，并同步更新 `docs/handoff/F2.md`。
 * 这是**有意**的设计：判据的形状跟着事实走，不跟着愿望走。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, firePreStep, perceive, readInject, PKG } from './_harness.mjs'

const gatesOf = (rows) => rows.map((r) => r.gate)

// ── D1 reset 检测对「多块场景」漏报（判定面是 any 而不是逐块）───────────────
test('D1【缺陷·未修】连续注入两块后只丢最老那块 ⇒ 不记 reset（本用例变红即表示**缺陷已修**，届时改判据）', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })

  // t1：注入 blk-1
  perceive(ctx, { content: '候选·甲', requestId: 'req-1' })
  const d1 = await firePreStep(ctx, { turn: 1, messages: [] })
  const blk1 = d1.messages[d1.messages.length - 1]
  // t2：再注入 blk-2（上下文里有 blk-1）
  perceive(ctx, { content: '候选·乙', requestId: 'req-2' })
  const d2 = await firePreStep(ctx, { turn: 2, messages: [blk1] })
  const blk2 = d2.messages[d2.messages.length - 1]
  assert.notEqual(blk1.id, blk2.id, '前置：两块必须是**不同**的块（否则本腿测的不是多块场景）')
  assert.deepEqual(gatesOf(readInject(store)), ['injected', 'injected'], '前置：两块都应真注入')

  // t3：**只丢最老的 blk-1**（模拟上下文压缩：老消息被裁掉，新消息还在）
  perceive(ctx, { content: '候选·丙', requestId: 'req-3' })
  await firePreStep(ctx, { turn: 3, messages: [blk2] })

  const rows = readInject(store)
  /**
   * 事实：`blk-1` 已**离开上下文**（t3 的 messages 里只有 blk-2），
   * 而 `injectedBlocks` 里的 `blk-1` 从未被清掉 ⇒ 审计里那行 `injected` **永久标着已注入**。
   *
   * 判据原文（`packages/attention/src/index.ts:312-319` 自述）：
   *   「若不检测，`inject_log` 里那行 `injected` 会**永久标着已注入**，而上下文里其实早没了
   *    —— 『注入审计』就成了假账（本仓首位缺陷类：让失败不可观测）。」
   *   —— 本用例正是那个自述要防的形态，只是**多块**时才发生。
   *
   * 机制：检测读的是 `injectedBlocks.size > 0 && !msgs.some(含 wrapper)` ——
   * **块级集合**被当成**单个布尔**用（"上下文里还有没有 mana-memory 块"），
   * 于是「仍有别的块在」会**遮蔽**「这一块没了」。
   */
  assert.equal(
    rows.some((r) => r.gate === 'reset'),
    false,
    `【期望（若已修）】blk-1 离开上下文应记 reset。当前实测读数：${JSON.stringify(gatesOf(rows))}` +
      ' ⇒ 本缺陷仍在：reset 检测在多块场景下漏报',
  )
  // 补证：t3 的上下文里确实只剩 blk-2（即"还有块在"这个遮蔽条件是**成立**的）
  const ctxText = JSON.stringify(blk2)
  assert.ok(ctxText.includes('<mana-memory>'), '前置：t3 的上下文里确实还有另一个块 —— 遮蔽条件成立')
})

// ── D2 `inject_log.reset` 列零生产者（与 gate='reset' 两处读数不一致）──────
test('D2【缺陷·未修】inject_log.reset 布尔列零生产者（本用例变红即表示**缺陷已修**，届时改判据）', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选·列', requestId: 'req-col' })
  await firePreStep(ctx, { turn: 1, messages: [] })
  await firePreStep(ctx, { turn: 2, messages: [] }) // 块离开上下文 ⇒ 应按政策记 gate='reset'

  const rows = readInject(store)
  const byGate = rows.filter((r) => r.gate === 'reset')
  assert.equal(byGate.length, 1, '前置：gate 口径下确实有 1 行 reset（否则本腿没打到靶上）')

  /**
   * core 的列语义（`core/src/index.ts` 的 `InjectLogEntry.reset` 注释原文）：
   *   「该块是否已离开上下文（**与 `gate='reset'` 配对的显式位**）」。
   * 实测：生产者**从未传过**该字段（`src` 里 `reset: true` 出现 **0** 次）⇒ `gate='reset'` 的行，
   * `reset` 列仍是 `0`。⇒ 同一事实的两处读数**互相矛盾**，且其中一处**恒为空**。
   * 「恒空」正是本仓首位缺陷类（有列无值 ⇒ 该列上的任何查询都静默归零）。
   */
  assert.equal(
    byGate[0].reset,
    0,
    `【期望（若已修）】reset 行应带 reset=1。当前实测：reset=${byGate[0].reset}（列零生产者）⇒ 缺陷仍在`,
  )
  const src = readFileSync(join(PKG, 'src', 'index.ts'), 'utf8')
  assert.equal(
    (src.match(/reset:\s*true/g) ?? []).length,
    0,
    '【期望（若已修）】生产侧应出现 reset:true 的写入点；实测 0 处 ⇒ 该列确实无人写',
  )
})

// ── D3 已知且**已自述**的相邻缺口：injected 行的 request_id 丢掉候选 id ─────
test('D3【已知缺口·自述·未修】injected 行的 request_id 落成 pre-step:N（变红即表示**已修**）', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选·关联键', requestId: 'req-link' })
  await firePreStep(ctx, { turn: 7 })

  const row = readInject(store)[0]
  assert.equal(row.gate, 'injected')
  /**
   * `src/index.ts:466-469` 自述（原文）：
   *   「`finish` 内部的 `requestId` 取 `pending[0]?.requestId ?? 'pre-step:'+turn`，
   *    而此处 `pending` 紧接着被清空 ⇒ `injected` 行的 `request_id` 实际落成 `pre-step:N`
   *    （**丢掉了候选 id**）。⇒ 本行的 `memoryId` 是该行唯一能指回'注入了哪条'的列」
   * 本用例把这条自述钉成读数：**在 `pending` 被清空之前** `req-link` 是**在场**的，
   * 行里却写不出它 ⇒ 「关联键指向候选」这件事只在 memory_id 一路可查。
   */
  assert.equal(row.request_id, 'pre-step:7', `【期望（若已修）】request_id 应指回候选 req-link；实测 ${row.request_id}`)
  assert.equal(row.memory_id, 'req-link', '兜底：候选 id 至少经 memory_id 可查（否则该注入完全不可回溯）')
})

// ── D4 五类可达性的**兜底对账**：任何一类不可达都会在此显形 ──────────────────
test('D4 五类枚举可达性兜底对账（与门①同源独立驱动一次；本用例是**正向**判据，红=真回归）', async () => {
  const { ctx, store } = await boot({ judge: 'none' })
  let mode = 'ok'
  ctx.on('mana/jev/judge', async (req) => {
    if (mode === 'ok') return { requestId: req.requestId, source: 's', value: 'yes', probability: 0.95, degraded: false, reason: null }
    if (mode === 'below') return { requestId: req.requestId, source: 's', value: 'no', probability: 0.2, degraded: false, reason: null }
    return { requestId: req.requestId, source: 's', value: 'unknown', probability: null, degraded: true, reason: 's' }
  })
  const seen = []
  await firePreStep(ctx, { turn: 1 }) // skip_no_candidate
  perceive(ctx, { content: '甲', requestId: 'r1' })
  await firePreStep(ctx, { turn: 2 }) // injected
  await firePreStep(ctx, { turn: 3, messages: [] }) // reset
  mode = 'below'
  perceive(ctx, { content: '乙', requestId: 'r2' })
  await firePreStep(ctx, { turn: 4 })
  mode = 'degraded'
  perceive(ctx, { content: '丙', requestId: 'r3' })
  await firePreStep(ctx, { turn: 5 })
  for (const r of readInject(store)) seen.push(r.gate)

  assert.deepEqual(
    [...seen].sort(),
    ['degraded_unavailable', 'injected', 'reset', 'skip_below_threshold', 'skip_no_candidate'].sort(),
    `五类可达性对账失败：${JSON.stringify(seen)}`,
  )
})
