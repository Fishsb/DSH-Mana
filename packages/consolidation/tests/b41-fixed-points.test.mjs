/**
 * B4.1 固定夹具判据：**三个阈值必须可机检复算**（不许只判"跑通"）。
 *
 * ── 为什么这样写（判据纪律）──────────────────────────────────────────────────────
 * · **固定夹具 + 闭式期望值**：夹具用 2 维整数向量（如 `[1,0]` 与 `[1,1]`），
 *   其余弦**能手算**：`cos([1,0],[1,1]) = √2/2 = 0.7071067811865475`、`cos([1,0],[3,4]) = 3/5 = 0.6`。
 *   期望值写在断言里并与手算值对拍，而不是"跑一遍看它输出什么就写什么"（那是自证）。
 * · **默认值路径**：②⑦⑧ 三条**不传阈值**，走 `params.ts` 的缺省 ⇒ 改阈值常量必然翻红
 *   （负向对拍见 `docs/handoff/S16.md`：0.7→0.6 / 2→3 / 7→8 各造一次扰动）。
 * · **不判"跑通"**：每条都断言**具体的判定结果与数值**，不是 `assert.ok(result)`。
 *
 * 运行（显式路径）：`node --test packages/consolidation/tests/b41-fixed-points.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectTopN, ripple, chunkSequences, resolveVectorCosine, CONSOLIDATION_PARAMS } from '../src/index.ts'

/** 手算余弦的允许误差（双精度下 O(1e-16)，1e-15 是宽裕但不变形的界）。 */
const EPS = 1e-15
/** 闭式期望值：与夹具向量一一对应，**手算**得来（√2/2 与 3/5）。 */
const COS_DIAG = Math.SQRT1_2 // 0.7071067811865476
const COS_3_5 = 0.6

const route = resolveVectorCosine()
// 前置事实：余弦通道必须真的接上 `packages/vector` 的实现（否则下面的期望值无意义）。
if (!route.ok) {
  throw new Error(`夹具前置失败：余弦通道不可用 —— ${route.source}: ${route.reason}`)
}
const cosine = route.cosine

const EXPECTED_CASES = 9
let ran = 0

/** 复算一个夹具余弦，并与手算值对拍（先证夹具本身没被写错）。 */
function fixtureCos(a, b, expect) {
  const got = cosine(a, b)
  assert.ok(Math.abs(got - expect) <= EPS, `夹具自检失败：cos(${JSON.stringify(a)},${JSON.stringify(b)}) = ${got}，手算 ${expect}`)
  return got
}

test('① Spindle：按激活值降序取 Top-N，同值按 id 全序，落选项带原因', () => {
  ran += 1
  const items = [
    { id: 'm1', activation: 3.0 },
    { id: 'm5', activation: 2.0 },
    { id: 'm3', activation: 2.0 }, // 与 m5 同激活值 ⇒ 必须按 id 升序 ⇒ m3 在前
    { id: 'm2', activation: 1.0 },
    { id: 'm4', activation: 0.5 },
  ]
  const sel = selectTopN('P-①', items, 3)
  assert.deepEqual(
    sel.selected.map((s) => s.id),
    ['m1', 'm3', 'm5'],
    'Top-3 必须按 (激活值降序, id 升序) 全序取；实测 ' + JSON.stringify(sel.selected.map((s) => s.id)),
  )
  // 激活值必须真的降序（不是"输入顺序前 3 条"）
  const acts = sel.selected.map((s) => s.activation)
  assert.deepEqual(acts, [3.0, 2.0, 2.0], '选中集激活值须降序')
  assert.deepEqual(
    sel.skipped.map((s) => [s.id, s.reason]),
    [['m2', 'rank_below_top_n'], ['m4', 'rank_below_top_n']],
    '未选中项必须带原因 rank_below_top_n；实测 ' + JSON.stringify(sel.skipped),
  )
  assert.equal(sel.population, 5, 'population 须为候选总数（使「N=0」与「候选为空」可分辨）')
  assert.equal(sel.requestedN, 3, 'requestedN 须原样回显（证选择用了传入的 N）')

  // retired / 非有限激活值：**显式跳过并带原因**，不是静默按 0 处理
  const dirty = selectTopN('P-①b', [
    { id: 'a', activation: 9.0, retired: true },
    { id: 'b', activation: Number.NaN },
    { id: 'c', activation: 1.0 },
  ], 3)
  assert.deepEqual(dirty.selected.map((s) => s.id), ['c'], 'retired 与 NaN 不得进选中集')
  assert.deepEqual(
    dirty.skipped.map((s) => [s.id, s.reason]),
    [['a', 'retired'], ['b', 'non_finite_activation']],
    '两类跳过必须可分辨；实测 ' + JSON.stringify(dirty.skipped),
  )
})

