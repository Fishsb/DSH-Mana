/**
 * **会话蒸馏链（v10 §12.3）—— 本仓的第一个落点。**
 *
 * ── 要解决的现象（本卡开工事实）────────────────────────────────────────────────
 *   v10 §12.3 原文流程：
 *     空闲 10 分钟 → 信号词预筛（零 LLM 成本） → LLM 子代理按蒸馏契约裁决
 *       → JEV 白名单门禁过闸 → 粒度判定：只收粗粒度指引 → 过门写回记忆库
 *   本仓 2026-09-26 实测：packages/perception/src/signal.ts 的 prefilterBySignalWords
 *   **零消费方**（全仓 grep 只有它自己的定义与注释）⇒ 「预筛有了」与「预筛在用」**同形**。
 *   这正是本仓头号缺陷类（让失败不可观测）的又一实例：一个写得很好、单测也全绿的模块，
 *   在生产链上**从未被调用过**，而这件事从任何单测/字数统计里都看不出来。
 *
 * ── 本文件把那条链接起来（每一环都有可分辨的读数）───────────────────────────────
 *   ① **空闲触发**：idleMs >= DISTILL_IDLE_THRESHOLD_MS（v10 的 10 分钟）；未到点即
 *      返回 state='not-idle' 且**零 LLM 调用**（「没到点」与「跑了但没东西」必须分开）。
 *   ② **信号词预筛（零 LLM 成本）**：调用**真实现** prefilterBySignalWords（运行期从
 *      dsh-mana-perception 解析，与 vector-cosine.ts/generation.ts 同一条既有取舍）；
 *      miss 或 empty ⇒ 就地返回，llmCalls === 0。⚠ 本卡最核心的一条：
 *      「零 LLM 成本」必须是**可计数的读数**，不是注释里的一句话。
 *   ③ **LLM 子代理按蒸馏契约裁决**：走 mana-llm 的 generate（唯一出口），system prompt
 *      取本文件的 distillSystemPrompt()（契约**在代码里**，不在注释里）；回复按显式形状
 *      解析，拿不到就退 unparsable / shape-invalid，**不猜**（把"解析不了"当成"没有提议"
 *      是本仓禁止的同形化）。每条提议**必须回指**它来自哪一条候选（from 字段），
 *      否则"这条提议的预筛命中词"就无从复算。
 *   ④ **白名单门禁过闸**：distillWhitelistGate（**蒸馏侧准入**，见下「两道门」）。
 *   ⑤ **粒度判定：只收粗粒度指引**：judgeGranularity（确定性过细特征扫描）。
 *   ⑥ **过门写回记忆库**：DistillStore.write（生产 = core.writeMemoryItem），
 *      落库前查同内容是否已在库（幂等腿），写入 id 确定性派生且带 dist_ 前缀。
 *
 * ── 两道门**不许坍成一道**（本卡硬要求，也是最容易做错的一处）──────────────────
 *   本仓同时存在两道判定，它们**判的不是同一件事**，故**不得复用同一份判定逻辑**：
 *
 *   | | 蒸馏侧白名单门（本文件 distillWhitelistGate） | 编码侧 Write Gate（packages/long-term） |
 *   |---|---|---|
 *   | 判什么 | 这条**蒸馏产出**能不能进记忆库的**这个地址**（准入） | 一条**观察**值不值得长期记住（JEV 判定 + bigram 预过滤） |
 *   | 判据来源 | 地址白名单 + 行首标签白名单 + 索引行形状（守藏侧现役硬门） | 判定问法本身（WRITE_GATE_QUESTION）的 bigram 交集 |
 *   | 层级 | 蒸馏链第 ④ 步（产出侧） | 编码链第 ④ 步（输入侧，writeGate()） |
 *
 *   ⇒ 本文件**不重写** Write Gate 的任何一条判据；对编码侧码判只做**注入式调用**
 *     （DistillCodeGate，生产注入的正是 long-term 的 prefilterWorthKeeping）。
 *     这不是"多一层"，而是本卡要的可观测性：**两道门各自否决了什么**在 DistillDecision
 *     里分列（whitelist / codeGate 两个字段），使「被白名单挡了」与「被编码侧码判挡了」
 *     **永不同形**。
 *
 * ── 失败态逐条有名字（本卡硬要求 ③）────────────────────────────────────────────
 *   | state | 触发 | LLM 调用 |
 *   |---|---|---|
 *   | not-idle | 空闲未到阈值 | **0** |
 *   | prefiltered-out | 空闲已到，但**预筛未命中**（含空文本） | **0**（核心判据） |
 *   | prefilter-unavailable | 预筛**实现不可解析**（perception 未装配/产物缺失） | 0 |
 *   | no-llm | 预筛命中了，但判定通道不可用或降级 | >=1 |
 *   | rejected-by-gate | 裁决成功但**零条过门** | >=1 |
 *   | adjudicated | 至少一条过门并（store 在场时）写回 | >=1 |
 *   ⚠ prefiltered-out 与 prefilter-unavailable 的 llmCalls **都是 0**，若状态同形，
 *     则「预筛把无关输入挡下了」（正常）与「预筛压根没跑起来」（故障）不可分辨 ——
 *     那正是本仓反复出现的形态。故前者带非空 prefilter.table 与 scanned>0 口径，
 *     后者 prefilter.ran=false + scanned=0 + reason 点名解析失败。
 *
 * ── 不做什么（边界，逐条写清而不是留白）─────────────────────────────────────────
 *   · **不注册监听器、不起定时器**：触发源归 scheduler（本包既有分工，见 index.ts 头部）；
 *     空闲判定由**调用方传入 idleMs**（"谁喂这个数"是接线问题，不是本文件的事）。
 *   · **不写自己的审计表**：留痕归既有面（mana_trace / jev_log）；真正的写入只经
 *     core.writeMemoryItem —— 本文件**不**新开第二条记忆写路径。
 *   · **不碰 Events 契约**（ManaObservation 等一格未动）。
 *   · **不实现守藏侧的会话痕迹收割**：那是 dsh-mana-shoucang-adapter 的面，且该包已被
 *     裁定**不落地**（触碰「不动 shouchang」notDoing）⇒ 候选由调用方喂入。
 *   · **不新造 memory_items.type**：落库 type 取 store.type（生产 'observation' —— 与
 *     Write Gate 落库同一个 type，不制造第二种"看起来像记忆"的行）。
 */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SignalVerdict, SignalWordTable } from 'dsh-mana-perception'

