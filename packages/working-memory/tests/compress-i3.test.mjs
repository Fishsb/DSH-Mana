/**
 * dsh-mana-working-memory 包内判据 —— **I3「压缩后不永久沉默」（v10 §14.6）**。
 *
 * ## 本文件判的是哪件事（与 compression.test.mjs 的分工）
 *   · compression.test.mjs 判「压得对不对」（真压 / 精确记账 / 降级 / 边界 / 恒等式）；
 *   · **本文件判「压了之后的命运」** —— 被折叠的那些，**还能不能被找回**。
 *   修前这两件事在读数上**同形**：`CompressionRecord` 只记「压了多少」
 *   （foldedChunks/savedChars），而 result 里连被折条的 requestId 都不出现。
 *
 * ## 三态不得同形（本仓硬要求，也是本文件的立足点）
 *   `never-folded`  ⟂  `folded-locatable`  ⟂  `folded-evicted`
 *   （压根没压过 / 压过且定位面可取回 / 压过但账目已逐出）
 *
 * ## 对齐 attention 的 I2 三件套（那个水准是本包该有的样子）
 *   | I2 的落点 | 本文件的对位 |
 *   |---|---|
 *   | 判据（哪些不能重放） | I3-1..I3-3：逐条留痕 / 三态判别 / N=0 显式记 0 |
 *   | 假绿防护（跨会话串档） | I3-4：**不同实例/不同身份不得互相替答**（串档防护腿） |
 *   | 逐出留痕（不再静默丢） | I3-5：上界逐出**必留墓碑**，且墓碑环自身有界 |
 *   | 反向腿（不能把闸做空） | I3-6：容量**真的**降了、语义仍是「保最新弃最旧」 |
 *
 * ## 运行（**禁止管道取退出码** —— `node x | tail` 的 $? 是 tail 的）
 *   node --test packages/working-memory/tests/compress-i3.test.mjs ; echo $?
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')

const { Context } = await import(DSH + '/cordis/lib/index.js')
const coreMod = await import(new URL('../../core/src/index.ts', import.meta.url).href)
const wmMod = await import(new URL('../src/index.ts', import.meta.url).href)
const cmp = await import(new URL('../src/compression.ts', import.meta.url).href)

const cleanups = []
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
process.on('exit', () => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }) })

/** 直装配：真 Context + src 模块（与既有判据同口径）。 */
async function bootDirect({ capacityChunks, budgetChars = 4000 }) {
  const dir = mkdtempSync(join(tmpdir(), 'mana-wm-i3-'))
  cleanups.push(dir)
  const ctx = new Context()
  ctx.plugin(coreMod, { storePath: join(dir, 'mana.db') })
  await settle()
  assert.ok(ctx.get('mana-core'), '前置：mana-core 必须可读')
  ctx.plugin(wmMod, { capacityChunks, budgetChars })
  await settle()
  assert.ok(ctx.get('mana-working-memory'), '未装配 mana-working-memory')
  return { ctx }
}

const att = (i, content = '内容' + i) => ({
  sessionId: 'sess-i3', turnId: 1, requestId: 'req-' + i,
  at: '2026-01-01T00:00:' + String(i).padStart(2, '0') + 'Z',
  content, jevProbability: null, degraded: false,
})
/** '中' = 1 码点 / 3 字节 ⇒ 顺带区分「按码点」与「按字节」。 */
const rep = (n, ch = '中') => ch.repeat(n)
const mk = (n, len = 10) =>
  Array.from({ length: n }, (_, k) => ({ requestId: 'req-' + (k + 1), content: rep(len), seq: k + 1, at: 'T' + (k + 1) }))

// ══ I3-1 逐条留痕（折叠**不**等于沉默）═══════════════════════════════════════════

