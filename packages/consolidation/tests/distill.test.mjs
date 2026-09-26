/**
 * 会话蒸馏链判据（v10 §12.3）—— **本卡的核心判据在本文件第 ① 组**。
 *
 * ── 为什么这条判据必须存在（它防的是什么）──────────────────────────────────────
 *   v10 §12.3 的第一步是「信号词预筛（**零 LLM 成本**）」。本仓 2026-09-26 实测：
 *   packages/perception/src/signal.ts 的 prefilterBySignalWords **零消费方** ——
 *   它有完整的单测、有漂亮的注释、在报告里"已实现"，但从没有一条生产输入经过它。
 *   于是「预筛有了」与「预筛在用」**同形**。
 *
 *   ⇒ 所以本文件**不判**"代码里有调用"（那是注释级证据），只判**可数的行为事实**：
 *     ① 预筛 miss ⇒ **LLM 桩的调用计数恒为 0**，且桩**换成会抛错的那种也不抛**；
 *     ② 同一批里只要有一条命中，计数就变 1（**证明零不是"桩是死的"**）。
 *     这两条合起来，"零 LLM 成本"才是**实测读数**而不是自述。
 *
 * ── 判据组与负向腿（每条都配反方向）───────────────────────────────────────────
 *   ① 预筛真被消费（核心）：miss ⇒ llmCalls===0 且不抛；hit ⇒ llmCalls===1（两腿）
 *   ② 空文本是**第三种事实**：state='empty' 与 miss 分列，同样零 LLM
 *   ③ 未到空闲阈值 ⇒ not-idle 且零 LLM（阈值边界两侧都判）
 *   ④ 【不可同形】prefiltered-out 与 prefilter-unavailable 的读数差分（ran/scanned/table）
 *   ⑤ no-llm：预筛命中但通道不可用 ⇒ 计数 0；通道降级 ⇒ 计数 1（两者必须分列）
 *   ⑥ 【两道门】白名单门 vs 编码侧码判：同一条上两门结论相反（三方向）+ 四腿逐条可分辨（两腿）
 *   ⑦ 粒度判定：四种过细特征各自命中 + 粗粒度通过（双方向）
 *   ⑧ 过门写回：真落库（读回 memory_items）+ 反证（拿掉写面 ⇒ 零新行）
 *   ⑨ 幂等腿：同内容第二次 ⇒ 跳过且不再写
 *   ⑩ 写失败**不得**被读成"判了不值得"
 *   ⑪ 解析失败三态可分辨（unparsable / shape-invalid / empty）
 *   ⑫ LLM 违约抛错 ⇒ 归入 no-llm 并带真因（不折成"没有提议"）
 *   ⑬ 过筛者编号空间：未命中候选不进 prompt、其编号不可被回指
 *   ⑭ 生产通道腿：真装配 mana-llm + 计数上游桩，miss ⇒ 上游调用 0 / hit ⇒ 1
 *   ⑮ 两道门**不共享判定逻辑**（源码结构腿：不得引用 Write Gate 的任何判据符号）
 *   ⑯ 用例计数自检
 *
 * ⚠ **本文件的用例数本身也是判据**：空文件在 node --test 下报 tests 1/pass 1 的假绿
 *   ⇒ 末条为计数自检，外部核验请断言 "# tests 18" **相等**，而不是 "> 0"。
 *
 * 运行（显式路径）：node --test packages/consolidation/tests/distill.test.mjs
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

const SRC = new URL('../src/distill.ts', import.meta.url).href
const CORE = new URL('../../core/src/index.ts', import.meta.url).href
const D = await import(SRC)
const EXPECTED_CASES = 18
let ran = 0

const cleanups = []
after(() => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }) })
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** 空闲阈值（从源码常量取，不手抄 —— 手抄两处必然漂开）。 */
const IDLE = D.DISTILL_IDLE_THRESHOLD_MS

/** 一条**确定性会命中**预筛的候选（含内置词表的「偏好」「以后」）。 */
const HIT_TEXT = '[偏好] 清单格式·以后逐条复核再交付'
/** 一条**确定性不命中**的候选（不含任何内置信号词）。 */
const MISS_TEXT = 'mvn clean verify ran fine again today'

/**
 * 计数 LLM 桩：**唯一职责是数自己被调了几次**。
 *
 * @param reply 要回的内容；'throw' = 每次调用都抛（用于证明"零调用"不是靠桩是死的）。
 */
function makeLlm(reply) {
  const stub = {
    calls: 0,
    prompts: [],
    async generate(req) {
      stub.calls += 1
      stub.prompts.push(req.prompt)
      if (reply === 'throw') throw new Error('桩按设计抛错')
      if (reply === 'fail') return { ok: false, text: null, callId: 'stub-fail-1', reason: '上游 500', degraded: 'stream-error' }
      return { ok: true, text: typeof reply === 'string' ? reply : JSON.stringify(reply), callId: 'stub-call-' + String(stub.calls) }
    },
  }
  return stub
}

