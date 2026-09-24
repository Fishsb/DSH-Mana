/**
 * `dsh-mana-perception` —— 前五识：输入采集 / 分块 / 实体抽取（P0）。
 *
 * 阶段 1 B2.1：本插件是端到端事件链的**源头** —— 发出 `mana/observation`，
 * 由 `attention` 接手（写 `mana_trace` 并广播 `mana/attention`），再由 `scheduler` 消费。
 *
 * ⚠ **分块是"真行为"而不是装饰**：`maxChunkChars` 超限才切分，切分后**逐块**各发一条
 *   `mana/observation`（不是把原文塞进一条里）——否则「分块」这个配置项就是死开关
 *   （声明了却不产生可观测差异，本仓已有该类教训）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import {
  registerPassThroughPreStep,
  type ManaCoreService,
  type ManaObservation,
} from 'dsh-mana-core'

export const name = 'mana-perception'

export const inject: string[] = ['mana-core']

export interface Config {
  /** 单块最大字符数（超出即切分）。 */
  maxChunkChars: number
  /** 相邻块重叠字符数，避免语义在切点被截断。 */
  chunkOverlapChars: number
}

export const Config: Schema<Config> = Schema.object({
  maxChunkChars: Schema.number().default(1200),
  chunkOverlapChars: Schema.number().default(120),
})

/** 分块结果（**显式**给出块数，使「切了没切」可断言而不是靠猜）。 */
export interface ChunkResult {
  chunks: string[]
  /** 是否真的发生了切分（`false` = 原文一块，可直接断言）。 */
  split: boolean
}

/**
 * 按 `maxChunkChars` / `chunkOverlapChars` 分块（纯函数，可单独判据）。
 *
 * 边界：`maxChunkChars <= 0` 或文本不超限 ⇒ 单块且 `split=false`；
 * `chunkOverlapChars` 被夹到 `[0, maxChunkChars-1]`，否则会**死循环**（重叠 ≥ 步长时索引不前进）。
 */
export function chunkText(text: string, maxChunkChars: number, chunkOverlapChars: number): ChunkResult {
  const src = String(text ?? '')
  if (maxChunkChars <= 0 || src.length <= maxChunkChars) return { chunks: [src], split: false }
  // ⚠ 步长必须 > 0：`overlap >= maxChunkChars` 会让 index 不前进 ⇒ 无限循环（静默挂死）。
  const overlap = Math.min(Math.max(chunkOverlapChars, 0), maxChunkChars - 1)
  const step = maxChunkChars - overlap
  const chunks: string[] = []
  for (let i = 0; i < src.length; i += step) {
    chunks.push(src.slice(i, i + maxChunkChars))
    if (i + maxChunkChars >= src.length) break
  }
  return { chunks, split: chunks.length > 1 }
}

export interface ManaPerceptionService {
  readonly plugin: string
  /**
   * 采集一条输入：分块后**逐块**发出 `mana/observation`，返回发出的块数。
   *
   * 事件用 `ctx.emit`（`mana/observation` 是 emit 型通知，见 `event-types.ts`）。
   */
  perceive(input: { content: string; sessionId: string; turnId: number; requestId: string; source?: string; at?: string }): number
  status(): { plugin: string; wired: boolean }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-perception': ManaPerceptionService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-perception: 缺少 mana-core 服务（inject 未满足）')

  const perceive: ManaPerceptionService['perceive'] = (input) => {
    const { chunks } = chunkText(input.content, config.maxChunkChars, config.chunkOverlapChars)
    const at = input.at ?? new Date().toISOString()
    for (const [i, chunk] of chunks.entries()) {
      const obs: ManaObservation = {
        sessionId: input.sessionId,
        turnId: input.turnId,
        // 多块时 requestId 派生后缀，使各块在审计上**可分辨**（不得让多块共用同一 requestId）。
        requestId: chunks.length > 1 ? `${input.requestId}#${i + 1}` : input.requestId,
        at,
        content: chunk,
        source: input.source ?? 'unknown',
      }
      ctx.emit('mana/observation', obs)
    }
    return chunks.length
  }

  const service: ManaPerceptionService = {
    plugin: name,
    perceive,
    status: () => ({ plugin: name, wired: true }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-perception', service)
    return () => dispose()
  }, 'dsh-mana-perception: service')

  registerPassThroughPreStep(ctx, name)

  void core
}

export type { ManaCoreService }
