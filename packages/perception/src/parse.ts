/**
 * 编码链**第 ② 步「分块与解析」的解析腿**（v10 §12.1）—— 意图识别（LLM）。
 *
 * ── 为什么需要它（缺口形态）──────────────────────────────────────────────────
 * v10 §12.1 第②步是「分块与**解析**（LLM）」；本仓 2026-09-26 实测：
 *   · **分块**已落（`chunkText`，有判据）；
 *   · **解析腿零落点**（全仓 grep 无）；
 *   · 而 `dsh-mana-prompts` 里 **`INTENT_CLASSIFICATION_SYSTEM_PROMPT` 早已在册**
 *     （§25.3，v10:874 明确四类「问答/任务/提醒/闲聊」）—— **有件无用**：
 *     常量在注册表里、无人消费 ⇒ 与本批次修掉的 `summary` 列、`COMPRESSION_SYSTEM_PROMPT`
 *     是**同一形态**（写侧不产 ⇒ "没这一步"与"这一步没跑"同形）。
 *
 * ── 契约约束（**不许改 Events**）────────────────────────────────────────────
 * `ManaObservation` 的字段是**冻结契约**（`content` / `source` + 信封四件），
 * **不得**为了塞解析结果去改它（那是改契约面，属 R3 越权）。故本模块：
 *   · 解析结果**不进 `mana/observation` 载荷**；
 *   · 走**独立读数**（`PerceiveReading.parseIntents`），由下游按需取。
 *   ⚠ 这样做的代价如实记：解析结果**不进事件流** ⇒ 订阅者拿不到，必须经服务面读取。
 *     这是**刻意**的：契约面冻结优先于"顺手把字段加上去"。
 *
 * ── 缺省关闭（**设计判断**，理由要说清）──────────────────────────────────────
 *   解析要**真出网**（一次 LLM 往返）。缺省开启会让每条输入都多一次往返：
 *     · 主链延迟上升；
 *     · 测试环境无 llm 时全走降级（但那会让"没装"与"解析不出"同形，见下）。
 *   ⇒ 缺省 **false**（主链行为一字不变），需要时显式开。
 *   ⚠ 与上一批的 `signalFilterEnabled` **同一条取舍**（那次我把只该用于蒸馏的粗筛接到主链，
 *     实测 23 项判据按设计变红）。本批不再重犯：**新能力默认不扰主链**。
 *
 * ── 降级必须可分辨（四态，不是二值）──────────────────────────────────────────
 *   `intent` 的取值域 = 四类枚举 + **`unknown`**（解析不出）+ **`degraded`**（通道不可用）。
 *   ⚠ `unknown` 与 `degraded` **必须分开**：
 *     · `unknown` = 调了，但模型没给出可用的四类之一（**模型的事**）；
 *     · `degraded` = 没调成（缺腿/上游失败）（**通道的事**）。
 *     二者同形会让"通道坏了"被读成"这条输入没意图"（本仓最忌）。
 *
 * ── 扩展面（**预留**）────────────────────────────────────────────────────────
 *   · 解析器可替换：`IntentParser` 接口（现只有 LLM 实现；将来加规则/小模型不改调用方）；
 *   · 结果结构可扩：`IntentReading` 已带 `raw`（模型原话）与 `callId`（审计），
 *     后续要加实体/情绪维度时**不改返回形态**，加可选字段即可。
 */
import type { Context } from '@deepseek-ai/cordis'

/** v10:874 的四类意图（**逐字**取自 `INTENT_CLASSIFICATION_SYSTEM_PROMPT` 的枚举）。 */
export const INTENT_CLASSES = Object.freeze(['问答', '任务', '提醒', '闲聊'] as const)
export type IntentClass = (typeof INTENT_CLASSES)[number]

/** 解析结果的取值域：四类 + 两种**不同**的失败态（见文件头）。 */
export type IntentValue = IntentClass | 'unknown' | 'degraded'

