/**
 * **大环路接线**（E2）—— 把 `bigloop.ts` 的 `runBigLoop` 接进**生产检索路径**（v10 §12.5/§14.7）。
 *
 * ── 为什么需要这个模块（开工实测的事实）──────────────────────────────────────────
 * D2 席交付了 `bigloop.ts`（收敛可判定 + 硬上限），但它**无生产调用方**：
 * `runBigLoop` 的调用点在**全仓 `packages/<pkg>/src` 里 = 0``（只有它自己的测试调它）。
 * ⇒ v10 §14.7 的「大环路递归检索」在**生产路径上无生产者**（有实现、零调用方）。
 * 本模块 + `index.ts` 的 recall 出口把这条链路接上。
 *
 * ── 接线形状：**与 W1-4 门控 / W2-C3 图腿同款**（三处形状一致本身是一条判据）───────
 * | 面 | W1-4 门控 | W2-C3 图腿 | **本席 大环路** |
 * |---|---|---|---|
 * | 旋钮 | `Config.recallGate` | `Config.recallGraph` | **`Config.bigLoop`**（新增） |
 * | 缺省 | `enabled: true` | `enabled: true` | **`enabled: false`**（见下） |
 * | 失败 | fail-open + `unwiredReason` | fail-open + `reason` | fail-open + `unwiredReason`/`error` |
 * | 接口契约字段 | 一个都不改（`applied:false`）| 一个都不改（`applied:false`）| **一个都不改**（`applied:false`）|
 * | 读数出口 | `lastRecallGate()` + 载荷 | `lastRecallGraph()` + 载荷 | **`lastBigLoop()` + 载荷** |
 *
 * ── ⚠ 缺省**必须**是关：这一条不是口味问题，是"主链不得被改"的机械落点────────────
 * 大环路是**递归**检索（多轮），闸门一开，**每一次** `recall()` 都会：
 *   · 从词法腿与图腿发**多轮**查询（`maxRounds` 缺省 6）；
 *   · 每轮读候选的内容面抽线索（`retrieve-port.ts` 的 `readClues`）。
 * 这两件事都会**改变主链的耗时与复杂度**，而本仓的硬要求是"主链行为不得改变"。
 * ⇒ 缺省 `enabled: false`：**一次检索都不发**（`bigloop.ts` 的 `BIGLOOP_DISABLED_REASON`），
 *   读数里 `ran=false`/`roundsRun=0`/`calls=0` —— 与"开了但没跑"、"跑了但没收敛"
 *   **三者取值互不冒充**（判据逐条取证）。
 *
 * ── 开关开时**改的是什么**（代价必须写出来，不许只说好处）─────────────────────────
 * 开了之后 `recall()` 的**契约字段一个字节都不变**（`RecallOutcome` 的
 * `channel`/`rankBy`/`degraded`/`hitCount`/`items` 全由向量管道决定），变的是：
 *   · **耗时**：多出 `roundsRun` 轮（词法 FTS5 查询 + 图腿按种子逐键读 + 线索解码）；
 *   · **审计日志量**：`mana/recall` 载荷多一个 `bigLoop` 读数（每轮一条读数，条数 = 轮数）；
 *   · **库读量**：每轮至多 `lexicalLimit`(50) 条词法命中 + 图腿的行读。
 * 结论：它是**可观测性/覆盖面**的采购，不是免费的 —— 故**缺省关**，由册面/用户显式开启。
 *
 * ── 边界自证（本模块**不**做什么）──────────────────────────────────────────────
 * · **零注册点**：无 `ctx.on`/`ctx.effect`/定时器/pre-step（G9：本批不新开注册点）；
 * · **零写库、零 emit**：落库与广播仍由 `index.ts` 的 recall 出口**单点**做；
 * · **不改 `ManaRecall` 契约**：读数以**契约外增量字段**挂在该事件的载荷上（与门控/图腿同处置）；
 * · **不新建检索面**：端口复用 core 的 `recallLexical`（词法腿）与本包的 `runGraphLeg`（图腿），
 *   本模块不写任何 SQL、不造第二份检索实现。
 */
