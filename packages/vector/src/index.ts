/**
 * `dsh-mana-vector` —— 向量适配（P0 骨架 + B1.1 实现）。
 *
 * 阶段 0 的骨架（`name`/`inject`/`Config`/`status()`/G9 直通链）**逐字保留**；
 * B1.1 在其上接真实现：纯 JS 余弦（`cosine.ts`）+ 自实现 RRF（`rrf.ts`，k=60）
 * + BLOB⇄常驻 `Float32Array`（`vec-blob.ts`）+ 嵌入适配（`embed.ts`）+ 召回（`recall.ts`）。
 *
 * ⚠ 三条**契约级**取舍（改之前先读 `docs/contract/degradation.md`）：
 * 1. 降级必须落显式字段（`degraded:true` + 非空 `reason`），**禁 `catch { return null }`**；
 * 2. `route='vec0'` 本轮**未启用**，走 `vec0.ts` 的显式降级（**不静默回落 js**）；
 *    启用前提 = 同时承接 W-1/W-2/W-3 三条语义，见 `vec0.ts`；
 * 3. 写入落点 = `memory_items.vector`（`packages/core/src/schema.ts:58` 的 BLOB 列）；
 *    本包**只写值不改表**（表结构属 `packages/core/**`，S0 写面）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import {
  MANA_STAGES,
  registerPassThroughPreStep,
  type ManaCoreService,
  type ManaRecall,
  type ManaStage,
} from 'dsh-mana-core'

/**
 * 取第 i 个 stage 的**裸名标签**（`mana_trace.event_type` 的真源 = core 的 MANA_STAGES）。
 *
 * ⚠ 同 attention/working-memory：`MANA_STAGES` 是 `readonly ManaStage[]`（非元组），
 *   在 noUncheckedIndexedAccess 下索引访问是 `ManaStage | undefined` ⇒ 集中断言一次。
 */
function stageLabel(i: number): ManaStage {
  const s = MANA_STAGES[i]
  if (s === undefined) throw new Error(`mana-vector: MANA_STAGES 缺第 ${i} 项`)
  return s
}

import { VectorStore } from './vec-blob.ts'
import { embedTexts, type EmbedConfig } from './embed.ts'
import { recallVector, type RecallCandidate } from './recall.ts'
import type { EmbedOutcome, RecallOutcome } from './adapt.ts'
import { vec0UnavailableReason, VEC0_SEMANTICS } from './vec0.ts'
import { RRF_DEFAULT_K } from './rrf.ts'
import {
  DEFAULT_RECALL_GATE_WIRING,
  recallGateReadout,
  runRecallGate,
  type RecallGateKnobs,
  type RecallGateReadout,
} from './recall-gate-hook.ts'
import {
  recallGraphReadout,
  runGraphLeg,
  type RecallGraphKnobs,
  type RecallGraphReadout,
} from './graph.ts'

export const name = 'mana-vector'

/** 依赖 core（方案 §9.1）。长时记忆（P1）另需本插件。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 嵌入模型 id。本机实测 bge-m3 输出 2 条 × 1024 维。 */
  model: string
  /** 向量维度。**dim ≠ 1024 即判失败**（A1-12 / A2-3）。 */
  dim: number
  /** RRF 融合常数 k。 */
  rrfK: number
  /** 检索路线：'js' = 纯 JS 余弦（当前）/ 'vec0' = sqlite-vec（>10 万条再启用，**本轮未启用**）。 */
  route: 'js' | 'vec0'
  /** 嵌入端点（OpenAI 兼容基址；缺省本机 Ollama）。 */
  embedBaseUrl: string
  /** 是否启用嵌入；`false` ⇒ 显式降级（不是静默词法）。 */
  embedEnabled: boolean
  /** 嵌入超时毫秒；0 = 按端点自动（本机 30s / 云端 8s）。 */
  embedTimeoutMs: number
  /**
   * **Recall Gate 接线**（W1-4）。
   *
   * 接的是 `dsh-mana-long-term` 的 `recallGate`（**按包名运行时解析**，故本包 `inject` 不变、
   * 不新增依赖边；取舍与代价逐条写在 `recall-gate-hook.ts` 文件头）。
   * ⚠ 门控**不改变** `recall()` 的契约字段（`channel`/`rankBy`/`degraded` 仍由向量管道决定，
   * 见本文件 recall 段的说明），它把**判定读数**（probed/judged/judgeIds…）作为增量字段带出来。
   */
  recallGate: RecallGateKnobs
  /**
   * **图检索腿**（W2-C3）：共现关联边 + 邻接扩展 —— v10 §14.3 的第三条腿（向量 + FTS5 + **图**）。
   *
   * ⚠ 与 `recallGate` 同处置：旋钮**不改变** `recall()` 的契约字段
   *   （`channel`/`rankBy`/`degraded`/`hitCount` 仍由向量管道决定），
   *   它把**图腿的判定读数**（ran/exact/edgesSeen/additions/keys…）作为增量字段带出来。
   *   取舍与代价逐条写在 `graph.ts` 文件头（含"为什么不折进 items"）。
   */
  recallGraph: RecallGraphKnobs
}

