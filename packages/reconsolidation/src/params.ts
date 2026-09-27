/**
 * 本包参数的**唯一出处**。
 *
 * ── 口径（G1 / `docs/contract/threshold-discipline.md`）────────────────────────────────
 * 四类记忆的去稳定化窗口时长来自 v10 §15.2 的**裁定值**（落地册 L-02 逐字引用：
 * 「情景 30min / 语义 2h / 程序 6h / 情绪 1h」）。它们是：
 *   · **A 档**（确定性值，跨运行逐字复现）：本档只做单位换算，换算系数写死在下面；
 *   · ⚠ **不是本仓实测标定值** —— 本包**不声称**它们有本仓基线（不虚指数值来源），
 *     与 `forgetting/params.ts` 的 `ARCHIVE_RETENTION_CALIBRATED` 同一纪律。
 *     「有出处 ≠ 有基线」：前者是裁定（可引用），后者要实验（本包没有）。
 *
 * ⚠ **不得把窗口时长写成"可调配置"**：它们是**判据的靶子**（判据①按这四个值断言），
 *   一旦变成配置项，「固定夹具下逐字复现」就退化为「配置是什么就复现什么」——
 *   判据恒真（假覆盖）。故本表是**常量**，改动它必须逐个说明判据怎么跟着变。
 */

/** 四类记忆的认知类型轴（口径同 metacognition `criteria.generated.ts` 的 memClass：语义/情景/程序性）。 */
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'emotional'

/** 窗口参数表：类型 → 毫秒（**唯一真源**；`windowMs` 是它的读侧投影）。 */
export const WINDOW_MS_BY_TYPE: Readonly<Record<MemoryType, number>> = Object.freeze({
  /** 情景 30 分钟（v10 §15.2）。 */
  episodic: 30 * 60 * 1000,
  /** 语义 2 小时。 */
  semantic: 2 * 60 * 60 * 1000,
  /** 程序性 6 小时。 */
  procedural: 6 * 60 * 60 * 1000,
  /** 情绪 1 小时。 */
  emotional: 60 * 60 * 1000,
})

/** 本包认得的类型清单（判据按它枚举 ⇒ 新增类型忘登记即红：集合相等，不是"包含"）。 */
export const MEMORY_TYPES: readonly MemoryType[] = Object.freeze([
  'episodic',
  'semantic',
  'procedural',
  'emotional',
] as const)

/**
 * 四值的**秒级**表示，仅供判据/文档逐字引用（由毫秒表派生，**不是第二真源**）。
 * ⚠ 派生量必须派生于真源：下面用 `Object.fromEntries` 从毫秒表算出来，
 *   而不是再手抄一份 —— 两份手抄必漂移，且漂移不可观测（本仓 C14）。
 */
export const WINDOW_SECONDS_BY_TYPE: Readonly<Record<MemoryType, number>> = Object.freeze(
  Object.fromEntries(MEMORY_TYPES.map((t) => [t, WINDOW_MS_BY_TYPE[t] / 1000])) as Record<MemoryType, number>,
)

/**
 * ── 检索类型 → 保持增益（**v10 §15.4 测试效应**）—— 本包的**第三个参数轴** ─────────────────
 *
 * 真源（`docs/mana-v10-status-plan.md:808-814`，逐字）：
 *
 *   | 检索类型 | 保持增强 |
 *   |---|---|
 *   | 再认 | 0.05 |
 *   | 回忆 | 0.15 |
 *   | 精细提取 | 0.25 |
 *
 * ⚠ **这一轴在本仓此前完全不存在**（不是「接一个既有字段」）：全仓 `再认`/`精细提取`/
 *   `recognition`/`elaborat`/`testingEffect`/`保持增强` 实测**零命中**
 *   （`docs/mana-progress-audit-2026-09-27.md:106-108`）⇒ 本包**引入**它。
 *
 * ⚠ 三个增益是 **A 档裁定值**（有出处、跨运行逐字复现），与 `WINDOW_MS_BY_TYPE` **同档**：
 *   **不是本仓实测标定值** —— 本包**不声称**它们有本仓基线（「有出处 ≠ 有基线」，
 *   同 `forgetting/params.ts` 的 `ARCHIVE_RETENTION_CALIBRATED` 纪律）。
 * ⚠ **不得写成「可调配置」**：它们是**判据的靶子**（判据断言三档各自可分辨），一旦变成配置项，
 *   「固定夹具下逐字复现」就退化为「配置是什么就复现什么」⇒ 判据恒真。故下表是**常量**。
 *
 * ── 增益**作用在哪**：三条各自给理由，而不是「挑一个顺手的」────────────────────────────────
 *   · ⛔ **不是衰减率**：`long-term/src/decay.ts:15` 明写它是唯一写者；
 *     `forgetting/src/params.ts:30` 明写「⛔ **不得相乘**（`decay × retention`）」——
 *     再引一个乘子正是 C14 的「同一条记忆被两家乘过」。
 *   · ⛔ **不是基础激活**：`long-term/src/activation.ts:21` 明写「B 的单位是秒、decay 的单位是天，
 *     两者不可相乘」；基础激活的幂律衰减由 `d` 承担，不得再乘一次。
 *   · ✅ **是「检索之后那段保持」的长度**：本包唯一的「保持」落点就是去稳定化窗口
 *     （`reconsolidation_window_until`；v10 §15.1「记忆被检索并注入上下文 → 去稳定化窗口开启」）。
 *     增益定义为**窗口时长的比例延长**：`Δuntil = round(windowMs(type) × gain)`。
 *     ⇒ 它**加**在既有窗长上：**不新增公式、不与任何既有乘子重叠**
 *     （判据里有一条专门的「未与幂律衰减重复相乘」腿）。
 *     ⇒ 且三档在**任何**记忆类型上都保持 `0.05 < 0.15 < 0.25` 的**序关系**（可测）。
 *
 * ⚠ **一个必须交代的边界**：`0.05/0.15/0.25` 是**无量纲比例**，本包把它乘在
 *   **检索驱动的窗口时长**上得到毫秒。这条口径的理由：窗口是本包唯一可写的「保持」量，
 *   且乘窗长能让三档在任何记忆类型上都可分辨（若改成「加一个固定毫秒数」，
 *   就必须再凭空定义那个毫秒数 —— 那是无出处的魔数）。
 */

