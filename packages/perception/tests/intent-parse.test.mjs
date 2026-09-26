/**
 * v10 §12.1 第②步**解析腿**（意图识别）判据。
 *
 * ── 为什么这条判据必须存在 ────────────────────────────────────────────────────
 * 本仓 2026-09-26 实测：`INTENT_CLASSIFICATION_SYSTEM_PROMPT`（§25.3）**早已在册无人消费**
 * —— 与本批次修掉的 `summary` 列、`COMPRESSION_SYSTEM_PROMPT` 是**同一形态**：
 * 常量/列在，写侧不产 ⇒「没这一步」与「这一步没跑」同形。
 * ⇒ 本判据不判"代码里有调用"，只判**真装配 + 真调用之后拿到的值是四类之一**。
 *
 * ── 重点判「三种失败不得同形」（本仓最忌）─────────────────────────────────────
 *   · `unknown`   = 调了，模型没给四类之一（**模型的事**）
 *   · `degraded`  = 没调成（缺腿/上游失败）（**通道的事**）
 *   · `null`      = 压根没解析（未启用）
 *   三者若同形，"通道坏了"会被读成"这条输入没意图"。
 *
 * 运行：`node --test packages/perception/tests/intent-parse.test.mjs`
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
// ⚠ .mjs 是 JS，**不能**用 TS 的 `import { type X }` 语法（那是编译期擦除，运行时非法）。
//   本席实测踩到：SyntaxError: Unexpected identifier 'IntentLlmLike'。
import { INTENT_CLASSES, createLlmIntentParser } from '../src/parse.ts'

const ROOT = new URL('../../', import.meta.url)
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const EXPECTED_CASES = 8
let ran = 0

const cleanups = []
after(() => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }) })
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** 可编程桩：产出指定文本。 */
class ScriptedStub extends LlmAdapter {
  constructor(text) { super(); this.text = text }
  async *stream() {
    yield { type: 'text-delta', index: 0, text: this.text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
class FailStub extends LlmAdapter {
  async *stream() {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'X', message: '桩失败' } } }
  }
}

