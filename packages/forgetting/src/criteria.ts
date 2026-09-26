/**
 * **包内判据/阈值注册表**（B4.2 ④ 的落点）。
 *
 * 形态参考 `packages/metacognition/skill/engine/criteria.json` 的 `thresholds.entries`
 * （**只读其形态，不写别包**）：每条登记 `id / probe / value / owner / preregistered /
 * preregisteredCriterion / samples / conclusion / recheck / calibrator / rollback`。
 *
 * 判据原文（`docs/mana-rollout-plan.md:547` ④，逐字）：
 *   「阈值 v10 自述 **0.7** 本机无基线 ⇒ 按 §6.0 **不入阈值列、首测后自设**，
 *     落地时进**判据注册表**（随生成器与注册表一起搬，见 B5.1），**不新增机检 ID**」
 *
 * ── 本文件解决的**真问题**（不是形式主义）────────────────────────────────────
 *   ① **散落的阈值不可审**：四区间边界、留存上限、修剪阈值原本会各自躺在 `if` 里与默认参数里，
 *      「改了哪一处」没有单一事实源；
 *   ② **未校准与已校准同形**：`samples=0` 的阈值若只回一个布尔「有没有超」，就与「没设阈值」同形。
 *      故这里除值之外**一并登记 `samples` 与 `preregistered`**，并由 `thresholdStatus()` 暴露。
 *   ③ **值必须真被读**（`thresholds.readPortNote` 那条教训：登记 ≠ 被消费）：
 *      消费点一律走 `thresholdValue()`，判据 ④ 机检「注册表值被改动 ⇒ 消费点读数跟着变」。
 *
 * ⚠ 本包**不新增机检 ID**（落地册 547 ④ 明文）：本文件是**包内**注册表，
 *   `tools/a1-check.mjs` 的 EXPECTED_IDS 不受影响。
 */
import {
  A_RETIRE_MARGIN,
  A_STRONG_MARGIN,
  ACTIVITY_COLD_MIN_AGE_DAYS,
  ACTIVITY_RECENT_MAX_AGE_DAYS,
  ARCHIVE_RETENTION_CALIBRATED,
  ARCHIVE_RETENTION_DEFAULT_DAYS,
  PAVLIK_A,
  PAVLIK_B,
  S_MAX,
  TAU_FALLBACK,
} from './params.ts'

/** 登记项的探针形态（与 metacognition 注册表同构）。 */
export type CriteriaProbe =
  | { readonly registryPath: readonly (string | number)[] }
  | { readonly file: string; readonly contains: string }

export interface CriteriaEntry {
  readonly id: string
  readonly probe: CriteriaProbe
  readonly value: unknown
  readonly owner: string
  readonly preregistered: boolean
  readonly preregisteredCriterion: string | null
  readonly samples: number
  readonly conclusion: string
  readonly recheck: string
  readonly calibrator: string | null
  readonly rollback: string
  /** 可选：运行时读口（`thresholdValue(id)` 的调用点）。 */
  readonly read?: string
}

/**
 * v10 §16.5 小胶质细胞修剪自述的评分阈值。
 *
 * ⚠ **0.7 不是本包的判据** —— 它是 v10 的自述值，本机**无基线**。故：
 *   · 缺省**不启用**评分档（缺省视图 = 确定性激活缺口语义，见 `prune.ts`）；
 *   · 只有调用方**显式**传入 `scoreThreshold` 时才用，且读数一律标注 `calibrated:false`。
 */
export const PRUNE_SCORE_THRESHOLD_V10 = 0.7

/** 递归冻结（注册表必须**不可被运行期静默改写** —— 判据 ④ 有「写入必须抛」的腿）。 */
function deepFreezeDeep<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as Record<string, unknown>)) deepFreezeDeep((v as Record<string, unknown>)[k])
    Object.freeze(v)
  }
  return v
}

