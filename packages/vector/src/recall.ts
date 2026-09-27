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
 *
 * ── **本文件的两件事，别混**（L1 交界的划线）──────────────────────────────────────
 * ① **候选从哪来**（候选来源）—— 本卡新增的**稠密候选腿**（见下节 `recallDenseCandidates`）：
 *    从库里列举**已嵌入**的行，算余弦取 topN，使「词法查不到但语义相近」的记忆**进得了候选池**。
 * ② **给定候选怎么排**（排序）—— 既有管道：余弦 → `rrfFuseRanked` → 按 RRF 分降序。
 * ⚠ 在①之前，候选池**只来自调用方传入的 `candidates`** ⇒ 那时的向量腿**是重排器，不是召回通道**
 *   （实测：词法 0 条 ⇒ 池空 ⇒ 直接 hitCount=0，连嵌入都不发）。本卡要越过的是**这条结构性边界**。
 *
 * ── 稠密候选腿：三条**声明出来的**取舍（每条都可被断言，不藏在注释里）─────────────────
 *
 * **声明① · 结果的态度仍由调用方说了算，本腿只搬候选。**
 *   本腿**不把**结果折成 `degraded`/不写 `reason`/不改 `channel` 或 `rankBy`。
 *   判因（可判、不是口味）：在**没有库句柄**的调用面上（如 `tools/a1-check.mjs`、`b1.1-⑦` 的
 *   不可达端点用例），"扫不成"是**该调用面本来就没提供扫描面**，不是这次的查询失败；把它折进 `degraded`，
 *   会让「端点真不可达」这条**既有**判据变成假绿（两种事同一个表示 —— 正是 G8 禁的形态）。
 *   ⇒ 扫描的成败走 `RecallOutcome.dense` 这个**契约外增量读数**（新增可选字段，
 *     `channel`/`rankBy`/`degraded`/`hitCount`/`items` 的语义一个字节不改）。
 *
 * **声明② · 阈值比较只在**取候选**时发生，`match` 只是**读数**，不进融合。**
 *   融入口径**逐字不动**：既有管道拿的是**余弦名次**（降序全序），不是分；阈值只决定"谁进得了池"。
 *   若把阈值做成融合里的分数门，就要改 `rrfFuseRanked`/自造加权和 —— 那是另立融合算法（本卡明令不许）。
 *
 * **声明③ · 只在请求池为空时才扫库，且代码里根本不存在"池非空也扫"的分支。**
 *   理由：v10 §14.3 把向量腿定位成**第三路召回**（`词法 Top50 + 向量 Top50 → RRF`）；
 *   池非空时它是**重排腿**（既有行为；若"顺带"把它变成整库扫描，既有的『0 候选 ⇒ 零网络』行为与耗时都会变）；
 *   池空时它是**召回腿**（这就是本卡要补的能力）。
 *   ⚠ 更关键的是：**没有"池非空也扫"的分支 ⇒ 正向提升与反向不变是同一条件**，本席无法悄悄把
 *     "词法已命中时的排序"换掉而判据看不出来。开与不开的差别、以及两种模式下的行为，
 *     都由 `tests/recall-dense.test.mjs` 逐条断言（正向真召回 / 反向仍 0 命中 / 池非空不扫）。
 */
import { cosine } from './cosine.ts'
import { rrfFuseRanked, RRF_DEFAULT_K, type FusedItem } from './rrf.ts'
import { embedTexts, type EmbedConfig } from './embed.ts'
// ⚠ 只多 import `decodeVector`（**非类型**）：扫描要从库里解码 BLOB，但本腿**不碰** `VectorStore` 的接口面
//   （常驻表没有枚举面；扫描的真相源是库，见 `recallDenseCandidates` 的说明）。
import { decodeVector, type VectorStore } from './vec-blob.ts'
import type { DenseCandidate, DenseCandidateReadout, DenseOmission, RecallOutcome } from './adapt.ts'

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
  /**
   * **稠密候选腿**（本卡新增；管"候选来源"，不管排序）。
   * ⚠ 可选：不传 = **本腿不尝试扫描**（读数 `dense` 为 `undefined`）。
   *   这是"纯重排器"那条既有调用面的口径（`tools/a1-check.mjs` 等不传库句柄的调用方），
   *   **不是**"缺省关闭"—— 生产调用面（`index.ts`）显式传它，那组缺省值在配置面。
   */
  dense?: DenseCandidateKnobs
  /** 库读面（只用于列举已嵌入行）。不传 ⇒ 本腿报 `no-db-handle`（不是故障）。 */
  denseDb?: DenseDbLike
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

