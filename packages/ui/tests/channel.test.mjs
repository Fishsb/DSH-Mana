/**
 * `dsh-mana-ui` **模型通道**判据（本卡新增）。
 *
 * 覆盖用户指令三条（逐条对得上）：
 *  ① 「本地与云端都要有」      ⇒ CH①/CH②：两条通道都可选中且路由形状正确；
 *  ② 「切需要在 UI 让用户设定」⇒ CH②/CH⑤：UI 端点可写、渲染面有选择框且三态可分辨；
 *  ③ 「当前默认用云端」        ⇒ CH①：无人设过时 source=default 且通道是 cloud。
 *
 * 另有三条**纪律**判据（本仓反复出的形态，各值一条）：
 *  · CH③ 非法值**不得静默夹到缺省**（那会让「我设了 local」变成一句无从发现的谎）；
 *  · CH④ 写口缺席**不得静默成功**（看着能用、其实没存住）；
 *  · CH⑥ **读数不得回显凭据（含前缀）** —— 用运行时真值反证，**不把任何凭据字面量写进本文件**
 *    （写进夹具 = 把密钥纪律改写成「别让它出现在别处」）。
 *
 * 运行：node --test tests/*.test.mjs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'

const ROOT = new URL('../../', import.meta.url) // packages/
const PKG = new URL('../', import.meta.url) // packages/ui/
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const LOAD = (dir) => import(new URL(`${dir}/src/index.ts`, ROOT).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const cleanups = []
process.on('exit', () => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }) })

/** 临时 DSH_HOME（**不碰用户真实库**）：core 的库路径留空时走 $DSH_HOME/memory/mana.db。 */
function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'mana-channel-'))
  cleanups.push(home)
  mkdirSync(join(home, 'memory'), { recursive: true })
  return home
}

/**
 * 真装配一处：真 cordis Context + 真 core + 真 createPanelStore 适配器 + 真 registerPanels。
 * ⚠ 不用假端口：假端口只能证明「函数在」，证明不了「偏好真的落在盘上」（本包既有判据同口径）。
 * writer 传 false ⇒ **不注入** core 的偏好写入口（CH④ 要的正是那个负向形态）。
 */
async function mount(home, writer = true) {
  const ctx = new Context()
  const core = await LOAD('core')
  const panelMod = await import(new URL('src/panel.ts', PKG).href)
  const storeMod = await import(new URL('src/store.ts', PKG).href)
  const coreFiber = ctx.plugin(core, { storePath: join(home, 'memory', 'mana.db') })
  await settle()
  const svc = ctx.get('mana-core')
  const store = writer
    ? storeMod.createPanelStore(svc.db, (key, value) => svc.updateUserModel({ key, value }))
    : storeMod.createPanelStore(svc.db)
  const handlers = new Map()
  panelMod.registerPanels({ handle: (m, h) => handlers.set(m, h) }, store)
  const call = (args) => handlers.get(panelMod.METHODS.channel)(args)
  return { ctx, svc, coreFiber, call, dispose: () => coreFiber.dispose() }
}

// ── CH① 缺省 = cloud（用户指令③）──────────────────────────────────────────────
test('CH① 无人设过 ⇒ 缺省 cloud（source=default），模型取自该通道自带缺省', async () => {
  const home = tempHome()
  const a = await mount(home)
  const st = await a.call({})
  assert.equal(st.channel, 'cloud', '缺省必须走云端（用户指令原文：当前默认用云端）')
  assert.equal(st.source, 'default', '没人设过 ⇒ source 必须是 default（与 user 不同形）')
  assert.equal(st.model, 'jev-1.13', '模型必须回显该通道的缺省模型（否则用了哪个模型不可见）')
  assert.deepEqual(st.values, ['local', 'cloud'], '两条通道都要可选')
  assert.equal(st.key, 'mana.eval.modelChannel', '偏好键名由 Host 回传（客户端不硬编码第二份）')
  await a.dispose()
})

