/**
 * **大环路递归检索判据**（v10 §12.5「大环路递归」/ §14.7「大环路递归检索」）。
 *
 * ⚠ **运行方式**（本仓实测过的假绿形态）：**不许用通配** —— `node --test "tests/*.test.mjs"`
 *   在目录不存在时**静默 exit 0**。本文件由 `tests/gate.mjs` 以**显式路径**拉起
 *   （`npm test`），真跑单文件用 `node --test packages/vector/tests/bigloop.test.mjs`。
 *
 * ── 本文件判什么（逐条对着卡面验收标准）─────────────────────────────────────────────
 * 1. **收敛可判定**：② 一例**真收敛**（5 轮 < 上限 6 轮，`stopReason` 点名）；
 *    ④ 把**三种不同的自然收敛原因**（前沿空 / 增长低于阈值 / **检索饱和**）并列跑出来，
 *    证明"停"不是一条分支兼职，而是三条各自可达、各自命名的判据；
 * 2. **不收敛有硬上限（防活锁）**：③ 一例**每轮都带回新键**（三条自然判据一条都不触发）
 *    ⇒ 跑满 `maxRounds` 后**显式**停：`status='capped'`、`capped=true`、`reason` 非空，
 *    并实测**检索调用次数 === `maxRounds`**（换 `maxRounds=2` 读数跟着变 ⇒ 上限真吃配置）；
 *    另有 ⑩ 的越界抛出与 ⑨ 的 `while` 静态腿共同兜"无界递归"；
 * 3. **跨轮合并幂等**：⑤ 纯函数面 `merge(obs ∪ obs)` 与 `merge(obs)` **逐字相等**，
 *    端到端再验 `mergedRows < observations`（同一键跨两轮只留一行）；
 * 4. **失败态可分辨**：⑥ 把"显式关闭 / 无候选 / 检索腿抛错"三种**没有正常结果**的情形
 *    分别跑成**三个不同的取值**，且错误腿保留**原始错误文本**（不是 `catch { return null }`）；
 * 5. **不许改 Events 契约**：① 静态腿机检 `bigloop.ts` **零 import**（结构上碰不到 core 的
 *    `ManaObservation`/`ManaRecall`），且零注册点、零 IO、零写库。
 *
 * 判据分档（`docs/contract/threshold-discipline.md`）：
 *   A 档（逐字比对）：收敛/终止取值、调用计数、`fuseScore` 与 RRF 的等价、确定性重跑；
 *   B 档（**不进任何断言**）：`rounds[i].ms` 耗时 —— 确定性重跑时被显式归零（见 `stable()`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BIGLOOP_SRC = new URL('../src/bigloop.ts', import.meta.url)
const RRF_SRC = new URL('../src/rrf.ts', import.meta.url)

/**
 * 期望用例条数（**相等**语义，与 `tests/gate.mjs` 的 FILES 清单同源同值）：
 * 少一条即有判据被删走；改条数必须**同时**改这里与 `tests/gate.mjs`。
 */
const EXPECTED_CASES = 12

const {
  runBigLoop,
  mergeCandidates,
  sumClueGain,
  overlapRatio,
  fuseScore,
  rankAcrossRounds,
  DEFAULT_BIGLOOP_KNOBS,
  BIGLOOP_TERMINALS,
  BIGLOOP_RRF_K,
  HARD_MAX_ROUNDS,
  BIGLOOP_SAME_QUERY_CEILING,
  BIGLOOP_REASON_PREFIX,
} = await import(BIGLOOP_SRC.href)

/**
 * 去掉**唯一的 B 档字段**（`ms`）后做逐字比较的稳定化视图。
 * ⚠ 确定性重跑若把 `ms` 也算进去，就会拿一个"同机跨采样差 1.2–13 倍"的量当判据
 *   （`threshold-discipline.md` 明令）。⇒ 显式归零，而不是"偶尔不等就重跑"。
 */
const stable = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'ms' ? 0 : v)))

/** 造一个"按查询给候选"的注入检索端口（记下每次调用，便于断言"真发了 / 发了几次"）。 */
function port(table, log = []) {
  const fn = (query, round) => {
    log.push({ query, round })
    if (!(query in table)) return []
    return table[query]
  }
  fn.log = log
  return fn
}

/** 本文件的小夹具：初始键 `k-00` → 每轮问出一条新键，线索问完即收敛（4 轮 < 上限 6）。 */
const SMALL = {
  's-a': [{ key: 'k-01', score: 1, channels: ['lexical'], clues: ['q-01'] }],
  // ⚠ 第 2 轮**故意再带回 k-01**：这是"同一个候选进两次"的真实来源，
  //   没有它，跨轮整合（④）与幂等（⑤）在本夹具上就没有落点（各键只出现一次 ⇒ 折不出来）。
  'q-01': [
    { key: 'k-01', score: 3, channels: ['dense'] },
    { key: 'k-02', score: 1, channels: ['lexical'], clues: ['q-02'] },
  ],
  'q-02': [{ key: 'k-03', score: 1, channels: ['lexical'], clues: ['q-03'] }],
  'q-03': [{ key: 'k-04', score: 1, channels: ['lexical'], clues: [] }],
}
/**
 * 断言失败时**把整份读数打到日志里**（读数是本模块的产出物，没有它失败态不可诊断）。
 * ⚠ 只加可见性，**不改判定**：断言本身照原样抛出。
 */
function safeFail(label, fn) {
  return async (t) => {
    try {
      return await fn(t)
    } catch (error) {
      t.diagnostic(`${label} —— 失败时的完整读数：\n` + safeFail.last)
      throw error
    }
  }
}
safeFail.last = '（无）'
const record = async (fn) => {
  const r = await fn()
  safeFail.last = JSON.stringify(r, null, 2)
  return r
}

const small = (extra = {}) =>
  record(() => runBigLoop({ baseQuery: 's-a', baseCandidates: [{ key: 'k-00' }], retrieve: port(SMALL), ...extra }))

