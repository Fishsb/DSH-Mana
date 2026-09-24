/**
 * B1.4 · **真 JEV 通道层**（`jev-1.13` @ `POST {base}/api/v1/systemone`）。
 *
 * ── 为什么必须单独一层（不是"换个端点"）────────────────────────────────────
 * 旧通道（`ollama.ts`）是「单 token logprob 取 pos0 + 自己归一 yes/no」；
 * 真 JEV 是「**一次调用多问** + 结构化 instructions/criteria ⇒ 直接给概率/取值」。
 * 两者的**请求体、响应体、语义单位**都不同（问句 vs token；`answers` vs `logprobs`），
 * 所以这里做的是一层**形态映射**，而不是把 URL 常量换掉。
 *
 * ── 实测契约（2026-09-24 · `python3` 裸 `http.client` 亲探，非转述）──────────
 *  · 请求：`{model, state, questions:{<key>:{type,instructions,criteria?}}}`
 *    + `Authorization: Bearer <key>`（实测裸 key 也 200，但本实现只写 Bearer 一种形态）
 *  · 响应：`{model, answers:{<key>:…}, usage:{input_tokens,output_tokens,cost}, id, provider}`
 *      noul    ⇒ `{type:'noul',  noul:<0..1>}`
 *      choice  ⇒ `{type:'choice', choice:<criteria 的键>, probabilities:{…}, confidence}`
 *      score   ⇒ `{type:'score',  score:<索引>, legend:{…}, probabilities:{…}, confidence}`
 *               ⚠ `score.criteria` 必须是**数组**（对象会 400）；服务端回填 `legend`，
 *                 `score` 是 `legend`/`probabilities` 的**索引**
 *  · 三种合法 type：`noul` / `choice` / `score`（未知 type ⇒ 400 `invalid_question_type`）
 *  · 错误形态：401 `missing_api_key` / 400 `model_not_supported|invalid_question|invalid_questions`
 *
 * ── 形态映射决策（本层最要紧的四条，逐条给理由）────────────────────────────
 * ① `choice`/`score` **不是降级**：HTTP 200、答案完整 ⇒ `degraded:false`；
 *    但它们没有 yes/no 语义 ⇒ 契约面 `value:'unknown'` + `probability:null`
 *    （契约明令概率不可用 ⇒ null、**不得用 0 冒充**；也不新增契约取值）。
 * ② 真实取值**不丢**：落在适配层自己的 `JevJudgeOutcome.answers`（`choice`/`score`/
 *    `probabilities`/`confidence`/`legend` 原样保留）。放 `reason` 是错的 ——
 *    `reason` 的契约语义是"降级原因"，正常数据塞进去必然被下游读错。
 * ③ **多问不压扁**：`questions` 可多个 ⇒ `answers` 全量保留，契约单值面只取 `primaryQuestion`。
 *    主问题缺失/不可用 ⇒ **显式降级**（`systemone-primary-missing`），**不偷偷挑第一个键**。
 * ④ 归一不了的**次要**答案进 `unusableAnswers`（可枚举字符串数组），不静默丢。
 *
 * ⚠ 本层**不做**缓存/熔断/冷却/并发/预算（那五件在 `framework.ts`，与通道无关）；
 *   也**不做**多问合并优化（那要改调用方语义；本轮只保证"映射正确 + 不丢"）。
 * ⚠ **不把 key 写进任何地方**：只从入参或环境变量读（缺省 `NANOGPT_API_KEY`）。
 * ⚠ 本地**不设**模型白名单硬门：服务端白名单会变（变了就成"静默拦住真调用"的新缺陷），
 *   错模型时服务端 400 自报白名单原文，由 `reason` 带出 ⇒ 验真闭环仍在，且不会僵化。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  OLLAMA_CHANNEL,
  stateHash,
  writeJevLog,
  type JevJudgeOutcome,
  type JudgeOptions,
} from './ollama.ts'

/** 本机通道标识从 `ollama.ts`（它的归属模块）再导出，供调用方一处取用。 */
export { OLLAMA_CHANNEL }

