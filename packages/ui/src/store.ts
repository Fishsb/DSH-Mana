/**
 * `dsh-mana-ui` **Host 侧存储适配器**。
 *
 * 唯一职责：把注入进来的 `mana-core` 服务面适配成 `PanelStore`（`panel.ts` 声明的端口），
 * 使面板逻辑**不认识 cordis**，也因此不把框架细节带进入口。
 *
 * ⚠ 三条数据面纪律：
 *  1. **只读**已冻结的表（`memory_items` / `goals` / `mana_trace`），DDL 一律不写
 *     （契约 `packages/core/src/schema.ts` 是唯一建表点）。
 *  2. 读不到时**不吞错**：抛给 `panel.ts` 的 handler，由它落 `degraded:true + reason`
 *     （`docs/contract/degradation.md` I-8 禁 `catch { return null }`）。
 *  3. `ui/render` 落点**必须真写一行** `mana_trace` —— 这是 R5 反证判据的唯一可读面
 *     （卸载后同一触发不再产生新行）。
 *
 * ⚠ **本适配器的写口只有一个**：`writeRender`（写 `mana_trace` 的 `ui/render` 行）。
 *   审计回放（`traceRows`，见 `src/replay.ts`）走的是**只读** SELECT，
 *   且本文件里**不存在**任何写 `memory_items` 的语句 —— 「回放不写库」（A5-3）
 *   在类型与语句两个面上都成立，不靠注释自律。
 */
import type { DatabaseSync } from 'node:sqlite'
import { CHANNEL_PREFERENCE_KEY, type GoalNode, type HeatCell, type PanelStore, type TraceItem } from './panel.ts'
import type { TraceRow } from './replay.ts'

/**
 * core 的**偏好写入口**（`updateUserModel` 的结构性声明）。
 *
 * ⚠ 只声明本适配器用到的那一个方法，**不 import `dsh-mana-core` 的类型**：
 *   `store.ts` 的既有纪律是「不认识 cordis、只面向端口」，把 core 的类型拖进来
 *   会让这个适配器与具体宿主耦上（本文件头注第 1 条的同一理由）。
 */
export type UserModelWriter = (key: string, value: string) => void

/** 结构化行视图：`node:sqlite` 的 `get()`/`all()` 返回 `Record<string, unknown>`。 */
type Row = Record<string, unknown>

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/** `goals` 是邻接表（`parent_id`）⇒ 摊平成带 `depth` 的列表（**不递归**，防环）。 */
export function flattenGoals(rows: readonly Row[], limit: number): GoalNode[] {
  const byId = new Map<string, Row>()
  for (const r of rows) byId.set(str(r.id), r)

  const depthOf = (startId: string): number => {
    let depth = 0
    let cursor = byId.get(startId)
    const seen = new Set<string>([startId])
    while (cursor) {
      const parent = str(cursor.parent_id, '')
      if (parent === '' || !byId.has(parent) || seen.has(parent)) break
      seen.add(parent)
      depth += 1
      cursor = byId.get(parent)
    }
    return depth
  }

  const out: GoalNode[] = []
  for (const r of rows.slice(0, Math.max(0, limit))) {
    const id = str(r.id)
    out.push({
      id,
      parentId: str(r.parent_id, '') === '' ? null : str(r.parent_id),
      title: str(r.title),
      status: str(r.status, 'active'),
      priority: num(r.priority),
      depth: depthOf(id),
    })
  }
  return out
}

/**
 * 用一条独立只读连接造 `PanelStore`。
 *
 * `writeUserModel` = 入口注入的 core 偏好写入口（**可缺省**：缺省时 `writeChannel` 显式抛错，
 * 不静默丢弃 —— 静默丢弃会让 UI 上的选择看着存住了、其实没有）。
 */
