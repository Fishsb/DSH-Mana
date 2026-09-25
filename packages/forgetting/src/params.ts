/**
 * `mana-forgetting` 遗忘参数（B4.2）—— **本包内的唯一出处**。
 *
 * 真源（逐字）：
 *   · `docs/mana-v5-plan.md:557`   `retention(t) = exp(-t / S)`
 *   · `docs/mana-v5-plan.md:563-566` `S_new = S_old + ΔS`，`ΔS = a · (S_max - S_old)^b`
 *     （Pavlik & Anderson 2005 间隔重复模型）
 *   · `docs/mana-v5-plan.md:570-576` 激活值四区间归档表
 * 判据真源：`docs/mana-rollout-plan.md:547`（B4.2 行）、`:560`（A3-4 闭式锚点）
 *
 * ── ⚠ 与 `long-term` 的 `decay` **不是同一个公式**（C14 点名「三套衰减公式并存」，
 *    本包必须把差在哪写清楚，**不许默默再写一份**）────────────────────────────────
 *
 * |          | `long-term` 的 `decay(t,h)`            | 本包的 `retention(t,S)`          |
 * |----------|------------------------------------------|-----------------------------------|
 * | 公式      | `exp(-t·ln2/h)`                        | `exp(-t/S)`（案 §8.2 原文）      |
 * | 时间常数  | `h = 14` 天，**常数**（A1-5 冻结）       | `S` = 记忆强度，**每次重复后增长** |
 * | 判据锚点  | `decay(14)=0.500000`                    | `retention(7;S=7)=0.367879`、`retention(14;S=7)=0.135335` |
 * | 是否依赖重复次数 | 否                                 | 是（这是「间隔重复」的全部来源）   |
 *
 * ⇒ 两者**只在 `S = h/ln2 = 20.2027…` 天处重合**，不是恒等；同一 `t` 上给出不同的数
 * （`decay(14)=0.500000` vs `retention(14;S=7)=0.135335`）**不是口径漂移** ——
 * 二者是同一张判据表（`docs/mana-rollout-plan.md:455` 与 `:560`）逐字要求的两条曲线。
 * ⛔ **不得相乘**（`decay × retention`）：那正是 C14 说的「同一条记忆被两家乘过」。
 * 半衰期在本工作区**只有一个出处**（`packages/long-term/src/params.ts:54` 的
 * `HALF_LIFE_DAYS`）；本包**不重新定义**它，只在需要时按可选依赖读它（缺失即降级）。
 *
 * ⚠ **单位**：本包的 `t` / `S` / `S_MAX` 一律以**天**计（对齐 A3-4 锚点的 `t=7d/14d`）。
 *   与 `long-term` 的 `baseLevel` 的**秒**不是同一个量（见 `long-term/src/params.ts:11-16`）。
 *
 * ⚠ **阈值归属**：本文件的每个数都登记在 `src/criteria.ts` 的**包内阈值注册表**里
 *   （形态参考 `packages/metacognition/skill/engine/criteria.json` 的 `thresholds.entries`；
 *   `docs/mana-rollout-plan.md:547` ④ 要求修剪阈值「落地时进判据注册表，**不新增机检 ID**」）。
 */

/** `ΔS = a·(S_max − S)^b` 的 `a`。案 §8.2 未给值；**A3-4 夹具明文** `a=0.5`。 */
export const PAVLIK_A = 0.5

/** `ΔS` 的指数 `b`。案 §8.2 未给值；**A3-4 夹具明文** `b=0.3`。 */
export const PAVLIK_B = 0.3

/** 强度上界 `S_max`（单位：天）。案 §8.2 未给值；**A3-4 夹具明文** `Smax=30`。 */
export const S_MAX = 30

/** 强度初值 `S_0`（A3-4 夹具「`S` 从 **1** 起」）。 */
export const S_INITIAL = 1

/** A3-4 夹具：从 `S_0` 起重复 **3** 次 ⇒ `S=5.059273`。 */
export const PAVLIK_FIXTURE_REPEATS = 3

/**
 * 四区间归档：**强激活**边界的余量（`A > τ + 1.0`）。
 * 真源 `docs/mana-v5-plan.md:572`（`A > τ + 1.0` ⇒ 正常保留，高优先级检索）。
 */
export const A_STRONG_MARGIN = 1.0

/**
 * 四区间归档：**归档**边界的余量（`A ≤ τ − 0.5`）。
 * 真源 `docs/mana-v5-plan.md:575`（`A ≤ τ − 0.5` ⇒ 归档 `retired=true`，可恢复）。
 */
export const A_RETIRE_MARGIN = 0.5

