/**
 * Mana 事件契约 v0.1（S1 五类）
 *
 * ⚠ **契约唯一归属地**（落地册 §8 C13）：其余 Mana 插件**禁止**自建 `event-types.ts`，
 *   一律 `import type {} from 'dsh-mana-core'` 取得本模块的声明合并效果。
 *
 * ⚠ **分发方式纪律**（方案 §9.4 的死契约，落地册 §2 G6）：
 *   - `mana/jev/judge` 是 **waterfall** 型 ⇒ 必须 `ctx.waterfall('mana/jev/judge', req, next)`。
 *     用 `ctx.emit()` 分发 waterfall 型事件会**同步抛** `TypeError: next is not a function`
 *     （cordis 的 map 分发路径），且错误位置远离真因。
 *   - 只观察 / 只记录的 waterfall 监听器**必须调用 `next()`**，否则会**无声地**吞掉下游
 *     全部默认行为（DSH 明文纪律）。Mana 的 Injection Gate 若挂 `agent/pre-step` 而漏调
 *     `next()`，会静默掐死用户既有的热记忆注入与 MCL 慢通道（G9）。
 *
 * ⚠ **事件命名前缀**：本契约的事件名统一用 `mana/` 前缀。落地册 §2 G9 提到的
 *   `agent/pre-step` 是 **DSH 官方扩展点**（非 Mana 事件），其声明在宿主包内，
 *   本插件只消费、不声明 —— 见 `src/pre-step.ts`。
 */
import type {
  JevJudgeRequest,
  JevJudgeResult,
  ManaAttention,
  ManaDecision,
  ManaInjection,
  ManaObservation,
  ManaPluginInactive,
  ManaRecall,
} from './domain.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    // ── S1 五类（v0.1 冻结范围；A1-1 按 event_type 机检五类各 ≥1）────────────
    /** 前五识：感知。@mode emit —— 通知类，不等待、不收集返回值。 */
    'mana/observation'(this: unknown, payload: ManaObservation): void
    /** 作意：注意力门控放行。@mode emit */
    'mana/attention'(this: unknown, payload: ManaAttention): void
    /** JEV 决策结果（含降级态）。@mode emit */
    'mana/decision'(this: unknown, payload: ManaDecision): void
    /** 召回：检索候选与排序依据。@mode emit */
    'mana/recall'(this: unknown, payload: ManaRecall): void
    /** 注入审计（含"没注入"的五种情形）。@mode emit */
    'mana/injection'(this: unknown, payload: ManaInjection): void

    // ── JEV 判定链（waterfall：请求与结果分离，靠 requestId 回填）────────────
    /**
     * JEV 判定请求。@mode waterfall
     * ⚠ 必须用 `ctx.waterfall(...)` 分发；用 `emit` 会同步抛 TypeError（G6）。
     */
    'mana/jev/judge'(
      this: unknown,
      req: JevJudgeRequest,
      next: () => Promise<JevJudgeResult>,
    ): Promise<JevJudgeResult>
    /** JEV 判定结果旁路广播：判定值结构上无法只从 waterfall 返回值取得时，靠它带回。@mode emit */
    'mana/jev/judged'(this: unknown, payload: JevJudgeResult): void

    // ── 可观测性（阶段 2 约束「未运行必须可查」）──────────────────────────
    /** 某插件因依赖缺失未运行。@mode emit */
    'mana/plugin/inactive'(this: unknown, payload: ManaPluginInactive): void
  }
}

export type {
  JevJudgeRequest,
  JevJudgeResult,
  ManaAttention,
  ManaDecision,
  ManaEnvelope,
  ManaInjection,
  ManaObservation,
  ManaPluginInactive,
  ManaRecall,
  InjectionGate,
  ManaStage,
} from './domain.ts'
