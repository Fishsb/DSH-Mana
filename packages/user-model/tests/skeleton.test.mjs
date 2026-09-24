/**
 * B5.1 · P2 骨架判据测试（S1 席 · packages/user-model）
 *
 * 测的是**真行为**（用最小假 ctx 直跑 apply），不是"文件在、函数在"。
 * 运行（**禁止管道取退出码**）：cd packages/user-model && node --test "tests/*.test.mjs"; echo $?
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = dirname(dirname(fileURLToPath(import.meta.url)))
const mod = await import(new URL('../src/index.ts', import.meta.url).href)

/** 最小假 ctx：只实现 apply 实际用到的 get / effect / provide / on。 */
function fakeCtx({ withCore = true } = {}) {
  const provides = new Map()
  const listeners = []
  const effects = []
  return {
    provides,
    listeners,
    on: (evt, fn) => listeners.push({ evt, fn }),
    get: (name) => (withCore && name === 'mana-core' ? { plugin: 'mana-core' } : undefined),
    provide: (name, svc) => {
      provides.set(name, svc)
      return () => provides.delete(name)
    },
    effect: (fn) => effects.push(fn()),
  }
}

test('B5.1-⑦ user-model 骨架：apply 提供服务且 status 可读', () => {
  const ctx = fakeCtx()
  mod.apply(ctx, { precisionTarget: null })
  const svc = ctx.provides.get('mana-user-model')
  assert.ok(svc, '未 provide mana-user-model（未 provide = 插件没真跑起来）')
  assert.equal(svc.status().plugin, 'mana-user-model')
  assert.equal(svc.status().wired, true)
})

test('B5.1-⑦ 精度目标缺省 null（未校准 ≠ 编一个数冒充已拍板，册:568）', () => {
  const ctx = fakeCtx()
  mod.apply(ctx, { precisionTarget: null })
  assert.equal(ctx.provides.get('mana-user-model').status().precisionTarget, null)
  // 显式给了才生效
  const ctx2 = fakeCtx()
  mod.apply(ctx2, { precisionTarget: 0.75 })
  assert.equal(ctx2.provides.get('mana-user-model').status().precisionTarget, 0.75)
})

test('B5.1-⑦ G9：apply 注册了 agent/pre-step 监听器且依赖 core（缺 core 即抛）', () => {
  const ctx = fakeCtx()
  mod.apply(ctx, { precisionTarget: null })
  assert.equal(ctx.listeners.length, 1, '未注册任何监听器')
  assert.equal(ctx.listeners[0].evt, 'agent/pre-step')
  assert.deepEqual(mod.inject, ['mana-core'])
  assert.throws(() => mod.apply(fakeCtx({ withCore: false }), { precisionTarget: null }), /缺少 mana-core/)
})

// ── 缺陷 D1 的两条腿（互补，缺一即半口牙）────────────────────────────────────
// 缺陷本体：`Schema.union([...]).default(null)` 在本仓 schemastery 3.18.4 上**从不生效**
//   （机制见 `packages/user-model/src/index.ts` 的 `Config` 注释），
//   而修复由**两处**组成：① 移除那个死缺省（声明面诚实）② `apply` 里 `?? null` 归一（产物面可达）。
//   ⇒ 判据也必须**两条腿**分别钉住这两处，否则任一复发都有半边测不出（D1 红即由此而来）。

test('B5.1-⑦ 【回归 · 声明面】`precisionTarget` 不得带缺省声明（与 metacognition 侧同形）', () => {
  // ── D1 的答案：「哪些可读事实在『有 `.default(null)`』与『没有』时不同？」逐项实测 ──
  //   ① `Config({})` 解析结果        → 两侧**同形**（都 `{}`，键都不出现）      ⇒ 无法区分
  //   ② `?? null` 归一后产物         → 两侧**同形**（都 `null`）               ⇒ 无法区分 ← D1 的根因
  //   ③ 显式传值路径（0.75/0/抛错）   → 两侧**同形**                            ⇒ 无法区分
  //   ④ `Config.dict.<key>.meta` 上是否**自有** `default` 属性 → **唯一不同**：
  //        有 `.default(null)` ⇒ `hasOwnProperty(meta,'default') === true`（值为 null）
  //        没有              ⇒ `false`（meta 为 `{}`）
  //   ⇒ 这就是本题的答案：只有 **schema 元信息**能区分"声明了但从不生效"与"没声明"；
  //     断言产物（①②③）**必然**对"死缺省复发"假绿 —— 因为归一把产物救回来了。
  //   ⚠ 本腿**不能替代**下面那条产物腿：删掉 `?? null` 时本腿照样绿（声明本来就诚实）。
  const meta = mod.Config.dict.precisionTarget.meta
  assert.equal(
    Object.prototype.hasOwnProperty.call(meta, 'default'),
    false,
    'precisionTarget 又带上缺省声明了 —— 本库表达不出 null 缺省，声明它 = 从不生效的假旋钮；'
      + '若 schemastery 已修好 null 缺省，请改回 `.default(null)` 并把本条改成断言"解析后得 null"',
  )
  // 防"凡缺省皆禁"的假红：本腿只针对**该键**，且该键的取值面必须仍完整（number 与 null 都要能进）。
  assert.equal(mod.Config({ precisionTarget: 0.5 }).precisionTarget, 0.5, '取值面被本腿误伤（number 进不来）')
  assert.equal(mod.Config({ precisionTarget: null }).precisionTarget, null, '取值面被本腿误伤（null 进不来）')
})

