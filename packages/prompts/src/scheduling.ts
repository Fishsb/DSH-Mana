/**
 * §25.7 调度链条 —— 3 条，**全部是工厂**（v10 原文三条都带参数）。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'

/**
 * §25.7 · 陌生任务判定（工厂）：这是一条熟悉的任务吗？
 *
 * ⚠ v10 原文的签名是 `(goalTitle, history)`，但 **instructions 只消费 goalTitle**
 *   —— `history` 在原文里未参与文本。本包**照抄原样**（不改签名、不擅自删参），
 *   并在测试③里把「history 未参与」记为已知事实，而不是假装它被用了。
 */
export function UNFAMILIAR_TASK_PROMPT(goalTitle: string, history: string): JevQuestion {
  void history
  return {
    type: 'noul',
    instructions: `这是一条熟悉的任务吗？任务：${goalTitle}`,
    criteria: {
      true: '有相似历史任务，可复用经验',
      false: '没有相似历史任务，需先回忆',
    },
  }
}

/**
 * §25.7 · 工具路由（工厂，choice）：调用哪个工具？
 *
 * v10 原文 `Object.fromEntries(tools.map(t => [t, t]))` ⇒ 键与值同为工具名。
 */
export function TOOL_ROUTING_PROMPT(tools: readonly string[]): JevQuestion {
  return {
    type: 'choice',
    instructions: '调用哪个工具？',
    criteria: Object.fromEntries(tools.map((t) => [t, t])),
  }
}

/** §25.7 · 安全门（工厂）：这个操作是否安全？ */
export function SAFETY_GATE_PROMPT(action: string): JevQuestion {
  return {
    type: 'noul',
    instructions: `这个操作是否安全？操作：${action}`,
    criteria: {
      true: '安全，不会造成不可逆损害',
      false: '可能有风险',
    },
  }
}