// ══ 稠密候选来源（L1：让向量腿**自己产生候选**）════════════════════════════════════

/**
 * 扫不到候选面的**具名**口径（可枚举；与「扫了但没有相近的」互不冒充）。
 *
 * ⚠ **不是**降级原因（本腿不写 `degraded`，见文件头声明①）：
 *   它只回答「这次为什么没有候选可给」。
 */
export const DENSE_UNAVAILABLE = [
  /** 稠密候选腿已**显式关闭**（`enabled=false`）：本次未尝试扫描（不是故障）。 */
  'dense-disabled',
  /** 调用面**未提供库句柄**：本腿没有扫描面（不是故障 —— 该调用面本就不给扫描）。 */
  'no-db-handle',
  /** 查询嵌入失败：拿不到查询向量 ⇒ 无从算余弦（原因里带嵌入腿的原话）。 */
  'query-embed-degraded',
  /** 列举已嵌入行的 SQL **失败**（真故障；必须与「扫了但没有候选」可分辨）。 */
  'enumerate-failed',
  /**
   * 库里有行要算，但调用方**没给查询向量**（本腿的"只列举"相位用它换来一条既有性质：
   * **空库时一次嵌入都不发** —— 见 `recallVector` 的两段式扫描）。
   */
  'missing-query-vector',
] as const
export type DenseUnavailable = (typeof DENSE_UNAVAILABLE)[number]

/** 四条具名原因的**唯一**措辞（构造点不各自手写，避免"同一件事两种说法"）。 */
export const DENSE_DISABLED_REASON = 'dense-disabled：稠密候选腿已显式关闭（本次未尝试扫描，不是故障）'
export const DENSE_NO_DB_REASON = 'no-db-handle：调用面未提供库句柄（本腿没有扫描面，不是故障）'
export const DENSE_ENUMERATE_FAILED_REASON = 'enumerate-failed：列举已嵌入行失败'
export const DENSE_EMBED_DEGRADED_PREFIX = 'query-embed-degraded：查询嵌入失败，拿不到查询向量，无从算余弦'
export const DENSE_MISSING_QUERY_REASON = 'missing-query-vector：库里有已嵌入行要算，但本次没给查询向量（只列举的相位）'

/** 稠密候选腿的旋钮（本仓「一个旋钮一处声明」）。 */
export interface DenseCandidateKnobs {
  /** 是否启用稠密候选来源。⚠ 缺省见 `index.ts` 的 `Config.denseCandidates` 注释（那里有论证）。 */
  readonly enabled: boolean
  /** 相似度下限：余弦 **< threshold** 的一律不进候选池（只在"取候选"时发生，见文件头声明②）。 */
  readonly threshold: number
  /** 扫描上限（**行**）。SQL 的 `LIMIT` 取 `scanRows + 1` ⇒「上限被用满」本身也是可机检读数。 */
  readonly scanRows: number
  /** 取名次上限（**条**）。 */
  readonly topN: number
}

/**
 * 缺省旋钮（**唯一真源**）。
 *
 * ⚠ 这里与 `index.ts` 的 `Config` 缺省**成对存在**：schemastery 的 `default` 要的是字面量
 *   （它参与结构推导），故配置面必须再写一遍同样的四个值；本常量供**不走配置面**的调用方
 *   （判据、探针）取同一组缺省，避免第二套口径。
 */
export const DEFAULT_DENSE_CANDIDATE_KNOBS: DenseCandidateKnobs = Object.freeze({
  enabled: true,
  threshold: 0.5,
  scanRows: 512,
  topN: 20,
})

