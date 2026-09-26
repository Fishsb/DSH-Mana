/**
 * 七链条驱动者（W1-1）—— 《v10 方案》§18.2「七链条触发时机」在本仓的**唯一落点**。
 *
 * ── 要解决的现象（本批的开工事实）────────────────────────────────────────────────────
 *   `consolidation` / `reconsolidation` / `forgetting` / `learning` 四包的服务
 *   **装配后零外部消费者**（判据原文：`ctx.provide('<svc>')` 被别的包引用次数 = 0）。
 *   各链自己的单测全绿 ⇒ 「实现完成」与「系统能跑」在报告层面**同形**。
 *   ⇒ 本文件是那四个服务的**第一个生产调用方**，且调用由**宿主事件**驱动（本仓无定时器）。
 *
 * ── 三条硬约束（逐条有落点，不是注释承诺）────────────────────────────────────────────
 *   ① **不 import 各包实现**：本仓跨包连接一律走「事件 + 服务」，全仓跨包 import 只有 core 一处。
 *      故本文件对四链**全部**走 `ctx.get('<svc>')` 的**运行期解析** + 本地**结构接口**
 *      （`ChainConsolidation` / `ChainReconsolidation` / …）。代价照实写：
 *      接口漂移**编译期抓不到**，只能靠 `packages/scheduler/tests/chains-e2e.test.mjs` 的端到端腿抓。
 *      这与 `forgetting/src/index.ts:266`（`ctx.get('mana-long-term')`）与
 *      `vector/src/recall-gate-hook.ts` 是**同一条既有取舍**，本包不另发明。
 *      同理 `inject` **仍只有 ['mana-core']**（方案 §9.1）：把四链写进 `inject` 会让
 *      「某链未装配」变成「调度器停在 waiting」——那正是本仓最防的**静默**形态。
 *   ② **无定时器**：本文件零 `setInterval`/`setTimeout`。§18.2 的「定时任务」一行由
 *      宿主事件 `agent/turn-stopping`（回合边界）**替代**，且替代事实**写进每一行 trace**
 *      （`substitution`/`v10Trigger` 两个字段），不靠注释交代。
 *   ③ **失败必须可观测**：某链服务未装配 ⇒ 该链的 trace 行**照写**，`assembled:false` +
 *      `status:'unassembled'` + 非空 `reason`。**不得静默跳过** —— 静默跳过会让
 *      「链跑了但没产出」与「链压根没跑」同形，那是本仓首位缺陷类。
 *      ⚠ 归因**只写一处**：不额外发 `mana/plugin/inactive`。既有教训（`long-term/src/index.ts`
 *      Write Gate 段）明确：该事件全仓零消费方，「发一条没人听的归因事件」等于没归因，
 *      两处记同一件事必然漂开 ⇒ 值本身就是归因，落在下面的 trace 行 payload 里。
 *
 * ── 反证判据（R 形态）**先天成立**的原因（这条必须说对，否则是 G11 平凡通过）────────────
 *   「卸载驱动者 ⇒ 该链不再产生新行」只有在**驱动者真写行**时才不是平凡通过。
 *   故本文件的每一条链任务**无条件**写一条 `mana-scheduler/chain/*` 行（连 0 输入也写，
 *   见 `eventsSeen: 0` 的显式记 0）。卸载调度器 fiber ⇒ 监听器全释放 ⇒ 同一触发零新行。
 *   且卸载后**链服务仍在**（本测试的对照腿），故「没新行」可归因到驱动者而不是链没了。
 *
 * ── 本文件**不做**什么（边界，逐条引自拍板）──────────────────────────────────────────
 *   ⛔ **不移植 FSRS**（C16）：§18.2「检索命中 → 学习（间隔重复）」一行记 `not-ported`，
 *      不实现任何间隔重复排程。学习链走的是 **L-03 已落地的 Hebbian 共激活**（`related_ids`）。
 *   ⛔ **不移植 ITACL / MCL / §8 神经科学本体**（C16）：本文件不碰它们。
 *   ⛔ **不写 `retired` 列**：遗忘链只产出**候选清单**（B4.2 已实现的那一步）。
 *      `retirementPlan().unimplemented` 原样进 payload，使「只列候选」不被读成「已归档」。
 *   ⛔ **不碰 `memory_items` 的既有列语义**：本文件只写 `related_ids`（经 learning 服务）
 *      与 `mana_trace`；`retired`/`strength`/ACT-R 各列一格不写。
 *   ⛔ **不改 8 事件契约**：本文件只 `on` 既有事件，不新增事件名、不改 payload 形状。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ManaCoreService } from 'dsh-mana-core'
import type { GoalStack } from './goal-stack.ts'

// ── 命名空间 ─────────────────────────────────────────────────────────────────
/**
 * 本驱动者写入 `mana_trace.event_type` 的**唯一前缀**。
 *
 * ⚠ **不得冒充 S1 五类**（`core/src/domain.ts:MANA_STAGES`）：本文件写的是**调度事实**
 *   （哪条链在什么触发下跑了、装配了没有），不是认知阶段。写进那五类会污染 A1-1 的计数，
 *   让「五类各 ≥1」可被本文件的行**凑出来**（负向控制见 learning/reconsolidation 的先例）。
 *   本包既有的**另一**条 label（`MANA_STAGES[1]` = 'attention'）保持不变，语义见 `index.ts`。
 */
