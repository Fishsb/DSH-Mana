/**
 * A5-2 判据实现：**client 产物不得含宿主专有 API**。
 *
 * ⚠ **为什么重写（本仓实测的假阳性）**：原判据是「对产物字节正则 grep
 *   `node:fs|node:sqlite|process.env`」。它对**注释里的字面量**同样命中 ——
 *   实测 `packages/ui/lib/panel.js:8` 只在注释里写了「本文件不含 `node:fs` / `node:sqlite`」，
 *   就被数成 1 次违规。既有的规避办法是**改注释措辞**（见 `docs/handoff/S4.md` 坑 3），
 *   那就是**改被测对象去迁就判据**：判据没变强，只是被绕开了。
 *
 * 本实现判**两层**，两层都判，互不顶替：
 *   ① **真调用层（AST，零误报）**：只有「模块说明符」与「`process.env` 成员访问」算调用面 ——
 *      `import … from '<spec>'` / `export … from '<spec>'` / `require('<spec>')` /
 *      `import('<spec>')`；说明符符合 `node:*` 即命中（client 半区**没有任何**合法 node 模块）。
 *   ② **字面量兜底层（令牌面，不漏报）**：用 TypeScript 官方 **scanner** 取非注释、非空白令牌，
 *      拼回文本再 grep 三模式。命中即红，但消息会标注「真调用」还是「仅字面量」——
 *      失败的**成因**可读，不需要人肉二分（G11：判据不许只报数）。
 *
 * ⚠ **为什么用 scanner 而不是「先正则剥注释」**：正则剥注释会把字符串/模板/正则里的
 *   `//`、`/*` 当注释起点，可能**吃掉真代码** ⇒ 判据变绿而缺陷仍在（假绿）。
 *   官方 scanner 按词法状态分类 trivia，字符串内部的内容属于**同一个 token**，
 *   因此**根本不存在"剥离器吃掉代码"这一失败面**，也就不需要事后加一道守卫去补。
 *   副作用：产物里若确有**字符串字面量**写着 `node:fs`，本判据仍报红 —— 这是**有意的**：
 *   client 产物里出现那三个词本身就是可疑面，要么去掉，要么在评审里明确说明。
 *
 * 用法：node packages/ui/scripts/check-client-api.mjs [artifact...]
 *   缺省扫描 `packages/ui/lib/` 根下 `/^client.*\.js$/` 的全部产物（**枚举**，不写死文件名）。
 * 退出码：0 = 全部通过；1 = 有产物不通过（含产物集合为空 —— 空集不许假绿）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 解析器依赖：`typescript`（本工作区根 devDependency，与 typecheck 同源）。
 * ⚠ 缺它时**显式说缺什么**：直接静态 import 会抛 `ERR_MODULE_NOT_FOUND: typescript`，
 *   指不到真因（本仓纪律：失败必须可观测）。**不**降级、**不**跳过 —— 判据跑不起来就是红。
 */
let ts
try {
  ts = (await import('typescript')).default
} catch (error) {
  throw new Error(
    `A5-2 判据无法运行：从 ${import.meta.url} 向上解析不到 typescript（本工作区根 devDependency）—— ${error.message}`,
  )
}

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'lib')

/** client 产物的**发现规则**：lib/ 根下以 `client` 开头的 .js（枚举，不写死单个文件名）。 */
export const CLIENT_ARTIFACT = /^client.*\.js$/

const SPEC_FORBIDDEN = /^node:/
const LITERAL_FORBIDDEN = /node:fs|node:sqlite|process\.env/

/** ① 真调用层：遍历 AST，只看模块说明符与 `process.env`。 */
function realCalls(code) {
  const sf = ts.createSourceFile('artifact.js', code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
  if ((sf.parseDiagnostics ?? []).length > 0) {
    const d = sf.parseDiagnostics[0]
    return { hits: [], fatal: `产物不可解析（${ts.flattenDiagnosticMessageText(d.messageText, ' ')}）` }
  }
  const hits = []
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const specOf = (node) => (node && ts.isStringLiteralLike(node) ? node.text : undefined)
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = specOf(node.moduleSpecifier)
      if (spec !== undefined && SPEC_FORBIDDEN.test(spec)) hits.push({ kind: 'import', spec, line: lineOf(node) })
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const arg = specOf(node.arguments[0])
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
      const isDynImport = callee.kind === ts.SyntaxKind.ImportKeyword
      if (arg !== undefined && (isRequire || isDynImport) && SPEC_FORBIDDEN.test(arg)) {
        hits.push({ kind: isRequire ? 'require' : 'import()', spec: arg, line: lineOf(node) })
      }
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process' && node.name.text === 'env') {
      hits.push({ kind: 'process.env', spec: 'process.env', line: lineOf(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { hits, fatal: undefined }
}

/** ② 字面量兜底层：scanner 取非注释令牌（注释是 trivia，字符串内部不参与分界）。 */
function literalHits(code) {
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, /* skipTrivia */ false, ts.LanguageVariant.Standard, code)
  const skip = new Set([
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
    ts.SyntaxKind.WhitespaceTrivia,
    ts.SyntaxKind.NewLineTrivia,
  ])
  const kept = []
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
    if (skip.has(k)) continue
    kept.push(scanner.getTokenText())
  }
  const joined = kept.join('\u0000')
  return { hits: joined.match(new RegExp(LITERAL_FORBIDDEN, 'g')) ?? [], tokens: kept.length }
}

/** 对一件产物出判定。`verdict` 为 PASS/FAIL，`cause` 说明红在哪一层。 */
export function checkArtifact(code, name = 'artifact.js') {
  const real = realCalls(code)
  if (real.fatal) return { name, verdict: 'FAIL', cause: real.fatal, real: [], literal: [] }
  const lit = literalHits(code)
  const realDesc = real.hits.map((h) => `${h.kind}('${h.spec}')@L${h.line}`)
  const literalOnly = real.hits.length === 0 && lit.hits.length > 0
  const ok = real.hits.length === 0 && lit.hits.length === 0
  const cause = ok
    ? '无真调用、无字面量'
    : real.hits.length > 0
      ? `真调用命中：${realDesc.join(', ')}`
      : `仅字面量命中（非调用面；client 产物内出现该字面量即判红）：${[...new Set(lit.hits)].join(', ')}`
  return { name, verdict: ok ? 'PASS' : 'FAIL', cause, real: realDesc, literal: [...new Set(lit.hits)], tokens: lit.tokens, literalOnly }
}

/** 枚举 lib/ 根下的 client 产物（不递归子目录，但也不写死文件名）。 */
export function discoverArtifacts(libDir = LIB) {
  return readdirSync(libDir)
    .filter((f) => CLIENT_ARTIFACT.test(f))
    .sort()
    .map((f) => join(libDir, f))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : discoverArtifacts()
  if (files.length === 0) {
    console.error(`✗ FAIL：未发现任何 client 产物（${LIB} 根下 /^client.*\\.js$/ 命中 0）—— 空集不许假绿`)
    process.exit(1)
  }
  let bad = 0
  for (const f of files) {
    const r = checkArtifact(readFileSync(f, 'utf8'), f)
    if (r.verdict === 'FAIL') bad += 1
    console.log(`${r.verdict === 'PASS' ? '  PASS' : '✗ FAIL'}  ${r.name}`)
    console.log(`        ${r.cause}（非注释令牌 ${r.tokens} 个）`)
  }
  console.log(`\n共 ${files.length} 件产物：PASS ${files.length - bad} · FAIL ${bad}`)
  process.exitCode = bad === 0 ? 0 : 1
}
