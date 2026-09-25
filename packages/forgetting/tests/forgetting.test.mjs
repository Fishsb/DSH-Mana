/**
 * `mana-forgetting` 判据（B4.2）—— 事实面。
 *
 * ⚠ **与 `skeleton.test.mjs` 的分工（不是替代关系，两份都必须过）**：
 *   · `skeleton.test.mjs` —— **形态面**：effect 面恰好 3 条、不写 `mana_trace`、不导出 `Config`、
 *     G9 直通链完好。它防的是"空壳偷偷长出行为"。
 *   · **本文件** —— **事实面**：A3-4 闭式锚点、四区间边界与铺满性、留存上限三态、
 *     修剪视图只读、门槛注册表可消费。它防的是"实现算错 / 阈值不可审 / 只读只是口号"。
 *   两份合起来才覆盖"本包现在是什么样"；任何一份红了都不许只改另一份来变绿。
 *
 * ── 为什么每条锚点都要配**负向对拍**（本仓硬纪律：判据变异验证）──────────────
 *   「判据绿 ≠ 事实被检查」。只断言 `strengthAfterRepeats(1,3) ≈ 5.059273` 时，
 *   若实现里**硬编码** `return 5.059273` 照样绿。故每条锚点都附**扰动腿**：
 *   动一个参数 ⇒ **必须**偏离 ⇒ 断言写的是"偏离"这个方向，不是"请求过扰动"这个标志。
 *   ⚠ 扰动腿与「源码原地变异」（改 params 真值 → 见红 → 复原 → 比 sha256）是**两件事**：
 *     两组证据都在 `docs/handoff/S17.md` §3 与 §3.1 逐条列出，**不互相替代**。
 *
 * ⚠ **本文件的用例数本身也是判据**（同 `skeleton.test.mjs` 口径）：实测**空文件**在显式路径下
 *   同样报 `# tests 1 / # pass 1 / exit 0`（计的是"文件加载成功"）⇒ 空/被截断的文件是**假绿**。
 *   故本文件固定 **11** 条，末条为用例计数自检（少一条即红），并与 `verify.mjs` 同步。
 *
 * 运行（**显式路径**）：node --test packages/forgetting/tests/forgetting.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url) // packages/
const SRC = new URL('../src/', import.meta.url)
const load = (f) => import(new URL(f, SRC).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const f6 = (x) => Number(x).toFixed(6)

const params = await load('params.ts')
const strength = await load('strength.ts')
const retentionMod = await load('retention.ts')
const archive = await load('archive.ts')
const prune = await load('prune.ts')
const criteria = await load('criteria.ts')
const { A_STRONG_MARGIN, A_RETIRE_MARGIN, TAU_FALLBACK, S_MAX, PAVLIK_A, PAVLIK_B } = params
const ltm = await import(new URL('long-term/src/params.ts', ROOT).href) // 只读真源（τ / 半衰期）

const EXPECTED_CASES = 11
let ran = 0

/**
 * 边界扰动用的小夹具。
 *
 * ⚠ 为什么要在**判据文件内**重写一遍边界判定（而不复用实现）：本腿要问的是
 *   「`A_RETIRE_MARGIN` 这个数**是否真的进了判定**」——若复用实现，扰动值会被实现内的
 *   常量覆盖，等于用同一份代码自证。故这里用**独立写出**的判定算对照值；
 *   它与实现在**未扰动时**必须逐点一致（由下面 `assert.equal(baseline, impl)` 钉住，
 *   否则对照物本身漂了也无从发现）。
 */
const archiveShim = {
  classifyWithMargin: (memoryId, a, tau, retireMargin) => {
    void memoryId
    const strong = tau + A_STRONG_MARGIN
    const floor = tau - retireMargin
    if (a > strong) return 'hot'
    if (a > tau) return 'warm'
    if (a > floor) return 'declining'
    return 'archive'
  },
}
/**
 * 对照物自检：未扰动时必须与实现逐点一致（否则下面的扰动结论**不可归因**）。
 *
 * ⚠ 它被放在**用例体内**而不是模块顶层：顶层断言失败会让整个文件**加载即崩**
 *   （TAP 报 `# tests 1 / pass 0`，看不出是**哪条**判据红的）。本席实测过这个形态 ——
 *   把 `A_RETIRE_MARGIN` 由 0.5 改成 0.4 时，顶层断言确实报红，但报的是"文件级失败"。
 *   移进用例体后，红的是**具名**的 ③（本仓纪律：失败必须可归属，不许让失败不可观测）。
 */
function shimSelfCheck() {
  for (const a of [-3, -2.5, -2.4, -2, -1.5, -1, -0.5, 0]) {
    assert.equal(
      archiveShim.classifyWithMargin('m', a, -2, 0.5), // 0.5 = 判据表字面量（不是读常量）
      archive.classify('m', a, -2).interval,
      `边界对照物与实现在 A=${a} 上必须一致（不一致 ⇒ 对照物本身漂了，或边界常量被改动）`,
    )
  }
}

