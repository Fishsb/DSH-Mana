/**
 * `dsh-mana-llm` —— Mana 的 **LLM 生成唯一出口**（L-01）。
 *
 * ── 本包做什么 ────────────────────────────────────────────────────────────────
 * 往宿主 `ctx.llm`（`LlmRuntime`）注册**一条** `'mana'` 路由，使 Mana 各模块
 * 走「provider='mana'」这一个出口发起生成，而不是各自去拿 provider key。
 * ⚠ 本批**只做通道，不做 Prompt 库**（v10 §25 的 23 个 Prompt 无一可判据；
 *   先有调用点才谈 Prompt）。
 *
 * ── 本包**不**做什么（如实声明，不许读成已实现）────────────────────────────────
 *  · 不实现 provider HTTP 客户端：本适配器是**转发层**，把 'mana' 路由的请求
 *    转给 `upstreamProvider` 指定的上游路由（由别的适配器真正出网）。
 *    ⇒ 「Mana 有自己的模型接入」**不是本包的事实**，别读成有。
 *  · 不做 Prompt 模板 / 不做缓存 / 不做重试策略（`providerRetryPolicy` 走宿主缺省）。
 *  · `listModels` / `resolveModel` 走 `LlmAdapter` 的缺省实现（只回显路由与模型名，
 *    不向上游追问）—— 这是一条**已知的、有意留的**边界：目录面是 advisory，不控路由。
 *
 * ── 为什么 inject 只声明 `['mana-core']`（**不**声明 'llm'）──────────────────────
 * 声明的 inject 依赖若未满足，cordis 会让本插件**停在 waiting**。而 `ctx.llm` 只在
 * **装了 LLM 适配器的宿主**里才有；在没有 LLM 面的宿主（如本仓 R0 装配判据的裸
 * Loader —— 它只装 Mana 13 包）里，把 'llm' 写进 inject 会让本包**根本装配不上**，
 * 于是「包形状对不对」这件事在那个环境里变得不可观测。
 * ⇒ 取既有包的保守口径：只 inject 'mana-core'；`ctx.llm` 走 **`ctx.inject(['llm'], …)`
 *   动态等待**（实测：llm 先到/后到都能触发回调，见 tests）。
 *   ⚠ 代价如实记：宿主**没有** LLM 面时，本包装配成功但**路由不会被注册**
 *     （`status().routeRegistered === false`）—— 这是显式可读的降级，不是静默失败。
 *
 * ── 路由释放：为什么既靠 fiber 又显式 `ctx.effect`（**实测归属矩阵**）──────────
 * 本席 2026-09-25 实测（`node --input-type=module` 直跑，五站点对照）：
 *
 *   | 注册站点                                  | 卸载插件后 'mana' 路由 |
 *   |---|---|
 *   | ctx.llm 裸调（apply 内）                  | 消失（宿主内部 effect 挂在**调用方 fiber**） |
 *   | ctx.llm + ctx.effect 显式 handle          | 消失 |
 *   | ctx.effect 但 **finisher 被注释掉**        | **仍然消失** ← 见下 |
 *   | ctx.root.llm（脱离本 fiber）               | **残留 ⇒ 泄漏** |
 *   | ctx.root.llm + ctx.effect 显式 handle     | 消失 |
 *
 * ⚠ 由上表可得两个**必须说清**的结论（否则会写出假判据）：
 *  ① **仅靠「注释掉 ctx.effect 的 finisher」造不出泄漏**：`registerAdapter` 内部
 *     用的是 `this.ctx.effect(...)`，绑在**调用方 fiber** 上；卸载该 fiber 时 cordis
 *     会把它的全部 effect 一起释放 ⇒ 路由照样消失。故「注释掉 finisher ⇒ 路由仍在」
 *     这个对拍**前提是假的**（本席实测 `卸载后残留=0`）。**不许**写一条断言"路由仍在"
 *     的假对拍来凑数。
 *  ② **显式 `ctx.effect` 真正防的是「注册逃出本 fiber」**（上表第 4 行）：
 *     若有人图省事改走 `ctx.root.llm`，fiber 归属就丢了 ⇒ 卸载后路由残留。
 *     此时**显式 effect 的 finisher 是唯一的释放者**（第 5 行）。
 * ⇒ 故本包**同时**保留两条腿，且负向对拍打在**归属维度**上（见 tests 的差分对拍：
 *   同一探针分别喂 [真实现] 与 [故意逃逸的泄漏变体]，必须一个"消失"、一个"残留"）。
 *
 * ── 消息构造：必须用宿主官方构造函数 ─────────────────────────────────────────
 * `packages/attention/src/index.ts` 的既有教训（本仓实测）：手搓 `{role, content}`
 * 会缺宿主消息基类字段，注入块在宿主侧被**拒绝或静默丢弃**。故本包：
 *  · 导出 `manaUserMessage()` / `manaSystemMessage()` —— 唯一出口同时是**唯一入口**，
 *    内部只调 `createUserMessage` / `createSystemMessage`，绝不手搓；
 *  · 转发前用 `assertHostMessages()` 体检：缺 `id` 或 `content` 非数组 ⇒ **显式报错**，
 *    不让它在宿主侧变成一条指不到真因的失败。
 *
 * ── 自转发是**必须挡**的（实测后果 = OOM，不是慢）──────────────────────────────
 * 本席实测：让 'mana' 适配器把请求转回 'mana' 自己 ⇒ `llm.stream` 递归自调用，
 * 节点在 ~119s 内 **JavaScript heap out of memory**（4GB 堆耗尽后 FATAL ERROR）。
 * 这不是"性能问题"，是**必然的进程级故障** ⇒ 在 `apply` 阶段就拒绝该配置
 * （fail fast），而不是等运行期爆栈。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import {
  LlmAdapter,
  LlmError,
  createSystemMessage,
  createUserMessage,
  type ContentBlock,
  type GenerateOptions,
  type Message,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'

export const name = 'mana-llm'

/**
 * ⚠ **只声明 `mana-core`**：不写 'llm'（理由见文件头）。
 * 其余 Mana 包同此保守口径，避免在没有对应服务的宿主里停在 waiting。
 */
