/**
 * B1.1 向量适配判据测试。
 *
 * ⚠ **运行方式（本会议已实测的假绿形态）**：**不许用 `"tests/*.test.mjs"` 通配** ——
 *   目录不存在时 `node --test` 静默 exit 0。本文件用**显式路径**跑：
 *   `node --test packages/vector/tests/b11-vector.test.mjs`
 *
 * 判据分档（`docs/contract/threshold-discipline.md`）：
 *   A 档（逐字比对，绝对差 ≤1e-6）：RRF 三锚点、BLOB 往返逐位、dim==1024、枚举字段值；
 *   B 档（只作测量条件说明，**不进阈值列**）：耗时、真机相似度采样。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cosine, assertDim } from '../src/cosine.ts'
import { rrfTerm, rrfFuseRanked, rrfFuse, RRF_DEFAULT_K } from '../src/rrf.ts'
import { encodeVector, decodeVector, VectorStore } from '../src/vec-blob.ts'
import { embedTexts } from '../src/embed.ts'
import { recallVector } from '../src/recall.ts'
import { vec0UnavailableReason, VEC0_SEMANTICS } from '../src/vec0.ts'
// 真端点判据的**归因读数**（口径：docs/mana-endpoint-attribution.md）：红要能分清
// 「环境坏了」与「代码坏了」，并点名下一步查什么。本模块只换文案/类别，**不换判据**。
import { assertLiveEmbed, readLiveEmbed, behaviorWrongText } from './_live-endpoints.mjs'

const PLUGIN = new URL('../src/index.ts', import.meta.url).href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const OLLAMA = 'http://127.0.0.1:11434/v1'
const REACHABLE_ENDPOINT = 'http://127.0.0.1:1/v1' // 恒不可达（端口 1 无监听）

// ── 0. 自检：本文件必须**真的有判据**（防"空文件也绿"的假绿形态）──────────
/** 期望用例条数：**相等**语义（与 `tests/gate.mjs` 的 EXPECTED_CASES 同源同值）。 */
const EXPECTED_CASES = 15

test('B1.1-⓪ 判据自检：本文件 test( 计数**等于** 15 且交付文件齐备', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const self = fileURLToPath(import.meta.url)
  const src = readFileSync(self, 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  // ⚠ **必须用相等，不是 `>=`**（缺陷②修法）：下界会让「删掉一整条用例」不变色 ——
  //   本会议实测 `>= 13` 时删掉一条（14→13）仍是 `# tests 13 / pass 13 / exit 0`，缺口不可见。
  assert.equal(
    n,
    EXPECTED_CASES,
    `用例条数必须恰好 ${EXPECTED_CASES}（实测 ${n}）：少一条即有判据被删走；` +
      `若确为有意增删，请同步 tests/gate.mjs 的 EXPECTED_CASES`,
  )

  // ⚠ 相对路径多退一层的坑（本仓本周两席都踩过）：这里打印并断言解析结果
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
  assert.ok(srcDir.endsWith('packages/vector/src/'), `../src/ 必须解析到 packages/vector/src/，实测 ${srcDir}`)
  assert.ok(fileURLToPath(CORE).endsWith('packages/core/src/index.ts'), `core 入口解析错：${fileURLToPath(CORE)}`)
  for (const f of ['cosine.ts', 'rrf.ts', 'vec-blob.ts', 'embed.ts', 'recall.ts', 'vec0.ts', 'adapt.ts', 'index.ts']) {
    assert.ok(existsSync(srcDir + f), `交付文件缺失：${srcDir}${f}`)
  }
})

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'mana-vec-'))
  dirs.push(d)
  return d
}
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** 合成夹具向量（确定性：不用随机数，避免"一会儿过一会儿不过"）。 */
const fixtureVec = (dim, seed) => {
  const v = new Float32Array(dim)
  for (let i = 0; i < dim; i++) v[i] = Math.sin((i + 1) * (seed + 1) * 0.011) * Math.cos(i * 0.017 + seed)
  return v
}

// ── 1. A1-4 RRF 确定性（A 档，逐字比对 ≤1e-6）──────────────────────────────

