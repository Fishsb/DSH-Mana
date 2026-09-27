/**
 * **Recall Gate × 判定链落痕对账判据**（c2 首建 · **f3 加强**）。
 *
 * ── 本文件判什么（不是「值合法」，而是「库里行集 == 声明集」）────────────────
 * 核心是 assertRowsMatchDeclaration：把「声明」与「实际落库行」做**集合级对账**，
 * 并**先断言声明内部无重复** —— 两条合起来才覆盖 f3 派单点名的两条反例：
 *   ① **重复候选键**：派生同一 id ⇒ 后一条撞 jev_log.id 主键 ⇒ 声明 3、实落 2；
 *   ② **候选抛错**：抛错路径没有「已落痕」证据 ⇒ 声明 3、实落 2。
 * ⚠ 上一版的唯一反证腿是 assert.notEqual(增量, 3)，它对这两条**无感**（落 2 行照样绿）——
 *   本文件把它换成集合对账（**声明面**对账），这是 f3 的核心修法。
 *
 * ── 历史（不删）───────────────────────────────────────────────────────────────
 * c2（2026-09-26）：逐候选复用同一 requestId ⇒ 主键冲突、N 条只落 1 行。该轮只修了
 * 那一条报出来的路径；f3 把「id 唯一性」当**不变量**重过一遍，补上：去重（路径①）、
 * 抛错不进声明（路径②）、拼接式单射化（路径③）。
 *
 * 运行（**显式路径**）：node --test packages/long-term/tests/recall-gate-jevlog.test.mjs
 * ⚠ 已登记进 packages/long-term/verify.mjs 的 TEST_FILES（清空/删例即红）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_CASES = 12

const GATE_SRC = new URL('../src/recall-gate.ts', import.meta.url)
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const JEVMOD = new URL('../../jev/src/index.ts', import.meta.url).href
const FRAMEWORK = new URL('../../jev/src/framework.ts', import.meta.url).href
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

/** 3 条候选（最小可判规模）。 */
const CANDS = [
  { key: 'm-a', localScore: 0.9 },
  { key: 'm-b', localScore: 0.5 },
  { key: 'm-c', localScore: 0.1 },
]

