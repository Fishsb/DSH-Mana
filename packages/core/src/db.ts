/**
 * 存储开库器 —— **扩展加载窗口的唯一写点**。
 *
 * 三条实证语义（本仓 2026-09-24 复验，非照抄文档）：
 *
 * 1. **`{ allowExtension: true }` 必须写在构造器里**（G4）。本仓实测：
 *    - 全新库 `new DatabaseSync(p)` 后 `enableLoadExtension(true)` →
 *      `Cannot enable extension loading because it was disabled at database creation.`
 *    - `new DatabaseSync(p, { allowExtension: true })` 后同调用 → 不抛错。
 *    ⇒ 事后补救**不可行**，只能删库重建。
 * 2. **`PRAGMA journal_mode=WAL` 的读回必须走 `prepare().get()`**：`exec()` 返回
 *    `undefined`（本仓实测），拿它判 WAL 是否生效会得到恒假。
 * 3. **`busy_timeout` 默认是 0**（本仓实测：全新库 `PRAGMA busy_timeout` =
 *    `{"timeout":0}`）⇒ 并发写立即 `database is locked`；且 `db.transaction` 与
 *    `db.pragma` 均为 `undefined`（本仓实测），**事务必须手写** `BEGIN IMMEDIATE`。
 *    另实测：事务内 SQL 报错**不自动回滚**（计数仍为 1）⇒ 必须显式 `ROLLBACK`。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSchema, SCHEMA_VERSION } from './schema.ts'

/** 开库选项。 */
export interface OpenManaDbOptions {
  /** 库文件路径（`$DSH_HOME/memory/mana.db`）。传 `':memory:'` 用于测试。 */
  path: string
  /** 并发写等待毫秒数。默认 5000（默认值 0 会立即失败，见文件头第 3 条）。 */
  busyTimeoutMs?: number
  /** 是否建表。默认 true。 */
  migrate?: boolean
}

/** 开库结果：库句柄与本次实际生效的 pragma 读数（供判据取证，不靠"应该是"。 */
export interface ManaDb {
  db: DatabaseSync
  path: string
  /**
   * `PRAGMA journal_mode` 实测读回值。
   *
   * ⚠ **判据陷阱（本仓 2026-09-24 实测）**：`:memory:` 库读回的是 `'memory'`，
   * **不是 `'wal'`** —— WAL 对内存库无意义。若判据无差别地断言 `journal_mode=wal`，
   * 内存库测试会**假红**（把「WAL 没生效」与「内存库本就没有 WAL」混为一谈）。
   * 正确写法：仅对**文件库**断言 `wal`；内存库断言 `memory`。见 `walApplied()`。
   */
  journalMode: string
  /** `PRAGMA busy_timeout` 实测读回值（期望等于 busyTimeoutMs）。 */
  busyTimeoutMs: number
  /** 扩展加载窗口是否在开库时开启（恒 true，除非有人改了本文件）。 */
  extensionWindowOpen: boolean
  schemaVersion: string
  /**
   * 本次开库**实际补上的列**（正常态 = 空数组）。
   *
   * ⚠ 存在的理由：`createSchema` 对存量库补列如果失败/漏做，旧实现**不报错也不返回**
   *   ⇒ 「无需补列」与「补列没生效」表面同形。把这个值暴露出来，判据才可断言。
   */
  appliedColumns: { table: string; column: string }[]
  close(): void
}

/**
 * 以 Mana 契约口径开库：`{ allowExtension: true }` + WAL + busy_timeout + 建表。
 *
 * ⚠ 本函数是**唯一**允许构造 `DatabaseSync` 的入口（含测试）—— 这样 G4 的
 *   「不可后补」约束只有一个写点，不会在某个插件里被绕开。
 */
