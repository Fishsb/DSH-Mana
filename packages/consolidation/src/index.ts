/**
 * `dsh-mana-consolidation` —— Mana 熏习：合并 + SOAR chunking
 *
 * ── 当前状态：**B4.1 已填实现**（本条与下面的历史记录并列，不覆盖）──────────────────────
 * 本包曾长期是 74 行"诚实的空壳"。B4.1 落地了**睡眠振荡的两层**（Spindle + Ripple，
 * 《v10 方案》§13.3 的「改造后用」裁定，见 `docs/mana-rollout-plan.md:546` ③），
 * 故 `status().behavior` 由 `'skeleton'` 改为 **`'active'`**（改为据实现事实回报，见下 §行为面）。
 * 尚未实现（仍属后续批次，**不得**读作已完成）：真正的**改库式合并**（把两条 `memory_items`
 * 并成一条并置 `retired=1`）、规则的效用/成功率测量（`utility`/`success_rate`/`strength`/`cost`
 * 四列本批**不写**，见 `rules.ts`）、算子序列的语义等价归并。
 *
 * ── 实现面（`src/`，判据在 `tests/b41-*.test.mjs`）────────────────────────────────────
 *  · `params.ts`        —— 三个判据阈值（0.7 / 7 / 2）+ 一个**工程缺省**（Top-N）的唯一出处
 *  · `vector-cosine.ts` —— 余弦通道**复用** `dsh-mana-vector`（本包不另写一份；三条接线路实测见该文件头）
 *  · `select.ts`        —— **Spindle 层**：按激活值降序选 Top-N
 *  · `consolidate.ts`   —— **Ripple 层**：逐条重放 → 与新皮层比对 → **≥0.7 合并 / 否则新颖**
 *  · `chunking.ts`      —— **SOAR chunking**：子目标 done + 序列 ≤7 + 重复 ≥2 ⇒ 规则草稿
 *  · `rules.ts`         —— 规则落 `production_rules`（**唯一写者**；列清单以 core 的 DDL 为准）
 *
 * ⚠ **依赖方向已订正（`册:509`）**：对 long-term 与 vector 一律走 `import.meta.resolve` +
 *   `ctx.get` 的**可选依赖**，`inject` **只声明 `['mana-core']`** —— 它们是本包的**数据源**，
 *   不是前置；声明成 inject 会成环（`forgetting`/`consolidation` 是 long-term 的维护者）。
 *   ⚠ 代价：装配期**不**保证 vector 在跑 ⇒ 余弦通道可能在运行时不可用。故 `plan()` 在余弦缺失时
 *   返回 `ripple: null` + **非空 `degraded.reason`**，绝不静默按"无合并"处理（G8）。
 *
 * ── 行为面（B4.1 的覆盖边界，如实声明）──────────────────────────────────────────────
 * B4.1 的交付是**纯判定 + 一个显式写库入口**：`select`/`ripple`/`chunk`/`plan` 全部零副作用
 * （不写 `mana_trace`、不注册业务监听器、不起定时器），只有 `writeRules()` 写 `production_rules`。
 * ⇒ `skeleton.test.mjs` 判据⑦（effect 面恰好 3 条）与 ⑧（空转时 0 行 `mana_trace`）**仍然成立**，
 *   **无需改动**；判据⑧ 在本席手上还**补了一颗反向的牙**（见该文件用例⑧ 的 ② 段）。
 * ⚠ 判据① 的期望值由 `'skeleton'` 改为 `'active'` —— 这是**实现变了而没交代**时报红的
 *   那条设计牙，改它必须同时给出"凭什么说是 active"的机检面（见 `tests/b41-defaults.test.mjs` ⑧）。
 *
 * ── 历史记录（P1 骨架期，保留原文）─────────────────────────────────────────────────
 * ⚠ **本骨架是"诚实的空壳"，且"没有行为"本身是机检事实**（R2 订正）：
 *   它**不写任何 `mana_trace` 行** ⇒ 「卸载后同一触发不再产生新行」这条反证判据在本包上
 *   **平凡通过**（成立的原因是"它从来没生效过"，G11）。故 `status()` **显式**回报
 *   `behavior: 'skeleton'`，并由 `tests/skeleton.test.mjs` **读运行时服务面**断言该值，
 *   且**并列断言"本包仍是空壳"**（判据⑦ effect 面恰好 3 条、判据⑧ 行为面 0 行）——
 *   一旦有人加进真行为而忘记改它，判据即变红（R2b 前这里只是注释承诺，零机检）。
 *
 *   ⚠ **反向不可机检，此处如实声明**（R2b 订正，删去原先的空承诺）：
 *     「填了真行为却把 `behavior` 留成 `'skeleton'` ⇒ 判据必红」**原句是空的** —— 实测
 *     （注入真行为、`behavior` 不动）六条全绿。真因是 **A 方案在此结构上不可行**：
 *     `behavior` 要"由实现事实推导"，就得先定"什么是本包的真行为"，而那是**阶段 2/3 的交付物**
 *     （写什么 `mana_trace` 行）⇒ 预写它即越界。
 *     现由 ⑦⑧ **间接**覆盖：**新增行为**（监听器/定时器/写行）必被 ⑦ 或 ⑧ 抓到；
 *     **残留盲区（如实记）**：若把行为换成"effect 数不变的同形实现"，⑦⑧ 抓不到。
 *
 * ⚠ **本包刻意不导出 `Config`**（R2 订正 · 删除一个假旋钮）：
 *   本轮一度导出 `enabled: boolean`，但它 `apply` 里零消费 —— `enabled=false` 与 `true`
 *   **完全同形**（监听器照注册、事件照透传），即"假旋钮"。两条修法（做真 vs 删掉）本席选**删掉**：
 *   ① `册:318` 要求骨架 `apply` **必须**注册 waterfall 监听器并调 `next()`（把 G9 钉成**结构约束**）。
 *      若让 `enabled` 去门控这条监听器 ⇒ G9 义务变成"可由配置关掉"，与结构约束的本意相悖；
 *      一枚配置就能静默取消 next() 纪律，正是本仓最要防的那类失败。
 *   ② 对一个零行为的空壳，可"关掉"的东西只剩服务提供面本身 ⇒ `enabled=false` 的形态与
 *      "插件根本没装/装失败"**同形**，等于新增一条静默通道。空壳本就够小，无需灰度旋钮。
 *   ⚠ **B4.1 未推翻这条**：新增能力全是纯函数 + 一个显式写库入口，阈值经 `params.ts` 常量而非
 *   配置面暴露（改阈值 = 改源码，判据可复算）；仍无真旋钮可关 ⇒ 依旧不导出 `Config`。
 *
 * ⚠ 硬结构约束（G9 / `册:318`）：`apply` 必须注册一条 waterfall 监听器并调 `next()`，
 *   走 core 的 `registerPassThroughPreStep`（唯一写点）。漏调的后果**不报错**：
 *   本仓实测上游不调 `next()` ⇒ 下游哨兵 reached=0、返回 undefined、全程无异常。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import { CONSOLIDATION_PARAMS } from './params.ts'
import { resolveVectorCosine, VECTOR_PACKAGE, type CosineFn } from './vector-cosine.ts'
import { selectTopN, type SelectableMemory, type SpindleSelection } from './select.ts'
import { ripple, type MergePlan, type NeocortexEntry } from './consolidate.ts'
import { chunkSequences, type ChunkingPlan, type OperatorRun, type ProductionRuleDraft } from './chunking.ts'
import { countProductionRules, readProductionRule, writeProductionRules, type WriteRulesResult } from './rules.ts'
import {
  renderPromptConstant,
  resolveSummaryChannel,
  summarize,
  SUMMARY_PROMPT_CONSTANT,
  type SummaryOutcome,
  type SummaryRequest,
} from './generation.ts'
import {
  coreDistillStore,
  distillSession,
  DISTILL_IDLE_THRESHOLD_MS,
  type DistillCodeGate,
  type DistillLlmService,
  type DistillResult,
} from './distill.ts'

/**
 * 蒸馏链在生产路径上的**请求面**（结构声明，不 import scheduler）。
 *
 * ⚠ 为什么不 `import type` scheduler：那会造出一条 consolidation → scheduler 的**依赖边**，
 *   与既有依赖方向（scheduler 依赖 core；consolidation 的依赖方向见文件头「册:509」）相反。
 *   本仓的结构接口都走本地声明（见 `ChainConsolidation`/`ChainSummary` 的先例）——
 *   代价是接口漂移编译期抓不到，只能靠端到端判据抓，与那些先例同一条取舍。
 */
