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
 * ⇒ 两者**只在 `S = h/ln2 = 20.19773057244549` 天处重合**，不是恒等；同一 `t` 上给出不同的数
 *   ⚠ **数值订正（2026-09-26，N6）**：本行原写 `20.2027…`（错值，误差 4.97e-3）。
 *   复算一条命令即可验：`node -e "console.log(14/Math.LN2)"` ⇒ `20.19773057244549`。
 *   重合本身是**代数恒等**，不是近似：`exp(-t/(h/ln2)) = exp(-t·ln2/h) = decay(t,h)`；
 *   用错值 20.2027 代入时，两条曲线在网格上的最大差 = **8.5e-5**，**超判据表孔径 1e-6**
 *   ⇒ 这正是「把近似值当结论」的形态，故必须写成闭式可复算的那个数（而不是四位小数）。
 *   ⚠ 本值**不进任何断言/注册表**（`criteria.ts` 无此项）—— 只订正注释。
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

/**
 * ── v10 §16.3 记忆活性分级（热 / 温 / 冷）的**召回轴**边界（天）─────────────────
 *
 * 判据原文（v10:688-694，逐字）：
 *   「热 = 近期被召回 ⇒ 每轮注入，高优先级」/「温 = 中期未召回 ⇒ 按需注入」/
 *   「冷 = 长期零召回 ⇒ 降级提纯，归档」
 *
 * ⚠ **v10 §16.3 通篇不给数**（只有「近期 / 中期 / 长期」三个序数词）⇒ 本包必须自定两个边界，
 *   而「自定」在本仓的合法形态只有一种：**从既有常数派生，不新造孤立魔数**
 *   （先例 = `ARCHIVE_RETENTION_DEFAULT_DAYS = S_max`，理由见上）。故这里两条都派生自
 *   `S_MAX`（本包唯一带判据锚点的强度上界，A3-4 夹具 `Smax=30`）：
 *
 *   · 冷线 `= S_MAX`（30 天）：超过**一个完整强度上界**没有任何一次召回 ——
 *     按本包自己的留存核，`retention(S_MAX; S=S_MAX) = exp(-1) = 0.367879`，
 *     **恰好等于本包 A3-4 的判据锚点值**（`retention(7;S=7)=0.367879`）：
 *     即「留存率掉到判据锚点那条线」⇒ 冷。这不是巧合挑数，是可复算的派生关系。
 *   · 热线 `= S_MAX / 2`（15 天）：半个强度上界，`retention = exp(-0.5) = 0.606531`。
 *     取「一半」的理由：热线要表达的是「还在**上坡**的那一段」—— 尚未耗掉半个上界。
 *
 * ⚠ **这两条是本包的策略值，不是校准结论**：v10 无值、本机也无召回间隔分布可校准
 *   （实测 `memory_items` 行数 = 0）⇒ 注册表按 `preregistered:false / samples:0` 登记，
 *   `thresholdStatus()` 必须回 `calibrated:false`。按 `docs/mana-rollout-plan.md:520`，
 *   **校准前不得据「没超线」判通过**（由 `src/activity.ts` 的读数面如实带出，不靠注释承诺）。
 *
 * ⛔ **本文件不定义任何 τ**：激活轴的边界（`τ±余量`）全部由 `archive.ts#classify` 持有，
 *   本包对 τ 只有一个来源（`long-term` 真源，缺失走 `TAU_FALLBACK`）。
 *   §16.3 的分级**只读** `classify()` 的区间，禁止在此再写一份 `τ+1.0` / `τ−0.5`。
 */
export const ACTIVITY_RECENT_MAX_AGE_DAYS = S_MAX / 2

/**
 * 冷线：距最近一次召回**超过**该天数即「长期零召回」（§16.3 的「冷」）。
 *
 * ⚠ **开闭语义（边界必须显式）**：判定用 `age > ACTIVITY_COLD_MIN_AGE_DAYS`，
 *   故**恰好等于该天数仍属「温」**；恰好在 **0** 处归「热」。两侧闭侧由判据钉死
 *   （`tests/activity.test.mjs` ③ 给出真读数），不靠读者猜 ——
 *   本仓「阈值临界」必须各有断言。
 */
export const ACTIVITY_COLD_MIN_AGE_DAYS = S_MAX
