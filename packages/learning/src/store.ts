/**
 * **落库面**：把 Hebbian 共激活写进 `memory_items.related_ids`（L-03 的落点）。
 *
 * ⚠ 本文件是 `related_ids` 的**唯一写者**（全仓此前该列无写者，见 `store-format.ts` 文件头）。
 *   典型用法（生产路径）：
 * ```
 *   const outcome = applyCoActivations(db, events, { core })
 *   if (outcome.degraded) throw new Error(outcome.reason)   // 由调用方决定，本包只如实回报
 * ```
 *
 * ── 三态：**列不存在**（本包最防的不可观测形态）───────────────────────────────────
 *   `memory_items.related_ids` 在 `packages/core/src/schema.ts:59` 的 DDL 里**存在**，
 *   但**老库可能建于该列加入之前**（本仓 `createSchema` 有补列迁移面，
 *   见 `packages/core/src/db.ts` 的 `appliedColumns`）。此时 `UPDATE ... SET related_ids=?`
 *   会抛 `no such column` —— 而「抛了」与「没写」在不同调用方那里会走不同分支。
 *   ⇒ 本包**先探再写**（`probeRelatedIdsColumn`），并把三种事实**分列**：
 *     · `present`   —— 列在，正常读写；
 *     · `missing`   —— 列不在 ⇒ `degraded=true` + **非空 reason** + `gate` + **留痕**，**一格不写**；
 *     · `unprobed`  —— 探测本身失败（库/表都不在）⇒ 同样 degraded，reason 说清是哪一种。
 *   ⚠ `unprobed` 与 `missing` **不得合并**：前者是「我读不到 schema」，后者是「schema 说没有」——
 *     合并之后，一个坏掉的库句柄会伪装成「老库缺列」，而两者的处置完全不同。
 *
 * ── 写入口的四条**显式拒绝**（各自落进 `skipped`，不静默）────────────────────────
 *   ① 行不存在（`row_absent`）—— 写了一个不存在的记忆的关系，等于关系悬空；
 *   ② 该行的 `related_ids` **解析为 invalid**（`unreadable_related_ids`）——
 *      **不覆写**：读不懂的值可能是别处写的真数据，覆写即销毁证据。宁可少写一格、并留痕。
 *   ③ 该行的 `retired = 1`（`retired_row`）—— 退休行的关系面**不新增**（与 A2-7 同口径：
 *      退休是「不再参与」，不是「换个地方参与」）。⚠ 这是**本包的口径**，非册内原文，
 *      已记入 handoff 未决项待主持人裁（原文只说「增加关联强度」，未提 retired）。
 *   ④ 自环 / 空 id —— 在 `assertPair` 处抛（程序错误，不是数据状态）。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { ManaCoreService } from 'dsh-mana-core'
import { ETA } from './params.ts'
import { findCoActivations, type ActivationEvent, type CoActivation } from './window.ts'
import { encodeRelated, parseRelatedIds, weightOf, type RelatedEntry } from './store-format.ts'
import { GATE_FALLBACK, recordDegradation, type TraceOutcome } from './trace.ts'

/** 列探测的**三态**。 */
export type ColumnProbe =
  | { readonly state: 'present'; readonly reason: null }
  | { readonly state: 'missing'; readonly reason: string }
  | { readonly state: 'unprobed'; readonly reason: string }

/**
 * 探测 `memory_items.related_ids` 列是否存在。
 *
 * 用 `pragma_table_info` **而不是** `SELECT related_ids FROM memory_items LIMIT 0`：
 * 后者在缺列时抛，在前者形态下能被区分开；且 `pragma_table_info` 连「表都不在」也能读成
 * `c = 0`（本机实测：无表时返回 `{c: 0}`，不抛）⇒ 必须与「列名拼错」区分开：见下面的实现。
 */
