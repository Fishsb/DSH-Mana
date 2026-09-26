/**
 * **Recall Gate 判据**（B3.2-R · packages/long-term/src/recall-gate.ts）。
 *
 * 真源：docs/mana-v5-plan.md:437 / :468 / :482；
 * 判据真源：docs/mana-rollout-plan.md:462（A1-11）+ :459（A1-8 的 Recall 支路）
 *   + docs/mana-full-line-parallel-plan.md:163（本项的反证对拍 = 「去掉 degraded 标记 ⇒ 必红」）。
 *
 * ── 本文件为什么这样写（每条都对应一个已知的假绿形态）──────────────────────
 * 1. **不许只断言「值合法」**：只断言 gate === 'degraded' 这类判据，在「永远走降级」的实现下也恒绿。
 *    ⇒ 每条判据都同时断言该态的**另一个可区分字段**，且 ③ 把三态放在**同一张表**上对照。
 * 2. **不许用 ctx.emit**：mana/jev/judge 是 waterfall 型，用 emit 会同步抛（G6）
 *    ⇒ ②③ 都经 ctx.waterfall 真分发，并由桩记录「我真被调到了」（calls 计数）。
 * 3. **负向对拍必须在**：④ 把 degraded:true 从降级信封里**注入性地**去掉（纯内存克隆，
 *    **不写回仓内任何源文件** —— 与本仓 jev-gate.test.mjs 的 G6 同口径），断言同一段判据逻辑必红。
 *    没有这一条，③ 的绿只能证明「文件在长」。
 * 4. **不静默跳过**：判据条件不具备时**显式红**，不 skip。
 *
 * 运行（**显式路径**；通配在空集下会静默 exit 0）：
 *   node --test packages/long-term/tests/recall-gate.test.mjs
 * ⚠ 本文件已登记进 packages/long-term/verify.mjs 的 TEST_FILES（清空/删例即红）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 期望用例条数：**相等**语义（与 verify.mjs 的 TEST_FILES 同值；删一条即红）。 */
const EXPECTED_CASES = 7

