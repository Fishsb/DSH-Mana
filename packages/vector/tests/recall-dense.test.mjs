/**
 * L1 **稠密候选腿**判据：向量腿自己产生候选（`recall.ts` 的 `recallDenseCandidates`）。
 *
 * ── 本文件问的问题（与邻座的判据**不重叠**，别互相冒充）──────────────────────────
 *   · `b11-vector.test.mjs`：给定候选时**排序/降级/契约**对不对（重排器那条腿）；
 *   · `recall-graph.test.mjs` / `bigloop-wiring.test.mjs`：另两条腿的接线与读数；
 *   · **本文件**：候选**从哪来** —— 词法查不到时向量腿能不能自己找到，以及找不到时
 *     「没得扫 / 没扫成 / 扫了不相近 / 量过但漏掉」四件事**是否可分辨**。
 *
 * ── 判据纪律（本仓血的教训，逐条落到可机检面上）───────────────────────────────
 *   ① **两个方向都判**：正向（语义相近真被召回）**必须**配反向（真无关仍 0 命中）——
 *      只有正向的判据，在「阈值失效 ⇒ 永不空手」时会照样绿。
 *   ② **反向用例必须自证"扫了"**：只断言 `hitCount === 0` 的负例，会被「腿压根没跑」骗过
 *      （本仓实测过的假绿形态）⇒ 负例里同时断言 `dense.ran === true` 且 `scanned > 0`。
 *   ③ **N=0 显式记 0**：`scanned = 0` 与「扫了但 matched = 0」是两件不同的事，两组用例分别钉住。
 *   ④ **不静默折成空候选**：列举 SQL 失败必须给具名原因 + `scanError = true`（用例③拿真抛错取证）。
 *   ⑤ **真数据接真链路**：正向/反向/空库的读数经**真 cordis 装配 + 真 core 库 + 真 bge-m3 嵌入**
 *      产生（走 `putMemoryVector` 这条生产写面，不是自造 SQL、不是夹具向量）。
 *
 * 运行：`node --test packages/vector/tests/recall-dense.test.mjs`（本仓不许用通配：空目录下静默 exit 0）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeVector, VectorStore } from '../src/vec-blob.ts'
// 真端点判据的**归因读数**（口径：docs/mana-endpoint-attribution.md）：只换文案/类别，不换判据。
import { assertLiveEmbed } from './_live-endpoints.mjs'
import { DEFAULT_EMBED_MODEL } from '../src/adapt.ts'
import {
  DENSE_DISABLED_REASON,
  DENSE_NO_DB_REASON,
  DENSE_UNAVAILABLE,
  DENSE_ENUMERATE_SQL,
  DEFAULT_DENSE_CANDIDATE_KNOBS,
  recallDenseCandidates,
  recallVector,
} from '../src/recall.ts'

const OLLAMA = 'http://127.0.0.1:11434/v1'
const PLUGIN = new URL('../src/index.ts', import.meta.url).href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href

/** 期望用例条数（**等式**语义；改条数须同步 `tests/gate.mjs` 的 FILES）。 */
const EXPECTED_CASES = 11

// ── 0. 自检：本文件必须**真的有判据**（防"空文件也绿"的假绿形态）──────────────
test('dense-⓪ 判据自检：test( 计数等于 ${EXPECTED_CASES} 且交付文件齐备', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const self = fileURLToPath(import.meta.url)
  const src = readFileSync(self, 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  assert.equal(n, EXPECTED_CASES, `用例条数必须恰好 ${EXPECTED_CASES}（实测 ${n}）：少一条即有判据被删走`)
  assert.ok(!/^test\.only\(/m.test(src), '不许有 test.only（会让其余判据静默不跑）')

  const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
  for (const f of ['recall.ts', 'index.ts', 'adapt.ts']) {
    assert.ok(existsSync(srcDir + f), `交付文件缺失：${srcDir}${f}`)
  }
  // 缺省真源**只有一处**：配置面（index.ts）必须与它同值，否则"改一处忘另一处"会静默漂开。
  assert.deepEqual(
    DEFAULT_DENSE_CANDIDATE_KNOBS,
    { enabled: true, threshold: 0.5, scanRows: 512, topN: 20 },
    '缺省真源必须与 index.ts 的 Config 缺省同值（用例⑨再核运行时解析出来的值）',
  )
})

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'mana-dense-'))
  dirs.push(d)
  return d
}
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/** 合成夹具向量（确定性：不用随机数，避免"一会儿过一会儿不过"）。 */
const fixtureVec = (dim, seed) => {
  const v = new Float32Array(dim)
  for (let i = 0; i < dim; i++) v[i] = Math.sin((i + 1) * (seed + 1) * 0.011) * Math.cos(i * 0.017 + seed)
  return v
}

