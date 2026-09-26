/**
 * v10 §13.6 突触重归一化 —— **事实面判据**。
 *
 * 判据原文（`docs/mana-v10-status-plan.md:674-683`，逐字）：
 *   「全局突触强度重缩放 → 降低弱关联权重 → 保留强关联权重 → 提升信噪比」
 * 任务卡追加的硬要求：**守恒律必须可断言** —— 判据直接断言「缩放前后总强度在容差内相等」
 *   **这个数**，而不是只断言「跑完了没报错」。
 *
 * ── 本文件要判的十一件事（每件都配可复算读数，不靠注释承诺）──────────────────────
 *   ① **守恒律**：`|totalAfter − totalBefore| ≤ 容差`（**核心腿**），且**钳位态同样守恒**；
 *   ② **§13.6 语义**：弱（`S<μ`）严格下降、强（`S>μ`）不下降、落在均值上的逐位不变；
 *      并钉死一条**方向律**：`capacity ≥ maxBefore ⇒ 方向必为 sharpen`；
 *   ③ **幂等 / 可重入**：同批跑两次 ⇒ 第二次为恒等 `no-op`，且逐条逐位不变（钳位态与未钳位态各一）；
 *   ④ **三种 no-op 成因可分辨**（不许把「没输入」「没强弱」「已在不动点」压成同一个静默返回）；
 *   ⑤ **失败态可分辨**：非法入参**必抛**（fail-closed），合法入参**不抛**（两个方向都判）；
 *   ⑥ **容量精确达到 + 钳位可见**（静默钳位是本仓最防的形态）；
 *   ⑦ **信噪比律**：`snrGain ≡ scale`（σ 随 γ 线性缩放，可代数复算）；无定义时给 `null`；
 *   ⑧ **零依赖**：把 `renorm.ts` **单独一份**复制到空目录仍可加载并算出逐位相同的读数
 *      ⇒ 「不碰 A1-5 的牙（`activity/decay/retention`）」不是注释承诺，是**结构事实**；
 *   ⑨ **只读 + 冻结 + 确定性**：deepFreeze、同输入两次调用逐位相同、无时钟无 RNG；
 *   ⑩ **源码结构断言**（剥注释后的可执行面）：零 `import`、无写手势、不引用被锚定的三个文件；
 *   ⑪ 用例计数自检（空文件/截断会报 `tests 1 / pass 1` 的假绿）。
 *
 * ── 为什么每条期望都写成**判据侧的独立字面量**（不得用被测常量反算）─────────────────
 *   若写 `assert.equal(v.totalBefore, F.reduce(...))`，期望值会跟着实现走 ⇒ **恒定绿**（自指）。
 *   故本文件把 28 / 7 / 1.4 / 0.5150787536377127 这些数**在判据侧也算一遍**，并与实现读数对拍。
 *
 * 运行（**显式路径**）：`node --test packages/forgetting/tests/renorm.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = new URL('../src/', import.meta.url)
const ROOT = new URL('../../', import.meta.url) // packages/
const load = (f) => import(new URL(f, SRC).href)
const sha256 = (t) => createHash('sha256').update(t).digest('hex')
const near = (a, b, eps) => Math.abs(a - b) <= eps
const f6 = (x) => Number(x).toFixed(6)

const renorm = await load('renorm.ts')
const R = renorm.renormalizeSynapses

/** 守恒容差（**判据侧独立字面量**）。实测残差恒为 0；此处留 1e-9 以吸收浮点求和次序差异。 */
const CONSERVATION_TOL = 1e-9
const SRC_RENORM = fileURLToPath(new URL('renorm.ts', SRC))
/** A1-5 的牙锚定的文件（本卡**不得碰**）—— 本文件读它们只为「本测试没动它」取证。 */
const ANCHORED = [
  fileURLToPath(new URL('activity.ts', SRC)),
  fileURLToPath(new URL('retention.ts', SRC)),
  fileURLToPath(new URL('long-term/src/decay.ts', ROOT)),
].filter((p) => existsSync(p))

const EXPECTED_CASES = 12
let ran = 0

