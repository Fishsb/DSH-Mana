/**
 * `dsh-mana-working-memory` —— 第六识：工作记忆 / 容量管理 / 上下文组装（P0）。
 *
 * 阶段 1 B2.1：本插件是事件链**中段** —— 消费 `mana/attention`（作意放行的聚焦项），
 * 按容量上限（方案 §5.3 原值 4 组块）维护工作记忆，并广播 `mana/working-memory` 供下游
 * （调度/注入门控）消费。写 `mana_trace` 使「卸载即净」可机检。
 *
 * ⚠ **容量上限必须是真闸**（本仓教训：声明了却不产生可观测差异 = 死开关）：
 *   超出 `capacityChunks` 时**淘汰最旧**并**显式记账**（`evicted` 计数），
 *   不静默丢弃。否则「容量管住了」与「根本没管」表面同形。
 *
 * ⚠ 上下文尾部**有两个写者**（working-memory 与 JEV Injection Gate）是方案 §8 C14
 *   已裁定的「派生量唯一写者」缺陷之一。本插件只管**工作记忆集**，**不写上下文**
 *   —— 注入面归 Injection Gate（W3-2），避免两套写法同时上线。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import {
  MANA_STAGES,
  registerPassThroughPreStep,
  type ManaAttention,
  type ManaCoreService,
  type ManaStage,
} from 'dsh-mana-core'

/**
 * 取第 i 个 stage 的**裸名标签**（同 attention 的安全阀：noUncheckedIndexedAccess 下
 * 索引访问是 `ManaStage | undefined`，集中断言一次胜过每个调用点写一次 `!`）。
 */
function stageLabel(i: number): ManaStage {
  const s = MANA_STAGES[i]
  if (s === undefined) throw new Error(`mana-working-memory: MANA_STAGES 缺第 ${i} 项`)
  return s
}

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

/** 工作记忆中的一个组块。 */
export interface WorkingChunk {
  requestId: string
  content: string
  /** 进入工作记忆的序号（单调递增，用于判「谁最旧」）。 */
  seq: number
  at: string
}

/** 工作记忆快照（判据用：容量、淘汰计数、当前内容都**可读**）。 */
export interface WorkingMemorySnapshot {
  chunks: WorkingChunk[]
  capacityChunks: number
  /** 累计淘汰数（**显式记账**：0 与「没淘汰过」可分辨）。 */
  evicted: number
  budgetChars: number
  /** 当前内容总字符数（供 budget 判据）。 */
  chars: number
}

export interface ManaWorkingMemoryService {
  readonly plugin: string
  /** 收一条聚焦项进工作记忆（超容即淘汰最旧并计入 `evicted`）。返回本次是否发生淘汰。 */
  push(att: ManaAttention): boolean
  /** 当前快照（深拷贝，调用方改不到内部状态）。 */
  snapshot(): WorkingMemorySnapshot
  status(): { plugin: string; wired: boolean; capacityChunks: number; size: number; evicted: number }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-working-memory': ManaWorkingMemoryService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-working-memory: 缺少 mana-core 服务（inject 未满足）')

  const chunks: WorkingChunk[] = []
  let evicted = 0
  let counter = 0

  const push = (att: ManaAttention): boolean => {
    counter += 1
    chunks.push({ requestId: att.requestId, content: att.content, seq: counter, at: att.at })
    // 真闸：超出容量才淘汰，且**记账**（不得静默 shift）。
    let didEvict = false
    while (config.capacityChunks > 0 && chunks.length > config.capacityChunks) {
      chunks.shift()
      evicted += 1
      didEvict = true
    }
    return didEvict
  }

  const service: ManaWorkingMemoryService = {
    plugin: name,
    push,
    snapshot: () => ({
      chunks: chunks.map((c) => ({ ...c })),
      capacityChunks: config.capacityChunks,
      evicted,
      budgetChars: config.budgetChars,
      chars: chunks.reduce((n, c) => n + [...c.content].length, 0),
    }),
    status: () => ({
      plugin: name,
      wired: true,
      capacityChunks: config.capacityChunks,
      size: chunks.length,
      evicted,
    }),
  }

  /**
   * 真行为：收到作意事件 → 进工作记忆 + 写一行 `mana_trace`。
   *
   * 走事件总线（非直接调 service）是反证判据成立的前提：卸载后同一触发不再产生新行。
   */
  ctx.on('mana/attention', (att: ManaAttention) => {
    const didEvict = push(att)
    core.writeTrace({
      // ⚠ 标签归并（F-01 口径 A）：旧值 'mana/working-memory' **不在** MANA_STAGES 里，
      //   而 A1-1 的判据原文要求 mana_trace.event_type 落在裸名五类内。处置 = 归并入
      //   'attention' 段（本行记的正是「attention 放行的聚焦项进了工作记忆」，语义同类），
      //   包内身份由 payload 字段承载 —— 不另开第六个标签（那会让五类各≥1 永远可被绕开）。
      eventType: stageLabel(1),
      sessionId: att.sessionId,
      turnId: att.turnId,
      payload: {
        requestId: att.requestId,
        size: chunks.length,
        capacityChunks: config.capacityChunks,
        evicted,
        didEvict,
      },
      at: att.at,
    })
  })

  ctx.effect(() => {
    const dispose = ctx.provide('mana-working-memory', service)
    return () => dispose()
  }, 'dsh-mana-working-memory: service')

  registerPassThroughPreStep(ctx, name)
}

export type { ManaCoreService }
