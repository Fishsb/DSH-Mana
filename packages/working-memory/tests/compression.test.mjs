/**
 * dsh-mana-working-memory 包内判据（W2-C2 席新增）—— **v10 §30.2 三层上下文压缩**。
 *
 * 判据与实现的**分工**（本文件的立足点）：
 *   · 实现（src/compression.ts）负责「压得对不对」；
 *   · 本文件负责「**压了没有、压了多少、失败时看不看得见**」——
 *     即本仓最忌的那种缺陷：**让失败不可观测**（"压住了" 与 "根本没压" 表面同形）。
 *
 * ## 三层各自的**必红点**（每条腿都在负向对拍里被打过，见 verify.mjs 闸⑥）
 * | 层 | 正向腿 | 变异后必红的原因 |
 * |---|---|---|
 * | 第一层 | C1..C6 | 不记账/不真压/吞异常 ⇒ 记账读数与事实脱钩 |
 * | 第二层 | C7..C10 | 五段缺键 / 阈值写死 / 摘要反超仍报"省了" |
 * | 第三层 | C11..C14 | 丢内容不记账 / 无上限语义错 / 恒等式不成立 |
 * | 两闸回归 | R1..R3 | 压缩路径**不得**动既有两闸语义（逐条点名核验） |
 *
 * ## 口径纪律（本仓血的教训）
 *  · **读 src、判 src**：本文件用相对 URL 读 **src**（不是 lib），故判据面与实现面同源；
 *    但 `负向对拍` 打的是 **lib**（那是 loader/包名解析真正装载的那一层）
 *    ⇒ 两者都要新鲜，verify.mjs 的内容腿负责核这件事（tsc 重编译 vs lib 逐字节）。
 *  · **真读数不许推演**：每条腿的 before/after 都是从**真调用**返回值里取的。
 *  · **不写 mana_trace**：8 事件契约不动 ⇒ 本席判据只读**服务面返回值**，不读库。
 *
 * 运行（**禁止管道取退出码**）：node --test packages/working-memory/tests/*.test.mjs ; echo $?
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const BASE_URL = pathToFileURL(REPO + '/').href

const { Context } = await import(DSH + '/cordis/lib/index.js')
const Loader = (await import(DSH + '/cordis-plugin-loader/lib/index.js')).default
const { MANA_STAGES } = await import(new URL('../../core/src/domain.ts', import.meta.url).href)
const coreMod = await import(new URL('../../core/src/index.ts', import.meta.url).href)
const wmMod = await import(new URL('../src/index.ts', import.meta.url).href)
const cmp = await import(new URL('../src/compression.ts', import.meta.url).href)

const cleanups = []
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
process.on('exit', () => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }) })

const tmpStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mana-wm-cmp-'))
  cleanups.push(dir)
  return join(dir, 'mana.db')
}

/** 直装配：真 Context + src 模块（与既有 W1..W14 同口径）。 */
async function bootDirect({ capacityChunks, budgetChars = 4000 }) {
  const store = tmpStore()
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: store })
  await settle(250)
  assert.ok(ctx.get('mana-core'), '前置：mana-core 必须可读')
  ctx.plugin(wmMod, { capacityChunks, budgetChars })
  await settle(250)
  assert.ok(ctx.get('mana-working-memory'), '未装配 mana-working-memory')
  return { ctx, store }
}

/** 造作意载荷（形状与既有判据 att() 一致）。 */
const att = (i, content = '内容' + i) => ({
  sessionId: 'sess-cmp', turnId: 1, requestId: 'req-' + i,
  at: '2026-01-01T00:00:' + String(i).padStart(2, '0') + 'Z',
  content, jevProbability: null, degraded: false,
})

/** 造 n 码点内容（'中' = 1 码点 / 3 字节 ⇒ 顺带区分"按码点"与"按字节"）。 */
const rep = (n, ch = '中') => ch.repeat(n)

// ══ 第一层：工作记忆内压缩 ═══════════════════════════════════════════════════

test('C1 第一层：真压 + 精确记账（压前/压后条数与字符数都从真返回值取，逐项核）', () => {
  const chunks = [1, 2, 3, 4, 5].map((i) => ({ requestId: 'req-' + i, content: rep(10), seq: i, at: 'T' + i }))
  const r = cmp.compressChunks(chunks, 2)

  // ① 真压了：条数**降到上界内**（不是"压了但没够"——本席第一版算式就有过这个洞）
  assert.equal(r.compressed, true, '5 条 / 容量 2 ⇒ 必须真压（不压 = 死开关）')
  assert.ok(r.afterChunks <= 2, '压后条数必须回到容量上界内（只减 1 条不算压住）')
  // ② 记账四件套：前/后条数、前/后字符数**都可读**（这是"不得静默丢内容"的落点）
  assert.equal(r.beforeChunks, 5)
  assert.equal(r.afterChunks, 2)
  assert.equal(r.beforeChars, 50, '压前字符数 = 5 × 10 码点')
  // 压后 = 摘要 16 码点 + 保留原文 1 条 10 码点 = 26（实测值，算式留在注释里供逐字复核）
  assert.equal(r.afterChars, 26, '压后 = 摘要 16 + 原文 10 = 26')
  assert.equal(r.summaryChars, 16, '摘要正文 = "[折叠 4 条 seq 1-4]"（16 码点）')
  // ③ savedChars 必须等于"真差值"，不许是常量回填
  assert.equal(r.savedChars, r.beforeChars - r.afterChars, 'savedChars 必须与前/后读数同源')
  assert.equal(r.savedChars, 24, '省下 = 50 - 26 = 24（**实测**，不是推演）')
  // ④ 逐项核内容：被折叠的是**最旧**的（保最新 —— 与两闸同构）
  assert.equal(r.chunks.length, 2)
  assert.equal(r.chunks[r.chunks.length - 1].requestId, 'req-5', '最新一条必须原样保留')
  assert.equal(r.chunks[0].requestId, 'compressed:1-4', '最旧的 4 条折成 1 条摘要（可回查的定位串）')
  // ⑤ 摘要**不带原文内容**（否则"压缩"会原地复活成原文搬运）
  assert.equal(r.chunks[0].content.includes(rep(10)), false, '摘要不得内嵌原文内容')
  assert.equal(r.foldSummary.length, 1, '折叠必须有可回查的定位串')
})