test('② Spindle：N 可被覆盖（default 来自 params.SPINDLE_TOP_N），N=0 是不重放而非无限制', () => {
  ran += 1
  assert.equal(CONSOLIDATION_PARAMS.SPINDLE_TOP_N, 3, '工程缺省 Top-N = 3（**不是判据阈值**，见 params.ts）')
  const items = [1, 2, 3, 4, 5].map((i) => ({ id: `m${i}`, activation: i }))
  assert.equal(selectTopN('P-②', items).selected.length, 3, '缺省 N 须取 params 的值（3）')
  assert.equal(selectTopN('P-②', items, 2).selected.length, 2, '传 2 必须真的只选 2 条（否则 N 是摆设）')
  const zero = selectTopN('P-②', items, 0)
  assert.equal(zero.selected.length, 0, 'N=0 ⇒ 不重放')
  assert.equal(zero.skipped.length, 5, 'N=0 时全部候选须落 rank_below_top_n（不得读成"没有候选"）')
})

test('③ Ripple：默认阈值 0.7 的**功能腿** —— √2/2 合并、3/5 新颖', () => {
  ran += 1
  const diag = fixtureCos([1, 0], [1, 1], COS_DIAG)
  const three5 = fixtureCos([1, 0], [3, 4], COS_3_5)
  assert.ok(diag > 0.7, `夹具前提：√2/2 = ${diag} 须 > 0.7`)
  assert.ok(three5 < 0.7, `夹具前提：3/5 = ${three5} 须 < 0.7`)
  assert.equal(CONSOLIDATION_PARAMS.MERGE_SIMILARITY, 0.7, '判据原文：「相似度 ≥0.7 合并」')

  const plan = ripple({
    periodId: 'P-③',
    selected: [
      { id: 'hi', activation: 2.0, vector: [1, 1] },
      { id: 'lo', activation: 1.0, vector: [3, 4] },
    ],
    neocortex: [{ id: 'n1', vector: [1, 0] }],
    cosine,
    // ⚠ 刻意**不传** similarityThreshold ⇒ 走默认。把 0.7 改成 0.6 ⇒ 本用例必红（lo 会翻成 merge）
  })
  assert.equal(plan.threshold, 0.7, '计划里回报的阈值须为默认 0.7')
  assert.deepEqual(
    plan.verdicts.map((v) => [v.memoryId, v.kind]),
    [['hi', 'merge'], ['lo', 'novel']],
    '√2/2≈0.7071 ≥ 0.7 ⇒ 合并；3/5=0.6 < 0.7 ⇒ 新颖。实测 ' + JSON.stringify(plan.verdicts),
  )
  const lo = plan.verdicts[1]
  assert.equal(lo.reason, 'below_threshold', '新颖的原因须为 below_threshold')
  assert.ok(Math.abs(lo.bestSimilarity - COS_3_5) <= EPS, `bestSimilarity 须为手算值 0.6；实测 ${lo.bestSimilarity}`)
  assert.equal(lo.bestId, 'n1', 'bestId 须指向最高分靶')
  assert.deepEqual(plan.stats, { replayed: 2, merged: 1, novel: 1, skipped: 0 }, '统计须与逐条判定一致')
})

test('④ Ripple 边界：阈值取 **≥**（相似度恰等于阈值 ⇒ 必须合并）', () => {
  ran += 1
  // 用**被测的同一个** cosine 算出边界值 ⇒ bestSim 与 threshold 是**同一个 double**，
  // 于是「>= 还是 >」这件事在这一点上是可分辨的：改成 > 就会翻成 novel。
  const edge = cosine([1, 1], [1, 0])
  const atEdge = ripple({
    periodId: 'P-④',
    selected: [{ id: 'x', activation: 1.0, vector: [1, 1] }],
    neocortex: [{ id: 'n1', vector: [1, 0] }],
    cosine,
    similarityThreshold: edge,
  })
  assert.equal(
    atEdge.verdicts[0].kind,
    'merge',
    `判据原文是「≥0.7 合并」⇒ 恰好等于阈值必须合并（改成 > 即红）；实测 ${JSON.stringify(atEdge.verdicts[0])}`,
  )
  assert.equal(atEdge.verdicts[0].similarity, edge, '合并时回报的相似度须与边界值逐位相同')
  const justAbove = ripple({
    periodId: 'P-④',
    selected: [{ id: 'x', activation: 1.0, vector: [1, 1] }],
    neocortex: [{ id: 'n1', vector: [1, 0] }],
    cosine,
    similarityThreshold: edge + 1e-12,
  })
  assert.equal(justAbove.verdicts[0].kind, 'novel', '略高于边界 ⇒ 必须新颖（证边界确实是阈值而不是恒真）')
})

