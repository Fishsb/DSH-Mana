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
 * 建表。幂等；不负责开库（开库口径见 `db.ts` —— 两者分离是为了让「扩展窗口只在开库瞬间」
 * 这条不可后补的约束只有一个写点）。
 */
export function createSchema(db: { exec(sql: string): unknown }): void {
  db.exec(SCHEMA_SQL)
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
