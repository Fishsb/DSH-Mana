/**
 * **Recall Gate 生产调用方接线判据**（W1-4）。
 *
 * ── 本文件判什么 ────────────────────────────────────────────────────────────────
 * 派单原文的判定只有一条：**\`recallGate\` 生产调用方 ≥1**。它的机检形态分两台：
 *   · **静态腿**：\`packages/vector/src/\` 里存在对门控的**调用**（不是 import）；
 *   · **动态腿**：走 \`svc.recall()\`（**只走生产入口**，不直接调门控）⇒
 *     门控**真被调用**（\`attempted\`/\`source\` 可读）⇒ 判定链**真落痕**（\`jev_log\` 真行）。
 * 只有静态腿会退化成「读到一行代码」；只有动态腿会退化成「测试自己调了一遍门控」。
 * 两条都在，才是"接在生产路径上"。
 *
 * ── 为什么这里还要一条**对账**腿（而不是只断言"被调用了"）─────────────────────
 * \`recallGate\` 的核心不变量是「**声明 == 行**」（声明集 = \`judgeIds\`；行集 = 本批新增的
 * \`jev_log\` 行）。接线**本身**不保证它 —— 接线只是让它**有生产输入**。故本文件把该不变量
 * 在**生产输入**上重跑一遍，并且把它写成**四条腿**（见 \`assertReconciled\`），其中第四条
 * （\`attempted && probed === 候选数\`）专门防「门被关掉后三条腿全部平凡通过」。
 *
 * ── 判据的**反证**（本仓要求：没有负向对拍 = 没做完）────────────────────────────
 * 本文件内跑**两次真故障注入**（都是可控的**夹具**故障，不改任何源文件）：
 *   · **反证 A**：夹具监听器**只落 2 行**（第 3 条候选不落）而正常返回
 *     ⇒ \`judgeIds\` 仍是 3 ⇒ **声明 3 / 行 2 / \`failureKind===null\`** —— 这正是派单点名的
 *     「修前形态」，它是**无声的**（没有任何字段报警）⇒ 对账腿**必须报红**。
 *     这条反证证明：**接线 ≠ 对账**，"接上了"并不自动让落痕失败可见。
 *   · **反证 B**（\`enabled=false\`）：**门控被关掉** ⇒ 门**根本没被调用** ⇒
 *     对账腿的第 4 条**必须报红**（否则"接线了"这句话在本文件里不可证伪）。
 *
 * ── 边界（本文件**不**碰什么）──────────────────────────────────────────────────
 * · 不新增注册点：夹具监听器是**判据自己挂的**（挂在测试的 ctx 上），生产代码里
 *   \`src/recall-gate-hook.ts\` **零注册**（用例④用源码级断言把它钉住）；
 * · 不碰 8 事件契约（\`packages/core/src/event-types.ts\` 只读）：门控读数走
 *   \`mana/recall\` 载荷的**契约外增量字段**，本文件断言**契约字段逐字不变**；
 * · **不走向量端点**：候选全走 \`lexicalRank\` 且嵌入端点恒不可达（\`127.0.0.1:1\`）
 *   ⇒ 零网络、零嵌入依赖（夹具监听器的判定驱动也用**假 fetch**）。
 *
 * ── 运行（**显式路径**，不用通配）──────────────────────────────────────────────
 * \`node --test packages/vector/tests/recall-gate-wiring.test.mjs\`
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_CASES = 7

const PLUGIN = new URL('../src/index.ts', import.meta.url).href
const HOOK_SRC = new URL('../src/recall-gate-hook.ts', import.meta.url)
const INDEX_SRC = new URL('../src/index.ts', import.meta.url)
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const FRAMEWORK = new URL('../../jev/src/framework.ts', import.meta.url).href
/**
 * 恒不可达端点（端口 1 无监听）。**每个用例都显式把它配进 `embedBaseUrl`**。
 *
 * ⚠ 这一条是被**本文件自己的 ③ 用例抓出来的**（实测，如实记）：首版没配它 ⇒
 *   嵌入走缺省 `http://127.0.0.1:11434/v1` ⇒ 本机 Ollama **在跑时**管道返回
 *   `degraded=false`、**不在跑时**返回 `degraded=true` ⇒ 同一条断言随环境变色
 *   （"一会儿过一会儿不过"，本仓明令禁止的形态）。
 *   ⇒ 现在把它钉成常量并在 `mount()` 里缺省注入：**零网络、逐次同值**。
 */
