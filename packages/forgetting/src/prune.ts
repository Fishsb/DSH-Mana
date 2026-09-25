/**
 * **修剪候选视图**（B4.2 ④ 的落点 · 小胶质细胞修剪改造后用）。
 *
 * ── 裁定原文（`docs/mana-rollout-plan.md:547` ④ 与 `docs/mana-v10-review-and-allocation.md:45`）──
 *   「小胶质细胞修剪（《v10 方案》§16.5）**并入本行②的四区间归档**，形态为**只读候选视图**；
 *     v10:708 的『评分 > 0.7 → 标记为候选修剪 → 归档』**不得直接落为执行动作**」
 *   ⇒ 修剪**不是**第三条清理通路，而是**四区间归档之上的一个只读视图**。
 *   ⇒ 归档动作由四区间决定（`archive.ts`），本文件**只负责列候选**。
 *
 * ── 本文件的**结构性只读保证**（判据 ⑤ 逐条机检，不是注释承诺）──────────────
 *   ① 模块顶层**不 import 任何写库面**（无 `ctx`、无 `mana-core`、无 `node:sqlite`）；
 *   ② `pruneCandidates` 的输入是**纯值快照**（`ActivationSnapshot[]`），无句柄可写；
 *   ③ 返回值为**新建对象**且 `deepFreeze` —— 调用方拿到了也改不动；
 *   ④ 同一输入调两次 ⇒ **逐位相同的序列化结果**（无时钟、无 RNG、无副作用）。
 *
 * ── ⚠ 负向对拍「改成会写库的版本 ⇒ 必须报红」的**可做到什么程度**（如实记，不粉饰）──
 *   一个纯函数在本进程里**不可能**写到某个库，故不存在能让它「真写库之后被动态断言抓住」的输入：
 *   塞一个假 `ctx.db` 进去，它类型上不被接受、运行期也不被读 —— 断言照样绿，那是**假绿**。
 *   ⇒ 该腿由**结构性断言**承担（判据 ⑤ 第二腿）：源码**不得出现任何写手势**、
 *     **不得引用 ctx / DatabaseSync / prepare( / INSERT / UPDATE / DELETE**；
 *     把实现换成会写库的版本时，这些符号必然出现 ⇒ 立即报红。
 *     ⚠ **本席不把这个形态断言写成「动态只读证明」** —— 它挡的是"引入写面"，
 *       挡不住"用反射间接写"；后者的边界如实记在 handoff。
 */
import type { ActivationSnapshot } from './archive.ts'
import { A_RETIRE_MARGIN } from './params.ts'

/** 修剪候选的一条记录（**全字段只读**）。 */
export interface PruneCandidate {
  readonly memoryId: string
  readonly activation: number
  /** 距归档线 `τ − 0.5` 的缺口：`(τ − 0.5) − A`。`≥ 0` 即已跌破归档线。 */
  readonly deficit: number
  /** 该候选为何上榜（可枚举串，面板直接显示；**不是布尔**）。 */
  readonly reason: 'activation-gap' | 'score-threshold'
  /** 恒 `false`：已退役项**不入候选**（视图只列"还没处理且已跌破线"的）。 */
  readonly retired: false
}

export interface PruneViewOptions {
  /**
   * 额外评分档阈值（0~1）。**缺省 `undefined` = 不启用评分档**。
   *
   * ⚠ 为什么缺省关：该阈值来自《v10 方案》自述的 0.7，**本机无基线**（注册表 `samples=0`）。
   *   按 `docs/mana-rollout-plan.md:547` ④「不入阈值列、首测后自设」——
   *   一个未校准的阈值若**缺省生效**，它会静默改变候选面（假旋钮的反面：**假判据**）。
   *   故：只有调用方**显式**给值时才用，且读数**恒**带 `scoreThresholdCalibrated: false`。
   */
  readonly scoreThreshold?: number
  /** 每条条目的评分（`memoryId → score`）；给了阈值却没给评分表 ⇒ **抛**（不静默忽略该档）。 */
  readonly scores?: Readonly<Record<string, number>>
  /** 是否列出「已跌破归档线」的条目（缺省 `true`；`false` ⇒ 只列评分档额外命中的）。 */
  readonly includeBelowLine?: boolean
}

