/**
 * `dsh-mana-attention` —— 作意：注意力门控 + **Injection Gate（W3-2）**（P0）。
 *
 * ## 一、为什么骨架必须真写一行
 *   R0 的判据是「卸载后同一触发**不再产生新行**」。若骨架什么都不写，卸载前后都"没有新行"
 *   ⇒ 反证判据**平凡通过**（G11）。故收到 `mana/observation` 时**真写一行** `mana_trace`。
 *
 * ## 二、Injection Gate 的三条硬约束（本文件是它们的落点）
 *
 * **① fail-closed 必须留痕（A1-14）** —— 本仓最在意的一类缺陷：
 *   注入门控的**正常态与故障态表面完全同形**（都是"没注入"）。故**每次** `agent/pre-step`
 *   结束都往 `inject_log` 落一行，`gate` 取 5 类枚举之一。沉默地不注入是对的，
 *   但**不留痕就是静默失败**。⇒ `next()` 的返回与留痕**解耦**：先落痕，再返回决策。
 *
 * **② 不调 `next()` 会静默掐死下游（G9）** —— `agent/pre-step` 是 waterfall（环绕中间件）。
 *   本仓实测：上游不调 `next()` ⇒ 下游哨兵 `reached=0`、返回值 `undefined`，**全程无异常**。
 *   用户既有 shoucang 的热记忆注入（`panel-inject.js:773`）与 MCL 慢通道（`mcl.js:372`）
 *   就挂在这个点上，漏调即**静默掐死它们**。
 *
 * **③ 注入面是「尾部追加」，不得改写既有消息（A1-7）** —— 宿主契约明写
 *   「this waterfall cannot mutate messages」（`dsh-agent` 类型声明原文）。
 *   改写「系统提示 + 历史」会让**前缀缓存失效**（A1-7 要求注入前后该前缀哈希逐字节相等）。
 *   故本门控**只返回 `{kind:'enter', messages:[...既有, 新块]}`**，绝不改动 `payload.messages`，
 *   也绝不把返回的消息往前插。
 *
 * 阶段 1 的判定链在此接上 `mana/jev/judge`（**必须用 `ctx.waterfall` 分发**，用 `ctx.emit`
 * 会同步抛 `TypeError: next is not a function`，G6）。
 *
 * ## f2 席（2026-09-26 第 5 轮）补的三条：D3′ / D4′ / N1′ —— 以及"还有几处"的普查
 *
 * **D4′ · 旁路 emit 在同步栈内**：本文件所有 `ctx.emit` 共 8 处，按"是否在调用方同步栈内"分成两类：
 *   | # | 位置 | 类别 | 处置 |
 *   |---|---|---|---|
 *   | 1 | `logSessionEviction` 的 `mana/injection` | **旁路**，且在 `ingest` 同步栈内（逐出由 perceive 触发） | 改 `safeEmitDeferred`（出同步栈 + 兜异常并计数） |
 *   | 2 | N4 空 sessionId 的 `mana/plugin/inactive` | **旁路**，同上 | 改 `safeEmitDeferred` |
 *   | 3 | N4 正常路径的 `mana/attention` | **主广播**（同步契约） | 不动 |
 *   | 4 | 无 sid 分支的 `mana/plugin/inactive` | **旁路**，在宿主 dispatch 栈内 | 改 `safeEmitDeferred` |
 *   | 5 | `ingest` 正常路径的 `mana/attention` | **主广播**（同步契约） | 不动 |
 *   | 6 | `finish` 内的 `mana/injection` | **主广播**（既有：每次 pre-step 必发） | **同步可见保持不变**，改走 `emitSyncGuarded`（兜异常 + 计数） |
 *   | 7 | `finish` 内**两段**记账（`inject_log` / `mana_trace`）的失败兜底 `mana/plugin/inactive` | **旁路**，在宿主 dispatch 栈内 | 改 `safeEmitDeferred`（R-2：此处原写"三段"，但第 ③ 段**已无 try/catch**，见 R-1） |
 *   | 8 | 判定链结果 `mana/decision` | **主广播**（同步契约） | **同步可见不变**，改走 `emitSyncGuarded` |
 *
 *   **f2 收尾批（③④）的两条补充**：
 *   · 主广播**保持同步**（`mana/attention` 的既有消费者 `scheduler:133` / `working-memory:233`
 *     在**同一次 emit 内**读状态并写库 ⇒ 出栈会改变可见时序 = 动别人的行为），但新增
 *     `emitSyncGuarded`：**同步派发 + try/catch + 计数**。「可见」与「异常冒泡炸宿主」是两件事。
 *   · ⚠ **`mana/decision` 目前全仓零消费者**（本批逐仓库核对：只有 `core/src/event-types.ts` 的
 *     类型声明与 `packages/attention` 自己的 emit；无任何 `ctx.on('mana/decision', …)`）。
 *     它是**为阶段 2+ 预留的事件面**，不是"有人在用"。写在这里以免下一位读者按"有人消费"去改它
 *     —— 也正因为零消费者，它抛错**只有本包这一侧能被保护**，故它同样走 `emitSyncGuarded`。
 *   ⇒ 结论：**旁路 4 处全部出同步栈；主广播 4 处保持同步但全部兜异常 + 计数**。
 *     这条普查写在这里，是为了下一次改动能直接对照"还剩几处"。
 *
 * **D3′ · 无 sid 分支不抛**：该分支原样 `return await next()` ⇒ 上游吞决策时**不抛**而对照分支**抛**
 *   （同一病因两副面孔）。现两条分支共用 `isUsableEnterDecision` + `ERR_UPSTREAM_SWALLOWED`。
 *
 * **N1′ · 逐出算式漏 `pending`**：`lossFree` 原只看"去重集/块表" ⇒ "有候选但还没注入"的会话被判成
 *   无损，逐出时**静默丢候选**，那一步随后记 `skip_no_candidate`（与"本来就没候选"同形）。
 *   现算式**只写一遍**（`makeEvictionRecord`），`pending` 计入，并**报 `droppedPending`**。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  MANA_STAGES,
  registerPassThroughPreStep,
  type InjectionGate,
  type ManaAttention,
  type ManaCoreService,
  type ManaDecision,
  type ManaInjection,
  type ManaObservation,
  type ManaStage,
} from 'dsh-mana-core'

/**
 * ── impl 席 · 本批修的两条「让失败不可观测」的债（2026-09-26）────────────────────
 *
 * ## D2 · 调了 `next()` 却不 return 其结果的上游 ⇒ 宿主本步消息被整批吃掉
 *   `agent/pre-step` 是 **waterfall（环绕中间件）**。上游监听器只要「调了 `next()` 但没把
 *   它的返回值传下来」（观察者式写法，DSH 生态常见），本包收到的 `downstream` 就是 `undefined`。
 *   旧实现在这条路径上用 `Array.isArray(downstream?.messages) ? … : []` 兜底 ⇒ 把「没有决策」
 *   当成「决策里没有任何消息」，**返回 `{kind:'enter', messages:[本包块]}`** ⇒ 宿主这一步本该
 *   进模型的历史消息**一条不剩**，而全程无异常、`inject_log` 还写着 `injected`
 *   ⇒ 「看起来成功」与「把宿主输入吃掉」表面同形（本仓首位缺陷类）。
 *   ⇒ 现口径：`downstream === undefined/null` **大声抛**（失败可观测），且抛点**在任何审计写入之前**；
 *     因此 `inject_log` **不得**新增 `injected` 行 —— 「没做」不许留成「做了」的假账。
 *     ⚠ 为什么不留一条留痕再抛：5 类 `gate` 枚举是**冻结契约**，里面没有「上游把决策吞了」
 *       这一类；自造第 6 类同时违反领域模型与 A1-13 判据口径。唯一正确形态是**响亮失败**。
 *
 * ## D1 · 四处门控状态是按「插件实例」而非「会话」分区的
 *   `pending` / `injectedRequests` / `injectedBlocks` / `lastJudgeProbability` 原先都是实例级，
 *   而同函数里**早已取到 `sid`**。宿主跑子代理会话是常态 ⇒ 后果两条：
 *     · **串档**：A 会话的候选被注入 B 会话的步；
 *     · **假绿**：I2「每条记忆每 session 最多注入一次」退化为**跨会话全局去重**。
 *   ⇒ 现口径：四处一律按 `sid` 分区的 `Map`；`sid` 取不到时**大声抛**（不落 `''` 虚构分区）。
 *     会话状态在 `agent/disposed` 时释放，且设有上界（超出按最旧逐出 —— 有界、显式、可断言）。
 */

/**
 * 逐出/释放类留痕所用的 trace 标签（**全部取自既有裸名五类**，不新增事件、不改契约）。
 *
 * ⚠ 为什么复用 `injection` 段而不是造第 6 类标签：A1-1 的判据是「五类标签集合等式」
 *   与「标签 ⊆ MANA_STAGES」两条同时成立 ⇒ 造第 6 类会直接判红；而"该会话的去重集被重置"
 *   在语义上本就属于 Injection Gate 的**决策面**（gate='reset' 的既有含义正是"账目必须重置"）。
 *   区分手段 = payload 里的 `reason` 字段（与既有 `inj` 载荷同构，纯加法、无字段冲突）。
 */
export const SESSION_EVICTION_REASON = 'session-state-evicted'
/** `MANA_STAGES` 里 injection 段的索引（逐出留痕与注入段共用同一段，见其调用点注释）。 */
const INJECTION_STAGE_INDEX = 4
/** 逐出留痕所用的 gate：`reset`（既有含义就是"账目必须重置"），**不新增第 6 类**。 */
const EVICTION_GATE: InjectionGate = 'reset'
/** `mana/plugin/inactive` 的 `missing[0]` 值：会话无法归属（N3 的落痕判据锚点）。 */
export const TRACE_REASON_NO_SESSION_ID = 'attention:no-session-id'

/** 会话状态上界（超出按最旧逐出）。读数见 `status().maxSessions`。 */
export const MAX_SESSION_STATES = 256

/** `downstream` 不是决策对象时的显式失败（D2）。 */
export const ERR_UPSTREAM_SWALLOWED =
  'mana-attention: 上游 pre-step 监听器调了 next() 却没有把它的返回值传下来（downstream === undefined/null）。' +
  '若按「决策里没有消息」处理，宿主本步要进模型的既有消息会被整批吃掉且不报错（G9 的静默形态）。处置：让该上游 return await next()。'

/** `sid` 取不到时的显式失败（D1）。 */
/** `mana/observation` 的 `sessionId` 无效（空/纯空白）时的具名失败（N4）。 */
export const ERR_INVALID_OBS_SESSION_ID =
  'mana-attention: mana/observation 的 sessionId 为空/纯空白 ⇒ 该观察无法归入任何会话分区。' +
  '拒绝在 emit 分发链内抛（那会让 perception.perceive 收到异常且**零 trace**，观测不可得）。' +
  '校验必须先发生在源头 perception.perceive；本包在 ingest 内只做兜底记账、不当场抛。'

/**
 * `next()` 返回了对象、但形状不合宿主契约（`enter` 却缺 `messages` 数组，或 `kind` 未知）。
 *
 * ⚠ 与 `ERR_UPSTREAM_SWALLOWED` **分开**（f2 席 · 实测踩到）：core 的 G9/R0 前置用例用一个
 *   **不完整的决策桩** `{ messages: [] }` 分发 pre-step —— 那是"上游给了形状不合的决策"，
 *   不是"上游把决策吞了"。两件事的处置不同：前者要上游按契约补形状，后者要上游 return 它的 next()。
 *   合并成一条错误会让排查者拿到**指向错误位置的线索**（本仓「错误位置远离真因」的既有教训）。
 */
