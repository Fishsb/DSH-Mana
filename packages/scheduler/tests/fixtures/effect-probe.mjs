/**
 * 「本包是否真在 agent/pre-step 链上」的公开面探针。
 *
 * 用 `fiber.getEffects()`（cordis **公开 API**，返回 effect 树：label + children）
 * 读本包注册的 effect 标签 —— **不碰任何私有字段**（`events._hooks` 是私有实现，
 * 拿它当判据会在 cordis 升版时静默失效）。
 *
 * ⚠ 为什么不能只靠"哨兵被走到"：哨兵只证明**链没断**，不证明**本包在链上**。
 *   本包若压根没注册监听器，哨兵照样被走到（实测：链路计数恒为 1）⇒ 假绿。
 *
 * 用法：node effect-probe.mjs <包目录名>
 * 输出：一行 JSON（父用例逐字解析）。
 */
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = process.argv[2]
const ROOT = new URL('../../../', import.meta.url) // packages/
const core = await import(new URL('core/src/index.ts', ROOT).href)
const mod = await import(new URL(`${dir}/src/index.ts`, ROOT).href)

const ctx = new Context()
ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-fx-')), 'mana.db') })
await new Promise((r) => setTimeout(r, 200))
const fiber = ctx.plugin(mod)
await new Promise((r) => setTimeout(r, 300))

/** effect 树里是否出现 pre-step 监听器（本包注册的那一条）。 */
const hasPreStep = (fib) =>
  (fib?.getEffects?.() ?? []).some((e) => String(e.label).includes('agent/pre-step'))

const withPkg = hasPreStep(fiber)
const labels = (fiber.getEffects() ?? []).map((e) => e.label)
await fiber.dispose()
await new Promise((r) => setTimeout(r, 250))
const afterUnload = hasPreStep(fiber)

console.log(JSON.stringify({ dir, plugin: mod.name, withPkg, afterUnload, labels }))
