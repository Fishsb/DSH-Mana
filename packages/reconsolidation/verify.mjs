#!/usr/bin/env node
/**
 * `dsh-mana-reconsolidation` 包内**外部防线**（口径抄 `packages/forgetting/verify.mjs`，S17 席先例）。
 *
 * 为什么判据必须在**被测文件之外**（本仓实测教训）：
 *   测试文件被**清空成 0 字节**时，`node --test <该文件>` 报 `# tests 1 / # pass 1 / exit 0`
 *   —— 计的是"文件加载成功"，**不是用例**；文件内的"用例计数自检"会**连同自己一起消失**
 *   ⇒ 文件内自检挡不住零字节。
 *
 * 四道闸（任一不过即 exit 1）：
 *   ① 测试文件存在且**非零字节**；
 *   ② `^test(` 声明数 **恰好等于** EXPECTED_CASES（防删用例/截断）；
 *   ③ `node --test` 退出码 0 **且** TAP `# tests` **等于** EXPECTED_CASES（不是 `>0`）；
 *   ④ **负向对拍腿真的跑过**：`tests/negatives.test.mjs` 的 TAP 结果里必须有 6 条 `ok`
 *      —— 这条防的是"对拍被改成恒绿/被短路"（只数文件在长，不数它是否真的造了扰动）。
 *      ⚠ 有效性的**残留盲区（如实记）**：若有人把 `runWithMutation` 换成"直接 return 全绿"，
 *      ③ 仍会通过而 ④ 看不出来 —— 那种形态只能靠外部复核（会议/CI）核 `_harness.mjs` 的内容。
 *
 * ⚠ 另一条**残留盲区**：**本脚本自身**若被清空/删除，防线消失 —— 该形态只能靠本仓外部核验
 *   `verify.mjs` 的存在性与退出码。本档已在 `docs/handoff/S26.md` 如实记录。
 *
 * 用法：node packages/reconsolidation/verify.mjs      退出码 0 = 通过
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * ⚠ 新增测试文件必须在此登记（**每份文件各自计数，不合并** —— 合并会让一份文件替另一份背锅）。
 * 计数口径 = 该文件里 `^test(` 的行数，与文件内的 `EXPECTED_CASES` 是**两处独立**的登记。
 */
const TEST_FILES = [
  ['tests/window-boundaries.test.mjs', 5],
  ['tests/window-lifecycle.test.mjs', 4],
  ['tests/update-history.test.mjs', 5],
  ['tests/degraded-three-state.test.mjs', 6],
  ['tests/trace-namespace.test.mjs', 5],
  ['tests/negatives.test.mjs', 6],
]

/**
 * ⚠ **负向对拍的常驻腿**同族盲区（本席 2026-09-25 实测踩到，故在此显式登记）：
 *   `tests/negatives.test.mjs` 的产物是"**红**"（扰动 ⇒ 指定用例报红）。若它被改成
 *   "什么都不做并直接 assert.ok(true)"，上面 ③ 仍会通过（`# tests` 计数没变）。
 *   ⇒ 本脚本额外核一条**内容级**事实：`_harness.mjs` 里必须仍存在"从 `/tmp` 沙箱跑扰动"
 *     的三要素（沙箱临时目录前缀 + 真源 sha 比对 + 剥掉 `NODE_TEST_CONTEXT`）。
 *     ⚠ 它是**代理证据**（grep 源码），不是行为证据 —— 故只作**提示性**提示，**不参与判定**
 *     （本仓纪律：代理指标非判据；捏造性结论与 mtime 那类腿不同源，此处不升级为红）。
 */
const HARNESS_MARKERS = [
  ["mkdtempSync(join(tmpdir(), 'rcn-neg-'))", '对拍必须在 /tmp 沙箱副本里扰动'],
  ["delete env.NODE_TEST_CONTEXT", '嵌套 node --test 必须剥掉 NODE_TEST_CONTEXT（否则静默假绿）'],
]

const HERE = fileURLToPath(new URL('.', import.meta.url))
const fails = []
const hints = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => {
  fails.push(msg)
  console.log(`  ✗ ${msg}`)
}

