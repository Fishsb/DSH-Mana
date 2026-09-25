#!/usr/bin/env node
/**
 * `dsh-mana-long-term` 包内**外部防线**（R2b · B3.1 扩展）。
 *
 * 为什么判据必须在**被测文件之外**（实测教训）：
 *   测试文件被**清空成 0 字节**时，`node --test <该文件>` 报
 *   `# tests 1 / # pass 1 / exit 0` —— 计的是“文件加载成功”，**不是用例**；
 *   文件内的“用例计数自检”会**连同自己一起消失** ⇒ 文件内自检挡不住零字节。
 *   ⇒ 本脚本与测试文件**不同体**：先验文件形状，再才跑 node --test。
 *
 * 三道闸（任一不过即 exit 1）：
 *   ① 每个受检测试文件存在且**非零字节**；
 *   ② 每个文件的 `grep -c "^test("` **恰好等于**其登记数（防删用例/截断）；
 *   ③ 逐文件 `node --test` 退出码 0 **且** TAP `# tests` **等于**登记数（不是 `>0`）。
 *
 * ⚠ **B3.1 扩展（本席改）**：原来是“单文件 + 一个 EXPECTED_CASES=8”。新增
 *   `tests/activation.test.mjs`（9 例）后，若仍只验 skeleton 那份，新文件被清空时
 *   本防线**不报**（它压根没看那个文件）—— 正是本脚本开头那条“空文件假绿”换个位置复发。
 *   故改成清单 `TEST_FILES`：**每份文件各自计数**。新增测试文件必须在此登记。
 *
 * ⚠ 残留盲区（如实记）：**本脚本自身**若被清空/删除，则防线消失 —— 该形态只能靠
 *   本仓外部（会议/CI）核验 `verify.mjs` 存在性与退出码。本档已在 handoff 记录。
 *
 * 用法：node packages/long-term/verify.mjs      退出码 0 = 通过
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))

/** 受检测试文件清单：[相对路径, 用例数]。数量须**相等**判定，不得用 > 0。 */
const TEST_FILES = [
  ['tests/skeleton.test.mjs', 8],
  ['tests/activation.test.mjs', 9],
]

const fails = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { fails.push(msg); console.log(`  ✗ ${msg}`) }

console.log(`verify: ${HERE}`)

// ①② 逐文件：非零字节 + 用例数精确匹配（**不合并计数** —— 合并会让一份文件替另一份背锅）
const runnable = []
for (const [rel, expected] of TEST_FILES) {
  const file = fileURLToPath(new URL(rel, import.meta.url))
  if (!existsSync(file)) { bad(`测试文件不存在：${file}`); continue }
  const size = statSync(file).size
  if (size === 0) { bad(`测试文件是 0 字节（空文件在 node --test 下报 tests 1/pass 1 的假绿）：${file}`); continue }
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
      out = execFileSync(process.execPath, ['--test', file], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      code = e.status ?? 1
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    const m = /^# tests (\d+)$/m.exec(out)
    const ran = m ? Number(m[1]) : null
    if (code !== 0) bad(`${rel}: node --test 退出码 ${code}（须为 0）`)
    else ok(`${rel}: node --test 退出码 0`)
    if (ran === null) bad(`${rel}: 未解析到 TAP # tests N（判据自身失效）`)
    else if (ran !== expected) bad(`${rel}: TAP # tests = ${ran}，期望 ${expected}（**须相等，不得用 > 0**）`)
    else ok(`${rel}: TAP # tests = ${ran}（与期望值相等）`)
  }
}

if (fails.length) {
  console.error(`\n✗ verify FAIL（${fails.length} 项）`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\n✓ verify PASS')
