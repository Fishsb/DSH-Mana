/**
 * A1-5 时间衰减三锚点 —— **由真核求值的判据**（`docs/mana-rollout-plan.md:456`）。
 *
 * ── 本文件解决什么（不是又抄一遍闭式）──────────────────────────────────────────
 *   A1-5 长期停在挂账态，理由是「须改接真实现后再判」（`tools/a1-check.mjs:871`）。
 *   但**接通**这一步此前没人做过，且判据器那一侧**结构上做不到**：
 *     · `tools/a1-check.mjs` 的 A1-5 块**全程没有 import `packages/long-term`** ——
 *       它算的是块内自己内联的闭式 `exp(-t·ln2/14)`；
 *     · 三条分支里也没有一条能把「真实现算对了」判成 PASS（只有 NONE / HANG / FAIL）。
 *   ⇒ 后果是双重的：真实现算错它照样绿；真实现算对了它也永远绿不了。
 *   本文件把锚点交给**真核**（`long-term/src/decay.ts` 的 `decay`）求值，
 *   于是「实现算对了」与「闭式抄对了」在读数上**可分辨**。
 *
 * ── 三条不许混（派单原文）───────────────────────────────────────────────────────
 *   ① `decay`（半衰期指数）与 Pavlik `ΔS = a·(S_max−S)^b` 是**两套公式**：本文件只碰前者，
 *      后者由 `strength.ts` 承担，「同一条记忆被两家乘过」由 C14 禁（见 `retention.ts` 文件头）。
 *   ② `D=0.5`（基础激活的幂律指数，单位秒）与 `HALF_LIFE_DAYS=14`（天）**不是同一个量**，不得相乘。
 *   ③ 本判据的每一个数都**逐字取判据表**，不从实现反算（反算 ⇒ 改常量时期望值跟着走 ⇒ 恒绿）。
 *
 * ⚠ **负向对拍必须真跑**（本仓纪律）：扰动打在**真源的文本副本**上（临时目录），真源全程只读，
 *   对拍前后比对 sha256。**恢复禁用 `git reset --hard`**（树上有他席在途件）。
 *
 * ── 带牙腿（N5，2026-09-26 补；独立审查 c3 席实测的反例）────────────────────────────
 *   三条锚点全取在 `t ≥ 0` 且**同一个** `h` ⇒ 两种坏核能把它们**全过**：
 *     · **忽略 h 的死旋钮核** `decay:(t,_h)=>exp(-t·ln2/14)`（与 budgetChars 同一形态）；
 *     · **无 t<0 guard 的核**。
 *   ⇒ 本文件新增 ⑦⑧ 两例专门钉这两条，且**自己不另写一份齿**：调用源码里的
 *     `decayKernelTeeth()`（唯一真源），使判据腿与实现面共用同一套齿（避免下一个漂移点）。
 *
 * 运行（显式路径）：node --test packages/forgetting/tests/a15-anchor.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 本文件内的双引号生成器：源码里以 ' + Q + ' 拼出，避免本文件自身被引号转义规则咬到。
 */
const Q = String.fromCharCode(34)
const SRC = new URL('../src/', import.meta.url)
const ROOT = new URL('../../', import.meta.url) // packages/
const load = (f) => import(new URL(f, SRC).href)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const f6 = (x) => Number(x).toFixed(6)
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

const LT_DECAY = new URL('long-term/src/decay.ts', ROOT)
const LT_PARAMS = new URL('long-term/src/params.ts', ROOT)
const retentionMod = await load('retention.ts')
const { decay } = await import(LT_DECAY.href)
const { HALF_LIFE_DAYS } = await import(LT_PARAMS.href)

const EXPECTED_CASES = 9
let ran = 0

/** 判据表逐字（`docs/mana-rollout-plan.md:456`）—— **本文件内的独立副本**，不从实现派生。 */
const ANCHOR_LITERAL = [
  ['decay(0)', 0, 1.0],
  ['decay(14)', 14, 0.5],
  ['decay(90)', 90, 0.011609],
]

const cleanups = []
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'mana-a15-'))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/**
 * 夹具：把**真源文本**做一次替换后写进临时目录并 import。
 * ⚠ 真源全程只读（只 readFileSync 真源，写的是临时副本）。
 * ⚠ 相对 import 改写成绝对 file: URL —— 副本不在原目录，相对路径会失配。
 */