/**
 * 剥离注释，只留**可执行代码**（结构性断言的唯一合法输入面）。
 * ⚠ 本模块的注释里**故意写着**「零 import」「不与衰减曲线相乘」—— 直接在全文上跑断言，
 *   那条**说明自己没依赖**的注释反而会把断言判红（activity.test.mjs 已记同一形态）。
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
  const d = mkdtempSync(join(tmpdir(), 'mana-renorm-'))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/** 夹具 A：N=4，**钳位态**（γ_raw = 4.6 被非负下界截到 1.4）。 */
const FA = [
  { memoryId: 'a', strength: 2 },
  { memoryId: 'b', strength: 6 },
  { memoryId: 'c', strength: 8 },
  { memoryId: 'd', strength: 12 },
]
/** 夹具 B：N=2，**未钳位且容量精确达到**（[10,20] → [5,25]，min 仍在 0 之上）。 */
const FB = [
  { memoryId: 'p', strength: 10 },
  { memoryId: 'q', strength: 20 },
]
const asItems = (v) => v.resolved.map((r) => ({ memoryId: r.memoryId, strength: r.after }))

// ══ ① 守恒律（核心腿）：判据断言的是**这个数**，不是「跑完了没报错」 ═════════════════
test('① 守恒律：totalAfter ≡ totalBefore（容差内）；钳位态同样守恒', () => {
  ran += 1
  // 判据侧独立复算夹具 A 的总强度（不从实现读）：2+6+8+12 = 28。
  const expectT = 2 + 6 + 8 + 12
  assert.equal(expectT, 28, '夹具 A 的总强度必须是判据侧字面量 28')

  const a = R(FA, 30)
  assert.equal(a.totalBefore, expectT, '缩放前总强度必须 = 28')
  assert.ok(
    near(a.totalAfter, expectT, CONSERVATION_TOL),
    '★ 核心腿：缩放后总强度必须与缩放前在容差 ' + CONSERVATION_TOL + ' 内相等；实测 totalBefore=' +
      a.totalBefore + ' totalAfter=' + a.totalAfter + ' 残差=' + a.conservationResidual,
  )
  assert.ok(
    near(a.conservationResidual, 0, CONSERVATION_TOL),
    '守恒残差字段必须自洽于 0；实测 ' + a.conservationResidual,
  )
  // 残差字段必须**真的**等于两次求和之差（防它退化成写死的 0）
  assert.equal(a.conservationResidual, a.totalAfter - a.totalBefore, '残差字段必须等于 totalAfter − totalBefore')
  // 钳位态：本夹具 γ 被非负下界截住 ⇒ 守恒**仍须成立**（钳位不是"把差额丢掉"）
  assert.equal(a.clamped, true, '夹具 A 必须是钳位态（否则本腿没覆盖到钳位）')

  // 未钳位夹具 B：另一组读数上的守恒（**不止一个夹具**，防"只有这一组恰好成立"）
  const b = R(FB, 25)
  assert.equal(b.totalBefore, 30, '夹具 B 总强度必须是判据侧字面量 30')
  assert.ok(near(b.conservationResidual, 0, CONSERVATION_TOL), '夹具 B 残差实测 ' + b.conservationResidual)
  assert.equal(b.clamped, false, '夹具 B 必须是未钳位态（否则两条腿覆盖同一态）')

  // ★ 报告的联合**必须是从逐条读数导出的量，不能是另算的第二个真源**。
  //   判据侧独立求和后**精确**相等（不是容差内）—— 实现用同一个 += 序列求和，故逐位相同。
  //   ⚠ 这条腿是被变异自证逼出来的：把 `totalAfter` 换成回显 `totalBefore`（伪造守恒数字）
  //     时，只判 |residual| ≤ tol 会**全绿漏网**（residual 跟着变成 0）。
  const closureA = a.resolved.reduce((s, r) => s + r.after, 0)
  assert.equal(a.totalAfter, closureA, '★ totalAfter 必须精确等于逐条 after 之和（防其变成第二真源）')
  assert.equal(
    a.totalBefore, closureA - a.conservationResidual,
    '★ 守恒残差字段必须精确等于 totalAfter − totalBefore（残差不得退化成写死的 0）',
  )
  const closureB = b.resolved.reduce((s, r) => s + r.after, 0)
  assert.equal(b.totalAfter, closureB, '★ 夹具 B（未钳位）同样须精确自洽')
  void f6
})

