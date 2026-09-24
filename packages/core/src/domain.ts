/**
 * Mana 领域模型（v0.1）
 *
 * ⚠ **本文件是 Mana 契约的唯一归属地**（落地册 §8 C13）：其余插件**禁止**自建
 * `event-types.ts` 或重复声明这些类型。声明一旦分散，编译期护栏失效、错误推迟到运行期。
 *
 * 关联键统一为 `requestId`（落地册 阶段 0 B0.2 ④）：方案的示例里请求用 `id`、结果用
 * `requestId`，两者不一致 ⇒ 判定结果无法回填到请求，本文件统一为 `requestId`。
 *
 * 灰度分版（§8 C11）：v0.1 只冻 S1 五类事件所需的模型；长时记忆（v0.2）、
 * 巩固遗忘（v0.3）的模型在各自阶段以**新增**方式引入，不破坏既有订阅者。
 */

/** 认知阶段标识：用于 mana_trace 的 event_type 与领域事件的对应（A1-1 机检五类各 ≥1）。 */
export type ManaStage = 'observation' | 'attention' | 'decision' | 'recall' | 'injection'

/** S1 五类 stage 的枚举（唯一真源，机检与生产侧共用）。 */
export const MANA_STAGES: readonly ManaStage[] = [
  'observation',
  'attention',
  'decision',
  'recall',
  'injection',
] as const

/**
 * 注入门控的判定结果 —— **枚举列，生产侧写死，消费侧只读**（阶段 1 表落点声明）。
 *
 * ⚠ 五类之外**不得留空、不得用 undefined 表状态**：既有教训是 undefined 会被事件信封 /
 * JSON 序列化**静默丢键** ⇒「判不了」与「判不准」不可分辨。
 * ⚠ fail-closed 门控的正常态与故障态表面同形（都表现为"没注入"）⇒ 这五种取值是让
 *   「没注入」可分辨的唯一手段（A1-13 / A1-14）。
 */
export type InjectionGate =
  | 'injected'
  | 'skip_no_candidate'
  | 'skip_below_threshold'
  | 'degraded_unavailable'
  | 'reset'

/** 同上，作为运行期可校验的常量集合（生产侧写库前用它断言）。 */
export const INJECTION_GATES: readonly InjectionGate[] = [
  'injected',
  'skip_no_candidate',
  'skip_below_threshold',
  'degraded_unavailable',
  'reset',
] as const

/** 每条事件信封共有的追踪字段。 */
export interface ManaEnvelope {
  /** 会话标识（G3：方案六张表无此列，I1/I2 不变式因此无可数之处）。 */
  sessionId: string
  /** 轮次（G3，同上）。 */
  turnId: number
  /** 关联键：请求与结果靠它回填，统一为 requestId（B0.2 ④）。 */
  requestId: string
  /** 发生时刻（ISO 8601，UTC）。 */
  at: string
}

/** 一、observation —— 前五识：感知（输入采集的原始观察）。 */
export interface ManaObservation extends ManaEnvelope {
  /** 观察内容原文。 */
  content: string
  /** 来源通道，如 'user-message' / 'tool-result'；未知时显式写 'unknown'。 */
  source: string
}

/**
 * 二、attention —— 作意：注意力门控放行后的聚焦项。
 *
 * `jevProbability` 为该次放行的 JEV 概率；`degraded` 为真时表示判定链路降级
 * （G8：降级**必须落显式字段**，禁止 `catch { return null }` 式把失败与正常空结果混同）。
 */
export interface ManaAttention extends ManaEnvelope {
  /** 聚焦项内容。 */
  content: string
  /** 该次放行的 JEV 概率；降级时为 null（不得用 0 冒充「概率为零」）。 */
  jevProbability: number | null
  /** 判定链路是否降级（降级必须显式，不得静默）。 */
  degraded: boolean
}

/** 三、decision —— JEV 决策：一次判定的结果（含失败 / 降级态）。 */
export interface ManaDecision extends ManaEnvelope {
  /** 判定类型，如 'noul' / 'choice'。 */
  judgeType: string
  /** 判定来源模块，如 'attention'。 */
  source: string
  /** 判定值：'yes' / 'no' / 'unknown'。降级时必须为 'unknown'，不得默认成 'no'。 */
  value: 'yes' | 'no' | 'unknown'
  /** 判定概率；不可用时为 null（**不得用 0 冒充**）。 */
  probability: number | null
  /** 判定链路是否降级。 */
  degraded: boolean
  /** 降级 / 失败原因；未降级时为 null。 */
  reason: string | null
}

/** 四、recall —— 召回：检索到的候选及其排序依据。 */
export interface ManaRecall extends ManaEnvelope {
  /** 检索查询串。 */
  query: string
  /** 命中条数（0 是合法值，且**必须与「库空」可分辨** —— G5）。 */
  hitCount: number
  /** 本次召回实际走到的通道：'vector' / 'lexical' / 'degraded'。 */
  channel: 'vector' | 'lexical' | 'degraded'
  /** 排序依据字段名（A1-11：降级时必须是 'local_score' 而非 'jev_prob'）。 */
  rankBy: string
  /** 本次召回是否降级。 */
  degraded: boolean
}

/** 五、injection —— 注入：写入上下文的一条注入块（含未注入的五种情形）。 */
export interface ManaInjection extends ManaEnvelope {
  /** 被测门控判定结果（五种枚举之一，见 InjectionGate）。 */
  gate: InjectionGate
  /** 注入块 id；未注入时为 null。 */
  blockId: string | null
  /** 被注入记忆的 id；未注入时为 null。 */
  memoryId: string | null
  /** 本次是否降级。 */
  degraded: boolean
}

/** 插件未运行的可查记录（阶段 2 约束「未运行必须可查」的事件载荷）。 */
export interface ManaPluginInactive {
  /** 未运行的插件 id。 */
  id: string
  /** 缺失的依赖服务名列表。 */
  missing: string[]
  /** 记录时刻（ISO 8601）。 */
  at: string
}

/** JEV 判定请求：**waterfall** 型事件（必须用 `ctx.waterfall(...)` 分发，用 emit 会同步抛错）。 */
export interface JevJudgeRequest {
  requestId: string
  judgeType: string
  /** 待判定状态文本。 */
  state: string
  question: string
  threshold: number
  source: string
}

/** JEV 判定结果：与 requestId 回填对应。 */
export interface JevJudgeResult {
  requestId: string
  source: string
  value: 'yes' | 'no' | 'unknown'
  probability: number | null
  degraded: boolean
  reason: string | null
}