/**
 * 与查询向量**恰好**成给定余弦的行向量（把阈值判据的边界做成**确定值**，不靠"看起来像/不像"）。
 * 构造：查询 = e0，行 = [c, sqrt(1-c²), 0, …] ⇒ 余弦恰为 c。
 */
const qvAxis0 = (dim) => {
  const q = new Float32Array(dim)
  q[0] = 1
  return q
}
const vecWithCos = (dim, c) => {
  const v = new Float32Array(dim)
  v[0] = c
  v[1] = Math.sqrt(Math.max(0, 1 - c * c))
  return v
}

/** 假 db：把「列举返回哪些行」与「列举抛不抛」两件事**分别**钉住。 */
const stubDb = (rows, opts = {}) => {
  const state = { calls: 0, lastParams: [] }
  return {
    state,
    prepare(sql) {
      assert.equal(sql, DENSE_ENUMERATE_SQL, `本腿只许用这一条列举 SQL，实测 ${sql}`)
      return {
        all(...params) {
          state.calls += 1
          state.lastParams = params
          if (opts.throwOnAll) throw new Error(opts.throwOnAll)
          return rows
        },
      }
    },
  }
}
const rowOf = (id, vec) => ({ id, vector: encodeVector(vec) })

/** 确定性嵌入桩返回的那一条向量（常量）：做"池非空/池空"这类**结构**判据时用它，不牵涉语义。 */
const constEmbedding = (dim, fill) => Float32Array.from({ length: dim }, () => fill)

/** 确定性嵌入桩（**不**走网络）：本文件只有 §3 那三条走真端点，别混。 */
const constFetch = (fill) => async () =>
  new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(fill) }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
const baseCfg = (over = {}) => ({
  enabled: true,
  baseUrl: 'http://127.0.0.1:9/v1',
  model: 'bge-m3',
  dim: 1024,
  rrfK: 60,
  fetchImpl: constFetch(0.1),
  ...over,
})

// ── 1. 边界：库里**没有**已嵌入行 ⇒ ran=true / scanned=0（与"扫了不相近"可分辨）──

test('dense-① 真库无边：ran=true&scanned=0；放进一条已嵌入行后同一调用 scanned=1（负向控制）', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const dir = tempDir()
  const ctx = new Context()
  ctx.plugin(await import(CORE), { storePath: join(dir, 'mana.db') })
  await settle(300)
  const core = ctx.get('mana-core')

  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  const qv = qvAxis0(1024)

  // ① 库里一条已嵌入行都没有（**真库**，不是"表不存在"）
  const empty = recallDenseCandidates(knobs, core.db, { qv, topK: 10, alreadyKeys: [] })
  assert.equal(empty.readout.ran, true, '真库扫描必须 ran=true（"扫了"与"没扫"是两件事）')
  assert.equal(empty.readout.scanned, 0, 'N=0 必须**显式记 0**（不是缺字段）')
  assert.equal(empty.readout.matched, 0)
  assert.deepEqual(empty.candidates, [])
  assert.equal(empty.readout.unavailableReason, null, '扫成了就不该有 unavailableReason（那是"没跑成"的字段）')
  assert.equal(empty.readout.scanError, false)

  // ② 写一条**未嵌入**的记忆行（vector IS NULL）⇒ 仍不进扫描面（这就是 WHERE vector IS NOT NULL 的判据）
  core.writeMemoryItem({ id: 'dense-null', type: 'observation', content: '未嵌入的行', at: new Date().toISOString() })
  const withNull = recallDenseCandidates(knobs, core.db, { qv, topK: 10, alreadyKeys: [] })
  assert.equal(withNull.readout.scanned, 0, 'vector IS NULL 的行**不得**进扫描面')

  // ③ 负向控制：往同一张真表里补一条**已嵌入**行 ⇒ 同一调用必须扫到它（否则上面的 0 可能是"腿没跑"）
  core.db.prepare('UPDATE memory_items SET vector = ? WHERE id = ?').run(encodeVector(vecWithCos(1024, 0.9)), 'dense-null')
  const withRow = recallDenseCandidates(knobs, core.db, { qv, topK: 10, alreadyKeys: [] })
  assert.equal(withRow.readout.scanned, 1, '已嵌入行必须被扫到（负向控制：证明上面的 0 来自扫描面，不是来自"没扫"）')
  assert.equal(withRow.readout.matched, 1)
  assert.deepEqual(withRow.candidates.map((c) => c.key), ['dense-null'])
  assert.ok(Math.abs(withRow.readout.candidateSims[0] - 0.9) < 1e-6, `余弦须等于构造值 0.9，实测 ${withRow.readout.candidateSims[0]}`)
  await ctx.stop?.()
})

