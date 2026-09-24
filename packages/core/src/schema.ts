/**
 * Mana 存储 schema v0.1 —— **阶段 0 一次定死，后补代价高**。
 *
 * 本文件对《Mana v5 方案》§11.2 的 6 张表做了六处**必要订正**（均为工具实测所得，
 * 见《落地册》§1 条 3/4/8/9 与 §2 的 G3/G4/G5/G7）：
 *
 * | # | 方案原状 | 本文件的处置 |
 * |---|---|---|
 * | 1 | 六张表**无** `session_id`/`turn_id` | **补列**（G3）—— 不补则 I1/I2 不变式永久无可数之处 |
 * | 2 | DDL 内 `VIRTUAL TABLE`/`fts5`/`journal_mode`/`PRAGMA` **全为 0 命中** | 补 **FTS5 虚表** + WAL + busy_timeout（G5/G7） |
 * | 3 | 关键词检索用默认分词器 | 显式 `tokenize='trigram'` + **最小查询长度约束**（G5：默认分词器下中文 `MATCH` 恒 0 命中） |
 * | 4 | 无注入审计表 | **新建 `inject_log`** 作为 I1/I2 与降级判据的唯一落点 |
 * | 5 | 门控结果无处落 | `inject_log.gate` **枚举列**（五类取值，生产侧写死、消费侧只读） |
 * | 6 | 三处无虚表 | 建表语句统一走本文件，禁止在插件内散写 DDL |
 *
 * ⚠ **不可后补项**：扩展加载窗口只在**开库瞬间**存在（G4）—— 见 `src/db.ts` 的
 *   `openManaDb()`，它一律以 `{ allowExtension: true }` 开库。事后
 *   `enableLoadExtension(true)` 报 `Cannot enable extension loading because it was
 *   disabled at database creation.`（本仓实测），**只能删库重建**。
 */

/** 契约版本：灰度分版（§8 C11），v0.1 = S1 五类事件所需的最小存储面。 */
export const SCHEMA_VERSION = 'v0.1' as const

/**
 * 中文关键词检索的**最小查询长度**。
 *
 * 实测（本仓 2026-09-24 复现）：`tokenize='trigram'` 下 4 字查询 `'末那识'` 命中 1，
 * 而 **2 字查询返回 `[]` 且不报错**，与「库里本来就没有」完全同形（G5）。
 * ⇒ 短于本长度的查询必须**显式拒绝**，不得静默返回空集。
 */
export const MIN_QUERY_CHARS = 3

/** schema DDL：全部语句幂等（`IF NOT EXISTS`），可重复施加。 */
export const SCHEMA_SQL = `
-- ── 记忆项：方案 §11.2 的 memory_items + session_id/turn_id（G3）──────────────
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  source TEXT,
  tags TEXT,
  session_id TEXT,
  turn_id INTEGER,
  base_level_activation REAL DEFAULT 0,
  strength REAL DEFAULT 0.5,
  decay_factor REAL DEFAULT 0.5,
  retrieval_threshold REAL DEFAULT -2.0,
  jev_relevance REAL,
  jev_worth_keeping REAL,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_timestamps TEXT,
  access_count INTEGER DEFAULT 0,
  emotional_valence REAL DEFAULT 0,
  emotional_arousal REAL DEFAULT 0,
  vector BLOB,
  related_ids TEXT,
  retired INTEGER DEFAULT 0
);

-- ── 程序性规则（方案 §11.2 原样）────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_rules (
  id TEXT PRIMARY KEY,
  conditions TEXT NOT NULL,
  actions TEXT NOT NULL,
  utility REAL DEFAULT 0.5,
  success_rate REAL DEFAULT 0.5,
  cost REAL DEFAULT 0,
  strength REAL DEFAULT 0.5,
  source_goal_id TEXT,
  created_at TEXT NOT NULL
);

-- ── 目标栈（方案 §11.2 原样）────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  priority INTEGER DEFAULT 0,
  deadline TEXT,
  success_criteria TEXT,
  created_at TEXT NOT NULL
);

-- ── 用户模型（方案 §11.2 原样）──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_model (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  updated_at TEXT NOT NULL
);

-- ── 认知轨迹（方案 §11.2 + session_id/turn_id）──────────────────────────────
-- 阶段 6 回放、A1-1 端到端可追、M2 的 seq 无空洞判据均落在此表。
CREATE TABLE IF NOT EXISTS mana_trace (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  session_id TEXT,
  turn_id INTEGER,
  timestamp TEXT NOT NULL
);

-- ── JEV 判定日志（方案 §11.2 + session_id/turn_id）──────────────────────────
-- ⚠ A1-8 要求 degraded 与 gate **至少一个非空**；state_hash 是缓存键。
CREATE TABLE IF NOT EXISTS jev_log (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,
  source TEXT NOT NULL,
  state_hash TEXT,
  result_value TEXT,
  probability REAL,
  cached INTEGER DEFAULT 0,
  degraded INTEGER DEFAULT 0,
  latency_ms INTEGER,
  cost_usd REAL,
  session_id TEXT,
  turn_id INTEGER,
  created_at TEXT NOT NULL
);

-- ── 注入审计表（阶段 0 新建；方案 §11.2 未含此表）──────────────────────────
-- 这是 I1/I2 与降级判据的**唯一落点**，也是 fail-closed 门控「沉默地不注入但留痕」的载体。
CREATE TABLE IF NOT EXISTS inject_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  memory_id TEXT,
  block_id TEXT,
  injected_at TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN (
    'injected',
    'skip_no_candidate',
    'skip_below_threshold',
    'degraded_unavailable',
    'reset'
  )),
  degraded INTEGER NOT NULL DEFAULT 0,
  local_score REAL,
  jev_prob REAL,
  reset INTEGER NOT NULL DEFAULT 0
);

-- ── 中文词法检索：FTS5 虚表（显式 trigram 分词器）──────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
  content,
  summary,
  content='memory_items',
  content_rowid='rowid',
  tokenize='trigram'
);

-- ── 索引：I1/I2 的计数维度（session_id, turn_id）────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inject_log_session_turn ON inject_log(session_id, turn_id);
CREATE INDEX IF NOT EXISTS idx_inject_log_memory ON inject_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_mana_trace_session_turn ON mana_trace(session_id, turn_id);
CREATE INDEX IF NOT EXISTS idx_memory_items_session_turn ON memory_items(session_id, turn_id);
`

