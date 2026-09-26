/**
 * 面⑥ **负向对拍**（本包自有判据面 · F2 席新建）——「没有负向对拍 = 没做完」的落点。
 *
 * ## 五条对拍（每条打**一个**靶，不合并）
 * | 编号 | 变异（打在 lib —— 判据真正读取的那一层） | 哪条正向腿必红 |
 * |---|---|---|
 * | N1 | 把 `reset` 那一类的写入点改成另一个枚举 | G1-⑤ / G1-⑥（该类不可达） |
 * | N2 | 把 fail-closed 的两个闸改成恒假（= 降级时照常注入） | G2-① / G2-③（fail-open） |
 * | N3 | **摘掉 `await next()`** | G3-④（下游收不到；G9 核心） |
 * | N4 | 把一个 trace 标签换成**另一个 S1 类**（不冒充前缀，只串类） | G5-①（标签集合等式） |
 * | N5 | 摘掉预算闸（超限不再截断） | G4-③（截断腿） |
 *
 * ## 三条纪律（本仓血的教训，逐条落在此文件的实现里）
 *  · **对拍要打对靶**：变异改的是 **lib**（`ctx.loader` / 临时目录装载的解析面就是它），
 *    若改 `src` 而不重建，变异**从未生效**、读数却像「判据没牙」。
 *  · **仓内零写入**：变异只写临时目录；每个用例前后各取一次 `sha256`（src + lib + core lib）
 *    并断言**逐字节不变**、变异体文件确实与真源不同。不得靠 mtime 说事（可被 cp/touch 摆布）。
 *  · **负控要能真否证**：每条对拍除断言「变异后必红」外，还断言**前置成立**
 *    （变异体真装载了、真有注入发生过）——否则「没数到东西」会被误读成「判据有牙」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, firePreStep, perceive, readInject, readTrace, judgedSurface, ROOT, messageText } from './_harness.mjs'

/**
 * 每个对拍：① 仓内零写入取证 → ② 变异 → ③ 断言「正向腿必红」的事实 → ④ 再取证。
 *
 * @param mutation `{ replace: [[anchor, replacement]], boot?: {...} }` —— `replace` 交给夹具改写 **lib**。
 */
async function negativeControl(name, mutation, run) {
  const before = judgedSurface()
  const b = await boot({ ...(mutation.boot ?? {}), mutant: { replace: mutation.replace } })
  assert.ok(b.attention, `${name}: 变异体必须真被装载（否则下面的读数什么都没数到）`)
  // 判据读取面确实是**变异体**：装载它的模块文件在临时目录，且与仓内 lib 逐字不同
  assert.ok(b.dir.includes('mana-f2-'), `${name}: 变异体应落在临时目录（认到 ${b.dir}）`)
  const mutantFile = join(b.dir, 'attention-mutant.mjs')
  const mutantText = readFileSync(mutantFile, 'utf8')
  assert.notEqual(
    mutantText,
    readFileSync(join(ROOT, 'packages', 'attention', 'lib', 'index.js'), 'utf8'),
    `${name}: 变异文本与真源逐字相同 ⇒ 变异未生效`,
  )
  const finding = await run(b)
  const after = judgedSurface()
  assert.deepEqual(after, before, `${name}: 对拍**不得写仓**（sha256 逐字节比对）`)
  return finding
}