test('dense-② 扫了但都不相近：scanned>0 / matched=0 / candidates 空，且每行原因**具名**', () => {
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  // 两行都与查询正交 ⇒ 余弦恰为 0 ⇒ 全被阈值挡下（"扫了但不相近"）
  const db = stubDb([rowOf('m-a', vecWithCos(1024, 0)), rowOf('m-b', vecWithCos(1024, 0))])
  const r = recallDenseCandidates(knobs, db, { qv: qvAxis0(1024), topK: 10, alreadyKeys: [] })
  assert.equal(r.readout.ran, true)
  assert.equal(r.readout.scanned, 2, '扫了 2 行必须记 2（与 dense-① 的 scanned=0 不同形）')
  assert.equal(r.readout.matched, 0, '都不相近 ⇒ matched=0')
  assert.deepEqual(r.candidates, [], '没候选就是没候选（不得拿任意一条凑数）')
  assert.equal(r.readout.omitted.length, 2, '扫到而没进池的必须**逐条具名**（"量过而漏掉"不得与"从未扫到"同形）')
  for (const o of r.readout.omitted) {
    assert.ok(o.reason.includes('余弦') && o.reason.includes('阈值'), `原因须说明是被阈值挡下的：${o.reason}`)
  }
})

test('dense-③ 列举 SQL 失败：具名 enumerate-failed + scanError=true，**不**折成空候选', () => {
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  const boom = stubDb([], { throwOnAll: 'boom-sql: no such column' })
  const r = recallDenseCandidates(knobs, boom, { qv: qvAxis0(1024), topK: 10, alreadyKeys: [] })
  assert.equal(r.readout.ran, false, '列举失败 ⇒ ran=false（**不是**"扫了 0 行"）')
  assert.equal(r.readout.scanError, true, '真故障必须与"扫了但没有候选"可分辨（本卡硬要求）')
  assert.ok(r.readout.unavailableReason?.startsWith('enumerate-failed'), `原因须以具名取值开头：${r.readout.unavailableReason}`)
  assert.ok(r.readout.unavailableReason.includes('boom-sql'), '必须带原始报错（否则查不到为什么扫不成）')
  assert.ok(DENSE_UNAVAILABLE.includes('enumerate-failed'), '取值必须在可枚举清单里')
  assert.equal(r.readout.scanned, 0, '没扫成时 scanned 必为 0（与"扫了 0 行"靠 ran/scanError 分开）')
  assert.deepEqual(r.candidates, [], '候选为空，但**不是**因为"没有候选"——读数已把区别表出')

  // 反向控制：同一形状的 db 换回可真查询 ⇒ 不得仍报 enumerate-failed（否则"永远失败"也能骗过上面那条）
  const okDb = stubDb([rowOf('m-a', vecWithCos(1024, 0.8))])
  const ok = recallDenseCandidates(knobs, okDb, { qv: qvAxis0(1024), topK: 10, alreadyKeys: [] })
  assert.equal(ok.readout.ran, true)
  assert.equal(ok.readout.unavailableReason, null)
  assert.deepEqual(ok.candidates.map((c) => c.key), ['m-a'])
})

