/**
 * **Write Gate（编码门 · B3.2 的写入侧）** —— 「这条观察值不值得留」的判定与落库。
 *
 * 真源：docs/mana-rollout-plan.md:103（三道门控语义表）——
 *   **Write Gate：bigram 预过滤 → 一次 fan-out（worth_keeping noul + supersedes choice + none），
 *   失败 fail-open 仍写入、标 gate=unavailable|budget**。
 * 与 Recall Gate（读侧，recall-gate.ts）**同构但不同面**：本文件是**生产者**，它真的落库。
 *
 * ── 为什么本文件存在（W1-3 的现象）────────────────────────────────────────────
 * core.writeMemoryItem 的**生产调用方**在 packages/*​/src 下曾只有 3 处，且**实测全是注释**
 * （metacognition/src/profile-pipeline.ts:14、user-model/src/index.ts:28/106 都在说「本模块不调用它」）。
 * 于是 memory_items 这张表在生产侧**没有任何写者**：「记忆写入路径」整条是断的，
 * 而「表是空的」与「Write Gate 把一切都判掉了」**同形**（本仓头号形态：让失败不可观测）。
 * ⇒ 本文件把 perception(输入采集) → Write Gate(判值不值得留) → long-term(编码落库) 接上。
 *
 * ── 设计纪律（逐条对应本批的硬约束）────────────────────────────────────────────
 * **① 判定必须落既有审计面（可查行）**：判定**不**由本文件落痕，而是走**既有** mana/jev/judge
 *   waterfall ⇒ 落痕由 jev 插件写入 jev_log（jev-log-gate.ts:112 的 v.id = o.requestId）。
 *   本文件**不新增事件类型**（8 事件契约不动），也**不**自建第二张审计表
 *   —— 自建表会让「判定发生过没有」有两个归属地，那正是本仓禁止的「同一事实两个真源」。
 *
 * **② 降级必须显式标记，禁止 catch{return null}**：prob === null ⇒ degraded=true +
 *   reason + failureKind，且按 rollout:103 的 **fail-open** 口径**仍然写入**
 *   （状态 degraded_written ——「降级但写了」与「判了通过」**必须可分辨**）。
 *
 * **③ 复用既有激活方程，不引入 FSRS**：写入只带 created_at / access_timestamps，
 *   衰减由既有 decay(t,h=14) / baseLevel（params.ts 的 D=0.5 / HALF_LIFE_DAYS=14）负责。
 *   本文件**不实现**任何调度器（C16 裁定：FSRS / ITACL / MCL / §8 神经科学本体**均不移植**）。
 *
 * **④ 不移植 v10 的 OpenRouter 通道与 options 内 logprobs 写法**：判定只经契约事件面
 *   mana/jev/judge，通道选择归 jev 插件（本机口径 = 本机 Ollama logprob，见 rollout §8 C8）。
 *
 * ── ⚠ 已实测的既有缺陷（本席 2026-09-26 在真库上复现；**属 core 写面，本包不自改**）────────
 * core/src/index.ts:545-549 的 writeMemoryItem 是
 * INSERT OR REPLACE INTO memory_items (id,type,content,summary,created_at)。
 * **SQLite 的 INSERT OR REPLACE 是 delete+insert，未列出的列被重置为 DEFAULT/NULL**，实测：
 *
 * | 列 | 写前 | 写后 |
 * |---|---|---|
 * | retired | 1（已软删除） | **0（静默复活）** |
 * | reconsolidation_window_until | '2030-01-01T00:00:00.000Z' | null |
 * | update_history | '[{"v":1}]' | null |
 * | access_count | 7 | 0 |
 * | base_level_activation | -1.5 | 0 |
 * | vector | BLOB<3> | null |
 * | created_at | 原值 | **被覆盖为新时刻** |
 *
 * ⇒ 实害两条：**(a)** 对一条**已退休**的记忆再写一次 ⇒ 它**复活**且无任何报错
 *（违反「物理删除永不发生 ⇒ 软删除必须可逆」的边界：可逆要由 restore **显式**做，
 * 不能由一次无关的写入顺带做掉）；**(b)** 被清的还有 vector（向量席的回填列，
 * 见 core/src/index.ts:324「vector 列由向量席另行回填」）⇒ **一次重写会把向量检索的
 * 数据源打空**，而读侧只会看到「没命中」，与「库本来就空」同形。
 *
 * **本包的处置（不改 core —— core 不是本席写面）**：写入前**显式查 retired**，
 * 命中即**拒绝覆盖**并返回可分辨状态 skipped_retired（reason 点名真因）。
 * 这是**只读闸**：它挡住一次会静默改变既有事实的写，**不**声称修好了 core 的写入口。
 * 修法（UPDATE ... ON CONFLICT DO UPDATE SET，或显式列出列白名单）**登记在册**，
 * 交 core 写面的席位处理 —— 见本批交付的 [越界转派]。
 * ⚠ **残留（如实记，不许读成已修）**：本闸只挡 retired=1。对一条**活**行再写一次，
 * vector / access_count / update_history / reconsolidation_window_until **仍会被清**
 * —— 本包能做的只有把它**记成可分辨状态** overwritten（「这次写覆盖了一条既有行」），
 * 使「新建」与「覆盖」不再同形，而不是假装没发生。
 *
 * ── bigram 预过滤：它是**优化**，且是**唯一会静默产 0 行**的那一步 ──────────────
 * rollout:103 的第一段是 bigram 预过滤 ⇒ 本实现**保留**该段，但把它的失效模式显式化：
 * 命中与否由**纯函数**返回（prefilterWorthKeeping），并在 outcome 上带 prefilterOverlap
 * ⇒「被预过滤挡下」与「判了不值得」**可分辨**（前者不进判定、不落 jev_log）。
 * ⚠ 词表**不另立**：bank 由**问法本身**（WRITE_GATE_QUESTION）的 bigram 集派生
 * ⇒ 问法改了词表跟着变，不会出现「两份词表各说各话」的漂移。
 * ⚠ 允许 prefilterEnabled:false 关掉它：那会让**每一条**观察都进判定（多花模型往返），
 * 但**不会**改变「判了之后写不写」的结果 —— 该开关的可观测差异 = skipped_prefilter 归零，
 * 由判据断言（本仓纪律：声明了的开关必须产生可观测差异，否则即「死开关」）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { DatabaseSync } from 'node:sqlite'
import type { JevJudgeRequest, JevJudgeResult, ManaObservation, ManaCoreService } from 'dsh-mana-core'
import { MIN_QUERY_CHARS } from 'dsh-mana-core'
import { sha256Hex, selectLiveMemoryById } from './retirement.ts'
import { encodeIdPart, traceWrittenOf } from './recall-gate.ts'

/** source 标识（进 jev_log.source，使本门的判定行与别的门可分辨）。 */
export const WRITE_GATE_SOURCE = 'mana-long-term' as const

