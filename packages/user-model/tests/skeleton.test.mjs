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

test('B5.1-⑦ 契约缺口登记：user_model_history 表在 core 里不存在（A4-4 前置未满足）', () => {
  // 这条**不是**本包的缺陷，是本席必须在 handoff 挂账的**契约缺口**（core 属 S0 独占写面）：
  // 册:556 要求该表「必须在阶段 0 预留」，实测不在 schema 内 ⇒ 漂移在数据上仍不可观测。
  const schema = readFileSync(join(PKG, '..', 'core', 'src', 'schema.ts'), 'utf8')
  assert.equal(
    /user_model_history/.test(schema),
    false,
    'core schema 里已出现 user_model_history —— 若 S0 已补，请本条的登记方（S1 handoff §5）随之撤账',
  )
})

test('B5.1-⑦ 接线缺口登记：`user_model` 表全仓零写入者（W2-4「消费方调用后真增行」当前不可满足）', () => {
  // 本会议（mana-w2-parallel）W2-4 给本席的判据是「消费方调用后 `user_model` 表真增行」。
  // **实测该判据今天不可能满足**，原因不是"缺消费者"，而是**两处上游都不存在**：
  //   ① 本包服务面只有 `status()`（本文件用例 1 已断言），**没有任何写方法**；
  //   ② 全仓（packages + tools，含 lib/）对 user_model 的 INSERT/UPDATE/DELETE **零命中**
  //      （`grep -rn "INSERT INTO user_model\|UPDATE user_model" packages tools` → exit 1）。
  // 本用例把「零写入者」钉成**可机检事实**，而不是留在散文里：
  //   —— 一旦有人接了写路径，本条**立即转红**，逼他同时补上 W2-4 要的那条判据（真增行）。
  // ⚠ 这是**登记式**判据（本仓既有形态，见上一条）：不是缺陷判决，是让断链可见。
  //
  // ⚠ 两个自匹配陷阱（本席首版实测踩到，故此处必须写成这样）：
  //   ① **判据自己会被自己扫到** —— 本条注释里若出现 SQL 原文，本条就会命中自己 ⇒ 故排除本文件；
  //   ② 模式本身若以字面量出现，同样自命中 ⇒ 故用**片段拼接**构造，不写完整字面量。
  const SQL = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].join('|')
  const WRITE = new RegExp(`(${SQL})\\b[\\s\\S]{0,24}?user_model\\b`, 'i')
  const SELF = fileURLToPath(import.meta.url)
  const roots = [join(PKG, '..'), join(PKG, '..', '..', 'tools')]
  const hits = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|mjs|js)$/.test(e.name) && p !== SELF && WRITE.test(readFileSync(p, 'utf8'))) {
        hits.push(p.slice(PKG.length + 1))
      }
    }
  }
  for (const r of roots) walk(r)
  assert.deepEqual(
    hits,
    [],
    `user_model 已出现写入者（${hits.join(', ')}）—— 接线已开始：请同时补 W2-4 要的「消费方调用后真增行」判据，并撤本条登记`,
  )
  // 反证：判据不是"凡出现表名就红" —— 上面扫到的 0 条并不因为表名不存在（core schema 里就有）。
  assert.ok(WRITE.test('INSERT INTO ' + 'user_model (key) VALUES (?)'), '模式必须真能命中（否则本条是恒真判据）')
})