// ── 常量（**每个都是判据面**：判据按它们断言，不写第二份字面量）────────────────────

/** v10 §12.3 的空闲阈值：**10 分钟**（原文「空闲 10 分钟」）。 */
export const DISTILL_IDLE_THRESHOLD_MS = 10 * 60 * 1000

/** 落库 type 的**生产缺省**（= Write Gate 落库用的那个 type，不新造第二种）。 */
export const DISTILL_MEMORY_TYPE = 'observation'

/** 索引行最小内容长度（码点）。低于此值承载不了「主题·概况」两段 ⇒ 不写空占位行。 */
export const DISTILL_MIN_TEXT_CHARS = 8

/**
 * 粗粒度的**长度上界**（码点）。
 *
 * ⚠ 为什么它是必要的：v10 §12.3 的粒度判定是「**只收粗粒度指引**」，而"细"在数据上
 *   至少有一个可数表现 —— **长**。没有上界时，"一条 500 字的现场流水"与"一条方向指引"
 *   在判据上**同形**（都算"过了门"）。取 120 的理由：守藏侧索引行硬门本身要求概况 <=30 字
 *   （[路径] 概要 <=40 字），120 已给足余量而仍能挡住流水账。
 */
export const DISTILL_MAX_COARSE_CHARS = 120

/**
 * **蒸馏侧白名单门的地址白名单**（逐字比对）。
 *
 * ⚠ 它与 packages/long-term 的 Write Gate **没有共享任何一个常量或函数**：
 *   那道门判「值不值得留」（问法 bigram），本门判「能不能写进这个地址」（准入）。
 *   两道门复用同一份判定就会坍成一道 —— 那时「蒸馏产出不合规」会被读成
 *   「这条观察不值得记」，而两者的处置完全不同（前者改产出、后者不必记）。
 */
export const DISTILL_ADDRESS_WHITELIST = Object.freeze([
  'USER.md',
  'AGENT.md',
  'notes/tools.md',
  'notes/lessons.md',
  'notes/env.md',
  'notes/flows.md',
  'notes/user.md',
  'notes/agent.md',
])

/**
 * **行首标签白名单**（14 类，逐字）—— 不另立标准，只把守藏写门的硬门口径做成可机检常量
 * （原文见 packages/metacognition/src/criteria.generated.ts 的 INGEST_JUDGE：
 *  「行首标签必须逐字取下列之一，白名单外整条被拒」）。
 */
export const DISTILL_LABEL_WHITELIST = Object.freeze([
  'env', 'tool', 'flow', 'lesson',
  '身份', '环境', '硬件', '偏好', '习惯', '使命', '边界', '经验', '演化', '教训',
])

/**
 * **只允许进 AGENT.md 的两个标签**（原文：「[原则]/[路径] 不在 newIndex 白名单内 ——
 * 它们是 AGENT.md 的画像行……写进 newIndex 必被拒（这是真机最高频的两类流失）」）。
 * ⇒ 本门做成**按目标地址分档**的判据：非 AGENT.md 目标出现这两个标签即否决。
 */
export const DISTILL_AGENT_ONLY_LABELS = Object.freeze(['原则', '路径'])

/** 主题分隔符（原文：「必须含中间点「·」分隔主题与概况」）。 */
export const DISTILL_TOPIC_SEPARATOR = '·'

/** 预筛实现的服务名（生产入口；判据可覆盖为别的 specifier 造失败路径）。 */
export const DISTILL_PREFILTER_SERVICE = 'dsh-mana-perception' as const

/** 全部状态（判据按集合断言，不抽查）。 */
export const DISTILL_STATES = Object.freeze([
  'not-idle', 'prefiltered-out', 'prefilter-unavailable', 'no-llm', 'rejected-by-gate', 'adjudicated',
]) as readonly string[]

// ── 纯函数工具 ───────────────────────────────────────────────────────────────

/** 按**码点**计数（不是 UTF-16 码元：代理对会被算成 2 个字符 ⇒ 阈值对 emoji 失准）。 */
export function charCount(text: string): number {
  return [...String(text ?? '')].length
}

/** 取行首标签：形如「- [偏好] 开源优先」⇒ '偏好'；无标签 ⇒ **null**（显式区分于空串）。 */
export function leadingLabelOf(text: string): string | null {
  const m = /^\s*[-*]?\s*\[([^\]\n]{1,12})\]/.exec(String(text ?? ''))
  return m && m[1] !== undefined ? m[1] : null
}


// ── ① 预筛实现解析（**与 vector-cosine.ts 同一条既有取舍**：运行期解析 + 显式三态）──
/**
 * 为什么走运行期解析而不是值 import：
 *   · 本包 package.json 的依赖里没有 dsh-mana-perception（本席写面不含 package.json）
 *     ⇒ 值 import 会让**本包的依赖声明与真依赖不一致**；
 *   · 与 generation.ts（解析 mana-prompts/mana-llm）、vector-cosine.ts（解析
 *     dsh-mana-vector）**同源**，不另发明第三套连接方式。
 * ⚠ **解析失败绝不允许被读成"预筛没命中"**：前者 prefilter-unavailable（故障），
 *   后者 prefiltered-out（正常挡下）—— 两者 llmCalls 都是 0，**只有状态名能区分它们**。
 */
export interface SignalPrefilterFn {
  (text: string, table?: SignalWordTable): SignalVerdict
}

export type SignalPrefilterResolution =
  | { readonly ok: true; readonly prefilter: SignalPrefilterFn; readonly source: string }
  | { readonly ok: false; readonly prefilter: null; readonly source: string; readonly reason: string }