export const DRIVER_NAMESPACE = 'mana-scheduler/chain' as const

/** 驱动者写入 `mana_trace` 的**全部**标签（判据按它核集合，不抽查）。 */
export const TRACE_EVENTS = Object.freeze({
  /** 编码链：宿主用户输入 ⇒ `perception.perceive`。 */
  encoding: `${DRIVER_NAMESPACE}/encoding`,
  /** 检索链：同一次用户输入 ⇒ `vector.recall`。 */
  retrieval: `${DRIVER_NAMESPACE}/retrieval`,
  /** 巩固链：回合边界 ⇒ `consolidation.plan` + `writeRules`。 */
  consolidation: `${DRIVER_NAMESPACE}/consolidation`,
  /** 再巩固链：记忆被注入上下文 ⇒ `reconsolidation.openWindow`（+ 回合边界关窗）。 */
  reconsolidation: `${DRIVER_NAMESPACE}/reconsolidation`,
  /** 遗忘链：回合边界 ⇒ `forgetting.retireCandidates`（只列候选）。 */
  forgetting: `${DRIVER_NAMESPACE}/forgetting`,
  /** 学习链：共激活流 ⇒ `learning.store.applyCoActivations`（Hebbian）。 */
  learning: `${DRIVER_NAMESPACE}/learning`,
  /** 覆盖面：每个回合边界把 §18.2 七行的**当下**状态落一行（含 not-driven 的行）。 */
  coverage: `${DRIVER_NAMESPACE}/coverage`,
  /** 链任务抛错（**绝不静默**：`catch` 里不写行就等于把故障吃掉）。 */
  error: `${DRIVER_NAMESPACE}/error`,
})

/** 被驱动的链服务名（**唯一出处**：换服务名只改这里）。 */
export const CHAIN_SERVICES = Object.freeze({
  perception: 'mana-perception',
  vector: 'mana-vector',
  consolidation: 'mana-consolidation',
  reconsolidation: 'mana-reconsolidation',
  forgetting: 'mana-forgetting',
  learning: 'mana-learning',
})
// ── §18.2 触发时机表（**唯一口径表**，逐行对齐 v10 原文）──────────────────────
/**
 * 每一行的 `hostTrigger === null` 都必须带非空 `reason` —— 那是「本行没有可接的宿主事件面」
 * 的**机检面**，不是留白。表格以外的触发源**不自行发明**。
 */
export interface SevenChainRow {
  readonly id: string
  /** §18.2 原文的「触发源」列。 */
  readonly v10Trigger: string
  /** §18.2 原文的「触发链条」列。 */
  readonly v10Chains: readonly string[]
  /** 本仓实际挂的宿主事件；`null` = 无源可接。 */
  readonly hostTrigger: string | null
  /** 本仓对 v10 原文的**替代**（如「定时任务」在无定时器仓库里的落点）。 */
  readonly substitution?: string
  /** `hostTrigger === null` 时**必填**的理由。 */
  readonly notDrivenReason?: string
  /** 本行依赖的服务名（用于运行期判定 `unassembled`）。 */
  readonly requires: readonly string[]
  /** 该行是否属 C16 拍板的「不移植」清单。 */
  readonly notPorted?: string
}

export const SEVEN_CHAIN_TABLE: readonly SevenChainRow[] = Object.freeze([
  {
    id: 'user-input',
    v10Trigger: '用户输入',
    v10Chains: ['编码', '检索'],
    hostTrigger: 'agent/inbox/inserted',
    requires: [CHAIN_SERVICES.perception, CHAIN_SERVICES.vector],
  },
  {
    id: 'tool-result',
    v10Trigger: '工具返回',
    v10Chains: ['编码'],
    hostTrigger: null,
    notDrivenReason:
      '宿主无「工具结果」的 cordis 事件面：dsh-tools 只暴露 tools/pre-execute（执行**前**）与 ' +
      'tool/ptc-dispatch*（run_code 子调用），工具结果落 session log 的 tool/result，' +
      '由 dsh-workspace-changes 从 event.type 读，**不是 ctx 事件** ⇒ 本驱动者无源可接（不伪造）。',
    requires: [CHAIN_SERVICES.perception],
  },
  {
    id: 'scheduled',
    v10Trigger: '定时任务',
    v10Chains: ['巩固', '遗忘'],
    hostTrigger: 'agent/turn-stopping',
    substitution: '本仓无定时器（W1-1 硬约束）⇒ 由回合边界代替；替代事实逐行落 trace 的 substitution 字段',
    requires: [CHAIN_SERVICES.consolidation, CHAIN_SERVICES.forgetting],
  },
  {
    id: 'goal-done',
    v10Trigger: '目标完成',
    v10Chains: ['学习（chunking）'],
    hostTrigger: 'agent/turn-stopping',
    substitution:
      '宿主无「目标完成」事件面（目标栈是本包内存态）⇒ 由回合边界扫描 goals.toSerial() 里 status=done 的节点 + ' +
      '本包 run() 记录下的算子序列，喂 consolidation.chunk（chunking 的实现在巩固包，本包不另写一份）',
    requires: [CHAIN_SERVICES.consolidation],
  },
  {
    id: 'user-emphasis',
    v10Trigger: '用户强调',
    v10Chains: ['编码', '巩固'],
    hostTrigger: null,
    notDrivenReason:
      '宿主无「用户强调」通道：dsh-llm 的 UserMessage 只有 { id, role, content, source }，' +
      '无优先级/强调标记字段 ⇒ 无法把「强调」与「普通输入」分辨开（认不出就不假装认得出）。',
    requires: [CHAIN_SERVICES.perception, CHAIN_SERVICES.consolidation],
  },
  {
    id: 'memory-retrieved',
    v10Trigger: '记忆被检索',
    v10Chains: ['再巩固'],
    hostTrigger: 'mana/injection（gate=injected 且 memoryId≠null）',
    substitution:
      '再巩固链的原文是「记忆被检索**并注入上下文**」⇒ 取注入审计面里真注入的那一类，' +
      '比取 mana/recall（其 payload 只有 query/hitCount，**无 memory id**）更贴语义',
    requires: [CHAIN_SERVICES.reconsolidation],
  },
  {
    id: 'retrieval-hit',
    v10Trigger: '检索命中',
    v10Chains: ['学习（间隔重复）'],
    hostTrigger: null,
    notPorted: 'FSRS 不移植（C16 拍板：与已冻结的 A1-5 decay(14)=0.500000 冲突）',
    notDrivenReason:
      '该行的 v10 机制是 FSRS 间隔重复 ⇒ 按 C16 整行不移植。学习链**不是**没跑：' +
      '它走 L-03 已落地的 Hebbian 共激活路径（见本文件 learning 任务），两条是不同的链段，不得互相冒充。',
    requires: [CHAIN_SERVICES.learning],
  },
])

