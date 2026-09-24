/**
 * W3-2 前置（路 B）判据：`inject_log` 生产侧写入口
 *
 * 覆盖的核心不变式（每一条都对应一条**本仓实测**或**契约明文**，不写"应该"类断言）：
 *   · 写入口是 `gate` 取值域的**唯一校验点** —— 非法值必须**抛错**，不得静默落库
 *     （否则 A1-13 的判据「枚举必须落在 5 类内」只会看到"有行"，是假绿）
 *   · `degraded` 与 `gate='degraded_unavailable'` 自洽：A1-8 要求两者**至少一个非空**
 *   · `null` 与 `0` 可分辨：概率不可用 ⇒ `null`，**不得用 0 冒充「概率为零」**
 *     （`docs/contract/degradation.md` §2 硬约定）
 *   · 读回面（`listInjectLog`）字段名与 DDL 列一一对应，供判据直接断言
 *
 * ⚠ 本测试**不指向** `$DSH_HOME/memory/mana.db`，一律用临时库（本仓硬纪律）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CORE = new URL('../src/index.ts', import.meta.url).href
const core = await import(CORE)
const { INJECTION_GATES, isInjectionGate, openManaDb } = core

const cleanups = []
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'mana-injlog-'))
  cleanups.push(d)
  return d
}
process.on('exit', () => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
})

/**
 * 造一个最小 core 服务面（真实 `openManaDb` + 真实表结构，只替换 ctx 依赖）。
 *
 * ⚠ 这里**不重写** `writeInjectLog` 的实现，而是从 `apply()` 里取真服务 —— 用一个
 *   只提供 `effect/provide/get/on` 的假 ctx 驱动它。判据必须打在**生产代码路径**上。
 */
function makeService() {
  const opened = openManaDb({ path: join(tmpDir(), 'mana.db') })
  let svc = null
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return () => (typeof dispose === 'function' ? dispose() : undefined)
    },
    provide(_name, service) {
      svc = service
      return () => {
        svc = null
      }
    },
    get(name) {
      return name === 'mana-core' ? svc : undefined
    },
    on() {
      return () => {}
    },
  }
  // 用真 apply 装配；storePath 指向临时库（**绝不指向 $DSH_HOME**）。
  core.apply(ctx, {
    storePath: opened.path,
    busyTimeoutMs: 5000,
    autoMigrate: true,
    backupEnabled: false,
    backupIntervalMs: 3600000,
    backupKeep: 2,
    backupDir: '',
  })
  assert.ok(svc, 'apply() 应 provide mana-core 服务')
  return { svc, close: () => opened.close() }
}

const base = {
  sessionId: 'sess-w3',
  turnId: 1,
  requestId: 'req-1',
  gate: 'injected',
}

// ── J1 正常写入 + 读回可断言 ────────────────────────────────────────────────
test('J1 写一条 injected 可读回，字段与 DDL 列一一对应', () => {
  const { svc, close } = makeService()
  const id = svc.writeInjectLog({ ...base, memoryId: 'm-1', blockId: 'b-1', localScore: 0.5, jevProb: 0.9 })
  assert.ok(id > 0, 'writeInjectLog 应返回自增 id')
  const rows = svc.listInjectLog('sess-w3')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].gate, 'injected')
  assert.equal(rows[0].memory_id, 'm-1')
  assert.equal(rows[0].block_id, 'b-1')
  assert.equal(rows[0].local_score, 0.5)
  assert.equal(rows[0].jev_prob, 0.9)
  assert.equal(rows[0].degraded, 0)
  close()
})

// ── J2 负向：非法 gate 必须抛错，且**一行都不落** ───────────────────────────
test('J2 非法 gate 抛错且不落库（A1-13 的假绿防线）', () => {
  const { svc, close } = makeService()
  for (const bad of ['bogus', '', null, undefined, 42]) {
    assert.throws(
      () => svc.writeInjectLog({ ...base, gate: bad }),
      /非法 gate|只允许/,
      `gate=${String(bad)} 应被拒绝`,
    )
  }
  assert.equal(svc.listInjectLog().length, 0, '拒绝后不得留下任何行')
  close()
})

