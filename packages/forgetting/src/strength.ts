/**
 * 间隔重复强度核（**A3-4 的实现者之一**）—— Pavlik & Anderson 2005 更新式。
 *
 * 判据原文（`docs/mana-rollout-plan.md:547` ①，逐字）：`ΔS = a·(S_max − S)^b`
 * 真源（`docs/mana-v5-plan.md:563-566`）：
 *   ```
 *   S_new = S_old + ΔS
 *   ΔS = a · (S_max - S_old)^b
 *   ```
 *
 * 判据锚点（`docs/mana-rollout-plan.md:560`）：夹具 `a=0.5, b=0.3, S_max=30`，
 *   `S` 从 `1` 起重复 **3** 次 ⇒ `5.059273`（本席实跑闭式复算：
 *   `2.3730596466812393 → 3.7262841133501348 → 5.059272771296496`，绝对差 ≤1e-6）。
 *
 * ⚠ **为什么这是「间隔重复」而不是又一套衰减公式**：本文件**不含任何时间项** ——
 *   它只把「本次重复加多少强度」算出来。时间那一半由 `retention()` 承担，
 *   两者是 `retention(t;S)` 的「分子/分母」关系，**不得**再被第三个公式乘一遍
 *   （`docs/mana-rollout-plan.md:503` ③ / `:820` C14）。
 *
 * ⚠ **为什么越界输入抛错而不是钳位**（本仓「静默失效查被吞异常」）：
 *   `S > S_max` 时 `(S_max − S)^b` 在实数域**无意义**（`Math.pow(-1, 0.3) = NaN`）——
 *   静默钳到 `S_max` 会让「强度已经越界」这个事实**不可观测**，正是本仓反复出现的形态。
 *   `S = S_max` 是**合法边界**：`(0)^b = 0` ⇒ `ΔS = 0` ⇒ 饱和，不抛。
 */
import { PAVLIK_A, PAVLIK_B, S_MAX } from './params.ts'

/** Pavlik & Anderson 强度参数（`a` / `b` / `S_max`）。 */
export interface PavlikParams {
  /** 步长 `a`。 */
  readonly a: number
  /** 指数 `b`。 */
  readonly b: number
  /** 强度上界 `S_max`（与 `S` 同单位：天）。 */
  readonly sMax: number
}

/** 参数缺省单调来源 = `params.ts`（唯一出处），故本核无自带魔数。 */
export function pavlikParams(p?: Partial<PavlikParams>): PavlikParams {
  const out: PavlikParams = { a: p?.a ?? PAVLIK_A, b: p?.b ?? PAVLIK_B, sMax: p?.sMax ?? S_MAX }
  if (!Number.isFinite(out.a) || out.a < 0) throw new Error(`pavlikParams: a 必须是 ≥0 的有限数（实测 ${String(out.a)}）`)
  if (!Number.isFinite(out.b) || out.b < 0) throw new Error(`pavlikParams: b 必须是 ≥0 的有限数（实测 ${String(out.b)}）`)
  if (!Number.isFinite(out.sMax) || out.sMax <= 0) {
    throw new Error(`pavlikParams: S_max 必须是正有限数（实测 ${String(out.sMax)}）`)
  }
  return out
}

/**
 * 单步强度增量 `ΔS = a·(S_max − S)^b`（**未加余量约束**；公开别名见 `strengthDeltaRaw`）。
 *
 * @param s 当前强度（**天**），须 `0 ≤ S ≤ S_max`。
 * @param p 参数（缺省读 `params.ts`）。
 * @throws `S` 非有限/为负（`S < 0` 时 `S_max − S > S_max`，公式仍成立但已无物理含义）、
 *   或 `S > S_max`（实数域无定义，见文件头）。
 */
