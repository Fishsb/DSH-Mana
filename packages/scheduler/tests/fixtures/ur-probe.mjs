/**
 * `unhandledRejection` 探针 —— **独立的子进程**，不是 node:test 用例。
 *
 * 为什么必须是子进程（本席实测踩到，见 handoff 第 4 段）：
 *   node:test 在启动时就注册了 `process.on('unhandledRejection')` ⇒ 在测试进程内
 *   `process.listenerCount('unhandledRejection')` **恒 ≥ 1**，且它抢先把该事件记成
 *   `failureType: 'unhandledRejection'` 把**整个用例判红**。
 *   ⇒ 「计数从 0 变 1」在测试进程内**测不出来**；只有干净的子进程能量到真值。
 *
 * 输出：每行一个 JSON（父用例逐字解析，不做"看着像"判断）。
 */
import { Context } from '@deepseek-ai/cordis'

const listenersAtStart = process.listenerCount('unhandledRejection')
let count = 0
let lastMessage = null
process.on('unhandledRejection', (e) => {
  count += 1
  lastMessage = e instanceof Error ? e.message : String(e)
})

// ── 场景 A：**async** 监听器 + 用 emit 分发 waterfall 型事件（方案 §9.4 的原样写法）
const ctx = new Context()
ctx.on('probe/waterfall-async', async (_payload, next) => await next())
let syncErrorA = null
try {
  ctx.emit('probe/waterfall-async', {})
} catch (e) {
  syncErrorA = `${e.constructor.name}: ${e.message}`
}
await new Promise((r) => setTimeout(r, 50))
console.log(
  JSON.stringify({ state: 'after-emit-async', listenersAtStart, count, lastMessage, syncErrorA }),
)

// ── 场景 B：**同步**监听器 + 同一错误用法（对照：错误在调用方同步可见）
const c2 = new Context()
c2.on('probe/waterfall-sync', (_payload, next) => next())
let syncErrorB = null
try {
  c2.emit('probe/waterfall-sync', {})
} catch (e) {
  syncErrorB = `${e.constructor.name}: ${e.message}`
}
await new Promise((r) => setTimeout(r, 50))
console.log(JSON.stringify({ state: 'final', count, syncErrorB }))
