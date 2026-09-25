/**
 * `dsh-mana-ui` **Client 半区**（浏览器侧，**单一产物**）。
 *
 * 三块面板（`册:589` B6.1）：激活值热力图 / 目标栈树 / 认知轨迹时间线。
 *
 * 半区纪律（A5-2）：本文件与其依赖**不得出现** node 的 fs / sqlite 模块名、
 * 以及进程环境变量前缀（对**产物** grep 三个模式须 0 命中）⇒ 这里没有一处 node 专有调用，
 * 需要宿主能力时一律经包内私有通道（`./host.ts`）代理。
 *
 * ⚠ **注释里也不得出现那三个字面量**：A5-2 grep 的是**产物字节**，源码注释会被原样带进产物
 * （本席实测：注释里写一次即命中 1）。故本文件用「node 的 fs / sqlite 模块名」这类措辞代指。
 */
import { METHODS, moduleRequire, resolveHost, __setRequire, type HostCaller } from './host.ts'

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

/** 回放面的一步（Host 侧 `ReplayStep` 的跨界镜像；两端各自声明，不共享 import）。 */
export interface ReplayStep {
  readonly seq: number
  readonly eventType: string
  readonly kind: string | null
  readonly at: string
  readonly state: Readonly<Record<string, string | number | boolean | null>>
}

/** 审计回放面（Host 侧 `ReplayFrame` 的跨界镜像）。 */
export interface ReplayFrame {
  readonly from: number | null
  readonly to: number | null
  readonly sessionId: string | null
  readonly steps: readonly ReplayStep[]
  readonly gaps: readonly (readonly number[])[]
  readonly unknownPayloads: number
  /** ⚠ 审计回放**恒为空数组**：非空即「这次回放要写库」= 状态回放，本半区会判它为降级。 */
  readonly scanTargets: readonly string[]
}

export interface PanelsSnapshot {
  readonly generatedAt: string
  readonly heatmap: readonly HeatCell[]
  readonly goalTree: readonly GoalNode[]
  readonly timeline: readonly TraceItem[]
  /** 认知轨迹的**审计回放**面（只读、可复现）；未取到时为 `null`（≠ 空回放）。 */
  readonly replay: ReplayFrame | null
  readonly degraded: boolean
  readonly reason: string
}

/** 渲染结果：面板数 + 落点回执（降级可枚举，不接受「看着渲染了」）。 */
export interface RenderReport {
  readonly panels: number
  readonly cells: number
  readonly treeNodes: number
  readonly timelineRows: number
  /** 审计回放窗口内的步数（0 = 无回放面或空窗口，与 `degraded` 合读可分辨）。 */
  readonly replaySteps: number
  readonly traceSeq: number
  readonly degraded: boolean
  readonly reason: string
}

/** Client 半区声明的服务（浏览器侧由宿主注入）。 */
export const inject: string[] = ['slots', 'connection']

// ── slots 装配面（结构性声明，不 import 渲染器包）────────────────────────────
//
// ⚠ 三种键都写成**导出常量**：它们是判据的可枚举断言面（测试直接引用，不复制字面量）。

/** 面板落位的槽键（`conversation.view` 是会话视图的标签页槽）。 */
export const SLOT_KEY = 'conversation.view'
/** 本面板在槽内的条目 id（与包名区分：id 是槽内唯一标识）。 */
export const SLOT_ID = 'mana-ui'
/** 槽内排序权重（数值小者靠前）。 */
export const SLOT_ORDER = 30

/** 组件树里每个面板容器的稳定标记（判据据此在产物树上找节点）。 */
export const PANEL_MARKS = {
  root: 'mana-ui',
  heatmap: 'heatmap',
  goalTree: 'goal-tree',
  timeline: 'timeline',
  replay: 'replay',
} as const