const GATE_SRC = new URL('../src/recall-gate.ts', import.meta.url)
const LT_ENTRY = new URL('../src/index.ts', import.meta.url)
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const JEVMOD = new URL('../../jev/src/index.ts', import.meta.url).href
const mod = await import(GATE_SRC.href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tempDir = (tag) => {
  const d = mkdtempSync(join(tmpdir(), tag))
  dirs.push(d)
  return d
}

const CANDS = [
  { key: 'm-a', localScore: 0.9 },
  { key: 'm-b', localScore: 0.5 },
  { key: 'm-c', localScore: 0.1 },
]
const REQ = (over) => ({ requestId: 'r-rg', query: '末那识 召回 探针', candidates: CANDS, topK: 3, ...(over || {}) })

/**
 * **三态断言器**（正向跑与④的变异跑共用）。
 * ⚠ 它判的是 gate / degraded / rankBy / reason 四者**互相自洽**，而不是单看某一个字段
 *   —— 单字段断言正是「永远降级」能骗过的那一类。
 */
function assertGateCoherent(out, opts) {
  assert.equal(out.gate, opts.expect, 'gate 必须是 ' + opts.expect + '，实测 ' + out.gate)
  assert.ok(
    mod.RECALL_GATE_STATES.includes(out.gate),
    'gate 必须落在枚举内（不得出现 undefined / 自造字符串）：' + JSON.stringify(mod.RECALL_GATE_STATES),
  )
  if (out.gate === 'degraded') {
    assert.equal(out.degraded, true, 'gate=degraded ⇒ degraded 必须为 true（去掉它就是把降级伪装成正常）')
    assert.equal(typeof out.reason, 'string', 'reason 必须是字符串')
    assert.ok(out.reason.length > 0, 'gate=degraded ⇒ reason 必须**非空**（G8 硬约定 2）')
    assert.equal(out.channel, 'degraded', 'gate=degraded ⇒ channel 必须是 degraded')
    assert.equal(out.rankBy, 'local_score', '降级时 rankBy 必须是 local_score 而非 jev_prob（A1-11 原文）')
    assert.ok(
      out.items.every((h) => h.jevProb === null),
      '降级 ⇒ 每条命中的 jevProb 必须是 null（用 0 冒充「概率为零」是 G8 禁的）',
    )
  } else if (out.gate === 'below_threshold') {
    assert.equal(out.degraded, false, 'below_threshold 是**判过**的态 ⇒ degraded 必须为 false（它不是降级）')
    assert.ok(out.probed > 0, 'below_threshold ⇒ probed 必须 > 0（0 条送判就不叫「判了没过阈」）')
    assert.ok(out.judged > 0, 'below_threshold ⇒ 必须有真读数（judged > 0）')
    assert.equal(typeof out.reason, 'string', 'below_threshold 必须给出非空 reason 说清「判了没过阈」')
    assert.ok(out.reason.length > 0, 'below_threshold 的 reason 不得为空（空 = 与「没候选」同形）')
    assert.equal(out.rankBy, 'local_score', '未过阈 ⇒ 排序回落本地分')
    assert.ok(
      out.items.some((h) => typeof h.jevProb === 'number'),
      'below_threshold ⇒ 至少一条带**真读数**（否则它与降级不可分辨）',
    )
  } else {
    assert.equal(out.degraded, false, 'judged 是正常态 ⇒ degraded 必须为 false')
    assert.equal(out.reason, null, 'judged ⇒ reason 必须是 null（不空串、不 undefined）')
    assert.equal(out.rankBy, 'jev_prob', 'judged ⇒ 排序依据必须是 jev_prob（真判过才有资格标它）')
    assert.ok(out.judged > 0 && out.probed > 0, 'judged ⇒ probed/judged 均 > 0')
    assert.ok(out.items.length > 0, 'judged ⇒ 必须有通过阈值的命中')
  }
}

// ── ① 实现面清单：搬走实现即红 ───────────────────────────────────────────────

test('RG-① 实现面清单逐个在册且是函数（反「实现被挖空」）', async () => {
  // ⚠ 清单在**包入口**（index.ts，与另两张既有清单同一位置），实现**在模块里** ——
  //   本条断言的是两者的**对账**：入口登记了名字，模块里就必须真有那个函数。
  const entry = await import(LT_ENTRY.href)
  const names = entry.IMPLEMENTED_RECALL_GATE_EXPORTS || null
  assert.ok(Array.isArray(names) && names.length > 0, 'IMPLEMENTED_RECALL_GATE_EXPORTS 必须非空（否则本判据平凡通过）')
  for (const n of names) {
    assert.equal(typeof mod[n], 'function', '清单里的 ' + n + ' 必须在 recall-gate.ts 里是真函数（实现被搬走/改名 ⇒ 本断言红）')
    assert.equal(typeof entry[n], 'function', '清单里的 ' + n + ' 必须经包入口导出（只登记不导出 = 下游拿不到）')
  }
  assert.deepEqual(
    [...mod.RECALL_GATE_STATES],
    ['judged', 'below_threshold', 'degraded'],
    '三态枚举必须逐字是这三个（字面量面被判据点名）',
  )
  assert.equal(mod.RECALL_GATE_SOURCE, 'mana-long-term', 'source 标识必须可枚举')
  assert.ok(mod.RECALL_GATE_QUESTION.length > 0, '问法模板必须非空')
  const sorted = mod.sortByLocalScore([
    { key: 'x', localScore: 0.2 },
    { key: 'y', localScore: 0.9 },
    { key: 'z', localScore: 0.5 },
  ])
  assert.deepEqual(sorted.map((s) => s.key), ['y', 'z', 'x'], '降级路径必须给出确定次序（本地分降序）')
  assert.deepEqual(
    mod.sortByLocalScore([{ key: 'b', localScore: 1 }, { key: 'a', localScore: 1 }]).map((s) => s.key),
    ['a', 'b'],
    '同分必须按 key 升序（不依赖 sort 的稳定性）',
  )
})

// ── ② 态 3（不可用）：四条互不相同的入口都要显式降级 + 落痕 ──────────────────

test('RG-② 态3 不可用：无监听器 / 抛错 / 未发起 / 空候选，四条入口都给 degraded + 非空 reason', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  {
    const ctx = new Context()
    const out = await mod.recallGate(ctx, REQ({ requestId: 'r-nolistener' }))
    assertGateCoherent(out, { expect: 'degraded' })
    assert.ok(out.reason.includes('no-judge-listener'), 'reason 必须点名真因（no-judge-listener），实测 ' + out.reason)
    assert.equal(out.probed, 3, 'probed 必须如实报「确实送了几条」（不漏记尝试）')
    assert.equal(out.judged, 0, 'judged=0 是「没判成」的读数，不是「判了 0 分」')
    assert.deepEqual(out.items.map((h) => h.key), ['m-a', 'm-b', 'm-c'], '降级仍须返回**有序**的本地分结果（A1-8 原文）')
    t.diagnostic('[态3-a 无监听器] gate=' + out.gate + ' channel=' + out.channel + ' rankBy=' + out.rankBy + ' probed=' + out.probed + ' reason=' + out.reason.slice(0, 70))
  }
  {
    const ctx = new Context()
    ctx.on('mana/jev/judge', async () => {
      throw new Error('judge-boom-fixture')
    })
    const out = await mod.recallGate(ctx, REQ({ requestId: 'r-throw' }))
    assertGateCoherent(out, { expect: 'degraded' })
    assert.ok(out.reason.includes('judge-threw'), 'reason 必须点名真因（judge-threw），实测 ' + out.reason)
    assert.ok(out.reason.includes('judge-boom-fixture'), 'reason 必须带原始错误（否则「为什么不可用」不可查）')
  }
  {
    const ctx = new Context()
    const out = await mod.recallGate(ctx, REQ({ requestId: 'r-off' }), { judgeEnabled: false })
    assertGateCoherent(out, { expect: 'degraded' })
    assert.equal(out.probed, 0, '未发起 ⇒ probed 必须是 0（「没送判」与「送了没判成」是两件事）')
    assert.ok(out.reason.includes('judgeEnabled'), 'reason 必须说清是「未发起」，实测 ' + out.reason)
  }
  {
    const ctx = new Context()
    const out = await mod.recallGate(ctx, REQ({ requestId: 'r-empty', candidates: [] }))
    assertGateCoherent(out, { expect: 'degraded' })
    assert.equal(out.probed, 0)
    assert.equal(out.items.length, 0, '空候选 ⇒ items 必须为空数组（不是 undefined）')
  }
})