/** 造一条合形状的裁决回复。 */
const replyWith = (proposals) => JSON.stringify({ proposals })
const GOOD_PROPOSAL = { from: 'c1', text: '[偏好] 交付纪律·先自验再交接', target: 'notes/user.md', coarse: true, why: '跨会话可复用' }

/** 内存写面（判据用；生产是 coreDistillStore）。 */
function makeStore(opts = {}) {
  const rows = new Map()
  const store = {
    type: D.DISTILL_MEMORY_TYPE,
    rows,
    writeCalls: 0,
    hasContent(c) { return [...rows.values()].some((r) => r.content === c) },
    write(item) {
      store.writeCalls += 1
      if (opts.throwOnWrite) throw new Error('写面按设计失败')
      rows.set(item.id, { ...item })
    },
  }
  return store
}

// ══ ① 核心：预筛 miss ⇒ 不进 LLM 裁决（零 LLM 成本）════════════════════════════
test('① 核心：预筛 miss ⇒ llmCalls===0（桩换成会抛错的也不抛）', async () => {
  ran += 1
  // 桩**会抛**：若真被调到，本用例会以"桩抛错"以外的形态失败 —— 即"零调用"不是靠桩惰性。
  const llm = makeLlm('throw')
  const r = await D.distillSession({
    sessionId: 's-miss', idleMs: IDLE, candidates: [MISS_TEXT, MISS_TEXT + ' two'],
    llm, store: makeStore(),
  })
  assert.equal(r.state, 'prefiltered-out', '全 miss ⇒ 状态必须是 prefiltered-out；实测 ' + r.state)
  assert.equal(r.llmCalls, 0, '**核心判据**：预筛 miss ⇒ LLM 调用必须为 0；实测 ' + String(r.llmCalls))
  assert.equal(llm.calls, 0, '桩自身计数也必须为 0（两处读数不得漂开）；实测 ' + String(llm.calls))
  assert.equal(r.prefilter.ran, true, '预筛必须真的跑过（ran=false 是"没跑"，与"跑了没命中"不同）')
  assert.equal(r.prefilter.scanned, 2, '扫描条数必须如实回显；实测 ' + String(r.prefilter.scanned))
  assert.equal(r.prefilter.hit, 0)
  assert.equal(r.prefilter.miss, 2, 'miss 计数；实测 ' + String(r.prefilter.miss))
  assert.equal(r.prefilter.table, 'builtin', '表名必须来自真实现（perception 的 BUILTIN_SIGNAL_TABLE）；实测 ' + String(r.prefilter.table))
  assert.ok(r.reason.length > 0, 'reason 必须非空（每个状态都要能回答"为什么"）')
})

test('①-b 反方向：同一批里只要一条命中 ⇒ llmCalls===1（证明零不是桩是死的）', async () => {
  ran += 1
  const llm = makeLlm(replyWith([GOOD_PROPOSAL]))
  const r = await D.distillSession({
    sessionId: 's-mix', idleMs: IDLE, candidates: [MISS_TEXT, HIT_TEXT],
    llm, store: makeStore(), codeGate: () => ({ hit: true, overlap: 9, threshold: 2, bankSize: 10 }),
  })
  assert.equal(r.llmCalls, 1, '有命中 ⇒ 必须真的走一次裁决；实测 ' + String(r.llmCalls))
  assert.equal(llm.calls, 1, '桩计数须与 llmCalls 一致（两处读数不得漂开）')
  assert.equal(r.state, 'adjudicated', '实测 ' + r.state)
  assert.equal(r.prefilter.hit, 1, '命中数 1；实测 ' + String(r.prefilter.hit))
  assert.equal(r.prefilter.miss, 1, '同一批里 miss 与 hit 必须分列；实测 miss=' + String(r.prefilter.miss))
  // 提议的命中词必须**回指**到来源候选（否则"这条提议为什么进得来"不可复算）。
  assert.equal(r.decisions[0].from, 'c1', 'from 必须回指候选编号；实测 ' + String(r.decisions[0].from))
  assert.deepEqual([...r.decisions[0].signalHits], ['偏好', '以后'], '命中词须从该候选的预筛读数原样取；实测 ' + JSON.stringify(r.decisions[0].signalHits))
})

// ══ ② 空文本是第三种事实（与 miss 分列，同样零 LLM）══════════════════════════════
test('② 空文本 ⇒ empty 计数单列（不是 miss），且同样零 LLM', async () => {
  ran += 1
  const llm = makeLlm('throw')
  const r = await D.distillSession({ sessionId: 's-empty', idleMs: IDLE, candidates: ['', '   ', MISS_TEXT], llm })
  assert.equal(r.prefilter.empty, 2, '空/纯空白必须是 empty（第三种事实）；实测 ' + String(r.prefilter.empty))
  assert.equal(r.prefilter.miss, 1, '实测 miss=' + String(r.prefilter.miss))
  assert.equal(r.prefilter.hit, 0)
  assert.equal(r.state, 'prefiltered-out')
  assert.equal(r.llmCalls, 0, '空文本同样不得触发裁决；实测 ' + String(r.llmCalls))
})