test('dense-④ 上限与阈值：scanRows 用满 / topN 截断 / threshold 全挡 —— 三种"没候选"互不同形', () => {
  const rows = [rowOf('m-a', vecWithCos(1024, 0.9)), rowOf('m-b', vecWithCos(1024, 0.8)), rowOf('m-c', vecWithCos(1024, 0.7))]
  const qv = qvAxis0(1024)

  // ① 阈值 0.75 ⇒ 两行过线、一行被挡；topN 足够 ⇒ 两条候选
  const r1 = recallDenseCandidates({ ...DEFAULT_DENSE_CANDIDATE_KNOBS, threshold: 0.75 }, stubDb(rows), { qv, topK: 10, alreadyKeys: [] })
  assert.equal(r1.readout.scanned, 3)
  assert.equal(r1.readout.matched, 2, '过阈值的条数（matched）与实际取到的候选**不是一回事**')
  assert.deepEqual(r1.candidates.map((c) => [c.key, c.denseRank]), [['m-a', 1], ['m-b', 2]], '名次按余弦降序、从 1 起')

  // ② topN=1 ⇒ 只剩 1 条，被截掉的那条在 omitted 里有**具名**理由（"量过而漏掉"）
  const r2 = recallDenseCandidates({ ...DEFAULT_DENSE_CANDIDATE_KNOBS, threshold: 0.75, topN: 1 }, stubDb(rows), { qv, topK: 10, alreadyKeys: [] })
  assert.equal(r2.readout.matched, 2)
  assert.deepEqual(r2.candidates.map((c) => c.key), ['m-a'])
  const cut = r2.readout.omitted.find((o) => o.key === 'm-b')
  assert.ok(cut && cut.reason.includes('取数上限'), `被 topN 截掉的须具名：${JSON.stringify(r2.readout.omitted)}`)
  assert.ok(r2.readout.omitted.some((o) => o.key === 'm-c'), '被阈值挡掉的同样具名（两类原因不得同形）')

  // ③ scanRows=2 ⇒ 只扫 3 行中的 2 行；第 3 行**根本不在** omitted 里（"从未扫到"）
  const r3 = recallDenseCandidates({ ...DEFAULT_DENSE_CANDIDATE_KNOBS, threshold: 0.75, scanRows: 2 }, stubDb(rows), { qv, topK: 10, alreadyKeys: [] })
  assert.equal(r3.readout.scanned, 2, '扫描上限必须真生效')
  assert.equal(r3.readout.scanLimitReached, true, '读满 scanRows+1 行 ⇒ 上限被用满（不是静默截断）')
  assert.ok(!r3.readout.omitted.some((o) => o.key === 'm-c'), '未被扫到的行**不得**出现在 omitted（"从未扫到"与"扫到被截"必须不同形）')

  // ④ 阈值 0.95 ⇒ 全被挡；scanned 仍是 3 ⇒ 与 dense-① 的 scanned=0 **可分辨**
  const r4 = recallDenseCandidates({ ...DEFAULT_DENSE_CANDIDATE_KNOBS, threshold: 0.95 }, stubDb(rows), { qv, topK: 10, alreadyKeys: [] })
  assert.equal(r4.readout.scanned, 3)
  assert.equal(r4.readout.matched, 0)
  assert.equal(r4.readout.scanLimitReached, false, '库里的行都扫过了 ⇒ 上限**确实没截断**（false 不是"没有截断证据"）')
  assert.deepEqual(r4.candidates, [])
})

// ── 2. 契约面：四态可分辨 + 增量字段（既有三态语义一字不动）────────────────

test('dense-⑤ 四态可分辨：未传旋钮⇒无 dense 键；未启用/无库句柄⇒ran=false 具名；库空⇒ran=true&scanned=0', async () => {
  const store = new VectorStore({ dim: 1024 })
  const q = '四态探针'

  // (a) 不传 cfg.dense：本腿**未尝试扫描** ⇒ 结果里**没有** dense 键（undefined ≠ ran:false）
  const a = await recallVector(baseCfg(), store, q, [], 5)
  assert.equal('dense' in a, false, '未传 cfg.dense ⇒ 本腿**根本没被叫到** ⇒ 不写读数键（与"尝试了没跑成"分列）')
  // ⚠ 读法：走路降不回「未尝试」——扫描一旦启动，结果必是 ran=true 或 unavailableReason 非空（没有第三种）。
  //   "未尝试"只有这一个前提：调用方没要求（本用例 (a) 就是它）。
  assert.equal(a.channel, 'vector')
  assert.equal(a.hitCount, 0)

  // (b) 显式关闭：ran=false + 具名 dense-disabled（**不是故障**，与 (c)(d) 不同形）
  const b = await recallVector(baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS, enabled: false }, denseDb: stubDb([]) }), store, q, [], 5)
  assert.equal(b.dense?.ran, false)
  assert.ok(b.dense?.unavailableReason?.startsWith('dense-disabled'), `实测 ${b.dense?.unavailableReason}`)
  assert.equal(b.dense?.unavailableReason, DENSE_DISABLED_REASON, '措辞取自唯一真源，不在调用点手写')
  assert.equal(b.dense?.scanError, false)
  // ⚠ 三条既有语义**不得**被本腿改写（这是"增量字段、不是改契约"的机检点）
  assert.equal(b.channel, 'vector')
  assert.equal(b.rankBy, 'rrf')
  assert.equal(b.degraded, false)

  // (c) 开着但调用面没给库句柄：ran=false + 具名 no-db-handle（"没提供扫描面"不是故障）
  const c = await recallVector(baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS } }), store, q, [], 5)
  assert.equal(c.dense?.ran, false)
  assert.equal(c.dense?.unavailableReason, DENSE_NO_DB_REASON)
  assert.equal(c.dense?.scanError, false)

  // (d) 真扫、库里没有已嵌入行：ran=true & scanned=0 ⇒ 与 (b)(c) **可分辨**
  const d = await recallVector(baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS }, denseDb: stubDb([]) }), store, q, [], 5)
  assert.equal(d.dense?.ran, true)
  assert.equal(d.dense?.scanned, 0)
  assert.equal(d.dense?.unavailableReason, null)
  assert.deepEqual([b.dense?.ran, c.dense?.ran, d.dense?.ran], [false, false, true], '三种"没拿到候选"必须落在不同的读数上')
  assert.equal(d.dense?.unavailableReason, null, '库空是"扫成了但没得扫"（不是失败，不得具名原因）')
})