export interface DistillProduceRequest {
  readonly sessionId: string
  /** 本会话的空闲毫秒数（**由调用方测**；链内不起定时器 —— 见 distill.ts 文件头）。 */
  readonly idleMs: number
  readonly candidates: readonly string[]
}

/**
 * 蒸馏链的**生产可达入口**（v10 §12.3）。
 *
 * ⚠ 它是本包把 `distillSession` 接到生产路径上的**唯一一条腿**：链内的写回面由
 *   `coreDistillStore(core)` 供给（**不新开第二条记忆写路径**，见 distill.ts 文件头
 *   「不写自己的审计表」）。**没有 core 时返回 `writeEnabled:false` 的读数**，不抛 ——
 *   抛出去只会让"写面没装配"看起来像"链坏了"（两者的处置完全不同）。
 */
/**
 * 编码侧码判（§12.3 的第二道门）的**运行期解析**。
 *
 * ⚠ 为什么和 `vector-cosine.ts` 同款走 `import.meta.resolve` + `createRequire` 而不是 `import`：
 *   本包对 `long-term` 的依赖是**可选**的（见文件头「册:509」：声明成 inject 会成环）。
 *   `import` 一个可选包会让"它没装"变成"本包起不来"，那正是本仓要防的静默形态。
 * ⚠ **解析失败返回 null，不抛、不冒充** —— 链内该腿记 `ran:false`，
 *   使「没接线」与「判过没通过」**永不同形**（这是两道门不坍成一道的前提）。
 * ⚠ 每次调用**现解析**（不缓存模块对象）：与 `resolveVectorCosine`、`svc()` 同一条既有取舍
 *   （常驻进程里后装配的包必须能被接上）。
 */
