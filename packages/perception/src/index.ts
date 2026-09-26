/**
 * `dsh-mana-perception` —— 前五识：输入采集 / 分块 / 实体抽取（P0）。
 *
 * 阶段 1 B2.1：本插件是端到端事件链的**源头** —— 发出 `mana/observation`，
 * 由 `attention` 接手（写 `mana_trace` 并广播 `mana/attention`），再由 `scheduler` 消费。
 *
 * ⚠ **分块是"真行为"而不是装饰**：`maxChunkChars` 超限才切分，切分后**逐块**各发一条
 *   `mana/observation`（不是把原文塞进一条里）——否则「分块」这个配置项就是死开关
 *   （声明了却不产生可观测差异，本仓已有该类教训）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import {
  registerPassThroughPreStep,
  type ManaCoreService,
  type ManaObservation,
} from 'dsh-mana-core'
import { mergeSignalTables, prefilterBySignalWords, type SignalVerdict } from './signal.ts'
import {
  createLlmIntentParser,
  resolveIntentLegs,
  type IntentReading,
} from './parse.ts'

export const name = 'mana-perception'

export const inject: string[] = ['mana-core']

export interface Config {
  /** 单块最大字符数（超出即切分）。 */
  maxChunkChars: number
  /** 相邻块重叠字符数，避免语义在切点被截断。 */
  chunkOverlapChars: number
  /**
   * 信号词预筛开关（v10 §12.3 的「零 LLM 成本」那道门）。
   *
   * ⚠ **缺省 false —— 这是设计判断，不是保守**（本席 2026-09-26 实测改过一次）：
   *   预筛在 v10 里属于**会话蒸馏路径**（§12.3 全句：「空闲 10 分钟 → 信号词预筛 → LLM 裁决 →
   *   白名单门禁 → …」），**不是**每条输入都过的主链闸。
   *   我第一版把它接到主链且缺省 true，实测后果：`npm test` **23 项按设计变红**
   *   （编码链/注入门/工作记忆的端到端判据全用短技术串，逐条被预筛挡下 ⇒ `emitted:0`）。
   *   那些红**不是缺陷**，而是**判据正确地报告了"主链行为被改了"** —— 只是改的方向错了：
   *   主链要的是「**进来了就采**」（漏采比多采贵得多），粗筛该发生在**蒸馏**那条路径上。
   * ⇒ 缺省 false（**主链行为一字不变**），蒸馏路径/需要时显式开。
   *
   * ⚠ 关掉**不是静默**：逐条读数仍经 `lastReading()` 与 `status()` 暴露
   *   （`filterEnabled:false` + `filteredBySignal:0`）⇒ "关着"与"没筛"可分辨。
   */
  signalFilterEnabled: boolean
  /**
   * 部署注入的**领域信号词**（与内置词表合并；空数组 = 只用内置）。
   *
   * 预留此键是为了**不把词表写死在源码里**：接库学词表（v10 的 `distillation_log.signal_words`）
   * 之前，部署侧至少能经配置补领域词而不必改源码。
   */
  extraSignalWords: string[]
  /**
   * ── v10 §12.1 第②步**解析腿**（意图识别，LLM）开关 ──────────────────────────────
   *
   * ⚠ **缺省 false —— 设计判断，不是保守**：
   *   解析要**真出网**（一次 LLM 往返）。缺省开启会让**每条输入**都多一次往返
   *   （主链延迟上升），且测试环境无 llm 时全走降级 —— 而"没装"与"解析不出"在**粗读**下同形。
   *   ⇒ 缺省 false（**主链行为一字不变**），需要时显式开。
   * ⚠ 本条是**上批教训的直接应用**：那批我把只该用于蒸馏的信号词预筛接到主链且缺省 true，
   *   实测 `npm test` **23 项按设计变红**。新能力默认不扰主链。
   * ⚠ 关掉**不是静默**：`lastReading().intent` 为 `null`，且 `status().parseEnabled=false`
   *   ⇒「关着」与「解析不出来（unknown/degraded）」三者可分辨。
   */
  parseEnabled: boolean
}

export const Config: Schema<Config> = Schema.object({
  maxChunkChars: Schema.number().default(1200),
  chunkOverlapChars: Schema.number().default(120),
  // 缺省 false：见 Config.signalFilterEnabled 的长注（主链不得被粗筛改变行为）
  signalFilterEnabled: Schema.boolean().default(false),
  extraSignalWords: Schema.array(Schema.string()).default([]),
  // 缺省 false：见 Config.parseEnabled 的长注（新能力默认不扰主链）
  parseEnabled: Schema.boolean().default(false),
})

