/**
 * N2 生成通道判据：**`dsh-mana-llm` 与 `dsh-mana-prompts` 是否真被生产链路消费**。
 *
 * ── 为什么这条判据必须存在（它防的是什么）──────────────────────────────────────
 * 2026-09-26 实测：两包**各自提供整套能力却零生产调用点**（llm 的唯一引用在装配清单
 * `tools/r0-assembly-check.mjs:77`；prompts 零非自身引用）。这正是本仓最忌的形态 ——
 * **「实现完成」与「系统能跑」在报告层面同形**。故本判据不判「代码里有调用」，
 * 只判**真装配 + 真触发之后，库里有没有可指认的行**。
 *
 * ── 判据的骨架（每条都配负向）───────────────────────────────────────────────────
 *  ① **真装配**：core + 六链服务 + prompts + llm(+上游桩) + scheduler 全挂上，真 Loader 链路。
 *  ② **真触发**：`ctx.serial('agent/turn-stopping')` ⇒ 生成链落 `dispatched` + `settled` 两行。
 *  ③ **真消费**：settled 行的 `promptSection` 必须是 `§13.5`（**证明 system prompt 真来自
 *     prompts 包**，而不是本驱动者内联的一段字面量 —— 内联的话这里就是第二份真源）。
 *  ④ **负向 A（卸 llm）**：不挂 llm 包 ⇒ 必须落 `unassembled` 且 `assembled:false`。
 *  ⑤ **负向 B（卸 prompts）**：不挂 prompts 包 ⇒ 必须 `degraded='channel-unavailable'`，
 *     且 reason **点名**缺的是 `mana-prompts`（不能只说"失败了"）。
 *  ⑥ **负向 C（开关）**：`generationEnabled:false` ⇒ 落 `skipped` 且**零 dispatched 行**
 *     （证明开关有牙，且关掉不等于静默 —— 仍有一行带 reason 的 skipped）。
 *  ⑦ **三态可分辨**：素材为空 ⇒ `degraded='empty-material'`，**不得**与 channel-unavailable 同形。
 *  ⑧ **反证（卸载即净）**：卸载 scheduler 后同一触发**不再产生新行**。
 *
 * 运行（显式路径）：`node --test packages/scheduler/tests/generation-chain.test.mjs`
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const EXPECTED_CASES = 8
let ran = 0

const cleanups = []
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const DRIVER_PREFIX = 'mana-scheduler/chain'

/** 上游桩：兑现 'up' 路由，产出**可辨识**的文本（用来证明生成真到了上游）。 */
const UPSTREAM_TEXT = 'MANA-GEN-PROBE'
class UpstreamStub extends LlmAdapter {
  async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: UPSTREAM_TEXT }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: UPSTREAM_TEXT } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * 起一条**真**装配链。
 *
 * `withPrompts` / `withLlm` 两个开关是**负向判据的骨架**：它们让"少挂一个包"成为
 * 一次可复算的差分，而不是靠读代码猜。
 */
async function boot({ withPrompts = true, withLlm = true, generationEnabled = true, seed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-gen-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')

  const ctx = new Context()
  ctx.plugin(LlmRuntime)
  await settle(150)
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)

  if (withLlm) {
    ctx.get('llm').registerAdapter(['up'], new UpstreamStub())
    ctx.plugin(await load('llm'), { upstreamProvider: 'up', upstreamModel: 'stub-model' })
    await settle(200)
  }
  if (withPrompts) {
    ctx.plugin(await load('prompts'), {})
    await settle(150)
  }

  for (const [dirName, cfg] of [
    ['perception', {}],
    ['attention', {}],
    ['vector', { embedEnabled: false }],
    ['reconsolidation', {}],
    ['forgetting', {}],
    ['learning', {}],
    ['consolidation', {}],
  ]) {
    ctx.plugin(await load(dirName), cfg)
    await settle(100)
  }

  const core = ctx.get('mana-core')
  if (seed) {
    core.writeMemoryItem({ id: 'mem-gen-1', type: 'semantic', content: '生成通道判据的素材甲' })
    core.writeMemoryItem({ id: 'mem-gen-2', type: 'semantic', content: '生成通道判据的素材乙' })
  }

  const schedFiber = ctx.plugin(await load('scheduler'), {
    maxGoals: 64,
    maxCycles: 8,
    driverEnabled: true,
    generationEnabled,
    generationMaterialMaxChars: 4000,
  })
  await settle(300)
  return { ctx, store, core, schedFiber, dir }
}

