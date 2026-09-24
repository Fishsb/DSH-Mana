/**
 * A4-4 判据：`user_model_history` 表已存在且**漂移可回溯**
 *
 * 判据原文（`docs/mana-rollout-plan.md:600`）：
 *   `PRAGMA table_info(user_model_history)` + 做一次偏好更新后查历史行
 *   ⇒ 表存在且列齐（`key`/`old_value`/`new_value`/`confidence`/`at`/`source_evidence_id`）；
 *     更新后**新增一行**（证明漂移可回溯，而非 UPDATE 覆盖）。
 *
 * ⚠ **为什么这条判据重要**（落地册 §B5.2 明文）：
 *   `user_model` 是 UPDATE 覆盖、无历史行 ⇒ **「漂移」在数据上根本不存在**。
 *   到阶段 4 要做「30 天内改 ≥3 次」的判据时，**没有任何行可数** ——
 *   那不是"漂移很少"，而是"漂移不可观测"。而那时改表要动已上线数据面，
 *   故落地册明确要求**阶段 0 预留表结构**。
 *
 * ⚠ 本测试用临时库（本仓硬纪律：绝不指向 `$DSH_HOME/memory/mana.db`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const CORE = new URL('../src/index.ts', import.meta.url).href
const { openManaDb, createSchema, apply } = await import(CORE)

const cleanups = []
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'mana-umh-'))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/** 造一个最小 core 服务面（真 openManaDb + 真表结构，假 ctx）。 */
function makeService() {
  const opened = openManaDb({ path: join(tmpDir(), 'mana.db') })
  let svc = null
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return () => (typeof dispose === 'function' ? dispose() : undefined)
    },
    provide(_n, s) {
      svc = s
      return () => {
        svc = null
      }
    },
    get: (n) => (n === 'mana-core' ? svc : undefined),
    on: () => () => {},
  }
  apply(ctx, {
    storePath: opened.path,
    busyTimeoutMs: 5000,
    autoMigrate: true,
    backupEnabled: false,
    backupIntervalMs: 3600000,
    backupKeep: 2,
    backupDir: '',
  })
  assert.ok(svc, 'apply() 应 provide mana-core')
  return { svc, opened, close: () => opened.close() }
}

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => String(r.name))

// ── M1 表存在且列齐（判据原文第一腿）────────────────────────────────────────
test('M1 user_model_history 表存在且列齐', () => {
  const { svc, close } = makeService()
  const db = svc.db
  const have = cols(db, 'user_model_history')
  assert.ok(have.length > 0, 'user_model_history 表必须存在（A4-4 要求阶段 0 预留）')
  for (const c of ['key', 'old_value', 'new_value', 'confidence', 'at', 'source_evidence_id']) {
    assert.ok(have.includes(c), `缺列 ${c}（实有：${have.join(',')}）`)
  }
  // 追加面：本仓额外要求可分辨会话（与其它表口径一致）
  for (const c of ['session_id', 'turn_id']) {
    assert.ok(have.includes(c), `缺列 ${c}（漂移要能定位到哪一轮）`)
  }
  close()
})

// ── M2 更新后**新增一行**（判据原文第二腿：漂移可回溯）──────────────────────
test('M2 偏好更新后历史表新增一行（证明是追加而非 UPDATE 覆盖）', () => {
  const { svc, close } = makeService()
  const r1 = svc.updateUserModel({ key: 'style', value: 'concise', sessionId: 's1', turnId: 1 })
  assert.equal(r1.created, true, '首次应是新建')
  assert.equal(r1.previousValue, null, '新建时旧值为 null（与"旧值是空串"可分辨）')
  assert.equal(svc.listUserModelHistory('style').length, 1, '首次更新应记 1 行历史')

  const r2 = svc.updateUserModel({ key: 'style', value: 'detailed', sessionId: 's1', turnId: 2 })
  assert.equal(r2.created, false)
  assert.equal(r2.previousValue, 'concise', '必须能读到旧值（主表已覆盖，读不到就无从判漂移）')
  assert.equal(r2.changed, true)
  const hist = svc.listUserModelHistory('style')
  assert.equal(hist.length, 2, '第二次更新应再记一行 ⇒ 累计 2 行')
  assert.equal(hist[0].new_value, 'concise')
  assert.equal(hist[1].new_value, 'detailed')
  assert.equal(hist[1].old_value, 'concise', '历史行之间必须首尾相接')
  close()
})

