/**
 * dsh-mana-jev · B1.4 **真通道腿** —— 对 `jev-1.13` 本体发真请求（`/api/v1/systemone`）。
 *
 * ## 为什么单独一个目录（`tests/live/`）
 * 零网络是 根目录 tests 下的**硬纪律**（拔网线仍须全绿）。真通道判据**必然**要联网，
 * 混在一起只有两种结局：要么零网络纪律被稀释，要么真通道判据被静默跳过。
 * ⇒ 分目录 + **分命令**：根 `npm test` 的 glob 只扫 `packages/<包>/tests/` 的**第一层**，
 *   不会扫到本目录；本文件只由显式命令跑。
 *
 * ## ⚠ 无凭据 ⇒ **显式红**（`assert.fail`），**绝不静默跳过**
 * 实测过的假绿形态：「不可达就 `return`」⇒ 离线时 `exit 0 / 11 pass / skipped 0`，
 * 而外部闸照抄旧文案仍说"非 skip"。⇒ 本文件的每一条都以 `requireCredential()` 开头，
 * 它**要么返回真 key，要么 `assert.fail`**（没有第三条路）。S1-18 那条离线判据
 * 用源码扫描把"必须有 assert.fail、不得出现 skip"钉住，所以这条纪律不是注释承诺。
 *
 * ## 凭据从哪来
 * `~/jev/.env` 里是 **OS 环境变量之外的第二处**（该文件由用户维护，600 权限）。本文件
 * **不读它**：要么环境变量在，要么红。用户可复跑命令里给出 `set -a; . ~/jev/.env; set +a` 的注入写法。
 * **key 永不回显**（只可能出现在请求头里；诊断输出只给长度与端点）。
 *
 * ## A 档锚点（与 `~/jev/jev_client.py selftest` 同口径）
 * noul 正向 `>0.5`、反向 `<0.5`、choice 三例取值正确（bug/feature/question）。
 * 成本与延迟是 **B 档浮动量**，只作 `t.diagnostic` 打印，**不进任何阈值断言**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after } from 'node:test'

const SYS = new URL('../../src/systemone.ts', import.meta.url).href
const CORE = new URL('../../../core/src/index.ts', import.meta.url).href

const {
  judgeWithSystemone,
  resolveSystemoneCredential,
  parseEnvFile,
  SYSTEMONE_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_ENDPOINT,
  SYSTEMONE_API_KEY_ENV,
  SYSTEMONE_DEFAULT_ENV_FILE,
  SYSTEMONE_ALLOWED_MODELS,
} = await import(SYS)

const dirs = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/**
 * 凭据：**要么真 key，要么显式红**。
 *
 * ⚠ 与探针 `scripts/probe-systemone.mjs` **同一个解析入口**（`resolveSystemoneCredential`）：
 *   实测踩过一次"探针能过、判据全红" —— 因为两处各自读凭据（一处环境变量、一处别的来源）。
 *   同源入口后，两者**结构上**不可能再分叉。
 * ⚠ 顺序：环境变量 → `$JEV_ENV_FILE` → `~/jev/.env`（用户配置位，只读；**key 永不回显**）。
 */
function requireCredential() {
  const cred = resolveSystemoneCredential()
  if ('missing' in cred) {
    assert.fail(
      `真通道判据拿不到凭据：试过 ${cred.tried.join(' → ')} —— ` +
        '**本判据不静默跳过**（没有凭据就是没验证过，必须红）。' +
        `\n  ① 该文件应由用户维护（600），本判据默认读它：${SYSTEMONE_DEFAULT_ENV_FILE}` +
        `\n  ② 或注入环境变量：set -a; . ~/jev/.env; set +a` +
        `\n  ③ 或指定别处：JEV_ENV_FILE=/path/to/.env` +
        `\n  复跑：node --test ${new URL(import.meta.url).pathname}`,
    )
  }
  return cred.key
}

async function tempDb() {
  const core = await import(CORE)
  const dir = mkdtempSync(join(tmpdir(), 'mana-jev-live-'))
  dirs.push(dir)
  const db = new DatabaseSync(join(dir, 'mana.db'))
  core.createSchema(db)
  const rows = () => db.prepare('SELECT result_value, probability, degraded, cost_usd FROM jev_log ORDER BY rowid').all()
  return { db, rows, close: () => db.close() }
}

const LIVE_TIMEOUT_MS = 60_000

/** 真调一次（key 从环境变量来；**不经手、不回显**）。 */
function liveJudge(options, extra = {}) {
  return judgeWithSystemone({
    apiKey: requireCredential(),
    timeoutMs: LIVE_TIMEOUT_MS,
    ...extra,
    ...options,
  })
}

/** 真通道不可达/HTTP 错时给出**可读的红**（而不是一句 "degraded"）。 */
function assertNotDegraded(out, label) {
  assert.equal(
    out.degraded,
    false,
    `${label} 不得降级；reason=${out.reason}（若为 httpError，先看 reason 里的服务端正文——401=凭据、400=模型名/请求形态）`,
  )
  assert.equal(out.reason, null, `${label} 正常路径 reason 必须为 null`)
}

test('L1 真通道 · noul **正向**：紧急陈述 ⇒ noul > 0.5（A 档锚点，与用户 selftest 同口径）', async (t) => {
  const out = await liveJudge({
    state: '系统崩了三天无法收款，紧急！',
    questions: { v: { type: 'noul', instructions: '是否紧急或时间敏感？' } },
    primaryQuestion: 'v',
  })
  assertNotDegraded(out, 'noul 正向')
  assert.equal(out.value, 'yes', `noul=${out.probability} 必须 > 0.5 ⇒ yes（实测基准 ~0.97）`)
  assert.ok(out.probability > 0.5, `A 档锚点：正向必须 >0.5，实测 ${out.probability}`)
  assert.equal(out.channel, 'systemone')
  assert.ok(String(out.servedModel).includes('jev-1.13'), `服务端自报模型必须含 jev-1.13：${out.servedModel}`)
  t.diagnostic(`[L1] url=${SYSTEMONE_DEFAULT_ENDPOINT} model=${out.servedModel} noul=${out.probability} ${out.latencyMs}ms cost=${out.costUsd}`)
})

