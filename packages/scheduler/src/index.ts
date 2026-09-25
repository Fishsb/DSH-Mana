/**
 * `dsh-mana-scheduler` —— SOAR 目标栈 + 三阶段循环（批次 B2.2，P1）。
 *
 * 本插件是 P1 第一批的**唯一有真行为**的包（其余三个 P1 包本轮只立骨架）。
 *
 * ⚠ 三条硬约束落点：
 *   ① **G9 / `册:318`**：`apply` 必须注册一条 waterfall 监听器并调 `next()`
 *      —— 走 core 的 `registerPassThroughPreStep`（唯一写点，避免各包自写一份）。
 *      漏调的后果**不报错**：本仓实测 `ctx.waterfall` 上游不调 `next()` ⇒ 下游哨兵
 *      `reached=0`、返回值 `undefined`，全程无异常（静默掐死下游）。
 *   ② **反证判据（R 形态）要有牙**：故本骨架**真写一行** `mana_trace` —— 触发路径走
 *      `mana/attention` 事件总线（不是直接调 service），这样卸载后同一触发「不再产生新行」
 *      才是可机检的事实，而不是"它本来就没生效"（G11 平凡通过）。
 *   ③ **G6**：`mana/jev/judge` 是 waterfall 型事件，必须 `ctx.waterfall(...)` 分发，
 *      用 `ctx.emit` 会炸。本包**不自行分发**该事件（判定链归 attention/jev），只做目标栈。
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
import {
  GoalStack,
  runCycle,
  type GoalInput,
  type GoalNode,
  type Operator,
  type SoarCycle,
} from './goal-stack.ts'

export const name = 'mana-scheduler'

/** 依赖 core（方案 §9.1：`scheduler` 的依赖仅 `core`）。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 目标栈节点数上限。超限时**拒绝入栈并抛错**（不静默丢弃）。 */
  maxGoals: number
  /** 每轮 SOAR 循环的最大步数（防规则集互相诱发无限循环）。 */
  maxCycles: number
}

export const Config: Schema<Config> = Schema.object({
  maxGoals: Schema.number().default(64),
  maxCycles: Schema.number().default(8),
})

/** 本插件对外服务面。 */
export interface ManaSchedulerService {
  readonly plugin: string
  /** 目标栈（读写均经此，禁止外部直接改库表 `goals`）。 */
  readonly goals: GoalStack
  /** 入栈（受 `maxGoals` 约束）。 */
  pushGoal(input: GoalInput): GoalNode
  /** 执行至多 `maxCycles` 轮 SOAR 三阶段；返回每一轮结果（含 `impasse` 轮）。 */
  run(facts: readonly string[], operators: readonly Operator[]): SoarCycle[]
  status(): {
    plugin: string
    wired: boolean
    goalCount: number
    topGoalId: string | null
    maxCycles: number
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-scheduler': ManaSchedulerService
  }
}

/**
 * 写入 `mana_trace` 的事件类型 —— **裸名标签**，真源是 core 的 `MANA_STAGES`（F-01 口径 A）。
 *
 * ⚠ 旧值 `'mana/scheduler/attention'` 是**第三套名字**（既不在契约的 8 个带前缀事件名里，
 *   也不在 MANA_STAGES 的裸名五类里）⇒ A1-1 按五类机检时它**必然落空**。
 *   处置 = 归并入 `'attention'` 段：本行记的是「attention 放行的聚焦项被调度侧登记」，
 *   与 attention 段同类；包内身份由 payload 的 topGoalId/goalCount 承载。
 *   不保留双写：多一个第六类标签，A1-1 的「五类各 ≥1」就可被这类行**绕开**（假绿）。
 */
const TRACE_EVENT: ManaStage = MANA_STAGES[1] ?? (() => {
  throw new Error('mana-scheduler: MANA_STAGES 缺 attention 段')
})()

export function apply(ctx: Context, config: Config): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-scheduler: 缺少 mana-core 服务（inject 未满足）')

  const goals = new GoalStack()

  const service: ManaSchedulerService = {
    plugin: name,
    goals,
    pushGoal(input: GoalInput): GoalNode {
      if (goals.size >= config.maxGoals) {
        throw new Error(`mana-scheduler: 目标栈已满（maxGoals=${config.maxGoals}），拒绝入栈 ${input.id}`)
      }
      return goals.push(input)
    },
    run(facts: readonly string[], operators: readonly Operator[]): SoarCycle[] {
      const out: SoarCycle[] = []
      let current = [...facts]
      for (let i = 1; i <= config.maxCycles; i += 1) {
        const cycle = runCycle(current, operators, i)
        out.push(cycle)
        // impasse 是**一等状态**：到达即停（不静默继续，也不抛错冒充成功）。
        if (cycle.phase === 'impasse') break
        // 事实集不动点即收敛停：否则会在 maxCycles 内空转同样多轮，"跑了几轮"就失去意义。
        if (cycle.factsAfter.join('\n') === cycle.factsBefore.join('\n')) break
        current = cycle.factsAfter
      }
      return out
    },
    status: () => ({
      plugin: name,
      wired: true,
      goalCount: goals.size,
      topGoalId: goals.top()?.id ?? null,
      maxCycles: config.maxCycles,
    }),
  }

  /**
   * 真行为：收到作意事件 → 把聚焦项登记为一次调度观察并**写一行** `mana_trace`。
   *
   * 走事件总线（而非直接调 service）是本包反证判据成立的前提 —— 见文件头 ②。
   */
  ctx.on('mana/attention', (att: ManaAttention) => {
    const top = goals.top()
    core.writeTrace({
      eventType: TRACE_EVENT,
      sessionId: att.sessionId,
      turnId: att.turnId,
      payload: {
        requestId: att.requestId,
        content: att.content,
        topGoalId: top?.id ?? null,
        goalCount: goals.size,
      },
      at: att.at,
    })
  })

  ctx.effect(() => {
    const dispose = ctx.provide('mana-scheduler', service)
    return () => dispose()
  }, 'dsh-mana-scheduler: service')

  // G9：waterfall 直通 + next()。写在最后一行，读代码的人先看到服务再看到义务。
  registerPassThroughPreStep(ctx, name)
}
