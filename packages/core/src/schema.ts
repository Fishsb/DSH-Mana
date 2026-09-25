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
  retired INTEGER DEFAULT 0,
  -- ── L-00 契约补列（2026-09-25 由 F1 契约补列席补入；**最小集，只补这两列**）──────────
  -- ⚠ 为什么只补这两列、不预补 v10 §36 的其余 10 列：
  --   无写者的列进来只会变成下一个「列在写者不在」——即列存在但**没有任何生产路径写它**，
  --   于是「功能已实现」与「列摆着没人用」在数据上完全同形。按需补、不预补。
  -- ⚠ 列名/类型**逐字**对齐消费侧探测面（packages/reconsolidation/src/columns.ts 的
  --   REQUIRED_COLUMNS 与 updates.ts 的读写代码）：
  --     · reconsolidation_window_until —— 再巩固窗口落点，写 ISO 串（toISOString()，
  --       与 created_at 同口径；closeDueWindows 靠**固定宽度 UTC 串的字典序 == 时间序**比较）；
  --     · update_history —— 内容更新历史，写 JSON 数组（stringify 后的文本）。
  --   两列都**可空且无 DEFAULT**，这是 SQLite ALTER TABLE ADD COLUMN 的硬限制所要求的
  --   （带 NOT NULL 又无 DEFAULT 时 SQLite 直接拒绝，见本文件 createSchema 的 blocked 预检）。
  -- ⚠ 这两列**只补表定义**，不动迁移机制：createSchema 由**列 diff**驱动
  --   （版本号可以撒谎，列的实际存在不会），故存量库由既有 ALTER TABLE 通道自动跟上。
  reconsolidation_window_until TEXT,
  update_history TEXT
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

-- ── 用户模型历史（**A4-4 要求阶段 0 预留**；方案 §11.2 未含此表）──────────────
-- ⚠ 为什么必须在阶段 0 就建（落地册 §B5.2 行 585/588/591 明文）：
--   user_model 是 **UPDATE 覆盖**、无历史行 ⇒ **「漂移」在数据上根本不存在**，
--   到阶段 4 想要「30 天内改 ≥3 次」时**没有任何行可数**，而那时改表要动已上线数据面。
--   本表的唯一用途 = 让「偏好被改过几次」成为**可查事实**，而不是靠记忆自述。
-- ⚠ old_value / source_evidence_id 可空：创建时无旧值与证据来源是正常态，
--   但**列必须在**——缺列与「本次无旧值」不可分辨（与本仓「不可用落 null、
--   不得靠缺列冒充」同一条纪律）。
-- ⚠ 本段位于模板串内：**注释里不得出现反引号**（本仓已踩过两次：反引号会提前终止
--   SCHEMA_SQL 模板串，报出的却是「Module declaration names may only use quoted strings」
--   这类**指不到真因**的错）。
CREATE TABLE IF NOT EXISTS user_model_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  confidence REAL,
  at TEXT NOT NULL,
  session_id TEXT,
  turn_id INTEGER,
  source_evidence_id TEXT
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

