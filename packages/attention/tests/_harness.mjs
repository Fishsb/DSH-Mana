/**
 * `dsh-mana-attention` 判据面的**共用夹具**（本席 F2 新建）。
 *
 * ## 为什么需要它（本仓既有教训）
 *  · **夹具绿 != 真数据绿**：本包的 Injection Gate 是「挂 `agent/pre-step` waterfall、
 *    写 `inject_log`」的东西 ⇒ 判据必须走**真装配链 + 真 waterfall 分发**，
 *    直接调 service 只能证明「我调的函数返回了什么」，不能证明「宿主循环走到它了」。
 *  · **对拍要打对靶**：本包按包名被解析到 `packages/attention/lib/index.js`
 *    （构建产物）。在 `src` 上改字而不重建 ⇒ 变异**从未生效**，读数看起来却像「判据没牙」。
 *    本夹具的变异一律**直接改写 lib 文本并在临时目录装载**（仓内零写入），故对拍天然打在
 *    判据真正读取的那一层。
 *  · **嵌套 node --test 会继承 `NODE_TEST_CONTEXT`** ⇒ 子进程不跑用例、exit 0、零输出。
 *    `probeSelf()` 显式剥掉该环境变量，且**不信退出码**（解析不到 TAP `# tests` 一律 code:-1）。
 */
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

/** DSH 宿主安装位（cordis 只从这里取 —— 仓内不存在 cordis 副本）。 */
export const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
/** 本包根。 */
export const PKG = fileURLToPath(new URL('..', import.meta.url))
/** 仓根。 */
export const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** 五类 gate 枚举（真源 = `core/src/domain.ts` 的 `INJECTION_GATES`，此处为判据侧副本）。 */
export const GATES = ['injected', 'skip_no_candidate', 'skip_below_threshold', 'degraded_unavailable', 'reset']

/** 本包自有命名空间：`mana_trace.event_type` 的裸名五类（S1 契约，非带前缀事件名）。 */
export const STAGE_LABELS = ['observation', 'attention', 'decision', 'recall', 'injection']

const cleanups = []
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

const require_ = createRequire(join(ROOT, 'package.json'))
/** 把 lib 里的裸包名 import 绝对化（临时目录装载的必要条件；仓内 lib 不动）。 */
export function absolutizeImports(text) {
  // ⚠ 必须**同时**排除 `node:` 内建（本席实测踩到）：`require_.resolve('node:os')` 会得到
  //   路径 `/home/lk/Mana/node:os` ⇒ 装载时报 ERR_MODULE_NOT_FOUND，而错误看起来像「夹具坏了」。
  //   只排除相对路径（`\.`）是不够的 —— 内建模块既不相对也不该被解析到路径。
  return text.replace(/from '(?!\.)(?!node:)([^']+)'/g, (_m, spec) => `from '${pathToFileURL(require_.resolve(spec)).href}'`)
}

/**
 * 装配一个**真**运行环境：真 Context + 真 Loader + 真 `agent/pre-step` waterfall。
 *
 * @param opts.judge         判定链桩：`'ok'`(0.95) | `'below'`(0.2) | `'degraded'` | `'none'`(不注册) | `'throw'`
 * @param opts.injectionEnabled 注入门控开关（关掉后仍须留痕）
 * @param opts.mutant        变异体：`{ replace: [[anchor, replacement], ...] }` —— 直接改写 lib 文本后装载
 * @param opts.coreMutant    同上，但改的是 core（用于「core 抛错」这类跨包路径）
 */
