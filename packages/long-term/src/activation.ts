/**
 * ACT-R 激活方程（**A2-1 / A2-2 的实现者**）。
 *
 * 真源：`docs/mana-v5-plan.md:333-370`（§5.1 陈述性记忆激活机制 + 检索概率与延迟计算）。
 * 判据真源：`docs/mana-rollout-plan.md:516`（A2-1）、`:517`（A2-2）。
 * 参考算法：pyactup 2.2.5 的声明性记忆子集（方案 §3.2 决策：**参考算法、TypeScript 自研**，
 *   不引跨语言运行时）—— 故本文件是自研实现，pyactup 只作公式形态的对照物。
 *
 * ── 公式 ──────────────────────────────────────────────────────────────────
 *   A = B + S + P + ε                                        （v5:334）
 *   B = ln( Σ_j t_j^(-d) )      t_j 单位**秒**               （v5:337-339）
 *   P = 部分匹配惩罚（默认 0）                                 （v5:345）
 *   ε ~ Logistic(0, s)，s = √3·σ/π                            （v5:347-348）
 *   P(检索) = 1 / (1 + exp(-(A - τ)/s))                       （v5:365）
 *   lat = A ≥ τ ? F·e^(-f·A)·1000 : F·e^(-f·τ)·1000           （v5:367-369）
 *
 * ⚠ **钳位语义**（rollout:517 明文要求"夹具标签必须写明"，否则读者会误以为 −3 与 −2 应得两个不同的数）：
 *   `lat` 在 `A < τ` 时**按公式钳到 τ** ⇒ `lat(−3,τ=−2)` 与 `lat(−2,τ=−2)` **逐位同值**。
 *   这不是 bug、不是取整巧合，是 v5:369 的 else 分支；判据 `lat(A=−2,τ=−2)=1733.561349` 取的就是钳位分支的值。
 *
 * ⚠ **B 的单位是秒、decay 的单位是天**：两者不可相乘（C14「同一条记忆被两家乘过」）。
 *   `tests/activation.test.mjs` 判据 ② 的"同形腿"专门机检 `baseLevel` 必须**纯幂律**。
 *
 * ⚠ **ε 不得用 Math.random()**（本仓「夹具绿 ≠ 真数据绿」纪律）：
 *   `baseLevel`/`retrievalProbability`/`latencyMs` 三个函数**确定性、无 RNG** ——
 *   判据要"固定夹具复算"，任何 RNG 都会让 A2-1/A2-2 变成抛硬币。
 *   随机性只在 `noiseTerm(rng)` 里**显式传入 rng**（默认 `Math.random`，测试传固定序列）。
 */
import { D, TAU, S_NOISE, LATENCY_F, LATENCY_F_SCALE } from './params.ts'

/**
 * 基础激活 `B = ln( Σ_j t_j^(-d) )`（v5:337）。
 *
 * @param practiceTimes 该记忆历次**访问至今**的时间，单位**秒**；每个元素须 `> 0`。
 * @param d 衰减指数，缺省 0.5（`params.D`）。
 * @returns B。**空集合返回 `-Infinity`**（v5:163「未编码的 chunk 不参与检索」的数学形态）。
 *
 * ⚠ **空集合为什么返回 -Infinity 而不是 0**：`ln(0) = -Infinity` 是公式的真实极限，
 *   返回 0 会造出"从未被访问的记忆与刚访问过的记忆同等激活"的假象（静默假绿）。
 *   `-Infinity` 在 `retrievalProbability` 里得到 0、在 `latencyMs` 里得到钳位值 —— 下游行为正确。
 *   ⚠ **但 `-Infinity` 进 JSON 会变成 `null`**（与 `skeleton.test.mjs:68` 记的"undefined 被 JSON 静默丢键"同族）
 *   ⇒ 落库/序列化前须由调用方转成显式哨兵（B3.2 的三路检索负责），本函数不做隐式替换。
 *
 * ⚠ `t_j → 0` 时该项 `→ +Infinity` ⇒ `B = +Infinity`。这是**数学定义域边界**，不是错误，
 *   故意不抛（"刚刚访问过"在极限上确实无穷激活）。`Number.isFinite` 的消费者须自行处理。
 *   `t_j < 0` 才是**真错误**（`t^(-0.5)` 是虚数，实测 `Math.pow(-1,-0.5) = NaN` ⇒ 静默 NaN）⇒ 抛。
 */
