# Mana（末那识）分阶段落地册

> **版本**：v1.0 · 2026-09-24
> **生成方式**：圆桌会议 `mana-rollout-2026-09-24` 七席产出 + 主机工具实测 + 主持人逐条裁定。本册不重新论证方案，只把《Mana v5 方案》（`docs/mana-v5-plan.md`，1241 行）转成可照着执行的实施 + 验收册。⚠ **平台适配轮（2026-09-24 晚）**：v1.0 全部实测产自 **Windows**；项目现役为 **WSL2 / Ubuntu 26.04.1**（项目根 `/home/lk/Mana`，ext4），**命令口径已全部改为 Linux/bash**，细则与复验命令见 **§A 环境适配（WSL2）**；凡冲突处以 §A 为准。
> **与方案原件的关系**：方案是**设计意图**，本册是**可执行口径**。凡两者冲突处，本册以「本机实测」为准，并在 §1 逐条列出冲突、在 §8 记录裁定理由。方案原件**未被修改**。
> **阅读法**：要开工 → 直接读 §3.1 找到你的批次号，再跳到 §4 对应阶段；要查某个数能不能当阈值 → 读 §6；要查某条结论的可信度 → 读 §7。
> **⚠ 引用约定（本册与方案原件章节号撞号，必读）**：
> · **`方案 §N.M`** = 《Mana v5 方案》原件（`mana-v5-plan.md`，方案 §1–§19）的章节
> · **`本册 §N.M`** = 本册（§0–§10）的章节
> · **`阶段 N.M`** = 本册第 4 章里该阶段的第 M 小节（如「阶段 0.2 验收方案」）
> · 裸写 `§N.M` 时以**上下文**判：出现在「方案声称 / 方案原文 / 行号」旁边即为原件；出现在「见 / 读 / 退到」旁边即本册。
> · **三处高危歧义**（`§3.1` / `§6.1` / `§6.2` 在本册与原件中**都存在且含义不同**）本册已尽力加前缀，读到裸写时请按上一条判。
> **可信度标注约定**：本册所有数字分三档 —— **A 档（确定性值，可逐字复现，照抄可进阈值列）** / **B 档（浮动量，跨采样差 1.2–13 倍，只进测量条件说明，不进阈值列）** / **未验证（明确标注）**。分档依据见 §6.0。

---

## 0. 一页速览

**七阶段一句话**

| 阶段 | 方案 §17 行号 | 一句话 | 批次 |
|---|---|---|---|
| 0 | 1100 | 把契约 v0.1 冻死、把 P0 六个骨架立起来、把 CI 与「未运行可查」立起来 | B0.1 / B0.2 / B0.3 |
| 1 | 1107 | 打通 perception→attention→working-memory→scheduler→action 的端到端事件流（JEV 与向量并行） | B1.0 / B1.1 / B1.2 / B2.1 / B2.2 |
| 2 | 1114 | 长时记忆落地：ACT-R 激活方程 + 三路混合检索 + 三道门控 | B3.1 / B3.2 |
| 3 | 1122 | 巩固与遗忘：合并/chunking + 艾宾浩斯衰减 + 归档留存上限 | B4.1 / B4.2 |
| 4 | 1129 | 末那识本体：metacognition（审）+ user-model（我执） | B5.1 / B5.2 |
| 5 | 1135 | UI 与集成：Client 半区面板 + 认知轨迹回放 | B6.1 / B6.2 |
| 6 | 1142 | 评估与优化：L1–L4 + 消融 + 可靠性加固 | B7.1 / B7.2 |

**总量**

- **7 个阶段**（与方案 §17 一一对应）
- **18 个批次**（逐行 `3+5+2+2+2+2+2`）；「关键路径」分**两种口径**，见 §3.1.1（早前写的「11」是笔误残留值，已废）
- 人类等价工期保留方案原值，**实算 20–30 周**（方案未给「34」的来源，见 §1 第 11 条）
- agent 口径**不用周**：批次 = 一次可独立验证的执行段，可数、不估时
- **宿主基线：DSH `0.1.7-rc.1` · cordis `4.0.4`**（实测，2026-09-24 WSL）—— 本册 v1.0 实测依附于 Windows 侧 `0.1.5-rc.2`，现役已升。npm `latest` = `0.1.5-rc.3`、`next` = `0.1.7-rc.1`、`alpha` = `0.1.7-alpha.2`。**升级后须按 §2.1 版本纪律重跑受影响判据**，不是重写全册（`next`:`0.1.7-rc.1`，`latest`:`0.1.5-rc.3`）

> **⚠ 批次数差异说明（必读）**：本册的姊妹稿《R1 分期骨架》表头写「17 批次」，同表的阶段 1 却列了 5 项（B1.0 / B1.1 / B1.2 / B2.1 / B2.2）而标注 `（4）` —— 那是**计数笔误**，逐行相加为 5。本册**逐行重数**：`3+5+2+2+2+2+2 = 18`。以本册 §3.1 的表为准。按本册第 3 章数字纪律，此处显式声明差异而非改数凑平。

> **本册最重要的一条结论**

> **方案 §15.3 的「直接复用」承诺与 §13.2 的 7 个目标值，均不可直接采信。**
> 前者：被点名的 6 个包本机**一个都没装**，且唯一在 npm 真实存在的 `dsh-memory@0.1.0` 实测是**纯 FTS5 词法存储**（包内 5 个文件、`grep "vec0|sqlite-vec|rrf|cosine|bm25"` 零命中），与方案描述的「sqlite-vec KNN 余弦 + FTS5 BM25 + 三路 RRF」逐字不符。
> 后者：7 个目标值（85% / 0.8 / 500ms / 80% / 5% / 40% / 75%）在**全仓无任何实测基线**（`grep "基线|baseline|测出|测量"` 全文 0 命中），必须先测后设。
> 这两条一旦被当作既定前提写进实施步骤，阶段 1–2 会在错误底座上开工；故列为 §1 的 15 条相悖清单，逐条给出处理方式。

**✅ 两项待拍板已定案（2026-09-24）**

| # | 议题 | 决定 | 落点 |
|---|---|---|---|
| 1 | **JEV 层靠什么跑** | **走本机 Ollama logprob 合成 noul**（`qwen3.5:0.8b` + `think:false` + `num_predict=1`，概率口径 **`yes=0.577 / no=0.423`**，见 §8 C8 的更正）；**不用** `dsh-memory-jev` 的 OpenRouter 云通道（本机无 key）。LitJev 需 H100 80GB，本机物理不可行 | §8 C8 / §2 G13 / 阶段 1 B1.2 / 阶段 2 B3.2 |
| 2 | **G1–G15 先决阻断项** | **全数纳入阶段 0 硬门槛**（非「只做 3 条」、非「边做边补」）。**阶段 0 完成的定义 = 15 条每条都有产物或显式挂账** | 阶段 0 目标声明 + **A0-13** 归属判据 + G1–G15 归属表 |

⇒ 本册**已无待拍板项**，可直接作为开工依据。

---

## 1. 基线核验：方案声称 vs 本机实测（15 条）

> 全部为本机**工具实测**取数，非方案自述。命令可复算。第 15 条为写作期补入的硬约束。

| # | 方案声称（行号） | 本机实测 | 处理 |
|---|---|---|---|
| 1 | §15.3 行1010–1021「直接复用 dsh-memory / dsh-shoucang-memory / dsh-hindsight-memory / dsh-graphmemory / dsh-memoria / dsh-memory-jev」 | 本机**一个都没装**（`profiles/web/node_modules` + super-injector registry + 全盘深 6 层搜索，均未命中）。**但三条取证通道结论不同**，必须分列（见下「三分法」） | 复用件清单改**三分法**：本机已装 / npm 可得 / npm 无但 GitHub 有。**禁跨通道混用** |
| 2 | §15.3 行1015 称 `dsh-memory` 提供「sqlite-vec KNN 余弦 + FTS5 BM25 + 三路 RRF 融合」 | `npm pack dsh-memory@0.1.0`（8699 字节）解开后**仅 5 个文件**；`grep vec0/sqlite-vec/rrf/cosine/bm25` **零命中**；README 自述 "no embedding service, no API key, no sidecar process"，存储为 "a `memories` table plus an external-content FTS5 index" | 该描述**不符实，不得据此设计**。它是纯 FTS5 词法件 |
| 3 | §16 行1087「sqlite-vec 零基础设施，社区已验证」 | 可用但有三条硬约束：① 主包**不含扩展二进制**，靠 optionalDependencies 分发（**WSL 实测** `sqlite-vec-linux-x64@0.1.9` 内 `vec0.so` = **159,816 B**；Windows 侧为 `vec0.dll` = **289,280 B**）；② 扩展加载窗口**只在开库瞬间** —— `new DatabaseSync(p)` 后 `enableLoadExtension(true)` 报 `Cannot enable extension loading because it was disabled at database creation`，且 `{allowExtension:true}` 可开、每个新句柄都会重新关闭该窗口（**不可后补，只能删库重建**）；③ 加载失败极易被 `catch` 吞成静默词法降级 | 显式声明平台包（Linux 用 `sqlite-vec-linux-x64`）；开库一律 `{allowExtension:true}`；启动做 `vec_version()` 探针，拿不到**显式报错不静默降级** |
| 4 | §7.1 行500–503「关键词检索 FTS5 BM25」 | 中文在默认分词器（unicode61）下 **MATCH 命中 0**（"末那识"→0、"藏识"→0、"降级"→0，**英文 `MATCH test` → 1**，证明不是"库空"）；`tokenize='trigram'` 后 4 字命中（"末那识"→1、"认知架构"→1）、但 **2 字查询返回 `[]` 且不报错** | 建表显式 `tokenize='trigram'` + 查询最小长度约束（<3 字符即显式拒绝）；**0 命中与「库空」必须可分辨** |
| 5 | §16 行1091「测试 Vitest」（方案已改 `node:test`）/ §17 行1105「配 CI：typecheck + vitest」 | `node_modules/vitest` **不存在**（但**可装**：WSL 实测 `npm i -D vitest` 成功 → `vitest/5.0.1`；仍不采用，见 §8 C3）；样板 `test` 脚本实为 `node --test "test/*.test.mjs"` | 改 **node:test**。写法硬规定 `node --test "tests/*.test.mjs"`（glob）或 `node --test`（无参）；**禁止写 `node --test tests/`** —— 实测该写法报 `# tests 1 / # fail 1`，形似「测试失败」实为「命令写错」 |
| 6 | §16 行1092「包管理 pnpm」（方案已改 npm）/ §9.6 调试流程 | ⚠ **WSL 复核推翻 v1.0 实测**：`pnpm -v` → **12.4.2 存在**；`npm -v` → **11.19.1**；`corepack` → **0.24.0**；`dsh plugin --profile web list` **实测成功**（exit 0，13 packages）。**v1.0 的「pnpm 不存在 / dsh plugin 报错」系 Windows 侧特征，在 WSL 不成立** | **仍改 npm workspaces**（见 §8 C1，理由改为「对齐样板与 DSH profile 的 pnpm-lock」而非「pnpm 不存在」）。⚠ 该条的旧表述会被误读成插件问题，须在阶段 0 显式更正 |
| 7 | §9.4 行693 用 `ctx.emit` 分发 §9.3 行656 声明的 waterfall 契约 `mana/jev/judge` | 全文 `ctx.waterfall` **0 命中**、行691–710 **从未注册任何 waterfall 监听器**。实测为 waterfall 型事件注册 `(req,next)` 监听器却用 `ctx.emit()` 分发 → **同步抛 `TypeError: next is not a function`**（cordis `lib/index.js:281` map 分发） | 该契约是**死契约**：判定结果**结构上无法从该路径返回**，只能靠旁路事件带回；且关联键不一致（请求用 `id`，结果用 `requestId`）。**必须改成 `ctx.waterfall('mana/jev/judge', req, next)`** |
| 8 | §11.2 行809 `memory_items.vector BLOB` vs §7 行500 / §15.5 行1042 的 sqlite-vec vec0 | DDL 块（行789–864）内 `VIRTUAL TABLE` 全文 **0**、`fts5` **0**、`journal_mode` **0**、`PRAGMA` **0**；6 张表**全是普通表，无一虚表** ⇒ §7.1 三路检索与 §15.5 vec0 决策**在数据层没有任何落点** | 向量归属须唯一（见 §8 C4）；建表须补全虚表与 WAL 语句 |
| 9 | §11.2 行790–863 六张表 | **无 `session_id` / `turn_id` 列**；`mana_trace` 仅 `(seq,event_type,payload,timestamp)`。而 §6.1 行442–443 要求按 `(session,turn)` 计数 | 阶段 0 补列（见 §8 C6）。不补则 I1/I2 判据**永久无可数之处** |
| 10 | §13.2 行932–948 七个目标值（85% / 0.8 / 500ms / 80% / 5% / 40% / 75%） | 本机**全部无实测基线**；行932/942 表头为「指标 / 定义 / **目标**」—— 它们明确写在「目标」列，**不是**谎报成实测值；真缺陷是**没有任何可达性基线** | 全部改标「**待定，需首测后自设**」（见 §8 C7） |
| 11 | §17 行1100–1140 工期 | 实算：下限 1+3+4+4+4+4 = **20**，上限 2+4+6+6+6+6 = **30**。**「34 周」在全仓无任何来源** | 双口径并列（见 §8 C10）。请勿按 34 排缓冲，否则凭空多出 4 周并掩盖真实关键路径 |
| 12 | §17 行1140「多设备同步」 | 全文 grep `多设备同步\|同步\|sync` 仅 4 命中：行632/635 是事件语义「同步广播/同步版本」、行692 是 `ctx.on`、**行1140 仅这五个字，零设计** | 移出范围（见 §8 C5），记为独立课题 |
| 13 | §14 行969–984 十条「检测方式」 | 逐条判定：**真有信号 0 条 / 半真 3 条（#1 JEV 超时、#3 向量库不可用、#6 工作记忆溢出）/ 愿望 7 条**。"影响"列 10/10 清楚、"对策"列 8/10 有机制，唯独"检测方式"列 9/10 无落点 | 入阶段 0 硬判据（见 §8 C9）：每条故障模式必须给出表/字段名，给不出即标「**不可观测**」并入缺口清单 |
| 14 | 工程样板 `dsh-plugin-roundtable`（**WSL 现役副本 `/home/lk/dsh-src/dsh-plugin-roundtable`**；`/mnt/d/lk/FF/` 下另有一份 9p 副本，平台包版本不同，见 §A.4） | **WSL 复测结果与 v1.0 不同**：在 **ext4 副本**上 `npm run typecheck` = **exit 0**（v1.0 记的 exit 2 / 7 error 是 **9p 副本 + 0.1.5 平台包**的产物）；`npm test` = **348 tests / 327 pass / 21 fail**，HEAD = `a8c8bb7`，跑前跑后 `git status --porcelain` 均 **19 行**（非我造成）。21 条失败**全是样板自身的跨平台假设**（13 条渲染面用 `.pathname.replace(/^\//,` + "'" + `)` 拼路径 ⇒ Linux 下丢根导致 ENOENT；另 3 文件缺 `@deepseek-ai/dsh-scope`） | **只能抄袭工程外形，不能抄 API 用法**；新仓必须自测一次 typecheck，**不得拿样板当绿基线**。⚠ 其**测试脚本自身**在 Linux 上不可用，抄测试脚手架时须先修路径（`fileURLToPath`） |
| **15** | §6.1 行438 Injection Gate 挂在 `agent/pre-step` 阶段注入记忆 | **WSL 实测**：`~/.dsh/profiles/web/node_modules/dsh-shoucang-memory/lib/` 下 `agent/pre-step` 在**4 个文件共 9 处**出现：`panel-inject.js` 533/626/773（v1.0 记 525，已漂）、`mcl.js` 6/372/477、`relevance-supply.js` 17/168、`targets.js` 421。**真实注册点仍只有 2 个**（`.on('agent/pre-step'` 逐行核实）：`panel-inject.js:773` → `hook.on('agent/pre-step', async (payload, next) => …)`；**`mcl.js:372` → `ctx.on('agent/pre-step', (payload, next) => handlePreStep(...))`**。`agent/pre-step` 是 DSH 官方 **waterfall** 扩展点（签名 `(payload:{agent,messages,turn,step,signal}, next)`） | **本册风险最高的一条**：waterfall 是环绕中间件，**不调 `next()` 就吞掉下游全部行为且不报错**。Mana 的 Injection Gate 若也挂这里而漏调 `next()`，会**静默掐死用户现有的热记忆注入（773 路径）与 MCL 慢通道（372 路径）**。⚠ **只盯 773 取证会假绿** —— 两条链是**独立注册**的，漏调 `next()` 时 773 可能仍绿而 372 已被掐死 ⇒ **回归观察点必须分链落地**。且「不改 shoucang」的 notDoing 清单**挡不住它 —— 破坏方是新代码**。这是「拆东墙补西墙」的判定样例。处理见 **§2 G9** |

### 1.1 复用件三分法（替换一切「直接复用/查无此物」的单一表述）

**三条取证通道结论不同，禁止混用** —— 混用会得出相反结论（实测：某包在 npm 上 E404，在 GitHub 上实存）。

