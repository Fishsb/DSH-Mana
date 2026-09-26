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
  // ⚠ impl 席新增（2026-09-26）：D1 会话分区 / D2 上游吞决策 两面的**双会话交错**与**负控**。
  //   登记值 = 该文件 `^test(` 行数（新文件不加登记在本闸会红，这是设计意图）。
  ['tests/session-isolation.test.mjs', 7],
  // ⚠ impl 席 c1（2026-09-26 第 3 轮）：risk 席审出的 4 条缺口（上界逐出留痕 / 逐出丢块跟踪 /
  //   无 sid 零痕迹 / 空 sessionId 在 emit 内抛）+ 两条"不得回退"复核。
  ['tests/eviction-and-gaps.test.mjs', 8],
  // ⚠ impl 席 f2（2026-09-26 第 5 轮）：risk 席第二轮复审的三条新缺口（N1′/D3′/D4′）+ 两条同类病因普查。
  ['tests/f2-new-gaps.test.mjs', 18],
]

/** 闸⑥ 的锚点登记：必须与 `tests/negatives.test.mjs` 里的变异锚点**逐字一致**。 */
const MUTATION_ANCHORS = [
  // ⚠ 2026-09-25 G1 重派席：实现把 reset 那一类的写入点改为带显式位的形态
  //   （`finish('reset', { reset: true, blockId })`，修 D1/D2）⇒ 本锚点随真源改名，
  //   **语义不变**（仍由 negatives.test.mjs 的 N1 摘掉该类写入点）。两处必须逐字一致。
  ["finish('reset', { reset: true,", 'N1 摘掉 reset 写入点'],
  ['if (!judge || judge.degraded === true) {', 'N2a fail-closed 闸（降级）'],
  ['if (prob === null || prob < config.jevThreshold) {', 'N2b fail-closed 闸（未过阈）'],
  // ⚠ 2026-09-26 impl 席：D2 守卫要按 `unknown` 接住 `next()` 的返回值，接住变量由
  //   `downstream` 改名为 `nextResult` ⇒ 本锚点**随真源改名**。**next() 的调用位置未动**
  //   （lib 里仍是那唯一一行），语义不变（仍由 negatives.test.mjs 的 N3 摘掉它）。
  //   改锚点**不是放宽**：新锚点同样必须恰好命中 1 次，命中 0 次本闸即红。
  ['const nextResult = await next()', 'N3 摘掉 next()'],
  ['eventType: stageLabel(4),', 'N4 injection 段标签串类'],
  ['if (injectionBudgetCharsOf(raw) > config.injectionBudgetChars) {', 'N5 摘掉预算闸'],
  // ⚠ impl 席新增：D2 守卫在真源里的锚点（`session-isolation.test.mjs` 的 Z-② 负控逐字用它）。
  //   本闸保证"守卫生效"与"负控打得到靶"是同一件事：锚点消失 ⇒ 负控退化为空转 ⇒ 这里先红。
  ['assertUsableDecision(downstream)', 'D2 守卫（Z-② 负控靶）'],
  // ⚠ f2 收尾批新增：主广播兜底的锚点（`f2-new-gaps.test.mjs` 的 Z-⑤ 逐字使用）。
  ["emitSyncGuarded('mana/decision', decision)", '主广播兜底（Z-⑤ 负控靶）'],
  // ⚠ f2 收尾补齐新增：逐出留痕的归因入口（`f2-new-gaps.test.mjs` 的 Z-⑥ 逐字使用）。
  ["writeTraceGuarded('mana_trace 写入失败(逐出留痕)', {", 'F-1 逐出留痕归因（Z-⑥ 负控靶）'],
  ['const state = sessionStateFor(sid)', 'D1 会话分区（Z-① 负控靶）'],
  // ⚠ impl 席 c1 新增：两条逐出相关锚点（`eviction-and-gaps.test.mjs` 的 Z-③ 逐字使用）。
  ['logSessionEviction(record)', 'N1 逐出留痕（Z-③ 负控靶）'],
  // ⚠ impl 席 f2 新增：N1′ 的算式单点（`f2-new-gaps.test.mjs` 的 Z-④ 逐字使用它）。
  ['const droppedPending = evicted?.pending.length ?? 0', 'N1′ 丢候选计数（Z-④ 负控靶）'],
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
  // ⚠ impl 席新增：本批两条负控（Z-① 会话分区回退 / Z-② 摘掉 D2 守卫）也必须是"真跑过"的 ok，
  //   而不是"文件里写着"。与 N1..N5 同口径计数，防它们被改成恒绿。
  // ⚠ 用例名用的是**带圈数字**（Z-①/Z-②），上一版写成 `Z-\d` 会恒数到 0（本席实测踩到）⇒ 按实测改正。
  const zOk = (out.match(/^ok \d+ - Z-/gm) ?? []).length
  if (zOk !== 6) bad(`负向对拍腿（impl 新增）：Z-①..Z-⑥ 的 ok 只有 ${zOk}/6 —— 对拍被删/被短路/被改成恒绿`)
  else ok('负向对拍腿（impl 新增）：Z-①..Z-⑥ 共 6 条 ok 真跑过')
  // ⚠ f2 收尾批新增：X-①（残码真删）/ X-②（归因不污染）/ X-③（主广播不外溢）也必须是"真跑过"。
  // ⚠ 用例名是「X-①/X-②/X-③」（带圈数字）⇒ 匹配前缀 `X-` 即可，但必须**限定 3 条**；
  //   本席第一版写成 `X-` 后被其它名字里含 "X-" 的用例（如 off-by 计数）灌水到 7 ⇒ 已按实测校正为
  //   「恰好 3 条」并**逐条点名**，避免"多算也算过"。
  // ⚠ 命名冲突（本席实测踩到）：本文件的收尾批判据叫 X-①②③，而 `session-isolation.test.mjs` 里
  //   **另有一组同名的 X-①②③**（双会话交错）⇒ 只按 `X-[①②③]` 匹配会数到 **6** 条（假"多"）。
  //   ⇒ 必须**连用例名的关键词一起点名**，否则这条计数腿本身就在"多算也算过"。
  const Y_TITLES = ['Y-① F-1', 'Y-② F-2', 'Y-③ ③读数竞争', 'Y-④ 普查：有界窗口', 'Y-⑤ 普查：同文件里的空 catch', 'Y-⑥ R-1', 'Y-⑦ R-2']
  const yOk = Y_TITLES.filter((title) => out.includes(` - ${title}`)).length
  if (yOk !== Y_TITLES.length) bad(`收尾补齐判据腿：Y-①/Y-②/Y-③ 的 ok 只有 ${yOk}/${Y_TITLES.length} —— 判据被删/被短路/被同名的另一组用例冒充`)
  else ok(`收尾补齐判据腿（Y-①…Y-⑦）共 ${Y_TITLES.length} 条 ok 真跑过（逐条点名，防同名灌水）`)
  const X_TITLES = ['X-① 残码真删', 'X-② 归因不污染', 'X-③ 主广播抛错不得炸宿主']
  const xOk = X_TITLES.filter((title) => out.includes(` - ${title}`)).length
  if (xOk !== X_TITLES.length) bad(`收尾批判据腿：X-①/X-②/X-③ 的 ok 只有 ${xOk}/${X_TITLES.length} —— 判据被删/被短路/被同名的另一组用例冒充`)
  else ok('收尾批判据腿：X-①/X-②/X-③ 共 3 条 ok 真跑过（逐条点名，防同名灌水）')
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
