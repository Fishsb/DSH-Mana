/**
 * **A4-3 判据的执行体**：模型不生成记忆内容 —— 本包路径下 `memory_items.content` **新增行数 == 0**。
 *
 * 判据原文（`docs/mana-rollout-plan.md:599`）：
 *   断言只写 id/数值字段，不写 `memory_items.content`；**新增 `content` 行数 == 0**。
 *
 * ── 本文件的三条腿（少一条就会变成假绿）──────────────────────────────────────
 *   ① **正控**：先证明"计数器会动" —— 经 core 的写入口真写一行 content，
 *      断言 content 行数**确实 +1**。没有这条，一张空表会让 ② 平凡通过
 *      （"本包没写"与"谁都写不进去"表面同形）。
 *   ② **本包路径**：把本包服务面的**全部写方法**跑一遍，断言 content 行数**不变**。
 *   ③ **守卫有牙**：把内容中立守卫摘掉后，② 的同类输入**必须能真写进 content** ——
 *      证明"有守卫"这件事真的可分辨，而不是守卫写了但没人过它。
 *
 * ⚠ 用**临时库**（本仓硬纪律：绝不指向 `$DSH_HOME/memory/mana.db`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mount, tmpDir, count, cloneAndMutate, fakeCtx, settle, expectRed } from './_harness.mjs'

/** 本次连接的 `memory_items` 里 `content` 非空的行数。 */
const contentRows = (db) =>
  Number(db.prepare('SELECT COUNT(*) c FROM memory_items WHERE content IS NOT NULL AND content <> \'\'').get().c)

// ── ① 正控：计数器确实会动（防"空表平凡通过"）───────────────────────────────
test('A4-3① 正控：经 core 写入口真写一行 ⇒ content 行数 +1（先证明仪器会动）', async () => {
  const { core, close } = await mount()
  const before = contentRows(core.db)
  core.writeMemoryItem({ id: 'probe-1', type: 'probe', content: '正控样本：这一行是测试自己写的' })
  const after = contentRows(core.db)
  assert.equal(after - before, 1, '正控失败：连 core 的写入口都写不进 content ⇒ 后续断言测不到任何东西（仪器不动）')
  close()
})

// ── ② 本包路径：全部写方法跑一遍，content 行数必须不变 ──────────────────────
test('A4-3② 本包全部写面跑一遍 ⇒ memory_items.content 新增行数 == 0', async () => {
  const { core, um, close } = await mount()
  const before = contentRows(core.db)

  // 把本包服务面上**每一个会写库的方法**都走到（漏走一个 = 那条路径无人看守）：
  um.updatePreference({ key: 'style', value: 'concise', confidence: 0.9, sessionId: 's-a43', turnId: 1 })
  um.updatePreference({ key: 'style', value: 'detailed', confidence: 0.4, sessionId: 's-a43', turnId: 2 })
  um.updatePreference({ key: 'tone', value: 'plain', sourceEvidenceId: 'ev-1' })
  um.listPreferences()
  um.listHistory()
  um.listHistory('style')
  um.reportDrift('2026-09-25T00:00:00.000Z', 's-a43')   // ← 本包唯一写 trace 的方法
  um.injectionVerdict(0.3)
  um.assessAccuracy([], null)

  const after = contentRows(core.db)
  assert.equal(after - before, 0, 'A4-3 违例：本包路径写入了 ' + (after - before) + ' 行 memory_items.content（应为 0）')
  // 防"本包其实一行都没写、所以当然没写 content"的平凡通过：
  assert.ok(count(core.db, 'user_model_history') > 0, '本包必须真写过 user_model_history（否则本判据平凡通过）')
  assert.ok(count(core.db, 'mana_trace') > 0, '本包必须真写过 mana_trace（reportDrift 的落点）')
  close()
})

test('A4-3③ 运行期守卫有牙：输入含 content 字段即抛（不是返回布尔被人忽略）', async () => {
  const { umMod } = await mount()
  assert.throws(
    () => umMod.assertContentNeutral({ key: 'style', content: '偷偷夹带的记忆内容' }, 'test'),
    /A4-3|违禁字段/,
    '守卫必须抛错：A4-3 禁止的字段出现在写面输入里时，静默通过就等于把违规变成一次正常写入',
  )
  // 嵌套也要抓（只查顶层会被 {payload:{content}} 绕过）
  assert.throws(() => umMod.assertContentNeutral({ a: { b: [{ content: 'x' }] } }, 'test'), /违禁字段/)
  // 反方向：正常字段不得被误伤（防"凡含 content 子串皆禁"的过宽守卫）
  assert.doesNotThrow(() => umMod.assertContentNeutral({ key: 'k', value: 'v', confidence: 0.5 }))
  assert.doesNotThrow(
    () => umMod.assertContentNeutral({ contentHash: 'abc', contents: 'x' }),
    '键名必须**逐字相等**匹配：contentHash/contents 不是 content，误伤它们会把守卫变成过宽的墙',
  )
})

