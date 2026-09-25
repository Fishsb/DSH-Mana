/**
 * **A4-4 判据的执行体**：`user_model_history` 表已存在且**漂移可回溯**。
 *
 * 判据原文（`docs/mana-rollout-plan.md:600`）：
 *   `PRAGMA table_info(user_model_history)` + 做一次偏好更新后查历史行
 *   ⇒ 表存在且列齐（`key/old_value/new_value/confidence/at/source_evidence_id`）；
 *     更新后**新增一行**（证明漂移可回溯，而非 UPDATE 覆盖）。
 *
 * ── 本文件与 `packages/core/tests/user-model-history.test.mjs` 的分工（不重复）─────
 *   · core 侧 M1-M7 测的是 **core 服务面**（`svc.updateUserModel` 直调）；
 *   · 本文件测的是 **本包写面**（`service.updatePreference`）经本包装配后是否**同一事实**。
 *   两者**不是同一条腿的副本**：本包的写面是「受守卫包装」，包装写错（漏传字段、
 *   把 at 吃掉、或把内容中立守卫安在写之后）时 core 侧全绿而本包这条报红。
 *
 * ⚠ 用**临时库**（本仓硬纪律：绝不指向 `$DSH_HOME/memory/mana.db`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mount, tmpDir, columns, count, srcFingerprint, cloneAndMutate, expectRed } from './_harness.mjs'

const REQUIRED_COLS = ['key', 'old_value', 'new_value', 'confidence', 'at', 'source_evidence_id']

// ── A4-4 第一条腿：表存在且列齐 ─────────────────────────────────────────────
test('A4-4① 表存在且列齐（PRAGMA table_info 原文口径）', async () => {
  const { core, close } = await mount()
  const have = columns(core.db, 'user_model_history')
  assert.ok(have.length > 0, 'user_model_history 表必须存在（A4-4 要求阶段 0 预留）')
  for (const c of REQUIRED_COLS) {
    assert.ok(have.includes(c), '缺列 ' + c + '（实有：' + have.join(',') + '）')
  }
  close()
})

// ── A4-4 第二条腿：做一次偏好更新后**新增一行** ─────────────────────────────
test('A4-4② 经本包写面做一次偏好更新 ⇒ 历史表新增**恰好一行**', async () => {
  const { core, um, close } = await mount()
  const before = count(core.db, 'user_model_history')
  const r = um.updatePreference({ key: 'style', value: 'concise', sessionId: 's-a44', turnId: 1 })
  const after = count(core.db, 'user_model_history')

  assert.equal(after - before, 1, '一次更新必须**恰好**新增一行；实测 before=' + before + ' after=' + after)
  assert.equal(r.created, true, '首次写入应是新建')
  assert.equal(r.previousValue, null, '新建时旧值为 null（与"旧值是空串"可分辨）')
  const maxId = Number(core.db.prepare('SELECT max(id) m FROM user_model_history').get().m)
  assert.equal(r.historyId, maxId, '返回的 historyId 必须指向真落下的那一行（否则调用方拿到的句柄是假的）')

  // 第二次：必须是**追加**而不是覆盖 —— 这是"漂移可回溯"的全部意义。
  um.updatePreference({ key: 'style', value: 'detailed', sessionId: 's-a44', turnId: 2 })
  const hist = um.listHistory('style')
  assert.equal(hist.length, 2, '两次更新应留 2 行历史（**UPDATE 覆盖只会剩 1 行**）；实测 ' + hist.length)
  assert.equal(hist[0].new_value, 'concise')
  assert.equal(hist[1].old_value, 'concise', '历史行之间必须首尾相接（否则漂移链断开）')
  assert.equal(hist[1].new_value, 'detailed')
  close()
})

test('A4-4③ 写入字段逐列可核（包装不得吞掉/篡改调用方给的值）', async () => {
  const { core, um, close } = await mount()
  um.updatePreference({
    key: 'tone', value: 'plain', confidence: 0.8123,
    sourceEvidenceId: 'ev-42', sessionId: 's-x', turnId: 7, at: '2026-09-01T00:00:00.000Z',
  })
  const row = core.db.prepare('SELECT * FROM user_model_history WHERE key = ?').get('tone')
  assert.equal(row.old_value, null, '首行旧值应为 null')
  assert.equal(row.new_value, 'plain')
  assert.equal(row.confidence, 0.8123, 'confidence 未被改写（0.8123 这类值最容易被四舍五入吃掉）')
  assert.equal(row.source_evidence_id, 'ev-42', 'source_evidence_id 必须落到列上（漂移要能追到证据）')
  assert.equal(row.session_id, 's-x')
  assert.equal(row.turn_id, 7)
  assert.equal(row.at, '2026-09-01T00:00:00.000Z', 'at 被显式传入时必须原样落库（不能换成 now）')
  close()
})

test('A4-4④ 边界：显式 confidence=0 不得被当成"没传"而落成缺省 0.5', async () => {
  // 本仓同族缺陷（'||' 归一会吃掉 0）：0 是**合法置信度**，不是"空"。
  const { core, um, close } = await mount()
  um.updatePreference({ key: 'zero', value: 'v', confidence: 0 })
  const row = core.db.prepare('SELECT confidence FROM user_model WHERE key = ?').get('zero')
  assert.equal(row.confidence, 0, '显式 confidence=0 被改写为 ' + row.confidence)
  close()
})

// ── 负向对拍：把"追加"改成"覆盖" ⇒ 本判据必须报红 ───────────────────────────
test('A4-4【负向对拍】历史追加改成覆盖语义 ⇒ 判据必须报红（克隆变异，仓内零写入）', async () => {
  const before = srcFingerprint('core')
  /**
   * 变异体设计（**三次试错的结论，写在最前面免得后人重踩**）：
   *   目标 = 把「每次更新都追加一行」改成「每个 key 只留第一行」—— 正是"想清理历史"的人
   *   会写出的形态，而它恰好让漂移在数据上消失。
   *
   *   变异**必须**同时满足三条，缺一条测到的就不是"判据抓到了覆盖语义"：
   *     ① 仍是**一条** SQL 语句 —— 拼成 `DELETE ...; INSERT ...` 时 `prepare` 只编译第一条，
   *        实参 8 个无处落 ⇒ 抛 `column index out of range`（**本席实测第一次踩到**）；
   *     ② **占位符个数仍是 8** —— 加一个 `WHERE key = ?` 就变 9 个而实参仍 8 个 ⇒ 同一个报错
   *        （**本席实测第二次踩到**）；
   *     ③ **跑得通** —— 靠"加 UNIQUE 索引 + ON CONFLICT"会被 schema 建表顺序摆布，
   *        实测抛 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`
   *        （**本席实测第三次踩到**）。
   *   ⇒ 最终用 `?1..?8` 具名占位 + `INSERT ... SELECT ... WHERE NOT EXISTS`：
   *     一条语句、8 个占位符、无需任何约束，语义正是"只保留最初那一行"。
   *   ⚠ 上面这三次失败都**不是**判据的红，而是"变异把代码弄坏了"—— 本仓纪律：
   *     负向对拍必须能区分这两者，否则它给的是假信心。
   */
  const { entry } = cloneAndMutate(
    'core',
    ['index.ts', 'db.ts', 'domain.ts', 'event-types.ts', 'open.ts', 'schema.ts'],
    [
      [
        `INSERT INTO user_model_history
               (key, old_value, new_value, confidence, at, session_id, turn_id, source_evidence_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO user_model_history
               (key, old_value, new_value, confidence, at, session_id, turn_id, source_evidence_id)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
              WHERE NOT EXISTS (SELECT 1 FROM user_model_history WHERE key = ?1)`,
      ],
    ],
  )
  const { Context } = await import('@deepseek-ai/cordis')
  const coreMod = await import(entry)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(tmpDir(), 'mut.db'), backupEnabled: false })
  await new Promise((r) => setTimeout(r, 250))
  ctx.plugin(await import(join(process.cwd(), 'packages/user-model/src/index.ts')), {})
  await new Promise((r) => setTimeout(r, 250))
  const svc = ctx.get('mana-core')
  const um = ctx.get('mana-user-model')
  assert.ok(svc && um, '变异体必须仍能装配（否则测的是"变异把插件弄坏了"，不是判据的红）')

  um.updatePreference({ key: 'style', value: 'concise' })
  um.updatePreference({ key: 'style', value: 'detailed' })

  /**
   * ⚠ **直接形态**：在变异体上跑**原判据**（A4-4② 的那两句），断言它**必须报红**。
   *   不用 `assert.notEqual(hist.length, 2)` 那种写法 —— 那测的是"变异体长什么样"，
   *   不是"原判据有没有牙"。本仓纪律：负向对拍要证明的是**判据会红**，而不是变异体可辨认。
   */
  const red = expectRed(() => {
    assert.equal(um.listHistory('style').length, 2, '两次更新应留 2 行历史')
    assert.equal(um.listHistory('style')[1].old_value, 'concise', '历史行之间必须首尾相接')
  }, 'A4-4② 的"新增一行/历史首尾相接"断言')
  // 红的内容必须指向"行数不对"，而不是别的错（否则可能只是变异把代码弄坏了）
  assert.match(String(red.message), /2 行历史/, '报红的原因不是行数断言：' + red.message.slice(0, 200))
  assert.equal(um.listHistory('style').length, 1, '覆盖语义下应只剩 1 行（本轮实测读数，供复核）')
  svc.db.close()

  // 仓内零写入的证据：变异跑前/跑后 sha256 逐字相同。
  assert.deepEqual(srcFingerprint('core'), before, '变异不得写回仓内任何源文件（克隆必须只动临时副本）')
})
