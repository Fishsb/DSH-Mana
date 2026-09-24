/**
 * `dsh-mana-scheduler` 判据测试（批次 B2.2 · P1）。
 *
 * 判据分四组，**每组都对着一条会掩盖失败的形态**：
 *  A. 插件形状 + 真 Context 装配（服务可读 = 真跑起来的唯一判据，见 handoff-protocol 装配面约定 #3）
 *  B. **G9 next() 义务可证**：用下游哨兵证明监听器真的放行了下游；并带**负向对照**
 *     （插一个不调 next() 的监听器 ⇒ 哨兵必须走不到），否则"哨兵被走到"可能只是巧合
 *  C. **unhandledRejection（静默通道）**：子进程探针，断言计数 0 → 1；
 *     同时给同步监听器的对照（错误在调用方可见）——证明"静默"是 async 独有的性质
 *  D. 目标栈 + SOAR 三阶段的 **A 档确定性锚点**（序 / 计数 / 枚举），零毫秒阈值
 *  E. 反证判据（R 形态）：卸载 scheduler 后同一触发不再产生新行；**带正向前置控制**
 *  F. 回归自检：根配置与 core 契约哈希未被本轮改动污染
 *
 * 运行：node --test "tests/*.test.mjs"（退出码 0 = 通过；**禁止用管道取 $?**）
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url) // packages/
const REPO = new URL('../', ROOT) // 仓根（docs/contract 在这一层）
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const EXPECTED_CASES = 14
let ran = 0

const cleanups = []
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})
let currentStore = null
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'mana-sched-'))
  cleanups.push(dir)
  currentStore = { path: join(dir, 'mana.db'), dir }
})
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/** 装载一个包到真 Context。core 必须显式传 storePath（缺省会写真实库）。 */
function mount(ctx, mod) {
  return ctx.plugin(mod, mod.name === 'mana-core' ? { storePath: currentStore.path } : {})
}

async function mountCoreAndScheduler() {
  const ctx = new Context()
  const core = await load('core')
  const sched = await load('scheduler')
  const coreFiber = mount(ctx, core)
  await settle(200)
  const schedFiber = mount(ctx, sched)
  await settle(300)
  return { ctx, coreFiber, schedFiber }
}

// ══ A. 形状 + 真装配 ═════════════════════════════════════════════════════════
test('A1 形状齐备（name/inject/Config/apply + cordis.patch.yml）', async () => {
  ran += 1
  const mod = await load('scheduler')
  assert.equal(mod.name, 'mana-scheduler')
  assert.deepEqual(mod.inject, ['mana-core'], 'scheme §9.1：scheduler 依赖仅 core')
  assert.ok(mod.Config, '缺 Config（bundle 装配面需要）')
  assert.equal(typeof mod.apply, 'function')
  const patch = fileURLToPath(new URL('scheduler/cordis.patch.yml', ROOT))
  assert.ok(existsSync(patch), '缺 cordis.patch.yml ⇒ bundle 装不上')
})

test('A2 真 Context 装载：服务可读 + status().wired === true', async () => {
  ran += 1
  const { ctx } = await mountCoreAndScheduler()
  const svc = ctx.get('mana-scheduler')
  assert.ok(svc, 'mana-scheduler 服务必须可读（未 provide = 插件没真跑起来）')
  assert.equal(svc.status().wired, true)
  assert.equal(svc.status().plugin, 'mana-scheduler')
  assert.equal(svc.status().goalCount, 0, '初始目标栈必须为空（0 是合法值，显式记 0）')
  assert.equal(svc.status().topGoalId, null, '无目标时 top 必须是 null，不得 undefined')
})

// ══ B. G9：next() 义务可证 ═══════════════════════════════════════════════════
test('B1 下游哨兵被走到 ⇒ core 与 scheduler 的监听器都真的调了 next()', async () => {
  ran += 1
  const { ctx, schedFiber } = await mountCoreAndScheduler()
  // 计数口径：哨兵（链尾观察者）+ 最内层 next 各计 1。
  // dispatch 顺序 = 注册序 ⇒ [core, scheduler, 哨兵]；哨兵**只有在前两者都调了 next() 时才可能被走到**
  // ⇒ 实测 2 = 两个上游都放行。任一上游漏调，本值必为 0。
  let sentinelRuns = 0
  let innerRuns = 0
  ctx.on('agent/pre-step', async (_payload, next) => {
    sentinelRuns += 1
    return await next()
  })
  const payload = { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }

  const r1 = await ctx.waterfall('agent/pre-step', payload, async () => {
    innerRuns += 1
    return { messages: [] }
  })
  assert.equal(sentinelRuns, 1, '哨兵必须被走到（=core、scheduler 两条监听器都放行）')
  assert.equal(innerRuns, 1, '最内层 next 必须被走到（链未断）')
  assert.deepEqual(r1, { messages: [] }, '直通链不得改写 next 的返回值')

  // 隔离取证：卸掉 scheduler 后仅剩 core 一条 ⇒ 哨兵仍被走到 ⇒ core 自己也真的调了 next()。
  // （与 B2 的负向对照合起来，可分辨"哪一条漏调"而不只是"整链断了"。）
  await schedFiber.dispose()
  await settle(200)
  sentinelRuns = 0
  innerRuns = 0
  const r2 = await ctx.waterfall('agent/pre-step', payload, async () => {
    innerRuns += 1
    return { messages: [] }
  })
  assert.equal(sentinelRuns, 1, '仅 core 在链上时哨兵也必须被走到 ⇒ core 调了 next()')
  assert.deepEqual(r2, { messages: [] })
})

