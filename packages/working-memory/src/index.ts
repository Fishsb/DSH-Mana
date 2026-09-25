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
 * ⚠ **预算上限（`budgetChars`）同样必须是真闸**（G2 修复，2026-09-25）：超预算时
 *   **逐出最旧**（多条时）／**截断最后一条**（仅剩一条且其自身超预算时，保**就绪性下限** =
 *   至少留 1 条），两处都**显式记账**（`budgetEvicted` / `truncated` / `truncatedChars`）。
 *   修复前该键是**零消费死开关**（实测：`budgetChars=1` + 4×5000 字 ⇒ `{chars:20000, evicted:0}`，
 *   超 19999 字无任何动作），且源码里**没有**「尚未实现」标注 —— 设置页那个框看起来正在管预算
 *   （本仓最坏的一种假开关形态：连"未实现"的痕迹都不留，失败不可观测）。
 *
 * ## 两闸语义与顺序：**先容量、后预算**（串联）
 *   ① 容量闸 `capacityChunks`（**条数**上界） → ② 预算闸 `budgetChars`（**字符**上界，按码点计）
 *   · 两轴的 `<= 0` 一律 = **该轴不设闸（无上限）**：与 `maxRounds=0` / `maxTokens=0` 同族
 *     （G2 明订，见判据 W12）。不取「0 = 一条都不收 / 一字都不留」——那会让**漏填配置退化为静默全丢**。
 *   · 比较一律**严格大于**（`>`）才动作：恰满上限**不得**逐出/截断（与容量闸同口径，边界腿 W1/W10）。
 *   · **先容量后预算的理由**：容量是**结构界**（size 绝不允许越过它），预算只在结构界内做字符淘汰。
 *     逆序（先预算后容量）会把**同一批溢出记到不同的账上** ⇒ 记账归属随实现顺序漂，
 *     「谁把这条挤掉的」在库上不可分辨。W11 用 `cap=1,budget=4,两条各 5 字` 把顺序钉死：
 *     正序 = `evicted:1 / budgetEvicted:0`，逆序 = `evicted:0 / budgetEvicted:1`。
 *   · **两闸同时超时以谁为准**：末态必须**同时**满足两个上界（`size <= capacityChunks` 且
 *     `chars <= budgetChars`）；预算闸只做「减条 / 截断」，**绝不新增条目** ⇒ 它不可能把 size
 *     顶破容量闸。记账归属 = **先跑的那道闸先记账**。
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
  /**
   * 工作记忆容量（**条数**上界）。方案 §5.3 原值 4。
   * ⚠ `<= 0` = **该轴不设闸（无上限）**（与 `maxRounds=0` / `maxTokens=0` 同族，G2 明订，判据 W12）。
   */
  capacityChunks: number
  /**
   * 工作记忆**字符**预算（按**码点**计，与 attention 的 `injectionBudgetChars` 同口径）。
   * ⚠ `<= 0` = **该轴不设闸（无上限）**（同一约定，判据 W12）。
   * ⚠ 本键曾长期是**零消费死开关**（< 4000 时不影响任何行为，读完只回填进 snapshot）—— G2 已落成真闸。
   */
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
  /** 累计**容量闸**逐出数（**显式记账**：0 与「没淘汰过」可分辨）。 */
  evicted: number
  budgetChars: number
  /** 当前内容总字符数（按**码点**计，与预算闸同一实现；供 budget 判据）。 */
  chars: number
  /** 累计**预算闸**逐出数（因超 `budgetChars` 而被逐出的条数；与 `evicted` **分账**）。 */
  budgetEvicted: number
  /** 累计**截断**次数（仅当只剩 1 条、且其自身超预算时发生）。 */
  truncated: number
  /** 截断累计丢弃的**码点数**（与 `truncated` 配对：截了几次 / 截掉多少字）。 */
  truncatedChars: number
}

export interface ManaWorkingMemoryService {
  readonly plugin: string
  /**
   * 收一条聚焦项进工作记忆。**先容量闸、后预算闸**（见文件头「两闸语义与顺序」）：
   * 超条数即逐出最旧、超字符预算即逐出最旧（仅剩一条时截断）。
   * 返回**本次是否发生逐出**（容量或预算任一路上发生即 true；截断单独记账，见 snapshot）。
   */
  push(att: ManaAttention): boolean
  /** 当前快照（深拷贝，调用方改不到内部状态）。 */
  snapshot(): WorkingMemorySnapshot
  status(): {
    plugin: string
    wired: boolean
    capacityChunks: number
    budgetChars: number
    size: number
    chars: number
    evicted: number
    budgetEvicted: number
    truncated: number
    truncatedChars: number
  }
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
  let budgetEvicted = 0
  let truncated = 0
  let truncatedChars = 0
  let counter = 0