test('dense-⑥ 池非空**也扫一次**（第二路）：请求池一条不作废；未要求本腿则零调用（负向控制）', async () => {
  const store = new VectorStore({ dim: 1024 })
  store.put('lex-1', fixtureVec(1024, 3))
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }

  // (a) ⚠ **本卡之后唯一**一条"不扫"的路径：调用方**没要求**本腿（不传 cfg.dense）。
  //     扫描面若被碰，这里会**抛**（stub 只允许那一条 SQL，且计数）—— 这就是它的机械证据。
  const never = { calls: 0 }
  const neverDb = {
    prepare(sql) {
      never.calls += 1
      throw new Error(`未要求本腿时不该碰扫描面，实测调用了 ${sql}`)
    },
  }
  const out0 = await recallVector(baseCfg({ denseDb: neverDb }), store, '池非空', [{ key: 'lex-1', lexicalRank: 1 }], 5)
  assert.equal(never.calls, 0, '不传 cfg.dense ⇒ 一次库都不扫（"纯重排器"调用面的既有口径，与本卡的缺省无关）')
  assert.equal('dense' in out0, false, '没尝试过扫描就不写读数键')
  assert.equal(out0.hitCount, 1)

  // (b) ⚠ **本卡换掉的那条口径**：要求了本腿且**池非空** ⇒ 恰好扫一次，读数必写，请求池一条不作废。
  // ⚠ 行向量必须与**本次查询向量**（constFetch(0.1) ⇒ 全 0.1 的均匀向量）成大于阈值 0.5 的余弦：
  //   全 0.1 的行向量 ⇒ cos = 1.0。用 vecWithCos(...) 那种"只有前两维非零"的构造会得到 0.0417（被阈值挡下）。
  const db = stubDb([rowOf('lex-2', constEmbedding(1024, 0.1))])
  const out = await recallVector(baseCfg({ dense: knobs, denseDb: db }), store, '池非空', [{ key: 'lex-1', lexicalRank: 1 }], 5)
  assert.equal(db.state.calls, 1, '池非空时也**恰好**扫一次（不是 0 次，也不是 2 次）')
  assert.equal(out.dense?.ran, true, '真扫过 ⇒ 读数必写（改动前这里是"不写"）')
  assert.equal(out.dense?.scanned, 1, '扫描量可见')
  assert.deepEqual(out.dense?.candidates.map((c) => c.key), ['lex-2'])
  // ⚠ 正向提升落在**名次表**上（不是"TOP-1 变了"）：请求池的键两路都有名次，本腿新增的键只带 dense 名次。
  assert.deepEqual(out.items.map((i) => i.key), ['lex-1', 'lex-2'], '请求池的键一条不作废，新增候选按 RRF 排在其后')
  assert.deepEqual(out.items[0].rank, { dense: 1, lexical: 1 }, '请求池的键：两路名次都在（**并集**，不是替换）')
  assert.deepEqual(out.items[1].rank, { dense: 1 }, '本腿自产的键：**只有 dense 名次**（不得伪造 lexical 名次）')

  // 对照腿：把同一 store 该有的向量**也放进扫描面**（列举返回的就是它），再给同一个常量查询向量 ⇒
  // 池空应该真走完「列举 ⇒ 算余弦 ⇒ 进池 ⇒ RRF」，而**不是**停在"候选进不了常驻表"那里。
  // ⚠ 这里判的是**结构**（扫描面被叫到、候选进池、融合出结果），语义质量是 §3 那三条真数据用例的事。
  const okDb = stubDb([rowOf('lex-2', constEmbedding(1024, 0.1))])
  const out2 = await recallVector(baseCfg({ dense: knobs, denseDb: okDb }), store, '池空', [], 5)
  assert.equal(okDb.state.calls, 1, '池空时扫描面同样恰好一次（**同一份实现**，不按池空与否分叉）')
  assert.equal(out2.dense?.scanned, 1)
  assert.equal(out2.degraded, true, '该向量还没进常驻表 ⇒ 这一步按既有语义降级（点名哪条取不到），不是"命中"')
  store.put('lex-2', constEmbedding(1024, 0.1))
  const out3 = await recallVector(baseCfg({ dense: knobs, denseDb: okDb }), store, '池空', [], 5)
  assert.deepEqual(out3.items.map((i) => i.key), ['lex-2'])
  assert.deepEqual(out3.items[0].rank, { dense: 1 }, '词法没有的候选**不得**伪造词法名次（rank 里只该有 dense）')
  assert.equal(out3.rankBy, 'rrf', '融合仍走既有 RRF（不另立融合算法）')
})

