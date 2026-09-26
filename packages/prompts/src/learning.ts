/**
 * §25.6 学习链条 —— 2 条，**均为 LLM system prompt**（本链无 JevQuestion）。
 *
 * ⚠ 本条链因此**不需要** `JevQuestion` 类型 import —— 这不是遗漏，是本链的事实
 *   （判据侧据「本链只有 system prompt」断言，见测试③）。
 */

/** §25.6 · 原则提炼 system prompt（含 `{{}}` 风格的占位说明，照抄原文）。 */
export const PRINCIPLE_EXTRACTION_SYSTEM_PROMPT = `从经验中提炼跨任务通用的原则。
1. 变量化（不绑定特定任务）
2. 可操作
3. 简洁（不超过 100 字）

输出：[原则] <内容>`

/** §25.6 · 路径归纳 system prompt。 */
export const PATH_INDUCTION_SYSTEM_PROMPT = `从任务执行记录中归纳可复用的任务路径。路径应该是变量化的步骤序列，用 {{变量名}} 表示可变部分。

输出：[路径] <步骤1> -> <步骤2> -> ... -> <步骤N>`
