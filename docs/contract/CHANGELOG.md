# 契约变更日志（`docs/contract/**`）

> **为什么需要这个文件**：`docs/contract/**` 是 W0 结束即冻结的全员只读面（`session-allocation.md` §4.1）。
> 冻结不是「不许改」，而是「**改了必须留痕、留痕必须能被下游看到**」。
> 每改一次契约件，在此追加一行 —— 旧值由版本库存档，**不覆盖**。

| 版本 | 变更 | 涉及接口件 | 申请人 | 日期 | 下游适配 |
|---|---|---|---|---|---|
| v0.1 | 阶段 0 初版冻结：S1 五类事件 + 领域模型 + 6 表 DDL + `inject_log` | I-1…I-8 | S0 | 2026-09-24 | 全体（编译期报错即清单） |
| v0.1.1 | **`createSchema` 补列迁移 + 签名/返回值变更**：<br>① 参数由 `{ exec }` 扩为 `{ exec, prepare }`；② 返回值由 `void` 改为 `SchemaResult`（`applied`/`blocked`/`userVersion`/`columnCounts`）；③ 新增 `parseSchema` / `splitStatements` 导出；④ `openManaDb` 结果新增 `appliedColumns` 字段；⑤ `autoMigrate` 语义修正（原为死开关：`false` 时仍建表） | I-3、I-4（DDL 施加方式）、I-7（开库器返回值） | S0 | 2026-09-24 | S1/S2：调用 `createSchema(db)` 的实参须是真 `DatabaseSync`（已自带 `prepare`）；忽略返回值的调用**不受影响**。`openManaDb` 新增字段为**增量**，不破坏既有读取 |
| v0.1.1 | **冻结三件套口径修正**：`_freeze.files.txt` 的权威 walk 排除 `packages/*/lib/`（tsc 产物 + `.gitignore` 项；纳入会随「跑没跑过 build」漂移） | A0-12（三件套） | S0 | 2026-09-24 | 全体：重取清单腿须用新命令；`A0-12` 现**真读**三条腿（哈希/清单/HEAD），任一漂移即 FAIL |
| v0.1.2 | **命名契约补齐到 13 包**（原只列 P0 六个）：`naming.md` 增补 `scheduler`/`long-term`/`consolidation`/`forgetting`/`metacognition`/`user-model`/`ui` 七行；`A0-5` 改**扫实际 `packages/*` 目录**并逐包核 `name`/`inject`/`apply` + **patch id 与 `name` 一致** + **本表覆盖率** | I-5（三名映射表） | S0 | 2026-09-25 | 全体：新建包**必须**在 `naming.md` 登记，否则 `A0-5` 报红。`Config` 判定放宽为「三形态合法」（schemastery / 纯类型+缺省 / 无配置），但**声明 `export const Config` 就必须是 schemastery schema** |
| v0.2 | **W3 波次：`inject_log` 生产侧写入口 + 端到端事件链**：<br>① core 服务面新增 `writeInjectLog(entry)` / `listInjectLog(sessionId?, limit?)`，新增导出类型 `InjectLogEntry` / `InjectLogRow` 与守卫 `isInjectionGate`；<br>② `perception` 新增 `perceive(input)` 服务 + `chunkText()` 纯函数（发 `mana/observation`）；<br>③ `working-memory` 新增 `push()` / `snapshot()` 服务（消费 `mana/attention`，容量闸 + `evicted` 记账）；<br>④ `attention` 新增 `buildBlock()` 服务 + **Injection Gate**（挂 `agent/pre-step`，写 `inject_log`）；<br>⑤ `attention` 的 `status()` 增加 `injections` / `lastGate` 字段 | I-3（`inject_log` 读写面）、I-7（core 服务面） | S0 | 2026-09-25 | 全体：`gate` 取值域**只能**经 `writeInjectLog` 写入（非法值抛错）；消费方读审计用 `listInjectLog` 而非直连 `db`。`ManaCoreService` 新增方法为**增量**，既有调用不受影响 |