/** 假 Ollama：**不依赖网络**，返回合法 yes 族 logprob 响应。 */
const fakeFetchYes = async () =>
  new Response(
    JSON.stringify({
      logprobs: [{ top_logprobs: [{ token: 'yes', logprob: Math.log(0.9) }, { token: 'no', logprob: Math.log(0.1) }] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

/**
 * **核心断言器（f3 加强）**：把「本批**新增**的落库行」与「声明集」对账。
 *
 * ⚠ 用**增量集**（before/after 快照之差）而不是"按前缀筛全表"—— 后者在
 *   「requestId 被两批复用」时会把**上一批的同一批 id** 也算进来，于是「增量 0」被抹平。
 *   本批实测踩到这一点（RG-JL-⑥ 首版因此不红），故改成快照差。
 *
 * 三条腿，缺任何一条都有反例能蒙混过关：
 *   ① 声明内部**无重复**（重复 ⇒ 声明多于可落行；「声明 3 实落 2」的根因正是这个）；
 *   ② **增量集 == 声明集**（集合相等，不是计数相等 —— 计数对了但 id 串了仍须可见）；
 *   ③ **增量条数 == 声明条数**（主键冲突 / 复用 requestId 时增量为 0，而②会因 id 相同而巧合成立）。
 */
function assertRowsMatchDeclaration(out, addedIds, batchRequestId) {
  assert.equal(
    out.judgeIds.length,
    new Set(out.judgeIds).size,
    'judgeIds 内不得有重复（「声明 3 实落 2」的根因正是重复键派生同一 id）：' + JSON.stringify(out.judgeIds),
  )
  assert.equal(
    addedIds.length,
    out.judgeIds.length,
    '本批**新增**的落库行数必须等于声明数（声明 ' + out.judgeIds.length + ' / 新增 ' + addedIds.length + '）' +
      '—— 二者不等即「声明强于实际」：主键冲突（重复键或复用 requestId）或抛错未落痕都会走到这里',
  )
  assert.deepEqual(
    [...addedIds].sort(),
    [...out.judgeIds].sort(),
    '本批新增的行集必须**等于**声明集（声明 ' + out.judgeIds.length + ' / 新增 ' + addedIds.length + '）',
  )
  assert.equal(addedIds.length, new Set(addedIds).size, '新增行 id 不得有重复（库层由主键保证，这里作二次自证）')
  // ⚠ **声明侧的双向性**：`addedIds.length == judgeIds.length` 已在上文断言 ⇒
  //   「声明多于行」与「声明少于行」**同一处**被覆盖（不需要两条方向腿）。
  //   下面这一条把「声明少于行」的原因**点名**（否则读者只看到计数不等）：
  const missing = addedIds.filter((id) => !out.judgeIds.includes(id))
  assert.equal(
    missing.length,
    0,
    '**声明少于行**（反向不变量）：库里新增了声明里没有的行 —— 生产者侧「先落痕后调 next()」+ 下游抛错即此形态。实测多出来的行：' + JSON.stringify(missing),
  )
  // 前缀自证：本批新增的 id 必须真带本批前缀（防"新增了别的东西"被算成本批）
  const prefix = mod.judgeIdFor(batchRequestId, '')
  for (const id of addedIds) {
    assert.ok(id.startsWith(prefix), '本批新增行必须带本批前缀 ' + prefix + '，实测 ' + id)
  }
}

/** 两次快照之差（本批**新增**的 id）。 */
function addedIdsOf(beforeIds, afterIds) {
  const b = new Set(beforeIds)
  return afterIds.filter((id) => !b.has(id))
}

/** 装 core + long-term；可选再装真 jev 插件。 */
async function mount(tag, withJev) {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const ltMod = await import(new URL('../src/index.ts', import.meta.url).href)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir(tag), 'mana.db') })
  await settle(200)
  if (withJev) {
    const jevMod = await import(JEVMOD)
    ctx.plugin(jevMod, {})
    await settle(200)
  }
  ctx.plugin(ltMod)
  await settle(300)
  return { ctx, core: ctx.get('mana-core'), svc: ctx.get('mana-long-term') }
}

/**
 * 挂一个**确定性**判定监听器（真生产者 judgeWithGuard + 注入 fetch）。
 * failForKey: 该候选键的判定**在落痕之前**抛错（模拟路径②）。
 */
async function attachProd(ctx, core, failForKey) {
  const fw = await import(FRAMEWORK)
  const guard = new fw.JevGuard({ maxConcurrency: 8, sessionBudget: 1000 })
  const seen = []
  ctx.on('mana/jev/judge', async (req) => {
    seen.push({ callerThreshold: req.threshold, judgeId: req.requestId })
    if (failForKey && req.judgeType === 'rel_' + failForKey) {
      throw new Error('judge-boom-fixture:' + failForKey)
    }
    const o = await fw.judgeWithGuard({
      guard, db: core.db, state: req.state, question: req.question,
      idFactory: () => req.requestId, sessionId: req.sessionId, turnId: req.turnId,
      fetchImpl: fakeFetchYes, channel: 'ollama',
    })
    return { requestId: o.requestId, source: o.source, value: o.value, probability: o.probability, degraded: o.degraded, reason: o.reason }
  })
  return seen
}
// ── ① 判定键派生：唯一 + **单射**（不变量级复核，f3 新增）────────────────────

test('RG-JL-① 判定键派生：同批唯一、跨批不复用、拼接式单射（反解唯一）', () => {
  for (const n of ['judgeIdFor', 'encodeIdPart', 'judgeIdParts']) {
    assert.equal(typeof mod[n], 'function', n + ' 必须是具名导出（唯一化规则与转义必须可被判据点名）')
  }
  const ids = CANDS.map((c) => mod.judgeIdFor('r-batch-1', c.key))
  assert.equal(new Set(ids).size, ids.length, '同批次内判定键必须互不相同：' + JSON.stringify(ids))
  assert.deepEqual(ids, ['r-batch-1#rel_m-a', 'r-batch-1#rel_m-b', 'r-batch-1#rel_m-c'], '无特殊字符时输出必须与转义前逐字节相同（既有日志/断言不受影响）')
  const other = CANDS.map((c) => mod.judgeIdFor('r-batch-2', c.key))
  assert.equal(new Set([...ids, ...other]).size, ids.length + other.length, '跨批次键不得复用')
  const collide1 = mod.judgeIdFor('r#rel_x', 'y')
  const collide2 = mod.judgeIdFor('r', 'x#rel_y')
  assert.notEqual(collide1, collide2, '拼接式必须单射：含 # 的两个分量组合不得撞成同一 id（实测 ' + collide1 + ' vs ' + collide2 + '）')
  for (const pair of [['r-batch-1', 'm-a'], ['r#rel_x', 'y'], ['r', 'x#rel_y'], ['r%23', 'k%']]) {
    const b = pair[0]
    const k = pair[1]
    const id = mod.judgeIdFor(b, k)
    const parts = mod.judgeIdParts(id)
    assert.deepEqual(parts, { batchRequestId: b, key: k }, '反解必须唯一还原 (' + b + ',' + k + ') ⇒ ' + id)
    assert.equal(mod.judgeIdFor(parts.batchRequestId, parts.key), id, '再拼接必须逐字回到原 id（单射的可执行证据）')
  }
  assert.equal(mod.judgeIdParts('not-a-judge-id'), null, '非本规则的串必须返回 null（不得当成「解出空键」）')
})
// ── ② 路径①：**重复候选键** ⇒ 声明集 == 落库行集（f3 主修 1）────────────────
test('RG-JL-② 路径①重复候选键：去重后声明集 == 落库行集，且 duplicateKeys 显式报出', async (t) => {
  const { ctx, core, svc } = await mount('mana-rgjl-dup-', false)
  await attachProd(ctx, core, null)
  const idsOf = () => core.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
  const beforeIds = idsOf()
  const dupCands = [
    { key: 'm-a', localScore: 0.9 },
    { key: 'm-a', localScore: 0.5 },
    { key: 'm-b', localScore: 0.1 },
  ]
  const out = await svc.recallGate(
    ctx,
    { requestId: 'r-dup', query: '末那识 召回 探针', candidates: dupCands, topK: 5, sessionId: 's-dup', turnId: 1 },
    { threshold: 0.7, judgeEnabled: true },
  )
  await settle(120)
  const added = addedIdsOf(beforeIds, idsOf())
  assert.deepEqual(out.duplicateKeys, ['m-a'], '重复键必须**显式报出**（静默去重 = 让「输入有重复」不可观测）：' + JSON.stringify(out.duplicateKeys))
  assert.equal(out.probed, 2, '去重后送判定的是 2 条（不是 3 条）')
  assert.equal(out.probedKeys.length, 2, 'probedKeys 与去重后的候选同长')
  assertRowsMatchDeclaration(out, added, 'r-dup')
  t.diagnostic('[路径①重复键] probed=' + out.probed + ' judged=' + out.judged + ' duplicateKeys=' + JSON.stringify(out.duplicateKeys) + ' 声明=' + JSON.stringify(out.judgeIds) + ' 落库增量=' + added.length)
})

// ── ③ 路径②：**候选抛错** ⇒ 抛错的不进声明，声明集 == 落库行集（f3 主修 2）──
test('RG-JL-③ 路径②候选抛错：抛错项进 threwKeys **不进 judgeIds**，声明集 == 落库行集', async (t) => {
  const { ctx, core, svc } = await mount('mana-rgjl-threw-', false)
  await attachProd(ctx, core, 'm-b')
  const idsOf = () => core.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
  const beforeIds = idsOf()
  const out = await svc.recallGate(
    ctx,
    { requestId: 'r-threw', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-threw', turnId: 2 },
    { threshold: 0.7, judgeEnabled: true },
  )
  await settle(120)
  const added = addedIdsOf(beforeIds, idsOf())
  assert.deepEqual(out.threwKeys, ['m-b'], '抛错候选必须**显式报出**，且**不得**算进 judgeIds：' + JSON.stringify(out.threwKeys))
  assert.equal(out.probedKeys.length, 3, 'probedKeys 记的是「已派发」3 条')
  assert.equal(out.judgeIds.length, 2, 'judgeIds 记的是「已返回」2 条（抛错那条没有落痕证据 ⇒ 不得进声明）')
  assert.equal(out.judged, 2, 'judged 与已返回的两条一致')
  assertRowsMatchDeclaration(out, added, 'r-threw')
  t.diagnostic('[路径②抛错] probed=' + out.probedKeys.length + ' judgeIds=' + out.judgeIds.length + ' threwKeys=' + JSON.stringify(out.threwKeys) + ' 落库增量=' + added.length)
})
// ── ④ 反证腿（**替换旧的无感腿**）：去掉去重 ⇒ 路径①的集合对账**必红** ──────
test('RG-JL-④ 反证：把去重变异掉 ⇒ 路径①（重复键）的集合对账必红', async () => {
  const src = readFileSync(fileURLToPath(GATE_SRC), 'utf8')
  const needle = '  const deduped = ordered.filter((c, i) => ordered.findIndex((x) => x.key === c.key) === i)'
  assert.ok(src.includes(needle), '注入锚点必须逐字命中（锚点漂了本对拍就是空跑，必须红）')
  const mutantSrc = src.split(needle).join('  const deduped = ordered')
  assert.notEqual(mutantSrc, src)
  const dir = tempDir('mana-rgjl-nodedupe-')
  const mutantPath = join(dir, 'recall-gate-mutant.ts')
  writeFileSync(mutantPath, mutantSrc)
  const mutant = await import(mutantPath)
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(200)
  const core = ctx.get('mana-core')
  await attachProd(ctx, core, null)
  const idsOf = () => core.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
  const beforeIds = idsOf()
  const dupCands = [{ key: 'm-a', localScore: 0.9 }, { key: 'm-a', localScore: 0.5 }, { key: 'm-b', localScore: 0.1 }]
  const out = await mutant.recallGate(
    ctx,
    { requestId: 'r-nodedupe', query: '末那识 召回 探针', candidates: dupCands, topK: 5, sessionId: 's-nd', turnId: 1 },
    { threshold: 0.7, judgeEnabled: true },
  )
  await settle(120)
  assert.equal(out.judgeIds.length, 3, '克隆体仍**声明 3**（证明我改的是去重，不是别处）')
  assert.throws(
    () => assertRowsMatchDeclaration(out, addedIdsOf(beforeIds, idsOf()), 'r-nodedupe'),
    (e) => /judgeIds 内不得有重复|等于\*\*声明集/.test(e.message),
    '去掉去重后，本集合对账**必须报红** —— 若不抛，说明 f3 的加强腿是空的（又回到「落 2 行照样绿」）',
  )
  assert.equal(readFileSync(fileURLToPath(GATE_SRC), 'utf8'), src, '变异不得写回仓内任何源文件（逐字节比对）')
  // ── 路径②：把「抛错的不进声明」变异掉（judgeIds 改用 probedCandidates）────
  const needle2 = '      judgeIds: returnedKeys.map((k) => judgeIdFor(requestId, k)),'
  assert.ok(src.includes(needle2), '路径②注入锚点必须逐字命中')
  const mutant2Src = src.split(needle2).join('      judgeIds: probedCandidates.map((c) => judgeIdFor(requestId, c.key)),')
  const dir2 = tempDir('mana-rgjl-threwmut-')
  const mutant2Path = join(dir2, 'recall-gate-mutant2.ts')
  writeFileSync(mutant2Path, mutant2Src)
  const mutant2 = await import(mutant2Path)
  const { Context: Ctx2 } = await import('@deepseek-ai/cordis')
  const ctx2 = new Ctx2()
  ctx2.plugin(coreMod, { storePath: join(dir2, 'mana.db') })
  await settle(200)
  const core2 = ctx2.get('mana-core')
  await attachProd(ctx2, core2, 'm-b')
  const ids2 = () => core2.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
  const before2 = ids2()
  const out2 = await mutant2.recallGate(
    ctx2,
    { requestId: 'r-threwmut', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-tm', turnId: 1 },
    { threshold: 0.7, judgeEnabled: true },
  )
  await settle(120)
  assert.equal(out2.judgeIds.length, 3, '克隆体声明 3（含抛错的 m-b）—— 证明我改的是「抛错是否进声明」，不是别处')
  assert.throws(
    () => assertRowsMatchDeclaration(out2, addedIdsOf(before2, ids2()), 'r-threwmut'),
    (e) => /新增\*\*的落库行数必须等于声明数|行集必须\*\*等于\*\*声明集/.test(e.message),
    '把抛错项算进声明后，集合对账**必须报红**（这正是 f3 要覆盖的路径②）',
  )

  // ── 路径③：把单射化变异掉（分量不转义 ⇒ 分隔符可出现在内容里）──────────
  const needle3 = 'return `' + '${encodeIdPart(batchRequestId)}#rel_${encodeIdPart(key)}' + '`'
  assert.ok(src.includes(needle3), '路径③注入锚点必须逐字命中')
  const mutant3Src = src.split(needle3).join('return `' + '${batchRequestId}#rel_${key}' + '`')
  assert.notEqual(mutant3Src, src)
  const dir3 = tempDir('mana-rgjl-inj-')
  const mutant3Path = join(dir3, 'recall-gate-mutant3.ts')
  writeFileSync(mutant3Path, mutant3Src)
  const mutant3 = await import(mutant3Path)
  assert.equal(
    mutant3.judgeIdFor('r#rel_x', 'y'),
    mutant3.judgeIdFor('r', 'x#rel_y'),
    '去单射化后两个不同 (批次,键) 对**必须**撞成同一 id —— 这是路径③的前置（若这里不撞，说明锚点没打中）',
  )
  assert.notEqual(mod.judgeIdFor('r#rel_x', 'y'), mod.judgeIdFor('r', 'x#rel_y'), '而本仓实现必须**不**撞（单射腿在护的就是这一条）')
})
// ── ⑤ 既有结论不回退：三态可分辨 + 降级不标 jev_prob ─────────────────────────
test('RG-JL-⑤ 既有结论不回退：三态可分辨、降级不标 jev_prob、rankBy 回落', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { ctx, svc } = await mount('mana-rgjl-states-', false)
  const REQ = (rid) => ({ requestId: rid, query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 'sess-rgjl2', turnId: 3 })
  const below = await svc.recallGate(ctx, REQ('r-below'), { threshold: 0.99 })
  const bare = new Context()
  const down = await mod.recallGate(bare, { requestId: 'r-nl', query: 'x', candidates: CANDS, topK: 3 })
  assert.equal(down.gate, 'degraded', '无监听器 ⇒ 必须显式降级（fail-degraded）')
  assert.equal(down.degraded, true)
  assert.equal(down.rankBy, 'local_score', '态3 ⇒ rankBy 必须回落 local_score（绝不标 jev_prob）')
  assert.ok(down.reason.length > 0, '态3 ⇒ reason 非空')
  assert.ok(down.items.every((h) => h.jevProb === null), '态3 ⇒ 每条 jevProb 必须为 null（0 不得冒充）')
  const judgedStub = new Context()
  judgedStub.on('mana/jev/judge', async (req) => ({ requestId: req.requestId, source: 'stub', value: 'yes', probability: 0.9, degraded: false, reason: null }))
  const pass = await mod.recallGate(judgedStub, { requestId: 'r-pass', query: 'x', candidates: CANDS, topK: 3 })
  assert.equal(pass.gate, 'judged')
  assert.equal(pass.rankBy, 'jev_prob')
  assert.deepEqual([pass.gate, down.gate], ['judged', 'degraded'], '三态必须仍可分辨（不得回退）')
  assert.ok(['judged', 'below_threshold', 'degraded'].includes(below.gate), '绑定真件的那次调用必须落在三态枚举内')
  t.diagnostic('[不回退自证] pass=' + pass.gate + '/' + pass.rankBy + ' · 无监听器=' + down.gate + '/' + down.rankBy + ' · 真件=' + below.gate)
})

// ── ⑥ 前置条件腿（f3 新增）：同一 requestId 被两批复用 ⇒ 家族失效**且可检出**──
test('RG-JL-⑥ 前置条件：同一 requestId 被两批复用 ⇒ 第二批撞主键、家族失效（本腿即"可检出"的证据）', async (t) => {
  const { ctx, core, svc } = await mount('mana-rgjl-reuse-', false)
  await attachProd(ctx, core, null)
  const idsOf = () => core.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
  const REQ = { requestId: 'r-reuse', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-reuse', turnId: 1 }
  const ids0 = idsOf()
  const first = await svc.recallGate(ctx, REQ, { threshold: 0.7, judgeEnabled: true })
  await settle(120)
  const ids1 = idsOf()
  const added1 = addedIdsOf(ids0, ids1)
  assertRowsMatchDeclaration(first, added1, 'r-reuse')
  const second = await svc.recallGate(ctx, REQ, { threshold: 0.7, judgeEnabled: true })
  await settle(120)
  const ids2 = idsOf()
  const added2 = addedIdsOf(ids1, ids2)
  assert.equal(added2.length, 0, '前置条件被违反时：第二批新增 0 行（主键冲突）—— 这正是该前置条件**可被检出**的证据')
  assert.throws(
    () => assertRowsMatchDeclaration(second, added2, 'r-reuse'),
    (e) => /新增\*\*的落库行数必须等于声明数/.test(e.message),
    '本腿必须能判红：若不抛，说明前置条件被违反时家族仍声称成立（那又是一条无感判据）',
  )
  assert.equal(readFileSync(fileURLToPath(import.meta.url), 'utf8').includes('前置条件'), true, '自证本腿在册')
  t.diagnostic('[前置条件] 第一批声明 ' + first.judgeIds.length + ' 新增=' + added1.length + '；第二批声明 ' + second.judgeIds.length + ' 新增=' + added2.length + ' ⇒ 复用 requestId 会让家族失效（调用方前置条件，已在 judgeIds 文档写明）')
})

// ── ★ 反向路径（f3 收尾新增）：真 jev 降级分支「先落痕后调 next()」+ 下游抛错 ──
test('RG-JL-★ 反向：真 jev ★ 下游抛错 ⇒ 声明必须**仍等于**新增行数（不得声明少于行）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(JEVMOD)
  const ltMod = await import(new URL('../src/index.ts', import.meta.url).href)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir('mana-rgjl-star-'), 'mana.db') })
  await settle(200)
  // ① 装**真件** dsh-mana-jev，并把它**推入降级分支**（端点恒不可达）——
  //    只有降级分支才会「先落痕（judgeGuarded）→ 后 await next()」，本用例要测的正是那一段。
  //    ⚠ 若端点可达（本机 Ollama 在跑），jev 走**成功路径直接返回 ⇒ 不调 next()** ⇒ 本用例
  //      会变成"没走到那条路径"，故必须显式把端点钉死为不可达。
  //    ⚠⚠ **端点不可达还不够**（本卡 t-mujzyy6m 实测的假前提）：jev 的 `channel` **缺省是云端**
  //      （`systemone`，其驱动读 `NANOGPT_API_KEY`）——**有真 key 时端点参数根本不被使用**：
  //      它走云端判定、**判得出** ⇒ 成功路径 ⇒ 不调 next() ⇒ 下面那个"必抛的下游"压根不被调到
  //      ⇒ 本用例红（实测：无 key 12/12 绿 · 有真 key 11/12，红在本条）。
  //      ⇒ 必须**同时** pin 通道为替身（'ollama'），端点才是"生效端点"（status().endpoint 同源，见下）。
  //    ⚠ 这是**判据的前提缺陷**，不是产品缺陷：监听器"判得出就直接返回、不调 next()"是设计。
  ctx.plugin(jevMod, { channel: 'ollama', endpoint: 'http://127.0.0.1:1', concurrencyWaitTimeoutMs: 200 })
  await settle(200)
  // ⚠ **显式声明自证**（与 ⑥c / Q1 同一处理，理由见那两处的长注）：把"本用例确实挂在替身通道上"
  //   变成可读读数 —— 缺省再被翻转时本用例自己报红并点名原因，而不是静默改道云端。
  assert.equal(
    ctx.get('mana-jev').status().channel,
    'ollama',
    '本用例必须挂在**替身通道**上（显式 channel:' + "'ollama'" + '）—— 否则端点参数不被使用、判定会走云端；实测生效通道 = ' +
      ctx.get('mana-jev').status().channel,
  )
  // ② 在 jev **下游**挂一个必抛的监听器（jest 的 `ctx.on` 后注册者在更内层）
  ctx.on('mana/jev/judge', async () => {
    throw new Error('downstream-boom-fixture')
  })
  ctx.plugin(ltMod)
  await settle(300)
  const core = ctx.get('mana-core')
  const svc = ctx.get('mana-long-term')
  const idsOf = () => core.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
  const beforeIds = idsOf()
  const out = await svc.recallGate(
    ctx,
    { requestId: 'r-star', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-star', turnId: 9 },
    { threshold: 0.7, judgeEnabled: true },
  )
  await settle(150)
  const added = addedIdsOf(beforeIds, idsOf())
  t.diagnostic('[★ 反向] gate=' + out.gate + ' failureKind=' + out.failureKind + ' 声明=' + out.judgeIds.length + ' 新增行=' + added.length + ' threwKeys=' + JSON.stringify(out.threwKeys))
  // 前置：这条路径真被走到（真 jev 降级 + 下游抛错）
  assert.ok(added.length > 0, '前置：本路径必须**真的**落了行（jev 降级分支先落痕）；实测新增 ' + added.length + ' 行 —— 若为 0，说明本用例没走到那条路径（不是"通过"）')
  assert.equal(out.threwKeys.length, added.length, '抛错候选数必须等于落痕行数（每条都"已落痕但下游抛错"）')
  // ★ 反向不变量的核心断言：声明必须等于新增行集
  assertRowsMatchDeclaration(out, added, 'r-star')
  assert.equal(out.failureKind, 'downstream-threw', '归因必须是 downstream-threw（**不得**写成「判定链不可用」）：' + out.failureKind)
  assert.ok(!/判定链不可用/.test(out.reason), 'reason 不得写成「判定链不可用」（归因串味）：' + out.reason)
  assert.ok(/下游/.test(out.reason), 'reason 必须点名"下游"这一环：' + out.reason)
})

// ── ⑥ 正常出口的落痕失败（f3 收尾新增）：DROP jev_log ⇒ 声明必须 == 行（必须报红）──
test('RG-JL-⑥b 正常出口 + **落痕失败**（DROP jev_log）⇒ 不得声明多于行', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(JEVMOD)
  const fw = await import(FRAMEWORK)
  const LT = new URL('../src/index.ts', import.meta.url).href
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir('mana-rgjl-droptbl-'), 'mana.db') })
  await settle(200)
  ctx.plugin(jevMod, {})
  await settle(200)
  // 用**真件生产者** judgeWithGuard（其落痕失败不抛、只记 traceError）+ 注入 fetch 保证走**正常出口**
  const core = ctx.get('mana-core')
  const guard = new fw.JevGuard({ maxConcurrency: 8, sessionBudget: 1000 })
  ctx.on('mana/jev/judge', async (req) => {
    const o = await fw.judgeWithGuard({
      guard, db: core.db, state: req.state, question: req.question,
      idFactory: () => req.requestId, sessionId: req.sessionId, turnId: req.turnId,
      fetchImpl: fakeFetchYes, channel: 'ollama',
    })
    return {
      requestId: o.requestId, source: o.source, value: o.value, probability: o.probability,
      degraded: o.degraded, reason: o.reason,
      traceWritten: o.traceError === null || o.traceError === undefined,
    }
  })
  ctx.plugin(await import(LT))
  await settle(300)
  const svc = ctx.get('mana-long-term')
  // ⚠ 造落痕失败：把 jev_log **改名**（`DROP TABLE` 属物理删除，本仓禁止 ⇒ 用 `ALTER` 改名，可逆）。
  //   改名后 `INSERT INTO jev_log` 会抛 "no such table" ⇒ 被 `makeJevOutcome` 捕获记进
  //   `traceError` 并**照旧返回** ⇒ 正常出口的落痕失败。
  core.db.exec('ALTER TABLE jev_log RENAME TO jev_log_hidden')
  const idsOf = () => {
    const t = core.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'jev_log%'").all().map((r) => r.name)
    const table = t.includes('jev_log') ? 'jev_log' : 'jev_log_hidden'
    return core.db.prepare('SELECT id FROM ' + table + ' ORDER BY id').all().map((r) => r.id)
  }
  const beforeIds = idsOf()
  const out = await svc.recallGate(
    ctx,
    { requestId: 'r-droptbl', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-dt', turnId: 1 },
    { threshold: 0.7, judgeEnabled: true },
  )
  await settle(150)
  const added = addedIdsOf(beforeIds, idsOf())
  t.diagnostic('[落痕失败] gate=' + out.gate + ' failureKind=' + out.failureKind + ' 声明=' + out.judgeIds.length + ' 新增行=' + added.length + ' untracedKeys=' + JSON.stringify(out.untracedKeys) + ' reason=' + String(out.reason).slice(0, 90))
  // 前置：落痕**真失败**了（jev_log 里真的一行都没新增）
  assert.equal(added.length, 0, '前置：ALTER 改名后 jev_log 不可能新增行；实测 ' + added.length)
  assert.equal(out.untracedKeys.length, 3, '3 条候选的落痕**全都失败** ⇒ untracedKeys 必须 3 条：' + JSON.stringify(out.untracedKeys))
  assert.equal(out.judgeIds.length, 0, '落痕失败的候选**不得**进 judgeIds（行不在库里）：' + JSON.stringify(out.judgeIds))
  assert.equal(out.failureKind, 'trace-failed', '归因必须是 **trace-failed**（**可知的失败**，不得写成 trace-unavailable="不可知"）：' + out.failureKind)
  assert.ok(/落痕失败|落痕/.test(String(out.reason)), 'reason 必须点名落痕失败：' + out.reason)
  // ★ 核心：声明 == 行（双向）
  assertRowsMatchDeclaration(out, added, 'r-droptbl')
  core.db.exec('ALTER TABLE jev_log_hidden RENAME TO jev_log')
})

