/**
 * `dsh-mana-jev` —— JEV 适配层骨架（P0）。
 *
 * 阶段 0 只立骨架：**`name` + `inject` + `apply` + 一条直通 waterfall**。
 * 真正的判定链（Ollama logprob 单 token 原语 / TTL 300s 缓存 / 熔断 5 次 / 三级降级）
 * 在阶段 1 的 B1.2 落地。
 *
 * ⚠ 骨架的 `status()` 是**机制自证**（"插件装载了、服务挂上了"），
 *   **不等于运行态**。按本仓纪律，放行一律看产物侧证据（`mana_trace` / `jev_log` 行）
 *   + 反证（卸载后不再产生新行）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'

export const name = 'mana-jev'

/** 依赖 core（方案 §9.1）。缺 core 时本插件停在 waiting，不半启动。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 判定结果缓存 TTL（秒）。方案 §6.4 原值 300。 */
  cacheTtlSeconds: number
  /** 熔断阈值：连续失败次数。 */
  circuitBreakerFailures: number
  /** 熔断冷却（秒）。 */
  circuitBreakerCooldownSeconds: number
  /** 全局并发上限（实测 50 并发单次 5785ms ⇒ 并发是硬约束，G14）。 */
  maxConcurrency: number
}

export const Config: Schema<Config> = Schema.object({
  cacheTtlSeconds: Schema.number().default(300),
  circuitBreakerFailures: Schema.number().default(5),
  circuitBreakerCooldownSeconds: Schema.number().default(60),
  maxConcurrency: Schema.number().default(4),
})

/** JEV 服务面（阶段 1 会在这里长出 judge / 缓存 / 熔断）。 */
export interface ManaJevService {
  readonly plugin: string
  /** 机制自证读数（**不是**运行态判据）。 */
  status(): { plugin: string; wired: boolean; coreStorePath: string }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-jev': ManaJevService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-jev: 缺少 mana-core 服务（inject 未满足，不应半启动）')

  const service: ManaJevService = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, coreStorePath: core.storePath }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-jev', service)
    return () => dispose()
  }, 'dsh-mana-jev: service')

  // 阶段 1 的判定链将挂在此扩展点之后；现在只做直通（必须调 next()，G9）。
  registerPassThroughPreStep(ctx, name)

  void config
}

export type { ManaCoreService }
