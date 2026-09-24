#!/usr/bin/env node
/**
 * 元门禁：块注释早终止检测（防「注释里写 glob 路径把整份文件变成语法错误」）。
 *
 * **为什么需要它**：本仓在同一个坑上踩了**两次**（2026-09-24）——
 * 在 `/** … *\/` 块注释里写测试命令 `packages` + 通配 + `/tests/...`，
 * 其中的 `*` + `/` 组合会**提前终止块注释**，剩余文本变成代码，报
 * `X is not defined` 或 `Unexpected token`，**完全指不到真因**。
 * 两次都表现为"测试失败"，实际是注释把文件改坏了。
 *
 * 判定方式：用 Node 自己的解析器（不是正则）—— 对每个 .ts/.mjs 走
 * `node --check`（CommonJS 语义的语法检查）或 ESM 解析，报语法错即红。
 * 这样**不依赖我对"什么算早终止"的猜测**，而是让解析器直接表态。
 *
 * 用法：node tools/check-comment-guard.mjs
 * 退出码：0 = 全部可解析；1 = 有文件不可解析。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'lib', '.git', 'types'])

/** 递归收集 .ts / .mjs 源文件（排除构建产物与依赖）。 */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) collect(p, out)
    else if (/\.(ts|mjs|js)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const files = collect(join(ROOT, 'packages')).concat(collect(join(ROOT, 'tools')))
const bad = []

for (const f of files) {
  // ⚠ 用 `--check` 对 .ts 无效（Node 不认），故对 .ts 用 tsc 单文件解析；
  //   这里统一改用 tsc 的 parse 能力：`tsc --noEmit` 太慢，故用动态 import 的
  //   "解析但不执行" 方案——Node 22 的类型剥离要求文件可解析，语法错会直接抛。
  try {
    if (f.endsWith('.mjs') || f.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
    } else {
      // .ts：让 TypeScript 编译器只解析（reportDiagnostics 里的语法类错误）
      const out = execFileSync(
        process.execPath,
        [
          join(ROOT, 'node_modules/typescript/bin/tsc'),
          '--noEmit',
          '--skipLibCheck',
          '--allowImportingTsExtensions',
          '--module', 'nodenext',
          '--moduleResolution', 'nodenext',
          '--target', 'es2022',
          f,
        ],
        { stdio: 'pipe', encoding: 'utf8' },
      )
      void out
    }
  } catch (error) {
    const msg = String(error.stdout ?? '') + String(error.stderr ?? '')
    // 只关心**语法类**错误（TS1xxx 或 Node 的 SyntaxError）；类型错误不归本门。
    const syntax = /error TS1\d{3}|SyntaxError|Unexpected token|is not defined/.test(msg)
    if (syntax) {
      bad.push({ file: relative(ROOT, f), msg: msg.split('\n').slice(0, 4).join(' | ').slice(0, 300) })
    }
  }
}

console.log('══════ 元门禁：块注释早终止 / 语法可解析性 ══════')
console.log(`扫描 ${files.length} 个源文件（packages + tools，已排除 lib/node_modules）`)
if (bad.length === 0) {
  console.log('✅ 全部可解析（无语法类错误）')
} else {
  for (const b of bad) {
    console.log(`✗ ${b.file}`)
    console.log(`   ${b.msg}`)
    // ── 精准归因：模板串（SQL DDL 等）里的反引号 ────────────────────────────
    // ⚠ 本仓在同一个坑上踩了**三次**（2026-09-24 / 09-25 各一次，S0 席独踩三次）：
    //   把 SQL 注释里的表名/列名用反引号括起来（Markdown 习惯），而那段 SQL 位于
    //   **模板字符串**内 ⇒ 反引号提前终止模板串，剩余 SQL 变成 JS 代码。
    //   报出的却是 `Expected a semicolon` / `Module declaration names may only use
    //   quoted strings` 这类**指不到真因**的错（看起来像类型声明写坏了）。
    //   ⇒ 这里直接给出「第几行、是不是模板串内的反引号」，让下一次不必再猜。
    try {
      const text = readFileSync(join(ROOT, b.file), 'utf8')
      const lines = text.split('\n')
      // 找 `= \`` 开头的模板串起点，统计到该行为止的未配对反引号
      let tplStart = -1
      for (let i = 0; i < lines.length; i += 1) {
        if (/=\s*`\s*$/.test(lines[i])) {
          tplStart = i
          break
        }
      }
      if (tplStart >= 0) {
        // 模板串结束行（下一行仅含反引号的）
        let tplEnd = lines.length - 1
        for (let i = tplStart + 1; i < lines.length; i += 1) {
          if (/^\s*`\s*;?\s*$/.test(lines[i])) {
            tplEnd = i
            break
          }
        }
        const offenders = []
        for (let i = tplStart + 1; i < tplEnd; i += 1) {
          if (lines[i].includes('`')) offenders.push(i + 1)
        }
        if (offenders.length) {
          console.log(
            `   ↳ 精准归因：模板串（第 ${tplStart + 1}–${tplEnd + 1} 行）内含**未转义反引号**，` +
              `位于第 ${offenders.join(', ')} 行`,
          )
          console.log('     修法：那段 SQL 的注释里不要用反引号（改用引号或直接写名字）。')
        }
      }
    } catch (e) {
      // ⚠ 归因自身失败**不得静默**（本仓 2026-09-25 实测踩到：`readFileSync` 未 import
      //   时 try/catch 把 ReferenceError 吞掉，于是「精准归因」一次都没打印过，而报告
      //   看起来完全正常 —— 诊断器自己静默失效，正是它要防的那类缺陷）。
      console.log(`   ↳ （精准归因不可用：${String(e?.message ?? e).slice(0, 80)}）`)
    }
  }
  console.log(`\n❌ ${bad.length} 个文件不可解析`)
  console.log('   最常见原因：块注释里出现星号加斜杠的字符组合（glob 路径很容易带上），')
  console.log('   注释被提前终止，剩余文本变成代码。修法：注释里不要写未转义的通配路径。')
}
process.exitCode = bad.length === 0 ? 0 : 1
