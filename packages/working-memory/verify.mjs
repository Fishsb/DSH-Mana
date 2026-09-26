#!/usr/bin/env node
/**
 * dsh-mana-working-memory 包内**外部防线**（R2b；W2-C2 席升级为**多文件清单式**）。
 *
 * ## 为什么判据必须在**被测文件之外**（实测教训）
 *   测试文件被**清空成 0 字节**时，node --test <该文件> 报
 *   # tests 1 / # pass 1 / exit 0 —— 计的是"文件加载成功"，**不是用例**；
 *   文件内的"用例计数自检"会**连同自己一起消失** ⇒ 文件内自检挡不住零字节。
 *   ⇒ 本脚本与测试文件**不同体**：先验文件形状，再才跑 node --test。
 *
 * ## 闸（任一不过即 exit 1）
 *   ① 每份测试文件存在且**非零字节**；
 *   ② 每份文件 ^test( 声明数 **恰好等于**登记值（**逐文件计数、不合并** —— 合并会让
 *     一份文件替另一份背锅）；
 *   ③ 全量 node --test 退出码 0，且 TAP # tests **等于**登记总数、# fail == 0；
 *   ④ **产物内容腿**：把当前 src 重新编译进临时目录，与仓内 lib **逐字节**比 ——
 *      这是**产物新鲜度**的主判定。mtime 可被 cp/touch 任意摆布（代理指标），
 *      内容层证据才对应"判据读到的到底是哪份实现"。
 *      ⚠ 本包自 W2-C2 起有**两个** src 文件（index.ts + compression.ts），
 *        故内容腿是**逐个产物比对**，不是只比 index.js。
 *   ⑤ **负向对拍腿真的跑过**：TAP 里必须有 5 条 M1..M5 的 ok ——
 *      防的是"对拍被改成恒绿/被短路"（只数文件在长，不数它是否真造了扰动）。
 *   ⑥ **变异锚点在真源里确实存在**（**内容级**）：每条对拍的锚点串必须在 lib 里
 *      **命中恰好 1 次**。命中 0 次 = 真源已改、变异器过期 ⇒ 那些对拍会
 *      **静默变成永远打不中靶的空转**（本仓既有教训）。
 *
 * ## 残留盲区（如实记，不假装覆盖）
 *   · 本脚本自身若被清空/删除，防线消失 —— 该形态只能靠本仓外部（会议/CI）
 *     核验 verify.mjs 存在性与退出码。
 *   · 闸⑥ 是**代理证据**（读源码文本），不是行为证据：它能抓"锚点消失"，
 *     抓不到"夹具被改成不真的施加变异"。后者由闸⑤ + 对拍内的前置断言
 *     （变异体必须真装载、真发生差异）共同承担，仍不是完备证明。
 *
 * ## ⚠ 本工作区的**已知环境问题**（本席实测，影响"判据读到哪一份"）
 *   本 worktree 的 node_modules 链全部是**断链**（readlink 指向 ../../packages/x，
 *   而 .dsh-worktrees/ 下没有 packages/）⇒ Node 解析**向上回退到主仓**
 *   /home/lk/Mana/packages/**。本席只**重指了本包那一条链**
 *   （dsh-mana-working-memory -> <本工作区>/packages/working-memory/），
 *   未动其余 15 条（写面纪律：只有 packages/working-memory/**）。
 *   闸④ 的内容腿比的是**本仓内** src 与 lib，与该问题正交；
 *   但 `bootChain`（经包名装载）走的那一层取决于上述链 —— 判据里已**避免**
 *   依赖它来判压缩面（压缩判据全部走 src 直装配）。
 *
 * 用法：node packages/working-memory/verify.mjs      退出码 0 = 通过
 *      （本仓纪律：**不得用管道取退出码** —— node x.mjs | tail 的 $? 是 tail 的）
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ⚠ 新增测试文件必须在此登记（**每份文件各自计数，不合并**）。
 * 计数口径 = 该文件里 ^test( 的行数。
 * ⚠ 加用例必须同步改这里（不是"改判据去迁就实现"）：本闸的意义正是**防删用例/防截断**，
 *   数字不更新 ⇒ verify 报红（那才是它该有的行为）。
 */
