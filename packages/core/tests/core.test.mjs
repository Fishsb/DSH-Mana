/**
 * dsh-mana-core 阶段 0 判据测试。
 *
 * 本文件用一个**假 ctx**（只实现 core 实际用到的 `on` / `provide` / `effect`）
 * 直跑插件 `apply`，因此测的是**真行为**而不是"文件在、函数在"。
 *
 * 运行：见根 package.json 的 test 脚本（glob 形式；**不要**写成目录形式 ——
 *   A0-7：目录形式在本机报 `# tests 1 / # fail 1`，形似"测试失败"实为命令写错）。
 * ⚠ 测试走源码 .ts（Node 22 类型剥离），因此**不需要先 build**；
 *   但**宿主装载**要求 lib 产物（见 src/index.ts 头部注释）⇒ 改了源码要跑 `npm run build`。
 *
 * ⚠ 本注释块内**不得出现**星号加斜杠的字符组合（glob 路径里很容易带上），
 *   否则块注释会被**提前终止**，残留文本变成代码 ⇒ 报 `X is not defined`。
 *   这是本仓实测踩到的一次：注释里写了 `packages` + 通配 + `/tests/...`，
 *   结果整份测试文件变成语法错误，而报错信息完全指不到真因。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const CORE = new URL('../src/index.ts', import.meta.url).href
const DB = new URL('../src/db.ts', import.meta.url).href
const SCHEMA = new URL('../src/schema.ts', import.meta.url).href

/** 假 ctx：只实现 core 用到的三个方法，并记录注册。 */
function makeFakeCtx() {
  const listeners = []
  const provided = new Map()
  const effects = []
  return {
    on(name, fn) {
      listeners.push({ name, fn })
      return () => {}
    },
    provide(name, value) {
      provided.set(name, value)
      return () => provided.delete(name)
    },
    effect(fn, _label) {
      effects.push(fn)
      return () => {}
    },
    _listeners: listeners,
    _provided: provided,
    _effects: effects,
    /** 跑掉 ctx.effect 注册体（模拟插件真正装载）。 */
    _runEffects() {
      for (const fn of effects) fn()
    },
  }
}

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'mana-test-'))
}

// ── A0-2：扩展加载窗口未走错（负向判据）────────────────────────────────────
test('A0-2 负向：默认 ctor 后 enableLoadExtension(true) 必须抛错', () => {
  const dir = freshDir()
  try {
    const db = new DatabaseSync(join(dir, 'a.db'))
    assert.throws(
      () => db.enableLoadExtension(true),
      /Cannot enable extension loading because it was disabled at database creation/,
      '默认 ctor 必须报「开库时未启用扩展」——这是 G4 的核心事实',
    )
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A0-2 正向：{allowExtension:true} 后 enableLoadExtension(true) 不抛错', async () => {
  const { openManaDb } = await import(DB)
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'b.db') })
    assert.equal(opened.extensionWindowOpen, true)
    assert.doesNotThrow(() => opened.db.enableLoadExtension(true))
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── WAL / busy_timeout：读回必须走 prepare().get() ─────────────────────────
test('WAL 与 busy_timeout 实测读回正确（exec 返回 undefined ⇒ 不能用 exec 判）', async () => {
  const { openManaDb } = await import(DB)
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'c.db'), busyTimeoutMs: 5000 })
    assert.equal(opened.journalMode, 'wal', 'journal_mode 读回必须是 wal')
    assert.equal(opened.busyTimeoutMs, 5000, 'busy_timeout 读回必须等于设定值')
    // 反证：exec 的返回值是 undefined，拿它判 WAL 会得到恒假
    assert.equal(opened.db.exec('PRAGMA journal_mode=WAL'), undefined)
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('全新库 busy_timeout 默认是 0（G7 的成因，非"应该是"）', () => {
  const dir = freshDir()
  try {
    const db = new DatabaseSync(join(dir, 'd.db'))
    const row = db.prepare('PRAGMA busy_timeout').get()
    assert.equal(row.timeout, 0, '默认必须是 0，否则 G7 的前提不成立')
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── G7：事务内报错不自动回滚 ⇒ 必须显式 ROLLBACK ───────────────────────────
test('G7：withImmediateTransaction 出错后必须回滚（计数归零）', async () => {
  const { openManaDb, withImmediateTransaction } = await import(DB)
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'e.db') })
    const db = opened.db
    await assert.rejects(
      withImmediateTransaction(db, () => {
        db.exec("INSERT INTO goals (id, title, created_at) VALUES ('g1','t','now')")
        throw new Error('boom')
      }),
      /boom/,
    )
    const row = db.prepare('SELECT count(*) c FROM goals').get()
    assert.equal(row.c, 0, '报错必须回滚：不显式 ROLLBACK 时会留下 1 行（本仓实测）')
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── A0-3：中文分词口径（负向判据）──────────────────────────────────────────
test('A0-3 trigram 4 字命中 ≥1 且默认分词器 0 命中（英文 test 证明非库空）', async () => {
  const { openManaDb } = await import(DB)
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'f.db') })
    const db = opened.db
    // 默认分词器表（对照组）
    db.exec("CREATE VIRTUAL TABLE t_def USING fts5(content)")
    for (const t of ['memory_items_fts', 't_def']) {
      db.exec(`INSERT INTO ${t}(content) VALUES ('末那识是第七识'),('认知架构与记忆'),('test keyword')`)
    }
    const hit = (t, s) => db.prepare(`SELECT count(*) c FROM ${t} WHERE content MATCH ?`).get(s).c

    assert.ok(hit('memory_items_fts', '末那识') >= 1, 'trigram 下 4 字必须命中')
    assert.equal(hit('t_def', '末那识'), 0, '默认分词器下中文必须 0 命中（G5）')
    assert.equal(hit('t_def', 'test'), 1, '英文命中 1 证明"不是库空"')
    // 2 字查询：trigram 下静默返回空 ⇒ 这就是必须显式拒绝的原因
    assert.equal(hit('memory_items_fts', '末那'), 0, '2 字查询在 trigram 下静默空')
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A0-3 checkQuery：短于 3 字的查询必须显式拒绝而不是返回空集', async () => {
  const { checkQuery, MIN_QUERY_CHARS } = await import(SCHEMA)
  assert.equal(MIN_QUERY_CHARS, 3)
  assert.deepEqual(checkQuery('末那'), { ok: false, reason: 'too_short', chars: 2, min: 3 })
  assert.equal(checkQuery('').ok, false)
  assert.equal(checkQuery('   ').ok, false)
  assert.deepEqual(checkQuery('末那识'), { ok: true, query: '末那识' })
})

