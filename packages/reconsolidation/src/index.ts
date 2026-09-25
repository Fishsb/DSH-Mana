/**
 * `dsh-mana-reconsolidation` —— Mana **再巩固链条**（v10 §15 / 落地册 L-02）。
 *
 * ── 链条（逐段有落点，不留"声明了但没实现"的段）──────────────────────────────────────────
 *   「记忆被检索并注入上下文 → **去稳定化窗口**开启 → 新信息检测 → 内容更新 → **重新稳定化**」
 *   · ① 窗口参数    `params.ts`    —— 情景 30min / 语义 2h / 程序性 6h / 情绪 1h（A 档常量）
 *   · ② 开/关窗口   `windows.ts`   —— `openWindow(until = now + windowMs(type))` / `closeDueWindows`
 *   · ③ 内容更新    `updates.ts`   —— 追加 `update_history`（**不是覆盖**）+ 回读取证
 *   · ④ 列存在性    `columns.ts`   —— `columnsPresent()` 三态探测（L-00 的前置依赖面）
 *   · ⑤ 留痕        `trace.ts`     —— **本包自有命名空间**，不冒充 S1 五类
 *
 * ── ⚠ 本包**当前必然走降级路径**（如实交代，不掩饰）───────────────────────────────────────
 *   `packages/core/src/schema.ts` 的 `memory_items` 实测**只有 26 列**，
 *   `reconsolidation_window_until` 与 `update_history` **grep 命中 = 0**（v10 §36 的 12 列一个都没有）。
 *   ⇒ 在 **L-00 契约补列**执行之前，`openWindow` / `applyContentUpdate` / `closeDueWindows`
 *     在本仓真库上**一律返回 `degraded:true` + 非空 reason `schema-missing:...` + 一条留痕**，
 *     并**不写库**。这不是"本包没做"，而是本包对"列不在"的**显式三态**：
 *     静默空转与崩溃都被排除，且**排除了这件事本身可机检**（`tests/degraded.test.mjs`）。
 *   ⚠ 本包**不动 schema**：`packages/core` 是契约真源（契约席独占写面），
 *     补列由 L-00 批次走契约变更协议完成；本包只探测、只回报。
 *
 * ── 明确不做（落地册 L-02 的边界，逐条引自原文）─────────────────────────────────────────
 *   ⛔ **不实现「提取诱发遗忘」**（v10 §14.8/§15.1 的 `suppression = sim·0.4 + target·0.3 + competitor·0.3`）：
 *      该式三个系数**无任何实测基线**，写进判据即「以未超标放过」。若要做，须先回答"系数从哪来"。
 *   ⛔ 不改 `memory_items` **已有列**的语义（本包只写自己那两列）。
 *   ⛔ 不注册定时器（"到点关闭"由 `closeDueWindows(now)` 的幂等读改完成 —— 定时器会让
 *      "关窗"依赖进程存活，进程一死窗口永远开着且无人知晓）。
 *
 * ── 与既有包的边界（凭什么确认没碰坏别处）───────────────────────────────────────────────
 *   · 写表：只写 `memory_items` 的 `content` / `summary` / `reconsolidation_window_until` /
 *     `update_history`，以及 `mana_trace`（经 core 的 `writeTrace` **唯一写口**）。
 *     `retired`/`strength`/ACT-R 各列**一个都不碰**（它们分别是 long-term / forgetting 的面）。
 *   · `inject_log` 的 5 类 gate（含 `reset`）**不是**本包的表：`closeDueWindows` 是**新表写者**，
 *     与 `reset` 的区别已写在 `windows.ts` 的文件头。本包不写 `inject_log`。
 *   · 监听器：只走 core 的 `registerPassThroughPreStep`（G9 的结构约束），不新增业务监听器。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import { MEMORY_TYPES, WINDOW_MS_BY_TYPE, WINDOW_SECONDS_BY_TYPE, type MemoryType } from './params.ts'
import { REQUIRED_COLUMNS, SCHEMA_MISSING_PREFIX, columnsPresent, missingColumnsReason } from './columns.ts'
import { OWNED_TRACE_EVENTS, OWNED_TRACE_PREFIX, S1_STAGE_TAGS, TRACE_EVENTS, isOwnedTraceEvent } from './trace.ts'
import { isMemoryType, isoAt, windowMs, windowOpen, windowUntil, type WindowReading } from './window.ts'
import {
  UPDATE_HISTORY_KEEP,
  appendUpdateEntry,
  historyCount,
  parseUpdateHistory,
  type UpdateAppendResult,
  type UpdateEntry,
} from './history.ts'
import { applyContentUpdate, type ContentUpdateRequest, type ContentUpdateResult } from './updates.ts'
import {
  closeDueWindows,
  isWindowOpen,
  openWindow,
  readWindowUntil,
  type CloseRequest,
  type CloseResult,
  type WindowRequest,
  type WindowResult,
} from './windows.ts'

export const name = 'mana-reconsolidation'

/** 依赖 core（契约唯一归属地）。`inject_log` 的 5 类 gate 不在本包，故不 inject 别包。 */
export const inject: string[] = ['mana-core']

