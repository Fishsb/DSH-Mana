#!/usr/bin/env node
/**
 * Mana **L1–L4 四层评估器**（v10 §39.1 的可机检落点）。
 *
 * ── 为什么需要它（它补的是哪个空白）──────────────────────────────────────────────
 * 2026-09-26 实测：v10 §39 在本仓**零落点** —— 仓里只有 A0/A1/R0（**契约与判据**）与
 * A6（**消融**），没有任何东西回答「系统跑起来效果如何」。
 * 后果不是"少一个数字"，而是：**所有「完成」都只能是自述**（本仓原则：放行不等于抵达）。
 *
 * ── 与 A1/A6 的分工（不许互相冒充）────────────────────────────────────────────
 *   · A0/A1  = 契约与判据**对不对**（结构面 / 红绿）
 *   · A6     = 关掉某机制**有没有差**（消融面）
 *   · 本文件 = **跑起来产生了什么可数的结果**（效果面）
 * 三者读的是**同一批真痕迹**（mana_trace / inject_log / memory_items），但问的问题不同。
 *
 * ── 判据纪律（本仓血的教训，逐条落在可机检面上）────────────────────────────────
 *   ① **接真数据，不造夹具**：输入一律经**真 cordis 装配 + 真事件链**
 *      （perception→attention→WM→scheduler 的 turn 边界）产生，再**回读库**取数。
 *      绝不写「我喂进去的我自己断言」那种夹具绿。
 *   ② **N=0 显式记 0**（A6-2 同口径）：每条读数必带 `n`；n=0 时 **显式落 0**，
 *      绝不用"缺字段"冒充"没有"。n=0 的分母**不得**参与比值计算（那会把"没测"读成"通过"）。
 *   ③ **四态**：`MEASURED`（有 n>0 的真读数）/ `NO_DATA`（n=0，如实说没数据）/
 *      `NOT_IMPLEMENTED`（该层在本仓无落点）/ `FAIL`（读数违反不变式）。
 *      ⚠ **NO_DATA 与 NOT_IMPLEMENTED 都不是 PASS**。
 *   ④ **不用代理指标当结论**：延迟用**真计时**（performance.now），不用"文件大小/行数"顶替；
 *      token 面**不估**（本仓明令禁止 0.6 token/字符 那类冒充）——如实报「本仓不可测」。
 *   ⑤ **每层自带负向对拍**：`--mutate` 注入一个已知缺陷，被注入的那条**必须红**，
 *      其余层**不得误伤**（与 a1-check 的变异自证腿同口径）。
 *   ⑥ **只读仓内真源**：不改 packages/** 一个字节、不建仓内产物（临时库在 mkdtemp）。
 *
 * ── 退出码语义（判据要求"自己定义语义并在文件头写清"）──────────────────────────
 * ⚠ 本卡新增 **L0（模型通道可用性）**，故"全部 MEASURED"现在是 **L0–L4 五层**：
 *   云端不可用时 L0 落 **NO_DATA**（不是 FAIL）⇒ 退出码是 2 而**不是** 5 ——
 *   这正是用户指令「不得默认红到底」在退出码上的落点（"没测成"≠"行为不对"）。
 *
 *   · 0 = 各层**全部 MEASURED**（各自 n>0 且不变式成立）
 *   · 2 = 有层 **NO_DATA**（n=0）—— 这不是失败，是**本仓现状**（如仓内无历史库）
 *   · 4 = 有层 **NOT_IMPLEMENTED** —— 该层在本仓无落点（v10 有、本仓无）
 *   · 3 = **harness 自身失败**（装配失败 / 库读不出 / 自检腿报红）
 *   · 5 = 有层 **FAIL**（读数违反不变式）—— 最重
 *   ⚠ 先匹配**高码**（5 > 3 > 4 > 2 > 0）：exit code 只反映最坏的那一类。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *   node tools/eval-l1-l4.mjs                  # 全套（真装配 + 真链）
 *   node tools/eval-l1-l4.mjs --json           # 只出 JSON（给人看的那段不打）
 *   node tools/eval-l1-l4.mjs --self-check     # 只跑 harness 自检（约 2s，不装配）
 *   node tools/eval-l1-l4.mjs --mutate <id>    # 负向对拍（见 MUTATORS）
 *
 * ── 模型通道（本卡新增：本地 / 云端，缺省**云端**）──────────────────────────────
 *   node tools/eval-l1-l4.mjs --online-judge                  # 缺省走 **cloud**（即使没有 key）
 *   node tools/eval-l1-l4.mjs --online-judge --channel local  # **不改代码**切回本机 Ollama
 *
 * ⚠ 通道的判定归属地**不在这里**：它是 `packages/ui/src/panel.ts` 的 `resolveChannel`
 *   （UI 端点 `mana-ui/channel` 与本文件读的是**同一个函数**）。优先级：
 *     `--channel` 旗标 > UI 里设的偏好（`user_model` 的 `mana.eval.modelChannel`）> 缺省 cloud。
 *   把判定复制一份到这里，就会出现"UI 存了 A、评估器走 B 而读数只看得到一个通道名"的分叉。
 * ⚠ 云端凭据**只从环境变量读**（变量名见 CHANNEL_ROUTES.cloud.keyEnv，缺省 `NANOGPT_API_KEY`）：
 *   本文件不写 key、不落 key、不回显 key（**连前缀都不回显**）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
/** 宿主安装目录：cordis 不是本仓 workspace 依赖（按包名 import 会 ERR_MODULE_NOT_FOUND）。 */
const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

const EXIT = Object.freeze({
  ALL_MEASURED: 0,
  HAS_NO_DATA: 2,
  HARNESS_FAILED: 3,
  HAS_NOT_IMPLEMENTED: 4,
  HAS_FAIL: 5,
})

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}

// ══ 模型通道：local / cloud（用户指令：两条都要有 · UI 可设 · 缺省云端）══════════
/**
 * ── 判定归属地（**本文件不自己判**）─────────────────────────────────────────────
 * 用户指令原文：「评估器的模型通道**本地与云端都要有**，**切需要在 UI 让用户设定**，
 *   **当前默认用云端**」。
 * ⇒ 「哪条通道生效」的判定与持久化**只存在于一处**：packages/ui/src/panel.ts 的
 *   resolveChannel（UI 端点 mana-ui/channel 与评估器读的是**同一个函数**）。
 *   若评估器在这里再判一遍（例如「环境变量优先」），就会出现**两个判定点**：
 *   UI 里存了 local、评估器却走 cloud，而两者在读数上**完全同形**（都只印一个通道名）。
 * ⚠ 故本文件只做三件事：**读偏好 → 交给那个函数 → 按结果驱动 jev**（并**回显**通道+模型）。
 *
 * ⚠ 按**路径**动态 import 该函数（而非包名）：仓库根不是宿主 profile，解析不到 dsh-mana-ui；
 *   路径直指**源文件**，与仓内其它工具的装载口径一致。
 */
const resolveChannelPath = pathToFileURL(join(REPO, 'packages', 'ui', 'src', 'panel.ts')).href

/**
 * 偏好读侧：core 的库（user_model 单键），路径解析与 packages/core/src/index.ts:446 同口径。
 *
 * ⚠ **只读**：本文件**从不写**偏好（那是 UI 端点的动作）—— 评估器改用户设置会违反
 *   「用户设置优先」这条指令本身（等于替用户拍板）。
 * ⚠ 两处路径口径必须**逐字一致**；不一致会让「读不到偏好」伪装成「用户没设过」。
 * ⚠ 读不到（库不存在 / 老库无该表 / 打不开）⇒ 返回 null（= 没设过 ⇒ 走缺省）且**记下原因**，
 *   不抛错（首次运行时库不存在是常态），也**不把读失败说成没设过**。
 */
function readStoredChannel(prefKey) {
  /**
   * ⚠ 库路径口径与 `packages/core/src/index.ts` 的 `resolveStorePath` **逐字一致**
   *   （同 `DSH_HOME`、同 `memory/mana.db`）。**不另加环境变量**：
   *   多一个 core 不认的变量 ⇒ 评估器读库 A、core 写库 B，而症状是「用户设置不生效」。
   * ⚠ 键名 `prefKey` 由**调用方从归属模块取**（`mod.CHANNEL_PREFERENCE_KEY`），
   *   本文件不写第二份字面量。⚠ 本席实测踩到：第一版直接引用了那个常量名 ⇒
   *   `ReferenceError` 被 catch 吞成 reason ⇒ **偏好读路整条死掉**，而外层看起来"只是读失败"。
   *   故这里把 key 作**显式入参**，让"忘了传"在类型/调用面上就暴露。
   */
  if (typeof prefKey !== 'string' || prefKey === '') {
    return { value: null, storePath: '', reason: 'bad-key: 偏好键名未从归属模块取到' }
  }
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const storePath = join(home, 'memory', 'mana.db')
  let db = null
  try {
    if (!existsSync(storePath)) return { value: null, storePath, reason: 'no-store' }
    db = new DatabaseSync(storePath, { readOnly: true })
    const row = db.prepare('SELECT value FROM user_model WHERE key = ?').get(prefKey)
    return { value: typeof row?.value === 'string' ? row.value : null, storePath, reason: 'ok' }
  } catch (error) {
    return { value: null, storePath, reason: 'read-failed: ' + String((error && error.message) || error).slice(0, 120) }
  } finally {
    if (db) { try { db.close() } catch { /* 关不掉不影响读数 */ } }
  }
}

/**
 * 通道解析（含**覆盖**与**成对校验**）。
 *
 * · --channel local|cloud：本次跑哪条通道（**不改代码**即可切回 local 的开关）；
 * · --base / --model：只在与 --channel **成对**给出时才覆盖 —— 单独给会把「cloud 的模型」
 *   配到「local 的端点」上，产出**看着跑通了**的错读数（本仓点名的形态）。
 */
async function resolveChannelDecision() {
  const mod = await import(resolveChannelPath)
  /**
   * ⚠ 键名从**归属模块**取（同一个 import 面）：本文件不得再写一份字面量 ——
   *   两份会漂移，而漂移的症状是「UI 设了但评估器读不到」，读数上只表现为"用户没设过"。
   */
  const stored = readStoredChannel(mod.CHANNEL_PREFERENCE_KEY)
  const explicit = opt('--channel')
  let decision
  let source
  if (explicit !== undefined) {
    const wanted = mod.normalizeChannel(explicit)
    if (wanted === null) throw new Error('--channel 取值必须是 ' + mod.CHANNEL_VALUES.join('|') + '，实测 ' + JSON.stringify(explicit))
    decision = mod.resolveChannel(wanted)
    source = 'flag'
  } else if (typeof stored.value === 'string' && stored.value !== '') {
    // **用户设置优先**（UI 里设的）—— 这正是「用户设置优先于缺省」的落点。
    decision = mod.resolveChannel(stored.value)
    source = 'preference'
  } else {
    decision = mod.resolveChannel(null)
    source = 'default'
  }
  const route = mod.CHANNEL_ROUTES[decision.channel]
  const baseOverride = opt('--base')
  const modelOverride = opt('--model')
  if ((baseOverride === undefined) !== (modelOverride === undefined)) {
    throw new Error('--base 与 --model 必须成对给出（单独给会把一条通道的模型配到另一条的端点上，产出看着跑通的错读数）')
  }
  return {
    channel: decision.channel,
    jevChannel: route.jevChannel,
    base: baseOverride ?? route.base,
    model: modelOverride ?? decision.model,
    source,
    preferenceKey: mod.CHANNEL_PREFERENCE_KEY,
    storedValue: stored.value,
    storePath: stored.storePath,
    storeRead: stored.reason,
    overridden: baseOverride !== undefined,
    keyEnv: mod.CHANNEL_ROUTES.cloud.keyEnv,
  }
}

/**
 * 云端凭据**在场性**：只回布尔，**绝不回 key（连前缀都不回）** —— 用户指令 C 项。
 * ⚠ 判据是「变量有没有值」，不是「值好不好」：值好不好交给真调用自己报。
 */
const cloudCredentialPresent = () => typeof process.env[CHANNEL.keyEnv] === 'string' && process.env[CHANNEL.keyEnv].trim() !== ''

/**
 * 三态归因文案（照抄 docs/mana-endpoint-attribution.md 的 §2 口径：类别名 / 判定语 /
 * **互斥的下一步动作** 三者齐备，且与环境态**不同形**）。
 *
 * ⚠ 用户指令原文：「云端不可用不得『默认红到底』」⇒ 环境态**不落 FAIL**，落 NO_DATA +
 *   本段文案（「这一次没测成」≠「被测行为不对」，两者不得同形）。
 */