/**
 * 列表协议：本腿**只读一个列**（`memory_items.vector`）与主键，不写任何东西。
 * 与 `graph.ts` 的 `GraphDbLike` 同款（不持有 db 句柄：句柄由 core 独占，本包只借用它的读面）。
 */
export interface DenseDbLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

/**
 * 列举 SQL：**只列举已嵌入的行**，并按主键升序 —— 升序不是为了好看，
 * 而是让「扫描面」逐位可复现（不做排序时 SQLite 的行序**不保证稳定**，名次判据会"一会儿过一会儿不过"），
 * 也让 `scanRows` 的截断是**确定**的一条前缀。
 *
 * ⚠ 口径与检索同源（`core` 的召回 SQL 同样排除 `retired` 行）：软删除的记忆不得被向量腿带回来。
 * ⚠ **刻意不做"retired 列不存在就退回不排除"的二次尝试**：那样的兜底一旦命中，
 *   "扫了活记忆"与"扫了含已退休的"就会同形（本仓最忌），而它恰恰最不容易被发现；
 *   ⇒ 列缺失就是**具名失败**（`enumerate-failed` + `scanError=true`），不改语义。
 */
export const DENSE_ENUMERATE_SQL = 'SELECT id, vector FROM memory_items WHERE vector IS NOT NULL AND COALESCE(retired, 0) = 0 ORDER BY id ASC LIMIT ?'

/** `recallDenseCandidates` 的入参。 */
export interface DenseCandidateQuery {
  /**
   * 查询向量（与库里条目**同维**；维度不符由 `cosine` 按既有语义返回 0，不抛）。
   * ⚠ **可缺省**：库里没有可扫的行时，生产路径根本**不去取它**（这就是"空库不发嵌入"的落点）；
   *   真到了要算余弦却仍缺它 ⇒ 具名 `missing-query-vector`（不静默）。
   */
  readonly qv?: ArrayLike<number> | undefined
  /** 调用方本次要的条数（与 `topN` 取小 —— 请求 5 条时不必造 20 个名次）。 */
  readonly topK: number
  /** 调用方**已经给过**的候选键（含没有名次的）：这些键不再由本腿重复产出。 */
  readonly alreadyKeys: readonly string[]
}

/** `recallDenseCandidates` 的返回：候选 + **读数**（两者同一次调用内产生，不可能漂开）。 */
export interface DenseCandidatesResult {
  /** 进候选池的键与名次（**空数组** = 本次没产出，原因见 `readout`）。 */
  readonly candidates: readonly DenseCandidate[]
  readonly readout: DenseCandidateReadout
}

const msgOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * **稠密候选腿**：从库里列举**已嵌入**的行（`vector IS NOT NULL`），算余弦，取 topN 作候选。
 *
 * 复用既有件（本卡硬要求，不许另写一份）：
 *   · `decodeVector`（`vec-blob.ts`）—— BLOB ⇄ `Float32Array` 的**唯一**解码出口；
 *   · `cosine`（`cosine.ts`）—— 相似度的**唯一**算法；
 *   · 名次口径与 `recallVector` 内的既有排序**逐字同源**（cos 降序、同分按 key 升序）。
 * ⚠ 本函数**不碰** `VectorStore`：常驻表没有枚举面（`vec-blob.ts` 只给 `size/has/get/put`），
 *   故扫描的真相源是**库**（`memory_items.vector`），不是内存缓存 —— 后者是缓存，不是全集。
 *
 * 失败与边界**逐条可分辨**（都有具名读数，没有一条是"空结果"了事）：
 *   | 情形 | `ran` | `scanError` | `scanned` | `matched` | 具名原因 |
 *   |---|---|---|---|---|---|
 *   | 未启用 | false | false | 0 | 0 | `dense-disabled` |
 *   | 无库句柄 | false | false | 0 | 0 | `no-db-handle` |
 *   | 查询嵌入失败 | false | false | 0 | 0 | `query-embed-degraded` |
 *   | 列举 SQL 失败 | false | **true** | 0 | 0 | `enumerate-failed` + 原始报错 |
 *   | 库中无已嵌入行 | true | false | **0** | 0 | `null` |
 *   | 扫了但都不相近 | true | false | >0 | **0** | `null`（逐行原因在 `omitted`） |
 *   | 扫出候选 | true | false | >0 | >0 | `null` |
 *
 * ⚠ 第一组 `scanned=0`（没扫）与第五行 `scanned=0`（**扫了，库里没有可扫的行**）**靠 `ran` 分开**；
 *   第四行靠 `scanError` 与第五行分开（扫不成 ≠ 扫了没有）—— 这是本卡"失败可分辨"的机械落点。
 */
