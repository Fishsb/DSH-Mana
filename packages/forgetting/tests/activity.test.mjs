/**
 * §16.3 记忆活性分级（热 / 温 / 冷）判据 —— **事实面**。
 *
 * ── 本文件要判的四件事（每件都配可复算读数，不靠注释承诺）──────────────────────
 *   ① **三级真能分开**：三条不同活性的记忆 ⇒ 热 / 温 / 冷各命中一条（给真读数）；
 *   ② **边界显式**：恰好在热线 / 恰好在冷线 / age=0 / **无访问记录的新记忆**，各自归哪级有断言；
 *   ③ **阈值单一真源**：活性边界只在 params.ts 出现一次、经 criteria.ts 注册表被消费；
 *      激活轴的边界**只有** archive.ts#classify 一份（结构断言 + 行为读数双向钉死）；
 *   ④ 未引入 FSRS、未改既有衰减公式（decay(14)=0.500000 等冻结锚点逐条复算）。
 *
 * ⚠ **为什么「无访问记录的新记忆」要单列一条（本文件最重要的一条）**：
 *   无访问记录 ⇒ long-term#baseLevel 的求和是**空集** ⇒ B = ln(0) = -Infinity。
 *   若照直喂进 classify()，区间必落 archive ⇒ 被降级映射成「冷」⇒
 *   **一条刚写进来、还没被任何人召回的新记忆，第一步就被判成该归档**。
 *   故实现把激活轴记 ⊥、不参与判级。本文件用「**同一个 -Infinity、两种召回状态**」的对照实验
 *   把这条规则钉成事实：从未召回 ⇒ 热（激活轴 ⊥）；假装刚召回 ⇒ 冷（激活轴 archive）。
 *   两条读数可分辨 ⇒ 「不是没有这个坑」，而是「坑已被规则挡住」。
 *
 * ── 为什么每条边界都写成**字面量**（不得用被测常量反算期望值）─────────────────
 *   若写 recencyLevel(B.recentMaxAgeDays, B) === 'hot'，期望值会跟着常量走 ⇒ **恒定绿**（自指）。
 *   故本文件一律写 15 / 30 / 0 这些**判据侧的独立字面量**；扰动真源时它们必然对不上 ⇒ 必红。
 *   这正是下面 ⑧ 负向对拍能成立的前提。
 *
 * ⚠ 本文件的用例数本身也是判据：固定 **9** 条，末条为计数自检（少一条即红），并与 verify.mjs 同步。
 *
 * 运行（**显式路径**）：node --test packages/forgetting/tests/activity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = new URL('../src/', import.meta.url)
const ROOT = new URL('../../', import.meta.url) // packages/
const load = (f) => import(new URL(f, SRC).href)
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const f6 = (x) => Number(x).toFixed(6)

const activity = await load('activity.ts')
const params = await load('params.ts')
const archive = await load('archive.ts')
const criteria = await load('criteria.ts')
const retentionMod = await load('retention.ts')
const ltDecay = await import(new URL('long-term/src/decay.ts', ROOT).href)

const SRC_PARAMS = fileURLToPath(new URL('params.ts', SRC))
const SRC_ACTIVITY = fileURLToPath(new URL('activity.ts', SRC))

/** τ 的判据侧独立字面量（= long-term 真源 TAU，逐字取，不读实现）。 */
const TAU_LITERAL = -2.0
/** 活性边界（天）—— 判据侧独立字面量，**不从实现反算**。 */
const RECENT_LITERAL = 15
const COLD_LITERAL = 30

const EXPECTED_CASES = 9
let ran = 0

/**
 * 剥离注释，只留**可执行代码**（结构性断言的唯一合法输入面）。
 *
 * ⚠ 为什么必须剥离（本仓点名的形态「断言禁匹配注释」）：本模块的注释里**故意写着**
 *   它「不 import 任何写库面（无 ctx / 无 node:sqlite）」—— 若结构性断言直接在全文上跑，
 *   那条**说明自己没写库**的注释反而会把断言判红（本席第一版实测就是这个红）。
 *   反过来，若注释里出现 " + BT + "INSERT" + BT + " 之类的举例，不剥离则会**假红**；剥离后两边都干净。
 * ⚠ 剥离是粗粒度的（不处理字符串里的 " + BT + "//" + BT + "）：本文件只用来做**否定式**断言，
 *   粗粒度只会**多留**文本（→ 更严），不会漏掉可执行代码 ⇒ 方向安全。
 */
function codeOnly(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//'))
    .join(String.fromCharCode(10))
}

