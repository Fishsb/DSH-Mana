/**
 * **大环路递归检索**（v10 §12.5「大环路递归」/ §14.7「大环路递归检索」）—— 本仓此前**零落点**。
 *
 * ── v10 原文（§12.5 逐字；§14.7 是同一形状的检索侧写法）──────────────────────────
 * ```
 * 检索 → 关联线索提取 → 新查询 → 跨事件整合 → 检测收敛 → 去重排序
 * ```
 * 六个环节在本文件里各落成**一个可断言的对象**（不是六句注释）：
 *
 * | 环节 | 落点 | 读数（断言面） |
 * |---|---|---|
 * | ① 检索 | `opts.retrieve(query, round)`（**由调用方注入**，见"为什么不自己检索"） | `rounds[i].rawCount` |
 * | ② 关联线索提取 | 候选的 `clues` ⇒ `cluesByKey` | `rounds[i].cluesBefore/cluesAfter/clueGainAfter` |
 * | ③ 新查询 | 线索 → `BigLoopQuery{query, from}` | `rounds[i].newQueries`、`result.pendingQueries` |
 * | ④ 跨事件整合 | `mergeCandidates(observations)`（**纯函数、幂等**） | `mergedRows` / `observations` / `multiRoundKeys` |
 * | ⑤ 检测收敛 | 三条自然判据 + **硬上限** + 错误腿（终止表见下） | `status` / `stopReason` / `capped` |
 * | ⑥ 去重排序 | `merged` 的确定序（融合分 → 同道分 → 首见轮 → 键） | `merged[].rounds`：**同一候选进两次仍是一行** |
 *
 * ── ⑤ 的终止表（**收敛必须可判定、且有硬上限**；本表即判据的机检锚点）──────────────
 * | 终止原因（`stopReason`） | 类别 | 触发条件 | 读数里怎么分辨 |
 * |---|---|---|---|
 * | `clue-frontier-empty` | converged | 本轮**一个新键都没带出**（前沿变空） | `stopReason` + `rounds[i].grewBy=0` |
 * | `growth-below-threshold` | converged | 本轮增长 `grewBy/knownBefore` **<** `knobs.growLimit` | `stopReason` + `rounds[i].growthRatio` |
 * | `observed-saturation` | converged | 本轮观测键里**已知键占比 ≥** `knobs.overlapLimit`（检索饱和） | `stopReason` + `rounds[i].observedOverlap` |
 * | `max-rounds` | **capped** | `roundsRun >= knobs.maxRounds`（**硬上限**，防无界递归 = 活锁） | `status='capped'`（**与 converged 不是同一个值**）+ `capped=true` |
 * | `search-error` | error | 检索端口抛错 / 返回非数组 | `status='error'` + `rounds[i].status='error'` + `error` 原文（**不吞**） |
 *
 * 另有两种**没有跑**的状态（`ran=false`、`rounds=[]`、`stopReason=null`、**原因非空**）：
 * `status='disabled'`（显式关闭）与 `status='no-candidate'`（初始候选为空）—— 它们措辞不同、
 * 取值不同，且都**不**冒充"收敛"（`docs/contract/degradation.md` 硬约定 2/3）。
 *
 * ── 重叠率的方向（易写反，故单独写出来）──────────────────────────────────────────
 * 「重叠率」有两个方向，它们是**相反**的判据，写反了会把"还在发现新东西"读成"已收敛"：
 * · 本次新一轮检索带回来的东西与**既有**候选集的重叠 —— **高** ⇒ 检索已**饱和**（收敛）；
 *   ⇒ 本文件取这一支（`observed-saturation`），阈值 `overlapLimit`（缺省 0.6）。
 * · 代价如实写出：**它允许在仍有新键滴入时停**（"新查询已经只带回老东西"与"彻底没有新东西"
 *   是两件事）。故 `observedOverlap` 是**必读读数** —— 判据靠它把"饱和停"与"真的没有新键停"
 *   分辨开；要更严格就把它调高，调到 1 即"必须全老才停"。
 * · 第 1 轮**不做该项判定**：那时已知集就是种子，这个量没有可比较的基准
 *   （`rounds[0].observedOverlap` 恒**显式记 0**，且判据里带 `round >= 2` 守卫）。
 *
 * ── 判据优先级（顺序本身是一条判据，必须写出来）────────────────────────────────
 * `search-error` → `clue-frontier-empty` → `growth-below-threshold` →
 * `observed-saturation` → `max-rounds`。
 * 前四条是"**这一轮的产出**说话"，最后一条是"**轮次预算**说话" ⇒ 先判产出、后判预算。
 * 代价（有意选的）：**恰好在预算那一轮自然收敛**的运行报 `converged` 而不是 `capped` ——
 * "本来就收敛了"与"被上限掐停"必须分开，否则"到点了"会把"收敛"吃掉（本仓最防的形态）。
 *
 * ── 硬上限：`maxRounds` 与"更少的天然终止"是两件事，都要有──────────────────────
 * · 三条自然判据**可能一条都不触发**（每轮都带回新键、且新键占比始终高于阈值）；
 * · 那时**唯一**的出口是 `knobs.maxRounds`，**且只能是它** —— 本模块没有 `while(true)` 形态：
 *   循环体恒 `for (let round = 1; round <= knobs.maxRounds; round++)`，运行期改不了上界；
 * · 无待发查询时**不静默停**，而是走**重试腿**（重复上一条查询，`rounds[i].repeat=true`）——
 *   "没有新问题可问"不等于"问完了"，停与不停必须由**显式判据**而非查询池枯竭决定（这正是
 *   活锁形态的入口：静默续跑与静默停都不能有，**只有显式终止**）。
 * · `DEFAULT_BIGLOOP_KNOBS.maxRounds = 6`；`BIGLOOP_SAME_QUERY_CEILING = HARD_MAX + 1` 由
 *   `HARD_MAX_ROUNDS` 派生 —— 存在 `maxRounds = HARD_MAX_ROUNDS` 的配置（判据取证位），
 *   该值下的检索调用次数由**结构**限定为 `HARD_MAX_ROUNDS + 1` 次同一个查询（首轮 1 次 +
 *   最多重试 `HARD_MAX` 次），不是估计值。
 *
 * ── 为什么不自己检索（注入检索端口的取舍，代价必须写出来）──────────────────────────
 * 本仓目前**没有跨包共同的检索端口类型**：vector 的 `RecallOutcome`、long-term 的 FTS5 面、
 * graph 的 `GraphLegResult` 三者形状不同。本包内若 `import` 它们，就是凭空新增依赖边
 * （与 `graph.ts` 拒绝 `vector→learning` 的处置同源）；若在 vector 里**新造**一个端口类型，
 * 又会出现"两套检索面各说各话"。⇒ 取**注入**：调用方传 `retrieve`（一行适配
 * `(q) => svc.recall(q, candidates, topK)`），本模块只认**最小候选形状**。
 * 代价：调用方必须写一行适配器，且适配器写歪了本模块看不出来 —— 由调用点的判据承担。
 *
 * ── 边界自证（本模块**不**做什么；判据逐条机检）────────────────────────────────
 * · **零注册点**：无 `ctx.on`/`ctx.waterfall`/`ctx.effect`、无定时器、无 pre-step；
 * · **零 IO**：不读文件、不开库、不发网络 —— 唯一的输入是调用方的 `retrieve` 与入参；
 * · **零事件**：不 `emit`、不 `writeTrace`、不 `import 'dsh-mana-core'` ⇒
 *   **结构上不可能触碰 Events 契约**（`ManaObservation`/`ManaRecall` 等一个字段都没碰）；
 * · **零依赖新增**：不 import 本包任何其它 src 文件（`rrf.ts` 的 k 值取**孪生常量**，
 *   等价性由 `tests/bigloop.test.mjs` 的对拍断言保证），故本文件与并行在途席**写面不重叠**；
 * · **零写库**：本文件没有任何 SQL；
 * · **纯函数面**：`sumClueGain` / `overlapRatio` / `fuseScore` / `rankAcrossRounds` /
 *   `mergeCandidates` 皆确定性纯函数（无随机、不读时钟参与判定；`ms` 只是 B 档测量条件读数）。
 */

