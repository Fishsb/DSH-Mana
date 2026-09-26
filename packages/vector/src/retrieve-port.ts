/**
 * **大环路的检索端口：生产实现**（E2 接线席）—— `bigloop.ts` 把 `retrieve` 设计成
 * **调用方注入**（不新增跨包依赖边，理由见其文件头「为什么不自己检索」）：
 * 那个决定把「怎么检索」留给调用方，而**留 null 就等于没接线**。本文件就是那个调用方。
 *
 * ── 本端口一次调用真做了什么（三条腿 + 线索，逐条落成可读读数）──────────────────
 * | 步 | 生产入口 | 产出 | 读数 |
 * |---|---|---|---|
 * | ① 种子（**仅第 1 轮**）| 调用方带来（本次召回管道**命中**的键 ⇒ `seedKeys`）| 与门控/图腿**同一份**候选面 | `evidence.consumed` 的种子数 |
 * | ② 词法腿 | `core.recallLexical(query, limit)`（FTS5/trigram，core 的生产入口）| 按名次有序的命中键 | `lexicalKeys` / `lexicalReason` |
 * | ③ 图腿 | `runGraphLeg(core.db, { seeds, keylessKeys: [] })`（`graph.ts`，**本包既有腿**）| 邻接扩展的键 + 优先级分 | `graphKeys` / `graphReason` / `graphRounds` |
 * | ④ 关联线索 | `memory_items` 的 `tags` / `summary` / `content` ⇒ 切段 | `clues`（**决定下一轮问什么**）| `clueReadFailures` |
 *
 * ── 为什么**不**做成"一行适配 `svc.recall`"（bigloop.ts 文件头举的那个例子）─────────
 * 那会**递归调用自己**：`svc.recall` 的出口就是本端口的调用点，再调一次就是同一个套娃。
 * 递归不是这里的设计目标，"**线索驱动下一轮**"才是 ⇒ 端口按**查询串**检索（词法腿 + 图腿
 * 扩展），而 `svc.recall` 的产物用作**第 1 轮的种子**（调用方带入）：
 *   「本次召回命中的东西」是起点，「由它们的关联线索问出来的新东西」才是环路要带回来的。
 *
 * ── 线索（② 关联线索提取）的真实来源，以及它的**边界**（代价写出来）────────────────
 * 本仓**没有**「一条记忆的关联线索」这样的既有列：`memory_items.related_ids` 是**边**
 * （learning 写、graph 读），不是查询串；能当查询串用的只有内容面。故：
 *   · 首选 `tags`（若写入侧填了；`writeMemoryItem` 不填，别处路径可能填）；
 *   · 否则把 `summary`（缺则 `content`）按标点/空白切段，只取长度 `MIN_QUERY_CHARS..24` 的段
 *     —— 下界取 core 的 `MIN_QUERY_CHARS`（**唯一真源**）：短于它的查询在 trigram FTS5 下
 *     恒 0 命中且不报错，拿它当线索只会制造"问了等于没问"的空转（且不可分辨）；
 *   · **每键上限 4 条**（下一轮的查询条数还有 bigloop 的 `maxNewQueriesPerRound` 再收一次）。
 * 代价（如实写，不掩饰）：切出来的段**不保证**是"实体/话题"，可能问出低质查询。
 *   这正是 bigloop 三条收敛判据（前沿空 / 增长低于阈值 / 检索饱和）与硬上限要挡的东西，
 *   且**每轮的读数都留在载荷里**（`newQueries`/`grewBy`/`growthRatio`…）⇒ 可事后判优劣，
 *   不需要现在替它保证质量。
 *
 * ⚠ **线索读失败不吞**（`contract/degradation.md` 硬约定 1）：SQL 抛错时**不能**只当"这条没有
 *   线索" —— 那是把"读不出来"与"本来就没有"压成同一个读数。本实现记 `clueReadFailures` 并把
 *   原文带进 `clueFailureReason`（`clueState='none'` 仍按 bigloop 的定义写，因为它描述的是
 *   **候选面**，而失败描述的是**读取面**，两者分开记）。
 *
 * ── 边界自证（本模块**不**做什么）──────────────────────────────────────────────
 * · **零注册点**：无 `ctx.on`/`ctx.effect`/定时器/pre-step（与 `graph.ts`、`recall-gate-hook.ts` 同纪律）；
 * · **零写库**：只 `SELECT`（`recallLexical` 与图腿都是只读腿），不 `INSERT`/`UPDATE`/`CREATE`；
 * · **零新表、零新列**：只读 `memory_items`（含 `tags`/`summary`/`content` 三个既有列）；
 * · **零 dependency 新增**：只用 `dsh-mana-core`（本包既有 peerDep）与**本包内**的
 *   `graph.ts`/`rrf.ts`/`bigloop.ts`（类型面）；
 * · **零随机、零时钟**：输出只由入参、库内容与调用顺序决定 ⇒ 判据可逐位复现（A 档前提）。
 */