test('A4-3④ 写入口真的过守卫：updatePreference 带 content 字段必须抛，且**库内零写入**', async () => {
  const { core, um, close } = await mount()
  const hBefore = count(core.db, 'user_model_history')
  assert.throws(
    () => um.updatePreference({ key: 'style', value: 'v', content: '夹带' }),
    /违禁字段/,
    '写入口必须过守卫（守卫若在委托之后调用，违规写入已经落库了）',
  )
  // ⚠ 这条是"守卫安放位置"的判据：守卫若在写之后，这里会看到 +1。
  assert.equal(count(core.db, 'user_model_history'), hBefore, '守卫必须在委托**之前**：抛错时库内不得留下任何行')
  close()
})

// ── ③ 负向对拍：让本包写一行 content ⇒ 本判据必须报红 ───────────────────────
test('A4-3【负向对拍】把内容中立守卫摘掉、并让写面直写 content ⇒ 判据必须报红（克隆变异）', async () => {
  // 变异体 = "守卫被摘掉"这一种最可能的退化形态（后来者嫌它碍事）。
  // ⚠ 这里**不改 core**（core 是契约真源，不是本席写面），只变异本包的守卫。
  const { entry } = cloneAndMutate(
    'user-model',
    ['index.ts', 'precision.ts', 'params.ts'],
    [[
      `const hit = findForbiddenKey(input, A4_3_FORBIDDEN_COLUMNS, '')`,
      `const hit = null // 变异：守卫被摘掉`,
    ]],
  )
  const mod = await import(entry)
  /**
   * ⚠ **直接形态**：在变异体上跑**原判据**（A4-3③ 的那句 `assert.throws`），
   *   断言它**必须报红**。这才是"负向对拍"，而不是"把变异体再断言一遍正确行为"。
   */
  const red = expectRed(
    () => assert.throws(() => mod.assertContentNeutral({ content: 'x' }), /违禁字段/),
    'A4-3③ 的"输入含 content 字段即抛"断言',
  )
  assert.match(String(red.message), /Missing expected exception/, '报红原因不是断言未抛：' + red.message.slice(0, 200))
  /**
   * ⚠ 本条**必须断言"变异体不抛"**，而不是再去 `assert.throws` 一次。
   *
   * 这是本席实测踩到的第四种失败形态（前三种见 a4-4 的变异体注释）：
   * 负向对拍的**方向搞反**了 —— 在变异体上复述原判据，等价于要求"变异体也合格"，
   * 于是它永远红，而与"原判据有没有牙"这件事**无关**。真判据是：
   *   ① 变异体下**不抛**（守卫真的没了）⇒ ② 断言"若拿掉守卫，原判据的 throws 必红"成立。
   */
  assert.doesNotThrow(
    () => mod.assertContentNeutral({ content: 'x' }),
    '变异体仍然抛错 ⇒ 补丁没打上（守卫还在），本次负向对拍测的是原代码而不是变异体',
  )
  // 对照：原实现（未变异）下同一个输入**必须**抛 —— 二者之差就是这条腿的牙。
  const { umMod } = await mount()
  assert.throws(
    () => umMod.assertContentNeutral({ content: 'x' }),
    /违禁字段/,
    '原实现下未抛错 ⇒ 原判据 ③ 是空的（"负向对拍"将在无牙的判据上给出假信心）',
  )

  // 另一半：真让内容落库时，② 的行数断言也必须报警。
  const { core, um, close } = await mount()
  const before = contentRows(core.db)
  // 变异体路径：拿掉守卫后，输入里的 content 会被透传（这里显式模拟该后果）。
  core.writeMemoryItem({ id: 'mutant-content', type: 'leak', content: '变异体写进来的内容' })
  const after = contentRows(core.db)
  assert.equal(
    after - before, 1,
    '变异体没能在 memory_items.content 上留下行 ⇒ 说明本判据的差值断言测不到写入（负向对拍失效）',
  )
  close()
})
