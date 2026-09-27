/**
 * 软删除 / 恢复原语 + **退休过滤检索** —— **A2-6 / A2-7 的实现者**。
 *
 * 判据原文（`docs/mana-rollout-plan.md:521-522`，逐字）：
 *   · **A2-6 软删除可逆（字节级）**：`mem_forget` 后查 `retired`；`mem_restore` 后对
 *     `content` 取 `sha256` ⇒ **行数不变且 `retired=1`；恢复后哈希与删前相等**。
 *   · **A2-7 退休行不泄漏进检索**：检索 SQL 须 `AND retired=0` ⇒ 结果中 `retired=1`
 *     的 id 计数 **== 0**（附实测警告：**FTS 索引不会因 retired 自动剔除**）。
 *
 * ── 为什么这两条必须成对实现（本仓 2026-09-25 实测，不是推演）─────────────────────
 * `memory_items_fts` 是 **external content** 虚表（`content='memory_items'`），
 * 它**不自动跟随主表**。而 `schema.ts:215-219` 的 **UPDATE 触发器**在 retire 时会把
 * 该行**重新插回 FTS 索引**（触发器体是 delete+insert，与 retired 的值无关）。
 * 实测（真 temp 库 + 真 `openManaDb` 生产路径）：
 * ```
 *   after UPDATE memory_items SET retired=1 WHERE id='m1'
 *     raw FTS count        = 1        <== 退休行**仍在索引里**
 *     join WITHOUT filter  = [{id:'m1'}]  <== **泄漏真的会发生**
 *     join WITH retired=0  = []
 * ```
 * ⇒ 「A2-7 只要不写 `AND retired=0` 就会泄漏」是**已实测的事实**，不是文档转述；
 *   `tests/retirement.test.mjs` ④ 把这条机制**钉成机检腿**（退休行在原始索引里可命中、
 *   在检索结果里为 0），使它不会因为"某天触发器被改"而悄悄失效。
 *
 * ── 边界（明确写出，不靠留空）────────────────────────────────────────────────────
 *  · **只改 `retired` 位，永不删行**：本文件**不发出一条 `DELETE`**（§8.3「物理删除
 *    永不发生」）。`retireMemory` 是 `UPDATE ... SET retired = 1`，恢复是置回 0。
 *  · **不改 FTS 虚表结构、不写 DDL**：建表/触发器/补列全在 core 的 `createSchema`，
 *    本文件只**消费**它。DDL 若有缺口 ⇒ 由调用方向上暴露，不在本文件私建。
 *  · **不写 `mana_trace` / `inject_log`**：退休是**无痕**操作（无审计行）——
 *    这是**已知缺口**，如实记在 `docs/handoff/S21.md` 未决项，不在本批偷偷补。
 *  · **不判「该不该退休」**：阈值与四区间归档归 `forgetting`（A3-2 / B4.2）。
 *    本文件只做「你说退休，我置位且不丢数据」这一件事。
 *
 * ── 为什么 {0,1} 取值也要校验（防「静默置成第三态」）────────────────────────────
 * `retired` 列在 DDL 里是 `INTEGER DEFAULT 0`，**没有 CHECK** ⇒ 写 `retired=2` 或
 * `retired='yes'` 都不会报错，而所有检索都按 `retired = 0` 过滤 ⇒ 那行会**从检索里
 * 永久消失、且不报任何错**（物理行还在、哈希也对，只有检索面静默丢它）。
 * 这是本仓最防的「静默失效」形态，故本文件对 id/limit 显式校验后**抛错**，不吞。
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { buildFtsPhrase, checkQuery, FtsQueryError, isFtsQueryError } from 'dsh-mana-core'

/**
 * 检索默认返回条数。
 *
 * ⚠ 必须是**具名常量**而不是函数签名里的裸 `50`：`activation.test.mjs` ⑦ 会扫本包
 *   `src/*.ts`（剥注释/字符串后）里的裸数字字面量来守 C14 参数唯一写者，裸 `50` 会被
 *   它的扫描器**误判**（实测：先写成裸 50，C14 腿直接变红）。⇒ 具名化，既消歧义又不改判据。
 */
const DEFAULT_LIMIT = 50

/** 一条记忆行（**含 `retired`**：过滤腿要能读到它，否则"没泄漏"无法被证伪）。 */
export interface MemoryRow {
  id: string
  content: string
  summary: string | null
  retired: number
  created_at: string
}

