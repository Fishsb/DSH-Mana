/**
 * JEV 模型无关**功能框架**（B1.3）：缓存 / 熔断 / 冷却半开 / 全局并发上限 / 每 session 预算。
 *
 * ── 为什么单独一个模块（而不是塞进 ollama.ts）───────────────────────────────
 * 这五件都是**纯状态机**：不碰网络、不碰 cordis、不碰 sqlite。放独立模块后，
 * 判据可以用**注入的假时钟**逐条断言状态转移（A 档，无需任何桩），
 * 而「真模型好不好」与「框架护栏在不在」就不再互相遮蔽。
 *
 * ── 落痕归属（G8 / A1-14）────────────────────────────────────────────────────
 * 本模块**不写库**。所有「不判也要留痕」的路径由 `judgeWithGuard()` 经
 * `makeJevOutcome()`（本模块唯一出口）落一行 `jev_log` ⇒
 * 「缓存命中」「熔断拒绝」「超预算」**都**有可数的行，不存在沉默路径。
 *
 * ── 判据口径（与 docs/mana-v5-plan.md §6.4 逐字对齐）─────────────────────────
 * 缓存：同 `state_hash` + 同 question，TTL 300s；熔断：连续失败 ≥5 打开；冷却 60s 后半开；
 * 并发：全局 ≤4；预算：每 session 调用上限。
 *
 * ⚠ 本模块**不做**模型适配：不换模型、不调提示词、不追概率质量。判定值一律来自
 *   `ollama.ts` 的单 token 原语（或它的缓存副本），本模块只决定「要不要去判」。
 */
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  JEV_DEFAULT_MODEL,
  OLLAMA_CHANNEL,
  OLLAMA_DEFAULT_ENDPOINT,
  judgeWithOllama,
  stateHash,
  writeJevLog,
  type JevJudgeOutcome,
  type JudgeOptions,
} from './ollama.ts'

/** 全局并发上限的缺省（方案硬约束 G14：实测 50 并发 5785ms ⇒ 并发是硬约束）。 */
export const JEV_DEFAULT_MAX_CONCURRENCY = 4

/** 熔断前允许的连续失败次数（方案 §6.4）。 */
export const JEV_DEFAULT_BREAKER_FAILURES = 5

/** 熔断冷却秒数（方案 §6.4）。 */
export const JEV_DEFAULT_COOLDOWN_SECONDS = 60

/** 判定缓存 TTL 秒数（方案 §6.4）。 */
export const JEV_DEFAULT_CACHE_TTL_SECONDS = 300

/** 每 session 判定次数上限缺省（方案 §6.4「每次 session 设置 JEV 调用预算上限」）。 */
export const JEV_DEFAULT_SESSION_BUDGET = 200

/** 未带 `sessionId` 的调用归到这个预算桶（**显式**，不留 undefined 表状态）。 */
export const JEV_UNSCOPED_SESSION = '(unscoped)'

/** 护栏配置面。与 `index.ts` 的 `Config` 同名同义 —— 配置项在这里被**真消费**。 */
export interface JevGuardConfig {
  /** 判定缓存 TTL（秒）。 */
  cacheTtlSeconds: number
  /** 连续失败达到该值 ⇒ 熔断打开。 */
  circuitBreakerFailures: number
  /** 打开后冷却（秒）；到点后允许一次试探（half-open）。 */
  circuitBreakerCooldownSeconds: number
  /** 全局同时在飞判定上限。 */
  maxConcurrency: number
  /** 每 session 判定次数上限（含缓存命中与拒绝）。 */
  sessionBudget: number
}

/** 护栏态（**可枚举字段**，供判据断言；不是日志文案）。 */
export type JevCircuitState = 'closed' | 'open' | 'half-open'

/** 护栏拒绝/标记原因（`jev-` 前缀，与 `ollama-*` 的网络故障原因可分辨）。 */
export const JEV_GUARD_REASONS = {
  circuitOpen: 'jev-circuit-open',
  circuitProbeInFlight: 'jev-circuit-probe-in-flight',
  sessionBudgetExceeded: 'jev-session-budget-exceeded',
  concurrencyTimeout: 'jev-concurrency-timeout',
} as const