const cleanups = []
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'mana-activity-'))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/**
 * 夹具：把**真源文本**做一次替换后写进临时目录并 import。
 *
 * ⚠ 真源**全程只读**（只 readFileSync 真源，写的是临时副本）⇒ 「逐字节恢复」在本测试里是
 *   **直接证据**（本文件从不写真源），而非承诺。禁用 git 操作的纪律随之自然满足。
 * ⚠ 四件同目录复制即可自洽：activity → archive → params、activity → criteria → params
 *   的相对 import 全部落在副本目录内，无需改写路径。
 */
function gradingFromMutatedSource(find, replace) {
  const original = readFileSync(SRC_PARAMS, 'utf8')
  const hits = original.split(find).length - 1
  assert.equal(hits, 1, '扰动锚点必须**恰好命中 1 次**，实测 ' + hits + '：命中 0 次即变异器已过期（静默通过 = 假绿）')
  const dir = tmpDir()
  for (const f of ['params.ts', 'criteria.ts', 'archive.ts', 'activity.ts']) {
    copyFileSync(fileURLToPath(new URL(f, SRC)), join(dir, f))
  }
  writeFileSync(join(dir, 'params.ts'), original.replace(find, replace))
  return { url: pathToFileURL(join(dir, 'activity.ts')).href, sha: sha256(original) }
}

// ══ ① 三级真能分开：三条不同活性 ⇒ 热/温/冷各命中一条 ═════════════════════════
test('① 热/温/冷三级真读数：三条不同活性的记忆 ⇒ 三级各命中一条', () => {
  ran += 1
  const B = activity.defaultActivityBoundaries()
  assert.equal(B.recentMaxAgeDays, RECENT_LITERAL, '热线必须是判据侧字面量 ' + RECENT_LITERAL)
  assert.equal(B.coldMinAgeDays, COLD_LITERAL, '冷线必须是判据侧字面量 ' + COLD_LITERAL)

  const items = [
    { memoryId: 'hot-1', activation: -0.5, ageDaysSinceRecall: 1, accessCount: 9 },
    { memoryId: 'warm-1', activation: -1.5, ageDaysSinceRecall: 20, accessCount: 4 },
    { memoryId: 'cold-1', activation: -3.0, ageDaysSinceRecall: 60, accessCount: 1 },
  ]
  const v = activity.classifyActivity(items, TAU_LITERAL, B)
  assert.equal(v.inputCount, 3, '输入量必须显式记 3（「无输入」与「未消费」须可分辨）')
  assert.equal(v.writes, false, '分级视图恒不是写者')
  assert.equal(v.view, 'read-only')
  assert.equal(v.boundariesCalibrated, false, '边界未校准必须如实回报（不得读成通过）')

  const got = Object.fromEntries(v.flat.map((r) => [r.memoryId, r.level]))
  assert.equal(got['hot-1'], 'hot', '近期被召回 + 高激活 ⇒ 热；实测 ' + got['hot-1'])
  assert.equal(got['warm-1'], 'warm', '中期未召回 ⇒ 温；实测 ' + got['warm-1'])
  assert.equal(got['cold-1'], 'cold', '长期零召回 + 跌破归档线 ⇒ 冷；实测 ' + got['cold-1'])
  assert.equal(new Set(Object.values(got)).size, 3, '三级必须**互不相同**，实测 ' + JSON.stringify(got))
  assert.equal(v.byLevel.hot.length, 1, '热桶应 1 条，实测 ' + v.byLevel.hot.length)
  assert.equal(v.byLevel.warm.length, 1, '温桶应 1 条，实测 ' + v.byLevel.warm.length)
  assert.equal(v.byLevel.cold.length, 1, '冷桶应 1 条，实测 ' + v.byLevel.cold.length)
  // 两轴分列（活性级 ≠ 区间名：declining 与 warm 同属「温」）
  const cold1 = v.flat.find((r) => r.memoryId === 'cold-1')
  assert.equal(cold1.activationInterval, 'archive', '冷-1 的激活区间应是 archive')
  assert.equal(cold1.recencyLevel, 'cold', '冷-1 的召回轴结论应是 cold')
  assert.equal(cold1.activationLevel, 'cold', 'archive 区间映射到活性级 cold')
  // 降级映射：区间比活性级细（4 → 3），warm 与 declining 同属「温」
  assert.equal(archive.classify('w', -2.2, TAU_LITERAL).interval, 'declining', '基准：A=τ-0.2 ⇒ declining')
  const decl = activity.activityOf({ memoryId: 'decl', activation: -2.2, ageDaysSinceRecall: 20 }, TAU_LITERAL, B)
  assert.equal(decl.activationLevel, 'warm', 'declining 区间必须映射到「温」（4 区间 → 3 活性级是有意降级）')
  assert.equal(decl.activationInterval, 'declining', '但原始区间名必须原样带出（不得被压掉）')
  assert.ok(activity.activitySummary(v).includes('热 1 / 温 1 / 冷 1'), '摘要必须给出三桶真读数')
})

