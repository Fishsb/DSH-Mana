/**
 * profile.ts — 双画像（AGENT.md / USER.md）**写入侧的可判据内核**（L-04 · v10 §17.2）。
 *
 * ── 本文件回答一个问题：本仓该不该有「画像写入」（三选一，S28 席判断）────────────
 * 结论 = **(a)+(b) 的组合**：
 *   ① (a) 本仓**不写守藏档案**：AGENT.md / USER.md 在守藏侧现役，位于
 *      ~/.dsh/suite/knowledge/ 与 ~/.dsh/skills/managing-memory/，那是**守藏的写面**
 *      （本包只读；红线见本批派单与 docs/contract 的既成约定）。故本仓**只**保留
 *      「读 + 校验」面：画像载体的内涵（两份 md 各 3000 字符容量、环境覆盖变量名、
 *      归档禁碰画像节）在本仓**作为常量引用**，不复制守藏的写入实现。
 *   ② (b) 本仓提供**统一写入口 + 版本化**，但**落到本仓自己的表**
 *      （core 的 user_model / user_model_history，见 packages/core/src/schema.ts:89/107）：
 *      键空间 profile:<doc>:<key>，每次画像变更在历史上**追加一行**（不是 UPDATE 覆盖），
 *      由守藏另行消费。**不新建**与 user_model_history 语义重叠的表。
 *   ⛔ (c)「本仓直接写守藏档案」= **越界**，只能作为 [建议决策] 上报，本包一行都不写。
 *
 * ── 依据（逐条可核）────────────────────────────────────────────────────────
 *   · 守藏侧画像**没有本仓写入路径**：全仓 grep 'AGENT.md|USER.md' 的写侧命中 0，
 *     命中全在判据/容量/标签侧（见 packages/metacognition/skill/engine/criteria.json
 *     的 gate.caps 与 consolidate.demote.archive）。
 *   · user_model_history 是**既有表**且已带 core 写入口（core/src/index.ts:451
 *     updateUserModel，主表 UPDATE 与历史 INSERT 同事务）⇒ 复用即「并入既有事实源」，
 *     自建第二张历史表就是同一条事实的两个归属地。
 *   · 本包**不写** memory_items.content（A4-3）：本文件连库句柄都拿不到（纯函数、无 IO）。
 *
 * ── 为什么不搬 v10 §12.4 的「内在奖励 > 0.5 时把 Write Gate 阈值降到 0.4」────────
 *   评审已裁定：该条落**守藏离线核验 + pending 候选**，本仓不做写入侧增强 ——
 *   动态阈值会让判据阈值随信号浮动，而阈值纪律要求判据取值可复现
 *   （见 docs/contract/threshold-discipline.md 的三档分档）。故本内核**不接受**
 *   "按信号改阈值"的入参：floor 由调用方**显式传入**，本内核不改它、不藏第二份缺省。
 *
 * ⚠ 本文件是**纯函数面**（零 import、零 IO、无监听器）：判据要能直接喂输入断言输出，
 *   而不必去猜服务面的中间态（与 packages/user-model/src/precision.ts 同形态）。
 */

/** 双画像的两份档案（守藏侧现役；本仓只写自己的表，不写这两个文件）。 */
export const PROFILE_DOCS = ['AGENT.md', 'USER.md'] as const
export type ProfileDoc = (typeof PROFILE_DOCS)[number]

/**
 * 双通道（v10 §17.2）：蒸馏通道**实时**（会话内触发）+ 深睡通道**夜间批**。
 *
 * ⚠ 两条通道**共用同一个写入口函数**（`profile-pipeline.ts` 的 applyProfileChange）——
 *   这是本批的第一条判据「防两条路径漂移」。通道名只作为**来源标注**落库
 *   （writer 后缀 / trace 载荷），**不改变**判定与写入语义。
 */
export const PROFILE_CHANNELS = ['distill', 'deepsleep'] as const
export type ProfileChannel = (typeof PROFILE_CHANNELS)[number]

/** 写入面版本（本仓侧）。内容生成归守藏，本仓只**版本化变更**。 */
export const PROFILE_WRITE_VERSION = 'profile-write/v1'

/** 键空间前缀：把画像变更与 core.user_model 的其他用途在**同一张表**里分开
 *  （同一张表分键空间 = 事实源唯一；另开一张表 = 同一条事实两个归属地）。 */
export const PROFILE_KEY_PREFIX = 'profile'

