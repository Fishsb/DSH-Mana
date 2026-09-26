/**
 * `dsh-mana-jev` —— JEV 适配层（P0 骨架 + B1.2 判定原语 + B1.3 模型无关护栏）。
 *
 * 阶段 0 立骨架：**`name` + `inject` + `apply` + 一条直通 waterfall**。
 * 阶段 1 的 B1.2 在 `src/ollama.ts` 落地**单 token logprob 原语 + 降级留痕**；
 * B1.3 在 `src/framework.ts` 落地**缓存 TTL / 熔断 / 冷却半开 / 全局并发上限 / 每 session 预算**，
 * 并在此处把六项 `Config` **真接进** `apply()`（此前 `void config` ⇒ 四项零消费）。
 *
 * ⚠ **模型适配面本轮不动**（用户指令：模型差，先做框架）：不换模型、不调提示词、
 *   不追概率质量。判定值仍全部来自单 token 原语；框架只决定「要不要去判」。
 *
 * ⚠ 骨架的 `status()` 是**机制自证**（"插件装载了、服务挂上了"），
 *   **不等于运行态**。按本仓纪律，放行一律看产物侧证据（`mana_trace` / `jev_log` 行）
 *   + 反证（卸载后不再产生新行）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
// ⚠ 只为**类型**而引（本批 f3 收尾）：监听器的返回值必须仍是契约形状 `JevJudgeResult`。
import type { JevJudgeResult } from 'dsh-mana-core'
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import {
  judgeWithOllama,
  stateHash,
  JEV_DEFAULT_MODEL,
  OLLAMA_DEFAULT_ENDPOINT,
  type JudgeOptions,
  type JevJudgeOutcome,
} from './ollama.ts'
import {
  judgeWithSystemone,
  readApiKey,
  SYSTEMONE_API_KEY_ENV,
  SYSTEMONE_DEFAULT_ENDPOINT,
  SYSTEMONE_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_PATH,
  SYSTEMONE_DEFAULT_PRIMARY,
  type JevQuestions,
  type SystemoneJudgeOptions,
} from './systemone.ts'
import {
  JEV_DEFAULT_BREAKER_FAILURES,
  JEV_DEFAULT_CACHE_TTL_SECONDS,
  JEV_DEFAULT_COOLDOWN_SECONDS,
  JEV_DEFAULT_MAX_CONCURRENCY,
  JEV_DEFAULT_SESSION_BUDGET,
  JEV_MAX_CONCURRENCY_LIMIT,
  JevGuard,
  judgeFanout,
  judgeSeries,
  judgeWithGuard,
  makeJevOutcome,
  type FanoutItem,
  type GuardedJudgeOptions,
  type GuardedJudgeOutcome,
  type JevGuardSnapshot,
} from './framework.ts'

export const name = 'mana-jev'

/** 依赖 core（方案 §9.1）。缺 core 时本插件停在 waiting，不半启动。 */
export const inject: string[] = ['mana-core']

