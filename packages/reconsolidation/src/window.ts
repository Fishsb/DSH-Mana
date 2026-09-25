/**
 * **去稳定化窗口**（v10 §15：「记忆被检索并注入上下文 → 去稳定化窗口开启 → …」）。
 *
 * ── 窗口时长是**纯函数**，不是配置、也不是时钟读数 ────────────────────────────────────────
 * `windowMs(type)` 只做「类型 → 毫秒」的查表 + **输入校验**，**不读时钟**：
 *   · 读时钟会让判据「一会儿过一会儿不过」（阈值纪律明令禁止的形态）；
 *   · 窗口的"当前时刻"由**调用方显式传入**（`now`），使
 *     「`until === now + windowMs(type)`」成为**可逐字复算**的等式，而非采样。
 *
 * ⚠ **未知类型必须抛**，不得回落缺省值：回落会让
 *   「类型写错」与「该类型窗口就是缺省那么长」**表面完全同形** ——
 *   而窗口时长是判据①的靶子，静默回落等于把判据的靶子换掉。
 */
import { MEMORY_TYPES, WINDOW_MS_BY_TYPE, type MemoryType } from './params.ts'

/** 类型是否在册（判据与调用方共用，避免各处 `includes` 抄一份）。 */
export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value)
}

/**
 * 取某类记忆的去稳定化窗口时长（毫秒）。
 *
 * @throws 类型不在册时抛 `RangeError`，消息里点名**合法取值**（让调用方一眼可修）。
 */
export function windowMs(type: string): number {
  if (!isMemoryType(type)) {
    throw new RangeError(`未知记忆类型 ${JSON.stringify(type)}；在册类型 = ${MEMORY_TYPES.join(' / ')}`)
  }
  return WINDOW_MS_BY_TYPE[type]
}

/** 窗口结束时刻（毫秒时间戳）—— `until = now + windowMs(type)`，**固定 now**。 */
export function windowUntil(now: number, type: string): number {
  return now + windowMs(type)
}

/** 毫秒 → ISO 串（落库格式，与 core 的 `created_at` 同口径：`toISOString()`）。 */
export function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

/** 窗口读数：三态里"正常态"的那一支 —— 每个字段都可被外部单独断言。 */
export interface WindowReading {
  memoryId: string
  type: string
  /** 开窗时刻（毫秒）；`until - openedAt === windowMs(type)` 恒成立。 */
  openedAt: number
  /** 窗口结束时刻（毫秒）。 */
  until: number
  /** 落库形态（ISO）；与 `until` 同源，避免判据去做两套换算。 */
  untilIso: string
  /** 本次窗长（毫秒）—— 由 `windowMs(type)` 直出，供对拍"改错 1 秒即红"。 */
  windowMsValue: number
  /** 是否真写进了库（带 WHERE id 的回读证据才算 true）。 */
  persisted: boolean
}

/** 窗口是否仍然开着（`now` 由调用方传，不读时钟）。 */
export function windowOpen(until: number | null | undefined, now: number): boolean {
  return typeof until === 'number' && Number.isFinite(until) && until > now
}
