/**
 * `dsh-mana-forgetting` —— Mana 种子衰减：艾宾浩斯衰减 + 间隔重复 + 四区间归档
 *
 * ── 当前状态：**B4.2 已填实现**（本条与下面的历史记录并列，不覆盖）───────────────────
 * 本包曾长期是 74 行"诚实的空壳"。B4.2 落地了 **Pavlik & Anderson 间隔重复 + 艾宾浩斯留存核
 * + 激活值四区间归档 + 归档候选（只读）**，故 `status().behavior` 由 `'skeleton'` 改为
 * **`'active'`**（据实现事实回报）。
 * 尚未实现（仍属后续批次，**不得**读作已完成）：**真归档的三步流程只有第 ① 步（列候选）**——
 *   `retired` 置位、90 天压缩（`sum(length(content))` 必须下降）、归档行排除出检索
 *   分别需要 core 的写口与检索面改动 ⇒ 由 `retirementPlan().unimplemented` **显式列出**。
 *   故本包现在导出的 `retireCandidates()` **只产出清单**：`retired=1` 是标记不是归档
 *   （判据 A3-2 `docs/mana-rollout-plan.md:558` 明文「只满足①只算标记」）。
 *
 * ── 实现面（`src/`，判据在 `tests/forgetting.test.mjs`）──────────────────────────
 *  · `params.ts`    —— 本包参数的**唯一出处**（Pavlik 三参数 / 四区间边界 / 留存上限缺省）
 *  · `strength.ts`  —— `ΔS = a·(S_max − S)^b`（**A3-4 ①的实现者**）
 *  · `retention.ts` —— `retention(t,S) = exp(-t/S)`（**A3-4 的实现者**）+
 *                       `decayAnchorReadings(kernel, eps)`（**A1-5 的读数面**：把判据表三锚点交给注入的真核求值）+
 *                       `equivalentHalfLifeDays(S) = S·ln2`（与 long-term 的 decay 同一核的证据）
 *  · `archive.ts`   —— 四区间归档 `A>τ+1.0 / τ<A≤τ+1.0 / τ-0.5<A≤τ / A≤τ-0.5`（**B4.2 ②**）
 *  · `prune.ts`     —— 修剪**只读候选视图**（**B4.2 ④**；不写库、不触发归档）
 *  · `criteria.ts`  —— **包内阈值注册表**（形态参考 metacognition 的 criteria.json；
 *                       本表**不新增机检 ID**，见落地册:547 ④）
 *
 * ── ⚠ 与 `long-term` 的衰减**不是两套曲线**（C14 点名「三套衰减公式并存」）───────────
 *   `retention(t,S) = exp(-t/S) = exp(-t·ln2 / (S·ln2)) = decay(t, S·ln2)`
 *   ⇒ 本包**不重写**那条核：装配期 `ctx.get('mana-long-term')`（**可选依赖**，
 *     依赖方向按落地册 §2.1 订正：`inject` 只声明 `['mana-core']`），拿到就用它的 `decay`，
 *     拿不到才走 `retention.ts` 的闭式；`readings().kernelSource` **如实回报走了哪条**
 *     （不静默降级 —— 降级态必须可读）。
 *   ⛔ 半衰期常量（`long-term/src/params.ts:54` 的 `HALF_LIFE_DAYS`）**本包不重新定义**。
 *
 * ── 历史记录（P1 骨架期，保留原文）─────────────────────────────────────────────────
 * ⚠ **本轮（B2.2）只立骨架，不填实现**：`册:743` C12 的设计意图是
 *   「13 个空壳同批装配后面板上分不出哪几个真有行为」⇒ P1 分批建、骨架与实现分开交付。
 *
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
 *   ⚠ **B4.2 未推翻这条**：本批交付仍然**全是纯函数**（无监听器、无定时器、不写库、不落行）
 *   ⇒ 依旧**没有真旋钮可关**（留存上限/修剪阈值都是**调用参数**，不是插件配置：
 *      配置面是全局单值，而这些阈值必须逐次判定时给 —— 见 `criteria.ts` 的注册表）。
 *
 * ⚠ 硬结构约束（G9 / `册:318`）：`apply` 必须注册一条 waterfall 监听器并调 `next()`，
 *   走 core 的 `registerPassThroughPreStep`（唯一写点）。漏调的后果**不报错**：
 *   本仓实测上游不调 `next()` ⇒ 下游哨兵 reached=0、返回 undefined、全程无异常。
 *
 * ── 行为面（B4.2 的覆盖边界，如实声明）─────────────────────────────────────────────
 * B4.2 的交付是**纯计算**：不写 `mana_trace`、不落库、不改 `retired` 列、不注册业务监听器。
 * 故 `skeleton.test.mjs` 判据⑦（effect 面恰好 3 条）与 ⑧（`mana_trace` 0 行）**仍然成立**，
 * 无需改动 —— 见 `docs/handoff/S17.md` §4 对"⑦⑧要不要改"的逐条判断。
 * ⚠ 诚实边界：`behavior: 'active'` 目前**没有任何判据强制它**（R2b 说的"反向不可机检"）。
 *   本包新增 `tests/forgetting.test.mjs` 判据⑩ 断言实现面非空（导出逐个是函数）——
 *   它覆盖"实现被搬走"，**不**覆盖"实现还在而 behavior 写回 skeleton"。后者仍是盲区，未修。
 * ⚠ 可选依赖缺失时的可观测性（`docs/mana-rollout-plan.md:510`「未运行必须可查」）：
 *   本包**不**在 `apply` 里写 `mana/plugin/inactive` —— 它**自身从不因依赖缺失而不运行**
 *   （`inject` 只有 `mana-core`，缺它 core 会抛错在 `apply` 首行）。缺 `long-term` 时本包
 *   **照常工作**（走闭式核），那不是"未运行"。该口径由 `readings().kernelSource` 如实暴露，
 *   避免用一条 trace 行制造"看起来在监控"的假象。
 *
 * 阶段 3 的 B4.2 在此填实现。⚠ 归档留存上限必须与「物理删除永不发生」一起定，否则只监控不设限。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import {
  ARCHIVE_RETENTION_CALIBRATED,
  ARCHIVE_RETENTION_DEFAULT_DAYS,
  S_MAX,
  S_INITIAL,
  TAU_FALLBACK,
} from './params.ts'
import {
  archiveIntervalRows,
  classify,
  classifyAll,
  decliningCandidates,
  retireCandidates,
  retirementPlan,
  capStatus,
  type ActivationSnapshot,
  type ArchiveLedger,
  type CapReading,
  type Classification,
  type RetirementPlan,
} from './archive.ts'
import {
  A1_5_ANCHOR_POINTS,
  decayAnchorReadings,
  decayKernelTeeth,
  equivalentHalfLifeDays,
  retention,
  retentionWith,
  type DecayAnchorReading,
  type DecayKernelLike,
  type DecayKernelTeethOptions,
  type DecayKernelTeethReading,
} from './retention.ts'
import { strengthAfterRepeat, strengthAfterRepeats, strengthDelta, strengthDeltaRaw, type PavlikParams } from './strength.ts'
import { pruneCandidates, pruneViewSummary, type PruneView, type PruneViewOptions } from './prune.ts'
import { CRITERIA_REGISTRY, calibrationConsistency, uncalibratedIds } from './criteria.ts'

export const name = 'mana-forgetting'

/**
 * 依赖 core（方案 §9.1）。
 *
 * ⚠ **依赖方向订正**（`docs/mana-rollout-plan.md:509`）：原方案把 `forgetting` 挂在
 *   `long-term` 之下 —— 「它们是 long-term 的维护者却成了依赖者」。本包 `inject` **只**声明
 *   `mana-core`；对 `long-term` 走 `ctx.get` **可选依赖**（装配不上也照常工作）。
 */