test('I3-1 折叠逐条留痕：被折条在 result 里**逐条可定位**（修前连 requestId 都不出现）', () => {
  const chunks = mk(7, 10)
  const r = cmp.compressChunks(chunks, 3)

  // ① 前置：这是真折叠（否则本腿判的就不是 I3）
  assert.equal(r.compressed, true, '前置：7 条 / 容量 3 ⇒ 必须真折叠')
  assert.equal(r.foldedChunks, 5, '前置：应折掉最旧 5 条')

  // ② **修前的缺口本身**：被折条必须在 result 里可定位。
  //   修前实测：JSON.stringify(result) 里连 'req-1' 都不出现（只有一行区间串）
  //   ⇒ 「压了 5 条」回答不了「压的是谁」。
  const serialized = JSON.stringify(r)
  for (const c of chunks.slice(0, 5)) {
    assert.ok(
      serialized.includes(c.requestId),
      '被折条 ' + c.requestId + ' 必须在 result 里可定位（修前这里必红：连 requestId 都不出现）',
    )
  }
  // ③ 逐条点名（不是只报条数）：5 条身份**逐条**对上，且与输入同序
  assert.deepEqual(
    r.folded.map((f) => f.requestId),
    ['req-1', 'req-2', 'req-3', 'req-4', 'req-5'],
    '被折条必须**逐条点名**（只给条数 = 仍回答不了"压的是谁"）',
  )
  assert.deepEqual(r.folded.map((f) => f.seq), [1, 2, 3, 4, 5], '逐条的 seq 必须在（回原始留存面取原文的键）')
  assert.deepEqual(r.folded.map((f) => f.at), ['T1', 'T2', 'T3', 'T4', 'T5'], '进入时刻原样透传（不重写）')

  // ④ 记账自洽：foldedChars 与逐条之和**同源**，且与 foldedChunks 条数一致
  assert.equal(r.foldedChars, r.folded.reduce((n, f) => n + f.chars, 0), 'foldedChars 必须与逐条之和同源（不各算一遍）')
  assert.equal(r.foldedChars, 50, '5 条 × 10 码点 = 50')
  assert.equal(r.folded.length, r.foldedChunks, '逐条留痕的条数必须等于 foldedChunks（两处必须对得上）')

  // ⑤ ⚠ 逐条留的是**定位面**，不是原文 —— 本模块从不持有原文
  //    （若这里塞了原文，「压缩」就原地复活成原文搬运，savedChars 也成了假账）
  assert.equal(
    JSON.stringify(r.folded).includes(rep(10)),
    false,
    '定位面**不得**内嵌内容原文（摘要从不带原文，账目同样不带）',
  )
})

// ══ I3-2 三态判别（三者不得同形）════════════════════════════════════════════════

