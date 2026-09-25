/**
 * Client ↔ Host 的**包内私有通道**（本半区唯一的出口）。
 *
 * 纪律（`册:589` B6.1）：
 *   · 只有**无损 JSON** 可跨界；
 *   · 本文件**不得** import 任何 node 专有模块（node 的 fs / sqlite 模块、以及进程环境变量
 *     （A5-2 的三个 grep 模式），对**产物**命中须为 0）；
 *   · 通道取不到时**显式不可用**（`{ok:false, reason}`），不 try/catch 吞成 undefined
 *     —— 那正是 `docs/contract/degradation.md` 禁掉的形态。
 *
 * ⚠ **为什么不 import `PanelWire` 类型**：源码内 `.ts` 后缀引用会让打包器把 Host 半区的
 *   `panel.ts` 一并卷进 client 产物（实测：sqlite 的 require 落入 client bundle
 *   ⇒ A5-2 命中 10）。故两端**各自声明**协议字面量，产物保持单件独立。
 */

/** 协议方法名（与 Host 侧 `panel.ts` 的 `METHODS` 逐字一致；两端各自声明是刻意的）。 */
export const METHODS = {
  panels: 'mana-ui/panels',
  render: 'mana-ui/render',
  meta: 'mana-ui/meta',
  /**
   * **审计回放**（只读；`册:629` A5-3）。
   *
   * ⚠ 与「状态回放」（`方案:904` 的「重启后从 `mana_trace` 回放」⇒ G10 复活旧状态）
   *   **不是同一件事**：状态回放会**写回**记忆库，本半区**没有**它的方法名 ——
   *   不是"暂时没调"，是**协议面上不存在**。分流对照表见 Host 侧 `src/replay.ts`。
   */
  replay: 'mana-ui/replay',
} as const

/** Host 侧 `host.call` 的最小面（结构性声明，不 import 任何包）。 */
export interface HostCaller {
  call(method: string, args: unknown): Promise<unknown>
}

/** 通道状态：探不到就显式不可用（可读事实，不是静默失败）。 */
export type WireState =
  | { readonly ok: true; readonly host: HostCaller; readonly via: 'injected' | 'connection' }
  | { readonly ok: false; readonly reason: string }

/** 模块工厂注入进来的 `require`（浏览器侧由 `window.__ModuleLoader__` 提供）。 */
let factoryRequire: ((id: string) => unknown) | undefined
/** 让产物壳把 factory 参数交进来（浏览器侧唯一的模块解析通道）。 */
export function __setRequire(fn: unknown): void {
  factoryRequire = typeof fn === 'function' ? (fn as (id: string) => unknown) : undefined
}

/** 取模块工厂；纯静态页取不到 ⇒ 返回 `undefined`（由调用方落降级）。 */
export function moduleRequire(): ((id: string) => unknown) | undefined {
  if (factoryRequire !== undefined) return factoryRequire
  const g = globalThis as { require?: unknown }
  return typeof g.require === 'function' ? (g.require as (id: string) => unknown) : undefined
}

function asCaller(candidate: unknown): HostCaller | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const call = (candidate as { call?: unknown }).call
  if (typeof call !== 'function') return undefined
  return candidate as HostCaller
}

/**
 * 从客户端上下文解析包内私有通道，**按固定顺序**（顺序本身是可断言的）：
 *  ① 宿主直接注入的 `host`（`harness.handle` 的对端）；
 *  ② `ctx.connection.rpc.call` 的包内前缀适配器；
 *  ③ 都没有 ⇒ `{ok:false, reason}`。
 */
export function resolveHost(ctx: unknown): WireState {
  if (typeof ctx !== 'object' || ctx === null) return { ok: false, reason: '客户端上下文缺失' }
  const c = ctx as { host?: unknown; connection?: unknown }
  const direct = asCaller(c.host)
  if (direct !== undefined) return { ok: true, host: direct, via: 'injected' }

  const conn = c.connection as { rpc?: { call?: unknown } } | undefined
  const rpcCall = conn?.rpc?.call
  if (typeof rpcCall === 'function') {
    const bound = rpcCall as (channel: string, method: string, args: unknown) => Promise<unknown>
    return {
      ok: true,
      via: 'connection',
      host: {
        call: (method: string, args: unknown) => bound('mana-ui', method, args),
      },
    }
  }
  return { ok: false, reason: 'host.call 未提供（包内私有通道不可达）' }
}