/** 端点缺省值（路径另拼，见 `systemoneUrl`）。 */
export const SYSTEMONE_DEFAULT_ENDPOINT = 'https://nano-gpt.com'

/** 真 JEV 的判定路径（与 `/api/chat` 完全不同的一条链）。 */
export const SYSTEMONE_DEFAULT_PATH = '/api/v1/systemone'

/** 缺省模型：JEV **本体**（不是平替）。 */
export const SYSTEMONE_DEFAULT_MODEL = 'jev-1.13'

/** key 的缺省环境变量名。**只读环境变量，永不落盘**。 */
export const SYSTEMONE_API_KEY_ENV = 'NANOGPT_API_KEY'

/**
 * 第二处凭据来源：用户自己的 env 文件的**路径变量**（缺省 `~/jev/.env`）。
 *
 * ── 为什么判据面需要它（与本轮边界的关系，写清楚免得被当成越界）──────────────
 * 会议边界原话：「真通道判据必须带凭据：**从 `~/jev/.env` 读 key**（不回显、不进 git、不写进 handoff）」。
 * 但 `~/jev/.env` 由用户自己维护，**默认不进 shell 环境** ⇒ 只读环境变量的判据在用户没
 * `source` 它的时候会"明明配好了却全红"。⇒ 判据/探针面额外支持直接读该文件。
 *
 * ⚠ **运行态（`apply()` 与服务面）不走这条**：插件代码只读环境变量（边界原话）；
 *   文件读取只发生在**判据与探针**这两个工具面上。
 * ⚠ **只读**：本模块从不写该文件、从不回显其内容（`splitCredentialSource` 只吐变量名/路径）。
 */
export const SYSTEMONE_ENV_FILE_VAR = 'JEV_ENV_FILE'

/** 缺省 env 文件路径（用户配置位；只读参考）。 */
export const SYSTEMONE_DEFAULT_ENV_FILE = join(homedir(), 'jev', '.env')

/** 通道标识（落 `JevJudgeOutcome.channel`；与 `Config.channel` 的取值同一套字面量）。 */
export const SYSTEMONE_CHANNEL = 'systemone'

/** 主问题缺省键（契约单值面从这里取）。 */
export const SYSTEMONE_DEFAULT_PRIMARY = 'v'

/**
 * 服务端自报的合法模型白名单（实测 400 原文）。
 * ⚠ 它是**判据的断言对象**（"服务端自报身份与我们的常量互为反证"），**不是**运行时硬门。
 */
export const SYSTEMONE_ALLOWED_MODELS = [
  'jev-1.13',
  'jev-latest',
  'typesafe/jev-1.13',
  '~typesafe/jev-latest',
  'typesafe/jev-latest',
] as const

/** 降级原因（统一 `systemone-` 前缀 ⇒ 与 `ollama-*` / `jev-*` 可分辨，便于按前缀统计）。 */
export const SYSTEMONE_DEGRADED_REASONS = {
  noApiKey: 'systemone-no-api-key',
  requestFailed: 'systemone-request-failed',
  httpError: 'systemone-http-error',
  invalidJson: 'systemone-invalid-json',
  noAnswers: 'systemone-no-answers',
  primaryMissing: 'systemone-primary-missing',
  primaryNotNoul: 'systemone-primary-not-noul',
  invalidProbability: 'systemone-invalid-probability',
} as const

// ── 协议类型（**真 JEV 的形状**，不是契约形状）──────────────────────────────

/** 真 JEV 的三种问题类型（实测合法集）。 */
export type JevQuestionType = 'noul' | 'choice' | 'score'

/** `choice` 的 `criteria` 是**对象**（键=返回值）；`score` 的 `criteria` 必须是**数组**。 */
export interface JevQuestion {
  type: JevQuestionType
  instructions: string
  criteria?: Record<string, string> | string[]
}

/** 一次调用可塞多题：键即 `answers` 的键。 */
export type JevQuestions = Record<string, JevQuestion>

/** noul 答案：**直接给概率**（不需要任何归一化）。 */
export interface JevNoulAnswer {
  type: 'noul'
  noul: number
}