test('B2 负向对照：一个不调 next() 的监听器 ⇒ 哨兵必须走不到（证明 B1 的哨兵有牙）', async () => {
  ran += 1
  const { ctx } = await mountCoreAndScheduler()
  ctx.on('agent/pre-step', async () => {
    /* 故意不调 next()：这就是 G9 的"静默掐死下游" */
    return undefined
  })
  let reached = 0
  ctx.on('agent/pre-step', async (_payload, next) => {
    reached += 1
    return await next()
  })
  const payload = { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }
  const result = await ctx.waterfall('agent/pre-step', payload, async () => {
    reached += 1
    return { messages: [] }
  })
  assert.equal(reached, 0, `漏调 next() 时下游哨兵不得被走到（实测 reached=${reached}）`)
  assert.equal(result, undefined, '漏调 next() 时调用方拿到 undefined 且**不报错** —— 静默通道')
})

test('B3 本包真在 agent/pre-step 链上（effect 面 + 卸载即净）', async () => {
  ran += 1
  // ⚠ 为什么 B1 不够（R2 独立复核抓出的盲区，本席负向控制复现）：
  //   B1 只证明"链没断"—— 本包若**压根没注册监听器**，哨兵照样是 1 ⇒ B1 仍绿 = 假绿。
  //   故必须读本包 fiber 的 effect 面（cordis **公开 API** `getEffects()`），
  //   并断言卸载后该 effect 消失（"卸载即净"）。
  const { ctx, schedFiber } = await mountCoreAndScheduler()
  const hasPreStep = (fib) => (fib.getEffects() ?? []).some((e) => String(e.label).includes('agent/pre-step'))
  assert.ok(
    hasPreStep(schedFiber),
    `scheduler 必须注册 pre-step 监听器（G9 / 册:318）；实测 effect 标签 = ${JSON.stringify((schedFiber.getEffects() ?? []).map((e) => e.label))}`,
  )
  await schedFiber.dispose()
  await settle(300)
  assert.ok(!hasPreStep(schedFiber), '卸载后监听器必须随 fiber 释放（卸载即净）')
  void ctx
})

// ══ C. unhandledRejection（静默通道）═════════════════════════════════════════
test('C1 async 监听器抛错变成 unhandledRejection（计数 0→1），同步监听器则同步可见', async () => {
  ran += 1
  // ⚠ 必须走**子进程**：node:test 自己注册了 unhandledRejection 监听器
  //   ⇒ 测试进程内计数恒 ≥1，且会把整个用例判红。见 handoff 第 4 段。
  const fixture = fileURLToPath(new URL('scheduler/tests/fixtures/ur-probe.mjs', ROOT))
  const out = execFileSync(process.execPath, [fixture], { cwd: fileURLToPath(ROOT), encoding: 'utf8' })
  const lines = out
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l))
  assert.equal(lines.length, 2, `探针须输出两行 JSON，实测 ${lines.length}`)
  const [a, b] = lines

  assert.equal(a.listenersAtStart, 0, '干净子进程里 unhandledRejection 监听器数必须是 0（计数基线）')
  assert.equal(a.count, 1, `async 监听器抛错后计数必须 0→1（实测 ${a.count}）——否则失败被静默吞掉`)
  assert.equal(a.syncErrorA, null, 'emit 分发 waterfall 型事件时，async 形式的错误**同步看不到**')
  assert.match(a.lastMessage, /next is not a function/, '未处理拒绝的内容须是 G6 的真因')

  assert.equal(b.count, 1, '同步监听器抛错不得额外增加 unhandledRejection 计数')
  assert.match(b.syncErrorB, /^TypeError: next is not a function/, '同步形式错误在调用方**同步可见**')
})

