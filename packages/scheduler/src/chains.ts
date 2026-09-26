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
 * ── 蒸馏链（v10 §12.3 · E1 通电）为什么**必须**挂在本文件，而不是挂在 consolidation ────────
 *   §12.3 的第一步是「**空闲 10 分钟**」，而 `packages/consolidation/src/distill.ts` 的文件头
 *   明写「**不注册监听器、不起定时器**：触发源归 scheduler；空闲判定由**调用方传入 idleMs**
 *   （"谁喂这个数"是接线问题，不是本文件的事）」。⇒ 那条链在交付时**有链无触发者** ——
 *   与它自己要修的缺陷（`prefilterBySignalWords` 零消费方）是**同一形态**。
 *
 *   本文件因此新增一条**蒸馏链**，口径逐条如下（每一条都是可分辨的读数，不是注释承诺）：
 *   · **触发源 = 真空闲**：本驱动者按会话维护「最近活动时刻」，活动 = 用户输入 或 回合边界。
 *     ⚠ 不取「距上次回合边界多久」：那是**回合间隔**，会话可能在中途一直有输入（见
 *     `lastActivityAt` 的注释与它的已知偏差）。
 *   · **阈值两处**：触发侧 `DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS`（本文件）与链内
 *     `DISTILL_IDLE_THRESHOLD_MS`（consolidation）。两处**不相邻**（本包不 import 该包），
 *     故两个数**都**进 trace payload（`thresholdMs`/`chainThresholdMs`）⇒ 漂开即**可读**，
 *     判据 `tests/distill-wiring.test.mjs` ① 钉住两者相等。
 *   · **未到点也照写行**（与 `generation/skipped` 同一条既有口径）：`phase='skipped'` +
 *     `status='not-idle'` + idleMs 读数。不写的话，「没到点」与「压根没接」**同形**。
 *   · **先 dispatched 再 settle**：蒸馏走一次真 LLM 往返 ⇒ 与生成链同款**异步收敛**，
 *     两行同 trigger 可配对，「发起了没回来」与「压根没发起」因此可分辨。
 *   · **本驱动者不做蒸馏判定**：白名单门/粒度判定/写回**全部**在 distillation 侧
 *     （经 `distillProduce` 服务面），本包只负责**何时发起**与**如实记账**。
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
  /**
   * **生成链（§13.5 深睡归纳）**：回合边界 ⇒ `consolidation.summarize`（消费 mana-prompts + mana-llm）。
   *
   * ⚠ 与上面六条链**分开一条事件名**是刻意的：生成链的第一消费者若混在 `consolidation` 行里，
   *   「巩固判定跑没跑」与「生成调没调」就同形 —— 而这次要修的正是「生成零消费者**看不出来**」。
   */
  generation: `${DRIVER_NAMESPACE}/generation`,
  /**
   * **蒸馏链（v10 §12.3）**：真空闲（≥10 分钟无活动）⇒ `consolidation.distillProduce`
   * （经 mana-consolidation 的服务面，**本包不 import** 该链的实现）。
   *
   * ⚠ 与 `generation` 分开一条事件名是同一条理由：蒸馏与深睡归纳是**两条不同的链**
   *   （触发源、材料、写回落点都不同）。混在一行里，「蒸馏跑了」与「归纳跑了」不可分辨。
   */
  distillation: `${DRIVER_NAMESPACE}/distillation`,
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

// ── 蒸馏链（v10 §12.3）的运行期结构接口 ───────────────────────────────────────
/**
 * 触发侧的**真空闲阈值缺省**（毫秒）= 「空闲 10 分钟」。
 *
 * ⚠ 这个数与 `packages/consolidation/src/distill.ts` 的 `DISTILL_IDLE_THRESHOLD_MS` 是
 *   **同一口径的两处落点**（本包不 import 该包 ⇒ 无法共享常量）。既有教训（`idleMs` 的
 *   8 处 `|| 10800000` 兜底）是「同一数值散落多处、其中大半年没生效」。故这里不靠注释承诺
 *   一致，而靠：
 *     ① 本数经 `DriverConfig.distillIdleThresholdMs` 的缺省**只出现一次**（index.ts 引本常量）；
 *     ② 每一行 trace 同时带 `thresholdMs`（本数）与 `chainThresholdMs`（链回报的数）⇒ 漂开可读；
 *     ③ `tests/distill-wiring.test.mjs` ① 直接断言两者相等。
 */
export const DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS = 10 * 60 * 1000

/**
 * 蒸馏链四个装配层参数的**缺省值唯一出处**（本文件持有；生产生效值就是这一份）。
 *
 * ⚠ 缺省为什么在这里而不是 `index.ts` 的 Config/schema：接线边界（见 `DriverConfig` 里那段）。
 *   代价照实写：**生产装配下这四项不可从 profile 配置调整**（缺省即生效值）。
 * ⚠ 若将来要把它们接进 Config，**必须**把缺省改成引本常量（而不是再写一遍字面量）——
 *   同一数值散落多处正是本仓 `idleMs` 那 8 处兜底的教训。
 */