// ══ ① A3-4 ②：Pavlik & Anderson 闭式锚点（判据原文 docs/mana-rollout-plan.md:560）══
test('① A3-4 ②．Pavlik–Anderson 闭式锚点 5.059273 + 参数扰动腿', () => {
  ran += 1
  // 夹具逐字：a=0.5, b=0.3, S_max=30；S 从 **1** 起重复 **3** 次
  const got = strength.strengthAfterRepeats(1, 3)
  assert.ok(
    near(got, 5.059273),
    `a=0.5,b=0.3,Smax=30，S 从 1 起 3 次重复 ⇒ 应 5.059273（绝对差 ≤1e-6），实测 ${got}（${f6(got)}）`,
  )
  // 逐步值（可复算链）：1 → 2.373060 → 3.726284 → 5.059273
  const s1 = strength.strengthAfterRepeat(1)
  const s2 = strength.strengthAfterRepeat(s1)
  assert.ok(near(s1, 2.37306), `第 1 次重复后 S 应 2.373060，实测 ${s1}`)
  assert.ok(near(s2, 3.726284), `第 2 次重复后 S 应 3.726284，实测 ${s2}`)
  assert.equal(strength.strengthAfterRepeats(1, 0), 1, 'n=0 必须逐位返回 s0（不得返回 S_max/undefined）')
  // 参数缺省必须来自 params（单一出处），不是调用点自带魔数
  assert.equal(PAVLIK_A, 0.5)
  assert.equal(PAVLIK_B, 0.3)
  assert.equal(S_MAX, 30)

  // ── 扰动腿 1：动 a ──
  assert.ok(
    !near(strength.strengthAfterRepeats(1, 3, { a: 0.4 }), 5.059273),
    '扰动 a=0.4 ⇒ 3 次重复必须偏离 5.059273（否则说明 a 被忽略/硬编码）',
  )
  // ── 扰动腿 2：动 b ──
  assert.ok(!near(strength.strengthAfterRepeats(1, 3, { b: 0.5 }), 5.059273), '扰动 b=0.5 ⇒ 必须偏离锚点')
  // ── 扰动腿 3：动 S_max ──
  assert.ok(!near(strength.strengthAfterRepeats(1, 3, { sMax: 40 }), 5.059273), '扰动 S_max=40 ⇒ 必须偏离锚点')
  // ── 扰动腿 4：重复次数（3 → 2）──
  assert.ok(!near(strength.strengthAfterRepeats(1, 2), 5.059273), '扰动次数 3→2 ⇒ 必须偏离锚点')
  // ── ⚠ 本席实测到的**真缺陷**：裸公式 `ΔS = a·(S_max−S)^b` **会越过 S_max** ──
  //     解 a·(S_max−S)^b > S_max−S ⟺ S > S_max − a^(1/(1−b))；夹具值 = 30 − 0.37149857 = 29.6285014
  const deltaStar = S_MAX - Math.pow(PAVLIK_A, 1 / (1 - PAVLIK_B))
  assert.ok(
    near(deltaStar, 29.62850142771576, 1e-9),
    `越界阈值 S* = S_max − a^(1/(1−b)) 应 29.6285014，实测 ${deltaStar}`,
  )
  const rawOvershoot = strength.strengthDeltaRaw(29.9)
  assert.ok(
    near(rawOvershoot, 0.250594, 1e-6),
    `裸公式在 S=29.9 处的 ΔS 应 0.250594，实测 ${rawOvershoot}`,
  )
  assert.ok(
    29.9 + rawOvershoot > S_MAX,
    `**缺陷登记腿**：裸公式 ΔS 必须能在 S=29.9 处把 S 推出 S_max（实测 S_new=${29.9 + rawOvershoot}）—— ` +
      '若此断言变红，说明"钳位是必需的吗"这条证据被抹掉了（钳位被挪进了 strengthDelta 本体或公式被改）',
  )
  // 判据表公式**逐次**施加且**不钳位**时的真值：第一步越顶，第二步直接 NaN
  // （`Math.pow(负数, 0.3) = NaN`）—— 比"只是越界"更硬：**整条强度链会静默变成 NaN**，
  //  而 NaN 落库后与"没算过"在所有下游比较里都无法区分（本仓「静默失效」的典型形态）。
  const naive = (S) => S + PAVLIK_A * Math.pow(S_MAX - S, PAVLIK_B)
  const once = naive(29.9)
  assert.ok(once > S_MAX, `不钳位的第一步必须越顶（实测 ${once} > ${S_MAX}）`)
  assert.ok(
    Number.isNaN(naive(once)),
    `不钳位的第二步必须得 NaN（实测 ${naive(once)}）—— 越顶后再施加一次即 \`(S_max−S)^b\` 取负底数`,
  )
  // 而本包实现必须**永不**产出 NaN 或越界（同一起点、同一参数）
  let guarded = 29.9
  for (let i = 0; i < 50; i += 1) guarded = strength.strengthAfterRepeat(guarded)
  assert.ok(Number.isFinite(guarded) && guarded <= S_MAX, `带余量约束的实现必须永不 NaN/越界，实测 ${guarded}`)

  // 带余量约束（本包实现）：S_new ≤ S_max 恒成立，且**不得**改变 A3-4 锚点
  assert.ok(
    near(strength.strengthAfterRepeat(29.9, { a: 0.5, b: 0.3, sMax: 30 }), S_MAX, 1e-12),
    `带余量约束后 S=29.9 一次重复应恰落到 S_max，实测 ${strength.strengthAfterRepeat(29.9)}`,
  )
  let s = 1
  for (let i = 0; i < 200; i += 1) s = strength.strengthAfterRepeat(s)
  assert.ok(s <= S_MAX, `任意次重复后 S 必须 ≤ S_max，实测 ${s}`)
  assert.ok(s > S_MAX - 1e-9, `重复足够多次应趋近 S_max，实测 ${s}`)
  // 钳位**不得**改锚点：夹具三步的余量（29 / 27.6269 / 26.2737）远大于对应 ΔS（1.3731 / 1.3532 / 1.3330）
  // ⇒ min() 一次都不生效 ⇒ 结果必须与"无钳位"逐位相同。
  // ⚠ 与 6 位小数的锚点比只能用 **1e-6**（锚点本身是四舍五入值，真值 5.059272771296496 与 5.059273
  //   已差 2.3e-7）；"逐位不变"要用**同一条无钳位路径**去比才成立（下一行）。
  assert.ok(near(got, 5.059273), '余量约束不得改变 A3-4 锚点（孔径按判据表 = 1e-6）')
  const unclamped = [1, 2, 3].reduce((s) => s + strength.strengthDelta(s), 1)
  assert.equal(
    got,
    unclamped,
    `钳位在夹具路径上**必须一次都不生效**（逐位相等）：钳位后 ${got} vs 无钳位 ${unclamped}`,
  )
  assert.ok(got < S_MAX, '夹具终点须远在 S_max 之内（否则上一条的相等会因钳位巧合而假绿）')
})

