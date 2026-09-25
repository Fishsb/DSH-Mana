/**
 * jev_log 的**唯一生产写者**（INSERT 列清单 + gate 归因规则）。
 *
 * ── 为什么单开一个文件（而不是继续放在 `ollama.ts` 里）────────────────────────
 * 本仓 2026-09-25 实测的缺陷：`writeJevLog` 的 INSERT 列清单里**没有 gate**，
 * 而 A1-8（`docs/mana-rollout-plan.md:458`）要求「Write → `gate in (unavailable,budget)`
 * 且行仍写入」。于是 `A1-8` 的绿只能推出「列存在 + CHECK 约束存在」，
 * **推不出「运行态可归因」** —— 测试自己直写 gate 塞进库，判据看到的是夹具不是生产路径。
 *
 * 把「列清单」与「写口」抽到这里有两个作用：
 *  ① 生产写入面**只有一份**（`writeJevLog` 与任何查询都要经它），列清单不会漂移；
 *  ② 判据可以**对生产 SQL 本体做负向注入**（把 gate 从列清单里去掉 ⇒ 真降级不再落 gate
 *     ⇒ 测试必须红）。没有这个可注入点，「gate 真被生产路径写入」这件事无法自证。
 *
 * ── 归因规则（判据原文口径）──────────────────────────────────────────────────
 * `gate in ('unavailable','budget')` 只有两个取值 ⇒ 必须与`降级原因`一一对上，
 * 且**必须可枚举**（判据不得靠"看着像降级"这类判断）：
 *
 * | 降级集 | gate | 语义 |
 * |---|---|---|
 * | 护栏拒绝：`jev-session-budget-exceeded` | `'budget'` | 预算/成本闸用尽 |
 * | 护栏拒绝：`jev-circuit-open` / `-probe-in-flight` | `'unavailable'` | 判定通道暂不可用 |
 * | 护栏拒绝：`jev-concurrency-timeout` | `'unavailable'` | 同上（等不到并发槽） |
 * | 通道降级：`ollama-*` / `systemone-*` | `'unavailable'` | 通道不可用 |
 * | 任何 `degraded:true` 但 reason **为空/认不出** | `'unavailable'` | 见下（构造性兜底） |
 * | 非降级 | `null` | 正常路径**显式 null**（下面 ③） |
 *
 * ⚠ ③ **不可用与零值必须可分辨**（本仓纪律）：非降级路径的 gate 是 `null` 而不是空串
 *   或 `'injected'` 之类的占位值 —— 「无门控失败」与「有门控失败但被记成正常」是两件事。
 *
 * ⚠ 兜底那条（reason 为空/认不出 ⇒ `'unavailable'`）是**构造性**的：契约（`JevJudgeOutcome.reason`）
 *   已规定「`degraded:true` 时 reason 必须是非空字符串」，所以认不出的情况只能是契约被破坏。
 *   那时**宁可把它记成"不可用"也不能留 null** —— 留 null 会让降级在审计里与正常同形，
 *   正是 A1-14「沉默 vs fail-closed 不可分辨」要防的形态。
 */
import type { DatabaseSync } from 'node:sqlite'

/** `jev_log.gate` 的**词表**（判据原文：gate in (unavailable,budget)）。 */
export const JEV_GATE_VOCAB = ['unavailable', 'budget'] as const

/** 单个 gate 取值。 */
export type JevGate = (typeof JEV_GATE_VOCAB)[number]

/** 该值是否落在词表内（消费侧/判据侧共用，避免两处各写一份枚举）。 */
export function isJevGate(value: unknown): value is JevGate {
  return typeof value === 'string' && (JEV_GATE_VOCAB as readonly string[]).includes(value)
}

/**
 * 预算/成本闸用尽的 reason（`framework.ts` 的 `JEV_GUARD_REASONS.sessionBudgetExceeded`）。
 *
 * ⚠ 这里写**字面量**而不是 import 常量：本模块要被 `ollama.ts` 依赖，
 *   而 `framework.ts` 依赖 `ollama.ts` ⇒ import 会成环。字面量的漂移由判据钉住
 *   （`framework.test.mjs` 断言 reason 取值 + 本文件的归因表逐条断言）。
 */
const BUDGET_REASONS = new Set(['jev-session-budget-exceeded'])

/**
 * 由一条判定结果推出 `jev_log.gate` 的值。**纯函数**（判据可逐例断言，无需库）。
 *
 * @returns `null` = 非降级（正常路径）；否则为词表内的枚举值。
 */
export function jevGateOf(o: { degraded?: boolean; reason?: string | null }): JevGate | null {
  if (!o?.degraded) return null
  const reason = typeof o.reason === 'string' ? o.reason : ''
  for (const b of BUDGET_REASONS) if (reason.startsWith(b)) return 'budget'
  // 其余降级（通道不可用 / 熔断 / 并发超时 / reason 认不出）一律归 'unavailable'。
  return 'unavailable'
}

/**
 * 拼一条 `jev_log` 插入语句（列名显式，不依赖表列顺序）。
 *
 * ⚠ **本函数是唯一真源**：列清单在这里、值在 `writeJevLog` 按同一顺序给。
 *   两者必须**列数相等**（`jeVLogleColumnCount()` 供判据断言，防"加列忘了加值"）。
 */
export function jevLogInsertSql(): string {
  return [
    'INSERT INTO jev_log',
    '(id, request_type, source, state_hash, result_value, probability, cached,',
    ' degraded, gate, latency_ms, cost_usd, session_id, turn_id, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ].join(' ')
}

/** 列清单的列数（与值个数必须相等；判据用）。 */
export function jevLogColumnCount(): number {
  const sql = jevLogInsertSql()
  const cols = /\(([^)]*)\)/.exec(sql)?.[1] ?? ''
  return cols.split(',').map((s) => s.trim()).filter(Boolean).length
}

/** `writeJevLog` 落一行的取值面（与列清单同序）。 */
export interface JevLogRowValues {
  id: string
  requestType: string
  source: string
  stateHash: string | null
  /** 契约三态值（`yes`/`no`/`unknown`）。 */
  value: string
  /** 概率不可用 ⇒ `null`（**不得用 0 冒充**）。 */
  probability: number | null
  cached: boolean
  degraded: boolean
  /** 门控失败归因；非降级为 `null`。 */
  gate: JevGate | null
  latencyMs: number
  /** 本机 Ollama 无计费 ⇒ `null`（**不得用 0 冒充**）。 */
  costUsd: number | null
  sessionId: string | null
  turnId: number
  atIso: string
}

/** 按列清单顺序展开成位置参数（列数不符时**抛错**，不静默少给）。 */
export function jevLogRowParams(v: JevLogRowValues): (string | number | null)[] {
  const params: (string | number | null)[] = [
    v.id,
    v.requestType,
    v.source,
    v.stateHash,
    v.value,
    v.probability,
    v.cached ? 1 : 0,
    v.degraded ? 1 : 0,
    v.gate,
    v.latencyMs,
    v.costUsd,
    v.sessionId,
    v.turnId,
    v.atIso,
  ]
  const expected = jevLogColumnCount()
  if (params.length !== expected) {
    throw new Error(`jev_log 列数与值数不等：列 ${expected} vs 值 ${params.length}（加列必须同时加值）`)
  }
  return params
}

/** 落一行（唯一写口；库句柄由调用方给）。 */
export function writeJevLogRow(db: DatabaseSync, v: JevLogRowValues): void {
  db.prepare(jevLogInsertSql()).run(...jevLogRowParams(v))
}
