/**
 * 留存核（**A3-4 的实现者之一**）—— 艾宾浩斯遗忘曲线 `retention(t) = exp(-t / S)`。
 *
 * 真源（`docs/mana-v5-plan.md:557-561`，逐字）：
 *   ```
 *   retention(t) = exp(-t / S)
 *     t = 距上次访问的时间
 *     S = 记忆强度（随重复访问增加）
 *   ```
 * 判据锚点（`docs/mana-rollout-plan.md:560`）：`retention(S=7)` 在 `t=7d` 得 `0.367879`、
 *   `t=14d` 得 `0.135335`，绝对差 ≤1e-6。
 *   ⚠ `t` 与 `S` **都是天**（对齐锚点的 `7d/14d`），不是秒。
 *
 * ── ⚠ 与 `long-term` 的 `decay` 的关系（**必须读，否则会以为是重复实现**）────────
 *   两者**不是同一个公式**，但**共享同一个核**。代数上：
 *       `exp(-t/S) = exp(-t·ln2 / (S·ln2))` = `decay(t, h)`，其中 `h = S·ln2`
 *   ⇒ 本包把「半衰期口径」显式化：`equivalentHalfLifeDays(S) = S·ln2`。
 *   `long-term` 的 `decay(t,h)` 里 `h` 是**冻结常数 14 天**（A1-5），本包里 `S` 是**变量**
 *   （每次重复按 Pavlik–Anderson 增长）—— 这正是「间隔重复」与「固定半衰期」的全部差别。
 *   ⇒ 装上了 `long-term` 时，本包**把请求交给它的核**（`retentionWith(kernel, t, S)`），
 *     **不在运行时并存第二条曲线**；没装时才走本文件的闭式（判据 ⑥ 断言两条路逐位一致）。
 *   ⛔ 无论哪条路，`retention` 与 `decay` 都**不得相乘**（C14「同一条记忆被两家乘过」）。
 */

/** 外部衰减核的最小形状（结构类型 —— 不 import long-term 的具体类型，保持依赖方向单向）。 */
export interface DecayKernelLike {
  /** `exp(-t·ln2/h)`，`t` 与 `h` 皆以天计。 */
  decay(t: number, halfLifeDays?: number): number
}

/**
 * 强度 `S` 换算成**等价半衰期**（天）：`h = S·ln2`。
 *
 * 这条等式是「本包与 long-term 不是两套曲线」的**可复算证据**
 * （`retention(t,S) === decay(t, S·ln2)`，判据 ⑥ 在网格上逐点断言）。
 */
export function equivalentHalfLifeDays(s: number): number {
  if (!Number.isFinite(s) || s <= 0) {
    throw new Error(`equivalentHalfLifeDays: S 必须是正有限数（实测 ${String(s)}）`)
  }
  return s * Math.LN2
}

/**
 * 留存率 `retention(t, S) = exp(-t / S)`。
 *
 * ⚠ **为什么不静默容错**（照搬 `long-term/src/decay.ts:17-20` 的 fail-closed 口径）：
 *   `t < 0`（时钟回拨）会给出 `> 1` 的"留存率"，即"比刚访问过还新"——一个**看起来合理的假数**，
 *   会静默污染四区间归档的归属（`A` 被算高 ⇒ 该归档的条目落进"正常保留"）。
 *   `S ≤ 0` 给 `Infinity`/`NaN`。两类都**抛**，由调用方显式决定。
 *
 * @param t 距上次访问的时间（**天**），须 ≥ 0。
 * @param s 记忆强度（**天**），须 > 0；其来源是 `strength.ts` 的 Pavlik–Anderson 更新。
 */
export function retention(t: number, s: number): number {
  if (!Number.isFinite(t)) throw new Error(`retention: t 必须是有限数（实测 ${String(t)}）`)
  if (!Number.isFinite(s) || s <= 0) throw new Error(`retention: S 必须是正有限数（实测 ${String(s)}）`)
  if (t < 0) {
    throw new Error(
      `retention: t 不得为负（实测 ${t}）—— 时钟回拨时公式会给出 >1 的假留存率，静默通过会污染四区间归档`,
    )
  }
  return Math.exp(-t / s)
}

/**
 * 走**外部核**（`long-term` 的 `decay`）的同一曲线：`decay(t, S·ln2)`。
 *
 * 存在的理由：把「本包与 long-term 共享同一个核」从**注释里的说法**变成**可调用的路径**；
 * 判据 ⑥ 在网格上断言它与闭式 `retention` 逐点一致（相对差 ≤1e-15）。
 */
