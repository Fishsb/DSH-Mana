/**
 * profile-pipeline.ts — 双画像的**统一写入口**（L-04 · 单写入口判据的落点）。
 *
 * ── 一条判据，一个函数 ──────────────────────────────────────────────────────
 * 蒸馏通道（实时）与深睡通道（夜间批）**必须走同一个函数**：两条路径各写一份写入逻辑，
 * 就是「同一条事实的两个归属地」——改一处漏一处即漂移，而漂移在**正常读数上不可见**
 * （两条路径都"成功"）。故本文件只导出 `applyProfileChange` **一个**写入面，
 * 通道名只作来源标注进载荷（`profile.ts#PROFILE_CHANNELS`）。
 *
 * ── 写什么、不写什么 ───────────────────────────────────────────────────────
 * 写：本仓自己的表（core 的 `user_model` / `user_model_history`，**每次变更追加一行**）。
 *     键空间 `profile:<doc>:<key>`，由 `profile.ts#profileKey` 唯一组装。
 * 不写：① 守藏档案（`~/.dsh/suite/knowledge/AGENT.md|USER.md`）—— **本模块没有任何 fs 调用**；
 *      ② `memory_items.content`（A4-3）—— 本模块**不调用** `core.writeMemoryItem`，
 *         且输入走 `assertContentNeutral` 运行期守卫（content 键即抛）。
 *
 * ── 退场不静默（册:151 + docs/contract/degradation.md）────────────────────
 * 置信度跌破阈值 ⇒ 该偏好**不写进主表**（不再注入），但**照写一行历史**（版本化）
 * 且**落一条 trace**（留痕）。判定本身**不在本包实现**：由调用方经 `ctx.get('mana-user-model')`
 * 取 `injectionVerdict`，或直接传入一个同形的 verdict —— 本包**不写第二份**判定实现
 * （那是「同一条判据两处实现」，本仓已多次踩过）。
 *
 * ⚠ **不搬 v10 §12.4**（按信号动态降 Write Gate 阈值）：floor 由调用方**逐次显式传入**，
 *   本模块不改它、不藏第二份缺省（阈值须可复现，见 docs/contract/threshold-discipline.md）。
 *
 * ⚠ **主表读法**（本席实测踩到，写在这里防下一次）：core 的
 *   `listUserModelHistory(key, limit)` 是 `ORDER BY at ASC, id ASC LIMIT ?` ——
 *   **LIMIT 1 拿到的是最早那行，不是最新那行**（packages/core/src/index.ts:508-515）。
 *   故「该键现在生效的值」一律读**主表** `user_model`（只读 SELECT，与
 *   packages/user-model/src/index.ts:265 的 listPreferences 同法），
 *   而不是从历史里取"第一行"冒充"最后一行"。
 */
import type { ManaCoreService } from 'dsh-mana-core'
import {
  buildProfileChange,
  isInjectable,
  profileKey,
  parseProfileKey,
  traceEventOf,
  PROFILE_CHANNELS,
  PROFILE_DOCS,
  PROFILE_WRITE_VERSION,
  type ProfileChangeInput,
  type ProfileChangeRecord,
  type ProfileDoc,
  type ProfileVerdictLike,
} from './profile.ts'

/**
 * 本包依赖的 core 面：三个写/读方法 + **只读**库句柄。
 * `db` 的用途被限定为 SELECT（core 自己在类型注释里写明"只读用途"）——
 * 写路径一律走 `updateUserModel` / `writeTrace`，本模块不手写任何 INSERT。
 */
export type ProfileCoreFace = Pick<ManaCoreService, 'updateUserModel' | 'listUserModelHistory' | 'writeTrace' | 'db'>

/**
 * A4-3 守卫（**本包自己的一份**，不 import user-model 包：跨包依赖会为 15 行递归
 * 加一条契约边，代价大于收益 —— 见本批 handoff §5 的未决项）。
 *
 * 为什么必须是**运行期抛错**而不是"本模块不写 content"：后者是**静态事实**，
 * 靠的是"没人这么写"。后来者顺手加一个 content 字段并透传时，静态事实照样成立、
 * 而 `memory_items.content` 已被写 —— 判据读到的只是"有行"。抛错使它是一条**错误**。
 */