// ══ ③ 空闲阈值（v10 的 10 分钟）：两侧都判 ══════════════════════════════════════
test('③ 空闲未到阈值 ⇒ not-idle 且零 LLM（阈值两侧都判）', async () => {
  ran += 1
  const llm = makeLlm('throw')
  const below = await D.distillSession({ sessionId: 's-idle', idleMs: IDLE - 1, candidates: [HIT_TEXT], llm })
  assert.equal(below.state, 'not-idle', '阈值差 1ms 也必须 not-idle；实测 ' + below.state)
  assert.equal(below.llmCalls, 0, '未触发 ⇒ 零 LLM；实测 ' + String(below.llmCalls))
  assert.equal(below.prefilter.ran, false, '未触发时预筛**根本没跑**（与"跑了没命中"不同形）')
  assert.equal(below.idle.thresholdMs, IDLE, '阈值必须回显（判据据此复算，不猜）')

  const at = await D.distillSession({ sessionId: 's-idle', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])) })
  assert.notEqual(at.state, 'not-idle', '恰好到阈值 ⇒ 必须触发（上界含等号）；实测 ' + at.state)
})

// ══ ④ 【不可同形】prefilter-unavailable 与 prefiltered-out ════════════════════
test('④ 预筛不可用与预筛未命中的读数差分（两者 llmCalls 都是 0，只有读数能区分）', async () => {
  ran += 1
  const llm = makeLlm('throw')
  // 故障路径：注入一个"调用即抛"的预筛实现（等价于实现不可用）。
  const boom = await D.distillSession({
    sessionId: 's-boom', idleMs: IDLE, candidates: [HIT_TEXT], llm,
    prefilterOverride: () => { throw new Error('预筛实现按设计抛错') },
  }).then(() => null, (e) => String(e && e.message))
  assert.ok(boom !== null && boom.includes('按设计抛错'), '预筛抛错必须**向上暴露**（本函数不吞不可归因的异常）；实测 ' + JSON.stringify(boom))

  // 正常 miss 路径的读数（与"没跑"的形态对照）。
  const missRun = await D.distillSession({ sessionId: 's-a', idleMs: IDLE, candidates: [MISS_TEXT], llm })
  assert.equal(missRun.state, 'prefiltered-out')
  assert.equal(missRun.prefilter.ran, true, 'miss 路径：预筛**跑过**（ran=true）')
  assert.equal(missRun.prefilter.scanned, 1, 'miss 路径：**有**扫描条数')
  assert.equal(missRun.prefilter.table, 'builtin', 'miss 路径：**有**表名')

  // 未触发路径的读数（第三种"零 LLM"形态）——三条路的 llmCalls 全为 0，靠读数区分。
  const notIdle = await D.distillSession({ sessionId: 's-b', idleMs: 0, candidates: [MISS_TEXT], llm })
  assert.equal(notIdle.llmCalls, 0)
  assert.equal(notIdle.prefilter.ran, false, '未触发：预筛**没跑**（ran=false 且 scanned=0）')
  assert.equal(notIdle.prefilter.scanned, 0)
  assert.equal(notIdle.prefilter.table, null, '未触发：**无**表名（不得回显一个"看起来正常"的表名）')
})

// ══ ⑤ no-llm：预筛命中但通道不可用 / 降级 ══════════════════════════════════════
test('⑤ 预筛命中但判定通道不可用 ⇒ no-llm，且必须分「没调」与「调了降级」两态', async () => {
  ran += 1
  const none = await D.distillSession({ sessionId: 's-nollm', idleMs: IDLE, candidates: [HIT_TEXT], ctx: null })
  assert.equal(none.state, 'no-llm', '无通道 ⇒ no-llm；实测 ' + none.state)
  assert.equal(none.llmCalls, 0, '通道压根不可用 ⇒ **没有调用发生**（与"调了但降级"不同形）；实测 ' + String(none.llmCalls))
  assert.equal(none.prefilter.ran, true, '预筛仍必须跑过（no-llm 不是"预筛也停了"）')
  assert.ok(none.reason.includes('mana-llm'), 'reason 必须点名缺的是哪个服务；实测 ' + none.reason)

  const deg = await D.distillSession({ sessionId: 's-deg', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm('fail') })
  assert.equal(deg.state, 'no-llm')
  assert.equal(deg.llmCalls, 1, '通道降级是**调用之后**的事实 ⇒ 计数必须为 1；实测 ' + String(deg.llmCalls))
  assert.equal(deg.llmDegraded, 'stream-error', '降级归类必须原样带出；实测 ' + String(deg.llmDegraded))
  assert.ok(deg.reason.includes('stream-error'), 'reason 必须带上游归类（只说"失败了"不可定位）')
})