/** 独立只读连接读 trace（不复用插件句柄 —— 卸载即净会把它关掉）。 */
function readTrace(store, eventType = null) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const sql =
      eventType === null
        ? 'SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace ORDER BY seq'
        : 'SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace WHERE event_type = ? ORDER BY seq'
    return eventType === null ? db.prepare(sql).all() : db.prepare(sql).all(eventType)
  } finally {
    db.close()
  }
}

/** 生成链在本会话的全部行（按 chain 字段认领）。 */
function genRows(store, sessionId) {
  return readTrace(store, `${DRIVER_PREFIX}/generation`)
    .filter((r) => r.session_id === sessionId)
    .map((r) => JSON.parse(r.payload ?? '{}'))
}

const fakeAgent = (sessionId) => ({ session: { id: sessionId } })

/** 触发一次回合边界（serial 型事件 ⇒ 必须 ctx.serial，与 chains-e2e 同口径）。 */
async function tick(ctx, sessionId, turn = 1) {
  await ctx.serial('agent/turn-stopping', { agent: fakeAgent(sessionId), turn })
  // 生成链是**异步收敛**的（不阻塞回合边界）⇒ 必须等它落 settled 行。
  for (let i = 0; i < 40; i += 1) {
    await settle(50)
  }
}

// ══ ① 真消费：生成链落 dispatched + settled 两行 ═══════════════════════════════
test('① 真消费：真装配后触发回合边界 ⇒ 生成链落 dispatched 与 settled 两行', async () => {
  ran += 1
  const { ctx, store } = await boot()
  await tick(ctx, 's-gen-1')
  const rows = genRows(store, 's-gen-1')
  const phases = rows.map((r) => r.phase)
  assert.ok(
    phases.includes('dispatched'),
    ' 必须有 dispatched 行（它是「已发起」的唯一证据）；实测 phase 序列=' + JSON.stringify(phases),
  )
  assert.ok(
    phases.includes('settled'),
    ' 必须有 settled 行（证明生成真回来了，而不是只发起就没了）；实测=' + JSON.stringify(phases),
  )
})

// ══ ② prompts 真被消费：promptSection 来自注册表 ═══════════════════════════════
test('② prompts 真被消费：settled 行的 promptSection 必须是 §13.5（不是内联字面量）', async () => {
  ran += 1
  const { ctx, store } = await boot()
  await tick(ctx, 's-gen-2')
  const settled = genRows(store, 's-gen-2').find((r) => r.phase === 'settled')
  assert.ok(settled, '未找到 settled 行')
  // ⚠ 两个小节号**都要说准**（本席初版曾把二者混为一谈，被本条判据当场抓住）：
  //   · `§13.5` = v10 的**链条**小节（深度睡眠 / 守藏集成）—— 本链在 v10 里的归属；
  //   · `§25.2` = v10 的 **Prompt 模板库**小节 —— `SLEEP_INDICTION_SYSTEM_PROMPT` 的**注册地**
  //     （见 packages/prompts/src/registry.ts:75）。
  //   本判据断的是**注册地**：该值只有真从注册表取到才会是 §25.2；驱动者若自己内联一段
  //   字面量当 system prompt，这里就会是 null 或另一个值。
  assert.equal(
    settled.promptSection,
    '§25.2',
    'promptSection 必须来自 mana-prompts 的注册表（PROMPT_REGISTRY 里 SLEEP_INDICTION_SYSTEM_PROMPT 的 section）；实测=' + String(settled.promptSection),
  )
})

// ══ ③ llm 真转发：生成内容真来自上游桩 ═══════════════════════════════════════
test('③ llm 真转发：summaryChars 必须等于上游桩产出长度（不是本地造的空串）', async () => {
  ran += 1
  const { ctx, store } = await boot()
  await tick(ctx, 's-gen-3')
  const settled = genRows(store, 's-gen-3').find((r) => r.phase === 'settled')
  assert.ok(settled, '未找到 settled 行')
  assert.equal(
    settled.summaryChars,
    UPSTREAM_TEXT.length,
    'summaryChars 必须等于上游桩的产出长度（证明内容真来自上游，而不是本地造块）；实测=' + String(settled.summaryChars),
  )
  assert.ok(
    typeof settled.callId === 'string' && settled.callId.length > 0,
    'settled 行必须带 callId（供审计回查是哪一次生成）；实测=' + String(settled.callId),
  )
})