export const inject: string[] = ['mana-core']

/**
 * 本包的**实现面**（导出名的机检清单）。
 *
 * ⚠ 它是一等判据面，不是文档：`tests/forgetting.test.mjs` 判据⑩ 逐个断言"是函数/是对象"，
 *   把实现搬走或改名而判据不同步 ⇒ 必红。
 */
export const IMPLEMENTED_EXPORTS = [
  'classify',
  'classifyAll',
  'retireCandidates',
  'archiveIntervalRows',
  'decliningCandidates',
  'capStatus',
  'retirementPlan',
  'strengthDelta',
  'strengthDeltaRaw',
  'strengthAfterRepeat',
  'strengthAfterRepeats',
  'retention',
  'retentionWith',
  'equivalentHalfLifeDays',
  'pruneCandidates',
  'pruneViewSummary',
] as const

/** `long-term` 的**衰减核 + τ** 的最小读取面（可选依赖；缺失即降级）。 */
interface LongTermLike {
  readonly activation?: { readonly decay?: unknown; readonly params?: { readonly tau?: number } }
  readonly params?: { readonly tau?: number }
}

/** 装配读数：核的来源 + τ 的来源 + 未校准项。**降级必须可读**，不许静默。 */
export interface ForgettingReadings {
  /** 衰减核来自哪：`'mana-long-term'`（复用它的 `decay`）或 `'fallback'`（本包闭式）。 */
  readonly kernelSource: 'mana-long-term' | 'fallback'
  /** τ 的来源（`long-term` 的 `params.tau` / 本包降级缺省）。 */
  readonly tauSource: 'mana-long-term' | 'fallback'
  /** 生效的 τ 读数。 */
  readonly tau: number
  /** 生效的 S_max（天）。 */
  readonly sMax: number
  /** 生效的归档留存上限（天）。 */
  readonly archiveRetentionDays: number
  /** 该上限是否**已校准**。`false` ⇒ `capStatus` 只回 `'uncalibrated'`/`'over'`。 */
  readonly archiveRetentionCalibrated: boolean
  /** 注册表里**未校准**的阈值 id（`samples=0` 或未预注册）。 */
  readonly uncalibrated: readonly string[]
}