export const DISTILL_DEFAULTS = Object.freeze({
  distillationEnabled: true,
  distillIdleThresholdMs: DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS,
  distillCandidatesMax: 64,
  distillationSessionsMax: 64,
})

/** 解析后的四个旋钮（内部使用；外部只见 Reading）。 */
interface ResolvedDistillConfig {
  readonly distillationEnabled: boolean
  readonly distillIdleThresholdMs: number
  readonly distillCandidatesMax: number
  readonly distillationSessionsMax: number
}

/** 把可选旋钮折成确定值（缺省取 `DISTILL_DEFAULTS`）。 */
export function resolveDistillConfig(config: Pick<DriverConfig, 'distillationEnabled' | 'distillIdleThresholdMs' | 'distillCandidatesMax' | 'distillationSessionsMax'>): ResolvedDistillConfig {
  return {
    distillationEnabled: config.distillationEnabled ?? DISTILL_DEFAULTS.distillationEnabled,
    distillIdleThresholdMs: config.distillIdleThresholdMs ?? DISTILL_DEFAULTS.distillIdleThresholdMs,
    distillCandidatesMax: config.distillCandidatesMax ?? DISTILL_DEFAULTS.distillCandidatesMax,
    distillationSessionsMax: config.distillationSessionsMax ?? DISTILL_DEFAULTS.distillationSessionsMax,
  }
}

/** 一次蒸馏请求（结构面；实现归 `packages/consolidation/src/distill.ts`，本包不 import）。 */
export interface ChainDistillRequest {
  readonly sessionId: string
  /** 本会话的空闲毫秒数（**由本驱动者测**：链内不起定时器，见 distill.ts 文件头）。 */
  readonly idleMs: number
  /** 待蒸馏候选（本驱动者从会话自己的 trace 里取，见 `gatherDistillCandidates`）。 */
  readonly candidates: readonly string[]
}

/**
 * 蒸馏链的**回报读数**（结构面 —— 只声明本驱动者真正读的那几个字段）。
 *
 * ⚠ 这几个读数**全部**原样进 trace payload：蒸馏的六种终态各有名字，本驱动者不重判、
 *   也不把它们折成"成功/失败"两档（折了就等于把"没到点""预筛挡了""真判了"同形）。
 * ⚠ `writeEnabled` / `inserted` / `writeError` **必须分列**：「没写」有三种真因
 *   （没开写面 / 被门挡了 / 写失败），只有分列才可分辨。
 */
export interface ChainDistillOutcome {
  readonly state: string
  readonly reason: string
  readonly llmCalls: number
  readonly llmDegraded: string | null
  readonly writeEnabled: boolean
  readonly inserted: readonly string[]
  readonly idempotentSkips: number
  readonly candidates: number
  /** 预筛读数（`ran/scanned/hit/miss/empty/table`）—— 「筛了但全 miss」与「压根没筛」靠它分列。 */
  readonly prefilter: {
    readonly ran: boolean
    readonly scanned: number
    readonly hit: number
    readonly miss: number
    readonly empty: number
    readonly table: string | null
  }
  /** 链内实际用的空闲阈值（与本文件的触发阈值**两处**，见 DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS）。 */
  readonly thresholdMs: number | null
  /** 判定逐条读数（`vetoedBy` 分布是本驱动者读得到的最细一层；不重算）。 */
  readonly vetoedBy: readonly (string | null)[]
  /**
   * 编码侧码判（§12.3 的**第二道门**）真跑了几条。
   *
   * ⚠ **0 不等于"通过了"**：它可能是没接线（`long-term` 未装配/产物缺失）。这个区别由
   *   链内读数承载（`DistillDecision.codeGate.ran`），本驱动者只**如实回显条数**，
   *   不把它折成布尔 —— 折了就分不出「没判」与「判过没通过」（本仓两道门的核心纪律）。
   */
  readonly codeGateRan: number
  /** 写失败的**真因**（成功/未尝试写时为 null；不得用空串冒充）。 */
  readonly writeErrors: readonly string[]
}

/**
 * 蒸馏的**生产可达入口**（由 `mana-consolidation` 服务提供）。
 *
 * ⚠ 为什么经服务面而不是 `import`：本仓跨包连接一律走「事件 + 服务」，全仓跨包 import
 *   只有 core 一处。本包**不 import** consolidation ⇒ 接口漂移编译期抓不到，只能靠
 *   端到端判据抓（与 `ChainConsolidation`/`ChainSummary` 同一条既有取舍，代价照实写）。
 */
export interface ChainDistillation {
  distillProduce(request: ChainDistillRequest): Promise<ChainDistillOutcome>
}

