/**
 * **Recall Gate**（B3.2-R 的召回侧门控实现）。
 *
 * 真源：`docs/mana-v5-plan.md:437`（Recall Gate 一行）+ `:468`（`{gate, degraded, items[]}`，
 *   `jev_prob` 与 `local_score` **分别保留**）+ `:482`（`rel_<id>` 问法）。
 * 判据真源：`docs/mana-rollout-plan.md:462`（A1-11 的字段面）+ `:459`（A1-8 的 Recall 支路）。
 *
 * ── 本文件为什么存在（本轮开工前的实测事实）─────────────────────────────────
 * `grep -rn 'rel_'` 扫过全部 `packages/<pkg>/src/` ⇒ **0 命中**（实测）⇒ B3.2 的召回侧在**全仓没有任何落点**，
 * A1-8 的「Recall → `degraded=1` 且返回有序 items」这一支路**无生产者**。
 * 本文件把该支路接上**既有**的 `mana/jev/judge` waterfall（`packages/jev/src/index.ts:284`
 * 是它的监听器，**不新建 waterfall、不新挂 `agent/pre-step`**——后者已被四处占用，
 * 每多挂一个就多一个漏调 `next()` 的机会，G9）。
 *
 * ── 三态**必须各自可分辨**（本批的核心判据）────────────────────────────────
 * | 态 | 触发条件 | `gate` | `rankBy` | `degraded` | `reason` |
 * |---|---|---|---|---|---|
 * | 判了且过阈 | 判定链给出有限概率 `≥` 阈值 | `judged` | `'jev_prob'` | `false` | `null` |
 * | 判了但未过阈 | 判定链给出有限概率 `<` 阈值 | `below_threshold` | `'local_score'` | `false` | 非空（说清"判了没过"） |
 * | 判不了 | 判定链抛错 / 返回 `degraded:true` / 概率非有限数 / **候选池为空** | `degraded` | `'local_score'` | `true` | **非空** |
 *
 * ⚠ **第 2 态与第 1 态必须能分辨**：两者都可能"没给出高分"，但前者是**判过**、后者是**没判**。
 *   故第 2 态的 `reason` 非空且带实测概率，第 1 态 `reason === null`。
 * ⚠ **降级（第 3 态）绝不标 `jev_prob`**（`rankBy` 回落 `'local_score'`）：降级路径上没有 JEV
 *   概率，标 `jev_prob` 会把「没判」伪装成「判了且低分」——这正是 G8 / A1-11 要防的形态。
 *⚠ **`reason` 的"非空"是本模块自己保证的**：调用方漏填原因时由 `degrade()` 兜底成显式串，
 *   而不是留 `null`（`null` 会被下游读成"没降级"）。
 *
 * ── 与 `packages/vector/src/recall.ts` 的分工（**刻意不合并**）─────────────────
 * `recall.ts` 管**管道内**（嵌入 → 余弦 → RRF）的三态；本文件管**判定链**（JEV）的三态。
 * 两者的降级**触发条件不同、失效模式不同**（一个是端点不通，一个是判定链不可用），
 * 合成一个函数会让「向量档绿」掩盖「判定链没跑」—— 与 retirement/activation 两张清单
 * 不合并是同一条纪律。
 *
 * ⚠ **验收阈值的归属（未拍板项，本节如实标注，不得读成已定）**：
 *   本文件把「判定链**可用性**」与「**过阈值**」分成两个判据，而不是一个"有没有拿到概率"。
 *   理由：只判"拿到概率"时，「可用且未过阈」与「不可用」在返回值上**同形**（都没有可用概率）；
 *   而本批的核心要求正是这两者必须可分辨。⚠ 但"Pass 条件一律 = 拿到概率"这一口径**尚未由
 *   `docs/mana-rollout-plan.md` 的判据表拍板**（册面未立 Recall Gate 的独立判据行）——
 *   此处不替册面拍板，只把两种口径下的行为都做成**可枚举、可断言**的。
 *
 * ── 不写库、不 emit、不注册监听器（**边界自证**）─────────────────────────────
 * 本模块是**纯函数 + 显式 ctx 入参**，与 `retirement.ts` 同一形态：
 * 落库 / 广播由调用方做（`index.ts` 的 recall 路径），故 `skeleton.test.mjs` 判据⑦
 * （effect 面恰好 3 条）与判据⑧（本包不写 `mana_trace` 行）**在本批之后仍成立** ——
 * 这不是"顺带"，是本模块的**结构约束**：它拿不到 `core`，也就写不了库。
 *
 * ── 本批修复（2026-09-26，来自 verify 席的独立审查；两处都是**实测**缺陷）────────
 * ① **逐候选唯一 requestId**：判定链的生产落痕点把 `requestId` 直接当 `jev_log.id` 用
 *   （`packages/jev/src/index.ts:288` `idFactory: () => req.requestId` ⇒
 *    `framework.ts:434/469` ⇒ `jev-log-gate.ts:112` `v.id = o.requestId`），而
 *    `jev_log.id` 是 **PRIMARY KEY**。此前逐候选复用同一 `requestId` ⇒ N 条候选只落 **1 行**，
 *    其余抛主键冲突被记进**库外** `traceError` ⇒「判了几条」在库里不可数 ⇒ A1-8 召回支路
 *    **结构上不可判**。现派生为 `${batch}#rel_${key}`（`judgeIdFor`，唯一真源，可被判据点名）。
 * ② **`sessionId` / `turnId` 透传**：护栏按会话计费（`framework.ts:459`），不传 ⇒
 *    召回面所有会话并进 `undefined` 这一条虚构分区 ⇒ 预算护栏对召回面**失效**，
 *    且「A 会话吃掉 B 会话预算」在库里看不出。
 * ⚠ 本批**未**回退三态可分辨性，**未**动 `jev_log.gate` 词表（仍 `unavailable`/`budget` 两值）。
 * ── f3 批（2026-09-26，第二轮独立复审）：**把「id 唯一性」当不变量重过一遍** ──────
 * 上一批只修了「报出来的那一条路径」。f3 按不变量复核，找出**同病三条路径**：
 * ① **重复候选键**：两个同键候选派生同一 id ⇒ 后一条撞主键 ⇒ 声明 3 实落 2
 *    ⇒ 现在**按 key 去重**，被丢弃的键记进 `duplicateKeys`（**静默去重是禁止的**）。
 * ② **候选抛错**：抛错路径没有「监听器已落痕」的证据 ⇒ 算进声明就是**声明强于实际**
 *    ⇒ 现在抛错键进 `threwKeys`，**不进** `judgeIds`。
 * ③ **拼接式不是单射**：分隔符 `#` **可以出现在分量里** ⇒ `('r#rel_x','y')` 与
 *    `('r','x#rel_y')` 撞同一 id ⇒ **后一批撞主键、落痕 0 行**。
 *    ⚠ **本批（f3 收尾）订正上一版的证据措辞**：上一版写「现有调用方里未找到能触发的输入
 *    （`requestId` 与候选键实测均不含 `#`）」—— **该证据不成立**，与源码不符：
 *      · `packages/perception/src/index.ts:92` 的 `requestId` **真产 `#<n>`**
 *        （`${input.requestId}#${i + 1}`，多块切分时为每块派生后缀）；
 *      · `packages/vector/src/recall.ts:23` 明写上游候选键规范即 **`file#line`**；
 *      · 且**全仓无任何类型级或运行期约束**禁止 `#` 出现在 `requestId` / `memory_items.id` 里。
 *    ⇒ 现改为**条件式**：**只要**任何调用方传入含 `#`（`%` 同理）的 `requestId` 或候选键，
 *      碰撞**即发生** ⇒ 必须转义（`encodeIdPart`）才能**在结构上**排除。
 *      ⚠ 是否**已经**在生产路径上发生过，本席**未验证**（不定裁）；本批只保证「结构上不可能」。
 *    ⚠ **无特殊字符时输出逐字节不变**（有对拍），故既有断言/日志/键值不受影响。
 * ⇒ 三条路径现在都有**可观测**出口（`duplicateKeys` / `threwKeys` / 单射反解），
 *    且判据从「计数 != 3」升级为「**本批新增行集 == 声明集**」的集合级对账。
 *
 * ── f3 收尾批（2026-09-26，第三次独立复审）：**不变量补成双向** + 归因拆两义 ────────
 * ⓪ **上一版只查了「声明多于行」一个方向**。反向（**声明少于行**）有一条**可触发**路径：
 *    判定链（jev 监听器）在**降级分支**是「**先落痕、后调 `next()`**」（`jev/src/index.ts:335`+`348`）；
 *    若**下游监听器抛错**，调用方拿到异常 ⇒ 它的 `judgeIds` 里没有这条 ⇒ **声明 0**，而库里**真有行**。
 *    ⇒ 生产者（jev 侧）现在把「本层已落痕」挂在**错误对象**上（`Symbol.for('mana.jev.judge.traceWritten')`），
 *      本模块用同一 `Symbol.for` 键读它（**不 import** jev，保持 `inject:['mana-core']` 的依赖方向），
 *      三分类处理：`true` ⇒ 仍进声明；`false` ⇒ 不算进声明；`null`（**对方没给**）⇒
 *      **不可知**，不算进声明并**在 `reason` 里点名"落痕事实不可知"**（不静默倒向任一侧）。
 * ⓪' **根因修在生产侧顺序上**：jev 侧两条出口现在都带 `traceWritten` 事实，且**下游抛错时
 *    不吞异常、只补事实**（异常仍然抛出去 —— 那是下游的失败，本层无权替它决定）。
 * ① **`reason` 的归因拆成两义**（新增可枚举字段 `failureKind`）：
 *    「判定链不可用」与「判定链已判并已落痕、但下游抛错」是**两种不同的故障**，
 *    旧措辞把二者写成同一句 ⇒ 事后**不可归因**。现在四值：`no-finite-probability` /
 *    `downstream-threw` / `trace-unavailable` / `mixed`，措辞按实际发生的那一类**条件式**给出。
 * ② ③ 的证据措辞改为**条件式**（见上 ③ 的订正段）。
 * ④ **单射腿与集合腿的分工（写给下一位读者）**：
 *    · **单射腿**（RG-JL-①）判的是**派生函数本身**——「不同的 (批次,候选键) 对**不会**映射到同一 id」，
 *      它是**纯函数级**证据，**不碰库**；
 *    · **集合腿**（RG-JL-②③⑥，即 `assertRowsMatchDeclaration`）判的是**端到端落痕一致性**——
 *      「本批**新增**的 `jev_log` 行集 == 声明集」，它**必须碰真库**。
 *    ⇒ 二者**不可互相替代**：单射腿绿**推不出**集合腿绿（去重/抛错/下游抛错都不受单射性影响）；
 *      集合腿绿也**推不出**单射腿绿（现有输入恰好不含 `#` 时碰撞不发生）。
 *      两条腿都在，才是「id 唯一性」这个不变量的**双向**覆盖。

 * ── 「声明 == 行」这条不变量在**两包里逐处出口**的覆盖普查（f3 收尾 ⑥ 之后）────────
 * 判定：**会报红** = 有判据在扰动下会红；**仍静默** = 无判据（如实认账，不假装覆盖）。
 *
 * | # | 出口 | 位置 | 该出口的失败形态 | 覆盖 |
 * |---|---|---|---|---|
 * | 1 | 判定链**正常出口**（有概率） | `jev/src/index.ts:344` | `traceError` 非空（落痕写失败，**不抛**） | 字段 `traceWritten` 已挂；消费侧 `traceFlag === false` ⇒ `untracedKeys`；判据 RG-JL-⑥c |
 * | 2 | 判定链**降级出口**（`next()` 正常返回） | `jev/src/index.ts:403` | 同上；且下游可能给了替代结果 | 同 #1（`traceWritten` 挂在降级返回体上） |
 * | 3 | 判定链降级出口的**下游抛错**分支 | `jev/src/index.ts:385-399` | 已落痕但调用方只看到异常 | 事实挂错误对象（`Symbol.for`）+ **原样抛**；判据 RG-JL-★ |
 * | 4 | 判定链**成功但无概率**（`degraded=false && probability===null`） | 走 #2 分支 | 同 #2 | 由 #2 覆盖（同一段代码） |
 * | 5 | Recall Gate **早退**三条（未发起判定） | `recall-gate.ts` 三处 `degrade(...)` | 压根没送判 | **会报红** —— `failureKind` = `not-attempted`，判据 `RG-JL-Q2`（断言 + 克隆变异"改成 null ⇒ 必红"）；⚠ 此前本行归「会报红」而测试里 **0 断言**，是本表与事实不符，已补判据 |
 * | 6 | Recall Gate **态 3 出口 c**（全批无概率） | `recall-gate.ts` 出口 c | 三类混在一起 | **会报红** —— 统一 `annotate()` 归因；判据 RG-JL-★ / ⑥b |
 * | 7 | Recall Gate **正常出口**（judged / below_threshold） | `recall-gate.ts` 两处 | 部分候选落痕失败 | **会报红** —— `failureKind` 不再恒 null（RG-JL-⑥c）；⚠ `judged` 出口的 `reason` **此前恒 null**，现由 `RG-JL-Q1` 钉住（补 `annotate(null)`） |
 *
 * ⚠ **未覆盖（逐处点名；措辞按 verify 席第三次复审的事实订正，不假装已覆盖）**：
 * · `jev/src/index.ts:249/259/271` 的 `judge` / `judgeSystemone` / `judgeGuarded` **服务面**出口
 *   直接返回 `JevJudgeOutcome`（自带 `traceError` 字段），它们**不经** `mana/jev/judge` 监听器
 *   ⇒ 本批的 `traceWritten` 约定**对它不适用**；但 **`traceError` 调用方直接可读**
 *   （verify 席实跑读到 `no such table: jev_log`）⇒ 该面**可立判据（未立）**，不是"无法判"。
 *   ⚠ 本表此前写「不适用 / 没有判据覆盖」，把**可判**说成了**不可判** —— 已订正。
 * · 非 `dsh-mana-jev` 的**第二家** `mana/jev/judge` 实现：本仓现在没有。若将来有而不提供
 *   `traceWritten`：**降级出口**仍进声明 + 在 `failures` 里点名（不静默倒向任一侧）；
 *   ⚠ 但 **`judged` 出口**在补 `annotate` **之前**是**静默的**（`reason` 恒 `null`、`failureKind`
 *   依赖 `traceWritten` 也拿不到）—— 本表此前写"走不可知支"，与事实相反，已按事实订正。 */
