#!/usr/bin/env node
/**
 * `dsh-mana-long-term` 包内**外部防线**（R2b）。
 *
 * 为什么判据必须在**被测文件之外**（实测教训）：
 *   测试文件被**清空成 0 字节**时，`node --test <该文件>` 报
 *   `# tests 1 / # pass 1 / exit 0` —— 计的是"文件加载成功"，**不是用例**；
 *   文件内的"用例计数自检"会**连同自己一起消失** ⇒ 文件内自检挡不住零字节。
 *   ⇒ 本脚本与测试文件**不同体**：先验文件形状，再才跑 node --test。
 *
 * 三道闸（任一不过即 exit 1）：
 *   ① 测试文件存在且**非零字节**；
 *   ② `grep -c "^test("` **恰好等于** EXPECTED_CASES（防删用例/截断）；
 *   ③ `node --test` 退出码 0 **且** TAP `# tests` **等于** EXPECTED_CASES（不是 `>0`）。
 *
 * ⚠ 残留盲区（如实记）：**本脚本自身**若被清空/删除，则防线消失 —— 该形态只能靠
 *   本仓外部（会议/CI）核验 `verify.mjs` 存在性与退出码。本档已在 handoff 记录。
 *
 * 用法：node packages/long-term/verify.mjs      退出码 0 = 通过
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const EXPECTED_CASES = 8
const TEST = fileURLToPath(new URL('tests/skeleton.test.mjs', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))

const fails = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { fails.push(msg); console.log(`  ✗ ${msg}`) }

console.log(`verify: ${HERE}`)

// ① 非零字节
if (!existsSync(TEST)) bad(`测试文件不存在：${TEST}`)
else {
  const size = statSync(TEST).size
  if (size === 0) bad(`测试文件是 0 字节（空文件在 node --test 下报 tests 1/pass 1 的假绿）：${TEST}`)
  else ok(`测试文件非零字节（${size} bytes）`)

  // ② 用例数精确匹配
  const src = readFileSync(TEST, 'utf8')
  const declared = (src.match(/^test\(/gm) ?? []).length
  if (declared !== EXPECTED_CASES) bad(`test( 声明数 = ${declared}，期望 ${EXPECTED_CASES}（有用例被删/被截断）`)
  else ok(`test( 声明数 = ${declared}（等于期望值）`)
}

// ③ 真跑 + TAP 计数相等
if (fails.length === 0) {
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, ['--test', TEST], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    code = e.status ?? 1
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  const m = /^# tests (\d+)$/m.exec(out)
  const ran = m ? Number(m[1]) : null
  if (code !== 0) bad(`node --test 退出码 ${code}（须为 0）`)
  else ok('node --test 退出码 0')
  if (ran === null) bad('未解析到 TAP `# tests N`（判据自身失效）')
  else if (ran !== EXPECTED_CASES) bad(`TAP # tests = ${ran}，期望 ${EXPECTED_CASES}（**须相等，不得用 > 0**）`)
  else ok(`TAP # tests = ${ran}（与期望值相等）`)
}

if (fails.length) {
  console.error(`\n✗ verify FAIL（${fails.length} 项）`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\n✓ verify PASS')
