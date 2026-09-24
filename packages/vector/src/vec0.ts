/**
 * sqlite-vec（vec0）开关的**语义守卫**（B1.1）。
 *
 * ## 本轮的明确结论：**未启用**
 *
 * `route='vec0'` 在本轮**一律显式降级**（`degraded:true` + 非空 `reason`），
 * **不静默回落到 js 通道**。理由（`docs/mana-rollout-plan.md` §1.1 原文口径）：
 * vec0 一旦启用必须**同时**承接三条语义，否则**不报错但语义偏离** ——
 * 那是本项目最防的一类失败（"看着我跑通了"）。
 *
 * | 编号 | 语义 | 不做的后果（实测值） |
 * |---|---|---|
 * | **W-1** | 建表必须显式 `distance_metric=cosine` | 不写默认 **L2**：同一对向量 L2 `0.8944` vs 余弦 `0.4000` ⇒ 检索语义与方案 §7.1/§15.5 声称的"余弦"不符且静默 |
 * | **W-2** | `rowid` 必须 **BigInt** | 传 `1` 报 `Only integers are allows for primary key values`，传 `1n` 才通 ⇒ 同进程两套 id 语义并存 |
 * | **W-3** | KNN 必须带 `LIMIT` / `k=?` | 不带报 `A LIMIT or 'k = ?' constraint is required on vec0 knn queries.`（errcode 1） |
 *
 * ⚠ **不做成"空壳配置"**：不需要 `distanceMetric: 'cosine'` 这种"填了就以为生效"的字段。
 *   本文件只提供两件事：① 把三条语义**写成可被测试逐条断言的常量**；
 *   ② 把"未启用"变成**显式降级**而不是一句注释。
 *
 * ⇒ 启用 vec0 的那一席（规模化升级时）**必须**把 `VEC0_SEMANTICS` 三条各造一次负例
 *   （报错或取值正确），并把 `route='vec0'` 从 `vec0UnavailableReason()` 里放出来。
 *
 * ⚠ **三条语义已于 2026-09-25 用真扩展逐条实测复现**（`tools/probes/vec0-semantics.mjs`，
 *   `sqlite-vec-linux-x64@0.1.9`、`vec0.so` = **159,816 B**，与落地册 §2 条 3 记录**逐字节一致**）：
 *
 *   | 语义 | 实测证据 |
 *   |---|---|
 *   | W-1 | `distance_metric` 缺省 **确实是 L2**：正交向量距离实测 **1.4142**（= √2）；余弦应为 1.0 ⇒ 不写就静默偏离 |
 *   | W-2 | 传 number `1` 报 **`Only integers are allows for primary key values on w2`**（原文逐字一致）；传 `1n` 通过 |
 *   | W-3 | 不带限报 **`A LIMIT or 'k = ?' constraint is required on vec0 knn queries.`**（原文逐字一致）；带 `k = 1` 通过 |
 *
 *   ⚠ 实测**新增**一条落地册未记的约束：vec0 **只支持 `ORDER BY distance` 升序** ——
 *     用 `DESC` 报 `Only ascending in ORDER BY distance clause is supported`。
 *     要取"最远"只能查全量再自行取尾（本探针首版正是踩此坑而误判）。
 *
 *   ⚠ 本机当前**未装**扩展（§8 C4：vec0 是 >10 万条才启用的升级项）⇒ 探针报 **HANG**
 *     **而非 PASS**：「未装」与「装了且语义对」必须可分辨。
 */

/** 三条语义的机检锚点（写死于此处，测试逐条读它，不靠文档描述）。 */
export const VEC0_SEMANTICS = [
  {
    id: 'W-1',
    rule: '建表必须显式 distance_metric=cosine（缺省是 L2）',
    negativeProbe: 'CREATE VIRTUAL TABLE ... USING vec0(...) 不写 distance_metric ⇒ 同对向量按 L2 算',
    observed: 'L2 0.8944 vs 余弦 0.4000（同一对向量）',
  },
  {
    id: 'W-2',
    rule: 'rowid 必须 BigInt（1n），传 1 报 Only integers are allows for primary key values',
    negativeProbe: 'INSERT ... VALUES (1, ...) ⇒ 报错；换 1n ⇒ 通过',
    observed: '同进程两套 id 语义并存（普通表用 number 正常）',
  },
  {
    id: 'W-3',
    rule: 'KNN 查询必须带 LIMIT 或 k=?',
    negativeProbe: "不带 ⇒ A LIMIT or 'k = ?' constraint is required on vec0 knn queries.（errcode 1）",
    observed: 'errcode 1',
  },
] as const

/**
 * vec0 是否可用。本轮**恒返回原因字符串**（= 未启用），因为本机尚未验证 vec0 扩展装载
 * 与三条语义的承接（`ctx.get('mana-core').vecVersion()` 可读才是扩展装载的正面证据）。
 *
 * ⚠ 返回**非空原因**是本函数存在的全部意义：`route='vec0'` 必须能说清"为什么没用上"。
 */
export function vec0UnavailableReason(configuredRoute: string): string | null {
  if (configuredRoute !== 'vec0') return null
  return (
    'route=vec0 未启用（B1.1 本轮：纯 JS 通道为主，vec0 为规模化升级项 §8 C4）；' +
    '启用前提 = 同时承接 W-1(显式 distance_metric=cosine)/W-2(rowid 用 BigInt)/W-3(KNN 必带 LIMIT) 三条语义'
  )
}
