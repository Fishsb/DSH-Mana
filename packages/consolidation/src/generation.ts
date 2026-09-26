/**
 * 巩固链（v10 §13.5 深睡归纳）的**生成通道**：消费 `mana-prompts` 的
 * `SLEEP_INDICTION_SYSTEM_PROMPT`（§25.2 注册）+ `mana-llm` 的生成入口。
 *
 * ── 为什么本文件存在（它修的是什么）────────────────────────────────────────────
 * 2026-09-26 实测：`dsh-mana-llm` 与 `dsh-mana-prompts` **两包各自提供整套能力却零生产调用点**
 * （llm 的唯一引用在装配清单 `tools/r0-assembly-check.mjs:77`；prompts 零非自身引用）。
 * v10 §22 的核心哲学是「**JEV 做判断，LLM 做生成**」——「做生成」那一半此前是空的，
 * 而「实现完成」与「系统能跑」在报告层面**同形**（本仓最防的形态）。本文件是它的第一个消费者。
 *
 * ── 为什么按**服务名**取而不是 `import`（与 chains.ts 同一条既有取舍）──────────────
 *  · `import { SLEEP_INDICTION_SYSTEM_PROMPT } from 'dsh-mana-prompts'` —— **不可行**：
 *    prompts 的 `package.json` 的 `exports` **只暴露 `.`**，且其 `lib/index.js`
 *    **不 re-export** 各常量子模块 ⇒ 按包名取具体常量会 `TS2305`。
 *  · 直连 `../../prompts/src/index.ts` —— 与 `vector-cosine.ts` 记录的同一坑：
 *    `rootDir` 限制 + `rewriteRelativeImportExtensions` 把 `.ts` 改写成 `.js`
 *    ⇒ 运行时 `MODULE_NOT_FOUND`。
 *  · 本文件：**运行期** `ctx.get('<服务名>')` 解析，与本包既有写法
 *    （`resolveVectorCosine` 解析 vector 的余弦）和 `scheduler/chains.ts` 的
 *    `svc()` **同源**，不另发明第二套连接方式。
 *
 * ── 三态纪律（本仓最防的「不可分辨」）──────────────────────────────────────────
 * `resolveSummaryChannel()` 返回 **ok / reason / source**；**失败必须带非空 reason**。
 * 不许用「空摘要」同时表达「没装配」「调用失败」「上游就返回空」三种意思。
 *
 * ── 不做什么（如实声明，别读成已实现）──────────────────────────────────────────
 *  · 不注册监听器、不起定时器（触发源归 `scheduler` 的链驱动者）；
 *  · 不做缓存/重试/批量（那些是 llm 包的边界，本文件不越界）；
 *  · 不写自己的审计表（留痕走调用方；本通道只回结果与 `callId`）。
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * prompts 包里本通道**唯一**消费的常量。
 *
 * ⚠ 两个小节号不是同一件事，**都要说准**（本席初版混过一次，被判据当场抓住）：
 *   · `§13.5` = v10 的**巩固链条**小节（深度睡眠 / 守藏集成）—— 本通道服务的链条；
 *   · `§25.2` = v10 的 **Prompt 模板库**小节 —— 该常量的**注册地**
 *     （见 `packages/prompts/src/registry.ts` 的 PROMPT_REGISTRY）。
 *   trace 里的 `promptSection` 取自注册表，记的是**后者**。
 */
export const SUMMARY_PROMPT_CONSTANT = 'SLEEP_INDICTION_SYSTEM_PROMPT'

/**
 * prompts 服务的**结构面**（只声明本通道真正调到的成员，不 import 该包）。
 *
 * ⚠ `get()` 的返回形态按 `packages/prompts/src/index.ts` 的 `ManaPromptsService.get`：
 *   返回 `PromptEntry | undefined`。此处只取 `ref`/`section`/`name` 三个字段。
 */
export interface SummaryPromptsService {
  get(name: string): { readonly name: string; readonly section: string; readonly ref: unknown } | undefined
  status(): { readonly total: number; readonly expected: number; readonly findings: number }
}

/** llm 服务的**结构面**（同上；`generate` 的形态见 `packages/llm/src/index.ts`）。 */
export interface SummaryLlmService {
  generate(request: {
    readonly system?: string
    readonly prompt: string
    readonly model?: string
  }): Promise<
    | { readonly ok: true; readonly text: string; readonly callId: string; readonly chunks: number }
    | { readonly ok: false; readonly text: null; readonly callId: string; readonly reason: string; readonly degraded: string }
  >
}

/** 本通道需要消费的两个服务名（照实写，便于 grep 与判据核）。 */
export const SUMMARY_SERVICES = Object.freeze({
  prompts: 'mana-prompts',
  llm: 'mana-llm',
})