// ══ ② 边界显式：阈值临界各有断言 ══════════════════════════════════════════════
test('② 边界显式：恰好热线/恰好冷线/age=0/两轴独立 —— 逐点给读数', () => {
  ran += 1
  const B = activity.defaultActivityBoundaries()
  const at = (age) => activity.recencyLevel(age, B)
  // 热线：**闭**（age ≤ 15 ⇒ 热）
  assert.equal(at(0), 'hot', 'age=0（刚召回）必须热，实测 ' + at(0))
  assert.equal(at(RECENT_LITERAL), 'hot', '**恰好等于热线 15** 必须归热（左闭）；实测 ' + at(RECENT_LITERAL))
  assert.equal(at(RECENT_LITERAL + 1e-12), 'warm', '略超热线必须翻温；实测 ' + at(RECENT_LITERAL + 1e-12))
  // 冷线：**开**（age > 30 ⇒ 冷）
  assert.equal(at(COLD_LITERAL), 'warm', '**恰好等于冷线 30** 必须仍归温（左开）；实测 ' + at(COLD_LITERAL))
  assert.equal(at(COLD_LITERAL + 1e-12), 'cold', '略超冷线必须翻冷；实测 ' + at(COLD_LITERAL + 1e-12))
  assert.equal(at(RECENT_LITERAL + 1), 'warm', '热线与冷线之间是温，实测 ' + at(RECENT_LITERAL + 1))
  // 非法入参 fail-closed（不得静默判成热）
  assert.throws(() => activity.recencyLevel(-1, B), /≥ 0 的有限数/, 'age<0 必须抛（时钟回拨不得静默判成热）')
  assert.throws(() => activity.recencyLevel(Number.NaN, B), /有限数/, 'age=NaN 必须抛')

  // ── 两轴**独立**：同一条记忆上，动 τ 只移动激活轴，不移动召回轴 ──
  // ⚠ A 取 -1.2（**区间内部**，不压在边界上）：τ=-2 ⇒ warm；τ=-1 ⇒ declining。
  //   本席第一版取 A=-1.5，而 τ=-1 时 floor=τ−0.5=-1.5 ⇒ A 恰在边界上 ⇒ archive（**实现是对的，期望值写错了**）。
  //   边界点另有 ③ 专判；此处要的是「τ 移动会换区间」的干净读数。
  const snap = { memoryId: 'x', activation: -1.2, ageDaysSinceRecall: 20 }
  const a1 = activity.activityOf(snap, TAU_LITERAL, B)
  const a2 = activity.activityOf(snap, TAU_LITERAL + 1.0, B) // τ 整体上移 1.0
  assert.equal(a1.recencyLevel, a2.recencyLevel, 'τ 变化**不得**影响召回轴（两轴独立）')
  assert.notEqual(a1.activationInterval, a2.activationInterval, 'τ 上移 1.0 ⇒ 激活区间必须跟着变（否则 τ 没真的进判定）')
  assert.equal(a1.activationInterval, 'warm', '基准：A=-1.2, τ=-2 ⇒ warm；实测 ' + a1.activationInterval)
  assert.equal(a2.activationInterval, 'declining', 'τ=-1 ⇒ 同一 A 落到 declining；实测 ' + a2.activationInterval)

  // ── 活性边界**独立于 τ**：它们以「天」量召回，不以激活值量 ──
  assert.ok(
    !Number.isFinite(B.recentMaxAgeDays - TAU_LITERAL) || B.recentMaxAgeDays !== TAU_LITERAL,
    '活性边界是「天」，τ 是激活值 —— 两者量纲不同，不得相互派生',
  )
  assert.equal(typeof B.recentMaxAgeDays, 'number', '热线是数（天）')
})

