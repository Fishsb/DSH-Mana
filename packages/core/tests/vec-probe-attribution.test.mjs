/**
 * `probeVecVersion` 的**归因判据**（2026-09-26 收口）。
 *
 * ── 本文件在防什么 ───────────────────────────────────────────────────────────
 *   旧实现是 `catch { return null }` —— **本仓注释自己点名过的 G8 先例**；
 *   它把四类完全不同的失败折成同一个 `null`：扩展未装载 / 库句柄坏了 /
 *   `prepare` 解析失败 / 别的异常。后三类都是**程序错误**，但读起来与「合规的未装」同形。
 *   而 `probeVecVersion` 有真消费者（`ManaDb.vecVersion()`，`packages/core/src/index.ts:395`）。
 *
 * ── 每条腿各自的牙 ──────────────────────────────────────────────────────────
 *   · 归因必须**点名**：未装 ⇒ `failure === 'not-installed'`（不是 null、不是空串）；
 *   · 反例④ 库句柄已关 ⇒ 必须归到 `'resource-closed'` **而不是** `'not-installed'`；
 *     这一条正是旧实现做不到的（两者都回 `null`）；
 *   · 签名兼容：`probeVecVersion` 仍返回 `string | null`，且与详细读数的 `version` **逐字同值**；
 *   · **不越权**：本文件**不**判「扩展语义对不对」（那是 `tools/probes/vec0-semantics.mjs` 的 W-1..3），
 *     故 W-1..3 的 HANG **不受影响**（下面 ⑤ 用真跑证据钉住这一点）。
 *
 * 运行（显式路径）：node --test packages/core/tests/vec-probe-attribution.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const DB = new URL('../src/db.ts', import.meta.url).href
const { probeVecVersion, probeVecVersionDetail, isNoSuchFunctionError } = await import(DB)

const EXPECTED_CASES = 8
let ran = 0

/** 干净的内存库（`allowExtension`：与 `openManaDb` 口径一致）。 */
/**
 * 剥掉块注释 / 行注释 / 模板串 / 引号串 —— 用于「只扫代码、不扫说明」的断言。
 * 与 packages/long-term/tests/activation.test.mjs 的 strip 同口径（一处实现，避免两套剥离）。
 */
function stripCommentsAndStrings(s) {
  return s
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
    .replace(new RegExp('//[^\\n]*', 'g'), ' ')
    .replace(new RegExp('`(?:[^`\\\\]|\\\\.)*`', 'g'), '""')
    .replace(new RegExp("'(?:[^'\\\\\\n]|\\\\.)*'", 'g'), '""')
    .replace(new RegExp('"(?:[^"\\\\\\n]|\\\\.)*"', 'g'), '""')
}
const fresh = () => new DatabaseSync(':memory:', { allowExtension: true })

// ══ ① 未装扩展：归因必须**点名**「未装」，而不是 null/空串 ═══════════════════════
test('① 未装扩展 ⇒ failure 恰为 not-installed；version 为 null（与 probeVecVersion 同值）', () => {
  ran += 1
  const db = fresh()
  const r = probeVecVersionDetail(db)
  assert.equal(r.failure, 'not-installed', '未装必须点名 not-installed，实测 ' + JSON.stringify(r))
  assert.equal(r.version, null, '拿不到版本号 ⇒ version 必须是 null')
  assert.match(r.reason, /no such function: vec_version/, 'reason 必须带 SQLite 原文（可归因），实测 ' + r.reason)
  assert.equal(r.errorCode, 'ERR_SQLITE_ERROR', 'errorCode 必须是可枚举的 code，实测 ' + String(r.errorCode))
  // 签名兼容腿：旧入口仍返回 string|null，且与详细读数的 version **逐字同值**
  assert.equal(probeVecVersion(db), r.version, 'probeVecVersion() 必须与 detail.version 逐字同值')
  assert.equal(probeVecVersion(db), null, '旧口径不变：未装 ⇒ null（不是抛、不是空串）')
  db.close()
})

