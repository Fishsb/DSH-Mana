/**
 * 真端点判据的**归因读数**（口径文档：docs/mana-endpoint-attribution.md）。
 *
 * ## 这个模块解决什么
 *   真端点判据（本机 Ollama）红的时候，读者原先要**自己翻**断言文案里那串 reason，
 *   才知道「是**测量环境**坏了」还是「是**被测代码**坏了」。本模块把这件事做成**结构化读数**：
 *   三类的**类别名 / 判定语 / 下一步动作 / 诊断字段**都不同形，一眼可辨。
 *
 * ## 两条红线（本模块**不**触碰）
 *   ① **不 skip**：不引入 t.skip / 静默 return / 条件包用例。环境不可用仍是**红**，
 *      期望值仍恒为 false —— 与改前的 assert.equal(probe.degraded, false, ...) **逐字同义**。
 *   ② **不改被测读数**：本模块只产出**文案与类别**；被断言的字段与期望值一字未动。
 *
 * ## 不做什么
 *   · **不自己发请求**：只读调用方 pass 进来的那一份读数（"一次真端点请求都不发"是本仓
 *     既有的硬约束，见 packages/vector/tests/embed-unsupported.test.mjs 的 J1-⓪ 自检）。
 *   · **不另立失败判据**：归类只复用被测面已有的 failureKind 与语义特征识别原语
 *     （unsupportedMarkerIn 直接 import 自 src/embed.ts，不抄第二份特征串）。
 *
 * ## 三态（**前两者都仍然是红**，区别只在文案与诊断）
 *   | 类别 | 何时 | 下一步动作 | 本模块给出的读数 |
 *   |---|---|---|---|
 *   | env-unavailable | 传输出错 / 端点不可达 / 超时 / 服务端明确回"不支持嵌入" | 查**测量环境** | 红 |
 *   | behavior-wrong  | 环境已应答且格式合法，读数仍不达 | 查**被测代码** | 红 |
 *   | ok              | 测量条件成立且读数达 | 无 | 绿 |
 *
 * ⚠ 一个命名陷阱（**本卡实测过**）：向量管道里也有一个同名概念 degraded，那是**被测面**的
 *   契约字段（A1-11 口径），**不是**本模块的"环境态"。本模块的输入里，
 *   degraded === true 只表示"这一次真调用没拿到可用应答"（环境态），两者**不得混读**。
 */
import assert from 'node:assert/strict'
import { unsupportedMarkerIn } from '../src/embed.ts'

/** 三态的类别名（可枚举、可机检；取值只增不改义）。 */
export const LIVE_ENDPOINT_CLASSES = ['env-unavailable', 'behavior-wrong', 'ok']

/** 环境态的下一步动作（写成常量，避免各判据各写一句而漂移）。 */
export const ENV_NEXT_ACTION =
  '查**测量环境**：宿主 Ollama 是否在跑 · 端点是否指对 · 该服务是否以 --embeddings 启动 · 所选模型是否具嵌入能力' +
  '（这一条**不是**被测代码的问题，别去翻被测面）'

/** 行为态的下一步动作。 */
export const CODE_NEXT_ACTION =
  '查**被测代码**：测量环境已应答且格式合法，读数却不对 ⇒ 缺陷在被测面（这一条**不是**环境问题，别去重启服务）'

/** 通过态无需动作。 */
export const OK_NEXT_ACTION = '无需动作（测量条件成立，且被测读数达）'

/** 把一条读数摊平成**固定字段面**（三态共用同一把标尺 ⇒ 诊断可对拍、可 grep）。 */
export function liveReadingText(reading) {
  const parts = [
    '端点=' + (reading.baseUrl || '(未给)'),
    'model=' + (reading.model || '(未给)'),
    'degraded=' + String(reading.degraded),
    'failureKind=' + String(reading.failureKind ?? 'null'),
    'ms=' + String(reading.ms ?? '?'),
  ]
  if (reading.vectorCount !== undefined) parts.push('vectors=' + String(reading.vectorCount))
  if (reading.unsupportedMarker) parts.push('服务端原话命中语义特征「' + reading.unsupportedMarker + '」')
  if (reading.reason !== null && reading.reason !== undefined) parts.push('reason=' + reading.reason)
  return parts.join(' · ')
}

/**
 * 环境态**具体是哪一种**（这一句是"读者不必翻 reason"的落点）。
 * ⚠ 判定只复用两个既有原语：被测面的 failureKind + src/embed.ts 的语义特征识别。
 */
export function envUnavailableWhy(reading) {
  if (reading.degraded !== true) return null
  const marker = reading.reason ? unsupportedMarkerIn(reading.reason) : null
  if (marker) {
    return '服务端**明确回**「本服务不支持嵌入」（命中语义特征「' + marker + '」）⇒ 处置方向是**服务端启动参数或模型能力**'
  }
  if (reading.failureKind === 'unsupported-by-server') {
    return '被测面归类为 unsupported-by-server ⇒ 处置方向是**服务端启动参数或模型能力**'
  }
  return '传输出错 / 端点不可达 / 超时（这一次调用没拿到可用应答）'
}

