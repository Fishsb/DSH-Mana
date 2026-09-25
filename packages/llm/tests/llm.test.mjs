/**
 * `dsh-mana-llm` 判据（L-01）。
 *
 * ── 本批的判据纪律（**每一条都对应一个实测踩过的坑**）──────────────────────────
 *  ① **代理指标非判据**：不断言"源码里有 registerAdapter 这个字符串"（注释级证据），
 *     而是**走真 `ctx.llm` 面**读 `listProviders()` 看路由**真的挂上了没**。
 *  ② **负向对拍必须打对靶**（本席 2026-09-25 实测纠正）：
 *     任务书给的负向预设是「注释掉 `ctx.effect` 的 finisher ⇒ 卸载后路由仍在」。
 *     本席实测**该前提不成立**：`registerAdapter` 内部 `this.ctx.effect(...)` 绑在
 *     **调用方 fiber** 上，卸载 fiber 时路由照样消失 —— 实测五站点归属矩阵：
 *       · ctx.llm 裸调（apply 内）              → 卸载后 **消失**
 *       · ctx.llm + ctx.effect 显式 handle      → 消失
 *       · ctx.effect 但 **finisher 被注释掉**    → **仍然消失**（≠ 任务书假设）
 *       · **ctx.root.llm（注册逃出本 fiber）**   → **残留 = 真泄漏**
 *       · ctx.root.llm + ctx.effect 显式 handle → 消失
 *     ⇒ 对拍**改打在归属维度上**（见 ⑤）：同一探针喂 [真实现] 与 [故意逃逸的变体]，
 *       必须一个"消失"、一个"残留"。写一条"注释掉 finisher 后路由仍在"的断言
 *       会**永远为假**，那不是判据，是装饰。
 *  ③ **夹具绿 ≠ 真数据绿**：本文件的"路由"断言读的是**宿主 LlmRuntime 的真实注册表**，
 *     不是自建的假对象。
 *  ④ 用例数本身是判据（末条自检）：实测**空文件**在显式路径下也报
 *     `# tests 1 / # pass 1 / exit 0` ⇒ 空/截断文件是假绿。
 *
 * 运行（**显式路径**）：node --test packages/llm/tests/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'

const ROOT = new URL('../../', import.meta.url) // packages/
const load = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const EXPECTED_CASES = 9
let ran = 0

/** 桩适配器：兑现 'up' 路由，产出可辨识的块序列（用来证明转发真到了上游）。 */
class UpstreamStub extends LlmAdapter {
  async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'UPSTREAM' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'UPSTREAM' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * 装配一套真环境：host `ctx` + LlmRuntime + mana-core + mana-llm。
 * ⚠ 返回的 `fiber` 是**本包**的 fiber —— 卸载即净的断言必须在它上面做。
 */
async function mount(config) {
  const ctx = new Context()
  ctx.plugin(LlmRuntime)
  await settle(200)
  const core = await load('core')
  const mod = await load('llm')
  ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-llm-')), 'mana.db') })
  await settle(250)
  // 上游桩：先挂上，供转发腿使用（未配置时不影响 routeRegistered 判定）。
  ctx.get('llm').registerAdapter(['up'], new UpstreamStub())
  const fiber = ctx.plugin(mod, config ?? { upstreamProvider: 'up', upstreamModel: '' })
  await settle(300)
  return { ctx, mod, fiber }
}

const routes = (ctx) => (ctx.get('llm')?.listProviders() ?? []).map((p) => p.id)

test(`① 四要素齐 + patch id 与 name 一致（形状面，A0-5 同口径）`, async () => {
  ran += 1
  const { mod } = await mount()
  assert.equal(mod.name, 'mana-llm', '插件 name 必须是 mana-llm')
  assert.deepEqual(mod.inject, ['mana-core'], "inject 只声明 ['mana-core']（保守口径，见文件头）")
  assert.equal(typeof mod.apply, 'function', '必须导出 apply')
  assert.ok(mod.Config, '必须导出 Config（schemastery schema）')
  const { readFileSync } = await import('node:fs')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const m = /^\s*-\s*id:\s*(\S+)/m.exec(patch)
  assert.equal(m?.[1], 'mana-llm', 'patch id 必须与 name 一致（不一致 ⇒ 装配面与 inject 面各说各话）')
})

test("② 装配后 ctx.get('mana-llm') 可读且 status() 报 wired:true + 路由真挂上", async () => {
  ran += 1
  const { ctx } = await mount()
  const svc = ctx.get('mana-llm')
  assert.ok(svc, 'mana-llm 服务必须可读（未 provide = 插件没真跑起来）')
  const st = svc.status()
  assert.equal(st.wired, true)
  assert.equal(st.plugin, 'mana-llm')
  assert.equal(st.provider, 'mana')
  // ⚠ 「服务可读」与「路由挂上」是两件事，必须分开断言（G11：装配清单 ≠ 生效）
  assert.equal(st.routeRegistered, true, '路由必须真注册到宿主 llm 面')
  assert.ok(routes(ctx).includes('mana'), `宿主注册表必须含 'mana'；实测 ${JSON.stringify(routes(ctx))}`)
})

test(`③ 负向：卸载本包后 'mana' 路由必须消失（卸载即净）`, async () => {
  ran += 1
  const { ctx, fiber } = await mount()
  assert.ok(routes(ctx).includes('mana'), '前置：装配后路由须在（否则本用例平凡通过）')
  await fiber.dispose()
  await settle(300)
  assert.ok(
    !routes(ctx).includes('mana'),
    `卸载后 'mana' 路由必须消失；实测 ${JSON.stringify(routes(ctx))}`,
  )
  // 上游桩不属于本包 ⇒ 不得被误清（防"一刀切清空注册表"式的假通过）
  assert.ok(routes(ctx).includes('up'), '卸载只应释放本包的路由，不得波及他路由')
})

test(`④ 卸载后 status() 的 routeRegistered 必须转 false（状态面与事实一致）`, async () => {
  ran += 1
  const { ctx, fiber } = await mount()
  const svc = ctx.get('mana-llm')
  assert.equal(svc.status().routeRegistered, true, '前置：装配后须为 true')
  await fiber.dispose()
  await settle(300)
  // ⚠ 服务对象在 fiber 卸载后仍被本引用持有（cordis 不回收 JS 对象），
  //   故这里判的是**它回报的状态是否跟得上事实**，而不是"服务还活着"。
  assert.equal(
    svc.status().routeRegistered,
    false,
    '卸载后 routeRegistered 必须为 false —— 否则状态面在说谎（比没有状态面更坏：会掩盖失败）',
  )
})

test(`⑤ 负向对拍（打对靶）：泄漏变体必须能被"路由残留"抓到 —— 差分对拍`, async () => {
  ran += 1
  // 同一条探针，喂两种实现，结果必须**不同**：一个消失、一个残留。
  // 只用其中一种都证明不了判据有牙（全绿/全红都没信息）。
  const probe = async (register) => {
    const ctx = new Context()
    ctx.plugin(LlmRuntime)
    await settle(200)
    const fiber = ctx.plugin({
      name: 'leak-probe',
      inject: ['llm'],
      apply(c) {
        register(c)
      },
    })
    await settle(300)
    const mounted = routes(ctx).includes('mana')
    await fiber.dispose()
    await settle(300)
    return { mounted, residue: routes(ctx).includes('mana') }
  }
  const good = new (class extends LlmAdapter { async *stream() {} })()
  const bad = new (class extends LlmAdapter { async *stream() {} })()

  // 真实现形态：注册经 ctx.llm + 显式 ctx.effect 握 handle（本包所用）
  const okRun = await probe((c) => {
    c.effect(() => {
      const h = c.llm.registerAdapter(['mana'], good)
      return () => h()
    }, 'route')
  })
  // 泄漏形态：注册走 ctx.root ⇒ **逃出本 fiber**，fiber 卸载不再释放它
  const leakRun = await probe((c) => {
    c.root.llm.registerAdapter(['mana'], bad)
  })

  assert.equal(okRun.mounted, true, '对拍前置：真实现形态在装配后必须有路由')
  assert.equal(leakRun.mounted, true, '对拍前置：泄漏形态在装配后必须有路由（否则对拍平凡）')
  assert.equal(okRun.residue, false, '真实现形态：卸载后不得残留')
  assert.equal(
    leakRun.residue,
    true,
    '**判据有牙的证据**：注册逃出本 fiber（ctx.root）时，卸载后必须残留 —— ' +
      '若这里为 false，说明"路由残留"这条腿根本抓不到泄漏，则判据③是假绿',
  )
})

test(`⑥ 手搓消息必须在通道边界显式失败（不许静默丢弃）`, async () => {
  ran += 1
  const { ctx, mod } = await mount()
  const handcrafted = { role: 'user', content: 'hi' } // 缺 id / source，content 非数组
  const check = mod.assertHostMessages([handcrafted])
  assert.equal(check.ok, false, '手搓 {role,content} 必须被判不合格（本仓教训：缺基类字段会在宿主侧被拒绝或静默丢弃）')
  assert.ok(check.errors.length >= 2, `应逐项点名缺失字段；实测 ${JSON.stringify(check.errors)}`)
  // 官方构造函数产物必须通过
  const good = mod.manaUserMessage('合法消息')
  assert.equal(mod.assertHostMessages([good]).ok, true, 'createUserMessage 产物必须体检通过')
  assert.ok(typeof good.id === 'string' && good.id.length > 0, '官方构造函数必须给 id')
  assert.ok(Array.isArray(good.content), '官方构造函数必须给 ContentBlock[]')
  // 端到端：手搓消息经 'mana' 路由必须变成**可观测**的终态 error finish，而不是静默空流
  const chunks = []
  for await (const c of ctx.get('llm').stream({ provider: 'mana', model: 'm', messages: [handcrafted] })) chunks.push(c)
  const finish = chunks.at(-1)
  assert.equal(finish?.type, 'finish', '必须有终态 finish（空流 = 静默失效）')
  assert.equal(finish.reason.kind, 'error', `手搓消息必须显式失败；实测 ${JSON.stringify(finish.reason)}`)
})

test(`⑦ 真转发：合法消息经 'mana' 路由必须抵达上游并原样透传 chunk`, async () => {
  ran += 1
  const { ctx, mod } = await mount()
  const msg = mod.manaUserMessage('转发探针')
  const seen = []
  for await (const c of ctx.get('llm').stream({ provider: 'mana', model: 'm', messages: [msg] })) seen.push(c)
  assert.deepEqual(
    seen.map((c) => c.type),
    ['block-start', 'text-delta', 'block-end', 'finish'],
    '转发链必须原样透传上游 chunk 序列',
  )
  const text = seen.find((c) => c.type === 'text-delta')?.text
  assert.equal(text, 'UPSTREAM', '内容必须来自上游（证明真转发，而不是本地造块）')
})

test(`⑧ 未配置上游 + 自转发：都必须显式报错，不得静默`, async () => {
  ran += 1
  // 未配置上游：显式 error finish（可观测），不是空流
  const noUp = await mount({ upstreamProvider: '', upstreamModel: '' })
  const c1 = []
  for await (const c of noUp.ctx.get('llm').stream({
    provider: 'mana', model: 'm', messages: [noUp.mod.manaUserMessage('x')],
  })) c1.push(c)
  assert.equal(c1.at(-1)?.reason?.kind, 'error', `未配置上游必须显式失败；实测 ${JSON.stringify(c1.at(-1))}`)
  // 自转发：**装配期**即拒（实测后果 = 无界递归 OOM，不是"慢"）
  //
  // ⚠ 断言口径的实测依据（本席 2026-09-25 直跑测到，不许凭想象写）：
  //   cordis 的 `ctx.plugin()` **不抛** `apply` 里的异常，也**不发** internal/error 事件
  //   （实测 events=[]）。它能被外部读到的只有两件事：
  //     ① `fiber.state`：正常装配 = **2**，`apply` 抛异常 = **3**；
  //     ② `ctx.get(服务名)` = undefined。
  //   ⇒ 故本用例判**这两条**，而不是 `assert.throws`（那会是一条永远为假的断言）。
  //   ⚠ 并且必须配**差分控制**：同一个 ctx 上再挂一个**配置正常**的实例，它必须 state=2。
  //     否则"state==3"可能只是因为别的原因失败（夹具绿 ≠ 判据有牙）。
  //
  // ⚠⚠ **纠错留痕**（本席实测，本注释初版写错过一次）：
  //   初版写「后挂一个正常实例会撞 DUPLICATE_ADAPTER ⇒ 也是 state=3」。**实测为假**：
  //   上一条已抛在 \`registerAdapter\` **之前**，根本没占用 'mana' 路由 ⇒ 后挂的正常实例
  //   装配成功（state=2，见下面 \`goodFiber\` 断言为绿）。两句错话已删：
  //   ① "会撞路由冲突"是编的；② 失败态**不留半装配**（无路由残留）由本用例自己的
  //   \`!routes.includes('mana')\` 断言独立覆盖，不靠那个虚构解释。
  const ctx = new Context()
  ctx.plugin(LlmRuntime)
  await settle(200)
  const core = await load('core')
  const mod = await load('llm')
  ctx.plugin(core, { storePath: join(mkdtempSync(join(tmpdir(), 'mana-llm-self-')), 'mana.db') })
  await settle(250)

  // 反方向（自转发）⇒ 必须拒绝装配
  const badFiber = ctx.plugin(mod, { upstreamProvider: 'mana', upstreamModel: '' })
  await settle(300)
  assert.equal(
    badFiber.state,
    3,
    'upstreamProvider == 自身路由时，apply 必须抛（实测 OOM 是不可恢复的进程级故障）⇒ fiber 应停在失败态 3',
  )
  assert.equal(ctx.get('mana-llm'), undefined, '被拒的装配不得提供 mana-llm 服务（不许半装配）')
  assert.ok(
    !routes(ctx).includes('mana'),
    `被拒的装配不得留下 'mana' 路由；实测 ${JSON.stringify(routes(ctx))}`,
  )

  // 差分控制：同一 ctx 上配置正常的实例必须装得上（证明上面 state==3 是"自转发被拒"，不是环境性失败）
  const goodFiber = ctx.plugin(mod, { upstreamProvider: 'up', upstreamModel: '' })
  await settle(300)
  assert.equal(goodFiber.state, 2, '差分控制：配置正常的实例必须装配成功（state=2）')
  assert.ok(routes(ctx).includes('mana'), '差分控制：正常实例必须有 mana 路由')
  assert.ok(ctx.get('mana-llm'), '差分控制：正常实例必须提供 mana-llm 服务')
})

test(`⑨ 用例计数自检（防本文件被截断/删用例 —— 空文件会报 tests 1 / pass 1 的假绿）`, () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本次执行到的用例数必须为 ${EXPECTED_CASES}；实测 ${ran}（有用例被删即红）`)
})