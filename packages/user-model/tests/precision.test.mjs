/**
 * **B5.2 判定核的判据**：漂移探针（册:150）· 退场动作（册:151）· A4-2 首测方法（册:598）。
 *
 * ⚠ **本文件刻意不给 A4-2 写任何目标数字**：册:598 写明该阈值「**待定，需首测后自设**」
 *   且「未定前**不判通过**」。故本文件测的是**方法**（未定 ⇒ undeterminable；样本不足 ⇒
 *   undeterminable；够了才判 pass/fail），而**不是**"命中率有没有超过某个数"——
 *   后者正是册内禁止的「以未超标放过」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mount, tmpDir, cloneAndMutate, traceCount, expectRed } from './_harness.mjs'
import { driftCandidates, injectionDecision, assessAccuracy } from '../src/precision.ts'
// 参数一律走**唯一真源** params.ts（不在测试里另写一份数字 —— 那是"两处漂移"的起点）
import {
  requiredSampleSize, ACCURACY_SAMPLE_FLOOR, CONFIDENCE_FLOOR,
  DRIFT_WINDOW_DAYS, DRIFT_MIN_CHANGES,
} from '../src/params.ts'

const hist = (key, pairs) => pairs.map(([oldV, newV, at]) => ({ key, old_value: oldV, new_value: newV, at }))
const NOW = '2026-09-25T00:00:00.000Z'
const day = (n) => new Date(Date.parse(NOW) - n * 86400000).toISOString()

// ══ 参数真源：289 必须是**算出来的**，不是抄来的 ═════════════════════════════
test('参数 289 可复算：requiredSampleSize() 逐位等于册:598 的 n ≥ 289（公式输入脱节即红）', () => {
  assert.equal(requiredSampleSize(), 289, '公式算出 ' + requiredSampleSize() + '，与册:598 的 289 不符')
  assert.equal(ACCURACY_SAMPLE_FLOOR, 289)
  // 反证：改公式输入 ⇒ 结果必须跟着变（证明它真是派生量，不是一个写死的 289）
  assert.equal(requiredSampleSize(0.5, 0.05, 1.96), 385, 'p=0.5 时应得 385 ⇒ 说明 289 确实是算出来的')
  assert.notEqual(requiredSampleSize(0.75, 0.01, 1.96), 289, '精度改到 ±1pp 时样本量必须变（否则公式没接上）')
  // 越界输入必须抛，不得静默给个默认值
  assert.throws(() => requiredSampleSize(0, 0.05, 1.96), /p 必须在/)
  assert.throws(() => requiredSampleSize(0.75, 0, 1.96), /halfWidth 必须/)
})

test('参数 30/3 与册:150 原文同源（改一处即红）', () => {
  assert.equal(DRIFT_WINDOW_DAYS, 30, '册:150 原文「30 天内」')
  assert.equal(DRIFT_MIN_CHANGES, 3, '册:150 原文「被改 ≥ 3 次」')
  assert.equal(CONFIDENCE_FLOOR, null, 'A4-1 在册:597 是「待定，需拍板」⇒ 必须显式 null，不得编一个数')
})

// ══ ④ 漂移探针 ════════════════════════════════════════════════════════════
test('④ 漂移探针：同一 key 30 天内改 3 次 ⇒ 候选；改 2 次 ⇒ 不是候选', () => {
  const r = driftCandidates([
    ...hist('unstable', [[null, 'a', day(20)], ['a', 'b', day(10)], ['b', 'c', day(1)]]),
    ...hist('stable', [[null, 'a', day(20)], ['a', 'b', day(10)]]),
  ], NOW)
  assert.deepEqual(r.candidates, ['unstable'], '只有改满 3 次的 key 是候选；实测 ' + JSON.stringify(r.candidates))
  assert.equal(r.since, day(30), '窗口起点必须显式回传')
  assert.equal(r.windowDays, 30)
  assert.equal(r.minChanges, 3)
  // 未达线的 key 也必须在 readings 里（否则"没达线"与"没扫到"同形）
  assert.deepEqual(r.readings.map((x) => x.key), ['stable', 'unstable'])
  assert.equal(r.readings.find((x) => x.key === 'stable').changes, 2)
})

test('④ 漂移探针：窗口外的改动**不**计入（30 天是硬边界）', () => {
  const inWin = driftCandidates(hist('k', [[null, 'a', day(29)], ['a', 'b', day(20)], ['b', 'c', day(10)]]), NOW)
  const outWin = driftCandidates(hist('k', [[null, 'a', day(31)], ['a', 'b', day(20)], ['b', 'c', day(10)]]), NOW)
  assert.deepEqual(inWin.candidates, ['k'], '第 1 次落在 29 天前 ⇒ 3 次全在窗内，应为候选')
  assert.deepEqual(outWin.candidates, [], '第 1 次落在 31 天前 ⇒ 窗内只剩 2 次，不应是候选')
  assert.equal(outWin.readings[0].changes, 2, '窗口外的行必须被排除，实测 ' + outWin.readings[0].changes)
})

test('④ 漂移探针：值没变的行**不**计入 changes（否则"反复确认"被读成"不稳定"）', () => {
  // core 的 M4 明确：值相同时也留一行痕。若把它算成"改过"，方向上恰好相反。
  const r = driftCandidates([
    ...hist('k', [[null, 'a', day(20)], ['a', 'a', day(10)], ['a', 'a', day(5)]]),
  ], NOW)
  assert.equal(r.readings[0].changes, 1, '三次写入里只有 1 次真改变了值')
  assert.equal(r.readings[0].rows, 3, '总行数仍应回传 3（两个口径并列，供复核）')
  assert.deepEqual(r.candidates, [], '反复写同一个值不是漂移')
})

test('④ 漂移探针：坏时刻必须抛错，不得静默当"窗口外"', () => {
  // 静默跳过 = 数据损坏表现为"没有漂移"，正是本仓最防的「让失败不可观测」。
  assert.throws(() => driftCandidates(hist('k', [[null, 'a', 'not-a-date']]), NOW), /不是合法 ISO 时刻/)
  assert.throws(() => driftCandidates([], 'nope'), /now 不是合法 ISO/)
})

test('④ 漂移探针：`now` 必须显式传参（同一批输入在不同时刻给出同一结论）', () => {
  const rows = hist('k', [[null, 'a', day(20)], ['a', 'b', day(10)], ['b', 'c', day(1)]])
  assert.deepEqual(driftCandidates(rows, NOW).candidates, driftCandidates(rows, NOW).candidates)
  // 把 now 往后推 30 天 ⇒ 窗口变成 [NOW, NOW+30d]，三次改动**全部**出窗 ⇒ 候选消失。
  // ⚠ 边界口径写在用例里（本席实测踩到）：`now` 只推 10 天时窗口右边是 NOW+10d、
  //   左边是 NOW−20d，而最早那次改动**恰好落在 NOW−20d**，`atMs < sinceMs` 为假 ⇒ 仍被计入。
  //   即"恰好落在窗口起点"算**窗内**（闭区间左端）。故推移量必须真的把行推出去，
  //   否则这条腿会在"now 明明参与判定"时误报红。
  const later = new Date(Date.parse(NOW) + 30 * 86400000).toISOString()
  assert.deepEqual(driftCandidates(rows, later).candidates, [], 'now 未参与判定 ⇒ 它是假参数')
  assert.equal(driftCandidates(rows, later).readings.length, 0, '全部出窗后 readings 应为空（而不是保留旧读数）')
})

test('④ 漂移探针落 trace：`reportDrift` 每次真写一行 `user-model/drift`（卸载即净的依据）', async () => {
  const { core, um, close } = await mount()
  assert.equal(traceCount(core.db, 'user-model/drift'), 0, '前置：探针前该类行应为 0')
  um.updatePreference({ key: 'k', value: 'a', at: day(20) })
  um.updatePreference({ key: 'k', value: 'b', at: day(10) })
  um.updatePreference({ key: 'k', value: 'c', at: day(1) })
  const out = um.reportDrift(NOW, 's-drift')
  assert.ok(out.traceSeq > 0, 'reportDrift 必须返回真落的 seq')
  assert.equal(traceCount(core.db, 'user-model/drift'), 1, '应恰好写 1 行')
  assert.deepEqual(out.candidates, ['k'], '经真库读回的历史也必须得同一结论（真数据绿，非夹具绿）')
  const row = core.db.prepare('SELECT * FROM mana_trace WHERE event_type = ?').get('user-model/drift')
  const payload = JSON.parse(row.payload)
  assert.equal(payload.windowDays, 30)
  assert.equal(payload.minChanges, 3)
  close()
})

test('④ 漂移探针：`user-model/drift` **不是** S1 五类之一（不得冒充 observation/attention/…）', async () => {
  const { core, um, close } = await mount()
  um.updatePreference({ key: 'k', value: 'a', at: day(20) })
  um.reportDrift(NOW)
  const kinds = core.db.prepare('SELECT DISTINCT event_type FROM mana_trace').all().map((r) => String(r.event_type))
  for (const five of ['observation', 'attention', 'decision', 'recall', 'injection']) {
    assert.ok(!kinds.includes(five), '本包不得写 S1 五类（会污染"五类各有多少行"的读数）；实测出现 ' + five)
  }
  assert.ok(kinds.includes('user-model/drift'), '本包应写自己命名空间下的类型')
  close()
})

// ══ ⑤ 退场动作 ════════════════════════════════════════════════════════════
test('⑤ 退场动作：置信度跌破阈值 ⇒ retired_no_injection（不再是"照常注入"）', () => {
  assert.equal(injectionDecision(0.2, 0.4).decision, 'retired_no_injection', '跌破阈值必须退场')
  assert.equal(injectionDecision(0.4, 0.4).decision, 'inject', '恰好等于阈值**不算**跌破（册原文「跌破」）')
  assert.equal(injectionDecision(0.41, 0.4).decision, 'inject')
  assert.equal(injectionDecision(0.2, 0.4).reason, 'below-floor')
})

test('⑤ 退场动作：阈值未定（A4-1 待拍板）⇒ undeterminable，**不得**读成 inject', () => {
  const v = injectionDecision(0.9, null)
  assert.equal(v.decision, 'undeterminable', '阈值未定却给了结论 ⇒ "没拍板"被静默读成"已校准"')
  assert.equal(v.reason, 'floor-unset')
  assert.equal(v.floor, null)
  // 反方向：它也不得被读成"退场"（把未拍板读成禁用，会让系统静默失去全部个性化）
  assert.notEqual(v.decision, 'retired_no_injection')
})

test('⑤ 退场动作：置信度读数坏了 ⇒ undeterminable，**不得**默认放行', () => {
  for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const v = injectionDecision(bad, 0.4)
    assert.equal(v.decision, 'undeterminable', '读数 ' + String(bad) + ' 不得被读成 inject')
    assert.equal(v.reason, 'confidence-unusable')
  }
  // 0 是**合法**置信度，不是"空"（同族缺陷：用 falsy 判空会把它当缺失）
  assert.equal(injectionDecision(0, 0).decision, 'inject', 'confidence=0 在 floor=0 下是合法的 inject')
  assert.equal(injectionDecision(0, 0.1).decision, 'retired_no_injection', 'confidence=0 必须被判为退场，而不是"没传"')
})

test('⑤ 退场动作：服务面与纯函数**同一结论**（包装不得各说各话）', async () => {
  const { um, close } = await mount({ config: { confidenceFloor: 0.5 } })
  assert.equal(um.thresholds().confidenceFloor, 0.5, '显式传的阈值必须被采纳')
  assert.equal(um.injectionVerdict(0.2).decision, 'retired_no_injection')
  assert.equal(um.injectionVerdict(0.8).decision, 'inject')
  close()
  // 缺省（未拍板）路径：服务面必须报 undeterminable —— 这才是 A4-1 未拍板时的正确行为
  const m2 = await mount()
  assert.equal(m2.um.thresholds().confidenceFloor, null, '缺省必须是 null（无人拍板）')
  assert.equal(m2.um.injectionVerdict(0.99).decision, 'undeterminable', '未拍板时不得给出 inject 结论')
  m2.close()
})

test('⑤【负向对拍】把"跌破 ⇒ 不注入"改成"照常注入" ⇒ 退场判据必须报红（克隆变异）', () => {
  // 变异形态取"最像正常简化"的那一种：把阈值判定折成一个恒 true（或直接返回 inject）。
  const { entry } = cloneAndMutate(
    'user-model',
    ['precision.ts', 'params.ts'],
    [[
      `if (c < floor) return { decision: 'retired_no_injection', floor, confidence: c, reason: 'below-floor' }`,
      `if (c < floor) return { decision: 'inject', floor, confidence: c, reason: 'below-floor' }`,
    ]],
  )
  return import(entry).then((mod) => {
    assert.equal(
      mod.injectionDecision(0.2, 0.4).decision, 'inject',
      '变异体下仍是 retired_no_injection ⇒ 补丁没打上，本次负向对拍测的是原代码',
    )
    /**
     * ⚠ **直接形态**：在变异体上跑**原判据**（退场那条用例的头一句），断言它**必须报红**。
     *   这才证明"退场判据有牙"—— 而不是证明"变异体长得像变异体"。
     */
    const red = expectRed(
      () => assert.equal(mod.injectionDecision(0.2, 0.4).decision, 'retired_no_injection', '跌破阈值必须退场'),
      '⑤ 的"置信度跌破阈值 ⇒ 退场"断言',
    )
    assert.match(String(red.message), /跌破阈值必须退场/, '报红原因不是退场断言：' + red.message.slice(0, 200))
    // 对照：原实现下同一输入必须是退场（二者之差即这条腿的牙）
    assert.equal(injectionDecision(0.2, 0.4).decision, 'retired_no_injection')
  })
})