// ── ③ 态 1 / 态 2：真判定链上造「过阈」与「未过阈」 ───────────────────────────

test('RG-③ 态1/态2 真判定链：过阈 ⇒ judged/jev_prob；未过阈 ⇒ below_threshold/local_score', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const stub = (ctx, probOf) => {
    const calls = []
    ctx.on('mana/jev/judge', async (req) => {
      calls.push(req.judgeType)
      const p = probOf(req)
      return { requestId: req.requestId, source: 'stub', value: p >= 0.5 ? 'yes' : 'no', probability: p, degraded: false, reason: null }
    })
    return calls
  }
  {
    const ctx = new Context()
    const calls = stub(ctx, () => 0.91)
    const out = await mod.recallGate(ctx, REQ({ requestId: 'r-pass' }), { threshold: 0.7 })
    assertGateCoherent(out, { expect: 'judged' })
    assert.equal(calls.length, 3, '必须**真的**调了判定链 3 次（calls=0 说明没接上，而不是「判了」）')
    assert.deepEqual([...out.items.map((h) => h.key)].slice(0, 3), ['m-a', 'm-b', 'm-c'], '同概率 ⇒ 按本地分次序')
    assert.ok(calls.every((c) => c.indexOf('rel_') === 0), '问法必须用 rel_<id> 区分（实测 ' + JSON.stringify(calls) + '）')
    t.diagnostic('[态1 过阈] gate=' + out.gate + ' rankBy=' + out.rankBy + ' judged=' + out.judged + ' prob=' + out.items[0].jevProb + ' judgeType=' + calls[0])
  }
  {
    const ctx = new Context()
    const calls = stub(ctx, () => 0.21)
    const out = await mod.recallGate(ctx, REQ({ requestId: 'r-below' }), { threshold: 0.7 })
    assertGateCoherent(out, { expect: 'below_threshold' })
    assert.equal(calls.length, 3, '未过阈也必须**真的判过**（calls=3）；calls=0 而 gate=below_threshold 就是假的')
    assert.deepEqual(out.items.map((h) => h.key), ['m-a', 'm-b', 'm-c'], '未过阈 ⇒ 回落本地分次序')
    t.diagnostic('[态2 未过阈] gate=' + out.gate + ' degraded=' + out.degraded + ' rankBy=' + out.rankBy + ' reason=' + out.reason.slice(0, 70))
  }
  {
    const ctxA = new Context()
    stub(ctxA, () => 0.91)
    const a = await mod.recallGate(ctxA, REQ({ requestId: 'r-a' }), { threshold: 0.7 })
    const ctxB = new Context()
    stub(ctxB, () => 0.21)
    const b = await mod.recallGate(ctxB, REQ({ requestId: 'r-b' }), { threshold: 0.7 })
    const ctxC = new Context()
    const c = await mod.recallGate(ctxC, REQ({ requestId: 'r-c' }), { threshold: 0.7 })
    const triple = [a, b, c]
    assert.equal(new Set(triple.map((x) => x.gate)).size, 3, '三态必须各自可分辨，实测 gate=' + triple.map((x) => x.gate).join(' / '))
    assert.equal(new Set(triple.map((x) => x.rankBy)).size, 2, 'rankBy 必须能分辨「真判过」与「没判」：' + triple.map((x) => x.rankBy).join(' / '))
    assert.deepEqual(triple.map((x) => x.degraded), [false, false, true], 'degraded 位必须逐态不同：[过阈,未过阈,不可用] = [false,false,true]')
    assert.deepEqual(triple.map((x) => x.reason === null), [true, false, false], 'reason 空/非空必须逐态不同（空 ⇔ 正常放行）')
    t.diagnostic('[三态对照] ' + triple.map((x) => x.gate + '/' + x.rankBy + '/deg=' + x.degraded).join(' | '))
  }
})

