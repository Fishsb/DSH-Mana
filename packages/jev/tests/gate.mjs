/**
 * JEV 判据的**外部闸**（B1.3 建 · R2 加固为四条腿 · **B1.4 起纳入全量文件计数等式**）。
 *
 * ## 四条腿（各腿**自称其能力边界**，不许看起来比实际强）
 * | 腿 | 做什么 | 真正能抓 | **抓不到** |
 * |---|---|---|---|
 * | ⓪ 自检腿 | 对**合成样本**跑同一批检查器（正反两侧） | 检查器自身失效（该红的没红 / 该不红的误报） | —— 这条腿是给另外三条腿"证明自己有负荷"用的 |
 * | ① 静态·基本盘 | 非零字节 + **每份文件的用例数等式** + 总和等式 + 含 assert | 空文件、删用例、**整份文件消失**、空壳 | 一条真断言 + N 条空壳 |
 * | ② 静态·字面量黑名单 | 禁词表（写死的端点、`fetch(`、`node:http`/`node:net`/`node:dns` …） | **手滑写死**的真调用 | **动态拼接**、`globalThis['fe'+'tch']`、换个变量名再说 ⇒ 逻辑上没有"零网络"的证明力（盲区已由自检腿打印） |
 * | ③ **动态腿** | **离线命名空间**里真跑一遍判据 | **真的**网络依赖（连不上就红 ⇒ 任何写法上的绕过都失效） | 依赖 `unshare`；不可用时**降级并显式标注**，绝不静默当通过 |
 * | ④ **显式红腿** | 现场用**无凭据**环境跑真通道判据，要求它 **必须红且零跳过** | 「不可达就 return / `t.skip`」这类**静默跳过**（假绿②） | 凭据存在但服务端真的坏了 —— 那由真通道判据本体的读数负责 |
 *
 * 结论（写给复核席）：**兜住"零网络"的是第 ③ 腿**；①②腿只是"手滑 / 删用例"的低成本前哨。
 * ⚠ 门禁**不会**因为 ①② 绿就宣布"已解耦"——真正的证据只有 ③。
 *
 * ## B1.4 修的两条（由独立复核席实测指出，不是本席发现的）
 * · **M4**：整份删除 `b12-jev.test.mjs` 时闸**照旧绿**（该文件只在"普查"里被计数，不进等式）
 *   ⇒ 现在**每一份**离线测试文件都在 `EXPECTED` 里：**逐文件等式 + 总和等式**双保险。
 * · **M5**：把"不可达即 `assert.fail`"改成静默 `return` 时，离线 `exit 0 / skipped 0`，
 *   而本闸**照抄写死的文案**仍宣称"非 skip"。⇒ 现在多一条 **④ 显式红腿**：既扫源码
 *   （必须有 `assert.fail`、不得有任何 skip 形态），也**现场跑一次无凭据的该文件要求它必须红**。
 *   文案从此不是承诺，而是被判据钉住的事实。
 *
 * 用法：`node packages/jev/tests/gate.mjs`（= 本包 `npm run test:framework`）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkConfigConsumed, checkLiveRediness, checkTestFile, selfTest } from './gate-checks.mjs'

/**
 * 期望用例条数（**等式**：删一条、加一条都会红 ⇒ 计数不是装饰）。
 * ⚠ **逐文件**列名 + 总和等式：只用总和时，"删一整个文件、在别处补同样多条"可蒙混过关。
 * ⚠ 两类分开列：`OFFLINE` 走**完整静态腿**（含零网络黑名单）并被 ③ 腿真跑；
 *   `COUNTED_OTHER` 是**联网面**（本地 Ollama 判据 + 真 JEV 判据）—— 它们**只进计数等式**
 *   （M4：删掉一整份判据文件必须红），但**不**受零网络黑名单约束、也不在离线命名空间里跑。
 *   把这两类混在一起会制造两种假红/假绿：把联网文件塞进黑名单腿 = 假红；
 *   不进等式 = M4 那个"删了照旧绿"的假绿。
 */
const OFFLINE = {
  'framework.test.mjs': 23,
  'systemone.test.mjs': 23,
}
const COUNTED_OTHER = {
  'b12-jev.test.mjs': 11,
  'live/systemone-live.test.mjs': 5,
}
/** ③ 腿真跑的文件（**只跑离线面**）。 */
const FILES = Object.keys(OFFLINE)
const OFFLINE_TOTAL = Object.values(OFFLINE).reduce((a, b) => a + b, 0)
const GRAND_TOTAL = [...Object.values(OFFLINE), ...Object.values(COUNTED_OTHER)].reduce((a, b) => a + b, 0)
/** 真通道判据文件（**联网面**，由 ④ 腿管"必须能红"）。 */
const LIVE_FILES = ['live/systemone-live.test.mjs']

const here = dirname(fileURLToPath(import.meta.url))
const APPLY_SRC = join(here, '..', 'src', 'index.ts')
const failures = []
const notes = []