/**
 * 从会话自己的 trace 里取蒸馏候选（v10 §12.3 第 ② 步的**输入面**）。
 *
 * ⚠ 为什么读 `mana_trace` 而不是「会话痕迹文件」：收割归守藏适配层的面，而该包已被裁定
 *   **不落地**（触碰「不动 shoucang」）⇒ `distillSession` 的候选由**调用方喂入**。本驱动者在
 *   本仓能找到、且与会话同源的材料只有 `mana_trace`。
 * ⚠ **只取用户侧文本**（`event_type IN ('observation','attention')` 且 payload 无
 *   `gate` 的行）：
 *   · 不含 `mana-scheduler/chain/*` —— 那些是本驱动者自己的记账行，喂回去就是自产自食；
 *   · 不含 `injection` 行 —— 注入块是**记忆库自己的内容**，再蒸馏一遍会把已有记忆
 *     当成"新产出"重新写回（回音室）；
 *   · 也不含 `decision`/`recall`（判定读数，不是会话内容）。
 *   这两条排除不靠"模型会自己判断"，而是**查询条件**（结构性）。
 * ⚠ 读不到会话内容（含 payload 解析失败）⇒ 如实进 `skipped` 的 `reason`，**不静默凑数**。
 */
export function gatherDistillCandidates(
  core: ManaCoreService,
  sessionId: string,
  limit: number,
): { readonly candidates: readonly string[]; readonly seen: number; readonly capped: boolean; readonly reason: string | null } {
  const cap = Math.max(1, Math.floor(limit))
  if (sessionId === '') {
    return { candidates: [], seen: 0, capped: false, reason: 'no-session-identity：agent 上取不到 sessionId / session.id ⇒ 不落虚构分区' }
  }
  const rows = core.db
    .prepare(
      "SELECT payload FROM mana_trace WHERE session_id = ? AND event_type IN ('observation', 'attention')" +
        ' ORDER BY seq ASC LIMIT ?',
    )
    .all(sessionId, cap + 1) as unknown as { payload: string | null }[]
  const contents: string[] = []
  let unreadable = 0
  for (const row of rows.slice(0, cap)) {
    let parsed: { content?: unknown } | null = null
    try {
      parsed = JSON.parse(row.payload ?? 'null') as { content?: unknown } | null
    } catch {
      // 解析失败**不得**被读成"该行没有内容"：分开计数，最后进 reason。
      parsed = null
    }
    const content = parsed === null ? undefined : parsed.content
    if (typeof content === 'string' && content.trim() !== '') contents.push(content)
    else unreadable += 1
  }
  const reason =
    contents.length === 0
      ? '本会话在 mana_trace 里没有可蒸馏的用户侧内容（扫描 ' + String(rows.length) + ' 行，取不到内容 ' + String(unreadable) + ' 行）'
      : unreadable > 0
        ? '有 ' + String(unreadable) + ' 行 trace 的内容取不到（payload 缺失或解析失败）—— 已跳过，未拿别的行冒充'
        : null
  return { candidates: contents, seen: rows.length, capped: rows.length > cap, reason }
}

// ── §18.2 触发时机表（**唯一口径表**，逐行对齐 v10 原文）──────────────────────
/**
 * 每一行的 `hostTrigger === null` 都必须带非空 `reason` —— 那是「本行没有可接的宿主事件面」
 * 的**机检面**，不是留白。表格以外的触发源**不自行发明**。
 */
