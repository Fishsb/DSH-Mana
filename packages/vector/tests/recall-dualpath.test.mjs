/**
 * **真双路召回**判据（本卡 t-mujpmv5v-tdvms1）：池**非空**时稠密腿也动作。
 *
 * ── 与邻座判据的分工（别互相冒充）──────────────────────────────────────────────
 *   · `recall-dense.test.mjs`（L1）：稠密腿**自己**的能力（池空时能不能找到）；
 *   · `b11-vector.test.mjs`：给定候选时的排序/降级/契约（重排器那条腿）；
 *   · **本文件**：两路**同时**在场时的合成 —— 池非空也扫、候选取**并集**（不作废既有候选）、
 *     新候选进得了排序、词法已足够时不被塞入无关项、以及**代价**（扫描量/触顶/额外嵌入次数）可读。
 *
 * ── 判据纪律（每条都对着本仓踩过的坑）──────────────────────────────────────────
 *   ① **两个方向都判**：正向（池非空时真能新召回语义相近项）**必须**配反向
 *      （词法已足够时不得塞入无关项）—— 只有正向的判据在「阈值失效 ⇒ 永不空手」时照样绿。
 *   ② **负例必须自证扫了**：只断言结果不变的负例，会被「腿压根没跑」骗过
 *      ⇒ 反向用例同时断言 `dense.ran === true` 且 `scanned > 0`。
 *   ③ **修前/修后要真对照**：同一库、同一查询、同一常驻表，只切「腿开/腿关」——
 *      不是拿记忆里的旧读数比（那正是「放行不等于抵达」）。
 *   ④ **代价不许只说很快**：扫描行数与额外嵌入次数是**计数**（确定性断言），
 *      端到端耗时只作**测量条件**打印、**不进阈值列**（`docs/contract/threshold-discipline.md` 的 B 档）。
 *   ⑤ **已知的编号基事实要钉住而不是藏**：本腿对**自产**候选从 1 起编号，池内候选由既有
 *      循环编号 ⇒ **同号可能出现**（见 dual-⑩ 与文件末的未决风险）。钉住它，别人才看得见。
 *
 * 运行：`node --test packages/vector/tests/recall-dualpath.test.mjs`（本仓不许用通配：空目录下静默 exit 0）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 真端点判据的**归因读数**（口径：docs/mana-endpoint-attribution.md）：只换文案/类别，不换判据。
import { assertLiveEmbed } from './_live-endpoints.mjs'
import { DEFAULT_EMBED_MODEL } from '../src/adapt.ts'
import { VectorStore, encodeVector } from '../src/vec-blob.ts'
import { rrfTerm } from '../src/rrf.ts'
import { DENSE_ENUMERATE_SQL, DEFAULT_DENSE_CANDIDATE_KNOBS, recallVector } from '../src/recall.ts'

const OLLAMA = 'http://127.0.0.1:11434/v1'
const PLUGIN = new URL('../src/index.ts', import.meta.url).href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href

/** 期望用例条数（**等式**语义；改条数须同步 `tests/gate.mjs` 的 FILES）。 */
const EXPECTED_CASES = 12

// ── 0. 自检：本文件必须真的有判据，且被测代码的**形状**必须就是本卡要的形状 ────────
test('dual-⓪ 判据自检：test( 计数等于 12；扫描相位**不在池空分支内**（结构性证据）', () => {
  const self = fileURLToPath(import.meta.url)
  const src = readFileSync(self, 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  assert.equal(n, EXPECTED_CASES, '用例条数必须恰好 ' + EXPECTED_CASES + '（实测 ' + n + '）：少一条即有判据被删走')
  assert.ok(!/^test\.only\(/m.test(src), '不许有 test.only（会让其余判据静默不跑）')

  // ⚠ 本卡的核心**不是某条断言绿**，而是**代码形状**：扫描相位必须落在 recallVector 体内、
  //   且不再被 `if (!candidates.length)` 包住。这条检查让「改回兜底」在判据面立刻可见。
  const recallSrc = readFileSync(fileURLToPath(new URL('../src/recall.ts', import.meta.url)), 'utf8')
  const at = recallSrc.indexOf('export async function recallVector')
  assert.ok(at > 0, 'recall.ts 必须仍导出 recallVector')
  const body = recallSrc.slice(at)
  // ⚠ 只看**代码行**：文件头/函数注释里仍会引用这段旧写法（那是历史说明）⇒ 必须按行首匹配，
  //   否则「注释里提到它」会被读成「代码里还有它」（本仓最忌的形态：拿到的是文本不是事实）。
  const gateLine = body.split('\n').filter((l) => /^\s*if \(!candidates\.length\)/.test(l))
  assert.deepEqual(gateLine, [], 'recallVector 的**代码行**里不得再有 if (!candidates.length) 这道门（那正是本卡要拆的兜底口径）：' + JSON.stringify(gateLine))
  const scanAt = body.indexOf('enumerateEmbeddedRows(knobs, cfg.denseDb)')
  const earlyAt = body.indexOf('if (!pool.length)')
  assert.ok(scanAt > 0, '扫描相位必须在 recallVector 体内')
  assert.ok(earlyAt > scanAt, '扫描相位必须在**早退之前**（池空与否都经过它）')
  assert.ok(body.includes('if (cfg.dense !== undefined)'), '扫描相位的开关只能是「调用方要不要本腿」，不是「池空不空」')
  assert.ok(body.includes('...candidates, ...ranked.candidates'), '候选必须取**并集**（不是替换池子）')
  for (const f of ['recall.ts', 'index.ts']) {
    assert.ok(existsSync(fileURLToPath(new URL('../src/' + f, import.meta.url))), '交付文件缺失：' + f)
  }
  assert.equal(DEFAULT_DENSE_CANDIDATE_KNOBS.enabled, true, '缺省真源必须是 enabled:true（改它就要重写 index.ts 的那段论证并同步本文件）')
})

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'mana-dual-'))
  dirs.push(d)
  return d
}
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/** 与查询向量**恰好**成给定余弦的行向量（阈值/名次做成确定值，不靠「看起来像」）。 */
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
const constEmbedding = (dim, fill) => Float32Array.from({ length: dim }, () => fill)