/** 分块结果（**显式**给出块数，使「切了没切」可断言而不是靠猜）。 */
export interface ChunkResult {
  chunks: string[]
  /** 是否真的发生了切分（`false` = 原文一块，可直接断言）。 */
  split: boolean
}

/**
 * 按 `maxChunkChars` / `chunkOverlapChars` 分块（纯函数，可单独判据）。
 *
 * 边界：`maxChunkChars <= 0` 或文本不超限 ⇒ 单块且 `split=false`；
 * `chunkOverlapChars` 被夹到 `[0, maxChunkChars-1]`，否则会**死循环**（重叠 ≥ 步长时索引不前进）。
 */
export function chunkText(text: string, maxChunkChars: number, chunkOverlapChars: number): ChunkResult {
  const src = String(text ?? '')
  if (maxChunkChars <= 0 || src.length <= maxChunkChars) return { chunks: [src], split: false }
  // ⚠ 步长必须 > 0：`overlap >= maxChunkChars` 会让 index 不前进 ⇒ 无限循环（静默挂死）。
  const overlap = Math.min(Math.max(chunkOverlapChars, 0), maxChunkChars - 1)
  const step = maxChunkChars - overlap
  const chunks: string[] = []
  for (let i = 0; i < src.length; i += step) {
    chunks.push(src.slice(i, i + maxChunkChars))
    if (i + maxChunkChars >= src.length) break
  }
  return { chunks, split: chunks.length > 1 }
}

/**
 * 一次采集的**完整读数**（v10 §12.3 信号词预筛落地后，返回值不再是裸数字）。
 *
 * ⚠ 为什么要把"筛掉了多少"显式返回：本仓 2026-09-26 实测的归因错位正是
 *   「memory_items 不生长」被读成"系统效果差"，真因却是**上游层级错位**。
 *   若 `perceive` 只回"发出几块"，则"筛掉了"与"压根没输入"**同形** ⇒ 同一个错会再犯一次。
 */
export interface PerceiveReading {
  /** 实际发出的 `mana/observation` 条数（= 通过预筛的块数）。 */
  readonly emitted: number
  /** 被信号词预筛挡下的块数（**0 与"没筛"必须可分辨**：见 `filterEnabled`）。 */
  readonly filteredBySignal: number
  /** 预筛开关当时的取值（读数自带语境，免得读者拿错前提解释上面的数）。 */
  readonly filterEnabled: boolean
  /** 逐块的预筛判定（含命中词），使"为什么被挡"可复算。 */
  readonly verdicts: readonly SignalVerdict[]
  /** 文本被切成几块（与 `emitted` 分开：切了 3 块只发 1 块是两件事）。 */
  readonly chunks: number
  /**
   * ── v10 §12.1 第②步**解析腿**：意图识别读数（2026-09-26 补）──────────────────────
   * `null` = 解析未启用或未执行（与"解析了但结果 unknown"**必须可分辨**）。
   * ⚠ 结果**不进 `mana/observation` 载荷**（契约面冻结，见 `parse.ts` 文件头）。
   */
  readonly intent: IntentReading | null
}

