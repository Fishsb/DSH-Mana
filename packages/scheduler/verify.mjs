#!/usr/bin/env node
/**
 * `dsh-mana-scheduler` 包内**外部防线**（R2b）。
 *
 * 为什么判据必须在**被测文件之外**（实测教训）：
 *   测试文件被**清空成 0 字节**时，`node --test <该文件>` 报
 *   `# tests 1 / # pass 1 / exit 0` —— 计的是"文件加载成功"，**不是用例**；
 *   文件内的"用例计数自检"会**连同自己一起消失** ⇒ 文件内自检挡不住零字节。
 *   ⇒ 本脚本与测试文件**不同体**：先验文件形状，再才跑 node --test。
 *
 * 三道闸（任一不过即 exit 1；**对清单内每个文件各查一遍，不合并计数**）：
 *   ① 测试文件存在且**非零字节**；
 *   ② `grep -c "^test("` **恰好等于** EXPECTED_CASES（防删用例/截断）；
 *   ③ `node --test` 退出码 0 **且** TAP `# tests` **等于** EXPECTED_CASES（不是 `>0`）。
 *
 * ⚠ W1-1 扩面（实测动机，不是顺手加的）：新增的 `tests/chains-e2e.test.mjs` 是本项**唯一**
 *   能证「四链在生产侧真有触发者」的文件。防线原本只盯 `scheduler.test.mjs` ⇒ 新文件被
 *   清空/截断时**没有任何东西会报**（判据长在没人碰的地方）。故改为**受验文件清单**。
 *
 * ⚠ 残留盲区（如实记）：**本脚本自身**若被清空/删除，则防线消失 —— 该形态只能靠
 *   本仓外部（会议/CI）核验 `verify.mjs` 存在性与退出码。本档已在 handoff 记录。
 *
 * 用法：node packages/scheduler/verify.mjs      退出码 0 = 通过
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * 受验文件清单。**两个数必须分开记**（实测：混记会立刻自相矛盾，本闸的 ②b 就是这么抓到的）：
 *   · `declared` = `test(` 声明数 = TAP `# tests` 的期望值（**含**文件内自检那一例）；
 *   · `counted`  = 文件内 `const EXPECTED_CASES` 的期望值 = **参与计数**的用例数
 *                   （自检例自己被计进去就成自指，故它通常 = declared − 1）。
 *   ⇒ ② 闸比 `declared`，②b 闸比 `counted`，③ 闸比 TAP = `declared`。三者各自有其物。
 */
const EXPECTED = [
  { file: 'tests/scheduler.test.mjs', declared: 14, counted: 14 },
  { file: 'tests/chains-e2e.test.mjs', declared: 13, counted: 12 },
  // ⚠ 新增（VERIFYING 第一刀）：**不登记就等于没判据** —— 外部防线压根不看它，
  //   文件被清空/截断时没有任何东西会报（本包已实测该形态：generation-chain.test.mjs 就漏登记过）。
  { file: 'tests/verify-row.test.mjs', declared: 7, counted: 6 },
]
const HERE = fileURLToPath(new URL('.', import.meta.url))

const fails = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { fails.push(msg); console.log(`  ✗ ${msg}`) }

console.log(`verify: ${HERE}`)

/** 已过形状检查、待真跑的文件。 */
const runs = []

for (const { file, declared: EXPECTED_DECLARED, counted: EXPECTED_COUNTED } of EXPECTED) {
  const TEST = fileURLToPath(new URL(file, import.meta.url))
  console.log(`  ── ${file}（期望 声明 ${EXPECTED_DECLARED} / 计数 ${EXPECTED_COUNTED}）`)

  // ① 非零字节
  if (!existsSync(TEST)) {
    bad(`${file}: 测试文件不存在（${TEST}）`)
    continue
  }
  const size = statSync(TEST).size
  if (size === 0) bad(`${file}: 测试文件是 0 字节（空文件在 node --test 下报 tests 1/pass 1 的假绿）`)
  else ok(`测试文件非零字节（${size} bytes）`)

  const src = readFileSync(TEST, 'utf8')

  // ② 声明用例数精确匹配
  const declared = (src.match(/^test\(/gm) ?? []).length
  if (declared !== EXPECTED_DECLARED) {
    bad(`${file}: test( 声明数 = ${declared}，期望 ${EXPECTED_DECLARED}（有用例被删/被截断）`)
  } else ok(`test( 声明数 = ${declared}（等于期望值）`)

  // ②b 文件内自检的 EXPECTED_CASES 必须与外部防线的**计数口径**同数（漂开 ⇒ 其中一处是摆设）
  const inner = /const EXPECTED_CASES = (\d+)/.exec(src)
  if (inner === null) {
    bad(`${file}: 缺 \`const EXPECTED_CASES\` ⇒ 文件内自检不存在（外部防线是唯一一道）`)
  } else if (Number(inner[1]) !== EXPECTED_COUNTED) {
    bad(`${file}: 文件内 EXPECTED_CASES=${inner[1]} ≠ 外部防线计数口径 ${EXPECTED_COUNTED}（两处读数漂开）`)
  } else ok(`文件内 EXPECTED_CASES = ${inner[1]}（与外部防线计数口径同数）`)

  runs.push({ file, TEST, EXPECTED_CASES: EXPECTED_DECLARED })
}

// ③ 真跑 + TAP 计数相等
if (fails.length === 0) {
  for (const { file, TEST, EXPECTED_CASES } of runs) {
    let out = ''
    let code = 0
    try {
      out = execFileSync(process.execPath, ['--test', TEST], {
        cwd: HERE,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600_000,
      })
    } catch (e) {
      code = e.status ?? 1
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    const m = /^# tests (\d+)$/m.exec(out)
    const ran = m ? Number(m[1]) : null
    if (code !== 0) bad(`${file}: node --test 退出码 ${code}（须为 0）`)
    else ok(`${file}: node --test 退出码 0`)
    if (ran === null) bad(`${file}: 未解析到 TAP \`# tests N\`（判据自身失效）`)
    else if (ran !== EXPECTED_CASES) bad(`${file}: TAP # tests = ${ran}，期望 ${EXPECTED_CASES}（**须相等，不得用 > 0**）`)
    else ok(`${file}: TAP # tests = ${ran}（与期望值相等）`)
  }
}

if (fails.length) {
  console.error(`\n✗ verify FAIL（${fails.length} 项）`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\n✓ verify PASS')
