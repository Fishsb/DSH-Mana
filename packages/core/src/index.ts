/**
 * `dsh-mana-core` 入口 —— Mana 的**契约唯一归属地**与存储根。
 *
 * 职责（落地册 阶段 0 B0.2）：
 *  ① 冻结 S1 五类事件（`src/event-types.ts`）与领域模型（`src/domain.ts`）；
 *  ② 独占 `Events` 接口声明 —— 其余 Mana 插件**禁止**自建 `event-types.ts`（§8 C13）；
 *  ③ 出「包 id ↔ 插件 name ↔ 服务名」映射表（见 `PACKAGE_MAP` 与 README）；
 *  ④ 关联键统一 `requestId`；
 *  ⑤ 建 `mana_trace` / `inject_log` 等表（`src/schema.ts`）；
 *  ⑥ 存储开库口径唯一写点（`src/db.ts`，G4）。
 *
 * 它**提供**服务 `mana-core`，其余 P0 插件通过 `inject = ['mana-core']` 取得。
 */
import type { Context } from '@deepseek-ai/cordis'
// ⚠ 必须 import 宿主包才会加载它对 `@deepseek-ai/cordis` 的 `Events` 声明合并：
//   `agent/pre-step` 是 **DSH 官方扩展点**，并不在 cordis 自带的 Events 里，
//   而是由 `@deepseek-ai/dsh-agent` 声明（其实测声明见该包 lib/types/runtime-types.d.ts）。
//   漏引的后果 = typecheck 报 `'"agent/pre-step"' is not assignable to 'keyof Events'`
//   —— 这是**正确报错**，不要用 `as any` 压掉（那会把 G9 的 next() 义务变成不可见）。
import type {} from '@deepseek-ai/dsh-agent'
import type { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import {
  openManaDb,
  probeVecVersion,
  probeVecVersionDetail,
  withImmediateTransaction,
  type ManaDb,
  type VecProbeReading,
} from './db.ts'
import {
  backupNow,
  pruneBackups,
  resolveBackupDir,
  startBackupTimer,
  DEFAULT_BACKUP_POLICY,
  type BackupPolicy,
  type BackupResult,
} from './open.ts'
import { createSchema, SCHEMA_VERSION, checkQuery } from './schema.ts'
// ⚠ `writeInjectLog` 的取值域校验要用 `INJECTION_GATES`（运行期）与 `InjectionGate`（类型）
//   ⇒ 必须**真正 import 进本模块作用域**。只写 `export ... from './domain.ts'` 是**再导出**，
//   不会把名字引入本地作用域（那是两个不同的语义，混同会得到「Cannot find name」）。
import { INJECTION_GATES, type InjectionGate } from './domain.ts'
// ⚠ 这行是**契约生效的唯一开关**：`declare module` 只有在该模块被加载时才参与类型合并。
//   当初用裸 import（无 from）写，被一次路径改名脚本漏掉 ⇒ 契约静默失效、
//   而报错表现为「mana/xxx 不是 keyof Events」（看起来像事件名写错）。
import './event-types.ts'

/** 本插件的服务名（其余插件 `inject` 用的名字）。 */
/**
 * ⚠ **入口必须是编译产物 `lib/index.js`，不能指向 `src/index.ts`**（装配实测，2026-09-24）。
 *
 * 本仓源码以 `.ts` 直跑测试没问题（Node 22 的类型剥离对**工作区软链**放行，因为
 * realpath 落在 `node_modules` 之外）。但**宿主 DSH 以 `node /usr/local/bin/dsh web` 启动、
 * 不带任何类型剥离开关** ⇒ 指向 `.ts` 的入口在宿主里装不上。
 * 而入口指向 `lib/` 后，宿主对 `node_modules` 内路径一律拒绝剥离 ⇒ **必须预编译**。
 *
 * ⇒ 约定：`main`/`exports` 指向 `lib/`；改完源码必须 `npm run build` 再注入。
 *   （生态既有插件 shoucang / roundtable / motion / super-injector **全部**是 `lib/index.js`，
 *     这不是偏好，是装载面的硬约束。）
 */
export const SERVICE_NAME = 'mana-core' as const

/** Cordis 插件名（与包 id `dsh-mana-core` 区分）。 */
export const name = 'mana-core'

/**
 * 依赖：**无**（方案 §9.1 声明 core 依赖为「无」）。
 *
 * ⚠ 这意味着 core 装配失败时其余 12 个插件全部停在 waiting —— 而「写入 mana_trace 的
 * 代码本身没在跑」会让 Mana 所有自证通道同时失声。故独立心跳必须由 **Mana 之外**的
 * 启动脚本写（A0-11；判据形态：卸载全部 Mana 插件后该文件仍继续更新）。
 */
export const inject: string[] = []

/** 配置。 */
export interface Config {
  /** 库文件路径。留空 = `$DSH_HOME/memory/mana.db`。 */
  storePath: string
  /** 并发写等待毫秒数（默认值 0 会立即 database is locked，故显式给 5000）。 */
  busyTimeoutMs: number
  /** 是否在建库时自动建表。 */
  autoMigrate: boolean
  /** B1.0 · 是否启用定期备份。 */
  backupEnabled: boolean
  /** B1.0 · 备份间隔毫秒数（默认 6 小时）。 */
  backupIntervalMs: number
  /** B1.0 · 保留最近几个备份。 */
  backupKeep: number
  /** B1.0 · 备份目录；留空 = 与库同级的 `backups/`。 */
  backupDir: string
}

export const Config: Schema<Config> = Schema.object({
  storePath: Schema.string().default(''),
  busyTimeoutMs: Schema.number().default(5000),
  autoMigrate: Schema.boolean().default(true),
  // ⚠ 缺省**关闭**：开启定时器是本批（B1.0）新引入的**行为**，缺省打开会让
  //   任何一次插件装载都开始写磁盘。要开须显式置 true（并受 backupKeep 约束）。
  backupEnabled: Schema.boolean().default(false),
  backupIntervalMs: Schema.number().default(6 * 60 * 60 * 1000),
  backupKeep: Schema.number().default(7),
  backupDir: Schema.string().default(''),
})

/** 认知轨迹的一次写入请求。 */
export interface TraceEntry {
  /** 事件类型，S1 五类为 observation/attention/decision/recall/injection。 */
  eventType: string
  /** 会话标识（G3）。 */
  sessionId: string
  /** 轮次（G3）。 */
  turnId: number
  /** 载荷对象；落库前 JSON 序列化。 */
  payload: unknown
  /** 发生时刻；缺省为当前时间。 */
  at?: string
}

/**
 * 注入审计的一次写入请求（阶段 1 · W3-2 的落点）。
 *
 * ⚠ **为什么这个类型必须在 core 而不在消费方**（G8 / `docs/contract/degradation.md`）：
 *   `inject_log` 是「没注入」可分辨的**唯一落点** —— fail-closed 门控的**正常态与故障态
 *   表面完全同形**（都是"没注入"）。若写入口散落在各插件里，`gate` 的取值就无人统一校验，
 *   写入方可以悄悄写 `null` 或写死一个非枚举值，而**判据读到的仍是"有行"** ⇒ 假绿。
 *   故取值域在此处**运行期强校验**（非法即抛，不静默落库）。
 */
export interface InjectLogEntry {
  /** 会话标识（G3）。 */
  sessionId: string
  /** 轮次（G3）。 */
  turnId: number
  /** 关联键：与 `JevJudgeRequest.requestId` 同源（I-6 统一为 `requestId`）。 */
  requestId: string
  /**
   * 门控判定结果 —— **五类枚举之一，生产侧写死**（`docs/contract/degradation.md` §4）。
   *
   * `injected`（真注入了）/ `skip_no_candidate`（候选池空）/ `skip_below_threshold`
   * （判了但未过阈）/ `degraded_unavailable`（JEV 不可用）/ `reset`（该块已离开上下文）。
   */
  gate: InjectionGate
  /** 本次是否降级（与 `gate='degraded_unavailable'` 同时为真才自洽）。 */
  degraded?: boolean
  /** 被注入记忆的 id；未注入时为 null。 */
  memoryId?: string | null
  /** 注入块 id；未注入时为 null。 */
  blockId?: string | null
  /** 本地排序分（A1-11：降级时排序依据须落到此字段而非 `jev_prob`）。 */
  localScore?: number | null
  /** JEV 判定概率；不可用时为 `null`（**不得用 0 冒充「概率为零」**）。 */
  jevProb?: number | null
  /** 该块是否已离开上下文（与 `gate='reset'` 配对的显式位）。 */
  reset?: boolean
  /** 发生时刻；缺省为当前时间。 */
  at?: string
}

/** 一条读回的注入审计行（字段名与 DDL 列一一对应，便于判据直接断言）。 */
export interface InjectLogRow {
  id: number
  session_id: string
  turn_id: number
  request_id: string
  memory_id: string | null
  block_id: string | null
  injected_at: string
  gate: string
  degraded: number
  local_score: number | null
  jev_prob: number | null
  reset: number
}

/** `gate` 是否属于 5 类枚举（唯一真源来自 `domain.ts` 的 `INJECTION_GATES`）。 */
export function isInjectionGate(value: unknown): value is InjectionGate {
  return typeof value === 'string' && (INJECTION_GATES as readonly string[]).includes(value)
}

/**
 * 一次偏好更新请求（A4-4 的落点）。
 *
 * ⚠ **为什么更新与历史必须在同一个函数里**（而不是让调用方写两次）：
 *   `user_model` 是 UPDATE 覆盖。若"更新主表"与"记一行历史"是两个可选步骤，
 *   调用方漏掉第二步时**主表照样更新成功、且不报错** ⇒ 「漂移可回溯」变成愿望，
 *   而失败完全不可观测（本仓首位缺陷类）。故两者**绑成一次调用**。
 */
export interface UserModelUpdate {
  key: string
  value: string
  /** 置信度；不传则沿用主表既有值（新建时用 `user_model.confidence` 缺省）。 */
  confidence?: number
  /** 来源证据 id；无证据时显式传 `null`（不得靠省略表示"没有"）。 */
  sourceEvidenceId?: string | null
  sessionId?: string
  turnId?: number
  at?: string
}

/** 一次偏好更新的结果（**旧值可读**：这是"漂移"能被数出来的前提）。 */
export interface UserModelUpdateResult {
  key: string
  /** 更新前的值；该键此前不存在时为 `null`（与"旧值是空串"可分辨）。 */
  previousValue: string | null
  newValue: string
  /** 本次是否真的改变了值（相同值重复写 = `false`，不计入漂移）。 */
  changed: boolean
  /** 本次是否新建了该键。 */
  created: boolean
  /** 历史表新增行的 id。 */
  historyId: number
}

/** 一条读回的用户模型历史行。 */
export interface UserModelHistoryRow {
  id: number
  key: string
  old_value: string | null
  new_value: string
  confidence: number | null
  at: string
  session_id: string | null
  turn_id: number | null
  source_evidence_id: string | null
}

/** 词法召回的一条命中。 */
export interface LexicalHit {
  id: string
  content: string
  summary: string | null
}

/**
 * 词法召回结果 —— **把"为什么是空"做成可分辨的事实**（A1-10 的核心）。
 *
 * ⚠ 判据原文要求「命中 ≥1；若为 0 且**库非空**即判红」。若只返回一个数组，
 *   「库里没有」与「查询被 FTS 静默归零」表面完全同形 —— 那正是本仓最防的形态。
 *   ⇒ 本结果显式带 `reason`，把三种"0 命中"分开：
 *     `ok`（真的查了、结果就是 0）/ `too_short`（被 MIN_QUERY_CHARS 挡下）/
 *     `empty_library`（库是空的，0 命中是正常的）。
 */
export interface LexicalRecallResult {
  hits: LexicalHit[]
  /** 0 命中的原因分类；有命中时为 `null`。 */
  reason: 'ok' | 'too_short' | 'empty_library' | null
  /**
   * 库中**活记忆**条数（`retired = 0`），判「库非空」用，使 `reason` 可被交叉核对。
   * ⚠ 口径与检索 SQL 同源（同样排除 retired 行）：否则「库非空却 0 命中」与
   *   「有记忆但全退休」会同形，而后者是**正确行为** —— 那里会把 A1-10 读成假红。
   */
  librarySize: number
  /** 被 `checkQuery` 归一后的查询串（**可断言**：调用方传的原串可能带空白）。 */
  normalizedQuery: string | null
}

/** core 对外提供的服务面（其余插件只依赖它，不直接摸库）。 */
export interface ManaCoreService {
  /** 库句柄（只读用途；写路径统一走 `writeTrace` / `withTransaction`）。 */
  readonly db: DatabaseSync
  /** 库文件绝对路径。 */
  readonly storePath: string
  /** 契约版本。 */
  readonly schemaVersion: string
  /** 开库实测读数（取证用：journalMode 应为 'wal'）。 */
  readonly journalMode: string
  /**
   * `vec_version()` 探针：null = **拿不到版本号**（显式事实，不是静默降级）。
   *
   * ⚠ 语义**逐字未变**（`string | null`）。要看「为什么拿不到」请用下面的 `vecProbe()`。
   */
  vecVersion(): string | null
  /**
   * **探针的归因读数**（新增的第二条通道；`vecVersion()` 的返回形态未动）。
   *
   * ⚠ 为什么必须分开：`vecVersion() === null` 在旧实现下把四类失败折成同一个值 ——
   *   「扩展未装载」（合规常态）与「库句柄坏了」（程序错误）**同形**，
   *   而两者都会被 `tools/probes/vec0-semantics.mjs` 的方向读成「未装 ⇒ HANG」。
   *   本方法把失败类别**可枚举**地暴露出来，使「探测没跑成」不再冒充「未装」。
   *   ⛔ 它**不改变** W-1..3 的档位：判「未装 vs 装了且语义对」的仍是那份探针，不是本方法。
   */
  vecProbe(): VecProbeReading
  /** 写一条认知轨迹，返回自增 `seq`。 */
  writeTrace(entry: TraceEntry): number
  /**
   * 写一条**注入审计**（W3-2 落点），返回自增 `id`。
   *
   * ⚠ **非法 `gate` 立即抛错**，不静默落库：`A1-13` 的判据是「枚举值必须落在 5 类内，
   *   出现 `null`/空值即判红」—— 若写入侧能悄悄写进非枚举值，判据只会看到"有行"。
   *   故校验放在写入口这**一个点**上（DDL 的 CHECK 是第二道防线，不是唯一防线：
   *   老库可能建于 CHECK 约束之前，见 `schema.ts` 的迁移说明）。
   */
  writeInjectLog(entry: InjectLogEntry): number
  /**
   * 按会话读回注入审计（A1-13/A1-14 的取证面）。
   *
   * @param sessionId 会话过滤；省略 = 不限会话。
   * @param limit 最多返回条数（按 `id` 倒序，最新在前）。
   */
  listInjectLog(sessionId?: string, limit?: number): InjectLogRow[]
  /**
   * **偏好更新 + 历史追加绑成一次调用**（A4-4）。
   *
   * 返回旧值，使「漂移」可被数出来（`user_model` 本身是 UPDATE 覆盖、读不到历史）。
   * 值未变时 `changed=false` 且**仍记一行**（"改过但改成一样"与"没改过"可分辨）。
   */
  updateUserModel(update: UserModelUpdate): UserModelUpdateResult
  /** 读某个 key 的历史行（按 `at` 升序）。省略 key = 全部。 */
  listUserModelHistory(key?: string, limit?: number): UserModelHistoryRow[]
  /**
   * **词法召回**（FTS5 trigram）—— A1-10 的生产侧落点。
   *
   * ⚠ 判据 A1-10 是**负向**的：「中文串查询命中 ≥1；若为 0 且库非空即判红」。
   *   故本方法**不只返回命中**，还返回 0 命中的**原因分类**（`too_short`/`empty_library`/`ok`），
   *   使「静默归零」在结构上不可能与「库里本来没有」混同。
   *
   * `checkQuery` 的长度闸在此**强制生效**（trigram 下 2 字查询恒 0 命中且不报错，
   * 见 `schema.ts` 的 `MIN_QUERY_CHARS` 说明）。
   */
  recallLexical(rawQuery: string, limit?: number): LexicalRecallResult
  /** 写一条记忆项（供词法召回有数据源；`vector` 列由向量席另行回填）。 */
  writeMemoryItem(item: { id: string; type: string; content: string; summary?: string | null; at?: string }): void
  /** 手写 BEGIN IMMEDIATE 事务（G7）。 */
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>
  /** 记录一次「插件因依赖缺失未运行」。 */
  recordInactive(id: string, missing: string[]): void
  /** B1.0 · 立即备份一次（返回实测读数，非"应该成功"）。 */
  backupNow(): Promise<BackupResult>
  /** B1.0 · 轮转：只保留最近 keep 个，返回被删文件名。 */
  pruneBackups(keep?: number): string[]
  /** B1.0 · 备份目录（解析后的绝对路径）。 */
  backupDir(): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Mana 核心服务（由 `dsh-mana-core` 提供）。 */
    'mana-core': ManaCoreService
  }
}

