/**
 * 信号词预筛（v10 §12.3）—— **零 LLM 成本**的第一道门。
 *
 * ── 为什么这里需要它（它补的是哪个缺口）────────────────────────────────────────
 * v10 附录 A 把 `dsh-mana-perception` 的职责写成「输入采集、**信号词预筛**、内在奖励」，
 * 而本仓 2026-09-26 实测：perception 只有采集 + 分块，**信号词预筛零落点**（全仓 grep 无命中）。
 *
 * 后果**不是"少一个优化"**，而是一条可实测的错误归因链（本席亲测，见 HANDOFF）：
 *   缺了本环 ⇒ 所有观察**无条件**流到 long-term 的 Write Gate ⇒ 那道门拿"观察文本"与
 *   **判定问法本身**（`'这条观察值得长期记住吗'`）比 bigram ⇒ 于 8 条真实风格内容实测
 *   **放行率仅 1/8** ⇒ memory_items 几乎不生长 ⇒ 评估面 L4 恒 NO_DATA。
 *   ⚠ 更大的问题：`1/8` 这个读数**看起来像"系统效果差"**，实际是**层级错位**
 *     —— 该在 perception 做的粗筛被放到了 Write Gate，而 Write Gate 的词表按设计就是问法派生。
 *
 * ── 本模块做什么 / 不做什么 ───────────────────────────────────────────────────
 *   · **做**：把观察按「是否含值得记住的信号」粗筛，返回**三态**读数（命中/未命中/空文本）；
 *   · **不做判定**：它**不**决定"这条记忆值不值得留"（那是 Write Gate 的 JEV 判定）。
 *     本模块只回答「**是否值得进判定**」—— 挡下的是"明显是寒暄/命令/短指令"这类，
 *     而不是"判了但不够格"。
 *   · **不零成本骗人**：命中与否由**纯函数**给出，且**逐条可解释**（命中了哪些词）。
 *
 * ── 与 Write Gate 的 bigram 预过滤的关系（**两件不同的事，不许互相冒充**）──────────
 *   | | 本环（perception 信号词预筛） | Write Gate 的 bigram 预过滤 |
 *   |---|---|---|
 *   | 词表来源 | **信号词表**（跨会话可复用经验/决策/偏好等语义信号） | **判定问法本身**的 bigram |
 *   | 判什么 | "是否值得**进判定**" | "是否值得**花一次模型往返**" |
 *   | 层级 | 前五识（采集侧粗筛） | 编码链第 ④ 步（判定侧） |
 *   ⚠ 二者**都保留**：本环挡下的大量无关输入**根本不进** Write Gate，使后者那道 bigram 过滤
 *     只面对"已经像信号"的文本；反过来，Write Gate 的过滤仍能挡下"像信号但问法不匹配"的。
 *     把二者合并成一道是**错的**（会把两个层级的语义焊死 —— 本仓对该形态有明确教训）。
 *
 * ── 扩展面（**预留**，不是"以后再说"）─────────────────────────────────────────
 *   ① 词表来源：现为**内置常量**（`DEFAULT_SIGNAL_WORDS`）。接口已按"可替换词表"设计
 *      （`SignalWordTable`），后续接"从记忆库学到的词表"（v10 的 `distillation_log.signal_words`
 *      列已在 schema 侧预留）时**不需要改调用方**。
 *   ② 领域词：`extraSignals` 配置项允许按部署注入领域词，不必改源码。
 *   ③ 打分制：现为**命中即过**（布尔）。`SignalVerdict` 已带 `hits` 数组与 `score`，
 *      后续要改成"多档阈值"（如 v10 §12.4 的内在奖励调制）时，**读数结构不用变**。
 */
import { DEFAULT_SIGNAL_WORDS } from './signal-words.ts'

/** 词表形态：只管"给一段文本返回命中的信号词"，实现可替换（内置 / 配置注入 / 将来从库学）。 */
export interface SignalWordTable {
  /** 表的**名字**（进读数，使"用的哪张表"可分辨 —— 两张表同表不同词是两件事）。 */
  readonly name: string
  /** 表内全部词（只读快照）。 */
  readonly words: readonly string[]
}

/** 预筛读数的**三态**（缺一即"没测"与"没命中"同形）。 */
export type SignalVerdict =
  | {
      readonly state: 'hit'
      readonly hits: readonly string[]
      readonly score: number
      readonly table: string
    }
  | {
      readonly state: 'miss'
      readonly hits: readonly []
      readonly score: 0
      readonly table: string
      /** 读数里**必须**能回答"为什么没中"：文本长度与词表大小。 */
      readonly textChars: number
      readonly tableSize: number
    }
  | {
      readonly state: 'empty'
      readonly hits: readonly []
      readonly score: 0
      readonly table: string
      /** 空文本是**第三种事实**：既不是"不重要的输入"，也不是"筛过了"。 */
      readonly reason: string
    }

/** 内置词表（`DEFAULT_SIGNAL_WORDS` 的直接投影；名字进读数）。 */
export const BUILTIN_SIGNAL_TABLE: SignalWordTable = Object.freeze({
  name: 'builtin',
  words: DEFAULT_SIGNAL_WORDS,
})

/** 合并词表：内置 + 部署注入的领域词（去重；名字随之改动，使"用了哪张表"可分辨）。 */
export function mergeSignalTables(extra: readonly string[] = []): SignalWordTable {
  const merged = [...new Set([...DEFAULT_SIGNAL_WORDS, ...extra.filter((x) => typeof x === 'string' && x.length > 0)])]
  if (merged.length === DEFAULT_SIGNAL_WORDS.length) return BUILTIN_SIGNAL_TABLE
  return Object.freeze({ name: 'builtin+' + String(extra.length), words: Object.freeze(merged) })
}

/**
 * 信号词预筛（**纯函数**，可单独判据）。
 *
 * ⚠ **大小写不敏感**：英文信号词（`remember` / `prefer` / `decide`）在句首会大写，
 *   若按原样匹配则"Remember this"恒不中 —— 那会让词表在**一半真实输入**上失效，
 *   而失效表现为"没命中"（与"确实无关"同形）。故统一归一后再匹配。
 *
 * ⚠ **不做分词**：中文无空格，按 `includes` 子串匹配是**有意**的（本仓不引入分词器：
 *   分词器是外部依赖 + 语言强绑定，而信号词表本身是可替换的）。代价如实记：
 *   子串匹配会把"记住吧"与"记住"都算命中（这是**想要的**），但也可能跨词误中
 *   （如"不计较"含"计较"）—— 对**粗筛**而言可接受，且误中的后果只是"进了判定"
 *   （多花一次模型往返），**不是**"错失了该记的东西"。
 */
export function prefilterBySignalWords(text: string, table: SignalWordTable = BUILTIN_SIGNAL_TABLE): SignalVerdict {
  const src = String(text ?? '')
  if (src.trim().length === 0) {
    return { state: 'empty', hits: [], score: 0, table: table.name, reason: '空文本/纯空白：无可筛内容（**不是**"不重要"）' }
  }
  const hay = src.toLowerCase()
  const hits: string[] = []
  for (const w of table.words) {
    const needle = String(w).toLowerCase()
    if (needle.length === 0) continue
    if (hay.includes(needle)) hits.push(w)
  }
  if (hits.length === 0) {
    return {
      state: 'miss',
      hits: [],
      score: 0,
      table: table.name,
      textChars: src.length,
      tableSize: table.words.length,
    }
  }
  return { state: 'hit', hits, score: hits.length, table: table.name }
}