// ══ 配置面（**唯一**默认值真源）══════════════════════════════════════════════

/** 大环路的旋钮（**只有总开关进宿主配置面**：其余"能改行为"的开关只在显式传参时生效）。 */
export interface BigLoopKnobs {
  /** 总开关。`false` ⇒ **一次检索都不发**（显式关闭，不是故障）。 */
  readonly enabled: boolean
  /**
   * **硬上限**（轮数）。到点即停并报 `max-rounds`/`capped=true`。
   * ⚠ 唯一有代价的旋钮：它是"活锁"与"正常长跑"的**唯一**分野，故缺省给足（6）而不是 1。
   */
  readonly maxRounds: number
  /**
   * 轮增长阈值：`grewBy / |knownBefore|` **<** 该值 ⇒ 判定收敛（增长已趋于停滞）。
   * `0` = **关掉这条判据**（由 `> 0` 守卫保证，不靠比较方向）。
   */
  readonly growLimit: number
  /**
   * **饱和**阈值：本轮观测键里**已知键占比 ≥** 该值 ⇒ 判定收敛（检索已饱和）。
   * `1` = 最严格（必须全部是老键才停）；`0` = **关掉这条判据**（显式 `> 0` 守卫 ——
   * 若只靠比较方向，0 会变成"**永远**饱和"，即"关闭位"与"最激进位"撞值）。
   * ⚠ 方向说明见文件头「重叠率的方向」——写反会把"还在发现新东西"读成"已收敛"。
   */
  readonly overlapLimit: number
  /** 前沿为空（本轮无新键）即收敛。`false` ⇒ 交给增长阈值与硬上限。 */
  readonly stopOnEmptyFrontier: boolean
  /** 每轮最多产出多少条新查询（`0` = 不产出新查询 ⇒ 后续轮走重试腿）。 */
  readonly maxNewQueriesPerRound: number
}

/** 缺省旋钮（**唯一**真源；对象冻结 ⇒ 就地改写会在运行期立刻抛错）。 */
export const DEFAULT_BIGLOOP_KNOBS: BigLoopKnobs = Object.freeze({
  enabled: true,
  maxRounds: 6,
  growLimit: 0.25,
  overlapLimit: 0.6,
  stopOnEmptyFrontier: true,
  maxNewQueriesPerRound: 3,
})

/**
 * 硬上限的**结构**上界（轮数）：`maxRounds` 超过它即抛 —— **不静默 clamp**
 * （静默 clamp 会让"你要了 100 轮"与"你要了 32 轮"拿到同一个运行，不可分辨）。
 */
export const HARD_MAX_ROUNDS = 32 as const

/**
 * 同一个查询连跑的上界（供调用方的看门狗使用；**本模块不读时钟、不设定时器**）。
 * `HARD_MAX + 1` 的来历：首轮 1 次 + 最多重复 `HARD_MAX` 次 ⇒ 这就是本模块在
 * `maxRounds = HARD_MAX_ROUNDS` 下的**最大检索调用次数**（结构性上界，不是估计值）。
 */
export const BIGLOOP_SAME_QUERY_CEILING = (HARD_MAX_ROUNDS + 1) as number

/** 融合常数（与 `rrf.ts` 的 `RRF_DEFAULT_K` **同值**：孪生常量 + 判据对拍，不引依赖边）。 */
export const BIGLOOP_RRF_K = 60 as const

/** 轮次即名次域（RRF 的定义域是名次）：第 `r` 轮（从 0 起）的名次 = `r + 1`。 */
const ROUND_RANK_OFFSET = 1 as const