test('C2 第一层边界腿：容量−1 / 恰满 / +1 —— 压缩只发生在 +1 那一次（严格大于才动作）', () => {
  const mk = (n) => Array.from({ length: n }, (_, k) => ({ requestId: 'r' + (k + 1), content: rep(50), seq: k + 1, at: 'T' }))
  // 容量 −1：不得压缩
  let r = cmp.compressChunks(mk(4), 5)
  assert.equal(r.compressed, false, '容量−1 ⇒ 不得压缩')
  assert.deepEqual([r.beforeChunks, r.afterChunks, r.savedChars], [4, 4, 0], '不动作时前后读数必须相等且 savedChars=0')
  // 恰满：**不得**压缩（边界是 > 不是 >= —— 与两闸 W1/W9 同口径）
  r = cmp.compressChunks(mk(5), 5)
  assert.equal(r.compressed, false, '恰满容量**不得**压缩（否则边界点上"管住了"与"没管"又同形）')
  assert.equal(r.savedChars, 0)
  // 容量 +1：必压，且压回上界内
  r = cmp.compressChunks(mk(6), 5)
  assert.equal(r.compressed, true, '容量+1 ⇒ 必压')
  assert.ok(r.afterChunks <= 5, '压后必须回到 5 以内')
  assert.ok(r.savedChars > 0, '真压必省字（savedChars>0 是"压得动"的判据）')
})

test('C3 第一层"不设闸"语义：capacityChunks<=0 ⇒ 不压缩（不是"全压掉"）+ 反向对照', () => {
  const mk = (n) => Array.from({ length: n }, (_, k) => ({ requestId: 'r' + (k + 1), content: rep(50), seq: k + 1, at: 'T' }))
  const no = cmp.compressChunks(mk(12), 0)
  assert.equal(no.compressed, false, '容量 0 = 该轴不设闸 ⇒ 不压缩（沿全仓 <=0 约定）')
  assert.equal(no.afterChunks, 12, '无闸 ⇒ 12 条全留（"无上限"不等于"全压掉"）')
  assert.equal(no.degraded, false, '无闸是正常路径，不是降级')
  // 反向对照：同 12 条、容量 4 ⇒ 必压（证明上面"不动作"是**配置使然**，不是判据面失效）
  const yes = cmp.compressChunks(mk(12), 4)
  assert.equal(yes.compressed, true, '反向对照：容量 4 时同 12 条必压（无对照则"无上限"与"闸坏了"同形）')
  assert.ok(yes.afterChunks <= 4)
})

test('C4 第一层降级：selector 抛错 / 返回非法值 ⇒ **显式降级 + 留字段**（不是 catch{return null}）', () => {
  const chunks = [1, 2, 3, 4, 5].map((i) => ({ requestId: 'req-' + i, content: rep(10), seq: i, at: 'T' }))
  // ① 抛错 ⇒ 降级：不压缩（宁可不做，也不做来源不可信的压缩），但**记账字段全在**
  const boom = cmp.compressChunks(chunks, 2, {}, () => { throw new Error('selector 炸了') })
  assert.equal(boom.compressed, false, '判据面抛错 ⇒ 不得压缩')
  assert.equal(boom.degraded, true, '降级必须**显式**置位（否则与"正常不压"不可分辨）')
  assert.equal(typeof boom.failure, 'string', '降级必须**留 failure 字段**（吞掉就不可观测）')
  assert.ok(boom.failure.includes('selector 炸了'), 'failure 必须带上真因（不是"出错了"这种不可定位的串）')
  assert.deepEqual([boom.beforeChunks, boom.afterChunks, boom.savedChars], [5, 5, 0], '降级路径的记账同样完整')
  // ② 返回非法值 ⇒ 同样降级（不静默当成空集 —— 那会把"判据坏了"读成"没什么要保留"）
  const bad = cmp.compressChunks(chunks, 2, {}, () => ['不是整数'])
  assert.equal(bad.degraded, true, '非法返回值必须降级（不得静默当空集）')
  assert.equal(typeof bad.failure, 'string')
  // ③ 对照组：合法 selector 不降级（证明上面两条不是"凡传 selector 皆降级"的假覆盖）
  const ok = cmp.compressChunks(chunks, 2, {}, () => [5])
  assert.equal(ok.degraded, false, '合法 selector 不得被误判为降级')
  assert.equal(ok.compressed, true, '合法 selector 下应能正常压缩')
})