export interface SevenChainRow {
  readonly id: string
  /** §18.2 原文的「触发源」列。 */
  readonly v10Trigger: string
  /** 「触发链条」列（§18.2 原文口径；**恒非空**）。 */
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

/**
 * **蒸馏链的触发声明（v10 §12.3）** —— 与 `SEVEN_CHAIN_TABLE` **同一行形状**，但**不并进它**。
 *
 * ⚠ 为什么不并进那张表（这条是实测抓出来的，不是口味问题）：`SEVEN_CHAIN_TABLE` 是
 *   **§18.2「七链条触发时机」的唯一口径表**，既有判据（`tests/chains-e2e.test.mjs` T10）
 *   逐条钉死它「恰好七行 + id 与顺序逐字」；而 §12.3 的会话蒸馏**不属那七行**
 *   （v10 里它由 §12.3 自己规定触发，§18.2 表内没有它）。并进去 = 篡改那张表的口径，
 *   并会让 T10 变红 —— 那是**拆东墙补西墙**（把既有判据的语义弄坏来给自己的改动腾位置）。
 *   ⇒ 本行独立声明：形状同源（`SevenChainRow`），字段逐条齐（`v10Trigger`/`hostTrigger`/
 *   `substitution`/`requires`），但**不改**七行表、**不进** `coverage()`（后者是 §18.2 的行覆盖面）。
 *   ⇒ 这条链的运行态因此有**它自己的**读数（trace 的 `mana-scheduler/chain/distillation` 行
 *   + `readings().distillation*`），不冒充覆盖率行。
 */
export const DISTILL_CHAIN_ROW: SevenChainRow = Object.freeze({
  id: 'idle-distillation',
  /** v10 §12.3 原文第一步，**逐字**。 */
  v10Trigger: '空闲 10 分钟',
  v10Chains: ['会话蒸馏'],
  /**
   * ⚠ **替代，不是 v10 原文**：§12.3 的触发源是「空闲 10 分钟」（实时钟），本仓无定时器
   *   ⇒ 由回合边界**顺带检查真空闲**（本驱动者按会话维护最近活动时刻）。
   *   与七行表里 `scheduled` 行的差别：那一行每回合都跑，本行**只在真空闲时才发起**。
   */
  hostTrigger: 'agent/turn-stopping',
  substitution:
    '本仓无定时器 ⇒ 回合边界顺带检查「真空闲」（按会话的最近活动时刻；阈值见 DISTILL_TRIGGER_DEFAULT_THRESHOLD_MS）',
  requires: [CHAIN_SERVICES.consolidation],
})

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

/**
 * 巩固包的**生成通道**面（§13.5 深睡归纳；结构接口，不 import 该包）。
 *
 * ⚠ `summarize` **不抛**、返回三态 —— 调用方必须把 `ok:false` 的 `degraded`/`reason` 落 trace。
 *   本驱动者据此把「通道没装配」与「上游生成失败」与「素材为空」**分成三种可读事实**。
 */
export interface ChainSummary {
  summarize(request: { readonly material: string }): Promise<
    | {
        readonly ok: true
        readonly summary: string
        readonly callId: string
        readonly promptSection: string
        readonly materialChars: number
      }
    | {
        readonly ok: false
        readonly summary: null
        readonly callId: string | null
        readonly degraded: string
        readonly reason: string
        readonly materialChars: number
      }
  >
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
  /**
   * 生成链（§13.5 深睡归纳）是否发起。
   *
   * ⚠ 关掉 ≠ 静默：每回合仍落一行 `generation/skipped`（带非空 reason），
   *   使「开关关着」与「链没跑」在库里**可分辨**（本仓「假旋钮」纪律：
   *   旋钮必须改变可观测行为，而"关掉后什么行都没有"会让两者同形）。
   */
  readonly generationEnabled: boolean
  /** 送给生成链的素材上限（字符）；超出按此截断并**原样**把实际长度写进 payload。 */
  readonly generationMaterialMaxChars: number
  // ── 蒸馏链（v10 §12.3）的四个**装配层**参数 ───────────────────────────────────
  /**
   * ⚠ **四个都是可选，且生产装配（`index.ts`）不转发它们** —— 这是**接线边界**，不是疏漏：
   *   本卡写面只有 chains.ts，而把必填项加进来会强制改动 `index.ts` 的 Config/schema。
   *   ⇒ 生效值由本文件的 `DISTILL_DEFAULTS` **唯一持有**（缺省即生产生效值），
   *     它们的作用域是**装配层**：让判据能把阈值/上界设成边界值来跑腿（见 ⑥/⑤）。
   * ⚠ **不是假旋钮**：每一项都改变可观测行为（⑥ 逐项证明）；但**也不能当作"生产可调项"** ——
   *   在 profile 配置里写它们**不会**生效。这条边界由 `distill-wiring.test.mjs` ⑥ 显式断言，
   *   使「以为能调」变成**可读的事实**而不是静默陷阱（本仓对"两处真源"的老教训）。
   */
  /** 蒸馏链是否发起。缺省 true。关掉**不是静默**（仍落 skipped 行 + 非空 reason）。 */
  readonly distillationEnabled?: boolean
  /** 蒸馏触发侧的真空闲阈值（毫秒）。缺省 = §12.3 原文的 10 分钟。 */
  readonly distillIdleThresholdMs?: number
  /** 每次蒸馏最多送几条候选（有界：无界会让「读满」与「被夹」同形）。 */
  readonly distillCandidatesMax?: number
  /** 记住多少会话的最近活动时刻（有界；超出按最久未活动逐出且丢弃可数）。 */
  readonly distillationSessionsMax?: number
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
  /**
   * 蒸馏链（v10 §12.3）的**累计读数**。
   *
   * ⚠ 「发起了几次」与「真判了几次」**分列**：扫描了但没到空闲阈值的那一轮只增
   *   `distillationScanned` 不增 `distillationDispatched` —— 把它们合成一个计数，
   *   「链在跑但一直没到点」与「链压根没接」就同形了（本仓首位缺陷类）。
   */
  readonly distillationScanned: number
  readonly distillationDispatched: number
  /** 走完链（回报落库）的次数 —— 含被白名单/粒度挡下的，不只是写入成功的那几次。 */
  readonly distillationSettled: number
  /** 蒸馏链自身抛错的次数（照写 `chain/error` 行；不算进别的链的 `errors` 会漏账）。 */
  readonly distillationErrors: number
  /** 当前记住了几个会话的最近活动时刻（有界，见 `distillationSessionsMax`）。 */
  readonly distillationSessions: number
  /** 因超上界被逐出的会话数（**丢弃可数**，同 `bufferDropped`）。 */
  readonly distillationSessionsDropped: number
  /** 最近一次蒸馏的回报（无 = null；**不折成"全 0"**，那会让"没跑过"看起来像"跑了没产出"）。 */
  readonly lastDistillation: {
    readonly sessionId: string
    readonly idleMs: number
    readonly at: string
    readonly outcome: ChainDistillOutcome
  } | null
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
  /**
   * 蒸馏链的四个旋钮在此**折成确定值**（缺省归 `DISTILL_DEFAULTS`）。
   * ⚠ 名字沿用 `config.distill*` 的写法，故下面**全部**读经这份解析结果 —— 任何一处直接读
   *   `config.distillationEnabled` 都会在"未传"时得到 `undefined`（假绿温床）。
   */
  const distillCfg = resolveDistillConfig(config)

