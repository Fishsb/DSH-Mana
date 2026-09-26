/**
 * §25.3 检索链条 —— 3 条（1 个 LLM system prompt + 2 个 JevQuestion）。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'

/**
 * §25.3 · 意图分类 system prompt。
 *
 * ⚠ 本常量在 v10 里**没有** `{{变量}}` 占位符（纯枚举指令），照抄原文。
 */
export const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `判断用户意图，只输出一个词：
- 问答
- 任务
- 提醒
- 闲聊`

/**
 * §25.3 · 回忆门（工厂）：这条记忆是否真的有助于回答当前问题？
 *
 * v10 原文把 `memorySummary` **内联进 instructions**（不是占位符渲染），
 * 故本工厂返回的是**已渲染的** JevQuestion。
 */
export function RECALL_GATE_PROMPT(memorySummary: string): JevQuestion {
  return {
    type: 'noul',
    instructions: `这条记忆是否真的有助于回答当前问题？内容：${memorySummary}`,
    criteria: {
      true: '直接相关或提供有用背景',
      false: '无关或关联很弱',
    },
  }
}

/** §25.3 · 注入门（noul）：这条记忆是否应该注入当前上下文？ */
export const INJECTION_GATE_PROMPT: JevQuestion = {
  type: 'noul',
  instructions: '这条记忆是否应该注入当前上下文？',
  criteria: {
    true: '高度相关且不会造成干扰',
    false: '可能分散注意力、过时或矛盾',
  },
}
