/**
 * dsh-mana-working-memory 的 **v10 §30.2 三层上下文压缩**（本文件 = 唯一实现面）。
 *
 * ## 它解决的现象
 * 工作记忆在两闸之内仍是「原样堆叠的原文」：容量 4 / 预算 4000 字符把条数压住，
 * 却不减少单条自身的信息量，也不产出任何「交接摘要」。⇒ 长任务上窗口被旧步骤原文填满，
 * 而**触发压缩这件事本身在本仓不可观测**（「压了」与「没压」表面同形 —— 本仓最忌的失败不可观测形态）。
 *
 * ## 三层（v10 §30.2 原文在 /mnt/c/Users/lk/Downloads/deepseek_markdown_20260924_968609.md:1432-1452）
 *
 * | 层 | v10 原文 | 本仓落地 |
 * |---|---|---|
 * | 第一层 | ITACL 工作记忆内压缩 → 历史步骤摘要化，JEV 判断哪些步骤信息还要用 | compressChunks() —— **通用「工作记忆内压缩」**，不做 ITACL 专属 |
 * | 第二层 | 会话级压缩 → 窗口 80% 触发，五段式交接摘要 Goal/Decisions/State/Next/Anchors | handoff() —— 五段式结构 + compressAtRatio 可配阈值 |
 * | 第三层 | 长期记忆注入 → MEMORY.md 注入 system prompt，预算 < 2000 token | injectPlan() —— 预算闸，**字符**口径（见下「口径差异」） |
 *
 * ⚠ **第一层不是 ITACL 专属**（C16 已拍板不移植 ITACL：宿主 agent/pre-step 只返回
 *   reject/enter，**没有「信息充足度」通道** ⇒ 无处安放「JEV 判断哪些步骤还要用」）。
 *   故这里实现的是**通用能力**「工作记忆内压缩」：**调用方给定要保留哪些**（keepSeqs），
 *   本模块**不猜**「哪步还有用」。keepSeqs 的判据可由上游（JEV / 元认知）供给 ——
 *   本模块**不去接宿主**，也不假装有那个通道。
 *
 * ## 口径差异（v10 写 token，本仓判据是**字符** —— 二者不可换算冒充）
 * v10 §30.2 第三层写「预算 **< 2000 token**」。本仓既有判据一律是**字符**：
 *   attention.injectionBudgetChars = 4000（字符）、working-memory.budgetChars = 4000（字符，独立）、
 *   metacognition 画像容量门 3000（字符）。
 * ⇒ 本模块沿用**字符**（与全仓同口径），injectionBudgetChars 的**缺省 2000 是字符不是 token**，
 *   **不**声称与 v10 的「2000 token」等价。token 只能由**分词器**算，本模块**不引入**
 *   「0.6 token/字符」这类代理指标冒充真 token（代理指标非判据）。
 *
 * ## 记账是硬约束（不得静默丢内容）
 * 每一次压缩都把**前/后条数与字符数**写进返回结构：beforeChunks/afterChunks/beforeChars/
 * afterChars/savedChars/compressed。判据读这几个数就能分辨「压住了」与「根本没压」。
 * **失败一律显式降级 + 留字段**（degraded + failure），**不用 catch { return null } 吞异常**。
 *
 * ## ⚠ 与既有两闸的关系：**只读不写**
 * 本模块是**纯函数面**（compressChunks / handoff / injectPlan），
 *   **不碰** capacityChunks / budgetChars 两闸的任何一格语义，也**不改** chunks 数组：
 *   压缩的输入是 WorkingChunk[] 的**快照副本**，输出是**新对象**，原数组由调用方决定去留。
 *   ⇒ 「先容量后预算」「<= 0 = 该轴不设闸」两条既有契约在本文件里**一行都没有**，
 *     也不可能被这里改动（回归判据逐条点名核验）。
 *
 * ⚠ **不新增事件类型**：本模块**不写** mana_trace（8 事件契约不动）。
 *   记账落在**返回值**上，由调用方（index.ts 的服务面）决定是否上审计面。
 *
 * ## I3「压缩后不永久沉默」（v10 §14.6）—— 本文件承担**记账侧**
 * 折叠的实现是「把 N 条**移出** chunks 只留一条摘要」（见下第一层）。若没有配套的记账，
 * 「压缩生效」与「内容被丢弃」在读数上**同形** —— 本仓首位缺陷类。修前实测（见
 * tests/compress-i3.test.mjs 的修前读数）：`JSON.stringify(result)` 里连被折条的 requestId
 * 都不出现，只有一行区间串 —— 于是「压了 5 条」无法回答「压的是谁、还能不能查到」。
 * ⇒ 本文件补两样：① 结果面 `folded`/`foldedChars`（**逐条定位面**，不含内容原文）；
 *   ② 账本面（`FoldLedger` / `ledgerFold` / `foldProbe` / `foldLedgerView`）——
 *   有界、逐出留痕、三态可判别（`FoldBasis`）。**观测点**（服务面）在 index.ts。
 * ⚠ 账本持有的是**定位面**（requestId/seq/at/码点数），**不是原文** —— 本包从不持有原文
 *   （下「摘要不带原文内容」）。故三态里那条叫 `folded-locatable`（定位面可取回），
 *   **不**声称「原文一定还在」；后者本包没有资格断言（原文去向 = 调用方的持久化职责）。
 *
 * ## 残留盲区（如实记）
 * · degraded 的**唯一触发源**是调用方传入的 selector 抛错。因为压缩判据本身是
 *   **纯函数且总成功**（容量 <= 0 / 不超 / 无可折叠空间 ⇒ 不压缩，返回空动作而非抛错）
 *   ⇒ 本模块自身**没有**「压缩逻辑失败」的路径可造。「压缩失败」在本模块里**不是**
 *   一种运行态，而是**未来接入外部 selector（LLM 摘要等）时才可能出现**的形态 ——
 *   通道现在就留好且可判。
 */