// ══ ② §13.6 语义 + 方向律 ══════════════════════════════════════════════════════════
test('② §13.6 语义：弱严格下降 / 强不下降 / 均值上不变；capacity ≥ max ⇒ 必为 sharpen', () => {
  ran += 1
  const v = R(FA, 30)
  const byId = Object.fromEntries(v.resolved.map((r) => [r.memoryId, r]))
  assert.equal(v.mean, 7, '夹具 A 均值必须是判据侧字面量 7')
  // 弱（2 / 6 < μ=7）**严格下降**
  for (const id of ['a', 'b']) {
    assert.equal(byId[id].rank, 'weak', id + ' 必须判为 weak')
    assert.ok(byId[id].delta < 0, '★ §13.6「降低弱关联权重」：' + id + ' 必须严格下降；实测 delta=' + byId[id].delta)
  }
  // 强（8 / 12 > μ）**不下降**
  for (const id of ['c', 'd']) {
    assert.equal(byId[id].rank, 'strong', id + ' 必须判为 strong')
    assert.ok(byId[id].delta >= 0, '★ §13.6「保留强关联权重」：' + id + ' 不得下降；实测 delta=' + byId[id].delta)
  }
  // 逐条 after 的判据侧独立复算：μ + γ(S−μ)，γ = 1.4
  const mu = 7
  const gamma = 1.4
  for (const s of [2, 6, 8, 12]) {
    const want = mu + gamma * (s - mu)
    const got = byId[{ 2: 'a', 6: 'b', 8: 'c', 12: 'd' }[s]].after
    assert.ok(near(got, want, 1e-9), 'after(' + s + ') 判据侧复算 = ' + want + '；实测 ' + got)
  }
  // ── 方向律：容量不低于当前最强 ⇒ 只能是「展宽（下限 ×γ>1）」 ──
  for (const [items, cap] of [[FA, 30], [FB, 25], [FB, 30]]) {
    const cap_ok = cap >= Math.max(...items.map((i) => i.strength))
    const r = R(items, cap)
    if (cap_ok && r.outcome.kind === 'renormalized') {
      assert.equal(
        r.outcome.direction, 'sharpen',
        '★ 方向律：capacity(' + cap + ') ≥ maxBefore 时方向必须为 sharpen；实测 ' + r.outcome.direction,
      )
    }
  }
  // ── 镜像支（capacity < 当前最强）：守恒式压缩**必然**把强侧压低并抬起弱侧 ──
  //    ⚠ 这不是"顺带修好了"，而是「把强关联压下去而不动弱的」在守恒约束下**代数不可能**（见 src 文件头）。
  const m = R([{ memoryId: 'w', strength: 1 }, { memoryId: 's', strength: 9 }], 7)
  assert.equal(m.outcome.direction, 'compress', 'capacity < maxBefore 时必须走镜像支（compress）')
  assert.equal(m.mean, 5, '镜像夹具均值 = 5')
  const mw = m.resolved.find((r) => r.memoryId === 'w')
  const ms = m.resolved.find((r) => r.memoryId === 's')
  assert.ok(mw.delta > 0 && ms.delta < 0, '镜像支：弱抬升/强压低；实测 weak delta=' + mw.delta + ' strong delta=' + ms.delta)
  assert.ok(near(m.conservationResidual, 0, CONSERVATION_TOL), '镜像支同样守恒；实测 ' + m.conservationResidual)
})