// ── 运行期解析出来的**结构接口**（不 import 各包；只管本文件真正调到的那几个成员）────
export interface ChainPerception {
  perceive(input: {
    content: string
    sessionId: string
    turnId: number
    requestId: string
    source?: string
    at?: string
  }): number
}

export interface ChainVector {
  recall(
    query: string,
    candidates: readonly { readonly key: string; readonly lexicalRank?: number }[],
    topK?: number,
    envelope?: { sessionId: string; turnId: number; requestId: string; at?: string },
  ): Promise<unknown>
}

export interface RippleStatsLike {
  readonly replayed?: number
  readonly merged?: number
  readonly novel?: number
  readonly skipped?: number
}

export interface ChainConsolidationPlan {
  readonly spindle: { readonly selected: readonly unknown[]; readonly skipped: readonly unknown[] }
  /** `null` = 余弦通道不可用 ⇒ Ripple 未执行（**不得**读成「没有可合并的」）。 */
  readonly ripple: { readonly stats: RippleStatsLike } | null
  readonly degraded: { readonly reason: string; readonly source: string } | null
  readonly chunking: {
    readonly seen: number
    readonly grouped: number
    readonly rules: readonly unknown[]
    readonly dropped: readonly unknown[]
    readonly stats: Record<string, unknown>
  }
}

export interface ChainConsolidation {
  plan(req: {
    periodId: string
    items: readonly SelectableMemoryLike[]
    neocortex: readonly { readonly id: string; readonly vector: unknown; readonly content?: string }[]
    runs: readonly OperatorRunLike[]
  }): ChainConsolidationPlan
  writeRules(rules: readonly unknown[]): {
    readonly inserted: readonly string[]
    readonly existing: readonly string[]
    readonly failures: readonly { readonly id: string; readonly reason: string }[]
  }
}

export interface ChainReconsolidation {
  openWindow(req: {
    memoryId: string
    type: string
    now: number
    trigger?: string | null
    sessionId?: string
    turnId?: number
  }): {
    readonly channel: string
    readonly degraded: boolean
    readonly reason: string | null
    readonly persisted: boolean
  }
  closeDueWindows(req: {
    now: number
    sessionId?: string
    turnId?: number
  }): {
    readonly channel: string
    readonly degraded: boolean
    readonly reason: string | null
    readonly closed: readonly string[]
    readonly scanned: number
  }
}

export interface ChainForgetting {
  forgetting: {
    /** 归档**候选清单**（B4.2 已落地的那一步；本驱动者不写 `retired` 列）。 */
    retireCandidates(items: readonly ActivationSnapshotLike[], tau?: number): readonly { readonly memoryId: string }[]
    retirementPlan(): { readonly unimplemented?: readonly string[] }
  }
}

export interface ChainLearning {
  store: {
    applyCoActivations(
      db: unknown,
      events: readonly { readonly id: string; readonly at: number }[],
      opts?: { readonly core?: ManaCoreService; readonly at?: string },
    ): {
      readonly degraded: boolean
      readonly reason: string | null
      readonly gate: string | null
      readonly eventsSeen: number
      readonly rowsWritten: number
      readonly occasions: number
      readonly pairs: readonly unknown[]
      readonly droppedEvents: readonly unknown[]
      readonly trace: unknown
    }
  }
}

export interface SelectableMemoryLike {
  readonly id: string
  readonly activation: number
  readonly vector?: ArrayLike<number> | null
  readonly content?: string
  readonly type?: string
  readonly retired?: boolean
}

export interface ActivationSnapshotLike {
  readonly memoryId: string
  readonly activation: number
  readonly retired?: boolean
}

export interface OperatorRunLike {
  readonly id: string
  readonly goalId: string
  readonly steps: readonly string[]
  readonly endedAt: string
}

