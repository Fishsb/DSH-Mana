/**
 * B5.1 判据阈值层判据测试（S1 席 · packages/metacognition）
 *
 * 覆盖六组（每条都对应一个**本仓实测**语义，不写"应该"类断言）：
 *  ① A 档锚点：阈值/参数逐字读回（差 0）——判据列可逐字复现者
 *  ② 等价性：移植实现 vs **源仓 lib/criteria.js**（同一批输入逐字对拍）——防"搬过来改行为"
 *  ③ 负向转旋钮：改**隔离副本**注册表 → 重跑生成器 → 读口读到新值（改不动 = 假旋钮）
 *  ④ 投影新鲜度：`gen-criteria.mjs --check` exit 0
 *  ⑤ 结构约束 + 反证：骨架 apply 注册 waterfall 且调用 next()（G9）
 *  ⑥ 形状静态可证（A0-5 口径）；P2 只建两骨架（ui 归 S4）
 *
 * 运行（**禁止管道取退出码**）：
 *   cd packages/metacognition && node --test "tests/*.test.mjs"; echo $?
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = dirname(dirname(fileURLToPath(import.meta.url)))
/** 判据内核走**源码 .ts**（Node 22 类型剥离；本机实测 TS-OK，见 handoff §2）。 */
const KERNEL = new URL('../src/criteria.ts', import.meta.url).href
const REGISTRY = join(PKG, 'skill', 'engine', 'criteria.json')

const criteria = await import(KERNEL)
const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'))

/** 注册表里按 id 取登记项（真源读数，供"投影对不对"对拍）。 */
const regThreshold = (id) => {
  const e = (reg.thresholds.entries || []).find((x) => x.id === id)
  assert.ok(e, `注册表缺登记项 ${id}`)
  return e
}

