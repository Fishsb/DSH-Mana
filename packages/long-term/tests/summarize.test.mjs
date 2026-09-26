/**
 * v10 §12.1 第 ③ 步「摘要与标签（LLM）」判据 —— 证明 `memory_items.summary` **首次有生产写者**。
 *
 * ── 为什么这条判据必须存在 ────────────────────────────────────────────────────
 * 2026-09-26 实测：该列**建了**（schema 在册）、`writeMemoryItem` **支持**、
 * `core.recallLexical` **在读**（\`SELECT m.content, m.summary\`），
 * 而写侧**恒写 null** ⇒「列白建了」形态：**列是空的**与**这一步没跑**在库层面完全同形。
 * ⇒ 本判据不判"代码里有调用"，只判**真装配 + 真触发之后库里那一列有没有值**。
 *
 * ── 两个方向都判（只判一个方向会漏掉最坏的那种）────────────────────────────────
 *   · **正向**：装配了 llm+prompts 且上游正常 ⇒ summary **必须落进库**（否则本步是装饰）；
 *   · **负向**：缺腿 / 上游失败 / 空产出 ⇒ summary 为 null，但 `summarySkip` **必须点名原因**，
 *     且**照常落库**（摘要缺失不得阻断记忆写入 —— 那会把"少个优化"变成"丢数据"）。
 *
 * 运行：`node --test packages/long-term/tests/summarize.test.mjs`
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
/**
 * ⚠ **必须用仓内导出的 `coreSink`，不得自造写面桩**（本席第一版自造了一个
 *   `{ write }` 桩 ⇒ `sink.isRetired is not a function` 崩在 write-gate.ts:411）。
 *   自造桩会漂：`WriteGateSink` 的成员一变，桩就落后 —— 而落后表现为**崩或假绿**，
 *   两者都比"直接用真源"坏。故此处 import 生产同款的 sink 构造器。
 */
const { coreSink } = await load('long-term')
const EXPECTED_CASES = 7
let ran = 0