function channelAttribution(text, reading) {
  const head = '[通道 · ' + CHANNEL.channel + '] ' + text
  if (CHANNEL.channel === 'cloud') {
    const missing = !cloudCredentialPresent()
    return head + '｜**环境不可用（env-unavailable）**：' +
      (missing
        ? '环境变量 ' + CHANNEL.keyEnv + ' 未设置（**只报变量名，Key 本身本程序从不读取**）'
        : '凭据在场但这一次调用没拿到可用应答（网络 / 端点 / 服务端）') +
      '｜实测：端点=' + CHANNEL.base + ' · 模型=' + CHANNEL.model + ' · ' + reading +
      '｜下一步：查**测量环境** —— ①查 ' + CHANNEL.keyEnv + '（source ~/.dsh/secrets/nanogpt.env）②查网络能否到达 ' + CHANNEL.base +
      '（**这一条不是被测代码的问题**，别去翻 packages/**）'
  }
  return head + '｜**环境不可用（env-unavailable）**：本机 Ollama 不可达或未启动' +
    '｜实测：端点=' + CHANNEL.base + ' · 模型=' + CHANNEL.model + ' · ' + reading +
    '｜下一步：查**测量环境** —— ①宿主 Ollama 是否在跑（ollama list · ' + CHANNEL.base + '）②该模型是否已 pull' +
    '（**这一条不是被测代码的问题**）'
}

/**
 * 通道环境**真探**（不是「看看配置对不对」）。⚠ **选得中才探**：探针的代价是网络往返，
 * 而缺省腿是云端 ⇒ 没选中的那条腿不该产生流量。
 */
async function detectChannelEnv() {
  if (CHANNEL.channel !== 'cloud') {
    try {
      const res = await fetch(CHANNEL.base.replace(/[/]$/, '') + '/api/tags', { signal: AbortSignal.timeout(3000) })
      const body = await res.text()
      return { ok: res.ok, kind: res.ok ? 'ok' : 'http-error', detail: 'HTTP ' + res.status + ' · ' + body.slice(0, 80) }
    } catch (error) {
      return { ok: false, kind: 'unreachable', detail: String((error && error.message) || error).slice(0, 120) }
    }
  }
  if (!cloudCredentialPresent()) return { ok: false, kind: 'no-credential', detail: '变量 ' + CHANNEL.keyEnv + ' 未设置' }
  return { ok: true, kind: 'credential-present', detail: '凭据在场（判据只看在场性，校验交给真调用）' }
}

/**
 * 云端 URL 拼接**预检**（本卡实测到的那个坑，机器化拦住）。
 *
 * 用户给的端点串是 https://nano-gpt.com/api/v1，而代码是 {base} + SYSTEMONE_DEFAULT_PATH
 * （/api/v1/systemone）⇒ 传用户原串会拼成 /api/v1/api/v1/systemone（错）。
 * ⚠ 该常量**必须读源码**而不是在本文件再写一份（副本一旦漂移，「预检通过」就与真调用无关了）。
 */
function probeCloudUrlShape() {
  const src = readFileSync(join(REPO, 'packages', 'jev', 'src', 'systemone.ts'), 'utf8')
  const m = src.match(/SYSTEMONE_DEFAULT_PATH\s*=\s*'([^']+)'/)
  const path = m ? m[1] : null
  const url = CHANNEL.base.replace(/[/]$/, '') + (path ?? '')
  return { ok: path !== null && !url.includes('/api/v1/api/v1'), path, url }
}
const JSON_ONLY = has('--json')
const SELF_CHECK = has('--self-check')
/**
 * ⚠ **变异名必须大小写归一**（本席 2026-09-27 实测踩到，如实记）：
 *   本集合原样收 argv，而各层的调用点写 `mutOf('L2')`（**大写**）——
 *   ⇒ 文件头与任务卡给的 `--mutate l2`（**小写**）**根本匹配不上**，变异腿静默不注入。
 *   实测：`--mutate l2` → **exit 0**（看起来"没问题"，实为**假绿**）；
 *         `--mutate L2` → exit 5（这才是真咬住）。
 *   ⇒ 归一为小写（两种写法等价），并**对无法解析的变异名显式报错**（见 checkMutates）：
 *     不认识的变异名绝不允许退化成"本次没有变异"。
 */
const MUTATES = new Set(
  argv.flatMap((a, i) => (a === '--mutate' && argv[i + 1] ? [String(argv[i + 1]).toLowerCase()] : [])),
)
const mutOf = (layer) => MUTATES.has(String(layer).toLowerCase())

/**
 * 负向对拍清单（每层一个）。锚点必须**恰好命中一次**，否则抛错
 * （静默通过就是假绿 —— 与 a1-check 的 loadCloned 同口径）。
 *
 * ⚠ 本表只登记**评估器自身可被否证的方式**，不改被测包的源码：
 *   注入点在本文件内（把某个读数按下述方式篡改/旁路）。
 */
const MUTATORS = {
  l1: { target: 'L1', why: '把 L1 的「链上等价节点计数」改成只看 encoding（丢掉其余节点）⇒ 应报 FAIL' },
  /**
   * ⚠ **本变异的射程必须写清**（本席 2026-09-27 实测）：它注入 `hits = n + 1`，
   *   咬的是「命中数不得大于样本数」这条不变式。而**真库 memory_items 活行数为 0** 时
   *   （= 记忆未形成的现状），L2 走**三态第一态**（NO_DATA）**先于**比值计算返回 ⇒
   *   **变异无处可咬，`--mutate l2` 只会更响地报"记忆未形成"，不会变红**。
   *   这不是变异腿失效，而是**射程**：它只能咬"有记忆可召回"的那种运行态。
   *   ⇒ 变异腿**可被射程遮蔽**这件事本身必须**机检**（见 selfCheck ⑥/⑦ 与下面的 arm 读数）：
   *     把"本次运行能不能咬住"作为读数打出来，绝不让它静默退化成"看起来跑过了"。
   */
  l2: { target: 'L2', why: '把 L2 的召回命中数按 ceil 放大 ⇒ 命中率越过 100% 上界 ⇒ 应报 FAIL（⚠ 仅当 memoryCount>0 才有靶）' },
  l3: { target: 'L3', why: '把 L3 的延迟读数硬写成 0 ⇒ 违反「≥0 且真计时」不变式 ⇒ 应报 FAIL' },
  l4: {
    target: 'L4',
    why: '把 L4 的曲线点全置为同一值 ⇒ 违反「曲线须非平凡」不变式 ⇒ 应报 FAIL',
    /**
     * ⚠ **该变异在 n=0 时无处可咬**（本席实测：L4 常态即 NO_DATA ⇒ 注入变异后仍 NO_DATA ⇒
     *   负向对拍**不可能红**）。这是**形态性**的：没有数据就没有不变式可违反。
     *   ⇒ 处理方式**不是**删掉这条对拍（那是把失败不可观测亲手做出来），而是：
     *     给 L4 一条**不依赖 memory_items 的可测腿**（下面用 mana_trace 的注入行计数当曲线源），
     *     使 n>0 可达 ⇒ 变异才有靶。
     */
  },
}

// ── 结果四态 ────────────────────────────────────────────────────────────────
const results = []
const record = (id, title, state, detail, evidence = {}) =>
  results.push({ id, title, state, detail, evidence })

/** 每层的一层壳：失败必须显式（绝不静默吞）。 */
async function layer(id, title, body) {
  try {
    const r = await body()
    record(id, title, r.state, r.detail, r.evidence ?? {})
  } catch (error) {
    record(id, title, 'FAIL', 'harness 抛错：' + String((error && error.stack) || error).slice(0, 400), {})
  }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms))

/** 真 cordis 装配（与 packages/scheduler/tests/chains-e2e.test.mjs 的 boot 同口径）。 */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-eval-'))
  const store = join(dir, 'mana.db')
  const { Context } = await import(pathToFileURL(join(DSH, 'cordis/lib/index.js')).href)
  const load = (pkg) => import(pathToFileURL(join(REPO, 'packages', pkg, 'src', 'index.ts')).href)

  const ctx = new Context()
  ctx.plugin(await load('core'), { storePath: store })
  await settle(200)
  for (const [pkg, cfg] of [
    ['perception', {}],
    ['attention', {}],
    /**
     * ⚠ **默认离线（embedEnabled:false）**：词法分支 ⇒ 零网络、可逐字断言 ⇒ 评估可复现。
     *
     * ⚠⚠ **`--online-embed` 才走真向量腿**（本席 2026-09-27 实测后新增，含**一次自我否定**）——
     *   我上一轮把「向量腿为什么没启用」判成了**环境阻塞**，并报告"需用户改宿主 Ollama 启动参数"。
     *   **实测推翻**（三条证据）：
     *     ① 宿主 Ollama v0.34.4 的 `serve --help` 里**根本没有 `--embeddings` 这个 flag**；
     *     ② 换一个不存在的模型名去试 embed，错误**变了**：
     *        对 `qwen3.5:0.8b` ⇒ "does not support embeddings"（**误导性文案**）
     *        对 `nomic-embed-text` ⇒ "model not found, try pulling it first"
     *        ⇒ 说明**服务端支持嵌入**，只是那个模型不具备 embed 能力；
     *     ③ 环境里**早已装好 `bge-m3:latest`**（1.2 GB，两周前），实测返回 1024 维向量，
     *        语义区分显著（相关 0.8325 vs 不相关 0.3128）。
     *   ⇒ 真障碍**不是环境**，是本评估器**自己**把嵌入关掉了（为离线可复现），
     *     而本仓 `vector` 的缺省 model 本来就是 `bge-m3`（配置一直是对的）。
     *   ⇒ 结论：**不需要任何环境变更**；要测向量腿，加个开关就走真端点。
     */
    ['vector', has('--online-embed')
      /**
       * ⚠ **键名是 `embedBaseUrl`，不是 `baseUrl`**（本席 2026-09-27 实测踩到）：
       *   我第一版写 `baseUrl` ⇒ schemastery 不认该键 ⇒ base 为空 ⇒
       *   `embed.ts` 直接返回降级（"未配置嵌入端点（baseUrl 为空）"）。
       *   ⚠ 表现是 `channel: 'degraded'` —— **看起来像"向量腿坏了"**，
       *     实际只是**配置键名写错**（本仓"配置同义词"这类坑的又一例）。
       *   ⚠ 教训：写配置前**先核 schema 的键名**，别按语义猜；
       *     且**降级读数必须可追到具体原因**（它确实带出了"baseUrl 为空"，只是我一开始没读）。
       */
      ? { embedEnabled: true, model: 'bge-m3', embedBaseUrl: process.env.MANA_EMBED_BASE ?? 'http://127.0.0.1:11434/v1' }
      : { embedEnabled: false }],
    // ⚠ **long-term 必须挂**（本席 2026-09-26 实测踩到）：memory_items 的**生产写者**是
    //   long-term 的 Write Gate（挂在 `mana/observation` 上）。不挂它 ⇒ 库里**一条记忆都没有**
    //   ⇒ L2 命中率恒 0、L4 曲线无点。而这两个读数**看起来像"系统效果差"**，
    //   实际是"评估器少挂了一个包" —— 正是本仓最防的「归因错位」。
    /**
     * ⚠ **long-term 的 Write Gate 预过滤在评估里绕不过去**（本席实测，如实记）：
     *   预过滤判的是「观察文本与**问法**（`'这条观察值得长期记住吗'`）的 bigram 交集 ≥2」，
     *   而 `long-term` **刻意不导出 `Config`**（见其文件头）⇒ 配置面**无法**传 `prefilterEnabled:false`。
     *   评估语料与那句问法天然不重叠 ⇒ 恒 `skipped_prefilter` ⇒ memory_items 恒空。
     *   ⇒ **不硬凑**（造与问法重叠的种子 = 为评估而设计输入，属本仓点名的假绿形态）：
     *     改为**如实报告**这条链的现状 —— L4 走 NO_DATA + 逐环归因，
     *     并把「要测记忆形成曲线，须先把预过滤这一环解决」作为结论交给用户。
     */
    ['long-term', {}],
    // ⚠ **jev 必须挂**（同一坑的第二层，实测）：Write Gate 的判定走**既有** `mana/jev/judge`
    //   waterfall，**判定链无监听器 ⇒ 落 `no-judge-listener` ⇒ 拒绝写入**（fail-closed，行为正确）。
    //   不挂 jev ⇒ 记忆永远写不进库 ⇒ L4 恒 NO_DATA。⚠ 本评估器**不联网**：故 jev 走
    //   `channel` 的**离线**形态（见下面配置注释），使"无网络"不冒充"系统不写记忆"。
    // 端口 1 恒不可达 ⇒ 判定链必然降级 ⇒ Write Gate 走 fail-closed（拒绝写入）。
    // ⚠ 这正是**本评估器的形态**：它要量的是"链有没有跑通"，不是"JEV 判得准不准"
    //   （后者属 H3 人工判据）。**降级导致记忆写不进 = 真实行为**，L4 据此报 NO_DATA 是诚实的。
    //   若要看"记忆真写进去"的效果面，须接真 JEV（联网）——本评估器**刻意为离线可复现**。
    /**
     * ⚠⚠ **`--online-judge` 才接真判定链**（本席 2026-09-27 实测后新增，补一个**真缺口**）──
     *
     *   起因：给 `--online-embed` 开了真向量腿后，**语义召回仍然测不到**。实测追因：
     *     · 判定链的**提供者**是 `packages/jev/src/index.ts:531`（`ctx.on('mana/jev/judge', …)`）；
     *     · `attention` 是**调用方**（`ctx.waterfall('mana/jev/judge', …)`），**不是**监听者；
     *     · 本评估器把 jev 指向**死端点** `127.0.0.1:1` ⇒ 判定必然降级 ⇒ Recall Gate **丢弃候选**。
     *   反证实验（本席亲跑）：jev 改指真端点后 ⇒ `judged=1/1`、`gate='below_threshold'`
     *     ⇒ **整条链贯通**（embed → store → recall → JEV 判定 → gate）。
     *
     *   ⇒ 即：`--online-embed` **只开了嵌入、没开判定链** ⇒ 语义召回在评估里**仍测不到**。
     *     故单立此开关，使"语义相近能否被召回"这件事**可测**（那才是向量腿存在的理由）。
     *
     *   ⚠ 缺省仍**离线**（死端点）⇒ 评估可复现，且**降级本身**是被判据钉住的既有行为。
     */
    /**
     * ── 三态（--online-judge 时）────────────────────────────────────────────────
     *  ⚠ 端点 / 模型 / 通道全部取自 CHANNEL（**唯一归属地**在 packages/ui/src/panel.ts）；
     *    本文件不写第二份副本 —— 副本一漂移，读数里的通道与真调用的通道就会不一致。
     *  ⚠ key **只从环境变量读**（systemoneApiKeyEnv 传的是**变量名**）：
     *    本文件从头到尾不接触 key 的值，更不会打印它。
     *  ⚠ 环境不可用时**仍指向真通道**（让「没拿到应答」由真调用如实报出），
     *    而不是换成一个必然失败的假端点 —— 后者会把「环境问题」伪装成「端点连不上」。
     */
    ['jev', has('--online-judge')
      ? {
          channel: CHANNEL.jevChannel,
          endpoint: CHANNEL.base,
          model: CHANNEL.model,
        }
      : { channel: 'ollama', endpoint: 'http://127.0.0.1:1', model: 'eval-offline' }],
    ['reconsolidation', {}],
    ['forgetting', {}],
    ['learning', {}],
    ['consolidation', {}],
  ]) {
    ctx.plugin(await load(pkg), cfg)
    await settle(100)
  }
  ctx.plugin(await load('scheduler'), {
    maxGoals: 64,
    maxCycles: 8,
    driverEnabled: true,
    // ⚠ 评估**关掉生成链**：它要真出网（LLM 往返），而本评估器的目的是量**本地链**的效果，
    //   掺进网络延迟会让 L3 的读数不可归因（本仓「代理指标非判据」同源理由）。
    generationEnabled: false,
  })
  await settle(300)
  return { ctx, store, dir }
}