/** 遗忘纯函数面（**只读**：不写库、不改 `retired`、不注册监听器）。 */
export interface ManaForgetting {
  /** 四区间归档归属（`A` 与 `τ` 显式传入 —— τ 的唯一写者是 long-term）。 */
  classify(memoryId: string, activation: number, tau?: number, retired?: boolean): Classification
  /** 整批归属 + 分桶。 */
  classifyAll(items: readonly ActivationSnapshot[], tau?: number): ReturnType<typeof classifyAll>
  /** **归档候选清单**（`A≤τ−0.5` **且 retired=0**，对齐 A3-2 ① 的 SQL；只列，不是执行）。 */
  retireCandidates(items: readonly ActivationSnapshot[], tau?: number): readonly Classification[]
  /** 归档区间**全部**行（含已退役）；与 `retireCandidates` 分列，两口径不合成一个数。 */
  archiveIntervalRows(items: readonly ActivationSnapshot[], tau?: number): readonly Classification[]
  /** 「衰退中」候选清单（降注入优先级）。 */
  decliningCandidates(items: readonly ActivationSnapshot[], tau?: number): readonly Classification[]
  /** 归档**留存上限**判定（三态；未校准**不得**读成 ok）。 */
  capStatus(ledger: ArchiveLedger, now: number, capDays?: number | null): CapReading
  /** 「真归档」三步流程现状（未做的部分**显式列出**）。 */
  retirementPlan(): RetirementPlan
  /** 单步强度增量 `ΔS`（原始式，**会越界** —— 见 `strengthDeltaRaw` 的实测记录）。 */
  strengthDelta(s: number, p?: Partial<PavlikParams>): number
  /** 与 `strengthDelta` 同值（公开别名，供判据/回归直接引用"裸公式"这一事实）。 */
  strengthDeltaRaw(s: number, p?: Partial<PavlikParams>): number
  /** 一次重复后的强度。 */
  strengthAfterRepeat(s: number, p?: Partial<PavlikParams>): number
  /** 连续重复 `n` 次后的强度。 */
  strengthAfterRepeats(s0: number, n: number, p?: Partial<PavlikParams>): number
  /** 留存率 `exp(-t/S)`。走 `long-term` 的核（若可用），否则本包闭式。 */
  retention(t: number, s: number): number
  /** 强度 ⇒ 等价半衰期 `h = S·ln2`（与 long-term 的 decay 同核的可复算证据）。 */
  equivalentHalfLifeDays(s: number): number
  /**
   * **A1-5 三锚点的真核读数**（核 = 装配期 `ctx.get('mana-long-term')` 的那一份）。
   *
   * ⚠ **未装配长时记忆时抛错，不回退本包闭式** —— 这是本方法的要点：
   *   回退会造出「判据绿」的第二种来源（本包自己的闭式），而 A1-5 要判的恰恰是
   *   `long-term` 那条核算得对不对。回退等于把「真核没接上」读成「锚点全过」。
   *   ⇒ 判据侧只读本方法的读数，就不再依赖「判据器内联闭式」那条自证路径。
   */
  decayAnchors(eps?: number): readonly DecayAnchorReading[]