export function resolveSignalPrefilter(specifier: string = DISTILL_PREFILTER_SERVICE): SignalPrefilterResolution {
  let entryUrl: string
  try {
    entryUrl = import.meta.resolve(specifier)
  } catch (error) {
    return {
      ok: false,
      prefilter: null,
      source: specifier,
      reason:
        '入口解析失败（' + (error instanceof Error ? error.message : String(error)) +
        '）⇒ 预筛**未执行**。这不是「未命中」：两者都产生 0 次 LLM 调用，必须靠状态名区分。',
    }
  }
  const source = join(dirname(fileURLToPath(entryUrl)), 'index.js')
  try {
    const req = createRequire(import.meta.url)
    const mod = req(source) as { prefilterBySignalWords?: unknown }
    if (typeof mod.prefilterBySignalWords !== 'function') {
      return { ok: false, prefilter: null, source, reason: source + ' 未导出函数 prefilterBySignalWords（实际 ' + typeof mod.prefilterBySignalWords + '）' }
    }
    return { ok: true, prefilter: mod.prefilterBySignalWords as SignalPrefilterFn, source }
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'ERR'
    return { ok: false, prefilter: null, source, reason: '加载 ' + source + ' 失败（' + code + '）：' + (error as Error).message }
  }
}

/** 内置词表的取用（判据要断言"用的是真表" ⇒ 它单独可见）。 */
export function resolveBuiltinSignalTable(specifier: string = DISTILL_PREFILTER_SERVICE): SignalWordTable | null {
  try {
    const entryUrl = import.meta.resolve(specifier)
    const req = createRequire(import.meta.url)
    const mod = req(join(dirname(fileURLToPath(entryUrl)), 'index.js')) as { BUILTIN_SIGNAL_TABLE?: unknown }
    const table = mod.BUILTIN_SIGNAL_TABLE as SignalWordTable | undefined
    if (!table || !Array.isArray(table.words) || typeof table.name !== 'string') return null
    return table
  } catch {
    // 这里**允许**吞错：返回 null 是显式的"取不到"，调用方据此落 prefilter-unavailable
    // （与"取到了一张空表"可分辨 —— 后者 table.name 非空而 words 为空）。
    return null
  }
}

// ── ④ 蒸馏侧白名单门（准入判据 · **纯函数**）──────────────────────────────────

/** 准入否决腿的可枚举名（**机检面**：判据按名字断言，不读自由文本）。 */
export type DistillGateLeg = 'address' | 'label' | 'shape' | 'idempotence'

export interface DistillAdmission {
  readonly admitted: boolean
  /** 放行时为 null；否决时**必非空**（失败必须可归因）。 */
  readonly leg: DistillGateLeg | null
  readonly reason: string | null
  /** 本条被判中的地址（放行时为白名单里的那一项；否决时原样回显输入）。 */
  readonly address: string
  /** 行首标签（无标签为 null —— 显式区分于空串）。 */
  readonly label: string | null
}

/**
 * **蒸馏侧白名单门**（v10 §12.3 第 ④ 步）。四条腿逐条对应守藏侧**现役**的写门硬门：
 *   L1 address     —— 目标地址必须在 DISTILL_ADDRESS_WHITELIST 内（逐字）；
 *   L2 label       —— 行首标签必须在 DISTILL_LABEL_WHITELIST 内；[原则]/[路径] 只允许进 AGENT.md；
 *   L3 shape       —— 长度 >= DISTILL_MIN_TEXT_CHARS 且含主题分隔符（原文硬门）；
 *   L4 idempotence —— 同内容已在库 ⇒ 不重复写（原文：「宁缺毋滥」）。
 *
 * ⚠ **它是纯函数**（无 IO、无 ctx）："这条为什么被拒"因此可脱离装配环境复算，
 *   生产路径只负责把 alreadyPresent 查出来喂给它。
 * ⚠ 它**不判**「值不值得记」—— 那是编码侧 Write Gate 的事（见文件头「两道门」）。
 */
export function distillWhitelistGate(
  proposal: { readonly target: unknown; readonly text: unknown },
  context: { readonly alreadyPresent: boolean },
): DistillAdmission {
  const address = String(proposal?.target ?? '')
  const text = String(proposal?.text ?? '')
  const label = leadingLabelOf(text)
  const deny = (leg: DistillGateLeg, reason: string): DistillAdmission => ({ admitted: false, leg, reason, address, label })

  if (!(DISTILL_ADDRESS_WHITELIST as readonly string[]).includes(address)) {
    return deny('address', '目标地址不在白名单内：「' + address + '」不在 [' + DISTILL_ADDRESS_WHITELIST.join(' | ') + '] ⇒ 整条被拒（准入判据，**不是**「不值得记」）')
  }
  if (label === null) {
    return deny('label', '行首标签缺失：必须以 [标签] 开头（白名单 ' + String(DISTILL_LABEL_WHITELIST.length) + ' 类）⇒ 整条被拒')
  }
  const agentOnly = (DISTILL_AGENT_ONLY_LABELS as readonly string[]).includes(label)
  if (agentOnly && address !== 'AGENT.md') {
    return deny('label', '标签 [' + label + '] 只允许进 AGENT.md（原文：这两个标签不在 newIndex 白名单内，写进去必被拒），目标是「' + address + '」⇒ 整条被拒')
  }
  if (!agentOnly && !(DISTILL_LABEL_WHITELIST as readonly string[]).includes(label)) {
    return deny('label', '标签不在白名单内：[' + label + '] 不在 [' + DISTILL_LABEL_WHITELIST.join(' | ') + '] ⇒ 整条被拒')
  }
  const chars = charCount(text)
  if (chars < DISTILL_MIN_TEXT_CHARS) {
    return deny('shape', '内容过短（' + String(chars) + ' 码点 < ' + String(DISTILL_MIN_TEXT_CHARS) + '）⇒ 承载不了「主题·概况」两段，不写占位行')
  }
  if (!text.includes(DISTILL_TOPIC_SEPARATOR)) {
    return deny('shape', '缺主题分隔符「' + DISTILL_TOPIC_SEPARATOR + '」：索引行必须是「主题' + DISTILL_TOPIC_SEPARATOR + '概况」形状 ⇒ 整条被拒')
  }
  if (context.alreadyPresent) {
    return deny('idempotence', '同内容已在库（逐字命中）⇒ 不重复写（幂等腿；这不是「被判定为不值得记」）')
  }
  return { admitted: true, leg: null, reason: null, address, label }
}