/** 嵌入桩：**任意输入都回同一个向量** ⇒ 与 `qvAxis0`/`vecWithCos` 配出确定余弦，零网络。 */
const fetchOf = (vec) => async () =>
  new Response(JSON.stringify({ data: [{ embedding: Array.from(vec) }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

/** 计数桩：断言「额外嵌入次数」用（确定性），比计时可靠。 */
const countingFetch = (state, fill) => async () => {
  state.calls += 1
  return new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(fill) }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 假 db：只允许那一条列举 SQL（本腿只许用它），并计数 —— 这就是「扫了几次」的机械证据。 */
const stubDb = (rows, opts = {}) => {
  const state = { calls: 0, lastParams: [] }
  return {
    state,
    prepare(sql) {
      assert.equal(sql, DENSE_ENUMERATE_SQL, '本腿只许用这一条列举 SQL，实测 ' + sql)
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

const baseCfg = (over = {}) => ({
  enabled: true,
  baseUrl: 'http://127.0.0.1:9/v1',
  model: 'bge-m3',
  dim: 1024,
  rrfK: 60,
  fetchImpl: fetchOf(constEmbedding(1024, 0.1)),
  ...over,
})

// ── 1. 扫描相位：池非空也扫（本卡的结构性改动）────────────────────────────────

test('dual-① 池非空也扫：恰好一次 + 读数必写；池空亦一次（同一实现）；未要求本腿则零次', async () => {
  const store = new VectorStore({ dim: 1024 })
  store.put('lex-1', vecWithCos(1024, 0.9))
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  const q = qvAxis0(1024)
  const pool = [{ key: 'lex-1', lexicalRank: 1 }]

  // (a) 池非空 + 要求本腿 ⇒ **恰好一次**、读数必写（改动前这里恒为 0 次、且不写读数键）
  const a = stubDb([rowOf('lex-2', vecWithCos(1024, 0.8))])
  const outA = await recallVector(baseCfg({ dense: knobs, denseDb: a, fetchImpl: fetchOf(q) }), store, '双路探针', pool, 5)
  assert.equal(a.state.calls, 1, '池非空时扫描面必须**恰好**调用一次（不是 0 次，也不是 2 次）')
  assert.equal(outA.dense?.ran, true, '真扫过 ⇒ 读数必写')
  assert.equal(outA.dense?.scanned, 1, '扫描量可见')
  assert.deepEqual(outA.dense?.candidates.map((c) => c.key), ['lex-2'], '自产候选进读数')

  // (b) 池空 ⇒ 同样恰好一次：**同一份实现**，不按池空与否分叉
  const b = stubDb([rowOf('lex-2', vecWithCos(1024, 0.8))])
  const outB = await recallVector(baseCfg({ dense: knobs, denseDb: b, fetchImpl: fetchOf(q) }), store, '双路探针', [], 5)
  assert.equal(b.state.calls, 1, '池空时同样恰好一次（两态共用同一条路径）')
  assert.equal(outB.dense?.ran, true)

  // (c) 负向控制：调用方**没要求**本腿 ⇒ 扫描面零调用（本卡之后唯一「不扫」的路径）
  const c = {
    calls: 0,
    prepare(sql) {
      c.calls += 1
      throw new Error('未要求本腿时不得碰扫描面：' + sql)
    },
  }
  const outC = await recallVector(baseCfg({ denseDb: c }), store, '双路探针', pool, 5)
  assert.equal(c.calls, 0, '不传 cfg.dense ⇒ 一次库都不扫（「纯重排器」调用面的既有口径）')
  assert.equal('dense' in outC, false, '没尝试过扫描 ⇒ 不写读数键（undefined 与 ran:false 不同形）')
})

// ── 2. 并集口径：新来的不许把旧的挤掉 ────────────────────────────────────────

test('dual-② 并集口径：请求池的键**两路名次都在**、score 含两路分量；新候选只带 dense 名次', async () => {
  const store = new VectorStore({ dim: 1024 })
  store.put('p-a', vecWithCos(1024, 0.7))
  store.put('p-b', vecWithCos(1024, 0.6))
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  const db = stubDb([
    rowOf('p-a', vecWithCos(1024, 0.7)),
    rowOf('p-b', vecWithCos(1024, 0.6)),
    rowOf('new-c', vecWithCos(1024, 0.9)),
  ])
  const out = await recallVector(
    baseCfg({ dense: knobs, denseDb: db, fetchImpl: fetchOf(qvAxis0(1024)) }),
    store,
    '并集探针',
    [{ key: 'p-a', lexicalRank: 2 }, { key: 'p-b', lexicalRank: 1 }],
    5,
  )
  const byKey = new Map(out.items.map((i) => [i.key, i]))
  assert.equal(out.items.length, 3, '池里 2 条 + 新候选 1 条 —— 一条不作废、也不重复')
  for (const k of ['p-a', 'p-b']) {
    const it = byKey.get(k)
    assert.ok(it, '请求池的键必须仍在结果里：' + k)
    assert.ok(it.rank.lexical !== undefined, '词法名次不得丢：' + k)
    assert.ok(it.rank.dense !== undefined, '**dense 名次不得丢**（替换池子就会丢掉它 —— 这就是并集的要害）：' + k)
    assert.equal(it.hits, 2, '两路都命中 ⇒ hits=2：' + k)
    assert.ok(
      Math.abs(it.score - (rrfTerm(it.rank.dense, 60) + rrfTerm(it.rank.lexical, 60))) < 1e-12,
      'RRF 分必须**同时**含两路分量（不是只剩词法那一路）：' + k,
    )
  }
  const fresh = byKey.get('new-c')
  assert.ok(fresh, '稠密腿自产的候选必须进得了结果（否则双路是假的）')
  assert.deepEqual(fresh.rank, { dense: 1 }, '本腿自产的键：**只有** dense 名次（不得伪造 lexical 名次）')
})
test('dual-③ 锚点：语料里没有可召回的键时，走双路的 items 与不扫腿时逐位相同（既有行为不动）', async () => {
  const mk = () => {
    const s = new VectorStore({ dim: 1024 })
    s.put('p-a', vecWithCos(1024, 0.7))
    s.put('p-b', vecWithCos(1024, 0.6))
    return s
  }
  const pool = [{ key: 'p-a', lexicalRank: 1 }, { key: 'p-b', lexicalRank: 2 }]
  const q = qvAxis0(1024)
  // (a) 关腿（= 改动前那条路径）
  const off = await recallVector(
    baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS, enabled: false }, denseDb: stubDb([]), fetchImpl: fetchOf(q) }),
    mk(),
    '锚点探针',
    pool,
    5,
  )
  // (b) 开腿、但库里两行都是池内已有键 ⇒ 不得改变 items（池内排序一字不动）
  const db = stubDb([rowOf('p-a', vecWithCos(1024, 0.7)), rowOf('p-b', vecWithCos(1024, 0.6))])
  const on = await recallVector(baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS }, denseDb: db, fetchImpl: fetchOf(q) }), mk(), '锚点探针', pool, 5)
  assert.equal(on.dense?.ran, true, '前提：这一次真的扫了（否则下面那条是空断言）')
  assert.equal(on.dense?.matched, 0, '前提：没有可召回的键（两行都是池内已有 ⇒ 被去重挡下，不是被阈值挡下）')
  const strip = (o) => o.items.map((i) => [i.key, i.rank, i.score, i.hits])
  assert.deepEqual(strip(on), strip(off), '池内排序与分必须逐位相同（双路只增补，不改池内既有的排序口径）')
  assert.equal(on.channel, off.channel, '契约字段不受本腿影响')
  assert.equal(on.rankBy, off.rankBy)
  assert.equal(on.degraded, off.degraded)
})

test('dual-④ 成本上限封死：池非空也只扫 scanRows 行；触顶时 scanLimitReached=true 且未见行不入 omitted', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => rowOf('r-' + i, vecWithCos(1024, 0.9 - i * 0.01)))
  const q = qvAxis0(1024)
  // 池非空（1 条） + scanRows=3 ⇒ 至多 3 行被算余弦，代价与库大小无关（这就是上限二字的机械落点）
  const db = stubDb(rows)
  const out = await recallVector(
    baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS, scanRows: 3 }, denseDb: db, fetchImpl: fetchOf(q) }),
    new VectorStore({ dim: 1024 }),
    '上限探针',
    [{ key: 'pool-x', lexicalRank: 1 }],
    20,
  )
  assert.equal(db.state.lastParams[0], 4, 'SQL 的 LIMIT 必须是 scanRows+1（多读一行只为判定上限是否被用满）')
  assert.equal(out.dense?.scanned, 3, '实际算余弦的行数 = scanRows（不是库里的 9 行）')
  assert.equal(out.dense?.scanLimitReached, true, '库里还有没扫到的行 ⇒ 上限被用满（必须显式报出，不是静默截断）')
  assert.ok(
    !out.dense.omitted.some((o) => o.key === 'r-5'),
    '未被扫到的行不得出现在 omitted（从未扫到与扫到被截必须不同形）',
  )
  // 反向控制：同一库、scanRows 放开 ⇒ 上限不被用满（否则上面那条触顶可能来自别处）
  const db2 = stubDb(rows)
  const out2 = await recallVector(
    baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS, scanRows: 64 }, denseDb: db2, fetchImpl: fetchOf(q) }),
    new VectorStore({ dim: 1024 }),
    '上限探针',
    [{ key: 'pool-x', lexicalRank: 1 }],
    20,
  )
  assert.equal(out2.dense?.scanned, 9, '放开上限 ⇒ 库里 9 行都扫到')
  assert.equal(out2.dense?.scanLimitReached, false, '都扫过了 ⇒ 确实没截断（false 不是没有截断证据）')
})