/** 列举出来的一行（**只读主键与向量列**）。 */
export interface DenseRow {
  readonly id: string
  readonly vector: Uint8Array | Buffer | null
}

/** 没跑成的统一形状：**唯一**构造点，避免多个分支各写一遍漏字段。 */
function notRunReadout(
  knobs: DenseCandidateKnobs,
  unavailableReason: string,
  scanError = false,
): DenseCandidateReadout {
  return {
    enabled: knobs.enabled,
    threshold: knobs.threshold,
    scanRows: knobs.scanRows,
    topN: knobs.topN,
    ran: false,
    unavailableReason,
    scanned: 0,
    matched: 0,
    scanLimitReached: false,
    candidates: [],
    candidateSims: [],
    omitted: [],
    scanError,
  }
}

/**
 * **只列举**相位（**不依赖嵌入**）：库里有几行要扫？
 *
 * 为什么把它单独拆出来：它把「空库 ⇒ 一次嵌入都不发」这条**既有性质**保住
 * （'core/tests/chain-e2e.test.mjs' 的空候选用例就依赖它）。没有这一拆，
 * 开腿就得先发一次查询嵌入 —— 那是在**库里根本没有可扫的行**时也去付嵌入的代价。
 *
 * 返回 `rowCount = 0`（真扫过、只是没得扫）与**具名失败**（`unavailableReason` 非空）
 * **互不冒充**：前者 `ran = true`，后者 `ran = false`。
 */
export function enumerateEmbeddedRows(
  knobs: DenseCandidateKnobs,
  db: DenseDbLike | undefined,
): { rows: readonly DenseRow[]; readout: DenseCandidateReadout } {
  if (!knobs.enabled) return { rows: [], readout: notRunReadout(knobs, DENSE_DISABLED_REASON) }
  if (!db) return { rows: [], readout: notRunReadout(knobs, DENSE_NO_DB_REASON) }
  if (knobs.scanRows <= 0) {
    // 上限为 0 ⇒ "扫 0 行"是**合法且显式**的结果（N=0 记 0）：不是故障、也不是"扫了没命中"。
    return {
      rows: [],
      readout: {
        enabled: knobs.enabled,
        threshold: knobs.threshold,
        scanRows: knobs.scanRows,
        topN: knobs.topN,
        ran: true,
        unavailableReason: null,
        scanned: 0,
        matched: 0,
        scanLimitReached: false,
        candidates: [],
        candidateSims: [],
        omitted: [],
        scanError: false,
      },
    }
  }
  let rows: DenseRow[]
  try {
    // ⚠ 'LIMIT' 取 'scanRows + 1'：多读**一行**只为判定"上限是否被用满"（见下），不为多用。
    const got = db.prepare(DENSE_ENUMERATE_SQL).all(knobs.scanRows + 1) as { id?: unknown; vector?: unknown }[]
    rows = got.map((r) => ({ id: String(r.id), vector: (r.vector ?? null) as Uint8Array | Buffer | null }))
  } catch (error) {
    // 列举失败**绝不静默折成空候选**：具名 + 原始报错 + 'scanError=true'（真故障与"没命中"不同形）。
    return { rows: [], readout: notRunReadout(knobs, `${DENSE_ENUMERATE_FAILED_REASON}（${DENSE_ENUMERATE_SQL}）：${msgOf(error)}`, true) }
  }
  // 截断口径（两条**不同**的事实，不得同形）：
  //   · 读回 scanRows+1 行 ⇒ 上限**被用满**（库里可能还有没扫到的行）⇒ scanLimitReached=true；
  //   · 读回 ≤ scanRows 行 ⇒ 库里的已嵌入行**都扫过了** ⇒ false（不是"没有截断证据"，是"确实没截断"）。
  const scanLimitReached = rows.length > knobs.scanRows
  const scanned = Math.min(rows.length, knobs.scanRows)
  const limited = rows.slice(0, scanned)
  return {
    rows: limited,
    readout: {
      enabled: knobs.enabled,
      threshold: knobs.threshold,
      scanRows: knobs.scanRows,
      topN: knobs.topN,
      ran: true,
      unavailableReason: null,
      scanned,
      matched: 0,
      scanLimitReached,
      candidates: [],
      candidateSims: [],
      omitted: [],
      scanError: false,
    },
  }
}

