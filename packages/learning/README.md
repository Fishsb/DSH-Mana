# dsh-mana-learning

Mana 学习链：**Hebbian 共激活 → 关联强度**（落地册 L-03，**不含 FSRS**）。

## 做什么

「两个记忆在 **5 分钟窗口**内被同时激活 ⇒ 增加关联强度」，落进 `memory_items.related_ids`。

| 面 | 文件 | 判据 |
|---|---|---|
| 共激活检测 | `src/window.ts` | 时间簇 + occasion；窗口**闭区间**（gap ≤ 300000ms 算） |
| 权重更新 | `src/hebbian.ts` | `Δw = η·x_i·x_j`（η = 0.01）；闭式 `w_N = w_0 + N·η` |
| 落点格式 | `src/store-format.ts` | 带权 JSON 数组 `[{"id":..,"w":..}]`，按 id 排序 ⇒ 唯一字节形式 |
| 落库 | `src/store.ts` | `related_ids` 的**唯一写者**；列缺失三态 + 四条显式拒绝 |
| 降级留痕 | `src/trace.ts` | `mana/learning/related_ids_unavailable`（**不侵占 S1 五类**） |
| 参数 | `src/params.ts` | η / 窗口 / 容差的**唯一出处**（C14 唯一写者） |

## 与既有实现的关系（读 vs 写，不是两套）

- `long-term/src/activation.ts` 的 `associativeActivation` = **读**阶段（`Σ W_k·S_kj`），
  它的 `W_k` 在本包之前**全仓无产出者**；本包是它的**上游写面**。
- `forgetting/src/strength.ts` 的 Pavlik `ΔS` 更新的是**单条记忆自己的** `strength`（节点），
  本包更新的是**一对记忆之间**的权重（边）——状态变量不同，系数不可互代。
- `consolidation` 的 chunking 落 `production_rules`（程序性记忆），与 `related_ids` 无关，
  本批**不接线**。

## ⛔ 不做

不做 FSRS（与冻结锚点 `decay(14)=0.500000` 冲突）；不建 `fsrs_schedule` 表；不写任何 DDL；
不改任何兄弟包。

## 跑

```bash
npm run build -w dsh-mana-learning
npm run typecheck -w dsh-mana-learning
node --test packages/learning/tests/l03-hebbian.test.mjs   # 10 例
node packages/learning/verify.mjs                          # 外部防线
```