test('I3-2 三态**不得同形**：没压过 / 压过且可取回 / 压过且已丢（逐条点名，非命中一条算全批）', () => {
  const r = cmp.compressChunks(mk(5, 10), 2)
  assert.equal(r.compressed, true, '前置：真折叠')

  // ① **没压过**（空账）：本账本对这批身份一无所知
  const fresh = cmp.makeFoldLedger()
  assert.equal(cmp.foldProbe(fresh, r.folded), 'never-folded', '空账 ⇒ never-folded（**不是**"丢了"）')
  assert.equal(cmp.foldLedgerView(fresh, 64).basis, 'never-folded', '空账读数同样是 never-folded')
  assert.equal(cmp.foldLedgerView(fresh, 64).locatable, 0, '空账 ⇒ 可取回条目数显式记 0')

  // ② **压过且定位面可取回**
  const kept = cmp.makeFoldLedger()
  cmp.ledgerFold(kept, r.folded, 64, '2026-01-01T00:00:00.000Z')
  assert.equal(cmp.foldProbe(kept, r.folded), 'folded-locatable', '入账 ⇒ 可取回')
  const kv = cmp.foldLedgerView(kept, 64)
  assert.equal(kv.basis, 'folded-locatable')
  assert.equal(kv.locatable, r.folded.length, '可取回条目数 = 被折条数')
  assert.equal(kv.evicted, 0, '零逐出（0 与"丢过"可分辨）')
  assert.equal(kv.evictedLocatableMisses, 0, '零墓碑')
  assert.equal(kv.calls, 1, '调用次数记账（0 与"从没折过"可分辨）')

  // ③ **压过但账目已被逐出**（上界 2：5 条里折了 4 条 ⇒ 逐 2 留 2）
  //    ⚠ 折叠条数是 `over + 1 = (5-2) + 1 = 4`（N 条塌成 **1 条**摘要，净减量 = foldCount - 1）
  //      —— 不是"溢出几条就折几条"。本条前置据此钉死，算式写在这里供逐字复核。
  assert.equal(r.folded.length, 4, '前置：5 条 / 容量 2 ⇒ 折 4 条（over+1）')
  assert.equal(r.chunks.length, 2, '前置：折后 2 条（摘要 + 保留的原文）')
  const evicted = cmp.makeFoldLedger()
  cmp.ledgerFold(evicted, r.folded, 2, 'T')
  const ev = cmp.foldLedgerView(evicted, 2)
  assert.equal(ev.locatable, 2, '前置：上界 2 ⇒ 账上只剩 2 条（保留的是**最近折的**那两条）')
  assert.equal(ev.evicted, 2, '前置：逐出 2 条')
  assert.equal(ev.evictedLocatableMisses, 2, '前置：2 条落墓碑（逐出留痕）')
  assert.equal(
    cmp.foldProbe(evicted, [{ requestId: 'req-1' }]),
    'folded-evicted',
    '被逐出的那批 ⇒ 如实报"已丢"（**不是** never-folded —— 那正是三态要分开的东西）',
  )
  assert.equal(cmp.foldProbe(evicted, [{ requestId: 'req-4' }]), 'folded-locatable', '未被逐出的仍在账上（旧 vs 新按最旧逐出）')
  // ⚠ 第三种"没压过"**就在同一个账本里**：req-5 从没被折过（它一直活到末态）⇒ never-folded。
  //   这条是"账本非空"与"该身份真被折过"的分辨点（账本非空**不等于**人人都在账上）。
  assert.equal(
    cmp.foldProbe(evicted, [{ requestId: 'req-5' }]),
    'never-folded',
    '账本非空 ≠ 每个身份都在账上：没被折过的身份仍须报 never-folded',
  )

  // ④ **三态两两不同形**（本仓硬要求，逐条断言而不是只比一个集合大小）
  const a = cmp.foldProbe(fresh, r.folded)
  const b = cmp.foldProbe(kept, r.folded)
  const c = cmp.foldProbe(evicted, [{ requestId: 'req-1' }])
  assert.notEqual(a, b, '「没压过」与「可取回」不得同形')
  assert.notEqual(b, c, '「可取回」与「已丢」不得同形')
  assert.notEqual(a, c, '「没压过」与「已丢」不得同形 —— 这正是 I3 要消灭的第一个形态')
  assert.equal(new Set([a, b, c]).size, 3, '三态必须**互不相同**')

  // ⑤ ⚠ **逐条点名**：批里只要有一条查不到，就**不得**报可取回
  //    （实现成"命中一条即算全批"的话，判据面会永远绿、也永远骗人）
  const mixedUnknown = [
    { requestId: 'req-4' },      // 仍在账上（上界 2 ⇒ 留的是最近折的那两条）
    { requestId: 'req-5' },      // 本账本一无所知（它从没被折过）
  ]
  assert.equal(
    cmp.foldProbe(evicted, mixedUnknown),
    'never-folded',
    '批里含有未在账条目 ⇒ 不得报 folded-locatable（不是"命中一条算全批"）',
  )
  // 逐条对照：把那条"没折过"换成"已丢"的那种混合 ⇒ 报已丢
  assert.equal(
    cmp.foldProbe(evicted, [{ requestId: 'req-4' }, { requestId: 'req-1' }]),
    'folded-evicted',
    '批里含已逐出条目 ⇒ 报已丢（与"含未在账条目"**可分辨**）',
  )
  // ⚠ 对拍（防"必然报已丢"的假分辨）：同批里既没有已丢、也没有未在账 ⇒ 必须报可取回
  assert.equal(
    cmp.foldProbe(evicted, [{ requestId: 'req-3' }, { requestId: 'req-4' }]),
    'folded-locatable',
    '对拍：同批全在账 ⇒ 必须报可取回（否则上面两条可能只是"凡查皆已丢"的假分辨）',
  )
})