function kernelFromMutatedSource(find, replace) {
  const original = readFileSync(LT_DECAY, 'utf8')
  const hits = original.split(find).length - 1
  assert.equal(hits, 1, '扰动锚点必须**恰好命中 1 次**，实测 ' + hits + '：命中 0 次即变异器已过期（静默通过 = 假绿）')
  const dir = tmp()
  const copy = join(dir, 'decay-mutated.ts')
  const srcDir = dirname(fileURLToPath(LT_DECAY))
  const mutated = original.replace(find, replace).replace(
    /from '\.\/([\w.-]+\.ts)'/g,
    (_all, f) => 'from ' + Q + pathToFileURL(join(srcDir, f)).href + Q,
  )
  writeFileSync(copy, mutated)
  return { url: pathToFileURL(copy).href, sha: sha256(original) }
}

// ══ ① 三锚点经**真核**逐字复现（本项的主腿）════════════════════════════════════
test('① A1-5 三锚点经真核（long-term/src/decay.ts）逐字复现，绝对差 ≤1e-6', () => {
  ran += 1
  assert.equal(typeof decay, 'function', 'long-term 的真核必须可 import（无实现者时本项无判可下）')
  assert.equal(HALF_LIFE_DAYS, 14, '半衰期缺省值须为 14 天（A1-5 冻结锚点，逐字）')

  const readings = retentionMod.decayAnchorReadings({ decay })
  assert.equal(readings.length, 3, '必须恰好三个锚点（缺项即判据面被削）')
  for (let i = 0; i < ANCHOR_LITERAL.length; i += 1) {
    const [label, t, expected] = ANCHOR_LITERAL[i]
    const r = readings[i]
    assert.equal(r.label, label, '锚点写法必须逐字与判据表一致')
    assert.equal(r.t, t, label + ' 的输入必须是判据表那个数')
    assert.equal(r.expected, expected, label + ' 的期望值必须**逐字照抄判据表**（不得由实现反算）')
    assert.ok(r.ok, label + ' = ' + r.got + '（' + f6(r.got) + '），应 ' + expected + '，绝对差 ' + r.delta + ' 须 ≤ 1e-6')
    assert.ok(near(r.got, expected), label + ' 实测 ' + r.got)
  }
  assert.equal(decay(14), decay(14, HALF_LIFE_DAYS), '缺省与显式 HALF_LIFE_DAYS 必须同值（缺省值真来自 params）')
  assert.equal(decay(90), decay(90), '同输入两次必须逐位相同（否则判据会一会儿过一会儿不过）')
  assert.deepEqual(
    retentionMod.decayAnchorReadings({ decay }).map((x) => x.got),
    readings.map((x) => x.got),
    '两次读数序列化后必须相同（无时钟/无 RNG/无副作用）',
  )
})

// ══ ② 负向对拍（**真跑**）：改半衰期 ⇒ 同一份读数腿必红，真源逐字节未变 ════════
test('② 负向对拍：真核半衰期 14 → 7 ⇒ 同一份读数腿必红（真源全程只读，逐字节恢复）', async () => {
  ran += 1
  const before = sha256(readFileSync(LT_DECAY, 'utf8'))
  // 扰动语义：**真核的缺省半衰期**由 params 常量改成裸字面量 7（判据表冻结值 14 被改）。
  const m = kernelFromMutatedSource("halfLifeDays: number = HALF_LIFE_DAYS", "halfLifeDays: number = 7")
  assert.equal(m.sha, before, '扰动所依据的原文 sha 必须等于真源当前 sha')
  const mutDir = dirname(fileURLToPath(new URL(m.url)))
  // 副本目录里没有 params.ts（真核 import 的是兄弟文件）⇒ 落一份 h=7 的，否则扰动不生效。
  writeFileSync(join(mutDir, 'params.ts'), 'export const HALF_LIFE_DAYS = 7' + String.fromCharCode(10))
  const mutatedMod = await import(m.url)
  // ① 扰动版的核真的变了（否则后面的报红来自别处，属打错靶）
  assert.equal(mutatedMod.HALF_LIFE_DAYS === undefined, true, 'HALF_LIFE_DAYS 不在 decay.ts 内（由兄弟 params.ts 提供）—— 扰动打的是缺省参数，不是那份常量')
  assert.ok(near(mutatedMod.decay(14), 0.25), '扰动版必须真的 h=7（decay(14)=0.25）；未生效 ⇒ 本对拍无效')
  // ② 同一份读数腿（与 ① 逐字相同的那几条断言）在扰动核上**必须报红**
  const bad = retentionMod.decayAnchorReadings(mutatedMod)
  assert.equal(bad.every((x) => x.ok), false, 'h=7 时不得全绿 —— 全绿说明读数腿在自证而非在判实现')
  assert.equal(bad[1].ok, false, 'decay(14) 在 h=7 下必须判红（实测 ' + bad[1].got + '）')
  assert.ok(near(bad[1].got, 0.25), 'h=7 ⇒ 14 天恰好两个半衰期 ⇒ 0.25，实测 ' + bad[1].got)
  assert.equal(bad[0].ok, true, 'decay(0)=1 在任何半衰期下都成立 ⇒ 不得误红（误红即打错靶）')
  assert.equal(bad[2].ok, false, 'decay(90) 在 h=7 下同样必须判红，实测 ' + bad[2].got)
  // ③ 真源全程只读 + 逐字节恢复（本测试**从不**写真源，故这里是直接证据）
  assert.equal(sha256(readFileSync(LT_DECAY, 'utf8')), before, '真源必须逐字节未变：before=' + before)
  assert.ok(existsSync(join(mutDir, 'decay-mutated.ts')), '扰动副本必须真落盘（否则 import 的仍是真源）')
})