export const inject: string[] = ['mana-core']

/** 本包注册到 `ctx.llm` 的**唯一**路由名（唯一出口的"出口名"）。 */
export const MANA_PROVIDER = 'mana'

export interface Config {
  /** 上游路由名：'mana' 路由的请求转发给它（由别的适配器真正出网）。 */
  upstreamProvider: string
  /** 上游模型 id；留空则沿用调用方传入的 `options.model`。 */
  upstreamModel: string
}

/**
 * ⚠ **本包刻意只有 2 个配置项，且两项都真被消费**（`upstreamProvider` 决定转发目标、
 * `upstreamModel` 决定模型覆盖）—— 见 `ManaAdapter.stream()`。
 *
 * 本席曾写过一个第 3 项 `failWhenUnconfigured: boolean`，**已删除**：它在实现里
 * **零消费**（两档都走同一条 `throw new LlmError(..., 'NO_ADAPTER')`）⇒ 是**假旋钮**：
 * 改它没有任何可观测差异，却让人以为「关掉它就能不报错」。
 * 这与本仓 `packages/long-term` 删掉 `enabled` 那条处置**同源**（声明了却零消费的开关
 * 与「静默失效」同类）。两条修法（做真 / 删掉）本席选**删掉**：未配置上游本就**必须**
 * 显式失败 —— "静默回空流"会被下游读成"模型没说话"，正是 G8/G11 反复抓的形态。
 */
export const Config: Schema<Config> = Schema.object({
  upstreamProvider: Schema.string().default(''),
  upstreamModel: Schema.string().default(''),
})

/**
 * 一次生成请求（**服务面**的入参）。
 *
 * ⚠ 消息构造口径被**故意**收成「文本进、文本出」：调用方给文本，宿主消息由本包用官方
 *   构造函数造（见 `manaUserMessage`）。⇒「唯一出口同时是唯一入口」这条不变量
 *   由**类型面**强制，不靠调用方自觉。
 */