// ══ ⑥ 【两道门】白名单门 vs 编码侧码判（**不许坍成一道**）════════════════════════
test('⑥ 两道门各自独立：同一条上「白名单否决」而「编码侧码判通过」（双方向）', async () => {
  ran += 1
  // ── 方向 A：白名单**否决**（目标地址不在册），编码侧码判**通过** ──
  const badAddress = { from: 'c1', text: '[偏好] 交付纪律·先自验再交接', target: 'notes/不存在的文件.md', coarse: true }
  const a = await D.distillSession({
    sessionId: 's-gate-a', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([badAddress])), store: makeStore(),
    codeGate: () => ({ hit: true, overlap: 9, threshold: 2, bankSize: 10 }),
  })
  assert.equal(a.state, 'rejected-by-gate', '实测 ' + a.state)
  assert.equal(a.decisions[0].whitelist.admitted, false, '白名单必须否决（地址不在册）')
  assert.equal(a.decisions[0].whitelist.leg, 'address', '否决腿必须点名 address；实测 ' + String(a.decisions[0].whitelist.leg))
  assert.equal(a.decisions[0].codeGate.ran, true, '编码侧码判**必须跑过**（两道门各自独立）')
  assert.equal(a.decisions[0].codeGate.pass, true, '编码侧码判**通过** —— 若两道门是同一份逻辑，这里不可能与白名单相反')
  assert.equal(a.decisions[0].vetoedBy, 'whitelist', '首个否决腿必须是 whitelist；实测 ' + String(a.decisions[0].vetoedBy))

  // ── 方向 B：白名单**通过**，编码侧码判**否决** ──
  const b = await D.distillSession({
    sessionId: 's-gate-b', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])), store: makeStore(),
    // 生产注入的是 long-term 的 prefilterWorthKeeping：对"[偏好] …"这类行 overlap=0 ⇒ hit=false（本席实测）。
    codeGate: () => ({ hit: false, overlap: 0, threshold: 2, bankSize: 10 }),
  })
  assert.equal(b.state, 'rejected-by-gate', '实测 ' + b.state)
  assert.equal(b.decisions[0].whitelist.admitted, true, '白名单必须**放行**（目标是 notes/user.md）')
  assert.equal(b.decisions[0].whitelist.leg, null, '放行时腿必须为 null（不得留一个"看起来像否决"的值）')
  assert.equal(b.decisions[0].codeGate.pass, false)
  assert.equal(b.decisions[0].vetoedBy, 'code-gate', '方向 B 的否决腿必须是 code-gate；实测 ' + String(b.decisions[0].vetoedBy))
  assert.ok(b.decisions[0].codeGate.reason.includes('两道不同的门'), 'reason 必须自陈"与白名单门是两道不同的门"（防后人合并）')

  // ── 方向 C：未注入码判 ⇒ 该腿记 ran:false（**不冒充通过**），于是**放行** ──
  const c = await D.distillSession({
    sessionId: 's-gate-c', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])), store: makeStore(),
  })
  assert.equal(c.decisions[0].codeGate.ran, false, '未注入 ⇒ ran 必须为 false')
  assert.equal(c.decisions[0].codeGate.pass, null, 'ran=false 时 pass 必须为 null（不得用 false 冒充"判过没通过"）')
  assert.equal(c.state, 'adjudicated', '缺该腿不得阻断主链（它是可选注入面，不是前置）')
})