const TEST_FILES = [
  // F4 席建 + G2 席扩到 13（W1–W14）
  ['tests/working-memory.test.mjs', 13],
  // ⚠ W2-C2 席新增（v10 §30.2 三层压缩）：C1–C16 正向腿 + R1–R3 两闸回归腿。
  //   登记值 = 该文件 ^test( 行数（新文件不加登记在本闸会红，这是设计意图）。
  ['tests/compression.test.mjs', 19],
  // ⚠ W2-C2 席新建的**负向对拍**面（M1–M5）：每条打一个靶，锚点与下面的 MUTATION_ANCHORS 逐字一致。
  //   登记它是**必须的**：闸⑤ 只数 TAP 里的 ok，若不登记，这份文件被删掉时闸⑤ 会**数不到而恒红**
  //   —— 那是"红得对但原因错"；登记后"文件被删"由闸① 直接点名，职责分明。
  ['tests/negatives.test.mjs', 5],
]

/**
 * 闸④ 的产物登记：src -> lib（本包自 W2-C2 起有**两个** src 文件）。
 * ⚠ 多文件包的内容腿必须**逐个**比 —— 只比 index.js 会让 compression.js 的
 *   新鲜度**无人核验**（"存下来却不验 = 漂移不可见"，本仓 a0-check A0-12 的教训）。
 */
const ARTIFACTS = [
  ['src/index.ts', 'lib/index.js'],
  ['src/compression.ts', 'lib/compression.js'],
]

/** 闸⑥ 的锚点登记：必须与 tests/negatives.test.mjs 里的变异锚点**逐字一致**。 */
const MUTATION_ANCHORS = [
  ['compressed: true,', 'M1 去掉"真压"的记账位（compressed 恒假 ⇒ C1 必红）'],
  // ⚠ M2 的短锚点在 lib 命中 **2** 次（第一层与第二层各一处）⇒ 必须用**跨行唯一**片段，
  //   否则闸⑥ 会因"命中 2 次"报红（那是**如实**的红：对拍确实会打错靶）。
  ['        afterChars,\n        savedChars: beforeChars - afterChars,\n        foldedChunks: head.length,', 'M2 记账与事实脱钩（savedChars 回填常量 ⇒ C1 必红）'],
  // ⚠ M3 原锚点 `degraded: true,` 在 lib 命中 **0** 次（tsc 产出的是简写属性 `degraded,`）
  //   ⇒ 对拍会静默空转。改打**降级出口本身**（catch 分支的 noop(true,…)），语义等价且唯一。
  ["return noop(true, 'selector 抛错：' + msg + '；未压缩（显式降级，不吞异常）');", 'M3 去掉降级位（selector 抛错静默 ⇒ C4 必红）'],
  ['reduced: beforeChars > afterChars,', 'M4 去掉"是否真省"读数（C10 必红）'],
  // ⚠ 短锚点 `truncatedChars,` 在 lib 命中 **2** 次（初始化与真赋值各一处）⇒ 对拍会打错靶。
  //   改打**唯一的那条真赋值**（抹掉它 ⇒ 截断量恒 0 ⇒ 记账恒等式不成立）。两处登记必须逐字一致。
  ['truncatedChars = orig - codePointLen(body);', 'M5 去掉截断量记账（恒等式不成立 ⇒ C11/C12 必红）'],
]

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '..', '..')
const fails = []
const ok = (msg) => console.log('  ✓ ' + msg)
const bad = (msg) => { fails.push(msg); console.log('  ✗ ' + msg) }

/** 剥掉 NODE_TEST_CONTEXT（否则嵌套 node --test 不跑用例、exit 0、零输出）。 */
function nodeTest(args) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', env })
}

console.log('verify: ' + HERE)

