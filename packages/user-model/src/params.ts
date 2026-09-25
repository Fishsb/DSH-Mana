/**
 * `dsh-mana-user-model` 的**全部工程参数唯一出处**（C14 唯一写者 · B5.2）。
 *
 * 存在的理由（本仓血的教训「假旋钮」）：一个数若在多处手写，改一处不生效、读的人
 * 却以为改了 —— 那是**从不生效的旋钮**。故本包只在此处定义数值，其余文件一律引用。
 *
 * ── 逐参数交代「数从哪来」────────────────────────────────────────────────────
 *
 * | 参数 | 值 | 来源 | 性质 |
 * |---|---|---|---|
 * | `DRIFT_WINDOW_DAYS` | 30 | 落地册 §4.1 原文「同一 key 在 **30 天内**被改 ≥3 次」 | 册已给定 |
 * | `DRIFT_MIN_CHANGES` | 3 | 同上，册原文 | 册已给定 |
 * | `ACCURACY_SAMPLE_FLOOR` | 289 | A4-2 原文「n ≥ 289（p=0.75, ±5pp, 95%）」 | **派生量**，见下（可复算，非手抄） |
 * | `ACCURACY_Z` | 1.96 | 95% 双侧正态分位（A4-2「95%」的落点） | 常数 |
 * | `CONFIDENCE_FLOOR` | **null** | A4-1「待定，需拍板」（册:597） | **未拍板 ⇒ 显式 null** |
 *
 * ⚠ **为什么 289 是算出来的而不是抄的**：手抄一个数就断了它与「p=0.75, ±5pp, 95%」
 *   之间的可追性 —— 册:597 的 A4-1 与册:598 的 A4-2 都是「随阈值一并定」，将来 p 或
 *   精度若改，抄来的 289 不会跟着动，而没人会发现。故此处只存**公式输入**，
 *   样本量由 `requiredSampleSize()` 现算，并由判据断言「算出来恰好是 289」
 *   （算不出 289 即红 ⇒ 公式输入与册原文脱节时会被抓到）。
 *
 * ⚠ **为什么 `CONFIDENCE_FLOOR` 必须是 null 而不是某个"合理"的数**：
 *   A4-1（置信度可校准）在册:597 明确写着「**待定，需拍板**（方案未给）」，
 *   且「未定前本判据不生效，**不得以「未超标」放过**」。
 *   若本席在此填一个 0.3 之类的数，就等于**替用户拍板**，而且方向是最危险的那种：
 *   一个偏低的阈值会让所有偏好都"照常注入"，于是「退场动作」永远不会触发，
 *   而系统表现得一切正常 —— 正是册内明令禁止的「以未超标放过」。
 *   ⇒ 未拍板时 `injectionDecision()` 返回 `'undeterminable'`，**不是** `'inject'`。
 */

/** 漂移窗口（天）——落地册 §4.1 原文「30 天内」。 */
export const DRIFT_WINDOW_DAYS = 30

/** 漂移候选线（次）——落地册 §4.1 原文「被改 ≥ 3 次」。 */
export const DRIFT_MIN_CHANGES = 3

/** 95% 双侧正态分位——A4-2 原文「95%」的落点。 */
export const ACCURACY_Z = 1.96

/** A4-2 的精度假设 p（册:598 原文 `p=0.75`）。 */
export const ACCURACY_ASSUMED_P = 0.75

/** A4-2 的置信区间半宽（册:598 原文 `±5pp`）。 */
export const ACCURACY_HALF_WIDTH = 0.05

/**
 * 比例置信区间所需最小样本量：`n = z²·p(1-p) / halfWidth²`（上取整）。
 *
 * ⚠ 这是**派生量**，不是独立参数：改 `ACCURACY_ASSUMED_P` / `ACCURACY_HALF_WIDTH` /
 *   `ACCURACY_Z` 任一个，结果随之变。**不得**把返回值写成字面量 289。
 */
export function requiredSampleSize(
  p: number = ACCURACY_ASSUMED_P,
  halfWidth: number = ACCURACY_HALF_WIDTH,
  z: number = ACCURACY_Z,
): number {
  if (!(p > 0 && p < 1)) throw new Error(`requiredSampleSize: p 必须在 (0,1) 内，实测 ${p}`)
  if (!(halfWidth > 0)) throw new Error(`requiredSampleSize: halfWidth 必须 > 0，实测 ${halfWidth}`)
  if (!(z > 0)) throw new Error(`requiredSampleSize: z 必须 > 0，实测 ${z}`)
  return Math.ceil((z * z * p * (1 - p)) / (halfWidth * halfWidth))
}

/** A4-2 的样本量下限——**现算**（册:598 的 `n ≥ 289` 是它的结果，不是它的真源）。 */
export const ACCURACY_SAMPLE_FLOOR: number = requiredSampleSize()

/**
 * 置信度退场阈值——**A4-1 未拍板 ⇒ 显式 null**（见文件头）。
 *
 * `null` 的含义是「**无人拍板**」，不是「没有下限」。消费方必须把它读成
 * `'undeterminable'`：未拍板时**不得**默认继续注入（那会让退场动作永不触发）。
 * 拍板后改成具体数值即可，判定逻辑无需改动。
 */
export const CONFIDENCE_FLOOR: number | null = null