// ══ ③ 判别力的**边界**：三锚点绿 ≠ 整条曲线对（如实测出来，不假装覆盖）═════════
test('③ 判据边界：只在 t<0 错的核仍能全过三锚点 —— 如实暴露，并用真核的 fail-closed 分辨', () => {
  ran += 1
  const oddKernel = { decay: (t, h) => (t < 0 ? 2 : Math.exp((-t * Math.LN2) / (h === undefined ? HALF_LIFE_DAYS : h))) }
  const r = retentionMod.decayAnchorReadings(oddKernel)
  assert.equal(r.every((x) => x.ok), true, '只在 t<0 错的核**仍会**全过三锚点 —— 这是判据面的事实，必须如实暴露')
  assert.throws(() => decay(-7), /不得为负/, '真核在 t<0 必须抛（时钟回拨不得给出 >1 的假留存率）')
  assert.equal(oddKernel.decay(-7), 2, '对照核在 t<0 给出 2（>1 的假留存率）—— 与真核可分辨')
  let worst = 0
  for (let t = 0; t <= 400; t += 0.37) {
    const w = Math.abs(decay(t) - Math.exp((-t * Math.LN2) / HALF_LIFE_DAYS))
    if (w > worst) worst = w
  }
  assert.ok(worst <= 1e-12, '真核与 h=14 的闭式在 t≥0 上必须逐点一致，最大差 ' + worst)
})

// ══ ④ fail-closed：核没接上时**不得**回落本包闭式 ════════════════════════════
test('④ 核未接上 ⇒ 读数面必须抛（不得返回空读数、不得回落本包闭式自证）', () => {
  ran += 1
  assert.throws(() => retentionMod.decayAnchorReadings(null), /必须提供 decay/, '无核 ⇒ 抛')
  assert.throws(() => retentionMod.decayAnchorReadings({}), /必须提供 decay/, '核没有 decay 方法 ⇒ 抛')
  assert.throws(() => retentionMod.decayAnchorReadings({ decay }, Number.NaN), /eps 必须是/, 'eps=NaN ⇒ 抛（NaN 当容差会让每个点都判假且不报错）')
  const loose = retentionMod.decayAnchorReadings({ decay: (t) => Math.exp((-t * Math.LN2) / 7) }, 1)
  assert.equal(loose[1].ok, true, 'eps=1 时 h=7 的 0.25 与 0.5 之差 0.25 ≤ 1 ⇒ ok（证明 eps 真的进了判定）')
})