export const ERR_MALFORMED_DECISION =
  'mana-attention: 上游 pre-step 监听器返回的对象不合宿主 PreStepDecision 契约' +
  '（enter 必须带 messages 数组；reject 不带）。处置：让该上游返回宿主契约形状的决策。'

export const ERR_NO_SESSION_ID =
  'mana-attention: agent/pre-step 载荷里取不到会话 id（agent.sessionId 与 agent.session.id 都为空）。' +
  '禁止用空串兜底：那会把所有会话并进同一个虚构分区，正是跨会话串档的形态。'

/**
 * 取本次 pre-step 所属**会话**的稳定身份。
 *
 * ⚠ 顺序（本席 runtime 实测：`agent.sessionId` 与 `agent.session.id` **都可能出现**，
 *   且**都不等于** `agent.id`，后者是 agent 身份、不是 session 身份）：`sessionId` → `session.id`。
 *   **不**回退到 `agent.id`：换一个身份维度分区会把「按会话」静默变成「按 agent」。
 * ⚠ 不返回 `''`：空串 = 所有会话一个分区 = 串档（见 ERR_NO_SESSION_ID）。
 */
/**
 * `next()` 的返回值是不是一个**可用的决策**（D2 的唯一判据）。
 *
 * ⚠ 判据形态（见调用点）：**只留一条通道**。把"不是对象 / 不是 enter / messages 不是数组"
 *   三种情形**合并**成同一个失败 —— 否则负控摘守卫时会崩在 TypeError 上，报红原因从
 *   "宿主输入被吃掉"变成"崩了"（循环论证）。
 * ⚠ `reject` 是**合法**决策（宿主 reject 分支没有 messages）⇒ 放行，由调用方按 kind 分派。
 */
/**
 * 断言 `next()` 的返回值可用；不可用即抛具名错（**全文件唯一的抛点**）。
 *
 * ⚠ 存在的理由（f2 席 · D3′）：原先主分支与"无 sid"分支各写一遍守卫 ⇒ ① 同一病因两副面孔
 *   （一条抛、一条原样透传 `undefined`）；② 变异器锚点出现 2 次 ⇒ 负控直接失效（实测踩到）。
 *   收成一个函数后，"要不要抛"只在一处决定，锚点也自然唯一。
 */
export function assertUsableDecision(decision: unknown): void {
  if (decision === undefined || decision === null) throw new Error(ERR_UPSTREAM_SWALLOWED)
  if (!isUsableEnterDecision(decision)) throw new Error(ERR_MALFORMED_DECISION)
}

export function isUsableEnterDecision(decision: unknown): boolean {
  if (typeof decision !== 'object' || decision === null) return false
  const kind = (decision as { kind?: unknown }).kind
  if (kind === 'reject') return true
  /**
   * ⚠ **`kind` 缺席视为 `enter`** —— 这不是宽松，是**与宿主一致**（f2 席实测校准）：
   *   宿主 loop 消费该决策的原文是 `if (decision.kind === 'reject') return decision;
   *   return { ...decision, assembly }`（`dsh-agent-loop/lib/index.js:911-924`）——
   *   **它只判 `reject`**，其余一律当"进入这一步"。故 `{ messages: [...] }` 这种不带 `kind`
   *   的返回在**生产路径上本来就是合法的**，宿主自己的 `model-selection` 插件也走这条形态。
   *   ⇒ 若把"缺 kind"判成不合契约，本包就会**拒绝一个宿主本来接受的决策**（这类"判据比宿主更严"
   *     的写法会让今天能跑的插件明天挂掉 —— 本批差点踩到，如实记在读数文件里）。
   *   仍然要求的只有一件事：`messages` 必须是数组（否则下面按数组消费会炸/静默丢）。
   */
  if (kind !== undefined && kind !== 'enter') return false
  return Array.isArray((decision as { messages?: unknown }).messages)
}

export function resolvePreStepSessionId(agent: unknown): string | undefined {
  const a = agent as { sessionId?: unknown; session?: { id?: unknown } } | undefined
  for (const candidate of [a?.sessionId, a?.session?.id]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return undefined
}


/**
 * 取第 i 个 stage 的**裸名标签**（mana_trace.event_type 的真源 = core 的 MANA_STAGES）。
 *
 * ⚠ 本仓「同一个事实」原有**三套名字**（A1-1 的原缺陷）：
 *   ① 判据原文的裸名五类（docs/mana-rollout-plan.md:346）；
 *   ② 契约的带前缀五类（core/src/event-types.ts:32-43）；
 *   ③ 断言里手写的第三套（core/tests/chain-e2e.test.mjs:97 旧版）。
 *   裁定：Cordis 事件名**带前缀**（契约，不改）；mana_trace.event_type 标签**取裸名**。
 *   ⇒ 标签一律经本函数从 MANA_STAGES 取，不在别处手写第三套字面量。
 * ⚠ MANA_STAGES 是 readonly ManaStage[]（非元组），noUncheckedIndexedAccess 下索引访问是
 *   ManaStage | undefined ⇒ 集中在此断言一次；缺项时**大声抛**，不让「五类被改成三类」
 *   变成静默的 undefined 标签落库。
 */
function stageLabel(i: number): ManaStage {
  const s = MANA_STAGES[i]
  if (s === undefined) throw new Error('mana-attention: MANA_STAGES 缺第 ' + i + ' 项（S1 五类契约被改动？）')
  return s
}

export const name = 'mana-attention'

/**
 * ── v10 §15.4 检索类型：**生产侧的唯一定档器**（本批新增）──────────────────────────────
 *
 * 判据：`inject_log` 里该 `memory_id` **是否已有** `gate='injected'` 行，**且排除本会话**。
 *
 * ⚠ **为什么必须排除本会话**：本包有 **I2 不变量**（每条记忆每会话最多注入一次，见
 *   `injectedRequests`），而本包写 `inject_log` 与广播 `mana/injection` 是**同一段代码里的先后两步**
 *   ⇒ 消费方（scheduler 开窗）查库时，**本次注入自己那行已经在表里** ⇒ 不排除则计数恒 ≥1
 *   ⇒ **恒判「再认」**，这条轴等于死掉（本仓最防的恒真判据）。排除本会话后口径为
 *   **跨会话累计**：别的会话曾经取出来过 ⇒ 再认；从没有过 ⇒ 回忆。
 *
 * ⚠ **推翻了「本会话是否见过」这一前提**（本批勘误）：正在被注入的记忆在本会话**必然没出现过**
 *   ⇒ 该判据恒 false，区分不了任何东西。故只看跨会话历史。
 *
 * ⚠ **「精细提取」（elaboration，增益 0.25）当前无信号源 ⇒ 本探针不产出该档**：
 *   它要求「提取时做了精细加工」，而本仓**没有任何地方记录这次提取有没有被加工过**。
 *   编一个假信号比判不出来更坏 —— 故只吐两档，第三档留空。
 *
 * ⚠ **三种结果必须可分辨**（不得折成两态）：`'recognition'` / `'recall'` = 查得到；
 *   `null` + `error` 非空 = **查不到**（库不可读 / 查询抛错）。「查不到」若被读成 `'recall'`，
 *   一次库故障就会静默给记忆白送 0.15 增益 ⇒ 失败不可观测。
 */
export type RetrievalKind = 'recognition' | 'recall'

export interface RetrievalKindProbe {
  /** 定档结果；`null` = **查不到**（此时 `error` 必非空）。 */
  readonly kind: RetrievalKind | null
  /** 查不到时的具名原因；**空串 = 查得到**（此时 `kind` 必非 null）。 */
  readonly error: string
  /** 判定时看到的**其他会话**的既有注入行数（0 = 从没被别的会话取出来过 ⇒ 回忆）。查不到时为 -1。 */
  readonly priorInjectedRows: number
}

/** `core.db` 的最小结构面（与 reconsolidation 的 `ColumnProbeDb` 同形：只声明真用到的那一个方法）。 */
interface CountProbeDb {
  prepare(sql: string): { get(...params: unknown[]): unknown }
}

/**
 * 定档实现（**纯读**：不写任何行、不碰任何门控状态）。
 *
 * @param sessionId 本次注入所属会话 —— 见上文「为什么必须排除本会话」。
 */
export function probeRetrievalKind(core: ManaCoreService, memoryId: string, sessionId: string): RetrievalKindProbe {
  try {
    const db = core.db as unknown as CountProbeDb
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM inject_log WHERE memory_id = ? AND gate = 'injected' AND session_id <> ?")
      .get(memoryId, sessionId) as { n?: unknown } | undefined
    const n = Number(row?.n ?? 0)
    if (!Number.isFinite(n)) {
      return { kind: null, error: 'inject_log 计数非有限数：' + String(row?.n), priorInjectedRows: -1 }
    }
    // ⚠ 0 行 ⇒ 'recall' 是**查到了「没有」**（不是「查不到」）—— 这两件事由 error 是否为空分辨。
    return { kind: n > 0 ? 'recognition' : 'recall', error: '', priorInjectedRows: n }
  } catch (error) {
    return {
      kind: null,
      error: 'inject_log 查询失败：' + String((error as Error)?.message ?? error),
      priorInjectedRows: -1,
    }
  }
}

/** 依赖 core（方案 §9.1：`core, jev`；jev 在阶段 1 接入判定链时再加）。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 聚焦项上限。方案 §9.4 原值 4。 */
  maxFocusItems: number
  /** JEV 放行阈值。方案 §9.4 原值 0.7。 */
  jevThreshold: number
  /** 注入门控开关。关掉后**仍留痕**（gate='skip_no_candidate'），不得静默。 */
  injectionEnabled: boolean
  /** 单次注入块的字符上限（与 working-memory 的 budgetChars 独立）。 */
  injectionBudgetChars: number
  /** 送判定链的 state 文本（Injection Gate 的问法见方案 §6.2）。留空 = 不判、按不可用处理。 */
  judgeState: string
  /** 送判定链的问题原文。方案 §6.2 的 Injection Gate 问法。 */
  judgeQuestion: string
}

export const Config: Schema<Config> = Schema.object({
  maxFocusItems: Schema.number().default(4),
  jevThreshold: Schema.number().default(0.7),
  injectionEnabled: Schema.boolean().default(true),
  injectionBudgetChars: Schema.number().default(4000),
  // ⚠ 缺省留空 ⇒ 判定链拿不到 state ⇒ 必然 `degraded_unavailable`（fail-closed：不注入但留痕）。
  //   这与「没判就注入」相比是**更安全**的缺省（注入是可见行为，不该在配置缺席时自发发生）。
  judgeState: Schema.string().default(''),
  judgeQuestion: Schema.string().default('此信息是否与当前目标高度相关？'),
})

/**
 * 组装注入块 —— **整块只有 2 个 wrapper 标签，内层 `<` 计数必须为 0**（A1-6）。
 *
 * ⚠ 内层内容里的 `<` 若原样带进去，会与 wrapper 标签混在不可分辨的层级里
 *   （读上下文的人/AI 无法区分"这是数据"还是"这是指令"）⇒ 必须**转义**。
 *   本函数把内容里的 `<` 一律替换为全角 `＜`（**可逆性不是目标，可分辨性才是**：
 *   注入块是"系统给的记忆提示"，不是逐字保真的数据通道）。
 */