test('B1.1-① A1-4 RRF 三锚点：k=60 时 [1,1]/[1,50]/[50,50] 绝对差 ≤1e-6（A 档）', (t) => {
  const cases = [
    { name: '[1,1]', got: rrfTerm(1, 60) + rrfTerm(1, 60), want: 0.032787 },
    { name: '[1,50]', got: rrfTerm(1, 60) + rrfTerm(50, 60), want: 0.025484 },
    { name: '[50,50]', got: rrfTerm(50, 60) + rrfTerm(50, 60), want: 0.018182 },
  ]
  for (const c of cases) {
    assert.ok(
      Math.abs(c.got - c.want) <= 1e-6,
      `${c.name} 必须是 ${c.want}，实测 ${c.got}（差 ${Math.abs(c.got - c.want)}）`,
    )
    t.diagnostic(`[A1-4] k=60 ${c.name} = ${c.got.toFixed(6)}（差 ${Math.abs(c.got - c.want).toExponential(3)}）`)
  }
  assert.equal(RRF_DEFAULT_K, 60, 'RRF 默认 k 必须是 60（册:394 原文）')

  // 同一个 k 必须同时被融合路径使用（否则"判据绿、实现另一套"）
  const fused = rrfFuseRanked({ x: 1, y: 1 }, { x: 1, y: 1 }, 60)
  for (const it of fused) assert.ok(Math.abs(it.score - 0.032787) <= 1e-6, `${it.key} 融合分不符：${it.score}`)
})

test('B1.1-② RRF 平局与重复键：同输入逐位可复现，重复键去重**并重排**', () => {
  const a = JSON.stringify(rrfFuseRanked({ p: 1, q: 2 }, { q: 1, p: 2 }, 60))
  const b = JSON.stringify(rrfFuseRanked({ p: 1, q: 2 }, { q: 1, p: 2 }, 60))
  assert.equal(a, b, '同一输入两次必须逐位相同（否则判据"一会儿过一会儿不过"）')

  // 完全并列 ⇒ 按 hits 降序后按 key 字典序升序裁决 ⇒ 结果确定
  const tie = rrfFuseRanked({ a: 1, b: 1 }, { a: 1, b: 1 }, 60)
  assert.deepEqual(tie.map((x) => x.key), ['a', 'b'], '完全并列时按 key 字典序升序（确定，不依赖 sort 稳定性）')

  // 重复键：若不去重，`[k,k]` 会拿到双份分 —— 那是静默的分数膨胀
  const dup = rrfFuse([{ name: 'L', keys: ['k', 'k', 'j'] }], 60)
  const k = dup.find((x) => x.key === 'k')
  const j = dup.find((x) => x.key === 'j')
  assert.ok(Math.abs(k.score - rrfTerm(1, 60)) <= 1e-12, `重复键必须只记首次名次，实测 score=${k.score}`)
  // ⚠ **去重后必须重排**（缺陷④修法）：`['x','x','y']` 里 y 的名次应是 2，不是 3。
  //   3 是"输入数组里的下标"，而 RRF 的定义域是"排序结果里的名次"。
  //   负向控制：把实现退回"只去重不重排" ⇒ 本断言必须红（已实测，见 handoff §2.1）。
  assert.equal(j.rank['L'], 2, `去重后必须重排：\`['k','k','j']\` 里 j 的名次应是 2，实测 ${j.rank['L']}`)
  assert.ok(
    Math.abs(j.score - rrfTerm(2, 60)) <= 1e-12,
    `j 的分必须按重排后的 rank 2 算，实测 score=${j.score}`,
  )

  // 等价性：与"上游直接拿到去重数组"的结果**完全一致**
  const upstreamEquivalent = rrfFuse([{ name: 'L', keys: ['k', 'j'] }], 60)
  assert.deepEqual(
    dup.map((x) => [x.key, x.rank['L'], x.score]),
    upstreamEquivalent.map((x) => [x.key, x.rank['L'], x.score]),
    '去重重排后必须与"入参本就无重复"的结果逐位相同（这才是语义正确的判据）',
  )

  // 缺失名次：不加分，且**不写该键**（上游给的是 `dense.length + 1` 的微量分，本实现刻意不同，见 rrf.ts 头）
  const missing = rrfFuseRanked({ only: 1 }, {}, 60)
  assert.equal(missing.length, 1)
  assert.ok(Math.abs(missing[0].score - rrfTerm(1, 60)) <= 1e-12, '未命中另一路时必须不加分')
  assert.equal(missing[0].rank['dense'], 1)
  assert.equal(
    Object.hasOwn(missing[0].rank, 'lexical'),
    false,
    '未命中的路必须"键不存在"，不是 0 / Infinity（不可分辨是 G8 禁的）',
  )
})

// ── 2. 余弦：与上游 shoucang 算法对拍（合成夹具，逐位） ──────────────────

