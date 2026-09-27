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
  // ⚠ **S21 席（A2-6 / A2-7 软删除面）新增，必须在此登记**：
  //   不登记 ⇒ 本文件被清空成 0 字节时，外部防线**压根不看它** ⇒ 假绿复发（见本档开头那条教训）。
  // ⚠ **S30 席（收口 1 / 收口 3）7 → 9**：新增 ⑦（库规模读数 ≠ 活记忆读数）与
  //   ⑧（口径声明 ⇄ 实现一致）。登记数**必须同步**，否则本文件少两条腿时外部防线不报。
  ['tests/retirement.test.mjs', 9],
  // ⚠ **B3.2-R 席（Recall Gate）新增，必须在此登记**：不登记 ⇒ 本文件被清空成 0 字节时
  //   外部防线**压根不看它** ⇒ 假绿复发（见本档开头那条教训）。
  ['tests/recall-gate.test.mjs', 7],
  // ⚠ **c2 席新增（判定链落痕对账），必须在此登记**：不登记 ⇒ 本文件被清空时外部防线不看它。
  // ⚠ **f3 席 6 → 7**：f3 批把本文件重写为 7 例（新增单射腿、重复键腿、抛错腿、
  //   前置条件腿；旧的反证腿换成「三处变异各自必红」并并入 RG-JL-④）。登记数
  //   **必须同步**，否则本文件少一条腿时外部防线不报（该文件头自陈的形态）。
  // ⚠ **f3 收尾席 7 → 8 → 10**：8 例时新增 ★ 反向路径用例（真 jev 降级分支「先落痕后调 next()」+ 下游抛错）；
  //   10 例时新增 ⑥b（DROP/改名 jev_log ⇒ 正常出口的落痕失败）与 ⑥c（部分落痕失败 ⇒ 正常出口仍报归因）。
  // ⚠ **f3 最终收口席 10 → 12**：新增 Q2（早退 not-attempted 的断言 + 克隆变异反证）与
  //   Q1（judged 出口的 reason 不再恒 null）。
  ['tests/recall-gate-jevlog.test.mjs', 12],
  // ⚠ **W1-3 席（Write Gate 生产调用方接线）新增，必须在此登记**：
  //   不登记 ⇒ 本文件被清空成 0 字节时，外部防线**压根不看它** ⇒ 假绿复发（见本档开头那条教训）。
  //   本文件覆盖的是**写入路径真的走到**（端到端落库 + 反证对拍 + retired 闸 + 降级显式），
  //   在 W1-3 之前本包**没有任何**"写了行"的判据（⑧ 断言的恰是"不写行"）。
  ['tests/write-gate.test.mjs', 10],
  // ⚠ **W2 席（K1 向量化通电）新增，必须在此登记**：不登记 ⇒ 本文件被清空成 0 字节时，
  //   外部防线**压根不看它** ⇒ 假绿复发（见本档开头那条教训）。
  //   ⚠ 本条由 **K1 席具名转派**：它按写面纪律未越界（该文件不在它的写面内），
  //     把「防线缺口」如实上交 —— 这正是本仓期望的转派方式（不擅自跨、不静默丢）。
  //   本文件覆盖的是**落库时真生成向量**（端到端 4096 字节 + 回解 1024 维 + 降级不阻断）。
  ['tests/write-vector.test.mjs', 11],
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