| 档 | 包 | 版本/证据 | 取件方式 |
|---|---|---|---|
| **① 本机已装** | `dsh-shoucang-memory` | **v0.3.1**，`~/.dsh/profiles/web/node_modules/dsh-shoucang-memory`（WSL 实存），Apache-2.0，`"private": true` | 目录即用（本机版本真源、可作行为对照）。⚠ 该目录由 shoucang 仓 `link:` 装配，**非只读件**，见 §A.5 |
| **② npm 可得** | `dsh-memory` | **0.1.0**（仅此一版，2026-08-13，无 repository/homepage/author 字段 ⇒ 无法从包回溯源码仓） | `npm i` —— **但不推荐**：它是纯 FTS5 词法件（见 §1 第 2 条） |
| | `dsh-graphmemory` | **0.2.0**，3.62 MB / 99 文件；`peerDependencies` 含 `@deepseek-ai/dsh-typert-protocol`，**本机不可用**（`test -e` = false） | `npm i` 需补 DSH 平台包，与「零外部依赖」冲突 |
| | `dsh-memoria` | **0.1.0**；npm README 自述 "owns one long-lived **Python subprocess** (`python -m memoria.plugin_server`)" | 与方案 §16「存储 SQLite 零外部依赖」**直接冲突** |
| **③ npm 无、GitHub 有** | `dsh-memory-jev` | npm **E404**；GitHub `Towzai/dsh-memory-jev` **存在**，**v0.4.1**，MIT，pushed 2026-09-20，66 KB | **可 clone / 可走 API 逐文件取，不可 `npm i`** |
| | `dsh-shoucang-memory` | npm E404；GitHub `Fishsb/dsh-shoucang-memory` **存在且 public**（`private: false`），Apache-2.0，pushed 2026-09-23，tree 953 项，**含 105 个 TS 源文件**（`src/vec.ts` 23815 B ↔ `lib/vec.js` 22915 B） | 同上。⚠ 修正：**不是「私有件」，是「已开源未发布 npm」**；且**有 TS 源可取**，不必只搬 107 个 `lib/*.js` |

**取件通道现状**：`git clone https://github.com/...` **经复核可用**（3/3 次成功，含 `Fishsb/dsh-shoucang-memory` 取到 **105 个 TS 源文件**）。⚠ 早前一次 `Failed to connect to github.com port 443` 系**瞬时抖动**，据此写成的「clone 不通」判定**已撤销**（见 §8 C15）。取件策略：**优先 clone**；若失败则重试，再失败才回退 **API 逐文件**（可 `contents/<file>` 取单文件、`trees?recursive=1` 取全树）。
**⚠ 取证纪律**：GitHub **搜索通道返回空不得当作「不存在」的证据** —— 本次搜索通道返回空而 API 逐仓库求证实存，二者结论相反。

### 1.2 `dsh-memory-jev` v0.4.1 与方案 §6 的同构程度（决定阶段 1/2 是否从零自研）

逐条对照（主持人取 README / package.json / cordis.patch.yml 原文比对）：

| 维度 | 结论 |
|---|---|
| 三道门控语义 | **完全一致**。Write Gate：bigram 预过滤 → 一次 fan-out（`worth_keeping` noul + `supersedes` choice + none），失败 **fail-open 仍写入**、标 `gate=unavailable\|budget`；Recall Gate：词法 top-N → 每候选 `rel_<id>` noul，失败**回退本地排序标 `degraded`**；Injection Gate：挂 **`agent/pre-step`**，失败 **fail-closed 什么都不注入** |
| I1/I2 不变式 | **逐字一致**（含「已注入 id 在 Jev 调用前就从候选池移除」） |
| 安全边界 | 一致：`<retrieved-memories …>` 自标识 + 内容 `<` 转义 `\u003c`（**记忆无法伪造分隔符**）；前缀缓存友好（仅尾部追加） |
| 工具集 | 一致：`mem_remember / recall / list / view / forget / restore / merge / pin / gate_status / gate_log`；审计日志**只有 id 与哈希、无正文**；**物理删除永不发生** |
| 方案没写、实现有的 7 个参数 | `injectLimit: 3`、`injectMinProbability: 0.6`、`prefilterLimit: 40`、`supersedeCandidates: 12`、`dailyBudgetCny: 3.5`、`dailyCallLimit: 3000`、`storePath: ''` |
| 运行约束 | `engines.node >= 22`；`test` 脚本 = `node --import ./tools/load-plugin.mjs tools/verify_all.mjs` ⇒ **同为 node:test 系，再次佐证 §8 C3「不用 vitest」** |
| 通道 | 声明云端通道 `openrouter.ai/api/alpha/decisions` + `OPENROUTER_API_KEY`，但同时 `offlineMode: true` |

**两条结论**：
- **(a)** 阶段 1/2 **不必从零自研三道门控** —— 可把 `dsh-memory-jev` 作「参考实现 + 可移植候选」，但取件是 **clone / API 取件**，不是 `npm i`。
- **(b)** **JEV 承载已拍板定案（2026-09-24）**：**走本机 Ollama logprob 合成 noul**（`qwen3.5:0.8b` + `think:false`；⚠ 概率口径以 §8 C8 的更正值为准：**`yes=0.577 / no=0.423`**，早前顺手记的 `0.887/0.101` 复现不出），**不用**其 OpenRouter 云端通道（本机无 key）。见 §8 C8 与阶段 1 的 B1.2 实施写法。
- **附带收益**：`tools/fake-jev.mjs`（6884 B）是「零网络、确定性响应」的假 Jev 端点，含 `http-error / network / timeout / malformed-json` 等失败模式注入 ⇒ **阶段 1 的降级链 mock 不必自己写**。

---

### 1.3 原方案 §1–§19 覆盖矩阵（确认无遗漏章节）

**核查方法**：对原方案 19 节逐节查本册是否有对应处置（含子节引用）。结果：**18 节有直接落点，1 节（方案 §18）内容已覆盖但未曾以方案 §18 名义归档** —— 已在本节补上映射，确保无遗漏。

| 原方案节 | 内容 | 本册落点 |
|---|---|---|
| §1 项目概述 | 命名/定位/插件清单 | §0 速览 / §3.1 / §8 C2 |
| §2 文化根基 | 末那识映射 | 理念层，不涉实施；影响 §4 阶段 4 命名与三插件定位 |
| §3 理论基础 | ACT-R / SOAR / JEV / Jev-Mem | §8 C8（JEV 承载）/ 阶段 2 A2-1、A2-2（激活方程锚点） |
| §4 总体架构 | 13 插件 / 事件总线 | §8 C2（装配面收敛）/ §3.2（依赖图） |
| §5 认知内核机制 | 激活方程 / chunking / 容量 / 调度 | 阶段 2 B3.1、A2-1、A2-2 / 阶段 3 B4.1（chunking 触发条件） |
| §6 JEV 决策层 | 三道门控 / 工具集 / 批量缓存 | §1.2（与 `dsh-memory-jev` 逐条同构）/ §2 G14（Top-50 不可达）/ 阶段 2 B3.2 |
| §7 向量与混合检索 | 流水线 / RRF / 嵌入 / 衰减 | §8 C4（路线选择）/ A1-4（RRF 锚点）/ A1-12（嵌入）/ §2.2 W-1..W-3（vec0 语义） |
| §8 巩固与遗忘 | 触发 / 艾宾浩斯 / 物理删除 | 阶段 3 全节 / A3-2（真归档 vs 打标记）/ A3-4（衰减自洽） |
| §9 DSH 插件化实现 | 清单 / 结构 / 事件契约 / 调试 | §1 条7（死契约）/ §2 G6 / §8 C13 / 阶段 0 全节 |
| §10 多 Agent 并行开发 | 分工 / 流程 / 依赖规则 | §8 C11（灰度冻结）/ §3.2（并行扇出 7 路）/ §8 C13 |
| §11 存储与数据模型 | 6 张表 DDL / 路径 | §2 G3、G4、G7、G15 / A0-8（补列建表）/ 阶段 1「表落点声明」 |
| §12 可靠性保障 | 六层 / 降级链 / 一致性 / 边界 | §2 G8、G10、G11 / A1-8、A1-11（降级可区分）/ A2-6（软删可逆） |
| §13 评估框架 | L1–L4 / 指标 / 消融 / 行为测试 | §8 C7 + §6.1（七目标值全待定）/ A6-1（消融）/ §5 H1、H5（人工判据） |
| §14 故障模式 | 10 行检测方式 | §2 G2 + §8 C9 + A0-9（**0 真信号 / 3 半真 / 7 愿望**） |
| §15 算法与框架决策 | 8 组合决策 | §1 条1–2（复用三分法）/ §8 C4、C8、C15 / §1.2 |
| §16 技术选型 | 语言 / 框架 / 存储 / 测试 | §2 G12 + §8 C1、C3（npm/node:test）/ 阶段 0 B0.1 |
| §17 路线图 | 7 阶段 | §3.1（双工期口径）/ §3.1.1（关键路径两口径）/ §4 全章 |
| **§18 风险评估** | **11 条风险** | **⚠ 见下方映射表（本节新增）** |
| §19 附录 ABC | 速查表 / 参数 / 参考 | 附录 B 参数 → §7 未验证项 6（数值品味不评，只保公式可复现） |

**§18 十一条风险 → 本册落点映射**（补齐的缺口）

| 原方案风险 | 本册处置 |
|---|---|
| JEV 服务不可用 | 阶段 2 A2-8（三道门控各自按预期失败）；§8 C8（本机承载方式已定） |
| JEV 误判 | §4 阶段 3「记忆爆炸探针」同理：**`jev_log` 须加 `verdict` + `verify_state`**，且**误判率必须与核验覆盖率同时暴露**（否则「0% 误判」与「从未核验」同形——见 §7 缺口） |
| 向量检索不准 | A1-4（RRF 确定性）+ A1-12（语义间距）+ §2 G5（中文词法非静默归零） |
| 上下文超限 | 阶段 0 工作记忆 ≤4 组块；**I1 注入不变式作为阶段 2 硬验收项**（实测省 67% token） |
| 隐私泄露 | 阶段 0 目录 `owner-only` 权限风格（对齐官方 `mode 448`）+ 全本地（bge-m3 + Ollama） |
| 成本过高 | §8 C8 走本机 Ollama（零 token）；JEV 缓存 TTL 300s + 熔断 + 每 session 预算上限 |
| Agent 冲突 | §3.2 依赖图 + §8 C2（装配面收敛）+ §8 C13（core 独占契约） |
| 契约漂移 | A0-12（契约快照哈希）+ §8 C11（灰度分版） |
| 记忆爆炸 | 阶段 3 `store/snapshot` 探针（**判增速不判绝对值**）+ 归档留存上限（§8 阶段 3 阻塞点） |
| 输入截断致 JEV 失明 | 阶段 1 `jev_log` 加 `input_chars` + `trimmed`；**红灯样本 = `trimmed=1 且 verdict=DROP`**（见 §7 缺口清单） |
| 用户模型漂移 | 阶段 4 `user_model_history` 追加表（A4-4）+ 「30 天内改 ≥3 次」判漂移候选（**须阶段 0 预留表结构**） |

## 2. 先决阻断项（入场闸 · 不修则后续验收全部失去意义）

> 下列 15 条**按「会掩盖其他问题 / 让失败不可观测」优先排序**，不按严重度排。每条给：现象 / 实测证据 / 不修的后果 / 修在哪一步。
> 排序理由：本项目**使用者只有一名、没有「用户报障」通道** ⇒ 测不出来的失败就是永久静默失效。

| 闸 | 阻断项 | 实测证据 | 不修的后果 | 修在哪 |
|---|---|---|---|---|
| **G1** | **性能数字跨采样浮动 1.2–13 倍，绝对毫秒不可作阈值** | 同一台机器两次独立采样：JS 余弦 10k = `20.92 ms` vs `8.40 ms`；vec0 KNN 10k = `35.877 ms` vs `11.17 ms`；bge-m3 冷启 = `1037 ms` vs `77.2 ms`；改写相似度 `0.784169` vs `0.979985`；无关相似度 `0.336102` vs `0.393894`。而 RRF/衰减/ACT-R 数学闭式值两席**逐字复现** | 把单次采样钉进阈值列，验收时会「一会儿过一会儿不过」，最终被当成噪声忽略 ⇒ 阈值失效 | 全书（§6 写分档规则） |
| **G2** | **方案 §14「检测方式」列 0 条真有信号** | 逐条判定：**真有信号 0 / 半真 3（JEV 超时、向量库不可用、工作记忆溢出）/ 愿望 7**。「影响」列 10/10 清楚、「对策」列 8/10 有机制，唯独「检测方式」列 9/10 无落点 | 故障发生了没人知道；阶段 6「可靠性加固」没有可加固的对象 | **阶段 0 硬判据**（表结构在此冻结） |
| **G3** | **I1/I2 不变式无可数之处** | §6.1 行442–443 要求按 `(session,turn)` 计数，但方案 §11.2 行790–863 六张表**无 `session_id`/`turn_id`**，`mana_trace` 仅 `(seq,event_type,payload,timestamp)` | 两条自称的硬不变式**永久不可验**；注入频率失控无法发现 | **阶段 0 补列** |
| **G4** | **`node:sqlite` 扩展加载窗口不可后补** | `new DatabaseSync(p)` 后 `enableLoadExtension(true)` → `Cannot enable extension loading because it was disabled at database creation`；只有 `new DatabaseSync(p,{allowExtension:true})` 才行。且 `loadExtension('假路径')` 报 `找不到指定的模块`（证明通道本身通） | 按最自然写法建库后**永远**上不了 vec0，且不报错；要改只能删库重建 | **阶段 0 契约写死** |
| **G5** | **中文 FTS5 静默归零** | 默认 unicode61：`MATCH '末那识'`→**0**、`'藏识'`→0、`'降级'`→0，而英文 `MATCH test`→**1**（证明不是库空）；`tokenize='trigram'` 后 4 字命中，但 **2 字查询返回 `[]` 且不报错** | 方案 §7.1 的关键词检索这一路**开箱即失效**，且「0 命中」与「库里本来没有」**完全同形** | **阶段 0 契约**（锁 tokenizer + 最小查询长度） |
| **G6** | **§9.4 示例用 `emit` 分发 waterfall 契约** | 为 waterfall 事件注册 `(req,next)` 监听器却用 `ctx.emit()` 分发 → **同步抛 `TypeError: next is not a function`**（cordis `lib/index.js:281` map 分发）。全文 `ctx.waterfall` **0 命中** | 按方案原样实现，**第一个 observation 事件就炸**；且错误位置远离真因 | **阶段 0/1** |
| **G7** | **`busy_timeout` 默认 0 ⇒ 并发写立即失败；无事务封装** | `PRAGMA busy_timeout` 默认 `{"timeout":0}`；`db.transaction` = `undefined`、`db.pragma` = `undefined`；事务内 SQL 报错**不自动回滚**（实测 count 仍为 1）。先设 2000 才「卡 2247ms 后失败」 | 并发写立即 `database is locked`；`catch{}` 一吞 ⇒ **静默丢记忆** | **阶段 0/1** |
| **G8** | **静默降级形态已有先例，且方案未禁止** | 本机 shoucang `lib/vec.js:254` 原文为 `catch { return null }` —— 把「provider 失败」与「正常空结果」混为一谈。而 §6.1 的三道门控失败策略（fail-open / fail-degraded / fail-closed）**没有一条要求把失败写成可查字段** | 阶段 1 的向量档**看起来跑通、实际全走词法**；查不出、测不到 | **阶段 1 判据**（A1-8 已含） |
| **G9** | **Mana 的 Injection Gate 与 shoucang 争同一 waterfall 扩展点** | `agent/pre-step` 在 shoucang `lib/` 下**6 处**出现（`panel-inject.js:525/626/773`、`mcl.js:6/372/477`）；**真实注册点有两个且互相独立**：`panel-inject.js:773`（`hook.on(...)`）与 **`mcl.js:372`（`ctx.on(...) → handlePreStep`）**。该扩展点是官方 waterfall；shoucang 源码自述「零抛出（异常只审计，绝不打断了 agent 循环）」 | Mana 若漏调 `next()` → **静默掐死用户现有的热记忆注入与 MCL 慢通道**，且不报错。⚠ **只盯 773 一条链取证会假绿**（漏调时 773 可能仍绿而 372 已被掐死）。⚠ 「不改 shoucang」的 notDoing 清单**挡不住它 —— 破坏方是新代码** | **阶段 0 契约 + 阶段 1/2 回归判据（分链）** |
| **G10** | **卸载 ≠ 数据回滚，且回放会复活旧状态** | 方案 §12.4 行911「物理删除永不发生」+ 方案 §12.3 行904「插件重启后从 mana_trace 回放」 | 卸载插件后 DB 行仍在；再注入即回放旧 trace。执行者以为「卸载即回滚」⇒ **回滚失败不可观测** | **阶段 0 定约**（每阶段回滚双层：插件层 + 数据层） |
| **G11** | **装配清单 ≠ 生效；空壳与真插件同形** | 方案 §12.1 行885 只给「插件卸载时自动清理」；`dev_plugin_status` 属**机制自证**（用户纪律：心跳/端口/文件增长皆机制自证） | 13 个空骨架全装配起来，面板全绿而**零行为** ⇒ 阶段 0/1 整段假绿 | **阶段 0 判据**（A0-5/A0-6 + 反证判据） |
| **G12** | **方案 §15.3 复用承诺不实 + 复用件分三档** | 见 §1 第 1–2 条与 §1.1。三档：本机已装（仅 shoucang）/ npm 可得（dsh-memory、dsh-graphmemory、dsh-memoria）/ **npm 无但 GitHub 有**（dsh-memory-jev、dsh-shoucang-memory）。⚠ **取件通道经复核可用 `git clone`**（3/3 成功），早前「443 不通」的判定系瞬时抖动所致、已撤销（见 §8 C15） | 阶段 1 照「直接复用」写 ⇒ 找不到东西；把 npm E404 误判为「不存在」⇒ 重复自研 | **阶段 1 前置** |
| **G13** | **JEV 承载方式**（原为未定项） | 方案 §15.4 首选 LitJev：需 `Qwen3.8-27B` + **H100 80GB**（本机 RTX 2070S 8GB）；且本机 `uv`/`python` 均未找到。替代实测：Ollama `/api/chat` + `logprobs` + `think:false` + `num_predict=1` → `qwen3.5:0.8b` 判得出 yes/no（⚠ 概率以 §8 C8 更正值为准：`yes=0.577 / no=0.423`） | 阶段 1 首日即撞；若照 LitJev 写则整批作废 | ✅ **已拍板（2026-09-24）**：走本机 Ollama logprob，见 §8 C8 |
| **G14** | **性能目标与实测规模脱节（方案 §6.4 的 Top-50 fan-out）** | 实测 `qwen3.5:0.8b` × 50 并发 → `ok=50/50, wall=7599ms, p50=5756ms`；而方案 §13.2 目标是 `<500ms`，**超十倍以上**。且 50 条 yes 概率全落在 `[0.266, 0.405]` 窄带（基本无区分度） | 按 §6.4 原样实现必然不可达；且窄带意味着**该模型对这批 prompt 无判别力** | **阶段 1**（改分批 + 早停 + 预算）。⚠ **口径经 2026-09-24 复测修正，见下方「G14 复测更正」** |
| **G15** | **存储目录与资源上限未定** | `~/.dsh/memory` **不存在**（WSL 复核：`test -e ~/.dsh/memory` = false；DSH 无 `memory` 约定目录，shoucang 用 `~/.dsh/suite/knowledge`）。另：方案 §A.2 把 `vector BLOB` 放主表，实测等效每条 JSON `12,962 B`（含 1024 维 float）；float32 BLOB 为 `4,096 B` + 元数据，10 万条 ≈ 400MB 起，且单行 >2KB 会溢到 overflow page | 阶段 0 建库即找不到父目录；向量方案在数据量增长后退化 | **阶段 0 建目录 / 阶段 1 定内存常驻策略** |

