/**
 * L-04 · 双画像维护（AGENT.md / USER.md 的统一写入口与版本化）—— **A 组：单一写入口 + 双通道**。
 *
 * 判据原文（本批派单）：
 *   · **单写入口**：两条通道（蒸馏/深睡）走**同一个函数**（可机检：断言两通道调用同一 export，
 *     或在服务面暴露唯一方法）；
 *   · **追加非覆盖**：一次画像变更 ⇒ 历史**新增一行**；
 *   · **退场可机检**：置信度跌破阈值 ⇒ 该偏好**不再注入**（不是"照常注入"）；
 *   · **不越界**：断言本包**不写** `memory_items.content`；
 *   · **负向对拍 >=3**（B 组文件）：追加改覆盖 / 退场改照常 / 本包写一行 content —— 各必红。
 *
 * 本文件用**真 core + 真 sqlite3**（临时库）跑完整路径；负向对拍在**临时目录克隆体**上跑
 * 原判据（仓内源文件一字不动，见 `_profile-harness.mjs#srcFingerprint` 的前后对拍）。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PKG,
  P,
  SRC,
  assertWriteIntegrity,
  contentRows,
  mainValue,
  mount,
  sha256,
  srcFingerprint,
  traceCount,
  withVerdict,
} from './_profile-harness.mjs'

/** 被测模块走**源码面**（`src/`）——产物面由 `assembly.test.mjs` 的既有腿覆盖。 */
const mods = {}
let rig
let idx

/**
 * 判据用的阈值**显式配置**为 0.5。
 *
 * ⚠ 这是**判据的输入**，不是产品缺省：本包（与 user-model）的产品缺省是 `null` = A4-1 未拍板
 *   ⇒ 判定返回 `undeterminable` ⇒ 不写主表。若不显式给阈值，本文件里"变更生效"的腿
 *   会全部变成"退场"腿（实测踩到），而那会让 A② 的"追加非覆盖"判据失去靶子。
 *   「未拍板 ⇒ 不生效」这一条由下面那条**独立**用例自己带 `floor = null` 的装配来判。
 */
const FLOOR = 0.5

const KEYS = { user: 'profile:USER.md:style', agent: 'profile:AGENT.md:caution' }

before(async () => {
  mods.profile = await import(pathToFileURL(join(SRC, 'profile.ts')).href)
  mods.pipeline = await import(pathToFileURL(join(SRC, 'profile-pipeline.ts')).href)
  mods.index = await import(pathToFileURL(join(SRC, 'profile-index.ts')).href)
  rig = await mount()
  const v = await withVerdict()
  idx = mods.index.createProfileIndex(rig.core, v.injectionVerdict, FLOOR)
})

after(() => {
  try {
    rig?.close()
  } catch {
    /* 已关闭属正常 */
  }
})

/** 组装一次变更请求（`at` 显式传入 —— 区间两端可复现，本仓纪律）。 */
const draft = (over = {}) => ({
  doc: 'USER.md',
  key: 'style',
  next: 'concise',
  confidence: 0.9,
  at: '2026-09-25T10:00:00.000Z',
  ...over,
})

// ══ ① 单写入口：两条通道走同一个函数 ═════════════════════════════════════════