/**
 * 问法（JevJudgeRequest.question）—— **同时是预过滤词表的真源**（见文件头）。
 * 判定类型 judgeType 用 worth_keeping（rollout:103 的 noul 口径）。
 */
export const WRITE_GATE_QUESTION = '这条观察值得长期记住吗' as const

/** 判定类型标识（rollout:103 写死的 noul 名）。 */
export const WRITE_GATE_JUDGE_TYPE = 'worth_keeping' as const

/** 缺省放行阈值（与 attention/src/index.ts:244 的 jevThreshold=0.7 同口径）。 */
export const WRITE_GATE_DEFAULT_THRESHOLD = 0.7

/**
 * 本门降级留痕的 `mana_trace.event_type`（唯一出处）。
 *
 * ⚠ **不得写成裸名五类之一**（本批一度写成 `'injection'` —— 错的，已改）：
 *   `chain-e2e.test.mjs` 对五类断言的是「**各 ≥1**」（下界），若本包的降级行冒充
 *   `injection`，它就会**替真链凑数** ⇒ "五类齐全"可能是被本包的行凑出来的，
 *   而那正是 A1-1 要证明的东西被**掩盖**的形态。
 *   既有先例逐条一致：`learning` 用 `mana/learning/*`、`reconsolidation` 用
 *   `mana-reconsolidation/*`、`user-model` 用 `user-model/drift`。
 *   ⇒ 本包取 `mana/long-term/*`：**不在五类内，也不得被改成五类之一**。
 */