test('dual-⑤ 代价可见·扫描量：池非空与池空扫的是同一批行（代价只由库与旋钮决定，与池无关）', async () => {
  const rows = [rowOf('d-1', vecWithCos(1024, 0.9)), rowOf('d-2', vecWithCos(1024, 0.8))]
  const store = new VectorStore({ dim: 1024 })
  const q = qvAxis0(1024)
  const withPool = await recallVector(
    baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS }, denseDb: stubDb(rows), fetchImpl: fetchOf(q) }),
    store,
    '代价探针',
    [{ key: 'pool-x', lexicalRank: 1 }],
    5,
  )
  const emptyPool = await recallVector(
    baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS }, denseDb: stubDb(rows), fetchImpl: fetchOf(q) }),
    store,
    '代价探针',
    [],
    5,
  )
  assert.equal(withPool.dense?.scanned, 2)
  assert.equal(emptyPool.dense?.scanned, 2)
  assert.equal(withPool.dense?.scanned, emptyPool.dense?.scanned, '两态的扫描量必须相等：代价不随池空与否变化')
})

test('dual-⑥ 额外嵌入次数（计数桩）：池非空恰好一次；库空时 0 次（不改池子决定发不发）', async () => {
  const store = new VectorStore({ dim: 1024 })
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  const pool = [{ key: 'p-a', lexicalRank: 1 }]

  // (a) 池非空 + 库里有行 ⇒ 恰好一次（改动前池非空必发一次；现在仍是一次，不是两次）
  const s1 = { calls: 0 }
  await recallVector(
    baseCfg({ dense: knobs, denseDb: stubDb([rowOf('d-1', vecWithCos(1024, 0.9))]), fetchImpl: countingFetch(s1, 0.1) }),
    store,
    '嵌入计数探针',
    pool,
    5,
  )
  assert.equal(s1.calls, 1, '池非空时整趟只发一次嵌入（扫描与打分共用同一个查询向量，不许各发一次）')

  // (b) 池非空 + **库空**：本腿的**增量**必须是 0 —— 既有管道仍要为池内候选发那一次（那是改前就有的），
  //     但本腿**一次都不许多发**。⚠ 因此必须与「同场景、腿关」对拍，不能只断言 0：
  //     只断言 0 会写出一个**与既有管道矛盾的期望**（池非空时既有管道本来就要发一次）。
  const s2 = { calls: 0 }
  const out2 = await recallVector(
    baseCfg({ dense: knobs, denseDb: stubDb([]), fetchImpl: countingFetch(s2, 0.1) }),
    store,
    '嵌入计数探针',
    pool,
    5,
  )
  assert.equal(out2.dense?.ran, true, '前提：这次真的扫过（ran=true）')
  assert.equal(out2.dense?.scanned, 0, '前提：库里没有可扫的行')
  const s3 = { calls: 0 }
  await recallVector(
    baseCfg({ dense: { ...DEFAULT_DENSE_CANDIDATE_KNOBS, enabled: false }, denseDb: stubDb([]), fetchImpl: countingFetch(s3, 0.1) }),
    store,
    '嵌入计数探针',
    pool,
    5,
  )
  assert.equal(s3.calls, 1, '腿关：既有管道为池内候选发一次（改前就有的那一次）')
  assert.equal(s2.calls, s3.calls, '库空时本腿的**嵌入增量必须是 0**（两段式：先列举、再嵌入 ⇒ N=0 不付网络代价）')
  assert.equal(out2.degraded, true, '既有的池非空降级口径不变（常驻全未命中 ⇒ 显式降级）')

  // (c) ⚠ **真正的零网络**那条既有性质在「池空 + 库空」上：一次嵌入式请求都不发
  //     （`core/tests/chain-e2e.test.mjs` 依赖的就是它；本卡把扫描提到早退之前，必须没动它）
  const s4 = { calls: 0 }
  const out4 = await recallVector(
    baseCfg({ dense: knobs, denseDb: stubDb([]), fetchImpl: countingFetch(s4, 0.1) }),
    store,
    '嵌入计数探针',
    [],
    5,
  )
  assert.equal(out4.dense?.ran, true, '前提：池空也扫了（ran=true）')
  assert.equal(out4.dense?.scanned, 0, '前提：库里没有可扫的行')
  assert.equal(s4.calls, 0, '池空 + 库空 ⇒ **一次嵌入都不发**（这条既有性质本卡必须保住）')
  assert.equal(out4.hitCount, 0, '空池 ⇒ 0 命中，且不判降级（G5：0 是合法值）')
  assert.equal(out4.degraded, false)
})
// ── 3. 断层/三态：没扫成不得被读成「扫了没命中」（本卡要求的三态可分辨）──────────

