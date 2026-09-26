/**
 * **突触重归一化 —— 守恒式全局重缩放**（v10 §13.6 的实现者）。
 *
 * ── 裁定原文（`docs/mana-v10-status-plan.md:674-683`，逐字）────────────────────────
 *   `
 *   全局突触强度重缩放
 *     → 降低弱关联权重
 *     → 保留强关联权重
 *     → 提升信噪比
 *   `
 *   ⛔ 原文紧接着的状态行：「**本仓未实现**（`packages/* src` 内 `renormaliz` / `重归一化`
 *      命中 **0**）。无表、无字段、无函数。」⇒ 本文件补的正是这一条。
 *   神经学语义（任务卡）：睡眠中突触整体缩放使**总强度守恒** —— 记忆不因「只增不减」而膨胀，
 *   强记忆相对更突出。
 *
 * ── ⛔ 本文件**不是**哪几样东西（先划清，否则会被读成「又一套曲线」）──────────────
 *   · **不是**衰减核：`retention(t,S) = exp(-t/S)` 与 `long-term` 的 `decay(t,h) = exp(-t·ln2/h)`
 *     是**时间轴**上的两条曲线（真源 `params.ts` 文件头那张对照表）。本文件**没有时间项**、
 *     **不 import 时间轴上的任何东西**、也**不与任何衰减曲线相乘** —— 落地册 `:503` ③ / `:820` C14
 *     点名的「同一条记忆被两家乘过」在这里**结构上不可能**发生（本文件零 import，见下）。
 *   · **不是** Pavlik 间隔重复（`strength.ts` 的 `ΔS = a·(S_max−S)^b`）：那条**加**强度，本文件**重分配**强度。
 *   · **不是** query normalize（本仓 grep 命中的 `normaliz` 全是查询串归一，非同物）。
 *
 * ── 守恒律怎么被**真的**满足（本文件的核心，不是修辞）────────────────────────────
 *   先说一个**必须承认的数学事实**：若重归一化是「全体乘以同一个 λ」，则
 *   `Σ(λ·S_i) = λ·ΣS_i = ΣS_i` ⟺ **λ = 1** —— 即**恒等**。⇒「全局等比缩放 + 总强度守恒」
 *   在数学上**没有非平凡解**（同构于「把每个数都乘以 λ 而总和不变」）。
 *   故本文件的「重缩放」**不是等比缩放**：它按**相对批次均值 μ 的偏离**缩放 ——
 *
 *     `μ  = (Σ S_i) / N                       // 批次均值（守恒的支点）`
 *     `γ  = (capacity − μ) / (S_max − μ)      // 只按「最强落到容量」定出的缩放因子`
 *     `S'_i = μ + γ_eff·(S_i − μ)             // ← 实现写成 S_i + (γ_eff−1)·(S_i − μ)，数值更稳`
 *
 *   守恒是**代数恒等式**，不是调参调出来的：
 *     `Σ S'_i = Σ[μ + γ(S_i − μ)] = N·μ + γ·Σ(S_i − μ) = T + γ·0 = T   ∎`
 *   （关键在 `Σ(S_i − μ) ≡ 0` —— 这正是**支点必须取均值**的原因：均值是唯一使偏离和为 0 的点。
 *    换成任何别的支点（中位数、某个阈值），上面的 `γ·Σ(S_i−μ)` 就不为 0，守恒**立刻破**。
 *    ⇒ **「弱 / 强」的分界点不是本席选的，是被守恒代数逼出来的** —— 也正因如此，
 *    本文件**不需要**新增任何阈值登记项（`criteria.ts` 因此不必动）。）
 *
 *   顺带白拿一条**同样可断言**的读数：`S'_max = μ + γ(S_max − μ) = capacity` —— 精确落在容量上。
 *
 * ── ⚠ 但「容量」单条件**会把弱记忆推成负数**（本席实测，不是防御性设想）────────────────
 *   夹具 `S = [2,6,8,12]`、`capacity = 30` ⇒ `μ = 7`、`γ = 4.6`
 *   ⇒ `S'_1 = 7 + 4.6·(2−7) = **−16**`。而强度轴**有下界 0**
 *   （`strength.ts#strengthDelta` 明文「S 不得为负」）⇒ γ 必须再受一条约束：
 *
 *     `γ_floor = μ / (μ − S_min)     // 使**最弱的一条恰好落到 0** 的那个 γ`
 *     `γ_eff   = min(γ, γ_floor)`
 *
 *   ⇒ 三条性质在两条约束下**同时成立**：
 *     · **守恒**：与 γ 无关（`Σ(S_i−μ) ≡ 0`）⇒ **钳位不破坏守恒**（判据 ① 在钳位态另取一组读数）；
 *     · **次序**：`γ_eff > 0` ⇒ 弱侧仍严格下降、强侧仍不下降；
 *     · **下界**：`S'_i ≥ 0` 恒成立（最弱那条正好压在 0 上）。
 *   ⚠ **钳位必须可见**（本仓最防「静默钳位」）：`scaleRaw`（只按容量的 γ）与 `scale`（生效的 `γ_eff`）
 *     **分列**，另有 `clamped` 布尔与 basis 串 —— 「被非负下界截住」不得与「本来就算出这个数」同形。
 *   ⚠ **幂等不受影响（两种态都成立，由判据 ③ 分别断言）**：
 *     · 未钳位态：跑完 `S_max = capacity` ⇒ 第二次 `γ = 1` ⇒ 恒等；
 *     · **钳位态**：跑完 `S_min = 0` ⇒ 第二次 `γ_floor' = μ/μ = 1`，而 `γ' > 1`（因 `S_max < capacity`）
 *       ⇒ `γ_eff' = min(γ', 1) = 1` ⇒ **仍是恒等**。
 *   ⇒「每跑一次全体变弱」这条坏形态在两种态下都**结构上不可能**发生。
 *
 * ── 四条硬要求（任务卡原文 → 本文件的落点）──────────────────────────────────────
 *   ① **守恒律可断言**：读数里直接给 `totalBefore / totalAfter / conservationResidual`
 *      三个数 ⇒ 判据断言的是**这个数**，不是「跑完了没报错」。
 *   ② **降低弱关联 / 保留强关联**：`S_i < μ`（弱）**严格下降**；`S_i > μ`（强）**不下降**。
 *   ③ **幂等 / 可重入**：见上（两种态都是不动点）。
 *   ④ **失败态可分辨**：非法入参**抛**（fail-closed，口径同 `strength.ts` / `activity.ts`）；
 *      「没得做」不是「坏了」—— 三种 no-op 成因**各自点名**（`empty-input / no-spread / identity`），
 *      **不合并**成同一个静默返回 `null`。
 *
 * ── 容量 `capacity` 为什么**必填、无缺省**（一个刻意的设计选择）────────────────
 *   本包参数的唯一出处是 `params.ts`（其文件头明文：「**唯一出处**」），阈值登记在 `criteria.ts`。
 *   ⇒ 本文件若自带一个容量缺省值，就会在**注册表之外**新造第二个真源 —— 那正是本仓反复点名的形态。
 *   故容量一律**由调用方在调用点显式给出**，其来源在调用点上可读（口径同 `activity.ts` 的
 *   `tau` 必填、`prune.ts` 的 `scoreThreshold` 缺省不启用）。
 *
 * ── 结构性只读 + 零依赖（判据 ⑩ 逐条机检，不是注释承诺）─────────────────────────
 *   ① 本文件**零 import** —— 连 `params.ts` 都不引用 ⇒ 它在**结构上**不可能改到
 *      `activity.ts / decay.ts / retention.ts`（A1-5 的牙锚定的文件），也不可能引入写库面；
 *   ② 输入是**纯值快照**（无句柄可写）、无时钟、无 RNG、无 `Math.random` ⇒ 同输入两次调用逐位相同；
 *   ③ 返回对象与其中数组**递归冻结**（`deepFreeze`）⇒ 调用方拿到也改不动；
 *   ④ `ctx` / `node:sqlite` / INSERT 等写手势**一个都没有**（判据 ⑩ 的否定式断言面）。
 */