export function createPanelStore(db: DatabaseSync, writeUserModel?: UserModelWriter): PanelStore {
  return {
    heatmap(limit: number): readonly HeatCell[] {
      const rows = db
        .prepare(
          `SELECT id, base_level_activation, strength, type
             FROM memory_items
            WHERE retired = 0
            ORDER BY base_level_activation DESC, id ASC
            LIMIT ?`,
        )
        .all(limit) as Row[]
      return rows.map((r) => ({
        memoryId: str(r.id),
        activation: num(r.base_level_activation),
        strength: num(r.strength, 0.5),
        type: str(r.type, 'unknown'),
      }))
    },

    goals(limit: number): readonly GoalNode[] {
      const rows = db
        .prepare(
          `SELECT id, parent_id, title, status, priority
             FROM goals
            ORDER BY priority DESC, created_at ASC
            LIMIT ?`,
        )
        .all(limit) as Row[]
      return flattenGoals(rows, limit)
    },

    timeline(limit: number): readonly TraceItem[] {
      const rows = db
        .prepare(
          `SELECT seq, event_type, timestamp, session_id, turn_id
             FROM mana_trace
            ORDER BY seq DESC
            LIMIT ?`,
        )
        .all(limit) as Row[]
      return rows.map((r) => ({
        seq: num(r.seq),
        eventType: str(r.event_type),
        at: str(r.timestamp),
        sessionId: str(r.session_id),
        turnId: num(r.turn_id),
      }))
    },

    /**
     * 审计回放的原料：`mana_trace` 按 `seq` **升序**读。`fromSeq` 左闭下界；
     * `sessionId === null` = 不限会话（**不是**「匹配空串」—— 那会把无会话的行丢掉）。
     *
     * ⚠ 只读：本方法不写任何表。回放的写回形态（状态回放）**在本包无入口**（G10）。
     */
    traceRows(limit: number, fromSeq: number, sessionId: string | null): readonly TraceRow[] {
      const base =
        `SELECT seq, event_type, payload, session_id, turn_id, timestamp
           FROM mana_trace
          WHERE seq >= ?`
      const rows = (
        sessionId === null
          ? db.prepare(`${base} ORDER BY seq ASC LIMIT ?`).all(fromSeq, limit)
          : db.prepare(`${base} AND session_id = ? ORDER BY seq ASC LIMIT ?`).all(fromSeq, sessionId, limit)
      ) as Row[]
      return rows.map((r) => ({
        seq: num(r.seq),
        eventType: str(r.event_type),
        payload: str(r.payload),
        sessionId: str(r.session_id),
        turnId: num(r.turn_id),
        at: str(r.timestamp),
      }))
    },

    writeRender(entry): number {
      // R5 落点：`event_type` 固定为 ui/render，payload 是无损 JSON。
      const stmt = db.prepare(
        'INSERT INTO mana_trace (event_type, payload, session_id, turn_id, timestamp) VALUES (?, ?, ?, ?, ?)',
      )
      const info = stmt.run(
        'ui/render',
        JSON.stringify({ panel: entry.panel, rendered: entry.rendered }),
        entry.sessionId,
        entry.turnId,
        entry.at,
      )
      return Number(info.lastInsertRowid)
    },

    /**
     * 「模型通道」偏好读侧：`user_model` 的单键（键名见 `panel.ts` 的
     * `CHANNEL_PREFERENCE_KEY` —— **不在本文件重写一遍字面量**，免得两处漂移）。
     *
     * ⚠ 语义：**键不存在** ⇒ `null`（=「用户没设过」，消费侧据此走缺省 cloud）；
     *   **值为空串** ⇒ 也归 `null`（空串不是合法通道，且它与"有值"不同义）。
     *   这两种态在本文件里**同形**是有意的（都不是用户的有效设置），但"存了非法值"
     *   那一种**不在这里吞掉** —— 它由 `panel.ts` 的 `resolveChannel` 判成
     *   `invalid-fallback` 并把原值回显。
     */
    readChannel(): string | null {
      const row = db.prepare('SELECT value FROM user_model WHERE key = ?').get(CHANNEL_PREFERENCE_KEY) as
        | { value?: unknown }
        | undefined
      const value = row?.value
      return typeof value === 'string' && value.trim() !== '' ? value : null
    },

    /**
     * 「模型通道」偏好写侧。
     *
     * ⚠ **本适配器自己不发 INSERT**：它与面板的其它面一样**只读已冻结的表**，
     *   写偏好的唯一合法入口是 core 的 `UserModelWriter`（`index.ts` 注入的
     *   `core.updateUserModel`），它把主表覆盖与历史行绑在同一事务里。
     *   若此处自造 INSERT，就出现**第二个写入者**：core 那条入口要么变死代码、
     *   要么两处语义漂移（一处有历史、一处没有）—— 正是本仓点名的拆东墙补西墙。
     *   ⇒ 端口上的这个方法由入口在装配时**绑定**到 core 的写入口（见 `index.ts`）。
     */
    writeChannel(value: string): void {
      if (writeUserModel === undefined) {
        throw new Error('ui: 偏好写入口未注入（装配面缺 core.updateUserModel）')
      }
      writeUserModel(CHANNEL_PREFERENCE_KEY, value)
    },
  }
}