// ── CH② 用户在 UI 设为 local ⇒ 持久化，且新开一处装配仍读得到 ─────────────────
test('CH② UI 里选 local ⇒ 写进偏好表；重开一处装配仍读回 local（值在盘上，不在内存）', async () => {
  const home = tempHome()
  const a = await mount(home)
  const ack = await a.call({ channel: 'local' })
  assert.equal(ack.ok, true, '写必须成功（否则 UI 可设只是文案）')
  assert.equal(ack.persisted, true)
  assert.equal(ack.channel, 'local')
  assert.equal(ack.source, 'user', '写成功后来源必须变成 user —— 这正是「用户设置优先于缺省」的读数')
  assert.equal(ack.model, 'qwen3.5:0.8b', '切通道后模型必须跟着换成该通道的缺省模型')
  await a.dispose()

  const b = await mount(home)
  const back = await b.call({})
  assert.equal(back.channel, 'local', '新开装配必须读回 local（读的是盘，不是上一处的内存）')
  assert.equal(back.source, 'user')
  assert.equal(back.model, 'qwen3.5:0.8b')
  // 历史行也在（core 的 updateUserModel 绑同事务写入）：漂移可数，而不是只剩最后一个值
  const hist = b.svc.db.prepare('SELECT key, new_value FROM user_model_history').all()
  assert.deepEqual(hist.map((r) => r.new_value), ['local'], '偏好变更必须留历史行（core 的既有写入口）')
  await b.dispose()
})

// ── CH③ 非法值：写拒收、读回显 —— 都不得静默夹到缺省 ──────────────────────────
test('CH③ 非法通道值：写拒收（带原始输入回显），存量非法则落 invalid-fallback 且回显原值', async () => {
  const home = tempHome()
  const a = await mount(home)
  const bad = await a.call({ channel: 'nonsense' })
  assert.equal(bad.ok, false, '非法值必须拒收')
  assert.equal(bad.persisted, false)
  assert.match(bad.reason, /非法通道值/, '拒收必须给可读原因')
  assert.match(bad.reason, /nonsense/, '原因里要带回**用户传的原值**，便于当场看清传了什么')
  assert.equal(bad.channel, 'cloud', '拒收后落回当前生效值（这里是缺省 cloud），而不是被写进去')
  await a.dispose()

  // 直接往偏好表塞一个非法值（模拟外部写入 / 版本漂移）
  const b = await mount(home)
  b.svc.updateUserModel({ key: 'mana.eval.modelChannel', value: 'gpt-9000' })
  const st = await b.call({})
  assert.equal(st.channel, 'cloud', '非法存量 ⇒ 回落缺省（系统仍可用）')
  assert.equal(st.source, 'invalid-fallback', '但来源必须**显式**标成非法回退（不得与 default 同形）')
  assert.equal(st.storedValue, 'gpt-9000', '原值必须回显（否则存进去的到底是什么事后无从查）')
  await b.dispose()
})

// ── CH④ 写口缺席不得静默成功 ─────────────────────────────────────────────────
test('CH④ 未注入偏好写口 ⇒ 写操作落 ok:false + reason（禁止静默成功）', async () => {
  const home = tempHome()
  const a = await mount(home, false)
  const read = await a.call({})
  assert.equal(read.channel, 'cloud', '读路不受影响（只读装配仍可用）')
  const ack = await a.call({ channel: 'local' })
  assert.equal(ack.ok, false, '写不进去就必须报 false —— 静默成功 = 用户以为存住了')
  assert.equal(ack.persisted, false)
  assert.ok(String(ack.reason).length > 0, '必须有可读 reason')
  assert.match(ack.reason, /写入口|未注入/, '原因要指向真因（写口未注入），不是泛化文案')
  assert.equal(ack.channel, 'cloud', '失败后通道不得变成 local（那是假装写成功）')
  await a.dispose()
})

