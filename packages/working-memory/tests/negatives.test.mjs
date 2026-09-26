/**
 * dsh-mana-working-memory 包内**负向对拍**（W2-C2 席新建）—— "没有负向对拍 = 没做完" 的落点。
 *
 * ## 五条对拍（每条打**一个**靶，不合并）
 * | 编号 | 变异（打在 **lib**） | 哪条正向腿必红 |
 * |---|---|---|
 * | M1 | 抹掉"真压"的记账位（compressed 恒假） | C1（真压 + 精确记账） |
 * | M2 | 记账与事实脱钩（savedChars 回填常量 0） | C1（读数值与实测差值比对） |
 * | M3 | 抹掉降级位（selector 抛错静默返回空） | C4（显式降级 + 留 failure 字段） |
 * | M4 | 抹掉"是否真省"读数（reduced 恒 true） | C10（摘要反超时如实报负） |
 * | M5 | 抹掉截断量记账（truncatedChars 恒 0） | C11/C12（记账恒等式） |
 * | M6 | 去掉"末态须回到上界内"的落地判据（"压了但没够"报成"压住了"） | C17（真回到上界内） |
 *
 * ## 三条纪律（本仓血的教训，逐条落在此文件的实现里）
 *  · **对拍要打对靶**：变异改的是 **lib**（包名解析面真正装载的那一层）。
 *    若改 src 而不重建，变异**从未生效**、读数却像"判据没牙"。
 *  · **仓内零写入**：变异只写临时目录；每个用例前后各取一次 sha256（src + lib）
 *    并断言**逐字节不变**、变异体文件确实与真源不同。不得靠 mtime 说事（可被 cp/touch 摆布）。
 *  · **负控要能真否证**：每条对拍除断言"变异后必红"外，还断言**前置成立**
 *    （变异体真装载了、锚点真命中过）——否则"没数到东西"会被误读成"判据有牙"。
 *
 * ⚠ 每条对拍的**锚点**必须与 verify.mjs 的 MUTATION_ANCHORS **逐字一致**（闸⑥ 核这件事）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PKG = join(HERE, '..')
const LIB_FILES = ['lib/compression.js', 'lib/index.js']
const SRC_FILES = ['src/compression.ts', 'src/index.ts']

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
/** 判据面取证 = 本包 src + lib 全部文件的 sha256（仓内零写入的机检点）。 */
const judgedSurface = () =>
  Object.fromEntries([...SRC_FILES, ...LIB_FILES].map((rel) => [rel, sha(join(PKG, rel))]))

/**
 * 每个对拍：① 仓内零写入取证 → ② 造变异体（临时目录）→ ③ 断言"正向腿必红"的事实 → ④ 再取证。
 *
 * @param anchor  要变异的锚点串（必须与 verify.mjs 的登记**逐字一致**）
 * @param replace 替换成什么
 * @param run     变异体装载后要做的事；返回"必红"的读数
 */
