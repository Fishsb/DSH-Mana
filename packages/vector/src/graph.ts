/**
 * **图检索腿**（W2-C3）—— 共现关联边 + 邻接扩展（v10 §14.3「并行检索（向量 + FTS5 + 图）」+ §12.6 关联激活）。
 *
 * ── 本文件在 §14.3 里的位置（原文，逐字）────────────────────────────────────────
 * ```
 * 词法检索（BM25/FTS5）→ Top 50
 *   + 向量检索（bge-m3）→ Top 50
 *   → RRF 融合 → JEV Recall Gate
 *   → 未配置向量时自动降级纯词法
 *   → 按情境召回优先于内容相似
 * ```
 * §14.1 的三条并行腿里，前两条（向量 + FTS5）与 RRF 早已落地；**图腿此前 0 落点**
 * （`packages/vector/src` 内 `graph`/`邻接`/`related_ids` 命中 0）。本文件补的正是第三条腿。
 *
 * ── 读的到底是什么（**唯一**读取口径，别处的描述不得与它冲突）────────────────────
 * · **一张既有表、一个既有列**：`memory_items.related_ids`（`packages/core/src/schema.ts:59` 的
 *   `related_ids TEXT`）。**不新建表**（任务明令；该列本就是这个用途的落点）。
 * · **边的生产者是别的包**：`packages/learning/src/store.ts` 的 `applyCoActivations` 是
 *   `related_ids` 的**唯一写者**（Hebbian 共激活）。本文件**只读不写** —— 读侧不产生边，
 *   故"没有边"与"边没被读出来"不会因为本文件而混同。
 *
 * ── 格式：**本包不 import learning，做孪生解析**（取舍必须写出来）───────────────────
 * 单元格格式的真源是 `packages/learning/src/store-format.ts`：
 *   ① 带权 JSON 数组 `[{"id":"m-a","w":0.03},…]`（`w` 是短键，`≥0` 的有限数）；
 *   ② **必须带权重**（`long-term/src/activation.ts` 的 `associativeActivation` 要的是 `W_k`，
 *      只存 id 列表等于把 L-03 的全部产出丢掉）；
 *   ③ 恒按 id 字典序 ⇒ 同一组关系只有**一个字节串**。
 *
 * ⚠ **为什么是孪生解析而不是 `import { parseRelatedIds } from 'dsh-mana-learning'`**：
 *   那是一条依赖边。`packages/vector/package.json` 的 peerDependencies 里**没有** learning；
 *   加它 = 在方案 §9.1 的依赖方向图上凭空多一条 vector→learning，而这条边的唯一用途是
 *   读一个字符串。**取孪生解析 + 对拍判据**：`tests/recall-graph.test.mjs` 把 learning 的
 *   真 `encodeRelated()` 产物喂进来逐字对拍（等价性由**判据**保证，而不是由注释保证）。
 * ⚠ **孪生的代价必须写出来**：两侧漂开时**编译期不报错**（跨包、无依赖边）。故：
 *   · 四态在本文件**显式实现**（`ok`/`null`/`empty`/`invalid`），且 `invalid` **绝不**降级成
 *     `[]` —— 那会让「值读不懂」与「本来没有关系」同形（`docs/contract/degradation.md` 硬约定 1）；
 *   · 漂移由**对拍判据**抓（`tests/recall-graph.test.mjs` 每轮真跑），不靠这句注释保证。
 *
 * ── 退化路径：**互不冒充**（任务硬要求；本仓最忌"两种事实同形"）────────────────────
 * | 态 | 触发 | `ran` | `reason` | 读数里的分辨点 |
 * |---|---|---|---|---|
 * | 未开启 | `enabled=false` | false | 非空 | "已显式关闭"（措辞与故障不同） |
 * | 无种子 | 候选集为空 | false | 非空 | "无种子" |
 * | 列缺失 | 老库建于补列之前 | false | 非空 | `columnState='missing-column'` |
 * | 查询失败 | SQL 抛错（0 行） | false | 非空 | 原始错误文本（不吞） |
 * | 行取不到 | 种子行不存在 | true | null | `unreachableKeys` **点名** ⇒ `exact=false` |
 * | 真跑·无边 | 行取到了，该行没有边 | true | null | `edgesSeen=0` ∧ `seedsWithoutEdges>0` |
 * | 真跑·有边没扩 | 边读了但没带来新键 | true | null | `edgesSeen>0` ∧ `additions.length=0` |
 * | 真跑·扩了 | 带来新键 | true | null | `additions.length>0` |
 * ⇒ 「无关联边」与「有关联边但没扩展出来」**可分辨**（前者 `edgesSeen=0`，后者 `edgesSeen>0`）；
 *   `ran` 又把"腿没跑成"与"腿跑了但没结果"分开 —— 这正是 `catch { return [] }` 不许出现的原因。
 *
 * ── 与 RRF 的优先级口径（**情境优先于内容相似**）────────────────────────────────
 * 扩展出来的键**不伪造 RRF 分**（RRF 的定义域是名次；给没进过任何一路的键编一个名次 =
 * 让"没融合"与"融合得很差"同形）。图腿自带一条**独立、可断言**的优先级口径：
 * ```
 * weight(hop, sense) = (SENSE_BASE - sense) · PER_HOP^(-hop)   // 排序时 clamp 到 [1e-6, 1]
 * ```
 * · `hop` 0=种子（内容相似腿的直接命中）/1=一跳 /2=两跳；
 * · `sense` 0=直接命中 /1=入边（对家指向种子）/2=出边（种子指向对家）/3=撞键无值；
 * · `PER_HOP > SENSE_BASE` ⇒ **跳数严格支配手性且无撞值**：一跳最弱的(1/5)仍强于
 *   二跳最强的(4/25) —— 即"**可达性越近越优先**"，而边的方向只在同一跳内裁决
 *   （入边 > 出边，与 learning 写侧的对称写入口径一致）；
 * · 种子（`hop=0`）的原值是 4 ⇒ clamp 后**严格等于 1**，与任何扩展键都不会并列。
 * ⇒ "情境优先"在本腿**可枚举、可断言**：种子恒排在扩展之前；同 hop 内入边恒先于出边。
 *
 * ⚠ **图腿绝不改 `RecallOutcome` 的四个契约字段**（`channel`/`rankBy`/`degraded`/`hitCount`）：
 *   `rankBy`/`degraded` 是 A1-11 的机检锚点（`tools/a1-check.mjs` 的 A1-11 块与变异器
 *   `a1-11`/`a1-11-rankby`），改它 = 让既有判据变成假红/假绿。同理 `hitCount` 是**管道**的
 *   命中数，图腿不代它记账 ⇒ 图扩展的产出**只走读数面**（`index.ts` 的 `lastRecallGraph()`
 *   与 `mana/recall` 载荷的契约外增量字段），与 W1-4 门控读数的 `applied:false` 同形。
 *   ⇒ 把 additions 折进 `items` 之前**必须先拍板**新的排序口径（否则 `rankBy:'rrf'` 名不副实），
 *   那是册面的事，不是本腿能自己决定的。
 *
 * ── 边界自证（本模块**不**做什么）────────────────────────────────────────────────
 * · **零注册点**：无监听器、无定时器、无 pre-step（G9；与 `recall-gate-hook.ts` 同纪律）；
 * · **零写库、零 emit**：只有纯函数 + 只读查询（落库/广播仍由 `index.ts` 单点做）；
 * · **零依赖新增**：只用传入的 db 句柄（`mana-core` 持有），本文件不 import 任何 Mana 包，
 *   只用 node 内建能力（`JSON.parse` + 字符串处理）；
 * · **零新表**：只 `SELECT`（`memory_items` 与 `pragma_table_info`），不 `CREATE`/`ALTER`。
 */

