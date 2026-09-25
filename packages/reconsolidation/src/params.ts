/**
 * 本包参数的**唯一出处**。
 *
 * ── 口径（G1 / `docs/contract/threshold-discipline.md`）────────────────────────────────
 * 四类记忆的去稳定化窗口时长来自 v10 §15.2 的**裁定值**（落地册 L-02 逐字引用：
 * 「情景 30min / 语义 2h / 程序 6h / 情绪 1h」）。它们是：
 *   · **A 档**（确定性值，跨运行逐字复现）：本档只做单位换算，换算系数写死在下面；
 *   · ⚠ **不是本仓实测标定值** —— 本包**不声称**它们有本仓基线（不虚指数值来源），
 *     与 `forgetting/params.ts` 的 `ARCHIVE_RETENTION_CALIBRATED` 同一纪律。
 *     「有出处 ≠ 有基线」：前者是裁定（可引用），后者要实验（本包没有）。
 *
 * ⚠ **不得把窗口时长写成"可调配置"**：它们是**判据的靶子**（判据①按这四个值断言），
 *   一旦变成配置项，「固定夹具下逐字复现」就退化为「配置是什么就复现什么」——
 *   判据恒真（假覆盖）。故本表是**常量**，改动它必须逐个说明判据怎么跟着变。
 */

/** 四类记忆的认知类型轴（口径同 metacognition `criteria.generated.ts` 的 memClass：语义/情景/程序性）。 */
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'emotional'

/** 窗口参数表：类型 → 毫秒（**唯一真源**；`windowMs` 是它的读侧投影）。 */
export const WINDOW_MS_BY_TYPE: Readonly<Record<MemoryType, number>> = Object.freeze({
  /** 情景 30 分钟（v10 §15.2）。 */
  episodic: 30 * 60 * 1000,
  /** 语义 2 小时。 */
  semantic: 2 * 60 * 60 * 1000,
  /** 程序性 6 小时。 */
  procedural: 6 * 60 * 60 * 1000,
  /** 情绪 1 小时。 */
  emotional: 60 * 60 * 1000,
})

/** 本包认得的类型清单（判据按它枚举 ⇒ 新增类型忘登记即红：集合相等，不是"包含"）。 */
export const MEMORY_TYPES: readonly MemoryType[] = Object.freeze([
  'episodic',
  'semantic',
  'procedural',
  'emotional',
] as const)

/**
 * 四值的**秒级**表示，仅供判据/文档逐字引用（由毫秒表派生，**不是第二真源**）。
 * ⚠ 派生量必须派生于真源：下面用 `Object.fromEntries` 从毫秒表算出来，
 *   而不是再手抄一份 —— 两份手抄必漂移，且漂移不可观测（本仓 C14）。
 */
export const WINDOW_SECONDS_BY_TYPE: Readonly<Record<MemoryType, number>> = Object.freeze(
  Object.fromEntries(MEMORY_TYPES.map((t) => [t, WINDOW_MS_BY_TYPE[t] / 1000])) as Record<MemoryType, number>,
)
