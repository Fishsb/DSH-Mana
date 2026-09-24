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

**机检**：`tools/a0-check.mjs` 的 A0-5；单测 `packages/core/tests/core.test.mjs` 的 `PACKAGE_MAP` 用例。

## 关联键（I-6）

**统一为 `requestId`**。方案原文请求用 `id`（`方案:694`）、结果用 `requestId`（`方案:707`），
两套键导致判定结果**无法回填到请求**。本契约统一后，`JevJudgeRequest.requestId` ↔ `JevJudgeResult.requestId` 一一对应。

## 事件前缀

Mana 自有事件统一 `mana/` 前缀（S1 五类：`mana/observation`、`mana/attention`、`mana/decision`、`mana/recall`、`mana/injection`）。
⚠ **`agent/pre-step` 不是 Mana 事件**，它是 **DSH 官方 waterfall 扩展点**，声明在 `@deepseek-ai/dsh-agent` 内，
Mana 只消费、不声明。写监听器**必须调用 `next()`**，否则静默吞掉下游（G9）。
