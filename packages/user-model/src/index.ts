/**
 * `dsh-mana-user-model` —— 末那识·我执（偏好 / 习惯 / 项目）**B5.2 已填实现**。
 *
 * ── 当前状态：B5.2（本条与下面的历史记录并列，不覆盖）──────────────────────────
 * 本包曾长期是 92 行"诚实的空壳"（P2 · B5.1）。B5.2 落了**精度判定核 + 读写面**，
 * 故 `status().behavior` 由 `'skeleton'` 改为 **`'active'`**（据实现事实回报）。
 * 尚未实现（仍属后续批次，**不得**读作已完成）：A4-2 的**真**阈值（需首测后自设）、
 *   A4-1 的置信度校准（需带标签集 + Brier/可靠性曲线）、偏好从会话中**自动抽取**
 *   （本包只提供"给定值→写库"的面，抽取器不存在）。
 *
 * ── 核心判断：本包是**消费者**还是**自有写入路径**（B5.2 的核心问题）────────────
 *
 * **结论：读写面在本包，写库语义在 core。本包是 core 写入口的消费者，不另建写入路径。**
 *
 * 依据（逐条可核）：
 *  ① `user_model` 主表 + `user_model_history` 追加表都建在 `packages/core/src/schema.ts:89/107`，
 *     写入口是 core 服务面的 `updateUserModel`（`packages/core/src/index.ts:447`）——
 *     它把「主表 UPDATE」与「历史 INSERT」绑在**同一事务**内（`:453-501`）。
 *  ② 若本包自己写这两张表，就出现**第二个写入者**：core 那条与核心写入口并列的路径
 *     要么变死代码、要么两个写入者语义漂移（一个有事务、一个没有）。
 *     那正是「拆东墙补西墙」——为了让本包"有行为"而把 core 的既有写入点弄成死代码。
 *  ③ 故本包的"行为"体现在**core 做不到的那部分**：读/写面的**装配**、精度判定核
 *     （三个纯函数）、A4-3 的边界守卫、以及漂移报告的落 trace。
 *   ⇒ 卸载本包后，**漂移报告行不再新增**（`mana_trace` 的新 `eventType`），
 *     这正是 v10 §39.3「去掉用户模型」消融此前判"不可做：卸载无差异"的**反例**。
 *
 * ⚠ **本包不产生任何 `memory_items.content`**（A4-3）：本包**不调用** core 的
 *   `writeMemoryItem`（那正是 `memory_items.content` 的唯一写入口），且写面入口带
 *   `assertContentNeutral` **运行期守卫**（`content` 键即抛）—— 静态不调用只是"没人这么写"，
 *   动态守卫才使"以后有人顺手加一个 content 字段"变成**当场报错**而不是静默写进去。
 *
 * ⚠ 历史记录（P2 骨架期，保留原文）─────────────────────────────────────────────
 *   原文件头登记的契约缺口（`user_model_history` 表不存在、core 零写入者）**均已解除**，
 *   由 S0 席补齐（core schema 的 user_model_history 段 + `updateUserModel` + ADR-6 迁移承接）。
 *   登记式判据 `tests/skeleton.test.mjs` 的两条已按原登记文的指示**语义反转**为正向断言。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import {
  registerPassThroughPreStep,
  type ManaCoreService,
  type UserModelHistoryRow,
} from 'dsh-mana-core'
import {
  assessAccuracy,
  driftCandidates,
  injectionDecision,
  type AccuracyReport,
  type DriftHistoryRow,
  type DriftReport,
  type InjectionVerdict,
  type LabeledSample,
} from './precision.ts'
import { CONFIDENCE_FLOOR } from './params.ts'

export const name = 'mana-user-model'

/** 依赖 core（契约唯一归属地）。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /**
   * 用户模型精度目标（A4-2：「待定，需首测后自设」）。
   * ⚠ 缺省 `null` = **未校准**，判据不生效 —— 不编一个数冒充已拍板（册:568 明令）。
   *
   * ⚠ **本键的缺省不是由 schema 给的**（同批实测，见 `Config` 下方注释）：schemastery 3.18.4
   *   会把 `union.default(null)` 的 null 缺省**静默丢弃**，可写不可靠。
   *   故「未校准」态由 `apply` 对缺席键**显式归一为 `null`**，而不是靠一个从不生效的声明。
   */
  precisionTarget: number | null
  /**
   * 置信度退场阈值（A4-1：「待定，需拍板」）。
   *
   * ⚠ **缺省 = `null` = 无人拍板**，与 `precisionTarget` 同形同因（本仓 schemastery
   *   表达不出 null 缺省 ⇒ 由 `apply` 显式归一）。`null` 时 `injectionDecision()` 返回
   *   `'undeterminable'` 而**不是** `'inject'` —— 见 `precision.ts` 的判因。
   *
   * ⚠ **本键不是假旋钮**：它真被消费 —— `service.injectionVerdict(confidence)` 的结论
   *   随之改变，判据 `tests/precision.test.mjs` 有正负两向腿钉住。
   */
  confidenceFloor: number | null
}