// ══ ② A3-4：retention 锚点 + 与 long-term 的 decay **同核**（不是两套曲线）══════
test('② A3-4．retention(S=7) 两锚点 + 与 long-term 的 decay 同核（逐点等价）', async () => {
  ran += 1
  const r7 = retentionMod.retention(7, 7)
  const r14 = retentionMod.retention(14, 7)
  assert.ok(near(r7, 0.367879), `retention(t=7d, S=7) 应 0.367879，实测 ${r7}`)
  assert.ok(near(r14, 0.135335), `retention(t=14d, S=7) 应 0.135335，实测 ${r14}`)
  assert.equal(retentionMod.retention(0, 7), 1, 'decay/retention 的 t=0 必须恰为 1')

  // h = S·ln2 是「同一个核」的代数证据：retention(t,S) 恒等于 decay(t, S·ln2)
  const { decay } = await import(new URL('long-term/src/decay.ts', ROOT).href)
  assert.ok(
    near(retentionMod.equivalentHalfLifeDays(7), 4.85203, 1e-5),
    `S=7 ⇒ 等价半衰期 h=S·ln2=4.852030，实测 ${retentionMod.equivalentHalfLifeDays(7)}`,
  )
  for (const S of [1, 3, 7, 14, 30]) {
    for (const t of [0, 0.5, 1, 7, 14, 90]) {
      const a = retentionMod.retention(t, S)
      const b = decay(t, retentionMod.equivalentHalfLifeDays(S))
      assert.ok(
        near(a, b, 1e-15),
        `同核腿：retention(${t},${S})=${a} 必须逐位等于 decay(${t}, S·ln2)=${b}（相对差须 ≤1e-15）`,
      )
    }
  }
  // 走**真对象**的通道（retentionWith）也必须同值 —— 它才是装配期用的那条路
  const viaKernel = retentionMod.retentionWith({ decay }, 7, 7)
  assert.ok(near(viaKernel, r7, 1e-15), `retentionWith(kernel,7,7) 应等于闭式 ${r7}，实测 ${viaKernel}`)

  // ── ⚠ 与 A1-5 的 decay(14)=0.5 **不同源**：证明本包没有把 h=14 当成自己的口径
  assert.ok(near(decay(14, ltm.HALF_LIFE_DAYS), 0.5), 'long-term 真源 decay(14,14) 应 0.5（A1-5 锚点）')
  assert.ok(
    !near(retentionMod.retention(14, 7), 0.5),
    'retention(14;S=7) 必须**不等于** decay(14)=0.5 —— 若相等，说明本包把 long-term 的半衰期当成了自己的 S（两口径被合并）',
  )
  // 半衰期常量只有一个出处：本包**不得**重定义它
  const srcs = ['params.ts', 'retention.ts', 'strength.ts', 'archive.ts', 'prune.ts', 'index.ts', 'criteria.ts']
  for (const f of srcs) {
    const txt = readFileSync(new URL(f, SRC), 'utf8')
    assert.ok(
      !/HALF_LIFE_DAYS\s*=/.test(txt),
      `${f} 里出现了 HALF_LIFE_DAYS 的**重定义** —— 半衰期唯一出处在 long-term/src/params.ts:54（C14 唯一写者）`,
    )
  }

  // ── 扰动腿：非法输入必须抛（不得静默容错成"看起来合理的数"）──
  assert.throws(() => retentionMod.retention(-1, 7), /不得为负/, 't<0（时钟回拨）必须抛，不得给出 >1 的假留存率')
  assert.throws(() => retentionMod.retention(7, 0), /正有限数/, 'S=0 必须抛（否则得 Infinity）')
  assert.throws(() => strength.strengthAfterRepeat(S_MAX + 1), /不得大于 S_max/, 'S>S_max 必须抛（实数域无定义）')
  assert.throws(() => strength.strengthDeltaRaw(S_MAX + 1), /不得大于 S_max/, '裸公式在越界输入上必须抛（不得静默 NaN）')
  assert.throws(() => strength.strengthAfterRepeat(-1), /不得为负/, 'S<0 必须抛')
})

