#!/usr/bin/env node
/**
 * W1-1 负向对拍（R2 形态）：**扰动 ⇒ 判据必须变红 ⇒ 逐字节还原**。
 *
 * 为什么必须做：只有「装上时真写行」（T1–T6）与「卸载后零新行」（T8）**同时**成立，
 * 反证才不是 G11 平凡通过。本脚本证明判据对**驱动者行为本身**敏感 —— 即：
 * 把驱动者的三种关键行为各去掉一个，对应的那条判据**必须**变红。
 *
 * ⚠ 还原纪律：每处扰动前 sha256 存档，还原后**逐字节比对**；**不用 git reset --hard**
 *   （它会把同批其他席的在途改动一起抹掉 —— 本仓 W1 四席并行的硬约束）。
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PKG = new URL('../../../packages/scheduler/', import.meta.url)
const FILES = { index: new URL('src/index.ts', PKG), chains: new URL('src/chains.ts', PKG) }

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const TEST = new URL('tests/chains-e2e.test.mjs', PKG)

function runCases() {
  try {
    return execFileSync(process.execPath, ['--test', TEST.pathname], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

/** 每条扰动：改哪个文件、把哪段换成哪段、**哪条判据应当变红**。 */
const MUTATIONS = [
  {
    id: 'M1',
    target: 'chains',
    why: '未装配时**静默跳过**（不写行）—— 本仓首位缺陷类「失败不可观测」',
    from: `    if (instance === undefined) {
      trace(eventType, context.sessionId, context.turnId, {
        chain,
        assembled: false,
        status: 'unassembled',
        service,
        reason: '未装配的服务：' + service + ' —— 该链本回合**未执行**（不是「无候选」）',
      })
      return
    }`,
    to: `    if (instance === undefined) {
      return
    }`,
    expectRed: 'T7',
  },
  {
    id: 'M2',
    target: 'index',
    why: '开关变**假旋钮**（driverEnabled 被忽略）',
    from: '      driverEnabled: config.driverEnabled,',
    to: '      driverEnabled: true,',
    expectRed: 'T9',
  },
  {
    id: 'M3',
    target: 'chains',
    why: '覆盖面 trace 行被吞（「某行从未被驱动」重新变得不可观测）',
    from: '    const rows = coverage()\n    trace(TRACE_EVENTS.coverage, sessionId, turnId, {',
    to: '    const rows = coverage()\n    if (false) trace(TRACE_EVENTS.coverage, sessionId, turnId, {',
    expectRed: 'T10',
  },
]

console.log('=== W1-1 负向对拍 ===')
const baseline = runCases()
const baseRed = [...baseline.matchAll(/^not ok \d+ - (\S+)/gm)].map((m) => m[1])
console.log(`基线：未扰动 = ${baseRed.length === 0 ? '全绿' : '红 ' + baseRed.join(',')}`)
if (baseRed.length !== 0) {
  console.error('✗ 基线不是全绿 ⇒ 对拍无意义（先修基线）')
  process.exit(2)
}

const before = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, sha(p)]))
const backupDir = mkdtempSync(join(tmpdir(), 'mana-w11-'))
for (const [k, p] of Object.entries(FILES)) copyFileSync(p, join(backupDir, k))

let failures = 0
const results = []
try {
  for (const m of MUTATIONS) {
    const path = FILES[m.target]
    const original = readFileSync(path, 'utf8')
    if (!original.includes(m.from)) {
      console.error(`✗ ${m.id} 锚点未命中（扰动无法施加 ⇒ 对拍本身失效）`)
      failures += 1
      continue
    }
    writeFileSync(path, original.replace(m.from, m.to))
    const out = runCases()
    const red = [...out.matchAll(/^not ok \d+ - (\S+)/gm)].map((x) => x[1])
    const caught = red.includes(m.expectRed)
    results.push({ id: m.id, why: m.why, expectRed: m.expectRed, red, caught })
    console.log(
      `${caught ? '✓' : '✗'} ${m.id} 扰动「${m.why}」⇒ 判据红：${red.length ? red.join(', ') : '（无）'}` +
        `（期望 ${m.expectRed} 在其中）`,
    )
    if (!caught) failures += 1
    // 立刻还原（逐字节），再做下一条。
    writeFileSync(path, original)
    if (sha(path) !== before[m.target]) {
      console.error(`✗ ${m.id} 还原后 sha256 ≠ 扰动前（还原不完整）`)
      failures += 1
    }
  }
} finally {
  for (const [k, p] of Object.entries(FILES)) copyFileSync(join(backupDir, k), p)
  rmSync(backupDir, { recursive: true, force: true })
}

console.log('--- 还原核对（逐字节）---')
for (const [k, p] of Object.entries(FILES)) {
  const now = sha(p)
  console.log(`  ${now === before[k] ? '✓' : '✗'} ${k}: ${now}${now === before[k] ? '' : ' ≠ ' + before[k]}`)
  if (now !== before[k]) failures += 1
}
const restored = runCases()
const restoredRed = [...restored.matchAll(/^not ok \d+ - (\S+)/gm)].map((m) => m[1])
console.log(`还原后复跑：${restoredRed.length === 0 ? '全绿 ✓' : '红 ' + restoredRed.join(',') + ' ✗'}`)
if (restoredRed.length !== 0) failures += 1

writeFileSync(new URL('w1-1-mutation.json', import.meta.url), JSON.stringify({ baseline: 'green', before, results, restored: restoredRed.length === 0 }, null, 2))
console.log(failures === 0 ? '\n✓ 负向对拍全部通过（判据对驱动者行为敏感，且逐字节还原）' : `\n✗ 负向对拍失败 ${failures} 项`)
process.exit(failures === 0 ? 0 : 1)