const UNREACHABLE = 'http://127.0.0.1:1/v1'

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

/** 合成夹具向量（确定性，不用随机数 ⇒ 不出现"一会儿过一会儿不过"）。 */
const fixtureVec = (dim, seed) => {
  const v = new Float32Array(dim)
  for (let i = 0; i < dim; i++) v[i] = Math.sin((i + 1) * (seed + 1) * 0.011) * Math.cos(i * 0.017 + seed)
  return v
}

/** 3 条候选（判定链最小可判规模；键与 \`probed\` 的对账要用它）。 */
const CANDS = ['mem-w14-a', 'mem-w14-b', 'mem-w14-c']

const fakeFetchYes = async () =>
  new Response(
    JSON.stringify({
      logprobs: [{ top_logprobs: [{ token: 'yes', logprob: Math.log(0.95) }, { token: 'no', logprob: Math.log(0.05) }] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

const fakeFetchFail = async () => new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } })

/**
 * 挂夹具判定监听器（**真生产者** \`judgeWithGuard\` + 注入 fetch）。
 *
 * ⚠ 为什么是夹具而不是真 \`dsh-mana-jev\` 插件：真插件的 Config **不暴露 fetch 注入缝**
 *   （B3.2-R §三已实测标注），挂真插件会真出网（不可复现、慢、且判定结果不确定）。
 *   这里用的是**生产监听器的同一个驱动**（\`framework.ts\` 的 \`judgeWithGuard\`）+ 真 \`db\`
 *   ⇒ 落痕路径与并发/session 护栏**逐字同源**，唯一被替换的是网络边界。
 *
 * @param skipTraceFor 该候选键**照常返回但不落痕**（反证 A 的故障注入；生产里它对应
 *   「监听器返回了、\`finish()\` 没写成行」那一类）
 */
async function attachFixture(ctx, core, opts = {}) {
  const fw = await import(FRAMEWORK)
  const guard = new fw.JevGuard({ maxConcurrency: 8, sessionBudget: 1000 })
  const seen = []
  ctx.on('mana/jev/judge', async (req) => {
    seen.push({ judgeType: req.judgeType, judgeId: req.requestId, sessionId: req.sessionId })
    const o = await fw.judgeWithGuard({
      guard,
      // ⚠ 故障注入点：\`db\` 不给 ⇒ 判定照常返回、**没有落痕**（\`finish()\` 的 db 分支不执行）
      ...(opts.skipTraceFor === req.judgeType ? {} : { db: core.db }),
      state: req.state,
      question: req.question,
      idFactory: () => req.requestId,
      sessionId: req.sessionId,
      turnId: req.turnId,
      fetchImpl: opts.fetchImpl ?? fakeFetchYes,
      channel: 'ollama',
    })
    return { requestId: o.requestId, source: o.source, value: o.value, probability: o.probability, degraded: o.degraded, reason: o.reason }
  })
  return seen
}

/**
 * 对账器（**四条腿**）。任一条不成立即抛 —— 调用方在"应绿"时直接调、在"应红"时断言它抛。
 *
 * ⚠ 第 4 条是**防平凡通过**的关键：前三条在"门控压根没被调用"时全部成立
 *   （声明空集、行集空集、自洽），只有第 4 条把「门被关掉」变成红。
 *   ⇒ 这正是派单「关掉门控 ⇒ 对账必红」的落点。
 */
function assertReconciled(g, addedIds, expectDispatched) {
  // ⚠ 入参就是 `lastRecallGate()` / 载荷 `recallGate` 的读数形状（**同一个形状**）⇒
  //   本对账器判的正是"生产调用方拿到手的那份读数"自洽且与库对得上。
  assert.ok(g && g.gate !== null, '门控必须给出**结果**（gate 为 null ⇒ 没跑成：' + ((g && g.unwiredReason) ?? '无原因') + '）')
  const judgeIds = [...g.judgeIds]
  // 腿 1：声明自洽（重复 ⇒ 派生同一 id ⇒ 后一条撞主键 ⇒ 声明多于行）
  assert.equal(judgeIds.length, new Set(judgeIds).size, 'judgeIds 内不得有重复：' + JSON.stringify(judgeIds))
  // 腿 2：每个**已派发**的候选都必须有显式归宿（进声明，或被点名在 threw/untraced 里）
  assert.equal(g.probedKeys.length, g.probed, 'probedKeys 长度必须等于 probed')
  const named = new Set([...judgeIds.map((id) => id.slice(id.indexOf('#rel_') + 5)), ...g.threwKeys, ...g.untracedKeys, ...g.traceUnknownKeys, ...g.duplicateKeys])
  for (const k of g.probedKeys) assert.ok(named.has(k), '已派发候选必须有显式归宿（声明或 threw/untraced/traceUnknown）：' + k)
  // 腿 3：**本批新增行集 == 声明集**（集合级，不是计数级）
  assert.deepEqual([...addedIds].sort(), [...judgeIds].sort(), '本批新增的 jev_log 行集必须等于声明集')
  // 腿 4：**门控真被调用、真派发**（防"门关掉后前三条平凡通过"）
  assert.equal(g.attempted, true, '门控必须真被调用（attempted=false ⇒ 门被关掉/解析失败：' + g.unwiredReason + '）')
  assert.equal(g.probed, expectDispatched, '送判候选数必须等于送进检索的候选数（否则"接线"这句话不可证伪）')
}

const idsOf = (core) => core.db.prepare('SELECT id FROM jev_log ORDER BY id').all().map((r) => r.id)
const addedOf = (before, after) => {
  const b = new Set(before)
  return after.filter((id) => !b.has(id))
}

/** 装 core + vector；可选再挂夹具判定监听器。**只用生产入口**（不直接调门控）。 */
async function mount(tag, { vecConfig = {}, withJudge = true, judgeOpts = {} } = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const vecMod = await import(PLUGIN)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir(tag), 'mana.db') })
  await settle(200)
  const core = ctx.get('mana-core')
  const seen = withJudge ? await attachFixture(ctx, core, judgeOpts) : []
  // ⚠ 嵌入端点**缺省钉成不可达**（见 UNREACHABLE 注释：否则本文件随"Ollama 在不在跑"变色）
  ctx.plugin(vecMod, { embedBaseUrl: UNREACHABLE, ...vecConfig })
  await settle(300)
  const svc = ctx.get('mana-vector')
  assert.ok(svc, 'mana-vector 服务必须可读（未 provide = 插件没真跑起来）')
  // 三条候选常驻（使向量管道在降级路径下仍返回**有序的 3 条** items）
  for (let i = 0; i < CANDS.length; i++) {
    const w = await svc.putMemoryVector(CANDS[i], fixtureVec(1024, i + 1))
    assert.equal(w.written, true, '候选常驻写入必须成功：' + w.reason)
  }
  return { ctx, core, svc, seen }
}