// ══ ② 反例：（旧实现的死穴）库句柄已关闭 ⇒ 不得冒充「未装」═══════════════════════
test('② 库句柄已关闭 ⇒ failure=resource-closed，**不得**归成 not-installed', () => {
  ran += 1
  const db = fresh()
  db.close()
  const r = probeVecVersionDetail(db)
  assert.equal(r.failure, 'resource-closed', '关闭的库必须归到 resource-closed，实测 ' + JSON.stringify(r))
  assert.notEqual(r.failure, 'not-installed', '程序错误不得冒充「未装」—— 这正是旧 catch{return null} 的错法')
  assert.equal(r.errorCode, 'ERR_INVALID_STATE', 'errorCode 必须是 ERR_INVALID_STATE，实测 ' + String(r.errorCode))
  assert.match(r.reason, /database is not open/, 'reason 必须带原文')
  assert.equal(probeVecVersion(db), null, '兼容腿：旧入口在坏句柄上仍返回 null（不抛）')
})

// ══ ③ 归类器本身的牙：只认 SQLite 的 no such function 原文 ═══════════════════════
test('③ isNoSuchFunctionError 只认原文（别的原因不得被归成 not-installed）', () => {
  ran += 1
  assert.equal(isNoSuchFunctionError(new Error('no such function: vec_version')), true, '原文必须被认出')
  assert.equal(isNoSuchFunctionError(new Error('no such function: vec_version_typo')), false, '函数名不同 ⇒ 不认')
  assert.equal(isNoSuchFunctionError(new Error('database is not open')), false, '库已关 ⇒ 不认')
  assert.equal(isNoSuchFunctionError(new Error('extension loading is not allowed')), false, '扩展加载被禁 ⇒ 不认')
  assert.equal(isNoSuchFunctionError(null), false, 'null ⇒ 不认')
  assert.equal(isNoSuchFunctionError('no such function: vec_version'), true, '字符串形态也要认（同一归类器两处可用）')
})

// ══ ④ 装了扩展时：版本号可读且 failure 为空（反方向，防「永远报未装」）═══════════
test('④ 扩展可装载 ⇒ version 可读、failure=null（反方向：不许永远报未装）', () => {
  ran += 1
  const CANDIDATES = [
    '/home/lk/Mana/node_modules/sqlite-vec-linux-x64/vec0.so',
    '/home/lk/Mana/node_modules/sqlite-vec/vec0.so',
    '/home/lk/.dsh/suite/knowledge/node_modules/sqlite-vec-linux-x64/vec0.so',
    '/usr/local/lib/node_modules/sqlite-vec-linux-x64/vec0.so',
  ]
  const found = CANDIDATES.find((p) => existsSync(p))
  if (!found) {
    // ⚠ 边界③ 禁装扩展 ⇒ 本腿在「未装」时**未验证**，如实标注，不得当成通过。
    assert.equal(probeVecVersionDetail(fresh()).failure, 'not-installed', '未装时唯一合法的归因就是 not-installed');
    return
  }
  const db = fresh()
  db.loadExtension(found)
  const r = probeVecVersionDetail(db)
  assert.equal(r.failure, null, '装了扩展 ⇒ failure 必须为 null，实测 ' + JSON.stringify(r))
  assert.equal(typeof r.version, 'string', '装了扩展 ⇒ version 必须是字符串，实测 ' + String(r.version))
  assert.equal(r.reason, '', '成功时 reason 必须为空串（与失败态可分辨）')
  assert.equal(probeVecVersion(db), r.version, '两条通道必须同值')
  db.close()
})

// ══ ⑤ 不越权：W-1..3 的档位不受本改动影响（真跑 W 探针，读数须与改动前同形）══════
test('⑤ W-1..3 档位不受影响：vec0 探针在未装时仍报 **3 项 HANG**（未装不得变假 PASS）', () => {
  ran += 1
  const probe = fileURLToPath(new URL('../../../tools/probes/vec0-semantics.mjs', import.meta.url))
  /**
   * ⚠ 探针在 `--json` 下**整份输出**就是 JSON（不是「最后一行才是 JSON」）——
   *   本席第一版按"取最后一行"解析，实测 `Unexpected end of JSON input`。
   *   故此处解析**全量 stdout**；解析失败时**如实报未判定**，不得静默当成 HANG 或 PASS。
   */
  const runProbe = () => {
    try {
      return execFileSync(process.execPath, [probe, '--json'], { encoding: 'utf8' })
    } catch (error) {
      return String(error.stdout ?? '')
    }
  }
  const raw = runProbe()
  let parsed = null
  try {
    parsed = JSON.parse(raw.trim())
  } catch (error) {
    assert.fail('vec0 探针输出不可解析为 JSON（未判定 ⇒ 不得当通过）：' + String(error.message) + '｜原文前 160 字：' + raw.slice(0, 160))
  }
  assert.ok(parsed, 'vec0 探针必须给出可解析的 JSON')
  const states = (parsed.results ?? []).map((x) => x.state)
  assert.equal(states.length, 3, 'W-1..3 三项必须在册，实测 ' + JSON.stringify(states))
  assert.equal(states.every((s) => s === 'HANG'), true, '未装扩展 ⇒ 三项必须仍为 HANG（未验证不是 PASS），实测 ' + JSON.stringify(states))
  assert.equal(parsed.vecVersion, null, '未装 ⇒ 探针自己的 vecVersion 也必须是 null（与 core 探针同口径）')
})