const entries: readonly CriteriaEntry[] = deepFreezeDeep([
  {
    id: 'forgetting.archive.strongMargin',
    probe: { registryPath: ['forgetting', 'archive', 'strongMargin'] },
    value: A_STRONG_MARGIN,
    owner: 'packages/forgetting/src/params.ts#A_STRONG_MARGIN',
    preregistered: true,
    preregisteredCriterion: '逐字取 docs/mana-v5-plan.md:572 的 A > τ + 1.0（案原文，非本席自选）',
    samples: 1,
    conclusion: '案原文固定值 1.0；A3-4/B4.2 判据表照抄同值 ⇒ 无需校准，改动即与判据表冲突',
    recheck: '案 §8.2 表格原文变更时',
    calibrator: null,
    rollback: '改 params.ts 即改判据面（不允许 —— 与 v5 §8.2 原文冲突）',
    read: 'src/archive.ts#classify（tau + A_STRONG_MARGIN）',
  },
  {
    id: 'forgetting.archive.retireMargin',
    probe: { registryPath: ['forgetting', 'archive', 'retireMargin'] },
    value: A_RETIRE_MARGIN,
    owner: 'packages/forgetting/src/params.ts#A_RETIRE_MARGIN',
    preregistered: true,
    preregisteredCriterion: '逐字取 docs/mana-v5-plan.md:575 的 A ≤ τ − 0.5（归档行）',
    samples: 1,
    conclusion: '案原文固定值 0.5；判据表 B4.2 ② 照抄同值',
    recheck: '案 §8.2 表格原文变更时',
    calibrator: null,
    rollback: '改 params.ts 即改判据面（不允许 —— 与 v5 §8.2 原文冲突）',
    read: 'src/archive.ts#classify（tau - A_RETIRE_MARGIN）',
  },
  {
    id: 'forgetting.archive.retentionDays',
    probe: { registryPath: ['forgetting', 'archive', 'retentionDays'] },
    value: ARCHIVE_RETENTION_DEFAULT_DAYS,
    owner: 'packages/forgetting/src/params.ts#ARCHIVE_RETENTION_DEFAULT_DAYS',
    preregistered: true,
    preregisteredCriterion:
      '窗口 = S_max 天（本包唯一带判据锚点的强度上界，A3-4 夹具 Smax=30）—— 借用既有上界常数，不新造魔数',
    samples: 0,
    conclusion:
      '**insufficient-data（未校准）** —— 缺省档位 30 天，来源是 S_max 而非实测分布；' +
      '实测 /home/lk/.dsh/memory/mana.db（2026-09-25 12:2x）memory_items 行数 = 0 ⇒ 无可测密度。' +
      '按落地册:520「阈值未定前本判据不生效，且不得以『未超标』放过」⇒ capStatus() 未校准时必须回 uncalibrated',
    recheck: '真实归档行数 ≥ 1 且库龄 ≥ 90 天 ⇒ 用「归档密度 + 命中率」重取（预注册判据见 preregisteredCriterion）',
    calibrator: null,
    rollback: 'ARCHIVE_RETENTION_CALIBRATED 保持 false ⇒ 判据回 uncalibrated；或无上限（更响）',
    read: 'src/archive.ts#capStatus（capDays 参数，缺省由调用方传入本值）',
  },
  {
    id: 'forgetting.prune.scoreThreshold',
    probe: { registryPath: ['forgetting', 'prune', 'scoreThreshold'] },
    value: PRUNE_SCORE_THRESHOLD_V10,
    owner: 'packages/forgetting/src/criteria.ts#PRUNE_SCORE_THRESHOLD_V10',
    preregistered: false,
    preregisteredCriterion: null,
    samples: 0,
    conclusion:
      '**insufficient-data（无本机基线）** —— v10:708/2307 自述 0.7，本机无任何评分分布可校准。' +
      '故**缺省不启用**该档：缺省修剪视图走确定性激活缺口（A ≤ τ−0.5），' +
      '只有调用方显式传 scoreThreshold 时才生效，且读数标注 calibrated:false',
    recheck: '产生修剪评分分布（≥30 条）后按「候选命中率」预注册判据校准',
    calibrator: null,
    rollback: '不传 scoreThreshold ⇒ 回确定性激活缺口档（逐位等价于改造前不存在该视图）',
    read: 'src/prune.ts#pruneCandidates（仅 scoreThreshold 显式传入时读取）',
  },
  {
    id: 'forgetting.activity.recentMaxAgeDays',
    probe: { registryPath: ['forgetting', 'activity', 'recentMaxAgeDays'] },
    value: ACTIVITY_RECENT_MAX_AGE_DAYS,
    owner: 'packages/forgetting/src/params.ts#ACTIVITY_RECENT_MAX_AGE_DAYS',
    preregistered: false,
    preregisteredCriterion: null,
    samples: 0,
    conclusion:
      '**insufficient-data（v10 无值）** —— v10 §16.3 只有「近期/中期/长期」三个序数词，**不给数**；' +
      '本机 `memory_items` 行数 = 0 ⇒ 无召回间隔分布可校准。' +
      '取值 = S_MAX/2 = 15 天（从本包唯一带判据锚点的强度上界派生，不新造孤立魔数）。' +
      '⚠ 这是**策略值不是校准结论**：thresholdStatus() 必须回 calibrated:false；' +
      '按落地册:520，校准前不得据「没超线」判通过',
    recheck: '产生真实召回间隔分布（≥30 条带 last_accessed_at 的行）后按「分级命中率」预注册判据校准',
    calibrator: null,
    rollback: '改回 S_MAX/2（即 15）—— 或整档不启用（分级读数恒带 calibrated:false，调用方可拒用）',
    read: 'src/activity.ts#activityOf / #classifyActivity（边界经 thresholdValue() 读入，不内联字面量）',
  },
  {
    id: 'forgetting.activity.coldMinAgeDays',
    probe: { registryPath: ['forgetting', 'activity', 'coldMinAgeDays'] },
    value: ACTIVITY_COLD_MIN_AGE_DAYS,
    owner: 'packages/forgetting/src/params.ts#ACTIVITY_COLD_MIN_AGE_DAYS',
    preregistered: false,
    preregisteredCriterion: null,
    samples: 0,
    conclusion:
      '**insufficient-data（v10 无值）** —— 同上一项。取值 = S_MAX = 30 天；' +
      '派生依据可复算：age 达该值时 retention(S_MAX; S=S_MAX) = exp(-1) = 0.367879，' +
      '**恰等于本包 A3-4 判据锚点** retention(7;S=7)=0.367879 ⇒ 「留存掉到锚点线」即冷。' +
      '⚠ 边界为**左开**：age > 30 才是冷，age == 30 仍属温（由 tests/activity.test.mjs ③ 断言）',
    recheck: '同上一项（真实召回间隔分布到手后一并校准）',
    calibrator: null,
    rollback: '改回 S_MAX（即 30）—— 或整档不启用',
    read: 'src/activity.ts#activityOf / #classifyActivity',
  },
  {
    id: 'forgetting.tauFallback',
    probe: { registryPath: ['forgetting', 'tauFallback'] },
    value: TAU_FALLBACK,
    owner: 'packages/forgetting/src/params.ts#TAU_FALLBACK',
    preregistered: true,
    preregisteredCriterion: '与 long-term 真源 packages/long-term/src/params.ts#TAU 逐位同值（-2.0）',
    samples: 1,
    conclusion:
      '仅在 mana-long-term 未装配时使用（可选依赖降级）。同源腿由 tests/forgetting.test.mjs ⑦ 机检：' +
      '用 long-term 真源复算本值，不等即红',
    recheck: 'long-term 的 TAU 变更时（本值必须同步）',
    calibrator: null,
    rollback: '删除本缺省并改 inject 硬依赖 long-term —— 与落地册 §2.1「依赖方向要正」冲突，不采纳',
    read: 'src/index.ts#apply（ctx.get(mana-long-term) 缺失时的 resolveTau()）',
  },
  {
    id: 'forgetting.strength.a',
    probe: { registryPath: ['forgetting', 'strength', 'a'] },
    value: PAVLIK_A,
    owner: 'packages/forgetting/src/params.ts#PAVLIK_A',
    preregistered: true,
    preregisteredCriterion: 'A3-4 夹具明文 a=0.5（docs/mana-rollout-plan.md:560）',
    samples: 1,
    conclusion: '夹具值；A3-4 闭式锚点 S(3 次重复)=5.059273 与它绑定（改值即锚点报红）',
    recheck: '判据表夹具变更时',
    calibrator: null,
    rollback: '改回 0.5（判据 ①② 会立刻报红，不允许静默改）',
    read: 'src/strength.ts#strengthDelta（pavlikParams 缺省）',
  },
  {
    id: 'forgetting.strength.b',
    probe: { registryPath: ['forgetting', 'strength', 'b'] },
    value: PAVLIK_B,
    owner: 'packages/forgetting/src/params.ts#PAVLIK_B',
    preregistered: true,
    preregisteredCriterion: 'A3-4 夹具明文 b=0.3（docs/mana-rollout-plan.md:560）',
    samples: 1,
    conclusion: '夹具值；与锚点 5.059273 绑定',
    recheck: '判据表夹具变更时',
    calibrator: null,
    rollback: '改回 0.3（判据 ①② 会立刻报红）',
    read: 'src/strength.ts#strengthDelta（pavlikParams 缺省）',
  },
  {
    id: 'forgetting.strength.sMax',
    probe: { registryPath: ['forgetting', 'strength', 'sMax'] },
    value: S_MAX,
    owner: 'packages/forgetting/src/params.ts#S_MAX',
    preregistered: true,
    preregisteredCriterion: 'A3-4 夹具明文 Smax=30（docs/mana-rollout-plan.md:560）',
    samples: 1,
    conclusion: '夹具值；同时也是归档留存上限缺省档位的来源（见 forgetting.archive.retentionDays）',
    recheck: '判据表夹具变更时（注意它会同时移动留存上限缺省）',
    calibrator: null,
    rollback: '改回 30',
    read: 'src/strength.ts#pavlikParams（缺省）+ src/params.ts#ARCHIVE_RETENTION_DEFAULT_DAYS',
  },
])