/**
 * 从 `src/index.ts` 的 **Config schema** 抽键表（**不手抄**：手抄的表会让"新增键"静默漏检）。
 * 抽不到即红 —— 正则失效必须显式暴露，否则这条腿会静默空转。
 */
function configKeysFrom(src) {
  const block = src.match(/export const Config[^{]*\{([\s\S]*?)\n\}\)/)
  if (!block) return null
  return [...block[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1])
}

// ── 腿 ⓪：闸自检（检查器自身有没有负荷）───────────────────────────────────────
const st = selfTest()
failures.push(...st.failures)
notes.push(...st.notes)

// ── 腿 ① + ②：静态检查（逐份**离线**测试文件，含零网络黑名单）────────────────
const counts = {}
for (const [f, expected] of Object.entries(OFFLINE)) {
  const p = join(here, f)
  failures.push(...checkTestFile(p, expected))
  if (existsSync(p)) counts[f] = (readFileSync(p, 'utf8').match(/^test\(/gm) ?? []).length
}

// ── 腿 ①b：**计数等式**（逐文件 + 总和双等式；联网面只进计数，不进黑名单）──────
// M4：整份文件消失必须红 ⇒ 联网面（本地 Ollama + 真 JEV）也逐份列进等式。
const otherCounts = {}
for (const [f, expected] of Object.entries(COUNTED_OTHER)) {
  const p = join(here, f)
  if (!existsSync(p)) {
    failures.push(`缺判据文件：${f}（**整份文件消失必须红** —— 这正是 M4 抓到的假绿形态）`)
    continue
  }
  otherCounts[f] = (readFileSync(p, 'utf8').match(/^test\(/gm) ?? []).length
  if (otherCounts[f] !== expected) {
    failures.push(`${f} 用例条数 ${otherCounts[f]} ≠ 期望 ${expected}（删一条/加一条都必须变色）`)
  }
}
const seenTotal = Object.values(counts).reduce((a, b) => a + b, 0)
const seenGrand = seenTotal + Object.values(otherCounts).reduce((a, b) => a + b, 0)
if (seenTotal !== OFFLINE_TOTAL) {
  failures.push(`离线判据总数 ${seenTotal} ≠ 期望 ${OFFLINE_TOTAL}（逐文件计数见上；总和等式防"删一份、别处补"）`)
}
if (seenGrand !== GRAND_TOTAL) {
  failures.push(`判据总数（含联网面）${seenGrand} ≠ 期望 ${GRAND_TOTAL}（四份判据文件逐份列名，不许有文件掉出等式）`)
}

// ── 腿 ②b：配置项真被消费（结构性；跑在 src/index.ts 上）────────────────────
let keyCount = 0
if (!existsSync(APPLY_SRC)) {
  failures.push(`缺文件：${APPLY_SRC}`)
} else {
  const src = readFileSync(APPLY_SRC, 'utf8')
  const keys = configKeysFrom(src)
  if (!keys || keys.length === 0) {
    failures.push('从 src/index.ts 的 Config schema 抽不出键表 ⇒ "配置真被消费"这条腿会静默空转（抽键正则失效）')
  } else {
    keyCount = keys.length
    failures.push(...checkConfigConsumed(src, keys))
  }
}

// ── 腿 ④a：**源码面** —— 真通道判据必须自带"显式红"结构（M5）────────────────
for (const f of LIVE_FILES) {
  const p = join(here, f)
  if (!existsSync(p)) {
    failures.push(`缺真通道判据文件：${f}（没有它则"真通道能不能用"只剩人肉结论，无判据）`)
    continue
  }
  failures.push(...checkLiveRediness(f, readFileSync(p, 'utf8')))
}

// ── 汇总静态腿 ──────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`[jev·gate] 红：${failures.length} 项（自检腿 / 静态腿 / 显式红腿·源码面）`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('[jev·gate] 提示：静态腿只是前哨，它的绿**不构成**"零网络"的证据（见文件头能力边界表）')
  process.exit(1)
}
console.log(
  `[jev·gate] 静态腿通过：${Object.entries(counts).map(([f, n]) => `${f}(${n} 条/非空/含 assert/无写死网络标记)`).join(' · ')}`,
)
console.log(
  `[jev·gate] 静态腿通过：离线 ${seenTotal}/${OFFLINE_TOTAL} · 联网面 ${Object.entries(otherCounts).map(([f, n]) => `${f}(${n})`).join(' · ')} · 合计 ${seenGrand}/${GRAND_TOTAL}（逐文件 + 两级总和等式）`,
)
console.log(
  `[jev·gate] 静态腿通过：src/index.ts 无 \`void config\`；${keyCount} 个 Config 键全部被 config.<key> 引用且无未知键`,
)
for (const n of notes) console.log(`[jev·gate] ⚠ 已知盲区（由自检腿钉住）：${n}`)

// ── 腿 ③a：真跑测试（显式路径，不经 shell 通配）────────────────────────────────
const args = FILES.map((f) => join(here, f))
const r = spawnSync(process.execPath, ['--test', ...args], { encoding: 'utf8' })
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
process.stdout.write(out)
const tap = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? -1)
if (r.status !== 0) {
  console.error(`[jev·gate] 红：node --test 退出码 ${r.status}`)
  process.exit(r.status ?? 1)
}
if (tap('tests') !== OFFLINE_TOTAL || tap('pass') !== OFFLINE_TOTAL || tap('fail') !== 0) {
  console.error(`[jev·gate] 红：TAP tests=${tap('tests')} pass=${tap('pass')} fail=${tap('fail')}（期望全 ${OFFLINE_TOTAL}/0）`)
  process.exit(1)
}