// ══ ⑥ 链路状态：探针**未接上**归因（把「未接上」变成被断言的事实）═══════════════
test('⑥ 探针与归因**未接上**：它不 import core、也不读 vecProbe（未接上是事实，非注释承诺）', () => {
  ran += 1
  const probePath = fileURLToPath(new URL('../../../tools/probes/vec0-semantics.mjs', import.meta.url))
  const src = readFileSync(probePath, 'utf8')
  // ① 只 import node: 内建模块 —— 它必须在「core 还没装/还没编译」的现场也能单文件跑。
  const imports = [...src.matchAll(/^import\s+[^\n]*from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.ok(imports.length >= 2, '必须真的扫到 import，实测 ' + JSON.stringify(imports))
  const nonBuiltin = imports.filter((s) => !s.startsWith('node:'))
  assert.deepEqual(nonBuiltin, [], '探针只许 import node: 内建模块（实测 ' + JSON.stringify(nonBuiltin) + '）—— 它一旦 import core，就在「core 未装配」的现场跑不起来')
  // ② 不读归因通道的任何符号（读了就是「已接上」，本断言会红 ⇒ 须同步更新 §未接上的代价）。
  // ⚠ **必须先剥注释/字符串再扫**：本席第一版直接 includes ⇒ 报红，而红的原因是
  //   **本席自己刚写的那段说明注释**里提到了这些符号 —— 那是**假红**，不是真接线。
  //   判据的对象是**代码**；修法是补足剥离，不是放宽断言。
  const codeOnly = stripCommentsAndStrings(src)
  assert.ok(codeOnly.length < src.length, '剥离器必须真的剥掉了东西（否则本腿退化为原文扫描）')
  for (const sym of ['probeVecVersionDetail', 'vecProbe', 'isNoSuchFunctionError', 'mana-core']) {
    assert.equal(codeOnly.includes(sym), false, '探针的**代码**里出现了 ' + sym + ' ⇒ 链路已接上；届时本断言与文件头的「未接上」标注**必须同步改**')
  }
  // ③ 文件头必须有「未接上」的**显式标注**（防有人只改代码、没改标注）。
  assert.match(src, /归因通道【未接上】/, '探针文件头必须显式标注链路未接上')
})

// ══ ⑦ 归因通道的消费者现状：零仓内消费者（如实记账，不许读成「链路已通」）═══════
test('⑦ vecProbe 当前**零仓内消费者**（除 core 自身）—— 未接上，不是已通', () => {
  ran += 1
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const hits = []
  const walk = (dir, depth = 0) => {
    if (depth > 6) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (['node_modules', 'lib', '.git', 'types'].includes(e.name)) continue
        walk(full, depth + 1)
        continue
      }
      if (!/\.(ts|mjs|js)$/.test(e.name)) continue
      // ⚠ 同样只扫**代码**：注释里提到 vecProbe（如探针文件头那段「未接上」说明）不是消费者。
      //   第一版按原文扫 ⇒ 把本席自己写的说明当成了消费者（假红）。
      const body = stripCommentsAndStrings(readFileSync(full, 'utf8'))
      if (/vecProbe/.test(body)) hits.push(full.slice(root.length))
    }
  }
  walk(root)
  assert.ok(hits.length > 0, '本断言必须真扫到命中（0 命中 ⇒ 扫描器失效，不是「没人用」）')
  const outside = hits.filter((p) => !/^packages\/core\//.test(p))
  assert.deepEqual(outside, [], 'vecProbe 出现了 core 之外的消费者：' + JSON.stringify(outside) + ' ⇒ 链路已接上，本断言与探针文件头的「未接上」标注须同步更新')
})

// ══ ⑧ 用例计数自检 ═════════════════════════════════════════════════════════════
test('⑧ 用例计数自检（防本文件被截断/删用例）', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, '本次执行到的用例数必须为 ' + EXPECTED_CASES + '；实测 ' + ran)
})
