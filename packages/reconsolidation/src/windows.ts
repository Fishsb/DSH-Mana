/**
 * **窗口开启 / 关闭**（去稳定化 → 重新稳定化），走生产路径：写 `memory_items` + 回读取证。
 *
 * ── 三态（本包对「两列存在与否」的显式口径）──────────────────────────────────────────────
 *   | 态 | 条件 | `channel` | `degraded` | `reason` | 副作用 |
 *   |---|---|---|---|---|---|
 *   | 正常 | 两列都在 | `applied` | false | null | 写 `reconsolidation_window_until` + 一条 trace |
 *   | **降级** | 缺列（L-00 未执行） | `degraded` | **true** | **非空** `schema-missing:...` | **不写库**，写一条 trace |
 *   | 未命中 | id 不在库 | `not-found` | false | `memory-not-found:<id>` | 无 |
 *
 * ⚠ **降级不等于"什么都没发生"**：它必须留痕（`mana-reconsolidation/degraded`）。
 *   不留痕的降级在事后取证时与"这条记忆从来没被注入过"**完全同形** —— 正是本包要防的形态。
 *
 * ⚠ 窗口"到点关闭"由 `now` 比较得出（`until <= now`），**不注册定时器**：
 *   定时器会让"关窗"依赖进程存活，而进程死掉时窗口**永远开着**且无人知晓。
 *   到点关闭是**幂等读改**：`closeDueWindows(now)` 可被任何调度者重复调用。
 */
import type { ManaCoreService } from 'dsh-mana-core'
import { columnsPresent, missingColumnsReason, type ColumnProbeDb } from './columns.ts'
import { TRACE_EVENTS } from './trace.ts'
import { isoAt, windowMs, windowOpen, windowUntil, type WindowReading } from './window.ts'
import { resolveRetrievalKind, retentionGainMs, type RetrievalKind } from './params.ts'

export interface WindowRequest {
  memoryId: string
  /** 记忆类型 —— 决定窗长（`windowMs(type)`）。 */
  type: string
  /** **显式时钟**（毫秒）。固定 now，判据据此逐字复算，不读 `Date.now()`。 */
  now: number
  /** 归因：本次检索/注入的来源标识（如 inject 行 id）。 */
  trigger?: string | null
  sessionId?: string
  turnId?: number
  /**
   * **v10 §15.4 测试效应**：这次检索属于哪一档（再认 / 回忆 / 精细提取）。
   *
   * ⚠ **可选，且缺省即「未声明」**：省略 ⇒ 窗体行为与加这一轴之前**逐字相同**
   *   （`until === now + windowMs(type)`）—— 既有生产调用方（'scheduler' 的注入链）
   *   目前只知道「发生了一次检索」，还不知道「是哪种检索」，故本项**不改它的行为**。
   * ⚠ 非法值**抛**（`RangeError`），不读成「未声明」：拼错类型不得静默变成零增益。
   */
  retrievalKind?: string
}

export interface WindowResult extends WindowReading {
  channel: 'applied' | 'degraded' | 'not-found'
  /** 非空当且仅当 `channel !== 'applied'`。 */
  reason: string | null
  /** 降级位（`channel === 'degraded'` 时为 true）。 */
  degraded: boolean
  /** 是否真落了 trace 行。 */
  traced: boolean
  /**
   * 本次声明的检索类型（**未声明时为 `null`**）—— v10 §15.4。
   *
   * ⚠ 它是「没发生检索」与「发生了但增益为 0」的**分辨位**：
   *   `null` + 增益 0 = **没有声明检索**；'recognition' + 增益 0 = **声明了、这一档算出来就是 0**。
   */
  retrievalKind: RetrievalKind | null
  /** 本次由测试效应施加的**毫秒**延长量（未声明时为 0，此时 `until === untilBase`）。 */
  retentionGainMs: number
  /** 未经增益的基准窗长终点 `now + windowMs(type)` —— 令 `until = untilBase + retentionGainMs` 可逐字对拍。 */
  untilBase: number
}

export interface CloseRequest {
  /** 显式时钟（毫秒）。 */
  now: number
  /** 只关某条记忆的窗；省略 = 扫描全部到期窗口。 */
  memoryId?: string
  sessionId?: string
  turnId?: number
}

