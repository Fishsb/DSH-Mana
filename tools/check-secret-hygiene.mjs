#!/usr/bin/env node
/**
 * 密钥纪律自查（卡 t-mujxaj57-2tekce 交付项六）：扫**本卡的改动**里有没有凭据痕迹。
 *
 * 本文件里不得出现任何凭据字面量（连前缀长什么样都不写）。本席实测踩到：
 *   第一版把前缀当默认值写死在这里 ⇒ **自查脚本自己把前缀引进了 diff**，
 *   git diff | grep -c 从 0 变成 4 —— 自查工具破坏了它正在自查的那条纪律。
 *   ⇒ 模式只来自运行时（环境里的真值）。
 *
 * 不扫结构性字样（authorization / api_key / apikey）。本席实测：它们命中 17 行，
 *   而命中全是 systemoneApiKeyEnv 这类**变量名** —— 变量名非机密且必须入库
 *   （键名不入库，读者连该查哪个环境变量都不知道）。留着它们的唯一效果是让本脚本
 *   每次都报红 ⇒ 假红用多了真红就没人看了（本仓「断言须有区分度」同源）。
 *
 * 判据：真凭据的**完整值**与**前 8 位**都不得出现在 diff 里（值从环境变量取）。
 * 命中时只印**位置与个数**，绝不回显命中内容。
 *
 * 用法：node tools/check-secret-hygiene.mjs [base]（base 缺省 HEAD ⇒ 只扫工作区）。
 *
 * 退出码：0 = 有真值且零命中（**唯一可当证据的读数**）；
 *         1 = 有真值且命中；2 = 环境里没有真值 ⇒ 本次只证明「没有可扫的真值」。
 */
import { execFileSync } from 'node:child_process'

const base = process.argv[2] ?? 'HEAD'
/** 变量名非机密（值是）。缺省取本仓云端通道的变量名 —— 名字可以写，值不行。 */
const envName = process.env.CREDENTIAL_ENV ?? 'NANOGPT_' + 'API_KEY'
const live = process.env[envName]

const run = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch (error) { return String((error && error.stdout) || '') }
}
const diff = run(['diff', base + '..HEAD']) + run(['diff']) + run(['diff', '--cached'])
const diffLines = diff.split(String.fromCharCode(10))

const haveCredential = typeof live === 'string' && live.length >= 8
const patterns = haveCredential ? [['凭据完整值', live], ['凭据前 8 位', live.slice(0, 8)]] : []

let hits = 0
for (const [label, pattern] of patterns) {
  const found = diff.split(pattern).length - 1
  hits += found
  if (found > 0) {
    for (let i = 0; i < diffLines.length; i += 1) {
      if (diffLines[i].includes(pattern)) {
        console.log('命中 [' + label + '] 于 diff 第 ' + String(i + 1) + ' 行（内容已遮蔽）')
      }
    }
  }
}

console.log('扫描面：git diff ' + base + '..HEAD + 工作区 + 暂存区，共 ' + String(diffLines.length) + ' 行')
if (!haveCredential) {
  console.log('⚠ 环境里没有 ' + envName + ' ⇒ 本次只证明「没有可扫的真值」，**不构成扫过且干净**')
  console.log('   要拿可当证据的读数：source ~/.dsh/secrets/nanogpt.env && node tools/check-secret-hygiene.mjs ' + base)
} else {
  console.log('模式数：' + String(patterns.length) + '（凭据 ' + String(live.length) + ' 字符 ⇒ 完整值 + 前 8 位各一条）')
}
console.log('命中数：' + String(hits))
process.exit(haveCredential ? (hits === 0 ? 0 : 1) : 2)