/**
 * JEV 判据闸的**检查器集合**（R2 修：闸不再只有一条腿，且每条腿都自称其能力边界）。
 *
 * ## 为什么要拆成模块
 * 同一条检查器要被两处用：
 * ① `tests/gate.mjs`（外部闸 · 跑在**被测文件之外**）；
 * ② `tests/framework.test.mjs`（内部结构性判据，带**负向控制**）。
 * 若各写一份，改一处漏一处 —— 那正是"防线只挂在一条腿上"的形态。
 *
 * ## 每条检查器的**能力边界**（写死在注释里，不许含糊）
 * | 检查器 | 能抓 | **抓不到** |
 * |---|---|---|
 * | `checkFileBasics` | 空文件、用例被删/加、没有任何 assert 的空壳 | 一真断言 + N 条空壳 `test('x',()=>{})`（只能靠用例数等式挡一半） |
 * | `checkNetworkTokens` | **字面量**端点与网络原语（`fetch(` / `node:http` …） | **动态拼接**的端点、`globalThis['fe'+'tch']`；只能挡"手滑写死"，挡不住"故意绕" ⇒ 真正兜住零网络的是**动态腿**（离线命名空间跑一遍） |
 * | `checkConfigConsumed` | `void config` 这类"声明了不消费"、某个 Config 键不被 `apply()` 引用、`config.xxx` 拼错 | 键被引用但**语义上没生效**（读了不用）⇒ 那一半由"每键两档可观测差异"的行为判据兜住 |
 * | `checkLiveRediness` | 真通道判据里"无凭据/不可达"是否**显式红**（须有 `assert.fail`、不得出现任何 skip 形态、不得内联 key） | **行为面**：写成 `assert.fail` 却把整个用例包在 `if (可达)` 里；以及"凭据在但服务端坏了"⇒ 前者由闸的④b腿**现场跑一次无凭据**抓，后者由判据本体的读数负责 |
 *
 * 这段表是**自我声明**，不是自我背书：每条边界都由 `selfTest()` 用**正反两侧**的样本钉住
 * （含"应当抓不到"的样本——把局限也变成被判据钉住的事实，而不是一句保证）。
 */
import { readFileSync, statSync, existsSync } from 'node:fs'

/**
 * 剥掉注释后再做"有没有 `void config` 这类语句"的检查。
 * ⚠ 已知局限：用 `[^:]//` 规避 `http://` 被误当行注释 —— 这是**够用**而非完备的剥离。
 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 静态腿 A：文件级基本盘（非零字节 / 用例数**等式** / 含 assert）。 */