-- ── JEV 判定日志（方案 §11.2 + session_id/turn_id + gate）───────────────────
-- ⚠ A1-8 原文要求「Write → gate in (unavailable,budget) 且行仍写入」与
--   「jev_log.degraded 与 gate **至少一个非空**」⇒ **本表必须有 gate 列**。
--   本仓 2026-09-25 实测发现：此前 DDL 注释已写「A1-8 要求 degraded 与 gate 至少一个非空」，
--   但**列本身从未建** —— 于是 A1-8 那条判据**结构上不可执行**（查一列不存在的列）。
--   这正是本仓反复出现的形态：**声明与生效不一致**（注释承诺了、DDL 没给）。
--   ⇒ 补列，并把取值域显式写出，使「判据能跑到真数据面」。
-- ⚠ 取值域与 inject_log.gate（5 类）**不同**：这里记的是 **JEV 调用层的失败归因**
--   （unavailable = 端点不可达/模型不可用；budget = 预算/熔断耗尽），
--   不是注入门控的判定结果。两者同名不同域，故各自 CHECK。
--   ⚠ probability 仍是 REAL 可空：降级时**必须为 NULL**，不得用 0 冒充「概率为零」。
CREATE TABLE IF NOT EXISTS jev_log (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,
  source TEXT NOT NULL,
  state_hash TEXT,
  result_value TEXT,
  probability REAL,
  cached INTEGER DEFAULT 0,
  degraded INTEGER DEFAULT 0,
  gate TEXT CHECK (gate IS NULL OR gate IN ('unavailable', 'budget')),
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
-- 「30 天内改 ≥3 次」的判据按 (key, at) 扫 ⇒ 该索引是那条判据的可执行前提。
CREATE INDEX IF NOT EXISTS idx_user_model_history_key_at ON user_model_history(key, at);

-- ── FTS5 同步触发器（**external content 表不同步就是静默归零**）──────────────
-- ⚠ 本段是本仓 2026-09-25 实测补上的（A1-10 的机制根因）：
--   memory_items_fts 是 **external content** 虚表（content='memory_items'），
--   它**不自动跟随主表**：往 memory_items 插一行，FTS 查询**仍返回 0 命中且不报错**
--   （实测：插后查 3 字串得 0；执行 rebuild 之后得 1）。
--   ⇒ 「中文召回恒 0」与「库里没有这条记忆」**表面完全同形**，正是 A1-10 要判红的形态。
--   修法 = 三个触发器（增/删/改）把主表变更同步进索引。
--   ⚠ 不能用「查询时 rebuild」代替：rebuild 重建**整张**索引，随数据量增长退化为全表扫描。
--   ⚠ 本段位于模板串内，注释里**不得出现反引号**（会提前终止 SCHEMA_SQL 模板串；
--     报出的却是 Expected a semicolon 这类指不到真因的错 —— 本仓已踩过三次）。
CREATE TRIGGER IF NOT EXISTS trg_memory_items_fts_ai AFTER INSERT ON memory_items BEGIN
  INSERT INTO memory_items_fts(rowid, content, summary) VALUES (new.rowid, new.content, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS trg_memory_items_fts_ad AFTER DELETE ON memory_items BEGIN
  INSERT INTO memory_items_fts(memory_items_fts, rowid, content, summary)
    VALUES ('delete', old.rowid, old.content, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS trg_memory_items_fts_au AFTER UPDATE ON memory_items BEGIN
  INSERT INTO memory_items_fts(memory_items_fts, rowid, content, summary)
    VALUES ('delete', old.rowid, old.content, old.summary);
  INSERT INTO memory_items_fts(rowid, content, summary) VALUES (new.rowid, new.content, new.summary);
END;
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
      // ⚠ **`BEGIN ... END` 体内的分号不是语句边界**（本仓 2026-09-25 实测踩到）：
      //   FTS 同步触发器写作 `CREATE TRIGGER ... BEGIN <stmt>; <stmt>; END;`
      //   —— 体内分号若被当作边界，切出的碎片会报 `incomplete input`
      //   （SQLite 这句报错**指不到真因**：它只说输入不完整）。
      //   ⇒ 在 `CREATE TRIGGER` 语句内按词边界数 BEGIN/CASE 与 END，只有配平后的分号才是边界。
      //   ⚠ 仅对 `CREATE TRIGGER` 启用：`BEGIN IMMEDIATE`（事务）也含该词，
      //     无差别启用会把事务语句切错。
      if (/^\s*(--[^\n]*\n\s*)*CREATE\s+TRIGGER\b/i.test(cur)) {
        // ⚠ 数 BEGIN/END 之前**必须先去注释**：注释里出现 "BEGIN"/"END" 这类词
        //   （本仓的触发器说明就写到了 BEGIN 字样）会把深度算错 ⇒ 语句仍被误切。
        const code = cur.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
        const tokens = code.match(/\b(BEGIN|END|CASE)\b/gi) ?? []
        let depth = 0
        for (const t of tokens) {
          const up = t.toUpperCase()
          if (up === 'BEGIN' || up === 'CASE') depth++
          else if (up === 'END') depth--
        }
        if (depth > 0) {
          cur += c
          i++
          continue
        }
      }
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
  //
  // ⚠ **触发器新建后必须对存量行做一次 rebuild**（本仓 2026-09-25 实测）：
  //   触发器只对**之后的**写入生效。存量库迁移前插入的行**不在 FTS 索引里**，
  //   迁移后依然查不到 —— 实测：老库 1 行存量中文，补完触发器后查中文串仍为 0，
  //   而**新插**的行立刻可查（1）。⇒ 若不 rebuild，「迁移成功」与「存量记忆静默不可检索」
  //   会同时成立，后者正是 A1-10 要判红的形态。
  //   ⚠ 只在**本次真的新建了触发器**时才 rebuild：rebuild 重建整张索引，
  //     不能每次开库都跑（随数据量增长退化为全表扫描）。
  const hadFtsTriggers = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name?: string }[]
  ).some((r) => String(r.name ?? '') === 'trg_memory_items_fts_ai')
  for (const s of dependents) db.exec(s)
  if (!hadFtsTriggers) {
    const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_items_fts'").get()
    if (ftsExists) {
      // 把存量行纳入索引；失败**不静默吞掉**（抛出去，让开库的人看到）。
      db.exec("INSERT INTO memory_items_fts(memory_items_fts) VALUES('rebuild')")
    }
  }

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
