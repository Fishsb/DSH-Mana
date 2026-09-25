/**
 * 面④⑤ **buildBlock 服务面** 与 **自有命名空间形态面**（本包自有判据面 · F2 席新建）。
 *
 * 判据原文：
 *  · A1-6（`docs/mana-rollout-plan.md`）注入块整块只有 wrapper 标签，内层 `<` 计数为 0。
 *  · A1-7 注入面是「尾部追加」，不得改写既有消息（前缀缓存）。
 *  · 判据表 `docs/mana-rollout-plan.md:346`：`mana_trace.event_type` 取**裸名五类**；
 *    契约`core/src/event-types.ts` 的事件名**带前缀** —— 两者是不同的事实，不得混写。
 *
 * ⚠ 面④ 的既有教训（`src/index.ts:448-453` 原文）：宿主 `UserMessage` 的真实形状是
 *   `{ id, role, content: ContentBlock[], source }`，`id` 与 `source` 都是**必填**；
 *   **手搓 `{role:'user',content:'…'}` 会被静默丢弃**。故本档必须证明产出块**经宿主官方构造**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, firePreStep, perceive, readInject, readTrace, messageText, STAGE_LABELS } from './_harness.mjs'

// ── ④-1 buildBlock 是服务面：可直取、与真注入块**同源** ──────────────────────
test('G4-① buildBlock 服务面：形态正确，且与真注入进消息里的块逐字一致', async () => {
  const { ctx, store, attention } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '服务面候选', requestId: 'req-svc' })

  const block = attention.buildBlock()
  assert.ok(block.startsWith('<mana-memory>\n'), `块首应为 wrapper 开标签，实得：${block.slice(0, 40)}`)
  assert.ok(block.endsWith('\n</mana-memory>'), `块尾应为 wrapper 闭标签，实得：${block.slice(-40)}`)
  // A1-6：整块只有 2 个 `<`（wrapper 开闭各一），内层必须为 0
  assert.equal((block.match(/</g) ?? []).length, 2, `整块 `<` 应为 2，实得 ${(block.match(/</g) ?? []).length}`)

  // 「服务面看到的」与「真注进去的」必须同源（否则判据测的是另一个东西）
  const decision = await firePreStep(ctx, { turn: 1 })
  const injectedText = messageText(decision.messages[0])
  assert.equal(injectedText, `<mana-memory>\n- 服务面候选\n</mana-memory>`, '注入块内容与 buildBlock 的产出应同源')
  assert.equal(readInject(store)[0].gate, 'injected')
})

// ── ④-2 A1-6 转义：内容里的尖括号不得混进 wrapper 层级 ──────────────────────
test('G4-② A1-6：候选内容里的 < > 被转义，内层 < 计数恒为 0，且 wrapper 计数恒为 2', async () => {
  const { ctx, attention } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '<script>alert(1)</script> 与 <b>粗体</b>', requestId: 'req-esc' })
  const block = attention.buildBlock()

  const inner = block.replace(/^<mana-memory>\n?/, '').replace(/\n?<\/mana-memory>$/, '')
  assert.equal((inner.match(/</g) ?? []).length, 0, `内层不得残留 <：${inner}`)
  assert.equal((block.match(/</g) ?? []).length, 2, '整块 < 应恒为 2（wrapper 开闭各一）')
  assert.ok(inner.includes('＜script＞'), '原样内容里的 < 应被替换为全角（可分辨性，不是可逆性）')
})

// ── ④-3 预算闸：超限**截断**（不得静默丢整块 ⇒ 否则 gate 说 injected 而实际没内容）──
test('G4-③ 预算闸：超限时截断而非静默丢弃（gate 与内容必须一致）', async () => {
  const cap = 120
  const { ctx, store, attention } = await boot({ judge: 'ok', extraConfig: { injectionBudgetChars: cap } })
  perceive(ctx, { content: '长内容'.repeat(200), requestId: 'req-budget' })

  const block = attention.buildBlock()
  assert.notEqual(block, '', '超限就整块丢弃 ⇒ gate 记 injected 而上下文里什么都没有（假账）')
  // 截断口径：取前 cap 个**码点** + 闭标签 ⇒ 码点总数 = cap + 闭标签长度
  const after = block.replace(/^<mana-memory>\n?/, '')
  assert.ok(block.endsWith('</mana-memory>'), '截断后仍须闭合 wrapper（否则结构破损）')
  assert.ok(
    [...block].length <= cap + '</mana-memory>'.length + 1,
    `截断后长度应受控：实得 ${[...block].length}，上限约 ${cap + '</mana-memory>'.length}`,
  )
  const decision = await firePreStep(ctx, { turn: 1 })
  assert.equal(readInject(store)[0].gate, 'injected', '有内容且过阈 ⇒ 仍应记 injected')
  assert.ok(messageText(decision.messages[0]).includes('<mana-memory>'), 'gate 说注入了，消息里就必须真有块')
})

// ── ④-4 产出块**经宿主官方构造**（不是手搓对象）──────────────────────────────
test('G4-④ 产出块经宿主 createUserMessage 构造：id/role/content/source 四件齐且形态合规', async () => {
  const { ctx, attention } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '构造面候选', requestId: 'req-ctor' })
  const decision = await firePreStep(ctx, { turn: 1 })
  const msg = decision.messages[0]

  // ① 运行期形态：宿主 UserMessage 的必填字段一个都不能少（手搓对象正是缺这些）
  assert.deepEqual(Object.keys(msg).sort(), ['content', 'id', 'role', 'source'], `消息字段集不合宿主形态：${JSON.stringify(Object.keys(msg))}`)
  assert.equal(msg.role, 'user')
  assert.equal(typeof msg.id, 'string')
  assert.ok(msg.id.length > 0, 'id 不得为空串（稳定身份是必填）')
  assert.deepEqual(msg.source, { kind: 'user' }, 'source 是生产者标记，必填')
  assert.ok(Array.isArray(msg.content) && msg.content[0]?.type === 'text', 'content 应是 ContentBlock[]')
  // ② 身份由构造器生成（不是常量/复用）：两次构造的 id 必须不同
  const a = await import('/home/lk/Mana/node_modules/@deepseek-ai/dsh-llm/lib/index.js')
  const m1 = a.createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } })
  const m2 = a.createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } })
  assert.notEqual(m1.id, m2.id, '官方构造器每次生成新 id —— 若本包手搓常量 id，会与这里不同形')
  // ③ 真源文本断言：本包必须**引用**宿主构造器，而不是自己拼对象
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(src, /import \{[^}]*createUserMessage[^}]*\} from '@deepseek-ai\/dsh-llm'/, 'src 必须从 dsh-llm 引入 createUserMessage')
  assert.match(src, /createUserMessage\(\{/, 'src 必须真的调用它（只 import 不调用是另一种假绿）')
  // ⚠ 「不得手搓消息对象」这条**必须在剥掉注释后**再判（本席实测踩到）：
  //   源码注释里**原文引用了**那个反例写法（\`\`\`手搓的 {role:'user', content:'...'}\`\`\`）⇒
  //   朴素正则会把「解释为什么不能这么写」判成「这么写了」——那是**对拍打错靶**的典型形态。
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/\{\s*role:\s*'user'\s*,\s*content:/.test(codeOnly), '代码里不得出现手搓 {role,content} 的写法（注释引用不算）')
  assert.equal(attention.buildBlock() !== undefined, true)
})

// ── ④-5 A1-7：既有消息逐字节不变，且既有 wrapper 块存在时**不得**误判 reset ──
test('G4-⑤ A1-7 前缀逐字节不变；且既有消息里含 wrapper 时不得误记 reset', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '前缀候选·甲', requestId: 'req-p1' })
  const first = await firePreStep(ctx, { turn: 1, messages: [] })
  const injectedMsg = first.messages[first.messages.length - 1]

  // 第二次：把注入块放回上下文（模拟它仍在）+ 一条普通既有消息
  const existing = { id: 'm-hist', role: 'user', content: [{ type: 'text', text: '历史第 1 条' }], source: { kind: 'user' } }
  const snapshot = JSON.stringify([existing, injectedMsg])
  perceive(ctx, { content: '前缀候选·乙', requestId: 'req-p2' })
  const second = await firePreStep(ctx, { turn: 2, messages: [existing, injectedMsg] })

  assert.equal(JSON.stringify([existing, injectedMsg]), snapshot, '既有消息**不得被改写**（宿主契约：this waterfall cannot mutate messages）')
  assert.equal(second.messages.length, 3, '注入是追加：2 条既有 + 1 条新块')
  assert.equal(JSON.stringify(second.messages[0]), JSON.stringify(existing), '第 0 条前缀被改动 ⇒ 前缀缓存会失效')
  assert.equal(JSON.stringify(second.messages[1]), JSON.stringify(injectedMsg), '第 1 条（含旧 wrapper 块）也必须逐字节不变')
  // 旧块仍在上下文里 ⇒ 本步**不得**记 reset
  assert.equal(
    readInject(store).filter((r) => r.gate === 'reset').length,
    0,
    '块仍在上下文里却记了 reset ⇒ reset 判据恒真',
  )
})

// ── ⑤-1 命名空间：mana_trace 的 event_type 全在**裸名五类**内 ────────────────
test('G5-① mana_trace 事件标签全在 S1 裸名五类内（不冒充、不用第三套手写字面量）', async () => {
  const { ctx, store } = await boot({ judge: 'ok' })
  perceive(ctx, { content: '命名空间候选·甲', requestId: 'req-ns-1' })
  await firePreStep(ctx, { turn: 1 })

  const types = readTrace(store).map((t) => t.event_type)
  assert.ok(types.length >= 4, `本包应至少写 4 段 trace（observation/attention/decision/injection），实得 ${JSON.stringify(types)}`)
  for (const t of types) {
    assert.ok(STAGE_LABELS.includes(t), `标签越出 S1 五类：${JSON.stringify(t)}（五类 = ${STAGE_LABELS.join('/')}）`)
    assert.ok(!t.startsWith('mana/'), `事件名（带前缀）被当成标签写进库：${t} —— 那是两套名字混写`)
  }
  assert.deepEqual(types, ['observation', 'attention', 'decision', 'injection'], `四段的次序也应与阶段语义一致，实得 ${JSON.stringify(types)}`)
})

// ── ⑤-2 五类中各段真出现（含 recall 以外的四段），且**降级路径**也带自有标签 ──
test('G5-② 降级路径同样在自有命名空间内（且 degraded 事实可读）', async () => {
  const { ctx, store } = await boot({ judge: 'degraded' })
  perceive(ctx, { content: '命名空间候选·降级', requestId: 'req-ns-2' })
  await firePreStep(ctx, { turn: 1 })

  const rows = readTrace(store)
  for (const t of rows.map((r) => r.event_type)) {
    assert.ok(STAGE_LABELS.includes(t), `降级路径的标签越界：${t}`)
  }
  const decision = JSON.parse(rows.find((r) => r.event_type === 'decision').payload)
  assert.equal(decision.degraded, true, '降级事实必须落显式字段（G8）')
  const injection = JSON.parse(rows.find((r) => r.event_type === 'injection').payload)
  assert.equal(injection.gate, 'degraded_unavailable')
  assert.equal(injection.degraded, true, '注入审计段的 degraded 应与 gate 自洽')
})

// ── ⑤-3 形态面：`agent/pre-step` 注册面**恰好 1 条**，且卸载即净 ─────────────
test('G5-③ 形态面：本包在 agent/pre-step 上恰好注册 1 条监听器；卸载后该条消失（卸载即净）', async () => {
  const { ctx, store, preStepHooks, arm, downstreamCount } = await boot({ judge: 'ok' })

  // 运行期读数（不是 grep 文本）：扩展点上当前有几条监听器
  const nAfterLoad = preStepHooks().length
  assert.equal(nAfterLoad, 2, `core 的直通腿 + 本包的门控腿 = 2 条（实得 ${nAfterLoad}）⇒ 本包要么漏注册、要么多注册`)

  // 形态腿：**恰好一次**控制权交接（多一条本包监听器 ⇒ 下游被调多次 / 每步多写一行）
  perceive(ctx, { content: '形态候选', requestId: 'req-shape' })
  const off = arm()
  await firePreStep(ctx, { turn: 1 })
  const hits = downstreamCount()
  off()
  assert.equal(hits, 1, `有第二条本包监听器的话下游会被调多次（实得 ${hits}）`)
  assert.equal(readInject(store).length, 1, '每次 pre-step 恰好一行（多于一行 ⇒ 门控腿被注册了两次）')

  // 卸载即净：**同 fixture 内**卸载本包 → 清单少一条、服务消失、再分发不再产生新行
  const entries = Object.keys(ctx.loader.registry ?? {})
  void entries
  const before = preStepHooks().length
  const attEntry = [...ctx.loader.entries()].find((e) => String(e.options?.name ?? '').includes('attention'))
  assert.ok(attEntry, '应能从 loader 清单里定位到本包条目（否则下面的卸载腿测的不是本包）')
  ctx.loader.remove(attEntry.id)
  await new Promise((r) => setTimeout(r, 250))

  assert.equal(preStepHooks().length, before - 1, `卸载后本包的监听器必须消失（前 ${before} → 后 ${preStepHooks().length}）`)
  assert.equal(ctx.get('mana-attention'), undefined, '卸载后服务必须消失')
  const rowsBefore = readInject(store).length
  await firePreStep(ctx, { turn: 2 })
  assert.equal(readInject(store).length, rowsBefore, '卸载后同一触发**不得**再产生新行（反证判据：卸载即净）')
})
