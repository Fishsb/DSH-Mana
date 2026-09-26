/**
 * **Recall Gate 接线钩子**（W1-4）—— 把 `dsh-mana-long-term` 的 `recallGate` 接进**检索路径**。
 *
 * ── 为什么本文件存在（开工实测的事实）────────────────────────────────────────────
 * 接线前：`packages/long-term/src/recall-gate.ts:409` 的 `recallGate` 在**全仓 `packages/<pkg>/src` 里
 * 生产调用方 = 0**（`grep -rn 'recallGate' --include='*.ts' packages/<pkg>/src` 只命中它自己的定义与
 * `long-term/src/index.ts` 的服务面转发；其余命中全在**根目录探针** `.verify-r*.mjs` 与测试里）。
 * ⇒ A1-8 的「Recall → `degraded=1` 且返回有序 items」这一支路在**生产路径上无生产者**，
 *   四态因此记 **NONE**（有实现、零调用方）。本文件 + `index.ts` 的 recall 出口把这条支路接上。
 *
 * ── 为什么走「运行时按包名解析」而不是 `import`（三条路，取唯一同时满足的）──────────
 * 这是**已证先例**（`packages/consolidation/src/vector-cosine.ts` 文件头逐条实测过同款取舍），
 * 本包按同一形状复述自己的实测结论：
 *   · **V1/V2** `import { recallGate } from 'dsh-mana-long-term'` —— 本包 `package.json` 里
 *     **没有**这条依赖 ⇒ 依赖边凭空多一条（方案 §9.1 的依赖方向）；
 *   · **V3** 相对路径 `../../long-term/lib/index.js` —— `tsc` 找不到声明文件/报 TS2307 类错，
 *     且产物里会留下对 **src** 的相对引用 ⇒ 运行时 `MODULE_NOT_FOUND`；
 *   · **V4 本文件**：运行时解析 ⇒ `tsc` **不解析该路径**（这正是这条路走得通的前提），
 *     运行时解析到 long-term 的**真产物**（实测 `import.meta.resolve('dsh-mana-long-term')`
 *     → `<root>/packages/long-term/lib/index.js`）。
 *
 * ⚠ **V4 的代价必须写出来，不许只写好处**：按包名解析**绕开编译期** ⇒
 *   「包没装」「`lib/` 没建」「没导出该函数」三种失败**都不会被 typecheck 抓到**。
 *   本仓已有一条同族教训（`packages/attention/lib/`、`packages/consolidation/lib/` 整个目录不存在，
 *   见 `packages/vector/tests/pkg-registration.guard.mjs`）⇒ 本模块的处置**不是**加个注释了事：
 *   `runRecallGate` **每一次调用都回报解析结果**（`resolution.ok` / `source` / `reason`），
 *   解析失败**显式落进 audit 载荷**（`unwiredReason`），**不静默回落**。
 *
 * ── 边界自证（本模块**不**做什么）────────────────────────────────────────────────
 * · **不注册任何监听器/定时器/pre-step**（G9 风险面：`agent/pre-step` 已有四处占用；
 *   本批明确**不新开注册点**）—— 本模块只有函数导出；
 * · **不写库、不 emit**：落库与广播仍由 `index.ts` 的 recall 出口做（单点）；
 * · **不改 `ManaRecall` 契约**（`packages/core/src/event-types.ts` 是本席只读面）：
 *   门控读数以**契约外增量字段**挂在该事件的载荷上（见 `index.ts` 的 `mana/recall` 段落）。
 *
 * ── 失败语义（**fail-open + 显式留痕**，与 `docs/contract/degradation.md` 同口径）────────
 * 门控**不可用**（包没装 / lib 没建 / 没导出 / 调用抛错）时：
 * · 检索**照常返回**（召回不能被判定链拖死 —— 那是"让整个检索不可用"，比降级更坏）；
 * · 但它**不是静默的**：`gate === null` + `unwiredReason` 非空 + `rankBy` 回落 `'local_score'`
 *   —— 与「判了且过阈」(`rankBy='jev_prob'`)、「判了未过阈」(`rankBy='local_score'` + `gate='below_threshold'`)
 *   **三者互不冒充**。
 * ⚠ 唯一的例外是**显式关闭**（`enabled=false`）：那不是故障，是配置 ⇒ `unwiredReason` 里
 *   写的是「已显式关闭」，与"解析失败"用**不同措辞**（可分辨）。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** 被解析的包（**唯一**真源：换包只改这一处）。 */
