/**
 * `dsh-mana-working-memory` 包内判据（F4 · 中段席 · 本包此前零判据）
 *
 * 覆盖（对应派单 ⑤–⑧）：
 *   ⑤ 容量闸：push 超容 ⇒ **逐出真发生**且 `evicted` **精确记账**（条数 + 内容逐项）；
 *      **边界腿三点**：容量 −1 / 容量 / 容量 +1；
 *   ⑥ 消费 `mana/attention`：造一条真作意放行 ⇒ 断言工作记忆**真收到**（不是只声明 `ctx.on`）；
 *   ⑦ `snapshot()` 的结构与**顺序**（顺序敏感：先读实现再判，见 W5 的判因）；
 *   ⑧ 形态面：`ctx.effect` 注册点数、`mana_trace` 写入类型落在 S1 五类内。
 *
 * ⚠ 两层夹具，各证一件不同的事（单靠任一层都缺一半）：
 *   · **真装配层**（真 `Context` + 真 cordis `Loader`，与 `tools/r0-assembly-check.mjs` 同口径）
 *     —— 证明"装配后这条链真的接上了"，装配判据 = **服务可读**；⑥ 与事件面容量腿走这层。
 *   · **直装配层**（真 `Context` + src 模块直调 `apply`）—— 让**容量值可控**（设置页那组数值框
 *     正是本包的配置面），使边界腿 −1 / 容量 / +1 三点能真造出来。
 *
 * ⚠ 读的是 **src** 不是 lib；负向对拍改 src 后须重建该包 lib，否则 mtime 腿假红。
 * ⚠ 库一律用**临时库**（绝不指向 `$DSH_HOME/memory/mana.db`）。
 * 运行（**禁止管道取退出码**）：node --test packages/working-memory/tests/*.test.mjs ; echo $?
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const BASE_URL = pathToFileURL(REPO + '/').href

const { Context } = await import(DSH + '/cordis/lib/index.js')
const Loader = (await import(DSH + '/cordis-plugin-loader/lib/index.js')).default

/** 五类真源 = core/src/domain.ts:18（本文件不手写第三套字面量）。 */
const { MANA_STAGES } = await import(new URL('../../core/src/domain.ts', import.meta.url).href)
const coreMod = await import(new URL('../../core/src/index.ts', import.meta.url).href)
const wmMod = await import(new URL('../src/index.ts', import.meta.url).href)

const cleanups = []
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

const tmpStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mana-wm-'))
  cleanups.push(dir)
  return join(dir, 'mana.db')
}

/** 直装配：真 Context + src 模块。返回 ctx 与独立只读读库器。 */
async function bootDirect({ capacityChunks, budgetChars = 4000 }) {
  const store = tmpStore()
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: store })
  await settle(250)
  assert.ok(ctx.get('mana-core'), '前置：mana-core 必须可读（否则下面测的不是工作记忆）')
  ctx.plugin(wmMod, { capacityChunks, budgetChars })
  await settle(250)
  assert.ok(ctx.get('mana-working-memory'), '未装配 mana-working-memory')
  return { ctx, store }
}

/** 真装配链：core → perception → attention → working-memory（按包名解析）。 */
async function bootChain({ capacityChunks = 4, budgetChars = 4000 } = {}) {
  const store = tmpStore()
  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  ctx.plugin(Loader, { baseUrl: BASE_URL })
  await settle(200)
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: store } })
  await settle(150)
  await ctx.loader.create({ name: 'dsh-mana-perception', config: { maxChunkChars: 100, chunkOverlapChars: 0 } })
  await settle(150)
  await ctx.loader.create({ name: 'dsh-mana-attention', config: {} })
  await settle(150)
  await ctx.loader.create({ name: 'dsh-mana-working-memory', config: { capacityChunks, budgetChars } })
  await settle(150)
  const missing = ['mana-core', 'mana-perception', 'mana-attention', 'mana-working-memory'].filter((s) => !ctx.get(s))
  assert.deepEqual(missing, [], `未装配的服务：${missing.join(', ')}`)
  return { ctx, store }
}

function readTrace(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  const rows = db.prepare('SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace ORDER BY seq').all()
  db.close()
  return rows
}

/**
 * 工作记忆的 `mana_trace` 行**认领方式 = payload 形状**（不是 event_type）。
 *
 * 判因（先读实现再落判据，不猜）：`working-memory/src/index.ts:140` 把标签归并入
 * `MANA_STAGES[1]`（'attention' 段），`attention` 包写的行**也是**这一段的标签
 * （`attention/src/index.ts:190`）。⇒ 两包在本链上**标签同形**，只看 event_type 无法归属。
 * 唯一可分辨的身份在各自 payload 的**独有字段**上：
 *   · 工作记忆行：`{requestId, size, capacityChunks, evicted, budgetChars, chars, budgetEvicted, truncated, truncatedChars, didEvict}`
 *     （G2 把读数换成单一来源 `metrics()`，键集随之扩展；`wmRows` **不按"键集逐字相等"**认领 ——
 *      那会让每次加字段都变成一次判据改造；改认**语义锚**：size/capacityChunks/evicted 三件套）
 *   · attention 行：`{requestId, contentChars}`
 * 本函数按这个形状认领；形状变了就该在这里红，而不是静默数错。
 */
function wmRows(rows) {
  return rows.filter((r) => {
    if (r.event_type !== MANA_STAGES[1]) return false
    try {
      const p = JSON.parse(r.payload ?? '{}')
      return (
        typeof p.capacityChunks === 'number' &&
        typeof p.size === 'number' &&
        typeof p.evicted === 'number' &&
        typeof p.didEvict === 'boolean'
      )
    } catch {
      return false
    }
  })
}

/**
 * 造一条**真作意放行**（字段形状 = attention 广播的那条，attention/src/index.ts:173-181）。
 * `content` 可覆盖：**默认值必须保持 3 码点**，否则 W1/W2/W4/W5 的 chars 读数会被这一个参数改动带跑
 * （改判据的夹具去迁就新用例 = 把老腿的读数变成假的）。预算腿一律显式传长内容。
 */