// ══ ③ 幂等 / 可重入 ════════════════════════════════════════════════════════════════
test('③ 幂等：同批跑两次 ⇒ 第二次恒等 no-op，逐条逐位不变（钳位态与未钳位态各一）', () => {
  ran += 1
  for (const [label, items, cap] of [['钳位态', FA, 30], ['未钳位态', FB, 25]]) {
    const first = R(items, cap)
    assert.equal(first.outcome.kind, 'renormalized', label + ' 首次必须真的做了（否则幂等腿没覆盖到）')
    const second = R(asItems(first), cap)
    assert.equal(second.outcome.kind, 'no-op', label + ' 第二次必须为 no-op（不得持续衰减）')
    assert.equal(second.outcome.reason, 'identity', label + ' 第二次的 no-op 成因必须是 identity')
    assert.equal(second.scale, 1, label + ' 第二次的 γ 必须是 1（不动点）')
    // ★ 逐条逐位不变 —— 「每跑一次全体变弱」这条坏形态必须不可能发生
    for (let i = 0; i < first.resolved.length; i += 1) {
      assert.equal(
        second.resolved[i].after, first.resolved[i].after,
        label + ' 第二次不得改动任何一条；实测 ' + second.resolved[i].memoryId + ' ' +
          first.resolved[i].after + ' → ' + second.resolved[i].after,
      )
      assert.equal(second.resolved[i].delta, 0, label + ' 第二次逐条 delta 必须为 0')
    }
    // 总强度两次都不变（守恒 + 幂等合起来 = 不膨胀也不衰减）
    assert.ok(near(second.totalAfter, first.totalAfter, CONSERVATION_TOL), label + ' 第二次总强度不得变')
    // 第三次也仍是恒等（可重入，不是"只在第二次恰好成立"）
    const third = R(asItems(second), cap)
    assert.equal(third.outcome.reason, 'identity', label + ' 第三次仍须 identity')
  }
  // 恒等态的**来路可分辨**：钳位态走 floor 支、未钳位态走 capacity 支
  const f = R(asItems(R(FA, 30)), 30)
  const c = R(asItems(R(FB, 25)), 25)
  assert.ok(f.basis.includes('no-op.identity.floor'), '钳位态的恒等来路必须标 floor；实测 ' + JSON.stringify(f.basis))
  assert.ok(c.basis.includes('no-op.identity.capacity'), '未钳位态的恒等来路必须标 capacity；实测 ' + JSON.stringify(c.basis))
})

// ══ ④ 三种 no-op 成因**各自点名**（不合并成一个静默返回）══════════════════════════════
test('④ no-op 三成因可分辨：empty-input / no-spread / identity 不得同形', () => {
  ran += 1
  const empty = R([], 30)
  const flat = R([{ memoryId: 'x', strength: 5 }, { memoryId: 'y', strength: 5 }], 30)
  const ident = R(asItems(R(FA, 30)), 30)

  assert.equal(empty.outcome.kind, 'no-op')
  assert.equal(empty.outcome.reason, 'empty-input', '空批次成因必须是 empty-input')
  assert.equal(empty.inputCount, 0, '空批次必须**显式记 0**（「无输入」与「未消费」须可分辨）')

  assert.equal(flat.outcome.kind, 'no-op')
  assert.equal(flat.outcome.reason, 'no-spread', '全体相等的成因必须是 no-spread（不是 empty/identity）')
  assert.equal(flat.inputCount, 2, 'no-spread 的输入量必须是 2（证明确实读到了输入）')
  assert.equal(flat.weakCount, 0, '全体相等 ⇒ 无弱项')
  assert.equal(flat.strongCount, 0, '全体相等 ⇒ 无强项')
  assert.equal(flat.equalCount, 2, '全体相等 ⇒ 两条都是 equal')

  assert.equal(ident.outcome.reason, 'identity', '恒等态成因必须是 identity（不是 empty/no-spread）')

  // ★ 三条成因**两两不同**（把"可分辨"写成断言本身）
  const reasons = [empty.outcome.reason, flat.outcome.reason, ident.outcome.reason]
  assert.equal(new Set(reasons).size, 3, '三种 no-op 成因必须两两不同；实测 ' + JSON.stringify(reasons))
  // 且三种都**不是抛错**（"没得做"与"坏了"必须可分辨）
  assert.equal(empty.totalBefore, 0, '空批次的守恒量显式给 0')
  assert.equal(flat.scale, 1, 'no-spread 的 γ 必须是 1')
  // basis 也要能分辨（面板可读）
  assert.ok(empty.basis.includes('no-op.empty-input'), 'basis 须含 no-op.empty-input')
  assert.ok(flat.basis.includes('no-op.no-spread'), 'basis 须含 no-op.no-spread')
})