import type { WorkingChunk } from './index.ts'

// ── 公共小工具（与 index.ts 同口径：字符一律按**码点**计）────────────────────

/**
 * 字符数一律按**码点**计 —— 与 index.ts 的 charsOf、snapshot().chars、
 * attention 的 injectionBudgetChars **同一口径**。
 * 单点定义：本文件内所有字符读数都走它，不各算一遍（「读数与事实脱钩」的母形）。
 */
export const codePointLen = (s: string): number => [...s].length

/** 按**码点**截断到至多 max 个码点（不切出半个代理对 —— 与 G2 的 (丙)/(己) 腿同口径）。 */
export const truncateCodePoints = (s: string, max: number): string =>
  max <= 0 ? '' : [...s].slice(0, max).join('')

/** WorkingChunk[] 的总码点数（与 snapshot().chars 同一算式）。 */
export const chunksChars = (chunks: readonly WorkingChunk[]): number =>
  chunks.reduce((n, c) => n + codePointLen(c.content), 0)

/** 注入面逐条拼接的分隔符（单点定义：拼接与「按它切回来」必须同一个串）。 */
export const INJECT_JOIN_SEP = String.fromCharCode(10)

// ── 第一层：工作记忆内压缩 ────────────────────────────────────────────────────

/**
 * 压缩**策略**（本层只做「保哪些 + 怎么合」两步，不做语义摘要生成）。
 *
 * ⚠ **摘要是 LLM 的活**，本模块不调模型（本仓 llm 包零调用点）。这里产出的
 * summary 是**确定性折叠**（被压缩条目的 seq 区间 + 条数），
 * 它是**可回查的定位串**，不是语义摘要 —— 不把它冒充成「历史步骤摘要化」的语义结果。
 */
export interface CompressStrategy {
  /**
   * 被合并的 N 条折成 1 条时，摘要正文的**码点数上限**。
   * 缺省 120。<= 0 ⇒ 该轴**不设上限**（与两闸同族的「<= 0 = 该轴不设闸」约定）。
   */
  summaryChars?: number
  /**
   * 参与压缩的**最旧**若干条里，要**保留原文**的条数下限（就绪性下限的近亲）。
   * 缺省 1（至少留 1 条原文，避免「全压成摘要」后丢失全部一手内容）。
   */
  keepRecent?: number
}

/** 第一层压缩的**记账**（每一次压缩都回填，0 与「没压」可分辨）。 */
export interface CompressionRecord {
  /** 本次是否真的压了（false 时其余读数应满足 before==after）。 */
  compressed: boolean
  /** 压缩**前**条数。 */
  beforeChunks: number
  /** 压缩**后**条数。 */
  afterChunks: number
  /** 压缩**前**总码点数。 */
  beforeChars: number
  /** 压缩**后**总码点数。 */
  afterChars: number
  /** 省下的码点数（= beforeChars - afterChars；恒 >= 0，压缩**不得**反而变长）。 */
  savedChars: number
  /** 被折叠掉的条目数。 */
  foldedChunks: number
  /** 摘要正文自身的码点数（与 savedChars 配对：省了多少 / 摘要占多少）。 */
  summaryChars: number
  /** 是否走了**降级**路径（selector 抛错时不压缩，但记账字段仍在）。 */
  degraded: boolean
  /** 降级原因（degraded=false 时为 null）。**失败必须留字段**，不得只回一个空结果。 */
  failure: string | null
  /**
   * 末态是否**真的回到容量上界内**（= afterChunks <= capacityChunks；容量轴不设闸时恒 true
   * —— 没有上界可言，不是「未达」）。
   *
   * ⚠ 为什么单列这一位：`compressed` 的**定义**是「折了且尺寸真回到上界内」。
   *   当 `keepRecent`（就绪性下限）夹住了折叠量时，末态可能**仍高于**上界
   *   （实测：容量 1 + 2 条 ⇒ 折 1 条留 1 条，size 仍是 2 = 压了但没够）。
   *   那种情形若照报 compressed=true，调用方会读成「已经压住了」而**不再兜底** ——
   *   正是本仓最忌的假绿。故此处如实回报：compressed=false + capacityReached=false
   *   + `overflowRemaining` > 0，由既有容量闸（未被本模块改动）继续兜底。
   */
  capacityReached: boolean
  /**
   * 末态仍**高于**容量上界的条数（0 = 已回到上界内或无闸）。
   * 与 `capacityReached` 配对：「压了但没够」到底还差几条，读这一个数就知道。
   */
  overflowRemaining: number
}

/** 被折叠条目的**定位条目**（I3：折叠**不**等于永久沉默 —— 逐条留痕，可回查）。 */
export interface FoldedRef {
  /** 被折条的 requestId（定位面；原文不在这里）。 */
  requestId: string
  /** 被折条的 seq（回原始留存面取原文的键）。 */
  seq: number
  /** 被折条的进入时刻（原样透传，不改写）。 */
  at: string
  /** 被折条的码点数（与全局「字符一律按码点」同口径）。 */
  chars: number
}

/** 第一层压缩的返回：压缩后的**新**数组 + 记账 + 可回查摘要 + **被折条的定位面**。 */
export interface CompressionResult extends CompressionRecord {
  /** 压缩后的新数组（**不**修改入参数组；原数组由调用方处置）。 */
  chunks: WorkingChunk[]
  /**
   * 被折叠条目的**定位串**（可回查）：列出 seq 区间与条数。
   * 原文不在这里（摘要不是原文的替代品）——调用方若要回查原文，凭 seq 回原始留存面取。
   */
  foldSummary: string[]
  /**
   * **I3 的落点（记账侧）**：被折叠条目的**逐条定位面**（0 条 ⇒ 空数组，显式记 0）。
   *
   * ⚠ 修前本字段**不存在**：`JSON.stringify(result)` 里只有一行区间串，连被折条的
   *   requestId 都不出现 ⇒ 「压缩生效」与「内容被丢弃」同形（本仓首位缺陷类）。
   * ⚠ **只有定位，没有内容**：本模块产出的摘要从不内嵌原文（否则「压缩」原地复活成
   *   原文搬运），故这里同样**不复制原文**。凭 requestId/seq 回原始留存面取 ——
   *   原文有没有留是**调用方**的持久化职责（见 handoff 的 retention:'caller-owned'）。
   *   服务面（index.ts）的账本把这件不可断言的事变成了**可判别**的三态：见 FoldBasis。
   */
  folded: FoldedRef[]
  /** 被折叠条目自身的码点总数（= 各 folded[].chars 之和；与 savedChars 配对）。N=0 显式记 0。 */
  foldedChars: number
}