import type { Context } from '@deepseek-ai/cordis'
import type { JevJudgeRequest, JevJudgeResult } from 'dsh-mana-core'

/** 判定链来源标识（落 `JevJudgeRequest.source`）。 */
export const RECALL_GATE_SOURCE = 'mana-long-term'

/**
 * **`Symbol.for` 键：判定链在「下游抛错」时挂到错误对象上的「本层已落痕」事实**。
 *
 * 生产者：`packages/jev/src/index.ts` 的 `JEVD_TRACE_WRITTEN`（**同名同串**）。
 * ⚠ 本模块**不 import** 那个常量：`dsh-mana-long-term` 的 `inject` 只有 `['mana-core']`
 *   （方案 §9.1 的依赖方向）⇒ 引 `dsh-mana-jev` 会把依赖反向拉过去。
 *   `Symbol.for` 用的是**全局符号注册表** ⇒ 两端写同一个串即得同一个符号，
 *   无需 import，也**不会**因为两个包各自打一份而失配。
 * ⚠ 若 jev 侧改了串 ⇒ 本模块读不到 ⇒ 退化为「声明少于行」，由双向判据抓出来（不是静默）。
 */
export const JEVD_TRACE_WRITTEN_KEY = Symbol.for('mana.jev.judge.traceWritten')