export const FORBIDDEN_COLUMNS: readonly string[] = ['content']

function findForbiddenKey(value: unknown, forbidden: readonly string[], path: string): string | null {
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = findForbiddenKey(v, forbidden, path + '[' + i + ']')
      if (hit) return hit
    }
    return null
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.includes(k)) return path + (path ? '.' : '') + k
    const hit = findForbiddenKey(v, forbidden, path + (path ? '.' : '') + k)
    if (hit) return hit
  }
  return null
}

/** 输入里出现 `memory_items.content` 类字段即抛（**不返回布尔**）。 */
export function assertContentNeutral(input: unknown, where = 'mana-metacognition'): void {
  const hit = findForbiddenKey(input, FORBIDDEN_COLUMNS, '')
  if (hit) {
    throw new Error(
      where + ": 输入含违禁字段 ['" + hit + "'] —— A4-3 要求只写 id/数值字段，不得写 memory_items.content",
    )
  }
}

/** 一次写入的实测读数（**逐项来自库/派生，不是"应该成功"**）。 */
export interface ProfileWriteResult {
  record: ProfileChangeRecord
  /** 历史表**新增行**的 id —— 「追加非覆盖」的机器可核读数。 */
  historyId: number
  /** 本次是否真改变了主表的值（同值重复写 = false，与 core 同口径）。 */
  changed: boolean
  /** 本次是否新建了该键（主表此前无此键）。 */
  created: boolean
  /** 写入前主表的值（新键为 null）。 */
  previousValue: string | null
  /** 是否写进主表（false = 退场，不注入）。 */
  applied: boolean
  /** 落 trace 的 seq（变更与退场**都有** —— 退场留痕不得静默）。 */
  traceSeq: number
  /** 追溯线索：实参键 == 组装值（防"传了 A 键、组装成 B 键"两处各推一遍）。 */
  keyMismatch: boolean
}

/** 画像历史行的一行（人读投影：裸键与全键都摆出来）。 */
export interface ProfileHistoryLine {
  id: number
  doc: ProfileDoc
  key: string
  fullKey: string
  old_value: string | null
  new_value: string
  confidence: number | null
  at: string
  /** 写入者标注；`null` = 该行**不是**本包写的（据此可分辨"本包写的"与"别人写的"）。 */
  writer: string | null
  /** 通道（蒸馏 / 深睡）；`null` = 非本包写入。 */
  channel: string | null
  version: string | null
  /** 该行的判定结论（reject 行据此可检出）；`null` = 非本包写入。 */
  decision: string | null
}

/** 管线依赖：core 面 + **注入的**退场判定（生产路径 = user-model 的 injectionVerdict）+ 阈值读数。 */
export interface ProfilePipelineDeps {
  core: ProfileCoreFace
  verdictOf: (confidence: number, floor: number | null) => ProfileVerdictLike
  /**
   * A4-1 的退场阈值读数（`null` = 未拍板）。**随依赖注入一次**，写侧与读侧都取它 ——
   * 两处各取一个来源就会出现「写时按 0.5 判、读时按未拍板判」的错位，
   * 而那种错位在读数上表现为"这条偏好突然不可注入了"，看不出是口径问题。
   */
  confidenceFloor?: number | null
}

/** 读主表当前值（`key` 不存在 ⇒ 返回 `undefined`，与"值是空串"可分辨）。 */
function readMain(core: ProfileCoreFace, key: string): { value: string; confidence: number | null } | undefined {
  const row = core.db.prepare('SELECT value, confidence FROM user_model WHERE key = ?').get(key) as
    | { value?: unknown; confidence?: unknown }
    | undefined
  if (!row || typeof row.value !== 'string') return undefined
  return { value: row.value, confidence: typeof row.confidence === 'number' ? row.confidence : null }
}