export function strengthDelta(s: number, p?: Partial<PavlikParams>): number {
  const { a, b, sMax } = pavlikParams(p)
  if (!Number.isFinite(s)) throw new Error(`strengthDelta: S 必须是有限数（实测 ${String(s)}）`)
  if (s < 0) throw new Error(`strengthDelta: S 不得为负（实测 ${s}）`)
  if (s > sMax) {
    throw new Error(
      `strengthDelta: S 不得大于 S_max（实测 S=${s} > S_max=${sMax}）—— 越界时 (S_max−S)^b 在实数域无定义` +
        '（Math.pow(负数, 非整数) = NaN），静默钳位会让「已越界」不可观测',
    )
  }
  return a * Math.pow(sMax - s, b)
}

/**
 * **未加余量约束**的原始增量 `ΔS = a·(S_max − S)^b`（逐字照判据表实现）。
 *
 * ⚠ **本函数会越界** —— 这是本席实测到的**真缺陷**，不是本席的保守：
 *   解 `a·(S_max−S)^b > S_max−S` ⟺ `S > S_max − a^(1/(1−b))`。
 *   取夹具 `a=0.5, b=0.3, S_max=30` ⇒ `a^(1/0.7) = 0.3714985722842371` ⇒ **`S > 29.6285014` 起越界**，
 *   峰值在 `S ≈ 29.93` 处给出 `S_new = 30.1536 > S_max`（实跑：
 *   `S=29.9 ⇒ ΔS=0.250594 ⇒ S_new=30.150594`；`S=29.99 ⇒ S_new=30.115594`）。
 *   ⇒ 判据表 `:547` ① 的公式**按字面逐次施加时并不收敛到 `S_max`**，而是越过后回落、再越过。
 *   ⇒ 且越界后再调一次本族函数即为**实数域无定义**（`(S_max−S)^b` 取负底数）。
 *
 * ⚠ 本函数**保留为公开导出**，正是为了让该缺陷**可复现、可回归**：
 *   判据 ① 专门断言它**确实越界**（若哪天有人悄悄加进钳位，"钳位是必需的吗"这条证据就消失了）。
 */
export function strengthDeltaRaw(s: number, p?: Partial<PavlikParams>): number {
  return strengthDelta(s, p)
}

/**
 * 一次重复后的新强度 `S_new = S_old + min(ΔS, S_max − S_old)`。
 *
 * ⚠ **为什么要那个 `min`**（不是"为了让判据变绿"）：
 *   见 `strengthDeltaRaw` 的实测 —— 裸公式在 `S > S_max − a^(1/(1−b))` 时会**越过** `S_max`。
 *   越过之后再施加一次就是 NaN/抛错，**且"强度已越界"这件事在库里看不出来**。
 *   `min` 只做一件事：**每次重复最多把余量吃完**（`S → S_max` 单调、渐近、不越顶）。
 *   ⇒ 它是给公式补上它缺的**余量约束**，不是调数值。
 *
 * ⚠ **对 A3-4 锚点零影响**（夹具三步的余量分别是 29 / 27.63 / 26.27，远大于对应的
 *   ΔS = 1.3731 / 1.3532 / 1.3330）⇒ `S(3 次重复)` 仍恰为 `5.059273`，
 *   由判据 ① 同时断言「钳位存在」与「锚点不变」两条（钳位不是装饰，且不得改锚点）。
 */
export function strengthAfterRepeat(s: number, p?: Partial<PavlikParams>): number {
  const { sMax } = pavlikParams(p)
  const headroom = sMax - s
  return s + Math.min(strengthDelta(s, p), headroom)
}

/**
 * 从 `s0` 起连续重复 `n` 次（A3-4 夹具 `n=3`）。
 *
 * `n = 0` ⇒ 逐位返回 `s0`（**不是**返回 `S_max` 或 `undefined`：本仓「输入量须可见化」）。
 */
export function strengthAfterRepeats(s0: number, n: number, p?: Partial<PavlikParams>): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`strengthAfterRepeats: n 必须是 ≥0 的整数（实测 ${String(n)}）`)
  let s = s0
  for (let i = 0; i < n; i += 1) s = strengthAfterRepeat(s, p)
  return s
}