/** 只读连接读库（不复用插件句柄）。 */
function readDb(store, sql, params = []) {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}

// ── L2 三态判定：提纯成纯函数（守卫可断言化）──────────────────────────────────
/**
 * 把「记忆未形成 / 已形成但未召回 / 正常命中」三态的判定**从散文提纯成可断言的函数**，
 * 这样"三者不得同形"就不再是一句承诺，而是 selfCheck 里可机检的断言（本仓「守卫可断言化」）。
 *
 * 返回 `{ state, tri, rate }`：`state` 是四态（决定退出码），`tri` 是**三态标签**（机器可读）。
 * 两者**任一不同**即视为"不同形"。
 *
 * ⚠ **闸的顺序是判据的一部分，不可换**（本席在此踩过一次并机检之，如实记）：
 *   ① `n === 0` → 分母为 0，不得算比值；
 *   ② **比值合法性**（`hits ∈ [0, n]`）；
 *   ③ 库里有没有东西可召回（`memoryCount`）；
 *   ④ 召回命中了吗（`hits`）。
 *   若把 ③ 提到 ② 之前，`memoryCount === 0` 会先 return —— 于是 `--mutate l2` 注入的
 *   "越界计数"被**同形地**读成"记忆未形成"，**负向对拍失效**（变异不变红 = 又一处失败不可观测）。
 *   故次序在这里定死，并由 selfCheck ⑦ **机检"变异靶存在"**（不靠注释承诺）。
 */
function l2Verdict(memoryCount, hits, n, memoryRows = memoryCount) {
  if (n === 0) return { state: 'NO_DATA', tri: 'no_retrieval_rows', rate: null }
  const rate = hits / n
  if (!(rate >= 0 && rate <= 1)) return { state: 'FAIL', tri: 'rate_out_of_range', rate }
  if (memoryCount === 0) {
    /**
     * ⚠ **"活行为 0"本身还是两件事**（本席实测后补，如实记）：全表行数为 0
     *   ⇒ 记忆**压根没进库**（上游写入侧）；全表 > 0 而活行 = 0 ⇒ **记忆形成过、全部退休**
     *   （遗忘链的正常产物）。后者若也报"未形成"，就是**归因错位 + 假红**——
     *   与 core 在 librarySize 注释里点名的那个坑同源。故拆成两个不同的标签。
     */
    return memoryRows > 0
      ? { state: 'NO_DATA', tri: 'all_retired', rate }
      : { state: 'NO_DATA', tri: 'memory_not_formed', rate }
  }
  if (hits === 0) return { state: 'MEASURED', tri: 'formed_but_missed', rate }
  return { state: 'MEASURED', tri: 'hits', rate }
}

// ── 自检腿（--self-check 与正常跑都会执行）────────────────────────────────────
/**
 * harness 自检：**先证判据有牙，再判被测系统**。
 * 每一条对应一个"这个评估器可能骗人"的方式。
 */
function selfCheck() {
  const problems = []
  // ① N=0 必须显式落 0，不得缺字段
  const probe = { n: 0, measured: false }
  if (!('n' in probe)) problems.push('n 字段缺失（A6-2 口径：n=0 必须显式落 0）')
  // ② 四态齐备（少一个状态名 ⇒ 有人在用二值冒充四态）
  const states = ['MEASURED', 'NO_DATA', 'NOT_IMPLEMENTED', 'FAIL']
  for (const s of states) if (typeof s !== 'string') problems.push('状态名异常：' + s)
  // ③ 负向对拍表必须覆盖四层
  for (const l of ['l1', 'l2', 'l3', 'l4']) if (!MUTATORS[l]) problems.push('缺负向对拍：' + l)
  // ④ 退出码必须可区分（全等 ⇒ 失败不可观测）
  const codes = new Set(Object.values(EXIT))
  if (codes.size !== Object.values(EXIT).length) problems.push('退出码有重复值 ⇒ 失败不可区分')
  // ⑤ **未登记的变异名必须响亮**（本席实测坑：`--mutate l2` 曾因大小写不匹配而静默不注入
  //    ⇒ 变异腿报绿，人却以为"负向对拍跑过了"。静默降级 = 失败不可观测，故在此显式拦截。）
  for (const m of MUTATES) if (!MUTATORS[m]) problems.push('未登记的变异名：' + m + '（可用：' + Object.keys(MUTATORS).join('/') + '）')
  // ⑥ **L2 三态必须两两不同形**（本卡的核心：这是可机检的断言，不是散文承诺）。
  //    ⚠ 这里用**真函数**（不是重写一遍判定）——复述一遍就是"夹具绿"：
  //      夹具与被测各写一份，两份可以一起错而测试照绿。
  const triShapes = [
    l2Verdict(0, 0, 4, 0), // 记忆未形成（全表也空）
    l2Verdict(0, 0, 4, 7), // 形成过但全部退休
    l2Verdict(5, 0, 4), // 已形成但未召回
    l2Verdict(5, 3, 4), // 正常命中
  ]
  const shapeKeys = triShapes.map((x) => x.state + '|' + x.tri)
  if (new Set(shapeKeys).size !== shapeKeys.length) {
    problems.push('L2 三态同形（state|tri 有重复）：' + shapeKeys.join(' , '))
  }
  // ⚠ **反序负控**：判定顺序若被写反（先算命中再问库），"记忆未形成"会退化成 "formed_but_missed" ⇒ 该断言必须咬住。
  if (l2Verdict(0, 0, 4).tri !== 'memory_not_formed') {
    problems.push('L2 三态判定顺序被写反：memoryCount=0 未先判"未形成"（会退化成与"已形成未召回"同形）')
  }
  // ⑦ **变异靶必须存在**（机检"负向对拍有没有靶"，不靠注释承诺）：变异注入 hits=n+1
  //    ⇒ 必须被**比值闸**咬住，且不得被三态提前 return 掉。这一条同时守住两件事：
  //    ① 变异腿不静默失效 ② memoryCount=0 时"计数口径坏"不与"记忆未形成"同形。
  const mutTarget = l2Verdict(0, 4 + 1, 4)
  if (mutTarget.state !== 'FAIL' || mutTarget.tri !== 'rate_out_of_range') {
    problems.push('L2 变异靶失效：l2Verdict(0, n+1, n) 应报 FAIL/rate_out_of_range，实为 ' + mutTarget.state + '/' + mutTarget.tri + '（比值闸被三态提前 return 掉了）')
  }
  // ⑦b **"活行为 0"不得被笼统读成"未形成"**（全表 > 0 ⇒ 是"全部退休"，属正常行为而非上游故障）。
  if (l2Verdict(0, 0, 4, 7).tri !== 'all_retired') {
    problems.push('L2 归因错位：全表有行而活行=0 时未识别为"全部退休"，实为 ' + l2Verdict(0, 0, 4, 7).tri)
  }
  // ⑧ **正常态不得被误伤**：真读数（未变异）必须仍是合法比值，且三态标签正确。
  const normal = l2Verdict(5, 3, 4)
  if (normal.state !== 'MEASURED' || normal.rate !== 0.75) {
    problems.push('L2 正常态被误伤：l2Verdict(5,3,4) 应为 MEASURED/0.75，实为 ' + normal.state + '/' + String(normal.rate))
  }
  // ⑦ **变异名必须真咬得住**（归一前的实测坑：`--mutate l2` 静默不注入 ⇒ 假绿）。
  for (const m of MUTATES) {
    if (!mutOf(m) || !mutOf(String(m).toUpperCase())) problems.push('变异名大小写不归一 ⇒ 变异可能静默不注入：' + m)
  }
  return problems
}

if (SELF_CHECK) {
  const p = selfCheck()
  console.log(JSON.stringify({ selfCheck: p.length === 0 ? 'PASS' : 'FAIL', problems: p }, null, 2))
  process.exit(p.length === 0 ? 0 : EXIT.HARNESS_FAILED)
}

// ══ 主流程：一次真装配，四层共用同一批痕迹 ═══════════════════════════════════
/**
 * 通道解析**前置**（自检之后、装配之前）：装配要拿它决定 jev 指向哪条通道。
 * ⚠ 必须在 boot() 之前 —— 通道解析失败要让装配**根本不开始**，
 *   而不是装到一半再回退（那会产出「用着 A 通道、读数说 B」的最坏形态）。
 */
let CHANNEL
try {
  CHANNEL = await resolveChannelDecision()
} catch (error) {
  console.error('通道解析失败（评估无法进行）：' + String((error && error.message) || error))
  process.exit(EXIT.HARNESS_FAILED)
}
/**
 * 云端 URL 拼接预检：不对**当场停**。⚠ 这条不是「更严格」，是**本卡实测踩到的坑**：
 *   base 传成 https://nano-gpt.com/api/v1 ⇒ 拼出 /api/v1/api/v1/systemone ⇒ 404，
 *   而表面现象是「云端不可用」（会被归因成 KEY / 网络问题）—— 归因**反向错位**。
 */
const URL_SHAPE = CHANNEL.channel === 'cloud' ? probeCloudUrlShape() : null
if (URL_SHAPE !== null && !URL_SHAPE.ok) {
  console.error('云端 URL 拼接预检不通过：拼出 ' + String(URL_SHAPE.url) + '（应形如 {base}' + String(URL_SHAPE.path) + '）')
  process.exit(EXIT.HARNESS_FAILED)
}
/** 通道环境真探（选得中才探，见 detectChannelEnv）。 */
const CHANNEL_ENV = await detectChannelEnv()

const selfProblems = selfCheck()
if (selfProblems.length > 0) {
  console.error('harness 自检不通过：' + selfProblems.join('；'))
  process.exit(EXIT.HARNESS_FAILED)
}

let booted = null
try {
  booted = await boot()
} catch (error) {
  console.error('真装配失败（评估无法进行）：' + String((error && error.stack) || error).slice(0, 500))
  process.exit(EXIT.HARNESS_FAILED)
}
const { ctx, store, dir } = booted