// ── 腿 ③b：**动态腿** —— 离线命名空间里再跑一遍（真正兜住"零网络"的那一腿）──────
const probe = spawnSync('unshare', ['-rn', process.execPath, '--test', ...args], { encoding: 'utf8' })
if (probe.error || probe.status === null) {
  console.error(
    `[jev·gate] ⚠ **动态腿不可用**（unshare 无法执行：${probe.error?.message ?? 'unknown'}）—— ` +
      '零网络**未被独立证明**；静态腿只是前哨，不得据此下"框架与适配已解耦"的结论。',
  )
  notes.push('动态腿 unavailable —— 本闸本次的红绿**不含**零网络证据')
} else {
  const pout = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
  const ptap = (k) => Number((pout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? -1)
  if (probe.status !== 0 || ptap('tests') !== OFFLINE_TOTAL || ptap('fail') !== 0) {
    console.error(`[jev·gate] 红：**动态腿**（离线命名空间）失败 —— exit=${probe.status} tests=${ptap('tests')} fail=${ptap('fail')}`)
    console.error(
      pout
        .split('\n')
        .filter((l) => /^not ok|error:/.test(l))
        .slice(0, 10)
        .join('\n'),
    )
    process.exit(1)
  }
  console.log(`[jev·gate] **动态腿通过**：离线命名空间下 ${ptap('tests')}/${OFFLINE_TOTAL} 绿（exit 0）⇒ 判据确实零网络`)
}

// ── 腿 ④b：**行为面** —— 现场跑一次无凭据的真通道判据，要求它**必须红**（M5）────
// ⚠ 这是本闸唯一"故意让子进程失败"的一条：它的**成功条件恰恰是** `status !== 0`。
const liveArgs = LIVE_FILES.map((f) => join(here, f))
const redEnv = { ...process.env }
delete redEnv.NANOGPT_API_KEY
// ⚠ 必须**同时**断掉文件回退：用户的 key 就在 ~/jev/.env 里（本轮边界原话）⇒
//   只删环境变量时，判据仍会从文件读到 key ⇒ 这条腿在开发机上"红不了"（假绿）。
redEnv.JEV_ENV_FILE = '/nonexistent/mana-gate-no-credential.env'
const redRun = spawnSync(process.execPath, ['--test', ...liveArgs], { encoding: 'utf8', env: redEnv })
const redOut = `${redRun.stdout ?? ''}${redRun.stderr ?? ''}`
const redTap = (k) => Number((redOut.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? -1)
if (redRun.status === 0) {
  console.error(
    '[jev·gate] 红：**显式红腿** —— 无凭据时真通道判据却**通过了**（exit 0）⇒ 它静默跳过了。' +
      '这正是被实测抓到的假绿形态（"不可达就 return"），判据必须 `assert.fail`。',
  )
  process.exit(1)
}
if (redTap('skipped') > 0) {
  console.error(`[jev·gate] 红：**显式红腿** —— 无凭据时真通道判据走的是 **skip**（skipped=${redTap('skipped')}）：跳过不等于验证。`)
  process.exit(1)
}
console.log(
  `[jev·gate] **显式红腿通过**：无凭据跑真通道判据 ⇒ exit=${redRun.status} tests=${redTap('tests')} fail=${redTap('fail')} **skipped=${redTap('skipped')}**（红 + 零跳过 ⇒ "没凭据就是没验证过"是事实，不是文案）`,
)

// ── 模型依赖面**如实报数**（不静默、也不当成通过与否的理由）───────────────────
for (const f of LIVE_FILES) {
  const src = readFileSync(join(here, f), 'utf8')
  const total = (src.match(/^test\(/gm) ?? []).length
  const gated = (src.match(/assert\.fail\(/g) ?? []).length
  console.log(`[jev·gate] 模型依赖面普查 · ${f}：${total} 条用例，${gated} 处以 assert.fail 兜住"无凭据/不可达"（不得静默 skip）`)
}
console.log(`[jev·gate] 绿：离线 ${OFFLINE_TOTAL}/${OFFLINE_TOTAL} · 合计 ${GRAND_TOTAL} 条判据全在等式内；自检腿 + 静态腿 + 动态腿（离线）+ 显式红腿 四通过`)