// ══ D. 目标栈 + SOAR 三阶段：A 档确定性锚点 ══════════════════════════════════
test('D1 目标栈：入栈序 / 投影序 / 出栈后序 / 异常路径', async () => {
  ran += 1
  const { ctx } = await mountCoreAndScheduler()
  const svc = ctx.get('mana-scheduler')

  svc.pushGoal({ id: 'g1', title: '完成项目文档', priority: 8 })
  svc.pushGoal({ id: 'g1.2', title: '写大纲', priority: 7, parentId: 'g1' })
  svc.pushGoal({ id: 'g1.1', title: '收集资料', priority: 6, parentId: 'g1', status: 'done' })
  svc.pushGoal({ id: 'g1.3', title: '写初稿', priority: 5, parentId: 'g1', status: 'paused' })
  svc.pushGoal({ id: 'intr', title: '同事消息', priority: 9, status: 'pending' })

  // 投影序：DFS 先序，子节点按 priority 降序（同优先级按 id 升序）
  assert.deepEqual(
    svc.goals.toSerial().map((n) => [n.id, n.depth]),
    [
      ['intr', 0], // priority 9 > g1 的 8 ⇒ 先出
      ['g1', 0],
      ['g1.2', 1],
      ['g1.1', 1],
      ['g1.3', 1],
    ],
    '投影必须是确定性序（不依赖 Map 插入序）',
  )

  // top()：depth 最大者优先 ⇒ 子目标，不是根目标
  assert.equal(svc.goals.top().id, 'g1.2', '活动最深目标优先（g1.3 是 paused，不算活动）')

  // 出栈后序：先子后父（chunking 需要看到子目标序列）
  assert.deepEqual(svc.goals.pop('g1'), ['g1.2', 'g1.1', 'g1.3', 'g1'], '出栈须为后序')
  assert.equal(svc.goals.size, 1, '整棵子树被删，只剩 intr')

  // 异常路径：不得静默
  assert.throws(() => svc.goals.push({ id: 'intr', title: 'dup' }), /目标 id 重复/)
  assert.throws(() => svc.goals.push({ id: 'x', title: 'x', parentId: 'nope' }), /父目标不存在/)
  assert.throws(() => svc.goals.get('nope'), /目标不存在/)
})

test('D2 SOAR 三阶段：候选序 / 决策序 / 行动事实集 / impasse 与不动点可枚举', async () => {
  ran += 1
  const { ctx } = await mountCoreAndScheduler()
  const svc = ctx.get('mana-scheduler')
  const operators = [
    { id: 'op-b', conditions: ['s1'], effects: ['f-b'], utility: 0.5, successRate: 0.5, cost: 1 },
    { id: 'op-a', conditions: ['s1'], effects: ['f-a'], utility: 0.5, successRate: 0.5, cost: 1 },
    { id: 'op-hi', conditions: ['s1'], effects: ['f-hi'], utility: 0.9, successRate: 0.1, cost: 9 },
    { id: 'op-never', conditions: ['missing'], effects: ['f-x'], utility: 1.0, successRate: 1, cost: 0 },
  ]
  const cycles = svc.run(['s1'], operators)
  assert.deepEqual(
    cycles.map((c) => c.phase),
    ['act', 'act'],
    '第一轮 act；第二轮同算子再应用 ⇒ 事实集不动点 ⇒ 收敛停（不得空转到 maxCycles）',
  )
  assert.deepEqual(cycles[0].candidates, ['op-a', 'op-b', 'op-hi'], '候选按 id 升序')
  assert.equal(cycles[0].operatorId, 'op-hi', 'utility 优先（utility 相同才看 successRate/cost）')
  assert.deepEqual(cycles[0].factsBefore, ['s1'])
  assert.deepEqual(cycles[0].factsAfter, ['f-hi', 's1'], '事实集归一后升序')
  assert.deepEqual(cycles[1].factsBefore, cycles[1].factsAfter, '收敛轮的不动点须逐字相等')

  // impasse：一条候选都匹配不到 ⇒ phase='impasse' 且**只跑一轮**（显式状态，不是"什么都没发生"）
  const stuck = svc.run(['no-fact'], operators)
  assert.equal(stuck.length, 1, 'impasse 时立刻停')
  assert.equal(stuck[0].phase, 'impasse')
  assert.equal(stuck[0].operatorId, null, 'impasse 时 operatorId 必须是 null（不得 undefined）')
  assert.deepEqual(stuck[0].candidates, [], '候选集是**空数组**（可分辨），不是 undefined')
  assert.deepEqual(stuck[0].factsAfter, stuck[0].factsBefore, 'impasse 不改变事实集')
})