/** 从抛出的错误对象上读「本层已落痕」事实。返回 `null` = 对方**没给**（不可知，不得当成 false）。 */
export function traceWrittenOf(error: unknown): boolean | null {
  if (!error || typeof error !== 'object') return null
  const v = (error as Record<symbol, unknown>)[JEVD_TRACE_WRITTEN_KEY]
  return typeof v === 'boolean' ? v : null
}

/** 缺省过阈值（与 `attention/src/index.ts:86` 的 `jevThreshold` 同口径）。 */
export const RECALL_GATE_DEFAULT_THRESHOLD = 0.7

/** 缺省问法（`rel_<id>` 的 `<id>` 由候选键提供；此处是问句模板）。 */
export const RECALL_GATE_QUESTION = '该记忆与当前查询的相关性是否足以召回？'

/**
 * **态 3 的失败归因**（枚举，**两义不得混写**：判定链不可用 vs 下游抛错）。
 * 本批（f3 收尾）新增：此前 `reason` 把两类写成同一句「判定链不可用」，属归因串味。
 */
export const RECALL_GATE_FAILURE_KINDS = [
  /**
   * **未发起判定**（`judgeEnabled=false` / 候选池空 / 查询串空 —— 三个早退入口）。
   * ⚠ 与 `no-finite-probability`（发了、但没给读数）**不是同级**：这是「压根没送判」，
   *   本仓口径要求二者可分辨（"没送" ≠ "送了没成"）。
   */
  'not-attempted',
  /** 判定链可用，但候选都没给出有限概率。 */
  'no-finite-probability',
  /** 判定链**已判并已落痕**，但**下游环节**抛错。 */
  'downstream-threw',
  /**
   * **落痕失败**（`traceWritten === false`，**事实可知**）：判定本身给出了读数，
   * 但 `jev_log` 那一行**没写成**（如 `jev_log` 不可写 / 表被改）。
   * ⚠ 与 `trace-unavailable`（**不可知**）必须分开：把「可知的失败」写成「不可知」
   * 会让读者以为"再查也没用"，而其实**已经有确定结论**（本批 f3 收尾 ② 修的就是这一串味）。
   */
  'trace-failed',
  /** 调用抛错且「是否已落痕」**不可知**（对方没给该事实）。 */
  'trace-unavailable',
  /** 上几类同时出现。 */
  'mixed',
] as const
export type RecallGateFailureKind = (typeof RECALL_GATE_FAILURE_KINDS)[number]

/** 三态的**枚举值**（机检按字面量点名；不得用布尔/undefined 表状态）。 */
export const RECALL_GATE_STATES = ['judged', 'below_threshold', 'degraded'] as const
export type RecallGateState = (typeof RECALL_GATE_STATES)[number]

/** 一个候选（**只吃本地分**：本模块不做词法/向量检索，那是 `recall.ts` 的职责）。 */
export interface RecallGateCandidate {
  /** 稳定键（本仓 = `memory_items.id`）。 */
  readonly key: string
  /** 本地分（降级路径的排序依据；RFC：`rankBy='local_score'` 指的就是它）。 */
  readonly localScore: number
}

/** 门控配置。 */
export interface RecallGateConfig {
  /** 过阈值（`probability >= threshold` 才放行）。 */
  readonly threshold: number
  /** 送判定的候选上限（`Top-N`；判定链有并发槽位与 session budget，不设上限会打爆配额）。 */
  readonly topN: number
  /** 本次是否真的发起判定（`false` ⇒ 显式降级，`reason` 说清"未发起"）。 */
  readonly judgeEnabled: boolean
}

export const RECALL_GATE_DEFAULTS: RecallGateConfig = Object.freeze({
  threshold: RECALL_GATE_DEFAULT_THRESHOLD,
  topN: 10,
  judgeEnabled: true,
})