/** 冻结的注册表快照（供判据/面板读，**只读**）。 */
export const CRITERIA_REGISTRY = Object.freeze({
  version: 'v0.1.0',
  kind: 'criteria-registry' as const,
  /** ⚠ 本仓口径：注册不是豁免，是让断链可见（未校准即回 insufficient-data）。 */
  note:
    'mana-forgetting 包内阈值注册表（B4.2）。形态参考 metacognition/skill/engine/criteria.json 的 thresholds.entries；' +
    '本表不新增机检 ID。取值域：影响「接受/拒绝/归档归属」判断的数值阈值一律登记；' +
    '四区间边界与 A3-4 夹具参数按 preregistered 登记（真源是判据表原文），' +
    '修剪评分阈值按 samples=0 登记（无本机基线，缺省不启用）。',
  readPort: 'src/criteria.ts#thresholdValue / #thresholdParam',
  entries,
})

/** 按 id 取登记项；未登记**抛错**（不得回 undefined —— 那会让「拼错 id」与「没这条」同形）。 */
export function criteriaEntry(id: string): CriteriaEntry {
  const e = entries.find((x) => x.id === id)
  if (!e) {
    throw new Error(
      'criteriaEntry: 未登记的阈值 id=' + id + '（已知: ' + entries.map((x) => x.id).join(', ') + '）',
    )
  }
  return e
}

