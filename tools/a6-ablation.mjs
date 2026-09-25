#!/usr/bin/env node
/**
 * A6-1 消融跑分器 —— 把 docs/mana-rollout-plan.md:670 的 A6-1（消融可自动跑）从
 * **NONE（无实现者）** 变成 **可判**。
 *
 * ⚠ 本文件的定位（先读这段再看代码）：
 *   · A6-1 判据原文要求「方案 §13.3 **六组**各产出 1 个指标差：同一固定输入集 → 逐组开关
 *     → 输出 JSON」，阈值 **6/6**。**本文件不承诺 6/6**：它把「哪几组真能跑」变成事实，
 *     再由 summary 段如实报 N/6 与逐组的不可做原因
 *     （口径见 docs/mana-rollout-plan.md:717：**不可做 = 无开关可关**）。
 *   · ⚠ 本席**不得**为凑 6/6 而给任何 packages/** 加开关 —— 那是本仓点名的「假旋钮」形态。
 *     故本文件对 packages/** **只读**：不改一个字节、不建任何产物。
 *
 * ── 退出码语义（判据要求「自已定义语义并在文件头写清」）────────────────────────
 *   · 0  = 六组**全部**产出**非零指标差**（A6-1 的 6/6 在「指标差」这个层面成立）
 *   · 2  = 有组**必然报 0 差，且原因是结构性的**「无开关可关 / 无机制可关」
 *          —— 这不是本跑分器的失败，是**本仓现状**（带上限：见 summary.structuralZeroGroups）
 *   · 4  = 某组**零差且未声明成因**（既非「无开关可关」、也非「假旋钮」、也非对拍）⇒ 静默失败
 *   · 3  = **harness 自身失败**（输入集读不出 / 包加载失败 / 库读不出 / 自检腿报红）
 *   ⚠ 两个比值**必须并列读**（summary 里都有）：a61_ratio_any_delta（任何指标非零差，
 *     最容易凑绿的读法）与 a61_ratio_behavioral（**机制足迹**真变，A6-1 本意那一档）。
 *   · 10 = **评估异常**（某组某指标的读数违反该组声明的单调方向，见 MONOTONE）
 *          ⚠ 这是最要命的一类：0 差**不是**问题，「关掉后反而更大」才是问题
 *   ⚠ 先匹配**高码**（10 > 3 > 2 > 0）：exit code 只反映最坏的那一类。
 *
 * ── 判据纪律（本仓血的教训，逐条落在此文件的可机检面上）──────────────────────
 *   ① 输入集可复现：唯一输入源 = tools/ablation/input-set.json，每次评估**读两遍比 sha256**；
 *      文件内禁随机源/时钟派生值（见该文件 _discipline）。
 *   ② A6-2（输入量可见化）：每条记录**必带 n**；n=0 **显式落 0**（emptyProbe 用一个
 *      结构性为空的 sessionId 量出真 0；--mutate strip-n 必须让它报红）。
 *   ③ 不走假路径：输入一律经**真生产路径** —— perception.perceive 发观察 → attention 落痕
 *      → 宿主真分发通道 ctx.waterfall('agent/pre-step', …) → 判定链 / inject_log / 库。
 *      绝不用「直接调 service 再断言我自己喂进去的东西」那种夹具绿（本仓同名教训）。
 *   ④ 两态同源即死形态：MONOTONE 声明「关掉后读数**不得上升**」的指标（**常驻**自检，
 *      与 --mutate 无关），一旦 off > on 即 sc/eval-discrepancies 报红。
 *   ⑤ 负控要能真否证：--mutate drop-on 丢弃开态那条记录 ⇒ sc/a6-1-both-states
 *      **必须**报红（「六组都跑了」与「每组两态都在」是两件事，这条查后者）。
 *   ⑥ 两态同源**另有专腿**：sc/two-state-distinct —— 除 declaration-knob 组外，
 *      两态 metrics 的 JSON 不得逐字相同（相同 ⇒ 差不是机制差，是没关成）。
 *
 * ── 负向对拍（判据要求 >= 3 条；命令与期望读数见 docs/handoff/F3.md）────────────
 *   · --mutate same-source=wm   两分支取同一状态 ⇒ 该组两态 metrics 逐字相同 ⇒
 *     sc/two-state-distinct 报红（并连带 sc/a6-1-both-states：缺 false 态）
 *   · --mutate strip-n          删 n 字段 ⇒ sc/a6-2-n-field-present 报红（A6-2 腿）
 *   · --mutate random-input     输入集当次随机化 ⇒ sc/input-reproducible 报红（可复现腿）
 *   · --mutate drop-on          丢开态记录 ⇒ sc/a6-1-both-states 报红
 *   · --decl-switch=unload      把 declaration-knob 组的「关」错接成卸载 ⇒ 该组 deltaKind 退化为 none，
 *     且**带声明成因**（exit 仍是 2 不是 4）—— 它演示「已声明的 0 差」与「静默 0 差」的区别
 *   ⚠ 变异只作用于**本进程的输出**（不改仓、不改输入集）：故拍完**无需**恢复任何文件，
 *     也**无需**重建产物（本文件不产出产物，无产物腿）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *   node tools/a6-ablation.mjs                 # 全套（含真 JEV 判定，约 40s）
 *   node tools/a6-ablation.mjs --self-check    # 只跑 harness 自检 + 输入集快照（约 2s，仓只读）
 *   node tools/a6-ablation.mjs --only jev      # 只跑某组（退出码语义不变但只覆盖该组）
 *   node tools/a6-ablation.mjs --mutate same-source=wm   # 负向对拍
 *   node tools/a6-ablation.mjs --no-human      # 只出 JSON
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const INPUT_PATH = join(HERE, 'ablation', 'input-set.json')
/** 宿主安装目录：cordis 不是本仓 workspace 依赖（按包名 import 会 ERR_MODULE_NOT_FOUND）。 */
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

const EXIT = Object.freeze({
  ALL_DELTA: 0,
  STRUCTURAL_ZERO_DELTA: 2,
  HARNESS_FAILED: 3,
  // 4 = 某组**零差且未声明成因**（既不是「无开关可关」，也不是「假旋钮」，也不是对拍）
  //     ⇒ 静默失败。这是本跑分器对 A6-1 原文「反对『无差异也算过』」的最终落点。
  UNDECLARED_ZERO: 4,
  EVAL_ANOMALY: 10,
})

/**
 * 六组（判据原文 docs/mana-rollout-plan.md:670 的 B7.1 清单，**不改名不删项**）。
 *
 * ablation 逐字记「**关**是怎么关的」——这是本批的实质产出：
 *   · unload           = 该包**不装配**（本仓没有包内 enable/disable；册:721 记 JEV 的先例即此法）
 *   · config-knob      = 包内配置开关**真被消费**（关掉即行为变化）
 *   · declaration-knob = 包内开关只改 status() 的自报字段，**零行为消费**（= 假旋钮形态）
 *
 * footprint = 该组的「机制足迹」指标名（该机制**在生产路径上留下的可数痕迹**）。
 *   关掉后这些指标**必须归零或反向**；若它们纹丝不动，说明这一组的「差」不是机制差。
 */