/** choice 答案：取值为 `criteria` 的某个键。 */
export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities?: Record<string, number>
  confidence?: number
}

/** score 答案：取值为 `legend`/`probabilities` 的**索引**。 */
export interface JevScoreAnswer {
  type: 'score'
  score: number
  legend?: Record<string, string>
  probabilities?: Record<string, number>
  confidence?: number
}

/** 认不出的答案：**原样留在 `raw`**，加一条可枚举的原因（不静默丢）。 */
export interface JevUnusableAnswer {
  type: string
  unusableReason: string
  raw: unknown
}

/** 归一后的单个答案。 */
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer | JevUnusableAnswer

/** 归一后的**全部**答案（多问不丢）。 */
export type JevAnswers = Record<string, JevAnswer>

/** `answers` 里为 `noul` 类的窄化判据（判据与消费方共用，避免各写一份 instanceof 式判断）。 */
export function isNoulAnswer(a: JevAnswer | undefined): a is JevNoulAnswer {
  return !!a && a.type === 'noul' && typeof (a as JevNoulAnswer).noul === 'number'
}

/** 真 JEV 通道的判定入参：`JudgeOptions` 全量 + 通道专有字段。 */
export interface SystemoneJudgeOptions extends JudgeOptions {
  /**
   * 问题集（**多问**）。不给时由 `question` 合成一个缺省 noul 问
   * （`primaryQuestion` 键）—— 这样契约面的 `{state,question,threshold}` 调用方
   * 不改一行就能走真通道。
   */
  questions?: JevQuestions
  /** 契约单值面取哪个键；缺省 `'v'`。 */
  primaryQuestion?: string
  /** key **显式**入参（判据用）。缺省读 `apiKeyEnv` 指向的环境变量。 */
  apiKey?: string
  /** 读 key 的环境变量名；缺省 `NANOGPT_API_KEY`。 */
  apiKeyEnv?: string
  /** 路径；缺省 `/api/v1/systemone`。 */
  path?: string
  /** 归属通道标识（落 `JevJudgeOutcome.channel`）。 */
  channel?: string
}