// ══ 配置面（**唯一**默认值真源；index.ts 的 Schema 缺省用它的显式字面量）══════════════

/**
 * 图腿的四个旋钮里的三个（`specifier` 那类"能指歪"的开关**刻意不进配置面**）。
 *
 * ⚠ 与 `DEFAULT_RECALL_GATE_WIRING` 同处置：**对象冻结**，使"缺省值被就地改写"在运行期
 *   立刻抛错（而不是让两处缺省悄悄分叉）。
 */
export interface RecallGraphKnobs {
  /** 总开关。`false` ⇒ **完全不读库**（显式关闭，不是故障）。 */
  readonly enabled: boolean
  /**
   * 邻接扩展的跳数上限（`1..GRAPH_HOPS_MAX`）。
   * ⚠ `0` **只能由判据经 `overrides` 传入**（= "关掉邻接扩展"的 A/B 位），配置面不暴露：
   *   配置面出现 0 就等于多一个"看起来开了其实没扩"的旋钮 —— 那正是本仓禁的形态。
   */
  readonly hops: number
  /**
   * 检索范围：
   * · `'seeds'`（缺省）= 只读种子的 `related_ids` ⇒ 出边可达，**入边不可达**
   *   （对家在 `related_ids` 里回指种子时，那一行**没被读**，故对家带不出来）；
   * · `'global'` = 只读扫全表（`retired=0`）⇒ 出入边都可达，代价是 O(库大小) 的读。
   *
   * ⚠ 这个旋钮是**真实语义差**，不是观测开关（判据实测两者读数不同）。
   */
  readonly scope: 'seeds' | 'global'
}

/** 缺省配置（**唯一**真源）。 */
export const DEFAULT_RECALL_GRAPH_KNOBS: RecallGraphKnobs = Object.freeze({
  enabled: true,
  hops: 1,
  scope: 'seeds',
})

/** 跳数上限（配置面与 `overrides` 共用；超过即抛 —— 不做静默 clamp）。 */
export const GRAPH_HOPS_MAX = 2 as const
/**
 * 优先级**每加一跳**的折算比（`PER_HOP^(-hop)`）。
 *
 * ⚠ **必须严格大于 `GRAPH_SENSE_BASE`**，否则"跳数"与"手性"会**撞值** ——
 *   即两件不同的事拿到同一个数（本仓最忌的形态），实测抓到过一次：
 *   首版取 `SENSE_BASE=3 / PER_HOP=2`，而出边的 `sense=3` ⇒ `3-3=0` ⇒ 出边恒 0 分，
 *   与"更远的入边"分不开。判据 ③ 的**无撞值穷举**就是为这一处立的。
 *   现取 `PER_HOP=5 > SENSE_BASE=4` ⇒ 相邻跳之间不可能撞值（`hop` 严格支配 `sense`）：
 *   一跳最弱的 `1/5` > 二跳最强的 `4/25`。
 */