export interface Config {
  /** 判定结果缓存 TTL（秒）。方案 §6.4 原值 300。**B1.3 起真消费**（`JevGuard.checkCache`）。 */
  cacheTtlSeconds: number
  /** 熔断阈值：连续失败次数。方案 §6.4 原值 5。**B1.3 起真消费**。 */
  circuitBreakerFailures: number
  /** 熔断冷却（秒）。方案 §6.4 原值 60。**B1.3 起真消费**。 */
  circuitBreakerCooldownSeconds: number
  /**
   * 全局并发上限（W1-2：缺省 32，**硬上限 120**）。
   *
   * 缺省值与其依据见 `framework.ts` 的 `JEV_DEFAULT_MAX_CONCURRENCY` 长注；
   * 上限由这里的 Schema `.max()` 结构性保证 —— 超过服务端能力（120）在**配置面**就红，
   * 而不是变成一堆 429 降级行之后才被发现。
   */
  maxConcurrency: number
  /**
   * 每 session 判定次数上限（方案 §6.4「每次 session 设置 JEV 调用预算上限」）。
   * **B1.3 新增**；计的是**判定次数**（含缓存命中与拒绝），不是 token 数 ——
   * 本机 Ollama 免费，受限的是一次推理的墙钟时间，预算即调用预算。
   */
  sessionBudget: number
  /**
   * 等并发槽位的超时（毫秒；0 = 永久等待）。**B1.3 新增**：不加超时则满载时调用会**无声挂起**，
   * 而这正是「让失败不可观测」的形态。
   */
  concurrencyWaitTimeoutMs: number
  /**
   * 判定**通道**选择器（B1.4 新增；**缺省 W1-2 翻转为 'systemone'**）。
   *
   * · `'systemone'`（**缺省**）= 真 JEV 本体（`POST {systemoneEndpoint}/api/v1/systemone`）；
   * · `'ollama'`             = 本机单 token logprob 原语（**保留可切换，绝不删**）。
   *
   * ── 为什么缺省要翻（W1-2 落点，实测依据）────────────────────────────────────
   * 旧缺省是 `'ollama'`，而 `'ollama'` **不是 JEV 模型** —— 它是本机的单 token logprob
   * 原语（"yes/no 概率"的替身语义）。于是「配好了真 JEV 却在跑替身」是一种**静默**的
   * 配置与能力不匹配：进程照起、判定照出、库里照落行，只有读 `model` 列才看得出来。
   * 判据：缺省必须是**能力最强的那个**，降级必须是**显式**动作（而不是什么都不做时的默认）。
   *
   * ⚠ 翻转的**代价**如实记：缺省腿不再零依赖 —— 真通道需要 key（环境变量
   *   `systemoneApiKeyEnv`）。**无 key 时不发请求、显式降级** `systemone-no-api-key`
   *   （不静默、**不回落 Ollama**：回落会把"没配好"伪装成"配好了"）。
   *   要跑本机替身就把 `channel` 显式设成 `'ollama'` —— 那是一条仍在、且被判据钉住的路。
   */
  channel: 'ollama' | 'systemone'
  /** 真 JEV 端点（B1.4 新增；仅 `channel:'systemone'` 时使用）。 */
  systemoneEndpoint: string
  /** 真 JEV 判定模型（B1.4 新增）。实测合法名见 `systemone.ts` 的白名单常量。 */
  systemoneModel: string
  /**
   * 真 JEV 的 **key 来源：环境变量名**（B1.4 新增）。
   *
   * ⚠ **配置里存的是变量名，不是 key 本身** —— key 永不进仓库、永不进配置文件。
   *   变量为空/未设置 ⇒ `judgeWithSystemone` **不发请求**并显式降级 `systemone-no-api-key`。
   */
  systemoneApiKeyEnv: string
  /** 真 JEV 路径（B1.4 新增；缺省 `/api/v1/systemone`）。 */
  systemonePath: string
  /** 契约单值面取哪个问题键（B1.4 新增；多问时才有意义，缺省 `'v'`）。 */
  systemonePrimaryQuestion: string
  /** Ollama 端点（B1.2 已实现）。 */
  endpoint: string
  /** 判定模型（B1.2 已实现）。方案禁 `qwen3:8b`（"yes"=1.000 饱和无区分度）。 */
  model: string
}

export const Config: Schema<Config> = Schema.object({
  cacheTtlSeconds: Schema.number().default(JEV_DEFAULT_CACHE_TTL_SECONDS),
  circuitBreakerFailures: Schema.number().default(JEV_DEFAULT_BREAKER_FAILURES),
  circuitBreakerCooldownSeconds: Schema.number().default(JEV_DEFAULT_COOLDOWN_SECONDS),
  // ⚠ W1-2：上限 120 是**配置面**的红线（超过它会在配置解析时报错，而不是静默压成 120）。
  maxConcurrency: Schema.number().default(JEV_DEFAULT_MAX_CONCURRENCY).min(1).max(JEV_MAX_CONCURRENCY_LIMIT),
  sessionBudget: Schema.number().default(JEV_DEFAULT_SESSION_BUDGET),
  concurrencyWaitTimeoutMs: Schema.number().default(30_000),
  // 选择器：非法值**抛错**而不是静默回落（静默回落 = "配置点了没反应"的经典形态）
  // ⚠ W1-2：缺省翻转为真 JEV（理由见 Config.channel 的长注）。要本机替身请**显式**设 'ollama'。
  channel: Schema.union([Schema.const('ollama'), Schema.const('systemone')]).default('systemone'),
  systemoneEndpoint: Schema.string().default(SYSTEMONE_DEFAULT_ENDPOINT),
  systemoneModel: Schema.string().default(SYSTEMONE_DEFAULT_MODEL),
  systemoneApiKeyEnv: Schema.string().default(SYSTEMONE_API_KEY_ENV),
  systemonePath: Schema.string().default(SYSTEMONE_DEFAULT_PATH),
  systemonePrimaryQuestion: Schema.string().default(SYSTEMONE_DEFAULT_PRIMARY),
  endpoint: Schema.string().default(OLLAMA_DEFAULT_ENDPOINT),
  model: Schema.string().default(JEV_DEFAULT_MODEL),
})

/**
 * 判定驱动（`judgeWithGuard` 的**通道注入缝**）。
 *
 * ⚠ 必须是**模块级**的稳定引用，而不是调用方每次新建的闭包：`judgeGuarded` 的缺省
 *   `judgeFn` 直接取它。两处都把 `endpoint`/`model` 显式补齐 ⇒ 驱动不依赖任何缺省值巧合。
 */
