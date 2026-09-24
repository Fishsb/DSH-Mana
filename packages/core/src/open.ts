/**
 * B1.0 · 开库前置（独立成批，因为 **G4 不可后补**）
 *
 *  ① 开库器封装 ② `PRAGMA journal_mode=WAL` ③ `PRAGMA busy_timeout` ④ **定期 backup**
 *
 * ①②③ 的底座在 `db.ts`（阶段 0 已定接口），本文件补 ④ 并把它做成**可判据化**的能力。
 *
 * ── 本仓实测的四条 backup 语义（2026-09-24，非照抄文档）────────────────────
 * | # | 语义 | 实测 | 处置 |
 * |---|---|---|---|
 * | 1 | `backup(db, path)` 返回 **Promise\<number\>**（页数），**不是** void | `await backup(...)` → `2` | 必须 await；拿返回值当页数记账 |
 * | 2 | **WAL 中未 checkpoint 的数据也会进备份** | 源库 500 行全在 2,080,632 B 的 `-wal` 里，备份读回**仍是 500** | 不必先 `wal_checkpoint`；这条若搞错会以为"备份漏数据"而白加一次 checkpoint |
 * | 3 | 备份件的 `journal_mode` 被**继承为 wal** | 备份库读回 `{"journal_mode":"wal"}` | 备份件本身也可直接用 WAL |
 * | 4 | **目标目录不存在 ⇒ 直接失败** | `unable to open database file` | 落盘前必须自建父目录（不建就是**静默的备份缺失**） |
 *
 * ⚠ **本条为什么要独立成批**：`{ allowExtension: true }` 只在开库瞬间有效，事后补救
 *   报 `Cannot enable extension loading because it was disabled at database creation.`
 *   ⇒ 备份/还原若绕开本模块自行 `new DatabaseSync`，会在**还原后**得到一个永远上不了
 *   vec0 的库，且不报错。
 */
import { DatabaseSync, backup } from 'node:sqlite'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { openManaDb, withImmediateTransaction, type ManaDb, type OpenManaDbOptions } from './db.ts'

/** 备份结果（可记账、可断言的实测读数，不是"应该成功了"）。 */
export interface BackupResult {
  /** 落盘的备份文件绝对路径。 */
  path: string
  /** `backup()` 返回的页数（实测值，非估算）。 */
  pages: number
  /** 备份文件字节数（落盘后实测）。 */
  bytes: number
  /** 备份件自己的 `journal_mode` 读回值（实测为继承的 'wal'）。 */
  journalMode: string
  /** 备份件里 `mana_trace` 的行数（还原可对账的锚点）。 */
  traceRows: number
  /** 完成时刻（ISO 8601）。 */
  at: string
}

/** 备份轮转策略。 */
export interface BackupPolicy {
  /** 是否启用定期备份。 */
  enabled: boolean
  /** 间隔毫秒数。默认 6 小时。 */
  intervalMs: number
  /** 保留最近几个备份（超出即删最旧）。 */
  keep: number
  /** 备份目录；留空 = 与库同级的 `backups/`。 */
  dir: string
}

export const DEFAULT_BACKUP_POLICY: BackupPolicy = {
  enabled: false,
  intervalMs: 6 * 60 * 60 * 1000,
  keep: 7,
  dir: '',
}

/** 备份文件名：`mana-<ISO时间戳压缩>.db`，字典序 == 时间序（便于轮转取最旧）。 */
export function backupFileName(at: Date = new Date()): string {
  const ts = at.toISOString().replace(/[:.]/g, '-').replace('Z', '')
  return `mana-${ts}.db`
}

/** 解析备份目录：留空则用库文件同级的 `backups/`。 */
export function resolveBackupDir(storePath: string, configured: string): string {
  if (configured.trim()) return configured
  return join(dirname(storePath), 'backups')
}

/**
 * 备份一次。
 *
 * ⚠ 三处刻意的设计，都是踩过坑的：
 *  1. **自建父目录**：实测目标目录不存在直接 `unable to open database file`
 *     ⇒ 不自建就成"静默的备份缺失"（最坏的一类：以为有备份，其实从来没有）。
 *  2. **先写临时名再改名**：避免"备份到一半被杀"留下一个**半截的、看着像备份**的文件。
 *     半截备份比没有备份更危险 —— 它会在真需要还原时才发现。
 *  3. **备份后回读校验**：读出 `mana_trace` 行数写进结果，让"备份可用"成为**可断言事实**。
 */
