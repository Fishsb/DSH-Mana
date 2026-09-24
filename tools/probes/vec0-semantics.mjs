#!/usr/bin/env node
/**
 * vec0 三条语义的**真机负例探针**（W-1 / W-2 / W-3）。
 *
 * ## 为什么需要它
 *
 * `packages/vector/tests/b11-vector.test.mjs` 的 B1.1-⑨ 只断言了 `VEC0_SEMANTICS`
 * **声明存在**（字符串非空、id 齐全）—— 那是"文件在长"，不是"行为对"。
 * 而 §8 C4 把 vec0 定为**规模化升级项**（>10 万条才启用），届时启用者必须把三条语义
 * 各造一次负例；若不预先验证，启用当天才会发现「不写 distance_metric 就静默按 L2 算」
 * 这类**不报错但语义偏离**的形态。
 *
 * ## 判定纪律
 *
 * · 扩展可装载 ⇒ **真跑三条负例**，逐条给出 PASS/FAIL 与实测值。
 * · 扩展不可装载 ⇒ 输出 `HANG` 并**显式说明原因**（不是 PASS、不是 skip）。
 *   ——「没装扩展」与「装了但语义对」绝不可同形（本仓首位缺陷类）。
 *
 * 用法：node tools/probes/vec0-semantics.mjs [--json]
 * 退出码：0 = 无 FAIL（可含 HANG）；1 = 有 FAIL。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

const JSON_OUT = process.argv.includes('--json')

/**
 * 候选扩展路径。
 *
 * ⚠ 落地册 §2 条 3 记录 WSL 实测为 `sqlite-vec-linux-x64@0.1.9`（`vec0.so` = 159,816 B）。
 *   本探针**按平台候选**逐个试，不写死单一路径：换平台/换版本时不必改代码。
 */
const CANDIDATE_PATHS = [
  '/home/lk/Mana/node_modules/sqlite-vec-linux-x64/vec0.so',
  '/home/lk/Mana/node_modules/sqlite-vec/vec0.so',
  '/home/lk/.dsh/suite/knowledge/node_modules/sqlite-vec-linux-x64/vec0.so',
  '/usr/local/lib/node_modules/sqlite-vec-linux-x64/vec0.so',
]

const results = []
const record = (id, state, detail, evidence = '') => results.push({ id, state, detail, evidence })
const pass = (id, d, e) => record(id, 'PASS', d, e)
const fail = (id, d, e) => record(id, 'FAIL', d, e)
const hang = (id, d, e) => record(id, 'HANG', d, e)

// ── ① 定位并装载扩展 ────────────────────────────────────────────────────────
// ⚠ 这两个声明必须在**任何 emit() 之前**（`const` 有 TDZ：提前访问会
//   `Cannot access before initialization`，而那是运行期崩溃、不是判定失败）。
let vecVersion = null
let db = null
const found = CANDIDATE_PATHS.find((p) => existsSync(p))
if (!found) {
  const msg =
    'sqlite-vec 扩展未安装（候选路径均不存在）。' +
    '§8 C4 把 vec0 定为规模化升级项（>10 万条才启用），故**当前不装是合规的**；' +
    '但「未装」必须与「装了且语义正确」可分辨 —— 故本探针报 HANG 而非 PASS。' +
    '启用时：npm i sqlite-vec-linux-x64@0.1.9（约 160 KB），再重跑本探针。'
  for (const id of ['W-1', 'W-2', 'W-3']) hang(id, msg, '取证：ls 候选路径 → 全部不存在')
  emit()
  process.exit(0)
}

try {
  db = new DatabaseSync(':memory:', { allowExtension: true })
  db.loadExtension(found)
  vecVersion = String(db.prepare('select vec_version() v').get().v)
} catch (error) {
  for (const id of ['W-1', 'W-2', 'W-3']) {
    hang(id, `扩展存在但装载失败：${String(error.message).slice(0, 120)}`, `路径 ${found}`)
  }
  emit()
  process.exit(0)
}

