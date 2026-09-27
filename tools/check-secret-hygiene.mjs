#!/usr/bin/env node
/**
 * 密钥纪律自查（卡 t-mujxaj57-2tekce 的交付项⑥）：扫描**本卡的改动**里有没有凭据痕迹。
 *
 * ⚠ 本文件**不写任何凭据字面量**：模式从**环境变量名**拼出来（变量名非机密，值才是），
 *   并且即便扫到也只报**位置 + 命中数**，不把命中的内容打出来。
 * ⚠ 扫描面 = `git diff <base>..HEAD`（含新增文件）**加上**工作区未提交改动。
 */
import { execFileSync } from 'node:child_process'

const base = process.argv[2] ?? 'HEAD'
const prefix = (process.env.CREDENTIAL_PREFIX ?? '').trim() || 'sk-nano'
const PATTERNS = [prefix, 'Bearer ey', 'Authorization: Bearer']

const run = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch (error) { return String((error && error.stdout) || '') }
}
const diff = run(['diff', base + '..HEAD']) + run(['diff']) + run(['diff', '--cached'])
const lines = diff.split(String.fromCharCode(10))
let hits = 0
for (const p of PATTERNS) {
  const found = diff.split(p).length - 1
  if (found > 0) {
    hits += found
    // 只印模式名与命中数（**不印命中行** —— 那正是要遮蔽的东西）
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(p)) console.log('命中：' + p.slice(0, 4) + '… 于 diff 第 ' + String(i + 1) + ' 行（内容已遮蔽）')
    }
  }
}
console.log('扫描面：git diff ' + base + '..HEAD + 工作区 + 暂存区，共 ' + String(lines.length) + ' 行')
console.log('命中数：' + String(hits))
process.exit(hits === 0 ? 0 : 1)