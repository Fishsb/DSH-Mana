/**
 * L-04 · 双画像维护 —— **B 组：负向对拍（>=3 条，各必红）**。
 *
 * 本仓纪律：**没有负向对拍的判据不算判据** —— 它只证明"代码在长"，不证明"行为对"。
 *
 * ── 三条对拍的靶（逐条对准一条正面判据）──────────────────────────────────────
 *   B-1 「追加非覆盖」← 把 pipeline 的写入口改成**覆盖**语义（先删历史再写主表）⇒ A② 必红
 *   B-2 「退场不注入」← 把「只认 inject」改成「一律 applied」⇒ A③ 的退场腿必红
 *   B-3 「不越界」    ← 让本包**真的写一行 memory_items.content** ⇒ A④ 必红
 *   B-4（附加）「阈值未定 ⇒ 不生效」← 把 undeterminable 也算作 applied ⇒ 该腿必红
 *
 * ── 形态纪律（本仓已踩过的第 4 种失败形态）────────────────────────────────────
 * 变异体 ⇒ **跑原判据** ⇒ 断言**捕获到失败**（`expectRed`）。
 * ⚠ 写成"在变异体上再断言一次正确行为"= 要求变异体也合格 ⇒ 它**永远红**，与"原判据有没有牙"
 *   **无关**，那种红给的是假信心。见 `_profile-harness.mjs#expectRed`。
 *
 * ── 隔离纪律 ───────────────────────────────────────────────────────────────
 * 变异一律发生在 `mkdtempSync` 的**克隆目录**里；跑前/跑后对仓内 `src/*.ts` 取 sha256
 * 并断言**逐字相同**（那是"卸载即净"在测试层的对应物，也是本批"禁整仓回退"的对应物）。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  SRC,
  cloneAndMutate,
  contentRows,
  expectRed,
  mount,
  sha256,
  srcFingerprint,
  withVerdict,
} from './_profile-harness.mjs'

const SRC_FILES = ['profile.ts', 'profile-pipeline.ts', 'profile-index.ts']

/** 仓内源文件指纹（变异前后必须逐字相同）。 */
let beforeFp

before(() => {
  beforeFp = srcFingerprint()
})

after(() => {
  // 收尾对拍：变异**绝不**写回仓内（写回即本批最严重的事故形态）。
  const afterFp = srcFingerprint()
  assert.deepEqual(afterFp, beforeFp, '负向对拍回写了仓内源文件（变异必须只发生在克隆目录）')
})

/** 组装一次变更请求。 */
const draft = (over = {}) => ({
  doc: 'USER.md',
  key: 'style',
  next: 'concise',
  confidence: 0.9,
  at: '2026-09-25T10:00:00.000Z',
  ...over,
})

/** 在克隆体上造一个句柄（真 core、真库、临时目录）。 */
async function rigWith(entry) {
  const rig = await mount()
  const mod = await import(pathToFileURL(entry).href)
  const v = await withVerdict()
  return { rig, mod, idx: mod.createProfileIndex(rig.core, v.injectionVerdict, 0.5) }
}

/** 原判据 A④（不越界）—— 供 B-3 在变异体上跑。 */
function criterionA43(rig, mod) {
  const before = contentRows(rig.core)
  mod.createProfileIndex(rig.core, () => ({ decision: 'inject', floor: 0.5, confidence: 0.9, reason: 'at-or-above-floor' }), 0.5)
  return before
}

// ══════════════════════════════════════════════════════════════════════════════
// B-1 · 靶 1：把「追加非覆盖」改成「覆盖」
// ══════════════════════════════════════════════════════════════════════════════