const att = (i, content = `内容${i}`) => ({
  sessionId: 'sess-wm',
  turnId: 1,
  requestId: `req-${i}`,
  at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
  content,
  jevProbability: null,
  degraded: false,
})

/**
 * **预算记账腿**的认领器：只认**真的带预算读数**的 WM 行。
 * 为什么不复用 `wmRows`：`truncated`/`budgetEvicted` 若被写成"常量 0 回填"或干脆没写进落痕，
 * `wmRows` 仍会认领（三件套没变）⇒ 认领腿看不出"记账没落到审计面"。
 * 这里要求它们是**数字**；落痕缺字段时过滤后行数会掉 ⇒ 下面的计数腿立刻可见。
 */
function budgetRows(rows) {
  return wmRows(rows).filter((r) => {
    try {
      const p = JSON.parse(r.payload ?? '{}')
      return (
        typeof p.budgetChars === 'number' &&
        typeof p.chars === 'number' &&
        typeof p.budgetEvicted === 'number' &&
        typeof p.truncated === 'number' &&
        typeof p.truncatedChars === 'number'
      )
    } catch {
      return false
    }
  })
}


// ── ⑤ 容量闸 + 边界腿三点 ────────────────────────────────────────────────────
test('W1 ⑤容量闸边界腿：容量−1 / 容量 / 容量+1 三点 —— 逐出只发生在 +1 那一次', async () => {
  const cap = 4
  const { ctx } = await bootDirect({ capacityChunks: cap })
  const wm = ctx.get('mana-working-memory')
  assert.equal(wm.status().capacityChunks, cap, '配置真生效（读回 = 写下的值）')

  // 容量 −1：只装 3 条 ⇒ **不得**有任何逐出，且内容逐项对得上
  assert.equal(wm.push(att(1)), false, '第 1 条不得报逐出')
  assert.equal(wm.push(att(2)), false)
  assert.equal(wm.push(att(3)), false)
  let snap = wm.snapshot()
  assert.equal(snap.chunks.length, cap - 1, `容量−1 时 size 应为 ${cap - 1}`)
  assert.equal(snap.evicted, 0, '容量−1：**零逐出**（"管住了"与"根本没管"必须可分辨）')
  assert.deepEqual(snap.chunks.map((c) => c.content), ['内容1', '内容2', '内容3'])

  // 恰满容量：第 4 条 ⇒ 仍不得逐出（边界是 >，不是 >=）
  assert.equal(wm.push(att(4)), false, '恰好装满容量时**不得**逐出（> 而非 >=）')
  snap = wm.snapshot()
  assert.equal(snap.chunks.length, cap, `容量时 size 应为 ${cap}`)
  assert.equal(snap.evicted, 0, '容量：仍零逐出')
  assert.deepEqual(snap.chunks.map((c) => c.requestId), ['req-1', 'req-2', 'req-3', 'req-4'])

  // 容量 +1：第 5 条 ⇒ 逐出 1 条，且逐出的是**最旧**的 req-1
  assert.equal(wm.push(att(5)), true, '容量+1 时**必须**报逐出')
  snap = wm.snapshot()
  assert.equal(snap.chunks.length, cap, `容量+1 后 size 仍夹在 ${cap}`)
  assert.equal(snap.evicted, 1, '容量+1：恰好逐出 1 条')
  assert.deepEqual(
    snap.chunks.map((c) => c.requestId),
    ['req-2', 'req-3', 'req-4', 'req-5'],
    '被逐出的必须是**最旧**的那条（逐出新鲜内容与"根本没管"表面同形）',
  )
  assert.deepEqual(snap.chunks.map((c) => c.content), ['内容2', '内容3', '内容4', '内容5'])
})

test('W2 ⑤evicted 精确记账：条数连续、内容精确、status 与 snapshot 同源', async () => {
  const cap = 3
  const { ctx } = await bootDirect({ capacityChunks: cap })
  const wm = ctx.get('mana-working-memory')
  const N = 10
  const flags = []
  for (let i = 1; i <= N; i += 1) flags.push(wm.push(att(i)))

  // 逐次返回值：前 cap 次不逐出，之后每次恰好逐出 1 条
  assert.deepEqual(flags, [false, false, false, true, true, true, true, true, true, true], 'push 返回值必须逐次精确')
  const snap = wm.snapshot()
  assert.equal(snap.chunks.length, cap)
  assert.equal(snap.evicted, N - cap, `累计逐出必须恰好 ${N - cap}（少记 = 静默丢弃）`)
  assert.deepEqual(
    snap.chunks.map((c) => c.requestId),
    ['req-8', 'req-9', 'req-10'],
    '留下的必须是最新 cap 条（按 requestId 逐项核，不只核条数）',
  )
  // seq 单调且**不因逐出而回退**（"谁最旧"的判据依赖它）
  assert.deepEqual(snap.chunks.map((c) => c.seq), [8, 9, 10])
  // status 与 snapshot 必须同源（两处各算一遍 = 迟早对不上）
  const st = wm.status()
  assert.equal(st.size, snap.chunks.length, 'status.size 与 snapshot.chunks.length 必须一致')
  assert.equal(st.evicted, snap.evicted, 'status.evicted 与 snapshot.evicted 必须一致')
  assert.equal(st.capacityChunks, cap)
  assert.equal(st.plugin, 'mana-working-memory')
  assert.equal(st.wired, true)
  // chars 按**码点**计（每块"内容N" = 3 码点；N≥10 时仍是 3）
  assert.equal(snap.chars, snap.chunks.reduce((n, c) => n + [...c.content].length, 0), 'chars 必须与逐块码点数之和一致')
})