/**
 * ⚠ 为什么这里**故意不写** `.default(null)`（本仓 2026-09-24 实测，非推断）：
 *
 *   `Schema.object({ p: Schema.union([Schema.number(), Schema.const(null)]).default(null) })({})`
 *   → `{}` —— **`p` 键根本不出现**，`p === undefined`。
 *   对照组同一解析器下 `Schema.number().default(0.5)` → `{x:0.5}`、`Schema.boolean().default(true)`
 *   → `{x:true}` ⇒ 不是「缺省机制整体失效」，而是 **null 缺省在这个形状上被丢弃**。
 *   机制（`schemastery/src/index.ts:533-542`）：`isNullable(data)` 为真时先取 `meta.default`，
 *   再 `if (isNullable(fallback)) return [data]` —— **fallback 自己是 null 就直接放弃**。
 *
 *   ⇒ 写一个**从不生效**的 `.default(null)` 与 `criteria.ts` 里点名的「假旋钮」同形：
 *     改它零效果，读代码的人却会以为"这里有缺省"。
 */
export const Config: Schema<Config> = Schema.object({
  precisionTarget: Schema.union([Schema.number(), Schema.const(null)]),
  confidenceFloor: Schema.union([Schema.number(), Schema.const(null)]),
})

/**
 * A4-3（「模型不生成记忆内容」）在**写入口**这一点的运行期守卫。
 *
 * 为什么不能只靠"本包不调用 `writeMemoryItem`"：那是**静态事实**，靠的是"没人这么写"。
 * 一旦后来者顺手在输入里加一个 `content` 字段并把它透传给 core 的写面，
 * 静态不调用**照样成立**，而 `memory_items.content` 已经被写了 —— 判据读到的只是"有行"。
 * ⇒ 把禁止做成**当场抛错**，使违规是一条**错误**而不是一次静默写入。
 *
 * ⚠ 判据 `tests/a4-3-no-content.test.mjs` 有变异腿：把本守卫摘掉后该腿必须报红。
 */
export const A4_3_FORBIDDEN_COLUMNS: readonly string[] = ['content']