/** 解析结果：**三态**而非「有/没有」——`ok:false` 必须带非空 `reason` 与否决腿名（G8）。 */
export type SummaryChannel =
  | {
      readonly ok: true
      readonly prompts: SummaryPromptsService
      readonly llm: SummaryLlmService
      readonly source: string
    }
  | {
      readonly ok: false
      readonly prompts: null
      readonly llm: null
      readonly missing: readonly string[]
      readonly source: string
      readonly reason: string
    }

/**
 * 解析生成通道。
 *
 * ⚠ **两腿都要，缺一条就整体不可用**（不是"能用一半"）：只解析出 llm 而 prompts 缺失时，
 *   调用方会拿着一个「能生成但没有模板」的通道 —— 那会诱使调用方**自己内联一份 prompt**，
 *   于是 `prompts` 包永远接不上，**第二份真源就是这么长出来的**。故宁可整体否决。
 */
export function resolveSummaryChannel(ctx: Context): SummaryChannel {
  const prompts = ctx.get(SUMMARY_SERVICES.prompts as never) as unknown as SummaryPromptsService | undefined
  const llm = ctx.get(SUMMARY_SERVICES.llm as never) as unknown as SummaryLlmService | undefined
  const missing: string[] = []
  if (!prompts) missing.push(SUMMARY_SERVICES.prompts)
  if (!llm) missing.push(SUMMARY_SERVICES.llm)
  if (missing.length > 0 || !prompts || !llm) {
    return {
      ok: false,
      prompts: null,
      llm: null,
      missing,
      source: missing.join(', '),
      reason: '未装配的服务：' + missing.join(', ') + ' —— 生成通道本回合**未执行**（不是「没有可归纳的」）',
    }
  }
  return { ok: true, prompts, llm, source: SUMMARY_SERVICES.llm + ' + ' + SUMMARY_SERVICES.prompts }
}

/** 取一条 prompt 常量的**渲染结果**（字符串）。三态：拿不到就说清是哪一种拿不到。 */
export function renderPromptConstant(
  prompts: SummaryPromptsService,
  name: string = SUMMARY_PROMPT_CONSTANT,
): { readonly ok: true; readonly text: string; readonly section: string } | { readonly ok: false; readonly reason: string } {
  const entry = prompts.get(name)
  if (!entry) return { ok: false, reason: name + ' 不在 prompts 注册表里' }
  if (typeof entry.ref !== 'string') {
    return { ok: false, reason: name + ' 不是 system 模板串（实际 ' + typeof entry.ref + '）—— 本通道只消费 system-template' }
  }
  if (entry.ref.trim().length === 0) return { ok: false, reason: name + ' 是空串' }
  return { ok: true, text: entry.ref, section: entry.section }
}

/** 一次归纳请求。 */
export interface SummaryRequest {
  /** 待归纳的原始素材（已由调用方拼装成文本；本通道不碰记忆库）。 */
  readonly material: string
  /** 覆盖模型名（省略 = 通道缺省）。 */
  readonly model?: string
}

/** 一次归纳的结果：同样三态，且**每次都带 `callId`** 供调用方落审计。 */
export type SummaryOutcome =
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

/**
 * 执行一次归纳。**本函数不抛**：把所有失败折进三态结果，由调用方决定是记 trace 还是中止。
 *
 * ⚠ 「素材为空」与「生成失败」必须可分辨：前者 `degraded='empty-material'`（调用方的输入问题），
 *   后者是通道/上游问题。二者都返回 `ok:false`，但 `degraded` 不同名。
 */
export async function summarize(
  channel: SummaryChannel,
  request: SummaryRequest,
  promptsName: string = SUMMARY_PROMPT_CONSTANT,
): Promise<SummaryOutcome> {
  const chars = [...String(request.material ?? '')].length
  if (!channel.ok) {
    return { ok: false, summary: null, callId: null, degraded: 'channel-unavailable', reason: channel.reason, materialChars: chars }
  }
  if (chars === 0) {
    return { ok: false, summary: null, callId: null, degraded: 'empty-material', reason: '素材为空 ⇒ 无可归纳内容（这不是生成失败）', materialChars: 0 }
  }
  const rendered = renderPromptConstant(channel.prompts, promptsName)
  if (!rendered.ok) {
    return { ok: false, summary: null, callId: null, degraded: 'prompt-unavailable', reason: rendered.reason, materialChars: chars }
  }
  const result = await channel.llm.generate({
    system: rendered.text,
    prompt: request.material,
    ...(request.model !== undefined ? { model: request.model } : {}),
  })
  if (!result.ok) {
    return { ok: false, summary: null, callId: result.callId, degraded: result.degraded, reason: result.reason, materialChars: chars }
  }
  // ⚠ 上游成功但**产出为空串**是**第三种事实**：既不是失败也不是有效摘要。如实带出（ok:true + 空串），
  //   由调用方按 summaryChars 判；不许在这里折成 ok:false —— 那会把「上游返回空」误报成「通道坏了」。
  return { ok: true, summary: result.text, callId: result.callId, promptSection: rendered.section, materialChars: chars }
}
