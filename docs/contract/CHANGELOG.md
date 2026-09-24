# 契约变更日志（`docs/contract/**`）

> **为什么需要这个文件**：`docs/contract/**` 是 W0 结束即冻结的全员只读面（`session-allocation.md` §4.1）。
> 冻结不是「不许改」，而是「**改了必须留痕、留痕必须能被下游看到**」。
> 每改一次契约件，在此追加一行 —— 旧值由版本库存档，**不覆盖**。

| 版本 | 变更 | 涉及接口件 | 申请人 | 日期 | 下游适配 |
|---|---|---|---|---|---|
| v0.1 | 阶段 0 初版冻结：S1 五类事件 + 领域模型 + 6 表 DDL + `inject_log` | I-1…I-8 | S0 | 2026-09-24 | 全体（编译期报错即清单） |
| v0.1.1 | **`createSchema` 补列迁移 + 签名/返回值变更**：<br>① 参数由 `{ exec }` 扩为 `{ exec, prepare }`；② 返回值由 `void` 改为 `SchemaResult`（`applied`/`blocked`/`userVersion`/`columnCounts`）；③ 新增 `parseSchema` / `splitStatements` 导出；④ `openManaDb` 结果新增 `appliedColumns` 字段；⑤ `autoMigrate` 语义修正（原为死开关：`false` 时仍建表） | I-3、I-4（DDL 施加方式）、I-7（开库器返回值） | S0 | 2026-09-24 | S1/S2：调用 `createSchema(db)` 的实参须是真 `DatabaseSync`（已自带 `prepare`）；忽略返回值的调用**不受影响**。`openManaDb` 新增字段为**增量**，不破坏既有读取 |
| v0.1.1 | **冻结三件套口径修正**：`_freeze.files.txt` 的权威 walk 排除 `packages/*/lib/`（tsc 产物 + `.gitignore` 项；纳入会随「跑没跑过 build」漂移） | A0-12（三件套） | S0 | 2026-09-24 | 全体：重取清单腿须用新命令；`A0-12` 现**真读**三条腿（哈希/清单/HEAD），任一漂移即 FAIL |

## 变更背景（v0.1.1）

**根因**：`SCHEMA_SQL` 全部语句是 `IF NOT EXISTS`，对**已存在的表**是**静默空操作**。
本仓实测：存量库 `jev_log` 13 列，即便在 DDL 里补上四列，重跑 `createSchema` 仍是 13 列且
**不报错**。而《落地册》明文要求阶段 1 给 `jev_log` 补 `input_chars`/`trimmed`、
阶段 3 补 `verdict`/`verify_state`（§1 条 6/8）⇒ 照原实现，**存量库永远得不到这些列，
且失败完全不可观测**（本仓最在意的缺陷类型）。

**连带修的三处同类缺陷**（均由本次对账实测翻出）：
1. **索引顺序**：`CREATE INDEX ... ON mana_trace(session_id, turn_id)` 在列缺失时**立即报错**，
   而索引排在 DDL 末尾 ⇒ 若先整体 `exec(SCHEMA_SQL)`，存量库在补列**之前**就抛错。
   现按「建表 → 补列 → 索引/虚表」三段施加。
2. **迁移原子性**：SQLite 不允许 `ADD COLUMN NOT NULL` 而无 `DEFAULT`；边查边加会留下
   **半迁移库**。现**先全量预检、再动手**，不可施加即**整体拒绝**并抛出可读原因。
3. **`autoMigrate` 死开关**：原实现 `if (!config.autoMigrate) createSchema(...)` 在
   `false` 时**仍然建表** ⇒ true/false 产出同一结果。现由 `openManaDb` 的 `migrate`
   单点决定，并有测试（M6）钉住「开关必须产生可观测差异」。
