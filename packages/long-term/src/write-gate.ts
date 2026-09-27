/**
 * **Write Gate（编码门 · B3.2 的写入侧）** —— 「这条观察值不值得留」的判定与落库。
 *
 * 真源：docs/mana-rollout-plan.md:103（三道门控语义表）——
 *   **Write Gate：bigram 预过滤 → 一次 fan-out（worth_keeping noul + supersedes choice + none），
 *   失败 fail-open 仍写入、标 gate=unavailable|budget**。
 * ⚠ 上面这句是**真源原文**（不改）。其中第一段「bigram 预过滤」在本文件中已于 2026-09-26
 *   **换靶**为「信号词预过滤」—— 闸保留、靶位归位，逐条理由与新旧对照见下面「预过滤」一节。
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
 * ── 预过滤：它是**优化**，且是**唯一会静默产 0 行**的那一步（**2026-09-26 换靶**）────
 * rollout:103 的第一段是预过滤 ⇒ 本实现**保留**该段，但把它的失效模式显式化：
 * 命中与否由**纯函数**返回（prefilterWorthKeeping），并在 outcome 上带 prefilterOverlap
 * ⇒「被预过滤挡下」与「判了不值得」**可分辨**（前者不进判定、不落 jev_log）。
 *
 * ⚠⚠ **换靶：旧口径 → 新口径（这是"归位"，不是"放宽"）** ⚠⚠
 *
 * | | 旧口径（本文件 2026-09-26 之前） | 新口径（本文件现值） |
 * |---|---|---|
 * | 比对靶 | **观察文本** vs **问法本身** `'这条观察值得长期记住吗'` 的 bigram 交集 | **观察文本是否含信号词** |
 * | 词表真源 | `WRITE_GATE_QUESTION` 的 bigram 集（`PREFILTER_BANK`） | `dsh-mana-perception` 的 `signal-words.ts`（**唯一真源，本文件不另立第二份**） |
 * | 阈值语义 | 最小 **bigram 交集数** | 最小 **信号词命中数** |
 * | 命中即 | 该文本"像那句问法" | 该文本"含跨会话可复用的语义信号" |
 *
 * **为什么换**（三条都是可复核的事实，不是偏好）：
 *   ① **v10 里没有"与问法比 bigram"这个东西**：v10 全文 `bigram` 命中数 = **0**；
 *      v10 §12.3 的信号词预筛比的是**信号词**，而本仓**已实现**于 `perception/src/signal.ts`。
 *   ② **本仓这道闸的出处被认错了**：它来自上游对照项目，而那里的 `prefilterLimit: 40` 是
 *      **候选条数上限**（见 `docs/mana-rollout-plan.md` §1.2 同构表：它与 `injectLimit: 3`、
 *      `supersedeCandidates: 12` 并列，三个都是**个数**语义），实现时走样成了"与问法比 bigram"。
 *   ③ **旧口径的实测后果是恒 0 行**：观察文本与那句问法的 bigram 交集恒 < 阈值
 *      ⇒ 恒 `skipped_prefilter` ⇒ `memory_items` 恒空 —— 而它**看起来像"系统效果差"**，
 *      实为**靶位错位**。实测（16 条真实风格语料，判据见 tests/write-gate-prefilter.test.mjs）：
 *      旧口径放行 **1/16**（唯一样例还是"这条观察值得长期记住…"这种**为过闸而写**的串），
 *      新口径放行 **7/16**；而 4 条寒暄/命令类**在新旧两口径下都被挡**（不是"全放过去"）。
 *
 * ⚠ **不撤闸**：它真有作用（省一次 LLM 往返）⇒ **只换靶**。删掉它 = 每条观察都进判定。
 * ⚠ **不在本文件另立词表**：词表与判据函数一律从 perception 运行期取（`resolveSignalLegs`），
 *   本文件**零词表字面量**。两份词表会长出第二个真源，本仓明令禁止（改一处不会改另一处）。
 * ⚠ 允许 prefilterEnabled:false 关掉它：那会让**每一条**观察都进判定（多花模型往返），
 * 但**不会**改变「判了之后写不写」的结果 —— 该开关的可观测差异 = skipped_prefilter 归零，
 * 由判据断言（本仓纪律：声明了的开关必须产生可观测差异，否则即「死开关」）。
 * ⚠ **预筛实现不可解析时 fail-open**（放行、进判定），且**可分辨**（`prefilterTable='unavailable'`）：
 *   让"少了词表"退化成"什么都记不下"是本仓最忌的静默 0 行形态，也正是旧口径踩过的坑。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { DatabaseSync } from 'node:sqlite'
import type { JevJudgeRequest, JevJudgeResult, ManaObservation, ManaCoreService } from 'dsh-mana-core'
// ⚠ **只 import 类型**（值一律走运行期解析，见 resolveSignalLegs）：
//   值 import 会把"perception 没装配"升级成"long-term 起不来"，而前者是合法且可分辨的状态。
//   静态类型 import 同时把「复用真源、不另立第二份词表」做成**编译期**约束：
//   词表形状若在 perception 侧改名，本文件 typecheck 直接红。
import type { SignalVerdict, SignalWordTable } from 'dsh-mana-perception'
import { MIN_QUERY_CHARS } from 'dsh-mana-core'
import { sha256Hex, selectLiveMemoryById } from './retirement.ts'
import { encodeIdPart, traceWrittenOf } from './recall-gate.ts'
import { resolveSummaryLegs, summarizeBeforeWrite, type SummarySkip } from './summarize.ts'

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
 * 预过滤所需的最小 **bigram 交集数** —— **旧口径的阈值，保留为可机检的对照件**。
 *
 * ⚠⚠ **它已不再是预过滤生效的阈值**（那现在是 `PREFILTER_MIN_SIGNAL_HITS`）——
 *   预过滤的比对靶已从"与问法比 bigram"换为"含信号词"（逐条理由见文件头）。
 *   **保留而非删除**的理由（这是一条实证腿，不是怀旧）：
 *     · 它使「旧口径」**可被逐字复算** ⇒ 新旧对照是**可机检**的，而不是注释里的一句自述；
 *     · 判据用同一批语料在两口径下各跑一次并断言两个读数（见 tests/write-gate-prefilter.test.mjs）。
 *   删除它 = 让"换靶前后差多少"从此不可复算，那正是本仓禁止的"让失败不可观测"。
 * ⚠ 它与 `PREFILTER_BANK` **成对**表达旧口径，二者不得只留一半。
 */
