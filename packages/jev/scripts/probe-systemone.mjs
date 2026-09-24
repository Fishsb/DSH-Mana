#!/usr/bin/env node
/**
 * 真 JEV 通道**就绪度探针**（B1.4 交付物 · 用户可复跑自测命令）。
 *
 * ## 一句话用途
 * 「jev 模型配好了没有」⇒ **一条命令**给出可复现读数，不必等 agent、不必看代码。
 *
 * ## 用法
 * ```bash
 * set -a; . ~/jev/.env; set +a                 # key 在 ~/jev/.env（不进 shell 环境，需显式注入）
 * node packages/jev/scripts/probe-systemone.mjs            # 探真通道（noul 正/反 + choice 三例）
 * node packages/jev/scripts/probe-systemone.mjs --json     # 机读输出
 * node packages/jev/scripts/probe-systemone.mjs --multi    # 额外演示「一次调用多问」
 * node packages/jev/scripts/probe-systemone.mjs --model jev-latest
 * ```
 * 退出码：`0` = 就绪（A 档锚点全过）· `1` = **未就绪**（无凭据 / 连不上 / 读数偏离锚点）。
 *
 * ## 它判什么（A 档锚点，与 `~/jev/jev_client.py selftest` 同口径）
 * ① noul **正向** `> 0.5`、② noul **反向** `< 0.5`（两条一起才证明"概率有区分度"）、
 * ③ choice 三例取值正确（bug / feature / question）、④ 契约面映射正确
 * （noul ⇒ yes/no + 概率；choice ⇒ `unknown` + `null` 且**取值不丢**）。
 *
 * 成本与延迟是 **B 档浮动量** ⇒ 只**打印**，**不**参与任何通过判据。
 * key **永不回显**：只打印环境变量名与长度。
 */
import {
  judgeWithSystemone,
  resolveSystemoneCredential,
  SYSTEMONE_DEFAULT_ENDPOINT,
  SYSTEMONE_DEFAULT_ENV_FILE,
  SYSTEMONE_DEFAULT_MODEL,
  SYSTEMONE_API_KEY_ENV,
  SYSTEMONE_DEFAULT_PATH,
} from '../src/systemone.ts'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(`--${f}`)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const JSON_OUT = has('json')
const WITH_MULTI = has('multi')
const MODEL = arg('model', SYSTEMONE_DEFAULT_MODEL)
const ENDPOINT = arg('endpoint', SYSTEMONE_DEFAULT_ENDPOINT)

// 凭据解析：**与真通道判据同一个入口**（环境变量 → $JEV_ENV_FILE → ~/jev/.env）
const cred = resolveSystemoneCredential()
if ('missing' in cred) {
  console.error(
    `[probe-systemone] 未就绪：拿不到凭据。试过 ${cred.tried.join(' → ')}\n` +
      `  ① 用户配置位（应由你维护，600）：${SYSTEMONE_DEFAULT_ENV_FILE}\n` +
      `  ② 或注入环境变量：set -a; . ~/jev/.env; set +a\n` +
      `  ③ 或指定别处：JEV_ENV_FILE=/path/to/.env\n` +
      `  复跑：node ${process.argv[1]}${WITH_MULTI ? ' --multi' : ''}`,
  )
  process.exit(1)
}
const key = cred.key

const NL = { type: 'noul', instructions: '是否紧急或时间敏感？' }
const CRITERIA = { bug: '报错崩溃', feature: '功能请求', question: '使用咨询' }

const CASES = [
  { name: 'noul-正向', state: '系统崩了三天无法收款，紧急！', questions: { v: NL }, want: 'positive' },
  { name: 'noul-反向', state: '有个错别字，不着急，有空再说。', questions: { v: NL }, want: 'negative' },
  { name: 'choice-bug', state: '装了插件启动直接崩溃报错。', questions: { v: { type: 'choice', instructions: '归类', criteria: CRITERIA } }, want: 'bug' },
  { name: 'choice-feature', state: '希望增加深色模式。', questions: { v: { type: 'choice', instructions: '归类', criteria: CRITERIA } }, want: 'feature' },
  { name: 'choice-咨询', state: '请问 API 速率限制是多少？', questions: { v: { type: 'choice', instructions: '归类', criteria: CRITERIA } }, want: 'question' },
]