/**
 * 从 `SCHEMA_SQL` 解析出的目标列清单（表名 → 列定义数组）。
 *
 * ⚠ **为什么要解析而不是再写一份列清单**：再写一份就是**两个真源**，改 DDL 忘改清单
 *   就会漂移，而漂移本身又不可观测 —— 这与本仓「派生量唯一写者」（§8 C14）同一条纪律。
 *   `SCHEMA_SQL` 是唯一真源，本解析器只是它的读侧投影。
 */
export interface ParsedSchema {
  /** 表名 → 列定义（`{ name, def }`，`def` 是可直接进 `ALTER TABLE ... ADD COLUMN` 的片段）。 */
  tables: Map<string, { name: string; def: string }[]>
}

/**
 * 解析 `CREATE TABLE` 语句的列定义。
 *
 * 只认列定义，跳过表级约束（`PRIMARY KEY(...)` / `CHECK` / `UNIQUE` / `FOREIGN KEY` /
 * `CONSTRAINT`）—— 这些无法用 `ADD COLUMN` 施加，列入会造出必然失败的语句。
 * `CREATE VIRTUAL TABLE`（FTS5）**不解析**：虚表列由 fts5 自身管理，不参与补列。
 */
export function parseSchema(sql: string = SCHEMA_SQL): ParsedSchema {
  const tables = new Map<string, { name: string; def: string }[]>()
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    const table = m[1]!
    // 取括号内全部内容（按括号配对，容忍列定义里的括号，如 CHECK (gate IN (...))）。
    let i = re.lastIndex
    let depth = 1
    let buf = ''
    while (i < sql.length && depth > 0) {
      const c = sql[i]!
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) break
      }
      buf += c
      i++
    }
    re.lastIndex = i
    // 去行注释后按顶层逗号切分（同上，括号内的逗号不算分隔符）。
    const body = buf.replace(/--[^\n]*/g, '')
    const raw: string[] = []
    let d = 0
    let cur = ''
    for (const ch of body) {
      if (ch === '(') d++
      else if (ch === ')') d--
      if (ch === ',' && d === 0) {
        raw.push(cur)
        cur = ''
      } else cur += ch
    }
    if (cur.trim()) raw.push(cur)
    const cols = raw
      .map((c) => c.trim())
      .filter(Boolean)
      .filter((c) => !/^(PRIMARY|CHECK|UNIQUE|FOREIGN|CONSTRAINT)\b/i.test(c))
      .map((def) => {
        const name = (def.match(/^["`]?(\w+)["`]?/) ?? [])[1]
        return name ? { name, def } : null
      })
      .filter((c): c is { name: string; def: string } => c !== null)
    tables.set(table, cols)
  }
  return { tables }
}

/**
 * 按 `;` 切分 SQL 脚本 —— **引号/注释感知**。
 *
 * ⚠ 不能直接 `sql.split(';')`：`tokenize='trigram'` 这类字符串里的分号、行注释里的
 *   分号都会造成误切。本仓 DDL 现有注释用的是全角 `；`，但**不能依赖这个巧合** ——
 *   一旦有人写了个半角分号在注释里，切分就会静默错位。
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    // 行注释：跳到行尾（注释内容保留在语句里，SQLite 自己会忽略）。
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      const end = nl === -1 ? sql.length : nl
      cur += sql.slice(i, end)
      i = end
      continue
    }
    // 块注释。
    if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2)
      const end = close === -1 ? sql.length : close + 2
      cur += sql.slice(i, end)
      i = end
      continue
    }
    // 单引号字符串（`''` 是转义）。
    if (c === "'" || c === '"') {
      const quote = c
      let j = i + 1
      let lit = c
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            lit += quote + quote
            j += 2
            continue
          }
          lit += quote
          j++
          break
        }
        lit += sql[j]
        j++
      }
      cur += lit
      i = j
      continue
    }
    if (c === ';') {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  if (cur.trim()) out.push(cur)
  return out.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** 一条语句是否为 `CREATE TABLE`（**排除** `CREATE VIRTUAL TABLE`）。 */
function isPlainCreateTable(stmt: string): boolean {
  const head = stmt.replace(/^[\s;]+/, '').replace(/(--[^\n]*\n?|\/\*[\s\S]*?\*\/)/g, '').trim()
  return /^CREATE\s+TABLE\b/i.test(head) && !/^CREATE\s+VIRTUAL\s+TABLE\b/i.test(head)
}
export interface AppliedColumnMigration {
  table: string
  column: string
  /** 施加的 `ADD COLUMN` 片段。 */
  ddl: string
}

/** 一条**无法**自动补的列（SQLite `ADD COLUMN` 的硬限制），必须显式暴露而非静默跳过。 */
export interface BlockedColumnMigration {
  table: string
  column: string
  def: string
  /** 无法施加的原因（人类可读）。 */
  reason: string
}

/** createSchema 的结果 —— **把"做了什么"变成可断言的值**，而不是只返回 void。 */
export interface SchemaResult {
  /** 本次实际补上的列（空数组 = 无补列，是合法且常见的正常态）。 */
  applied: AppliedColumnMigration[]
  /** 无法自动补的列 —— **结构上不可能是空数组之外的静默态**：非空即须上层处理。 */
  blocked: BlockedColumnMigration[]
  /** 施加后的 `PRAGMA user_version`。 */
  userVersion: number
  /** 施加后各表的实际列数（表名 → 列数），供判据对照。 */
  columnCounts: Record<string, number>
}

/**
 * 建表 + **对存量库补列**。幂等。
 *
 * ⚠ **为什么必须有补列迁移**（本仓 2026-09-24 实测）：
 *   `SCHEMA_SQL` 全是 `IF NOT EXISTS`，它对**已存在的表**是**静默空操作** ——
 *   实测：存量库 `jev_log` 13 列，补上四列的 DDL 后重跑 `createSchema`，仍是 13 列、
 *   **不报错**。而落地册明文要求阶段 1 补 `input_chars`/`trimmed`、阶段 3 补
 *   `verdict`/`verify_state`（§1 条 6/8）⇒ 照原实现，**存量库永远得不到这些列，
 *   且失败完全不可观测**（这正是本仓最在意的缺陷类型：让失败不可见）。
 *
 * ⚠ **必须先全量预检、再动手**（本仓 2026-09-24 实测踩到）：
 *   SQLite 有一条硬限制 —— `ALTER TABLE ADD COLUMN` **不能加 `NOT NULL` 且无 `DEFAULT`**
 *   的列（报 `Cannot add a NOT NULL column with default value NULL`）。若边查边加，
 *   中途撞上这条就会**留下半迁移的库**（前面几列已加、后面的没加，且不自动回滚）。
 *   ⇒ 本函数先算出全部待补列、逐条判定可行性，**有任何一条不可行就整体拒绝并抛错**，
 *     不留下部分迁移状态。
 *
 * 边界（暂不做的事，明确写出而不是留空）：
 *   - **不删列**：`DROP COLUMN` 会毁数据；本仓尚无此需求。
 *   - **不改列类型 / 不给已有列加约束**：SQLite `ALTER TABLE` 不支持，须重建表 + 迁数据，
 *     属独立决策；此类需求会被 `blocked` 显式顶出来，而不是静默失败。
 *   - **索引不在此处补**：索引在 `SCHEMA_SQL` 里用 `IF NOT EXISTS` 表达，对新旧库都生效。
 */
export function createSchema(db: {
  exec(sql: string): unknown
  prepare(sql: string): { all(): unknown[]; get(): unknown }
}): SchemaResult {
  const applied: AppliedColumnMigration[] = []
  const columnCounts: Record<string, number> = {}
  const target = parseSchema()

  const actualCols = (table: string): string[] => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: string }[]
    return rows.map((r) => String(r.name ?? ''))
  }

  // ⚠ **施加顺序是正确性的一部分**（本仓 2026-09-24 实测踩到）：
  //   索引 `CREATE INDEX ... ON mana_trace(session_id, turn_id)` 在列缺失时**立即报错**
  //   （`no such column: turn_id`），而索引语句排在 DDL 末尾 ⇒ 若先整体 `exec(SCHEMA_SQL)`，
  //   存量库会在补列**之前**就抛错，补列根本轮不到执行。
  //   正确顺序 = ① 建表 → ② 补列 → ③ 索引/虚表等依赖列的语句。
  const statements = splitStatements(SCHEMA_SQL)
  const createTables = statements.filter(isPlainCreateTable)
  const dependents = statements.filter((s) => !isPlainCreateTable(s))

  // ① 建表：`IF NOT EXISTS` ⇒ 新库建成、存量库空操作。
  for (const s of createTables) db.exec(s)

  // ② 预检：算出全部待补列，并逐条判定 SQLite 能否施加。**动手前一并判定**。
  const pending: { table: string; name: string; def: string }[] = []
  for (const [table, cols] of target.tables) {
    const have = actualCols(table)
    if (have.length === 0) continue
    for (const col of cols) {
      if (!have.includes(col.name)) pending.push({ table, name: col.name, def: col.def })
    }
  }

  const blocked: BlockedColumnMigration[] = []
  for (const p of pending) {
    // SQLite `ALTER TABLE ADD COLUMN` 的硬限制（本仓实测）：
    //   · `NOT NULL` **且**无 `DEFAULT` ⇒ `Cannot add a NOT NULL column with default value NULL`
    //   · 带 `PRIMARY KEY` / `UNIQUE` ⇒ 同样不可施加
    const notNull = /\bNOT\s+NULL\b/i.test(p.def)
    const hasDefault = /\bDEFAULT\b/i.test(p.def)
    const pkOrUnique = /\b(PRIMARY\s+KEY|UNIQUE)\b/i.test(p.def)
    const reasons: string[] = []
    if (notNull && !hasDefault) reasons.push('NOT NULL 且无 DEFAULT（SQLite 不允许补此类列，须重建表迁数据）')
    if (pkOrUnique) reasons.push('含 PRIMARY KEY/UNIQUE（SQLite 不允许补此类列）')
    if (reasons.length) blocked.push({ table: p.table, column: p.name, def: p.def, reason: reasons.join('；') })
  }

  if (blocked.length) {
    // **整体拒绝**：宁可一列都不补，也不留下半迁移的库。
    throw new Error(
      'schema 迁移被拒绝：以下列无法用 ALTER TABLE 补（SQLite 硬限制），' +
        '须人工重建表并迁数据后再启动。未施加任何变更：\n' +
        blocked.map((b) => `  · ${b.table}.${b.column} —— ${b.reason}`).join('\n'),
    )
  }

  // ③ 补列（此刻已确认全部可施加）。
  for (const p of pending) {
    db.exec(`ALTER TABLE ${p.table} ADD COLUMN ${p.def}`)
    applied.push({ table: p.table, column: p.name, ddl: p.def })
  }

  // ④ 索引与虚表：此刻列已齐，才不会报 `no such column`。
  for (const s of dependents) db.exec(s)

  for (const table of target.tables.keys()) {
    const n = actualCols(table).length
    if (n > 0) columnCounts[table] = n
  }

  // user_version 只是**记账**：迁移逻辑由列 diff 驱动（幂等、不依赖版本号）。
  // 不把版本号当判据 —— 版本号可以撒谎，列的实际存在不会。
  const uv = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  const next = Math.max(Number(uv?.user_version ?? 0), 1)
  db.exec(`PRAGMA user_version=${next}`)

  return { applied, blocked: [], userVersion: next, columnCounts }
}

/** 关键词查询长度校验结果。 */
export type QueryCheck =
  | { ok: true; query: string }
  | { ok: false; reason: 'empty' | 'too_short'; chars: number; min: number }

/**
 * 校验中文关键词查询长度（G5）。
 *
 * 为什么必须显式拒绝：`trigram` 下 2 字查询返回 `[]` **且不报错**，与「库是空的」
 * 表面完全同形 ⇒ 静默归零会被误读成「没有匹配的记忆」。
 */
export function checkQuery(raw: string): QueryCheck {
  const query = String(raw ?? '').trim()
  const chars = [...query].length
  if (chars === 0) return { ok: false, reason: 'empty', chars, min: MIN_QUERY_CHARS }
  if (chars < MIN_QUERY_CHARS) return { ok: false, reason: 'too_short', chars, min: MIN_QUERY_CHARS }
  return { ok: true, query }
}