/**
 * 本半区认识的**回放模式**（与 Host 侧 `REPLAY_MODES` 逐字一致）。
 *
 * ⚠ 这里**只声明 audit 的用法**：`state` 是写回式回放（G10 复活旧状态），
 *   本半区**没有**触发它的入口，也没有对应的方法名 —— 声明它是为了让
 *   「审计回放收到的扫描面里出现了写目标」这条**可被判定**（见 `replay()` 的 degraded 分支）。
 */
export const REPLAY_MODES = {
  audit: 'audit-replay',
  state: 'state-replay',
} as const

/** 槽注册面（只取本半区用到的两个方法）。 */
export interface SlotsFace {
  /**
   * 等到该槽**被声明**再安装内容（声明未就绪时不注册，避免静默丢弃）。
   * 回调返回一个释放函数。
   */
  inject(key: string, callback: () => () => void): unknown
  /** 注册一个槽条目。 */
  register(spec: Record<string, unknown>, component: unknown): unknown
}

/** 装配结果：**可枚举字段**，不是「调用没抛错」就当作成功。 */
export interface MountResult {
  readonly registered: boolean
  readonly slot: string
  readonly id: string
  readonly order: number
  readonly reason: string
}

/** React 面（结构性声明；运行时由模块工厂提供，缺失即显式降级）。 */
interface ReactFace {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  useState?: (initial: unknown) => [unknown, (next: unknown) => void]
  useEffect?: (effect: () => undefined | (() => void), deps?: readonly unknown[]) => void
}

/** 空快照：首帧用；与「加载失败」由 `degraded`/`reason` 区分。 */
const EMPTY_SNAPSHOT: PanelsSnapshot = {
  generatedAt: '',
  heatmap: [],
  goalTree: [],
  timeline: [],
  replay: null,
  degraded: false,
  reason: '',
}

/** 纯函数：激活值映射到 0..1 色阶（不依赖 DOM，可直测）。 */
export function heatLevel(activation: number, min: number, max: number): number {
  if (!Number.isFinite(activation)) return 0
  if (max <= min) return 0.5
  const t = (activation - min) / (max - min)
  return Math.min(1, Math.max(0, t))
}

/** 纯函数：把扁平目标列表摊成树（按 `parentId` 归并，孤儿挂根）。 */
export function buildTree(nodes: readonly GoalNode[]): {
  roots: readonly string[]
  children: Readonly<Record<string, readonly string[]>>
} {
  const ids = new Set(nodes.map((n) => n.id))
  const children: Record<string, string[]> = {}
  const roots: string[] = []
  for (const n of nodes) {
    if (n.parentId !== null && ids.has(n.parentId)) {
      const bucket = children[n.parentId] ?? (children[n.parentId] = [])
      bucket.push(n.id)
    } else {
      roots.push(n.id)
    }
  }
  return { roots, children }
}

/** 空快照（通道不可达时用；与「真的没有数据」由 `degraded` 区分）。 */
function unreachable(reason: string): PanelsSnapshot {
  return { generatedAt: '', heatmap: [], goalTree: [], timeline: [], replay: null, degraded: true, reason }
}

/** 拉一次面板数据：**先探通道再调用**，探不到即降级，不抛错也不伪装成空数据。 */
export async function fetchPanels(ctx: unknown, limit: number): Promise<PanelsSnapshot> {
  const state = resolveHost(ctx)
  if (!state.ok) return unreachable(state.reason)
  let raw: PanelsSnapshot | undefined
  try {
    raw = (await state.host.call(METHODS.panels, { limit })) as PanelsSnapshot | undefined
  } catch (error) {
    // ⚠ 通道**在**、调用却失败（路由被撤 / 宿主异常）同样是「读不到」⇒ 必须落**显式降级**。
    //   抛给调用方会让整块面板白屏 = 失败不可观测（本席 R5 反证用例实测咬出来的真缺陷）。
    return unreachable(error instanceof Error ? error.message : 'host.call 抛出')
  }
  if (raw === undefined || raw === null) return unreachable('host.call 返回空')
  // 回放面**独立取数**（不让回放故障连带把三面板判成不可用）：取不到就落 null，
  // 渲染侧显式画「无回放面」，**不伪装成空回放**。
  let replayFrame: ReplayFrame | null = null
  try {
    const rep = await replay(ctx, { limit })
    replayFrame = rep.frame
  } catch {
    replayFrame = null
  }
  return { ...raw, replay: replayFrame }
}