test('dual-⑦ 三态可分辨：没扫成(ran:false 具名) / 扫了没命中(matched=0) / 扫了触顶(scanLimitReached)', async () => {
  const store = new VectorStore({ dim: 1024 })
  const knobs = { ...DEFAULT_DENSE_CANDIDATE_KNOBS }
  const pool = [{ key: 'p-a', lexicalRank: 1 }]
  const q = qvAxis0(1024)
  const cfgOf = (db, over = {}) => baseCfg({ dense: { ...knobs, ...over }, denseDb: db, fetchImpl: fetchOf(q) })

  // ① 没扫成：列举 SQL 抛错 ⇒ 具名 enumerate-failed + scanError=true（真故障）
  const boom = await recallVector(cfgOf(stubDb([], { throwOnAll: 'boom-sql' })), store, '三态探针', pool, 5)
  assert.equal(boom.dense?.ran, false)
  assert.equal(boom.dense?.scanError, true, '真故障必须与「扫了但没命中」不同形')
  assert.ok(boom.dense?.unavailableReason?.startsWith('enumerate-failed'))
  assert.ok(boom.dense?.scanError === true && boom.dense?.missing === undefined, '读数形状不得随手加字段')

  // ② 扫了但没命中：库里两行都与查询正交 ⇒ 被阈值挡下（不是失败）
  const none = await recallVector(cfgOf(stubDb([rowOf('x1', vecWithCos(1024, 0)), rowOf('x2', vecWithCos(1024, 0))])), store, '三态探针', pool, 5)
  assert.equal(none.dense?.ran, true)
  assert.equal(none.dense?.scanned, 2)
  assert.equal(none.dense?.matched, 0)
  assert.equal(none.dense?.scanError, false, '不是故障')
  assert.equal(none.dense?.unavailableReason, null)
  assert.ok(none.dense.omitted.length >= 2, '被阈值挡下的行必须逐条具名（否则挡住不可查）')

  // ③ 扫了但触顶：上限被用满 + 有候选（与 ①② 的 ran 组合两两不同形）
  const rows = Array.from({ length: 6 }, (_, i) => rowOf('t-' + i, vecWithCos(1024, 0.9 - i * 0.01)))
  const capped = await recallVector(cfgOf(stubDb(rows), { scanRows: 2 }), store, '三态探针', pool, 5)
  assert.equal(capped.dense?.ran, true)
  assert.equal(capped.dense?.scanned, 2)
  assert.equal(capped.dense?.scanLimitReached, true)
  assert.ok((capped.dense?.matched ?? 0) > 0, '触顶不等于没命中：这一次同时有候选')
  assert.ok(capped.dense.unavailableReason === null, '触顶不是失败：不得给 unavailableReason')
  // 三态的 (ran, scanError, scanLimitReached) 三元组两两不同 ⇒ 事后可反查是哪一种
  const trips = [boom.dense, none.dense, capped.dense].map((d) => [d.ran, d.scanError, d.scanLimitReached].join('/'))
  assert.equal(new Set(trips).size, 3, '三态的读数三元组必须两两不同，实测 ' + JSON.stringify(trips))
})