function resolveCodeGate(): DistillCodeGate | null {
  try {
    const entryUrl = import.meta.resolve('dsh-mana-long-term')
    const source = join(dirname(fileURLToPath(entryUrl)), 'write-gate.js')
    const req = createRequire(import.meta.url)
    const mod = req(source) as { prefilterWorthKeeping?: unknown }
    if (typeof mod.prefilterWorthKeeping !== 'function') return null
    const fn = mod.prefilterWorthKeeping as (text: string) => {
      hit: boolean
      overlap: number
      threshold: number
      bankSize: number
    }
    return (text: string) => fn(text)
  } catch {
    // 归因不丢：链内的 codeGate.ran=false **就是**这里的读数（不另发事件 —— 见 distill.ts
    // 「缺省为 null ⇒ 该腿记 ran:false，不是'通过'」）。
    return null
  }
}

export interface DistillProduceOutcome {
  readonly state: string
  readonly reason: string
  readonly llmCalls: number
  readonly llmDegraded: string | null
  readonly writeEnabled: boolean
  readonly inserted: readonly string[]
  readonly idempotentSkips: number
  readonly candidates: number
  readonly prefilter: {
    readonly ran: boolean
    readonly scanned: number
    readonly hit: number
    readonly miss: number
    readonly empty: number
    readonly table: string | null
  }
  readonly thresholdMs: number | null
  readonly vetoedBy: readonly (string | null)[]
  readonly writeErrors: readonly string[]
  /** 编码侧码判（第二道门）真跑了几条 —— **0 ≠ 通过**（见 distill.ts 的「两道门」）。 */
  readonly codeGateRan: number
}

export const name = 'mana-consolidation'

/** 依赖 core（方案 §9.1）。依赖仅 core（依赖方向订正见文件头）。 */
export const inject: string[] = ['mana-core']

/**
 * 本包的**实现面**（导出名的机检清单）。
 *
 * ⚠ 它是一等判据面，不是文档：`tests/b41-defaults.test.mjs` 判据⑧ 逐个断言"是函数"，
 *   把实现搬走/改名而判据不同步 ⇒ 必红（一条反"实现被挖空"的腿）。
 */
export const IMPLEMENTED_EXPORTS = [
  'selectTopN',
  'ripple',
  'chunkSequences',
  'isCandidateSequence',
  'signatureOf',
  'writeProductionRules',
  'readProductionRule',
  'countProductionRules',
  'resolveVectorCosine',
] as const

/** 一次完整巩固请求（只读判定；**本层不写库**）。 */
export interface ConsolidationRequest {
  /** 本轮重放周期标识（可追溯；无语义 —— SO 90 分钟节律**不移植**，见 `select.ts`）。 */
  readonly periodId: string
  /** 候选记忆项（触发条件①「子目标 active→done」由调用方筛选）。 */
  readonly items: readonly SelectableMemory[]
  /** 新皮层语义记忆（Ripple 的比对靶）。 */
  readonly neocortex: readonly NeocortexEntry[]
  /** 已完成子目标的过程记录（chunking 的输入）。 */
  readonly runs: readonly OperatorRun[]
  readonly topN?: number
  readonly similarityThreshold?: number
  readonly minRepeats?: number
  readonly maxSteps?: number
}