/** 一次审计回放的取数结果：**决定论字段**（`degraded`/`reason` 与面板同源纪律）。 */
export interface ReplayReport {
  readonly frame: ReplayFrame | null
  readonly degraded: boolean
  readonly reason: string
}

/**
 * **审计回放**取数（只读）。
 *
 * ⚠ 三条纪律，逐条可断言：
 *  ① **只读**：本函数只发 `METHODS.replay`（读端），本半区**没有**写回方法名；
 *  ② 收到的帧若自报写目标（`scanTargets` 非空）⇒ **判降级并拒绝使用**，不静默接受
 *     —— 那正是「状态回放会复活旧状态」（G10）在消费侧的可见形态；
 *  ③ 回放面缺失（`null`/`undefined`）同样显式降级，**不伪装成「空回放」**。
 */
export async function replay(
  ctx: unknown,
  query: { limit?: number; fromSeq?: number; sessionId?: string } = {},
): Promise<ReplayReport> {
  const state = resolveHost(ctx)
  if (!state.ok) return { frame: null, degraded: true, reason: state.reason }
  let raw: ReplayFrame | undefined
  try {
    raw = (await state.host.call(METHODS.replay, query)) as ReplayFrame | undefined
  } catch (error) {
    return { frame: null, degraded: true, reason: error instanceof Error ? error.message : 'replay 取数失败' }
  }
  if (raw === undefined || raw === null) return { frame: null, degraded: true, reason: 'host.call 返回空' }
  const targets = Array.isArray(raw.scanTargets) ? raw.scanTargets : []
  if (targets.length > 0) {
    return {
      frame: null,
      degraded: true,
      reason: `审计回放自报写目标（${REPLAY_MODES.state} 形态）：${targets.join(', ')} —— 已拒绝`,
    }
  }
  return { frame: { ...raw, steps: Array.isArray(raw.steps) ? raw.steps : [] }, degraded: false, reason: '' }
}

// ── 渲染（纯函数，不依赖 DOM ⇒ 可确定性断言）────────────────────────────────

/** 热力图：每格一个元素，色阶进 style 面，原始值进 data 属性（判据可读）。 */
function renderHeatmap(React: ReactFace, cells: readonly HeatCell[]): unknown {
  const finite = cells.map((c) => c.activation).filter((a) => Number.isFinite(a))
  const max = finite.length > 0 ? Math.max(...finite) : 0
  const min = finite.length > 0 ? Math.min(...finite) : 0
  const children = cells.map((cell) =>
    React.createElement('div', {
      key: cell.memoryId,
      'data-cell': cell.memoryId,
      'data-activation': String(cell.activation),
      'data-level': String(heatLevel(cell.activation, min, max)),
    }),
  )
  return React.createElement(
    'section',
    { key: 'heatmap', 'data-panel': PANEL_MARKS.heatmap },
    React.createElement('h4', null, '激活值热力图'),
    cells.length === 0
      ? React.createElement('p', { 'data-empty': 'true' }, '无记忆项')
      : React.createElement('div', null, ...children),
  )
}

/** 目标栈树：按 `children` 递归，每层带 `data-depth`（判据据深度断言结构）。 */
function renderTreeLevel(
  React: ReactFace,
  byId: ReadonlyMap<string, GoalNode>,
  childrenOf: Readonly<Record<string, readonly string[]>>,
  ids: readonly string[],
  depth: number,
): unknown {
  return React.createElement(
    'ul',
    { key: `d${depth}`, 'data-depth': String(depth) },
    ...ids.map((id) => {
      const node = byId.get(id)
      const kids = childrenOf[id] ?? []
      return React.createElement(
        'li',
        { key: id, 'data-goal': id, 'data-status': node?.status ?? 'unknown' },
        node?.title ?? id,
        kids.length > 0 ? renderTreeLevel(React, byId, childrenOf, kids, depth + 1) : null,
      )
    }),
  )
}