/** **登记阈值的唯一运行时读口**（与 metacognition 的 thresholdValue 同形）。 */
export function thresholdValue<T = number>(id: string): T {
  return criteriaEntry(id).value as T
}

/** 读「对象型」登记项里的单个参数（如 pruning 双阈值）。 */
export function thresholdParam<T = number>(id: string, key: string): T {
  const v = criteriaEntry(id).value
  if (v === null || typeof v !== 'object' || !(key in (v as Record<string, unknown>))) {
    throw new Error('thresholdParam: 登记项 ' + id + ' 不是对象或没有键 ' + key)
  }
  return (v as Record<string, unknown>)[key] as T
}

/** 登记项的三态读数：值 + 是否预注册 + 样本数。**未校准不得被读成通过**。 */
export function thresholdStatus(id: string): { value: unknown; preregistered: boolean; samples: number; calibrated: boolean } {
  const e = criteriaEntry(id)
  return { value: e.value, preregistered: e.preregistered, samples: e.samples, calibrated: e.samples > 0 && e.preregistered }
}

/** 登记项 id 全表（供判据遍历：**新增阈值必须先在这里出现**）。 */
export const CRITERIA_IDS: readonly string[] = Object.freeze(entries.map((e) => e.id))

/** 未校准项清单（`calibrated === false`）—— 监控面只报「它在爆」的那类盲区的**显式登记**。 */
export function uncalibratedIds(): readonly string[] {
  return entries.filter((e) => !(e.samples > 0 && e.preregistered)).map((e) => e.id)
}