export const PREFILTER_MIN_OVERLAP = 2

/**
 * 预过滤所需的最小**信号词命中数**（**新口径**，= 现行生效阈值）。
 *
 * ⚠ 取值 1 的理由（实测）：信号词表本身已按准入判据筛过（`signal-words.ts` 文件的「准入判据」一节
 *   逐词写明，并**刻意不收**"我/问题/任务/代码/帮我/请"这类不指示"值得长期记住"的高频通用词），
 *   ⇒ 命中 1 个已经是"像信号"。取 2 会挡掉「记住：项目根目录在 /home/lk/Mana」这类
 *   **单信号词的持久事实**（实测命中数 = 1）—— 而它恰是本门最该记的一类。
 * ⚠ 它与 `prefilterMinHits` 配置项同源：改配置即改生效阈值，本常量只是**缺省值**的出处。
 */
export const PREFILTER_MIN_SIGNAL_HITS = 1

/**
 * 预筛实现的**缺省服务名**（与 consolidation/distill.ts 的 `DISTILL_PREFILTER_SERVICE` 同值，
 * 但**不 import 它的常量**：跨包值 import 会把可选依赖变成装配期前置 —— 见 `resolveSignalLegs`）。
 */
export const PREFILTER_SERVICE = 'dsh-mana-perception' as const

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
 * | skipped_prefilter | **信号词**预过滤未命中 ⇒ **未进判定** | 否 | 否 |
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

/**
 * ── v10 §12.1 第 ⑤ 步「向量化」的**接线面**（2026-09-27 补）──────────────────────────
 *
 * **本次修的缺口（本席 2026-09-27 亲跑取证的原文，不是推测）**：
 *   · `memory_items` **有 vector 列**（PRAGMA 实测在册）；
 *   · `vector` 包的 `putMemoryVector` **存在且可用**（packages/vector/src/index.ts:184/440）；
 *   · 而**全仓生产侧零调用方**（`grep putMemoryVector` 只命中 4 处**测试**）⇒ 库里所有行
 *     `vector` 恒为 NULL ⇒ 召回走降级，读数为
 *     `"候选常驻向量全未命中（1/1 条）：k1(memory_items.vector 为 NULL（该行尚未嵌入）)"`。
 *   · 而**嵌入通道本身完全正常**（`embedOne` ⇒ `degraded:false` + 1024 维）。
 *   ⇒ 性质与 `summary` 列、`prefilter` 零消费方**完全同形**：**列/能力在，生产不产**。
 *     修法因此只有一条：把落库路径**接到**既有面上（**不新写一份向量化逻辑** —— 那会长出
 *     第二个真源：编码器、维度契约、落库点各会漂）。
 *
 * ── 结构镜像而非跨包 import 类型（与 `summarize.ts` 的 `SummaryLlmLike` 同一取舍）──
 *   本包 package.json 的 peerDependencies 里**没有** `dsh-mana-vector`（本席写面不含 package.json）
 *   ⇒ 类型 import 会让"声明面与真依赖不一致"；且它把 long-term 的**编译**绑到 vector 的
 *   构建产物上（lib/ 是 gitignore 的派生物，全新克隆里构建顺序将变成隐含前置）。
 *   故此处只镜像**用到的两个方法**的结构面 —— 镜像一旦漂开，是**编译期**红（index.ts 传参处）。
 *
 * ── 与判定链/摘要步同一条**可选依赖**取舍：**运行期解析、解析不到不算故障** ──────────────
 *   `resolveVectorLegs` 取不到服务 ⇒ `vectorSkip='no-service'`（**具名**，见下），
 *   落库照常。绝不把"向量没接上"升级成"long-term 起不来"，也绝不静默成"这条本来就没向量"。
 */
export interface VectorEmbedLike {
  /** 取嵌入（显式降级信封：成功与失败同形，见 vector/adapt.ts 的 `EmbedOutcome`）。 */
  embed(texts: readonly string[]): Promise<{
    readonly vectors: readonly Float32Array[]
    readonly degraded: boolean
    /** 降级归类（`unsupported-by-server` 与通用 `degraded` 必须可分辨）。 */
    readonly failureKind: string | null
    readonly reason: string | null
    readonly model: string
    readonly baseUrl: string
  }>
}

