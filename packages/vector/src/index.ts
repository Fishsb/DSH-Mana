/**
 * `dsh-mana-vector` —— 向量适配骨架（P0）。
 *
 * 阶段 0 只立骨架。阶段 1 的 B1.1 走**纯 JS 余弦**（物化 BLOB + 常驻 `Float32Array`），
 * RRF 自实现（k=60）；sqlite-vec 作规模化升级项（§8 C4）——
 * ⚠ 一旦启用 vec0，必须同时承接 W-1（显式 `distance_metric=cosine`，默认是 L2）、
 *   W-2（`rowid` 必须 BigInt）、W-3（KNN 必须带 LIMIT）三条语义。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'

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
  /** 检索路线：'js' = 纯 JS 余弦（当前）/ 'vec0' = sqlite-vec（>10 万条再启用）。 */
  route: 'js' | 'vec0'
}

export const Config: Schema<Config> = Schema.object({
  model: Schema.string().default('bge-m3'),
  dim: Schema.number().default(1024),
  rrfK: Schema.number().default(60),
  // ⚠ 用 union 而非 string()：string() 会把 'js' | 'vec0' 放宽为 string，
  //   导致 typecheck 报「Type 'string' is not assignable to '"js" | "vec0"'」——
  //   这是**正确报错**（配置面失去约束），不要改 Config 类型来迁就它。
  route: Schema.union(['js', 'vec0'] as const).default('js'),
})

export interface ManaVectorService {
  readonly plugin: string
  status(): { plugin: string; wired: boolean; dim: number; route: string }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-vector': ManaVectorService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-vector: 缺少 mana-core 服务（inject 未满足）')

  const service: ManaVectorService = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, dim: config.dim, route: config.route }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-vector', service)
    return () => dispose()
  }, 'dsh-mana-vector: service')

  registerPassThroughPreStep(ctx, name)
}

export type { ManaCoreService }