export function retentionWith(kernel: DecayKernelLike, t: number, s: number): number {
  if (!kernel || typeof kernel.decay !== 'function') {
    throw new Error('retentionWith: kernel 必须提供 decay(t, halfLifeDays)')
  }
  return kernel.decay(t, equivalentHalfLifeDays(s))
}

/**
 * A1-5 判据表锚点（`docs/mana-rollout-plan.md:456`，逐字）—— **判据侧的第三个复本**。
 *
 * ⚠ 为什么要把这三个数**落在源码里**（而不是只写在测试与机检器里）：
 *   A1-5 原状是 `HANG`，理由是「须改接真实现后再判」（`tools/a1-check.mjs:871`）；
 *   而机检器的 A1-5 块**从头到尾没有 import 过 `packages/long-term`** ——
 *   它算的是块内**自己内联的闭式**。后果有两条，都是「让失败不可观测」：
 *     ① 真实现（`packages/long-term/src/decay.ts`）算错了锚点，A1-5 照样绿；
 *     ② 判据器的三条分支里**没有一条**能把「真实现算对了」判成 PASS ⇒ 即使改接完成，
 *        该项也**永远绿不了**（挂账成了终态）。
 *   ⇒ 本文件把锚点做成**可被真核求值的读数面**：判据把核注入进来，读数由核算出、
 *     与表值逐点比 —— 「实现算对了」与「闭式抄对了」从此**可分辨**。
 *
 * ⚠ 与 `long-term/src/decay.ts` 的关系（照抄 C14 口径）：锚点值的**真源仍是判据表**，
 *   本常量是它在源码侧的**逐字复本**（测试里另有一份独立字面量表 ⇒ 三处互证，改一处即红）；
 *   曲线本身**不重写** —— 本模块只 `kernel.decay(t)`，核由调用方注入（与 `retentionWith` 同一形态）。
 */
export interface DecayAnchorPoint {
  /** 判据表里的写法（`decay(0)` / `decay(14)` / `decay(90)`）。 */
  readonly label: string
  /** 输入的**天**数。 */
  readonly t: number
  /** 判据表逐字给出的期望值。 */
  readonly expected: number
}

/**
 * A1-5 的三个锚点（`h=14`：`decay(0)=1.000000`、`decay(14)=0.500000`、`decay(90)=0.011609`）。
 *
 * ⚠ 判据表写的是 `decay(14)`（**单参**）⇒ 求值时必须走核的**缺省半衰期**路径，
 *   不得由本模块替调用方补一个 `h`：补了就等于用本模块的猜测替换掉「缺省值真来自 params」这条腿
 *   （`packages/long-term/tests/activation.test.mjs:64-65` 钉的是同一条）。
 */
export const A1_5_ANCHOR_POINTS: readonly DecayAnchorPoint[] = Object.freeze([
  Object.freeze({ label: 'decay(0)', t: 0, expected: 1.0 }),
  Object.freeze({ label: 'decay(14)', t: 14, expected: 0.5 }),
  Object.freeze({ label: 'decay(90)', t: 90, expected: 0.011609 }),
])

/** 一个锚点的**读数**（`got` 由注入的核算出；`ok` 是判定，不是注释）。 */
export interface DecayAnchorReading extends DecayAnchorPoint {
  /** 核算出的值。 */
  readonly got: number
  /** `|got - expected|`；`got` 非有限时取 `Infinity`（**不取 NaN** —— NaN 在所有比较里都假，会与「没算」同形）。 */
  readonly delta: number
  readonly ok: boolean
}

/**
 * 把三个锚点交给**注入的核**求值，返回逐点读数。
 *
 * ── 契约（三条，都是为了让读数可判而不是好看）──────────────────────────────
 *   ① `kernel.decay` **必须存在且是函数** ⇒ 否则**抛**（fail-closed）：返回空读数会让
 *      「核没接上」与「锚点全过」在调用方那里同形 —— 正是本包防的形态。
 *   ② `eps` 必须是非负有限数 ⇒ 否则抛（拿 NaN 当容差会让每个点都判假且不报错）。
 *   ③ 逐点**单参调用** `kernel.decay(t)`（缺省半衰期路径，见 `A1_5_ANCHOR_POINTS` 的 ⚠）。
 *      `got` 非有限（NaN/Infinity）⇒ `ok:false`、`delta:Infinity`，**不抛**：
 *      核算错是**判据要判红的事实**，把它变成异常会让"红"与"判定器崩了"不可分辨。
 *
 * @param kernel 衰减核（`long-term/src/decay.ts` 的 `decay`，或装配期 `ctx.get('mana-long-term')` 的那份）
 * @param eps 绝对差容差，判据表口径 = 1e-6
 */
