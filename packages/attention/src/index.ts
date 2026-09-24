/**
 * `dsh-mana-attention` —— 作意：注意力门控 + JEV 筛选 + 注入审计骨架（P0）。
 *
 * 阶段 0 只立骨架，但**带一条真实的 injected 路径**。
 *
 * ⚠ **为什么骨架必须真写一行**（这是 R0 反证判据能成立的前提）：
 *   R0 的判据是「卸载后同一触发**不再产生新行**」。若骨架什么都不写，
 *   卸载前后都"没有新行" ⇒ 反证判据**平凡通过**，与「插件根本没生效」不可分辨
 *   —— 这正是 G11「装配清单 ≠ 生效，空壳与真插件同形」。
 *   故本骨架在收到 `mana/observation` 时**真写一行** `mana_trace`，
 *   使「卸载即净」成为可观测事实而非口号。
 *
 * 阶段 1 的 B2.1 在此接上 `mana/jev/judge`（**必须用 `ctx.waterfall` 分发**，用
 * `ctx.emit` 会同步抛 `TypeError: next is not a function`，G6）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import {
  registerPassThroughPreStep,
  type ManaCoreService,
  type ManaObservation,
} from 'dsh-mana-core'

export const name = 'mana-attention'

/** 依赖 core（方案 §9.1：`core, jev`；jev 在阶段 1 接入判定链时再加）。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 聚焦项上限。方案 §9.4 原值 4。 */
  maxFocusItems: number
  /** JEV 放行阈值。方案 §9.4 原值 0.7。 */
  jevThreshold: number
}

export const Config: Schema<Config> = Schema.object({
  maxFocusItems: Schema.number().default(4),
  jevThreshold: Schema.number().default(0.7),
})

export interface ManaAttentionService {
  readonly plugin: string
  /**
   * 处理一条观察：写 `mana_trace`（event_type='observation'）并广播 `mana/attention`。
   * 返回写入的 `seq`。
   */
  ingest(obs: ManaObservation): number
  status(): { plugin: string; wired: boolean }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-attention': ManaAttentionService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-attention: 缺少 mana-core 服务（inject 未满足）')

  const ingest = (obs: ManaObservation): number => {
    // 真写一行：这是「卸载即净」可被机检的唯一依据（见文件头）。
    const seq = core.writeTrace({
      eventType: 'observation',
      sessionId: obs.sessionId,
      turnId: obs.turnId,
      payload: obs,
      at: obs.at,
    })
    ctx.emit('mana/attention', {
      sessionId: obs.sessionId,
      turnId: obs.turnId,
      requestId: obs.requestId,
      at: obs.at,
      content: obs.content,
      jevProbability: null,
      degraded: false,
    })
    return seq
  }

  const service: ManaAttentionService = {
    plugin: name,
    ingest,
    status: () => ({ plugin: name, wired: true }),
  }

  ctx.on('mana/observation', (obs: ManaObservation) => {
    // 聚焦项上限在阶段 1 生效；阶段 0 只保证通路存在。
    if (config.maxFocusItems <= 0) return
    ingest(obs)
  })

  ctx.effect(() => {
    const dispose = ctx.provide('mana-attention', service)
    return () => dispose()
  }, 'dsh-mana-attention: service')

  registerPassThroughPreStep(ctx, name)
}
