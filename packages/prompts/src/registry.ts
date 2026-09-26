/**
 * v10 §25 二十个 Prompt 常量的**注册表**（运行时真源 + 自检入口）。
 *
 * ── 为什么要有这张表（而不是只导出 20 个常量）────────────────────────────────────
 *   「20 个常量都在」这件事若只靠**文档或注释**声明，就没有机检面：删掉一条、
 *   或改了 `type` 写错，仓里没有任何东西会红。本表把「哪些常量该在」变成**可读数据**，
 *   由本包判据与宿主服务面共同消费。
 *
 * ⚠ **本表不是自指清单**：判据侧（`tests/prompts.test.mjs`）**另写一份**名字清单做
 *   三方集合相等（模块真实导出集 / 本表 / 判据自带对照表）——只写一份的话，
 *   删一条 + 改常数就恒绿（本仓 forgetting 包 A15_EXPORT_FACE 的原话：「删一项、把 N 改小，
 *   断言照样全绿」）。
 *
 * ── 已登记但**不接线**的两条（§25.8）────────────────────────────────────────────
 *   `TASK_COMPLEXITY_PROMPT` / `RESULT_CLASSIFICATION_PROMPT` 带 `wired: false`：
 *   C16 已拍板 ITACL **不移植**，两条常量的**定义**照抄落库，但**不得**被宿主消费。
 *   该字段由判据⑥机检（源码静态面 + 运行时服务面两腿）。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'
import {
  WRITE_GATE_PROMPT,
  SUPERSEDES_PROMPT,
  EMOTION_VALENCE_PROMPT,
  EMOTION_AROUSAL_PROMPT,
} from './encoding.ts'
import {
  CONSOLIDATION_TRIGGER_PROMPT,
  CHUNKING_UTILITY_PROMPT,
  SLEEP_INDICTION_SYSTEM_PROMPT,
} from './consolidation.ts'
import {
  INTENT_CLASSIFICATION_SYSTEM_PROMPT,
  RECALL_GATE_PROMPT,
  INJECTION_GATE_PROMPT,
} from './retrieval.ts'
import { RECONSOLIDATION_UPDATE_PROMPT } from './reconsolidation.ts'
import { ACTIVITY_LEVEL_PROMPT, COMPRESSION_SYSTEM_PROMPT } from './forgetting.ts'
import { PRINCIPLE_EXTRACTION_SYSTEM_PROMPT, PATH_INDUCTION_SYSTEM_PROMPT } from './learning.ts'
import { UNFAMILIAR_TASK_PROMPT, TOOL_ROUTING_PROMPT, SAFETY_GATE_PROMPT } from './scheduling.ts'
import { TASK_COMPLEXITY_PROMPT, RESULT_CLASSIFICATION_PROMPT } from './itacl.ts'

/** 常量形态：静态 JevQuestion / 工厂（返回 JevQuestion）/ LLM system prompt 模板串。 */
export type PromptKind = 'jev-static' | 'jev-factory' | 'system-template'

/** 注册表的一条。 */
export interface PromptEntry {
  /** 导出名（与源码里的 `export const/function` **逐字一致**）。 */
  readonly name: string
  /** v10 原文小节（便于与原文逐条对拍）。 */
  readonly section: string
  readonly kind: PromptKind
  /** 静态常量本体 / 工厂函数本体 / 模板字符串本体。 */
  readonly ref: unknown
  /** 工厂的**自检样例实参**（本包自检用；不是运行时依赖）。 */
  readonly sampleArgs?: readonly unknown[]
  /** `false` = 定义在册但**不得接线到宿主**（§25.8 ITACL，C16 不移植）。 */
  readonly wired: boolean
}

/**
 * 二十个常量的注册表（v10 §25.1–25.8）。
 *
 * ⚠ 顺序按 v10 原文小节排（编码 → 巩固 → 检索 → 再巩固 → 遗忘 → 学习 → 调度 → ITACL），
 *   便于人读与原文对拍；**计数判据不看顺序**，只看集合。
 */