/** 供调用方替换「哪些步骤要保留」的判据（第一层的**可插拔判据面**，v10 原文里的 JEV 位）。 */
export type KeepSelector = (chunks: readonly WorkingChunk[]) => number[]

/**
 * **第一层：工作记忆内压缩** —— 把最旧的若干条折叠成 1 条确定性摘要。
 *
 * 语义（**默认 = 容量驱动**，与「窗口 80% 触发」同族）：
 *   · capacityChunks <= 0 ⇒ 该轴不设闸（沿用全仓约定）⇒ **不压缩**（不是「全压掉」）。
 *   · chunks.length > capacityChunks 才动作（**严格大于**，恰满不动作 —— 与两闸同口径）。
 *   · 折叠范围 = 最旧的溢出条数，**但要留 keepRecent 条原文**；无可折叠空间时不动作。
 *
 * ⚠ 不变量：savedChars >= 0（压缩**不得**让内容变长；若摘要比原文长，本函数**不压**并如实记账）。
 *   这条不变量是「压缩真的省了」的判据 —— 没有它，一个把所有内容原样复制的「压缩」
 *   也会显示 compressed=true 而读数看起来正常。
 *
 * ⚠ 不变量：有动作必有账（compressed=true ⇒ beforeChunks > afterChunks **且** savedChars > 0
 *   **且** afterChunks <= capacityChunks —— 第三条 =「末态真回到上界内」）。
 *   只折了但没压回上界（keepRecent 夹住）**不**认 compressed，落回 noop 并报
 *   capacityReached=false / overflowRemaining>0（由既有容量闸继续兜底）。
 *
 * @param chunks   输入快照（**不被修改**）
 * @param capacityChunks 条数上界（<= 0 = 不设闸 ⇒ 不压缩）
 * @param strategy 可选策略
 * @param selector 可选「要保留哪些」的判据；**抛错时走降级**（不压缩 + 留 failure 字段）
 */
