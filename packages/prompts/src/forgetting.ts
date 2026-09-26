/**
 * §25.5 遗忘链条 —— 2 条（1 个 JevQuestion + 1 个 LLM system prompt）。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'

/** §25.5 · 活性级别（choice：criteria 是**对象**，键=返回值）。 */
export const ACTIVITY_LEVEL_PROMPT: JevQuestion = {
  type: 'choice',
  instructions: '这条记忆的活性级别？',
  criteria: {
    hot: '近期频繁访问',
    warm: '中期有访问',
    cold: '长期零访问',
  },
}

/** §25.5 · 压缩 system prompt。 */
export const COMPRESSION_SYSTEM_PROMPT = `将这段记忆压缩为统计摘要，保留：
1. 核心事实（谁、什么、何时）
2. 关键数据点
3. 与其他记忆的关联

不超过 50 字。`