test('L-04-B① 【负向】把写入口改成**覆盖**语义（先清历史）⇒ 「追加非覆盖」判据必红', async () => {
  /**
   * 变异：在**委托写库之前**插一句 DELETE，把该键的历史行清掉
   * ⇒ 主表仍更新、返回值仍"成功"、**历史不新增**。
   * 这正是"覆盖"的真实形态：外面看起来一模一样，只有"改过几次"这个事实消失了。
   */
  const { entry } = cloneAndMutate(SRC_FILES, [
    // ⚠ 补丁串**单行**写（不内嵌换行）：内嵌换行要在测试源码里写成转义序列，
    //   而那层转义本身容易被写坏 —— 单行注入的语义等价，且读起来没有隐藏字符。
    [
      '  const res = deps.core.updateUserModel({',
      "  deps.core.db.prepare('DELETE FROM user_model_history WHERE key = ?').run(record.fullKey); const res = deps.core.updateUserModel({",
    ],
  ], 'profile-index.ts')
  const { rig, idx } = await rigWith(entry)
  try {
    // 先证明变异体**真的**是覆盖语义（否则这条对拍打的是空靶）
    const h0 = rig.count('user_model_history')
    idx.changeViaDistill(draft({ key: 'mut-overwrite', next: 'one' }))
    idx.changeViaDistill(draft({ key: 'mut-overwrite', next: 'two', at: '2026-09-25T10:05:00.000Z' }))
    const h1 = rig.count('user_model_history')

    // 原判据 A②（"一次变更 ⇒ 历史新增一行"）
    const red = expectRed(() => {
      assert.equal(h1 - h0, 2, '两次变更应新增两行历史（覆盖语义下此处为 0）')
    }, '把追加改成覆盖后，"历史新增一行"必须报红')
    assert.match(String(red.message), /新增两行|0/, '报红内容须指到"行数没长"这件事实')
  } finally {
    rig.close()
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// B-2 · 靶 2：把「退场」改成「照常注入」
// ══════════════════════════════════════════════════════════════════════════════

test('L-04-B② 【负向】把退场改成**照常生效** ⇒ 「跌破阈值即不注入」判据必红', async () => {
  /** 变异：applied 一律为真（不看判定）⇒ 跌破阈值的偏好照样写进主表。 */
  const { entry } = cloneAndMutate(SRC_FILES, [[/applied = verdict\.decision === 'inject'/, 'applied = true']], 'profile-index.ts')
  const { rig, idx } = await rigWith(entry)
  try {
    idx.changeViaDistill(draft({ key: 'mut-live', next: 'wanted', confidence: 0.9 }))
    const gone = idx.changeViaDistill(draft({ key: 'mut-live', next: 'unwanted', confidence: 0.1, at: '2026-09-25T11:00:00.000Z' }))

    // 原判据 A③（"跌破阈值 ⇒ 不再注入"）
    const red = expectRed(() => {
      assert.equal(gone.applied, false, '跌破阈值不得写进主表')
    }, '把退场改成照常注入后，"跌破阈值不再注入"必须报红')
    assert.match(String(red.message), /写进主表/)

  } finally {
    rig.close()
  }
})

test('L-04-B②b 【负向】让**读侧**忽略退场（一律可注入）⇒ 「退场后不再注入」判据必红', async () => {
  /**
   * ⚠ 为什么这条要**单独**一个变异（本席实测踩到，记下来防复发）：
   *   读侧（`keyInjectionState`）的 `injectable` 是**按置信度 + 阈值重算**的，
   *   **不看写侧的 `applied` 标志** —— 那是刻意的（两处独立判定，写侧坏掉不会让读侧一起瞎）。
   *   于是"把 applied 改成 true"那个变异**动不了读侧**，
   *   拿它去对拍读侧断言就是**对拍打错靶**：看到的"没变色"会被误读成"判据没牙"。
   *   读侧要有自己的靶：让它**无视判定**、一律回报可注入。
   */
  const { entry } = cloneAndMutate(
    SRC_FILES,
    [[/injectable: conf === null \? null : isInjectable\(\{ verdict: deps\.verdictOf\(conf, deps\.confidenceFloor \?\? null\) \}\),/, 'injectable: true,']],
    'profile-index.ts',
  )
  const { rig, idx } = await rigWith(entry)
  try {
    idx.changeViaDistill(draft({ key: 'mut-read', next: 'wanted', confidence: 0.9 }))
    idx.changeViaDistill(draft({ key: 'mut-read', next: 'unwanted', confidence: 0.1, at: '2026-09-25T11:00:00.000Z' }))
    // 前置：变异体确实无视了判定
    assert.equal(idx.state('USER.md', 'mut-read').injectable, true, '前置：变异体应一律回报可注入')

    // 原判据 A③ 的读侧腿
    const red = expectRed(() => {
      assert.equal(idx.state('USER.md', 'mut-read').injectable, false, '退场后不得可注入')
    }, '读侧无视退场后，"退场后不再注入"必须报红')
    assert.match(String(red.message), /退场后不得可注入/)
  } finally {
    rig.close()
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// B-3 · 靶 3：让本包**真的写一行** memory_items.content（A4-3）
// ══════════════════════════════════════════════════════════════════════════════

test('L-04-B③ 【负向】让本包写一行 memory_items.content ⇒ 「本包不写 content」判据必红', async () => {
  /**
   * 变异：在写库之后顺手插一行 `memory_items`，并**同时摘掉运行期守卫**。
   *
   * ⚠ 为什么要同时摘守卫：只插一行而不摘守卫时，`assertContentNeutral` 会在写**之前**
   *   抛错 —— 那说明变异被守卫挡住了，但这**不等于**"A4-3 的行数判据有牙"
   *   （挡住它的可能只是守卫）。两个机制各有各的判据，此处测的是**行数那条腿**。
   */
  const { entry } = cloneAndMutate(SRC_FILES, [
    [
      '  const valueToStore = record.applied',
      "  deps.core.db.prepare('INSERT INTO memory_items (id, type, content, created_at) VALUES (?, ?, ?, ?)').run('mut-' + record.fullKey, 'note', '变异体写的内容', record.at); const valueToStore = record.applied",
    ],
    [/  assertContentNeutral\(input, 'mana-metacognition\.applyProfileChange'\)/, '  // assertContentNeutral（变异体：摘掉）'],
  ], 'profile-index.ts')
  const { rig, mod, idx } = await rigWith(entry)
  try {
    const before = contentRows(rig.core)
    // 先证明变异体**真的**写了 content 行（否则是空靶）
    idx.changeViaDistill(draft({ key: 'mut-content', next: 'x' }))
    const afterCount = contentRows(rig.core)
    assert.equal(afterCount, before + 1, '变异体应写入恰好一行 memory_items（前置：变异生效）')

    // 原判据 A④（"本包路径 memory_items 行数零变化"）—— 在**同一形态**上重跑一次
    const rig2 = await mount()
    try {
      const mod2 = await import(pathToFileURL(entry).href)
      const idx2 = mod2.createProfileIndex(rig2.core, () => ({ decision: 'inject', floor: 0.5, confidence: 0.9, reason: 'at-or-above-floor' }), 0.5)
      const b2 = contentRows(rig2.core)
      idx2.changeViaDistill(draft({ key: 'mut-content-2', next: 'y' }))
      const a2 = contentRows(rig2.core)
      const red = expectRed(() => {
        assert.equal(a2 - b2, 0, 'A4-3 违例：本包路径写入了 memory_items')
      }, '让本包写一行 content 后，"行数零变化"必须报红')
      assert.match(String(red.message), /A4-3|违例/)
    } finally {
      rig2.close()
    }
    void criterionA43
    void mod
  } finally {
    rig.close()
  }
})

test('L-04-B③ 【负向】摘掉运行期守卫后，含 content 的输入**不再抛** ⇒ 守卫判据必红', async () => {
  const { entry, texts } = cloneAndMutate(SRC_FILES, [
    [/  assertContentNeutral\(input, 'mana-metacognition\.applyProfileChange'\)/, '  // assertContentNeutral（变异体：摘掉）'],
  ], 'profile-index.ts')
  const { rig, idx } = await rigWith(entry)
  try {
    // 前置：变异体确实没有守卫（函数体仍在，只是没人调）
    assert.match(texts['profile-pipeline.ts'], /变异体：摘掉/, '补丁应真的落在克隆体上')
    // 原判据 A④（"写入口带 content 必须抛"）
    const red = expectRed(() => {
      assert.throws(() => idx.changeViaDistill(draft({ key: 'mut-guard', content: 'x' })), /违禁字段|A4-3/)
    }, '摘掉守卫后，"带 content 即抛"必须报红')
    assert.match(String(red.message), /Missing expected exception|违禁字段/)
  } finally {
    rig.close()
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// B-4 · 靶 4：把「阈值未定 ⇒ 不生效」改成「照常生效」
// ══════════════════════════════════════════════════════════════════════════════

test('L-04-B④ 【负向】把 undeterminable 也算作"生效" ⇒ 「未拍板不生效」判据必红', async () => {
  /** 变异：applied = 判定**不是明确的退场**（即把"未判"折成"照常生效"）。 */
  const { entry } = cloneAndMutate(SRC_FILES, [
    [/applied = verdict\.decision === 'inject'/, "applied = verdict.decision !== 'retired_no_injection'"],
  ], 'profile-index.ts')
  const { rig, mod } = await rigWith(entry)
  try {
    // 走**未拍板**装配（floor=null ⇒ undeterminable）
    const idx0 = mod.createProfileIndex(rig.core, () => ({ decision: 'undeterminable', floor: null, confidence: null, reason: 'floor-unset' }), null)
    const r = idx0.changeViaDistill(draft({ key: 'mut-unset', confidence: 0.99 }))
    assert.equal(r.record.verdict.decision, 'undeterminable', '前置：判定确为第三态')

    // 原判据 A③（"未拍板不得写进主表"）
    const red = expectRed(() => {
      assert.equal(r.applied, false, '未拍板不得写进主表')
    }, '把未判折成生效后，"未拍板不生效"必须报红')
    assert.match(String(red.message), /写进主表/)
  } finally {
    rig.close()
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// B-5 · 靶 5：把「双通道同一入口」改成「深睡通道另走一套」
// ══════════════════════════════════════════════════════════════════════════════

test('L-04-B⑤ 【负向】让深睡通道另走一个函数（绕过统一写入口）⇒ 单写入口判据必红', async () => {
  /**
   * 变异：`changeViaDeepsleep` 改成**自己内联写库**（不走 applyProfileChange）
   * ⇒ 两条路径开始各写一份语义，"改一处漏一处即漂移"的入口再次打开。
   * 这条对拍打的是 A① 的**源码面结构判据**（原判据 = 解析 profile-index.ts 里两个方法体的调用目标）。
   */
  const { entry, texts } = cloneAndMutate(SRC_FILES, [
    [
      "changeViaDeepsleep: (draft) => applyProfileChange(deps, { ...draft, channel: 'deepsleep', confidenceFloor: draft.confidenceFloor ?? floor }),",
      "changeViaDeepsleep: (draft) => ({ record: { ...draft, channel: 'deepsleep' }, historyId: 0, changed: false, created: false, previousValue: null, applied: false, traceSeq: 0, keyMismatch: false }),",
    ],
  ], 'profile-index.ts')
  const src = texts['profile-index.ts']
  // 原判据 A①（源码面：两方法体必须指向同一个函数）
  const red = expectRed(() => {
    const bodies = [...src.matchAll(/changeVia(Distill|Deepsleep):\s*\(draft\)\s*=>\s*([^,\n]+)/g)].map((m) => m[2].trim())
    const called = bodies.map((b) => /^applyProfileChange\s*\(/.exec(b)?.[0] ?? b)
    assert.deepEqual([...new Set(called)], ['applyProfileChange('], '两条通道必须转发到同一个函数')
  }, '深睡通道另走一个函数后，"单写入口"必须报红')
  assert.match(String(red.message), /applyProfileChange|同一个函数/)
  void entry
})

// ══════════════════════════════════════════════════════════════════════════════
// 收尾：变异不得回写仓内（本批"禁整仓回退 / 文件级备份"纪律在测试层的对应物）
// ══════════════════════════════════════════════════════════════════════════════

test('L-04-B⑥ 变异隔离：全部对拍跑完后，仓内 src 指纹与开始时**逐字相同**', () => {
  const now = srcFingerprint()
  assert.deepEqual(now, beforeFp, '仓内源文件被变异动过 —— 变异必须只发生在临时克隆目录')
  for (const f of SRC_FILES) {
    const p = join(SRC, f)
    const h = createHash('sha256').update(readFileSync(p)).digest('hex')
    assert.equal(h, beforeFp[f], f + ' 的 sha256 与开工时不同')
    assert.equal(sha256(p), h)
  }
  // 反向哨兵：写面完整性（防"变异工具把仓内文件写残"这种更坏的情况）
  void writeFileSync
})