export function probeRelatedIdsColumn(db: DatabaseSync): ColumnProbe {
  try {
    const table = db
      .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='memory_items'")
      .get() as { c?: number } | undefined
    if (Number(table?.c ?? 0) === 0) {
      return { state: 'unprobed', reason: 'memory_items 表不存在（库未初始化或指向了别的库）—— 这不是「列缺失」' }
    }
    const col = db
      .prepare("SELECT COUNT(*) c FROM pragma_table_info('memory_items') WHERE name='related_ids'")
      .get() as { c?: number } | undefined
    if (Number(col?.c ?? 0) === 0) {
      return { state: 'missing', reason: 'memory_items.related_ids 列不存在（该库建于补列之前）' }
    }
    return { state: 'present', reason: null }
  } catch (error) {
    return {
      state: 'unprobed',
      reason: `列探测本身失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** 一条记忆的关系面读数。 */
export interface RelatedRead {
  readonly id: string
  readonly exists: boolean
  readonly retired: number | null
  /** 单元格原文（`null` = 列值为 NULL；`undefined` = 列不存在）。 */
  readonly raw: string | null | undefined
  readonly items: readonly RelatedEntry[]
  readonly state: 'ok' | 'null' | 'empty' | 'invalid' | 'row_absent' | 'column_missing'
  readonly reason: string | null
}

/** 读一条记忆的 `related_ids`（**不写**）。三态与原因都落在返回对象里。 */
export function readRelatedIds(db: DatabaseSync, id: string): RelatedRead {
  const probe = probeRelatedIdsColumn(db)
  if (probe.state !== 'present') {
    return { id, exists: false, retired: null, raw: undefined, items: [], state: 'column_missing', reason: probe.reason }
  }
  const row = db.prepare('SELECT id, retired, related_ids FROM memory_items WHERE id = ?').get(id) as
    | { id: string; retired?: number | null; related_ids?: string | null }
    | undefined
  if (!row) {
    return { id, exists: false, retired: null, raw: undefined, items: [], state: 'row_absent', reason: `memory_items 无 id=${JSON.stringify(id)} 的行` }
  }
  const parsed = parseRelatedIds(row.related_ids ?? null)
  return {
    id,
    exists: true,
    retired: Number(row.retired ?? 0),
    raw: row.related_ids ?? null,
    items: parsed.items,
    state: parsed.state,
    reason: parsed.reason,
  }
}

/** 一对关系的一次写入决策（**逐对可核**，不是汇总一个数）。 */
export interface PairWrite {
  readonly a: string
  readonly b: string
  /** 本对在本批里被记了几次共激活（occasion 计数）。 */
  readonly occasions: number
  readonly action: 'created' | 'incremented' | 'skipped'
  /** 写前该行对对方的权重（`null` = 该行本来没有这一格）。 */
  readonly before: number | null
  /** 写后权重（`skipped` 时为 `null`）。 */
  readonly after: number | null
  /** `skipped` 时**非空**（见文件头四条显式拒绝）。 */
  readonly reason: string | null
}

/** 一次 `applyCoActivations` 的**完整读数**（失败与空输入都必须可分辨）。 */
export interface LinkOutcome {
  /** 是否降级（列缺失/探测失败）。 |
   *  ⚠ 与 `reason` **成对**：`degraded=true` ⇒ `reason` 非空 且 `gate` 非空（`docs/contract/degradation.md` 3/4）。 */
  readonly degraded: boolean
  readonly reason: string | null
  /** 降级通道标签；正常态为 `null`。 */
  readonly gate: string | null
  /** 输入事件条数（**含被丢掉的**）—— 使「没输入」与「输入全被丢」可分辨。 */
  readonly eventsSeen: number
  /** 实际写进库的行数（== 执行成功的 UPDATE 数）。 */
  readonly rowsWritten: number
  /** 识别出的 occasion 数（**注意**：它不是「写了几格」——见 `pairs` 与 `skipped`）。 */
  readonly occasions: number
  readonly pairs: readonly PairWrite[]
  /** 被丢掉的事件（原因见 `window.ts`）。 */
  readonly droppedEvents: readonly { readonly index: number; readonly reason: string; readonly detail: string }[]
  /** 留痕结果；未降级时为 `null`（没降级就不留痕，避免把正常态写成告警）。 */
  readonly trace: TraceOutcome | null
}

export interface ApplyOptions {
  /** `mana-core` 服务（留痕用）。缺省 = 无 core，降级只到 stderr（返回 `recorded:false`）。 */
  readonly core?: ManaCoreService
  /** 学习率覆盖（**判据不传**，缺省 `params.ETA`）。 */
  readonly eta?: number
  /** 窗口覆盖（**判据不传**，缺省 `params.COACTIVATION_WINDOW_MS`）。 */
  readonly windowMs?: number
  /** 时刻（留痕用）。 */
  readonly at?: string
  /**
   * 是否允许覆写**解析为 invalid** 的 `related_ids`。
   *
   * ⚠ 缺省 **false**（不覆写）：读不懂的值可能是别处写的真数据，覆写即销毁证据。
   *   置 true 时该行会被**明确重建**（旧值丢掉），且仍在 `pairs` 里记 `reason` 说明重建过。
   */
  readonly overwriteInvalid?: boolean
}

/** 判据用的便捷入口：直接写一对关系（等价于给它造 N 次共激活）。**生产路径走 `applyCoActivations`**。 */
export function linkPair(
  db: DatabaseSync,
  i: string,
  j: string,
  n: number = 1,
  opts: ApplyOptions = {},
): LinkOutcome {
  if (!Number.isInteger(n) || n < 1) throw new Error(`linkPair: n 必须是 ≥1 的整数（实测 ${String(n)}）`)
  const eta = opts.eta ?? ETA
  const base = 1_000_000
  const events: ActivationEvent[] = []
  for (let k = 0; k < n; k++) {
    // 每次 occasion 给 i / j 各一个同刻戳（同刻 ⇒ gap = 0 ≤ 窗口）：n 次 occasion、n 个时刻。
    events.push({ id: i, at: base + k * 1_000_000 })
    events.push({ id: j, at: base + k * 1_000_000 })
  }
  return applyCoActivations(db, events, { ...opts, eta })
}

/**
 * **生产入口**：把一段激活流里的共激活写进 `related_ids`。
 *
 * 参数组合的语义（逐条对应 `ApplyOptions`）：`eta`/`windowMs` 是**判据不传**的覆盖口；
 * `overwriteInvalid` 决定遇到读不懂的旧值时**重建还是保留**。
 */
export function applyCoActivations(
  db: DatabaseSync,
  events: readonly ActivationEvent[],
  opts: ApplyOptions = {},
): LinkOutcome {
  const eta = opts.eta ?? ETA
  const at = opts.at ?? new Date().toISOString()
  const probe = probeRelatedIdsColumn(db)
  const scan = findCoActivations(events, opts.windowMs)

  /** 降级的统一出口：**先留痕，再返回**（顺序反了会在 trace 抛错时丢掉降级事实）。 */
  const degradedOutcome = (reason: string): LinkOutcome => {
    const trace = recordDegradation(opts.core, { reason, ids: [] }, at)
    return {
      degraded: true,
      reason,
      gate: GATE_FALLBACK,
      eventsSeen: scan.seen,
      rowsWritten: 0,
      occasions: scan.occasions.length,
      pairs: [],
      droppedEvents: scan.dropped.map((d) => ({ index: d.index, reason: d.reason, detail: d.detail })),
      trace,
    }
  }

  if (probe.state !== 'present') return degradedOutcome(probe.reason)

  // ── 逐对汇总：同一对在多个簇里出现 ⇒ occasion 计数累加（**不是**各写一次）──────
  const counts = new Map<string, { a: string; b: string; n: number }>()
  for (const oc of scan.occasions as readonly CoActivation[]) {
    const key = `${oc.a}\u0001${oc.b}`
    const hit = counts.get(key)
    if (hit) hit.n += 1
    else counts.set(key, { a: oc.a, b: oc.b, n: 1 })
  }

  const pairs: PairWrite[] = []
  const pending = new Map<string, RelatedEntry[]>() // id → 新 items

  const skip = (a: string, b: string, occasions: number, reason: string): void => {
    pairs.push({ a, b, occasions, action: 'skipped', before: null, after: null, reason })
  }

  // 排序键：簇序已排过，这里按 (a,b) 全序，使输出与输入顺序无关。
  const ordered = [...counts.values()].sort((x, y) => (x.a !== y.a ? (x.a < y.a ? -1 : 1) : x.b < y.b ? -1 : x.b > y.b ? 1 : 0))

  for (const { a, b, n } of ordered) {
    const ra = readRelatedIds(db, a)
    const rb = readRelatedIds(db, b)
    // ①②③ 三条显式拒绝（见文件头）。
    if (ra.state === 'row_absent') { skip(a, b, n, `① 行不存在：${ra.reason}`); continue }
    if (rb.state === 'row_absent') { skip(a, b, n, `① 行不存在：${rb.reason}`); continue }
    if (ra.state === 'invalid' && !opts.overwriteInvalid) { skip(a, b, n, `② ${a} 的 related_ids 读不懂，未覆写：${ra.reason}`); continue }
    if (rb.state === 'invalid' && !opts.overwriteInvalid) { skip(a, b, n, `② ${b} 的 related_ids 读不懂，未覆写：${rb.reason}`); continue }
    if (Number(ra.retired ?? 0) === 1 || Number(rb.retired ?? 0) === 1) {
      skip(a, b, n, `③ 退休行不新增关系（实测 retired a=${String(ra.retired)} b=${String(rb.retired)}）`)
      continue
    }

    // 权重：本批 n 次 occasion ⇒ 在**读回值**上 + n·η（可复算；闭式见 hebbian.closedFormWeight）。
    const wa = weightOf(ra.items, b) ?? 0
    const wb = weightOf(rb.items, a) ?? 0
    const na = wa + n * eta
    const nb = wb + n * eta

    const itemsA = (pending.get(a) ?? [...ra.items]).filter((e) => e.id !== b)
    itemsA.push({ id: b, weight: na })
    pending.set(a, itemsA)
    const itemsB = (pending.get(b) ?? [...rb.items]).filter((e) => e.id !== a)
    itemsB.push({ id: a, weight: nb })
    pending.set(b, itemsB)

    pairs.push({
      a,
      b,
      occasions: n,
      action: wa === 0 && !ra.items.some((e) => e.id === b) ? 'created' : 'incremented',
      before: ra.items.some((e) => e.id === b) ? wa : null,
      after: na,
      reason: opts.overwriteInvalid && (ra.state === 'invalid' || rb.state === 'invalid') ? '旧值读不懂，按 overwriteInvalid 重建' : null,
    })
  }

  // ── 落库：一个事务内把每个受影响 id 写一次（encode ⇒ 唯一字节形式）─────────────
  const write = (): number => {
    const stmt = db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?')
    let n = 0
    for (const id of [...pending.keys()].sort()) {
      const items = pending.get(id) ?? []
      n += Number(stmt.run(encodeRelated(items), id).changes ?? 0)
    }
    return n
  }
  const rowsWritten = runInManualTransaction(db, write)

  return {
    degraded: false,
    reason: null,
    gate: null,
    eventsSeen: scan.seen,
    rowsWritten,
    occasions: scan.occasions.length,
    pairs,
    droppedEvents: scan.dropped.map((d) => ({ index: d.index, reason: d.reason, detail: d.detail })),
    trace: null,
  }
}

/**
 * 手写 `BEGIN IMMEDIATE` 事务（G7 口径，与 `core/src/db.ts:98` 的 `withImmediateTransaction` 同形）。
 *
 * ⚠ **为什么本包自带一份而不是 import core 的**：本包的写入口接的是**裸 `db`**
 *   （与 `long-term/retirement.ts` 同形态：不持有库句柄、不开库），
 *   `core.withTransaction` 是**服务方法**、需要 core 到场，而本包在无 core 时也要能写
 *   （降级只是留痕通道降级，不是写面降级）。⇒ 事务语义在这一处自持，**语义逐字对齐**
 *   （`BEGIN IMMEDIATE` / 失败 `ROLLBACK` 且**原始错误优先抛出**）。
 */
function runInManualTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* 回滚失败不掩盖原始错误（与 core 同口径） */
    }
    throw error
  }
}