test('C5 第一层 selector 保留集：保留项**不得**既进摘要又留在数组里（savedChars 虚报 = 读数与事实脱钩）', () => {
  // 5 条各 10 码点；容量 2 ⇒ 需折 4 条；但 selector 要求**保留最旧的 seq=1**
  const chunks = [1, 2, 3, 4, 5].map((i) => ({ requestId: 'req-' + i, content: rep(10), seq: i, at: 'T' }))
  const r = cmp.compressChunks(chunks, 2, {}, () => [1])
  assert.equal(r.compressed, true)
  // 保留项必须在（判据面说了它还要用）
  assert.ok(r.chunks.some((c) => c.requestId === 'req-1'), 'selector 点名保留的条目必须还在')
  // ⚠ 关键：req-1 不得**同时**出现在摘要里（否则同一条内容既算丢了又算留了）
  const summary = r.chunks.find((c) => c.requestId.startsWith('compressed:'))
  assert.ok(summary, '应有折叠摘要')
  assert.equal(summary.requestId.includes('1-'), false, '被保留的 seq=1 不得被折进摘要区间（重叠 = 虚报）')
  // 读数自洽：afterChars 必须等于**真内容**的码点数和（不信字段，实测一遍）
  const real = r.chunks.reduce((n, c) => n + [...c.content].length, 0)
  assert.equal(r.afterChars, real, 'afterChars 必须与实测内容逐点一致（字段与事实脱钩就在这里红）')
  assert.equal(r.savedChars, r.beforeChars - real, 'savedChars 必须与实测差值一致')
})

test('C6 第一层不变量：压缩**不得**让内容变长（savedChars 恒 >= 0）', () => {
  // 构造"摘要比原文长"的极端：3 条各 1 码点，容量 2 ⇒ 折 2 条（共 2 码点）成摘要（>2 码点）
  const chunks = [1, 2, 3].map((i) => ({ requestId: 'req-' + i, content: '中', seq: i, at: 'T' }))
  const r = cmp.compressChunks(chunks, 2)
  // 实现选择"压不动就不压"（宁可不压，也不产出更长结果）
  assert.ok(r.savedChars >= 0, 'savedChars 不得为负（负 = "压缩"把内容顶长了，读数会被读成"压住了"）')
  if (r.compressed) {
    assert.ok(r.afterChars < r.beforeChars, 'compressed=true ⇒ afterChars 必须**严格小于** beforeChars')
    assert.ok(r.afterChunks < r.beforeChunks, 'compressed=true ⇒ 条数必须真的减少')
  }
  // 不论压不压，不变量恒成立（本条是该不变量的机检点）
  assert.equal(r.afterChars <= r.beforeChars, true, '压缩后字符数恒 <= 压缩前')
})

// ══ 第二层：会话级压缩（五段式交接摘要）═════════════════════════════════════

test('C17 第一层"压了但没够"腿（独立复核席实测补洞）：keepRecent 夹住折叠量 ⇒ **不得**报 compressed=true', () => {
  // ## 洞的由来（**实测复现**，不是推演）
  //   本席用独立性质探针（2265 条断言）扫参数格点时命中：@compressChunks(2 条, cap=1)@
  //   ⇒ 实现返回 compressed=true，而条数 **2 → 2 一条没减**。
  //   成因：折叠量 = min(over+1, before-keepRecent) = min(2, 1) = 1 ⇒ 折 1 条留 1 条，
  //   末态 tail(1) + 摘要(1) = **2**，而容量上界是 1。
  //   危害正是本仓最忌的形态：调用方读到 compressed=true 会认为「已经压回上界了」，
  //   于是**不再兜底**；而事实是 size 仍高出上界一格 —— 压了个寂寞却显示压住了（**假绿**）。
  const mk = (n, len) => Array.from({ length: n }, (_, k) => ({ requestId: 'r' + (k + 1), content: rep(len), seq: k + 1, at: 'T' }))

  // (甲) 洞的原样：容量 1 / 2 条各 100 码点，keepRecent 缺省 1 ⇒ 折不动，必须**如实承认**
  const r = cmp.compressChunks(mk(2, 100), 1)
  assert.equal(r.afterChunks, 2, '前置：本条正是"折 1 留 1"⇒ 末态条数仍是 2')
  assert.equal(r.afterChunks > 1, true, '前置：末态确实仍**高于**容量上界 1')
  assert.equal(r.compressed, false, '压了但没回到上界内 ⇒ **不得**报 compressed=true（假绿的落点）')
  assert.equal(r.capacityReached, false, '必须显式回报"未达上界"（调用方据此继续兜底）')
  assert.equal(r.overflowRemaining, 1, '仍高出上界 1 条 —— 这个数就是"压了但没够"的读数')
  // ⚠ 既然没落地，就必须**一条都没动**（半途折了 1 条却不报 compressed，那才是真丢内容）
  assert.deepEqual(r.chunks.map((c) => c.requestId), ['r1', 'r2'], '未达上界 ⇒ 也必须**未改动内容**（不得半途折叠）')
  assert.deepEqual([r.beforeChunks, r.afterChunks, r.savedChars], [2, 2, 0], '未落地 ⇒ 前后读数相等、零省字')
  assert.equal(r.foldedChunks, 0, '未落地 ⇒ 零折叠（账不得虚报折叠动作）')

  // (乙) 反向对照：同 2 条、容量 2（恰满）⇒ 同样不动作，但**未达的语义不同**（无溢出）
  const r2 = cmp.compressChunks(mk(2, 100), 2)
  assert.equal(r2.compressed, false, '恰满不压（与两闸同口径）')
  assert.equal(r2.capacityReached, true, '恰满 ⇒ 上界是达的（与"压了但没够"必须可分辨）')
  assert.equal(r2.overflowRemaining, 0, '恰满 ⇒ 零溢出')

  // (丙) 反向对照：同 2 条、容量 1 但 keepRecent=0 ⇒ 折得动 ⇒ 必须真压且回到上界内
  const r3 = cmp.compressChunks(mk(2, 100), 1, { keepRecent: 0 })
  assert.equal(r3.compressed, true, '放开就绪性下限后折得动 ⇒ 必须真压')
  assert.equal(r3.afterChunks, 1, '折 2 条成 1 条摘要 ⇒ 回到上界内')
  assert.equal(r3.capacityReached, true, '真压 ⇒ 上界是达的')
  assert.equal(r3.overflowRemaining, 0, '真压 ⇒ 零溢出')
  assert.ok(r3.savedChars > 0, '真压必省字')

  // (丁) 容量轴不设闸 ⇒ **恒已达**（没有上界可言，不得记成"未达"）
  for (const cap of [0, -3]) {
    const rn = cmp.compressChunks(mk(4, 10), cap)
    assert.equal(rn.compressed, false, '无闸 ⇒ 不压缩（沿用 <=0 = 不设闸约定）')
    assert.equal(rn.capacityReached, true, '无闸（cap=' + cap + '）⇒ 视为已达，不得记 phantom 的"未达"')
    assert.equal(rn.overflowRemaining, 0, '无闸 ⇒ 零溢出')
  }

  // (戊) 结构与事实同源：capacityReached ⇔ overflowRemaining === 0（两位不得各说各话）
  for (const cap of [1, 2, 3, 0, -1]) for (const n of [0, 1, 2, 3, 5]) {
    const rr = cmp.compressChunks(mk(n, 20), cap)
    assert.equal(
      rr.capacityReached, rr.overflowRemaining === 0,
      'capacityReached 与 overflowRemaining 必须同源（cap=' + cap + ' n=' + n + '）',
    )
  }
})

