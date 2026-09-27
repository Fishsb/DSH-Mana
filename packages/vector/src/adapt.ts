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
  /**
   * **稠密候选腿读数**（契约外增量字段；**可缺省**：不填该字段即不存在，既有构造点不必逐个改）。
   *
   * 为什么必须有它（本仓硬要求「输入量须可见化」）：本腿是**唯一**会去扫库的候选来源，
   * 而它的两种"产出 0 条"在结果面上同形 ——
   *   · 库里**没有已嵌入行**（`scanned = 0`）：本次**没得扫**；
   *   · 扫了 `scanned > 0` 行而都**没进候选池**（`candidates = 0`）：**扫了但不相近**。
   * 没有本字段，这两件事都会表现为「本次 0 命中」，事后无法反查是哪一种。
   * 同理，列举 SQL 失败必须给**具名** `unavailableReason`（不得静默折成空候选）。
   *
   * ⚠ **缺省字段的三种读法**（互不冒充，消费方须显式区分）：
   *   · `undefined`          = **本腿本次未尝试扫描**（未启用 / 请求池已由调用方给足）；
   *   · `ran = false`    = **尝试过但没扫成**（`unavailableReason` 具名，`scanError` 标真故障）；
   *   · `ran = true`     = 真扫过：`scanned`（读了多少行）/ `candidates`（进了池几条）逐项可核。
   * ⚠ 它**不改变** `channel` / `rankBy` / `degraded` / `hitCount` / `items`
   *   任何一个的语义：本腿只管"候选怎么来"，不决定结果的态度（理由见 `recall.ts` 文件头）。
   */
  readonly dense?: DenseCandidateReadout
}

/**
 * 稠密候选腿的**读数面**（`RecallOutcome.dense` 的类型）。
 *
 * ⚠ 本类型刻意放在契约文件里：它是**信封的字段形状**，不是实现细节 ——
 *   放这里才不会出现"契约面与实现面各存一份读数"（本仓最防的漂移形态）。
 */
export interface DenseCandidateReadout {
  /** 配置要求跑吗（`enabled`）；与 `ran` 分列，使「没开」与「开了没跑成」不互相冒充。 */
  readonly enabled: boolean
  /** 本次是否**真的扫过库**（`false` 时 `unavailableReason` 必非空）。 */
  readonly ran: boolean
  /** 未跑成的原因（**具名**，可枚举口径见 `recall.ts` 的 `DENSE_UNAVAILABLE`）；跑成时为 `null`。 */
  readonly unavailableReason: string | null
  /** 相似度下限（低于它不进池）。 */
  readonly threshold: number
  /** 扫描上限（行）。 */
  readonly scanRows: number
  /** 取名次上限（条）。 */
  readonly topN: number
  /** **实际读到**的行数（N=0 显式记 0；这是"没得扫"与"扫了不命中"的分辨点）。 */
  readonly scanned: number
  /** 其中余弦 ≥ `threshold` 的条数（**与 `candidates` 不是一回事**：过阈值的可能多于取数上限）。 */
  readonly matched: number
  /** 扫描上限是否**被用满**（= 库中可能还有未扫到的行；**不等于**确定被截断，见实现注释）。 */
  readonly scanLimitReached: boolean
  /** 真正进了候选池的键与名次（按余弦降序、同分按 key 升序）。 */
  readonly candidates: readonly DenseCandidate[]
  /** 与 `candidates` **逐位对齐**的余弦读数（平行数组，便于判据逐条取证）。 */
  readonly candidateSims: readonly number[]
  /** 扫到而**没进池**的键，逐条具名原因（"量过而漏掉"不得与"从未扫到"同形）。 */
  readonly omitted: readonly DenseOmission[]
  /** 列举失败是"真故障"（`true`，必须与"扫了但没有候选"可分辨）。 */
  readonly scanError: boolean
}

/** 稠密腿产出的一条候选（**只有键与名次**：刻意不带相似度，见 `recall.ts` 文件头声明②）。 */
export interface DenseCandidate {
  /** 稳定键（本仓口径 = `memory_items.id`）。 */
  readonly key: string
  /** 稠密名次（从 1 起，按余弦降序、同分按 key 升序 ⇒ 逐位可复现）。 */
  readonly denseRank: number
}

/** 一条"扫到但没进候选池"的具名原因。 */
export interface DenseOmission {
  readonly key: string
  /** 人可读原因（**具名**）；不复用空串。 */
  readonly reason: string
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