// ── ② W-1：不写 distance_metric ⇒ 静默按 L2 ─────────────────────────────────
try {
  db.exec('CREATE VIRTUAL TABLE w1_l2 USING vec0(embedding float[3])')
  const explicit = false
  try {
    db.exec('CREATE VIRTUAL TABLE w1_cos USING vec0(embedding float[3] distance_metric=cosine)')
  } catch {
    /* 某些版本不支持该语法 —— 下面按实测判定 */
  }
  const hasCos = db
    .prepare("SELECT name FROM sqlite_master WHERE name='w1_cos'")
    .get()
  const ins = 'INSERT INTO %T(rowid, embedding) VALUES (?, ?)'
  db.prepare(ins.replace('%T', 'w1_l2')).run(1n, new Float32Array([1, 0, 0]))
  db.prepare(ins.replace('%T', 'w1_l2')).run(2n, new Float32Array([0, 1, 0]))
  db.prepare(ins.replace('%T', 'w1_l2')).run(3n, new Float32Array([1, 0, 0]))
  const q = 'SELECT rowid, distance FROM w1_l2 WHERE embedding MATCH ? AND k = 3 ORDER BY distance'
  const rows = db.prepare(q).all(new Float32Array([1, 0, 0]))
  // 同一向量（[1,0,0] vs [1,0,0]）：余弦距离 = 0；L2 距离 = 0（相同向量两者都为 0）
  // 故用**正交**向量区分：余弦距离 = 1，L2 距离 = sqrt(2) ≈ 1.4142
  // ⚠ 本仓实测：vec0 **只支持 `ORDER BY distance` 升序**（`DESC` 报
  //   `Only ascending in ORDER BY distance clause is supported`）。
  //   ⇒ 取正交向量（应是**最远**那条）只能查全量再自行取尾。
  const all = db
    .prepare('SELECT rowid, distance FROM w1_l2 WHERE embedding MATCH ? AND k = 3 ORDER BY distance')
    .all(new Float32Array([1, 0, 0]))
  // 正交向量 = 距离最大的那条（rowid=2；另两条是同向的 rowid 1/3，距离 0）
  const dOrth = Math.max(...all.map((r) => Number(r.distance)))
  // 判别：余弦下正交距离 = 1.0；L2 下 = √2 ≈ 1.4142（本仓实测 1.4142）
  const looksL2 = dOrth > 1.2
  const looksCos = Math.abs(dOrth - 1) < 0.05
  if (!hasCos) {
    hang('W-1', `本版本不支持 distance_metric 语法（正交向量距离=${dOrth.toFixed(4)}）`, `vec_version=${vecVersion}`)
  } else if (looksL2) {
    pass(
      'W-1',
      `缺省=**L2** 已实测复现：正交向量距离 ${dOrth.toFixed(4)} ≈ √2（余弦应为 1.0）` +
        `⇒ 不写 distance_metric 确实静默用 L2；显式建表 w1_cos 可执行`,
      `vec_version=${vecVersion}；实测 distances=${JSON.stringify(all.map((r) => Number(Number(r.distance).toFixed(4))))}`,
    )
  } else if (looksCos) {
    pass(
      'W-1',
      `缺省已是余弦（正交距离 ${dOrth.toFixed(4)} ≈ 1.0）⇒ 本版本语义与落地册记录**不同**，须更新记录`,
      `vec_version=${vecVersion}`,
    )
  } else {
    fail('W-1', `缺省度量无法判别：正交向量距离=${dOrth.toFixed(4)}（既非 √2≈1.4142 也非 1.0）`, `vec_version=${vecVersion}`)
  }
  void explicit
} catch (error) {
  fail('W-1', `探针执行失败：${String(error.message).slice(0, 140)}`, `vec_version=${vecVersion}`)
}