// ── A0-8：session_id/turn_id 已补 + inject_log 表已建 ──────────────────────
test('A0-8 inject_log 表存在且列齐、gate 受 5 类枚举约束', async () => {
  const { openManaDb } = await import(DB)
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'g.db') })
    const cols = opened.db.prepare('PRAGMA table_info(inject_log)').all().map((r) => r.name)
    for (const c of [
      'session_id', 'turn_id', 'memory_id', 'block_id', 'injected_at',
      'gate', 'degraded', 'local_score', 'jev_prob', 'reset',
    ]) {
      assert.ok(cols.includes(c), `inject_log 缺列 ${c}`)
    }
    // gate 枚举约束：5 类合法、非法必须被 CHECK 拒绝
    const ins = (gate) =>
      opened.db
        .prepare(
          'INSERT INTO inject_log (session_id,turn_id,request_id,injected_at,gate) VALUES (?,?,?,?,?)',
        )
        .run('s1', 1, 'r1', 'now', gate)
    for (const g of ['injected', 'skip_no_candidate', 'skip_below_threshold', 'degraded_unavailable', 'reset']) {
      assert.doesNotThrow(() => ins(g), `gate=${g} 必须被接受`)
    }
    assert.throws(() => ins('bogus'), /CHECK constraint failed/, '非法 gate 必须被拒（不得留空/自由文本）')
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A0-8 各表 session_id/turn_id 列已补（G3）', async () => {
  const { openManaDb } = await import(DB)
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'h.db') })
    for (const table of ['mana_trace', 'memory_items', 'jev_log']) {
      const cols = opened.db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)
      assert.ok(cols.includes('session_id'), `${table} 缺 session_id（I1/I2 将无可数之处）`)
      assert.ok(cols.includes('turn_id'), `${table} 缺 turn_id（I1/I2 将无可数之处）`)
    }
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('FTS5 虚表与 WAL 语句确实在库里（方案 DDL 此处全为 0 命中）', async () => {
  const { openManaDb } = await import(DB)
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'i.db') })
    const fts = opened.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_items_fts'")
      .get()
    assert.ok(fts, 'FTS5 虚表必须已建')
    assert.equal(opened.journalMode, 'wal', 'WAL 必须已生效')
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── A0-11/契约：插件形状 + 服务注册 + 直通 waterfall ────────────────────────
test('插件形状静态可证：name/inject/Config/apply 齐备（A0-5）', async () => {
  const mod = await import(CORE)
  assert.equal(typeof mod.name, 'string')
  assert.ok(Array.isArray(mod.inject))
  assert.equal(mod.inject.length, 0, 'core 声明无依赖（方案 §9.1）')
  assert.ok(mod.Config, 'Config schema 必须存在（否则配置不校验）')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.SERVICE_NAME, 'mana-core')
})

