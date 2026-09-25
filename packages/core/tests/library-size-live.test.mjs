/**
 * 收口 3 判据机检：`librarySize` 口径 = **活记忆数**（`retired = 0`），不是全表行数
 *
 * ── 判据原文与它保护的行为 ──────────────────────────────────────────────────
 * A1-10 的判红形态是「**库非空 && 0 命中 && reason='ok'**」。而 `reason` 由
 * `librarySize === 0 ? 'empty_library' : 'ok'` 决定 ⇒ **librarySize 是那条判据的分母**。
 *
 * ── 实害（S23 席实测，本文件即其回归闸）──────────────────────────────────
 * 库中**唯一一条**记忆已退休（retired=1）时：
 *   · 检索 SQL 已排除 retired 行 ⇒ hits=[]
 *   · 旧口径的全量计数 ⇒ librarySize=1 ⇒ reason='ok'
 *   ⇒ 于是「**有记忆但全退休**（0 命中是正确行为）」被读成「**库非空却查不到**（要判红）」
 *     = **正确行为被判成缺陷**（假红）。
 *
 * ── 前置控制不可省（本仓最防的「判据绿 ≠ 事实被检查」）─────────────────────
 * 若退休行**本来就命中不了**，那么"hits=[] / empty_library"就是**平凡通过** ——
 * 什么也没被证明。故 F0 先断言**该行确实还在 FTS 索引里可被 MATCH 命中**
 * （机制：FTS5 external content 表不自动跟随主表，而 schema 的 UPDATE 触发器把该行
 *   delete+insert 回索引，与 retired 的值无关）⇒ F1 的 0 命中**只可能**来自过滤腿。
 * F2 再把同一行 retired 改回 0（**同库、同词、同一次运行**）⇒ 必须立刻可见，
 * 证明本用例真在检查这条路径。
 *
 * ⚠ 本用例**只**覆盖 core 的生产路径 `recallLexical`。`packages/long-term/src/retirement.ts`
 *   的 `searchLiveMemories` 有**自己的 `librarySize`**（`counts.total`，口径见其源码），
 *   不在本判据的写面内 —— 未被本文件断言，也未因此被改动。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CORE = new URL('../src/index.ts', import.meta.url).href
const { openManaDb, apply } = await import(CORE)

const cleanups = []
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/** 连续子串（trigram 安全，见 lexical-audit.test.mjs 行 18-21 的语义说明）。 */
const QUERY = '末那识的'
const CONTENT = '末那识的记忆注入机制说明与容量上限'

