/**
 * Write Gate 判据（W1-3）—— **写入路径真的走到**（不是"接口存在"）。
 *
 * 判据原文（`docs/mana-rollout-plan.md:103`）：
 *   **Write Gate：bigram 预过滤 → 一次 fan-out（worth_keeping noul + supersedes choice + none），
 *   失败 fail-open 仍写入、标 gate=unavailable|budget**。
 *
 * 本文件的纪律（逐条对应本批硬约束）：
 *   · **端到端真跑**：观察进 `ctx.emit('mana/observation')` ⇒ `memory_items` **真出现该行**（给 SQL 读数）。
 *   · **反证对拍**：关掉 Write Gate ⇒ `memory_items` **不再产生新行**；**并且**证明该反证不是平凡通过
 *     （先证明"开着的时候真的产生了行"——G11）。⚠ 两者都用**增量**读数，不用全表计数
 *     （全表计数在有存量行的库上会把"没写"与"写了"抹平）。
 *   · **retired 记忆再写 ⇒ 必须可分辨**：实测 core 的 `INSERT OR REPLACE` 会把 `retired` 重置为
 *     DEFAULT 0（静默复活）⇒ 本包**显式挡**并返回 `skipped_retired`；判据**同时**证明
 *     "挡得住"（库内 retired 不变）**和**"若没挡就会复活"（直接对 core 写入口做负向对拍）
 *     —— 后者是本判据的关键：只证明"我们没写"不足以说明这个闸有意义。
 *   · **降级显式**：判定链抛错 ⇒ `degraded=true` + `failureKind` + 非空 `reason`，
 *     **且按 fail-open 仍写入**（rollout:103 明文）；「判了不值得」与「判不了」必须可分辨。
 *   · **不新增事件类型**：判定只走既有 `mana/jev/judge`，并用**计数器断言**"本包没有 emit 新事件"
 *     （下界断言抓不到"多了一个事件名"，故用显式计数）。
 *
 * ⚠ 用例数本身是判据（空文件在 `node --test` 下报 tests 1/pass 1 的假绿）⇒ 末例自检，
 *   且 `verify.mjs` 里同步登记（外部防线，见该文件头）。
 *
 * 运行（显式路径）：`node --test packages/long-term/tests/write-gate.test.mjs`
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const LT = new URL('../src/index.ts', import.meta.url).href
const FRAMEWORK = new URL('../../jev/src/framework.ts', import.meta.url).href
const mod = await import(new URL('../src/write-gate.ts', import.meta.url).href)

const EXPECTED_CASES = 10
let ran = 0
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

/** 装 core + long-term（**只装 core**：与既有三条判据同一装配形态）。 */
async function mount(tag) {
  const coreMod = await import(CORE)
  const ltMod = await import(LT)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir(tag), 'mana.db') })
  await settle(200)
  const fiber = ctx.plugin(ltMod)
  await settle(300)
  return { ctx, fiber, core: ctx.get('mana-core'), svc: ctx.get('mana-long-term') }
}

