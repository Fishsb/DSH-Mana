/**
 * 用户模型的**判定核**（纯函数 · 无 IO · 无监听器 · 不写库）——B5.2 的四条判据落在此处。
 *
 * 拆出本文件的理由：判据要能**直接喂输入断言输出**，而不必去猜服务面的中间态。
 * 与本仓 `long-term/src/activation.ts` 同形态（那包的服务面也只是纯函数面的装配）。
 *
 * ── 本文件承载的四件事（与落地册 §4.1 / §4.2 逐条对应）───────────────────────
 *  ① `driftCandidates`   —— 册:150 の「30 天内改 ≥3 次 = 漂移候选（**不是错误**）」
 *  ② `injectionDecision` —— 册:151「置信度跌破阈值时转为**不注入**，而不是继续生效」
 *  ③ `assessAccuracy`    —— A4-2「未定前不判通过；样本量不足即判**不可判定**而非通过」
 *  ④ （读/写面在 index.ts，本文件不碰库）
 *
 * ⚠ 本文件**不产生**任何 `memory_items.content`（A4-3）：它连库句柄都拿不到。
 */
import { DRIFT_MIN_CHANGES, DRIFT_WINDOW_DAYS, requiredSampleSize } from './params.ts'

/** 一条历史行（与 `dsh-mana-core` 的 `UserModelHistoryRow` 同形，此处只列本核用到的列）。 */
export interface DriftHistoryRow {
  key: string
  old_value: string | null
  new_value: string
  confidence: number | null
  at: string
}

/** 一个 key 的漂移读数（**两个口径并列**，不替读者选，见 `driftCandidates` 注释）。 */
export interface DriftReading {
  key: string
  /** 窗口内**真改变了值**的行数（`old_value !== new_value`）——判候选用这个。 */
  changes: number
  /** 窗口内**全部**行数（含"写了但值没变"，见 core 的 M4：那种行也留痕）。 */
  rows: number
  /** 窗口内最后一次改动时刻（ISO 字符串）。 */
  lastChangeAt: string | null
}

/** 漂移扫描结果。 */
export interface DriftReport {
  /** 窗口起点（ISO）——由 `now` 与 `DRIFT_WINDOW_DAYS` 推出，**显式回传**便于复核。 */
  since: string
  /** 窗口天数（回传，使读数自带测量条件）。 */
  windowDays: number
  /** 候选线（回传）。 */
  minChanges: number
  /** 全部出现过的 key 的读数（**含未达线者**——只报候选会让"没达线"与"没扫到"同形）。 */
  readings: DriftReading[]
  /** 达线者（= 漂移候选，**不是错误**，是「这个偏好不稳定」，进复核队列）。 */
  candidates: string[]
}

/**
 * 漂移扫描：同一 `key` 在 `windowDays` 天内被**改** ≥ `minChanges` 次 ⇒ 候选。
 *
 * ⚠ `now` **必填、无缺省**（本仓「区间起点先取值显式传参」）：窗口的右端若取
 *   `Date.now()`，同一批输入在不同时刻会给出不同结论，判据就不可复现 —— 而漂移判据
 *   正是靠"可复现"才能被复核。故把时刻做成**显式入参**，由调用方负责它的真值。
 *
 * ⚠ **"被改"的口径**：本核计的是 `old_value !== new_value` 的行，**不**计"写了但值没变"
 *   的行（core 的 M4 明确：值相同也留一行痕）。若把那种行也计入，"反复确认同一个偏好"
 *   会被读成"这个偏好不稳定"，方向恰好相反。两个数都回传（`changes`/`rows`），
 *   读的人可自行核对，而不是只能相信一个数。
 *
 * ⚠ **创建算不算一次"改"**：`old_value === null` 的首行计入 `changes`（值确实从无到有）。
 *   这是本席的判断而非册文原文（册只写「被改 ≥3 次」）⇒ 已在 `docs/handoff/S18.md` §5
 *   登记为未决项；`rows` 同时回传，使另一种口径的复核不必改代码即可完成。
 */