// ══ I3-3 N=0 显式记 0（输入量须可见化）══════════════════════════════════════════

test('I3-3 N=0 显式记 0：没折叠时**逐条数组为 []**、字符数为 0（不是 undefined/省略）', () => {
  // 无闸 / 恰满 / 超长反而不压 —— 三个"没折"的出口都取同一份 noop 回执
  const cases = [
    ['容量轴不设闸', cmp.compressChunks(mk(12, 10), 0)],
    ['恰满容量', cmp.compressChunks(mk(5, 10), 5)],
    ['压不动（摘要比原文长）', cmp.compressChunks(mk(3, 1), 2)],
  ]
  for (const [label, r] of cases) {
    assert.equal(r.compressed, false, label + '：前置，本条不压')
    assert.equal(Array.isArray(r.folded), true, label + '：folded 必须是数组（undefined 会被 JSON 静默丢键）')
    assert.equal(r.folded.length, 0, label + '：没折 ⇒ 逐条留痕显式记 0 条')
    assert.equal(r.foldedChars, 0, label + '：没折 ⇒ 字符数显式记 0')
    // 三态里"没压过"的那一态：账本空 ⇒ never-folded（与"压了 0 条"语义一致）
    assert.equal(cmp.foldProbe(cmp.makeFoldLedger(), r.folded), 'never-folded', label + '：0 条 ⇒ never-folded')
  }
  // ⚠ 反向对照：同输入换个容量就**必折**（证明上面"没折"是配置使然，不是判据面失效）
  const yes = cmp.compressChunks(mk(12, 10), 4)
  assert.equal(yes.compressed, true, '反向对照：容量 4 时同 12 条必折')
  assert.ok(yes.folded.length > 0 && yes.foldedChars > 0, '反向对照：逐条留痕与字符数都必须为正值')

  // ⚠ **N=0 与"压过 0 条"在账本上也要可分辨**：空 refs 调 ledgerFold ⇒ calls 仍 +1
  const st = cmp.makeFoldLedger()
  cmp.ledgerFold(st, [], 64, 'T')
  const v = cmp.foldLedgerView(st, 64)
  assert.equal(v.calls, 1, '跑过（哪怕 0 条）必须记账 ⇒ 与"从没跑过"（calls=0）可分辨')
  assert.equal(v.locatable, 0, '0 条入账 ⇒ 可取回数仍是 0（不得凭空多出条目）')
  assert.equal(v.basis, 'never-folded', '0 条入账 ⇒ 仍是 never-folded')
})

// ══ I3-4 假绿防护（跨实例串档 —— 对齐 I2 那条"跨会话串档"）════════════════════════

