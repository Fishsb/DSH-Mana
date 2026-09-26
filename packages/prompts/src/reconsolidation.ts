/**
 * §25.4 再巩固链条 —— 1 条。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'

/**
 * §25.4 · 再巩固更新判定（工厂）：新信息是否应该更新此记忆？
 *
 * v10 原文把 `original` 与 `newInfo` 内联进 instructions。
 */
export function RECONSOLIDATION_UPDATE_PROMPT(original: string, newInfo: string): JevQuestion {
  return {
    type: 'noul',
    instructions: `新信息是否应该更新此记忆？原记忆：${original}。新信息：${newInfo}`,
    criteria: {
      true: '新信息提供了补充、修正或更新',
      false: '无关或原记忆已足够准确',
    },
  }
}