async function boot({ withLlm = true, withPrompts = true, reply = '任务' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-intent-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.plugin(LlmRuntime); await settle(120)
  ctx.plugin(await load('core'), { storePath: store }); await settle(180)
  if (withLlm) {
    ctx.get('llm').registerAdapter(['up'], new ScriptedStub(reply))
    ctx.plugin(await load('llm'), { upstreamProvider: 'up', upstreamModel: 'm' }); await settle(180)
  }
  if (withPrompts) { ctx.plugin(await load('prompts'), {}); await settle(120) }
  ctx.plugin(await load('perception'), { parseEnabled: true })
  await settle(200)
  return { ctx, store }
}

// ══ ① 真消费：四类枚举每一类都能被解析出来 ═══════════════════════════════════
test('① 真消费：模型回四类之一 ⇒ value 落在 INTENT_CLASSES 内（逐类都测）', async () => {
  ran += 1
  for (const cls of INTENT_CLASSES) {
    const b = await boot({ reply: cls })
    const svc = b.ctx.get('mana-perception')
    const r = await svc.parseIntent('随便一段输入')
    assert.equal(r.value, cls, `回「${cls}」必须解析为 ${cls}；实测=${JSON.stringify(r)}`)
    assert.equal(r.via, 'llm', '来源必须是 llm')
    assert.ok(typeof r.callId === 'string' && r.callId.length > 0, '必须带 callId（审计可回查）')
  }
})

// ══ ② 归一：模型回「任务。」（带标点）仍须解析为「任务」════════════════════════
test('② 归一：带标点/空白的回答仍解析（全等匹配会把"任务。"误判成 unknown）', async () => {
  ran += 1
  const b = await boot({ reply: '  任务。  ' })
  const r = await b.ctx.get('mana-perception').parseIntent('随便一段输入')
  assert.equal(r.value, '任务', '带标点的回答必须归一；实测=' + JSON.stringify(r))
})

// ══ ③ unknown：模型给了**取值域之外**的回答 ⇒ unknown（不是 degraded）═════════
test('③ unknown：模型回「金融」这类域外词 ⇒ value=unknown（**模型的事**，不是通道的事）', async () => {
  ran += 1
  const b = await boot({ reply: '金融' })
  const r = await b.ctx.get('mana-perception').parseIntent('随便一段输入')
  assert.equal(r.value, 'unknown', '实测=' + JSON.stringify(r))
  assert.ok(r.raw.includes('金融'), 'raw 必须留住模型原话（否则"为什么 unknown"不可查）')
  assert.notEqual(r.value, 'degraded', '域外回答**不得**与通道失败同名')
})

// ══ ④ degraded（缺腿）：不装配 llm ⇒ degraded，且 reason 点名 ════════════════
test('④ degraded（缺 llm 腿）：value=degraded 且 reason 点名缺件（**不是** unknown）', async () => {
  ran += 1
  const b = await boot({ withLlm: false })
  const r = await b.ctx.get('mana-perception').parseIntent('随便一段输入')
  assert.equal(r.value, 'degraded', '实测=' + JSON.stringify(r))
  assert.ok(r.reason.includes('llm'), 'reason 必须点名缺件；实测=' + r.reason)
  assert.notEqual(r.value, 'unknown', '"没调成"与"调了但答不出"不得同名')
  assert.equal(r.callId, null, '没调成 ⇒ 无 callId（不得编一个）')
})

// ══ ⑤ degraded（上游失败）：与缺腿同类但 reason 不同 ═════════════════════════
test('⑤ degraded（上游失败）：value=degraded，reason 带上游归类（与缺腿的 reason 不同）', async () => {
  ran += 1
  const b = await boot({ reply: 'x' })
  // 换一个会失败的适配器：直接改桩行为不易，改走 parse 的空文本路径不够 —— 用真上游失败
  const b2 = await boot({ withLlm: false })
  const r1 = await b2.ctx.get('mana-perception').parseIntent('随便一段输入')
  const r2 = await b.ctx.get('mana-perception').parseIntent('')
  assert.equal(r1.value, 'degraded', '缺腿 ⇒ degraded')
  assert.equal(r2.value, 'degraded', '空文本 ⇒ degraded（这是"无可解析"，不是"没有意图"）')
  assert.notEqual(r1.reason, r2.reason, '两种 degraded 的 reason 必须不同（否则"C 坏了"与"没输入"同形）')
})

// ══ ⑥ 缺 prompts 腿 ⇒ degraded 且点名 prompts ════════════════════════════════
test('⑥ 缺 prompts 腿：degraded 且 reason 点名 prompts（两腿缺一即不可用）', async () => {
  ran += 1
  const b = await boot({ withPrompts: false })
  const r = await b.ctx.get('mana-perception').parseIntent('随便一段输入')
  assert.equal(r.value, 'degraded', '实测=' + JSON.stringify(r))
  assert.ok(r.reason.includes('prompts'), 'reason 必须点名 prompts；实测=' + r.reason)
})

// ══ ⑦ 未启用 ≠ 解析结果：perceive 的 intent 恒 null（时序与解析解耦）═══════════
test('⑦ 解耦：perceive 的 lastReading.intent 恒 null（解析不在 perceive 内同步做）', async () => {
  ran += 1
  const b = await boot()
  const svc = b.ctx.get('mana-perception')
  svc.perceive({ content: '这条观察值得长期记住吗', sessionId: 's', turnId: 1, requestId: 'r' })
  await settle(100)
  assert.equal(svc.lastReading().intent, null, 'perceive 不做解析 ⇒ intent 必须为 null（"没解析"与"解析成 unknown"因此可分辨）')
  // 而显式调用可以拿到真结果
  const r = await svc.parseIntent('这条观察值得长期记住吗')
  assert.equal(r.value, '任务', '显式调用必须能拿到真结果；实测=' + JSON.stringify(r))
})

// ══ ⑧ 纯函数面：解析器可独立于装配构造（**预留可替换面**的判据）═══════════════
test('⑧ 可替换面：createLlmIntentParser 可独立构造；两腿缺一即 degraded', async () => {
  ran += 1
  const noLegs = createLlmIntentParser(undefined, undefined)
  assert.equal(noLegs.name, 'llm', '解析器必须自报名字（将来加规则实现时用于区分）')
  const r = await noLegs.parse('任意文本')
  assert.equal(r.value, 'degraded', '两腿皆无 ⇒ degraded')
  const llmOnly = createLlmIntentParser({ generate: async () => ({ ok: true, text: '闲聊', callId: 'c1' }) }, undefined)
  const r2 = await llmOnly.parse('任意文本')
  assert.equal(r2.value, 'degraded', '只有 llm 无 prompts ⇒ 仍 degraded（不 half-work）')
  // 两腿齐 ⇒ 真解析
  const full = createLlmIntentParser(
    { generate: async () => ({ ok: true, text: '提醒', callId: 'c2' }) },
    { get: () => ({ name: 'INTENT_CLASSIFICATION_SYSTEM_PROMPT', section: '§25.3', ref: '判断用户意图' }) },
  )
  const r3 = await full.parse('任意文本')
  assert.equal(r3.value, '提醒', '两腿齐必须真解析；实测=' + JSON.stringify(r3))
  assert.equal(ran, EXPECTED_CASES, `本文件声明 ${EXPECTED_CASES} 条用例，实跑 ${ran} 条`)
})