test('B1.1-③ cosine 与上游语义逐位对拍 + 边界（长度不等/零向量 ⇒ 0，不抛）', (t) => {
  // 逐字复刻 /mnt/d/FF/shoucang/lib/vec.js 的 cosine（只读参考），作对拍基线
  const upstream = (a, b) => {
    if (!a.length || a.length !== b.length) return 0
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    if (!na || !nb) return 0
    return dot / (Math.sqrt(na) * Math.sqrt(nb))
  }

  const dim = 1024
  let maxDiff = 0
  for (let s = 0; s < 6; s++) {
    const u = fixtureVec(dim, s)
    const v = fixtureVec(dim, s + 1)
    const mine = cosine(u, v)
    const theirs = upstream(u, v)
    maxDiff = Math.max(maxDiff, Math.abs(mine - theirs))
    assert.equal(mine, theirs, `夹具 ${s} 逐位必须相等（不是"近似"）：${mine} vs ${theirs}`)
  }
  // 自相似：恒等向量的余弦必须极接近 1（不 clamp ⇒ 可能略超 1，故只断言下界）
  const self = cosine(fixtureVec(dim, 3), fixtureVec(dim, 3))
  assert.ok(self >= 1 - 1e-12, `自相似余弦必须 ≈1，实测 ${self}`)

  assert.equal(cosine([], []), 0, '空输入 ⇒ 0（上游语义，不抛）')
  assert.equal(cosine([1, 2], [1, 2, 3]), 0, '长度不等 ⇒ 0（上游语义，不抛）')
  assert.equal(cosine([0, 0], [1, 2]), 0, '零向量 ⇒ 0（挡住 0/0）')
  t.diagnostic(`[对拍] 6 组 1024 维夹具，最大逐位差 = ${maxDiff}（要求 == 0）`)
})

test('B1.1-④ assertDim：维度契约单独成条，不与"非法输入返回 0"混同', () => {
  assert.equal(assertDim(fixtureVec(1024, 0), 1024), null, '1024 维必须通过（A1-12）')
  const r1 = assertDim(fixtureVec(768, 0), 1024)
  assert.ok(typeof r1 === 'string' && r1.length > 0, '768 维必须给出非空原因')
  assert.ok(r1.includes('768') && r1.includes('1024'), `原因须含实测值与期望值，实测：${r1}`)
  assert.ok(assertDim(null, 1024).length > 0, 'null 也必须给原因（不可分辨是 G8 禁的）')
  const bad = fixtureVec(1024, 1)
  bad[7] = NaN
  assert.ok(assertDim(bad, 1024).includes('第 7 位'), '非有限值必须点名下标')
})

// ── 3. BLOB ⇄ 常驻 Float32Array ─────────────────────────────────────────

test('B1.1-⑤ BLOB 编解码往返逐位相等（含 byteOffset 切片坑）', (t) => {
  const v = fixtureVec(1024, 5)
  const blob = encodeVector(v)
  assert.equal(blob.length, 1024 * 4, 'BLOB 字节数必须是 dim×4')

  const back = decodeVector(blob, 1024)
  assert.equal(back.ok, true, `解码必须成功：${back.ok ? '' : back.reason}`)
  let exact = true
  for (let i = 0; i < v.length; i++) if (back.vec[i] !== v[i]) exact = false
  assert.ok(exact, '往返必须**逐位相等**（Float32 往返是无损的，不近似）')

  // ⚠ 坑：Buffer 常是共享 ArrayBuffer 的切片。单参 new Float32Array(buf) 会按元素解释字节。
  const padded = Buffer.concat([Buffer.alloc(8, 0x7f), blob, Buffer.alloc(8, 0x7f)])
  const slice = padded.subarray(8, 8 + blob.length)
  const sliced = decodeVector(slice, 1024)
  assert.equal(sliced.ok, true, '带 byteOffset 的切片也必须解对（这正是单参构造会静默错的地方）')
  assert.equal(sliced.vec[0], v[0], `切片解码首元素必须相等：${sliced.vec[0]} vs ${v[0]}`)

  // 三类失败必须给**不同**原因（不可分辨是 G8 禁的）
  const rNull = decodeVector(null, 1024)
  const rZero = decodeVector(Buffer.alloc(0), 1024)
  const rOdd = decodeVector(Buffer.alloc(5), 1024)
  const rDim = decodeVector(blob, 768)
  for (const [n, r] of [['NULL', rNull], ['空', rZero], ['非4倍数', rOdd], ['维度不符', rDim]]) {
    assert.equal(r.ok, false, `${n} 必须失败`)
    assert.ok(r.reason.length > 0, `${n} 必须给非空原因`)
  }
  const reasons = new Set([rNull.reason, rZero.reason, rOdd.reason, rDim.reason])
  assert.equal(reasons.size, 4, `四类失败原因必须互不相同，实测：${[...reasons].join(' | ')}`)
  t.diagnostic(`[BLOB] 3 类失败原因：${rZero.reason} / ${rOdd.reason} / ${rDim.reason}`)
})