/** 向量**写库**面（只取本步用到的唯一写点）。 */
export interface VectorWriterLike {
  putMemoryVector(
    memoryId: string,
    vec: Float32Array,
    meta?: { type?: string; content?: string },
  ): Promise<{ written: boolean; reason: string | null }>
}

/** 向量腿（运行期解析得到；`null` = 取不到 ⇒ 具名跳过，不是故障）。 */
export interface VectorLegs {
  readonly embed: VectorEmbedLike['embed']
  /** ⚠ 必须是 vector 包的 `putMemoryVector` —— 本包**不自己写** vector 列（唯一写库点那条纪律）。 */
  readonly put: VectorWriterLike['putMemoryVector']
  /** 解析来源（进读数，使"用的哪份实现"可分辨）。 */
  readonly source: string
}

/**
 * 本步的**服务名**（与 vector 包的 `apply` 注册名同值）。
 * ⚠ 不 import vector 的常量：跨包值 import 会把可选依赖变成装配期前置（同 `PREFILTER_SERVICE`）。
 */
export const VECTOR_SERVICE = 'mana-vector' as const

/**
 * 向量步的**跳过归类**（可枚举、可断言）—— 「列是空的」与「这一步没跑」必须可分辨。
 *
 * ⚠ 六态**互不冒充**，尤其前两态：
 *   · `disabled`    本步被开关关掉（**不是**失败）；
 *   · `no-service`  向量腿**根本没装配/没取到**（**不是**"嵌入了但失败"—— 两者的排查方向
 *                      完全不同：一个是装配面，一个是端点/模型面）；
 *   · `generate-failed` 嵌入调用失败（带上游归类：端点不通 / 模型不支持 / 服务端不支持嵌入）；
 *   · `empty-vector` 上游"成功"但没给出向量（第三种事实：既非失败也非有效产出）；
 *   · `empty-content` 无文本可嵌（**不是**"嵌入失败"）；
 *   · `put-failed`   嵌入成功但**写库失败**（维度不符 / 事务失败）—— 与"没嵌入"完全不同。
 */
export const VECTOR_WRITE_SKIPS = [
  'disabled',
  'no-service',
  'empty-content',
  'generate-failed',
  'empty-vector',
  'put-failed',
] as const
export type VectorWriteSkip = (typeof VECTOR_WRITE_SKIPS)[number]

/**
 * 跳过原因的**唯一构造出口**（纯函数）。
 *
 * ⚠ 为什么收成一处、且是**纯函数**：本仓头号形态是「让失败不可观测」——
 *   若各分支各自拼一句 `reason`，则「原因具名可读」就成了**每个分支自觉**的产物，
 *   少写一处即静默。收成一处后，判据可以**逐态**喂进去断言原因非空且互不相同
 *   （见 tests/write-vector.test.mjs 的逐态腿）；生产路径上它保证 `vectorReason`
 *   与 `vectorSkip` **永不成对出现一半**。
 */
export function vectorizeSkipReason(
  skip: VectorWriteSkip,
  detail: {
    /** 上游自报的原因（generate-failed / put-failed 用）。 */
    upstream?: string | null
    /** 上游降级归类（generate-failed 用）。 */
    failureKind?: string | null
    model?: string | null
    baseUrl?: string | null
  } = {},
): string {
  const up = detail.upstream === null || detail.upstream === undefined ? '' : String(detail.upstream)
  switch (skip) {
    case 'disabled':
      return 'vectorizeEnabled=false：本步未执行（不是"生成失败"）'
    case 'no-service':
      return (
        'ctx 上取不到 ' + VECTOR_SERVICE + ' 服务（未装配 / 已卸载 / ctx 不提供 get）' +
        '⇒ 未发起嵌入（不是"嵌入了但失败"：一个是装配面，一个是端点/模型面）'
      )
    case 'empty-content':
      return '无可嵌入文本（内容为空串）⇒ 未发起嵌入（不是"嵌入失败"）'
    case 'generate-failed':
      return (
        '嵌入调用失败[' + String(detail.failureKind === null || detail.failureKind === undefined ? 'degraded' : detail.failureKind) + ']：' +
        (up === '' ? '（上游未给出原因）' : up) +
        '（模型 ' + String(detail.model ?? '?') + '，端点 ' + String(detail.baseUrl ?? '?') + '）'
      )
    case 'empty-vector':
      return '上游未降级但未给出向量（既非失败也非有效产出）' + (up === '' ? '' : '：' + up)
    case 'put-failed':
      return '向量**写库失败**：' + (up === '' ? '（上游未给出原因）' : up) + '（与"没嵌入"是两件事）'
  }
}

/**
 * 落库路径上的**向量化执行**（v10 §12.1 第 ⑤ 步）。
 *
 * ⚠ 本函数**不抛**（与 `summarizeBeforeWrite` 同口径）：一切失败折进返回值里的具名归类，
 *   由调用方写进 outcome ⇒ 落库**永不**因向量腿故障而失败（本仓硬要求：少个派生优化
 *   ≠ 丢一条记忆）。写进 `memory_items.vector` 的**唯一**动作是 `legs.put`
 *   （= vector 包的 `putMemoryVector`：走 core 的 withTransaction + 常驻缓存），
 *   本包既不自己编码 BLOB、也不自己拼 SQL。
 *
 * @param legs 向量腿（`null` = 取不到 ⇒ `no-service`）
 * @param memoryId 落库用的记忆 id（**就是刚写进去的那一行**）
 * @param content 待嵌入文本（= 落库的 content；摘要**不**参与嵌入 —— 摘要可能是 null）
 */