export const WRITE_GATE_TRACE_EVENT = 'mana/long-term/write-gate-degraded' as const

/**
 * 预过滤所需的最小 bigram 重叠数。
 *
 * ⚠ 取值 2 的理由（实测）：bank 只有 8 个 bigram（问法短），取 1 会把「这条」「值得」这类
 *   通用词当命中 ⇒ 预过滤形同虚设（每次都进判定，退化成「没有预过滤」）；
 *   取 3 以上则中文长句也常为 0 命中 ⇒ 把大部分输入挡在判定之外（**静默 0 行**，本仓最忌）。
 *   2 是「两字交集」口径：既真挡下无关句，又不致把有效输入挡掉。判据用**成对样本**钉住该取值。
 */
export const PREFILTER_MIN_OVERLAP = 2

/**
 * 本门的状态枚举 —— **每一态都必须与其余各态可分辨**（A1-13/A1-14 的同族纪律）。
 *
 * | 状态 | 含义 | 落行 | 降级 |
 * |---|---|---|---|
 * | written | 新行写入（库内此前无此 id） | 是 | 否 |
 * | overwritten | 覆盖了一条**既有活行**（retired=0）⇒ REPLACE 的列清空面 | 是 | 否 |
 * | rejected | 判了：概率 < 阈值 | 否 | 否 |
 * | degraded_written | 判定降级但按 **fail-open** 仍写入 | 是 | 是 |
 * | skipped_retired | 既有行**已软删除** ⇒ **拒绝覆盖**（不复活） | 否 | 否 |
 * | skipped_prefilter | bigram 预过滤未命中 ⇒ **未进判定** | 否 | 否 |
 * | unavailable | 判定/写面不可用（只判不写，或写失败） | 否 | 是 |
 * | not_attempted | 输入本身不构成一次可编码的观察（空串/过短） | 否 | 否 |
 *
 * ⚠「没写行」有**五种**原因（rejected / skipped_retired / skipped_prefilter / not_attempted /
 *   write-failed）—— 只用「库里没有这行」是**不可分辨**的，故本枚举逐态单列。
 */
export const WRITE_GATE_STATES = [
  'written',
  'overwritten',
  'rejected',
  'degraded_written',
  'skipped_retired',
  'skipped_prefilter',
  'unavailable',
  'not_attempted',
] as const
export type WriteGateState = (typeof WRITE_GATE_STATES)[number]

/** 失败归因（与 Recall Gate 的 RECALL_GATE_FAILURE_KINDS 同形：可枚举、可断言）。 */
export const WRITE_GATE_FAILURE_KINDS = [
  /** 判定链抛错（下游监听器炸 / 落痕失败）。 */
  'judge-threw',
  /** 没有活监听器 —— 判定链是空的（next() 的缺省支）。 */
  'no-judge-listener',
  /** 响应回来了但概率为 null ⇒ 降级（fail-open 写入）。 */
  'judge-degraded',
  /** 判定链给了「已落痕」事实但为 false ⇒ jev_log 那一行没写成。 */
  'trace-failed',
] as const
export type WriteGateFailureKind = (typeof WRITE_GATE_FAILURE_KINDS)[number]

// ⚠ 「本层是否已落痕」的读取原语**复用** recall-gate.ts 的同名实现（traceWrittenOf /
//   JEVD_TRACE_WRITTEN_KEY），**不在此另立第二份**：同一个 Symbol.for 串若有两处定义，
//   改一处不会改另一处 —— 那正是「同一事实两个真源」的形态。