// ── CH⑤ 渲染面：选择框可枚举，且三态不同形 ───────────────────────────────────
test('CH⑤ 渲染树：选择框节点可枚举；通道面三态（不可用/缺省/用户设的）文案与标记各不相同', async () => {
  const client = await import(new URL('src/client/index.ts', PKG).href)
  const React = { createElement: (type, props, ...kids) => ({ type, props, kids }) }
  const walk = (node, pred, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (pred(node)) out.push(node)
    for (const kid of node.kids ?? []) walk(kid, pred, out)
    return out
  }
  const base = { channel: 'cloud', model: 'jev-1.13', source: 'default', storedValue: null, modelSource: 'route-default', values: ['local', 'cloud'] }
  const picked = []
  const user = client.renderChannel(React, { ...base, channel: 'local', model: 'qwen3.5:0.8b', source: 'user', storedValue: 'local' }, (v) => picked.push(v))
  const dflt = client.renderChannel(React, { ...base })
  const gone = client.renderChannel(React, null)

  const sel = walk(user, (n) => n.props && n.props['data-role'] === client.CHANNEL_MARK.select)
  assert.equal(sel.length, 1, '必须有一个可选择节点（UI 可设定的落点）')
  assert.equal(sel[0].props['data-value'], 'local', '当前值必须落在节点上（判据可读，不靠文案匹配）')
  assert.equal(sel[0].props['data-source'], 'user', '来源必须落在节点上')
  assert.deepEqual(sel[0].kids.map((o) => o.props['data-option']), ['local', 'cloud'], '两个通道都要成为选项')
  assert.equal(typeof sel[0].props.onChange, 'function', '必须挂 onChange（否则选择只是展示）')
  // onChange 真能取出用户选的值（合成事件形状与浏览器一致）
  sel[0].props.onChange({ target: { value: 'cloud' } })
  assert.deepEqual(picked, ['cloud'], 'onChange 必须把选中的通道原值交出去')

  const textOf = (tree) => walk(tree, (n) => n.props && n.props['data-role'] === client.CHANNEL_MARK.current).map((n) => String(n.kids[0]))[0]
  const tUser = textOf(user)
  const tDflt = textOf(dflt)
  assert.notEqual(tUser, tDflt, '「用户设的」与「缺省」的文案不得同形（否则我设了没生效看不出来）')
  assert.match(tUser, /你/, '用户设的那条要点明是用户设的')
  assert.match(tDflt, /缺省/, '缺省那条要点明是缺省')

  const gonePanel = walk(gone, (n) => n.props && n.props['data-panel'] === client.CHANNEL_MARK.panel)[0]
  assert.equal(gonePanel.props['data-source'], 'unavailable', '取不到通道面 ⇒ 必须显式标 unavailable（≠ 用户没设过）')
  assert.equal(walk(gone, (n) => n.props && n.props['data-role'] === client.CHANNEL_MARK.select).length, 0, '不可用态不画假选择框')
  const goneText = String(walk(gone, (n) => n.props && n.props['data-state'] === 'unavailable')[0].kids[0])
  assert.notEqual(goneText, tDflt, '不可用与缺省必须不同形')
})

// ── CH⑥ 读数不得回显凭据（含前缀）───────────────────────────────────────────
test('CH⑥ 通道读数的 JSON 里不得出现凭据（含前缀）—— 运行时真值反证，不把凭据写进本文件', async () => {
  const home = tempHome()
  const a = await mount(home)
  const st = await a.call({})
  const json = JSON.stringify(st)
  /**
   * ⚠ **本用例刻意不写任何凭据字面量**（连「前缀长什么样」都不写）：夹具里出现前缀，
   *   就等于把密钥纪律改写成「别让它出现在别处」—— 而那正是要防的形态。
   *   判据改为**运行时反证**：环境里若真有凭据，它的整体与前半段都不得出现在读数里。
   * ⚠ 变量名按**归属模块**取（cloud 路由的 keyEnv），不在本文件拼第二份。
   */
  const panelMod = await import(new URL('src/panel.ts', PKG).href)
  const name = panelMod.CHANNEL_ROUTES.cloud.keyEnv
  const live = process.env[name]
  if (typeof live === 'string' && live.length >= 8) {
    assert.ok(!json.includes(live), '读数里出现了完整凭据（**硬红线**）')
    assert.ok(!json.includes(live.slice(0, 8)), '读数里出现了凭据前缀（含前缀回显同样是红线）')
  }
  assert.ok(!/apiKey|authorization|bearer/i.test(json), '读数里不得出现凭据字段名：' + json)
  assert.equal(st.keyEnv, undefined, '通道读数只回偏好键名（key），不回凭据变量名之外的东西')
  await a.dispose()
})

// ── CH⑦ 判定归属唯一：评估器与 UI 共用同一个解析函数 ────────────────────────
test('CH⑦ 结构性：评估器不自己判通道（消费 panel.ts 的 resolveChannel / CHANNEL_ROUTES）', () => {
  const evalSrc = readFileSync(join(REPO, 'tools', 'eval-l1-l4.mjs'), 'utf8')
  assert.match(evalSrc, /packages',\s*'ui',\s*'src',\s*'panel\.ts'/, '评估器必须从 UI 包取通道判定（不得自判）')
  assert.match(evalSrc, /mod\.resolveChannel\(/, '必须调用归属模块的 resolveChannel')
  assert.match(evalSrc, /mod\.CHANNEL_ROUTES\[/, '路由形状（端点 / 模型）必须取自归属模块，不在评估器里写第二份')
})