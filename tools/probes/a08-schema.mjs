// A0-8 session_id/turn_id 已补 + inject_log 表已建 + **存量库补列真生效**
//
// ⚠ 本探针修了一处**盲区**（本仓 2026-09-24 实测）：
//   旧版只查 `inject_log` 的列，于是 `createSchema` 对存量库**静默空操作**
//   这件事**任何机检都发现不了**。落地册明文要求阶段 1 给 `jev_log` 补
//   `input_chars`/`trimmed`、阶段 3 补 `verdict`/`verify_state`（§1 条 6/8）
//   ⇒ 旧实现下这些列**永远不会出现在存量库**，且不报错。
//
// ⚠ 反「自证」纪律：**不用本仓解析器交叉验证本仓解析器**（那是循环论证 ——
//   解析器漏掉的列，判据也会一起漏掉）。这里用**差分判据**：
//   故意造一个「缺列的旧库」→ 施加 createSchema → 与「全新库」的列集合**逐表比对**。
//   两者不一致即证明迁移没生效；这个判据无法被解析器的盲区骗过。
//
// ══ G3b 席（2026-09-26）补的第二处盲区：**差分两端同源 ⇒ 删列不可见** ══════════
// ⚠ 实测（本席在 /tmp 副本上做的对拍，非推断）：
//   ① 旧库只建 `jev_log`/`mana_trace` 两张表 ⇒ `memory_items` **根本不进比对面**；
//   ② 更关键的是：**比对的「全新库」与「旧库」两端都从 SCHEMA_SQL 派生**
//      （fresh ← 全文 DDL；old ← `keepOnlyRequired(parseSchema())` = 同一 DDL 的投影）
//      ⇒ 从 DDL 里**干净地删掉一列**（连同逗号）时，**两端同时少列 ⇒ 差集恒空**。
//   实测读数（删 `update_history` 列定义，两种形态）：
//     · 旧实现 + 只加 memory_items 建表：applied 33→32，mismatches 恒 `[]` ⇒ **仍 PASS**（盲区未消）
//     · 现在（加下方**独立锚点**）：mismatches 报出契约列缺失 ⇒ **A0-8 报红**（见 `contractMissing`）
//   ⇒ 结论：**只补「旧库也建 memory_items」不足以消掉这个盲区**。差分需要第三个
//     **不来自 SCHEMA_SQL 的**参照物，否则它与被测物同源共变。
//
// ⚠ 独立锚点 = **消费方契约**（`packages/reconsolidation/src/columns.ts` 的
//   `REQUIRED_COLUMNS`）—— 它声明的是「本系统**必须**有哪两列」，不是「DDL 里写了哪两列」。
//   这两个问题在删列场景下答案不同，正是判据要的**独立性**。
//   ⚠ 锚点只读、且**不复制清单**（复制就是第二份真源，会漂）；导入失败时如实报
//     `contractAnchor: 'unavailable: …'`，**不据此判红**（见下方注释：那是归属缺口，
//     不是本项的判定面 —— 假红会把这判据退化成噪声）。
//   ⚠ a0-check 的判据逻辑（`staticOk && migrationOk && atomicOk`）**本次一行未动**：
//     本席只**补观察面** —— 把「迁移后的旧库缺契约列」并入既有字段 `migrationMismatches`，
//     由 a0 那条**未改动**的表达式自行判红。
//
// ⚠ 探针**必须自己收口**（G3b 补的第三点）：旧版无 try/catch ⇒ 一崩就「没有读数」。
//   实测踩到（干净删列导致 DDL 语法错时的形态）：崩溃栈进了 stderr，而 a0 的
//   `evalJson` 取 `stderr.slice(0,400)` —— 那 400 字节被 `UNDICI-EHPA` 与
//   `ExperimentalWarning: SQLite` 两条**启动期警告**占满，真因一个字都读不到。
//   ⇒ 现改为整体 try/catch，崩了在 **stdout** 产出一行可判的
//     `{"ok":false,"error":"…"}`（stdout 不受那两条警告挤占），并以 exit 0 结束 ——
//     让「失败」以**数据**的形式被读到，而不是以「无输出」的形式消失。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const here = new URL('../../packages/core/src/db.ts', import.meta.url).href
const { openManaDb } = await import(here)
const { createSchema } = await import(new URL('../../packages/core/src/schema.ts', import.meta.url).href)

const dir = mkdtempSync(join(tmpdir(), 'mana-a08-'))
const opts = { allowExtension: true }

/** 各表实际列名（按 cid 序）。 */
const colsOf = (db, t) =>
  db
    .prepare(`PRAGMA table_info(${t})`)
    .all()
    .map((x) => String(x.name))

/** 库里的普通表名（排除 fts5 影子表）。 */
const tablesOf = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => String(r.name))
    .filter((n) => !/_data$|_idx$|_content$|_docsize$|_config$/.test(n))
    .filter((n) => !n.endsWith('_fts'))
    .sort()