  /** 共激活激活流（有界；消费式清空）。 */
  let activationBuffer: { id: string; at: number }[] = []
  let bufferDropped = 0
  const state = {
    ticks: 0,
    lastTickAt: null as string | null,
    userMessagesSeen: 0,
    injectionsSeen: 0,
    errors: 0,
    distillScanned: 0,
    distillDispatched: 0,
    distillSettled: 0,
    distillErrors: 0,
    distillSessionsDropped: 0,
    lastDistillation: null as {
      sessionId: string
      idleMs: number
      at: string
      outcome: ChainDistillOutcome
    } | null,
  }

  /**
   * 每个会话的**最近活动时刻**（v10 §12.3 的「空闲」口径）。
   *
   * ⚠ **已知偏差，照实写而不是假装精确**：「活动」= 本驱动者收到该会话的**用户输入**或
   *   **回合边界**。⇒ 会话在两次输入之间**连续跑工具、跑子会话**（都发生在回合内部）时，
   *   本驱动者看不到其中间活动，计出的空闲会**偏大**。
   *   为什么不用「距上次回合边界多久」：那是**回合间隔**（本轮结束时上一轮已结束多久），
   *   会话中途一直有输入时它会**一直增长**，用它就等于「按回合间隔蒸馏」——不是 §12.3 的口径。
   *   要更准得知道「本会话最近一次任何活动」，宿主没给这个面（`agent/status` 是 idle⇄running
   *   两态、无时刻；`turn-stopping` 之前的所有步骤无事件面）⇒ 停在可归因的这一档。
   */
  const lastActivityAt = new Map<string, number>()

  /** 记一次会话活动（有界：超出按**最久未活动**逐出，丢弃数可数 —— 同 learningBufferMax 的纪律）。 */
  const noteActivity = (sessionId: string, at: number): void => {
    lastActivityAt.set(sessionId, at)
    const budget = Math.max(1, distillCfg.distillationSessionsMax)
    while (lastActivityAt.size > budget) {
      let oldestKey: string | null = null
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [key, value] of lastActivityAt) {
        if (value < oldestAt) {
          oldestAt = value
          oldestKey = key
        }
      }
      if (oldestKey === null) break
      lastActivityAt.delete(oldestKey)
      state.distillSessionsDropped += 1
    }
  }

  /**
   * ⚠ 编码侧码判（§12.3 的第二道门）**不在这里解析**：它是 `long-term` 的判据面，属
   *   **蒸馏链自己的依赖**，由 `mana-consolidation` 的 `distillProduce` 现解析（该包已有
   *   「对 long-term 走 `import.meta.resolve` + 可选依赖」的既有取舍，见其文件头「册:509」）。
   *   本驱动者**不引入第二条跨包解析边**（本文件头的硬约束①：跨包连接一律走事件 + 服务），
   *   只如实回显链回报的 `codeGateRan` 条数。
   */