| v0.2.1 | **表结构补齐（三处「声明了却没建」）**：<br>① **新建 `user_model_history` 表**（A4-4 要求阶段 0 预留；`key`/`old_value`/`new_value`/`confidence`/`at`/`session_id`/`turn_id`/`source_evidence_id` + `(key,at)` 索引）；<br>② **`jev_log` 补 `gate` 列**（A1-8 原文要读它，而该列从未建过 ⇒ 判据结构上不可执行）+ `CHECK gate IN ('unavailable','budget')`；<br>③ **`memory_items_fts` 补三个同步触发器**（external content 虚表**不自动跟随主表** ⇒ 插入后 FTS 静默 0 命中） | I-3、I-4（表结构）、A1-8/A1-9/A1-10/A4-4 的落点 | S0 | 2026-09-25 | 全体：三条均由 ADR-6 的迁移机制承接（存量库自动补列/补表/补索引），无需手工 DDL；`splitStatements` 已支持 `CREATE TRIGGER ... BEGIN…END` 体内的分号 |

| v0.2.2 | **五类 `gate` 枚举全部接通生产侧 + 判定链接入**：<br>① `attention` 新增 `judgeState`/`judgeQuestion` 配置，Injection Gate 先问 `mana/jev/judge`（waterfall）再决定注入；<br>② 补 `skip_below_threshold`（判了但未过阈）与 `degraded_unavailable`（判定链降级）两个写入点 —— 此前 5 类中只有 3 类可达；<br>③ 补 `reset` 检测（已注入块不在上下文里时显式记账）；<br>④ `jev` 新增 `mana/jev/judge` 监听器（此前**无监听器**，判定链是空链） | I-1（`mana/jev/judge` 的消费侧）、I-3 的 `gate` 五类可达性 | S0 | 2026-09-25 | 全体：`gate` 五类现各有生产侧写入点与判据；`attention` 的判定链缺省 `judgeState=''` ⇒ 必然 `degraded_unavailable`（fail-closed，比"没判就注入"安全） |

## 变更背景（v0.2.2）

**缺口**：`inject_log.gate` 的 5 类枚举在阶段 0 冻结，但实测**只有 3 类有生产侧写入点**
（`injected` / `skip_no_candidate` / `reset`），另两类从未出现过：

| 枚举 | 原状态 | 本轮 |
|---|---|---|
| `skip_below_threshold` | **无写入点** ⇒ 「判了但未过阈」与「候选池空」不可分辨 | 接 `mana/jev/judge` 后按阈值分流 |
| `degraded_unavailable` | **无写入点** ⇒ fail-closed 的降级态无法留痕（A1-14 的核心） | 判定链不可用时显式记账 + 不注入 |
| `reset` | 无写入点（需上下文生命周期知识） | 检测已注入块是否仍在 `messages` 里 |
| `mana/jev/judge` | **全仓无监听器** ⇒ 判定链是空链，`jevProbability` 恒 null | `jev` 新增监听器（waterfall + next() 义务 + 降级显式） |

**实测澄清一处文档表述**（`event-types.ts` 说「用 `emit` 会**同步抛** TypeError」）：
逐轮探针后的准确表述是 —— `emit` **确实**会分发到监听器，但不提供 `next`
⇒ **只要监听器调用 `next()`** 就抛 `TypeError`；抛出通道在裸 `Context` 下是 `uncaughtException`
（会崩进程），经 `Loader` 装配时可能不冒泡。判据据此改为断言**因果链前两环**
（能送达 + `next === undefined` + 调它必抛），不依赖错误冒泡。

**另一处实测**：cordis 的 waterfall 是**洋葱模型**（**后注册者在更外层、先执行**，
实测顺序 `A-in → B-in → default → B-out → A-out`）⇒ 验证「某监听器有没有调 `next()`」
必须把哨兵注册在它的**内层**（即**先**注册），否则哨兵先跑、根本验证不到。

**实测**：全量测试 248 → **251**；A1-13 判据由 3 条用例扩到 **6 条**（覆盖五类枚举各自可达）。

## 变更背景（v0.2.1）

**三处都是同一形态：声明与生效不一致**（注释/判据承诺了，DDL 没给）。