test('I3-4 假绿防护：账本按**实例**隔离，A 的折叠不得替 B 作答（串档腿）', async () => {
  // ① 纯函数面：两个账本状态互不可见
  const s1 = cmp.makeFoldLedger()
  const s2 = cmp.makeFoldLedger()
  const r = cmp.compressChunks(mk(5, 10), 2)
  cmp.ledgerFold(s1, r.folded, 64, 'T')
  assert.equal(cmp.foldProbe(s1, r.folded), 'folded-locatable', '前置：s1 认得这批')
  assert.equal(cmp.foldProbe(s2, r.folded), 'never-folded', 's2 **不得**替 s1 作答（跨账本串档 = 假绿）')
  assert.equal(cmp.foldLedgerView(s2, 64).locatable, 0, 's2 的读数必须仍是空的')

  // ② 服务面：两个插件实例各持各的账本（宿主跑多会话/多实例是常态）
  const a = await bootDirect({ capacityChunks: 0, budgetChars: 0 })
  const b = await bootDirect({ capacityChunks: 0, budgetChars: 0 })
  const wa = a.ctx.get('mana-working-memory')
  const wb = b.ctx.get('mana-working-memory')
  for (let i = 1; i <= 7; i += 1) wa.push(att(i, rep(10)))
  const ra = wa.compress({ capacityChunks: 3, now: 'T' })
  assert.equal(ra.compressed, true, '前置：A 实例真折了')
  assert.equal(wa.foldProbe(ra.folded), 'folded-locatable', 'A 实例：自己的折条自己认得')
  assert.equal(wb.foldProbe(ra.folded), 'never-folded', 'B 实例**不得**替 A 作答（跨实例串档）')
  assert.equal(wb.foldLedgerView().locatable, 0, 'B 实例的账本必须仍是空的')
  assert.equal(wb.foldLedgerView().calls, 0, 'B 实例**从没折过** ⇒ calls 为 0（不得被 A 的调用带涨）')
  assert.equal(wa.foldLedgerView().calls, 1, 'A 实例：折过一次 ⇒ calls 为 1')
})

// ══ I3-5 逐出留痕（上界是工程选择，账目只能"留痕地让路"）════════════════════════

test('I3-5 逐出留痕：超上界**必留墓碑**，且墓碑环自身有界（二次逐出不得无界增长）', () => {
  const st = cmp.makeFoldLedger()
  // 上界 2 ⇒ 折 10 条，逐出 8 条；墓碑环上界 32 ⇒ 本例全进墓碑（无二次逐出）
  const refs = Array.from({ length: 10 }, (_, k) => ({ requestId: 'r' + (k + 1), seq: k + 1, at: 'T', chars: 3 }))
  cmp.ledgerFold(st, refs, 2, 'T')
  const v = cmp.foldLedgerView(st, 2)
  assert.equal(v.locatable, 2, '上界 2 ⇒ 账上恰 2 条')
  assert.equal(v.evicted, 8, '逐出 8 条（累计，含二次逐出）')
  assert.equal(v.evictedLocatableMisses, 8, '8 条全部落墓碑（逐出留痕）')
  assert.deepEqual(
    v.evictedRefs.map((m) => m.requestId),
    ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'],
    '墓碑按**最旧逐出**顺序逐条在案（丢的是谁，逐条可查）',
  )
  assert.ok(v.evictedRefs.every((m) => typeof m.seq === 'number' && typeof m.chars === 'number'), '墓碑必须带 seq/chars 身份读数')
  assert.equal(JSON.stringify(v.evictedRefs).includes('content'), false, '墓碑**不得**含内容原文（审计不泄内容）')

  // ⚠ 墓碑环自身有界：上界 1 + 80 条 ⇒ 逐出 79 条，但墓碑环最多 32 ⇒ 计数不丢
  const st2 = cmp.makeFoldLedger()
  cmp.ledgerFold(st2, Array.from({ length: 80 }, (_, k) => ({ requestId: 'x' + (k + 1), seq: k + 1, at: 'T', chars: 1 })), 1, 'T')
  const v2 = cmp.foldLedgerView(st2, 1)
  assert.equal(v2.evicted, 79, '累计逐出数必须如实（二次逐出也要算）')
  assert.equal(v2.evictedRefs.length, 32, '墓碑环上界 32（不得随折叠次数无界增长）')
  assert.equal(v2.evictedLocatableMisses, 32, '墓碑数 = 环内现有条数（与"累计逐出"**分账**）')
  assert.deepEqual(v2.evictedRefs[31], { seq: 79, requestId: 'x79', chars: 1 }, '环里留的是**最近的**那批（FIFO，最旧滚出）')

  // ⚠ 「已丢」在**二次**逐出后回落 never-folded —— 如实报，不假装还认得（残留盲区写在这里）
  assert.equal(
    cmp.foldProbe(st2, [{ requestId: 'x1' }]),
    'never-folded',
    '连墓碑都滚出的 ⇒ 回落 never-folded（二次逐出的如实代价，**不**假装仍可判已丢）',
  )
  assert.equal(cmp.foldProbe(st2, [{ requestId: 'x79' }]), 'folded-evicted', '仍在墓碑里的 ⇒ 如实报已丢')

  // ⚠ 重新入账必须把墓碑撤销（否则同一身份**同时**说"可回查"与"已丢"——自相矛盾）
  const st3 = cmp.makeFoldLedger()
  cmp.ledgerFold(st3, [{ requestId: 'z1', seq: 1, at: 'T', chars: 1 }], 0, 'T') // 上界 0 = 不设闸
  assert.equal(cmp.foldProbe(st3, [{ requestId: 'z1' }]), 'folded-locatable', '无上界 ⇒ 入账即可取回')
  cmp.ledgerFold(st3, [{ requestId: 'z1', seq: 1, at: 'T', chars: 1 }], 0, 'T')
  assert.equal(cmp.foldLedgerView(st3, 0).locatable, 1, '同身份重折 ⇒ 账上仍只 1 条（Map 覆盖，不重复膨胀）')
  assert.equal(cmp.foldProbe(st3, [{ requestId: 'z1' }]), 'folded-locatable', '重折后仍可取回')
})