/** 画像变更**写进主表**（= 该偏好当前生效）时的 writer 标注。 */
export const PROFILE_CHANGED_WRITER = 'mana-metacognition/profile-changed'
/** 画像变更**被拒（退场）**时的 writer 标注 —— 与上一条必须可分辨，
 *  否则「写了」与「拒了」在历史里同形（本仓最防的「失败不可观测」形态）。 */
export const PROFILE_RETIRED_WRITER = 'mana-metacognition/profile-retired'

/** manma_trace 事件类型：正常变更（裸名 + 包前缀，不冒充 S1 五类）。 */
export const PROFILE_CHANGED_TRACE = 'profile/preference-changed'
/** mana_trace 事件类型：**拒写留痕**（fail-closed：沉默地不写，但必须留痕）。 */
export const PROFILE_RETIRED_TRACE = 'profile/preference-retired'

/** 档案容量（守藏侧 gate.caps 的登记值；本仓作为**校验常量**引用，不复制实现）。 */
export const PROFILE_CAPACITY: Readonly<Record<ProfileDoc, number>> = { 'AGENT.md': 3000, 'USER.md': 3000 }

/** 通道 → writer 标注（唯一映射点：两处各写一份就会漂移）。 */
export function writerOf(channel: ProfileChannel, applied: boolean): string {
  void channel
  return applied ? PROFILE_CHANGED_WRITER : PROFILE_RETIRED_WRITER
}

/** 组装画像键（唯一组装点）。key 为空即抛 —— 空键会让历史行无法归属到任何偏好。 */
export function profileKey(doc: ProfileDoc, key: string): string {
  if (!PROFILE_DOCS.includes(doc)) throw new Error('profileKey: 未知档案 ' + String(doc) + '（合法值 ' + PROFILE_DOCS.join(' / ') + '）')
  const bare = String(key ?? '').trim()
  if (!bare) throw new Error('profileKey: key 不得为空（空键的画像变更无法归属到任何偏好）')
  if (/\s/.test(bare)) throw new Error('profileKey: key 不得含空白字符（实测 ' + JSON.stringify(bare) + '）')
  return PROFILE_KEY_PREFIX + ':' + doc + ':' + bare
}

/** 反向解析（读侧用；非画像键返回 null —— 不得把"不是画像行"读成"画像行的 doc 缺省"）。 */
export function parseProfileKey(fullKey: string): { doc: ProfileDoc; key: string } | null {
  const parts = String(fullKey ?? '').split(':')
  if (parts.length < 3) return null
  if (parts[0] !== PROFILE_KEY_PREFIX) return null
  const doc = parts[1] as ProfileDoc
  if (!PROFILE_DOCS.includes(doc)) return null
  const bare = parts.slice(2).join(':')
  if (!bare) return null
  return { doc, key: bare }
}

/** 一次画像变更的请求（写入口的输入，**逐字段可核**）。 */
export interface ProfileChangeInput {
  doc: ProfileDoc
  /** 偏好键（不含 doc 前缀；组装由 profileKey 唯一负责）。 */
  key: string
  /** 新值（**内容生成归守藏**，本仓只负责落库与版本化）。 */
  next: string
  /** 置信度（A4-1 的读数；有限数，NaN / undefined 一律抛 —— 见 buildProfileChange）。 */
  confidence: number
  channel: ProfileChannel
  /**
   * 退场阈值（A4-1 的读数）。**逐次显式传入**，本包不设缺省、不藏第二份。
   * `null`/`undefined` = 无人拍板 ⇒ 判定返回 `undeterminable`（**不是** `inject`）。
   * ⚠ 刻意**不**实现 v10 §12.4 的「按内在奖励动态降阈值」：那会让本判据随信号浮动
   *   （评审已裁定落守藏离线核验 + pending 候选，本仓不做写入侧增强）。
   */
  confidenceFloor?: number | null
  /** 发生时刻（**必填、无缺省**：区间两端显式传参，判据才可复现）。 */
  at: string
  sessionId?: string
  turnId?: number
  /** 证据来源 id（可空；沿 core.user_model_history.source_evidence_id）。 */
  sourceEvidenceId?: string | null
}

/** 判定结果的最小形状（与 dsh-mana-user-model 的 InjectionVerdict 结构兼容）。 */
export interface ProfileVerdictLike {
  decision: 'inject' | 'retired_no_injection' | 'undeterminable'
  floor: number | null
  confidence: number | null
  reason: 'below-floor' | 'at-or-above-floor' | 'floor-unset' | 'confidence-unusable'
}