// ── ⑤ 粒度判定（只收粗粒度指引）─────────────────────────────────────────────

/** 过细特征的可枚举名（**机检面**：判据按名字断言）。 */
export const DISTILL_TOO_FINE_FEATURES = Object.freeze([
  'coarse-claim-missing', // 模型未声明 coarse=true（缺声明 ⇒ 不作断定）
  'date-stamp',           // 一次性事实：带日期戳
  'concrete-path',        // 项目专名/具体路径：只在单一工作区成立
  'line-number',          // 细节条文：带行号/列号
  'over-max-chars',       // 流水账：超出粗粒度长度上界
])

export interface GranularityReading {
  readonly coarse: boolean
  /** 命中的过细特征（**有序、可枚举**）；空数组 = 未命中任何一条。 */
  readonly features: readonly string[]
  readonly chars: number
}

/**
 * **粒度判定：只收粗粒度指引**（v10 §12.3 第 ⑤ 步）。
 *
 * ⚠ 为什么用**确定性特征**而不是让模型自己说「我很粗」：自述不可判。模型的 coarse
 *   字段只作**必要条件之一**（coarse-claim-missing 那条），位置/行号/日期这类**可数**
 *   的事实由本函数自己扫。四条正则各自对应一条**可复现**形态，判据能对同一输入复算出
 *   同样的 features（"复算得出"是 A 档判据的前提，见 docs/contract/threshold-discipline.md）。
 */
export function judgeGranularity(
  proposal: { readonly text: unknown; readonly coarse?: unknown },
  overrides?: { readonly maxChars?: number },
): GranularityReading {
  const text = String(proposal?.text ?? '')
  const chars = charCount(text)
  const maxChars = overrides?.maxChars ?? DISTILL_MAX_COARSE_CHARS
  const features: string[] = []
  if (proposal?.coarse !== true) features.push('coarse-claim-missing')
  if (/(?:19|20)\d{2}-\d{2}-\d{2}/.test(text)) features.push('date-stamp')
  if (/(^|\s)(\/|\.\.?\/|[A-Za-z]:\\)/.test(text) || /[\w.:-]+\/[\w.-]+\.(ts|js|mjs|md|json|yml|yaml)\b/.test(text)) {
    features.push('concrete-path')
  }
  if (/(:\d+\b|第\s*\d+\s*行|\bL\d+\b)/.test(text)) features.push('line-number')
  if (chars > maxChars) features.push('over-max-chars')
  return { coarse: features.length === 0, features, chars }
}


// ── ③ LLM 裁决：契约、调用、解析 ──────────────────────────────────────────────

/** mana-llm 的**结构面**（只声明本文件真正调到的成员，不 import 该包）。 */
export interface DistillLlmService {
  generate(request: { readonly system?: string; readonly prompt: string; readonly model?: string }): Promise<
    | { readonly ok: true; readonly text: string; readonly callId: string }
    | { readonly ok: false; readonly text: null; readonly callId: string; readonly reason: string; readonly degraded: string }
  >
}

/** 蒸馏裁决的 system prompt（**唯一真源**；口径从常量拼出，不手抄一遍）。 */
export function distillSystemPrompt(): string {
  return [
    '你是会话蒸馏裁决器（v10 §12.3）。给你若干条**已过信号词预筛**的会话片段，',
    '请判断其中哪些含「跨会话可复用的粗粒度指引」，并按蒸馏契约输出。',
    '',
    '硬性要求：',
    '1. 只收**粗粒度指引**：一句方向/教训/流程。**不收**日期戳、具体文件路径、行号、一次性进度、流水账。',
    '2. from 必须逐字回指材料里的候选编号（形如 c1 / c2），不得自造。',
    '3. target 必须逐字取下列之一：' + DISTILL_ADDRESS_WHITELIST.join(' | ') + '。',
    '4. 行首标签必须逐字取下列之一：' + DISTILL_LABEL_WHITELIST.join(' | ') +
      '；其中 [' + DISTILL_AGENT_ONLY_LABELS.join('] [') + '] 只允许 target=AGENT.md。',
    '5. 内容必须含主题分隔符「' + DISTILL_TOPIC_SEPARATOR + '」（形状：主题' + DISTILL_TOPIC_SEPARATOR + '概况）。',
    '6. 宁缺毋滥：没有合格项就返回空数组，**不要为凑数编造**。',
    '',
    '只输出 JSON（不要解释、不要代码围栏）：',
    '{"proposals":[{"from":"c1","text":"[偏好] 主题' + DISTILL_TOPIC_SEPARATOR + '概况","target":"notes/user.md","coarse":true,"why":"一句话理由"}]}',
  ].join('\n')
}

/** 把候选拼成 user 侧材料（**带 c<序号> 编号**，使裁决结果可回指到输入的那一条）。 */
export function distillMaterial(candidates: readonly string[]): string {
  return candidates.map((c, i) => '[c' + String(i + 1) + '] ' + String(c)).join('\n')
}

export interface DistillProposalDraft {
  /** 材料里的候选编号（**单射**：解析层已校验存在性与范围）。 */
  readonly from: string
  readonly text: string
  readonly target: string
  /** 模型自报的粗粒度声明（**缺省 false** —— 缺声明按"未声明"处理，不按"合格"）。 */
  readonly coarse: boolean
  readonly why: string | null
}

export interface ProposalParseReading {
  readonly state: 'ok' | 'empty' | 'unparsable' | 'shape-invalid'
  readonly reason: string
  readonly accepted: readonly DistillProposalDraft[]
  /** 逐条不合形状的原始项与理由（**不许静默丢弃**：丢在解析层会让"没提议"与"提议被吞"同形）。 */
  readonly rejected: readonly { readonly raw: string; readonly reason: string }[]
}

/**
 * 代码围栏字面量（**不写三个连续反引号**：本仓 SCHEMA_SQL 在模板串里已三次踩过同类坑
 * —— 反引号会提前终止模板串，而报出的错指不到真因）。
 */