// ── ⑥c **部分落痕失败 ⇒ 走正常出口**（f3 收尾 ⑥ 的最关键形态：正常出口也必须报归因）──
test('RG-JL-⑥c 部分落痕失败 ⇒ 走**正常出口**，该出口也必须带 failureKind/untracedKeys', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(JEVMOD)
  const fw = await import(FRAMEWORK)
  const LT = new URL('../src/index.ts', import.meta.url).href
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir('mana-rgjl-mixed-'), 'mana.db') })
  await settle(200)
  // ⚠ W1-3 追修：**显式声明替身通道**。本用例是"替身通道的确定性生产桩"（下面自挂的监听器
  //   注入 fakeFetchYes 且显式传 channel:'ollama'），若 jev 插件按**全局缺省**挂载，
  //   一旦缺省被翻转（W1-2：ollama → systemone），本用例就会改道真通道、无 key 即降级，
  //   于是它测的东西**悄悄变了** —— 判据的红绿取决于全局缺省，而不取决于本用例要测的生产侧。
  //   显式声明 ⇒ 语义不依赖全局缺省。这比"让缺省回退"正确：
  //   真 JEV 缺省是 W1-2 的正当成果，不该为测试让步。
  ctx.plugin(jevMod, { channel: 'ollama' })
  await settle(200)
  // ⚠ **显式通道自证**（本批补）：把"本用例挂的确实是替身通道"变成**可读读数**。
  //   理由：上面那行是"用显式声明隔离全局缺省"，而**显式声明本身不会被机检** ——
  //   若哪天有人把这行改回 `{}`（或 jev 侧把 channel 语义改名），本用例会**静默**
  //   重新依赖全局缺省，红绿又开始随别人的改动漂移，而没人会被告知。
  //   ⇒ 断言生效通道 = 'ollama'：缺省再被翻转时，**本用例自己会报红**并点名原因，
  //     而不是让下面那几腿以一种"看起来是生产侧坏了"的方式失败。
  assert.equal(
    ctx.get('mana-jev').status().channel,
    'ollama',
    '本用例必须挂在**替身通道**上（显式 channel:\'ollama\'）；实测生效通道 = ' +
      ctx.get('mana-jev').status().channel +
      ' —— 若这里变了，先看 jev 的缺省是否被改，别去改下面的生产侧断言',
  )
  const core = ctx.get('mana-core')
  // 真生产者 judgeWithGuard + 注入 fetch ⇒ **正常出口**（judge 成功、probability 有值）
  const guard = new fw.JevGuard({ maxConcurrency: 8, sessionBudget: 1000 })
  ctx.on('mana/jev/judge', async (req) => {
    const o = await fw.judgeWithGuard({
      guard, db: core.db, state: req.state, question: req.question,
      idFactory: () => req.requestId, sessionId: req.sessionId, turnId: req.turnId,
      fetchImpl: fakeFetchYes, channel: 'ollama',
    })
    return {
      requestId: o.requestId, source: o.source, value: o.value, probability: o.probability,
      degraded: o.degraded, reason: o.reason,
      traceWritten: o.traceError === null || o.traceError === undefined,
    }
  })
  ctx.plugin(await import(LT))
  await settle(300)
  const svc = ctx.get('mana-long-term')
  const idsOf = () => core.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
  // ⚠ 让 **m-b 那一条**的落痕必失败：**预插**一行同 id ⇒ INSERT 撞主键 ⇒ makeJevOutcome 捕获记 `traceError` 并**照旧返回**
  //   （这正是 ⑥ 的形态：返回了、但行没写成）。另外两条正常写成 ⇒ **部分成功**。
  core.db.prepare(
    'INSERT INTO jev_log (id, request_type, source, result_value, probability, cached, degraded, latency_ms, turn_id, created_at) VALUES (?, ?, ?, ?, NULL, 0, 1, 1, 1, ?)',
  ).run('r-mixed#rel_m-b', 'pre', 'pre', 'unknown', new Date().toISOString())
  const beforeIds = idsOf()
  const out = await svc.recallGate(
    ctx,
    { requestId: 'r-mixed', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-mx', turnId: 2 },
    { threshold: 0.7, judgeEnabled: true },
  )
  await settle(150)
  const added = addedIdsOf(beforeIds, idsOf())
  t.diagnostic('[部分落痕失败] gate=' + out.gate + ' failureKind=' + out.failureKind + ' judgeIds=' + out.judgeIds.length + ' untracedKeys=' + JSON.stringify(out.untracedKeys) + ' 新增行=' + added.length)
  t.diagnostic('[部分落痕失败·读数] gate=' + out.gate + ' probed=' + out.probed + ' judged=' + out.judged + ' items=' + JSON.stringify(out.items.map((h) => [h.key, h.jevProb])))
  assert.ok(
    out.gate === 'judged' || out.gate === 'below_threshold',
    '前置：本形态必须走**正常出口**（judged / below_threshold 都可，二者共用同一段归因计算）；实测 ' + out.gate,
  )
  assert.notEqual(out.gate, 'degraded', '前置：不得落到态 3 降级出口（那是另一个出口，另有覆盖）')
  assert.deepEqual(out.untracedKeys, ['m-b'], 'untracedKeys 必须点名落痕失败的那一条：' + JSON.stringify(out.untracedKeys))
  assert.equal(out.failureKind, 'trace-failed', '**正常出口也必须**报归因（旧版这里恒 null ⇒ 本形态无迹可查）：' + out.failureKind)
  assert.ok(!out.judgeIds.includes('r-mixed#rel_m-b'), '落痕失败的那条不得进 judgeIds：' + JSON.stringify(out.judgeIds))
  // ★ 声明 == 行：**用同一个断言器**（本文件**唯一**的声明面对账实现），
  //   ⇒ 「正常出口」与「降级出口」两处跑的是**同一段判据**（f3 收尾 ③：收成一处）。
  assertRowsMatchDeclaration(out, added, 'r-mixed')
})