export function decayAnchorReadings(kernel: DecayKernelLike, eps: number = 1e-6): readonly DecayAnchorReading[] {
  if (!kernel || typeof kernel.decay !== 'function') {
    throw new Error('decayAnchorReadings: kernel 必须提供 decay(t, halfLifeDays?) —— 核没接上时不得返回空读数（那会让"没接上"与"全过"同形）')
  }
  if (!Number.isFinite(eps) || eps < 0) {
    throw new Error(`decayAnchorReadings: eps 必须是 ≥0 的有限数（实测 ${String(eps)}）`)
  }
  return Object.freeze(
    A1_5_ANCHOR_POINTS.map((p) => {
      const got = kernel.decay(p.t)
      const finite = Number.isFinite(got)
      const delta = finite ? Math.abs(got - p.expected) : Number.POSITIVE_INFINITY
      return Object.freeze({ ...p, got, delta, ok: finite && delta <= eps })
    }),
  )
}

/**
 * `decayKernelTeeth()` 的**选项**。两个半衰期都**必填**（不得带缺省）——
 * 缺省会把判据表的 14 偷偷变成实现面的第二个出处（半衰期唯一出处是
 * `packages/long-term/src/params.ts` 的 `HALF_LIFE_DAYS`，本包**不重新定义**它）。
 */
export interface DecayKernelTeethOptions {
  /** 判据表冻结的半衰期（A1-5 = 14 天，由调用方传入）。 */
  readonly frozenHalfLife: number
  /** 探针半衰期（取 `frozenHalfLife / 2` ⇒ `t = frozenHalfLife` 恰跨两个半衰期）。 */
  readonly probeHalfLife: number
  /** 绝对差容差，缺省 1e-6（与判据表同孔径）。 */
  readonly eps?: number
}

/** 单条牙的读数（`id` 是**可枚举**的腿名，不是布尔 —— 面板/判据据此点名）。 */
export interface DecayKernelToothReading {
  readonly id: 'consumes-half-life' | 'rejects-negative-time'
  readonly ok: boolean
  readonly detail: string
}

/** 两条牙的合并读数。 */
export interface DecayKernelTeethReading {
  readonly ok: boolean
  readonly teeth: readonly DecayKernelToothReading[]
  /** 违规摘要（空数组 = 两条牙都成立）。字符串里带**实测值**，便于判据直接印出。 */
  readonly violations: readonly string[]
}

/**
 * **带牙腿的齿 —— 唯一真源**：检验一个衰减核是否**真的**满足两条契约。
 *
 * ── 存在理由（独立审查 c3 席实测，2026-09-26）──────────────────────────────
 *   A1-5 的三条锚点全取在 `t ≥ 0` 且都用**同一个** `h` ⇒ 两种坏核能把三条锚点**全过**：
 *     ① **忽略 `h` 的死旋钮核**（`decay:(t,_h)=>exp(-t·ln2/14)`）—— 与 budgetChars 同一形态；
 *     ② **无 `t<0` guard 的核**。
 *   这两条当时只由包内测试（`long-term/tests/activation.test.mjs`）钉着 ⇒ 判据腿比实现面更弱。
 *   本函数把两条钉成**可复用的读数**：判据腿与包内测试调**同一个**函数，
 *   避免「两处各写一份齿」—— 那正是下一个漂移点。
 *
 * ── 两条牙各自在防什么 ─────────────────────────────────────────────────────
 *   ① `consumes-half-life`：同 `t`、不同 `h` 必须给出**不同**的数，且满足指数半衰期曲线的
 *      **自洽式** `f(t, h₂) = f(t, h₁)^(h₁/h₂)`。只断言「两个数不等」不够：
 *      一个把 `h` 用错（如 h→h²）的核也满足「不等」，自洽式能把它抓住。
 *   ② `rejects-negative-time`：时钟回拨（`t < 0`）时公式会给出 **> 1 的假留存率**
 *      （「比从未衰减还新」）—— 一个**看起来合理的假数**，会静默污染下游排序。
 *      本仓口径是 fail-closed（`long-term/src/decay.ts:29-33` 实测抛错）⇒ **必须抛**，不得静默。
 *
 * ⚠ **本函数只判这两条**，不判三点锚点值（那是 `decayAnchorReadings()` 的活）—— 两条腿各自可归因。
 *
 * @throws kernel 缺 `decay`、或选项非法（frozen/probe 非正有限数、probe ≥ frozen、eps 非 ≥0 有限）
 */