const CODE_FENCE = String.fromCharCode(96).repeat(3)

/** 提取第一个 JSON 对象（容忍代码围栏与前后说明文字；**失败即显式失败，不猜**）。 */
export function extractJsonObject(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const src = String(text ?? '').trim()
  if (src.length === 0) return { ok: false, reason: '上游返回空文本（它不是"没有提议"—— 是这一次裁决没有可解析的产出）' }
  const fenceRe = new RegExp(CODE_FENCE + '(?:json)?\\s*([\\s\\S]*?)' + CODE_FENCE, 'i')
  const fenced = fenceRe.exec(src)
  const body = fenced && fenced[1] !== undefined && fenced[1].trim() !== '' ? fenced[1] : src
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, reason: '未找到 JSON 对象边界（首个 { 到末个 }）；原文前 200 字：' + src.slice(0, 200) }
  try {
    return { ok: true, value: JSON.parse(body.slice(start, end + 1)) as unknown }
  } catch (error) {
    return { ok: false, reason: 'JSON.parse 失败：' + String((error as Error)?.message ?? error) + '；原文前 200 字：' + src.slice(0, 200) }
  }
}

/**
 * 把裁决回复解析成提议清单（四态；**每一态都有名字**）。
 *
 * @param opts.candidateCount 候选条数（用于校验 from 的范围；缺省 = 只校验形状，不校验范围）。
 */
export function parseAdjudication(text: string, opts?: { readonly candidateCount?: number }): ProposalParseReading {
  const extracted = extractJsonObject(text)
  if (!extracted.ok) return { state: 'unparsable', reason: extracted.reason, accepted: [], rejected: [] }
  const value = extracted.value as { proposals?: unknown } | null
  if (value === null || typeof value !== 'object' || !('proposals' in value)) {
    return { state: 'shape-invalid', reason: '顶层不是含 proposals 键的对象（实测 ' + JSON.stringify(value)?.slice(0, 120) + '）', accepted: [], rejected: [] }
  }
  if (!Array.isArray(value.proposals)) {
    return { state: 'shape-invalid', reason: 'proposals 不是数组（实际 ' + typeof value.proposals + '）', accepted: [], rejected: [] }
  }
  const bound = opts?.candidateCount
  const accepted: DistillProposalDraft[] = []
  const rejected: { raw: string; reason: string }[] = []
  for (const item of value.proposals) {
    const o = item as { from?: unknown; text?: unknown; target?: unknown; coarse?: unknown; why?: unknown } | null
    const raw = JSON.stringify(item)
    if (o === null || typeof o !== 'object') { rejected.push({ raw, reason: '条目不是对象' }); continue }
    if (typeof o.text !== 'string' || o.text.trim() === '') { rejected.push({ raw, reason: 'text 缺失或非字符串' }); continue }
    if (typeof o.target !== 'string' || o.target.trim() === '') { rejected.push({ raw, reason: 'target 缺失或非字符串' }); continue }
    const from = typeof o.from === 'string' ? o.from.trim() : ''
    if (!/^c\d+$/.test(from)) {
      rejected.push({ raw, reason: 'from 缺失或不是 c<序号> 形状（实际 ' + JSON.stringify(o.from) + '）—— 无法回指候选，其预筛命中词不可复算' })
      continue
    }
    if (bound !== undefined) {
      const idx = Number(from.slice(1))
      if (!Number.isInteger(idx) || idx < 1 || idx > bound) {
        rejected.push({ raw, reason: 'from=' + from + ' 越界（候选共 ' + String(bound) + ' 条）—— 模型自造的编号不得被当成有效来源' })
        continue
      }
    }
    accepted.push({
      from,
      text: o.text,
      target: o.target,
      coarse: o.coarse === true,
      why: typeof o.why === 'string' && o.why !== '' ? o.why : null,
    })
  }
  if (accepted.length === 0 && rejected.length === 0) {
    return { state: 'empty', reason: '裁决返回空数组（宁缺毋滥的正常态 —— 与"解析不出来"不同形）', accepted, rejected }
  }
  if (accepted.length === 0) {
    // ⚠ 全部条目不成形**不得**报 ok（本席初版就是这么写的，被判据当场抓住）：
    //   那会让「模型给了一条被拒的提议」与「模型给了合形状的提议」在状态上同形。
    return {
      state: 'shape-invalid',
      reason: '回包有 ' + String(rejected.length) + ' 条提议，但**零条**合形状（逐条理由见 rejected）',
      accepted,
      rejected,
    }
  }
  return { state: 'ok', reason: String(accepted.length) + ' 条合形状 / ' + String(rejected.length) + ' 条不合形状', accepted, rejected }
}

// ── ⑥ 写回面（**注入式**：生产走 core.writeMemoryItem，判据可注入会失败的写面）─────

export interface DistillStore {
  /** 同内容是否已在库（幂等腿的输入；**必须是真查询**，不是缓存猜测）。 */
  hasContent(content: string): boolean
  /** 真写（生产 = core.writeMemoryItem）。 */
  write(item: { readonly id: string; readonly type: string; readonly content: string }): void
  /** 落库 type（生产 'observation'；不新造 type）。 */
  readonly type: string
}

/** 生产写回面：读走 core.db、写走 core.writeMemoryItem（**唯一写口，不另开路径**）。 */
export function coreDistillStore(core: {
  db: { prepare(sql: string): { get(...args: unknown[]): unknown } }
  writeMemoryItem(item: { id: string; type: string; content: string }): void
}): DistillStore {
  return {
    type: DISTILL_MEMORY_TYPE,
    hasContent(content: string): boolean {
      const row = core.db.prepare('SELECT id FROM memory_items WHERE content = ? LIMIT 1').get(content)
      return row !== undefined && row !== null
    },
    write: (item) => core.writeMemoryItem({ id: item.id, type: item.type, content: item.content }),
  }
}

/**
 * 编码侧码判的**注入面**（生产注入 packages/long-term 的 prefilterWorthKeeping）。
 *
 * ⚠ 本文件**不重写**它：重写就是第二份真源，而两道门一旦共享实现就坍成一道（见文件头）。
 *   缺省为 null ⇒ 该腿记 ran:false（**不是**"通过"）：少了这道门必须显式可见，
 *   否则「编码侧挡下了」与「压根没判」同形。
 */