function renderGoalTree(React: ReactFace, nodes: readonly GoalNode[]): unknown {
  const tree = buildTree(nodes)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return React.createElement(
    'section',
    { key: 'goal-tree', 'data-panel': PANEL_MARKS.goalTree },
    React.createElement('h4', null, '目标栈树'),
    nodes.length === 0
      ? React.createElement('p', { 'data-empty': 'true' }, '无目标')
      : renderTreeLevel(React, byId, tree.children, tree.roots, 0),
  )
}

function renderTimeline(React: ReactFace, items: readonly TraceItem[]): unknown {
  return React.createElement(
    'section',
    { key: 'timeline', 'data-panel': PANEL_MARKS.timeline },
    React.createElement('h4', null, '认知轨迹时间线'),
    items.length === 0
      ? React.createElement('p', { 'data-empty': 'true' }, '无轨迹')
      : React.createElement(
          'ol',
          null,
          ...items.map((t) =>
            React.createElement(
              'li',
              { key: String(t.seq), 'data-seq': String(t.seq), 'data-event': t.eventType },
              `${t.eventType} @ ${t.at}`,
            ),
          ),
        ),
  )
}

/**
 * **审计回放**面板：每步一行，`data-seq`/`data-kind` 可枚举，`data-mode` 标明是**只读**回放。
 *
 * ⚠ `data-mode` 只可能是 `audit-replay`：本渲染器**没有**状态回放的形态
 *   （那会写回记忆库、复活旧状态，G10）。两者在**渲染树上**也能分辨，不只是命名。
 */
function renderReplay(React: ReactFace, frame: ReplayFrame | null | undefined): unknown {
  // ⚠ 缺键（`undefined`）与显式 `null` 走同一分支：跨界数据缺键是**常态**
  //   （旧版 Host 不返回该字段），而 `frame.steps` 会在缺键时**抛错** ⇒ 面板整块白屏，
  //   正是本文件开头禁掉的「失败不可观测」。本行由既有 d2-③ 用例实测咬出来
  //   （快照字面量没有 replay 键 ⇒ TypeError），不是推测。
  if (frame === null || frame === undefined) {
    return React.createElement(
      'section',
      { key: 'replay', 'data-panel': PANEL_MARKS.replay, 'data-mode': REPLAY_MODES.audit },
      React.createElement('h4', null, '认知轨迹回放（审计·只读）'),
      React.createElement('p', { 'data-empty': 'true' }, '无回放面'),
    )
  }
  return React.createElement(
    'section',
    { key: 'replay', 'data-panel': PANEL_MARKS.replay, 'data-mode': REPLAY_MODES.audit },
    React.createElement('h4', null, '认知轨迹回放（审计·只读）'),
    frame.steps.length === 0
      ? React.createElement('p', { 'data-empty': 'true' }, '回放窗口为空')
      : React.createElement(
          'ol',
          null,
          ...frame.steps.map((s) =>
            React.createElement(
              'li',
              { key: String(s.seq), 'data-seq': String(s.seq), 'data-kind': s.kind ?? 'unclassified' },
              `${s.kind ?? '未归类'} @ seq ${s.seq}`,
            ),
          ),
        ),
  )
}

/**
 * 把一份快照渲染成元素树（**纯函数**：不吃 hooks、不碰 DOM ⇒ 可直测）。
 * 降级态渲染一条可读提示，而不是空白（失败必须可观测）。
 */