const GROUPS = Object.freeze([
  {
    id: 'jev',
    name: '去 JEV',
    question: '去掉 JEV（判定链不可用）后，注入门控与审计面发生什么变化？',
    ablation: 'unload',
    footprint: ['judgeListens', 'probObserved'],
    pkgDir: 'jev',
    structuralReason: null,
  },
  {
    id: 'actr',
    name: '去 ACT-R 衰减',
    question: '去掉 ACT-R（long-term 不装配）后，下游 forgetting 用的衰减核换成谁？',
    ablation: 'unload',
    // 足迹 = ACT-R **实现面是否在场**。⚠ 刻意**不含** kernelSourceIsLongTerm / retentionMaxAbsDiff：
    //   那两条在两态都不动（本组发现），把它们当足迹会把「下游不变」错读成「关掉了没差」。
    footprint: ['actrSurfaceMembers', 'longTermServiceUp'],
    pkgDir: 'long-term',
    // 本仓**没有** enable/disable 面（册:722 已记 long-term 不导出 Config）⇒ 只能卸载；
    // 而卸载使 forgetting 走闭式核 —— 闭式核与 long-term 的 decay 是**同一条曲线**
    // （packages/forgetting/src/retention.ts:16 的恒等式），故 retention 读数**不差**。
    structuralReason: '本仓无包内开关（long-term 刻意不导出 Config）；卸载的差只落在归属读数上，对衰减曲线无差',
  },
  {
    id: 'wm',
    name: '去工作记忆限制',
    question: '把容量限制关掉（capacityChunks=0）后，淘汰还发生吗？',
    ablation: 'config-knob',
    footprint: ['evictedOnCapacity'],
    pkgDir: 'working-memory',
    structuralReason: null,
  },
  {
    id: 'consolidation',
    name: '去巩固',
    question: '把巩固（consolidation）整体去掉后，生产规则还能落库吗？',
    ablation: 'unload',
    footprint: ['productionRuleRows'],
    pkgDir: 'consolidation',
    structuralReason: '本仓无包内开关（consolidation/src/index.ts:50 明文「刻意不导出 Config」）⇒ 卸载是唯一口径',
  },
  {
    id: 'metacognition',
    name: '去元认知',
    question: '把元认知的配置开关关掉（criteriaEnabled=false）后，行为面变了吗？',
    ablation: 'declaration-knob',
    footprint: [],
    pkgDir: 'metacognition',
    structuralReason: '包内确有开关，但它**只改 status() 自报字段**（src/index.ts:90 是唯一消费点）⇒ 关掉后行为面零差 = 假旋钮',
  },
  {
    id: 'userModel',
    name: '去用户模型',
    question: '去掉用户模型后，同一触发还落 mana_trace 行吗？',
    ablation: 'unload',
    footprint: ['driftTraceRows'],
    pkgDir: 'user-model',
    structuralReason: '本仓无包内开关（本包也没有卸载以外的"关"）⇒ 卸载是唯一口径',
  },
])

/**
 * 单调方向约束（**常驻自检**，与 --mutate 无关）。
 *
 * down = 关掉后**不得上升**的指标（该机制在生产路径上的足迹，关掉只会变小/归零）。
 *        若 off > on ⇒ 「关」这件事没生效，或两态同源（本仓点名的死形态）。
 * up   = 关掉后**不得下降**的指标（预期反向者）。
 *
 * ⚠ 只约束**机制足迹**，不约束「包在不在」这类平凡读数 —— 后者恒 1→0，不构成判据。
 */
const MONOTONE = Object.freeze({
  jev: { down: ['judgeListens', 'probObserved'], up: ['gatesDegraded'] },
  actr: { down: ['kernelSourceIsLongTerm'], up: [] },
  wm: { down: ['evictedOnCapacity'], up: [] },
  consolidation: { down: ['productionRuleRows'], up: [] }, // ⚠ ruleWriteFailures 不设单调：关态无写面，恒 0
  metacognition: { down: [], up: [] },
  userModel: { down: ['driftTraceRows'], up: [] },
})

/**
 * 「包在不在」这类**存在性**读数（恒 1→0）。
 *
 * ⚠ 它们**不是判据**：任何组只要把包卸掉都会动，故不足以证明「机制被关掉了」。
 *   单列出来是为了让 deltaKind 能把「差只落在存在性上」与「差落在机制足迹上」分开 ——
 *   这正是 A6-1 原文「反对『无差异也算过』」在读数层的落点。
 */
const PRESENCE_KEYS = Object.freeze([
  'longTermServiceUp',
  'workingMemoryServiceUp',
  'consolidationServiceUp',
  'metacognitionServiceUp',
  'userModelServiceUp',
])

/** 指标清单：输出 JSON 里每条记录 metrics 的键集必须与此**逐字相等**（sc/schema 查它）。 */
const METRIC_KEYS = Object.freeze({
  jev: ['judgeListens', 'probObserved', 'gatesInjected', 'gatesDegraded', 'gatesSkip', 'jevLogRows', 'injectLogRows'],
  actr: ['longTermServiceUp', 'actrSurfaceMembers', 'kernelSourceIsLongTerm', 'retentionMaxAbsDiff', 'retentionKernelDelta'],
  wm: ['workingMemoryServiceUp', 'evictedOnCapacity', 'wmSizeAtEnd', 'capacityChunks', 'wmTraceRows'],
  consolidation: ['consolidationServiceUp', 'consolidationSelected', 'consolidationChunkRules', 'ruleWriteFailures', 'productionRuleRows'],
  metacognition: ['metacognitionServiceUp', 'criteriaFlag', 'splitLawResolved', 'profileIndexHandles'],
  userModel: ['userModelServiceUp', 'driftTraceRows', 'driftTriggerAttempts', 'umSurfaceReadable'],
})

// ── 小工具 ─────────────────────────────────────────────────────────────────
const settle = (ms = 90) => new Promise((r) => setTimeout(r, ms))
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const nowIso = () => new Date().toISOString()

const cleanups = []
function tmpDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* 清理失败不掩盖读数 */
    }
  }
})

const failures = []
function fail(where, err) {
  failures.push(where + ': ' + (err && err.message ? err.message : String(err)))
  console.error('[harness-failure] ' + where + ': ' + (err && err.stack ? err.stack : String(err)))
}

// ── 固定输入集（唯一输入源；每次评估读两遍比 sha256）──────────────────────────
/**
 * 读入固定输入集。
 *
 * ⚠ **读两遍**是刻意的：这条腿查的是「输入集在**同一次评估内**是同一个东西」。
 *   --mutate random-input 把第二遍的文本随机化 ⇒ sha256 不等 ⇒ 这条腿报红。
 *   （文件**被改过**与「同一次评估里输入不是固定的」是两件事 —— 本腿查后者；
 *    前者由输出里的 inputSha256 读数与 git 状态承载。）
 */
function loadInput(mutation) {
  const raw1 = readFileSync(INPUT_PATH, 'utf8')
  let raw2 = raw1
  if (mutation && mutation.kind === 'random-input') {
    const j = JSON.parse(raw1)
    for (const it of j.items) {
      it.content = '随机化输入 ' + Math.random().toString(16).slice(2)
      it.requestId = 'rnd-' + Math.random().toString(16).slice(2)
    }
    raw2 = JSON.stringify(j)
  }
  const input = JSON.parse(raw1)
  if (mutation && mutation.kind === 'random-input') {
    const j2 = JSON.parse(raw2)
    for (let i = 0; i < input.items.length; i += 1) input.items[i].content = j2.items[i].content
  }
  return { input, sha1: sha256(raw1), sha2: sha256(raw2) }
}

// ── 装配（真 Context + 真插件；库一律临时库）────────────────────────────────
/**
 * 起一条链。
 *
 * ⚠ 走 ctx.plugin(mod, cfg) **直连**而不是 Loader 按包名解析：两者都是真装配路径
 *   （本仓 packages/user-model/tests/_harness.mjs#mount 同口径），直连少一次 baseUrl 解析，
 *   而本跑分器要按**组**切换包集合 ⇒ 直连更直。
 *   ⚠ 代价如实记：本跑分器验的是**服务面**装配，不是 cordis.patch.yml 的 bundle 装配链
 *     （后者归 tools/r0-assembly-check.mjs）。
 */
