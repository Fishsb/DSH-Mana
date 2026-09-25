/**
 * 时间衰减核（**A1-5 的实现者**）—— 半衰期口径 h = 14 天。
 *
 * 判据原文（`docs/mana-rollout-plan.md:455`，逐字）：
 *   `h=14：decay(0)=1.000000、decay(14)=0.500000、decay(90)=0.011609`，绝对差 `≤ 1e-6`
 *
 * 定义式：`decay(t, h) = exp(-t·ln2 / h)` —— 与 `tools/a1-check.mjs:307` 的闭式核**逐字同形**
 * （该脚本此前对本项报 NONE「无实现者」，实时扫描 `packages/${'*'}/src/*.ts` 里的
 *  `export function|const (decay|timeDecay|decayOf|retentionOf|halfLifeDecay)`；本文件出现后该项转 HANG）。
 *
 * ⚠ **单位：`t` 与 `halfLifeDays` 都是「天」**。与 `activation.ts` 的基础激活
 *   （`t_j` 以**秒**计）**不是同一个量** —— 详见 `params.ts` 文件头的单位警告。
 *
 * ⚠ **唯一写者**（rollout:503③ / C14）：本包内**只此一处**对时间做指数衰减。
 *   基础激活的幂律衰减由 `d` 承担，**不得**再乘一次本函数（"同一条记忆被两家乘过"）。
 *
 * ⚠ **为什么不静默容错**（本仓血的教训「静默失效查被吞异常」）：
 *   `t < 0`（时钟回拨）时公式会给出 `> 1` 的"留存率" —— 即"比从未衰减还新"，
 *   这是个**看起来合理的假数**，会静默污染下游排序。同理 `h ≤ 0` 会给 `Infinity`/`NaN`。
 *   ⇒ 本函数对两类非法输入**抛错**，由调用方显式决定（fail-closed，不吞）。
 */
import { HALF_LIFE_DAYS } from './params.ts'

export function decay(t: number, halfLifeDays: number = HALF_LIFE_DAYS): number {
  if (!Number.isFinite(t)) throw new Error(`decay: t 必须是有限数（实测 ${String(t)}）`)
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    throw new Error(`decay: halfLifeDays 必须是正有限数（实测 ${String(halfLifeDays)}）`)
  }
  if (t < 0) {
    throw new Error(
      `decay: t 不得为负（实测 ${t}）—— 时钟回拨时公式会给出 >1 的假留存率，静默通过会污染排序；请由调用方显式处理`,
    )
  }
  return Math.exp((-t * Math.LN2) / halfLifeDays)
}
