/**
 * **记忆活性分级 —— 热 / 温 / 冷三级**（v10 §16.3 的实现者）。
 *
 * 判据原文（v10:688-694，逐字）：
 *   | 级别 | 条件 | 动作 |
 *   | 热 | 近期被召回 | 每轮注入，高优先级 |
 *   | 温 | 中期未召回 | 按需注入 |
 *   | 冷 | 长期零召回 | 降级提纯，归档 |
 *
 * ── 本案与「四区间归档」是**两条轴**，不是同一件事（这是本文件存在的理由）──────
 *   · 激活轴（`archive.ts#classify`）：`A` 相对 `τ` 的四个区间 —— 由那**一个**模块持有，
 *     本文件**只读它的结论**，绝不重写 `τ+1.0` / `τ−0.5`（否则即本仓点名的「两个真源」）。
 *   · 召回轴（本文件）：距最近一次召回的**天数** —— §16.3 的条件列（近期/中期/长期）说的就是它，
 *     而 `archive.ts` 里**完全没有**这一维。
 *   ⇒ 结论：§16.3 既**不能**只由 `classifyAll` 代替（缺召回轴），也**不该**另起一套阈值（会与 τ 打架）。
 *     本文件把两轴**合取**（见 `activityOf` 的判定顺序），并如实带出各自读数。
 *
 *   ⚠ **为什么是「合取」而不是「任一轴满足」**（这条要读，否则会以为是随手选的口径）：
 *     §16.3 的动作列是「热 ⇒ 每轮注入」「冷 ⇒ **降级提纯，归档**」——「冷」这一级**直接挂着归档动作**。
 *     若两轴取「或」，一条**久未被召回但仍高度激活**的记忆（age=60d 而 A=-0.5，被反复复习过）
 *     会被召回轴单方面判冷 ⇒ 进候选归档。那等于让「时间久了」单独压过「它现在仍被频繁使用」，
 *     是本仓反复点名的「把单一代理指标当结论」。故取**较冷者 = 两轴都同意才降级**：
 *     宁可少降一级（漏报由 `activityRetirementJunction` 的对账面显式补出），
 *     不可把还在用的记忆归档掉（那是不可逆方向上更坏的一侧）。
 *
 * ── ⛔ 本文件最要防的那一条：无访问记录的新记忆**不得**被判成「冷」──────────────
 *   无访问记录 ⇒ `long-term#baseLevel` 的求和是**空集** ⇒ `B = ln(0) = -Infinity`（该模块自己写明这是
 *   「未编码的 chunk 不参与检索」的数学形态，不是「很低」）。若照直把它喂进 `classify`，
 *   区间必落 `archive` ⇒ 降级映射成「冷」⇒ **一条刚写进来、还没被任何人召回的新记忆，
 *   第一步就被判成该归档**。这正是本仓最防的「把数学边界当业务结论」。
 *   ⇒ 本文件的处置：**无访问记录时激活轴一律记 `unknown`（⊥），不参与判级**，
 *     改由**召回轴**按「距创建的天数」独立判定（新记忆 age≈0 ⇒ 热）。
 *     该规则由 `tests/activity.test.mjs` ③ 直接断言（给真读数），不靠注释承诺。
 *
 * ── ⚠ 命名撞车（读者必读）─────────────────────────────────────────────────────
 *   `ArchiveIntervalName` 取值 `hot|warm|declining|archive`（**区间**）；
 *   本文件 `ActivityLevel` 取值 `hot|warm|cold`（**活性级**）。二者共享 `hot/warm` 两个词但**不是同一种东西**。
 *   ⇒ 读数对象里两字段**分列**（`level` 与 `activationInterval`），永不同形；
 *     类型名也不同。任何把它们当同一个量的消费者都会在类型上被挡住。
 *
 * ── 只读性（与 `prune.ts` 同纪律）────────────────────────────────────────────
 *   本文件不 import 任何写库面（无 ctx / 无 node:sqlite），输入是**纯值快照**，
 *   返回对象 `deepFreeze`、无时钟、无 RNG ⇒ 同输入两次调用逐位相同。
 */
import { classify, type ActivationSnapshot } from './archive.ts'
// ⚠ `ArchiveIntervalName` 的真源是 `params.ts`（`archive.ts` 只是消费它，并不再导出）⇒ 从真源导入。
import type { ArchiveIntervalName } from './params.ts'
import { thresholdValue } from './criteria.ts'