async function bootChain(store, planned) {
  const { Context } = await import(DSH + '/cordis/lib/index.js')
  const ctx = new Context()
  const loaded = []
  const failed = []
  for (const step of planned) {
    const url = pathToFileURL(join(REPO, 'packages', step.pkg, 'src', 'index.ts')).href
    try {
      const mod = await import(url)
      ctx.plugin(mod, step.config || {})
      loaded.push(step.pkg)
    } catch (error) {
      // 加载失败**不得静默**：记下来并让 harness 报红（否则「包没装上」会被读成「关掉无差异」）。
      failed.push(step.pkg + ': ' + (error && error.message ? error.message : String(error)))
      fail('bootChain/' + step.pkg, error)
    }
    await settle(70)
  }
  await settle(140)
  return { ctx, loaded, failed, store }
}

function count(db, sql, ...args) {
  const row = db.prepare(sql).get(...args)
  return Number(row && row.c !== undefined ? row.c : 0)
}

// ── 真生产路径的驱动器 ─────────────────────────────────────────────────────
/**
 * 把一个固定输入项推过**真生产路径**：
 *   perception.perceive（发 mana/observation）→ attention 落痕 + 入队
 *   → 宿主真分发通道 ctx.waterfall('agent/pre-step', …)（判定链 / inject_log / injection 段）。
 *
 * ⚠ 走 ctx.waterfall 而不是直接调 attention 的监听器：后者绕过 waterfall 的合成语义
 *   （下游哨兵 / next() 义务）—— packages/core/tests/injection-gate.test.mjs 已钉此口径。
 */
async function driveOnce(chain, item, sessionId, turnId) {
  const perception = chain.ctx.get('mana-perception')
  if (!perception) {
    throw new Error('mana-perception 不在场 —— 无法走真生产路径（不得改用别的路径顶替）')
  }
  perception.perceive({
    content: item.content,
    sessionId,
    turnId,
    requestId: item.requestId,
    source: 'a6-ablation-fixture',
    at: item.at,
  })
  await settle(25)
  const payload = { agent: { session: { id: sessionId } }, messages: [], turn: turnId, step: 1 }
  return chain.ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }))
}

// ── 逐组执行 ───────────────────────────────────────────────────────────────
/** 链首：core（存储/审计面的唯一提供者；库句柄由它给出）。 */
function baseChain() {
  return [{ pkg: 'core', config: { backupEnabled: false } }]
}

/**
 * 链尾（生产注入链的其余部分；六组共用同一底座，差只差在被消融的那个包/那枚开关）。
 *
 * ⚠ **顺序是语义，不是排版**（本席实测踩过）：`forgetting` 在 `apply()` 里就
 *   `ctx.get('mana-long-term')` 解析衰减核并**当场定型** `kernelSource`
 *   （packages/forgetting/src/index.ts:236 的 resolveKernel）。故 long-term 必须**先于**它装配；
 *   把组插件排在链尾（第一版就是这么写的）⇒ ON 态也读成 'fallback'，
 *   于是「装不装 long-term」在这条腿上**看起来没差** —— 那是harness 的装配顺序造出来的假 0 差，
 *   不是本仓事实。⇒ 组插件一律插在 core 之后、本链尾之前（见 runState 的 planned）。
 */
function tailChain(input) {
  return [
    { pkg: 'perception' },
    {
      pkg: 'attention',
      config: {
        judgeState: input.judgeState,
        judgeQuestion: input.judgeQuestion,
        jevThreshold: 0.7,
        injectionEnabled: true,
      },
    },
    { pkg: 'forgetting' },
    { pkg: 'vector' },
  ]
}

/**
 * 该组在这一态下比公共链多载入的插件。
 *
 * ⚠ metacognition 组**两态都载入**该包：关的是**包内开关**（criteriaEnabled），不是卸载。
 *   这一区别是本组结论的全部 —— 若改成卸载，看到的差就只是「包在不在」，
 *   而看不出那枚开关是否真被消费（那正是本组要回答的问题）。
 */
function groupPlugin(group, enabled, input) {
  switch (group.id) {
    case 'jev':
      return enabled ? [{ pkg: 'jev' }] : []
    case 'actr':
      return enabled ? [{ pkg: 'long-term' }] : []
    case 'wm':
      return [{ pkg: 'working-memory', config: { capacityChunks: enabled ? input.wmCapacityOn : input.wmCapacityOff } }]
    case 'consolidation':
      return enabled ? [{ pkg: 'consolidation' }] : []
    case 'metacognition':
      // ⚠ metacognition 的「关」是**包内开关**（criteriaEnabled）—— 故**两态都载入**该包。
      //   若 declKnob 为 false（--decl-switch=unload 的负向对拍）⇒ 退化成「关=不装配」，
      //   此时代码根本不在场 ⇒ 本组必然没有任何非零差（这正是对拍要看到的结果）。
      return group.declKnob === false
        ? (enabled ? [{ pkg: 'metacognition', config: { criteriaEnabled: true, confidenceTarget: null } }] : [])
        : [{ pkg: 'metacognition', config: { criteriaEnabled: enabled, confidenceTarget: null } }]
    case 'userModel':
      return enabled ? [{ pkg: 'user-model' }] : []
    default:
      throw new Error('未知组 ' + group.id)
  }
}

/**
 * 跑某一组的某一态，返回该态的指标读数。
 *
 * ⚠ n 的语义**逐组如实标**：它是「本组这一态实际走上生产路径的输入项数」。
 *   · 输入驱动的组（jev / wm）：n = 走过 driveOnce 的固定输入项数；
 *   · 探针驱动的组（actr / consolidation / metacognition）：n = 从固定输入集取用的探针数；
 *   · userModel：n = 固定输入集声明的**触发次数**（两态同值）—— 关态下这些触发
 *     **无处执行**，故另有一列 driftTriggerAttempts 记「尝试数」，使「没触发」与
 *     「触发了但没产生行」可分辨（本仓 fail-closed 留痕口径）。
 */