export interface DistillCodeGate {
  (text: string): { readonly hit: boolean; readonly overlap: number; readonly threshold: number; readonly bankSize: number }
}


// ── 逐条判定读数 ─────────────────────────────────────────────────────────────

export interface DistillDecision {
  /** 候选原文（**逐字**，不切片/不摘要 —— 判据要能对着它复算）。 */
  readonly text: string
  /** 回指的候选编号（解析层已校验存在性与范围）。 */
  readonly from: string
  /** 它来源候选的预筛命中词（从候选的 SignalVerdict 原样取，**不重新算一份**）。 */
  readonly signalHits: readonly string[]
  readonly signalTable: string
  readonly whitelist: DistillAdmission
  readonly granularity: GranularityReading
  readonly codeGate: {
    readonly ran: boolean
    /** ran=false 时为 null（**不得用 false 冒充"判过没通过"**）。 */
    readonly pass: boolean | null
    readonly overlap: number | null
    readonly threshold: number | null
    readonly bankSize: number | null
    readonly reason: string
  }
  readonly admitted: boolean
  /** 未放行时的否决腿（null = 放行）。 */
  readonly vetoedBy: 'whitelist' | 'granularity' | 'code-gate' | 'write-failed' | null
  readonly written: boolean
  /** 落库的 id（未写为 null）。 */
  readonly memoryId: string | null
  /** 写失败的原因（成功/未尝试写时为 null）。 */
  readonly writeError: string | null
}

export interface DistillCandidate {
  readonly text: string
  readonly signalHits: readonly string[]
}

/** 蒸馏链的**终态**（六种各有名字，见文件头表格）。 */
export type DistillState = 'not-idle' | 'prefiltered-out' | 'prefilter-unavailable' | 'no-llm' | 'rejected-by-gate' | 'adjudicated'

export interface DistillResult {
  readonly state: DistillState
  /** 过门的候选（adjudicated 时非空；其余状态为空数组）。 */
  readonly candidates: readonly DistillCandidate[]
  /** **恒非空**：每个状态都要能回答"为什么是这个状态"。 */
  readonly reason: string
  readonly idle: { readonly idleMs: number; readonly thresholdMs: number; readonly triggered: boolean }
  readonly prefilter: {
    readonly ran: boolean
    /** 实际过筛的条数（prefilter-unavailable 时为 0 —— 与"筛了但全 miss"可分辨）。 */
    readonly scanned: number
    readonly hit: number
    readonly miss: number
    readonly empty: number
    readonly table: string | null
    readonly hits: readonly { readonly text: string; readonly hits: readonly string[] }[]
  }
  readonly decisions: readonly DistillDecision[]
  /** **LLM 调用计数的唯一出处**（核心判据读它：预筛 miss ⇒ 恒为 0）。 */
  readonly llmCalls: number
  readonly llmCallIds: readonly string[]
  readonly llmDegraded: string | null
  readonly parse: ProposalParseReading
  readonly inserted: readonly string[]
  readonly idempotentSkips: number
  /** 本次是否带写面（false ⇒ 只判不写；判据用它读"没写行"的真因）。 */
  readonly writeEnabled: boolean
}

export interface DistillSessionInput {
  readonly sessionId: string
  /** 本会话的空闲毫秒数（**由调用方测**：本文件不起定时器，见文件头「不做什么」）。 */
  readonly idleMs: number
  /** 待蒸馏候选（会话痕迹切片；收割归守藏适配层，本文件只消费）。 */
  readonly candidates: readonly string[]
  readonly ctx?: Context | null
  /** 判定通道（省略 = 现从 ctx 解析 mana-llm；判据可注入桩并计数）。 */
  readonly llm?: DistillLlmService | null
  /** 写回面（省略 = 只判不写；判据用它做「关掉写面 ⇒ 不再产生新行」的反证）。 */
  readonly store?: DistillStore | null
  /** 编码侧码判（省略 ⇒ 该腿记 ran:false，**不冒充通过**）。 */
  readonly codeGate?: DistillCodeGate | null
  /** 词表覆盖（缺省 = perception 的 BUILTIN_SIGNAL_TABLE）。 */
  readonly table?: SignalWordTable | null
  /** 空闲阈值覆盖（缺省 DISTILL_IDLE_THRESHOLD_MS）。 */
  readonly minIdleMs?: number
  /** 预筛实现覆盖（**判据用**；生产从不传 —— 传了就等于换掉 §12.3 的那道门）。 */
  readonly prefilterOverride?: SignalPrefilterFn | null
}

/** 解析判定通道（每次现解析，不缓存 —— 常驻进程里后装配的 llm 必须能被接上）。 */
export function resolveDistillLlm(
  ctx: Context | null | undefined,
): { readonly ok: boolean; readonly llm: DistillLlmService | null; readonly reason: string } {
  const svc = (ctx?.get?.('mana-llm') ?? null) as unknown as DistillLlmService | null
  if (!svc || typeof svc.generate !== 'function') {
    return { ok: false, llm: null, reason: '未装配的服务或该服务无 generate 面：mana-llm —— 裁决通道**未执行**（不是「判了没有值得记的」）' }
  }
  return { ok: true, llm: svc, reason: '' }
}

/**
 * **过门写回的 id 派生**（确定性：同 (会话, 目标, 内容) 恒得同 id）。
 *
 * ⚠ dist_ 前缀使蒸馏写回的行在库里**一眼可辨**（与 Write Gate 的 mem_ 前缀分属两条
 *   生产者，便于归属与对账）。
 */