export function compressChunks(
  chunks: readonly WorkingChunk[],
  capacityChunks: number,
  strategy: CompressStrategy = {},
  selector?: KeepSelector,
): CompressionResult {
  const beforeChunks = chunks.length
  const beforeChars = chunksChars(chunks)

  // ⚠ **先算溢出量**（必须在 noop 之前）：noop 的所有出口都要如实回报「末态是否仍超上界」，
  //   否则「压了但没够」与「本来就不超」在记账面上又同形。
  const gatedCap = Number.isFinite(capacityChunks) && capacityChunks > 0
  const overCap = gatedCap ? beforeChunks - capacityChunks : 0

  /** 不动作时的统一回执（所有「没压」的出口走它 ⇒ 记账字段不可能漏填）。 */
  const noop = (degraded: boolean, failure: string | null): CompressionResult => ({
    compressed: false,
    beforeChunks,
    afterChunks: beforeChunks,
    beforeChars,
    afterChars: beforeChars,
    savedChars: 0,
    foldedChunks: 0,
    summaryChars: 0,
    degraded,
    failure,
    // 无闸（overCap <= 0）⇒ 没有上界可言，视为已达；有闸且超 ⇒ 如实报未达。
    capacityReached: overCap <= 0,
    overflowRemaining: overCap > 0 ? overCap : 0,
    chunks: chunks.map((c) => ({ ...c })),
    foldSummary: [],
    // I3：没折叠 ⇒ **显式记 0 条 / 0 码点**（不是 undefined、不是省略 ——「输入量须可见化」）。
    folded: [],
    foldedChars: 0,
  })

  // ── 判据①：selector 先跑（可插拔判据面，抛错必须**显式降级**而不是吞掉）──
  // ⚠ 这里**不是** catch { return null }：失败被记进 degraded / failure 两个字段，
  //   且**不压缩**（宁可什么都不做，也不做一个来源不可信的压缩）。
  let keepSeqs: number[] | null = null
  if (selector !== undefined) {
    try {
      const got = selector(chunks)
      // 判据面返回值也要校验：非整数数组一律降级（不静默当成空集）。
      if (Array.isArray(got) && got.every((v) => Number.isInteger(v))) keepSeqs = got
      else return noop(true, 'selector 返回非法值（须为整数 seq 数组）；未压缩')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return noop(true, 'selector 抛错：' + msg + '；未压缩（显式降级，不吞异常）')
    }
  }

  // ── 判据②：容量轴不开闸 / 未超 / 无可折叠空间 ⇒ 不动作（记账如实回 false）──
  // （闸的存在性与溢出量在上面就已算好：`gatedCap` / `overCap` —— 那是 noop 回执要用的读数。）
  if (!gatedCap) return noop(false, null)
  const keepRecent = Math.max(0, strategy.keepRecent ?? 1)
  const over = overCap
  // ⚠ **严格大于才动作**（与两闸边界腿同口径）：恰满容量**不得**压缩 ——
  //   否则「管住了」与「根本没管」在边界点上又会同形。
  if (over <= 0) return noop(false, null)
  // ⚠ 折叠量是 over + 1 而**不是** over：N 条塌成 **1 条**摘要，净减少量 = foldCount - 1
  //   ⇒ 只折 over 条的话末态仍是 (before - over + 1) = capacity + 1，**压完还超一格**。
  //   这条算式是「压缩真的把尺寸带回上界内」的判据（写错就变成「压了但没够」）。
  // ⚠ keepRecent 是**就绪性下限**：至少留这么多条**原文**。两者取小 ⇒
  //   若 keepRecent 卡住（例如要求全留），末态可能**仍高于**容量 —— 那是**如实的部分压缩**，
  //   由既有容量闸（未被本模块改动）继续兜底，本函数**不**假装已经压到上界。
  const foldCount = Math.min(over + 1, Math.max(0, beforeChunks - keepRecent))
  if (foldCount <= 0) return noop(false, null)

  // ── 判据③：selector 若给了保留集，则**只折叠不在保留集里的最旧条目** ──
  //   ⇒ 「哪些步骤还要用」由注入的判据决定；本模块不自作主张。
  const keep = keepSeqs === null ? null : new Set(keepSeqs)
  const candidates = keep === null ? chunks.slice() : chunks.filter((c) => !keep.has(c.seq))
  const head = candidates.slice(0, foldCount)
  if (head.length === 0) return noop(false, null)

  // ⚠ 尾部必须按**身份**排除已折叠项，**不能**写 chunks.slice(head.length)：
  //   selector 保留了前面的某条时，head 与「按长度切片」的尾部会**重叠**
  //   ⇒ 同一条内容既进了摘要、又留在数组里，savedChars 被**虚报**（读数与事实脱钩）。
  const foldedSeqs = new Set(head.map((c) => c.seq))
  const tail = chunks.filter((c) => !foldedSeqs.has(c.seq))
  const droppedChars = chunksChars(head)
  const headFirst = head[0]
  const headLast = head[head.length - 1]
  const firstSeq = headFirst === undefined ? 0 : headFirst.seq
  const lastSeq = headLast === undefined ? 0 : headLast.seq

  // 摘要正文 = **确定性折叠**（不调模型、**不带原文内容** —— 否则「压缩」会原地复活成原文搬运）。
  const prefix = '[折叠 ' + head.length + ' 条 seq ' + firstSeq + '-' + lastSeq + ']'
  const limit = strategy.summaryChars ?? 120
  const body = limit <= 0 ? prefix : truncateCodePoints(prefix, limit)

  // ── 不变量：压缩**不得**让内容变长 ─────────────────────────────────────────
  //   若折叠后反而更长（摘要串比被折掉的头部长），**不压**并如实记账 ——
  //   否则 compressed=true / savedChars<0 会被读成「压住了」。
  const afterChars = chunksChars(tail) + codePointLen(body)
  // ⚠ **判据先于落地**：「字符数真省下」**与**「尺寸真回到容量上界内」两条**同时**成立，
  //   才认 `compressed`。只折了几条但末态仍超上界（keepRecent 就绪性下限夹住折叠量，
  //   实测：容量 1 + 2 条 ⇒ 折 1 留 1，size 仍 2）⇒ 不入落地分支：照报 true 会被调用方
  //   读成「已经压住了」而**不再兜底**（假绿）。此处如实回落 compressed=false +
  //   capacityReached=false + overflowRemaining>0，由既有容量闸继续兜底。
  const afterChunks = tail.length + 1
  if (afterChars >= beforeChars || afterChunks > capacityChunks) return noop(false, null)

  const folded: WorkingChunk = {
    requestId: 'compressed:' + firstSeq + '-' + lastSeq,
    content: body,
    seq: firstSeq,
    at: head[0] === undefined ? '' : head[0].at,
  }
  const out = [folded, ...tail.map((c) => ({ ...c }))]

  return {
    compressed: true,
    beforeChunks,
    afterChunks,
    beforeChars,
    afterChars,
    savedChars: beforeChars - afterChars,
    foldedChunks: head.length,
    summaryChars: codePointLen(body),
    degraded: false,
    failure: null,
    // 走到这里 ⇒ 上面那条判据已保证末态回到上界内（故两值恒为已达/零溢出）。
    capacityReached: true,
    overflowRemaining: 0,
    chunks: out,
    foldSummary: [
      'seq ' + firstSeq + '-' + lastSeq + '：' + head.length + ' 条 / ' + droppedChars +
        ' 码点 ⇒ ' + codePointLen(body) + ' 码点',
    ],
    // I3：逐条定位面（**不含内容原文**）。取 head 原序 ⇒ 与输入同序，判据可逐条对。
    folded: head.map((c) => ({ requestId: c.requestId, seq: c.seq, at: c.at, chars: codePointLen(c.content) })),
    // 与 droppedChars 同源（后者是 head 的码点总和，上面已算过 —— 不各算一遍）。
    foldedChars: droppedChars,
  }
}

// ── 第二层：会话级压缩（五段式交接摘要）───────────────────────────────────────

/**
 * **五段式交接摘要** —— v10 §30.2 第二层原文的五个字段，**逐字**（Goal/Decisions/State/Next/Anchors）。
 *
 * ⚠ 五段**不允许留空/undefined**：本仓既有教训是 undefined 会被 JSON 序列化**静默丢键**
 *   ⇒「判不了」与「判不准」不可分辨（core/src/domain.ts 同源理由）。
 *   故本结构一律用**空数组**而不是 undefined 表示「本段没有内容」。
 */
export interface HandoffSummary {
  Goal: string[]
  Decisions: string[]
  State: string[]
  Next: string[]
  Anchors: string[]
}

/** 五段的**键序真源**（判据与实现共用，避免两处各写一遍字面量而漂移）。 */
export const HANDOFF_KEYS = ['Goal', 'Decisions', 'State', 'Next', 'Anchors'] as const
export type HandoffKey = (typeof HANDOFF_KEYS)[number]