test('W3 ⑤容量语义边界：capacityChunks = 0 ⇒ 该轴不设闸（**不逐出、不记账**，如实钉住现状）', async () => {
  const { ctx } = await bootDirect({ capacityChunks: 0 })
  const wm = ctx.get('mana-working-memory')
  for (let i = 1; i <= 5; i += 1) assert.equal(wm.push(att(i)), false, '容量 0 时不得报逐出')
  const snap = wm.snapshot()
  assert.equal(snap.capacityChunks, 0)
  assert.equal(snap.chunks.length, 5, '实现里 `capacityChunks > 0` 才开闸 ⇒ 0 = 无上限（现状，非缺陷）')
  assert.equal(snap.evicted, 0, '无闸 ⇒ 零逐出（不得记出 phantom 逐出数）')
})

// ── ⑥ 真消费 mana/attention（链级：perception → attention → working-memory）──
test('W6 ⑥真消费：作意放行经真事件链进工作记忆（真 Loader 装配，capacity=2）', async () => {
  const cap = 2
  const { ctx, store } = await bootChain({ capacityChunks: cap })
  const wm = ctx.get('mana-working-memory')
  assert.equal(wm.snapshot().chunks.length, 0, '前置：链刚起来时工作记忆应为空')

  const contents = ['甲甲甲甲', '乙乙乙乙', '丙丙丙丙'] // 每个 4 字，maxChunkChars=100 ⇒ 各一块
  for (const [i, c] of contents.entries()) {
    const n = ctx.get('mana-perception').perceive({
      content: c, sessionId: 'sess-wm', turnId: 1, requestId: `chain-${i}`, source: 'user-message',
    })
    assert.equal(n, 1, '每段应只产生一块')
  }
  await settle(400)

  // ⑥ 真收到：不是"声明了 ctx.on"，而是这三条**真的进来了**（且容量闸同时生效）
  const snap = wm.snapshot()
  assert.equal(snap.chunks.length, cap, `容量闸应把 size 夹在 ${cap}`)
  assert.deepEqual(snap.chunks.map((c) => c.content), ['乙乙乙乙', '丙丙丙丙'], '工作记忆接到的正是作意放行的内容')
  assert.equal(snap.evicted, 1, '链级路径上逐出同样必须记账')

  // 事件面容量腿：工作记忆的落痕逐条对得上（size/evicted/didEvict 三点全核）
  const rows = wmRows(readTrace(store))
  assert.equal(rows.length, 3, '3 次放行应写 3 行工作记忆落痕（每一条放行都必须留痕）')
  const seen = rows.map((r) => JSON.parse(r.payload))
  assert.deepEqual(seen.map((p) => [p.size, p.evicted, p.didEvict]), [[1, 0, false], [2, 0, false], [2, 1, true]])
  assert.equal(rows.every((r) => r.session_id === 'sess-wm'), true)
  // ⑧ 类型落在五类内（标签归并后取 MANA_STAGES[1]）
  assert.deepEqual([...new Set(rows.map((r) => r.event_type))], [MANA_STAGES[1]], '工作记忆落痕应统一落在 attention 段标签上')
  // 审计不泄内容：落痕里不得出现被放行内容的原文
  for (const r of rows) {
    for (const c of contents) assert.equal(String(r.payload).includes(c), false, '落痕 payload 不得含内容原文（审计不泄内容）')
  }
  // 全链 seq 连续无洞
  const seqs = readTrace(store).map((r) => r.seq)
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), `seq 有洞：${JSON.stringify(seqs)}`)
})

test('W7 ⑥反证：卸载工作记忆后，同一触发不再产生新的会话外行（卸载即净）', async () => {
  const { ctx, store } = await bootChain({ capacityChunks: 4 })
  ctx.get('mana-perception').perceive({ content: '放行一', sessionId: 's7', turnId: 1, requestId: 'r7' })
  await settle(300)
  const before = wmRows(readTrace(store)).length
  assert.equal(before, 1, '前置：卸载前应已有 1 行工作记忆落痕')

  const target = [...ctx.loader.entries()].find((e) => String(e.options?.name ?? '').includes('working-memory'))
  assert.ok(target, '应能按包名找到 working-memory 条目')
  ctx.loader.remove(target.id)
  await settle(300)
  assert.equal(ctx.get('mana-working-memory'), undefined, '卸载后服务必须不可读')

  ctx.get('mana-perception').perceive({ content: '放行二', sessionId: 's7', turnId: 1, requestId: 'r7b' })
  await settle(300)
  assert.equal(wmRows(readTrace(store)).length, before, '卸载后**不得**再产生新的工作记忆落痕')
  // 对照：上游仍在写（证明"没新行"是卸载所致，不是整条链死掉）
  assert.ok(ctx.get('mana-perception') && ctx.get('mana-attention'), '上游应仍在（对照）')
})

// ── ⑦ snapshot 结构与顺序 ────────────────────────────────────────────────────
test('W5 ⑦snapshot 结构与顺序：顺序**敏感**（FIFO：idx 0 最旧、末位最新），且是深拷贝', async () => {
  // 判因（先读实现再落判据）：`index.ts:98` push 到**尾部**、`:102` `shift()` 从**头部**逐出
  //   ⇒ 数组顺序 = FIFO 时序，**顺序敏感**；`:112` `map(c => ({...c}))` 逐块浅拷贝。
  const { ctx } = await bootDirect({ capacityChunks: 3 })
  const wm = ctx.get('mana-working-memory')
  wm.push(att(1)); wm.push(att(2)); wm.push(att(3))
  const snap = wm.snapshot()
  assert.deepEqual(snap.chunks.map((c) => c.seq), [1, 2, 3], '数组顺序必须是到达顺序（idx 0 = 最旧）')
  assert.equal(snap.chunks[snap.chunks.length - 1].requestId, 'req-3', '末位 = 最新进入的那条')
  // 结构必须完整给出（判据用：读不到就等于没有）
  // ⚠ G2 后键集含 3 个**预算记账**键；**未**新增 size —— snapshot 有 chunks，条数是冗余派生字段
  //   （多一个派生字段 = 多一个漂移源；status 才带 size）。
  assert.deepEqual(
    Object.keys(snap).sort(),
    ['budgetChars', 'budgetEvicted', 'capacityChunks', 'chars', 'chunks', 'evicted', 'truncated', 'truncatedChars'],
  )
  assert.deepEqual(Object.keys(snap.chunks[0]).sort(), ['at', 'content', 'requestId', 'seq'])

  // 深拷贝：调用方改了读到的快照**不得**影响内部状态
  snap.chunks[0].content = '被篡改'
  snap.chunks.push({ requestId: 'x', content: 'x', seq: 99, at: 'x' })
  const snap2 = wm.snapshot()
  assert.deepEqual(snap2.chunks.map((c) => c.content), ['内容1', '内容2', '内容3'], '快照必须与内部状态隔离')
  assert.equal(snap2.chunks.length, 3)
})