/** 走**生产检索入口**：一次带信封的召回（嵌入端点恒不可达 ⇒ 无网络、确定性降级）。 */
const doRecall = (svc, requestId) =>
  svc.recall(
    '末那识 召回 门控 探针',
    CANDS.map((k, i) => ({ key: k, lexicalRank: i + 1 })),
    5,
    { sessionId: 'sess-w14', turnId: 1, requestId },
  )

// ── ⓪ 判据自检（防"空文件也绿"/"删一条不变色"）──────────────────────────────
test('W1-4-⓪ 判据自检：用例计数 == ' + EXPECTED_CASES + '，交付文件齐备且门控接线点在 src 里', async () => {
  const { existsSync } = await import('node:fs')
  const self = fileURLToPath(import.meta.url)
  const src = readFileSync(self, 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  assert.equal(n, EXPECTED_CASES, '用例条数必须恰好 ' + EXPECTED_CASES + '（实测 ' + n + '）—— 删一条即有判据被删走')
  for (const f of ['index.ts', 'recall-gate-hook.ts', 'recall.ts', 'rrf.ts', 'cosine.ts', 'adapt.ts']) {
    assert.ok(existsSync(fileURLToPath(new URL('../src/' + f, import.meta.url))), '交付文件缺失：src/' + f)
  }
  const index = readFileSync(fileURLToPath(INDEX_SRC), 'utf8')
  // 静态腿（**调用**而不是 import）：\`await runRecallGate(\` 必须出现在 recall 出口里
  assert.ok(/await runRecallGate\(/.test(index), 'index.ts 里必须有对 runRecallGate 的**调用**（只有 import = 没接线）')
  assert.ok(/import\s*\{[\s\S]*?runRecallGate[\s\S]*?\}\s*from\s*'\.\/recall-gate-hook\.ts'/.test(index), 'runRecallGate 必须自本包 hook 模块导入（可判据点名）')
})

// ── ① 静态腿：生产调用方 ≥1（写面内 grep 读数），且**不新增注册点** ──────────
test('W1-4-① 生产调用方 ≥1：vector/src 里有调用点；hook 模块零监听器/零 pre-step', () => {
  const index = readFileSync(fileURLToPath(INDEX_SRC), 'utf8')
  const calls = index.match(/await runRecallGate\(/g) ?? []
  assert.ok(calls.length >= 1, '生产调用方必须 ≥1（实测 ' + calls.length + '）')
  // 调用必须落在 \`recall\` 实现体里：用 recall 段的起止做粗定位（避免"接在别处也算数"）
  const recallAt = index.indexOf('recall: async (query, candidates')
  assert.ok(recallAt > 0, '必须能在源码里定位 recall 实现体（锚点漂了本断言就是空跑）')
  assert.ok(index.indexOf('await runRecallGate(') > recallAt, '调用点必须在 recall 实现体**之后**（即在其内部）')

  // G9 边界：hook 模块**不许**注册任何监听器/定时器/pre-step（只导出函数）
  const hook = readFileSync(fileURLToPath(HOOK_SRC), 'utf8')
  for (const banned of ['ctx.on(', 'ctx.waterfall(', 'registerPassThroughPreStep', 'ctx.effect(', 'setInterval', 'setTimeout']) {
    assert.ok(!hook.includes(banned), 'hook 模块**不得**出现 ' + banned + '（G9：不新增注册点）')
  }
  // 反向自证：banned 清单本身有效 —— 它在 index.ts 里**必须**命中（否则本断言是空跑）
  const idxHas = ['ctx.on(', 'ctx.effect(', 'registerPassThroughPreStep'].filter((b) => index.includes(b))
  assert.ok(idxHas.length >= 2, 'banned 清单必须能在既有源文件里命中（否则"未出现"是空跑）：实测命中 ' + JSON.stringify(idxHas))
})

// ── ② 动态腿 + 真落痕：检索 ⇒ 门控真被调用 ⇒ jev_log 真行 == 声明 ──────────
test('W1-4-② 端到端：recall() ⇒ 门控真被调用（真产物解析）⇒ 声明集 == jev_log 新增行集', async (t) => {
  const { ctx, core, svc, seen } = await mount('mana-w14-e2e-')
  const before = idsOf(core)
  const out = await doRecall(svc, 'w14-e2e')
  await settle(200)
  const added = addedOf(before, idsOf(core))
  const rec = svc.lastRecallGate()

  assert.ok(rec, 'lastRecallGate() 必须可读（接线面的即时出口）')
  assert.equal(rec.attempted, true, '门控必须真被调用；unwiredReason=' + rec.unwiredReason)
  assert.ok(rec.resolutionSource && rec.resolutionSource.endsWith('long-term/lib/index.js'), '解析到的必须是 long-term 的**真产物**：' + rec.resolutionSource)
  assert.equal(rec.specifier, 'dsh-mana-long-term', '解析入口必须是按包名（不是相对路径）')

  // 判定链真被走到：夹具监听器收到 3 条 rel_<id>，且逐条唯一（唯一 judgeIdFor 主键）
  assert.equal(seen.length, 3, '3 条候选必须有 3 次判定派发（实测 ' + seen.length + '）')
  assert.ok(seen.every((s) => s.judgeType.startsWith('rel_')), '问法必须是 rel_<id>：' + JSON.stringify(seen.map((s) => s.judgeType)))
  assert.equal(new Set(seen.map((s) => s.judgeId)).size, 3, '判定键必须逐条唯一：' + JSON.stringify(seen.map((s) => s.judgeId)))
  assert.ok(seen.every((s) => s.sessionId === 'sess-w14'), 'sessionId 必须透传（护栏按会话计费）')

  // 对账（四条腿全跑；这是本文件的核心不变量）
  assertReconciled(rec, added, CANDS.length)
  assert.equal(rec.gate, 'judged', '阈值 0.7 下 0.95 必须放行：gate=' + rec.gate)
  assert.equal(rec.rankBy, 'jev_prob', 'judged 出口的 rankBy 必须是 jev_prob（门控结果自身排序依据）')
  assert.equal(rec.judged, 3, '3 条都必须拿到有限概率')
  assert.equal(rec.failureKind, null, '无异常时 failureKind 必须是 null：' + rec.failureKind)

  // 契约面未被门控改写（A1-11 的机检锚点：管道字段仍由 vector 决定）
  assert.equal(out.degraded, true, '本用例端点不可达 ⇒ 管道是**降级**态（前提断言）')
  assert.equal(out.rankBy, 'local_score', "管道 rankBy 必须仍是 'local_score'（A1-11 原文，未门控折叠）")
  assert.equal(rec.applied, false, '本批门控**不改变**管道结果（applied 必须显式为 false，不是靠注释）')
  assert.ok(out.items.length === CANDS.length, '降级也必须返回**有序 items**（A1-8 Recall 支路）：' + out.items.length)

  t.diagnostic(
    '[W1-4 端到端] 解析=' + rec.resolutionSource + ' · 派发=' + rec.probed + ' 声明=' + rec.judgeIds.length +
      ' 落库增量=' + added.length + ' · ids=' + JSON.stringify(added) + ' · 管道(degraded=' + out.degraded + ' rankBy=' + out.rankBy + ' items=' + out.items.length + ')',
  )
  await ctx.stop?.()
})

// ── ③ 反证 A：夹具只落 2 行 ⇒ **声明 3 / 行 2 / failureKind=null** ⇒ 对账必红 ──
test('W1-4-③ 反证 A（真故障注入）：监听器少落一行 ⇒ 声明 3 / 行 2 / failureKind=null ⇒ 对账必红', async (t) => {
  // 故障注入：第 3 条候选的判定**正常返回但不落痕**（\`finish()\` 的 db 分支不执行）
  const { ctx, core, svc } = await mount('mana-w14-liar-', { judgeOpts: { skipTraceFor: 'rel_' + CANDS[2] } })
  const before = idsOf(core)
  await doRecall(svc, 'w14-liar')
  await settle(200)
  const added = addedOf(before, idsOf(core))
  const rec = svc.lastRecallGate()

  // 「修前形态」逐项复现：门控**看不见**这件事（它拿到的是 3 个"正常返回"）
  assert.equal(rec.judgeIds.length, 3, '门控声明 3 条（实测 ' + rec.judgeIds.length + '）')
  assert.equal(added.length, 2, '库里实际只有 2 行（实测 ' + added.length + '）')
  assert.equal(rec.failureKind, null, '**无声**：failureKind 仍为 null（这正是"修前形态"的要害）')
  assert.equal(rec.degraded, false, '门控自己不认为降级（它拿到了 3 个概率）')

  // ⇒ 对账腿必须报红（否则它对该形态无感，就是同等强度的补丁）
  assert.throws(
    () => assertReconciled(rec, added, CANDS.length),
    /新增的 jev_log 行集必须等于声明集/,
    '声明 3 / 行 2 必须被判据抓住（修前形态是**无声**的 ⇒ 只能由集合对账抓）',
  )
  t.diagnostic('[反证 A] 声明=' + rec.judgeIds.length + ' 落库=' + added.length + ' failureKind=' + rec.failureKind + ' ⇒ 集合对账报红（无声失败被抓出）')
  await ctx.stop?.()
})

// ── ④ 反证 B：**关掉门控** ⇒ 对账第 4 条必红（防"关掉后前三条平凡通过"）─────
test('W1-4-④ 反证 B：门控显式关闭 ⇒ 门**未被调用** ⇒ 对账必红（接线这句话可证伪）', async (t) => {
  const { ctx, core, svc, seen } = await mount('mana-w14-off-', { vecConfig: { recallGate: { enabled: false } } })
  const before = idsOf(core)
  const out = await doRecall(svc, 'w14-off')
  await settle(200)
  const added = addedOf(before, idsOf(core))
  const rec = svc.lastRecallGate()

  assert.equal(rec.enabled, false, '配置必须真的被读到（嵌套 Schema.object 的缺省/覆盖腿）')
  assert.equal(rec.attempted, false, '关掉后必须**没有被调用**')
  assert.equal(rec.gate, null, '未调用时 gate 必须是 null（不得用别的值冒充）')
  assert.ok(rec.unwiredReason && rec.unwiredReason.includes('显式关闭'), '未调用必须给出**可读且可分辨**的原因：' + rec.unwiredReason)
  assert.equal(seen.length, 0, '关掉后判定链不得被派发（实测 ' + seen.length + ' 次）')
  assert.equal(added.length, 0, '关掉后 jev_log 不得新增')
  // 检索本身照常（fail-open）：关闭是**显式配置**，不是故障 ⇒ 召回不能被门控拖死
  assert.ok(out.items.length === CANDS.length, '门控关闭不得影响检索返回（fail-open）')

  // ⇒ 对账必红：第 4 条把"门关掉"变成红（前三条在空集上全部成立）
  assert.throws(
    () => assertReconciled(rec, added, CANDS.length),
    // ⚠ 模式必须覆盖**实际最先抛的那一条**：gate 为 null ⇒ 第 0 条（"门控必须给出结果"）先红。
    //   首版只写了后两条 ⇒ 用例报红而原因是"期望的模式没匹配上"（假红），实测抓出两次
    //   （第二次是修好形状后措辞带上了 ** 标记，模式又没跟上）⇒ 现按**前缀**匹配，措辞改动不再让它假红。
    /门控必须/,
    '门被关掉 ⇒ 对账必须红（否则"接线了"在本文件里不可证伪）',
  )
  t.diagnostic('[反证 B] enabled=false ⇒ attempted=' + rec.attempted + ' 派发=0 新增行=' + added.length + ' ⇒ 对账第 4 条报红；检索仍返回 ' + out.items.length + ' 条')
  await ctx.stop?.()
})

// ── ⑤ A1-8 Recall 支路的**真读数**：判定链失败 ⇒ jev_log 行 degraded=1 ───────
test('W1-4-⑤ A1-8 Recall 支路：判定驱动失败 ⇒ jev_log 行 degraded=1 且返回有序 items', async (t) => {
  const { ctx, core, svc } = await mount('mana-w14-a18-', { judgeOpts: { fetchImpl: fakeFetchFail } })
  const before = idsOf(core)
  const out = await doRecall(svc, 'w14-a18')
  await settle(200)
  const added = addedOf(before, idsOf(core))
  const rec = svc.lastRecallGate()

  assert.ok(added.length >= 1, '判定失败**也必须落痕**（G8：降级落显式字段，不是不写行）')
  const rows = core.db.prepare('SELECT id, degraded, gate, probability FROM jev_log WHERE id LIKE ?').all('w14-a18#rel_%')
  assert.equal(rows.length, added.length, '本批行数必须与增量一致')
  for (const r of rows) {
    assert.equal(r.degraded, 1, 'A1-8：判定链失败 ⇒ jev_log.degraded 必须为 1（行 ' + r.id + '）')
    assert.ok(r.gate !== null || r.degraded !== 0, 'A1-8：degraded 与 gate 至少一个非空（行 ' + r.id + '）')
    assert.equal(r.probability, null, '降级行不得用 0 冒充概率：' + JSON.stringify(r))
  }
  // 门控侧的对应读数：态 3（degraded）且归因点名"下游降级"
  assert.equal(rec.gate, 'degraded', '全批无概率 ⇒ 门控必须落态 3：' + rec.gate)
  assert.equal(rec.rankBy, 'local_score', '降级**绝不**标 jev_prob（A1-11 原文）')
  assert.equal(rec.degraded, true, '门控 degraded 必须为 true')
  assert.ok(rec.reason && rec.reason.length > 0, '态 3 的 reason 必须非空（否则"没判"不可查）')
  assert.ok(out.items.length > 0, 'A1-8：Recall 必须返回**有序 items**（实测 ' + out.items.length + ' 条）')
  assertReconciled(rec, added, CANDS.length)
  t.diagnostic(
    '[A1-8 Recall] jev_log 行=' + rows.length + '（全 degraded=1 / probability=null / gate=' + JSON.stringify(rows.map((r) => r.gate)) + '）' +
      ' · 门控 gate=' + rec.gate + ' rankBy=' + rec.rankBy + ' · items=' + out.items.length,
  )
  await ctx.stop?.()
})

// ── ⑥ 既有行为回归：契约字段/插件面/管道语义 **逐条**未变 ────────────────────
test('W1-4-⑥ 回归：ManaRecall 契约字段未改 + 插件面未变 + 管道语义未变', async (t) => {
  const { ctx, core, svc } = await mount('mana-w14-reg-')
  let payload = null
  ctx.on('mana/recall', (p) => {
    payload = p
  })
  const out = await doRecall(svc, 'w14-reg')
  await settle(150)

  // ① 契约字段**逐字**等于管道结果（门控不得改写它们）
  assert.ok(payload, 'mana/recall 必须仍被 emit（接线不得摘掉它）')
  assert.equal(payload.query, out.query)
  assert.equal(payload.hitCount, out.hitCount)
  assert.equal(payload.channel, out.channel)
  assert.equal(payload.rankBy, out.rankBy)
  assert.equal(payload.degraded, out.degraded)
  assert.equal(payload.requestId, 'w14-reg')
  // ② 门控读数**挂在同一载荷**上（同一行审计里可查，不漂开）
  assert.ok(payload.recallGate, 'man/recall 载荷必须带门控读数（契约外增量字段）')
  assert.equal(payload.recallGate.attempted, true)
  // ③ 仍落库（F-01 的 recall 段落点不得被接线摘掉）
  const { MANA_STAGES } = await import(new URL('../../core/src/domain.ts', import.meta.url).href)
  const n = Number(core.db.prepare('SELECT count(*) c FROM mana_trace WHERE event_type = ?').get(MANA_STAGES[3]).c)
  assert.ok(n >= 1, 'recall 段必须仍落 mana_trace（实测 ' + n + ' 行）')

  // ④ 插件面未变（inject 不得因接线多出依赖边）
  const vecMod = await import(PLUGIN)
  assert.equal(vecMod.name, 'mana-vector', '插件 name 不得改')
  assert.deepEqual(vecMod.inject, ['mana-core'], 'inject 不得改（按包名运行时解析 ⇒ 不新增依赖边）')
  assert.equal(typeof vecMod.Config, 'function' || typeof vecMod.Config === 'object', 'Config 必须仍导出（嵌套 recallGate 不得破坏配置面）')
  const parsed = vecMod.Config({})
  assert.equal(parsed.recallGate.enabled, true, '缺省必须开启（否则接线在生产上等于没接）')
  assert.equal(parsed.recallGate.threshold, 0.7, '缺省阈值必须与 RECALL_GATE_DEFAULT_THRESHOLD 同值')
  assert.equal(parsed.recallGate.topN, 10)
  t.diagnostic('[回归] 载荷契约字段逐字同管道结果 · recallGate 读数已挂载 · recall 段落库 ' + n + ' 行 · inject=' + JSON.stringify(vecMod.inject))
  await ctx.stop?.()
})