test('D3 SOAR 决策：utility 相同时按 successRate → cost → id 逐级决定（无"看运气"余量）', async () => {
  ran += 1
  const { ctx } = await mountCoreAndScheduler()
  const svc = ctx.get('mana-scheduler')
  const base = { conditions: ['s'], effects: [], utility: 0.5, successRate: 0.5, cost: 5 }
  const cycle = svc.run(
    ['s'],
    [
      { ...base, id: 'z', cost: 5 },
      { ...base, id: 'a', cost: 5 },
      { ...base, id: 'm', cost: 1 },
      { ...base, id: 'h', successRate: 0.9, cost: 99 },
    ],
  )[0]
  assert.equal(cycle.operatorId, 'h', 'successRate 高者优先（utility 平）')
  assert.deepEqual(cycle.candidates, ['a', 'h', 'm', 'z'])
})

test('D4 maxGoals 上限：拒绝入栈且**抛错**（不得静默丢弃）', async () => {
  ran += 1
  const ctx = new Context()
  const core = await load('core')
  const sched = await load('scheduler')
  mount(ctx, core)
  await settle(200)
  ctx.plugin(sched, { maxGoals: 2 })
  await settle(300)
  const svc = ctx.get('mana-scheduler')
  svc.pushGoal({ id: 'a', title: 'a' })
  svc.pushGoal({ id: 'b', title: 'b' })
  assert.throws(() => svc.pushGoal({ id: 'c', title: 'c' }), /目标栈已满/)
})

// ══ E. 反证判据（R 形态）═════════════════════════════════════════════════════
test('E1 卸载 scheduler 后同一触发不再产生新行（带正向前置控制）', async () => {
  ran += 1
  const { ctx, coreFiber, schedFiber } = await mountCoreAndScheduler()
  const core = ctx.get('mana-core')
  const TRACE_EVENT = 'mana/scheduler/attention'
  const countRows = () =>
    core.db.prepare('SELECT count(*) c FROM mana_trace WHERE event_type = ?').get(TRACE_EVENT).c

  const trigger = (turnId) =>
    ctx.emit('mana/attention', {
      sessionId: 's-r3',
      turnId,
      requestId: `r-r3-${turnId}`,
      at: new Date().toISOString(),
      content: 'r3 触发',
      jevProbability: null,
      degraded: false,
    })

  // 正向前置控制：装上了就必须真写行，否则"卸载后不再产生新行"会**平凡通过**（G11）
  const before = countRows()
  trigger(1)
  await settle(200)
  const afterFirst = countRows()
  assert.equal(afterFirst, before + 1, `装配期必须真写行（before=${before} after=${afterFirst}）`)

  await schedFiber.dispose()
  await settle(300)
  const afterUnload = countRows()
  trigger(2)
  await settle(200)
  assert.equal(
    countRows(),
    afterUnload,
    `卸载后同一触发不得再产生新行（卸载时=${afterUnload} 再触发后=${countRows()}）`,
  )
  void coreFiber
})

// ══ F. 回归自检（写进测试，不只写进 handoff）══════════════════════════════════
test('F1 契约未被本轮改动：core 两个核心文件 sha256 与 _freeze.sha256 逐字相等', async () => {
  ran += 1
  const freezePath = fileURLToPath(new URL('docs/contract/_freeze.sha256', REPO))
  const stored = readFileSync(freezePath, 'utf8').trim().split('\n')
  for (const line of stored) {
    const [hash, rel] = line.trim().split(/\s+/)
    const actual = createHash('sha256')
      .update(readFileSync(fileURLToPath(new URL(rel, REPO))))
      .digest('hex')
    assert.equal(actual, hash, `${rel} 已漂移 —— 契约冻结面被改动`)
  }
})

test('F2 core 的 PACKAGE_MAP 仍是 6 条（新增 P1 包未污染契约面）', async () => {
  ran += 1
  const mod = await load('core')
  assert.equal(mod.PACKAGE_MAP.length, 6, 'P1 骨架登记属另一席/另一批，本轮不得改 core')
})

test('G 用例计数自检：本套件真跑的用例数必须等于常量（删/截断用例 ⇒ 必红）', () => {
  ran += 1
  // 覆盖面：**从中段删掉任何一条用例**，本末条仍在 ⇒ 计数不符 ⇒ 红。
  // ⚠ 覆盖不到的：连本末条一起截断（那需外部按 `# tests 14` **相等**核验，见 handoff §R2）。
  assert.equal(ran, EXPECTED_CASES, `本次真跑到 ${ran} 条，常量声明 ${EXPECTED_CASES} 条 —— 二者不符（有用例被删/被截断）`)
})
