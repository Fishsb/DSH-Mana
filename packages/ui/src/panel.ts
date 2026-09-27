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
  /**
   * 读「模型通道」偏好（`user_model` 里的单键）；键不存在 ⇒ `null`（**不是**空串）。
   *
   * ⚠ 它是本端口**第二个也是最后一个**写口（`writeChannel`）的读侧，写的是 core 的
   *   `user_model` 偏好表 —— **不是** `memory_items`（那条红线只针对记忆表，
   *   见本文件头注与 `tests/replay.test.mjs` 的负扫探针）。
   */
  readChannel(): string | null
  /** 写「模型通道」偏好（单键覆盖；core 侧另有历史行）。 */
  writeChannel(value: string): void
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
  /** **模型通道**：读当前生效通道（含来源与证据），或在用户改动后写入（持久化）。 */
  channel: 'mana-ui/channel',
} as const

/** 单次读取的行数上限（**不设无界读**）。 */
export const READ_LIMIT_DEFAULT = 32
export const READ_LIMIT_MAX = 256

/** 落点面板名（`mana_trace.event_type='ui/render'` 的 `panel` 字段取值）。 */
export const PANEL_ID = 'mana-ui'

// ── 模型通道（local / cloud）────────────────────────────────────────────────
/**
 * 「评估器跑哪条模型通道」的**唯一判定归属地**。
 *
 * ⚠ **为什么放在 UI 包里**（而不是 `tools/eval-l1-l4.mjs` 自己判）：
 *   用户指令是「切需要在 UI 让用户设定」。若评估器自己也判一遍，就出现**两个判定点**
 *   —— UI 存了 A、评估器读环境变量得出 B，而这种分叉**在读数上完全同形**
 *   （都只印一个通道名）。故判定与持久化只此一处，评估器与 UI 端点都消费同一函数。
 *
 * ⚠ **为什么不新建存储**：偏好落在 core 既有的 `user_model` 表（键值 + 历史行），
 *   即 `packages/user-model` 与 metacognition 已在用的那条面 ——
 *   本包**不建表、不签发 DDL**（见 `src/store.ts` 的数据面纪律）。
 *
 * ⚠ **本模块零 node 依赖**：不读 fs、不读 env；环境变量的读取由**调用方**注入为入参
 *   （评估器在 node 侧读），这样 UI 包对通道这件事既无副作用也可直测。
 */

/** 通道取值（与 `packages/jev` 的 `Config.channel` 同一套字面量：ollama=local）。 */
export const MODEL_CHANNELS = { local: 'local', cloud: 'cloud' } as const

/** 偏好落点：`user_model` 的键（用户设置优先于缺省，全仓唯一写者就是这里）。 */
export const CHANNEL_PREFERENCE_KEY = 'mana.eval.modelChannel'

/** 缺省通道 = **cloud**（用户指令原文「当前默认用云端」）。 */
export const CHANNEL_DEFAULT = MODEL_CHANNELS.cloud

/** 通道 → 路由形状（与 `packages/jev` 的 `Config` 逐字对应；**只做映射，不重复实现**）。 */
export const CHANNEL_ROUTES = {
  local: { jevChannel: 'ollama', base: 'http://127.0.0.1:11434', defaultModel: 'qwen3.5:0.8b' },
  cloud: { jevChannel: 'systemone', base: 'https://nano-gpt.com', defaultModel: 'jev-1.13' },
} as const

/** 通道来源（**必须可分辨**：用户设的与缺省兜底的在读数上不得同形）。 */
export const CHANNEL_SOURCES = { user: 'user', default: 'default', invalid: 'invalid-fallback' } as const

/** 可能取值的**可枚举**清单（UI 用它画选项，不硬编码第二份）。 */
export const CHANNEL_VALUES: readonly string[] = Object.values(MODEL_CHANNELS)

/** 判定读数：通道 + 模型 + 它从哪来 + 原始存储值（非法值不得静默吞掉）。 */
export interface ChannelResolution {
  readonly channel: string
  readonly model: string
  /** `user` = 用户在 UI 里设的；`default` = 没人设过；`invalid-fallback` = 存了非法值。 */
  readonly source: string
  /** 存储里的**原始**值（null = 没这个键；非法时原样回显，便于发现是存进去的什么）。 */
  readonly storedValue: string | null
  /** 模型名从哪来（`preference` = 用户连模型一起设了；`route-default` = 通道自带缺省）。 */
  readonly modelSource: string
}