let fresh = null
let oldBound = null
try {
  // ── 基准：全新库（DDL 完整施加）──────────────────────────────────────────────
  const freshDb = openManaDb({ path: join(dir, 'fresh.db') })
  fresh = freshDb
  const freshCols = {}
  for (const t of tablesOf(freshDb.db)) freshCols[t] = colsOf(freshDb.db, t)

  // ── 对照：故意「缺列的旧库」────────────────────────────────────────────────
  // ⚠ 必须**写实地**模拟存量库：保留全部 `NOT NULL` / `PRIMARY KEY` 列（真实的旧库由
  //   同一份 DDL 建出，这些列必然在），只省略**后加的 nullable 列**（阶段 1/3 要补的
  //   `input_chars`/`trimmed`/`verdict`/`verify_state` 正是 nullable）。
  //   ⇒ 若把 NOT NULL 列也省掉，测的就不是迁移而是 SQLite 硬限制（见下方负例）。
  //   列清单由**目标 schema 自身**推出，避免手写第二份清单（那会引入漂移面）。
  const { parseSchema } = await import(new URL('../../packages/core/src/schema.ts', import.meta.url).href)
  const target = parseSchema().tables
  const old = new DatabaseSync(join(dir, 'old.db'), opts)
  oldBound = old
  /** 只保留 NOT NULL / PRIMARY KEY 列 —— 即「旧库本来就有」的那批。 */
  const keepOnlyRequired = (cols) =>
    cols.filter((c) => /\bNOT\s+NULL\b/i.test(c.def) || /\bPRIMARY\s+KEY\b/i.test(c.def))

  // ⚠ G3b：旧库必须**真建 `memory_items`**（旧版只建 jev_log/mana_trace ⇒ 它在结构上
  //   看不到 `memory_items` 的后加两列）。同一策略（只留 NOT NULL/PK），但**必须真
  //   CREATE TABLE** —— 否则「列 diff 覆盖了 memory_items」这件事仍然不可观测。
  for (const t of ['jev_log', 'mana_trace', 'memory_items']) {
    const cols = keepOnlyRequired(target.get(t) ?? [])
    old.exec(`CREATE TABLE ${t} (${cols.map((c) => c.def).join(', ')})`)
  }
  // 补一行「迁移前就存在」的数据：证明**补列不毁数据**（迁移最该守住的底线）。
  // ⚠ 该行必须在 createSchema **之前**插入才能证明这一点。INSERT 的列由目标 schema 的
  //   NOT NULL 列自动生成 —— 手写列名会在 DDL 变化时静默失配（本仓踩过同类）。
  // ⚠ G3b：`memory_items`（本批真被迁移的那张表）**也要有存量行** —— 否则「补列不毁
  //   数据」只对 jev_log 成立，而它这轮根本没被补过列，那条腿打不到靶上。
  const insertSentinel = (db, table, idCol, idVal) => {
    const req = keepOnlyRequired(target.get(table) ?? [])
    const names = req.map((c) => c.name)
    const values = names.map((n) => {
      if (n === idCol) return idVal
      if (/\bTEXT\b/i.test(req.find((c) => c.name === n)?.def ?? '')) return 'sentinel'
      return '1'
    })
    db.exec(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${values.map((v) => `'${v}'`).join(', ')})`)
  }
  insertSentinel(old, 'jev_log', 'id', 'sentinel-row')
  insertSentinel(old, 'memory_items', 'id', 'sentinel-mem-row')

  const migration = createSchema(old)

  const degraded = {}
  for (const t of tablesOf(old)) degraded[t] = colsOf(old, t)

  /** 逐表比对「迁移后的旧库」vs「全新库」。 */
  const mismatches = []
  for (const [t, want] of Object.entries(freshCols)) {
    const got = degraded[t]
    if (!got) {
      mismatches.push(`${t}: 迁移后仍不存在`)
      continue
    }
    const missing = want.filter((c) => !got.includes(c))
    if (missing.length) mismatches.push(`${t}: 缺 ${missing.join(',')}`)
  }

  // ── 独立锚点：消费方契约声明的必需列（**不来自 SCHEMA_SQL**）──────────────────
  // ⚠ 为什么必须有它：上面的差分两端同源于 SCHEMA_SQL ⇒ 从 DDL 里干净删掉一列时
  //   两端同时少列、差集恒空（本席 /tmp 副本实测：applied 33→32、mismatches 仍 []）。
  //   契约列清单来自**消费方**（reconsolidation 声明「我必须有哪些列」），
  //   与「DDL 里写了哪些列」是两个不同的问题 ⇒ 删列时两个答案不同，判据因此有牙。
  let contractCols = null
  let contractAnchor = 'ok'
  try {
    const m = await import(new URL('../../packages/reconsolidation/src/columns.ts', import.meta.url).href)
    const list = m.REQUIRED_COLUMNS
    if (Array.isArray(list) && list.length > 0) contractCols = list.map(String)
    else contractAnchor = `unavailable: REQUIRED_COLUMNS 为空或非数组（${JSON.stringify(list)}）`
  } catch (error) {
    // ⚠ 锚点不可用**不判红**：那是「契约归属面搬走了」的缺口，不是本项（迁移是否生效）
    //   的判定面 —— 据此判红会造出与本项无关的假红，把判据退化成噪声
    //   （阈值纪律：判据红必须能归因到真因）。但它**必须可见**：留在 `contractAnchor` 字段里。
    contractAnchor = `unavailable: ${error?.message ?? error}`
  }
  const contractMissing = contractCols ? contractCols.filter((c) => !(degraded['memory_items'] ?? []).includes(c)) : []
  if (contractMissing.length) {
    mismatches.push(
      `memory_items: 契约列缺失 ${contractMissing.join(',')}（消费方 REQUIRED_COLUMNS 声明必需；` +
        `DDL 未声明 ⇒ createSchema 的列 diff 无从补起）`,
    )
  }

  // ── 负例：不可补的列必须**整体拒绝**且不留半迁移态（原子性判据）──────────────
  // 造一个缺 `NOT NULL` 列的库：SQLite 不允许 ADD，实现必须先预检再拒绝。
  const bad = new DatabaseSync(join(dir, 'blocked.db'), opts)
  bad.exec('CREATE TABLE mana_trace (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL)')
  let blockedThrew = false
  let blockedLeftPartial = false
  try {
    createSchema(bad)
  } catch {
    blockedThrew = true
    // 拒绝后该表**一列都不该被加上**（连可补的列也不能先加上去）。
    const after = colsOf(bad, 'mana_trace')
    blockedLeftPartial = after.length !== 2
  }
  bad.close()

  // ── A0-8 原有的硬判据（保留，不因新判据而放松）──────────────────────────────
  const need = ['session_id', 'turn_id', 'memory_id', 'block_id', 'injected_at', 'gate', 'degraded', 'local_score', 'jev_prob', 'reset']
  const injCols = colsOf(freshDb.db, 'inject_log')
  let badGateRejected = false
  try {
    freshDb.db
      .prepare('INSERT INTO inject_log (session_id,turn_id,request_id,injected_at,gate) VALUES (?,?,?,?,?)')
      .run('s', 1, 'r', 't', 'bogus')
  } catch {
    badGateRejected = true
  }
  const traceCols = colsOf(freshDb.db, 'mana_trace')
  const memCols = colsOf(freshDb.db, 'memory_items')
  const jevCols = colsOf(freshDb.db, 'jev_log')
  const fts = freshDb.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_items_fts'").get()

  // 索引：旧库补列后索引必须也建起来（顺序错则建索引时报 `no such column`）。
  const idxCount = old.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").get().c
  // 数据未毁：补列前的那行必须还在（**两张表各查一次** —— memory_items 是本轮真被补列的表）。
  const sentinelJev = old.prepare('SELECT COUNT(*) c FROM jev_log WHERE id=?').get('sentinel-row').c
  const sentinelMem = old.prepare('SELECT COUNT(*) c FROM memory_items WHERE id=?').get('sentinel-mem-row').c

  console.log(
    JSON.stringify({
      ok: true,
      missing: need.filter((c) => !injCols.includes(c)),
      hasTraceST: traceCols.includes('session_id') && traceCols.includes('turn_id'),
      hasMemST: memCols.includes('session_id') && memCols.includes('turn_id'),
      hasJevST: jevCols.includes('session_id') && jevCols.includes('turn_id'),
      badGateRejected,
      fts: !!fts,
      journalMode: freshDb.journalMode,
      schemaVersion: freshDb.schemaVersion,
      // ── 新增：存量库迁移真生效的差分证据 ──
      migrationApplied: migration.applied.length,
      migrationMismatches: mismatches,
      migrationIndexes: Number(idxCount),
      migrationSentinelKept: Number(sentinelJev) === 1 && Number(sentinelMem) === 1,
      migrationSentinelDetail: `jev_log=${sentinelJev} memory_items=${sentinelMem}`,
      // ── G3b：独立锚点（消费方契约）与它的读数 ──
      contractAnchor,
      contractMissing,
      contractColumns: contractCols ?? [],
      // 不可补的列 ⇒ 必须整体拒绝且不留半迁移态
      blockedThrew,
      blockedLeftPartial,
    }),
  )
} catch (error) {
  // ⚠ 崩溃**必须变成可判读数**（旧版无此段 ⇒ 无输出 ⇒ 只能读到被启动期警告占满的
  //   stderr 前 400 字节，真因不可见）。走 stdout：它不被那两条警告挤占。
  // ⚠ 不填任何被判字段（missing/migrationMismatches/…）：判据侧只看既有那几个字段，
  //   留空即让未改动的 `staticOk` 自行判红，而不是由探针替判。
  console.log(
    JSON.stringify({
      ok: false,
      error: String(error?.message ?? error),
      errorName: String(error?.name ?? 'Error'),
      stackHead: String(error?.stack ?? '').split('\n').slice(0, 4).join(' | '),
    }),
  )
} finally {
  try { fresh?.close() } catch { /* ignore */ }
  try { oldBound?.close() } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true })
}