### G14 复测更正（2026-09-24 · 本席实测，推翻「Top-50 不可达」的**实现口径**）

> **为什么必须更正**：G14 的结论「按 §6.4 原样实现必然不可达 ⇒ 改分批 + 早停」会把 B1.2
> 往**更慢**的方向引。真因不是「50 个判断太贵」，而是**「50 次 HTTP 往返」贵**。
> 方案 §6.4 的「批量」指的是**一次请求里带多个问题**（那是 JEV 原生批量语义），
> 不是「并发发 50 个单问请求」。G14 的 50-并发实测针对的是后者。

**复测数据（A 档 = 可逐字复现；同一 0.8B 模型、`think:false`、`temperature:0`）**

| 方式 | 问数 | 实测 | 说明 |
|---|---|---|---|
| 并发 50 个单问（G14 原测） | 50 | `wall=7599ms / p50=5756ms` | 50 次 HTTP 往返 ⇒ 这才是超 `<500ms` 十倍的真因 |
| **单次调用带 10 问** | 10 | **`184–275ms`** | 1 次往返 |
| **单次调用带 50 问** | 50 | **`1046–1228ms`** | 1 次往返；比 50 并发快 **约 6×** |

⇒ **结论修正**：批量**本身可达**（50 问 ≈ 1.2s，不是 5.8s），**但 `<500ms` 目标在 50 问规模下仍不可达**。
B1.2 的正确策略是 **「少往返 + 分批 + 预算」**，而不是「早停以省判定次数」。

**⚠ 三条实测陷阱（不复测就一定会踩，且都是静默的）**

| # | 陷阱 | 实测证据 | 后果 |
|---|---|---|---|
| 1 | `logprobs` / `think` **必须是顶层参数**，放进 `options` 里被**静默忽略** | 顶层 → `logprobs = list`；放进 `options` → `logprobs = NoneType`（**不报错**） | 判定链恒降级或恒取不到概率 ⇒ 与「模型答不出」同形 |
| 2 | `logprobs` 是**逐位置**数组，`num_predict:1` 只给 `pos0` | 批量 5 问 + `num_predict:1` → 只产出 1 个答案（`"Based"`） | 只判了第 1 问，其余**静默无判定** |
| 3 | 批量返回的是**裸 `yes/no` 行，不带编号**；问数多时会**多答** | n=10 → 10 行；**n=50 → 75 行**（模型自说自话） | 行序错位即**张冠李戴**：把 A 记忆的判定安到 B 上，且看起来「成功」 |

⇒ **判据要求（挂 B1.2）**：批量判定必须**逐问回填断言对齐**（问数 == 答案数、且逐问可对位），
不得只判「调用成功」或「有答案返回」。陷阱 3 是典型「让失败不可观测」——错位后没有任何报错。



> **本节是 2026-09-24 复核后新增，并在同日晚的「平台适配轮」再次更新**。起因：用户提示「当前 DSH 最新 0.1.7-rc.1，注意环境差异」。⚠ **该提示当时被误判为「本机未升级」** —— 那是**Windows 侧**的结论；**WSL 现役实测已是 `0.1.7-rc.1` + cordis `4.0.4`**。以下表格已按 WSL 复核更新，**v1.0 的「本机未升级」结论作废**。

**实测环境事实（2026-09-24）**

| 项 | 值 | 取证 |
|---|---|---|
| 本机实际运行版本（**WSL 现役**） | **`0.1.7-rc.1`** | `npm ls -g @deepseek-ai/dsh --depth=0` → `/usr/local/lib/node_modules/@deepseek-ai/dsh`；`node -p "require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version"` |
| npm `latest` 通道 | **`0.1.5-rc.3`** | `npm view @deepseek-ai/dsh dist-tags` |
| npm `next` 通道 | **`0.1.7-rc.1`** | 同上（**0.1.7-rc.1 确实存在，但不在 latest 通道**） |
| npm `alpha` 通道 | `0.1.7-alpha.2` | 同上 |
| 已发布版本序列 | `… 0.1.5-rc.1 / rc.2 / rc.3 → 0.1.7-alpha.1 / alpha.2 / rc.1` | `npm view @deepseek-ai/dsh versions`（dist-tags 实测：`latest` `0.1.5-rc.3` / `next` `0.1.7-rc.1` / `alpha` `0.1.7-alpha.2`） |
| cordis 版本 | 本机 **`4.0.2`**；0.1.7-rc.1 要求 **`~4.0.4`** | 两版 dependencies 对比 |

**⚠ 三条直接影响的差异（已核对，附处置）**

> **复核修正（2026-09-24）**：本节初稿把 **V-1（cordis 4.0.2→4.0.4）** 的风险定级偏高了。据既有经验（`[tool] DSH 升版 API 面`）：**`dsh-tools` 钩子为纯增量**（新增 `projectContent`，未删改既有钩子）⇒ 「升级会改掉 waterfall/`emit`/`bail` 语义」属**推测，非实测**。下表已改为**「待复跑验证」而非「已知风险」**。

| # | 差异 | 对本册的影响 | 处置 |
|---|---|---|---|
| **V-1** | `cordis` 由 `^4.0.2` → **`~4.0.4`**（次版本上浮） | 本册 §1 条7、G6、阶段 1 的 **waterfall / `emit` / `bail` 语义**基于 **4.0.2 实测**。⚠ **但既有经验显示 `dsh-tools` 钩子为纯增量** ⇒ 语义**大概率不变**，只是**未被本册实测覆盖** | **升级后复跑一次**（非「必须重跑才有效」）：① `emit` 分发 waterfall 型事件是否仍抛 `TypeError: next is not a function`；② `bail` 判据是否仍为「非 `null`/`false`/`undefined`」；③ `parallel` 失败是否仍聚合为 `AggregateError`。**三条复跑通过 → 判据照用；任一变 → 按新行为改判据并记入本节** |
| **V-2** | 0.1.7-rc.1 **仍导出 `ctx.agents`**（非 `ctx.subagents`） | ✅ **对 A0-4 无影响**：本册 A0-4 的负向探针是「故意引用不存在的宿主成员（如 `ctx.subagents`），断言 typecheck **必须报错**」。已实测 0.1.7-rc.1 的 `dsh-agent/lib/types/index.d.ts:20` 仍是 `agents: AgentRegistry;` ⇒ **该探针在 0.1.5 与 0.1.7 上都成立** | 无需改判据；但**不要**把探针换成 `ContentBlock`（那是上游发包缺 `.d.ts` 的误报，非 API 改名） |
| **V-3** | 0.1.7-rc.1 **新增** `@deepseek-ai/dsh-experimental-agent-team-profile`；且 `dsh-tools` 新增 **`projectContent`** 钩子、`system-prompt` 新增 **`interpolate`** 键、`defineTool` 的 `author` 形 `parameters` 会**被归一化为 JSON-Schema** | ① 本册未依赖 `dsh-experimental-agent-team-profile` ⇒ 无影响；② **`interpolate` 有实际影响**：本册阶段 1 的注入块组装若含 `{{…}}`，在 0.1.7 上**可能触发新的插值行为**（既有教训：注入文本禁裸插值，`{{…}}` 曾致 `renderPrompt` 抛错）；③ **`defineTool` 归一化**：Mana 的 `mem_*` 工具若按 author 形写 `parameters`，**不要再手工转 JSON-Schema**（会二次转换） | 阶段 1 组装注入块时**避免裸 `{{...}}`**（沿用既有 `guardContextText` 式转义）；工具定义交给 `defineTool` 归一化，不手工转 |

**版本纪律（五条，写进阶段 0）**

1. **A0-1 必须记录 DSH 版本号**（已改，见 §0.2）：不记录版本，一切「实测」在升级后都失去前提。
2. **升级 = 重跑受影响判据，不是重写全册**：影响面已按上表**收敛到 V-1 的三类事件语义探针 + V-3 的 `interpolate`/`defineTool` 两条**；其余判据（`node:sqlite` / FTS5 / vec0 / 嵌入服务 / 文件路径 / 构建链）**与宿主版本弱耦合**，只需复跑 A档确定性值（§6.0）确认未漂。
3. **装配面三处复账**（引用自 `[环境] 插件官方安装通道` 的既有经验）：升级后须核对 **① 全局 npm 安装源 `/usr/local/lib/node_modules/@deepseek-ai/dsh`（`dsh` 命令来源）② `~/.dsh/profiles/*/node_modules`（profile 装配，`dsh plugin --profile web list`）③ 正在运行的宿主进程 `ps -o cmd -p <pid>` 与其 `readlink /proc/<pid>/exe`** 三处版本是否一致。⚠ v1.0 记的 `C:\Users\lk\.dsh-win\prefix` 是 **Windows 侧遗留路径**，WSL 不适用（但该目录仍在，见 §A.1 双安装）
4. **通道语义**（引用自 `[路径] 判 @deepseek-ai/dsh 稳定/预发布通道与变更`）：`latest` = 稳定（**rc 即稳定**）、`alpha` = 预发布、`next` 介于其间；**无 CHANGELOG**，变更对比只能靠 **git log 区间或 npm 依赖增量**；alpha 可领先稳定上千提交 ⇒ **升级先验证勿直装**。
5. **判现役版本以实跑为准，不按主包版本硬查**（引用自 `[环境] 内置技能与配置定位`）：DSH 子包**各有独立版本线**，`@deepseek-ai/dsh-tools` 等在 `dsh` 自带嵌套 `node_modules` 而非 profile 根；权威判据是**实跑 `dump-config` 与真启动**，不是读主包 `package.json`。

> **升级决策已不适用**：v1.0 建议「阶段 0–1 留在 0.1.5-rc.2」，前提是**当时未升级**；**WSL 现役已在 `0.1.7-rc.1`**（`next` 通道），该建议**失效**。现改为：**以 `0.1.7-rc.1` 为基线开工，不再做版本切换**（避免在判据密度最高的阶段 0–1 制造「实现有 bug」与「宿主改了」两类失败混淆）；§2.1 的 V-1/V-2/V-3 三条差异**须在阶段 0 首日按实测复跑一次**并回填结论。

### 2.2 四条「方案没写但会静默出错」的 vec0 语义（实测新增）

若启用 sqlite-vec，以下四条**必须显式处理**，否则不报错但语义偏离：

| # | 语义 | 实测 | 处理 |
|---|---|---|---|
| W-1 | **默认度量是 L2，不是余弦** | 同一对向量：L2 距离 `0.8944` vs 余弦距离 `0.4000`；不写 `distance_metric=cosine` 即静默用 L2 | 建表显式 `distance_metric=cosine`（方案 §7.1/§15.5 声称余弦） |
| W-2 | **`rowid` 必须 BigInt** | 传 `1` 报 `Only integers are allows for primary key values`；传 `1n` 才通。普通表用 number 正常 | 同一进程两套 id 语义并存，须在适配层统一 |
| W-3 | **KNN 查询必须带 `LIMIT`** | 不带 LIMIT 报 `A LIMIT or 'k = ?' constraint is required on vec0 knn queries.`（errcode 1） | 所有 KNN 查询强制带 `limit`/`k=?` |
| W-4 | **样板测试依赖 `.gitattributes`** | 缺失则测试数会漂（v1.0 在 Windows 记 `365`→`364`；WSL 实测样板当前为 **348** 总用例，**行尾契约仍应固化**） | 阶段 0 抄样板时**一并抄 `.gitattributes`**，否则得到一个形似 bug 的假红。⚠ Mana 仓现用 `* -text`（禁自动改写），与样板策略不同，须显式决策见 §A.6 |

---

## 3. 分期总览

### 3.1 双工期口径

**人类等价工期保留方案 §17 原值**；**agent 口径用「批次」计数，不估时**（无实测依据）。

| 方案阶段 | 人类等价（方案 §17） | agent 批次 | 关键路径 |
|---|---|---|---|
| 阶段 0 契约与骨架 | 1–2 周 | B0.1 / B0.2 / B0.3（**3**） | ✅ |
| 阶段 1 核心闭环 MVP | 3–4 周 | B1.0 / B1.1 / B1.2 / B2.1 / B2.2（**5**） | ✅ |
| 阶段 2 长时记忆 + ACT-R | 4–6 周 | B3.1 / B3.2（**2**） | ✅ |
| 阶段 3 巩固/遗忘/Chunking | 4–6 周 | B4.1 / B4.2（**2**） | ✅ |
| 阶段 4 末那识核心特性 | 4–6 周 | B5.1 / B5.2（**2**） | ❌ 可并行 |
| 阶段 5 UI 与集成 | 4–6 周 | B6.1 / B6.2（**2**） | ❌ 可并行 |
| 阶段 6 评估与优化 | 持续 | B7.1 / B7.2（**2**） | ✅ 收口 |
| **合计** | **20–30 周**（非方案含糊的「34」） | **18 批次** | 见下「两种口径」 |

> ⚠ **工期实算口径**：下限 `1+3+4+4+4+4 = 20`，上限 `2+4+6+6+6+6 = 30`。方案全文**无「34 周」的来源**，请勿据此排缓冲 —— 那会凭空多出 4 周并掩盖真实关键路径。
> ⚠ **批次数说明**：R1 姊妹稿表头曾写「17 批次」，但同表阶段 1 列了 5 项而标注「4」，属**计数笔误**。本册逐行重数为 **18**（`3+5+2+2+2+2+2`）。

#### 3.1.1 「关键路径」的两种口径（**不写单一数字**）

⚠ **修订说明**：本册早前写「关键路径 11」，该数**不成立** —— 它来源于 `3+4+2+2`，其中那个 `4` 正是上条已订正的**笔误值**。经复核，「关键路径」在本册依赖图下有**两种互不相同的语义**，排期需要的是**两个信息**，故**分列**：

| 口径 | 含义（答什么问题） | 值 | 算法（可复算） |
|---|---|---|---|
| **A · 最长依赖链** | 「最短工期由哪条链决定」 | **8 个批次** | 沿硬依赖走最长链：`B0.1 → B0.2 → B1.1 → B2.1 → B3.1 → B3.2 → B7.1 → B7.2`（8 节点） |
| **B · 不可并行批次数** | 「哪些批次不能换手/必须串行等」 | **10 个批次** | `18 总批次 − 8 可并行`；可并行者 = `B0.3 / B1.0 / B1.2 / B2.2 / B5.1 / B5.2 / B6.1 / B6.2` |

> **两值的差异来源已显式列出**：口径 A 数的是「链上节点」，口径 B 数的是「必须串行的批次」。**两者不矛盾，是不同问题**。
> ⚠ 另有复核意见给出 `9`（最长链）与 `14`（不可并行）两个值，与本表不一致 —— 差异源于**依赖图边集的读法**（是否把 `B1.0` 计入链、`B4.x` 是否算主线）。**本表以 §3.2 已画出的图为唯一依据**；若实施中发现图与表不符，**以图为准并同步修订本表**，不得各留一个数。

### 3.2 硬依赖与并行扇出

```
B0.1 ─→ B0.2 ─┬─→ B0.3 ─────────────────────────────┐
              ├─→ B1.0 ─→ B1.1 ─┐                    │
              ├─→ B1.2 ─────────┼─→ B2.1 ─→ B3.1 ─┬─→ B3.2
              ├─→ B2.2          │                  ├─→ B4.1
              ├─→ B5.1 ─→ B5.2  │                  └─→ B4.2
              └─→ B6.1 ─→ B6.2  │                        │
                                └────────────────────────┴─→ B7.1 ─→ B7.2
```