// ══ ⑤ 装配面：装上 long-term ⇒ 服务读数 == 直连真核；未装 ⇒ 服务面抛错 ═══════
test('⑤ 装配面：装上 long-term ⇒ 服务读数与直连真核逐位一致；未装 ⇒ 抛错不回退', async () => {
  ran += 1
  const coreMod = await import(new URL('core/src/index.ts', ROOT).href)
  const ltMod = await import(new URL('long-term/src/index.ts', ROOT).href)
  const fbMod = await load('index.ts')

  const ctxA = new Context()
  ctxA.plugin(coreMod, { storePath: join(tmp(), 'a.db') })
  await settle(200)
  const fiberA = ctxA.plugin(fbMod)
  await settle(300)
  const svcA = ctxA.get('mana-forgetting')
  assert.ok(svcA, 'mana-forgetting 服务必须可读')
  assert.equal(svcA.forgetting.readings().kernelSource, 'fallback', '未装 long-term ⇒ kernelSource 必须报 fallback（可读，不静默）')
  assert.throws(() => svcA.forgetting.decayAnchors(), /未装配 mana-long-term/, '未装核 ⇒ 读数面必须抛，不得回落本包闭式自证')
  await fiberA.dispose()
  await settle(200)

  const ctxB = new Context()
  ctxB.plugin(coreMod, { storePath: join(tmp(), 'b.db') })
  await settle(200)
  ctxB.plugin(ltMod)
  await settle(300) // ⚠ 必须等 long-term 真 provide 完：本包的核是**装配期**取的，早取晚取结论不同
  ctxB.plugin(fbMod)
  await settle(400)
  const svcB = ctxB.get('mana-forgetting')
  assert.ok(svcB, 'mana-forgetting 服务必须可读')
  assert.equal(svcB.forgetting.readings().kernelSource, 'mana-long-term', '装上后 kernelSource 必须报 mana-long-term（核来源可读）')
  const viaService = svcB.forgetting.decayAnchors()
  const direct = retentionMod.decayAnchorReadings({ decay })
  assert.deepEqual(
    viaService.map((x) => [x.label, x.got, x.ok]),
    direct.map((x) => [x.label, x.got, x.ok]),
    '服务面读数必须与直连真核**逐位一致**（两条路给两套数 ⇒ 判据测的不是装配期真跑的那条）',
  )
  assert.equal(viaService.every((x) => x.ok), true, '装配路径上三锚点必须全过')
})

// ══ ⑥ 带牙腿 A：忽略 halfLifeDays 的**死旋钮核**必须被判红 ═══════════════════════
test('⑥ 带牙腿：死旋钮核（忽略 h）⇒ decayKernelTeeth 必红「consumes-half-life」；真核必过', () => {
  ran += 1
  const frozen = HALF_LIFE_DAYS
  const opts = { frozenHalfLife: frozen, probeHalfLife: frozen / 2 }

  // ① 反例①（c3 accept 席实测的那个核）：把 halfLifeDays 整个忽略。
  const deadKnob = { decay: (t, _h) => Math.exp((-t * Math.LN2) / frozen) }
  // 前置控制：这个坏核**确实**能把三条锚点全过 —— 否则本用例证明不了「锚点腿无牙」这件事。
  const anchorsOnDead = retentionMod.decayAnchorReadings(deadKnob)
  assert.equal(anchorsOnDead.every((x) => x.ok), true, '前置控制：死旋钮核必须能把三条锚点**全过**（否则本用例打错靶）')
  // ② 带牙腿必须把它判红，且**点名到腿**
  const deadReading = retentionMod.decayKernelTeeth(deadKnob, opts)
  assert.equal(deadReading.ok, false, '死旋钮核必须被判红（ok=false）')
  assert.equal(deadReading.teeth.length, 2, '两条牙都必须有读数（缺一条即判据面被削）')
  const t1 = deadReading.teeth.find((x) => x.id === 'consumes-half-life')
  assert.ok(t1 && t1.ok === false, 'consumes-half-life 必须判红，实测 ' + JSON.stringify(t1))
  assert.match(t1.detail, /同值|被忽略/, '读数必须说清是「参数被忽略」，实测 ' + t1.detail)
  assert.ok(deadReading.violations.some((v) => v.includes('consumes-half-life')), 'violations 必须点名该腿')
  // ③ 真核必须全过（不许见谁都红）
  const realReading = retentionMod.decayKernelTeeth({ decay }, opts)
  assert.equal(realReading.ok, true, '真核必须两条牙全过，实测 ' + JSON.stringify(realReading.violations))
  assert.equal(realReading.violations.length, 0, '真核的 violations 必须为空')
  // ④ 另一类「不等但错」的核也必须被自洽式抓住：把 h 当 h² 用。
  const wrongExponent = { decay: (t, h) => Math.exp((-t * Math.LN2) / ((h === undefined ? frozen : h) ** 2)) }
  const wrongReading = retentionMod.decayKernelTeeth(wrongExponent, opts)
  assert.equal(
    wrongReading.teeth.find((x) => x.id === 'consumes-half-life').ok,
    false,
    'h→h² 的核只满足「两值不等」，必须被自洽式 f(t,h₂)=f(t,h₁)^(h₁/h₂) 抓住',
  )
})