/**
 * **包 id ↔ 插件 name ↔ 服务名**映射表（B0.2 ③）。
 *
 * 为什么必须显式列表：三者不同名会让 `inject` 写错而**只在运行期表现为插件不启动**，
 * 编译期完全看不出来（G11：装配清单 ≠ 生效，空壳与真插件同形）。
 */
export const PACKAGE_MAP: readonly {
  packageId: string
  pluginName: string
  serviceName: string | null
  priority: 'P0' | 'P1' | 'P2'
}[] = [
  { packageId: 'dsh-mana-core', pluginName: 'mana-core', serviceName: 'mana-core', priority: 'P0' },
  { packageId: 'dsh-mana-jev', pluginName: 'mana-jev', serviceName: 'mana-jev', priority: 'P0' },
  { packageId: 'dsh-mana-vector', pluginName: 'mana-vector', serviceName: 'mana-vector', priority: 'P0' },
  { packageId: 'dsh-mana-perception', pluginName: 'mana-perception', serviceName: 'mana-perception', priority: 'P0' },
  { packageId: 'dsh-mana-attention', pluginName: 'mana-attention', serviceName: 'mana-attention', priority: 'P0' },
  {
    packageId: 'dsh-mana-working-memory',
    pluginName: 'mana-working-memory',
    serviceName: 'mana-working-memory',
    priority: 'P0',
  },
]