/** 拼全 URL（端点允许带尾斜杠或已经是全 URL）。 */
export function systemoneUrl(endpoint: string, path = SYSTEMONE_DEFAULT_PATH): string {
  const base = endpoint.trim().replace(/\/+$/, '')
  if (base.endsWith(path)) return base
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** 构造请求体（逐字：`model` + `state` + `questions` 三件，缺 `model` 服务端 400）。 */
export function buildSystemoneBody(
  state: string,
  questions: JevQuestions,
  model: string,
): Record<string, unknown> {
  return { model, state, questions }
}

/**
 * 读 key：**显式入参优先**（判据用），否则读环境变量。
 * 返回 `{key}` 或 `{missing: <环境变量名>}` —— 调用方据此落**显式降级**（不许静默跳过）。
 */
export function readApiKey(
  explicit: string | undefined,
  envName: string,
  env: Record<string, string | undefined> = (globalThis.process?.env ?? {}) as Record<string, string | undefined>,
): { key: string } | { missing: string } {
  if (explicit && explicit.trim()) return { key: explicit.trim() }
  const fromEnv = env[envName]
  if (fromEnv && fromEnv.trim()) return { key: fromEnv.trim() }
  return { missing: envName }
}

/**
 * 解析一份 env 文本（`KEY=VALUE` 逐行；支持 `export ` 前缀、引号、`#` 注释）。
 *
 * 纯函数 ⇒ 可被离线判据逐条断言（不碰文件系统）。
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

/** 读 env 文件（读不到返回 `undefined` —— **不抛、不静默当成空 key**）。 */
export function readEnvFileText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 凭据解析结果：`{key, from}` 或 `{missing, tried}`。 */
export interface CredentialResolved {
  key: string
  /** 凭据来源（**变量名/路径**，不含 key 本身 —— 可安全进日志）。 */
  from: string
}
export interface CredentialAbsent {
  missing: true
  /** 试过的全部来源（变量名 / 文件路径），供"显式红"的报错逐条列出。 */
  tried: string[]
}

/**
 * **凭据解析（判据面/探针面唯一入口 ⇒ 同源）**：显式入参 → 环境变量 → env 文件。
 *
 * 为什么要有唯一入口：实测踩过一次"探针能过、判据全红"——两处各自读凭据，
 * 一处读了环境变量、另一处期望别的来源。同一个函数 ⇒ 两处**结构上**不可能再分叉。
 */
export function resolveSystemoneCredential(
  args: {
    /** 显式 key（最高优先；判据用）。 */
    explicit?: string
    /** 环境变量名；缺省 `NANOGPT_API_KEY`。 */
    envName?: string
    /** env 文件路径；缺省 `JEV_ENV_FILE` 或 `~/jev/.env`；传 `''` 表示**禁用**文件回退。 */
    envFile?: string
    /** 环境变量表（判据注入用；缺省 `process.env`）。 */
    env?: Record<string, string | undefined>
    /** 文件读取（判据注入用；缺省真读盘）。 */
    readTextFile?: (path: string) => string | undefined
  } = {},
): CredentialResolved | CredentialAbsent {
  const envName = args.envName ?? SYSTEMONE_API_KEY_ENV
  const env = args.env ?? ((globalThis.process?.env ?? {}) as Record<string, string | undefined>)
  const tried: string[] = [`env:${envName}`]
  const explicit = (args.explicit ?? '').trim()
  if (explicit) return { key: explicit, from: 'explicit' }
  const fromEnv = (env[envName] ?? '').trim()
  if (fromEnv) return { key: fromEnv, from: `env:${envName}` }

  const filePath = args.envFile ?? env[SYSTEMONE_ENV_FILE_VAR] ?? SYSTEMONE_DEFAULT_ENV_FILE
  if (filePath && filePath.trim()) {
    tried.push(`file:${filePath}`)
    const text = (args.readTextFile ?? readEnvFileText)(filePath)
    if (text !== undefined) {
      const parsed = parseEnvFile(text)
      const value = (parsed[envName] ?? '').trim()
      if (value) return { key: value, from: `file:${filePath}` }
    }
  }
  return { missing: true, tried }
}

/**
 * 把服务端 `answers` 归一成可枚举结构。
 *
 * **不抛、不丢**：认不出的答案进 `unusable` 清单并**原样**留 `raw`。
 * 返回的 `unusableKeys` 是**次要**答案的失败清单（主问题失败由调用方判，见 `judgeWithSystemone`）。
 */
export function normalizeAnswers(raw: unknown): { answers: JevAnswers; unusableKeys: string[] } {
  const answers: JevAnswers = {}
  const unusableKeys: string[] = []
  if (!raw || typeof raw !== 'object') return { answers, unusableKeys }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value ?? {}) as Record<string, unknown>
    const type = typeof v.type === 'string' ? v.type : '(missing)'
    if (type === 'noul' && typeof v.noul === 'number' && Number.isFinite(v.noul)) {
      answers[key] = { type: 'noul', noul: v.noul }
      continue
    }
    if (type === 'choice' && typeof v.choice === 'string') {
      const a: JevChoiceAnswer = { type: 'choice', choice: v.choice }
      if (isNumberMap(v.probabilities)) a.probabilities = v.probabilities
      if (typeof v.confidence === 'number') a.confidence = v.confidence
      answers[key] = a
      continue
    }
    if (type === 'score' && typeof v.score === 'number' && Number.isFinite(v.score)) {
      const a: JevScoreAnswer = { type: 'score', score: v.score }
      if (isStringMap(v.legend)) a.legend = v.legend
      if (isNumberMap(v.probabilities)) a.probabilities = v.probabilities
      if (typeof v.confidence === 'number') a.confidence = v.confidence
      answers[key] = a
      continue
    }
    answers[key] = { type, unusableReason: `unrecognized-answer-shape(type=${type})`, raw: value }
    unusableKeys.push(key)
  }
  return { answers, unusableKeys }
}

