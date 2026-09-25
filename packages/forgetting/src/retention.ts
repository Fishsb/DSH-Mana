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

/** 一次访问后的**强度**更新入口（本包唯一：Pavlik–Anderson，见 `strength.ts`）。 */
export { strengthAfterRepeat, strengthAfterRepeats, strengthDelta } from './strength.ts'