- **硬依赖链**：`B0.1 → B0.2 → {B0.3, B1.0, B1.1, B1.2, B2.2, B5.1, B6.1}`；`B1.1 + B1.2 → B2.1 → B3.1 → {B3.2, B4.1, B4.2} → B7.*`
- **真串行的只有**：`attention`（依赖 jev）→ `long-term`（依赖 jev + vector）→ `consolidation` / `forgetting`（依赖 long-term）
- **最大并行扇出点：B0.2 之后同时可动 7 个批次** —— 这是 agent 口径相对方案 §10.2「三步走」的**全部收益**，也是唯一的总工期压缩杠杆
- ⚠ 方案 §10.2 把契约当「一次性全冻」是**伪瓶颈**：§10.4 行774「services 之间通过事件通信、不直接 import 实现」恰是灰度冻结可行的依据（事件声明合并，新增事件不破坏既有订阅者）

### 3.3 里程碑（每个都是可机检的门）

| 里程碑 | 内容 | 机检方式 |
|---|---|---|
| **M0** | 契约 v0.1 哈希 + 6 骨架「注入 → 卸载 → 计数归位」通路实证 | 装配计数 `N→0` + 卸载后无新产物行（G11/G10 在此被正面排除） |
| **M1** | 向量与 JEV 各自独立可验；降级三级可复现 | `journal_mode=wal` + `vec_version()` 探针（若启用）+ 三种失败态各造一次 |
| **M2** | 单条输入端到端贯通 | `mana_trace` 的 `seq` **无空洞** + 五类 event_type 各 ≥1 |
| **M3** | 长时记忆召回率**有数**（非「性能良好」类表述） | 命中率与延迟首测基线落盘 |
| **M4** | 巩固 / 遗忘衰减曲线可复现 | 固定夹具下衰减序列绝对差 `≤ 1e-6` |
| **M5** | 末那识双插件达标 | 用户模型精度首测基线（方案 `>75%` 需首测后自设） |
| **M6** | UI 面板可见 | Client 产物存在 + **产物侧落点**（`mana_trace` 的 `ui/render` 行）随渲染增长；⚠ 不用「Slot 消失」——那是机制自证（见 R5） |
| **M7** | 评估闭环 | 6/6 消融组各有 output，且每组差异的**方向与其预注册假设一致**（方向写死在消融设计里，不靠事后判断） |

---

## 4. 各阶段详述

> **统一验收模板**：每阶段三条判据缺一不予通过 ——
> **① 装配判据**（机制自证，必给但**不足**）→ **② 行为判据**（产物侧字节/行数/审计记录）→ **③ 反证判据**（卸载后同一触发**不再产生新行**；仍产生即判不通过，这是「卸载即净」的机检）。
> **命令口径**：所有命令可直接粘贴 **bash（WSL2 / Ubuntu）**。退出码变量为 **`$?`**（Windows 的 `$LASTEXITCODE` 已全部替换；`Test-Path` → `test -e`；`Measure-Object -Line` → `wc -l`）。⚠ 平台细节与复验命令见 **§A**。
> **阈值分档**：A 档（确定性值）可进阈值列；B 档（浮动量）不进。见 §6.0。

---

### 阶段 0 · 契约与骨架

**目标**：把契约 v0.1 冻死、把 P0 六个骨架立起来、把 CI 与「未运行可查」立起来、**并把 G1–G15 十五条先决阻断项全部化作阶段 0 的产物**（2026-09-24 拍板）。

> ✅ **拍板记录（2026-09-24，用户确认「按推荐就行」）**：**G1–G15 全数纳入阶段 0 硬门槛**（选项 A，非 B「只做 G3/G4/G5」、非 C「边做边补」）。
> 理由：**G3**（补 `session_id`/`turn_id` 列）、**G4**（开库 `{allowExtension:true}`）、**G5**（FTS5 分词口径）属「阶段 0 不定死就要**删库重建**」类；**G2/G9/G10/G11** 的检测落点依赖**阶段 0 冻结的表结构与契约**，推到后面改表会动已上线数据面。
> ⇒ **本阶段完成的定义 = G1–G15 每条都有对应产物或显式挂账**，见 §0.2 的 A0-13（G 清单归属判据）。

#### 0.1 实施方案

| 批次 | 交付物 | 步骤要点 | 硬依赖 | 可并行 |
|---|---|---|---|---|
| **B0.1** | 工作区根（npm workspaces）+ 钉 Node 版本 + `tsconfig.base` | ① `npm init -w` 建 workspace 根；② `engines.node = ^22.22.0`（**不可写精确 `22.22.0`**：本机 `node -v` = `v22.22.1`，实测 `engine-strict=true` 下报 `EBADENGINE ... Actual: v22.22.1` ⇒ 精确值必然假红，见 §A.2）；③ 抄样板 `tsconfig` 基线；④ **一并抄 `.gitattributes`**（否则测试数漂移，见 §2.2 W-4）；⑤ `pnpm` 本机**存在**，但全项目统一 **npm**（见 §8 C1 修正） | 无 | — |
| **B0.2** | `dsh-mana-core` v0.1：S1 五类事件 + 领域模型 + `mana_trace` schema | ① 只冻 **S1 五类事件**（observation / attention / decision / recall / injection），不做一次性全冻；② **core 独占 `Events` 接口与领域模型**，其余插件**禁止**自建 `event-types.ts`（删方案 §9.2:619 该行，见 §8 C11）；③ 出「包 id ↔ name ↔ 服务名」映射表；④ 关联键统一为 `requestId`；⑤ **新建 `inject_log` 注入审计表**（最小列集见阶段 1 验收节开头的「表落点声明」）——本表是 I1/I2 与降级判据的唯一落点，**方案 §11.2 未含此表**；⑥ 建表须**补全** `session_id` / `turn_id` 列（G3）、`fts5` 虚表与 WAL 语句（方案 DDL 内 `VIRTUAL TABLE`/`fts5`/`journal_mode`/`PRAGMA` **全为 0 命中**） | B0.1 | ∥ B0.3 |
| **B0.3** | P0 六个骨架（`core`/`jev`/`vector`/`perception`/`attention`/`working-memory`），`name` + `inject` + `apply` 空实现 | ① **只建 P0 六个**（P1/P2 按阶段分批建，见 §8 C12）；② 骨架的 `apply` 必须**注册一条 waterfall 监听器并调 `next()`**（把 G9 钉成结构约束）；③ 建库一律 `new DatabaseSync(p,{allowExtension:true})`（G4）；④ 目录一律 `owner-only` 权限风格 | B0.2 | ∥ B0.2 |

**关键技术约束（阶段 0 一次定死，后补代价高）**
- **开库即定扩展窗口**：`new DatabaseSync(p, { allowExtension: true })` —— 事后 `enableLoadExtension(true)` 报 `Cannot enable extension loading because it was disabled at database creation`，**不可后补**（G4）。
- **`PRAGMA busy_timeout` 必须显式设置**（默认 `{"timeout":0}` ⇒ 并发写立即失败）；**手写 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`**，因为 `db.transaction` 与 `db.pragma` 皆 `undefined`（G7）。
- **FTS5 建表显式 `tokenize='trigram'`** + 查询最小长度约束（<3 字符显式拒绝），否则中文恒 0 命中且与「库空」同形（G5）。
- **方案 §14 检测方式落点入契约**：十条故障模式每条必须给出表/字段名，给不出即标「不可观测」并入 §7 缺口清单（G2，见 §8 C9）。
- **独立心跳**：由 **Mana 之外**的启动脚本每 5 分钟写 `$DSH_HOME/memory/mana.heartbeat`（一行 JSON：时间戳 + core 是否在 ctx 中）。**必须外部写**，否则会在最需要它的时候一起死（理由：若挂掉的是 P0 的 `dsh-mana-core`，13 个插件全进 waiting，**写入 `mana_trace` 的代码本身没在跑** ⇒ Mana 所有自证通道同时失声，数据面全空与「还没被用过」在报表上同形）。判据见 **A0-11**。
  ⚠ **A0-11 的判定口径修正**：心跳文件本身**不记写入者** ⇒ 「写入方必须是 Mana 之外的东西」**无法从文件判定**。改为可判定的形态：**把全部 Mana 插件卸载后，该文件仍须继续更新**（仍更新 = 写入方确实独立于插件；停止更新 = 写入方仍是插件自身，判红）。
- **存储目录自建**：`~/.dsh/memory` 不存在（`test -e` = false），DSH 无 `memory` 约定目录（G15）。
- **撤销方案的两条**：`pnpm`（本机不存在）→ npm；`vitest`（本机不存在）→ `node:test`（见 §8 C1/C3）。

#### 0.2 验收方案

**自动判据**

| ID | 判据 | 检查方式（可粘贴） | 阈值 | 退回动作 |
|---|---|---|---|---|
| A0-1 | **环境钉点一致** | `node -v` + `node -e "const s=require('node:sqlite');console.log(Object.keys(s).join(','))"` + `npm ls -g @deepseek-ai/dsh --depth=0` + `node -p "require('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/package.json').version"` | ① 输出 **`v22.22.1`**（⚠ **不是 `v22.22.0`** —— v1.0 的「逐字相等」判据会**假红**，见 §A.2）与 `DatabaseSync,StatementSync,constants,backup` **逐字相等**；② DSH 版本与 cordis 版本必须记录在案（实测 `0.1.7-rc.1` / `4.0.4`，见 §2.1 版本纪律） | 停止阶段 0，先报环境变更 |
| A0-2 | **扩展加载窗口未走错**（负向判据） | 建库时**故意**用默认 ctor，断言 `enableLoadExtension(true)` **必须抛错**；再用 `{allowExtension:true}` 断言成功 | 前者报错、后者成功，二者**都要真** | 修开库点；不得后补 |
| A0-3 | **中文分词口径**（负向判据） | `trigram` 下 4 字查询 `MATCH` 命中 ≥1；默认分词器断言 **0 命中**（用英文 `MATCH test` → 1 证明非库空） | 4 字命中 ≥1 且默认分词器 0 命中 | 契约冻结前改 tokenizer + 最小长度 |
| A0-4 | **typecheck 真接了宿主类型**（负向判据） | 故意引用不存在的宿主成员（如 `ctx.subagents`），跑 `npm run typecheck` | **必须报错**；不报错即判「类型检查未接上宿主类型」 | 修 tsconfig/依赖；否则后续所有 typecheck 判据不可信 |
| A0-5 | 插件形状静态可证 | `node -e "const m=require('<pkg>/lib/index.js');…"` 断言 `name`/`inject`/`Config`/`apply` 齐 + `cordis.patch.yml` 存在 | 4 项齐全 | 回骨架步骤 |
| A0-6 | **CI 绿（新仓自测）** | `npm run typecheck; echo "exit=$?"` 与 `npm test` | typecheck **= 0** 且 test 全绿。⚠ **不得拿样板当绿基线**（其 **9p 副本** typecheck 实测 exit 2 / 24 error；**ext4 副本** exit 0 ⇒ 差异来自平台包版本与文件系统，见 §A.4） | 先修 A0-4 类宿主 API 错误（样板自身 error 即此类）再进阶段 1 |
| A0-7 | **测试命令写法正确**（负向判据） | `node --test "tests/*.test.mjs"` 与 `node --test tests/` **都跑一次** | 前者 `exit 0`；后者**必须失败**（实测报 `Cannot find module ...\tests` 并打印 `# tests 1 / # fail 1`，形似测试失败实为命令写错） | 改 CI 脚本写法 |
| A0-8 | **`session_id`/`turn_id` 列已补 + `<inject_log>` 表已建** | `PRAGMA table_info(mana_trace)`、各表 `table_info`，**并单独 `PRAGMA table_info(inject_log)`** | ① `mana_trace` 等表目标列存在；② **`inject_log` 表本身存在且列齐**（`session_id`/`turn_id`/`memory_id`/`block_id`/`injected_at`/`gate`/`degraded`/`local_score`/`jev_prob`/`reset`）；③ **`gate` 列须能落 5 类枚举值**（见阶段 1 表落点声明）且**非空**。⚠ 只验「已存在表的列」**不够** —— `inject_log` 是**新建表**，漏验则 A1-2/A1-3/A1-11/A1-13/A1-14 到阶段 1 仍无表可查 | 未补前 **I1/I2 判据（A1-2/A1-3）不得放行** |
| A0-9 | 方案 §14 落点齐备 | 逐条核 方案 §14 十条是否各有表/字段名 | 每条有落点或显式标「不可观测」 | 标「不可观测」者入 §7 缺口清单 |
| A0-10 | **不碰既有件** | `cd /home/lk/dsh-src/dsh-plugin-roundtable && git status --porcelain \| wc -l`，并 `git rev-parse --short HEAD` | ⚠ **判据形态 = 与「本批开工前实测值」相等**，**不是与某个固定数字相等**（该行数随插件自身开发漂移：v1.0 在 Windows 记 **15 行**、复核 **18 行**；**WSL 实测 19 行**）。开工前先记录 `(行数, HEAD)` 二元组作为本批基线，收工时比对**二者都要相等** | 任何漂移 → 先查是否本轮造成（比对文件 mtime 与本批时间窗）；确属本轮 → 回滚并写报告 |
| A0-11 | **独立心跳存在且新鲜**（交付物补判据） | 读 `$DSH_HOME/memory/mana.heartbeat`（一行 JSON：时间戳 + core 是否在 ctx 中） | ① 文件存在且**新鲜度 ≤ 10 分钟**；② **可判定的独立性检验**：**卸载全部 Mana 插件后该文件仍继续更新**（文件本身不记写入者，故不能靠读文件判「谁写的」；停止更新即判红 —— 说明写入方仍是插件自身） | 回阶段 0 心跳步骤 |
| A0-12 | **契约快照哈希已存**（交付物补判据） | 对 `dsh-mana-core` v0.1 的 `Events` 接口与领域模型取 `sha256` 存盘 | 哈希文件存在；后续每次契约变更须与上一版比对并留痕（防 G10 的契约漂移不可见） | 回 B0.2 |
| A0-13 | **G1–G15 全数归属**（2026-09-24 拍板项的落点） | 逐条核 §2 的 G1–G15：每条**要么有阶段 0 的对应产物**（列出文件名/表名/判据 ID），**要么显式标「挂账」并写明挂到哪个阶段** | **15/15 有归宿**；出现「既无产物又无挂账」即判红 | 回 §2 补归属；**不得以「已在正文提过」代替归属** |

**反证判据（阶段 0 专属）**
- **R0**：6 个骨架**逐个**注入 → 记为 `N`；再**逐个**卸载 → 断言装配计数归零，且 `mana_trace` **无新增行**。仍产生新行即判不通过（G11/G10）。
  ⚠ 本条须由具备 `dsh-super-injector` 工具链的执行席运行（作者席工具集内无 `dev_*`）。

**G1–G15 归属表**（A0-13 的比对基准；✅ = 阶段 0 有对应产物，⏳ = 显式挂账到后续阶段）

| G | 一句话 | 阶段 0 归宿 |
|---|---|---|
| G1 | 性能数字跨采样浮动，绝对毫秒不可作阈值 | ✅ §6.0 三档分档规则（写进契约文档） |
| G2 | 方案 §14 检测方式 0 真信号 | ✅ A0-9（逐条落点）+ 表结构预留字段 |
| G3 | I1/I2 无可数之处 | ✅ A0-8（补列 + 建 `inject_log`） |
| G4 | 扩展加载窗口不可后补 | ✅ 架 B0.3 约束 + A0-2（负向判据） |
| G5 | 中文 FTS5 静默归零 | ✅ A0-3（负向判据）+ 建表语句 |
| G6 | `emit` 分发 waterfall 契约 | ✅ B0.3 骨架约束（注册 waterfall 并调 `next()`） |
| G7 | `busy_timeout` 默认 0 / 无事务封装 | ✅ 开库器封装（B1.0 前置，阶段 0 定接口） |
| G8 | 静默降级已有先例 | ✅ 契约写明「降级必须落显式字段」 |
| G9 | 与 shoucang 争 `agent/pre-step` | ✅ B0.3 骨架约束 + 契约写明 `next()` 义务 |
| G10 | 卸载 ≠ 数据回滚 / 回放复活 | ✅ A0-12 契约快照哈希 + 每阶段双层回滚约定 |
| G11 | 装配清单 ≠ 生效 | ✅ R0（反证判据）+ A0-5 |
| G12 | 复用承诺不实 + 分三档 | ✅ §1.1 三分法表（阶段 0 出「能力—既有件」对照表） |
| G13 | JEV 承载方式 | ✅ **已拍板**（本机 Ollama logprob，见 §8 C8） |
| G14 | §6.4 Top-50 fan-out 不可达 | ⏳ 挂账到**阶段 1**（B1.2 并发策略） |
| G15 | 存储目录与资源上限未定 | ✅ 阶段 0 建 `$DSH_HOME/memory` 目录（owner-only） |

#### 0.3 阻塞点与回滚

| 阻塞点 | 说明 | 回滚 |
|---|---|---|
| ~~`pnpm` 不在 PATH~~ **【前提已推翻】** | ⚠ WSL 实测 `pnpm -v` = **12.4.2 存在**、`dsh plugin --profile web list` **exit 0** ⇒ v1.0 所记 `'pnpm' is not recognized` **是 Windows 侧特征**，此处不再成立 | 无需回滚；改口径见 §8 C1 修正 |
| `--profile dev` 不存在 | **WSL 实测 profiles = `headless` / `system` / `web`**（**无 `desktop`**；v1.0 记的 `desktop` 是 Windows 侧）；§9.6 的 `dsh --profile dev --dump-config` 不能照抄 | 改用 `--profile web` |
| 样板 API 已过期 | 样板 7 条 type error 源于宿主 API 改名（`ctx.subagents`→`ctx.agents`）⇒ **只抄袭工程外形，不抄 API 用法** | 删除误抄的调用 |
| 契约漂移不可见 | 声明合并是开放的，`core` 加临时字段不走评审也看不出来 ⇒ 须契约快照哈希 | 哈希比对回退到上一版 |