// ══ ⑤ 失败态可分辨：非法必抛 / 合法不抛（**两个方向都判**）══════════════════════════
test('⑤ 失败面：六类非法入参必抛（fail-closed），合法入参不抛', () => {
  ran += 1
  const bad = [
    ['strength = NaN', () => R([{ memoryId: 'a', strength: NaN }], 30), '有限数'],
    ['strength = Infinity', () => R([{ memoryId: 'a', strength: Infinity }], 30), '有限数'],
    ['strength < 0', () => R([{ memoryId: 'a', strength: -1 }], 30), '不得为负'],
    ['memoryId 重复', () => R([{ memoryId: 'a', strength: 1 }, { memoryId: 'a', strength: 2 }], 30), '重复'],
    ['capacity = NaN', () => R([{ memoryId: 'a', strength: 1 }], NaN), '有限数'],
    ['capacity ≤ 0', () => R([{ memoryId: 'a', strength: 1 }], 0), '必须为正'],
    ['capacity ≤ μ（次序反转）', () => R([{ memoryId: 'a', strength: 4 }, { memoryId: 'b', strength: 8 }], 6), '高于批次均值'],
  ]
  for (const [name, fn, kw] of bad) {
    let threw = null
    try { fn() } catch (e) { threw = e }
    assert.ok(threw, '★ fail-closed：' + name + ' 必须**抛**（静默 return null 会让「坏了」与「没有」同形）')
    assert.ok(threw instanceof Error, name + ' 抛出的必须是 Error；实测 ' + typeof threw)
    assert.ok(
      String(threw.message).includes(kw),
      name + ' 的错误消息须点出成因关键字 「' + kw + '」；实测 ' + String(threw.message).slice(0, 80),
    )
  }
  // 反方向：**合法入参不得抛**（只判"该挡的挡住了"会漏掉"把合法的也挡了"）
  for (const [name, fn] of [
    ['空批次', () => R([], 30)],
    ['强度含 0', () => R([{ memoryId: 'z', strength: 0 }, { memoryId: 'a', strength: 4 }], 30)],
    ['capacity = maxBefore', () => R(FB, 20)],
    ['capacity 远大于 max', () => R(FA, 1e6)],
  ]) {
    assert.doesNotThrow(fn, '合法入参不得被挡：' + name)
  }
  // ★ 强度 0 的条目：比值无意义 ⇒ factor **必须是 null**（本仓「坏与没有不得同形」）。
  //   ⚠ 这条腿是本席跑了变异自证**才补上的**：初版只在注释里声明该语义、没有断言 ⇒
  //     把 `s === 0 ? null : …` 改成 `s === 0 ? 1 : …` 时**全绿漏网**（实测 M10）。
  //     声明而不断言 = 本仓点名的「注释级证据」，故此处两个方向各判一次。
  const z = R([{ memoryId: 'z', strength: 0 }, { memoryId: 'a', strength: 4 }], 30)
  const zr = z.resolved.find((r) => r.memoryId === 'z')
  const ar = z.resolved.find((r) => r.memoryId === 'a')
  assert.equal(zr.factor, null, '★ strength=0 的 factor 必须为 null（不许用 0 或 1 冒充「有读数」）')
  assert.equal(typeof ar.factor, 'number', '非零强度的 factor 必须是数（否则 null 与「没算」同形）')
})

// ══ ⑥ 容量精确达到 + 钳位**可见**（静默钳位是本仓最防的形态）════════════════════════
test('⑥ 容量精确达到；被非负下界截住时必须可见（scaleRaw / scale / clamped / basis）', () => {
  ran += 1
  // 未钳位：最强**精确**落到容量
  const b = R(FB, 25)
  assert.equal(b.clamped, false, '夹具 B 不得被钳位')
  assert.equal(b.maxAfter, 25, '★ 未钳位时 maxAfter 必须精确等于 capacity；实测 ' + b.maxAfter)
  assert.equal(b.scale, b.scaleRaw, '未钳位时 scale 必须等于 scaleRaw')
  assert.equal(b.minAfter, 5, '夹具 B 的 minAfter 必须是判据侧字面量 5（仍在 0 之上）')

  // 钳位：容量**够不着**，且这件事必须**看得见**
  const a = R(FA, 30)
  assert.equal(a.clamped, true, '夹具 A 必须标记为已钳位')
  assert.equal(a.scaleRaw, 4.6, '只按容量算出的 γ 必须是判据侧字面量 4.6（23/5）')
  assert.equal(a.scaleFloor, 1.4, '非负下界的 γ 上限必须是判据侧字面量 1.4（7/5）')
  assert.equal(a.scale, 1.4, '生效的 γ 必须是被截住的那个 1.4')
  assert.notEqual(a.scale, a.scaleRaw, '★ 钳位时两个 γ 必须**不同**（同形 = 静默钳位）')
  assert.ok(a.basis.includes('clamped.non-negativity-floor'), 'basis 必须点出被非负下界截住')
  // ★ 钳位**不得**把强度推成负数（这正是截住的理由 —— 实测未截时最弱会到 −16）
  for (const r of a.resolved) {
    assert.ok(r.after > -CONSERVATION_TOL, '★ 钳位后逐条强度不得为负；实测 ' + r.memoryId + ' = ' + r.after)
  }
  assert.ok(near(a.resolved[0].after, 0, 1e-9), '最弱的一条应被压到 0（下界正好贴住）；实测 ' + a.resolved[0].after)
  // 若**不**截：同一夹具的裸 γ 会给出负数 —— 把「为什么需要这条约束」钉成可复算事实
  const naiveWorst = a.mean + a.scaleRaw * (a.minBefore - a.mean)
  assert.ok(naiveWorst < 0, '裸 γ 必须会把最弱推到负值（否则该约束是装饰）；实测 ' + naiveWorst)
  void f6
})