// ── Q2 早退三条的归因（f3 收尾 Q2 新增）：`not-attempted` 必须有断言，变异成 null 必红 ──
test('RG-JL-Q2 早退三条 ⇒ failureKind === not-attempted（与「送了没成」可分辨）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const bare = new Context()
  // a) 未发起判定（judgeEnabled=false）
  const a = await mod.recallGate(bare, { requestId: 'q2-a', query: 'q', candidates: CANDS, topK: 3 }, { judgeEnabled: false })
  // b) 候选池空
  const b = await mod.recallGate(bare, { requestId: 'q2-b', query: 'q', candidates: [], topK: 3 })
  // c) 查询串空
  const c = await mod.recallGate(bare, { requestId: 'q2-c', query: '', candidates: CANDS, topK: 3 })
  for (const [tag, out] of [['judgeEnabled=false', a], ['候选池空', b], ['查询串空', c]]) {
    assert.equal(out.gate, 'degraded', tag + ' ⇒ 必须显式降级（' + out.gate + '）')
    assert.equal(out.failureKind, 'not-attempted', tag + ' ⇒ failureKind 必须是 not-attempted（与「送了没成」可分辨）：' + out.failureKind)
    assert.equal(out.probed, 0, tag + ' ⇒ probed 必须为 0（"没送判"与"送了没成"是两件事）')
  }
  // ⚠ **反证（本用例内，纯内存克隆）**：把三条早退的 not-attempted 变异成 null ⇒ 上面的断言必须红。
  //   不这么做，本腿就只是"看着像有断言"—— 上一轮 verify 席正是这么判的（0 断言 ⇒ 变异全绿）。
  const src = readFileSync(fileURLToPath(GATE_SRC), 'utf8')
  const needle = "lHits(), 0, 0, [], [], [], [], 'not-attempted')"
  assert.ok(src.split(needle).length - 1 >= 2 || src.includes("'not-attempted')"), '注入锚点必须存在（not-attempted 的赋值点）')
  const mutantSrc = src.split("'not-attempted')").join('null)')
  assert.notEqual(mutantSrc, src, '克隆体必须真的被改过')
  const dir = tempDir('mana-rgjl-q2-')
  const mutantPath = join(dir, 'recall-gate-q2mut.ts')
  writeFileSync(mutantPath, mutantSrc)
  const mutant = await import(mutantPath)
  const mOut = await mutant.recallGate(bare, { requestId: 'q2-m', query: 'q', candidates: [], topK: 3 })
  assert.equal(mOut.gate, 'degraded', '克隆体仍降级（证明我改的是归因枚举，不是整条早退）')
  assert.equal(mOut.failureKind, null, '克隆体的 failureKind 已被注入成 null（前置：缺陷确实注进去了）')
  assert.throws(
    () => assert.equal(mOut.failureKind, 'not-attempted', 'x'),
    '变异成 null 后，本用例的断言**必须报红** —— 否则本腿是空的（上一轮 verify 席实测 0 断言）',
  )
  assert.equal(readFileSync(fileURLToPath(GATE_SRC), 'utf8'), src, '变异不得写回仓内任何源文件（逐字节比对）')
  t.diagnostic('[Q2 早退归因] a=' + a.failureKind + ' b=' + b.failureKind + ' c=' + c.failureKind + ' · 变异后=' + mOut.failureKind + '（必红已证）')
})