  /**
   * **蒸馏链的收敛段**（v10 §12.3）—— 与 `runGeneration` 同一形态：先落 `dispatched`，
   * 再 await，再落 `settled`/`failed`。两行同 `trigger` 可配对 ⇒「发起了但没回来」与
   * 「压根没发起」**可分辨**（只有一行时这两件事同形）。
   *
   * ⚠ **本函数不做任何蒸馏判定**：白名单门/粒度判定/写回全在 distillation 侧。
   *   本驱动者只决定**何时发起**、并把回报的读数**原样**落库。
   */
  const runDistillation = async (
    ctxInfo: { sessionId: string; turnId: number },
    request: ChainDistillRequest,
  ): Promise<void> => {
    const chain = 'distillation'
    const trigger = 'turn:' + (ctxInfo.sessionId || 'no-session') + ':' + String(ctxInfo.turnId)
    const distillation = svc<ChainDistillation>(CHAIN_SERVICES.consolidation)
    if (distillation === undefined || typeof distillation.distillProduce !== 'function') {
      trace(TRACE_EVENTS.distillation, ctxInfo.sessionId, ctxInfo.turnId, {
        chain,
        phase: 'skipped',
        trigger,
        assembled: false,
        status: 'unassembled',
        service: CHAIN_SERVICES.consolidation,
        reason:
          '未装配的服务或该服务无 distillProduce 面：' + CHAIN_SERVICES.consolidation +
          ' —— 蒸馏链本回合**未发起**（不是「没有可蒸馏的」）',
        idleMs: request.idleMs,
        candidates: request.candidates.length,
        v10Trigger: '空闲 10 分钟',
      })
      return
    }
    state.distillDispatched += 1
    trace(TRACE_EVENTS.distillation, ctxInfo.sessionId, ctxInfo.turnId, {
      chain,
      phase: 'dispatched',
      trigger,
      assembled: true,
      status: 'pending',
      service: CHAIN_SERVICES.consolidation,
      idleMs: request.idleMs,
      thresholdMs: distillCfg.distillIdleThresholdMs,
      candidates: request.candidates.length,
      v10Trigger: '空闲 10 分钟',
      substitution: '本仓无定时器 ⇒ 回合边界顺带检查真空闲',
      source: 'mana-consolidation:distillSession',
    })

    let outcome: ChainDistillOutcome
    try {
      outcome = await distillation.distillProduce(request)
    } catch (error) {
      // 蒸馏链**刻意不吞预筛自身抛的错**（见 distill.ts 的「唯一例外」）⇒ 这里必须接住并
      // 记一行，否则它就成了一个无人读的 unhandledRejection（本仓对该形态有实测教训）。
      state.distillErrors += 1
      trace(TRACE_EVENTS.error, ctxInfo.sessionId, ctxInfo.turnId, {
        chain,
        phase: 'failed',
        trigger,
        message: String((error as Error)?.message ?? error),
        idleMs: request.idleMs,
        v10Trigger: '空闲 10 分钟',
      })
      return
    }
    state.distillSettled += 1
    state.lastDistillation = {
      sessionId: ctxInfo.sessionId,
      idleMs: request.idleMs,
      at: new Date().toISOString(),
      outcome,
    }
    trace(TRACE_EVENTS.distillation, ctxInfo.sessionId, ctxInfo.turnId, {
      chain,
      phase: 'settled',
      trigger,
      assembled: true,
      status: 'ran',
      service: CHAIN_SERVICES.consolidation,
      // ── 六个终态各有名字，**原样**回显（本驱动者不折成"成功/失败"两档）──
      state: outcome.state,
      reason: outcome.reason,
      idleMs: request.idleMs,
      // ⚠ 触发侧阈值与链内阈值**并列**：两者相邻出现，漂开一眼可读（见 DISTILL_TRIGGER_*）。
      thresholdMs: distillCfg.distillIdleThresholdMs,
      chainThresholdMs: outcome.thresholdMs,
      // ── 「零 LLM 成本」的可数落点：预筛未命中 ⇒ llmCalls 恒为 0 ──
      llmCalls: outcome.llmCalls,
      llmDegraded: outcome.llmDegraded,
      prefilterRan: outcome.prefilter.ran,
      prefilterScanned: outcome.prefilter.scanned,
      prefilterHit: outcome.prefilter.hit,
      prefilterMiss: outcome.prefilter.miss,
      prefilterEmpty: outcome.prefilter.empty,
      prefilterTable: outcome.prefilter.table,
      admitted: outcome.candidates,
      // ── 「没写」的三种真因**分列**（没开写面 / 被门挡了 / 写失败）──
      writeEnabled: outcome.writeEnabled,
      inserted: outcome.inserted.length,
      insertedIds: outcome.inserted.slice(0, 20),
      idempotentSkips: outcome.idempotentSkips,
      vetoedBy: outcome.vetoedBy,
      writeErrors: outcome.writeErrors,
      // 第二道门真跑了几条（0 ≠ 通过 —— 见 ChainDistillOutcome.codeGateRan 的注释）。
      codeGateRan: outcome.codeGateRan,
      candidates: request.candidates.length,
      v10Trigger: '空闲 10 分钟',
      substitution: '本仓无定时器 ⇒ 回合边界顺带检查真空闲',
    })
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
    /**
     * ⚠ **空闲计时的打点在"是不是用户输入"之前**：这条事件叫 `inbox/inserted`，插入的
     *   就是**输入** —— 非文本用户消息（图片/文件块）也是活动，凭 `text === null` 提前返回
     *   会让会话一直在说话、而驱动者以为它空闲了 10 分钟。
     */
    const activitySession = resolveSessionId(p?.agent)
    if (activitySession !== undefined) noteActivity(activitySession, Date.now())
    // 非用户消息不是编码/检索链的触发源 ⇒ 不落行（落行会让 trace 被每一条内部消息淹没）。
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
  /**
   * 生成链的**异步**收敛段（§13.5 深睡归纳）。
   *
   * ⚠ 为什么必须是异步：`consolidation.summarize` 会真的走一次 LLM 往返。本驱动者的
   *   `onTurnBoundary` 由宿主 `await`（serial 型事件）⇒ **不能**在这里阻塞整条回合边界
   *   （那会把宿主卡在一次网络调用上）。故**先落一行 dispatched，再去 resolve**：
   *   两行同 `trigger` 可配对，「发起了但没回来」与「压根没发起」因此**可分辨**
   *   （只有一行时这两件事同形 —— 本仓最防的失败不可观测）。
   */
  const runGeneration = async (ctxInfo: { sessionId: string; turnId: number }, material: string): Promise<void> => {
    const chars = [...material].length
    if (!config.generationEnabled) {
      trace(TRACE_EVENTS.generation, ctxInfo.sessionId, ctxInfo.turnId, {
        chain: 'generation',
        phase: 'skipped',
        assembled: svc<unknown>(CHAIN_SERVICES.consolidation) !== undefined,
        status: 'disabled',
        reason: 'generationEnabled=false ⇒ 本回合**未发起**生成（这是开关事实，不是「没有可归纳的」）',
        materialChars: chars,
        v10Trigger: '定时任务（深睡段）',
        substitution: '本仓无定时器 ⇒ 回合边界',
      })
      return
    }
    const consolidation = svc<ChainSummary>(CHAIN_SERVICES.consolidation)
    if (consolidation === undefined || typeof consolidation.summarize !== 'function') {
      trace(TRACE_EVENTS.generation, ctxInfo.sessionId, ctxInfo.turnId, {
        chain: 'generation',
        phase: 'dispatched',
        assembled: false,
        status: 'unassembled',
        service: CHAIN_SERVICES.consolidation,
        reason:
          '未装配的服务或该服务无 summarize 面：' + CHAIN_SERVICES.consolidation +
          ' —— 生成链本回合**未执行**（不是「生成结果为空」）',
        materialChars: chars,
        v10Trigger: '定时任务（深睡段）',
      })
      return
    }
    // 先落 dispatched：它是「已发起」的**唯一**证据。缺了它，下面的 failed 行无法与
    // 「根本没发起」区分 —— 两者都只剩一条 failed 行时，读者无从判断。
    trace(TRACE_EVENTS.generation, ctxInfo.sessionId, ctxInfo.turnId, {
      chain: 'generation',
      phase: 'dispatched',
      assembled: true,
      status: 'pending',
      service: CHAIN_SERVICES.consolidation,
      materialChars: chars,
      v10Trigger: '定时任务（深睡段）',
      substitution: '本仓无定时器 ⇒ 回合边界',
      source: 'mana-prompts:§13.5 + mana-llm',
    })

    let outcome: Awaited<ReturnType<ChainSummary['summarize']>>
    try {
      outcome = await consolidation.summarize({ material })
    } catch (error) {
      // summarize 自身承诺不抛；真抛了说明契约被打破 —— 显式记账，不许让它变成一个
      // 无人读的 unhandledRejection（本仓对该形态有实测教训）。
      trace(TRACE_EVENTS.generation, ctxInfo.sessionId, ctxInfo.turnId, {
        chain: 'generation',
        phase: 'failed',
        assembled: true,
        status: 'threw',
        service: CHAIN_SERVICES.consolidation,
        reason: 'summarize 违约抛错（契约要求返回三态而不抛）：' + String((error as Error)?.message ?? error),
        materialChars: chars,
      })
      return
    }
    if (!outcome.ok) {
      trace(TRACE_EVENTS.generation, ctxInfo.sessionId, ctxInfo.turnId, {
        chain: 'generation',
        phase: 'failed',
        assembled: true,
        status: 'degraded',
        service: CHAIN_SERVICES.consolidation,
        degraded: outcome.degraded,
        reason: outcome.reason,
        callId: outcome.callId,
        materialChars: outcome.materialChars,
        v10Trigger: '定时任务（深睡段）',
      })
      return
    }
    // ⚠ 成功但**产出为空串**是第三种事实：不折成 failed（那会把「上游返回空」误报成「通道坏了」）。
    //   故 summaryChars 一律进 payload，判据读它而不是只读 status。
    trace(TRACE_EVENTS.generation, ctxInfo.sessionId, ctxInfo.turnId, {
      chain: 'generation',
      phase: 'settled',
      assembled: true,
      status: 'ran',
      service: CHAIN_SERVICES.consolidation,
      callId: outcome.callId,
      promptSection: outcome.promptSection,
      materialChars: outcome.materialChars,
      summaryChars: [...outcome.summary].length,
      v10Trigger: '定时任务（深睡段）',
      substitution: '本仓无定时器 ⇒ 回合边界；system prompt 来自 mana-prompts:§13.5',
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

    /**
     * ── 蒸馏链（v10 §12.3）触发判定：**真空闲**才发起 ──────────────────────────────
     *
     * ⚠ 顺序**刻意在写"本回合还在干活"的链之前判**：`turn-stopping` 是 serial 型且此时
     *   监听器按注册序依次跑，若本行写在下面那几条链之后，"空闲"就会把**同一轮**刚发生的
     *   活动算进去（那些链本身不改活动时刻，但先后关系写清楚才不会被下一轮误读）。
     * ⚠ **未到点/会话身份缺失/没材料/开关关着都照写行**（`phase='skipped'` + 非空 reason）——
     *   静默返回会让「没到点」与「压根没接」同形（本仓首位缺陷类）。
     * ⚠ **每个 skip 分支给自己的 `status`**（`disabled` / `no-session-identity` / `untracked` /
     *   `not-idle` / `no-candidates`），**不是在落行处硬写一个状态**：硬写会让「开关关着」
     *   与「没到点」在库里同形 —— 判据 `distill-wiring.test.mjs` ⑥ 就是被这条抓出来的（实测）。
     */
    const distillAction = ((): { readonly request: ChainDistillRequest | null; readonly skip: Record<string, unknown> | null } => {
      if (!distillCfg.distillationEnabled) {
        return {
          request: null,
          skip: {
            status: 'disabled',
            reason: 'distillationEnabled=false ⇒ 本回合**未发起**蒸馏（这是开关事实，不是「没有可蒸馏的」）',
            idleMs: null,
          },
        }
      }
      if (sessionId === '') {
        return {
          request: null,
          skip: {
            status: 'no-session-identity',
            reason: 'no-session-identity：agent 上取不到 sessionId / session.id ⇒ 不落虚构分区、不计空闲',
            idleMs: null,
          },
        }
      }
      const lastAt = lastActivityAt.get(sessionId)
      if (lastAt === undefined) {
        return {
          request: null,
          skip: {
            status: 'untracked',
            reason: '本会话尚无活动打点（用户输入或往期回合边界）⇒ 空闲时长**不可测**，不猜一个数',
            idleMs: null,
          },
        }
      }
      const idleMs = Math.max(0, Date.now() - lastAt)
      if (idleMs < distillCfg.distillIdleThresholdMs) {
        return {
          request: null,
          skip: {
            status: 'not-idle',
            reason:
              '空闲 ' + String(idleMs) + 'ms < 阈值 ' + String(distillCfg.distillIdleThresholdMs) +
              'ms ⇒ 本次**未触发**（这不是「跑了但没东西可蒸馏」）',
            idleMs,
          },
        }
      }
      const gathered = gatherDistillCandidates(core, sessionId, distillCfg.distillCandidatesMax)
      const candidates = gathered.candidates.slice()
      if (candidates.length === 0) {
        return {
          request: null,
          skip: { status: 'no-candidates', reason: gathered.reason ?? '本会话没有可蒸馏候选', idleMs, candidates: 0 },
        }
      }
      /**
       * ⚠ **发起前就打点**（不是等回报）：蒸馏可能跑很久（一次 LLM 往返），期间若又有输入
       *   进来，下一次回合边界必须看到"已经有活动"⇒ 不会对同一段空闲重复发起。
       *   打点与"是否发起"同处一屏 ⇒ 两者不可能漂开。
       */
      const dispatchedAt = Date.now()
      noteActivity(sessionId, dispatchedAt)
      state.distillScanned += 1
      return {
        request: { sessionId, idleMs, candidates },
        skip: null,
      }
    })()

    if (distillAction.request === null) {
      trace(TRACE_EVENTS.distillation, sessionId, turnId, {
        chain: 'distillation',
        phase: 'skipped',
        assembled: svc<unknown>(CHAIN_SERVICES.consolidation) !== undefined,
        // status 由**分支**给出（见上面那条注释：硬写一个状态会让几种 skip 同形）。
        status: (distillAction.skip?.status as string | undefined) ?? 'skipped',
        service: CHAIN_SERVICES.consolidation,
        thresholdMs: distillCfg.distillIdleThresholdMs,
        ...(distillAction.skip ?? {}),
        v10Trigger: '空闲 10 分钟',
        substitution: '本仓无定时器 ⇒ 回合边界顺带检查真空闲',
      })
    }

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

    // ── 生成链（§13.5 深睡归纳）：本回合**已读入的快照**即素材 ──
    // ⚠ 素材取自与巩固链**同一次** readLiveItems 的投影（不另做一次读库）：
    //   两次读库会让「生成用的素材」与「巩固用的素材」成为两份可能不同的真源。
    // ⚠ 刻意**不 await**：见 runGeneration 的注释（阻塞会把宿主卡在一次网络调用上）。
    //   该 Promise 自己吞掉一切（内部 try/catch + 三态），不会成为 unhandledRejection。
    const material = reading.items
      .map((item) => {
        const content = typeof item.content === 'string' ? item.content : ''
        return '[' + String(item.id) + '] ' + content
      })
      .join('\n')
      .slice(0, config.generationMaterialMaxChars)
    void runGeneration(ctxInfo, material)

    /**
     * ── 蒸馏链：**不 await**（同 `runGeneration`）────────────────────────────────────
     * `turn-stopping` 由宿主 `await`，而蒸馏要真走一次 LLM 往返 ⇒ 在这里等会把宿主卡在
     * 一次网络调用上。`runDistillation` 自己吞掉一切（内部 try/catch + 落 dispatched/failed
     * 两行），不会成为 unhandledRejection。
     */
    if (distillAction.request !== null) {
      void runDistillation(ctxInfo, distillAction.request)
    }

    /**
     * 回合边界本身**就是一次活动** ⇒ 最后才更新打点。
     *
     * ⚠ 顺序是刻意的：若先更新再判空闲，`idleMs` 会恒为 0，本链**永不触发**且看上去
     *   "开关是开的、行也照写"（最坏的一类假绿）。
     */
    if (sessionId !== '') noteActivity(sessionId, Date.now())

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
    distillationScanned: state.distillScanned,
    distillationDispatched: state.distillDispatched,
    distillationSettled: state.distillSettled,
    distillationErrors: state.distillErrors,
    distillationSessions: lastActivityAt.size,
    distillationSessionsDropped: state.distillSessionsDropped,
    lastDistillation: state.lastDistillation,
  })

  return { onUserMessage, onInjection, onTurnBoundary, coverage, readings }
}