/** 假 Ollama：**不依赖网络**（返回 yes 族 logprob 响应）。 */
const fakeFetchYes = async () =>
  new Response(
    JSON.stringify({
      logprobs: [{ top_logprobs: [{ token: 'yes', logprob: Math.log(0.9) }, { token: 'no', logprob: Math.log(0.1) }] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

/**
 * 挂一个**确定性**判定监听器（真生产者 `judgeWithGuard` + 注入 fetch）——
 * 走真 `framework.ts` 的落痕路径 ⇒ `jev_log` 里**真出现行**（不是桩返回一个数就算）。
 */
async function attachJudge(ctx, core) {
  const fw = await import(FRAMEWORK)
  const guard = new fw.JevGuard({ maxConcurrency: 8, sessionBudget: 1000 })
  const seen = []
  ctx.on('mana/jev/judge', async (req) => {
    seen.push({ requestId: req.requestId, judgeType: req.judgeType, question: req.question, threshold: req.threshold, source: req.source })
    const o = await fw.judgeWithGuard({
      guard, db: core.db, state: req.state, question: req.question,
      idFactory: () => req.requestId, sessionId: req.sessionId, turnId: req.turnId,
      fetchImpl: fakeFetchYes, channel: 'ollama',
    })
    return { requestId: o.requestId, source: o.source, value: o.value, probability: o.probability, degraded: o.degraded, reason: o.reason }
  })
  return seen
}

/** 一条"能过 bigram 预过滤"的观察（含问法词表里的 bigram：这/条·值/得·记/住 …）。 */
const KEEPABLE = '这条观察值得长期记住：Mana 的写入门控接线完成'
const obs = (over = {}) => ({
  sessionId: 's-wg', turnId: 1, requestId: 'r-wg-1', at: new Date().toISOString(),
  content: KEEPABLE, source: 'test', ...over,
})

const itemCount = (core) => Number(core.db.prepare('SELECT COUNT(*) c FROM memory_items').get().c)
const jevCount = (core) => Number(core.db.prepare('SELECT COUNT(*) c FROM jev_log').get().c)

// ══ ① 实现面清单逐名在册（反「实现被挖空」）═══════════════════════════════════
test('① 实现面清单 IMPLEMENTED_WRITE_GATE_EXPORTS 逐名真导出（被搬走/改名即红）', async () => {
  ran += 1
  const lt = await import(LT)
  const list = lt.IMPLEMENTED_WRITE_GATE_EXPORTS
  assert.ok(Array.isArray(list) && list.length > 0, '清单必须是非空数组')
  for (const n of list) {
    assert.notEqual(lt[n], undefined, `清单里的 ${n} 必须真导出（清单写了个不存在的东西 ⇒ 清单失去意义）`)
  }
  // 被判据点名的字面量面：三态枚举 / 问法 / judgeType / 留痕标签
  assert.deepEqual([...lt.WRITE_GATE_STATES], [...mod.WRITE_GATE_STATES], '状态枚举必须与实现同源')
  assert.equal(lt.WRITE_GATE_JUDGE_TYPE, 'worth_keeping', 'judgeType 必须是 rollout:103 的 noul 口径')
  assert.equal(lt.WRITE_GATE_SOURCE, 'mana-long-term', 'source 必须可枚举（jev_log.source 靠它分辨本门）')
  assert.ok(lt.WRITE_GATE_QUESTION.length >= 4, '问法必须非空（它同时是预过滤词表的真源）')
})

// ══ ② 预过滤是**纯函数**且它挡下什么必须可分辨（不是"静默 0 行"）══════════════
test('② bigram 预过滤：命中与否是纯函数读数，且词表由问法派生（不另立第二份）', async () => {
  ran += 1
  const bank = [...mod.PREFILTER_BANK]
  assert.ok(bank.length > 0, '词表不得为空（空表 ⇒ 预过滤恒不命中 ⇒ 全部静默 0 行）')
  // 词表真源 = 问法本身：逐个元素都必须出现在 问法的 bigram 集 里
  const derived = new Set(mod.bigrams(mod.WRITE_GATE_QUESTION))
  for (const g of bank) assert.ok(derived.has(g), `词表元素 ${g} 不在问法的 bigram 集里 ⇒ 词表与问法已漂移`)
  // 正向：含问法词元的句子命中
  const hit = mod.prefilterWorthKeeping(KEEPABLE)
  assert.equal(hit.hit, true, `本该命中：overlap=${hit.overlap}（'这条观察值得长期记住' 与问法有明显交集）`)
  // 负向：与问法**零交集**的串必须不命中（否则预过滤形同虚设）
  const miss = mod.prefilterWorthKeeping('ABCDEFGHIJKLMNOP')
  assert.equal(miss.hit, false, `零交集串不得命中；实测 overlap=${miss.overlap}`)
  assert.equal(miss.overlap, 0, '英文串与中文问法 bigram 交集应为 0')
  // 阈值可覆盖（证明它不是硬编码在函数体里）
  assert.equal(mod.prefilterWorthKeeping(KEEPABLE, 999).hit, false, '阈值调到不可达 ⇒ 必须不命中（阈值真生效）')
})

// ══ ③ retired 闸：既有行已软删除 ⇒ 拒绝覆盖（**负向对拍同时证明该闸有意义**）══
test('③ retired 记忆再写：本包**挡住且可分辨**，并证明"若没挡就会复活"（负向对拍）', async () => {
  ran += 1
  const { ctx, core, svc } = await mount('mana-wg-retired-')
  // ⚠ 必须挂**真判定链**：否则首写走 fail-open 得到 degraded_written，
  //   而本判据要的是"正常写进去一条" —— 用降级态去测 retired 闸会把两件事混在一起。
  await attachJudge(ctx, core)
  const o = obs({ requestId: 'r-ret-1' })
  const id = mod.deriveMemoryId(o)
  // 先经**服务面**正常写一条，再软删除它
  const first = await svc.writeGate(core.db, mod.coreSink(core), o)
  assert.equal(first.state, 'written', '首写必须是 written（新行）；实测 ' + first.state)
  // ⚠ `SoftDeleteOutcome` **没有 `ok` 字段**（本席一度按 `ok` 断言 —— 错的，那是凭想象写判据）。
  //   它的真字段是 existed/changed/retiredBefore/retiredAfter/rowsBefore/rowsAfter/哈希/字节数，
  //   逐条都比"一个布尔"更能证伪（例如 rowsBefore==rowsAfter 才证明"只改位、不删行"）。
  const retire = await svc.retirement.retire(core.db, id)
  assert.equal(retire.retiredAfter, 1, '软删除必须把 retired 置 1：' + JSON.stringify(retire))
  assert.equal(retire.changed, true, '软删除必须报"发生了变化"（否则是空操作）：' + JSON.stringify(retire))
  assert.equal(retire.rowsBefore, retire.rowsAfter, '软删除**只改位、不删行**（物理删除永不发生）：' + JSON.stringify(retire))
  const before = core.db.prepare('SELECT retired, content FROM memory_items WHERE id = ?').get(id)

  // 再写一次同一 id —— 本包的闸必须挡住
  const second = await svc.writeGate(core.db, mod.coreSink(core), o)
  assert.equal(second.state, 'skipped_retired', '对已 retired 的记忆再写 ⇒ 必须报 skipped_retired；实测 ' + second.state)
  assert.equal(second.wroteRow, false, '被挡下 ⇒ wroteRow 必须为 false')
  assert.ok(second.reason && second.reason.includes('retired'), 'reason 必须点名真因（不得只说"跳过"）：' + second.reason)
  const after = core.db.prepare('SELECT retired, content FROM memory_items WHERE id = ?').get(id)
  assert.equal(Number(after.retired), 1, '被挡下 ⇒ 库内 retired 必须仍为 1（不得被复活）')
  assert.equal(after.content, before.content, '被挡下 ⇒ content 必须逐字节不变')

  // ── ★ 第二腿：**绕过本闸直接调 core 写入口** ⇒ 不得复活、不得清列
  //
  // ⚠ **本腿的历史（如实记，别把它读成"一开始就这么写"）**：
  //   初版这一腿断言的是**相反**的事实 —— "绕过本闸直调 core ⇒ retired 确实被重置为 0"，
  //   作为"上面那条闸不是装饰"的负向对拍（当时 core 用 INSERT OR REPLACE，实测 7 列被清）。
  //   2026-09-26 09:01 另一席把 core 修成 UPSERT（`ON CONFLICT(id) DO UPDATE SET`，只更新
  //   本次提供的列）后，**本腿按设计变红了** —— 它正确地播报了"core 已修"。
  //   ⇒ 现在改为**钉住目标不变式**：可逆性只能由显式 restore 完成，
  //     **任何**写入路径都不得让 retired 自发翻转，也不得清掉别的列。
  //     若 core 回退成 REPLACE，本腿会立刻再红（这就是它的价值）。
  //
  // 前置取证：先把这条行做成"带满状态"的样子，才能测出"有没有被清"。
  core.db
    .prepare(
      `UPDATE memory_items
          SET reconsolidation_window_until = ?, update_history = ?, access_count = ?, base_level_activation = ?, vector = ?
        WHERE id = ?`,
    )
    .run('2030-01-01T00:00:00.000Z', '[{"v":1}]', 7, -1.5, new Uint8Array([1, 2, 3]), id)
  const filled = core.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id)
  const WATCHED = [
    'retired',
    'reconsolidation_window_until',
    'update_history',
    'access_count',
    'base_level_activation',
    'vector',
    'created_at',
  ]
  core.writeMemoryItem({ id, type: 'observation', content: KEEPABLE })
  const after2 = core.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id)
  assert.equal(
    Number(after2.retired),
    1,
    `★ 任何写入路径都不得让 retired 自发翻转（可逆性只归显式 restore）：实测 ${after2.retired}`,
  )
  for (const col of WATCHED) {
    const same =
      col === 'vector'
        ? Buffer.from(filled[col] ?? []).equals(Buffer.from(after2[col] ?? []))
        : filled[col] === after2[col]
    assert.ok(
      same,
      `★ 重写不得清空既有列（本仓曾实测被静默清空的正是这 7 列）：${col} 由 ${JSON.stringify(
        col === 'vector' ? '<blob>' : filled[col],
      )} 变为 ${JSON.stringify(col === 'vector' ? '<blob>' : after2[col])}`,
    )
  }
  void ctx
})

// ══ ④ 端到端真跑：perceive 的观察 ⇒ memory_items **真出现该行**（SQL 读数）═══
test('④ 端到端：emit mana/observation ⇒ memory_items 真增行 + jev_log 真落判定行', async () => {
  ran += 1
  const { ctx, core } = await mount('mana-wg-e2e-')
  const seen = await attachJudge(ctx, core)
  const beforeItems = itemCount(core)
  const beforeJev = jevCount(core)
  const o = obs({ requestId: 'r-e2e-1' })
  ctx.emit('mana/observation', o)
  await settle(400)
  const afterItems = itemCount(core)
  const afterJev = jevCount(core)
  assert.equal(afterItems - beforeItems, 1, `端到端必须**真增 1 行** memory_items（增量，非全表）；实测 ${afterItems - beforeItems}`)
  const id = mod.deriveMemoryId(o)
  const row = core.db.prepare('SELECT id, type, content, retired FROM memory_items WHERE id = ?').get(id)
  assert.ok(row, '库内必须能按派生 id 查到该行')
  assert.equal(row.content, KEEPABLE, 'content 必须逐字节等于观察内容')
  assert.equal(row.type, 'observation', 'type 必须是本门写死的 observation')
  assert.equal(Number(row.retired), 0, '新行 retired 必须为 0')
  // 判定**真走了判定链**：监听器被调用 + jev_log 真落行（本门不自建审计表，复用既有面）
  assert.equal(seen.length, 1, '判定链监听器必须被调用**恰好一次**（一次 fan-out）；实测 ' + seen.length)
  assert.equal(seen[0].judgeType, 'worth_keeping', 'judgeType 必须是 worth_keeping')
  assert.ok(seen[0].requestId.includes('#worth_keeping'), 'judgeId 必须带判定类型后缀（落痕键可回填）：' + seen[0].requestId)
  assert.equal(afterJev - beforeJev, 1, `判定必须真落 jev_log 一行（既有审计面）；实测 ${afterJev - beforeJev}`)
  // 判定行可查（"判定发生过"有行可依，不是只靠返回值）
  const jrow = core.db.prepare('SELECT id, source, result_value FROM jev_log WHERE id = ?').get(seen[0].requestId)
  assert.ok(jrow, 'jev_log 必须能按 judgeId 查到该行')
  // ⚠ 落痕行的 `source` 由**判定链生产者**（jev 插件）写，取值 `mana-jev`；
  //   本门发出的 `source='mana-long-term'` 是**请求侧**标识（在监听器的 req 上可读）。
  //   两者不是同一个量 ⇒ 断言各归其位（把请求侧标识断言到落痕行上会得到一条错的判据）。
  assert.equal(jrow.source, 'mana-jev', 'jev_log.source 由生产者写（jev）；实测 ' + jrow.source)
  assert.equal(seen[0].source, 'mana-long-term', '请求侧 source 必须是本门标识（监听器实读）：' + seen[0].source)
  const st = ctx.get('mana-long-term').writeGateStatus
  assert.equal(st.registered, true, 'writeGateStatus.registered 必须为 true（监听器已挂）')
  assert.equal(st.lastState, 'written', 'lastState 必须是最近一次的状态：' + st.lastState)
})

// ══ ⑤ ★ 反证对拍：关掉 Write Gate ⇒ **不再产生新行**（且该反证非平凡）══════════
test('⑤ 反证：write=false（关掉落库）⇒ memory_items 不再增行；打开 ⇒ 增行（配对，防平凡通过）', async () => {
  ran += 1
  const { ctx, core, svc } = await mount('mana-wg-off-')
  await attachJudge(ctx, core)
  // 先证明"开着的时候真的写"（G11：否则"关掉后不写"是平凡通过）
  const onRes = await svc.writeGate(core.db, mod.coreSink(core), obs({ requestId: 'r-on-1' }))
  assert.equal(onRes.wroteRow, true, '对照组：开着必须写行（否则下面的"关掉不写"没有说服力）')
  const afterOn = itemCount(core)
  assert.equal(afterOn, 1, '对照组后库内应恰 1 行；实测 ' + afterOn)
  // 关掉落库
  const offRes = await svc.writeGate(core.db, mod.coreSink(core), obs({ requestId: 'r-off-1' }), { write: false })
  assert.equal(offRes.wroteRow, false, '关掉后 wroteRow 必须为 false')
  assert.equal(offRes.state, 'unavailable', '关掉落库的状态必须显式（unavailable）；实测 ' + offRes.state)
  assert.equal(itemCount(core), afterOn, '关掉后 memory_items 必须**不再增行**（增量 = 0）')

  // ── 同样对**事件链**做反证：卸载本插件后，同一触发不再产生新行
  const { ctx: ctx2, core: core2, fiber: fiber2 } = await mount('mana-wg-unload-')
  await attachJudge(ctx2, core2)
  ctx2.emit('mana/observation', obs({ requestId: 'r-u-1' }))
  await settle(350)
  const n1 = itemCount(core2)
  assert.equal(n1, 1, '卸载前：同一触发必须真写 1 行；实测 ' + n1)
  await fiber2.dispose()
  await settle(300)
  ctx2.emit('mana/observation', obs({ requestId: 'r-u-2' }))
  await settle(350)
  assert.equal(itemCount(core2), n1, '卸载后：同一触发必须**不再产生新行**（"卸载即净"的写面腿）')
  assert.equal(ctx2.get('mana-long-term'), undefined, '卸载后服务必须消失')
})

// ══ ⑥ 降级必须显式：判定链抛错 ⇒ degraded + failureKind + reason，且 fail-open 仍写 ══
test('⑥ 判定链抛错 ⇒ 显式降级（degraded/failureKind/reason 三件齐）+ fail-open **仍写入**', async () => {
  ran += 1
  const { ctx, core, svc } = await mount('mana-wg-throw-')
  ctx.on('mana/jev/judge', async () => { throw new Error('judge-boom-fixture') })
  const before = itemCount(core)
  const out = await svc.writeGate(core.db, mod.coreSink(core), obs({ requestId: 'r-throw-1' }))
  assert.equal(out.degraded, true, '抛错 ⇒ degraded 必须为 true（不得静默）')
  assert.equal(out.failureKind, 'judge-threw', 'failureKind 必须点名抛错；实测 ' + out.failureKind)
  assert.ok(out.reason && out.reason.includes('judge-boom-fixture'), 'reason 必须带原始真因：' + out.reason)
  assert.equal(out.value, 'unknown', '降级时 value 必须为 unknown（**不得默认成 no**）')
  assert.equal(out.probability, null, '降级时概率必须为 null（**不得用 0 冒充**「概率为零」）')
  assert.equal(out.state, 'degraded_written', 'fail-open 口径（rollout:103）：降级**仍写入**；实测 ' + out.state)
  assert.equal(itemCount(core) - before, 1, 'fail-open ⇒ 必须真增 1 行（记忆不得因判定链故障而丢失）')
})

// ══ ⑦ 「判了不值得」与「没判」必须可分辨（fail-open 的另一半）═════════════════
test('⑦ 判了且低于阈值 ⇒ rejected（不写，且与降级/跳过可分辨）；无判定链 ⇒ no-judge-listener', async () => {
  ran += 1
  const { ctx, core, svc } = await mount('mana-wg-reject-')
  const fw = await import(FRAMEWORK)
  const guard = new fw.JevGuard({ maxConcurrency: 8, sessionBudget: 1000 })
  // 假 Ollama 返回 **no 族**（概率 0.1 < 阈值 0.7）⇒ 判了但不留
  ctx.on('mana/jev/judge', async (req) => {
    const o = await fw.judgeWithGuard({
      guard, db: core.db, state: req.state, question: req.question,
      idFactory: () => req.requestId, sessionId: req.sessionId, turnId: req.turnId,
      fetchImpl: async () => new Response(JSON.stringify({
        logprobs: [{ top_logprobs: [{ token: 'yes', logprob: Math.log(0.1) }, { token: 'no', logprob: Math.log(0.9) }] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
      channel: 'ollama',
    })
    return { requestId: o.requestId, source: o.source, value: o.value, probability: o.probability, degraded: o.degraded, reason: o.reason }
  })
  const before = itemCount(core)
  const out = await svc.writeGate(core.db, mod.coreSink(core), obs({ requestId: 'r-rej-1' }))
  assert.equal(out.state, 'rejected', '低于阈值必须报 rejected（正常否决）；实测 ' + out.state)
  assert.equal(out.degraded, false, '判了且低分**不是降级**（degraded 必须为 false）——两者的区分正是本判据的要害')
  assert.equal(out.probability !== null, true, 'rejected 必须带真概率读数（不是 null）')
  assert.equal(itemCount(core), before, 'rejected ⇒ 不写行')

  // 无判定链（无监听器）：默认 next 支 ⇒ 显式 no-judge-listener + fail-open 写
  const { ctx: c2, core: core2, svc: svc2 } = await mount('mana-wg-nojudge-')
  const out2 = await svc2.writeGate(core2.db, mod.coreSink(core2), obs({ requestId: 'r-nj-1' }))
  assert.equal(out2.failureKind, 'no-judge-listener', '无监听器必须报 no-judge-listener（与"判了降级"可分辨）；实测 ' + out2.failureKind)
  assert.equal(out2.state, 'degraded_written', '无判定链 ⇒ fail-open 仍写入；实测 ' + out2.state)
})

// ══ ⑧ 不新增事件类型：本包写门**不 emit 任何 Mana 事件**（显式计数，非下界）═══
test('⑧ 不新增事件契约面：写门全过程 0 条 Mana 事件被 emit（判定只走既有 waterfall）', async () => {
  ran += 1
  const { ctx, core, svc } = await mount('mana-wg-events-')
  await attachJudge(ctx, core)
  const names = ['mana/observation', 'mana/attention', 'mana/decision', 'mana/recall', 'mana/injection', 'mana/jev/judged', 'mana/plugin/inactive']
  const counts = Object.fromEntries(names.map((n) => [n, 0]))
  for (const n of names) ctx.on(n, () => { counts[n] += 1 })
  await svc.writeGate(core.db, mod.coreSink(core), obs({ requestId: 'r-ev-1' }))
  await settle(150)
  assert.deepEqual(counts, Object.fromEntries(names.map((n) => [n, 0])), '写门不得 emit 任何 Mana 事件（不新增事件类型）：' + JSON.stringify(counts))
  // 判定走的是 waterfall（真被调用），证明"没有 emit"不等于"什么都没发生"
  assert.equal(jevCount(core) >= 1, true, '判定必须真落 jev_log（走既有 waterfall）：' + jevCount(core))
})

// ══ ⑨ 落库失败不得被读成「判了不值得」（同形即静默失败）══════════════════════
test('⑨ 写面抛错 ⇒ unavailable + reason 点名落库失败（**不得**读成 rejected）', async () => {
  ran += 1
  const { ctx, core, svc } = await mount('mana-wg-writefail-')
  await attachJudge(ctx, core)
  const failing = {
    isRetired: () => null,
    write: () => { throw new Error('disk-full-fixture') },
  }
  // ⚠ 写门**吞掉写失败**并返回 `unavailable`（它自己就是那条失败路径），
  //   只有"写门自身抛错"才冒泡 —— 本用例走的是前者。
  const out = await svc.writeGate(core.db, failing, obs({ requestId: 'r-wf-1' }))
  assert.equal(out.state, 'unavailable', '落库失败必须报 unavailable（不是 rejected）；实测 ' + out.state)
  assert.notEqual(out.state, 'rejected', '★ 落库失败**不得**与"判了不值得"同形')
  assert.equal(out.wroteRow, false, '写了没成 ⇒ wroteRow 必须为 false')
  assert.ok(out.reason && out.reason.includes('disk-full-fixture'), 'reason 必须带写面真因：' + out.reason)
  const st = svc.writeGateStatus
  assert.equal(st.degradedCount >= 1, true, '服务面必须把这次失败计入 degradedCount（可读，不是静默）：' + st.degradedCount)
  assert.ok(st.lastFailure && st.lastFailure.includes('disk-full-fixture'), 'lastFailure 必须带具名真因：' + st.lastFailure)
})

// ══ ⑩ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1/pass 1 的假绿）══
test('⑩ 用例计数自检', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