/**
 * 夹具：临时库里**有且仅有一条**记忆，且它 `retired = 1`。
 * ⚠ 绝不指向 `$DSH_HOME/memory/mana.db` —— 路径由 mkdtempSync 生成，用后即删。
 */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-libsize-'))
  cleanups.push(dir)
  const dbPath = join(dir, 'mana.db')
  assert.ok(dbPath.startsWith(tmpdir()), `临时库必须在 tmpdir 内，实测 ${dbPath}`)
  const opened = openManaDb({ path: dbPath })
  let svc = null
  const ctx = {
    effect(fn) {
      const d = fn()
      return () => (typeof d === 'function' ? d() : undefined)
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
  svc.writeMemoryItem({ id: 'only', type: 'note', content: CONTENT })
  const info = svc.db.prepare('UPDATE memory_items SET retired = 1 WHERE id = ?').run('only')
  assert.equal(Number(info.changes), 1, '退休写入必须真的改到 1 行')
  return { svc, close: () => opened.close(), setRetired: (v) => svc.db.prepare('UPDATE memory_items SET retired = ? WHERE id = ?').run(v, 'only') }
}

/** 不带过滤的**原始索引读数**：证明退休行确实还在 FTS 里可命中。 */
const rawIndexMatches = (svc, q) =>
  Number(svc.db.prepare('SELECT count(*) n FROM memory_items_fts WHERE memory_items_fts MATCH ?').get(q).n)

/** 全量计数（= **旧口径**的读数）：仅用于「判据有牙」对照，不是被测对象。 */
const fullCount = (svc) => Number(svc.db.prepare('SELECT COUNT(*) c FROM memory_items').get().c)

// ── F0（前置控制·机制）退休行**仍在索引里**：0 命中不可能来自"这条本来就查不到" ──
test('F0 前置控制：库中唯一那条（retired=1）仍在 FTS 索引里可命中', () => {
  const { svc, close } = makeFixture()
  const n = rawIndexMatches(svc, QUERY)
  assert.equal(
    n,
    1,
    'raw FTS 应命中 1 条（退休行仍在索引）——若为 0，本用例退化为平凡通过（0 命中来自"查不到"而非过滤），必须重建反例',
  )
  assert.equal(fullCount(svc), 1, '前置：库中确实有且仅有 1 条记忆（全量计数=1）')
  close()
})

// ── F1（主判据）唯一那条已退休 ⇒ reason 必须是 empty_library（**不是** ok）、librarySize === 0 ──
test('F1 主判据：库中有且仅有一条记忆且其 retired=1 ⇒ empty_library 且 librarySize === 0', () => {
  const { svc, close } = makeFixture()

  // 判据有牙（同一夹具内自证）：全量计数 = 1 ⇒ 若 librarySize 退回全量口径，下面的断言必红。
  const before = fullCount(svc)
  assert.equal(before, 1, `负向对照：全量计数应=1（实测 ${before}）⇒ 口径若退回全量，本断言组必红`)

  const r = svc.recallLexical(QUERY)
  assert.equal(r.hits.length, 0, '退休行不得被返回（A2-7 过滤腿）')
  assert.equal(
    r.reason,
    'empty_library',
    `库中活记忆数为 0 ⇒ 0 命中是**正常**的（empty_library），实测 reason=${r.reason}、librarySize=${r.librarySize}；` +
      '报 ok 会把"有记忆但全退休"读成 A1-10 的判红形态（**假红**）',
  )
  assert.equal(r.librarySize, 0, `librarySize 口径 = 活记忆数（retired=0）⇒ 应为 0，实测 ${r.librarySize}`)
  close()
})

// ── F2（前置控制·同库同词）把该条 retired 改回 0 ⇒ 必须立刻可见 ────────────────
test('F2 前置控制：同库同词把 retired 改回 0 ⇒ reason === null 且 hits.length === 1', () => {
  const { svc, close, setRetired } = makeFixture()
  // 先确认退休态（否则下面的"改回 0"证明不了是本用例在检查该路径）
  assert.equal(svc.recallLexical(QUERY).reason, 'empty_library', '前置：退休态应为 empty_library')

  const info = setRetired(0)
  assert.equal(Number(info.changes), 1, '改回活态必须真的改到 1 行')

  const r = svc.recallLexical(QUERY)
  assert.equal(r.hits.length, 1, `同库同词改回 retired=0 后必须命中 1 条，实测 ${r.hits.length}`)
  assert.equal(r.hits[0].id, 'only')
  assert.equal(r.reason, null, '有命中时 reason 必须为 null')
  assert.equal(r.librarySize, 1, '活记忆数应变回 1（不是恒 0）')
  close()
})

// ── F3（防过度纠正）活记忆数须是**真计数**：库里有活记忆且查不到 ⇒ ok 且 >0 ────
test("F3 防过度纠正：库里有活记忆而查询查不到 ⇒ reason='ok' 且 librarySize > 0", () => {
  const { svc, close, setRetired } = makeFixture()
  setRetired(0) // 库里现在有 1 条**活**记忆
  const miss = svc.recallLexical('量子纠缠退相干')
  assert.equal(miss.hits.length, 0)
  assert.equal(miss.reason, 'ok', `库非空却 0 命中 ⇒ reason 须为 'ok'（**这才是 A1-10 判红的形态**），实测 ${miss.reason}`)
  assert.equal(miss.librarySize, 1, `活记忆数必须被真数出来（不得恒 0），实测 ${miss.librarySize}`)
  close()
})