export async function boot({ judge = 'ok', injectionEnabled, judgeState = 'S', mutant = null, coreMutant = null, extraConfig = null, hook = null, upstream = null } = {}) {
  const { Context } = await import(`${DSH}/cordis/lib/index.js`)
  const Loader = (await import(`${DSH}/cordis-plugin-loader/lib/index.js`)).default
  const dir = mkdtempSync(join(tmpdir(), 'mana-f2-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(ROOT).href + '/'
  /**
   * `preStepHooks()`：**运行期**读本扩展点上注册的监听器清单。
   *
   * ⚠ 为什么用运行期清单而不是 `ctx.effect` 计数（本席实测踩到）：
   *   `ctx.on` 也走 `ctx.effect` 内部注册（标签形如 `ctx.on("agent/pre-step")`），
   *   而 `ctx.loader.create()` 装载的包会在**别的执行上下文**（Loader 自己的 fiber）里留下注册，
   *   外层包一层 `ctx.effect` 根本看不到 ⇒ 计数恒 0。
   *   ⇒ 「本包在扩展点上注册了几条」只能从**真 hooks 表**读，那才是事实。
   * ⚠ 它的价值：能把**卸载即净**从「机制自证」变成可断言的读数（卸载后清单必须少一条）。
   */
  const preStepHooks = () => ctx.events?._hooks?.['agent/pre-step'] ?? []
  ctx.plugin(Loader, { baseUrl: pathToFileURL(ROOT).href + '/' })
  await settle(180)

  /**
   * `upstream`：挂一条**上游**监听器（在装载本包之前注册 ⇒ 更外层）。
   *
   * ⚠ impl 席新增（2026-09-26）：D2 的真身是「上游**调了** `next()` 却**没把返回值传下来**」
   *   —— 观察者式写法（DSH 生态常见）。它**不是**变异体，**不改本包一个字节**，
   *   而是本包**真实遇到**的一种上游形态 ⇒ 用夹具参数表达，用真分发通道取证。
   */
  if (upstream) ctx.on('agent/pre-step', upstream)
  /** `hook`：在**装载任何 Mana 包之前**拿到 ctx（用于挂「上游」监听器 —— 更早注册 = 更外层）。 */
  if (hook) hook(ctx)

  /**
   * ⚠ **监听器注册序即调用序，且这正是 G9 的要害**（本席用真 waterfall 实测钉住）：
   *   cordis 的 `waterfall()` 把监听器表 `shift()` 出来逐个调用（先注册者先执行，洋葱的外层），
   *   **没有调用 `next()` 的监听器会否决整条链，包括内置默认行为**
   *   （`cordis/lib/index.js` 的 waterfall 注释原文：「a listener that does not call `next()`
   *   vetoes the rest of the chain, including the built-in behavior」）。
   *   ⇒ 本包门控在 pre-step 上**不是叶子**：它下单后注册的监听器（= 内层 = 下游）才拿得到控制权。
   *   故本夹具把「下游」定义为**本包装载之后**注册的监听器 —— 这才是「被掐死的下游」的真身。
   */
  /**
   * 下游哨兵：`arm()` 后才挂（默认不挂，避免污染各面自身的断言）。
   *
   * ⚠ 计数点取「**被进入**」而不是「next() 返回之后」：漏调 `next()` 的上游**根本不会调用它**
   *   ⇒ 二者等价；但若哨兵自己抛错，只有「被进入」才如实记下「下游确实拿到了控制权」。
   */
  let downstreamHits = 0
  const arm = () => {
    downstreamHits = 0
    const off = ctx.on('agent/pre-step', async (_p, next) => {
      downstreamHits += 1
      return await next()
    })
    return () => { off(); downstreamHits = 0 }
  }
  const downstreamCount = () => downstreamHits

  /** 后注册的判定链桩（在本包之后 ⇒ 更外层 ⇒ **先**执行；用于单轮内逐类驱动）。 */
  const steerJudge = (fn) => ctx.on('mana/jev/judge', fn)

  // 判定链桩：注册在**装载包之前** ⇒ 位于内层；attention 调的 next() 落到本桩。
  const judgeCalls = []
  if (judge === 'ok' || judge === 'below') {
    ctx.on('mana/jev/judge', async (req) => {
      judgeCalls.push(req)
      const p = judge === 'ok' ? 0.95 : 0.2
      return { requestId: req.requestId, source: 'test-stub-judge', value: p >= 0.7 ? 'yes' : 'no', probability: p, degraded: false, reason: null }
    })
  } else if (judge === 'degraded') {
    // ⚠ `judgeCalls` 必须**每条桩都记**（本席实测踩到）：漏记会让「判定链真被调到」这条
    //   到达证据在降级路径上恒为空 ⇒ 判据报红而红在**夹具**不在被测实现（对拍打错靶的镜像）。
    ctx.on('mana/jev/judge', async (req) => {
      judgeCalls.push(req)
      return { requestId: req.requestId, source: 'test-stub-judge', value: 'unknown', probability: null, degraded: true, reason: 'test-stub-degraded' }
    })
  } else if (judge === 'throw') {
    ctx.on('mana/jev/judge', async (req) => {
      judgeCalls.push(req)
      throw new Error('test-stub-judge-exploded')
    })
  }

  const loadCore = async () => {
    if (coreMutant) {
      /**
       * ⚠ core 的 lib 是多文件包（`index.js` 相对 import `./db.js` 等）⇒ 把**整份 lib 目录**
       *   复制进临时目录再改 `index.js`：只搬单文件会让相对 import 悬空（ERR_MODULE_NOT_FOUND），
       *   而那个错看起来像「夹具坏了」，真因是「夹具没搬全」。
       */
      const libDir = join(ROOT, 'packages', 'core', 'lib')
      const dstDir = join(dir, 'core-lib')
      copyDir(libDir, dstDir)
      const src = readFileSync(join(dstDir, 'index.js'), 'utf8')
      const text = absolutizeImports(applyMutation(src, coreMutant))
      writeFileSync(join(dstDir, 'index.js'), text)
      ctx.plugin(await import(pathToFileURL(join(dstDir, 'index.js')).href), { storePath: store })
    } else {
      await ctx.loader.create({ name: 'dsh-mana-core', config: { storePath: store } })
    }
    await settle(150)
  }
  await loadCore()

  if (mutant) {
    const text = absolutizeImports(applyMutation(readLib('attention'), mutant))
    const p = join(dir, 'attention-mutant.mjs')
    writeFileSync(p, text)
    ctx.plugin(await import(pathToFileURL(p).href), attentionConfig({ injectionEnabled, judgeState, extraConfig }))
  } else {
    await ctx.loader.create({ name: 'dsh-mana-attention', config: attentionConfig({ injectionEnabled, judgeState, extraConfig }) })
  }
  await settle(150)

  const core = ctx.get('mana-core')
  const attention = ctx.get('mana-attention')
  return { ctx, store, judgeCalls, dir, arm, downstreamCount, steerJudge, core, attention, preStepHooks }
}

function attentionConfig({ injectionEnabled, judgeState, extraConfig }) {
  const c = { judgeState, ...(extraConfig ?? {}) }
  if (injectionEnabled !== undefined) c.injectionEnabled = injectionEnabled
  return c
}

/** 递归复制目录（core lib 是多文件包，变异体必须整包搬走，否则相对 import 悬空）。 */
function copyDir(src, dst) {
  cpSync(src, dst, { recursive: true })
}

export function readLib(pkg) {
  return readFileSync(join(ROOT, 'packages', pkg, 'lib', 'index.js'), 'utf8')
}

/**
 * 施加变异：**每个锚点必须命中恰好 1 次**。
 *
 * ⚠ 命中 0 次 = 真源已改、变异器过期 ⇒ **必须大声抛**。不得当成「变异成功」：
 *   那正是本仓「变异没生效，读数看起来却像判据没牙」的形态。
 * ⚠ 变异后必须确认文本真的变了（不是把同一句话替换成自己）。
 */
export function applyMutation(source, { replace }) {
  let text = source
  for (const [anchor, replacement] of replace) {
    const hits = text.split(anchor).length - 1
    if (hits !== 1) throw new Error(`变异锚点命中 ${hits} 次（须恰好 1）：${JSON.stringify(anchor)}`)
    text = text.replace(anchor, replacement)
  }
  if (text === source) throw new Error('变异未真正生效（文本与真源逐字相同）')
  return text
}

/** 独立只读连接读 inject_log（不复用插件句柄）。 */
export function readInject(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  const rows = db.prepare('SELECT * FROM inject_log ORDER BY id').all()
  db.close()
  return rows
}

/** 独立只读连接读 mana_trace。 */
export function readTrace(store) {
  const db = new DatabaseSync(store, { readOnly: true })
  const rows = db.prepare('SELECT * FROM mana_trace ORDER BY seq').all()
  db.close()
  return rows
}

/** 走**宿主真分发通道**触发一次 pre-step（不是直接调监听器）。 */
export function firePreStep(ctx, { turn = 1, messages = [], sessionId = 'sess-f2' } = {}) {
  const payload = { agent: { session: { id: sessionId } }, messages, turn, step: 1, signal: new AbortController().signal }
  return ctx.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages }))
}

