/**
 * 激活值**四区间归档**（**A3-2/B4.2 的实现者**）。
 *
 * 判据原文（`docs/mana-rollout-plan.md:547` ②，逐字）：
 *   `A>τ+1.0` / `τ<A≤τ+1.0` / `τ-0.5<A≤τ` / `A≤τ-0.5`
 * 区间语义真源（`docs/mana-v5-plan.md:570-576`，逐字）：
 *   `A > τ + 1.0` ⇒ 正常保留、高优先级检索；`τ < A ≤ τ+1.0` ⇒ 正常保留；
 *   `τ − 0.5 < A ≤ τ` ⇒ **标记为「衰退中」**、降低注入优先级；`A ≤ τ − 0.5` ⇒ **归档**（`retired=true`）。
 *
 * ⚠ **A3-2 的红线**：`retired=1` **只是标记，不是归档** —— 判据原文 `:558` 写「三条全真，
 *   只满足①只算标记」。故本文件**只**产出三样东西：
 *     ① 区间归属（纯函数，`classify`）；
 *     ② 「归档/降级」**候选**（`retireCandidates` / `decliningCandidates` —— **候选，不是执行**）；
 *     ③ 归档账目的**留存上限状态**（`capStatus` —— 三态，含 `uncalibrated`）。
 *   **本文件不写库、不改 `retired` 列、不删任何行**（判据 ⑤ 的只读腿机检这一点）。
 *   真归档（体积必须下降的那条腿）属三步流程的第 ②/③ 步，**尚未实现**，
 *   由 `retirementPlan().unimplemented` 如实列出，**不静默略过**。
 */
import { A_RETIRE_MARGIN, A_STRONG_MARGIN, ARCHIVE_INTERVALS, type ArchiveIntervalName } from './params.ts'

/** 一条待归档判定的输入（**只读快照**，不是库行句柄）。 */
export interface ActivationSnapshot {
  readonly memoryId: string
  /** 该条目当前激活值 `A`（由 `long-term` 计算并落库 —— 派生量唯一写者）。 */
  readonly activation: number
  /** 已有标记（快照只读；本文件**永不**写回）。 */
  readonly retired?: boolean
}

/** 一次判定结果：归属 + 该归属的含义。 */
export interface Classification {
  readonly memoryId: string
  readonly activation: number
  readonly interval: ArchiveIntervalName
  readonly label: string
  /** 落库目标值 `retired`（**只是"本该是什么"**，本文件不施加）。 */
  readonly retiredTarget: 0 | 1
  /** 「衰退中」是否应降低注入优先级（案 §8.2 第 3 行）。 */
  readonly lowerInjectionPriority: boolean
  /** 输入快照里该条目**已有**的标记（只读带出；本文件不施加、不写回）。 */
  readonly alreadyRetired: boolean
}

/**
 * 四区间归属。**边界逐字实现**（左开右闭，最小区为 `A ≤ τ−0.5`）。
 *
 * 无穷大是**合法输入**：`A = -Infinity`（`long-term` 的 `baseLevel([])` 极点）⇒ `archive`；
 *   `A = +Infinity`（`t_j → 0` 极点）⇒ `hot`。`NaN` 才是错误（它不属于任何区间，
 *   静默归到某一边会让「算错了」与「算出来很低」同形）。
 */
export function classify(memoryId: string, a: number, tau: number, retired = false): Classification {
  if (Number.isNaN(a)) throw new Error(`classify: A 不得为 NaN（memoryId=${memoryId}）`)
  if (!Number.isFinite(tau)) throw new Error(`classify: τ 必须是有限数（实测 ${String(tau)}）`)
  const strong = tau + A_STRONG_MARGIN
  const floor = tau - A_RETIRE_MARGIN
  let interval: ArchiveIntervalName
  if (a > strong) interval = 'hot'
  else if (a > tau) interval = 'warm'
  else if (a > floor) interval = 'declining'
  else interval = 'archive'
  const spec = ARCHIVE_INTERVALS.find((s) => s.name === interval)
  if (!spec) throw new Error(`classify: 区间表缺 ${interval}（表被改坏）`)
  return {
    memoryId,
    activation: a,
    interval,
    label: spec.label,
    retiredTarget: interval === 'archive' ? 1 : 0,
    lowerInjectionPriority: interval === 'declining',
    alreadyRetired: retired,
  }
}