test('⑥-b 白名单门四腿逐条可分辨（address / label / shape / idempotence）', async () => {
  ran += 1
  const g = D.distillWhitelistGate
  const okText = '[偏好] 交付纪律·先自验再交接'
  assert.equal(g({ target: 'notes/user.md', text: okText }, { alreadyPresent: false }).admitted, true, '前置：基准形状必须放行')
  assert.equal(g({ target: 'notes/nope.md', text: okText }, { alreadyPresent: false }).leg, 'address')
  assert.equal(g({ target: 'notes/user.md', text: '偏好 交付纪律·先自验再交接' }, { alreadyPresent: false }).leg, 'label', '缺行首标签 ⇒ label 腿')
  assert.equal(g({ target: 'notes/user.md', text: '[自造标签] 交付纪律·先自验再交接' }, { alreadyPresent: false }).leg, 'label', '白名单外标签 ⇒ label 腿')
  assert.equal(g({ target: 'notes/user.md', text: '[原则] 交付纪律·先自验再交接' }, { alreadyPresent: false }).leg, 'label', '[原则] 只能进 AGENT.md ⇒ notes/user.md 应被拒')
  assert.equal(g({ target: 'AGENT.md', text: '[原则] 交付纪律·先自验再交接' }, { alreadyPresent: false }).admitted, true, '[原则] + AGENT.md ⇒ 必须放行（否则是"该过的没过"）')
  assert.equal(g({ target: 'notes/user.md', text: '[偏好] 短·句' }, { alreadyPresent: false }).admitted, true, '恰好最小长度且含分隔符 ⇒ 放行')
  assert.equal(g({ target: 'notes/user.md', text: '[偏好] 缺分隔符的长句子文本' }, { alreadyPresent: false }).leg, 'shape', '缺主题分隔符 ⇒ shape 腿')
  assert.equal(g({ target: 'notes/user.md', text: okText }, { alreadyPresent: true }).leg, 'idempotence', '已在库 ⇒ idempotence 腿（**不是**别的腿）')
  // 每一腿的 reason 必须非空（失败可归因）。
  for (const leg of ['address', 'label', 'shape', 'idempotence']) {
    const probe = leg === 'address'
      ? g({ target: 'x.md', text: okText }, { alreadyPresent: false })
      : leg === 'label'
        ? g({ target: 'notes/user.md', text: '无标签行 but long enough·yes' }, { alreadyPresent: false })
        : leg === 'shape'
          ? g({ target: 'notes/user.md', text: '[偏好] 长句子但无分隔符' }, { alreadyPresent: false })
          : g({ target: 'notes/user.md', text: okText }, { alreadyPresent: true })
    assert.equal(probe.leg, leg, '前置：探针须命中 ' + leg)
    assert.ok(typeof probe.reason === 'string' && probe.reason.length > 0, leg + ' 腿必须带非空 reason')
  }
})

// ══ ⑦ 粒度判定：只收粗粒度指引（四种过细特征 + 通过）════════════════════════════
test('⑦ 粒度判定：四种过细特征各自命中，粗粒度通过（双方向）', async () => {
  ran += 1
  const j = D.judgeGranularity
  assert.deepEqual([...j({ text: '[偏好] 交付纪律·先自验再交接', coarse: true }).features], [], '合形状 ⇒ 零特征')
  assert.equal(j({ text: '[偏好] 交付纪律·先自验再交接', coarse: true }).coarse, true)
  assert.ok([...j({ text: '[偏好] 交付纪律·先自验再交接' }).features].includes('coarse-claim-missing'), '缺 coarse 声明 ⇒ 该特征命中')
  assert.ok([...j({ text: '[env] 节点版本·2026-09-26 装的 v22', coarse: true }).features].includes('date-stamp'), '日期戳 ⇒ date-stamp')
  assert.ok([...j({ text: '[env] 配置位置·在 /home/lk/Mana 下面', coarse: true }).features].includes('concrete-path'), '具体路径 ⇒ concrete-path')
  assert.ok([...j({ text: '[tool] 报错位置·见 src/index.ts:42', coarse: true }).features].includes('line-number'), '行号 ⇒ line-number')
  assert.ok([...j({ text: '[flow] 长流水·' + '细'.repeat(200), coarse: true }).features].includes('over-max-chars'), '超长 ⇒ over-max-chars')
  // 过细 ⇒ coarse=false（拒），且 features 有序可枚举。
  assert.equal(j({ text: '[env] 节点版本·2026-09-26 装的 v22', coarse: true }).coarse, false)
  // 上界是**可覆盖**的（判据据此复算，不靠猜一个魔数）。
  assert.equal(j({ text: '[flow] 短·' + '字'.repeat(30), coarse: true }, { maxChars: 10 }).coarse, false)
})

// ══ ⑧ 过门写回：真落库 + 反证（拿掉写面 ⇒ 零新行）═══════════════════════════════
test('⑧ 过门写回：真落库（读回 memory_items）+ 反证（无写面 ⇒ 零新行）', async () => {
  ran += 1
  const dir = mkdtempSync(join(tmpdir(), 'mana-distill-'))
  cleanups.push(dir)
  const ctx = new Context()
  const coreMod = await import(CORE)
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle(250)
  const core = ctx.get('mana-core')
  assert.ok(core, '前置：core 服务必须可读')

  const store = D.coreDistillStore(core)
  const before = Number(core.db.prepare('SELECT COUNT(*) c FROM memory_items').get().c)
  const r = await D.distillSession({
    sessionId: 's-write', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])), store,
  })
  assert.equal(r.state, 'adjudicated', '实测 ' + r.state)
  assert.equal(r.inserted.length, 1, '必须写 1 条；实测 ' + String(r.inserted.length))
  const after = Number(core.db.prepare('SELECT COUNT(*) c FROM memory_items').get().c)
  assert.equal(after, before + 1, '库上必须真新增 1 行（自称 inserted 必须等于库上真新增）；实测 ' + String(before) + ' -> ' + String(after))
  const row = core.db.prepare('SELECT id, type, content FROM memory_items WHERE id = ?').get(r.inserted[0])
  assert.ok(row, '写回的行必须可读回（只报 id 不算"真落库"）')
  assert.equal(row.content, GOOD_PROPOSAL.text, '内容必须逐字落库')
  assert.equal(row.type, D.DISTILL_MEMORY_TYPE, 'type 必须是既有 type（不新造第二种"看起来像记忆"的行）；实测 ' + String(row.type))
  assert.ok(String(row.id).startsWith('dist_'), 'id 前缀必须可归属（dist_）；实测 ' + String(row.id))

  // ── 反证：同一输入但**不带写面** ⇒ 判定照跑、库上零新行 ──
  const none = await D.distillSession({
    sessionId: 's-write', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])), store: null,
  })
  assert.equal(none.state, 'adjudicated', '无写面时判定仍必须跑（"只判不写"是**一等状态**）')
  assert.equal(none.writeEnabled, false, 'writeEnabled 必须如实回显')
  assert.equal(none.inserted.length, 0, '无写面 ⇒ 零写入')
  const stillAfter = Number(core.db.prepare('SELECT COUNT(*) c FROM memory_items').get().c)
  assert.equal(stillAfter, after, '无写面时库上必须**一行不动**；实测 ' + String(after) + ' -> ' + String(stillAfter))
})


