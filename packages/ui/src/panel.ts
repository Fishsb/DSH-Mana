/**
 * `dsh-mana-ui` **面板逻辑**（Host 侧，不属入口）。
 *
 * ⚠ **为什么独立成模块**：P-1/A5-4 要求 Host 入口与样板同量级（个位数 KB）。
 *   把面板逻辑塞进 `src/index.ts` 会让入口膨胀一个数量级 —— 故入口只做
 *   「装配 + 注册方法名」，全部算法在本文件，且入口**静态** import 它（见 index.ts 头注）。
 *
 * 本文件**不含**任何 node 专有 API（无 `node:fs` / `node:sqlite`），
 * 它只面向注入进来的存储端口 `PanelStore` 与协议层 `PanelWire`。
 *
 * ⚠ **「回放」在本文件里只有一个含义：审计回放**（`METHODS.replay`）——
 *   读 `mana_trace` ⇒ 产出状态序列，**只读、可复现**（`册:629` A5-3）。
 *   与之语义相反的**状态回放**（写回、会复活旧状态，`册:176` G10 / `方案:904`）
 *   **在本包没有入口**：本文件的存储端口 `PanelStore` 上没有、也不许有写
 *   `memory_items` 的方法。分流的完整对照表见 `src/replay.ts` 文件头。
 */
import {
  assertAuditReplayReadOnly,
  replayWindow,
  REPLAY_LIMIT_DEFAULT,
  type ReplayFrame,
  type TraceRow,
} from './replay.ts'

/** 跨界的**唯一**数据形态：无损 JSON（两端各自声明，不共享 import）。 */
export interface HeatCell {
  readonly memoryId: string
  readonly activation: number
  readonly strength: number
  readonly type: string
}

export interface GoalNode {
  readonly id: string
  readonly parentId: string | null
  readonly title: string
  readonly status: string
  readonly priority: number
  readonly depth: number
}

export interface TraceItem {
  readonly seq: number
  readonly eventType: string
  readonly at: string
  readonly sessionId: string
  readonly turnId: number
}

export interface PanelsSnapshot {
  readonly generatedAt: string
  readonly heatmap: readonly HeatCell[]
  readonly goalTree: readonly GoalNode[]
  readonly timeline: readonly TraceItem[]
  /**
   * 数据面是否可用。**降级必须落显式字段**（`docs/contract/degradation.md` I-8）：
   * 消费侧靠 `degraded === true` + `reason` 非空字符串分辨「没数据」与「读不到」。
   */
  readonly degraded: boolean
  readonly reason: string
}

export interface RenderAck {
  /**
   * 本次渲染落点是否成功写入。**R5 判据的唯一可读面**：
   * 卸载插件后该落点不再产生新行 ⇒ 这里的 `traceSeq` 不再增长。
   */
  readonly ok: boolean
  readonly traceSeq: number
  readonly degraded: boolean
  readonly reason: string
}

/** Host 侧存储端口（由入口把 `mana-core` 适配成本接口，面板逻辑不认识 cordis）。 */
export interface PanelStore {
  /** 读激活值热力图源数据（`memory_items`）。 */
  heatmap(limit: number): readonly HeatCell[]
  /** 读目标栈（`goals`）。 */
  goals(limit: number): readonly GoalNode[]
  /** 读认知轨迹（`mana_trace`）。 */
  timeline(limit: number): readonly TraceItem[]
  /**
   * 读回放窗口的原料：`mana_trace` 按 `seq` **升序**的前 `limit` 行（`fromSeq` 为左闭下界）。
   *
   * ⚠ **只读**。审计回放的输入端**不得**再有任何写口 —— 这是「只读回放」在类型面上的落点：
   *   本端口**没有**「把状态写回 `memory_items`」的方法（那就是 G10 的状态回放），
   *   而本端口唯一的写口是下面的 `writeRender`，它只写 `mana_trace` 的落点行。
   */
  traceRows(limit: number, fromSeq: number, sessionId: string | null): readonly TraceRow[]
  /** 写一条 `mana_trace` 的 `ui/render` 行，返回 `seq`（R5 落点）。 */
  writeRender(entry: {
    sessionId: string
    turnId: number
    panel: string
    rendered: number
    at: string
  }): number
}

/** 协议层：只放行无损 JSON。 */
export interface PanelWire {
  handle(method: string, handler: (args: unknown) => Promise<unknown> | unknown): void
}