test('C7 第二层：五段式结构**逐字**（Goal/Decisions/State/Next/Anchors）+ 键集精确', () => {
  const chunks = Array.from({ length: 3 }, (_, k) => ({ requestId: 'r' + k, content: rep(30), seq: k + 1, at: 'T' }))
  const r = cmp.handoff(chunks, 100) // 90/100 = 90% > 80% ⇒ 触发
  assert.equal(r.triggered, true, '占用 90% 超 80% 阈值 ⇒ 必须触发')
  // ① 五段**逐字**：键集与顺序都取真源 HANDOFF_KEYS（不手写第二套字面量）
  assert.deepEqual(Object.keys(r.summary).sort(), [...cmp.HANDOFF_KEYS].sort(), '五段键集必须逐字等于 v10 §30.2 原文五字段')
  assert.deepEqual(cmp.HANDOFF_KEYS, ['Goal', 'Decisions', 'State', 'Next', 'Anchors'], '五段真源必须逐字')
  // ② 每段必须是**数组**（空段也不得是 undefined —— undefined 会被 JSON 静默丢键）
  for (const k of cmp.HANDOFF_KEYS) {
    assert.equal(Array.isArray(r.summary[k]), true, '第 ' + k + ' 段必须是数组（undefined 会在序列化时静默丢键）')
  }
  // ③ 记账：压前/压后字符数都可读
  assert.equal(r.beforeChars, 90, '压前 = 3 × 30 码点')
  assert.equal(r.afterChars, r.summaryChars, 'afterChars 与 summaryChars 同源（摘要即压缩产物）')
  // ④ Anchors = 可回查定位面（逐条 requestId 都在）
  assert.equal(r.summary.Anchors.length, 3, '3 条 ⇒ 3 个锚点（可回查）')
  // ⑤ 无真源的两段**保持空数组**，不填占位符（填了与"真有决策"不可分辨）
  assert.deepEqual(r.summary.Decisions, [], 'Decisions 在本包无真源 ⇒ 空数组（不得填占位符）')
  assert.deepEqual(r.summary.Next, [], 'Next 在本包无真源 ⇒ 空数组')
})

test('C8 第二层：触发阈值**可配**且真生效（三档：0.8 缺省 / 显式更严 / 无闸）', () => {
  const chunks = Array.from({ length: 3 }, (_, k) => ({ requestId: 'r' + k, content: rep(30), seq: k + 1, at: 'T' })) // 90 码点
  // ① 缺省 0.8：窗口 100 ⇒ 90% 触发
  assert.equal(cmp.handoff(chunks, 100).triggered, true, '缺省阈值 = 0.8（v10 原文「窗口 80% 触发」）')
  assert.equal(cmp.handoff(chunks, 100).threshold, 0.8, '缺省阈值必须回填（供判据核"配置真生效"）')
  // ② 显式更严 0.95：同一输入**不**触发 ⇒ 证明阈值真的参与判断
  const strict = cmp.handoff(chunks, 100, { compressAtRatio: 0.95 })
  assert.equal(strict.triggered, false, '阈值 0.95 时同 90% 不得触发（阈值写死在这里红）')
  assert.equal(strict.ratio, 0.9, '比例 0.9 必须如实回报')
  // ③ 反向：显式更松 0.5 ⇒ 触发（证明确实按传入值判，不是恒 true/false）
  assert.equal(cmp.handoff(chunks, 100, { compressAtRatio: 0.5 }).triggered, true, '阈值 0.5 时同输入必触发')
  // ④ 边界：恰好在阈值上（ratio == threshold）⇒ **不得**触发（严格大于，与两闸同口径）
  const exact = cmp.handoff(chunks, 90, { compressAtRatio: 0.9 })
  assert.equal(exact.ratio, 1, '窗口 90 / 内容 90 ⇒ ratio = 1')
  const exactAt = cmp.handoff([{ requestId: 'a', content: rep(90), seq: 1, at: 'T' }], 100, { compressAtRatio: 0.9 })
  assert.equal(exactAt.ratio, 0.9, '恰好在阈值')
  assert.equal(exactAt.triggered, false, '恰在阈值上不得触发（边界是 > 不是 >=）')
  // ⑤ 无闸：窗口 <= 0 ⇒ 不算比例、不触发（不是"一律触发"）
  const noGate = cmp.handoff(chunks, 0)
  assert.equal(noGate.triggered, false, '窗口 0 = 该轴不设闸 ⇒ 不触发')
  assert.equal(noGate.ratio, null, '无闸时比例**不可算** ⇒ 如实回报 null（不编一个 0/1 冒充）')
})