/** 空五段（缺省回执：五键齐全、五段皆空 —— 而不是 undefined）。 */
export const emptyHandoff = (): HandoffSummary => ({
  Goal: [], Decisions: [], State: [], Next: [], Anchors: [],
})

/** 第二层压缩的触发配置。 */
export interface HandoffConfig {
  /**
   * **窗口占用比例阈值**（v10 原文「窗口 80% 触发」⇒ 缺省 0.8）。
   * 取值域 (0, 1]；<= 0 或非有限 ⇒ 该轴不设闸（沿用全仓约定）⇒ 不触发。
   */
  compressAtRatio?: number
  /**
   * 五段式里 **Anchors 最多列几条**（唯一**随会话长度线性增长**的一段 ⇒ 不设上界时
   *   摘要体量会失控，实测 3 条即可让摘要(182) 反超原文(90)）。
   * 缺省 20。`<= 0` ⇒ 该轴**不设上限**（沿用全仓约定）。被省掉的条数记进 `anchorsDropped`。
   */
  maxAnchors?: number
}

/** 第二层压缩的记账（与第一层同构：前后条数/字符数 + 是否触发）。 */
export interface HandoffRecord {
  /** 是否**触发**了压缩（= 当前占用比例 > 阈值）。 */
  triggered: boolean
  /** 当前窗口占用比例（= usedChars / windowChars；无闸时为 null = 无法算）。 */
  ratio: number | null
  /** 阈值（回填，供判据核「配置真生效」）。 */
  threshold: number
  /** 窗口容量（字符口径；回填供判据复核）。 */
  windowChars: number
  /** 压缩前（= 原文）码点数。 */
  beforeChars: number
  /** 压缩后（= 摘要）码点数。 */
  afterChars: number
  /** 摘要本身的码点数（= 交接摘要的体量）。 */
  summaryChars: number
  /**
   * 省下的码点数（= beforeChars - afterChars）。
   * ⚠ **可以为负**：五段摘要在**短会话**上可能比原文**更长**（定位串 + JSON 骨架的开销）。
   *   这里**如实回报负数**，不 clamp 成 0 —— 把「反而更长了」显示成「省了 0」正是
   *   「让失败不可观测」的形态。压得动压不动，读这个数就分辨得出。
   */
  savedChars: number
  /** 摘要是否**真的**比原文短（= savedChars > 0）。判据读它，不看符号。 */
  reduced: boolean
  /** 因超出 `maxAnchors` 而**未列入**摘要的定位条数（记账：不得静默截断）。0 = 未截。 */
  anchorsDropped: number
}

export interface HandoffResult extends HandoffRecord {
  summary: HandoffSummary
  /** 原文**去向**：v10 原文说「原文进分段目录，可回查」——这里如实回报本仓的处置。 */
  retention: 'caller-owned'
}

/**
 * **第二层：会话级压缩** —— 窗口占用超阈值时产出五段式交接摘要。
 *
 * ⚠ **本模块只产摘要，不处置原文**：v10 原文「原文进分段目录，可回查」是**调用方**
 *   的持久化职责（分段落盘归 storage 面，不是本包）。故 retention:'caller-owned' 是
 *   **如实回报**，不是省略 —— 本仓不假装已经把原文落了盘。
 *
 * ⚠ 触发阈值按**比例**（usedChars / windowChars，**严格大于**才触发 —— 与两闸同口径）。
 *   窗口容量是**字符**口径（本仓无 token 面，见文件头「口径差异」）。
 */
export function handoff(
  chunks: readonly WorkingChunk[],
  windowChars: number,
  config: HandoffConfig = {},
): HandoffResult {
  const beforeChars = chunksChars(chunks)
  const threshold = config.compressAtRatio ?? 0.8
  // <= 0 或非有限 = 该轴不设闸 ⇒ 无法算比例 ⇒ 不触发（不是「一律触发」）。
  const gated = Number.isFinite(windowChars) && windowChars > 0 &&
    Number.isFinite(threshold) && threshold > 0
  const ratio = gated ? beforeChars / windowChars : null
  const triggered = ratio !== null && ratio > threshold

  // 未触发 ⇒ 五段仍然齐全（空数组），不返回 undefined（防静默丢键）。
  if (!triggered) {
    return {
      triggered: false, ratio, threshold, windowChars, beforeChars,
      afterChars: beforeChars, summaryChars: 0, savedChars: 0, reduced: false,
      anchorsDropped: 0, summary: emptyHandoff(), retention: 'caller-owned',
    }
  }

  // 五段**全部由 chunks 确定性派生**（不调模型）。
  const summary = emptyHandoff()
  const first = chunks[0]
  const last = chunks[chunks.length - 1]
  // Goal：本仓没有 goal 字段 ⇒ 如实置这段的**定位串**，不编造目标文本。
  if (first !== undefined) summary.Goal.push('req:' + first.requestId)
  if (last !== undefined) summary.State.push('末条 req:' + last.requestId + ' seq:' + last.seq + ' at:' + last.at)
  summary.State.push(chunks.length + ' 条 / ' + beforeChars + ' 码点')
  // Anchors = 可回查的**定位面**（逐条的 requestId + seq）。
  // ⚠ 这是唯一**随长度线性增长**的一段 ⇒ 必须受 maxAnchors 约束，否则摘要会反超原文
  //   （实测：3 条 × 30 码点 = 90 字原文，摘要 182 字 = 「压缩」把窗口顶得更大）。
  //   被省掉的**逐条记账**（anchorsDropped），不静默截断。
  const maxAnchors = config.maxAnchors ?? 20
  const anchorsAll = chunks.map((c) => 'req:' + c.requestId + '#seq:' + c.seq)
  const anchorsKept = maxAnchors <= 0 ? anchorsAll : anchorsAll.slice(0, maxAnchors)
  for (const a of anchorsKept) summary.Anchors.push(a)
  const anchorsDropped = anchorsAll.length - anchorsKept.length
  // Decisions / Next 在本包**没有真源**（决策归 scheduler、下一步归 goal 栈）⇒ **保持空数组**，
  //   不填占位符（填了就与「真有决策」不可分辨 —— 那正是本仓最忌的形态）。
  const afterChars = codePointLen(JSON.stringify(summary))

  return {
    triggered: true, ratio, threshold, windowChars, beforeChars, afterChars,
    summaryChars: afterChars, savedChars: beforeChars - afterChars,
    reduced: beforeChars > afterChars, anchorsDropped,
    summary, retention: 'caller-owned',
  }
}