export interface CloseResult {
  channel: 'applied' | 'degraded'
  degraded: boolean
  reason: string | null
  /** 被关闭的记忆 id（**回读数**，按 id 升序）。 */
  closed: string[]
  /** 到期但关闭失败 / 命中数为 0 时如实为 0（0 也要报 0）。 */
  scanned: number
  traced: boolean
}

function writeTrace(
  core: ManaCoreService,
  eventType: string,
  payload: Record<string, unknown>,
  req: { sessionId?: string; turnId?: number; at: string },
): boolean {
  core.writeTrace({
    eventType,
    sessionId: req.sessionId ?? '',
    turnId: req.turnId ?? 0,
    payload,
    at: req.at,
  })
  return true
}

/** 开窗前的既有值（用于"注入前后"可对拍：降级时它必须**逐字不变**）。 */
export function readWindowUntil(core: ManaCoreService, memoryId: string): string | null {
  const row = core.db.prepare('SELECT reconsolidation_window_until FROM memory_items WHERE id = ?').get(memoryId) as
    | { reconsolidation_window_until?: unknown }
    | undefined
  const v = row?.reconsolidation_window_until
  return typeof v === 'string' ? v : null
}

/**
 * 记忆被检索并注入上下文 ⇒ **开窗**：`until = now + windowMs(type)`。
 *
 * ⚠ 窗长的 `windowMs(type)` 在**校验之后**才调用：未知类型会在这里抛 `RangeError`
 *   （而不是静默开一个缺省窗）。抛错发生在**写库之前**，故不产生半开窗。
 */
export function openWindow(core: ManaCoreService, req: WindowRequest): WindowResult {
  const db = core.db as unknown as ColumnProbeDb
  const atIso = isoAt(req.now)
  const probe = columnsPresent(db)
  // 先算窗长：未知类型在此抛（**不吞**，见 window.ts 的口径）。
  const lenMs = windowMs(req.type)
  const untilBase = windowUntil(req.now, req.type)
  // v10 §15.4 测试效应：**未声明** ⇒ null ⇒ 增益 0（既有一律走这条，行为逐字不变）；
  // 非法值在**写库之前**抛（同窗长的处置：不产生半开窗，也不静默当零增益）。
  const kind = resolveRetrievalKind(req.retrievalKind)
  const gainMs = kind === null ? 0 : retentionGainMs(lenMs, kind)
  const until = untilBase + gainMs

  if (!probe.ok) {
    const reason = missingColumnsReason(probe.missing)
    const traced = writeTrace(
      core,
      TRACE_EVENTS.degraded,
      { memoryId: req.memoryId, action: 'open-window', reason, missing: probe.missing, type: req.type },
      { sessionId: req.sessionId, turnId: req.turnId, at: atIso },
    )
    return {
      memoryId: req.memoryId,
      type: req.type,
      openedAt: req.now,
      until,
      untilIso: isoAt(until),
      windowMsValue: lenMs,
      persisted: false,
      channel: 'degraded',
      degraded: true,
      reason,
      traced,
      retrievalKind: kind,
      retentionGainMs: gainMs,
      untilBase,
    }
  }

  const exists = core.db.prepare('SELECT 1 AS one FROM memory_items WHERE id = ?').get(req.memoryId) as
    | { one?: unknown }
    | undefined
  if (!exists) {
    return {
      memoryId: req.memoryId,
      type: req.type,
      openedAt: req.now,
      until,
      untilIso: isoAt(until),
      windowMsValue: lenMs,
      persisted: false,
      channel: 'not-found',
      degraded: false,
      reason: `memory-not-found:${req.memoryId}`,
      traced: false,
      retrievalKind: kind,
      retentionGainMs: gainMs,
      untilBase,
    }
  }

  core.db
    .prepare('UPDATE memory_items SET reconsolidation_window_until = ? WHERE id = ?')
    .run(isoAt(until), req.memoryId)

  // ── 回读取证：写成功 ≠ 值对（本仓 consolidation/rules.ts:37 同款教训）────────
  const readBack = readWindowUntil(core, req.memoryId)
  const persisted = readBack === isoAt(until)

  const traced = writeTrace(
    core,
    TRACE_EVENTS.windowOpened,
    {
      memoryId: req.memoryId,
      type: req.type,
      openedAt: atIso,
      until: isoAt(until),
      windowMs: lenMs,
      persisted,
      trigger: req.trigger ?? null,
      // v10 §15.4：把「这次是哪一档、延长了多少」落进既有留痕（未声明时 kind=null、gain=0 ⇒ 可分辨）。
      retrievalKind: kind,
      retentionGainMs: gainMs,
      untilBase: isoAt(untilBase),
    },
    { sessionId: req.sessionId, turnId: req.turnId, at: atIso },
  )

  return {
    memoryId: req.memoryId,
    type: req.type,
    openedAt: req.now,
    until,
    untilIso: isoAt(until),
    windowMsValue: lenMs,
    persisted,
    channel: 'applied',
    degraded: false,
    reason: null,
    traced,
    retrievalKind: kind,
    retentionGainMs: gainMs,
    untilBase,
  }
}