test('dual-⑧ 读数与结果同一份（不漂开）：recall 返回的 dense 就是服务面那一个对象', async (t) => {
  const { ctx, core, svc } = await bootReal()
  await remember(core, svc, 'mem-open', MEMO_OPEN)
  await remember(core, svc, 'mem-paid', MEMO_PAID)
  const lex = core.recallLexical(ASK_LEX_WSL, 10)
  assert.ok(lex.hits.length >= 1, '前提：这条查询必须**词法有命中**（否则测的是池空路径，不是本卡）')
  const cands = lex.hits.map((h, i) => ({ key: h.id, lexicalRank: i + 1 }))
  const out = await svc.recall(ASK_LEX_WSL, cands, 10, { sessionId: 'dual', turnId: 1, requestId: 'dual-readout' })
  assert.ok(out.dense && out.dense.ran === true, '前提：池非空时稠密腿真跑了（本卡的核心行为）')
  assert.deepEqual(svc.lastRecallDense(), out.dense, '服务面读数与返回值必须是同一份（两处各算一次就会漂开）')
  t.diagnostic(
    '[读数同一份] 词法 ' + lex.hits.length + ' 条 · dense scanned=' + out.dense.scanned +
      ' matched=' + out.dense.matched + ' candidates=' + JSON.stringify(out.dense.candidates.map((c) => c.key)) +
      ' · items=' + JSON.stringify(out.items.map((i) => [i.key, Object.keys(i.rank).sort().join('+')])),
  )
  await ctx.stop?.()
})