import type { BigLoopKnobs, BigLoopOptions, BigLoopResult } from './bigloop.ts'
import { runBigLoop } from './bigloop.ts'
import {
  DEFAULT_BIGLOOP_RETRIEVE_LIMITS,
  makeBigLoopRetriever,
  type BigLoopRetrieveCoreLike,
  type BigLoopRetrieveEvidence,
  type BigLoopRetrieveLimits,
} from './retrieve-port.ts'
import type { RecallGraphKnobs } from './graph.ts'

/** 接线旋钮（= `Config.bigLoop` 的四个字段；**缺省值真源在下面那个冻结对象**）。 */
export interface BigLoopWiringKnobs {
  /** 总开关。**缺省 `false`**：`false` ⇒ 一次检索都不发（显式关闭，不是故障）。 */
  readonly enabled: boolean
  /** 硬上限（轮数），透传给 `runBigLoop`；上界由 `bigloop.ts` 的 `HARD_MAX_ROUNDS` 校验（越界即抛）。 */
  readonly maxRounds: number
  /** 每轮从词法腿取多少条。 */
  readonly lexicalLimit: number
  /** 每轮最多回给大环路多少条。 */
  readonly topK: number
}

/**
 * **唯一**缺省值真源（对象冻结 ⇒ 就地改写会在运行期立刻抛错，防两处缺省悄悄分叉）。
 * ⚠ `enabled: false` 是**本文件最重要的一行**：它保证"接线了"不等于"主链被改了"。
 */
export const DEFAULT_BIGLOOP_WIRING: BigLoopWiringKnobs = Object.freeze({
  enabled: false,
  maxRounds: 6,
  lexicalLimit: DEFAULT_BIGLOOP_RETRIEVE_LIMITS.lexicalLimit,
  topK: DEFAULT_BIGLOOP_RETRIEVE_LIMITS.topK,
})

/** 显式关闭（**配置**，措辞与"失败"不同：不是"解析失败"、不是"检索腿坏了"）。 */
export const BIGLOOP_WIRING_DISABLED_REASON =
  '大环路已**显式关闭**（Config.bigLoop.enabled=false）：本次召回未发起任何递归检索' as const

/**
 * 查询串为空（**第四种"没跑"**，与"显式关闭"、"检索腿坏了"取值与措辞都不同）。
 *
 * ⚠ 为什么**不**拿一个占位串去跑一轮：`baseQuery` 是 ③ 的**起点**，空串意味着**没有起点**
 *   —— 拿占位串顶上去，等于"用一句没人问过的话去检索"，而这一轮的结果会**混进读数**，
 *   让"起点缺失"看起来像"起点存在但检索没结果"（两件事同形，本仓最防的形态）。
 *   故这里显式**不跑**并报明原因：`enabled=true` + `attempted=false` + 本常量。
 */
export const BIGLOOP_WIRING_EMPTY_QUERY_REASON =
  '大环路未跑：本次查询串为空（③ 的起点缺失）——不以空查询为起点发起递归检索' as const

/**
 * 一次接线的**审计记录**（挂进 `mana/recall` 载荷的那一份）。
 *
 * 读取方向逐字对齐 `recall-gate-hook.ts` 的 `RecallGateCallRecord`（三态可分辨）：
 *   · `enabled=false` ⇒ 门外**没有**调用（`attempted=false` + `unwiredReason` 说"显式关闭"）；
 *   · `enabled=true` 且调用抛错 ⇒ `attempted=true` + `error` 非空 + `result=null`；
 *   · 跑成 ⇒ `result` 非空（**其结果**也可能是 `capped`/`error`，那是大环路自己的读数）。
 */
export interface BigLoopWiringRecord {
  readonly enabled: boolean
  /** **是否真的调用了** `runBigLoop`（含"调了但抛错"）。 */
  readonly attempted: boolean
  /** 未调用/不可用的原因（**非空 ⇔ `result === null`**）。 */
  readonly unwiredReason: string | null
  /** `runBigLoop` 的完整读数（未跑时为 `null` —— 不得用别的值冒充）。 */
  readonly result: BigLoopResult | null
  /** 调用**抛错**时的原始信息（抛错时非空）。 */
  readonly error: string | null
  /** 检索端口的实证读数（真调用了就有；"读了什么"不靠自述）。 */
  readonly evidence: BigLoopRetrieveEvidence | null
}