// ══ ⑦ 带牙腿 B：无 t<0 guard 的核必须被判红；真核必抛 ═══════════════════════════
test('⑦ 带牙腿：无 t<0 guard 的核 ⇒ decayKernelTeeth 必红「rejects-negative-time」；真核必抛', () => {
  ran += 1
  const frozen = HALF_LIFE_DAYS
  const opts = { frozenHalfLife: frozen, probeHalfLife: frozen / 2 }

  // ① 反例②：合法但有 guard 缺失的核（t<0 静默给出 >1 的假留存率）。
  const noGuard = { decay: (t, h) => Math.exp((-t * Math.LN2) / (h === undefined ? frozen : h)) }
  // 前置控制：它同样能把三条锚点全过。
  assert.equal(retentionMod.decayAnchorReadings(noGuard).every((x) => x.ok), true, '前置控制：无 guard 核必须能把三条锚点全过')
  const noGuardReading = retentionMod.decayKernelTeeth(noGuard, opts)
  assert.equal(noGuardReading.ok, false, '无 t<0 guard 的核必须被判红')
  const t2 = noGuardReading.teeth.find((x) => x.id === 'rejects-negative-time')
  assert.ok(t2 && t2.ok === false, 'rejects-negative-time 必须判红，实测 ' + JSON.stringify(t2))
  assert.match(t2.detail, /未抛/, '读数必须说清是「未抛」，实测 ' + t2.detail)
  assert.ok(noGuardReading.violations.some((v) => v.includes('rejects-negative-time')), 'violations 必须点名该腿')
  // ② 真核的该条牙必须 ok，且**真核真抛**（判据不只看 ok 字段，还看行为）。
  assert.equal(retentionMod.decayKernelTeeth({ decay }, opts).teeth.find((x) => x.id === 'rejects-negative-time').ok, true)
  assert.throws(() => decay(-(frozen / 2)), /不得为负/, '真核在 t<0 必须抛（判据读数的行为侧对照）')
  // ③ 假留存率必须真的 > 1（说明这条牙防的是什么，不是空话）
  assert.ok(noGuard.decay(-(frozen / 2)) > 1, '无 guard 核在 t<0 给出 >1 的假留存率，实测 ' + noGuard.decay(-(frozen / 2)))
})

// ══ ⑧ 负向对拍：带牙腿的齿本身必须有牙（扰动真源的带牙函数 ⇒ 必红）════════════════
test('⑧ 带牙腿的负向对拍：把齿改瞎（恒回 ok:true）⇒ 同一份断言必红，且真源逐字节未变', async () => {
  ran += 1
  const SRC_RET = new URL('../src/retention.ts', import.meta.url)
  const before = sha256(readFileSync(SRC_RET, 'utf8'))
  const original = readFileSync(SRC_RET, 'utf8')
  const find = "violations.push('[consumes-half-life] ' + t1.detail)"
  const hits = original.split(find).length - 1
  assert.equal(hits, 1, '扰动锚点必须恰好命中 1 次，实测 ' + hits + '（0 次即变异器过期，静默通过 = 假绿）')
  const dir = tmp()
  const copy = join(dir, 'retention-mutated.ts')
  const srcDir = dirname(fileURLToPath(SRC_RET))
  const mutated = original
    .replace(find, 'void t1')
    .replace(/from '\.\/([\w.-]+\.ts)'/g, (_all, f2) => 'from ' + Q + pathToFileURL(join(srcDir, f2)).href + Q)
  writeFileSync(copy, mutated)
  const mod = await import(pathToFileURL(copy).href)
  const deadKnob = { decay: (t, _h) => Math.exp((-t * Math.LN2) / frozen2) }
  // 扰动版必须**不再**登记该违规（否则扰动没生效，属打错靶）
  const mutatedReading = mod.decayKernelTeeth(deadKnob, { frozenHalfLife: frozen2, probeHalfLife: frozen2 / 2 })
  assert.equal(mutatedReading.violations.some((v) => v.includes('consumes-half-life')), false, '扰动版必须不再登记该违规 —— 否则本对拍打错靶')
  assert.match(copy ? readFileSync(copy, 'utf8') : '', /void t1/, '扰动必须真落盘')
  // 而**真源**的带牙腿仍必须把它判红 ⇒ 这条腿确实在检查，不是恒绿
  assert.equal(retentionMod.decayKernelTeeth(deadKnob, { frozenHalfLife: frozen2, probeHalfLife: frozen2 / 2 }).ok, false)
  assert.equal(sha256(readFileSync(SRC_RET, 'utf8')), before, '真源必须逐字节未变：before=' + before)
})