/** 活性级（§16.3 的热/温/冷）。⚠ 与 `ArchiveIntervalName` **不是同一个类型**（见文件头「命名撞车」）。 */
export type ActivityLevel = 'hot' | 'warm' | 'cold'

/** 三级的固定顺序（热 → 冷），供遍历/分桶用（**缺桶显式给空数组，不省略键**）。 */
export const ACTIVITY_LEVELS: readonly ActivityLevel[] = Object.freeze(['hot', 'warm', 'cold'] as const)

/** 一级中文名（面板/摘要直接用，避免各处各写一份）。 */
export const ACTIVITY_LEVEL_LABELS: Readonly<Record<ActivityLevel, string>> = Object.freeze({
  hot: '热（近期被召回 ⇒ 每轮注入，高优先级）',
  warm: '温（中期未召回 ⇒ 按需注入）',
  cold: '冷（长期零召回 ⇒ 降级提纯，归档）',
})

/**
 * 召回轴边界（**天**）。由调用方显式传入 —— 与 `classify` 的 `tau` 同一形态，
 * 使「边界来自哪」在调用点上可读，而不是埋在模块里的字面量。
 *
 * ⚠ 缺省值经 `thresholdValue()` 从**包内判据注册表**读入（单一真源：params.ts）——
 *   本文件**不出现** `15` / `30` 这两个字面量作为判定依据。
 */
export interface ActivityBoundaries {
  /** 热线：距最近召回 **≤** 该天数 ⇒ 召回轴判「热」（**闭区间**，含 0）。 */
  readonly recentMaxAgeDays: number
  /** 冷线：距最近召回 **>** 该天数 ⇒ 召回轴判「冷」（**左开**：恰等于仍属「温」）。 */
  readonly coldMinAgeDays: number
}

/** 从注册表取缺省边界（**唯一读口**；改 params 即改此处读数）。 */
export function defaultActivityBoundaries(): ActivityBoundaries {
  return Object.freeze({
    recentMaxAgeDays: thresholdValue<number>('forgetting.activity.recentMaxAgeDays'),
    coldMinAgeDays: thresholdValue<number>('forgetting.activity.coldMinAgeDays'),
  })
}

/**
 * 一条待分级记忆的**只读快照**（纯值，无句柄可写）。
 *
 * ⚠ `ageDaysSinceRecall` 与 `activation` 的 `null` 语义**不同**，不可互换：
 *   · `ageDaysSinceRecall: null` ⇒ **无访问记录**（从未被召回）；
 *   · `activation: null`         ⇒ 该轴**无读数**（调用方没算/没提供）。
 *   两者都表示「该轴未知」，但成因不同 ⇒ 读数里分列，便于归因。
 */
export interface ActivitySnapshot {
  readonly memoryId: string
  /**
   * 该条目当前激活值 `A`；`null` = 无读数。
   * `-Infinity` 是**合法**值（未编码的数学极限）。
   */
  readonly activation: number | null
  /**
   * 距最近一次召回的**天数**；`null` = 无访问记录（从未被召回）。
   * 须 `≥ 0`（时钟回拨会让「刚召回」看起来在将来 ⇒ 静默判成「热」，故抛）。
   */
  readonly ageDaysSinceRecall: number | null
  /**
   * 距**创建**的天数。**无访问记录时必填** —— 否则本文件无法判级（会**抛**，不猜）。
   * 有访问记录时可不给。
   */
  readonly ageDaysSinceCreated?: number | null
  /** 累计召回次数（缺省 0）。`0` 且无访问记录 ⇒ 「零召回」的字面事实。 */
  readonly accessCount?: number
  /** 已有归档标记（只读带出；本文件**永不**写回）。 */
  readonly retired?: boolean
}