console.log(`verify: ${HERE}`)

// ①② 逐文件：非零字节 + 用例数精确匹配（**不合并计数**）
const runnable = []
for (const [rel, expected] of TEST_FILES) {
  const file = fileURLToPath(new URL(rel, import.meta.url))
  if (!existsSync(file)) {
    bad(`测试文件不存在：${file}`)
    continue
  }
  const size = statSync(file).size
  if (size === 0) {
    bad(`测试文件是 0 字节（空文件在 node --test 下报 tests 1/pass 1 的假绿）：${file}`)
    continue
  }
  const src = readFileSync(file, 'utf8')
  const declared = (src.match(/^test\(/gm) ?? []).length
  if (declared !== expected) bad(`${rel}: test( 声明数 = ${declared}，期望 ${expected}（有用例被删/被截断）`)
  else ok(`${rel}: 非零字节（${size} bytes）· test( 声明数 = ${declared}（等于期望值）`)
  runnable.push([rel, expected, file])
}

// ③ 逐文件真跑 + TAP 计数相等
if (fails.length === 0) {
  for (const [rel, expected, file] of runnable) {
    let out = ''
    let code = 0
    try {
      // ⚠ `NODE_TEST_CONTEXT` 必须剥掉：带着它启动的子进程**不跑任何用例、exit 0、零输出**
      //   ⇒ 本脚本会看到"退出码 0"而其实一条用例都没跑（静默假绿，与 negatives 那处同源）。
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      out = execFileSync(process.execPath, ['--test', file], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })
    } catch (e) {
      code = e.status ?? 1
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    const m = /^# tests (\d+)$/m.exec(out)
    const ran = m ? Number(m[1]) : null
    if (code !== 0) bad(`${rel}: node --test 退出码 ${code}（须为 0）`)
    else ok(`${rel}: node --test 退出码 0`)
    if (ran === null) bad(`${rel}: 未解析到 TAP #tests N（判据自身失效）`)
    else if (ran !== expected) bad(`${rel}: TAP # tests = ${ran}，期望 ${expected}（**须相等，不得用 > 0**）`)
    else ok(`${rel}: TAP # tests = ${ran}（与期望值相等）`)
    if (rel === 'tests/negatives.test.mjs') {
      // ④ 负向对拍腿：六条对拍必须逐条 `ok`（且不得出现 `not ok`）
      //   ⚠ 第 ⑥ 条打的是 **core 的契约真源**（`../core/src/schema.ts`）—— L-00 补列之后
      //     "本包能不能转 applied"由那份表定义决定，故它必须进这条常驻腿（不能被悄悄删掉）。
      const okCount = (out.match(/^ok \d+ - /gm) ?? []).length
      const notOk = (out.match(/^not ok \d+ - /gm) ?? []).length
      if (okCount !== 6) bad(`${rel}: 负向对拍 ok 条数 = ${okCount}，期望 6（对拍被删/被短路）`)
      else ok(`${rel}: 6 条负向对拍全部 ok（扰动→报红→真源只读→沙箱删净）`)
      if (notOk !== 0) bad(`${rel}: 出现 ${notOk} 条 not ok`)
    }
  }
}

// ⑤ 提示性（**不参与判定**）：对拍机制的三要素是否仍在源码里
{
  const harness = fileURLToPath(new URL('tests/_harness.mjs', import.meta.url))
  if (!existsSync(harness)) bad('缺 tests/_harness.mjs（对拍机制整体消失）')
  else {
    const txt = readFileSync(harness, 'utf8')
    for (const [marker, why] of HARNESS_MARKERS) {
      if (txt.includes(marker)) hints.push(`✓ ${why}`)
      else hints.push(`? ${why} —— 源码标记未命中（**提示性，不判红**；须人工核对该机制是否仍在）`)
    }
  }
}

console.log('\n[提示 · 不参与判定]')
for (const h of hints) console.log(`  ${h}`)

if (fails.length) {
  console.error(`\n✗ verify FAIL（${fails.length} 项）`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\n✓ verify PASS')
