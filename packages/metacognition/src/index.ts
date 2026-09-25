/**
 * `dsh-mana-metacognition` —— 末那识·审（置信度 / 知识缺口）骨架 + **可移植判据阈值层**（B5.1）。
 *
 * 本批两件事：
 *  ① **骨架**（P2 之一）：`name` / `inject` / `Config` / `apply` 四件齐；`apply` 注册一条
 *     `agent/pre-step` waterfall 直通监听器（G9：不调 `next()` 会静默吞掉下游）。
 *  ② **判据阈值层**：从 shoucang 移植「注册表 + 生成器 + 投影 + 读口」四件套（见 src/criteria.ts）。
 *
 * ⚠ 为什么必须连生成器与注册表一起搬（册:555）：
 *   只搬 `lib/criteria.js` 会得到一份**没有真源**的数值副本 —— 数值从哪来不可追，
 *   改了也不生效，正是 shoucang 自己在 `thresholdValue()` 注释里登记的「假旋钮」形态。
 *   故本包内保留：`skill/engine/criteria.json`（真源）+ `scripts/gen-criteria.mjs`（唯一生成器）
 *   + `src/criteria.generated.ts`（投影，禁手写）+ `src/criteria.ts`（唯一读口）。
 *
 * ⚠ 模型不生成记忆内容（A4-3）：本插件只写 id / 数值字段，不写 `memory_items.content`。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import { CRITERIA_VERSION, thresholdValue, thresholdParam, splitLawOf } from './criteria.ts'
import { createProfileIndex, type ProfileIndex, type ProfileVerdictOf } from './profile-index.ts'

export const name = 'mana-metacognition'

/** 依赖 core（契约唯一归属地）。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 是否启用判据阈值层（关 = 只立骨架，不读注册表）。 */
  criteriaEnabled: boolean
  /**
   * 置信度目标值（A4-1 阈值「待定，需拍板」）——**本批不设默认值以外的主张**；
   * 显式声明为「未拍板」而非编一个数：缺省 `null` = 未校准，判据不生效。
   *
   * ⚠ **本键当前零消费者**（`grep -rn confidenceTarget packages` 只命中本文件与测试），
   *   故此处**不改行为、只除谎**：见 `Config` 下方实测 —— `.default(null)` 在本仓 schemastery
   *   版本上**从不生效**，留着只会读成「有缺省」。真正接它的是后续批次（B5.2/A4-1 拍板时）；
   *   接的人必须照 `packages/user-model/src/index.ts` 的 `apply` 同法对缺席键显式归一为 `null`，
   *   不要把 `undefined` 漏进「=== null 即未校准」的判据（那会把「没拍板」静默读成「已校准」）。
   */
  confidenceTarget: number | null
}

export const Config: Schema<Config> = Schema.object({
  criteriaEnabled: Schema.boolean().default(true),
  // ⚠ 本行**故意不写 `.default(null)`**：本仓 schemastery 3.18.4 会把 null 缺省静默丢弃
  //   （实测：`{p: union([number, const(null)]).default(null)}({})` → `{}`，p 根本不出现；
  //    对照 `number().default(0.5)` → `{x:0.5}` 生效）。从不生效的缺省 = 假旋钮。
  confidenceTarget: Schema.union([Schema.number(), Schema.const(null)]),
})

/** 本插件对外服务面。`criteria` 段即移植来的阈值层读口。 */
export interface ManaMetacognitionService {
  readonly plugin: string
  status(): { plugin: string; wired: boolean; criteriaVersion: string; criteriaEnabled: boolean }
  /** 登记阈值读口（唯一合法路径：`thresholdValue`，见 criteria.ts 判因）。 */
  threshold(id: string, fallback: unknown): unknown
  /** 对象型阈值取键读口。 */
  thresholdParam(id: string, key: string, fallback: unknown): unknown
  /** 分裂律 R/K 读口。 */
  splitLaw(): { R: number; K: number }
  /**
   * 双画像（AGENT.md / USER.md）的**统一写入口**（L-04 · v10 §17.2）。
   *
   * `null` = 本插件装配时 **mana-user-model 尚不在位** ⇒ 退场判定无实现（不静默降级出
   * 一份本地判定来顶替：那正是"同一条判据两处实现"）。
   * 生产路径上两插件同批装配（`inject` 只声明 mana-core，故 user-model 可能后到；
   * 宿主按需调用 `profileIndex()` 取用，拿到什么就是什么）。
   */
  profileIndex(): ProfileIndex | null
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-metacognition': ManaMetacognitionService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-metacognition: 缺少 mana-core 服务（inject 未满足）')

  const service: ManaMetacognitionService = {
    plugin: name,
    status: () => ({
      plugin: name,
      wired: true,
      criteriaVersion: CRITERIA_VERSION,
      criteriaEnabled: config.criteriaEnabled,
    }),
    threshold: (id, fallback) => thresholdValue(id, fallback),
    thresholdParam: (id, key, fallback) => thresholdParam(id, key, fallback),
    splitLaw: () => splitLawOf(),
    /**
     * 每次调用当场解析（**不缓存**）：user-model 可能在本插件之后才装上，
     * 缓存一个 null 会把"暂时没有"变成"永远没有"，而这在读数上与"没装"同形。
     * 代价是每次两下 `ctx.get`（O(1) 查表），换来的是「装配顺序不影响可用性」。
     */
    profileIndex: () => {
      const um = ctx.get('mana-user-model') as { injectionVerdict?: unknown } | undefined
      if (um && typeof um.injectionVerdict === 'function') {
        return createProfileIndex(core, um.injectionVerdict as ProfileVerdictOf, config.confidenceTarget ?? null)
      }
      return null
    },
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-metacognition', service)
    return () => dispose()
  }, 'dsh-mana-metacognition: service')

  // G9 结构约束：waterfall 监听器必须调 next()，否则下游静默失声。
  registerPassThroughPreStep(ctx, name)
}

export { CRITERIA_VERSION }
export type { ManaCoreService }