test('⑤ Ripple：**新颖的两条路可分辨** —— 无靶（null）与低分（数值）不得同形', () => {
  ran += 1
  const noTarget = ripple({
    periodId: 'P-⑤a',
    selected: [{ id: 'x', activation: 1.0, vector: [1, 0] }],
    neocortex: [],
    cosine,
  })
  assert.equal(noTarget.verdicts[0].kind, 'novel')
  assert.equal(noTarget.verdicts[0].reason, 'no_neocortex', '无靶须记 no_neocortex')
  assert.equal(
    noTarget.verdicts[0].bestSimilarity,
    null,
    '无靶时 bestSimilarity 必须是 null —— **不是 0**：0 会把「没比过」说成「比了得 0」',
  )
  const low = ripple({
    periodId: 'P-⑤b',
    selected: [{ id: 'x', activation: 1.0, vector: [0, 1] }],
    neocortex: [{ id: 'n1', vector: [1, 0] }],
    cosine,
  })
  assert.equal(low.verdicts[0].kind, 'novel')
  assert.equal(low.verdicts[0].reason, 'below_threshold', '有靶但低分须记 below_threshold')
  assert.equal(low.verdicts[0].bestSimilarity, 0, '正交夹具 cos=0 须如实回报 0（与上一条的 null 不同形）')
})

test('⑥ Ripple：缺向量不得静默当成「与所有靶都正交」', () => {
  ran += 1
  const plan = ripple({
    periodId: 'P-⑥',
    selected: [
      { id: 'novec', activation: 2.0, vector: null },
      { id: 'hasvec', activation: 1.0, vector: [1, 0] },
    ],
    neocortex: [
      { id: 'n-ok', vector: [1, 0] },
      { id: 'n-novec', vector: undefined },
    ],
    cosine,
  })
  assert.deepEqual(
    plan.verdicts.map((v) => [v.memoryId, v.kind]),
    [['novec', 'skipped'], ['hasvec', 'merge']],
    '本项缺向量 ⇒ skipped(no_vector)，不得参与比对。实测 ' + JSON.stringify(plan.verdicts),
  )
  assert.equal(plan.verdicts[0].reason, 'no_vector')
  assert.deepEqual(plan.skippedNeocortex, [{ id: 'n-novec', reason: 'no_vector' }], '靶侧缺向量须落 skippedNeocortex（可见）')
  assert.equal(plan.stats.skipped, 1)
  // 靶侧缺向量**不得**影响仍能比对的那条：hasvec 的标准确分到 n-ok
  assert.equal(plan.verdicts[1].intoId, 'n-ok', '可用靶的比对不受缺向量靶影响')
})