export interface IntentReading {
  readonly value: IntentValue
  /** 模型原话（截断到 80 字符）——「为什么判成 unknown」可查。 */
  readonly raw: string
  /** 审计标识（`degraded` 且无调用时为 null）。 */
  readonly callId: string | null
  /** 稳定原因串（`value` 为四类时是空串）。 */
  readonly reason: string
  /** 本次判定的确定性来源（便于将来换解析器时区分）。 */
  readonly via: 'llm' | 'none'
}

/** 解析器接口（**预留可替换面**：将来加规则/小模型实现时不动调用方）。 */
export interface IntentParser {
  readonly name: string
  parse(text: string): Promise<IntentReading>
}

const UNKNOWN_READING = (raw: string, reason: string, callId: string | null): IntentReading => ({
  value: 'unknown',
  raw: raw.slice(0, 80),
  callId,
  reason,
  via: 'llm',
})

const DEGRADED_READING = (reason: string): IntentReading => ({
  value: 'degraded',
  raw: '',
  callId: null,
  reason,
  via: 'none',
})

/** 生成通道的结构面（与 summarize.ts 同形，但**只要 generate**）。 */
export interface IntentLlmLike {
  generate(request: {
    readonly system?: string
    readonly prompt: string
    readonly model?: string
  }): Promise<
    | { readonly ok: true; readonly text: string; readonly callId: string }
    | { readonly ok: false; readonly text: null; readonly callId: string; readonly reason: string; readonly degraded: string }
  >
}

/** prompts 服务结构面。 */
export interface IntentPromptsLike {
  get(name: string): { readonly name: string; readonly section: string; readonly ref: unknown } | undefined
}

/** 本腿消费的 prompt 常量名（真源在 prompts 包）。 */
export const INTENT_PROMPT_NAME = 'INTENT_CLASSIFICATION_SYSTEM_PROMPT'

/**
 * 构造 LLM 意图解析器。**不抛**：一切失败折进读数。
 */
export function createLlmIntentParser(llm: IntentLlmLike | undefined, prompts: IntentPromptsLike | undefined): IntentParser {
  return {
    name: 'llm',
    parse: async (text: string): Promise<IntentReading> => {
      const src = String(text ?? '')
      if (src.trim().length === 0) return DEGRADED_READING('空文本 ⇒ 无可解析内容（不是"没有意图"）')
      if (!llm || !prompts) {
        return DEGRADED_READING(
          '解析通道未装配（llm=' + String(llm !== undefined) + ' prompts=' + String(prompts !== undefined) + '）',
        )
      }
      const entry = prompts.get(INTENT_PROMPT_NAME)
      if (!entry || typeof entry.ref !== 'string') {
        return DEGRADED_READING(INTENT_PROMPT_NAME + ' 不在 prompts 注册表（或不是字符串模板）')
      }
      const result = await llm.generate({ system: entry.ref, prompt: src })
      if (!result.ok) {
        return DEGRADED_READING('上游生成失败[' + result.degraded + ']：' + result.reason)
      }
      const raw = String(result.text ?? '').trim()
      // ⚠ 归一：模型可能回「任务。」或带空白 ⇒ 取**包含关系**而非全等（全等会把
      //   "任务。"读成 unknown，而那是模型表达差异，不是解析失败）。
      const hit = INTENT_CLASSES.find((c) => raw.includes(c))
      if (!hit) {
        return UNKNOWN_READING(raw, '模型未给出四类之一（取值域外的回答不计为 degraded）', result.callId)
      }
      return { value: hit, raw: raw.slice(0, 80), callId: result.callId, reason: '', via: 'llm' }
    },
  }
}

/** 从 ctx 取两条腿（**每次现解析**，与 chains.ts 的 svc() 同一取舍：不缓存）。 */
export function resolveIntentLegs(ctx: Context): { llm: IntentLlmLike | undefined; prompts: IntentPromptsLike | undefined } {
  return {
    llm: ctx.get('mana-llm' as never) as unknown as IntentLlmLike | undefined,
    prompts: ctx.get('mana-prompts' as never) as unknown as IntentPromptsLike | undefined,
  }
}