---

### 阶段 1 · 核心闭环 MVP

**目标**：打通 `perception → attention → working-memory → scheduler → action` 的端到端事件流；JEV 与向量**并行**开发。

#### 1.1 实施方案

| 批次 | 交付物 | 步骤要点 | 硬依赖 | 可并行 |
|---|---|---|---|---|
| **B1.0** | 开库前置：`{allowExtension:true}` + WAL + busy_timeout + backup | 独立成批（因 G4 不可后补）：① 开库器封装；② `PRAGMA journal_mode=WAL`（**读回必须走 `prepare().get()`**，`exec` 返回 `undefined`）；③ `PRAGMA busy_timeout=5000`；④ 定期 `backup` | B0.2 | — |
| **B1.1** | 向量适配 | **走纯 JS 通道**：复用本机 shoucang `lib/vec.js` 的 `cosine`(93) / `embedMany`(246) / `recallRanked`(289)；RRF 自实现（约 30 行，k=60）；BLOB + **常驻 `Float32Array`**；sqlite-vec 作可选加速（见 §8 C4）。⚠ **若启用 vec0，必须同时承接 §2.2 的三条语义 W-1/W-2/W-3**（见下方约束） | B0.2 / B1.0 | **∥ B1.2** |
| **B1.2** | JEV 适配：缓存 TTL 300s / 熔断 5 次 / 冷却 60s / 三级降级 | **JEV = 本机 Ollama logprob 原语**：`POST /api/chat` + `think:false` + `logprobs:true` + `top_logprobs:5` + `num_predict:1` + `temperature:0`，从 **pos0** 取 yes/no 归一。⚠ **`think`/`logprobs`/`top_logprobs` 必须在顶层，放进 `options` 会被静默忽略**（实测：顶层 → `list`，options 内 → `NoneType`，不报错）。⚠ 概率口径按 §8 C8 更正为 **`yes=0.577 / no=0.423`**（`0.887/0.101` 复现不出，见 C8）。**判定策略 = 少往返**：多个判断**合并进一次请求**（实测 50 问单次 `1046–1228ms`，而 50 并发 = `7599ms`），配**分批 + 预算 + 全局并发上限**；⚠ 批量必须**逐问对位断言**（返回裸 `yes/no` 行不带编号，n=50 实测多答至 75 行 ⇒ 错位即张冠李戴且无报错，见「G14 复测更正」陷阱 3）。降级**必须落 `degraded:true` 显式标记，禁止 `catch{return null}`** | B0.2 | **∥ B1.1** |
| **B2.1** | 端到端事件流 | `perception → attention → working-memory → scheduler → action`；**`mana/jev/judge` 必须用 `ctx.waterfall(...)` 分发**（用 `emit` 会同步抛 `TypeError: next is not a function`）；`bail` 判据是 **非 `null`/`false`/`undefined`**（`0`/`''`/`[]` 也算 bail，方案 §9.3 行634 写的「非空」是错的） | B1.1 + B1.2 | perception/WM 可先动 |
| **B2.2** | `scheduler` 目标栈 + SOAR 三阶段；建 P1 四个骨架 | 只依赖 core | B0.2（**仅此**） | ∥ B2.1 |

**关键技术约束**
- **JEV 模型选型有硬约束**：必须选「yes/no 是首 token 偏好」的 instruct 模型，且**必须验一次 pos0 命中率** —— 实测 `qwen3:8b` → `"yes"=1.000`（饱和，无区分度，**不可用作概率**）；`qwen2.5:7b` → pos0 被 `" Ap"=0.337` 无关 token 抢位。
- **方案 §6.4 的 Top-50 fan-out 必须改写**：实测 50 并发单次 `5785ms`，超方案 §13.2 目标十倍以上（G14）⇒ 改**分批 + 早停 + 预算**。
- **嵌入服务现状**：`POST :11434/api/embed {model:"bge-m3"}` 返回 **2 条 × 1024 维**；`bge-m3:latest` 在库（`1,157,672,605 B`）。⚠ 另有意见称「宿主进程内 `fetch` 打 11434 不通」，实测**三条反证**（独立进程 fetch OK / shoucang 自身即用 `fetch` 且向量缓存在持续增长 / 宿主内端点返回 HTTP 200）⇒ **当前可直接用全局 fetch**，但**此结论仍属未验证**（无法注入运行中宿主进程，见 §7）。
- **vec0 三条语义的承接（W-1/W-2/W-3 的落点，2026-09-24 补）**：本册定「纯 JS 余弦为主、vec0 作规模化升级项」（§8 C4）。**一旦启用 vec0，以下三条必须同时落实**，否则不报错但语义偏离：
  - **W-1 度量显式指定**：建表必须写 `distance_metric=cosine`。不写则默认 **L2**（实测同一对向量：L2 `0.8944` vs 余弦 `0.4000`）⇒ **检索语义与方案 §7.1/§15.5 声称的「余弦」不符且静默**。
  - **W-2 `rowid` 必须 BigInt**：传 `1` 报 `Only integers are allows for primary key values`，传 `1n` 才通；普通表用 number 正常 ⇒ **同一进程两套 id 语义并存**，须在适配层统一（**作判据挂在 B1.1**）。
  - **W-3 KNN 必须带 `LIMIT`**：不带则报 `A LIMIT or 'k = ?' constraint is required on vec0 knn queries.`（errcode 1）⇒ 所有 KNN 查询强制带 `limit`/`k=?`。
  ⇒ **验收挂钩**：A1-11（向量路径真被走到）+ 启用 vec0 时须补一条「W-1/W-2/W-3 三条各造一次负例并断言报错或取值正确」的判据（由执行席在 B1.1 落）。

#### 1.2 验收方案

**自动判据**

> **表落点声明（阶段 0 契约必须建立，否则 A1-2/A1-3/A1-11/A1-13/A1-14 无表可查）**：本册引用的 `<inject_log>` 指**阶段 0 新建的注入审计表**，最小列集为
> `session_id` / `turn_id` / `memory_id` / `block_id` / `injected_at` / **`gate`** / `degraded` / `local_score` / `jev_prob` / `reset`(bool)。
> **`gate` 是枚举列，必须由生产侧（Injection Gate 插件）写死，取值限于 5 类**：
> `injected` / `skip_no_candidate` / `skip_below_threshold` / `degraded_unavailable` / `reset`。
> ⚠ **不得留空、不得用 `undefined` 表状态**（既有教训：undefined 会被事件信封/JSON 序列化**静默丢键** ⇒ 「判不了」与「判不准」不可分辨）。**消费侧不得反推 `gate`，只能读**。
> 方案 §11.2 的六张表**没有这张表**（也无 `session_id`/`turn_id` 列）⇒ 属阶段 0 必须补建的契约（对应 G3 与 §8 C6）。

| ID | 判据 | 检查方式 | 阈值 | 退回动作 |
|---|---|---|---|---|
| A1-1 | 端到端事件流可追 | `SELECT seq,event_type FROM mana_trace ORDER BY seq` | 五类 event_type **各 ≥1** 且 `seq` **连续无洞** | 回阶段 1 接线步骤 |
| A1-2 | **I1**：每 `(session,turn)` ≤1 注入块 | `SELECT session_id,turn_id,count(*) c FROM <inject_log> GROUP BY 1,2 HAVING c>1` | **0 行**。⚠ 前置 A0-8，未补列则**不可执行**，判「待定」 | 阶段 0 补列，未补前不得放行 |
| A1-3 | **I2**：每条记忆每 session 最多注入一次 | 同上，按 `memory_id` 分组 | **0 行**。同上前置 | 同上 |
| A1-4 | RRF 确定性 | 固定 rank 输入核分 | k=60 时 `[1,1]=0.032787`、`[1,50]=0.025484`、`[50,50]=0.018182`，绝对差 `≤ 1e-6` | 回向量融合步骤 |
| A1-5 | 时间衰减确定性 | 固定夹具 | h=14：`decay(0)=1.000000`、`decay(14)=0.500000`、`decay(90)=0.011609`，绝对差 `≤ 1e-6` | 回排序步骤 |
| A1-6 | 注入块转义 | 组块后统计内层 `<` 数 | **内层 `<` 计数 == 0**（整块仅 2 个 wrapper 标签） | 回 Injection Gate 组装步骤 |
| A1-7 | 前缀缓存友好 | 对「系统提示 + 历史」取 `sha256` 前后比对 | 注入前后该前缀哈希**逐字节相等** | 改写为尾部追加 |
| A1-8 | **门控失败可区分** | 三种失败各造一次并读 `jev_log` | Write → `gate in (unavailable,budget)` 且行仍写入；Recall → `degraded=1` 且返回有序 items；Injection → 注入块数 **== 0**。且 `jev_log.degraded` 与 `gate` **至少一个非空** | 回 JEV 适配层降级链 |
| A1-9 | 审计不泄内容 | 对已知记忆内容做 ≤32 字节 n-gram 子串匹配 | 命中 **0** 条内容片段（只应出现 id/哈希） | 回审计写入步骤 |
| A1-10 | **中文召回非静默归零**（负向判据） | 已知在库的中文串查询 | 命中 **≥1**；若为 0 且库非空即判红 | 回 FTS5 建表口径 |
| A1-11 | **向量路径真被走到**（负向判据） | 强制 `provider` 不可达一次，读回结果对象 | 判据为**可枚举的字段断言**：返回对象中 `degraded === true` 且 `gate` 字段**非空字符串**；同时断言此时 `items[]` 的排序依据字段为 `local_score`（而非 `jev_prob`）。**不接受「看着像降级了」这类判断** | 回向量适配层 |
| A1-12 | 嵌入维度与语义间距 | 同一文本两次 / 改写句 / 无关句 | 重复 `cos ≥ 0.999999`；`改写 − 无关 ≥ 0.2`（B 档，见 §6.0）。**dim 必须 == 1024**（A 档） | 回嵌入适配步骤 |

**人工判据**（不得进放行闸）
- H6：注入后模型**是否真的用上了**那条记忆 —— 须人读 transcript，不接受「注入了所以用了」。

**⚠ fail-closed 专用判据（新增，对应既有教训「先判 fail-closed 再查逻辑」）**

> **为什么单列**：Injection Gate 的失败策略是 **fail-closed（不注入、沉默优于噪音）**。既有教训原文：**「缺陷全 fail-closed（未判⇒计数不动、不换向）⇒ 不报警只静默」**。⇒ Mana 最关键的一道门控，其**正常态与故障态在表面上完全同形**（都是「没注入」）。这类缺陷**必须先被判据覆盖，否则永远查不出来**。

| ID | 判据 | 检查方式 | 阈值 | 退回动作 |
|---|---|---|---|---|
| A1-13 | **「没注入」必须可分辨是三种里的哪一种** | 每次 `agent/pre-step` 结束都往 `inject_log` 落一行，`gate` 字段取枚举值之一：`injected`（真注入了）/ `skip_no_candidate`（候选池空）/ `skip_below_threshold`（判了但未过阈）/ `degraded_unavailable`（JEV 不可用）/ `reset`（该块已离开上下文） | ① **枚举值必须落在上述 5 类内**（出现 `null`/空值即判红）；② 跑一轮含记忆命中的会话后，`gate='injected'` **至少出现 1 次**（若全程 0 次而库非空 ⇒ 判红，说明门控静默失效） | 回 Injection Gate 实现；**不得以「没注入是正常行为」放过** |
| A1-14 | **fail-closed 不得吞掉「未判」** | 造一次 JEV 不可用，然后**同时**断言：① 注入块数 == 0（fail-closed 生效）；② `inject_log` **仍新增了 `gate='degraded_unavailable'` 行** | 两条**都要真**。只满足①而 `inject_log` 无新增行 ⇒ 判红（**这是「静默」而非「fail-closed」**——正确行为是沉默地不注入，但**必须留痕**） | 补落点；参见 G8「降级必须落显式字段」 |

**反证判据**
- **R1**：卸 `attention` 单包 → `mana_trace` **不再新增** `observation` 行；仍新增即判不通过。
- **R1-b（跨插件回归，对应 G9 · 必须分链取证）**：Mana 注入插件**启用前 / 启用后**两次取证，**两条链各自独立断言**（⚠ 只盯一条会假绿 —— 两个注册点互相独立，漏调 `next()` 时可能一条仍绿而另一条已被掐死）：
  - **链 1（`panel-inject.js:773` 热记忆注入）**：shoucang 的注入块**仍照常出现**；
  - **链 2（`mcl.js:372` → `handlePreStep` MCL 慢通道）**：MCL 的装配/产出**仍照常**（可读其日志 `[shoucang] MCL 认知环已装配…` 与 `maxNudges`/`budgetChars` 运行时读数）；
  - **活体读数（辅助）**：宿主端点 `/api/shoucang-panel/vector/status2` 的 `stats.queries` **仍在增长**（⚠ 该计数器只由真实检索自增、**不随面板轮询增长**；且**不存在的端点返回 401 而非 404** ⇒ 取证须比对**具体计数字段**，不能只看状态码）。
  **任一链不成立即判 Mana 掐死了既有件。**

#### 1.3 阻塞点与回滚

| 阻塞点 | 说明 | 回滚 / 确认 |
|---|---|---|
| JEV 承载（G13） | ✅ **已拍板**：走本机 Ollama logprob（不用 OpenRouter 云通道） | 卸 `jev` 包；确认 = 第 6 次失败不再发起请求（请求计数）+ 熔断计数停止增长 |
| 取件通道受限（G12） | `git clone` 443 不通、API 通 ⇒ 须改 API 逐文件取 | 卸 `vector` 包；确认 = 同查询两次 rank 序列一致（RRF 确定性） |
| 50 并发不可达（G14） | 实测 5785ms vs 目标 500ms | 改分批 + 早停 |
| shoucang 静默降级先例（G8） | `vec.js:254` 的 `catch { return null }` 不得照抄 | 降级必须落显式字段 |

---

### 阶段 2 · 长时记忆与 ACT-R 激活

**目标**：`long-term` 落地 —— ACT-R 激活方程 + 三路混合检索 + 三道门控。

#### 2.1 实施方案

| 批次 | 交付物 | 步骤要点 | 硬依赖 |
|---|---|---|---|
| **B3.1** | `long-term` 编码 + ACT-R 激活方程（`d=0.5`、`τ=-2.0`、`σ=0.3`、`F=0.35s`、`f=0.8`） | ① 参考 pyactup **算法**、TypeScript 自研（方案 §3.2 已定）；② **派生量唯一写者**：激活值 `A` 只在 `long-term` 计算并落库，其余只读（修方案 §5.1/§11.2 的写者未指定）；③ 时间衰减三套公式（`d=0.5` / `h=14天` / `S`+Pavlik–Anderson）**收敛为一套**，否则同一条记忆被两家乘过（arch 席成因 C） | B1.1 + B1.2 |
| **B3.2** | Write / Recall / Injection 三门 + 命中率与遗忘曲线首测 | ① **三道门控可直接移植 `dsh-memory-jev` v0.4.1**（MIT，与方案 §6 逐条同构，见 §1.2），取件走 clone；② **JEV 承载已拍板 = 本机 Ollama logprob**（见 §8 C8，2026-09-24）；③ 注入不变式 I1/I2 依 A1-2/A1-3 机检 | B3.1 |

**关键技术约束**
- **向量权威唯一**：方案 §11.2 行809 `memory_items.vector BLOB` 与 §7 的 sqlite-vec 是**两套存法** ⇒ 定其一为权威（本册走 BLOB + 常驻内存，见 §8 C4），另一处不存。
- **`dim` 入判据**：`model_id` + `dim` 落一条配置，`dim ≠ 1024` 即判失败。
- **遗忘/巩固的依赖方向要正**：方案把 `forgetting`/`consolidation` 挂在 `long-term` 之下，**它们是 long-term 的维护者却成了依赖者** ⇒ `forgetting` 的 `inject` 收敛为 `['mana-core']`，`consolidation` 对 long-term 改 `ctx.get` 可选依赖（arch 席成因 A）。
- **未运行必须可查**：任一插件因依赖缺失未运行时，必须写一条 `mana_trace` `{event_type:'mana/plugin/inactive', payload:{id,missing,at}}`；验收从「插件在跑」改为「最近 N 分钟内无 inactive 记录」。

#### 2.2 验收方案