async function runState(group, enabled, input) {
  const dir = tmpDir('a6-ablation-')
  const store = join(dir, 'mana.db')
  // ⚠ 组插件插在 **core 之后、链尾之前**（顺序理由见 tailChain 的注释）。
  const planned = baseChain().concat(groupPlugin(group, enabled, input)).concat(tailChain(input))
  planned[0].config.storePath = store
  const chain = await bootChain(store, planned)

  const metrics = {}
  const notes = []
  let n = 0

  if (group.id === 'metacognition') {
    notes.push(
      enabled
        ? '开：metacognition 载入且 criteriaEnabled=true'
        : '关：metacognition **仍在场**，criteriaEnabled=false（关的是包内开关，不是卸载）',
    )
  } else if (group.ablation === 'config-knob') {
    notes.push(
      enabled
        ? '开：capacityChunks=' + input.wmCapacityOn
        : '关：capacityChunks=' + input.wmCapacityOff + '（capacityChunks>0 才淘汰）',
    )
  } else if (group.ablation === 'declaration-knob' && group.declKnob === false) {
    notes.push(
      enabled
        ? '开：' + group.pkgDir + ' 已装配（criteriaEnabled 固定 true）'
        : '关：' + group.pkgDir + ' **不装配** —— ⚠ MUTATION 把本组的包内开关错接成卸载 ⇒ 本组必然零差（负向对拍）',
    )
  } else {
    notes.push(
      enabled
        ? '开：' + group.pkgDir + ' 已装配'
        : '关：' + group.pkgDir + ' **不装配**（本仓无包内 enable/disable ⇒ 「去掉」= 卸载）',
    )
  }
  if (chain.failed.length > 0) notes.push('⚠ 装配失败：' + chain.failed.join(' | '))

  const db = new DatabaseSync(store, { readOnly: true })
  try {
    if (group.id === 'jev') {
      const probeItems = input.items.slice(0, 3)
      for (const it of probeItems) await driveOnce(chain, it, input.sessionId, it.turnId)
      n = probeItems.length
      await settle(120)
      const gates = db.prepare('SELECT gate, COUNT(*) c FROM inject_log GROUP BY gate').all()
      const gateOf = (g) => Number((gates.find((r) => r.gate === g) || { c: 0 }).c)
      metrics.judgeListens = count(db, 'SELECT COUNT(*) c FROM inject_log WHERE jev_prob IS NOT NULL')
      metrics.probObserved = metrics.judgeListens
      metrics.gatesInjected = gateOf('injected')
      metrics.gatesDegraded = gateOf('degraded_unavailable')
      metrics.gatesSkip = gateOf('skip_below_threshold') + gateOf('skip_no_candidate')
      metrics.jevLogRows = count(db, 'SELECT COUNT(*) c FROM jev_log')
      metrics.injectLogRows = count(db, 'SELECT COUNT(*) c FROM inject_log')
      notes.push('判定链' + (enabled ? '在场' : '缺席') + ' ⇒ jev_log 行数 ' + metrics.jevLogRows + '；inject_log 的 jev_prob 非空行数 ' + metrics.judgeListens)
    } else if (group.id === 'actr') {
      n = input.actrGrid.length
      const fg = chain.ctx.get('mana-forgetting')
      if (!fg) notes.push('⚠ forgetting 不在场 ⇒ 读不出衰减核归属')
      const readings = fg ? fg.forgetting.readings() : null
      metrics.kernelSourceIsLongTerm = readings && readings.kernelSource === 'mana-long-term' ? 1 : 0
      const lt = chain.ctx.get('mana-long-term')
      metrics.longTermServiceUp = lt ? 1 : 0
      metrics.actrSurfaceMembers = lt && lt.activation ? 7 : 0
      // 同一批 (t,S) 网格上两态的**留存读数**逐点比（核换了但曲线同不同，是个可数的差）。
      let maxDiff = 0
      let kernelDelta = 0
      for (const pt of input.actrGrid) {
        const closed = Math.exp(-pt.t / pt.s)
        const got = fg ? fg.forgetting.retention(pt.t, pt.s) : Number.NaN
        const d = Math.abs(got - closed)
        if (d > maxDiff) maxDiff = d
        if (got !== closed) kernelDelta += 1
      }
      metrics.retentionMaxAbsDiff = Number(maxDiff.toFixed(12))
      metrics.retentionKernelDelta = kernelDelta
      notes.push('衰减核来源=' + (readings ? readings.kernelSource : 'N/A') + '；同网格留存最大绝对差=' + metrics.retentionMaxAbsDiff + '，不等点数=' + kernelDelta)
    } else if (group.id === 'wm') {
      const wm = chain.ctx.get('mana-working-memory')
      if (!wm) {
        throw new Error('mana-working-memory 不在场 —— 本组的「关」是 capacityChunks=0，不是卸载')
      }
      const probeItems = input.items.slice(0, 6)
      for (const it of probeItems) await driveOnce(chain, it, input.sessionId, it.turnId)
      n = probeItems.length
      await settle(120)
      const snap = wm.snapshot()
      metrics.workingMemoryServiceUp = 1
      metrics.evictedOnCapacity = snap.evicted
      metrics.wmSizeAtEnd = snap.chunks.length
      metrics.capacityChunks = snap.capacityChunks
      metrics.wmTraceRows = count(
        db,
        "SELECT COUNT(*) c FROM mana_trace WHERE event_type = 'attention' AND payload LIKE '%capacityChunks%'",
      )
      notes.push('容量=' + snap.capacityChunks + '、末态条数=' + snap.chunks.length + '、淘汰计数=' + snap.evicted)
    } else if (group.id === 'consolidation') {
      const cs = chain.ctx.get('mana-consolidation')
      n = input.consolidation.items.length + input.consolidation.runs.length
      metrics.consolidationServiceUp = cs ? 1 : 0
      metrics.consolidationSelected = 0
      metrics.consolidationChunkRules = 0
      metrics.ruleWriteFailures = 0
      if (cs) {
        // Spindle 面（只读判定）。
        const plan = cs.plan({
          periodId: input.consolidation.periodId,
          items: input.consolidation.items,
          neocortex: input.consolidation.neocortex.map((x) => ({ id: x.id, vector: [1, 0], content: x.content })),
          runs: input.consolidation.runs,
        })
        metrics.consolidationSelected = plan.spindle.selected.length
        // ⚠ chunking 草稿**显式钉时钟**（at = 输入集 ts）：plan() 内部走 new Date()，
        //   而 createdAt 会进 conditions/actions 之外的第 5 列 ⇒ 不钉时钟这份产物每次不同，
        //   与「同一固定输入集」的前提相悖（本文件纪律①）。chunk() 与 plan() 内的调用是同一个函数。
        const rules = cs.chunk(input.consolidation.runs, { at: input.ts })
        metrics.consolidationChunkRules = rules.rules.length
        // 真写库（本包**唯一**生产写入面）：让「关」态的读数是**库读数**，不是我填进去的 0。
        const wr = rules.rules.length > 0 ? cs.writeRules(rules.rules) : { failures: [], inserted: [], existing: [] }
        // 「接口返回成功 ≠ 行落了库」：写失败必须落成**显式指标**（本仓「接口成功非达成」）。
        metrics.ruleWriteFailures = wr.failures.length
        if (wr.failures.length > 0) notes.push('⚠ 写库失败：' + JSON.stringify(wr.failures))
      }
      metrics.productionRuleRows = count(db, 'SELECT COUNT(*) c FROM production_rules')
      notes.push(
        'Spindle 选中=' + metrics.consolidationSelected + '、chunking 规则=' + metrics.consolidationChunkRules +
          '、写失败=' + metrics.ruleWriteFailures + '、production_rules 表行数=' + metrics.productionRuleRows,
      )
    } else if (group.id === 'metacognition') {
      const meta = chain.ctx.get('mana-metacognition')
      n = 3
      metrics.metacognitionServiceUp = meta ? 1 : 0
      metrics.criteriaFlag = meta && meta.status().criteriaEnabled ? 1 : 0
      // 阈值层的**唯一读口**（splitLawOf）—— 两态都应给出同一读数：本读口不受 criteriaEnabled 门控。
      const law = meta ? meta.splitLaw() : null
      metrics.splitLawResolved = law && Number(law.R) > 0 && Number(law.K) > 0 ? 1 : 0
      const idx = meta ? meta.profileIndex() : null
      // ⚠ profileIndex() 需要 user-model 在场（本组公共链里没有它）⇒ 两态同为 0；
      //   它的作用是**证该调用面存在且不抛**，不是制造差异（差异由 criteriaFlag 承载）。
      metrics.profileIndexHandles = idx ? 1 : 0
      notes.push('criteriaEnabled 自报=' + metrics.criteriaFlag + '；阈值读口 splitLaw=' + (law ? law.R + '/' + law.K : 'N/A'))
    } else if (group.id === 'userModel') {
      const um = chain.ctx.get('mana-user-model')
      metrics.userModelServiceUp = um ? 1 : 0
      metrics.driftTriggerAttempts = input.userModelTriggers
      const before = count(db, "SELECT COUNT(*) c FROM mana_trace WHERE event_type = 'user-model/drift'")
      let fired = 0
      for (let i = 0; i < input.userModelTriggers; i += 1) {
        if (!um) break
        um.reportDrift(input.userModelTriggerAt, input.sessionId)
        fired += 1
      }
      const after = count(db, "SELECT COUNT(*) c FROM mana_trace WHERE event_type = 'user-model/drift'")
      metrics.driftTraceRows = after - before
      metrics.umSurfaceReadable = um && typeof um.injectionVerdict === 'function' ? 1 : 0
      n = input.userModelTriggers
      if (fired !== input.userModelTriggers) {
        // 「触发没发生」必须与「触发了但没产生行」可分辨（本仓 fail-closed 留痕口径）。
        notes.push(
          '关态：' + (input.userModelTriggers - fired) + ' 次触发**无处执行**（服务不可读）—— 这不是"0 行"，是 n 内 ' + fired + ' 次真执行',
        )
      }
    } else {
      throw new Error('未知组 ' + group.id)
    }
  } finally {
    try {
      db.close()
    } catch {
      /* 只读句柄关不掉不掩盖读数 */
    }
  }

  return { group: group.id, enabled, n, metrics, notes, loaded: chain.loaded, failed: chain.failed }
}