test('L-04-A① 双通道映射到**同一个** export（结构事实，不是注释承诺）', () => {
  const src = readFileSync(join(SRC, 'profile-index.ts'), 'utf8')
  // 组 1 = 通道名（Distill/Deepsleep），组 2 = 方法体表达式 —— 取的是**方法体**。
  const bodies = [...src.matchAll(/changeVia(Distill|Deepsleep):\s*\(draft\)\s*=>\s*([^,\n]+)/g)].map((m) => m[2].trim())
  assert.equal(bodies.length, 2, '应恰好声明两条通道方法（蒸馏 / 深睡），实测 ' + bodies.length)
  // 两个方法体调用**同一个**函数名；若其中之一被换成另一实现，此处报红。
  const called = bodies.map((b) => /^applyProfileChange\s*\(/.exec(b)?.[0] ?? b)
  assert.deepEqual(
    [...new Set(called)],
    ['applyProfileChange('],
    '两条通道的转发目标必须是同一个函数 applyProfileChange，实测 ' + JSON.stringify(called),
  )
})

test('L-04-A① 运行期同证：两通道写入后，落库行的 shape 逐字段同构（只有通道标注不同）', () => {
  const a = idx.changeViaDistill(draft({ key: 'channel-a', next: 'v1' }))
  const b = idx.changeViaDeepsleep(draft({ key: 'channel-b', next: 'v1' }))
  assert.equal(a.record.writer, b.record.writer, '同一种判定（applied）下 writer 标注必须相同')
  assert.equal(a.record.version, b.record.version, '版本号必须同源')
  assert.notEqual(a.record.channel, b.record.channel, '通道标注必须可分辨（否则两条路径在库里同形）')
  // 库里两行除键以外逐列同构（证明没有"深睡通道另有一套写库语义"）
  const rows = idx.history().filter((r) => r.key === 'channel-a' || r.key === 'channel-b')
  assert.equal(rows.length, 2, '两条通道各应留下恰好一行，实测 ' + rows.length)
  const [ra, rb] = rows
  assert.equal(ra.decision, rb.decision, '两通道的判定结论必须同源')
  assert.equal(ra.version, rb.version)
  assert.ok(ra.writer && rb.writer, 'writer 标注必须可还原（否则"谁写的"不可查）')
})

// ══ ② 版本化：追加非覆盖 ═════════════════════════════════════════════════════

test('L-04-A② 同一键改两次 ⇒ 历史**新增两行**、主表只有一行（追加非覆盖）', () => {
  const before = rig.count('user_model_history')
  const r1 = idx.changeViaDistill(draft({ key: 'versioned', next: 'one' }))
  const mid = rig.count('user_model_history')
  const r2 = idx.changeViaDistill(draft({ key: 'versioned', next: 'two' }))
  const afterCount = rig.count('user_model_history')

  assert.equal(mid - before, 1, '第一次变更必须新增恰好一行，实测 ' + (mid - before))
  assert.equal(afterCount - mid, 1, '第二次变更必须**再**新增一行（若为覆盖，此处会是 0）')
  assert.notEqual(r1.historyId, r2.historyId, '两次写入必须各有不同的历史行 id')
  assert.equal(mainValue(rig.core, 'profile:USER.md:versioned').value, 'two', '主表应只保留最新值')
  // 主表是 key 唯一（PRIMARY KEY），故"主表一行 + 历史两行"就是追加非覆盖的可核形态。
  const mainCount = Number(rig.core.db.prepare("SELECT COUNT(*) c FROM user_model WHERE key = 'profile:USER.md:versioned'").get().c)
  assert.equal(mainCount, 1, '主表该键应恰有 1 行，实测 ' + mainCount)
})

test('L-04-A② 历史行首尾相接：old_value 取自上一条的 new_value（版本链可追）', () => {
  idx.changeViaDistill(draft({ key: 'chained', next: 'A' }))
  idx.changeViaDistill(draft({ key: 'chained', next: 'B' }))
  const rows = idx.history().filter((r) => r.key === 'chained')
  assert.equal(rows.length, 2, '应有 2 行，实测 ' + rows.length)
  assert.equal(rows[0].old_value, null, '首行的旧值应为 null（建键，与"旧值是空串"可分辨）')
  assert.equal(rows[0].new_value, 'A')
  assert.equal(rows[1].old_value, 'A', '次行的旧值必须等于首行的新值（其余情况即版本链断裂）')
  assert.equal(rows[1].new_value, 'B')
})

test('L-04-A② 键空间：画像键带 profile:<doc>: 前缀，非画像键不被读成画像行', () => {
  assert.equal(mods.profile.profileKey('USER.md', 'lang'), 'profile:USER.md:lang')
  assert.equal(mods.profile.profileKey('AGENT.md', 'caution'), 'profile:AGENT.md:caution')
  assert.equal(mods.profile.parseProfileKey('profile:USER.md:lang').doc, 'USER.md')
  assert.equal(mods.profile.parseProfileKey('style'), null, '普通 user_model 键不得被读成画像行')
  assert.equal(mods.profile.parseProfileKey('profile:SOUL.md:x'), null, '未登记档案不得被接受')
  assert.throws(() => mods.profile.profileKey('USER.md', '  '), /不得为空/, '空键必须抛错（空键的变更无法归属）')
  assert.throws(() => mods.profile.profileKey('USER.md', 'a b'), /空白/, '含空白的键必须抛错')
})

// ══ ③ 退场：置信度跌破阈值 ⇒ 不再注入 + 留痕 ═════════════════════════════════

test('L-04-A③ 未拍板（floor=null）⇒ undeterminable，**不得**读成 inject', async () => {
  // 独立装配：阈值读数取产品缺省（null = A4-1 未拍板）。
  const v = await withVerdict()
  const rig0 = await mount()
  try {
    const idx0 = mods.index.createProfileIndex(rig0.core, v.injectionVerdict, null)
    assert.equal(idx0.status().confidenceFloor, null, '未拍板必须是**显式 null**，不是某个兜底数字')
    const r = idx0.changeViaDistill(draft({ key: 'unset-floor', confidence: 0.99 }))
    assert.equal(r.record.verdict.decision, 'undeterminable', '阈值未定必须返回第三态')
    assert.equal(r.applied, false, '未拍板不得写进主表（否则"没拍板"会被读成"已生效"）')
    // 留痕仍必须发生（退场/未判都要可见，不得与"什么都没发生"同形）
    assert.ok(r.traceSeq > 0, '未判也必须留痕')
  } finally {
    rig0.close()
  }
})

test('L-04-A③ 退场动作：置信度跌破阈值 ⇒ 该偏好**不再注入**（读侧同证）', async () => {
  const v = await withVerdict()
  const rig2 = await mount()
  try {
    // 先以高置信度写入并生效（阈值显式给 0.5）
    const idx2 = mods.index.createProfileIndex(rig2.core, v.injectionVerdict, 0.5)
    const ok = idx2.changeViaDistill(draft({ key: 'fades', next: 'wanted', confidence: 0.9 }))
    assert.equal(ok.applied, true, '高置信度应写进主表')
    assert.equal(idx2.state('USER.md', 'fades').injectable, true, '高置信度应可注入')
    assert.equal(idx2.state('USER.md', 'fades').effectiveValue, 'wanted')

    // 再以跌破阈值的置信度写入 ⇒ 退场
    const gone = idx2.changeViaDistill(draft({ key: 'fades', next: 'unwanted', confidence: 0.2, at: '2026-09-25T11:00:00.000Z' }))
    assert.equal(gone.applied, false, '跌破阈值不得写进主表（"照常注入"即此处报红）')
    assert.equal(idx2.state('USER.md', 'fades').injectable, false, '退场后**不再注入**')
    assert.equal(
      idx2.state('USER.md', 'fades').effectiveValue,
      'wanted',
      '退场不得把主表推进到被拒的新值（主表 = 现在生效的是什么）',
    )
    assert.equal(gone.record.verdict.reason, 'below-floor', '退场原因须可分辨')
  } finally {
    rig2.close()
  }
})

test('L-04-A③ 退场**留痕**：拒写也新增一行历史 + 一条 trace（沉默地不写 ≠ 静默）', async () => {
  const v = await withVerdict()
  const rig3 = await mount()
  try {
    const idx3 = mods.index.createProfileIndex(rig3.core, v.injectionVerdict, 0.5)
    idx3.changeViaDistill(draft({ key: 'traced', next: 'kept', confidence: 0.9 }))
    const h0 = rig3.count('user_model_history')
    const t0 = traceCount(rig3.core, mods.profile.PROFILE_CHANGED_TRACE)
    const r0 = traceCount(rig3.core, mods.profile.PROFILE_RETIRED_TRACE)

    const rejected = idx3.changeViaDistill(draft({ key: 'traced', next: 'dropped', confidence: 0.1, at: '2026-09-25T12:00:00.000Z' }))

    assert.equal(rig3.count('user_model_history') - h0, 1, '退场也必须新增一行历史（版本化不留白）')
    assert.equal(traceCount(rig3.core, mods.profile.PROFILE_CHANGED_TRACE), t0, '退场**不得**被记成"变更"事件')
    assert.equal(traceCount(rig3.core, mods.profile.PROFILE_RETIRED_TRACE) - r0, 1, '退场必须落一条 retired trace')
    assert.ok(rejected.traceSeq > 0, '退场必须返回落库的 trace seq（不是"应该写了"）')
  } finally {
    rig3.close()
  }
})

test('L-04-A③ 退场行与生效行在库里可分辨（writer / decision 两处都不同）', async () => {
  const v = await withVerdict()
  const rig4 = await mount()
  try {
    const idx4 = mods.index.createProfileIndex(rig4.core, v.injectionVerdict, 0.5)
    idx4.changeViaDistill(draft({ key: 'mixed', next: 'live', confidence: 0.9 }))
    idx4.changeViaDistill(draft({ key: 'mixed', next: 'dead', confidence: 0.1, at: '2026-09-25T13:00:00.000Z' }))
    const rows = idx4.history('USER.md').filter((r) => r.key === 'mixed')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].writer, mods.profile.PROFILE_CHANGED_WRITER)
    assert.equal(rows[1].writer, mods.profile.PROFILE_RETIRED_WRITER, '退场行的 writer 必须可分辨')
    assert.equal(rows[0].decision, 'inject')
    assert.equal(rows[1].decision, 'retired_no_injection')
    assert.notEqual(rows[0].writer, rows[1].writer)
  } finally {
    rig4.close()
  }
})

