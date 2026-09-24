/**
 * `dsh-mana-user-model` —— 末那识·我执（偏好 / 习惯 / 项目）**骨架**（P2 之二 · B5.1 只建骨架）。
 *
 * 阶段 0 口径（册 C12）：本批只立骨架，行为在 B5.2 填。
 *
 * ⚠ 已实测的契约缺口（登记为未决项，不在本席写面内）：
 *   `user_model_history` 追加表在 `packages/core/src/schema.ts` **不存在**
 *   （`grep -n user_model_history packages/core/src/` 空命中），
 *   而册:556 要求「必须在阶段 0 预留」，A4-4 的判据是「表存在且列齐」。
 *   ⇒ 现装配本插件**不会**产生历史行（漂移在数据上仍不可观测）。
 *   core 属 S0 独占写面，本席不得改 ⇒ 登记未决，见 docs/handoff/S1.md §5。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'

export const name = 'mana-user-model'

/** 依赖 core（契约唯一归属地）。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /**
   * 用户模型精度目标（A4-2：「待定，需首测后自设」）。
   * ⚠ 缺省 `null` = **未校准**，判据不生效 —— 不编一个数冒充已拍板（册:568 明令）。
   *
   * ⚠ **本键的缺省不是由 schema 给的**（同批实测，见 `Config` 下方注释）：schemastery 3.18.4
   *   会把 `union.default(null)` 的 null 缺省**静默丢弃**，可写不可靠。
   *   故「未校准」态由 `apply` 对缺席键**显式归一为 `null`**，而不是靠一个从不生效的声明。
   */
  precisionTarget: number | null
}

/**
 * ⚠ 为什么这里**故意不写** `.default(null)`（本仓 2026-09-24 实测，非推断）：
 *
 *   `Schema.object({ p: Schema.union([Schema.number(), Schema.const(null)]).default(null) })({})`
 *   → `{}` —— **`p` 键根本不出现**，`p === undefined`。
 *   对照组同一解析器下 `Schema.number().default(0.5)` → `{x:0.5}`、`Schema.boolean().default(true)`
 *   → `{x:true}` ⇒ 不是「缺省机制整体失效」，而是 **null 缺省在这个形状上被丢弃**。
 *   机制（`schemastery/src/index.ts:533-542`）：`isNullable(data)` 为真时先取 `meta.default`，
 *   再 `if (isNullable(fallback)) return [data]` —— **fallback 自己是 null 就直接放弃**。
 *
 *   ⇒ 写一个**从不生效**的 `.default(null)` 与 `criteria.ts` 里点名的「假旋钮」同形：
 *     改它零效果，读代码的人却会以为"这里有缺省"。
 */
export const Config: Schema<Config> = Schema.object({
  precisionTarget: Schema.union([Schema.number(), Schema.const(null)]),
})

export interface ManaUserModelService {
  readonly plugin: string
  status(): { plugin: string; wired: boolean; precisionTarget: number | null }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-user-model': ManaUserModelService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-user-model: 缺少 mana-core 服务（inject 未满足）')

  /**
   * 「未校准」态的唯一归一入口（**不是** schema 缺省给的 —— 见 `Config` 上方实测）。
   *
   * 为什么必须显式归一：`Schema` 解析不出 `null` 缺省（缺席键被丢弃），
   * 而本包对外契约（`Config` 注释 + A4-2「未定前不得以未超标放过」）要求
   * 「缺省 = null = 未校准」是**宿主能读到的事实**。
   * 若放任 `undefined` 漏出去，`=== null` 判「未校准」的下游一律判假 ⇒
   * 「没拍板」会被静默读成「已校准且不高」—— 正是本会议首位的「让失败不可观测」。
   */
  const precisionTarget: number | null = config.precisionTarget ?? null

  const service: ManaUserModelService = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, precisionTarget }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-user-model', service)
    return () => dispose()
  }, 'dsh-mana-user-model: service')

  // G9 结构约束：waterfall 监听器必须调 next()。
  registerPassThroughPreStep(ctx, name)
}

export type { ManaCoreService }