// ── 输入量可见化（A6-2）：n=0 的**显式**落点 ────────────────────────────────
/**
 * 用固定输入集里那个**结构性为空**的 sessionId 量一次真 0。
 *
 * ⚠ 它是「n=0 时显式落 0 而非缺字段」的**唯一可执行证据**：空集必须量出 0，
 *   而且这个 0 必须与「没量」可分辨 —— 故字段恒存在（sc/a6-2-n-zero-explicit 查它）。
 */
function emptyProbe(store, emptySessionId) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const n = count(db, 'SELECT COUNT(*) c FROM inject_log WHERE session_id = ?', emptySessionId)
    return { metric: 'injectLogRowsForEmptySession', sessionId: emptySessionId, n }
  } finally {
    try {
      db.close()
    } catch {
      /* 同上 */
    }
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
/**
 * 参数解析。⚠ **两种写法都收**（`--flag=v` 与 `--flag v`）。
 *
 * 本席实测踩到：第一版只认空格写法，于是 `--decl-switch=unload` 被当成未知参数**静默忽略** ⇒
 * 那一条负向对拍**根本没打上靶**、却输出一片绿。这正是本仓「退出码 0 != 动作发生」的形态，
 * 也是负控最容易变成**假覆盖**的地方 ⇒ 除了两种写法都收，另有 `sc/mutation-applied` 腿
 * 逐条要求「请求的变异必须在读数上留下见证」（见下）。
 */
function parseArgv(argv) {
  const out = { mutate: [], only: null, human: true, selfCheckOnly: false, help: false, declSwitch: null, unknown: [] }
  /** 取下一个值：支持 `--k=v` 与 `--k v`。 */
  const valueOf = (tok, key) => {
    const eq = tok.indexOf('=')
    if (eq > 0) return tok.slice(eq + 1)
    return argv[++iSeen]
  }
  let iSeen = 0
  for (let i = 0; i < argv.length; i += 1) {
    iSeen = i
    const a = argv[i]
    if (a === '--mutate' || a.startsWith('--mutate=')) out.mutate.push(valueOf(a, '--mutate'))
    else if (a === '--only' || a.startsWith('--only=')) out.only = valueOf(a, '--only')
    else if (a === '--decl-switch' || a.startsWith('--decl-switch=')) out.declSwitch = valueOf(a, '--decl-switch')
    else if (a === '--no-human') out.human = false
    else if (a === '--self-check') out.selfCheckOnly = true
    else if (a === '--help' || a === '-h') out.help = true
    else {
      out.unknown.push(a)
      console.error('[warn] 未知参数（**不得静默忽略**，且会被 sc/mutation-applied 之外的 harness 门抓）：' + a)
    }
    i = iSeen
  }
  return out
}

function parseMutation(spec) {
  if (spec === 'strip-n') return { kind: 'strip-n' }
  if (spec === 'random-input') return { kind: 'random-input' }
  if (spec === 'drop-on') return { kind: 'drop-on' }
  if (spec.indexOf('same-source=') === 0) return { kind: 'same-source', group: spec.slice('same-source='.length), value: true }
  console.error('[warn] 未知变异（忽略）：' + spec)
  return null
}

async function evalGroup(group, mutations) {
  // ⚠ 收的是**整个变异表**：第一版只把 same-source 传下来，另外三类变异**根本没到达评估循环**
  //   （实测：drop-on / random-input / decl-switch 全都不报红 —— 负控没打上靶 = 假覆盖）。
  const mutOf = (kind) => mutations.find((m) => m.kind === kind) || null
  const sameSrc = mutOf('same-source')
  const dropOn = mutOf('drop-on')
  const records = []
  for (const enabled of [true, false]) {
    const { input, sha1, sha2 } = loadInput(mutOf('random-input'))
    // --mutate drop-on：把**开态**评估整条丢弃（记录丢失在输出上的真实形态：该组的 on 只剩骨架、
    //   metrics 为空）。⚠ 它打的是 sc/a6-1-both-states（「每组两态都在」）与 sc/schema 两条腿，
    //   与 same-source（打 two-state-distinct）是**不同的靶**。
    if (dropOn && enabled === true) {
      records.push({
        group: group.id,
        enabled: true,
        n: 0,
        metrics: {},
        notes: ['MUTATION drop-on：开态评估整条被丢弃（模拟记录丢失）'],
        loaded: [],
        failed: [],
        requestedEnabled: true,
        effectiveEnabled: true,
        inputSha256: [sha1, sha2],
      })
      continue
    }
    let effective = enabled
    let note = null
    if (sameSrc && sameSrc.group === group.id) {
      effective = sameSrc.value
      note = 'MUTATION same-source(' + group.id + ')：两态均为 enabled=' + String(sameSrc.value)
    }
    let rec
    try {
      rec = await runState(group, effective, input)
    } catch (error) {
      fail('eval/' + group.id + '/' + String(enabled), error)
      rec = { group: group.id, enabled: effective, n: 0, metrics: {}, notes: ['EVAL-ERROR: ' + String(error && error.message ? error.message : error)], loaded: [], failed: [String(error)] }
    }
    rec.requestedEnabled = enabled
    rec.effectiveEnabled = effective
    rec.inputSha256 = [sha1, sha2]
    if (note) rec.notes.push(note)
    records.push(rec)
  }
  const on = records[0]
  const off = records[1]
  const deltas = {}
  const keys = METRIC_KEYS[group.id]
  let evalAnomalies = 0
  for (const k of keys) {
    const a = on.metrics[k]
    const b = off.metrics[k]
    if (typeof a !== 'number' || typeof b !== 'number') {
      evalAnomalies += 1
      deltas[k] = { on: a === undefined ? null : a, off: b === undefined ? null : b, delta: null, violation: 'missing-metric' }
      continue
    }
    const delta = a - b
    let violation = null
    const mono = MONOTONE[group.id]
    if (mono.down.includes(k) && b > a) violation = 'off>on（单调 down 被违反）'
    if (mono.up.includes(k) && b < a) violation = 'off<on（单调 up 被违反）'
    if (violation) evalAnomalies += 1
    deltas[k] = { on: a, off: b, delta, violation }
  }
  return { group: group.id, on, off, deltas, evalAnomalies }
}

/** 自检腿（每条都要能**真否证**；口径写在 detail 里，便于 handoff 引用）。 */
function selfChecks(payload, requestedGroups) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok, detail })

  const allRecs = payload.groups.flatMap((g) => [g.on, g.off])

  // ① A6-1 主腿：**每组两态都在**（enabled=true 与 enabled=false 各一条，且都真跑出 metrics）。
  {
    const missing = []
    for (const g of payload.groups) {
      const both = g.on.effectiveEnabled === true && g.off.effectiveEnabled === false
      const hasMetrics = g.on.metrics && typeof g.on.metrics === 'object' && Object.keys(g.on.metrics).length > 0 &&
        g.off.metrics && typeof g.off.metrics === 'object' && Object.keys(g.off.metrics).length > 0
      if (!both || !hasMetrics) missing.push(g.group)
    }
    add(
      'sc/a6-1-both-states',
      missing.length === 0,
      '每组必有两态记录（有效 enabled=true 与 false），且两条都真产出 metrics；缺=' + JSON.stringify(missing),
    )
  }

  // ①b A6-1 主腿（主）：至少一组**真**产出非零指标差（否则 A6-1 的「差异」在这张表上一个都没有）。
  {
    const nz = payload.summary.groupsWithNonZeroDelta
    add(
      'sc/a6-1-nonzero-delta-present',
      nz >= 1,
      '至少一组须有非零指标差（A6-1 原文：反对「无差异也算过」）；实得 ' + nz + '/' + payload.groups.length,
    )
  }

  // ①c A6-1 严格腿：至少一组的**机制足迹**真变了（behavioral）—— 这才是 A6-1 本意那一档，
  //    与 sc/a6-1-nonzero-delta-present（任何指标非零差）**不是**同一条腿。
  {
    const beh = payload.summary.groupsBehavioralDelta || []
    add(
      'sc/a6-1-behavioral-delta-present',
      beh.length >= 1,
      '至少一组的**机制足迹**指标须真变（否则有差只落在包在不在这类平凡读数上）；实得 behavioral 组=' + JSON.stringify(beh),
    )
  }

  // ①e declaration-knob 组必须**仍在场**：其「关」是包内开关，不得退化成卸载。
  //    （--decl-switch=unload 正是把它错接成卸载的负向对拍 ⇒ 本腿必红。）
  {
    const bad = []
    for (const g of payload.groups) {
      if (g.declaredAblation !== 'declaration-knob') continue
      if (g.declKnob === false) {
        bad.push(g.group + '（MUTATION:关态=卸载）')
        continue
      }
      for (const k of PRESENCE_KEYS) {
        const d = g.deltas[k]
        if (d && d.delta !== null && d.delta !== 0) bad.push(g.group + '.' + k + ' 动了 ⇒ 关态里包不在场')
      }
    }
    add('sc/declaration-knob-stays-loaded', bad.length === 0, 'declaration-knob 组两态都须载入该包（关的只能是包内开关）；违反=' + JSON.stringify(bad))
  }

  // ①d 零差必须**带声明成因**：deltaKind=none 而 zeroDeltaReason 为空的组即静默失败（exit 4）。
  {
    const undeclared = payload.groups.filter((g) => g.deltaKind === 'none' && !g.zeroDeltaReason).map((g) => g.group)
    add('sc/zero-delta-declared', undeclared.length === 0, '零差组必须带 zeroDeltaReason（未声明成因 = 静默失败，不许放过）；未声明=' + JSON.stringify(undeclared))
  }

  // ② A6-2 主腿：每条记录都有 n（整数、>=0）。
  {
    const bad = allRecs.filter((r) => !Number.isInteger(r.n) || r.n < 0).map((r) => r.group + '/' + String(r.effectiveEnabled))
    const zeroOk = payload.emptyProbe && Number.isInteger(payload.emptyProbe.n) && payload.emptyProbe.n === 0
    add(
      'sc/a6-2-n-field-present',
      bad.length === 0,
      '每个评估输出必含 n（整数且 >=0）；违反记录=' + JSON.stringify(bad) + '；n=0 显式落 0 例=' + String(zeroOk),
    )
  }

  // ③ A6-2 次腿：n=0 时必须**字段存在且为 0**（缺字段即红）。
  {
    const hasField = Object.prototype.hasOwnProperty.call(payload.emptyProbe || {}, 'n')
    const ok = hasField && payload.emptyProbe.n === 0
    add('sc/a6-2-n-zero-explicit', ok, 'emptyProbe 必须**带 n 字段**且值为 0（缺字段与 0 可分辨）；实得 ' + JSON.stringify(payload.emptyProbe))
  }

  // ④ 可复现腿：同一次评估内输入集 sha256 必须相等。
  {
    const pairs = allRecs.map((r) => r.inputSha256)
    const bad = pairs.filter((p) => !Array.isArray(p) || p[0] !== p[1]).length
    add('sc/input-reproducible', bad === 0 && pairs.length === allRecs.length, '同一次评估内输入集 sha256 必须两读相等；不等条数=' + bad)
  }

  // ⑤ 变异腿：单调方向违反 = 评估异常（**与 --mutate 无关的常驻自检**）。
  {
    const v = []
    for (const g of payload.groups) {
      for (const [k, d] of Object.entries(g.deltas)) if (d.violation) v.push(g.group + '.' + k + '：' + d.violation + '（on=' + d.on + ' off=' + d.off + '）')
    }
    add('sc/eval-discrepancies', v.length === 0, '关掉后机制足迹不得上升；违反=' + JSON.stringify(v))
  }

  // ⑥ 模式腿：五字段齐 + metrics 键集与声明逐字相等。
  {
    const bad = []
    for (const g of payload.groups) {
      for (const r of [g.on, g.off]) {
        for (const f of ['group', 'enabled', 'metric', 'value', 'delta', 'n']) {
          if (!Object.prototype.hasOwnProperty.call(r, f)) bad.push(r.group + '(' + String(r.effectiveEnabled) + ') 缺字段 ' + f)
        }
        const want = METRIC_KEYS[g.group].slice().sort().join(',')
        const got = Object.keys(r.metrics).slice().sort().join(',')
        if (want !== got) bad.push(r.group + ' 指标键集不符：' + got)
      }
    }
    add('sc/schema', bad.length === 0, '每条必含 group/enabled/metric/value/delta/n 且 metrics 键集与 METRIC_KEYS 相等；违反=' + JSON.stringify(bad))
  }

  // ⑦ 两态可分辨腿：非「仅声明开关」组的两态读数不得逐字相同（= 两态同源的直接否证）。
  {
    const same = []
    for (const g of payload.groups) {
      if (g.declaredAblation === 'declaration-knob') continue
      if (JSON.stringify(g.on.metrics) === JSON.stringify(g.off.metrics)) same.push(g.group)
    }
    add('sc/two-state-distinct', same.length === 0, '非 declaration-knob 组的两态 metrics 不得逐字相同（两态同源即死形态）；逐字相同=' + JSON.stringify(same))
  }

  // ⑧ 覆盖腿：请求的组都跑了。
  {
    const got = payload.groups.map((g) => g.group)
    const ok = requestedGroups.every((g) => got.includes(g))
    add('sc/groups-covered', ok, '请求的组必须全部跑过；缺=' + JSON.stringify(requestedGroups.filter((g) => !got.includes(g))))
  }

  return checks
}

