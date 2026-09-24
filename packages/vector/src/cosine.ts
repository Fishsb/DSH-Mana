/**
 * 纯 JS 余弦相似度通道（B1.1）。
 *
 * **来源与归属**：算法逐字移植自本机 `/mnt/d/FF/shoucang/lib/vec.js` 的 `cosine`（该文件
 * sha256 `6fd22cac9162c55bc049cb10ef4994fd02fc88c2fdca8066cd4dda6f8344cea6`，**只读参考，未改一字**）。
 * 本仓**不 import 它**（那是活跃开发树、非只读件，且跨仓 import 会把它的依赖树拖进来）
 * —— 故此处是**语义等价的独立实现**，等价性由 `tests/b11-vector.test.mjs` 的合成夹具逐位对拍取证。
 *
 * ⚠ **为什么不做 dim==1024 强校验**（与 `fitDim` 的分工，别把两条判据混成一条）：
 *   `cosine` 只回答「余弦是多少」，长度不等是**非法输入**（返回 0，上游原语义）；
 *   维度契约（A1-12：`dim must == 1024`）由适配层 `assertDim()` 在**入口**判，并落
 *   `degraded` 显式字段。把契约检查塞进纯函数会让「非法输入」与「降级」由同一个 0 表示
 *   —— 那正是 G8 禁止的「不可分辨」形态。
 */

/**
 * 余弦相似度。
 *
 * 语义（与上游逐条对齐，原样承接，不做"顺手改进"）：
 * - 任一为空、或长度不等 ⇒ `0`（**不是异常**：上游召回路径依赖它不抛）；
 * - 任一模长为 0 ⇒ `0`（零向量无方向，`0/0` 必须挡住）；
 * - 否则 `dot / (‖a‖·‖b‖)`，**不做 clamp**。
 *
 * ⚠ 浮点读数可能**略超 1**（如 `1.0000000000000002`）：这是 IEEE754 的固有结果，
 *   判据里不得写成 `assert.ok(v <= 1)`。上游同样不 clamp —— 对齐它比"看起来更干净"重要。
 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * 按 A1-12 判嵌入维度契约。返回 `null` = 通过；返回字符串 = **降级原因**（非空，含实测值）。
 *
 * 为什么返回「原因」而不是布尔：调用方要把原因**写进显式字段**（G8）；
 * 布尔会把「为什么降级」丢掉，排查时只剩「降级了」三个字。
 */
export function assertDim(vec: ArrayLike<number> | null | undefined, dim: number): string | null {
  if (vec === null || vec === undefined) return `嵌入缺失：期望 ${dim} 维，实际拿到 ${String(vec)}`
  if (!vec.length) return `嵌入为空：期望 ${dim} 维，实际 0 维`
  if (vec.length !== dim) return `嵌入维度不符：期望 ${dim} 维，实际 ${vec.length} 维`
  for (let i = 0; i < vec.length; i++) {
    if (!Number.isFinite(vec[i] as number)) return `嵌入含非有限值：第 ${i} 位为 ${String(vec[i])}`
  }
  return null
}
