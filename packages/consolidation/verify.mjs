#!/usr/bin/env node
/**
 * `dsh-mana-consolidation` 包内**外部防线**（R2b 立，S16 席 B4.1 扩为**清单式**）。
 *
 * 为什么判据必须在**被测文件之外**（实测教训）：
 *   测试文件被**清空成 0 字节**时，`node --test <该文件>` 报
 *   `# tests 1 / # pass 1 / exit 0` —— 计的是"文件加载成功"，**不是用例**；
 *   文件内的"用例计数自检"会**连同自己一起消失** ⇒ 文件内自检挡不住零字节。
 *   ⇒ 本脚本与测试文件**不同体**：先验文件形状，再才跑 node --test。
 *
 * ⚠ **S16 扩为清单式**（B4.1）：原先是单文件写死（`const TEST = 'tests/skeleton.test.mjs'`），
 *   新判据文件**不在防线内** —— 它被清空/截断时本脚本照样报 PASS。
 *   这正是本仓那条纪律的翻版：**「新增了东西而防线没跟着长」= 新增面不可观测**。
 *   故改为 `CASES` 清单：每个文件逐条列名 + 逐条给定用例数（不用通配 —— 通配在空集下静默通过）。
 *
 * 三道闸（任一不过即 exit 1）：
 *   ① 每个测试文件存在且**非零字节**；
 *   ② 每个文件 `grep -c "^test("` **恰好等于** 自己那行的期望值（防删用例/截断）；
 *   ③ 每个文件 `node --test` 退出码 0 **且** TAP `# tests` **等于**该文件的期望值（不是 `>0`）。
 *
 * ⚠ 残留盲区（如实记）：**本脚本自身**若被清空/删除，则防线消失 —— 该形态只能靠
 *   本仓外部（会议/CI）核验 `verify.mjs` 存在性与退出码。本档已在 handoff 记录。
 * ⚠ 又一个残留盲区（S16 如实记）：本脚本**不**校验 `CASES` 清单本身是否漏列文件 ——
 *   漏列一个新文件时它只会少查一个。缓解：清单与 `npm test` 的全量结果**逐包对拍**
 *   （见 `docs/handoff/S16.md` §判据执行 的用例数对账）。
 *
 * 用法：node packages/consolidation/verify.mjs      退出码 0 = 通过
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** 清单：{ 文件, 期望用例数 }。**逐文件列名 + 逐文件计数**（不用通配）。 */
const CASES = [
  { file: 'tests/skeleton.test.mjs', expected: 8 },
  { file: 'tests/b41-fixed-points.test.mjs', expected: 9 },
  { file: 'tests/b41-defaults.test.mjs', expected: 9 },
]
const HERE = fileURLToPath(new URL('.', import.meta.url))

const fails = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { fails.push(msg); console.log(`  ✗ ${msg}`) }

console.log(`verify: ${HERE}`)

for (const { file, expected } of CASES) {
  const path = fileURLToPath(new URL(file, import.meta.url))
  if (!existsSync(path)) { bad(`测试文件不存在：${file}`); continue }
  const size = statSync(path).size
  if (size === 0) { bad(`${file} 是 0 字节（空文件在 node --test 下报 tests 1/pass 1 的假绿）`); continue }
  ok(`${file}: 非零字节（${size} bytes）`)

  const src = readFileSync(path, 'utf8')
  const declared = (src.match(/^test\(/gm) ?? []).length
  if (declared !== expected) { bad(`${file}: test( 声明数 = ${declared}，期望 ${expected}（有用例被删/被截断）`); continue }
  ok(`${file}: test( 声明数 = ${declared}（等于期望值）`)
}

if (fails.length === 0) {
  for (const { file, expected } of CASES) {
    const r = spawnSync(process.execPath, ['--test', file], { cwd: HERE, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    const m = /^# tests (\d+)$/m.exec(out)
    const ran = m ? Number(m[1]) : null
    if (r.status !== 0) { bad(`${file}: node --test 退出码 ${r.status}（须为 0）`); continue }
    ok(`${file}: node --test 退出码 0`)
    if (ran === null) bad(`${file}: 未解析到 TAP \`# tests N\`（判据自身失效）`)
    else if (ran !== expected) bad(`${file}: TAP # tests = ${ran}，期望 ${expected}（**须相等，不得用 > 0**）`)
    else ok(`${file}: TAP # tests = ${ran}（与期望值相等）`)
  }
}

if (fails.length) {
  console.error(`\n✗ verify FAIL（${fails.length} 项）`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\n✓ verify PASS')
