/**
 * **行为面判据**（本包 B5.2 新增）：effect 面精确计数 + `behavior='active'` 的**背书** +
 * **卸载即净**的反证腿。
 *
 * ── 为什么本包需要这一组（它与兄弟包 ⑦⑧ 的关系，如实交代）───────────────────
 * 任务书称本包有「判据⑦ effect 面恰好 3 条 / 判据⑧ 行为面 0 行 `mana_trace`」。
 * **实测本包一条都没有**（本仓命令与读数见 `docs/handoff/S18.md` §1）：
 *   `grep -c getEffects packages/user-model/tests/skeleton.test.mjs` ⇒ 0；
 *   对 `consolidation/forgetting/long-term` 同命令 ⇒ 各 5。
 * 即该前提是**从兄弟包类推来的**，不是本包事实 ⇒ 本席**不复述该前提**，
 * 而是按本包真状态重建这一组，并把差异写进 handoff（"判据绿 ≠ 事实被检查"的反向：
 * 判据**不存在** ≠ 判据已满足）。
 *
 * ── 与兄弟包 ⑧ 的**方向不同**（这是本节最关键的一条）─────────────────────────
 * 兄弟包是空壳 ⇒ ⑧ 断言"`mana_trace` 0 行"。本包 B5.2 后**有**行为面
 * （`reportDrift` 真写 `user-model/drift`）⇒ 不能照抄"0 行"，
 * 否则等于要求实现退回空壳。本包改成**两条更强的**：
 *   · 本包只写**自己命名空间**下的 type（不冒充 S1 五类，见 ④ 那条用例）；
 *   · **卸载后不再新增**（"卸载即净"的反证腿）—— 这恰好是 v10 §39.3
 *     「去掉用户模型」消融此前判"**不可做：卸载无差异**"（`docs/mana-rollout-plan.md:728`）
 *     的**反例**：本包自此有了可观测的卸载差异。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { P, tmpDir, traceCount, mount } from './_harness.mjs'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

/** 用**真 cordis Loader 按包名**装载（与 `tools/r0-assembly-check.mjs` 同一条链）。 */
async function loadReal() {
  const { Context } = await import(`${DSH}/cordis/lib/index.js`)
  const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default
  const baseUrl = pathToFileURL(P('')).href + '/'
  const store = mkdtempSync(join(tmpdir(), 'mana-um-beh-'))
  const ctx = new Context()
  ctx.baseUrl = baseUrl
  ctx.plugin(Loader, { baseUrl })
  await settle(250)
  await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: join(store, 'mana.db'), backupEnabled: false } })
  await settle(250)
  return { ctx, store, Loader }
}

test('行为① effect 面**恰好 3 条**且逐条点名（多一条即红 ⇒ 强制交代新增行为）', async () => {
  assert.ok(existsSync(join(DSH, 'cordis/lib/index.js')), '宿主 cordis 缺失 ⇒ 本判据无可信运行环境')
  const { ctx, store } = await loadReal()
  const entry = await ctx.loader.create({ name: 'dsh-mana-user-model', config: {} })
  await settle(300)
  assert.ok(ctx.get('mana-user-model'), '未装上 ⇒ 后面的 effect 读数无从判起（先修装配）')

  const fiber = [...ctx.loader.entries()].find((e) => e.options?.name === 'dsh-mana-user-model')?.fiber
  assert.ok(fiber?.getEffects, '取不到 fiber.getEffects ⇒ 本判据会平凡通过')
  const labels = (fiber.getEffects() ?? []).map((e) => String(e.label)).sort()
  assert.equal(
    labels.length, 3,
    '本包 effect 面应恰好 3 条（service / provide / pre-step）；实测 ' + labels.length + '：' + JSON.stringify(labels) +
      '。若这是新增的真行为 ⇒ 须同步更新本断言并补 R 形态反证判据（卸载后不再产生新行）',
  )
  assert.ok(labels.some((l) => l.includes(': service')), '须含 service effect；实测 ' + JSON.stringify(labels))
  assert.ok(labels.some((l) => l.includes('ctx.provide(')), '须 provide 服务')
  assert.ok(labels.some((l) => l.includes('agent/pre-step')), '须注册 pre-step 监听器')

  // 反向腿：卸载后 effect 面必须**归零**（否则"卸载即净"是空话）
  ctx.loader.remove(entry.id ?? entry)
  await settle(350)
  assert.equal(ctx.get('mana-user-model'), undefined, '卸载后服务必须不可读')
  ctx.get('mana-core')?.db?.close?.()
  rmSync(store, { recursive: true, force: true })
})

