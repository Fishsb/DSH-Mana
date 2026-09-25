/**
 * B1.2 · 单 token logprob 判定原语（本机 Ollama 承载）。
 *
 * 载体：`POST /api/chat` + `think:false` + `logprobs:true` + `top_logprobs:5`
 *       + `num_predict:1` + `temperature:0`，从 **pos0** 取候选并归一 `yes/no`。
 *
 * ── 本文件要防的两类失败（都有现场证据，不是假想）─────────────────────────────
 *
 * **① 大小写是两个不同 token（静默算错）**
 *   本机实测（2026-09-24，`qwen3.5:0.8b`）：pos0 的 `top_logprobs` 同时含 `Yes` 与 `yes`
 *   两个**独立词表项**，`No`/`no` 同理。若归一化只匹小写，大写那条会被**静默丢弃**
 *   ⇒ 概率算错而代码不报任何错。故归一按 `token.trim().toLowerCase()` 归族，
 *   且**逐项保留**命中的原始词表项（见 `TokenCandidate`），
 *   使「到底匹到了哪几个 token」成为**可枚举断言**而不是注释承诺。
 *
 * **② 降级与正常空结果同形（G8）**
 *   禁止 `catch { return null }`。本文件**没有**任何 `return null` 式的失败出口：
 *   所有失败都落 `degraded:true` + **非空** `reason`，且 `probability` 为 `null`
 *   （契约明令：概率不可用 ⇒ `null`，**不得用 `0` 冒充**）。
 *   更进一步：`JudgeOptions.db` 存在时，**每一条路径**都必须写一行 `jev_log`
 *   —— 这靠 `finish()` 作为唯一出口来**结构性保证**，而不是靠调用方记得落痕。
 *
 * ⚠ 本模块**不**做缓存 / 熔断 / 冷却 / 并发上限 / 预算（B1.3 在 `framework.ts`，本模块保持"纯判定原语"）。
 *   `state_hash` 已填（sha256 前 16 位，A 档确定性值），供下一轮接缓存键。
 */