// ══ ⑦ 信噪比律：snrGain ≡ scale（σ 随 γ 线性缩放）════════════════════════════════
test('⑦ 信噪比：snrGain ≡ scale（可代数复算）；无定义时给 null 不冒充', () => {
  ran += 1
  for (const [label, v] of [['夹具 A（钳位）', R(FA, 30)], ['夹具 B（未钳位）', R(FB, 25)], ['镜像支', R([{ memoryId: 'w', strength: 1 }, { memoryId: 's', strength: 9 }], 7)]]) {
    assert.ok(v.snrBefore !== null && v.snrAfter !== null, label + ' 的两侧信噪比都必须可读')
    assert.ok(near(v.snrGain, v.scale, 1e-9), '★ 信噪比增益必须 ≡ γ（σ 随 γ 线性缩放）；' + label + ' 实测 gain=' + v.snrGain + ' scale=' + v.scale)
  }
  // 判据侧独立复算夹具 A：σ/μ = 0.5150787536377127
  const s = Math.sqrt(((2 - 7) ** 2 + (6 - 7) ** 2 + (8 - 7) ** 2 + (12 - 7) ** 2) / 4) / 7
  assert.ok(near(s, 0.5150787536377127, 1e-12), '判据侧 σ/μ 复算 = ' + s)
  assert.ok(near(R(FA, 30).snrBefore, s, 1e-12), 'snrBefore 必须与判据侧复算一致')
  // 提升：sharpen 支下信噪比必须**真的**上升
  assert.ok(R(FA, 30).snrAfter > R(FA, 30).snrBefore, '★ §13.6「提升信噪比」：sharpen 支下 snr 必须上升')
  // 未钳位且已在不动点时增益为 1（**读得出来**，不是 null）
  const ident = R(asItems(R(FB, 25)), 25)
  assert.equal(ident.snrGain, 1, '恒等态的信噪比增益必须是 1（不是 null —— 读得出来才叫读数）')
  // 无定义态：全 0 批次 μ = 0 ⇒ null（**不返回 0 或 1 冒充**）
  const zero = R([{ memoryId: 'z1', strength: 0 }, { memoryId: 'z2', strength: 0 }], 30)
  assert.equal(zero.snrBefore, null, 'μ = 0 时 snrBefore 必须为 null')
  assert.equal(zero.snrGain, null, 'μ = 0 时 snrGain 必须为 null（不得冒充 1）')
})

// ══ ⑧ 零依赖：不碰 A1-5 的牙，是**结构事实**而非注释承诺 ══════════════════════════════
test('⑧ 零依赖：renorm.ts 单独一份复制到空目录仍可加载，读数逐位相同', () => {
  ran += 1
  const dir = tmpDir()
  copyFileSync(SRC_RENORM, join(dir, 'renorm.ts'))
  const files = readdirSync(dir)
  assert.deepEqual(files, ['renorm.ts'], '隔离目录必须**只有** renorm.ts（多一个文件才自洽的写法会在此报红）')

  return import(pathToFileURL(join(dir, 'renorm.ts')).href).then((isolated) => {
    const iso = isolated.renormalizeSynapses(FA, 30)
    const here = R(FA, 30)
    assert.equal(
      JSON.stringify(iso), JSON.stringify(here),
      '★ 隔离加载的读数必须与仓内读数**逐位相同** —— 若有人给 renorm.ts 加上 params/activity/decay 依赖，' +
        '这一步会因缺文件而直接失败 ⇒「不碰 A1-5 的牙」成为结构事实',
    )
  })
})

