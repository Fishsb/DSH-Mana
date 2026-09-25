/**
 * Mana 判据器**单实例锁**（并发纪律 §1 的机器落点；F-05b，主持人拍板口径 A）。
 *
 * ⚠ 为什么必须是「单实例 + 非零退出 + 打印持有者」而不是「静默排队」：
 *   判据器读的是**共享可变工作树**。会议期间 `ps` 实拍到**三方并发**跑同一个 checker
 *   （`timeout 900` / `timeout 200` / `timeout 400 --record-baseline`）⇒ 同一 HEAD 下 A0 红绿互异、
 *   `docs/contract/_freeze.head` 被写→回滚。并发实例会**互相把对方的在途码读进自己的读数**，
 *   于是「谁把这条判据搞红的」在结构上不可归因。
 *   而「排队等待」并不解决它 —— 排队把「两个实例同时在跑」变成**不可见**，只留下一个看似正常的等待，
 *   正是本项目最在意的那类缺陷（**让失败不可观测**）。故第二个实例必须**响亮地失败**。
 *
 * ⚠ 锁的**判定锚点**是 `kill(pid, 0)`（进程真实存在性），**不是**锁文件里的 mtime/时间戳：
 *   后者是代理指标 —— 进程被 `kill -9` 后文件还在，而「文件在」不等于「进程在」。
 *   接管（stale lock takeover）以 signal 0 的探活结果为唯一依据，**且必须留痕**。
 *
 * ⚠ 抢占动作必须是**原子的**：用 `openSync(path, 'wx')`（O_EXCL）创建，失败即「已被持有」。
 *   「先 existsSync 再 writeFileSync」是**两段式**的 TOCTOU 竞态，本仓禁止。
 */
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 拿锁失败时抛这个（调用方据它决定退出码与打印内容）。 */
export class LockHeldError extends Error {
  constructor(holder, lockPath) {
    super(`判据器已被另一个实例持有（pid=${holder.pid} 起始=${holder.startedAt} commit=${holder.commit}）`)
    this.name = 'LockHeldError'
    this.holder = holder
    this.lockPath = lockPath
  }
}

/** pid 是否**真的**还活着（EPERM 也算活：进程在，只是不属于本用户）。 */
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * 进程**身份**：`/proc/<pid>/stat` 第 22 字段（starttime，内核时钟节拍）。
 * ⚠ 为什么不能只靠 `kill(pid,0)`：进程 ID **会被复用** —— 崩溃残留的锁若碰上一个刚被
 *   复用成同号的**无关进程**，`kill(pid,0)` 会报「活着」⇒ 锁**永久卡死**。把身份钉到
 *   starttime 上，PID 复用就不可再冒充（`ps -o lstart=` 是同一口径的另一种取法）。
 * 返回 null = 取不到（非 Linux / 已退出 / 无权限）——**不得**当成「同一个进程」。
 */
export function processStartToken(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // ⚠ 按**最后一个 ')' 之后**切分：comm 字段本身可能含空格与括号。
    const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return tail[19] ?? null // 第 22 字段（1-based）－ 前两字段 ⇒ 下标 19
  } catch {
    return null
  }
}

/**
 * 取锁（**加锁变体** —— 只给测试/显式调用用；判据器本体一律走 tryAcquireLock）。
 * 返回 { release }；拿不到即抛 LockHeldError。
 */
export function acquireLock(lockPath, meta) {
  try {
    const fd = openSync(lockPath, 'wx')
    writeSync(fd, JSON.stringify(meta, null, 2) + '\n')
    closeSync(fd)
    return {
      release() {
        try {
          // 只删**自己的**锁：若被别的进程接管过，这里就不该删（删除他人锁 = 把并发放回来）
          const cur = readFileSync(lockPath, 'utf8')
          if (JSON.parse(cur).pid === meta.pid) unlinkSync(lockPath)
        } catch {
          /* 锁已不在（被接管/被清）—— 无需处理，release 本身不抛 */
        }
      },
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  let holder = null
  try {
    holder = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    holder = { pid: null, startedAt: '?', commit: '?', argv: '?', note: '锁文件不可解析（可能是写到一半被杀）' }
  }
  // 存活判定 = 进程在 **且** 身份一致；不一致（含取不到 startToken 的 kill -9 残留）⇒ 陈旧，可接管。
  const sameProcess =
    holder?.pid &&
    processAlive(holder.pid) &&
    (holder.startToken == null || processStartToken(holder.pid) == null || processStartToken(holder.pid) === holder.startToken)
  if (sameProcess) throw new LockHeldError(holder, lockPath)
  /**
   * 走到这里 = 锁文件在、但持有者**进程已不在**（`kill -9` 之后的残留）。
   * ⚠ 接管**必须留痕**：把「上一次是谁、卡在哪」写进宿主日志，否则「有过一次崩溃」不可见。
   */
  const stale = { ...holder, takenOverAt: new Date().toISOString(), takenOverBy: meta.pid }
  try { console.warn(`[lock takeover] 接管陈旧锁：${JSON.stringify(stale)}`) } catch { /* ignore */ }
  try { unlinkSync(lockPath) } catch { /* 别人先接管了 —— 下面的 open 会再争一次 */ }
  const fd = openSync(lockPath, 'wx')
  writeSync(fd, JSON.stringify({ ...meta, tookOverFrom: stale }, null, 2) + '\n')
  closeSync(fd)
  return {
    release() {
      try {
        if (JSON.parse(readFileSync(lockPath, 'utf8')).pid === meta.pid) unlinkSync(lockPath)
      } catch { /* ignore */ }
    },
  }
}


/**
 * 锁文件位置：**仓库相关、但不落在仓库里**。
 *
 * ⚠ 为什么不放仓内 `tools/`：锁是**运行态**，而本仓的工作树**没有独占期**（并发纪律 §4：同一波次
 *   只有一个 git 写席，且任何席禁 `git add -A`）⇒ 仓内锁文件会给写席制造**未跟踪噪声**；
 *   被 `kill -9` 留下的陈旧锁更会一直挂在那儿，让「谁留下的」与「真源码」混在一处。
 *   `.gitignore` 里虽已有 `tools/.a0-10-baseline.json` 这类运行态条目，但本席写面不含 `.gitignore`
 *   （改它属于越界），故改放临时目录 —— 语义不变，噪声为零。
 * ⚠ 按**仓库根路径**取键：不同 checkout（例如 /tmp 副本）各自独立持锁，
 *   否则把副本的并发误判成同一实例的冲突（那是**假红**）。
 * 锁文件路径会随错误信息一起打印，故仍然可发现、可人工检查。
 */
export function lockPathFor(repoRoot, name) {
  const key = createHash('sha1').update(String(repoRoot)).digest('hex').slice(0, 10)
  return join(tmpdir(), `mana-check-${key}-${name}.lock`)
}
/** 只读探测：锁在不在、持有者是谁（不抢占）。用于负向对拍与报告。 */
export function lockStatus(lockPath) {
  if (!existsSync(lockPath)) return { held: false }
  let holder = null
  try { holder = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { holder = null }
  const alive = holder?.pid ? processAlive(holder.pid) : false
  const sameProcess = Boolean(alive && holder?.startToken != null && processStartToken(holder.pid) === holder.startToken)
  return { held: true, alive, sameProcess, holder }
}