/**
 * 挂进 `mana/recall` 载荷的**大环路读数**（**契约外增量字段**：`ManaRecall` 本身不改）。
 *
 * ⚠ 与门控/图腿读数**同一条纪律**：本批**只带读数、不改管道** —— `applied` 恒为 `false`
 *   并**写成字段而不是留一句注释**，使"有没有真折叠进排序"可被断言。
 *   （把大环路的产出折进 `items` 之前，必须先拍板新的排序口径；否则 `rankBy:'rrf'`
 *   名不副实 —— 那是册面的事，不是接线席能自己决定的。）
 */
export interface BigLoopReadout {
  /** 调用方（配置面）是否**要求**启用大环路。 */
  readonly enabled: boolean
  /** 大环路是否**改变**了召回结果。本批恒 `false`（只带读数、不改管道）。 */
  readonly applied: false
  /** 是否真的调用了 `runBigLoop`。 */
  readonly attempted: boolean
  /** 未调用/失败原因（可读，**非空 ⇔ `status === null`**）。 */
  readonly unwiredReason: string | null
  /** 调用抛错时的原始信息。 */
  readonly error: string | null
  /** 大环路的整体状态（`converged`/`capped`/`error`/`disabled`/`no-candidate`）；未跑为 `null`。 */
  readonly status: string | null
  readonly stopReason: string | null
  readonly capped: boolean | null
  /** 大环路自己给的未收敛原因（`converged` 时为 `null`）。 */
  readonly reason: string | null
  readonly roundsRun: number
  readonly mergedRows: number
  readonly observations: number
  readonly multiRoundKeys: number
  readonly frontier: number
  readonly pendingQueries: number
  readonly clueCount: number
  readonly seedKeys: number
  readonly topK: number
  /** 检索端口的实证（"这次真读了什么"）。 */
  readonly calls: number
  readonly queries: readonly string[]
  readonly lexicalKeys: readonly string[]
  /**
   * 逐轮的词法腿原因分类（长度 = `calls`；`too_short` ⇒ 该轮被 core 的长度闸挡下，
   * `null` ⇒ 该轮**有命中**）。⚠ `null` 与 `'ok'` 不是同一件事：后者是"真查了、结果就是 0"。
   */
  readonly lexicalReasons: readonly (string | null)[]
  readonly graphKeys: readonly string[]
  readonly graphReason: string | null
  readonly graphRounds: number
  readonly clueReadFailures: number
  readonly clueFailureReason: string | null
  /** 实际读取口径（可读）。 */
  readonly consumed: string
}

/** 接线配置（运行时形状 = 旋钮 + 端口需要的 core 面 + 种子面）。 */
export interface BigLoopWiringOptions {
  readonly core: BigLoopRetrieveCoreLike
  readonly cfg: BigLoopWiringKnobs
  /**
   * **第 1 轮的种子** = 本次召回管道命中的键（`RecallOutcome.items` 的键序）。
   * ⚠ 种子为空 ⇒ `runBigLoop` 报 `no-candidate`（合法输入，N=0 显式记 0），
   *   与"没接线"、"被关掉"取值不同。
   */
  readonly seedKeys: readonly string[]
  /** 触发查询（`baseQuery`；`bigloop.ts` 要求非空串，空串会抛 —— 那正是它的入参契约）。 */
  readonly baseQuery: string
  /** 图腿旋钮（透传 `Config.recallGraph`：图腿的开关就是那个开关，本模块不另立一份）。 */
  readonly graph?: RecallGraphKnobs
  /**
   * ⚠ **判据专用**（生产路径不传）：替换 `runBigLoop` 的入口，用于**桩计数** ——
   * "生产路径真调到了它"这句话，只有把被调方换成一个会计数的桩才能证伪。
   * 与 `graph.ts` 的 `overrides` 同纪律：能改行为的开关只在**显式传参**时生效，配置面不暴露。
   */
  readonly seam?: BigLoopSeam
}

/** 被判据替换的大环路入口（形状 = `runBigLoop` 本体）。 */
export type BigLoopSeam = (opts: BigLoopOptions) => Promise<BigLoopResult>