export async function vectorizeMemory(
  legs: VectorLegs | null,
  memoryId: string,
  content: string,
): Promise<{
  readonly ok: boolean
  readonly skip: VectorWriteSkip | null
  readonly reason: string | null
  /** 写入的向量维度（未写入时 null）。 */
  readonly dim: number | null
  /** 写入的 BLOB 字节数（= dim×4，与库里 `length(vector)` 相等；未写入时 null）。 */
  readonly bytes: number | null
  readonly model: string | null
}> {
  if (legs === null) {
    return { ok: false, skip: 'no-service', reason: vectorizeSkipReason('no-service'), dim: null, bytes: null, model: null }
  }
  if (String(content ?? '').trim().length === 0) {
    return { ok: false, skip: 'empty-content', reason: vectorizeSkipReason('empty-content'), dim: null, bytes: null, model: null }
  }
  let embedded: Awaited<ReturnType<VectorEmbedLike['embed']>>
  try {
    embedded = await legs.embed([content])
  } catch (error) {
    // 腿**声明**"绝不抛"（vector/embed.ts 的入口注释），但它抛了 ⇒ 照样归成 generate-failed
    // 并带上真因：把"腿不守约"读成"嵌入不可用"会掩盖接口违约。
    return {
      ok: false,
      skip: 'generate-failed',
      reason: vectorizeSkipReason('generate-failed', {
        failureKind: 'threw',
        upstream: error instanceof Error ? error.message : String(error),
      }),
      dim: null,
      bytes: null,
      model: null,
    }
  }
  const model = embedded.model
  if (embedded.degraded) {
    return {
      ok: false,
      skip: 'generate-failed',
      reason: vectorizeSkipReason('generate-failed', {
        failureKind: embedded.failureKind,
        upstream: embedded.reason,
        model,
        baseUrl: embedded.baseUrl,
      }),
      dim: null,
      bytes: null,
      model,
    }
  }
  const vec = embedded.vectors[0]
  if (!vec || vec.length === 0) {
    return {
      ok: false,
      skip: 'empty-vector',
      reason: vectorizeSkipReason('empty-vector', { upstream: 'vectors[0] 缺失或长度为 0' }),
      dim: null,
      bytes: null,
      model,
    }
  }
  let written: { written: boolean; reason: string | null }
  try {
    written = await legs.put(memoryId, vec, { type: 'observation', content })
  } catch (error) {
    return {
      ok: false,
      skip: 'put-failed',
      reason: vectorizeSkipReason('put-failed', { upstream: error instanceof Error ? error.message : String(error) }),
      dim: null,
      bytes: null,
      model,
    }
  }
  if (!written.written) {
    return {
      ok: false,
      skip: 'put-failed',
      reason: vectorizeSkipReason('put-failed', { upstream: written.reason }),
      dim: null,
      bytes: null,
      model,
    }
  }
  return { ok: true, skip: null, reason: null, dim: vec.length, bytes: vec.length * 4, model }
}

/**
 * 向量腿的**运行期解析**（`ctx.get('mana-vector')`）。
 *
 * ⚠ **每次现解析、不缓存**：与 `resolveSummaryLegs` / `resolveSignalLegs` 同一条既有取舍
 *   （常驻进程里后装配的包必须能被接上；缓存 null 会让"后来装上了"永远不生效）。
 * ⚠ 取不到返回 `null`、**不抛**：向量腿缺席是**合法且可分辨**的状态
 *   （`vectorSkip='no-service'`），不是"long-term 起不来"。
 */
export function resolveVectorLegs(ctx: Context): VectorLegs | null {
  /**
   * ⚠ **能力探测，不是直接 `ctx.get`**（本席实测踩到，逐条记下）：
   *   既有两个判据（`write-gate-prefilter.test.mjs` ⑤/⑥）喂进来的是**最小桩 ctx**
   *   —— 只实现 `waterfall` 的对象。直接 `ctx.get(...)` 会 `TypeError: ctx.get is not a function`，
   *   把"没装向量腿"升级成**整条落库链抛错**：那正是本仓最忌的"可选依赖缺席 ⇒ 主链炸"。
   *   探测失败与"服务不存在"归成**同一个具名状态** `no-service`（对调用方而言都是"这条腿取不到"），
   *   但 reason 里把两种可能都写出来，不冒充。
   */
  const probe = ctx as unknown as { get?: (key: string) => unknown }
  if (typeof probe.get !== 'function') return null
  const svc = probe.get(VECTOR_SERVICE) as (VectorEmbedLike & VectorWriterLike) | undefined
  if (!svc || typeof svc.embed !== 'function' || typeof svc.putMemoryVector !== 'function') return null
  return {
    embed: svc.embed.bind(svc),
    put: svc.putMemoryVector.bind(svc),
    source: VECTOR_SERVICE,
  }
}

// ⚠ 「本层是否已落痕」的读取原语**复用** recall-gate.ts 的同名实现（traceWrittenOf /
//   JEVD_TRACE_WRITTEN_KEY），**不在此另立第二份**：同一个 Symbol.for 串若有两处定义，
//   改一处不会改另一处 —— 那正是「同一事实两个真源」的形态。