// ── 3. 真数据（真装配 + 真库 + 真 bge-m3）：正向 / 反向 / 空库，三条读数并列 ────
//
// ⚠ 本组与上面各组的"命中/不命中"含义**相反**，合并即同形（本仓最忌）：
//   · 正向：语义相近 ⇒ **应当**命中（不命中才是缺陷）；
//   · 反向：真无关   ⇒ **必须**不命中（命中即"永不空手"故障）；
//   · 空库：没有可扫的行 ⇒ 0 命中但 scanned=0（**测量条件**，不是能力缺失）。

const MEMO = '我偏好开源方案，长期用 WSL 做主力开发环境，不要推荐商业工具'
const ASK_NEAR = '我不想用收费的软件'
const ASK_FAR = '量子纠缠退相干'

/** 真装配：core + vector（走**生产配置面**），返回服务面。 */
async function bootReal(over = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const dir = tempDir()
  const ctx = new Context()
  ctx.plugin(await import(CORE), { storePath: join(dir, 'mana.db') })
  await settle(300)
  const fiber = ctx.plugin(await import(PLUGIN), { embedBaseUrl: OLLAMA, embedEnabled: true, ...over })
  await settle(400)
  return { ctx, fiber, core: ctx.get('mana-core'), svc: ctx.get('mana-vector') }
}

/** 走生产写面写一条记忆并嵌入（**不自造 SQL**：写面与召回面之间不留缝）。 */
async function remember(core, svc, id, text) {
  core.writeMemoryItem({ id, type: 'observation', content: text, at: new Date().toISOString() })
  const emb = await svc.embed([text])
  // 测量条件那一腿：环境不可用 ⇒ 红且点名"查环境"；环境可用而读数不对 ⇒ 红且点名"查代码"。
  assertLiveEmbed(emb, { title: 'dense-⑦⑧⑨ 真数据前提（生产写面嵌入）', baseUrl: OLLAMA, model: DEFAULT_EMBED_MODEL })
  const w = await svc.putMemoryVector(id, emb.vectors[0], { type: 'observation', content: text })
  assert.equal(w.written, true, `落库必须成功：${w.reason}`)
}

/** 一次真召回：返回 词法命中数 + 结果 + 服务面读数（同一趟，便于对拍）。 */
async function recallReal(core, svc, query) {
  const lex = core.recallLexical(query, 10)
  const cands = lex.hits.map((h, i) => ({ key: h.id, lexicalRank: i + 1 }))
  const out = await svc.recall(query, cands, 10, { sessionId: 'dense-test', turnId: 1, requestId: `dense:${query}` })
  return { lexHits: lex.hits.length, out, svcRead: svc.lastRecallDense() }
}

