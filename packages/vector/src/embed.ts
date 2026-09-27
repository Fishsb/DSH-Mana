/**
 * 嵌入适配（B1.1）—— 纯 JS 通道，走 `fetch`，**零依赖**。
 *
 * **来源对照**（本机 `/mnt/d/FF/shoucang/lib/vec.js` 的 `embedMany`，只读参考、未改一字）：
 * 上游把失败折叠成 `null`（`catch { return null }`）⇒ provider 失败与「正常空结果」同形，
 * 向量档「看起来跑通、实际全走词法」。**本仓按 `docs/contract/degradation.md` 硬约定 1 改写为显式信封**。
 *
 * 两处**必须保留的上游语义**（不是"顺手优化"，是踩过坑的口径）：
 * - **本地端点超时放宽到 30s**（上游实测：bge-m3 冷启 2.2s、48 行批量冷 3.2s；统一 8s 会把
 *   「首次召回」误判超时并静默降级词法）。云端端点仍 8s。
 * - **文本截断 512 字符**（上游 `embedMany` 同一上限）。
 *
 * ⚠ **本文件不 import `node:*`**，只用全局 `fetch` / `AbortSignal.timeout`：
 *   本机实测（2026-09-24）进程内 `fetch` 打 `127.0.0.1:11434` 通（HTTP 200，48ms），
 *   且环境带 `NODE_USE_ENV_PROXY=1` + `no_proxy` 含 `127.0.0.1` ⇒ 不会被代理拦掉。
 *   保持"无 node 内置依赖"也让本模块将来可被 client 半区复用（A5-2 的 grep 面）。
 */
import {
  degradedOutcomeQuery,
  checkBatchDim,
  QUERY_MAX_CHARS,
  EMBED_FAILURE_KINDS,
  type EmbedOutcome,
  type EmbedFailureKind,
} from './adapt.ts'

/** 错误体读取上限：**取证够用**即可（避免把一整个 HTML 错误页塞进 reason）。 */
export const ERROR_BODY_MAX_CHARS = 300

/**
 * 「服务端明确回**不支持嵌入**」的**语义**特征串。
 *
 * **为什么按语义而不是按状态码 / 全串相等**：
 * · 全串相等 ⇒ 服务端**换版本、换措辞、换前后缀**即失效（判据随上游漂移而静默退化）；
 * · 按状态码（如「501 即不支持」）⇒ **过宽**：501 只是「未实现」的通用码，
 *   别的未实现能力也会带它 ⇒ 会把不属于本类的失败**误吸**进来（本卡明令禁止）。
 *
 * 实测锚点（**真端点**，HTTP 501，Ollama 0.34.4）：
 *   bare : `{"error":"This server does not support embeddings. Start it with \`--embeddings\`"}`
 *   openai: `{"error":{"message":"This server does not support embeddings. Start it with ...","type":"api_error"}}`
 *   （两种信封**外层结构不同**，故实现必须**搜全串**而非只读 `error.message`。）
 *   ⚠ 另一个真触发面：**模型自身无嵌入能力**（capabilities 不含 embedding）时，服务端回的是
 *     同一条 message —— 故 reason 里两种处置方向都要点到（见下 `classifyHttpFailure`）。
 */
export const UNSUPPORTED_EMBEDDING_MARKERS = [
  'does not support embeddings',
  'doesnt support embeddings',
  "doesn't support embeddings",
  'does not support embedding',
  'doesnt support embedding',
  "doesn't support embedding",
  '不支持嵌入',
] as const

/** 把未知错误体压成可搜的小写文本：字符串直接用；对象取 `error`（字符串或对象的全部值）/ `message`。 */
function textOf(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (depth > 3 || typeof value !== 'object' || value === null) return ''
  const rec = value as Record<string, unknown>
  const parts: string[] = []
  if (rec.error !== undefined) parts.push(textOf(rec.error, depth + 1))
  if (typeof rec.message === 'string') parts.push(rec.message)
  return parts.join(' ')
}

/**
 * 在服务端错误体里搜「不支持嵌入」的语义特征，命中则返回**命中的那一条特征串**（取证用），否则 `null`。
 *
 * ⚠ 判据**只认语义文本**：不看状态码、不做全串相等 —— 这样服务端换版本/换措辞只要还带这句
 *   语义特征就仍归本类；而不带这句特征的（404 模型不存在、500、超时…）**判不中**，落通用失败。
 */
export function unsupportedMarkerIn(body: unknown): string | null {
  const text = (typeof body === 'string' ? body : textOf(body)).toLowerCase()
  return UNSUPPORTED_EMBEDDING_MARKERS.find((m) => text.includes(m)) ?? null
}

/** 便捷判定（`unsupportedMarkerIn !== null` 的布尔面；**同一实现**，不另写一条路径）。 */
export function isUnsupportedByServer(body: unknown): boolean {
  return unsupportedMarkerIn(body) !== null
}

/** 嵌入端点配置（缺省 = 本机 Ollama 的 OpenAI 兼容面）。 */
export interface EmbedConfig {
  /** 是否启用嵌入。`false` ⇒ **显式降级**（不是抛错、不是静默空结果）。 */
  enabled: boolean
  /** OpenAI 兼容基址（`/embeddings` 会被拼在后面）。 */
  baseUrl: string
  /** 模型 id。 */
  model: string
  /** 期望维度（A1-12 硬约束 1024）。 */
  dim: number
  /** 云端鉴权头取值；本地端点可为空。 */
  apiKey?: string
  /** 强制超时（毫秒）；不传则本地 30s / 云端 8s。用于**负向判据**造真超时。 */
  timeoutMs?: number
  /** 注入的 fetch（测试用：造真故障不依赖真实网络故障）。缺省全局 `fetch`。 */
  fetchImpl?: typeof fetch
}