/** 本门配置（writeGate 第四参；缺省全内置，**不导出 Config** —— 见 skeleton.test.mjs 判据⑤）。 */
export interface WriteGateConfig {
  /** 放行阈值：prob >= threshold 才写。 */
  threshold: number
  /** 可编码的最小字符数（**短于 core 的 MIN_QUERY_CHARS 时，写进去也检索不到** ⇒ 显式不写）。 */
  minChars: number
  /** 是否启用 bigram 预过滤（关掉 = 每条都进判定；可观测差异见头注）。 */
  prefilterEnabled: boolean
  /** 是否**真的落库**（false = 只判不写；判据拿它做「关掉 Write Gate ⇒ 不再产生新行」的反证）。 */
  write: boolean
}

/** 缺省配置（冻结；判据以此为准，避免第二份缺省值）。 */
export const WRITE_GATE_DEFAULTS: WriteGateConfig = Object.freeze({
  threshold: WRITE_GATE_DEFAULT_THRESHOLD,
  minChars: MIN_QUERY_CHARS,
  prefilterEnabled: true,
  write: true,
})

/** 一条观察的写入结果 —— **每个字段都有「不可知」之外的确切取值**（无 undefined 状态位）。 */
export interface WriteGateOutcome {
  readonly state: WriteGateState
  /** 判定值；降级时必须 'unknown'（不得默认成 'no'）。 */
  readonly value: 'yes' | 'no' | 'unknown'
  /** 判定概率；**降级时为 null**（不得用 0 冒充「概率为零」）。 */
  readonly probability: number | null
  readonly degraded: boolean
  readonly reason: string | null
  readonly failureKind: WriteGateFailureKind | null
  /** 是否在进入判定**之前**被挡下（预过滤 / 过短 / 已退休）。 */
  readonly skipped: boolean
  /** 预过滤的 bigram 重叠数（未启用时为 null）。 */
  readonly prefilterOverlap: number | null
  /** 落库用的记忆 id（未落库时为 null）。 */
  readonly memoryId: string | null
  /** 本次判定在 jev_log 里的键（= 判定链的 requestId）。 */
  readonly judgeId: string | null
  /** 判定链自报的落痕事实：true 已落 / false 没落成 / null 不可知。 */
  readonly traceWritten: boolean | null
  /** 本次是否**真的新增/覆盖**了一行（false 时库里无变化 ⇒ 反证判据直接读它）。 */
  readonly wroteRow: boolean
  /** 覆盖的是既有**活行**（retired=0）—— overwritten 状态的取证位。 */
  readonly overwroteLiveRow: boolean
  readonly latencyMs: number
}

/** 预过滤读数（纯函数返回，使「被挡下」可断言）。 */
export interface PrefilterResult {
  readonly hit: boolean
  readonly overlap: number
  readonly threshold: number
  readonly bankSize: number
}

/** 抽取 bigram（按 **Unicode 码点**切，不按 UTF-16 码元 —— 否则 emoji/代理对会被切成半个字符）。 */
export function bigrams(text: string): string[] {
  const cps = Array.from(String(text === null || text === undefined ? '' : text))
  const out: string[] = []
  for (let i = 0; i + 1 < cps.length; i += 1) {
    const a = cps[i]
    const b = cps[i + 1]
    // `noUncheckedIndexedAccess` 下逐元素可能 undefined；`for` 界已保证存在，此处只做窄化。
    if (a === undefined || b === undefined) continue
    out.push(a + b)
  }
  return out
}

/**
 * 预过滤词表 —— **由问法本身派生**（见文件头：不另立词表，避免两份词表漂移）。
 * 模块加载时算一次并冻结。
 */
export const PREFILTER_BANK: readonly string[] = Object.freeze([...new Set(bigrams(WRITE_GATE_QUESTION))])

/**
 * bigram 预过滤（**纯函数**）：观察文本与问法的 bigram 交集是否达到 PREFILTER_MIN_OVERLAP。
 *
 * ⚠ 它**不能**用来判「不值得」：未命中只意味着「没进判定」，不意味着「判过且不通过」
 *   —— 两者在库里都表现为「没有新行」，故调用方必须把本结果记进 outcome（见 skipped）。
 */