/** 库内计数三态：`live` 与 `retired` **分列**，避免合成一个数后不可分辨。 */
export interface MemoryCounts {
  /** 物理行数（含已退休）—— **软删除的硬证据**：retire 前后必须相等。 */
  total: number
  /** `retired=0` 的行数（检索可见面）。 */
  live: number
  /** `retired=1` 的行数（已退休、仍在库）。 */
  retired: number
}

/**
 * 一次软删除 / 恢复的**完整读数**。
 *
 * ⚠ 为什么不返回 void：只返回空的话，「置位成功」「id 不存在」「本来就是该状态」三种
 *   情形**表面完全同形**——正是本仓反复判红的形态。故把三者拆成可断言的字段。
 */
export interface SoftDeleteOutcome {
  id: string
  /** id 在库中是否存在（false ⇒ 后续字段为 null/不变，**这是一次失败，不是成功**）。 */
  existed: boolean
  /** 本次是否真的改动了 `retired` 位（false 有两种：不存在 / 已是目标态）。 */
  changed: boolean
  retiredBefore: number | null
  retiredAfter: number | null
  /** 变更前后的物理行数（**必须相等**；不等即「物理删除永不发生」被违反）。 */
  rowsBefore: number
  rowsAfter: number
  /** 变更后 `content` 的 sha256（utf8）；id 不存在时为 null。 */
  contentSha256: string | null
  /** 变更后 `content` 的 **utf8 字节数**——与哈希互补的字节级证据。 */
  contentBytes: number | null
  createdAt: string | null
}

/** 检索结果 —— **把"为什么是 0 命中"做成可分辨的事实**（与 core 的 `LexicalRecallResult` 同口径）。 */
export interface LiveSearchResult {
  hits: { id: string; content: string; summary: string | null }[]
  /** 0 命中的原因分类；有命中时为 null。 */
  reason: 'ok' | 'too_short' | 'empty_library' | null
  /**
   * **全表物理行数（含已退休）** = `counts.total`（不设 WHERE）。
   *
   * ⚠ **为什么不叫 `librarySize`**（S30 席裁定，2026-09-25）：core 的
   *   `LexicalRecallResult.librarySize` 已被裁定为**活记忆数**（`retired = 0`）。
   *   同一个词在两个包指两个量 ⇒ 读代码的人**必然猜错一次**。此处统计的是
   *   「表里一共有多少行」这个**不同的量** ⇒ 按本仓纪律**改名**而不是改值
   *   （改动值会得到 `totalSize === liveSize` 的冗余副本，等于把两个身份不同的读数
   *     合成一个：那正是"同一条事实两个归属地"）。
   * ⚠ 恒等式：`totalSize === liveSize + retiredSize`（三者**同时**回报才可分辨；
   *   合成一个数 ⇒ 「行没了」与「行还在但被排除」同形）。
   * ⚠ 与 `reason` **无因果**：下方 0 命中的判据分母是 `liveSize`，不是本字段 ——
   *   故 core 那次「分母退回全量 ⇒ `empty_library` 假红」的实害在本包**不存在**。
   *   本字段是**库规模读数**（软删除不变式的取证：retire 前后它必须相等）。
   */
  totalSize: number
  /** `retired=0` 的行数（**本函数 0 命中判据的分母**，见下方 `reason`）。 */
  liveSize: number
  /** `retired=1` 的行数。 */
  retiredSize: number
  normalizedQuery: string | null
  /**
   * 命中里 `retired=1` 的 id —— **A2-7 的直接读数，必须恒为空数组**。
   *
   * ⚠ 它是**自报**，不是自证：调用方仍须用 `leakedRetiredIds()` 拿独立查得的
   *   退休 id 集**外部复核** `hits`（本文件不自认合格）。见 tests ② 的双读法。
   */
  retiredIdsInHits: string[]
}

/**
 * 生产检索 SQL —— **`AND retired = 0` 是这条判据的全部要害**。
 *
 * ⚠ 为什么把 SQL 提成常量而不是内联在函数里：内联的话，「过滤腿还在不在」只能靠读源码，
 *   而下一条修改它的人**不会知道**删掉那一行意味着什么。提成常量后：
 *   `tests/retirement.test.mjs` ① 断言该字面量在册（被删即红），
 *   ③ 用**同一条 SQL 去掉过滤腿**对真库跑出泄漏 ⇒ 负向对拍打在**真 SQL**上。
 *
 * ⚠ 本串内**不得写 SQL 行注释**（`--`）：本仓 DDL 经 `splitStatements` 切分，
 *   半角注释是被处理过的，但这里没有切分器兜底 ⇒ 一律不用，注释写在 TS 侧。
 */