/** 一条分级读数（**全字段只读**，且两轴分列）。 */
export interface ActivityReading {
  readonly memoryId: string
  /** 合取后的活性级（§16.3 的结论）。 */
  readonly level: ActivityLevel
  readonly label: string
  /** 召回轴单轴结论；`null` = 该轴不可判（既无召回记录也无创建时间）。 */
  readonly recencyLevel: ActivityLevel | null
  /** 激活轴单轴结论；`null` = ⊥（无读数，或无访问记录 ⇒ 按上文规则**不参与**判级）。 */
  readonly activationLevel: ActivityLevel | null
  /** 激活轴的**原始区间**（四区间名；`null` = 未判）。⚠ 与 `level` 不是同一个量。 */
  readonly activationInterval: ArchiveIntervalName | null
  readonly activation: number | null
  readonly ageDaysSinceRecall: number | null
  readonly ageDaysSinceCreated: number | null
  readonly accessCount: number
  /** 无访问记录（`ageDaysSinceRecall === null`）。 */
  readonly neverRecalled: boolean
  /** 激活轴是否因「无访问记录」被判为 ⊥（**本文件的核心规则**，显式带出）。 */
  readonly activationUnknownByNoAccess: boolean
  /** 判定依据（可枚举串；面板直接显示，**不是布尔**）。 */
  readonly basis: readonly string[]
  readonly retired: boolean
}

/** 递归冻结（含数组元素）。 */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as Record<string, unknown>)) deepFreeze((v as Record<string, unknown>)[k])
    Object.freeze(v)
  }
  return v
}

/** 三级序：热 < 温 < 冷（用于「取较冷者」的合取）。 */
const COLDNESS: Readonly<Record<ActivityLevel, number>> = Object.freeze({ hot: 0, warm: 1, cold: 2 })

/** 取较冷者（合取：两个条件都要满足 ⇒ 最严格的那个说了算）。 */
function colder(a: ActivityLevel, b: ActivityLevel): ActivityLevel {
  return COLDNESS[a] >= COLDNESS[b] ? a : b
}

/** 四区间 → 三级活性的**降级映射**（区间比活性级细：declining 与 warm 同属「温」）。 */
function intervalToLevel(iv: ArchiveIntervalName): ActivityLevel {
  if (iv === 'hot') return 'hot'
  if (iv === 'archive') return 'cold'
  return 'warm' // warm | declining
}

/** 校验一个「天数」入参（fail-closed，口径同 `retention.ts`）。 */
function checkAge(v: number, what: string, memoryId: string): number {
  if (!Number.isFinite(v)) {
    throw new Error('activityOf: ' + what + ' 必须是有限数（memoryId=' + memoryId + '，实测 ' + String(v) + '）')
  }
  if (v < 0) {
    throw new Error(
      'activityOf: ' + what + ' 不得为负（memoryId=' + memoryId + '，实测 ' + v + '）' +
        '—— 时钟回拨会让「刚召回」看起来在将来 ⇒ 静默判成「热」',
    )
  }
  return v
}

/**
 * 召回轴：由「距最近一次召回的**天数**」判三级。
 *
 * 边界语义（**必须显式，且由判据逐点断言**）：
 *   · `age ≤ recentMaxAgeDays` ⇒ `hot`（**闭**：恰好在热线**归热**，含 `age = 0`）
 *   · `age > coldMinAgeDays`   ⇒ `cold`（**左开**：恰好在冷线**归温**）
 *   · 其余 ⇒ `warm`
 *
 * ⚠ 判成 `cold` 用**严格大于**而不是 `≥`：§16.3 的「冷」是「长期**零**召回」，
 *   把它压在边界上的那条判成冷，会让「刚好到期」与「过期很久」同样处理 —— 那是把阈值当结论。
 */
export function recencyLevel(ageDays: number, b: ActivityBoundaries): ActivityLevel {
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    throw new Error('recencyLevel: ageDays 必须是 ≥ 0 的有限数（实测 ' + String(ageDays) + '）')
  }
  if (ageDays <= b.recentMaxAgeDays) return 'hot'
  if (ageDays > b.coldMinAgeDays) return 'cold'
  return 'warm'
}

/**
 * 单条分级（**纯函数**：无时钟、无 RNG、不写任何存储）。
 *
 * 判定顺序（可枚举、可复算）：
 *   ① **无访问记录**（`ageDaysSinceRecall === null`）⇒ 激活轴 = ⊥（**不参与**判级）；
 *      召回轴改用「距创建的天数」；两者都没有 ⇒ **抛**（无法判定不得猜成「温」）。
 *   ② 有访问记录 ⇒ 激活轴走 `classify()`（**只读**，τ 由调用方传入）+ 召回轴走 `recencyLevel`；
 *      合取 = `取较冷者`。
 *   ③ 激活值 `= NaN` ⇒ 由 `classify` 抛（NaN 不属于任何区间）。
 *
 * @throws 任一入参非法、或「两轴都不可判」（无召回记录且无创建时间）
 */