const ollamaDriver = (o: JudgeOptions): Promise<JevJudgeOutcome> =>
  judgeWithOllama({
    ...o,
    endpoint: o.endpoint ?? OLLAMA_DEFAULT_ENDPOINT,
    model: o.model ?? JEV_DEFAULT_MODEL,
  })

const systemoneDriver = (o: JudgeOptions): Promise<JevJudgeOutcome> =>
  judgeWithSystemone({
    ...(o as SystemoneJudgeOptions),
    endpoint: o.endpoint ?? SYSTEMONE_DEFAULT_ENDPOINT,
    model: o.model ?? SYSTEMONE_DEFAULT_MODEL,
    path: (o as SystemoneJudgeOptions).path ?? SYSTEMONE_DEFAULT_PATH,
    primaryQuestion: (o as SystemoneJudgeOptions).primaryQuestion ?? SYSTEMONE_DEFAULT_PRIMARY,
  })

/**
 * 批次接口的入参：`judgeGuarded` 的全参（去 guard/db）+ **真 JEV 专有三件套**。
 *
 * `path` / `primaryQuestion` / `questions` 只在真通道有意义（替身通道一次一问），
 * 故它们不属于 `GuardedJudgeOptions`；写成独立类型而不是往底层入参里塞可选字段 ——
 * 底层入参被两通道共用，塞进去会让"替身通道收到 questions 却静默忽略"成为合法形态。
 */
export interface BatchJudgeOptions
  extends Omit<GuardedJudgeOptions, 'guard' | 'db' | 'judgeFn'> {
  /** 一次请求塞的 N 问（**以 id 为键的 map**；数组会被服务端 400 拒）。 */
  questions: JevQuestions
  /** 取哪一问做契约单值面；缺省 `Config.systemonePrimaryQuestion`。 */
  primaryQuestion?: string
  /** 真 JEV 路径；缺省 `Config.systemonePath`。 */
  path?: string
  /** 判定驱动注入缝（判据用；缺省真 JEV 驱动）。 */
  judgeFn?: (options: JudgeOptions) => Promise<JevJudgeOutcome>
}