function isNumberMap(x: unknown): x is Record<string, number> {
  return !!x && typeof x === 'object' && Object.values(x as Record<string, unknown>).every((n) => typeof n === 'number')
}

function isStringMap(x: unknown): x is Record<string, string> {
  return !!x && typeof x === 'object' && Object.values(x as Record<string, unknown>).every((s) => typeof s === 'string')
}

/** 从响应里取 `usage.cost`（拿不到就是 `null`，**不用 0 冒充**）。 */
export function extractCost(raw: unknown): number | null {
  const c = (raw as { usage?: { cost?: unknown } } | null)?.usage?.cost
  return typeof c === 'number' && Number.isFinite(c) ? c : null
}

/** 从响应里取服务端**真正服务**的模型名（与请求名互为反证）。 */
export function extractServedModel(raw: unknown): string | undefined {
  const m = (raw as { model?: unknown } | null)?.model
  return typeof m === 'string' && m ? m : undefined
}

/** 截断服务端错误正文（reason 里要带得上，但不能无限长）。 */
function truncate(text: string, max = 240): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 判定一次（真 JEV 通道）。**本函数不抛**（网络/解析类失败一律转显式降级）。
 *
 * 结构保证（与 `judgeWithOllama` 同款）：所有出口都经 `finish()` ⇒
 * 传了 `db` 就一定落一行 `jev_log`（正常与降级**都**落）。
 *
 * 契约面映射：`primaryQuestion` 那个答案若为 `noul` ⇒ `value = noul >= threshold ? 'yes' : 'no'`、
 * `probability = noul`；若为 `choice`/`score` ⇒ `value='unknown'` + `probability=null`
 * （**不是**降级，`degraded:false`），真实取值在 `answers` 里。
 */
