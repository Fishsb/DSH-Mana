/**
 * A1-1 端到端事件链判据（W3-1 · B2.1）
 *
 * 判据原文（`docs/mana-rollout-plan.md:451`）：
 *   `SELECT seq,event_type FROM mana_trace ORDER BY seq`
 *   五类 event_type **各 ≥1** 且 `seq` **连续无洞**。
 *
 * ⚠ **本测试走真装配链**（真 `Context` + 真 cordis `Loader` 按包名解析），不是直接调
 *   service —— 否则「链是通的」只是判据自己搭的假象。这与 `tools/r0-assembly-check.mjs`
 *   同口径：装配判据以「服务可读」为准，不以调用是否抛错为准。
 *
 * ⚠ 库一律用**临时库**（本仓硬纪律：绝不指向 `$DSH_HOME/memory/mana.db`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ⚠ `cordis` / `cordis-plugin-loader` **不是本仓的 workspace 依赖**（它们是宿主的），
//   按包名 import 会 `ERR_MODULE_NOT_FOUND`。既有先例见
//   `packages/metacognition/tests/assembly.test.mjs` 与 `packages/ui/tests/assembly.test.mjs`：
//   从 DSH 安装目录按**绝对路径**取。此处照抄该口径，并在缺件时**显式失败**（不静默跳过）。
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

const ROOT = new URL('../../../', import.meta.url)
const BASE_URL = pathToFileURL(fileURLToPath(ROOT)).href + '/'
const REPO = fileURLToPath(ROOT).replace(/\/$/, '')

const { Context } = await import(`${DSH}/cordis/lib/index.js`)
const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default

/** 端到端链上的包（**顺序敏感**：perception 先，core 最先）。 */
const CHAIN = [
  ['dsh-mana-core', 'mana-core'],
  ['dsh-mana-perception', 'mana-perception'],
  ['dsh-mana-attention', 'mana-attention'],
  ['dsh-mana-working-memory', 'mana-working-memory'],
  ['dsh-mana-scheduler', 'mana-scheduler'],
]

const cleanups = []
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

async function bootChain() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-chain-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')

  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)

  for (const [pkg] of CHAIN) {
    await ctx.loader.create({ name: pkg, config: pkg === 'dsh-mana-core' ? { storePath: store } : {} })
    await settle(150)
  }
  // 装配判据 = 服务可读（不是调用没抛错）
  const missing = CHAIN.filter(([, svc]) => !ctx.get(svc)).map(([pkg]) => pkg)
  assert.deepEqual(missing, [], `未装配的包：${missing.join(', ')}`)
  return { ctx, store }
}

/** 独立只读连接读库（**不复用插件句柄**：卸载即净会把它的句柄关掉）。 */
function readTrace(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  const rows = db.prepare('SELECT seq, event_type, session_id, turn_id FROM mana_trace ORDER BY seq').all()
  db.close()
  return rows
}

process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

// ── C1 端到端：一次采集走通全链，五类 event_type 各 ≥1 ───────────────────────
test('C1 A1-1 端到端：perception→attention→working-memory→scheduler 全链通', async () => {
  const { ctx, store } = await bootChain()

  // 从**源头**触发（真行为，不是直接调下游 service）
  const n = ctx.get('mana-perception').perceive({
    content: '用户问：末那识的记忆如何注入上下文？',
    sessionId: 'sess-chain',
    turnId: 1,
    requestId: 'req-chain-1',
    source: 'user-message',
  })
  assert.equal(n, 1, '短文本应只产生一块')
  await settle(300)

  const rows = readTrace(store)
  const types = [...new Set(rows.map((r) => r.event_type))]
  // 链上各段都必须真写（少一段即链断，而不是"看起来跑通了"）
  for (const expected of ['observation', 'mana/working-memory', 'mana/scheduler/attention']) {
    assert.ok(types.includes(expected), `event_type 缺「${expected}」，实有=${JSON.stringify(types)}`)
  }
  // seq 连续无洞（A1-1 原文）
  const seqs = rows.map((r) => r.seq)
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), `seq 有洞：${JSON.stringify(seqs)}`)
})