/** 判定护栏快照（判据直接断言这些字段）。 */
export interface JevGuardSnapshot {
  /** 生效中的护栏配置（**读得到的配置才是被消费的配置** —— 假旋钮的第一道反证）。 */
  config: JevGuardConfig
  circuitState: JevCircuitState
  /** 连续失败计数（成功即清零）。 */
  failures: number
  /** 当前在飞判定数。 */
  inFlight: number
  /** 历史同时在飞峰值（并发判据的可数断言对象）。 */
  peakInFlight: number
  /** 半开态在飞试探数（正常情况下最多 1）。 */
  probeInFlight: number
  /** 当前排队等槽位数。 */
  waiting: number
  /** 当前单次等待槽位超时（毫秒；`<= 0` 表示永久等待）。 */
  waitTimeoutMs: number
}

/** 缓存条目。 */
interface CacheEntry {
  value: 'yes' | 'no'
  probability: number
  stateHash: string
  storedMs: number
  atIso: string
}

/** 缓存键：`state_hash`（A 档确定性）**再加** question —— 方案 §6.4 明写「同 state hash + question」。 */
export function cacheKey(stateHashValue: string, question: string): string {
  return `${stateHashValue}\u0000${question}`
}

/**
 * 判定护栏（五件合一的纯状态机）。
 *
 * 生命周期：`preCheck()` → （并发槽 `begin()`）→ `judge`（或缓存命中）→ `record()`。
 * 任一环节都不抛「静默异常」：拒绝路径返回**可枚举 reason**，由调用方落痕。
 */
export class JevGuard {
  readonly config: JevGuardConfig
  /** 注入时钟（判据用假时钟推进 TTL / 冷却；缺省系统时钟）。 */
  readonly now: () => Date

  #cache = new Map<string, CacheEntry>()
  #failures = 0
  #openedAtMs: number | null = null
  #probeInFlight = 0
  #inFlight = 0
  #peakInFlight = 0
  #waiting = 0
  #waitTimeoutMs = 30_000
  #calls = new Map<string, number>()
  #waiters: ((granted: boolean) => void)[] = []
  #waitTimers = new Map<(granted: boolean) => void, ReturnType<typeof setTimeout>>()

  constructor(config: Partial<JevGuardConfig> = {}, now: () => Date = () => new Date()) {
    this.config = {
      cacheTtlSeconds: config.cacheTtlSeconds ?? JEV_DEFAULT_CACHE_TTL_SECONDS,
      circuitBreakerFailures: config.circuitBreakerFailures ?? JEV_DEFAULT_BREAKER_FAILURES,
      circuitBreakerCooldownSeconds: config.circuitBreakerCooldownSeconds ?? JEV_DEFAULT_COOLDOWN_SECONDS,
      maxConcurrency: config.maxConcurrency ?? JEV_DEFAULT_MAX_CONCURRENCY,
      sessionBudget: config.sessionBudget ?? JEV_DEFAULT_SESSION_BUDGET,
    }
    this.now = now
  }

  /**
   * 设置等待并发槽位的超时（毫秒）。
   * **`<= 0` 或 `Infinity` ⇒ 永久等待**（口径写死在此，避免"0 到底是立刻超时还是不等待"歧义）。
   */
  setWaitTimeoutMs(ms: number): void {
    this.#waitTimeoutMs = ms
  }

  snapshot(): JevGuardSnapshot {
    return {
      config: { ...this.config },
      circuitState: this.circuitState(),
      failures: this.#failures,
      inFlight: this.#inFlight,
      peakInFlight: this.#peakInFlight,
      probeInFlight: this.#probeInFlight,
      waiting: this.#waiting,
      waitTimeoutMs: this.#waitTimeoutMs,
    }
  }

