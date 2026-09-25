#!/usr/bin/env node
/**
 * `dsh-mana-attention` 包内**外部防线**（口径抄 `packages/reconsolidation/verify.mjs`，S26 席先例）。
 *
 * ## 为什么判据必须在**被测文件之外**（本仓实测教训）
 *   测试文件被**清空成 0 字节**时，`node --test <该文件>` 报 `# tests 1 / # pass 1 / exit 0`
 *   —— 计的是「文件加载成功」，**不是用例**；文件内的「用例计数自检」会**连同自己一起消失**
 *   ⇒ 文件内自检挡不住零字节。（本席 2026-09-25 用空文件实测复现，读数见 `docs/handoff/F2.md`。）
 *
 * ## 六道闸（任一不过即 exit 1）
 *   ① 五份测试文件存在且**非零字节**；
 *   ② 每份文件 `^test(` 声明数 **恰好等于** `EXPECTED_CASES`（防删用例/截断；**逐文件计数，不合并**）；
 *   ③ 全量 `node --test tests/*.test.mjs` 退出码 0，且 TAP `# tests` **等于**用例总数、`# fail` == 0；
 *   ④ **产物内容腿**：把当前 `src/index.ts` 重新编译进临时目录，与仓内 `lib/index.js` **逐字节**比
 *      —— 不一致即判红。⚠ 这是**产物新鲜度**的主判定：`mtime` 可被 `cp`/`touch` 任意摆布（代理指标），
 *      而内容层证据才对应「判据读到的到底是哪份实现」。
 *      ⚠ 本闸对**在途并行席**是敏感的：他席改了本包 src 而未重建 ⇒ 本闸变红。那是**如实**的红
 *      （判据面此刻读的确实是旧实现），不是本文件的缺陷。
 *   ⑤ **负向对拍腿真的跑过**：`tests/negatives.test.mjs` 的 TAP 里必须有 5 条 `ok`
 *      —— 防的是「对拍被改成恒绿/被短路」（只数文件在长不数它是否真造了扰动）。
 *   ⑥ **变异锚点在真源里确实存在**（**内容级**，不是行为级）：五条对拍各自的锚点串必须在
 *      `lib/index.js` 里**命中恰好 1 次**。命中 0 次 = 真源已改、变异器过期 ⇒ 那些对拍会
 *      **静默变成永远打不中靶的空转**（本仓既有教训：变异没生效，读数看起来却像判据没牙）。
 *
 * ## 残留盲区（如实记，不假装覆盖）
 *   · 本脚本自身若被清空/删除，防线消失 —— 该形态只能靠外部（会议/CI）核验其存在性与退出码。
 *   · 闸⑥ 是**代理证据**（读源码文本），不是行为证据：它能抓「锚点消失」，抓不到
 *     「夹具被改成不真的施加变异」。后者由闸⑤ + 用例内的前置断言（变异体必须真装载、
 *     真发生注入）共同承担，仍不是完备证明。
 *
 * 用法：`node packages/attention/verify.mjs`   退出码 0 = 通过
 *      （本仓纪律：**不得用管道取退出码** —— `node x.mjs | tail` 的 `$?` 是 tail 的）
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ⚠ 新增测试文件必须在此登记（**每份文件各自计数，不合并** —— 合并会让一份文件替另一份背锅）。
 * 计数口径 = 该文件里 `^test(` 的行数。
 */
const TEST_FILES = [
  ['tests/gate-reachability.test.mjs', 6],
  ['tests/fail-closed.test.mjs', 6],
  ['tests/next-call-surface.test.mjs', 6],
  ['tests/buildblock-and-namespace.test.mjs', 8],
  ['tests/negatives.test.mjs', 5],
  // ⚠ 缺陷报告腿：**正向断言**（钉住当下的**缺陷读数**）—— 实现修好后它会变红，
  //   那是设计意图（判据形状跟着事实走），不是回归。变红时按 docs/handoff/F2.md §未决项 处置。
  ['tests/defect-report.test.mjs', 4],
]

/** 闸⑥ 的锚点登记：必须与 `tests/negatives.test.mjs` 里的变异锚点**逐字一致**。 */
const MUTATION_ANCHORS = [
  // ⚠ 2026-09-25 G1 重派席：实现把 reset 那一类的写入点改为带显式位的形态
  //   （`finish('reset', { reset: true, blockId })`，修 D1/D2）⇒ 本锚点随真源改名，
  //   **语义不变**（仍由 negatives.test.mjs 的 N1 摘掉该类写入点）。两处必须逐字一致。
  ["finish('reset', { reset: true,", 'N1 摘掉 reset 写入点'],
  ['if (!judge || judge.degraded === true) {', 'N2a fail-closed 闸（降级）'],
  ['if (prob === null || prob < config.jevThreshold) {', 'N2b fail-closed 闸（未过阈）'],
  ['const downstream = await next();', 'N3 摘掉 next()'],
  ['eventType: stageLabel(4),', 'N4 injection 段标签串类'],
  ['if (injectionBudgetCharsOf(raw) > config.injectionBudgetChars) {', 'N5 摘掉预算闸'],
]

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '..', '..')
const fails = []
const hints = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => {
  fails.push(msg)
  console.log(`  ✗ ${msg}`)
}

