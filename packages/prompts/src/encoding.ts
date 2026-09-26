/**
 * §25.1 编码链条 —— 4 条 Prompt（v10 原文逐条落点）。
 *
 * 本文件只放**编码链**的模板：写入门控 / 取代判定 / 情绪效价 / 情绪唤醒度。
 * 每条都标注 v10 的确切小节，便于与原文逐字对拍。
 *
 * ⚠ `JevQuestion` **必须**从 `packages/jev` 复用，不得在本包重新定义
 *   （否则两个真源：改一处不生效，且编译期看不出）。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'

/** §25.1 · 写入门控：这条信息是否值得长期保存？ */
export const WRITE_GATE_PROMPT: JevQuestion = {
  type: 'noul',
  instructions: '这条信息是否值得长期保存？',
  criteria: {
    true: '信息包含跨会话可复用的经验、决策、偏好或持久事实',
    false: '信息是临时性的、一次性的，或可从上下文推断',
  },
}

/**
 * §25.1 · 取代判定（工厂）：新记忆是否应该替换某条旧记忆？
 *
 * v10 原文用 `Object.fromEntries(candidates.map((c, i) => [old_ + i, c]))` 生成
 * 「每条候选一个键」的 criteria，再补一个 `none`。键名沿用 `old_<序号>`。
 */
export function SUPERSEDES_PROMPT(candidates: readonly string[]): JevQuestion {
  return {
    type: 'choice',
    instructions: '新记忆是否应该替换某条旧记忆？',
    criteria: {
      ...Object.fromEntries(candidates.map((c, i) => [`old_${i}`, c])),
      none: '不替换',
    },
  }
}

/** §25.1 · 情绪效价（score：criteria 必须是**数组**）。 */
export const EMOTION_VALENCE_PROMPT: JevQuestion = {
  type: 'score',
  instructions: '情绪效价？',
  criteria: ['非常负面', '负面', '中性', '正面', '非常正面'],
}

/** §25.1 · 情绪唤醒度（score）。 */
export const EMOTION_AROUSAL_PROMPT: JevQuestion = {
  type: 'score',
  instructions: '情绪唤醒度？',
  criteria: ['非常平静', '平静', '中等', '激动', '非常激动'],
}