test('dense-⑦ 正向（真数据）：词法 0 命中，语义相近的仍被召回（rank 里只有 dense）', async (t) => {
  const { ctx, core, svc } = await bootReal()
  await remember(core, svc, 'mem-near', MEMO)

  const { lexHits, out, svcRead } = await recallReal(core, svc, ASK_NEAR)
  // ⚠ 前提腿：本用例只有在词法**真查不到**时才有意义（否则它证不了"越过词法候选池"）
  assert.equal(lexHits, 0, `本用例前提是词法腿查不到「${ASK_NEAR}」；若它变了须换查询，**不得改断言**`)
  assert.ok(out.hitCount >= 1, `语义相近必须被召回（命中 ${out.hitCount}）：dense=${JSON.stringify(out.dense)}`)
  const hit = out.items.find((i) => i.key === 'mem-near')
  assert.ok(hit, `命中集里必须有那条记忆，实测 ${JSON.stringify(out.items.map((i) => i.key))}`)
  assert.deepEqual(hit.rank, { dense: 1 }, '词法没给名次的候选：rank 里只该有 dense（不得伪造 lexical 名次）')
  assert.equal(out.channel, 'vector')
  assert.equal(out.rankBy, 'rrf')
  assert.equal(out.degraded, false)

  const sim = out.dense?.candidateSims[0]
  assert.ok(typeof sim === 'number' && sim >= 0.55, `语义相近的余弦须明显高于阈值 0.5，实测 ${sim}`)
  assert.equal(out.dense?.scanned, 1, '扫描量可见：本次扫了 1 行、取了 1 条候选')
  assert.deepEqual(out.dense?.candidates.map((c) => c.key), ['mem-near'])
  // 服务面与返回值**同一份**读数（不是两处各算一次 ⇒ 不可能漂开）
  assert.deepEqual(svcRead, out.dense, 'lastRecallDense() 必须与结果里的 dense 逐字相同')
  t.diagnostic(
    `[正向·真数据] 「${ASK_NEAR}」→ 词法 ${lexHits} 条 · 向量 hit=${out.hitCount} · 原始 cos=${sim?.toFixed(6)} · ` +
      `scanned=${out.dense?.scanned} matched=${out.dense?.matched}`,
  )
  await ctx.stop?.()
})

test('dense-⑧ 反向（真数据）：真无关查询仍 0 命中，且必须自证"扫了"（不得退化成永不空手）', async (t) => {
  const { ctx, core, svc } = await bootReal()
  await remember(core, svc, 'mem-near', MEMO)

  const { out } = await recallReal(core, svc, ASK_FAR)
  assert.equal(out.hitCount, 0, `真无关查询必须仍 0 命中（不得变成"永不空手"），实测 items=${JSON.stringify(out.items)}`)
  assert.deepEqual(out.items, [])
  // ⚠ **负例必须自证扫了**：否则本用例会被"腿压根没跑"骗过（本仓实测过的假绿形态）
  assert.equal(out.dense?.ran, true, '反向用例必须证明本腿**真跑了**（ran=false 时这条负例无意义）')
  assert.ok((out.dense?.scanned ?? 0) > 0, `必须真扫到行（实测 scanned=${out.dense?.scanned}）：scanned=0 是"没得扫"，不是"不相近"`)
  assert.equal(out.dense?.matched, 0, '扫到但都不相近 ⇒ matched=0')
  assert.ok((out.dense?.omitted.length ?? 0) > 0, '被阈值挡下的行必须逐条具名（否则"挡住"不可查）')
  // 契约面：0 命中也**不得**被读成降级（与 dense-⑨ 的"没得扫"并列可分辨）
  assert.equal(out.channel, 'vector')
  assert.equal(out.rankBy, 'rrf')
  assert.equal(out.degraded, false)
  assert.equal(out.reason, null)

  // 负向控制（关键）：同一库、同一查询，把**阈值降到 0** ⇒ 必须命中。
  // 若这一步也 0 命中，说明"0 命中"来自管线坏了而不是阈值判据 —— 那样上面那条断言就是空的。
  const loose = await bootReal({ denseCandidates: { enabled: true, threshold: 0, scanRows: 512, topN: 20 } })
  await remember(loose.core, loose.svc, 'mem-near', MEMO)
  const looseOut = await recallReal(loose.core, loose.svc, ASK_FAR)
  assert.ok(looseOut.out.hitCount >= 1, `阈值降到 0 必须能召回（证明"0 命中"来自阈值判据，不是管线断了）：${JSON.stringify(looseOut.out.dense)}`)
  t.diagnostic(
    `[反向·真数据] 「${ASK_FAR}」→ 阈值 0.5：hit=0（scanned=${out.dense?.scanned} matched=0）· ` +
      `阈值 0：hit=${looseOut.out.hitCount}（对照腿：证明 0 来自阈值而非管线断了）`,
  )
  await ctx.stop?.()
  await loose.ctx.stop?.()
})