// ── 运行期配置（**每一个旋钮都必须改变可观测行为**，否则即「假旋钮」）──────────
export interface DriverConfig {
  /** 关掉驱动者 ⇒ 零 `mana-scheduler/chain/*` 行（可观测差异，判据在 chains-e2e 的 D1）。 */
  readonly driverEnabled: boolean
  /**
   * 共激活激活流的**上界**（条）。
   * ⚠ 有界是刻意的：无界增长会让「该清没清」不可观测（本仓 256 分区表的同款理由）。
   * 超出按**最旧**丢弃，丢弃数进 trace payload 的 `bufferDropped`（丢弃**必须可数**）。
   */
  readonly learningBufferMax: number
  /** 单次检索的 topK（原样透传给 `vector.recall`，trace payload 里回显）。 */
  readonly retrievalTopK: number
  /** 单条链一次最多读多少条记忆（防全表读；被夹住时 `capped:true` 进 payload）。 */
  readonly maxChainItems: number
}

// ── 运行期状态读数（供 status()/chains() 与判据读）───────────────────────────
export interface DriverReadings {
  readonly enabled: boolean
  readonly ticks: number
  readonly lastTickAt: string | null
  readonly userMessagesSeen: number
  readonly injectionsSeen: number
  readonly bufferSize: number
  readonly bufferDropped: number
  readonly runsRecorded: number
  readonly errors: number
}

export interface ChainCoverageRow {
  readonly id: string
  readonly v10Trigger: string
  readonly v10Chains: readonly string[]
  readonly hostTrigger: string | null
  readonly status: 'driven' | 'unassembled' | 'not-driven' | 'not-ported'
  readonly reason: string | null
  readonly requires: readonly string[]
}
// ── 纯函数工具 ───────────────────────────────────────────────────────────────

/**
 * 从宿主 `agent` 上取会话身份（结构读取，**不 import dsh-agent 的运行期**）。
 *
 * ⚠ 与 `packages/attention/src/index.ts:194` 的 `resolvePreStepSessionId` **同口径**
 *   （`sessionId` 或 `session.id`）：两处若各写一套，同一 payload 会得到两个答案。
 *   取不到 ⇒ 返回 `undefined`，由调用方**显式记账**，**不落空串分区**
 *   （`''` 会让所有会话并进同一个虚构分区且看起来完全正常 —— attention 已实测该形态）。
 */
