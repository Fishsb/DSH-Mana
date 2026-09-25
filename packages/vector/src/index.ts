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
      if (envelope) {
        const payload: ManaRecall = {
          sessionId: envelope.sessionId,
          turnId: envelope.turnId,
          requestId: envelope.requestId,
          at: envelope.at ?? new Date().toISOString(),
          query: outcome.query,
          hitCount: outcome.hitCount,
          channel: outcome.channel,
          rankBy: outcome.rankBy,
          degraded: outcome.degraded,
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