// ①② 逐文件：非零字节 + 用例数精确匹配
let expectedTotal = 0
for (const [rel, expected] of TEST_FILES) {
  const file = join(HERE, rel)
  expectedTotal += expected
  if (!existsSync(file)) { bad(rel + ' 不存在（判据面被删 ⇒ 该面从未被判）'); continue }
  const bytes = statSync(file).size
  if (bytes === 0) { bad(rel + ' 为零字节（node --test 对空文件报 # tests 1 / exit 0 ⇒ 平凡通过）'); continue }
  const decls = (readFileSync(file, 'utf8').match(/^test\(/gm) ?? []).length
  if (decls !== expected) {
    bad(rel + ' 用例声明数 ' + decls + ' != 登记值 ' + expected + '（删用例/截断/新增未登记，三者都要人看一眼）')
    continue
  }
  ok(rel + '：' + bytes + ' B，' + decls + ' 个用例（与登记值一致）')
}

// ③ 全量跑：退出码 0 **且** TAP 计数对得上（不信退出码本身）
{
  const r = nodeTest(['--test', ...TEST_FILES.map(([rel]) => rel)])
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const tests = Number((/# tests (\d+)/.exec(out) ?? [])[1] ?? -1)
  const pass = Number((/# pass (\d+)/.exec(out) ?? [])[1] ?? -1)
  const fail = Number((/# fail (\d+)/.exec(out) ?? [])[1] ?? -1)
  if (r.status !== 0) bad('全量 node --test 退出码 ' + r.status + '（须 0）')
  else if (tests !== expectedTotal) bad('TAP # tests = ' + tests + '，登记总数 = ' + expectedTotal + '（计数对不上 ⇒ 有文件没被跑到）')
  else if (fail !== 0) bad('TAP # fail = ' + fail + '（须 0）')
  else if (pass !== expectedTotal) bad('TAP # pass = ' + pass + '，登记总数 = ' + expectedTotal)
  else ok('全量：' + tests + ' 用例全绿（pass=' + pass + ' / fail=' + fail + '，退出码 ' + r.status + '）')

  // ⑤ 负向对拍腿：TAP 里必须真有 5 条 M1..M5 的 ok（防对拍被改成恒绿/短路）
  const mTitles = ['M1', 'M2', 'M3', 'M4', 'M5']
  const mOk = mTitles.filter((t) => out.includes(' - ' + t + ' ')).length
  if (mOk !== mTitles.length) bad('负向对拍腿：TAP 里 M1..M5 的 ok 只有 ' + mOk + '/' + mTitles.length + ' —— 对拍被删/被短路/被改成恒绿')
  else ok('负向对拍腿：M1..M5 共 ' + mTitles.length + ' 条 ok 真跑过（逐条点名，防同名灌水）')
}

// ④ 产物内容腿：重编译 src 与 lib 逐字节比（**逐个产物**）
{
  const tmp = mkdtempSync(join(tmpdir(), 'mana-wm-cmp-verify-'))
  try {
    for (const [srcRel, libRel] of ARTIFACTS) {
      const libPath = join(HERE, libRel)
      if (!existsSync(libPath)) { bad(libRel + ' 不存在 ⇒ 判据面读不到实现（包名解析会落到它）'); continue }
      // npx tsc：仓内 devDependency（根 package.json），非全局假设
      const r = spawnSync('npx', ['tsc', '-p', join(HERE, 'tsconfig.json'), '--outDir', join(tmp, 'lib')], {
        cwd: REPO, encoding: 'utf8', shell: false,
      })
      const produced = join(tmp, 'lib', libRel.split('/').pop())
      if (!existsSync(produced)) {
        bad('内容腿 (' + srcRel + ')：重编译未产出 ' + libRel + '（tsc 退出码 ' + r.status + '）：' + String(r.stderr ?? '').slice(0, 200))
        continue
      }
      const a = readFileSync(produced)
      const b = readFileSync(libPath)
      if (!a.equals(b)) {
        bad('内容腿 (' + srcRel + ')：**当前 src 与仓内 ' + libRel + ' 不一致** ⇒ 判据这一刻读到的是旧实现。' +
          '（若他席正在改本包 src，这是如实红：本判据面的结论此刻不适用于新 src；重建后再跑。）')
      } else ok('内容腿 (' + srcRel + ' ⇒ ' + libRel + ')：重编译与仓内产物逐字节一致')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ⑥ 变异锚点在真源里确实存在（每个恰好 1 次）
{
  const libAll = ARTIFACTS.map(([, libRel]) => readFileSync(join(HERE, libRel), 'utf8')).join(String.fromCharCode(10))
  let allOk = true
  for (const [anchor, label] of MUTATION_ANCHORS) {
    const hits = libAll.split(anchor).length - 1
    if (hits !== 1) {
      allOk = false
      bad('变异锚点「' + label + '」在 lib 命中 ' + hits + ' 次（须恰好 1）⇒ 该对拍打不中靶、退化为空转；' +
        '须同步更新 tests/negatives.test.mjs 与 verify.mjs 的登记')
    }
  }
  if (allOk) ok('变异锚点：' + MUTATION_ANCHORS.length + ' 条全部在 lib 命中恰好 1 次（对拍未过期）')
}

console.log('')
if (fails.length) {
  console.log('verify: FAIL（' + fails.length + ' 项）')
  process.exit(1)
}
console.log('verify: PASS')