| ID | 判据 | 检查方式 | 阈值 | 退回动作 |
|---|---|---|---|---|
| A2-1 | ACT-R 公式与闭式锚点一致 | 固定夹具 | `B{[1]}=0.000000`、`B{[1,2]}=0.534800`、`B{[1,2,4,8]}=0.940265`、`B{[1,1]}=0.693147`，≥3 组，绝对差 `≤ 1e-6` | 回激活方程步骤 |
| A2-2 | 检索概率 / 延迟边界 | 固定夹具 | `s(σ=0.3)=0.165399`；`P(A=τ)=0.500000`、`P(A=τ+1)=0.997638`、`P(A=τ−1)=0.002362`；`lat(A=0,τ=−2)=350.000000 ms`、`lat(A=−2,τ=−2)=1733.561349 ms`，绝对差 `≤ 1e-6` + 单调性。⚠ **夹具语义须写明**：`A<τ` 时按公式钳到 τ ⇒ **`A=−3` 与 `A=−2` 同值**（主持人复算：`0.35 × e^1.6 × 1000 = 1733.5613485`，册中值可复现）。曾有复核意见判该值「不可复现」——**以实跑为准，判该意见不成立**；但夹具标签必须写明钳位语义，否则读者会误以为 −3 与 −2 应得两个不同的数 | 回检索步骤 |
| A2-3 | 嵌入确定性与语义间距 | 同 A1-12 | 重复 `cos ≥ 0.999999`；`dim == 1024` | 回嵌入适配 |
| A2-4 | 检索延迟 | 组成为：单条热 p50/p95 + KNN + FTS5 | ⚠ **B 档，端到端未做** ⇒ **放行线不采用方案固定 500ms，也不采用「p95 × 1.2」**（裕度小于实测浮动下限 **2.5×**，该闸会被当噪声忽略）。改为：**同一进程内 A/B 对照的比值**，且绝对值仅作测量条件说明（注明采样时刻/负载/样本数） | 回检索流水线 |
| A2-5 | 容量与增长 | 落盘字节 | **待定，需首测后自设**（方案未给容量上限） | **随阈值一并定** —— 阈值未定前本判据**不生效**，且**不得以「未超标」放过** |
| A2-6 | **软删除可逆（字节级）** | `mem_forget` 后查 `retired`；`mem_restore` 后对 `content` 取 `sha256` | 行数不变且 `retired=1`；恢复后哈希与删前**相等** | 回存储层步骤 |
| A2-7 | **退休行不泄漏进检索** | 检索 SQL 须 `AND retired=0` | 结果中 `retired=1` 的 id 计数 **== 0**（实测 FTS 索引**不会**因 retired 自动剔除） | 回检索 SQL |
| A2-8 | **门控三道各自按预期失败** | 同 A1-8 | 三条全真 | 回 JEV 适配 |

**反证判据**
- **R2**：卸 `long-term` → 无新 `memory/encoded` 行。
- **R2-b（防回放复活）**：卸载后**加关账标记** → 重注入后断言 `mana_trace` **不出现已关账 seq**（对应 G10：方案 §12.3 的回放会复活旧状态）。

#### 2.3 阻塞点与回滚

| 阻塞点 | 回滚 / 确认 |
|---|---|
| ACT-R 参数是否站得住（τ/σ/阈值） | 本册只保证**公式可复现**，不评价数值品味；方案 §5.1/§6.2 的阈值（0.7/0.6/0.5/0.3/0.8）**无本机实测支撑**，须首测后校准 |
| 回放复活 | 卸载 + **关账标记**（只做插件层回滚会因方案 §12.3 回放复活旧状态）；确认 = 重注入后无已关账 seq |

---

### 阶段 3 · 巩固、遗忘与 Chunking

**目标**：`consolidation`（合并 / chunking）+ `forgetting`（艾宾浩斯衰减 + 间隔重复 + 归档留存上限）。

#### 3.1 实施方案

| 批次 | 交付物 | 步骤要点 | 硬依赖 |
|---|---|---|---|
| **B4.1** | `consolidation`（相似度 ≥0.7 合并 + chunking 重复 ≥2） | 触发条件按方案 §5.2：子目标 `active→done`、算子序列 ≤7、模式重复 ≥2 | B3.1 |
| **B4.2** | `forgetting`（半衰期 14 天 + 间隔重复） | ① `S` 更新按 Pavlik & Anderson：`ΔS = a·(S_max − S)^b`；② **激活值四区间归档**（`A>τ+1.0` / `τ<A≤τ+1.0` / `τ-0.5<A≤τ` / `A≤τ-0.5`）；③ **必须同时给归档留存上限** —— §8.3 行578「物理删除永不发生」与无限归档**直接冲突**，只监控不设上限 ⇒ 监控只会告诉你它在爆 | B3.1 |

**「记忆爆炸」的最小可观测探针（G2 落点）**
每日巩固时落一行 `mana_trace` `store/snapshot`：`memory_items` 行数 / 已退休行数 / 活跃 BLOB 字节 / `mana.db` 文件字节 / WAL 字节。
**判据用增速不用绝对值**：`本周增量 / 上周增量` **> 3 且绝对增量 > 1000 条** 即红 —— 从 0 涨到 1000 是正常的，从 5 万涨到 15 万才是爆炸，**只有增速能区分**。

#### 3.2 验收方案

| ID | 判据 | 检查方式 | 阈值 | 退回动作 |
|---|---|---|---|---|
| A3-1 | 软删除可逆 | 同 A2-6 | 行集合同 + 哈希相等 | 回存储层 |
| A3-2 | **「真归档」≠「打个标记」** | 三条同时断言：① `SELECT count(*) … WHERE A<=τ-0.5 AND retired=0`；② 90 天压缩前后 `sum(length(content))`；③ 归档行不出现在检索结果 | ①**== 0**；②体积**下降**（仅置位不降不算压缩）；③**== 0**。三条全真，**只满足①只算标记** | 回遗忘插件归档步骤 |
| A3-3 | Chunking 加速 | 同一重复任务改造前后各 N 次取中位 | **待定，需首测后自设**（方案 `>30%` 无本机基线） | 回 chunking 步骤 |
| A3-4 | 衰减参数自洽 | 固定夹具（`a=0.5,b=0.3,Smax=30`，S 从 1 起 3 次重复） | 得 `5.059273`；`retention(S=7)` t=7d `0.367879`、t=14d `0.135335`，绝对差 `≤ 1e-6` | 回衰减步骤 |
| A3-5 | **存储增速非爆炸** | `store/snapshot` 滚动比 | `本周/上周 > 3 且绝对增量 > 1000` 即红 | 回归档留存上限设计 |

**反证判据**（统一形态：**卸载后同一触发不再产生新行**）
- **R3**：卸 `consolidation` → **不再产生新的合并记录行**；卸 `forgetting` → **不再产生新的归档/衰减记录行**。
  ⚠ 另有一条**正向**判据**不属于反证**、须单独看：`forgetting` 若因依赖缺失而未运行，必须留下 `mana/plugin/inactive` 记录（G2 的可观测性要求）。二者方向相反，**不得混写成一条**。

**反证判据（阶段 5 专属，见下）**

#### 3.3 阻塞点与回滚

- **归档与「永不物理删除」冲突**（§8.3）⇒ 阶段 3 必须同时给留存上限。
- 回滚：卸载 + `backup` 还原；确认 = 行数回到还原点（**单一 backup 位置须固定**，见 §8 C5）。

---

### 阶段 4 · 末那识核心特性

**目标**：`metacognition`（末那识·审：置信度、知识缺口）+ `user-model`（末那识·我执：偏好、习惯、项目）。

#### 4.1 实施方案

| 批次 | 交付物 | 步骤要点 | 硬依赖 | 可并行 |
|---|---|---|---|---|
| **B5.1** | `metacognition`（置信度 / 知识缺口）；建 P2 三个骨架 | 可移植 shoucang `lib/criteria.js` 的阈值层（但**须连生成器 `scripts/gen-criteria.mjs` 与注册表一起搬**，否则数值漂移不可追） | B0.2 | **∥ 整段可提到阶段 1 后** |
| **B5.2** | `user-model`（精度目标须首测后自设） | **`user_model_history` 追加表必须在阶段 0 预留** —— `user_model` 现在是 UPDATE 覆盖、**无历史行**，「漂移」在数据上不存在（见下） | B5.1 | — |

**「用户模型漂移」的最小可观测探针（G2 落点）**
- `user_model` 增追加表 `user_model_history(key, old_value, new_value, confidence, at, source_evidence_id)`。
- 判据：同一 `key` 在 **30 天内被改 ≥ 3 次** = 漂移候选（**不是错误**，是「这个偏好不稳定」），进复核队列。
- 另需**退场动作**：置信度跌破阈值时该偏好转为「不注入」，而不是继续生效。
- ⚠ `user_model_history` 属表结构 ⇒ **阶段 0 冻结表结构时必须预留**，否则阶段 4 要改契约。

#### 4.2 验收方案

| ID | 判据 | 检查方式 | 阈值 | 退回动作 |
|---|---|---|---|---|
| A4-1 | 置信度可校准 | 需带标签集，Brier / 可靠性曲线 | **待定，需拍板**（方案未给） | **随阈值一并定** —— 未定前本判据不生效，不得以「未超标」放过 |
| A4-2 | 用户模型精度 | 对人工标注集算命中率 | **待定，需首测后自设**（方案 `>75%` 无实测）。一旦开测，样本量 `n ≥ 289`（p=0.75, ±5pp, 95%） | **随阈值一并定** —— 未定前不判通过；开测后不足样本量即判「不可判定」而非「通过」 |
| A4-3 | **模型不生成记忆内容** | 断言 `metacognition` 只写 id/数值字段，不写 `memory_items.content` | 新增 `content` 行数 **== 0** | 回插件边界 |
| A4-4 | **`user_model_history` 表已存在且可回溯**（交付物补判据） | `PRAGMA table_info(user_model_history)` + 做一次偏好更新后查历史行 | 表存在且列齐（`key/old_value/new_value/confidence/at/source_evidence_id`）；更新后**新增一行**（证明漂移可回溯，而非 UPDATE 覆盖） | 回阶段 0 预留步骤 |

**人工判据**（不得进放行闸）
- H3：JEV `worth_keeping` 判断质量 —— 须人抽检被丢/被留样本，判定是否真错。
- H4：`metacognition`「知道自己不知道」—— 须人读具体会话片段，判是否为模板话术。

**反证判据**：**R4**：卸 `metacognition` → 无新审计行。

---

### 阶段 5 · UI 与集成

**目标**：`mana-ui` Client 半区（记忆可视化面板）+ 认知轨迹回放。**多设备同步已移出范围**（见 §8 C5）。

#### 5.1 实施方案

| 批次 | 交付物 | 步骤要点 | 硬依赖 | 可并行 |
|---|---|---|---|---|
| **B6.1** | Client 半区面板（激活值热力图 / 目标栈树 / 认知轨迹时间线） | 抄样板 `dsh-plugin-roundtable` 的 tsdown 双 entry；Client 与 Host 通信走 **Package-private JSON 方法**（`harness.handle` / `host.call`），**只有无损 JSON 可跨界** | B0.2 | ∥ 阶段 4 |
| **B6.2** | 认知轨迹回放 | 依 `mana_trace` 的 `seq` 回放；⚠ 回放语义与「回滚」冲突（见 G10） | B6.1 | — |

**约束**：Client 半区不得引入 Host 专有 API；`client.js` 单文件 83 万字节（shoucang）**无可拆分复用点**，照抄即引入整包 UI。

#### 5.2 验收方案

| ID | 判据 | 检查方式 | 阈值 | 退回动作 |
|---|---|---|---|---|
| A5-1 | Client 半区可渲染 | `npm run bundle:client` 产物存在 + 渲染测试 | `exit 0` 且产物字节数 `> 0` | 回 UI 接线步骤 |
| A5-2 | **Client 不含 Host 专有 API** | 对 client 产物 grep：`node:fs` / `node:sqlite` / `process.env` 三个模式 | 命中 **0** | 拆半区 |
| A5-3 | **认知轨迹回放可复现**（交付物补判据） | 取一段已知 `mana_trace` 片段回放，比对回放产出的状态序列与原始序列 | 状态序列**逐项相等**；且回放**不得写回** `memory_items`（只读回放） | 回回放步骤 |
| A5-4 | **Host 入口体积合规**（P-1 落点） | 比对 `mana-ui` 的 `lib/index.js` 与 `src/index.ts` 体积，并对标样板 `dsh-frozen-injection` 的 `src/index.ts` = **5,002 B** | 与样板**同量级**（个位数 KB）；超出**一个数量级**（≥50 KB）须在交付说明里写明理由，否则判红 | 把重逻辑移入 Client 半区 |
| A5-5 | **Client 产物唯一**（P-2 落点） | `npm run bundle:client` 后列产物目录 | **单一 client 产物**（非多入口）；多产物须写明理由 | 收敛 tsdown 入口 |

> **A5-3（多设备同步）不列为判据**：**未发现本机可用的同步通道与实测口径** ⇒ 该范围已移出（§8 C5），**占判据 ID 会给假覆盖感**，故仅在此处声明，不编 ID。

**反证判据（须自建落点，不自证）**
- **R5**：⚠ **不得照抄 R1-b 的端点** —— `/api/shoucang-panel/vector/status2` 是 **shoucang 的**端点，卸载 `mana-ui` 改不了它；且实测该计数器**不随面板轮询增长**（20 秒 delta = 0，只由 `vec.js:293` 的真实检索自增）⇒ 「读数随 UI 操作变化」这个基准行为**不成立**。
  **改法**：`mana-ui` 须**自建一个产物侧落点**（例：Client 半区每次渲染/轮询时向 Host 追加一条 `mana_trace` `ui/render` 行）。R5 判据 = 卸载 `mana-ui` 后该落点**不再产生新行**；仍产生即判不通过。
  ⚠ 另注：**不存在的端点返回 401 而非 404** ⇒ 「返回 200」**筛不出**端点存在性，取证须比对**具体计数字段**而非状态码。

**第三方插件合规基线（阶段 5 实施的硬约束，2026-09-24 补）**

> 来源：既有经验 `[tool] 第三方插件合规基线（dshmarket / 入口 4KB / 单 client 产物 / fetch 路由）`。Mana 是**第三方插件链**，须与 DSH 生态的既有合规基线对齐——本册先前只写了功能与验收，**漏了交付形态的合规面**。

| # | 基线 | Mana 的适用点 | 验收挂钩 |
|---|---|---|---|
| **P-1** | **Host 入口体积须小**（基线量级 **~4KB** 级；本项目样板 `dsh-frozen-injection` 单文件 `src/index.ts` = **5,002 B** 可作对标） | 阶段 5 的 `mana-ui` **Host 半区**不得把面板逻辑塞进入口；重逻辑放 Client 半区 | **A5-4**（已挂钩）
| **P-2** | **Client 单产物**（一个 bundle 产物，不拆多入口） | `mana-ui` 的 tsdown 配置须产出**单一 client 产物** | **A5-5**（已挂钩；A5-1 覆盖「产物存在」，A5-5 覆盖「产物唯一」） |
| **P-3** | **fetch 路由**——插件内网络请求须走宿主既有通道语义，不自建路由 | 阶段 1 的嵌入调用（Ollama :11434）与 JEV 调用**均属插件内出网**；须与宿主 fetch 语义一致（本册 §7 未验证项 1 已标该面） | 阶段 1 A1-11（降级可区分）已覆盖失败面；**出网通道口径**须在阶段 1 契约写明 |
| **P-4** | **`dsh.bundle` 声明 + `cordis.patch.yml`**（官方装配通道，勿手改 profile） | 阶段 0 的骨架交付形态；升级/装配按「官方通道 `dsh plugin add`」，**三处复账**（§2.1 纪律 3） | A0-5（插件形状）+ §2.1 纪律 3 |

> **本表的意义**：本册前 10 轮核查都在查「功能对不对、判据可不可判」，**这一栏查的是「交付形态合不合生态规矩」**——属覆盖度核查发现的第二类缺口（第一类是 方案 §18 风险映射）。

---

### 阶段 6 · 评估与优化

**目标**：L1–L4 评估 + 消融实验 + 性能与可靠性加固。

#### 6.1 实施方案

| 批次 | 交付物 | 步骤要点 | 硬依赖 |
|---|---|---|---|
| **B7.1** | L1–L4 评估 + 6 组消融 | ① 先跑**首测基线**（替代方案里 7 个无基线目标值）；② 消融按方案 §13.3 六组：去 JEV / 去 ACT-R 衰减 / 去工作记忆限制 / 去巩固 / 去元认知 / 去用户模型 | 全部 |
| **B7.2** | 性能与可靠性加固 | ① JEV 缓存命中率与并发策略；② 向量检索延迟；③ **按 G2 的 7 条「愿望」补探针** —— 阶段 6 的加固对象正是这些缺口 | B7.1 |

#### 6.2 验收方案

| ID | 判据 | 检查方式 | 阈值 | 退回动作 |
|---|---|---|---|---|
| A6-1 | **消融可自动跑** | 方案 §13.3 六组各产出 1 个指标差：同一固定输入集 → 逐组开关 → 输出 JSON | **6/6** 组都有 output 且差异方向与方案预期一致。**反对「无差异也算过」** | 回消融设计 |
| A6-2 | **输入量可见化**（N=0 显式记 0） | 断言每次评估输出含 `n` 字段 | 字段存在率 **100%**；`n=0` 时**显式落 0 而非缺字段** | 回评估脚本 |
| A6-3 | **全程无回归** | 阶段 0 与阶段 6 各取一次受保护仓 `git status --porcelain` 行数 + SHA | **相等**（与本批开工前记录的「行数+HEAD」二元组比对；⚠ 不与固定数字比 —— 该数会随插件自身开发漂移） | 停线排查 |
| A6-4 | **装配判据（补阶段 6 的第三条腿）** | 七阶段全部插件逐个注入 → 记装配计数 `N`；断言 `N` 与**各阶段「N.1 实施方案」表里的「交付物」列**逐项对应（⚠ 不是 §3.1 —— §3.1 是工期表，**无交付物列**） | 逐一对应；出现「交付物列有、实际无」的项即判红 | 回对应批次补交付物 |

**反证判据**
- **R6**：阶段 6 结束时，逐个卸载全部阶段插件 → 断言 ① 装配计数归零；② `mana_trace` **无新增行**；③ 受保护仓 `git status --porcelain` 与本批开工前的「行数+HEAD」二元组**仍相等**（全程无回归）。三条任一不成立即判不通过。

**人工判据**（不得进放行闸）
- H1：用户满意度 `>4/5`（方案 §13.2）—— 无自动口径，先由用户给评分卡再定，**待定**。
- H5：方案 §13.4 Newell Test 12 条 / CogArena L4 —— 本质是理论完备性判断，**不可自动化，不得写进阶段放行闸**。

---