/** 剥掉 `NODE_TEST_CONTEXT`（否则嵌套 `node --test` 不跑用例、exit 0、零输出）。 */
function nodeTest(args) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', env })
}

console.log(`verify: ${HERE}`)

// ①② 逐文件：非零字节 + 用例数精确匹配
let expectedTotal = 0
for (const [rel, expected] of TEST_FILES) {
  const file = join(HERE, rel)
  expectedTotal += expected
  if (!existsSync(file)) {
    bad(`${rel} 不存在（判据面被删 ⇒ 该面从未被判）`)
    continue
  }
  const bytes = statSync(file).size
  if (bytes === 0) {
    bad(`${rel} 为零字节（node --test 对空文件报 # tests 1 / exit 0 ⇒ 平凡通过）`)
    continue
  }
  const decls = (readFileSync(file, 'utf8').match(/^test\(/gm) ?? []).length
  if (decls !== expected) {
    bad(`${rel} 用例声明数 ${decls} != 登记值 ${expected}（删用例/截断/新增未登记，三者都要人看一眼）`)
    continue
  }
  ok(`${rel}：${bytes} B，${decls} 个用例（与登记值一致）`)
}

// ③ 全量跑：退出码 0**且** TAP 计数对得上（不信退出码本身）
{
  const r = nodeTest(['--test', ...TEST_FILES.map(([rel]) => rel)])
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const tests = Number((/# tests (\d+)/.exec(out) ?? [])[1] ?? -1)
  const pass = Number((/# pass (\d+)/.exec(out) ?? [])[1] ?? -1)
  const fail = Number((/# fail (\d+)/.exec(out) ?? [])[1] ?? -1)
  if (r.status !== 0) bad(`全量 node --test 退出码 ${r.status}（须 0）`)
  else if (tests !== expectedTotal) bad(`TAP # tests = ${tests}，登记总数 = ${expectedTotal}（计数对不上 ⇒ 有文件没被跑到）`)
  else if (fail !== 0) bad(`TAP # fail = ${fail}（须 0）`)
  else if (pass !== expectedTotal) bad(`TAP # pass = ${pass}，登记总数 = ${expectedTotal}`)
  else ok(`全量：${tests} 用例全绿（pass=${pass} / fail=${fail}，退出码 ${r.status}）`)

  // ⑤ 负向对拍腿：TAP 里必须真有 5 条 ok（防对拍被改成恒绿/短路）
  const negOk = (out.match(/^ok \d+ - N\d/gm) ?? []).length
  if (negOk !== 5) bad(`负向对拍腿：TAP 里 N1..N5 的 ok 只有 ${negOk}/5 —— 对拍被删/被短路/被改成恒绿`)
  else ok('负向对拍腿：N1..N5 共 5 条 ok 真跑过')
}

// ④ 产物内容腿：重编译 src 与 lib 逐字节比
{
  const libPath = join(HERE, 'lib', 'index.js')
  if (!existsSync(libPath)) bad('packages/attention/lib/index.js 不存在 ⇒ 判据面读不到实现（包名解析会落到它）')
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'mana-f2-verify-'))
    try {
      // `npx tsc`：仓内 devDependency（根 package.json），非全局假设
      const r = spawnSync('npx', ['tsc', '-p', join(HERE, 'tsconfig.json'), '--outDir', join(tmp, 'lib')], {
        cwd: REPO,
        encoding: 'utf8',
        shell: false,
      })
      const produced = join(tmp, 'lib', 'index.js')
      if (!existsSync(produced)) {
        bad(`内容腿：重编译未产出 index.js（tsc 退出码 ${r.status}）⇒ 无法判定产物新鲜度：${(r.stderr ?? '').slice(0, 200)}`)
      } else {
        const a = readFileSync(produced)
        const b = readFileSync(libPath)
        if (!a.equals(b)) {
          bad(
            '内容腿：**当前 src 与仓内 lib 不一致** ⇒ 判据这一刻读到的是旧实现。' +
              '（若他席正在改本包 src，这是如实红：本判据面的结论此刻不适用于新 src；重建后再跑。）',
          )
        } else ok('内容腿：当前 src 重编译与 lib/index.js 逐字节一致（判据读的确实是当前实现）')
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

// ⑥ 变异锚点在真源里确实存在（每个恰好 1 次）
{
  const src = readFileSync(join(HERE, 'lib', 'index.js'), 'utf8')
  let allOk = true
  for (const [anchor, label] of MUTATION_ANCHORS) {
    const hits = src.split(anchor).length - 1
    if (hits !== 1) {
      allOk = false
      bad(`变异锚点「${label}」在 lib 命中 ${hits} 次（须恰好 1）⇒ 该对拍打不中靶、退化为空转；须同步更新 tests/negatives.test.mjs 与 verify.mjs 的登记`)
    }
  }
  if (allOk) ok(`变异锚点：${MUTATION_ANCHORS.length} 条全部在 lib 命中恰好 1 次（对拍未过期）`)
}

console.log('')
if (fails.length) {
  for (const f of fails) hints.push(f)
  console.log(`verify: FAIL（${fails.length} 项）`)
  process.exit(1)
}
console.log('verify: PASS')
