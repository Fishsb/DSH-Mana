# 包 id ↔ 插件 name ↔ 服务名 映射表（I-5 的产物）

> **成因**：三者不同名会让 `inject` 写错，而错误**只在运行期表现为插件不启动**，
> 编译期完全看不出来（G11：装配清单 ≠ 生效，空壳与真插件同形）。
> 故本表是**契约**，不是备忘。

| 包 id（npm/装配面） | 目录（写面所有权单位） | 插件 `name`（inject 用的名字） | 服务名（`ctx.get` 用的名字） | 优先级 | `inject` 依赖 |
|---|---|---|---|---|---|
| `dsh-mana-core` | `packages/core` | `mana-core` | `mana-core` | P0 | —（无依赖） |
| `dsh-mana-jev` | `packages/jev` | `mana-jev` | `mana-jev` | P0 | `mana-core` |
| `dsh-mana-vector` | `packages/vector` | `mana-vector` | `mana-vector` | P0 | `mana-core` |
| `dsh-mana-perception` | `packages/perception` | `mana-perception` | `mana-perception` | P0 | `mana-core` |
| `dsh-mana-attention` | `packages/attention` | `mana-attention` | `mana-attention` | P0 | `mana-core`（jev 于阶段 1 接入判定链时追加） |
| `dsh-mana-working-memory` | `packages/working-memory` | `mana-working-memory` | `mana-working-memory` | P0 | `mana-core` |
| `dsh-mana-scheduler` | `packages/scheduler` | `mana-scheduler` | `mana-scheduler` | P1 | `mana-core` |
| `dsh-mana-long-term` | `packages/long-term` | `mana-long-term` | `mana-long-term` | P1 | `mana-core` |
| `dsh-mana-consolidation` | `packages/consolidation` | `mana-consolidation` | `mana-consolidation` | P1 | `mana-core` |
| `dsh-mana-forgetting` | `packages/forgetting` | `mana-forgetting` | `mana-forgetting` | P1 | `mana-core` |
| `dsh-mana-metacognition` | `packages/metacognition` | `mana-metacognition` | `mana-metacognition` | P2 | `mana-core` |
| `dsh-mana-user-model` | `packages/user-model` | `mana-user-model` | `mana-user-model` | P2 | `mana-core` |
| `dsh-mana-ui` | `packages/ui` | `mana-ui` | `mana-ui` | P2 | `mana-core` |

> ⚠ **本表必须与代码同步**（2026-09-24 修正）：本表**曾只列 P0 六个包**，而仓库实际有 **13 个包** ——
> 7 个后建包（P1/P2）的名字**不在契约内**，且 `A0-5` 的目录清单是**硬编码 6 元素**
> ⇒ 「契约表」与「机检」**互为盲区**：这 7 个包若将名字写歧（三处不一致 / patch id 与 `name` 不符），
> 编译期与机检**都不会报**，而按本表开头的成因说明，那正是「只在运行期表现为插件不启动」的形态。
> 现 `A0-5` 改为**扫描实际 `packages/*` 目录**逐包核四要素 + patch id 与 `name` 一致 + **本表条目覆盖每个包**，
> 两侧不再各存一份清单（清单与真源同源，漂移才可能被机检发现）。

**机检**：`tools/a0-check.mjs` 的 A0-5（扫实际目录 + 逐包核四要素 + patch id 一致 + 本表覆盖）；
单测 `packages/core/tests/core.test.mjs` 的 `PACKAGE_MAP` 用例。

## 关联键（I-6）

**统一为 `requestId`**。方案原文请求用 `id`（`方案:694`）、结果用 `requestId`（`方案:707`），
两套键导致判定结果**无法回填到请求**。本契约统一后，`JevJudgeRequest.requestId` ↔ `JevJudgeResult.requestId` 一一对应。

## 事件前缀

Mana 自有事件统一 `mana/` 前缀（S1 五类：`mana/observation`、`mana/attention`、`mana/decision`、`mana/recall`、`mana/injection`）。
⚠ **`agent/pre-step` 不是 Mana 事件**，它是 **DSH 官方 waterfall 扩展点**，声明在 `@deepseek-ai/dsh-agent` 内，
Mana 只消费、不声明。写监听器**必须调用 `next()`**，否则静默吞掉下游（G9）。