export function prefilterWorthKeeping(text: string, overlapThreshold: number = PREFILTER_MIN_OVERLAP): PrefilterResult {
  const bank = new Set(PREFILTER_BANK)
  const seen = new Set(bigrams(text))
  let overlap = 0
  for (const g of seen) if (bank.has(g)) overlap += 1
  return { hit: overlap >= overlapThreshold, overlap, threshold: overlapThreshold, bankSize: bank.size }
}

/**
 * 派生记忆 id（**确定性**：同一 (session,turn,request,content) 恒得同 id，便于幂等与复查）。
 *
 * ⚠ 把 content 算进 id 是**刻意的**：同一 requestId 下内容变了（重放/重试）会得到
 *   **不同的 id** ⇒ 不会静默覆盖上一条的内容。这是对 core 那记 REPLACE 的**旁路降险**，
 *   不是它的替代（同 id 重写仍会清列，由 overwritten 状态记录）。
 */
export function deriveMemoryId(obs: Pick<ManaObservation, 'sessionId' | 'turnId' | 'requestId' | 'content'>): string {
  const raw = [obs.sessionId, String(obs.turnId), obs.requestId, obs.content].join('\u0000')
  return 'mem_' + sha256Hex(raw).slice(0, 32)
}

/**
 * 判定键派生（**单射**）：requestId 与判定类型两段各自派生，分隔符只有一个。
 *
 * ⚠ 转义**复用** recall-gate.ts 的 encodeIdPart（同一个转义规则，不另立第二套）：
 *   它保证输出里不含 '#' ⇒ 本键可从字面量反解出唯一的 requestId。
 *   为什么必须单射：judgeId 同时是 **jev_log.id（PRIMARY KEY）** 的取值
 *   （jev-log-gate.ts:112 的 v.id = o.requestId）⇒ 碰撞会让落痕**静默 0 行**。
 */
export function writeJudgeIdFor(requestId: string): string {
  return encodeIdPart(requestId) + '#' + WRITE_GATE_JUDGE_TYPE
}

/** 一个判定响应的最小可读面（判定链给的是 JevJudgeResult，此处放宽以便判据喂桩）。 */
type JudgeReply = JevJudgeResult

/** 写面依赖：只取本门真正用到的两个方法，便于判据注入**会失败的写面**做负向对拍。 */
export interface WriteGateSink {
  /** 读 id 的软删除态：false = 有活行；true = 有行但已退休；null = 无此 id。 */
  isRetired(db: DatabaseSync, id: string): boolean | null
  /** 真写（生产 = core.writeMemoryItem）。 */
  write(item: { id: string; type: string; content: string; summary?: string | null; at?: string }): void
}

/**
 * 生产 sink。
 *
 * ⚠ isRetired 用**两个读数并存**才可分辨三态（这是本函数存在的全部理由）：
 *   selectLiveMemoryById 带 **AND retired=0** 过滤腿 ⇒ 它返回 null 可能是「无此行」也可能是「已退休」。
 *   再用一次**不带过滤**的原样读取 retired ⇒ 二者才可分。
 *   若只用一个读数，「无此 id」与「有但已退休」就同形了（本仓最忌的形态）。
 */
export function coreSink(core: ManaCoreService): WriteGateSink {
  return {
    isRetired(db: DatabaseSync, id: string): boolean | null {
      if (selectLiveMemoryById(db, id)) return false
      const any = db.prepare('SELECT retired FROM memory_items WHERE id = ?').get(id) as { retired?: number } | undefined
      if (any === undefined) return null
      return Number(any.retired === null || any.retired === undefined ? 0 : any.retired) === 1
    },
    write: (item) => core.writeMemoryItem(item),
  }
}

/**
 * 走一次 Write Gate（**本门的主入口**）。
 *
 * 流程（对应 rollout:103）：① 可编码性闸 → ② bigram 预过滤 → ③ retired 闸 →
 * ④ 一次 mana/jev/judge fan-out（worth_keeping）→ ⑤ 按阈值 / fail-open 决定落库。
 *
 * @param ctx 显式入参（与 recallGate 同形态：本函数不持有 ctx）。
 * @param db 库句柄（显式入参；生产由 apply 传 core.db）。
 * @param sink 写面（生产传 coreSink(core)；判据可注入会失败的写面）。
 * @param obs 一条观察（mana/observation 的载荷）。
 * @param overrides 配置覆盖（缺省 WRITE_GATE_DEFAULTS）。
 */
