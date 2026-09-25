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
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  registerPassThroughPreStep,
  type InjectionGate,
  type ManaAttention,
  type ManaCoreService,
  type ManaObservation,
} from 'dsh-mana-core'

export const name = 'mana-attention'

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
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-attention': ManaAttentionService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-attention: 缺少 mana-core 服务（inject 未满足）')

  /** 本 session 内已放行、待注入的聚焦项（注入后即清，避免重复注入）。 */
  const pending: ManaAttention[] = []
  /** 已注入过的 requestId（I2：每条记忆每 session 最多注入一次）。 */
  const injectedRequests = new Set<string>()
  /**
   * 已注入、但**是否仍在上下文中**尚未核对的块（`reset` 检测用）。
   *
   * ⚠ 存的是 blockId 集合；内容不进这里（A1-9：审计不泄内容，内存态同理）。
   */
  const injectedBlocks = new Set<string>()
  let injections = 0
  let lastGate: InjectionGate | null = null

  const ingest = (obs: ManaObservation): number => {
    // 真写一行：这是「卸载即净」可被机检的唯一依据（见文件头一）。
    const seq = core.writeTrace({
      eventType: 'observation',
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
    if (config.maxFocusItems > 0) {
      pending.push(att)
      while (pending.length > config.maxFocusItems) pending.shift()
    }
    ctx.emit('mana/attention', att)
    return seq
  }

  /** 字符数（按**码点**计，避免把中文算成 3 字节导致预算失真）。 */
  const injectionBudgetCharsOf = (s: string): number => [...s].length

  const buildBlock = (): string => {
    const usable = pending.filter((p) => !injectedRequests.has(p.requestId))
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
    status: () => ({ plugin: name, wired: true, injections, lastGate }),
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
    const sid = String((payload as { agent?: { session?: { id?: unknown } } })?.agent?.session?.id ?? '')
    const turn = Number((payload as { turn?: unknown })?.turn ?? 0)
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
     * | `reset` | null | 本行记的是**事件**（块已离开上下文）而非一次注入；回填会把同一记忆记成两次注入 |
     */
    const finish = (gate: InjectionGate, extra: { memoryId?: string | null; blockId?: string | null } = {}) => {
      lastGate = gate
      try {
        core.writeInjectLog({
          sessionId: sid,
          turnId: Number.isFinite(turn) ? turn : 0,
          requestId: pending[0]?.requestId ?? `pre-step:${turn}`,
          gate,
          memoryId: extra.memoryId ?? null,
          blockId: extra.blockId ?? null,
          // ⚠ 不传 jevProb：本轮无判定链 ⇒ 概率**不可用**。留 null（不得用 0 冒充）。
          jevProb: null,
        })
      } catch (error) {
        // 留痕失败**不得**吞掉下游：宿主循环优先，错误走 ctx.emit 旁路记录（G8 显式记账）。
        ctx.emit('mana/plugin/inactive', {
          id: name,
          missing: [`inject_log 写入失败: ${String((error as Error)?.message ?? error)}`],
          at: new Date().toISOString(),
        })
      }
    }

    const downstream = await next()

    // ── `reset` 检测（5 类枚举中此前**唯一无生产侧写入**的一类）──────────────
    // 语义：「该块**已离开上下文**」（`docs/contract/degradation.md` §4）。
    // 宿主的 `agent/pre-step` 每步都分发，而上下文可能被压缩/清空
    // ⇒ 先前注入的块已不在 `downstream.messages` 里。
    //
    // ⚠ **为什么必须显式记 `reset`**：块"悄悄消失"与"从未注入"表面完全同形。
    //   若不检测，`inject_log` 里那行 `injected` 会**永久标着已注入**，而上下文里
    //   其实早没了 —— 「注入审计」就成了假账（本仓首位缺陷类：让失败不可观测）。
    // ⚠ 判定口径：用**块自身的 wrapper 特征**（`<mana-memory>`）在当前消息里找。
    //   不用 blockId 是因为块内容里**不得留可反查的标识**（A1-9 要求审计不泄内容）。
    // ⚠ `PreStepDecision` 是**联合类型**：`reject` 分支没有 `messages` 字段
    //   ⇒ 必须先按 `kind` 收窄，否则连 `messages` 都取不到（编译期报 TS2339 —— 这是**正确报错**，
    //     不要用 `as any` 压掉，那会把"拒绝分支没有消息"这个事实变成不可见）。
    if (injectedBlocks.size > 0 && downstream?.kind === 'enter') {
      const msgs = Array.isArray(downstream.messages) ? downstream.messages : []
      const stillThere = msgs.some((m) =>
        (Array.isArray(m?.content) ? m.content : []).some(
          (b) => typeof b?.text === 'string' && b.text.includes('<mana-memory>'),
        ),
      )
      if (!stillThere) {
        injectedBlocks.clear()
        // memoryId 政策：null（本行是「块离开上下文」这一**事件**，不是注入；见 finish 政策表）。
        finish('reset')
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

    const block = buildBlock()
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
    let judge: { value?: string; probability?: number | null; degraded?: boolean; reason?: string | null } | null = null
    try {
      const req = {
        requestId: pending[0]?.requestId ?? `pre-step:${turn}`,
        judgeType: 'noul',
        state: config.judgeState || '',
        question: config.judgeQuestion,
        threshold: config.jevThreshold,
        source: name,
      }
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
    // 记入"待核对是否仍在上下文"的集合：下次 pre-step 若找不到它 ⇒ 记 gate='reset'。
    injectedBlocks.add(blockId)
    finish('injected', { blockId, memoryId: injectedMemoryId })
    return {
      ...downstream,
      kind: 'enter',
      messages: [...messages, injected],
    }
  })

  ctx.effect(() => {
    const dispose = ctx.provide('mana-attention', service)
    return () => dispose()
  }, 'dsh-mana-attention: service')

  void registerPassThroughPreStep
}
