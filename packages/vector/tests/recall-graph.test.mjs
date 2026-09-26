/**
 * **图检索腿判据**（W2-C3 · v10 §14.3 的第三条腿：向量 + FTS5 + **图**）。
 *
 * ⚠ **运行方式**（本仓实测过的假绿形态）：**不许用通配** —— `node --test "tests/*.test.mjs"`
 *   在目录不存在时**静默 exit 0**。本文件用显式路径跑：
 *   `node --test packages/vector/tests/recall-graph.test.mjs`
 *
 * 判据分档（`docs/contract/threshold-discipline.md`）：
 *   A 档（逐字比对）：解析四态、优先级口径、`rankBy`/`degraded` 契约字段；
 *   B 档（只作测量条件说明，**不进阈值列**）：端到端耗时。
 *
 * ── 本文件判什么（逐条对着派单的验收标准）───────────────────────────────────────
 * 1. **图检索腿可独立判据**：① 静态腿（只在 `packages/vector/**` 内、只读、零注册点）
 *    + ④ 端到端真跑（造关联边 ⇒ 只召回一条 ⇒ 邻接扩展带出对家，**给 SQL 真读数**）；
 * 2. **退化路径显式且可分辨**：⑤ 把"无关联边 / 有边没扩展 / 列缺失 / 行取不到"四种事实
 *    **并列**跑出来逐条比对（本仓最忌两种事实同形）+ ⑥ 显式关闭与"故障"用不同措辞；
 * 3. **RRF 口径显式且可断言**：③ 优先级公式（种子 > 一跳 > 两跳；入边 > 出边）
 *    + ⑧ 关腿/开腿两次运行的**管道契约字段逐字相同**（`rankBy`/`degraded` 零改动）。
 * 另有 ⑦ 双向可达的真实语义差（`scope`）与 ⑨ 负向对拍（同进程 A/B）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = new URL('../src/index.ts', import.meta.url).href
const GRAPH_SRC = new URL('../src/graph.ts', import.meta.url)
const INDEX_SRC = new URL('../src/index.ts', import.meta.url)
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const LEARNING_SRC = new URL('../../learning/src/store-format.ts', import.meta.url).href

/** 恒不可达端点（端口 1 无监听）——**每个用例都显式配它**，零网络、逐次同值。 */
const UNREACHABLE = 'http://127.0.0.1:1/v1'

/**
 * 期望用例条数（**相等**语义，与 `tests/gate.mjs` 的 EXPECTED_CASES 同源同值）：
 * 少一条即有判据被删走；改条数必须**同时**改这里与 gate.mjs。
 */
const EXPECTED_CASES = 10

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tempDir = (tag) => {
  const d = mkdtempSync(join(tmpdir(), tag))
  dirs.push(d)
  return d
}

const {
  runGraphLeg,
  recallGraphReadout,
  parseRelatedIdsCell,
  graphPriorityWeight,
  graphPriorityScore,
  SENSE,
  GRAPH_HOPS_MAX,
  GRAPH_SENSE_BASE,
  GRAPH_PRIORITY_PER_HOP,
  DEFAULT_RECALL_GRAPH_KNOBS,
} = await import(GRAPH_SRC.href)

/** 装 core + vector（**只用生产入口**：`ctx.plugin` + 服务面方法）。 */
async function mount(tag, { vecConfig = {} } = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const vecMod = await import(PLUGIN)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tempDir(tag), 'mana.db') })
  await settle(200)
  ctx.plugin(vecMod, { embedBaseUrl: UNREACHABLE, embedTimeoutMs: 2000, ...vecConfig })
  await settle(300)
  const core = ctx.get('mana-core')
  const svc = ctx.get('mana-vector')
  assert.ok(core && svc, '夹具必须真装起 mana-core 与 mana-vector（否则下面的断言全是空跑）')
  return { ctx, core, svc }
}

/**
 * 真造两条记忆 + 一条关联边（**写的是既有列** `memory_items.related_ids`，不新建表）。
 *
 * ⚠ **逐行写各自的单元格**（a 的行里是 `[{id:b}]`、b 的行里是 `[{id:a}]`）—— 这是 learning
 *   写侧的真实形态（`store.ts` 的 `pending` 对两侧各追加一次，两行内容**不同**）。
 *   首版把同一个「双向」单元格写进两行，结果**每行都指向自己**（自环）：`edgesSeen` 被记成 2
 *   （1 条真边 + 1 条自环）。判据当场报红抓出来了 —— 这正是"边读到了几条"必须真数的原因。
 */