test('L2 真通道 · noul **反向**：不着急 ⇒ noul < 0.5（与 L1 构成"有区分度"的证据）', async (t) => {
  const out = await liveJudge({
    state: '有个错别字，不着急，有空再说。',
    questions: { v: { type: 'noul', instructions: '是否紧急或时间敏感？' } },
    primaryQuestion: 'v',
  })
  assertNotDegraded(out, 'noul 反向')
  assert.equal(out.value, 'no', `noul=${out.probability} 必须 < 0.5 ⇒ no（实测基准 ~0.06）`)
  assert.ok(out.probability < 0.5, `A 档锚点：反向必须 <0.5，实测 ${out.probability}`)
  t.diagnostic(`[L2] noul=${out.probability} ${out.latencyMs}ms cost=${out.costUsd}`)
})

test('L3 真通道 · choice 三例取值全对（bug / feature / question）且取值**不丢**（degraded=false）', async (t) => {
  const CRITERIA = { bug: '报错崩溃', feature: '功能请求', question: '使用咨询' }
  const CASES = [
    ['bug', '装了插件启动直接崩溃报错。'],
    ['feature', '希望增加深色模式。'],
    ['question', '请问 API 速率限制是多少？'],
  ]
  const seen = []
  for (const [want, state] of CASES) {
    const out = await liveJudge({
      state,
      questions: { v: { type: 'choice', instructions: '归类', criteria: CRITERIA } },
      primaryQuestion: 'v',
    })
    assertNotDegraded(out, `choice(${want})`)
    assert.equal(out.answers.v.choice, want, `choice 必须判成 "${want}"，实测 "${out.answers.v.choice}"（state=${state}）`)
    assert.equal(out.value, 'unknown', 'choice 无 yes/no 语义 ⇒ 契约面必须 unknown（不得默认 no）')
    assert.equal(out.probability, null, '概率不可用 ⇒ null（不得用 0 冒充）')
    assert.ok(out.answers.v.probabilities, 'probabilities 必须带出（否则无法分辨"很确信"与"勉强")')
    seen.push(`${want}→${out.answers.v.choice}(conf=${out.answers.v.confidence})`)
  }
  t.diagnostic(`[L3] ${seen.join(' · ')}`)
})

test('L4 真通道 · **多问同调**：一次调用两问，两个答案都在（"多问被压成单问"的真机反证）', async (t) => {
  const out = await liveJudge({
    state: '系统崩了三天无法收款，紧急！',
    questions: {
      urgent: { type: 'noul', instructions: '是否紧急或时间敏感？' },
      kind: { type: 'choice', instructions: '归类', criteria: { bug: '报错崩溃', feature: '功能请求', question: '使用咨询' } },
    },
    primaryQuestion: 'urgent',
  })
  assertNotDegraded(out, '多问同调')
  assert.deepEqual(Object.keys(out.answers).sort(), ['kind', 'urgent'], `两问都必须有答案（实测 ${Object.keys(out.answers).join('|')}）`)
  assert.equal(out.primaryQuestion, 'urgent', '契约单值面必须取自显式声明的主问题')
  assert.ok(out.probability > 0.5, `主问题 noul=${out.probability} 应当 >0.5`)
  assert.ok(['bug', 'feature', 'question'].includes(out.answers.kind.choice), `次要答案的取值必须可读：${out.answers.kind.choice}`)
  t.diagnostic(`[L4] urgent=${out.answers.urgent.noul} kind=${out.answers.kind.choice} ${out.latencyMs}ms cost=${out.costUsd}`)
})

test('L5 真通道 · 落痕 + 成本口径：jev_log 落真行，cost_usd **不为 0**（拿不到则 null）', async (t) => {
  const { db, rows, close } = await tempDb()
  try {
    const out = await liveJudge(
      {
        state: '系统崩了三天无法收款，紧急！',
        questions: { v: { type: 'noul', instructions: '是否紧急或时间敏感？' } },
        primaryQuestion: 'v',
      },
      { db, source: 'mana-jev-systemone-live' },
    )
    assertNotDegraded(out, '落痕腿')
    assert.equal(out.traceError, null, `落痕不得失败：${out.traceError}`)
    const all = rows()
    assert.equal(all.length, 1, `真判定必须恰落一行（实测 ${all.length}）`)
    assert.equal(all[0].result_value, out.value)
    assert.equal(all[0].degraded, 0)
    if (out.costUsd !== null) {
      // ⚠ 只断"不是 0 冒充" + 有限，**不**给成本设阈值（B 档浮动量）
      assert.ok(Number.isFinite(out.costUsd) && out.costUsd > 0, `成本必须为正的有限数（不得用 0 冒充）：${out.costUsd}`)
      assert.equal(all[0].cost_usd, out.costUsd, '库里的 cost_usd 必须与返回值一致')
    } else {
      assert.equal(all[0].cost_usd, null, '拿不到成本 ⇒ 库里必须是 null（不得写 0）')
    }
    t.diagnostic(`[L5] rows=${all.length} cost_usd=${all[0].cost_usd} 白名单=${SYSTEMONE_ALLOWED_MODELS.join('/')} 缺省模型=${SYSTEMONE_DEFAULT_MODEL}`)
  } finally {
    close()
  }
})