// ══ I3-6 反向腿：不得为了"不沉默"而把压缩做成空操作 ═════════════════════════════

test('I3-6 反向腿：容量闸仍生效 —— 折叠**真降条数**、语义仍是「保最新、弃最旧」', async () => {
  // ① 纯函数面：折后有上界内、条数**真降**（留痕不得把被折条塞回 chunks）
  const chunks = mk(9, 10)
  const r = cmp.compressChunks(chunks, 3)
  assert.equal(r.compressed, true, '前置：真折')
  assert.equal(r.chunks.length, 3, '反向腿：折后条数必须**回到容量上界内**（留痕不得把被折条放回来）')
  assert.ok(r.afterChunks < r.beforeChunks, '反向腿：条数必须**真降**（否则 I3 把压缩做成了空操作）')
  assert.equal(
    r.chunks.length,
    r.beforeChunks - r.foldedChunks + 1,
    '反向腿：N 条塌成 1 条摘要 —— 这条算式是"压缩没被留痕冲掉"的判据',
  )
  // ② 被折条**不得**同时留在 chunks 里（同一条既算折了又算留了 = 虚报）
  const live = new Set(r.chunks.map((c) => c.requestId))
  for (const f of r.folded) {
    assert.equal(live.has(f.requestId), false, '被折条 ' + f.requestId + ' 不得同时留在 chunks 里（留痕 ≠ 放回来）')
  }
  // ③ 语义不变：保最新、弃最旧（既不进 chunks 也不进 folded 的只能是"末尾保留的原文"）
  assert.deepEqual(r.chunks[r.chunks.length - 1].requestId, 'req-9', '最新一条必须原样保留')
  assert.deepEqual(
    r.folded.map((f) => f.seq),
    [1, 2, 3, 4, 5, 6, 7],
    '折的必须是**最旧**的（保最新弃最旧 —— 与两闸同构）',
  )
  // ④ 容量上界仍封顶：记账不得成为"第二条不设上界的存法"
  //    ⚠ cap 只取"折得动"的那几档（keepRecent 缺省 1 ⇒ cap >= 2）。cap=1 是**另一条**
  //      既有语义（C17「压了但没够」：折不动就如实不落地），单独在下面判，不混进本循环。
  for (const cap of [2, 5, 8, 19]) {
    const rr = cmp.compressChunks(mk(20, 10), cap)
    assert.equal(rr.compressed, true, 'cap=' + cap + '：真折得动 ⇒ 必须落地')
    assert.ok(rr.chunks.length <= cap, 'cap=' + cap + '：折后条数不得越过容量上界')
    assert.equal(rr.chunks.length, 20 - rr.foldedChunks + 1, 'cap=' + cap + '：末态 = 折前 - 折掉 + 1 条摘要（算式不得被留痕冲掉）')
    assert.equal(rr.capacityReached, true, 'cap=' + cap + '：折后必须回到上界内')
    assert.equal(rr.overflowRemaining, 0, 'cap=' + cap + '：零溢出')
    // ⚠ 反向腿的**核心**：折叠没被留痕冲成空操作 —— 末态条数必须**严格下降**
    assert.ok(rr.chunks.length < rr.beforeChunks, 'cap=' + cap + '：条数必须真降（否则 I3 把压缩做成了空操作）')
  }
  // ④′ cap=1（折不动）⇒ **如实不落地**：不得为了"看起来压过"而记一笔假折叠
  const stuck = cmp.compressChunks(mk(20, 10), 1)
  assert.equal(stuck.compressed, false, 'cap=1：keepRecent 夹住 ⇒ 不得报 compressed（假绿，与 C17 同口径）')
  assert.equal(stuck.folded.length, 0, 'cap=1：未落地 ⇒ 逐条留痕必须是 0 条（不得记一笔没发生的折叠）')
  assert.equal(stuck.capacityReached, false, 'cap=1：如实报"未达上界"，由既有容量闸继续兜底')
  assert.equal(stuck.overflowRemaining, 19, 'cap=1：仍高出上界 19 条 —— 这个数就是"压不动"的读数')

  // ⑤ 服务面 + 真链：折叠接线后**两闸语义逐条不变**（压缩不得顶破结构界）
  const { ctx } = await bootDirect({ capacityChunks: 0, budgetChars: 0 }) // 两闸关，喂得进 9 条
  const wm = ctx.get('mana-working-memory')
  for (let i = 1; i <= 9; i += 1) wm.push(att(i, rep(10)))
  assert.equal(wm.snapshot().chunks.length, 9, '前置：两闸关 ⇒ 9 条都在')
  const res = wm.compress({ capacityChunks: 3, now: 'T' })
  assert.equal(res.compressed, true)
  assert.equal(wm.snapshot().chunks.length, 3, '服务面落地后：内部条数真降到上界内（不是只在返回值里好看）')
  assert.equal(wm.snapshot().chars, res.afterChars, '内部 chars 必须与记账 afterChars 一致（读数与事实同源）')
  // ⑥ 容量闸上界仍由**闸**（不是账本）兜底：压完再 push，逐出照旧发生
  const before = wm.snapshot().evicted
  assert.equal(wm.push(att(10, rep(10))), false, '容量 0 ⇒ 该轴不设闸 ⇒ push 不逐出（本实例两闸是关的）')
  assert.equal(wm.snapshot().evicted, before, '两闸关的实例里，逐出账不得被压缩面带动')
  assert.equal(wm.snapshot().chunks.length, 4, '折后 push 仍照常入集（折叠不改变 push 语义）')

  // ⑦ 折条**不得**把容量账顶破：带真容量闸的实例，压缩后仍满足 size <= cap
  const c2 = await bootDirect({ capacityChunks: 4, budgetChars: 4000 })
  const w2 = c2.ctx.get('mana-working-memory')
  for (let i = 1; i <= 12; i += 1) w2.push(att(100 + i, rep(10)))
  assert.equal(w2.snapshot().chunks.length, 4, '前置：容量闸把 size 夹在 4')
  assert.equal(w2.compress({ capacityChunks: 4, now: 'T' }).compressed, false, '恰满容量 ⇒ 压缩不动作（严格大于）')
  assert.equal(w2.snapshot().chunks.length, 4, '不动作 ⇒ 条数一格未动')
  assert.equal(w2.foldLedgerView().calls, 0, '不落地 ⇒ 账本**不被推进**（不得凭空多出一次折叠）')
  assert.equal(w2.foldLedgerView().locatable, 0, '不落地 ⇒ 账上零条目（与"折过"可分辨）')
})