/** 一条待重归一化的**突触强度快照**（纯值，无句柄可写）。 */
export interface RenormSnapshot {
  readonly memoryId: string
  /**
   * 该条记忆当前的**强度**（本包口径：与 `S` / `S_max` 同单位，**天**；见 `params.ts` 的单位声明）。
   * 须为 `≥ 0` 的**有限数**：`0` 合法（`strengthDelta(0)` 本就是合法调用 ⇒ 强度 0 是可达状态），
   * `NaN` / `±Infinity` / 负数一律**抛**（见 `checkStrength`）。
   */
  readonly strength: number
}

/** 一条记忆**相对批次均值**的强弱归属。`equal` = 恰好落在均值上（`S' = S`，位置不变）。 */
export type RenormRank = 'weak' | 'strong' | 'equal'

/** 本次重归一化的**方向**（读数与判据都靠它区分，不靠猜）。 */
export type RenormDirection = 'sharpen' | 'compress'

/**
 * 三种「没得做」的成因（**各自点名，不合并** —— 本仓纪律「失败态必须可分辨」）。
 *   · `empty-input` —— 空批次（`N = 0`）。输入量本身为 0，不是缺陷。
 *   · `no-spread`   —— `S_max === μ`（全部相等）⇒ 没有强弱之分，重缩放无从谈起。
 *   · `identity`    —— `γ_eff === 1`（**幂等第二次运行的形态**）。两种来路由 basis 分列：
 *     `no-op.identity.capacity`（最强已达容量）或 `no-op.identity.floor`（最弱已在 0，下界不允许再展宽）。
 */