/** 协议方法名（Client 与 Host **各自**声明同一组字面量，不共享 import ⇒ 产物独立）。 */
export const METHODS = {
  panels: 'mana-ui/panels',
  render: 'mana-ui/render',
  meta: 'mana-ui/meta',
  /** **审计回放**（只读、可复现）。⚠ 与「状态回放」不是同一件事，见本文件头注。 */
  replay: 'mana-ui/replay',
} as const

/** 单次读取的行数上限（**不设无界读**）。 */
export const READ_LIMIT_DEFAULT = 32
export const READ_LIMIT_MAX = 256

/** 落点面板名（`mana_trace.event_type='ui/render'` 的 `panel` 字段取值）。 */
export const PANEL_ID = 'mana-ui'

function clampLimit(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (n <= 0) return READ_LIMIT_DEFAULT
  return Math.min(n, READ_LIMIT_MAX)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** 降级信封：`degraded === true` 且 `reason` 非空（I-8，禁 `catch { return null }`）。 */
function degradedSnapshot(reason: string): PanelsSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    heatmap: [],
    goalTree: [],
    timeline: [],
    degraded: true,
    reason,
  }
}

/**
 * 装配协议方法。**注册了三件事**：读三面板、写落点、报元信息。
 *
 * 每个 handler 都先做**形状校验**再落库 —— 跨界数据必须是无损 JSON，
 * 非 JSON 值（函数/Symbol/循环引用）在协议层就被拒绝，不让它污染数据面。
 */
export function registerPanels(wire: PanelWire, store: PanelStore): void {
  wire.handle(METHODS.meta, () => ({
    panelId: PANEL_ID,
    methods: Object.values(METHODS),
    readLimitMax: READ_LIMIT_MAX,
  }))

  wire.handle(METHODS.panels, (args: unknown) => {
    const a = asRecord(args)
    const limit = clampLimit(a.limit, READ_LIMIT_DEFAULT)
    try {
      return {
        generatedAt: new Date().toISOString(),
        heatmap: store.heatmap(limit),
        goalTree: store.goals(limit),
        timeline: store.timeline(limit),
        degraded: false,
        reason: '',
      } satisfies PanelsSnapshot
    } catch (error) {
      // 显式降级：不吞错成 null，也不把「读不到」与「本来没有」混为一谈。
      return degradedSnapshot(error instanceof Error ? error.message : 'unknown store failure')
    }
  })

  /**
   * **审计回放**端点：读一段 `mana_trace` ⇒ 回放成状态序列（只读）。
   *
   * ⚠ 端点名 `mana-ui/replay` 只指**审计**回放；状态回放（写回、复活旧状态）在本包
   *   **无端点**（也没有可用的写口），见 `src/replay.ts` 的分流表。
   */
  wire.handle(METHODS.replay, (args: unknown) => {
    const a = asRecord(args)
    const limit = clampLimit(a.limit, REPLAY_LIMIT_DEFAULT)
    const fromSeq = typeof a.fromSeq === 'number' && Number.isFinite(a.fromSeq) ? Math.floor(a.fromSeq) : 0
    const sessionId = typeof a.sessionId === 'string' && a.sessionId !== '' ? a.sessionId : null
    try {
      const rows = store.traceRows(limit, fromSeq, sessionId)
      const frame = replayWindow(rows, { limit, fromSeq, sessionId })
      // 守卫就在返回值这一行上：万一上游把审计回放改造成会写库的形态，这里**当场抛**。
      assertAuditReplayReadOnly(frame)
      return frame
    } catch (error) {
      // 降级必须可读（I-8）：与读三面板同一信封，不让「读不到」与「本来没有」同形。
      return degradedSnapshot(error instanceof Error ? error.message : 'unknown replay failure')
    }
  })

  wire.handle(METHODS.render, (args: unknown) => {
    const a = asRecord(args)
    const panel = typeof a.panel === 'string' && a.panel !== '' ? a.panel : PANEL_ID
    const rendered = typeof a.rendered === 'number' && Number.isFinite(a.rendered) ? a.rendered : 0
    const sessionId = typeof a.sessionId === 'string' ? a.sessionId : ''
    const turnId = typeof a.turnId === 'number' && Number.isFinite(a.turnId) ? a.turnId : 0
    try {
      const seq = store.writeRender({
        sessionId,
        turnId,
        panel,
        rendered,
        at: new Date().toISOString(),
      })
      return { ok: true, traceSeq: seq, degraded: false, reason: '' } satisfies RenderAck
    } catch (error) {
      // 落点失败同样必须可读：UI 侧据此显示「落点不可用」而不是静默当成成功。
      return {
        ok: false,
        traceSeq: -1,
        degraded: true,
        reason: error instanceof Error ? error.message : 'unknown write failure',
      } satisfies RenderAck
    }
  })
}