export function driftCandidates(
  history: readonly DriftHistoryRow[],
  now: string,
  windowDays: number = DRIFT_WINDOW_DAYS,
  minChanges: number = DRIFT_MIN_CHANGES,
): DriftReport {
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new Error(`driftCandidates: now 不是合法 ISO 时刻，实测 ${now}`)
  if (!(windowDays > 0)) throw new Error(`driftCandidates: windowDays 必须 > 0，实测 ${windowDays}`)
  if (!(minChanges >= 1)) throw new Error(`driftCandidates: minChanges 必须 >= 1，实测 ${minChanges}`)

  const sinceMs = nowMs - windowDays * 86400000
  const since = new Date(sinceMs).toISOString()
  const acc = new Map<string, DriftReading>()

  for (const row of history) {
    const atMs = Date.parse(row.at)
    // ⚠ 时刻不可解析的行**跳过并在下面显式报告**（不得静默当成"很旧"）：把不可解析读成
    //   "窗口外"会让数据损坏表现为"没有漂移"，正是本仓最防的「让失败不可观测」。
    if (!Number.isFinite(atMs)) {
      throw new Error(`driftCandidates: 历史行 at 不是合法 ISO 时刻（key=${row.key}，实测 ${row.at}）`)
    }
    if (atMs < sinceMs || atMs > nowMs) continue
    const cur: DriftReading = acc.get(row.key) ?? {
      key: row.key,
      changes: 0,
      rows: 0,
      lastChangeAt: null,
    }
    cur.rows += 1
    if (row.old_value !== row.new_value) {
      cur.changes += 1
      if (cur.lastChangeAt === null || atMs > Date.parse(cur.lastChangeAt)) cur.lastChangeAt = row.at
    }
    acc.set(row.key, cur)
  }

  const readings = [...acc.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return {
    since,
    windowDays,
    minChanges,
    readings,
    candidates: readings.filter((r) => r.changes >= minChanges).map((r) => r.key),
  }
}

/** 注入三态。`undeterminable` 与 `retired_no_injection` **必须可分辨**（见下）。 */
export type InjectionDecision =
  /** 置信度 ≥ 阈值 ⇒ 该偏好可注入。 */
  | 'inject'
  /** 置信度**跌破**阈值 ⇒ 退场：该偏好转为**不注入**（册:151）。 */
  | 'retired_no_injection'
  /** **无人拍板**（阈值未定）或读数不可用 ⇒ 既不是注入，也不是退场。 */
  | 'undeterminable'

/** 一次注入判定的读数（带原因，使三态之外还能看到"为什么"）。 */
export interface InjectionVerdict {
  decision: InjectionDecision
  /** 判定所依据的阈值；`null` = A4-1 未拍板。 */
  floor: number | null
  /** 判定所依据的置信度；非有限数时为 `null`。 */
  confidence: number | null
  reason: 'below-floor' | 'at-or-above-floor' | 'floor-unset' | 'confidence-unusable'
}

/**
 * 退场动作（册:151「置信度跌破阈值时该偏好转为**不注入**，而不是继续生效」）。
 *
 * ⚠ **`undeterminable` 不得被消费方读成 `inject`** —— 这是本函数存在的主要理由：
 *   A4-1 的阈值在册:597 是「**待定，需拍板**」且「未定前本判据**不生效**，不得以
 *   「未超标」放过」。若把"未拍板"折成"照常注入"，则退场机制**永远不触发**，
 *   而系统看起来一切正常 —— 未拍板会被静默读成"已校准且合格"。
 *   故此处返回**独立的第三态**，而不是一个布尔（布尔逼着调用方二选一，必然猜错一个）。
 *
 * ⚠ **阈值比较用 `<`（严格小于）**：`confidence === floor` 时**不**退场。
 *   理由：阈值是"跌破"（册原文「跌破阈值」），恰好等于不算跌破；且若取 `<=`，
 *   一个恰好落在线上的偏好会静默消失，而两侧读数看起来都正常。
 *
 * ⚠ `confidence` 非有限数（NaN/Infinity/undefined）时返回 `undeterminable`，
 *   **不**返回 `inject`：读数坏了与读数合格是两件事，前者不得默认放行。
 */
export function injectionDecision(
  confidence: number | null | undefined,
  floor: number | null,
): InjectionVerdict {
  if (floor === null || floor === undefined || !Number.isFinite(floor)) {
    return { decision: 'undeterminable', floor: null, confidence: null, reason: 'floor-unset' }
  }
  const c = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null
  if (c === null) {
    return { decision: 'undeterminable', floor, confidence: null, reason: 'confidence-unusable' }
  }
  if (c < floor) return { decision: 'retired_no_injection', floor, confidence: c, reason: 'below-floor' }
  return { decision: 'inject', floor, confidence: c, reason: 'at-or-above-floor' }
}

/** 首测的一条带标注样本（A4-2「对人工标注集算命中率」的输入单元）。 */
export interface LabeledSample {
  /** 偏好 key。 */
  key: string
  /** 人工标注的**真值**（该会话里用户真正的偏好）。 */
  actual: string
  /** 用户模型当时给出的**预测值**。 */
  predicted: string | null
}

/** 一次精度评估的读数。 */
export interface AccuracyReport {
  /** 有效样本量（去重后参与计算者）。 */
  n: number
  /** A4-2 要求的下限（**现算**，见 params.ts）。 */
  requiredN: number
  hits: number
  /** 命中率；`n === 0` 时为 `null`（**不是 0** —— "没测"与"全错"必须可分辨）。 */
  hitRate: number | null
  verdict: 'pass' | 'fail' | 'undeterminable'
  reason: 'threshold-unset' | 'insufficient-sample' | 'no-sample' | 'measured'
}

/**
 * A4-2 用户模型精度**首测方法**的可执行落点。
 *
 * ⚠ **本函数刻意不接受"缺省阈值"**（`threshold` 必填且无默认）：册:598 写明这个数是
 *   「待定，**需首测后自设**」，且「**未定前不判通过**」。若此处给一个默认值，
 *   就等于本席替用户拍了一个数进判据 —— 而那正是册内禁止的「以未超标放过」。
 *   调用方必须**显式**交出阈值；交不出（`null`）时本函数返回 `'undeterminable'`。
 *
 * 判定序（**顺序即语义**，不得重排）：
 *   ① 阈值未定 ⇒ `undeterminable`（**先于**样本量判断：没标准时样本再足也无从判定）
 *   ② 样本为空 ⇒ `undeterminable`（`hitRate` 留 `null`，不用 0 冒充）
 *   ③ `n < requiredN` ⇒ `undeterminable`（册:598「不足样本量即判**不可判定**而非通过」）
 *   ④ 否则 命中率 ≥ 阈值 ⇒ `pass`，否则 `fail`
 */
export function assessAccuracy(
  samples: readonly LabeledSample[],
  threshold: number | null,
): AccuracyReport {
  const requiredN = requiredSampleSize()
  const n = samples.length
  const hits = samples.filter((s) => s.predicted !== null && s.predicted === s.actual).length
  const base = { n, requiredN, hits }

  if (threshold === null || !Number.isFinite(threshold)) {
    return { ...base, hitRate: n === 0 ? null : hits / n, verdict: 'undeterminable', reason: 'threshold-unset' }
  }
  if (n === 0) {
    return { ...base, hitRate: null, verdict: 'undeterminable', reason: 'no-sample' }
  }
  const hitRate = hits / n
  if (n < requiredN) {
    return { ...base, hitRate, verdict: 'undeterminable', reason: 'insufficient-sample' }
  }
  return { ...base, hitRate, verdict: hitRate >= threshold ? 'pass' : 'fail', reason: 'measured' }
}