// ══ ③ 四区间：边界逐字 + 铺满 ℝ 且两两不交 ══════════════════════════════════
test('③ 四区间边界逐字（A>τ+1 / τ<A≤τ+1 / τ−0.5<A≤τ / A≤τ−0.5）+ 铺满且不交', () => {
  ran += 1
  const tau = -2
  /**
   * ⚠ **边界必须写成字面量**（τ+1.0 → **-1.0**、τ−0.5 → **-2.5**），**不得**写成
   *   `tau + A_STRONG_MARGIN` 这类"用被测常量反算期望值"的形式 —— 那样改常量时期望值跟着走，
   *   判据**恒绿**（自指）。本席第一版就是那么写的，实测：把 `A_RETIRE_MARGIN` 由 0.5 改成 0.4
   *   后本用例仍全绿 ⇒ 此腿**当时根本没在检查边界**。现改为照抄判据表原文的四个数。
   */
  const strong = -1.0 // 判据表 docs/mana-rollout-plan.md:547 ②「A>τ+1.0」，τ=−2
  const floor = -2.5 // 判据表同处「A≤τ−0.5」，τ=−2
  assert.equal(tau + A_STRONG_MARGIN, strong, `注册常量必须与判据表字面量一致：τ+1.0 应 ${strong}`)
  assert.equal(tau - A_RETIRE_MARGIN, floor, `注册常量必须与判据表字面量一致：τ−0.5 应 ${floor}`)
  shimSelfCheck() // 对照物自检（放在用例体内，使失败可归属）
  const at = (a) => archive.classify('m', a, tau).interval
  // 边界点必须**逐字**落在判据表写的那一侧
  assert.equal(at(strong + 1e-12), 'hot', `A 略大于 τ+1.0 必须 hot（实测 ${at(strong + 1e-12)}）`)
  assert.equal(at(strong), 'warm', `A = τ+1.0 **恰在 warm**（判据写 τ<A≤τ+1.0，右闭）`)
  assert.equal(at(tau + 1e-12), 'warm', `A 略大于 τ 必须 warm`)
  assert.equal(at(tau), 'declining', `A = τ **恰在 declining**（τ−0.5<A≤τ，右闭）`)
  assert.equal(at(floor + 1e-12), 'declining', `A 略大于 τ−0.5 必须 declining`)
  assert.equal(at(floor), 'archive', `A = τ−0.5 **恰在 archive**（A≤τ−0.5，闭）`)
  // 无穷大是合法输入（long-term 的两个极点）
  assert.equal(at(Number.NEGATIVE_INFINITY), 'archive', 'A=-Infinity（未编码）必须落 archive')
  assert.equal(at(Number.POSITIVE_INFINITY), 'hot', 'A=+Infinity 必须落 hot')
  assert.throws(() => archive.classify('m', Number.NaN, tau), /NaN/, 'A=NaN 必须抛（它不属于任何区间）')

  // 铺满 + 不交：在 τ±2 上以 1e-3 步长扫，每个采样点**恰好**一个归属
  const names = new Set()
  let n = 0
  for (let a = tau - 2; a <= tau + 2; a += 1e-3) {
    const c = archive.classify('m', a, tau)
    names.add(c.interval)
    n += 1
  }
  assert.equal(n, 4001, `扫描点数应为 4001，实测 ${n}（本腿自身失效即红）`)
  for (const want of ['hot', 'warm', 'declining', 'archive']) {
    assert.ok(names.has(want), `四区间必须各被采样到，缺 ${want}（表被改窄/改坏）`)
  }

  // ── 扰动腿：把**归档边界**挪 0.1 ⇒ 边界邻域内的归属必须翻转 ──
  // ⚠ 这里刻意不用「把 τ 挪 0.1」当扰动：挪 τ 会把**三条线整体**平移，导致两侧同时变化，
  //   归因不干净（本席第一版就是这么写的，断言方向写反过一次）。
  //   正确的对照是**只动归档余量这一个数**，看 A_RETIRE_MARGIN 是否真的在判定里起作用。
  const probeA = floor + 0.05 // 现边界（τ−0.5）**上方** 0.05 ⇒ declining
  assert.equal(archive.classify('m', probeA, tau).interval, 'declining', '基准：A=τ−0.45 在 declining')
  // 只把余量从 0.5 挪到 0.4（等价于归档线上移到 τ−0.4）⇒ 同一点必须翻到 archive
  const shifted = archiveShim.classifyWithMargin('m', probeA, tau, 0.4)
  assert.equal(
    shifted,
    'archive',
    `扰动归档余量 0.5 → 0.4 ⇒ A=τ−0.45 必须从 declining 翻到 archive，实测 ${shifted}（不翻 ⇒ 余量没真的进判定）`,
  )
  // 反向：把余量挪大（0.6 ⇒ 归档线下移到 τ−0.6）⇒ 原边界点 A=τ−0.5 必须**离开** archive
  const shifted2 = archiveShim.classifyWithMargin('m', floor, tau, 0.6)
  assert.equal(
    shifted2,
    'declining',
    `扰动归档余量 0.5 → 0.6 ⇒ A=τ−0.5 必须从 archive 翻到 declining，实测 ${shifted2}`,
  )
  // 注册表登记值必须**就是**判定里用的那个（否则"可配置"是空话）
  assert.equal(criteria.thresholdValue('forgetting.archive.retireMargin'), A_RETIRE_MARGIN)
})