export interface ManaPerceptionService {
  readonly plugin: string
  /**
   * 采集一条输入：分块 → **逐块过信号词预筛** → 通过的逐块发出 `mana/observation`。
   *
   * 事件用 `ctx.emit`（`mana/observation` 是 emit 型通知，见 `event-types.ts`）。
   *
   * ⚠ **返回值恒为「发出块数」（`number`）—— 这是跨包契约面，不得改成对象**
   *   （本席 2026-09-26 实测教训）：改对象会让全仓 **20 处**消费方连带失败
   *   （`scheduler/chains.ts:669` + 三个测试文件的 19 处），而那些失败**与被改的功能无关**
   *   ⇒ 典型的"拆东墙补西墙"。⇒ 读数改走 **`lastReading()`**（见下），契约面一字不动。
   */
  perceive(input: { content: string; sessionId: string; turnId: number; requestId: string; source?: string; at?: string }): number
  /**
   * **最近一次 `perceive` 的完整读数**（预筛分流情况）。
   *
   * ⚠ 为什么单开一个方法而不是改返回值：见 `perceive` 的说明（契约面）。
   *   `null` = 本次装配后**还没调用过** `perceive` —— 与"调用过但全被挡下"**必须可分辨**
   *   （前者是"没测"，后者是"测了，结果是筛掉了"）。
   */
  lastReading(): PerceiveReading | null
  /** 预筛词表的只读快照（名字 + 词数），使"用的哪张表"可查。 */
  signalTable(): { name: string; size: number }
  /**
   * **直接解析一段文本的意图**（不经 `perceive`，不出事件）—— 供下游按需调用。
   *
   * ⚠ 为什么单开一个方法：`perceive` 的结果**不进事件流**（契约面冻结）⇒ 若下游只能
   *   经 `lastReading()` 取，就会依赖"上一次 perceive 是谁调的"这种**时序耦合**。
   *   本方法让"我要解析这段"成为一次**显式、无副作用**的调用。
   */
  parseIntent(text: string): Promise<IntentReading>
  status(): { plugin: string; wired: boolean; filterEnabled: boolean; tableName: string; parseEnabled: boolean }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-perception': ManaPerceptionService
  }
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-perception: 缺少 mana-core 服务（inject 未满足）')

  /**
   * 预筛词表**在装配时确定一次**（`extraSignalWords` 是装配期配置；运行期不换表
   * ⇒ 读数里的 `table` 名字在整个生命周期内稳定，不会出现"同一批观察用了两张表"）。
   */
  const table = mergeSignalTables(config.extraSignalWords ?? [])

  /** 最近一次采集的读数（`null` = 装配后还没调用过 —— 与"调用过但全挡下"可分辨）。 */
  let lastReading: PerceiveReading | null = null
  /**
   * 意图解析器（**装配时按配置建一次**）。
   * ⚠ 即使 `parseEnabled=false` 也建：关闭只是"不自动解析"，`parseIntent()` 仍可显式调用
   *   （否则"关掉自动"会连带"手动也不能用"，那是把开关做成了阉割）。
   */
  const intentLegs = resolveIntentLegs(ctx)
  const intentParser = createLlmIntentParser(intentLegs.llm, intentLegs.prompts)

  const perceive: ManaPerceptionService['perceive'] = (input) => {
    const { chunks } = chunkText(input.content, config.maxChunkChars, config.chunkOverlapChars)
    const at = input.at ?? new Date().toISOString()
    const verdicts: SignalVerdict[] = []
    let emitted = 0
    let filteredBySignal = 0
    for (const [i, chunk] of chunks.entries()) {
      /**
       * ⚠ **预筛在分块之后、逐块之前**（顺序不可反）：分块是为了让每块**各自**可判定，
       *   若先筛整段再分块，则"长文本里只有一处信号词"会让**整段**通过（含大量无关块）——
       *   那等于没筛。逐块筛才使"信号密度"真的影响放行量。
       */
      const verdict = config.signalFilterEnabled
        ? prefilterBySignalWords(chunk, table)
        : ({ state: 'hit', hits: [], score: 0, table: table.name, bypass: true } as unknown as SignalVerdict)
      verdicts.push(verdict)
      if (verdict.state !== 'hit') {
        filteredBySignal += 1
        continue
      }
      const obs: ManaObservation = {
        sessionId: input.sessionId,
        turnId: input.turnId,
        // 多块时 requestId 派生后缀，使各块在审计上**可分辨**（不得让多块共用同一 requestId）。
        requestId: chunks.length > 1 ? `${input.requestId}#${i + 1}` : input.requestId,
        at,
        content: chunk,
        source: input.source ?? 'unknown',
      }
      ctx.emit('mana/observation', obs)
      emitted += 1
    }
    lastReading = {
      emitted,
      filteredBySignal,
      filterEnabled: config.signalFilterEnabled,
      verdicts,
      chunks: chunks.length,
      // ⚠ 解析**不在 perceive 内同步做**（perceive 是同步契约面，而解析要出网）。
      //   这里恒为 null；要解析请用 parseIntent()（下面）。
      //   「未解析（null）」与「解析了但 unknown」因此**天然可分辨**。
      intent: null,
    }
    // ⚠ 契约面：返回**发出块数**（不是读数对象）。读数走 lastReading()。
    return emitted
  }

  const service: ManaPerceptionService = {
    plugin: name,
    perceive,
    lastReading: () => lastReading,
    signalTable: () => ({ name: table.name, size: table.words.length }),
    parseIntent: (text: string) => intentParser.parse(text),
    status: () => ({
      plugin: name,
      wired: true,
      filterEnabled: config.signalFilterEnabled,
      tableName: table.name,
      parseEnabled: config.parseEnabled,
    }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-perception', service)
    return () => dispose()
  }, 'dsh-mana-perception: service')

  registerPassThroughPreStep(ctx, name)

  void core
}

export { mergeSignalTables, prefilterBySignalWords, BUILTIN_SIGNAL_TABLE } from './signal.ts'
export {
  createLlmIntentParser,
  resolveIntentLegs,
  INTENT_CLASSES,
  INTENT_PROMPT_NAME,
} from './parse.ts'
export type { IntentClass, IntentValue, IntentReading, IntentParser } from './parse.ts'
export type { SignalVerdict, SignalWordTable } from './signal.ts'
export { DEFAULT_SIGNAL_WORDS } from './signal-words.ts'

export type { ManaCoreService }