export const PROMPT_REGISTRY: readonly PromptEntry[] = Object.freeze([
  // ── §25.1 编码链条 ────────────────────────────────────────────────────────
  { name: 'WRITE_GATE_PROMPT', section: '§25.1', kind: 'jev-static', ref: WRITE_GATE_PROMPT, wired: true },
  { name: 'SUPERSEDES_PROMPT', section: '§25.1', kind: 'jev-factory', ref: SUPERSEDES_PROMPT, sampleArgs: [['旧记忆甲', '旧记忆乙']], wired: true },
  { name: 'EMOTION_VALENCE_PROMPT', section: '§25.1', kind: 'jev-static', ref: EMOTION_VALENCE_PROMPT, wired: true },
  { name: 'EMOTION_AROUSAL_PROMPT', section: '§25.1', kind: 'jev-static', ref: EMOTION_AROUSAL_PROMPT, wired: true },
  // ── §25.2 巩固链条 ────────────────────────────────────────────────────────
  { name: 'CONSOLIDATION_TRIGGER_PROMPT', section: '§25.2', kind: 'jev-static', ref: CONSOLIDATION_TRIGGER_PROMPT, wired: true },
  { name: 'CHUNKING_UTILITY_PROMPT', section: '§25.2', kind: 'jev-static', ref: CHUNKING_UTILITY_PROMPT, wired: true },
  { name: 'SLEEP_INDICTION_SYSTEM_PROMPT', section: '§25.2', kind: 'system-template', ref: SLEEP_INDICTION_SYSTEM_PROMPT, wired: true },
  // ── §25.3 检索链条 ────────────────────────────────────────────────────────
  { name: 'INTENT_CLASSIFICATION_SYSTEM_PROMPT', section: '§25.3', kind: 'system-template', ref: INTENT_CLASSIFICATION_SYSTEM_PROMPT, wired: true },
  { name: 'RECALL_GATE_PROMPT', section: '§25.3', kind: 'jev-factory', ref: RECALL_GATE_PROMPT, sampleArgs: ['样例记忆摘要'], wired: true },
  { name: 'INJECTION_GATE_PROMPT', section: '§25.3', kind: 'jev-static', ref: INJECTION_GATE_PROMPT, wired: true },
  // ── §25.4 再巩固链条 ──────────────────────────────────────────────────────
  { name: 'RECONSOLIDATION_UPDATE_PROMPT', section: '§25.4', kind: 'jev-factory', ref: RECONSOLIDATION_UPDATE_PROMPT, sampleArgs: ['原记忆文本', '新信息文本'], wired: true },
  // ── §25.5 遗忘链条 ────────────────────────────────────────────────────────
  { name: 'ACTIVITY_LEVEL_PROMPT', section: '§25.5', kind: 'jev-static', ref: ACTIVITY_LEVEL_PROMPT, wired: true },
  { name: 'COMPRESSION_SYSTEM_PROMPT', section: '§25.5', kind: 'system-template', ref: COMPRESSION_SYSTEM_PROMPT, wired: true },
  // ── §25.6 学习链条（**整链无 JevQuestion**）────────────────────────────────
  { name: 'PRINCIPLE_EXTRACTION_SYSTEM_PROMPT', section: '§25.6', kind: 'system-template', ref: PRINCIPLE_EXTRACTION_SYSTEM_PROMPT, wired: true },
  { name: 'PATH_INDUCTION_SYSTEM_PROMPT', section: '§25.6', kind: 'system-template', ref: PATH_INDUCTION_SYSTEM_PROMPT, wired: true },
  // ── §25.7 调度链条（**三条全是工厂**）──────────────────────────────────────
  { name: 'UNFAMILIAR_TASK_PROMPT', section: '§25.7', kind: 'jev-factory', ref: UNFAMILIAR_TASK_PROMPT, sampleArgs: ['样例任务', '样例历史'], wired: true },
  { name: 'TOOL_ROUTING_PROMPT', section: '§25.7', kind: 'jev-factory', ref: TOOL_ROUTING_PROMPT, sampleArgs: [['read', 'write']], wired: true },
  { name: 'SAFETY_GATE_PROMPT', section: '§25.7', kind: 'jev-factory', ref: SAFETY_GATE_PROMPT, sampleArgs: ['删除文件'], wired: true },
  // ── §25.8 ITACL 专用（**不移植**：定义在册，wired=false）─────────────────────
  { name: 'TASK_COMPLEXITY_PROMPT', section: '§25.8', kind: 'jev-static', ref: TASK_COMPLEXITY_PROMPT, wired: false },
  { name: 'RESULT_CLASSIFICATION_PROMPT', section: '§25.8', kind: 'jev-static', ref: RESULT_CLASSIFICATION_PROMPT, wired: false },
] as const)

/** 判据/自检发现的一条问题。 */
export interface PromptFinding {
  /** 出问题的常量名（注册表级问题用 `'<registry>'`）。 */
  readonly name: string
  /** 问题类型（机检可分类，不是自由文本）。 */
  readonly code:
    | 'not-a-function'
    | 'registry-size'
    | 'duplicate-name'
    | 'bad-type'
    | 'empty-instructions'
    | 'criteria-shape'
    | 'empty-criteria'
    | 'missing-placeholder'
  readonly detail: string
}

/** 自检选项（消费 Config 的两枚旋钮；缺省按 Config 的 default）。 */
export interface VerifyOptions {
  /** 要求含占位符的模板必须真带 `{{...}}`；关掉 = 跳过该腿（调试用）。 */
  readonly requireTemplateVariables?: boolean
  /** 期望的常量总数（缺省 = 注册表自身长度 ⇒ 只查一致性，不假装有第二种真源）。 */
  readonly expectedConstantCount?: number
}