// ══ ④ 阈值注册表：登记项必须**真被消费**（登记 ≠ 被读）═════════════════════════
test('④ 包内阈值注册表：条目齐全 + 值真被消费 + 未校准项可枚举', () => {
  ran += 1
  const reg = criteria.CRITERIA_REGISTRY
  assert.equal(reg.kind, 'criteria-registry')
  // 四区间边界 + A3-4 三参数 + 留存上限 + 修剪阈值 + τ 降级缺省，逐个必须在册
  const must = [
    'forgetting.archive.strongMargin',
    'forgetting.archive.retireMargin',
    'forgetting.archive.retentionDays',
    'forgetting.prune.scoreThreshold',
    'forgetting.tauFallback',
    'forgetting.strength.a',
    'forgetting.strength.b',
    'forgetting.strength.sMax',
  ]
  for (const id of must) {
    const e = criteria.criteriaEntry(id)
    assert.ok(e.owner.length > 0, `${id} 必须登记 owner`)
    assert.equal(typeof e.conclusion, 'string', `${id} 必须登记 conclusion`)
    assert.ok(e.recheck.length > 0, `${id} 必须登记复检条件`)
  }
  assert.throws(() => criteria.criteriaEntry('forgetting.nope'), /未登记/, '拼错的 id 必须抛，不得回 undefined')

  // 值 = 单源：注册表值必须**就是** params 当前值（两处漂移即红）
  // ⚠ **诚实标注**：`registryMatchesParams()` 本身是**同一模块加载期内**的比较（注册表条目就是
  //   用 params 的当前值构造的）⇒ 它单靠自己是**恒真**的。故下面并列**字面量锚**（照抄判据表原文），
  //   把"注册表数值真的是判据表要求的那几个"钉死；只留 const 对比等于没查。
  const cons = criteria.registryMatchesParams()
  assert.ok(cons.ok, `注册表与 params 不一致：${cons.mismatches.join(', ')}`)
  assert.equal(criteria.thresholdValue('forgetting.archive.strongMargin'), 1.0, '强激活余量必须是判据表字面量 1.0（τ+1.0）')
  assert.equal(criteria.thresholdValue('forgetting.archive.retireMargin'), 0.5, '归档余量必须是判据表字面量 0.5（τ−0.5）')
  assert.equal(criteria.thresholdValue('forgetting.strength.a'), 0.5, 'A3-4 夹具 a 必须是字面量 0.5')
  assert.equal(criteria.thresholdValue('forgetting.strength.b'), 0.3, 'A3-4 夹具 b 必须是字面量 0.3')
  assert.equal(criteria.thresholdValue('forgetting.strength.sMax'), 30, 'A3-4 夹具 S_max 必须是字面量 30')
  assert.equal(A_STRONG_MARGIN, 1.0, 'params.A_STRONG_MARGIN 必须是判据表字面量 1.0')
  assert.equal(A_RETIRE_MARGIN, 0.5, 'params.A_RETIRE_MARGIN 必须是判据表字面量 0.5')

  // **消费腿**：走 readPort 读到的值必须与运行时判定一致（改注册表 ⇒ 判定跟着变的前提）
  const v = criteria.thresholdValue('forgetting.archive.retireMargin')
  assert.equal(archive.classify('m', -2 - v, -2).interval, 'archive', '用注册表值算出的归档线必须与 classify 一致')

  // **写入必须抛**（注册表不可被运行期静默改写）
  assert.throws(() => {
    reg.entries[0].value = 999
  }, '注册表必须冻结：写入即抛（否则"改了注册表"与"没改"不可分辨）')
  assert.throws(() => {
    reg.entries.push({})
  }, '注册表数组必须冻结')

  // 未校准项必须**可枚举**（不是"没超标"就完事）
  const un = criteria.uncalibratedIds()
  assert.ok(un.includes('forgetting.prune.scoreThreshold'), '修剪评分阈值必须登记为未校准（samples=0）')
  assert.ok(un.includes('forgetting.archive.retentionDays'), '留存上限必须登记为未校准（否则「没超标」与「阈值没定」同形）')
  assert.equal(criteria.thresholdStatus('forgetting.strength.a').calibrated, true, 'A3-4 夹具参数是预注册且有据的 ⇒ calibrated')

  // 「声称已校准」与「样本数」必须一致（防止一个 false→true 就能翻闸）
  const cc = criteria.calibrationConsistency()
  assert.ok(cc.ok, `校准声明与样本数不一致：${cc.reason}`)
})