export async function writeGate(
  ctx: Context,
  db: DatabaseSync,
  sink: WriteGateSink,
  obs: ManaObservation,
  overrides?: Partial<WriteGateConfig>,
): Promise<WriteGateOutcome> {
  const cfg: WriteGateConfig = { ...WRITE_GATE_DEFAULTS, ...overrides }
  const t0 = Date.now()
  const base = {
    value: 'unknown' as const,
    probability: null as number | null,
    degraded: false,
    reason: null as string | null,
    failureKind: null as WriteGateFailureKind | null,
    skipped: false,
    prefilterOverlap: null as number | null,
    memoryId: null as string | null,
    judgeId: null as string | null,
    traceWritten: null as boolean | null,
    wroteRow: false,
    overwroteLiveRow: false,
  }
  const done = (state: WriteGateState, patch: Partial<WriteGateOutcome> = {}): WriteGateOutcome => ({
    ...base,
    ...patch,
    state,
    latencyMs: Date.now() - t0,
  })

  // ① 可编码性闸：过短的内容写进去也**检索不到**（core 的 trigram 长度闸）⇒ 显式不写，
  //    而不是写一行「看起来在库里、实际永远查不出来」的假数据。
  const content = String(obs === null || obs === undefined ? '' : obs.content === null || obs.content === undefined ? '' : obs.content)
  if (content.trim().length === 0 || content.length < cfg.minChars) {
    return done('not_attempted', {
      skipped: true,
      reason:
        '内容不可编码：长度 ' + content.length + ' < minChars ' + cfg.minChars +
        '（写进去也检索不到 ⇒ 不写假数据）',
    })
  }

  // ② bigram 预过滤（rollout:103 的第一段）：未命中 ⇒ **未进判定**（不落 jev_log）。
  if (cfg.prefilterEnabled) {
    const pre = prefilterWorthKeeping(content)
    if (!pre.hit) {
      return done('skipped_prefilter', {
        skipped: true,
        prefilterOverlap: pre.overlap,
        reason:
          'bigram 预过滤未命中：重叠 ' + pre.overlap + ' < ' + pre.threshold +
          '（词表 ' + pre.bankSize + ' 项，由问法派生）⇒ 未进判定',
      })
    }
  }

  const memoryId = deriveMemoryId(obs)
  const judgeId = writeJudgeIdFor(obs.requestId)

  // ③ retired 闸：既有行已软删除 ⇒ **拒绝覆盖**（否则 core 的 REPLACE 会把它静默复活）。
  const retired = sink.isRetired(db, memoryId)
  if (retired === true) {
    return done('skipped_retired', {
      memoryId,
      judgeId,
      skipped: true,
      reason:
        '既有行 retired=1（已软删除）⇒ 拒绝覆盖：core.writeMemoryItem 是 INSERT OR REPLACE，' +
        '不列 retired 列 ⇒ 重写会把 retired 重置为 DEFAULT 0（实测：静默复活）。' +
        '可逆性必须由显式 restore 完成，不得由一次无关写入顺带做掉。',
    })
  }

  // ④ 一次 fan-out（noul 口径）：走**既有** waterfall ⇒ 落痕由 jev 侧写 jev_log（本文件不落痕）。
  const judgeReq = {
    requestId: judgeId,
    judgeType: WRITE_GATE_JUDGE_TYPE,
    state: content.length > 200 ? 'observation=' + content.slice(0, 200) + '…' : 'observation=' + content,
    question: WRITE_GATE_QUESTION,
    threshold: cfg.threshold,
    source: WRITE_GATE_SOURCE,
  } as JevJudgeRequest & { sessionId?: string; turnId?: number }
  // ⚠ sessionId/turnId 必须透传：判定链的**会话预算护栏**按会话计费
  //   （framework.ts 的 guard.budgetExhausted(sessionId)）；不传会让所有会话并进
  //   undefined 一条虚构分区，护栏对本门失效且库里看不出。
  if (typeof obs.sessionId === 'string' && obs.sessionId !== '') judgeReq.sessionId = obs.sessionId
  if (typeof obs.turnId === 'number') judgeReq.turnId = obs.turnId

  let reply: JudgeReply | null = null
  let failureKind: WriteGateFailureKind | null = null
  let traceWritten: boolean | null = null
  let reason: string | null = null
  try {
    reply = (await ctx.waterfall('mana/jev/judge', judgeReq, async (): Promise<JevJudgeResult> => ({
      // 缺省 next = **没有活监听器**那一支：它自己不落库 ⇒ 显式标 no-judge-listener，
      // 使「判定链是空的」与「判了但降级」**可分辨**（同形即是静默失败）。
      requestId: judgeReq.requestId,
      source: WRITE_GATE_SOURCE,
      value: 'unknown',
      probability: null,
      degraded: true,
      reason: 'no-judge-listener',
    }))) as JudgeReply
    traceWritten = traceWrittenOf(reply)
  } catch (error) {
    // 判定链抛错：**不吞**，记归因后按 fail-open 继续（写仍要发生 ⇒ 记忆不会因判定链故障而丢失）。
    failureKind = 'judge-threw'
    traceWritten = traceWrittenOf(error)
    reason = '判定链抛错：' + (error instanceof Error ? error.message : String(error))
    reply = null
  }

  const prob = reply === null || reply.probability === undefined ? null : reply.probability
  const value: 'yes' | 'no' | 'unknown' = reply === null ? 'unknown' : reply.value
  const degraded = reply === null || reply.degraded === true || prob === null

  if (failureKind === null) {
    if (prob === null) {
      failureKind = reply !== null && reply.reason === 'no-judge-listener' ? 'no-judge-listener' : 'judge-degraded'
    } else if (traceWritten === false) {
      // 概率是真的，但 jev_log 那一行没写成 ⇒ 必须报出（否则「判过」在审计面上不可查）。
      failureKind = 'trace-failed'
    }
  }
  if (reason === null && reply !== null && reply.reason) reason = reply.reason
  if (failureKind === 'trace-failed') {
    reason = (reason === null ? '判定返回了概率' : reason) +
      '；但 jev_log 未写成（生产者自报 traceWritten=false）⇒ 本判定在审计面上不可查'
  }

  const outcomeBase = {
    value,
    probability: prob,
    degraded,
    failureKind,
    reason,
    memoryId,
    judgeId,
    traceWritten,
    overwroteLiveRow: retired === false,
  }

  // ⑤ 落库决策：prob >= threshold ⇒ 写；降级 ⇒ **fail-open 仍写**；
  //    判了且低于阈值 ⇒ **不写**（唯一「正常地不写」的形态，与降级/跳过可分辨）。
  const passByProb = prob !== null && prob >= cfg.threshold
  const shouldWrite = passByProb || degraded
  if (!shouldWrite) {
    return done('rejected', {
      ...outcomeBase,
      reason:
        (reason === null ? '' : reason + '；') +
        '判定概率 ' + prob + ' < 阈值 ' + cfg.threshold + ' ⇒ 不留（判过之后的正常否决，不是降级）',
    })
  }
  if (!cfg.write) {
    // 判据用：只判不写（「关掉 Write Gate ⇒ 不再产生新行」的反证腿走这里）。
    return done('unavailable', { ...outcomeBase, reason: 'write=false：本门只判不写（反证用）' })
  }

  try {
    sink.write({ id: memoryId, type: 'observation', content, summary: null, at: obs.at })
  } catch (error) {
    // 写失败**不得**被读成「判了不值得」：状态与 reason 都点名写失败。
    return done('unavailable', {
      ...outcomeBase,
      degraded: true,
      reason:
        '落库失败：' + (error instanceof Error ? error.message : String(error)) +
        '（判定结论未被应用；这不是「判了不值得」）',
    })
  }

  const state: WriteGateState = degraded ? 'degraded_written' : retired === false ? 'overwritten' : 'written'
  return done(state, { ...outcomeBase, wroteRow: true })
}