export function decayKernelTeeth(
  kernel: DecayKernelLike,
  options: DecayKernelTeethOptions,
): DecayKernelTeethReading {
  if (!kernel || typeof kernel.decay !== 'function') {
    throw new Error('decayKernelTeeth: kernel 必须提供 decay(t, halfLifeDays?) —— 核没接上时不得返回空读数（那会让「没接上」与「全过」同形）')
  }
  const { frozenHalfLife, probeHalfLife, eps = 1e-6 } = options ?? ({} as DecayKernelTeethOptions)
  if (!Number.isFinite(frozenHalfLife) || frozenHalfLife <= 0) {
    throw new Error('decayKernelTeeth: frozenHalfLife 必须是正有限数（实测 ' + String(frozenHalfLife) + '）')
  }
  if (!Number.isFinite(probeHalfLife) || probeHalfLife <= 0 || probeHalfLife >= frozenHalfLife) {
    throw new Error('decayKernelTeeth: probeHalfLife 必须落在 (0, frozenHalfLife)（实测 ' + String(probeHalfLife) + '）')
  }
  if (!Number.isFinite(eps) || eps < 0) {
    throw new Error('decayKernelTeeth: eps 必须是 ≥0 的有限数（实测 ' + String(eps) + '）')
  }

  const teeth: DecayKernelToothReading[] = []
  const violations: string[] = []

  // ── 牙①：h 参数真被消费 ──────────────────────────────────────────────────
  let t1: DecayKernelToothReading
  try {
    const atFrozen = kernel.decay(frozenHalfLife, frozenHalfLife)
    const atProbe = kernel.decay(frozenHalfLife, probeHalfLife)
    if (!Number.isFinite(atProbe)) {
      t1 = { id: 'consumes-half-life', ok: false, detail: 'kernel(' + frozenHalfLife + ', ' + probeHalfLife + ') 非有限数（实测 ' + String(atProbe) + '）' }
    } else if (atProbe === atFrozen) {
      t1 = {
        id: 'consumes-half-life',
        ok: false,
        detail: 'kernel(t,' + frozenHalfLife + ')=' + atFrozen + ' 与 kernel(t,' + probeHalfLife + ')=' + atProbe + ' **同值** ⇒ halfLifeDays 参数被忽略（死旋钮核）',
      }
    } else {
      // 指数半衰期曲线的自洽式：f(t,h₂) = f(t,h₁)^(h₁/h₂)。
      const expected = Math.pow(atFrozen, frozenHalfLife / probeHalfLife)
      if (Math.abs(atProbe - expected) > eps) {
        t1 = {
          id: 'consumes-half-life',
          ok: false,
          detail: 'kernel(' + frozenHalfLife + ',' + probeHalfLife + ')=' + atProbe + '，自洽式 f(t,h₂)=f(t,h₁)^(h₁/h₂) 期望 ' + expected + '（差 ' + Math.abs(atProbe - expected).toExponential(2) + '）',
        }
      } else {
        t1 = {
          id: 'consumes-half-life',
          ok: true,
          detail: 'h 真被消费：f(' + frozenHalfLife + ',' + frozenHalfLife + ')=' + atFrozen + ' → f(' + frozenHalfLife + ',' + probeHalfLife + ')=' + atProbe + '（自洽式期望 ' + expected + '）',
        }
      }
    }
  } catch (error) {
    t1 = {
      id: 'consumes-half-life',
      ok: false,
      detail: '求值时抛：（' + (error instanceof Error ? error.message : String(error)) + '）⇒ 核在 t≥0 上不得抛',
    }
  }
  teeth.push(Object.freeze(t1))
  if (!t1.ok) violations.push('[consumes-half-life] ' + t1.detail)

  // ── 牙②：t<0 必抛（fail-closed）────────────────────────────────────────────
  const negativeT = -(frozenHalfLife / 2)
  let t2: DecayKernelToothReading
  let threw = false
  let got: number | null = null
  try {
    got = kernel.decay(negativeT, frozenHalfLife)
  } catch {
    threw = true
  }
  if (threw) {
    t2 = { id: 'rejects-negative-time', ok: true, detail: 't<0 必抛：kernel(' + negativeT + ',' + frozenHalfLife + ') 抛错（fail-closed 成立）' }
  } else {
    t2 = {
      id: 'rejects-negative-time',
      ok: false,
      detail: 'kernel(' + negativeT + ',' + frozenHalfLife + ')=' + String(got) + ' **未抛** ⇒ 时钟回拨会给出 >1 的假留存率（本仓 fail-closed 口径要求抛）',
    }
  }
  teeth.push(Object.freeze(t2))
  if (!t2.ok) violations.push('[rejects-negative-time] ' + t2.detail)

  return Object.freeze({ ok: violations.length === 0, teeth: Object.freeze(teeth), violations: Object.freeze(violations) })
}

/** 一次访问后的**强度**更新入口（本包唯一：Pavlik–Anderson，见 `strength.ts`）。 */
export { strengthAfterRepeat, strengthAfterRepeats, strengthDelta } from './strength.ts'