export interface ManaGenerateRequest {
  /** 渲染好的 system prompt（来自 `dsh-mana-prompts` 的系统模板常量）；省略则不传 system。 */
  readonly system?: string
  /** 用户侧文本。 */
  readonly prompt: string
  /** 覆盖模型名（省略 = 适配器的 upstreamModel / 上游缺省）。 */
  readonly model?: string
  /** 取消信号，原样透传给宿主（宿主契约要求适配器尊重取消）。 */
  readonly signal?: AbortSignal
}

/** 生成失败的可枚举归类（G8：降级必须落显式字段，不得只留一句 message）。 */
export type ManaGenerateDegradation =
  | 'no-llm-surface'
  | 'no-upstream'
  | 'no-model'
  | 'stream-error'
  | 'host-error-finish'

/**
 * 一次生成的结果。
 *
 * ⚠ **三态可分辨**（本仓纪律：不得用「空字符串」同时表达三种意思）：
 *   · `ok:true`  ⇒ `text` 是上游真产出的拼接结果（**可能仍是空串** —— 那是上游的事实，如实记）；
 *   · `ok:false` ⇒ `reason` 非空且 `degraded` 已归类；
 *   · `callId` 每次不同，供**调用方**落自己的审计行（本包不做生成侧自证）。
 */
export type ManaGenerateResult =
  | {
      readonly ok: true
      readonly text: string
      readonly callId: string
      readonly chunks: number
      readonly finishReason: string | null
    }
  | {
      readonly ok: false
      readonly text: null
      readonly callId: string
      readonly chunks: number
      readonly reason: string
      readonly degraded: ManaGenerateDegradation
    }

/** 本包对外服务面（`ctx.get('mana-llm')`）。 */
export interface ManaLlmService {
  readonly plugin: string
  /** 注册出的路由名（唯一出口的名字）。 */
  readonly provider: string
  /**
   * **生成入口**（服务面）：聚合宿主 `llm.stream()` 的块流为一次结果。
   *
   * ⚠ 为什么各包必须走本方法、不许直接用 `ctx.llm`：
   *   前者使「Mana 的生成都经 `'mana'` 路由」成为**接线事实**（可 grep、可机检）；
   *   后者会让每个包各自持一份路由名与消息构造方式 —— 那正是本包存在要防的形态。
   */
  generate(request: ManaGenerateRequest): Promise<ManaGenerateResult>
  /**
   * 状态面。`wired` 恒为 true（服务已 provide）；
   * `routeRegistered` 才是"路由真的挂上了没"——**这两件事必须能分开读**，
   * 否则"插件装上了"会被当成"通道通了"（本仓 G11：装配清单 ≠ 生效）。
   */
  status(): {
    plugin: string
    wired: boolean
    provider: string
    routeRegistered: boolean
    /** 上游路由名（空 = 未配置 ⇒ 调用会显式失败）。 */
    upstreamProvider: string
    /** 当前注册的路由集合快照（只读，取不到 llm 面时为 null）。 */
    registeredRoutes(): string[] | null
  }
  /** 宿主的 `ctx.llm` 面当前是否可见（没有 LLM 面的宿主里为 false）。 */
  hasLlm(): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-llm': ManaLlmService
  }
}

/**
 * 构造一条**宿主官方** user 消息（唯一入口）。
 * ⚠ 内部只调 `createUserMessage`；手搓 `{role,content}` 会缺基类字段
 *   （`id` / `source` / `content: ContentBlock[]`），在宿主侧被拒绝或静默丢弃。
 */
export function manaUserMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: String(text ?? '') }],
    // `source.kind` 的取值域由宿主 `MessageSourceMap` 闭合；user 消息只接受 'user'。
    source: { kind: 'user' },
  })
}

/** 构造一条**宿主官方** system 消息（渲染好的 system prompt）。 */
export function manaSystemMessage(text: string) {
  return createSystemMessage(String(text ?? ''))
}

/** 消息体检结论（`errors` 为空即通过）。 */
export interface MessageCheck {
  ok: boolean
  errors: string[]
}