// ── ⑧ 形态面 ────────────────────────────────────────────────────────────────
test('W4 ⑧形态：1 个 effect 注册点、agent/pre-step 直通且真调 next()、事件面尺寸正确', async () => {
  const { ctx } = await bootDirect({ capacityChunks: 3 })
  // effect 计数无法从真 Context 读出 ⇒ 用最小假 ctx 直跑 apply 数注册点（先例：metacognition/tests/skeleton.test.mjs:16）
  const effects = []
  const provides = new Map()
  const listeners = []
  const traceWrites = []
  const fake = {
    get: (n) => (n === 'mana-core' ? { plugin: 'mana-core', writeTrace: (e) => { traceWrites.push(e); return traceWrites.length } } : undefined),
    on: (evt, fn) => listeners.push({ evt, fn }),
    effect: (fn, desc) => { effects.push(desc); return fn() },
    provide: (n, s) => { provides.set(n, s); return () => provides.delete(n) },
  }
  wmMod.apply(fake, { capacityChunks: 2, budgetChars: 100 })
  assert.equal(effects.length, 1, '只应有 1 个 effect 注册点')
  assert.ok(provides.has('mana-working-memory'), '必须 provide mana-working-memory')
  assert.deepEqual(wmMod.inject, ['mana-core'])
  assert.deepEqual(listeners.map((l) => l.evt), ['mana/attention', 'agent/pre-step'], '监听器面恰为：消费作意 + pre-step 直通')
  const sentinel = { kind: 'enter', messages: [] }
  const ret = await listeners[1].fn({}, async () => sentinel)
  assert.equal(ret, sentinel, '直通监听器必须原样返回 next() 的结果（漏调 next = 静默掐死下游）')

  // 事件面容量腿（假 ctx 路径）：**走真入口** —— 喂 `mana/attention` 监听器（假 ctx 里没有总线，
  //   直接调 `svc.push` 会绕过落痕：落痕是**监听器**写的，不是 push 写的 —— 本席第一版就踩了这个）。
  const onAttention = listeners[0].fn
  const svc = provides.get('mana-working-memory')
  // ⚠ 落痕读的是**每条 push 的当时读数**：listener 是 push → writeTrace 顺序，各次互不覆盖
  //   ⇒ 容量 2 时三次放行记的是 size = 1 / 2 / 2，evicted = 0 / 0 / 1（**不是**末态 2/2/2）。
  //   写成"每次都是末态"就是把时序读错 —— 这条正是容量腿可分辨的地方（与 W6 链级读数一致）。
  const snaps = []
  for (let i = 1; i <= 3; i += 1) {
    onAttention(att(i))
    snaps.push(svc.snapshot())
  }
  assert.deepEqual(snaps.map((s) => [s.chunks.length, s.evicted]), [[1, 0], [2, 0], [2, 1]], '容量 2：第 3 次才逐出且恰记 1 条')
  assert.deepEqual(
    traceWrites.map((e) => [e.payload.size, e.payload.evicted, e.payload.didEvict]),
    [[1, 0, false], [2, 0, false], [2, 1, true]],
    '每次放行都必须落一行，且行内读数是**当次** push 之后的真实状态（不得记成末态，也不得漏行）',
  )
  assert.deepEqual([...new Set(traceWrites.map((e) => e.eventType))], [MANA_STAGES[1]], '落痕标签必须取自 MANA_STAGES（不得手写第三套）')
  assert.equal(traceWrites.length, 3, '三条放行 ⇒ 三行落痕（一条一行的"每行可归属"是判据可数性的前提）')
  assert.equal(svc.status().size, 2)

  // 未知事件名不得被本包消费（监听面之外的广播与它无关）
  assert.equal(listeners.some((l) => l.evt.startsWith('mana/') && l.evt !== 'mana/attention'), false)
  assert.equal(ctx.get('mana-working-memory').status().plugin, 'mana-working-memory')
})

test('W8 ⑧失败可观测：畸形作意载荷**大声抛**（未被静默吞）—— 如实钉住现状', () => {
  // 判因：`index.ts:98` 直接读 `att.requestId`/`att.content`，无守卫。本仓首位教训是
  //   「让失败不可观测」⇒ 这里断言的是**抛错而非静默**（静默吞掉才会让"没放行"与"放行了但崩了"同形）。
  //   ⚠ 若日后加了守卫（丢弃 + 记数），请把本条改成 assert.doesNotThrow + 断记账不变，别把断言删掉。
  const listeners = []
  const fake = {
    get: () => ({ plugin: 'mana-core', writeTrace: () => 1 }),
    on: (evt, fn) => listeners.push({ evt, fn }),
    effect: (fn) => fn(),
    provide: () => () => {},
  }
  wmMod.apply(fake, { capacityChunks: 4, budgetChars: 100 })
  const onAttention = listeners.find((l) => l.evt === 'mana/attention').fn
  assert.throws(() => onAttention(undefined), TypeError, '畸形载荷必须抛错，不得静默吞掉')
  // 对照：良构载荷必不抛（证明上面那条不是"凡输入皆抛"的假覆盖）
  assert.doesNotThrow(() => onAttention(att(1)))
})