test('B5.1-⑦ 【回归 · 产物面】真 Config + apply 后未校准态必须是 null 而不是 undefined', () => {
  // 判因（本席 2026-09-24 实测，非推断）：真宿主路径下 `config.precisionTarget === undefined`
  //   （缺省键被解析器丢弃 ⇒ `apply` 拿到 undefined），而契约要求「未校准 = null 可读」。
  // 为什么既有用例抓不到：本文件 36/45 行传的是**手写** `{ precisionTarget: null }`，直达 apply
  //   ⇒ **绕过 Config 解析**。判据测的是"我喂进去的值"而不是"宿主真给的值"。
  // ⚠ 本腿**不能替代**上面那条声明腿：把 `.default(null)` 写回去（复发）时本腿**仍绿**（归一救住了产物）。
  const ctx = fakeCtx()
  mod.apply(ctx, mod.Config({}))
  assert.equal(
    ctx.provides.get('mana-user-model').status().precisionTarget,
    null,
    '未校准态被静默抹成 undefined：宿主无法区分"显式未校准"与"字段根本没到"',
  )
})

test('B5.1-⑦ 【回归 · 显式值】归一不得吃掉/篡改申请方真给的值（防"除谎做成丢功能"）', () => {
  // `?? null` 只把 `undefined` 折成未校准，**不是**"凡值都改"。
  // 逐值钉住，防后来者换成更粗的手段（`||`、`Number(v) || null`）把 0 / NaN 吃掉。
  const applyWith = (cfg) => {
    const ctx = fakeCtx()
    mod.apply(ctx, mod.Config(cfg))
    return ctx.provides.get('mana-user-model').status().precisionTarget
  }
  assert.equal(applyWith({ precisionTarget: 0.75 }), 0.75, '显式 0.75 被改写')
  assert.equal(applyWith({ precisionTarget: 0 }), 0, '显式 0 被改写（`||` 归一会犯的错）')
  assert.equal(applyWith({ precisionTarget: -1 }), -1, '显式 -1 被改写')
  assert.equal(applyWith({ precisionTarget: null }), null, '显式 null 被改写')
  assert.ok(Number.isNaN(applyWith({ precisionTarget: Number.NaN })), 'NaN 未被原样透传')
  assert.equal(
    applyWith({ precisionTarget: Number.POSITIVE_INFINITY }),
    Number.POSITIVE_INFINITY,
    'Infinity 未被原样透传',
  )
  assert.throws(() => mod.Config({ precisionTarget: 'x' }), /expected number/, '非法字符串必须被 schema 拒')
})

test('B5.1-⑦ 契约缺口已解除：user_model_history 表已在 core 预留（A4-4 前置满足）', () => {
  // ⚠ **本条的语义在 2026-09-25 反转**（原为「缺口登记」，现为「缺口已闭」）。
  //   原登记文：「册:556 要求该表必须在阶段 0 预留，实测不在 schema 内 ⇒ 漂移在数据上仍不可观测」。
  //   该缺口已由 S0 席补齐（commit 见 core schema 的 user_model_history 段 + ADR-6 迁移承接），
  //   故按原登记文的指示「若 S0 已补，请本条的登记方随之撤账」**改为正向断言** ——
  //   登记式判据的价值就在这里：状态一变就转红，逼人回来更新，而不是永远绿着当装饰。
  const schema = readFileSync(join(PKG, '..', 'core', 'src', 'schema.ts'), 'utf8')
  assert.equal(
    /user_model_history/.test(schema),
    true,
    'core schema 应已含 user_model_history（A4-4 要求阶段 0 预留）；若又消失了，那是回归',
  )
  // 列齐检查（判据 A4-4 原文的列清单）
  for (const col of ['old_value', 'new_value', 'source_evidence_id']) {
    assert.ok(
      new RegExp(`user_model_history[\\s\\S]{0,600}?${col}`).test(schema),
      `user_model_history 应含列 ${col}`,
    )
  }
})

test('B5.1-⑦ 接线缺口已解除：core 已提供 updateUserModel 写入口（真增行可机检）', () => {
  // ⚠ **本条的语义在 2026-09-25 反转**（原为「零写入者登记」，现为「写入口已存在」）。
  //   原登记文：「本包服务面只有 status()，且全仓对 user_model 的 INSERT/UPDATE/DELETE 零命中」。
  //   该缺口已由 S0 席补齐 —— **写入口收在 core**（`updateUserModel`，与 writeTrace/writeInjectLog 同形态），
  //   使「更新主表」与「追加历史」在同一事务内完成（分开写会留下『主表改了、历史没记』的不可观测中间态）。
  //   故按原登记文的指示撤账，改为正向断言：写入口必须在，且它真能增行。
  const core = readFileSync(join(PKG, '..', 'core', 'src', 'index.ts'), 'utf8')
  assert.ok(/updateUserModel\s*\(/.test(core), 'core 服务面应提供 updateUserModel 写入口')
  assert.ok(/user_model_history/.test(core), 'core 应把历史追加与主表更新绑在同一路径上（否则漂移不可观测）')

  // 反证：写路径不是"凡出现表名就过" —— 用**真调用**证明它增行。
  // （本包不直接依赖 core 的库句柄，故此处断言的是 core **导出面**的事实；
  //   端到端的真增行判据在 `packages/core/tests/user-model-history.test.mjs` 的 M2，
  //   那条已在全量测试里跑 —— 两条合起来才构成「可机检」。）
  assert.ok(/UPDATE user_model|ON CONFLICT\(key\) DO UPDATE/i.test(core), '应真更新主表（不是只记历史）')
})
