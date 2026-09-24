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
import Schema from '@deepseek-ai/schemastery'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'
import {
  judgeWithOllama,
  JEV_DEFAULT_MODEL,
  OLLAMA_DEFAULT_ENDPOINT,
  type JudgeOptions,
  type JevJudgeOutcome,
} from './ollama.ts'
import {
  judgeWithSystemone,
  SYSTEMONE_API_KEY_ENV,
  SYSTEMONE_DEFAULT_ENDPOINT,
  SYSTEMONE_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_PATH,
  SYSTEMONE_DEFAULT_PRIMARY,
  type SystemoneJudgeOptions,
} from './systemone.ts'
import {
  JEV_DEFAULT_BREAKER_FAILURES,
  JEV_DEFAULT_CACHE_TTL_SECONDS,
  JEV_DEFAULT_COOLDOWN_SECONDS,
  JEV_DEFAULT_MAX_CONCURRENCY,
  JEV_DEFAULT_SESSION_BUDGET,
  JevGuard,
  judgeWithGuard,
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
  /** 全局并发上限（实测 50 并发单次 5785ms ⇒ 并发是硬约束，G14）。**B1.3 起真消费**。 */
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
   * 判定**通道**选择器（B1.4 新增）。
   *
   * · `'ollama'`（缺省）= 本机单 token logprob 原语（**保留可切换，绝不删**）；
   * · `'systemone'`    = 真 JEV 本体（`POST {systemoneEndpoint}/api/v1/systemone`）。
   *
   * ⚠ 缺省**不变**：既有装配与既有判据走的是 `'ollama'`，换通道是**显式**动作。
   *   反向也成立 —— `'systemone'` 不会静默降级回 Ollama（无凭据就显式降级留痕）。
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
  maxConcurrency: Schema.number().default(JEV_DEFAULT_MAX_CONCURRENCY),
  sessionBudget: Schema.number().default(JEV_DEFAULT_SESSION_BUDGET),
  concurrencyWaitTimeoutMs: Schema.number().default(30_000),
  // 选择器：非法值**抛错**而不是静默回落（静默回落 = "配置点了没反应"的经典形态）
  channel: Schema.union([Schema.const('ollama'), Schema.const('systemone')]).default('ollama'),
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

/** JEV 服务面。 */
export interface ManaJevService {
  readonly plugin: string
  /**
   * 机制自证读数（**不是**运行态判据）。
   *
   * `channel` 是**生效中**的通道（读得到的配置才是被消费的配置）；`systemoneApiKeyEnv`
   * 只回**变量名**，**永不回 key 本身**。
   */
  status(): {
    plugin: string
    wired: boolean
    coreStorePath: string
    channel: 'ollama' | 'systemone'
    systemoneApiKeyEnv: string
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
  /** 护栏态快照（可枚举字段，供探针与判据断言）。 */
  guardState(): JevGuardSnapshot
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-jev': ManaJevService
  }
}

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

  const service: ManaJevService = {
    plugin: name,
    status: () => ({
      plugin: name,
      wired: true,
      coreStorePath: core.storePath,
      channel: config.channel,
      // 只回**变量名**（key 本身永不经过服务面，更不落盘）
      systemoneApiKeyEnv: config.systemoneApiKeyEnv,
    }),
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
   */
  ctx.on('mana/jev/judge', async (req, next) => {
    const outcome = await service.judgeGuarded({
      state: req.state,
      question: req.question,
      idFactory: () => req.requestId,
    })
    if (!outcome.degraded && typeof outcome.probability === 'number') {
      return {
        requestId: req.requestId,
        source: name,
        value: outcome.value === 'yes' || outcome.value === 'no' ? outcome.value : 'unknown',
        probability: outcome.probability,
        degraded: false,
        reason: null,
      }
    }
    // 降级：**仍要调 next()**（尊重下游），但把降级事实带回去（不静默）。
    const downstream = await next()
    return {
      ...downstream,
      requestId: req.requestId,
      degraded: true,
      reason: outcome.reason ?? downstream.reason ?? 'jev-degraded',
      // 降级时概率为 null；若下游给了可用概率则保留（下游才是"真判到了"的那一方）。
      probability: typeof downstream.probability === 'number' ? downstream.probability : null,
    }
  })

  // ⚠ 此处**没有** `void config`：B1.3 起六项配置全部被上面的 `JevGuard` 与判定链路消费，
  //   配置项关掉/打开会产生可观测差异（见 tests/framework.test.mjs 的 F8 判据）。
}

export type { ManaCoreService }