export type RenormNoopReason = 'empty-input' | 'no-spread' | 'identity'

/** 本次运行的**结局**（判别式联合：`kind` 一读即知是做了还是没做、为什么）。 */
export type RenormOutcome =
  | { readonly kind: 'renormalized'; readonly direction: RenormDirection }
  | { readonly kind: 'no-op'; readonly reason: RenormNoopReason }

/** 一条重归一化后的**逐条读数**。 */
export interface RenormRecord {
  readonly memoryId: string
  /** 缩放前强度 `S_i`。 */
  readonly strength: number
  /** 缩放后强度 `S'_i`（恒 `≥ 0` —— 非负下界由 `γ_floor` 保证，不由调用方善后）。 */
  readonly after: number
  /** `S'_i − S_i`（**带符号**：负 = 被降低，正 = 被强化；恒等态为 0）。 */
  readonly delta: number
  /** **相对均值的归属**（弱 = 被降低那侧）。⚠ 它是**位置**，不是「有没有动」—— 恒等态 delta 为 0 而 rank 照报。 */
  readonly rank: RenormRank
  /** `S'_i / S_i`；`S_i === 0` 时无意义 ⇒ `null`（**不返回 0 或 1 冒充**）。 */
  readonly factor: number | null
}

/** 重归一化读数（**全字段只读**；守恒量三个数**直接给出**，供判据断言）。 */
export interface RenormView {
  readonly view: 'read-only'
  /** 恒 `false`：本视图**不写任何行**（口径同 `prune.ts` 的 `PruneView` / `activity.ts` 的 `ActivityView`）。 */
  readonly writes: false
  readonly outcome: RenormOutcome
  /** 调用方传入的目标上界（容量）；原样回显 ⇒ 「用了哪个容量」在读数里可查。 */
  readonly capacity: number
  /** 批次均值 `μ`（守恒支点；也是弱/强分界）。 */
  readonly mean: number
  readonly minBefore: number
  readonly maxBefore: number
  /** 缩放后的最强值；未钳位时**精确等于** `capacity`（判据 ① 断言该数）。 */
  readonly maxAfter: number
  /** 缩放后的最弱值；钳位态**精确等于 0**（判据 ① 的非负腿断言该数）。 */
  readonly minAfter: number
  /** **生效的**缩放因子 `γ_eff`（恒等态为 1）。 */
  readonly scale: number
  /** **只按容量算出的** γ；与 `scale` 不同 ⇒ 被非负下界截住。 */
  readonly scaleRaw: number
  /** 非负下界对应的 γ 上限 `μ/(μ − S_min)`（使最弱一条恰好落到 0）。 */
  readonly scaleFloor: number
  /** `scale !== scaleRaw` ⇒ 被非负下界钳位（**钳位不静默**）。 */
  readonly clamped: boolean
  // ── ★ 守恒量三件套（判据直接断言这三个数，而不是「跑完了没报错」）──
  /** 缩放**前**总强度 `T = Σ S_i`。 */
  readonly totalBefore: number
  /** 缩放**后**总强度 `T' = Σ S'_i`。 */
  readonly totalAfter: number
  /** `T' − T`（**本文件的核心读数**；判据断言 `|residual| ≤ 容差`）。 */
  readonly conservationResidual: number
  // ── §13.6 的「提升信噪比」：操作化定义 = 变异系数 `σ/μ`（相对离散度）──
  /** 缩放前 `σ/μ`；`μ ≤ 0`（全 0 批次）时无定义 ⇒ `null`。 */
  readonly snrBefore: number | null
  readonly snrAfter: number | null
  /** `snrAfter / snrBefore`；恒等态恒为 1（**不是** `null` —— 读得出来才叫读数）。 */
  readonly snrGain: number | null
  readonly resolved: readonly RenormRecord[]
  /** 输入量（**显式记 0**：「无输入」与「未消费」须可分辨）。 */
  readonly inputCount: number
  readonly weakCount: number
  readonly strongCount: number
  readonly equalCount: number
  /** 判定依据（可枚举串；面板直接显示，**不是布尔**）。 */
  readonly basis: readonly string[]
}