/** 整个象限归一化：逐条 classify，并按区间分桶（缺桶显式给空数组，**不省略键**）。 */
export function classifyAll(
  items: readonly ActivationSnapshot[],
  tau: number,
): { byInterval: Record<ArchiveIntervalName, Classification[]>; flat: Classification[] } {
  const byInterval: Record<ArchiveIntervalName, Classification[]> = { hot: [], warm: [], declining: [], archive: [] }
  const flat: Classification[] = []
  for (const it of items) {
    const c = classify(it.memoryId, it.activation, tau, it.retired === true)
    byInterval[c.interval].push(c)
    flat.push(c)
  }
  return { byInterval, flat }
}

/**
 * **归档候选**（`A ≤ τ−0.5` **且尚未退役**）。
 *
 * ⚠ 名字刻意带 `Candidates`：案 §8.3（`docs/mana-v5-plan.md:578-580`）「物理删除永不发生」，
 *   故这里的输出**永远只是清单**。谁把它当执行器用，谁就把「可恢复」降级成了「已删」。
 *
 * ⚠ **为什么要过滤 `alreadyRetired`**（本席实跑发现视图与归档候选曾经不同源）：
 *   A3-2 ① 的判据原文是 `SELECT count(*) … WHERE A<=τ-0.5 AND retired=0`（`docs/mana-rollout-plan.md:558`）
 *   —— **带 `AND retired=0`**。若本函数不过滤，它会与
 *   `prune.ts#pruneCandidates`（视图，回答"还剩几条待处理"）给出**不同的清单**，
 *   于是「修剪视图是四区间归档之上的视图」这句裁定在**数据上不成立**（两条各自成说）。
 *   ⇒ 本函数按判据原文的 SQL 形状实现：**只列尚未归档的**。
 *   想看「归档区间里一共有多少行（含已退役）」用 `archiveIntervalRows()`，两个数**分列**。
 */
export function retireCandidates(items: readonly ActivationSnapshot[], tau: number): readonly Classification[] {
  return classifyAll(items, tau).flat.filter((c) => c.interval === 'archive' && !c.alreadyRetired)
}

/** 归档区间内的**全部**行数（含已退役）—— 与 `retireCandidates` 分列，避免两口径合成一个数。 */
export function archiveIntervalRows(items: readonly ActivationSnapshot[], tau: number): readonly Classification[] {
  return classifyAll(items, tau).flat.filter((c) => c.interval === 'archive')
}

/** 「衰退中」候选（降注入优先级；案 §8.2 第 3 行）。 */
export function decliningCandidates(items: readonly ActivationSnapshot[], tau: number): readonly Classification[] {
  return classifyAll(items, tau).flat.filter((c) => c.interval === 'declining')
}

/**
 * 归档账目（**A3-5「存储增速非爆炸」的输入面**）。
 *
 * ⚠ **上限与「物理删除永不发生」是同一句话的两半**（`docs/mana-rollout-plan.md:547` ③ /
 *   `:571`）：「只监控不设上限 ⇒ 监控只会告诉你它在爆」。故 `capStatus` 三态。
 */
export interface ArchiveLedger {
  /** 归档区间内的条目数（`A ≤ τ−0.5`）。 */
  readonly archivedRows: number
  /** 首次归档时刻（ISO）；无归档 ⇒ `null`（**显式事实**，不是空串）。 */
  readonly oldestArchivedAt: string | null
  /** 最近一次新增归档的时刻（ISO）；无 ⇒ `null`。 */
  readonly newestArchivedAt: string | null
}

/** 留存上限的三种状态。⚠ `'uncalibrated'` **不是** `'ok'` 的同义词。 */
export type CapStatus = 'ok' | 'over' | 'uncalibrated'