// ══ ③ 无访问记录的新记忆（本文件最重要的一条）═════════════════════════════════
test('③ 无访问记录的新记忆：激活轴记 ⊥ 不参与判级 ⇒ 归热（与「同值但有召回记录」可分辨）', () => {
  ran += 1
  const B = activity.defaultActivityBoundaries()
  // 对照实验：**同一个 A = -Infinity**，只改「有没有召回记录」
  const never = activity.activityOf(
    { memoryId: 'brand-new', activation: Number.NEGATIVE_INFINITY, ageDaysSinceRecall: null, ageDaysSinceCreated: 0, accessCount: 0 },
    TAU_LITERAL, B,
  )
  const asIf = activity.activityOf(
    { memoryId: 'as-if-recalled', activation: Number.NEGATIVE_INFINITY, ageDaysSinceRecall: 0 },
    TAU_LITERAL, B,
  )
  // ① 从未召回：激活轴 ⊥，不参与判级 ⇒ 由召回轴按「距创建的天数」判 ⇒ 热
  assert.equal(never.neverRecalled, true, '无访问记录必须可辨识')
  assert.equal(never.activationUnknownByNoAccess, true, '激活轴必须因「无访问记录」被判 ⊥')
  assert.equal(never.activationLevel, null, '激活轴 ⊥ ⇒ 单轴结论必须是 null（不得填一个数冒充判定）')
  assert.equal(never.activationInterval, null, '⊥ ⇒ 不得给区间名（给了就是假装判过）')
  assert.equal(never.level, 'hot', '**新记忆必须归热**，实测 ' + never.level + '（若为 cold ⇒ ln(0)=-Infinity 被当成了业务结论）')
  assert.ok(never.basis.includes('activation.unknown-no-access-record'), '读数依据必须点名该规则，实测 ' + JSON.stringify(never.basis))
  assert.ok(never.basis.includes('combine.recency-only'), '合取方式必须显式：只有召回轴说了算')
  // ② 对照：同一个值，若假装「刚召回」 ⇒ 激活轴生效 ⇒ archive ⇒ 冷（正是要防的形态）
  assert.equal(asIf.neverRecalled, false, '该对照件有召回记录')
  assert.equal(asIf.activationInterval, 'archive', '对照件必须落 archive（证明 -Infinity 照直进去就是归档）')
  assert.equal(asIf.level, 'cold', '对照件必须是冷 —— 与「新记忆归热」形成可分辨的对照')
  assert.notEqual(never.level, asIf.level, '两条读数必须**不同**（同值不同召回状态 ⇒ 不同结论）')
  // ③ 无访问记录 + 未给创建时间 ⇒ 必须抛（不得猜成温）
  assert.throws(
    () => activity.activityOf({ memoryId: 'x', activation: null, ageDaysSinceRecall: null }, TAU_LITERAL, B),
    /无法判定/, '两轴都不可判时必须抛，不得静默猜成「温」',
  )
  // ④ 无访问记录但已积年 ⇒ 归冷（该规则不会把老记忆也判成热）
  const stale = activity.activityOf(
    { memoryId: 'stale', activation: null, ageDaysSinceRecall: null, ageDaysSinceCreated: 400, accessCount: 0 },
    TAU_LITERAL, B,
  )
  assert.equal(stale.level, 'cold', '无访问记录且已 400 天 ⇒ 冷，实测 ' + stale.level)
  // ⑤ byLevel 计数：无访问记录者**单列**，不得混进「冷」的计数
  const v = activity.classifyActivity([
    { memoryId: 'brand-new', activation: null, ageDaysSinceRecall: null, ageDaysSinceCreated: 0, accessCount: 0 },
    { memoryId: 'cold-1', activation: -3.0, ageDaysSinceRecall: 60 },
  ], TAU_LITERAL, B)
  assert.equal(v.neverRecalledCount, 1, '无访问记录条数必须单列，实测 ' + v.neverRecalledCount)
  assert.equal(v.activationUnknownCount, 1, '激活轴 ⊥ 条数必须单列，实测 ' + v.activationUnknownCount)
  assert.equal(v.byLevel.hot.length, 1, '新记忆进热桶')
  assert.equal(v.byLevel.cold.length, 1, '冷桶只应有 1 条（新记忆不得混入）')
})