// ══ ⑤ 修剪视图：**只读**（结构性断言，含其边界如实声明）══════════════════════
test('⑤ 修剪视图只读：不写库 + 无写手势 + 冻结 + 无时钟/RNG + 与归档同源', () => {
  ran += 1
  const items = [
    { memoryId: 'a', activation: -2.4 }, // 线上方（declining）
    { memoryId: 'b', activation: -2.6 }, // 已跌破归档线
    { memoryId: 'c', activation: -0.5 }, // hot
    { memoryId: 'd', activation: -2.6, retired: true }, // 已退役 ⇒ 不入候选
  ]
  const view = prune.pruneCandidates(items, -2)
  assert.equal(view.view, 'read-only', "view 必须恰为 'read-only'")
  assert.equal(view.writes, false, 'writes 必须恰为 false')
  assert.equal(view.inputCount, 4, '输入量必须显式回报（含 0 的情形）')
  assert.equal(view.belowLineCount, 1, 'belowLineCount 只数**未退役**的（与 candidates 同口径：还剩几条待处理）')
  assert.equal(view.retiredBelowLineCount, 1, '已退役且跌破线的必须**单列**（否则"已处理完"与"压根没进来"合成一个数）')
  assert.equal(
    view.belowLineCount + view.retiredBelowLineCount,
    2,
    '两者之和 = 全部跌破线条目数（输入量守恒：d 没有因为被过滤就消失）',
  )
  const ids = view.candidates.map((c) => c.memoryId)
  assert.deepEqual(ids, ['b'], `候选应为 ['b']（a 未跌破线、c 在 hot、d 已退役），实测 ${JSON.stringify(ids)}`)
  assert.ok(view.candidates.every((c) => c.retired === false), '候选里不得出现已退役条目')

  // 与归档**同源**：候选集合必须恰等于 archive.retireCandidates（视图不是第二套判据）
  const viaArchive = archive.retireCandidates(items, -2).map((c) => c.memoryId)
  assert.deepEqual(ids, viaArchive, `修剪候选必须与四区间归档候选**同源**；视图=${JSON.stringify(ids)} vs 归档=${JSON.stringify(viaArchive)}`)
  // ⚠ 这条判据是**回归腿**：本席第一版里 retireCandidates **没有**过滤已退役，
  //   于是它与视图给出不同清单（["b","d"] vs ["b"]）—— 「修剪是四区间之上的视图」在数据上不成立。
  //   修法 = 按 A3-2 ① 的 SQL 形状（`AND retired=0`，docs/mana-rollout-plan.md:558）过滤。
  //   下面两条把「两个数分列、不合成一个」钉住。
  assert.equal(archive.archiveIntervalRows(items, -2).length, 2, '归档区间全部行（含已退役）应 2 条')
  assert.equal(archive.retireCandidates(items, -2).length, 1, '归档**候选**必须只含 retired=0 的（对齐 A3-2 ①）')
  assert.notEqual(
    archive.archiveIntervalRows(items, -2).length,
    archive.retireCandidates(items, -2).length,
    '两口径在"有已退役行"时必须可分辨（相等则说明过滤被抹掉，A3-2 ① 与 ③ 会互相顶替）',
  )

  // 冻结：调用方改不动内部状态
  assert.throws(() => {
    view.candidates.push({})
  }, '返回值必须冻结（数组 push 即抛）')
  assert.throws(() => {
    view.tau = 99
  }, '返回值必须冻结（字段写入即抛）')

  // 无时钟 / 无 RNG：同一输入两次调用必须逐位同构
  const again = prune.pruneCandidates(items, -2)
  assert.equal(JSON.stringify(again), JSON.stringify(view), '同一输入两次调用必须逐位相同（无时钟、无 RNG）')

  // **结构性只读腿**（见 src/prune.ts 文件头对「改成会写库的版本 ⇒ 报红」这一要求的边界声明）：
  // 源码里不得出现任何写手势。把实现换成会写库的版本时，这些符号必然出现 ⇒ 立即报红。
  // ⚠ **剥注释后判定**（本仓先例：test-epoch-watermark ⑥「剥注释后判定，防假修」）：
  //   文件头为了解释"只读保证的边界"必须**提到** DatabaseSync 之类的符号；
  //   若连注释一起扫，那条断言就会逼着作者把解释删掉（判据逼人写坏文档），
  //   而不剥注释则可以把写手势藏进注释之外的任何地方 —— 两难的正确解法是剥注释。
  const raw = readFileSync(new URL('prune.ts', SRC), 'utf8')
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  // 自证：剥离必须真的发生了（否则正则失效会让整段断言**平凡通过** = 假绿）
  assert.ok(stripped.length < raw.length, `剥注释必须真的剥掉内容（raw=${raw.length} stripped=${stripped.length}）`)
  assert.ok(!stripped.includes('只读候选视图'), '剥注释后不应仍含注释专有文字（剥离失效即红）')
  assert.ok(stripped.includes('pruneCandidates'), '剥注释后实现体必须仍在（剥离过度会把代码也删掉）')
  for (const banned of ['DatabaseSync', 'node:sqlite', 'ctx.', 'prepare(', 'INSERT ', 'UPDATE ', 'DELETE ', 'exec(']) {
    assert.ok(
      !stripped.includes(banned),
      `prune.ts 的**代码**（剥注释后）不得出现写手势 / 句柄符号「${banned}」—— 修剪视图必须结构性只读`,
    )
  }
  // 静态 import 面也不得触及任何写库模块
  const importLines = stripped.split('\n').filter((l) => /^\s*import\b/.test(l))
  assert.ok(importLines.length > 0, '剥注释后应当仍能读到 import 行（否则本腿看不到任何东西 = 假绿）')
  for (const line of importLines) {
    assert.ok(
      !/mana-core|sqlite|core\/src/.test(line),
      `prune.ts 的 import 不得触及写库面，实测：${line.trim()}`,
    )
  }

  // ── 扰动腿：评分档**缺省不启用**；显式给值而未给评分表 ⇒ 抛（不静默忽略）
  assert.equal(view.scoreThreshold, null, '缺省不得启用评分档（该阈值无本机基线，samples=0）')
  assert.equal(view.scoreThresholdCalibrated, false, '评分档一律如实回报未校准')
  assert.throws(
    () => prune.pruneCandidates(items, -2, { scoreThreshold: 0.7 }),
    /scores/,
    '给了 scoreThreshold 却没给 scores ⇒ 必须抛（静默忽略一个显式阈值 = 把"档没生效"与"不满足条件"混成一件事）',
  )
  const scored = prune.pruneCandidates(items, -2, { scoreThreshold: 0.7, scores: { a: 0.9 }, includeBelowLine: false })
  assert.deepEqual(
    scored.candidates.map((c) => [c.memoryId, c.reason]),
    [['a', 'score-threshold']],
    '评分档只列出阈值以上的条目，且 reason 必须可枚举',
  )
  assert.equal(scored.scoreThresholdCalibrated, false, '评分档未校准也必须如实回报')
})