export function activityOf(
  snap: ActivitySnapshot,
  tau: number,
  boundaries: ActivityBoundaries = defaultActivityBoundaries(),
): ActivityReading {
  const { memoryId } = snap
  const neverRecalled = snap.ageDaysSinceRecall === null || snap.ageDaysSinceRecall === undefined
  const accessCount = snap.accessCount ?? 0
  const createdRaw = snap.ageDaysSinceCreated === null || snap.ageDaysSinceCreated === undefined ? null : snap.ageDaysSinceCreated
  const createdAt = createdRaw === null ? null : checkAge(createdRaw, 'ageDaysSinceCreated', memoryId)
  const basis: string[] = []

  let ageDays: number | null = null
  if (!neverRecalled) {
    ageDays = checkAge(snap.ageDaysSinceRecall as number, 'ageDaysSinceRecall', memoryId)
    basis.push('recall.has-record')
  } else {
    basis.push('recall.never-recalled')
    if (accessCount === 0) basis.push('recall.zero-count')
    ageDays = createdAt // 从未召回 ⇒ 它的整个生命都是「未召回」，用年龄量它
    if (ageDays === null) {
      throw new Error(
        'activityOf: 无访问记录且未给 ageDaysSinceCreated ⇒ **无法判定**（memoryId=' +
          memoryId +
          '）。拒绝猜成「温」：那会把「没数据」与「判出来是温」压成同一个读数。',
      )
    }
    basis.push('recall.age-from-creation')
  }

  // ── 召回轴（两级都可能不可判，故单独 hold）──
  const rLevel: ActivityLevel | null = ageDays === null ? null : recencyLevel(ageDays, boundaries)
  if (rLevel !== null) {
    basis.push('boundary.recent<=' + String(boundaries.recentMaxAgeDays))
    if (rLevel !== 'hot') basis.push('boundary.cold>' + String(boundaries.coldMinAgeDays))
  }

  // ── 激活轴：无访问记录 ⇒ ⊥（**本文件的核心规则**，见文件头 ⛔ 段）──
  let aLevel: ActivityLevel | null = null
  let interval: ArchiveIntervalName | null = null
  if (neverRecalled) {
    basis.push('activation.unknown-no-access-record')
  } else if (snap.activation === null || snap.activation === undefined) {
    basis.push('activation.no-reading')
  } else {
    const c = classify(memoryId, snap.activation, tau, snap.retired === true)
    interval = c.interval
    aLevel = intervalToLevel(c.interval)
    basis.push('activation.interval.' + c.interval)
  }

  // ── 合取：较冷者说了算（两条件都要满足）；⊥ 不拉低级别 ──
  let level: ActivityLevel
  if (aLevel !== null && rLevel !== null) {
    level = colder(aLevel, rLevel)
    basis.push('combine.meet')
  } else if (aLevel !== null) {
    level = aLevel
    basis.push('combine.activation-only')
  } else if (rLevel !== null) {
    level = rLevel
    basis.push('combine.recency-only')
  } else {
    throw new Error('activityOf: 两轴都不可判（memoryId=' + memoryId + '）')
  }

  return deepFreeze({
    memoryId,
    level,
    label: ACTIVITY_LEVEL_LABELS[level],
    recencyLevel: rLevel,
    activationLevel: aLevel,
    activationInterval: interval,
    activation: snap.activation ?? null,
    ageDaysSinceRecall: snap.ageDaysSinceRecall ?? null,
    ageDaysSinceCreated: createdAt,
    accessCount,
    neverRecalled,
    activationUnknownByNoAccess: neverRecalled,
    basis: Object.freeze(basis),
    retired: snap.retired === true,
  })
}

