/**
 * 面⑦ **缺陷报告腿** —— G1 重派席 2026-09-25 **两条缺陷已修**，
 * 故本档已由「钉住**缺陷读数**」整体翻为「钉住**修复后的正向读数**」。
 *
 * ⚠ 本文件与其余五档的分工（翻正后仍然成立）：其余五档判「实现**做到了**它承诺的事」；
 *   本档判的是**上一批带证据报出来的两条缺陷**是否真的没了 —— 判据形状跟着事实走，不跟着愿望走。
 *
 * | 编号 | 缺陷（G1 席复核属实） | 修法 | 本档现在断言什么 |
 * |---|---|---|---|
 * | D1 | `reset` 检测对**多块**场景漏报（口径是「上下文里还有没有**任意**一块」而非「**这一块**还在不在」） | 判定面改为**逐块核对**（身份 = 宿主消息 id 这一**结构位置**，非内容水印 —— 见 A1-9） | 连着两块时只丢最老那块 ⇒ **必须**记 reset 且**点名**丢掉的那一块；两块都丢 ⇒ 行级读数跟丢块数走 |
 * | D2 | `inject_log.reset` **列零生产者**（gate 说 reset、列说 0，同一事实两处读数互相矛盾） | ① 生产侧 `finish('reset')` 显式传 `reset: true`；② core 侧补一处**与 `degraded` 同形**的 `||` 防呆 | reset 行必须带 `reset=1`；core 直写省略该字段时也必须为 1（且摘掉防呆后必为 0 —— 负控在同档内） |
 *
 * ⚠ **对拍打在对的腿上**：负控改的是 **lib**（判据真正读取的那一层，见 `_harness.mjs` 头注），
 *   不是 src 文本 —— 改 src 而不重建会让变异**从未生效**，读数看起来却像「判据没牙」。
 * ⚠ 改完实现必须重建 lib：本档断言的是**运行期读数**，读的正是 `packages/attention/lib/index.js`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, firePreStep, perceive, readInject, PKG } from './_harness.mjs'

const gatesOf = (rows) => rows.map((r) => r.gate)
const resetsOf = (rows) => rows.filter((r) => r.gate === 'reset')

// ── D1（已修）reset 检测**逐块**核对：多块场景下只丢最老那块也必须点名记 reset ──
test('D1 逐块核对：两块里只丢最老那块 ⇒ 必须记 1 行 reset 并点名那一块（退回 some(...) 即漏报）', async () => {
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
  const resets = resetsOf(rows)
  // 遮蔽条件成立：t3 的上下文里**确实还有另一个块** —— 旧口径的 `msgs.some(含 wrapper)` 正是被它遮蔽的
  assert.ok(JSON.stringify(blk2).includes('<mana-memory>'), '前置：t3 的上下文里仍有一块 ⇒ 遮蔽条件成立（这正是旧实现漏报的场景）')
  assert.equal(
    resets.length,
    1,
    `只丢了最老那一块 ⇒ **多块场景**必须记 1 行 reset（旧口径在此漏报）；实测 gates=${JSON.stringify(gatesOf(rows))}`,
  )
  assert.equal(resets[0].block_id, 'blk-1', 'reset 行必须点名**离开的那一块**（逐块核对的落点；身份=结构位置，不是内容水印 —— A1-9）')
  assert.equal(resets[0].turn_id, 3, 'reset 行应记在**发现它不在**的那一轮（到达证据：时序可读）')
  assert.equal(resets[0].memory_id, null, 'reset 行记的是「事件」不是注入 ⇒ memory_id 按政策表留 null')
  assert.equal(resets[0].reset, 1, 'reset 行必须带显式位 reset=1（core 列语义：与 gate=\'reset\' 配对）')
  assert.ok(!resets.some((r) => r.block_id === 'blk-2'), '仍在上下文里的那一块**不得**被误记（否则「块消失」被读成恒真）')

  // ② 两块都丢（上下文清空）⇒ 行级读数必须跟**丢块数**走（丢两块记两行，逐块各一行）
  await firePreStep(ctx, { turn: 4, messages: [] })
  const resets2 = resetsOf(readInject(store))
  assert.deepEqual(
    resets2.map((r) => r.block_id),
    ['blk-1', 'blk-2'],
    '逐块核对 ⇒ 每块离开各记一行（行级读数与「丢了几块」一致；只丢最老那块时那一行尤其关键）',
  )
  assert.deepEqual(resets2.map((r) => r.reset), [1, 1], '每一行都带显式位 reset=1')

  // ③ 反向腿（幂等）：已摘出跟踪表 ⇒ 不得把同一块重复记成「离开」
  await firePreStep(ctx, { turn: 5, messages: [] })
  assert.equal(resetsOf(readInject(store)).length, 2, '块已摘出跟踪表 ⇒ 不得重复记 reset（否则 reset 恒真、判据失效）')

  // ④ 负控（**打在 lib** —— 判据真正读取的那一层）：把逐块核对退回 some(...) ⇒ 本场景必漏报
  const m = await boot({
    judge: 'ok',
    mutant: {
      replace: [
        [
          '!stillInContext(blk.messageId)',
          "!msgs.some((mm) => (Array.isArray(mm?.content) ? mm.content : []).some((b) => typeof b?.text === 'string' && b.text.includes('<mana-memory>')))",
        ],
      ],
    },
  })
  perceive(m.ctx, { content: '候选·甲', requestId: 'req-1' })
  const m1 = await firePreStep(m.ctx, { turn: 1, messages: [] })
  const mb1 = m1.messages[m1.messages.length - 1]
  perceive(m.ctx, { content: '候选·乙', requestId: 'req-2' })
  const m2 = await firePreStep(m.ctx, { turn: 2, messages: [mb1] })
  const mb2 = m2.messages[m2.messages.length - 1]
  perceive(m.ctx, { content: '候选·丙', requestId: 'req-3' })
  await firePreStep(m.ctx, { turn: 3, messages: [mb2] })
  const mRows = readInject(m.store)
  assert.ok(
    gatesOf(mRows).filter((g) => g === 'injected').length >= 2,
    `负控前置：变异体里必须真注入过（否则「没有 reset」可能只是整条链没跑起来）；实得 ${JSON.stringify(gatesOf(mRows))}`,
  )
  assert.equal(
    resetsOf(mRows).length,
    0,
    '负控：【多块场景漏报】退回 some(...) 后「还有别的块在」遮蔽了「这一块没了」⇒ 本档用例在那种实现下就是红的（证明本判据有牙，且打在对的腿上）',
  )

  /**
   * ⑤ **块身份必须是结构位置，不得是内容水印**（A1-9 在**生产链路**上的落点）。
   *
   * ⚠ 本腿是实测补的一处**盲区**：A1-9 的机检用例（`core/tests/lexical-audit.test.mjs` 的 F4/F5）
   *   都是**直写** `svc.writeInjectLog({...})` 的单元腿 —— 它们判的是 core 的写入契约，
   *   **从不驱动本包的生产链路**。实测（G1 重派席）：把块身份换成内容水印后，
   *   审计行经真实注入链路泄漏 6 个 3-gram，而 **F4/F5 仍然全绿**。
   *   ⇒ 「A1-9 已经在守这件事」是**假的前提**；守它的只能是"走真注入链路再数 n-gram"的腿。
   *   （本仓纪律：报红 ≠ 报在对的腿上 —— 这里更狠：**不报红也可能根本没打在靶上**。）
   */
  const SECRET = '这是一段绝不应出现在审计表里的记忆原文内容'
  const gramsOf = (s) => { const g = []; for (let i = 0; i + 3 <= s.length; i += 1) g.push(s.slice(i, i + 3)); return g }
  const secretBoot = await boot({ judge: 'ok' })
  perceive(secretBoot.ctx, { content: SECRET, requestId: 'mem-secret-1' })
  await firePreStep(secretBoot.ctx, { turn: 1, messages: [] })
  const hay = JSON.stringify(readInject(secretBoot.store))
  const leaked = gramsOf(SECRET).filter((g) => hay.includes(g))
  assert.equal(leaked.length, 0, `走**真注入链路**后 inject_log 泄漏了内容片段：${JSON.stringify(leaked.slice(0, 3))}`)
  assert.ok(hay.includes('mem-secret-1'), '但 id 必须留（否则"不泄内容"退化成"什么都不记"）')

  // 负控：把块身份换成**内容水印**（block_id 里存块内容）⇒ 上面那条腿必须真的命中
  const wm = await boot({
    judge: 'ok',
    mutant: { replace: [["finish('injected', { blockId, memoryId: injectedMemoryId })", "finish('injected', { blockId: block.slice(0, 24), memoryId: injectedMemoryId })"]] },
  })
  perceive(wm.ctx, { content: SECRET, requestId: 'mem-secret-1' })
  await firePreStep(wm.ctx, { turn: 1, messages: [] })
  const wmLeaked = gramsOf(SECRET).filter((g) => JSON.stringify(readInject(wm.store)).includes(g))
  assert.ok(
    wmLeaked.length > 0,
    '负控：块身份一旦换成内容水印（把块内容写进审计列），本腿必须命中 ⇒ 证明「用结构位置」不是风格偏好，而是被 A1-9 逼出来的唯一解',
  )
})