/** 未启用（**配置**，措辞与"失败"不同）。 */
export const BIGLOOP_DISABLED_REASON =
  '大环路已**显式关闭**（knobs.enabled=false）：本次一次检索都没发' as const
/** 初始候选为空（合法输入，非故障 —— N=0 显式记 0，G5）。 */
export const BIGLOOP_NO_CANDIDATE_REASON =
  '初始候选为空（baseCandidates/baseKeys 皆空）⇒ 大环路无起点，未发任何检索' as const
/** 各条失败原因的公共前缀（判据按前缀断言，措辞改动不再造成假红）。 */
export const BIGLOOP_REASON_PREFIX = '大环路：' as const

/**
 * 终止原因的**可枚举表**（原因 → 类别）。判据逐条对照它 ⇒ **不存在未命名的终止**：
 * `stopReason` 的每一个取值都在这张表里，且类别决定 `status`。
 */
export const BIGLOOP_TERMINALS = Object.freeze({
  'clue-frontier-empty': 'converged',
  'growth-below-threshold': 'converged',
  'observed-saturation': 'converged',
  'max-rounds': 'capped',
  'search-error': 'error',
} as const)

export type BigLoopStopReason = keyof typeof BIGLOOP_TERMINALS
/** 终止类别：`converged` = 自然收敛 / `capped` = 达硬上限 / `error` = 检索腿坏了。 */
export type BigLoopTerminalKind = (typeof BIGLOOP_TERMINALS)[BigLoopStopReason]

/** 一次运行的整体状态（`converged` 与 `capped` **不是同一个值** —— 这就是可分辨的落点）。 */
export type BigLoopStatus = BigLoopTerminalKind | 'disabled' | 'no-candidate'

// ══ 形态与类型面 ═══════════════════════════════════════════════════════════

/**
 * 最小候选形状（跨通道的最小公倍数）。
 * ⚠ **不引入跨通道归一**：`score` 永远是"**它自己那个通道的分数域**里的数"，
 *   只在同一轮内作平局裁决；跨轮排序只用 RRF（名次域，跨查询稳定）—— 与 `rrf.ts`
 *   拒绝"加权和"的理由同源。
 */
export interface BigLoopCandidate {
  /** 稳定键（本仓用 `memory_items.id`）。空串/非字符串 ⇒ 该条计入 `malformed`（不静默丢）。 */
  readonly key: string
  /** 单轮分数（可选；缺省 0）。非有限数 ⇒ 该条计入 `malformed`。 */
  readonly score?: number
  /** 命中的检索通道名（可选；缺省空集）。非字符串项 ⇒ **整条**计入 `malformed`。 */
  readonly channels?: readonly string[]
  /**
   * **关联线索**（图腿产物 / 共现边 / 新查询的来源）。**它决定下一轮问什么**（③）。
   * ⚠ 形状非法（非数组、或数组里有非字符串项）**不得**静默读成"没有线索"：
   *   落 `clueState='other'`（有线索但抽不出来）并计入 `malformed` —— 与 `'none'`
   *   （本来就没有）**必须可分辨**（`graph.ts` 的四态纪律同一处置）。
   */
  readonly clues?: readonly string[]
}

/** 一条新查询（③ 的产出）：查询串 + **它从哪些键的线索来**（provenance 可反查）。 */
export interface BigLoopQuery {
  readonly query: string
  readonly from: readonly string[]
}

/**
 * **② 的产出**：一条候选在一次轮次里的观测（跨轮整合的**输入原子**）。
 * `(key, round)` 唯一 —— 同一键在两轮里出现 = **两条观测**，但 `mergeCandidates` 后
 * **只有一行**（"进两次 ≠ 两条"）。
 */
export interface BigLoopObservation {
  readonly key: string
  readonly round: number
  /** 该轮的通道分（**未归一**；仅作同道平局裁决）。 */
  readonly score: number
  readonly channels: readonly string[]
  readonly clues: readonly string[]
  /** `none` = 本来就没有线索 / `string` = 抽到了 / `other` = 有但抽不出来（三态可分辨）。 */
  readonly clueState: 'none' | 'string' | 'other'
}

/** **⑥ 的产出**：跨轮整合后的一行候选（**幂等**：同一键恒一行，`rounds` 记它进过哪几轮）。 */
export interface BigLoopMergedItem {
  readonly key: string
  /** 跨轮融合分 = Σ over `rounds` of `1/(k + round + 1)`（**每个轮次只计一次** ⇒ 幂等的落点）。 */
  readonly fused: number
  /** 该键在任一轮里拿到的**最大**通道分（只在同道内可比）。 */
  readonly bestScore: number
  /** 它出现在哪几轮（去重、升序）；`>1` 条 ⇒ 折叠过一次，仍是**一行**。 */
  readonly rounds: readonly number[]
  /** 命中的**轮次数**（= `rounds.length`）。 */
  readonly hits: number
  readonly firstRound: number
  readonly channels: readonly string[]
  readonly clues: readonly string[]
  readonly clueState: 'none' | 'string' | 'other'
}

