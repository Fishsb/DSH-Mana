/**
 * **内容更新（走生产路径）**：读旧值 → 追加 `update_history` → 写回 → **回读取证**。
 *
 * ── 三态（与 `openWindow` 同口径）─────────────────────────────────────────────────────
 *   · `channel:'applied'`   —— 两列在，真写了库，`historyCount` 为**回读**值（不是"我以为写了"）；
 *   · `channel:'degraded'`  —— 缺列：`degraded:true` + **非空** `reason` + 留痕，**不写库**；
 *   · `channel:'not-found'` —— 记忆 id 不在库中（**不是**降级：schema 没毛病），仍然不静默。
 *
 * ⚠ 降级时 `historyCount`/`historyAppended` 落 **null 而不是 0**：
 *   列不存在 ⇒ 段数**不可知**，用 0 冒充会让「读不到」与「本来就是 0 段」同形
 *   （`schema.ts:102-103` 同一条纪律："不可用落 null、不得靠缺列冒充"）。
 *
 * ⚠ **不得为了让"更新成功"看起来成立而绕过缺列**：本函数在降级路径上**一条 SQL 都不发**
 *   （除只读的 `SELECT content`），故降级时库内**零改动** —— 这是可对拍的事实。
 */
import type { ManaCoreService } from 'dsh-mana-core'
import { columnsPresent, missingColumnsReason, type ColumnProbeDb } from './columns.ts'
import { appendUpdateEntry, parseUpdateHistory, type UpdateEntry } from './history.ts'
import { TRACE_EVENTS } from './trace.ts'

export interface ContentUpdateRequest {
  memoryId: string
  /** 新的内容。 */
  content: string
  /** 新摘要；`undefined` = 不改（与"改成空串"可分辨）。 */
  summary?: string | null
  /** 更新时刻（ISO）；缺省取 `now` 的 ISO。**显式传参优先**，便于判据固定夹具。 */
  at?: string
  /** 显式时钟（毫秒）；`at` 缺省时用它。不读 `Date.now()`（判据须可复算）。 */
  now: number
  /** 归因：本次窗口由哪次检索打开。 */
  trigger?: string | null
  sessionId?: string
  turnId?: number
}

export interface ContentUpdateResult {
  memoryId: string
  channel: 'applied' | 'degraded' | 'not-found'
  /** 生产路径是否真写了库（唯一判据：回读到的内容 === 提交的内容 **且** 历史确实增加）。 */
  updated: boolean
  degraded: boolean
  /** 非空当且仅当 `channel !== 'applied'`。 */
  reason: string | null
  /** 更新前的内容（降级时仍可读：`content` 列本身不缺口）。 */
  previousContent: string | null
  /** 更新后的内容（降级时 = `previousContent`，因为没写）。 */
  content: string | null
  /** **回读**到的历史段数；不可用时为 `null`。 */
  historyCount: number | null
  /** 本次新增段数（正常态恒为 1）；不可用/未追上时为 `null`。 */
  historyAppended: number | null
  at: string
  /** 是否真落了 trace 行（`writeTrace` 是唯一写口）。 */
  traced: boolean
}

/**
 * 写一条留痕（`mana-core` 的唯一写口）。`trace` 缺省开着 —— 降级**必须**留痕。
 * `sessionId`/`turnId` 缺省时为 `null`（trace 表两列本身可空），不谎报会话。
 */
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

/**
 * 施加一次内容更新。
 *
 * ⚠ 回读取证（`updated` 的三条并列条件，缺一即 false）：
 *   ① `SELECT content` 读回值 === 提交值；② `SELECT update_history` 段数 +1；
 *   ③ 新增段确实是本次（`at` 与 `next` 逐字相同）。
 *   `UPDATE ... .run()` 返回的 `changes=1` **单独不足以**当判据：
 *   它只证明"有一行被改"，不证明改对了哪一列（本仓 consolidation `rules.ts:37` 同款教训：
 *   "INSERT 成功 ≠ 列写对了"）。
 */