export interface ConsolidationPlan {
  readonly periodId: string
  readonly spindle: SpindleSelection
  /** `null` = 余弦通道不可用 ⇒ **Ripple 未执行**（不得读成"没有可合并的"）。 */
  readonly ripple: MergePlan | null
  /** 余弦不可用时的**显式**降级（非空 reason + 实测 source）。可用时为 `null`。 */
  readonly degraded: { readonly reason: string; readonly source: string } | null
  readonly chunking: ChunkingPlan
}

export interface ManaSvc {
  readonly plugin: string
  /**
   * `'skeleton'` = 本包**尚无行为**；`'active'` = 已填实现。
   *
   * B4.1 起为 `'active'`：本包已导出 9 个可复算的实现成员（`IMPLEMENTED_EXPORTS`，
   * 由 `tests/b41-defaults.test.mjs` ⑧ 逐个断言）。⚠ 仍**不**写 `mana_trace`、仍**不**起定时器
   * ⇒ "active" 的边界是「真实现存在且可机检」，**不是**「已在生产链路上自动生效」。
   * 唯一的写入面是 `writeRules()`（显式调用才发生）。
   */
  status(): { plugin: string; wired: boolean; behavior: 'skeleton' | 'active'; vector: string }
  /** Spindle 层（纯函数）。 */
  select(periodId: string, items: readonly SelectableMemory[], n?: number): SpindleSelection
  /** Ripple 层（纯判定；余弦由本服务注入）。⚠ 不可用时**抛错**，不返回空计划。 */
  ripple(input: {
    periodId: string
    selected: readonly SelectableMemory[]
    neocortex: readonly NeocortexEntry[]
    similarityThreshold?: number
  }): MergePlan
  /** SOAR chunking（纯函数）。 */
  chunk(runs: readonly OperatorRun[], opts?: { minRepeats?: number; maxSteps?: number; at?: string }): ChunkingPlan
  /** 一次完整巩固的**只读**判定（Spindle → Ripple → chunking）。 */
  plan(req: ConsolidationRequest): ConsolidationPlan
  /** 落库（**唯一写者**，写 `production_rules`；含写后读回校验）。 */
  writeRules(rules: readonly ProductionRuleDraft[]): WriteRulesResult
  /** 余弦通道解析状态（**显式**——不是静默降级；`ok=false` 时 reason 非空）。 */
  vectorRoute(): { ok: boolean; source: string; reason: string | null }
  /**
   * **生成通道解析状态**（§13.5 深睡归纳）。
   *
   * ⚠ 与 `vectorRoute()` 同款三态：`ok=false` 时 `reason` 非空且 `missing` 点名缺哪条腿。
   *   **不得**用「`available:false` 但没人看」的形态 —— 调用方（链驱动者）必须把它写进 trace。
   */
  generationRoute(): { ok: boolean; source: string; reason: string | null; missing: readonly string[] }
  /**
   * 深睡归纳（§13.5）：用 `mana-prompts` 的 system 模板 + `mana-llm` 的生成入口产一段摘要。
   *
   * ⚠ 本方法**不写库、不落 trace**（本包无 trace 写面）；它只回三态结果与 `callId`，
   *   留痕归调用方。这样「谁发起的一次生成」永远可回查，而本包不新增第二处审计真源。
   */
  summarize(request: SummaryRequest): Promise<SummaryOutcome>
  /**
   * **会话蒸馏链（v10 §12.3）的生产入口** —— `distillSession` 的唯一生产调用方落点。
   *
   * ⚠ 「链有了」≠「链在跑」：本包交付 `distill.ts` 时它是**零外部消费者**的（与它自己要修的
   *   `prefilterBySignalWords` 同一形态）。本方法把它接到服务面上，由 scheduler 的空闲触发
   *   调用 —— 判据 `tests/distill-wiring.test.mjs` 用**计数会抛的桩**证明生产路径真调到了它，
   *   且「预筛未命中 ⇒ 桩零调用」。
   * ⚠ 本方法**不起任何触发**（定时器/监听器）：何时发起归 scheduler（与 distill.ts 文件头的
   *   「不注册监听器、不起定时器」一致）。
   * ⚠ 它**不抛**（除预筛实现自身抛错，那是 distill.ts 刻意保留的归因通道）：失败一律折进
   *   `state` + `reason`，由调用方决定留痕。
   */
  distillProduce(request: DistillProduceRequest): Promise<DistillProduceOutcome>
  /** 阈值快照（**只读**；证"阈值不是配置文件里的字面量"）。 */
  readonly thresholds: typeof CONSOLIDATION_PARAMS
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-consolidation': ManaSvc
  }
}