/** 本门配置（writeGate 第四参；缺省全内置，**不导出 Config** —— 见 skeleton.test.mjs 判据⑤）。 */
export interface WriteGateConfig {
  /** 放行阈值：prob >= threshold 才写。 */
  threshold: number
  /** 可编码的最小字符数（**短于 core 的 MIN_QUERY_CHARS 时，写进去也检索不到** ⇒ 显式不写）。 */
  minChars: number
  /** 是否启用**信号词**预过滤（关掉 = 每条都进判定；可观测差异见头注）。 */
  prefilterEnabled: boolean
  /**
   * 预过滤所需的最小**信号词命中数**（新口径；旧口径的"最小 bigram 交集数"见 `PREFILTER_MIN_OVERLAP`）。
   *
   * ⚠ 取 1 的理由：信号词表本身已是**准入过的**高精度词表（`signal-words.ts` 逐词写了准入判据，
   *   并**刻意不收**"我/问题/任务/代码/帮我/请"这类通用词）⇒ 命中 1 个即已是"像信号"。
   *   取 2 会把「记住：项目根目录在 /home/lk/Mana」这类**单信号词的持久事实**挡掉 ——
   *   而它恰恰是本门最该记的一类（实测：该串信号词命中数 = 1）。
   * ⚠ 它是**可覆盖**配置项（不是硬编码）：判据按它复算，并断言"调高阈值 ⇒ 该挡的确实被挡"。
   */
  prefilterMinHits: number
  /** 是否**真的落库**（false = 只判不写；判据拿它做「关掉 Write Gate ⇒ 不再产生新行」的反证）。 */
  write: boolean
  /**
   * 是否执行 v10 §12.1 第 ③ 步「摘要与标签」（落库前生成摘要）。
   *
   * ⚠ 缺省 **true**：本步是**编码链条的正规步骤**（不是可选优化），缺省关掉等于交付一个
   *   不生效的步骤 —— 而那正是「`summary` 列建了却零写者」这一缺口的成因。
   * ⚠ 关掉**不是静默**：outcome 的 `summarySkip='disabled'` + 非空 reason。
   */
  summarizeEnabled: boolean
  /** 摘要字符上限（超出即截断；0 = 不截断）。与 §25.5 提示词里的「不超过 50 字」配合。 */
  summaryMaxChars: number
  /**
   * 是否执行 v10 §12.1 第 ⑤ 步「向量化」（落库后把向量写进 `memory_items.vector`）。
   *
   * ⚠ 缺省 **true**：本步是**编码链条的正规步骤**（不是可选优化）。缺省关掉等于交付一个
   *   不生效的步骤 —— 那正是本次修的那个缺口的成因（`vector` 列建了却零生产写者）。
   * ⚠ 关掉**不是静默**：outcome 的 `vectorSkip='disabled'` + 非空 reason。
   * ⚠ 它也**不**是"重试/回填"旋钮：回填存量行是另一件事（本包本批**不做**）。
   */
  vectorizeEnabled: boolean
}