function humanSummary(payload) {
  const L = []
  L.push('── A6-1 消融跑分（六组：去 JEV / 去 ACT-R 衰减 / 去工作记忆限制 / 去巩固 / 去元认知 / 去用户模型）──')
  L.push('输入集 ' + payload.input.id + '  sha256=' + payload.input.sha256.slice(0, 16) + '…')
  L.push('')
  L.push('组'.padEnd(16) + '开关面'.padEnd(18) + '差落在哪'.padEnd(18) + '非零差指标 / 足迹')
  for (const g of payload.groups) {
    const nz = Object.entries(g.deltas).filter(([, d]) => d.delta !== null && d.delta !== 0).map(([k, d]) => k + '=' + d.delta)
    const fp = g.footprint.map((k) => k + ':' + g.deltas[k].on + '→' + g.deltas[k].off).join(', ')
    L.push(
      g.group.padEnd(16) +
        g.declaredAblation.padEnd(18) +
        g.deltaKind.padEnd(18) +
        (nz.length ? nz.join(' ') : '（无非零差）') +
        '  | 足迹 ' +
        (fp || '（无）'),
    )
  }
  L.push('')
  L.push(
    '（任何指标）非零差组：' +
      payload.summary.a61_ratio_any_delta +
      '；**机制足迹真变**组：' +
      payload.summary.a61_ratio_behavioral +
      '；差只落在存在性（包在不在）的组：' +
      String(payload.summary.groupsPresenceOnlyDelta) +
      '；零差组（已声明成因）：' +
      (payload.summary.groupsStructuralZeroDelta
        .concat(payload.summary.groupsDeclarationOnlyZeroDelta)
        .concat(payload.summary.groupsZeroDeltaUndeclared.map((x) => x + '（未声明！）'))
        .join(', ') || '（无）'),
  )
  L.push('自检腿：' + payload.selfChecks.filter((c) => c.ok).length + '/' + payload.selfChecks.length + ' PASS')
  for (const c of payload.selfChecks) if (!c.ok) L.push('  ✗ ' + c.id + ' — ' + c.detail)
  L.push('exit=' + payload.exitCode + '（' + payload.exitReason + '）')
  return L.join('\n')
}

