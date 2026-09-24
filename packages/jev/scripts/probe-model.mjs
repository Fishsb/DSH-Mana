#!/usr/bin/env node
/**
 * JEV **适配就绪度探针**（B1.3 交付物 · 模型无关框架的对偶件）。
 *
 * ## 用途（一句话）
 * 用户把 JEV 模型配好（拉下来 / 换掉 / 改量化）之后，**一条命令**就能知道
 * 「这个模型能不能承载单 token yes/no 判定」——不必等 agent、不必看代码。
 *
 * ## 用法
 * ```bash
 * node packages/jev/scripts/probe-model.mjs                      # 探 Config 缺省模型
 * node packages/jev/scripts/probe-model.mjs --model qwen3.5:2b   # 探指定模型
 * node packages/jev/scripts/probe-model.mjs --json               # 机读输出
 * node packages/jev/scripts/probe-model.mjs --endpoint http://127.0.0.1:11434
 * ```
 * 退出码：`0` = **可用**（判定运行且未饱和）· `1` = **降级**（连不上/HTTP 错/无 logprobs/无 yes-no 族）
 *        · `2` = **可用但饱和**（pYes 贴着 0 或 1 ⇒ 无区分度，判不了"有点相关"和"很相关"）。
 *
 * ## 它判什么（四条，全部有实测读数）
 * ① **可达 + 单 token 原语可用**：`/api/chat` 带 `logprobs:true` 能取到 pos0 候选；
 * ② **yes/no 族命中**：pos0 里有 yes 或 no（含 `Yes`/`no` 大小写变体）；
 * ③ **不饱和**：同一个模型对语义相反的句子**必须给出不同概率**
 *    （太近 ⇒ 无区分度；贴 0/1 ⇒ 概率无信息，方案禁 `qwen3:8b` 就是因为它 "yes"=1.000）；
 * ④ **守恒**：`pYes + pNo + Σunmatched === Σ exp(全部候选)`（差 ≤1e-9）—— 有 token 被静默丢弃时必现。
 *
 * ⚠ 探针**只测量、不调优**：不换模型、不改提示词、不做模型选型结论。
 *   它把"模型好不好"变成一次可复现的读数，交给人判断 —— 这正是本轮"框架与适配解耦"的目的。
 */
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')
const mod = await import(pathToFileURL(join(SRC, 'ollama.ts')).href)
const { judgeWithOllama, JEV_DEFAULT_MODEL, OLLAMA_DEFAULT_ENDPOINT, DEGRADED_REASONS } = mod

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const MODEL = arg('model', JEV_DEFAULT_MODEL)
const ENDPOINT = arg('endpoint', OLLAMA_DEFAULT_ENDPOINT)
const JSON_OUT = argv.includes('--json')
/** 饱和判据：与 0/1 的距离小于该值即视为"概率无信息"。 */
const SATURATION_EPS = Number(arg('saturation-eps', '0.001'))
/** 区分度判据：语义相反两句的 pYes 差小于该值即视为"无区分度"。 */
const DISCRIMINATION_MIN = Number(arg('discrimination-min', '0.2'))

/**
 * 探测集：**一组语义相反的对子**。
 * 为什么用对子而不是单句：单句只能证明"能跑"，对子才能证明"概率携带信息"
 * （两句给出同一个 pYes ⇒ 该模型的概率对判定无用，哪怕它没报错）。
 */
const PAIRS = [
  { name: 'clear-true', state: 'the sky is blue on a clear day', want: 'yes' },
  { name: 'clear-false', state: 'the sky is green on a clear day', want: 'no' },
  { name: 'numeric', state: '2 + 2 = 4', want: 'yes' },
  { name: 'nonsense', state: 'purple sleep quietly the of', want: 'no' },
]
const QUESTION = 'Is the statement true? Answer strictly yes or no.'

const line = (s = '') => process.stdout.write(`${s}\n`)