// ══ G2 新增：预算闸（budgetChars）真闸判据 ═══════════════════════════════════
//
// 背景（F4 实证 + 主持人源码级复核）：@budgetChars@ 曾是**零消费死开关** —— 全仓仅 4 处出现
// （接口×2 + 缺省 + 报告字段），**无任何比较**；实测 @budgetChars=1 + 4×5000 字@ ⇒
// @{chars:20000, over:19999, evicted:0}@，超预算字无动作、无记账。本组判据把「它到底管没管」
// 变成**可机检**：每条腿都用与缺省值**不同的**预算值，且都断言**行为随该值变**。
//
// 两闸顺序口径 = **先容量（条数）、后预算（字符）**，理由与判据见 W11。

/** 造 n 个码点的内容串。默认用 '中'：**1 码点 / 3 字节** ⇒ 顺带把「按码点计」与「按字节计」区分开。 */
const rep = (n, ch = '中') => ch.repeat(n)

test('W9 ⑨预算闸边界：容量轴关掉、只留预算轴 —— 恰满不动作 / 超 1 字必动作 / 多块逐出 / 单块截断', async () => {
  // (甲) 恰满预算：**不得**逐出、不得截断（边界是 >，不是 >=）—— 与容量闸 W1 同口径
  {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 300 })
    const wm = ctx.get('mana-working-memory')
    assert.equal(wm.snapshot().budgetChars, 300, '配置真生效（读回 = 写下的值）')
    const flags = [wm.push(att(1, rep(100))), wm.push(att(2, rep(100))), wm.push(att(3, rep(100)))]
    const s = wm.snapshot()
    assert.deepEqual(flags, [false, false, false], '恰满预算时 push 不得报逐出')
    assert.equal(s.chars, 300, '3×100 码点 = 恰满 300')
    assert.equal(s.chunks.length, 3, '恰满预算不得逐出（管住 = size 3）')
    assert.equal(s.budgetEvicted, 0, '恰满：零预算逐出')
    assert.equal(s.truncated, 0, '恰满：零截断')
    assert.equal(s.truncatedChars, 0, '恰满：零截断字符')
  }

  // (乙) 超 1 码点：**必逐出最旧**（差值 1 也必须动作 —— 这是"死开关"与"真闸"的分水岭）
  {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 299 })
    const wm = ctx.get('mana-working-memory')
    wm.push(att(1, rep(100)))
    wm.push(att(2, rep(100)))
    assert.equal(wm.push(att(3, rep(100))), true, '超预算 1 码点也必须报逐出（死开关在这里恒 false）')
    const s = wm.snapshot()
    assert.equal(s.size === undefined ? s.chunks.length : s.size, 2, '超 1 码点 ⇒ 逐出 1 条')
    assert.deepEqual(s.chunks.map((c) => c.requestId), ['req-2', 'req-3'], '逐出的必须是**最旧**那条')
    assert.equal(s.chars, 200)
    assert.equal(s.budgetEvicted, 1, '预算逐出必须**显式记账**（不许静默 shift）')
    assert.equal(s.truncated, 0, '多块情形走逐出，不走截断')
  }

  // (丙) 单条自身超预算一大截 ⇒ 截断到恰满（不是整条丢）
  {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 10 })
    const wm = ctx.get('mana-working-memory')
    const didEvict = wm.push(att(1, rep(100)))
    const s = wm.snapshot()
    assert.equal(s.chunks.length, 1, '单条超预算须**保留一条**（就绪性下限），不得整条丢空')
    assert.equal([...s.chunks[0].content].length, 10, '须截断到恰好等于预算（不是少于）')
    assert.equal(s.chars, 10)
    assert.equal(s.truncated, 1, '截断必须**显式记账**（1 次）')
    assert.equal(s.truncatedChars, 90, '截断字符数 = 100 - 10（不是只记次数不记量）')
    assert.equal(s.budgetEvicted, 0, '截断不得混进逐出账（两者必须可分辨）')
    assert.equal(didEvict, false, '截断**不**算逐出（条数未减，返回值不得被截断污染）')
    assert.deepEqual(s.chunks.map((c) => c.seq), [1], '截断改的是 content，seq/身份不得被换掉')
    assert.equal(s.chunks[0].requestId, 'req-1')
  }

  // (丁) 单条恰好超 1 码点 ⇒ 截断 1 码点（边界腿：截断量恰为 1）
  {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 99 })
    const wm = ctx.get('mana-working-memory')
    wm.push(att(1, rep(100)))
    const s = wm.snapshot()
    assert.equal(s.chars, 99, '截到 99')
    assert.equal(s.truncatedChars, 1, '恰好截掉 1 码点')
    assert.equal(s.truncated, 1)
  }

  // (庚) 多条 + 最旧那条**自身**就超预算 ⇒ 仍走**逐出**（截断只保留给"只剩一条"的退化情形）
  {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 250 })
    const wm = ctx.get('mana-working-memory')
    wm.push(att(1, rep(300)))
    wm.push(att(2, rep(50)))
    // push#1: 单条 300 > 250 ⇒ 截断到 250（truncated=1, tc=50）
    // push#2: 250 + 50 = 300 > 250 ⇒ 多块 ⇒ **逐出最旧**（不是把 req-1 再截一次）
    const s = wm.snapshot()
    assert.deepEqual(s.chunks.map((c) => c.requestId), ['req-2'], '多块一律逐出最旧')
    assert.equal(s.budgetEvicted, 1, '逐出记在预算账上')
    assert.equal(s.truncated, 1, '截断次数**不因逐出而变**（两次动作分属两笔账）')
    assert.equal(s.chars, 50)
    assert.equal([...s.chunks[0].content].length, 50, '留下的那条内容不得被截')
  }

  // (辛) 一次 push 内**逐出多条**：逐出后必须**重新评估** total，直到满足上界（不是只逐一条就收手）
  {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 25 })
    const wm = ctx.get('mana-working-memory')
    for (let i = 1; i <= 4; i += 1) wm.push(att(i, rep(10)))
    // 第 4 次：total 40 > 25 ⇒ 逐 req-1（30 > 25）⇒ 再逐 req-2（20 ≤ 25 收手）⇒ 本次逐出 **2** 条
    const s = wm.snapshot()
    assert.deepEqual([s.chunks.length, s.chars, s.budgetEvicted], [2, 20, 2], '一次 push 内必须逐到满足上界为止（只逐一条 = 预算仍被顶破）')
    assert.deepEqual(s.chunks.map((c) => c.requestId), ['req-3', 'req-4'], '留下的必须是最新两条')
    assert.ok(s.chars <= 25, '末态 chars 不得越过预算上界')
  }

  // (己) **口径腿：按码点计，不是按 UTF-16 单元 / 字节**
  //   '𝌆' = 1 码点 / 2 个 UTF-16 单元 / 4 字节。预算 5 码点 ⇒ 5 个字**恰满**，不得截断。
  //   若实现按 s.length（UTF-16）计，5 个会算成 10 ⇒ 必截到 5 单元 = '𝌆𝌆' + 半个代理对（非法串）⇒ 本腿红。
  {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 5 })
    const wm = ctx.get('mana-working-memory')
    wm.push(att(1, '𝌆'.repeat(5)))
    const s = wm.snapshot()
    assert.equal(s.chars, 5, 'chars 必须按**码点**计（5，不是 10）')
    assert.equal(s.truncated, 0, '恰满 5 码点不得截断（按 UTF-16 计会误判成 10 ⇒ 必红）')
    assert.equal(s.chunks[0].content, '𝌆'.repeat(5), '内容逐字不变，且不得被切出半个代理对')
  }
})

