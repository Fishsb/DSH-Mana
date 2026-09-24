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
import { openManaDb, probeVecVersion, withImmediateTransaction, type ManaDb } from './db.ts'
import { createSchema, SCHEMA_VERSION } from './schema.ts'
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
}

export const Config: Schema<Config> = Schema.object({
  storePath: Schema.string().default(''),
  busyTimeoutMs: Schema.number().default(5000),
  autoMigrate: Schema.boolean().default(true),
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
  /** `vec_version()` 探针：null = 扩展未装载（**显式事实，不是静默降级**）。 */
  vecVersion(): string | null
  /** 写一条认知轨迹，返回自增 `seq`。 */
  writeTrace(entry: TraceEntry): number
  /** 手写 BEGIN IMMEDIATE 事务（G7）。 */
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>
  /** 记录一次「插件因依赖缺失未运行」。 */
  recordInactive(id: string, missing: string[]): void
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

  // 建表幂等：autoMigrate=false 时仍保证有建表入口可调（判据脚本用）。
  if (!config.autoMigrate) createSchema(opened.db)

  const service: ManaCoreService = {
    db: opened.db,
    storePath: opened.path,
    schemaVersion: opened.schemaVersion ?? SCHEMA_VERSION,
    journalMode: opened.journalMode,
    vecVersion: () => probeVecVersion(opened.db),
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
    withTransaction: <T>(fn: () => Promise<T> | T) => withImmediateTransaction(opened.db, fn),
    recordInactive(id: string, missing: string[]): void {
      service.writeTrace({
        eventType: 'mana/plugin/inactive',
        sessionId: '',
        turnId: 0,
        payload: { id, missing, at: new Date().toISOString() },
      })
    },
  }

  // 资源挂 ctx.effect：插件卸载时自动释放（「卸载即净」）。
  ctx.effect(() => {
    const dispose = ctx.provide(SERVICE_NAME, service)
    return () => {
      dispose()
      opened.close()
    }
  }, 'dsh-mana-core: service + db')

  registerPassThroughPreStep(ctx, name)
}

export { openManaDb, probeVecVersion, walApplied, withImmediateTransaction } from './db.ts'
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