/** 经**生产源头**产生一个候选项（perception 一般不在场，故走本包自己的 observation 入口）。 */
export function perceive(ctx, { content = '候选内容', requestId = 'req-f2', sessionId = 'sess-f2', turnId = 1 } = {}) {
  ctx.emit('mana/observation', { content, sessionId, turnId, requestId, source: 'user-message', at: new Date().toISOString() })
}

/** 取消息块里的纯文本。 */
export function messageText(m) {
  return (Array.isArray(m?.content) ? m.content : []).map((b) => String(b?.text ?? '')).join('')
}

/**
 * 子进程 TAP 探针（负向对拍的**独立通道**）。
 *
 * ⚠ 必须剥掉 `NODE_TEST_CONTEXT`：本项目实测，嵌套 `node --test` 继承该变量后
 *   子进程**不跑用例、exit 0、零输出** ⇒ 「退出码 0」在这里毫无意义。
 * ⚠ 不得用管道取退出码（`| tail` 的 `$?` 是 tail 的）—— 故直接用 spawnSync 取 status。
 */
export function runTestFile(file) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--test', file], { cwd: ROOT, encoding: 'utf8', env })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const tests = Number((/# tests (\d+)/.exec(out) ?? [])[1] ?? -1)
  const pass = Number((/# pass (\d+)/.exec(out) ?? [])[1] ?? -1)
  const fail = Number((/# fail (\d+)/.exec(out) ?? [])[1] ?? -1)
  // 解析不到 TAP 计数 ⇒ 一律记 -1：**不把「没跑」读成「通过」**。
  const ok = r.status === 0 && tests > 0 && fail === 0
  return { ok, code: tests === -1 ? -1 : r.status, status: r.status, tests, pass, fail, out }
}

/** 文件 sha256（对拍前后取证）。 */
export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 判据读取面（判据真源）的证据指纹：被测包 src + lib + core lib。 */
export function judgedSurface() {
  const files = [
    join(PKG, 'src', 'index.ts'),
    join(PKG, 'lib', 'index.js'),
    join(ROOT, 'packages', 'core', 'lib', 'index.js'),
    join(ROOT, 'packages', 'core', 'lib', 'domain.js'),
  ]
  const out = {}
  for (const f of files) out[f.replace(`${ROOT}/`, '')] = sha256(f)
  return out
}