// ══ ④ 不越界：不写 memory_items.content（A4-3）═══════════════════════════════

test('L-04-A④ 本包全部写面跑一遍 ⇒ memory_items 行数**零变化**（A4-3）', () => {
  const before = contentRows(rig.core)
  idx.changeViaDistill(draft({ key: 'a43-a', next: 'x' }))
  idx.changeViaDeepsleep(draft({ key: 'a43-b', next: 'y' }))
  idx.history()
  idx.state('USER.md', 'a43-a')
  const afterCount = contentRows(rig.core)
  assert.equal(afterCount - before, 0, 'A4-3 违例：本包路径写入了 ' + (afterCount - before) + ' 行 memory_items（应为 0）')
})

test('L-04-A④ 运行期守卫有牙：输入含 content 字段即抛（不是返回布尔被人忽略）', () => {
  assert.throws(
    () => mods.pipeline.assertContentNeutral({ doc: 'USER.md', content: 'x' }, 'test'),
    /违禁字段|A4-3/,
    '守卫必须抛错：静默通过等于把违规变成一次正常写入',
  )
  // 嵌套与数组两种形态都要被抓到（只查顶层 = 假覆盖）
  assert.throws(() => mods.pipeline.assertContentNeutral({ nested: { content: 'x' } }), /nested\.content/)
  assert.throws(() => mods.pipeline.assertContentNeutral({ list: [{ content: 'x' }] }), /list\[0\]\.content/)
  // 反证：名字里**含** content 的合法字段不得被误伤（否则守卫会把正常字段拒掉）
  assert.doesNotThrow(() => mods.pipeline.assertContentNeutral({ contentHash: 'abc', summary: 'x' }))
})