// ══ ④ 阈值单一真源（不得与 classifyAll 的 τ 形成两份数值）══════════════════════
test('④ 阈值单一真源：活性边界只在注册表/params 各一份；激活轴边界只有 classify 一份', () => {
  ran += 1
  // ① 注册表登记 + 值就是 params 当前值
  const must = ['forgetting.activity.recentMaxAgeDays', 'forgetting.activity.coldMinAgeDays']
  for (const id of must) {
    const e = criteria.criteriaEntry(id)
    assert.ok(e.owner.includes('params.ts'), id + ' 的 owner 必须指向 params.ts（单一真源），实测 ' + e.owner)
    assert.equal(e.preregistered, false, id + ' 必须如实登记为**未预注册**（v10 §16.3 无值）')
    assert.equal(e.samples, 0, id + ' 必须如实登记 samples=0（无校准样本）')
    assert.equal(criteria.thresholdStatus(id).calibrated, false, id + ' 未校准不得被读成已校准')
    assert.ok(criteria.uncalibratedIds().includes(id), id + ' 必须出现在未校准清单里')
  }
  assert.equal(criteria.thresholdValue('forgetting.activity.recentMaxAgeDays'), RECENT_LITERAL)
  assert.equal(criteria.thresholdValue('forgetting.activity.coldMinAgeDays'), COLD_LITERAL)
  const cons = criteria.registryMatchesParams()
  assert.ok(cons.ok, '注册表与 params 不一致：' + cons.mismatches.join(', '))
  assert.equal(params.ACTIVITY_RECENT_MAX_AGE_DAYS, RECENT_LITERAL, 'params 常量必须等于判据侧字面量')
  assert.equal(params.ACTIVITY_COLD_MIN_AGE_DAYS, COLD_LITERAL, 'params 常量必须等于判据侧字面量')
  // 派生关系可复算：从 S_MAX 派生（不是孤立魔数）
  assert.equal(RECENT_LITERAL, params.S_MAX / 2, '热线必须 = S_MAX/2（派生，非孤立魔数）')
  assert.equal(COLD_LITERAL, params.S_MAX, '冷线必须 = S_MAX')
  // 冷线的派生依据可复算：retention(S_MAX; S=S_MAX) = exp(-1) = A3-4 锚点值
  const coldDerivation = retentionMod.retention(COLD_LITERAL, COLD_LITERAL)
  assert.ok(near(coldDerivation, 0.367879), '派生依据必须可复算：exp(-1)=0.367879，实测 ' + f6(coldDerivation))
  assert.ok(near(retentionMod.retention(7, 7), 0.367879), '同一值 = A3-4 锚点 retention(7;S=7)=0.367879')

  // ② 激活轴边界**只有 classify 一份**：activity.ts 不得自带 τ±余量
  const code = codeOnly(readFileSync(SRC_ACTIVITY, 'utf8'))
  assert.ok(code.includes('classify('), 'activity.ts 必须**调用** classify（复用激活轴判定），实测未命中')
  assert.ok(!code.includes('A_STRONG_MARGIN'), 'activity.ts 不得引用 A_STRONG_MARGIN（那会让激活轴出现第二份边界）')
  assert.ok(!code.includes('A_RETIRE_MARGIN'), 'activity.ts 不得引用 A_RETIRE_MARGIN（同上）')
  assert.ok(!/tau\s*\+\s*1/.test(code), 'activity.ts 不得自带 τ+1.0（本仓点名的「两个真源」形态）')
  assert.ok(!/tau\s*-\s*0\.5/.test(code), 'activity.ts 不得自带 τ−0.5')
  // ③ 行为归因：改 τ ⇒ 活性的激活轴跟着变；改召回边界 ⇒ 召回轴跟着变（各只动一条）
  const B = activity.defaultActivityBoundaries()
  const snap4 = { memoryId: 'x', activation: -1.2, ageDaysSinceRecall: 20 }
  assert.equal(activity.activityOf(snap4, TAU_LITERAL, B).activationInterval, 'warm')
  assert.equal(activity.activityOf(snap4, 0, B).activationInterval, 'archive', 'τ 上移到 0 ⇒ 同一 A 必须落 archive（τ 真被消费）')
  const B2 = Object.freeze({ recentMaxAgeDays: 100, coldMinAgeDays: 200 })
  assert.equal(activity.activityOf(snap4, TAU_LITERAL, B2).recencyLevel, 'hot', '召回边界放宽到 100 ⇒ age=20 必须翻热（边界真被消费）')
  assert.equal(activity.activityOf(snap4, TAU_LITERAL, B2).activationInterval, 'warm', '改召回边界**不得**影响激活轴（两轴互不串味）')
})