test('C9 第二层：未触发时五段**仍然齐全**（空数组而非缺键），且记账如实', () => {
  const chunks = [{ requestId: 'a', content: rep(10), seq: 1, at: 'T' }]
  const r = cmp.handoff(chunks, 1000) // 1% ⇒ 不触发
  assert.equal(r.triggered, false)
  assert.deepEqual(Object.keys(r.summary).sort(), [...cmp.HANDOFF_KEYS].sort(), '未触发也必须五键齐全（防静默丢键）')
  for (const k of cmp.HANDOFF_KEYS) assert.deepEqual(r.summary[k], [], '未触发时各段为空数组')
  assert.equal(r.savedChars, 0, '未触发 ⇒ 没省（0 与"没压过"可分辨）')
  assert.equal(r.beforeChars, r.afterChars, '未触发 ⇒ 压前=压后')
  assert.equal(r.retention, 'caller-owned', '原文去向必须**如实回报**为调用方持有（不假装已落盘）')
})

test('C10 第二层：摘要反超原文时**如实报负**（不 clamp 成 0 —— 那会掩盖"越压越大"）', () => {
  // 短会话：3 条各 30 码点 = 90，摘要有 JSON 骨架开销 ⇒ 可能更长
  const chunks = Array.from({ length: 3 }, (_, k) => ({ requestId: 'r' + k, content: rep(30), seq: k + 1, at: 'T' }))
  const r = cmp.handoff(chunks, 100)
  assert.equal(r.triggered, true)
  // 实测：摘要 182 > 原文 90 ⇒ savedChars 必须为**负**且 reduced=false
  assert.equal(r.savedChars, r.beforeChars - r.afterChars, 'savedChars 必须与前后读数同源（可为负）')
  if (r.afterChars > r.beforeChars) {
    assert.ok(r.savedChars < 0, '摘要反超时 savedChars 必须为负（clamp 成 0 = 把"越压越大"显示成"省了 0"）')
    assert.equal(r.reduced, false, 'reduced 必须如实为 false（这条就是"压不动"的读数）')
  } else {
    assert.ok(r.reduced === true && r.savedChars > 0, '真省了则 reduced=true 且 savedChars>0')
  }
  // maxAnchors 边界腿：把锚点压到 1 条 ⇒ anchorsDropped 精确记账（不得静默截断）
  const bounded = cmp.handoff(chunks, 100, { maxAnchors: 1 })
  assert.equal(bounded.summary.Anchors.length, 1, 'maxAnchors=1 ⇒ 只列 1 条')
  assert.equal(bounded.anchorsDropped, 2, '被省掉的条数必须**精确记账**（静默截断在这里红）')
  assert.ok(bounded.afterChars < r.afterChars, '限锚后摘要应变小（证明 maxAnchors 真参与）')
})

// ══ 第三层：长期记忆注入 ═════════════════════════════════════════════════════

test('C11 第三层：预算闸真动作 + **记账恒等式**（丢的 + 截的 + 留的 == 原来的）', () => {
  const chunks = Array.from({ length: 3 }, (_, k) => ({ requestId: 'r' + k, content: rep(30), seq: k + 1, at: 'T' }))
  // ① 恰满预算：不得丢（边界是 > 不是 >=）
  const exact = cmp.injectPlan(chunks, 90)
  assert.equal(exact.truncated, false, '恰满预算 ⇒ 不得丢（严格大于才动作）')
  assert.deepEqual([exact.droppedChunks, exact.droppedChars, exact.truncatedChars], [0, 0, 0])
  assert.equal(exact.injected, 3, '恰满 ⇒ 3 条全注')
  // ② 超 1 码点：必丢最旧
  const over = cmp.injectPlan(chunks, 89)
  assert.equal(over.truncated, true, '超 1 码点也必须动作（死开关在这里恒 false）')
  assert.equal(over.droppedChunks, 1, '多块 ⇒ 丢最旧 1 条')
  assert.deepEqual(over.dropped.map((c) => c.requestId), ['r0'], '丢的必须是**最旧**那条')
  assert.equal(over.injected, 2, '留最新 2 条')
  // ③ **恒等式**：beforeChars === afterChars + droppedChars + truncatedChars（记账不漏不重）
  assert.equal(
    over.beforeChars,
    over.afterChars + over.droppedChars + over.truncatedChars,
    '记账恒等式必须成立（少一项 = 内容被静默丢掉；多一项 = 虚报）',
  )
  // ④ 被丢条目**保留身份**（供回查），不是无声消失
  assert.equal(over.dropped.length, over.droppedChunks, '被丢条目必须原样留在 dropped 里（可回查）')
  for (const d of over.dropped) assert.equal(typeof d.content, 'string', '被丢条目必须保留内容（不是只留个 id）')
})

test('C12 第三层退化腿：预算 < 单条自身 ⇒ 截断**最新那条**保就绪性下限，且截量进 truncatedChars', () => {
  const chunks = Array.from({ length: 3 }, (_, k) => ({ requestId: 'r' + k, content: rep(30), seq: k + 1, at: 'T' }))
  const r = cmp.injectPlan(chunks, 10) // 远小于单条 30
  assert.equal(r.injected, 1, '必须保留**至少 1 条**（就绪性下限：漏填配置不得退化为静默全丢）')
  assert.equal(r.afterChars, 10, '截到恰好等于预算')
  assert.equal(r.truncatedChars, 20, '截掉 30-10 = 20 码点（记量，不只记次数）')
  assert.equal(r.droppedChunks, 2, '另 2 条整体丢弃')
  assert.equal(r.droppedChars, 60, '整体丢弃 2 × 30 = 60 码点')
  // ⚠ 恒等式在退化路径上同样成立（上一版在这里记了两笔账 ⇒ 本腿就是那次自纠的锚点）
  assert.equal(
    r.beforeChars,
    r.afterChars + r.droppedChars + r.truncatedChars,
    '退化路径的恒等式必须成立（同一条内容不得既算"丢了"又算"留了"）',
  )
  assert.equal(r.beforeChars, 90, '原 3 × 30')
  // 存活的那条必须是**最新**的（保最新、弃最旧 —— 与两闸同构）
  assert.equal(r.content, chunks[2].content.slice(0, 10), '留下的是最新那条的截断版')
})