test('W10 ⑨两闸串联：先容量后预算 —— 末态**同时**满足两个上界，且记账归属不串账', async () => {
  // (甲) 容量 3 / 预算 5：逐条压入 3 码点的块 ⇒ 预算闸每次逐出最旧，逐出后**重新**评估（total 单调降）
  {
    const { ctx } = await bootDirect({ capacityChunks: 3, budgetChars: 5 })
    const wm = ctx.get('mana-working-memory')
    wm.push(att(1, rep(3)))
    wm.push(att(2, rep(3))) // 3+3 = 6 > 5 ⇒ 逐出 req-1（多块路径）
    const s1 = wm.snapshot()
    assert.equal(s1.budgetEvicted, 1, '超预算 ⇒ 预算账 +1')
    assert.equal(s1.evicted, 0, '容量 3 未破 ⇒ 容量账必须为 0（两笔账分账）')
    assert.equal([...s1.chunks[0].content].length, 3, '留下的是**整块**（逐出不截断）')
    assert.equal(s1.truncated, 0, '多块路径不得记截断')
    assert.equal(s1.chars, 3)
  }

  // (乙) 两闸**同时**超：容量 1 / 预算 4，两条各 9 码点
  {
    const { ctx } = await bootDirect({ capacityChunks: 1, budgetChars: 4 })
    const wm = ctx.get('mana-working-memory')
    wm.push(att(1, rep(9))) // 容量 1 未破；预算：单条 9 > 4 ⇒ 截断到 4
    const mid = wm.snapshot()
    assert.deepEqual([mid.chunks.length, mid.truncated, mid.truncatedChars, mid.evicted, mid.budgetEvicted], [1, 1, 5, 0, 0])
    wm.push(att(2, rep(9))) // 容量先跑：size 2 > 1 ⇒ 逐出 req-1（evicted=1）；预算后跑：单条 9 > 4 ⇒ 截断 req-2
    const s = wm.snapshot()
    assert.deepEqual(
      [s.chunks.length, s.chars, s.evicted, s.budgetEvicted, s.truncated, s.truncatedChars],
      [1, 4, 1, 0, 2, 10],
      '两闸同超：容量先把 req-1 挤掉（记 evicted）、预算再截 req-2（记 truncated）—— 互不串账',
    )
    // **末态同时满足两个上界**（这是"以谁为准"的判据：谁都不得被对方顶破）
    assert.ok(s.chunks.length <= 1, 'size 不得越过容量上界')
    assert.ok(s.chars <= 4, 'chars 不得越过预算上界')
  }

  // (丙) 顺序判据：**行为对拍 = 正序的账本**（逆序会给出另一组读数）
  {
    const { ctx } = await bootDirect({ capacityChunks: 1, budgetChars: 4 })
    const wm = ctx.get('mana-working-memory')
    wm.push(att(1, rep(5)))
    wm.push(att(2, rep(5)))
    const s = wm.snapshot()
    // 正序（先容量后预算）：push#1 容量不动作 → 预算截断(1)；push#2 容量逐出 req-1(evicted=1) → 预算截断 req-2(2)
    // 逆序（先预算后容量）：push#2 的预算会先把 req-1 逐出(budgetEvicted=1)、req-2 截断，容量再不动作
    //   ⇒ 读数会变成 [evicted:0, budgetEvicted:1] —— 与下面断言不同 ⇒ 顺序被钉死
    assert.deepEqual(
      [s.chunks.length, s.chars, s.evicted, s.budgetEvicted, s.truncated, s.truncatedChars],
      [1, 4, 1, 0, 2, 2],
      '记账归属必须与"先容量后预算"一致：逆序实现会得到 evicted:0/budgetEvicted:1 ⇒ 必红',
    )
  }

  // (丁) 顺序的**结构腿**：源码里容量分支必须**先于**预算分支（行为腿 + 结构腿，两条都要）
  {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    // 锚点取**闸语句本身**（`while (config.capacityChunks` / `if (config.budgetChars`），
    // 不取比较运算符正文 —— 否则把 `<=` 改成 `<` 这类**在预算腿该红**的扰动，会先把这条**顺序腿**判红，
    // 报错点就不是它该点的那条腿了（判据绑死写法，不是绑死顺序契约）。
    const iCap = src.indexOf('while (config.capacityChunks')
    const iBud = src.indexOf('if (config.budgetChars')
    assert.ok(iCap > 0, '抽不到容量闸的闸语句 ⇒ 该腿会静默空转，必须红')
    assert.ok(iBud > 0, '抽不到预算闸的闸语句 ⇒ 同上')
    assert.ok(iCap < iBud, '两闸顺序契约 = 先容量后预算；实现里容量闸必须先出现（顺序颠倒 ⇒ 本腿必红）')
  }
})