// ── 4. 真数据（真 bge-m3 + 真库）：正向 / 反向 / 修前修后对照 ────────────────────
//
// ⚠ 本组用**实测**过的语料（2026-09-27 探针，本机 bge-m3）：
//   查询「长期用 WSL」 vs mem-open 0.7469 / mem-wsl 0.7749 / mem-paid 0.5006 / mem-freemium 0.4669 / mem-far 0.3066
//   查询「收费的软件」 vs mem-paid 0.7817 / mem-freemium 0.6852 / mem-open 0.5926 / mem-wsl 0.4961 / mem-far 0.3220
//   ⇒ 阈值 0.5 在两类之间留有界：相近项在 0.59~0.87，无关项 <= 0.4961。

const MEMO_OPEN = '我偏好开源方案，长期用 WSL 做主力开发环境，不要推荐商业工具'
const MEMO_PAID = '免费的替代品我都愿意试，收费的工具我一律不要'
const MEMO_FAR = '量子纠缠退相干是量子力学里最难直观理解的效应之一'
/** 词法命中 WSL 那条主记忆的查询（本卡的前提：池非空）。实测 lexHits=['mem-open']。 */
const ASK_LEX_WSL = '长期用 WSL'
/** 与语料**真无关**的查询（本卡的「反向」面）。实测余弦 <= 0.3766。 */
const ASK_FAR = '量子纠缠退相干'

/** 真装配：core + vector（走**生产配置面**），返回服务面。 */
async function bootReal(over = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const dir = tempDir()
  const ctx = new Context()
  ctx.plugin(await import(CORE), { storePath: join(dir, 'mana.db') })
  await settle(300)
  ctx.plugin(await import(PLUGIN), { embedBaseUrl: OLLAMA, embedEnabled: true, ...over })
  await settle(400)
  return { ctx, core: ctx.get('mana-core'), svc: ctx.get('mana-vector') }
}

/** 走生产写面写一条记忆并嵌入（不自造 SQL：写面与召回面之间不留缝）。 */
async function remember(core, svc, id, text) {
  core.writeMemoryItem({ id, type: 'observation', content: text, at: new Date().toISOString() })
  const emb = await svc.embed([text])
  // 测量条件那一腿：环境不可用 ⇒ 红且点名"查环境"；环境可用而读数不对 ⇒ 红且点名"查代码"。
  assertLiveEmbed(emb, { title: 'dual-⑨⑩ 真数据前提（生产写面嵌入）', baseUrl: OLLAMA, model: DEFAULT_EMBED_MODEL })
  const w = await svc.putMemoryVector(id, emb.vectors[0], { type: 'observation', content: text })
  assert.equal(w.written, true, '落库必须成功：' + w.reason)
}

/** 一次真召回：词法候选走**生产口径**（core.recallLexical ⇒ lexicalRank）。 */
async function recallReal(core, svc, query, topK = 10) {
  const lex = core.recallLexical(query, 10)
  const cands = lex.hits.map((h, i) => ({ key: h.id, lexicalRank: i + 1 }))
  const out = await svc.recall(query, cands, topK, { sessionId: 'dual', turnId: 2, requestId: 'dual:' + query })
  return { lexHits: lex.hits.length, out, svcRead: svc.lastRecallDense() }
}
test('dual-⑨ 正向（真数据）：池**非空**时稠密腿仍新召回语义相近项，且请求池一条不作废', async (t) => {
  const { ctx, core, svc } = await bootReal()
  await remember(core, svc, 'mem-open', MEMO_OPEN)
  await remember(core, svc, 'mem-wsl', '开发环境一直在用 WSL，命令行习惯')
  await remember(core, svc, 'mem-far', MEMO_FAR)

  const { lexHits, out, svcRead } = await recallReal(core, svc, ASK_LEX_WSL)
  // ⚠ 前提腿：本用例只有在词法**真命中**时才有意义（否则它退化成 dense-⑦，测不到本卡）
  assert.ok(lexHits >= 1, '本用例前提是词法有命中（池非空）；实测 ' + lexHits)
  // 靶心：池非空时稠密腿**也跑了**（改动前这里不写读数、库一次不扫）
  assert.equal(out.dense?.ran, true, '池非空时稠密腿必须真跑：' + JSON.stringify(out.dense))
  assert.equal(out.dense?.scanned, 3, '扫描量：库里 3 行已嵌入，全部扫到')
  assert.deepEqual(
    out.dense?.candidates.map((c) => c.key),
    ['mem-wsl'],
    '自产候选 = 语义相近且词法没给的那一条（mem-open 已在池内 ⇒ 去重；mem-far 被阈值挡下）',
  )
  // 正向提升：新候选真进了排序（不是只进读数）
  const keys = out.items.map((i) => i.key)
  assert.ok(keys.includes('mem-wsl'), '语义相近项必须进结果，实测 ' + JSON.stringify(keys))
  const fresh = out.items.find((i) => i.key === 'mem-wsl')
  assert.deepEqual(fresh.rank, { dense: 1 }, '本腿自产的键只带 dense 名次（不得伪造 lexical 名次）')
  // 请求池不作废：那条词法命中仍在，且两路名次都在
  const kept = out.items.find((i) => i.key === 'mem-open')
  assert.ok(kept, '请求池的键必须仍在结果里（并集口径，不是替换）')
  assert.deepEqual(Object.keys(kept.rank).sort(), ['dense', 'lexical'], '请求池的键：两路名次都在')
  assert.equal(out.channel, 'vector')
  assert.equal(out.rankBy, 'rrf', '融合仍走既有 RRF（不另立融合算法）')
  assert.equal(out.degraded, false)
  assert.deepEqual(svcRead, out.dense, '服务面读数与结果里那份必须逐字相同')
  t.diagnostic(
    '[正向·真数据·池非空] 查询 ' + JSON.stringify(ASK_LEX_WSL) + ' → 词法 ' + lexHits + ' 条 · dense scanned=' + out.dense.scanned +
      ' matched=' + out.dense.matched + ' candidates=' + JSON.stringify(out.dense.candidates.map((c) => c.key)) +
      ' · items=' + JSON.stringify(out.items.map((i) => [i.key, Object.keys(i.rank).sort().join('+'), i.score.toFixed(6)])),
  )
  await ctx.stop?.()
})