/**
 * **无界夹具（每轮翻倍、封顶 `fanout`）**：本轮新键数 = `min(fanout, max(1, 已发出数))`。
 *
 * 它为"只有硬上限能停"造的**三条结构性质**（缺省旋钮下逐条成立）：
 *   · 增长读数 ≥ 0.25（`maxRounds=6` 内：1 / 1 / 1 / 0.5 / 0.33 / 0.25，**不小于**缺省阈值）
 *     ⇒ 增长判据打不着（用 `<` 判，取等不算触发 —— 这也是本夹具卡在 6 轮的原因）；
 *   · 每轮返回的键**全是新的**（饱和率恒 0 < 0.6）⇒ 饱和判据打不着；
 *   · 每个新键都带一条**没用过的**线索        ⇒ 前沿恒非空，收敛判据打不着。
 * ⚠ 首版用"每轮恒一个新键"，增长读数会随分母变大而跌破阈值 ⇒ 测到的是增长判据，不是上限。
 * ⚠ `fanout` **必须封顶**：真按 2^n 放大会在几十轮内把进程撑爆（首版实测：32 轮用例
 *   跑成 62s 超时）——夹具不能为了"看起来无界"而真的无界。
 */
function geometric(fanout = 4, guard = 64) {
  let calls = 0
  let emitted = 0
  const retrieve = () => {
    calls += 1
    // 活锁护栏：万一真无界，本用例**报红**（`search-error` + 这句话）而不是把测试挂死。
    if (calls > guard) throw new Error(`无界递归：检索调用超过 ${guard} 次`)
    const n = Math.min(fanout, Math.max(1, emitted))
    const out = []
    for (let i = 0; i < n; i++) {
      emitted += 1
      out.push({ key: `g-${emitted}`, score: 1, clues: [`q-${emitted}`] })
    }
    return out
  }
  return { retrieve, callsOf: () => calls, emitted: () => emitted }
}