export async function judgeWithSystemone(options: SystemoneJudgeOptions): Promise<JevJudgeOutcome> {
  const {
    state,
    question,
    threshold = 0.5,
    endpoint = SYSTEMONE_DEFAULT_ENDPOINT,
    model = SYSTEMONE_DEFAULT_MODEL,
    db,
    requestId = (options.idFactory ?? randomUUID)(),
    requestType = 'jev',
    source = 'mana-jev-systemone',
    sessionId,
    turnId,
    timeoutMs = 60_000,
    fetchImpl,
    now = () => new Date(),
  } = options

  const primaryQuestion = options.primaryQuestion ?? SYSTEMONE_DEFAULT_PRIMARY
  const channel = options.channel ?? SYSTEMONE_CHANNEL
  const path = options.path ?? SYSTEMONE_DEFAULT_PATH
  const url = systemoneUrl(endpoint, path)
  // 不给 questions ⇒ 用契约面的 question 合成一个缺省 noul 问（映射：question → instructions）
  const questions: JevQuestions = options.questions ?? { [primaryQuestion]: { type: 'noul', instructions: question } }

  const started = Date.now()
  const base = {
    requestId,
    requestType,
    source,
    stateHash: stateHash(state),
    latencyMs: 0,
    model,
    endpoint,
    candidates: [],
    normalization: null,
    sessionId,
    turnId,
    channel,
    primaryQuestion,
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
        full.traceError = error instanceof Error ? error.message : String(error)
      }
    }
    return full
  }
  /** 降级出口：概率恒 `null`（禁 0 冒充）、`reason` 恒非空。 */
  const degrade = (reason: string, extra?: Partial<JevJudgeOutcome>): JevJudgeOutcome =>
    finish({
      ...base,
      ...extra,
      value: 'unknown',
      probability: null,
      degraded: true,
      reason,
    })

  // ── ① 凭据：**没有 key 就绝不发请求**，且必须显式降级（不许静默 skip）──────
  // ⚠ 这里是**运行态口径**：只认显式入参与环境变量（不读用户的 env 文件）——
  //   插件代码"只读环境变量"是本轮边界原话。判据/探针面要读 `~/jev/.env` 的话，
  //   由它们**自己**先经 `resolveSystemoneCredential()` 解析成 `apiKey` 再传进来（同源入口）。
  const apiKeyEnv = options.apiKeyEnv ?? SYSTEMONE_API_KEY_ENV
  const cred = readApiKey(options.apiKey, apiKeyEnv)
  if ('missing' in cred) {
    return degrade(`${SYSTEMONE_DEGRADED_REASONS.noApiKey}: 环境变量 ${cred.missing} 未设置（未发请求；判据/探针面可先用 resolveSystemoneCredential() 读 ${SYSTEMONE_DEFAULT_ENV_FILE}）`)
  }

  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return degrade(`${SYSTEMONE_DEGRADED_REASONS.requestFailed}: fetch 不可用`)

  // ── ② 请求 ────────────────────────────────────────────────────────────────
  let raw: unknown
  let bodyText = ''
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cred.key}`,
      },
      body: JSON.stringify(buildSystemoneBody(state, questions, model)),
      signal: AbortSignal.timeout(timeoutMs),
    })
    try {
      bodyText = await res.text()
    } catch {
      bodyText = ''
    }
    if (!res.ok) {
      // 服务端错误正文**带进 reason**（401/400 的自报白名单与 param 是验真闭环的一半）
      return degrade(`${SYSTEMONE_DEGRADED_REASONS.httpError}: status=${res.status} body=${truncate(bodyText)}`)
    }
    try {
      raw = JSON.parse(bodyText)
    } catch (error) {
      return degrade(
        `${SYSTEMONE_DEGRADED_REASONS.invalidJson}: ${error instanceof Error ? error.message : String(error)} body=${truncate(bodyText)}`,
      )
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return degrade(`${SYSTEMONE_DEGRADED_REASONS.requestFailed}: ${url} → ${msg}`)
  }

  const servedModel = extractServedModel(raw)
  const costUsd = extractCost(raw)
  const usage = { servedModel, costUsd }

  // ── ③ 答案归一（**多问一条都不丢**）───────────────────────────────────────
  const rawAnswers = (raw as { answers?: unknown } | null)?.answers
  if (!rawAnswers || typeof rawAnswers !== 'object') {
    return degrade(`${SYSTEMONE_DEGRADED_REASONS.noAnswers}: 响应无 answers 对象`, { answers: {}, ...usage })
  }
  const { answers, unusableKeys } = normalizeAnswers(rawAnswers)
  const usableKeys = Object.keys(answers).filter((k) => !unusableKeys.includes(k))

  const picked = answers[primaryQuestion]
  if (picked === undefined) {
    // **不偷偷挑第一个键**：主问题缺失必须是显式降级（含可用键清单，便于定位配置错）
    return degrade(
      `${SYSTEMONE_DEGRADED_REASONS.primaryMissing}: primaryQuestion="${primaryQuestion}" 不在 answers 里（可用键：${Object.keys(answers).join('|') || '(空)'}）`,
      { answers, ...usage },
    )
  }

  if (isNoulAnswer(picked)) {
    const p = picked.noul
    if (!(p >= 0 && p <= 1)) {
      return degrade(`${SYSTEMONE_DEGRADED_REASONS.invalidProbability}: noul=${p} 不在 [0,1]`, { answers, ...usage })
    }
    return finish({
      ...base,
      ...usage,
      answers,
      value: p >= threshold ? 'yes' : 'no',
      probability: p,
      degraded: false,
      reason: null,
      candidates: [],
      normalization: null,
      unusableAnswers: unusableKeys,
    })
  }

  // choice / score：**链路健康但契约面没有 yes/no 语义** ⇒ unknown + null，且**不算降级**
  const reasonForUnknown =
    picked.type === 'choice' || picked.type === 'score'
      ? null
      : `${SYSTEMONE_DEGRADED_REASONS.primaryNotNoul}: type=${picked.type}`
  return finish({
    ...base,
    ...usage,
    answers,
    value: 'unknown',
    probability: null,
    degraded: reasonForUnknown !== null,
    reason: reasonForUnknown,
    candidates: [],
    normalization: null,
    unusableAnswers: unusableKeys,
  })
}

export type { JevJudgeOutcome, JudgeOptions }