/**
 * **重新稳定化**：把已到点（`until <= now`）的窗口清零并留痕。
 *
 * ⚠ 用 ISO 串比较而不是把列 CAST 成数值：列里存的就是 `toISOString()`（**固定宽度 UTC**），
 *   该形态下字符串字典序 == 时间序，故 `<= ?` 语义正确且不依赖 SQLite 的日期函数可用性。
 *   （列格式是本包自己写的，格式漂移会被下面的回读断言抓到。）
 */
export function closeDueWindows(core: ManaCoreService, req: CloseRequest): CloseResult {
  const db = core.db as unknown as ColumnProbeDb
  const atIso = isoAt(req.now)
  const probe = columnsPresent(db)
  if (!probe.ok) {
    const reason = missingColumnsReason(probe.missing)
    const traced = writeTrace(
      core,
      TRACE_EVENTS.degraded,
      { action: 'close-window', reason, missing: probe.missing, memoryId: req.memoryId ?? null },
      { sessionId: req.sessionId, turnId: req.turnId, at: atIso },
    )
    return { channel: 'degraded', degraded: true, reason, closed: [], scanned: 0, traced }
  }

  const nowIso = isoAt(req.now)
  const rows = (
    req.memoryId
      ? core.db
          .prepare(
            'SELECT id FROM memory_items WHERE reconsolidation_window_until IS NOT NULL AND reconsolidation_window_until <= ? AND id = ?',
          )
          .all(nowIso, req.memoryId)
      : core.db
          .prepare('SELECT id FROM memory_items WHERE reconsolidation_window_until IS NOT NULL AND reconsolidation_window_until <= ?')
          .all(nowIso)
  ) as { id?: unknown }[]
  const ids = rows.map((r) => String(r?.id ?? '')).filter(Boolean).sort()

  let traced = false
  const confirmed: string[] = []
  for (const id of ids) {
    core.db.prepare('UPDATE memory_items SET reconsolidation_window_until = NULL WHERE id = ?').run(id)
    // 逐条**回读**：只有真读回 NULL 才算关掉（"以为关了"是最该防的形态）。
    const back = (core.db.prepare('SELECT reconsolidation_window_until FROM memory_items WHERE id = ?').get(id) as
      | { reconsolidation_window_until?: unknown }
      | undefined)?.reconsolidation_window_until
    const closed = back === null || back === undefined
    if (closed) confirmed.push(id)
    traced =
      writeTrace(
        core,
        TRACE_EVENTS.windowClosed,
        { memoryId: id, closedAt: atIso, readBack: closed ? null : String(back) },
        { sessionId: req.sessionId, turnId: req.turnId, at: atIso },
      ) || traced
  }

  return { channel: 'applied', degraded: false, reason: null, closed: confirmed, scanned: ids.length, traced }
}

/** 窗口是否仍开着（读侧；`now` 显式传参）。 */
export function isWindowOpen(core: ManaCoreService, memoryId: string, now: number): boolean {
  const raw = readWindowUntil(core, memoryId)
  if (raw === null) return false
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? windowOpen(parsed, now) : false
}