export const Config: Schema<Config> = Schema.object({
  model: Schema.string().default('bge-m3'),
  dim: Schema.number().default(1024),
  rrfK: Schema.number().default(60),
  // ⚠ 用 union 而非 string()：string() 会把 'js' | 'vec0' 放宽为 string，
  //   导致 typecheck 报「Type 'string' is not assignable to '"js" | "vec0"'」——
  //   这是**正确报错**（配置面失去约束），不要改 Config 类型来迁就它。
  route: Schema.union(['js', 'vec0'] as const).default('js'),
  embedBaseUrl: Schema.string().default('http://127.0.0.1:11434/v1'),
  embedEnabled: Schema.boolean().default(true),
  embedTimeoutMs: Schema.number().default(0),
  // ⚠ **嵌套 Schema.object 而不是拍平**（本仓「一个旋钮一处声明」的形态）：
  //   拍平会新增 4 个顶层键 ⇒ 与既有配置面（model/dim/rrfK/route…）混在一起，
  //   且"这几个键是一组"这件事在类型上消失。
  // ⚠ 缺省值取自 `DEFAULT_RECALL_GATE_WIRING`（**唯一真源**）的**显式字面量**：
  //   schemastery 的 default 参与结构推导，直接塞冻结对象会让类型面与运行面各存一份值。
  recallGate: Schema.object({
    enabled: Schema.boolean().default(true),
    threshold: Schema.number().default(0.7),
    topN: Schema.number().default(10),
    judgeEnabled: Schema.boolean().default(true),
  }).default({ enabled: true, threshold: 0.7, topN: 10, judgeEnabled: true }),
  // ⚠ 与 recallGate 同形：**嵌套 Schema.object 而不是拍平**（本仓「一个旋钮一处声明」的形态），
  //   且缺省值取自 `DEFAULT_RECALL_GRAPH_KNOBS`（**唯一真源**）的**显式字面量**。
  // ⚠ `hops` **不在配置面**：生产恒按 `GRAPH_HOPS_MAX` 之内的一跳走（`graph.ts` 的缺省），
  //   "关掉扩展/放开两跳"这类**改行为**的开关只在判据的 `overrides` 里（显式传参才生效），
  //   配置面不暴露 ⇒ 不存在"看起来开了、实际没扩"的旋钮（本仓禁的形态）。
  recallGraph: Schema.object({
    enabled: Schema.boolean().default(true),
    hops: Schema.number().default(1),
    scope: Schema.union(['seeds', 'global'] as const).default('seeds'),
  }).default({ enabled: true, hops: 1, scope: 'seeds' }),
})