test('C13 第三层"不设闸"：budgetChars<=0 ⇒ 全注入、零丢弃（不是"一字不留"）+ 反向对照', () => {
  const chunks = Array.from({ length: 3 }, (_, k) => ({ requestId: 'r' + k, content: rep(30), seq: k + 1, at: 'T' }))
  const no = cmp.injectPlan(chunks, 0)
  assert.equal(no.truncated, false, '预算 0 = 该轴不设闸 ⇒ 不截')
  assert.deepEqual([no.injected, no.droppedChunks, no.afterChars], [3, 0, 90], '无闸 ⇒ 90 码点全注、零丢')
  assert.equal(no.dropped.length, 0)
  // 反向对照：同 3 条、预算 50 ⇒ 必动作（否则"无上限"与"闸从不动作"同形）
  const yes = cmp.injectPlan(chunks, 50)
  assert.equal(yes.truncated, true, '反向对照：预算 50 时同 3 条必动作')
  assert.ok(yes.droppedChunks > 0, '必有丢弃并被记账')
  // 口径腿：按**码点**计不是按 UTF-16 单元（'𝌆' = 1 码点 / 2 单元 / 4 字节）
  const astral = cmp.injectPlan([{ requestId: 'u', content: '𝌆'.repeat(5), seq: 1, at: 'T' }], 5)
  assert.equal(astral.beforeChars, 5, 'chars 必须按码点计（按 UTF-16 会算成 10）')
  assert.equal(astral.truncated, false, '5 码点恰满 5 ⇒ 不得截断')
})

test('C14 第三层缺省预算 = 2000 **字符**（不是 token），且 LAYER3 常量与 budgetChars 独立', () => {
  // ① 常量本身
  assert.equal(wmMod.LAYER3_DEFAULT_BUDGET_CHARS, 2000, 'v10 §30.2 第三层预算缺省 = 2000')
  // ② 服务面缺省走它：1000 码点 < 2000 ⇒ 不截；3000 码点 > 2000 ⇒ 截
  return (async () => {
    const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 0 }) // 两闸关掉，隔离本层
    const wm = ctx.get('mana-working-memory')
    assert.equal(wm.snapshot().chunks.length, 0, '前置：工作记忆初始为空')
    // 直接喂服务（capacity/budget 均为 0 = 都不设闸，故 3000 码点能进得来）
    wm.push(att(1, rep(1000)))
    const small = wm.injectPlan()
    assert.equal(small.budgetChars, 2000, '缺省预算必须 = 2000（读回 = 常量，不各写一遍）')
    assert.equal(small.truncated, false, '1000 码点 < 2000 ⇒ 不截')
    wm.push(att(2, rep(2000)))
    const big = wm.injectPlan()
    assert.equal(big.truncated, true, '3000 码点 > 2000 ⇒ 必截（缺省值真参与判断）')
    assert.equal(big.beforeChars, 3000)
    assert.ok(big.afterChars <= 2000, '截后不得越过预算上界')
    // ③ 与 budgetChars **独立**：两闸关了（budgetChars=0）本节预算照样 = 2000
    assert.equal(wm.status().budgetChars, 0, '前置：两闸的 budgetChars 此时为 0（关）')
    assert.equal(wm.injectPlan().budgetChars, 2000, '本节预算**独立**于 budgetChars（改一个不得带动另一个）')
  })()
})

// ══ 两闸回归（压缩路径不得动既有语义 —— 逐条点名）═══════════════════════════

test('R1 回归·两闸语义零改动：容量闸"严格大于才动作 + 记 evicted"在压缩接线后逐条不变', async () => {
  const cap = 4
  const { ctx } = await bootDirect({ capacityChunks: cap })
  const wm = ctx.get('mana-working-memory')
  // 逐条点名复跑 W1 的三点边界（**不**改既有文件，本条是接线后的独立复核）
  assert.equal(wm.push(att(1)), false)
  assert.equal(wm.push(att(2)), false)
  assert.equal(wm.push(att(3)), false)
  const three = wm.snapshot()
  assert.equal(three.evicted, 0, '容量−1：零逐出')
  assert.equal(wm.push(att(4)), false, '恰满容量不得逐出（> 而非 >=）')
  assert.equal(wm.snapshot().evicted, 0, '恰满：仍零逐出')
  assert.equal(wm.push(att(5)), true, '容量+1：必须报逐出')
  const s = wm.snapshot()
  assert.equal(s.evicted, 1, 'evicted 精确记账')
  assert.deepEqual(s.chunks.map((c) => c.requestId), ['req-2', 'req-3', 'req-4', 'req-5'], '逐出最旧、保最新')
  assert.equal(s.chunks.length, cap)
})