import { MIN_QUERY_CHARS } from 'dsh-mana-core'
import { RRF_DEFAULT_K } from './rrf.ts'
import { graphPriorityScore, runGraphLeg, type GraphDbLike, type RecallGraphKnobs } from './graph.ts'
import type { BigLoopCandidate } from './bigloop.ts'

/** 端口需要的 core 面 —— **收窄到真正用到的两个成员**（不是整个 `ManaCoreService`）：
 *  依赖面写得越窄，"这个端口到底碰了什么"越可判；`ManaCoreService` 结构上满足它。 */
export interface BigLoopRetrieveCoreLike {
  /** 只读库句柄（图腿要；本模块自己不 prepare 任何 SQL）。 */
  readonly db: GraphDbLike
  /** 词法召回（core 的生产入口；FTS5/trigram + 长度闸）。 */
  recallLexical(rawQuery: string, limit?: number): BigLoopLexicalResultLike
}

/** `LexicalRecallResult` 的最小形状（本地复述，避免为三个字段引入更多符号面）。 */
export interface BigLoopLexicalResultLike {
  readonly hits: readonly { readonly id: string }[]
  /** 0 命中的原因分类（`ok`=真查了就是 0 / `too_short`=被长度闸挡下 / `empty_library`=库空）。 */
  readonly reason: 'ok' | 'too_short' | 'empty_library' | null
}

/** 端口的上界旋钮（**不设"能改行为"的开关**：跳数/范围等只在 `graph` 配置里）。 */
export interface BigLoopRetrieveLimits {
  /** 每轮从词法腿取多少条（进 FTS5 的 `LIMIT`）。 */
  readonly lexicalLimit: number
  /** 每轮最多回给大环路多少条（在"种子 → 词法 → 图扩展"**组装之后**截断）。 */
  readonly topK: number
}

/** 缺省上界（**唯一真源**；`index.ts` 的 Schema 缺省用它的显式字面量）。 */
export const DEFAULT_BIGLOOP_RETRIEVE_LIMITS: BigLoopRetrieveLimits = Object.freeze({
  lexicalLimit: 50,
  topK: 50,
})

export interface BigLoopRetrieveOptions {
  readonly core: BigLoopRetrieveCoreLike
  /**
   * **第 1 轮的种子** = 本次召回管道**已命中**的键（`outcome.items`）。
   * ⚠ 它们进 `rawCount` 但**不是**"大环路检索出来的"：故 `score=0`、`channels=[]`
   *   （`recall.ts`/`rrf.ts` 口径：名字不能凭空造，"命中得很差"与"没命中"必须可分辨），
   *   而它们带出的**线索**才是环路真正的输入。
   */
  readonly seedKeys?: readonly string[]
  /** 图腿旋钮（**透传** `Config.recallGraph`：图腿的开关就是那个开关，本端口不另立一份）。 */
  readonly graph?: RecallGraphKnobs
  readonly limits?: Partial<BigLoopRetrieveLimits>
}

/**
 * 端口运行至今的**实证读数**（"这次检索到底读了什么"的可断言面）。
 *
 * ⚠ 计数与列表**跨轮**（不是"最近一次"）：大环路本身就是多轮的，只报最后一轮会让
 *   "第 1 轮读了什么"在读数里**不可查**（判据会随查询链的长短变色 —— 本仓最防的形态）。
 *   逐轮的量（查询串、原因分类）用**数组**表达，长度恒等于 `calls`；跨轮的量（键集）用**并集**。
 */
