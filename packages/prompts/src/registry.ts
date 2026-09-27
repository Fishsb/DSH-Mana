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
 *
 * ── ⚠ 读数缺口：`wired` 管的是「该不该」，不是「实际上」（2026-09-27 补）──────────────
 *   实测痛点：**「登记在册」与「真被消费」在读数上同形**。旧判据⑥只核「标 false 的确实是
 *   false」，**从不核「标 true 的是否真有消费者」** ⇒ `wired: true` 是**单向声明**，
 *   标错了永远不会被发现。实测：20 条里 18 条 `wired: true`，而**当前有真消费者的只有 3 条**。
 *   补法（两条腿都要，缺一即回到盲区）：
 *     ① **声明侧**（本文件）：每条如实用 `wiredSites` 标出**真消费点**（无消费者 ⇒ `[]`）；
 *     ② **机检侧**（判据⑥c，`tests/prompts.test.mjs`）：扫全仓非本包的 `src`，
 *        断言 **声明集 == 实测集**。两条腿是**对拍**关系 —— 只有声明没有扫描，
 *        就是「用一个声明去证明另一个声明」；只有扫描没有声明，「谁被消费了」这件事
 *        在**不在测试进程里**的读侧（宿主/面板）仍看不见。
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
  /**
   * ⚠⚠ **语义 = 「不许接线」，不是「已接线」**（§25.8 ITACL，C16 拍板不移植）。
   *
   *   · `false` ⇒ 定义在册但**不得**被宿主消费（防的是「不该接的偷偷接上」）；
   *   · `true` ⇒ **仅仅表示「没被禁」**，**不等于**「已经有人消费它」。
   *
   * ⚠ 本字段被误读过（2026-09-27 实测：读者把它读成「声明已接线」，进而误报
   *   `SAFETY_GATE_PROMPT` 标错）。**别再犯**：要问「谁真在用它」，
   *   读 `status().wiredConsumers.total`（已接线数）/ `wiredConsumers.none`（无消费者名单），
   *   以及本条的 `wiredSites`；**不要**从 `wired` 反推。
   */
  readonly wired: boolean
  /**
   * **真消费点声明**（文件:行号，按文件名+行号升序）。无消费者 ⇒ 空数组（**不写 `['无']`**）。
   *
   * 口径（「真消费」= 满足任一即算，**双路取并集**）：
   *   ① **import/裸引用名**：`import { X_PROMPT } from 'dsh-mana-prompts'` 或按名取用的代码；
   *   ② **字符串名**：`prompts.get('X_PROMPT')`（本仓三条真消费**全是这一路**）。
   * 扫描面 = 全仓 `packages` 下**非 prompts 包**的 `src` 目录里全部 `.ts`，**剥注释**
   * （本仓实测：注释里的字面量会冒充代码，属同一类假绿）。已接线数实测 **3/20**（2026-09-27）。
   *
   * ⚠ 这是**人写的声明**，与 `wired: true` 同属**单向声明**、同样没有牙 ——
   *   所以它**必须**与判据⑥c 的扫描**对拍**（声明集 ≠ 实测集 ⇒ `wired-declaration-mismatch`）。
   *   唯一的机检入口是判据侧（`verifyPrompts` 的 `consumerSites` 选项）：
   *   本包 src **不做** fs / 全仓扫描（纯数据 + 纯函数包，宿主侧不可依赖仓结构）。
   * ⚠ **行号是会漂的**（改名/插行即漂）：本条目的**稳定身份是 `name`**；
   *   `wiredSites` 只是「此刻谁在消费」的读数，漂了就该由判据红出来再人工订正。
   */
  readonly wiredSites: readonly string[]
}

/**
 * 二十个常量的注册表（v10 §25.1–25.8）。
 *
 * ⚠ 顺序按 v10 原文小节排（编码 → 巩固 → 检索 → 再巩固 → 遗忘 → 学习 → 调度 → ITACL），
 *   便于人读与原文对拍；**计数判据不看顺序**，只看集合。
 */