| # | 声明处 | 实际 | 后果 |
|---|---|---|---|
| ① | `册:585/591` 明文「`user_model_history` 追加表**必须在阶段 0 预留**」 | 表不存在 | `user_model` 是 UPDATE 覆盖 ⇒ **「漂移」在数据上不存在**；到阶段 4 想数「30 天内改 ≥3 次」时**没有任何行可数** |
| ② | `jev_log` 的 DDL **注释里写着**「A1-8 要求 degraded 与 gate 至少一个非空」 | **gate 列从未建** | A1-8 判据**结构上不可执行**（查一列不存在的列）—— 注释让阅读者以为已经有了 |
| ③ | `memory_items_fts` 建表语句 | 无同步触发器 | external content 虚表**不自动跟随主表**：插一行后 FTS 仍返回 **0 命中且不报错** ⇒ 「中文召回恒 0」与「库里没有」**表面完全同形**（A1-10 要判红的形态） |

**顺带修的两处工具缺陷**（都由本轮实测暴露）：
- `splitStatements` 不认识 `CREATE TRIGGER ... BEGIN <stmt>; <stmt>; END;` 的体内分号 ⇒ 切出的碎片报 `incomplete input`（**指不到真因**）。已加 BEGIN/CASE…END 配平（仅对 `CREATE TRIGGER` 启用，避免误伤 `BEGIN IMMEDIATE`），且**数之前先去注释**（注释里的 "BEGIN" 字样会把深度算错）。
- `check-comment-guard` 加**精准归因**：模板串内出现未转义反引号时，直接点名「第几行」。该坑本席已踩三次，而原报错是 `Expected a semicolon` / `Module declaration names may only use quoted strings`（看起来像类型声明坏了）。归因自身失败时**显式打印原因**，不静默吞掉（写这段时正因 `readFileSync` 未 import 而静默失效过一次）。

**实测**：全量测试 225 → **251**；`a1-check` 判据项 11 → **14**（新增 A1-8 / A1-9 / A1-10）。
变异自证：删 FTS 触发器 ⇒ 仅 A1-10 红；让审计写入内容 ⇒ A1-9 红并点名泄漏片段；删 `jev_log.gate` 列 ⇒ 仅 A1-8 红。

## 变更背景（v0.2）

**根因**：`inject_log` 表在阶段 0 已建、5 类 `gate` 枚举已冻结（`docs/contract/degradation.md` §4），
但**从无生产侧写入** —— 全仓搜 `INSERT INTO inject_log` 只命中 `schema.ts` 的 DDL。
后果：`A1-13`/`A1-14` 两条判据**无表可查**，而它们覆盖的恰是本仓最在意的一类缺陷
（fail-closed 门控的**正常态与故障态表面完全同形**：都是"没注入"）。

**处置**：① 写入口收在 core 一处，`gate` 取值域**运行期强校验**（非法即抛，不静默落库）；
② `degraded` 用 `||` 而非 `??` 计算 —— 传 `degraded:false` **不得**抹掉 `gate='degraded_unavailable'`
已声明的降级事实（本仓实测：写测试时正是这条抓出了初版实现的漏洞）；
③ 注入面**尾部追加**，绝不改写既有消息（宿主契约原文「this waterfall cannot mutate messages」，
且 A1-7 要求前缀哈希逐字节相等）。

**实测**：全量测试 202 → **223**（+21）；`a1-check` 判据项 6 → **10**（新增 A1-1 / A1-13 / A1-14 / A1-6）。
变异自证：删留痕 ⇒ 仅 A1-13/A1-14 红（A1-1/A1-6 不误伤）；改尾部追加为前插 ⇒ 仅 A1-6 红。

## 变更背景（v0.1.2）

**根因**：`naming.md` 自称「本表是契约，不是备忘」，却**只列 P0 六个包**；而 `A0-5` 的目录清单是
**硬编码 6 元素数组**。两侧各存一份清单且都不完整 ⇒ **互为盲区**：7 个后建包若将三者名字写歧
（包名 / 插件 `name` / 服务名 / patch id），**编译期与机检都不会报**。按该契约开头的成因说明，
那正是「**只在运行期表现为插件不启动**」的形态（G11：装配清单 ≠ 生效）。

**处置**：① `naming.md` 补齐 13 行；② `A0-5` 不再自带清单，改为扫实际目录 —— 清单与真源同源，
漂移才可能被机检发现；③ 新增两条真判据：**patch id 必须等于插件 `name`**（原先无人核）、
**每个目录必须在 `naming.md` 有登记**。实测：覆盖 6 → **13**，变异测试两例（改名 patch id / 删一条登记）均报红。

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