/** JEV 服务面。 */
export interface ManaJevService {
  readonly plugin: string
  /**
   * 机制自证读数（**不是**运行态判据）。
   *
   * `channel` 是**生效中**的通道（读得到的配置才是被消费的配置）；`systemoneApiKeyEnv`
   * 只回**变量名**，**永不回 key 本身**。
   *
   * ── W1-2 补的四处读数（"当前生效通道"与"模型名"必须**能读出来**）──────────────
   * 只回 `channel` 是不够的：通道名对了、模型名配错（例如把 Ollama 的模型名拿去问真 JEV）
   * 时，进程照起、判定每次 400 —— 而 status() 看上去一切正常。
   * ⇒ 再加：生效端点、**生效模型**、key 变量名是否真的能解析到 key（**只回布尔，不回 key**）、
   *   并发上限与"上限被配置面拒绝"的红线值。
   *
   * ⚠ `model` 是**请求侧**生效的模型名（配置值）；**服务端真正服务**的模型名在每条判定
   *   结果的 `servedModel` 上（它与请求名互为反证，二者不同即说明被服务端改写/路由）。
   */
  status(): {
    plugin: string
    wired: boolean
    coreStorePath: string
    channel: 'ollama' | 'systemone'
    systemoneApiKeyEnv: string
    /** 生效通道对应的**请求侧模型名**（真通道 = systemoneModel，替身 = model）。 */
    model: string
    /** 生效通道对应的**端点**（真通道 = systemoneEndpoint，替身 = endpoint）。 */
    endpoint: string
    /** 请求路径（替身 = /api/chat；真通道 = systemonePath）。 */
    path: string
    /** 凭据是否已就绪（**只回布尔**：key 本身永不经过服务面）。 */
    credentialPresent: boolean
    /** 生效的全局并发上限（= guard.config.maxConcurrency；读得到的配置才是被消费的配置）。 */
    maxConcurrency: number
    /** 并发上限的**配置面红线**（120）；超过它在装配时就报错。 */
    maxConcurrencyLimit: number
  }
  /**
   * 判定一次（B1.2）。
   *
   * 端点/模型取自插件 Config；**库句柄取自 core 服务** ⇒ 正常与降级**都会**
   * 往 `jev_log` 落一行（G8：降级不得静默）。
   *
   * ⚠ 本方法**刻意不加护栏**（缓存/熔断/并发/预算）—— 它是单 token 原语的薄封装，
   *   上一轮 11 条判据逐条打在它上面。要护栏请用 `judgeGuarded()`。
   */
  judge(options: Omit<JudgeOptions, 'db' | 'endpoint' | 'model'> & Partial<Pick<JudgeOptions, 'endpoint' | 'model'>>): Promise<JevJudgeOutcome>
  /**
   * **真 JEV 通道**判定一次（B1.4 新增）。
   *
   * 与 `judge()` 的关系：同签名、同落痕保证，只是**通道**不同（`/api/v1/systemone`，
   * 概率由服务端直接给，不做任何 token 归一）。
   * 端点/模型/key 变量名/路径/主问题键取自 Config；`apiKey` 可显式传入（判据用）。
   * ⚠ 无凭据时**不发请求**，显式降级 `systemone-no-api-key`（不静默、不回落 Ollama）。
   */
  judgeSystemone(
    options: Omit<SystemoneJudgeOptions, 'db' | 'endpoint' | 'model' | 'path' | 'primaryQuestion'> &
      Partial<Pick<SystemoneJudgeOptions, 'endpoint' | 'model' | 'path' | 'primaryQuestion'>>,
  ): Promise<JevJudgeOutcome>
  /**
   * 判定一次，**框架全程在环**（B1.3）：熔断/预算准入 → 缓存 → 并发槽 → 模型 → 记录。
   * 缓存命中、熔断拒绝、超预算、并发超时四条非模型路径**同样**落一行 `jev_log`（A1-14）。
   *
   * ⚠ B1.4 起：护栏**跟 `channel` 走**（`'systemone'` 时驱动真 JEV 通道，否则 Ollama）。
   *   不做成"两个入口"是因为护栏与通道无关，两套入口会让真通道悄悄绕过全部护栏。
   */
  judgeGuarded(options: Omit<GuardedJudgeOptions, 'guard' | 'db' | 'endpoint' | 'model'> & Partial<Pick<GuardedJudgeOptions, 'endpoint' | 'model'>>): Promise<GuardedJudgeOutcome>
  /**
   * **批次判定**（W1-2 新增）：一次请求塞 N 问（真 JEV 专有形态）。
   *
   * ⚠ `questions` 必须是**以 id 为键的 map**（契约：`JevQuestions = Record<string, JevQuestion>`）——
   *   实测传数组会被服务端 400 拒绝（`invalid_questions` / "Questions must be a non-empty object"）。
   *   TS 类型在这里已经把它钉死；判据另有一条真跑腿把"数组必 400"记成事实。
   * ⚠ 只有 `channel:'systemone'` 有"一次请求多问"的语义。走替身（`'ollama'`，一次一问）
   *   时本方法**显式降级** `jev-batch-needs-systemone-channel`，**不**偷偷循环 N 次 ——
   *   那样返回形状一样但语义完全不同（N 次网络往返），调用方看不出来。
   *   要 N 次调用请显式用 `judgeSeries()`（串行）或 `judgeFanout()`（并发）。
   * ⚠ 契约单值面（`value`/`probability`）只取 `primaryQuestion` 那一问；其余各问的答案
   *   **一条不丢**地落在 `answers` 里（多问不压扁）。
   */
  judgeBatch(options: BatchJudgeOptions): Promise<GuardedJudgeOutcome>
  /**
   * **扇出判定**（W1-2 新增）：N 项一起进飞，逐项独立过护栏、独立落痕；
   * 部分失败不中断整批（异常就地转成**该项**的降级，数组长度与顺序与入参逐位对应）。
   *
   * 并发上限**只有一处**：`Config.maxConcurrency`（缺省 32，上限 120）——
   * 本方法刻意**不收**"本批并发数"参数（第二个并发旋钮 = 必然漂移的口径）。
   */
  judgeFanout(items: readonly FanoutItem[]): Promise<GuardedJudgeOutcome[]>
  /** 串行判定一批（**同一时刻最多 1 项在飞**）：并发上限配成 1 时的等价通路，也是反证对拍的基准。 */
  judgeSeries(items: readonly Omit<GuardedJudgeOptions, 'guard' | 'db'>[]): Promise<GuardedJudgeOutcome[]>
  /** 护栏态快照（可枚举字段，供探针与判据断言）。 */
  guardState(): JevGuardSnapshot
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-jev': ManaJevService
  }
}

/**
 * 「本层已落痕」这个事实的**错误侧载体**（`Symbol.for` ⇒ 跨模块稳定，不与下游字段撞名）。
 * 调用方（如 Recall Gate）在下游抛错时读它来判断"这一条到底落没落行"。
 */
export const JEVD_TRACE_WRITTEN = Symbol.for('mana.jev.judge.traceWritten')

/**
 * 批次接口在**替身通道**（`channel:'ollama'`）上的降级原因。
 *
 * 为什么必须显式降级而不是"循环 N 次"：替身一次只问一问，替身通道下"批量"只能靠 N 次
 * 网络往返实现 —— 返回形状一模一样，语义（1 次往返 vs N 次往返、N 倍延迟与费用）完全不同，
 * **调用方从返回值上看不出来**。这正是"看起来正常、实际换了条路"的形态。
 */
export const JEV_BATCH_CHANNEL_REASON = 'jev-batch-needs-systemone-channel'