// ── N1：reset 类的写入点被摘掉 ⇒ 该类不可达 ────────────────────────────────
test('N1 摘掉 reset 写入点 ⇒ 该类不可达（G1-⑤/G1-⑥ 必红）', async () => {
  const finding = await negativeControl(
    'N1',
    // ⚠ 锚点随实现改名（G1 重派席修 D1 时，reset 那一类的写入点由 `finish('reset')`
    //   变为 `finish('reset', { reset: true, blockId })`）—— **语义逐条不变**：
    //   仍是「把 reset 那一类的写入点改成另一个枚举」⇒ 该类不可达 ⇒ G1-⑤/G1-⑥ 必红。
    //   ⚠ 同步登记：`packages/attention/verify.mjs` 的 MUTATION_ANCHORS（闸⑥ 逐字比对）。
    { replace: [["finish('reset', { reset: true,", "finish('skip_no_candidate', {"]] },
    async ({ ctx, store }) => {
      perceive(ctx, { content: '候选·N1', requestId: 'req-n1' })
      await firePreStep(ctx, { turn: 1 }) // 真注入
      await firePreStep(ctx, { turn: 2, messages: [] }) // 块离开上下文
      const rows = readInject(store)
      return { gates: rows.map((r) => r.gate) }
    },
  )
  // 前置：注入真的发生过（否则「没有 reset」可能只是整条链没跑起来）
  assert.ok(finding.gates.includes('injected'), `前置不成立：${JSON.stringify(finding.gates)}`)
  assert.equal(
    finding.gates.includes('reset'),
    false,
    `变异后仍能记出 reset ⇒ 变异没打对靶：${JSON.stringify(finding.gates)}`,
  )
  assert.ok(finding.gates.includes('skip_no_candidate'), '被换成的那个枚举应真的出现（说明走到了替换后的写入点）')
})

// ── N2：fail-closed → fail-open（降级时照常注入）────────────────────────────
test('N2 把 fail-closed 两闸改成恒假 ⇒ 降级时照常注入（G2-①/G2-③ 必红）', async () => {
  const finding = await negativeControl(
    'N2',
    {
      // 场景必须是**判定链降级**（否则「两个闸恒假」与正常路径无差别，拍不到 fail-open）
      boot: { judge: 'degraded' },
      replace: [
        ['if (!judge || judge.degraded === true) {', 'if (false) {'],
        ['if (prob === null || prob < config.jevThreshold) {', 'if (false) {'],
      ],
    },
    async ({ ctx, store }) => {
      perceive(ctx, { content: '候选·N2', requestId: 'req-n2' })
      const decision = await firePreStep(ctx, { turn: 1 })
      return { rows: readInject(store), msgCount: decision.messages.length, text: messageText(decision.messages[0] ?? {}) }
    },
  )
  // 前置：判定链确实降级了（夹具侧读数），而变异体却把块塞进了上下文 —— 这就是 fail-open。
  assert.ok(
    finding.msgCount > 0,
    '变异后**仍然不注入** ⇒ fail-open 这个对拍没打中（G2-① 不会红 ⇒ 该对拍无牙）',
  )
  assert.ok(finding.text.includes('<mana-memory>'), 'fail-open 时应真把块塞进了上下文（这才是「照常注入」）')
  assert.notEqual(finding.rows[0].gate, 'degraded_unavailable', `变异后审计行反而记着降级（${finding.rows[0].gate}）⇒ 变异没打对靶`)
  assert.equal(finding.rows[0].gate, 'injected', `fail-open 的形态是「自己记 injected 并真注入」：实得 ${finding.rows[0].gate}`)
  assert.equal(finding.rows[0].degraded, 0, 'fail-open 还会把降级事实一起抹掉（degraded 列变 0）——两条腿同时崩')
})