// ══ ⑨ 只读 + 冻结 + 确定性 ══════════════════════════════════════════════════════════
test('⑨ 只读/冻结/确定性：deepFreeze、同输入两次逐位相同、无时钟无 RNG', () => {
  ran += 1
  const v = R(FA, 30)
  assert.equal(v.view, 'read-only', 'view 标记必须是 read-only')
  assert.equal(v.writes, false, 'writes 必须恒为 false')
  assert.ok(Object.isFrozen(v), '读数对象必须冻结')
  assert.ok(Object.isFrozen(v.resolved), '逐条数组必须冻结')
  assert.ok(Object.isFrozen(v.resolved[0]), '逐条记录必须冻结')
  assert.ok(Object.isFrozen(v.basis), 'basis 数组必须冻结')
  // ⚠ **逐元素冻结是** `deepFreeze` **递归走一遍唯一可观测的服务** —— 变异自证实测：
  //   把 `resolved` 改成 `[...resolved]`（外层仍是同一个 deepFreeze 调用）**无任何行为差异**
  //   （新数组同样被递归冻结）⇒ 那是**等价变异体**，不是判据缺口；但这三行必须留着，
  //   它们挡的是另外两种真变异：**不再递归**（只冻结顶层）与**整条 deepFreeze 被摘掉**。
  assert.throws(() => { 'use strict' ; v.scale = 99 }, '冻结对象必须拒绝写入')
  assert.throws(() => { 'use strict' ; v.resolved[0].after = 99 }, '逐条记录必须拒绝写入（递归冻结，非只冻顶层）')
  // 确定性：同输入两次 ⇒ 逐位相同（无时钟、无 RNG、无副作用）
  assert.equal(JSON.stringify(R(FA, 30)), JSON.stringify(R(FA, 30)), '同输入两次调用必须逐位相同')
  // 输入**不被就地改写**（纯函数的另一面）
  const snapshot = JSON.stringify(FA)
  R(FA, 30)
  assert.equal(JSON.stringify(FA), snapshot, '调用不得就地改写输入快照')
  // 本测试**没有**改动 A1-5 锚定的那三个文件（前后 sha256 相同）
  const before = ANCHORED.map((p) => [p, sha256(readFileSync(p, 'utf8'))])
  R(FA, 30)
  for (const [p, h] of before) {
    assert.equal(sha256(readFileSync(p, 'utf8')), h, '本测试不得改动被锚定的文件：' + p)
  }
  assert.ok(ANCHORED.length >= 3, '取证面必须覆盖 activity/retention/long-term decay 三处；实测 ' + ANCHORED.length)
})