/**
 * 「自称已校准」与「登记样本数」的一致性腿。
 *
 * ⚠ 为什么需要它：`ARCHIVE_RETENTION_CALIBRATED` 是一个**声明常量**，改一个 `false→true`
 *   就能把 `capStatus` 从 `uncalibrated` 变成 `ok` —— 若没有这条腿，「声称已校准」与
 *   「真的校准过」就**同形**（本仓最防的形态）。此函数把声明钉在**样本数**上：
 *   声明 true 而注册表 `samples = 0` ⇒ 不一致。
 */
export function calibrationConsistency(): { ok: boolean; reason: string } {
  const e = criteriaEntry('forgetting.archive.retentionDays')
  if (ARCHIVE_RETENTION_CALIBRATED && !(e.samples > 0)) {
    return {
      ok: false,
      reason: `ARCHIVE_RETENTION_CALIBRATED=true 但注册表 samples=${e.samples} ⇒ 「声称已校准」与「真的校准过」同形，禁止`,
    }
  }
  return { ok: true, reason: `calibrated=${ARCHIVE_RETENTION_CALIBRATED} / samples=${e.samples}（一致）` }
}

/** 与 params.ts 的一致性自检：注册表里的值必须**就是** params 的当前值（防两处漂移）。 */
export function registryMatchesParams(): { ok: boolean; mismatches: string[] } {
  const pairs: readonly (readonly [string, unknown, unknown])[] = [
    ['forgetting.archive.strongMargin', A_STRONG_MARGIN, (criteriaEntry('forgetting.archive.strongMargin').value)],
    ['forgetting.archive.retireMargin', A_RETIRE_MARGIN, (criteriaEntry('forgetting.archive.retireMargin').value)],
    ['forgetting.archive.retentionDays', ARCHIVE_RETENTION_DEFAULT_DAYS, (criteriaEntry('forgetting.archive.retentionDays').value)],
    ['forgetting.tauFallback', TAU_FALLBACK, (criteriaEntry('forgetting.tauFallback').value)],
    ['forgetting.activity.recentMaxAgeDays', ACTIVITY_RECENT_MAX_AGE_DAYS, (criteriaEntry('forgetting.activity.recentMaxAgeDays').value)],
    ['forgetting.activity.coldMinAgeDays', ACTIVITY_COLD_MIN_AGE_DAYS, (criteriaEntry('forgetting.activity.coldMinAgeDays').value)],
  ]
  void ARCHIVE_RETENTION_CALIBRATED
  const mismatches = pairs.filter(([, a, b]) => !Object.is(a, b)).map(([id]) => id)
  return { ok: mismatches.length === 0, mismatches }
}