/** 一轮的完整读数（"这一轮跑到哪一步"的全部可断言事实）。 */
export interface BigLoopRound {
  readonly round: number
  /** 本轮实际发出去的查询串（重试腿时 = 上一条查询，见 `repeat`）。 */
  readonly query: string
  /** 本条查询的来源键（provenance）；重试腿为空数组。 */
  readonly from: readonly string[]
  /** `true` ⇔ 本轮因"无待发查询"而重复上一条查询（**不静默停**的落点）。 */
  readonly repeat: boolean
  /** `ok` / `error`（检索端口坏了 ⇒ 立即停，随后 `stopReason='search-error'`）。 */
  readonly status: 'ok' | 'error'
  readonly error: string | null
  /** 端口返回的原始条数（未去重、未剔除）。 */
  readonly rawCount: number
  /** 同一轮内重复键被折叠的条数（`rawCount - 去重后条数`）。 */
  readonly dedupedInRound: number
  /** 形状非法被剔除的条数（**不静默丢**；N=0 显式记 0）。 */
  readonly malformed: number
  /** 本轮观测到的**不同键**数（= 新增观测条数）。 */
  readonly observedCount: number
  /** 其中**从未见过**的键数（= 前沿增量）。 */
  readonly grewBy: number
  /** 返回的键里**已被此前轮次见过**的条数（`observedCount - grewBy`；`>0` 即发生了整合）。 */
  readonly rescanHits: number
  /** 本轮结束时的已知键总数（含初始种子）。 */
  readonly knownCount: number
  /** 增量通道分之和（读数：**不参与任何终止判定** —— 分数域不可跨通道比较）。 */
  readonly addScore: number
  /** `grewBy / |knownBefore|`；`|knownBefore|=0` 时按 `0` 记（G5：N=0 显式记 0）。 */
  readonly growthRatio: number
  /**
   * 本轮观测键里**已知键占比**（饱和读数）。
   * 第 1 轮恒 `0`（**已知集就是种子，该量无基准** ⇒ 显式记 0 且判据带 `round>=2` 守卫）。
   */
  readonly observedOverlap: number
  /** 前沿（clue frontier）**输入**的键数（第 1 轮 = 本轮观测到的键，其后 = 上轮新键）。 */
  readonly clueInputKeys: number
  readonly cluesBefore: number
  readonly cluesAfter: number
  /** 线索增益之和（`sumClueGain`）—— 与条数分开记：同一条线索重复出现**不增益**。 */
  readonly clueGainAfter: number
  readonly queriesBefore: number
  readonly queriesAfter: number
  /** 本轮**新产出**的查询数。 */
  readonly newQueries: number
  /** 前沿线索里**已被问过**的占比（读数；第 1 轮 = 0）。 */
  readonly queryOverlap: number
  /** 本轮结束后队列里的待发查询数（增量，不展开 ⇒ 读数不随规模膨胀）。 */
  readonly pendingAfter: number
  /** **本轮之后**的前沿大小（前沿空且 `stopOnEmptyFrontier` ⇒ 它同时是收敛读数）。 */
  readonly frontierAfter: number
  /** 本轮耗时（**B 档**：只作测量条件读数，**绝不进任何判据**）。 */
  readonly ms: number
}

/** 一次大环路的**完整读数**。 */
export interface BigLoopResult {
  /** 检索真的发出去过吗（`false` ⇔ 一次都没发）。 */
  readonly ran: boolean
  readonly status: BigLoopStatus
  /** 终止原因（**非空 ⇔ 跑过**）；取值域 = `BIGLOOP_TERMINALS` 的键。 */
  readonly stopReason: BigLoopStopReason | null
  /** 是否**达硬上限**而停（**只有 `max-rounds` 为 `true`** —— 与"收敛"不共用一个布尔）。 */
  readonly capped: boolean
  /** 未跑/失败/未收敛原因（**非空 ⇔ `status !== 'converged'`**）。 */
  readonly reason: string | null
  /** 生效的旋钮（**回显**：没有它，"为什么停"要看调用方当时传了什么，不可判）。 */
  readonly knobs: BigLoopKnobs
  readonly rounds: readonly BigLoopRound[]
  readonly roundsRun: number
  /** 停止后**还能继续问**的查询（**不静默丢弃**：它们是续跑/下一批的输入）。 */
  readonly pendingQueries: readonly BigLoopQuery[]
  /** 停止后剩下的前沿键（空 ⇔ 确实没有新线索了）。 */
  readonly frontier: readonly string[]
  /** ⑥ 的产出（**确定序**：fused 降 → 同道分降 → 首见轮升 → 键升）。 */
  readonly merged: readonly BigLoopMergedItem[]
  /** 去重后的行数（= `merged.length` = |已知键|；**同一候选进两次 ≠ 两条**的落点）。 */
  readonly mergedRows: number
  /** 观测原子数（`(key, round)` 唯一）。`> mergedRows` ⇔ 有候选跨轮出现并被折叠。 */
  readonly observations: number
  /** 跨轮出现的键数（`rounds.length > 1` 的行数）—— 折叠了多少行。 */
  readonly multiRoundKeys: number
  /** ② 抽到的全部线索（去重、升序）。 */
  readonly clues: readonly string[]
  /** 初始输入里形状非法被剔除的条数（**不静默丢**）。 */
  readonly seedMalformed: number
  /** 实际读取口径（可读）：调了几次端口、消费了几条查询。 */
  readonly consumed: string
}

/** 判据专用覆盖口（生产路径不传；与 `graph.ts` 的 `overrides` 同纪律）。 */
export interface BigLoopOverrides {
  /** 强制旋钮（负向对拍位：如把增长阈值置 0 ⇒ 必须跑到硬上限）。 */
  readonly knobs?: Partial<BigLoopKnobs>
}

export interface BigLoopOptions {
  /** 初始查询（③ 的起点）。空串 ⇒ 抛（调用方的编程错，不是运行期降级）。 */
  readonly baseQuery: string
  /** 初始候选（④ 的起点）。 */
  readonly baseCandidates?: readonly BigLoopCandidate[]
  /** 初始键（**只有键**时用；与 `baseCandidates` 取并集）。 */
  readonly baseKeys?: readonly string[]
  /**
   * **检索端口**（① ；由调用方注入，见文件头"为什么不自己检索"）。
   * 返回数组（可为 Promise）。**抛错 / 返回非数组 ⇒ 停并报 `search-error`**，
   * **不重试、不静默跳过** —— 吞掉它就等于把"腿坏了"与"这轮没结果"压成同一个读数。
   */
  readonly retrieve: (query: string, round: number) => readonly BigLoopCandidate[] | Promise<readonly BigLoopCandidate[]>
  readonly knobs?: Partial<BigLoopKnobs>
  /** ⚠ **判据专用**（生产路径不传）：见 `BigLoopOverrides`。 */
  readonly overrides?: BigLoopOverrides
}

