/**
 * `dsh-mana-ui` **审计回放**（B6.2 / A5-3）+ 与**状态回放**的**显式分流**。
 *
 * ⚠⚠ **本仓「回放」一词指两件语义相反的事，本文件把它们在命名、入口、文档三处分开**：
 *
 *   | | ① 审计回放 / audit replay | ② 状态回放 / state replay |
 *   |---|---|---|
 *   | 入口 | 本文件 `replayWindow()` / 端点 `mana-ui/replay` | **本包不实现**（无此入口） |
 *   | 读写 | **只读**：读 `mana_trace`，产出**状态序列** | **写回**：把 trace 里的旧状态写回库 |
 *   | 后果 | 无副作用，可反复跑、可逐项比对（A5-3） | **复活旧状态**（G10 / `册:176`） |
 *   | 依据 | `册:629` A5-3「回放不得写回 `memory_items`（只读回放）」 | `方案:904`「插件重启后从 `mana_trace` 回放」 |
 *
 *   ⇒ 两者**同一句「回放」，判据方向相反**。本模块只实现 ①，并在结构上让 ② **无法被误用**：
 *     · 回放面（{@link ReplayFrame}）自带 {@link ReplayFrame.scanTargets}，审计回放**恒为空数组**；
 *     · {@link assertAuditReplayReadOnly} 是唯一的守卫入口，非空即**大声抛**；
 *     · 存储适配器（`store.ts`）的**唯一写口**是 `writeRender`（写 `mana_trace` 的 `ui/render` 行）
 *       —— 回放路径在类型上就拿不到任何「写 `memory_items`」的方法（见 `PanelStore`）。
 *
 * ⚠ **状态回放不是本模块的 TODO**：本包是全链的**消费侧**，把 trace 写回记忆库属于生产侧，
 *   且 `docs/mana-rollout-plan.md:637` 的边界是「审计回放**不写库**」。故这里只做**分流声明**
 *   与**不变量守卫**，不引入写回通道（引入即拆东墙：会让 A5-3 的判据结构性恒绿）。
 *
 * 纯函数：本文件不吃 cordis、不碰 `ctx`、不摸 DOM ⇒ 可直接断言（判据不需要装配就能跑）。
 * ⚠ 本文件属 **Host 半区**（入口静态 import 它）⇒ 入口体积纪律（A5-4）要求算法留在这里，
 *   不要把回放逻辑搬进 `src/index.ts`。
 */
import { MANA_STAGES, type ManaStage } from 'dsh-mana-core'

/**
 * `mana_trace` 的一行 —— 回放的**唯一输入**。
 *
 * `payload` 保持**原始文本**（不在这里解析）：解析成功与否本身就是回放要如实报告的事实
 * （见 {@link ReplayFrame.unknownPayloads}），提前吞掉就再也数不出来了。
 */
export interface TraceRow {
  readonly seq: number
  readonly eventType: string
  readonly payload: string
  readonly sessionId: string
  readonly turnId: number
  readonly at: string
}

/**
 * 回放状态：由该行 `payload` 的**特征字段**推得。
 *
 * ⚠ 缺字段一律落 **`null`**，不用 `0` / `''` 冒充 —— 本仓首位的缺陷类正是
 *   「'判不了' 与 '判不准' 在数据上同形」。`degraded` 同理用 `boolean | null`。
 */
export interface ReplayState {
  /** 关联键（请求与结果靠它回填，见契约 `ManaEnvelope`）。 */
  readonly requestId: string | null
  /** 注入门控判定结果（五类枚举，见契约 `InjectionGate`）；非 injection 段为 `null`。 */
  readonly gate: string | null
  readonly blockId: string | null
  readonly memoryId: string | null
  /** 该段是否降级；payload 未记该字段时为 `null`（**不是 false**）。 */
  readonly degraded: boolean | null
  /** 工作记忆入队后的条数（attention 段的 `size`/`focusSize`）。 */
  readonly size: number | null
  /** 召回通道（'vector'/'lexical'/'degraded'）。 */
  readonly channel: string | null
  readonly hitCount: number | null
  readonly rankBy: string | null
}

/** 回放面上的**一步** = `seq → state`。A5-3 的「状态序列逐项相等」比的就是这个数组。 */
export interface ReplayStep {
  readonly seq: number
  readonly eventType: string
  /** 落在契约 `MANA_STAGES` 内的类别；**不在**则为 `null`（显式未归类，不静默归并）。 */
  readonly kind: ManaStage | null
  readonly at: string
  readonly state: ReplayState
}