import type { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { jevGateOf, writeJevLogRow } from './jev-log-gate.ts'

/** 端点缺省值。`path` 由调用方拼（见 `chatUrl`）。 */
export const OLLAMA_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'

/** 选型：`qwen3.5:0.8b`（方案禁 `qwen3:8b` —— 其 "yes" 概率 1.000 饱和、无区分度）。 */
export const JEV_DEFAULT_MODEL = 'qwen3.5:0.8b'

/** 本机通道标识（落 `JevJudgeOutcome.channel`；适配层缺省通道就是它）。 */
export const OLLAMA_CHANNEL = 'ollama'

/** pos0 —— 只取首个生成位置。取错位置会拿到「解释文本」而非判定 token。 */
export const JEV_POS_INDEX = 0

/** 候选档数。契约口径 5。 */
export const JEV_TOP_LOGPROBS = 5

/** pos0 的一个候选词表项。`logprob` 是**自然对数**概率，不是概率本身。 */
export interface TokenCandidate {
  /** 词表原始 token（**保留原大小写**，归一后仍可枚举）。 */
  token: string
  /** 自然对数概率（Ollama 原样返回）。 */
  logprob: number
}

/** 归一结果：可枚举、可逐项断言。 */
export interface YesNoNormalization {
  /** `yes` 族（含 `Yes`/`yes`）概率之和。契约口径：不重归一，直接求和。 */
  pYes: number
  /** `no` 族（含 `No`/`no`）概率之和。 */
  pNo: number
  /** 命中的 yes 族原始词表项 —— 逐项保留，供「大写没被漏掉」的断言。 */
  yesFamily: TokenCandidate[]
  /** 命中的 no 族原始词表项。 */
  noFamily: TokenCandidate[]
  /** 未命中任何一族的 token（如 `<think>`）；**显式列出**，不静默丢弃。 */
  unmatched: TokenCandidate[]
}

/** 判定结果（`JevJudgeResult` 的超集：带上取证字段，便于 handoff 逐项对账）。 */
export interface JevJudgeOutcome {
  requestId: string
  requestType: string
  source: string
  /** 契约三态。判定失败 ⇒ `'unknown'`，**不得默认成 `'no'`**。 */
  value: 'yes' | 'no' | 'unknown'
  /** 概率不可用 ⇒ `null`。**不得用 `0` 冒充**。 */
  probability: number | null
  degraded: boolean
  /** `degraded:true` 时必须是**非空字符串**；正常路径必须是 `null`。 */
  reason: string | null
  /** 落库键：`sha256(state)` 前 16 位（A 档确定性值）。 */
  stateHash: string
  /** 取到的 pos0 候选（降级时为空数组）。 */
  candidates: TokenCandidate[]
  normalization: YesNoNormalization | null
  latencyMs: number
  model: string
  endpoint: string
  /** 会话标识（落 `session_id`）。 */
  sessionId?: string | undefined
  /** 轮次（落 `turn_id`）。 */
  turnId?: number | undefined
  /**
   * 该判定是否**取自缓存**（写 `jev_log.cached`）。
   * B1.2 时该列恒写 0（当时无缓存）；B1.3 起由框架侧缓存命中路径置 true。
   */
  cached?: boolean
  /**
   * 实际承载本次判定的**通道**：`'ollama'`（本机 logprob）或 `'systemone'`（真 JEV 本体）。
   *
   * 为什么要有这个字段：两个通道的**失败形态与语义单位完全不同**（`ollama-*` 是 token 面、
   * `systemone-*` 是答案面）。没有它时，"换了通道"只能从 `reason` 前缀反推 ——
   * 那是一种**不可枚举**的取证方式，判据写不稳。**可选** ⇒ 旧调用方零影响。
   */
  channel?: string
  /**
   * 真 JEV 通道归一后的**全部答案**（多问不丢；choice/score 的真实取值在这里）。
   *
   * 类型用 `unknown`（避免 `ollama.ts` 反向依赖 `systemone.ts` 的类型）：真 JEV 通道
   * 直接给它一个 `JevAnswers`。Ollama 通道**不产出**该字段（可选 ⇒ 旧判据与旧调用方零影响）。
   */
  answers?: Record<string, unknown>
  /**
   * 真 JEV 通道里**认不出形状**的答案键（次要答案的失败清单，不静默丢）。
   * 主问题失败不走这里 —— 那会直接成为显式降级（`systemone-primary-missing` 等）。
   */
  unusableAnswers?: string[]
  /** 契约单值面取的是哪个问题键（真 JEV 多问时才有意义）。 */
  primaryQuestion?: string
  /** 服务端自报的**真正服务**的模型名（与请求名互为反证；拿不到为 undefined）。 */
  servedModel?: string
  /**
   * 本次判定的费用（真 JEV 才有；本机 Ollama 无计费 ⇒ 保持 `null`，**不用 0 冒充**）。
   * ⚠ 它是 **B 档浮动量**（实测 ~1.2e-5 USD/次），**不得**当阈值判据用。
   */
  costUsd?: number | null
  /** 落痕时刻（ISO 8601，写 `created_at`）。 */
  atIso: string
  /**
   * 落痕自身的失败（`null` = 落痕正常）。
   * 存在的意义：**「写不进 jev_log」不得与「写成功」同形**。
   */
  traceError: string | null
}

/** 判定入参。 */
export interface JudgeOptions {
  /** 状态文本（参与 `state_hash`）。 */
  state: string
  /** 提问文本（进 prompt）。 */
  question: string
  /** 判定门限：`pYes >= threshold` ⇒ `'yes'`。 */
  threshold?: number
  /** 端点；缺省 `OLLAMA_DEFAULT_ENDPOINT`。 */
  endpoint?: string
  /** 模型；缺省 `JEV_DEFAULT_MODEL`。 */
  model?: string
  /** 落痕用库句柄（**只写 `jev_log`**）。不给则不落痕（纯判定）。 */
  db?: DatabaseSync
  /** 关联键；缺省自动生成 uuid。 */
  requestId?: string
  /** 判定类型（落 `request_type` 列）。 */
  requestType?: string
  /** 来源（落 `source` 列）。 */
  source?: string
  sessionId?: string
  turnId?: number
  /** 超时毫秒。 */
  timeoutMs?: number
  /** 注入 fetch（测试用；不给则用全局 fetch）。 */
  fetchImpl?: typeof fetch
  /** 注入时钟（测试用）。 */
  now?: () => Date
  /** 注入 id 生成器（测试用）。 */
  idFactory?: () => string
  /**
   * 承载本次判定的通道标识（`'ollama'` / `'systemone'`，落 `JevJudgeOutcome.channel`）。
   *
   * 为什么放在**最底层**入参上而不是某一通道自己的入参上：`framework.ts` 的护栏要把它
   * 透传到"熔断拒绝/缓存命中"这两条**不经过模型**的路径上 —— 那两条路径没有"当前通道"
   * 可言，只能从这个字段读。可选 ⇒ 旧调用方零影响。
   */
  channel?: string
}

/** 可枚举的降级原因（前缀统一，便于 `LIKE 'ollama-%'` 统计）。 */
export const DEGRADED_REASONS = {
  requestFailed: 'ollama-request-failed',
  httpError: 'ollama-http-error',
  invalidJson: 'ollama-invalid-json',
  noLogprobs: 'ollama-no-logprobs',
  noCandidates: 'ollama-no-candidates',
  noYesNoToken: 'ollama-no-yes-no-token',
} as const

/** 拼 `/api/chat` 全 URL（端点允许带尾斜杠或已是全 URL）。 */
export function chatUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, '')
  return base.endsWith('/api/chat') ? base : `${base}/api/chat`
}