export interface ManaVectorService {
  readonly plugin: string
  status(): {
    plugin: string
    wired: boolean
    dim: number
    route: string
    /** `route='vec0'` 时的**显式**未启用原因；`'js'` 时为 `null`。 */
    routeDisabledReason: string | null
    /** 常驻向量条数（证「常驻」不是形容词）。 */
    resident: number
  }
  /** 取嵌入（显式降级信封，见 `adapt.ts`）。 */
  embed(texts: readonly string[]): Promise<EmbedOutcome>
  /** 召回：词法打底 → 常驻 → 余弦 → RRF（降级落显式字段）。 */
  recall(
    query: string,
    candidates: readonly RecallCandidate[],
    topK?: number,
    envelope?: RecallEnvelope,
  ): Promise<RecallOutcome>
  /** 常驻向量表（BLOB ⇄ Float32Array）。 */
  readonly store: VectorStore
  /** 把一条向量写进 `memory_items.vector`（**唯一**写库点；走 core 的 `withTransaction`）。 */
  putMemoryVector(
    memoryId: string,
    vec: Float32Array,
    meta?: { type?: string; content?: string },
  ): Promise<{ written: boolean; reason: string | null }>
  /** 读一条向量（命中即常驻）。 */
  getMemoryVector(memoryId: string): { ok: true; dim: number } | { ok: false; reason: string }
  /** vec0 三条语义的机检锚点（启用 vec0 的席必须逐条造负例）。 */
  vec0Semantics(): typeof VEC0_SEMANTICS
  /**
   * **最近一次检索的门控读数**（W1-4 接线面的即时可观测出口）。
   *
   * ⚠ 返回的是 `RecallGateReadout` —— **与 `mana/recall` 载荷里挂的读数是同一个形状**
   *   （同一转换函数 `recallGateReadout`）⇒ 服务面查到的与审计里看到的不可能漂开。
   * ⚠ 进程内、**只保留最近一次**：它是"接线真跑了"的即取面（**无信封**调用也能查）。
   *   跨进程/历史审计看 `mana_trace` 的 recall 载荷（带信封时）。
   * `null` ⇔ 本进程还没走过 `recall()`（**不得读成"门控没接"** —— 那是 `unwiredReason` 的事）。
   */
  lastRecallGate(): RecallGateReadout | null
  /**
   * **最近一次检索的图腿读数**（W2-C3 的即时可观测出口）。
   *
   * ⚠ 与 `lastRecallGate()` 同处置：返回的 `RecallGraphReadout` **与 `mana/recall` 载荷里
   *   挂的读数是同一个形状**（同一转换函数 `recallGraphReadout`）⇒ 服务面查到的与审计里
   *   看到的不可能漂开。进程内、**只保留最近一次**。
   * `null` ⇔ 本进程还没走过 `recall()`（**不得读成"图腿没接"** —— 那是
   *   `ran=false` + `unwiredReason` 的事；两者必须分开）。
   */
  lastRecallGraph(): RecallGraphReadout | null
}

