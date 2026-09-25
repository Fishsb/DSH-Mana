/**
 * 降级留痕（**本包对 `mana_trace` 的唯一写点**）。
 *
 * ⚠ 为什么本包要写 `mana_trace`（这不是「顺手加的日志」）：
 *   `docs/contract/degradation.md` 硬约定 3/5：**每次降级必须同时给出 `degraded: true` 与
 *   非空 `reason`**，且「沉默地不做，但**必须留痕**」。本包的降级面是
 *   「`related_ids` 列不存在」——它在**读取结果里**只表现为 `items: []`，
 *   与「本来就无关」**完全同形**。若不留痕，这个故障永远不会被发现。
 *
 * ⚠ **命名空间不许侵占 S1 五类**（negative-control D4 的靶子）：
 *   `packages/core/tests/chain-e2e.test.mjs:158-170` 对 `mana_trace.event_type` 断言
 *   「`MANA_STAGES` 五类**各 ≥1**」（这是**下界**断言，多出别的标签不会假红）。
 *   但若本包把降级行写成 `eventType: 'recall'`（五类之一），就会让「五类齐全」这条腿
 *   **被本包的行凑出来**，而 A1-1 想证明的是「一条真链走通了五类」——
 *   本包的降级行会**掩盖**真链缺哪一类。⇒ 用自己的命名空间。
 *
 * 命名空间取值（与仓内既有先例一致，不是新发明的风格）：
 *   · `packages/scheduler/src/index.ts` 用带包名前缀的 trace 标签；
 *   · `packages/ui/tests/replay.test.mjs:65` 读 `event_type = 'ui/render'`。
 *   ⇒ 本包取 `mana/learning/*`。**它不在 S1 五类内，也不得被改成五类之一。**
 */

import type { DatabaseSync } from 'node:sqlite'
import type { ManaCoreService } from 'dsh-mana-core'

/** 本包的事件命名空间前缀（唯一出处；测试按此断言「没侵占 S1 五类」）。 */
export const TRACE_EVENT_PREFIX = 'mana/learning/' as const

/** **唯一**的留痕事件：读/写 `related_ids` 时该列缺席。 */
export const TRACE_EVENT_DEGRADED = 'mana/learning/related_ids_unavailable' as const

/** 非 trace 的降级通道（无 core / 无 store 时）——`inject_log` 与三态字段都用这个名字。 */
export const GATE_FALLBACK = 'learning.related_ids_unavailable' as const

/** 一条降级事实（可直接从 `LinkOutcome` 构造，见 `store.ts`）。 */
export interface DegradationNotice {
  /** 非空原因（G8 硬要求）。 */
  readonly reason: string
  /** 被影响的记忆 id（写面降级时有值；探测列时可为空）。 */
  readonly ids?: readonly string[]
}

/** 留痕结果：**三态**，不许把「写不进去」读成「已留痕」。 */
export type TraceOutcome =
  | { readonly recorded: true; readonly seq: number; readonly channel: 'mana_trace' }
  | { readonly recorded: false; readonly seq: null; readonly channel: 'stderr'; readonly reason: string }

/**
 * 写一条降级留痕。
 *
 * `core` 缺席时**退回 stderr**（而不是静默）—— 退回本身也返回 `recorded: false`：
 * 「没有 core」与「有 core 且写成功」在调用方看来必须可分辨（G8）。
 */
export function recordDegradation(
  core: ManaCoreService | { writeTrace(entry: { eventType: string; sessionId: string; turnId: number; payload: unknown; at?: string }): number } | undefined,
  notice: DegradationNotice,
  at: string = new Date().toISOString(),
): TraceOutcome {
  if (!notice.reason || notice.reason.trim() === '') {
    throw new Error('recordDegradation: reason 不得为空（G8：降级必须给出非空原因）')
  }
  const payload = { degraded: true, reason: notice.reason, ids: notice.ids ?? [] }
  if (!core || typeof core.writeTrace !== 'function') {
    console.error(`[mana-learning] 降级留痕无法落库（无 mana-core）：${JSON.stringify(payload)}`)
    return { recorded: false, seq: null, channel: 'stderr', reason: 'mana-core 服务不可用，降级事实只到了 stderr' }
  }
  const seq = core.writeTrace({
    eventType: TRACE_EVENT_DEGRADED,
    sessionId: 'mana-learning',
    turnId: 0,
    payload,
    at,
  })
  return { recorded: true, seq, channel: 'mana_trace' }
}

/** 供测试与探针使用：直查 `mana_trace` 里本包的降级行（**不经过 core 服务**）。 */
export function listDegradationRows(db: DatabaseSync): { seq: number; payload: string }[] {
  return db
    .prepare('SELECT seq, payload FROM mana_trace WHERE event_type = ? ORDER BY seq ASC')
    .all(TRACE_EVENT_DEGRADED) as unknown as { seq: number; payload: string }[]
}
