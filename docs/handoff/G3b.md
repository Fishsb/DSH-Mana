# G3b 判据器接线席 · 交接单（主持人代补）

> ⚠ **本单由主持人代补**：G3b 席交付了改动但**因上下文耗尽中断，未写 handoff**。
> 以下内容基于**主持人实测复核**（不是转述该席的说法），凡我未亲自验的都标「本席未验证」。
> 取数坐标：HEAD `cc44cac` · 2026-09-26 01:1x +0800。

## 1. 交付

| 文件 | 状态 |
|---|---|
| `tools/probes/a08-schema.mjs` | 改（+193 / −104）—— **A0-8 判据逻辑一行未动**（`tools/a0-check.mjs` 无改动） |
| `docs/handoff/G3b.md` | **该席未写**，由主持人代补（本文件） |

**三件派单任务的实际完成情况**：

| 件 | 任务 | 完成 |
|---|---|---|
| 1 | **A0-8 探针盲区** | ✅ **完成且超出派单**（见 §3） |
| 2 | attention 运行时腿接进 A1-9 | ❌ **未做**（转入待派） |
| 3 | 失败明细留档 | ❌ **未做**（转入待派） |

## 2. 判据执行（主持人实测）

```
node tools/probes/a08-schema.mjs  ⇒ ok=true · migrationApplied=33 · mismatches=[] · contractAnchor="ok"
                                   · blockedThrew=true · blockedLeftPartial=false
node tools/a0-check.mjs --only A0-8 ⇒ 共 1 项：PASS 1 · FAIL 0 · 挂账 0  ✅
```

## 3. 反证判据（**核心验收，主持人独立复现**）

**扰动**：在 `packages/core/src/schema.ts` 里**干净删除** `update_history TEXT` 列定义（同时去掉前一行的尾逗号）。

```
修复前（旧探针）：migrationMismatches = []                  ⇒ A0-8 仍 PASS（判据看不见）
修复后（本席改动）：migrationApplied = 32
                    migrationMismatches = ["memory_items: 契约列缺失 update_history
                      （消费方 REQUIRED_COLUMNS 声明必需；DDL 未声明 ⇒ createSchema 的列 diff 无从补起）"]
                                        ⇒ A0-8 必红
恢复：cmp 与 HEAD 逐字节相同 ✓  ⇒ A0-8 回绿
```

## 4. 该席的实质发现（**比派单更对**，引其源码注释原文）

⚠ 派单说「让旧库也建 `memory_items` + 加 try/catch」即可。**该席实测证明那不够**：

> **比对的「全新库」与「旧库」两端都从 `SCHEMA_SQL` 派生**
> （`fresh ← 全文 DDL`；`old ← keepOnlyRequired(parseSchema())` = **同一 DDL 的投影**）
> ⇒ 从 DDL 里**干净地删掉一列**时，**两端同时少列 ⇒ 差集恒空**。
> 实测读数（删 `update_history`，两种形态）：
> · 旧实现 + 只加 `memory_items` 建表：`applied 33→32`，`mismatches` 恒 `[]` ⇒ **仍 PASS（盲区未消）**
> · 现在（加独立锚点）：`mismatches` 报出契约列缺失 ⇒ **A0-8 报红**

**⇒ 根因是「差分两端同源」**：判据看起来在比对，实际比的是它自己。**派单给的修法只是把一个盲区换成了另一个。**

**解法（该席）**：引入**第三个不来自 `SCHEMA_SQL` 的参照物** ——

> 独立锚点 = **消费方契约**（`packages/reconsolidation/src/columns.ts` 的 `REQUIRED_COLUMNS`）
> —— 它声明的是「本系统**必须**有哪两列」，不是「DDL 里写了哪两列」。
> 这两个问题在删列场景下答案不同，**正是判据要的独立性**。
> ⚠ 锚点只读、且**不复制清单**（复制就是第二份真源，会漂）；导入失败时如实报
> `contractAnchor: 'unavailable: …'`，**不据此判红**（那是归属缺口，不是本项的判定面 ——
> 假红会把这判据退化成噪声）。

**边界遵守**：`⚠ a0-check 的判据逻辑（staticOk && migrationOk && atomicOk）本次一行未动：
本席只补观察面 —— 把「迁移后的旧库缺契约列」并入既有字段 migrationMismatches，
由 a0 那条未改动的表达式自行判红。`（主持人已核：`tools/a0-check.mjs` 无改动）

### 4.1 为什么探针必须自己收口（该席实测踩到）

> 旧版无 try/catch ⇒ 一崩就「没有读数」。实测：崩溃栈进 stderr，而 a0 的 `evalJson` 取
> `stderr.slice(0,400)` —— **那 400 字节被 `UNDICI-EHPA` 与 `ExperimentalWarning: SQLite`
> 两条启动期警告占满，真因一个字都读不到**。
> ⇒ 现改为整体 try/catch，崩了在 **stdout** 产出一行 `{"ok":false,"error":"…"}`，
> **让「失败」以数据的形式被读到，而不是以「无输出」的形式消失**。

## 5. 回归自检（主持人）

| 项 | 结果 |
|---|---|
| `tools/a0-check.mjs` 是否被动 | **零改动** ✅（判断逻辑未被修改，只补了探针的观察面） |
| `packages/**` 是否被动 | **零改动** ✅（扰动是主持人临时做的，已逐字节恢复） |
| A0-8 | PASS ✅ |
| 探针读数完整性 | ✅ 六字段齐（`ok` / `migrationApplied` / `migrationMismatches` / `contractAnchor` / `blockedThrew` / `blockedLeftPartial`） |

## 6. 未决项

1. **件 2（attention 运行时腿接进 A1-9）未做** ⇒ 转入待派。
   ⚠ 该盲区已由 G1 席实测证实：把块身份换成内容水印后**真链路泄漏 6 个 3-gram，而 F4/F5 仍全绿**。
2. **件 3（失败明细留档）未做** ⇒ 转入待派。
3. **`contractAnchor` 的独立性有边界**：它只覆盖 `reconsolidation` 声明的那两列；
   若将来**别处**也有「消费方声明必需列」，需另加锚点。本席未验证该扩展路径。
4. 该席**未写 handoff**（本单为代表）；其探索残渣 `.perf-scratch/` 由主持人清理。
