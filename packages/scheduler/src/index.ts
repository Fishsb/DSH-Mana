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
import {
  CHAIN_SERVICES,
  DRIVER_NAMESPACE,
  SEVEN_CHAIN_TABLE,
  TRACE_EVENTS as CHAIN_TRACE_EVENTS,
  createChainDriver,
  type ChainCoverageRow,
  type ChainDriver,
  type ChainDriverDeps,
  type DriverReadings,
  type OperatorRunLike,
} from './chains.ts'

export const name = 'mana-scheduler'

/** 依赖 core（方案 §9.1：`scheduler` 的依赖仅 `core`）。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 目标栈节点数上限。超限时**拒绝入栈并抛错**（不静默丢弃）。 */
  maxGoals: number
  /** 每轮 SOAR 循环的最大步数（防规则集互相诱发无限循环）。 */
  maxCycles: number
  /** 七链条驱动者总开关（**真旋钮**：false ⇒ 零 `mana-scheduler/chain/*` 行）。 */
  driverEnabled: boolean
  /** 共激活激活流上界（条）；超出按最旧丢弃且丢弃数可数。 */
  learningBufferMax: number
  /** 单次检索 topK（原样透传给 `vector.recall`）。 */
  retrievalTopK: number
  /** 单条链一次最多读多少条活记忆（防全表读；夹住时 `capped:true` 可查）。 */
  maxChainItems: number
  /**
   * 生成链（§13.5 深睡归纳）是否发起。
   *
   * ⚠ 缺省 **true** 的理由与 `driverEnabled` 同源：本次交付的核心就是「给生成层落第一个
   *   生产消费者」，缺省关掉等于交付一个不生效的开关。
   * ⚠ 关掉**不是静默**：每回合仍落一行 `generation/skipped`（带非空 reason），
   *   使「开关关着」与「链没跑」在库里可分辨（见 chains.ts 的 runGeneration）。
   */
  generationEnabled: boolean
  /** 送给生成链的素材上限（字符）；实际长度**原样**进 payload，截断不会被藏起来。 */
  generationMaterialMaxChars: number
}