export const RECALL_GATE_PACKAGE = 'dsh-mana-long-term'
/** 被解析的导出名。 */
export const RECALL_GATE_EXPORT = 'recallGate'
/** 判定键派生函数的导出名（对账用：id 前缀自证）。 */
export const RECALL_GATE_ID_EXPORT = 'judgeIdFor'

/** 门控**请求**的形状（复述 long-term 的 `RecallGateRequest`；运行时解析故本地声明）。 */
export interface RecallGateRequestLike {
  readonly requestId: string
  readonly query: string
  readonly candidates: readonly { readonly key: string; readonly localScore: number }[]
  readonly topK?: number
  readonly sessionId?: string
  readonly turnId?: number
}

/** 门控**配置**的形状（复述 long-term 的 `RecallGateConfig`）。 */
export interface RecallGateConfigLike {
  readonly threshold: number
  readonly topN: number
  readonly judgeEnabled: boolean
}

/**
 * 门控**结果**的形状（复述 long-term 的 `RecallGateOutcome` 的**完整字段面**）。
 *
 * ⚠ 逐字段复述而不是 `unknown`/`any`：本模块要把这个对象**放进 audit 载荷**，
 *   字段面漂了必须**编译期就红**（在 long-term 侧改字段面 ⇒ 这里会报缺字段），
 *   而不是等到有人读载荷时才发现读不到。
 */
export interface RecallGateOutcomeLike {
  readonly requestId: string
  readonly gate: string
  readonly channel: string
  readonly rankBy: string
  readonly degraded: boolean
  readonly reason: string | null
  readonly probed: number
  readonly judged: number
  readonly judgeIds: readonly string[]
  readonly probedKeys: readonly string[]
  readonly duplicateKeys: readonly string[]
  readonly failureKind: string | null
  readonly untracedKeys: readonly string[]
  readonly traceUnknownKeys: readonly string[]
  readonly threwKeys: readonly string[]
  readonly items: readonly { readonly key: string; readonly localScore: number; readonly jevProb: number | null }[]
}

type RecallGateFn = (
  ctx: unknown,
  req: RecallGateRequestLike,
  overrides?: Partial<RecallGateConfigLike>,
) => Promise<RecallGateOutcomeLike>

/** 解析结果：**三态**（不是「有/没有」）——`ok=false` 时 `reason` 必非空（G8）。 */
export type RecallGateResolution =
  | { readonly ok: true; readonly fn: RecallGateFn; readonly source: string; readonly specifier: string; readonly reason: null }
  | { readonly ok: false; readonly fn: null; readonly source: string | null; readonly specifier: string; readonly reason: string }

/**
 * 挂进 `mana/recall` 载荷的**门控读数**（**契约外增量字段**：`ManaRecall` 本身不改）。
 *
 * ⚠ 两个 `null` 的语义**不同**，不得互推：
 * · `gate === null` ⇒ 门控**没有给出结果**（没接线 / 解析失败 / 抛错 / 显式关闭）——
 *   到底哪一类看 `unwiredReason`；
 * · `gate === 'degraded'` ⇒ 门控**真跑了**并判不了（fail-degraded），`failureKind` 说清是哪一类。
 * ⚠ `applied` 在**本批恒为 `false`**（门控不改变管道结果，见 index.ts 的 recall 段取舍②）：
 *   把它写成字段而不是留一句注释，是为了让"有没有真折叠进排序"**可被断言**（不是靠读代码）。
 */
export interface RecallGateReadout {
  /** 调用方（配置面）是否**要求**调用门控。 */
  readonly enabled: boolean
  /** 门控是否**改变**了召回结果。本批恒 `false`（只带读数、不改管道）。 */
  readonly applied: boolean
  /** 是否真的调用了门控函数（false ⇒ 看 `unwiredReason`）。 */
  readonly attempted: boolean
  /** 包名解析是否成功（false 且 `enabled=true` ⇒ 接线断了，不是被关掉）。 */
  readonly resolved: boolean
  /** 本次使用的解析入口（失败时用来定位是哪条路断了）。 */
  readonly specifier: string
  readonly gate: string | null
  readonly channel: string | null
  readonly rankBy: string | null
  readonly degraded: boolean | null
  readonly reason: string | null
  readonly failureKind: string | null
  readonly probed: number
  readonly judged: number
  readonly judgeIds: readonly string[]
  readonly probedKeys: readonly string[]
  readonly duplicateKeys: readonly string[]
  readonly untracedKeys: readonly string[]
  readonly traceUnknownKeys: readonly string[]
  readonly threwKeys: readonly string[]
  /** 门控结果自带的 `requestId`（=`judgeIds` 的前缀；对账用）。 */
  readonly outcomeRequestId: string | null
  /** 解析到的**真产物**路径（"接线接的是哪一份代码"的证据）。 */
  readonly resolutionSource: string | null
  /** 未调用/调用失败的原因（可读）。 */
  readonly unwiredReason: string | null
}