/** 一次审计回放的产物。 */
export interface ReplayFrame {
  /** 窗口内首/末 `seq`；窗口为空时为 `null`。 */
  readonly from: number | null
  readonly to: number | null
  /** 会话过滤条件（`null` = 不限会话）。回放**必须**能把过滤条件原样报回，否则不可复现。 */
  readonly sessionId: string | null
  /** 逐步状态序列，按 `seq` **升序**（回放是顺序器具，不接受乱序比对）。 */
  readonly steps: readonly ReplayStep[]
  /** 窗口内的 `seq` 缺口（`[[gapFrom, gapTo], …]`，左闭右开）；连续时为 `[]`。 */
  readonly gaps: readonly (readonly number[])[]
  /** `payload` 非 JSON 对象的行数（**显式计数**，不是静默丢弃）。 */
  readonly unknownPayloads: number
  /**
   * ⚠ **本次回放要写的表名清单**。审计回放**恒为空数组** —— 这就是「只读回放」的机检落点：
   *   任何「写回」实现都必须先在这里落名才能被表达出来，而 {@link assertAuditReplayReadOnly}
   *   会在非空时直接抛。**注意它的强度边界**：它约束的是「回放面自报的写目标」，
   *   独立证据是判据里对 `memory_items` 的**库镜像逐字节比对**（见 tests/replay.test.mjs）。
   */
  readonly scanTargets: readonly string[]
}

/** 审计回放要写的表：**恒为空**（A5-3「只读回放」的结构化落点）。 */
export const AUDIT_REPLAY_WRITE_TARGETS: readonly string[] = []

/**
 * （**仅供对照，本包不实现**）状态回放会写的表。
 *
 * ⚠ 列在这里**不是「实现了它」**，而是让两者的差别**可被比较**：判据断言审计回放的
 *   {@link ReplayFrame.scanTargets} 与这份清单**交集为空** —— 不是一句注释，是一条断言。
 *   对应 `方案:904`（重启后回放）→ G10「回放会复活旧状态」（`册:176`）。
 */
export const STATE_REPLAY_WRITE_TARGETS: readonly string[] = ['memory_items']

/** 回放模式标记（跨端可枚举；Client 与 Host 各自声明同一字面量，不共享 import）。 */
export const REPLAY_MODES = {
  /** ① 只读、可复现、逐项可比对。 */
  audit: 'audit-replay',
  /** ② 写回、会复活旧状态 —— **本包无此入口**，仅在文档与判据里作对照。 */
  state: 'state-replay',
} as const

/** 单次回放的窗口上限（**不设无界读**；与面板读上限同源纪律）。 */
export const REPLAY_LIMIT_DEFAULT = 64
export const REPLAY_LIMIT_MAX = 512

/**
 * 事件类别：**唯一真源 = 契约 `MANA_STAGES`**，不在本包手写第三套字面量
 * （本仓踩过：三套名字各写各的 ⇒ 判据「看起来在验五类」，实际验的是另外三个东西）。
 * 未归类时返回 `null`（显式未归类），**不**归并到任何已有类。
 */