// ── N3：摘掉 `await next()` ⇒ 下游收不到（**本批的核心对拍**）───────────────
test('N3 摘掉 next() ⇒ 下游收不到（G3-④ 必红；G9 核心）· 症状改判见下', async () => {
  const finding = await negativeControl(
    'N3',
    // ⚠ **本批 impl 席同步改名并写明理由**：原锚点 `const downstream = await next();` 在本批被改名成
    //   `const nextResult = await next()`（D2 守卫需要先按 unknown 接住返回值再判可用性）。
    //   **next() 的调用位置一个字节没动**（lib 里仍是那唯一一行，仍在自包门控内）。
    //   锚点改名不是"放宽"：新锚点同样必须**恰好命中 1 次**，否则 applyMutation 直接抛。
    { replace: [['const nextResult = await next()', 'const nextResult = undefined']] },
    async ({ ctx, store, arm, downstreamCount }) => {
      perceive(ctx, { content: '候选·N3', requestId: 'req-n3' })
      const hostMsg = { id: 'm-host', role: 'user', content: [{ type: 'text', text: '宿主本步的消息' }], source: { kind: 'user' } }
      const off = arm()
      let threw = null
      let decision
      try {
        decision = await firePreStep(ctx, { turn: 1, messages: [hostMsg] })
      } catch (e) {
        threw = e
      }
      const hits = downstreamCount()
      off()
      return { hits, threw, decision, rows: readInject(store) }
    },
  )
  /**
   * ⚠ **本批改判（impl 席 · D2）—— 症状描述改了，咽喉没松**：
   *   修前：该变异体**不报错**，把宿主消息静默吃掉，自己还写一行 `injected` 假账。
   *   修后：D2 守卫让同一变异体**响亮失败**（`ok` 的"不报错"这条**形态**因此反转）。
   *   仍被强制要求的硬读数（一条没放宽）：
   *     ① 下游**没**拿到控制权（`hits === 0`，G9 本体）；
   *     ② 抛的是本包**具名**错误（可被上层分类，不是偶然 TypeError）；
   *     ③ `inject_log` **零行**（抛点在写审计之前 ⇒ 不留假账）。
   *   修前那条"假账 + 静默吃消息"的形态并未失去覆盖：见 `session-isolation.test.mjs` 的 `Z-②`。
   */
  assert.ok(finding.threw, '变异体（漏调 next()）必须**响亮失败**（修后形态：D2 守卫把它变成可观测错误）')
  assert.match(String(finding.threw.message), /上游 pre-step 监听器调了 next\(\) 却没有把它的返回值传下来/, '抛出的应是本包具名错误（不是偶然的 TypeError）')
  assert.equal(finding.hits, 0, `变异后下游仍被调到（${finding.hits} 次）⇒ 该对拍无牙`)
  assert.equal(finding.decision, undefined, '变异体不得返回任何决策（它在下游未交出控制权时就失败了）')
  assert.equal(finding.rows.length, 0, `不得留下审计行（实得 ${finding.rows.length}）—— "没做"不许留成"做了"`)
})

// ── N4：trace 标签换成**另一个 S1 类**（串类，不冒充前缀）────────────────────
test('N4 把 injection 段写成 recall 类 ⇒ 标签集合等式必红（而「只查是否在五类内」的弱判据会漏）', async () => {
  const finding = await negativeControl(
    'N4',
    { replace: [['eventType: stageLabel(4),', 'eventType: stageLabel(3),']] },
    async ({ ctx, store }) => {
      perceive(ctx, { content: '候选·N4', requestId: 'req-n4' })
      await firePreStep(ctx, { turn: 1 })
      return { labels: readTrace(store).map((t) => t.event_type) }
    },
  )
  // ⚠ 关键读数：标签**仍在 S1 五类之内**（recall 是合法类）⇒
  //   「断言标签 ⊆ 五类」的弱判据在此**照样是绿的**；只有**集合等式**能抓到这个串类。
  assert.ok(finding.labels.includes('recall'), `前置：换成的那一类应出现，实得 ${JSON.stringify(finding.labels)}`)
  assert.equal(finding.labels.includes('injection'), false, `injection 段仍写着 injection ⇒ 变异没打对靶：${JSON.stringify(finding.labels)}`)
  assert.notDeepEqual(
    finding.labels,
    ['observation', 'attention', 'decision', 'injection'],
    '标签集合等式必须报红（这正是 G5-① 用的判据形态）',
  )
})

// ── N5：摘掉预算闸（超限不再截断）⇒ G4-③ 必红 ──────────────────────────────
test('N5 摘掉预算闸 ⇒ 超限不再截断（G4-③ 必红）', async () => {
  const cap = 120
  const finding = await negativeControl(
    'N5',
    { replace: [['if (injectionBudgetCharsOf(raw) > config.injectionBudgetChars) {', 'if (false) {']] },
    async ({ ctx, attention }) => {
      perceive(ctx, { content: '长内容'.repeat(200), requestId: 'req-n5' })
      return { block: attention.buildBlock() }
    },
  )
  assert.ok(
    [...finding.block].length > cap + '</mana-memory>'.length + 1,
    `变异后块仍被截断（码点数 ${[...finding.block].length}）⇒ 该对拍没打中`,
  )
  assert.ok(finding.block.includes('长内容'.repeat(10)), '未截断 ⇒ 长内容应完整在内（这才是「闸被摘掉」）')
})