export const Config: Schema<Config> = Schema.object({
  maxGoals: Schema.number().default(64),
  maxCycles: Schema.number().default(8),
  /**
   * ⚠ 缺省 **true**：本包的核心交付就是「让四链在生产侧有触发者」，
   *   缺省关掉等于交付一个不生效的开关（本仓点名的「假旋钮」形态）。
   *   它的可观测差异由 `tests/chains-e2e.test.mjs` D1 钉住（false ⇒ 零 chain 行）。
   */
  driverEnabled: Schema.boolean().default(true),
  learningBufferMax: Schema.number().default(256),
  retrievalTopK: Schema.number().default(10),
  maxChainItems: Schema.number().default(200),
  generationEnabled: Schema.boolean().default(true),
  generationMaterialMaxChars: Schema.number().default(4000),
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
    /** 驱动者读数（W1-1）：ticks/错误数/缓冲——**每次调用实时取**，不是启动快照。 */
    driver: DriverReadings
  }
  /**
   * §18.2 七链条的**当下**覆盖面（逐行 status/reason）。
   *
   * ⚠ 与 `mana-scheduler/chain/coverage` trace 行**同源**（同一个 `coverage()`）——
   *   两处各算一遍必然漂开（本仓「同一个事实两处读数」的既有教训）。
   */
  chains(): readonly ChainCoverageRow[]
  /** 驱动者读数（`status().driver` 的同源别名，供只读探测直接取）。 */
  driverReadings(): DriverReadings
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

  /**
   * ── W1-1：七链条驱动者的**输入面**（本包自己产出的算子序列）────────────────────
   *
   * `run()` 的每次调用记成一条 `OperatorRun`（chunking 的输入形状），步骤取该轮
   * `cycles` 里**实际选中**的算子序列（`impasse` 轮的 `operatorId=null` **不入序列**
   * —— 把 null 塞进去会造出一条不存在的算子序列，chunking 的重复检测随即失准）。
   * `goalId` 取**当时**的 `goals.top()`：没有目标时显式写 `'no-goal'`，**不用空串**
   * （空串会让「没有目标」与「目标 id 是空串」同形）。
   *
   * ⚠ **消费式**：`takeRuns()` 取走即清空 ⇒ 同一段序列不会被两个回合各 chunk 一次
   *   （重复计权 = 假读数）。这与 `reconsolidation` 的「窗口到点关闭是幂等读改」同口径。
   */
  const runLog: OperatorRunLike[] = []
  let runCalls = 0
  const takeRuns = (): OperatorRunLike[] => {
    const out = runLog.splice(0, runLog.length)
    return out
  }

  const driver: ChainDriver = createChainDriver({
    ctx,
    core,
    config: {
      driverEnabled: config.driverEnabled,
      learningBufferMax: config.learningBufferMax,
      retrievalTopK: config.retrievalTopK,
      maxChainItems: config.maxChainItems,
      generationEnabled: config.generationEnabled,
      generationMaterialMaxChars: config.generationMaterialMaxChars,
    },
    goals,
    takeRuns,
    runCalls: () => runCalls,
  } satisfies ChainDriverDeps)

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
      runCalls += 1
      /**
       * 记一条 `OperatorRun` 供 chunking（§18.2「目标完成 → 学习（chunking）」）。
       *
       * ⚠ 事实集即**条件**：SOAR 的算子序列只有在「前提成立」时才有意义，故 conditions 取
       *   `facts`（首轮事实集）排序后的前若干项 —— 与 `Operator.conditions` 的合取语义同源。
       *   排序是为了让同一序列在不同运行下**产生同一个 signature**（否则 chunking 的
       *   重复检测会因输入顺序不同而失准）。
       */
      runLog.push({
        id: `run-${runCalls}`,
        goalId: goals.top()?.id ?? 'no-goal',
        steps: out.map((c) => c.operatorId).filter((id): id is string => typeof id === 'string'),
        endedAt: new Date().toISOString(),
      })
      return out
    },
    status: () => ({
      plugin: name,
      wired: true,
      goalCount: goals.size,
      topGoalId: goals.top()?.id ?? null,
      maxCycles: config.maxCycles,
      driver: driver.readings(),
    }),
    chains: () => driver.coverage(),
    driverReadings: () => driver.readings(),
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

  /**
   * ── W1-1：七链条驱动者的**三条宿主事件挂点** ────────────────────────────────────
   *
   * 逐条对应 §18.2 的表行（见 `chains.ts` 的 `SEVEN_CHAIN_TABLE`，那是唯一口径表）：
   *   · `agent/inbox/inserted` —— 用户输入 ⇒ 编码 + 检索（§18.2 第 1 行）
   *   · `mana/injection`       —— 记忆被检索并注入 ⇒ 再巩固开窗（第 6 行）
   *   · `agent/turn-stopping`  —— 回合边界 ⇒ 巩固 / 遗忘 / 关窗 / 学习 / 覆盖面
   *                              （第 3、4 行；「定时任务」在无定时器仓库里的**替代**）
   *
   * ⚠ **三个挂点全部走 `ctx.on` 而非直接调服务**：反证判据（卸载 ⇒ 零新行）靠的就是这条
   *   —— 若驱动者被别处直接调用，卸载监听器后行照写，判据平凡通过（G11）。
   * ⚠ **每一个监听器自己兜错**：`agent/inbox/inserted` 与 `mana/injection` 是 **emit 型**
   *   （宿主不收集返回值）⇒ 回调里抛错会冒泡进宿主调用栈；`turn-stopping` 是 **serial 型**
   *   （宿主 await）⇒ 抛错会打断回合收尾。两条都必须「记一行再吞」，不得让调度故障
   *   反向打断宿主回合。
   */
  ctx.on('agent/inbox/inserted', (payload: unknown) => {
    try {
      driver.onUserMessage(payload)
    } catch (error) {
      console.error(
        `[mana-scheduler] 编码/检索链分发失败：[当前状态] ${String((error as Error)?.message ?? error)}`,
      )
    }
  })

  ctx.on('mana/injection', (payload: unknown) => {
    try {
      driver.onInjection(payload)
    } catch (error) {
      console.error(`[mana-scheduler] 再巩固链分发失败：${String((error as Error)?.message ?? error)}`)
    }
  })

  ctx.on('agent/turn-stopping', async (payload: unknown) => {
    try {
      await driver.onTurnBoundary(payload)
    } catch (error) {
      // 这里是 async：**必须** catch，否则就是一个 unhandledRejection（本仓有该形态的实测教训）。
      console.error(`[mana-scheduler] 回合边界链分发失败：${String((error as Error)?.message ?? error)}`)
    }
  })

  ctx.effect(() => {
    const dispose = ctx.provide('mana-scheduler', service)
    return () => dispose()
  }, 'dsh-mana-scheduler: service')

  // G9：waterfall 直通 + next()。写在最后一行，读代码的人先看到服务再看到义务。
  registerPassThroughPreStep(ctx, name)
}

// ── W1-1 的机检面（导出给判据与探针：**不在别处再写一套**）────────────────────
export { DRIVER_NAMESPACE, SEVEN_CHAIN_TABLE, CHAIN_TRACE_EVENTS, CHAIN_SERVICES }
export type { ChainCoverageRow, DriverReadings }
export { createChainDriver } from './chains.ts'
