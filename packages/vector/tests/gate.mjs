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

/**
 * 期望的测试文件与**各自的**用例条数（**等式**，不是下界 —— 缺陷②的修法：删一条必须红）。
 * ⚠ **逐个列名**、不用通配（通配在空集下静默通过）。
 * ⚠ 条数按文件分开（W2-C3 起）：全局合计相等只能证明"总数没变"，
 *   一个文件删一条、另一个加一条就抓不到了 —— 逐文件等式才堵得住。
 *   新判据文件必须在此登记；改条数必须**同时**改这里与文件内 ⓪ 的自检（两处同源同值）。
 * ⚠ 本清单的**变更史**（可审计，别只看现值）：
 *   · `recall-gate-wiring.test.mjs`（7 条）**此前未登记** —— 它自带的 ⓪ 自检在它自己
 *     被整份删除时**不再有机会执行**，故那层自检挡不住"删整个文件"；登记进本闸才挡得住。
 *     本席只补登记，**未动它的任何断言与条数**。
 *   · `bigloop.test.mjs`（12 条）为 D2 席新增文件，随本次改动一并登记。
 *   · `bigloop-wiring.test.mjs`（11 条）为 E2 接线席新增文件（大环路的生产调用方判据），
 *     随本次改动一并登记 —— **不登记就等于"删掉整份判据"在本闸下不可见**（形态 ②）。
 */
const FILES = [
  { file: 'b11-vector.test.mjs', cases: 15 },
  { file: 'recall-graph.test.mjs', cases: 11 },
  // W1-4 的接线判据：**此前漏登记**（它有自己的 ⓪ 自检，但闸不认识它 ⇒
  // 整份文件被删时闸的计数腿不会变色）。⚠ 本席**只登记条数，不改它的任何判据**。
  { file: 'recall-gate-wiring.test.mjs', cases: 7 },
  // D2 大环路递归检索（v10 §12.5 / §14.7）：新增文件**必须在此登记**，
  // 否则"删掉整份判据"这一形态在本闸下不可见（本仓实测过的假绿形态 ②）。
  { file: 'bigloop.test.mjs', cases: 12 },
  // E2 大环路接线（生产调用方 ≥1）：桩计数 + 缺省关 + 契约面零改动。
  { file: 'bigloop-wiring.test.mjs', cases: 11 },
  // J1 嵌入腿失败态归类（本卡新增）：**必须在此登记**，否则整份文件被删时本闸不可见（形态 ②）。
  // 16 条 = 1 条自检 + 15 条判据（**双方向**：该归类归 / 不该归类不被吞；含成功路径 failureKind===null）。
  { file: 'embed-unsupported.test.mjs', cases: 16 },
  // L1 稠密候选腿（本卡新增）：**必须在此登记**，否则整份文件被删时本闸不可见（形态 ②）。
  // 11 条 = 1 条自检 + 10 条判据（含**正向/反向两条真数据**用例，以及"没得扫/没扫成/扫了不相近"
  // 三态的分辨用例）。
  { file: 'recall-dense.test.mjs', cases: 11 },
  // 真双路召回（本卡 t-mujpmv5v-tdvms1 新增）：**必须在此登记**，否则整份文件被删时本闸不可见。
  // 12 条 = 1 条自检（含**结构性证据**：扫描相位不得落在 `if (!candidates.length)` 里）
  // + 11 条判据（池非空也扫 / 并集口径 / 上限封死 / 三态可分辨 / 读数同一份 / 正向·反向真数据 /
  // 修前修后对照 + 代价实测）。
  { file: 'recall-dualpath.test.mjs', cases: 12 },
]

const here = dirname(fileURLToPath(import.meta.url))
const failures = []

let totalCases = 0
for (const { file: f, cases: want } of FILES) {
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
  totalCases += cases
  if (cases !== want) {
    failures.push(`${f} 用例条数 ${cases} ≠ 期望 ${want}（少一条 = 有判据被删走）`)
  }
  // 内容指纹：闸不认识"半空"的文件（可读性检查，防止 1 条真断言 + 13 条空壳 test('x',()=>{})）
  if (!/assert\./.test(src)) failures.push(`${f} 内没有任何 assert.* —— 用例可能是空壳`)
  // test.only 会让**其余判据静默不跑**（计数腿看不出来：文件里 test( 的条数没变）
  if (/^test\.only\(/m.test(src)) failures.push(`${f} 里有 test.only —— 其余判据会静默不跑`)
}

if (failures.length) {
  console.error(`[vector·gate] 红：${failures.length} 项\n` + failures.map((f) => '  · ' + f).join('\n'))
  process.exit(1)
}
console.log(`[vector·gate] 前置检查通过：${FILES.length} 个文件 / ${totalCases} 条用例 / 非空 / 含 assert`)

const args = FILES.map((f) => join(here, f.file))
const r = spawnSync(process.execPath, ['--test', ...args], { stdio: 'inherit' })
process.exit(r.status ?? 1)