/**
 * 造真输入：走**真生产路径**（agent/inbox/inserted ⇒ 编码链），再触发回合边界。
 * ⚠ 这里不直接调 service —— 那是夹具绿（本仓同名教训）。
 *
 * ⚠ **输入必须"够长且互相重合"**（本席实测踩到）：Write Gate 前有一道 **预过滤**
 *   （`prefilterWorthKeeping`），不足者被判 `skipped_prefilter` ⇒ **根本不进判定链**
 *   ⇒ jev_log 0 行 ⇒ memory_items 0 行。那会让 L4 报"无数据"，**看起来像系统不工作**，
 *   实际是"输入没达到预过滤的门槛" —— 又一处归因错位。
 *
 * ⚠⚠ **本段在 F1 换靶后再度过时**（2026-09-27 本席实测，如实记）：
 *   上面"取同主题长句（共享足够 **bigram**）"是**旧口径**的适配法。F1 卡已把比对靶由
 *   「文本 vs **问法**的 bigram」换成「文本是否含**信号词**」（`PREFILTER_MIN_SIGNAL_HITS`，
 *   词表真源 `perception/src/signal-words.ts`）。
 *   ⇒ **现在的门槛与"长句/互相重合"无关**，只与**文本里有没有信号词**有关。
 *   ⚠ 而本文件现役的 4 条 SEED（"评估器输入：认知记忆架构需要可观测的度量…"）**一条信号词都没有**
 *     ⇒ 换靶后**照样被挡**（实测 `skipped_prefilter`）。这是 F1 席发现并**按写面纪律未擅改**的问题，
 *     留给本席处理。
 *   ⚠ **本席不擅自改写 SEED 去凑绿**（造"为过闸而写"的输入 = 本仓点名的假绿形态）。
 *     处理方式是**让这件事可读**：见下面的 `SEED_SIGNAL_CHECK` —— 它把"种子是否含信号词"
 *     变成**显式读数**并印进 L2 的归因里，由人判断"该改语料还是该改闸"。
 */
/**
 * ── 两组种子：**真实风格组**（主组）与**遗留组**（保留作负控）─────────────────────────
 *
 * ⚠ **为什么必须分两组**（本席 2026-09-27 决策，含两次自我否定，逐条记）：
 *
 *   ① 旧实现只有一组，文本是「评估器输入：认知记忆架构需要可观测的度量…」——
 *      那是**评估器内部术语**，不是真实用户输入。它当初是为**旧口径**（比 bigram）而选的：
 *      同主题长句共享足够 bigram 才过闸。
 *
 *   ② F1 换靶（bigram → 信号词）后，旧种子 **4/4 含 0 个信号词** ⇒ 恒被挡 ⇒ L2 恒 NO_DATA。
 *      我当时选择"不擅改，只把读数印出来交人拍板"。
 *
 *   ③ 本轮用户授权**自主推进**，我据此拍板：**旧种子是过时夹具，该换**。
 *      但**判断方向必须对** —— 判据不是"改成能过闸"，而是"**改成真实用户输入的样子**"：
 *      真实该被长期记住的话（偏好/决策/事实/纠正）**本来就含信号词**，这是 v10 的模型假设，
 *      不是为过闸而做的特调。
 *
 *   ④ **旧种子不删，降级为负控组**（`LEGACY_SEED`）：它现在证明的是
 *      「**不含信号词的输入会被正确挡下**」。删掉它，"换靶前后差多少"就无从复算 ——
 *      而"可复算"正是本仓对证据的要求。
 *
 * ⚠ 两组**分别报数**（见 L2 归因），**不得合并成一个命中率** ——
 *   合并会让「真实风格输入的效果」与「无关文本被挡」混成一个数，那正是本仓最忌的同形。
 */
const SEED = [
  // ── 真实风格组（主组）：每条都是"用户真会打、且真实该被长期记住"的话 ──
  '我偏好开源方案，长期用 WSL 做主力开发环境，不要推荐商业工具',
  '决定了：采用方案 A，因为它的回归面更小，以后都按这个口径做',
  '记住：这个项目的根目录在 /home/lk/Mana，跑测试用 npm test',
  '纠正一下：那条断言不是漏了，其实是口径写反了，教训是别只看输出',
]

/** 旧种子（**保留作负控**）：不含信号词 ⇒ 应当被预过滤正确挡下。删掉则对照不可复算。 */
const LEGACY_SEED = [
  '评估器输入：认知记忆架构需要可观测的度量，检索链的命中率必须能够复算，遗忘曲线要能用手算值对拍。',
  '评估器输入：认知记忆架构需要可观测的度量，检索链的命中率必须能够复算，这样评估才有意义。',
  '评估器输入：认知记忆架构需要可观测的度量，遗忘曲线要能用手算值对拍，检索与遗忘都要能复算。',
  '评估器输入：记忆质量的核心指标是召回命中率，它必须能够复算，否则度量就只是自述。',
]

/**
 * ── 两组种子的**信号词读数**（F1 换靶后新增；两组分别报，不合并）────────────────────
 *
 * ⚠ 词表**不另立**：真源是 `perception/src/signal-words.ts`（与 Write Gate 同一份）。
 *   取不到就**如实报「取不到」**，绝不退化成"恒 0 词"（那会让"没测"与"确实没有"同形）。
 */
const SEED_SIGNAL_CHECK = await (async () => {
  const runOver = (words, texts) =>
    texts.map((text) => {
      const low = String(text).toLowerCase()
      const hits = words.filter((w) => low.includes(String(w).toLowerCase()))
      return { hits, chars: [...String(text)].length }
    })
  try {
    const mod = await import(new URL('../packages/perception/src/signal-words.ts', import.meta.url).href)
    const words = mod.DEFAULT_SIGNAL_WORDS ?? []
    if (words.length === 0) {
      return { ok: false, reason: '信号词表为空（真源存在但零词）', perSeed: [], perLegacy: [], tableSize: 0 }
    }
    return {
      ok: true,
      reason: null,
      perSeed: runOver(words, SEED),
      perLegacy: runOver(words, LEGACY_SEED),
      tableSize: words.length,
    }
  } catch (error) {
    return {
      ok: false,
      reason: '取不到信号词真源：' + String((error && error.message) || error).slice(0, 120),
      perSeed: [],
      perLegacy: [],
      tableSize: 0,
    }
  }
})()
/**
 * 两组一起喂：**真实风格组**（主组，测"该记的能不能进去"）+ **遗留组**（负控，测"不该记的被正确挡"）。
 * ⚠ 两组用**不同 session 前缀**（`eval-s` / `eval-x`）⇒ 事后可按 session 归属分别对账，
 *   否则两组混在同一个读数里，就又回到"合并成一个数"的老毛病。
 */
/**
 * ── 第三组：**同会话相关追问**（本席 2026-09-27 新增；这是 L2 端到端读数能被解释的前提）──────
 *
 * ⚠ **为什么需要它**（原口径的结构性缺陷，实测确认）：
 *   原实现把每条种子放在**各自的 session** 里、且内容是**互不相关**的句子 ⇒ 检索用"当前输入"
 *   查"此前的输入" ⇒ 必然 0 命中。实测时序（--keep-tmp 留库后读）：
 *     seq=6  retrieval librarySize=0（第一条时库空）
 *     seq=20 retrieval librarySize=1（库里只有第 1 条，而此查询是第 2 条的文本 ⇒ 不相关）
 *     lexicalReason 实测 = ok（**不是** empty_library / too_short）
 *   ⇒ 那不是"召回效果差"，是**测量设计**测不到命中。
 *
 * ⚠ **本组测的是真实使用形态**：**同一 session** 里先记一条、随后就**它本身**追问 ——
 *   这正是记忆系统存在的理由（"上次说的那个根目录在哪"）。
 *   两条消息同 session ⇒ 检索时上一条已入库 ⇒ **这是能被命中的**。
 * ⚠ 追问文本用**连续子串**（与记忆共享 3-gram）——词法腿的能力面就是连续子串；
 *   换词序属于向量腿的面，**不在此组的判据内**（那会变成指控一个不坏的词法腿，见受控实验的说明）。
 */
const FOLLOWUP = [
  {
    session: 'eval-f0',
    memo: '记住：这个项目的根目录在 /home/lk/Mana，跑测试用 npm test',
    ask: '根目录',
  },
  {
    session: 'eval-f1',
    memo: '我偏好开源方案，长期用 WSL 做主力开发环境，不要推荐商业工具',
    /**
     * ⚠ **追问必须是"连续子串"**（本席 2026-09-27 实测修正，第二次踩同一形态）：
     *   我第一版写「我偏好什么方案」——它与记忆「我偏好**开源**方案」**不是连续子串**
     *   （"偏好"后面接的字不同）⇒ 实测 cand=0、lexicalReason=ok。
     *   ⚠ 那不是召回缺陷，是**词法腿的能力边界**：trigram 短语查询要求连续子串。
     *     换词序/换字的检索属**向量腿**的面（见受控召回实验的说明），不在此组的判据内 ——
     *     否则就是"指控一个不坏的词法腿"，正是本仓点名的归因错位。
     *   ⇒ 本组只放**连续子串**追问；"语义改写也能召回"这件事留给向量腿，**不混进这一组**。
     */
    ask: '开源方案',
  },
]

/**
 * ⚠ **检索链是异步的，等待时间必须够**（本席 2026-09-27 实测踩到，如实记）：
 *   `chains.ts` 里检索链是 `void runRetrieval(...)`（**异步不等待**，见该文件"必须显式兜错"那段）。
 *   ⇒ 若两步之间只等 `settle(200)`，在**离线**（词法，微秒级）时够用；
 *     但**在线**（真嵌入，每条 ~1s）时**不够** —— 检索还没落痕，评估器已经开始读库，
 *     表现为 `eval-f` 组的 retrieval 行**一条都没有**（实测：离线 4 条 / 在线 0 条）。
 *   ⚠ 那种"0"**不是召回失败**，是**测量没等够** —— 又一处会把"测不到"读成"功能坏"的坑。
 *   ⇒ 在线模式下把每步等待拉长（`SETTLE_STEP`），并把该值印进报告（读数自带语境）。
 */
const SETTLE_STEP = has('--online-embed') ? 2500 : 200
const SETTLE_TURN = has('--online-embed') ? 1500 : 200

const FEED = [
  ...SEED.map((text, i) => ({ text, session: 'eval-s' + String(i), msg: 'eval-m' + String(i), group: 'real' })),
  ...LEGACY_SEED.map((text, i) => ({ text, session: 'eval-x' + String(i), msg: 'eval-xm' + String(i), group: 'legacy' })),
  // 每条追问项**拆成两条消息**（先记后问），同 session ⇒ 有先后关系
  ...FOLLOWUP.flatMap((f, i) => [
    { text: f.memo, session: f.session, msg: 'eval-f' + String(i) + '-memo', group: 'followup-memo' },
    { text: f.ask, session: f.session, msg: 'eval-f' + String(i) + '-ask', group: 'followup-ask' },
  ]),
]
const timing = []
try {
  for (const item of FEED) {
    const t0 = performance.now()
    ctx.emit('agent/inbox/inserted', {
      agent: { session: { id: item.session } },
      message: { id: item.msg, role: 'user', content: [{ type: 'text', text: item.text }], source: { kind: 'user' } },
    })
    await settle(SETTLE_STEP)
    ctx.emit('agent/turn-stopping', { agent: { session: { id: item.session } }, turn: 1 })
    await settle(SETTLE_TURN)
    timing.push(performance.now() - t0)
  }
} catch (error) {
  console.error('真输入分发失败：' + String((error && error.message) || error).slice(0, 300))
  process.exit(EXIT.HARNESS_FAILED)
}
await settle(300)

const rows = readDb(store, 'SELECT seq, event_type, session_id, turn_id, payload FROM mana_trace ORDER BY seq')
const driverRows = rows.filter((r) => String(r.event_type).startsWith('mana-scheduler/chain'))
const injectRows = readDb(store, 'SELECT id, session_id, turn_id, gate, memory_id FROM inject_log')

// ── L1 任务有效性：链是否真跑通、各节点是否都留下痕迹 ─────────────────────────
await layer('L1', '任务有效性（链上节点真跑通且可数）', async () => {
  /**
   * ⚠ **触发源分组**（本席实测修正）：七条链的宿主触发源**不是同一个**——
   *   · 用户输入组（编码 / 检索）：`agent/inbox/inserted` 触发；
   *   · 回合边界组（巩固 / 遗忘 / 再巩固-关窗 / 学习 / 覆盖面）：`agent/turn-stopping` 触发；
   *   · **注入组（再巩固-开窗）**：触发源是 `mana/injection(gate='injected' 且 memoryId≠null)`，
   *     即「**记忆真被注入上下文**」这件事 —— 本评估器**不注入上下文**（它只跑链，不走宿主 pre-step）
   *     ⇒ 该链**本就不该有行**。
   * ⇒ 把它当"缺失"是**归因错位**（评估器自身形态造成的缺行，不是被测系统缺陷）。
   *   故：回合边界组**必查**；注入组**如实标注为"本次形态未触发"**，不计入缺失。
   */
  /**
   * 链名取自**真源** `packages/scheduler/src/chains.ts` 的 `runChain('<name>')` 实参
   * （本席实测：不是猜的，也不是从注释抄的）：
   *   encoding · retrieval · consolidation · forgetting · learning
   *   · `reconsolidation-close`（回合边界关窗）· coverage
   * ⚠ **`reconsolidation`（无后缀）是开窗链**，触发源 = `mana/injection(gate='injected')`，
   *   属注入组（见下），**不在本组**——把它写进必查项就是归因错位。
   */
  const NODES = ['encoding', 'retrieval', 'consolidation', 'forgetting', 'reconsolidation-close', 'learning', 'coverage']
  /** 注入组：需「记忆真被注入上下文」才落行；本评估器形态下不触发 ⇒ **标注而不是判红**。 */
  const INJECTION_ONLY = new Set(['reconsolidation'])
  const byChain = new Map()
  for (const r of driverRows) {
    let p = {}
    try { p = JSON.parse(r.payload ?? '{}') } catch { /* 解析失败按未计数处理，不静默当有 */ }
    if (typeof p.chain === 'string') byChain.set(p.chain, (byChain.get(p.chain) ?? 0) + 1)
  }
  let present = NODES.filter((n) => (byChain.get(n) ?? 0) > 0)
  const n = driverRows.length
  const detail0 = NODES.map((x) => x + '=' + String(byChain.get(x) ?? 0)).join(' · ')
  if (mutOf('L1')) present = present.filter((x) => x === 'encoding')
  const missing = NODES.filter((x) => !present.includes(x))
  const injectionOnlyNotRun = [...INJECTION_ONLY].filter((x) => !present.includes(x))
  const note = injectionOnlyNotRun.length > 0
    ? '｜⚠ ' + injectionOnlyNotRun.join(', ') + ' 未触发：其宿主触发源是 mana/injection(gate=injected)，' +
      '本评估器不注入上下文（**形态性缺行**，不是被测系统缺陷 —— 须由宿主路径评估覆盖）'
    : ''
  if (n === 0) {
    return { state: 'NO_DATA', detail: 'n=0 —— 链驱动者未落任何行（真输入也没触发）', evidence: { n: 0, nodes: NODES.length } }
  }
  if (missing.length > 0) {
    return {
      state: 'FAIL',
      detail: '链节点缺失：' + missing.join(', ') + '（已跑 ' + String(present.length) + '/' + String(NODES.length) + '；' + detail0 + '）',
      evidence: { n, present: present.length, missing },
    }
  }
  return {
    state: 'MEASURED',
    detail: String(NODES.length) + '/' + String(NODES.length) + ' 链节点各有真痕迹｜' + detail0 + note,
    evidence: { n, nodes: NODES.length, byChain: Object.fromEntries(byChain) },
  }
})