test('⑦ chunking 重复阈值：恰好 2 次成规则、1 次不成（默认路径，改 2→3 即红）', () => {
  ran += 1
  assert.equal(CONSOLIDATION_PARAMS.MIN_PATTERN_REPEATS, 2, '判据原文：「模式重复 ≥2」/「chunking 重复阈值 ≥2」')
  const runs = [
    { id: 'r1', goalId: 'g-A', steps: ['a', 'b'], endedAt: '2026-09-25T00:00:01.000Z' },
    { id: 'r2', goalId: 'g-A', steps: ['a', 'b'], endedAt: '2026-09-25T00:00:02.000Z' },
    { id: 'r3', goalId: 'g-B', steps: ['c'], endedAt: '2026-09-25T00:00:03.000Z' },
  ]
  const at = '2026-09-25T00:00:00.000Z'
  const plan = chunkSequences(runs, { at })
  assert.equal(plan.rules.length, 1, '恰好重复 2 次 ⇒ 恰好 1 条规则。实测 ' + JSON.stringify(plan.rules))
  assert.deepEqual(
    plan.dropped.map((d) => [d.runId, d.reason]),
    [['r3', 'below_repeats']],
    '只出现 1 次的不得成规则，且必须带原因。实测 ' + JSON.stringify(plan.dropped),
  )
  const rule = plan.rules[0]
  // ⚠ 期望值**独立复算**而不是写字面量：本席初版把期望值写成了凭印象的 'rule-1c0b0ed9'，
  //   实跑得 'rule-32f61fef' —— 是**期望值错了**（独立 BigInt 实现复算签名 FNV-1a 亦得 32f61fef）。
  //   故这里内嵌一份与 src 写法不同的实现（BigInt + 显式掩码，不依赖 Math.imul 的 32 位语义），
  //   使「id 是签名的确定性哈希」成为**可复算**的事实，而不是一个魔法常量。
  const fnvIndependent = (s) => {
    let h = 2166136261n
    for (const ch of s) {
      h = (h ^ BigInt(ch.charCodeAt(0))) & 0xffffffffn
      h = (h * 16777619n) & 0xffffffffn
    }
    return h.toString(16).padStart(8, '0')
  }
  assert.equal(
    rule.id,
    `rule-${fnvIndependent('a\u0001b')}`,
    '规则 id 须为模式签名（算子序列以 \\u0001 连接）的 FNV-1a（确定性 ⇒ 重跑幂等）；实测 ' + rule.id,
  )
  assert.equal(rule.sourceGoalId, 'g-A', 'source_goal_id 须取来源子目标')
  assert.equal(rule.createdAt, at, 'created_at 须取调用方给定的时刻（可复算）')
  assert.deepEqual(JSON.parse(rule.actions), { kind: 'replay-sequence', steps: ['a', 'b'] }, 'actions 须是可解析的算子序列')
  assert.equal(JSON.parse(rule.conditions).repeats, 2, 'conditions 须记下实际重复次数')
  assert.deepEqual(plan.stats, { patterns: 2, rules: 1, compression: 3 }, '闭式：3 条过程/1 条规则 ⇒ 压缩比 3')
})

test('⑧ chunking 长度上限：7 步成规则、8 步被丢（默认路径，改 7→8 即红）', () => {
  ran += 1
  assert.equal(CONSOLIDATION_PARAMS.MAX_OPERATOR_SEQUENCE, 7, '判据原文：「算子序列 ≤7」')
  const mk = (id, n) => ({ id, goalId: 'g', steps: Array.from({ length: n }, (_, i) => `s${i}`), endedAt: '2026-09-25T00:00:00.000Z' })
  // ⚠ 每组 **3 次**重复而不是 2 次：本用例的**唯一话题是长度上限**，若用 2 次，
  //   把 MIN_PATTERN_REPEATS 从 2 改成 3 也会让它翻红 —— 那是**串扰**（判据红得指不真因）。
  //   S16 席实测踩过一次（扰动 B 同时红 ⑦⑧），故改为 3 次：重复阈值怎么改都不影响本用例。
  const seven = chunkSequences([mk('a1', 7), mk('a2', 7), mk('a3', 7)])
  assert.equal(seven.rules.length, 1, '7 步（= 上限）重复 3 次 ⇒ 必须成规则（≤ 是含端点的）')
  const eight = chunkSequences([mk('b1', 8), mk('b2', 8), mk('b3', 8)])
  assert.equal(eight.rules.length, 0, '8 步（> 上限）⇒ 不得成规则。实测 ' + JSON.stringify(eight.rules))
  assert.deepEqual(
    eight.dropped.map((d) => [d.runId, d.reason]),
    [['b1', 'too_long'], ['b2', 'too_long'], ['b3', 'too_long']],
    '超长必须以 too_long 显式丢弃（不得静默略过）。实测 ' + JSON.stringify(eight.dropped),
  )
  assert.equal(eight.stats.rules, 0)
  assert.equal(eight.stats.compression, null, '无规则时压缩比必须是 null —— 0 会把「没压」说成「压没了」')
  // 长度上限是**含端点**的：恰好 7 与 6/8 的对比使 off-by-one 可分辨
  assert.equal(chunkSequences([mk('c1', 6), mk('c2', 6), mk('c3', 6)]).rules.length, 1, '6 步亦在限内（同样用 3 次以隔离重复阈值）')
})

test('⑨ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