  /** 字符数一律按**码点**计 —— 与 `snapshot().chars`、attention 的 `injectionBudgetChars` 同一口径。 */
  const charsOf = (s: string): number => [...s].length

  /**
   * **记账读数**（单一来源）：snapshot/status/mana_trace 三处一律取它，不各拼一遍
   * （「读数与事实脱钩」正是本包这一类缺陷的母形）。
   *
   * ⚠ **不含 `chunks`**：快照带内容（判据要读内容），而 `mana_trace` 是审计面 ——
   *   本仓既有不变式「审计不泄内容」（W6 断言落痕 payload 不得出现内容原文）。
   *   故 `...service.snapshot()` 那种写法**是错的**（会把整份内容摊进审计表），这里显式只取计数与配置。
   */
  const counts = () => ({
    capacityChunks: config.capacityChunks,
    budgetChars: config.budgetChars,
    chars: chunks.reduce((n, c) => n + charsOf(c.content), 0),
    evicted,
    budgetEvicted,
    truncated,
    truncatedChars,
  })

  /** 计数 + 条数（`status` 与落痕用；`snapshot` 不必带 `size` —— 它有 `chunks`，冗余派生字段是漂移源）。 */
  const metrics = () => ({ ...counts(), size: chunks.length })

  const push = (att: ManaAttention): boolean => {
    counter += 1
    chunks.push({ requestId: att.requestId, content: att.content, seq: counter, at: att.at })
    let didEvict = false

    // ── 闸① 容量闸（**条数**上界）─────────────────────────────────────────────
    // 真闸：超出容量才淘汰，且**记账**（不得静默 shift）。`> 0 && >` 双条件：
    // 前者 = 「0/负数 = 该轴不设闸（无上限）」（G2 明订，见文件头；判据 W12）。
    while (config.capacityChunks > 0 && chunks.length > config.capacityChunks) {
      chunks.shift()
      evicted += 1
      didEvict = true
    }

    // ── 闸② 预算闸（**字符**上界，按码点）────────────────────────────────────
    // 修复前本键是零消费死开关（G2，2026-09-25）。语义对齐 attention.injectionBudgetChars
    // （packages/attention/src/index.ts:207-209）：**超预算不得静默** —— 那里截断正文 + 保留
    // `</mana-memory>` 收尾；这里逐出/截断 + 三个记账字段。差异见文件头（逐出而非截断整块）。
    while (true) {
      const total = chunks.reduce((n, c) => n + charsOf(c.content), 0)
      // `<= 0` = 该轴不设闸；`>` 严格大于才动作（恰满预算不得截断 —— 与容量闸同口径，W10 边界腿）。
      if (config.budgetChars <= 0 || total <= config.budgetChars) break
      const oldest = chunks[0]
      if (oldest === undefined) break
      const head = charsOf(oldest.content)
      if (chunks.length > 1) {
        // 多块 ⇒ **逐出最旧**（与容量闸同构：两条轴都是「保最新、弃最旧」）。
        // 取整块而非切半条：本包是**组块集**，半条内容既非一块也无 requestId 可归属
        // （截断只保留给「只剩一条」的退化情形）。
        chunks.shift()
        budgetEvicted += 1
        didEvict = true
        continue
      }
      // 只剩一条且其自身超预算 ⇒ **截断**（而非逐出）：保**就绪性下限 = 至少留 1 条**。
      // 若这里改成整条逐出，预算一小于首条长度，工作记忆恒空 —— 那是「漏填配置 ⇒ 静默全丢」，
      // 与 G2 为 capacityChunks<=0 明订的语义相冲突。截断量 = total - budgetChars > 0 必然截得动
      // （上一步 total > budgetChars 才进来），故循环必然终止，无死循环面。
      const cut = total - config.budgetChars
      const kept = [...oldest.content].slice(0, head - cut).join('')
      chunks[0] = { ...oldest, content: kept }
      truncated += 1
      truncatedChars += cut
      // ⚠ 截断**不**计入 `didEvict`：条数未减，逐出账不得被截断污染（两者必须可分辨）。
      break
    }
    return didEvict
  }

  const service: ManaWorkingMemoryService = {
    plugin: name,
    push,
    // 键序（W5 断言按字典序排序后比对，故键序本身不承载语义）
    snapshot: () => ({ chunks: chunks.map((c) => ({ ...c })), ...counts() }),
    status: () => ({ plugin: name, wired: true, ...metrics() }),
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
        // ⚠ 读数取自 `metrics()`（单一来源）但**不含 chunks**：审计面不泄内容（W6 断言）。
        ...metrics(),
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