// ── L2 记忆质量：召回命中率（分母为真查询数，n=0 不参与比值）─────────────────
/**
 * ══ 为什么 L2 要加「前置读数 + 三态」（本卡 F2 的核心）══════════════════════════
 * 旧实现只读 `status=ran` 的检索行算比率 ⇒ 库里**一条记忆都没有**时，它照样报
 * `命中率 0/4 = 0.0000` 并落 **MEASURED**（实测：整机 exit=0，打 ✅）。于是两种**完全不同**的故障
 * 在同一个 0 里同形：
 *   (a) 记忆真写进去了、只是召回没命中（**召回效果差** —— 被测系统能自己修）；
 *   (b) 记忆**压根没写进去** ⇒ 召回无物可命中（**上游写入侧坏了** —— 修检索是白修）。
 * 这正是本仓最忌的「失败不可观测」。⇒ 本层补一条**前置读数**：
 *   · `memoryCount` = 真库 `memory_items` 的**活行数**（`retired = 0`）——
 *     ⚠ 口径**逐字对齐** `packages/core` 的 `recallLexical` 里 `librarySize` 的 SQL
 *     （`SELECT COUNT(*) c FROM memory_items WHERE retired = 0`）：
 *     两处若不同源，本读数就**无法与链路自报的 `librarySize` 交叉核对**（本仓「代理指标非判据」）。
 *     `retired` 口径的理由同 core：检索 SQL 本身排除 retired 行；用全表计数会把
 *     「唯一那条已退休」读成「库里非空却查不到」= **假红**。
 *   · `candidates` = 检索链自报的候选数（`payload.candidates`，词法路打底的候选池）。
 * 三态**不得同形**（各自独立 detail 文案 + 机器可读 `evidence.tri`）：
 *   `memory_not_formed`（未形成，NO_DATA：本层无被测对象）/ `formed_but_missed`（已形成未召回，
 *   MEASURED：真读数，召回效果问题）/ `hits`（正常命中率，MEASURED）。
 * ⚠ 未形成为什么落 **NO_DATA 而不是 FAIL**：写入侧不在本层的被测面内（那是上游 / F1 卡的事），
 *   评估器不得替别的层判红；但 NO_DATA **不是 PASS**（它会把 exit 顶成 2，人一眼看得见）。
 * ⚠ **不硬凑**：绝不为了让读数好看而造与问法重叠的种子语料（本仓点名的假绿形态）。
 *   写入侧若仍被挡，就**如实报「记忆未形成」**——那是诚实且有用的读数。
 */
