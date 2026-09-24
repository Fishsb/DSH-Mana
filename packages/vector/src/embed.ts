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
import { degradedOutcomeQuery, checkBatchDim, QUERY_MAX_CHARS, type EmbedOutcome } from './adapt.ts'

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
    return degradedOutcomeQuery(cfg.model, base, `嵌入端点返回 HTTP ${res.status}（${base}）`, Date.now() - t0)
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