/** 只读候选视图的读数（含**它自己的降级/未校准状态**）。 */
export interface PruneView {
  readonly view: 'read-only'
  /** 恒 `false`：本视图**不写任何行**（判据 ⑤ 断言该字段与 `view` 字符串）。 */
  readonly writes: false
  readonly candidates: readonly PruneCandidate[]
  readonly tau: number
  /** 归档线 `τ − 0.5`（所有缺口的参照）。 */
  readonly archiveLine: number
  /** 生效的评分档阈值；`null` = 未启用（缺省）。 */
  readonly scoreThreshold: number | null
  /** 评分档是否**已校准**。恒 `false`（注册表 samples=0），生效与否都如实回报。 */
  readonly scoreThresholdCalibrated: boolean
  /** 视图的**输入量**（显式记 0 —— 「无输入」与「未消费」须可分辨）。 */
  readonly inputCount: number
  /** **未退役**且已跌破归档线的条数（与 `candidates` 同口径：视图回答"还有几条待处理"）。 */
  readonly belowLineCount: number
  /** 已退役**且**跌破归档线的条数（单列 —— 否则「已处理完」与「压根没进来」会合成一个数）。 */
  readonly retiredBelowLineCount: number
}

/** 递归冻结（含数组元素）。 */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as Record<string, unknown>)) deepFreeze((v as Record<string, unknown>)[k])
    Object.freeze(v)
  }
  return v
}

/**
 * 列候选（**纯函数**：无时钟、无 RNG、不写任何存储）。
 *
 * 判定顺序（**可枚举、可复算**）：
 *   ① `retired === true` ⇒ 跳过（已处理的条目不该在"待处理"里翻倍计数）；
 *   ② `A ≤ τ − 0.5`（`deficit ≥ 0`）⇒ 上榜，`reason='activation-gap'`；
 *      这是**四区间归档的同一条线**（`archive.ts#classify`），视图与归档**同源**，不是第二套判据；
 *   ③ 启用评分档时，`score > scoreThreshold` 且未因 ② 上榜 ⇒ `reason='score-threshold'`。
 *
 * @throws τ 非有限、`scoreThreshold` 越界、或给了阈值却没给评分表（**显式抛**，
 *   静默忽略一个用户显式给的阈值 = 把「档没生效」与「不满足条件」混成一件事）。
 */
export function pruneCandidates(
  items: readonly ActivationSnapshot[],
  tau: number,
  options: PruneViewOptions = {},
): PruneView {
  if (!Number.isFinite(tau)) throw new Error(`pruneCandidates: τ 必须是有限数（实测 ${String(tau)}）`)
  const archiveLine = tau - A_RETIRE_MARGIN
  const { scoreThreshold, scores, includeBelowLine = true } = options
  if (scoreThreshold !== undefined) {
    if (!Number.isFinite(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 1) {
      throw new Error(`pruneCandidates: scoreThreshold 必须落在 [0,1]（实测 ${String(scoreThreshold)}）`)
    }
    if (!scores) throw new Error('pruneCandidates: 给了 scoreThreshold 但没有 scores ⇒ 无法判定（拒绝静默忽略该档）')
  }
  const candidates: PruneCandidate[] = []
  let belowLineCount = 0
  let retiredSkipped = 0
  for (const it of items) {
    if (Number.isNaN(it.activation)) throw new Error(`pruneCandidates: A 不得为 NaN（memoryId=${it.memoryId}）`)
    if (it.retired === true) {
      // ⚠ 计数口径：`belowLineCount` **只数未退役的**（与 candidates 同口径：视图回答的是
      //   「还有几条待处理」）。已退役的另立 `retiredSkipped` —— 两个数都给出，
      //   否则「已处理完」与「压根没进来」会合成一个数（本仓「输入量须可见化」）。
      if (archiveLine - it.activation >= 0) retiredSkipped += 1
      continue
    }
    const deficit = archiveLine - it.activation
    const below = deficit >= 0
    if (below) belowLineCount += 1
    const base = { memoryId: it.memoryId, activation: it.activation, deficit, retired: false as const }
    if (below) {
      if (includeBelowLine) candidates.push({ ...base, reason: 'activation-gap' })
      continue
    }
    if (scoreThreshold === undefined) continue
    const sc = scores?.[it.memoryId]
    if (typeof sc === 'number' && Number.isFinite(sc) && sc > scoreThreshold) {
      candidates.push({ ...base, reason: 'score-threshold' })
    }
  }
  return deepFreeze({
    view: 'read-only' as const,
    writes: false as const,
    candidates,
    tau,
    archiveLine,
    scoreThreshold: scoreThreshold ?? null,
    scoreThresholdCalibrated: false,
    inputCount: items.length,
    belowLineCount,
    retiredBelowLineCount: retiredSkipped,
  })
}

/** 面板摘要（**只读**；直接印在 Mana 面板上，故不含任何可执行面）。 */
export function pruneViewSummary(v: PruneView): string {
  return (
    `修剪候选（只读）：${v.candidates.length}/${v.inputCount} 条 ｜ 归档线 A ≤ ${v.archiveLine.toFixed(3)}` +
    ` ｜ 评分档 ${v.scoreThreshold === null ? '未启用（缺省）' : `${v.scoreThreshold}（未校准）`}`
  )
}
