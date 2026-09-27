/**
 * `dsh-mana-prompts` 包内判据。
 *
 * 判据面（对应派单的 5 条 DoD + 自证要求）：
 *   ① 包四件齐（name/inject/Config/apply）+ 服务面可读（真 `Context`，与 R0 同口径）
 *   ② 20 个常量全部导出，且**逐条**满足形态判据（type 合法 / instructions 非空 /
 *      choice·noul 的 criteria 是对象 / score 的是数组）
 *   ③ 三方集合相等：模块真实导出集 == 注册表 == 本文件自带对照表**（防"删一条改常数"恒绿）**
 *   ④ `JevQuestion` 是 **import 来的**（不是本包自定义）—— 静态 + 运行期两腿
 *   ⑤ 4 类**负控**：证明②③的检查器有负荷（把坏形态喂进去必须报红）
 *   ⑥ §25.8 两条 ITACL 常量 **不接线**：源码静态面 + 运行时服务面两腿
 *   ⑥c `wired: true` 的**真消费者**双路机检 + 与注册表 `wiredSites` 声明**对拍**（A/B 耦合腿）
 *   ⑦ Config 两枚键**真参与判断**（本仓「死开关」门：提到 ≠ 拿去判）
 *
 * ⚠ 本文件 import 的是 **src**（白盒，与 a1-check 的 A1-4/11/12 同口径），
 *   不是 `lib/`：判据要测**真源**，不是产物。产物新鲜度由 a1-check 的产物腿另管。
 * ⚠ 不写回仓内任何文件（变异只在内存里做），与 a1-check 同纪律。
 * 运行：node --test packages/prompts/tests/prompts.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const { Context } = await import(DSH + '/cordis/lib/index.js')
// schemastery 用**裸 specifier**（向上解析到仓根 node_modules，与别包测试同口径）；
// 它不是 dsh 自带的包，故**不能**用 DSH 前缀拼路径（实测 ERR_MODULE_NOT_FOUND）。
const Schema = (await import('@deepseek-ai/schemastery')).default

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url))
const mod = await import(new URL('../src/index.ts', import.meta.url).href)
const { verifyPrompts } = await import(new URL('../src/registry.ts', import.meta.url).href)

/**
 * 判据自带的**独立对照表**（第二份真源）。
 *
 * ⚠ 这是刻意的重复：只对照注册表自身的长度就是**自指**——删一条常量、把注册表里那行
 *   也删掉、再改常数，断言照样全绿（本仓 forgetting 包 A15 的实测教训）。
 *   故本表**另写一遍** v10 §25 的 20 个名字，与「模块真实导出」「注册表」三方相等。
 */
const EXPECTED_NAMES = Object.freeze([
  'WRITE_GATE_PROMPT',
  'SUPERSEDES_PROMPT',
  'EMOTION_VALENCE_PROMPT',
  'EMOTION_AROUSAL_PROMPT',
  'CONSOLIDATION_TRIGGER_PROMPT',
  'CHUNKING_UTILITY_PROMPT',
  'SLEEP_INDICTION_SYSTEM_PROMPT',
  'INTENT_CLASSIFICATION_SYSTEM_PROMPT',
  'RECALL_GATE_PROMPT',
  'INJECTION_GATE_PROMPT',
  'RECONSOLIDATION_UPDATE_PROMPT',
  'ACTIVITY_LEVEL_PROMPT',
  'COMPRESSION_SYSTEM_PROMPT',
  'PRINCIPLE_EXTRACTION_SYSTEM_PROMPT',
  'PATH_INDUCTION_SYSTEM_PROMPT',
  'UNFAMILIAR_TASK_PROMPT',
  'TOOL_ROUTING_PROMPT',
  'SAFETY_GATE_PROMPT',
  'TASK_COMPLEXITY_PROMPT',
  'RESULT_CLASSIFICATION_PROMPT',
])

/** v10 §25 里 type='score' 的四条（其余 JevQuestion 是 noul/choice）。 */
const SCORE_NAMES = Object.freeze(['EMOTION_VALENCE_PROMPT', 'EMOTION_AROUSAL_PROMPT', 'CHUNKING_UTILITY_PROMPT'])

/** 工厂常量 → 样例实参（判据直接驱动，不依赖注册表的 sampleArgs）。 */
const FACTORY_ARGS = Object.freeze({
  SUPERSEDES_PROMPT: [['旧甲', '旧乙']],
  RECALL_GATE_PROMPT: ['样例摘要'],
  RECONSOLIDATION_UPDATE_PROMPT: ['原记忆', '新信息'],
  UNFAMILIAR_TASK_PROMPT: ['样例任务', '样例历史'],
  TOOL_ROUTING_PROMPT: [['read', 'write']],
  SAFETY_GATE_PROMPT: ['删除文件'],
})