// ── 第三层：长期记忆注入 ──────────────────────────────────────────────────────

/** 第三层注入的记账。 */
export interface InjectPlanRecord {
  /** 是否**真的**发生了丢弃或截断（true = 有内容因超预算而没进注入面）。 */
  truncated: boolean
  /** 注入内容条数（= 存活条数；退化情形下为 1，绝不为 0 —— 就绪性下限）。 */
  injected: number
  /** 因超预算被**整体丢弃**的条数（记账：不得静默丢）。 */
  droppedChunks: number
  /** 被整体丢弃条目的码点数（与 droppedChunks 配对：丢几条 / 丢多少字）。 */
  droppedChars: number
  /** 因超预算被**截掉**的码点数（作用在存活的那条上；与整体丢弃**分账**）。 */
  truncatedChars: number
  /**
   * 参与判定的码点数（存活条 + 被丢条 + 被截掉量），按**条内容码点求和**计
   * （与 snapshot().chars / chunksChars 同一口径）。
   * ⚠ **恒等式（判据直接断言）**：beforeChars === afterChars + droppedChars + truncatedChars。
   *   这条恒等式是「记账不漏不重」的机检点 —— 少了它就是「读数与事实脱钩」。
   */
  beforeChars: number
  /** 存活条目的码点数（同上口径，**不含**拼接分隔符）。 */
  afterChars: number
  /** 实际注入文本的码点数（**含**分隔符）—— 与 afterChars 并列，口径不同故分开报。 */
  renderedChars: number
  /** 本次实际生效的预算（回填，供判据核「配置真生效」）。 */
  budgetChars: number
}

export interface InjectPlanResult extends InjectPlanRecord {
  /** 待注入的文本（按序拼接；空预算 ⇒ 空串，仍有完整记账）。 */
  content: string
  /** 因超预算被丢弃的条目（**保留身份**，供调用方回查/落盘，而不是无声消失）。 */
  dropped: WorkingChunk[]
}

/**
 * **第三层：长期记忆注入** —— 按预算挑选要注入的内容。
 *
 * ⚠ 预算口径是**字符**（本仓判据），**不是 token**；缺省 2000 **字符**。
 *   v10 原文写「< 2000 token」—— 二者**不可互相换算冒充**（见文件头「口径差异」）。
 *
 * 语义（与两闸同族）：
 *   · budgetChars <= 0 ⇒ 该轴**不设闸**（无上限）⇒ 全注入、零丢弃。
 *   · 超预算 ⇒ **从最旧的开始丢**（保最新 —— 与两闸「保最新、弃最旧」同构），
 *     并**逐条记账**（droppedChunks / droppedChars），被丢条目**原样留在 dropped** 里。
 *   · 严格大于才动作（恰满预算不丢 —— 与两闸边界同口径）。
 */
export function injectPlan(
  chunks: readonly WorkingChunk[],
  budgetChars: number,
): InjectPlanResult {
  const beforeChars = chunksChars(chunks)
  const noGate = !Number.isFinite(budgetChars) || budgetChars <= 0

  if (noGate || beforeChars <= budgetChars) {
    const content = chunks.map((c) => c.content).join(INJECT_JOIN_SEP)
    return {
      truncated: false, injected: chunks.length, droppedChunks: 0, droppedChars: 0,
      truncatedChars: 0, beforeChars, afterChars: beforeChars,
      renderedChars: codePointLen(content), budgetChars,
      content, dropped: [],
    }
  }

  // 超预算 ⇒ 保最新、弃最旧，直到 <= budgetChars（与预算闸同一收敛方式：重新评估 total）。
  const kept: WorkingChunk[] = []
  const dropped: WorkingChunk[] = []
  let total = beforeChars
  for (const c of chunks) {
    if (total <= budgetChars) { kept.push(c); continue }
    dropped.push(c)
    total -= codePointLen(c.content)
  }

  // 退化情形：逐到一条不剩仍超预算 ⇒ **截断最新那条**（保**就绪性下限** = 至少留 1 条，
  //   与预算闸「只剩一条时截断而非逐出」同一条理由：漏填配置不得退化为静默全丢）。
  //
  // ⚠ 上一版在这里**记了两笔账**：既把该条放进 `dropped`，又把它截断后放进 `kept` ⇒
  //   `droppedChars` 虚报（同一条内容既算「丢了」又算「留了」），且恒等式不成立。
  //   现在改成：该条**从 dropped 里取回**（不再算整体丢弃），只把**截掉的部分**记进 truncatedChars。
  let content: string
  let truncatedChars = 0
  if (kept.length === 0 && chunks.length > 0) {
    const last = dropped.pop()
    if (last !== undefined) {
      const orig = codePointLen(last.content)
      const body = truncateCodePoints(last.content, budgetChars)
      kept.push({ ...last, content: body })
      truncatedChars = orig - codePointLen(body)
      content = body
    } else {
      content = ''
    }
  } else {
    content = kept.map((c) => c.content).join(INJECT_JOIN_SEP)
  }

  const droppedChars = dropped.reduce((n, c) => n + codePointLen(c.content), 0)
  const afterChars = chunksChars(kept)
  // 恒等式自检（**代码里不 assert**：本模块是纯函数面，抛错会让调用方炸；
  //   这里只在**不成立时如实记进 truncated** 无法表达 ⇒ 故由判据面断言，
  //   见 tests/compression.test.mjs 的「记账恒等式」腿。此处保留算式供逐字核对）。
  return {
    truncated: true,
    injected: kept.length,
    droppedChunks: dropped.length,
    droppedChars,
    truncatedChars,
    beforeChars,
    afterChars,
    renderedChars: codePointLen(content),
    budgetChars,
    content,
    dropped: dropped.map((c) => ({ ...c })),
  }
}