/** `state_hash`：A 档确定性值（同 state 必得同 hash）。 */
export function stateHash(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex').slice(0, 16)
}

/** 构造请求体（逐字契约：六个字段都不能少）。 */
export function buildBody(state: string, question: string, model: string): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: 'system', content: 'You are a strict binary classifier. Answer exactly one token: yes or no.' },
      { role: 'user', content: `${question}\n\nSTATE:\n${state}` },
    ],
    think: false,
    logprobs: true,
    top_logprobs: JEV_TOP_LOGPROBS,
    stream: false,
    options: { num_predict: 1, temperature: 0 },
  }
}

/**
 * 从原始响应里取 **pos0** 的候选。
 *
 * 返回 `[]` 表示「取不到」—— 由调用方转成显式降级原因，**不在此处吞掉**。
 */
export function extractPos0Candidates(raw: unknown): TokenCandidate[] {
  if (!raw || typeof raw !== 'object') return []
  const lps = (raw as { logprobs?: unknown }).logprobs
  if (!Array.isArray(lps)) return []
  const pos0 = lps[JEV_POS_INDEX]
  if (!pos0 || typeof pos0 !== 'object') return []
  const tops = (pos0 as { top_logprobs?: unknown }).top_logprobs
  if (!Array.isArray(tops)) return []
  const out: TokenCandidate[] = []
  for (const item of tops) {
    if (!item || typeof item !== 'object') continue
    const token = (item as { token?: unknown }).token
    const logprob = (item as { logprob?: unknown }).logprob
    if (typeof token !== 'string') continue
    if (typeof logprob !== 'number' || !Number.isFinite(logprob)) continue
    out.push({ token, logprob })
  }
  return out
}

/**
 * 把 pos0 候选归一成 `yes/no` 概率。
 *
 * ⚠ 核心：按 `trim().toLowerCase()` **归族**（`Yes` 与 `yes` 同族，`No` 与 `no` 同族），
 *   并从**原始词表项**求和 —— 不重归一。若只匹小写，`Yes` 会从结果里消失
 *   且不报任何错（这正是本文件头注 ① 的那类静默失败）。
 */