export const LIVE_SEARCH_SQL = [
  'SELECT m.id AS id, m.content AS content, m.summary AS summary, m.retired AS retired',
  '  FROM memory_items_fts f',
  '  JOIN memory_items m ON m.rowid = f.rowid',
  ' WHERE memory_items_fts MATCH ?',
  '   AND m.retired = 0',
  ' LIMIT ?',
].join('\n')

/** 单条按 id 读取的 SQL —— 同样**带过滤腿**（"任何返回记忆的查询"都算）。 */
export const LIVE_SELECT_SQL = [
  'SELECT id, content, summary, retired, created_at',
  '  FROM memory_items',
  ' WHERE id = ? AND retired = 0',
].join('\n')

/** A2-7 过滤腿的**字面量**：测试与调用方按此断言，改名/删腿即红。 */
export const RETIRED_FILTER_CLAUSE = 'AND m.retired = 0' as const

/** `content` 的 utf8 sha256 —— A2-6「字节级」的取证原语。 */
export function sha256Hex(text: string): string {
  if (typeof text !== 'string') throw new Error(`sha256Hex: 只接受字符串（实测 ${typeof text}）`)
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** `content` 的 utf8 字节数（哈希的互补读数：哈希变而字节数不变 ⇒ 恰好抓到"换了一个同长字符"）。 */
export function contentBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`memory id 必须是非空字符串（实测 ${JSON.stringify(id)}）—— 传空串会命中 0 行，与"该行不存在"同形且静默`)
  }
}

function assertLimit(limit: unknown): asserts limit is number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(`limit 必须是正整数（实测 ${JSON.stringify(limit)}）—— 传 0/负数会静默返回空集，与"没有命中"同形`)
  }
}

/** 读一行（**不过滤**）—— 供软删除原语自身取证；外部调用方请用 `selectLiveMemoryById`。 */
export function readMemoryRow(db: DatabaseSync, id: string): MemoryRow | null {
  assertId(id)
  const row = db
    .prepare('SELECT id, content, summary, retired, created_at FROM memory_items WHERE id = ?')
    .get(id) as MemoryRow | undefined
  return row ?? null
}

/**
 * 按 id 读一条**未退休**记忆。
 *
 * ⚠ 这是「任何返回记忆的查询必须带 `AND retired=0`」在**按 id 读**这条路上的落点。
 *   不带过滤的同一查询会**返回已退休的行**（= A2-7 的泄漏形态搬到 id 通道），
 *   故两者**并存且名字可分辨**（`readMemoryRow` / `selectLiveMemoryById`），
 *   而不是留一个"看起来能读、其实会漏"的单面。
 */
export function selectLiveMemoryById(db: DatabaseSync, id: string): MemoryRow | null {
  assertId(id)
  const row = db.prepare(LIVE_SELECT_SQL).get(id) as MemoryRow | undefined
  return row ?? null
}

/** 库内计数（三态分列）。 */
export function countMemories(db: DatabaseSync): MemoryCounts {
  const total = Number((db.prepare('SELECT COUNT(*) c FROM memory_items').get() as { c?: number })?.c ?? 0)
  const retired = Number(
    (db.prepare('SELECT COUNT(*) c FROM memory_items WHERE retired = 1').get() as { c?: number })?.c ?? 0,
  )
  return { total, live: total - retired, retired }
}

/** 全部 `retired=1` 的 id（供外部复核"结果里有没有退休行"）。 */
export function listRetiredIds(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT id FROM memory_items WHERE retired = 1').all() as { id: string }[]
  return rows.map((r) => String(r.id))
}

/**
 * ⚠ **诊断探针，不是检索入口**：直接查 FTS 索引（**不 join 主表、不带任何过滤**）。
 *
 * 存在的唯一理由：让「FTS 索引不会因 retired 自动剔除」成为**可读到的实测事实**——
 * 没有它，"退休行还在索引里"就只能靠文档转述，而那正是 A2-7 警告句的形态。
 * **生产检索一律走 `searchLiveMemories`**；本函数被误用即等于绕过过滤腿。
 */