// ── ③ W-2：rowid 必须 BigInt（传 1 应报错、传 1n 应通过）────────────────────
try {
  db.exec('CREATE VIRTUAL TABLE w2 USING vec0(embedding float[3])')
  let numberRejected = false
  let numberError = ''
  try {
    db.prepare('INSERT INTO w2(rowid, embedding) VALUES (?, ?)').run(1, new Float32Array([1, 0, 0]))
  } catch (e) {
    numberRejected = true
    numberError = String(e.message)
  }
  let bigintOk = false
  try {
    db.prepare('INSERT INTO w2(rowid, embedding) VALUES (?, ?)').run(1n, new Float32Array([1, 0, 0]))
    bigintOk = true
  } catch {
    /* 下面判定 */
  }
  if (numberRejected && bigintOk) {
    pass(
      'W-2',
      '传 number `1` 被拒、传 `1n` 通过 ⇒ 两套 id 语义并存已复现（适配层必须统一）',
      `拒绝信息：${numberError.slice(0, 90)}；vec_version=${vecVersion}`,
    )
  } else if (!numberRejected && bigintOk) {
    pass('W-2', '本版本接受 number rowid（与落地册记录不同）；BigInt 亦可用 ⇒ 适配层统一为 BigInt 仍安全', `vec_version=${vecVersion}`)
  } else {
    fail('W-2', `numberRejected=${numberRejected} bigintOk=${bigintOk}（期望 number 被拒且 BigInt 通过）`, `vec_version=${vecVersion}`)
  }
} catch (error) {
  fail('W-2', `探针执行失败：${String(error.message).slice(0, 140)}`, `vec_version=${vecVersion}`)
}

// ── ④ W-3：KNN 必须带 LIMIT / k=? ──────────────────────────────────────────
try {
  db.exec('CREATE VIRTUAL TABLE w3 USING vec0(embedding float[3])')
  db.prepare('INSERT INTO w3(rowid, embedding) VALUES (?, ?)').run(1n, new Float32Array([1, 0, 0]))
  let noLimitRejected = false
  let noLimitError = ''
  try {
    db.prepare('SELECT rowid FROM w3 WHERE embedding MATCH ?').all(new Float32Array([1, 0, 0]))
  } catch (e) {
    noLimitRejected = true
    noLimitError = String(e.message)
  }
  let withK = 0
  try {
    withK = db
      .prepare('SELECT rowid FROM w3 WHERE embedding MATCH ? AND k = 1')
      .all(new Float32Array([1, 0, 0])).length
  } catch {
    /* 下面判定 */
  }
  if (noLimitRejected && withK > 0) {
    pass('W-3', '不带 LIMIT/k 被拒、带 `k = 1` 通过 ⇒ KNN 强制带限已复现', `拒绝信息：${noLimitError.slice(0, 110)}；vec_version=${vecVersion}`)
  } else {
    fail('W-3', `noLimitRejected=${noLimitRejected} withK=${withK}（期望不带被拒且带 k 通过）`, `vec_version=${vecVersion}`)
  }
} catch (error) {
  fail('W-3', `探针执行失败：${String(error.message).slice(0, 140)}`, `vec_version=${vecVersion}`)
}

db.close()
emit()

function emit() {
  if (JSON_OUT) {
    console.log(JSON.stringify({ vecVersion, extension: found ?? null, results }, null, 2))
    return
  }
  console.log('══ vec0 三语义负例探针（W-1 度量 / W-2 rowid / W-3 LIMIT）══')
  console.log(`扩展：${found ?? '(未安装)'}${vecVersion ? ` · vec_version=${vecVersion}` : ''}`)
  for (const r of results) {
    console.log(`\n  ${r.state === 'PASS' ? 'PASS' : r.state === 'FAIL' ? '✗ FAIL' : '  HANG'} [${r.id}]`)
    console.log(`        ${r.detail}`)
    if (r.evidence) console.log(`        依据: ${r.evidence}`)
  }
  const n = { PASS: 0, FAIL: 0, HANG: 0 }
  for (const r of results) n[r.state] += 1
  console.log(`\n共 ${results.length} 项：PASS ${n.PASS} · FAIL ${n.FAIL} · 挂账 ${n.HANG}`)
  console.log(n.FAIL === 0 ? '✅ 无 FAIL（挂账 ≠ 通过）' : `❌ 有 ${n.FAIL} 项 FAIL`)
  process.exitCode = n.FAIL === 0 ? 0 : 1
}