test('dual-⑩ 反向（真数据）：词法已足够时不塞无关项（阈值腿仍有效），且必须自证扫了', async (t) => {
  const { ctx, core, svc } = await bootReal()
  await remember(core, svc, 'mem-open', MEMO_OPEN)
  await remember(core, svc, 'mem-wsl', '开发环境一直在用 WSL，命令行习惯')
  await remember(core, svc, 'mem-far', MEMO_FAR)

  const { lexHits, out } = await recallReal(core, svc, ASK_FAR)
  assert.ok(lexHits >= 1, '前提：这条查询词法有命中（mem-far）')
  // ⚠ 负例必须自证扫了（否则会被「腿压根没跑」骗过）
  assert.equal(out.dense?.ran, true, '反向用例必须证明本腿真跑了')
  assert.equal(out.dense?.scanned, 3, '必须真扫到行（scanned=0 是没得扫，不是不相近）')
  assert.equal(out.dense?.matched, 0, '其余两条都在阈值之下 ⇒ matched=0')
  assert.deepEqual(out.dense?.candidates, [], '一个无关项都不得进候选池')
  const keys = out.items.map((i) => i.key)
  assert.deepEqual(keys, ['mem-far'], '结果里只该有词法命中那条：实测 ' + JSON.stringify(keys))
  for (const it of out.items) {
    assert.ok(it.rank.dense === undefined || it.rank.lexical !== undefined, '不得出现只有 dense 名次的无关项：' + it.key)
  }
  assert.ok(out.dense.omitted.length >= 2, '被挡下的行必须逐条具名（否则挡住不可查）')

  // 负向控制：同一语料、阈值降到 0 ⇒ 无关项确实会被塞进来（证明上面的 0 来自阈值判据，不是管线断了）
  const loose = await bootReal({ denseCandidates: { enabled: true, threshold: 0, scanRows: 512, topN: 20 } })
  for (const [id, text] of [['mem-open', MEMO_OPEN], ['mem-wsl', '开发环境一直在用 WSL，命令行习惯'], ['mem-far', MEMO_FAR]]) {
    await remember(loose.core, loose.svc, id, text)
  }
  const looseOut = await recallReal(loose.core, loose.svc, ASK_FAR)
  assert.ok(
    looseOut.out.items.length > out.items.length,
    '阈值降到 0 必须能多召回（证明「0 命中」来自阈值判据，不是管线断了）：' + JSON.stringify(looseOut.out.items.map((i) => i.key)),
  )
  t.diagnostic(
    '[反向·真数据·池非空] 查询 ' + JSON.stringify(ASK_FAR) + ' → 阈值 0.5：items=' + JSON.stringify(keys) + ' matched=0 scanned=' + out.dense?.scanned +
      ' · 阈值 0（对照腿）：items=' + JSON.stringify(looseOut.out.items.map((i) => i.key)),
  )
  await ctx.stop?.()
  await loose.ctx.stop?.()
})