export function renderPanels(React: ReactFace, snapshot: PanelsSnapshot): unknown {
  return React.createElement(
    'section',
    {
      'data-panel': PANEL_MARKS.root,
      'data-degraded': String(snapshot.degraded),
      'data-reason': snapshot.reason,
    },
    React.createElement('header', null, 'Mana 认知面板'),
    snapshot.degraded
      ? React.createElement('p', { 'data-state': 'degraded' }, `数据不可用：${snapshot.reason}`)
      : null,
    renderHeatmap(React, snapshot.heatmap),
    renderGoalTree(React, snapshot.goalTree),
    renderTimeline(React, snapshot.timeline),
    renderReplay(React, snapshot.replay),
  )
}

/**
 * 造槽组件：首帧渲染空快照，装载后拉数据再渲染。
 *
 * ⚠ 组件**不抛错**：拉取失败会变成 `degraded:true` 的快照（可读），而不是白屏 —— 白屏是
 * 「失败不可观测」的典型形态。
 */
export function createPanelComponent(
  React: ReactFace,
  load: () => Promise<PanelsSnapshot>,
): () => unknown {
  return function ManaUiPanel(): unknown {
    const state = typeof React.useState === 'function' ? React.useState(EMPTY_SNAPSHOT) : undefined
    const snap = (state === undefined ? EMPTY_SNAPSHOT : state[0]) as PanelsSnapshot
    const setSnap = state === undefined ? undefined : state[1]
    if (typeof React.useEffect === 'function' && setSnap !== undefined) {
      React.useEffect(() => {
        let live = true
        // ⚠ 取数**抛错**时落降级快照（不是 unhandled rejection + 白屏）：与「读到了但降级」
        //   走同一形状，消费侧靠 `degraded`/`reason` 分辨。
        void load().then(
          (s) => {
            if (live) setSnap(s)
          },
          (error: unknown) => {
            if (live) {
              setSnap({
                generatedAt: '',
                heatmap: [],
                goalTree: [],
                timeline: [],
                replay: null,
                degraded: true,
                reason: error instanceof Error ? error.message : '取数抛出',
              })
            }
          },
        )
        return () => {
          live = false
        }
      }, [])
    }
    return renderPanels(React, snap)
  }
}

/** 取模块工厂里的 React；取不到即显式降级（不抛错、也不假装有）。 */
export function reactFace(): { ok: true; React: ReactFace } | { ok: false; reason: string } {
  const req = moduleRequire()
  if (req === undefined) return { ok: false, reason: '模块工厂不可达（无 require）' }
  try {
    const React = req('react') as ReactFace | undefined
    if (React === undefined || typeof React.createElement !== 'function') {
      return { ok: false, reason: 'react 未在模块表中（createElement 不可用）' }
    }
    return { ok: true, React }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'react 取用失败' }
  }
}

/**
 * 装配槽条目的**纯函数核心**：槽面与 React 面都由调用方给出。
 *
 * 这样判据可以拿**真槽机制**（宿主自带的 `SlotCore`）或**故意坏掉的槽面**来驱动，
 * 而不是只能对着 `ctx` 干瞪眼 —— 「能测到东西」优先于「接口好看」。
 *
 * 顺序（对齐 DSH 槽装配契约）：`slots.inject(key, cb)` 等声明就绪 → `cb` 内
 * `slots.register({name,id,order}, Component)` → 把返回的释放函数交回 inject 的 effect。
 */
export function mountPanelWith(
  slots: SlotsFace | undefined,
  React: ReactFace,
  load: () => Promise<PanelsSnapshot>,
): MountResult {
  const base = { slot: SLOT_KEY, id: SLOT_ID, order: SLOT_ORDER }
  if (slots === undefined || typeof slots.register !== 'function' || typeof slots.inject !== 'function') {
    return { ...base, registered: false, reason: 'slots 服务不可读（注入面未就绪）' }
  }
  const component = createPanelComponent(React, load)
  let registered = false
  try {
    slots.inject(SLOT_KEY, () => {
      const dispose = slots.register({ name: SLOT_KEY, id: SLOT_ID, order: SLOT_ORDER }, component)
      registered = true
      return typeof dispose === 'function' ? (dispose as () => void) : (): void => {}
    })
  } catch (error) {
    return { ...base, registered: false, reason: error instanceof Error ? error.message : '槽注册抛出' }
  }
  return { ...base, registered, reason: registered ? '' : '槽声明未就绪（inject 回调未执行）' }
}

