// A0-4 typecheck 真接了宿主类型（负向判据）：故意引用不存在的宿主事件名。
// 期望：tsc 报 `not assignable to parameter of type 'keyof Events'`。
// 若**不报错** ⇒ 类型检查没接上宿主类型，后续所有 typecheck 判据不可信。
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
export function probe(ctx: Context) {
  return ctx.on('agent/pre-step-does-not-exist', () => {})
}