test('B1.1-⑥ VectorStore：常驻命中不查库、落库失败不静默、清空有计数', () => {
  const v = fixtureVec(1024, 2)
  let putCalls = 0
  let getCalls = 0
  const store = new VectorStore({
    dim: 1024,
    persistPut: () => {
      putCalls++
      return 1
    },
    persistGet: () => {
      getCalls++
      return encodeVector(v)
    },
  })

  assert.equal(store.size, 0)
  const put = store.put('m1', v)
  assert.deepEqual({ resident: put.resident, persisted: put.persisted, reason: put.reason }, { resident: true, persisted: true, reason: null })
  assert.equal(putCalls, 1, '落库必须真被调用一次')
  assert.equal(store.size, 1, '必须真进常驻表（"常驻"要可数）')

  const hit = store.get('m1')
  assert.equal(hit.ok, true)
  assert.equal(getCalls, 0, '常驻命中**不得**再查库（否则"常驻"是形容词）')
  assert.equal(store.get('m1').item.from, 'fresh')

  // 维度不符 ⇒ 拒绝且**不静默**（要带原因，且不污染常驻表）
  const bad = store.put('m2', fixtureVec(768, 1))
  assert.equal(bad.resident, false)
  assert.ok(bad.reason.includes('768') && bad.reason.includes('1024'), `拒绝原因须含两值：${bad.reason}`)
  assert.equal(store.size, 1, '被拒绝的向量不得进常驻表')

  // 落库抛错 ⇒ persisted=false + 非空 reason（"部分成功"不得被读成"成功"）
  const store2 = new VectorStore({
    dim: 1024,
    persistPut: () => {
      throw new Error('disk-full-fixture')
    },
  })
  const r = store2.put('m3', v)
  assert.equal(r.resident, true, '落库失败不撤内存（向量是派生物，可重建）')
  assert.equal(r.persisted, false)
  assert.ok(r.reason.includes('disk-full-fixture'), `原因须含真因：${r.reason}`)
  assert.equal(store2.recentFailures().length, 1, '失败必须留痕可读，不能只体现在返回值')

  assert.equal(store2.clear(), 1, '清空必须返回真实条数（用于"卸载即净"取证）')
  assert.equal(store2.size, 0)
})

// ── 4. 降级链（A1-11 / G8）：可枚举字段断言，不接受"看着像降级了" ──────────

test('B1.1-⑦ 降级可枚举断言：端点不可达 ⇒ degraded===true / reason 非空 / channel=degraded / rankBy=local_score', async (t) => {
  const cands = [
    { key: 'a', lexicalRank: 1 },
    { key: 'b', lexicalRank: 2 },
    { key: 'c', lexicalRank: 3 },
  ]
  const store = new VectorStore({ dim: 1024 })
  for (const c of cands) store.put(c.key, fixtureVec(1024, c.lexicalRank))

  const cfg = {
    enabled: true,
    baseUrl: REACHABLE_ENDPOINT,
    model: 'bge-m3',
    dim: 1024,
    rrfK: 60,
    timeoutMs: 2000,
  }

  // ① 嵌入层信封
  const emb = await embedTexts(cfg, ['查询'])
  assert.equal(emb.degraded, true, '不可达端点必须判降级（不许 return null 后由调用方猜）')
  assert.equal(typeof emb.reason, 'string')
  assert.ok(emb.reason.length > 0, 'reason 必须非空字符串')
  assert.ok(emb.reason.includes(REACHABLE_ENDPOINT), `reason 必须含端点（否则"哪个端点不通"不可查）：${emb.reason}`)
  assert.deepEqual(emb.vectors, [], '降级时 vectors 必须是空数组（不是 undefined —— 会被 JSON 静默丢键）')

  // ② 召回层：A1-11 的四个字段逐条断言
  const out = await recallVector(cfg, store, '查询', cands, 3)
  assert.equal(out.degraded, true, '`degraded === true` 是可枚举断言，不接受"看着像降级了"')
  assert.equal(typeof out.reason, 'string')
  assert.ok(out.reason.length > 0, '`reason` 必须是非空字符串')
  assert.equal(out.channel, 'degraded', "`channel` 必须是 'degraded'（'vector'/'lexical'/'degraded' 三态之一）")
  assert.equal(out.rankBy, 'local_score', "降级时 `rankBy` 必须是 'local_score' 而非 'jev_prob'（A1-11 原文）")
  assert.ok(out.items.length > 0, '降级路径仍须返回**有序**的本地分结果（不是空）')
  assert.deepEqual(out.items.map((i) => i.key), ['a', 'b', 'c'], '降级时按词法名次排序')
  t.diagnostic(`[A1-11] degraded=${out.degraded} channel=${out.channel} rankBy=${out.rankBy} reason=${out.reason.slice(0, 60)}…`)
})

