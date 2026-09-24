/**
 * `dsh-mana-perception` —— 前五识：输入采集 / 分块 / 实体抽取骨架（P0）。
 *
 * 阶段 0 只立骨架。阶段 1 的 B2.1 打通 `perception → attention → working-memory →
 * scheduler → action` 端到端事件流时，由本插件发出 `mana/observation`。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'

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

export interface ManaPerceptionService {
  readonly plugin: string
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

  const service: ManaPerceptionService = {
    plugin: name,
    status: () => ({ plugin: name, wired: true }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-perception', service)
    return () => dispose()
  }, 'dsh-mana-perception: service')

  registerPassThroughPreStep(ctx, name)

  void config
}

export type { ManaCoreService }