  /**
   * 熔断态（由 `failures` + 注入时钟推出，**不是**另一份可变状态 ⇒ 不会与计数漂移）。
   * 冷却未到 ⇒ `open`；冷却已到 ⇒ `half-open`（允许一次试探）。
   */
  circuitState(): JevCircuitState {
    if (this.#failures < this.config.circuitBreakerFailures) return 'closed'
    if (this.#openedAtMs === null) return 'open'
    const elapsedMs = this.now().getTime() - this.#openedAtMs
    return elapsedMs >= this.config.circuitBreakerCooldownSeconds * 1000 ? 'half-open' : 'open'
  }

  // ── ① 缓存 ────────────────────────────────────────────────────────────────

  /** 查缓存：`nowMs` 缺省取注入时钟。TTL 内命中 ⇒ 返回判定值；否则 null（且顺带清掉过期项）。 */
  cacheLookup(key: string, nowMs = this.now().getTime()): CacheEntry | null {
    const hit = this.#cache.get(key)
    if (!hit) return null
    if (nowMs - hit.storedMs >= this.config.cacheTtlSeconds * 1000) {
      this.#cache.delete(key) // 过期即清：`cacheTtlSeconds=0` 时缓存结构性失效
      return null
    }
    return hit
  }

  /** 记一条缓存（只允许正常判定结果）。 */
  cacheStore(key: string, entry: CacheEntry): void {
    this.#cache.set(key, entry)
  }

  cacheSize(): number {
    return this.#cache.size
  }

  // ── ④ 并发 ────────────────────────────────────────────────────────────────

  /**
   * 占一个并发槽位。返回**释放函数**（幂等）。
   * 槽位满时排队；排队超时 ⇒ 抛 `JEV_GUARD_REASONS.concurrencyTimeout`（由调用方转显式降级+留痕）。
   */
  async begin(): Promise<() => void> {
    if (this.#inFlight < this.config.maxConcurrency) {
      this.#acquire()
    } else {
      const granted = await this.#enqueue()
      if (!granted) throw new Error(JEV_GUARD_REASONS.concurrencyTimeout)
      // 槽位由释放方**移交**（见 #release）：inFlight 未减 ⇒ 不存在过订窗口
    }
    let released = false
    return () => {
      if (released) return
      released = true
      this.#release()
    }
  }

  #acquire(): void {
    this.#inFlight += 1
    if (this.#inFlight > this.#peakInFlight) this.#peakInFlight = this.#inFlight
  }

  #enqueue(): Promise<boolean> {
    this.#waiting += 1
    return new Promise<boolean>((resolve) => {
      const waiter = (granted: boolean): void => {
        this.#waiting -= 1
        const timer = this.#waitTimers.get(waiter)
        if (timer !== undefined) {
          clearTimeout(timer)
          this.#waitTimers.delete(waiter)
        }
        resolve(granted)
      }
      this.#waiters.push(waiter)
      if (this.#waitTimeoutMs > 0 && Number.isFinite(this.#waitTimeoutMs)) {
        this.#waitTimers.set(
          waiter,
          setTimeout(() => {
            const i = this.#waiters.indexOf(waiter)
            if (i >= 0) this.#waiters.splice(i, 1)
            waiter(false)
          }, this.#waitTimeoutMs),
        )
      }
    })
  }

  /** 释放槽位：有排队者则**把槽位移交**给队首（inFlight 不变 ⇒ 峰值不会超过上限）。 */
  #release(): void {
    const next = this.#waiters.shift()
    if (next) next(true)
    else this.#inFlight -= 1
  }

  // ── ②③ 熔断 + 冷却 ───────────────────────────────────────────────────────