/** 一条命中（`jevProb === null` ⇔ 该条**没有被判过**，不得读成"判了 0 分"）。 */
export interface RecallGateHit {
  readonly key: string
  readonly localScore: number
  readonly jevProb: number | null
}

/** 门控结果（**三态的载体**；`gate` 是枚举、`rankBy` 与 `degraded` 必须与之一致）。 */
export interface RecallGateOutcome {
  readonly requestId: string
  readonly gate: RecallGateState
  readonly channel: 'vector' | 'lexical' | 'degraded'
  readonly rankBy: 'local_score' | 'jev_prob'
  readonly degraded: boolean
  /** 非空 ⇔ `degraded`（本模块自己保证；见文件头）。 */
  readonly reason: string | null
  /** 真送进判定链的候选条数（`0` 与"没走判定"是两件事）。 */
  readonly probed: number
  /** 真拿到有限概率的条数（`0` 与"判不了"可分辨）。 */
  readonly judged: number
  /**
   * **已返回**的判定键（`${requestId}#rel_${key}`）——与判定链落痕行的 `jev_log.id`
   * 同值（`packages/jev/src/jev-log-gate.ts:112` `v.id = o.requestId`）。
   *
   * ── 承诺是**条件式**的（本批按 verify 席要求改，如实写明）────────────────────
   * 成立的式子（三条，逐条可被 `tests/recall-gate-jevlog.test.mjs` 断言）：
   *   · `judgeIds` 内部**无重复**；
   *   · `judgeIds.length == 本批**新增**的 jev_log 行数`（用**增量**，不是「按前缀筛全表」——
   *     后者在 requestId 被两批复用时会把上一批的同一批 id 也算进来，从而抹平「增量 0」）；
   *   · `新增行集合 == judgeIds 集合`。
   * ⚠ **`judgeIds` 与 `judged` 不是同一个量、不得互相推断**：判定链**返回**了但 `degraded:true`
   *   （如 `no-judge-listener`、通道不可用）时，该候选**已落痕**（进 `judgeIds`）但**没有可用概率**
   *   （不进 `judged`）⇒ `judged ≤ judgeIds.length`，等号只在「全部返回且全部拿到有限概率」时成立。
   * 上述式子在下列三条件**同时**满足时成立，缺任一条即不成立 —— 本模块**不假装无条件保证**：
   *   ① 同一批次内候选键**互不重复**：本模块已按 key 去重（重复项改由 `duplicateKeys` 显式报出），
   *      故这一条**由实现保证**；
   *   ② 判定链监听器在**返回前确实落痕**：这是 jev 的结构保证（`ollama.ts:325` 的
   *      `finish()` 是唯一出口，"传了 db 就一定落一行"）⇒ 只要调用**返回**了，行就在；
   *      **抛错**的候选不会返回（可能没落行），故它们**不进本数组**，改由 `threwKeys` 报出；
   *   ③ 同一 `requestId` **不被两个批次复用**（**调用方前置条件**，本模块无法单方面保证）：
   *      复用会让两批派生同一批 id ⇒ 后一批撞主键、增量 0。该前置条件可被对账判据检出
   *      （见 `tests/recall-gate-jevlog.test.mjs` 的 RG-JL-⑥ 前置条件腿）。
   * ⚠ 本字段**刻意不写"每 probed 条各一行"** —— 那条在①②两类反例下不成立（上一版本把不可达的
   *   承诺写在字段上，是本批要修的第二类缺陷：**文档承诺强于实现**）。
   */
  readonly judgeIds: readonly string[]
  /** **已派发**给判定链的候选键（含后来抛错的那些）；与 `judgeIds` **不必等长**（差额见 `threwKeys`）。 */
  readonly probedKeys: readonly string[]
  /** 因**候选键重复**被去重丢弃的键（**显式报出，不静默**；去重是 id 唯一性的前提）。 */
  readonly duplicateKeys: readonly string[]
  /**
   * **本批的失败归因**（可枚举；**无异常时为 `null`**）。
   *
   * ⚠ 它**不再只在降级出口**给出（f3 收尾 ③）：只要发生下列任一异常，**任何出口**都带它：
   *   · 有候选**落痕失败**（`traceWritten === false` ⇒ `untracedKeys` 非空）
   *   · 有候选**抛错**（`threwKeys` 非空）
   *   · 有候选**没给出有限概率**且整批都没给出
   * ⚠ 收录新理由见 `RECALL_GATE_FAILURE_KINDS`；本字段的存在就是为了让「哪一环坏了」
   *   在**事后可归因**（旧版把两类写成同一句话）。
   */
  readonly failureKind: RecallGateFailureKind | null
  /**
   * **判定调用返回了、但回报「落痕失败」的候选键**（`traceWritten === false`，事实**可知**）。
   * ⚠ 它们**不进** `judgeIds`（那一行确实不在库里）—— 这正是「声明 == 行」这条不变量
   *   在**正常出口**（judged / below_threshold）上仍然成立的原因。
   * ⚠ 没有这个字段时，「声明多于行」在正常出口上**无迹可查**（f3 收尾 ⑥ 实测：
   *   `jev_log` 不可写时声明 3 / 行 0 而 `failureKind === null`）。
   */
  readonly untracedKeys: readonly string[]
  /**
   * **调用抛错、且对方未给「是否已落痕」事实的候选键**（**不可知**）。
   * ⚠ 与 `untracedKeys`（可知的失败）**必须分开**：二者处置相同（都不进声明），
   *   但**归因不同**（一个"确定没写"，一个"不知道写没写"）。
   */
  readonly traceUnknownKeys: readonly string[]
  /**
   * 判定链调用**抛错**的候选键（`probedKeys` 里已派发但未返回的那些）。
   * ⚠ 它们**不在** `judgeIds` 里：抛错路径上没有"监听器已落痕"的证据，
   *   把它们算进 `judgeIds` 就是**声明强于实际**（本批修的第二类缺陷）。
   */
  readonly threwKeys: readonly string[]
  readonly items: readonly RecallGateHit[]
}

/** 输入。 */
export interface RecallGateRequest {
  readonly requestId: string
  readonly query: string
  readonly candidates: readonly RecallGateCandidate[]
  readonly topK?: number
  /** 会话标识（仅用于把 `requestId` 组装成稳定串，不落库）。 */
  readonly sessionId?: string
  readonly turnId?: number
}

/** 判定链的返回形状（**只读我们需要的字段**，容忍缺字段 —— 桩监听器可能只给一部分）。 */
type JudgeReply = Partial<JevJudgeResult>