export const GRAPH_PRIORITY_PER_HOP = 5 as const
/** `(SENSE_BASE - sense)` 的取值域：`sense∈0..3` ⇒ 恒正（`sense` 取 4 种时的基值）。 */
export const GRAPH_SENSE_BASE = 4 as const
/**
 * 排序权重的地板（`hop` 极大时原值趋 0 ⇒ 给一个严格正下界，保持"越远越后"）。
 * ⚠ 它在 `GRAPH_HOPS_MAX=2` 内**永不生效**（最小原值 `1/5^2=0.04`）—— 留作越界防护，
 *   不是"把不同的东西压成同一个数"的通道。
 */
export const GRAPH_MIN_WEIGHT = 1e-6 as const
/** `related_ids` 数组项里的**权重短键**（与 learning 写侧逐字一致）。 */
export const GRAPH_VALUE_KEY = 'w' as const

/** 未启用（**配置**，措辞与"失败"不同）。 */
export const GRAPH_DISABLED_REASON = '图检索腿已**显式关闭**（Config.recallGraph.enabled=false）：本次未读库' as const
/** 无种子（合法输入，非故障）。 */
export const GRAPH_NO_SEED_REASON = '本次无种子（召回候选为空）⇒ 无需扩展' as const
/** 各条失败原因的公共前缀（判据按前缀断言，措辞改动不再造成假红）。 */
export const GRAPH_REASON_PREFIX = '图检索腿：' as const
/** 行取不到的显式原因片段（**不是**"没有关联边"）。 */
export const UNREACHABLE_REASON = 'memory_items 里没有这一行（不是"没有关联边"）' as const

// ══ 类型面 ═════════════════════════════════════════════════════════════════

/** 一条关联边（读侧形态；写侧真源见 `packages/learning/src/store-format.ts`）。 */
export interface RelatedEntry {
  readonly id: string
  /** 关联强度 `w ≥ 0`（Hebbian 累积；本腿**不设下界** —— `w=0` 的边也是边）。 */
  readonly weight: number
}

/**
 * `related_ids` 单元格的解析结果 —— **四态**（`null` / `''` / 合法 / 非法）。
 *
 * ⚠ 与 learning 的 `ParsedRelatedIds` **同形同义**（孪生解析的对拍面）：`state` 取值与
 *   `items`/reason 的对应关系逐条一致；`invalid` 恒 `items: []` **且 reason 非空**。
 */
export type CellState = 'ok' | 'null' | 'empty' | 'invalid'

export interface ParsedCell {
  readonly state: CellState
  readonly items: readonly RelatedEntry[]
  /** `state='invalid'` 时**必非空**；其余三态恒 `null`（不空串、不 undefined）。 */
  readonly reason: string | null
}

/** 列探测三态：**列不存在不是"没有边"**（老库与"空关系"必须可分辨）。 */
export type ColumnState = 'present' | 'missing-column' | 'not-probed'

export interface RelatedIdsColumnProbe {
  readonly state: ColumnState
  readonly reason: string | null
}

/** 本腿用到的 db 面（**结构性**声明，不 import `node:sqlite`）。 */
export interface GraphDbLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

/** 一行原始读数（`SELECT id, related_ids FROM memory_items …`）。 */
export interface GraphRow {
  readonly id: string
  readonly relatedIds: string | null | undefined
}

/**
 * **判据专用覆盖口**（生产路径不传）—— 与 `runRecallGate` 的 `specifier` 同一处置：
 * 能改行为的开关只在**显式传参**时生效，配置面不暴露 ⇒ 不存在"能把腿指歪"的旋钮。
 */
export interface GraphLegOverrides {
  /** 强制跳数上限：`0` = 关掉扩展（A/B 位），`2` = 放开两跳（负向对拍位）。 */
  readonly hops?: number
  /** 强制检索范围（负向对拍位）。 */
  readonly scope?: 'seeds' | 'global'
}

export interface GraphLegOptions {
  /** 种子 = 管道已经命中的键（`RecallOutcome.items` 的有序键列表）。 */
  readonly seeds: readonly string[]
  /**
   * **撞键无值**的候选键（`sense=1` 的落点）。
   *
   * ⚠ 判据是"**在候选里但没拿到任何分**"（`rank` 为空），**不是**"名次靠后"：
   *   `rank` 里带 dense/lexical 的键说明它被 RRF 融合过（只是名次差），把它算成图扩展
   *   就是**伪造成果**（"带出来的"与"本来就在候选里"同形）。
   *   该判据只有调用方（`index.ts`，能看到候选面）能算，故由此传入 —— 本函数**不猜**。
   */
  readonly keylessKeys?: readonly string[]
  readonly cfg?: Partial<RecallGraphKnobs>
  /** ⚠ **判据专用**（生产路径不传）：见 `GraphLegOverrides`。 */
  readonly overrides?: GraphLegOverrides
}