/**
 * 激活阈值 τ 的**降级缺省**（`long-term` 未装配时用）。
 *
 * ⚠ 真源仍是 `packages/long-term/src/params.ts:23` 的 `TAU = -2.0`；本包**只读**它，
 *   装上了就用它的值（`apply` 里 `ctx.get('mana-long-term')` 可选依赖）。
 *   本常量存在的唯一理由是「没装 long-term 时也要有数可用」，且**必须与真源同值** ——
 *   由判据 ⑦ 的「同源腿」机检（用 long-term 真源复算本缺省值）。
 */
export const TAU_FALLBACK = -2.0

/**
 * 归档留存上限的**缺省档位**（天）。
 *
 * ── 缺省依据（**不是**随手编一个数）──────────────────────────────────────────
 *   ① `S_max = 30` 天是本包**唯一带判据锚点的强度上界**（A3-4 夹具 `Smax=30`）；
 *   ② 案 §8.2 的归档行（`docs/mana-v5-plan.md:575`）：归档态（`A ≤ τ−0.5`）在物理上就是
 *      「超过一个 `S_max` 天没被任何一次访问抬回来」的条目（`A` 随时间单调下降）；
 *   ③ ⇒ 缺省窗口取 `S_max` 天 = **借用本包已有的上界常数**，而不是新造第四个魔数。
 *
 * ⚠ **它是「量级与来源」的声明，不是校准结论。** 本仓现阶段**无任何真实累积**：
 *   实测 `/home/lk/.dsh/memory/mana.db`（2026-09-25 12:2x）的 `memory_items` 行数 = **0**
 *   ⇒ 密度/命中率分布δ拉不到，`samples = 0`。
 *   按 `docs/contract/threshold-discipline.md`（只有 A 档确定性值可进阈值列）与
 *   `docs/mana-rollout-plan.md:520`（「阈值未定前本判据**不生效**，且**不得以『未超标』放过**」），
 *   本值在**校准前不得用来判通过** —— 该约束由 `ARCHIVE_RETENTION_CALIBRATED` 与
 *   `capStatus()` 的 `'uncalibrated'` 三态**机检**，不靠注释承诺。
 */
export const ARCHIVE_RETENTION_DEFAULT_DAYS = S_MAX

/**
 * 归档留存上限**是否已校准**。`false` ⇒ `capStatus()` 必须回 `'uncalibrated'`，
 * **不得**回 `'ok'`（否则「没超标」会与「阈值压根没定」同形 —— 本仓最防的那类假绿）。
 * 校准依据落地后（真实归档密度 + 命中率分布）才可置 `true`。
 */
export const ARCHIVE_RETENTION_CALIBRATED = false

/** 四区间名（顺序 = 激活值从高到低）。 */
export type ArchiveIntervalName = 'hot' | 'warm' | 'declining' | 'archive'

/**
 * 一个区间的**边界规格**：相对 τ 的偏移 + 开闭性。
 *
 * ⚠ 把边界写成**数据**而不是 `if` 链的理由：判据 ③ 要断言「四区间恰好铺满 ℝ 且两两不交」
 *   （有缝 ⇒ 某些 A 归不进任何区间；有叠 ⇒ 同一个 A 有两个归属）。写成 `if` 链时，
 *   那条判据只能靠枚举采样去猜，**结构性缺陷（τ+1.0 处漏掉一个点）可能整片漏过**。
 */
export interface IntervalSpec {
  readonly name: ArchiveIntervalName
  readonly label: string
  /** 下界相对 τ 的偏移；`null` = 无下界。 */
  readonly lo: number | null
  /** 下界是否含（`true` ⇒ `A ≥ τ+lo`；`false` ⇒ `A > τ+lo`）。 */
  readonly loInclusive: boolean
  /** 上界相对 τ 的偏移；`null` = 无上界。含上界**恒含**（案四区间全为左开右闭）。 */
  readonly hi: number | null
}

/**
 * 四区间归档规格（`docs/mana-rollout-plan.md:547` ②，逐字）：
 *   `A>τ+1.0` / `τ<A≤τ+1.0` / `τ-0.5<A≤τ` / `A≤τ-0.5`
 * 四者**恰好铺满 ℝ 且两两不交**（由判据 ③ 机检）。
 */
export const ARCHIVE_INTERVALS: readonly IntervalSpec[] = Object.freeze([
  { name: 'hot', label: '强激活（正常保留，高优先级检索）', lo: A_STRONG_MARGIN, loInclusive: false, hi: null },
  { name: 'warm', label: '正常保留', lo: 0, loInclusive: false, hi: A_STRONG_MARGIN },
  { name: 'declining', label: '衰退中（降低注入优先级）', lo: -A_RETIRE_MARGIN, loInclusive: false, hi: 0 },
  { name: 'archive', label: '归档（retired=true，可恢复）', lo: null, loInclusive: false, hi: -A_RETIRE_MARGIN },
])