/**
 * 本地分降序、同分按 key 升序 ⇒ **逐位可复现**（A 档前提；与 `rrf.ts` 的平局裁决同口径）。
 * 导出以便判据单独取证（`packages/core/tests/jev-gate.test.mjs` 的 G5 半边正缺这样一个具名导出）。
 */
export function sortByLocalScore<T extends { key: string; localScore: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.localScore - a.localScore || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** 组装降级信封（**唯一出口**，避免各处手写漏字段）。 */
function degrade(
  requestId: string,
  reason: string,
  items: readonly RecallGateHit[],
  probed: number,
  judged: number,
  judgeIds: readonly string[] = [],
  probedKeys: readonly string[] = [],
  duplicateKeys: readonly string[] = [],
  threwKeys: readonly string[] = [],
  failureKind: RecallGateFailureKind | null = null,
  untracedKeys: readonly string[] = [],
  traceUnknownKeys: readonly string[] = [],
): RecallGateOutcome {
  return {
    requestId,
    gate: 'degraded',
    channel: 'degraded',
    // ⚠ 降级**绝不**标 jev_prob（A1-11 原文）；哪怕 items 里恰好有概率也要回落本地分。
    rankBy: 'local_score',
    degraded: true,
    reason: reason || '未给出原因（调用方漏填）',
    probed,
    judged,
    judgeIds,
    probedKeys,
    duplicateKeys,
    threwKeys,
    failureKind,
    untracedKeys,
    traceUnknownKeys,
    items,
  }
}

/**
 * **id 分量的转义**（`%` 与 `#` 两个字符；`%` 先转 ⇒ 编码是单射）。
 *
 * ⚠ 为什么需要它（本批对「id 唯一性」做**不变量级**复核时的发现，如实标注其性质）：
 *   判定键的拼接式为 `批次 + '#rel_' + 候选键`，而**分隔符 `#` 可以出现在内容里**
 *   ⇒ 拼接式**不是单射**：`('r#rel_x','y')` 与 `('r','x#rel_y')` 会得到**同一个 id**。
 *   跨批次复用同一 id ⇒ 后一批撞 `jev_log.id` 主键、**落痕 0 行** —— 与上一轮修的
 *   「同批复用 requestId」是**同一个病**换了一条路径。
 *   ⚠ **条件式（订正上一版过度的证据，见文件头 ③）**：`#` 可以合法出现在分量里
 *   （`perception/src/index.ts:92` 产 `#<n>`；`recall.ts:23` 的上游键规范是 `file#line`），
 *   且全仓**无**类型级/运行期约束禁止它 ⇒ **只要**调用方传入含 `#`（或 `%`）的值，
 *   碰撞**即发生**。是否已在生产路径发生过，**未验证**（标注到此为止，不定裁）。
 *   ⇒ 本函数的定位是 **by-construction 单射化**（把该类从「靠调用方自觉」变成「结构上不可能」），
 *   代价是 2 个字符替换、且**不改任何现有输入的输出**（下面有对拍）。
 */
export function encodeIdPart(s: string): string {
  return s.split('%').join('%25').split('#').join('%23')
}

/**
 * 判定键派生（**唯一真源**）：`${批次 requestId}#rel_${候选键}`（两个分量各自转义）。
 *
 * ⚠ 单列一个导出函数而不是内联，理由与 `retirement.ts` 的 SQL 常量同源：
 *   判据必须能**按字面量点名**这个派生规则，否则「逐候选是否唯一」只能靠人读代码。
 *   ⚠ 它同时是 `jev_log.id` 的取值（见本文件内的实测注：`idFactory: () => req.requestId`）。
 *
 * **单射性**：`encodeIdPart` 不产出 `#` ⇒ 第一个 `#` 必是分隔符 ⇒ 可从 id 反解出唯一
 *   `(批次, 候选键)` 对（`judgeIdParts` 提供反解，供判据做双向对账）。
 *   ⚠ 输入不含 `%`/`#` 时输出与转义前**逐字节相同**（既有断言/日志不受影响）。
 */
export function judgeIdFor(batchRequestId: string, key: string): string {
  return `${encodeIdPart(batchRequestId)}#rel_${encodeIdPart(key)}`
}

/**
 * `judgeIdFor` 的**反解**（单射性的可执行证据，判据用）。
 * 返回 `null` = 该串不是本模块按本规则产出的判定键（**不得**当成「解出一个空键」）。
 */
export function judgeIdParts(id: string): { batchRequestId: string; key: string } | null {
  const at = id.indexOf('#rel_')
  if (at < 0) return null
  const dec = (s: string): string => s.split('%23').join('#').split('%25').join('%')
  return { batchRequestId: dec(id.slice(0, at)), key: dec(id.slice(at + '#rel_'.length)) }
}

/**
 * 走一次 Recall Gate。
 *
 * ⚠ **分发必须用 `ctx.waterfall`**（`docs/contract/event-types.ts:8` 的死契约）：
 *   用 `ctx.emit` 会**同步不炸、异步炸**（G6）。本模块自己提供默认 `next`，
 *   因为宿主不参与 `mana/jev/judge` 的默认值（与 `attention/src/index.ts:410` 同做法）。
 */
export async function recallGate(
  ctx: Context,
  req: RecallGateRequest,
  overrides: Partial<RecallGateConfig> = {},
): Promise<RecallGateOutcome> {
  const cfg: RecallGateConfig = { ...RECALL_GATE_DEFAULTS, ...overrides }
  const requestId = req.requestId
  const ordered = sortByLocalScore(req.candidates)
  const topK = req.topK ?? ordered.length
  /**
   * ── 候选键**去重**（本批修的第一条路径：重复候选键 ⇒ 主键冲突复发）────────────
   * 判定键由候选键派生（`judgeIdFor`）⇒ **同一批次里两个同键候选会派生同一个 id**
   * ⇒ 后一条撞 `jev_log.id` 主键、落痕 0 行 ⇒ 「声明 3、实落 2」。
   * 上一版本没有这一步，故那条路径下 `judgeIds` 的承诺**不成立**。
   *
   * ⚠ **不是静默去重**：被丢弃的重复项记进 `duplicateKeys` 并由出口带出去 ——
   *   「输入里有重复」这件事必须可观测（本仓：静默 = 让失败不可观测）。
   * ⚠ 去重**保留首次出现**（`sortByLocalScore` 已给出确定次序 ⇒ 保留哪个是确定的）。
   */
  const dup = new Map<string, number>()
  for (const c of ordered) dup.set(c.key, (dup.get(c.key) ?? 0) + 1)
  const duplicateKeys = [...dup.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort()
  const deduped = ordered.filter((c, i) => ordered.findIndex((x) => x.key === c.key) === i)
  const probedCandidates = deduped.slice(0, Math.max(0, Math.min(cfg.topN, topK)))
  const locals = deduped.map((c) => ({ key: c.key, localScore: c.localScore }))

  const localHits = (): RecallGateHit[] => locals.map((l) => ({ ...l, jevProb: null })).slice(0, Math.max(0, topK))

  // ── 态 3 的入口 a：显式关闭判定（**不是**"判了且没概率"）──────────────────
  if (!cfg.judgeEnabled)
    return degrade(requestId, '召回判定已停用（judgeEnabled=false）：未发起判定，回落本地分排序', localHits(), 0, 0, [], [], [], [], 'not-attempted')
  // ── 态 3 的入口 b：没有候选 ⇒（注意：这一条与"候选被判为不相关"**是两件事**）──
  if (!locals.length) return degrade(requestId, '候选池为空（0 条）：无任何候选可送判定', [], 0, 0, [], [], [], [], 'not-attempted')
  if (typeof req.query !== 'string' || req.query === '') {
    return degrade(requestId, '查询串为空：判定链的问法无从组装（state 为空串会让判定无输入）', localHits(), 0, 0, [], [], [], [], 'not-attempted')
  }

  // ── 逐候选 `rel_<id>` 判定（问法由 judgeType 区分）────────────────────────
  const probs = new Map<string, number>()
  const failures: string[] = []
  /**
   * ⚠ **`judgeIds` 只收"真返回了"的候选**（本批修的第二条路径：候选抛错）。
   *   抛错时**没有**"监听器已落痕"的证据（`judgeWithGuard` 的落痕在判定驱动**返回后**，
   *   而抛错可能发生在更早），把它算进 `judgeIds` 就是声明强于实际。
   *   ⇒ 两个数组各记各的：`returnedKeys` → `judgeIds`；`threwKeys` → 单列。
   */
  const returnedKeys: string[] = []
  const threwKeys: string[] = []
  /** 返回了、但**确定没写成行**的候选键（`traceWritten === false`）。 */
  const untracedKeys: string[] = []
  /** 抛错且**对方未给**落痕事实的候选键（不可知）。 */
  const traceUnknownKeys: string[] = []
  /**
   * ⚠⚠ **每条候选必须用唯一 `requestId`**（本仓 2026-09-26 实测的缺陷，本批修）：
   *   判定链的**生产落痕点**把 `requestId` 直接当 `jev_log.id` 用
   *   （`packages/jev/src/jev-log-gate.ts:112` `v.id = o.requestId`；
   *   值来自 `framework.ts:434/469` 的 `(options.idFactory ?? randomUUID)()`，
   *   而 `packages/jev/src/index.ts:288` 正是 `idFactory: () => req.requestId`）。
   *   `jev_log.id` 是 **PRIMARY KEY** ⇒ 本函数此前**逐候选复用同一 `requestId`** 时，
   *   N 条候选只落 **1 行**，其余 `INSERT` 抛主键冲突、被记进**库外**的 `traceError`：
   *   「N 条里判了几条」在库里**不可数** ⇒ A1-8 的 Recall 支路**结构上不可判**
   *   —— 正是本仓列为头号的那类形态（**让失败不可观测**）。
   */
  for (const c of probedCandidates) {
    const judgeReq: JevJudgeRequest = {
      // 唯一派生键：同一批 `requestId` 下每条候选一行（本批修）；`reason` 里同时带**父键**便于回填。
      requestId: judgeIdFor(requestId, c.key),
      // ⚠ 问法标识：`rel_<id>` —— 判定链据此区分"相关性判定"与别的判定（如 Injection 的 'noul'）。
      judgeType: `rel_${c.key}`,
      state: `query=${req.query}`,
      question: RECALL_GATE_QUESTION,
      /**
       * ⚠ **本字段 = 本模块的召回放行阈值**（契约 `JevJudgeRequest.threshold` 的调用方口径，
       *   与 `attention/src/index.ts:403` 传 `config.jevThreshold` 同义）。
       *   ⚠ **它不得被判定链当成"yes/no 内部分界"用**（本批实测踩到的串味）：
       *   `ollama.ts:423` `pYes >= threshold ? 'yes' : 'no'` —— 若监听器把本字段原样转给
       *   判定驱动，则召回阈值 0.99 会让 `pYes=0.9` 被写成 `value='no'`：
       *   **概率仍是真读数**，但 `value` 被调用方口径污染（"看起来正常、实际串味"）。
       *   ⇒ 分界改在**调用链那一侧**：`packages/jev/src/index.ts` 的监听器**不**把本字段
       *   透传给判定驱动（驱动用自身缺省）。本模块**只声明自己的阈值**，不替判定链定分界。
       */
      threshold: cfg.threshold,
      source: RECALL_GATE_SOURCE,
      // ⚠ **sessionId 必须透传**（本批修）：判定链的 session 预算护栏按会话计费
      //   （`framework.ts:459` `guard.budgetExhausted(sessionId)`）；
      //   不传 ⇒ 召回面所有会话并进 `undefined` 这一条虚构分区 ⇒ 预算护栏对召回面**失效**，
      //   且「A 会话把 B 会话的预算吃掉」在库里看不出（attention 席本轮另有一处同族缺陷）。
    } as JevJudgeRequest & { sessionId?: string }
    if (typeof req.sessionId === 'string' && req.sessionId !== '') (judgeReq as { sessionId?: string }).sessionId = req.sessionId
    if (typeof req.turnId === 'number') (judgeReq as { turnId?: number }).turnId = req.turnId
    let reply: JudgeReply | null = null
    try {
      reply = (await ctx.waterfall('mana/jev/judge', judgeReq, async (): Promise<JevJudgeResult> => ({
        // ⚠ 默认 `next` 是「**没有活监听器**」的那一支，**它自己不落库** ⇒ 它的 `requestId`
        //   不是 `jev_log.id`，此处给**父键**（下游据此回填到发起方那一批）。真正的落痕
        //   只有活监听器（jev 插件）做，且用的是上面那个**唯一派生键**。
        requestId: judgeReq.requestId,
        source: RECALL_GATE_SOURCE,
        value: 'unknown',
        probability: null,
        degraded: true,
        reason: 'no-judge-listener',
      }))) as JudgeReply
    } catch (error) {
      /**
       * ── ⚠⚠ **抛错有两大类，必须分开**（本批修，第三次复审实测的反向路径）──────────
       * 判定链（jev 监听器）在**降级分支**是「**先落痕、后调 `next()`**」：
       *   `judgeGuarded` 已经在库里落了行（`framework.ts:351`），随后才 `await next()`。
       *   于是**下游监听器抛错**时：
       *     · 调用方（本函数）拿到异常 ⇒ 若把它一律算作"没落痕"，`judgeIds` 里没有这条；
       *     · 而库里**真有**那一行 ⇒ **声明少于行**（反向不变量被破坏）。
       *   ⇒ 两类必须分辨，分辨依据只能由**生产者**给出（jev 侧把事实挂在错误对象上）：
       *     · `traceWritten === true`  ⇒ **已落痕** ⇒ 进 `returnedKeys`（其后由 `judgeIds` 带出）
       *       ⇒ 声明与行数**仍相等**；该候选计入 `threwKeys`（"抛错"这一事实同样要报出）。
       *     · `traceWritten === false` ⇒ 落痕**失败**（`traceError` 非空）⇒ 不算进声明（行不在）。
       *     · `traceWritten === null`  ⇒ 对方**没给**该事实（如桩监听器/他实现的 jest）⇒
       *       **不可知**，按保守侧处理：不计进声明，并在 `reason` 里**点名"落痕事实不可知"**
       *       （不得静默当成"没落痕"，也不得静默当成"已落痕"）。
       */
      const written = traceWrittenOf(error)
      threwKeys.push(c.key)
      if (written === true) returnedKeys.push(c.key)
      if (written === null) traceUnknownKeys.push(c.key)
      const msg = error instanceof Error ? error.message : String(error)
      const kind = written === true ? 'judge-threw-but-traced' : written === false ? 'judge-threw-no-trace' : 'judge-threw-trace-unknown'
      failures.push(`${c.key}: ${kind}(${msg})`)
      continue
    }
    /**
     * ── ⚠⚠ **正常出口同样要读 `traceWritten`**（f3 收尾 ⑥，实测缺陷）──────────────────
     * 上一版只在**抛错**路径上读它，注释却声称"两条出口都给" ⇒ **文档强于代码**。
     * 实测后果（verify 席用 `DROP jev_log` 造落痕失败）：
     *   `judgeGuarded` 的落痕**写失败**时它**照旧返回**（把失败记进 `traceError`，
     *   见 `framework.ts:361-368`）⇒ 这里拿到的是一个**正常返回**的对象 ⇒ 上一版把它
     *   无条件算进 `returnedKeys` ⇒ **声明 3 / 行 0**，而 `failureKind === null`、
     *   `reason` 也无迹可查 ⇒ 「**声明多于行**」**在正常出口上无任何字段报警**。
     * ⇒ 现在三条分支：
     *   · `traceWritten === false`（**可知的落痕失败**）⇒ 进 `untracedKeys`，**不进** `judgeIds`
     *   · `traceWritten === true`  ⇒ 进 `returnedKeys`（其后由 `judgeIds` 带出）
     *   · 字段**缺席**（`undefined`，对方不提供该事实，如桩监听器）⇒ **不可知**，
     *     按保守侧处理：**仍进** `returnedKeys`（既有行为不变：不能因为对方没给事实就改变
     *     对**既有桩**的判定），但在 `failures` 里**点名"落痕事实未提供"**（可查）。
     *     ⚠ 这一支的取舍理由：`returnedKeys` 的旧语义 = "调用返回了"，
     *       若因缺字段就把它移出声明，会让**所有用桩的既有判据**从"声明 == 行"变成"声明 < 行"
     *       —— 那是把**可知缺陷**换成**大面积假红**。故保守侧 = 保持旧语义 + 留痕。
     */
    const traceFlag = (reply as { traceWritten?: unknown } | null | undefined)?.traceWritten
    if (traceFlag === false) {
      untracedKeys.push(c.key)
      threwKeys.push(c.key)
      failures.push(`${c.key}: trace-failed(判定返回了但 jev_log 未写成：${String((reply as { traceError?: unknown } | null)?.traceError ?? '无 traceError 读数')})`)
      continue
    }
    if (traceFlag === undefined) {
      failures.push(`${c.key}: trace-written-unknown(对方未提供 traceWritten 事实)`)
    }
    // 走到这里 = 判定链**真返回了**且（已知或未知地）已落痕。
    returnedKeys.push(c.key)
    const p = reply?.probability
    if (reply && reply.degraded !== true && typeof p === 'number' && Number.isFinite(p)) {
      probs.set(c.key, p)
    } else {
      // ⚠ 这里**不把"没概率"当成 0**：0 是合法概率（G5），它必须与"判不了"可分辨。
      failures.push(`${c.key}: ${reply?.degraded === true ? `downstream-degraded(${reply.reason ?? '无原因'})` : 'no-finite-probability'}`)
    }
  }

  /**
   * ── **统一归因**（f3 收尾 ②③：**一处**算、**所有出口**用）────────────────────
   *
   * ⚠ 旧版把归因**只写在态 3 那一个出口**里 ⇒ 正常出口（judged / below_threshold）上的
   *   「落痕失败」**没有任何字段**（实测：`DROP jev_log` 时声明 3 / 行 0 而 `failureKind === null`）。
   *   现在这里是**唯一**的归因计算点，**三处出口都取它**：
   *     · 态 3 出口 c（降级）· `judged`（`annotate(null)`）· `below_threshold`。
   *   ⚠ 本句曾**强于代码**（`judged` 出口当时恒 `reason: null`，实测 `annotate` 仅 2 处调用）——
   *     由 verify 席第 5 次复审抓出，本批**补上第三处调用**（判据 `RG-JL-Q1`）而非收回措辞。
   *     选"补"不选"收回"的理由：**只读 `reason`** 的消费方（不看 `failureKind`/`untracedKeys`）在
   *     `judged` 出口会完全看不到「部分候选落痕失败」⇒ 那是**失败不可见**（本仓头号形态），
   *     不是一句措辞能免责的。补 `annotate(null)` 的代价是零（无异常时仍返回 `null`）。
   *
   * 枚举取值顺序即优先级（**先报"确定发生了的事"**）：
   *   · `trace-failed`        —— 有候选**确定没写成行**（即便整批都没概率，这个事实也更该先说）
   *   · `trace-unavailable`   —— 有候选抛错且**不可知**是否落痕
   *   · `downstream-threw`    —— 有候选抛错但**确定已落痕**（判定链本身是好的）
   *   · `no-finite-probability` —— 无异常，只是没给出有限概率
   *   · `mixed`               —— 上面两类以上同时出现
   */
  const tracedThrew = threwKeys.filter((k) => returnedKeys.includes(k)).length
  const untraced = untracedKeys.length
  const unknown = traceUnknownKeys.length
  const kinds: RecallGateFailureKind[] = []
  if (untraced > 0) kinds.push('trace-failed')
  if (unknown > 0) kinds.push('trace-unavailable')
  if (tracedThrew > 0) kinds.push('downstream-threw')
  const soleKind: RecallGateFailureKind | undefined = kinds.length === 1 ? kinds[0] : undefined
  const failureKind: RecallGateFailureKind | null =
    kinds.length === 0 ? null : soleKind !== undefined ? soleKind : 'mixed'
  const annotate = (base: string | null): string | null => {
    if (failureKind === null) return base
    const note =
      `归因=${failureKind}` +
      `（落痕失败 ${untraced} 条；落痕不可知 ${unknown} 条；下游抛错但已落痕 ${tracedThrew} 条）`
    return base === null ? note : `${base} ⇒ ${note}`
  }

  // ── 态 3 的入口 c：**一条都没判成** ⇒ 显式降级（fail-degraded）────────────
  if (!probs.size) {
    const detail = failures.slice(0, 3).join('; ')
    /**
     * ⚠ **归因措辞必须条件式且分类**（③ 归因串味）：旧措辞「**判定链不可用**：…」在
     *   **下游抛错**时是**错的**（判定链本身可用、也已落痕），会把「谁坏了」压成一句而不可归因。
     */
    const wording = annotate(
      failureKind === 'downstream-threw'
        ? `判定链**已判并已落痕**，但 ${tracedThrew} 条候选在**下游环节**抛错（${detail}）⇒ 本批无任何候选过阈值`
        : failureKind === 'trace-failed'
          ? `判定链给出读数但 **jev_log 落痕失败**（${untraced} 条确定未写成行；${detail}）⇒ 本批无任何候选过阈值`
          : failureKind === 'trace-unavailable'
            ? `判定链调用抛错且**落痕事实不可知**（${unknown} 条；${detail}）⇒ 无法确认这些判定是否已在库里留下行`
            : failureKind === 'mixed'
              ? `判定链部分候选在**下游**抛错、部分候选**落痕失败/不可知**、部分**未给出有限概率**（${detail}）⇒ 本批无任何候选过阈值`
              : `判定链可用但 ${probedCandidates.length} 条候选均未给出有限概率（${detail || '无详情'}）`,
    ) as string
    return degrade(
      requestId,
      wording,
      localHits(),
      probedCandidates.length,
      0,
      returnedKeys.map((k) => judgeIdFor(requestId, k)),
      probedCandidates.map((c) => c.key),
      duplicateKeys,
      threwKeys,
      failureKind,
      untracedKeys,
      traceUnknownKeys,
    )
  }

  // ── 态 1 / 态 2：**判过**。两者都必须把 jevProb 带出去（"判过"是事实，不得因未过阈而抹掉）
  const withProb: RecallGateHit[] = probedCandidates.map((c) => ({
    key: c.key,
    localScore: c.localScore,
    jevProb: probs.get(c.key) ?? null,
  }))
  // 未送判定的候选（超出 topN）保持 jevProb=null：**不得**给它们编一个值。
  const rest: RecallGateHit[] = locals
    .filter((l) => !probedCandidates.some((c) => c.key === l.key))
    .map((l) => ({ ...l, jevProb: null }))

  const pass = withProb.filter((h) => (h.jevProb ?? -Infinity) >= cfg.threshold)
  if (pass.length) {
    const ranked = [...pass].sort(
      (a, b) => (b.jevProb ?? 0) - (a.jevProb ?? 0) || b.localScore - a.localScore || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    return {
      requestId,
      gate: 'judged',
      channel: 'vector',
      rankBy: 'jev_prob',
      degraded: false,
      /**
       * ⚠ **Q1 修**：此处原来恒 `null`，而注释声称「三处出口都取 `annotate()`」⇒ **文档强于代码**。
       * 后果说准：凡**只读 `reason`**（不看 `failureKind`/`untracedKeys`）的消费方，
       * 在该出口**看不到**「部分候选落痕失败」这件事 ⇒ 失败不可见。
       * ⇒ 现与 below_threshold 出口**同一口径**：`annotate(null)` 在无异常时返回 `null`、
       * 有异常时给出可读归因串。⚠ 这不改变"正常放行"的语义（`degraded` 仍为 `false`）：
       * `record.gate === 'judged'` 与 `degraded === false` 的既有断言全部不受影响。
       */
      reason: annotate(null),
      probed: probedCandidates.length,
      judged: probs.size,
      // ⚠ 只收**真返回**的（抛错的不进）：见 returnedKeys 注。
      judgeIds: returnedKeys.map((k) => judgeIdFor(requestId, k)),
      probedKeys: probedCandidates.map((c) => c.key),
      duplicateKeys,
      threwKeys,
      // ⚠ 正常出口**也**报归因（f3 收尾 ⑥/③）：无异常时才是 `null`。
      //   旧版这里恒 `null` ⇒ 「落痕失败」在正常出口上**无迹可查**。
      failureKind,
      untracedKeys,
      traceUnknownKeys,
      items: [...ranked, ...rest].slice(0, Math.max(0, topK)),
    }
  }

  // ── 态 2：**判了但未过阈** ⇒ 与「没候选」必须能分辨（`reason` 非空 + `probed>0`）
  const best = Math.max(...withProb.map((h) => h.jevProb ?? Number.NEGATIVE_INFINITY))
  return {
    requestId,
    gate: 'below_threshold',
    channel: 'vector',
    rankBy: 'local_score',
    degraded: false,
    judgeIds: returnedKeys.map((k) => judgeIdFor(requestId, k)),
    probedKeys: probedCandidates.map((c) => c.key),
    duplicateKeys,
    threwKeys,
    // ⚠ 正常出口**也**报归因（同 judged 出口）。
    failureKind,
    untracedKeys,
    traceUnknownKeys,
    reason: annotate(
      `判定可用但未过阈值：${probedCandidates.length} 条候选已判（最高概率 ${best.toFixed(6)} < 阈值 ${cfg.threshold}）` +
        ` ⇒ 回落本地分排序（**这不是降级**：判定链可用且给出了真读数）`,
    ),
    probed: probedCandidates.length,
    judged: probs.size,
    items: sortByLocalScore([...withProb, ...rest]).slice(0, Math.max(0, topK)),
  }
}