/** 折半：把完整读数折叠成载荷面（**唯一**转换点，避免各处手写漏字段 → 两处漂开）。 */
export function bigLoopReadout(record: BigLoopWiringRecord, seeding: { seedKeys: number; topK: number }): BigLoopReadout {
  const r = record.result
  const e = record.evidence
  return {
    enabled: record.enabled,
    applied: false,
    attempted: record.attempted,
    unwiredReason: record.unwiredReason,
    error: record.error,
    status: r?.status ?? null,
    stopReason: r?.stopReason ?? null,
    capped: r?.capped ?? null,
    reason: r?.reason ?? null,
    roundsRun: r?.roundsRun ?? 0,
    mergedRows: r?.mergedRows ?? 0,
    observations: r?.observations ?? 0,
    multiRoundKeys: r?.multiRoundKeys ?? 0,
    frontier: r?.frontier.length ?? 0,
    pendingQueries: r?.pendingQueries.length ?? 0,
    clueCount: r?.clues.length ?? 0,
    seedKeys: seeding.seedKeys,
    topK: seeding.topK,
    calls: e?.calls ?? 0,
    queries: e?.queries ?? [],
    lexicalKeys: e?.lexicalKeys ?? [],
    lexicalReasons: e?.lexicalReasons ?? [],
    graphKeys: e?.graphKeys ?? [],
    graphReason: e?.graphReason ?? null,
    graphRounds: e?.graphRounds ?? 0,
    clueReadFailures: e?.clueReadFailures ?? 0,
    clueFailureReason: e?.clueFailureReason ?? null,
    consumed: e?.consumed ?? (r?.consumed ?? '未读取（大环路未运行）'),
  }
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * 走一次接线的大环路。**本函数永不抛错**（抛错折叠成显式记录）。
 *
 * ⚠ 「永不抛错」是**刻意的**而不是偷懒：调用点在 `recall()` 的返回路径上，大环路是**附加检索**，
 *   它坏掉不该让整次召回失败（fail-open）—— 但它**必须留下可查的失败记录**。那正是本函数
 *   返回 `error`/`unwiredReason` 而不是 `null` 的原因（`catch { return null }` 是本仓
 *   明令禁止的形态，见 `contract/degradation.md` 硬约定 1）。
 *
 * 三段取值**互不冒充**（判据逐条取证）：
 *   · 关（`enabled=false`）⇒ `attempted=false`、`unwiredReason` 说"显式关闭"、`evidence=null`；
 *   · 抛错            ⇒ `attempted=true`、`error` 原文非空、`evidence` **仍在**（端口读到哪一步可查）；
 *   · 跑成            ⇒ `result` 非空（它自己的 `status` 取 `converged`/`capped`/`error`/… ）。
 */
export async function runBigLoopWiring(opts: BigLoopWiringOptions): Promise<BigLoopWiringRecord> {
  const { cfg } = opts
  if (!cfg.enabled) {
    return {
      enabled: false,
      attempted: false,
      unwiredReason: BIGLOOP_WIRING_DISABLED_REASON,
      result: null,
      error: null,
      evidence: null,
    }
  }
  // 空查询：**不跑**并报明原因（见 BIGLOOP_WIRING_EMPTY_QUERY_REASON 的说明）。
  if (typeof opts.baseQuery !== 'string' || opts.baseQuery.trim() === '') {
    return {
      enabled: true,
      attempted: false,
      unwiredReason: BIGLOOP_WIRING_EMPTY_QUERY_REASON,
      result: null,
      error: null,
      evidence: null,
    }
  }
  const port = makeBigLoopRetriever({
    core: opts.core,
    ...(opts.seedKeys.length ? { seedKeys: opts.seedKeys } : {}),
    ...(opts.graph ? { graph: opts.graph } : {}),
    limits: { lexicalLimit: cfg.lexicalLimit, topK: cfg.topK } satisfies BigLoopRetrieveLimits,
  })
  const knobs: Partial<BigLoopKnobs> = { maxRounds: cfg.maxRounds }
  const seam: BigLoopSeam = opts.seam ?? runBigLoop
  try {
    const result = await seam({
      baseQuery: opts.baseQuery,
      baseKeys: opts.seedKeys,
      retrieve: port,
      knobs,
    })
    return { enabled: true, attempted: true, unwiredReason: null, result, error: null, evidence: port.evidence() }
  } catch (error) {
    // 原文进读数（**不吞**）：`bigloop.ts` 的入参校验（baseQuery 空串 / knobs 越界）会走到这里。
    const msg = msgOf(error)
    return {
      enabled: true,
      attempted: true,
      unwiredReason: `大环路**已调用但抛错**：${msg}`,
      result: null,
      error: msg,
      evidence: port.evidence(),
    }
  }
}