/** 一条**扩展出来的**键（图腿带出的对家）。 */
export interface GraphAddition {
  readonly key: string
  /** 1 = 一跳，2 = 两跳（**不报 0** —— 0 恒是种子，种子不进 `additions`）。 */
  readonly hop: number
  /** 来源/手性（`SENSE`）：0=直接命中 /1=入边 /2=出边 /3=撞键无值（**取值序即优先级序**）。 */
  readonly sense: number
  /** 经哪条边带出（`sense=0/1` 时 = 它自己）；用于反查"这条边到底在哪一行"。 */
  readonly via: readonly string[]
  /** 被多条边重复带出的次数（>1 ⇒ `duplicates` 计入；**不是**静默去重）。 */
  readonly occurrences: number
  /** 本条边上的权重（`related_ids` 里的 `w`）；`sense=1` 时取相关边的最大值。 */
  readonly maxWeight: number
  /** **未 clamp** 的优先级原值（可断言"内容相似恒优先"）。 */
  readonly weight: number
  /** **排序用**的优先级 `min(1, max(1e-6, weight))` —— 种子恒 1，并入任何列表都不乱序。 */
  readonly priorityScore: number
}

/** 图腿的一次**完整读数**（"腿跑到哪一步"的全部可断言事实）。 */
export interface GraphLegResult {
  /** 图腿是否**真跑**（拿到行、读了边）。`false` ⇒ `reason` 必非空。 */
  readonly ran: boolean
  /** 种子行是否**全部**取到。`false` ⇒ `unreachableKeys` 必非空（"取不到"≠"没有边"）。 */
  readonly exact: boolean
  /** 本次用的跳数上限（`0` 只在判据覆盖口出现；配置面恒 `1..GRAPH_HOPS_MAX`）。 */
  readonly hops: number
  readonly scope: 'seeds' | 'global'
  /** 去重后的种子数。 */
  readonly seedCount: number
  /** 扩展产出（按优先级降序；种子**不在其中**）。 */
  readonly additions: readonly GraphAddition[]
  /** 读到的**有效**边条数（`state='ok'` 且带 id 的项；含零权边）。 */
  readonly edgesSeen: number
  /** 有边的种子行数。 */
  readonly seedsWithEdges: number
  /** **行取到了但没有边**的种子数（与"取不到行"必须分开数）。 */
  readonly seedsWithoutEdges: number
  /** 种子里取不到行的键（**不是**"没有边"）。 */
  readonly unreachableKeys: readonly string[]
  /** 两跳以内可达的键总数（含种子）；`seenCount < seedCount` ⇒ 有种子行取不到。 */
  readonly seenCount: number
  /** 自环条数（`related_ids` 指向自己 —— 合法但不产生新键，计数保留）。 */
  readonly selfRefs: number
  /** 同一键被重复带出的次数（>0 即计入，不静默）。 */
  readonly duplicates: number
  /** 单元格**读不懂**的行数（该行的边**没读出来** ⇒ 不计入 `edgesSeen`）。 */
  readonly unreadableRows: number
  /** 列/查询的显式读数。 */
  readonly probe: RelatedIdsColumnProbe
  /** 实际读取口径（可读）：读过哪张表哪一列、读了多少行。 */
  readonly consumed: string
  /** 未运行/失败原因（**非空 ⇔ `ran=false`**）。 */
  readonly reason: string | null
}

// ══ 解析（孪生：与 learning 的 parseRelatedIds 同义）═══════════════════════════════

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * 解析 `related_ids` 单元格（**四态**；`invalid` 绝不降级成 `[]`）。
 *
 * ⚠ 与 `packages/learning/src/store-format.ts` 的 `parseRelatedIds` 逐条同义，唯一差别：
 *   那边用 `undefined` 表达"列不存在"（由 `store.ts` 先探到）；本腿的"列不存在"发生在
 *   **SQL 层**（`pragma_table_info` 探到 / `prepare.all` 抛错），故不在此函数内表达。
 */
export function parseRelatedIdsCell(raw: string | null | undefined): ParsedCell {
  if (raw === null || raw === undefined) return { state: 'null', items: [], reason: null }
  if (raw.trim() === '') return { state: 'empty', items: [], reason: null }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch (error) {
    return { state: 'invalid', items: [], reason: `JSON 解析失败：${msgOf(error)}` }
  }
  if (!Array.isArray(decoded)) {
    return { state: 'invalid', items: [], reason: `顶层必须是数组，实测 ${typeof decoded}` }
  }
  const seen = new Set<string>()
  const items: RelatedEntry[] = []
  for (let i = 0; i < decoded.length; i++) {
    const row = decoded[i] as { id?: unknown; w?: unknown } | null
    if (!row || typeof row !== 'object') return { state: 'invalid', items: [], reason: `第 ${i} 项不是对象` }
    const id = row.id
    const w = row[GRAPH_VALUE_KEY]
    if (typeof id !== 'string' || id === '') {
      return { state: 'invalid', items: [], reason: `第 ${i} 项 id 非法（实测 ${JSON.stringify(id)}）` }
    }
    if (seen.has(id)) {
      return { state: 'invalid', items: [], reason: `第 ${i} 项 id 重复（${JSON.stringify(id)}）` }
    }
    seen.add(id)
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      return { state: 'invalid', items: [], reason: `第 ${i} 项 ${GRAPH_VALUE_KEY} 非法（实测 ${JSON.stringify(w)}）` }
    }
    items.push({ id, weight: w })
  }
  // 与写侧同口径：按 id 字典序（"同一组关系只有一个字节串"的读侧镜像）。
  items.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return { state: 'ok', items, reason: null }
}

// ══ 优先级口径 ═══════════════════════════════════════════════════════════════

