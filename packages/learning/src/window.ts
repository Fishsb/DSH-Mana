/**
 * **共激活检测**（L-03 判据 ②/③ 的实现者）—— **纯函数，无 IO、无时钟**。
 *
 * 判据原文（`docs/mana-v10-landing-plan.md:141` / `:144`②）：
 *   「两个记忆在 **5 分钟窗口**内被**同时**激活 ⇒ 增加关联强度」；「5 分钟外 ⇒ **不增**（负向）」。
 *
 * ── 「同时」到底怎么判（口径必须写明，否则读者会以为有两种读法）─────────────────
 *   判据读的是**两条记忆各自的激活时间戳序列**，故「同时」= ∃ (t_i, t_j) 使
 *   `|t_i − t_j| ≤ 窗口`。用**绝对值**而不是 `t_j − t_i`：谁的戳在前是任意的，
 *   写成有向差会让「A 先激活」与「B 先激活」得到两个不同的数（而物理上是一件事）。
 *
 * ── 「重复 N 次共激活」的单位是**occasion（一次共激活）**，不是**事件对** ────────────
 *   ⚠ 这是本文件最重要的一个决定，判据③「重复 N 次 ⇒ 强度单调不减且有闭式期望」直接依赖它。
 *   若按**事件对**计数：A 有 3 个戳、B 有 1 个戳且都落在同一窗口 ⇒ 会算成 3 次共激活
 *   ⇒ 同一件「A 与 B 一起被激活了一次」的事被记 3 次，权重随记数方式漂移（且与输入条数有关，
 *   与「共激活了几回」无关）。
 *   ⇒ 本文件的定义：**一次 occasion = 一个时间簇内出现过的、互不相同的一对 id**。
 *   簇 = 按时间排序后，相邻两个事件间距 **≤ 窗口** 的极大连续段。
 *   ⚠ 该定义的一个**已知推论**（如实写出，不许读者自己踩）：A 在 t=0、B 在 t=100s、
 *   C 在 t=200s（窗口 5 分钟）时，A 与 C 的间距 200s ≤ 300s ⇒ **同簇**
 *   ⇒ 即使 A 与 C 之间隔着一个 B，(A,C) 也算一次共激活。这是「时间簇」口径的固有含义，
 *   不是 bug；要改成「逐对判间距」需另开一条判据，本批不做（§handoff 未决项）。
 *
 * ── 边界（判据②的落点，必须逐字写清）────────────────────────────────────────────
 *   `gap == 窗口` ⇒ **算在内**（判据原文写「5 分钟**内**」，本仓与 `册` 的既有口径一致取
 *   闭区间 `≤`，与 `consolidation` 的「相似度 ≥0.7」「序列 ≤7」同风格）。
 *   ⇒ `gap = 300000ms` 判为**共激活**；`gap = 300001ms` 判为**不共激活**。
 */

import { COACTIVATION_WINDOW_MS } from './params.ts'

/** 一条激活事件：某条记忆在某个时刻被激活了一次。 */
export interface ActivationEvent {
  /** 记忆 id（`memory_items.id`）。 */
  readonly id: string
  /** 激活时刻（epoch 毫秒）。 */
  readonly at: number
}

/** 一次共激活（occasion）。 */
export interface CoActivation {
  /** 规范序（字典序小的在前）—— 使 (a,b) 与 (b,a) 是**同一条**记录。 */
  readonly a: string
  readonly b: string
  /** 该簇的起点（epoch ms）：同一簇内所有 occasion 共用它。 */
  readonly clusterAt: number
  /** 该 occasion 的代表间距（簇内 a/b 各自最早戳之差），毫秒。 */
  readonly gapMs: number
}

/** 被**显式丢掉**的输入及其原因（G8：「0 命中」必须能说清是哪一种 0）。 */
export interface DroppedEvent {
  readonly index: number
  readonly reason: 'empty_id' | 'non_finite_time' | 'window_invalid'
  readonly detail: string
}

export interface CoActivationScan {
  /** 输入事件条数（**含被丢掉的** —— 使「输入为空」与「全被丢掉」可分辨）。 */
  readonly seen: number
  /** 参与计算的条数。 */
  readonly used: number
  /** 时间簇个数。 */
  readonly clusters: number
  readonly occasions: readonly CoActivation[]
  readonly dropped: readonly DroppedEvent[]
}

/**
 * 规范序的 (a,b)：字典序小的在前。
 *
 * ⚠ **为什么必须有这一步**：`related_ids` 的编码是「按 id 排序的数组」（见 `store-format.ts`），
 *   若 (a,b) 与 (b,a) 各自生成一条记录，同一条关系会占两格、权重被写两份，
 *   而下游读到的「A 与 B 的关联强度」取决于读的是哪一格。
 */
export function canonicalPair(i: string, j: string): readonly [string, string] {
  return i < j ? [i, j] : [j, i]
}

/** 两个激活时刻的间距（**绝对值**；见文件头对方向的说明）。 */
export function gapMs(tA: number, tB: number): number {
  return Math.abs(tA - tB)
}

/**
 * 边界判定：间距是否落在窗口内（**闭区间**，见文件头）。
 *
 * @throws `windowMs` 非有限或为负 —— 静默当成 0 会让**每一次**共激活都判为「不共激活」
 *   （与「本来就没有共激活」完全同形，本仓最防的不可分辨形态）。
 */
