/**
 * §25.2 巩固链条 —— 3 条（2 个 JevQuestion + 1 个 LLM system prompt）。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'

/** §25.2 · 巩固触发门（noul）。 */
export const CONSOLIDATION_TRIGGER_PROMPT: JevQuestion = {
  type: 'noul',
  instructions: '当前会话是否值得巩固？',
  criteria: {
    true: '产生了新的可复用经验、原则或偏好更新',
    false: '常规操作，无新知识',
  },
}

/** §25.2 · 组块效用（score）。 */
export const CHUNKING_UTILITY_PROMPT: JevQuestion = {
  type: 'score',
  instructions: '产生式规则的预期效用？',
  criteria: ['很低', '较低', '中等', '较高', '很高'],
}

/**
 * §25.2 · 睡眠诱发 system prompt。
 *
 * ⚠ 名字照抄 v10 原文的 `INDICTION`（**原文如此**，不是本包拼错：
 *   正确的英文拼写是 induction）—— 改名会让「与原文逐字对照」这条判据失效。
 * ⚠ 含 `{{变量名}}` 占位符：本包**只落常量文本**，不做渲染（渲染归调用方/LLM 层）。
 */
export const SLEEP_INDICTION_SYSTEM_PROMPT = `你是一个认知记忆系统的巩固模块。从最近的记忆痕迹中提炼可复用的原则和任务路径。

输出格式：
[原则] <跨任务通用的经验>
[路径] <可复用任务类型的变量化步骤序列>

要求：
1. 只提炼真正跨任务通用的原则
2. 路径应该是变量化的，用 {{变量名}} 表示可变部分
3. 每条不超过 100 字
4. 没有可提炼的内容，输出"无"`
