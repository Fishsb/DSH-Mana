/**
 * A2-7 判据机检：**退休行不泄漏进检索**（生产路径 = `core.recallLexical`）
 *
 * 判据原文（`docs/mana-rollout-plan.md:522`，逐字）：
 *   **A2-7 退休行不泄漏进检索**：检索 SQL 须 `AND retired=0` ⇒ 结果中 `retired=1`
 *   的 id 计数 **== 0**（判据表自附实测警告：**FTS 索引不会因 retired 自动剔除**）。
 *
 * ── 为什么本用例必须存在（而不是"long-term 侧已经绿了"）────────────────────────
 * A2-7 此前**只在 long-term 侧成立**：`packages/long-term/src/retirement.ts` 的
 * `LIVE_SEARCH_SQL` 带 `AND m.retired = 0`，但**生产检索路径在 core**——
 * `packages/core/src/index.ts` 的 `recallLexical` SQL **一条 retired 也没有**。
 * 本文件把该判据钉在**真正被调用的那条路径**上。
 *
 * ── 机制（本仓 2026-09-25 实测，不是推演）────────────────────────────────────
 * `memory_items_fts` 是 **external content** 虚表（`content='memory_items'`），
 * 它**不自动跟随主表**；而 `schema.ts` 的 UPDATE 触发器在 retire 时会把该行
 * **重新插回 FTS 索引**（触发器体是 delete+insert，与 retired 的值无关）。
 * ⇒ 退休行**仍在索引里可被 MATCH 命中**，"加了过滤"与"根本没这条"必须能被分辨。
 *
 * ── 前置控制不可省（本仓最防的「判据绿 ≠ 事实被检查」）──────────────────────
 * 若退休那条**本来就命中不了**，"结果里没有它"就是**平凡通过**——什么也没被证明。
 * 故 F0/F2 先断言**不带过滤时两条都命中**（真 FTS 路径，raw MATCH count = 2），
 * F1 才断言生产 API 只返回活行。**先生成反例、再判生产路径**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CORE = new URL('../src/index.ts', import.meta.url).href
const CORE_SRC_PATH = new URL('../src/index.ts', import.meta.url)
const { openManaDb, apply } = await import(CORE)

const cleanups = []
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/** 两条**内容完全相同**的记忆：同词同串 ⇒ 唯一差异只有 `retired` 位。 */
const SAME = '末那识的记忆注入机制说明与容量上限'
const QUERY = '末那识的' // 连续子串（trigram 安全，见 lexical-audit.test.mjs 行 18-21 的语义说明）

/**
 * 临时库 + 真 FTS 路径：两条同内容记忆（一个 retired=0，一个 retired=1）。
 * ⚠ 绝不指向 `$DSH_HOME/memory/mana.db` —— 路径由 mkdtempSync 生成，用后即删。
 */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-a27-'))
  cleanups.push(dir)
  // 库路径必须由本用例独享（防"跑在真实库上"的静默污染）
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

  svc.writeMemoryItem({ id: 'alive', type: 'note', content: SAME })
  svc.writeMemoryItem({ id: 'gone', type: 'note', content: SAME })
  // 退休 = 只置位、永不删行（§8.3）。走主表 UPDATE ⇒ 经真触发器回写 FTS。
  const info = svc.db.prepare('UPDATE memory_items SET retired = 1 WHERE id = ?').run('gone')
  assert.equal(Number(info.changes), 1, '退休写入必须真的改到 1 行')
  return { svc, close: () => opened.close() }
}

/** 不带过滤的**原始索引读数**：证明退休行确实还在 FTS 里可命中。 */
function rawIndexMatches(svc, query) {
  return Number(
    svc.db.prepare('SELECT count(*) n FROM memory_items_fts WHERE memory_items_fts MATCH ?').get(query).n,
  )
}

/** 不带过滤的 join 读数（= "若 SQL 少写 `AND m.retired = 0`"的结果），用于负向对照。 */
function noFilterIds(svc, query, limit = 50) {
  return svc.db
    .prepare(
      `SELECT m.id AS id
         FROM memory_items_fts f
         JOIN memory_items m ON m.rowid = f.rowid
        WHERE memory_items_fts MATCH ?
        LIMIT ?`,
    )
    .all(query, limit)
    .map((r) => r.id)
}

/** `retired=1` 的 id 计数 —— A2-7 的**唯一判据读数**。 */
function retiredLeakIds(svc, ids) {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  return svc.db
    .prepare(`SELECT id FROM memory_items WHERE retired = 1 AND id IN (${marks}) ORDER BY id`)
    .all(...ids)
    .map((r) => r.id)
}

// ── F0（前置控制·机制）退休行**仍在索引里**：FTS 不因 retired 自动剔除 ──────────
test('F0 A2-7 前置控制：退休行仍在 FTS 索引里可命中（防平凡通过）', () => {
  const { svc, close } = makeFixture()
  const ids = noFilterIds(svc, QUERY)
  // 这条断言一旦变红，说明"索引自动剔除退休行"了 ⇒ 此后 F1 的绿**不再有任何证明力**，
  // 必须先重建反例（本仓纪律：夹具绿 ≠ 真数据绿）。
  assert.equal(
    rawIndexMatches(svc, QUERY),
    2,
    'raw FTS 应命中 2 条（退休行仍在索引）——若为 1，本用例退化为平凡通过，必须重建反例',
  )
  assert.deepEqual(ids.sort(), ['alive', 'gone'], `不带过滤时应两条都命中，实测 ${JSON.stringify(ids)}`)
  assert.deepEqual(retiredLeakIds(svc, ids), ['gone'], '前置：不带过滤时确实"泄漏"了 retired=1 的那条')
  close()
})