test('R2 回归·两闸语义零改动：预算闸"多块逐出/单块截断/三笔分账"在压缩接线后逐条不变', async () => {
  // 多块逐出（(乙)）
  const a = await bootDirect({ capacityChunks: 0, budgetChars: 299 })
  const wa = a.ctx.get('mana-working-memory')
  wa.push(att(1, rep(100))); wa.push(att(2, rep(100)))
  assert.equal(wa.push(att(3, rep(100))), true, '超预算 1 码点必报逐出')
  assert.deepEqual(
    [wa.snapshot().chunks.length, wa.snapshot().chars, wa.snapshot().budgetEvicted, wa.snapshot().truncated],
    [2, 200, 1, 0], '多块 ⇒ 逐出最旧、预算账 +1、截断账 0',
  )
  // 单块截断（(丙)/(丁)）
  const b = await bootDirect({ capacityChunks: 0, budgetChars: 10 })
  const wb = b.ctx.get('mana-working-memory')
  assert.equal(wb.push(att(1, rep(100))), false, '截断不算逐出（返回值不得被污染）')
  assert.deepEqual(
    [wb.snapshot().chunks.length, wb.snapshot().chars, wb.snapshot().truncated, wb.snapshot().truncatedChars, wb.snapshot().budgetEvicted],
    [1, 10, 1, 90, 0], '单块 ⇒ 截断到恰满、截量 90、逐出账 0',
  )
  // 顺序钉死（(丙)）：正序 = evicted:1 / budgetEvicted:0；逆序会得到另一组
  const c = await bootDirect({ capacityChunks: 1, budgetChars: 4 })
  const wc = c.ctx.get('mana-working-memory')
  wc.push(att(1, rep(5))); wc.push(att(2, rep(5)))
  assert.deepEqual(
    [wc.snapshot().chunks.length, wc.snapshot().chars, wc.snapshot().evicted, wc.snapshot().budgetEvicted, wc.snapshot().truncated, wc.snapshot().truncatedChars],
    [1, 4, 1, 0, 2, 2], '记账归属必须与"先容量后预算"一致（逆序实现会得 evicted:0/budgetEvicted:1 ⇒ 必红）',
  )
})

test('R3 回归·两闸"不设闸"语义 + 既有读数键集：压缩接线后 <0 语义与 snapshot 键集一字不变', async () => {
  // (甲) capacityChunks=0 ⇒ 无上限（12 条全留、零逐出）+ 反向对照
  const a = await bootDirect({ capacityChunks: 0, budgetChars: 4000 })
  const wa = a.ctx.get('mana-working-memory')
  for (let i = 1; i <= 12; i += 1) assert.equal(wa.push(att(i)), false, '容量 0 ⇒ push 恒不报逐出')
  assert.deepEqual([wa.snapshot().chunks.length, wa.snapshot().evicted], [12, 0], '无闸 ⇒ 12 条全留、零逐出')
  const b = await bootDirect({ capacityChunks: 4, budgetChars: 4000 })
  const wb = b.ctx.get('mana-working-memory')
  for (let i = 1; i <= 12; i += 1) wb.push(att(i))
  assert.deepEqual([wb.snapshot().chunks.length, wb.snapshot().evicted], [4, 8], '反向对照：容量 4 时同 12 条必逐 8')
  // (乙) budgetChars=0 ⇒ 无上限（不截不逐）
  const c = await bootDirect({ capacityChunks: 0, budgetChars: 0 })
  const wc = c.ctx.get('mana-working-memory')
  wc.push(att(1, rep(100))); wc.push(att(2, rep(100))); wc.push(att(3, rep(100)))
  assert.deepEqual(
    [wc.snapshot().chars, wc.snapshot().budgetEvicted, wc.snapshot().truncated, wc.snapshot().chunks.length],
    [300, 0, 0, 3], '预算 0 ⇒ 300 字全留、逐字不截',
  )
  // (丙) **既有 snapshot 键集一字不变**（W5 有逐字断言 ⇒ 压缩账另开面，不往这里叠键）
  assert.deepEqual(
    Object.keys(wa.snapshot()).sort(),
    ['budgetChars', 'budgetEvicted', 'capacityChunks', 'chars', 'chunks', 'evicted', 'truncated', 'truncatedChars'],
    'snapshot 键集必须与压缩接线前**逐字相同**（叠键会让既有 W5 断言变红 = 动了既有判据契约）',
  )
  assert.deepEqual(Object.keys(wa.snapshot().chunks[0]).sort(), ['at', 'content', 'requestId', 'seq'], '组块键集不变')
  // (丁) 压缩账**独立成面**（不污染既有两个面）
  const stats = wa.compressionStats()
  assert.deepEqual(
    Object.keys(stats).sort(),
    ['compressedRuns', 'degradedRuns', 'foldedChunks', 'lastFailure', 'runs', 'savedChars'],
    '压缩记账必须是**独立面**（往 status/snapshot 叠键会动既有判据锚点）',
  )
  assert.deepEqual(
    [stats.runs, stats.compressedRuns, stats.lastFailure],
    [0, 0, null], '未调用过压缩 ⇒ 四枚计数为 0、failure 为 null（0 与"压过"可分辨）',
  )
  // 两闸路径**不得**推进压缩账（"分账"的机检点）
  assert.equal(wa.compressionStats().runs, 0, 'push 两闸路径**不得**推进压缩计数（分账必须可分辨）')
})

// ══ 服务面接线 + 审计不泄内容 ════════════════════════════════════════════════