/**
 * 装配。
 *
 * ⚠ `core` 是**硬依赖**（inject）；`vector`/`long-term` 是**可选**（`import.meta.resolve` + 运行时
 * 解析），解析失败**不抛错**：抛错会让"vector 暂时不可用"变成"consolidation 不启动"，
 * 而那正是本仓要防的静默形态（插件没起来 = 与空壳同形）。降级信息走 `status().vector`
 * 与 `plan().degraded` 两条显式通道。
 */
export function apply(ctx: Context): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-consolidation: 缺少 mana-core 服务（inject 未满足）')

  const route = resolveVectorCosine()
  const cosine: CosineFn | null = route.ok ? route.cosine : null

  const service: ManaSvc = {
    plugin: name,
    status: () => ({
      plugin: name,
      wired: true,
      behavior: 'active',
      vector: route.ok ? `ok:${route.via}` : `unavailable:${route.reason}`,
    }),
    thresholds: CONSOLIDATION_PARAMS,
    select: (periodId, items, n) => selectTopN(periodId, items, n),
    ripple: (input) => {
      if (!route.ok) {
        // ⚠ 不得静默返回空计划：调用方会把"空"读成"没有可合并的"，而真因是**比对通道不在**。
        throw new Error(`mana-consolidation: 余弦通道不可用（${route.source}: ${route.reason}）⇒ Ripple 无法执行`)
      }
      return ripple({ ...input, cosine: route.cosine })
    },
    chunk: (runs, opts) => chunkSequences(runs, { ...(opts ?? {}) }),
    plan: (req) => {
      const spindle = selectTopN(req.periodId, req.items, req.topN)
      let mergePlan: MergePlan | null = null
      let degraded: { reason: string; source: string } | null = null
      if (!route.ok) {
        degraded = { reason: route.reason, source: route.source }
      } else {
        mergePlan = ripple({
          periodId: req.periodId,
          selected: spindle.selected,
          neocortex: req.neocortex,
          cosine: route.cosine,
          ...(req.similarityThreshold !== undefined ? { similarityThreshold: req.similarityThreshold } : {}),
        })
      }
      const chunking = chunkSequences(req.runs, {
        ...(req.minRepeats !== undefined ? { minRepeats: req.minRepeats } : {}),
        ...(req.maxSteps !== undefined ? { maxSteps: req.maxSteps } : {}),
      })
      return { periodId: req.periodId, spindle, ripple: mergePlan, degraded, chunking }
    },
    writeRules: (rules) => writeProductionRules(core, rules),
    vectorRoute: () => ({ ok: route.ok, source: route.source, reason: route.ok ? null : route.reason }),
    /**
     * **会话蒸馏（v10 §12.3）的生产调用**。
     *
     * 逐条口径：
     *  · 判定通道 `llm` 走 `ctx.get('mana-llm')` 的**现解析**（不缓存）—— 常驻进程里后装配的
     *    llm 必须能被接上（与 `resolveDistillLlm`、本文件 `summarize` 同一条取舍）。
     *  · 写回面 `store` 走 `coreDistillStore(core)` —— **唯一写口**，不新开第二条记忆写路径。
     *  · `codeGate` 现解析（`resolveCodeGate()`，每次现取不缓存，同 `resolveVectorCosine`）——
     *    它是 `long-term` 的判据面，**本包不重写它**（重写即第二份真源，两道门就坍成一道）。
     *    解析不到 ⇒ 传 null，链内该腿记 `ran:false`（**不冒充通过**）。
     *  · `prefilterOverride` **生产从不传**（传了就等于换掉 §12.3 的那道门）。
     */
    distillProduce: async (request: DistillProduceRequest): Promise<DistillProduceOutcome> => {
      const llm = (ctx.get('mana-llm') ?? null) as unknown as DistillLlmService | null
      const result: DistillResult = await distillSession({
        sessionId: request.sessionId,
        idleMs: request.idleMs,
        candidates: request.candidates,
        ctx,
        llm,
        store: coreDistillStore(core),
        codeGate: resolveCodeGate(),
      })
      return {
        state: result.state,
        reason: result.reason,
        llmCalls: result.llmCalls,
        llmDegraded: result.llmDegraded,
        writeEnabled: result.writeEnabled,
        inserted: result.inserted,
        idempotentSkips: result.idempotentSkips,
        candidates: result.candidates.length,
        prefilter: {
          ran: result.prefilter.ran,
          scanned: result.prefilter.scanned,
          hit: result.prefilter.hit,
          miss: result.prefilter.miss,
          empty: result.prefilter.empty,
          table: result.prefilter.table,
        },
        thresholdMs: result.idle.thresholdMs,
        // ⚠ 「为什么被挡」的**分布**（不是布尔）：白名单/粒度/编码侧码判/写失败四条腿各自可读。
        vetoedBy: result.decisions.map((d) => d.vetoedBy),
        codeGateRan: result.decisions.filter((d) => d.codeGate.ran).length,
        writeErrors: result.decisions
          .map((d) => d.writeError)
          .filter((e): e is string => typeof e === 'string' && e !== ''),
      }
    },
    // ⚠ 生成通道**每次现解析**（不缓存）：常驻进程里后装配的 prompts/llm 必须能被接上
    //   （与 scheduler/chains.ts 的 `svc()`、「每次调用时解析，不缓存」同一条既有取舍）。
    generationRoute: () => {
      const channel = resolveSummaryChannel(ctx)
      return channel.ok
        ? { ok: true, source: channel.source, reason: null, missing: [] as readonly string[] }
        : { ok: false, source: channel.source, reason: channel.reason, missing: channel.missing }
    },
    summarize: (request: SummaryRequest) => summarize(resolveSummaryChannel(ctx), request),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-consolidation', service)
    return () => dispose()
  }, 'dsh-mana-consolidation: service')

  // G9：waterfall 直通 + next()。**无条件注册**（不得由任何配置门控，见文件头）。
  registerPassThroughPreStep(ctx, name)
}