// ── Q1 judged 出口的 reason：必须带归因（此前恒 null）─────────────────────────
test('RG-JL-Q1 judged 出口：部分落痕失败时 reason **必须非 null**（此前恒 null = 文档强于代码）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const jevMod = await import(JEVMOD)
  const fw = await import(FRAMEWORK)
  const LT = new URL('../src/index.ts', import.meta.url).href
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir('mana-rgjl-q1-'), 'mana.db') })
  await settle(200)
  // ⚠ W1-3 追修：**显式声明替身通道**。本用例是"替身通道的确定性生产桩"（下面自挂的监听器
  //   注入 fakeFetchYes 且显式传 channel:'ollama'），若 jev 插件按**全局缺省**挂载，
  //   一旦缺省被翻转（W1-2：ollama → systemone），本用例就会改道真通道、无 key 即降级，
  //   于是它测的东西**悄悄变了** —— 判据的红绿取决于全局缺省，而不取决于本用例要测的生产侧。
  //   显式声明 ⇒ 语义不依赖全局缺省。这比"让缺省回退"正确：
  //   真 JEV 缺省是 W1-2 的正当成果，不该为测试让步。
  ctx.plugin(jevMod, { channel: 'ollama' })
  await settle(200)
  // ⚠ **显式通道自证**（与 RG-JL-⑥c 同一处理，理由见该用例内注）：本用例测得准不准，
  //   取决于"它确实挂在替身通道上"；把这一点变成**可读读数**，缺省再被翻转时本用例自己报红。
  assert.equal(
    ctx.get('mana-jev').status().channel,
    'ollama',
    '本用例必须挂在**替身通道**上（显式 channel:\'ollama\'）；实测生效通道 = ' +
      ctx.get('mana-jev').status().channel +
      ' —— 若这里变了，先看 jev 的缺省是否被改，别去改下面的生产侧断言',
  )
  const core = ctx.get('mana-core')
  const guard = new fw.JevGuard({ maxConcurrency: 8, sessionBudget: 1000 })
  ctx.on('mana/jev/judge', async (req) => {
    const o = await fw.judgeWithGuard({
      guard, db: core.db, state: req.state, question: req.question,
      idFactory: () => req.requestId, sessionId: req.sessionId, turnId: req.turnId,
      fetchImpl: fakeFetchYes, channel: 'ollama',
    })
    return {
      requestId: o.requestId, source: o.source, value: o.value, probability: o.probability,
      degraded: o.degraded, reason: o.reason,
      traceWritten: o.traceError === null || o.traceError === undefined,
    }
  })
  ctx.plugin(await import(LT))
  await settle(300)
  const svc = ctx.get('mana-long-term')
  // 造部分落痕失败（预插同 id ⇒ m-b 的主键冲突）
  core.db.prepare(
    'INSERT INTO jev_log (id, request_type, source, result_value, probability, cached, degraded, latency_ms, turn_id, created_at) VALUES (?, ?, ?, ?, NULL, 0, 1, 1, 1, ?)',
  ).run('r-q1#rel_m-b', 'pre', 'pre', 'unknown', new Date().toISOString())
  // 让两条过阈（pYes≈0.435 ⇒ 阈值 0.4）⇒ 走 **judged 出口**
  const out = await svc.recallGate(
    ctx,
    { requestId: 'r-q1', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-q1', turnId: 3 },
    { threshold: 0.4, judgeEnabled: true },
  )
  await settle(150)
  t.diagnostic('[Q1 judged] gate=' + out.gate + ' failureKind=' + out.failureKind + ' reason=' + String(out.reason).slice(0, 80))
  assert.equal(out.gate, 'judged', '前置：本形态必须走 **judged 出口**；实测 ' + out.gate)
  assert.equal(out.failureKind, 'trace-failed', '归因仍是 trace-failed；实测 ' + out.failureKind)
  assert.notEqual(out.reason, null, '★ judged 出口的 reason **不得为 null**（此前恒 null ⇒ 只读 reason 的消费方看不到落痕失败）')
  assert.ok(/归因=trace-failed/.test(String(out.reason)), 'reason 必须带可读归因串：' + out.reason)
  // 无异常时仍必须是 null（不得把"没有失败"也写成一句话）
  const clean = await svc.recallGate(
    ctx,
    { requestId: 'r-q1clean', query: '末那识 召回 探针', candidates: CANDS, topK: 3, sessionId: 's-q1', turnId: 4 },
    { threshold: 0.4, judgeEnabled: true },
  )
  assert.equal(clean.gate, 'judged')
  assert.equal(clean.failureKind, null, '无异常 ⇒ failureKind 必须 null')
  assert.equal(clean.reason, null, '无异常 ⇒ reason 必须仍为 null（"正常放行"不得被写成一句话）')
})

// ── ⑦ 用例计数自检 ────────────────────────────────────────────────────────────
test('RG-JL-⑦ 用例计数自检', () => {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const n = src.split(String.fromCharCode(10) + 'test(').length - 1
  assert.equal(n, EXPECTED_CASES, '本文件用例数必须恰好 ' + EXPECTED_CASES + '（实测 ' + n + '）；改数量须同步 verify.mjs 的 TEST_FILES')
})