test('dense-⑨ 空库（真装配）：0 命中但 ran=true&scanned=0 —— 与"扫了不相近"读数不同形', async (t) => {
  const { ctx, core, svc } = await bootReal()
  const { out } = await recallReal(core, svc, ASK_NEAR)
  assert.equal(out.hitCount, 0)
  assert.equal(out.dense?.ran, true, '真库扫描 ⇒ ran=true')
  assert.equal(out.dense?.scanned, 0, '库里没有已嵌入行 ⇒ scanned=0（N=0 显式记 0）')
  assert.equal(out.dense?.unavailableReason, null, '这是"扫成了、只是没得扫"，不是失败')
  assert.equal(out.dense?.scanError, false)
  assert.deepEqual(out.dense?.omitted, [], '没扫到任何行 ⇒ 无可具名项（"没有"不等于"漏掉"）')
  t.diagnostic(`[空库·真数据] ran=${out.dense?.ran} scanned=${out.dense?.scanned} matched=${out.dense?.matched}（对照 dense-⑧ 的 scanned>0）`)
  await ctx.stop?.()
})

test('dense-⑩ 契约面冻结：带 dense 时结果**只多一个键**，既有字段与降级锚点逐字不变', async () => {
  const store = new VectorStore({ dim: 1024 })
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  const db = stubDb([rowOf('m-a', vecWithCos(1024, 0.9))])

  const withDense = await recallVector(baseCfg({ dense: knobs, denseDb: db }), store, '契约探针', [], 5)
  const without = await recallVector(baseCfg(), store, '契约探针', [], 5)
  const KEYS = ['channel', 'degraded', 'hitCount', 'items', 'query', 'rankBy', 'reason']
  assert.deepEqual(Object.keys(without).sort(), KEYS, '未尝试扫描：键集合必须**与改动前逐字相同**')
  assert.deepEqual(Object.keys(withDense).sort(), [...KEYS, 'dense'].sort(), '尝试扫描：只多 dense 一个键（增量，不是改契约）')

  // 降级信封的 A1-11 锚点：带不带稠密读数都必须一样（b11-⑦ 的同口径，这里覆盖"带 dense"的情形）
  const store2 = new VectorStore({ dim: 1024 })
  store2.put('x', fixtureVec(1024, 1))
  // ⚠ 真造故障：**去掉 fetchImpl 桩**再指向不可达端点（留着桩就等于"假降级"，本用例会变成空断言）。
  const unreachableCfg = { ...baseCfg({ dense: knobs, denseDb: db }) }
  delete unreachableCfg.fetchImpl
  const deg = await recallVector(
    { ...unreachableCfg, baseUrl: 'http://127.0.0.1:1/v1', timeoutMs: 1500 },
    store2,
    '查询',
    [{ key: 'x', lexicalRank: 1 }],
    3,
  )
  assert.ok(deg.reason && deg.reason.includes('127.0.0.1:1'), `降级原因须含端点（否则"哪个端点不通"不可查）：${deg.reason}`)
  assert.equal(deg.degraded, true)
  assert.equal(deg.channel, 'degraded')
  assert.equal(deg.rankBy, 'local_score', "降级时 rankBy 必须仍是 'local_score'（A1-11 原文）")
  assert.ok(deg.reason && deg.reason.length > 0, '降级原因必须非空')
  // ⚠ 本卡之后：池非空**也扫**，但扫描相位拿到查询向量的那一步就撞上同一个不可达端点 ⇒
  //   读数落**具名**的 query-embed-degraded（ran=false），而不是"没尝试扫描"（不写键）。
  //   「没扫」与「扫了但拿不到查询向量」在这里**必须不同形** —— 这正是本卡要保住的分辨点。
  assert.equal(deg.dense?.ran, false, '拿不到查询向量 ⇒ 本腿没跑成（ran=false，不是"没扫"）')
  assert.ok(
    deg.dense?.unavailableReason?.startsWith('query-embed-degraded'),
    `原因须以具名取值开头：${deg.dense?.unavailableReason}`,
  )
  assert.equal(deg.dense?.scanError, false, '嵌入失败**不是**列举失败（两者不得同形）')
})