/**
 * 体检一组消息是否**真是宿主消息**（而不是手搓的 `{role, content}`）。
 *
 * ⚠ 为什么不让它就这样发出去：手搓对象缺 `id` / `source`，宿主或在适配器边界
 * 报一条**指不到真因**的错，或被静默丢弃 ⇒ 「生成没结果」会被归因到模型侧。
 * 本函数把这件事前移到**通道边界**，并给出可判的结论。
 */
export function assertHostMessages(messages: readonly unknown[]): MessageCheck {
  const errors: string[] = []
  if (!Array.isArray(messages)) return { ok: false, errors: ['messages 不是数组'] }
  messages.forEach((m, i) => {
    if (!m || typeof m !== 'object') {
      errors.push(`[${i}] 不是对象`)
      return
    }
    const o = m as Record<string, unknown>
    if (typeof o.id !== 'string' || o.id.length === 0) {
      errors.push(`[${i}] 缺 id ⇒ 疑似手搓 {role,content}（必须用 createUserMessage 等宿主构造函数）`)
    }
    if (!Array.isArray(o.content)) {
      errors.push(`[${i}] content 不是数组 ⇒ 疑似手搓字符串 content（宿主是 ContentBlock[]）`)
    }
    if (!o.source || typeof o.source !== 'object') {
      errors.push(`[${i}] 缺 source ⇒ 疑似手搓（宿主消息基类要求 source）`)
    } else if (typeof (o.source as Record<string, unknown>).kind !== 'string') {
      errors.push(`[${i}] source.kind 缺失 ⇒ 未被宿主构造函数产出`)
    }
  })
  return { ok: errors.length === 0, errors }
}

/**
 * Mana 的 LLM 适配器：`'mana'` 路由的**转发层**。
 *
 * `stream()` 是 `LlmAdapter` 唯一必实现方法（其余 providerInfo / resolveModel /
 * prepareCall 均有缺省）。本实现：
 *  ① 体检入参消息（手搓对象在此**显式失败**，不放到宿主侧静默丢）；
 *  ② 未配置上游 ⇒ 抛 `LlmError`（宿主归一成终态 error finish，**可观测**）；
 *  ③ 否则逐块转发上游路由的 chunk（**不改写** chunk，保持宿主协议原样）；
 *  ④ `options.signal` 原样透传（宿主契约要求适配器必须尊重取消）。
 */
export class ManaAdapter extends LlmAdapter {
  private readonly upstreamProvider: string
  private readonly upstreamModel: string

  constructor(config: Pick<Config, 'upstreamProvider' | 'upstreamModel'>) {
    super()
    this.upstreamProvider = String(config.upstreamProvider ?? '').trim()
    this.upstreamModel = String(config.upstreamModel ?? '').trim()
  }

  /**
   * 路由的展示元数据。
   * ⚠ 必须**保持 id == provider**（宿主会在 `prepareRoutes` 里校验，不符即
   * `INVALID_ADAPTER`）；这里只换展示名，不动 id。
   */
  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'Mana LLM 通道' }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const check = assertHostMessages(options.messages as readonly unknown[])
    if (!check.ok) {
      throw new LlmError(
        `mana-llm: 入参消息不是宿主消息（${check.errors.join('；')}）—— 必须用 createUserMessage 等宿主构造函数构造`,
        'INVALID_ARGS',
      )
    }
    if (!this.upstreamProvider) {
      throw new LlmError(
        "mana-llm: 未配置 upstreamProvider —— 'mana' 路由是转发层，需在配置里给出上游路由名",
        'NO_ADAPTER',
      )
    }
    const upstream = this.upstreamProvider
    const model = this.upstreamModel || options.model
    // ⚠ 自转发在 apply 阶段已被拒（实测后果 = 进程 OOM）；此处再挡一道是**纵深防御**，
    //   不是重复：配置可被运行期替换，而 OOM 是不可恢复的。
    if (upstream === options.provider) {
      throw new LlmError(
        `mana-llm: 上游路由 == 本路由（${upstream}）⇒ 自转发会造成无界递归（实测 OOM），已拒绝`,
        'INVALID_ARGS',
      )
    }
    const runtime = this.runtime
    if (!runtime) {
      throw new LlmError('mana-llm: 适配器未绑定 LlmRuntime（装配期异常）', 'INVALID_ADAPTER')
    }
    for await (const chunk of runtime.stream({ ...options, provider: upstream, model })) {
      yield chunk
    }
  }

  /** 由 `apply` 注入的宿主 LLM 面（适配器自身拿不到 `ctx`，故显式传入）。 */
  runtime: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> } | null = null
}

