// A0-3 中文分词口径（负向判据）。
import { DatabaseSync } from 'node:sqlite'
const d = new DatabaseSync(':memory:')
d.exec("CREATE VIRTUAL TABLE tri USING fts5(content, tokenize='trigram')")
d.exec('CREATE VIRTUAL TABLE def USING fts5(content)')
for (const t of ['tri', 'def']) {
  d.exec(`INSERT INTO ${t}(content) VALUES ('末那识是第七识'),('test keyword')`)
}
const hit = (t, s) => d.prepare(`SELECT count(*) c FROM ${t} WHERE content MATCH ?`).get(s).c
console.log(JSON.stringify({
  tri4: hit('tri', '末那识'),
  tri2: hit('tri', '末那'),
  def4: hit('def', '末那识'),
  defEn: hit('def', 'test'),
}))
d.close()
