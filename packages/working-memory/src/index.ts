/**
 * `dsh-mana-working-memory` —— 第六识：工作记忆 / 容量管理 / 上下文组装骨架（P0）。
 *
 * 阶段 0 只立骨架（含容量上限 4 组块，方案 §5.3）。
 *
 * ⚠ 上下文尾部**有两个写者**（working-memory 与 JEV Injection Gate）是方案 §8 C14
 *   已裁定的「派生量唯一写者」缺陷之一 ⇒ 阶段 1 必须定其一为权威，另一处只读。
 *   本骨架**不写上下文**，把该裁定留给阶段 1（避免两套写法同时上线）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'

export const name = 'mana-working-memory'

export const inject: string[] = ['mana-core']

export interface Config {
  /** 工作记忆容量（组块数）。方案 §5.3 原值 4。 */
  capacityChunks: number
  /** 注入块字符上限。 */
  budgetChars: number
}

export const Config: Schema<Config> = Schema.object({
  capacityChunks: Schema.number().default(4),
  budgetChars: Schema.number().default(4000),
})

export interface ManaWorkingMemoryService {
  readonly plugin: string
  status(): { plugin: string; wired: boolean; capacityChunks: number }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-working-memory': ManaWorkingMemoryService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-working-memory: 缺少 mana-core 服务（inject 未满足）')

  const service: ManaWorkingMemoryService = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, capacityChunks: config.capacityChunks }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-working-memory', service)
    return () => dispose()
  }, 'dsh-mana-working-memory: service')

  registerPassThroughPreStep(ctx, name)
}

export type { ManaCoreService }