export function eventKind(eventType: string): ManaStage | null {
  return (MANA_STAGES as readonly string[]).includes(eventType) ? (eventType as ManaStage) : null
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const asBoolean = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/**
 * 解析一行 `payload`。
 *
 * ⚠ 这里的 try/catch **不是** `docs/contract/degradation.md` 禁掉的
 *   `catch { return null }` 形态：失败**被计数**（`ReplayFrame.unknownPayloads`）并随回放
 *   面回到调用方，不会被混同成「这段本来就没有状态」。
 */
function parsePayload(raw: string): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

/** 从一行 `payload` 推状态（**纯函数**，不吃 DB、不吃 ctx）。 */
export function stateOf(payload: string): ReplayState {
  const p = parsePayload(payload) ?? {}
  return {
    requestId: asString(p.requestId),
    gate: asString(p.gate),
    blockId: asString(p.blockId),
    memoryId: asString(p.memoryId),
    degraded: asBoolean(p.degraded),
    // ⚠ 两处生产侧字段名不同（working-memory 用 `size`、契约事件里叫 focusSize）
    //   ⇒ 两个都读，读到哪个算哪个；都没有才是 null。**不**把其中一个当默认值。
    size: asNumber(p.size) ?? asNumber(p.focusSize),
    channel: asString(p.channel),
    hitCount: asNumber(p.hitCount),
    rankBy: asString(p.rankBy),
  }
}

function clampWindow(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (n <= 0) return fallback
  return Math.min(n, max)
}

/** 一次回放的窗口参数（三件套：起 `seq` / 条数 / 会话过滤 —— 三者都要能原样报回）。 */
export interface ReplayQuery {
  readonly limit?: number | undefined
  readonly fromSeq?: number | undefined
  readonly sessionId?: string | null | undefined
}

/**
 * **审计回放主入口**：把 `mana_trace` 的一段片段回放成**状态序列**。
 *
 * 语义（逐条钉住，A5-3 的判据就比这些）：
 *   · 输入按 `seq` **升序**消费，产出也按 `seq` 升序 ⇒ 同输入必得同输出（可复现）；
 *   · `fromSeq` 为**左闭**下界，窗口取「从 `fromSeq` 起的前 `limit` 条」；
 *   · `sessionId` 非空时按会话过滤（`null`/`''` = 不限会话 ⇒ **不丢行**）；
 *   · 本函数**只读**：不接 DB、不接任何写口，返回值里 {@link ReplayFrame.scanTargets} 恒为 `[]`。
 */
export function replayWindow(rows: readonly TraceRow[], query: ReplayQuery = {}): ReplayFrame {
  const limit = clampWindow(query.limit, REPLAY_LIMIT_DEFAULT, REPLAY_LIMIT_MAX)
  const fromSeq = asNumber(query.fromSeq ?? null) ?? 0
  const sessionId = asString(query.sessionId ?? null)

  const picked: TraceRow[] = []
  let unknownPayloads = 0
  for (const row of rows) {
    const seq = asNumber(row.seq)
    if (seq === null || seq < fromSeq) continue
    if (sessionId !== null && asString(row.sessionId) !== sessionId) continue
    if (picked.length >= limit) break
    picked.push(row)
    if (parsePayload(row.payload) === null) unknownPayloads += 1
  }
  picked.sort((a, b) => a.seq - b.seq)

  const steps: ReplayStep[] = picked.map((row) => ({
    seq: row.seq,
    eventType: row.eventType,
    kind: eventKind(row.eventType),
    at: row.at,
    state: stateOf(row.payload),
  }))

  // 缺口：窗口内相邻 two 步之间的 `seq` 空洞（连续编号下应为 0 处）。
  const gaps: number[][] = []
  for (let i = 1; i < steps.length; i += 1) {
    const prev = steps[i - 1]
    const cur = steps[i]
    if (prev === undefined || cur === undefined) continue
    if (cur.seq > prev.seq + 1) gaps.push([prev.seq + 1, cur.seq])
  }

  const first = steps[0]
  const last = steps[steps.length - 1]
  return {
    from: first === undefined ? null : first.seq,
    to: last === undefined ? null : last.seq,
    sessionId,
    steps,
    gaps,
    unknownPayloads,
    scanTargets: AUDIT_REPLAY_WRITE_TARGETS,
  }
}

/**
 * 「审计回放**不写库**」的守卫：回放面若自报了任何写目标，**立即抛**。
 *
 * ⚠ 强度边界（写在明处，免得被当成万能判据）：它挡住的是**经本模块表达出来的写回**；
 *   真正的独立证据是判据里对 `memory_items` 的**库镜像逐字节比对** ——
 *   回放前后镜像必须相同，写一行就红（见 `tests/replay.test.mjs`）。
 */
export function assertAuditReplayReadOnly(frame: ReplayFrame): readonly string[] {
  if (frame.scanTargets.length > 0) {
    throw new Error(
      '审计回放不得写库（A5-3「只读回放」），但本回放面自报写目标 = ' +
        frame.scanTargets.join(', ') +
        '。若确需写回，那是**状态回放**（' +
        REPLAY_MODES.state +
        '，会复活旧状态，见 G10）—— 必须另开入口并在交付说明里写明。',
    )
  }
  return []
}

/**
 * 状态序列的**逐项比对**（A5-3 的判定动作：`[]` = 逐项相等）。
 *
 * ⚠ **按 `seq` 对齐，不按数组下标对齐**（本席实测的必要性）：
 *   `mana_trace.seq` 是 AUTOINCREMENT 主键 ⇒ 它才是「哪一步」的身份。
 *   按下标比时，**中间丢一条**会把后面所有步骤整体错位，差异清单变成一片
 *   「第 N 项 seq 不等」的噪声，真正的「缺 seq=2」被埋掉（实测输出 8 条差异里
 *   只有最后一条指到真因）。按 `seq` 对齐后，丢项就是「缺 seq=2」，一字不差。
 *
 * **逐字段点出差异**（不给一个笼统的 false）：「序列不等」本身不是可行动的读数。
 */
export function diffSequences(
  original: readonly ReplayStep[],
  replayed: readonly ReplayStep[],
): string[] {
  const out: string[] = []
  if (original.length !== replayed.length) {
    out.push(`长度不等：原始 ${original.length} 项 vs 回放 ${replayed.length} 项`)
  }
  const bySeq = (steps: readonly ReplayStep[]): Map<number, ReplayStep> => {
    const m = new Map<number, ReplayStep>()
    for (const s of steps) m.set(s.seq, s)
    return m
  }
  const aMap = bySeq(original)
  const bMap = bySeq(replayed)

  for (const s of original) {
    if (!bMap.has(s.seq)) out.push(`回放缺 seq=${s.seq}（原序列有此项 ⇒ 回放**丢了**一步）`)
  }
  for (const s of replayed) {
    if (!aMap.has(s.seq)) out.push(`回放多出 seq=${s.seq}（原序列无此项 ⇒ 回放**多记**了状态）`)
  }
  for (const a of original) {
    const b = bMap.get(a.seq)
    if (b === undefined) continue
    const at = `seq=${a.seq}`
    if (a.eventType !== b.eventType) out.push(`${at}：eventType 不等 ${a.eventType} vs ${b.eventType}`)
    if (a.kind !== b.kind) out.push(`${at}：kind 不等 ${String(a.kind)} vs ${String(b.kind)}`)
    const keys = Object.keys(a.state) as (keyof ReplayState)[]
    for (const k of keys) {
      if (a.state[k] !== b.state[k]) {
        out.push(`${at}：state.${String(k)} 不等 ${JSON.stringify(a.state[k])} vs ${JSON.stringify(b.state[k])}`)
      }
    }
  }
  return out
}