  /**
   * **带牙腿**：核必须满足两条契约 —— ① `halfLifeDays` 参数真被消费（不是死旋钮）；
   * ② `t<0` 必抛（fail-closed）。核取自装配期，未装则抛（同 `decayAnchors`）。
   *
   * ⚠ 为什么要在这里暴露：三锚点全取在 `t ≥ 0` 且同一个 `h` ⇒ **两种坏核能把三锚点全过**
   *   （c3 accept 席实测）。判据腿若只吃锚点，就比实现面**更弱**。
   */
  decayKernelTeeth(options: DecayKernelTeethOptions): DecayKernelTeethReading
  /** 修剪**只读候选视图**（不写库、不触发归档）。 */
  pruneCandidates(items: readonly ActivationSnapshot[], tau?: number, options?: PruneViewOptions): PruneView
  /** 修剪视图的一行摘要（面板用）。 */
  pruneViewSummary(view: PruneView): string
  /** 装配读数（核/τ 来源 + 未校准项）。 */
  readings(): ForgettingReadings
  /** 包内阈值注册表快照（只读）。 */
  criteria(): typeof CRITERIA_REGISTRY
  /** 「声称已校准」与「登记样本数」的一致性（`calibrated=true` 而 `samples=0` ⇒ 报红）。 */
  calibrationConsistency(): { ok: boolean; reason: string }
}

export interface ManaSvc {
  readonly plugin: string
  /** `'skeleton'` = 本包**尚无行为**（由 tests 读运行时服务面机检）；`'active'` = 已填实现。 */
  status(): { plugin: string; wired: boolean; behavior: 'skeleton' | 'active' }
  /** B4.2 新增：遗忘纯函数面（只读，见 `ManaForgetting`）。 */
  readonly forgetting: ManaForgetting
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-forgetting': ManaSvc
  }
}

/**
 * 解析 `long-term` 的衰减核。
 *
 * ⚠ 结构类型（`DecayKernelLike`）而非 import 它的类型：本包**不**在编译期依赖 long-term
 *   （`inject` 里没有它），只在运行期 `ctx.get` 试取 —— 拿不到就降级，且**如实回报**。
 */
function resolveKernel(ctx: Context): { kernel: DecayKernelLike | null; tau: number | null } {
  let lt: LongTermLike | undefined
  try {
    // ⚠ 走 cordis 的 `get(name: string)` 重载（本包**不** import long-term 的类型 ⇒ 它不在
    //   `keyof Context` 里）。拿不到是**正常态**（可选依赖），不是错误。
    const got: unknown = ctx.get('mana-long-term')
    lt = got as LongTermLike | undefined
  } catch {
    lt = undefined
  }
  const activation = lt?.activation
  const decay = activation?.decay
  const kernel: DecayKernelLike | null =
    typeof decay === 'function'
      ? { decay: (t: number, h?: number) => (decay as (t: number, h?: number) => number).call(activation, t, h) }
      : null
  const tauRaw = lt?.activation?.params?.tau ?? lt?.params?.tau
  const tau = typeof tauRaw === 'number' && Number.isFinite(tauRaw) ? tauRaw : null
  return { kernel, tau }
}