/** `recall()` 的会话信封：给了就 emit `mana/recall`（A1-11 的字段断言读它）。 */
export interface RecallEnvelope {
  sessionId: string
  turnId: number
  requestId: string
  at?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-vector': ManaVectorService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-vector: 缺少 mana-core 服务（inject 未满足）')

  const embedCfg: EmbedConfig = {
    enabled: config.embedEnabled,
    baseUrl: config.embedBaseUrl,
    model: config.model,
    dim: config.dim,
    ...(config.embedTimeoutMs > 0 ? { timeoutMs: config.embedTimeoutMs } : {}),
  }

  // 常驻表 + 落库回调（**经 core**，本包不自己开库：开库器是 core 的独占写点）。
  const store = new VectorStore({
    dim: config.dim,
    persistPut: (key, blob) => {
      core.db
        .prepare(
          `INSERT INTO memory_items (id, type, content, created_at, vector) VALUES (?, 'vector', '', ?, ?)
           ON CONFLICT(id) DO UPDATE SET vector = excluded.vector`,
        )
        .run(key, new Date().toISOString(), blob)
      return 1
    },
    persistGet: (key) => {
      const row = core.db.prepare('SELECT vector FROM memory_items WHERE id = ?').get(key) as
        | { vector?: Uint8Array | null }
        | undefined
      return row?.vector ?? null
    },
  })

  /**
   * **最近一次检索的门控读数**（不带信封的调用也能查；见服务面的 `lastRecallGate()`）。
   * ⚠ 只保留最近一次、进程内：它不是历史账（历史账在 `mana_trace` 的 recall 载荷里）。
   */
  let lastGate: RecallGateReadout | null = null
  /** **最近一次检索的图腿读数**（与 `lastGate` 同处置：只留最近一次、进程内）。 */
  let lastGraph: RecallGraphReadout | null = null

  const service: ManaVectorService = {
    plugin: name,
    status: () => ({
      plugin: name,
      wired: true,
      dim: config.dim,
      route: config.route,
      routeDisabledReason: vec0UnavailableReason(config.route),
      resident: store.size,
    }),
    embed: (texts) => embedTexts(embedCfg, texts),
    recall: async (query, candidates, topK = 10, envelope) => {
      const outcome = await recallVector({ ...embedCfg, rrfK: config.rrfK }, store, query, candidates, topK)

      /**
       * ── **Recall Gate 接线**（W1-4）：检索路径的出口调用 `recallGate` ────────────────
       * 本包是 `recallGate` 的**生产调用方**（接线前全仓 `packages/<pkg>/src` 里调用方 = 0，
       * 四态记 NONE）。门控按包名运行时解析 long-term（本包 `inject` 不变、**不新增注册点**），
       * 解析/调用的取舍与代价见 `recall-gate-hook.ts` 文件头。
       *
       * **送进去的候选 = `outcome.items`**（向量管道融合后的有序命中），
       * `localScore` 用融合分 `score`：门控只吃 `{key, localScore}`，**它自己不做检索** ——
       * 两份候选面（管道的 / 门控的）由**同一处**产生，不存在"这边检索、那边另编一份"。
       * ⚠ 降级时 `items` 是**有序的本地分结果**（`recall.ts` 的有意行为，不是空）⇒ 降级
       *   也照样送判（这正是 A1-8「Recall → 返回有序 items」要的那条支路）。
       * ⚠ **无信封时也要跑**：A1-8 的取值面是**返回对象**（`记录`），若只在有信封时跑，
       *   「门控到底调用没有」就会退化成"取决于调用方有没有给信封"（不可判）。
       *
       * ── 两处**有意不改变既有行为**的取舍（各自写出理由，便于对拍）───────────────
       * ① `outcome`（`RecallOutcome`）**逐字不动**：门控读数走 `lastRecallGate()` 与
       *    `mana/recall` 载荷的**契约外增量字段**，不进 `RecallOutcome`（那是 adapt.ts 的契约面）。
       * ② 门控**不折叠进 `items` 排序**（不改 `channel`/`rankBy`/`degraded`/`hitCount`）：
       *    `rankBy` 的取值是 A1-11 的机检锚点（`b11-vector.test.mjs` 逐字断言），
       *    在**未由册面拍板**"召回结果按 jev_prob 排序"之前改它 = 让那条既有判据变成假红/假绿；
       *    且 `rankBy='jev_prob'` 的含义是"**本结果按它排序**" —— 只带读数不改排序却改这个字段，
       *    就是把读数伪装成排序依据（本仓最防的形态）。⇒ 读数里显式带 `applied:false`（**可断言**，
       *    不是一句注释），"按概率重排"列 `[建议决策]`。
       */
      const gateRecord = await runRecallGate(
        ctx,
        {
          requestId: envelope?.requestId ?? `recall:${query}`,
          query,
          candidates: outcome.items.map((it) => ({ key: it.key, localScore: it.score })),
          topK,
          ...(envelope ? { sessionId: envelope.sessionId, turnId: envelope.turnId } : {}),
        },
        {
          // 配置面四个旋钮原样透传（**不在这里重新解释它们**），包名取自 hook 的唯一真源
          // ⚠ 包名**不经配置**：可配就等于多一个"能把接线指歪"的旋钮，而解析失败只在运行期可见。
          ...config.recallGate,
          specifier: DEFAULT_RECALL_GATE_WIRING.specifier,
        },
      )
      // ⚠ **同一个**读数对象既进服务面又进载荷（`lastGate` 与下面的 payload 用同一份）
      //   ⇒ 两处不可能出现"审计说 A、服务面说 B"。
      const gateReadout = recallGateReadout(gateRecord)
      lastGate = gateReadout

      /**
       * ── **图检索腿接线**（W2-C3）：v10 §14.3 的第三条腿 ────────────────────────────
       * 读 `memory_items.related_ids`（**既有列，不新建表**）⇒ 构邻接 ⇒ 从种子扩一跳。
       * 取舍、退化路径与优先级口径逐条写在 `graph.ts` 文件头；此处只写**接线决策**：
       *
       * ① 种子 = `outcome.items` 的键（与门控**同一份**候选面）⇒ 不存在"这边检索、那边另编一份"；
       * ② **无信封时也跑**：读数面是返回值（`记录`），若只在有信封时跑，
       *    「图腿到底跑了没有」就会退化成"取决于调用方给没给信封"（不可判）；
       * ③ `keylessKeys` = **在候选里但没有任何分**的键（`rank` 为空）—— 撞键无值（sense=1）的落点。
       *    ⚠ 判据是"没分"而不是"名次靠后"：带 dense/lexical 名的键是被 RRF **真融合过**的，
       *      把它算成图扩展就是伪造成果（"带出来的"与"本来就在候选里"同形）。
       * ④ `outcome`（`RecallOutcome`）**逐字不动**：图腿读数走 `lastRecallGraph()` 与
       *    `mana/recall` 载荷的**契约外增量字段**，不进 `RecallOutcome`（那是 adapt.ts 的契约面）。
       *    `rankBy`/`degraded` 是 A1-11 的机检锚点，**本腿一个字节都不改**（改它 = 让既有判据
       *    变成假红/假绿）；`hitCount` 也不代记 —— 图腿的产出只走读数面，`applied:false` 可断言。
       */
      const scored = new Set<string>()
      for (const it of outcome.items) if (Object.keys(it.rank).length > 0) scored.add(it.key)
      const keylessKeys = candidates.filter((c) => !scored.has(c.key)).map((c) => c.key)
      const graphResult = runGraphLeg(core.db, {
        seeds: outcome.items.map((it) => it.key),
        keylessKeys,
        cfg: config.recallGraph,
      })
      const graphReadout = recallGraphReadout(graphResult, config.recallGraph.enabled)
      lastGraph = graphReadout

      if (envelope) {
        // ⚠ **契约外增量字段**（`ManaRecall` 本身在 `packages/core/src/`，本席只读面 ⇒ 不加字段）：
        //   门控读数挂在同一载荷上，使「这次召回门控跑到哪一步」与召回**同一条审计记录**，
        //   不需要二次查询、也不会与召回行漂开（"事件发了 vs 审计可查"成对发生，同 F-01 口径）。
        const payload: ManaRecall & { readonly recallGate: RecallGateReadout; readonly recallGraph: RecallGraphReadout } = {
          sessionId: envelope.sessionId,
          turnId: envelope.turnId,
          requestId: envelope.requestId,
          at: envelope.at ?? new Date().toISOString(),
          query: outcome.query,
          hitCount: outcome.hitCount,
          channel: outcome.channel,
          rankBy: outcome.rankBy,
          degraded: outcome.degraded,
          recallGate: gateReadout,
          // ⚠ 图腿读数与门控读数**同一条审计记录**（不二次查询、不与之漂开），
          //   同样是**契约外增量字段**：`ManaRecall` 的既有字段一个都没动。
          recallGraph: graphReadout,
        }
        // ⚠ A1-1 的 recall 段落点（F-01）：此前本包**只广播、不落库** ⇒
        //   五类里的 'recall' 在 mana_trace 上**永远为空**，判据结构上不可能满足。
        //   落库与广播**同一次调用内**成对发生（不许只做一半：那会让「事件发了」与
        //   「审计可查」两件事漂开）。
        core.writeTrace({
          eventType: stageLabel(3),
          sessionId: payload.sessionId,
          turnId: payload.turnId,
          payload,
          at: payload.at,
        })
        ctx.emit('mana/recall', payload)
      }
      return outcome
    },
    store,
    putMemoryVector: async (memoryId, vec, meta) => {
      if (vec.length !== config.dim) {
        return { written: false, reason: `维度 ${vec.length} ≠ 配置 dim ${config.dim}` }
      }
      try {
        await core.withTransaction(() => {
          store.put(memoryId, vec)
          if (meta?.type !== undefined || meta?.content !== undefined) {
            core.db
              .prepare('UPDATE memory_items SET type = COALESCE(?, type), content = COALESCE(?, content) WHERE id = ?')
              .run(meta.type ?? null, meta.content ?? null, memoryId)
          }
        })
        return { written: true, reason: null }
      } catch (error) {
        // 显式降级：写失败必须能说清是哪一条、为什么（G8）。
        return {
          written: false,
          reason: `写库失败（${memoryId}）：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
    getMemoryVector: (memoryId) => {
      const got = store.get(memoryId)
      return got.ok ? { ok: true, dim: got.item.dim } : { ok: false, reason: got.reason }
    },
    vec0Semantics: () => VEC0_SEMANTICS,
    lastRecallGate: () => lastGate,
    lastRecallGraph: () => lastGraph,
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-vector', service)
    return () => {
      // 卸载即净（插件层）：常驻向量随 fiber 释放；**库里的 BLOB 不动**
      // （数据层回滚须显式处置，见 docs/contract/handoff-protocol.md 的双层表）。
      store.clear()
      dispose()
    }
  }, 'dsh-mana-vector: service')

  registerPassThroughPreStep(ctx, name)
}

export type { ManaCoreService, EmbedOutcome, RecallOutcome, RecallCandidate, EmbedConfig }
export { RRF_DEFAULT_K }