// ── I3：折叠账本（「压缩后不永久沉默」的**观测点**）────────────────────────────
//
// ## 为什么需要这一层（记账字段**不够**）
//   CompressionResult.folded 只说明「这一次压了谁」。它回答不了 I3 真正要问的那句：
//   **【被折叠的那些，还能不能被找回】。** 同一条 req-1，在「压根没压过」与「压过、
//   定位面仍在账上」与「压过、但账目已被逐出」三种处境下，**读同一个 result 是同形的**
//   —— 正是本仓首位缺陷类（「压缩生效」与「内容被丢弃」同形）。
//   ⇒ 故此处把「被折条的**命运**」升成一等公民：一个**有界**、**逐出留痕**、**三态可判别**
//     的账本。它与 attention 的 I2 三件套同构（判据 + 假绿防护 + 逐出留痕）。
//
// ## 三态（`FoldBasis`）—— 三者**不得同形**
//   `never-folded`     ：账是空的 ⇒ 没有条目处于「被折叠」处境（**不是**「丢了」）。
//   `folded-locatable`：条目的定位面**仍在账上** ⇒ 足以回查（requestId/seq/at/码点数）。
//   `folded-evicted`  ：条目的定位面**已被逐出** ⇒ 本进程再也答不出它去了哪（**如实报**）。
//   ⚠ 判别是**内容无关**的：只看 requestId（或 seq），不看账目里有没有内容副本。
//
// ## ⚠ 逐出「不清空账」——与 attention I2 的处置**故意不同**（这里说清为什么）
//   attention 在上界逐出时把 `injectedRequests` **清空**（因为搬回来会让无界集合复活，
//   上界就白设了）。本账本**不**走那条路：它的 key 是 requestId，逐出后若清空，则
//   「压过、账目已逐出」与「压根没压过」立刻又同形 —— 恰是 I3 要消灭的形态。
//   ⇒ 这里逐出**只丢明细、不丢身份**：把被逐条目的 requestId/seq/chars 压进一个
//     **有界**的墓碑环（`evictedRefs`），于是「已丢」是一个**可数、可读、可判**的事实。
//     代价如实报：墓碑环自身也有界，**二次**逐出的条目连墓碑都进不去，被计入
//     `evicted`（总逐出数）—— 该情形下基础探针回落 `never-folded`，
//     但「本账本逐出过 N 条」在读数上仍看得见（不静默）。
//
// ## 内存代价（写清楚，不假装免费）
//   账本上界 `ledgerMax`（缺省 64，可配）。每项存 requestId/seq/at + 两枚数字，
//   **不存 content**（本模块从不持有原文，账本不给自己开豁免）。64 项是常数级。

/** 折叠账本的一个条目（定位面；**不含内容原文**）。 */
export interface FoldLedgerEntry extends FoldedRef {
  /** 进入账本时刻（账本自身的记账；`at` 是被折条的时刻，两者不可混）。 */
  foldedAt: string
}

/** 折叠账本的逐出墓碑（明细已被上界淘汰，但「丢过」这件事仍在账上）。 */
export interface FoldEvictionMark {
  /** 被逐出条目的 seq（**身份**，不是明细）。 */
  seq: number
  /** 被逐出条目的 requestId（同上）。 */
  requestId: string
  /** 被逐出条目自身的码点数（丢了多少字，与「丢了几条」配对）。 */
  chars: number
}

/** 折叠账本的读数（**I3 的观测点**：一次调用即可分辨三态与逐出代价）。 */
export interface FoldLedgerView {
  /** 账本**当前**状态（空账 ⇒ never-folded）；逐条命运判别走 foldProbe()，两者分工不同。 */
  basis: FoldBasis
  /** 账本里当前可回查的条目数。 */
  locatable: number
  /** **逐出墓碑**里的条目数（>0 ⇒ 「曾被折叠、现已查不到」的条目至少这么多 —— 逐出留痕）。 */
  evictedLocatableMisses: number
  /** 账本**累计**逐出条目数（含二次逐出、连墓碑都没进的；与上一条配对）。 */
  evicted: number
  /** 账本上界（回填，供判据核「配置真生效」）。 */
  ledgerMax: number
  /** 逐出墓碑（有界 FIFO，供逐条核对；**不含内容原文**）。 */
  evictedRefs: FoldEvictionMark[]
  /** ledgerFold 的累计调用次数（0 与「从没折过」可分辨）。 */
  calls: number
  /** 「同一 requestId 又一次被折叠」的累计次数（全量，不随窗口滑动）。 */
  reencounters: number
}

/**
 * 「被折条**还能不能被找回**」的判别基（三态；见本文件 I3 一节）。
 * 判别只看**身份**（requestId），**不看内容** —— 本模块不持有内容副本，
 * 故「可取回」严格指**定位面可取回**（凭它回原始留存面取原文）。
 */
export type FoldBasis = 'never-folded' | 'folded-locatable' | 'folded-evicted'

/**
 * 折叠账本上界（项；超出按**最旧**逐出并**留墓碑**）。读数见 FoldLedgerView.ledgerMax。
 *
 * ⚠ 与 attention 的 `MAX_SESSION_STATES` 同族的**模块常量**，**不**做成配置键：那个数是
 *   「内存代价的上界」，不是语义旋钮（attention 的 `maxFocusItems` 才是旋钮）。做成配置键
 *   会往部署面加一格需要整仓核验的配置 —— 收益为零。
 */
export const MAX_FOLD_LEDGER_ENTRIES = 64