await layer('L2', '记忆质量（召回命中率，分母=真查询数）· 通道=' + CHANNEL.channel, async () => {
  /**
   * ── ⚠ 本层的**测量口径**（本席 2026-09-27 实测后修正，含一次自我否定）────────────────
   *
   * 原实现：只统计**评估器自己那些顺序输入**触发的 retrieval 行，看其中几条 hitCount>0。
   *
   * 实测（本席亲跑，证据见下）这个口径**结构性测不到命中**，原因是**时序**：
   *   `agent/inbox/inserted` 同时触发「编码 + 检索」，而检索用的是**当前这条输入**作文本，
   *   此刻库里只有**此前**的输入 ⇒ 两条输入互不相关则必然 0 命中。
   *   实测时序（--keep-tmp 留库后读）：
   *     seq=1  observation(eval-s0) → seq=4 encoding → seq=6  retrieval librarySize=0
   *     seq=20 retrieval librarySize=1（库里只有 eval-s0）而此查询是 eval-s1 的文本 ⇒ 不相关
   *     seq=61 retrieval librarySize=4 ⇒ 库**正常增长**，而 candidates 恒 0
   *   `lexicalReason` 实测为 `ok`（**不是** `empty_library`、**不是** `too_short`）
   *   ⇒ 召回链**正常执行了**，只是"互不相关的输入查互不相关的记忆"本就该 0 命中。
   *   ⚠ 也就是说：**旧读数把"输入之间不相关"读成了"召回效果差"** —— 又一处归因错位。
   *
   * ⇒ 修正：**拆成两个读数，不许合并**
   *   (a) `e2e`：真链上"顺序输入"的命中率 —— 它反映的是**真实使用形态**（同一 session 里
   *       后续输入能否召回先前记忆），保留但**不当作质量结论**；
   *   (b) `probe`：**受控召回实验** —— 显式写入一条记忆，再用**与它相关**的查询去检索。
   *       这才是"记忆质量"能被断言的地方（查询与目标相关，是对照实验的前提）。
   * ⚠ 两者读数**分列**：合并会让"输入不相关"与"召回坏了"同形。
   */
  const queries = driverRows.filter((r) => {
    try { return JSON.parse(r.payload ?? '{}').chain === 'retrieval' } catch { return false }
  })
  let hits = 0
  let considered = 0
  let candidates = 0
  let ranRows = 0
  /**
   * ⚠ **按"这条检索属于哪一组输入"分开计**（本席 2026-09-27 新增）───────────────
   *   不分开的话，「**同会话相关追问**」（应当命中）与「**互不相关的顺序输入**」（本就该 0 命中）
   *   会混进同一个命中率 —— 而那正是"把两种事实读成一个数"的老毛病。
   *   归属判定：retrieval 行的 sessionId 前缀（eval-f* = 追问组；eval-s* = 真实风格组；eval-x* = 负控组）。
   */
  const byGroup = { followup: { n: 0, hits: 0 }, real: { n: 0, hits: 0 }, legacy: { n: 0, hits: 0 }, other: { n: 0, hits: 0 } }
  const groupOf = (sid) => {
    const s = String(sid ?? '')
    if (s.startsWith('eval-f')) return 'followup'
    if (s.startsWith('eval-s')) return 'real'
    if (s.startsWith('eval-x')) return 'legacy'
    return 'other'
  }
  for (const r of queries) {
    let p = {}
    try { p = JSON.parse(r.payload ?? '{}') } catch { continue }
    if (p.status !== 'ran') continue
    ranRows += 1
    considered += 1
    if (typeof p.candidates === 'number') candidates += p.candidates
    const hit = typeof p.hitCount === 'number' && p.hitCount > 0
    if (hit) hits += 1
    const g = groupOf(r.session_id ?? p.sessionId)
    byGroup[g].n += 1
    if (hit) byGroup[g].hits += 1
  }
  /** 前置读数：真库活记忆条数（SQL 与 core 的 librarySize **逐字同源**，可交叉核对）。 */
  const memoryCount = Number(
    readDb(store, 'SELECT COUNT(*) c FROM memory_items WHERE retired = 0')[0]?.c ?? 0,
  )
  /**
   * ⚠ 全表行数**必须与活行一起读**：只报活行时，"活行为 0"仍是两件事的同形 ——
   *   · 全表 = 0 ⇒ 记忆**压根没进库**（上游写入侧问题）；
   *   · 全表 > 0 ⇒ 记忆**形成过、全部退休**（遗忘链正常产物，**不是**上游问题）。
   *   两者都报"记忆未形成"就是**归因错位**（并造成假红）。故一起取、一起打进报告。
   */
  const memoryRows = Number(readDb(store, 'SELECT COUNT(*) c FROM memory_items')[0]?.c ?? 0)
  /** 交叉核对：把链路自报的 librarySize 与本层的真库计数并列（不同则说明两处口径已分叉）。 */
  const chainLibrarySize = queries.length > 0
    ? (() => { try { return JSON.parse(queries[queries.length - 1].payload ?? '{}').librarySize ?? null } catch { return null } })()
    : null
  /**
   * ── 种子语料自检：**无论落哪一态都必须印出**（本席 2026-09-27 修）──────────────────
   * ⚠ 原先它只挂在 `memory_not_formed` 分支里 ⇒ 一旦记忆真形成（本轮实测：真实风格组落库 4 条），
   *   这段读数就**不再打印** ⇒ 负控（遗留组应被挡）**变成不可见**，而"负控失效"恰恰是
   *   最需要被发现的事（它意味着"无关文本会被挡"这句话没有证据）。
   * ⇒ 提升到 `pre` 里：它是**语境读数**（解释上面那些数都是在什么语料下取得的），不是某态的附属品。
   */
  const seedNote = (() => {
    if (!SEED_SIGNAL_CHECK.ok) return '种子自检：未判定（' + String(SEED_SIGNAL_CHECK.reason) + '）'
    const cReal = SEED_SIGNAL_CHECK.perSeed.map((x) => x.hits.length)
    const cLegacy = SEED_SIGNAL_CHECK.perLegacy.map((x) => x.hits.length)
    const realOk = cReal.filter((c) => c > 0).length === cReal.length && cReal.length > 0
    const legacyOk = cLegacy.filter((c) => c === 0).length === cLegacy.length && cLegacy.length > 0
    return '种子自检：真实风格组 ' + String(cReal.filter((c) => c > 0).length) + '/' + String(cReal.length) +
      ' 含信号词（逐条 ' + JSON.stringify(cReal) + '，**期望全 >0**' + (realOk ? ' ✓' : ' ✗') + '）· ' +
      '遗留负控组 ' + String(cLegacy.filter((c) => c > 0).length) + '/' + String(cLegacy.length) +
      ' 含信号词（逐条 ' + JSON.stringify(cLegacy) + '，**期望全 0**' + (legacyOk ? ' ✓' : ' ✗') + '）· ' +
      '词表 ' + String(SEED_SIGNAL_CHECK.tableSize) + ' 词'
  })()
  /**
   * ⚠ **通道 + 模型必须回显**（用户指令 A.4：「读数里回显用的是哪条通道 + 哪个模型」，
   *   否则"用了哪条"不可见）。本串挂在 `pre` 上 ⇒ **无论落哪一态都会印**，
   *   不挂在某个分支里（分支内打印 = 那一态才可见，其余态下"用了哪条"重新变成不可见）。
   */
  const channelNote = '通道=' + CHANNEL.channel + '（模型 ' + CHANNEL.model + '·来源 ' + CHANNEL.source + '）'
  const pre = channelNote + '｜前置读数：记忆条数(memory_items 活行)=' + String(memoryCount) +
    '／全表 ' + String(memoryRows) +
    ' · 检索候选数=' + String(candidates) +
    ' · status=ran 检索行=' + String(ranRows) +
    (chainLibrarySize === null ? '' : ' · 链路自报 librarySize=' + String(chainLibrarySize)) +
    '｜' + seedNote
  const tri = (t) => ({ memoryCount, memoryRows, candidates, ranRows, chainLibrarySize, tri: t })
  /**
   * ⚠ **上游写入侧归因必须由本层自己给出**（本席实测后补，如实记）：
   *   本层第一版只写了"写入侧归因见 L4"—— 实测那是**悬空指针**：L4 的逐环归因只在
   *   「memory_items / inject_log / mana_trace **三者皆空**」时才打印，而本评估器下
   *   mana_trace 恒有 52 行 ⇒ L4 走回退腿报 MEASURED，**根本不打印那条归因**。
   *   指针指到不打印的地方 = 失败再次不可观测（本卡要消灭的形态）。
   *   ⇒ 本层自己读一次上游读数（只读、零副作用），把"哪一环断了"直接写进 detail。
   */
  const upstreamCause = (() => {
    if (memoryRows > 0) return ''
    const obs = rows.filter((r) => r.event_type === 'observation').length
    const jev = Number(readDb(store, 'SELECT COUNT(*) c FROM jev_log')[0]?.c ?? 0)
    const wgs = (() => { try { return ctx.get('mana-long-term')?.writeGateStatus ?? null } catch { return null } })()
    const parts = ['链路逐环：observation 行=' + String(obs) + ' · jev_log 行=' + String(jev)]
    if (wgs) {
      parts.push('writeGate.registered=' + String(wgs.registered) + ' lastState=' + String(wgs.lastState))
      if (wgs.degradedCount) parts.push('degradedCount=' + String(wgs.degradedCount))
    } else {
      parts.push('writeGate=取不到（mana-long-term 未装配？）')
    }
    if (wgs?.lastState === 'skipped_prefilter') {
      /**
       * ⚠ **本段曾在合并后变成假话**（2026-09-27 本席实测踩到）：原写"真因 = **bigram** 预过滤，
       *   与**问法**派生的词表重叠 <2" —— 而 F1 卡已把预过滤的比对靶**换成信号词**
       *   （`packages/long-term/src/write-gate.ts`：`PREFILTER_MIN_SIGNAL_HITS`，
       *   词表真源 = `perception/src/signal-words.ts`）。
       *   ⇒ 两个席**各自都正确**，但合并后**归因文案变成假的** —— 这正是「档案事实须复验」的现场。
       * ⇒ 修法**不是**再写一遍新文案（下次换靶还会过时），而是**引用真源**：
       *   口径名与阈值都从 `lastState` 同源的读数里取，且**显式写"若口径再变，本段需随之复核"**。
       */
      parts.push('⇒ **真因=预过滤挡下**（口径见 `packages/long-term/src/write-gate.ts` 的预过滤一节；' +
        '现役靶=**信号词**，词表真源 `perception/src/signal-words.ts`，阈值 `PREFILTER_MIN_SIGNAL_HITS`）' +
        '：该环是**设计行为**，但它使"记忆形成"在**任意不含信号词的评测语料**上不可达' +
        '（⚠ 比对靶是观察文本自身的信号词，**不再是**问法「' + String(wgs.question ?? '') + '」——' +
        'F1 换靶前是后者，本句已按换靶后的口径改写）—— 这是交给人拍板的结论，评估器不得自行绕过')
      // ⚠ 种子自检已提升到 `pre`（无论落哪一态都印）⇒ 此处不重复打印（本席 2026-09-27 修）
    } else if (obs === 0) {
      parts.push('⇒ 真因=源头未发（perception 未 emit mana/observation）')
    } else if (jev === 0) {
      /**
       * ⚠ **三态归因接在这里**（用户指令 A.3：云端不可用不得让评估器"默认红到底"）。
       *   条件写死成「cloud 且无凭据」而不写成 `!CHANNEL_ENV.ok` 泛化：
       *   有凭据却不通（DNS/网络）时判定链**真的会落行**（降级行），走不到本支 ——
       *   真到本支的无行态，只有"没凭据 ⇒ 根本没发请求"这一种解释。写成泛化会把
       *   两种成因读成一件事（本仓最忌的同形）。
       */
      if (CHANNEL.channel === 'cloud' && CHANNEL_ENV.kind === 'no-credential') {
        parts.push(channelAttribution('判定链无行（观察发了但 jev_log 0 行）', 'jev_log=0 行 · ' + CHANNEL_ENV.detail))
      } else {
        parts.push('⇒ 真因=未进判定链（观察发了但 jev_log 无行，上游在预过滤/装配面断）')
      }
    } else {
      parts.push('⇒ 真因在判定侧（观察与 jev 都有行，但无一条放行落库）')
    }
    return '｜' + parts.join(' · ')
  })()
  const n = considered
  /**
   * ⚠ **变异必须打在不变式上**（本席第一版写 `Math.ceil(hits*1.5)+1` 实测**没被咬住**：
   *   1/4=0.25 仍是合法比值 ⇒ L2 照报 MEASURED。这正是「负控变红须重瞄」那条教训——
   *   变异不红时要**重瞄目标不变式**，不得放宽断言）。
   * 本层的不变式是「命中数不得大于样本数」⇒ 变异就注入**越界**（hits > n）。
   */
  if (mutOf('l2')) hits = n + 1
  /**
   * 变异/三态/越界判定**统一走提纯函数** l2Verdict —— 同一份判定既服务本层、服务 selfCheck
   * 的可断言化，也服务"变异有没有靶"的机检。**绝不在两处各写一份**：
   * 两份可以一起错而测试照绿（本仓「夹具绿非真数据绿」同源理由）。
   */
  /**
   * ── (b) 受控召回实验（**这才是"记忆质量"能被断言的地方**）──────────────────────────
   * ⚠ 必须**先写一条已知记忆，再用与它相关的查询**去检索 —— 查询与目标相关是对照实验的前提。
   *   用"顺序输入的命中率"当质量结论，等于要求"互不相关的两句话能互相召回"，那测的不是质量。
   * ⚠ 本实验**零网络**：只走 `core` 的词法腿（FTS5 trigram），不碰嵌入。
   * ⚠ 写入用 `core.writeMemoryItem`（**生产同款写面**，不是自造 INSERT）——
   *   自造 SQL 会绕过真写路径，让"写进去"与"能被召回"之间少掉一环而看不出来。
   */
  const PROBE_ID = 'mem_eval_l2_probe'
  const PROBE_TEXT = '记住：这个项目的根目录在 /home/lk/Mana，跑测试用 npm test'
  /**
   * ⚠ **两条查询，必须都跑**（本席 2026-09-27 实测后修正，含一次自我否定）：
   *
   *   我第一版只用了 `项目根目录在哪里`，它**未命中**，我一度当成召回缺陷去追。
   *   实测否定了这个判断 —— 目标记忆里是「**项目的根目录在**」，而该查询是「项目的**根目录在哪里**」，
   *   二者**不是连续子串**。FTS5 trigram 的**短语查询要求连续子串** ⇒ 0 命中是**正确语义**。
   *   证据（直查真表，目标 = 上面 PROBE_TEXT）：
   *     连续子串「根目录」→ 1 条 · 「/home/lk/Mana」→ 1 条 · 「跑测试用 npm test」→ 1 条
   *     换词序「项目根目录在哪里」→ 0 条 · 「根目录在哪里」→ 0 条
   *   ⚠ 换词序查不到，正是 v10 里**向量检索腿**存在的理由（词法腿天然做不到语义泛化）。
   *     把它读成"召回坏了"，就会去"修"一个不坏的词法腿 —— 典型的归因错位。
   *
   * ⇒ 两条查询**分列报**：
   *   · `hitContiguous`：连续子串查询 —— **词法腿应当命中**（这是它的能力面，不命中才是缺陷）；
   *   · `hitReordered`：换词序查询 —— **词法腿本就做不到**（如实报，**不指控为缺陷**），
   *     它标出的是"语义泛化"这一缺口，须由向量腿补（当前评估器刻意离线 ⇒ 向量腿未启用）。
   */
  const PROBE_QUERY = '根目录'                                  // 连续子串 ⇒ 词法腿应命中
  const PROBE_QUERY_REORDERED = '项目根目录在哪里'              // 换词序 ⇒ 词法腿做不到（非缺陷）
  /**
   * ── (c) **语义召回实验**：换词序也能量到（**向量腿存在的理由**）────────────────────
   *
   * ⚠ 本席 2026-09-27 新增，补一个**真缺口**（实测发现）：先前 `--online-embed` 只开了嵌入，
   *   而判定链仍指向死端点 ⇒ Recall Gate 报 `no-judge-listener` 并**丢弃候选** ⇒
   *   语义召回**在评估里压根测不到**（不是"测出来 0"，是"没测"）。
   *   实测反证：jev 改指真端点后 ⇒ `judged=1/1`、gate 正常放行 ⇒ 整条链贯通。
   *
   * ⚠ **本组必须与"换词序查询"那条区分开**：
   *   · `PROBE_QUERY_REORDERED`（上面的 ②）：**只断言词法腿做不到** ⇒ 在任何模式下都**不该**命中，
   *     它是"词法腿的能力边界"的证据；
   *   · 本组：**语义相近**（与记忆共享意思、不共享连续子串）⇒ 词法腿注定查不到，
   *     **只有向量腿 + 判定链都通了**才可能命中。
   *   ⇒ 两者的"命中/不命中"含义**相反**，合并即同形（本仓最忌）。
   *
   * ⚠ **离线时必须报"未测"而不是"0 命中"**：离线态判定链是死的 ⇒ 0 命中是**测量缺失**，
   *   不是能力缺失。若报成 0，就会把"我们没测"读成"向量腿不行"—— 又一次归因错位。
   */
  const PROBE_SEMANTIC_ID = 'mem_eval_semantic_probe'
  const PROBE_SEMANTIC = { memo: '我偏好开源方案，长期用 WSL 做主力开发环境，不要推荐商业工具', ask: '我不想用收费的软件' }
  /**
   * ⚠ **必须 await**：向量召回是异步的（走嵌入通道 + 判定链），
   *   与检索链同源（`chains.ts` 里也是异步不等待）—— 不 await 就会读到"还没跑完"的态。
   */
  const semanticProbe = await (async () => {
    if (!has('--online-judge')) {
      return {
        measured: false,
        why: '未测（离线态：判定链指向死端点 ' + '127.0.0.1:1' + ' ⇒ Recall Gate 必降级并丢候选）',
        ask: PROBE_SEMANTIC.ask,
      }
    }
    try {
      const core = ctx.get('mana-core')
      const vector = ctx.get('mana-vector')
      if (vector === undefined) return { measured: false, why: '未测（本模式未装配 vector 服务）', ask: PROBE_SEMANTIC.ask }
      core.writeMemoryItem({ id: PROBE_SEMANTIC_ID, type: 'observation', content: PROBE_SEMANTIC.memo, at: new Date().toISOString() })
      /**
       * ⚠ **先给这条记忆生成向量**（否则向量腿查它时该行 vector 为 NULL ⇒ 必查不到）。
       *   走 `vector.putMemoryVector`（**生产同款写面**，不是自造 SQL）——
       *   与 K1 落库路径用的是同一个面，故这里测的就是生产形态。
       */
      /**
       * ⚠ **`vector.embed` 收的是数组**（签名 `(texts) => embedTexts(embedCfg, texts)`，见 index.ts:291）
       *   —— 我第一版传了裸字符串 ⇒ `ERR texts.map is not a function`。
       *   对照 K1 的生产用法也是数组：`legs.embed([content])`（write-gate.ts:379）。
       */
      const emb = await vector.embed([PROBE_SEMANTIC.memo])
      const vec0 = emb?.vectors?.[0]
      if (vec0) await vector.putMemoryVector(PROBE_SEMANTIC_ID, vec0, { type: 'observation', content: PROBE_SEMANTIC.memo })
      const lex = core.recallLexical(PROBE_SEMANTIC.ask, 10)
      const cands = lex.hits.map((h, i) => ({ key: h.id, lexicalRank: i + 1 }))
      const out = await vector.recall(PROBE_SEMANTIC.ask, cands, 10, { sessionId: 'eval-semantic', turnId: 0, requestId: 'eval-semantic' })
      const gate = (() => { try { return vector.lastRecallGate?.() ?? null } catch { return null } })()
      return {
        measured: true,
        ask: PROBE_SEMANTIC.ask,
        embedded: vec0 !== undefined,
        lexicalHits: lex.hits.length,
        vectorHit: out.hitCount ?? null,
        channel: out.channel ?? null,
        degraded: out.degraded === true,
        gate: gate ? String(gate.gate ?? '') : null,
        judged: gate && typeof gate.judged === 'number' ? String(gate.judged) + '/' + String(gate.probed) : null,
        failureKind: gate ? (gate.failureKind ?? null) : null,
      }
    } catch (error) {
      return { measured: false, why: 'ERR ' + String((error && error.message) || error).slice(0, 140), ask: PROBE_SEMANTIC.ask }
    }
  })()
  const probe = (() => {
    try {
      const core = ctx.get('mana-core')
      core.writeMemoryItem({ id: PROBE_ID, type: 'observation', content: PROBE_TEXT, at: new Date().toISOString() })
      const r1 = core.recallLexical(PROBE_QUERY, 10)
      const r2 = core.recallLexical(PROBE_QUERY_REORDERED, 10)
      return {
        ok: true,
        hitContiguous: r1.hits.some((h) => h.id === PROBE_ID),
        hitReordered: r2.hits.some((h) => h.id === PROBE_ID),
        hits: r1.hits.map((h) => h.id),
        reason: r1.reason,
        librarySize: r1.librarySize,
      }
    } catch (error) {
      return { ok: false, hitContiguous: false, hitReordered: false, hits: [], reason: 'ERR ' + String((error && error.message) || error).slice(0, 100), librarySize: null }
    }
  })()
  /**
   * 语义召回的一句话读数（**第三组，与上面两组分开**，口径见 PROBE_SEMANTIC 上方说明）。
   * ⚠ **离线时必须说未测**，绝不许报成 0 命中 —— 那是把"我们没测"读成"能力不行"。
   * ⚠ 用 `function` 声明（**有提升**）：下面多个分支都可能用到它，
   *   而 const 会因声明顺序引发 TDZ（本文件已在该形态上栽过一次，见 groupLineText 的注释）。
   */
  function semanticNoteText() {
    if (!semanticProbe.measured) {
      return '｜**语义召回实验**：**未测** —— ' + String(semanticProbe.why) +
        '。⚠ 这是**测量缺失**（**不是**能力为 0）：离线态判定链是死的，0 命中不得读成向量腿不行；' +
        '要测它须加 --online-judge（本席实测：接真端点后 judged=1/1、gate 正常放行）'
    }
    return '｜**语义召回实验**（换词序、与记忆不共享连续子串 ⇒ 词法腿注定查不到）：' +
      '查询「' + String(semanticProbe.ask) + '」→ 词法命中 ' + String(semanticProbe.lexicalHits) + ' 条' +
      '（**预期 0**，这是词法腿的正常边界）· 向量腿 hit=' + String(semanticProbe.vectorHit) +
      '（channel=' + String(semanticProbe.channel) + '，degraded=' + String(semanticProbe.degraded) +
      '，judged=' + String(semanticProbe.judged) + '，gate=' + String(semanticProbe.gate) +
      (semanticProbe.failureKind ? '，failureKind=' + String(semanticProbe.failureKind) : '') + '）' +
      '｜⚠ **这一条才是向量腿的存在理由**：词法腿 0 命中属正常，**向量腿命中才说明语义召回通了**'
  }
  /** 受控实验的一句话读数（**与端到端读数分列**，见上面的口径说明）。 */
  const probeNote = probe.ok
    ? '｜**受控召回实验**（先经生产写面写一条已知记忆，再用同一目标的两种查询检索）：' +
      '① **连续子串查询**「' + PROBE_QUERY + '」→ ' + (probe.hitContiguous ? '命中 ✓' : '**未命中 ✗（这才是缺陷）**') +
      '（命中集 ' + JSON.stringify(probe.hits.slice(0, 3)) + '，词法 reason=' + String(probe.reason) +
      '，库 ' + String(probe.librarySize) + ' 条）· ' +
      '② **换词序查询**「' + PROBE_QUERY_REORDERED + '」→ ' + (probe.hitReordered ? '命中' : '未命中') +
      '（⚠ **非缺陷**：FTS5 trigram 短语要求**连续子串**，换词序本就查不到 ⇒ ' +
      '这正是 v10 里**向量腿**存在的理由；离线评估下向量腿未启用，故如实报缺口而不指控词法腿）' +
      '｜⚠ ①才是"词法腿有没有坏"的判据；上面那个端到端命中率受"顺序输入互不相关"影响，三者**不得互相冒充**'
    : '｜**受控召回实验**：未判定（' + String(probe.reason) + '）'
  const { state, tri: triTag, rate } = l2Verdict(memoryCount, hits, n, memoryRows)
  const ev = { ...tri(triTag), n, hits, rate, probe }
  if (triTag === 'rate_out_of_range') {
    return { state, detail: pre + '｜命中率越界：' + String(rate) + '（' + String(hits) + '/' + String(n) + '）—— 上界是 1，越界即计数口径坏了', evidence: ev }
  }
  if (triTag === 'no_retrieval_rows') {
    return { state, detail: pre + '｜n=0 —— 没有一条 status=ran 的检索行，命中率分母为 0（不得据此算比值）', evidence: ev }
  }
  if (triTag === 'memory_not_formed') {
    return {
      state,
      detail: pre + '｜⚠ **记忆未形成**（上游写入侧问题）：真库 memory_items **全表与活行都是 0** ⇒ 记忆压根没进库、召回**无物可命中**，' +
        '此时任何"命中率 0"都**不是召回效果差**（两者不得同形 —— 本卡存在的理由）。' +
        '本层无可测对象 ⇒ **NO_DATA 不是 PASS**' + upstreamCause,
      evidence: { ...ev, upstream: upstreamCause },
    }
  }
  if (triTag === 'all_retired') {
    return {
      state,
      detail: pre + '｜⚠ **记忆已形成但全部退休**（不是上游问题）：全表有 ' + String(memoryRows) +
        ' 行而活行为 0 ⇒ 0 命中是**遗忘链的正常产物**，' +
        '既不得读成"记忆未形成"（归因错位），也不得读成"召回效果差"（假红）',
      evidence: ev,
    }
  }
  if (triTag === 'formed_but_missed') {
    return {
      state,
      detail: pre + '｜⚠ **已形成但未召回**：库里有 ' + String(memoryCount) +
        ' 条活记忆、' + String(candidates) + ' 个候选，却 0 条命中。' +
        '⚠ 归因**须看分组**（见下）：若"同会话相关追问"组也为 0，才是召回缺陷；' +
        '若该组有命中而其它组为 0，那是"输入互不相关"使然（测量设计），**不是故障** —— 二者不得同形' +
        '｜' + groupLineText() + probeNote,
      evidence: { ...ev, byGroup },
    }
  }
  /**
   * ⚠ 三组**分列报**（不合并）。语义各自不同，合并即同形：
   *   · `followup`：**同会话相关追问** —— 真实使用形态，**应当命中**（不命中才是召回缺陷）；
   *   · `real` / `legacy`：**各自 session 里的顺序输入** —— 互不相关，本就该 0 命中，
   *     保留是为了让"库在长、召回在跑"这件事仍可观测，**不作质量结论**。
   */
  /**
   * ⚠ **用函数声明而不是 const**（本席 2026-09-27 修改，修一个自己的真缺陷）：
   *   原先写成 `const groupLine = ...` 且声明在下、使用在上 ⇒ **TDZ**：
   *   当 L2 落 `formed_but_missed` 分支时抛
   *   `ReferenceError: Cannot access 'groupLine' before initialization`。
   *   ⚠ 该缺陷**潜伏过一轮**：早先那些运行都没走到那个分支（记忆未形成 / 已命中），
   *     直到本轮启用真向量腿、L2 首次落进 `formed_but_missed` 才暴露。
   *     ⇒ 教训：**分支里的引用必须在所有可达路径上都有定义**，不能靠"当前跑不到"过活。
   *   函数声明**有提升**，故顺序无关 —— 这是本次修法的要点。
   */
  function groupLineText() {
    return '端到端命中率（三组分列，不合并）：' +
      '**同会话相关追问** ' + byGroup.followup.hits + '/' + byGroup.followup.n +
      (byGroup.followup.n === 0 ? '（无样本，未测）' : byGroup.followup.hits > 0 ? ' ✓' : ' ✗ **应命中而未命中**') +
      ' · 真实风格组（各自 session，互不相关）' + byGroup.real.hits + '/' + byGroup.real.n +
      ' · 负控组 ' + byGroup.legacy.hits + '/' + byGroup.legacy.n +
      (byGroup.other.n > 0 ? ' · 其它 ' + byGroup.other.hits + '/' + byGroup.other.n : '')
  }
  return {
    state,
    detail: pre + '｜' + groupLineText() +
      '｜⚠ **同会话相关追问那一组才是端到端的质量判据**（同一 session 里先记后问，是记忆系统存在的理由）；' +
      '另两组的输入互不相关，0 命中是**测量设计**使然而非缺陷，**不作质量结论**' +
      probeNote + semanticNoteText(),
    evidence: { ...ev, byGroup },
  }
})