/**
 * 手性/来源常量（`sense`）—— **取值顺序即优先级顺序**（数字越小越优先）：
 * · `hit`（0）        = 种子自己（内容相似腿的**直接命中**）；
 * · `inEdge`（1）     = **入边**：对家在 `related_ids` 里指向种子（关联边，双向可达时）；
 * · `outEdge`（2）    = **出边**：种子的 `related_ids` 指向对家（本腿的缺省可达路径）；
 * · `hitKeyless`（3）  = 在候选里**没拿到任何分**的键（既非命中、也没有边 ⇒ 最弱）。
 *
 * ⇒ 「边的语义优先于边的手性」（入边 > 出边），且**真边优先于"撞键无值"**
 *   （后者只是"这一轮候选里出现过、管道没给分"，它是线索而不是关系）。
 */
export const SENSE = Object.freeze({ hit: 0, inEdge: 1, outEdge: 2, hitKeyless: 3 })

/**
 * 优先级权值（**未 clamp** 的原值）：`(SENSE_BASE - sense) · PER_HOP^(-hop)`。
 *
 * ⚠ 取值域与**无撞值**条件写在常量处（`GRAPH_PRIORITY_PER_HOP`）；返回的序是：
 *   `hop` 升序优先（近 > 远），同 `hop` 内 `sense` 升序（入边 > 出边 > 撞键无值）。
 */
export function graphPriorityWeight(hop: number, sense: number): number {
  return (GRAPH_SENSE_BASE - sense) * Math.pow(GRAPH_PRIORITY_PER_HOP, -hop)
}

/** 排序用的优先级（clamp 到 `[GRAPH_MIN_WEIGHT, 1]`；`hop=0` 的直接命中 ⇒ 严格的 1）。 */
export function graphPriorityScore(hop: number, sense: number): number {
  return Math.min(1, Math.max(GRAPH_MIN_WEIGHT, graphPriorityWeight(hop, sense)))
}

// ══ 邻接表与扩展 ═════════════════════════════════════════════════════════════

/** 种子查询的分块大小（见 `readRowsInChunks`）。 */
export const GRAPH_SEED_CHUNK = 200 as const

/**
 * 块读：把 `ids` 分批查（`SELECT id, related_ids FROM memory_items WHERE id = ?`）。
 *
 * ⚠ **为什么分块**：`SQLITE_MAX_VARIABLE_NUMBER` 在旧版 SQLite 上是 999（新版 32766），
 *   一次性绑几千个 id 会**在运行期抛错**。分块让"某一行取不到"落进 `unreachableKeys`
 *   （可分辨），而不是让整条腿抛错（不可分辨）。
 */
export function readRowsInChunks(
  db: GraphDbLike,
  ids: readonly string[],
  chunk: number = GRAPH_SEED_CHUNK,
): { rows: GraphRow[]; errors: string[] } {
  const rows: GraphRow[] = []
  const errors: string[] = []
  const sql = `SELECT id, related_ids FROM memory_items WHERE id = ?`
  for (let i = 0; i < ids.length; i += chunk) {
    for (const id of ids.slice(i, i + chunk)) {
      try {
        const got = db.prepare(sql).all(id) as { id?: unknown; related_ids?: unknown }[]
        const row = got[0]
        if (!row) continue
        rows.push({ id: String(row.id), relatedIds: (row.related_ids ?? null) as string | null })
      } catch (error) {
        errors.push(`${id}：${msgOf(error)}`)
      }
    }
  }
  return { rows, errors }
}

/**
 * 邻接表：`from → [{id, weight}]`（出边方向，按 id 字典序）。
 *
 * · **去重**：同一 `(from,to)` 多次出现取**最大权重** —— 去重是必要的，否则同一条关系会
 *   被数两次而"关系强度"随多写一次而漂；取 max 而非求和，是因为 `related_ids` 的语义是
 *   "这一对关系的**当前**权重"（learning 的选型理由②）。
 * · **自环**（`to === from`）计入 `selfRefs`，**不进邻接表**（它不产生新键）。
 * · **读不懂的行**计入 `unreadableRows` 且**其边一条都不算**（宁可少读，也不猜）。
 */
export interface Adjacency {
  readonly out: ReadonlyMap<string, readonly RelatedEntry[]>
  readonly edgesSeen: number
  readonly selfRefs: number
  readonly unreadableRows: number
}

export function buildAdjacency(rows: readonly GraphRow[]): Adjacency {
  const acc = new Map<string, Map<string, number>>()
  let edgesSeen = 0
  let selfRefs = 0
  let unreadableRows = 0
  for (const row of rows) {
    const parsed = parseRelatedIdsCell(row.relatedIds)
    if (parsed.state === 'invalid') {
      unreadableRows += 1
      continue
    }
    for (const e of parsed.items) {
      edgesSeen += 1
      if (e.id === row.id) {
        selfRefs += 1
        continue
      }
      const bucket = acc.get(row.id) ?? new Map<string, number>()
      const prev = bucket.get(e.id)
      if (prev === undefined || e.weight > prev) bucket.set(e.id, e.weight)
      acc.set(row.id, bucket)
    }
  }
  const out = new Map<string, readonly RelatedEntry[]>()
  for (const [from, bucket] of acc) {
    const list = [...bucket.entries()].map(([id, weight]) => ({ id, weight }))
    list.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    out.set(from, list)
  }
  return { out, edgesSeen, selfRefs, unreadableRows }
}