/** 递归冻结（含数组元素）—— 判据面不是可被运行期改写的配置。 */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as Record<string, unknown>)) deepFreeze((v as Record<string, unknown>)[k])
    Object.freeze(v)
  }
  return v
}

/** 校验一条强度（fail-closed，口径同 `strength.ts` 的 `strengthDelta` / `activity.ts` 的 `checkAge`）。 */
function checkStrength(v: number, memoryId: string): number {
  if (!Number.isFinite(v)) {
    throw new Error(
      'renormalizeSynapses: strength 必须是有限数（memoryId=' + memoryId + '，实测 ' + String(v) + '）' +
        '—— NaN/Infinity 会让总和变成 NaN ⇒ 守恒式两边同时失效，而读数看起来只是「数不对」',
    )
  }
  if (v < 0) {
    throw new Error(
      'renormalizeSynapses: strength 不得为负（memoryId=' + memoryId + '，实测 ' + v + '）' +
        '—— 强度无负值语义；静默钳到 0 会让「越界」这个事实不可观测',
    )
  }
  return v
}

/** 总体标准差 `σ`（除以 N，不是 N−1：本文件要的是**批次自身**的离散度，不是样本估计）。 */
function stddev(xs: readonly number[], mean: number): number {
  if (xs.length === 0) return 0
  let acc = 0
  for (const x of xs) {
    const d = x - mean
    acc += d * d
  }
  return Math.sqrt(acc / xs.length)
}

/**
 * **守恒式突触重归一化**（v10 §13.6 的唯一实现者；**纯函数**：无时钟、无 RNG、不写任何存储）。
 *
 * @param items 批次快照（纯值）。`memoryId` **不得重复** —— 读数表按 id 对照，重复会让归属失去唯一性 ⇒ **抛**。
 * @param capacity 目标上界（容量）。**必填、无缺省**（理由见文件头）。
 *   ⚠ 契约：`capacity > μ`（容量必须高于批次均值）。否则 `γ ≤ 0`，
 *   会把弱/强两侧**次序反转**（比不归一化更坏）⇒ fail-closed **抛**。
 * @throws 任一 `strength` 非有限/为负、`memoryId` 重复、`capacity` 非正有限数、
 *   或 `capacity ≤ μ`（且批次有离散度）。**没有一种非法输入被静默吞掉。**
 */