/** 整批分级视图（含**它自己的**输入量/未校准状态，不藏在调用方）。 */
export interface ActivityView {
  readonly view: 'read-only'
  /** 恒 `false`：本视图不写任何行（与 `prune.ts#PruneView` 同口径）。 */
  readonly writes: false
  readonly byLevel: Readonly<Record<ActivityLevel, readonly ActivityReading[]>>
  readonly flat: readonly ActivityReading[]
  readonly tau: number
  readonly boundaries: ActivityBoundaries
  /** 边界是否**已校准**。恒 `false`（注册表 samples=0，v10 无值）—— 生效与否都如实回报。 */
  readonly boundariesCalibrated: false
  /** 输入量（**显式记 0**：「无输入」与「未消费」须可分辨）。 */
  readonly inputCount: number
  /** 无访问记录的条数（单列 —— 否则「新记忆」会混进「冷」的计数里）。 */
  readonly neverRecalledCount: number
  /** 激活轴因无访问记录被判 ⊥ 的条数（= 上者；分列以防将来两条规则分叉时静默合流）。 */
  readonly activationUnknownCount: number
}

/**
 * 整批分级（**纯函数**）。缺桶显式给空数组（**不省略键**）。
 *
 * ⚠ `tau` 是**必填**参数（不给缺省）：本包对 τ 的来源只有一个（装配期取 `long-term`，
 *   缺失走 `TAU_FALLBACK`，由 `index.ts#apply` 解析后传入）。在此处再写一个缺省值，
 *   就等于让「没接上真源」与「用了那个缺省」在读数上同形。
 */
export function classifyActivity(
  items: readonly ActivitySnapshot[],
  tau: number,
  boundaries: ActivityBoundaries = defaultActivityBoundaries(),
): ActivityView {
  if (!Number.isFinite(tau)) throw new Error('classifyActivity: τ 必须是有限数（实测 ' + String(tau) + '）')
  const byLevel: Record<ActivityLevel, ActivityReading[]> = { hot: [], warm: [], cold: [] }
  const flat: ActivityReading[] = []
  let neverRecalledCount = 0
  let activationUnknownCount = 0
  for (const it of items) {
    const r = activityOf(it, tau, boundaries)
    byLevel[r.level].push(r)
    flat.push(r)
    if (r.neverRecalled) neverRecalledCount += 1
    if (r.activationUnknownByNoAccess) activationUnknownCount += 1
  }
  return deepFreeze({
    view: 'read-only' as const,
    writes: false as const,
    byLevel,
    flat,
    tau,
    boundaries,
    boundariesCalibrated: false as const,
    inputCount: items.length,
    neverRecalledCount,
    activationUnknownCount,
  })
}

/**
 * 与既有 retirement 流程的**衔接面**（§16.3 的「冷 ⇒ 降级提纯，归档」）。
 *
 * ⚠ 返回的是**清单**不是执行：案 §8.3（`docs/mana-v5-plan.md:578-580`）「物理删除永不发生」，
 *   本包 `retirementPlan().unimplemented` 仍列着「retired 置位」未实现。
 *   本函数与 `archive.ts#retireCandidates` 同为**只读候选**，命名不带 Candidates 是因为它按**活性级**筛，
 *   而非按归档区间（两者口径不同：见下 `activityRetirementJunction`）。
 */
export function coldCandidates(view: ActivityView): readonly ActivityReading[] {
  return view.byLevel.cold
}

/**
 * **两口径的对账**（活性级 vs 归档区间）—— 让「冷」与「archive 区间」不一致时**可见**，而不是各自成说。
 *
 * ⚠ 为什么需要它：本包此前已有一句裁定「修剪视图是四区间归档之上的视图」，靠的是**数据上同源**
 *   （`retireCandidates` 与 `pruneCandidates` 用同一条线）。本文件引入第二条轴（召回），
 *   若不给对账面，两个清单会**各自成说**且无人能发现差异 —— 那正是本仓点名的「两个真源」的起点。
 *
 * 差异有三种确定归属（**逐条列出，不合并成一个数**）：
 *   · `coldNotArchived` ：「冷」但激活区间未到 archive ⇒ **有访问记录的**旧记忆（召回轴把它压冷）；
 *   · `archivedNotCold`：「archive 区间」**但召回轴不认为是冷** ⇒ 激活低而**近期被召回**（两轴冲突，须人看）；
 *   · `agreeCount`      ：两口径一致。
 *
 * ⚠ **本对账刻意按「轴级」而非「级级」比对**（实测发现，不是风格选择）：
 *   若把 `archivedNotCold` 定义成「区间 = archive 但**活性级 ≠ 冷**」，它将**结构性恒为空** ——
 *   因为 `intervalToLevel(archive) = cold`，而合取取**较冷者** ⇒ archive 区间必然产出冷级，
 *   没有任何输入能填满该字段。那正是本仓点名的「声明了但无人产生」。
 *   故第二项改判**召回轴**（`recencyLevel !== 'cold'`）：此时两轴**真的在打架**
 *   （激活说该归档、召回说刚被用过），才是值得人看的冲突。
 */