/** 装配纯函数面。**不写库、不注册业务监听器**（见文件头 §行为面）。 */
function makeForgetting(ctx: Context): ManaForgetting {
  const { kernel, tau } = resolveKernel(ctx)
  const tauEff = tau ?? TAU_FALLBACK
  const retentionFn = (t: number, s: number): number =>
    kernel ? retentionWith(kernel, t, s) : retention(t, s)
  const readings = (): ForgettingReadings => ({
    kernelSource: kernel ? 'mana-long-term' : 'fallback',
    tauSource: tau === null ? 'fallback' : 'mana-long-term',
    tau: tauEff,
    sMax: S_MAX,
    archiveRetentionDays: ARCHIVE_RETENTION_DEFAULT_DAYS,
    archiveRetentionCalibrated: ARCHIVE_RETENTION_CALIBRATED,
    uncalibrated: uncalibratedIds(),
  })
  const cap = (ledger: ArchiveLedger, now: number, capDays: number | null = ARCHIVE_RETENTION_DEFAULT_DAYS): CapReading =>
    capStatus(ledger, now, capDays, ARCHIVE_RETENTION_CALIBRATED)
  return Object.freeze({
    classify: (memoryId: string, activation: number, t: number = tauEff, retired = false) =>
      classify(memoryId, activation, t, retired),
    classifyAll: (items: readonly ActivationSnapshot[], t: number = tauEff) => classifyAll(items, t),
    retireCandidates: (items: readonly ActivationSnapshot[], t: number = tauEff) => retireCandidates(items, t),
    archiveIntervalRows: (items: readonly ActivationSnapshot[], t: number = tauEff) => archiveIntervalRows(items, t),
    decliningCandidates: (items: readonly ActivationSnapshot[], t: number = tauEff) => decliningCandidates(items, t),
    capStatus: cap,
    retirementPlan,
    strengthDelta,
    strengthDeltaRaw,
    strengthAfterRepeat,
    strengthAfterRepeats,
    retention: retentionFn,
    equivalentHalfLifeDays,
    // A1-5：核**必须**是装配期取到的那一份；取不到就抛（fail-closed，见接口注释）。
    // 带牙腿：同一个 kernel，同一套 fail-closed 口径（未装核 ⇒ 抛，不回退闭式）。
    decayKernelTeeth: (options: DecayKernelTeethOptions): DecayKernelTeethReading => {
      if (!kernel) {
        throw new Error(
          'forgetting.decayKernelTeeth: 未装配 mana-long-term ⇒ **无真核可判**（不得回退本包闭式自证）。' +
            '带牙腿判的是 long-term 那条核；回退会让「真核没接上」与「两条牙全过」同形。',
        )
      }
      return decayKernelTeeth(kernel, options)
    },
    decayAnchors: (eps: number = 1e-6): readonly DecayAnchorReading[] => {
      if (!kernel) {
        throw new Error(
          'forgetting.decayAnchors: 未装配 mana-long-term ⇒ **无真核可判**（不得回退本包闭式自证）。' +
            'A1-5 判的是 long-term 那条核；回退会让「真核没接上」与「锚点全过」同形。',
        )
      }
      return decayAnchorReadings(kernel, eps)
    },
    pruneCandidates: (items: readonly ActivationSnapshot[], t: number = tauEff, options?: PruneViewOptions) =>
      pruneCandidates(items, t, options),
    pruneViewSummary,
    readings,
    criteria: () => CRITERIA_REGISTRY,
    calibrationConsistency,
  })
}

export function apply(ctx: Context): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-forgetting: 缺少 mana-core 服务（inject 未满足）')

  const service: ManaSvc = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, behavior: 'active' }),
    forgetting: makeForgetting(ctx),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-forgetting', service)
    return () => dispose()
  }, 'dsh-mana-forgetting: service')

  // G9：waterfall 直通 + next()。**无条件注册**（不得由任何配置门控，见文件头）。
  registerPassThroughPreStep(ctx, name)
}

