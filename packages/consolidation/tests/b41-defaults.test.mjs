/**
 * B4.1 装配与口径判据：**复用 vector 的余弦**、**列清单以 schema 为准**、**降级必须可观测**。
 *
 * 三条设计上的取舍（本仓血的教训，逐条都踩过）：
 * · **口径复用 ≠ 抄一遍**：① 断言解析到的**是 `packages/vector/lib/cosine.js`**（同一文件对象），
 *   ② 断言解析失败时**返回显式原因**而不是回落到一份自写余弦。本包 `src/` 下**没有**第二份余弦实现。
 * · **不得臆造列名**：④ 把本包的列清单与 `packages/core/src/schema.ts` 的 **DDL 原文**逐列对拍
 *   （读真文件解析出列名做集合相等）—— 这才是"以 schema 为准"，而不是在注释里自称以 schema 为准。
 * · **降级不得静默**：⑦ 把一个**真的解析不到 vector** 的目录树造出来（shadow 装配），
 *   在子进程里真跑 `apply`，断言 `plan().ripple === null` 且 `degraded.reason` 非空、
 *   且 `svc.ripple()` **抛错**。不造这个环境的话，这条分支就只是注释里的承诺。
 *
 * 运行（显式路径）：`node --test packages/consolidation/tests/b41-defaults.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IMPLEMENTED_EXPORTS,
  UNMEASURED_COLUMNS,
  WRITTEN_COLUMNS,
  CONSOLIDATION_PARAMS,
  readProductionRule,
  resolveVectorCosine,
  writeProductionRules,
} from '../src/index.ts'

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const EXPECTED_CASES = 9
let ran = 0

async function mount() {
  const ctx = new Context()
  const core = await load('core')
  const mod = await load('consolidation')
  ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-b41-')), 'mana.db') })
  await settle(200)
  const fiber = ctx.plugin(mod)
  await settle(300)
  // ⚠ 返回的是**服务**（ctx.get）而不是模块：首版把 mod.`core` 当服务传进 writeProductionRules，
  //   报的是 "Cannot read properties of undefined (reading 'prepare')" ——
  //   「拿到了模块」≠「拿到了服务」，本仓"接口成功非达成"的同一条。
  const svc = ctx.get('mana-consolidation')
  const coreSvc = ctx.get('mana-core')
  return { ctx, core, coreSvc, svc, mod, fiber }
}

test('① 余弦口径**复用** vector：解析到同一份实现文件（本包不另写第二份）', async () => {
  ran += 1
  const route = resolveVectorCosine()
  assert.equal(route.ok, true, `默认解析必须成功；实测 reason = ${route.reason}`)
  assert.ok(
    route.source.replaceAll('\\', '/').endsWith('packages/vector/lib/cosine.js'),
    `必须解析到 vector 的产物而不是本包内的副本；实测 source = ${route.source}`,
  )
  // 同一文件对象：与直接 import 该文件拿到的**是同一个函数引用**
  const direct = await import(new URL(`file://${route.source}`).href)
  assert.equal(route.cosine, direct.cosine, '两条路取到同一个函数引用 ⇒ 不是复制了一份实现')
  assert.equal(route.via, 'package-resolve', '缺省入口走包名解析（不是硬编码相对路径）')
  // 本包 src/ 下不得出现第二份余弦实现（拒绝"复制一份再声称复用"）
  const files = ['index.ts', 'select.ts', 'consolidate.ts', 'chunking.ts', 'rules.ts', 'params.ts', 'vector-cosine.ts']
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
    assert.ok(
      !/function\s+cosine\s*\(/.test(src),
      `${f} 里出现了第二份 cosine 实现 —— 两份实现必然漂移（本包只许从 vector 取）`,
    )
  }
})

test('② 解析失败必须**显式**（不回落自写余弦、原因非空且带 source）', () => {
  ran += 1
  const bad = resolveVectorCosine({ specifier: './lib/vector/src/cosine.ts' })
  assert.equal(bad.ok, false, '指向不存在路径的 specifier ⇒ 必须 ok:false')
  assert.equal(bad.cosine, null, '失败时**不得**给出任何可用余弦（否则就是静默回落）')
  assert.ok(bad.reason && bad.reason.length > 0, '失败必须带非空 reason（G8：禁 catch { return null }）')
  assert.ok(bad.source.includes('cosine'), `失败也要回报尝试过的 source；实测 ${bad.source}`)
})

test('③ 阈值来自 params（只读快照），且 0.7/7/2 与判据原文同值', async () => {
  ran += 1
  const { ctx } = await mount()
  const svc = ctx.get('mana-consolidation')
  assert.equal(svc.thresholds.MERGE_SIMILARITY, 0.7, '「相似度 ≥0.7 合并」')
  assert.equal(svc.thresholds.MAX_OPERATOR_SEQUENCE, 7, '「算子序列 ≤7」')
  assert.equal(svc.thresholds.MIN_PATTERN_REPEATS, 2, '「模式重复 ≥2」/「chunking 重复阈值 ≥2」')
  assert.equal(Object.isFrozen(svc.thresholds), true, '阈值快照须冻结（运行期改不动 ⇒ 判据的复算前提成立）')
  assert.equal(CONSOLIDATION_PARAMS.SPINDLE_TOP_N, 3, 'Top-N 是工程缺省（非判据阈值），值 3')
})

test('④ 列清单**以 schema 为准**：与 core 的 DDL 原文逐列对拍（不得臆造列名）', () => {
  ran += 1
  const schemaPath = fileURLToPath(new URL('core/src/schema.ts', ROOT))
  const ddl = readFileSync(schemaPath, 'utf8')
  const block = /CREATE TABLE IF NOT EXISTS production_rules \(([\s\S]*?)\);/.exec(ddl)
  assert.ok(block, 'production_rules 的 DDL 必须能在 core/schema.ts 里找到（找不到 = 本判据失效，须红）')
  const ddlCols = block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('--'))
    .map((l) => l.split(/[\s,]+/)[0])
  assert.deepEqual(
    ddlCols,
    ['id', 'conditions', 'actions', 'utility', 'success_rate', 'cost', 'strength', 'source_goal_id', 'created_at'],
    'core 的 DDL 列名是**唯一权威**；本行由真文件解析得来（变了就说明 schema 动了，本包须同步）',
  )
  const mine = [...WRITTEN_COLUMNS]
  assert.deepEqual(mine, ['id', 'conditions', 'actions', 'source_goal_id', 'created_at'], '写入列（5）')
  assert.deepEqual([...UNMEASURED_COLUMNS], ['utility', 'success_rate', 'cost', 'strength'], '未测列（4，走 DDL 缺省）')
  assert.deepEqual(
    [...mine, ...UNMEASURED_COLUMNS].slice().sort(),
    ddlCols.slice().sort(),
    '本包 5 + 4 = DDL 的 9 列，**集合相等**：多一列（臆造）或少一列（漏写）都必须红',
  )
  assert.equal(new Set([...mine, ...UNMEASURED_COLUMNS]).size, 9, '两组不得重叠')
})

test('⑤ 真装配：behavior=active、余弦通道可用、plan 无降级；卸载后服务消失', async () => {
  ran += 1
  const { ctx, fiber } = await mount()
  const svc = ctx.get('mana-consolidation')
  assert.ok(svc, 'mana-consolidation 服务必须可读')
  const st = svc.status()
  assert.equal(st.behavior, 'active', 'B4.1 已填实现 ⇒ 须为 active（判据① 的期望值同步改过）')
  assert.equal(st.wired, true)
  assert.ok(st.vector.startsWith('ok:'), `装配期余弦通道须解析成功；实测 ${st.vector}`)
  assert.equal(svc.vectorRoute().ok, true)
  assert.equal(svc.vectorRoute().reason, null, '可用时 reason 必须为 null（与失败的「非空原因」互补）')
  const plan = svc.plan({
    periodId: 'P-⑤',
    items: [{ id: 'm1', activation: 1, vector: [1, 0] }],
    neocortex: [{ id: 'n1', vector: [1, 0] }],
    runs: [],
  })
  assert.equal(plan.degraded, null, '通道可用 ⇒ 不得报降级')
  assert.ok(plan.ripple, '通道可用 ⇒ Ripple 必须真的跑过（ripple 非 null）')
  assert.equal(plan.ripple.stats.merged, 1, 'cos=1 ⇒ 必合并')
  await fiber.dispose()
  await settle(300)
  assert.equal(ctx.get('mana-consolidation'), undefined, '卸载后服务必须消失（卸载即净）')
})

test('⑥ 真库写入 + **读回校验**：四列未测走 DDL 缺省，重复写不膨胀', async () => {
  ran += 1
  const { ctx, coreSvc, svc } = await mount()
  const draft = {
    id: 'rule-test-1',
    conditions: JSON.stringify({ signature: 'a\u0001b', repeats: 2 }),
    actions: JSON.stringify({ kind: 'replay-sequence', steps: ['a', 'b'] }),
    sourceGoalId: 'g-A',
    createdAt: '2026-09-25T00:00:00.000Z',
  }
  const first = writeProductionRules(coreSvc, [draft])
  assert.deepEqual(first.inserted, ['rule-test-1'], `首写须 inserted；实测 ${JSON.stringify(first)}`)
  assert.deepEqual(first.failures, [], '不得有写失败')
  const read = readProductionRule(coreSvc, 'rule-test-1')
  assert.ok(read, '写后读回必须能取到该行（INSERT 成功 ≠ 行真的在）')
  assert.equal(read.conditions, draft.conditions, 'conditions 必须逐字写对（列序错会在此暴露）')
  assert.equal(read.actions, draft.actions, 'actions 必须逐字写对')
  assert.equal(read.source_goal_id, 'g-A', 'source_goal_id 须落对')
  assert.equal(read.created_at, draft.createdAt, 'created_at 须落对')
  // 未测四列：走 DDL 缺省，且**原样报出**（证"没测"而不是"测了得 0"）
  assert.deepEqual(
    [read.utility, read.success_rate, read.cost, read.strength],
    [0.5, 0.5, 0, 0.5],
    `四列未测 ⇒ 取 DDL 缺省并由读回原样报出；实测 ${JSON.stringify(read)}`,
  )
  const dup = writeProductionRules(coreSvc, [draft])
  assert.deepEqual(dup.inserted, [], '重复写同一 id 不得再插一行')
  assert.deepEqual(dup.existing, ['rule-test-1'], '重复写须落 existing（与 inserted 分开计数）')
  assert.equal(svc.writeRules([draft]).existing.length, 1, '经服务面重写亦须走同一写者（幂等）')
  const count = coreSvc.db.prepare('SELECT count(*) AS c FROM production_rules').get().c
  assert.equal(count, 1, `重复写不得膨胀（实测 ${count} 行）`)
})

test('⑦ 降级腿（shadow 装配）：解析不到 vector ⇒ ripple=null + 原因非空 + 直调抛错', () => {
  ran += 1
  // 造一个**真的解析不到 dsh-mana-vector** 的目录树：把本包产物复制进去，只挂 core 与 cordis。
  // 于是 `import.meta.resolve('dsh-mana-vector')` 从该树向上找不到 ⇒ route.ok=false（真失败，非 mock）。
  const shadow = mkdtempSync(join(tmpdir(), 'mana-s16-shadow-'))
  mkdirSync(join(shadow, 'lib'), { recursive: true })
  mkdirSync(join(shadow, 'node_modules'), { recursive: true })
  cpSync(fileURLToPath(new URL('../lib', import.meta.url)), join(shadow, 'lib'), { recursive: true })
  // ROOT = packages/ ⇒ 仓根 node_modules 是它的上一级
  const repoModules = fileURLToPath(new URL('../node_modules/', ROOT))
  const links = [
    [join(repoModules, 'dsh-mana-core'), join(shadow, 'node_modules', 'dsh-mana-core')],
    [join(repoModules, '@deepseek-ai'), join(shadow, 'node_modules', '@deepseek-ai')],
  ]
  for (const [target, link] of links) {
    // 目标不存在 ⇒ 链接会静默建出悬空链接，子进程报的却是"找不到包"（离真因很远）⇒ 先断言
    assert.ok(existsSync(target), `shadow 装配前提：${target} 必须存在（否则本用例测不到降级腿）`)
    symlinkSync(target, link)
  }
  // 反证「@deepseek-ai 域里没有 vector」：若它被顺带链进来，降级腿就永远测不到（假绿）
  assert.ok(!existsSync(join(repoModules, '@deepseek-ai', 'dsh-mana-vector')), 'shadow 树不得能解析到 dsh-mana-vector')
  const child = `
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const core = await import('dsh-mana-core')
const mod = await import('./lib/index.js')
const route = mod.resolveVectorCosine()
const ctx = new Context()
ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-s16-db-')), 'mana.db') })
await new Promise((r) => setTimeout(r, 250))
ctx.plugin(mod)
await new Promise((r) => setTimeout(r, 350))
const svc = ctx.get('mana-consolidation')
const plan = svc.plan({ periodId: 'shadow', items: [{ id: 'x', activation: 1, vector: [1, 0] }], neocortex: [{ id: 'n', vector: [1, 0] }], runs: [] })
let threw = null
try { svc.ripple({ periodId: 'shadow', selected: [{ id: 'x', activation: 1, vector: [1, 0] }], neocortex: [] }) } catch (e) { threw = e.message }
console.log(JSON.stringify({ routeOk: route.ok, routeReason: route.reason, vector: svc.status().vector, rippleNull: plan.ripple === null, degraded: plan.degraded, threw, mergedStillWorks: plan.spindle.selected.length }))
`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', child], { cwd: shadow, encoding: 'utf8' })
  const got = JSON.parse(out.trim().split('\n').pop())
  assert.equal(got.routeOk, false, `shadow 树里必须解析失败（否则本用例没测到降级腿）：${out}`)
  assert.ok(got.routeReason && got.routeReason.length > 0, '失败原因必须非空')
  assert.ok(got.vector.startsWith('unavailable:'), `status().vector 须显式报不可用；实测 ${got.vector}`)
  assert.equal(got.rippleNull, true, '余弦不可用 ⇒ ripple 必须是 null（**不是空计划**：空会被读成「没有可合并的」）')
  assert.ok(got.degraded && got.degraded.reason.length > 0, `degraded.reason 必须非空；实测 ${JSON.stringify(got.degraded)}`)
  assert.ok(/余弦通道不可用/.test(got.threw ?? ''), `直调 svc.ripple() 必须抛错并说清真因；实测 ${got.threw}`)
  assert.equal(got.mergedStillWorks, 1, '降级只影响 Ripple —— Spindle 仍须给出选中集（不得整体瘫掉）')
})

test('⑧ 实现面清单：9 个导出逐个是函数 + 不导出 Config（假旋钮不得回流）', async () => {
  ran += 1
  const mod = await load('consolidation')
  assert.equal(mod.Config, undefined, '本包不导出 Config（阈值走 params 常量，不进配置面）')
  assert.deepEqual(
    [...IMPLEMENTED_EXPORTS],
    ['selectTopN', 'ripple', 'chunkSequences', 'isCandidateSequence', 'signatureOf', 'writeProductionRules', 'readProductionRule', 'countProductionRules', 'resolveVectorCosine'],
    '实现面清单即判据面（改名/搬走不同步 ⇒ 必红）',
  )
  for (const key of IMPLEMENTED_EXPORTS) {
    assert.equal(typeof mod[key], 'function', `实现面成员 ${key} 必须是函数（被挖空即红）`)
  }
})

test('⑨ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})