/** 逐条判：返回 `{ok, detail}`；**不抛**（降级读数本身就是要给人看的结论）。 */
function grade(c, out) {
  if (out.degraded) return { ok: false, detail: `降级 · ${out.reason}` }
  if (c.want === 'positive') {
    return { ok: out.probability > 0.5 && out.value === 'yes', detail: `noul=${out.probability} value=${out.value}（锚点 >0.5）` }
  }
  if (c.want === 'negative') {
    return { ok: out.probability < 0.5 && out.value === 'no', detail: `noul=${out.probability} value=${out.value}（锚点 <0.5）` }
  }
  const got = out.answers?.v?.choice
  return {
    ok: got === c.want && out.value === 'unknown' && out.probability === null,
    detail: `choice=${got}（期望 ${c.want}）· value=${out.value} · prob=${out.probability} · conf=${out.answers?.v?.confidence}`,
  }
}

const results = []
for (const c of CASES) {
  const t0 = Date.now()
  const out = await judgeWithSystemone({
    state: c.state,
    questions: c.questions,
    primaryQuestion: 'v',
    model: MODEL,
    endpoint: ENDPOINT,
    apiKey: key,
    source: 'probe-systemone',
  })
  const g = grade(c, out)
  results.push({ ...c, ...g, value: out.value, probability: out.probability, choice: out.answers?.v?.choice, costUsd: out.costUsd, ms: Date.now() - t0, reason: out.reason, servedModel: out.servedModel })
}

let multi = null
if (WITH_MULTI) {
  const out = await judgeWithSystemone({
    state: '系统崩了三天无法收款，紧急！',
    questions: { urgent: NL, kind: { type: 'choice', instructions: '归类', criteria: CRITERIA } },
    primaryQuestion: 'urgent',
    model: MODEL,
    endpoint: ENDPOINT,
    apiKey: key,
    source: 'probe-systemone',
  })
  multi = {
    ok: !out.degraded && Object.keys(out.answers ?? {}).length === 2 && out.probability > 0.5,
    detail: out.degraded ? `降级 · ${out.reason}` : `answers=${Object.keys(out.answers).join('|')} urgent=${out.answers.urgent?.noul} kind=${out.answers.kind?.choice}`,
    costUsd: out.costUsd,
    ms: out.latencyMs,
  }
}

const failed = results.filter((r) => !r.ok).length + (multi && !multi.ok ? 1 : 0)

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        endpoint: `${ENDPOINT}${SYSTEMONE_DEFAULT_PATH}`,
        modelRequested: MODEL,
        modelServed: results.find((r) => r.servedModel)?.servedModel ?? null,
        apiKeyEnv: SYSTEMONE_API_KEY_ENV,
        credentialSource: cred.from,
        apiKeyLength: key.length, // 只给长度：**不回显 key**
        ready: failed === 0,
        failed,
        results: results.map(({ name, ok, detail, value, probability, choice, costUsd, ms }) => ({ name, ok, detail, value, probability, choice, costUsd, ms })),
        multi,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`[probe-systemone] 端点 ${ENDPOINT}${SYSTEMONE_DEFAULT_PATH} · 模型 ${MODEL}`)
  console.log(`[probe-systemone] 凭据 来源 ${cred.from} · 变量名 ${SYSTEMONE_API_KEY_ENV}（长度 ${key.length}，**不回显**）`)
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(16)} ${r.detail}  ${r.ms}ms cost=${r.costUsd ?? '-'}`)
  if (multi) console.log(`  ${multi.ok ? 'PASS' : 'FAIL'}  ${'multi-多问同调'.padEnd(16)} ${multi.detail}  ${multi.ms}ms cost=${multi.costUsd ?? '-'}`)
  const served = results.find((r) => r.servedModel)?.servedModel
  console.log(`[probe-systemone] 服务端自报模型：${served ?? '(未取到)'}`)
  console.log(`[probe-systemone] ${failed === 0 ? '就绪：A 档锚点全过' : `**未就绪**：${failed} 条不达锚点`}（成本/延迟为 B 档浮动量，仅供测量条件说明）`)
}
process.exit(failed === 0 ? 0 : 1)