test('B1.1-⑧ 维度契约降级：端点返回非 1024 维 ⇒ 显式降级且 reason 含实测值', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ data: [{ embedding: new Array(768).fill(0.1) }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const cfg = { enabled: true, baseUrl: 'http://127.0.0.1:9/v1', model: 'bge-m3', dim: 1024, fetchImpl: fakeFetch }
  const out = await embedTexts(cfg, ['x'])
  assert.equal(out.degraded, true, '768 维必须判降级（A1-12：dim 必须 == 1024）')
  assert.ok(out.reason.includes('768') && out.reason.includes('1024'), `reason 须含实测与期望：${out.reason}`)

  // 反向对照：同一 fetch 返回 1024 维 ⇒ 必须**不**降级（否则"永远降级"也能骗过上面那条）
  const goodFetch = async () =>
    new Response(JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.1) }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const ok = await embedTexts({ ...cfg, fetchImpl: goodFetch }, ['x'])
  assert.equal(ok.degraded, false, `1024 维必须通过，实测 reason=${ok.reason}`)
  assert.equal(ok.reason, null, '未降级时 reason 必须是 null（不空串、不 undefined）')
  assert.equal(ok.vectors[0].length, 1024)

  // 空输入：N=0 显式记 0，且**不是降级**（G5：0 是合法值）
  const empty = await embedTexts({ ...cfg, fetchImpl: goodFetch }, [])
  assert.equal(empty.degraded, false, '空输入不是故障')
  assert.deepEqual(empty.vectors, [])
})

test('B1.1-⑨ vec0 未启用是**显式**的：route=vec0 给非空原因，不静默回落到 js', () => {
  assert.equal(vec0UnavailableReason('js'), null, "route='js' 不是降级（「本来就不走」≠「想走没走成」）")
  const r = vec0UnavailableReason('vec0')
  assert.equal(typeof r, 'string')
  assert.ok(r.length > 0, 'route=vec0 必须给非空原因（"不报错但语义偏离"是本项目最防的形态）')
  for (const w of ['W-1', 'W-2', 'W-3']) {
    assert.ok(r.includes(w), `原因必须点名 ${w}（启用前提是同时承接三条语义）：${r}`)
  }
  assert.equal(VEC0_SEMANTICS.length, 3, '三条语义必须逐条可机检（不是一段注释）')
  for (const s of VEC0_SEMANTICS) {
    assert.ok(s.negativeProbe.length > 0 && s.observed.length > 0, `${s.id} 必须带负例探针与实测值`)
  }
})

// ── 5. 真数据（不是夹具）：Ollama 真嵌入 + 真库 BLOB 落点 ────────────────