export function isWithinWindow(gap: number, windowMs: number = COACTIVATION_WINDOW_MS): boolean {
  if (!Number.isFinite(gap)) throw new Error(`isWithinWindow: gap 必须是有限数（实测 ${String(gap)}）`)
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new Error(`isWithinWindow: windowMs 必须是 ≥0 的有限数（实测 ${String(windowMs)}）`)
  }
  return gap <= windowMs
}

/** 两个时刻是否同窗（`isWithinWindow` 的时刻级封装）。 */
export function sameActivationWindow(tA: number, tB: number, windowMs: number = COACTIVATION_WINDOW_MS): boolean {
  return isWithinWindow(gapMs(tA, tB), windowMs)
}

/** 时间簇：起点 + 属于本簇的事件（按时间升序；同刻按 id 升序 ⇒ 全序、可复算）。 */
export interface TimeCluster {
  readonly at: number
  readonly events: readonly ActivationEvent[]
}

/**
 * 把激活流切成**时间簇**（极大连续段：相邻事件间距 ≤ 窗口）。
 *
 * 排序口径：先按 `at` 升序，**同刻按 id 升序** —— 全序 ⇒ 与输入顺序无关 ⇒ 可复算。
 * （若只按 `at` 排，`Array.prototype.sort` 在 Node 上虽稳定，但输入顺序不同会得到
 *   不同的簇内成员顺序；虽不影响 occasion 集合，却会让「输出逐字节相同」这条腿失去意义。）
 */
export function clusterEvents(
  events: readonly ActivationEvent[],
  windowMs: number = COACTIVATION_WINDOW_MS,
): readonly TimeCluster[] {
  const sorted = [...events].sort((x, y) => (x.at !== y.at ? x.at - y.at : x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const clusters: TimeCluster[] = []
  let current: ActivationEvent[] = []
  let start = 0
  for (const e of sorted) {
    const head = current[0]
    if (head === undefined || e.at - start <= windowMs) {
      if (head === undefined) start = e.at
      current.push(e)
      continue
    }
    clusters.push({ at: start, events: current })
    current = [e]
    start = e.at
  }
  if (current.length > 0) clusters.push({ at: start, events: current })
  return clusters
}

/**
 * **生产入口**：扫一遍激活流，产出全部共激活 occasion。
 *
 * ⚠ `windowMs` 缺省走 `params.ts` 的派生量 —— 判据②正是**不传参**调用本函数，
 *   故把 `COACTIVATION_WINDOW_MINUTES` 由 5 改成 6 会让该判据**必红**（负向对拍 D1）。
 */
export function findCoActivations(
  events: readonly ActivationEvent[],
  windowMs: number = COACTIVATION_WINDOW_MS,
): CoActivationScan {
  const dropped: DroppedEvent[] = []
  const usable: ActivationEvent[] = []
  events.forEach((e, index) => {
    if (!e || typeof e.id !== 'string' || e.id.trim() === '') {
      dropped.push({ index, reason: 'empty_id', detail: `id 为空（实测 ${JSON.stringify(e?.id)}）` })
      return
    }
    if (!Number.isFinite(e.at)) {
      dropped.push({ index, reason: 'non_finite_time', detail: `at 非有限数（实测 ${String(e.at)}）` })
      return
    }
    usable.push({ id: e.id, at: e.at })
  })

  if (!Number.isFinite(windowMs) || windowMs < 0) {
    // 窗口非法 ⇒ **不做任何判定**，并把每个输入显式记为被丢掉（不让 0 occasion 冒充结论）。
    const all = usable.map((_, index) => ({
      index,
      reason: 'window_invalid' as const,
      detail: `windowMs 非法（实测 ${String(windowMs)}）—— 0 次共激活不是结论，是没判`,
    }))
    return { seen: events.length, used: 0, clusters: 0, occasions: [], dropped: [...dropped, ...all] }
  }

  const clusters = clusterEvents(usable, windowMs)
  const occasions: CoActivation[] = []
  for (const cluster of clusters) {
    // 簇内「id → 最早戳」：同一 id 在簇内出现多次只算一次（occasion 是「一起被激活过」，
    // 不是「戳的条数」）。
    const firstAt = new Map<string, number>()
    for (const e of cluster.events) {
      const known = firstAt.get(e.id)
      if (known === undefined || e.at < known) firstAt.set(e.id, e.at)
    }
    const ids = [...firstAt.keys()].sort()
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const a = ids[x]
        const b = ids[y]
        if (a === undefined || b === undefined) continue
        const ta = firstAt.get(a)
        const tb = firstAt.get(b)
        if (ta === undefined || tb === undefined) continue
        occasions.push({ a, b, clusterAt: cluster.at, gapMs: gapMs(ta, tb) })
      }
    }
  }
  // 全序输出（簇序 × a × b）—— 与输入顺序无关 ⇒ 逐字节可复算。
  occasions.sort((p, q) =>
    p.clusterAt !== q.clusterAt ? p.clusterAt - q.clusterAt : p.a !== q.a ? (p.a < q.a ? -1 : 1) : p.b < q.b ? -1 : p.b > q.b ? 1 : 0,
  )
  return { seen: events.length, used: usable.length, clusters: clusters.length, occasions, dropped }
}
