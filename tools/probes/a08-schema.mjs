// A0-8 session_id/turn_id 已补 + inject_log 表已建。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const here = new URL('../../packages/core/src/db.ts', import.meta.url).href
const { openManaDb } = await import(here)
const dir = mkdtempSync(join(tmpdir(), 'mana-a08-'))
const opened = openManaDb({ path: join(dir, 'mana.db') })
const d = opened.db
const cols = (t) => d.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name)
const need = ['session_id','turn_id','memory_id','block_id','injected_at','gate','degraded','local_score','jev_prob','reset']
const injCols = cols('inject_log')
let badGateRejected = false
try {
  d.prepare('INSERT INTO inject_log (session_id,turn_id,request_id,injected_at,gate) VALUES (?,?,?,?,?)')
    .run('s', 1, 'r', 't', 'bogus')
} catch { badGateRejected = true }
const traceCols = cols('mana_trace'), memCols = cols('memory_items'), jevCols = cols('jev_log')
const fts = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_items_fts'").get()
console.log(JSON.stringify({
  missing: need.filter((c) => !injCols.includes(c)),
  hasTraceST: traceCols.includes('session_id') && traceCols.includes('turn_id'),
  hasMemST: memCols.includes('session_id') && memCols.includes('turn_id'),
  hasJevST: jevCols.includes('session_id') && jevCols.includes('turn_id'),
  badGateRejected, fts: !!fts, journalMode: opened.journalMode, schemaVersion: opened.schemaVersion,
}))
opened.close()
rmSync(dir, { recursive: true, force: true })