test('W12 ⑨两个闸的"不设闸"语义：capacityChunks<=0 / budgetChars<=0 —— 含**真出口**与反向对照', async () => {
  // (甲) capacityChunks = 0 ⇒ 该轴**不设闸（无上限）**：不逐出、不记账（G2 明订，与 maxRounds=0/maxTokens=0 同族）
  {
    const a = await bootDirect({ capacityChunks: 0, budgetChars: 4000 })
    const wmNo = a.ctx.get('mana-working-memory')
    const flags = []
    for (let i = 1; i <= 12; i += 1) flags.push(wmNo.push(att(i)))
    const sNo = wmNo.snapshot()
    assert.deepEqual(flags, new Array(12).fill(false), '容量 0 = 无上限 ⇒ push 恒不报逐出')
    assert.equal(sNo.chunks.length, 12, '12 条全留（"无上限"不等于"一条不收"）')
    assert.equal(sNo.evicted, 0, '无闸 ⇒ 零逐出（不得记 phantom 数）')

    // **反向对照**：同 12 条、容量 4 ⇒ 必须逐出 8 —— 证明上面"不动作"是**配置使然**，不是阈值面失效
    const b = await bootDirect({ capacityChunks: 4, budgetChars: 4000 })
    const wmCap = b.ctx.get('mana-working-memory')
    for (let i = 1; i <= 12; i += 1) wmCap.push(att(i))
    const sCap = wmCap.snapshot()
    assert.deepEqual([sCap.chunks.length, sCap.evicted], [4, 8], '反向对照：容量 4 时同 12 条必逐出 8（无对照则"无上限"与"闸坏了"同形）')
  }

  // (乙) budgetChars = 0 ⇒ 该轴**不设闸（无上限）**：超长内容**不截断、不逐出**
  {
    const a = await bootDirect({ capacityChunks: 0, budgetChars: 0 })
    const wmNo = a.ctx.get('mana-working-memory')
    wmNo.push(att(1, rep(100)))
    wmNo.push(att(2, rep(100)))
    wmNo.push(att(3, rep(100)))
    const sNo = wmNo.snapshot()
    assert.deepEqual([sNo.chars, sNo.budgetEvicted, sNo.truncated, sNo.chunks.length], [300, 0, 0, 3], '预算 0 = 无上限 ⇒ 300 字全留且逐字不截')
    assert.equal([...sNo.chunks[0].content].length, 100, '无上限时内容必须逐字完整（不得被"0 预算"截成空串）')

    // **反向对照**：同 3 条、预算 250 ⇒ 必须动作（否则"0 = 无上限"与"闸从不动作"同形）
    const b = await bootDirect({ capacityChunks: 0, budgetChars: 250 })
    const wmBud = b.ctx.get('mana-working-memory')
    wmBud.push(att(1, rep(100)))
    wmBud.push(att(2, rep(100)))
    wmBud.push(att(3, rep(100)))
    const sBud = wmBud.snapshot()
    assert.deepEqual([sBud.chars, sBud.budgetEvicted], [200, 1], '反向对照：预算 250 时同 3 条必逐出 1 条（闸是活的）')
  }

  // (丙) **真出口腿**：配置面（设置页那组数值框）经**真 Loader** 解析后确实进到实现里
  //      （= r0-assembly-check 同口径装配；缺省值必须能被 Schema 解析出来，显式值必须覆盖缺省）
  {
    const { ctx } = await bootChain({ capacityChunks: 2 }) // budgetChars 走 Schema 缺省
    const wm = ctx.get('mana-working-memory')
    assert.equal(wm.snapshot().budgetChars, 4000, 'Schema 缺省 4000 必须经真配置链解析进实现（不是只有接口声明）')
    assert.equal(wm.status().budgetChars, 4000, 'status 也必须能看到该键（否则设置页读数与行为脱钩）')
  }

  // (丁) **真出口 + 真数据**：预算 1 经真链生效 —— perception→attention→working-memory 放 3 条各 20 字
  {
    const { ctx, store } = await bootChain({ capacityChunks: 4, budgetChars: 1 })
    const wm = ctx.get('mana-working-memory')
    assert.equal(wm.snapshot().budgetChars, 1, '显式值必须覆盖 Schema 缺省')
    for (let i = 0; i < 3; i += 1) {
      const n = ctx.get('mana-perception').perceive({
        content: rep(20, String.fromCharCode(65 + i)), sessionId: 'g2', turnId: 1, requestId: 'g2-' + i,
      })
      assert.equal(n, 1, '每段应只产生一块')
    }
    await settle(400)
    const s = wm.snapshot()
    // push#1：单条 20 > 1 ⇒ 截断到 1（truncated=1, tc=19）
    // push#2：1+20 = 21 > 1 ⇒ 多块 ⇒ 逐出 req-1（budgetEvicted=1）⇒ 单条 20 > 1 ⇒ 截断（truncated=2, tc=38）
    // push#3：同理 ⇒ budgetEvicted=2；truncated=3, tc=57
    assert.deepEqual(
      [s.chunks.length, s.chars, s.budgetEvicted, s.truncated, s.truncatedChars],
      [1, 1, 2, 3, 57],
      '真链上预算闸必须真动作（修复前该配置下 chars=60、三笔账全 0 ⇒ 本腿必红）',
    )
    assert.equal(s.chunks[0].requestId, 'g2-2', '留最新一条')
    // **记账落审计面**（不是只在内存读数里）：只认带预算读数的 WM 行
    const rows = budgetRows(readTrace(store))
    assert.equal(rows.length, 3, '3 次放行 ⇒ 3 行**带预算读数**的落痕（记账字段没写进去 ⇒ 过滤后行数掉 ⇒ 本腿红）')
    const last = JSON.parse(rows[rows.length - 1].payload)
    assert.deepEqual(
      [last.budgetChars, last.chars, last.budgetEvicted, last.truncated, last.truncatedChars],
      [1, 1, 2, 3, 57],
      '落痕末行的预算读数必须与 snapshot 逐项一致（两处各算一遍 = 迟早对不上）',
    )
  }
})

