/**
 * 判据⑥：**负向对拍四条**（造扰动 → 指定腿**必须报红** → 逐字节恢复并给 sha256 证据）。
 *
 * ── 为什么这四条必须**真的跑一次**（而不是在注释里声明"改了就会红"）─────────────────────
 *   本仓的血的教训：`forgetting/src/index.ts:44-49` 记过一条**空承诺**——
 *   「填了真行为却把 behavior 留成 skeleton ⇒ 判据必红」实测**六条全绿**。
 *   声明不构成判据；**扰动 + 报红 + 恢复**三件事都发生，才构成判据。
 *
 * ── 打靶纪律（本仓"对拍要打对靶"）───────────────────────────────────────────────────────
 *   · 被扰动的文件是 **`src/*.ts`**，被跑的用例文件 import 的正是 `src/`（`_harness.loadPackage`）
 *     ⇒ 靶子一致。**本文件不跑任何"按包名解析到 `lib/`"的判据**（那才是打错靶的形态：
 *     改 src 而判据读 lib，会看到"没变色"，从而误判成"判据没牙"）。
 *   · 每条对拍在恢复后**再跑一次**，必须**变回绿** ⇒ 红是扰动造成的，不是既有的 flake。
 *   · 对拍前后 **sha256 逐字节相同**（从 `.negbak` 拷回，不是"再替换回去"——后者会掩盖编码差异）。
 *
 * ⚠ 扰动由 `_harness.runWithMutation` 施加：锚点必须**恰好命中一次**（命中 0 次即抛，
 *   说明真源已改、变异器已过期 —— 那时静默通过就是假绿）。
 *
 * ── 第 ⑥ 条打的是**契约真源**（L-00 之后新增，2026-09-25）─────────────────────────────
 *   ①–⑤ 扰动的都是**本包** `src/*.ts`；第 ⑥ 条扰动的是 `../core/src/schema.ts`
 *   （`memory_items` 两列的契约真源）—— 因为 L-00 之后本包"能不能转 applied"这件事
 *   **不再由本包决定**：列在不在由 core 的表定义决定。判据（本包所有 applied 腿 + a0 的 A0-8）
 *   读的正是那一份 → 靶子一致。
 *   ⚠ 机制不变：读**真源**（只读），扰动只写**沙箱副本**；真源 sha256 对拍前后逐字节相同。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PKG_DIR, cleanupAll, runWithMutation, sha256File } from './_harness.mjs'

/** 与 `_harness` 内的清洗**同一口径**（在测试侧再写一遍：只引用夹具的导出不足以证明夹具用了它）。 */
function sanitizeEnvForProbe() {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return env
}

const EXPECTED_CASES = 6
let ran = 0
process.on('exit', () => {
  cleanupAll()
  if (ran !== EXPECTED_CASES) {
    console.error(`\n用例计数自检失败：期望 ${EXPECTED_CASES}，实跑 ${ran}`)
    process.exitCode = 1
  }
})

/** 统一的断言：扰动 ⇒ 红了、且**指定那条**用例是红的、且逐字节恢复、且恢复后回绿。 */
function assertNegativeControl(label, { file, find, replace, testFile, expectCase }) {
  const r = runWithMutation({ file, find, replace, testFile })
  const evidence = `扰动 ${file} 后跑 ${testFile}：exit=${r.code}，挂的用例=${JSON.stringify(r.failed)}`
  assert.notEqual(r.code, 0, `【${label}】扰动后必须报红（exit≠0）；实测 exit=${r.code} —— 判据没牙。${evidence}`)
  assert.ok(
    r.failed.some((n) => n.includes(expectCase)),
    `【${label}】必须是**指定那条**用例变红（红在别处 = 打错靶）；期望包含 ${JSON.stringify(expectCase)}，实测 ${JSON.stringify(r.failed)}`,
  )
  assert.equal(r.sourceUnchanged, true, `【${label}】真源必须**全程只读**；before=${r.before} after=${r.after}`)
  assert.equal(sha256File(join(PKG_DIR, file)), r.before, '落盘的真源 sha256 必须与扰动前逐字相同')
  assert.equal(r.sandboxGone, true, `【${label}】沙箱必须删净（残留会被下一轮读到）`)
  assert.equal(r.ran, true, `【${label}】子进程必须**真跑出用例计数**（解析不到计数 = 未判定，不得当红也不得当绿）`)
  return { ...r, evidence }
}

test('① 窗口参数改错 1 秒 ⇒ 四窗口边界判据**必红**', () => {
  ran += 1
  const r = assertNegativeControl('窗口参数改错 1 秒', {
    file: 'src/params.ts',
    find: 'episodic: 30 * 60 * 1000,',
    replace: 'episodic: 30 * 60 * 1000 + 1000,',
    testFile: 'tests/window-boundaries.test.mjs',
    expectCase: '四值逐字复现',
  })
  // 同一条对拍的**反向**证据：扰动改的是"值的来源"，不是判据本身
  assert.equal(r.code, 1, 'node --test 的失败退出码为 1')
})

test('② `update_history` 改成**覆盖写** ⇒ 更新可追溯判据**必红**', () => {
  ran += 1
  // 扰动语义：每次更新都把**空历史**当起点 ⇒ 列里永远只剩最后一段（= 覆盖写的行为）
  const r = assertNegativeControl('update_history 改覆盖写', {
    file: 'src/updates.ts',
    find: 'const appended = appendUpdateEntry(row?.update_history ?? null, entry)',
    replace: 'const appended = appendUpdateEntry(null, entry)',
    testFile: 'tests/update-history.test.mjs',
    expectCase: '新增**两段**',
  })
  assert.equal(r.code, 1)
})