/**
 * 下游监听器可能返回的**部分**结果形状（本监听器只读这几个字段）。
 * ⚠ 用 `Partial` 而不是 `JevJudgeResult`：桩/下游可能只给一部分字段（既有判据里就有这种桩）。
 */
type DownstreamReply = Partial<{
  requestId: string
  source: string
  value: 'yes' | 'no' | 'unknown'
  probability: number | null
  degraded: boolean
  reason: string | null
}>

export function apply(ctx: Context, config: Config): void {
  const core = ctx.get('mana-core')
  if (!core) throw new Error('mana-jev: 缺少 mana-core 服务（inject 未满足，不应半启动）')

  // ── B1.3：配置项在这里**真被消费**（此前 `apply()` 末行是 `void config`）────────
  // 五项护栏参数逐项取自 Config；`endpoint`/`model` 供判定链路使用。
  const guard = new JevGuard({
    cacheTtlSeconds: config.cacheTtlSeconds,
    circuitBreakerFailures: config.circuitBreakerFailures,
    circuitBreakerCooldownSeconds: config.circuitBreakerCooldownSeconds,
    maxConcurrency: config.maxConcurrency,
    sessionBudget: config.sessionBudget,
  })
  guard.setWaitTimeoutMs(config.concurrencyWaitTimeoutMs)

  /**
   * 生效通道的三件套（端点/模型/路径）与凭据就绪度 —— **只在这一处算**。
   *
   * 为什么抽出来：`status()`（给人读）与 `systemoneDriver`（真发请求）必须**同源**，
   * 否则会出现"status 说模型是 A、实际发出去的是 B"这种最难查的形态。
   */
  const channelView = (): {
    endpoint: string
    model: string
    path: string
    credentialPresent: boolean
  } => {
    const real = config.channel === 'systemone'
    return {
      endpoint: real ? config.systemoneEndpoint : config.endpoint,
      model: real ? config.systemoneModel : config.model,
      path: real ? config.systemonePath : '/api/chat',
      // ⚠ 只回**布尔**：key 本身永不经过服务面、永不落盘、永不进日志。
      //   "读到 key 了吗"这个事实必须可读（否则"没配好"与"配好了但服务端挂了"不可分辨）。
      credentialPresent: real
        ? 'key' in readApiKey(undefined, config.systemoneApiKeyEnv)
        : true,
    }
  }

  const service: ManaJevService = {
    plugin: name,
    status: () => {
      const view = channelView()
      return {
        plugin: name,
        wired: true,
        coreStorePath: core.storePath,
        channel: config.channel,
        // 只回**变量名**（key 本身永不经过服务面，更不落盘）
        systemoneApiKeyEnv: config.systemoneApiKeyEnv,
        model: view.model,
        endpoint: view.endpoint,
        path: view.path,
        credentialPresent: view.credentialPresent,
        // 并发上限的**生效值**取自护栏实例（不是再读一遍 config）——读得到的配置才是被消费的配置
        maxConcurrency: guard.snapshot().config.maxConcurrency,
        maxConcurrencyLimit: JEV_MAX_CONCURRENCY_LIMIT,
      }
    },
    // B1.2：判定原语接到服务面。库句柄来自 core ⇒ 落痕与判定同源，
    // 且「降级留痕」由 judgeWithOllama 的单一出口结构性保证（非调用方义务）。
    judge: (options) =>
      judgeWithOllama({
        ...options,
        endpoint: options.endpoint ?? config.endpoint,
        model: options.model ?? config.model,
        db: core.db,
      }),
    // B1.4：真 JEV 通道（`/api/v1/systemone`）。同款单一出口 ⇒ 降级同样留痕。
    // ⚠ 端点/模型/路径/主问题键的**缺省来自各自通道的常量**（不是另一通道的配置），
    //   否则 `channel:'systemone'` 时会拿 Ollama 的模型名去问真 JEV（400 model_not_supported）。
    judgeSystemone: (options) =>
      judgeWithSystemone({
        ...options,
        endpoint: options.endpoint ?? config.systemoneEndpoint,
        model: options.model ?? config.systemoneModel,
        path: options.path ?? config.systemonePath,
        primaryQuestion: options.primaryQuestion ?? config.systemonePrimaryQuestion,
        apiKeyEnv: options.apiKeyEnv ?? config.systemoneApiKeyEnv,
        db: core.db,
      }),
    // B1.3 + B1.4：带护栏的判定。库句柄同样来自 core ⇒ 护栏四条拒绝路径也各有痕。
    // **通道跟 config.channel 走**：护栏只有一套，通道是可换的驱动。
    judgeGuarded: (options) =>
      judgeWithGuard({
        ...options,
        guard,
        // 通道缺省时按 `channel` 选驱动；显式传 `judgeFn`（判据用）优先。
        judgeFn: options.judgeFn ?? (config.channel === 'systemone' ? systemoneDriver : ollamaDriver),
        endpoint: options.endpoint ?? (config.channel === 'systemone' ? config.systemoneEndpoint : config.endpoint),
        model: options.model ?? (config.channel === 'systemone' ? config.systemoneModel : config.model),
        channel: options.channel ?? config.channel,
        db: core.db,
      }),
    // ── W1-2：批次 / 扇出 / 串行 三个服务面入口 ────────────────────────────────
    // ⚠ 与 `judgeGuarded` **同一条通道选择逻辑**（同一处 config.channel 判定）：
    //   若各自再写一份，两处一旦漂移就会出现"单问走真通道、批量走替身"这种看代码看不出来的形态。
    judgeBatch: (options) => {
      // 替身通道**没有**"一次请求多问"的语义 ⇒ 显式降级（绝不偷偷循环 N 次）。**不落痕**：
      // 本层拿不到 core.db 之外的落痕口时宁可不落，也不伪造一行（调用方按 reason 可断言）。
      if (config.channel !== 'systemone') {
        const { questions: _q, ...rest } = options
        return Promise.resolve({
          ...makeJevOutcome(
            {
              requestId: (rest.idFactory ?? (() => `batch-${Date.now()}`))(),
              requestType: rest.requestType ?? 'jev',
              source: rest.source ?? 'mana-jev',
              stateHash: stateHash(rest.state),
              value: 'unknown',
              probability: null,
              degraded: true,
              reason: JEV_BATCH_CHANNEL_REASON,
              candidates: [],
              normalization: null,
              model: config.model,
              endpoint: config.endpoint,
              sessionId: rest.sessionId,
              turnId: rest.turnId,
              channel: config.channel,
            },
            { db: core.db, atIso: (rest.now ?? (() => new Date()))().toISOString() },
          ),
          fromCache: false,
          sessionSpend: guard.sessionSpend(rest.sessionId),
          circuitState: guard.circuitState(),
        })
      }
      // ⚠ 类型：`questions`/`path`/`primaryQuestion` 是**真通道专有**字段，底层入参
      //   `GuardedJudgeOptions` 不含它们。这里显式声明成"底层入参 + 三个透传字段"，
      //   而不是给底层入参加索引签名 —— 那会让"替身通道收到 questions 却静默忽略"合法化。
      //   运行时它们经 `withDefaults()` 的 `...rest` 原样到达驱动（与 judgeSystemone 同路）。
      const batchArgs: GuardedJudgeOptions & {
        questions?: JevQuestions
        path?: string
        primaryQuestion?: string
      } = {
        ...options,
        guard,
        judgeFn: options.judgeFn ?? systemoneDriver,
        endpoint: options.endpoint ?? config.systemoneEndpoint,
        model: options.model ?? config.systemoneModel,
        path: options.path ?? config.systemonePath,
        primaryQuestion: options.primaryQuestion ?? config.systemonePrimaryQuestion,
        channel: options.channel ?? config.channel,
        db: core.db,
      }
      return judgeWithGuard(batchArgs)
    },
    judgeFanout: (items) =>
      judgeFanout(
        items.map((item) => ({
          ...item,
          judgeFn: item.judgeFn ?? (config.channel === 'systemone' ? systemoneDriver : ollamaDriver),
          endpoint:
            item.endpoint ?? (config.channel === 'systemone' ? config.systemoneEndpoint : config.endpoint),
          model: item.model ?? (config.channel === 'systemone' ? config.systemoneModel : config.model),
          channel: item.channel ?? config.channel,
          db: core.db,
        })),
        guard,
      ),
    judgeSeries: (items) =>
      judgeSeries(
        items.map((item) => ({
          ...item,
          judgeFn: item.judgeFn ?? (config.channel === 'systemone' ? systemoneDriver : ollamaDriver),
          endpoint:
            item.endpoint ?? (config.channel === 'systemone' ? config.systemoneEndpoint : config.endpoint),
          model: item.model ?? (config.channel === 'systemone' ? config.systemoneModel : config.model),
          channel: item.channel ?? config.channel,
          db: core.db,
        })),
        guard,
      ),
    guardState: () => guard.snapshot(),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-jev', service)
    return () => dispose()
  }, 'dsh-mana-jev: service')

  // 阶段 1 的判定链将挂在此扩展点之后；现在只做直通（必须调 next()，G9）。
  registerPassThroughPreStep(ctx, name)

  /**
   * **判定链监听器**（B1.2 的接入口 · `mana/jev/judge`）。
   *
   * ⚠ 两条硬纪律（`docs/contract/event-types.ts` 明文）：
   *   ① 本事件是 **waterfall** 型 ⇒ 分发方必须 `ctx.waterfall(...)`；用 `emit` 会同步抛
   *      `TypeError: next is not a function`（G6）。
   *   ② 监听器**必须调 `next()`** —— 漏调会**无声**吞掉下游默认行为（本仓实测全程无异常）。
   *      本监听器是"最外层判定者"：自己判得出就直接返回；判不出就把 `next()` 的结果透传。
   *
   * ⚠ **降级必须显式**（G8）：失败时返回 `degraded:true` + 非空 `reason` + `value:'unknown'`
   *   + `probability:null`（**不得用 0 冒充「概率为零」**），绝不 `catch { return null }`。
   *
   * ⚠ **`sessionId` / `turnId` 必须透传到护栏**（本批修，2026-09-26；**只补这两项，纯增量**）：
   *   此前本监听器**只透传了 `state` 与 `question`**，于是：
   *   ① `guard.budgetExhausted(undefined)`（`framework.ts:459`）⇒ **所有调用方并进同一条虚构分区**，
   *      session 预算护栏对**任何**调用方都不生效，「A 会话吃掉 B 会话预算」在库里看不出；
   *   ② `o.sessionId` 恒 `undefined` ⇒ 落痕列 `session_id` 恒为 `null`（实测：3 行全是 `[null,null,null]`），
   *      而 `judgeWithGuard` 的 `finish()` 传下去的 `sessionId` 只有 `options.sessionId` 一个来源 ⇒
   *      「这条判定属于哪个会话」**在库里不可查**；
   *   ⚠ `requestType` / `source` / `threshold` **本批刻意不转发**（见下方监听器内的原因）：
   *     前两者会改写既有调用方的落库口径，后者是串味（把调用方的放行阈值当判定内部分界）。
   *   `JevJudgeRequest` 的契约面**没有**这两个字段（`packages/core/src/domain.ts:138-146`，
   *   本批**不改契约**），故用**可选字段读取**：给了就透传，没给就仍取缺省（既有调用方零影响）。
   *   ⚠ 透传的是**请求侧**的会话标识，不改判定链的返回值形状（返回面仍是 `JevJudgeResult`）。
   */
  ctx.on('mana/jev/judge', async (req, next) => {
    const extra = req as { sessionId?: string; turnId?: number }
    const outcome = await service.judgeGuarded({
      state: req.state,
      question: req.question,
      idFactory: () => req.requestId,
      // 契约外可选字段：**有就读、没有就沿用缺省**（不得用空串兜底 —— 那会把所有会话并成一个虚构分区）。
      ...(typeof extra.sessionId === 'string' && extra.sessionId !== '' ? { sessionId: extra.sessionId } : {}),
      ...(typeof extra.turnId === 'number' ? { turnId: extra.turnId } : {}),
      // ⚠⚠ **不得透传 `req.threshold`**（本批实测缺陷，2026-09-26）：
      //   `JevJudgeRequest.threshold` 是**调用方的放行阈值**（attention 传 `jevThreshold`、
      //   Recall Gate 传召回阈值），而 `judgeWithOllama` 把它当**判定内部的 yes/no 分界**
      //   （`ollama.ts:423` `pYes >= threshold ? 'yes' : 'no'`）—— 两者是**两个不同的量**。
      //   实测后果：召回阈值 0.99 会把 `pYes=0.9` 写成 `value='no'`，而 `probability` 仍是 0.9
      //   ⇒ 落库行的 `result_value` 与 `probability` **自相矛盾**（'no' 却带 0.9 的概率），
      //   且这个污染**只发生在监听器这一层**，看调用方代码看不出来。
      //   ⇒ 驱动一律用自身缺省；调用方的阈值由调用方自己判（本仓 attention / Recall Gate 都这么做）。
      //
      // ⚠ **也不转发 `requestType` / `source`**（本席自我收窄，如实记）：它们落在
      //   `jev_log.request_type` / `source` 两列 ⇒ 转发会**改变既有调用方（attention）的落库行**
      //   （`'jev'` → `'noul'`、`'mana-jev'` → `'mana-attention'`），那是**未被本批授权的
      //   既有可观测面变更**。本批只补「此前恒为 null 的归属列」（`session_id`/`turn_id`），
      //   即**纯增量**：既有调用方没传 ⇒ 与 HEAD 逐字同值。改 request_type/source 的口径
      //   会让既有 jev_log 读数变化，属需拍板项，须另开一批。
    })
    if (!outcome.degraded && typeof outcome.probability === 'number') {
      return {
        requestId: req.requestId,
        source: name,
        value: outcome.value === 'yes' || outcome.value === 'no' ? outcome.value : 'unknown',
        probability: outcome.probability,
        degraded: false,
        reason: null,
        /**
         * ⚠ **正常出口也必须带这个事实**（f3 收尾 ⑥，实测缺陷：上一版此处**没有**它，
         *   而注释声称"两条出口都给" ⇒ **文档强于代码**）。
         * 为什么正常出口也会落痕失败：`judgeGuarded` 的落痕**写失败不抛**，
         *   而是把失败记进 `outcome.traceError` 并**照旧返回**（`framework.ts:361-368`）
         *   ⇒ 调用方拿到的是"正常返回"，`若不带本字段就**无法分辨**「写了」与「没写成」，
         *   于是「声明 == 行」这条不变量在正常出口上**无字段可依**（实测：`DROP jev_log` 时
         *   声明 3 / 行 0，`failureKind === null`、`reason` 也无迹可查）。
         */
        traceWritten: outcome.traceError === null || outcome.traceError === undefined,
      } as JevJudgeResult & { traceWritten: boolean }
    }
    // 降级：**仍要调 next()**（尊重下游），但把降级事实带回去（不静默）。
    //
    // ⚠⚠ **必须先调 next() 再返回**，且「本层已落痕」这件事必须**带进返回值**
    //   （本批修，2026-09-26 第三次复审实测的反向路径）：
    //   本监听器在降级分支**已经**由 `judgeGuarded` 落了 `jev_log` 行（`framework.ts:351` 的
    //   `makeJevOutcome` 是唯一落痕口，"传了 db 就一定落一行"）。若此时**下游监听器抛错**：
    //     · 调用方（如 Recall Gate）收到的是**异常**，它的 `judgeIds` 里**不会**有这条 ⇒ **声明 0**；
    //     · 而库里**真有**那一行 ⇒ **实落 1** ⇒ 「**声明少于行**」。
    //   上游（Recall Gate）在本文件之外，**没有**别的办法知道"本层到底落没落痕" ⇒ 必须由本层告知。
    //   ⇒ 新增返回字段 `traceWritten`（**给调用方看的事实**，不是给下游看的）：
    //     `true` = 本次调用**已经**在 `jev_log` 留下了一行（调用方须把它算进"本批已落痕"）。
    //   ⚠ **两条出口都给**（f3 收尾 ⑥ 起为真；此前注释这么写、代码没做 —— 文档强于代码）：
    //     正常出口（上面的 early return）与降级出口都带 `traceWritten`，
    //     值一律取自 `outcome.traceError`（**同一判据**：非空即落痕失败）。
    //     ⚠ 唯一`traceWritten:false` 的情形是**落痕本身失败**（`traceError` 非空）——
    //     那时调用方**不该**把它算进声明（行不在）。
    //   ⚠ 用可选字段（`JevJudgeResult & { traceWritten?: boolean }`）而不是改契约：
    //     事件契约（`packages/core/src/domain.ts` 的 `JevJudgeResult`）**本批不改**。
    let downstream: DownstreamReply | null = null
    let downstreamThrew: string | null = null
    try {
      downstream = (await next()) as DownstreamReply
    } catch (error) {
      // ⚠ 下游抛错**不吞**（仍然抛出去：那是下游的失败，本层无权替它决定），
      //   但本层必须让"我已经落痕了"这件事**可被带回**——
      //   故把事实挂到错误对象上（`Symbol.for` 键，避免与下游自己的字段撞名），
      //   再原样抛出。调用方读不到该字段时退化为"声明少于行"，但它**可读到**。
      downstreamThrew = error instanceof Error ? error.message : String(error)
      const written = outcome.traceError === null || outcome.traceError === undefined
      if (error && typeof error === 'object') {
        try {
          ;(error as Record<symbol, unknown>)[JEVD_TRACE_WRITTEN] = written
        } catch {
          /* 冻结对象等：忽略，调用方退化为"声明少于行"（有 §双向判据 兜底） */
        }
      }
      throw error
    }
    // ⚠ 返回值**仍须是完整 `JevJudgeResult`**（契约形状不得因本批而变宽）⇒ 逐字段显式给，
    //   不从 `Partial` 的 downstream 直接展开（那会让 `source` 等字段可能是 undefined）。
    return {
      requestId: req.requestId,
      source: typeof downstream?.source === 'string' ? downstream.source : name,
      value: downstream?.value === 'yes' || downstream?.value === 'no' ? downstream.value : 'unknown',
      probability: typeof downstream?.probability === 'number' ? downstream.probability : null,
      degraded: true,
      reason: outcome.reason ?? downstream?.reason ?? (downstreamThrew ? `downstream-threw(${downstreamThrew})` : 'jev-degraded'),
      // ⚠ **落痕事实**（见上方长注）：本层在降级分支已由 judgeGuarded 落痕。
      //   它是**契约外的附加字段**（调用方按需读，不读则与 HEAD 同形）。
      traceWritten: outcome.traceError === null || outcome.traceError === undefined,
    } as JevJudgeResult & { traceWritten: boolean }
  })

  // ⚠ 此处**没有** `void config`：B1.3 起六项配置全部被上面的 `JevGuard` 与判定链路消费，
  //   配置项关掉/打开会产生可观测差异（见 tests/framework.test.mjs 的 F8 判据）。
}

export type { ManaCoreService }