// 公共导出面（供其它包**只读**消费）。
export {
  ARCHIVE_RETENTION_DEFAULT_DAYS,
  ARCHIVE_RETENTION_CALIBRATED,
  A_RETIRE_MARGIN,
  A_STRONG_MARGIN,
  ARCHIVE_INTERVALS,
  PAVLIK_A,
  PAVLIK_B,
  S_MAX,
  S_INITIAL,
  TAU_FALLBACK,
  type ArchiveIntervalName,
  type IntervalSpec,
} from './params.ts'
export {
  archiveIntervalRows,
  classify,
  classifyAll,
  retireCandidates,
  decliningCandidates,
  capStatus,
  retirementPlan,
} from './archive.ts'
export type { ActivationSnapshot, ArchiveLedger, CapReading, CapStatus, Classification, RetirementPlan } from './archive.ts'
export { retention, retentionWith, equivalentHalfLifeDays } from './retention.ts'
// ⚠ A1-5 的判据面导出**单列清单**（与 long-term 的 IMPLEMENTED_RETIREMENT_EXPORTS 同一处置）：
//   `IMPLEMENTED_EXPORTS` 被 skeleton.test.mjs 的**独立清单逐名集合相等**钉死，
//   往它里面加名字会让**既有判据红**，而「改判据让它变绿」正是本仓禁止的动作。
export const IMPLEMENTED_A15_EXPORTS = ['A1_5_ANCHOR_POINTS', 'decayAnchorReadings', 'decayKernelTeeth'] as const

/**
 * ⚠ **第二份真源（互覆盖腿的对照物）**：上面那张清单是**待检对象**，本表是**独立写一遍的对照表**。
 *   只有一张清单 + `length === N` 是**自指**的：删一项、把 N 改小，断言照样全绿
 *   （c3 accept 席 D-C 实测：原 `length===2` 就是写死常数，删 `decayAnchorReadings` 并改 1 即全绿）。
 *   ⇒ 本表由 `forgetting/tests/a15-anchor.test.mjs` 与 `IMPLEMENTED_A15_EXPORTS` 做**逐名集合相等**（与 long-term 的
 *     `skeleton.test.mjs` 对 `IMPLEMENTED_EXPORTS` 的口径一致）；两处各写一份 ⇒ 改一处即红。
 *   ⚠ 本表**必须显式冻结**：它是判据面，不是可被运行期改写的配置。
 *   ⚠ 本表**不把自身**算作 A1-5 判据面的一员（否则三处对照物各自含自身，集合等式无法闭合）：
 *     `A15_EXPORT_FACE` 只是这张表的**名字**，不是被它描述的一条判据面导出。
 */
export const A15_EXPORT_FACE: readonly string[] = Object.freeze([
  'A1_5_ANCHOR_POINTS',
  'decayAnchorReadings',
  'decayKernelTeeth',
] as const)

export { A1_5_ANCHOR_POINTS, decayAnchorReadings, decayKernelTeeth } from './retention.ts'
export type { DecayAnchorPoint, DecayAnchorReading, DecayKernelLike, DecayKernelTeethOptions, DecayKernelToothReading, DecayKernelTeethReading } from './retention.ts'
export { strengthDelta, strengthDeltaRaw, strengthAfterRepeat, strengthAfterRepeats, pavlikParams } from './strength.ts'
export type { PavlikParams } from './strength.ts'
export { pruneCandidates, pruneViewSummary } from './prune.ts'
export type { PruneCandidate, PruneView, PruneViewOptions } from './prune.ts'
export {
  CRITERIA_REGISTRY,
  CRITERIA_IDS,
  criteriaEntry,
  thresholdValue,
  thresholdParam,
  thresholdStatus,
  uncalibratedIds,
  registryMatchesParams,
  calibrationConsistency,
  PRUNE_SCORE_THRESHOLD_V10,
} from './criteria.ts'
export type { CriteriaEntry, CriteriaProbe } from './criteria.ts'
