/**
 * `dsh-mana-ui` client 半区的 **ModuleLoader 工厂壳**（手写组装，不引打包器）。
 *
 * 形态对齐 DSH 客户端产物契约（宿主 checkout 内 40+ 个 `lib/client.js` 首行同形）：
 *
 *     window.__ModuleLoader__.load({ id: '<pkg>', factory: (require) => { ... return module.exports } })
 *
 * ⚠ **为什么不跑 tsdown**：本工作区根 `node_modules` 无 tsdown；样板目录虽装了 tsdown
 *   0.15.12，但其 rolldown 的**原生绑定只有 win32-x64-msvc**，在本机（linux-x64）加载即
 *   `Cannot find module '../rolldown-binding.linux-x64-gnu.node'`。第二条硬规矩禁
 *   `npm install`/`pnpm install` ⇒ 不引新依赖，按契约手工组装：**单入口、单产物**（A5-5），
 *   且产物内不出现任何 node 专有 API（A5-2）。
 *
 * 剥离 TS 类型用 `node:module` 的 `stripTypeScriptTypes`（Node 22 内置，无需 tsc/打包器）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src', 'client', 'index.ts')
const HOST_SRC = join(HERE, '..', 'src', 'client', 'host.ts')
const OUT = join(HERE, '..', 'lib', 'client.js')
const ID = 'dsh-mana-ui'

/**
 * 把 `./host.ts` 内联进同一份产物。
 *
 * **为什么必须内联**：产物只允许**单件**（A5-5）；浏览器侧既没有模块解析器也没有 TS
 * 剥离 ⇒ `require('./host.ts')` 必然运行期失败。内联是同一份源码的**文本级拼接**
 * （不做转译、不改语义），因此不引入打包器。
 */
function readClientSource() {
  const host = stripTypeScriptTypes(readFileSync(HOST_SRC, 'utf8'), { mode: 'strip' })
  let main = stripTypeScriptTypes(readFileSync(SRC, 'utf8'), { mode: 'strip' })
  main = main
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line) || !line.includes('./host.ts'))
    .join('\n')
  const remaining = main.match(/^\s*import\s[^\n]*from\s*['"]\.[^'"]*['"]/gm) ?? []
  if (remaining.length > 0) {
    throw new Error(`client 半区仍存在相对 import（单产物无法解析）：${remaining.join(' | ')}`)
  }
  return { host, main }
}

/** 文本级剔除 `export` 关键字（内联进闭包后不需要模块语义）。 */
const stripExports = (code) => code.replace(/^export\s+/gm, '')

export function buildClient() {
  const { host, main } = readClientSource()
  const body = [
    stripExports(host),
    stripExports(main),
    'module.exports = { apply, render, heatLevel, buildTree, fetchPanels, renderPanels, createPanelComponent, reactFace, mountPanel, mountPanelWith, resolveHost, METHODS, SLOT_KEY, SLOT_ID, SLOT_ORDER, PANEL_MARKS, __setRequire }',
  ].join('\n')
  const artifact = [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    'window.__manaUiRequire = require;',
    body,
    'return module.exports; } });',
    '',
  ].join('\n')
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, artifact, 'utf8')
  return { out: OUT, bytes: Buffer.byteLength(artifact, 'utf8') }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('build-client.mjs')) {
  const result = buildClient()
  console.log(`bundle:client → ${result.out} (${result.bytes} bytes, single artifact)`)
}