## 5. 人工判据汇总（不可自动化，**不得写进放行闸**）

| ID | 判据 | 为什么不可自动化 | 落在哪 |
|---|---|---|---|
| H1 | 用户满意度 `>4/5`（方案 §13.2 行945） | 无自动口径，需先由用户给评分卡 | 阶段 4 起 |
| H2 | 「注入块离开上下文后 ID 重新可注入（`reset`）」 | 需人读日志确认语义**真发生**（而非计时器假象） | 阶段 2 |
| H3 | JEV `worth_keeping` 判断质量 | 需人抽检被丢/被判「值得留」的样本 | 阶段 2/4 |
| H4 | `metacognition`「知道自己不知道」 | 需人读会话片段判断是否为模板话术 | 阶段 4 |
| H5 | 方案 §13.4 Newell Test 12 条 / CogArena L4 | 理论完备性判断，本质不可自动化 | 阶段 6（**仅参考**） |
| H6 | 注入后模型**是否真的用上了**那条记忆 | 需人读 transcript；**不接受「注入了所以用了」** | 阶段 2 |

---

## 6. 阈值与数字纪律

### 6.0 三档分档规则（本册全书的数字纪律）

| 档 | 含义 | 能否进阈值列 | 例 |
|---|---|---|---|
| **A 档** | 确定性值，**跨运行可逐字复现** | ✅ **可以** | RRF `[1,1]=0.032787`；衰减 `decay(14)=0.500000`；ACT-R `B{[1,2]}=0.534800`；`vec_version()=v0.1.9`；`vec0` 扩展体积（**Linux `vec0.so` 159,816 B / Windows `vec0.dll` 289,280 B**）；测试总数（随仓漂移，须现场取）；`typecheck` exit code；HEAD 短哈希；样本量 `385/289/246/196/139`；各类 **exit code / 计数 / 版本号** |
| **B 档** | 浮动量，**同机跨采样差 1.2–13 倍** | ❌ **不可**；只进「测量条件说明」 | JS 余弦 10k `20.92` vs `8.40 ms`；vec0 KNN 10k `35.877` vs `11.17 ms`；bge-m3 冷启 `1037` vs `77.2 ms`；改写相似度 `0.784169` vs `0.979985`；无关相似度 `0.336102` vs `0.393894` |
| **未验证** | 明确标注，**不得升格** | ❌ | 见 §7 |

**B 档的正确写法（三选一）**
1. **比值上界**（推荐）：vec0 ÷ 暴力余弦 **≤ 2.0×** —— ⚠ 此处上界必须**真的覆盖两席采样值**：实测比值落在 **1.33–1.71**（主持人侧 1.715 亦属该区间上沿），故 **1.5× 会把自己的一侧判不合格**；取 **2.0×** 才成立。结论方向一致：**一万条规模下 vec0 无优势**。
2. 同一进程内 A/B 对照的**比值**，不写绝对毫秒。
3. 绝对毫秒只作**测量条件说明**（注明采样时刻/负载/样本数），**不进阈值列**。

> **为什么这条本身就是交付内容**：同一台机器两次独立采样，**性能量差 1.2–13 倍**（改写相似度 1.25×、无关句 1.17× 的最小值也在内；冷启最大 13×）⇒ **绝对毫秒跨负载不可判**。能进放行闸的只有比值上界、计数与 exit code。这是本册「禁止不可判定表述」的延伸。
> ⚠ **决策证据列同适用分档**：凡用 B 档数字支撑的决策（如 §8 C4、C1），其证据列也须按同规则标注，**不得只在下游分档而上游裸用**。

### 6.1 待定阈值清单（必须首测后自设）

| 阈值 | 方案原值（**不可直接采用**） | 首次实测落在 | 所需样本量 / 可判定写法 |
|---|---|---|---|
| 记忆命中率 | `>85%` | 阶段 1–2 | ⚠ **±5pp 只能「估准」不能「证成」**：区间 `[80%,90%]` 恰好覆盖 `85%` ⇒ 用 ±5pp 永远判不出是否 `>85%`。要**证成**该比例需 **n ≥ 545–1801**（取决于预期真实值）；若只需**估值**则 `n ≥ 196` |
| 遗忘曲线拟合度 R² | `>0.8` | 阶段 3（**需跨天数据**） | 点估计 `>0.8` 会给**假通过** ⇒ 判据须用 **置信区间下界 > 0.8**（经验上需观测值 ≥ `0.90` 且 `n ≥ 100`） |
| 检索延迟 | `<500ms` | 阶段 2 | **B 档** ⇒ 只写同进程 A/B **比值**，绝对值仅作测量条件说明（见 §6.0） |
| 任务完成率 | `>80%` | 阶段 4 起 | `n ≥ 246`（估值口径） |
| JEV 降级率 | `<5%` | 阶段 1–2 | 写成 **「连续 ≥ 60 次判定无降级 = 5.00% 上界」**（零事件上界口径），而非直接测比例 |
| 缓存命中率 | `>40%` | 阶段 1–2（**须写明是哪个缓存**，见下） | `n ≥ 369`（估值口径） |
| 用户模型精度 | `>75%` | 阶段 4 | `n ≥ 289`（估值口径） |
| 满意度 | `>4/5` | 阶段 4 起 | `n ≥ 385`（p=0.5 最保守） |
| Chunking 加速 | `>30%` | 阶段 3 | 同 A2-4：B 档，写比值不写绝对毫秒 |

**缓存命中率必须限定口径**：`jev_log.cached`（方案 §6.4 的 **JEV 判断缓存**，TTL 300s）与方案 §14 行980 讲的 **LLM 前缀缓存**是**两个不同的缓存共用一个词**。方案 §13.2 的 `>40%` **没有指明是哪一个**。
- 前者现在就能算：`cached=1 / 总数`（落点 `jev_log.cached`）。
- 后者**全文无落点** ⇒ 若 `ctx.llm` 回调取不到缓存命中信息，**如实标「不可观测」**，改用 JEV 缓存率并注明口径；**不得用代理量当判据**（本仓已有「代理指标非判据」的正式教训）。

---

## 7. 未验证项与已知缺口

> 纪律：下列项**继续保持「未验证」标注**，不得因写进本册而升格为已确认。

| # | 未验证项 | 为什么未验证 | 由谁可解 |
|---|---|---|---|
| 1 | **宿主进程内 `fetch` 打 11434** | 无法把代码注入运行中的宿主进程；只有三条**间接**实证（独立进程 fetch OK / shoucang 自身用 `fetch` 且向量缓存在增长 / 宿主内端点 HTTP 200） | 阶段 2 首个 Mana 插件里放一个探测工具 |
| 2 | **`dev_*` 注入/卸载可调用性** | 作者席工具集内无 `dev_*`（`dsh-super-injector` 的运行时工具） | 具备该工具链的工程执行席 |
| 3 | **§9.3 事件契约全文语义** | R1 时只读了行626–633，未逐条读全 | 契约席 |
| 4 | **方案 §13.1/§13.2 死阈值** | 除延迟有组成项实测外，7 个目标值全无实测 | 首测后（见本册 §6.1） |
| 5 | **方案 §17 各阶段时长的实测依据** | 不存在（人类等价工期是方案自述） | —（不可解，只能标注） |
| 6 | **多设备同步** | **方案 §17 行1140** 仅五个字、零设计 | 立项时再设计（见 §8 C5） |
| 7 | **§5.1/§5.3/§6.2/附录B 的认知参数数值**（τ=-2.0、σ=0.3、四大 JEV 阈值 0.7/0.5/0.3/0.8、4 组块、14 天半衰期）是否站得住 | 本册只保证**公式可复现**，不评价数值品味；另有实测概率窄带 `[0.266, 0.405]` 可作阈值讨论输入 | 判据/理论核查席 |
| 8 | **§10.4「services 不直接 import 实现」是否被违反** | 本机无这些插件源码，不可判定 | 有源码后 |
| 9 | **`dsh-memory` 的归属** | npm 上的 `dsh-memory@0.1.0`（maintainer `bbnopromo`）与 GitHub 上 3 个同名/近名高星仓库（`csyangwen/dsh-memory-evolve` 328★、`hr98w/dsh-memory` 26★、`QIANLING-0831/dsh-memory-plus` 9★）**不是同一个包**；方案未指明指哪个 | 用户澄清 |
| 10 | **独立心跳文件的写入方与权限面** | 心跳必须由 Mana 之外的东西写（否则在最需要它时一起死），但写入方（宿主脚本 vs 插件）与 Windows 权限面未定 | 运维/权限席 |

**已知缺口（因 G2 判定为「不可观测」而挂账）**
方案 §14 十条中判为「愿望」的 7 条（JEV 误判、SQLite 锁竞争、插件加载失败、记忆爆炸、前缀缓存失效、输入截断、用户模型漂移）—— 本册已在 §2/§3/§4 逐条给出最小探针与落点阶段；**未实现探针前，这 7 条故障模式均属「发生了也不知道」**。

---

## 8. 决策记录（本册的裁定口径）

| # | 决定 | 证据 | 备选 | 若改按什么改 |
|---|---|---|---|---|
| **C1** | 仓库 = **单仓库 + npm workspaces** | ⚠ **理由已按 WSL 修正**：`pnpm` **存在**（12.4.2）、`npm` = **11.19.1**（v1.0 记 10.9.4 系 Windows 侧）；改 npm 的**真实理由**是「对齐样板与 DSH profile 的 `pnpm-lock.yaml` 之外再引入一套 lock 会增加漂移面」而非「pnpm 不存在」。`core` 被 12 包共享；单插件 `node_modules` 实测 **69 MB**，13 份独立安装 ≈ 900 MB（**WSL `df`：根分区 950 GB 可用，磁盘压力远小于 v1.0 的 C 盘 32.3 GB** —— 但用户仍对磁盘占用敏感） | 13 独立仓库贴样板 | 零基础设施下共享 `core` 需 link/registry |
| **C2** | **13 个源码目录，装配单元收敛为 3 个 patch + 1 个 client** | 单个变更横跨 **5–6 包**（arch 席三条真实流：写 7 包 / 召回 5 包 / 巩固 4 包）；shoucang 实测用**一个包 + 两行 patch** 承载整条记忆链 | 13 bundle 各自独立安装 | 按变更面再拆 |
| **C3** | 测试/CI = **node:test** | ⚠ **理由已按 WSL 修正**：`vitest` 在本机**可装**（实测 `npm i -D vitest` → `5.0.1`），故「装不进」不成立；保留 `node:test` 的**真实理由**是「样板与 `dsh-memory-jev` 均为 node:test 系，且无需额外构建链」。样板 `test` 脚本 = `node --test "test/*.test.mjs"`（**WSL 实测 348 用例**，非 v1.0 的 365） | Vitest（方案 §16 已改） | 须先证明装得进且不碰受保护仓 |
| **C4** | 检索 = **物化 BLOB + 纯 JS 余弦**；vec0 列规模化升级项 | 暴力 JS 余弦 10k = `20.92 ms` / vec0 KNN 10k = `35.877 ms`（B 档，两席采样比值 `1.33–1.71`，**方向一致：一万条规模 vec0 无优势**）。sqlite-vec 真机**可用**（**WSL 实测** `vec0.so` 159,816 B、`vec_version()=v0.1.9`、`getLoadablePath()` 可用；Windows 侧为 `vec0.dll` 289,280 B）⇒ **阶段 0 建库一律 `{allowExtension:true}` 零成本预留升级窗口**，数据量 >10 万条时启用 | 先啃 sqlite-vec / 两条互备 | 需处理 §2.2 的 W-1/W-2/W-3 三条语义 |
| **C5** | **多设备同步移出范围** | 全文仅**方案 §17 行1140** 五个字、零设计；与**方案 §11.1 行785**「本地 SQLite 单文件」+ **方案 §12.4 行911**「本地优先/隐私」张力 | 降为阶段 5 备注 / 独立成阶段 | 出现明确的跨设备冲突解决设计时重启 |
| **C6** | **阶段 0 补 `session_id` + `turn_id` 列** | §6.1 行442–443 要求按 `(session,turn)` 计数，但方案 §11.2 六张表**无此列** ⇒ 不变式**无可数之处** | 放弃机检改人工抽读 | 不补则 I1/I2 永久不可验 |
| **C7** | 方案 §13.2 七个目标值 = **全部改标「待定，需首测后自设」** | 本机**一个都没有实测基线**。⚠ 这些数写在方案「**目标**」列，**不是**谎报成实测值；真缺陷是**没有任何可达性基线** | 沿用方案数字并注明「未实证」 | 先定标准后补数据是本册要避免的做法 |
| **C8** | JEV 承载 = **本机 Ollama logprob 合成 noul** | LitJev 需 `Qwen3.8-27B` + **H100 80GB**（本机 RTX 2070S 8GB）。⚠ **WSL 复核修正两处**：① **`python3` 存在**（3.14.4），v1.0 的「Python/uv 均无」只对 `uv` 成立；② **`yes=0.887 / no=0.101` 复现不出** —— 同参数实测（`qwen3.5:0.8b`/`think:false`/`num_predict:1`/`temperature:0`）得 `Yes=-0.5635` → **归一 yes=0.577 / no=0.423**。⚠ 模型选型硬约束仍成立：`qwen3:8b` → `"yes"=1.000`（饱和不可用概率） | 照方案用 LitJev（本机不可行） | 若采用 `dsh-memory-jev` 的 OpenRouter 通道，须处理无 key 降级 |
| **C9** | 方案 §14「检测方式」列入 **阶段 0 硬判据** | 逐条判定 **真有信号 0 / 半真 3 / 愿望 7**；本项目只有一名使用者、**无报障通道** ⇒ 这一列是唯一安全网 | 留到阶段 6 补 | 检测落点属契约层，阶段 6 改表要动已上线数据面 |
| **C10** | 工期 **双口径并列** | 人类等价保留方案原值，**实算 20–30 周**（`1+3+4+4+4+4=20`、`2+4+6+6+6+6=30`）；**「34 周」在全仓无来源** | 单口径 | 按 34 排缓冲会凭空多 4 周并掩盖真实关键路径 |
| **C11** | 契约**灰度分版**：`v0.1`（S1 五类事件）→ `v0.2`（长时记忆增补）→ `v0.3`（巩固遗忘增补） | §10.4 行774「services 之间靠事件通信、不直接 import 实现」正是灰度可行的依据（事件声明合并，新增事件不破坏既有订阅者）。**这是唯一的总工期压缩杠杆**：`v0.1` 冻结后最大并行扇出 **7 路** | 一次性全冻 | 全冻是伪瓶颈 |
| **C12** | 阶段 0 **只建 P0 六个骨架** | 13 个空壳同批装配后面板上分不出哪几个真有行为 ⇒ 后续每批失败被 13 项等权清单稀释（G11） | 13 个一次全建 | P1 在 B2.2 建、P2 在 B5.1 建 |
| **C13** | **`core` 独占契约**，其余插件**禁止**自建 `event-types.ts` | 声明一旦分散到 13 个文件，编译期护栏失效，错误推迟到运行期（arch 席成因 B）；删方案 §9.2:619 该行 | 每插件自带事件声明 | 改一个事件签名现状 ≥3 文件，改后 1 文件 + 编译期全量报错 |
| **C14** | **派生量唯一写者** | 时间衰减三套公式并存（`d=0.5` / `h=14天` / `S`+Pavlik–Anderson）而作用于同一条记忆 ⇒ 排序被两家乘过；激活值 A 既被计算又落库而读写方未指定；上下文尾部有**两个写者**（working-memory 与 JEV Injection Gate） | 维持现状 | 见 §4 阶段 2 实施要点 |
| **C15** | **取件优先 `git clone`；clone 失败时才回退 API 逐文件** | ⚠ **WSL 复核补充关键前提**：`git clone` 成功**依赖环境代理** `http_proxy`/`https_proxy` = `http://127.0.0.1:10808`（WSL `autoProxy` 注入）。实测：**带代理** clone `Fishsb/dsh-shoucang-memory` **exit 0 / 210 个 TS 文件**；**清空代理变量后 clone 超时（exit 124）**，但 `git ls-remote` 仍通 ⇒ clone 大仓**必须经代理**。`git config http.proxy` 未设（靠环境变量） | 直连 clone（**首选，但须确认 `http_proxy` 在环境里**） | 若 clone 真失败：先确认代理环境变量存在并重试，再走 API 逐文件 |

---

## 9. 附：本册的取证方式与可信度

| 来源 | 说明 |
|---|---|
| **本机工具实测** | 全部标「实测」的项均由命令产出，可复算；三档分档见 §6.0 |
| **圆桌会议 7 席产出** | 会议 `mana-rollout-2026-09-24`，orchestrated 模式；角色：复用与查重 / 场景与干系人 / 架构主审 / 落地可行性 / 验收判据 / 分期落地 / 独立验证 |
| **方案原件** | `docs/mana-v5-plan.md`（1241 行；**2026-09-24 平台适配轮已按 WSL 改写 20 行**，行号未变，sha256 `459DA3E2…0508AD`；适配前快照 `d332c940…7f2fd01a`） |
| **会议记录** | `.roundtable/mana-rollout-2026-09-24/`（transcript + 8 份分席素材于 `_extract/`） |

**三条取证纪律**（本轮踩过并已固化）
1. **搜索通道返回空 ≠ 不存在**：本次 GitHub 搜索返回空而 API 逐仓库求证实存，二者结论相反。
2. **三种取证通道结论不同，禁止跨通道混用**：npm registry / GitHub API / 本机目录 —— 混用会得出相反结论（某包 npm E404 而 GitHub 实存）。
3. **机制自证 ≠ 生效**：装配清单、心跳、端口、文件增长均属机制自证，不等同运行态；验收一律落到**产物侧**（字节/行数/审计记录）与**反证**（卸载后不再产生新行）。
4. **单次采样不可作决策依据**（本轮踩出）：主持人因**一次** `git clone` 失败即写成决策条目 C15，被复核推翻后实测 **3/3 成功** ⇒ 凡单次采样支撑的结论，必须复测后再入决策列。