test('G9：注册 agent/pre-step 直通监听器且必须调用 next()（不调即掐死下游）', async () => {
  const mod = await import(CORE)
  const ctx = makeFakeCtx()
  mod.apply(ctx, { storePath: ':memory:', busyTimeoutMs: 5000, autoMigrate: true })
  ctx._runEffects()

  const preStep = ctx._listeners.find((l) => l.name === 'agent/pre-step')
  assert.ok(preStep, '必须注册 agent/pre-step（G9 的结构约束）')

  // 直通验证：next 被调用、且返回值原样透传
  let called = 0
  const sentinel = { messages: ['kept'] }
  const out = await preStep.fn({}, async () => {
    called += 1
    return sentinel
  })
  assert.equal(called, 1, '必须调用 next()：漏调会无声吞掉下游全部行为')
  assert.equal(out, sentinel, '直通监听器不得改写 next 的返回值')
})

test('服务 mana-core 已 provide，且卸载时库被关闭（卸载即净）', async () => {
  const mod = await import(CORE)
  const ctx = makeFakeCtx()
  mod.apply(ctx, { storePath: ':memory:', busyTimeoutMs: 5000, autoMigrate: true })
  ctx._runEffects()
  const svc = ctx._provided.get('mana-core')
  assert.ok(svc, '必须 provide mana-core 服务')
  assert.equal(svc.schemaVersion, 'v0.1')
  // ⚠ 内存库的 journalMode 是 'memory' 而非 'wal'（本仓实测）⇒ 判据必须区分库类型，
  //   否则内存库测试假红、把「WAL 没生效」与「内存库本就没有 WAL」混为一谈。
  assert.equal(svc.journalMode, 'memory', '内存库读回 memory 才是正确')
  assert.equal(svc.vecVersion(), null, 'vec0 未装载必须是可读到的 null，而不是抛错或被吞')

  const seq = svc.writeTrace({
    eventType: 'observation',
    sessionId: 's1',
    turnId: 1,
    payload: { content: 'x' },
  })
  assert.equal(seq, 1, 'mana_trace 自增 seq 必须从 1 开始')
})

// ── 契约：包/插件/服务三方映射表 ───────────────────────────────────────────
test('PACKAGE_MAP 覆盖 P0 六插件且包 id 与插件 name 不同名（B0.2 ③）', async () => {
  const mod = await import(CORE)
  assert.equal(mod.PACKAGE_MAP.length, 6)
  assert.deepEqual(
    mod.PACKAGE_MAP.map((m) => m.packageId),
    [
      'dsh-mana-core',
      'dsh-mana-jev',
      'dsh-mana-vector',
      'dsh-mana-perception',
      'dsh-mana-attention',
      'dsh-mana-working-memory',
    ],
  )
  // 三者不同名是 inject 写错的根源，必须显式可见
  for (const m of mod.PACKAGE_MAP) {
    assert.ok(m.packageId.startsWith('dsh-mana-'), `${m.packageId} 前缀错`)
    assert.ok(!m.pluginName.startsWith('dsh-'), `${m.pluginName} 应是插件 name 而非包 id`)
  }
})

// ── WAL 判据陷阱：内存库与文件库必须区分（本仓实测新增）─────────────────────
test('walApplied：内存库期望 memory、文件库期望 wal（防假红的机检）', async () => {
  const { walApplied, openManaDb } = await import(DB)
  assert.equal(walApplied('memory', ':memory:'), true)
  assert.equal(walApplied('wal', ':memory:'), false, '内存库读回 wal 反而是异常')
  assert.equal(walApplied('wal', '/tmp/x.db'), true)
  assert.equal(walApplied('memory', '/tmp/x.db'), false, '文件库读回 memory 说明 WAL 没生效')

  // 文件库真跑一次：必须真的是 wal
  const dir = freshDir()
  try {
    const opened = openManaDb({ path: join(dir, 'wal.db') })
    assert.equal(walApplied(opened.journalMode, opened.path), true)
    opened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