// ══ 纯函数面（确定性；判据可直接调）════════════════════════════════════════

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * 线索增益之和（② 的读数）：`Σ (1 + len/64)^(-1)` over **去重后按字典序**的线索。
 * 同一条线索出现两次**只计一次** ⇒ 与 ④ 的去重同源（幂等），不是"再数一遍"。
 */
export function sumClueGain(clues: readonly string[]): number {
  let sum = 0
  for (const c of [...new Set(clues)].sort()) sum += 1 / (1 + c.length / 64)
  return sum
}

/** 重叠率 = `|items ∩ known| / |items|`；`items` 为空 ⇒ **0**（G5：N=0 显式记 0，不抛）。 */
export function overlapRatio(items: readonly string[], known: ReadonlySet<string>): number {
  if (!items.length) return 0
  let hit = 0
  for (const k of items) if (known.has(k)) hit += 1
  return hit / items.length
}

/**
 * 轮次 → 融合分（**名次域**，跨查询可比）：`1/(k + rank)`，`rank = round + 1`。
 * ⚠ 与 `rrf.ts` 的 `rrfTerm` **同式**（孪生常量 `BIGLOOP_RRF_K` = `RRF_DEFAULT_K`）；
 *   本文件不 import 它（不新增依赖边），等价性由判据对拍（`tests/bigloop.test.mjs` ④）。
 */
export function fuseScore(round: number, k: number = BIGLOOP_RRF_K): number {
  return 1 / (k + Math.max(1, round + ROUND_RANK_OFFSET))
}

/**
 * **④ 跨事件整合**（**幂等**）：`(key, round)` 去重 ⇒ 每个键一行。
 *
 * 三条可断言的性质（判据逐条取证）：
 * 1. **幂等**：`merge(obs ∪ obs)` 与 `merge(obs)` **逐字相等** —— "进两次 ≠ 两条"；
 * 2. **轮次去重参与计分**：同一键在同一轮出现两次，`fused` **只吃一次**该轮的分量；
 * 3. **确定序**：`fused` 降 → `bestScore` 降 → `firstRound` 升 → 键升（不依赖 sort 稳定性）。
 */