export function buildInjectionBlock(entries: readonly { requestId: string; content: string }[]): string {
  const body = entries
    .map((e) => `- ${String(e.content).replace(/</g, '＜').replace(/>/g, '＞')}`)
    .join('\n')
  return `<mana-memory>\n${body}\n</mana-memory>`
}

/** 统计注入块的**内层** `<` 数（排除两个 wrapper 标签本身）—— A1-6 的判据读数。 */
export function innerAngleCount(block: string): number {
  const stripped = block.replace(/^<mana-memory>\n?/, '').replace(/\n?<\/mana-memory>$/, '')
  return (stripped.match(/</g) ?? []).length
}

export interface ManaAttentionService {
  readonly plugin: string
  /** `sid` 取不到时的显式失败（D1；见 ERR_NO_SESSION_ID）。 */
  readonly noSessionIdError: string
  /** `downstream === undefined/null` 时的显式失败（D2；见 ERR_UPSTREAM_SWALLOWED）。 */
  readonly upstreamSwallowedError: string
  /** 释放一个会话的门控分区（会话结束）；返回是否真的删掉（不静默）。 */
  releaseSession(sid: string): boolean
  /** 会话分区数（判据读数：分区表真的在动，而不是"我以为它在动"）。 */
  sessionCount(): number
  /** 某会话是否有待注入候选（**按会话**问，不从别处借读数）。 */
  hasPending(sid: string): boolean
  /** 最近活跃会话（只读投影用；**不参与**注入决策，判据据此断言投影与决策面是两件事）。 */
  lastActiveSession(): string | null
  /** 会话分区上界（**可读真值**：判据要断言"有界"，不许只是文档里写着）。 */
  readonly maxSessions: number
  /**
   * 逐出流水（**只读**，最近 32 条）。
   *
   * ⚠ 它存在的唯一理由：让"上界逐出**真的发生过**"变成可断言的事实 —— 否则
   *   「从未逐出」与「逐出了并静默重置了 I2 账目」在库上都只是"没看到异常"。
   */
  evictionLog(): readonly { sessionId: string; droppedPending: number; droppedDuplicateKeys: number; droppedTrackedBlocks: number; lossFree: boolean }[]
  /** 逐出留痕里使用的 gate 值（判据据此在 `mana_trace` 里认领逐出行，不猜字面量）。 */
  readonly evictionReason: string
  /**
   * 派发失败读数（**合并视图**，按时刻排序）。
   *
   * ⚠ `event` 以 `sync:` 开头 = **主广播**（同步派发）里监听器抛错被兜住；
   *   否则 = **旁路**消息没送到。两类**分表存放**（原因不同、补救方向不同），合并视图只为兼容既有消费者。
   */
  deferredEmitFailures(): readonly { event: string; message: string; at: string }[]
  /**
   * 两张失败表各自的条数 + 上限。
   *
   * ⚠ 存在的理由：**合并视图看不出"某一类被另一类挤掉"**。主广播每步都派发，一个常驻抛错的监听器
   *   几步就能填满窗口，而"逐出旁路没送到"每 256 会话才可能发生一次 ⇒ 后者会被结构性挤掉且无痕迹。
   *   有了这个读数，"被挤掉"才可判据（详见 `pushFailure` 处的三条判断依据）。
   */
  emitFailureCounts(): { sync: number; bypass: number; cap: number; windowDropped: { sync: number; bypass: number } }
  /** 各处**有界窗口**淘汰掉的条数（丢读数也要报数；全 0 才说明"没丢过读数"）。 */
  windowDroppedCounts(): { failureSync: number; failureBypass: number; evictionLog: number; focusDropLog: number }
  /** 聚焦项上限导致的候选丢弃流水（同类病因普查的第二处；空数组 = 没丢过）。 */
  focusDropLog(): readonly { sessionId: string; dropped: number; at: string }[]
  /**
   * 处理一条观察：写 `mana_trace`（event_type='observation'）并广播 `mana/attention`。
   * 返回写入的 `seq`。
   */
  ingest(obs: ManaObservation): number
  /**
   * 组装当前注入块（空字符串 = 无可注入内容）。
   *
   * 暴露为服务面是为了让判据能**直接断言**块格式（A1-6 转义、A1-7 前缀不动），
   * 而不必去猜 pre-step 内部的中间态。
   */
  buildBlock(): string
  status(): { plugin: string; wired: boolean; injections: number; lastGate: InjectionGate | null }
  /**
   * v10 §15.4：这条记忆**以前**被取出来过没有 ⇒ 再认 / 回忆（口径与可分辨性见 `probeRetrievalKind`）。
   *
   * ⚠ **纯读**：不改门控状态、不写任何行 —— 判据因此可以任意次调用它取读数。
   */
  retrievalKindFor(memoryId: string, sessionId: string): RetrievalKindProbe
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-attention': ManaAttentionService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-attention: 缺少 mana-core 服务（inject 未满足）')

  /** ── D1：门控状态**按会话**分区（原为插件实例级 ⇒ 跨会话串档 + I2 假绿）──────────
   *
   * ⚠ 三处集合 + 一处标量原先是实例级。宿主跑子代理会话是常态 ⇒
   *   ① A 会话的候选被注入 B 会话的步（串档）；② I2 退化为跨会话全局去重（判据假绿）。
   * ⚠ 分区键只认**会话身份**（见 resolvePreStepSessionId）：取不到就抛，不落空串。
   * ⚠ 表有上界（MAX_SESSION_STATES）：无界增长会让「该清没清」不可观测；
   *   超出按**最旧**逐出（Map 保持插入序，首个键即最旧）。会话结束时由 agent/disposed 主动释放。
   */
  interface SessionGatingState {
    /** 本会话内已放行、待注入的聚焦项（注入后即清，避免重复注入）。 */
    pending: ManaAttention[]
    /** 本会话已注入过的 requestId（I2：每条记忆每 session 最多注入一次）。 */
    injectedRequests: Set<string>
    /** 本会话已注入、但**是否仍在上下文中**尚未逐块核对的块（reset 检测用的有序表）。 */
    injectedBlocks: { blockId: string; messageId: string }[]
    /** 最近一次判定链给出的概率（**仅该会话该次 pre-step 内**有效）。 */
    lastJudgeProbability: number | null
  }
  const sessionStates = new Map<string, SessionGatingState>()
  /**
   * 服务面缺省分区：**只给不带会话上下文的调用**（如 `buildBlock()`）用。
   * ⚠ 它**不是**任何真会话：pre-step 路径取不到 sid 是**真错误**（抛），服务面读缺省分区是**合法**的
   *   —— 两者必须可分辨，否则「取不到身份」会表现成"读了一个正常会话"。
   */
  /** 服务面缺省分区名（**不是**真会话）；pre-step 路径永远读不到它。 */
  const SERVICE_FACE_SESSION = '<service-face>'
  /**
   * 最近活跃的会话（**只读投影**用；pre-step 路径**从不**读它）。
   *
   * ⚠ 它的唯一用途：让不带 sid 的服务面调用（`buildBlock()`）读到"刚刚那条会话"的候选池 ——
   *   这是**既有行为**（`core/tests/injection-gate.test.mjs` 的 P3 就是这么取的：先 `perceive`
   *   再用 `buildBlock()` 断言块形态）。
   * ⚠ 但它**不得**参与任何**注入决策**：注入永远按本次 pre-step 的 `sid` 读自己的分区，
   *   否则「A 会话的候选被注入 B 会话的步」这条债就从后门回来了。该性质由新判据钉住
   *   （见 `session-isolation.test.mjs` 的 X-③：两会话交错时注入面互不可见）。
   */
  let lastActiveSession: string | null = null
  /**
   * 逐出一个会话分区（**上界**触发的路径，与 `releaseSession` 是两件事）。
   *
   * ⚠ **为什么必须留痕**（N1，risk 席实测）：256 会话上界是**工程选择**，而 I2
   *   「每条记忆每 session 最多注入一次」是**判据表硬不变式**。冲突时不变式只能"留痕地让路"：
   *   逐出会连 `injectedRequests` 一起去掉 ⇒ **同一 requestId 在该会话里会被再注入一次**
   *   （审计 1 行 → 2 行）。若不留痕，这条 I2 违例在库上与"正常注入"完全同形 —— 本仓首位缺陷类。
   *   ⇒ 逐出**必须**写一行 trace 记账（见 `logSessionEviction`），且把去重集置空这件事
   *     作为**可读事实**（`reason=SESSION_EVICTION_REASON`）落在 payload 里。
   * ⚠ 为什么逐出时改"清空"而不是"把 `injectedRequests` 搬回新分区"：搬回来会让无界集合
   *   复活（上界就白设了）；而"清空 + 落痕"把"哪些会话的 I2 账目被重置过"变成可查事实，
   *   由判据/审计决定要不要追责。这是**显式让路**，不是静默破坏。
   */
  /**
   * 逐出记录（**算式的唯一真源**）。
   *
   * ⚠ **N1′（f2 席修）**：上一版的 `lossFree` 算式出现在**两处**（流水记录与 trace 载荷），
   *   且**都只看 `injectedRequests` / `injectedBlocks`、漏了 `pending`** ⇒ 一个"有候选但还没注入"
   *   的会话被判成"无损"，逐出它时**静默丢掉候选**；随后那一步落 `gate='skip_no_candidate'`，
   *   与「本来就没候选」**完全同形**（本仓首位缺陷类）。
   *   ⇒ 现口径：① 算式**只写一遍**（本函数），流水与载荷共用同一个 record，不可能漂开；
   *     ② `pending` 计入 `lossFree`；③ 逐出时**报出 `droppedPending`** —— 丢候选从"静默"变成**可数事实**。
   *   ⚠ 为什么取"计数"而不是"保护带候选的会话不逐出"（risk 席给的 A/B 两选项，取 B）：
   *     保护法会让新会话自己的首条消息在超限时无处可去（B 的裁决理由），且会破坏内存上界；
   *     计数的代价是"候选仍可能被丢"，收益是它**再也无法静默**。
   */
  interface EvictionRecord {
    sessionId: string
    /** 逐出时该会话**尚未注入**的候选条数（>0 即"这次逐出丢掉了候选"）。 */
    droppedPending: number
    /** 逐出时该会话已注入过的 requestId 条数（>0 即 I2 账目被重置 ⇒ 同记忆可再注入一次）。 */
    droppedDuplicateKeys: number
    /** 逐出时该会话尚未核对是否仍在上下文的块数（>0 即 reset 检测不再覆盖这些块）。 */
    droppedTrackedBlocks: number
    /** 无损 = 三项全 0：这次逐出没有动任何账目、也没有丢任何候选或块跟踪。 */
    lossFree: boolean
  }
  /** 由**一个** reader 构造记录：三项都从同一个 `evicted` 快照读，算式不重复。 */
  const makeEvictionRecord = (sessionId: string, evicted: SessionGatingState | undefined): EvictionRecord => {
    const droppedPending = evicted?.pending.length ?? 0
    const droppedDuplicateKeys = evicted?.injectedRequests.size ?? 0
    const droppedTrackedBlocks = evicted?.injectedBlocks.length ?? 0
    return {
      sessionId,
      droppedPending,
      droppedDuplicateKeys,
      droppedTrackedBlocks,
      lossFree: droppedPending === 0 && droppedDuplicateKeys === 0 && droppedTrackedBlocks === 0,
    }
  }
  /**
   * **聚焦项上限**导致的候选丢弃流水（有界，最近 32 条）。
   *
   * ⚠ 与逐出流水同类：都是"丢了东西必须报数"。两者的区别只在于触发条件
   *   （`maxFocusItems` 超限 vs 会话分区上界），故**共用**"丢了一条记一条"的口径。
   */
  const focusDropLog: { sessionId: string; dropped: number; at: string }[] = []
  /** 聚焦丢弃流水窗口淘汰计数（同上）。 */
  let focusDropLogDropped = 0

  /** 逐出流水窗口淘汰计数（丢读数也要报数）。 */
  let evictionLogDropped = 0
  /** 逐出流水（**进程内**、有界：只留最近 32 条），使"逐出发生过几次"可判据读取。 */
  const evictionLog: EvictionRecord[] = []
  /**
   * 逐出留痕：写一行 `mana_trace`（标签仍是既有裸名五类之一）并旁路 emit。
   *
   * ⚠ 影响面逐条交代：
   *   · 只在上界逐出时发生（256 分区 FIFO），**不进入任何一次 pre-step 的注入决策**；
   *   · 载荷是**计数**（丢了几条候选/去重键/块跟踪），**不含任何记忆内容**（A1-9）；
   *   · 写失败**不得**影响分区创建（try/catch 记账后继续）：逐出留痕是"记账"，不是"前置条件"。
   *   · **D4′**：旁路 emit 走 `safeEmitDeferred`（出同步栈 + 监听器抛错被兜住并计数）——
   *     逐出是在 `ingest` 的**同步栈**里发生的，同步 emit 会让监听器的异常**冒泡进 `perceive()`**。
   */
  const logSessionEviction = (record: EvictionRecord): void => {
    /**
     * ⚠ **本批（f2 收尾补齐 · F-1）修掉的形态**：这里原是 `try { core.writeTrace(...) } catch { /* 注释 *\/ }`
     *   —— catch 体内**只有注释**，而注释自称"走旁路事件"。实测（risk 席第四次复审）：
     *   `mana_trace` 写坏时 ⇒ **逐出 32 次、零留痕、零事件**。「注释承诺了、代码没做」= 本仓反复出现的
     *   声明与生效不一致。现口径：走 `writeTraceGuarded`（**带归因** + 不冒泡 + 失败返回 0），
     *   归因文本点名是**逐出留痕**这一路，与别处的 trace 失败可分辨。
     * ⚠ 逐出本身仍不受影响（留痕是记账，不是前置条件）—— 但**失败必有归因**。
     */
    writeTraceGuarded('mana_trace 写入失败(逐出留痕)', {
        // ⚠ 唯一化锚点（impl c1）：注入段另有一处 `stageLabel(4)`，变异器要求锚点**恰好命中 1 次**
        //   ⇒ 逐出留痕这里显式写"段索引 4 = injection 段"的来源，不再与注入段同形。
        eventType: stageLabel(INJECTION_STAGE_INDEX),
        sessionId: record.sessionId,
        turnId: 0,
        payload: {
          sessionId: record.sessionId,
          turnId: 0,
          requestId: `evict:${record.sessionId}`,
          at: new Date().toISOString(),
          gate: EVICTION_GATE,
          blockId: null,
          memoryId: null,
          degraded: false,
          reason: SESSION_EVICTION_REASON,
          // ⚠ 三项计数**直接取自 record**（算式唯一真源，见 makeEvictionRecord）：两处重算必然漂开。
          droppedPending: record.droppedPending,
          droppedDuplicateKeys: record.droppedDuplicateKeys,
          droppedTrackedBlocks: record.droppedTrackedBlocks,
          lossFree: record.lossFree,
        },
      at: new Date().toISOString(),
    })
    safeEmitDeferred('mana/injection', {
      sessionId: record.sessionId,
      turnId: 0,
      requestId: `evict:${record.sessionId}`,
      at: new Date().toISOString(),
      gate: 'reset',
      blockId: null,
      memoryId: null,
      degraded: false,
    })
  }

  /**
   * 旁路 emit（**D4′**）：出同步栈 + 监听器异常被兜住并**计数**。
   *
   * ⚠ 为什么必须出同步栈：旁路路径（逐出留痕、无会话身份、留痕失败兜底）都发生在**调用方栈内**
   *   —— `ingest` 由 `ctx.emit('mana/observation')` 同步调用（源头是 `perception.perceive`），
   *   pre-step 监听器则在宿主 loop 的 dispatch 栈内。同步 emit 一旦有监听器抛错，
   *   异常会**冒泡进调用方**：`perceive()` 收到异常（第 256 次调用就炸，risk 席实测），
   *   或把宿主 loop 的这一步炸掉 —— 而这两个调用方都**不是**这条留痕的责任方。
   * ⚠ 也不能"吞掉就算了"：异常计数进 `deferredEmitFailures`，可被 `status()` 与判据读到。
   *   「发得出去、收得到就会炸进调用方」与「炸了没人知道」两种形态都要避免，故**兜住 + 留下读数**。
   * ⚠ 只在**旁路**路径用：主广播（`mana/attention` / `mana/decision`）**不动** —— 它们是既有的
   *   同步契约（working-memory / scheduler 在同 tick 内消费），改了就是动别人的行为。
   */
  type EmitFailure = { event: string; message: string; at: string }
  /**
   * **失败读数：两张表，不共用一个窗口**（本批 ③ 的裁决 —— 拆）。
   *
   * 判断依据（三条，逐条可核）：
   *   ① **两类失败的补救方向不同**：`sync:` = 「有监听器在同步派发里抛错，异常被兜住了」（要去找那个监听器）；
   *      旁路 = 「这条旁路消息没送到」（要去看是谁在收、以及为什么抛）。混在一张表里会让排查者按错的线索走。
   *   ② **共享 32 条窗口会让"稀有的重要条目"被"高频噪声"挤掉**（可达性论证，不是口味）：
   *      主广播在**每一次 pre-step** 上派发（`mana/injection` 每步一行、`mana/decision` 每步一行），
   *      一个常驻抛错的监听器能在**几步之内**塞满窗口；而"逐出留痕的旁路没送到"是**每 256 个会话**才可能发生一次。
   *      共用窗口 ⇒ 后者会被前者**结构性挤掉**（且没有任何读数显示"被挤掉过"）—— 正是本仓首位缺陷类。
   *   ③ 拆表**不增加**维护面：两张表用同一个 `pushFailure` 写入点、同一个上限常量，不存在"两套逻辑漂开"。
   * ⚠ 兼容：`deferredEmitFailures()` 仍返回**合并视图**（按时刻排序），既有用例与消费者不必改；
   *   新增 `emitFailureCounts()` 暴露**两张表各自的条数**，使"某一类被挤掉"可被判据读出来。
   */
  const EMIT_FAILURE_CAP = 32
  const syncEmitFailures: EmitFailure[] = []
  const bypassEmitFailures: EmitFailure[] = []
  /** 窗口淘汰计数（**丢读数也要报数**：被挤掉的失败条目数，按表分）。 */
  const failureWindowDropped = { sync: 0, bypass: 0 }
  const pushFailure = (bucket: EmitFailure[], failure: EmitFailure): void => {
    bucket.push(failure)
    while (bucket.length > EMIT_FAILURE_CAP) {
      bucket.shift()
      // ⚠ **丢条目也要报数**：窗口淘汰是"静默丢东西"的第 N 处（同类普查的落点）。
      //   不记的话，「失败很多但窗口只留 32 条」与「正好只失败了 32 次」在读数上完全同形。
      if (bucket === syncEmitFailures) failureWindowDropped.sync += 1
      else failureWindowDropped.bypass += 1
    }
  }

  /**
   * **主广播**派发（f2 收尾批 ③）：**保持同步**（同 tick 可见是既有契约），但**兜住异常 + 计数**。
   *
   * ⚠ 为什么不能出同步栈：`mana/attention` 的既有消费者（`scheduler:133` / `working-memory:233`）
   *   在**同一次 emit 内**读状态并写库 ⇒ 出栈会改变它们的可见时序（那就是动别人的行为）。
   * ⚠ 为什么又必须兜：**「可见」与「异常冒泡炸宿主」是两件事**。`mana/decision` 全仓**零消费者**
   *   （分类表 §D4′ 已注明），可只要有一个第三方监听器抛错，异常就会顺着 `ctx.emit` 冒泡进
   *   宿主 loop 的 pre-step dispatch ⇒ **整步失败**，而失败原因看起来像"Mana 挂了"。
   * ⇒ 取两全：**同步派发（时序不变） + try/catch（不外溢） + 计数（不静默）**。
   *   计数与旁路共用 `deferredEmitFailures`（同一张读数表，避免两套计数漂开），但标签区分 `sync:` 前缀。
   */
  const emitSyncGuarded = (event: 'mana/attention' | 'mana/decision' | 'mana/injection', payload: unknown): void => {
    try {
      ctx.emit(event, payload as Parameters<typeof ctx.emit>[1])
    } catch (error) {
      pushFailure(syncEmitFailures, { event: `sync:${event}`, message: String((error as Error)?.message ?? error), at: new Date().toISOString() })
    }
  }
  const safeEmitDeferred = (event: 'mana/injection' | 'mana/plugin/inactive', payload: unknown): void => {
    queueMicrotask(() => {
      try {
        if (event === 'mana/injection') ctx.emit('mana/injection', payload as Parameters<typeof ctx.emit>[1])
        else ctx.emit('mana/plugin/inactive', payload as Parameters<typeof ctx.emit>[1])
      } catch (error) {
        pushFailure(bypassEmitFailures, { event, message: String((error as Error)?.message ?? error), at: new Date().toISOString() })
      }
    })
  }

  /** 释放一个会话的分区（会话结束）。返回是否真的删掉（供判据断言，不静默）。 */
  const dropSessionState = (sid: string): boolean => sessionStates.delete(sid)

  // ⚠ 以下三行是**迁移说明**（供读者对照旧实现）：`pending` / `injectedRequests` / `injectedBlocks`
  //   已并入上面的按会话分区状态，pre-step 内以**局部绑定** `state`/`pending`/… 指到本会话分区。


  /**
   * 已注入、但**是否仍在上下文中**尚未逐块核对的块（`reset` 检测用）——**有序表**。
   *
   * ⚠ 身份 = 宿主给块消息分配的 `id`（**结构位置**），**不是**块内水印：
   *   块内容里**不得留可反查的标识**（A1-9：审计不泄内容 —— 审计行不泄、上下文里泄，同样是泄漏）。
   * ⚠ 为什么是**有序表**而不是 `Set`（G1 席 D1 修复）：集合只答得了「上下文里**还有没有**块」，
   *   答不了「**这一块**还在不在」⇒ 多块时旧块的 `injected` 行会永久标着已注入（假账）。
   *   表按注入顺序排列，逐条核对时顺序也在（宿主注入为尾部追加 ⇒ 表中次序 == 上下文里出现次序）。
   */

  let injections = 0
  let lastGate: InjectionGate | null = null
  /**
   * 最近一次判定链给出的概率（**仅该次 pre-step 内**有效；pre-step 开头重置为 null）。
   *
   * ⚠ 存它是为了让 inject_log.jev_prob 有真源：该列若恒 NULL，「没判」与「判了」在库上同形
   *   （本仓首位缺陷类：让失败不可观测）。
   */


  const ingest = (obs: ManaObservation): number => {
    // 真写一行：这是「卸载即净」可被机检的唯一依据（见文件头一）。
    // ⚠ 走带归因的写入口：写失败**不得冒泡进 `perception.perceive`**（同类病因普查，见 writeTraceGuarded）。
    const seq = writeTraceGuarded('mana_trace 写入失败(observation)', {
      // 裸名标签从 MANA_STAGES 取（不写字面量 —— 三套名字的根源就是「各处各自手写」）。
      eventType: stageLabel(0),
      sessionId: obs.sessionId,
      turnId: obs.turnId,
      payload: obs,
      at: obs.at,
    })
    const att: ManaAttention = {
      sessionId: obs.sessionId,
      turnId: obs.turnId,
      requestId: obs.requestId,
      at: obs.at,
      content: obs.content,
      jevProbability: null,
      degraded: false,
    }
    // ⚠ 入队**先于**广播：下游（working-memory/scheduler）在同一 tick 内读到的应是已入队状态。
    // ⚠ D1：入队进的是**本会话自己的**分区（`obs.sessionId`），不是插件实例级的公共队列。
    //   空会话 id 在此**大声抛**：它会让所有会话并进同一个虚构分区（串档的形态）。
    // ⚠ N4：空/纯空白 sessionId **不在 emit 分发链内抛** —— cordis 的 `emit` 是同步冒泡，
    //   抛出去会让 `perception.perceive` 收到异常，且**本函数开头的 observation 行已经写了一半**
    //   （trace 有行、分区没建）⇒ 「收到异常」与「零 trace」两种形态都出现过，观测不可得。
    //   ⇒ 现口径三件事一起做：① **不抛**（不让源头炸）；② **明说**（trace + 旁路事件各一条）；
    //     ③ **不建分区**（绝不把无效 id 变成一个"看起来正常"的会话）。
    //   ⚠ 真正的**源头校验**（`perception.perceive` 拒绝空 sessionId）在 perception 包，
    //     属他人写面 ⇒ 本轮**不越界**，已列 [越界转派]。
    if (config.maxFocusItems > 0 && obs.sessionId.trim() === '') {
      writeTraceGuarded('mana_trace 写入失败(空 sessionId 记账)', {
        eventType: stageLabel(0),
        sessionId: '',
        turnId: att.turnId,
        payload: { reason: TRACE_REASON_NO_SESSION_ID, requestId: att.requestId, invalid: 'empty-session-id' },
        at: att.at,
      })
      // ⚠ D4′：两条都在**同步栈内**（`ingest` 由 `ctx.emit('mana/observation')` 同步调用）
      //   ⇒ 监听器抛错会冒泡进 `perception.perceive`。旁路那条改出同步栈；
      //   主广播 `mana/attention` 保持同步（既有契约，working-memory/scheduler 同 tick 消费）。
      safeEmitDeferred('mana/plugin/inactive', { id: name, missing: [ERR_INVALID_OBS_SESSION_ID], at: att.at })
      emitSyncGuarded('mana/attention', att)
      return seq
    }
    if (config.maxFocusItems > 0) {
      const own = sessionStateFor(obs.sessionId)
      lastActiveSession = obs.sessionId
      own.pending.push(att)
      /**
       * ⚠ **同类病因普查（f2 席自问"还有几处"）**：这里是本文件中**第二处**"静默丢候选"的形态 ——
       *   `maxFocusItems` 超限时 `shift()` 掉最旧的候选，随后那一步若候选池空就落
       *   `gate='skip_no_candidate'`（与"本来就没候选"同形）。两处的共同病因 = **丢东西不报数**。
       *   ⇒ 同样补计数：丢一条记一次（`droppedFocusItems`，可被 `status()` 读到）。
       * ⚠ 为什么不改语义（不改成"不丢"）：`maxFocusItems` 是既有配置契约（缺省 4，方案 §9.4 原值），
       *   改它会让"聚焦项上限"这个既有行为消失 —— 那是动别人的行为。本批只把"丢了"变成可数。
       */
      let droppedFocusItems = 0
      while (own.pending.length > config.maxFocusItems) {
        own.pending.shift()
        droppedFocusItems += 1
      }
      if (droppedFocusItems > 0) {
        focusDropLog.push({ sessionId: obs.sessionId, dropped: droppedFocusItems, at: att.at })
        // ⚠ 同上：流水窗口淘汰也记数。
        while (focusDropLog.length > 32) {
          focusDropLog.shift()
          focusDropLogDropped += 1
        }
      }
    }
    emitSyncGuarded('mana/attention', att)
    // 事件名与标签同源：这条 trace 行对应的就是刚广播的 mana/attention。
    writeTraceGuarded('mana_trace 写入失败(attention)', {
      eventType: stageLabel(1),
      sessionId: att.sessionId,
      turnId: att.turnId,
      payload: { requestId: att.requestId, contentChars: [...att.content].length },
      at: att.at,
    })
    return seq
  }

  /**
   * **带归因的 trace 写入**（f2 收尾批 · 同类病因普查的落点）。
   *
   * ⚠ 为什么需要它：`ingest` 的两条主记账与 `decision` 段原先都是**裸 `core.writeTrace`**
   *   ⇒ 写失败会**冒泡进调用方**（`ingest` 由 `ctx.emit('mana/observation')` 同步调用 ⇒
   *   `perception.perceive` 收到异常；`decision` 段在宿主 loop 的 dispatch 栈内 ⇒ 炸掉这一步）。
   *   这与本批已修的 D4′ / N4 是**同一类**：**记账失败不得冒泡进调用方**。
   * ⚠ 返回值：写成功 = 真 `seq`；写失败 = **0**（AUTOINCREMENT 从 1 起 ⇒ 0 是"没有行"的**显式**读数，
   *   不是拿一个假 seq 冒充）。归因走旁路事件（`safeEmitDeferred`：出同步栈 + 兜异常）。
   */
  const writeTraceGuarded = (what: string, entry: Parameters<ManaCoreService['writeTrace']>[0]): number => {
    try {
      return core.writeTrace(entry)
    } catch (error) {
      safeEmitDeferred('mana/plugin/inactive', {
        id: name,
        missing: [`${what}: ${String((error as Error)?.message ?? error)}`],
        at: new Date().toISOString(),
      })
      return 0
    }
  }

  /** 字符数（按**码点**计，避免把中文算成 3 字节导致预算失真）。 */
  const injectionBudgetCharsOf = (s: string): number => [...s].length

  /**
   * 组装注入块。
   *
   * @param sid 会话 id。**不给** = 读「服务面缺省分区」（**不是**任何真会话的候选池）；
   *   给 sid 且该会话**有分区** ⇒ 与 pre-step 内读的是**同一份**状态。
   * ⚠ 为什么："服务面直取"与"真会话读"必须是**可分辨**的两件事 —— 旧实现在这里隐式读全局队列，
   *   于是"服务面拿到的块"与"某会话真会被注入的块"表面同形（判据测的可能是另一个东西）。
   */
  const evictSessionState = (sid: string): boolean => sessionStates.delete(sid)

  const sessionStateFor = (sid: string): SessionGatingState => {
    const hit = sessionStates.get(sid)
    if (hit) return hit
    const fresh: SessionGatingState = { pending: [], injectedRequests: new Set<string>(), injectedBlocks: [], lastJudgeProbability: null }
    sessionStates.set(sid, fresh)
    while (sessionStates.size > MAX_SESSION_STATES) {
      /**
       * 候选挑选（N1/N2 + N1′）：**先挑无损候选** —— `pending` / `injectedRequests` / `injectedBlocks`
       * **三项全空**的会话（过了步、但既没有候选也没有账目）。
       * ⚠ **N1′**：上一版这里漏了 `pending` ⇒ "有候选但还没注入"的会话被判成无损，
       *   逐出时**静默丢掉候选**，随后那一步落 `skip_no_candidate`，与"本来就没候选"同形。
       *   算式现在只写在 `makeEvictionRecord` 里（唯一真源），这里用同一个判定。
       * ⚠ 这不改变"上界"这件事：超限**一定**会删掉一个分区；改的只是**先删谁**与**删了要报数**。
       */
      const candidate = [...sessionStates.entries()].find(
        ([key, st]) => key !== sid && makeEvictionRecord(key, st).lossFree,
      )
      const target = candidate?.[0] ?? sessionStates.keys().next().value
      if (target === undefined || target === sid) break
      const evicted = sessionStates.get(target)
      evictSessionState(target)
      // ⚠ 先把"这次逐出真的发生了什么"算成**一条 record** 再落痕：不去读已被删掉的 Map 条目（那会得到 0）。
      const record = makeEvictionRecord(target, evicted)
      evictionLog.push(record)
      // 有界：只留最近 32 条（无界数组本身就是"该清没清"的另一种形态）。
      // ⚠ 窗口淘汰**同时记数**（同类普查）：否则"逐出很多、流水只留 32 条"与"只逐出过 32 次"同形。
      while (evictionLog.length > 32) {
        evictionLog.shift()
        evictionLogDropped += 1
      }
      logSessionEviction(record)
    }
    return fresh
  }

  const buildBlock = (sid?: string): string => {
    // ⚠ 不给 sid ⇒ 读**最近活跃会话**的分区（只读投影，既有服务面行为）；没有任何会话 ⇒ 空块。
    //   只在**已有分区**时读：读一个不存在的 key 不得**创建**该分区（那会让"问过"变成"存在过"）。
    const key = sid ?? lastActiveSession ?? SERVICE_FACE_SESSION
    const st = sessionStates.get(key)
    if (!st) return ''
    const usable = st.pending.filter((p) => !st.injectedRequests.has(p.requestId))
    if (usable.length === 0) return ''
    const raw = buildInjectionBlock(usable.map((u) => ({ requestId: u.requestId, content: u.content })))
    // 预算闸：超限则**截断**（不静默丢弃整块 —— 那会让 gate 说 injected 而实际没内容）。
    if (injectionBudgetCharsOf(raw) > config.injectionBudgetChars) {
      return raw.slice(0, config.injectionBudgetChars) + '\n</mana-memory>'
    }
    return raw
  }

  const service: ManaAttentionService = {
    plugin: name,
    ingest,
    buildBlock,
    // v10 §15.4 定档（只读）：把 `core.db` 绑进闭包，调用方不必自己开库（core 是唯一开库器）。
    retrievalKindFor: (memoryId: string, sessionId: string) => probeRetrievalKind(core, memoryId, sessionId),
    status: () => ({ plugin: name, wired: true, injections, lastGate, sessionStates: sessionStates.size, maxSessions: MAX_SESSION_STATES, evictions: evictionLog.length }),
    noSessionIdError: ERR_NO_SESSION_ID,
    upstreamSwallowedError: ERR_UPSTREAM_SWALLOWED,
    // ⚠ 显式绑定到本实例的分区表：**不给外部任何"直接读全局状态"的口子**。
    releaseSession: (sid: string) => dropSessionState(sid),
    sessionCount: () => sessionStates.size,
    hasPending: (sid: string) => (sessionStates.get(sid)?.pending.length ?? 0) > 0,
    lastActiveSession: () => lastActiveSession,
    maxSessions: MAX_SESSION_STATES,
    evictionLog: () => evictionLog.slice(),
    // ⚠ D4′：旁路 emit 的失败读数（被兜住的异常条数；0 = 没人抛）。判据据此区分
    //   「发得出去、外面收不到」与「收得到、但会炸进调用方」两种形态。
    // ⚠ 拆表后仍提供**合并视图**（按时刻排序）：既有用例/消费者不必改；"哪一类被挤掉"由 emitFailureCounts 读。
    deferredEmitFailures: () =>
      [...syncEmitFailures, ...bypassEmitFailures].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    emitFailureCounts: () => ({
      sync: syncEmitFailures.length,
      bypass: bypassEmitFailures.length,
      cap: EMIT_FAILURE_CAP,
      // ⚠ 被窗口挤掉的条目数（"丢读数也报数"）：非零即说明有失败**从未被读到过**。
      windowDropped: { ...failureWindowDropped },
    }),
    windowDroppedCounts: () => ({
      failureSync: failureWindowDropped.sync,
      failureBypass: failureWindowDropped.bypass,
      evictionLog: evictionLogDropped,
      focusDropLog: focusDropLogDropped,
    }),
    focusDropLog: () => focusDropLog.slice(),
    evictionReason: SESSION_EVICTION_REASON,
  }


  ctx.on('mana/observation', (obs: ManaObservation) => {
    // 聚焦项上限在阶段 1 生效；阶段 0 只保证通路存在。
    if (config.maxFocusItems <= 0) return
    ingest(obs)
  })

  /**
   * **Injection Gate**（W3-2 主体）。
   *
   * 三条义务见文件头二：先留痕 → 调 next() → 只做尾部追加。
   */
  ctx.on('agent/pre-step', async (payload, next) => {
    // ⚠ `sid`/`turn` 提到**外层**（不再只在 `finish` 里）：判定链的 requestId 兜底值
    //   也要用到它（见下方 `pre-step:${turn}`）。放在 finish 内会让外部拿不到（编译期 TS2304）。
    const sid = resolvePreStepSessionId((payload as { agent?: unknown })?.agent)
    /**
     * ── D1 的"取不到会话身份"处置（本席第二版；第一版是**抛**，改判理由如下）────────────
     *
     * ⚠ 为什么**不抛**：抛点在本函数**开头**，即 `await next()` **之前** ⇒ 抛出去会让
     *   **内层（下游）监听器一个都拿不到控制权** —— 那正是 G9 要防的"静默掐死下游"，
     *   只不过这次是**响亮**地掐死，破坏性一样。
     *   ⇒ 正确处置是 G9 义务与"可观测"**两件都做**：照常 `await next()`（交出控制权），
     *     同时**显式记账**（不得静默 —— 本仓首位缺陷类）。
     * ⚠ 也**不落空串分区**：`''` 会让所有会话并进同一个虚构分区（串档），且它在库上看起来
     *   完全正常（`inject_log.session_id` 是 TEXT NOT NULL，空串合法）⇒ 假绿。故本分支
     *   **完全不碰任何门控状态**（不注入、不写 inject_log、不写 trace），只记账 + 交出控制权。
     * ⚠ 为什么能在不注入的情况下仍算"失败可观测"：走**既有** `mana/plugin/inactive` 事件
     *   （8 事件契约内，非新增；core 亦用它记 backup 失败），载荷里点名真因。
     *   ⚠ 如实标注：该事件**目前没有消费方**（与文件下方 catch 分支同一现状）——
     *     它把"静默"变成"有一条事件发出"，但落库/告警仍待后续批次接。
     */
    if (sid === undefined) {
      const at = new Date().toISOString()
      /**
       * ⚠ **N3：这里以前只 `emit` 一个事件** —— 而 `mana/plugin/inactive` 全仓**零消费方**
       *   ⇒ 「发得出去、看不见」。现口径再加**两条落库/落 trace 的痕迹**（都走既有表与既有标签）：
       *   ① `mana_trace` 一行（`event_type` 取既有裸名五类之一 = observation 段，载荷点名真因）；
       *   ② `inject_log` **一行**，`session_id` 如实写 `''`（**不是**拿空串冒充某个会话），
       *      `gate='degraded_unavailable'`（本步确实未能判定注入）、`degraded=1`、`jev_prob=null`。
       *   ⇒ 「无会话身份而没注入」从此在库上**可数**，与"候选池空"（`skip_no_candidate`）可分辨。
       *   ⚠ 仍**不建分区 / 不注入**（那是串档的来源），也不改变 G9 义务（照常交出控制权）。
       */
      /**
       * ⚠ **本批（f2 收尾补齐 · F-2）修掉的形态**：这里原是一个 try 包住**两条**记账、catch 体为空
       *   ⇒ `mana_trace` 写坏时 `injectRows=0` **且没有任何点名真因的归因**，而下面的旁路事件只报
       *   `ERR_NO_SESSION_ID`（那是**本分支为何走到这里**，不是**记账为何失败**）。两件事被混成一件。
       *   ⇒ 现口径：**两条各自 try + 各自归因**（与 `finish` 的两段同一口径；R-2 已把原"三段"改成"两段"），且失败点名的真因
       *     通过同一个旁路通道发出（`safeEmitDeferred`：出同步栈 + 兜异常）。
       */
      const reportNoSidFailure = (what: string, error: unknown): void => {
        safeEmitDeferred('mana/plugin/inactive', {
          id: name,
          missing: [`${what}: ${String((error as Error)?.message ?? error)}`],
          at: new Date().toISOString(),
        })
      }
      try {
        core.writeTrace({
          eventType: stageLabel(0),
          sessionId: '',
          turnId: 0,
          payload: { reason: TRACE_REASON_NO_SESSION_ID, detail: ERR_NO_SESSION_ID },
          at,
        })
      } catch (error) {
        reportNoSidFailure('mana_trace 写入失败(无会话身份)', error)
      }
      try {
        core.writeInjectLog({
          sessionId: '',
          turnId: 0,
          requestId: 'pre-step:no-session-id',
          gate: 'degraded_unavailable',
          memoryId: null,
          blockId: null,
          reset: false,
          jevProb: null,
        })
      } catch (error) {
        reportNoSidFailure('inject_log 写入失败(无会话身份)', error)
      }
      safeEmitDeferred('mana/plugin/inactive', { id: name, missing: [ERR_NO_SESSION_ID], at })
      /**
       * ── D3′：本分支**也要**过同一条 D2 守卫（f2 席修）────────────────────────────
       * ⚠ 修前这里直接 `return await next()` ⇒ 上游吞掉 `next()` 返回值时**原样透传 `undefined`**：
       *   宿主拿到 `undefined` 决策（本步的消息被吃掉）而**这个分支不抛**，对照分支（有 sid）
       *   却抛具名错 ⇒ 同一种病因在同一文件里**两副面孔**：一副响亮、一副静默。
       *   ⇒ 两条分支共用 `isUsableEnterDecision` 与 `ERR_UPSTREAM_SWALLOWED`（唯一判据、唯一错误）。
       * ⚠ 仍然**不注入**（无会话身份就没有该会话的候选池），也不在这里落任何 inject_log：
       *   本分支的留痕已经在上面的 try 里写过了，重复写会让"无身份"在一次 pre-step 里记成两行。
       */
      const noSidNext: unknown = await next()
      // ⚠ 与主分支**同一条判据**：`assertUsableDecision` 内部用 `isUsableEnterDecision` 与
      //   `ERR_UPSTREAM_SWALLOWED`（唯一真源）。写成独立函数是为了让"两副面孔"在源码层面
      //   只有**一个**抛点 —— 变异器锚点也因此仍然唯一（若两处各写一遍，负控会因"锚点命中 2 次"
      //   直接失效：本席实测踩到过，见 .impl-attention-f2-readings.txt §写错并改判）。
      assertUsableDecision(noSidNext)
      // ⚠ 同样**原样交回**（不改写）：缺 `kind` 的读点语义见 isUsableEnterDecision 的注释。
      return noSidNext as { kind: 'enter'; messages: UserMessage[] } | { kind: 'reject' }
    }
    /** D1：本次分发所用的**会话分区**（四处状态全在这里，pre-step 内以局部名绑定）。 */
    const state = sessionStateFor(sid)
    lastActiveSession = sid
    const pending = state.pending
    const injectedRequests = state.injectedRequests
    const injectedBlocks = state.injectedBlocks
    const turn = Number((payload as { turn?: unknown })?.turn ?? 0)
    /** 落库/落 trace 统一用这一个 turnId（两处各写一次 Number.isFinite 会漂）。 */
    const turnId = Number.isFinite(turn) ? turn : 0
    /** 每次 pre-step 重置：上一轮的判定概率**不得**泄漏到本轮（否则 jev_prob 是假账）。 */
    state.lastJudgeProbability = null
    /**
     * 落痕 + 返回决策：把"留痕"做成**不可绕过**的一步（不依赖调用方记得写）。
     *
     * ## `memoryId` 逐类政策（F-02：I2 不变式必须有可数之处）
     *
     * ⚠ **为什么这条政策必须写死在这里**：core 把 `memory_id` 定义为
     *   「被注入记忆的 id；**未注入时为 null**」（`core/src/index.ts` 的 `InjectLogEntry`）。
     *   若在 `injected` 一类之外也随手塞 id，`inject_log` 里同一记忆会**跨类多行**出现，
     *   而 A1-3 的口径是「按 `memory_id` 分组、组内 >1 即判红」（`docs/mana-rollout-plan.md:453`）
     *   ⇒ 会把「判了但没过阈」这种**正常**情形读成 I2 违例（假红）。
     *   ⇒ 只有真注入那一类带 id；其余保持 null 并在此写明理由（这比硬塞一个 id 更正确）。
     *
     * | gate | memoryId | 理由 |
     * |---|---|---|
     * | `injected` | **必填** | 本类就是「注入了哪条记忆」的落点；恒 NULL ⇒ I2 数不到东西（F-02 的原缺陷） |
     * | `skip_no_candidate` | null | 候选池空 / 宿主已 reject / 门控关闭 ⇒ **没有任何记忆**参与 |
     * | `skip_below_threshold` | null | 候选是确定的，但**未注入** ⇒ 按 core 定义填 null；填了会让 A1-3 假红（见上） |
     * | `degraded_unavailable` | null | 判定链不可用 ⇒ 没有可指的记忆；降级事实由 `degraded` 列承载 |
     * | `reset` | null | 本行记的是**事件**（块已离开上下文）而非一次注入；回填会把同一记忆记成两次注入。⚠ 本行的 `reset` **列**必须为 1（显式位，见本函数写入点），`block_id` 指出**是哪一块**离开（结构位置 = 宿主消息 id，非内容水印） |
     */
    const finish = (
      gate: InjectionGate,
      extra: { memoryId?: string | null; blockId?: string | null; reset?: boolean } = {},
    ) => {
      lastGate = gate
      const reqId = pending[0]?.requestId ?? `pre-step:${turn}`
      /**
       * ⚠ **本批（f2 收尾 ②）收窄的两处归因**：原先一个 try 把 `writeInjectLog` / `writeTrace` /
       *   `ctx.emit` **三件事**都包住，异常一律记成「**inject_log 写入失败**」。而实测（risk 席）
       *   该行**已经写成功 1 行** ⇒ **原因被记错了 —— 比没记更坏**（本仓首位缺陷类：让失败不可观察，
       *   而且指向错误的位置）。
       *   ⇒ 现口径：**两段各自 try/catch，各写各的归因**（**R-2：与实现逐行对齐** —— 本段原写"三段"，
       *     但第 ③ 段（广播）已在 R-1 中删掉死 catch，广播失败改由 `emitSyncGuarded` 自己计数）：
       *     ① `inject_log` 写失败 ⇒ `inject_log 写入失败: …`
       *     ② `mana_trace` 写失败 ⇒ `mana_trace 写入失败: …`（与上一条**可分辨**）
       *     ③ 广播（`emitSyncGuarded`）失败 ⇒ **计进 `emitFailureCounts().sync`**（不冒泡、不自称落库失败）
       *   ①②走**旁路**记账（`safeEmitDeferred`：出同步栈 + 兜异常），③走同步计数；**三者都不吞下游**（G9）。
       */
      const reportBypass = (what: string, error: unknown): void => {
        safeEmitDeferred('mana/plugin/inactive', {
          id: name,
          missing: [`${what}: ${String((error as Error)?.message ?? error)}`],
          at: new Date().toISOString(),
        })
      }

      // ② 五、injection：注入审计段（每次 pre-step 必发，含五种「没注入」）
      const inj: ManaInjection = {
        sessionId: sid,
        turnId,
        requestId: reqId,
        at: new Date().toISOString(),
        gate,
        blockId: extra.blockId ?? null,
        memoryId: extra.memoryId ?? null,
        degraded: gate === 'degraded_unavailable',
      }
      // ① inject_log（本步的**主审计行**）
      try {
        core.writeInjectLog({
          sessionId: sid,
          turnId,
          requestId: reqId,
          gate,
          memoryId: extra.memoryId ?? null,
          blockId: extra.blockId ?? null,
          // ⚠ `reset` 是 core 定义的**显式位**（「与 gate='reset' 配对的显式位」）。
          //   此前生产侧**从未传过**它 ⇒ 该列零生产者：gate 说 reset、列说 0，同一事实两处读数
          //   互相矛盾，且按 reset=1 的任何查询**静默归零**（本仓首位缺陷类：让失败不可观测）。
          //   core 侧另有一处与 `degraded` **同形**的防呆（gate='reset' 蕴含本列），两层都真才算对。
          reset: extra.reset === true,
          // ⚠ 概率取**本轮判定链**的真读数：判过就记，没判/降级留 null（不得用 0 冒充）。
          jevProb: state.lastJudgeProbability,
        })
      } catch (error) {
        reportBypass('inject_log 写入失败', error)
      }

      try {
        core.writeTrace({
          eventType: stageLabel(4),
          sessionId: sid,
          turnId,
          payload: inj,
          at: inj.at,
        })
      } catch (error) {
        reportBypass('mana_trace 写入失败', error)
      }

      /**
       * ③ 广播（**主广播**：保持同步可见，但异常不冒泡、不自称落库失败）。
       *
       * ⚠ **本批（f2 最后一批 · R-1）删掉了这里原有的 `try/catch`**，理由与「为什么没有覆盖损失」：
       *   · `emitSyncGuarded` 的契约就是**从不抛**（它内部 try/catch 并把失败记进 `syncEmitFailures`）；
       *   · 因此 `catch (error) { reportBypass('注入审计广播失败', error) }` 是**不可达死路径**
       *     —— 全仓无任何测试能触发它（risk 席第 5 次普查实测）；
       *   · **无覆盖损失**：广播失败**已经有唯一入口** `emitFailureCounts().sync` / `deferredEmitFailures()`，
       *     由 X-③（必抛监听器 ⇒ 不回溢 + 计数）与 Z-⑤（摘掉兜底 ⇒ 必红）两条判据覆盖；
       *     删掉的这一支即使可达，也只是**给同一个事实写第二个归因**（两处记同一件事，必然漂开）。
       *   ⇒ 与「不可达不等于无害」同一口径：死路径是下一次改动的现成绕过件，故**真删**。
       */
      emitSyncGuarded('mana/injection', inj)
    }

    const nextResult: unknown = await next()
    /**
     * ⚠ 编译期收窄（**不是**运行时兜底）：`next()` 的返回类型在宿主类型面是
     *   `Promise<PreStepDecision>`，但**运行时**上游可能把返回值吞掉（D2 的真身是运行时事实）。
     *   故先按 `unknown` 接住，由 isUsableEnterDecision 做**唯一**的运行时判定；
     *   类型面再收窄成 `{ kind: 'enter'; messages: unknown[] } | { kind: 'reject' }`。
     *   ⇒ 不引入 `as any`：收窄的形状与宿主契约逐条对应（enter 只有这两件事要用）。
     */
    let downstream = nextResult as { kind: 'enter'; messages: UserMessage[] } | { kind: 'reject' }

    /**
     * ── D2 守卫（**合并成一条**，本席第二版）──────────────────────────────────────
     * ⚠ **抛点必须在任何审计写入之前**：抛在 writeInjectLog 之后，会在 `inject_log` 里留下一行
     *   `injected` 而宿主本步被吃掉 ⇒ 审计说成功、事实是失败（假账）。
     * ⚠ 为什么只留**一条**判据（本席第一版写错的地方，如实记下）：先前写成"先判 undefined、
     *   再判 `kind === 'enter'` 的 messages"，而后半段**裸访问** `downstream.kind`
     *   ⇒ 负控摘掉前一条守卫时崩的是 TypeError —— 报红的原因是"崩了"，不是"宿主输入被吃掉"，
     *   那是**循环论证**：判据证明的是自己没崩，不是被保护的事实。
     *   合并后只有一条通路能让后续代码跑下去（`enter` 且 messages 是数组）；摘掉它，
     *   后续读数就回到修前形态（宿主消息被吃掉 + 审计仍写 injected）。
     * ⚠ `reject` 是**合法**决策（宿主 reject 分支没有 messages）⇒ 由 isUsableEnterDecision 放行，
     *   调用方按 `kind` 分派。
     * ⚠ 两个**纯函数**调用（块组装与预算计算）故意放在守卫之前：它们不写任何状态，
     *   放在这里是为了让"摘掉守卫"的负控仍然露出**真读数**而不是 TypeError。
     */
    /**
     * ⚠ **本处原有两个死变量**（`blockPre` / `overBudgetPre`：算出来从未被读），本批真删。
     *   它们是"为了给负控留靶"留下的——但**靶子不需要体现在死变量上**：Z-② 负控用的是
     *   "摘掉守卫调用 ⇒ 读点按空表兜底 ⇒ 宿主消息被吃"这条**真路径**，与这两个变量无关。
     *   ⇒ 不可达/未被读的代码 = 下一次改动的现成绕过件（与上批删掉的 `swallowedUpstream` 同一理由）。
     */
    assertUsableDecision(downstream)
    /**
     * ⚠ **不得"归一化" `downstream`**（本席第一版在这里补 `kind:'enter'`，被 core 的 G9/R0 前置
     *   当场判红：「直通链不得改写 next 的返回值」）。本包**不注入时**必须把上游的决策**原样**交回，
     *   连补一个字段都算改写。⇒ 缺 `kind` 的语义差异只在**读点**处理（见下：只判 `reject`）。
     */
    /**
     * ⚠ **本处原先有一段"常量归一"残码，f2 收尾批已真删**（不是注释掉）：
     *   `const swallowedUpstream = nextResult === undefined || nextResult === null` +
     *   `if (swallowedUpstream) downstream = { kind: 'enter', messages: [] }`。
     *   它留在守卫**之后** ⇒ 守卫在位时**不可达**（恒 false）；而一旦有人摘掉守卫，
     *   它就会把"上游吞掉了决策"悄悄归一成"空消息决策"——**可绕的路**。
     *   ⇒ 删掉；负控（Z-②）改为复现**更真实**的形态：守卫缺席 ⇒ 读点按空表处理 ⇒ 宿主消息被吃。
     *   「不可达」不等于「无害」：不可达的死代码是下一次改动的**现成绕过件**。
     */

    // ── `reset` 检测（5 类枚举中此前**唯一无生产侧写入**的一类）──────────────
    // 语义：「该块**已离开上下文**」（`docs/contract/degradation.md` §4）。
    // 宿主的 `agent/pre-step` 每步都分发，而上下文可能被压缩/清空
    // ⇒ 先前注入的块已不在 `downstream.messages` 里。
    //
    // ⚠ **为什么必须显式记 `reset`**：块"悄悄消失"与"从未注入"表面完全同形。
    //   若不检测，`inject_log` 里那行 `injected` 会**永久标着已注入**，而上下文里
    //   其实早没了 —— 「注入审计」就成了假账（本仓首位缺陷类：让失败不可观测）。
    // ⚠ 判定口径（**逐块**）：块身份取宿主消息 id（`createUserMessage` 分配的**结构位置**），
    //   并用**块自身的 wrapper 特征**（`<mana-memory>`）复认这条消息里装的确实是本包的块。
    //   不用内容水印（往块里塞可反查标识）是因为 A1-9 要求审计不泄内容 —— 审计行不泄、
    //   上下文里泄，同样是泄漏；故「是哪一块」只能由结构位置回答。
    // ⚠ 为什么不是「上下文里还有没有**任意**一块」（**本批修的 D1 缺陷**）：
    //   `msgs.some(含 wrapper)` 把**块级有序表**当**单个布尔**用 ⇒ 连续注入两块后只丢最老那块时
    //   仍读到「还有块在」⇒ **不记 reset**，而旧块那行 `injected` 从此永久标着已注入（假账）。
    //   也**不是**「只看最近一块」—— 那只是把同样的假账挪到下一块那行 `injected` 上。
    // ⚠ `PreStepDecision` 是**联合类型**：`reject` 分支没有 `messages` 字段
    //   ⇒ 必须先按 `kind` 收窄，否则连 `messages` 都取不到（编译期报 TS2339 —— 这是**正确报错**，
    //     不要用 `as any` 压掉，那会把"拒绝分支没有消息"这个事实变成不可见）。
    // ⚠ 宿主语义（`dsh-agent-loop/lib/index.js:920`）：**只判 `reject`**，其余一律"进入这一步"。
    //   ⇒ 这里用 `!== 'reject'` 而不是 `=== 'enter'`：缺 `kind` 的合法决策（宿主自己也这么发）
    //   也必须走 reset 检测，否则该形态下 reset 会**静默漏报**（把宽松读成"不需要检测"）。
    /**
     * ⚠ 这里的 `downstream?` 可选链**不是兜底**（守卫在位时 `downstream` 必是对象，由
     *   `assertUsableDecision` 保证）。它存在的唯一理由：让 `Z-②` 那条**单变量负控**
     *   （只摘掉守卫调用）能跑到这里、从而露出**真读数**（宿主消息被整批吃掉 + 审计写 injected）。
     *   若改成严格访问，摘守卫会先崩成 `TypeError` ⇒ 负控报红的原因变成"崩了"而不是被保护的事实
     *   （f2 席实测踩到：单变量负控直接失效，见 .impl-attention-f2-readings.txt）。
     */
    if (injectedBlocks.length > 0 && downstream?.kind !== 'reject') {
      // ⚠ 同上：宿主语义里除 `reject` 外都是"进入这一步"；messages 缺失时按空表处理**只为让负控可读**。
      const msgs = Array.isArray(downstream?.messages) ? downstream.messages : []
      /** 这一块还在上下文里吗（身份 = 消息 id；再核一次 wrapper：id 撞车或内容被换都不算「还在」）。 */
      const stillInContext = (messageId: string): boolean =>
        msgs.some((m) => {
          if (String(m?.id ?? '') !== messageId) return false
          return (Array.isArray(m?.content) ? m.content : []).some(
            (b) => typeof b?.text === 'string' && b.text.includes('<mana-memory>'),
          )
        })
      /** 本轮核对为「已离开」的那些块（**只摘这些**，其余继续跟踪，下一轮再核）。 */
      const gone = injectedBlocks.filter((blk) => !stillInContext(blk.messageId))
      if (gone.length > 0) {
        for (const blk of gone) injectedBlocks.splice(injectedBlocks.indexOf(blk), 1)
        /**
         * **逐块**记一行 reset：丢掉的是**哪一块**由 `block_id` 指出
         * ⇒ 「两块里只丢了最老那块」与「两块都丢了」在审计上可分辨（A1-13/A1-14 的读数是**行级**的）。
         * `reset: true` 是显式位（core 的列语义）；行级留痕的数量与「本轮发现几块离开」一致。
         * memoryId 政策：null（本行是「块离开上下文」这一**事件**，不是注入；见 finish 政策表）。
         */
        for (const blk of gone) finish('reset', { reset: true, blockId: blk.blockId })
        return downstream
      }
    }

    // 下游若已决定 reject，本门控**不注入**（尊重宿主决策），但仍留痕。
    // ⚠ 本类（连同下面「门控关闭」「候选池空」共 3 处）**本来就没有**「哪条记忆」可言
    //   ⇒ memoryId 保持 null（政策表见 finish；硬塞一个 id 是另一种假绿）。
    if (downstream?.kind === 'reject') {
      finish('skip_no_candidate')
      return downstream
    }

    const block = buildBlock(sid)
    if (!config.injectionEnabled) {
      // 门控关闭：**仍留痕**（否则「关掉了」与「静默失效」同形）。memoryId=null（无记忆被注入）。
      finish('skip_no_candidate')
      return downstream
    }
    if (block === '') {
      // 候选池空：留痕 skip_no_candidate（A1-13 的五类之一）。memoryId=null（无候选 ⇒ 无记忆可指）。
      finish('skip_no_candidate')
      return downstream
    }

    // ── 判定链：`mana/jev/judge`（**waterfall，必须用 ctx.waterfall 分发**）────
    // ⚠ 用 `ctx.emit` 会**同步不炸、异步炸**（G6，本仓 judge-chain.test.mjs 的 J4 已实测钉住）
    //   ⇒ 这里必须 `ctx.waterfall`，且必须自己提供默认 `next`（宿主不参与本事件的默认值）。
    //
    // 它给出三态之一：
    //   · 可用且过阈 ⇒ 继续注入（gate='injected'）
    //   · 可用但未过阈 ⇒ `skip_below_threshold`（**判了但没放行**，与"没候选"必须分辨）
    //   · 不可用/降级 ⇒ `degraded_unavailable`（fail-closed：不注入但**必须留痕**）
    // ⚠ `req` 提到 try **外层**：判定结果的载荷（decision 段）要引用 req.judgeType / req.requestId
    //   做回填，留在 try 内会让二者作用域外不可见（TS2304 —— 这是正确报错，不要用 var 压掉）。
    const req = {
      requestId: pending[0]?.requestId ?? `pre-step:${turn}`,
      judgeType: 'noul',
      state: config.judgeState || '',
      question: config.judgeQuestion,
      threshold: config.jevThreshold,
      source: name,
    }
    // ⚠ requestId 可空是**如实**的：ctx.waterfall 的默认 next 与桩监听器都可能不给它，
    //   decision 载荷回填时用 ?? req.requestId 兜底（关联键不得缺省成 undefined 落库）。
    let judge: { requestId?: string; value?: string; probability?: number | null; degraded?: boolean; reason?: string | null } | null = null
    try {
      judge = await ctx.waterfall('mana/jev/judge', req, async () => ({
        requestId: req.requestId,
        source: name,
        value: 'unknown',
        probability: null,
        degraded: true,
        reason: 'no-judge-listener',
      }))
    } catch (error) {
      // 判定链抛错 ⇒ 视为不可用（fail-closed），**但必须留痕**（A1-14）。
      judge = { degraded: true, reason: `judge-threw: ${String((error as Error)?.message ?? error)}` }
    }

    // ── 三、decision：判定结果（含失败/降级态）—— A1-1 五类中此前**零生产者**的两类之一 ──
    //
    // ⚠ 为什么降级也必须发：G8 要求降级**落显式字段**。若降级时干脆不发事件，
    //   mana_trace 里「判了且过阈」「判了没过阈」「**根本没判成**」三态同形（首位缺陷类）。
    //   ⇒ 三态各自有值：value='yes' / 'no' / 'unknown'，probability 恒为真读数或 null。
    // ⚠ value 的缺省是 'unknown' 而**不是 'no'**（domain.ts:91 原文）：把降级读成「否」，
    //   会让判定链故障在消费侧表现为一个**正常的否定结论**。
    const decisionValue: ManaDecision['value'] =
      judge?.value === 'yes' || judge?.value === 'no' ? judge.value : 'unknown'
    // ⚠ probability 只认真数字；用 typeof 而不是 falsy 判空 —— 0 是合法概率，不得被当缺省吞掉。
    const decisionProbability = typeof judge?.probability === 'number' ? judge.probability : null
    const decisionDegraded = judge === null || judge.degraded === true
    const decision: ManaDecision = {
      sessionId: sid,
      turnId,
      requestId: judge?.requestId ?? req.requestId,
      at: new Date().toISOString(),
      judgeType: req.judgeType,
      source: name,
      value: decisionValue,
      probability: decisionProbability,
      degraded: decisionDegraded,
      reason: judge?.reason ?? null,
    }
    // ⚠ 同上：本段在宿主 loop 的 dispatch 栈内，写失败冒泡 = 炸掉这一步（同类病因）。
    writeTraceGuarded('mana_trace 写入失败(decision)', {
      eventType: stageLabel(2),
      sessionId: sid,
      turnId,
      payload: decision,
      at: decision.at,
    })
    emitSyncGuarded('mana/decision', decision)
    // 仅当**本轮**确实判过（非降级）才记概率：降级时保持 null，不得用 0 冒充。
    state.lastJudgeProbability = decisionDegraded ? null : decisionProbability

    if (!judge || judge.degraded === true) {
      // fail-closed：不注入，但留痕（A1-14 两条都要真）。
      // memoryId=null（判定链不可用 ⇒ 没有可指的记忆；降级事实由 degraded 列承载）。
      finish('degraded_unavailable')
      return downstream
    }
    const prob = typeof judge.probability === 'number' ? judge.probability : null
    if (prob === null || prob < config.jevThreshold) {
      // 判了但未过阈：与"候选池空"必须可分辨（否则门控为何没注入就说不清）。
      // ⚠ memoryId **有意留 null**：候选虽确定，但本条**未注入** —— core 的定义就是
      //   「未注入时为 null」。且 A1-3 是「按 memory_id 分组、组内 >1 即判红」，
      //   填上会让"同一候选连续多轮没过阈"被读成 I2 违例（假红）。见 finish 政策表。
      finish('skip_below_threshold')
      return downstream
    }

    // ✅ 真注入：**尾部追加**（绝不动既有消息 —— A1-7 前缀缓存友好）。
    //
    // ⚠ 必须用宿主官方的 `createUserMessage` 构造消息，**不能**手搓 `{role,content}`：
    //   宿主 `UserMessage` 的真实形状是 `{ id, role, content: ContentBlock[], source }`
    //   （`dsh-llm/lib/types/message.d.ts` 的 `MessageBase`）——
    //   `id`（稳定身份）与 `source`（生产者标记）都是**必填**。
    //   手搓的 `{role:'user', content:'...'}` 会被编译期拒掉（本仓实测 TS2345）；
    //   若用 `as any` 压掉，就是把不合格消息塞进宿主循环 ⇒ 运行期才炸。
    // ⚠ D2：`enter` 决策**必须**带 messages 数组（宿主契约）。缺它不是"空消息"，是契约破坏 ⇒ 大声抛。
    // ⚠ messages 由上方守卫保证是数组（类型收窄在守卫处）；此处的 `Array.isArray` 与可选链
    //   同样**只为让 Z-② 单变量负控露出真读数**（守卫缺席 ⇒ `undefined` ⇒ 按空表处理 ⇒ 宿主消息被吃）。
    const messages = Array.isArray(downstream?.messages) ? downstream.messages : []
    const injected = createUserMessage({
      content: [{ type: 'text', text: block }],
      source: { kind: 'user' },
    })
    // ⚠ **F-02 的关键一行**：`memoryId` 必须在清空 `pending` **之前**取。
    //
    //   口径：本阶段"被注入的单元"= `pending` 里那批聚焦项，其稳定身份是 `requestId`
    //   —— 也正是 I2 去重所用的键（`injectedRequests`）。`memory_items.id` 要等
    //   **召回驱动的注入**落地（B3.x）才会出现在这条链上，届时此处应改传真实记忆 id。
    //   ⚠ 但即便那时，本列仍是「注入了哪条」的**唯一**落点，见下条。
    //
    //   ⚠ 相邻缺陷（**本批不修**，避免越界）：`finish` 内部的 `requestId` 取
    //     `pending[0]?.requestId ?? 'pre-step:'+turn`，而此处 `pending` 紧接着被清空
    //     ⇒ `injected` 行的 `request_id` 实际落成 `pre-step:N`（**丢掉了候选 id**）。
    //     ⇒ 本行的 `memoryId` 是该行唯一能指回"注入了哪条"的列，恒 NULL 即 I2 无可数之处。
    //
    //   ⚠ 已知缺口（如实标注，不假装覆盖）：一个审计行只装得下**一个** memory_id，
    //     而本块可含多条 ⇒ 记**首条**，其余条不逐个可查。
    const injectedMemoryId = pending[0]?.requestId ?? null
    for (const p of pending) injectedRequests.add(p.requestId)
    pending.length = 0
    injections += 1
    const blockId = `blk-${injections}`
    // 记入「待**逐块**核对是否仍在上下文」的有序表：身份取宿主给这条块消息的 `id`（结构位置）。
    // 下次 pre-step 若**这一块**找不到 ⇒ 记 gate='reset'（只丢最老那块时也能被点名，见 D1 修复）。
    injectedBlocks.push({ blockId, messageId: String(injected.id) })
    finish('injected', { blockId, memoryId: injectedMemoryId })
    return {
      ...downstream,
      kind: 'enter',
      messages: [...messages, injected],
    }
  })

  /**
   * 会话结束 ⇒ 释放该会话的门控状态（D1）。
   * ⚠ 不做这件事的后果不是"内存涨"这么轻：分区表会变成**永不清理的全局表**，而它的键是会话 id
   *   ⇒ 宿主重启前一直涨，且**没有任何读数能看出该清没清**（本仓首位缺陷类）。
   */
  ctx.on('agent/disposed', (payload: { agent?: unknown }) => {
    const ended = resolvePreStepSessionId(payload?.agent)
    if (ended !== undefined) dropSessionState(ended)
  })

  ctx.effect(() => {
    const dispose = ctx.provide('mana-attention', service)
    return () => dispose()
  }, 'dsh-mana-attention: service')

  void registerPassThroughPreStep
}