/** 解析库文件路径：留空走 `$DSH_HOME/memory/mana.db`（G15：该目录不存在，须自建）。 */
export function resolveStorePath(configured: string): string {
  if (configured.trim()) return configured
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'memory', 'mana.db')
}

/**
 * 注册一条**直通** waterfall 监听器并调用 `next()`（B0.3 ②）。
 *
 * 这是把 **G9** 钉成结构约束的手段：Mana 的 Injection Gate 与用户既有的 shoucang
 * 争同一个 `agent/pre-step` 扩展点；该扩展点是 waterfall（环绕中间件），**不调
 * `next()` 就会无声地吞掉下游全部行为且不报错**。骨架从第一天起就调用 `next()`，
 * 使「忘记 next()」不会成为一个只在运行期才暴露的错误。
 *
 * ⚠ 本函数**只观察**，不改写 `payload`、不替换 `next` 的返回值。
 */
export function registerPassThroughPreStep(ctx: Context, pluginName: string): () => void {
  return ctx.on('agent/pre-step', async (_payload, next) => {
    // 直通：不调用 next() 就会掐死下游（含 shoucang 的 panel-inject.js:773 与 mcl.js:372 两条链）。
    return await next()
  })
}

/** 插件主体。 */
export function apply(ctx: Context, config: Config): void {
  const storePath = resolveStorePath(config.storePath)
  const opened: ManaDb = openManaDb({
    path: storePath,
    busyTimeoutMs: config.busyTimeoutMs,
    migrate: config.autoMigrate,
  })

  // 建表 / 补列**只由 `autoMigrate` 决定**，且已在 `openManaDb` 内施加，此处不重复调用。
  //
  // ⚠ 旧写法 `if (!config.autoMigrate) createSchema(opened.db)` 是**反的**：
  //   它在 `autoMigrate=false` 时**仍然建表**，于是 true/false 两条路径产出同一结果，
  //   配置项沦为**死开关**（本仓 2026-09-24 实测：两者都建出 13 张表）。
  //   声明了却不起作用的开关与「静默失效」同类 —— 用户以为关掉了迁移，其实没关。
  //   ⇒ 判据：`autoMigrate` 必须产生**可观测差异**（见 `tests/schema-migration.test.mjs` 的 M6）。

  const service: ManaCoreService = {
    db: opened.db,
    storePath: opened.path,
    schemaVersion: opened.schemaVersion ?? SCHEMA_VERSION,
    journalMode: opened.journalMode,
    vecVersion: () => probeVecVersion(opened.db),
    // 归因通道：与 vecVersion() 走**同一段实现**，只是多带 failure/reason/errorCode。
    vecProbe: () => probeVecVersionDetail(opened.db),
    writeTrace(entry: TraceEntry): number {
      const stmt = opened.db.prepare(
        'INSERT INTO mana_trace (event_type, payload, session_id, turn_id, timestamp) VALUES (?, ?, ?, ?, ?)',
      )
      const info = stmt.run(
        entry.eventType,
        JSON.stringify(entry.payload ?? null),
        entry.sessionId,
        entry.turnId,
        entry.at ?? new Date().toISOString(),
      )
      return Number(info.lastInsertRowid)
    },
    writeInjectLog(entry: InjectLogEntry): number {
      // ⚠ 运行期强校验：非法 gate **立即抛**（见接口注释的理由）。
      if (!isInjectionGate(entry.gate)) {
        throw new Error(
          `mana-core: 非法 gate "${String(entry.gate)}" —— 只允许 ${INJECTION_GATES.join(' / ')}。` +
            '拒绝落库（否则「没注入」的五种情形将不可分辨）。',
        )
      }
      // 自洽性校验：`gate='degraded_unavailable'` **蕴含** `degraded=1`。
      // ⚠ 用 `||` 而**不是** `??`：`??` 会让调用方传 `degraded:false` 抹掉降级事实
      //   —— 那正是「让失败不可观测」（gate 已声明降级，落库却说没降级）。
      //   降级是**客观事实**，不是调用方可选的标注。
      const degraded = entry.degraded === true || entry.gate === 'degraded_unavailable'
      // 同形防呆（G1 席 · D2）—— 与上面一条**逐条同形**，理由也一样：
      //   `gate` 是枚举真源（生产侧写死），`reset` 只是**与它配对的显式位**。
      //   若调用方漏传，按 `reset=1` 的查询（如"还有多少块已离开上下文"）会**静默归零** ——
      //   而本仓实测该列此前**零生产者**（gate 说 reset、列说 0，同一事实两处读数互相矛盾）。
      //   用 `||` 而非 `??`：`gate='reset'` **蕴含** `reset=1`，调用方传 `false` 不能抹掉它。
      const reset = entry.reset === true || entry.gate === 'reset'
      const stmt = opened.db.prepare(
        `INSERT INTO inject_log
           (session_id, turn_id, request_id, memory_id, block_id, injected_at,
            gate, degraded, local_score, jev_prob, reset)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const info = stmt.run(
        entry.sessionId,
        entry.turnId,
        entry.requestId,
        entry.memoryId ?? null,
        entry.blockId ?? null,
        entry.at ?? new Date().toISOString(),
        entry.gate,
        degraded ? 1 : 0,
        entry.localScore ?? null,
        entry.jevProb ?? null,
        reset ? 1 : 0,
      )
      return Number(info.lastInsertRowid)
    },
    listInjectLog(sessionId?: string, limit = 100): InjectLogRow[] {
      const rows = sessionId
        ? opened.db
            .prepare('SELECT * FROM inject_log WHERE session_id = ? ORDER BY id DESC LIMIT ?')
            .all(sessionId, limit)
        : opened.db.prepare('SELECT * FROM inject_log ORDER BY id DESC LIMIT ?').all(limit)
      return rows as unknown as InjectLogRow[]
    },
    updateUserModel(update: UserModelUpdate): UserModelUpdateResult {
      const at = update.at ?? new Date().toISOString()
      // ⚠ 主表更新与历史追加在**同一事务**内：
      //   分开写会出现「主表改了、历史没记」的中间态，而那种态**读起来像没改过**
      //   （漂移不可观测）。同事务保证二者要么都成、要么都不成。
      let result: UserModelUpdateResult | null = null
      opened.db.exec('BEGIN IMMEDIATE')
      try {
        const prev = opened.db.prepare('SELECT value, confidence FROM user_model WHERE key = ?').get(update.key) as
          | { value?: string; confidence?: number }
          | undefined
        const previousValue = prev?.value ?? null
        const created = previousValue === null
        const nextConfidence = update.confidence ?? prev?.confidence ?? 0.5
        opened.db
          .prepare(
            `INSERT INTO user_model (key, value, confidence, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                            confidence = excluded.confidence,
                                            updated_at = excluded.updated_at`,
          )
          .run(update.key, update.value, nextConfidence, at)
        const info = opened.db
          .prepare(
            `INSERT INTO user_model_history
               (key, old_value, new_value, confidence, at, session_id, turn_id, source_evidence_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            update.key,
            previousValue,
            update.value,
            nextConfidence,
            at,
            update.sessionId ?? null,
            update.turnId ?? null,
            update.sourceEvidenceId ?? null,
          )
        result = {
          key: update.key,
          previousValue,
          newValue: update.value,
          changed: previousValue !== update.value,
          created,
          historyId: Number(info.lastInsertRowid),
        }
        opened.db.exec('COMMIT')
      } catch (error) {
        try {
          opened.db.exec('ROLLBACK')
        } catch {
          /* 回滚失败不掩盖原始错误（原始错误优先抛出） */
        }
        throw error
      }
      return result
    },
    listUserModelHistory(key?: string, limit = 1000): UserModelHistoryRow[] {
      const rows = key
        ? opened.db
            .prepare('SELECT * FROM user_model_history WHERE key = ? ORDER BY at ASC, id ASC LIMIT ?')
            .all(key, limit)
        : opened.db.prepare('SELECT * FROM user_model_history ORDER BY at ASC, id ASC LIMIT ?').all(limit)
      return rows as unknown as UserModelHistoryRow[]
    },
    writeMemoryItem(item): void {
      /**
       * ⚠ **不得改回 `INSERT OR REPLACE`**（2026-09-26 修，实测复现）。
       *
       * 原实现用 `INSERT OR REPLACE` 且只列 5 列 ⇒ 对同一 id 重写时，**未列出的列全部被重置**
       * （REPLACE = DELETE + INSERT 的语义）。实测在真库上被静默清空的列有 **7 列**：
       *   `retired` 1→0（**静默复活**，违反「软删除可逆且不得自发撤销」）
       *   `access_count` 7→0 · `base_level_activation` −1.5→0（ACT-R 激活被清零）
       *   `reconsolidation_window_until` →null（再巩固窗口丢失）
       *   `update_history` →null · `created_at` **被覆写成新时刻**
       *   `vector` **BLOB→null** ← *最凶的一条*：向量检索的数据源被打空，而**读侧只看到「没命中」**，
       *     与「库本来就空」**同形** ⇒ 属本仓最忌的「会掩盖其他问题」形态。
       *
       * 改为 **UPSERT**：冲突时只更新「本次写入真正提供的列」，其余列**原样保留**；
       * 「从未存在过」仍走 INSERT。`created_at` 只在首次写入时落值（用 `COALESCE`），
       * 重写**不再**篡改首见时刻。
       *
       * 反证对拍（不得只信本条注释）：`packages/core/tests/write-memory-item-upsert.test.mjs`
       *   · 造一条带 retired/access_count/vector 的记忆 ⇒ 重写 ⇒ **7 列逐列断言不得变化**；
       *   · 变异回 `INSERT OR REPLACE` ⇒ 该判据**必红**（逐字节恢复，未用 git reset --hard）。
       */
      opened.db
        .prepare(
          `INSERT INTO memory_items (id, type, content, summary, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             type = excluded.type,
             content = excluded.content,
             summary = excluded.summary`,
        )
        .run(item.id, item.type, item.content, item.summary ?? null, item.at ?? new Date().toISOString())
    },
    recallLexical(rawQuery: string, limit = 50): LexicalRecallResult {
      /**
       * ⚠ **口径 = 活记忆数（`retired = 0`），不是全表行数**（主持人裁定，2026-09-25）。
       *   本值的**唯一消费者**是下面的 `reason` 判定，它要回答的是
       *   「**对这次检索而言**库里有没有可查的东西」—— 而检索本身已排除 retired 行（见下面的 SQL）。
       *   若此处用全量计数，两种事实会**同形**：① 库真非空却查不到（A1-10 要判红的形态）
       *   ② 唯一那条记忆已退休（0 命中是**正确行为**）—— 实测实害：后者被读成前者（**假红**）。
       *   库里无 retired 行时两者数值相等 ⇒ 本改动是**口径修正**，不改变既有判据的结论。
       */
      const librarySize = Number(
        (opened.db.prepare('SELECT COUNT(*) c FROM memory_items WHERE retired = 0').get() as { c?: number })
          ?.c ?? 0,
      )
      const checked = checkQuery(rawQuery)
      // 长度闸先于查询：trigram 下短查询恒 0 命中且**不报错** ⇒ 必须显式分类。
      if (!checked.ok) {
        return { hits: [], reason: 'too_short', librarySize, normalizedQuery: null }
      }
      const rows = opened.db
        .prepare(
          `SELECT m.id AS id, m.content AS content, m.summary AS summary
             FROM memory_items_fts f
             JOIN memory_items m ON m.rowid = f.rowid
            WHERE memory_items_fts MATCH ?
              AND m.retired = 0
            LIMIT ?`,
        )
        .all(checked.query, limit) as { id: string; content: string; summary: string | null }[]
      // 0 命中的两种情形必须可分辨：① 库空（正常）② 库非空却查不到（**要判红的形态**）。
      const reason: LexicalRecallResult['reason'] =
        rows.length > 0 ? null : librarySize === 0 ? 'empty_library' : 'ok'
      return { hits: rows, reason, librarySize, normalizedQuery: checked.query }
    },
    withTransaction: <T>(fn: () => Promise<T> | T) => withImmediateTransaction(opened.db, fn),
    recordInactive(id: string, missing: string[]): void {
      service.writeTrace({
        eventType: 'mana/plugin/inactive',
        sessionId: '',
        turnId: 0,
        payload: { id, missing, at: new Date().toISOString() },
      })
    },
    backupNow: () => backupNow(opened.db, opened.path),
    pruneBackups: (keep) => pruneBackups(resolveBackupDir(opened.path, config.backupDir), keep ?? config.backupKeep),
    backupDir: () => resolveBackupDir(opened.path, config.backupDir),
  }

  // 资源挂 ctx.effect：插件卸载时自动释放（「卸载即净」）。
  ctx.effect(() => {
    const dispose = ctx.provide(SERVICE_NAME, service)
    const policy: BackupPolicy = {
      ...DEFAULT_BACKUP_POLICY,
      enabled: config.backupEnabled,
      intervalMs: config.backupIntervalMs,
      keep: config.backupKeep,
      dir: config.backupDir,
    }
    // 备份失败必须显式落痕（G8），不得静默 —— 落一条 mana_trace 而不是只 console
    const stopTimer = startBackupTimer(opened.db, opened.path, policy, (error) => {
      try {
        service.writeTrace({
          eventType: 'mana/plugin/inactive',
          sessionId: '',
          turnId: 0,
          payload: { id: 'mana-core/backup', missing: [], at: new Date().toISOString(),
                     error: error instanceof Error ? error.message : String(error) },
        })
      } catch {
        // 连落痕都失败时不再递归：此处静默是**有意的最后兜底**，
        // 但上面的 writeTrace 已是主通道（正常路径必有痕）。
      }
    })
    return () => {
      stopTimer()
      dispose()
      opened.close()
    }
  }, 'dsh-mana-core: service + db + backup timer')

  registerPassThroughPreStep(ctx, name)
}

export {
  openManaDb,
  probeVecVersion,
  probeVecVersionDetail,
  isNoSuchFunctionError,
  walApplied,
  withImmediateTransaction,
} from './db.ts'
export type { VecProbeFailure, VecProbeReading } from './db.ts'
export {
  backupNow,
  backupFileName,
  pruneBackups,
  resolveBackupDir,
  restoreBackup,
  startBackupTimer,
  DEFAULT_BACKUP_POLICY,
} from './open.ts'
export type { BackupPolicy, BackupResult } from './open.ts'
export {
  createSchema,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  MIN_QUERY_CHARS,
  checkQuery,
} from './schema.ts'
export {
  MANA_STAGES,
  INJECTION_GATES,
} from './domain.ts'
export type {
  InjectionGate,
  JevJudgeRequest,
  JevJudgeResult,
  ManaAttention,
  ManaDecision,
  ManaEnvelope,
  ManaInjection,
  ManaObservation,
  ManaPluginInactive,
  ManaRecall,
  ManaStage,
} from './domain.ts'
