/**
 * `dsh-mana-prompts` —— Mana **Prompt 模板库**（v10 §25 的 20 个常量的唯一真源）。
 *
 * ── 本包是什么 / 不是什么 ────────────────────────────────────────────────────────
 *   · **是**：§25.1–25.8 二十条 Prompt 的落点（15 个 `JevQuestion` + 5 个 LLM system
 *     prompt 模板），外加一张**注册表**（`PROMPT_REGISTRY`）与一个**自检入口**
 *     （`verifyPrompts()`），使「20 条都在、类型都对」这件事**可机检**。
 *   · **不是**：不渲染模板、不调 LLM、不判定、不写库、**不注册任何监听器**。
 *     本包是纯数据 + 纯函数包。
 *
 * ── 为什么 `apply` 里**不**注册 waterfall 直通（与本仓多数包不同）──────────────────
 *   本仓 G9 要求「**注册了监听器**就必须调 `next()`」。本包**一个监听器都不注册**
 *   ⇒ 不存在吞掉下游的通道，G9 在本包上**无适用面**（与 `ui` 包同形：它也不经
 *   `registerPassThroughPreStep`）。刻意注册一条空直通只会制造「看起来在监控」的假象
 *   ——那正是本仓最防的形态之一。
 *
 * ── `JevQuestion` 的唯一真源在 `packages/jev`（本包**不**重新定义）────────────────
 *   本包类型面走 `../../jev/lib/types/systemone.js`。**为什么不是** `import … from 'dsh-mana-jev'`：
 *   `jev` 的 `index.ts` **没有** re-export `JevQuestion`，故按包名取会得到
 *   `TS2305: Module 'dsh-mana-jev' has no exported member 'JevQuestion'`；
 *   而直接 import `../../jev/src/systemone.ts` 会因 `rootDir` 限制报
 *   `TS6059`（且 `rewriteRelativeImportExtensions` 会把 `.ts` 改写成 `.js` ⇒ 运行时
 *   `MODULE_NOT_FOUND`）。三条路实测只有 **lib/types** 这条同时满足编译与运行
 *   —— 与 `packages/consolidation/src/vector-cosine.ts` 记录的同一结论同源。
 *   ⚠ 该路径指向 jev 的**构建产物** ⇒ 前置条件：`packages/jev` 必须先 `npm run build`
 *   （本仓 `lib/` 由 `tsc` 直出且**不入版本**，故这是本包构建的真实前置）。
 *
 * ── 「两个真源」的防复发 ──────────────────────────────────────────────────────────
 *   判据侧另写一份 20 个名字的对照表，与「模块真实导出集」「注册表」做**三方集合相等**：
 *   只留一份清单的话，删一条常量 + 把常数改小，断言照样全绿（本仓 forgetting 包的原话）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis'
import {
  PROMPT_REGISTRY,
  UNWIRED_PROMPT_NAMES,
  verifyPrompts,
  type PromptEntry,
  type PromptFinding,
} from './registry.ts'

/** 插件名（`inject` 用的名字）。与 `packages/prompts/package.json` 的目录推导值一致。 */
export const name = 'mana-prompts'

/**
 * 依赖面：**空**。
 *
 * 本包**不消费** `mana-core`（不注册监听器、不读服务、不写库），若声明它便是假依赖。
 * 与 `jev` 的类型关系是**编译期**的（`import type` 在产物里被完全擦除），不构成运行期依赖，
 * 故也不进 `inject`。
 */
export const inject: string[] = []

export interface Config {
  /**
   * 自检是否要求「该带占位符的模板必须真带 `{{...}}`」。
   *
   * 关掉（`false`）⇒ `verify()` 少一条腿。这是**调试/迁移**用的放宽口，
   * **默认必须为 true**：占位符丢了会让模板静默地不再变量化，
   * 而那正是 §25.6 「路径应该是变量化的」这条要求的失效形态。
   */
  requireTemplateVariables: boolean
  /**
   * 自检期望的常量总数（缺省 20 = v10 §25 的条目数）。
   *
   * ⚠ 本键**不是**第二份真源：真源是源码里真实导出的常量集，
   *   本值只用来把「有人删了一条」变成**可读的 findings**（否则缺失只表现为集合变小）。
   *   与注册表实际条数不等 ⇒ `verify()` 产出 `registry-size` 一条。
   */
  expectedConstantCount: number
}

/** 条目计数的分桶读数（由注册表**派生**，不手写常数）。 */
export interface PromptCounts {
  readonly total: number
  readonly jevStatic: number
  readonly jevFactory: number
  readonly systemTemplate: number
  /** `wired=false` 的条数（§25.8 两条：定义在册但**不得接线**）。 */
  readonly unwired: number
}