// ── J3 五类枚举**逐一**可写（枚举与 DDL CHECK 同源）────────────────────────
test('J3 五类枚举逐一可写，且数量与 INJECTION_GATES 相等', () => {
  const { svc, close } = makeService()
  for (const g of INJECTION_GATES) svc.writeInjectLog({ ...base, gate: g })
  const rows = svc.listInjectLog()
  assert.equal(rows.length, INJECTION_GATES.length, '每个枚举值都应落一行')
  const got = new Set(rows.map((r) => r.gate))
  assert.deepEqual([...got].sort(), [...INJECTION_GATES].sort())
  close()
})

// ── J4 degraded 自洽：gate='degraded_unavailable' ⇒ degraded=1 ──────────────
test('J4 gate=degraded_unavailable 时 degraded 自动置 1（A1-8 字段要求）', () => {
  const { svc, close } = makeService()
  svc.writeInjectLog({ ...base, gate: 'degraded_unavailable' })
  assert.equal(svc.listInjectLog()[0].degraded, 1, '降级态必须显式落位')
  // 显式传 false 时**不**覆盖降级事实（降级不可被调用方抹掉）
  svc.writeInjectLog({ ...base, gate: 'degraded_unavailable', degraded: false })
  assert.equal(svc.listInjectLog()[0].degraded, 1, 'gate 已声明降级，调用方不得抹掉该事实')
  close()
})

// ── J5 null 与 0 可分辨（degradation.md §2）─────────────────────────────────
test('J5 概率不可用落 null，不得用 0 冒充', () => {
  const { svc, close } = makeService()
  svc.writeInjectLog({ ...base, gate: 'degraded_unavailable' }) // 不给 jevProb
  const unavailable = svc.listInjectLog()[0]
  assert.equal(unavailable.jev_prob, null, '不可用 ⇒ null（不是 0）')

  svc.writeInjectLog({ ...base, gate: 'skip_below_threshold', jevProb: 0 })
  const zero = svc.listInjectLog()[0]
  assert.equal(zero.jev_prob, 0, '真为零 ⇒ 0（与 null 可分辨）')
  assert.notEqual(zero.jev_prob, unavailable.jev_prob, 'null 与 0 必须可分辨')
  close()
})

// ── J6 fail-closed 留痕（A1-14 的落点形态）────────────────────────────────
test('J6 fail-closed：不注入但**必须留痕**（A1-14）', () => {
  const { svc, close } = makeService()
  const before = svc.listInjectLog('sess-fc').length
  // 模拟 JEV 不可用：门控选择不注入（fail-closed），但必须写一行
  svc.writeInjectLog({ ...base, sessionId: 'sess-fc', gate: 'degraded_unavailable', memoryId: null, blockId: null })
  const rows = svc.listInjectLog('sess-fc')
  assert.equal(rows.length, before + 1, '「沉默地不注入」必须留痕，否则是静默失败')
  assert.equal(rows[0].gate, 'degraded_unavailable')
  assert.equal(rows[0].memory_id, null, '未注入 ⇒ memoryId 为 null')
  assert.equal(rows[0].block_id, null, '未注入 ⇒ blockId 为 null')
  close()
})

// ── J7 会话隔离：listInjectLog(sid) 只回该会话 ─────────────────────────────
test('J7 按会话过滤：不串会话', () => {
  const { svc, close } = makeService()
  svc.writeInjectLog({ ...base, sessionId: 'A' })
  svc.writeInjectLog({ ...base, sessionId: 'B' })
  svc.writeInjectLog({ ...base, sessionId: 'A' })
  assert.equal(svc.listInjectLog('A').length, 2)
  assert.equal(svc.listInjectLog('B').length, 1)
  assert.equal(svc.listInjectLog().length, 3, '不传会话 = 全部')
  close()
})

// ── J8 limit 生效且取**最新**（判据读的是"最近发生了什么"）──────────────────
test('J8 limit 生效且按 id 倒序（最新在前）', () => {
  const { svc, close } = makeService()
  for (let i = 0; i < 5; i += 1) svc.writeInjectLog({ ...base, requestId: `req-${i}` })
  const rows = svc.listInjectLog(undefined, 3)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].request_id, 'req-4', '最新一条在前')
  close()
})

// ── J9 枚举守卫自身（isInjectionGate）─────────────────────────────────────
test('J9 isInjectionGate 与枚举真源一致', () => {
  for (const g of INJECTION_GATES) assert.equal(isInjectionGate(g), true, `${g} 应通过`)
  for (const bad of ['', 'INJECTED', 'bogus', null, undefined, 0, {}]) {
    assert.equal(isInjectionGate(bad), false, `${String(bad)} 应被拒`)
  }
})