// ── M3 主表仍是覆盖语义（历史不改变主表行为）───────────────────────────────
test('M3 主表保持覆盖语义：同 key 只留最新值', () => {
  const { svc, close } = makeService()
  svc.updateUserModel({ key: 'lang', value: 'zh' })
  svc.updateUserModel({ key: 'lang', value: 'en' })
  const row = svc.db.prepare('SELECT value FROM user_model WHERE key = ?').get('lang')
  assert.equal(row.value, 'en', '主表仍是 UPDATE 覆盖（原语义不变）')
  assert.equal(svc.listUserModelHistory('lang').length, 2, '但历史保留两行')
  close()
})

// ── M4 值未变时仍留痕（"改过但没改成"与"没改过"可分辨）──────────────────────
test('M4 值未变仍记一行且 changed=false（可分辨"没改过"）', () => {
  const { svc, close } = makeService()
  svc.updateUserModel({ key: 'tone', value: 'plain' })
  const r = svc.updateUserModel({ key: 'tone', value: 'plain' })
  assert.equal(r.changed, false, '值相同 ⇒ changed=false')
  assert.equal(svc.listUserModelHistory('tone').length, 2, '仍应留痕（否则"写过但没变"被静默丢掉）')
  close()
})

// ── M5 漂移可数（阶段 4「30 天内改 ≥3 次」的可执行前提）────────────────────
test('M5 按 key 数历史行 = 漂移次数可数（A4-4 的下游用途）', () => {
  const { svc, close } = makeService()
  const at = (n) => new Date(Date.parse('2026-09-01T00:00:00Z') + n * 86400000).toISOString()
  for (const [i, v] of ['a', 'b', 'c', 'd'].entries()) {
    svc.updateUserModel({ key: 'pref', value: v, at: at(i) })
  }
  const hist = svc.listUserModelHistory('pref')
  assert.equal(hist.length, 4, '4 次改动 ⇒ 4 行')
  // 升序且时间可比较（判据侧才能做「30 天内」窗口）
  assert.deepEqual(
    hist.map((h) => h.new_value),
    ['a', 'b', 'c', 'd'],
  )
  const times = hist.map((h) => Date.parse(h.at))
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] > times[i - 1], '历史应按时间升序')
  close()
})

// ── M6 索引存在（「30 天内 ≥3 次」的扫描前提）──────────────────────────────
test('M6 (key, at) 索引存在', () => {
  const { svc, close } = makeService()
  const idx = svc.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='user_model_history'")
    .all()
    .map((r) => String(r.name))
  assert.ok(
    idx.some((n) => n.includes('key_at')),
    `应有 (key,at) 索引供漂移扫描，实有：${JSON.stringify(idx)}`,
  )
  close()
})

// ── M7 存量库补表（迁移机制承接：老库也要长出这张表）──────────────────────
test('M7 存量库经 createSchema 后长出 user_model_history（迁移机制承接）', () => {
  const dir = tmpDir()
  const legacy = new DatabaseSync(join(dir, 'old.db'), { allowExtension: true })
  // 模拟阶段 0 早期建的库：只有 user_model，没有 history
  legacy.exec('CREATE TABLE user_model (key TEXT PRIMARY KEY, value TEXT NOT NULL, confidence REAL DEFAULT 0.5, updated_at TEXT NOT NULL)')
  assert.equal(cols(legacy, 'user_model_history').length, 0, '前置：老库确实没有该表')
  createSchema(legacy)
  assert.ok(cols(legacy, 'user_model_history').length > 0, 'createSchema 后老库必须长出该表')
  legacy.close()
})
