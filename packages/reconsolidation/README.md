# dsh-mana-reconsolidation

Mana（末那识）**再巩固链条**：去稳定化窗口 → 内容更新可追溯 → 重新稳定化（v10 §15 / 落地册 **L-02**）。

## 链条与落点

| 环节 | 落点 | 说明 |
|---|---|---|
| ① 窗口参数 | `src/params.ts` | 情景 30min / 语义 2h / 程序性 6h / 情绪 1h（A 档常量，**非配置**） |
| ② 开窗 | `openWindow()` | `until = now + windowMs(type)`，`now` **显式传参**（不读时钟） |
| ③ 内容更新 | `applyContentUpdate()` | 追加 `update_history`（**不是覆盖**）+ 回读取证 |
| ④ 重新稳定化 | `closeDueWindows(now)` | 幂等读改，**不注册定时器** |
| ⑤ 留痕 | `src/trace.ts` | `mana-reconsolidation/` 自有命名空间，**不冒充 S1 五类** |

## ⚠ 当前必然走降级路径（L-00 未执行）

本包依赖 `memory_items` 的两列：

- `reconsolidation_window_until`
- `update_history`

而本仓 `packages/core/src/schema.ts` 的 `memory_items` **实测没有这两列**（L-00 契约补列未执行）。
⇒ 在真库上，本包三条写路径**一律**返回 `degraded:true` + 非空 `reason`（`schema-missing:...`）
+ **一条留痕**，且**不写库**。这不是"没实现"，而是对"列不在"的**显式三态**：
静默空转与崩溃都被排除，且"排除了这件事"本身可机检。

本包**不动 schema**（`packages/core` 是契约真源，属契约席独占写面）。

## 明确不做

- ⛔ **不实现「提取诱发遗忘」**（`suppression = sim·0.4 + target·0.3 + competitor·0.3`）：
  三个系数**无任何实测基线**，写进判据即「以未超标放过」。
- ⛔ 不改 `memory_items` 已有列语义；⛔ 不注册定时器。

## 判据

```bash
node --test packages/reconsolidation/tests/*.test.mjs   # 29 例
node packages/reconsolidation/verify.mjs                # 包内外部防线（四道闸）
npm run typecheck -w dsh-mana-reconsolidation
npm run build -w dsh-mana-reconsolidation
```