/** 检索类型轴（v10 §15.4 的三档；**与 `MemoryType` 正交**，不共用键空间）。 */
export type RetrievalKind = 'recognition' | 'recall' | 'elaboration'

/** 本包认得的检索类型（判据按它枚举 ⇒ 新增成员忘登记即红：**集合相等，不是「包含」**）。 */
export const RETRIEVAL_KINDS: readonly RetrievalKind[] = Object.freeze([
  'recognition',
  'recall',
  'elaboration',
] as const)

/**
 * 保持增益表：检索类型 → 比例（**唯一真源**；`retentionGain` 是它的读侧投影）。
 *
 * 键空间**逐字**取自 v10 §15.4 的三行（再认 / 回忆 / 精细提取）。
 */
export const RETENTION_GAIN_BY_KIND: Readonly<Record<RetrievalKind, number>> = Object.freeze({
  /** 再认（recognition）—— 认得它。 */
  recognition: 0.05,
  /** 回忆（recall）—— 想起它。 */
  recall: 0.15,
  /** 精细提取（elaboration）—— 提取时做了精细加工。 */
  elaboration: 0.25,
})

/** 检索类型是否在册（判据与调用方共用，避免各处 `includes` 抄一份）。 */
export function isRetrievalKind(value: unknown): value is RetrievalKind {
  return typeof value === 'string' && (RETRIEVAL_KINDS as readonly string[]).includes(value)
}

/**
 * 取某档检索类型的保持增益（比例）。
 *
 * ⚠ **未知检索类型必须抛**，不得回落 0：回落会让
 *   「调用方把类型写错了」与「这次检索确实没有增强」**表面完全同形** ——
 *   而「三档可分辨」正是 §15.4 的判据靶子，静默回落等于把靶子换掉。
 *   （口径逐字同 `window.ts` 的 `windowMs`。）
 *
 * @throws 类型不在册时抛 `RangeError`，消息里点名**合法取值**（让调用方一眼可修）。
 */
export function retentionGain(kind: string): number {
  if (!isRetrievalKind(kind)) {
    throw new RangeError(`未知检索类型 ${JSON.stringify(kind)}；在册取值 = ${RETRIEVAL_KINDS.join(" / ")}`)
  }
  return RETENTION_GAIN_BY_KIND[kind]
}

/**
 * 把比例增益折算成**毫秒**延长量：`Δ = round(windowMs × gain)`。
 *
 * ⚠ 入参是**窗长本身**（而不是记忆类型）：本函数**不查表**，故它对
 *   「窗长从哪来」保持无知 —— 增益只对「保持时长」这个概念负责，不与窗口参数表耦合。
 * ⚠ 取整到毫秒是**确定性**的（`Math.round` 对固定输入逐位复现），且三档在四类记忆上
 *   取整后仍**两两不同**（判据实测的最小间隔见 `testing-effect.test.mjs`）。
 *
 * @throws windowMsValue 非正有限数时抛（0 或负窗长没有「比例延长」的含义，静默返回 0 会把
 *   配置错误伪装成「增益为 0」）。
 */
export function retentionGainMs(windowMsValue: number, kind: string): number {
  const gain = retentionGain(kind)
  if (!Number.isFinite(windowMsValue) || windowMsValue <= 0) {
    throw new RangeError(
      `retentionGainMs: 窗长必须是正有限数（实测 ${String(windowMsValue)}）—— 0/负数没有「比例延长」的含义`,
    )
  }
  return Math.round(windowMsValue * gain)
}

/**
 * 解析调用方给的检索类型，**并显式区分「未声明」与「写错了」**。
 *
 * 契约（三态，判据逐条断言）：
 *   · `undefined` / `null` ⇒ 返回 `null`：**本次没有声明检索类型** ⇒ 不施加增益（零改动，
 *     与改动前逐字同行为）。这是既有生产调用方（`scheduler` 的注入链）的形态 ——
 *     它只知道「发生了检索」，还不知道「是哪种检索」。
 *   · 三档之一 ⇒ 返回该档。
 *   · 其余任何值（含空串、数字、对象、近似写错的串）⇒ **抛 `RangeError`**。
 *     ⚠ 不得把非法值读成「未声明」：那会让「调用方拼错了类型」变成一次**静默的零增益**，
 *     而零增益与「这次检索没有增强」同形 —— 正是本仓最防的失败不可观测。
 */
export function resolveRetrievalKind(value: unknown): RetrievalKind | null {
  if (value === undefined || value === null) return null
  if (isRetrievalKind(value)) return value
  throw new RangeError(
    `未知检索类型 ${JSON.stringify(value)}；在册取值 = ${RETRIEVAL_KINDS.join(' / ')}` +
      "（未声明请传 undefined/null —— 非法值不得读成未声明，否则拼错类型会静默变成零增益）",
  )
}