/**
 * 把一次接线调用折叠成载荷读数（**唯一**转换点，避免各处手写漏字段）。
 *
 * ⚠ 本读数同时是**服务面 `lastRecallGate()` 的返回形状**（不加信封的调用也走它）
 *   ⇒ 「审计载荷里看到的」与「服务面查到的」是**同一个形状**，不会两处各长一样。
 */
export function recallGateReadout(record: RecallGateCallRecord): RecallGateReadout {
  const o = record.outcome
  return {
    enabled: record.enabled,
    applied: false,
    attempted: record.attempted,
    resolved: record.resolved,
    specifier: record.specifier,
    gate: o?.gate ?? null,
    channel: o?.channel ?? null,
    rankBy: o?.rankBy ?? null,
    degraded: o?.degraded ?? null,
    reason: o?.reason ?? null,
    failureKind: o?.failureKind ?? null,
    probed: o?.probed ?? 0,
    judged: o?.judged ?? 0,
    judgeIds: o?.judgeIds ?? [],
    probedKeys: o?.probedKeys ?? [],
    duplicateKeys: o?.duplicateKeys ?? [],
    untracedKeys: o?.untracedKeys ?? [],
    traceUnknownKeys: o?.traceUnknownKeys ?? [],
    threwKeys: o?.threwKeys ?? [],
    outcomeRequestId: o?.requestId ?? null,
    resolutionSource: record.source,
    unwiredReason: record.unwiredReason,
  }
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * 按包名解析 long-term 的 `recallGate`。
 *
 * ⚠ **不缓存**（每次调用重解析）：Node 的 `require` 缓存让重复解析近乎免费，
 *   而缓存会让「后装的包/后建的 lib」在进程内**永远看不到**（一条静默的陈旧面）。
 *   本模块宁可每次多一次 require 缓存查找，也不留这个静默面。
 */
export function resolveRecallGate(specifier: string = RECALL_GATE_PACKAGE): RecallGateResolution {
  let entryUrl: string
  try {
    entryUrl = import.meta.resolve(specifier)
  } catch (error) {
    return { ok: false, fn: null, source: null, specifier, reason: `包名解析失败（${specifier}）：${msgOf(error)}` }
  }
  let source: string
  try {
    source = fileURLToPath(entryUrl)
  } catch (error) {
    return { ok: false, fn: null, source: null, specifier, reason: `入口不是文件 URL（${entryUrl}）：${msgOf(error)}` }
  }
  try {
    const mod = createRequire(import.meta.url)(source) as Record<string, unknown>
    const fn = mod[RECALL_GATE_EXPORT]
    if (typeof fn !== 'function') {
      return {
        ok: false,
        fn: null,
        source,
        specifier,
        reason: `${source} 未导出函数 ${RECALL_GATE_EXPORT}（实际 ${typeof fn}）`,
      }
    }
    return { ok: true, fn: fn as RecallGateFn, source, specifier, reason: null }
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'ERR'
    return { ok: false, fn: null, source, specifier, reason: `加载 ${source} 失败（${code}）：${msgOf(error)}` }
  }
}

/**
 * **配置面**（`Config.recallGate` 的四个旋钮）。
 * ⚠ `specifier` **刻意不在配置面**：它一旦可配，就成了"能把接线指歪"的旋钮
 *   （指到任意模块 ⇒ 门控静默失效或指到别的东西），而解析失败只在运行期可见。
 *   判据要造失败路径时直接调 `runRecallGate` 并传参，不经配置。
 */
export interface RecallGateKnobs {
  /** 总开关。`false` ⇒ **完全不调用**门控（显式关闭，不是故障）。 */
  readonly enabled: boolean
  /** 过阈值（送 long-term 的 `RecallGateConfig.threshold`）。 */
  readonly threshold: number
  /** 送判定的候选上限。 */
  readonly topN: number
  /**
   * 传给门控的 `judgeEnabled`：`false` ⇒ 门控**被调用但显式不发起判定**
   * （long-term 侧归因为 `not-attempted`）。
   * ⚠ 与上面的 `enabled` **不是同一件事**，不得合并成一个旋钮：
   *   `enabled=false` ⇒ 门外**没有**调用（`gate=null`）；`judgeEnabled=false` ⇒ 门**真跑了**并给出
   *   `gate='degraded'`/`failureKind='not-attempted'`。合并会让「没接线」与「接线了但没判」同形。
   */
  readonly judgeEnabled: boolean
}

/** 接线配置（运行时形状 = 配置面 + 包名覆盖）。 */
export interface RecallGateWiringConfig extends RecallGateKnobs {
  /** 包名覆盖（**判据用它造失败路径**；生产不配 —— 见 `RecallGateKnobs` 的说明）。 */
  readonly specifier: string
}

export const DEFAULT_RECALL_GATE_WIRING: RecallGateWiringConfig = Object.freeze({
  enabled: true,
  threshold: 0.7,
  topN: 10,
  judgeEnabled: true,
  specifier: RECALL_GATE_PACKAGE,
})

/** 一次门控调用的**审计记录**（挂进 `mana/recall` 载荷的那一份）。 */
export interface RecallGateCallRecord {
  /** 调用方是否要求调用（`enabled`）。 */
  readonly enabled: boolean
  /** **是否真的调用了**门控函数（解析成功且未抛错 ⇒ `true`）。 */
  readonly attempted: boolean
  /** 解析是否成功。 */
  readonly resolved: boolean
  /** 解析到的**真产物**路径（`ok=true` 时非空）。 */
  readonly source: string | null
  /** 本次用的 specifier（解析失败时用来定位是哪条路断了）。 */
  readonly specifier: string
  /** 未被调用/调用失败的原因（可读，**非空 ⇔ `outcome === null`**）。 */
  readonly unwiredReason: string | null
  /** 门控结果（未调用时为 `null` —— 不得用别的值冒充）。 */
  readonly outcome: RecallGateOutcomeLike | null
  /** 调用**抛错**时的原始信息（抛错时非空；此时 `outcome === null`）。 */
  readonly error: string | null
}

/**
 * 走一次接线的 Recall Gate。**本函数永不抛错**（抛错折叠成显式记录）。
 *
 * ⚠ 「永不抛错」是**刻意的**而不是偷懒：调用点是 recall 的返回路径，门控是**附加判定**，
 *   它坏掉不该让整次召回失败（fail-open）。但它**必须留下可查的失败记录** —— 那正是本函数
 *   返回 `unwiredReason` / `error` 而非 `null` 的原因（`catch { return null }` 是本仓明令禁止的形态）。
 */
export async function runRecallGate(
  ctx: unknown,
  req: RecallGateRequestLike,
  cfg: RecallGateWiringConfig = DEFAULT_RECALL_GATE_WIRING,
): Promise<RecallGateCallRecord> {
  const base = { enabled: cfg.enabled, specifier: cfg.specifier } as const
  if (!cfg.enabled) {
    return {
      ...base,
      attempted: false,
      resolved: false,
      source: null,
      unwiredReason: '召回门控已**显式关闭**（Config.recallGate.enabled=false）：本次未调用判定链',
      outcome: null,
      error: null,
    }
  }
  const res = resolveRecallGate(cfg.specifier)
  if (!res.ok) {
    return {
      ...base,
      attempted: false,
      resolved: false,
      source: res.source,
      unwiredReason: `门控**未被调用**：${res.reason}`,
      outcome: null,
      error: null,
    }
  }
  try {
    const outcome = await res.fn(ctx, req, {
      threshold: cfg.threshold,
      topN: cfg.topN,
      judgeEnabled: cfg.judgeEnabled,
    })
    return { ...base, attempted: true, resolved: true, source: res.source, unwiredReason: null, outcome, error: null }
  } catch (error) {
    return {
      ...base,
      attempted: true,
      resolved: true,
      source: res.source,
      unwiredReason: `门控**已调用但抛错**：${msgOf(error)}`,
      outcome: null,
      error: msgOf(error),
    }
  }
}