// ══ ⑩ 源码结构断言（剥注释后的可执行面）══════════════════════════════════════════════
test('⑩ 源码结构：零 import、无写手势、不引用被锚定的三个文件', () => {
  ran += 1
  const code = codeOnly(readFileSync(SRC_RENORM, 'utf8'))
  assert.ok(code.includes('export function renormalizeSynapses'), '可执行面必须真的含实现（否则本腿在判一个空壳）')
  // 零 import —— 结构上不可能依赖 A1-5 的牙，也不可能引入写库面
  assert.ok(!/^\s*import\b/m.test(code), '★ renorm.ts 的可执行面不得有任何 import；实测命中')
  assert.ok(!/\bfrom\s+['"]/.test(code), '不得出现 from \'…\' 形式的模块引用')
  assert.ok(!/require\s*\(/.test(code), '不得出现 require()')
  // 被锚定的三个文件不得被点名（连字符串引用都不行）
  for (const f of ['activity.ts', 'decay.ts', 'retention.ts']) {
    assert.ok(!code.includes(f), '★ 不得引用被锚定的文件 ' + f + '（A1-5 的牙锚在它上面）')
  }
  // 写手势 / 时钟 / 随机源
  for (const tok of ['ctx', 'node:sqlite', 'DatabaseSync', 'INSERT', 'UPDATE', 'DELETE', 'prepare(', 'Date.now', 'Math.random', 'process.env']) {
    assert.ok(!code.includes(tok), '只读面不得出现 ' + tok)
  }
  // 本模块自报的实现面清单必须与实际导出集合相等（防"加了导出只改一边"）
  const face = ['RENORM_EXPORT_FACE', 'renormalizeSynapses']
  assert.deepEqual([...renorm.RENORM_EXPORT_FACE].sort(), [...face].sort(),
    'RENORM_EXPORT_FACE 必须与判据侧独立清单**集合相等**；实测 ' + JSON.stringify(renorm.RENORM_EXPORT_FACE))
  for (const n of face) assert.ok(n in renorm, '导出缺 ' + n)
  // ⚠ 本卡写面不含 index.ts ⇒ 本模块**不得**出现在包服务面（若有人接线，这条会提醒同步判据）
  assert.equal(typeof renorm.default, 'undefined', '本模块不该有 default 导出')
})

// ══ ⑫ 守恒是**测量**，不是恒等式 ═══════════════════════════════════════════════════
test('⑫ 守恒律在浮点下是**可测**的：未钳位夹具的残差**非零**且仍在容差内', () => {
  ran += 1
  // 为什么必须有这一条（否则 ①② 有假绿风险）：
  //   夹具 A/B 的两次求和恰好逐位相等 ⇒ residual === 0。于是「把 totalAfter 换成 totalBefore」
  //   这类**伪造守恒数字**的改动会一路绿灯（本席变异自证 M14 实测漏网）。
  //   本腿故意取一个**求和次序真的会漂移**的未钳位夹具（[0.6,0.7,0.8] / cap=1.2）：
  //     判据侧独立求和 t0 = 2.0999999999999996、t1 = 2.100000000000002
  //     ⇒ 残差 2.220446049250313e-15 **非零**：守恒在这里是**测出来的**，不是恒等式。
  const FD = [
    { memoryId: 'x', strength: 0.6 },
    { memoryId: 'y', strength: 0.7 },
    { memoryId: 'z', strength: 0.8 },
  ]
  const v = R(FD, 1.2)
  assert.equal(v.outcome.kind, 'renormalized', '该夹具必须真的做了归一化')
  assert.equal(v.clamped, false, '该夹具必须是未钳位态（钳位会把最弱压到 0，凑不出漂移）')

  const t0 = 0.6 + 0.7 + 0.8
  const t1 = v.resolved.map((r) => r.after).reduce((s, x) => s + x, 0)
  assert.equal(v.totalBefore, t0, 'totalBefore 必须精确等于判据侧独立求和 t0')
  assert.equal(v.totalAfter, t1, '★ totalAfter 必须精确等于判据侧独立求和 t1（同一求和次序）')
  assert.equal(v.conservationResidual, t1 - t0, '★ 残差必须精确等于 t1 − t0')
  assert.notEqual(
    v.conservationResidual, 0,
    '★ 本夹具的残差必须**非零** —— 否则这条腿退化成恒等式，挡不住"伪造守恒数字"的改动；实测 ' +
      v.conservationResidual,
  )
  assert.ok(
    near(v.conservationResidual, 0, CONSERVATION_TOL),
    '★ 且仍必须在容差 ' + CONSERVATION_TOL + ' 内（漂移是浮点尾差，不是违约）；实测 ' + v.conservationResidual,
  )
  // 与夹具 A/B 对照：那两组的残差**恰好**为 0 —— 两种形态都覆盖到，「测量」与「恒等」可分辨
  assert.equal(R(FA, 30).conservationResidual, 0, '夹具 A 的残差恰好为 0（对照面）')
  assert.equal(R(FB, 25).conservationResidual, 0, '夹具 B 的残差恰好为 0（对照面）')
})

// ══ ⑬ 用例计数自检 ════════════════════════════════════════════════════════════════
test('⑬ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, '本次执行到的用例数必须为 ' + EXPECTED_CASES + '；实测 ' + ran + '（有用例被删即红）')
})