export function mergeCandidates(observations: readonly BigLoopObservation[]): BigLoopMergedItem[] {
  const rounds = new Map<string, Set<number>>()
  const best = new Map<string, number>()
  const first = new Map<string, number>()
  const chans = new Map<string, Set<string>>()
  const clues = new Map<string, Set<string>>()
  const states = new Map<string, 'none' | 'string' | 'other'>()

  const foldState = (a: 'none' | 'string' | 'other', b: 'none' | 'string' | 'other'): 'none' | 'string' | 'other' =>
    a === 'other' || b === 'other' ? 'other' : a === 'string' || b === 'string' ? 'string' : 'none'

  for (const o of observations) {
    let rs = rounds.get(o.key)
    if (!rs) {
      rs = new Set<number>()
      rounds.set(o.key, rs)
      first.set(o.key, o.round)
    }
    rs.add(o.round) // ← 同一 (key, round) 进两次**不增加集合元素** ⇒ 幂等的机械落点
    const prevBest = best.get(o.key)
    if (prevBest === undefined || o.score > prevBest) best.set(o.key, o.score)
    const curFirst = first.get(o.key) as number
    if (o.round < curFirst) first.set(o.key, o.round)
    const cs = chans.get(o.key) ?? new Set<string>()
    for (const c of o.channels) cs.add(c)
    chans.set(o.key, cs)
    const ls = clues.get(o.key) ?? new Set<string>()
    for (const c of o.clues) ls.add(c)
    clues.set(o.key, ls)
    // 三态合并：任一 'other' ⇒ 'other'（"抽不出来"不得被别处的 'string' 洗白）
    states.set(o.key, foldState(states.get(o.key) ?? 'none', o.clueState))
  }

  const out: BigLoopMergedItem[] = []
  for (const [key, rs] of rounds) {
    const list = [...rs].sort((a, b) => a - b)
    let fused = 0
    for (const r of list) fused += fuseScore(r)
    out.push({
      key,
      fused,
      bestScore: best.get(key) ?? 0,
      rounds: list,
      hits: list.length,
      firstRound: first.get(key) ?? 0,
      channels: [...(chans.get(key) ?? [])].sort(),
      clues: [...(clues.get(key) ?? [])].sort(),
      clueState: states.get(key) ?? 'none',
    })
  }
  out.sort(
    (x, y) =>
      y.fused - x.fused ||
      y.bestScore - x.bestScore ||
      x.firstRound - y.firstRound ||
      (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
  )
  return out
}

/** ⑥ 的排序口径（**唯一**处；两处排序即两处漂移）。`fused` 已含"命中轮次数"的语义。 */
export function rankAcrossRounds(merged: readonly BigLoopMergedItem[]): BigLoopMergedItem[] {
  return [...merged]
}

// ══ 主入口 ═════════════════════════════════════════════════════════════════

/** 旋钮归一 + 边界校验（越界**抛**，不静默 clamp —— clamp 会制造"两件事同形"）。 */
function normalizeKnobs(input: Partial<BigLoopKnobs>): BigLoopKnobs {
  const k: BigLoopKnobs = { ...DEFAULT_BIGLOOP_KNOBS, ...input }
  const int = (name: string, v: number, lo: number, hi: number): number => {
    if (!Number.isInteger(v) || v < lo || v > hi) {
      throw new RangeError(`runBigLoop: ${name} 必须是 ${lo}..${hi} 的整数，实测 ${String(v)}`)
    }
    return v
  }
  int('maxRounds', k.maxRounds, 1, HARD_MAX_ROUNDS)
  int('maxNewQueriesPerRound', k.maxNewQueriesPerRound, 0, 64)
  if (!Number.isFinite(k.growLimit) || k.growLimit < 0) {
    throw new RangeError(`runBigLoop: growLimit 必须是非负有限数（0 = 关掉该判据），实测 ${String(k.growLimit)}`)
  }
  if (!Number.isFinite(k.overlapLimit) || k.overlapLimit < 0 || k.overlapLimit > 1) {
    throw new RangeError(`runBigLoop: overlapLimit 必须是 0..1 的有限数（0 = 关掉该判据），实测 ${String(k.overlapLimit)}`)
  }
  if (typeof k.enabled !== 'boolean' || typeof k.stopOnEmptyFrontier !== 'boolean') {
    throw new RangeError('runBigLoop: enabled/stopOnEmptyFrontier 必须是布尔值')
  }
  return k
}

/** 线索提取（**三态**：none / string / other；非法形状绝不读成"没有线索"）。 */
function cluesOf(raw: unknown): { clues: string[]; state: 'none' | 'string' | 'other' } {
  if (raw === undefined || raw === null) return { clues: [], state: 'none' }
  if (!Array.isArray(raw)) return { clues: [], state: 'other' }
  const out: string[] = []
  let other = false
  for (const x of raw) {
    if (typeof x === 'string' && x.trim() !== '') out.push(x.trim())
    else other = true
  }
  return { clues: out, state: other ? 'other' : out.length ? 'string' : 'none' }
}

/** 规整后的候选面（`readCandidate` 的产出）。 */
interface ReadCandidate {
  key: string
  score: number
  channels: string[]
  clues: string[]
  clueState: 'none' | 'string' | 'other'
}

/** 候选形状校验：**非法返回 null**（调用方计入 `malformed`），合法则给出规整观测面。 */
function readCandidate(c: unknown): ReadCandidate | null {
  if (!c || typeof c !== 'object') return null
  const o = c as { key?: unknown; score?: unknown; channels?: unknown; clues?: unknown }
  if (typeof o.key !== 'string' || o.key.trim() === '') return null
  if (o.score !== undefined && (typeof o.score !== 'number' || !Number.isFinite(o.score))) return null
  const chans: string[] = []
  if (o.channels !== undefined) {
    if (!Array.isArray(o.channels)) return null
    for (const x of o.channels) {
      if (typeof x !== 'string' || x === '') return null
      chans.push(x)
    }
  }
  const cl = cluesOf(o.clues)
  return {
    key: o.key.trim(),
    score: typeof o.score === 'number' ? o.score : 0,
    channels: [...new Set(chans)].sort(),
    clues: cl.clues,
    clueState: cl.state,
  }
}

/** 线索表合并（三态：任一 `other` ⇒ `other`，**不得**被别处的 `string` 洗白）。 */
function mergeClues(
  cluesByKey: Map<string, string[]>,
  stateByKey: Map<string, 'none' | 'string' | 'other'>,
  key: string,
  clues: readonly string[],
  state: 'none' | 'string' | 'other',
): void {
  const list = cluesByKey.get(key) ?? []
  for (const c of clues) if (!list.includes(c)) list.push(c)
  list.sort()
  cluesByKey.set(key, list)
  const prev = stateByKey.get(key) ?? 'none'
  stateByKey.set(key, prev === 'other' || state === 'other' ? 'other' : prev === 'string' || state === 'string' ? 'string' : 'none')
}

/** 全部线索（去重、升序）—— **唯一**出口，避免两处各排一次序。 */
function allClues(cluesByKey: Map<string, string[]>): string[] {
  const s = new Set<string>()
  for (const list of cluesByKey.values()) for (const c of list) s.add(c)
  return [...s].sort()
}

/** 字符串数组合并（去重、升序）。 */
function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort()
}

/**
 * **大环路递归检索主入口**：
 * 检索 → 关联线索提取 → 新查询 → 跨事件整合 → 检测收敛 → 去重排序。
 *
 * 本函数**除入参非法（编程错）外永不抛**：检索端口的运行期故障折叠成显式
 * `status='error'` + `rounds[i].error`（**不吞**），因为调用点在召回路径上，
 * 它坏掉不该让整次召回失败 —— 但它**必须留下可查的失败记录**（`contract/degradation.md`
 * 硬约定 1：`catch { return null }` 是本仓明令禁止的形态）。
 */
