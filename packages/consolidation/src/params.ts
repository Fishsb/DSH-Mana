/**
 * B4.1 阈值与工程参数的**唯一出处**。
 *
 * ⚠ 三类数字必须分得清（本仓阈值纪律 §6.0 / `docs/contract/threshold-discipline.md`）：
 *   · **判据阈值**（有判据原文、进判据注册表）—— 本文件前三条，且**逐条注明出处**；
 *   · **工程缺省**（无判据原文背书、可被调用方覆盖、不是判据）—— 本条后一条，**明文标出**；
 *   · 缺省值**不得**拿来当判据的判据：`tests/b41-consolidate.test.mjs` 用**不默认的 N** 反证
 *     「选择真的用了传入的 N」，使本文件成为参数而非摆设。
 *
 * 逐条出处（`docs/mana-rollout-plan.md:546` B4.1 行）：
 *   · `MERGE_SIMILARITY = 0.7` —— 原文「相似度 ≥0.7 合并」；v10:509/:511 的 Ripple「相似度 > 0.7」
 *     同值。⚠ 原文用的是 **≥**（本仓取 ≥，见 `consolidate.ts` 的边界用例）。
 *   · `MAX_OPERATOR_SEQUENCE = 7` —— 原文「算子序列 ≤7」。
 *   · `MIN_PATTERN_REPEATS = 2` —— 原文「模式重复 ≥2」且「chunking 重复阈值 ≥2」（同一数字，
 *     故**一个常量**，两处引用；拆成两个常量必然漂移）。
 */
export const CONSOLIDATION_PARAMS = Object.freeze({
  /** Ripple：与新皮层语义记忆比对，相似度 **≥** 本值 ⇒ 合并。出处：B4.1 行「相似度 ≥0.7 合并」。 */
  MERGE_SIMILARITY: 0.7,
  /** 触发条件：算子序列长度 **≤** 本值。出处：B4.1 行「算子序列 ≤7」。 */
  MAX_OPERATOR_SEQUENCE: 7,
  /** 触发条件：模式重复 **≥** 本值。出处：B4.1 行「模式重复 ≥2」/「chunking 重复阈值 ≥2」。 */
  MIN_PATTERN_REPEATS: 2,
  /**
   * Spindle 层：一次重放周期最多选多少条（按激活值降序）。
   *
   * ⚠ **工程缺省，不是判据阈值**（原文只说 Top-N，未给 N）：
   *   · **不入阈值列**（§6.0：无本机基线的数字不得写成阈值）；
   *   · 取 3 的理由是**结构性的**：本层叫「选择」就必有上界 —— 不设上界时 Ripple 变成全量扫描，
   *     Spindle 层与空转同形；3 是能被夹具证伪的最小非平凡上界。
   *   · 调用方可通过 `run({ topN })` 覆盖；覆盖无效即判据报红。
   */
  SPINDLE_TOP_N: 3,
})

export type ConsolidationParams = typeof CONSOLIDATION_PARAMS