async function main() {
  line(`[probe] endpoint=${ENDPOINT}  model=${MODEL}`)
  const results = []
  for (const p of PAIRS) {
    const t0 = Date.now()
    const out = await judgeWithOllama({ state: p.state, question: QUESTION, endpoint: ENDPOINT, model: MODEL })
    results.push({ ...p, out, wallMs: Date.now() - t0 })
  }

  const degraded = results.filter((r) => r.out.degraded)
  const ok = results.filter((r) => !r.out.degraded)

  // ① 可达 + 原语可用
  if (ok.length === 0) {
    line(`[probe] ✗ 不可用：${results.length}/${results.length} 次全部降级`)
    for (const r of results.slice(0, 2)) line(`         reason: ${r.out.reason}`)
    line(`         提示：Ollama 未启动 / 端口不对 / 模型未拉取（ollama pull ${MODEL}）`)
    return report({ status: 'degraded', model: MODEL, endpoint: ENDPOINT, ok: 0, total: results.length, results, exit: 1 })
  }

  // ② yes/no 族命中 + ④ 守恒
  const conservation = []
  for (const r of ok) {
    const n = r.out.normalization
    const all = r.out.candidates.reduce((a, c) => a + Math.exp(c.logprob), 0)
    const un = n.unmatched.reduce((a, c) => a + Math.exp(c.logprob), 0)
    conservation.push(Math.abs(n.pYes + n.pNo + un - all))
  }
  const worstConservation = Math.max(...conservation, 0)

  // ③ 不饱和 + 区分度
  const probs = ok.map((r) => r.out.probability)
  const saturation = Math.max(...probs.map((p) => Math.min(p, 1 - p))) // 越接近 0 越饱和
  const ys = ok.filter((r) => r.want === 'yes').map((r) => r.out.probability)
  const ns = ok.filter((r) => r.want === 'no').map((r) => r.out.probability)
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const gap = ys.length && ns.length ? mean(ys) - mean(ns) : null

  line('')
  line('  样本                    value   pYes      候选(pos0)')
  for (const r of results) {
    const o = r.out
    const top = o.candidates.map((c) => `${c.token}:${c.logprob.toFixed(3)}`).join(' ')
    line(
      `  ${r.name.padEnd(22)} ${String(o.value).padEnd(7)} ` +
        `${o.probability === null ? 'null' : o.probability.toFixed(4)}    ${top || `[${o.reason}]`}`,
    )
  }
  line('')
  line(`  可用样本      : ${ok.length}/${results.length}（降级 ${degraded.length}）`)
  line(`  饱和读数      : min(p,1-p) 最小值 = ${saturation.toFixed(6)}（阈值 ${SATURATION_EPS}）`)
  line(`  区分度        : mean(pYes|真句) − mean(pYes|假句) = ${gap === null ? 'n/a' : gap.toFixed(4)}（阈值 ${DISCRIMINATION_MIN}）`)
  line(`  和守恒最大偏差: ${worstConservation.toExponential(3)}（容差 1e-9）`)
  line(`  墙钟          : ${results.map((r) => r.wallMs).join(' / ')} ms  ⚠ B 档浮动量，不进任何阈值`)

  const fails = []
  if (worstConservation > 1e-9) fails.push(`和守恒被破坏（${worstConservation.toExponential(3)} > 1e-9）⇒ 有 token 被静默丢弃`)
  if (degraded.length > 0) fails.push(`${degraded.length} 个样本降级（如 ${degraded[0].out.reason}）`)
  const saturated = saturation < SATURATION_EPS
  const noDiscrimination = gap !== null && Math.abs(gap) < DISCRIMINATION_MIN

  line('')
  if (fails.length) {
    line(`[probe] ✗ 不合格：${fails.join('；')}`)
    return report({ status: 'fail', model: MODEL, endpoint: ENDPOINT, ok: ok.length, total: results.length, saturation, gap, conservation: worstConservation, results, exit: 1 })
  }
  if (saturated || noDiscrimination) {
    if (saturated) line(`[probe] ⚠ 可用但**饱和**：概率贴 ${saturation < 0.5 ? 0 : 1}（min(p,1-p)=${saturation.toExponential(3)}）⇒ 概率不携带信息`)
    if (noDiscrimination) line(`[probe] ⚠ 可用但**无区分度**：语义相反的两组给出近乎相同的 pYes（gap=${gap.toFixed(4)}）`)
    line(`         含义：模块能跑、留痕正常，但"有点相关"与"很相关"分不开 —— 适配前请先换/调模型。`)
    return report({ status: 'saturated', model: MODEL, endpoint: ENDPOINT, ok: ok.length, total: results.length, saturation, gap, conservation: worstConservation, results, exit: 2 })
  }
  line(`[probe] ✓ 可用：判定运行、yes/no 命中、概率有区分度（gap=${gap.toFixed(4)}）、和守恒 ${worstConservation.toExponential(3)}`)
  return report({ status: 'ok', model: MODEL, endpoint: ENDPOINT, ok: ok.length, total: results.length, saturation, gap, conservation: worstConservation, results, exit: 0 })
}

function report(o) {
  if (JSON_OUT) {
    process.stdout.write(
      JSON.stringify(
        {
          status: o.status,
          model: o.model,
          endpoint: o.endpoint,
          okSamples: o.ok,
          totalSamples: o.total,
          saturation: o.saturation ?? null,
          discriminationGap: o.gap ?? null,
          conservationMaxError: o.conservation ?? null,
          samples: o.results.map((r) => ({
            name: r.name,
            value: r.out.value,
            pYes: r.out.probability,
            degraded: r.out.degraded,
            reason: r.out.reason,
            want: r.want,
          })),
          note: 'B 档浮动量（latency）不入阈值列；本探针只测量、不调优',
          degradedReasons: DEGRADED_REASONS,
        },
        null,
        2,
      ) + '\n',
    )
  }
  process.exit(o.exit)
}

await main()