// ══ ⑨ 幂等腿：同内容第二次 ⇒ 跳过且不再写 ══════════════════════════════════════
test('⑨ 幂等：同内容第二次蒸馏 ⇒ 走 idempotence 腿且**零新行**', async () => {
  ran += 1
  const store = makeStore()
  const input = { sessionId: 's-idem', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])), store }
  const first = await D.distillSession(input)
  assert.equal(first.state, 'adjudicated', '第一次必须写；实测 ' + first.state)
  assert.equal(store.writeCalls, 1)
  const second = await D.distillSession({ ...input, llm: makeLlm(replyWith([GOOD_PROPOSAL])) })
  assert.equal(second.state, 'rejected-by-gate', '第二次必须被幂等腿挡下；实测 ' + second.state)
  assert.equal(second.idempotentSkips, 1, '幂等跳过数必须显式；实测 ' + String(second.idempotentSkips))
  assert.equal(second.decisions[0].whitelist.leg, 'idempotence', '否决腿必须是 idempotence（不得混进别的腿）')
  assert.equal(store.writeCalls, 1, '第二次**不得**再写（写面计数必须停在 1）；实测 ' + String(store.writeCalls))
  assert.equal(store.rows.size, 1, '库里仍只有 1 行；实测 ' + String(store.rows.size))
})

// ══ ⑩ 写失败不得被读成"判了不值得" ═════════════════════════════════════════════
test('⑩ 写失败 ⇒ vetoedBy=write-failed 且带真因（不得折成"判了不值得"）', async () => {
  ran += 1
  const r = await D.distillSession({
    sessionId: 's-wfail', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])),
    store: makeStore({ throwOnWrite: true }),
  })
  assert.equal(r.state, 'rejected-by-gate', '写全失败 ⇒ 零条过门的状态；实测 ' + r.state)
  assert.equal(r.decisions[0].vetoedBy, 'write-failed', '否决腿必须点名写失败；实测 ' + String(r.decisions[0].vetoedBy))
  assert.equal(r.decisions[0].written, false)
  assert.ok(String(r.decisions[0].writeError).includes('按设计失败'), '必须带写面真因；实测 ' + String(r.decisions[0].writeError))
  assert.ok(String(r.decisions[0].writeError).includes('不是「判了不值得」'), 'reason 必须自陈"这不是判了不值得"（两者处置完全不同）')
  // 对照腿：同一输入但写面正常 ⇒ 必须过门（证明上面挡下的是**写失败**而不是别的腿）。
  const ok = await D.distillSession({
    sessionId: 's-wfail', idleMs: IDLE, candidates: [HIT_TEXT], llm: makeLlm(replyWith([GOOD_PROPOSAL])), store: makeStore(),
  })
  assert.equal(ok.state, 'adjudicated', '对照腿必须过门（否则上面测的不是写失败）')
})