/**
 * 本包的**实现面**（导出名的机检清单）。
 *
 * ⚠ 它是一等判据面，不是文档（口径抄 `forgetting/src/index.ts:122` 的 `IMPLEMENTED_EXPORTS`）：
 *   `tests/reconsolidation.test.mjs` 判据⑩ 与判据侧**独立写一遍**的清单断言**集合相等**
 *   ⇒ 加了实现只改一边即红；把实现搬走即红。
 */
export const IMPLEMENTED_EXPORTS = [
  'windowMs',
  'windowUntil',
  'isMemoryType',
  'windowOpen',
  'isoAt',
  'columnsPresent',
  'missingColumnsReason',
  'isOwnedTraceEvent',
  'parseUpdateHistory',
  'appendUpdateEntry',
  'historyCount',
  'openWindow',
  'closeDueWindows',
  'readWindowUntil',
  'isWindowOpen',
  'applyContentUpdate',
] as const

/**
 * 本包是否**真的能开窗**（列在不在）—— 装配期读数，供 `status()` 如实回报。
 *
 * ⚠ 这里**刻意不缓存**：探测很便宜（一次 `PRAGMA`），而缓存会让"L-00 补列之后本包仍报降级"
 *   （常驻 profile 不重启就不会刷新）。判据与调用方都要的是**当下事实**。
 */
export function columnsAvailable(core: ManaCoreService): boolean {
  return columnsPresent(core.db as unknown as { prepare(sql: string): { all(...p: unknown[]): unknown[] } }).ok
}

export interface ReconsolidationStatus {
  /** 固定为 `'active'`：本包有实现面（由判据① 与实现面清单共同背书）。 */
  behavior: 'active'
  /** 服务是否挂上（`ctx.get('mana-reconsolidation')` 可读即 true）。 */
  wired: boolean
  /** 两列是否都在（**当下探测**，不是启动时快照）。 */
  columnsReady: boolean
  /** 缺的列（空数组 = 齐）。 */
  missingColumns: string[]
  /** 降级原因（列齐时为 `null`）。 */
  reason: string | null
  /** 本包依赖的列清单（判据可对拍）。 */
  requiredColumns: string[]
  /** 四类窗口（毫秒）；判据① 的取数面。 */
  windowMs: Record<MemoryType, number>
  /** 四类窗口（秒）；与毫秒同源派生。 */
  windowSeconds: Record<MemoryType, number>
  /** 本包写入 `mana_trace` 的**全部**标签（判据④ 的靶子）。 */
  ownedTraceEvents: string[]
  ownedTracePrefix: string
  /** 提示：L-00 未执行时本包在真库上只能走降级路径（**不是**"本包没实现"）。 */
  pendingContractBatch: 'L-00'
}

export interface ReconsolidationService {
  status(): ReconsolidationStatus
  /** 列存在性三态探测（当下读回）。 */
  columnsPresent(): ReturnType<typeof columnsPresent>
  /** 开窗：`until = now + windowMs(type)`。 */
  openWindow(req: WindowRequest): WindowResult
  /** 关窗（重新稳定化）：把 `until <= now` 的窗口清零。 */
  closeDueWindows(req: CloseRequest): CloseResult
  /** 内容更新（追加 `update_history`）。 */
  applyContentUpdate(req: ContentUpdateRequest): ContentUpdateResult
  /** 窗口参数纯函数（本包自用，同时是判据① 的复算入口）。 */
  windowMs(type: string): number
  windowUntil(now: number, type: string): number
  isWindowOpen(memoryId: string, now: number): boolean
  /** `update_history` 原始列 → 数组（解析失败**抛**，不回落成空）。 */
  parseUpdateHistory(raw: unknown): UpdateEntry[]
  historyCount(raw: unknown): number
}