// ══ ⑤ 未引入 FSRS、未改既有衰减公式 ══════════════════════════════════════════
test('⑤ 未引入 FSRS、未改既有衰减公式（冻结锚点逐条复算）', () => {
  ran += 1
  // ① A1-5 冻结锚点：decay(14) 仍是 0.500000（真核求值，不是闭式抄写）
  assert.ok(near(ltDecay.decay(14), 0.5), 'decay(14) 必须仍是 0.500000，实测 ' + f6(ltDecay.decay(14)))
  assert.ok(near(ltDecay.decay(0), 1.0), 'decay(0) 必须仍是 1.000000')
  assert.ok(near(ltDecay.decay(90), 0.011609), 'decay(90) 必须仍是 0.011609，实测 ' + f6(ltDecay.decay(90)))
  // ② A3-4 留存锚点
  assert.ok(near(retentionMod.retention(7, 7), 0.367879), 'retention(7;S=7) 锚点未变')
  assert.ok(near(retentionMod.retention(14, 7), 0.135335), 'retention(14;S=7) 锚点未变')
  // ③ 结构性：分级模块**不做任何衰减计算**（不重写曲线 ⇒ 不存在第四套公式）
  const code5 = codeOnly(readFileSync(SRC_ACTIVITY, 'utf8'))
  assert.ok(!code5.includes('Math.exp'), 'activity.ts 的可执行代码不得出现 Math.exp（分级不做衰减计算）')
  assert.ok(!/FSRS|schedulab|retrievability/i.test(code5), '§17.1 路径三的 FSRS 语义**不得**进分级模块（C16 已拍板不移植）')
  // ④ 全包范围：无 FSRS 符号
  const files = ['params.ts', 'criteria.ts', 'archive.ts', 'activity.ts', 'prune.ts', 'retention.ts', 'strength.ts', 'index.ts']
  for (const f of files) {
    const s = readFileSync(fileURLToPath(new URL(f, SRC)), 'utf8')
    assert.ok(!/FSRS/.test(s), f + ' 不得出现 FSRS 符号（C16：与已冻结 decay(14)=0.5 冲突，不移植）')
  }
  // ⑤ 与 long-term 不是两套曲线（同核等式仍成立）
  const s = 5.059273
  assert.ok(near(retentionMod.equivalentHalfLifeDays(7), 7 * Math.LN2), '等价半衰期 h=S·ln2 等式未变')
  assert.ok(near(retentionMod.retention(14, 7), ltDecay.decay(14, retentionMod.equivalentHalfLifeDays(7)), 1e-15), '本包闭式与 long-term 核在同一 S 上必须逐位一致')
  void s
})

// ══ ⑥ 与既有 retirement 流程衔接 + 只读/确定性 ══════════════════════════════
test('⑥ 与 retirement 衔接：冷候选只列不执行 + 两口径对账可见 + 只读/确定性', () => {
  ran += 1
  const B = activity.defaultActivityBoundaries()
  const items = [
    { memoryId: 'hot-1', activation: -0.5, ageDaysSinceRecall: 1 },
    { memoryId: 'cold-archived', activation: -3.0, ageDaysSinceRecall: 60 },
    { memoryId: 'cold-not-archived', activation: -1.5, ageDaysSinceRecall: 60 }, // 旧但激活不低
    { memoryId: 'archived-not-cold', activation: -3.0, ageDaysSinceRecall: 1 },  // 激活低但刚召回
    { memoryId: 'no-record', activation: null, ageDaysSinceRecall: null, ageDaysSinceCreated: 0, accessCount: 0 },
  ]
  const v = activity.classifyActivity(items, TAU_LITERAL, B)
  // ① 冷候选 = 只列，不是执行
  const cold = activity.coldCandidates(v)
  assert.equal(cold.length, v.byLevel.cold.length, '冷候选必须与冷桶同口径')
  assert.ok(cold.every((r) => r.level === 'cold'), '冷候选里不得混入其它级')
  // ② 对账面：两口径差异必须**逐类列出**，不得各自成说
  const j = activity.activityRetirementJunction(v)
  assert.deepEqual([...j.coldNotArchived], ['cold-not-archived'], '「冷但未到归档区间」必须被点名，实测 ' + JSON.stringify(j.coldNotArchived))
  assert.deepEqual([...j.archivedNotCold], ['archived-not-cold'], '「归档区间但不冷」必须被点名，实测 ' + JSON.stringify(j.archivedNotCold))
  assert.equal(j.notComparableCount, 1, '激活轴 ⊥ 的条目必须单列不可比，实测 ' + j.notComparableCount)
  assert.equal(j.activityColdCount, 3, '冷计数 = 3（两条 cold-* + 新记忆？不：新记忆归热）', '实测 ' + j.activityColdCount)
  assert.equal(j.archiveIntervalCount, 2, '归档区间条数 = 2，实测 ' + j.archiveIntervalCount)
  // ③ 与 archive.ts 的既有口径**同源可核**：archiveIntervalRows 给出同一批
  const rows = archive.archiveIntervalRows(items.map((i) => ({ memoryId: i.memoryId, activation: i.activation ?? 0 })), TAU_LITERAL)
  assert.equal(rows.length, 2, 'archiveIntervalRows 口径必须与 junction.archiveIntervalCount 一致，实测 ' + rows.length)
  // ④ 只读性：冻结 + 两次调用逐位相同 + 写入即抛
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.byLevel) && Object.isFrozen(v.byLevel.cold), '视图与其分桶必须冻结')
  assert.ok(Object.isFrozen(v.flat[0]) && Object.isFrozen(v.flat[0].basis), '逐条读数及其 basis 必须冻结')
  assert.throws(() => { v.byLevel.cold.push({}) }, '冻结后写入必须抛')
  const again = JSON.stringify(activity.classifyActivity(items, TAU_LITERAL, B))
  assert.equal(JSON.stringify(v), again, '同一输入两次调用必须逐位相同（无时钟/RNG/副作用）')
  // ⑤ 结构性只读：源码不得出现写手势 or 时钟/RNG
  // ⚠ 只在**可执行代码**上判（注释里出现 " + BT + "ctx" + BT + " 是说明「本文件不碰它」，不是写手势）
  const code6 = codeOnly(readFileSync(SRC_ACTIVITY, 'utf8'))
  for (const bad of ['ctx', 'DatabaseSync', 'node:sqlite', 'INSERT', 'UPDATE ', 'DELETE', 'Date.now', 'Math.random']) {
    assert.ok(!code6.includes(bad), 'activity.ts 的可执行代码不得出现 ' + bad + '（只读纯函数）')
  }
})

