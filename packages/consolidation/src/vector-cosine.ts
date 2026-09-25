/**
 * 余弦通道：**复用** `dsh-mana-vector` 的实现，本包**不另写一份**。
 *
 * ── 为什么走运行时定位而不是 `import`（三条路实测，取唯一同时满足的）────────────────
 * 判据纪律要求「相似度口径复用 `packages/vector` 的 `cosine`」。实测三条路：
 *   · **V1/V2** `import { cosine } from '../../vector/lib/cosine.js'` —— `tsc` 报
 *     `TS7016 Could not find a declaration file`（vector 的 `exports` 只暴露 `.`，
 *     类型在 `lib/types/` 而运行时在 `lib/`，两个目录**不可能同路径**）⇒ 要么加 ambient
 *     声明（实测**无效**，TS 的 ambient 匹配不到相对模块）或者走 `skipLibCheck` 类放宽 ⇒ 否决。
 *   · **V3** `import ... from '../../vector/src/cosine.ts'` —— `tsc` 报 `TS2307`，且产物里留下
 *     `require('../../vector/src/cosine.js')`（`rewriteRelativeImportExtensions` 把 .ts 改写成 .js，
 *     而 src 下只有 .ts）⇒ **运行时 MODULE_NOT_FOUND**。否决。
 *   · **V5/V6** 本文件：类型不 import、运行时按路径 require ⇒ typecheck**不解析该路径**（这条路
 *     走通的前提），运行时解析到**同一个 `lib/cosine.js` 文件对象**（实测
 *     `require(p).cosine === (await import(p)).cosine` → true）⇒ 满足「同一份实现」。
 *
 * ⚠ `createRequire` 而非动态 `import()`：这里必须是**同步**的（`cosine` 是纯函数，
 *   不能把每个调用点都染成 async）。Node 22 的 `require(esm)` 已实测可加载该
 *   `"type":"module"` 包的产物（本仓 2026-09-25 实测，见 handoff §判据）。
 *
 * ⚠ **解析失败不得静默回落**：本函数返回**显式三态**（`ok/reason/source`），调用方必须
 *   把失败落成 degraded 并**拒绝执行合并** —— 否则余弦恒 0 会把「全都正交」伪装成正常结果，
 *   合并数变 0 而看不出原因（本仓最防的「不可分辨」形态）。故**不提供** 0 兜底的 `cosine()`。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 与 `packages/vector/src/cosine.ts` 的签名逐字一致（口径复用的**契约面**）。 */
export type CosineFn = (a: ArrayLike<number>, b: ArrayLike<number>) => number

/** 解析结果：**三态**而不是「有/没有」——`ok=false` 时必须带非空 `reason`（G8）。 */
export type CosineResolution =
  | { readonly ok: true; readonly cosine: CosineFn; readonly source: string; readonly via: 'package-resolve' | 'relative' }
  | { readonly ok: false; readonly cosine: null; readonly source: string; readonly reason: string }

export interface CosineRoute {
  /** 覆盖入口解析：传 `dsh-mana-vector` 包名（缺省）或任意 specifier（测试用它造失败路径）。 */
  readonly specifier?: string
}

/** 本包对 vector 的**唯一**运行时引用点（改这里 = 改全包口径）。 */
export function resolveVectorCosine(route: CosineRoute = {}): CosineResolution {
  const specifier = route.specifier ?? 'dsh-mana-vector'
  let entryUrl: string
  try {
    entryUrl = import.meta.resolve(specifier)
  } catch (error) {
    // 相对 specifier 覆盖（测试路径）：按本模块所在目录解析，失败也要说清是哪种失败。
    try {
      entryUrl = new URL(specifier, import.meta.url).href
    } catch {
      return {
        ok: false,
        cosine: null,
        source: specifier,
        reason: `入口解析失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  const source = join(dirname(fileURLToPath(entryUrl)), 'cosine.js')
  try {
    const req = createRequire(import.meta.url)
    const mod = req(source) as { cosine?: unknown }
    if (typeof mod.cosine !== 'function') {
      return { ok: false, cosine: null, source, reason: `${source} 未导出函数 cosine（实际 ${typeof mod.cosine}）` }
    }
    return { ok: true, cosine: mod.cosine as CosineFn, source, via: route.specifier ? 'relative' : 'package-resolve' }
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'ERR'
    return { ok: false, cosine: null, source, reason: `加载 ${source} 失败（${code}）：${(error as Error).message}` }
  }
}

/** 本包依赖的 vector **包名**（`inject` 里**不声明**它 —— 依赖方向订正见 `index.ts` 文件头）。 */
export const VECTOR_PACKAGE = 'dsh-mana-vector' as const