// ══ ⑪ 解析失败三态可分辨（unparsable / shape-invalid / empty）═══════════════════
test('⑪ 裁决回复解析：unparsable / shape-invalid / empty 三态各有名字', async () => {
  ran += 1
  const p = D.parseAdjudication
  assert.equal(p('').state, 'unparsable', '空文本 ⇒ unparsable（不是 empty）')
  assert.equal(p('好的，我看看。').state, 'unparsable', '无 JSON ⇒ unparsable')
  assert.equal(p('{"proposals": ').state, 'unparsable', '半截 JSON ⇒ unparsable（不得当空）')
  assert.equal(p('{"items":[]}').state, 'shape-invalid', '缺 proposals 键 ⇒ shape-invalid')
  assert.equal(p('{"proposals":"nope"}').state, 'shape-invalid', 'proposals 非数组 ⇒ shape-invalid')
  assert.equal(p('{"proposals":[]}').state, 'empty', '空数组 ⇒ empty（宁缺毋滥的正常态）')
  const ok = p('{"proposals":[{"from":"c1","text":"[偏好] 甲·乙","target":"notes/user.md","coarse":true}]}', { candidateCount: 3 })
  assert.equal(ok.state, 'ok', '合形状 ⇒ ok；实测 ' + ok.state)
  assert.equal(ok.accepted.length, 1)
  // 围栏容忍（模型常包代码围栏）—— 且**不因围栏而把内容读丢**。
  const fenced = p('说明文字\n' + String.fromCharCode(96).repeat(3) + 'json\n{"proposals":[]}\n' + String.fromCharCode(96).repeat(3) + '\n收尾')
  assert.equal(fenced.state, 'empty', '带围栏 ⇒ 仍须解析出 empty（不得退化成 unparsable）；实测 ' + fenced.state)
  // from 校验：越界/自造编号必须被**显式拒绝**而不是静默接受。
  const bad = p('{"proposals":[{"from":"c9","text":"[偏好] 甲·乙","target":"notes/user.md","coarse":true}]}', { candidateCount: 1 })
  assert.equal(bad.state, 'shape-invalid', 'from 越界 ⇒ 整条不成形；实测 ' + bad.state)
  assert.equal(bad.accepted.length, 0, '越界的提议**不得**被接受')
  assert.equal(bad.rejected.length, 1, '被拒的条目必须留在 rejected 里（**不许静默丢弃**）')
  const noFrom = p('{"proposals":[{"text":"[偏好] 甲·乙","target":"notes/user.md"}]}')
  assert.equal(noFrom.state, 'shape-invalid', '缺 from ⇒ 无法回指候选 ⇒ 不成形；实测 ' + noFrom.state)
})

// ══ ⑫ LLM 违约抛错 ⇒ no-llm 且带真因（不折成"没有提议"）════════════════════════
test('⑫ LLM 抛错 ⇒ no-llm 且 llmCalls===1，reason 带真因', async () => {
  ran += 1
  const llm = makeLlm('throw')
  const r = await D.distillSession({ sessionId: 's-throw', idleMs: IDLE, candidates: [HIT_TEXT], llm })
  assert.equal(r.state, 'no-llm', '实测 ' + r.state)
  assert.equal(r.llmCalls, 1, '抛错发生在**一次真实调用**里 ⇒ 计数必须为 1；实测 ' + String(r.llmCalls))
  assert.equal(llm.calls, 1)
  assert.ok(r.reason.includes('按设计抛错'), 'reason 必须带原真因；实测 ' + r.reason)
  assert.ok(!r.reason.includes('没有提议'), 'reason 不得把抛错说成"没有提议"（同形化禁止）')
})

// ══ ⑬ 过筛者编号空间：未过筛的候选一个字都不进 prompt，其编号也不可被回指 ═════════
test('⑬ 过筛者编号空间：material 与 from 边界都只认过筛者（防"被挡输入绕回"）', async () => {
  ran += 1
  const llm = makeLlm(replyWith([{ from: 'c1', text: '[偏好] 交付纪律·先自验再交接', target: 'notes/user.md', coarse: true }]))
  const r = await D.distillSession({
    sessionId: 's-space', idleMs: IDLE,
    // 原始序第 1 条未命中，第 2 条命中 ⇒ 过筛者只有 1 条。
    candidates: [MISS_TEXT, HIT_TEXT],
    llm, store: makeStore(), codeGate: () => ({ hit: true, overlap: 9, threshold: 2, bankSize: 10 }),
  })
  assert.equal(llm.calls, 1, '前置：必须走到了一次裁决')
  assert.ok(!llm.prompts[0].includes(MISS_TEXT), '**未命中候选不得进 prompt**（否则"零 LLM 成本"在内容层不成立）；实测 prompt=' + JSON.stringify(llm.prompts[0]))
  assert.ok(llm.prompts[0].includes('c1] ' + HIT_TEXT), '过筛者必须从 c1 起编号（编号空间只剩过筛者）；实测 prompt=' + JSON.stringify(llm.prompts[0]))
  assert.equal(r.decisions[0].from, 'c1', 'from=c1 必须回指**过筛者**第一条')
  assert.deepEqual([...r.decisions[0].signalHits], ['偏好', '以后'], '命中词必须来自过筛者自身的预筛读数')

  // 反向：模型回指一个越界编号 ⇒ 必须被拒（不得让它指到"未过筛"那一条上）。
  const bad = await D.distillSession({
    sessionId: 's-space', idleMs: IDLE, candidates: [MISS_TEXT, HIT_TEXT],
    llm: makeLlm(replyWith([{ from: 'c2', text: '[偏好] 甲·乙', target: 'notes/user.md', coarse: true }])), store: makeStore(),
  })
  assert.equal(bad.parse.state, 'shape-invalid', 'from=c2 越界（过筛者只有 1 条）⇒ 必须被拒；实测 ' + bad.parse.state)
  assert.equal(bad.state, 'rejected-by-gate', '被拒 ⇒ 零条过门；实测 ' + bad.state)
  assert.equal(bad.inserted.length, 0, '越界编号**不得**产生任何写入')
})