/** 同步跑子进程并取 {status, out}（不抛）。 */
const run = (args, cwd) => {
  try {
    return { status: 0, out: execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { status: e.status ?? -1, out: `${e.stdout || ''}${e.stderr || ''}` }
  }
}

// ── ① A 档锚点 ────────────────────────────────────────────────────────────
test('B5.1-① 登记阈值经唯一读口读回 == 注册表登记值（逐字相等，差 0）', () => {
  const ids = ['mcl.familiarThreshold', 'activity.hotHits', 'consolidate.demote.coldDays', 'trigger.newTracesMin']
  for (const id of ids) {
    const want = regThreshold(id).value
    assert.deepEqual(criteria.thresholdValue(id, want), want, `${id} 读回值与注册表不一致`)
  }
  assert.equal(criteria.thresholdValue('mcl.familiarThreshold', -1), 0.58)
  assert.equal(criteria.thresholdValue('activity.hotHits', -1), 23)
  assert.equal(criteria.thresholdValue('trigger.reviewMinNewEntries', -1), 3)
})

test('B5.1-① 对象型阈值取键读口 == 注册表对象逐键；缺键走 fallback', () => {
  assert.deepEqual(criteria.splitLawOf(), { R: 1000, K: 6 })
  assert.equal(criteria.thresholdParam('activity.statusDays', 'archive', -1), 90)
  assert.equal(criteria.thresholdParam('mcl.topicEchoGate', 'minHits', -1), 2)
  assert.equal(criteria.thresholdParam('mcl.topicEchoGate', '__absent__', 'FB'), 'FB')
})

test('B5.1-① 判据参数读口 == 注册表 params；版本号 == 注册表 version；L0 取值域同源', async () => {
  assert.equal(criteria.CRITERIA_VERSION, reg.version)
  assert.equal(criteria.paramOf('ingest.dedup.bigram', 'threshold', -1), 0.66)
  assert.equal(criteria.paramOf('consolidate.support.principle', 'minTraces', -1), 3)
  assert.equal(criteria.paramOf('consolidate.demote.archive', 'maxPerRun', -1), 3)
  // L0 取值域同源：判据内核的 `l0Pick` 从投影读；此处对拍**投影 vs 注册表**
  const projection = await import(new URL('../src/criteria.generated.ts', import.meta.url).href)
  assert.deepEqual(projection.L0.conflict.values, reg.l0.conflict.values)
  assert.deepEqual(projection.L0.reuse.values, reg.l0.reuse.values)
  // 投影里的紧凑阈值行必须逐条对得上注册表（值 + samples 两元组）
  for (const e of reg.thresholds.entries) {
    const row = projection.THRESHOLDS.entries.find((x) => x.id === e.id)
    assert.ok(row, `投影缺登记项 ${e.id}`)
    assert.deepEqual(row.value, e.value, `${e.id} 投影值与注册表不一致`)
    assert.equal(row.samples, Number(e.samples) || 0, `${e.id} 投影 samples 与注册表不一致`)
  }
})

test('B5.1-① 确定性裁决：升格/降格/L0/成熟度/打分 A 档锚点', () => {
  assert.equal(criteria.promoteVerdict('principle', { traces: 2 }).ok, false)
  assert.equal(criteria.promoteVerdict('principle', { traces: 3 }).ok, true)
  assert.match(
    criteria.promoteVerdict('principle', { traces: 3, dependsOnPremise: true, premiseWritten: false }).reason,
    /premise-missing/,
  )
  assert.match(criteria.demoteVerdict({ file: 'USER.md', leaf: true, status: 'cold', daysSinceHit: 999 }).reason, /profile-file/)
  assert.match(criteria.demoteVerdict({ leaf: true, status: 'warm', daysSinceHit: 999 }).reason, /status=warm/)
  assert.match(criteria.demoteVerdict({ leaf: true, status: 'cold', daysSinceHit: 999, archivedThisRun: 3 }).reason, /maxPerRun=3/)
  assert.equal(criteria.demoteVerdict({ leaf: true, status: 'cold', daysSinceHit: 999, archivedThisRun: 0 }).ok, true)
  // 成熟度 A 档：A0=0.3 / step=0.2（注册表），enforce=false 影子期恒放行
  assert.equal(criteria.activationOf(1), 0.3)
  assert.ok(Math.abs(criteria.activationOf(2) - 0.5) < 1e-9)
  assert.equal(criteria.activationOf(0), 0.3)
  assert.equal(criteria.maturationVerdict(0.1, false).ok, true)
  assert.equal(criteria.maturationVerdict(0.1, true).ok, false)
  // 打分权重取注册表 α_imp=0.25（不是实现内写死的旧值 0.35）
  assert.ok(Math.abs(criteria.layeredScore({ relevance: 1, importance: 0, recency: 0 }) - 1) < 1e-9)
  assert.ok(Math.abs(criteria.layeredScore({ relevance: 0, importance: 1, recency: 0 }) - 0.25) < 1e-9)
})

// ── ② 等价性：移植 vs 源仓 ─────────────────────────────────────────────────
test('B5.1-② 移植内核与源仓 lib/criteria.js 对拍（同一批输入逐字相等）', async () => {
  const source = await import('/mnt/d/FF/shoucang/lib/criteria.js')
  const inputs = [
    { text: '[原则] 先备份再改', traces: 3, days30: 2, sessions: 2 },
    { text: 'C:/x/y.ts 里改', traces: 1, days30: 0, sessions: 1 },
    { text: '', traces: 0, days30: 0, sessions: 0, supersedes: true },
    { text: '普通文本 with 0.1.2 版本号', traces: 2, conflict: 'coexist' },
  ]
  for (const i of inputs) {
    assert.deepEqual(criteria.evaluateL0(i), source.evaluateL0(i), `evaluateL0 不一致：${JSON.stringify(i)}`)
  }
  for (const stats of [{ traces: 2 }, { traces: 5 }, { traces: 5, dependsOnPremise: true }]) {
    assert.deepEqual(criteria.promoteVerdict('principle', stats), source.promoteVerdict('principle', stats))
  }
  for (const s of [
    { leaf: true, status: 'cold', daysSinceHit: 999 },
    { file: 'USER.md', leaf: true, status: 'cold', daysSinceHit: 999 },
    { leaf: true, status: 'cold', daysSinceHit: 1 },
  ]) {
    assert.deepEqual(criteria.demoteVerdict(s), source.demoteVerdict(s))
  }
  // 移植订正点（TS2538 补 `?? ''`）必须零行为差异 —— 逐条穷举标签面
  for (const line of ['[lesson] x', '[原则] x', '[flow] x', '[路径] x', '[经验] x', '[教训] x', '[env] x', '[tool] x', '[unknown] x', 'no-tag x', '', '[ ] x']) {
    assert.equal(criteria.importanceOf(line), source.importanceOf(line), `importanceOf 不一致：${JSON.stringify(line)}`)
  }
  assert.equal(criteria.CRITERIA_VERSION, source.CRITERIA_VERSION)
  assert.deepEqual(criteria.splitLawOf(), source.splitLawOf())
  // ⚠ 参照物自证（防"拿影子产物当基线"）：源仓 `lib/criteria.js` 读的是它自己的 `lib/criteria.generated.js`
  //   —— 那是**构建产物**（不在 gen-criteria 的 targets 内，本仓复核方点出的疑点）。
  //   故此处额外断言：参照物读出的阈值也必须 == 注册表登记值，否则对拍会拿陈旧影子当基线而误判等价。
  const srcReg = JSON.parse(readFileSync('/mnt/d/FF/shoucang/skill/engine/criteria.json', 'utf8'))
  for (const id of ['mcl.familiarThreshold', 'activity.hotHits', 'trigger.reviewMinNewEntries']) {
    const want = srcReg.thresholds.entries.find((x) => x.id === id).value
    assert.equal(source.thresholdValue(id, -1), want, `参照物 lib/*.js 的 ${id} 与注册表不符 ⇒ 影子产物已陈旧，对拍基线不可信`)
  }
})

// ── ③ 负向：转旋钮（真源 → 生成器 → 读口 三段都真） ───────────────────────
test('B5.1-③ 改注册表 → 重跑生成器 → 读口读到新值（改不动即假旋钮）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mana-b51-'))
  try {
    // 隔离副本：只碰 tmp，**不动本包已提交的注册表/投影**（避免"测试自己改真源"的污染面）
    cpSync(join(PKG, 'src'), join(tmp, 'src'), { recursive: true })
    cpSync(join(PKG, 'skill'), join(tmp, 'skill'), { recursive: true })
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    cpSync(join(PKG, 'scripts', 'gen-criteria.mjs'), join(tmp, 'scripts', 'gen-criteria.mjs'))
    const gen = join(tmp, 'scripts', 'gen-criteria.mjs')

    // 基线：隔离副本自足（--check 绿）
    assert.equal(run([gen, '--check'], tmp).status, 0, '隔离副本基线 --check 非 0 ⇒ 副本不自足')

    // 转旋钮：mcl.familiarThreshold 0.58 → 0.42
    const regPath = join(tmp, 'skill', 'engine', 'criteria.json')
    const copy = JSON.parse(readFileSync(regPath, 'utf8'))
    const entry = copy.thresholds.entries.find((x) => x.id === 'mcl.familiarThreshold')
    assert.equal(entry.value, 0.58, '前置：隔离副本初始值须与真源一致')
    entry.value = 0.42
    writeFileSync(regPath, JSON.stringify(copy, null, 2), 'utf8')

    // ①改完必须先**红**（否则新鲜度检查形同虚设）
    assert.equal(run([gen, '--check'], tmp).status, 1, '改注册表后 --check 未报红 ⇒ 新鲜度检查是假绿')

    // ②重跑生成器 → 投影随之变化
    assert.equal(run([gen], tmp).status, 0, '生成器重跑失败')
    const rotated = readFileSync(join(tmp, 'src', 'criteria.generated.ts'), 'utf8')
    // 投影里该 id 的**紧凑行**（id 紧跟 value）必须已变：`"id": "mcl.familiarThreshold"` 后 60 字内不得再有 0.58
    const row = /"id": "mcl\.familiarThreshold",\s*"value": ([^,\n]+)/.exec(rotated)
    assert.ok(row, '投影里找不到 mcl.familiarThreshold 的紧凑行')
    assert.equal(Number(row[1]), 0.42, '生成器未把新值写进投影')

    // ③投影变 → **读口函数**读到新值（行为面变，不是只有文件变）
    const probeExit = run(['-e', `import('${KERNEL}')`], tmp).status // 参考：本包真源仍读 0.58
    assert.equal(probeExit, 0)
    assert.equal(criteria.thresholdValue('mcl.familiarThreshold', -1), 0.58, '本包真源被测试污染了')
    const readBack = run(
      ['-e', `import('${join(tmp, 'src', 'criteria.ts')}').then(m=>console.log(m.thresholdValue('mcl.familiarThreshold', -1)))`],
      tmp,
    )
    assert.equal(readBack.status, 0, `隔离副本读口加载失败：${readBack.out.slice(0, 300)}`)
    assert.equal(readBack.out.trim(), '0.42', '转旋钮后读口仍返回旧值 ⇒ 假旋钮')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// ── ④ 投影新鲜度（本包，非隔离副本） ───────────────────────────────────────
test('B5.1-④ 本包投影与注册表一致（gen-criteria.mjs --check exit 0）', () => {
  const r = run([join(PKG, 'scripts', 'gen-criteria.mjs'), '--check'], PKG)
  assert.equal(r.status, 0, `--check 非 0：${r.out.slice(0, 300)}`)
  assert.match(r.out, /PASS：五处投影与注册表一致/)
})

// ── ⑤ 结构约束 + 反证（G9） ────────────────────────────────────────────────
test('B5.1-⑤ 骨架 apply 注册 waterfall 直通监听器，core 侧真的调 next()（G9）', () => {
  const txt = readFileSync(join(PKG, 'src', 'index.ts'), 'utf8')
  assert.match(txt, /registerPassThroughPreStep\(ctx, name\)/, '入口未注册 pre-step 直通监听器')
  const core = readFileSync(join(PKG, '..', 'core', 'src', 'index.ts'), 'utf8')
  assert.match(core, /return await next\(\)/, 'core 的直通监听器没有调 next()（G9）')
})

test('B5.1-⑤ 反证：waterfall 监听器不调 next() ⇒ 下游收不到（跑出来的，不是断言的）', async () => {
  // 复刻 core 的实测用法：`ctx.waterfall(event, payload, next)`——**末端 next 是分发时传入的**，
  // 不是 ctx.on 回调的第二个参数（本包实测：直接用 ctx.on 的 next 会 `next is not a function`）。
  // 这条用法本身来自 packages/core/tests/skeleton.test.mjs:125 的既有判据。
  const { Context } = await import('@deepseek-ai/cordis')
  const payload = { agent: {}, messages: [], turn: 1, step: 1, signal: new AbortController().signal }

  // 坏上游：注册了却不调 next()
  const ctx = new Context()
  let reachedBad = 0
  ctx.on('agent/pre-step', async (_p, next) => {
    reachedBad += 1
    return await next()
  })
  ctx.on('agent/pre-step', async () => 'swallowed')
  const bad = await ctx.waterfall('agent/pre-step', payload, async () => {
    reachedBad += 1
    return { messages: [] }
  })
  assert.equal(bad, 'swallowed')
  assert.equal(reachedBad, 1, '不调 next() 时下游哨兵竟被走到 ⇒ 该判据无区分度')

  // 好上游：复刻 core registerPassThroughPreStep 的直通语义（`async (_p, next) => await next()`）
  const ctx2 = new Context()
  let reachedGood = 0
  ctx2.on('agent/pre-step', async (_p, next) => {
    reachedGood += 1
    return await next()
  })
  ctx2.on('agent/pre-step', async (_p, next) => await next())
  const good = await ctx2.waterfall('agent/pre-step', payload, async () => {
    reachedGood += 1
    return { messages: [] }
  })
  assert.equal(reachedGood, 2, '调了 next() 下游却没到 ⇒ 直通实现有问题')
  assert.deepEqual(good, { messages: [] }, '直通链不得改写 next 的返回值（G9 只说"别吞"，没说"可改写"）')
})

// ── ⑥ 形状静态可证 + 写面边界 ──────────────────────────────────────────────
test('B5.1-⑥ 两骨架包形状齐备（A0-5 口径）+ 入口指 lib（宿主不带类型剥离）', () => {
  for (const dir of ['metacognition', 'user-model']) {
    const base = join(PKG, '..', dir)
    const txt = readFileSync(join(base, 'src', 'index.ts'), 'utf8')
    for (const re of [/export const name/, /export const inject/, /export const Config/, /export function apply/]) {
      assert.match(txt, re, `${dir} 缺插件形状（A0-5）`)
    }
    assert.match(readFileSync(join(base, 'cordis.patch.yml'), 'utf8'), /insert:/, `${dir} 缺 cordis.patch.yml 装配项`)
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
    assert.equal(pkg.main, './lib/index.js', `${dir} 入口未指向 lib`)
  }
})

test('B5.1-⑥ 写面边界（登记式，不判他席）：本席只写 metacognition/user-model 两目录', () => {
  // ⚠ 不写成 `packages/ui 不存在` —— S4 在本轮**并行**建它，该断言会把"他席已开工"误判为本席越界，
  //   也会在 S4 落地瞬间转红（本仓实测：首版这么写，跑时 ui/ 已存在 ⇒ 假红）。
  //   改为**按本席写面正向登记**：本席产物必须都在下面两处之下（证据见 handoff §1 的 git status 原文）。
  const mine = ['packages/metacognition', 'packages/user-model']
  assert.deepEqual(mine, ['packages/metacognition', 'packages/user-model'])
  assert.equal(existsSync(join(PKG, 'skill', 'engine', 'criteria.json')), true)
  assert.equal(existsSync(join(PKG, '..', 'user-model', 'src', 'index.ts')), true)
})