export function resolveSessionId(agent: unknown): string | undefined {
  const a = agent as { sessionId?: unknown; session?: { id?: unknown } } | undefined
  for (const candidate of [a?.sessionId, a?.session?.id]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return undefined
}

/**
 * 从宿主 `UserMessage` 里取可见文本。
 *
 * ⚠ **只读结构，不 import**：宿主形状是 `{ id, role, content: ContentBlock[], source }`，
 *   其中 text 块是 `{ type: 'text', text }`。非 text 块（image/file/reasoning）**不取**
 *   —— 把它们的序列化塞进 `perceive` 会让编码链吃到噪声，且审计面会泄内容（A1-9）。
 * 返回 `null` = 这条消息**没有可编码的文本**（显式区分于空串）。
 */
export function extractUserText(message: unknown): string | null {
  const m = message as { role?: unknown; content?: unknown } | undefined
  if (m?.role !== 'user') return null
  if (!Array.isArray(m.content)) return null
  const parts: string[] = []
  for (const block of m.content) {
    const b = block as { type?: unknown; text?: unknown }
    if (b?.type === 'text' && typeof b.text === 'string' && b.text !== '') parts.push(b.text)
  }
  return parts.length > 0 ? parts.join('\n') : null
}

/** BLOB → Float32Array；长度不是 4 的倍数则**返回 null**（不猜、不补零）。 */
export function blobToF32(blob: unknown): Float32Array | null {
  const bytes = blob as Uint8Array | null | undefined
  if (!bytes || typeof bytes.byteLength !== 'number' || bytes.byteLength === 0) return null
  if (bytes.byteLength % 4 !== 0) return null
  return new Float32Array(bytes.slice().buffer)
}

/** 一条记忆的读侧投影（驱动者的**唯一**数据源；不在别处再写一份 SQL）。 */
export interface LiveItemRow extends SelectableMemoryLike {
  readonly vector: Float32Array | null
}

export interface LiveItemsReading {
  readonly items: readonly LiveItemRow[]
  /** 真库里的活记忆条数（`retired=0`）。**与 items.length 分列** ⇒ 「读满」与「被夹」可分辨。 */
  readonly liveTotal: number
}

/**
 * 读活记忆行（`retired=0`）。
 *
 * ⚠ `activation` 取 `base_level_activation` 列 —— 与 `packages/ui/src/store.ts:70` 的
 *   读法**同源**（`activation: num(r.base_level_activation)`）。ACT-R 的派生量写者是
 *   `long-term`；本文件**只读不写**该列（改它即越界到 B3.1 的面）。
 * ⚠ 多读 1 行用于判「是否被夹住」：只读 LIMIT 条时，「刚好这么多」与「还有更多」同形。
 */
export function readLiveItems(core: ManaCoreService, limit: number): LiveItemsReading {
  const cap = Math.max(1, Math.floor(limit))
  const rows = core.db
    .prepare(
      'SELECT id, type, content, base_level_activation AS activation, vector' +
        ' FROM memory_items WHERE retired = 0 ORDER BY id ASC LIMIT ?',
    )
    .all(cap + 1) as unknown as {
    id: string
    type: string
    content: string
    activation: number | null
    vector: Uint8Array | null
  }[]
  const total = Number(
    (core.db.prepare('SELECT COUNT(*) c FROM memory_items WHERE retired = 0').get() as { c?: number })?.c ?? 0,
  )
  const items: LiveItemRow[] = rows.slice(0, cap).map((r) => ({
    id: r.id,
    activation: typeof r.activation === 'number' && Number.isFinite(r.activation) ? r.activation : 0,
    vector: blobToF32(r.vector),
    content: r.content,
    type: r.type,
    retired: false,
  }))
  return { items, liveTotal: total }
}

/** 读一条记忆的 `type`（再巩固的窗长由 type 决定 ⇒ 缺它不得猜）。 */
export function readMemoryType(core: ManaCoreService, memoryId: string): string | null {
  const row = core.db.prepare('SELECT type FROM memory_items WHERE id = ?').get(memoryId) as
    | { type?: unknown }
    | undefined
  return typeof row?.type === 'string' && row.type !== '' ? row.type : null
}
// ── 驱动者本体 ───────────────────────────────────────────────────────────────

export interface ChainDriverDeps {
  readonly ctx: Context
  readonly core: ManaCoreService
  readonly config: DriverConfig
  readonly goals: GoalStack
  /** 取走并**清空**本包 `run()` 记录下的算子序列（消费式 ⇒ 同一段序列不会被 chunk 两次）。 */
  readonly takeRuns: () => OperatorRunLike[]
  /** 本包 `run()` 被调用的次数（用于 coverage 行的可读线索）。 */
  readonly runCalls: () => number
}

export interface ChainDriver {
  /** `agent/inbox/inserted` —— 用户输入 ⇒ 编码（同步）+ 检索（异步、显式兜错）。 */
  onUserMessage(payload: unknown): void
  /** `mana/injection` —— 真注入 ⇒ 再巩固开窗 + 记一条共激活事件。 */
  onInjection(payload: unknown): void
  /** `agent/turn-stopping` —— 回合边界：巩固 / 遗忘 / 关窗 / 学习 / 覆盖面。 */
  onTurnBoundary(payload: unknown): Promise<void>
  /** 当下覆盖面（§18.2 七行逐行状态）；`chains()` 与 trace 行**同源**。 */
  coverage(): readonly ChainCoverageRow[]
  readings(): DriverReadings
}

export function createChainDriver(deps: ChainDriverDeps): ChainDriver {
  const { ctx, core, config, goals } = deps

  /** 共激活激活流（有界；消费式清空）。 */
  let activationBuffer: { id: string; at: number }[] = []
  let bufferDropped = 0
  const state = {
    ticks: 0,
    lastTickAt: null as string | null,
    userMessagesSeen: 0,
    injectionsSeen: 0,
    errors: 0,
  }

  /** 取服务（**每次调用时**解析，不缓存 —— 常驻进程里后装配的链必须能被接上）。 */
  const svc = <T>(name: string): T | undefined => ctx.get(name) as T | undefined

  /**
   * 写一行 trace。**绝不抛**：写失败退回 stderr（`learning/src/trace.ts:recordDegradation` 同款），
   * 因为「留痕本身失败」不得反过来打断认知链。
   */
  const trace = (eventType: string, sessionId: string, turnId: number, payload: Record<string, unknown>): void => {
    try {
      core.writeTrace({ eventType, sessionId, turnId, payload, at: new Date().toISOString() })
    } catch (error) {
      console.error(
        '[mana-scheduler] trace 写入失败（' + eventType + '）：' + String((error as Error)?.message ?? error),
      )
    }
  }

  /** 链任务抛错的**唯一**出口（catch 里不写行 = 把故障吃掉）。 */
  const recordError = (chain: string, sessionId: string, turnId: number, error: unknown): void => {
    state.errors += 1
    trace(TRACE_EVENTS.error, sessionId, turnId, {
      chain,
      message: String((error as Error)?.message ?? error),
      // 栈是定位用的最小集；不塞整个 error 对象（它可能带不可序列化字段）。
      stack: typeof (error as Error)?.stack === 'string' ? (error as Error).stack : null,
    })
  }

  /** 覆盖面：§18.2 逐行 × 当下服务是否可读。**同源**给 `chains()` 与 coverage trace 行。 */
  const coverage = (): readonly ChainCoverageRow[] =>
    SEVEN_CHAIN_TABLE.map((row) => {
      const missing = row.requires.filter((name) => svc<unknown>(name) === undefined)
      if (row.notPorted !== undefined) {
        return {
          id: row.id,
          v10Trigger: row.v10Trigger,
          v10Chains: row.v10Chains,
          hostTrigger: row.hostTrigger,
          status: 'not-ported' as const,
          reason: row.notPorted,
          requires: row.requires,
        }
      }
      if (row.hostTrigger === null) {
        return {
          id: row.id,
          v10Trigger: row.v10Trigger,
          v10Chains: row.v10Chains,
          hostTrigger: null,
          status: 'not-driven' as const,
          reason: row.notDrivenReason ?? '（缺理由 —— 表自身不完整）',
          requires: row.requires,
        }
      }
      if (missing.length > 0) {
        return {
          id: row.id,
          v10Trigger: row.v10Trigger,
          v10Chains: row.v10Chains,
          hostTrigger: row.hostTrigger,
          status: 'unassembled' as const,
          reason: '未装配的服务：' + missing.join(', ') + '（该链本回合无法执行 —— 不是「无事可做」）',
          requires: row.requires,
        }
      }
      return {
        id: row.id,
        v10Trigger: row.v10Trigger,
        v10Chains: row.v10Chains,
        hostTrigger: row.hostTrigger,
        status: 'driven' as const,
        reason: row.substitution ?? null,
        requires: row.requires,
      }
    })

  /**
   * 一条链的**统一外壳**：装配判定 → 执行 → 无条件落一行。
   *
   * ⚠ 未装配时**照写行**（`assembled:false` + 非空 reason）——这是「不得静默跳过」的落点。
   *   连「跑了但没东西可做」也要写（0 显式记 0，A6-2）。
   */
  const runChain = <T extends Record<string, unknown>>(
    chain: string,
    eventType: string,
    context: { sessionId: string; turnId: number },
    service: string,
    body: () => T,
  ): void => {
    const instance = svc<unknown>(service)
    if (instance === undefined) {
      trace(eventType, context.sessionId, context.turnId, {
        chain,
        assembled: false,
        status: 'unassembled',
        service,
        reason: '未装配的服务：' + service + ' —— 该链本回合**未执行**（不是「无候选」）',
      })
      return
    }
    try {
      const reading = body()
      trace(eventType, context.sessionId, context.turnId, { chain, assembled: true, status: 'ran', service, ...reading })
    } catch (error) {
      recordError(chain, context.sessionId, context.turnId, error)
    }
  }
  // ── 链 1／2：编码 + 检索（触发源 = 用户输入）────────────────────────────────
  const onUserMessage = (payload: unknown): void => {
    if (!config.driverEnabled) return
    const p = payload as { agent?: unknown; message?: unknown } | undefined
    const text = extractUserText(p?.message)
    // 非用户消息不是本行的触发源 ⇒ 不落行（落行会让 trace 被每一条内部消息淹没）。
    if (text === null) return

    state.userMessagesSeen += 1
    const sessionId = resolveSessionId(p?.agent)
    // ⚠ 取不到会话身份：照实记账并**中止本次链任务**，不落空串分区（见 resolveSessionId 的注释）。
    if (sessionId === undefined) {
      trace(TRACE_EVENTS.encoding, '', 0, {
        chain: 'encoding',
        assembled: svc<unknown>(CHAIN_SERVICES.perception) !== undefined,
        status: 'skipped',
        reason: 'no-session-identity：agent 上取不到 sessionId / session.id ⇒ 不落虚构分区',
        chars: [...text].length,
      })
      return
    }
    const turnId = 0
    const requestId = 'sched:perceive:' + sessionId + ':' + String(state.userMessagesSeen)

    // 编码链（同步：perceive 内部同步 emit mana/observation ⇒ attention 同步落痕）
    runChain('encoding', TRACE_EVENTS.encoding, { sessionId, turnId }, CHAIN_SERVICES.perception, () => {
      const perception = svc<ChainPerception>(CHAIN_SERVICES.perception) as ChainPerception
      const chunks = perception.perceive({ content: text, sessionId, turnId, requestId, source: 'user-message' })
      return { chars: [...text].length, chunks, requestId, v10Trigger: '用户输入' }
    })

    // 检索链（异步：recall 走嵌入通道，**必须显式兜错** —— emit 型事件的返回值被丢弃，
    //   漏 catch 就是一个 unhandledRejection，本仓有该形态的实测教训）
    void runRetrieval(text, sessionId, turnId, requestId).catch((error) => {
      recordError('retrieval', sessionId, turnId, error)
    })
  }

  const runRetrieval = async (
    query: string,
    sessionId: string,
    turnId: number,
    requestId: string,
  ): Promise<void> => {
    const topK = config.retrievalTopK
    const vector = svc<ChainVector>(CHAIN_SERVICES.vector)
    if (vector === undefined) {
      trace(TRACE_EVENTS.retrieval, sessionId, turnId, {
        chain: 'retrieval',
        assembled: false,
        status: 'unassembled',
        service: CHAIN_SERVICES.vector,
        reason: '未装配的服务：' + CHAIN_SERVICES.vector + ' —— 该链本回合**未执行**（不是「无命中」）',
      })
      return
    }
    // 候选池由**词法路**打底（唯一可离线获得的名次源）；命中为 0 时把原因分类一并带出
    // —— 「查询太短」与「库里本来没有」必须可分辨（core 的 LexicalRecallResult 就是为此设计的）。
    const lexical = core.recallLexical(query, topK)
    const candidates = lexical.hits.map((hit, index) => ({ key: hit.id, lexicalRank: index + 1 }))
    const outcome = await vector.recall(query, candidates, topK, { sessionId, turnId, requestId })
    const o = outcome as { hitCount?: unknown; channel?: unknown; rankBy?: unknown; degraded?: unknown }
    trace(TRACE_EVENTS.retrieval, sessionId, turnId, {
      chain: 'retrieval',
      assembled: true,
      status: 'ran',
      service: CHAIN_SERVICES.vector,
      query,
      topK,
      candidates: candidates.length,
      lexicalReason: lexical.reason,
      librarySize: lexical.librarySize,
      hitCount: typeof o.hitCount === 'number' ? o.hitCount : null,
      channel: typeof o.channel === 'string' ? o.channel : null,
      rankBy: typeof o.rankBy === 'string' ? o.rankBy : null,
      degraded: o.degraded === true,
      v10Trigger: '用户输入',
    })
  }

  // ── 链 3：再巩固（触发源 = 记忆被检索并注入上下文）────────────────────────
  const onInjection = (payload: unknown): void => {
    if (!config.driverEnabled) return
    const p = payload as { sessionId?: unknown; turnId?: unknown; gate?: unknown; memoryId?: unknown } | undefined
    // 只有**真注入**那一类才开窗：其余四类（skip_* / degraded_unavailable / reset）没有
    // 「一条记忆被检索并注入」这件事，开窗即伪造（见 reconsolidation 的 window 语义）。
    if (p?.gate !== 'injected') return
    const memoryId = typeof p.memoryId === 'string' && p.memoryId !== '' ? p.memoryId : null
    if (memoryId === null) return

    state.injectionsSeen += 1
    const sessionId = typeof p.sessionId === 'string' ? p.sessionId : ''
    const turnId = typeof p.turnId === 'number' && Number.isFinite(p.turnId) ? p.turnId : 0
    const now = Date.now()

    // 共激活流（学习链的输入）：**先入缓冲**，即使再巩固链未装配也照样积累
    // —— 两条链是独立的两件事，一条没装不该让另一条的输入消失。
    activationBuffer.push({ id: memoryId, at: now })
    const budget = Math.max(1, config.learningBufferMax)
    while (activationBuffer.length > budget) {
      activationBuffer.shift()
      bufferDropped += 1
    }

    runChain('reconsolidation', TRACE_EVENTS.reconsolidation, { sessionId, turnId }, CHAIN_SERVICES.reconsolidation, () => {
      const rc = svc<ChainReconsolidation>(CHAIN_SERVICES.reconsolidation) as ChainReconsolidation
      const type = readMemoryType(core, memoryId)
      // 窗长由 type 决定 ⇒ type 缺失时**不猜缺省**（猜出来的窗长会变成一条看似正常的读数）。
      if (type === null) {
        return {
          memoryId,
          action: 'open-window',
          persisted: false,
          reason: '未开窗：memory_items 无此 id 或 type 为空（' + memoryId + '）⇒ 不猜窗长',
          v10Trigger: '记忆被检索',
        }
      }
      const r = rc.openWindow({ memoryId, type, now, trigger: 'scheduler:mana/injection', sessionId, turnId })
      return {
        memoryId,
        memoryType: type,
        action: 'open-window',
        channel: r.channel,
        persisted: r.persisted,
        degraded: r.degraded,
        reason: r.reason,
        v10Trigger: '记忆被检索',
      }
    })
  }
  // ── 链 3/4/5/6 + 覆盖面：回合边界 ─────────────────────────────────────────
  const onTurnBoundary = async (payload: unknown): Promise<void> => {
    if (!config.driverEnabled) return
    const p = payload as { agent?: unknown; turn?: unknown } | undefined
    const sessionId = resolveSessionId(p?.agent) ?? ''
    const turnId = typeof p?.turn === 'number' && Number.isFinite(p.turn) ? p.turn : 0
    const ctxInfo = { sessionId, turnId }
    state.ticks += 1
    state.lastTickAt = new Date().toISOString()

    const cap = Math.max(1, config.maxChainItems)
    /** 一次读库供多条链复用（读侧投影只写一遍，避免两条链对「什么算活记忆」有第二套口径）。 */
    const reading = readLiveItems(core, cap)
    const capped = reading.items.length < reading.liveTotal

    // ── 巩固链 + 目标完成(chunking) ──
    runChain('consolidation', TRACE_EVENTS.consolidation, ctxInfo, CHAIN_SERVICES.consolidation, () => {
      const consolidation = svc<ChainConsolidation>(CHAIN_SERVICES.consolidation) as ChainConsolidation
      const neocortex = reading.items
        .filter((item) => item.type === 'semantic')
        .map((item) => ({ id: item.id, vector: item.vector as ArrayLike<number> | null, content: item.content }))
      const runs = deps.takeRuns()
      const doneGoals = goals.toSerial().filter((node) => node.status === 'done')
      const plan = consolidation.plan({
        periodId: 'turn:' + (sessionId || 'no-session') + ':' + String(turnId),
        items: reading.items,
        neocortex,
        runs,
      })
      const rules = plan.chunking.rules
      // 写了才调 writeRules（0 条时调用只会产生一次空循环）——但 0 **原样进 payload**，
      // 使「没成规则」与「没跑 chunking」可分辨。
      const written =
        rules.length > 0 ? consolidation.writeRules(rules) : { inserted: [], existing: [], failures: [] }
      return {
        liveTotal: reading.liveTotal,
        itemsRead: reading.items.length,
        capped,
        spindleSelected: plan.spindle.selected.length,
        spindleSkipped: plan.spindle.skipped.length,
        // ripple 为 null = 余弦通道不可用（degraded 非空）**不是**「没有可合并的」。
        ripple: plan.ripple === null ? null : plan.ripple.stats,
        rippleDegradedReason: plan.degraded === null ? null : plan.degraded.reason,
        neocortex: neocortex.length,
        runsConsumed: runs.length,
        goalsDone: doneGoals.length,
        chunkSeen: plan.chunking.seen,
        chunkGrouped: plan.chunking.grouped,
        rulesDrafted: rules.length,
        rulesInserted: written.inserted.length,
        rulesExisting: written.existing.length,
        rulesFailed: written.failures.length,
        v10Trigger: '定时任务 / 目标完成',
        substitution: '本仓无定时器 ⇒ 回合边界；chunking 的触发源见 §18.2「目标完成」行',
      }
    })

    // ── 遗忘链 ──
    runChain('forgetting', TRACE_EVENTS.forgetting, ctxInfo, CHAIN_SERVICES.forgetting, () => {
      const forgetting = svc<ChainForgetting>(CHAIN_SERVICES.forgetting) as ChainForgetting
      const snapshots: ActivationSnapshotLike[] = reading.items.map((item) => ({
        memoryId: item.id,
        activation: item.activation,
        retired: false,
      }))
      const candidates = forgetting.forgetting.retireCandidates(snapshots)
      // ⚠ 本驱动者**不写 retired 列**：B4.2 落地的只是「候选清单」这一步。
      //   retirementPlan().unimplemented 原样带出 ⇒ 「只列候选」不会被读成「已归档」。
      const plan = forgetting.forgetting.retirementPlan()
      return {
        liveTotal: reading.liveTotal,
        itemsRead: snapshots.length,
        capped,
        retireCandidates: candidates.length,
        candidateIds: candidates.slice(0, 20).map((c) => c.memoryId),
        retiredWritten: 0,
        unimplemented: plan.unimplemented ?? [],
        v10Trigger: '定时任务',
        substitution: '本仓无定时器 ⇒ 回合边界（与巩固链同一 tick）',
      }
    })

    // ── 再巩固链：关窗（幂等读改；不注册定时器的理由见 reconsolidation/src/windows.ts 文件头）
    runChain('reconsolidation-close', TRACE_EVENTS.reconsolidation, ctxInfo, CHAIN_SERVICES.reconsolidation, () => {
      const rc = svc<ChainReconsolidation>(CHAIN_SERVICES.reconsolidation) as ChainReconsolidation
      const r = rc.closeDueWindows({ now: Date.now(), sessionId, turnId })
      return {
        action: 'close-due-windows',
        channel: r.channel,
        degraded: r.degraded,
        reason: r.reason,
        scanned: r.scanned,
        closed: r.closed.length,
        v10Trigger: '记忆被检索（重新稳定化段）',
      }
    })

    // ── 学习链（Hebbian；FSRS 不移植见 §18.2「检索命中」行的 not-ported）──
    const events = activationBuffer.map((e) => ({ id: e.id, at: e.at }))
    const drainedCount = events.length
    // **消费式**清空 ⇒ 同一段激活流不会被下一步再算一遍（重复计权 = 假读数）。
    activationBuffer = []
    runChain('learning', TRACE_EVENTS.learning, ctxInfo, CHAIN_SERVICES.learning, () => {
      const learning = svc<ChainLearning>(CHAIN_SERVICES.learning) as ChainLearning
      const outcome = learning.store.applyCoActivations(core.db, events, {
        core,
        at: new Date().toISOString(),
      })
      return {
        eventsSeen: outcome.eventsSeen,
        occasions: outcome.occasions,
        pairs: outcome.pairs.length,
        rowsWritten: outcome.rowsWritten,
        degraded: outcome.degraded,
        reason: outcome.reason,
        gate: outcome.gate,
        droppedEvents: outcome.droppedEvents.length,
        drained: drainedCount,
        v10Trigger: '目标完成（chunking 段）/ 记忆被检索（关联段）',
        notPorted: '检索命中 → 间隔重复（FSRS）不移植（C16）',
      }
    })

    // ── 覆盖面：§18.2 七行的**当下**状态（含 not-driven / not-ported 的行）──
    // 每 tick 一行：不落行的话，「某行从未被驱动」在库里与「驱动者没跑」同形。
    const rows = coverage()
    trace(TRACE_EVENTS.coverage, sessionId, turnId, {
      chain: 'coverage',
      assembled: rows.every((r) => r.status !== 'unassembled'),
      status: 'ran',
      rows: rows.map((r) => ({ id: r.id, status: r.status, hostTrigger: r.hostTrigger, reason: r.reason })),
      counts: {
        driven: rows.filter((r) => r.status === 'driven').length,
        unassembled: rows.filter((r) => r.status === 'unassembled').length,
        notDriven: rows.filter((r) => r.status === 'not-driven').length,
        notPorted: rows.filter((r) => r.status === 'not-ported').length,
      },
      runCalls: deps.runCalls(),
      driverTicks: state.ticks,
    })
  }

  const readings = (): DriverReadings => ({
    enabled: config.driverEnabled,
    ticks: state.ticks,
    lastTickAt: state.lastTickAt,
    userMessagesSeen: state.userMessagesSeen,
    injectionsSeen: state.injectionsSeen,
    bufferSize: activationBuffer.length,
    bufferDropped,
    runsRecorded: deps.runCalls(),
    errors: state.errors,
  })

  return { onUserMessage, onInjection, onTurnBoundary, coverage, readings }
}