/**
 * 邻接扩展（BFS，`hop ≤ hops`）：从种子出发沿边走出**种子之外**的键。
 *
 * 口径（逐条可断言）：
 * · **种子恒不进 `additions`**（它们是内容相似腿的产出，不是图腿带出来的）；
 * · **出边**（`from` 有边指向 `to`）与**入边**（别人有边指向 `from`，即反向邻接）双向都算；
 * · 每条边记 `sense`（入边 2 / 出边 3，**语义优先于手性**）；
 * · 多条边带出同一个键 ⇒ 取**优先级最高**的那条作为它的归宿，`occurrences` 记被带出的次数
 *   （`>1` 计入 `duplicates`，**不静默**）；
 * · `hops=0` ⇒ 空结果 + `ran` 仍为 true（这正是"关掉扩展"的 A/B 位）。
 *
 * ⚠ **能力的边界必须写出来（判据实测抓过）**：本函数只能看见**被读到的行**提供的边。
 *   缺省 `scope='seeds'` 只读种子那几行 ⇒ 二跳时 B 的**行没被读**，`B→C` 这条边
 *   **结构上不可见**（`A→B→C` 链上第二跳走不到 C）。这不是 bug，是本函数的定义域；
 *   要让二跳完整可达，得配 `scope='global'`（判据 ⑨ 两态并列取证）。
 *   ⇒ 隐藏它才是错的："没扩出来"与"那条边的行根本没读"在本腿**必须可分辨**
 *   （后者由 `scope` 与 `consumed` 两处读数共同点名）。
 */
