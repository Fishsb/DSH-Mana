/**
 * `mana-long-term` ACT-R 激活方程判据（B3.1）。
 *
 * ⚠ **本文件与 `skeleton.test.mjs` 的分工（不是替代关系，两份都必须过）**：
 *   · `skeleton.test.mjs` —— **形态面**：effect 恰好 3 条、不写 `mana_trace`、不导出 `Config`、
 *     G9 直通链完好。它防的是"空壳偷偷长出行为"。
 *   · **本文件** —— **事实面**：ACT-R 闭式锚点（A1-5 / A2-1 / A2-2）与**唯一写者**（C14）。
 *     它防的是"实现算错 / 参数被第二处复制"。
 *   两份合起来才覆盖"本包现在是什么样"；任何一份红了都不许只改另一份来变绿。
 *
 * ── 为什么每条锚点都要配**负向对拍**（本席硬纪律） ─────────────────────────────
 *   "判据绿 ≠ 事实被检查"。只断言 `decay(14)≈0.5` 时，若实现**硬编码** `return 0.5` 照样绿。
 *   故每条锚点都附一条**扰动腿**：动一个参数 ⇒ 断言**必须**报红。
 *   扰动腿本身也是断言（`assert.ok(!near(...))`），不是注释 —— 注释不会红。
 *
 * ── 夹具语义（rollout:517 明文要求写明）──────────────────────────────────────
 *   `lat` 在 `A < τ` 时按公式**钳到 τ** ⇒ `lat(−3,τ=−2)` 与 `lat(−2,τ=−2)` **逐位同值**。
 *   这不是巧合、不是取整，是 `docs/mana-v5-plan.md:369` 的 else 分支。
 *   故"单调性"只能断言**非严格**（存在平坦段）；写成严格 `<` 会得到一条**永远为假**的断言。
 *
 * ⚠ **本文件的用例数本身也是判据**（与 skeleton.test.mjs 同口径）：实测**空文件**在显式路径下
 *   同样报 `# tests 1 / # pass 1 / exit 0`（计的是"文件加载成功"）⇒ 空/被截断的文件是**假绿**。
 *   故本文件固定 **9** 条，末条为用例计数自检（少一条即红）。
 *   ⚠ 计数与 `verify.mjs` 的 `EXPECTED_CASES`（8 → **9**）**必须同步**：
 *     `verify.mjs` 用 `/^test\(/gm` 数字符串，写错数量会在 `npm run verify -w dsh-mana-long-term` 报红。
 *
 * 运行（**显式路径**）：node --test packages/long-term/tests/activation.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../src/', import.meta.url)
const load = (f) => import(new URL(f, SRC).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const f6 = (x) => Number(x).toFixed(6)

const params = await load('params.ts')
const { decay } = await load('decay.ts')
const { baseLevel, retrievalProbability, latencyMs, noiseTerm, activation, associativeActivation } =
  await load('activation.ts')
const { TAU, SIGMA, S_NOISE, D, LATENCY_F, LATENCY_F_SCALE, HALF_LIFE_DAYS } = params

const EXPECTED_CASES = 9
let ran = 0

// ══ ① A1-5 时间衰减三锚点（判据原文 `docs/mana-rollout-plan.md:455`）══════════
test('① A1-5 时间衰减三锚点 + 负向对拍（h=14 → 7 必须偏离）', () => {
  ran += 1
  const got = [
    ['decay(0)', decay(0), 1.0],
    ['decay(14)', decay(14), 0.5],
    ['decay(90)', decay(90), 0.011609],
  ]
  for (const [label, g, w] of got) {
    assert.ok(near(g, w), `${label} = ${g}（${f6(g)}），应 ${w}，绝对差须 ≤ 1e-6`)
  }
  // 缺省半衰期必须来自 params（单一出处），不是调用点自带的 14。
  assert.equal(HALF_LIFE_DAYS, 14, '半衰期缺省值须为 14 天（A1-5 冻结锚点）')
  assert.equal(decay(14), decay(14, HALF_LIFE_DAYS), '显式传 HALF_LIFE_DAYS 与缺省必须同值')

  // ── 负向对拍（改参数 ⇒ 必须报红；此处用断言把"必须红"钉住）──
  const perturbed = decay(14, 7)
  assert.ok(
    !near(perturbed, 0.5),
    `负向对拍：h=7 时 decay(14) 必须偏离 0.5，实测 ${perturbed} —— 若仍为 0.5，说明 halfLifeDays 参数被忽略（硬编码 14）`,
  )
  assert.ok(near(perturbed, 0.25), `h=7 ⇒ 14 天恰好两个半衰期 ⇒ 0.25，实测 ${perturbed}`)
  assert.ok(!near(decay(90, 7), 0.011609), '负向对拍：h=7 的 decay(90) 必须偏离锚点')

  // ── 判据腿的「齿」在**实现面**的同一条律（A1-5 清账：两侧不得一强一弱）──────────
  // ⚠ 上面两条负向对拍只钉住「h=7 时三个数变成 0.25 那一组」；一个把 h **用错**的核
  //   （如 h→h²）也可能凑出「不等」。故这里补**自洽式**（与 decayKernelTeeth 的
  //   `consumes-half-life` 牙判**同一条律**）：f(t,h₂) = f(t,h₁)^(h₁/h₂)。
  //   这是「判据腿不得弱于实现面」在本包侧的落点 —— 两条腿各自独立可归因。
  const atFrozen = decay(14, 14)
  const atProbe = decay(14, 7)
  assert.ok(
    near(atProbe, Math.pow(atFrozen, 14 / 7), 1e-12),
    `h 自洽式：decay(14,7) 须 = decay(14,14)^(14/7)=0.25，实测 ${atProbe}（对照 ${Math.pow(atFrozen, 14 / 7)}）`,
  )
  assert.notEqual(atProbe, atFrozen, 'h 参数必须真被消费；同值即"死旋钮核"（与 budgetChars 同一形态）')

  // ── 时钟回拨：t<0 必须抛（fail-closed），不得给出 >1 的"假留存率" ──
  // ⚠ 判据腿的 `rejects-negative-time` 牙在真核上判的就是这条；实现面必须自己也有。
  assert.throws(() => decay(-7), /不得为负/, 't<0（时钟回拨）必须抛 —— 否则会静默给出 >1 的假留存率污染排序')
  assert.throws(() => decay(1, 0), /halfLifeDays 必须是正有限数/, 'h<=0 必须抛（会得 Infinity/NaN）')
})

// ══ ② A2-1 基础激活四锚点 + 幂律同形腿（C14：不得再乘一次时间衰减）══════════
test('② A2-1 基础激活四锚点 + 幂律同形腿（不得被第二套衰减乘过）', () => {
  ran += 1
  const anchors = [
    ['B{[1]}', baseLevel([1]), 0.0],
    ['B{[1,2]}', baseLevel([1, 2]), 0.5348],
    ['B{[1,2,4,8]}', baseLevel([1, 2, 4, 8]), 0.940265],
    ['B{[1,1]}', baseLevel([1, 1]), 0.693147],
  ]
  assert.ok(anchors.length >= 3, '判据表要求 **≥3 组**固定夹具')
  for (const [label, g, w] of anchors) {
    assert.ok(near(g, w), `${label} = ${g}（${f6(g)}），应 ${w}，绝对差须 ≤ 1e-6`)
  }

  // ── 同形腿（本包专属：C14「同一条记忆被两家乘过」）──
  // 纯幂律的两个**精确**签名：任何额外的指数衰减因子都会破坏它们。
  assert.equal(baseLevel([1]), 0, 'B{[1]} 必须**精确**为 0（t^(-d)=1 ⇒ ln 1 = 0）—— 任何额外衰减因子都会让它偏离 0')
  const exact = -D * Math.log(2)
  assert.ok(
    near(baseLevel([2]), exact, 1e-15),
    `B{[2]} 必须精确等于 -d·ln2 = ${exact}（纯幂律签名），实测 ${baseLevel([2])}`,
  )
  assert.ok(near(baseLevel([4]), -2 * D * Math.log(2), 1e-15), 'B{[4]} 必须精确等于 -2d·ln2（纯幂律签名）')

  // ── 负向对拍：d 必须是参数，不是硬编码 ──
  const perturbed = baseLevel([1, 2], 0.3)
  assert.ok(!near(perturbed, 0.5348), `负向对拍：d=0.3 的 B{[1,2]} 必须偏离锚点，实测 ${perturbed}`)
  // ── 边界：空集合 = 未编码 ⇒ ln(0) = -Infinity（**不得**静默返回 0）──
  assert.equal(baseLevel([]), Number.NEGATIVE_INFINITY, '空练习集合必须返回 -Infinity（未编码不参与检索）')
  assert.throws(() => baseLevel([-1]), /不得|必须/, 't_j < 0 必须抛（Math.pow 会静默得 NaN）')
})

// ══ ③ A2-2 检索概率 + s≠σ 反向对照 ════════════════════════════════════════════
test('③ A2-2 检索概率三锚点 + s 是由 σ 派生的尺度（s≠σ 反向对照）', () => {
  ran += 1
  assert.ok(near(S_NOISE, 0.165399), `s = √3·σ/π 须为 0.165399，实测 ${S_NOISE}`)
  assert.ok(near(S_NOISE, (Math.sqrt(3) * SIGMA) / Math.PI, 1e-15), 's 必须由 σ 派生（√3σ/π），不得独立配置')

  const p = [
    ['P(A=τ)', retrievalProbability(TAU), 0.5],
    ['P(A=τ+1)', retrievalProbability(TAU + 1), 0.997638],
    ['P(A=τ−1)', retrievalProbability(TAU - 1), 0.002362],
  ]
  for (const [label, g, w] of p) {
    assert.ok(near(g, w), `${label} = ${g}（${f6(g)}），应 ${w}`)
  }

  // ── 反向对照：把 σ 误当 s 直接代入 ⇒ 必须偏离锚点（差 3.2e-2 ≫ 1e-6）──
  const wrong = retrievalProbability(TAU + 1, TAU, SIGMA)
  assert.ok(
    !near(wrong, 0.997638),
    `反向对照：以 σ=0.3 当 s 时 P(A=τ+1) 必须**不**等于锚点 0.997638，实测 ${wrong}（${f6(wrong)}）—— 若相等说明 s 的派生式已丢`,
  )
  assert.ok(near(wrong, 0.965555), `以 σ 当 s 的期望错值应为 0.965555，实测 ${wrong}`)

  // ── 单调性（严格）：P 关于 A 严格递增 ──
  let prev = -Infinity
  for (let a = -4; a <= 4.0001; a += 0.25) {
    const v = retrievalProbability(a)
    assert.ok(v > prev, `P 必须关于 A 严格递增，A=${a} 处实测 ${v} ≤ 前值 ${prev}`)
    prev = v
  }
})

// ══ ④ A2-2 延迟：钳位语义 + 单调**非严格** ═══════════════════════════════════
test('④ A2-2 延迟二锚点 + 钳位语义（A−3 与 A−2 逐位同值）+ 单调非严格', () => {
  ran += 1
  assert.ok(near(latencyMs(0, TAU), 350.0), `lat(A=0,τ=−2) 须为 350.000000 ms，实测 ${latencyMs(0, TAU)}`)
  assert.ok(
    near(latencyMs(-2, TAU), 1733.561349),
    `lat(A=−2,τ=−2) 须为 1733.561349 ms，实测 ${latencyMs(-2, TAU)}（${f6(latencyMs(-2, TAU))}）`,
  )
  // 册中值的闭式复算：F·e^(−f·τ)·1000 = 0.35 × e^1.6 × 1000
  const closed = LATENCY_F * Math.exp(-LATENCY_F_SCALE * TAU) * 1000
  assert.ok(near(closed, 1733.561349, 1e-6), `册中值须可闭式复现：0.35×e^1.6×1000 = ${closed}`)

  // ── 钳位语义（判据表明文要求写明的那条）──
  assert.equal(
    latencyMs(-3, TAU),
    latencyMs(-2, TAU),
    'A<τ 时按公式钳到 τ ⇒ lat(−3) 与 lat(−2) 必须**逐位同值**（v5:369 else 分支）',
  )
  assert.equal(latencyMs(-99, TAU), latencyMs(TAU, TAU), '钳位对任意 A<τ 成立（不只 −3）')

  // ── 单调性：**非严格**（钳位造出平坦段）；且 A ≥ τ 段内**严格**递减 ──
  let prev = Infinity
  for (let a = -6; a <= 4.0001; a += 0.25) {
    const v = latencyMs(a, TAU)
    assert.ok(v <= prev, `lat 必须关于 A **非增**，A=${a} 处实测 ${v} > 前值 ${prev}`)
    prev = v
  }
  prev = Infinity
  for (let a = TAU; a <= 4.0001; a += 0.25) {
    const v = latencyMs(a, TAU)
    assert.ok(v < prev, `A ≥ τ 段内 lat 必须**严格**递减，A=${a} 处实测 ${v} ≥ 前值 ${prev}`)
    prev = v
  }
  // ── 负向对拍：把钳位写严（对 A<τ 用严格递减断言）必然为假 —— 把它钉成事实，防后人改错断言 ──
  assert.ok(
    !(latencyMs(-3, TAU) < latencyMs(-2, TAU)),
    '负向对拍：对 A<τ 写严格递减断言**恒为假** —— 这是钳位的必然后果，不是缺陷',
  )
})

// ══ ⑤ 收敛口径：一个 s 同时用于概率与噪声（C14）+ 噪声可复现 ═════════════════
test('⑤ 收敛口径：概率与噪声共用同一个 s，且噪声可复现（无隐式 RNG）', () => {
  ran += 1
  // 概率面：A=τ 时与 s 无关（0.5）—— 单独的"0.5"抓不到 s 被改；故另用 A=τ+1 钉住 s 值。
  assert.ok(near(retrievalProbability(TAU, TAU, S_NOISE), 0.5), 'P(A=τ) = 0.5 与 s 无关')
  assert.ok(near(retrievalProbability(TAU + 1, TAU, S_NOISE), 0.997638), 'P(A=τ+1) 钉住 s ≈ 0.165399')

  // 噪声面：逆变换采样 ε = s·ln(u/(1−u))。取 u 使 ln(u/(1−u)) = 1 ⇒ ε 必须**精确**等于 s。
  const uForOne = 1 / (1 + Math.exp(-1))
  assert.ok(
    near(noiseTerm(() => uForOne), S_NOISE, 1e-15),
    `ε(u: ln(u/(1−u))=1) 必须精确等于 s=${S_NOISE}，实测 ${noiseTerm(() => uForOne)} —— 这条腿把"概率与噪声共用同一个 s"钉死`,
  )
  // 中位数 u=0.5 ⇒ ε=0
  assert.equal(noiseTerm(() => 0.5), 0, 'ε 的中位数必须为 0（Logistic(0,s) 对称）')
  // 可复现：同 rng 序列 ⇒ 同输出（**不得**有隐式 Math.random 混入）
  const seq = [0.1, 0.3, 0.5, 0.7, 0.9]
  const mk = () => { let i = 0; return () => seq[i++ % seq.length] }
  // ⚠ rng **每个序列只建一次**：若每次调用都 mk()（计数器重置），序列永不前进 ⇒ 五次数同值，
  //   「双侧」那条断言会假红 —— 本席实跑踩过，故把 rng 建在 map 之外。
  const r1 = mk()
  const r2 = mk()
  const a1 = seq.map(() => noiseTerm(r1))
  const a2 = seq.map(() => noiseTerm(r2))
  assert.deepEqual(a1, a2, '同 rng 序列必须给出同噪声序列（可复现）')
  assert.ok(a1.some((v) => v < 0) && a1.some((v) => v > 0), '噪声须双侧（Logistic 无偏）')
  // 负向对拍：把 σ 当 s 用 ⇒ 噪声与概率**不再共尺度**
  assert.ok(
    !near(noiseTerm(() => uForOne), SIGMA, 1e-6),
    '负向对拍：噪声尺度必须**不是** σ（否则概率面与噪声面各用一个尺度，即 C14 想防的分裂）',
  )
})

// ══ ⑥ 导出面被挖空即红（反"实现被搬走"）══════════════════════════════════════
test('⑥ 导出面逐个断言（实现被搬走/改名 ⇒ 必红）', async () => {
  ran += 1
  const mod = await load('index.ts')
  assert.equal(typeof mod.name, 'string', 'name 必须导出')
  assert.ok(Array.isArray(mod.inject), 'inject 必须导出')
  assert.equal(typeof mod.apply, 'function', 'apply 必须导出')
  const names = mod.IMPLEMENTED_EXPORTS
  assert.ok(Array.isArray(names) && names.length > 0, 'IMPLEMENTED_EXPORTS 必须非空（否则本判据会平凡通过）')
  const expected = [
    'decay',
    'baseLevel',
    'associativeActivation',
    'activation',
    'noiseTerm',
    'retrievalProbability',
    'latencyMs',
  ]
  assert.deepEqual([...names].sort(), [...expected].sort(), 'IMPLEMENTED_EXPORTS 必须逐名在册（与本文件断言集互覆盖）')
  for (const n of expected) {
    assert.equal(typeof mod[n], 'function', `导出 ${n} 必须是函数（被搬走/改名即红）`)
  }
  assert.equal(typeof mod.ACTR_PARAMS, 'object', 'ACTR_PARAMS 必须导出（参数快照）')
  assert.equal(mod.ACTR_PARAMS.d, D, 'ACTR_PARAMS.d 必须与 params.D 一致')
  assert.ok(mod.Config === undefined, 'B3.1 仍未推翻"不导出 Config"（新增能力全是纯函数，无真旋钮）')
})

// ══ ⑦ 参数单一出处：6 个冻结参数不得在 params.ts 之外重现（C14 唯一写者）═════
test('⑦ 参数单一出处：冻结参数不得在 params.ts 之外以字面量重现（C14）', () => {
  ran += 1
  const strip = (s) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // 块注释
      .replace(/\/\/[^\n]*/g, ' ') // 行注释
      .replace(/`(?:[^`\\]|\\.)*`/g, '""') // 模板串
      .replace(/'(?:[^'\\\n]|\\.)*'/g, '""') // 单引号串
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""') // 双引号串
  const PATTERNS = [
    [/(?<![\d.])14(?![\d.])/, 'HALF_LIFE_DAYS = 14'],
    [/(?<![\d.])0\.5(?![\d.])/, 'D = 0.5'],
    [/(?<![\d.])0\.3(?![\d.])/, 'SIGMA = 0.3'],
    [/(?<![\d.])2\.0(?![\d.])/, 'TAU = -2.0'],
    [/(?<![\d.])0\.35(?![\d.])/, 'LATENCY_F = 0.35'],
    [/(?<![\d.])0\.8(?![\d.])/, 'LATENCY_F_SCALE = 0.8'],
  ]
  const offenders = []
  const scanned = []
  for (const f of readdirSync(fileURLToPath(SRC))) {
    if (!f.endsWith('.ts') || f === 'params.ts') continue // params.ts 是唯一允许处
    scanned.push(f)
    const src = strip(readFileSync(fileURLToPath(new URL(f, SRC)), 'utf8'))
    for (const [re, label] of PATTERNS) {
      if (re.test(src)) offenders.push(`${f}: ${label}`)
    }
  }
  // 自证本腿真的扫到了文件（0 文件 = 平凡通过）
  assert.ok(scanned.length >= 3, `本腿须真扫到源文件，实测 ${scanned.length} 个：${JSON.stringify(scanned)}`)
  assert.deepEqual(
    offenders,
    [],
    `冻结参数只许出现在 params.ts（C14 唯一写者）。实测在以下位置重现：${JSON.stringify(offenders)}。` +
      '若确需在别处出现 ⇒ 说明参数有了第二个源，改一处不会改另一处',
  )
  // ── 负向对拍：把 params.ts 的 14 搬到别处，本腿必须能抓到（对**扫描器自身**做变异）──
  const synthetic = strip('const HALF = 14\n') // 模拟"第二个源"
  assert.ok(
    PATTERNS[0][0].test(synthetic),
    '负向对拍：扫描器必须能识别裸字面量 14 —— 若这里不红，说明剥离/正则已失效（本腿会退化为恒绿）',
  )
  // 剥注释后**不得**再把注释里的数字算成违规（否则本文件那些写着 0.5/14 的说明注释会造出假红）
  assert.ok(!PATTERNS[0][0].test(strip('// 半衰期 14 天\n/* 0.5 */\n')), '注释里的参数值不得被算成违规（防假红）')
})

// ══ ⑧ 真装配：判据经**运行时服务面**复算 + 卸载即净 ══════════════════════════
test('⑧ 真装配：服务面可复算锚点 + behavior=active + 卸载后服务消失', async () => {
  ran += 1
  const ctx = new Context()
  // 与 skeleton.test.mjs 同口径：ROOT = packages/，按**目录名**装载 sibling 包。
  const ROOT = new URL('../../', import.meta.url)
  const coreMod = await import(new URL('core/src/index.ts', ROOT).href)
  const mod = await load('index.ts')
  ctx.plugin(coreMod, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-b31-')), 'mana.db') })
  await settle(200)
  const fiber = ctx.plugin(mod)
  await settle(300)

  const svc = ctx.get('mana-long-term')
  assert.ok(svc, 'mana-long-term 服务必须可读（未 provide = 插件没真跑起来）')
  const st = svc.status()
  assert.equal(st.behavior, 'active', `B3.1 已填实现 ⇒ behavior 必须为 'active'，实测 ${st.behavior}`)
  assert.equal(st.wired, true)

  // 经**服务面**（不是直接 import）复算三组锚点 —— 防"导出对了但没接进服务面"。
  const A = svc.activation
  assert.ok(near(A.decay(14), 0.5), `服务面 decay(14) 须为 0.5，实测 ${A.decay(14)}`)
  assert.ok(near(A.baseLevel([1, 2, 4, 8]), 0.940265), `服务面 B{{[1,2,4,8]}} 须为 0.940265，实测 ${A.baseLevel([1, 2, 4, 8])}`)
  assert.ok(near(A.latencyMs(-2, -2), 1733.561349), `服务面 lat(−2,−2) 须为 1733.561349，实测 ${A.latencyMs(-2, -2)}`)
  assert.equal(A.decay, mod.decay, '服务面须复用同一实现（不得另起一份）')
  assert.equal(A.params.halfLifeDays, 14, '服务面须吐出参数快照')
  assert.equal(A.activation({ practiceTimes: [1] }), 0, 'A = B + S + P + ε，ε 缺省 0 ⇒ A{[1]} = 0')

  await fiber.dispose()
  await settle(300)
  assert.equal(ctx.get('mana-long-term'), undefined, '卸载后服务必须消失（"卸载即净"）')
})

// ══ ⑨ 用例计数自检 + 判据自身未被掏空 ═════════════════════════════════════════
test('⑨ 用例计数自检 + 锚点字面量在册（防本文件被截断/掏空）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const declared = (self.match(/^test\(/gm) ?? []).length
  assert.equal(declared, EXPECTED_CASES, `本文件 test( 声明数须为 ${EXPECTED_CASES}，实测 ${declared}`)
  for (const anchor of ['0.011609', '1733.561349', '0.997638', '0.002362', '0.940265']) {
    assert.ok(self.includes(anchor), `锚点 ${anchor} 必须写在本文件里（判据被换成软断言即红）`)
  }
  for (const helper of ['assert.ok(', 'assert.equal(']) {
    assert.ok(self.split(helper).length - 1 >= 10, `${helper} 调用数过少（判据被掏空即红）`)
  }
  void assert
})