export interface ActivityRetirementJunction {
  /** 「冷」但**不在** archive 区间（有访问记录者）。 */
  readonly coldNotArchived: readonly string[]
  /**
   * 在 archive 区间**但召回轴不认为是冷**（两轴冲突；无访问记录者不计入 —— 它们的激活轴按规则 ⊥）。
   * ⚠ 判据是**召回轴**而非最终活性级：级级判法会恒空（见上方 ⚠ 段）。
   */
  readonly archivedNotCold: readonly string[]
  /** 两口径一致的条数。 */
  readonly agreeCount: number
  /** 无法比对（激活轴 ⊥ 或无区间）的条数，**单列**。 */
  readonly notComparableCount: number
  readonly activityColdCount: number
  /** 归档区间条数（对齐 `archive.ts#archiveIntervalRows` 的口径）。 */
  readonly archiveIntervalCount: number
}

/** 两口径对账（**纯函数**，不写库）。 */
export function activityRetirementJunction(view: ActivityView): ActivityRetirementJunction {
  const coldNotArchived: string[] = []
  const archivedNotCold: string[] = []
  let agreeCount = 0
  let notComparableCount = 0
  let archiveIntervalCount = 0
  for (const r of view.flat) {
    if (r.activationInterval === 'archive') archiveIntervalCount += 1
    if (r.activationInterval === null) {
      notComparableCount += 1
      continue
    }
    const inArchive = r.activationInterval === 'archive'
    const isCold = r.level === 'cold'
    // ⚠ 第二项比的是**召回轴**：级级判法会恒空（archive 区间 → cold 级 → 永远「也冷」）。
    const recencySaysCold = r.recencyLevel === 'cold'
    if (isCold && !inArchive) coldNotArchived.push(r.memoryId)
    else if (inArchive && !recencySaysCold) archivedNotCold.push(r.memoryId)
    else agreeCount += 1
  }
  return deepFreeze({
    coldNotArchived: Object.freeze(coldNotArchived),
    archivedNotCold: Object.freeze(archivedNotCold),
    agreeCount,
    notComparableCount,
    activityColdCount: view.byLevel.cold.length,
    archiveIntervalCount,
  })
}

/** 一行摘要（面板用；**只读**，不含可执行面）。 */
export function activitySummary(view: ActivityView): string {
  const c = view.byLevel.cold.length
  return (
    '活性分级（只读）：热 ' + view.byLevel.hot.length + ' / 温 ' + view.byLevel.warm.length + ' / 冷 ' + c +
    '（共 ' + view.inputCount + ' 条） ｜ 边界 热≤' + view.boundaries.recentMaxAgeDays + 'd · 冷>' + view.boundaries.coldMinAgeDays + 'd（未校准）' +
    ' ｜ 无访问记录 ' + view.neverRecalledCount + ' 条（激活轴不参与判级）'
  )
}

/** 供判据/面板遍历的**实现面清单**（本文件自己报；不混进 `IMPLEMENTED_EXPORTS` 或 A1-5 判据面）。 */
export const ACTIVITY_EXPORT_FACE: readonly string[] = Object.freeze([
  'ACTIVITY_LEVELS',
  'ACTIVITY_LEVEL_LABELS',
  'ACTIVITY_EXPORT_FACE',
  'defaultActivityBoundaries',
  'recencyLevel',
  'activityOf',
  'classifyActivity',
  'coldCandidates',
  'activityRetirementJunction',
  'activitySummary',
] as const)

// 本文件**不**转发 `ArchiveIntervalName`：它是 `params.ts` 的导出面，转发会在本模块再造一个入口
// （多入口 ⇒ 改真源时「哪一处该跟」不明确）。需要它的消费者从 `params.ts` / `index.ts` 取。