export interface BigLoopRetrieveEvidence {
  /** 端口被调用了几次（= 大环路真发了几次检索）。 */
  readonly calls: number
  /** 每次调用用的查询串（逐轮；长度 = `calls`）。 */
  readonly queries: readonly string[]
  /** 词法腿**跨轮并集**的命中键（去重、升序）。 */
  readonly lexicalKeys: readonly string[]
  /** 每次调用词法腿的原因分类（逐轮；长度 = `calls`）。 */
  readonly lexicalReasons: readonly ('ok' | 'too_short' | 'empty_library' | null)[]
  /** 图腿**跨轮并集**扩展出来的键（去重、升序）。 */
  readonly graphKeys: readonly string[]
  /** 每次调用图腿的未运行/失败原因（逐轮；长度 = `calls`；`null` ⇒ 那一次真扩了）。 */
  readonly graphReasons: readonly (string | null)[]
  /** 图腿未运行/失败原因（**最近一次非 null 的**；全为 null ⇒ 每次都正常扩了）。 */
  readonly graphReason: string | null
  /** 图腿跑过几次。 */
  readonly graphRounds: number
  /** 线索读失败次数（**不吞**：>0 ⇒ 有键的线索没读到，与"本来没有线索"可分辨）。 */
  readonly clueReadFailures: number
  /** 第一条线索读失败的原因（原文，便于定位）。 */
  readonly clueFailureReason: string | null
  /** 实际读取口径（可读）。 */
  readonly consumed: string
}

/**
 * 检索端口。`evidence()` 是**活快照**（每次调用取一次），不是创建时的冻结值 ——
 * 否则"读了什么"会与"什么时候读的"漂开（本仓最防的形态）。
 */
export interface BigLoopRetrievePort {
  (query: string, round: number): readonly BigLoopCandidate[]
  evidence(): BigLoopRetrieveEvidence
}