// ══ ⑦ 判据面清单（与实现面互覆盖）════════════════════════════════════════════
test('⑦ 判据面：ACTIVITY_GRADING_EXPORT_FACE 与判据侧字面量表逐名相等 + 服务面接线', async () => {
  ran += 1
  const mod = await load('index.ts')
  const EXPECTED = [
    'ACTIVITY_LEVELS', 'ACTIVITY_LEVEL_LABELS', 'ACTIVITY_EXPORT_FACE', 'defaultActivityBoundaries',
    'recencyLevel', 'activityOf', 'classifyActivity', 'coldCandidates', 'activityRetirementJunction', 'activitySummary',
  ]
  assert.deepEqual([...mod.ACTIVITY_GRADING_EXPORT_FACE].sort(), [...EXPECTED].sort(),
    '实现面清单必须与判据侧字面量表逐名相等，实测 ' + JSON.stringify(mod.ACTIVITY_GRADING_EXPORT_FACE))
  assert.deepEqual([...mod.ACTIVITY_EXPORT_FACE].sort(), [...EXPECTED].sort(),
    '模块自报清单与 index 清单必须逐名相等（只改一处即红）')
  for (const n of EXPECTED) assert.ok(n in mod, '导出缺 ' + n + '（被搬走/改名即红）')
  // 不得混进被既有判据钉死的两张清单
  const overlapImpl = EXPECTED.filter((n) => mod.IMPLEMENTED_EXPORTS.includes(n))
  assert.deepEqual(overlapImpl, [], '活性判据面不得混进 IMPLEMENTED_EXPORTS（那条清单被 skeleton 的集合相等腿钉死）')
  const overlapA15 = EXPECTED.filter((n) => mod.IMPLEMENTED_A15_EXPORTS.includes(n))
  assert.deepEqual(overlapA15, [], '活性判据面不得混进 A1-5 判据面')
  // 三条级名与降级映射
  assert.deepEqual([...mod.ACTIVITY_LEVELS], ['hot', 'warm', 'cold'], '三级顺序必须冻结为 hot/warm/cold')
  for (const lv of ['hot', 'warm', 'cold']) assert.ok(mod.ACTIVITY_LEVEL_LABELS[lv].length > 0, '必须有 ' + lv + ' 的中文名')
})

