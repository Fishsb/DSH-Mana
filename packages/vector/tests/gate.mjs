/**
 * 测试外部闸（B1.1 · 缺陷①的修法）。
 *
 * ## 为什么需要它（本会议**实测**的三条假绿形态）
 * 1. `node --test "<空目录>/*.test.mjs"` ⇒ **静默 exit 0**（"没写判据"被读成"通过"）；
 * 2. **清空**测试文件后 `node --test <该文件>` ⇒ `# tests 1 / # pass 1 / exit 0`（自检连同自己一起消失）；
 * 3. 删掉文件里**整条用例**后 ⇒ `# tests 13 / pass 13 / exit 0`（计数自检若用 `>=` 就不变色）。
 *
 * ⇒ 本闸在**跑测试之前**先做三件与 `node --test` 无关的独立检查（计数/字节数/内容指纹），
 *   目的是让上面三种形态**都变红**。闸本身不依赖被测代码，故不会被"同一处改坏"一起骗过。
 *
 * 用法：`node tests/gate.mjs`（= `npm test`）。真跑测试用 `npm run test:raw`。
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 期望的用例条数（**等式**，不是下界 —— 缺陷②的修法：删一条必须红）。 */
const EXPECTED_CASES = 15
/** 期望的测试文件（**逐个列名**，不用通配 —— 通配在空集下静默通过）。 */
const FILES = ['b11-vector.test.mjs']

const here = dirname(fileURLToPath(import.meta.url))
const failures = []

for (const f of FILES) {
  const p = join(here, f)
  if (!existsSync(p)) {
    failures.push(`缺文件：${f}`)
    continue
  }
  const bytes = statSync(p).size
  if (bytes === 0) {
    failures.push(`文件为空（0 字节）：${f} —— 空文件会让 node --test 报 tests 1/pass 1/exit 0`)
    continue
  }
  const src = readFileSync(p, 'utf8')
  const cases = (src.match(/^test\(/gm) ?? []).length
  if (cases !== EXPECTED_CASES) {
    failures.push(`${f} 用例条数 ${cases} ≠ 期望 ${EXPECTED_CASES}（少一条 = 有判据被删走）`)
  }
  // 内容指纹：闸不认识"半空"的文件（可读性检查，防止 1 条真断言 + 13 条空壳 test('x',()=>{})）
  if (!/assert\./.test(src)) failures.push(`${f} 内没有任何 assert.* —— 用例可能是空壳`)
}

if (failures.length) {
  console.error(`[vector·gate] 红：${failures.length} 项\n` + failures.map((f) => '  · ' + f).join('\n'))
  process.exit(1)
}
console.log(`[vector·gate] 前置检查通过：${FILES.length} 个文件 / ${EXPECTED_CASES} 条用例 / 非空 / 含 assert`)

const args = FILES.map((f) => join(here, f))
const r = spawnSync(process.execPath, ['--test', ...args], { stdio: 'inherit' })
process.exit(r.status ?? 1)