export interface ManaPromptsService {
  readonly plugin: string
  /** 注册表（只读快照；与源码导出同源）。 */
  readonly registry: readonly PromptEntry[]
  /** 按导出名取一条。 */
  get(name: string): PromptEntry | undefined
  /** 分桶计数。 */
  counts(): PromptCounts
  /** 全量自检（**读**当前配置的两枚旋钮）。返回问题清单，空 = 全过。 */
  verify(): readonly PromptFinding[]
  status(): {
    plugin: string
    wired: boolean
    total: number
    expected: number
    findings: number
    requireTemplateVariables: boolean
    /** §25.8 两条（**不接线**）的名字，供宿主/面板如实显示。 */
    unwired: readonly string[]
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-prompts': ManaPromptsService
  }
}

export const Config: Schema<Config> = Schema.object({
  requireTemplateVariables: Schema.boolean().default(true),
  expectedConstantCount: Schema.number().default(20),
})

/** 由注册表派生的分桶计数（**不手写 15/5/2 之类常数**：那会造出会漂的第二份真源）。 */
function countsOf(registry: readonly PromptEntry[]): PromptCounts {
  return {
    total: registry.length,
    jevStatic: registry.filter((e) => e.kind === 'jev-static').length,
    jevFactory: registry.filter((e) => e.kind === 'jev-factory').length,
    systemTemplate: registry.filter((e) => e.kind === 'system-template').length,
    unwired: registry.filter((e) => !e.wired).length,
  }
}

export function apply(ctx: Context, config: Config): void {
  /**
   * ⚠ 两枚配置键**真参与判断**（本仓纪律：配置键不得是「哪里都提到它、但没有一处拿它做判断」
   *   的死开关）。`requireTemplateVariables` 进 `verify()` 的腿选择；
   *   `expectedConstantCount` 进规模比较。两者的**可观测差异**由本包判据⑥负控实测。
   */
  const requireTemplateVariables = config.requireTemplateVariables === true
  const expected = config.expectedConstantCount

  const service: ManaPromptsService = Object.freeze({
    plugin: name,
    registry: PROMPT_REGISTRY,
    get: (key: string): PromptEntry | undefined => PROMPT_REGISTRY.find((e) => e.name === key),
    counts: (): PromptCounts => countsOf(PROMPT_REGISTRY),
    verify: (): readonly PromptFinding[] =>
      verifyPrompts({ requireTemplateVariables, expectedConstantCount: expected }),
    status: () => ({
      plugin: name,
      wired: true,
      total: PROMPT_REGISTRY.length,
      expected,
      findings: verifyPrompts({ requireTemplateVariables, expectedConstantCount: expected }).length,
      requireTemplateVariables,
      unwired: UNWIRED_PROMPT_NAMES,
    }),
  })

  ctx.effect(() => {
    const dispose = ctx.provide('mana-prompts', service)
    return () => dispose()
  }, 'dsh-mana-prompts: service')
}

// ── 二十个常量与自检面的**公共导出**（宿主/其它包只读消费）──────────────────────
export {
  PROMPT_REGISTRY,
  UNWIRED_PROMPT_NAMES,
  verifyPrompts,
  type PromptEntry,
  type PromptFinding,
  type PromptKind,
  type VerifyOptions,
} from './registry.ts'

export {
  WRITE_GATE_PROMPT,
  SUPERSEDES_PROMPT,
  EMOTION_VALENCE_PROMPT,
  EMOTION_AROUSAL_PROMPT,
} from './encoding.ts'
export {
  CONSOLIDATION_TRIGGER_PROMPT,
  CHUNKING_UTILITY_PROMPT,
  SLEEP_INDICTION_SYSTEM_PROMPT,
} from './consolidation.ts'
export {
  INTENT_CLASSIFICATION_SYSTEM_PROMPT,
  RECALL_GATE_PROMPT,
  INJECTION_GATE_PROMPT,
} from './retrieval.ts'
export { RECONSOLIDATION_UPDATE_PROMPT } from './reconsolidation.ts'
export { ACTIVITY_LEVEL_PROMPT, COMPRESSION_SYSTEM_PROMPT } from './forgetting.ts'
export { PRINCIPLE_EXTRACTION_SYSTEM_PROMPT, PATH_INDUCTION_SYSTEM_PROMPT } from './learning.ts'
export { UNFAMILIAR_TASK_PROMPT, TOOL_ROUTING_PROMPT, SAFETY_GATE_PROMPT } from './scheduling.ts'
export { TASK_COMPLEXITY_PROMPT, RESULT_CLASSIFICATION_PROMPT } from './itacl.ts'