// ══ ④ 负向 A：不挂 llm ⇒ channel-unavailable 且点名缺 llm ═════════════════════
test('④ 负向（不挂 llm）：必须 degraded=channel-unavailable 且 reason 点名 mana-llm', async () => {
  ran += 1
  const { ctx, store } = await boot({ withLlm: false })
  await tick(ctx, 's-gen-4')
  const failed = genRows(store, 's-gen-4').find((r) => r.phase === 'failed')
  assert.ok(failed, '不挂 llm 时必须落 failed 行（不得静默成功）；实测=' + JSON.stringify(genRows(store, 's-gen-4')))
  assert.equal(failed.degraded, 'channel-unavailable', '实测 degraded=' + String(failed.degraded))
  assert.ok(
    String(failed.reason).includes('mana-llm'),
    'reason 必须**点名**缺的是哪个服务（只说"失败了"不可定位）；实测=' + String(failed.reason),
  )
})

// ══ ⑤ 负向 B：挂 llm 但不挂 prompts ⇒ 仍必须失败且点名 mana-prompts ════════════
test('⑤ 负向（挂 llm 不挂 prompts）：必须失败且 reason 点名 mana-prompts', async () => {
  ran += 1
  const { ctx, store } = await boot({ withPrompts: false })
  await tick(ctx, 's-gen-5')
  const failed = genRows(store, 's-gen-5').find((r) => r.phase === 'failed')
  assert.ok(failed, '缺 prompts 时必须落 failed 行；实测=' + JSON.stringify(genRows(store, 's-gen-5')))
  assert.equal(failed.degraded, 'channel-unavailable', '实测 degraded=' + String(failed.degraded))
  assert.ok(
    String(failed.reason).includes('mana-prompts'),
    'reason 必须点名 mana-prompts（缺哪条腿要说清）；实测=' + String(failed.reason),
  )
})

// ══ ⑥ 负向 C：开关关 ⇒ 零 dispatched，但仍有一行 skipped（关掉不等于静默）═══════
test('⑥ 负向（generationEnabled=false）：零 dispatched 行，且必须有一行带 reason 的 skipped', async () => {
  ran += 1
  const { ctx, store } = await boot({ generationEnabled: false })
  await tick(ctx, 's-gen-6')
  const rows = genRows(store, 's-gen-6')
  const phases = rows.map((r) => r.phase)
  assert.ok(!phases.includes('dispatched'), '开关关着时不得有 dispatched 行；实测=' + JSON.stringify(phases))
  const skipped = rows.find((r) => r.phase === 'skipped')
  assert.ok(skipped, '开关关着时**必须**仍有 skipped 行（否则「关着」与「没跑」同形）')
  assert.equal(skipped.status, 'disabled', '实测 status=' + String(skipped.status))
  assert.ok(
    typeof skipped.reason === 'string' && skipped.reason.length > 0,
    'skipped 行必须带非空 reason（说明是开关事实，不是没有可归纳的内容）',
  )
})

// ══ ⑦ 三态可分辨：素材为空 ⇒ empty-material，与 channel-unavailable 不同名 ═════
test('⑦ 三态可分辨：库里无记忆时，degraded 必须是 empty-material 而不是 channel-unavailable', async () => {
  ran += 1
  const { ctx, store } = await boot({ seed: false })
  await tick(ctx, 's-gen-7')
  const failed = genRows(store, 's-gen-7').find((r) => r.phase === 'failed')
  assert.ok(failed, '空素材时必须落 failed 行；实测=' + JSON.stringify(genRows(store, 's-gen-7')))
  assert.equal(
    failed.degraded,
    'empty-material',
    '「素材为空」与「通道没装配」必须可分辨（同形即失败不可观测）；实测=' + String(failed.degraded),
  )
})

// ══ ⑧ 卸载即净：卸 scheduler ⇒ 同一触发零新行 ═════════════════════════════════
test('⑧ 反证（卸载即净）：卸载 scheduler 后同一触发不再产生新的 generation 行', async () => {
  ran += 1
  const { ctx, store, schedFiber } = await boot()
  await tick(ctx, 's-gen-8')
  const before = genRows(store, 's-gen-8').length
  assert.ok(before >= 2, '卸载前必须已有行（实测=' + String(before) + '）——否则本反证是空跑')
  schedFiber.dispose()
  await settle(200)
  await tick(ctx, 's-gen-8', 2)
  const after = genRows(store, 's-gen-8').length
  assert.equal(after, before, '卸载后不得新增 generation 行（实测 before=' + String(before) + ' after=' + String(after) + '）')
})

// ══ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1/pass 1 的假绿）═══
test('⑨ 用例计数自检', () => {
  assert.equal(ran, EXPECTED_CASES, `本文件声明 ${EXPECTED_CASES} 条用例，实跑 ${ran} 条 —— 数量不符说明有用例被删或被跳过`)
})