test('③ 缺列时**静默返回空**（不降级/不留痕）⇒ 三态降级腿**必红**', () => {
  ran += 1
  // 扰动语义：把开窗的降级分支改成"看起来一切正常"的空返回（正是本仓最防的静默形态）
  const r = assertNegativeControl('缺列改静默', {
    file: 'src/windows.ts',
    find: "      channel: 'degraded',\n      degraded: true,\n      reason,\n      traced,",
    replace: "      channel: 'applied',\n      degraded: false,\n      reason: null,\n      persisted: true,\n      traced: false,",
    testFile: 'tests/degraded-three-state.test.mjs',
    expectCase: '开窗降级',
  })
  assert.equal(r.code, 1)
})

test('④ trace 标签改成 S1 五类之一 ⇒ 自有命名空间腿**必红**', () => {
  ran += 1
  const r = assertNegativeControl('trace 标签冒充 S1', {
    file: 'src/trace.ts',
    find: "  degraded: 'mana-reconsolidation/degraded',",
    replace: "  degraded: 'recall',",
    testFile: 'tests/trace-namespace.test.mjs',
    expectCase: '降级路径同样在命名空间内',
  })
  assert.equal(r.code, 1)
})

test('⑤ 扰动必须真的落在**被 import 的那份 src** 上（靶子自检：读回扰动内容）', () => {
  ran += 1
  // 这条自检防的是"对拍打错靶"：若哪天测试改成按包名解析 lib/，
  // 上面的扰动会**一次都不报红**（而它们看上去仍在跑）。此处逐字核一次链路。
  const r = runWithMutation({
    file: 'src/params.ts',
    find: 'episodic: 30 * 60 * 1000,',
    replace: 'episodic: 30 * 60 * 1000 + 1000,',
    testFile: 'tests/window-boundaries.test.mjs',
  })
  assert.notEqual(r.code, 0, 'src 上的扰动必须能让读 src 的判据报红 ⇒ 靶子一致')
  assert.equal(r.sourceUnchanged, true, '真源全程只读')
  // 逐字核链路：被扰动的那份 src，正是 mount/load 解析出来的那一份
  const srcText = readFileSync(join(PKG_DIR, 'src/params.ts'), 'utf8')
  assert.ok(srcText.includes('episodic: 30 * 60 * 1000,'), '真源未被扰动（全程只读）')
  assert.equal(readFileSync(join(PKG_DIR, 'tests/_harness.mjs'), 'utf8').includes("new URL(\`\${dir}/src/index.ts\`"), true,
    '夹具必须仍以 src/index.ts 为被测对象（口径变了 ⇒ 本文件四条对拍会集体失效）')

  /**
   * ── 第二条自检：**嵌套 `node --test` 的静默假绿**（本席实测踩到，留成常驻腿）──────────
   * `NODE_TEST_CONTEXT` 会随环境继承给子进程；带着它的 `node --test` **不跑任何用例、
   * exit 0、零输出** ⇒ 四条对拍会集体失效而看上去仍在工作。
   * 这里**现场复现**两种情况，把"清洗环境变量"从一句注释变成一条可复现事实。
   */
  const clean = spawnSync(process.execPath, ['--test', 'tests/window-boundaries.test.mjs'], {
    cwd: PKG_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: sanitizeEnvForProbe(),
  })
  const leaky = spawnSync(process.execPath, ['--test', 'tests/window-boundaries.test.mjs'], {
    cwd: PKG_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
  })
  assert.ok(/# tests \d+/.test(String(clean.stdout)), '清洗后的子进程必须真跑出用例计数（否则对拍无从判定）')
  assert.equal(
    /# tests \d+/.test(String(leaky.stdout)),
    false,
    '带 NODE_TEST_CONTEXT 的子进程**应当**是零用例零输出 —— 这条断言失败说明 Node 行为变了，' +
      '此时上面的清洗与"计数解析不到即记 -1"必须重新评估（不得静默沿用）',
  )
  assert.equal(leaky.status, 0, '静默假绿的特征正是"零用例但 exit 0"——记在这里，防止它被当成通过')
})
test('⑥ **把契约里的两列注释掉** ⇒ 补列/applied 腿**必红**（打的是 core 的契约真源）', () => {
  ran += 1
  // 扰动语义：`packages/core/src/schema.ts` 里 `memory_items` 的两列定义被注释掉
  //   （= "L-00 没做 / 被回退"的真实形态）。
  //   ⚠ 靶子：走 createSchema 真补列的 applied 腿（`degraded-three-state` 用例①）——
  //     两列没进表定义 ⇒ 补列无事可做 ⇒ 该腿的前置控制与补列断言必须报红。
  const r = assertNegativeControl('契约列被注掉', {
    file: '../core/src/schema.ts',
    find: '  reconsolidation_window_until TEXT,\n  update_history TEXT',
    replace: '  -- reconsolidation_window_until TEXT,\n  -- update_history TEXT',
    testFile: 'tests/degraded-three-state.test.mjs',
    expectCase: '前提取数',
  })
  // ⚠ 真源证据必须指向 **core 的 schema.ts**（不是本包的某个 src）——
  //   这条对拍的全部意义就是"契约文件在靶上"，路径写错就变成另一次自证。
  assert.equal(r.target.endsWith(join('core', 'src', 'schema.ts')), true, `扰动目标必须落在 core 契约真源上，实测 ${r.target}`)
  assert.equal(r.code, 1)
})