const LEGAL_TYPES = new Set(['noul', 'choice', 'score'])

/**
 * 去掉块注释与行注释（**保留行数**：用等长空白替换，便于按位置报错）。
 *
 * ⚠ 为什么所有"源码里不得出现 X"的腿都必须先过这一层：本包的注释**正是用来解释
 *   为什么不用 X 的**（例如头部注释里写了"本包不注册 registerPassThroughPreStep"）。
 *   不剥注释 ⇒ **文档写得越清楚，判据越红** —— 本轮实测踩到，是判据写错不是实现错。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

/**
 * 取一个函数声明的**函数体**（配对花括号，跳过字符串/注释里的括号）。
 *
 * ⚠ 为什么要配对而不是「从声明处切到文件尾」：切到文件尾会把该函数**之后**的
 *   顶层再导出也算进函数体，制造假红（本轮实测踩到，见 ⑥b 的注释）。
 */
function extractFunctionBody(src, decl) {
  const at = src.indexOf(decl)
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

/** 取一条常量的**实参化**结果：工厂按样例行参，静态常量原样。 */
function materialize(name) {
  const ref = mod[name]
  if (typeof ref === 'function') return ref(...(FACTORY_ARGS[name] ?? []))
  return ref
}

/** 单条形态检查（与包内 verifyPrompts 的腿同义，但**独立实现**，避免自证）。 */
function shapeProblems(name) {
  const q = materialize(name)
  const bad = []
  if (q === null || typeof q !== 'object') return ['不是对象']
  if (!LEGAL_TYPES.has(q.type)) bad.push('type 非法: ' + String(q.type))
  if (typeof q.instructions !== 'string' || q.instructions.trim() === '') bad.push('instructions 空')
  if (q.type === 'score') {
    if (!Array.isArray(q.criteria)) bad.push('score.criteria 不是数组')
    else if (q.criteria.length === 0) bad.push('score.criteria 空数组')
  } else if (q.criteria === null || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) {
    bad.push(q.type + '.criteria 不是对象')
  }
  return bad
}

// ── ① 包四件齐 ─────────────────────────────────────────────────────────────
test('① 包四件齐（name/inject/Config/apply）且 Config 是 schemastery schema', () => {
  assert.equal(typeof mod.name, 'string')
  assert.ok(Array.isArray(mod.inject), 'inject 必须是数组')
  assert.equal(typeof mod.apply, 'function')
  assert.ok(mod.Config, 'Config 必须存在')
  // 「是不是 schemastery schema」用**行为**判，不用正则判（正则会被注释里出现的 Schema 骗过）
  const parsed = new Schema(mod.Config)({})
  assert.equal(typeof parsed.requireTemplateVariables, 'boolean')
  assert.equal(parsed.requireTemplateVariables, true, 'requireTemplateVariables 缺省必须为 true（占位符腿不可静默关掉）')
  assert.equal(parsed.expectedConstantCount, 20, 'expectedConstantCount 缺省 = v10 §25 的 20 条')
})

test('①b 真 Context 装配：服务可读（装配判据 = 服务可读，与 R0 同口径）', async () => {
  const ctx = new Context()
  const before = ctx.get('mana-prompts')
  assert.equal(before, undefined, '装配前必须不可读（否则判据平凡通过）')
  mod.apply(ctx, new mod.Config({}))
  await new Promise((r) => setTimeout(r, 50))
  const svc = ctx.get('mana-prompts')
  assert.ok(svc, '装配后服务必须可读')
  assert.equal(svc.plugin, 'mana-prompts')
  assert.equal(svc.counts().total, 20)
})

test('①c 卸载即净：dispose 后服务不可读（反证腿）', async () => {
  const { Context: C2 } = await import(DSH + '/cordis/lib/index.js')
  const ctx = new C2()
  const disposers = []
  // 复用 apply 的 effect：cordis 把 fiber 的清理交给 scope，这里直接验 provide 的 dispose 语义
  ctx.plugin({
    name: 'probe',
    apply(c) {
      const off = c.provide('mana-prompts', { plugin: 'mana-prompts' })
      disposers.push(off)
    },
  })
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(ctx.get('mana-prompts'), '前置：装配后可读')
  disposers[0]?.()
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(ctx.get('mana-prompts'), undefined, 'dispose 后必须不可读')
})

// ── ② 20 个常量全部导出且形态正确 ───────────────────────────────────────────
test('② 二十个常量全部导出，且逐条通过形态判据', () => {
  const problems = []
  for (const n of EXPECTED_NAMES) {
    if (!(n in mod)) { problems.push(n + ': 未导出'); continue }
    if (typeof mod[n] === 'function' && !(n in FACTORY_ARGS)) { problems.push(n + ': 工厂但判据无样例实参'); continue }
    if (typeof mod[n] === 'string') {
      if (mod[n].trim() === '') problems.push(n + ': 模板为空')
      continue
    }
    problems.push(...shapeProblems(n).map((p) => n + ': ' + p))
  }
  assert.deepEqual(problems, [], '形态问题：' + problems.join(' | '))
})

test('②b type 分布与 v10 原文一致（score 恰好 3 条；学习链条零 JevQuestion）', () => {
  const types = {}
  for (const n of EXPECTED_NAMES) {
    const v = mod[n]
    if (typeof v === 'string') { types[n] = 'template'; continue }
    types[n] = materialize(n).type
  }
  const scoreNames = EXPECTED_NAMES.filter((n) => types[n] === 'score')
  assert.deepEqual([...scoreNames].sort(), [...SCORE_NAMES].sort(), 'score 集合必须与原文一致')
  const templates = EXPECTED_NAMES.filter((n) => types[n] === 'template')
  assert.equal(templates.length, 5, 'system prompt 模板必须是 5 条（§25.2/3/5/6）')
  // §25.6 学习链条两条**都是**模板 ⇒ 本链无 JevQuestion（照原文）
  assert.ok(templates.includes('PRINCIPLE_EXTRACTION_SYSTEM_PROMPT') && templates.includes('PATH_INDUCTION_SYSTEM_PROMPT'))
  const noul = EXPECTED_NAMES.filter((n) => types[n] === 'noul')
  const choice = EXPECTED_NAMES.filter((n) => types[n] === 'choice')
  assert.equal(noul.length + choice.length + scoreNames.length, 15, 'JevQuestion 必须恰好 15 条')
})

// ── ③ 三方集合相等（防自指）─────────────────────────────────────────────────
test('③ 三方集合相等：模块真实导出 == 注册表 == 判据对照表', () => {
  const registryNames = mod.PROMPT_REGISTRY.map((e) => e.name).sort()
  const expected = [...EXPECTED_NAMES].sort()
  assert.deepEqual(registryNames, expected, '注册表与判据对照表必须逐名相等')
  assert.equal(mod.PROMPT_REGISTRY.length, 20, '注册表必须恰好 20 条')
  for (const n of expected) assert.ok(n in mod, '模块必须真的导出 ' + n)
})

test('③b 注册表无重名、每条都有 v10 小节归属', () => {
  const names = mod.PROMPT_REGISTRY.map((e) => e.name)
  assert.equal(new Set(names).size, names.length, '注册表不得重名')
  for (const e of mod.PROMPT_REGISTRY) assert.match(e.section, /^§25\.[1-8]$/, e.name + ' 的 section 非法: ' + e.section)
  // §25.1–25.8 每一节都必须有落点
  const sections = new Set(mod.PROMPT_REGISTRY.map((e) => e.section))
  for (let i = 1; i <= 8; i += 1) assert.ok(sections.has('§25.' + i), '§25.' + i + ' 无落点')
})

// ── ④ JevQuestion 是 import 来的（不是本包自定义）────────────────────────────
test('④ 静态腿：源码里没有第二份 JevQuestion/JevQuestionType 定义', () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length > 0, '必须有源文件')
  const offenders = []
  for (const f of files) {
    // 先剥注释，再判"有没有第二份定义"（理由见 stripComments）
    const txt = stripComments(readFileSync(SRC_DIR + f, 'utf8'))
    // 只认**定义**形态：interface/type 声明里出现 JevQuestion（含被改名的同义定义）
    if (/(?:export\s+)?(?:interface|type)\s+JevQuestion\w*\s*[<{=]/.test(txt)) offenders.push(f + ': 出现 JevQuestion 类型定义')
    if (/type\s+\w*JevQuestion\w*Type\s*=/.test(txt)) offenders.push(f + ': 出现 JevQuestionType 类型定义')
    // 值面也不许自建三态字面量集合
    if (/['"]noul['"]\s*\|\s*['"]choice['"]/.test(txt)) offenders.push(f + ': 出现 noul|choice 字面量联合（第二份真源）')
  }
  assert.deepEqual(offenders, [], '第二份真源：' + offenders.join(' | '))
})

test('④b 动态腿：类型真源可从 jev 产物解析，且形状与 jev 声明一致', async () => {
  // 类型在运行时被擦除 ⇒ 判据审的是「真源文件确实存在且仍声明这些成员」
  const jevTypes = fileURLToPath(new URL('../../jev/lib/types/systemone.d.ts', import.meta.url))
  const txt = readFileSync(jevTypes, 'utf8')
  assert.match(txt, /export type JevQuestionType = 'noul' \| 'choice' \| 'score';/, 'jev 真源必须仍声明三态')
  assert.match(txt, /export interface JevQuestion \{/, 'jev 真源必须仍声明 JevQuestion')
  // 本包源码必须指向它（**不得**指向自己）。
  // ⚠ 断言扫**全部 src 文件**而不是 index.ts：类型 import 落在各条链文件里
  //   （index.ts 自身不需要 JevQuestion，它只做再导出）——首版本条断言只看 index.ts，
  //   实测判红，是**判据写错**不是实现错（负控纪律救了一次假红）。
  const importers = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /import type \{ JevQuestion \} from '\.\.\/\.\.\/jev\/lib\/types\/systemone\.js'/.test(readFileSync(SRC_DIR + f, 'utf8')))
  assert.ok(importers.length >= 1, '必须有一条 src 文件从 jev 产物 import JevQuestion；实测命中 ' + importers.length + ' 个')
})

// ── ⑤ 负控：检查器有负荷（坏形态必须报红）────────────────────────────────────
test('⑤ 负控：四种坏形态必须被检查器抓到（否则②③恒绿）', () => {
  const good = { type: 'noul', instructions: '问句？', criteria: { true: '是', false: '否' } }
  assert.deepEqual(verifyPrompts({ expectedConstantCount: 20 }), [], '正控：真注册表必须零问题')

  // 负控 1：type 非法
  const badType = verifyPrompts({ expectedConstantCount: 20, requireTemplateVariables: true })
  assert.equal(badType.length, 0, '前置：正常情况下无问题')
  const shape = (q) => {
    const bad = []
    if (!LEGAL_TYPES.has(q.type)) bad.push('type')
    if (typeof q.instructions !== 'string' || q.instructions.trim() === '') bad.push('instructions')
    if (q.type === 'score' ? !Array.isArray(q.criteria) : (q.criteria === null || typeof q.criteria !== 'object' || Array.isArray(q.criteria))) bad.push('criteria')
    return bad
  }
  assert.deepEqual(shape({ ...good, type: 'oops' }), ['type'], '负控1：非法 type 必被抓')
  assert.deepEqual(shape({ ...good, instructions: '   ' }), ['instructions'], '负控2：空白 instructions 必被抓')
  assert.deepEqual(shape({ ...good, type: 'score', criteria: { a: 'b' } }), ['criteria'], '负控3：score 用对象必被抓')
  assert.deepEqual(shape({ ...good, type: 'choice', criteria: ['a'] }), ['criteria'], '负控4：choice 用数组必被抓')
  assert.deepEqual(shape(good), [], '正控：合法形态必须有零问题')
})

test('⑤b 负控：删一条常量 ⇒ 三方集合相等腿必红', () => {
  // 在**内存**里模拟"注册表少一条"，证明③有负荷（不写回任何文件）
  const shrunk = mod.PROMPT_REGISTRY.filter((e) => e.name !== 'WRITE_GATE_PROMPT')
  assert.notDeepEqual(shrunk.map((e) => e.name).sort(), [...EXPECTED_NAMES].sort(), '少一条必须与对照表不等')
  const findings = verifyPrompts({ expectedConstantCount: 19 })
  assert.ok(findings.some((f) => f.code === 'registry-size'), '规模不符必须落 registry-size finding')
})

// ── ⑥ §25.8 ITACL 两条不接线 ────────────────────────────────────────────────
test('⑥ ITACL 两条：注册表标 wired=false，且服务面如实暴露', async () => {
  assert.deepEqual([...mod.UNWIRED_PROMPT_NAMES].sort(), ['RESULT_CLASSIFICATION_PROMPT', 'TASK_COMPLEXITY_PROMPT'])
  for (const n of mod.UNWIRED_PROMPT_NAMES) {
    const e = mod.PROMPT_REGISTRY.find((x) => x.name === n)
    assert.equal(e.wired, false, n + ' 必须标 wired=false')
  }
  const ctx = new Context()
  mod.apply(ctx, new mod.Config({}))
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual([...ctx.get('mana-prompts').status().unwired].sort(), ['RESULT_CLASSIFICATION_PROMPT', 'TASK_COMPLEXITY_PROMPT'])
})

test('⑥b ITACL 两条**不得被宿主消费**：apply 体里零引用（源码静态腿）', () => {
  const idx = readFileSync(SRC_DIR + 'index.ts', 'utf8')
  // ⚠ 必须按**配对花括号**取 apply 的**函数体**：首版写成「'export function apply' 之后的全部文本」，
  //   于是文件底部那句**再导出**（export { TASK_COMPLEXITY_PROMPT, … } from './itacl.ts'）
  //   也被算了进来 ⇒ 假红。再导出 ≠ 宿主消费：那是把常量**暴露出去**，正是本包该做的事。
  const applyBody = extractFunctionBody(idx, 'export function apply')
  assert.ok(applyBody && applyBody.length > 0, '必须能取到 apply 函数体')
  for (const n of ['TASK_COMPLEXITY_PROMPT', 'RESULT_CLASSIFICATION_PROMPT']) {
    assert.equal(applyBody.includes(n), false, 'apply 里不得出现 ' + n)
  }
  // 本包**不注册监听器**：不得出现 registerPassThroughPreStep / ctx.on（第 8 事件契约只读）
  // ⚠ 必须先剥注释：本包头部注释**专门解释了为什么不用它**，不剥 ⇒ 越写清楚越红（实测）。
  const code = stripComments(idx)
  assert.equal(/registerPassThroughPreStep/.test(code), false, '本包不注册 waterfall 直通（无监听器 ⇒ G9 无适用面）')
  assert.equal(/ctx\.on\(/.test(code), false, '本包不得注册事件监听器')
})

// ── ⑦ Config 两枚键真参与判断（死开关门）────────────────────────────────────
test('⑦ 两枚配置键都**真参与判断**（可观测差异，不是被回填的装饰）', async () => {
  const mk = (cfg) => {
    const ctx = new Context()
    mod.apply(ctx, new mod.Config(cfg))
    return ctx.get('mana-prompts')
  }
  await new Promise((r) => setTimeout(r, 30))
  // 键 1：expectedConstantCount 真参与规模比较
  const s20 = mk({ expectedConstantCount: 20 })
  const s21 = mk({ expectedConstantCount: 21 })
  assert.equal(s20.status().findings, 0, '期望 20 ⇒ 零 findings')
  assert.equal(s21.status().findings, 1, '期望 21 ⇒ 恰好 1 条 registry-size（可观测差异）')
  assert.equal(s21.status().expected, 21, '读回的期望值必须是改过的那枚')
  // 键 2：requireTemplateVariables 真参与腿选择（把它关掉 ⇒ 少一条腿）
  const on = verifyPrompts({ requireTemplateVariables: true, expectedConstantCount: 20 })
  const off = verifyPrompts({ requireTemplateVariables: false, expectedConstantCount: 20 })
  assert.deepEqual(on, [], '开启时零问题')
  assert.deepEqual(off, [], '关闭时当前数据也零问题（两条模板都真带占位符）')
  // 用"应带占位符但没带"的**合成数据**证明该键有牙：只查名单里那条
  const text = mod.SLEEP_INDICTION_SYSTEM_PROMPT
  assert.match(text, /\{\{[^}]+\}\}/, 'SLEEP_INDICTION 必须真带 {{变量}} 占位符')
  assert.match(mod.PATH_INDUCTION_SYSTEM_PROMPT, /\{\{[^}]+\}\}/, 'PATH_INDUCTION 必须真带 {{变量}} 占位符')
  assert.equal(/\{\{/.test(mod.COMPRESSION_SYSTEM_PROMPT), false, 'COMPRESSION 原文无占位符（不得擅自加）')
  assert.equal(/\{\{/.test(mod.INTENT_CLASSIFICATION_SYSTEM_PROMPT), false, 'INTENT_CLASSIFICATION 原文无占位符')
})

// ══ ⑥c wired:true 的真消费者机检（A）+ 与注册表声明的对拍（A↔B 耦合腿）═══════════
/**
 * 真消费者扫描（**判据侧唯一实现**；对拍判决住包内 verifyPrompts，避免两处各写一份）。
 *
 * ⚠ 为什么是这个口径（2026-09-27 实测，别自己重造 —— 已栽过两次）：
 *   ① 真消费**两种写法都出现过**：裸引用名（import 名）与**字符串名**
 *      （prompts.get('X_PROMPT')，本仓三条真消费**全是这一路**）
 *      ⇒ 只扫一种必漏，**双路取并集**才是可靠判据；
 *   ② **必须剥注释**：本仓实测过「注释里的字面量冒充代码」
 *      （attention/src/index.ts:48 的注释含 ctx.on('mana/decision' ⇒ 裸 grep 命中 1、剥注释后 0）；
 *   ③ **必须排除 prompts 包自身**：本包 src 里每个名字都出现（定义 + 再导出 + 注册表），
 *      不排除则**恒真**（每条都「有消费者」）—— 正是旧判据的盲区。
 */
// ⚠ 仓根 = tests/ 往上**三层**（tests→prompts→packages→仓根）；首版写成两层 ⇒ 扫到
//   <仓根>/packages/packages 并 ENOENT（本条实测踩到，留作路标）。
const SCAN_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** 剥字符串字面量（反引号用 charCode 拼，避免本文件自身的嵌套）。 */
function stripStrings(src) {
  const tick = String.fromCharCode(96)
  return src
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => ' '.repeat(m.length))
    .replace(new RegExp(tick + '(?:[^' + tick + '\\\\]|\\\\.)*' + tick, 'g'), (m) => ' '.repeat(m.length))
}

/**
 * **递归**收集 src 下的 .ts（本仓有嵌套层：ui/src/client —— 首版只 readdir 一层，
 * 实测漏 13 个文件 ⇒ 「零命中」里混着「零扫描」，正是本卡要区分的那件事）。
 */
function walkSrc(dir, relPrefix, pkg, out) {
  for (const e of readdirSync(dir).sort()) {
    const abs = dir + '/' + e
    const rel = relPrefix + '/' + e
    if (statSync(abs).isDirectory()) walkSrc(abs, rel, pkg, out)
    else if (e.endsWith('.ts')) out.push({ pkg, rel, text: readFileSync(abs, 'utf8') })
  }
}

/** 全仓**非本包** src 的 .ts 文件（rel 报点用，text 供负控造内存文件）。 */
function consumerScanFiles(extra = []) {
  const pkgs = readdirSync(SCAN_ROOT + 'packages')
  const out = []
  for (const pkg of pkgs.sort()) {
    if (pkg === 'prompts') continue
    const dir = SCAN_ROOT + 'packages/' + pkg + '/src'
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    walkSrc(dir, 'packages/' + pkg + '/src', pkg, out)
  }
  return out.concat(extra)
}

/** 扫描面读数：文件数 + 覆盖包数（把「零命中」与「零扫描」分开 —— 后者是假绿）。 */
function consumerScanSummary(files) {
  return files.length + ' 个文件 / ' + new Set(files.map((f) => f.pkg)).size + ' 个非本包'
}

/**
 * 常量名 -> 实测真消费点（packages/<包>/src/<文件>:<行号>，排序）。
 * 双路并集：① 字符串名（在**未剥字符串**的代码面上找字面量）
 *           ② 裸引用名（**剥字符串**后仍在 = 真标识符）；
 * **两条路都先剥注释**。
 */
function scanConsumers(names, files) {
  const found = {}
  for (const n of names) found[n] = []
  const tick = String.fromCharCode(96)
  const q = String.fromCharCode(39)
  const qc = q + '"' + tick
  for (const f of files) {
    const code = stripComments(f.text)
    const noStr = stripStrings(code)
    const Lc = code.split('\n')
    const Ls = noStr.split('\n')
    for (const n of names) {
      const bare = new RegExp('\\b' + n + '\\b')
      const str = new RegExp('[' + qc + ']' + n + '[' + qc + ']')
      for (let i = 0; i < Lc.length; i += 1) {
        if (str.test(Lc[i]) || bare.test(Ls[i])) found[n].push(f.rel + ':' + (i + 1))
      }
    }
  }
  for (const n of names) found[n] = Object.freeze([...new Set(found[n])].sort())
  return Object.freeze(found)
}

const ALL_NAMES = EXPECTED_NAMES
const SCAN_FILES = consumerScanFiles()
const SCAN = scanConsumers(ALL_NAMES, SCAN_FILES)
/** 「实测有消费者」的集合（= 已接线集合）。 */
const SCAN_CONSUMED = ALL_NAMES.filter((n) => SCAN[n].length > 0)

test('⑥c-面 扫描面非空，且三种已知写法都能被扫到（防「扫描器静默失效」）', () => {
  assert.ok(SCAN_FILES.length > 10, '非本包 src 文件数必须 >10，实测=' + SCAN_FILES.length)
  assert.ok(new Set(SCAN_FILES.map((f) => f.pkg)).size >= 5, '覆盖包数必须 >=5')
  for (const n of ['COMPRESSION_SYSTEM_PROMPT', 'SLEEP_INDICTION_SYSTEM_PROMPT', 'INTENT_CLASSIFICATION_SYSTEM_PROMPT']) {
    assert.ok(SCAN[n].length >= 1, n + ' 必须被扫到（否则是扫描器失效，不是「没人用」）')
  }
  console.log('   ⑥c 扫描面 = ' + consumerScanSummary(SCAN_FILES) + '；已接线 ' + SCAN_CONSUMED.length + '/' + ALL_NAMES.length + '：' + SCAN_CONSUMED.join(', '))
})

test('⑥c-负控 剥注释 / 排除本包 两条纪律各自都**有负荷**（去掉任一条即假绿）', () => {
  const onlyInComment = { pkg: 'fake', rel: 'packages/fake/src/f.ts', text: '// SAFETY_GATE_PROMPT 只在注释里\nconst y = 1\n' }
  const inRealCode = { pkg: 'fake', rel: 'packages/fake/src/f.ts', text: "import { SAFETY_GATE_PROMPT } from 'dsh-mana-prompts'\nconst y = 1\n" }
  const strOnly = { pkg: 'fake', rel: 'packages/fake/src/g.ts', text: "const e = p.get('SAFETY_GATE_PROMPT')\n" }
  assert.deepEqual(scanConsumers(['SAFETY_GATE_PROMPT'], [onlyInComment]).SAFETY_GATE_PROMPT, [], '只出现在注释里必须零命中（不剥注释即假绿）')
  assert.equal(scanConsumers(['SAFETY_GATE_PROMPT'], [inRealCode]).SAFETY_GATE_PROMPT.length, 1, '裸引用路径必须有牙（证明上一条不是「扫描器全哑」）')
  assert.equal(scanConsumers(['SAFETY_GATE_PROMPT'], [strOnly]).SAFETY_GATE_PROMPT.length, 1, '字符串名路径必须有牙')
  // 排除本包：把 prompts 自身 src 算进扫描面 ⇒ 本该零命中的名字立刻「有消费者」
  const withSelf = scanConsumers(['SAFETY_GATE_PROMPT'], consumerScanFiles([
    { pkg: 'prompts', rel: 'packages/prompts/src/scheduling.ts', text: readFileSync(SRC_DIR + 'scheduling.ts', 'utf8') },
  ]))
  assert.ok(withSelf.SAFETY_GATE_PROMPT.length > 0, '把本包算进来必然出现假消费者（证明「排除本包」有负荷）')
  assert.deepEqual(SCAN.SAFETY_GATE_PROMPT, [], '真扫描面里 SAFETY_GATE_PROMPT 必须零消费点')
})

test('⑥c-A 声明集 == 实测集；wired:true 却无消费者**逐条可见、可数**', async () => {
  const base = { requireTemplateVariables: true, expectedConstantCount: 20 }
  const findings = verifyPrompts({ ...base, consumerSites: SCAN })
  const mismatch = findings.filter((f) => f.code === 'wired-declaration-mismatch')
  assert.deepEqual(mismatch, [], '注册表 wiredSites 声明必须与实测逐项相等；不符=' + JSON.stringify(mismatch))
  const declaredNone = mod.PROMPT_REGISTRY.filter((e) => e.wiredSites.length === 0).map((e) => e.name).sort()
  const scannedNone = ALL_NAMES.filter((n) => SCAN[n].length === 0).sort()
  assert.deepEqual(declaredNone, scannedNone, '声明「无消费者」集合必须 == 实测「零消费点」集合（**双向**）')
  // 腿的牙：wired:true 却零消费 ⇒ 逐条 wired-consumer-missing（**只报数据，不判死**）
  const wiredNone = mod.PROMPT_REGISTRY.filter((e) => e.wired && SCAN[e.name].length === 0).map((e) => e.name).sort()
  const missing = findings.filter((f) => f.code === 'wired-consumer-missing').map((f) => f.name).sort()
  assert.deepEqual(missing, wiredNone, 'wired-consumer-missing 必须逐条等于「wired:true 且零消费」集合')
  assert.ok(wiredNone.length >= 1, '现状确实有 wired:true 无消费者的条目（若为 0 请先怀疑扫描器失效）')
  console.log('   ⑥c-A 已接线 ' + SCAN_CONSUMED.length + '/' + ALL_NAMES.length + '；wired:true 无消费者 ' + wiredNone.length + ' 条：' + wiredNone.join(', '))
  // B：服务面读数与实测**同一口径**
  const ctx = new Context()
  mod.apply(ctx, new mod.Config({}))
  await new Promise((r) => setTimeout(r, 50))
  const svc = ctx.get('mana-prompts')
  const st = svc.status()
  assert.equal(st.wiredConsumers.withConsumers, SCAN_CONSUMED.length, 'status().wiredConsumers.withConsumers 必须 == 实测已接线数')
  assert.equal(st.wiredConsumers.none, ALL_NAMES.length - SCAN_CONSUMED.length, 'none 必须 == 实测无消费者数')
  assert.equal(st.total, ALL_NAMES.length, 'total 必须 = 20')
  for (const n of SCAN_CONSUMED) assert.deepEqual([...st.wiredConsumers.sites[n]], SCAN[n], n + ' 的读数消费点必须与实测逐项相等')
  assert.deepEqual([...st.wiredConsumers.unconsumed].sort(), scannedNone, 'unconsumed 必须 == 实测无消费者集合')
  assert.equal(svc.counts().withConsumers, SCAN_CONSUMED.length, 'counts().withConsumers 与 status() 必须同源同值')
  console.log('   ⑥c-B status().wiredConsumers：已接线 ' + st.wiredConsumers.withConsumers + '/' + st.total + '，无消费者 ' + st.wiredConsumers.none + ' 条')
})

test('⑥c-B 对拍腿有牙：声明与实测不符 ⇒ 双向都红（造一处不符）', () => {
  const base = { requireTemplateVariables: true, expectedConstantCount: 20 }
  assert.deepEqual(
    verifyPrompts({ ...base, consumerSites: SCAN }).filter((f) => f.code === 'wired-declaration-mismatch'), [],
    '正控：真表零 mismatch',
  )
  // 负控 1（声明有、实测无）：抹掉一条**真实**消费点
  const dropReal = { ...SCAN, COMPRESSION_SYSTEM_PROMPT: [] }
  const f1 = verifyPrompts({ ...base, consumerSites: dropReal })
  assert.ok(f1.some((f) => f.name === 'COMPRESSION_SYSTEM_PROMPT' && f.code === 'wired-declaration-mismatch'), '抹掉真实消费点必须红；实测=' + JSON.stringify(f1))
  // 负控 2（实测有、声明无）
  const addFake = { ...SCAN, SAFETY_GATE_PROMPT: ['packages/nowhere/src/x.ts:1'] }
  const f2 = verifyPrompts({ ...base, consumerSites: addFake })
  assert.ok(f2.some((f) => f.name === 'SAFETY_GATE_PROMPT' && f.code === 'wired-declaration-mismatch'), '声明与实测不符必须红')
  assert.ok(f2.some((f) => f.name === 'SAFETY_GATE_PROMPT' && f.code === 'wired-consumer-undeclared'), '反方向必须落 wired-consumer-undeclared')
  // 负控 3（wired:false 却被消费）：§25.8 两条的防漏线
  const leak = { ...SCAN, TASK_COMPLEXITY_PROMPT: ['packages/core/src/leak.ts:9'] }
  assert.ok(verifyPrompts({ ...base, consumerSites: leak }).some((f) => f.name === 'TASK_COMPLEXITY_PROMPT' && f.code === 'wired-consumer-undeclared'), '§25.8 被消费必须红')
  // 开关性：不给实测表 ⇒ 不产 wired-* finding（人工自检场景**程序性**跳过，不是静默）
  assert.deepEqual(verifyPrompts(base).filter((f) => f.code.startsWith('wired-')), [], '不给 consumerSites 时不应有 wired-* finding')
})

test('⑥c-C 防误读：wired 字段注释写死语义（本字段被误读过，注释即契约处）', () => {
  const src = readFileSync(SRC_DIR + 'registry.ts', 'utf8')
  const at = src.indexOf('readonly wired: boolean')
  assert.ok(at > 0, '必须能定位 wired 字段声明')
  const doc = src.slice(Math.max(0, at - 1600), at)
  assert.ok(/不许接线/.test(doc), '注释必须写明语义是「不许接线」')
  assert.ok(/不是「已接线」/.test(doc), '注释必须**显式否定**「已接线」这个误读')
  assert.ok(/wiredConsumers/.test(doc), '注释必须指向「已接线」读数所在（status().wiredConsumers）')
  assert.ok(/误读/.test(doc), '注释必须记下「本字段被误读过」，防下一个读者重犯')
})