/** 一次画像变更的**完整记录**（写库与留痕都由它派生，避免两处各推一遍）。 */
export interface ProfileChangeRecord {
  doc: ProfileDoc
  /** 裸键（人读）。 */
  key: string
  /** 全键（落库用，含 doc 前缀）。 */
  fullKey: string
  previous: string | null
  next: string
  confidence: number
  floor: number | null
  channel: ProfileChannel
  /** 该次变更是否**被允许写进主表**（false = 退场：不注入）。 */
  applied: boolean
  /** 落库 writer 标注（变更 / 退场必须可分辨）。 */
  writer: string
  at: string
  version: string
  verdict: ProfileVerdictLike
}

/**
 * 唯一的内核：把「一次画像变更的请求 + 判定读数」收敛成**一条可追溯记录**。
 *
 * ⚠ 校验一律**抛错**而不是返回布尔：本仓的既有教训是「返回布尔会被调用方顺手忽略」，
 *   于是非法输入变成一次**静默写入**（见 packages/user-model/src/index.ts 的 assertContentNeutral）。
 *   · confidence 非有限数 ⇒ 抛（"读数坏了"与"读数合格"是两件事，缺省放行会让退场永不触发）；
 *   · at 不是合法 ISO 时刻 ⇒ 抛（不可解析的时刻会让窗口判据把它读成"很旧"或"很新"）；
 *   · doc / channel 非法 ⇒ 抛（fail-fast，而不是落到一个缺省档）。
 */
export function buildProfileChange(input: ProfileChangeInput, verdict: ProfileVerdictLike): ProfileChangeRecord {
  // ⚠ 校验序：**先判通道与文档、再组装键**。若倒过来，一个非法通道配上合法键时
  //   报出的是"通道未知"没错，但非法**文档**会被 profileKey 抢先抛成"未知档案"——
  //   两条不同的错因共用一个出口，归因时看不出是哪一侧坏了。
  if (!PROFILE_CHANNELS.includes(input.channel)) {
    throw new Error('buildProfileChange: 未知通道 ' + String(input.channel) + '（双通道合法值 ' + PROFILE_CHANNELS.join(' / ') + '）')
  }
  const fullKey = profileKey(input.doc, input.key)
  if (typeof input.next !== 'string' || input.next.length === 0) {
    throw new Error('buildProfileChange: next 必须是非空字符串（空值无法与"没这条偏好"分辨）')
  }
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence)) {
    throw new Error('buildProfileChange: confidence 必须是有限数，实测 ' + String(input.confidence))
  }
  if (typeof input.at !== 'string' || !Number.isFinite(Date.parse(input.at))) {
    throw new Error('buildProfileChange: at 必须是合法 ISO 时刻，实测 ' + String(input.at))
  }
  const applied = verdict.decision === 'inject'
  return {
    doc: input.doc,
    key: String(input.key).trim(),
    fullKey,
    previous: null,
    next: input.next,
    confidence: input.confidence,
    floor: verdict.floor === undefined ? null : verdict.floor,
    channel: input.channel,
    applied,
    writer: writerOf(input.channel, applied),
    at: input.at,
    version: PROFILE_WRITE_VERSION,
    verdict,
  }
}

/**
 * 「该偏好**是否仍可注入**」的唯一读口。
 *
 * ⚠ 只认 `inject`：`undeterminable`（阈值未拍板 / 读数不可用）**不是**可注入 ——
 *   把"没拍板"读成"照常注入"会让退场机制**永远不触发**，而系统看起来一切正常
 *   （该判因见 packages/user-model/src/precision.ts 的 injectionDecision 注释）。
 */
export function isInjectable(record: Pick<ProfileChangeRecord, 'verdict'>): boolean {
  return record.verdict.decision === 'inject'
}

/** 一次变更是否**被拒**（= 该偏好转「不注入」，册:151 的退场动作）。 */
export function isRetired(record: Pick<ProfileChangeRecord, 'verdict'>): boolean {
  return record.verdict.decision === 'retired_no_injection'
}

/**
 * 留痕事件类型：变更写一条，退场写另一条。
 * ⚠ 退场**也**必须留痕（fail-closed 纪律：沉默地不写、但必须留痕）——
 *   否则「拒了」在库里与「什么都没发生」同形。
 */
export function traceEventOf(applied: boolean): string {
  return applied ? PROFILE_CHANGED_TRACE : PROFILE_RETIRED_TRACE
}