// ── ④ 负向对拍：去掉 degraded 标记 ⇒ 同一段判据必红 ──────────────────────────

test('RG-④ 反证对拍：把降级信封里的 degraded:true 去掉 ⇒ 本判据必须报红（纯内存克隆）', async () => {
  const src = readFileSync(fileURLToPath(GATE_SRC), 'utf8')
  const needle = "    gate: 'degraded'," + String.fromCharCode(10) + "    channel: 'degraded',"
  assert.ok(src.includes(needle), '注入锚点必须**逐字**命中（锚点漂了本对拍就是空跑，必须红）')
  const mutantSrc = src.replace(needle, "    gate: 'judged'," + String.fromCharCode(10) + "    channel: 'vector',")
  assert.notEqual(mutantSrc, src, '克隆体必须真的被改过（未被改 ⇒ 下面的「必红」是假的）')
  const dir = tempDir('mana-rg-mutant-')
  const mutantPath = join(dir, 'recall-gate-mutant.ts')
  writeFileSync(mutantPath, mutantSrc)
  const mutant = await import(mutantPath)
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context()
  const out = await mutant.recallGate(ctx, REQ({ requestId: 'r-mutant' }))
  assert.equal(out.degraded, true, '克隆体仍返回 degraded=true（证明我改的是 gate/channel，不是整条降级链）')
  assert.equal(out.gate, 'judged', '克隆体的 gate 已被注入成 judged（前置：缺陷确实注进去了）')
  assert.throws(
    () => assertGateCoherent(out, { expect: 'degraded' }),
    (err) => err.message.indexOf('gate 必须是 degraded') >= 0 || err.message.indexOf('rankBy 必须是') >= 0,
    '去掉 degraded 标记后本判据必须报红 —— 若这条不抛，说明 RG-②③ 的绿与「降级被伪装」无关（判据无牙）',
  )
  assert.equal(readFileSync(fileURLToPath(GATE_SRC), 'utf8'), src, '变异不得写回仓内任何源文件（逐字节比对）')
})

// ── ⑤ 既有行为不得回归：不新挂 agent/pre-step、不写库、不 emit ────────────────