export function openManaDb(options: OpenManaDbOptions): ManaDb {
  const { path, busyTimeoutMs = 5000, migrate = true } = options
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path, { allowExtension: true })

  // WAL：读回必须走 prepare().get()（exec 返回 undefined）。
  const wal = db.prepare('PRAGMA journal_mode=WAL').get() as { journal_mode?: string } | undefined
  const journalMode = String(wal?.journal_mode ?? '')

  db.exec(`PRAGMA busy_timeout=${Number(busyTimeoutMs)}`)
  const bt = db.prepare('PRAGMA busy_timeout').get() as { timeout?: number } | undefined

  const schema = migrate ? createSchema(db) : null

  return {
    db,
    path,
    journalMode,
    busyTimeoutMs: Number(bt?.timeout ?? -1),
    extensionWindowOpen: true,
    schemaVersion: SCHEMA_VERSION,
    appliedColumns: (schema?.applied ?? []).map((a) => ({ table: a.table, column: a.column })),
    close: () => db.close(),
  }
}

/**
 * 手写 `BEGIN IMMEDIATE` 事务（G7）：`db.transaction` 在本机是 `undefined`，
 * 且事务内报错**不自动回滚** ⇒ 这里统一 catch → `ROLLBACK` → 抛出。
 */
export async function withImmediateTransaction<T>(
  db: DatabaseSync,
  fn: () => Promise<T> | T,
): Promise<T> {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = await fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 回滚失败不掩盖原始错误：原始错误优先抛出（回滚失败本身会被上层看到连接已废）。
    }
    throw error
  }
}

/**
 * `vec_version()` 探针（G4 的正面取证）—— **可枚举归因版**（G8 收口）。
 *
 * 本项目阶段 2 走「物化 BLOB + 纯 JS 余弦」，vec0 是规模化升级项（§8 C4）⇒ 阶段 0
 * 不装扩展。本探针的作用是**让「没装」成为一个可读到的确定事实**。
 *
 * ── ⚠ 为什么本函数在 2026-09-26 被改（本仓注释自己点名过的 G8 先例）─────────────
 *   旧写法是 try/catch 后 `return null` —— 本文件原 118-124 行的注释**自称**它已经
 *   不是「静默降级先例」，而实现恰恰就是那个先例：**四类完全不同的失败**被折成同一个 `null`：
 *     · 扩展未装载（合规常态，边界③ 禁装）；
 *     · 库句柄已关闭 / 不可用（**程序错误**，不是「没装」）；
 *     · `prepare` 阶段解析失败（如库被换成另一实现的句柄）；
 *     · 别的原因（权限、内存、扩展装载到一半）。
 *   后果**不是「少了个字段」，是让另一类缺陷不可观测**：`ManaDb.vecVersion()` 有真消费者
 *   （`packages/core/src/index.ts:395` 的服务面），而 `tools/probes/vec0-semantics.mjs:52-61`
 *   的 HANG 判据**也**以「扩展文件不存在」为唯一依据 —— 一旦某天库句柄坏了，
 *   两个探测面都会报「未装扩展」，而真相是「探测根本没跑成」。
 *
 * ── 处置（三条红线下的最小改法）──────────────────────────────────────────────
 *   ⛔ **不改返回形态**：本函数仍返回 `string | null`（`packages/core` 被 16 包 import，
 *      改签名会波及全部消费者）。归因走**第二条通道** `probeVecVersionDetail()`。
 *   ⛔ **不装扩展**（边界③）：归因只描述失败类别，**不试图让失败消失**。
 *   ⛔ **不把 HANG 变成假 PASS**：`null` 的语义**不变**（= 拿不到版本号）；
 *      归因只回答「**为什么**拿不到」，不回答「扩展语义对不对」。
 *      「未装」与「装了且语义对」依然由 `tools/probes/vec0-semantics.mjs` 判，本函数不越权。
 */
export type VecProbeFailure = 'not-installed' | 'resource-closed' | 'probe-error' | 'empty-result'