// ══ ⑥ 用例计数自检 + 判据面未被掏空 ══════════════════════════════════════════
test('⑨ 用例计数自检 + A1-5 判据面单列（不得混进被骨架判据钉死的清单）', async () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, '本次执行到的用例数必须为 ' + EXPECTED_CASES + '；实测 ' + ran + '（有用例被删即红）')
  const self = readFileSync(new URL(import.meta.url), 'utf8')
  const declared = (self.match(/^test\(/gm) ?? []).length
  assert.equal(declared, EXPECTED_CASES, '本文件 test( 声明数须为 ' + EXPECTED_CASES + '，实测 ' + declared)
  for (const anchor of ['1.0', '0.5', '0.011609']) {
    assert.ok(self.includes(anchor), '锚点 ' + anchor + ' 必须写在本文件里（判据被换成软断言即红）')
  }
  const mod = await load('index.ts')
  const a15 = mod.IMPLEMENTED_A15_EXPORTS
  /**
   * ⚠ **互覆盖腿**（N7，取代原先的 `length === 2`）——
   *   旧断言的形状是自指的：清单与「期望的清单」是同一条常量，`length === 2` 是**写死常数**
   *   ⇒ 删掉一项并把 2 改成 1 即可全绿（c3 accept 席 D-C 实测推演）。
   *   现在三处**互为对照物**：① `IMPLEMENTED_A15_EXPORTS`（实现面自报）；② `A15_EXPORT_FACE`（源码里
   *   独立写的第二份）；③ 本文件下面这份**字面量表**（判据侧独立写）。三者逐名相等才绿。
   */
  const EXPECTED_A15_FACE = ['A1_5_ANCHOR_POINTS', 'decayAnchorReadings', 'decayKernelTeeth']
  assert.deepEqual(
    [...a15].sort(),
    [...EXPECTED_A15_FACE].sort(),
    'IMPLEMENTED_A15_EXPORTS 必须与判据侧**独立字面量表**逐名相等（不等 ⇒ 清单被削/改而判据不同步），实测 ' + JSON.stringify(a15),
  )
  assert.deepEqual(
    [...mod.A15_EXPORT_FACE].sort(),
    [...EXPECTED_A15_FACE].sort(),
    'A15_EXPORT_FACE 必须与判据侧独立字面量表逐名相等（两张清单互相覆盖 ⇒ 只改一张即红），实测 ' + JSON.stringify(mod.A15_EXPORT_FACE),
  )
  for (const n of EXPECTED_A15_FACE) assert.ok(n in mod, '导出 ' + n + ' 必须存在（被搬走/改名即红）')
  // ⚠ 反向：清单里**多**一项也要红（把 length===2 写死时，多一项会因为 n in mod 恒真而被放过）
  const extraNames = [...a15].filter((n) => !EXPECTED_A15_FACE.includes(n))
  assert.deepEqual(extraNames, [], 'IMPLEMENTED_A15_EXPORTS 里出现了判据侧未登记的名字（偷偷加导出而不进判据面 ⇒ 必须红）')
  const overlap = a15.filter((n) => mod.IMPLEMENTED_EXPORTS.includes(n))
  assert.deepEqual(overlap, [], 'A1-5 判据面不得混进 IMPLEMENTED_EXPORTS（那条清单被 skeleton 的集合相等腿钉死，混入即两处判据互相打架）')
})

/** 带牙腿用的冻结半衰期（= long-term 真源的 HALF_LIFE_DAYS，逐字取，不写死 14）。 */
const frozen2 = HALF_LIFE_DAYS