export interface CapReading {
  readonly status: CapStatus
  /** 生效上限（天）；`null` = 未配置 ⇒ 必然 `uncalibrated`。 */
  readonly capDays: number | null
  /** 账目中最老归档条目的年龄（天）；无归档 ⇒ `null`。 */
  readonly oldestAgeDays: number | null
  /** 人类可读归因（判据/面板直接引用；**不得**只回一个布尔）。 */
  readonly reason: string
}

const DAY_MS = 86_400_000

/**
 * 留存上限判定。
 *
 * @param ledger 归档账目
 * @param now 判定时刻（毫秒）；**显式传入**以便判据可复现（不读 `Date.now()`）
 * @param capDays 上限（天）。`null`/`undefined` ⇒ 未配置
 * @param calibrated 该上限是否**已校准**（缺省 = 未校准）
 *
 * ⚠ **为什么 `uncalibrated` 必须压过 `ok`**：`docs/mana-rollout-plan.md:520` 判 A2-5 明文
 *   「阈值未定前本判据**不生效**，且**不得以『未超标』放过**」。若未校准时仍回 `'ok'`，
 *   「没设上限」与「设了且没超」就**同形** —— 正是本仓最防的「让失败不可观测」。
 *   `over` 仍优先于 `uncalibrated`：真越界是硬事实，不该被"未校准"盖住。
 */
export function capStatus(
  ledger: ArchiveLedger,
  now: number,
  capDays: number | null | undefined,
  calibrated = false,
): CapReading {
  if (!Number.isFinite(now)) throw new Error(`capStatus: now 必须是有限数（实测 ${String(now)}）`)
  const cap = capDays === null || capDays === undefined ? null : capDays
  if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) {
    throw new Error(`capStatus: capDays 必须是正有限数或 null（实测 ${String(capDays)}）`)
  }
  let oldestAgeDays: number | null = null
  if (ledger.oldestArchivedAt !== null) {
    const t = Date.parse(ledger.oldestArchivedAt)
    if (Number.isNaN(t)) throw new Error(`capStatus: oldestArchivedAt 不可解析（${ledger.oldestArchivedAt}）`)
    oldestAgeDays = (now - t) / DAY_MS
  }
  if (cap !== null && oldestAgeDays !== null && oldestAgeDays > cap) {
    return {
      status: 'over',
      capDays: cap,
      oldestAgeDays,
      reason: `最老归档条目 ${oldestAgeDays.toFixed(2)}d 已超上限 ${cap}d（归档 ${ledger.archivedRows} 行）`,
    }
  }
  if (cap === null) {
    return {
      status: 'uncalibrated',
      capDays: null,
      oldestAgeDays,
      reason: '未配置留存上限 ⇒ 监控只能告诉你它在爆（B4.2 ③ 未满足）',
    }
  }
  if (!calibrated) {
    return {
      status: 'uncalibrated',
      capDays: cap,
      oldestAgeDays,
      reason: `上限 ${cap}d 为**缺省档位、尚未校准**（samples=0）⇒ 不得据「未超标」判通过（落地册:520）`,
    }
  }
  return {
    status: 'ok',
    capDays: cap,
    oldestAgeDays,
    reason: `最老归档 ${oldestAgeDays === null ? '（无归档）' : oldestAgeDays.toFixed(2) + 'd'} ≤ 上限 ${cap}d（已校准）`,
  }
}

/** 「真归档」三步流程的状态 —— 供面板/判据读取，**不隐藏未做的部分**。 */
export interface RetirementPlan {
  readonly step1: 'candidate-listing'
  readonly step2: 'unimplemented'
  readonly step3: 'unimplemented'
  readonly unimplemented: readonly string[]
}

/** 三步流程现状（A3-2 的三条腿逐条对应，未做的**显式列出**）。 */
export function retirementPlan(): RetirementPlan {
  return Object.freeze({
    step1: 'candidate-listing' as const,
    step2: 'unimplemented' as const,
    step3: 'unimplemented' as const,
    unimplemented: Object.freeze([
      'retired 置位（需 core 提供「置 retired 且不删行」的写口）',
      '90 天压缩（sum(length(content)) 必须下降）',
      '归档行从检索结果中排除的 SQL 面（A3-2 ③）',
    ]),
  })
}