export function renormalizeSynapses(items: readonly RenormSnapshot[], capacity: number): RenormView {
  const basis: string[] = []
  const n = items.length

  if (!Number.isFinite(capacity)) {
    throw new Error(
      'renormalizeSynapses: capacity 必须是有限数（实测 ' + String(capacity) + '）' +
        '—— 容量是守恒投影的靶，NaN 靶会让所有后置断言一起变成 NaN 而看不出来',
    )
  }
  if (capacity <= 0) {
    throw new Error('renormalizeSynapses: capacity 必须为正（实测 ' + capacity + '）—— 强度轴无负/零上界语义')
  }

  // ── 逐条校验 + 重复 id 检查（**在读均值之前**做，避免半途抛错留下「算了一半」的心智模型）──
  const before: number[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (seen.has(it.memoryId)) {
      throw new Error(
        'renormalizeSynapses: memoryId 重复（' + it.memoryId + '）—— 读数表按 id 对照，重复会让归属失去唯一性',
      )
    }
    seen.add(it.memoryId)
    before.push(checkStrength(it.strength, it.memoryId))
  }

  // ── A. 空批次：显式 no-op（**不是**抛错 —— 「没输入」与「坏了」必须可分辨）──
  if (n === 0) {
    return deepFreeze({
      view: 'read-only' as const,
      writes: false as const,
      outcome: { kind: 'no-op' as const, reason: 'empty-input' as const },
      capacity,
      mean: 0,
      minBefore: 0,
      maxBefore: 0,
      maxAfter: 0,
      minAfter: 0,
      scale: 1,
      scaleRaw: 1,
      scaleFloor: 1,
      clamped: false,
      totalBefore: 0,
      totalAfter: 0,
      conservationResidual: 0,
      snrBefore: null,
      snrAfter: null,
      snrGain: null,
      resolved: [] as readonly RenormRecord[],
      inputCount: 0,
      weakCount: 0,
      strongCount: 0,
      equalCount: 0,
      basis: ['input.empty', 'no-op.empty-input', 'conservation.trivially-true-on-empty'] as readonly string[],
    })
  }

  const totalBefore = before.reduce((a, b) => a + b, 0)
  const mean = totalBefore / n
  let maxBefore = before[0] as number
  let minBefore = before[0] as number
  for (const s of before) {
    if (s > maxBefore) maxBefore = s
    if (s < minBefore) minBefore = s
  }
  basis.push('input.count.' + n, 'mean.arithmetic')

  const spreadExists = maxBefore > mean
  basis.push(spreadExists ? 'spread.present' : 'spread.none')

  /** 由 `before` / `γ_eff` 生成整份读数（各出口共用，避免两处各写一份口径）。 */
  const build = (
    gammaEff: number,
    outcome: RenormOutcome,
    extraBasis: readonly string[],
    gammaRaw: number = gammaEff,
    gammaFloor: number = gammaEff,
  ): RenormView => {
    const resolved: RenormRecord[] = []
    let weakCount = 0
    let strongCount = 0
    let equalCount = 0
    let totalAfter = 0
    const afters: number[] = []
    for (let i = 0; i < n; i += 1) {
      const s = before[i] as number
      const d = s - mean
      // `S_i + (γ−1)(S_i−μ)` 与 `μ + γ(S_i−μ)` 代数等价，但前者把量级锚在原值上
      // ⇒ 同号相加不丢有效位，且 `S_i = μ` 的条目**逐位不变**（不会被加上又减掉同一批尾数）。
      const after = s + (gammaEff - 1) * d
      const rank: RenormRank = d > 0 ? 'strong' : d < 0 ? 'weak' : 'equal'
      if (rank === 'strong') strongCount += 1
      else if (rank === 'weak') weakCount += 1
      else equalCount += 1
      afters.push(after)
      totalAfter += after
      resolved.push({
        memoryId: items[i]!.memoryId,
        strength: s,
        after,
        delta: after - s,
        rank,
        // `S_i === 0` ⇒ 比值无意义（0/0 或 x/0）：给 null，**不返回 0 或 1 冒充**。
        factor: s === 0 ? null : after / s,
      })
    }
    let maxAfter = afters[0] as number
    let minAfter = afters[0] as number
    for (const s of afters) {
      if (s > maxAfter) maxAfter = s
      if (s < minAfter) minAfter = s
    }
    const snrBefore = mean > 0 ? stddev(before, mean) / mean : null
    const snrAfter = mean > 0 ? stddev(afters, mean) / mean : null
    return deepFreeze({
      view: 'read-only' as const,
      writes: false as const,
      outcome,
      capacity,
      mean,
      minBefore,
      maxBefore,
      maxAfter,
      minAfter,
      scale: gammaEff,
      scaleRaw: gammaRaw,
      scaleFloor: gammaFloor,
      clamped: gammaEff !== gammaRaw,
      totalBefore,
      totalAfter,
      conservationResidual: totalAfter - totalBefore,
      snrBefore,
      snrAfter,
      // 恒等态下 snrAfter 与 snrBefore 逐位相同 ⇒ 比值为 1（**读得出来**，不是 null）。
      snrGain: snrBefore === null || snrAfter === null || snrBefore === 0 ? null : snrAfter / snrBefore,
      resolved,
      inputCount: n,
      weakCount,
      strongCount,
      equalCount,
      basis: [...basis, ...extraBasis],
    })
  }

  // ── B. 无离散度（全体相等，`maxBefore === μ`）：**没有强弱之分** ⇒ no-op，成因单独点名 ──
  if (!spreadExists) {
    return build(1, { kind: 'no-op', reason: 'no-spread' }, ['no-op.no-spread', 'spread.zero-by-construction'])
  }

  // ── C. 容量契约：`capacity > μ`（否则 γ ≤ 0 ⇒ 次序反转）──
  if (capacity <= mean) {
    throw new Error(
      'renormalizeSynapses: capacity 必须**高于批次均值**（实测 capacity=' + capacity + ' ≤ μ=' + mean + '）' +
        '—— 此时 γ = (capacity−μ)/(S_max−μ) ≤ 0，会把「弱」侧推到「强」侧之上（次序反转），' +
        '比不归一化更坏 ⇒ fail-closed。调用方应传入真正的强度上界（本包口径 = S_max 同族）',
    )
  }

  // ── D. 两条约束定出生效的 γ ──
  //   ① 容量：最强的一条落到 capacity；
  //   ② 非负下界：最弱的一条不得落到 0 以下（**见文件头的实测 −16**）。
  //   ⚠ 有离散度 ⇒ `minBefore < μ` 严格成立 ⇒ `μ − minBefore > 0`（不会 0/0）。
  const gammaRaw = (capacity - mean) / (maxBefore - mean)
  const gammaFloor = mean / (mean - minBefore)
  const gamma = Math.min(gammaRaw, gammaFloor)

  // ── E. 恒等态（`γ_eff === 1`）：**幂等第二次运行的形态**，两来路由 basis 分列 ──
  if (gamma === 1) {
    const byFloor = gammaFloor < gammaRaw
    return build(
      1,
      { kind: 'no-op', reason: 'identity' },
      ['scale.one', byFloor ? 'no-op.identity.floor' : 'no-op.identity.capacity', 'idempotent.fixed-point'],
      gammaRaw,
      gammaFloor,
    )
  }

  const direction: RenormDirection = gamma > 1 ? 'sharpen' : 'compress'
  const extra: string[] = [
    'scale.' + gamma.toFixed(6),
    'direction.' + direction,
    direction === 'sharpen' ? 'effect.weak-down-strong-up' : 'effect.over-capacity-strong-down-weak-up',
  ]
  if (gamma !== gammaRaw) {
    // **钳位不静默**：把「被下界截住」写成一条可读的基据，并带上两个 γ。
    extra.push('clamped.non-negativity-floor')
    extra.push('clamped.raw.' + gammaRaw.toFixed(6))
    extra.push('clamped.floor.' + gammaFloor.toFixed(6))
  }
  return build(gamma, { kind: 'renormalized', direction }, extra, gammaRaw, gammaFloor)
}

/** 供判据/面板遍历的**实现面清单**（本文件自己报；因写面不含 `index.ts`（不得改），此处即本模块的发现面）。 */
export const RENORM_EXPORT_FACE: readonly string[] = Object.freeze([
  'RENORM_EXPORT_FACE',
  'renormalizeSynapses',
] as const)