/** **三态判定**：只读入参，不自己发请求、不另立失败判据。 */
export function classifyLiveEndpoint(reading, opts = {}) {
  const expects = opts.expects ?? 'vectors'
  if (reading.degraded === true) {
    return { cls: 'env-unavailable', verdict: '环境不可用', why: envUnavailableWhy(reading), next: ENV_NEXT_ACTION }
  }
  if (expects === 'vectors' && !(reading.vectorCount > 0)) {
    return {
      cls: 'behavior-wrong',
      verdict: '环境可用但被测行为不对（应答里没有向量）',
      why: '端点已应答且格式合法，但 vectors 为空',
      next: CODE_NEXT_ACTION,
    }
  }
  return { cls: 'ok', verdict: '正常通过', why: '端点应答且读数达', next: OK_NEXT_ACTION }
}

/** 归因文案：读者读**这一行**即可知道「是哪一种」+「下一步查什么」。 */
export function attributionText(reading, opts = {}) {
  const c = classifyLiveEndpoint(reading, opts)
  const title = opts.title || '真端点读数'
  return (
    '[live-endpoint · ' + c.cls + '] ' + title + '｜' + c.verdict + '：' + c.why +
    '｜实测：' + liveReadingText(reading) + '｜下一步：' + c.next
  )
}

/**
 * 环境**已应答**之后仍不达的读数 ⇒ **行为面**红（读者不会两处都去查 Ollama）。
 *
 * ⚠⚠ **调用纪律（2026-09-27 复验退回的根因，务必先读）**：
 *   「端点层前置探测刚通过」**不等于**「这一次调用拿到了可用应答」——
 *   本席复验实测：前置通过后，真调用仍可能被负载拖到 **30s 超时**
 *   （\`latencyMs=30001 · aborted due to timeout\`）。
 *   若此时用本函数，就会把**一个环境性超时**标成「行为不对 ⇒ 去查代码」，还附一句
 *   「别去重启服务」—— **归因错位**，正是本卡要治的病，只是换了个方向（实测形态）。
 *
 * ⇒ **凡是本函数展示的读数来自一次真调用，就必须把那份读数传进来（第 3 参 \`reading\`）**：
 *   本函数会**先过分类器**——读数实为 env-unavailable（不可达/超时/服务端不支持）时，
 *   自动改说环境态的话、点「查测量环境」。
 *   不传 \`reading\`（纯自造 detail 的补强断言）时，调用方必须**在同一表达式里**已由
 *   \`assertLiveEmbed/assertLiveService\` 证明过该读数是"应答且合法"。
 */
export function behaviorWrongText(title, detail, reading) {
  if (reading) {
    const c = classifyLiveEndpoint(reading)
    if (c.cls === 'env-unavailable') {
      // 读数其实是环境态 ⇒ **不许**说成行为错（这就是被退回的那条缺陷）
      return '[live-endpoint · env-unavailable] ' + title + '｜**读数实为环境态，不是行为错**｜' + c.why +
        '｜实测：' + liveReadingText(reading) + '｜下一步：' + c.next
    }
  }
  return '[live-endpoint · behavior-wrong] ' + title + '｜环境可用但被测行为不对｜实测：' + detail + '｜下一步：' + CODE_NEXT_ACTION
}

/** 按读数**分类后**再落断言：读数不达时的文案由分类器决定，不由调用点猜。 */
export function assertLiveReading(reading, opts = {}) {
  assert.equal(reading.degraded, false, attributionText(reading, opts))
  return reading
}

/** 真端点**服务面**（jev 聊天通道）的统一入口：与 \`assertLiveEmbed\` 同一把标尺、同一分类器。 */
export function assertLiveService(outcome, opts) {
  return assertLiveReading(readLiveService(opts.baseUrl, opts.model, outcome), opts)
}

/** 把一次 svc.embed() 的返回信封 + 环境事实（端点 / model）拼成**同一把标尺**上的读数。 */
export function readLiveEmbed(baseUrl, model, outcome) {
  const vectors = Array.isArray(outcome && outcome.vectors) ? outcome.vectors : []
  return {
    baseUrl: (outcome && outcome.baseUrl) || baseUrl,
    model: (outcome && outcome.model) || model,
    degraded: Boolean(outcome && outcome.degraded === true),
    failureKind: (outcome && outcome.failureKind) ?? null,
    reason: (outcome && outcome.reason) ?? null,
    ms: outcome ? outcome.ms : undefined,
    vectorCount: vectors.length,
    dims: vectors.map((v) => (v ? v.length : 0)),
  }
}

/** jev 侧（聊天通道）用的同形读数：字段面与 embed 侧一致，只是没有 vectors 概念。 */
export function readLiveService(baseUrl, model, outcome) {
  return {
    baseUrl: (outcome && outcome.baseUrl) || baseUrl,
    model: (outcome && outcome.model) || model,
    degraded: Boolean(outcome && outcome.degraded === true),
    failureKind: null,
    reason: (outcome && outcome.reason) ?? null,
    ms: outcome ? outcome.latencyMs : undefined,
  }
}

/**
 * 真端点判据的**统一入口**（可达性那一腿）：断言 + 归因文案。
 *
 * ⚠ 期望值恒为 false，与改前的 assert.equal(probe.degraded, false, ...) **逐字同义**：
 *   本函数**只换文案与类别，不换判据** —— 环境不可用与代码缺陷**都是红**，一次 skip 都不引入。
 * ⚠ 不用 assert.fail：本模块**不是**真通道凭据判据，不受 gate-checks 的 assert.fail 面约束
 *   （那是 jev live 文件的形态；本模块若用 assert.fail 反而与"断言读数"混形）。
 */
export function assertLiveEmbed(outcome, opts) {
  assertLiveReading(readLiveEmbed(opts.baseUrl, opts.model, outcome), opts)
  return outcome
}