// ══ ⑥ A4-2 首测方法（**不设目标数字**）════════════════════════════════════
test('⑥ A4-2：阈值未定 ⇒ undeterminable（册:598「未定前不判通过」）', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ key: 'k', actual: 'a', predicted: 'a' }))
  const r = assessAccuracy(many, null)
  assert.equal(r.verdict, 'undeterminable', '没有阈值却给了结论 ⇒ 等于替用户拍了一个数')
  assert.equal(r.reason, 'threshold-unset')
  assert.equal(r.n, 400, '样本量读数仍须回传（供将来定阈值时复核）')
  assert.equal(r.hitRate, 1, '命中率是**测量值**，与"有没有阈值"无关，仍应算出')
})

test('⑥ A4-2：样本量不足 ⇒ undeterminable（**不是** pass）', () => {
  const few = Array.from({ length: 288 }, () => ({ key: 'k', actual: 'a', predicted: 'a' }))
  const r = assessAccuracy(few, 0.75)
  assert.equal(r.verdict, 'undeterminable', 'n=288 < 289 却给了结论；实测 ' + r.verdict)
  assert.equal(r.reason, 'insufficient-sample')
  assert.notEqual(r.verdict, 'pass', '册:598 原文：不足样本量即判「不可判定」而非「通过」')
  assert.equal(r.requiredN, 289)
  // 边界：恰好 289 时必须转为可判定
  const exact = Array.from({ length: 289 }, () => ({ key: 'k', actual: 'a', predicted: 'a' }))
  assert.notEqual(assessAccuracy(exact, 0.75).reason, 'insufficient-sample', 'n=289 恰好达线，不应再判样本不足')
})

