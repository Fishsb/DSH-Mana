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