export function baseLevel(practiceTimes: readonly number[], d: number = D): number {
  if (!Number.isFinite(d)) throw new Error(`baseLevel: d 必须是有限数（实测 ${String(d)}）`)
  if (!Array.isArray(practiceTimes)) throw new Error('baseLevel: practiceTimes 必须是数组')
  if (practiceTimes.length === 0) return Number.NEGATIVE_INFINITY
  let sum = 0
  for (const t of practiceTimes) {
    if (!Number.isFinite(t) || t < 0) {
      throw new Error(
        `baseLevel: 练习时间 t_j 必须是 ≥ 0 的有限数（实测 ${String(t)}）—— ` +
          't_j < 0 时 t^(-d) 是虚数（Math.pow 实测得 NaN），静默 NaN 会污染整条链',
      )
    }
    sum += Math.pow(t, -d)
  }
  return Math.log(sum)
}

/** 关联激活 `S = Σ_k W_k·S_kj`（v5:341-343）。缺省 0（无关联源）。 */
export function associativeActivation(sources: readonly { weight: number; strength: number }[] = []): number {
  let sum = 0
  for (const s of sources) sum += s.weight * s.strength
  return sum
}

/**
 * 噪声项 `ε ~ Logistic(0, s)`，`s = √3·σ/π`（v5:347-348）。
 *
 * ⚠ `rng` **显式传入**（缺省 `Math.random`）：判据要确定性，随机源必须可替换。
 *   逆变换采样：`ε = s·ln(u/(1-u))`，`u ∈ (0,1)`。`u` 取端点会得 ±Infinity ⇒ 强行夹到开区间内。
 */
export function noiseTerm(rng: () => number = Math.random): number {
  const raw = rng()
  if (!Number.isFinite(raw)) throw new Error(`noiseTerm: rng 必须返回有限数（实测 ${String(raw)}）`)
  // u ∈ (0,1) 开区间：端点会让 ln(u/(1-u)) 发散。
  const u = Math.min(Math.max(raw, Number.EPSILON), 1 - Number.EPSILON)
  return S_NOISE * Math.log(u / (1 - u))
}

/**
 * 总激活 `A = B + S + P + ε`（v5:334）。
 *
 * ε 缺省 **0**（不传即"期望值口径"）—— 判据锚点全部是 ε=0 的闭式值；
 * 需要随机性时由调用方显式传 `noise`（其值来自 `noiseTerm(rng)`，可复现）。
 */
export function activation(opts: {
  practiceTimes: readonly number[]
  associative?: number
  partialMatch?: number
  noise?: number
  d?: number
}): number {
  const b = baseLevel(opts.practiceTimes, opts.d ?? D)
  return b + (opts.associative ?? 0) + (opts.partialMatch ?? 0) + (opts.noise ?? 0)
}

/**
 * 检索概率 `P = 1/(1+exp(-(A-τ)/s))`（v5:365）。
 *
 * @param a 总激活值 A；@param tau 阈值 τ（缺省 -2.0）；@param s 逻辑尺度（缺省派生量 `√3σ/π`）。
 * ⚠ `s` **可覆盖但不得被误填成 σ**：填 `σ=0.3` 会让 `P(A=τ+1)` 从 0.997638 变成 0.965555
 *   （差 3.2e-2 ≫ 1e-6）—— 见 `params.ts` 的 `S_NOISE` 注释与测试判据 ③ 的反向对照。
 */
export function retrievalProbability(a: number, tau: number = TAU, s: number = S_NOISE): number {
  if (!Number.isFinite(a)) {
    // A = -Infinity（未编码）⇒ P = 0；A = +Infinity（t_j→0）⇒ P = 1。数学极限，非错误。
    if (a === Number.NEGATIVE_INFINITY) return 0
    if (a === Number.POSITIVE_INFINITY) return 1
    throw new Error(`retrievalProbability: A 必须是数（实测 ${String(a)}）`)
  }
  return 1 / (1 + Math.exp(-(a - tau) / s))
}

/**
 * 检索延迟 `lat`（毫秒，v5:367-369）。
 *
 * ⚠ **钳位**：`A < τ` 时**按公式钳到 τ** ⇒ `lat(−3,τ=−2) === lat(−2,τ=−2)` **逐位相等**（v5:369 else 分支）。
 *   判据锚点 `lat(A=−2,τ=−2)=1733.561349 ms` 走的正是钳位分支
 *   （`0.35 × e^(0.8×2) × 1000 = 1733.5613485…`，与册中逐字相同）。
 *   ⚠ 因钳位，`lat` 关于 A **单调非增**（存在平坦段），**不是严格递减** ——
 *   判据里的"单调性"必须按非严格写，写成 `<` 会得到一条**永远为假的断言**（本席实跑复现，见 handoff 第 4 段）。
 */
export function latencyMs(a: number, tau: number = TAU): number {
  if (Number.isNaN(a)) throw new Error('latencyMs: A 不得为 NaN')
  if (Number.isNaN(tau)) throw new Error('latencyMs: tau 不得为 NaN')
  const effective = a >= tau ? a : tau
  return LATENCY_F * Math.exp(-LATENCY_F_SCALE * effective) * 1000
}