export function recallDenseCandidates(
  knobs: DenseCandidateKnobs,
  db: DenseDbLike | undefined,
  query: DenseCandidateQuery,
): DenseCandidatesResult {
  const notRun = (unavailableReason: string, scanError = false): DenseCandidatesResult => ({
    candidates: [],
    readout: notRunReadout(knobs, unavailableReason, scanError),
  })

  if (!knobs.enabled) return notRun(DENSE_DISABLED_REASON)
  if (!db) return notRun(DENSE_NO_DB_REASON)
  // ⚠ 列举**只做一次**（`enumerateEmbeddedRows` 的唯一调用点在生产路径的**两段式**里）：
  //   本函数自身再列举一次只是为了让"单次调用"这种用法（判据/探针）也成立。
  const phase = enumerateEmbeddedRows(knobs, db)
  // 没扫成（含"未启用/无句柄"）与"扫了但库里没有可扫的行"**逐条区分**，不得压成同一个空候选。
  if (!phase.readout.ran || phase.readout.scanned === 0) return { candidates: [], readout: phase.readout }
  const qv = query.qv
  if (qv === undefined) {
    // ⚠ **不静默**：库里有行可算、却拿不到查询向量 ⇒ 具名（调用方自己两段式用错时才会走到这里）。
    return notRun(DENSE_MISSING_QUERY_REASON)
  }
  const limited = phase.rows
  const scanned = phase.readout.scanned
  const scanLimitReached = phase.readout.scanLimitReached

  const ranked = rankDenseRows(knobs, qv, phase.rows, { topK: query.topK, alreadyKeys: query.alreadyKeys })
  return {
    candidates: ranked.candidates,
    readout: {
      ...phase.readout,
      matched: ranked.matched,
      candidates: ranked.candidates,
      candidateSims: ranked.candidateSims,
      omitted: ranked.omitted,
    },
  }
}

/**
 * **余弦与取名次**（列举相位的下游；**全仓唯一的稠密扫描循环**）。
 *
 * ⚠ 生产路径的两段式（先列举、再算）与 `recallDenseCandidates` 的单次调用**共用本函数**：
 *   若各写一份，"扫描用一份口径、打分用另一份"就成了两个真源（本仓最防的漂移形态）。
 *
 * 只做三件事，逐条对应既有件（不另写算法）：
 *   ① 解码 `decodeVector`（`vec-blob.ts`）；
 *   ② 相似度 `cosine`（`cosine.ts`）；
 *   ③ 名次 = cos 降序、同分按 key 升序（与 `recallVector` 内既有口径同源）。
 * 被挡下/被截掉的**逐条具名**（`omitted`）——"量过而漏掉"不得与"从未扫到"同形。
 */
