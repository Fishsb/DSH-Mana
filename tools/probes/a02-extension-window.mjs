// A0-2 扩展加载窗口未走错（负向判据）。
// 期望：默认 ctor 后 enableLoadExtension(true) 抛错；{allowExtension:true} 后不抛。
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mana-a02-'))
const out = {}
try {
  const d = new DatabaseSync(join(dir, 'default.db'))
  d.enableLoadExtension(true)
  out.defaultCtorThrew = false
  d.close()
} catch (e) {
  out.defaultCtorThrew = true
  out.msg = e.message
}
try {
  const d = new DatabaseSync(join(dir, 'allow.db'), { allowExtension: true })
  d.enableLoadExtension(true)
  out.allowExtOk = true
  d.close()
} catch {
  out.allowExtOk = false
}
rmSync(dir, { recursive: true, force: true })
console.log(JSON.stringify(out))