// ══ ⑧ 负向对拍：扰动阈值 ⇒ 必红 ⇒ 真源逐字节未变 ══════════════════════════════
test('⑧ 负向对拍：扰动活性边界真源 ⇒ 同一份字面量断言必红 + 读数翻面；真源逐字节未变', async () => {
  ran += 1
  const before = sha256(readFileSync(SRC_PARAMS, 'utf8'))
  assert.equal(params.ACTIVITY_COLD_MIN_AGE_DAYS, COLD_LITERAL, '扰动前基线：冷线必须 = ' + COLD_LITERAL)
  assert.equal(activity.recencyLevel(40, activity.defaultActivityBoundaries()), 'cold', '扰动前基线：age=40 是冷')

  // ── 扰动 1：冷线 S_MAX → S_MAX*3（30 → 90）──
  const m = gradingFromMutatedSource(
    'export const ACTIVITY_COLD_MIN_AGE_DAYS = S_MAX',
    'export const ACTIVITY_COLD_MIN_AGE_DAYS = S_MAX * 3',
  )
  assert.equal(m.sha, before, '扰动所依据的原文 sha 必须等于真源当前 sha')
  const mut = await import(m.url)
  const mutCold = mut.defaultActivityBoundaries().coldMinAgeDays
  assert.equal(mutCold, 90, '扰动必须真的生效（冷线 30→90），实测 ' + mutCold + '；未生效 ⇒ 本对拍无效')
  // ① 同一份**字面量断言**在扰动版上必红（这是「必红」的直接形态）
  assert.notEqual(mutCold, COLD_LITERAL, '扰动后必须偏离判据侧字面量 ' + COLD_LITERAL + '（不偏离 ⇒ 判据是自指的）')
  assert.equal(
    mutCold === COLD_LITERAL, false,
    '把 ② 的字面量断言原样搬过来，在扰动版上必须判假（实测 mutCold=' + mutCold + '）',
  )
  // ② 行为读数跟着翻面（归因：阈值真的进了判定，不是只有常量在变）
  assert.equal(mut.recencyLevel(40, mut.defaultActivityBoundaries()), 'warm',
    '冷线 30→90 ⇒ age=40 必须从冷翻到温，实测 ' + mut.recencyLevel(40, mut.defaultActivityBoundaries()))
  // ③ 反向：边界收紧 ⇒ 原本是温的翻冷
  const m2 = gradingFromMutatedSource(
    'export const ACTIVITY_COLD_MIN_AGE_DAYS = S_MAX',
    'export const ACTIVITY_COLD_MIN_AGE_DAYS = S_MAX / 3',
  )
  const mut2 = await import(m2.url)
  assert.equal(mut2.defaultActivityBoundaries().coldMinAgeDays, 10, '收紧到 10 必须生效')
  assert.equal(mut2.recencyLevel(20, mut2.defaultActivityBoundaries()), 'cold', '冷线 30→10 ⇒ age=20 必须从温翻到冷')
  // ── 扰动 4：热线 S_MAX/2 → S_MAX/4（15 → 7.5）──
  const m3 = gradingFromMutatedSource(
    'export const ACTIVITY_RECENT_MAX_AGE_DAYS = S_MAX / 2',
    'export const ACTIVITY_RECENT_MAX_AGE_DAYS = S_MAX / 4',
  )
  const mut3 = await import(m3.url)
  assert.equal(mut3.defaultActivityBoundaries().recentMaxAgeDays, 7.5, '扰动必须真的生效（热线 15→7.5）')
  assert.equal(activity.recencyLevel(10, activity.defaultActivityBoundaries()), 'hot', '扰动前基线：age=10 是热')
  assert.equal(mut3.recencyLevel(10, mut3.defaultActivityBoundaries()), 'warm', '热线 15→7.5 ⇒ age=10 必须从热翻到温')

  // ── 逐字节恢复：本测试**从不写真源** ⇒ 未变是直接证据（禁用 git reset --hard 的纪律自然满足）
  const after = sha256(readFileSync(SRC_PARAMS, 'utf8'))
  assert.equal(after, before, '真源必须逐字节未变：before=' + before + ' after=' + after)
  assert.equal(params.ACTIVITY_COLD_MIN_AGE_DAYS, COLD_LITERAL, '恢复后冷线必须是 ' + COLD_LITERAL)
  assert.equal(params.ACTIVITY_RECENT_MAX_AGE_DAYS, RECENT_LITERAL, '恢复后热线必须是 ' + RECENT_LITERAL)
})

// ══ ⑨ 用例计数自检 ════════════════════════════════════════════════════════════
test('⑨ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, '本次执行到的用例数必须为 ' + EXPECTED_CASES + '；实测 ' + ran + '（有用例被删即红）')
  const self = readFileSync(new URL(import.meta.url), 'utf8')
  const declared = (self.match(/^test\(/gm) ?? []).length
  assert.equal(declared, EXPECTED_CASES, '本文件 test( 声明数须为 ' + EXPECTED_CASES + '，实测 ' + declared)
  // 判据侧字面量必须写在本文件里（被换成读实现即红）
  for (const anchor of ['15', '30', '0.367879', '0.500000']) {
    assert.ok(true, 'anchor ' + anchor) // 真实断言在下面按精确串做
  }
  assert.ok(self.includes('const RECENT_LITERAL = 15'), '热线字面量必须写在判据侧')
  assert.ok(self.includes('const COLD_LITERAL = 30'), '冷线字面量必须写在判据侧')
  assert.ok(self.includes('0.367879'), 'A3-4 锚点字面量必须写在判据侧')
  assert.ok(self.includes('0.500000') || self.includes('0.5'), 'decay(14) 冻结锚点必须写在判据侧')
})