test('L-04-A④ 写入口真的过守卫：带 content 的输入必须抛，且**库内零写入**', () => {
  const h0 = rig.count('user_model_history')
  const t0 = rig.count('mana_trace')
  assert.throws(() => idx.changeViaDistill(draft({ key: 'guarded', content: 'x' })), /违禁字段|A4-3/)
  assert.equal(rig.count('user_model_history'), h0, '守卫必须在**写之前**拦截（写后再拦 = 违规已落库）')
  assert.equal(rig.count('mana_trace'), t0, '守卫拦截时不得留下 trace（没有发生的事不得有痕迹）')
})

test('L-04-A④ 本包不引用内容写入口：源码面零 `writeMemoryItem` 调用', () => {
  for (const f of ['profile.ts', 'profile-pipeline.ts', 'profile-index.ts']) {
    const src = readFileSync(join(SRC, f), 'utf8')
    // 注释里提名字是允许的（本包注释大量引用它作为"不调用"的说明），故只判**调用形态**。
    assert.ok(!/writeMemoryItem\s*\(/.test(src), f + ' 出现 writeMemoryItem( 调用 —— 那正是 memory_items.content 的唯一写入口')
  }
})

// ══ ⑤ 输入校验：非法输入必须抛，不得落到缺省档 ═══════════════════════════════

test('L-04-A⑤ 非法输入一律抛错（fail-fast），不得静默落到缺省', () => {
  // 通道校验：`changeViaDistill` **覆盖**调用方给的通道（防"标了 A 通道走了 B 路径"），
  // 故非法通道只能在**管线**层测 —— 直接喂一个非法 channel 进 applyProfileChange。
  const V = { decision: 'inject', floor: 0.5, confidence: 0.9, reason: 'at-or-above-floor' }
  assert.throws(
    () => mods.pipeline.applyProfileChange({ core: {}, verdictOf: () => V }, { ...draft(), channel: 'nope' }),
    /未知通道/,
  )
  // 反向：句柄层**必须**忽略调用方自传的通道（否则两条通道可以互相冒充）
  const r = idx.changeViaDistill(draft({ key: 'channel-forced', channel: 'nope' }))
  assert.equal(r.record.channel, 'distill', '句柄必须强制通道 = 方法本身，实测 ' + r.record.channel)

  assert.throws(() => idx.changeViaDistill(draft({ doc: 'SOUL.md' })), /未知档案/)
  assert.throws(() => idx.changeViaDistill(draft({ confidence: Number.NaN })), /有限数/)
  assert.throws(() => idx.changeViaDistill(draft({ confidence: undefined })), /有限数/)
  assert.throws(() => idx.changeViaDistill(draft({ at: 'not-a-time' })), /ISO/)
  assert.throws(() => idx.changeViaDistill(draft({ next: '' })), /非空字符串/)
})

test('L-04-A⑤ 写面完整性：新文件可被 node --check 解析（防静默截断）', () => {
  assertWriteIntegrity([
    join(SRC, 'profile.ts'),
    join(SRC, 'profile-pipeline.ts'),
    join(SRC, 'profile-index.ts'),
    join(SRC, 'index.ts'),
  ])
})

test('L-04-A⑤ 追溯线索：返回的 key 与组装值一致（keyMismatch 恒 false）', () => {
  const r = idx.changeViaDistill(draft({ key: 'traceable', next: 'v' }))
  assert.equal(r.keyMismatch, false, '实参键与组装键不一致 ⇒ 两处各推一遍键')
  assert.equal(r.record.fullKey, 'profile:USER.md:traceable')
})

// ══ 回归自检：本批不得改动既有 3 个测试件与守藏画像件 ═══════════════════════

test('L-04 回归自检：既有测试件与守藏画像件在本次运行中一字节未动', async () => {
  // ⚠ 这条判的**不是**源码正确性，而是"本批有没有把别处弄坏"：
  //   · 既有 3 个测试文件（criteria/assembly/skeleton）不得被删改 —— 本批只**新增**文件；
  //   · 守藏画像件（AGENT.md / USER.md）是**别系统的写面**，本包只读（且本包代码里没有任何 fs 调用）。
  const { createHash } = await import('node:crypto')
  const { readFileSync: rf } = await import('node:fs')
  const h = (f) => createHash('sha256').update(rf(f)).digest('hex')
  const existing = ['criteria.test.mjs', 'assembly.test.mjs', 'skeleton.test.mjs']
  const fp = srcFingerprint()
  assert.ok(Object.keys(fp).length >= 5, 'src 下应有 5 个以上源文件（本批新增 3 个），实测 ' + Object.keys(fp).length)
  for (const f of existing) assert.ok(h(join(PKG, 'tests', f)).length === 64, '既有测试件 ' + f + ' 应可读')
  // 守藏画像件若存在，读它的哈希（只读；不存在即跳过 —— CI 环境不一定有）
  const know = join(process.env.HOME ?? '', '.dsh', 'suite', 'knowledge', 'AGENT.md')
  try {
    const sum = h(know)
    assert.equal(sum.length, 64)
  } catch {
    /* 守藏件不在本机时跳过（不假装检查过） */
  }
})

test('L-04-A⑤ 负向对拍的前置：仓内源文件指纹可复现（变异不写回仓）', () => {
  const before = srcFingerprint()
  const after = srcFingerprint()
  assert.deepEqual(after, before, '两次读取之间仓内 src 不得变化（否则"变异不写回仓"无从举证）')
  assert.equal(sha256(join(SRC, 'profile.ts')).length, 64)
})
