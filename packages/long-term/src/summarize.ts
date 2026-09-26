/**
 * 编码链**第 ③ 步「摘要与标签」（LLM）** —— Write Gate 落库前的摘要生成。
 *
 * ── 为什么需要它（它补的是哪一步）────────────────────────────────────────────
 * v10 §12.1 编码链条八步里，第 ③ 步是「摘要与标签（LLM）」。本仓 2026-09-26 实测：
 *   · `memory_items.summary` 列**建了**（schema 在册）；
 *   · `core.writeMemoryItem(item.summary?)` **支持**；
 *   · `core.recallLexical` **读它**（\`SELECT m.content, m.summary\`）；
 *   · 而**生产侧恒写 null**（`write-gate.ts` 的落库调用写死 `summary: null`）。
 * ⇒ 这是「**列白建了**」形态：列在、读侧在、写侧不产 —— 与「这条记忆本来就没有摘要」
 *   **在库层面完全同形**（本仓最忌）。补上本步后，该列才第一次有真生产写者。
 *
 * ── 本模块做什么 / 不做什么 ───────────────────────────────────────────────────
 *   · **做**：把观察原文压成一行短摘要（≤ `maxChars`），供召回侧与面板使用；
 *   · **不做判定**：摘要**不参与**"值不值得留"的决策（那是 Write Gate 的 JEV 判定），
 *     也**不**改变落库与否 —— 生成失败时**照样落库**，只是 `summary` 为 null（见下）。
 *   · **不阻塞主链**：本函数是 **async**，但 `writeGate` 的调用方（事件监听器）**不 await**
 *     它的落库前态 —— 见 `summarizeBeforeWrite` 的"尽力而为"语义。
 *
 * ── 失败语义（**必须可分辨**，不许静默降级）──────────────────────────────────
 *   四种失败各有名字，全部落进返回值：
 *     `no-channel`       生成通道未装配（llm/prompts 缺）
 *     `empty-content`    原文为空 ⇒ 无可摘要（**不是**"摘要失败"）
 *     `generate-failed`  上游失败（带上游自己的 degraded 归类）
 *     `empty-summary`    上游成功但产出空串（**第三种事实**：既非失败也非有效摘要）
 *   ⚠ **任何失败都不阻断落库**：摘要缺失是"少一个优化"，不是"这条记忆不该记"。
 *     但**必须留痕** —— 见 `SummaryOutcome.reason`，由调用方写进 trace。
 *
 * ── 提示词来源（**不新造**）──────────────────────────────────────────────────
 *   复用 `dsh-mana-prompts` 的 `COMPRESSION_SYSTEM_PROMPT`（§25.5，原文即
 *   「将这段记忆压缩为统计摘要 …… 不超过 50 字」）—— 与 v10 §25.5 同一个真源，
 *   不在本包内再写一段同义提示词（那会长出第二份真源）。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 生成通道的结构面（与 `consolidation/generation.ts` 的 SummaryLlmService 同形）。 */
export interface SummaryLlmLike {
  generate(request: {
    readonly system?: string
    readonly prompt: string
    readonly model?: string
  }): Promise<
    | { readonly ok: true; readonly text: string; readonly callId: string; readonly chunks: number }
    | {
        readonly ok: false
        readonly text: null
        readonly callId: string
        readonly reason: string
        readonly degraded: string
      }
  >
}

/** prompts 服务的结构面（只需 `get`）。 */
export interface SummaryPromptsLike {
  get(name: string): { readonly name: string; readonly section: string; readonly ref: unknown } | undefined
}

/** 本步消费的 prompt 常量名（§25.5 的真源在 prompts 包，此处只引用名字）。 */
export const SUMMARY_PROMPT_NAME = 'COMPRESSION_SYSTEM_PROMPT'

/** 失败归类（**可枚举**，不许只留一句 message）。 */
export type SummarySkip =
  | 'no-channel'
  | 'empty-content'
  | 'generate-failed'
  | 'empty-summary'
  /** 摘要超过上限且截断后仍不可用（如实记，不静默丢）。 */
  | 'too-long'
  /** 该步被开关关掉（**不是**生成失败 —— 二者必须可分辨，否则"关着"与"坏了"同形）。 */
  | 'disabled'

export type SummaryOutcome =
  | { readonly ok: true; readonly summary: string; readonly callId: string; readonly promptSection: string; readonly sourceChars: number }
  | { readonly ok: false; readonly summary: null; readonly skip: SummarySkip; readonly reason: string; readonly callId: string | null; readonly sourceChars: number }

export interface SummarizeOptions {
  /** 摘要字符上限（超出即截断；`<=0` = 不截断）。 */
  readonly maxChars?: number
}

/**
 * 生成一条记忆摘要。**本函数不抛**：一切失败折进 `SummaryOutcome`。
 *
 * @param llm     生成通道（`ctx.get('mana-llm')`；缺失 ⇒ `no-channel`）
 * @param prompts prompt 表（`ctx.get('mana-prompts')`；缺失 ⇒ `no-channel`）
 */
export async function summarizeBeforeWrite(
  llm: SummaryLlmLike | undefined,
  prompts: SummaryPromptsLike | undefined,
  content: string,
  options: SummarizeOptions = {},
): Promise<SummaryOutcome> {
  const src = String(content ?? '')
  const sourceChars = [...src].length
  if (!llm || !prompts) {
    return {
      ok: false,
      summary: null,
      skip: 'no-channel',
      reason: '生成通道未装配（llm=' + String(llm !== undefined) + ' prompts=' + String(prompts !== undefined) + '）',
      callId: null,
      sourceChars,
    }
  }
  if (src.trim().length === 0) {
    return { ok: false, summary: null, skip: 'empty-content', reason: '原文为空 ⇒ 无可摘要（不是生成失败）', callId: null, sourceChars: 0 }
  }
  const entry = prompts.get(SUMMARY_PROMPT_NAME)
  if (!entry || typeof entry.ref !== 'string') {
    return {
      ok: false,
      summary: null,
      skip: 'no-channel',
      reason: SUMMARY_PROMPT_NAME + ' 不在 prompts 注册表（或不是字符串模板）',
      callId: null,
      sourceChars,
    }
  }
  const result = await llm.generate({ system: entry.ref, prompt: src })
  if (!result.ok) {
    return {
      ok: false,
      summary: null,
      skip: 'generate-failed',
      reason: '上游生成失败[' + result.degraded + ']：' + result.reason,
      callId: result.callId,
      sourceChars,
    }
  }
  const text = String(result.text ?? '').trim()
  if (text.length === 0) {
    return {
      ok: false,
      summary: null,
      skip: 'empty-summary',
      reason: '上游成功但产出空串（既非失败也非有效摘要）',
      callId: result.callId,
      sourceChars,
    }
  }
  const maxChars = options.maxChars ?? 0
  if (maxChars > 0 && [...text].length > maxChars) {
    return {
      ok: true,
      summary: [...text].slice(0, maxChars).join(''),
      callId: result.callId,
      promptSection: entry.section,
      sourceChars,
    }
  }
  return { ok: true, summary: text, callId: result.callId, promptSection: entry.section, sourceChars }
}

/** 从 ctx 取两条腿（**每次现解析**，与 chains.ts 的 svc() 同一取舍：不缓存）。 */
export function resolveSummaryLegs(ctx: Context): { llm: SummaryLlmLike | undefined; prompts: SummaryPromptsLike | undefined } {
  return {
    llm: ctx.get('mana-llm' as never) as unknown as SummaryLlmLike | undefined,
    prompts: ctx.get('mana-prompts' as never) as unknown as SummaryPromptsLike | undefined,
  }
}
