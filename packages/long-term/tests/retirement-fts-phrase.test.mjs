/**
 * H2 判据：`retirement.ts` 的两处 FTS5 绑定**必须绑短语**（与 core 同批修正）。
 *
 * ── 为什么需要这条判据（缺口形态）──────────────────────────────────────────────
 * H1 卡修了 `core.recallLexical` 的裸绑，但**同类缺陷在 long-term 仍有两处**（该席按写面纪律上交）：
 *   · `searchLiveMemories` —— **生产检索入口**（LIVE_SEARCH_SQL）；
 *   · `probeFtsIndex`      —— 诊断探针（直接查 FTS 索引）。
 * 两处都把 `checked.query` **裸绑**进 `MATCH ?`，而 FTS5 的参数是**查询表达式**：
 *   · 裸 `/home/lk/Mana` ⇒ `fts5: syntax error near "/"` ⇒ **整条生产检索抛错**；
 *   · 裸 `方案 A`        ⇒ 被当 `方案 AND A` ⇒ 「库里有却查不出」。
 *
 * ⚠ 本判据**两个方向都判**：该命中的必须命中（短语绑定生效）+ 无关的必须仍 0 命中
 *   （不得为了"不抛错"而退化成"永不空手"）。
 *
 * 运行：`node --test packages/long-term/tests/retirement-fts-phrase.test.mjs`
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const DSH = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const EXPECTED_CASES = 6
let ran = 0

const cleanups = []
after(() => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }) })

const MEMO = '记住：项目根目录在 /home/lk/Mana，跑测试用 npm test'

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'mana-ret-fts-'))
  cleanups.push(dir)
  const store = join(dir, 'mana.db')
  const { Context: Ctx } = await import(pathToFileURL(join(DSH, 'cordis/lib/index.js')).href)
  const ctx = new Ctx()
  ctx.plugin(
    await import(pathToFileURL('/home/lk/Mana/packages/core/src/index.ts').href),
    { storePath: store },
  )
  await new Promise((r) => setTimeout(r, 250))
  const core = ctx.get('mana-core')
  const ret = await import(pathToFileURL('/home/lk/Mana/packages/long-term/src/retirement.ts').href)
  core.writeMemoryItem({ id: 'h2-memo', type: 'observation', content: MEMO, at: new Date().toISOString() })
  return { core, ret, store }
}

// ══ ① 生产检索：含 / 的查询不得抛错，且必须命中 ═══════════════════════════════
test('① searchLiveMemories：含 / 的查询不再抛错且**必须命中**（修前直接 syntax error）', async () => {
  ran += 1
  const { core, ret } = await boot()
  let reading = null
  let threw = null
  try {
    reading = ret.searchLiveMemories(core.db, '/home/lk/Mana', 10)
  } catch (error) {
    threw = error
  }
  assert.equal(threw, null, '不得抛错（修前 fts5: syntax error near "/"）；实测=' + String(threw && threw.message))
  assert.ok(reading.hits.length >= 1, '含 / 的查询必须命中；实测 ' + String(reading.hits.length) + ' 条')
  assert.ok(reading.hits.some((h) => h.id === 'h2-memo'), '命中集必须含目标记忆；实测=' + JSON.stringify(reading.hits.map((h) => h.id)))
})

// ══ ② 生产检索：含空格的短语不得被拆成 AND ═══════════════════════════════════
test('② searchLiveMemories：含空格短语按短语匹配（不得被拆成 词 AND 词）', async () => {
  ran += 1
  const { core, ret } = await boot()
  const r = ret.searchLiveMemories(core.db, '跑测试用 npm test', 10)
  assert.ok(r.hits.some((h) => h.id === 'h2-memo'), '连续子串短语必须命中；实测=' + JSON.stringify(r.hits.map((h) => h.id)))
})

// ══ ③ 反向：无关查询必须仍 0 命中（未退化成"永不空手"）═══════════════════════
test('③ 反向：与该记忆确实无关的查询必须仍 0 命中（不得为不抛错而恒命中）', async () => {
  ran += 1
  const { core, ret } = await boot()
  const r = ret.searchLiveMemories(core.db, '量子纠缠退相干实验', 10)
  assert.equal(r.hits.length, 0, '无关查询必须 0 命中；实测=' + String(r.hits.length))
  assert.equal(r.reason, 'ok', '库非空却查不到 ⇒ reason 应为 ok（与 empty_library 可分辨）；实测=' + String(r.reason))
})

// ══ ④ 诊断探针：同样不得抛错 ═════════════════════════════════════════════════
test('④ probeFtsIndex：含 / 的查询不得抛错且能查到 rowid（探针抛错会被误读成"索引坏了"）', async () => {
  ran += 1
  const { core, ret } = await boot()
  let ids = null
  let threw = null
  try {
    ids = ret.probeFtsIndex(core.db, '/home/lk/Mana', 10)
  } catch (error) {
    threw = error
  }
  assert.equal(threw, null, '探针不得抛错；实测=' + String(threw && threw.message))
  assert.ok(ids.includes('h2-memo'), '探针必须查到目标 id；实测=' + JSON.stringify(ids))
})

// ══ ⑤ 具名错误：FTS5 拒绝表达式时必须是 FtsQueryError，不混进 0 命中 ══════════
test('⑤ 失败态有名字：FTS5 拒绝表达式 ⇒ 抛 FtsQueryError（不得折成 0 命中）', async () => {
  ran += 1
  const { core, ret } = await boot()
  /**
   * 造一个**必然被 FTS5 拒绝**的查询。⚠ 用 U+0000：H1 席实测它与 trigram 结合会触发
   * `unterminated string`；且它**不会被 `checkQuery` 的长度闸拦下**（长度够）。
   */
  const bad = 'aaaa\u0000bbbb'
  let threw = null
  try {
    const r = ret.searchLiveMemories(core.db, bad, 10)
    // 若没抛，至少必须不是"看起来正常但 0 命中"
    threw = { name: 'NO_THROW', message: 'reason=' + String(r.reason) + ' hits=' + String(r.hits.length) }
  } catch (error) {
    threw = error
  }
  // 两种可接受结局：① 抛具名错；② 该查询其实合法（未被拒）——但那样必须**不是**"静默 0 命中"
  if (threw.name === 'NO_THROW') {
    assert.ok(
      false,
      '必须抛具名 FtsQueryError 或说明该查询为何合法；实测未抛：' + threw.message +
      '（⚠ "查询坏了"与"库里没有"同形正是本仓最忌）',
    )
  }
  assert.equal(threw.name, 'FtsQueryError', '必须是具名错误（便于与库损坏/连接故障区分）；实测 name=' + String(threw.name))
  assert.ok(String(threw.query).includes('aaaa'), '错误必须带肇事查询；实测 query=' + String(threw.query))
})

// ══ ⑥ 用例计数自检 ═══════════════════════════════════════════════════════════
test('⑥ 用例计数自检', () => {
  ran += 1
  assert.equal(ran, EXPECTED_CASES, `本文件声明 ${EXPECTED_CASES} 条用例，实跑 ${ran} 条`)
})