export { CONSOLIDATION_PARAMS } from './params.ts'
export { resolveVectorCosine, VECTOR_PACKAGE } from './vector-cosine.ts'
export { selectTopN } from './select.ts'
export { ripple } from './consolidate.ts'
export { chunkSequences, isCandidateSequence, signatureOf, fnv1a } from './chunking.ts'
export { writeProductionRules, readProductionRule, countProductionRules, WRITTEN_COLUMNS, UNMEASURED_COLUMNS } from './rules.ts'
export {
  resolveSummaryChannel,
  renderPromptConstant,
  summarize,
  SUMMARY_PROMPT_CONSTANT,
  SUMMARY_SERVICES,
} from './generation.ts'
export type {
  SummaryChannel,
  SummaryOutcome,
  SummaryRequest,
  SummaryPromptsService,
  SummaryLlmService,
} from './generation.ts'
// ── 蒸馏链（v10 §12.3）面 —— 公共导出，供生产**唯一调用方**（scheduler 的空闲触发）消费 ──
export {
  coreDistillStore,
  distillSession,
  DISTILL_IDLE_THRESHOLD_MS,
  DISTILL_MAX_COARSE_CHARS,
  DISTILL_MIN_TEXT_CHARS,
  DISTILL_MEMORY_TYPE,
  DISTILL_STATES,
  DISTILL_TOPIC_SEPARATOR,
} from './distill.ts'
export type {
  DistillCandidate,
  DistillCodeGate,
  DistillDecision,
  DistillLlmService,
  DistillResult,
  DistillSessionInput,
  DistillState,
  DistillStore,
} from './distill.ts'
// ⚠ `DistillProduceOutcome`/`DistillProduceRequest` **不在这里再导一次**：它们在本文件顶部
//   就地声明（`export interface`）⇒ 已经是本包的导出面，重复导出会 TS2484（实测）。
//   这也正是不 `import type` scheduler 的代价落点：形状写在消费侧，漂移靠端到端判据抓。
export type { SelectableMemory, SpindleSelection, SkipReason } from './select.ts'
export type { MergePlan, NeocortexEntry, RippleVerdict } from './consolidate.ts'
export type { ChunkingPlan, OperatorRun, ProductionRuleDraft, DropReason } from './chunking.ts'
export type { CosineFn, CosineResolution } from './vector-cosine.ts'