const isLocalBase = (baseUrl: string): boolean =>
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(baseUrl)
/** 尽力读错误体：读不出（流已消费/非文本）就返回空串 —— **不为取证把失败放大成二次失败**。 */
async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, ERROR_BODY_MAX_CHARS)
  } catch {
    return ''
  }
}

/**
 * 非 2xx 的**归类**（本卡唯一判定出口 —— 避免「哪条路径算不支持」在代码里散成两处）。
 *
 * 判定顺序刻意是「**先读语义，状态码不参与判据**」：上游换了 HTTP 码但语义没变 ⇒ 仍归本类；
 * 「码看着像但语义不是」（别的未实现能力、网关故障）⇒ **判不中** ⇒ 落通用失败，不被误吸。
 * 读体对**所有**非 2xx 都做（不按状态段预筛）：预筛本身就是「悄悄漏掉」的新入口；
 * 而读体被请求自身的 `AbortSignal.timeout` 兜着，不会无界等待。
 */
async function classifyHttpFailure(
  res: Response,
  cfg: EmbedConfig,
  base: string,
): Promise<{ kind: EmbedFailureKind; reason: string }> {
  const body = await readErrorBody(res)
  const marker = body ? unsupportedMarkerIn(body) : null

  if (marker) {
    return {
      kind: 'unsupported-by-server',
      reason:
        '嵌入端点回 HTTP ' + res.status + '：服务端**明确不支持嵌入**（命中语义特征「' + marker + '」；端点 ' + base + '，model=' + cfg.model + '）。' +
        '处置方向是**服务端启动参数**（如 Ollama 需以 --embeddings 启动）或**所选模型自身无嵌入能力**（须改用嵌入模型）；' +
        '**不是**网络不通、也不是端点或模型名写错。服务端原句：' + body,
    }
  }

  return {
    kind: 'degraded',
    reason: '嵌入端点返回 HTTP ' + res.status + '（' + base + '）' + (body ? '：' + body : ''),
  }
}

/**
 * 取一批文本的嵌入。
 *
 * **返回信封恒为 `EmbedOutcome`**：失败路径有 `degraded:true` + 非空 `reason`；
 * 绝不返回 `null`、绝不抛（调用方不需要 try/catch 才能判降级 —— 需要 try 的降级链等于没降级）。
 */
export async function embedTexts(cfg: EmbedConfig, texts: readonly string[]): Promise<EmbedOutcome> {
  const t0 = Date.now()
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const done = (vectors: Float32Array[], reason: string | null): EmbedOutcome => ({
    vectors,
    model: cfg.model,
    baseUrl: base,
    degraded: reason !== null,
    // 未降级 ⇒ 归类必须是 **null**（不得用 'degraded' 冒充「没失败」）。
    failureKind: null,
    reason,
    ms: Date.now() - t0,
  })

  if (!texts.length) {
    // 空输入**不是降级**：N=0 要显式记 0（G5：0 是合法值且必须与"库空/失败"可分辨）。
    return done([], null)
  }
  if (!cfg.enabled) return degradedOutcomeQuery(cfg.model, base, `嵌入已禁用（enabled=false）：未发起请求`, Date.now() - t0)
  if (!cfg.model) return degradedOutcomeQuery(cfg.model, base, '未配置嵌入模型 id（model 为空）', Date.now() - t0)
  if (!base) return degradedOutcomeQuery(cfg.model, base, '未配置嵌入端点（baseUrl 为空）', Date.now() - t0)

  const local = isLocalBase(base)
  if (!cfg.apiKey && !local) {
    return degradedOutcomeQuery(cfg.model, base, `云端端点缺 apiKey（baseUrl=${base} 非本机地址）`, Date.now() - t0)
  }

  const timeoutMs = cfg.timeoutMs ?? (local ? 30_000 : 8_000)
  const doFetch = cfg.fetchImpl ?? fetch
  const payload = texts.map((t) => t.slice(0, QUERY_MAX_CHARS))

  let res: Response
  try {
    res = await doFetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, input: payload }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // ⚠ 这里是硬约定 1 的正面战场：**原因必须带端点与超时**，否则"哪个端点不通"不可查。
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return degradedOutcomeQuery(cfg.model, base, `嵌入请求失败（${base}，timeoutMs=${timeoutMs}）：${msg}`, Date.now() - t0)
  }

  if (!res.ok) {
    const { kind, reason } = await classifyHttpFailure(res, cfg, base)
    return degradedOutcomeQuery(cfg.model, base, reason, Date.now() - t0, kind)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return degradedOutcomeQuery(cfg.model, base, `嵌入响应不是合法 JSON：${msg}`, Date.now() - t0)
  }

  const data = (json as { data?: { embedding?: number[] }[] } | null)?.data
  if (!Array.isArray(data) || !data.length) {
    return degradedOutcomeQuery(cfg.model, base, '嵌入响应缺少 data[] 或为空（HTTP 200 但无向量）', Date.now() - t0)
  }

  const vectors = data.map((d) => Float32Array.from(d.embedding ?? []))
  const dimReason = checkBatchDim(vectors, cfg.dim)
  if (dimReason) return degradedOutcomeQuery(cfg.model, base, `嵌入维度契约不满足：${dimReason}`, Date.now() - t0)

  return done(vectors, null)
}

/** 单条便捷式（`embedMany` 的 1 元素特例；**同一实现**，不另写一条路径）。 */
export async function embedOne(cfg: EmbedConfig, text: string): Promise<EmbedOutcome> {
  return embedTexts(cfg, [text])
}