---

## 10. 附：会议异议归位表（避免「没人再提 = 已同意」）

> 会议共 7 席、63 条发言。下表确保**每一条异议都有归宿**：采纳（附落地位置）/ 判不成立（附反证）/ 未触及（逐条列名）。

### 10.1 已采纳（31 条 · 节选关键项，全部已在正文落地）

| 异议 | 来源席 | 落地位置 |
|---|---|---|
| 方案 §15.3 复用承诺不实，须按取证通道分档 | reuse | §1 条1 / §1.1 三分法 / §2 G12 |
| `dsh-memory` 内容为纯 FTS5，与描述不符 | reuse | §1 条2 / §0 最重要结论 |
| sqlite-vec 加载须 `{allowExtension:true}` 且**不可后补** | reuse / impl / accept | §2 G4 / 阶段 0 约束 / A0-2（负向） |
| 中文 FTS5 默认分词 0 命中、2 字查询静默空 | scenario / accept / impl | §2 G5 / A0-3 / A1-10 |
| `node --test <目录>` 写法陷阱（形似失败实为命令错） | rollout / accept / verify | §8 C3 / A0-7（负向） |
| pnpm / vitest 本机不存在 | rollout / accept / impl | §8 C1 / C3 / §2 G12 / 阶段 0 约束 |
| 13 插件切分过度，装配面应收敛 | arch | §8 C2 / 阶段 0 实施 |
| 状态归属三处撞车（trace 双权威 / 派生量 / 向量两存法） | arch | §2 G4 / 阶段 2「向量权威唯一」 |
| `forgetting`/`consolidation` 依赖方向倒置 | arch | 阶段 2 约束 |
| §9.4 用 `emit` 分发 waterfall 契约 → 死契约 | arch / impl | §1 条7 / §2 G6 / 阶段 1 实施 |
| 方案 §14 检测方式：0 真信号 / 3 半真 / 7 愿望 | scenario | §2 G2 / §8 C9 / A0-9 |
| I1/I2 无可数之处，须补 `session_id`/`turn_id` | accept | §2 G3 / §8 C6 / A0-8 |
| 五处核心判据「退回动作」因表格断裂丢失 | accept | 已修并经复核确认闭合 |
| ±5pp 样本量只能估准不能**证成** | accept | §6.1 记忆命中率栏 |
| R² 点估计 `>0.8` 会给假通过 | accept | §6.1 改「CI 下界 > 0.8」 |
| 降级率是**零事件型**判据 | accept | §6.1 改「连续 ≥60 次无降级 = 5.00% 上界」 |
| `busy_timeout` 默认 0、无事务封装、报错不回滚 | impl | §2 G7 / 阶段 0 约束 |
| `bail` 判据不是「非空」（`0`/`''` 也算） | impl | §1 条7 区 / 阶段 1 B2.1 |
| 宿主 fetch 打 11434 的注释不成立（三条反证） | impl | §7 未验证项 1（措辞保持保守） |
| LitJev 需 H100 不可行 | impl | §8 C8 / 阶段 1 B1.2 |
| §6.4 Top-50 fan-out 不可达（实测 5785ms） | impl | §2 G14 / 阶段 1 实施 |
| `agent/pre-step` 争扩展点、漏 `next()` 静默掐死既有件 | impl | §2 G9 / §1 条15 / 阶段 0 契约 / R1-b |
| 「关键路径 11」不成立 | verify | §3.1.1 两种口径分列（8 / 10） |
| 「clone 443 不通」与实测相反 | verify | §8 C15 纠正 + §9 纪律 4 |
| 漏第二个注册点会导致回归判据假绿 | verify | §1 条15 / G9 / R1-b **分链落地** |
| §6.0 `≤1.5×` 与 `1.33–1.71` 冲突 | verify | 上界改 **≤2.0×** |
| 倍差下界 `2.5` 排除改写/无关两例 | verify | 改 **1.2–13 倍** |
| C1 磁盘数字过期 | verify | 改实测 **32.3 / 227.6 GB**（标注浮动） |
| 多设备同步应移出范围 | rollout | §8 C5 |
| 阶段 0 只建 P0 六个骨架 | rollout | §8 C12 |
| 契约灰度分版而非一次性全冻 | rollout | §8 C11 |

### 10.2 判不成立（2 条 · 附反证，不盲从）

| 异议 | 反证 |
|---|---|
| 「`lat(A=−3,τ=−2)=1733.561349` 反解不出、A 档不可复现」（verify 席 F8） | 主持人按册中公式复算 `F·e^(−f·τ)·1000 = 0.35 × e^1.6 × 1000 = 1733.5613485`，**与册中逐字相同**；核验席按 `A=−3` 直接代入、未走钳位分支 ⇒ **该意见不成立**。**但它暴露的真问题已采纳**：`A=−3` 与 `A=−2` 同值 ⇒ 夹具改写为 `lat(A=−2,τ=−2)` 并写明钳位语义（见 A2-2） |
| 「方案 §15.3 的 5 个插件查无此物」（impl / arch 早期判断，**主持人早期亦然**） | 属**误判并已纠正**：GitHub API 逐仓库证实 `Towzai/dsh-memory-jev` v0.4.1(MIT) 与 `Fishsb/dsh-shoucang-memory`(Apache-2.0) **真实存在**，仅 npm E404 ⇒ 改为三分法（§1.1）。这不是判该异议错，而是**判对它早前的否证错了** |

### 10.3 未触及 / 挂账（12 条 · 逐条列名，不当作已解决）

1. **`dev_*` 注入/卸载可调用性** —— 作者席与核验席工具集内均无 `dev_*`；须由具备 `dsh-super-injector` 工具链的执行席验证（R0/A6-4/R6 已标注该前置）。
2. **宿主进程内 `fetch` 打 11434 的最终确证** —— 仅有间接实证；须在阶段 2 首个 Mana 插件内放探测工具。
3. **§9.3 事件契约全文语义** —— 未逐条读全。
4. **方案 §13.1/§13.2 死阈值** —— 除延迟有组成项实测外全无基线（§6.1 挂待定）。
5. **方案 §17 各阶段时长的实测依据** —— 不存在。
6. **方案 §5.1/§5.3/§6.2/附录B 的认知参数数值是否站得住** —— 本册只保证公式可复现，不评数值品味。
7. **§10.4「services 不直接 import 实现」是否被违反** —— 无源码，不可判定。
8. **公开仓库取源后的可编译性** —— 本册只做只读取件，**未安装、未编译**。
9. **`dsh-memory` 的归属** —— npm 上 `dsh-memory@0.1.0` 与 GitHub 三个同名/近名高星仓库不是同一个包，方案未指明。
10. **独立心跳文件的写入方与 Windows 权限面** —— 已给出可判定形态（卸载全部插件后仍更新），但**写入方落谁家未定**。
11. **多设备同步的重启判据** —— 无设计可评（已移出范围）。
12. **阶段 5 `mana-ui` 自建产物侧落点的具体端点形态** —— 方向已定（`mana_trace` 的 `ui/render` 行），**具体端点未定**。

---

> **本册结束**。若要开工：读 §3.1 找到你的批次号 → 跳 §4 对应阶段 → 按 §4 每阶段开头的「统一验收模板」产出三条判据。若要改本册任何裁定：先读 §8 对应条目的「证据」列；若要查某条异议的归宿：读 §10。

---

## A. 环境适配（WSL2 / Ubuntu）—— 2026-09-24 平台适配轮

> **为什么有这一节**：本册 v1.0 的全部「本机实测」产自 **Windows**（`D:\Mana` + `C:\Users\lk\.dsh-win`）。项目现役环境是 **WSL2 / Ubuntu 26.04.1**，项目根 `/home/lk/Mana`（ext4）。两边的**包管理器、Node 构建、文件系统、DSH 安装位置、Shell** 全不同。本节是**本轮实测取数**，与正文冲突时**以本节为准**。

### A.1 平台与既有件位置（实测）

| 项 | Windows（v1.0 口径） | **WSL2（现役，本节口径）** |
|---|---|---|
| 系统 | Windows（`D:` 盘） | **Ubuntu 26.04.1 LTS**，kernel `6.18.33.2-microsoft-standard-WSL2`，12 vCPU / 15 GiB |
| 项目根 | `D:\Mana` | **`/home/lk/Mana`**（ext4；`D:\Mana` 是它的软链） |
| DSH 安装 | `C:\Users\lk\.dsh-win\prefix` | **`/usr/local/lib/node_modules/@deepseek-ai/dsh`**（`0.1.7-rc.1`） |
| `DSH_HOME` | `C:\Users\lk\.dsh` | **`/home/lk/.dsh`**（ext4） |
| profiles | `desktop`/`headless`/`web` | **`headless`/`system`/`web`**（**无 `desktop`**） |
| 文件系统 | NTFS | `/home/lk/*` = **ext4**；`/mnt/d` = **9p(v9fs)** |
| Shell | PowerShell | **bash**（退出码 `$?`） |

> ⚠ **双 DSH 并存**：WSL 侧为现役；Windows 侧 `C:\Users\lk\.dsh` 仍有遗留 registry。两者**互不影响**，但排障时勿混（`DSH_HOME` 不同）。

### A.2 工具链（实测值 —— A0-1 的判据以此为准）

| 工具 | 实测 | 说明 |
|---|---|---|
| `node -v` | **`v22.22.1`** | ⚠ **不是 `22.22.0`**。`engines.node` 若写精确 `22.22.0` + `engine-strict=true` ⇒ **必然 `EBADENGINE` 假红**（已实测）。写 **`^22.22.0`** |
| `npm -v` | **`11.19.1`** | v1.0 记 10.9.4（Windows 侧） |
| `pnpm -v` | **`12.4.2`**（存在） | ⚠ **推翻 v1.0「pnpm 不存在」** |
| `corepack -v` | **`0.24.0`** | v1.0 记 0.34.0 |
| `python3 -V` | **`3.14.4`**（存在） | v1.0 记「Python 无」**不成立**；`uv` 仍缺 |
| `sqlite3` CLI | **3.46.1**（本轮安装） | 用于人工查库，**非**运行依赖（运行走 `node:sqlite`） |
| `jq` | **1.8.1**（本轮安装） | 判据脚本大量用 `jq` 解析 JSON |
| `git` | **2.53.0** | |
| `gh` | WSL 侧**无**（Windows 侧 `/mnt/c/Users/lk/gh-cli/bin/gh.exe` = 2.70.0 可用） | 如需 release 走 `gh.exe` |

> ⚠⚠ **Node 构建差异（本轮最关键的发现）**：Ubuntu 自带的 `/usr/bin/node`（`nodejs` 包）**编译时未启用 TypeScript 支持**，实测：
> - `/usr/bin/node -e "import('./m.ts')"` → **`ERR_UNKNOWN_FILE_EXTENSION`**
> - `/usr/bin/node --experimental-strip-types` → **`Node.js is not compiled with TypeScript support`**
> - **官方 Node 构建**（nodejs.org 同版本 `v22.22.1`）→ **`.ts` 直接 import 成功**（22.22 已默认启用类型剥离）
>
> 本项目 33 个测试文件**全部** `import ../src/*.ts` ⇒ **用 Ubuntu 版 node，整仓测试全部无法加载**（实测 `# tests 106 / # fail 39`，报 `ERR_UNKNOWN_FILE_EXTENSION`），而类型检查在 ext4 上绿 ⇒ **测试能力静默归零、CI 仍「绿」**。
> **处置（已完成）**：安装官方构建到 `/opt/nodejs`，并用 `/usr/local/bin/{node,npm,npx}` 软链指向它（PATH 中 `/usr/local/bin` 先于 `/usr/bin`）⇒ 交互/非交互 shell 解析一致。复验：`node -e "import('/tmp/x.ts')"` 须成功。

### A.3 网络与代理（取件/装包的前置）

- 环境变量由 WSL `.wslconfig` 的 `autoProxy=true` 注入：`http_proxy`/`https_proxy` = **`http://127.0.0.1:10808`**；`NODE_USE_ENV_PROXY=1`。
- `no_proxy` 含 `127.*` / `localhost` ⇒ **Ollama（`127.0.0.1:11434`）直连不走代理**。
- `npm` 实测**经环境变量代理可用**（`npm view` 4.3 s 返回；`npm i` 成功），**无需** `npm config set proxy`（实测 `proxy`/`https-proxy` 均为 `null`）。
- `git` **未设** `http.proxy`，靠环境变量。**实测**：带代理 clone 成功（exit 0 / 210 TS 文件）；**`env -u http_proxy -u https_proxy` 后 clone 超时（exit 124）**，而 `git ls-remote` 仍通 ⇒ **大仓 clone 必须经代理**（细化 C15）。
- `apt` 经代理可用（`apt-get update` 成功）。

### A.4 工程样板的两副本差异（决定「绿基线」取哪一个）

| 副本 | 路径 | 平台包版本 | `typecheck` | `npm test` |
|---|---|---|---|---|
| **ext4（现役）** | `/home/lk/dsh-src/dsh-plugin-roundtable` | `@deepseek-ai/dsh-*` = **0.1.7-rc.1** | **exit 0** | 348 tests / 327 pass / **21 fail** |
| 9p | `/mnt/d/lk/FF/dsh-plugin-roundtable` | `@deepseek-ai/dsh-*` = **0.1.5-rc.2** | **exit 2** / 24 error | — |

两份 `HEAD` 同为 `a8c8bb7`、`git status` 同为 19 行、`src`/`test` 逐文件相同，**差异只来自 `node_modules` 的平台包版本**。
⇒ **结论**：v1.0 的「样板 typecheck 红」是 **9p 副本 + 0.1.5 平台包**的结论；**现役 ext4 副本 typecheck 绿**。抄样板时**用 ext4 副本**。
⚠ 两副本的 21 条测试失败**均为样板自身的跨平台缺陷**（`new URL(...).pathname.replace(/^\//, '')` 在 Linux 下丢掉根 ⇒ ENOENT；3 个文件缺 `@deepseek-ai/dsh-scope`），**不是本项目造成**，但**抄测试脚手架时必须先修**（改用 `fileURLToPath`）。

### A.5 存储路径与磁盘（G15 / C1 的 WSL 口径）

- `~/.dsh/memory` **不存在**（`test -e` = false）⇒ G15 结论**在 WSL 同样成立**，阶段 0 仍须自建目录。
- **`mana.db` 落在 ext4**（`DSH_HOME=/home/lk/.dsh`、项目根 `/home/lk/Mana` 均在 `/dev/sdd`），**不在 9p 上** ⇒ v1.0 隐含的「跨盘/9p SQLite 风险」在本项目中**不存在**。实测 9p 与 ext4 上 `busy_timeout` 行为一致（均 2003–2005 ms 后 `database is locked`）。
- 磁盘：WSL 根分区 **950 GB 可用**（v1.0 记 Windows C 盘仅余 32.3 GB）⇒ C1 的磁盘压力论据**已不成立**（但用户仍对占用敏感，共享 `core` 的结论不变）。
- ⚠ **`~/.dsh/profiles/web/node_modules/dsh-shoucang-memory` 是 `link:` 装配的活跃开发树**（非只读副本），对它的任何写入都会直接影响运行中的 shoucang。

### A.6 行尾与编码（两仓策略不同，须显式决策）

| 仓 | 策略 | 实测 |
|---|---|---|
| 工程样板 | `* text=auto eol=lf` + 逐类型固化 | 全仓 LF 契约 |
| **Mana（本仓）** | **`* -text`**（禁一切行尾/编码自动改写） | `mana-rollout-plan.md` **为 CRLF**，检查器按 `/\r?\n/` 切分；若被 git 归一化会**污染 sha256 对账** |

⇒ **决策**：Mana 仓**保留 `* -text`**（本仓内容的行尾有意义，且已有 sha256 对账）；抄样板 `.gitattributes` 时**只抄「禁二进制改写」一类**，**不要**抄 `eol=lf` 全局规则（会把本册 CRLF 改掉）。

### A.7 一条命令复核（本节所有结论）

```bash
# 平台 / 工具链
uname -r; node -v; npm -v; pnpm -v; python3 -V; sqlite3 --version | head -1; jq --version
# Node 必须支持 .ts 直载（否则全仓测试静默归零）
printf 'export const a: number = 1\n' > /tmp/t.ts && node -e "import('/tmp/t.ts').then(m=>console.log('TS-OK',m.a)).catch(e=>console.log('TS-FAIL',e.code))"
# node:sqlite 导出（A0-1 判据）
node --no-warnings -e "const s=require('node:sqlite');console.log(Object.keys(s).join(','))"
# DSH / cordis 版本
npm ls -g @deepseek-ai/dsh --depth=0; node -p "require('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/package.json').version"
# 代理与可达性（no_proxy 覆盖 127.0.0.1 ⇒ Ollama 直连）
env | grep -i proxy; curl -s -m 5 http://127.0.0.1:11434/api/version
# 存储目录（G15）与文件系统
test -e ~/.dsh/memory && echo "memory EXISTS" || echo "memory ABSENT (须自建)"; df -h /home/lk/Mana /mnt/d | tail -3
# 样板 ext4 副本基线（A0-10 取基线值）
cd /home/lk/dsh-src/dsh-plugin-roundtable && git status --porcelain | wc -l && git rev-parse --short HEAD
```