export function buildService(core: ManaCoreService): ReconsolidationService {
  return {
    status(): ReconsolidationStatus {
      const probe = columnsPresent(core.db as unknown as { prepare(sql: string): { all(...p: unknown[]): unknown[] } })
      return {
        behavior: 'active',
        wired: true,
        columnsReady: probe.ok,
        missingColumns: probe.missing,
        reason: probe.ok ? null : missingColumnsReason(probe.missing),
        requiredColumns: [...REQUIRED_COLUMNS],
        windowMs: { ...WINDOW_MS_BY_TYPE },
        windowSeconds: { ...WINDOW_SECONDS_BY_TYPE },
        ownedTraceEvents: [...OWNED_TRACE_EVENTS],
        ownedTracePrefix: OWNED_TRACE_PREFIX,
        pendingContractBatch: 'L-00',
      }
    },
    columnsPresent: () =>
      columnsPresent(core.db as unknown as { prepare(sql: string): { all(...p: unknown[]): unknown[] } }),
    openWindow: (req) => openWindow(core, req),
    closeDueWindows: (req) => closeDueWindows(core, req),
    applyContentUpdate: (req) => applyContentUpdate(core, req),
    windowMs,
    windowUntil,
    isWindowOpen: (memoryId, now) => isWindowOpen(core, memoryId, now),
    parseUpdateHistory,
    historyCount,
  }
}

/** 纯函数面（不依赖 core）—— 判据① 的复算入口，装配与否都可直接用。 */
export const pure = Object.freeze({
  windowMs,
  windowUntil,
  windowOpen,
  isoAt,
  isMemoryType,
  appendUpdateEntry,
  parseUpdateHistory,
  historyCount,
  columnsPresent,
  missingColumnsReason,
  isOwnedTraceEvent,
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 再巩固服务（由 `dsh-mana-reconsolidation` 提供）。 */
    'mana-reconsolidation': ReconsolidationService
  }
}

/** 插件主体。 */
export function apply(ctx: Context): void {
  const core = ctx.get('mana-core') as ManaCoreService | undefined
  if (!core) {
    // 依赖缺失必须**显式**（G11：装配清单 ≠ 生效，空壳与真插件同形）。不静默 return。
    throw new Error('dsh-mana-reconsolidation 需要 mana-core 服务：请确保 dsh-mana-core 在其之前装配')
  }

  const service = buildService(core)
  ctx.effect(() => ctx.provide('mana-reconsolidation', service), 'dsh-mana-reconsolidation: service')

  // G9 / 册:318：apply 必须注册一条 waterfall 监听器并调 next()。
  registerPassThroughPreStep(ctx, name)

  // ⚠ 本包**不**在装配期写 trace：装配期没有任何"窗口/更新/降级"事件可比
  //   （写一条"插件已加载"会让 trace 表里出现与认知无关的行 —— 那正是 S1 五类计数被污染的前身）。
  //   降级留痕发生在**调用时**（openWindow/applyContentUpdate/closeDueWindows），每条都带真实上下文。
}

export type { MemoryType, WindowReading, UpdateEntry, UpdateAppendResult, WindowRequest, WindowResult, CloseRequest, CloseResult, ContentUpdateRequest, ContentUpdateResult }
export {
  MEMORY_TYPES,
  WINDOW_MS_BY_TYPE,
  WINDOW_SECONDS_BY_TYPE,
  REQUIRED_COLUMNS,
  SCHEMA_MISSING_PREFIX,
  OWNED_TRACE_EVENTS,
  OWNED_TRACE_PREFIX,
  S1_STAGE_TAGS,
  TRACE_EVENTS,
  UPDATE_HISTORY_KEEP,
  columnsPresent,
  missingColumnsReason,
  isOwnedTraceEvent,
  windowMs,
  windowUntil,
  windowOpen,
  isoAt,
  isMemoryType,
  parseUpdateHistory,
  appendUpdateEntry,
  historyCount,
  openWindow,
  closeDueWindows,
  readWindowUntil,
  isWindowOpen,
  applyContentUpdate,
}