test('RG-⑤ 既有行为：不新挂 agent/pre-step，effect 面按 W1-3 口径恰 4 条且逐条点名', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const ltMod = await import(LT_ENTRY.href)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir('mana-rg-core-'), 'mana.db') })
  await settle(200)
  const fiber = ctx.plugin(ltMod)
  await settle(300)
  const labels = (fiber.getEffects() || []).map((e) => String(e.label)).sort()
  /**
   * ⚠ **本行由 W1-3 改写：3 → 4**（不是放宽，是同步交代）。
   *   W1-3 给本包接了写入路径（`mana/observation` → Write Gate），那是一条**真行为**，
   *   它 +1 条 effect（`ctx.on` 自带 effect，本批实测）。
   *   ⇒ 本判据**按设计红了**（它的意图是"多一条行为即红 ⇒ 强制交代"）。
   *
   *   ⚠ 为什么仍逐条点名下面几条：只断言数量的话，"删掉 G9 的 pre-step 那条来腾位置"
   *     也会绿 —— 那是拆东墙补西墙。数量 + 逐条点名，两个都要。
   */
  assert.equal(labels.length, 4, '本包 effect 面应为 4 条（W1-3 起：原 3 条 + Write Gate 监听器）；实测 ' + labels.length + '：' + JSON.stringify(labels))
  const preStepCount = labels.filter((l) => l.indexOf('pre-step') >= 0).length
  assert.equal(preStepCount, 1, 'agent/pre-step 注册点必须**仍只有 1 个**（G9：每多挂一个就多一处漏调 next() 的风险）；实测 ' + preStepCount)
  // W1-3 新增的那一条单独点名；且它**不得**是 pre-step（别把写入路径挂到宿主扩展点上）。
  assert.ok(
    labels.some((l) => l.indexOf('mana/observation') >= 0),
    'W1-3 起须有 mana/observation 监听器（写入路径触发点）；实测 ' + JSON.stringify(labels),
  )
  let sentinel = 0
  let inner = 0
  ctx.on('agent/pre-step', async (_p, next) => {
    sentinel += 1
    return await next()
  })
  await ctx.waterfall(
    'agent/pre-step',
    { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    async () => {
      inner += 1
      return { messages: [] }
    },
  )
  assert.equal(sentinel, 1, '链尾哨兵必须走一次（0 = 有监听器漏调 next()）；实测 ' + sentinel)
  assert.equal(inner, 1, '最内层 next 必须被走到')
  const core = ctx.get('mana-core')
  const count = () => Number(core.db.prepare('SELECT count(*) c FROM mana_trace').get().c)
  const before = count()
  let emitted = 0
  ctx.on('mana/recall', () => { emitted += 1 })
  const svc = ctx.get('mana-long-term')
  assert.equal(typeof svc.recallGate, 'function', '服务面必须暴露 recallGate（未接线 = 本批没落地）')
  const out = await svc.recallGate(ctx, REQ({ requestId: 'r-nosrv' }))
  await settle(120)
  assert.equal(out.gate, 'degraded', '本仓未装判定链监听器 ⇒ 必然显式降级（fail-degraded）')
  assert.equal(count(), before, '本批**不写** mana_trace（skeleton.test.mjs ⑧ 的同一读数必须仍成立）')
  assert.equal(emitted, 0, '本批**不** emit 任何 Mana 事件（不新增事件契约面）')
  t.diagnostic('[边界自证] effect=4（pre-step×1 + mana/observation×1）· 哨兵=' + sentinel + ' · mana_trace 增量=' + (count() - before) + ' · mana/recall emit=' + emitted)
  await ctx.stop?.()
})

// ── ⑥ 与既有 jev 插件真件联跑：同一调用走到真监听器（不是桩）──────────────────

test('RG-⑥ 与既有 jev 插件真件联跑：装上 mana-jev 后 recallGate 走到它的监听器', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(JEVMOD)
  const ltMod = await import(LT_ENTRY.href)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir('mana-rg-jev-'), 'mana.db') })
  await settle(200)
  ctx.plugin(jevMod, {})
  await settle(200)
  ctx.plugin(ltMod)
  await settle(300)
  const svc = ctx.get('mana-long-term')
  const out = await svc.recallGate(ctx, REQ({ requestId: 'r-real' }), { threshold: 0.7 })
  assertGateCoherent(out, { expect: out.gate })
  assert.ok(['judged', 'below_threshold', 'degraded'].includes(out.gate), 'gate 必须落在三态枚举内')
  t.diagnostic('[真件联跑] gate=' + out.gate + ' channel=' + out.channel + ' rankBy=' + out.rankBy + ' degraded=' + out.degraded + ' probed=' + out.probed + ' judged=' + out.judged)
  await ctx.stop?.()
})

// ── ⑦ 用例计数自检（防本文件被截断/删例 —— 空文件在 node --test 下报 tests 1/pass 1 的假绿）──

test('RG-⑦ 用例计数自检', () => {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const n = src.split(String.fromCharCode(10) + 'test(').length - 1
  assert.equal(n, EXPECTED_CASES, '本文件用例数必须恰好 ' + EXPECTED_CASES + '（实测 ' + n + '）；改数量须同步 verify.mjs 的 TEST_FILES')
})