test('B1.1-⑩ 真嵌入（本机 Ollama）：dim==1024；重复同一文本 cos ≥ 0.999999', async (t) => {
  const cfg = { enabled: true, baseUrl: OLLAMA, model: 'bge-m3', dim: 1024, timeoutMs: 30000 }
  const probe = await embedTexts(cfg, ['向量适配判据探针'])
  // ⚠ 不可达时**显式红**，不静默跳过（"不静默跳过"是本席的刻意选择：跳过 = 假绿）。
  //   本条只管**测量条件**那一腿：环境不可用 ⇒ 红，且文案点名"查环境"；
  //   环境可用而读数不对 ⇒ 也是红，但文案点名"查被测代码"（三态不同形，2026-09-27 起）。
  assertLiveEmbed(probe, { title: 'B1.1-⑩ 嵌入端点的测量条件', baseUrl: cfg.baseUrl, model: cfg.model })
  // 环境已应答 ⇒ 下面这两条只能是**行为面**红（走 behavior-wrong 文案，不再与 env 态同形）
  const probeRead = readLiveEmbed(cfg.baseUrl, cfg.model, probe)
  assert.equal(probeRead.vectorCount, 1, behaviorWrongText('B1.1-⑩ 应答条数', `vectors=${probeRead.vectorCount}`))
  assert.equal(probeRead.dims[0], 1024, behaviorWrongText('B1.1-⑩ 维度契约（A1-12，A 档）', `dim=${probeRead.dims[0]}`))

  const again = await embedTexts(cfg, ['向量适配判据探针'])
  assertLiveEmbed(again, { title: 'B1.1-⑩ 嵌入端点的测量条件（第二次调用）', baseUrl: cfg.baseUrl, model: cfg.model })
  const sim = cosine(probe.vectors[0], again.vectors[0])
  assert.ok(sim >= 0.999999, behaviorWrongText('B1.1-⑩ 同文两次的余弦', `cos=${sim}（应 ≥0.999999）`))

  const changed = await embedTexts(cfg, ['完全换一句别的意思的话'])
  // ⚠ 改前这一路**没有**终检：环境在换句调用上坏掉时，下一行的 cosine(probe, changed.vectors[0])
  //   会拿 undefined 去算 ⇒ 抛一个与"环境/代码"无关的 TypeError（正是本卡要消灭的不可归因红）。
  assertLiveEmbed(changed, { title: 'B1.1-⑩ 嵌入端点的测量条件（换句调用）', baseUrl: cfg.baseUrl, model: cfg.model })
  const simOther = cosine(probe.vectors[0], changed.vectors[0])
  t.diagnostic(
    `[A1-12 · B 档测量条件说明] 同文重复 cos=${sim.toFixed(6)} · 改写句 cos=${simOther.toFixed(6)} · ` +
      `嵌入耗时 ${probe.ms}ms/${again.ms}ms/${changed.ms}ms（**绝对毫秒不进阈值列**）`,
  )
  assert.ok(sim > simOther, `同文相似度必须高于换句（实测 ${sim} vs ${simOther}）`)
})

test('B1.1-⑪ 真库 BLOB 落点 + 真 cordis 装载：写进 memory_items.vector 并可读回', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const vecMod = await import(PLUGIN)

  const dir = tempDir()
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(200)
  const fiber = ctx.plugin(vecMod, {})
  await settle(300)

  const svc = ctx.get('mana-vector')
  assert.ok(svc, 'mana-vector 服务必须可读（未 provide = 插件没真跑起来）')
  const st = svc.status()
  assert.equal(st.wired, true)
  assert.equal(st.dim, 1024)
  assert.equal(st.route, 'js', "缺省 route 必须是 'js'")
  assert.equal(st.routeDisabledReason, null, "route='js' ⇒ routeDisabledReason 必须为 null")
  assert.equal(st.resident, 0)

  // 写一条：真落 memory_items.vector 列（BLOB）
  const v = fixtureVec(1024, 9)
  const w = await svc.putMemoryVector('mem-b11-1', v, { type: 'test', content: 'b11 落点探针' })
  assert.equal(w.written, true, `写入必须成功：${w.reason}`)
  assert.equal(w.reason, null, '成功时 reason 必须是 null')
  assert.equal(svc.status().resident, 1, '常驻条数必须真的 +1')

  const core = ctx.get('mana-core')
  const row = core.db.prepare('SELECT id, type, vector FROM memory_items WHERE id = ?').get('mem-b11-1')
  assert.ok(row, 'memory_items 必须真有一行（"文件在长"不算交付）')
  assert.ok(row.vector instanceof Uint8Array, `vector 列必须是二进制（实测 ${row.vector?.constructor?.name}）`)
  assert.equal(row.vector.byteLength, 1024 * 4, 'BLOB 字节数必须是 dim×4')

  // 读回：解码逐位相等（真库往返，不是内存往返）
  const dec = decodeVector(row.vector, 1024)
  assert.equal(dec.ok, true, `真库 BLOB 解码必须成功：${dec.ok ? '' : dec.reason}`)
  let exact = true
  for (let i = 0; i < v.length; i++) if (dec.vec[i] !== v[i]) exact = false
  assert.ok(exact, '真库往返必须逐位相等')

  // 换新 ctx 装载同一库 ⇒ 走 persistGet 从库解码（证明"库当真相"）
  const ctx2 = new Context()
  ctx2.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(200)
  ctx2.plugin(vecMod, {})
  await settle(300)
  const svc2 = ctx2.get('mana-vector')
  assert.equal(svc2.status().resident, 0, '新进程常驻表必须是空的（起点为 0，否则下面的"从库读回"可能是内存命中）')
  const got = svc2.getMemoryVector('mem-b11-1')
  assert.equal(got.ok, true, `从库读回必须成功：${got.ok ? '' : got.reason}`)
  assert.equal(svc2.status().resident, 1, '从库读回后必须进常驻')

  t.diagnostic(`[真库] memory_items.vector 落点 1024×4 B ${row.vector.byteLength} B，真库往返逐位相等，新 ctx 从库解码成功`)
  await ctx2.stop?.()
  await ctx.stop?.()
})