/** 缺省配置（冻结；判据以此为准，避免第二份缺省值）。 */
export const WRITE_GATE_DEFAULTS: WriteGateConfig = Object.freeze({
  threshold: WRITE_GATE_DEFAULT_THRESHOLD,
  minChars: MIN_QUERY_CHARS,
  prefilterEnabled: true,
  prefilterMinHits: PREFILTER_MIN_SIGNAL_HITS,
  write: true,
  summarizeEnabled: true,
  summaryMaxChars: 50,
  vectorizeEnabled: true,
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
  /** 预过滤的**命中数**（新口径 = 信号词命中数；未启用时为 null）。字段名沿用，语义见文件头换靶说明。 */
  readonly prefilterOverlap: number | null
  /**
   * 预过滤实际用的**词表名**（未启用时为 null）—— "用的哪张表"必须可分辨。
   * `unavailable` = 预筛实现不可解析 ⇒ **fail-open 放行**（与"文本不含信号词"的 `miss` 不同形）。
   */
  readonly prefilterTable: string | null
  /** 命中的信号词（未启用/旧口径下为空数组）—— 使「为什么放行」逐条可读。 */
  readonly prefilterHits: readonly string[]
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
  /**
   * ── v10 §12.1 第 ③ 步「摘要与标签（LLM）」的读数（2026-09-26 补）──────────────────
   * 本门在此之前恒写 `summary: null` ⇒ `memory_items.summary` 列**建了却零生产写者**，
   * 而读侧（`core.recallLexical`）已在读它 ⇒「列白建了」形态（与"本就没有摘要"同形）。
   */
  /** 本次落库行是否**带摘要**（false 时看 `summarySkip` 知道为什么）。 */
  readonly summaryWritten: boolean
  /** 摘要字符数（未生成为 null）。 */
  readonly summaryChars: number | null
  /** 未生成摘要时的**可枚举**归类（生成了则为 null）。 */
  readonly summarySkip: SummarySkip | null
  /** 未生成摘要的原因（生成了则为 null）—— 与 `summarySkip` 配对，使"为什么没有"可读。 */
  readonly summaryReason: string | null
  /**
   * ── v10 §12.1 第 ⑤ 步「向量化（vector）」的读数（2026-09-27 补）────────────────────
   *
   * 本门在此之前**从不**生成向量 ⇒ `memory_items.vector` 在生产侧**恒为 NULL**
   * ⇒ 召回恒走降级（`"…vector 为 NULL（该行尚未嵌入）"`）。这一组读数就是让
   * **「列是空的」与「这一步没跑」可分辨**的落点（本仓头号形态）。
   */
  /** 本次落库行是否**带向量**（false 时看 `vectorSkip` 知道为什么）。 */
  readonly vectorWritten: boolean
  /** 写入的向量维度（未写入为 null）。 */
  readonly vectorDim: number | null
  /**
   * 写入的 BLOB 字节数（= dim×4）—— 它**应当等于**库里 `length(memory_items.vector)`
   * （判据按这个等式取证，而不是只信"调用了 putMemoryVector"）。
   */
  readonly vectorBytes: number | null
  /** 未写向量时的**可枚举**归类（写入了则为 null）。 */
  readonly vectorSkip: VectorWriteSkip | null
  /** 未写向量的原因（写入了则为 null）—— 与 `vectorSkip` 配对，使"为什么没有"可读。 */
  readonly vectorReason: string | null
  readonly latencyMs: number
}

/**
 * 预过滤读数（纯函数返回，使「被挡下」可断言）。
 *
 * ⚠ 字段名沿用旧口径的 `overlap`/`bankSize`，**语义已换靶**（见文件头）：
 *   · `overlap` = **信号词命中数**（旧口径 = 与问法的 bigram 交集数）；
 *   · `bankSize` = **信号词表词数**（旧口径 = 问法的 bigram 集大小）；
 *   · 新增 `hits` / `table` 把"命中了哪些词、用的哪张表"变成**逐条可解释**的读数 ——
 *     这是换靶带来的直接收益：旧口径只能说"交集 2"，说不出"因为哪两个字"。
 */
export interface PrefilterResult {
  readonly hit: boolean
  readonly overlap: number
  readonly threshold: number
  readonly bankSize: number
  /** 命中的信号词（旧口径下恒空 —— 它没有"词"这个概念，如实记空而不是编一个）。 */
  readonly hits: readonly string[]
  /** 实际使用的词表名（`unavailable` = 预筛实现不可解析，此时 fail-open 放行）。 */
  readonly table: string
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
 * 预过滤词表（**旧口径**）—— 由问法本身派生，模块加载时算一次并冻结。
 *
 * ⚠ **它不再是生效词表**（生效词表 = perception 的 `DEFAULT_SIGNAL_WORDS`，经 `resolveSignalLegs`）。
 *   保留理由与 `PREFILTER_MIN_OVERLAP` 同：让旧口径**可逐字复算**，使新旧对照可机检。
 */
export const PREFILTER_BANK: readonly string[] = Object.freeze([...new Set(bigrams(WRITE_GATE_QUESTION))])

/**
 * 预过滤（**纯函数 · 新口径：信号词**）：文本是否含 ≥ `minHits` 个**信号词**。
 *
 * ⚠ 它**不能**用来判「不值得」：未命中只意味着「没进判定」，不意味着「判过且不通过」
 *   —— 两者在库里都表现为「没有新行」，故调用方必须把本结果记进 outcome（见 skipped）。
 *
 * ⚠ **零词表字面量**：词表与匹配逻辑全部取自 `legs.table`（= perception 的
 *   `BUILTIN_SIGNAL_TABLE`，**唯一真源**）。本函数只做「阈值比较」这一件新事
 *   —— 匹配本身不重写（重写就是第二份词表/第二个真源）。
 * ⚠ `legs` 为 null（perception 不可解析）⇒ **fail-open 放行**且 `table='unavailable'`：
 *   少一个词表不得退化成"什么都记不下"（那正是旧口径的静默 0 行形态）。
 */
export function prefilterWorthKeeping(
  text: string,
  minHits: number = PREFILTER_MIN_SIGNAL_HITS,
  legs: PrefilterLegs | null = signalLegs(),
): PrefilterResult {
  if (legs === null) {
    return { hit: true, overlap: 0, threshold: minHits, bankSize: 0, table: 'unavailable', hits: [] }
  }
  const verdict = legs.prefilter(text, legs.table)
  const hits = [...verdict.hits]
  return {
    hit: hits.length >= minHits,
    overlap: hits.length,
    threshold: minHits,
    bankSize: legs.table.words.length,
    table: legs.table.name,
    hits,
  }
}

/**
 * **旧口径**预过滤（**纯函数**）：观察文本与问法的 bigram 交集是否达到 `PREFILTER_MIN_OVERLAP`。
 *
 * ⚠ 它**不是**生效判据（`writeGate()` 不再调用它）。它为两件事存在，缺一不可：
 *   ① 让"换靶前后差多少"**可复算**（判据用同一批语料跑两口径并断言两个读数）；
 *   ② 它是**负控**：若新口径与它恒同结论，说明换靶没发生（或两者都退化成了全放行）。
 * ⚠ 有意保留 `overlapThreshold` 形参（既有判据的调用形状不变）。
 */
export function prefilterByBigramOverlap(text: string, overlapThreshold: number = PREFILTER_MIN_OVERLAP): PrefilterResult {
  const bank = new Set(PREFILTER_BANK)
  const seen = new Set(bigrams(text))
  let overlap = 0
  for (const g of seen) if (bank.has(g)) overlap += 1
  return { hit: overlap >= overlapThreshold, overlap, threshold: overlapThreshold, bankSize: bank.size, table: 'bigram-of-question', hits: [] }
}

/** 预筛的两条腿（**运行期解析**，见 `resolveSignalLegs`）。 */
export interface PrefilterLegs {
  /** perception 的真匹配函数（**本文件不重写匹配**）。 */
  readonly prefilter: (text: string, table?: SignalWordTable) => SignalVerdict
  /** 词表（**唯一真源** = perception 的 `signal-words.ts`）。 */
  readonly table: SignalWordTable
  /** 解析来源（进读数，使"用的哪份实现"可分辨）。 */
  readonly source: string
}

/**
 * 预筛实现的**运行期解析**（perception ⇒ long-term 的依赖是**可选**的）。
 *
 * ⚠ **为什么不值 import**（与 consolidation/distill.ts 同一条既有取舍，不另发明第二套）：
 *   · 本包 package.json 的 peerDependencies 里**没有** `dsh-mana-perception`（本席写面不含
 *     package.json）⇒ 值 import 会让**依赖声明与真依赖不一致**；
 *   · 更要紧的是：值 import 会把"perception 没装配"升级成"long-term 起不来"，
 *     而前者是**合法且可分辨**的状态（本包只经契约事件面工作，判定链缺席都不算故障）。
 * ⚠ **解析失败返回 null，不抛、不冒充** ⇒ `writeGate()` 记 `prefilterTable='unavailable'`
 *   并 **fail-open 放行**：使「词表没接上」与「文本不含信号词」**永不同形**
 *   （前者进判定、后者不进；两者都"没写新行"时靠本读数分辨）。
 * ⚠ 每次调用**现解析**（不缓存模块对象）：与 `resolveSignalPrefilter`/`resolveVectorCosine`/
 *   `svc()` 同一条既有取舍（常驻进程里后装配的包必须能被接上）。判据据此可拦截解析做失败腿。
 */
export function resolveSignalLegs(specifier: string = PREFILTER_SERVICE): PrefilterLegs | null {
  try {
    const entryUrl = import.meta.resolve(specifier)
    const req = createRequire(import.meta.url)
    const mod = req(join(dirname(fileURLToPath(entryUrl)), 'index.js')) as {
      prefilterBySignalWords?: unknown
      BUILTIN_SIGNAL_TABLE?: unknown
    }
    if (typeof mod.prefilterBySignalWords !== 'function') return null
    const table = mod.BUILTIN_SIGNAL_TABLE as SignalWordTable | undefined
    if (!table || !Array.isArray(table.words) || typeof table.name !== 'string') return null
    return {
      prefilter: mod.prefilterBySignalWords as PrefilterLegs['prefilter'],
      table,
      source: join(dirname(fileURLToPath(entryUrl)), 'index.js'),
    }
  } catch {
    // 吞错是**刻意的**：返回 null 是显式的"取不到"，调用方据此 fail-open 并落可分辨读数。
    // 若在此抛出，"perception 未装配"会变成"整条写入链不可用"（两者处置完全不同）。
    return null
  }
}

/**
 * 预筛腿的**进程内缓存**（只缓存成功解析的结果；null **不缓存** —— 见下）。
 *
 * ⚠ 为什么缓存：`writeGate()` 每条观察都要用腿，而 `import.meta.resolve` + `createRequire`
 *   在热路径上重复执行是纯浪费。缓存的是**同一份模块对象**，不产生第二个真源。
 * ⚠ 为什么 **null 不缓存**：解析失败的最常见成因是"perception 还没装配/产物还没构建"——
 *   那是**启动期**的暂时态。缓存 null 会让"后来装上了"永远不生效（本仓点名的静默失效形态）。
 *   ⇒ 只缓存成功、失败每次都重试；判据可据此拦截解析造失败腿并看到 fail-open 读数。
 */
let cachedLegs: PrefilterLegs | null = null
export function signalLegs(specifier: string = PREFILTER_SERVICE): PrefilterLegs | null {
  if (cachedLegs !== null) return cachedLegs
  const legs = resolveSignalLegs(specifier)
  if (legs !== null) cachedLegs = legs
  return legs
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
 * 流程（对应 rollout:103）：① 可编码性闸 → ② 信号词预过滤（**换靶**，见文件头）→ ③ retired 闸 →
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
    prefilterTable: null as string | null,
    prefilterHits: [] as readonly string[],
    memoryId: null as string | null,
    judgeId: null as string | null,
    traceWritten: null as boolean | null,
    wroteRow: false,
    overwroteLiveRow: false,
    summaryWritten: false,
    summaryChars: null,
    summarySkip: null,
    summaryReason: null,
    vectorWritten: false,
    vectorDim: null,
    vectorBytes: null,
    vectorSkip: null,
    vectorReason: null,
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

  // ② 预过滤（rollout:103 的第一段 ⇒ **换靶后的信号词口径**，见文件头）：
  //    未命中 ⇒ **未进判定**（不落 jev_log）。预筛实现不可解析 ⇒ fail-open 放行但记号。
  //
  // ⚠ **读数必须在"放行"路径上也可读**（本席 2026-09-26 实测踩到并改）：初版只在
  //   skipped_prefilter 分支写 prefilter* 读数 ⇒ 放行的那些 outcome 上它们恒为 null/[]，
  //   于是「**为什么放行**」恰恰在最需要解释的时候不可读 —— 这与本仓头号形态（让失败
  //   不可观测）是一回事，只是方向相反。故把读数**提升**到 ③ 之前并并入 outcomeBase：
  //   凡走过 ② 的出口（written/overwritten/rejected/degraded_written/skipped_retired…）都带真读数；
  //   唯 not_attempted（② 之前就返回）保持 null —— 那正是"预过滤**没跑过**"，与"跑了没命中"不同形。
  let prefilter: { overlap: number | null; table: string | null; hits: readonly string[] } = {
    overlap: null,
    table: null,
    hits: [],
  }
  if (cfg.prefilterEnabled) {
    const pre = prefilterWorthKeeping(content, cfg.prefilterMinHits)
    prefilter = { overlap: pre.overlap, table: pre.table, hits: pre.hits }
    if (!pre.hit) {
      return done('skipped_prefilter', {
        skipped: true,
        prefilterOverlap: pre.overlap,
        prefilterTable: pre.table,
        prefilterHits: pre.hits,
        reason:
          '信号词预过滤未命中：命中数 ' + pre.overlap + ' < ' + pre.threshold +
          '（词表 ' + pre.table + '，' + pre.bankSize + ' 词；真源 = dsh-mana-perception/signal-words.ts）⇒ 未进判定',
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
      prefilterOverlap: prefilter.overlap,
      prefilterTable: prefilter.table,
      prefilterHits: prefilter.hits,
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
    // 预过滤读数（② 之后的每个出口都带真值；见 ② 处的说明）
    prefilterOverlap: prefilter.overlap,
    prefilterTable: prefilter.table,
    prefilterHits: prefilter.hits,
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

  /**
   * ── v10 §12.1 第 ③ 步：**落库前生成摘要**（LLM）────────────────────────────────
   *
   * ⚠ **本步不阻断落库**：摘要缺失是"少一个优化"，不是"这条记忆不该记"。
   *   故四种失败全部**照常落库**（`summary: null`），但把失败归类与原因写进 outcome
   *   ⇒「列是空的」与「这一步没跑」在库/读数层面**可分辨**（本仓最忌的正是二者同形）。
   * ⚠ **只在真要落库时才生成**：上面几道闸（过短/预过滤/retired/阈值）任一挡下就早已 return，
   *   不会白花一次 LLM 往返 —— 这也是本步放在此处（而非入口）的理由。
   * ⚠ `summarizeEnabled=false` 时不生成，但**不是静默**：`summarySkip='disabled'`。
   */
  let summary: string | null = null
  let summarySkip: SummarySkip | null = null
  let summaryReason: string | null = null
  if (cfg.summarizeEnabled) {
    const legs = resolveSummaryLegs(ctx)
    const out = await summarizeBeforeWrite(legs.llm, legs.prompts, content, { maxChars: cfg.summaryMaxChars })
    if (out.ok) {
      summary = out.summary
    } else {
      summarySkip = out.skip
      summaryReason = out.reason
    }
  } else {
    summarySkip = 'disabled'
    summaryReason = 'summarizeEnabled=false：本步未执行（不是"生成失败"）'
  }

  try {
    sink.write({ id: memoryId, type: 'observation', content, summary, at: obs.at })
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

  /**
   * ── v10 §12.1 第 ⑤ 步：**向量化**（落库后把向量写进 `memory_items.vector`）────────────
   *
   * ⚠ **为什么放在落库之后**（而不是像摘要那样放在之前）：
   *   本步的产出**不是** `sink.write` 的入参 —— 它由 vector 包的 `putMemoryVector` 直接写进
   *   **同一个 memoryId 的那一行**（`ON CONFLICT(id) DO UPDATE SET vector=…`，见 vector/src/index.ts:254-262）。
   *   若放在之前，core 的 `INSERT OR REPLACE`（未列出 vector 列 ⇒ 重置为 NULL，见本文件头那张实测表）
   *   会把刚写好的向量**当场清掉** —— 那正是"看起来接上了、实际库里恒 NULL"的形态。
   *   放在之后 ⇒ 即便将来 core 改成白名单更新，本步的写入也仍然落在正确的行上。
   * ⚠ **只在真的写了行之后才做**：上面 `sink.write` 抛错即已 return（没有行 ⇒ 没有可写向量的目标，
   *   此时 `vectorSkip` 保持 null —— 它如实表示"这一步**没跑**"，而不是"跑了但跳过"）。
   * ⚠ **不阻断落库**（与摘要步同口径）：六种失败全部**照常**留着刚写好的记忆行（vector 保持 NULL），
   *   但把归类与原因写进 outcome ⇒「列是空的」与「这一步没跑」可分辨。
   * ⚠ 本步**复用** vector 包的既有唯一写库点 `putMemoryVector`：本包不编码 BLOB、不拼 SQL、
   *   不碰 `packages/vector/src/**` —— 自己再写一份即会长出第二个真源（编码/维度/落库点三处会漂）。
   */
  let vectorWritten = false
  let vectorDim: number | null = null
  let vectorBytes: number | null = null
  let vectorSkip: VectorWriteSkip | null = null
  let vectorReason: string | null = null
  if (cfg.vectorizeEnabled) {
    const vec = await vectorizeMemory(resolveVectorLegs(ctx), memoryId, content)
    vectorWritten = vec.ok
    vectorDim = vec.dim
    vectorBytes = vec.bytes
    vectorSkip = vec.skip
    vectorReason = vec.reason
  } else {
    vectorSkip = 'disabled'
    vectorReason = vectorizeSkipReason('disabled')
  }

  const state: WriteGateState = degraded ? 'degraded_written' : retired === false ? 'overwritten' : 'written'
  return done(state, {
    ...outcomeBase,
    wroteRow: true,
    summaryWritten: summary !== null,
    summaryChars: summary === null ? null : [...summary].length,
    summarySkip,
    summaryReason,
    vectorWritten,
    vectorDim,
    vectorBytes,
    vectorSkip,
    vectorReason,
  })
}