  /**
   * 半开态**单探针闸**：冷却到点后只放行**一个**试探。
   *
   * 为什么必须有：`half-open` 是由 `failures` + 时钟**算出**的状态，不是一次性令牌；
   * 没有这道闸时，满载下的 N 个并发调用会**一起**穿过半开态去打已经判死的模型
   * （等于熔断白开）——而这是**看代码看不出来**的形态。
   *
   * 返回 `false` 时调用方须落 `jev-circuit-probe-in-flight` 降级痕（不得静默）。
   */
  beginProbe(): boolean {
    if (this.circuitState() !== 'half-open') return true
    if (this.#probeInFlight >= 1) return false
    this.#probeInFlight += 1
    return true
  }

  /** 试探结束（**必须**在 finally 里调，否则半开闸会永久卡死）。 */
  endProbe(): void {
    this.#probeInFlight = 0
  }

  /** 记一次判定结果：降级 ⇒ 连续失败 +1（达到阈值即打开）；正常 ⇒ 清零并关闭。 */
  record(result: { degraded: boolean }): void {
    if (result.degraded) {
      this.#failures += 1
      // ⚠ 用 `>=` 而不是 `===`：半开态那次**试探失败**必须把冷却窗**重新计时**，
      //   否则 openedAt 停在旧时刻 ⇒ 状态永远算出 half-open ⇒ 熔断再也关不上（静默失效）。
      if (this.#failures >= this.config.circuitBreakerFailures) {
        this.#openedAtMs = this.now().getTime()
      }
    } else {
      this.#failures = 0
      this.#openedAtMs = null
    }
  }

  // ── ⑤ 预算 ────────────────────────────────────────────────────────────────

  /** 本次调用计入的 session 桶。 */
  sessionKey(sessionId?: string): string {
    return sessionId && sessionId.trim() ? sessionId : JEV_UNSCOPED_SESSION
  }

  /** 该 session 已消耗的判定次数（含缓存命中与拒绝）。 */
  sessionSpend(sessionId?: string): number {
    return this.#calls.get(this.sessionKey(sessionId)) ?? 0
  }

  /** 记一次消耗（**先消耗后判**：超预算那一次本身不消耗，拒绝即拒绝）。 */
  chargeSession(sessionId?: string): number {
    const key = this.sessionKey(sessionId)
    const next = (this.#calls.get(key) ?? 0) + 1
    this.#calls.set(key, next)
    return next
  }

  /** 预算是否已用尽（`used >= sessionBudget`）。 */
  budgetExhausted(sessionId?: string): boolean {
    return this.sessionSpend(sessionId) >= this.config.sessionBudget
  }

  /** 显式重置某 session 的预算；不传则清空全部（缺省 `sessionBudget:0` 的判据要用它）。 */
  resetSession(sessionId?: string): void {
    if (sessionId === undefined) this.#calls.clear()
    else this.#calls.delete(this.sessionKey(sessionId))
  }

  /**
   * 判定前的准入检查（**顺序即语义**，与判据一一对应）：熔断 → 预算。
   *
   * ⚠ `judgeWithGuard` 用的**不是**这个顺序：它先判预算、再查缓存（缓存不受熔断阻断）、
   *   最后才看熔断。此方法是给「外部先自检一次」的场景用的便捷入口，两者不要混用。
   */
  preCheck(sessionId?: string): { ok: true } | { ok: false; reason: string } {
    const state = this.circuitState()
    if (state === 'open') return { ok: false, reason: JEV_GUARD_REASONS.circuitOpen }
    if (this.budgetExhausted(sessionId)) return { ok: false, reason: JEV_GUARD_REASONS.sessionBudgetExceeded }
    return { ok: true }
  }
}

/** 落痕出口的输入（`latencyMs`/`traceError`/`atIso` 由出口补）。 */
type OutcomeSeed = Omit<JevJudgeOutcome, 'latencyMs' | 'traceError' | 'atIso'>

/**
 * **唯一落痕出口**（取代 / 复用于 `judgeWithOllama` 的 `finish()`）。
 *
 * 为什么框架侧也要有它：缓存命中、熔断拒绝、超预算三条路径**都不经过**
 * `judgeWithOllama`，若不用同一个出口，它们就会成为「沉默地不判且不留痕」——
 * 正是 A1-14 要防的形态。
 */
export function makeJevOutcome(
  seed: OutcomeSeed,
  opts: { db?: DatabaseSync; latencyMs?: number; atIso: string },
): JevJudgeOutcome {
  const full: JevJudgeOutcome = {
    ...seed,
    latencyMs: opts.latencyMs ?? 0,
    traceError: null,
    atIso: opts.atIso,
  }
  if (opts.db) {
    try {
      writeJevLog(opts.db, full)
    } catch (error) {
      // 落痕失败不得静默（G8）：落成显式字段
      full.traceError = error instanceof Error ? error.message : String(error)
    }
  }
  return full
}

/** 带护栏的判定结果：原判定字段 + 护栏取证字段。 */
export interface GuardedJudgeOutcome extends JevJudgeOutcome {
  /** 本次是否**由缓存**给出（不经过模型）。 */
  fromCache: boolean
  /** 本次消耗掉的那个 session 的累计调用数（含本次）。 */
  sessionSpend: number
  /** 本次判定后（或拒绝时）的熔断态。 */
  circuitState: JevCircuitState
}

/** 带护栏判定的入参：`JudgeOptions` 全量 + 护栏配置。 */
export interface GuardedJudgeOptions extends JudgeOptions {
  /** 护栏实例（由装配方持有；测试可注入假时钟与自定义配置）。 */
  guard: JevGuard
  /**
   * **判定通道注入缝**（B1.4 新增，可选）。
   *
   * 护栏本身与通道无关，但它必须能驱动**任意**通道 —— 否则「缓存/熔断/预算」这五件
   * 就只对 Ollama 生效，真 JEV 通道会绕过全部护栏（一个**看代码看不出来**的形态）。
   *
   * 缺省 `judgeWithOllama` ⇒ 既有 23 条框架判据与调用方**一行不改、红绿不变**。
   * 传它时**必须**是同一签名（`(options) => Promise<JevJudgeOutcome>`），
   * 且护栏只读 `{value, probability, degraded, reason, stateHash, ...}` 这些共有字段。
   */
  judgeFn?: (options: JudgeOptions) => Promise<JevJudgeOutcome>
}

/** 从 `GuardedJudgeOptions` 里剥出真正交给判定函数的可选参数（`Extra` 不被 `JudgeOptions` 声明）。 */
interface ChannelExtras {
  channel?: string
}

/** 从 `JudgeOptions` 里剥出真正交给判定通道的部分（护栏字段不外泄）。 */
function withDefaults(options: GuardedJudgeOptions): JudgeOptions & ChannelExtras {
  const { guard: _guard, judgeFn: _judgeFn, ...rest } = options
  return {
    ...rest,
    endpoint: rest.endpoint ?? OLLAMA_DEFAULT_ENDPOINT,
    model: rest.model ?? JEV_DEFAULT_MODEL,
  }
}

/**
 * 判定一次（**框架全程在环**）：预算 → 熔断 → 缓存 → 并发槽 → 模型 → 记录。
 *
 * 五条非模型路径（缓存命中 / 熔断拒绝 / 超预算 / 并发超时 / 模型降级）**都**会
 * 经 `makeJevOutcome` 落痕 ⇒ 行数恒可数，不存在「什么都没发生」的静默分支。
 */
export async function judgeWithGuard(options: GuardedJudgeOptions): Promise<GuardedJudgeOutcome> {
  const { guard, db, sessionId } = options
  const nowFn = options.now ?? (() => new Date())
  const startedMs = nowFn().getTime()
  const atIso = new Date(startedMs).toISOString()
  const finish = (seed: OutcomeSeed, fromCache: boolean): GuardedJudgeOutcome => ({
    ...makeJevOutcome(seed, { db, latencyMs: nowFn().getTime() - startedMs, atIso }),
    fromCache,
    sessionSpend: guard.sessionSpend(sessionId),
    circuitState: guard.circuitState(),
  })
  const refused = (reason: string): GuardedJudgeOutcome =>
    finish(
      {
        requestId: (options.idFactory ?? randomUUID)(),
        requestType: options.requestType ?? 'jev',
        source: options.source ?? 'mana-jev',
        stateHash: stateHash(options.state),
        value: 'unknown',
        probability: null,
        degraded: true,
        reason,
        candidates: [],
        normalization: null,
        model: options.model ?? JEV_DEFAULT_MODEL,
        endpoint: options.endpoint ?? OLLAMA_DEFAULT_ENDPOINT,
        sessionId,
        turnId: options.turnId,
        channel: options.channel ?? OLLAMA_CHANNEL,
      },
      false,
    )

  // ── 准入顺序（这个顺序本身就是语义，判据逐条钉住）──────────────────────────
  //   ① 预算：缓存命中**也是一次调用** ⇒ 先判预算；
  //   ② 缓存：命中**不碰模型**，故**不受熔断阻断** —— 熔断开时仍可服务上一次的好答案，
  //      代价是 0 次 fetch（判据用 fetch 计数证明"断路器没被绕过"）；
  //   ③ 熔断：只拦"要不要去问模型"。
  // 拒绝路径**同样**落一行 `jev_log`（A1-14：沉默地不判可以，但必须留痕）。
  if (guard.budgetExhausted(sessionId)) return refused(JEV_GUARD_REASONS.sessionBudgetExceeded)

  const key = cacheKey(stateHash(options.state), options.question)
  const hit = guard.cacheLookup(key, startedMs)
  if (hit) {
    guard.chargeSession(sessionId)
    return finish(
      {
        requestId: (options.idFactory ?? randomUUID)(),
        requestType: options.requestType ?? 'jev',
        source: options.source ?? 'mana-jev',
        stateHash: hit.stateHash,
        value: hit.value,
        probability: hit.probability,
        cached: true,
        degraded: false,
        reason: null,
        candidates: [],
        normalization: null,
        model: options.model ?? JEV_DEFAULT_MODEL,
        endpoint: options.endpoint ?? OLLAMA_DEFAULT_ENDPOINT,
        sessionId,
        turnId: options.turnId,
        channel: options.channel ?? OLLAMA_CHANNEL,
      },
      true,
    )
  }

  if (guard.circuitState() === 'open') return refused(JEV_GUARD_REASONS.circuitOpen)

  // ── 半开单探针闸（冷却到点后只放行一个试探）──────────────────────────────
  if (!guard.beginProbe()) return refused(JEV_GUARD_REASONS.circuitProbeInFlight)

  // ── 并发槽 ────────────────────────────────────────────────────────────────
  let release: () => void
  try {
    release = await guard.begin()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    guard.endProbe()
    // 并发排队超时：**不**记失败（不是模型面的失败），但同样留痕
    return refused(reason)
  }

  try {
    guard.chargeSession(sessionId)
    const judgeFn = options.judgeFn ?? judgeWithOllama
    const raw = await judgeFn({ ...withDefaults(options), db: undefined })
    guard.record({ degraded: raw.degraded })

    const seed: OutcomeSeed = {
      requestId: raw.requestId,
      requestType: raw.requestType,
      source: raw.source,
      stateHash: raw.stateHash,
      value: raw.value,
      probability: raw.probability,
      degraded: raw.degraded,
      reason: raw.reason,
      candidates: raw.candidates,
      normalization: raw.normalization,
      model: raw.model,
      endpoint: raw.endpoint,
      sessionId: raw.sessionId,
      turnId: raw.turnId,
      // ── 通道面取证字段**透传**（B1.4）：不回填的话，真 JEV 通道经护栏后
      //    `channel`/`answers`/`costUsd` 会被静默剥掉 —— 那正是"看起来正常、实际丢数据"的形态。
      channel: raw.channel,
      answers: raw.answers,
      unusableAnswers: raw.unusableAnswers,
      primaryQuestion: raw.primaryQuestion,
      servedModel: raw.servedModel,
      costUsd: raw.costUsd,
    }
    const out = finish(seed, false)
    // 只有「正常判定」与「模型答了但无可用 token」进缓存：网络故障**不缓存**
    if (!raw.degraded && raw.probability !== null) {
      guard.cacheStore(key, {
        value: raw.value === 'no' ? 'no' : 'yes',
        probability: raw.probability,
        stateHash: raw.stateHash,
        storedMs: startedMs,
        atIso,
      })
    }
    // 判定不可用（unknown / 降级）**一律不进缓存**：宁可下次再问模型，也不把 unknown 当结论；
    // 网络类失败更不得缓存 —— 那会把一次瞬时故障放大成 TTL 内的持续故障。
    return out
  } finally {
    guard.endProbe()
    release()
  }
}

/** 串行判定一批（**同一时刻只让一个在飞**）——方案 S2 席口径「串行」。 */
export async function judgeSeries(
  items: readonly Omit<GuardedJudgeOptions, 'guard'>[],
  guard: JevGuard,
): Promise<GuardedJudgeOutcome[]> {
  const out: GuardedJudgeOutcome[] = []
  for (const item of items) out.push(await judgeWithGuard({ ...item, guard }))
  return out
}