// ── 6. 骨架保持 + G9 直通链（既有行为不得失效）──────────────────────────

test('B1.1-⑫ 骨架保持：name/inject/Config 未变 + G9 直通链仍走到末端', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const vecMod = await import(PLUGIN)

  assert.equal(vecMod.name, 'mana-vector', '插件 name 不得改（inject 靠它）')
  assert.deepEqual(vecMod.inject, ['mana-core'], 'inject 不得改')

  const dir = tempDir()
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(150)
  ctx.plugin(vecMod, {})
  await settle(300)

  // G9：漏调 next() 会静默掐死下游。用末端哨兵计数（与 core 骨架测试同一手法）
  let reached = 0
  ctx.on('agent/pre-step', async (_payload, next) => {
    reached += 1
    return await next()
  })
  const payload = { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }
  const r = await ctx.waterfall('agent/pre-step', payload, async () => {
    reached += 1
    return { messages: [] }
  })
  assert.equal(reached, 2, '末端哨兵必须被走到（reached=1 即"静默掐死下游"）')
  assert.deepEqual(r, { messages: [] }, '直通链不得改写 next 的返回值')
  await ctx.stop?.()
})

// ── 7. 反证判据（handoff 第 3 段）：卸载后同一触发不再产生新行 ────────────

test('B1.1-⑬ 反证：卸载 vector 后同一触发不再产生新行（附正向对照防平凡通过）', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const vecMod = await import(PLUGIN)

  const dir = tempDir()
  const ctx = new Context()
  const coreFiber = ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(200)
  const vecFiber = ctx.plugin(vecMod, {})
  await settle(300)

  const core = ctx.get('mana-core')
  const rows = () => Number(core.db.prepare("SELECT count(*) c FROM memory_items WHERE id LIKE 'rev-%'").get().c)
  let recallEvents = 0
  ctx.on('mana/recall', () => {
    recallEvents++
  })

  // 「同一触发」= 写一条向量 + 一次带信封的召回（两件都真做，不只数其中一个）
  const trigger = async (tag) => {
    const svc = ctx.get('mana-vector')
    if (!svc) return null
    const r = await svc.putMemoryVector(`rev-${tag}`, fixtureVec(1024, 1))
    await svc.recall('反证探针', [{ key: `rev-${tag}`, lexicalRank: 1 }], 3, {
      sessionId: 's-rev',
      turnId: 1,
      requestId: `r-${tag}`,
    })
    return r
  }

  const before = rows()
  const first = await trigger('a')
  await settle(100)
  const afterTrigger = rows()
  assert.ok(first && first.written === true, '装载态下写入必须成功')
  assert.equal(afterTrigger, before + 1, `装载态下同一触发**必须**新增 1 行（否则反证平凡通过 = G11 假绿）：${before} → ${afterTrigger}`)
  assert.equal(recallEvents, 1, '装载态下 mana/recall 必须真的被 emit（否则下面数事件也是平凡通过）')

  // 卸载（cordis 插件层卸载语义 = fiber.dispose）
  await vecFiber.dispose()
  await settle(300)
  assert.equal(ctx.get('mana-vector'), undefined, '卸载后服务必须不可读（未卸干净则本判据无意义）')
  const afterUnload = rows()
  const eventsAfterUnload = recallEvents

  const second = await trigger('b')
  await settle(200)
  assert.equal(second, null, '卸载后触发应取不到服务')
  assert.equal(rows(), afterUnload, `卸载后同一触发不得再产生新行：${afterUnload} → ${rows()}`)
  assert.equal(recallEvents, eventsAfterUnload, `卸载后不得再 emit mana/recall：${eventsAfterUnload} → ${recallEvents}`)

  t.diagnostic(
    `[反证 · 进程内装配] 装载态 +1 行 / +1 事件（${before}→${afterTrigger}）；卸载后 0 新行 / 0 新事件（${afterUnload}→${rows()}）`,
  )
  // 数据层不动：BLOB 行仍在（回滚的双层性，handoff-protocol.md）
  assert.ok(rows() >= 1, '数据层行必须仍在 —— "卸载即净"只对插件层成立，不得据本判据说数据也回滚了')
  void coreFiber
  await ctx.stop?.()
})

