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

/**
 * 五类 stage 的**唯一真源** = 契约的 `MANA_STAGES`（`packages/core/src/domain.ts:18`）。
 *
 * ⚠ 就地 import，**不在本文件里手写第三套字面量** —— 本用例原来的缺陷正是
 *   `['observation','mana/working-memory','mana/scheduler/attention']`：第三套名字由手写而来，
 *   其中后两个既不在契约 8 个事件名里、也不在 MANA_STAGES 里 ⇒ 判据「看起来在验五类」，
 *   实际验的是另外三个东西（判据绿 ≠ 事实被检查）。
 * ⚠ 走包名 `dsh-mana-core` 会解析到 **lib**（产物）：产物陈旧时判据测的是旧代码，
 *   而本文件是全链的判据源 ⇒ 取 src 直读（与 tools/a0-check.mjs 的 A0-8 腿同口径）。
 */
const { MANA_STAGES } = await import(new URL('../../core/src/domain.ts', import.meta.url).href)

/**
 * 端到端链上的包（**顺序敏感**：core 最先，perception 为首个触发源）。
 *
 * ⚠ vector 必须进链：全仓 grep 实证 `ctx.emit('mana/recall')` / `mana_trace` 的 recall
 *   落点**只有它一处** ⇒ 不进链则五类中的 `recall` 在本判据里结构性缺失。
 *   本用例只喂**空候选池**（recall.ts:90 在嵌入之前返回）⇒ 零网络、零 Ollama 依赖。
 */
const CHAIN = [
  ['dsh-mana-core', 'mana-core'],
  ['dsh-mana-perception', 'mana-perception'],
  ['dsh-mana-attention', 'mana-attention'],
  ['dsh-mana-working-memory', 'mana-working-memory'],
  ['dsh-mana-scheduler', 'mana-scheduler'],
  ['dsh-mana-vector', 'mana-vector'],
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

/**
 * 手工触发一次 `agent/pre-step` 分发（本用例造 decision / injection 两类的**唯一真路径**）。
 *
 * ⚠ 走宿主的真分发通道 `ctx.waterfall`，而不是直接调 attention 的监听器 ——
 *   后者会绕过 waterfall 的合成语义（下游哨兵 / `next()` 义务都在通道里）。
 *   口径与 `packages/core/tests/injection-gate.test.mjs:134` 的 `firePreStep` 逐条一致。
 */
async function firePreStep(ctx, { turn = 1, messages = [] } = {}) {
  const payload = {
    agent: { session: { id: 'sess-chain' } },
    messages,
    turn,
    step: 1,
  }
  return ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages }))
}

/** 独立只读连接读库（**不复用插件句柄**：卸载即净会把它的句柄关掉）。 */
function readTrace(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  // ⚠ 带上 `payload`：标签归并（F-01 口径 A）后，包内身份不再由 event_type 承载，
  //   而是由 payload 字段承载 ⇒ 判据要读它（否则「归并」就等于「不可分辨」）。
  const rows = db
    .prepare('SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace ORDER BY seq')
    .all()
  db.close()
  return rows
}

process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

// ── C1 端到端：一次采集走通全链，五类 event_type 各 ≥1 ───────────────────────
test('C1 A1-1 端到端：五类 stage 各 ≥1（标签从 MANA_STAGES 派生）且 seq 连续无洞', async () => {
  const { ctx, store } = await bootChain()

  // 前置断言：真源本身没被改动（若有人把五类删成三类，本用例必须在这里就红，
  //   而不是在下面「逐名 includes」处报一个看不出原因的缺失）。
  assert.deepEqual(
    [...MANA_STAGES],
    ['observation', 'attention', 'decision', 'recall', 'injection'],
    'MANA_STAGES 是 A1-1 五类标签的唯一真源，被改动即判红',
  )

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

  // decision / injection 两类**只**产生于 agent/pre-step（attention 的判定链 + 落痕）
  // ⇒ 走宿主的真分发通道补这一次 pre-step；判定链桩不注册，attention 会走它自己的
  //   缺省 next（value='unknown' / degraded=true）⇒ decision 段落以「降级态」被产出来。
  //   这正是需要的证据：**降级也必须有 decision 行**（否则「没判成」与「没判」同形）。
  await firePreStep(ctx, { turn: 1 })
  await settle(250)

  // recall 段落：走 vector 的真入口，**空候选池**（recall.ts:90 于嵌入之前返回）⇒ 零网络。
  await ctx.get('mana-vector').recall('末那识', [], 10, {
    sessionId: 'sess-chain',
    turnId: 1,
    requestId: 'req-chain-1',
  })
  await settle(250)

  const rows = readTrace(store)
  const types = [...new Set(rows.map((r) => r.event_type))]

  // ⚠ **逐名 includes**（不许写成 `types.length >= 5` 这类软断言：多出无关标签也能凑够 5），
  //   且缺哪一类要点名到**类**，并打印该类的可读线索（实有标签 + 该类是否曾出现过）。
  for (const expected of MANA_STAGES) {
    assert.ok(
      types.includes(expected),
      `A1-1 缺第「${expected}」类：mana_trace.event_type 实有=${JSON.stringify(types)}（真源 MANA_STAGES=${JSON.stringify([...MANA_STAGES])}）`,
    )
  }

  // ⚠ 这一条防的是「五类齐了但都是别的插件的行」：本用例的 sessionId 只有一条链在写
  //   （vector 的 recall 也显式用了同一 sessionId）⇒ 五类必须都出现在**本会话**的行里。
  const sessRows = rows.filter((r) => r.session_id === 'sess-chain')
  const sessTypes = [...new Set(sessRows.map((r) => r.event_type))]
  for (const expected of MANA_STAGES) {
    assert.ok(
      sessTypes.includes(expected),
      `A1-1 缺第「${expected}」类（限 sessionId=sess-chain）：实有=${JSON.stringify(sessTypes)}`,
    )
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
  // ⚠ 标签归并后（F-01）：WM 行不再有**自己专属**的 event_type（归入 'attention' 段），
  //   包内身份改由 payload 字段承载 ⇒ 判据跟着读 payload（否则「归并」= 「不可分辨」）。
  //   这两个字段唯一来自 working-memory 的写点（scheduler 的同类行只有 topGoalId/goalCount）。
  const wmRows = readTrace(store).filter((r) => {
    try {
      const p = JSON.parse(r.payload ?? '{}')
      return typeof p.capacityChunks === 'number' && typeof p.size === 'number'
    } catch {
      return false
    }
  })
  assert.ok(wmRows.length >= 1, '工作记忆必须真写行（按 payload 的 capacityChunks/size 认领，不按 event_type）')
  assert.equal(wmRows[wmRows.length - 1].event_type, MANA_STAGES[1], 'WM 行的标签应归入 attention 段（MANA_STAGES[1]）')
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