export function probeFtsIndex(db: DatabaseSync, rawQuery: string, limit: number = DEFAULT_LIMIT): string[] {
  const checked = checkQuery(rawQuery)
  if (!checked.ok) return []
  assertLimit(limit)
  /**
   * ⚠ **必须绑短语，不能绑裸查询**（2026-09-27 与 `core.recallLexical` 同批修正）：
   *   `MATCH` 的参数是 **FTS5 查询表达式**，不是纯文本 —— 裸 `/home/lk/Mana` 会直接
   *   `syntax error near "/"`，裸 `方案 A` 会被当 `方案 AND A`。
   *   ⚠ 本探针是**诊断工具**（见上面的"不是检索入口"）：它抛错会让人误以为"索引有问题"，
   *     而真因只是查询串没转义 ⇒ 归因错位。
   *   ⚠ 转义器**不另立**：复用 `dsh-mana-core` 的 `buildFtsPhrase`（与生产检索同一份）。
   */
  const rows = db
    .prepare('SELECT rowid FROM memory_items_fts WHERE memory_items_fts MATCH ? LIMIT ?')
    .all(buildFtsPhrase(checked.query), limit) as { rowid: number }[]
  const ids: string[] = []
  for (const r of rows) {
    const m = db.prepare('SELECT id FROM memory_items WHERE rowid = ?').get(r.rowid) as { id?: string } | undefined
    ids.push(String(m?.id ?? `rowid:${r.rowid}`))
  }
  return ids
}

/**
 * 命中里落在给定退休 id 集内的那些 id —— A2-7 的**外部复核**原语。
 *
 * 为什么不复用结果里自报的 `retiredIdsInHits`：自报值在"实现漏过滤"时**同样会错**，
 * 拿它验它自己等于自证。本函数由调用方**独立查得**退休 id 集后传入，是外部口径。
 */
export function leakedRetiredIds(
  hits: readonly { id: string }[],
  retiredIds: ReadonlySet<string> | readonly string[],
): string[] {
  const set = retiredIds instanceof Set ? retiredIds : new Set(retiredIds)
  return hits.map((h) => String(h.id)).filter((id) => set.has(id))
}

/** 检出泄漏即抛错（供生产路径调用：宁可炸，不可静默把退休行交出去）。 */
export function assertNoRetiredLeak(
  hits: readonly { id: string }[],
  retiredIds: ReadonlySet<string> | readonly string[],
): void {
  const leaked = leakedRetiredIds(hits, retiredIds)
  if (leaked.length > 0) {
    throw new Error(
      `检索结果泄漏了已退休记忆：${JSON.stringify(leaked)}（A2-7 要求 retired=1 的 id 计数 == 0）—— ` +
        `请检查 LIVE_SEARCH_SQL 的「${RETIRED_FILTER_CLAUSE}」是否还在`,
    )
  }
}

/** 置位 `retired=1` —— **软删除的唯一写点**（本文件不发 DELETE）。 */
export function retireMemory(db: DatabaseSync, id: string): SoftDeleteOutcome {
  return mutateRetired(db, id, 1)
}

/** 置位 `retired=0` —— **恢复的唯一写点**（不动 `content` 一个字节）。 */
export function restoreMemory(db: DatabaseSync, id: string): SoftDeleteOutcome {
  return mutateRetired(db, id, 0)
}

/**
 * 两个原语的共同实现。**只改 `retired` 位的单条 UPDATE**。
 *
 * ⚠ 原子性口径（如实写，不夸大）：`UPDATE` 本身是**单条语句**，它与 `schema.ts` 的
 *   FTS 同步触发器在同一语句内完成 ⇒ "位改了而索引没改"不会发生。
 *   但本函数**外面**的两次读数（before/after）是**诊断读数**，不是不变式的一部分：
 *   它们之间若有并发写入，`rowsBefore`/`rowsAfter` 会读到不同快照。
 *   ⇒ `rowsBefore === rowsAfter` 的**真保证**来自"本模块不发 DELETE"这一构造事实，
 *     两次读数只是把它**记下来**。判据在主（单写者）测试库上取值。
 */