function linkPair(core, a, b, w = 0.03) {
  core.writeMemoryItem({ id: a, type: 'fact', content: '图腿判据：甲（种子侧）' })
  core.writeMemoryItem({ id: b, type: 'fact', content: '图腿判据：乙（对家侧）' })
  // 与 learning 写侧同口径：带权 JSON 数组（`encodeRelated` 的字节形式）。
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run(JSON.stringify([{ id: b, w }]), a)
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run(JSON.stringify([{ id: a, w }]), b)
  return JSON.stringify([{ id: b, w }])
}

/** 读 SQL 原样（判据的"真读数"，不是自述）。 */
const sqlRows = (core, ids) =>
  core.db
    .prepare('SELECT id, related_ids FROM memory_items WHERE id IN (' + ids.map(() => '?').join(',') + ') ORDER BY id')
    .all(...ids)

/** 一次召回（**生产入口** `svc.recall`），返回 outcome + 图腿读数。 */
async function recallAndRead(svc, seedKey, envelope) {
  const out = await svc.recall('图腿判据查询', [{ key: seedKey, lexicalRank: 1 }], 5, envelope)
  return { out, graph: svc.lastRecallGraph() }
}

// ── 0. 判据自检：本文件必须**真的有判据**（防"空文件也绿"）────────────────────
test('W2-C3-⓪ 判据自检：本文件 test( 计数**等于** 10，且真源文件路径解析正确', () => {
  const self = fileURLToPath(import.meta.url)
  const src = readFileSync(self, 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  assert.equal(
    n,
    EXPECTED_CASES,
    `用例条数必须恰好 ${EXPECTED_CASES}（实测 ${n}）：少一条即有判据被删走；若确为有意增删，请同步 tests/gate.mjs 的 EXPECTED_CASES`,
  )
  assert.ok(!/^test\.only\(/m.test(src), '不得留下 test.only（那会让其余判据静默不跑）')
  const graphPath = fileURLToPath(GRAPH_SRC)
  assert.ok(graphPath.endsWith('packages/vector/src/graph.ts'), `../src/graph.ts 必须解析到 packages/vector/src/，实测 ${graphPath}`)
  assert.ok(readFileSync(fileURLToPath(INDEX_SRC), 'utf8').includes("from './graph.ts'"), 'index.ts 必须真 import 图腿（否则下面全是空跑）')
})

// ── 1. 静态腿：只在 packages/vector/** 内、只读、零注册点 ─────────────────────
test('W2-C3-① 静态腿：graph.ts 只读（无 DDL/DML）、零注册点，接线点落在 recall 实现体内', () => {
  const graph = readFileSync(fileURLToPath(GRAPH_SRC), 'utf8')
  const index = readFileSync(fileURLToPath(INDEX_SRC), 'utf8')

  // ① 零注册点（G9：不新增 agent/pre-step 注册点 —— 本包唯一的注册点仍是 index.ts 的直通链）
  for (const banned of ['ctx.on(', 'ctx.waterfall(', 'registerPassThroughPreStep', 'ctx.effect(', 'setInterval', 'setTimeout']) {
    assert.ok(!graph.includes(banned), `graph.ts 不得出现 ${banned}（G9：不新增注册点）`)
  }
  // 反向自证：banned 清单本身有效（它在 index.ts 里必须命中，否则"未出现"是空跑）
  assert.ok(index.includes('registerPassThroughPreStep') && index.includes('ctx.effect('), 'banned 清单必须能在既有源文件里命中（否则本断言是空跑）')

  // ② 只读：既有列，**不新建表**、不改任何数据
  for (const ddl of ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE', 'INSERT INTO', 'UPDATE ', 'DELETE FROM']) {
    assert.ok(!graph.includes(ddl), `graph.ts 不得出现 ${ddl}（图腿是只读检索腿，不新建表、不写库）`)
  }
  assert.ok(graph.includes('FROM memory_items'), 'graph.ts 必须真读 memory_items（否则"图检索腿"只是名字）')
  assert.ok(graph.includes('pragma_table_info'), 'graph.ts 必须先探列（列表 ≠ 没有边）')

  // ③ 接线点必须落在 recall 实现体**内部**
  const recallAt = index.indexOf('recall: async (query, candidates')
  assert.ok(recallAt > 0, '必须能在源码里定位 recall 实现体（锚点漂了本断言就是空跑）')
  assert.ok(index.indexOf('runGraphLeg(core.db') > recallAt, 'runGraphLeg 的调用点必须在 recall 实现体**之后**（即在其内部）')
})

// ── 2. 解析四态 + 与 learning 真产物对拍（孪生解析的等价性**由判据保证**）────────
test('W2-C3-② 解析四态可分辨 + 与 learning 真 encodeRelated 产物逐字对拍', async (t) => {
  // 四态：null / '' / 合法 / 非法 —— **不得混同**（本仓最忌两种事实同形）
  const nul = parseRelatedIdsCell(null)
  const empty = parseRelatedIdsCell('')
  const ok = parseRelatedIdsCell('[{"id":"m-b","w":0.03}]')
  const bad = parseRelatedIdsCell('{不是数组}')
  assert.equal(nul.state, 'null', '列从未被写过 ⇒ null（与"写成了空关系"是两件事）')
  assert.equal(empty.state, 'empty', "写者写过且结论是「没有关系」⇒ ''")
  assert.equal(ok.state, 'ok')
  assert.equal(bad.state, 'invalid')
  assert.equal(bad.items.length, 0, 'invalid 的 items 必须是空 —— 但**不许**把 invalid 读成"没有关系"')
  assert.ok(bad.reason && bad.reason.length > 0, 'invalid 必须给非空原因（吞成 [] 就是 catch{return null} 的形态）')
  assert.equal(nul.reason, null)
  assert.equal(empty.reason, null)
  assert.equal(ok.reason, null)

  // 逐条非法形态都要**点名**（否则"读不懂"不可查）
  const cases = ['', '[1,2]', '[{"id":"","w":1}]', '[{"id":"a","w":-1}]', '[{"id":"a","w":1},{"id":"a","w":2}]', '[{"id":"a","w":"x"}]', '[{"w":1}]']
  for (const c of cases) {
    const r = parseRelatedIdsCell(c)
    if (c === '') {
      assert.equal(r.state, 'empty', "空串是 empty（不是 invalid）")
      continue
    }
    assert.equal(r.state, 'invalid', `必须判 invalid：${c}`)
    assert.ok(r.reason && r.reason.length > 0, `invalid 必须带原因：${c}`)
  }

  // ── 对拍：learning 的**真产物**喂进来，逐字相等 ─────────────────────────────
  const learning = await import(LEARNING_SRC)
  const entries = [
    { id: 'mem-z', weight: 0.02 },
    { id: 'mem-a', weight: 0.03 },
  ]
  const encoded = learning.encodeRelated(entries)
  const mine = parseRelatedIdsCell(encoded)
  const theirs = learning.parseRelatedIds(encoded)
  assert.equal(mine.state, theirs.state, 'state 必须与 learning 逐字一致')
  assert.deepEqual(mine.items, theirs.items, 'items 必须与 learning 逐字一致（孪生解析的等价面）')
  assert.equal(mine.items[0].id, 'mem-a', '必须按 id 字典序（与写侧 encodeRelated 同口径）')
  // 反向：learning 判 invalid 的，本腿也必须判 invalid（不得一侧更宽松）
  for (const c of ['{不是数组}', '[{"id":"a","w":-1}]', '[{"id":"a","w":1},{"id":"a","w":2}]']) {
    assert.equal(parseRelatedIdsCell(c).state, learning.parseRelatedIds(c).state, `与 learning 判定不一致：${c}`)
  }
  t.diagnostic(
    `[对拍] learning.encodeRelated ⇒ ${encoded}；两侧 state=${mine.state}/${theirs.state}，items 逐字相等。四态：null/empty/ok/invalid=${[nul, empty, ok, bad].map((x) => x.state).join('/')}`,
  )
})

// ── 3. 优先级口径（A 档：**可断言**的"情境优先于内容相似"）─────────────────────
test('W2-C3-③ 优先级口径 A 档：种类间无撞值 + 跳数支配手性 + 种子恒严格最强', () => {
  const SENSES = [SENSE.hit, SENSE.inEdge, SENSE.outEdge, SENSE.hitKeyless]

  // ── 腿 1（**本用例的核心**）：不同 (hop,sense) 种类**不得撞值** ────────────────
  // ⚠ 这条判据是被**实测抓出来的**：首版取 SENSE_BASE=3/PER_HOP=2，而出边 sense=3 ⇒ 3-3=0，
  //   于是"一跳出边"与"两跳入边"拿到同一个 0 ⇒ 两件不同的事同形（本仓最忌）。
  //   撞值一旦发生，"越近越优先"这句话就不可断言了 —— 它不是审美问题。
  const seen = new Map()
  for (const h of [0, 1, 2, 3]) {
    for (const s of SENSES) {
      const w = graphPriorityWeight(h, s)
      const prev = seen.get(w)
      assert.equal(prev, undefined, `(hop=${h},sense=${s}) 与 (hop=${prev?.h},sense=${prev?.s}) 撞值 ${w}：不同的种类必须拿到不同的数`)
      seen.set(w, { h, s })
    }
  }
  // 无撞值的**充要条件**也必须成文：PER_HOP > SENSE_BASE ⇒ 相邻跳之间不可能重叠
  assert.ok(GRAPH_PRIORITY_PER_HOP > GRAPH_SENSE_BASE, `PER_HOP 必须严格大于 SENSE_BASE：${GRAPH_PRIORITY_PER_HOP} vs ${GRAPH_SENSE_BASE}`)

  // ── 腿 2：内容相似恒优先（hop=0 严格大于任何 hop≥1）───────────────────────────
  const seed = graphPriorityWeight(0, SENSE.hit)
  for (const s of SENSES) {
    for (const h of [1, 2, 3]) {
      assert.ok(graphPriorityWeight(h, s) < seed, `hop=${h} sense=${s} 必须弱于种子：${graphPriorityWeight(h, s)} vs ${seed}`)
    }
  }

  // ── 腿 3：**跳数严格支配手性**（近的恒强于远的），等价比值成文 ─────────────────
  assert.equal(graphPriorityWeight(1, SENSE.hit), GRAPH_SENSE_BASE / GRAPH_PRIORITY_PER_HOP, '一跳：基值 / 折算比')
  assert.equal(graphPriorityWeight(2, SENSE.hit), GRAPH_SENSE_BASE / GRAPH_PRIORITY_PER_HOP ** 2, '两跳：基值 / 折算比²')
  assert.ok(
    graphPriorityWeight(1, SENSE.hitKeyless) > graphPriorityWeight(2, SENSE.hit),
    '一跳**最弱**的种类仍必须强于两跳**最强**的种类（跳数支配手性）',
  )

  // ── 腿 4：同跳内 入边 > 出边 > 撞键无值（取值序即优先级序）────────────────────
  assert.ok(SENSE.hit < SENSE.inEdge && SENSE.inEdge < SENSE.outEdge && SENSE.outEdge < SENSE.hitKeyless, 'SENSE 的取值序必须就是优先级序')
  assert.ok(graphPriorityWeight(1, SENSE.inEdge) > graphPriorityWeight(1, SENSE.outEdge), '同跳内 入边 必须强于 出边')
  assert.ok(graphPriorityWeight(1, SENSE.outEdge) > graphPriorityWeight(1, SENSE.hitKeyless), '真边必须强于"撞键无值"')

  // ── 腿 5：clamp 面 ───────────────────────────────────────────────────────────
  assert.equal(graphPriorityScore(0, SENSE.hit), 1, '种子排序分必须是**严格的 1**')
  for (const h of [1, 2, 3, 8]) {
    for (const s of SENSES) {
      const v = graphPriorityScore(h, s)
      assert.ok(v > 0 && v < 1, `扩展键的排序分必须落 (0,1)（既不与种子并列、也不为 0）：hop=${h} sense=${s} ⇒ ${v}`)
    }
  }
  assert.ok(Object.isFrozen(DEFAULT_RECALL_GRAPH_KNOBS), '缺省配置必须冻结（防"缺省被就地改写"两处悄悄分叉）')
  assert.equal(GRAPH_HOPS_MAX, 2, '跳数上限是 2（超过即抛，不静默 clamp）')
})

// ── 4. 端到端真跑：造边 ⇒ 只召回一条 ⇒ 邻接扩展带出对家（**给 SQL 真读数**）─────
test('W2-C3-④ 端到端真跑：只召回一条 ⇒ 邻接扩展把对家带出（真库 + SQL 读数）', async (t) => {
  const { ctx, core, svc } = await mount('mana-w2c3-e2e-')
  const cell = linkPair(core, 'g-seed', 'g-other', 0.03)
  const rows = sqlRows(core, ['g-seed', 'g-other'])

  const { out, graph } = await recallAndRead(svc, 'g-seed')
  assert.ok(graph, 'lastRecallGraph() 必须可读（接线面的即时出口）')
  assert.equal(graph.ran, true, '图腿必须真跑：' + graph.unwiredReason)
  assert.equal(graph.exact, true, '种子行必须全部取到')
  assert.equal(graph.seeds, 1, '本次只有 1 个种子（管道只召回了它一条）')
  assert.equal(graph.edgesSeen, 1, '种子行上必须读到 1 条边（实测 ' + graph.edgesSeen + '）')
  assert.deepEqual(graph.keys, ['g-other'], '邻接扩展必须把**对家**带出来：' + JSON.stringify(graph.keys))
  assert.deepEqual(
    out.items.map((i) => i.key),
    ['g-seed'],
    '前提断言：管道**只**召回了种子那一条（否则"带出对家"平凡成立）',
  )
  assert.equal(graph.applied, false, '图腿本批**不折叠**进管道结果（只带读数）')

  t.diagnostic(
    `[SQL 真读数] memory_items.related_ids：` +
      rows.map((r) => `${r.id}=${r.related_ids}`).join(' · ') +
      ` ⇒ 种子=g-seed 只召回 1 条(${out.items.map((i) => i.key).join(',')})；图腿 ran=${graph.ran} edgesSeen=${graph.edgesSeen} additions=${graph.additions} keys=${JSON.stringify(graph.keys)} hops=${JSON.stringify(graph.additionsFromHops)} sense=${JSON.stringify(graph.additionsBySense)} consumed=${graph.consumed}`,
  )
  await ctx.stop?.()
})

// ── 5. 退化路径：四态**并列**跑出来，逐条可分辨（本仓最忌两种事实同形）───────────
test('W2-C3-⑤ 退化路径可分辨：无关联边 / 有边没扩展 / 列缺失 / 行取不到 **互不冒充**', async (t) => {
  const { ctx, core, svc } = await mount('mana-w2c3-degrade-')

  // (a) **无关联边**：行在、related_ids 为 NULL
  core.writeMemoryItem({ id: 'd-noedge', type: 'fact', content: '无关联边' })
  const a = await recallAndRead(svc, 'd-noedge')
  assert.equal(a.graph.ran, true, '(a) 行在 ⇒ 腿跑了')
  assert.equal(a.graph.edgesSeen, 0, '(a) 无关联边 ⇒ edgesSeen=0')
  assert.equal(a.graph.seedsWithoutEdges, 1, '(a) 必须计入"行在但无边"')
  assert.equal(a.graph.additions, 0)

  // (b) **有边但没扩展出来**：边指向**种子自己**（自环）⇒ 边读了、新键一个没有
  const { runGraphLeg: run } = await import(GRAPH_SRC.href)
  core.writeMemoryItem({ id: 'd-self', type: 'fact', content: '自环' })
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('[{"id":"d-self","w":0.01}]', 'd-self')
  const b = await recallAndRead(svc, 'd-self')
  assert.equal(b.graph.edgesSeen, 1, '(b) **边确实读到了**（实测 ' + b.graph.edgesSeen + '）')
  assert.equal(b.graph.additions, 0, '(b) 但一个新键都没带出来')

  // ⇒ (a) 与 (b) 的判别位：edgesSeen（0 vs 1），而两者的 additions 都是 0
  assert.notEqual(a.graph.edgesSeen, b.graph.edgesSeen, '(a)「无边」与 (b)「有边没扩」必须有**可断言的判别位**')

  // (c) **列缺失**（老库建于补列之前）：真 SQLite 库、只有旧版 memory_items 定义
  const { DatabaseSync } = await import('node:sqlite')
  const legacy = new DatabaseSync(':memory:')
  legacy.exec('CREATE TABLE memory_items (id TEXT PRIMARY KEY, type TEXT, content TEXT, created_at TEXT)')
  legacy.prepare('INSERT INTO memory_items (id, type, content, created_at) VALUES (?,?,?,?)').run('old-1', 'fact', '老库', '2026-01-01T00:00:00.000Z')
  const c = run(legacy, { seeds: ['old-1'] })
  assert.equal(c.ran, false, '(c) 列不存在 ⇒ 腿**没跑成**（不是"没有边"）')
  assert.equal(c.probe.state, 'missing-column', '(c) 列探测必须点名 missing-column')
  assert.ok(c.reason && c.reason.length > 0, '(c) 必须给非空原因')
  assert.ok(c.reason.includes('列不存在'), '(c) 原因必须说清是列不存在：' + c.reason)
  // 正向对照：同一个库里**补上列**后 ⇒ 立刻变成"跑了但无边"（防"永远报列缺失"也能骗过上面那条）
  legacy.exec('ALTER TABLE memory_items ADD COLUMN related_ids TEXT')
  const c2 = run(legacy, { seeds: ['old-1'] })
  assert.equal(c2.probe.state, 'present', '(c) 补列后探测必须变成 present')
  assert.equal(c2.ran, true, '(c) 补列后腿必须真跑')
  assert.equal(c2.edgesSeen, 0, '(c) 补列后仍无边 ⇒ 与"列缺失"分属两态')

  // (d) **行取不到**（种子不在库里）：与"没有边"必须分开数
  const d = await recallAndRead(svc, 'd-absent')
  assert.equal(d.graph.ran, true, '(d) 腿跑了（查询成功，只是没有那一行）')
  assert.equal(d.graph.exact, false, '(d) 种子没全取到 ⇒ exact=false')
  assert.deepEqual(d.graph.unreachableKeys, ['d-absent'], '(d) 必须**点名**是哪些行取不到：' + JSON.stringify(d.graph.unreachableKeys))
  assert.equal(d.graph.seedsWithEdges, 0)
  assert.equal(d.graph.seedsWithoutEdges, 0, '(d) "取不到行"**不得**计入"行在但无边"（两种事实分列）')

  t.diagnostic(
    '[四态并列] (a) 无边：ran=' + a.graph.ran + ' edgesSeen=' + a.graph.edgesSeen + ' seedsWithoutEdges=' + a.graph.seedsWithoutEdges +
      ' | (b) 有边没扩：ran=' + b.graph.ran + ' edgesSeen=' + b.graph.edgesSeen + ' additions=' + b.graph.additions +
      ' | (c) 列缺失：ran=' + c.ran + ' columnState=' + c.probe.state + ' reason=' + String(c.reason).slice(0, 40) +
      ' ⇒ 补列后 ran=' + c2.ran + '/edgesSeen=' + c2.edgesSeen +
      ' | (d) 行取不到：ran=' + d.graph.ran + ' exact=' + d.graph.exact + ' unreachable=' + JSON.stringify(d.graph.unreachableKeys),
  )
  legacy.close()
  await ctx.stop?.()
})

// ── 6. 显式关闭：与"故障"措辞不同（配置 vs 解析失败不得同形）───────────────────
test('W2-C3-⑥ 显式关闭：ran=false + 原因用"配置"措辞，与"故障"可分辨，且不影响既有检索', async (t) => {
  const { ctx, core, svc } = await mount('mana-w2c3-off-', { vecConfig: { recallGraph: { enabled: false } } })
  linkPair(core, 'o-seed', 'o-other')
  const { out, graph } = await recallAndRead(svc, 'o-seed')

  assert.equal(graph.enabled, false, '配置必须真的被读到（嵌套 Schema.object 的缺省/覆盖腿）')
  assert.equal(graph.ran, false, '关掉后必须**没跑**（未读库）')
  assert.equal(graph.additions, 0)
  assert.ok(graph.unwiredReason && graph.unwiredReason.includes('显式关闭'), '必须用"配置"措辞、可分辨：' + graph.unwiredReason)
  assert.ok(!graph.unwiredReason.includes('失败'), '显式关闭**不得**被写成故障措辞（否则"关了"与"坏了"同形）')
  assert.equal(graph.columnState, 'not-probed', '关掉时**不探列**（未读库，而非"探了没问题"）')
  assert.equal(graph.consumed, '未读取（已显式关闭）', '读数必须说清"一条都没读"')
  // fail-open：检索本身照常（关腿是**显式配置**，不是故障）
  assert.ok(out.items.length >= 1, '关腿不得影响既有检索返回')
  t.diagnostic('[显式关闭] ran=' + graph.ran + ' columnState=' + graph.columnState + ' reason=' + graph.unwiredReason + ' · 检索仍返回 ' + out.items.length + ' 条')
  await ctx.stop?.()
})

// ── 7. 双向可达：缺省 scope='seeds' vs 'global' 的**真实语义差** ───────────────
test("W2-C3-⑦ 可达性口径：缺省 'seeds' 出边可达；'global' 两侧都可达（入边 sense=1 的真读数）", async (t) => {
  const { runGraphLeg: run } = await import(GRAPH_SRC.href)
  const { ctx, core } = await mount('mana-w2c3-scope-')
  // 单向边：**只有** x 的单元格指向 y（y 的单元格为空串 = "写者写过，没有关系"）
  core.writeMemoryItem({ id: 's-x', type: 'fact', content: 'x 指向 y' })
  core.writeMemoryItem({ id: 's-y', type: 'fact', content: 'y 无出边' })
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('[{"id":"s-y","w":0.05}]', 's-x')
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('[]', 's-y')

  const bySeed = run(core.db, { seeds: ['s-x'] })
  const globalFromY = run(core.db, { seeds: ['s-y'], overrides: { scope: 'global' } })
  assert.deepEqual(bySeed.additions.map((a) => a.key), ['s-y'], "缺省 'seeds'：x 的出边必须可达")
  assert.deepEqual(
    globalFromY.additions.map((a) => a.key),
    ['s-x'],
    "'global'：从 y 出发必须能沿**入边**走到 x（缺省 seeds 范围做不到 —— 那正是这个旋钮的语义）",
  )
  assert.equal(globalFromY.additions[0].sense, SENSE.inEdge, '反向带出的手性必须是**入边**(1)：' + globalFromY.additions[0].sense)
  const seedFromX = run(core.db, { seeds: ['s-x'] })
  assert.equal(seedFromX.additions[0].sense, SENSE.outEdge, '正向带出的手性必须是**出边**(2)：' + seedFromX.additions[0].sense)
  assert.equal(bySeed.scope, 'seeds')
  assert.equal(globalFromY.scope, 'global')
  t.diagnostic(
    "[可达性] 'seeds' 从 x ⇒ " + JSON.stringify(bySeed.additions.map((a) => [a.key, a.sense, a.hop])) +
      " · 'global' 从 y ⇒ " + JSON.stringify(globalFromY.additions.map((a) => [a.key, a.sense, a.hop])) +
      '（sense 1=入边 / 2=出边 / 3=撞键无值）',
  )
  await ctx.stop?.()
})

// ── 8. 契约面零改动：关腿/开腿两次运行的管道字段**逐字相同**（A1-11 锚点）───────
test('W2-C3-⑧ 契约面零改动：开腿与关腿的 channel/rankBy/degraded/hitCount 逐字相同（A1-11）', async (t) => {
  const on = await mount('mana-w2c3-c-on-')
  const off = await mount('mana-w2c3-c-off-', { vecConfig: { recallGraph: { enabled: false } } })
  for (const m of [on, off]) {
    m.core.writeMemoryItem({ id: 'c-seed', type: 'fact', content: '契约面' })
    m.core.writeMemoryItem({ id: 'c-other', type: 'fact', content: '对家' })
    m.core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('[{"id":"c-other","w":0.02}]', 'c-seed')
  }
  let payload = null
  on.ctx.on('mana/recall', (p) => {
    payload = p
  })
  const env = { sessionId: 's-w2c3', turnId: 1, requestId: 'w2c3-contract' }
  const a = await recallAndRead(on.svc, 'c-seed', env)
  const b = await recallAndRead(off.svc, 'c-seed', env)
  await settle(150)

  // A1-11 的机检锚点：降级路径的 channel/rankBy 一个字节都不许变
  assert.equal(a.out.degraded, true, '前提：端点不可达 ⇒ 管道是**降级**态')
  assert.equal(a.out.channel, 'degraded', "channel 必须仍是 'degraded'（A1-11）")
  assert.equal(a.out.rankBy, 'local_score', "rankBy 必须仍是 'local_score'（A1-11：降级绝不标 jev_prob）")
  // 关腿/开腿逐字相同 ⇒ 图腿**没有**动管道
  for (const f of ['query', 'hitCount', 'channel', 'rankBy', 'degraded']) {
    assert.deepEqual(a.out[f], b.out[f], `图腿不得改动 ${f}：开腿=${JSON.stringify(a.out[f])} vs 关腿=${JSON.stringify(b.out[f])}`)
  }
  assert.deepEqual(a.out.items.map((i) => i.key), b.out.items.map((i) => i.key), 'items 的键序也不得被图腿改动')
  assert.deepEqual(a.out.items.map((i) => i.score), b.out.items.map((i) => i.score), 'items 的分也不得被图腿改动')

  // 载荷：既有契约字段与管道结果逐字一致；图腿读数是**契约外增量字段**
  assert.ok(payload, 'mana/recall 必须仍被 emit')
  for (const f of ['query', 'hitCount', 'channel', 'rankBy', 'degraded']) {
    assert.deepEqual(payload[f], a.out[f], `载荷的 ${f} 必须与管道结果逐字一致`)
  }
  assert.ok(payload.recallGate, '门控读数必须仍挂在同一载荷上（W1-4 面不得被本席摘掉）')
  assert.ok(payload.recallGraph, '图腿读数必须挂在同一载荷上（契约外增量字段）')
  assert.equal(payload.recallGraph.applied, false, 'applied 必须显式为 false（不是靠注释）')
  assert.deepEqual(payload.recallGraph.keys, ['c-other'], '载荷里的 keys 就是被带出的对家：' + JSON.stringify(payload.recallGraph.keys))

  t.diagnostic(
    '[契约面] 开腿=' + JSON.stringify({ c: a.out.channel, r: a.out.rankBy, d: a.out.degraded, h: a.out.hitCount }) +
      ' / 关腿=' + JSON.stringify({ c: b.out.channel, r: b.out.rankBy, d: b.out.degraded, h: b.out.hitCount }) +
      ' 逐字相同 · 载荷 recallGraph.keys=' + JSON.stringify(payload.recallGraph.keys) + ' applied=' + payload.recallGraph.applied,
  )
  await on.ctx.stop?.()
  await off.ctx.stop?.()
})

// ── 9. 负向对拍（同进程 A/B）：关掉邻接扩展 ⇒ 判据**必红** ────────────────────
test('W2-C3-⑨ 负向对拍：关掉邻接扩展（hops=0）⇒ 带不出对家且 edgesSeen 仍>0；两跳 ⇒ 二跳对家带出', async (t) => {
  const { runGraphLeg: run } = await import(GRAPH_SRC.href)
  const { ctx, core } = await mount('mana-w2c3-ab-')
  // A→B→C 链：A 与 C 之间**没有**直接边 ⇒ 只有跳数 ≥2 才能带出 C
  core.writeMemoryItem({ id: 'ab-a', type: 'fact', content: 'A' })
  core.writeMemoryItem({ id: 'ab-b', type: 'fact', content: 'B' })
  core.writeMemoryItem({ id: 'ab-c', type: 'fact', content: 'C' })
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('[{"id":"ab-b","w":0.04}]', 'ab-a')
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('[{"id":"ab-c","w":0.02}]', 'ab-b')
  core.db.prepare('UPDATE memory_items SET related_ids = ? WHERE id = ?').run('[]', 'ab-c')

  // 正向（生产缺省 hops=1）
  const normal = run(core.db, { seeds: ['ab-a'] })
  assert.deepEqual(normal.additions.map((a) => a.key), ['ab-b'], '缺省一跳必须带出 B')
  assert.equal(normal.hops, DEFAULT_RECALL_GRAPH_KNOBS.hops, '生产缺省的跳数就是配置缺省（不是判据给的）')

  // 反位 A：**关掉邻接扩展** ⇒ 对家带不出来，但"边读过"这件事仍在读数里
  const noExpand = run(core.db, { seeds: ['ab-a'], overrides: { hops: 0 } })
  assert.deepEqual(noExpand.additions, [], '关掉扩展后必须**一条都不带出**（这正是判据的靶心）')
  assert.notDeepEqual(noExpand.additions.map((a) => a.key), normal.additions.map((a) => a.key), 'A/B 两位必须可分辨（否则"扩展了"不可证伪）')
  assert.equal(noExpand.ran, true, '关掉**扩展**不等于关掉**腿**：腿仍跑了')
  assert.ok(noExpand.edgesSeen > 0, '关掉扩展后边仍被读到（edgesSeen>0）⇒ 与"无边"不同形：' + noExpand.edgesSeen)
  assert.throws(() => run(core.db, { seeds: ['ab-a'], overrides: { hops: GRAPH_HOPS_MAX + 1 } }), /hops 必须是/, '越界跳数必须抛（不静默 clamp）')

  // 反位 B：两跳 —— **两态并列**，因为"二跳能不能到"取决于**读到没有 B 那一行**
  //   ① 缺省 scope='seeds'：只读了 A ⇒ B 的行没读 ⇒ B→C 这条边**结构上不可见**（必须如实报出来，
  //      而不是静默"扩不到"）；此时 B 仍是**入边**可达（它指向 A 的那条边在 B 的行里……也不在，
  //      故连 B 都只能靠 A 的出边拿到）；
  //   ② scope='global'：全表读 ⇒ B 的行也在 ⇒ 二跳真能把 C 带出来。
  const twoHopsSeeds = run(core.db, { seeds: ['ab-a'], overrides: { hops: 2 } })
  const twoHopsGlobal = run(core.db, { seeds: ['ab-a'], overrides: { hops: 2, scope: 'global' } })
  assert.deepEqual(
    twoHopsSeeds.additions.map((a) => a.key),
    ['ab-b'],
    '缺省 seeds 范围下二跳带不出 C：**B 的那一行没被读**（能力边界，必须显式，不许静默）',
  )
  assert.deepEqual(
    twoHopsGlobal.additions.map((a) => a.key).sort(),
    ['ab-b', 'ab-c'],
    'global 范围下二跳必须把 C 也带出来：' + JSON.stringify(twoHopsGlobal.additions.map((a) => a.key)),
  )
  const b = twoHopsGlobal.additions.find((a) => a.key === 'ab-b')
  const c = twoHopsGlobal.additions.find((a) => a.key === 'ab-c')
  assert.equal(b.hop, 1)
  assert.equal(c.hop, 2, 'C 的跳数必须是 2（不是 1 —— 否则"跳数参与"不可断言）')
  assert.ok(b.priorityScore > c.priorityScore, `一跳必须强于两跳：${b.priorityScore} vs ${c.priorityScore}`)
  assert.equal(recallGraphReadout(twoHopsGlobal, true).additionsFromHops.join(','), '1,2', '读数必须逐条报出跳数')

  t.diagnostic(
    '[A/B 对拍] 缺省 hops=' + normal.hops + ' ⇒ ' + JSON.stringify(normal.additions.map((a) => [a.key, a.hop])) +
      ' | 关扩展 hops=0 ⇒ additions=' + noExpand.additions.length + ' 而 edgesSeen=' + noExpand.edgesSeen +
      ' | 两跳(seeds) ⇒ ' + JSON.stringify(twoHopsSeeds.additions.map((a) => [a.key, a.hop])) +
      ' | 两跳(global) ⇒ ' + JSON.stringify(twoHopsGlobal.additions.map((a) => [a.key, a.hop, Number(a.priorityScore.toFixed(4))])),
  )
  await ctx.stop?.()
})