/**
 * 从客户端上下文装配槽条目。
 *
 * ⚠ 槽面缺失或 React 缺失时**返回可读的 `registered:false` + reason**，不静默跳过。
 */
export function mountPanel(ctx: unknown): MountResult {
  const base = { slot: SLOT_KEY, id: SLOT_ID, order: SLOT_ORDER }
  if (typeof ctx !== 'object' || ctx === null) {
    return { ...base, registered: false, reason: '客户端上下文缺失' }
  }
  const slots = (ctx as { slots?: SlotsFace }).slots
  const face = reactFace()
  if (!face.ok) return { ...base, registered: false, reason: face.reason }
  return mountPanelWith(slots, face.React, () => fetchPanels(ctx, 32))
}

/**
 * Client 半区装载体：宿主调用一次 = 装配槽条目 + 渲染一次 + 一条 `ui/render` 落点。
 *
 * 两个动作**各自独立记账**：槽没注上不应连带把落点也丢掉（否则 R5 判据会被槽故障污染）。
 */
export async function apply(ctx: unknown): Promise<void> {
  __setRequire((globalThis as { __manaUiRequire?: unknown }).__manaUiRequire)
  const mounted = mountPanel(ctx)
  ;(globalThis as { __manaUiMount?: MountResult }).__manaUiMount = mounted
  const state = resolveHost(ctx)
  if (!state.ok) return
  await render({ ctx, limit: 32 })
}

/**
 * 渲染入口 + 落点回执。
 *
 * ⚠ 回执里的 `traceSeq` 是 **R5 反证判据**的唯一读数：卸载插件后它不再增长
 *   （同一触发不再产生新行）。
 */
export async function render(params: {
  ctx?: unknown
  limit?: number
  sessionId?: string
  turnId?: number
}): Promise<RenderReport> {
  const limit = params.limit ?? 32
  const ctx = params.ctx
  const snapshot = await fetchPanels(ctx, limit)
  const tree = buildTree(snapshot.goalTree)

  if (snapshot.degraded) {
    return {
      panels: 0,
      cells: 0,
      treeNodes: 0,
      timelineRows: 0,
      replaySteps: 0,
      traceSeq: -1,
      degraded: true,
      reason: snapshot.reason,
    }
  }

  const state = resolveHost(ctx)
  let traceSeq = -1
  let degraded = false
  let reason = ''
  if (state.ok) {
    try {
      const ack = (await state.host.call(METHODS.render, {
        panel: SLOT_ID,
        rendered:
          snapshot.heatmap.length +
          tree.roots.length +
          snapshot.timeline.length +
          (snapshot.replay?.steps.length ?? 0),
        sessionId: params.sessionId ?? '',
        turnId: params.turnId ?? 0,
      })) as { ok?: boolean; traceSeq?: number; degraded?: boolean; reason?: string } | undefined
      traceSeq = typeof ack?.traceSeq === 'number' ? ack.traceSeq : -1
      degraded = ack?.degraded === true || ack?.ok === false
      reason = typeof ack?.reason === 'string' ? ack.reason : ''
    } catch (error) {
      // 落点失败必须可读：UI 侧据此显示「落点不可用」，而不是静默当成成功。
      degraded = true
      reason = error instanceof Error ? error.message : 'render 落点失败'
    }
  }

  return {
    panels: 4,
    cells: snapshot.heatmap.length,
    treeNodes: snapshot.goalTree.length,
    timelineRows: snapshot.timeline.length,
    replaySteps: snapshot.replay?.steps.length ?? 0,
    traceSeq,
    degraded,
    reason,
  }
}
