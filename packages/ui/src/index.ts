/**
 * `dsh-mana-ui` **Host 入口**（唯一入口文件）。
 *
 * ⚠ **A5-4 / P-1 的体积纪律**：本文件只做「取服务 → 造适配器 → 装协议」三件事，
 *   面板逻辑在 `src/panel.ts`、存储适配在 `src/store.ts`。
 *
 * ⚠ **入口指向 `lib/`，不指向 `src/`**（`docs/contract/handoff-protocol.md` 装配面实测约定 #1）：
 *   宿主以 `node /usr/local/bin/dsh web` 启动、不带类型剥离开关 ⇒ `.ts` 入口装不上。
 *
 * ⚠ **`ctx.connection` 必须经 `ctx.inject(['connection'], …)` 取**（本仓实测）：
 *   直接读 `ctx.connection` 抛 `cannot get property "connection" without inject`，
 *   **整个 fiber 装载失败**（`state===3`），而表面只表现为「服务读不到」。
 *   宿主没有 connection 服务时该回调不执行 ⇒ 插件仍应正常装载（面板读路可用）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { ManaCoreService } from 'dsh-mana-core'
import { METHODS, registerPanels, type PanelStore, type PanelWire } from './panel.ts'
import { createPanelStore } from './store.ts'

export const name = 'mana-ui'

/** 依赖 core：三块面板的数据源与 `ui/render` 落点都来自它。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 单次读取的行数上限（不设无界读）。 */
  readLimit: number
  /** 是否允许客户端写 `ui/render` 落点（R5 判据依赖它为真）。 */
  renderTrace: boolean
}

/** 配置用裸缺省（不引 schemastery，避免入口被依赖面撑大）。 */
export const DEFAULT_CONFIG: Config = { readLimit: 32, renderTrace: true }

/** UI 服务面：让「面板装配了没有」成为可读事实，而不是靠产物存在自证。 */
export interface ManaUiService {
  readonly plugin: string
  readonly methods: readonly string[]
  status(): { plugin: string; wired: boolean; renderTrace: boolean; channel: boolean }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-ui': ManaUiService
  }
}

/** 连接服务的分包路由面（只取本插件需要的一个方法，避免入口拖入整包类型）。 */
interface RpcConnection {
  rpc: { handle(channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>): unknown }
}

export function apply(ctx: Context, config: Config = DEFAULT_CONFIG): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-ui: 缺少 mana-core 服务（inject 未满足）')

  const rendered = config.renderTrace !== false
  const store: PanelStore = createPanelStore(core.db)
  /** 方法名 → handler；通道挂载时统一分发（通道是**分包**的，不是一方法一通道）。 */
  const table = new Map<string, (args: unknown) => unknown | Promise<unknown>>()
  const wire: PanelWire = { handle: (method, handler) => table.set(method, handler) }
  registerPanels(rendered ? wire : { handle: (m, h) => { if (m !== METHODS.render) table.set(m, h) } }, store)

  let channel = false
  // 分包路由：`rpc.handle(channel, handler)` 收的是**整条通道**的分发函数。
  ctx.inject(['connection'], (cctx) => {
    const conn = (cctx as unknown as { connection?: RpcConnection }).connection
    if (conn === undefined) return
    const dispose = conn.rpc.handle('mana-ui', async (endpoint: string, payload: unknown) => {
      const handler = table.get(endpoint)
      if (handler === undefined) return { ok: false, error: { code: 'unknown_method', message: endpoint } }
      try {
        return { ok: true, value: await handler(payload) }
      } catch (error) {
        // 不走 `catch { return null }`（I-8）：错误必须带成因回到客户端。
        return {
          ok: false,
          error: { code: 'handler_failed', message: error instanceof Error ? error.message : 'unknown' },
        }
      }
    })
    channel = true
    if (typeof dispose === 'function') cctx.effect(() => () => void (dispose as () => unknown)(), 'mana-ui: rpc channel')
  })

  const service: ManaUiService = {
    plugin: name,
    methods: Object.values(METHODS),
    status: () => ({ plugin: name, wired: true, renderTrace: rendered, channel }),
  }

  ctx.effect(() => {
    const off = ctx.provide('mana-ui', service)
    return () => off()
  }, 'dsh-mana-ui: service')
}
