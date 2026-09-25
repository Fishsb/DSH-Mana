/**
 * **内容更新的可追溯记录**（`memory_items.update_history` 的读写侧）。
 *
 * ── 为什么是"追加数组"而不是"覆盖字段"（本模块存在的全部理由）─────────────────────────
 *   判据③：**连续两次内容更新 ⇒ `update_history` 新增两段**（不是只剩最后一段）。
 *   若实现写成"把最新一次写进字段"，两次更新后**只剩一段**——而它**不报错**、
 *   字段也非空 ⇒ 「更新可追溯」在数据上根本不存在，且失败不可观测。
 *   ⇒ 故本模块把"读旧 → 追加 → 序列化"绑成一个纯函数 `appendUpdateEntry`：
 *     调用方无法"只写最后一段"，因为入口本身不提供那条路径。
 *
 * ⚠ 与 `user_model_history` 的取舍（如实记，不掩饰）：
 *   本仓对 `user_model` 采用的是**独立历史表**（每行一次变更）。`update_history` 是
 *   **列**，装的是 JSON 数组 —— 于是它有**增长无界**的隐患。本包不回避它：
 *   `pruneUpdateHistory` 提供显式上限（`UPDATE_HISTORY_KEEP`），且**不许静默裁剪**：
 *   被裁掉多少由 `UpdateAppendResult.dropped` 精确回报（0 也要报 0）。
 *   ⚠ 该上限是**本包自定**，不是判据表里的数字（判据表没给）—— 故它只影响长跑形态，
 *     不影响判据③（判据只连续更新两次，远在 20 段以内）。
 */

/** 一段内容更新记录。 */
export interface UpdateEntry {
  /** 更新前的值（第一次更新时为当时的库内值）。 */
  previous: string | null
  /** 更新后的值。 */
  next: string
  /** 更新时刻（ISO）。 */
  at: string
  /** 归因（本次窗口由哪次检索打开）；未提供时显式为 `null`（不得靠缺键表示"没有"）。 */
  trigger: string | null
}

/** 保留段数上限（本包自定；见文件头"增长无界"那条）。 */
export const UPDATE_HISTORY_KEEP = 20

/**
 * 把列里的原始文本读成数组。
 *
 * ⚠ **解析失败 ≠ 没有历史**（本仓最防的形态：把"读不到"读成"本来就没有"）：
 *   非法 JSON / 不是数组 / 元素不是对象 —— 三种都**抛**，不回落成 `[]`。
 *   回落的后果是：下一次追加会把整段历史**覆盖掉**，而调用方以为"只是第一次更新"。
 */
export function parseUpdateHistory(raw: unknown): UpdateEntry[] {
  if (raw === null || raw === undefined || raw === '') return []
  if (typeof raw !== 'string') throw new TypeError(`update_history 列应为 TEXT，实测 ${typeof raw}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new SyntaxError(`update_history 不是合法 JSON（拒绝静默丢弃已有历史）：${(error as Error).message}`)
  }
  if (!Array.isArray(parsed)) throw new TypeError('update_history 必须是 JSON 数组（拒绝静默丢弃：非数组形态无法追加）')
  return parsed.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`update_history[${i}] 不是对象`)
    }
    const o = item as Record<string, unknown>
    if (typeof o.next !== 'string' || typeof o.at !== 'string') {
      throw new TypeError(`update_history[${i}] 缺 next/at 字符串字段`)
    }
    return {
      previous: typeof o.previous === 'string' || o.previous === null ? (o.previous as string | null) : null,
      next: o.next,
      at: o.at,
      trigger: typeof o.trigger === 'string' ? o.trigger : null,
    }
  })
}

/** 追加结果：**新增了几段、丢了几段**都要报（0 也报 0，不许省略）。 */
export interface UpdateAppendResult {
  history: UpdateEntry[]
  /** 序列化后的列值（写库用的就是它）。 */
  json: string
  /** 本次新增段数（判据③ 的取数面）。 */
  appended: number
  /** 因超过 `keep` 被裁掉的段数（正常态恒为 0）。 */
  dropped: number
  /** 追加**后**的总段数。 */
  total: number
}

/**
 * 读旧 → 追加 → 序列化（纯函数，不碰库）。
 *
 * `appended` 恒为 1：本函数**只**提供追加这一条路径 —— 覆盖写在这里写不出来。
 */
export function appendUpdateEntry(
  raw: unknown,
  entry: UpdateEntry,
  keep: number = UPDATE_HISTORY_KEEP,
): UpdateAppendResult {
  const before = parseUpdateHistory(raw)
  const after = [...before, entry]
  const limit = Math.max(1, Math.floor(keep))
  const dropped = Math.max(0, after.length - limit)
  const history = dropped > 0 ? after.slice(dropped) : after
  return { history, json: JSON.stringify(history), appended: 1, dropped, total: history.length }
}

/** 历史段数（`update_history` 不可用时由调用方给 `null`，**不得以 0 冒充**）。 */
export function historyCount(raw: unknown): number {
  return parseUpdateHistory(raw).length
}