/** 每条键最多抽多少条线索（§"线索的真实来源"里的上界）。 */
export const BIGLOOP_CLUES_PER_KEY = 4
/** 线索段的长度上界（长度下界取 core 的 `MIN_QUERY_CHARS`，见文件头）。 */
export const BIGLOOP_CLUE_MAX_CHARS = 24
/** 线索切分符（标点/空白/竖线；**不含 `/`**，那是路径分隔符，切了会造出无意义片段）。 */
const CLUE_SPLIT = /[\s\u3000，。！？；：、,.;:!?（）()【】“”"'·—|]+/

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 把一段文本切成候选线索（确定性：同一输入恒同一序列）。 */
export function clueSegments(text: string, maxChars: number = BIGLOOP_CLUE_MAX_CHARS): string[] {
  const out: string[] = []
  for (const raw of String(text ?? '').split(CLUE_SPLIT)) {
    const s = raw.trim()
    if (s.length < MIN_QUERY_CHARS || s.length > maxChars) continue
    if (!out.includes(s)) out.push(s)
  }
  return out
}

/**
 * 造一个**真实**检索端口（生产路径用的就是这个）。
 *
 * 一次调用的返回面（**顺序即口径**，逐条可断言）：
 *   1. 种子（仅第 1 轮；`score=0`、`channels=[]`）；
 *   2. 词法腿命中（按名次；`score = 1/(RRF_DEFAULT_K + rank)`）；
 *   3. 图腿扩展出的键（按图腿优先级；`score = graphPriorityScore(hop, sense)`）。
 * 同键只出现一次（**首次胜**）—— 去重在这里发生，跨轮整合仍由 bigloop 的 `mergeCandidates` 负责。
 */
export function makeBigLoopRetriever(opts: BigLoopRetrieveOptions): BigLoopRetrievePort {
  const limits: BigLoopRetrieveLimits = { ...DEFAULT_BIGLOOP_RETRIEVE_LIMITS, ...(opts.limits ?? {}) }
  const seeds = [...new Set((opts.seedKeys ?? []).filter((k) => typeof k === 'string' && k !== ''))].sort()
  const graphCfg = opts.graph

  const calls: string[] = []
  /** 跨轮并集（去重升序）—— **不是"最近一次"**，见 `BigLoopRetrieveEvidence` 的说明。 */
  const lexicalKeySet = new Set<string>()
  const graphKeySet = new Set<string>()
  const lexicalReasons: BigLoopRetrieveEvidence['lexicalReasons'][number][] = []
  const graphReasons: (string | null)[] = []
  let graphReason: string | null = null
  let graphRounds = 0
  let clueReadFailures = 0
  let clueFailureReason: string | null = null
  /** 跨轮累积的**已知键**（用来算"本轮新发现了什么" ⇒ 下一轮只从新键继续扩，不重扫）。 */
  const known = new Set<string>()
  /** 上一轮新发现的键（下一轮图腿的种子）。 */
  let freshFromLast = seeds
  /** 线索缓存（**内容面的纯函数** ⇒ 同一键只切一次，六个轮次不重复付解码代价）。 */
  const clueCache = new Map<string, string[]>()

  const readClues = (key: string): string[] => {
    const hit = clueCache.get(key)
    if (hit) return hit
    let out: string[] = []
    try {
      const row = opts.core.db
        .prepare('SELECT content, summary, tags FROM memory_items WHERE id = ?')
        .all(key)[0] as { content?: unknown; summary?: unknown; tags?: unknown } | undefined
      if (row) {
        const tags = typeof row.tags === 'string' ? clueSegments(row.tags) : []
        if (tags.length) out = tags
        else {
          const text =
            typeof row.summary === 'string' && row.summary.trim() !== ''
              ? row.summary
              : typeof row.content === 'string'
                ? row.content
                : ''
          out = clueSegments(text)
        }
      }
    } catch (error) {
      // ⚠ **不吞**（见文件头）：计数 + 原文进读数；线索列表本身仍为空（候选条目照常返回）。
      clueReadFailures += 1
      if (clueFailureReason === null) clueFailureReason = `读线索失败（${key}）：${msgOf(error)}`
      out = []
    }
    const trimmed = out.slice(0, BIGLOOP_CLUES_PER_KEY)
    clueCache.set(key, trimmed)
    return trimmed
  }

  const retrieve = (query: string, round: number): readonly BigLoopCandidate[] => {
    calls.push(query)
    const rows: BigLoopCandidate[] = []
    const seen = new Set<string>()
    const push = (key: string, score: number, channels: string[]): void => {
      if (seen.has(key)) return
      seen.add(key)
      rows.push({ key, score, channels, clues: readClues(key) })
    }

    // ── ① 种子（仅第 1 轮；见 BigLoopRetrieveOptions.seedKeys 的口径说明）──────────
    if (round === 1) for (const s of seeds) push(s, 0, [])

    // ── ② 词法腿：真查 FTS5（core 的生产入口；长度闸/库空分类由 core 给）────────────
    let lex: BigLoopLexicalResultLike
    try {
      lex = opts.core.recallLexical(query, limits.lexicalLimit)
    } catch (error) {
      // 抛出去 ⇒ bigloop 报 `search-error` + 原文（**不重试、不静默跳过**）。这正是它要的输入。
      throw new Error(`检索端口·词法腿：FTS5 查询抛错（查询「${query}」）：${msgOf(error)}`)
    }
    lexicalReasons.push(lex.reason)
    const lexicalKeys = lex.hits.map((h) => h.id)
    for (const k of lexicalKeys) lexicalKeySet.add(k)
    lexicalKeys.forEach((k, i) => push(k, 1 / (RRF_DEFAULT_K + (i + 1)), ['lexical']))

    // ── ③ 图腿：从**已知面**沿关联边扩（第 1 轮 = 种子 + 本轮词法命中；其后 = 上轮新键）──
    const graphSeedKeys = round === 1 ? [...new Set([...seeds, ...lexicalKeys])].sort() : [...freshFromLast].sort()
    const leg = runGraphLeg(opts.core.db, {
      seeds: graphSeedKeys,
      // 撞键无值（sense=3）由 `index.ts` 的候选面判定 ⇒ 本端口**不猜**（见 graph.ts 的说明）。
      keylessKeys: [],
      ...(graphCfg ? { cfg: graphCfg } : {}),
    })
    graphRounds += 1
    graphReasons.push(leg.reason)
    if (leg.reason !== null) graphReason = leg.reason
    for (const a of leg.additions) {
      graphKeySet.add(a.key)
      push(a.key, graphPriorityScore(a.hop, a.sense), [`graph:hop${a.hop}:sense${a.sense}`])
    }

    // ── 账本：本轮有哪些**从没见过**的键（下一轮的图腿种子）──────────────────────────
    const fresh: string[] = []
    for (const r of rows) {
      if (known.has(r.key)) continue
      known.add(r.key)
      fresh.push(r.key)
    }
    freshFromLast = fresh
    return rows.slice(0, Math.max(0, limits.topK))
  }

  const port = Object.assign(retrieve, {
    evidence: (): BigLoopRetrieveEvidence => ({
      calls: calls.length,
      queries: [...calls],
      lexicalKeys: [...lexicalKeySet].sort(),
      lexicalReasons: [...lexicalReasons],
      graphKeys: [...graphKeySet].sort(),
      graphReasons: [...graphReasons],
      graphReason,
      graphRounds,
      clueReadFailures,
      clueFailureReason,
      consumed:
        `种子 ${seeds.length} 个 ⇒ 词法腿 ${calls.length} 次（LIMIT ${limits.lexicalLimit}）` +
        ` + 图腿 ${graphRounds} 次 ⇒ 已知键 ${known.size} 个（每轮截断 ${limits.topK} 条）`,
    }),
  })
  return port
}
