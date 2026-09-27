/**
 * 向量适配服务接口与降级链（B1.1）。
 *
 * 三条设计取舍（**与 `cosine.ts` 的分工是刻意的**）：
 *
 * 1. **降级必须落显式字段**（`docs/contract/degradation.md` 硬约定 3）：任何失败路径返回
 *    `{ degraded:true, reason:<非空>, channel:'degraded', rankBy:'local_score' }`，
 *    **禁 `catch { return null }`**（本机 shoucang `embedMany` 就是该形态：provider 失败
 *    与正常空结果同形 ⇒ 向量档「看起来跑通、实际全走词法」查不出）。
 * 2. **`embedMany` 返回 `null` 的上游语义原样保留**，但**调用方（本适配层）必须把它翻译成
 *    显式降级**，不得把 `null` 透传出去 —— 「上游用 null 表不可用」与「本层也静默」是两件事。
 * 3. **`rankBy` 降级时必须是 `'local_score'`**（A1-11 原文：而非 `jev_prob`）：降级路径上
 *    根本没有 JEV 概率，若还写 `jev_prob`，下游会把「没判」读成「判了且是低分」。
 */
import { assertDim } from './cosine.ts'

/** 查询串长度上限（上游 `embedMany` 内部 `slice(0,512)` 的同一口径，显式提到本层以便取证）。 */
export const QUERY_MAX_CHARS = 512

/** 嵌入端点缺省：本机 Ollama 的 OpenAI 兼容面（`/api/embed` 另走原生面，见 `embed.ts`）。 */
export const DEFAULT_EMBED_BASE_URL = 'http://127.0.0.1:11434/v1'
export const DEFAULT_EMBED_MODEL = 'bge-m3'

/**
 * 嵌入失败的**可枚举归类**（与 `WRITE_GATE_FAILURE_KINDS` / `RECALL_GATE_FAILURE_KINDS` 同形）。
 *
 * **为什么需要它**（本仓最忌的形态 · 本卡的由来）：「服务端没开嵌入能力」（环境配置问题）与
 * 「请求本身出错」（调用问题）**原先在读数上同形** —— 两者都落进同一段 reason 通用串
 * 「嵌入请求失败（…）」/「嵌入端点返回 HTTP N」。后果有二：
 *   ① 真因不可见（失败不可观测）；
 *   ② **排查方向被带偏**：读「嵌入请求失败」会去查网络/模型名，而真因是**服务端启动参数**。
 *
 * 取值口径（**只增取值、不改既有取值含义**）：
 * · `'degraded'` —— **通用失败兜底**：网络不可达 / 超时 / 任何非 2xx / 响应格式 / 维度契约…
 *   （这些**不得**被新归类吞掉，故它们仍全部落这里）。
 * · `'unsupported-by-server'` —— 服务端**明确回**「本服务不支持嵌入」。识别按**语义特征**
 *   （见 `embed.ts` 的 `isUnsupportedByServer`），**不按状态码、不按全串相等**。
 */
export const EMBED_FAILURE_KINDS = [
  /** 通用失败兜底（未细分的降级全部在此，**不得用 null 冒充**）。 */
  'degraded',
  /** 服务端明确回「不支持嵌入」⇒ 处置方向是**服务端启动参数**，不是网络/模型名。 */
  'unsupported-by-server',
] as const
export type EmbedFailureKind = (typeof EMBED_FAILURE_KINDS)[number]

/** 一次嵌入调用的**结果信封**：成功与失败都是**同一个形状**，失败不靠"缺字段"表达。 */
export interface EmbedOutcome {
  /** 成功时的向量；失败时**为空数组**（不是 `undefined` —— 空数组是"确实没有"，`undefined` 会被 JSON 静默丢键）。 */
  readonly vectors: readonly Float32Array[]
  /** 实际用到的模型 id（降级时也填：便于区分「模型选错」与「端点不通」）。 */
  readonly model: string
  /** 实际使用的基础地址（**降级原因里必须带它**，否则"哪个端点不通"不可查）。 */
  readonly baseUrl: string
  /** 是否降级。 */
  readonly degraded: boolean
  /**
   * 降级**归类**（可枚举、可断言）；**未降级时为 `null`**。
   * ⚠ **只增取值**：既有字段语义与本字段既有取值含义均冻结（本卡不改 Events 契约）。
   */
  readonly failureKind: EmbedFailureKind | null
  /** 降级原因；未降级时为 `null`（**不空串、不 undefined**）。 */
  readonly reason: string | null
  /** 本次耗时（B 档浮动量：**只进测量条件说明，不得进阈值列**）。 */
  readonly ms: number
}

/** 一次召回的**结果信封**（对应领域模型 `ManaRecall` 的可枚举字段面）。 */
export interface RecallOutcome {
  readonly query: string
  readonly hitCount: number
  readonly channel: 'vector' | 'lexical' | 'degraded'
  readonly rankBy: string
  readonly degraded: boolean
  readonly reason: string | null
  /** 融合后的命中（降级时为**有序的本地分结果**，不是空 —— 有资格不落空）。 */
  readonly items: readonly { key: string; score: number; rank: Record<string, number>; hits: number }[]
}

/** 把任意失败折叠成显式降级信封（**唯一**构造失败信封的出口，避免各处手写漏字段）。 */
export function degradedOutcomeQuery(
  model: string,
  baseUrl: string,
  reason: string,
  ms: number,
  /** 归类；**缺省 = 通用失败**（既有调用点不传即保持原含义，不必逐个改）。 */
  failureKind: EmbedFailureKind = 'degraded',
): EmbedOutcome {
  return { vectors: [], model, baseUrl, degraded: true, failureKind, reason: reason || '未给出原因（调用方漏填）', ms }
}

/**
 * 校验一批向量的维度契约（A1-12：`dim` 必须 == 1024）。
 * 返回 `null` = 通过；否则返回**首个**不符项的原因（含下标，便于定位是第几段文本）。
 */
export function checkBatchDim(vectors: readonly Float32Array[], dim: number): string | null {
  if (!vectors.length) return '嵌入返回空数组（上游 HTTP 200 但无数据）'
  for (let i = 0; i < vectors.length; i++) {
    const reason = assertDim(vectors[i], dim)
    if (reason) return `第 ${i} 条：${reason}`
  }
  return null
}
