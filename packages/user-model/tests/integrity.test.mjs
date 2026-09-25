/**
 * **写面完整性哨兵**（本席实测踩到的失败形态：写盘时文件被**静默截断**）。
 *
 * 为什么它值得单列一个用例文件：本仓首位缺陷类是「**让失败不可观测**」，
 * 而"落盘了半个文件"恰好是它的教科书形态 —— 工具回 ok、文件在那儿、大小也不为零，
 * 只有在**跑到那个文件**（或它恰好被别的测试 import 到）时才炸，且炸出来的是
 * `Unexpected end of input` 这类**指不到真因**的错。
 *
 * 本哨兵把"落盘完整"变成一条可机检的事实：本包每个 `.mjs` 必须
 *   ① 以换行结尾；② 通过 **`node --check`**（引擎真解析，不是字符计数）。
 *
 * ⚠ 反向对拍见本文件第二条用例：造一个真截断的文件 ⇒ 必须被抓到。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertWriteIntegrity, tmpDir } from './_harness.mjs'
import { P } from './_harness.mjs'

const TESTS_DIR = P('packages/user-model/tests')

test('写面完整性：本包全部测试文件以换行结尾且通过 node --check', () => {
  const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.mjs')).map((f) => join(TESTS_DIR, f))
  assert.ok(files.length >= 6, '文件数异常（' + files.length + '）⇒ 本哨兵可能没扫到东西，会平凡通过')
  assert.ok(files.some((f) => f.endsWith('_harness.mjs')), '夹具文件本身也要被检（它残缺时全部用例都不可信）')
  assertWriteIntegrity(files)
})

test('写面完整性【负向对拍】造一个真截断的文件 ⇒ 哨兵必须抓到', () => {
  const f = join(tmpDir('mana-trunc-'), 'half.mjs')
  writeFileSync(f, 'export function ok() {\n  return 1\n')   // 故意缺右括号与结尾换行
  assert.throws(
    () => assertWriteIntegrity([f]),
    /未通过 node --check|未以换行结尾/,
    '截断文件未被抓到 ⇒ 本哨兵是空的（它给的是假安心）',
  )
})