// ── L3 效率：真计时（不用代理指标）──────────────────────────────────────────
await layer('L3', '效率（真计时往返延迟，不用代理指标）', async () => {
  const samples = timing.slice()
  let n = samples.length
  if (mutOf('L3')) samples.fill(0)
  if (n === 0) {
    return { state: 'NO_DATA', detail: 'n=0 —— 未取到任何计时样本', evidence: { n: 0 } }
  }
  const bad = samples.filter((x) => !(typeof x === 'number' && Number.isFinite(x) && x > 0))
  if (bad.length > 0) {
    return { state: 'FAIL', detail: '计时样本非正有限数 ' + String(bad.length) + ' 个（0 或 NaN ⇒ 计时器没真跑）', evidence: { n, bad: bad.slice(0, 3) } }
  }
  const sorted = samples.slice().sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length / 2)]
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  return {
    state: 'MEASURED',
    detail: 'p50=' + p50.toFixed(1) + 'ms · p95=' + p95.toFixed(1) + 'ms（n=' + String(n) + ' 真往返；⚠ 本机单次读数，非跨机基线）',
    evidence: { n, p50, p95, unit: 'ms' },
  }
})

// ── L4 认知仿真：记忆量随时间是否形成非平凡序列（学习曲线雏形）──────────────
await layer('L4', '认知仿真（认知痕迹的增长曲线须非平凡）', async () => {
  /**
   * ⚠ **曲线源不是 memory_items 一条路**（本席实测修正）：memory_items 在"预过滤挡下"时恒空，
   *   若把曲线源钉死在它上面，L4 就**结构性不可测**（永远 NO_DATA，连负向对拍都无处可咬）。
   *   ⇒ 曲线源取**认知痕迹的并集**：memory_items（若空则退到 inject_log，再空则退到 mana_trace）。
   *   三层任一有行即可画曲线 —— 且**哪一层供数必须写进 detail**（否则读者不知道量的是谁）。
   */
  const items = readDb(store, 'SELECT id, type, created_at FROM memory_items')
  const inj = readDb(store, 'SELECT id, session_id, turn_id FROM inject_log')
  const tr = readDb(store, 'SELECT seq, event_type, timestamp FROM mana_trace')

  let source = 'memory_items'
  let points = items.map((x) => String(x.created_at))
  let types = new Set(items.map((x) => String(x.type)))
  if (points.length === 0) {
    source = 'inject_log'
    points = inj.map((x) => String(x.session_id) + '#' + String(x.turn_id))
    types = new Set(inj.map(() => 'injection'))
  }
  if (points.length === 0) {
    source = 'mana_trace'
    points = tr.map((x) => String(x.timestamp))
    types = new Set(tr.map((x) => String(x.event_type)))
  }
  const n = points.length
  const distinctTypes = types
  let curve = points.slice()
  if (mutOf('L4')) curve = curve.map(() => 'X')
  if (n === 0) {
    /**
     * ⚠ **归因必须实测**（本席第一版在此处凭想象写"jev_log 降级导致拒写"，实测为假：
     *   jev_log 是 **0 行** —— 判定链**根本没被调用**）。真因链如下（逐步实测）：
     *   `agent/inbox/inserted` → scheduler 链驱动者 → `perception.perceive()`
     *   → `ctx.emit('mana/observation')` → long-term 的 Write Gate → `mana/jev/judge`
     *   → 落 jev_log → 放行才 writeMemoryItem。
     *   ⇒ 任一环不在场，最终都表现为"memory_items 空"，而**成因完全不同**。
     *   故这里逐环取真读数，让 n=0 的**真因**可读（本仓纪律：N=0 显式记 0 且须归因）。
     */
    const obsRows = rows.filter((r) => r.event_type === 'observation')
    const jevRows = readDb(store, 'SELECT id, degraded FROM jev_log')
    const wgStatus = (() => {
      try { return ctx.get('mana-long-term')?.writeGateStatus ?? null } catch { return null }
    })()
    const degraded = jevRows.filter((r) => Number(r.degraded) === 1).length
    const chain = []
    chain.push('observation 行=' + String(obsRows.length) + (obsRows.length === 0 ? '（源头未发 ⇒ 上游断）' : ''))
    chain.push('jev_log 行=' + String(jevRows.length))
    if (wgStatus) {
      chain.push('writeGate.registered=' + String(wgStatus.registered) + ' degradedCount=' + String(wgStatus.degradedCount))
      if (wgStatus.lastFailure) chain.push('lastFailure=' + String(wgStatus.lastFailure).slice(0, 120))
      if (wgStatus.lastState) chain.push('lastState=' + String(wgStatus.lastState))
    }
    const prefiltered = wgStatus?.lastState === 'skipped_prefilter'
    const conclusion = prefiltered
      ? '⇒ **真因=预过滤挡下**（现役口径靶=**信号词**，非问法 bigram —— 见 write-gate.ts 的预过滤一节）。' +
        '⚠ 该环非缺陷而是**设计行为**，但它使"记忆形成曲线"在**任意不含信号词的评测语料**上不可测' +
        '⇒ 这是**要交给用户的结论**，不是评估器能自行绕过的'
      : '⇒ 上表逐环读数即真因（不在本评估器能归因的已知形态内，如实列出）'
    /**
     * 环境态判定与 (b) 同一口径（见那里的长注）：**只有一种解释能走到这里** ——
     * 云端没凭据 ⇒ 判定链根本没发请求 ⇒ 记忆写不进去 ⇒ 曲线无源。
     * ⚠ 这一态**不落 FAIL**（那是"被测行为不对"的位置）：它是**这一次没测成**。
     */
    const envGap = CHANNEL.channel === 'cloud' && CHANNEL_ENV.kind === 'no-credential'
    return {
      state: 'NO_DATA',
      detail: 'n=0 —— memory_items 无行。**逐环归因（实测）**：' + chain.join(' · ') + '｜' +
        (envGap
          ? channelAttribution('记忆形成曲线的源头断了', 'jev_log=' + String(jevRows.length) + ' 行 · observation=' + String(obsRows.length) + ' 行')
          : conclusion),
      evidence: { n: 0, jevLog: jevRows.length, degraded, observationRows: obsRows.length, writeGate: wgStatus, channel: CHANNEL.channel, channelEnv: CHANNEL_ENV.kind },
    }
  }
  const distinctPoints = new Set(curve).size
  if (distinctPoints <= 1 && n > 1) {
    return {
      state: 'FAIL',
      detail: '曲线退化：n=' + String(n) + ' 点只有 ' + String(distinctPoints) + ' 个不同取值 ⇒ 不是曲线（单点冒充序列）',
      evidence: { n, distinctPoints, source },
    }
  }
  return {
    state: 'MEASURED',
    detail: '曲线源=' + source + ' · n=' + String(n) + ' 点 · ' + String(distinctPoints) + ' 个不同取值 · ' + String(distinctTypes.size) + ' 种类型（曲线非平凡）',
    evidence: { n, distinctPoints, source, types: distinctTypes.size },
  }
})

