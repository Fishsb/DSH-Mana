#!/usr/bin/env node
/**
 * Mana 独立心跳写入器（A0-11）。
 *
 * ⚠ **必须由 Mana 之外的调度器运行**（crontab / systemd timer），不得由任何 Mana 插件
 *   调用。理由（落地册阶段 0 原文）：若挂掉的是 P0 的 `dsh-mana-core`，13 个插件全部进
 *   waiting，**写入 `mana_trace` 的代码本身没在跑** ⇒ Mana 所有自证通道同时失声，
 *   数据面全空与「还没被用过」在报表上同形。
 *
 * 心跳文件**不记写入者** ⇒「写入方独立于插件」**无法从文件判定**。可判定的形态是：
 *   **把全部 Mana 插件卸载后，该文件仍须继续更新**（仍更新 = 写入方确实独立；
 *   停止更新 = 写入方仍是插件自身，判红）。见 A0-11 与 `tools/a0-check.mjs`。
 *
 * 用法：
 *   node tools/mana-heartbeat.mjs            # 写一次（交给 cron 调用）
 *   node tools/mana-heartbeat.mjs --loop     # 前台常驻，每 5 分钟写一次（调试用）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const HOME = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const FILE = join(HOME, 'memory', 'mana.heartbeat')

/**
 * 判定 core 是否在 ctx 中。
 *
 * ⚠ 心跳脚本**不能 import cordis**（那会让它依赖于被监控的对象）。此处只做一件事：
 *   报出**观测面**——宿主进程是否在跑、以及一个由调用方注入的标记。
 *   真正的"core 在不在"由 `--core-alive` 之类的**外部探针**回填；拿不到就诚实写 false，
 *   不得默认写成 true（那会把"没探到"伪装成"活着"）。
 */
function coreAlive() {
  const forced = process.env.MANA_CORE_ALIVE
  if (forced === '1') return true
  if (forced === '0') return false
  return null // 未知：显式 null，不冒充 false/true
}

export function writeHeartbeat() {
  mkdirSync(dirname(FILE), { recursive: true })
  const alive = coreAlive()
  const line = JSON.stringify({
    at: new Date().toISOString(),
    // core 是否在 ctx 中：true / false / null（未知）。**未知不得写成 false**（会与"死了"同形）。
    coreAlive: alive,
    pid: process.pid,
    node: process.version,
    writer: 'tools/mana-heartbeat.mjs（Mana 之外）',
  })
  writeFileSync(FILE, line + '\n')
  return { file: FILE, line }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--loop')) {
    const tick = () => {
      const r = writeHeartbeat()
      console.log(`[${new Date().toISOString()}] ${r.file}`)
    }
    tick()
    setInterval(tick, 5 * 60 * 1000)
  } else {
    const r = writeHeartbeat()
    console.log(r.line)
  }
}

export { FILE as HEARTBEAT_FILE, HOME as DSH_HOME_RESOLVED }