/** 逐出墓碑环的上界（项）—— 独立的第二道有界，防「账清空了却把身份留成无界集」。 */
export const FOLD_EVICTION_MARKS_MAX = 32

/** 账本内部状态（`ledgerFold` 的入参；由服务面持有）。 */
export interface FoldLedgerState {
  /** 当前可回查条目（插入序 = 折叠序，首个键即最旧）。 */
  readonly entries: Map<string, FoldLedgerEntry>
  /** 逐出墓碑（FIFO，上界 FOLD_EVICTION_MARKS_MAX）。 */
  readonly evictedRefs: FoldEvictionMark[]
  entriesEvicted: number
  marksEvicted: number
  calls: number
  reencounters: number
}

/** 造一份空账本状态（服务面在 apply() 里调一次；判据直装配纯函数时也用它）。 */
export const makeFoldLedger = (): FoldLedgerState => ({
  entries: new Map(),
  evictedRefs: [],
  entriesEvicted: 0,
  marksEvicted: 0,
  calls: 0,
  reencounters: 0,
})

/**
 * 探测一批被折条的**命运**（三态判别；**逐条点名**，绝不因一条命中就替全批作答）。
 *
 * ⚠ 逐条的理由（本仓既有教训：同名灌水会数出假"多"）：若实现成「有一个命中 ⇒ 整批报
 *   可取回」，判据面会永远绿、也永远骗人。故没命中且不在墓碑里的那条如实回落 never-folded。
 */
export function foldProbe(
  state: FoldLedgerState,
  refs: readonly { requestId: string }[],
): FoldBasis {
  if (refs.length === 0) return 'never-folded'
  const tombstoned = new Set(state.evictedRefs.map((m) => m.requestId))
  let allLocatable = true
  let anyRecentlyEvicted = false
  for (const r of refs) {
    if (state.entries.has(r.requestId)) continue
    allLocatable = false
    if (tombstoned.has(r.requestId)) anyRecentlyEvicted = true
  }
  if (allLocatable) return 'folded-locatable'
  // ⚠ 「已丢」与「从没折过」**都**是"账上查不到"，故必须靠墓碑把两者分开：
  //   墓碑命中 ⇒ 确曾折叠、现已查不到；墓碑也没命中 ⇒ 本账本对此身份一无所知。
  return anyRecentlyEvicted ? 'folded-evicted' : 'never-folded'
}

/**
 * **把一次折叠记进账本**（I3 的核心入口；服务面的 `foldLedger()` 调它）。
 *
 * 语义（与两闸同族的「严格大于才动作」）：
 *   · `refs` 为空 ⇒ **不动作**，但 `calls` 仍 +1（「跑过但没折」与「从没跑过」可分辨）。
 *   · 每条 ref 入账前**先探**：账上已有同 requestId ⇒ `reencounters` +1（旧读数作废，
 *     见 FoldLedgerView.basis 的 ⚠）。
 *   · 入账后若超上界 ⇒ **按最旧逐出**，且被逐条目**必须**落墓碑（逐出留痕；否则
 *     「已丢」会退化成与「没压过」同形 —— 那正是本账本存在的理由）。
 *   · `now` 显式传参（不把 `new Date()` 藏在里面）：判据可复现，注入侧也不必信墙钟。
 *
 * @param state  账本状态（本函数**就地**改它，与两闸「就地改 chunks」同风格）
 * @param refs   本次被折叠的条目（取 CompressionResult.folded）
 * @param ledgerMax 上界（项）；`<= 0` = 不设上界（沿用全仓「<=0 = 不设闸」约定）
 * @param now    本次折叠的时刻（ISO 串；由调用方给，函数不读墙钟）
 */
export function ledgerFold(
  state: FoldLedgerState,
  refs: readonly FoldedRef[],
  ledgerMax: number,
  now: string,
): void {
  state.calls += 1
  if (refs.length === 0) return

  for (const r of refs) {
    // 重遇探测（在覆盖之前做）：同一身份又一次被折叠 ⇒ 记数（全量口径）。
    if (state.entries.has(r.requestId)) state.reencounters += 1
    // 重新入账 ⇒ 它**同时**从墓碑里撤销（身份又回到"可取回"一侧，判别不得自相矛盾）。
    const tomb = state.evictedRefs.findIndex((m) => m.requestId === r.requestId)
    if (tomb >= 0) state.evictedRefs.splice(tomb, 1)
    state.entries.set(r.requestId, {
      requestId: r.requestId, seq: r.seq, at: r.at, chars: r.chars, foldedAt: now,
    })
  }

  const gated = Number.isFinite(ledgerMax) && ledgerMax > 0
  if (!gated) return
  while (state.entries.size > ledgerMax) {
    const oldest = state.entries.entries().next()
    if (oldest.done === true) break
    const [key, entry] = oldest.value
    state.entries.delete(key)
    state.entriesEvicted += 1
    // 逐出留痕（**必做**）：明细丢了，身份必须留下，否则三态判别立刻退化。
    state.evictedRefs.push({ seq: entry.seq, requestId: entry.requestId, chars: entry.chars })
    while (state.evictedRefs.length > FOLD_EVICTION_MARKS_MAX) {
      state.evictedRefs.shift()
      state.marksEvicted += 1
    }
  }
}

/** 账本读数（**单一来源**：服务面与判据都取它，不各拼一遍 —— 「读数与事实脱钩」的母形）。 */
export function foldLedgerView(state: FoldLedgerState, ledgerMax: number): FoldLedgerView {
  return {
    basis: state.entries.size === 0 ? 'never-folded' : 'folded-locatable',
    locatable: state.entries.size,
    evictedLocatableMisses: state.evictedRefs.length,
    evicted: state.entriesEvicted,
    ledgerMax,
    evictedRefs: state.evictedRefs.map((m) => ({ ...m })),
    calls: state.calls,
    reencounters: state.reencounters,
  }
}