async function negativeControl(name, anchor, replace, run) {
  const before = judgedSurface()
  const libText = readFileSync(join(PKG, 'lib', 'compression.js'), 'utf8')
  const hits = libText.split(anchor).length - 1
  // 前置①：锚点必须**恰好命中 1 次**（0 次 = 变异器过期 ⇒ 对拍退化为空转）
  assert.equal(hits, 1, name + ': 锚点在 lib 里命中 ' + hits + ' 次（须恰好 1）⇒ 对拍打不中靶')

  const mutantText = libText.replace(anchor, replace)
  assert.notEqual(mutantText, libText, name + ': 变异必须真的改变文本')

  // 落临时目录（仓内零写入）
  const dir = mkdtempSync(join(tmpdir(), 'mana-wm-neg-'))
  try {
    writeFileSync(join(dir, 'compression.js'), mutantText)
    // ⚠ 变异体**必须真被装载**并跑出读数（否则下面什么都没数到）
    const mutant = await import(pathToFileURL(join(dir, 'compression.js')).href)
    const finding = await run(mutant)
    const after = judgedSurface()
    assert.deepEqual(after, before, name + ': 对拍**不得写仓**（sha256 逐字节比对）')
    return finding
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 正向腿在变异体上的等价调用（与 compression.test.mjs 的 C1 同形）。 */
const mkChunks = (n, len = 10) =>
  Array.from({ length: n }, (_, k) => ({ requestId: 'req-' + (k + 1), content: 'x'.repeat(len), seq: k + 1, at: 'T' }))

// ── M1：真压的记账位被抹掉 ⇒ C1 必红 ────────────────────────────────────────
test('M1 抹掉 compressed 记账位 ⇒ C1"真压"腿必红', async () => {
  const r = await negativeControl(
    'M1',
    'compressed: true,',
    'compressed: false,',
    (m) => m.compressChunks(mkChunks(5), 2),
  )
  // 必红的判据：C1 断言 compressed === true（"真压"）；变异后恒假 ⇒ 该腿红。
  assert.equal(r.compressed, false, 'M1: 变异后 compressed 恒假（这正是 C1 的必红点）')
  // ⚠ 变异只翻转**标志位**、不改变数组 ⇒ 变异体自相矛盾（说"没压"却把数组压短了）。
  //   这个矛盾正是"记账与事实脱钩"的形态：调用方读 compressed 会得出错误结论。
  assert.ok(
    r.afterChunks < r.beforeChunks,
    'M1: 变异体自称未压缩，但数组实际缩短（' + r.beforeChunks + ' -> ' + r.afterChunks + '）⇒ 标志位与事实脱钩',
  )
})

// ── M2：记账与事实脱钩（savedChars 回填常量）⇒ C1 必红 ──────────────────────
test('M2 savedChars 回填常量 0 ⇒ C1"读数与事实同源"腿必红', async () => {
  const r = await negativeControl(
    'M2',
    // ⚠ 短锚点在 lib 里命中 **2** 次（第一层与第二层各一处）⇒ 对拍会打错靶。
    //   加长到跨行唯一片段（含上面的 afterChars 与下面的 foldedChunks）⇒ 恰好命中 1 次。
    ['        afterChars,', '        savedChars: beforeChars - afterChars,', '        foldedChunks: head.length,'].join(String.fromCharCode(10)),
    ['        afterChars,', '        savedChars: 0,', '        foldedChunks: head.length,'].join(String.fromCharCode(10)),
    (m) => m.compressChunks(mkChunks(5), 2),
  )
  // 必红的判据：C1 断言 savedChars === beforeChars - afterChars（真差值）
  const realDiff = r.beforeChars - r.afterChars
  assert.notEqual(r.savedChars, realDiff, 'M2: 变异后 savedChars 与真差值脱钩（C1 的必红点）')
  assert.equal(r.savedChars, 0, 'M2: 回填成常量 0 —— 正是"读数与事实脱钩"的形态')
  assert.ok(realDiff > 0, 'M2 前置：现实里确实省了字（否则本对拍无意义）')
})

// ── M3：抹掉降级位（selector 抛错静默）⇒ C4 必红 ────────────────────────────
test('M3 抹掉 degraded 降级位 ⇒ C4"显式降级"腿必红', async () => {
  const r = await negativeControl(
    'M3',
    // ⚠ 原锚点 `degraded: true,` 在 lib 里命中 **0** 次（tsc 输出的是简写属性 `degraded,`）
    //   ⇒ 对拍退化为空转。改打**降级出口本身**：把 catch 分支的 `noop(true, …)` 改成 `noop(false, …)`
    //   —— 语义正是"抹掉降级位"，且该串在 lib 里唯一。
    "return noop(true, 'selector 抛错：' + msg + '；未压缩（显式降级，不吞异常）');",
    "return noop(false, 'selector 抛错：' + msg + '；未压缩（显式降级，不吞异常）');",
    (m) => m.compressChunks(mkChunks(5), 2, {}, () => { throw new Error('selector 炸了') }),
  )
  // 必红的判据：C4 断言 selector 抛错时 degraded === true
  assert.equal(r.degraded, false, 'M3: 变异后降级不再显式置位（C4 的必红点）')
  assert.equal(typeof r.failure, 'string', 'M3 前置：failure 字段仍在 —— 正说明"只看 failure 不够，degraded 才是关键位"')
})

// ── M4：抹掉 reduced（是否真省）⇒ C10 必红 ──────────────────────────────────
test('M4 reduced 恒 true ⇒ C10"如实报负"腿必红', async () => {
  const r = await negativeControl(
    'M4',
    'reduced: beforeChars > afterChars,',
    'reduced: true,',
    (m) => m.handoff(mkChunks(3, 30), 100),
  )
  // 必红的判据：C10 断言摘要反超时 reduced === false 且 savedChars < 0
  assert.equal(r.triggered, true, 'M4 前置：确实触发了压缩（否则测的不是这条腿）')
  assert.ok(r.savedChars < 0, 'M4 前置：本例摘要确实反超原文（savedChars<0）')
  assert.equal(r.reduced, true, 'M4: 变异后 reduced 恒 true ⇒ 与外层真实读数自相矛盾（C10 的必红点）')
})

// ── M6：把"压了但没够"重新报成"压住了" ⇒ C17 必红（独立复核席 2026-09-26 补）──────
//   洞的由来：cap=1 + 2 条时 keepRecent 夹住折叠量 ⇒ 末态 size 仍 2 > 上界 1，
//   而实现曾照报 compressed=true ⇒ 调用方读到"已压住"就不再兜底（**假绿**）。
//   本变异的语义**正是**那个坏形态：去掉"末态须回到上界内"这一条落地判据。
test('M6 去掉"末态真回到上界内"的落地判据 ⇒ C17 必红（"压了但没够"被报成"压住了"）', async () => {
  const r = await negativeControl(
    'M6',
    // ⚠ 锚点取**判据语句本身**（在 lib 里唯一），不取周围的注释/空白。
    'if (afterChars >= beforeChars || afterChunks > capacityChunks)',
    'if (afterChars >= beforeChars)',
    // 与 C17 甲腿完全同形的调用：2 条 / 容量 1 / keepRecent 缺省 1
    (m) => m.compressChunks(mkChunks(2, 100), 1),
  )
  // 必红的判据：C17 断言 compressed === false 且 capacityReached === false
  assert.equal(r.compressed, true, 'M6: 变异后把"压了但没够"报成"压住了"（这正是 C17 的必红点）')
  assert.equal(r.capacityReached, true, 'M6: 连带把"未达上界"也报成"已达"')
  assert.ok(
    r.afterChunks > 1,
    'M6: 而事实是末态条数仍 ' + r.afterChunks + ' > 上界 1 ⇒ 读数与事实脱钩（假绿）',
  )
})

// ── M5：抹掉截断量记账 ⇒ C11/C12 记账恒等式必红 ─────────────────────────────
test('M5 抹掉 truncatedChars 记账 ⇒ C11/C12 记账恒等式必红', async () => {
  const r = await negativeControl(
    'M5',
    // ⚠ 原锚点 `truncatedChars,` 在 lib 命中 **2** 次（初始化 `truncatedChars: 0,` 与真赋值各一处）
    //   ⇒ 闸⑥ 报红（那是对拍会打错靶的**如实**红）。改打**唯一的那条真赋值**：
    //   抹掉它 ⇒ 截断量恒为初始值 0 ⇒ 记账恒等式不成立。
    'truncatedChars = orig - codePointLen(body);',
    'truncatedChars = 0;',
    (m) => m.injectPlan(mkChunks(3, 30), 10), // 预算 10 < 单条 30 ⇒ 退化截断路径
  )
  // 必红的判据：C11/C12 断言 beforeChars === afterChars + droppedChars + truncatedChars
  assert.equal(r.truncated, true, 'M5 前置：确实发生了截断（否则测的不是这条腿）')
  assert.equal(r.truncatedChars, 0, 'M5: 变异后截断量恒 0 —— 截掉的内容无人记账')
  const identity = r.afterChars + r.droppedChars + r.truncatedChars
  assert.notEqual(identity, r.beforeChars, 'M5: 恒等式必须不成立（这正是 C11/C12 的必红点）')
  assert.ok(r.beforeChars > identity, 'M5: 少算的正是被截掉的那部分 ⇒ 内容被静默丢弃')
})