// ══ ⑥ 归档留存上限：三态，且**未校准 ≠ ok**（落地册:520 明文）══════════════════
test('⑥ 留存上限三态（ok / over / uncalibrated）+ 未校准不得读成通过', () => {
  ran += 1
  const now = Date.parse('2026-09-25T00:00:00.000Z')
  const ledger = (oldest, rows = 3) => ({ archivedRows: rows, oldestArchivedAt: oldest, newestArchivedAt: oldest })
  const iso = (daysAgo) => new Date(now - daysAgo * 86_400_000).toISOString()

  // 缺省档位来自 params（不是调用点魔数）
  assert.equal(params.ARCHIVE_RETENTION_DEFAULT_DAYS, params.S_MAX, '缺省上限必须 = S_max（借用已有上界常数，不新造魔数）')
  assert.equal(params.ARCHIVE_RETENTION_CALIBRATED, false, '未校准状态必须显式登记（不得默认已校准）')

  // 三态
  const over = archive.capStatus(ledger(iso(31)), now, 30, true)
  assert.equal(over.status, 'over', `31d > 30d 必须 over，实测 ${over.status}`)
  const ok = archive.capStatus(ledger(iso(29)), now, 30, true)
  assert.equal(ok.status, 'ok', `29d ≤ 30d 且已校准 ⇒ ok，实测 ${ok.status}`)
  const un = archive.capStatus(ledger(iso(29)), now, 30, false)
  assert.equal(un.status, 'uncalibrated', `未校准 ⇒ 必须 uncalibrated（**不得**回 ok），实测 ${un.status}`)
  const none = archive.capStatus(ledger(iso(29)), now, null, true)
  assert.equal(none.status, 'uncalibrated', '未配置上限 ⇒ 必须 uncalibrated（"没设上限"不得读成"没超"）')
  assert.equal(archive.capStatus(ledger(null, 0), now, 30, false).status, 'uncalibrated', '无归档 + 未校准 ⇒ 仍是 uncalibrated')
  assert.equal(archive.capStatus(ledger(null, 0), now, 30, true).status, 'ok', '无归档 + 已校准 ⇒ ok')

  // over 优先于 uncalibrated（真越界是硬事实，不该被"未校准"盖住）
  assert.equal(archive.capStatus(ledger(iso(99)), now, 30, false).status, 'over', '越界必须压过"未校准"（否则真越界被静默吞掉）')

  // 每条读数必须带**人类可读归因**（不得只回一个布尔）
  for (const r of [over, ok, un, none]) {
    assert.ok(r.reason.length > 0, 'capStatus 必须给 reason')
  }

  // ── 扰动腿 1：把上限从 30 挪到 60 ⇒ 同一条账目从 over 翻成 ok ──
  assert.equal(archive.capStatus(ledger(iso(31)), now, 60, true).status, 'ok', '扰动上限 30→60 ⇒ 31d 必须翻成 ok')
  // ── 扰动腿 2：now 前移 10 天 ⇒ 同一条账目从 ok 翻成 over（证明判定真的用了 now）──
  assert.equal(
    archive.capStatus(ledger(iso(29)), now + 10 * 86_400_000, 30, true).status,
    'over',
    '扰动 now +10d ⇒ 29d 的条目变 39d 必须翻成 over',
  )
  // ── 扰动腿 3：非法上限必须抛 ──
  assert.throws(() => archive.capStatus(ledger(iso(1)), now, 0), /正有限数/, 'capDays=0 必须抛（不得当成"无上限"）')
  assert.throws(() => archive.capStatus(ledger(iso(1)), now, -5), /正有限数/, 'capDays<0 必须抛')
})