export const PROMPT_REGISTRY: readonly PromptEntry[] = Object.freeze([
  // ── §25.1 编码链条 ────────────────────────────────────────────────────────
  { name: 'WRITE_GATE_PROMPT', section: '§25.1', kind: 'jev-static', ref: WRITE_GATE_PROMPT, wired: true, wiredSites: [] },
  { name: 'SUPERSEDES_PROMPT', section: '§25.1', kind: 'jev-factory', ref: SUPERSEDES_PROMPT, sampleArgs: [['旧记忆甲', '旧记忆乙']], wired: true, wiredSites: [] },
  { name: 'EMOTION_VALENCE_PROMPT', section: '§25.1', kind: 'jev-static', ref: EMOTION_VALENCE_PROMPT, wired: true, wiredSites: [] },
  { name: 'EMOTION_AROUSAL_PROMPT', section: '§25.1', kind: 'jev-static', ref: EMOTION_AROUSAL_PROMPT, wired: true, wiredSites: [] },
  // ── §25.2 巩固链条 ────────────────────────────────────────────────────────
  { name: 'CONSOLIDATION_TRIGGER_PROMPT', section: '§25.2', kind: 'jev-static', ref: CONSOLIDATION_TRIGGER_PROMPT, wired: true, wiredSites: [] },
  { name: 'CHUNKING_UTILITY_PROMPT', section: '§25.2', kind: 'jev-static', ref: CHUNKING_UTILITY_PROMPT, wired: true, wiredSites: [] },
  { name: 'SLEEP_INDICTION_SYSTEM_PROMPT', section: '§25.2', kind: 'system-template', ref: SLEEP_INDICTION_SYSTEM_PROMPT, wired: true, wiredSites: ['packages/consolidation/src/generation.ts:42'] },
  // ── §25.3 检索链条 ────────────────────────────────────────────────────────
  { name: 'INTENT_CLASSIFICATION_SYSTEM_PROMPT', section: '§25.3', kind: 'system-template', ref: INTENT_CLASSIFICATION_SYSTEM_PROMPT, wired: true, wiredSites: ['packages/perception/src/parse.ts:102'] },
  { name: 'RECALL_GATE_PROMPT', section: '§25.3', kind: 'jev-factory', ref: RECALL_GATE_PROMPT, sampleArgs: ['样例记忆摘要'], wired: true, wiredSites: [] },
  { name: 'INJECTION_GATE_PROMPT', section: '§25.3', kind: 'jev-static', ref: INJECTION_GATE_PROMPT, wired: true, wiredSites: [] },
  // ── §25.4 再巩固链条 ──────────────────────────────────────────────────────
  { name: 'RECONSOLIDATION_UPDATE_PROMPT', section: '§25.4', kind: 'jev-factory', ref: RECONSOLIDATION_UPDATE_PROMPT, sampleArgs: ['原记忆文本', '新信息文本'], wired: true, wiredSites: [] },
  // ── §25.5 遗忘链条 ────────────────────────────────────────────────────────
  { name: 'ACTIVITY_LEVEL_PROMPT', section: '§25.5', kind: 'jev-static', ref: ACTIVITY_LEVEL_PROMPT, wired: true, wiredSites: [] },
  { name: 'COMPRESSION_SYSTEM_PROMPT', section: '§25.5', kind: 'system-template', ref: COMPRESSION_SYSTEM_PROMPT, wired: true, wiredSites: ['packages/long-term/src/summarize.ts:60'] },
  // ── §25.6 学习链条（**整链无 JevQuestion**）────────────────────────────────
  { name: 'PRINCIPLE_EXTRACTION_SYSTEM_PROMPT', section: '§25.6', kind: 'system-template', ref: PRINCIPLE_EXTRACTION_SYSTEM_PROMPT, wired: true, wiredSites: [] },
  { name: 'PATH_INDUCTION_SYSTEM_PROMPT', section: '§25.6', kind: 'system-template', ref: PATH_INDUCTION_SYSTEM_PROMPT, wired: true, wiredSites: [] },
  // ── §25.7 调度链条（**三条全是工厂**）──────────────────────────────────────
  { name: 'UNFAMILIAR_TASK_PROMPT', section: '§25.7', kind: 'jev-factory', ref: UNFAMILIAR_TASK_PROMPT, sampleArgs: ['样例任务', '样例历史'], wired: true, wiredSites: [] },
  { name: 'TOOL_ROUTING_PROMPT', section: '§25.7', kind: 'jev-factory', ref: TOOL_ROUTING_PROMPT, sampleArgs: [['read', 'write']], wired: true, wiredSites: [] },
  { name: 'SAFETY_GATE_PROMPT', section: '§25.7', kind: 'jev-factory', ref: SAFETY_GATE_PROMPT, sampleArgs: ['删除文件'], wired: true, wiredSites: [] },
  // ── §25.8 ITACL 专用（**不移植**：定义在册，wired=false）─────────────────────
  { name: 'TASK_COMPLEXITY_PROMPT', section: '§25.8', kind: 'jev-static', ref: TASK_COMPLEXITY_PROMPT, wired: false, wiredSites: [] },
  { name: 'RESULT_CLASSIFICATION_PROMPT', section: '§25.8', kind: 'jev-static', ref: RESULT_CLASSIFICATION_PROMPT, wired: false, wiredSites: [] },
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
    /** 声明有消费者、扫描零引用（既存 15 条与负控都落这一类）。 */
    | 'wired-consumer-missing'
    /** 实测有消费者、声明里没写（或声明集 != 实测集）=> 反方向也说。 */
    | 'wired-consumer-undeclared'
    /** wiredSites 声明与实测集合不符（B 与 A 的对拍腿；含行号漂移）。 */
    | 'wired-declaration-mismatch'
  readonly detail: string
}

/** 自检选项（消费 Config 的两枚旋钮；缺省按 Config 的 default）。 */
export interface VerifyOptions {
  /** 要求含占位符的模板必须真带 `{{...}}`；关掉 = 跳过该腿（调试用）。 */
  readonly requireTemplateVariables?: boolean
  /** 期望的常量总数（缺省 = 注册表自身长度 ⇒ 只查一致性，不假装有第二种真源）。 */
  readonly expectedConstantCount?: number
  /**
   * **真消费点实测表**（判据⑥c 的对拍输入）：常量名 -> 实测消费点（文件:行号）。
   *
   * **不给**（缺省 undefined）=> 少一条腿（人工/宿主自检场景，仓根未必可枚举，程序性跳过）。
   * **给了**（含空表 {}，即「实测一条消费者都没有」）=> 开**对拍腿**，两条断言同时上：
   *   ① wired=true 的实测集必须非空（wired-consumer-missing）；
   *   ② 每条注册表的 wiredSites 声明集必须**逐项等于**实测集（wired-declaration-mismatch），
   *      反方向（实测有、声明无）落 wired-consumer-undeclared。
   *
   * ⚠ 为什么把实测表**当输入**而不是在本文件里扫盘：本包是**纯数据 + 纯函数包**
   *   （不调 fs、不依赖仓结构）—— 产物会被装进宿主，扫描仓根在那里没有意义。
   *   扫描由判据侧做（那里本来就在读 src）；但**对拍逻辑住在这里**，
   *   这样「声明 vs 实测」的判据只有**一份实现**，判据侧不能只测自己那半边。
   */
  readonly consumerSites?: Readonly<Record<string, readonly string[]>>
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
  // ── 腿 ⑥c 声明 vs 实测的对拍（只有给了实测表才开；见 VerifyOptions.consumerSites）
  if (options.consumerSites !== undefined) {
    const sites = options.consumerSites
    for (const entry of PROMPT_REGISTRY) {
      const declared = [...entry.wiredSites].sort()
      const observed = [...(sites[entry.name] ?? [])].sort()
      if (entry.wired && observed.length === 0) {
        findings.push({
          name: entry.name,
          code: 'wired-consumer-missing',
          detail: 'wired=true 全仓扫描零消费点（wired 的语义是「没被禁」，非「被消费」；无消费者请把 wiredSites 留空）',
        })
      }
      if (declared.join('|') !== observed.join('|')) {
        findings.push({
          name: entry.name,
          code: 'wired-declaration-mismatch',
          detail: 'wiredSites 声明 [' + declared.join(', ') + '] 与实测 [' + observed.join(', ') + '] 不符',
        })
        const missing = observed.filter((s) => !declared.includes(s))
        if (missing.length > 0) {
          findings.push({ name: entry.name, code: 'wired-consumer-undeclared', detail: '实测有消费者但注册表未声明：' + missing.join(', ') })
        }
      }
      if (!entry.wired && observed.length > 0) {
        findings.push({ name: entry.name, code: 'wired-consumer-undeclared', detail: '§25.8 标 wired=false 却出现消费者：' + observed.join(', ') })
      }
    }
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

/**
 * 「谁真被消费了」的读数（**由 wiredSites 派生**，不手写常数 —— 手写会造出会漂的第二份真源）。
 *
 * ⚠ 与 wired 的分工：wired 管**该不该**（立法），本读数管**实际上有没有人用**（实况）。
 *   两者**互不蕴含**：wired=true 且 consumed 里查无此名 = 「登记在册但没人消费」，
 *   这正是 2026-09-27 之前看不见的那件事。
 * ⚠ 只读**声明**（wiredSites）：声明是否属实由判据⑥c（verifyPrompts 的 consumerSites 对拍腿）核，
 *   本读数**不**自行扫盘（纯函数包，见 VerifyOptions.consumerSites）。
 */
export interface WiredConsumers {
  /** 常量总数。 */
  readonly total: number
  /** **已接线数**：wiredSites 非空（= 实测有真消费点）的条数。 */
  readonly withConsumers: number
  /** 无任何真消费点的条数（含 wired=true 却没人用的那些 —— 那才是本读数要暴露的事）。 */
  readonly none: number
  /** 逐条真消费点（文件:行号），只列**有**的；键按名字升序，值按原文顺序。 */
  readonly sites: Readonly<Record<string, readonly string[]>>
  /** 无消费者的名字（升序，含 wired=false 的两条）。 */
  readonly unconsumed: readonly string[]
  /**
  /** 无消费者**且 wired=true** 的名字（升序）—— 「登记了、也允许接，但没有一处真在用」。
   *  ⚠ 这才是本读数要暴露的那件事；实测 **15** 条（2026-09-27）。
   *  `unconsumed.length - unconsumedWired.length` = §25.8 那两条（本来就不许接）。
   */
  readonly unconsumedWired: readonly string[]
}

/** 由注册表**派生**「已接线数 / 无消费者名单」（口径见 WiredConsumers）。 */
export function wiredConsumers(registry: readonly PromptEntry[] = PROMPT_REGISTRY): WiredConsumers {
  const sites: Record<string, readonly string[]> = {}
  const unconsumed: string[] = []
  const unconsumedWired: string[] = []
  for (const e of [...registry].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.wiredSites.length === 0) {
      unconsumed.push(e.name)
      if (e.wired) unconsumedWired.push(e.name)
    } else sites[e.name] = Object.freeze([...e.wiredSites])
  }
  const withConsumers = Object.keys(sites).length
  return Object.freeze({
    total: registry.length,
    withConsumers,
    none: unconsumed.length,
    sites: Object.freeze(sites),
    unconsumed: Object.freeze(unconsumed),
    unconsumedWired: Object.freeze(unconsumedWired),
  })
}