export async function runBigLoop(opts: BigLoopOptions): Promise<BigLoopResult> {
  const knobs = normalizeKnobs({ ...(opts.knobs ?? {}), ...(opts.overrides?.knobs ?? {}) })
  if (typeof opts.retrieve !== 'function') {
    throw new RangeError('runBigLoop: retrieve 必须是函数（检索端口由调用方注入，见文件头）')
  }
  const baseQuery = typeof opts.baseQuery === 'string' ? opts.baseQuery.trim() : ''
  if (!baseQuery) throw new RangeError('runBigLoop: baseQuery 必须是非空字符串（③ 的起点）')

  const observations: BigLoopObservation[] = []
  const known = new Set<string>()
  const cluesByKey = new Map<string, string[]>()
  const stateByKey = new Map<string, 'none' | 'string' | 'other'>()
  let seedMalformed = 0
  for (const raw of [...(opts.baseCandidates ?? []), ...(opts.baseKeys ?? []).map((key) => ({ key }))]) {
    const got = readCandidate(raw)
    if (!got) {
      seedMalformed += 1
      continue
    }
    known.add(got.key)
    if (!observations.some((o) => o.key === got.key && o.round === 0)) {
      observations.push({ key: got.key, round: 0, score: got.score, channels: got.channels, clues: got.clues, clueState: got.clueState })
    }
    mergeClues(cluesByKey, stateByKey, got.key, got.clues, got.clueState)
  }

  /** 未跑状态的**唯一**出口（`disabled` / `no-candidate`）：`ran=false`、无终止原因、原因非空。 */
  const notRun = (status: BigLoopStatus, reason: string): BigLoopResult => {
    const merged = mergeCandidates(observations)
    return {
      ran: false,
      status,
      stopReason: null,
      capped: false,
      reason,
      knobs,
      rounds: [],
      roundsRun: 0,
      pendingQueries: [],
      frontier: [],
      merged: rankAcrossRounds(merged),
      mergedRows: merged.length,
      observations: observations.length,
      multiRoundKeys: merged.filter((m) => m.rounds.length > 1).length,
      clues: allClues(cluesByKey),
      seedMalformed,
      consumed: '未读取（一次检索都没发）',
    }
  }

  if (!knobs.enabled) return notRun('disabled', BIGLOOP_DISABLED_REASON)
  if (!known.size) return notRun('no-candidate', BIGLOOP_NO_CANDIDATE_REASON)

  // ── ③ 的查询池：`baseQuery` 是**计划内**的第 1 条查询（不是"重试腿"）───────────────
  // ⚠ 若把 baseQuery 只记进 `usedQueries` 而不入队，第 1 轮就会因为"队列空"被标成
  //   `repeat=true` —— 那是把"本来就要问的这一句"读成"没词了只好再说一遍"（两件事同形）。
  const usedQueries = new Set<string>()
  const pending: BigLoopQuery[] = [{ query: baseQuery, from: [] }]
  /** 前沿 = **还问得出新线索的观测键**（空 ⇔ ③ 已给不出新查询，即收敛的固定点）。 */
  let frontier = new Set<string>()
  const rounds: BigLoopRound[] = []
  let stopReason: BigLoopStopReason | null = null
  let lastQuery = baseQuery
  let calls = 0
  let consumedFromQueue = 0

  for (let round = 1; round <= knobs.maxRounds; round++) {
    const started = Date.now()
    // ③ 选一条查询：队列非空则消费**字典序最小**的一条（确定序）；否则走**重试腿**。
    pending.sort((a, b) => (a.query < b.query ? -1 : a.query > b.query ? 1 : 0))
    const picked = pending.shift()
    const repeat = picked === undefined
    if (picked) {
      consumedFromQueue += 1
      lastQuery = picked.query
    }
    const query = picked ? picked.query : lastQuery
    const from = picked ? picked.from : []
    usedQueries.add(query)
    const queriesBefore = usedQueries.size
    const keyBefore = new Set(known) // 本轮开始时的已知面（增量与饱和率的**分母/基准**）

    let raw: readonly BigLoopCandidate[]
    try {
      const got = await opts.retrieve(query, round)
      if (!Array.isArray(got)) {
        throw new TypeError(`检索端口返回的既不是数组也不是 Promise<数组>，实测 ${typeof got}`)
      }
      raw = got
      calls += 1
    } catch (error) {
      // **不吞**：原文进读数，状态显式，随后**立即停**（不重试）。
      const err = `${BIGLOOP_REASON_PREFIX}第 ${round} 轮检索失败（查询「${query}」）：${msgOf(error)}`
      rounds.push({
        round,
        query,
        from,
        repeat,
        status: 'error',
        error: err,
        rawCount: 0,
        dedupedInRound: 0,
        malformed: 0,
        observedCount: 0,
        grewBy: 0,
        rescanHits: 0,
        knownCount: known.size,
        addScore: 0,
        growthRatio: 0,
        observedOverlap: 0,
        clueInputKeys: 0,
        cluesBefore: allClues(cluesByKey).length,
        cluesAfter: allClues(cluesByKey).length,
        clueGainAfter: sumClueGain(allClues(cluesByKey)),
        queriesBefore,
        queriesAfter: usedQueries.size,
        newQueries: 0,
        queryOverlap: 0,
        pendingAfter: pending.length,
        frontierAfter: frontier.size,
        ms: Date.now() - started,
      })
      stopReason = 'search-error'
      break
    }

    // ── ①→② 读候选：同轮同键折叠（计数不静默）、形状非法剔除（**不静默**）──────────
    const byRoundKey = new Map<string, BigLoopObservation>()
    let malformed = 0
    let dedupedInRound = 0
    for (const c of raw) {
      const got = readCandidate(c)
      if (!got) {
        malformed += 1
        continue
      }
      const prev = byRoundKey.get(got.key)
      if (prev) {
        dedupedInRound += 1
        // 同轮同键：分高者胜（平局保首次）；通道/线索取并集；三态取"更坏"的那个
        byRoundKey.set(got.key, {
          key: got.key,
          round,
          score: Math.max(prev.score, got.score),
          channels: union(prev.channels, got.channels),
          clues: union(prev.clues, got.clues),
          clueState: prev.clueState === 'other' || got.clueState === 'other' ? 'other' : prev.clueState === 'string' || got.clueState === 'string' ? 'string' : 'none',
        })
        continue
      }
      byRoundKey.set(got.key, { key: got.key, round, score: got.score, channels: got.channels, clues: got.clues, clueState: got.clueState })
    }
    const roundObs = [...byRoundKey.values()]
    const observedKeys = roundObs.map((o) => o.key)
    const newKeys = observedKeys.filter((k) => !keyBefore.has(k))
    const rescanHits = observedKeys.length - newKeys.length

    for (const o of roundObs) {
      observations.push(o) // (key, round) 唯一 ⇒ 幂等最终由 mergeCandidates 的 Set 保证
      known.add(o.key)
      mergeClues(cluesByKey, stateByKey, o.key, o.clues, o.clueState)
    }
    let addScore = 0
    for (const k of newKeys) addScore += byRoundKey.get(k)?.score ?? 0

    const growthRatio = keyBefore.size ? newKeys.length / keyBefore.size : 0
    const observedOverlap = round === 1 ? 0 : overlapRatio(observedKeys, keyBefore)

    // ── ③ 用**本轮观测面**的线索产出新查询（这是"线索驱动下一轮"的机械落点）──────────
    // ⚠ 取"本轮观测到的键"而不是"上一轮的前沿"：后者的线索在上一轮**已经**变成了查询，
    //   拿它当输入会让第二轮之后再也产不出新查询（实测抓到的形态：查询链在第 2 轮断掉，
    //   之后全是同一句的重试腿 —— 环路被读成"跑了"，实际一步没走）。
    //   去重由 `usedQueries` 承担：同一个键跨轮再出现时，其线索若已问过 ⇒ 不会再产出查询。
    const inputKeys = [...observedKeys].filter((k) => cluesByKey.has(k)).sort()
    const availableClues = new Set<string>()
    for (const k of inputKeys) for (const c of cluesByKey.get(k) ?? []) availableClues.add(c)
    const queryOverlap = round === 1 ? 0 : overlapRatio([...availableClues], usedQueries)
    const cluesBefore = allClues(cluesByKey).length
    const fresh: BigLoopQuery[] = []
    for (const k of inputKeys) {
      const owned = [...(cluesByKey.get(k) ?? [])].sort()
      for (const clue of owned) {
        if (usedQueries.has(clue) || fresh.some((q) => q.query === clue) || fresh.length >= knobs.maxNewQueriesPerRound) continue
        fresh.push({ query: clue, from: owned })
      }
    }
    pending.push(...fresh)
    const cluesAfter = allClues(cluesByKey).length

    // ── 前沿更新：**本轮观测面里"还问得出新问题"的键** ────────────────────────────
    // 前沿空 ⇔ 关联线索提取已给不出任何还没问过的线索 ⇔ ③ 不可能再产出新查询
    // ⇒ 这正是大环路在"检索→线索→新查询"这一步上的**固定点**（收敛的可判定形式）。
    // ⚠ 它**不**依赖 `maxNewQueriesPerRound`：那个旋钮限制的是**发放速率**，不是"还有没有"。
    frontier = new Set(
      observedKeys.filter((k) => (cluesByKey.get(k) ?? []).some((c) => !usedQueries.has(c))),
    )

    rounds.push({
      round,
      query,
      from,
      repeat,
      status: 'ok',
      error: null,
      rawCount: raw.length,
      dedupedInRound,
      malformed,
      observedCount: observedKeys.length,
      grewBy: newKeys.length,
      rescanHits,
      knownCount: known.size,
      addScore,
      growthRatio,
      observedOverlap,
      clueInputKeys: inputKeys.length,
      cluesBefore,
      cluesAfter,
      clueGainAfter: sumClueGain(allClues(cluesByKey)),
      queriesBefore,
      queriesAfter: usedQueries.size,
      newQueries: fresh.length,
      queryOverlap,
      pendingAfter: pending.length,
      frontierAfter: frontier.size,
      ms: Date.now() - started,
    })

    // ── ⑤ 检测收敛（优先级：前沿空 → 增长 → 饱和 → 硬上限；见文件头）──────────────
    // ⚠ 两条阈值的 `0` 都表示**关掉该判据**，且由**显式守卫**保证（不靠比较方向的巧合）：
    //   增长用 `<`、饱和用 `>=` —— 两个量的"好"方向相反，若只靠方向，`overlapLimit=0`
    //   会变成"**永远**饱和"（判据的关闭位与最激进位撞成同一个数，本仓最忌的形态）。
    if (knobs.stopOnEmptyFrontier && frontier.size === 0) stopReason = 'clue-frontier-empty'
    else if (knobs.growLimit > 0 && growthRatio < knobs.growLimit) stopReason = 'growth-below-threshold'
    else if (knobs.overlapLimit > 0 && round >= 2 && observedOverlap >= knobs.overlapLimit) stopReason = 'observed-saturation'
    else if (round >= knobs.maxRounds) stopReason = 'max-rounds'
    if (stopReason) break
  }

  // 结构上兜底：上界由 for 条件保证 ⇒ 走到这里只可能是"最后一轮没触发前四条"
  if (!stopReason) stopReason = 'max-rounds'

  const merged = mergeCandidates(observations)
  const status: BigLoopStatus = BIGLOOP_TERMINALS[stopReason]
  const capped = stopReason === 'max-rounds'
  const reason =
    status === 'converged'
      ? null
      : status === 'capped'
        ? `${BIGLOOP_REASON_PREFIX}达轮数硬上限 ${knobs.maxRounds}（三条自然判据本轮一条都没触发）⇒ 显式停止，未判定为收敛`
        : `${BIGLOOP_REASON_PREFIX}检索腿失败 ⇒ 在第 ${rounds.length} 轮停止（不重试、不静默继续）：${rounds[rounds.length - 1]?.error ?? '（无错误详情）'}`

  return {
    ran: calls > 0,
    status,
    stopReason,
    capped,
    reason,
    knobs,
    rounds,
    roundsRun: rounds.length,
    // 停止后仍把"还能问的问题"带出来（**不静默丢弃**）：它们是续跑的输入。
    pendingQueries: pending.sort((a, b) => (a.query < b.query ? -1 : a.query > b.query ? 1 : 0)),
    frontier: [...frontier].sort(),
    merged: rankAcrossRounds(merged),
    mergedRows: merged.length,
    observations: observations.length,
    multiRoundKeys: merged.filter((m) => m.rounds.length > 1).length,
    clues: allClues(cluesByKey),
    seedMalformed,
    consumed: `检索端口（注入）：调用 ${calls} 次 / 跑了 ${rounds.length} 轮；查询池消费 ${consumedFromQueue} 条；已知键 ${known.size} 个`,
  }
}