const cleanups = []
after(() => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }) })
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/** 上游桩：产出**可辨识**的摘要文本。 */
const SUMMARY_TEXT = '这是上游产出的摘要文本'
class UpstreamStub extends LlmAdapter {
  async *stream() {
    yield { type: 'text-delta', index: 0, text: SUMMARY_TEXT }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
/** 会失败的桩：产出一个 error finish（宿主归一，不抛）。 */
class FailingStub extends LlmAdapter {
  async *stream() {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'PROBE_FAIL', message: '桩故意失败' } } }
  }
}
/** 产出空串的桩（第三种事实）。 */
class EmptyStub extends LlmAdapter {
  async *stream() {
    yield { type: 'text-delta', index: 0, text: '' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * 真装配：core + long-term（Write Gate 挂在 mana/observation 上）+ 可选 llm/prompts。
 * ⚠ `prefilterEnabled:false`：本判据测的是**摘要步**，不是预过滤 —— 用短文本会被预过滤挡下
 *   （那是另一件事，见 write-gate.test.mjs）。
 */
async function boot({ withLlm = true, stub = 'ok', withPrompts = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-sum-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const ctx = new Context()
  ctx.plugin(LlmRuntime)
  await settle(150)
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)
  if (withLlm) {
    ctx.get('llm').registerAdapter(['up'], stub === 'fail' ? new FailingStub() : stub === 'empty' ? new EmptyStub() : new UpstreamStub())
    ctx.plugin(await load('llm'), { upstreamProvider: 'up', upstreamModel: 'stub-model' })
    await settle(200)
  }
  if (withPrompts) {
    ctx.plugin(await load('prompts'), {})
    await settle(150)
  }
  ctx.plugin(await load('long-term'), {})
  await settle(250)
  const core = ctx.get('mana-core')
  return { ctx, store, core }
}

const obsOf = (content, i = 1) => ({
  sessionId: 's-sum',
  turnId: i,
  requestId: 'r-sum-' + String(i),
  at: new Date().toISOString(),
  content,
  source: 'test',
})

/** 直接调服务面 writeGate（与事件监听器同一条 runGate）；写面用**生产同款** coreSink。 */
async function writeOne(booted, content, i = 1) {
  const lt = booted.ctx.get('mana-long-term')
  return lt.writeGate(booted.core.db, coreSink(booted.core), obsOf(content, i), { prefilterEnabled: false })
}

const readSummary = (store, id) => {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db.prepare('SELECT content, summary FROM memory_items WHERE id = ?').get(id)
  } finally { db.close() }
}

// ══ ① 正向：摘要真落进库 ═════════════════════════════════════════════════════
test('① 正向：装配 llm+prompts 且上游正常 ⇒ memory_items.summary **真落进库**', async () => {
  ran += 1
  const b = await boot()
  const out = await writeOne(b, '这条观察值得长期记住吗：摘要与标签这一步必须真落库')
  assert.equal(out.wroteRow, true, '必须真落库；实测=' + JSON.stringify(out))
  assert.equal(out.summaryWritten, true, 'summaryWritten 必须为 true；实测 skip=' + String(out.summarySkip) + ' reason=' + String(out.summaryReason))
  const row = readSummary(b.store, out.memoryId)
  assert.ok(row, '库里必须查到该行')
  assert.equal(row.summary, SUMMARY_TEXT, '库里 summary 列必须等于上游产出；实测=' + String(row.summary))
})

// ══ ② 反向对照：没有本步时该列是 null（证明判据有靶）════════════════════════
test('② 反向对照：summarizeEnabled=false ⇒ summary 为 null 且 skip=disabled（可分辨）', async () => {
  ran += 1
  const b = await boot()
  const lt = b.ctx.get('mana-long-term')
  const out = await lt.writeGate(b.core.db, coreSink(b.core), obsOf('这条观察值得长期记住吗：关掉摘要步'), { prefilterEnabled: false, summarizeEnabled: false })
  assert.equal(out.wroteRow, true, '**关掉摘要步也必须照常落库**（不得因少个优化而丢数据）')
  assert.equal(out.summaryWritten, false, '未生成时必须如实为 false')
  assert.equal(out.summarySkip, 'disabled', '必须点名 disabled（不是"生成失败"）；实测=' + String(out.summarySkip))
  const row = readSummary(b.store, out.memoryId)
  assert.equal(row.summary, null, '库里该列必须为 null')
})

// ══ ③ 缺腿降级：不装配 llm ⇒ no-channel，且不阻断落库 ═══════════════════════
test('③ 缺腿：未装配 llm ⇒ skip=no-channel，**照常落库**（摘要缺失不阻断记忆写入）', async () => {
  ran += 1
  const b = await boot({ withLlm: false })
  const out = await writeOne(b, '这条观察值得长期记住吗：缺 llm 腿时')
  assert.equal(out.wroteRow, true, '缺腿时**仍须落库**（否则本步会把"少个优化"变成"丢数据"）')
  assert.equal(out.summaryWritten, false)
  assert.equal(out.summarySkip, 'no-channel', '实测=' + String(out.summarySkip))
  assert.ok(typeof out.summaryReason === 'string' && out.summaryReason.length > 0, '必须带非空 reason')
})

// ══ ④ 缺 prompts 腿 ⇒ 同样 no-channel（两腿缺一即不可用）═════════════════════
test('④ 缺 prompts 腿：skip=no-channel（两腿缺一即整体不可用，不half-work）', async () => {
  ran += 1
  const b = await boot({ withPrompts: false })
  const out = await writeOne(b, '这条观察值得长期记住吗：缺 prompts 腿时')
  assert.equal(out.wroteRow, true, '仍须落库')
  assert.equal(out.summarySkip, 'no-channel', '实测=' + String(out.summarySkip))
  assert.ok(String(out.summaryReason).includes('prompts'), 'reason 必须点名缺的是 prompts；实测=' + String(out.summaryReason))
})

// ══ ⑤ 上游失败 ⇒ generate-failed（**不是** no-channel，二者必须可分辨）════════
test('⑤ 上游失败：skip=generate-failed 且 reason 带上游归类（与缺腿不同名）', async () => {
  ran += 1
  const b = await boot({ stub: 'fail' })
  const out = await writeOne(b, '这条观察值得长期记住吗：上游失败时')
  assert.equal(out.wroteRow, true, '上游失败也必须落库（判定已通过 ⇒ 记忆该记）')
  assert.equal(out.summarySkip, 'generate-failed', '实测=' + String(out.summarySkip))
  assert.ok(String(out.summaryReason).includes('host-error-finish') || String(out.summaryReason).includes('上游生成失败'), 'reason 必须带上游归类；实测=' + String(out.summaryReason))
  assert.notEqual(out.summarySkip, 'no-channel', '"上游坏了"与"没装"不得同名')
})

// ══ ⑥ 上游产出空串 ⇒ empty-summary（第三种事实）═════════════════════════════
test('⑥ 上游空产出：skip=empty-summary（既非失败也非有效摘要，独立归类）', async () => {
  ran += 1
  const b = await boot({ stub: 'empty' })
  const out = await writeOne(b, '这条观察值得长期记住吗：上游产出空串时')
  assert.equal(out.summarySkip, 'empty-summary', '实测=' + String(out.summarySkip))
  assert.equal(out.summaryWritten, false, '空串不得算作"写了摘要"')
  assert.notEqual(out.summarySkip, 'generate-failed', '"产出空"与"调用失败"不得同名')
})

// ══ ⑦ 用例计数自检（防本文件被截断）══════════════════════════════════════════
test('⑦ 用例计数自检', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本文件声明 ${EXPECTED_CASES} 条用例，实跑 ${ran} 条`)
})