export function deriveDistillMemoryId(sessionId: string, address: string, text: string): string {
  const raw = [sessionId, address, text].join('\u0000')
  return 'dist_' + createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32)
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 跑一次会话蒸馏（v10 §12.3 的六步主链）。
 *
 * ⚠ **失败一律折进 state + reason**（不把故障折成"没有产出"）：所有**可归因**的失败
 *   都由本函数的读数承载，由调用方决定留痕还是中止 ——「链断了」必须是**可读的读数**。
 * ⚠ **唯一例外（刻意如此）**：预筛实现自身抛错时，本函数**不吞**（见 resolveSignalPrefilter
 *   的 ok-or-reason 契约：解析/加载失败已折成 reason）。理由：把"预筛坏了"吞成一个
 *   "看似正常的状态"正是本仓最忌的同形化形态；且该异常来自**注入的实现**，
 *   调用方能直接归因，吞掉只会让它变成一个语义错误的成功返回值。
 * ⚠ **顺序不可倒**：预筛必须在 LLM 之前。下面每一步的 return 都是"到此为止"，
 *   故「预筛 miss ⇒ 不进裁决」是一条**结构性**事实（不是靠 if 写得巧）。
 */
export async function distillSession(input: DistillSessionInput): Promise<DistillResult> {
  const thresholdMs = input.minIdleMs ?? DISTILL_IDLE_THRESHOLD_MS
  const idleMs = Number.isFinite(input.idleMs) ? input.idleMs : 0
  const idle = { idleMs, thresholdMs, triggered: idleMs >= thresholdMs }
  const blankPrefilter = { ran: false, scanned: 0, hit: 0, miss: 0, empty: 0, table: null as string | null, hits: [] as readonly { readonly text: string; readonly hits: readonly string[] }[] }
  const base = (state: DistillState, reason: string, patch: Partial<DistillResult> = {}): DistillResult => ({
    state,
    candidates: [],
    reason,
    idle,
    prefilter: { ...blankPrefilter },
    decisions: [],
    llmCalls: 0,
    llmCallIds: [],
    llmDegraded: null,
    parse: { state: 'empty', reason: '未走到裁决（见 state）', accepted: [], rejected: [] },
    inserted: [],
    idempotentSkips: 0,
    writeEnabled: input.store != null,
    ...patch,
  })

  // ① 空闲触发
  if (!idle.triggered) {
    return base('not-idle', '空闲 ' + String(idleMs) + 'ms < 阈值 ' + String(thresholdMs) + 'ms ⇒ 本次**未触发**（这不是「跑了但没东西可蒸馏」）')
  }

  // ② 信号词预筛（零 LLM 成本）
  const resolution: SignalPrefilterResolution = input.prefilterOverride != null
    ? { ok: true, prefilter: input.prefilterOverride, source: '<注入的预筛实现（判据用）>' }
    : resolveSignalPrefilter()
  if (!resolution.ok) {
    return base('prefilter-unavailable', resolution.reason, {
      parse: { state: 'empty', reason: '未走到裁决：预筛实现不可解析（候选**未过筛**，不得当作「已筛未命中」）', accepted: [], rejected: [] },
    })
  }
  const table = input.table ?? resolveBuiltinSignalTable()
  if (table === null) {
    return base('prefilter-unavailable', '预筛实现可解析但取不到词表（BUILTIN_SIGNAL_TABLE 缺失）⇒ 本回合**未过筛**')
  }

  const rawCandidates = Array.isArray(input.candidates) ? input.candidates : []
  const hits: { text: string; hits: readonly string[] }[] = []
  /** 编号 c1.. → 命中者（**编号与 distillMaterial 同源**，不另编一套）。 */
  const hitByFrom = new Map<string, { text: string; verdict: Extract<SignalVerdict, { state: 'hit' }> }>()
  let miss = 0
  let empties = 0
  /**
   * ⚠ **编号 c1.. 编在"过筛者"序列上，不是"原始候选"序列上**（本席实测订正的一处真洞）：
   *   若按原始序列编号，则 (a) material 里会带上**未命中**的候选（模型能看见它们 ⇒
   *   在这个意义上"miss 仍然进了 LLM"），且 (b) 模型可以声明 from=<某条 miss 的编号>
   *   并**照样被接受** ⇒ 一条被预筛挡下的输入就能经模型绕回链路里。
   *   ⇒ 过筛者才编号、material 只送过筛者、parse 的边界取过筛者条数，三处同源。
   */
  const survivorTexts: string[] = []
  for (const c of rawCandidates) {
    const text = String(c ?? '')
    let verdict: SignalVerdict
    try {
      verdict = resolution.prefilter(text, table)
    } catch (error) {
      // 预筛实现抛错：**向上暴露**（不折成"未命中"）—— 见本函数头注的"唯一例外"。
      throw new Error(
        '预筛实现抛错（第 ' + String(survivorTexts.length + 1) + ' 条候选）：' + String((error as Error)?.message ?? error) +
        ' ⇒ 本回合**未完成过筛**；这不是「未命中」（两者都会产生 0 次 LLM 调用，必须靠状态名区分）',
      )
    }
    if (verdict.state === 'hit') {
      survivorTexts.push(text)
      hitByFrom.set('c' + String(survivorTexts.length), { text, verdict })
      hits.push({ text, hits: verdict.hits })
    } else if (verdict.state === 'miss') miss += 1
    else empties += 1
  }
  const prefilter = {
    ran: true,
    scanned: rawCandidates.length,
    hit: hitByFrom.size,
    miss,
    empty: empties,
    table: table.name as string | null,
    hits,
  }
  if (hitByFrom.size === 0) {
    // ⚠ 这一步的 return 就是「零 LLM 成本」的落点：**没有任何一条走到下面的 generate**。
    return base(
      'prefiltered-out',
      '预筛未命中：扫描 ' + String(prefilter.scanned) + ' 条（miss=' + String(miss) + ' / empty=' + String(empties) +
        '），词表「' + table.name + '」⇒ **不进 LLM 裁决**（零 LLM 成本；这不是「判了没有值得记的」）',
      { prefilter, parse: { state: 'empty', reason: '未走到裁决：预筛零命中', accepted: [], rejected: [] } },
    )
  }

  // ③ LLM 子代理按蒸馏契约裁决
  const llmReading = input.llm != null ? { ok: true as const, llm: input.llm, reason: '' } : resolveDistillLlm(input.ctx)
  if (!llmReading.ok || llmReading.llm === null) {
    return base('no-llm', llmReading.reason, {
      prefilter,
      parse: { state: 'empty', reason: '未走到裁决：判定通道不可用', accepted: [], rejected: [] },
    })
  }
  const llm = llmReading.llm
  // ⚠ material **只送过筛者**：未命中的候选一个字都不进 prompt（"零 LLM 成本"在内容层也成立）。
  const material = distillMaterial(survivorTexts)
  let reply: Awaited<ReturnType<DistillLlmService['generate']>>
  try {
    reply = await llm.generate({ system: distillSystemPrompt(), prompt: material })
  } catch (error) {
    return base('no-llm', 'generate 违约抛错（契约要求返回三态而不抛）：' + String((error as Error)?.message ?? error), {
      prefilter,
      llmCalls: 1,
      parse: { state: 'unparsable', reason: '未取得可解析的回复（调用抛错）', accepted: [], rejected: [] },
    })
  }
  const llmCallIds = [reply.callId]
  if (!reply.ok) {
    return base('no-llm', '判定通道降级（degraded=' + reply.degraded + '）：' + reply.reason, {
      prefilter,
      llmCalls: 1,
      llmCallIds,
      llmDegraded: reply.degraded,
      parse: { state: 'unparsable', reason: '未取得可解析的回复（通道降级）', accepted: [], rejected: [] },
    })
  }
  // 边界 = **过筛者条数**（与 material 的编号空间同源）⇒ 指向"未过筛候选"的编号必被拒。
  const parse = parseAdjudication(reply.text, { candidateCount: survivorTexts.length })

  // ④⑤⑥ 逐条过门 → 写回
  const store = input.store ?? null
  const decisions: DistillDecision[] = []
  const inserted: string[] = []
  const admittedList: DistillCandidate[] = []
  let idempotentSkips = 0

  for (const p of parse.accepted) {
    // 命中词**从候选的 SignalVerdict 原样取**（不重新算一份 ⇒ 不会出现两种口径）。
    const origin = hitByFrom.get(p.from) ?? null
    const signalHits = origin === null ? [] : origin.verdict.hits
    // 幂等腿的输入：store 在场时**真查库**；缺席时 present=false 但 writeEnabled=false
    // 使「没查」与「查了不在库」可分辨（读法：present 的语义只在 writeEnabled=true 时成立）。
    const present = store !== null ? store.hasContent(p.text) : false
    const whitelist = distillWhitelistGate(p, { alreadyPresent: present })
    if (whitelist.leg === 'idempotence') idempotentSkips += 1
    const granularity = judgeGranularity(p)
    const code = input.codeGate != null
      ? (() => {
          const r = input.codeGate(p.text)
          return {
            ran: true,
            pass: r.hit as boolean | null,
            overlap: r.overlap as number | null,
            threshold: r.threshold as number | null,
            bankSize: r.bankSize as number | null,
            reason: r.hit
              ? '问法 bigram 重叠 ' + String(r.overlap) + ' >= ' + String(r.threshold) + '（词表 ' + String(r.bankSize) + ' 项）⇒ 编码侧码判通过'
              : '问法 bigram 重叠 ' + String(r.overlap) + ' < ' + String(r.threshold) + '（词表 ' + String(r.bankSize) + ' 项）⇒ 编码侧码判否决（**与白名单门是两道不同的门**）',
          }
        })()
      : { ran: false, pass: null, overlap: null, threshold: null, bankSize: null, reason: '未注入编码侧码判 ⇒ 该腿记 not-run（ran:false 使「没判」与「判过」可分辨，**不冒充通过**）' }

    let vetoedBy: DistillDecision['vetoedBy'] = !whitelist.admitted
      ? 'whitelist'
      : !granularity.coarse
        ? 'granularity'
        : code.ran && code.pass === false
          ? 'code-gate'
          : null
    const memoryId = vetoedBy === null ? deriveDistillMemoryId(input.sessionId, whitelist.address, p.text) : null
    let written = false
    let writeError: string | null = null
    if (vetoedBy === null && store !== null) {
      try {
        store.write({ id: memoryId as string, type: store.type, content: p.text })
        written = true
        inserted.push(memoryId as string)
      } catch (error) {
        // 写失败**不得**被读成"判了不值得"：状态与 reason 都点名写失败。
        vetoedBy = 'write-failed'
        writeError = '落库失败：' + String((error as Error)?.message ?? error) + '（判定结论未被应用；这不是「判了不值得」）'
      }
    }
    if (vetoedBy === null) admittedList.push({ text: p.text, signalHits })
    decisions.push({
      text: p.text,
      from: p.from,
      signalHits,
      signalTable: (prefilter.table ?? table.name) as string,
      whitelist,
      granularity,
      codeGate: code,
      admitted: vetoedBy === null,
      vetoedBy,
      written,
      memoryId,
      writeError,
    })
  }

  if (admittedList.length === 0) {
    const vetoes = decisions.map((d) => d.vetoedBy)
    return {
      ...base(
        'rejected-by-gate',
        '裁决产出 ' + String(parse.accepted.length) + ' 条，**零条过门**：否决腿分布=' + JSON.stringify(vetoes) +
          '（这不是「没有提议」，也不是「预筛没命中」）',
        { prefilter, llmCalls: 1, llmCallIds, parse },
      ),
      decisions,
      idempotentSkips,
    }
  }

  return {
    state: 'adjudicated',
    candidates: admittedList,
    reason: '过门 ' + String(admittedList.length) + ' 条（写入 ' + String(inserted.length) + ' 条，幂等跳过 ' + String(idempotentSkips) + ' 条）',
    idle,
    prefilter,
    decisions,
    llmCalls: 1,
    llmCallIds,
    llmDegraded: null,
    parse,
    inserted,
    idempotentSkips,
    writeEnabled: store !== null,
  }
}

// ── 判据面导出（**唯一出处**：判据从此处 import，不手抄字面量）──────────────────
export const DISTILL_IMPLEMENTED_EXPORTS = [
  'distillSession',
  'distillWhitelistGate',
  'judgeGranularity',
  'parseAdjudication',
  'distillSystemPrompt',
  'deriveDistillMemoryId',
  'coreDistillStore',
  'resolveSignalPrefilter',
  'resolveBuiltinSignalTable',
  'resolveDistillLlm',
] as const