export function normalizeYesNo(candidates: readonly TokenCandidate[]): YesNoNormalization {
  const yesFamily: TokenCandidate[] = []
  const noFamily: TokenCandidate[] = []
  const unmatched: TokenCandidate[] = []
  for (const c of candidates) {
    const key = c.token.trim().toLowerCase()
    if (key === 'yes') yesFamily.push(c)
    else if (key === 'no') noFamily.push(c)
    else unmatched.push(c)
  }
  const sum = (xs: readonly TokenCandidate[]): number => {
    let acc = 0
    for (const x of xs) acc += Math.exp(x.logprob)
    return acc
  }
  return { pYes: sum(yesFamily), pNo: sum(noFamily), yesFamily, noFamily, unmatched }
}

/**
 * 写一行 `jev_log`。
 *
 * `id` 是主键且**不设缺省** ⇒ 必须显式给 ⇒ `state_hash` 不由 SQLite 生成。
 * 列以**列名**插入（不靠位置），因此对表列顺序变动免疫。
 *
 * ⚠ **INSERT 列清单与写口已上移到 `./jev-log-gate.ts`**（本仓 2026-09-25 实测的缺陷）：
 *   此前列清单在本文件里，且**不含 gate** ⇒ A1-8 的"运行态可归因"没有生产写入者，
 *   测试只能自己直写 gate 塞进库（夹具自证）。上移后：
 *   · 列清单只有一份（`jevLogInsertSql()`），加列不会漏值（`jevLogRowParams` 抛错兜底）；
 *   · 判据可对**生产 SQL 本体**做负向注入（去掉 gate ⇒ 真降级不落 gate ⇒ 测试必红）。
 *   行为面唯一变化：`degraded:true` 的行现在多写一个 `gate` 值（非降级行显式 null）。
 */
export function writeJevLog(db: DatabaseSync, o: JevJudgeOutcome): void {
  writeJevLogRow(db, {
    id: o.requestId,
    requestType: o.requestType,
    source: o.source,
    stateHash: o.stateHash,
    value: o.value,
    probability: o.probability,
    cached: Boolean(o.cached), // cached：B1.3 起命中路径写 1（只读复用该列，未改表结构）
    degraded: Boolean(o.degraded),
    // gate：门控失败归因（判据原文 gate in (unavailable,budget)）。
    // **非降级 ⇒ 显式 null**（不是空串、不是 0）：「无门控失败」与「降级被记成正常」必须可分辨。
    gate: jevGateOf(o),
    latencyMs: o.latencyMs,
    // cost_usd：本机 Ollama 无计费 ⇒ 显式 null 而不是 0（**不得用 0 冒充**）；
    // 真 JEV 通道给得出真实费用（B 档浮动量）⇒ 落库，但仍不当阈值判据用。
    costUsd: o.costUsd ?? null,
    sessionId: o.sessionId ?? null,
    turnId: o.turnId ?? 0,
    atIso: o.atIso,
  })
}

/** 计一行数（判据用；只读）。 */
export function countJevRows(db: DatabaseSync, where = ''): number {
  const sql = `SELECT count(*) AS c FROM jev_log${where ? ` WHERE ${where}` : ''}`
  const row = db.prepare(sql).get() as { c?: number } | undefined
  return Number(row?.c ?? -1)
}

const UNKNOWN_VALUE = 'unknown' as const

/**
 * 判定一次。**本函数不抛**（网络/解析类失败一律转显式降级）。
 *
 * 结构保证：所有出口都经 `finish()` ⇒ 传了 `db` 就一定落一行 `jev_log`
 * （正常与降级**都**落），「降级必须留痕」不是调用方的义务而是本函数的行为。
 */