export function applyContentUpdate(core: ManaCoreService, req: ContentUpdateRequest): ContentUpdateResult {
  const db = core.db as unknown as ColumnProbeDb
  const at = req.at ?? new Date(req.now).toISOString()
  const probe = columnsPresent(db)

  const readContent = (): string | null => {
    const row = (core.db.prepare('SELECT content FROM memory_items WHERE id = ?').get(req.memoryId) as
      | { content?: unknown }
      | undefined) ?? undefined
    return row && typeof row.content === 'string' ? row.content : null
  }

  // ── 降级态：缺列 ⇒ 不写库、如实回报、留痕 ──────────────────────────────────
  if (!probe.ok) {
    const previous = readContent()
    const reason = missingColumnsReason(probe.missing)
    const traced = writeTrace(
      core,
      TRACE_EVENTS.degraded,
      { memoryId: req.memoryId, action: 'content-update', reason, missing: probe.missing },
      { sessionId: req.sessionId, turnId: req.turnId, at },
    )
    return {
      memoryId: req.memoryId,
      channel: 'degraded',
      updated: false,
      degraded: true,
      reason,
      previousContent: previous,
      content: previous,
      historyCount: null,
      historyAppended: null,
      at,
      traced,
    }
  }

  // ── 记忆不存在：不是降级，但同样不静默 ────────────────────────────────────
  const before = readContent()
  if (before === null) {
    return {
      memoryId: req.memoryId,
      channel: 'not-found',
      updated: false,
      degraded: false,
      reason: `memory-not-found:${req.memoryId}`,
      previousContent: null,
      content: null,
      historyCount: null,
      historyAppended: null,
      at,
      traced: false,
    }
  }

  // ── 生产路径：读旧历史 → 追加 → 写 → 回读 ─────────────────────────────────
  const row = core.db.prepare('SELECT update_history FROM memory_items WHERE id = ?').get(req.memoryId) as
    | { update_history?: unknown }
    | undefined
  const entry: UpdateEntry = { previous: before, next: req.content, at, trigger: req.trigger ?? null }
  const appended = appendUpdateEntry(row?.update_history ?? null, entry)
  const beforeCount = appended.total - appended.appended

  if (req.summary === undefined) {
    core.db
      .prepare('UPDATE memory_items SET content = ?, update_history = ? WHERE id = ?')
      .run(req.content, appended.json, req.memoryId)
  } else {
    core.db
      .prepare('UPDATE memory_items SET content = ?, summary = ?, update_history = ? WHERE id = ?')
      .run(req.content, req.summary, appended.json, req.memoryId)
  }

  const afterRow = core.db.prepare('SELECT content, update_history FROM memory_items WHERE id = ?').get(req.memoryId) as
    | { content?: unknown; update_history?: unknown }
    | undefined
  const afterContent = typeof afterRow?.content === 'string' ? afterRow.content : null
  // 回读段数：从列里**真读一遍**（不是"我以为写了多少"）
  const afterHistory = parseUpdateHistory(afterRow?.update_history ?? null)
  const readCount = afterHistory.length
  const lastEntry = afterHistory[readCount - 1] ?? null
  const appendedVisible = readCount === beforeCount + 1 && lastEntry?.at === at && lastEntry?.next === req.content
  const updated = afterContent === req.content && appendedVisible

  const traced = writeTrace(
    core,
    TRACE_EVENTS.contentUpdated,
    {
      memoryId: req.memoryId,
      previous: before,
      next: req.content,
      at,
      historyBefore: beforeCount,
      historyAfter: readCount,
      appended: appended.appended,
      dropped: appended.dropped,
      trigger: req.trigger ?? null,
    },
    { sessionId: req.sessionId, turnId: req.turnId, at },
  )

  return {
    memoryId: req.memoryId,
    channel: 'applied',
    updated,
    degraded: false,
    reason: null,
    previousContent: before,
    content: afterContent,
    historyCount: readCount,
    historyAppended: readCount - beforeCount,
    at,
    traced,
  }
}
