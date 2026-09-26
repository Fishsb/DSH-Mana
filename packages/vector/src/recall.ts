/**
 * 召回适配（B1.1）—— 词法打底 → 常驻向量 → 余弦 → RRF 融合。
 *
 * 管道形状抄自本机 shoucang `lib/vec.js` 的 `recallRanked`（只读参考），但**三处按本仓契约改写**：
 *
 * | 处 | 上游 | 本仓 | 为什么 |
 * |---|---|---|---|
 * | 1 | 失败折叠成 `null` / 纯词法结果 | 显式 `channel:'degraded'` + `reason` 非空 | `docs/contract/degradation.md` 硬约定 1（「看起来跑通、实际全走词法」查不出） |
 * | 2 | `fused` 归一到 `0..1` 再排序 | **用 RRF 原始分排序**，归一只是展示 | 上游自己也写明"归一只供展示"；把归一值当排序依据会让并列裁决不可复现 |
 * | 3 | 混合了活性降权 / 分层打分 v2 / 去重 | **不做**（本轮范围外） | 那些依赖 shoucang 的 activity/criteria 真源；搬进来会把跨仓依赖拖过界（见 handoff §5 未决项） |
 *
 * ⚠ **降级时 `rankBy` 必须是 `'local_score'`**（A1-11 原文）：降级路径上没有 JEV 概率，
 *   若仍标 `jev_prob`，下游会把「没判」读成「判了且低分」 —— 这正是 G8 要防的形态。
 */
import { cosine } from './cosine.ts'
import { rrfFuseRanked, RRF_DEFAULT_K, type FusedItem } from './rrf.ts'
import { embedTexts, type EmbedConfig } from './embed.ts'
import type { VectorStore } from './vec-blob.ts'
import type { RecallOutcome } from './adapt.ts'

/** 一个候选（词法打底给出的有序列表）。 */
export interface RecallCandidate {
  /** 稳定键：本仓用 `memory_items.id`（上游用 `file#line`，此处对齐本仓主键）。 */
  readonly key: string
  /** 词法名次（从 1 起）；`undefined` = 该候选不由词法路给出 ⇒ 词法路不加分。 */
  readonly lexicalRank?: number
}

/** 召回配置。 */
export interface RecallConfig extends EmbedConfig {
  /** RRF 常数 k（`册:394` k=60）。 */
  rrfK: number
}

/** 降级信封构造（**唯一出口**，避免各处手写漏字段）。 */
function degradedRecall(query: string, reason: string, items: FusedItem[] = []): RecallOutcome {
  return {
    query,
    hitCount: items.length,
    channel: 'degraded',
    rankBy: 'local_score',
    degraded: true,
    reason: reason || '未给出原因（调用方漏填）',
    items,
  }
}

/**
 * ── **大环路递归检索（v10 §12.5/§14.7）在这条检索路径上的位置**（E2 接线席）──────────
 *
 * 接线点**不在本函数体内**，而是**包在本函数的出口上**（`index.ts` 的 `recall()` 实现体）：
 * `recallVector` 之后 ⇒ 可选的大环路（`Config.bigLoop`，**缺省关**）。
 * 三条理由，逐条可判：
 *
 * 1. **契约面**：`RecallOutcome` 的 `channel`/`rankBy`/`degraded`/`hitCount`/`items` 是
 *    A1-11 与 `b11-vector.test.mjs` 的机检锚点。大环路若在这里改 `items`，就必须同时改
 *    `rankBy` 的口径（它现在恒是 `'rrf'` = "本结果按 RRF 排序"）—— 那是**册面**的决策，
 *    不是接线席能自己定的。⇒ 本函数**一个字节都不动**，大环路只带读数（`applied:false`）。
 * 2. **它需要的东西这里没有**：大环路的入口要 `core`（词法腿 `recallLexical` + 图腿的 db 句柄）
 *    与**本次召回已命中的键**（种子）。前者只有 `index.ts` 的 `apply()` 拿得到，后者就是
 *    本函数的返回值 —— 两个前提都在**出口**而非**内部**。
 * 3. **缺省关 + 递归**：它是多轮检索（`maxRounds` 缺省 6），闸门开在函数体内会让
 *    "跑一次向量召回"与"跑一场递归检索"在**每一次**调用上绑定；接在出口上则一次配置即可关掉，
 *    且关掉时**一次检索都不发**（`bigloop.ts` 的 `disabled` 腿）。
 *
 * ⇒ 接线形态、代价与读数面：`bigloop-wiring.ts`（旋钮与缺省）/ `retrieve-port.ts`（真实检索端口
 *   的实现），调用点与载荷字段：`index.ts` 的 recall 出口。本文件只留这段**指路**，
 *   不承担调用（"接线 = 生产调用方真的调它"由 `tests/bigloop-wiring.test.mjs` 的桩计数取证）。
 *
 * 向量召回。
 *
 * 返回的 `channel` 三态与**触发条件**（可枚举，便于判据直接断言）：
 * - `'vector'`   —— 查询嵌入成功**且**至少一条候选常驻命中 ⇒ 走余弦 + RRF；
 * - `'degraded'` —— 嵌入失败（端点不通/维度不符/未配置）**或**候选常驻全未命中 ⇒ 显式降级；
 * - `'lexical'`  —— **仅当调用方显式要求跳过向量**（`cfg.enabled=false` 且调用方声明走词法）。
 *
 * ⚠ 注意 `'degraded'` 与 `'lexical'` **不是同义词**：前者是"想走向量但没走成"（必须留痕），
 *   后者是"本来就不走向量"（不是故障）。把二者混同就是上游 `catch { return null }` 的病根。
 */