// ══ ⑭ 生产通道腿：真装配 mana-llm + 计数上游桩 ══════════════════════════════════
test('⑭ 生产通道腿：真 mana-llm 装配下，miss ⇒ 上游零调用；hit ⇒ 上游恰好 1 次', async () => {
  ran += 1
  const LlmRuntime = (await import('@deepseek-ai/dsh-llm')).default
  const LlmAdapter = (await import('@deepseek-ai/dsh-llm')).LlmAdapter
  let upstreamCalls = 0
  class Counting extends LlmAdapter {
    async *stream() {
      upstreamCalls += 1
      const t = '{"proposals":[{"from":"c1","text":"[偏好] 交付纪律·先自验再交接","target":"notes/user.md","coarse":true}]}'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: t }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: t } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'mana-distill-llm-'))
  cleanups.push(dir)
  const ctx = new Context()
  ctx.plugin(LlmRuntime)
  await settle(150)
  ctx.plugin(await import(CORE), { storePath: join(dir, 'mana.db') })
  await settle(200)
  ctx.get('llm').registerAdapter(['up'], new Counting())
  ctx.plugin(await import(new URL('../../llm/src/index.ts', import.meta.url).href), { upstreamProvider: 'up', upstreamModel: 'stub-model' })
  await settle(200)
  ctx.plugin(await import(new URL('../../prompts/src/index.ts', import.meta.url).href), {})
  await settle(150)
  assert.ok(ctx.get('mana-llm'), '前置：mana-llm 服务必须可读（否则本腿是空跑）')

  // ── miss：**上游一次都不能被碰到**（这一腿不注入任何桩，走的是真服务）──
  const miss = await D.distillSession({ sessionId: 's-prod-miss', idleMs: IDLE, candidates: [MISS_TEXT, MISS_TEXT + ' b'], ctx })
  assert.equal(miss.state, 'prefiltered-out', '实测 ' + miss.state)
  assert.equal(miss.llmCalls, 0, '真服务下也必须为 0；实测 ' + String(miss.llmCalls))
  assert.equal(upstreamCalls, 0, '**上游桩零调用**（这是"零 LLM 成本"在生产通道上的最强形态）；实测 ' + String(upstreamCalls))

  // ── hit：同一装配下必须真走一次（否则上面那个 0 是"通道不通"冒充的）──
  const hit = await D.distillSession({ sessionId: 's-prod-hit', idleMs: IDLE, candidates: [HIT_TEXT], ctx })
  assert.equal(hit.state, 'adjudicated', '实测 ' + hit.state + ' / ' + hit.reason)
  assert.equal(hit.llmCalls, 1, '实测 ' + String(hit.llmCalls))
  assert.equal(upstreamCalls, 1, '上游桩恰好 1 次；实测 ' + String(upstreamCalls))
  assert.ok(String(hit.llmCallIds[0]).startsWith('mana-llm-call-'), 'callId 必须来自真服务（本地造的话不会是这个名字）；实测 ' + String(hit.llmCallIds[0]))
})

// ══ ⑮ 两道门**不共享判定逻辑**（结构腿，与 ⑥ 的行为腿互补）═══════════════════════
test('⑮ 两道门不共享判定逻辑：distill.ts 不得 import Write Gate 的任何判据常量', async () => {
  ran += 1
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/distill.ts', import.meta.url), 'utf8')
  // ⚠ 本条是**补充**腿（行为腿在 ⑥）：行为能证明"结论可以相反"，结构这条防"以后有人图省事合并"。
  for (const forbidden of ['prefilterWorthKeeping', 'WRITE_GATE_QUESTION', 'PREFILTER_BANK', 'PREFILTER_MIN_OVERLAP', 'bigrams']) {
    assert.ok(
      !new RegExp('(^|[^A-Za-z_])' + forbidden + '([^A-Za-z_]|$)').test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')),
      'distill.ts 的**可执行代码**不得引用 Write Gate 的判据符号 ' + forbidden + ' —— 引用即两道门坍成一道',
    )
  }
  // 正方向：它必须仍在消费 perception 的真预筛（零消费方那种形态不再重演）。
  assert.ok(src.includes('prefilterBySignalWords'), '必须真调用 perception 的 prefilterBySignalWords（不是 import 了事）')
  assert.ok(src.includes('resolveSignalPrefilter()'), '必须经运行期解析取实现（每次现解析，不缓存）')
})

// ══ ⑯ 用例计数自检 ═══════════════════════════════════════════════════════════════
test('⑯ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1/pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, '本文件声明 ' + String(EXPECTED_CASES) + ' 条，实跑 ' + String(ran) + ' 条 —— 数量不符说明有用例被删或被跳过')
})