/** 递归查找违禁列名（键名**逐字相等**，不做前缀/子串匹配 —— 避免误伤 `contentHash` 这类正常字段）。 */
function findForbiddenKey(value: unknown, forbidden: readonly string[], path: string): string | null {
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = findForbiddenKey(v, forbidden, `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.includes(k)) return `${path}${path ? '.' : ''}${k}`
    const hit = findForbiddenKey(v, forbidden, `${path}${path ? '.' : ''}${k}`)
    if (hit) return hit
  }
  return null
}

/**
 * A4-3 守卫：输入里出现 `memory_items.content` 类字段即抛（**不返回布尔** ——
 * 返回布尔会被调用方顺手忽略，抛错不会）。
 */
export function assertContentNeutral(input: unknown, where = 'user-model'): void {
  const hit = findForbiddenKey(input, A4_3_FORBIDDEN_COLUMNS, '')
  if (hit) {
    throw new Error(
      `${where}: 输入含违禁字段 ['${hit}'] —— A4-3 要求用户模型只写 id/数值字段，` +
        '不得写 memory_items.content（本包写面必须内容中立）。',
    )
  }
}

/** 一次偏好写入的请求（本包写面 = core 写面的**受守卫包装**，不另建路径）。 */
export interface PreferenceWrite {
  key: string
  value: string
  confidence?: number
  sourceEvidenceId?: string | null
  sessionId?: string
  turnId?: number
  at?: string
}

/** 本插件对外服务面。 */
export interface ManaUserModelService {
  readonly plugin: string
  /**
   * `'skeleton'` = 本包**尚无行为**；`'active'` = 已填实现。
   *
   * B5.2 起为 `'active'`：本包已导出可复算的判定核（`precision.ts` 三函数）+
   *   读写面（`updatePreference`/`listPreferences`/`reportDrift`）。
   * ⚠ "active" 的边界是「**真实现存在且可机检 + 卸载后行为面有差异**」，
   *   **不是**「已在生产链路上自动生效」：本包**不注册定时器**、不自动写库，
   *   写面与漂移报告均由调用方显式触发。把本值读成后者是误读。
   */
  status(): {
    plugin: string
    wired: boolean
    behavior: 'skeleton' | 'active'
    precisionTarget: number | null
    confidenceFloor: number | null
  }
  /** 写一次偏好（走 core 的 `updateUserModel`，主表更新与历史追加同事务）。 */
  updatePreference(input: PreferenceWrite): {
    key: string
    previousValue: string | null
    newValue: string
    changed: boolean
    created: boolean
    historyId: number
  }
  /** 读全部偏好（主表当前值 —— 这是"现在生效的是什么"）。 */
  listPreferences(): { key: string; value: string; confidence: number | null; updated_at: string }[]
  /** 读某个 key 的历史行（这是"它被改过几次"）。省略 key = 全部。 */
  listHistory(key?: string, limit?: number): UserModelHistoryRow[]
  /**
   * 漂移探针（册:150）：扫历史 → 30 天内改 ≥3 次的 key = 候选 ⇒ **落一行 mana_trace**。
   *
   * ⚠ 落 trace 是本包**唯一**的行为面写入，也是「卸载即净」可机检的唯一依据：
   *   本包不在，这行 `user_model/drift` 就不再新增（core 不会代它写 —— 漂移逻辑只在 core 之外）。
   */
  reportDrift(now: string, sessionId?: string): DriftReport & { traceSeq: number }
  /** 退场判定（册:151）：置信度跌破阈值 ⇒ `retired_no_injection`；阈值未定 ⇒ `undeterminable`。 */
  injectionVerdict(confidence: number | null): InjectionVerdict
  /** A4-2 首测方法（**阈值必须显式传入**，本包不设目标值 —— 册:598 明令）。 */
  assessAccuracy(samples: readonly LabeledSample[], threshold: number | null): AccuracyReport
  /** 当前生效的阈值读数（供判据与复核方核对"到底拍没拍板"）。 */
  thresholds(): { precisionTarget: number | null; confidenceFloor: number | null }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-user-model': ManaUserModelService
  }
}

/** 把 core 的历史行收敛成本核要的形状（**只做投影，不改语义**）。 */
function toDriftRows(rows: readonly UserModelHistoryRow[]): DriftHistoryRow[] {
  return rows.map((r) => ({
    key: r.key,
    old_value: r.old_value,
    new_value: r.new_value,
    confidence: r.confidence,
    at: r.at,
  }))
}

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-user-model: 缺少 mana-core 服务（inject 未满足）')

  /**
   * 「未校准」态的唯一归一入口（**不是** schema 缺省给的 —— 见 `Config` 上方实测）。
   *
   * 为什么必须显式归一：`Schema` 解析不出 `null` 缺省（缺席键被丢弃），
   * 而本包对外契约（`Config` 注释 + A4-2「未定前不得以未超标放过」）要求
   * 「缺省 = null = 未校准」是**宿主能读到的事实**。
   * 若放任 `undefined` 漏出去，`=== null` 判「未校准」的下游一律判假 ⇒
   * 「没拍板」会被静默读成「已校准且不高」—— 正是本会议首位的「让失败不可观测」。
   */
  const precisionTarget: number | null = config.precisionTarget ?? null
  /**
   * 退场阈值的归一：与 `precisionTarget` 同法，且缺省落在 `params.ts` 的 `CONFIDENCE_FLOOR`
   * （= `null` = A4-1 未拍板）。**不是** `config.confidenceFloor ?? 0` 这类"兜底数字"：
   * 兜一个 0 会让所有偏好都 ≥ 阈值 ⇒ 退场永不触发且系统看起来正常。
   */
  const confidenceFloor: number | null = config.confidenceFloor ?? CONFIDENCE_FLOOR

  const service: ManaUserModelService = {
    plugin: name,
    status: () => ({
      plugin: name,
      wired: true,
      behavior: 'active',
      precisionTarget,
      confidenceFloor,
    }),
    updatePreference(input) {
      // A4-3 守卫在**委托之前**：守卫若在写之后调用，一次违规写入已经落库了。
      assertContentNeutral(input, 'mana-user-model.updatePreference')
      return core.updateUserModel({
        key: input.key,
        value: input.value,
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.sourceEvidenceId === undefined ? {} : { sourceEvidenceId: input.sourceEvidenceId }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        ...(input.at === undefined ? {} : { at: input.at }),
      })
    },
    listPreferences() {
      return core.db
        .prepare('SELECT key, value, confidence, updated_at FROM user_model ORDER BY key ASC')
        .all() as { key: string; value: string; confidence: number | null; updated_at: string }[]
    },
    listHistory(key, limit) {
      return core.listUserModelHistory(key, limit)
    },
    reportDrift(now, sessionId) {
      const report = driftCandidates(toDriftRows(core.listUserModelHistory(undefined, 100000)), now)
      const traceSeq = core.writeTrace({
        // ⚠ 事件类型用**裸名**且带包前缀：本包不是 S1 五类之一，不得冒充它们
        //   （冒充会让「五类各有多少行」的读数被污染）。命名口径见 handoff §5。
        eventType: 'user-model/drift',
        sessionId: sessionId ?? '',
        turnId: 0,
        at: now,
        payload: { since: report.since, windowDays: report.windowDays, minChanges: report.minChanges, candidates: report.candidates, readings: report.readings },
      })
      return { ...report, traceSeq }
    },
    injectionVerdict: (confidence) => injectionDecision(confidence, confidenceFloor),
    assessAccuracy: (samples, threshold) => assessAccuracy(samples, threshold),
    thresholds: () => ({ precisionTarget, confidenceFloor }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-user-model', service)
    return () => dispose()
  }, 'dsh-mana-user-model: service')

  // G9 结构约束：waterfall 监听器必须调 next()。
  registerPassThroughPreStep(ctx, name)
}

export {
  assessAccuracy,
  driftCandidates,
  injectionDecision,
} from './precision.ts'
export {
  ACCURACY_ASSUMED_P,
  ACCURACY_HALF_WIDTH,
  ACCURACY_SAMPLE_FLOOR,
  ACCURACY_Z,
  CONFIDENCE_FLOOR,
  DRIFT_MIN_CHANGES,
  DRIFT_WINDOW_DAYS,
  requiredSampleSize,
} from './params.ts'
export type {
  DriftHistoryRow,
  DriftReading,
  DriftReport,
  InjectionDecision,
  InjectionVerdict,
  LabeledSample,
  AccuracyReport,
} from './precision.ts'
export type { ManaCoreService }