// ══ ⑦ 依赖方向：τ 降级缺省与 long-term 真源**同值**（同源腿）═════════════════
test('⑦ 依赖方向订正：inject 只声明 mana-core；τ 降级缺省与 long-term 真源同值', async () => {
  ran += 1
  const mod = await load('index.ts')
  assert.deepEqual(mod.inject, ['mana-core'], `inject 必须恰为 ['mana-core']（落地册 §2.1 依赖方向订正），实测 ${JSON.stringify(mod.inject)}`)
  assert.ok(!mod.inject.includes('mana-long-term'), 'inject 不得硬依赖 long-term（那正是原方案反了的依赖方向）')
  // 同源腿：降级缺省必须**逐位等于** long-term 真源的 τ
  assert.equal(
    TAU_FALLBACK,
    ltm.TAU,
    `本包 τ 降级缺省 ${TAU_FALLBACK} 必须等于 long-term 真源 TAU=${ltm.TAU}（不等即两处各说各话）`,
  )
  // 半衰期同理：本包不重定义，只在有需要时读 long-term 的真源
  assert.equal(ltm.HALF_LIFE_DAYS, 14, 'long-term 的半衰期真源须仍为 14（A1-5 冻结）')
  const readme = readFileSync(new URL('params.ts', SRC), 'utf8')
  assert.ok(
    !/decay\s*\(/.test(readme.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')),
    '本包 params.ts 的**代码**（非注释）里不得出现对 decay( 的调用 —— 曲线只有 retention.ts 一处',
  )
})

// ══ ⑧ 真装配：服务面可复算锚点 + behavior=active + 卸载后服务消失 ═════════════
test('⑧ 真装配：服务面可复算 A3-4 锚点 + behavior=active + 卸载后服务消失', async () => {
  ran += 1
  const ctx = new Context()
  const core = await import(new URL('core/src/index.ts', ROOT).href)
  const mod = await load('index.ts')
  ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-b42-')), 'mana.db') })
  await settle(220)
  const fiber = ctx.plugin(mod)
  await settle(300)

  const svc = ctx.get('mana-forgetting')
  assert.ok(svc, 'mana-forgetting 服务必须可读（未 provide = 插件没真跑起来）')
  assert.equal(svc.status().behavior, 'active', "B4.2 已填实现 ⇒ behavior 必须为 'active'")
  assert.ok(svc.forgetting, '服务面必须挂 forgetting 纯函数面')

  // 服务面复算锚点（**不经 src 直读**：走装配期那条路）
  const f = svc.forgetting
  assert.ok(near(f.strengthAfterRepeats(1, 3), 5.059273), `服务面 S(3)=${f.strengthAfterRepeats(1, 3)} 应 5.059273`)
  assert.ok(near(f.retention(7, 7), 0.367879), `服务面 retention(7,7)=${f.retention(7, 7)} 应 0.367879`)
  assert.ok(near(f.retention(14, 7), 0.135335), `服务面 retention(14,7)=${f.retention(14, 7)} 应 0.135335`)
  assert.equal(f.classify('m', -2.5, -2).interval, 'archive', '服务面 classify(A=τ−0.5) 必须落 archive')

  // 读数必须**如实**回报核的来源（本次未装 long-term ⇒ fallback）
  const rd = f.readings()
  assert.equal(rd.kernelSource, 'fallback', `未装 long-term ⇒ kernelSource 必须 'fallback'，实测 ${rd.kernelSource}`)
  assert.equal(rd.tauSource, 'fallback', '未装 long-term ⇒ tauSource 必须 fallback')
  assert.equal(rd.tau, TAU_FALLBACK, `降级 τ 必须 = ${TAU_FALLBACK}，实测 ${rd.tau}`)
  assert.ok(Array.isArray(rd.uncalibrated) && rd.uncalibrated.length > 0, '未校准项必须可从读数拿到')
  assert.equal(f.calibrationConsistency().ok, true, '校准声明与样本数必须一致')

  // 卸载即净
  await fiber.dispose()
  await settle(320)
  assert.equal(ctx.get('mana-forgetting'), undefined, '卸载后服务必须消失（"卸载即净"）')
})

// ══ ⑨ 复用 long-term 的核：真装上 long-term 后 kernelSource 必须翻面 ══════════
test('⑨ 可选依赖生效：装上 long-term 后走它的 decay 且读数翻面（不是注释承诺）', async () => {
  ran += 1
  const ctx = new Context()
  const core = await import(new URL('core/src/index.ts', ROOT).href)
  const ltmMod = await import(new URL('long-term/src/index.ts', ROOT).href)
  const mod = await load('index.ts')
  ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-b42-lt-')), 'mana.db') })
  await settle(220)
  ctx.plugin(ltmMod)
  await settle(260)
  const fiber = ctx.plugin(mod)
  await settle(300)

  const svc = ctx.get('mana-forgetting')
  assert.ok(svc, '服务须可读')
  const f = svc.forgetting
  const rd = f.readings()
  assert.equal(rd.kernelSource, 'mana-long-term', `装上 long-term ⇒ kernelSource 必须翻成 'mana-long-term'，实测 ${rd.kernelSource}`)
  assert.equal(rd.tauSource, 'mana-long-term', 'τ 必须取自 long-term 真源')
  assert.equal(rd.tau, ltm.TAU, `τ 必须 = long-term 的 ${ltm.TAU}，实测 ${rd.tau}`)
  // 走真核后锚点必须仍满足 **A3-4 的孔径 ≤1e-6**（对 6 位小数的锚点值而言，1e-12 是个**错的**孔径：
  //   锚点 0.367879 本身是四舍五入值，与真值 exp(-1) 已差 4.4e-7 —— 本席第一版就写错过这个数）。
  assert.ok(near(f.retention(7, 7), 0.367879), `走 long-term 核后 retention(7,7)=${f.retention(7, 7)} 必须仍满足 |Δ|≤1e-6`)
  assert.ok(near(f.retention(14, 7), 0.135335), `走 long-term 核后 retention(14,7)=${f.retention(14, 7)} 必须仍满足 |Δ|≤1e-6`)
  // ⚠ 这条才是真正的"同一条曲线"证据，用**精确孔径**：两条路在同一点必须逐位同值
  //   （与 6 位小数锚点比只能用 1e-6；与**另一条路的同一算式**比才能用严格相等）
  for (const [t, S] of [[0, 7], [3, 5], [7, 7], [14, 7], [90, 30], [0.5, 2]]) {
    assert.ok(
      near(f.retention(t, S), retentionMod.retention(t, S), 1e-15),
      `真核路径与闭式路径在 (t=${t},S=${S}) 必须逐位同值：${f.retention(t, S)} vs ${retentionMod.retention(t, S)}`,
    )
  }

  await fiber.dispose()
  await settle(200)
})

// ══ ⑩ 实现面非空（反"实现被搬走"的那条腿）════════════════════════════════════
test('⑩ 实现面机检：IMPLEMENTED_EXPORTS 逐个可读 + 真归档三步流程未做部分显式列出', async () => {
  ran += 1
  const mod = await load('index.ts')
  assert.ok(Array.isArray(mod.IMPLEMENTED_EXPORTS) && mod.IMPLEMENTED_EXPORTS.length >= 10, 'IMPLEMENTED_EXPORTS 必须登记实现面')
  for (const n of mod.IMPLEMENTED_EXPORTS) {
    assert.ok(n in mod, `导出面缺 ${n}（实现被搬走/改名而判据没同步 ⇒ 必须红）`)
  }
  // 三步流程：未做的两步必须**显式列出**，不得静默略过
  const plan = archive.retirementPlan()
  assert.equal(plan.step1, 'candidate-listing')
  assert.equal(plan.step2, 'unimplemented', 'A3-2 第②步（压缩）尚未实现 ⇒ 必须如实标 unimplemented')
  assert.equal(plan.step3, 'unimplemented', 'A3-2 第③步（归档行排除出检索）尚未实现 ⇒ 必须如实标 unimplemented')
  assert.ok(plan.unimplemented.length >= 3, '未实现项必须逐条列出（不得只给一个布尔）')
  assert.ok(
    plan.unimplemented.some((s) => s.includes('retired')),
    '未实现项里必须点名 retired 置位（那是"标记 ≠ 归档"的关键缺口）',
  )
})

// ══ ⑪ 用例计数自检（防本文件被截断/删用例）════════════════════════════════════
test('⑪ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