// ── F1（A2-7 主判据）生产路径 `recallLexical` 结果中 retired=1 的计数 == 0 ────
test('F1 A2-7：生产 recallLexical 结果里 retired=1 的 id 计数 == 0', () => {
  const { svc, close } = makeFixture()

  // 前置控制（同库同词、同一次运行内）：不带过滤必须能命中 2 条。
  const control = noFilterIds(svc, QUERY)
  assert.equal(control.length, 2, `前置控制失败：不带过滤仅命中 ${control.length} 条 ⇒ 本用例无法证明过滤在起作用`)

  // 被测：生产 API
  const r = svc.recallLexical(QUERY)
  const ids = r.hits.map((h) => h.id)
  const leaked = retiredLeakIds(svc, ids)
  assert.equal(
    leaked.length,
    0,
    `retired 泄漏：recallLexical 返回了 retired=1 的 id ${JSON.stringify(leaked)}（结果 ${JSON.stringify(ids)}，` +
      '前置控制显示不带过滤会命中 2 条 ⇒ 泄漏是过滤腿缺失造成的，不是"该行本来就命中不了"）',
  )
  assert.deepEqual(ids, ['alive'], `只应返回活行，实测 ${JSON.stringify(ids)}`)
  assert.equal(r.reason, null, '有命中时 reason 应为 null（A1-10 的三种 0 命中形态不受本改动影响）')
  close()
})

// ── F2（判据有牙自证）"去掉过滤就泄漏"必须在同一夹具上被**造出来** ──────────────
test('F2 A2-7 判据有牙：同一夹具下"去掉 AND m.retired = 0"必须复现泄漏', () => {
  const { svc, close } = makeFixture()
  const leaked = retiredLeakIds(svc, noFilterIds(svc, QUERY))
  assert.deepEqual(
    leaked,
    ['gone'],
    '判据必须能抓到泄漏形态：无过滤的同一查询必须返回 retired=1 的 gone（否则 F1 是摆设）',
  )
  close()
})

// ── F3（白盒腿）生产 SQL 里过滤腿在册：防"夹具变了导致行为腿失去证明力" ────────
test('F3 A2-7 白盒腿：生产检索 SQL 里 AND m.retired = 0 在册', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(CORE_SRC_PATH, 'utf8')
  assert.ok(
    src.includes('AND m.retired = 0'),
    'packages/core/src/index.ts 的检索 SQL 必须含 AND m.retired = 0（A2-7 的全部要害）',
  )
  /**
   * ⚠ **S24 席更新（2026-09-25，有意契约变更，非放宽）** ──────────────────────────
   * 原断言是「`retired` 在**全文**中恰出现 1 次」，作为 S23「只做这一处最小改动」的机检腿。
   * 现生产代码**有意**多了第 2 处触面：`librarySize` 改为活记忆数（主持人裁定，
   * 见 `packages/core/tests/library-size-live.test.mjs` 与 `docs/handoff/S24.md`）。
   * ⇒ 原计数必然变红。**按本仓纪律不得为了让判据变绿而放宽它**，故此处改为
   * **更强**的形态（而不是把 1 改成 7）：
   *   · 只在**去注释后的生产代码**上数（原断言把注释也算进去 ⇒ 多写一个字的说明就变红，
   *     那是能被"改注释"糊弄的判据，本来就是弱点）；
   *   · 且这 2 处**必须逐个是 `retired = 0`（活行口径）** —— 于是任何"加一条 `retired = 1`
   *     的路径 / 裸 retired 引用 / 退化成不过滤"都会立刻点名，比原来的纯计数更紧。
   * 本契约若再变，须**显式更新这个集合**（而不是改个数字）—— 这正是不让它退化的原因。
   */
  const codeLines = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\*\/|\/\/)/.test(l))
  const retiredTouchpoints = codeLines.filter((l) => l.includes('retired'))
  assert.equal(
    retiredTouchpoints.length,
    2,
    `生产代码（去注释后）中 retired 触面应恰 2 处（librarySize 活记忆数 + 检索过滤腿），实测 ${retiredTouchpoints.length}：` +
      `\n${retiredTouchpoints.map((l) => '  · ' + l.trim()).join('\n')}`,
  )
  for (const l of retiredTouchpoints) {
    assert.match(
      l,
      /retired\s*=\s*0/,
      `每一处 retired 触面都必须是活行口径 \`retired = 0\`（新增 \`retired = 1\` / 裸引用即判红）：${l.trim()}`,
    )
  }
  assert.ok(
    retiredTouchpoints.some((l) => l.includes('AND m.retired = 0')),
    '其中必须仍含 A2-7 的检索过滤腿 AND m.retired = 0（它被换掉 = 本判据失去对象）',
  )
  assert.ok(
    retiredTouchpoints.some((l) => /COUNT\(\*\).*retired = 0/.test(l)),
    '另一处必须是 librarySize 的活记忆数计数（S24 裁定；它被删掉 = 口径退回全量，empty_library 会假红）',
  )
})