// ── 8. 缺陷③ 的**机检化**：把已知缺口钉成可观测事实（不是写句注释）─────────

test('B1.1-⑭ 召回记录**已落库**：recall 段不再只存在于返回对象（原缺口已闭合）', async (t) => {
  // ── 本用例的来历（不删历史，只改口径）─────────────────────────────────────
  // 原口径：复核发现真故障时 `mana_trace`/`jev_log`/`inject_log`/`memory_items` **增量全 0**，
  //   `mana/recall` 虽 emit 但**全仓无消费者** ⇒ G8 的"显式字段"只在**返回对象**里，跨进程不可查。
  //   当时把缺口**钉成断言**（增量必须为 0），并写明「一旦下一席补了写入落点，本用例会变红」。
  //
  // ⚠ 该缺口已于 F-01（S15 集成席）**闭合**：`vector/src/index.ts` 的 recall 现在把 `ManaRecall`
  //   同时**落 mana_trace**（裸名 'recall'，MANA_STAGES 真源）与 emit —— 因为 A1-1 要求
  //   「五类 event_type 各 ≥1」，而 'recall' 的全仓唯一生产者就是这一处；只广播不落库
  //   会让五类里的 recall 在 mana_trace 上**永远为空**（判据结构上不可满足）。
  //   ⇒ 断言按事实翻转：**只查 recall 那一类**是否真落了一行，不影响其余三表的既有口径。
  //
  // ⚠ 为什么不像原稿那样断言「四表增量总和 ≥1」：那太宽 ——
  //   任何一条无关写入（备份失败留痕、plugin/inactive…）都会让它变绿，
  //   而「recall 到底落没落库」这个**具体事实**仍然没被检查（判据绿 ≠ 事实被检查）。

  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(CORE)
  const vecMod = await import(PLUGIN)

  const dir = tempDir()
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(200)
  ctx.plugin(vecMod, {})
  await settle(300)

  const core = ctx.get('mana-core')
  const svc = ctx.get('mana-vector')
  const countAll = () => {
    const t = (n) => Number(core.db.prepare(`SELECT count(*) c FROM ${n}`).get().c)
    return { trace: t('mana_trace'), inject: t('inject_log'), items: t('memory_items'), jev: t('jev_log') }
  }
  /** 只数 **recall 段**的行（按 event_type）；标签真源见 core 的 MANA_STAGES 第 4 项。 */
  const { MANA_STAGES } = await import('../../core/src/domain.ts')
  const RECALL_LABEL = MANA_STAGES[3]
  const countRecall = () =>
    Number(core.db.prepare('SELECT count(*) c FROM mana_trace WHERE event_type = ?').get(RECALL_LABEL).c)
  const before = countAll()
  const recallBefore = countRecall()

  // 造一次**真故障**（不可达端点）触发降级路径
  const out = await svc.recall('缺陷③ 探针', [{ key: 'no-such-key', lexicalRank: 1 }], 3, {
    sessionId: 's-gap',
    turnId: 1,
    requestId: 'r-gap',
  })
  await settle(150)
  const after = countAll()
  assert.equal(out.degraded, true, '本用例的前提是**降级真发生了**（否则下面的"没落库"没意义）')

  const delta = {
    trace: after.trace - before.trace,
    inject: after.inject - before.inject,
    items: after.items - before.items,
    jev: after.jev - before.jev,
  }
  // 口径：降级**也**必须落 recall 行（G8：降级落显式字段）。用「=== 0 才红」而不是「≥1 才绿」
  //   —— 后者在多次调用累积时会掩盖「本次没落库」。
  const recallDelta = countRecall() - recallBefore
  assert.equal(
    recallDelta,
    1,
    `降级召回必须落**恰好一条** recall 行（实得 ${recallDelta}）。` +
      `若为 0 ⇒ 落库点被摘掉，A1-1 的 recall 类随之结构性缺失（原缺口复发）。` +
      `若是别的数 ⇒ 一次 recall 落了多行，需核对是否重复记账。`,
  )
  t.diagnostic(`[四表增量] ${JSON.stringify(delta)}（本题只判 recall 那一类；其余三表的增量口径见各自用例）`)
  t.diagnostic(
    `[缺陷③ 钉住] 真降级（degraded=true, channel=${out.channel}）但四表增量 = ${JSON.stringify(delta)}` +
      ` ⇒ 「降级态仅存于返回对象、未落库、事后不可查」是可机检事实，不是文档自述`,
  )
  await ctx.stop?.()
})
