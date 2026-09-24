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
 * `vec_version()` 探针（G4 的正面取证）。
 *
 * 本项目阶段 2 走「物化 BLOB + 纯 JS 余弦」，vec0 是规模化升级项（§8 C4）⇒ 阶段 0
 * 不装扩展。本探针的作用是**让"没装"成为一个可读到的确定事实**，而不是被
 * `catch { return null }` 吞掉（G8 的静默降级先例）。返回 `null` 表示扩展未装载，
 * 由调用方决定报错还是降级 —— 但**必须显式记账**。
 */
export function probeVecVersion(db: DatabaseSync): string | null {
  try {
    const row = db.prepare('select vec_version() as v').get() as { v?: unknown } | undefined
    const v = row?.v
    return v == null ? null : String(v)
  } catch {
    return null
  }
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