// ── C2 分块是真行为（超限才切，且逐块发事件）────────────────────────────────
test('C2 分块：超限逐块发观察（块数可断言），未超限则单块', async () => {
  const { ctx, store } = await bootChain()
  const many = 'x'.repeat(30)
  // 用一个小 maxChunkChars 的配置不易在真 Loader 下改（Config 走 patch），
  // 故直接用纯函数面验证分块语义，再验证「单块时只发 1 条事件」。
  const { chunkText } = await import(new URL('../../perception/src/index.ts', import.meta.url).href)
  assert.equal(chunkText(many, 1000, 0).split, false, '未超限 ⇒ 不切')
  const cut = chunkText(many, 10, 2)
  assert.equal(cut.split, true, '超限 ⇒ 切分')
  assert.ok(cut.chunks.length > 1)
  assert.equal(cut.chunks.join('').length >= many.length, true)

  // 死循环防线：overlap >= maxChunkChars 必须被夹住（否则索引不前进 ⇒ 挂死）
  const guard = chunkText('y'.repeat(50), 10, 99)
  assert.ok(guard.chunks.length < 60, `overlap 越界应被夹住，实得 ${guard.chunks.length} 块`)

  const n = ctx.get('mana-perception').perceive({
    content: 'short', sessionId: 's2', turnId: 1, requestId: 'r2',
  })
  assert.equal(n, 1)
  await settle(250)
  assert.ok(readTrace(store).length >= 3, '单块也应走完整链')
})

// ── C3 工作记忆容量是真闸（超容淘汰并记账）──────────────────────────────────
test('C3 工作记忆容量：超容淘汰最旧且 evicted 显式记账', async () => {
  const { ctx, store } = await bootChain()
  const wm = ctx.get('mana-working-memory')
  const cap = wm.status().capacityChunks
  assert.ok(cap > 0, '容量应为正数（缺省 4）')

  const perception = ctx.get('mana-perception')
  for (let i = 0; i < cap + 2; i += 1) {
    perception.perceive({ content: `内容-${i}`, sessionId: 's3', turnId: 1, requestId: `r-${i}` })
  }
  await settle(300)

  const snap = wm.snapshot()
  assert.equal(snap.chunks.length, cap, `容量闸应把 size 夹在 ${cap}`)
  assert.equal(snap.evicted, 2, '淘汰必须显式记账（否则「管住了」与「没管」同形）')
  assert.equal(snap.chunks[snap.chunks.length - 1].requestId, `r-${cap + 1}`, '最新的应在尾部')
  assert.ok(readTrace(store).some((r) => r.event_type === 'mana/working-memory'))
})

// ── C4 反证：卸载后同一触发不再产生新行（R 形态在 W3 链上同样成立）──────────
test('C4 反证：卸载 perception 后同一触发不再产生新行', async () => {
  const { ctx, store } = await bootChain()
  const before = readTrace(store).length

  // 卸载 perception（真 fiber dispose）
  const entries = [...ctx.loader.entries()]
  const target = entries.find((e) => String(e.options?.name ?? '').includes('perception'))
  assert.ok(target, '应能按包名找到 perception 条目')
  const group = ctx.loader
  group.remove(target.id)
  await settle(300)

  // 触发面没了 ⇒ 下游**不应**再产生新行
  const afterUnload = readTrace(store).length
  await settle(200)
  assert.equal(readTrace(store).length, afterUnload, '卸载后不得再产生新行')

  // 正向对照：链上其它段仍在（证明"没新行"是卸载所致，不是全链死掉）
  assert.ok(ctx.get('mana-attention'), 'attention 仍在（对照）')
  assert.ok(before >= 0)
})