function mutateRetired(db: DatabaseSync, id: string, target: 0 | 1): SoftDeleteOutcome {
  assertId(id)
  const rowsBefore = countMemories(db).total
  const before = readMemoryRow(db, id)
  if (before === null) {
    // **不静默当成功**：id 不存在是显式读数（existed=false），调用方必须自己判。
    return {
      id,
      existed: false,
      changed: false,
      retiredBefore: null,
      retiredAfter: null,
      rowsBefore,
      rowsAfter: rowsBefore,
      contentSha256: null,
      contentBytes: null,
      createdAt: null,
    }
  }
  const changed = before.retired !== target
  if (changed) {
    // 唯一的写动作：只碰 retired 列。content/summary/created_at 一概不出现在 SET 里。
    db.prepare('UPDATE memory_items SET retired = ? WHERE id = ?').run(target, id)
  }
  const after = readMemoryRow(db, id)
  const rowsAfter = countMemories(db).total
  const content = after?.content ?? before.content
  return {
    id,
    existed: true,
    changed,
    retiredBefore: before.retired,
    retiredAfter: after?.retired ?? null,
    rowsBefore,
    rowsAfter,
    contentSha256: sha256Hex(content),
    contentBytes: contentBytes(content),
    createdAt: after?.created_at ?? before.created_at,
  }
}

/**
 * 生产检索：FTS 命中 **∩** `retired=0`。
 *
 * 三步口径与 core 的 `recallLexical` 一致（长度闸先于查询），这样"0 命中"的三种原因
 * （库空 / 查询过短 / 真查不到）保持可分辨 —— 否则「静默归零」与「本来没有」同形。
 */
export function searchLiveMemories(db: DatabaseSync, rawQuery: string, limit: number = DEFAULT_LIMIT): LiveSearchResult {
  assertLimit(limit)
  const counts = countMemories(db)
  const base = {
    // ⚠ 三态**分列**（total / live / retired）：本字段是库规模读数，不是 reason 的分母。
    totalSize: counts.total,
    liveSize: counts.live,
    retiredSize: counts.retired,
  }
  const checked = checkQuery(rawQuery)
  if (!checked.ok) {
    return { hits: [], reason: 'too_short', normalizedQuery: null, retiredIdsInHits: [], ...base }
  }
  /**
   * ⚠ **必须绑短语**（2026-09-27 与 `core.recallLexical` 同批修正）：
   *   `MATCH` 的参数是 **FTS5 查询表达式**而非纯文本 ⇒ 裸查询下含 `/` 的提问
   *   （如 `/home/lk/Mana`）会让整条生产检索**抛错**、含空格短语会被拆成 `AND`。
   *   转义器复用 `dsh-mana-core` 的 `buildFtsPhrase`（**不另立第二份**）。
   *
   * ⚠ **失败必须可分辨**：FTS5 仍可能因别的原因拒绝该表达式（实测：含 U+0000 时
   *   `unterminated string`）⇒ 此处**不吞**，转成具名 `FtsQueryError` 抛出。
   *   若在此 catch 掉退回空集，"查询坏了"就会与"库里没有"**同形** —— 本仓最忌。
   */
  let hits: { id: string; content: string; summary: string | null; retired: number }[]
  const phrase = buildFtsPhrase(checked.query)
  try {
    hits = db.prepare(LIVE_SEARCH_SQL).all(phrase, limit) as {
      id: string
      content: string
      summary: string | null
      retired: number
    }[]
  } catch (error) {
    /**
     * ⚠ 具名错误**只用于"查询表达式被拒"这一种事实**（与 core 同一口径）：
     *   库已关、权限、连接故障等**不归此列** ⇒ 那些照旧抛原错，不被本类冒充。
     */
    if (isFtsQueryError(error)) throw error
    const msg = error instanceof Error ? error.message : String(error)
    if (/fts5|unterminated string|syntax error/i.test(msg)) {
      throw new FtsQueryError(checked.query, phrase, error)
    }
    throw error
  }
  const retiredIdsInHits = hits.filter((h) => Number(h.retired) !== 0).map((h) => String(h.id))
  const clean = hits.map((h) => ({ id: h.id, content: h.content, summary: h.summary }))
  const reason: LiveSearchResult['reason'] = clean.length > 0 ? null : counts.live === 0 ? 'empty_library' : 'ok'
  return { hits: clean, reason, normalizedQuery: checked.query, retiredIdsInHits, ...base }
}