/**
 * 通道解析（**纯函数**，无 IO ⇒ 可直接断言）。
 *
 * `stored` 为 `null` ⇒ 缺省（cloud）；为非法串 ⇒ 落缺省**且**把 `source` 标成
 * `invalid-fallback` + 原值回显 —— 静默吞掉非法值会让"存了什么"事后无从查。
 */
export function resolveChannel(stored: string | null | undefined): ChannelResolution {
  const raw = typeof stored === 'string' ? stored.trim() : ''
  if (raw === '') {
    const route = CHANNEL_ROUTES[CHANNEL_DEFAULT]
    return { channel: CHANNEL_DEFAULT, model: route.defaultModel, source: CHANNEL_SOURCES.default, storedValue: null, modelSource: 'route-default' }
  }
  const channel = CHANNEL_VALUES.includes(raw) ? raw : CHANNEL_DEFAULT
  const route = CHANNEL_ROUTES[channel as keyof typeof CHANNEL_ROUTES]
  return {
    channel,
    model: route.defaultModel,
    source: CHANNEL_VALUES.includes(raw) ? CHANNEL_SOURCES.user : CHANNEL_SOURCES.invalid,
    storedValue: raw,
    modelSource: 'route-default',
  }
}

/** 校验用户写入值；非法值**拒收**（返回 null），由调用方落显式降级而不是静默改缺省。 */
export function normalizeChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return CHANNEL_VALUES.includes(v) ? v : null
}

/** 写完后的回执（`ok:false` 带成因，禁 `catch { return null }`）。 */
export interface ChannelAck {
  readonly ok: boolean
  readonly channel: string
  readonly source: string
  readonly persisted: boolean
  readonly reason: string
}

/** 存储端口上的通道读写口（由 `src/store.ts` 适配 `user_model`）。 */
export interface ChannelPort {
  readChannel(): string | null
  writeChannel(value: string): void
}

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
export function registerPanels(wire: PanelWire, store: PanelStore, channels?: ChannelPort): void {
  wire.handle(METHODS.meta, () => ({
    panelId: PANEL_ID,
    methods: Object.values(METHODS),
    readLimitMax: READ_LIMIT_MAX,
  }))

  /**
   * **模型通道端点**（读 / 写）。用户指令的落点：「切需要在 UI 让用户设定」「当前默认用云端」。
   *
   * ⚠ 存储端口缺席（`channels === undefined`）时**不是**静默改成只读：读数里明确落
   *   `readOnly:true` + `source:'default'`，使「UI 写不进去」与「用户还没设过」可分辨。
   *   若静默吞掉，UI 上的选择框会照常显示选项却永远存不住 —— 那正是本仓最防的
   *   「看着能用、失败不可观测」。
   *
   * ⚠ 非法值**拒收**（`normalizeChannel` 返回 null ⇒ 落 `ok:false` + 可读 reason），
   *   **不**静默夹到缺省：悄悄改成 cloud 会让用户以为自己设的 local 生效了。
   */
  const readChannel = (): ChannelResolution & { readOnly: boolean } => {
    if (channels === undefined) return { ...resolveChannel(null), readOnly: true }
    try {
      return { ...resolveChannel(channels.readChannel()), readOnly: false }
    } catch (error) {
      // 读偏好失败同样显式：落缺省通道但把成因带出（不伪装成「用户没设过」）。
      const base = resolveChannel(null)
      return { ...base, readOnly: false, source: 'invalid-fallback', storedValue: error instanceof Error ? error.message : 'read-failed' }
    }
  }

  const channelState = () => ({
    ...readChannel(),
    values: CHANNEL_VALUES,
    default: CHANNEL_DEFAULT,
    key: CHANNEL_PREFERENCE_KEY,
  })
  const channelAck = (ok: boolean, persisted: boolean, reason: string) => ({
    ...channelState(),
    ok,
    persisted,
    reason,
  })

  wire.handle(METHODS.channel, (args: unknown) => {
    const a = asRecord(args)
    const write = a.channel
    // 无参 = 读（UI 装载时拉一次）。
    if (write === undefined) return channelState()
    if (channels === undefined) return channelAck(false, false, '通道写入端口未挂载（本次为只读）')
    const wanted = normalizeChannel(write)
    // 非法值拒收：回显原始输入，便于在 UI 上直接看到「你传了什么」。
    if (wanted === null) {
      return channelAck(false, false, '非法通道值（允许：' + CHANNEL_VALUES.join(' / ') + '），实测 ' + JSON.stringify(write))
    }
    try {
      channels.writeChannel(wanted)
      return channelAck(true, true, '')
    } catch (error) {
      return channelAck(false, false, error instanceof Error ? error.message : 'unknown channel write failure')
    }
  })

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