export async function backupNow(db: DatabaseSync, storePath: string, targetPath?: string): Promise<BackupResult> {
  const dir = dirname(targetPath ?? join(dirname(storePath), backupFileName()))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const finalPath = targetPath ?? join(dir, backupFileName())
  const tmpPath = `${finalPath}.partial`
  // 上一轮若崩在 .partial 上，先清掉（否则会被当成一次"已有备份"）
  if (existsSync(tmpPath)) rmSync(tmpPath, { force: true })

  const pages = await backup(db, tmpPath)
  // 回读校验：备份件必须真能打开且行数可读，否则这次备份不算成功
  const probe = new DatabaseSync(tmpPath, { allowExtension: true })
  let journalMode = ''
  let traceRows = -1
  try {
    const jm = probe.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined
    journalMode = String(jm?.journal_mode ?? '')
    const row = probe.prepare('SELECT count(*) c FROM mana_trace').get() as { c?: number } | undefined
    traceRows = Number(row?.c ?? -1)
  } finally {
    probe.close()
  }
  // 改名为最终名（同目录 rename 是原子的）
  renameSync(tmpPath, finalPath)
  const bytes = statSync(finalPath).size

  return {
    path: finalPath,
    pages: Number(pages),
    bytes,
    journalMode,
    traceRows,
    at: new Date().toISOString(),
  }
}

/** 轮转：只保留最近 `keep` 个（按文件名的时间序，即字典序）。 */
export function pruneBackups(dir: string, keep: number): string[] {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('mana-') && f.endsWith('.db'))
    .sort()
  const removed: string[] = []
  const excess = files.length - Math.max(0, keep)
  for (let i = 0; i < excess; i += 1) {
    const victim = files[i]!
    unlinkSync(join(dir, victim))
    removed.push(victim)
  }
  return removed
}

/** 起一个定期备份定时器；返回停止函数（**必须**由调用方在卸载时调用）。 */
export function startBackupTimer(
  db: DatabaseSync,
  storePath: string,
  policy: BackupPolicy,
  onError: (error: unknown) => void,
): () => void {
  if (!policy.enabled) return () => {}
  const dir = resolveBackupDir(storePath, policy.dir)
  const timer = setInterval(() => {
    void (async () => {
      try {
        await backupNow(db, storePath, join(dir, backupFileName()))
        pruneBackups(dir, policy.keep)
      } catch (error) {
        // 备份失败**必须显式上报**，不得静默（G8：失败与"正常空结果"不可同形）
        onError(error)
      }
    })()
  }, policy.intervalMs)
  // 不让定时器把进程钉住（Node 侧）
  ;(timer as unknown as { unref?: () => void }).unref?.()
  return () => clearInterval(timer)
}

/**
 * 从备份还原到指定路径，**并校验还原件可读**。
 *
 * ⚠ 还原必须走 `openManaDb`（而不是裸 `new DatabaseSync`），否则会丢掉
 *   `{ allowExtension: true }` 这个**不可后补**的开库窗口（G4）。
 */
export function restoreBackup(backupPath: string, targetPath: string): ManaDb {
  if (!existsSync(backupPath)) throw new Error(`restoreBackup: 备份不存在 ${backupPath}`)
  const bytes = statSync(backupPath).size
  if (bytes === 0) throw new Error(`restoreBackup: 备份为空文件 ${backupPath}`)

  if (existsSync(targetPath)) {
    // 还原前先把现状另存，避免"还原失败且原库已毁"（回滚失败不可观测是 G10）
    const rescued = `${targetPath}.pre-restore-${Date.now()}`
    copyFileSync(targetPath, rescued)
  }
  copyFileSync(backupPath, targetPath)
  // 走同一开库口径（G4 的窗口只在开库瞬间）
  return openManaDb({ path: targetPath } satisfies OpenManaDbOptions)
}

export { withImmediateTransaction }
