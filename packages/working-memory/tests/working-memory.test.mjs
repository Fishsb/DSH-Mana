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
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
async function bootChain({ capacityChunks = 4 } = {}) {
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
  await ctx.loader.create({ name: 'dsh-mana-working-memory', config: { capacityChunks } })
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
 *   · 工作记忆行：`{requestId, size, capacityChunks, evicted, didEvict}`
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

/** 造一条**真作意放行**（字段形状 = attention 广播的那条，attention/src/index.ts:173-181）。 */
const att = (i) => ({
  sessionId: 'sess-wm',
  turnId: 1,
  requestId: `req-${i}`,
  at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
  content: `内容${i}`, // 3 码点/字
  jevProbability: null,
  degraded: false,
})

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
  assert.deepEqual(Object.keys(snap).sort(), ['budgetChars', 'capacityChunks', 'chars', 'chunks', 'evicted'])
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