// ── 0. 判据自检：本文件必须**真的有判据**（防"空文件也绿"）────────────────────
test('D2-⓪ 判据自检：本文件 test( 计数等于 12，且被测源文件路径解析正确', () => {
  const self = fileURLToPath(import.meta.url)
  const src = readFileSync(self, 'utf8')
  const n = (src.match(/^test\(/gm) ?? []).length
  assert.equal(
    n,
    EXPECTED_CASES,
    `用例条数必须恰好 ${EXPECTED_CASES}（实测 ${n}）：少一条即有判据被删走；若确为有意增删，请同步 tests/gate.mjs 的 FILES 清单`,
  )
  assert.ok(!/^test\.only\(/m.test(src), '不得留下 test.only（那会让其余判据静默不跑）')
  assert.ok(/assert\./.test(src), '本文件必须真的含断言（空壳用例会让闸的计数腿变成装饰）')
  const p = fileURLToPath(BIGLOOP_SRC)
  assert.ok(p.endsWith('packages/vector/src/bigloop.ts'), `../src/bigloop.ts 必须解析到 packages/vector/src/，实测 ${p}`)
  // 反向自证：被测源文件本身非空且含真实现（否则上面的 import 拿到的是空模块）
  const bs = readFileSync(p, 'utf8')
  assert.ok(bs.length > 4096, `bigloop.ts 必须是非平凡实现，实测 ${bs.length} B`)
  for (const name of ['runBigLoop', 'mergeCandidates', 'sumClueGain', 'overlapRatio', 'fuseScore', 'rankAcrossRounds']) {
    assert.ok(bs.includes(`export function ${name}`) || bs.includes(`export async function ${name}`), `bigloop.ts 必须导出 ${name}`)
  }
})

// ── 1. 静态腿：零 import（碰不到 Events 契约）/ 零注册点 / 零 IO / 零写库 ────────
test('D2-① 静态腿：bigloop.ts 零 import、零注册点、零 IO、零写库，且无 while 形态', () => {
  const src = readFileSync(fileURLToPath(BIGLOOP_SRC), 'utf8')
  // 去掉注释后再判（注释里会**引用**被禁的字样，例如"本模块没有 while(true) 形态"）
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // 反向自证：剥离必须没把代码一起吃掉（否则下面全是空跑）
  assert.ok(code.includes('export async function runBigLoop'), '注释剥离后必须仍含真实现（否则本用例是空跑）')

  // ① 零 import ⇒ 结构上不可能触碰 Events 契约（ManaObservation/ManaRecall 在 core）
  assert.ok(!/^\s*import\s/m.test(code), 'bigloop.ts 不得有任何 import（零依赖新增；也借此在结构上碰不到 core 的 Events 契约）')
  assert.ok(!/dsh-mana-core/.test(code), 'bigloop.ts 不得出现 dsh-mana-core')
  for (const banned of ['ctx.on(', 'ctx.waterfall(', 'ctx.effect(', 'registerPassThroughPreStep', 'setInterval', 'setTimeout', 'process.env']) {
    assert.ok(!code.includes(banned), `bigloop.ts 不得出现 ${banned}（零注册点 / 零环境依赖）`)
  }
  // ② 零 IO / 零写库（本模块只算，不读不写）
  for (const banned of ['node:fs', 'node:sqlite', 'readFileSync', 'fetch(', 'CREATE TABLE', 'INSERT INTO', 'UPDATE ', 'DELETE FROM', 'SELECT ']) {
    assert.ok(!code.includes(banned), `bigloop.ts 不得出现 ${banned}（零 IO / 零写库）`)
  }
  assert.ok(!/\.emit\(|writeTrace/.test(code), 'bigloop.ts 不得 emit / writeTrace（Events 契约面归 index.ts 单点）')
  // ③ 无 while 形态：轮数上界只能由 for 的边界表达式给出（这是"防活锁"的结构前提）
  assert.ok(!/\bwhile\b/.test(code), 'bigloop.ts 不得出现 while（无界循环形态；轮次上界必须由 for 边界给出）')
  assert.ok(
    code.includes('for (let round = 1; round <= knobs.maxRounds; round++)'),
    '轮次循环必须逐字钉在 knobs.maxRounds 上（换常量/换 true 即红）',
  )
  assert.ok(!/for\s*\(\s*;\s*;/.test(code), '不得出现无条件 for(;;)')
  assert.ok(Object.isFrozen(DEFAULT_BIGLOOP_KNOBS), '缺省旋钮必须冻结（防"缺省被就地改写"两处悄悄分叉）')
  assert.ok(Object.isFrozen(BIGLOOP_TERMINALS), '终止原因表必须冻结（它是判据的对照面）')
})

// ── 2. 六环节闭环 · 真收敛（轮数 < 硬上限，自然停）───────────────────────────
test('D2-② 真收敛：检索→线索→新查询→跨轮整合→收敛→去重排序 六环节闭环（5 轮 < 上限 6）', async () => {
  const retrieve = port(SMALL)
  const r = await runBigLoop({ baseQuery: 's-a', baseCandidates: [{ key: 'k-00' }], retrieve })

  // ① 检索：真按"上一轮线索产出的新查询"发出去的（顺序即证据）
  assert.deepEqual(
    retrieve.log.map((c) => c.query),
    ['s-a', 'q-01', 'q-02', 'q-03'],
    '第 1 轮问 baseQuery，其后**每轮都问上一轮线索给出的新查询**（链条断在哪一轮，这里一眼可见）',
  )
  assert.deepEqual(retrieve.log.map((c) => c.round), [1, 2, 3, 4], '轮次号必须逐轮递增')

  // ② 关联线索提取：线索进读数，且**决定**下一轮问什么
  assert.deepEqual(r.clues, ['q-01', 'q-02', 'q-03'], '抽到的线索必须是这三条（去重、升序）')
  assert.deepEqual(r.rounds.map((x) => x.clueGainAfter > 0), [true, true, true, true], '线索增益读数必须逐轮非零')
  assert.ok(!r.rounds[0].repeat, '第 1 轮问的是 baseQuery —— 那是**计划内**的一条查询，不是"没词了只好再说一遍"')

  // ③ 新查询：每轮恰产出一条（有界、可数）
  assert.deepEqual(r.rounds.map((x) => x.newQueries), [1, 1, 1, 0], '每轮产出的新查询数（最后一轮线索已耗尽）')
  assert.deepEqual(r.pendingQueries, [], '收敛时队列已空 —— 但不许把"还有待发"静默丢掉（见 ⑥）')

  // ④ 跨事件整合：同一键跨两轮出现 ⇒ 仍是**一行**（mergedRows < observations）
  assert.equal(r.observations, 6, '观测原子数 = 种子 1 + r1 的 1 + r2 的 2（k-01 再次出现）+ r3 的 1 + r4 的 1')
  assert.equal(r.mergedRows, 5, '去重后行数 = 5（k-01 进了两轮，只算一行 —— 这就是"进两次 ≠ 两条"）')
  assert.equal(r.multiRoundKeys, 1, '恰有一个键跨轮出现（k-01）')
  const k01 = r.merged.find((m) => m.key === 'k-01')
  assert.deepEqual(k01.rounds, [1, 2], 'k-01 的轮次表必须是 [1,2]（跨轮整合的落点）')
  assert.equal(k01.hits, 2, 'hits = 轮次数（不是观测条数）')
  assert.equal(k01.bestScore, 3, '跨轮的同道分取更强者（r2 的 score=3 > r1 的 1）')
  assert.deepEqual(k01.channels, ['dense', 'lexical'], '跨轮的通道面取并集（两个通道都要留痕）')

  // ⑤ 检测收敛：**自然停**，且与"达上限"不是同一个取值
  assert.equal(r.roundsRun, 4, '实测跑了 4 轮')
  assert.ok(r.roundsRun < r.knobs.maxRounds, `必须是"轮数 < 上限"的自然停（${r.roundsRun} < ${r.knobs.maxRounds}）`)
  assert.equal(r.status, 'converged', '状态必须是 converged')
  assert.equal(r.stopReason, 'clue-frontier-empty', '终止原因必须是"前沿为空"（点名，不是一句布尔）')
  assert.equal(r.capped, false, 'capped 必须为 false（与"达上限"不共用一个布尔）')
  assert.equal(r.reason, null, '收敛时 reason 必须为 null（非空只留给非收敛）')
  assert.equal(r.rounds[3].grewBy, 1, '最后一轮**确实带回了一个新键**（k-03）—— 停的原因不是"没有新键"，是"线索问完了"')
  assert.equal(r.rounds[3].newQueries, 0, '最后一轮一条新查询都产不出 ⇒ 前沿空')
  assert.deepEqual(r.frontier, [], '收敛后前沿必须为空')
  assert.equal(r.mergedRows, r.merged.length, 'mergedRows 与 merged.length 必须一致（同一事实两处不得漂）')
  assert.ok(r.mergedRows < r.observations, `端到端折叠率必须可数：${r.mergedRows} 行 < ${r.observations} 条观测`)

  // ⑥ 去重排序：确定序 = fused 降序（跨轮名次域），且与 RRF 的名次语义一致
  const fused = r.merged.map((m) => m.fused)
  assert.deepEqual([...fused].sort((a, b) => b - a), fused, 'merged 必须按 fused 降序（确定序）')
  // fused = Σ 每轮 1/(k+rank)：命中**两轮**的 k-01（1/62+1/63≈0.0320）必须压过
  // 只在**第 1 轮**露面的 k-00（1/61≈0.0164）—— 这正是"跨轮整合参与排序"的可断言形式。
  assert.equal(r.merged[0].key, 'k-01', '命中轮次最多的键排最前（fused 的语义）')
  assert.ok(r.merged[0].fused > r.merged.find((m) => m.key === 'k-00').fused, '两轮命中的分必须高于单轮命中的种子的分')
  assert.ok(r.consumed.includes('调用 4 次'), `consumed 读数必须带真实调用次数，实测「${r.consumed}」`)
  assert.ok(r.rounds.every((x) => !x.repeat), '本夹具每一轮都消费了新查询（0 条重试腿 —— 重试腿另有专门用例）')
  assert.deepEqual(r.rounds.map((x) => x.repeat), [false, false, false, false], '逐轮核对：没有一轮是"没词了再说一遍"')
})

// ── 3. 不收敛 ⇒ 硬上限显式停（防无界递归 = 活锁）─────────────────────────────
test('D2-③ 硬上限：每轮都带回新键 ⇒ 跑满上限后显式停，且调用次数 === maxRounds', async () => {
  const a = geometric()
  const r1 = await runBigLoop({ baseQuery: 's-x', baseKeys: ['m-0'], retrieve: a.retrieve, knobs: { maxRounds: 6 } })
  assert.equal(a.callsOf(), 6, '检索调用次数必须恰好等于 maxRounds（多一次即无界，少一次即提前静默停）')
  assert.equal(r1.roundsRun, 6)
  assert.equal(r1.status, 'capped', '状态必须是 capped（**与 converged 不是同一个值**）')
  assert.equal(r1.stopReason, 'max-rounds')
  assert.equal(r1.capped, true, 'capped 必须为 true')
  assert.ok(r1.reason && r1.reason.length > 0, '达上限必须给非空原因（不许静默继续）')
  assert.ok(r1.reason.startsWith(BIGLOOP_REASON_PREFIX), '失败/未收敛原因必须带公共前缀（可断言）')
  assert.ok(r1.reason.includes('未判定为收敛'), '措辞必须点明"没有判定为收敛"（"达上限"不得冒充收敛）')
  // ⚠ **只用缺省旋钮**（不传 growLimit/overlapLimit）：否则"三条自然判据打不着"就成了
  //   调用方自己关出来的，而不是夹具的结构性质。下面逐条把它们的实测值摆出来。
  assert.deepEqual(r1.knobs.growLimit, DEFAULT_BIGLOOP_KNOBS.growLimit, '本用例必须跑在**缺省**增长阈值下')
  assert.ok(
    r1.rounds.every((x) => x.growthRatio >= r1.knobs.growLimit),
    `增长读数必须**恒不低于**阈值（否则测到的是增长判据）：${JSON.stringify(r1.rounds.map((x) => x.growthRatio))}`,
  )
  assert.ok(
    r1.rounds.every((x) => x.observedOverlap < r1.knobs.overlapLimit),
    `饱和读数必须**恒低于**阈值：${JSON.stringify(r1.rounds.map((x) => x.observedOverlap))}`,
  )
  assert.deepEqual(r1.rounds.map((x) => x.rescanHits), [0, 0, 0, 0, 0, 0], '每轮返回的都是**全新**的键（无一重复）')
  // 最强的一条取证：**停机时前沿仍非空**（线索还问得出来）⇒ 停的原因只可能是轮次预算
  assert.ok(r1.frontier.length > 0, `停机时前沿必须**非空**（还有新问题没问），实测 ${r1.frontier.length} 个键`)
  assert.ok(r1.rounds[5].frontierAfter > 0, '最后一轮结束时前沿仍非空 ⇒ 三条自然判据一条都没触发，是硬上限停的')
  // **不静默丢**：停机时队列里还躺着没问的查询，且前沿非空 ⇒ 停是轮次预算说的，不是"没词了"
  assert.ok(r1.pendingQueries.length > 0, `停机时队列里必须还有没问完的查询（不静默丢），实测 ${r1.pendingQueries.length} 条`)
  assert.ok(r1.pendingQueries.every((q) => q.query && Array.isArray(q.from)), '待发查询必须带查询串与来源（provenance 可反查）')

  // 负向对拍（同进程 A/B）：上限真吃配置 ⇒ 换个数，读数跟着换（不是写死的 6）
  const b = geometric()
  const r2 = await runBigLoop({ baseQuery: 's-x', baseKeys: ['m-0'], retrieve: b.retrieve, knobs: { maxRounds: 2 } })
  assert.equal(b.callsOf(), 2, 'maxRounds=2 ⇒ 只许发 2 次')
  assert.equal(r2.status, 'capped')
  assert.equal(r2.roundsRun, 2)
  assert.notEqual(r1.mergedRows, r2.mergedRows, '两个上限下的产出必须可分辨（否则上限没被消费）')

  // ── 结构性上界：把上限开到 HARD_MAX，调用次数仍只由结构决定 ────────────────────
  // ⚠ 这一段**必须**用判据覆盖口把三条自然判据关掉，理由是一条可证的算术事实：
  //   "增长读数恒 ≥ 阈值"要求每轮新增量按比例放大 ⇒ 键总数指数增长 ⇒ 32 轮内必然
  //   在有限夹具上跌破阈值（首版实测：32 轮用例被撑成 62s 超时）。⇒ 想单独压"上限本身"，
  //   就只能把自然判据关掉。**这不是放宽**：本用例要证的是"上限存在且只能由它停"，
  //   而"三条自然判据都打不着时上限接管"已由上面 maxRounds=6 那一段在**缺省旋钮**下证过。
  const c = geometric(4, 48)
  const r3 = await runBigLoop({
    baseQuery: 's-x',
    baseKeys: ['m-0'],
    retrieve: c.retrieve,
    knobs: { maxRounds: HARD_MAX_ROUNDS, growLimit: 0, overlapLimit: 0, stopOnEmptyFrontier: false },
  })
  assert.equal(r3.status, 'capped', `HARD_MAX 下必须仍是显式停（若是 error，说明真发生了无界递归：${r3.reason}`)
  assert.equal(c.callsOf(), HARD_MAX_ROUNDS, '调用次数 === HARD_MAX_ROUNDS')
  assert.ok(c.callsOf() <= BIGLOOP_SAME_QUERY_CEILING, `同一查询的调用次数不得超过结构性上界 ${BIGLOOP_SAME_QUERY_CEILING}`)
})

// ── 4. 收敛可分辨：三种自然收敛 + 达上限 + 故障 + 两种没跑，七种取值互不同形 ─────
test('D2-④ 可分辨：三种自然收敛并列可达，且与 capped/error/disabled/no-candidate 取值互不相同', async () => {
  // 收敛 A：前沿为空（② 的形态）
  const a = await small()
  assert.equal(a.stopReason, 'clue-frontier-empty')
  // 收敛 B：增长低于阈值（已知面 10 个键、本轮只带回 1 个新键 ⇒ 0.1 < 0.25；
  //   而前沿**非空** ⇒ 它不是被"前沿空"影子掉的，是这条判据自己接住的）
  const b = await runBigLoop({
    baseQuery: 's-g',
    baseKeys: Array.from({ length: 10 }, (_, i) => `g-${String(i).padStart(2, '0')}`),
    retrieve: port({ 's-g': [{ key: 'g-new', clues: ['q-g'] }] }),
  })
  assert.equal(b.status, 'converged', '必须由**另一条显式判据**收敛，而不是静默停')
  assert.equal(b.stopReason, 'growth-below-threshold', `实测 ${b.stopReason}`)
  assert.equal(b.roundsRun, 1, '增长判据在第 1 轮即成立 ⇒ 恰跑一轮')
  assert.ok(b.frontier.length > 0, '此例前沿**非空** ⇒ 停的原因确实是增长（不是被"前沿空"影子掉）')
  assert.ok(b.rounds[0].growthRatio < b.knobs.growLimit, `增长读数 ${b.rounds[0].growthRatio} 必须 < 阈值 ${b.knobs.growLimit}`)
  // 收敛 C：**检索饱和**（本轮观测键里已知键占比 ≥ overlapLimit —— "新查询只带回老东西"）
  const sat = {
    's-sat': [
      { key: 'A', clues: ['qA'] },
      { key: 'B' },
    ],
    qA: [
      { key: 'A' },
      { key: 'B' },
      { key: 'C', clues: ['qC'] },
    ],
  }
  const c = await runBigLoop({ baseQuery: 's-sat', baseKeys: ['seed'], retrieve: port(sat), knobs: { overlapLimit: 0.6 } })
  assert.equal(c.stopReason, 'observed-saturation', `饱和判据必须独立可达，实测 ${c.stopReason}`)
  assert.equal(c.roundsRun, 2)
  assert.ok(c.rounds[1].observedOverlap >= 0.6, `第 2 轮观测重叠率 ${c.rounds[1].observedOverlap} 必须 ≥ 0.6`)
  assert.ok(c.frontier.length > 0, '此例前沿**非空**（C 是新键）⇒ 停的原因确实是饱和，不是前沿空')
  assert.equal(c.rounds[0].observedOverlap, 0, '第 1 轮的饱和读数必须显式记 0（该量在第 1 轮无基准，不得冒充测量值）')
  // **方向对照**（同一夹具、只改阈值）：同一个读数 0.667，阈值 0.6 时停、0.7 时不停 ⇒ 方向确为
  // "值越大越严格"（写反的话 0.7 反而会先停 —— 本用例就是为这一处立的）
  const strict = await runBigLoop({
    baseQuery: 's-sat',
    baseKeys: ['seed'],
    retrieve: port({ ...sat, qC: [] }),
    knobs: { overlapLimit: 0.7, growLimit: 0, stopOnEmptyFrontier: false },
  })
  assert.ok(strict.roundsRun > c.roundsRun, `阈值调高 = 更严格 ⇒ 必须停得更晚：实测 ${c.roundsRun} vs ${strict.roundsRun}`)
  assert.equal(strict.rounds[1].observedOverlap, c.rounds[1].observedOverlap, '同一夹具下该读数必须逐位相等（对照只改阈值）')

  // 达上限（③ 的形态）
  const d = geometric()
  const rd = await runBigLoop({ baseQuery: 's-x', baseKeys: ['m-0'], retrieve: d.retrieve, knobs: { maxRounds: 3 } })
  // 没跑：显式关闭 / 无候选
  const offLog = []
  const off = await runBigLoop({ baseQuery: 's-x', baseKeys: ['m-0'], retrieve: port({}, offLog), knobs: { enabled: false } })
  const noneLog = []
  const none = await runBigLoop({ baseQuery: 's-x', retrieve: port({}, noneLog) })
  // 故障
  const bad = await runBigLoop({
    baseQuery: 's-x',
    baseKeys: ['m-0'],
    retrieve: () => {
      throw new Error('socket hang up')
    },
  })

  const statuses = [a, b, c, rd, bad, off, none].map((x) => x.status)
  assert.deepEqual(statuses, ['converged', 'converged', 'converged', 'capped', 'error', 'disabled', 'no-candidate'], `七种情形必须各有其名，实测 ${statuses.join('/')}`)
  // 「没跑」两态必须与「跑了」两态**取值不同**（不许把"没跑"读成"收敛"）
  assert.equal(off.ran, false)
  assert.equal(none.ran, false)
  assert.equal(rd.ran, true)
  assert.equal(a.ran, true)
  for (const x of [off, none]) {
    assert.equal(x.stopReason, null, '没跑的运行没有终止原因（null，不是某个原因）')
    assert.deepEqual(x.rounds, [], '没跑 ⇒ 零轮次')
    assert.ok(x.reason && x.reason.length > 0, '没跑必须给非空原因（不许静默返回空）')
  }
  assert.notEqual(off.reason, none.reason, '「显式关闭」与「无候选」的原因措辞必须不同（两种事实不同形）')
  assert.equal(offLog.length + noneLog.length, 0, '没跑的两种情形都必须**一次检索都不发**')
  // 终止原因表完备：跑过的每一个 stopReason 都必须在表里，且表里的类别决定 status
  for (const x of [a, b, c, rd, bad]) {
    assert.ok(x.stopReason in BIGLOOP_TERMINALS, `终止原因 ${x.stopReason} 必须在 BIGLOOP_TERMINALS 里（不存在未命名的终止）`)
    assert.equal(x.status, BIGLOOP_TERMINALS[x.stopReason], 'status 必须由终止表的类别决定（不得另写一处）')
    assert.equal(x.capped, x.stopReason === 'max-rounds', 'capped 只在"达上限"时为真')
    assert.equal(x.reason === null, x.status === 'converged', 'reason 非空 ⇔ 非收敛')
  }
})

// ── 5. 跨轮合并幂等（"进两次 ≠ 两条"）────────────────────────────────────────
test('D2-⑤ 幂等：merge(obs ∪ obs) 逐字等于 merge(obs)，端到端与同轮去重两处并证', async () => {
  const obs = [
    { key: 'x', round: 0, score: 1, channels: ['a'], clues: ['c1'], clueState: 'string' },
    { key: 'x', round: 1, score: 2, channels: ['b'], clues: ['c2'], clueState: 'string' },
    { key: 'y', round: 1, score: 1, channels: [], clues: [], clueState: 'none' },
  ]
  const once = mergeCandidates(obs)
  const twice = mergeCandidates([...obs, ...obs])
  assert.deepEqual(twice, once, '同一批观测进两次必须与进一次**逐字相同**')
  assert.equal(JSON.stringify(twice), JSON.stringify(once), '逐字节相等（不是"看着差不多"）')
  const x = once.find((m) => m.key === 'x')
  assert.deepEqual(x.rounds, [0, 1])
  assert.equal(x.fused, fuseScore(0) + fuseScore(1), '同一轮只吃一次分量 ⇒ 3 条观测重放后 fused 不变')
  assert.equal(once.length, 2, '两个键两行')
  assert.equal(rankAcrossRounds(once).length, 2, '排序口径不得改变行数')
  assert.deepEqual(mergeCandidates([]), [], '空输入 ⇒ 空输出（N=0 显式记 0）')

  // 端到端：跨轮重复真的被折叠（不是只在纯函数上成立）
  const r = await small()
  assert.ok(r.mergedRows < r.observations, `端到端必须发生折叠：${r.mergedRows} 行 < ${r.observations} 条观测`)
  // 同轮重复：同一轮里同一个键来两次 ⇒ 折叠计数可查、行数不变
  const dupTable = {
    's-a': [
      { key: 'k-01', score: 1, clues: ['q-01'] },
      { key: 'k-01', score: 9, clues: ['q-01'] },
    ],
  }
  const r2 = await runBigLoop({ baseQuery: 's-a', baseCandidates: [{ key: 'k-00' }], retrieve: port(dupTable) })
  assert.equal(r2.rounds[0].dedupedInRound, 1, '同轮重复键必须**计数**（不是静默丢）')
  assert.equal(r2.rounds[0].observedCount, 1, '同轮同键只算一条观测')
  assert.equal(r2.rounds[0].rawCount, 2, '原始条数照记（rawCount 与 observedCount 必须可分辨）')
  const k1 = r2.merged.find((m) => m.key === 'k-01')
  assert.equal(k1.fused, fuseScore(1), '同轮重复不得让 fused 吃两次分量')
  assert.equal(k1.bestScore, 9, '同轮重复取更强者（分高者胜，确定序）')
  assert.equal(k1.rounds.length, 1, '同轮两次仍是一个轮次')
})

// ── 6. 退化面：显式关闭 / 无候选 / 检索腿抛错（**不吞**）──────────────────────
test('D2-⑥ 失败态可分辨：检索腿抛错保留原文并立即显式停，不重试、不静默降级', async () => {
  // 同步抛：第 1 轮就坏
  let calls1 = 0
  const r1 = await runBigLoop({
    baseQuery: 's-x',
    baseKeys: ['m-0'],
    retrieve: () => {
      calls1 += 1
      throw new Error('socket hang up')
    },
  })
  assert.equal(calls1, 1, '抛错后必须**立即停**（不重试）')
  assert.equal(r1.status, 'error')
  assert.equal(r1.stopReason, 'search-error')
  assert.equal(r1.capped, false)
  assert.equal(r1.roundsRun, 1)
  assert.equal(r1.rounds[0].status, 'error')
  assert.ok(r1.rounds[0].error.includes('socket hang up'), `原始错误文本必须进读数（不吞）：${r1.rounds[0].error}`)
  assert.ok(r1.reason.includes('socket hang up'), '失败原因必须带原始文本（否则"为什么坏"不可查）')
  assert.ok(r1.rounds[0].error.includes('s-x'), '失败读数必须点名是**哪条查询**坏的')
  assert.equal(r1.rounds[0].rawCount, 0, '失败轮的原始条数必须显式记 0（与"真的返回 0 条"分列在不同字段）')

  // 异步抛 + 返回非数组：两种坏法都必须落同一显式出口，且措辞可分辨
  const r2 = await runBigLoop({ baseQuery: 's-x', baseKeys: ['m-0'], retrieve: async () => { throw new Error('ECONNREFUSED 127.0.0.1:11434') } })
  assert.equal(r2.status, 'error')
  assert.ok(r2.reason.includes('ECONNREFUSED'), '异步抛的原文同样不得吞')
  const r3 = await runBigLoop({ baseQuery: 's-x', baseKeys: ['m-0'], retrieve: () => undefined })
  assert.equal(r3.status, 'error')
  assert.ok(r3.reason.includes('既不是数组'), `返回非数组必须点名，实测 ${r3.reason}`)

  // 部分成功：第 1 轮好、第 2 轮坏 ⇒ 前面轮次的产出**不许被丢掉**，且 ran 仍为 true
  let calls4 = 0
  const r4 = await runBigLoop({
    baseQuery: 's-x',
    baseKeys: ['m-0'],
    retrieve: (q, round) => {
      calls4 += 1
      if (round === 2) throw new Error('第 2 轮端口挂了')
      return [{ key: 'm-1', score: 1, clues: ['q-next'] }]
    },
  })
  assert.equal(calls4, 2, '坏在第 2 轮 ⇒ 恰好发 2 次')
  assert.equal(r4.status, 'error')
  assert.equal(r4.roundsRun, 2, '两轮的读数都要在（失败轮的读数不许因抛错而丢）')
  assert.equal(r4.rounds[0].status, 'ok')
  assert.equal(r4.rounds[1].status, 'error')
  assert.equal(r4.ran, true, '前一轮真的发出去过 ⇒ ran 必须为 true（ran 是"发过没有"，不是"跑完没有"）')
  assert.ok(r4.mergedRows >= 2, `失败前已整合出的键不许丢，实测 ${r4.mergedRows} 行`)
  assert.equal(r4.status !== 'converged' && r4.status !== 'capped', true, '故障必须与收敛/达上限两条都不同形')
})

// ── 7. 与 rrf.ts 的对拍：孪生常量 + 公式等价（不引依赖边，靠判据保证不漂）────────
test('D2-⑦ 对拍：融合常数与 rrf.ts 同值，且 fuseScore(round) === rrfTerm(round + 1)', async () => {
  const rrf = await import(RRF_SRC.href)
  assert.equal(BIGLOOP_RRF_K, rrf.RRF_DEFAULT_K, `孪生常数必须同值：大环路 ${BIGLOOP_RRF_K} vs rrf ${rrf.RRF_DEFAULT_K}`)
  for (const round of [0, 1, 2, 5, 31, 60, 500]) {
    assert.equal(
      fuseScore(round),
      rrf.rrfTerm(round + 1, rrf.RRF_DEFAULT_K),
      `第 ${round} 轮的融合分必须等于 RRF 的 rank ${round + 1}（轮次即名次域）`,
    )
  }
  // 整轮排序与 rrfFuse 的语义一致：某键在 r0 名次 1、r1 名次 2 ⇒ 与"两路融合"逐字同分
  const fused = rrf.rrfFuse(
    [
      { name: 'round0', keys: ['k', 'other'] },
      { name: 'round1', keys: ['other', 'k'] },
    ],
    rrf.RRF_DEFAULT_K,
  )
  const mine = mergeCandidates([
    { key: 'k', round: 0, score: 0, channels: [], clues: [], clueState: 'none' },
    { key: 'k', round: 1, score: 0, channels: [], clues: [], clueState: 'none' },
  ])[0]
  assert.equal(mine.fused, fused.find((x) => x.key === 'k').score, '跨轮融合分必须与 rrfFuse 的同名次之和逐字相等')
  // 单调性：越早出现分越高（早 = 名次靠前）
  assert.ok(fuseScore(0) > fuseScore(1) && fuseScore(1) > fuseScore(2), '轮次越早、融合分越高')
})

// ── 8. 候选形状非法：不得静默吞（"读不懂"与"本来没有"必须可分辨）───────────────
test('D2-⑧ 形状非法不静默：坏条目计数进读数、坏线索落 other，两者都不得读成"没有"', async () => {
  const noisy = {
    's-n': [
      { key: 'good-1', score: 1, channels: ['vector'], clues: ['q-1'] },
      { key: '' }, // 空键
      { key: 42 }, // 键不是字符串
      { key: 'bad-1', score: Number.NaN }, // 分不是有限数
      { key: 'bad-2', channels: 'vector' }, // 通道不是数组
      { key: 'bad-3', channels: [''] }, // 通道项是空串
      null,
      42,
    ],
  }
  const r = await runBigLoop({ baseQuery: 's-n', baseCandidates: [{ key: 'seed-1' }], retrieve: port(noisy) })
  assert.equal(r.rounds[0].malformed, 7, `七条形状非法的必须**逐条计数**（不许静默丢），实测 ${r.rounds[0].malformed}`)
  assert.equal(r.rounds[0].rawCount, 8, '原始条数照记（rawCount 与有效条数必须可分辨）')
  assert.equal(r.rounds[0].observedCount, 1, '只有 good-1 是有效候选')
  assert.ok(!r.merged.some((m) => m.key === '' || m.key === 'bad-1' || m.key === 'bad-2' || m.key === 'bad-3'), '坏条目不得进 merged')
  // 线索形状非法 ⇒ 'other'（有但抽不出来），**不得**读成 'none'（本来就没有），也不得据此编查询
  const badClues = { 's-b': [{ key: 'b-1', clues: 7 }, { key: 'b-2', clues: ['', 5] }] }
  const rb = await runBigLoop({ baseQuery: 's-b', baseKeys: ['seed-2'], retrieve: port(badClues) })
  const b1 = rb.merged.find((m) => m.key === 'b-1')
  const b2 = rb.merged.find((m) => m.key === 'b-2')
  assert.equal(b1.clueState, 'other', 'clues 非数组 ⇒ other（不是 none）')
  assert.equal(b2.clueState, 'other', 'clues 里有非字符串项 ⇒ other（不是 none）')
  assert.deepEqual(b1.clues, [], 'other 的线索列表为空 —— 但**状态**与 none 分列')
  assert.deepEqual(rb.pendingQueries, [], '抽不出来的线索不得被拿去编查询（那会伪造出"新问题"）')
  assert.ok(!rb.clues.includes(7) && !rb.clues.includes('7'), '坏线索的原文不得混进线索读数')
  // 'none' 与 'other' 必须可分辨：另一条真"没有线索"的候选状态是 none
  const rn = await runBigLoop({ baseQuery: 's-c', baseKeys: ['seed-3'], retrieve: port({ 's-c': [{ key: 'c-1' }] }) })
  assert.equal(rn.merged.find((m) => m.key === 'c-1').clueState, 'none', '本来就没有线索 ⇒ none')
  // 初始面里的坏条目同样计数（不许只在轮内计数）
  const rs = await runBigLoop({ baseQuery: 's-d', baseCandidates: [{ key: 'ok' }, { key: '' }, { key: 9 }], retrieve: port({}) })
  assert.equal(rs.seedMalformed, 2, `初始面的坏条目必须同样点名，实测 ${rs.seedMalformed}`)
})

// ── 9. 确定性与"读数不随规模膨胀"─────────────────────────────────────────────
test('D2-⑨ 确定性：同夹具重跑逐字相等（B 档 ms 显式归零），轮读数只有标量', async () => {
  const a = await small()
  const b = await small()
  assert.equal(JSON.stringify(stable(a)), JSON.stringify(stable(b)), '同一输入两次运行必须逐字相等（确定性；ms 是唯一的 B 档字段）')
  assert.equal(a.rounds.filter((x) => x.repeat).length, 0, '本夹具全程消费新查询（0 条重试腿）')
  assert.equal(a.rounds.filter((x) => !x.repeat).length, a.roundsRun, '每一轮都消费了新查询')

  // 「没有新问题可问」**不等于**「问完了」：把发放速率压到 0 ⇒ 队列恒空、前沿恒非空
  // ⇒ 必须走**重试腿**（重复同一句）并由硬上限显式停，而不是静默停（活锁形态的分辨点）。
  const retryLog = []
  const retry = await runBigLoop({
    baseQuery: 's-a',
    baseCandidates: [{ key: 'k-00' }],
    retrieve: port(SMALL, retryLog),
    knobs: { maxNewQueriesPerRound: 0, maxRounds: 3, growLimit: 0, overlapLimit: 0 },
  })
  assert.equal(retry.rounds.filter((x) => x.repeat).length, 2, '速率 0 ⇒ 第 1 轮之后的两轮全是重试腿（每轮都真的又发了一次检索）')
  assert.deepEqual(retryLog.map((c) => c.query), ['s-a', 's-a', 's-a'], '重试腿重复的是**上一条**查询（不是编一句新的）')
  assert.equal(retry.status, 'capped', '重试腿不会静默停：只能由硬上限显式停')
  assert.equal(retry.capped, true)
  assert.ok(retry.frontier.length > 0, '此时前沿**非空**（线索还在，只是没被发放）⇒ "前沿空"与"没发放"两件事可分辨')
  assert.equal(retry.rounds[2].clueInputKeys, 1, '重试腿仍真的做了线索提取（读数是活的，不是空转）')
  // 读数不随规模膨胀：轮读数里不得塞"这一轮见到了哪些键"这类随规模增长的数组
  for (const round of a.rounds) {
    for (const [k, v] of Object.entries(round)) {
      if (k === 'from') continue
      if (v === null) continue // null 是本模块的"无值"记号（不是数组、不随规模增长）
      assert.notEqual(typeof v, 'object', `轮读数字段 ${k} 不得是数组/对象（读数须与规模无关）`)
    }
  }
  // overlapRatio / sumClueGain 两个纯函数的边界面（N=0 ⇒ 0，不抛）
  assert.equal(overlapRatio([], new Set(['x'])), 0, '空集的重叠率显式记 0（G5）')
  assert.equal(overlapRatio(['x'], new Set()), 0, '已知集为空 ⇒ 0')
  assert.equal(overlapRatio(['x', 'y'], new Set(['x'])), 0.5, '半命中 ⇒ 0.5')
  assert.equal(sumClueGain([]), 0, '无线索 ⇒ 增益 0')
  assert.equal(sumClueGain(['ab', 'ab']), sumClueGain(['ab']), '重复线索不重复计增益（幂等）')
  assert.equal(sumClueGain(['a', 'b']), sumClueGain(['b', 'a']), '与顺序无关（内部先排序）')
})

// ── 10. 数值边界：越界即抛，不静默 clamp ────────────────────────────────────
test('D2-⑩ 边界：越界即抛（不静默 clamp），上界内逐值可跑', async () => {
  // ⚠ `runBigLoop` 是 async：入参非法在函数体内抛 ⇒ 表现为**拒绝的 Promise**。
  //   故用 `assert.rejects`（`assert.throws` 在这里既抓不到、又会留下 unhandledRejection）。
  const base = { baseQuery: 's-x', baseKeys: ['m-0'], retrieve: () => [] }
  for (const maxRounds of [0, -1, 1.5, HARD_MAX_ROUNDS + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      runBigLoop({ ...base, knobs: { maxRounds } }),
      /maxRounds/,
      `maxRounds=${String(maxRounds)} 必须抛（不静默 clamp 成 1 或上限）`,
    )
  }
  for (const overlapLimit of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(runBigLoop({ ...base, knobs: { overlapLimit } }), /overlapLimit/, `overlapLimit=${String(overlapLimit)} 必须抛`)
  }
  for (const growLimit of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(runBigLoop({ ...base, knobs: { growLimit } }), /growLimit/, `growLimit=${String(growLimit)} 必须抛`)
  }
  for (const maxNewQueriesPerRound of [-1, 65, 2.5]) {
    await assert.rejects(
      runBigLoop({ ...base, knobs: { maxNewQueriesPerRound } }),
      /maxNewQueriesPerRound/,
      `maxNewQueriesPerRound=${String(maxNewQueriesPerRound)} 必须抛`,
    )
  }
  await assert.rejects(runBigLoop({ ...base, baseQuery: '   ' }), /baseQuery/, '空查询必须抛（③ 的起点不可缺）')
  await assert.rejects(runBigLoop({ baseQuery: 's-x', retrieve: null }), /retrieve/, '检索端口缺失必须抛（不是静默空跑）')
  // 判据覆盖口（overrides）也必须过同一道校验 —— 它不能成为绕过边界的地方
  await assert.rejects(runBigLoop({ ...base, overrides: { knobs: { maxRounds: 999 } } }), /maxRounds/, 'overrides 不得绕过边界校验')
  // 上界内逐值可跑（判据不把边界判成"全都抛"）
  const ok = await runBigLoop({ ...base, knobs: { maxRounds: HARD_MAX_ROUNDS } })
  assert.equal(ok.knobs.maxRounds, HARD_MAX_ROUNDS, '上界值本身是合法的，且**原样**生效（没有被悄悄改小）')
  assert.equal(ok.status, 'converged', '检索恒返回空 + 前沿空 ⇒ 第 1 轮即显式收敛（不是静默、也不是 capped）')
  assert.equal(ok.stopReason, 'clue-frontier-empty')
  assert.equal(ok.roundsRun, 1, '一轮即判停（上限 32 未被吃满 ⇒ 自然判据先说话）')
})

// ── 11. 语料无关不变量：换一套完全不同形状的语料，两条方向都判 ─────────────────
test('D2-⑪ 语料无关：换形状后仍收敛，且键集**两向**精确（不多造、不丢漏）', async () => {
  const corpus = {
    'seed::root': [
      { key: 'node::a', channels: ['dense', 'lexical'], clues: ['vec://q?a'] },
      { key: 'node::b', channels: ['graph'], clues: ['vec://q?b'] },
    ],
    'vec://q?a': [{ key: 'node::c', channels: ['dense'], clues: ['vec://q?c'] }],
    'vec://q?b': [{ key: 'node::c', channels: ['graph'] }],
    'vec://q?c': [],
  }
  const r = await runBigLoop({ baseQuery: 'seed::root', baseKeys: ['node::seed'], retrieve: port(corpus) })
  // 方向一：不得**丢漏**（每个真出现过的键都必须在 merged 里）
  const expected = ['node::seed', 'node::a', 'node::b', 'node::c']
  for (const k of expected) assert.ok(r.merged.some((m) => m.key === k), `键 ${k} 不得丢漏`)
  // 方向二：不得**多造**（merged 里不得有语料之外的键）
  const corpusKeys = new Set(['node::seed', 'node::a', 'node::b', 'node::c'])
  for (const m of r.merged) assert.ok(corpusKeys.has(m.key), `不得凭空造出键 ${m.key}`)
  assert.deepEqual(r.merged.map((m) => m.key).sort(), expected.slice().sort(), '键集必须两向精确相等')
  // 同一键由**两条不同线索**带出 ⇒ 跨轮折叠（node::c 在 r2/r3 各出现一次）
  const c = r.merged.find((m) => m.key === 'node::c')
  assert.deepEqual(c.rounds, [2, 3], `node::c 必须被两条来源各带出一次并折成一行，实测 ${JSON.stringify(c.rounds)}`)
  assert.deepEqual(c.channels, ['dense', 'graph'], '跨轮的通道面取并集（两种通道都要留痕）')
  assert.equal(r.status, 'converged')
  assert.equal(r.roundsRun, 3, '问完即收敛（第 3 轮带回的全部是老键 ⇒ 增长为 0）')
  assert.ok(r.rounds[2].rescanHits >= 1, '第 3 轮的键里必须有"已被见过"的（这就是跨轮整合的读点）')
})