export function checkFileBasics(name, src, expectedCases) {
  const failures = []
  if (!src || src.length === 0) {
    failures.push(`${name} 文件为空（0 字节）—— 空文件会让 node --test 报 tests 1/pass 1/exit 0`)
    return failures
  }
  const cases = (src.match(/^test\(/gm) ?? []).length
  if (cases !== expectedCases) {
    failures.push(`${name} 用例条数 ${cases} ≠ 期望 ${expectedCases}（删一条/加一条都必须变色）`)
  }
  if (!/assert\./.test(src)) failures.push(`${name} 内没有任何 assert.* —— 用例可能是空壳`)
  return failures
}

/** 静态腿 B：**字面量**网络标记黑名单（能力边界见文件头表）。 */
export const FORBIDDEN_TOKENS = [
  // 真端点（写死形态）
  '127.0.0.1:11434',
  'localhost:11434',
  'ollamaReachable', // 旧文件那套"可达才跑"的前置断言名：出现在零网络文件里即为耦合信号
  // 网络原语（写死形态）
  'fetch(',
  "node:http'",
  'node:https',
  'node:net',
  'node:dns',
  'XMLHttpRequest',
  'globalThis.fetch',
]

export function checkNetworkTokens(name, src) {
  const failures = []
  for (const bad of FORBIDDEN_TOKENS) {
    if (src.includes(bad)) {
      failures.push(`${name} 含网络标记 "${bad}" ⇒ 框架判据可能与真模型重新耦合（本轮红线：零网络）`)
    }
  }
  // 反向必要性：既然全离线，注入接缝就**必须**到场（否则判据根本跑不起来）
  if (!src.includes('fetchImpl')) failures.push(`${name} 未使用注入接缝 fetchImpl —— 离线判据无法成立，可疑`)
  return failures
}

/**
 * 静态腿 C：**配置项真被消费**的结构性检查（跑在 `src/index.ts` 源码上）。
 *
 * 判三条：
 * ① 注释剥掉后**不得**存在 `void config` 这类语句（"声明了不消费"的原始形态）；
 * ② 每个 Config 键都必须在源码里被 `config.<key>` 引用（少一个即红）；
 * ③ 源码里出现的 `config.<x>` 必须是**已知键**（拼错即红 —— "读了不存在的键"与"没读"同样致命）。
 */
export function checkConfigConsumed(src, keys) {
  const failures = []
  const code = stripComments(src)
  if (/(^|[^\w.])void\s+config\b/.test(code)) {
    failures.push('src 里存在 `void config` 语句 ⇒ 配置项声明了却零消费（本轮要修的那个原始形态）')
  }
  for (const k of keys) {
    if (!new RegExp(`config\\.${k}\\b`).test(code)) failures.push(`Config 键 "${k}" 在源码里**没有任何** config.${k} 引用（声明了不消费）`)
  }
  const used = new Set([...code.matchAll(/\bconfig\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
  for (const u of used) {
    if (!keys.includes(u)) failures.push(`源码引用了不存在的 Config 键 "config.${u}"（拼错 ⇒ 读的是 undefined，静默生效失败）`)
  }
  return failures
}

/** 读文件并做检查（`checkFileBasics` + `checkNetworkTokens` 一次过）。 */
export function checkTestFile(path, expectedCases) {
  if (!existsSync(path)) return [`缺文件：${path}`]
  const bytes = statSync(path).size
  const src = readFileSync(path, 'utf8')
  const name = path.split('/').pop()
  return [...checkFileBasics(name, bytes === 0 ? '' : src, expectedCases), ...checkNetworkTokens(name, src)]
}

/**
 * **闸自检**：用合成样本证明每条检查器**有负荷**（该红的红），
 * 并把**已知抓不到**的形态也写成期望（该不红的**必须**不红 —— 局限是被钉住的事实，不是一句保证）。
 *
 * 返回 `{ failures, notes }`：`failures` 非空即闸自身有问题，闸必须红。
 */
export function selfTest() {
  const failures = []
  const notes = []

  // ── A 腿：文件基本盘 ───────────────────────────────────────────────
  const goodSrc = "test('a', () => { assert.equal(1, 1) })\n"
  if (checkFileBasics('good', goodSrc, 1).length !== 0) failures.push('自检A1：合法样本被判红（检查器过严 ⇒ 会制造噪声）')
  if (checkFileBasics('empty', '', 1).length === 0) failures.push('自检A2：空文件未被抓（假绿形态①）')
  if (checkFileBasics('missing-case', goodSrc, 2).length === 0) failures.push('自检A3：用例数少一条未被抓（假绿形态②）')
  if (checkFileBasics('no-assert', "test('a', () => {})\n", 1).length === 0) failures.push('自检A4：空壳用例未被抓')

  // ── B 腿：字面量黑名单（**含"抓不到"的期望**）────────────────────────
  if (checkNetworkTokens('lit', "const u = 'http://127.0.0.1:11434/api/chat'").length === 0) {
    failures.push('自检B1：写死的真端点未被抓')
  }
  if (checkNetworkTokens('primitive', 'const r = await fetch("http://x")').length === 0) {
    failures.push('自检B2：直接调 fetch( 未被抓')
  }
  // ⚠ 盲区样本必须**自带 fetchImpl**：否则它会因为"缺少注入接缝"这一条（另一条检查）被判红，
  //   于是盲区演示变成假象 —— 第一次写自检时正是这么错的，B3 当场把它抓了出来。
  const concat =
    "const fetchImpl = async () => ({})   // 注入接缝在场，剩下唯一变量就是端点写法\n" +
    "const host = '127.0.0.1', port = 11434\n" +
    "const u = `http://${host}:${port}/api/chat`\n" +
    "await globalThis['fe' + 'tch'](u)\n"
  if (checkNetworkTokens('concat', concat).length !== 0) {
    failures.push('自检B3：动态拼接样本**被**抓到了 —— 那本文件头的"能力边界"表就写错了，必须据实改')
  } else {
    notes.push('B腿·已知盲区已复现：动态拼接 + globalThis["fe"+"tch"] 绕过字面量黑名单（⇒ 兜住零网络的是**动态腿**，不是这一腿）')
  }
  // 反向必要性只是**弱信号**：`fetchImpl` 只是一个变量名，能被伪造 ⇒ 同样不能当"零网络"的证据
  if (checkNetworkTokens('fake-seam', 'const fetchImpl = 1').length === 0) {
    notes.push('B腿·"必须有 fetchImpl"确认只是弱信号：写个同名变量即可满足（length=0）⇒ 不得当零网络证据')
  } else {
    failures.push('自检B4：弱信号检查的行为与注释所述不符，须据实改')
  }

  // ── C 腿：配置消费（正反两侧）────────────────────────────────────────
  const keys = ['alpha', 'beta']
  const okCode = 'export function apply(ctx, config) { use(config.alpha); use(config.beta) }'
  if (checkConfigConsumed(okCode, keys).length !== 0) failures.push('自检C1：消费齐全的样本被判红')
  if (checkConfigConsumed(`${okCode}\nvoid config\n`, keys).length === 0) failures.push('自检C2：`void config` 未被抓')
  if (checkConfigConsumed('export function apply(ctx, config) { use(config.alpha) }', keys).length === 0) {
    failures.push('自检C3：某个 Config 键未被引用却未报')
  }
  if (checkConfigConsumed('export function apply(ctx, config) { use(config.alpa) }', keys).length === 0) {
    failures.push('自检C4：`config.` 拼错未被抓')
  }
  // 注释里提到 `void config` 不得误报（否则会被"为了过闸而删注释"这种反向激励带偏）
  if (checkConfigConsumed(`${okCode}\n// 本文件没有 void config 这种写法\n`, keys).length !== 0) {
    failures.push('自检C5：注释里的 `void config` 被误报（会把闸变成"删注释就能过"）')
  }

  // ── D 腿：显式红结构（**含"抓不到"的期望**）────────────────────────────
  const liveGood = "const k = process.env['NANOGPT_API_KEY']\nif (!k) assert.fail('no key')\ntest('t', () => {})\n"
  if (checkLiveRediness('live-good', liveGood).length !== 0) failures.push('自检D1：合法样本被判红（检查器过严）')
  if (checkLiveRediness('live-empty', '').length === 0) failures.push('自检D2：空文件未被抓')
  if (checkLiveRediness('live-return', "const k = process.env['NANOGPT_API_KEY']\nif (!k) return\n").length === 0) {
    failures.push('自检D3：无 assert.fail 的静默 return 未被抓（这正是实测踩过的假绿形态）')
  }
  if (checkLiveRediness('live-skip', `${liveGood}test.skip('x', () => {})\n`).length === 0) {
    failures.push('自检D4：skip 形态未被抓')
  }
  if (checkLiveRediness('live-key', "const k = process.env['NANOGPT_API_KEY']\nassert.fail('x')\nconst s = 'sk-abcdefghijklmnop'\n").length === 0) {
    failures.push('自检D5：内联 key 未被抓')
  }
  // ⚠ 已知盲区样本：assert.fail 在场但被条件包住 —— 本检查器**必须抓不到**（该由行为腿抓）
  const wrapped = "const k = process.env['NANOGPT_API_KEY']\ntest('t', () => { if (k) { assert.fail('unreachable') } })\n"
  if (checkLiveRediness('live-wrapped', wrapped).length !== 0) {
    notes.push('D腿·"assert.fail 被 if 包住"样本被判红（超出本检查器的设计能力）—— 须据实修本检查器或改边界表')
  } else {
    notes.push('D腿·已知盲区已复现：assert.fail 在场但被条件包住时本检查器抓不到 ⇒ 兜住它的是闸的 **④b 行为腿**（无凭据现场跑，须 exit≠0 且 skipped=0）')
  }

  return { failures, notes }
}

/**
 * 静态腿 D：**真通道判据的"显式红"结构**（`B1.4` M5 修）。
 *
 * 为什么需要它：实测过一次假绿 —— 把"不可达即 `assert.fail`"改成静默 `return` 后，
 * 离线跑该文件是 `exit 0 / 11 pass / **skipped 0**`，而外部闸照抄**写死的文案**仍宣称"非 skip"。
 * ⇒ 文案不是证据。本检查器只钉**源码结构**（行为面由闸的 ④b 腿现场跑一次无凭据来钉）。
 *
 * 能力边界（写死在注释里）：
 * · 能抓：完全没有 `assert.fail`、出现任何 skip 形态、把真 key 内联进文件。
 * · **抓不到**：`assert.fail` 存在但被 `if` 包住（结构上在场、语义上不执行）——
 *   这一条**只能**由闸的 ④b 腿（无凭据现场跑，要求 exit≠0 且 skipped=0）抓。
 *   沙箱里故意植入该样本，若 ④b 腿仍绿，即说明那条腿没负荷。
 */
export function checkLiveRediness(name, src) {
  const failures = []
  if (!src || src.length === 0) {
    failures.push(`${name} 文件为空（0 字节）—— 空文件会让真通道面看起来"有条腿"，实际零负荷`)
    return failures
  }
  if (!/assert\.fail\(/.test(src)) {
    failures.push(`${name} 内没有 assert.fail(...) ⇒ 无凭据/不可达时会静默通过或跳过（本轮点名的假绿形态）`)
  }
  for (const token of ['t.skip(', 'context.skip(', 'it.skip(', 'skip: true', 'skip:true']) {
    if (src.includes(token)) failures.push(`${name} 出现跳过形态 "${token}" —— 跳过不等于验证，必须红`)
  }
  if (/sk-[A-Za-z0-9]{12,}/.test(src)) {
    failures.push(`${name} 疑似内联了 API key（匹配到 sk- 形态）—— key 只许从环境变量读，永不进仓库`)
  }
  if (!/NANOGPT_API_KEY|SYSTEMONE_API_KEY_ENV/.test(src)) {
    failures.push(`${name} 未从环境变量读凭据 ⇒ 它的"真通道"结论不可能有凭据支撑`)
  }
  return failures
}