// ── D2（已修）inject_log.reset 显式位：生产侧写入 + core 层同形防呆，两层各自承重 ──
test('D2 inject_log.reset 列：gate=reset 的行 reset=1（生产侧显式位 + core 同形防呆，负控在同档内）', async () => {
  const { ctx, store, core } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '候选·列', requestId: 'req-col' })
  await firePreStep(ctx, { turn: 1, messages: [] })
  await firePreStep(ctx, { turn: 2, messages: [] }) // 块离开上下文 ⇒ 应按政策记 gate='reset'

  const rows = readInject(store)
  const byGate = resetsOf(rows)
  assert.equal(byGate.length, 1, '前置：gate 口径下确实有 1 行 reset（否则本腿没打到靶上）')
  assert.equal(byGate[0].reset, 1, `【已修】reset 行必须带 reset=1（列语义=与 gate='reset' 配对的显式位）；实测 reset=${byGate[0].reset}`)
  assert.equal(byGate[0].block_id, 'blk-1', 'reset 行还须点名是哪一块离开（行级读数：D1 的落点）')

  // 生产侧证据（**已翻正**）：src 里必须存在 reset:true 的写入点（此前实测 0 处 ⇒ 该列零生产者）
  const src = readFileSync(join(PKG, 'src', 'index.ts'), 'utf8')
  assert.match(
    src,
    /finish\('reset',\s*\{[^}]*reset:\s*true/,
    '【已修】生产侧必须有 `finish(\'reset\', { reset: true ... })` 的写入点（此前 0 处 ⇒ 该列恒空、按 reset=1 的查询静默归零）',
  )

  /**
   * 对照腿 ①（core 防呆 · 与 `degraded` 同形）：`gate='reset'` **蕴含** `reset=1` ——
   * 调用方**省略**该字段或显式传 `false`，都不得把这一位抹成 0（同 `degraded` 的 `||` 防呆口径）。
   */
  core.writeInjectLog({ sessionId: 's-d2', turnId: 9, requestId: 'r-omit', gate: 'reset' })
  core.writeInjectLog({ sessionId: 's-d2', turnId: 10, requestId: 'r-false', gate: 'reset', reset: false })
  const direct = readInject(store).filter((r) => r.session_id === 's-d2')
  assert.deepEqual(
    direct.map((r) => r.reset),
    [1, 1],
    'core 防线：gate=reset 蕴含 reset=1 —— 「省略字段」与「显式传 false」两条路都必须填上（否则该列仍可被静默抹掉）',
  )

  // 对照腿 ②（**负控**，打 core lib）：把 core 的 `||` 防呆摘掉 ⇒ 省略字段时该列必须变 0
  const mut = await boot({
    judge: 'ok',
    coreMutant: {
      replace: [
        ["const reset = entry.reset === true || entry.gate === 'reset';", 'const reset = entry.reset === true;'],
      ],
    },
  })
  mut.core.writeInjectLog({ sessionId: 's-d2m', turnId: 1, requestId: 'r-omit', gate: 'reset' })
  const mutRow = readInject(mut.store).filter((r) => r.session_id === 's-d2m')[0]
  assert.equal(
    mutRow.reset,
    0,
    '负控：摘掉 core 的 || 防呆后，省略 reset 字段 ⇒ 列必须变 0 —— 证明这条防呆**承重**、本判据对它敏感（不是恰好为 1）',
  )

  /**
   * 对照腿 ③（**两层都摘掉** ⇒ 该列重新失去生产者）：
   * ⚠ 如实标注本腿的边界 —— 单摘任一层**都仍为 1**（两层互为兜底：core 的 `||` 按 `gate` 补位，
   *   生产侧的显式位按调用方补位）。故「必红」只能由**两层同时失效**证成；
   *   把这条读成「摘掉生产侧那一行就会红」是**打错靶**（本仓纪律：报红 ≠ 报在对的腿上）。
   */
  const both = await boot({
    judge: 'ok',
    mutant: { replace: [['reset: extra.reset === true,', 'reset: false,']] },
    coreMutant: { replace: [["const reset = entry.reset === true || entry.gate === 'reset';", 'const reset = entry.reset === true;']] },
  })
  perceive(both.ctx, { content: '候选·两层', requestId: 'req-both' })
  await firePreStep(both.ctx, { turn: 1, messages: [] })
  await firePreStep(both.ctx, { turn: 2, messages: [] })
  const bothReset = resetsOf(readInject(both.store))
  assert.equal(bothReset.length, 1, '负控前置：两层变异体里仍须有 1 行 reset（否则本腿没打到靶上）')
  assert.equal(
    bothReset[0].reset,
    0,
    '负控：生产侧显式位与 core 防呆**同时**摘掉 ⇒ reset 行必须退回 reset=0（本档 D2 断言在那种实现下就是红的 ⇒ 判据有牙）',
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
   * `src/index.ts` 自述（原文）：
   *   「`finish` 内部的 `requestId` 取 `pending[0]?.requestId ?? 'pre-step:'+turn`，
   *    而此处 `pending` 紧接着被清空 ⇒ `injected` 行的 `request_id` 实际落成 `pre-step:N`
   *    （**丢掉了候选 id**）。⇒ 本行的 `memoryId` 是该行唯一能指回'注入了哪条'的列」
   * 本用例把这条自述钉成读数（本批**不在写面内**，故保持原样）：**在 `pending` 被清空之前**
   * `req-link` 是**在场**的，行里却写不出它 ⇒ 「关联键指向候选」这件事只在 memory_id 一路可查。
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