export async function judgeWithOllama(options: JudgeOptions): Promise<JevJudgeOutcome> {
  const {
    state,
    question,
    threshold = 0.5,
    endpoint = OLLAMA_DEFAULT_ENDPOINT,
    model = JEV_DEFAULT_MODEL,
    db,
    requestId = (options.idFactory ?? randomUUID)(),
    requestType = 'jev',
    source = 'mana-jev',
    sessionId,
    turnId,
    timeoutMs = 30_000,
    fetchImpl,
    now = () => new Date(),
  } = options

  const started = Date.now()
  const base = {
    requestId,
    requestType,
    source,
    stateHash: stateHash(state),
    latencyMs: 0,
    model,
    endpoint,
    candidates: [] as TokenCandidate[],
    normalization: null as YesNoNormalization | null,
    sessionId,
    turnId,
    // 通道标识进 base ⇒ **所有出口**（含降级）都带上它。
    // 漏了它时，"换了通道"只能从 reason 前缀反推 —— 那不可枚举，判据写不稳（实测踩过）。
    channel: options.channel ?? OLLAMA_CHANNEL,
  }

  /** 唯一出口：落痕（若给了 db）→ 返回。任何路径都走这里。 */
  const finish = (o: Omit<JevJudgeOutcome, 'latencyMs' | 'traceError' | 'atIso'>): JevJudgeOutcome => {
    const full: JevJudgeOutcome = {
      ...o,
      latencyMs: Date.now() - started,
      traceError: null,
      atIso: now().toISOString(),
    }
    if (db) {
      try {
        writeJevLog(db, full)
      } catch (error) {
        // 落痕失败**不得静默**：落成显式字段（G8），调用方可断言 traceError === null
        full.traceError = error instanceof Error ? error.message : String(error)
      }
    }
    return full
  }
  /** 降级出口：概率恒为 null（禁 0 冒充），reason 恒非空。 */
  const degrade = (reason: string, extra?: Partial<JevJudgeOutcome>): JevJudgeOutcome =>
    finish({
      ...base,
      ...extra,
      value: UNKNOWN_VALUE,
      probability: null,
      degraded: true,
      reason,
    })

  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return degrade(`${DEGRADED_REASONS.requestFailed}: fetch 不可用`)

  let raw: unknown
  try {
    const res = await doFetch(chatUrl(endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBody(state, question, model)),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return degrade(`${DEGRADED_REASONS.httpError}: status=${res.status}`)
    try {
      raw = await res.json()
    } catch (error) {
      return degrade(`${DEGRADED_REASONS.invalidJson}: ${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    // ⚠ 这里是 G8 的正面样本：**不写 catch { return null }**，
    //   改为把失败原因**逐字**带进 reason（含端点与错误消息）。
    const msg = error instanceof Error ? error.message : String(error)
    return degrade(`${DEGRADED_REASONS.requestFailed}: ${chatUrl(endpoint)} → ${msg}`)
  }

  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { logprobs?: unknown }).logprobs)) {
    return degrade(`${DEGRADED_REASONS.noLogprobs}: 响应无 logprobs 数组`)
  }

  const candidates = extractPos0Candidates(raw)
  if (candidates.length === 0) {
    return degrade(`${DEGRADED_REASONS.noCandidates}: logprobs[pos0].top_logprobs 为空`, { candidates })
  }

  const normalization = normalizeYesNo(candidates)
  if (normalization.yesFamily.length === 0 && normalization.noFamily.length === 0) {
    // 「判不了」与「判不准」必须可分辨：不给概率、不给 'no'，显式 unknown
    return degrade(
      `${DEGRADED_REASONS.noYesNoToken}: pos0 候选无 yes/no 族（token=${candidates.map((c) => c.token).join('|')}）`,
      { candidates, normalization },
    )
  }

  return finish({
    ...base,
    candidates,
    normalization,
    value: normalization.pYes >= threshold ? 'yes' : 'no',
    probability: normalization.pYes,
    degraded: false,
    reason: null,
  })
}
