/**
 * L-03 学习链（Hebbian）**参数的唯一出处** —— η 与窗口都只在这里出现一次。
 *
 * 真源：
 *   · `docs/mana-v10-landing-plan.md:141`（L-03 目标行）：「两个记忆在 **5 分钟窗口**内被
 *     同时激活 ⇒ 增加关联强度」；落点 `memory_items.related_ids`。
 *   · `docs/mana-v10-landing-plan.md:144`（可机检判据①）：**学习率 `η = 0.01`**；
 *     判据④：⛔ 把 η 改成 0.02 ⇒ ① 必红；判据②：5 分钟**内**增、5 分钟**外不增**。
 *
 * ⚠ **为什么单独成文件（与 `long-term/src/params.ts` 同一条理由）**：
 *   `册:820` C14「派生量唯一写者」要求同一条记忆**不得被两家乘过**。
 *   参数若散落在各函数默认值里，改一处不会改另一处 ⇒ 迟早出现「两个 η」「两个窗口」。
 *   本仓已有**一条在役的机检腿**（`packages/long-term/tests/activation.test.mjs` ⑦）
 *   就是靠「冻结参数不得在 `params.ts` 之外以字面量重现」把这条纪律钉死的；
 *   本包照抄同款腿（见 `tests/l03-hebbian.test.mjs` ⑦）。
 *
 * ⚠ **两个显式命名空间常量必须在同一处以「不参与任何判据」的方式暴露**，
 *   否则调用方会各自发明标签：见 `index.ts` 的 `TRACE_EVENT` / `GATE_FALLBACK`。
 */

/**
 * 学习率 `η = 0.01`（判据原文 `docs/mana-v10-landing-plan.md:144` ①）。
 *
 * ⚠ **它是「每次共激活的关联强度增量」的系数，不是强度本身**：
 *   `Δw = η · x_i · x_j`；本包取可机检的确定性口径 `x_i = x_j = 1`（见 `hebbian.ts` 文件头
 *   对「为什么不是把 ACT-R 的 A 直接代进来」的说明）⇒ `Δw = η`。
 */
export const ETA = 0.01

/**
 * 共激活窗口 **5 分钟**（判据原文 `docs/mana-v10-landing-plan.md:141`：「5 分钟窗口内」）。
 *
 * ⚠ **单位为分钟与毫秒各存一次是刻意的**：判据会以分钟为单位改（5 → 6，负向对拍 D1），
 *   而生产路径以**毫秒**比较时间戳。若只存毫秒，对拍就得写 `360000`（换算容易写错、
 *   且错法与「窗口被改」不可分辨）；若只存分钟，时间戳比较点每处都要 `* 60000`（散落即漂移）。
 *   ⇒ 分钟是**人改的那一份**，毫秒是**派生量**（下方由分钟算出），两处不可能各说各话。
 */
export const COACTIVATION_WINDOW_MINUTES = 5

/** 一分钟的毫秒数（派生用；具名以免生产路径里出现裸 `60000`）。 */
export const MS_PER_MINUTE = 60000

/** 派生量：窗口毫秒 = `COACTIVATION_WINDOW_MINUTES × MS_PER_MINUTE`。**不得独立配置**。 */
export const COACTIVATION_WINDOW_MS = COACTIVATION_WINDOW_MINUTES * MS_PER_MINUTE

/**
 * 权重比较用的容差（`1e-12`）——**只用于「同一 id 的权重是否相等」这类判定**，不参与计算。
 *
 * ⚠ 取值理由（本机实测，见 handoff §判据）：`0.01 × n` 与「n 次在库值上累加」在
 *   **n ≥ 10 时逐位不等**（实测 `累加到第 10 次 = 0.09999999999999999`，
 *   而 `0.01 × 10 = 0.1`）⇒ 判据必须**分两条腿**：闭式腿带容差、单调腿按「不减」断言。
 *   若把这个容差拿去当「值相等」的判据，闭式锚点就退化成软断言 —— 故它只做**合并去重**用。
 */
export const WEIGHT_EPS = 1e-12

/**
 * 冻结参数快照（**只读**）——服务面 `params` 即吐出本对象，供判据/其余模块**读而非重写**。
 *
 * 与 `long-term` 的 `ACTR_PARAMS` 同形：判据可以断言「服务面读到的 η 与 params 一致」，
 * 从而把「实现里偷偷写死了另一个 η」变成可机检事实。
 */
export const LEARNING_PARAMS = Object.freeze({
  /** 学习率 η */
  eta: ETA,
  /** 共激活窗口（分钟） */
  windowMinutes: COACTIVATION_WINDOW_MINUTES,
  /** 共激活窗口（毫秒，派生量） */
  windowMs: COACTIVATION_WINDOW_MS,
  /** 权重合并容差（非计算量） */
  weightEps: WEIGHT_EPS,
})

export type LearningParams = typeof LEARNING_PARAMS