test('C15 服务面：compress() 真改内部状态 + 累计记账 + dry-run 不落地（且两种模式记账同形）', async () => {
  const { ctx } = await bootDirect({ capacityChunks: 2, budgetChars: 4000 })
  const wm = ctx.get('mana-working-memory')
  // 直接喂 5 条进内部集（capacity=2 ⇒ 两闸会把 size 夹在 2 ⇒ 换个方式：用大容量装配）
  const { ctx: ctx2 } = await bootDirect({ capacityChunks: 0, budgetChars: 0 }) // 都不设闸，喂得进去
  const wm2 = ctx2.get('mana-working-memory')
  for (let i = 1; i <= 5; i += 1) wm2.push(att(i, rep(10)))
  assert.equal(wm2.snapshot().chunks.length, 5, '前置：两闸都关 ⇒ 5 条都在')

  // ① dry-run：只试算不落地 ⇒ 内部状态**不变**，但记账读数完整
  const dry = wm2.compress({ capacityChunks: 2, apply: false })
  assert.equal(dry.compressed, true, 'dry-run 也要真算出压缩结果')
  assert.equal(wm2.snapshot().chunks.length, 5, 'apply=false ⇒ **不得**改动内部状态（试算不落地）')
  assert.deepEqual(
    [dry.beforeChunks, dry.afterChunks, dry.beforeChars, dry.afterChars, dry.savedChars],
    [5, 2, 50, 26, 24],
    'dry-run 记账读数（实测：摘要 16 + 保留原文 10 = 26 ⇒ 省 24）',
  )

  // ② apply：真落地 ⇒ 内部状态变短
  const applied = wm2.compress({ capacityChunks: 2 })
  assert.equal(applied.compressed, true)
  assert.equal(wm2.snapshot().chunks.length, 2, 'apply ⇒ 内部条数真降到上界内')
  assert.equal(wm2.snapshot().chars, 26, 'apply ⇒ 内部 chars 与记账 afterChars 一致')

  // ③ 累计记账：两次调用都计入（dry-run 也算"跑过"——它是真算过的）
  const st = wm2.compressionStats()
  assert.deepEqual([st.runs, st.compressedRuns], [2, 2], '两次调用两次记账（dry-run 也真算过）')
  assert.equal(st.foldedChunks, 8, '两次各折 4 条 ⇒ 累计 8')
  assert.equal(st.savedChars, 48, '两次各省 24 ⇒ 累计 48')
  assert.equal(st.degradedRuns, 0, '无降级')
  assert.equal(st.lastFailure, null, '无降级 ⇒ failure 为 null')

  // ④ 压完再压：已经不超上界 ⇒ 不动作（幂等，不 phantom 记账）
  const again = wm2.compress({ capacityChunks: 2 })
  assert.equal(again.compressed, false, '压到上界内后再压 ⇒ 不动作（不做无意义的重复压缩）')
  assert.equal(wm2.compressionStats().compressedRuns, 2, '未压缩的那次不得推进 compressedRuns')
  assert.equal(wm2.compressionStats().runs, 3, '但 runs 记 3（跑过 3 次，0 与"没跑过"可分辨）')

  // ⑤ 门面自洽：ctx 上另一实例（capacity=2）两闸行为不受压缩面存在影响
  assert.equal(wm.snapshot().chunks.length, 0, '另一实例互不干扰（无跨实例共享状态）')
})

test('C16 审计不泄内容 + 不新增事件类型：压缩面**不写 mana_trace**、且记账字段不含内容原文', async () => {
  const { ctx, store } = await bootDirect({ capacityChunks: 0, budgetChars: 0 })
  const wm = ctx.get('mana-working-memory')
  const secret = '机密内容XYZ'
  for (let i = 1; i <= 5; i += 1) wm.push(att(i, secret + rep(5)))
  wm.compress({ capacityChunks: 2 })
  wm.handoff(10)
  wm.injectPlan(10)
  await settle(200)

  // ① 压缩面**不写库**（8 事件契约不动：直接喂服务不经事件总线 ⇒ 库里应无 WM 行）
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(store, { readOnly: true })
  const rows = db.prepare('SELECT seq, event_type, payload FROM mana_trace ORDER BY seq').all()
  db.close()
  assert.equal(rows.length, 0, '压缩面（直接调服务）**不得**新增 mana_trace 行（8 事件契约不动）')
  // ② 记账字段**不含内容原文**（审计不泄内容 —— 压缩账同样是审计面）
  const stats = wm.compressionStats()
  assert.equal(JSON.stringify(stats).includes(secret), false, '压缩记账不得内嵌内容原文')
  const h = wm.handoff(10)
  assert.equal(JSON.stringify(h).includes(secret), false, '交接摘要不得内嵌内容原文（它是定位串不是副本）')
  // 摘要里的定位串只含 requestId/seq（可回查），足够定位但不泄原文
  assert.ok(h.summary.Anchors.every((a) => a.startsWith('req:')), 'Anchors 必须是定位串形态（req:…#seq:…）')
  // ③ 三层都接线在**服务面**上（不是只导出纯函数没人用 —— 那也是一种"死开关"）
  for (const m of ['compress', 'handoff', 'injectPlan', 'compressionStats']) {
    assert.equal(typeof wm[m], 'function', '服务面必须真接线 ' + m + '()（只导出不接线 = 死代码）')
  }
  // ④ 事件面监听器清单不变（不新增事件类型的结构腿）
  const listeners = []
  const effects = []
  const fake = {
    get: () => ({ plugin: 'mana-core', writeTrace: () => 1 }),
    on: (evt, fn) => listeners.push({ evt, fn }),
    effect: (fn) => { effects.push(1); return fn() },
    provide: () => () => {},
  }
  wmMod.apply(fake, { capacityChunks: 2, budgetChars: 100 })
  assert.deepEqual(
    listeners.map((l) => l.evt), ['mana/attention', 'agent/pre-step'],
    '监听器面必须不变（新增事件类型会在这里红）',
  )
  assert.equal(effects.length, 1, 'effect 注册点数不变（仍恰 1 个）')
  assert.equal(MANA_STAGES.length, 5, 'S1 五类 stage 契约不变')
})