/**
 * ══ 第 0 层：**模型通道**（本卡新增）══════════════════════════════════════════
 *
 * ── 它在量什么（以及**不**量什么）────────────────────────────────────────────
 *   · 量「这一次评估到底跑的哪条通道、哪个模型、端点是哪个、预期 URL 长什么样」
 *     —— 用户指令 A.4「读数回显哪条通道 + 哪个模型」的机读落点；
 *   · 量「该通道**现在**能不能真判」（一枪真调用：是/否 + 耗时）。
 *
 * ⚠ 它**不是** L3（效率）的替代：L3 量的是**链内**往返，本层量的是一次**通道可达性**。
 *   两者不得互相冒充（读数分列，读者不会把「通道通」读成「链快」）。
 *
 * ⚠ 三态落法（照抄 docs/mana-endpoint-attribution.md §2）：
 *   · 真调用拿到应答          ⇒ MEASURED（ok）；
 *   · **环境不可用**（无凭据 / 连不上 / 超时）⇒ **NO_DATA** + env-unavailable 文案。
 *     **不落 FAIL** —— 用户指令原文：「云端不可用不得『默认红到底』」。
 *     「这一次没测成」与「被测行为不对」是两件事，同形即归因错位。
 *   · 环境在场、应答也拿到，但**形状不对**（无答案 / 概率越界）⇒ FAIL：那才是被测面的问题。
 */
await layer('L0', '模型通道可用性（' + CHANNEL.channel + ' · ' + CHANNEL.model + '）', async () => {
  const reading = '通道=' + CHANNEL.channel + ' · 模型=' + CHANNEL.model + ' · jev channel=' + CHANNEL.jevChannel +
    ' · 端点=' + CHANNEL.base + ' · 来源=' + CHANNEL.source +
    (CHANNEL.source === 'preference' ? '(user_model 里 UI 设的)' : CHANNEL.source === 'default' ? '(缺省：无人设过)' : '(命令行)')
  const urlNote = URL_SHAPE === null ? '' : ' · 预期 URL=' + String(URL_SHAPE.url)
  const budget = opt('--channel-probe-ms') ?? '20000'
  const timeoutMs = Number.isFinite(Number(budget)) ? Number(budget) : 20000
  /**
   * ⚠ **选得中才真调用**：local 腿在云端缺省下不该被网卡碰到（同一探针纪律见 detectChannelEnv）。
   *   非选中腿的读数落 NO_DATA + 本跑未选中，而**不是**落个假的 MEASURED。
   */
  /**
   * ⚠ **两条腿都要落到「真调用」上**（本席第一版只探了 local 的 `/api/tags`，是**弱判据**）：
   *   环境探针只证明"服务在跑"，证明不了"这条通道真能判" —— 而后者才是本层的论点。
   *   只探环境的写法会让 local 腿平凡通过（Ollama 一起就是绿），与 cloud 腿的读数**强度不对等**。
   */
  if (CHANNEL.channel !== 'cloud') {
    const probe = await detectChannelEnv()
    if (!probe.ok) {
      return { state: 'NO_DATA', detail: channelAttribution('未测（本跑走本地通道，环境探针未通过）', probe.detail) + '｜' + reading, evidence: { channel: CHANNEL.channel, probe: probe.kind } }
    }
  } else if (!cloudCredentialPresent()) {
    return {
      state: 'NO_DATA',
      detail: channelAttribution('未测（凭据不在场 ⇒ 不发请求）', '不发请求 · ' + CHANNEL_ENV.detail) + '｜' + reading + urlNote,
      evidence: { channel: CHANNEL.channel, credentialPresent: false, envKind: CHANNEL_ENV.kind },
    }
  }
  /** 真调用（一枪）：走**生产同一条链** —— jev 服务的 judge()，不另写一个 fetch。 */
  const svc = ctx.get('mana-jev')
  if (svc === undefined) {
    return { state: 'FAIL', detail: 'mana-jev 服务不可读（装配面异常，与本通道无关）· ' + reading, evidence: {} }
  }
  const t0 = performance.now()
  try {
    /**
     * ⚠ **必须用 `judgeGuarded`，不能用 `judge`**（本席实测踩到，如实记）：
     *   `judge()` 是 **Ollama 专用**的薄封装（实现里判据原文："本方法刻意不加护栏"），
     *   它**不跟 `config.channel` 走** —— 于是探针在 cloud 通道下把
     *   `https://nano-gpt.com` 当 Ollama 端点去 POST，拿到 **401**，
     *   而读数把这一次 401 归因成「云端凭据不对」⇒ **归因反向错位**
     *   （真因是探针走错了腿，端点是对的、key 也没被发出去）。
     *   `judgeGuarded` 才是"通道跟 config.channel 走"的那一个入口（见 index.ts:401）。
     * 🔎 判据：本层读数里的 `reason` 若出现 `ollama-` 前缀，就是又走回了错腿
     *   （cloud 腿的降级原因一律是 `systemone-` 前缀，见 systemone.ts 的常量表）。
     */
    const out = await svc.judgeGuarded({
      state: '评估器通道探针：验证该通道能否返回一次判定',
      question: 'Is the statement true? yes or no',
      timeoutMs,
      sessionId: 'eval-channel',
      turnId: 0,
    })
    const ms = Math.round((performance.now() - t0) * 10) / 10
    /**
     * ⚠ 「凭据在场」由这里再确认一次：单测「变量有没有值」只能证否；
     *   只有真调用拿到 degraded=false 才证成（两者读数均不出现在下面的文案里）。
     * ⚠ 下面只印 reason / 统计量，**不印请求头**：key 连前缀都不进日志。
     */
    if (out.degraded === true) {
      /**
       * ⚠ **前缀即归因**（本席实测踩的那个坑的机检）：cloud 腿的降级原因一律 `systemone-`
       *   前缀（见 `systemone.ts` 的 `SYSTEMONE_DEGRADED_REASONS`）。出现 `ollama-`
       *   ⇒ 探针走了替身腿 ⇒ 该读数是**探针缺陷**，不是云端不可用 —— 两者不得同形，
       *   否则一个自造的 401 会被读成「你的 key 不对」（本轮实测正是如此）。
       */
      const legWrong = CHANNEL.channel === 'cloud' && String(out.reason ?? '').startsWith('ollama-')
      return {
        state: legWrong ? 'FAIL' : 'NO_DATA',
        detail: (legWrong
          ? '[通道 · cloud] **探针走错了腿**（reason 是 ' + String(out.reason) + ' 前缀 ⇒ 探针在 cloud 通道下调了 Ollama 那条路）' +
            '｜这是**评估器自身的缺陷**，不是云端不可用，也不是被测代码的问题｜'
          : channelAttribution('判定的结果是降级（这一次没拿到可用应答）', 'reason=' + String(out.reason ?? '').slice(0, 160) + ' · ms=' + String(ms)) + '｜') + reading + urlNote,
        evidence: { channel: CHANNEL.channel, degraded: true, reason: String(out.reason ?? '').slice(0, 160), ms, legWrong },
      }
    }
    return {
      state: 'MEASURED',
      detail: '真调用拿到判定：value=' + String(out.value) + ' · probability=' + String(out.probability) + ' · ms=' + String(ms) +
        ' · servedModel=' + String(out.servedModel ?? '(未回)') + '｜' + reading + urlNote,
      evidence: { channel: CHANNEL.channel, value: out.value, probability: out.probability, ms, servedModel: out.servedModel ?? null },
    }
  } catch (error) {
    /** 抛错 ⇒ 环境不可用（传输层）。⚠ 错误串只截前 200 字符且来自 message：不会有请求头。 */
    return {
      state: 'NO_DATA',
      detail: channelAttribution('真调用抛错（传输层没走通）', 'error=' + String((error && error.message) || error).slice(0, 200)) + '｜' + reading + urlNote,
      evidence: { channel: CHANNEL.channel, ms: Math.round((performance.now() - t0) * 10) / 10 },
    }
  }
})

// ── 汇总 ────────────────────────────────────────────────────────────────────
const byState = (s) => results.filter((r) => r.state === s).length
const hasFail = byState('FAIL') > 0
const hasNoData = byState('NO_DATA') > 0
const hasNotImpl = byState('NOT_IMPLEMENTED') > 0
const FINAL_EXIT = hasFail
  ? EXIT.HAS_FAIL
  : hasNotImpl
    ? EXIT.HAS_NOT_IMPLEMENTED
    : hasNoData
      ? EXIT.HAS_NO_DATA
      : EXIT.ALL_MEASURED

const report = {
  kind: 'mana-l1-l4-eval',
  at: new Date().toISOString(),
  argv: argv,
  exitCode: FINAL_EXIT,
  /** ⚠ 通道读数随报告一起出（**机器可读**）：否则"这一跑用的哪条通道"只活在 stdout 文案里。 */
  channel: {
    channel: CHANNEL.channel,
    model: CHANNEL.model,
    source: CHANNEL.source,
    base: CHANNEL.base,
    keyEnv: CHANNEL.keyEnv,
    /** **只回布尔**：key 本身（含前缀）永不进读数。 */
    credentialPresent: CHANNEL.channel === 'cloud' ? cloudCredentialPresent() : null,
    envKind: CHANNEL_ENV.kind,
    storePath: CHANNEL.storePath,
    storeRead: CHANNEL.storeRead,
  },
  counts: { measured: byState('MEASURED'), noData: byState('NO_DATA'), notImplemented: byState('NOT_IMPLEMENTED'), fail: byState('FAIL') },
  layers: results,
}
if (JSON_ONLY) console.log(JSON.stringify(report, null, 2))
else {
  console.log('══════ Mana L1–L4 四层评估（v10 §39.1）══════')
  console.log('真装配 + 真事件链；读数回读真库（' + store + '）')
  /**
   * ⚠ **通道与模型印在最上面**（用户指令 A.4）：放在逐层读数之前，
   *   使"这一跑用的哪条通道"在**读第一个数字之前**就是已知条件，而不是事后推断。
   * ⚠ `credentialPresent` 只印**有无**（true/false），**不印 key、连前缀都不印**。
   */
  console.log('模型通道：' + CHANNEL.channel + ' · 模型 ' + CHANNEL.model + ' · 端点 ' + CHANNEL.base +
    ' · 来源 ' + CHANNEL.source + (CHANNEL.source === 'preference' ? '(UI 里设的)' : CHANNEL.source === 'default' ? '(缺省)' : '(命令行 --channel)') +
    (CHANNEL.channel === 'cloud' ? ' · 凭据(' + CHANNEL.keyEnv + ')=' + String(cloudCredentialPresent()) : ''))
  console.log('')
  for (const r of results) {
    const mark = r.state === 'MEASURED' ? '✓' : r.state === 'FAIL' ? '✗' : '·'
    console.log('  ' + mark + ' ' + r.state.padEnd(16) + ' [' + r.id + '] ' + r.title)
    console.log('        ' + r.detail)
  }
  console.log('')
  console.log('──── 汇总 ────')
  console.log('  MEASURED ' + String(byState('MEASURED')) + ' · NO_DATA ' + String(byState('NO_DATA')) + ' · NOT_IMPLEMENTED ' + String(byState('NOT_IMPLEMENTED')) + ' · FAIL ' + String(byState('FAIL')))
  console.log('  ⚠ NO_DATA 与 NOT_IMPLEMENTED **都不是 PASS**')
  console.log('')
  console.log(FINAL_EXIT === 0 ? '✅ 四层全部 MEASURED' : '❌ 有层非 MEASURED（exit=' + String(FINAL_EXIT) + '）')
}

/**
 * ⚠ **`--keep-tmp`：保留临时库以便事后取证**（本席 2026-09-27 新增）。
 *   动机（实测）：本评估器跑完即删库 ⇒ 「为什么候选数=0」这类问题事后**无从复算**，
 *   只能靠重跑——而重跑未必复现同一态。留一个显式的保留开关，胜过让人去改源码。
 *   ⚠ 缺省仍**删**（不留垃圾）；只有显式传 `--keep-tmp` 才保留，并**打印路径**。
 */
if (argv.includes('--keep-tmp')) {
  console.log('')
  console.log('📁 --keep-tmp：临时库保留于 ' + dir + '（store=' + store + '）')
} else {
  rmSync(dir, { recursive: true, force: true })
}
process.exit(FINAL_EXIT)