test('⑥ A4-2：样本为空 ⇒ undeterminable 且 hitRate 为 null（不用 0 冒充"全错"）', () => {
  const r = assessAccuracy([], 0.75)
  assert.equal(r.verdict, 'undeterminable')
  assert.equal(r.reason, 'no-sample')
  assert.equal(r.hitRate, null, '"没测"与"全错(0)"必须可分辨：命中率用 null，不得用 0')
})

test('⑥ A4-2：样本够 + 阈值给了 ⇒ 才判 pass/fail（方法与读数都真在跑）', () => {
  const mk = (hits, n) =>
    Array.from({ length: n }, (_, i) => ({ key: 'k', actual: 'a', predicted: i < hits ? 'a' : 'b' }))
  assert.equal(assessAccuracy(mk(300, 400), 0.75).verdict, 'pass', '300/400=0.75 ≥ 0.75 应 pass')
  assert.equal(assessAccuracy(mk(299, 400), 0.75).verdict, 'fail', '299/400=0.7475 < 0.75 应 fail')
  const r = assessAccuracy(mk(300, 400), 0.75)
  assert.equal(r.hits, 300)
  assert.equal(r.hitRate, 0.75)
  assert.equal(r.requiredN, 289)
  // predicted=null（模型没给出预测）**不算命中**（否则"没答"会被读成"答对了"）
  const withNull = [{ key: 'k', actual: 'a', predicted: null }, ...mk(300, 399)]
  assert.equal(assessAccuracy(withNull, 0.75).hits, 300, 'predicted=null 不得计入命中')
})

test('⑥ A4-2 首测方法可跑：从真库读偏好 → 产出一份可复核的评估报告（端到端）', async () => {
  const { um, close } = await mount()
  // 真库真写（不是测试自造的内存数组）
  um.updatePreference({ key: 'style', value: 'concise' })
  um.updatePreference({ key: 'tone', value: 'plain' })
  const prefs = um.listPreferences()
  assert.equal(prefs.length, 2, '真库应读到 2 条偏好')
  // 首测：把库里的当前值当成"预测"，与人工标注的"真值"比 —— 标注集本身是**人工输入**（方法落点）
  const samples = prefs.map((p) => ({ key: p.key, actual: p.value, predicted: p.value }))
  const r = um.assessAccuracy(samples, null)
  assert.equal(r.n, 2, '样本量取真库行数')
  assert.equal(r.verdict, 'undeterminable', '2 条样本远低于 289 ⇒ 必须判不可判定，而不是拿 100% 命中率去报通过')
  assert.equal(r.reason, 'threshold-unset')
  close()
})