/** 探针的**完整读数**（归因 + 取证）。`version` 为 `null` 时 `failure` 必定非空。 */
export interface VecProbeReading {
  /** 版本号；拿不到即 `null`（**与 `probeVecVersion()` 逐字同值**）。 */
  readonly version: string | null
  /**
   * 失败类别；成功时为 `null`。
   * ⚠ `not-installed` 只由 SQLite 的 `no such function: vec_version` 推出 ——
   *   **不**由「库句柄打开失败」等别的原因冒充（见下面的归类顺序）。
   */
  readonly failure: VecProbeFailure | null
  /** 人类可读原因（含**原始错误 message**，便于归因；成功时为空串）。 */
  readonly reason: string
  /** 原始错误的 code（node:sqlite 的形状：ERR_SQLITE_ERROR / ERR_INVALID_STATE …）；成功时 null。 */
  readonly errorCode: string | null
}

/**
 * 判一条错误是否等价于「**当前连接上没有给定函数**」。
 *
 * ⚠ 只认 SQLite 的原文 `no such function: <name>`：这是「扩展没装载」在本连接上的
 *   **唯一确证**；其余错误（库已关、权限、装载半途）**不得**被归到这一类 ——
 *   那正是旧实现把一切折成 `null` 的错法。
 */
export function isNoSuchFunctionError(error: unknown, fnName = 'vec_version'): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return new RegExp('^no such function:\\s*' + fnName + '\\s*$', 'i').test(message.trim())
}

/**
 * 完整探针读数（归因版）。**不改 `probeVecVersion` 的返回形态**，两者共用同一段求值。
 *
 * 归类顺序（**顺序是正确性的一部分**）：
 *   ① 库句柄不可用（关闭的库上 prepare/get 抛 ERR_INVALID_STATE）⇒ `resource-closed`；
 *   ② 函数不存在 ⇒ `not-installed`（**只有这一条能叫「未装」**）；
 *   ③ 其余异常 ⇒ `probe-error` + 原文；
 *   ④ 没抛但拿不到值 ⇒ `empty-result`（「查了但没值」与「没查成」必须可分辨）。
 */
export function probeVecVersionDetail(db: DatabaseSync): VecProbeReading {
  try {
    const row = db.prepare('select vec_version() as v').get() as { v?: unknown } | undefined
    const v = row?.v
    if (v == null) {
      return { version: null, failure: 'empty-result', reason: 'vec_version() 返回空值（查了但没值）', errorCode: null }
    }
    return { version: String(v), failure: null, reason: '', errorCode: null }
  } catch (error) {
    const code =
      typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code?: string }).code) : null
    const message = error instanceof Error ? error.message : String(error)
    if (isNoSuchFunctionError(error)) {
      return { version: null, failure: 'not-installed', reason: message, errorCode: code }
    }
    if (code === 'ERR_INVALID_STATE') {
      return { version: null, failure: 'resource-closed', reason: message, errorCode: code }
    }
    return { version: null, failure: 'probe-error', reason: message, errorCode: code }
  }
}

/**
 * `vec_version()` 探针 —— **签名与返回形态保持不变**（`string | null`）。
 *
 * ⚠ 语义**逐字不变**：`null` = 拿不到版本号。归因请用 `probeVecVersionDetail()`。
 *   保留本函数是为了 `packages/core/src/index.ts:395` 的服务面与全部既有消费者零改动。
 */
export function probeVecVersion(db: DatabaseSync): string | null {
  return probeVecVersionDetail(db).version
}

/**
 * WAL 是否按预期生效 —— **区分文件库与内存库**，避免假红。
 *
 * | 库类型 | 期望 journalMode | 为什么 |
 * |---|---|---|
 * | 文件库 | `'wal'` | WAL 已生效（B1.0 判据的目标态） |
 * | `:memory:` | `'memory'` | WAL 对内存库无意义，读回 `memory` **是正确的**，不是失败 |
 */
export function walApplied(journalMode: string, path: string): boolean {
  return path === ':memory:' ? journalMode === 'memory' : journalMode === 'wal'
}