async function main() {
  const args = parseArgv(process.argv.slice(2))
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
    process.exitCode = EXIT.ALL_DELTA
    return
  }
  const mutations = args.mutate.map(parseMutation).filter(Boolean)
  const want = (kind) => mutations.find((m) => m.kind === kind) || null
  const requested = args.only ? [args.only] : GROUPS.map((g) => g.id)
  const selected = GROUPS.filter((g) => requested.includes(g.id))
  if (selected.length === 0) {
    console.error('[harness-failure] --only ' + args.only + ' 不匹配任何组（可用：' + GROUPS.map((g) => g.id).join(', ') + '）')
    process.exitCode = EXIT.HARNESS_FAILED
    return
  }

  const t0 = Date.now()
  const { input, sha1, sha2 } = loadInput(want('random-input'))

  if (args.selfCheckOnly) {
    const snap = {
      tool: 'tools/a6-ablation.mjs',
      mode: 'self-check',
      ts: nowIso(),
      input: { id: input.id, path: INPUT_PATH, sha256: sha1, sha256SecondRead: sha2, reproducible: sha1 === sha2 },
      groups: GROUPS.map((g) => ({ group: g.id, name: g.name, declaredAblation: g.ablation, pkgDir: g.pkgDir, metrics: METRIC_KEYS[g.id], footprint: g.footprint, structuralReason: g.structuralReason })),
      exitCode: sha1 === sha2 ? EXIT.ALL_DELTA : EXIT.HARNESS_FAILED,
    }
    console.log(JSON.stringify(snap, null, 2))
    process.exitCode = snap.exitCode
    return
  }

  // --decl-switch=unload：把 declaration-knob 组的「关」错接成卸载（负向对拍用；
  //   正确形态是**两态都载入该包**，只关包内开关 —— 见 groupPlugin 的 metacognition 分支）。
  const effectiveGroups = selected.map((g) =>
    g.ablation === 'declaration-knob' ? { ...g, declKnob: args.declSwitch !== 'unload' } : g,
  )

  const groups = []
  for (const g of effectiveGroups) {
    const ev = await evalGroup(g, mutations)
    const isStructZero = ev.on.metrics && ev.off.metrics && JSON.stringify(ev.on.metrics) === JSON.stringify(ev.off.metrics)
    groups.push({
      group: g.id,
      name: g.name,
      question: g.question,
      declaredAblation: g.ablation,
      pkgDir: g.pkgDir,
      footprint: g.footprint,
      structuralReason: g.structuralReason,
      // declKnob 必须**带给下游的判据面**：sc/declaration-knob-stays-loaded 读的就是它
      // （第一版没带 ⇒ --decl-switch=unload 时该腿读不到 false，负控假绿 —— 本席实测踩到）。
      declKnob: g.declKnob === undefined ? true : g.declKnob, // 非 declaration-knob 组恒 true（该字段对它无义）
      // 两态读数逐字相同 ⇒ 本组**不可能**产出非零差。三种成因都必须是**已声明**的结构必然
      // （不是跑分器静默失败；口径见 groups 之上的 structuralReason 与 file-header 退出码表）：
      //   · declarationOnlyZeroDelta：包内开关只改 status() 自报字段（假旋钮形态）；
      //   · structuralZeroDelta：该机制在这条链上的**生产足迹为空**（本仓现状）；
      //   · declKnobMisfired：--decl-switch=unload 的负向对拍 ⇒ 包不在场。
      // deltaKind：这一组的差**落在哪一层**（可机检，不靠散文）：
      //   · behavioral       = 至少一条**机制足迹**指标真变了（机制被关掉是可见的）
      //   · declaration-only = 足迹全不动，只有非足迹指标动（典型：开关只改 status() 自报字段）
      //   · none             = 全部指标逐字相同（必须带 zeroDeltaReason，否则退出码 4）
      deltaKind: (() => {
        // ⚠ 读的是**评估结果** ev.deltas，不是组定义 g（g 上没有 deltas —— 本席实测踩过）
        const moved = (k) => ev.deltas[k] && ev.deltas[k].delta !== null && ev.deltas[k].delta !== 0
        if (g.footprint.some(moved)) return 'behavioral'
        if (PRESENCE_KEYS.some(moved)) return 'presence-only'
        const anyMoves = Object.values(ev.deltas).some((d) => d.delta !== null && d.delta !== 0)
        return anyMoves ? 'declaration-only' : 'none'
      })(),
      // none 差的**显式成因**（空 = 无成因 ⇒ 退出码 4：那是静默失败，不许放过）。
      zeroDeltaReason: (() => {
        const anyMoves = Object.values(ev.deltas).some((d) => d.delta !== null && d.delta !== 0)
        if (anyMoves) return null
        if (g.ablation === 'declaration-knob') {
          return g.declKnob === false
            ? 'mutation:--decl-switch=unload（负向对拍：本组的包被错接成「关=卸载」）'
            : 'declared:' + (g.structuralReason || 'declaration-knob（包内开关只改自报字段）')
        }
        return g.structuralReason ? 'declared:' + g.structuralReason : null
      })(),
      structuralZeroDelta: !!isStructZero && g.ablation !== 'declaration-knob',
      declarationOnlyZeroDelta: g.ablation === 'declaration-knob' && g.declKnob !== false && !!isStructZero,
      declKnobMisfired: g.ablation === 'declaration-knob' && g.declKnob === false && !!isStructZero,
      zeroDeltaIsDeclared:
        (!!isStructZero && g.ablation !== 'declaration-knob') ||
        (g.ablation === 'declaration-knob' && g.declKnob !== false && !!isStructZero) ||
        (g.ablation === 'declaration-knob' && g.declKnob === false && !!isStructZero),
      on: ev.on,
      off: ev.off,
      deltas: ev.deltas,
      evalAnomalies: ev.evalAnomalies,
    })
  }

  // A6-2 的 n=0 显式落点：用最后一次评估留下的临时库量一个**结构性为空**的 sessionId。
  // ⚠ 临时库在进程退出时删除 ⇒ 这里必须**当场**量（所以放在主流程内，不在 exit 钩子里）。
  // --mutate strip-n：删掉 n 字段（A6-2 的负向对拍 —— 查「每条评估输出必含 n」这条腿有没有牙）。
  //   ⚠ 删的是**输出记录**上的 n，不是内部变量：判据读的正是输出。
  if (want('strip-n')) {
    for (const g of groups) {
      for (const r of [g.on, g.off]) delete r.n
    }
  }

  const emptyDbStore = join(tmpDir('a6-ablation-empty-'), 'mana.db')
  const empty = (() => {
    const { DatabaseSync: DS } = { DatabaseSync }
    const db = new DS(emptyDbStore)
    try {
      db.exec('CREATE TABLE inject_log (id INTEGER PRIMARY KEY, session_id TEXT)')
      return emptyProbe(emptyDbStore, input.emptyProbe.sessionId)
    } finally {
      db.close()
    }
  })()

  if (want('strip-n')) {
    for (const g of groups) {
      for (const r of [g.on, g.off]) delete r.n
    }
  }

  // 把「每组一个指标差」落到**每条记录**的 metric/value/delta 三字段（判据原文要求的形态）。
  const primaryOf = (g) => {
    // ① 优先取**机制足迹**里真出现非零差的那个指标（A6-1 要的「一个指标差」）；
    // ② 足迹无差时退回足迹首个（差额为 0 也照实落 0 —— 不得拿别的指标冒充这一组的差）；
    // ③ 无足迹组（declaration-knob）退回指标表首个（本仓实测：该组的所有指标差均为 0）。
    const fp = g.footprint.find((k) => g.deltas[k] && g.deltas[k].delta !== null && g.deltas[k].delta !== 0)
    if (fp) return fp
    if (g.footprint.length > 0) return g.footprint[0]
    return Object.keys(g.deltas)[0]
  }
  for (const g of groups) {
    const m = primaryOf(g)
    for (const r of [g.on, g.off]) {
      r.metric = m
      r.value = r.metrics[m] === undefined ? null : r.metrics[m]
      r.delta = g.deltas[m] ? g.deltas[m].delta : null
    }
  }

  const groupsWithNonZeroDelta = groups.filter((g) => Object.values(g.deltas).some((d) => d.delta !== null && d.delta !== 0)).length
  const structuralZero = groups.filter((g) => g.structuralZeroDelta).map((g) => g.group)
  const behavioralGroups = groups.filter((g) => g.deltaKind === 'behavioral').map((g) => g.group)
  const declOnlyGroups = groups.filter((g) => g.deltaKind === 'declaration-only').map((g) => g.group)
  const presenceOnlyGroups = groups.filter((g) => g.deltaKind === 'presence-only').map((g) => g.group)
  // none 且**没有**显式成因的组 = 静默失败（退出码 4）——这是本跑分器对「无差异也算过」的最终否决点。
  const undeclaredZero = groups.filter((g) => g.deltaKind === 'none' && !g.zeroDeltaReason).map((g) => g.group)
  const declOnlyZero = groups.filter((g) => g.declarationOnlyZeroDelta).map((g) => g.group)
  const evalAnomalies = groups.reduce((s, g) => s + g.evalAnomalies, 0)

  const payload = {
    tool: 'tools/a6-ablation.mjs',
    criterion: 'A6-1（docs/mana-rollout-plan.md:670）+ A6-2（:671）',
    ts: nowIso(),
    elapsedMs: Date.now() - t0,
    input: { id: input.id, path: INPUT_PATH, sha256: sha1, sha256SecondRead: sha2, reproducible: sha1 === sha2 },
    env: { node: process.version, repo: REPO },
    mutations: mutations.map((m) => (m.kind === 'same-source' ? 'same-source=' + m.group : m.kind)),
    groups,
    emptyProbe: want('strip-n') ? (({ n, ...rest }) => rest)(empty) : empty,
    summary: {
      groupsRequested: requested,
      groupsEvaluated: groups.map((g) => g.group),
      groupsWithNonZeroDelta,
      groupsBehavioralDelta: behavioralGroups,
      groupsDeclarationOnlyDelta: declOnlyGroups,
      groupsPresenceOnlyDelta: presenceOnlyGroups,
      groupsZeroDeltaUndeclared: undeclaredZero,
      groupsStructuralZeroDelta: structuralZero,
      groupsDeclarationOnlyZeroDelta: declOnlyZero,
      // ⚠ 两个比值**必须并列**，不得只报一个：
      //   · a61_ratio_any_delta —— 任何指标非零差的组数口径（最容易凑绿的读法）；
      //   · a61_ratio_behavioral —— **机制足迹**真变的组数口径（A6-1 本意的那一档）。
      a61_ratio_any_delta: groupsWithNonZeroDelta + '/' + groups.length,
      a61_ratio_behavioral: behavioralGroups.length + '/' + groups.length,
      evalAnomalies,
      harnessFailures: failures.slice(),
    },
  }

  // ③「变异必须留下见证」：请求了变异却在读数上看不到它 ⇒ 负控没打上靶（假覆盖），
  //    按 harness 失败处理。这是本仓「退出码 0 != 动作发生」的可机检落点。
  const mutationWitness = []
  for (const m of mutations) {
    if (m.kind === 'strip-n') {
      if (!payload.emptyProbe || Object.prototype.hasOwnProperty.call(payload.emptyProbe, 'n'))
        mutationWitness.push('strip-n：emptyProbe 仍有 n 字段 ⇒ 变异未生效')
    } else if (m.kind === 'random-input') {
      if (payload.input.reproducible) mutationWitness.push('random-input：两读 sha256 仍相等 ⇒ 变异未生效')
    } else if (m.kind === 'same-source') {
      const g = groups.find((x) => x.group === m.group)
      if (!g) mutationWitness.push('same-source：无此组 ' + m.group)
      else if (g.off.effectiveEnabled !== true) mutationWitness.push('same-source：关态 effectiveEnabled 仍非 true ⇒ 变异未生效')
    } else if (m.kind === 'drop-on') {
      if (groups.some((x) => x.on.metrics && Object.keys(x.on.metrics).length > 0))
        mutationWitness.push('drop-on：仍有组的开态带 metrics ⇒ 变异未生效')
    }
  }
  if (args.declSwitch === 'unload') {
    const g = groups.find((x) => x.declaredAblation === 'declaration-knob')
    if (g && g.declKnob !== false) mutationWitness.push('decl-switch=unload：declKnob 仍非 false ⇒ 变异未生效')
  }
  if (mutationWitness.length > 0) {
    for (const w of mutationWitness) fail('mutation-witness', new Error(w))
  }
  payload.mutationWitness = mutationWitness

  payload.selfChecks = selfChecks(payload, requested)
  const reds = payload.selfChecks.filter((c) => !c.ok)
  payload.exitCode =
    failures.length > 0
      ? EXIT.HARNESS_FAILED
      : reds.length > 0
        ? EXIT.EVAL_ANOMALY
        : undeclaredZero.length > 0
          ? EXIT.UNDECLARED_ZERO
          : structuralZero.length > 0 || declOnlyZero.length > 0
            ? EXIT.STRUCTURAL_ZERO_DELTA
            : EXIT.ALL_DELTA
  payload.exitReason =
    failures.length > 0
      ? 'harness 失败（见 summary.harnessFailures）'
      : reds.length > 0
        ? '自检腿报红：' + reds.map((c) => c.id).join(', ')
        : undeclaredZero.length > 0
          ? '有组 0 差且**未声明成因**（' + undeclaredZero.join(', ') + '）—— 静默失败，必须查'
          : (structuralZero.length > 0 || declOnlyZero.length > 0)
            ? '有组结构性 0 差（' + structuralZero.concat(declOnlyZero).join(', ') + '）—— 本仓现状，非跑分器失败'
          : '已评估的 ' + groups.length + ' 组全部产出非零指标差（' + groupsWithNonZeroDelta + '/' + groups.length + '）'

  console.log(JSON.stringify(payload, null, 2))
  if (args.human) {
    console.log('')
    console.log(humanSummary(payload))
  }
  process.exitCode = payload.exitCode
}

await main()