test('dual-⑪ 修前/修后对照 + 代价实测：同一库同一查询，只切腿开/关', async (t) => {
  const on = await bootReal() // 缺省：腿开（本卡的新行为）
  const off = await bootReal({ denseCandidates: { enabled: false, threshold: 0.5, scanRows: 512, topN: 20 } }) // 腿关（= 改动前那条路径）
  for (const [id, text] of [['mem-open', MEMO_OPEN], ['mem-wsl', '开发环境一直在用 WSL，命令行习惯'], ['mem-far', MEMO_FAR]]) {
    await remember(on.core, on.svc, id, text)
    await remember(off.core, off.svc, id, text)
  }

  const lexOn = on.core.recallLexical(ASK_LEX_WSL, 10)
  const lexOff = off.core.recallLexical(ASK_LEX_WSL, 10)
  assert.deepEqual(lexOn.hits.map((h) => h.id), lexOff.hits.map((h) => h.id), '前提：两边词法候选完全相同（差异只来自本腿）')
  const candsOn = lexOn.hits.map((h, i) => ({ key: h.id, lexicalRank: i + 1 }))
  const candsOff = lexOff.hits.map((h, i) => ({ key: h.id, lexicalRank: i + 1 }))

  const before = await off.svc.recall(ASK_LEX_WSL, candsOff, 10)
  const after = await on.svc.recall(ASK_LEX_WSL, candsOn, 10)
  const beforeKeys = before.items.map((i) => i.key)
  const afterKeys = after.items.map((i) => i.key)
  assert.notDeepEqual(afterKeys, beforeKeys, '本卡必须真改变池非空时的排序（否则双路没生效）')
  assert.deepEqual(beforeKeys, ['mem-open'], '修前：池非空 ⇒ 向量腿不产出候选 ⇒ 只有词法那条')
  assert.deepEqual(afterKeys, ['mem-open', 'mem-wsl'], '修后：语义相近项被第二路带进来（词法那条仍在，且排在前）')
  // ⚠ 腿关时读数**仍然写**（`ran:false` + 具名 `dense-disabled`）—— 那是 L1 的「能不能扫」读数。
  //   L1 的「不写键」出现在**另一个**前提上：调用方**没要求**本腿（不传 cfg.dense）。两者不同形，别读混。
  assert.equal(before.dense?.ran, false, '修前（腿关）：读数写，但 ran=false（不是「没扫」那种缺字段）')
  assert.ok(before.dense?.unavailableReason?.startsWith('dense-disabled'), '修前的原因必须具名：' + before.dense?.unavailableReason)
  assert.equal(after.dense?.ran, true, '修后读数必写')
  assert.equal(after.dense?.scanned, 3, '修后扫描量可见（3 行）')
  assert.equal(after.dense?.scanLimitReached, false, '3 行 < scanRows=512 ⇒ 未触顶')

  // ── 代价：同一台机、同一端点、同一查询，各 N 次取总耗时（B 档：只作测量条件，不进阈值列）──
  const N = 10
  const bench = async (svc, cands) => {
    const t0 = Date.now()
    for (let i = 0; i < N; i++) await svc.recall(ASK_LEX_WSL, cands, 10)
    return Date.now() - t0
  }
  const msOff = await bench(off.svc, candsOff)
  const msOn = await bench(on.svc, candsOn)
  const perOff = msOff / N
  const perOn = msOn / N
  t.diagnostic(
    '[代价·实测] N=' + N + ' · 腿关 ' + msOff + 'ms（' + perOff.toFixed(1) + 'ms/次）· 腿开 ' + msOn + 'ms（' + perOn.toFixed(1) + 'ms/次）' +
      ' · 差额 ' + (msOn - msOff) + 'ms（' + (perOn - perOff).toFixed(1) + 'ms/次）· 扫描 3 行/次 · 嵌入次数两态相同（各 1 次/次）' +
      ' · scanLimitReached=' + after.dense?.scanLimitReached,
  )
  assert.ok(Number.isFinite(perOn) && Number.isFinite(perOff), '耗时读数必须是有限数（不许用「很快」了事）')
  // ⚠ 只断一个宽松上限（防止退化成数量级回归）；精确耗时属 B 档，不进阈值列。
  assert.ok(perOn - perOff < 100, '单次差额必须远小于一次嵌入往返（实测 ' + (perOn - perOff).toFixed(1) + 'ms）；超了说明扫描相位真成了瓶颈')
  await on.ctx.stop?.()
  await off.ctx.stop?.()
})

// ── 附：文件末的未决风险（不是判据，是后人接手要看的一段）──────────────────────
// ⚠ 已知限制 1：本腿自产候选按 1..N 编号，请求池内候选由既有循环按 1..M 编号 ⇒
//   两套名次表可能同号（dual-⑨ 里 mem-open 与 mem-wsl 的 dense 名次都是 1）。
//   ⇒ 名次表内的相对次序仍由余弦+键序确定（可复现），但「dense 名次」不再唯一 ⇒
//     不可用作跨候选的比较基准。修它要动 L1 的既有名次口径（池空时的行为），不在本卡范围。
// ⚠ 已知限制 2：查询嵌入失败支路记 ran=false/scanned=0 ⇒ 该支路下扫描量与嵌入次数不可从读数推出。