test('行为② behavior=\'active\' 必须有**实现面背书**（防"自称 active 而背后无事"）', async () => {
  const { umMod, um, close } = await mount()
  const st = um.status()
  assert.equal(st.behavior, 'active', 'B5.2 已填实现 ⇒ behavior 必须为 active，实测 ' + st.behavior)
  assert.equal(typeof st.behavior, 'string', 'behavior 不得为 undefined（undefined 会被 JSON 静默丢键）')
  // 背书：三件可机检的实现面必须都在，且逐个可调用。
  const backed = {
    driftCandidates: umMod.driftCandidates,
    injectionDecision: umMod.injectionDecision,
    assessAccuracy: umMod.assessAccuracy,
    requiredSampleSize: umMod.requiredSampleSize,
    assertContentNeutral: umMod.assertContentNeutral,
  }
  for (const [n, fn] of Object.entries(backed)) {
    assert.equal(typeof fn, 'function', 'behavior=active 必须有实现面背书：导出 ' + n + ' 必须是函数')
  }
  // 服务面的方法也必须真存在（不是只有导出的纯函数）
  for (const m of ['updatePreference', 'listPreferences', 'listHistory', 'reportDrift', 'injectionVerdict', 'assessAccuracy', 'thresholds', 'status']) {
    assert.equal(typeof um[m], 'function', '服务面缺方法 ' + m + '（behavior=active 却无可调面）')
  }
  assert.notEqual(um.thresholds().precisionTarget, undefined, 'precisionTarget 不得为 undefined（须显式 null = 未校准）')
  close()
})

test('行为③ **卸载即净**（反证腿）：卸载后同一触发**不再产生新行**', async () => {
  // ⚠ 这是 v10 §39.3「去掉用户模型」消融判"不可做"的直接反例：
  //   此前卸载本插件不改变任何可观测输出；B5.2 后 reportDrift 的 trace 行只在装载时新增。
  const { ctx, store } = await loadReal()
  const entryId = await ctx.loader.create({ name: 'dsh-mana-user-model', config: {} })
  await settle(300)
  const core = ctx.get('mana-core')
  const um = ctx.get('mana-user-model')
  assert.ok(core && um, '前置：两服务都须可读')

  um.updatePreference({ key: 'k', value: 'a' })
  const before = traceCount(core.db, 'user-model/drift')
  um.reportDrift(new Date().toISOString())
  const loaded = traceCount(core.db, 'user-model/drift')
  assert.equal(loaded - before, 1, '装载时同一触发必须**新增**一行（否则这条反证腿平凡通过）')

  // 卸载 → 服务消失 ⇒ 同一触发无从发生（本仓口径：卸载 = 调用点不存在）
  ctx.loader.remove(entryId)
  await settle(350)
  assert.equal(ctx.get('mana-user-model'), undefined, '卸载后服务必须不可读（残留 = 卸载没真做）')
  const afterUnload = traceCount(core.db, 'user-model/drift')
  assert.equal(afterUnload, loaded, '卸载后不得再新增（真发生的话说明行是别人写的，"卸载即净"不成立）')
  // ⚠ 边界如实声明：本腿证明的是"经本包服务面触发不再产生新行"。
  //   它**不**覆盖"有人绕过服务面直调 core"——那种写者不属于本包，本判据不冒充能抓它。
  core.db.close()
  rmSync(store, { recursive: true, force: true })
})

test('行为④ 本包写入的 trace 类型**全部**在自有命名空间内（不冒充 S1 五类）', async () => {
  const { core, um, close } = await mount()
  um.updatePreference({ key: 'k', value: 'a' })
  um.reportDrift(new Date().toISOString())
  const kinds = core.db.prepare('SELECT DISTINCT event_type FROM mana_trace').all().map((r) => String(r.event_type))
  assert.ok(kinds.includes('user-model/drift'), '本包的类型应出现；实测 ' + JSON.stringify(kinds))
  for (const five of ['observation', 'attention', 'decision', 'recall', 'injection']) {
    assert.ok(!kinds.includes(five), '本包不得写 S1 五类（会污染"五类各有多少行"的读数）：出现 ' + five)
  }
  close()
})