export function rankDenseRows(
  knobs: DenseCandidateKnobs,
  qv: ArrayLike<number>,
  rows: readonly DenseRow[],
  opts: { topK: number; alreadyKeys: readonly string[] },
): {
  candidates: DenseCandidate[]
  candidateSims: number[]
  omitted: DenseOmission[]
  matched: number
} {
  const already = new Set(opts.alreadyKeys)
  const sims: { key: string; sim: number }[] = []
  const omitted: DenseOmission[] = []
  for (const row of rows) {
    if (already.has(row.id)) {
      omitted.push({ key: row.id, reason: '调用方已提供该键（含无名次的）⇒ 本腿不重复产出' })
      continue
    }
    const dec = decodeVector(row.vector, undefined)
    if (!dec.ok) {
      omitted.push({ key: row.id, reason: `解码失败：${dec.reason}` })
      continue
    }
    // ⚠ **复用既有 `cosine`**（不另写一份）：长度不等/零向量按既有语义返回 0 ——
    //   此时下面那条 omitted 的 reason 里会带上实测维度，"维度不符"不会被读成"语义不像"。
    const sim = cosine(qv, dec.vec)
    if (!(sim >= knobs.threshold)) {
      omitted.push({ key: row.id, reason: `余弦 ${sim.toFixed(6)} < 阈值 ${knobs.threshold}（该行 ${dec.vec.length} 维）` })
      continue
    }
    sims.push({ key: row.id, sim })
  }

  // 名次：cos 降序、同分按 key 升序 ⇒ 逐位可复现（与 `recallVector` 内既有口径**同源**，不另立一套）。
  sims.sort((a, b) => b.sim - a.sim || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const cap = Math.max(0, Math.min(knobs.topN, opts.topK))
  const picked = sims.slice(0, cap)
  const keep = new Set(picked.map((s) => s.key))
  // 过了阈值但没进池的，同样**具名**（"量过而漏掉"不得与"从未扫到"同形）。
  for (const s of sims) {
    if (!keep.has(s.key)) {
      omitted.push({ key: s.key, reason: `过了阈值但名次超出取数上限（topN=${knobs.topN}，请求 topK=${opts.topK} ⇒ 实取 ${cap} 条）` })
    }
  }
  return {
    candidates: picked.map((s, i) => ({ key: s.key, denseRank: i + 1 })),
    candidateSims: picked.map((s) => s.sim),
    omitted,
    matched: sims.length,
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
 *
 * ── 候选来源（本卡新增的那一半，**不改**上面三态）──────────────────────────────
 * 请求池**空**时先问稠密腿（`recallDenseCandidates`）；**非空时根本不扫库**（文件头声明③）。
 * 扫描成败走 `RecallOutcome.dense` 读数，**不折进** `degraded`/`reason`（文件头声明①）。
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

  // 请求池 = 调用方给的候选 ∪ 稠密腿自产的候选（后者**没有词法名次**：语义与 RecallCandidate 注释一致）。
  let pool: readonly RecallCandidate[] = candidates
  /** 稠密腿读数：**未尝试扫描**时为 `undefined`（三种读法见 `RecallOutcome.dense`）。 */
  let dense: DenseCandidateReadout | undefined
  /**
   * 查询向量：**整趟共用一份**（扫描与打分用的是同一个向量）。
   * ⚠ 提在这里而不是各写一次：`embedTexts` 发的是真网络请求，两处各发一次既是双倍代价，
   *   也让「扫描用一份、打分用另一份」成为可能（两个真源 —— 本仓最防的漂移形态）。
   */
  let qv: Float32Array | undefined

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
    // 请求池为空 ⇒ 改前这里就没有可检索面（N=0 显式记 0，**不判降级** —— 0 是合法值，G5）。
    // 本卡在这条早退**之前**补上唯一的候选来源：让向量腿自己去库里找。下面这段就是那个「之前」；
    // 没有它，本函数是重排器；有它，才有资格叫召回通道。
    // ⚠ **`cfg.dense` 缺省 ⟺ 本腿不被调用**（`RecallConfig.dense` 的注释就是这么写的）：
    //   缺省时连列举都不做、`dense` 键不写；给了它则必然留下读数（ran=true 或具名原因，没有第三种）。
    //   两条**都不是**"默认关闭"：未启用是显式关（`dense-disabled`），没被叫到是**本次没要求**。
    const knobs = cfg.dense ?? DEFAULT_DENSE_CANDIDATE_KNOBS
    // ⚠ **两段式：先列举、再嵌入**（不是随手拆的，理由见下）：
    //   既有性质「空库 / 未开腿 ⇒ **一次嵌入都不发**」必须保住
    //   （`core/tests/chain-e2e.test.mjs` 的空候选用例正是这条口径）。若先嵌入再列举，
    //   库里**根本没有可扫的行**时也会白付一次嵌入 —— 那是把「没得扫」做成一次不必要的网络往返，
    //   并且改变了既有行为（本卡的红线是"增带，不是改写"）。
    const phase =
      cfg.dense === undefined
        ? { rows: [], readout: undefined }
        : enumerateEmbeddedRows(knobs, cfg.denseDb)
    if (phase.readout !== undefined && phase.readout.ran && phase.readout.scanned > 0) {
      // 库里有行要算 ⇒ 这一步才值得发嵌入（**只发一次**：下面的既有管道复用同一个查询向量，
      // 否则「扫描用一份、打分用另一份」就成了两个真源 —— 本仓最防的漂移形态）。
      const emb = await embedTexts(cfg, [query])
      if (emb.degraded) {
        dense = notRunReadout(knobs, `${DENSE_EMBED_DEGRADED_PREFIX}：${emb.reason}`)
      } else {
        qv = emb.vectors[0] as Float32Array
        const ranked = rankDenseRows(knobs, qv, phase.rows, {
          topK,
          alreadyKeys: candidates.map((c) => c.key),
        })
        dense = {
          ...phase.readout,
          matched: ranked.matched,
          candidates: ranked.candidates,
          candidateSims: ranked.candidateSims,
          omitted: ranked.omitted,
        }
        if (ranked.candidates.length) pool = ranked.candidates.map((c) => ({ key: c.key }))
      }
    } else if (phase.readout !== undefined) {
      // 没扫成 / 库里没得扫：**读数照记**（这才是「没得扫」与「扫了不相近」的分辨点），但**不发嵌入**。
      dense = phase.readout
    }
    // （`phase.readout === undefined` ⇒ 调用方没要求本腿：不扫、不写键、也不发嵌入。）
    if (!pool.length) {
      // 稠密腿也没给出候选 ⇒ 原样保留改前的空池返回（hitCount:0 / channel:'vector' / rankBy:'rrf' / degraded:false），
      // 只**增带**读数 —— 态度仍由调用方说了算（文件头声明①）。
      return {
        query,
        hitCount: 0,
        channel: 'vector',
        rankBy: 'rrf',
        degraded: false,
        reason: null,
        items: [],
        ...(dense !== undefined ? { dense } : {}),
      }
    }
  }

  // ⚠ 只在**还没拿到**查询向量时才发嵌入（池非空且来自调用方时才会走到这里；稠密腿已取过则直接复用）。
  if (qv === undefined) {
    const emb = await embedTexts(cfg, [query])
    if (emb.degraded) {
      const base = degradedRecall(query, `查询嵌入失败：${emb.reason}`, lexicalOnly.slice(0, topK))
      return dense !== undefined ? { ...base, dense } : base
    }
    qv = emb.vectors[0] as Float32Array
  }
  const qvec = qv

  const sims: { key: string; sim: number }[] = []
  const misses: string[] = []
  for (const c of pool) {
    const got = store.get(c.key)
    if (!got.ok) {
      misses.push(`${c.key}(${got.reason})`)
      continue
    }
    sims.push({ key: c.key, sim: cosine(qvec, got.item.vec) })
  }

  if (!sims.length) {
    const base = degradedRecall(
      query,
      `候选常驻向量全未命中（${misses.length}/${pool.length} 条）：${misses.slice(0, 3).join('; ')}`,
      lexicalOnly.slice(0, topK),
    )
    return dense !== undefined ? { ...base, dense } : base
  }

  // dense 名次：cos 降序，同分按 key 升序 ⇒ 逐位可复现（A 档前提）。
  sims.sort((a, b) => b.sim - a.sim || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const denseRank = new Map<string, number>()
  sims.forEach((s, i) => denseRank.set(s.key, i + 1))

  const fused = rrfFuseRanked(denseRank, lexRank, cfg.rrfK)
  const out: RecallOutcome = {
    query,
    hitCount: Math.min(topK, fused.length),
    channel: 'vector',
    rankBy: 'rrf',
    degraded: false,
    reason: null,
    items: fused.slice(0, topK),
  }
  // ⚠ **只在扫过时增带读数**：没尝试过扫描就不写这个键（`undefined` ≠ `ran:false`，见契约注释）。
  return dense !== undefined ? { ...out, dense } : out
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