test('W13 ⑨记账三层自洽 + 审计不泄内容：snapshot / status / mana_trace 三处同源', async () => {
  const { ctx, store } = await bootChain({ capacityChunks: 0, budgetChars: 40 })
  const wm = ctx.get('mana-working-memory')
  const contents = [rep(30, '甲'), rep(30, '乙'), rep(30, '丙')]
  for (const [i, c] of contents.entries()) {
    ctx.get('mana-perception').perceive({ content: c, sessionId: 'g2b', turnId: 1, requestId: 'g2b-' + i })
  }
  await settle(400)

  const s = wm.snapshot()
  const st = wm.status()
  // push#1：单条 30 ≤ 40 ⇒ 不动；push#2：30+30 = 60 > 40 ⇒ 逐出 req-0（budgetEvicted=1）；push#3：30+30 = 60 > 40 ⇒ 逐出 req-1（budgetEvicted=2）
  assert.deepEqual([s.chunks.length, s.chars, s.budgetEvicted, s.truncated], [1, 30, 2, 0])
  // ① snapshot 自洽（读数与实测内容一致）
  assert.equal(s.chars, s.chunks.reduce((n, c) => n + [...c.content].length, 0), 'chars 必须与逐块码点数之和一致')
  // ② status 与 snapshot 同源（含新记账键 —— 少一个就是"某处各算一遍"）
  assert.deepEqual(
    [st.size, st.chars, st.budgetChars, st.evicted, st.budgetEvicted, st.truncated, st.truncatedChars],
    [s.chunks.length, s.chars, s.budgetChars, s.evicted, s.budgetEvicted, s.truncated, s.truncatedChars],
    'status 与 snapshot 的记账读数必须逐项相等（同源）',
  )
  // ③ 落痕（审计面）与内存读数一致
  const rows = budgetRows(readTrace(store))
  assert.equal(rows.length, 3, '三次放行三行落痕')
  const seen = rows.map((r) => JSON.parse(r.payload))
  // push#2 的读数是 [size=1, chars=30, budgetEvicted=1]：**逐出后会重新评估 total**
  //   （60 > 40 逐出 1 条 → 30 ≤ 40 收手）⇒ 末态不是"超了还在超"的中间态。
  assert.deepEqual(
    seen.map((p) => [p.size, p.chars, p.budgetEvicted, p.truncated]),
    [[1, 30, 0, 0], [1, 30, 1, 0], [1, 30, 2, 0]],
    '落痕读数必须是**当次** push 后的真实状态（不是末态，也不是常量回填）',
  )
  // ④ 记账字段必须**随行为变**（常量回填会在这里露出来）
  assert.ok(seen[2].budgetEvicted > seen[0].budgetEvicted, '预算逐出数必须随放行推进而增长')
  // ⑤ **审计不泄内容**（W6 的既有不变式，对新增字段同样成立）
  for (const r of rows) {
    for (const c of contents) assert.equal(String(r.payload).includes(c), false, '落痕 payload 不得含内容原文（新增读数不得把内容带进审计面）')
  }
})

test('W14 ⑨防复发：每个 Config 键都必须出现在**真比较**里（budgetChars 那类死开关的机检门）', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const keys = [...src.matchAll(/^\s{2}([A-Za-z_$][\w$]*): Schema\./gm)].map((m) => m[1])
  assert.deepEqual(keys.sort(), ['budgetChars', 'capacityChunks'], 'Config 键集必须恰好是这两个（加键 ⇒ 本腿红，提醒为它补判据）')

  /**
   * 「该键有真闸」的**结构签名** = 出现在不等号比较里（`config.<key> > x` 或 `x > config.<key>`）。
   * ⚠ 这不替代行为腿（W9–W13 才是行为证据）—— 它的职责是**点出没有闸的键**：
   *   死开关的形态恰恰是"哪里都提到了它，但没有一处拿它做判断"。
   */
  const hasGate = (text, key) =>
    new RegExp('config\\.' + key + '\\s*(>|<|>=|<=)').test(text) ||
    new RegExp('(>|<|>=|<=)\\s*config\\.' + key + '\\b').test(text)

  const ungated = keys.filter((k) => !hasGate(src, k))
  assert.deepEqual(ungated, [], '下列配置键没有任何比较 ⇒ 疑似零消费死开关：' + ungated.join(', '))
  assert.equal(/void config/.test(src), false, '不得用 void config 把未消费的配置静默吃掉')

  // ── 本检查器的**负向控制**（证明它有负荷，不是恒绿）──────────────────────
  // ① 修复前的真实形态：只被回填进报告、从不参与比较（F4 实测的原样）
  const deadForm = 'const snap = { budgetChars: config.budgetChars }\n'
  assert.equal(hasGate(deadForm, 'budgetChars'), false, '负控1：只回填不回判 ⇒ 必须被判为无闸（修好前的 budgetChars 正是这一形态）')
  // ② 真闸形态必须判过（否则本检查器会把好代码判红）
  assert.equal(hasGate(src, 'budgetChars'), true, '负控2：真闸式必须判过')
  assert.equal(hasGate('config.capacityChunks > 0 && chunks.length > config.capacityChunks', 'capacityChunks'), true, '负控3：容量闸式必须判过')
})