/** 插件主体。 */
export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-llm: 缺少 mana-core 服务（inject 未满足）')

  const upstream = String(config.upstreamProvider ?? '').trim()
  /** 适配器配置的模型名（服务面的 generate 需要它：宿主不接受空 model，见其注释）。 */
  const upstreamModel = String(config.upstreamModel ?? '').trim()
  // ⚠ fail fast：自转发不是"配置写错了会慢一点"，而是**必然的进程级故障**（实测 OOM）。
  if (upstream === MANA_PROVIDER) {
    throw new Error(
      `mana-llm: upstreamProvider 不得等于自身路由 '${MANA_PROVIDER}'` +
        '（实测：自转发导致 llm.stream 无界递归 ⇒ JavaScript heap out of memory）',
    )
  }

  const adapter = new ManaAdapter(config)
  /** 当前注册句柄（null = 未注册）。`status()` 据此区分"装上了"与"路由挂上了"。 */
  let handle: { (): void; replace(providers: string[]): void } | null = null
  let releaseEffect: (() => void) | null = null

  /** 生成调用序号：只用于构造**可区分**的 `callId`，不参与任何判定。 */
  let generateSeq = 0

  const service: ManaLlmService = {
    plugin: name,
    provider: MANA_PROVIDER,
    hasLlm: () => Boolean(ctx.get('llm')),
    /**
     * 生成入口。**三条失败路径必须显式**（全部走 `ok:false` + `degraded` 归类）：
     *   ① 宿主没有 llm 面 ⇒ `no-llm-surface`（本包可以装配成功却无面，见文件头）；
     *   ② 未配置上游 ⇒ `no-upstream`（适配器也会抛，但那时已是一次流调用，归类会丢）；
     *   ③ 流中途抛 ⇒ `stream-error`（原样带出 message，不吞）；
     *   ④ 宿主以 `finish.reason.kind==='error'` 收尾 ⇒ `host-error-finish`（**这是一条
     *      独立通道**：宿主把适配器错误归一成终态 finish，不抛 ⇒ 不单独看它就会把
     *      「生成失败」读成「生成结果为空」——本仓最防的「失败不可分辨」形态）。
     */
    generate: async (request: ManaGenerateRequest): Promise<ManaGenerateResult> => {
      generateSeq += 1
      const callId = 'mana-llm-call-' + String(generateSeq)
      const llm = ctx.get('llm')
      if (!llm) {
        return { ok: false, text: null, callId, chunks: 0, reason: '宿主无 llm 面（本包装配成功但路由不可达）', degraded: 'no-llm-surface' }
      }
      if (!upstream) {
        return { ok: false, text: null, callId, chunks: 0, reason: "未配置 upstreamProvider —— 'mana' 路由是转发层", degraded: 'no-upstream' }
      }
      // ⚠ 消息在这里造（唯一入口），调用方只给文本 —— 手搓消息在生产路径上不可能发生。
      const messages: Parameters<typeof llm.stream>[0]['messages'] = [
        ...(typeof request.system === 'string' && request.system.length > 0 ? [manaSystemMessage(request.system)] : []),
        manaUserMessage(request.prompt),
      ]
      // ⚠ **model 必须显式取值，且不得传空串/undefined**（本席 2026-09-26 实测，两条都试过）：
      //   宿主在流入口校验"适配器回的精确模型元数据"，
      //   `model:''`  ⇒ finish.reason={kind:'error',code:'INVALID_MODEL_INFO'}
      //   省略 model ⇒ 同上，且 message 里 model 显示 'undefined'
      //   实测唯一走通的形态 = 传一个**真模型名**（适配器的 upstreamModel 或调用方覆盖）。
      //   ⚠ 这条**不是**本包能决定的：宿主没给"用缺省模型"的表达方式 ⇒ 未配置 upstreamModel
      //     时**必须显式失败**，不许拿空串去撞（那会以一条指不到真因的 error finish 收场）。
      const model = String(request.model ?? upstreamModel).trim()
      if (!model) {
        return {
          ok: false,
          text: null,
          callId,
          chunks: 0,
          reason:
            '无可用模型名：调用方未给 model，且适配器的 upstreamModel 为空。' +
            "宿主不接受空/缺省 model（实测 ⇒ INVALID_MODEL_INFO）⇒ 请配置 upstreamModel 或在请求里给 model",
          degraded: 'no-model',
        }
      }
      let chunks = 0
      let text = ''
      let finishReason: string | null = null
      let finishFailure: string | null = null
      try {
        for await (const chunk of llm.stream({ provider: MANA_PROVIDER, model, messages, ...(request.signal ? { signal: request.signal } : {}) })) {
          chunks += 1
          const c = chunk as { type?: unknown; text?: unknown; reason?: { kind?: unknown; failure?: { message?: unknown; code?: unknown } } }
          if (c.type === 'text-delta' && typeof c.text === 'string') text += c.text
          if (c.type === 'finish') {
            finishReason = typeof c.reason?.kind === 'string' ? c.reason.kind : null
            // ⚠ 归因**两条腿都要**：message 指真因（如 INVALID_MODEL_INFO），code 是可枚举的机器读值。
            //   只带一句「宿主以 error finish 收尾」会把「模型名不合法」与「上游 500」读成同一件事。
            const msg = c.reason?.failure?.message
            const code = c.reason?.failure?.code
            if (typeof msg === 'string' || typeof code === 'string') {
              finishFailure = [typeof code === 'string' ? code : null, typeof msg === 'string' ? msg : null]
                .filter((x) => x !== null)
                .join(': ')
            }
          }
        }
      } catch (error) {
        return { ok: false, text: null, callId, chunks, reason: String((error as Error)?.message ?? error), degraded: 'stream-error' }
      }
      if (finishReason === 'error') {
        return {
          ok: false,
          text: null,
          callId,
          chunks,
          reason: '宿主以 error finish 收尾（适配器错误被归一，不抛）' + (finishFailure ? ' · ' + finishFailure : ''),
          degraded: 'host-error-finish',
        }
      }
      return { ok: true, text, callId, chunks, finishReason }
    },
    status: () => ({
      plugin: name,
      wired: true,
      provider: MANA_PROVIDER,
      routeRegistered: handle !== null,
      upstreamProvider: upstream,
      registeredRoutes: () => {
        const llm = ctx.get('llm')
        if (!llm) return null
        try {
          return llm.listProviders().map((p) => p.id)
        } catch {
          return null
        }
      },
    }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-llm', service)
    return () => dispose()
  }, 'dsh-mana-llm: service')

  /**
   * 路由注册：`ctx.inject` 动态等待 `llm` 面（先到/后到都能挂上），
   * `ctx.effect` 显式握 handle ⇒ **释放责任归本 fiber**，不依赖注册调用落在哪个 ctx 上。
   * （为什么两条腿都要：见文件头的归属矩阵 —— 显式 effect 是"注册逃出本 fiber"时
   *  唯一的释放者。）
   */
  ctx.inject(['llm'], (cctx) => {
    releaseEffect = cctx.effect(() => {
      const llm = cctx.get('llm')
      if (!llm) return () => {}
      const h = llm.registerAdapter([MANA_PROVIDER], adapter)
      adapter.runtime = llm as unknown as ManaAdapter['runtime']
      handle = h
      return () => {
        // ⚠ 释放顺序：先记状态再释放句柄 —— 否则 status() 在释放窗口内仍报 routeRegistered:true。
        handle = null
        adapter.runtime = null
        h()
      }
    }, 'dsh-mana-llm: mana 路由')
  })

  registerPassThroughPreStep(ctx, name)

  void core
  void releaseEffect
}

export type { ManaCoreService, ContentBlock, Message }