/** 三种真 JEV 问题类型的**合法集**（唯一真源在 jev；此处只做取值校验，不重定义类型）。 */
const LEGAL_TYPES: readonly string[] = ['noul', 'choice', 'score']

/**
 * 模板串是否**应当**含占位符：按 v10 原文，只有明确写了 `{{变量名}}` 的那几条算。
 * ⚠ 另写一份名单（而不是从 ref 文本反推）：反推会把它变成**自证**。
 */
const TEMPLATES_WITH_PLACEHOLDERS: readonly string[] = Object.freeze([
  'SLEEP_INDICTION_SYSTEM_PROMPT',
  'PATH_INDUCTION_SYSTEM_PROMPT',
])

/** 单条模板/常量的静态检查（工厂先按 `sampleArgs` 取值）。 */
function checkJevQuestion(name: string, q: unknown, findings: PromptFinding[]): void {
  if (q === null || typeof q !== 'object') {
    findings.push({ name, code: 'criteria-shape', detail: '返回值不是对象' })
    return
  }
  const { type, instructions, criteria } = q as Partial<JevQuestion>
  if (typeof type !== 'string' || !LEGAL_TYPES.includes(type)) {
    findings.push({ name, code: 'bad-type', detail: 'type=' + String(type) + ' 不在合法集 ' + LEGAL_TYPES.join('/') })
  }
  if (typeof instructions !== 'string' || instructions.trim() === '') {
    findings.push({ name, code: 'empty-instructions', detail: 'instructions 为空或非字符串' })
  }
  if (type === 'score') {
    if (!Array.isArray(criteria)) {
      findings.push({ name, code: 'criteria-shape', detail: 'score 的 criteria 必须是数组' })
    } else if (criteria.length === 0) {
      findings.push({ name, code: 'empty-criteria', detail: 'score 的 criteria 数组为空' })
    }
  } else if (type === 'choice' || type === 'noul') {
    if (criteria === null || typeof criteria !== 'object' || Array.isArray(criteria)) {
      findings.push({ name, code: 'criteria-shape', detail: type + ' 的 criteria 必须是对象' })
    } else if (Object.keys(criteria).length === 0) {
      findings.push({ name, code: 'empty-criteria', detail: type + ' 的 criteria 对象为空' })
    }
  }
}

/**
 * 全量自检：注册表规模/重名/形态/类型/criteria/占位符。
 * 返回**问题清单**（空数组 = 全过）。**不抛错** —— 调用方决定怎么处置。
 */
export function verifyPrompts(options: VerifyOptions = {}): readonly PromptFinding[] {
  const findings: PromptFinding[] = []
  const want = options.expectedConstantCount ?? PROMPT_REGISTRY.length
  if (want !== PROMPT_REGISTRY.length) {
    findings.push({ name: '<registry>', code: 'registry-size', detail: '期望 ' + want + ' 条，注册表实际 ' + PROMPT_REGISTRY.length + ' 条' })
  }
  const seen = new Set<string>()
  for (const entry of PROMPT_REGISTRY) {
    if (seen.has(entry.name)) findings.push({ name: entry.name, code: 'duplicate-name', detail: '注册表重名' })
    seen.add(entry.name)
    if (entry.kind === 'system-template') {
      const text = entry.ref
      if (typeof text !== 'string' || text.trim() === '') {
        findings.push({ name: entry.name, code: 'empty-instructions', detail: '模板不是非空字符串' })
        continue
      }
      const requires = options.requireTemplateVariables ?? true
      if (requires && TEMPLATES_WITH_PLACEHOLDERS.includes(entry.name) && !/\{\{[^}]+\}\}/.test(text)) {
        findings.push({ name: entry.name, code: 'missing-placeholder', detail: '应含双花括号占位符但未找到' })
      }
      continue
    }
    if (entry.kind === 'jev-static') {
      checkJevQuestion(entry.name, entry.ref, findings)
      continue
    }
    // jev-factory：必须是函数，且按样例实参取值后仍满足全部形态要求。
    if (typeof entry.ref !== 'function') {
      findings.push({ name: entry.name, code: 'not-a-function', detail: '工厂常量不是函数' })
      continue
    }
    const args = Array.isArray(entry.sampleArgs) ? entry.sampleArgs : []
    try {
      checkJevQuestion(entry.name, (entry.ref as (...a: unknown[]) => unknown)(...args), findings)
    } catch (error) {
      findings.push({ name: entry.name, code: 'not-a-function', detail: '工厂以样例实参调用抛错：' + String(error) })
    }
  }
  return findings
}

/** 注册表里 **wired=false** 的名字（§25.8 两条，供判据与宿主读「哪些不许接线」）。 */
export const UNWIRED_PROMPT_NAMES: readonly string[] = Object.freeze(
  PROMPT_REGISTRY.filter((e) => !e.wired).map((e) => e.name),
)