export function expandByAdjacency(
  adjacency: Adjacency,
  seeds: readonly string[],
  hops: number,
): { additions: GraphAddition[]; seen: ReadonlySet<string>; duplicates: number } {
  const seedSet = new Set(seeds)
  const best = new Map<string, GraphAddition>()
  const seen = new Set<string>(seeds)
  let duplicates = 0
  let frontier = [...seedSet]

  for (let hop = 1; hop <= hops; hop++) {
    /**
     * 入边需要反向邻接（本腿没有反向索引 ⇒ 扫一遍邻接表；规模 = **被读到的行数**）。
     * ⚠ 过滤条件是 `seen`（**已知键**）而不是 `frontier`：入边指向的可能是上一轮发现的键，
     *   而它**不在本轮的 frontier 里** —— 只按 frontier 过滤会让"入边只在种子上有效"
     *   （静默的能力缺失，读代码看不出来；判据 ⑦ 的 `global` 腿专门盯这一处）。
     */
    const known = new Set(seen)
    const incoming = new Map<string, { from: string; weight: number }[]>()
    for (const [from, list] of adjacency.out) {
      for (const e of list) {
        if (!known.has(e.id)) continue
        const bucket = incoming.get(e.id) ?? []
        bucket.push({ from, weight: e.weight })
        incoming.set(e.id, bucket)
      }
    }
    const next: string[] = []
    for (const node of frontier) {
      const outs = adjacency.out.get(node) ?? []
      const ins = incoming.get(node) ?? []
      const cands: { key: string; via: string; sense: number; weight: number }[] = []
      for (const e of outs) cands.push({ key: e.id, via: node, sense: SENSE.outEdge, weight: e.weight })
      for (const e of ins) cands.push({ key: e.from, via: node, sense: SENSE.inEdge, weight: e.weight })
      // （`SENSE` 的取值顺序即优先级顺序 ⇒ 上面 cands.sort 的 `x.sense - y.sense` 就实现了
      //   "入边优先于出边"；这不是巧合，是 `SENSE` 的定义。）
      // 先按手性（入边优先）、再按权重降序、再按字典序 ⇒ "取哪条边当归宿"是**确定的**。
      cands.sort(
        (x, y) =>
          x.sense - y.sense ||
          y.weight - x.weight ||
          (x.via < y.via ? -1 : x.via > y.via ? 1 : 0) ||
          (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
      )
      for (const c of cands) {
        if (seedSet.has(c.key) || c.key === node) continue
        const weight = graphPriorityWeight(hop, c.sense)
        const prev = best.get(c.key)
        if (prev) {
          duplicates += 1
          const better = weight > prev.weight
          best.set(c.key, {
            key: c.key,
            hop: better ? hop : prev.hop,
            sense: better ? c.sense : prev.sense,
            via: better ? [c.via] : [...prev.via, c.via].sort(),
            occurrences: prev.occurrences + 1,
            maxWeight: Math.max(prev.maxWeight, c.weight),
            weight: better ? weight : prev.weight,
            priorityScore: better ? graphPriorityScore(hop, c.sense) : prev.priorityScore,
          })
          continue
        }
        best.set(c.key, {
          key: c.key,
          hop,
          sense: c.sense,
          via: [c.via],
          occurrences: 1,
          maxWeight: c.weight,
          weight,
          priorityScore: graphPriorityScore(hop, c.sense),
        })
        if (!seen.has(c.key)) {
          seen.add(c.key)
          next.push(c.key)
        }
      }
    }
    // 标准 BFS：下一轮扫描面 = **本轮新发现的**键（二跳要完整可达还需 `scope='global'`，见函数头）。
    frontier = next
    if (!frontier.length) break
  }

  return { additions: [...best.values()], seen, duplicates }
}

/** 扩展结果的排序口径（**唯一**处；两处排序即两处漂移）。 */
export function sortAdditions(list: readonly GraphAddition[]): GraphAddition[] {
  return [...list].sort(
    (x, y) =>
      y.priorityScore - x.priorityScore ||
      x.hop - y.hop ||
      x.sense - y.sense ||
      (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
  )
}

// ══ 主入口 ═════════════════════════════════════════════════════════════════

/**
 * **图腿主入口**：读 `memory_items.related_ids` ⇒ 构邻接 ⇒ 扩展（`hops` 跳）。
 *
 * 本函数**除入参非法（`overrides` 越界，判据面输入）外永不抛错**（DB 抛错折叠成显式
 * `reason` + `ran=false`）：调用点在 recall 的返回路径上，图腿是**附加检索腿**，它坏掉
 * 不该让整次召回失败（fail-open）—— 但它**必须留下可查的失败记录**，这正是本函数返回
 * `ran`/`reason` 而不是空数组的原因（`catch { return [] }` 是本仓明令禁止的形态）。
 */
export function runGraphLeg(db: GraphDbLike, opts: GraphLegOptions): GraphLegResult {
  const cfg: RecallGraphKnobs = { ...DEFAULT_RECALL_GRAPH_KNOBS, ...(opts.cfg ?? {}) }
  const hops = opts.overrides?.hops ?? cfg.hops
  const scope = opts.overrides?.scope ?? cfg.scope
  if (!Number.isInteger(hops) || hops < 0 || hops > GRAPH_HOPS_MAX) {
    throw new RangeError(`runGraphLeg: hops 必须是 0..${GRAPH_HOPS_MAX} 的整数，实测 ${String(hops)}`)
  }
  if (scope !== 'seeds' && scope !== 'global') {
    throw new RangeError(`runGraphLeg: scope 必须是 'seeds'|'global'，实测 ${String(scope)}`)
  }
  const seeds = [...new Set(opts.seeds)]

  const stop = (reason: string, probe: RelatedIdsColumnProbe, consumed: string, seedCount = seeds.length): GraphLegResult => ({
    ran: false,
    exact: false,
    hops,
    scope,
    seedCount,
    additions: [],
    edgesSeen: 0,
    seedsWithEdges: 0,
    seedsWithoutEdges: 0,
    unreachableKeys: [],
    seenCount: 0,
    selfRefs: 0,
    duplicates: 0,
    unreadableRows: 0,
    probe,
    consumed,
    reason,
  })

  if (!cfg.enabled) return stop(GRAPH_DISABLED_REASON, { state: 'not-probed', reason: null }, '未读取（已显式关闭）')
  if (!seeds.length) return stop(GRAPH_NO_SEED_REASON, { state: 'not-probed', reason: null }, '未读取（无种子）', 0)

  // ── 列探测：**先探列，再看查询结果**（列不存在 ⇒ "查不到"与"没有边"必须可分辨）──────────
  let probe: RelatedIdsColumnProbe = { state: 'present', reason: null }
  try {
    const cols = db.prepare("SELECT name FROM pragma_table_info('memory_items') WHERE name = ?").all('related_ids') as {
      name?: unknown
    }[]
    if (!cols.length) {
      probe = { state: 'missing-column', reason: 'memory_items.related_ids 列不存在（该库建于补列之前）' }
      return stop(`${GRAPH_REASON_PREFIX}列缺失：${probe.reason}`, probe, '未读取（列不存在）')
    }
  } catch (error) {
    probe = { state: 'missing-column', reason: `列探测失败：${msgOf(error)}` }
    return stop(`${GRAPH_REASON_PREFIX}${probe.reason}`, probe, '未读取（探测失败）')
  }

  // ── 取行：两种范围（缺省 'seeds' = §14.3 的"召回结果 → 邻接扩展"）────────────────────
  const rows: GraphRow[] = []
  const errors: string[] = []
  if (scope === 'global') {
    // ⚠ 全表读**不加 LIMIT**：截断会让"没扩出来"与"被截断"同形（本仓最防的形态）。
    //   代价如实写出：这是 O(库大小) 的只读扫描，只应由"必须双向可达"的调用方开启。
    try {
      const got = db
        .prepare('SELECT id, related_ids FROM memory_items WHERE COALESCE(retired, 0) = 0')
        .all() as { id?: unknown; related_ids?: unknown }[]
      for (const r of got) rows.push({ id: String(r.id), relatedIds: (r.related_ids ?? null) as string | null })
    } catch (error) {
      errors.push(msgOf(error))
    }
  } else {
    const read = readRowsInChunks(db, seeds)
    rows.push(...read.rows)
    errors.push(...read.errors)
  }
  if (errors.length && !rows.length) {
    return stop(
      `${GRAPH_REASON_PREFIX}读取 memory_items.related_ids 失败：${errors.slice(0, 2).join('; ')}`,
      probe,
      '读取失败（0 行）',
    )
  }

  const gotKeys = new Set(rows.map((r) => r.id))
  const unreachableKeys = seeds.filter((s) => !gotKeys.has(s))
  const adjacency = buildAdjacency(rows)
  const { additions: raw, seen, duplicates } = expandByAdjacency(adjacency, seeds, hops)

  // ── 撞键无值（`sense=1`）：候选里**没有任何分**、却被边带到台面上的键 ──────────────────
  const additions = [...raw]
  const have = new Set(additions.map((a) => a.key))
  for (const key of opts.keylessKeys ?? []) {
    if (have.has(key) || seeds.includes(key)) continue
    have.add(key)
    const outs = adjacency.out.get(key) ?? []
    const ins = [...adjacency.out.entries()].filter(([, list]) => list.some((e) => e.id === key))
    const via = outs.length ? key : (ins[0]?.[0] ?? key)
    const edgeWeights = [...outs.map((e) => e.weight), ...ins.flatMap(([, list]) => list.filter((e) => e.id === key).map((e) => e.weight))]
    additions.push({
      key,
      hop: 1,
      sense: SENSE.hitKeyless,
      via: [via],
      occurrences: 1,
      maxWeight: edgeWeights.length ? Math.max(...edgeWeights) : 0,
      weight: graphPriorityWeight(1, SENSE.hitKeyless),
      priorityScore: graphPriorityScore(1, SENSE.hitKeyless),
    })
  }
  const sorted = sortAdditions(additions)

  const seedsWithEdges = seeds.filter((s) => (adjacency.out.get(s) ?? []).length > 0).length
  const seedsWithoutEdges = seeds.filter((s) => gotKeys.has(s) && (adjacency.out.get(s) ?? []).length === 0).length
  const consumed =
    scope === 'global'
      ? `memory_items.related_ids（列探测 present，全表只读扫描）⇒ ${rows.length} 行`
      : `memory_items.related_ids（列探测 present，按种子逐键查询）⇒ ${rows.length}/${seeds.length} 行`

  return {
    ran: true,
    exact: unreachableKeys.length === 0,
    hops,
    scope,
    seedCount: seeds.length,
    additions: sorted,
    edgesSeen: adjacency.edgesSeen,
    seedsWithEdges,
    seedsWithoutEdges,
    unreachableKeys,
    seenCount: seen.size,
    selfRefs: adjacency.selfRefs,
    duplicates,
    unreadableRows: adjacency.unreadableRows,
    probe,
    consumed,
    // ⚠ 部分种子查询失败**不改 `ran`**（腿确实跑了），但必须留可查原因：
    //   此时 exact=false 且 unreachableKeys 已点出是哪些行 —— 两处读数同一事实，不互相冒充。
    reason: errors.length
      ? `${GRAPH_REASON_PREFIX}部分种子查询失败（${errors.length} 条，按"取不到行"处理）：${errors[0]}`
      : null,
  }
}

// ══ 读数（载荷/服务面的**唯一**转换点）════════════════════════════════════════════

/**
 * 挂进 `mana/recall` 载荷的**图腿读数**（**契约外增量字段**：`ManaRecall` 本身不改）。
 *
 * ⚠ 与 `recallGateReadout` 同形状：`enabled`（配置要求跑）与 `ran`（真的跑了）**分列**，
 *   使「没开」与「开了没跑成」不互相冒充。
 * ⚠ `applied` 恒 `false`（图腿不改变 `RecallOutcome`，见文件头）—— 写成字段而不是留一句
 *   注释，是为了让"有没有真折叠进排序"**可被断言**（不是靠读代码）。
 */
export interface RecallGraphReadout {
  readonly enabled: boolean
  /** 恒 `false`（本批：图腿只带读数、不改管道结果）。 */
  readonly applied: boolean
  readonly ran: boolean
  readonly exact: boolean
  readonly hops: number
  readonly scope: 'seeds' | 'global'
  readonly seeds: number
  readonly seedsWithEdges: number
  readonly seedsWithoutEdges: number
  readonly edgesSeen: number
  readonly additions: number
  /** 每条扩展来自第几跳（如 `[1,1]`）—— 一行读数即可断言"跳数确实参与了"。 */
  readonly additionsFromHops: readonly number[]
  /** 每条扩展的来源/手性（如 `[1,2]`）—— 入边/出边不得同形。 */

  readonly additionsBySense: readonly number[]
  /** 扩展出来的键（按优先级降序）—— **这就是"被带出的对家"**。 */
  readonly keys: readonly string[]
  readonly seenCount: number
  readonly unreachableKeys: readonly string[]
  readonly selfRefs: number
  readonly duplicates: number
  readonly unreadableRows: number
  readonly columnState: ColumnState
  readonly consumed: string
  /** 未运行/失败原因（**非空 ⇔ `ran=false`**，可读）。 */
  readonly unwiredReason: string | null
}

export function recallGraphReadout(result: GraphLegResult, enabled: boolean): RecallGraphReadout {
  return {
    enabled,
    applied: false,
    ran: result.ran,
    exact: result.exact,
    hops: result.hops,
    scope: result.scope,
    seeds: result.seedCount,
    seedsWithEdges: result.seedsWithEdges,
    seedsWithoutEdges: result.seedsWithoutEdges,
    edgesSeen: result.edgesSeen,
    additions: result.additions.length,
    additionsFromHops: result.additions.map((a) => a.hop),
    additionsBySense: result.additions.map((a) => a.sense),
    keys: result.additions.map((a) => a.key),
    seenCount: result.seenCount,
    unreachableKeys: result.unreachableKeys,
    selfRefs: result.selfRefs,
    duplicates: result.duplicates,
    unreadableRows: result.unreadableRows,
    columnState: result.probe.state,
    consumed: result.consumed,
    unwiredReason: result.reason,
  }
}