/** 读一条 trace 的载荷（按 event_type + seq；坏行返回 null，**不静默当成"没有"**）。 */
function readTracePayload(core: ProfileCoreFace, seq: unknown, eventTypes: readonly string[]): Record<string, unknown> | null {
  if (typeof seq !== 'number') return null
  const row = core.db
    .prepare('SELECT event_type, payload FROM mana_trace WHERE seq = ?')
    .get(seq) as { event_type?: unknown; payload?: unknown } | undefined
  if (!row || typeof row.payload !== 'string') return null
  if (typeof row.event_type !== 'string' || !eventTypes.includes(row.event_type)) return null
  try {
    const parsed = JSON.parse(row.payload) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 本包写过的全部 trace 载荷，按 `historyId` 索引（读侧还原 writer/channel 的事实源）。 */
function traceIndex(core: ProfileCoreFace): Map<number, Record<string, unknown>> {
  const out = new Map<number, Record<string, unknown>>()
  const rows = core.db
    .prepare('SELECT seq, event_type, payload FROM mana_trace WHERE event_type IN (?, ?) ORDER BY seq ASC')
    .all(traceEventOf(true), traceEventOf(false)) as { payload?: unknown }[]
  for (const r of rows) {
    if (typeof r.payload !== 'string') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(r.payload)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const hid = (parsed as { historyId?: unknown }).historyId
    if (typeof hid === 'number') out.set(hid, parsed as Record<string, unknown>)
  }
  return out
}

/**
 * **双通道的唯一写入口**。返回全部实测读数（历史行 id / 是否 applied / trace seq）。
 *
 * 执行序（**顺序即语义**，不得重排）：
 *   ① A4-3 守卫 —— **在委托之前**：守卫若在写之后调用，一次违规写入已经落库；
 *   ② 判定（注入 / 退场）—— 由注入的 `verdictOf` 给出，本模块不实现判定；
 *   ③ 组装记录（唯一一处组装键与 writer 标注）+ 读旧值（读**主表**）；
 *   ④ 落库：**总是**调 `core.updateUserModel`（= 追加一行历史；值仅在 applied 时前移，
 *      退场时用旧值回写 —— 主表不进步、历史如实留痕）；
 *   ⑤ 落 trace：变更与退场各一个 event_type，**都**留痕。
 */
export function applyProfileChange(deps: ProfilePipelineDeps, input: ProfileChangeInput): ProfileWriteResult {
  if (!deps || typeof deps.verdictOf !== 'function' || !deps.core) {
    throw new Error('applyProfileChange: 缺 deps（core + verdictOf）—— 判定实现不在本包，必须由调用方注入')
  }
  // ① A4-3 守卫在**任何写之前**。
  assertContentNeutral(input, 'mana-metacognition.applyProfileChange')

  // 阈值：逐次显式传入优先，其次取依赖里注入的读数（唯一来源，见 ProfilePipelineDeps 说明）。
  const floor = input.confidenceFloor ?? deps.confidenceFloor ?? null
  const verdict = deps.verdictOf(input.confidence, floor)
  // ② 组装（唯一组装点；此处再校验 doc/channel/confidence/at）。
  const record = buildProfileChange(input, verdict)

  // ③ 读旧值：退场时必须用旧值回写主表（主表 = "现在生效的是什么"；退场偏好不得显示为新值）。
  const before = readMain(deps.core, record.fullKey)
  const previousValue = before?.value ?? null
  record.previous = previousValue

  const valueToStore = record.applied ? record.next : (previousValue ?? record.next)
  const res = deps.core.updateUserModel({
    key: record.fullKey,
    value: valueToStore,
    confidence: record.confidence,
    sessionId: input.sessionId ?? '',
    turnId: input.turnId ?? 0,
    at: record.at,
    ...(input.sourceEvidenceId === undefined ? {} : { sourceEvidenceId: input.sourceEvidenceId }),
  })

  // ④ 留痕：变更与退场**各一条**（都不可省 —— 退场不留痕会让"拒了"与"什么都没发生"同形）。
  const traceSeq = deps.core.writeTrace({
    eventType: traceEventOf(record.applied),
    sessionId: input.sessionId ?? '',
    turnId: input.turnId ?? 0,
    at: record.at,
    payload: {
      version: PROFILE_WRITE_VERSION,
      doc: record.doc,
      key: record.key,
      fullKey: record.fullKey,
      channel: record.channel,
      writer: record.writer,
      applied: record.applied,
      previous: previousValue,
      next: record.next,
      stored: valueToStore,
      confidence: record.confidence,
      floor: record.floor,
      decision: record.verdict.decision,
      reason: record.verdict.reason,
      historyId: res.historyId,
    },
  })

  return {
    record,
    historyId: res.historyId,
    changed: res.changed,
    created: res.created,
    previousValue,
    applied: record.applied,
    traceSeq,
    keyMismatch: res.key !== record.fullKey,
  }
}

/**
 * 读侧：本包写的画像历史（按 `profile:` 前缀过滤）。
 *
 * ⚠ `core.user_model_history` **没有 writer / channel 列**（核心表的列集是契约面，
 *   本包不改 schema）⇒ 这两项由**配套的 trace 行**按 `historyId` 回收（见 `traceIndex`）。
 *   于是「这一行是谁写的、走哪条通道、判成了什么」都是**可查事实**，
 *   而不是只能看到"有行" —— 这是「退场不静默」在读侧的对应物。
 */
export function listProfileHistory(deps: ProfilePipelineDeps, doc?: ProfileDoc, limit = 100000): ProfileHistoryLine[] {
  const wanted: readonly ProfileDoc[] = doc ? [doc] : PROFILE_DOCS
  const idx = traceIndex(deps.core)
  const out: ProfileHistoryLine[] = []
  for (const r of deps.core.listUserModelHistory(undefined, limit)) {
    const parsed = parseProfileKey(r.key)
    if (!parsed) continue
    if (!wanted.includes(parsed.doc)) continue
    const meta = idx.get(r.id) ?? null
    out.push({
      id: r.id,
      doc: parsed.doc,
      key: parsed.key,
      fullKey: r.key,
      old_value: r.old_value,
      new_value: r.new_value,
      confidence: r.confidence,
      at: r.at,
      writer: meta && typeof meta.writer === 'string' ? meta.writer : null,
      channel: meta && typeof meta.channel === 'string' ? meta.channel : null,
      version: meta && typeof meta.version === 'string' ? meta.version : null,
      decision: meta && typeof meta.decision === 'string' ? meta.decision : null,
    })
  }
  return out
}

/**
 * 「该偏好**现在是否仍可注入**」—— 读侧唯一判据。
 *
 * 返回 `null` = **读不出**（该键无历史行，或该行没有置信度）—— 与 `false` 必须可分辨：
 * 把"读不出"读成"不可注入"会让一条健全的偏好被静默停用；读成"可注入"则相反。
 * ⚠ 生效值取自**主表**（不是历史末行）：退场时主表**保留旧值**，
 *   故"现在生效的是什么"与"最后一次置信度读数"是两个不同的数，两处各取一个即可核。
 */
export function keyInjectionState(
  deps: ProfilePipelineDeps,
  doc: ProfileDoc,
  key: string,
): { injectable: boolean | null; effectiveValue: string | null; lastConfidence: number | null; lastDecision: string | null } {
  const fullKey = profileKey(doc, key)
  const main = readMain(deps.core, fullKey)
  const lines = listProfileHistory(deps, doc)
  const mine = lines.filter((l) => l.fullKey === fullKey)
  const last = mine.length ? mine[mine.length - 1] : null
  const conf = last?.confidence ?? null
  // ⚠ 用**同一个** floor 复算（deps.confidenceFloor），不得传 null：传 null 会让所有健全偏好
  //   都读成"不可注入"（本席实测踩到 —— 阈值 0.5 下 confidence 0.9 曾被判成不可注入）。
  return {
    injectable: conf === null ? null : isInjectable({ verdict: deps.verdictOf(conf, deps.confidenceFloor ?? null) }),
    effectiveValue: main ? main.value : null,
    lastConfidence: conf,
    lastDecision: last?.decision ?? null,
  }
}

/** 供宿主装配面用：本包声明的通道清单（判据断言"两个通道都在"的事实源）。 */
export { PROFILE_CHANNELS }
export { profileKey, parseProfileKey, PROFILE_WRITE_VERSION }
// ⚠ ProfileCoreFace 已在声明处 `export type ProfileCoreFace = ...` 导出 —— 此处**不得**再列一遍
//   （实测 TS2484：Export declaration conflicts with exported declaration）。
export type { ProfileChangeInput, ProfileChangeRecord, ProfileDoc, ProfileVerdictLike }
export { PROFILE_DOCS }