export async function recallVector(
  cfg: RecallConfig,
  store: VectorStore,
  query: string,
  candidates: readonly RecallCandidate[],
  topK: number,
): Promise<RecallOutcome> {
  const lexRank = new Map<string, number>()
  for (const c of candidates) if (c.lexicalRank !== undefined) lexRank.set(c.key, c.lexicalRank)
  const lexicalOnly: FusedItem[] = candidates
    .filter((c) => c.lexicalRank !== undefined)
    .map((c) => ({
      key: c.key,
      rank: { lexical: c.lexicalRank as number },
      score: 1 / (cfg.rrfK + (c.lexicalRank as number)),
      hits: 1,
    }))

  if (!cfg.enabled) {
    // 显式声明走词法（**不是故障**）：仍返回有序结果，`degraded=false`。
    return {
      query,
      hitCount: lexicalOnly.slice(0, topK).length,
      channel: 'lexical',
      rankBy: 'local_score',
      degraded: false,
      reason: null,
      items: lexicalOnly.slice(0, topK),
    }
  }

  if (!candidates.length) {
    // 候选池为空 ⇒ 没有可检索面。N=0 显式记 0，**不判降级**（0 是合法值，G5）。
    return { query, hitCount: 0, channel: 'vector', rankBy: 'rrf', degraded: false, reason: null, items: [] }
  }

  const emb = await embedTexts(cfg, [query])
  if (emb.degraded) return degradedRecall(query, `查询嵌入失败：${emb.reason}`, lexicalOnly.slice(0, topK))
  const qv = emb.vectors[0] as Float32Array

  const sims: { key: string; sim: number }[] = []
  const misses: string[] = []
  for (const c of candidates) {
    const got = store.get(c.key)
    if (!got.ok) {
      misses.push(`${c.key}(${got.reason})`)
      continue
    }
    sims.push({ key: c.key, sim: cosine(qv, got.item.vec) })
  }

  if (!sims.length) {
    return degradedRecall(query, `候选常驻向量全未命中（${misses.length}/${candidates.length} 条）：${misses.slice(0, 3).join('; ')}`, lexicalOnly.slice(0, topK))
  }

  // dense 名次：cos 降序，同分按 key 升序 ⇒ 逐位可复现（A 档前提）。
  sims.sort((a, b) => b.sim - a.sim || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const denseRank = new Map<string, number>()
  sims.forEach((s, i) => denseRank.set(s.key, i + 1))

  const fused = rrfFuseRanked(denseRank, lexRank, cfg.rrfK)
  return {
    query,
    hitCount: Math.min(topK, fused.length),
    channel: 'vector',
    rankBy: 'rrf',
    degraded: false,
    reason: null,
    items: fused.slice(0, topK),
  }
}

/** 只算余弦分（不做 RRF）：`recallVector` 的一个子步骤，导出以便判据单独取证。 */
export function denseRankOf(qv: ArrayLike<number>, entries: readonly { key: string; vec: ArrayLike<number> }[]): Map<string, number> {
  const sims = entries.map((e) => ({ key: e.key, sim: cosine(qv, e.vec) }))
  sims.sort((a, b) => b.sim - a.sim || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const rank = new Map<string, number>()
  sims.forEach((s, i) => rank.set(s.key, i + 1))
  return rank
}

export { RRF_DEFAULT_K }
