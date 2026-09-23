# 圆桌会议记录 · mana-rollout-2026-09-24

---
<!-- 以下为预填的会议元数据，可整段作为 issue / 归档记录的头部 -->
- **插件**：dsh-plugin-roundtable v0.2.56（DeepSeek Harness 0.1.5-rc.1+）
- **会议 id**：mana-rollout-2026-09-24
- **协作模式**：orchestrated
- **状态**：active（进行中快照）
- **创建时间**：2026-09-24 03:33:29
- **最后更新**：2026-09-24 04:26:09
- **预算用量**：2/12 轮 · 65818/400000 token
- **知识库**：D:/Mana/docs
---

## 议题 / 目标

把已落盘的《Mana（末那识）v5 方案》（D:/Mana/docs/mana-v5-plan.md，1241 行，13 个 dsh-mana-* 插件 / 7 个阶段）转成可执行的分期落地册：每阶段一份实施方案 + 一份验收方案，细到"改哪些文件 / 跑什么命令 / 看哪个数 / 不达标退回哪一步"。

已实测钉点（会议必须以此为准，不得引用方案自述当证据）：
· Node v22.22.0；node:sqlite 可用（DatabaseSync / StatementSync / backup）。
· Ollama :11434 在跑，bge-m3:latest 已在本机。
· 方案 §15.3 声称"直接复用 dsh-memory / dsh-memory-jev / dsh-hindsight-memory / dsh-graphmemory / dsh-memoria"——本机一个都没装；profiles 内只有 dsh-shoucang-memory（v0.3.1，lib 内含 vec.js「bge-m3 + 余弦 + RRF」、criteria/evidence/audit 链、client 面板）。
· 插件工程样板：D:\lk\FF\dsh-plugin-roundtable（TS + tsdown + node:test + cordis.patch.yml + 客户端半区齐全）。
· 跨席判据的唯一归属地是 D:\lk\FF\preset-index.md。

会议要求（用户在全局指令里定死的口径）：
1. 排序口径：先给「会掩盖其他问题 / 让失败不可观测」的缺陷，再按严重度排；不得按显眼度排。
2. 每条结论须给位置（文件/行号/命令输出）；给不出即标「未验证」。
3. 找不到真问题就写「未发现」，不许凑数。
4. 需用户拍板的分歧用 [建议决策] 行输出：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。

最终交付物：D:/Mana/docs/mana-rollout-plan.md。

## 用户原话（未加工）

> 启用圆桌会议讨论，根据项目方案整理落地方案，阶段性每个阶段要有实施方案以及验收方案，尽量做细节

## 边界声明

- **要解决的现象**：把 v5 方案（13 个 dsh-mana-* 插件 / 7 个阶段）转成可执行的分期落地册：每阶段给出实施方案与验收方案，粒度到「可执行步骤 + 产物 + 检查命令 + 阈值 + 退回动作」。
- **算解决的标准**：产出 D:/Mana/docs/mana-rollout-plan.md：七个阶段各自的①实施方案（步骤/产物/依赖/并行或串行/工时区间）②验收方案（判据/检查方式/阈值/退回动作）齐备，阶段间硬依赖与阻塞点显式标出，可被第三方照着执行。
- **怎么检查**：① 七阶段「实施 + 验收」两节齐备（7/7，计数比对）；② 每条验收判据至少一条可复制执行的命令或确定性比对方式（禁止「性能良好」类不可判定表述）；③ 关键前提（node:sqlite / sqlite-vec 可得性 / 嵌入服务 / 可复用件是否真存在）一律工具实测取数，禁止引用方案自述。
- **明确不做 / 不许动**：不改任何既有已装配插件的代码与配置（shoucang / roundtable / project-nav 等一律不动）；不向运行态安装新插件；不改 ~/.dsh/settings.yaml；不建库、不写 mana.db；本轮只产出规划文档，不落实现代码。

## 专家名单（7）

- `reuse` — 只回答「这事有没有现成的」，不判断方案好坏。三查必做：①项目内已有实现（给文件与符号）；②既有依赖栈内能力（给包与版本）；③开源生态成熟实现（给仓库链接、最近发版、许可）。每条写明「为什么不用它」，找不到即明确写「未找到」。产出：候选用现表（来源 / 位置 / 许可 / 最近发版 / 不用理由）+ 未找到声明。 （预设 `reuse`） — dshapi/deepseek-v4.1-flash @low — 状态 idle
- `scenario` — 只枚举使用场景与受影响方，不论证技术选型。逐项列出正常、边界、异常三类路径，写明触发条件与期望结果；列出使用者，以及上线后由谁维护。专找「只在特定时区、编码、权限或数据量下才出现」的场景。产出：场景清单，按发生概率排序，标出哪些当前设计未覆盖、必须现在补。 （预设 `scenario`） — dshapi/deepseek-v4.1-flash @low — 状态 idle
- `arch` — 只审结构，不审实现细节。看模块边界与职责是否清晰、依赖方向是否单向、分层是否被穿透、数据流与状态归属是否唯一、演进是否留余地。以「改一处要动几个文件」度量耦合。必须做根因归并：把表面不同的问题收敛到少数几个结构性成因，不罗列孤立条目。产出：成因清单（每个成因对应哪些症状 + 最小改法）。 （预设 `arch`） — dshapi/deepseek-v4.1-flash @high — 状态 idle
- `impl` — 只回答「这套方案真能写出来吗」，不评价设计品味。核对接口契约、并发与事务、性能与资源上限、迁移与回滚，以及第三方依赖的真实返回语义（如 INSERT 返回的是结果头还是主键、异步 API 的失败如何暴露），不得按直觉假设。产出：阻塞项清单（每条附已核对的真实语义）+ 最小可行改造序列。 （预设 `impl`） — dshapi/deepseek-v4.1-flash @high — 状态 idle
- `accept` — 只把目标转成可复验的判据，不讨论实现。每条判据写全四要素：判据内容、检查方式（命令 / 字节比对 / 审计态）、通过阈值、失败退回动作。阈值须先给一次实测值再定；无实测即标「待定，需用户拍板」，不得先定标准后补数据。禁止「性能良好」这类不可判定表述。产出：判据表，分「可自动检查」与「须人工判断」两组。 （预设 `accept`） — dshapi/deepseek-v4.1-flash @high — 状态 idle
- `rollout` — 只把结论排成可执行时间线，不重新论证方案。按「先跑通再优化」切分阶段，每阶段给交付物、验收判据、预计阻塞点、回滚方式。标出阶段之间的硬依赖与可并行部分。禁止把大改造塞进一步；每阶段必须可独立验证。产出：分期表 + 里程碑。 （预设 `rollout`） — dshapi/deepseek-v4.1-flash @low — 状态 idle
- `verify` — 只复核他人结论，不提新方案。对每条待核结论先预注册判据再取证，逐条裁为「成立 / 部分成立 / 不可复现」，并给证据强度（原文、行号、命令输出、字节数）。证据不足即判不可复现，不得凭合理性推断为成立。严格区分「接口返回成功」与「结果真的达成」。与 repro 的实跑结论冲突时以实跑为准，并显式标出冲突。产出：核验表（结论 / 裁定 / 证据 / 反例）。 （预设 `verify`） — dshapi/deepseek-v4.1-flash @high — 状态 idle

## 调度计划（2 轮已记录）

> 同波内的项**无相互依赖**（可并发下发）；后面的波等前面的波完成。

### 第 1 轮 · R1 勘察波：六席并行只读取证（可复用件真相 / 场景覆盖 / 结构切分 / 落地阻塞 / 验收骨架 / 分期骨架），verify 在第二波复核关键主张。

- **wave 1**（立刻并发下发）
  - `r1-reuse` → `reuse`：查证方案 §15.3 声称可直接复用的 5 个插件是否真实存在/可获取/与本机 DSH 0.1.5-rc.2 兼容；并盘点本机已有件（dsh-shoucang-memory 的 vec/criteria/evidence 链、D:\lk\FF 下既有插件）里哪些资产可直接搬到 Mana，产出「候选用现表 + 未找到声明」
  - `r1-scenario` → `scenario`：枚举 Mana 上线后的真实使用场景与受影响方（正常/边界/异常三类），标出当前方案未覆盖、必须现在补的场景
  - `r1-arch` → `arch`：审 13 插件切分与 mana/* 事件契约的结构：模块边界、依赖方向、状态归属、是否过度切分，产出成因清单（症状+最小改法）
  - `r1-impl` → `impl`：核对落地可行性阻塞项：node:sqlite 真实语义、Cordis 五种事件分发模式实际可用性、sqlite-vec 在本机 Node 22 的可得性、LitJev/JEV 通道可得性，每条附已核对的真实语义
  - `r1-accept` → `accept`：把 7 个阶段目标转成可复验判据骨架（判据/检查方式/阈值/退回动作四要素），阈值能实测的先给实测值，无实测的标「待定，需用户拍板」
  - `r1-rollout` → `rollout`：给出分期时间线骨架：阶段切分与硬依赖、可并行部分、每阶段交付物与回滚方式（不重新论证方案）
- **wave 2**（等 wave 1）
  - `r1-verify` → `verify`：第二波：独立复核 r1-reuse / r1-impl / r1-accept 的关键主张，逐条裁「成立/部分成立/不可复现」并给证据强度；预注册判据后自己重跑命令取证

### 第 2 轮 · R2 成册波：rollout 按主持人作业书产出落地册成品（change），verify 与 accept 分两路独立复核（review，均非作者席）。

- **wave 1**（立刻并发下发）
  - `r2-write` → `rollout`：按 D:/Mana/docs/_synthesis-brief.md 作业书，整合 7 席素材产出《Mana 分阶段落地册》成品到 D:/Mana/docs/mana-rollout-plan.md（七阶段各含「实施方案 + 验收方案」两节，含命令与阈值与退回动作）
- **wave 2**（等 wave 1）
  - `r2-review-verify` → `verify`：独立复核成品文档：① 实测数字是否保真（抽查至少 8 个数值，回素材比对，看有无被四舍五入或升格）；② 判据里的命令是否真能跑（抽至少 3 条实跑）；③ 素材中标「未验证」的项在成品里是否仍标未验证
  - `r2-review-accept` → `accept`：独立复核成品文档的验收完整性：① 七阶段是否每阶段四要素（判据/检查方式/阈值/退回动作）齐备，逐阶段计数；② 有无不可判定表述残留（「良好」「及时」等）；③ 有无未经实测的目标值被当阈值采纳（方案 §13.2 那 7 个）


## 决策记录（0）

（无）

## 发言记录（37 条）

### 第 1 轮

**captain → reuse** · 2026-09-24 03:34:44

【R1 · 工作项 r1-reuse】主题：可复用件真相核查（只读，禁止任何写操作）。

背景：任务是给《Mana（末那识）v5 方案》（KB 目录 D:/Mana/docs 下的 mana-v5-plan.md，1241 行）做「分阶段落地方案，每阶段含实施方案 + 验收方案」。我作为主持人已缓存该文件的目录级摘要到会议 KB 缓存，你**不必整篇读**，但你需要直接取证时可以用 read 工具读该文件的**指定行段**（例如 §15.3 在约 1010–1022 行，§9.1 插件清单在约 586–604 行，§9.2 结构在约 606–624 行）。

你的角色是「复用与查重」：只回答「这事有没有现成的」，不判断方案好坏。三查必做。

【第一要务 —— 必须用工具实证，不许引用方案自述】
方案 §15.3 白纸黑字声称这些插件可以「直接复用」：dsh-memory、dsh-shoucang-memory、dsh-hindsight-memory、dsh-graphmemory、dsh-memoria、dsh-memory-jev。
我已实测：本机 `C:\Users\lk\.dsh\profiles\web\node_modules` 里**只有 dsh-shoucang-memory**，其余**一个都没有**；`C:\Users\lk\.dsh\super-injector\registry.json` 只登记了一个无关插件。
请你独立复核这个判断，并回答：
(a) 逐个核对这 6 个包在本机到底存不存在（给命令与输出）。搜索面至少覆盖：`C:\Users\lk\.dsh\profiles`、`C:\Users\lk\.dsh\plugins`、`D:\lk\FF`、`D:\FF`、`D:\lk\deepseek`、`F:\dsh`（`Get-ChildItem -Directory -Depth 3` 之类，注意别做全盘递归，会超时——我已踩过这个坑）。
(b) 对确实不存在的：到开源侧查它们是否真实存在于公开生态（npm / GitHub）。若有，给仓库链接、最近发版时间、许可；若查不到，明确写「未找到」——**不许因为方案里写了就当作存在**。搜索建议用 platform_search(platform=github/npm)。
(c) 对本机确实存在的 dsh-shoucang-memory v0.3.1：盘它可以被搬走的资产。我已看到 `lib/` 下有 vec.js（bge-m3 + cosine + RRF，缺省走 Ollama :11434）、criteria.js / criteria.generated.js、assertion-graph.js、evidence 相关链、client.js（8 万行级面板）。请给出**符号级**清单：哪个文件、导出了什么函数、Mana 的哪个阶段能直接用、用之前要付什么代价（许可证、耦合度、是否私有包）。
(d) 工程样板：`D:\lk\FF\dsh-plugin-roundtable`（TS + tsdown + node:test + cordis.patch.yml + 客户端半区）与 `D:\lk\FF\dsh-frozen-injection`。核对它们的 package.json（dsh.bundle 声明方式、peerDependencies 版本范围、build/test 脚本），给出「新插件抄哪一份、抄哪些文件」的结论。

【方法论提示】本机是 Windows + PowerShell（不是 bash），命令请用 pwsh 工具的 PowerShell 语法。工具调用要省：一次 pwsh 里塞多条语句，别一条一条来。

【交付格式】按你的角色模板：候选用现表（来源 / 位置 / 许可 / 最近发版 / 不用理由）+ 未找到声明。每条结论必须附位置（文件路径 / 命令输出）。给不出证据的条目一律标「未验证」。
结尾须有 [核心产出] 与 [下一步建议]；若有必须用户拍板的分歧，用 [建议决策] 行：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。

**captain → scenario** · 2026-09-24 03:34:44

【R1 · 工作项 r1-scenario】主题：使用场景与受影响方枚举（只读）。

背景：任务是给《Mana（末那识）v5 方案》做「分阶段落地方案，每阶段含实施方案 + 验收方案」。方案全文在 D:/Mana/docs/mana-v5-plan.md（1241 行），我作为主持人已把目录级摘要缓存进会议 KB 缓存——你不必整篇读，需要取证时读指定行段即可（§1 概述在 36–77 行，§5 机制在 329–427 行，§6 三道门控在 430–490 行，§8 巩固遗忘在 542–580 行，§13 评估在 915–966 行，§17 路线图在 1098–1148 行）。

你的角色是「场景与干系人」：只枚举使用场景与受影响方，不论证技术选型。产出按发生概率排序的场景清单，标出哪些**当前方案未覆盖、必须现在补**。

【这个项目是干什么的】Mana 是跑在 DSH（DeepSeek Harness）宿主机里的 13 个插件，模拟认知架构：感知→注意力门控→工作记忆(≤4 组块)→目标栈调度→行动；记忆侧有长时记忆(ACT-R 激活方程/衰减)、巩固(定时熏习/chunking)、遗忘(归档压缩)；外加 JEV 三道门控(Write/Recall/Injection)、BGE-M3 向量检索 + RRF 融合；用户模型与元认知作为「末那识」核心特性。存储 = SQLite，路径 $DSH_HOME/memory/mana.db。

【必须覆盖的三类路径 · 每条写清触发条件与期望结果】
1) **正常路径**：什么用户、在什么会话里、触发什么、期望看到什么。至少要覆盖：单次会话的记忆写入与召回、跨会话（用户第二天回来）的召回、长任务里目标栈的调度、定时巩固（方案写凌晨 3 点）。
2) **边界路径**：方案里的硬约束被顶到边上时会怎样。至少试：工作记忆 4 组块塞满、注入不变式 I1（每 session/turn 最多注入一块）与 I2（每条记忆每 session 只注入一次）被反复触碰、记忆库涨到 1 万 / 10 万条、向量服务从「在」变「不在」（Ollama 停机）、同一批记忆被 RRF 与 JEV 判出相反排序、时钟跳变/跨时区（方案有 h=14 天半衰期与 90 天归档，全靠时间戳）。
3) **异常路径**：方案第 14 节列了 10 条故障模式，请逐条落成「用户会看到什么现象、现象是否可观测、能否恢复」。重点盯：SQLite 锁竞争、插件加载失败导致认知循环断裂、前缀缓存失效导致成本上升、JEV 输入截断「失明」、用户模型漂移。

【专找「只在特定时区、编码、权限或数据量下才出现」的场景】本机是 Windows + 中文环境（路径含中文、文件默认编码可能 GBK/BOM），这是本用户的真实环境，务必纳入。

【干系人】列使用者（谁日常用、谁在出错时被叫醒）与上线后由谁维护。

【边界纪律】本轮只读，禁止改任何文件的代码与配置，禁止安装插件、禁止建库。

【交付格式】场景清单，按发生概率排序，每条给：场景 / 触发条件 / 期望结果 / 当前方案是否覆盖 / 若不覆盖该在哪个阶段补。每条结论附位置（文件行号）。给不出即标「未验证」。结尾须有 [核心产出] 与 [下一步建议]；需用户拍板的用 [建议决策] 行：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。

**captain → arch** · 2026-09-24 03:34:44

【R1 · 工作项 r1-arch】主题：13 插件切分与 mana/* 事件契约的结构审查（只读）。

背景：任务是给《Mana（末那识）v5 方案》做「分阶段落地方案，每阶段含实施方案 + 验收方案」。方案在 D:/Mana/docs/mana-v5-plan.md（1241 行）；我已缓存目录级摘要，你按需读指定行段取证：§4 总体架构 243–325 行、§5 机制 329–427 行、§9 插件化 584–727 行（§9.1 清单 586–604、§9.2 结构 606–624、§9.3 事件契约 626–669、§9.4 入口示例 671–711）、§10 多 Agent 开发 731–777、§11 存储 781–864、§12 可靠性 874–911。

你的角色是「架构主审」：只审结构，不审实现细节；必须做根因归并——把表面不同的问题收敛到少数几个结构性成因，不罗列孤立条目。产出「成因清单（每个成因对应哪些症状 + 最小改法）」。

【必须回答的结构问题 · 每条都要落到行号】
1) **13 个插件的切分是否过度**。P0 就有 core/jev/vector/perception/attention/working-memory 六个。「改一处要动几个文件」是度量：请挑 3 条真实数据流（例：一条用户消息 → 落成记忆 → 下次被召回注入）数一遍要横跨几个插件、几次事件往返，并判断这个往返数是否值得。
2) **依赖方向是否单向**。§9.1 给了一张依赖表（core 无依赖，attention 依赖 core+jev，long-term 依赖 core+jev+vector…）。请核：有没有环？有没有「底层反向依赖上层」（例如 core 或 vector 里塞了只有上层才知道的语义）？§10.4 明写了依赖规则，方案自己有没有违反？
3) **状态归属是否唯一**（这是最容易埋雷的一条）。至少核这三处：① `mana_trace` 表 vs Cordis 事件总线——同一条事实是不是存了两份、谁是权威；② 工作记忆（第六识）与长时记忆（第八识）之间，激活值/强度这些派生量的唯一写者是谁；③ `memory_items.vector` 内联 BLOB（§11.2）与 §7 说的 sqlite-vec 检索——向量到底归谁管（注意：这是「同一份数据两种存法」的典型信号，请给出结论）。
4) **事件契约的 5 种分发模式**（§9.3：emit/parallel/serial/bail/waterfall）在 §9.4 的示例里用得对不对。**重点**：方案自述里有一条纪律「只负责观察和记录的 waterfall 监听器必须调用 next()，否则会无声吞掉下游默认行为」——请检查方案给出的示例代码（§9.4，671–711 行）本身是否遵守了这条纪律，这是典型的「自己定的规矩自己没守」。
5) **演进余地**：方案 §15 一边说「直接复用社区插件」，一边又自建 13 个插件同名同责；这两条路若冲突，哪一边是结构性的（即：能不能只做「薄适配层」而不重造）。给出判定与最小改法。

【可参考的本机事实（我已实测，你可用工具复核）】Node v22.22.0，node:sqlite 可用；Ollama :11434 在跑且 bge-m3 已在本机；本机 `C:\Users\lk\.dsh\profiles\web\node_modules` 内实际只装了 dsh-shoucang-memory（v0.3.1），没有方案声称可复用的其他 5 个插件。插件工程样板见 D:\lk\FF\dsh-plugin-roundtable。

【边界纪律】本轮只读；禁止改任何既有插件代码与配置、禁止安装、禁止建库。

【交付格式】成因清单（成因 / 对应症状 / 最小改法 / 落脚阶段）。每条结论附位置（文件:行号）。给不出即标「未验证」。结尾须有 [核心产出] 与 [下一步建议]；需用户拍板的用 [建议决策] 行：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。

**captain → impl** · 2026-09-24 03:34:44

【R1 · 工作项 r1-impl】主题：落地可行性阻塞项核对（只读；允许**临时**探测命令，禁止改动既有资产）。

背景：任务是给《Mana（末那识）v5 方案》做「分阶段落地方案，每阶段含实施方案 + 验收方案」，所以**每条技术前提都必须是真的，否则后面的实施步骤全塌**。方案在 D:/Mana/docs/mana-v5-plan.md（1241 行），我已缓存目录级摘要；按需读指定行段取证：§5 机制 329–427、§6 三道门控 430–490、§7 检索 493–539、§9 插件化 584–727、§11 存储 781–864、§15 决策 986–1077、§16 选型 1080–1094。

你的角色是「落地可行性」：只回答「这套方案真能写出来吗」，不评价设计品味。核对接口契约、并发与事务、性能与资源上限、迁移与回滚，以及第三方依赖的**真实返回语义**——不得按直觉假设。产出阻塞项清单（每条附已核对的真实语义）+ 最小可行改造序列。

【必须实测的前置（这是本次会议的地基，逐条给命令与输出）】
1) **node:sqlite 的真实语义**。本机 Node v22.22.0。请实测并回报：`node -e` 里 `require('node:sqlite')` 能否用、导出什么；`DatabaseSync` / `StatementSync` 的真实 API（`prepare().run()` 返回的是结果头还是 lastInsertRowid？`all()` 返回什么形状？）；**WAL 模式怎么开**（`PRAGMA journal_mode=WAL` 走 exec 还是必须走 prepare？）；事务怎么开（`BEGIN/COMMIT` 还是 `db.transaction`？）。方案 §12.3 写「SQLite 事务 + WAL 模式」防并发写入、§11 用 node:sqlite——请核这两条在本机能不能真落地。注意：探测请用系统临时目录（如 $env:TEMP，不要碰 D:\Mana 之外的既有数据），探测完删除临时文件，**不许建 mana.db**。
2) **sqlite-vec 在本机是否可得**。方案 §7/§15.5 把 sqlite-vec 的 `vec0` 虚拟表与 `recall_hybrid` 当作既定事实（「sqlite-vec 已实现 recall_hybrid 方法」「无需自行实现」）。请核：本机 node_modules 里有没有 sqlite-vec（含 DSH 安装目录、profiles/web、各插件目录）；没有的话 npm 上该包是否存在、最新版本、可否用于 Node 22 + node:sqlite（**注意 node:sqlite 能否 loadExtension 是硬问题，请实测 DatabaseSync 有无 enableLoadExtension / loadExtension 方法**，这是决定「要不要换 better-sqlite3」的关键）。查 npm 用 platform_search(platform=npm) 或 web_search。
3) **嵌入服务真实可用性**。本机 Ollama :11434 在跑、bge-m3 已拉取。请实测一次 `/v1/embeddings`（或 `/api/embed`）调用的真实返回：维度是不是 1024、单条延迟量级、是否需要 key。**重要坑**：本机 shoucang 插件的源码注释里写着「宿主进程全局 fetch 被 DSH patch —— 实测 11434 经 fetch 不通、node:http 通」（见 `C:\Users\lk\.dsh\profiles\web\node_modules\dsh-shoucang-memory\lib\eval-channel.js:8` 与 panel-inject.js:237）。请**实测**在 DSH 进程内的插件里用全局 fetch 打 11434 到底通不通，并给出替代通道（node:http / undici / 直连 SDK）；这条直接决定阶段 2 的实施写法。
4) **Cordis 五种事件分发模式的真实可用性**。方案 §9.3 列 emit/parallel/serial/bail/waterfall 并给了实现示例（§9.4）。请到 DSH 安装目录 `C:\Users\lk\.dsh-win\prefix\node_modules\@deepseek-ai\dsh` 及其 node_modules 里核真实的 Events 接口与分发模式名（找 cordis 的 d.ts / 实际导出）。给文件:行号。
5) **JEV 通道**。方案 §15.4 首选 LitJev（Qwen 基座）备选 JEV-CPU，§3.4 引用 TypeSafe AI 的 JEV 与 JEV-CPU。请核这两个东西在本机/公开生态是否真实可得（本机 Ollama 有 qwen3.qwen3.5 系列模型，可作为「本地 Qwen 承载」的现实替代）。**若 LitJev 不可得，请明确说清「JEV 这一层到底靠什么跑」**——这是阶段 1 的核心依赖。
6) **工作记忆 ≤4 组块 + ∑W=1 与 token 预算**。方案 §5.3 的容量限制是「认知」约束，但真正会炸的是 LLM 上下文。请给量级估算：4 组块 → 多少 token；注入不变式 I1（每 turn 最多一块）在长会话里能省多少。

【方法论提示】Windows + PowerShell（pwsh 工具，不是 bash）。一个 pwsh 里塞多条语句以省调用；注意别做全盘递归搜索（会超时）。不允许 `npm install` 装任何东西到既有 profile。

【边界纪律】禁止改任何既有插件的代码与配置、禁止向运行态安装插件、禁止改 ~/.dsh/settings.yaml、禁止建库写 mana.db。临时探测文件请放 $env:TEMP 并自行清理。

【交付格式】阻塞项清单（阻塞项 / 已核对的真实语义 / 证据命令与输出 / 影响哪个阶段 / 最小绕行方案）+ 最小可行改造序列。每条附位置。给不出即标「未验证」。结尾须有 [核心产出] 与 [下一步建议]；需用户拍板的用 [建议决策] 行：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。

**captain → accept** · 2026-09-24 03:34:44

【R1 · 工作项 r1-accept】主题：七阶段验收判据骨架（只读）。

背景：用户的原话是「根据项目方案整理落地方案，阶段性每个阶段要有**实施方案以及验收方案**，尽量做细节」。你负责的是**验收方案**这一半，是整个会议最核心的交付之一。方案在 D:/Mana/docs/mana-v5-plan.md（1241 行）；我已缓存目录级摘要，按需读指定行段取证：§13 评估框架 915–966、§17 路线图 1098–1148、§5 机制 329–427、§6 门控 430–490、§11 存储 781–864、附录 B 关键参数 1189–1212。

你的角色是「验收判据」：只把目标转成可复验的判据，不讨论实现。每条判据写全**四要素：判据内容 / 检查方式（命令 / 字节比对 / 审计态）/ 通过阈值 / 失败退回动作**。阈值须**先给一次实测值再定**；无实测即标「待定，需用户拍板」，不得先定标准后补数据。禁止「性能良好」这类不可判定表述。产出分「可自动检查」与「须人工判断」两组。

【必须覆盖的七阶段】§17 给了 7 个阶段：① 阶段0 契约与骨架(1-2 周) ② 阶段1 核心闭环 MVP(3-4 周) ③ 阶段2 长时记忆与 ACT-R 激活(4-6 周) ④ 阶段3 巩固/遗忘/Chunking(4-6 周) ⑤ 阶段4 末那识核心特性(metacognition + user-model)(4-6 周) ⑥ 阶段5 UI 与集成(4-6 周) ⑦ 阶段6 评估与优化(持续)。
**注意：§17 每阶段只写了「要做什么」，没有一条验收判据、没有检查命令、没有退回动作——这正是缺口。**

【本机已实测的可用前提（你要用来写具体命令，不要凭空写）】
· Node v22.22.0；`node:sqlite` 可用（DatabaseSync / StatementSync / backup）。
· Ollama :11434 在跑，bge-m3:latest 在本机；向量档位可在设置里看到。
· 插件工程样板 D:\lk\FF\dsh-plugin-roundtable：它有 `npm run typecheck`（tsc --noEmit）、`npm test`（node --test）、`npm run build`（tsdown）。**阶段0 的「CI：typecheck + vitest + plugin-shape 校验」在本机对应什么命令，请按这个真实样板给**（方案说用 Vitest，但样板用的是 node:test——请如实指出并给二选一的口径）。

【请特别处理这几条（方案 §13.2 给了目标值，但都没给实测基线）】
· 记忆命中率 > 85%、遗忘曲线拟合度 R² > 0.8、检索延迟 < 500ms、任务完成率 > 80%、JEV 降级率 < 5%、缓存命中率 > 40%、用户模型精度 > 75%。
这些数字**当前一个都没有实测支撑**。请对每一条给出：① 用什么命令/脚本产出这个数（要具体到「读哪张表、跑什么 SQL、或读哪个日志字段」）；② 首次实测该在哪个阶段做；③ 在拿到实测值之前，该数字是先按方案的 85% 挂着，还是标「待定」。**方案 §6.1 还写了三条门控的失败策略（Write fail-open / Recall fail-degraded / Injection fail-closed），这三条各自「怎么验证它真的按预期失败了」是很好的判据素材，请一并落成判据。**
· §6.1 的两条不变式 I1（每 session/turn 最多注入一个记忆块）、I2（每条记忆每 session 最多注入一次）——这是**可自动检查**的（数日志/数表），请给出具体判据与检查命令形态。
· §6.3 明写「物理删除永不发生，删除始终是 retired=true 且可逆」——这是可字节比对的硬判据（删后行还在、retrieved 可恢复），请落成判据。
· §8.2 的激活值四区间归档策略（A>τ+1.0 / τ<A≤τ+1.0 / τ-0.5<A≤τ / A≤τ-0.5）与 90 天压缩——判据要能区分「真的归档了」还是「只是打了个标记」。

【交付格式】判据表，分两组（可自动检查 / 须人工判断），按阶段编号。每条四要素齐备，缺一即标注缺哪个。每条判据的检查方式必须是**可复制执行的命令**或**确定性比对**，写成能直接粘进 PowerShell 的形式。给不出实测基线的数字一律标「待定，需用户拍板」而不是直接采纳方案里的数字。结尾须有 [核心产出] 与 [下一步建议]；需用户拍板的用 [建议决策] 行：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。

【边界纪律】本轮只读，禁止改任何既有插件代码与配置、禁止安装、禁止建库。你可以写临时脚本到 $env:TEMP 做只读探测，但不要碰 D:\Mana 之外的数据。

**captain → rollout** · 2026-09-24 03:34:44

【R1 · 工作项 r1-rollout】主题：分期时间线骨架（只读）。

背景：用户的原话是「根据项目方案整理落地方案，阶段性每个阶段要有实施方案以及验收方案，尽量做细节」。你负责**分期骨架**这一半——把阶段排成可执行时间线，不重新论证方案。方案在 D:/Mana/docs/mana-v5-plan.md（1241 行）；我已缓存目录级摘要，按需读指定行段取证：§17 路线图 1098–1148、§9.1 插件清单 586–604、§10 多 Agent 开发 731–777、§15 技术决策 986–1077。

你的角色是「分期落地」：按「先跑通再优化」切分阶段，每阶段给交付物、验收判据、预计阻塞点、回滚方式；标出阶段之间的**硬依赖与可并行部分**。禁止把大改造塞进一步；每阶段必须**可独立验证**。产出分期表 + 里程碑。

【必须处理的现实约束（我已实测，请以此为准，不要照抄方案的理想值）】
1) 方案 §17 给的工期是「1-2 周 / 3-4 周 / 4-6 周…」，总计 20-34 周。**但这是「人类团队」口径。本项目的实际执行者是 agent（多席并行、单席可长时间连续跑）**。请给**两套口径**并说明差异：① 人类团队口径（保留方案原值但标注为「人类等价工期」）② agent 并行口径（按「几次可验证的会话」而非周来切）。不要直接砍掉原值，也不要假装两者一样。
2) 方案 §10.2 的并行流程是「先冻结契约 1-2 周 → jev+vector 并行 → 认知 Agent 并行」，但 §10.4 同时要求「services 之间靠事件通信不直接 import」。请核这条并行流程在**契约未冻结就无法开工**这一点上的真实瓶颈，并指出哪几个阶段其实**可以提前并行**（这是压缩总工期的唯一杠杆）。
3) 阶段 0 的交付物「monorepo 和所有 13 个插件目录 + 空骨架 + CI」——请判断：13 个插件**全部**在阶段 0 就建骨架是否必要，还是按 P0/P1/P2 分批建（方案 §9.1 已标了优先级）。给出你的切法。
4) 本机现状：`D:\Mana` 目录**目前是空的**（只有我放进去的 docs/mana-v5-plan.md）；本机没有 monorepo，没有 CI（无 GitHub Actions 配置）；工程样板是 `D:\lk\FF\dsh-plugin-roundtable`（独立仓库式，不是 monorepo）。**请明确阶段 0 到底建 monorepo 还是建一串独立仓库**——这是个真实的岔路，两条都给出优缺点与推荐。
5) 阶段 5「UI 与集成」里的「多设备同步」——方案没有给任何设计（§17 只写了五个字）。请判断它该独立成阶段、推迟到阶段 6 之后、还是**明确移出范围**（这符合用户「拒冗余限制、根部解决」的偏好）。给结论与理由。
6) 每阶段的**回滚方式**要具体到「回滚什么、怎么确认回滚成功」（例：卸载某个插件后，用什么命令确认它没有再往总线发事件）。方案 §12.1 说 Cordis 有 effect 回滚——请把这条落成每阶段可用的回滚动作。

【可参考的本机能力（写回滚/验证命令时可用）】本会话装有 dsh-super-injector：有 `dev_inject_plugin`（注入）、`dev_uninject_plugin`（卸载即净）、`dev_reload_package`（热重载）、`dev_plugin_status`（列当前装配）、`dev_self_test`（全链路自测）。这意味**插件可以在不重启 DSH 的前提下注入/卸载并即时验证**，这会显著改变阶段划分方式（每阶段可独立验证的粒度可以更细）。请在分期表里用上这条能力。

【交付格式】分期表（阶段 / 交付物 / 硬依赖 / 可并行项 / 预计阻塞点 / 回滚方式 / agent 口径的验证点）+ 里程碑。每条关键判断附来源（方案行号或本机命令输出）。给不出即标「未验证」。结尾须有 [核心产出] 与 [下一步建议]；需用户拍板的用 [建议决策] 行：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。

【边界纪律】本轮只读，禁止改任何既有插件代码与配置、禁止安装、禁止建库、禁止在 D:\Mana 下新建工程文件（本轮只产出规划文本）。

**scenario → 汇聚网关** · 2026-09-24 03:36:22

[当前状态] R1 工作项 r1-scenario 完成（只读）。已实测取证：node v22.22.0 / `node:sqlite` 可用；`vec0` 模块**不存在**；`fts5` 存在但**默认分词对中文 0 命中**；`sqlite-vec` 未安装；Ollama :11434 在跑且 `bge-m3:latest` 在（另有 qwen3.5 系列）；TZ=China Standard Time，ANSI 代码页 **936**；`$DSH_HOME=C:\Users\lk\.dsh`，`mana.db` **不存在**；web profile 有 shoucang/roundtable 等，desktop/headless profile **没有** shoucang。

[核心产出]

## 一、实测取证（命令与输出，供其他席复算）
| 项 | 命令 | 输出 |
|---|---|---|
| node:sqlite | `node -e "const{DatabaseSync}=require('node:sqlite');..."` | `node:sqlite OK v22.22.0` |
| vec0 | `create virtual table v using vec0(a float[3])` | `vec0 MISSING: no such module: vec0` |
| fts5 | `create virtual table f using fts5(a)` | `fts5 OK` |
| **FTS5 中文** | `insert "…降级路径…"` → `where f match '降级'` | **`hits 0`**；改 `tokenize='trigram'` 后 `'降级路径' → 1` |
| sqlite-vec | `require.resolve('sqlite-vec')` | `sqlite-vec not installed` |
| 暴力余弦成本 | 1024 维 × 20k 行，进程内 | 56 ms（2.8 ms/千行） |
| 时区/编码 | `Get-TimeZone` / `Nls\CodePage.ACP` | `China Standard Time` / `936` |
| 可复用件 | `web\node_modules\dsh-shoucang-memory\lib\vec.js` | 存在；本地缺省 `127.0.0.1:11434/v1`，冷启动 2.2s/批量冷 3.2s（vec.js:7,261-264） |
| mana.db | `Get-ChildItem -Recurse -Filter mana.db` | 无 |

## 二、场景清单（按「会掩盖其他问题 / 让失败不可观测」优先，再按发生概率）
> 列义：场景 / 触发 / 期望结果 / 方案是否覆盖（行号）/ 该在哪个阶段补。

**A 类：会掩盖其他问题、让失败不可观测（必须现在补，不补则后续阶段全部验收失真）**

1. **中文词法降级静默归零** / 触发：向量路失败，降级到 FTS5 关键词（§12.2 行 892「sqlite-vec 查询→关键词 FTS5」）/ 期望：能召回相关记忆 / **覆盖=否，且非"降级"而是"归零"**：实测默认 unicode61 对中文 `match '降级'` 返回 0 行，与「库里没有这条记忆」**不可分辨** / 补：阶段 1（vector 落地前，先钉 tokenize）/ 位置：§12.2 行 892、§15.7 行 1058。
2. **降级率指标自身造假** / 触发：JEV 降级率目标 `<5%`（§13.2 行 946）与缓存命中率 `>40%`（行 947）以何为分母未定义 / 期望：指标可判定 / 覆盖=否：`jev_log` 表（§11.2 行 851-863）有 `cached/degraded/latency_ms` 字段但**无任何行定义"未命中且未降级"的基线**，分母缺失时该指标恒真 / 补：阶段 1（jev_log 落库时必须同写分母）/ 位置：§11.2 行 851-863、§13.2 行 946-947。
3. **注入不变式 I1/I2 被"日志 reset"掩盖** / 触发：§6.1 行 444「注入块离开上下文后 ID 重新可注入（日志记录 `reset`）」/ 期望：每(session,turn)≤1 块（行 442）、每条每 session 只注入一次（行 443）/ 覆盖=部分：**无 reset 计数的验收口径**；若 reset 逻辑过宽，I1/I2 退化为"每 turn 都注入"，而表面统计（注入总量）看不出异常——同 turn 重复注入会被总量吞掉 / 补：阶段 1（I1/I2 需按 (session,turn) 分组的断言，而非总量）/ 位置：§6.1 行 442-444。
4. **"不注入"与"没记忆可用"不可分辨** / 触发：Injection Gate fail-closed（行 438「不注入任何内容（沉默优于噪音）」）与库空/检索失败走同一分支 / 期望：能区分三种沉默 / 覆盖=否：方案未定义 `supply=0 / candidate=0 / gate 拒绝` 的区分计数（本机 shoucang 已有同类"零命中提示行"事故，ACT-348）/ 补：阶段 1。

**B 类：正常路径（必然发生，决定可用性）**

5. **单会话写入→召回** / 触发：用户在一次会话里说"记住：…"，随后追问 / 期望：同一会话内召回并注入 / 覆盖=是（§8 编码、§7 检索）/ 补：阶段 1 首验。
6. **跨会话召回（第二天回来）** / 触发：新 session 首次 pre-step / 期望：注入昨天那条 / 覆盖=是（§12.3 行 904「插件重启后从 mana_trace 回放」）/ 位置：§6.1 行 438、§12.3 行 904。
7. **长任务目标栈调度** / 触发：多步任务、子目标压栈（§5.4 行 406）/ 期望：栈序稳定、无重复执行 / 覆盖=是（§12.3 行 903 幂等）/ 补：阶段 1。
8. **每日巩固（方案写凌晨 3 点）** / 触发：§8.1 行 549「每日定时（凌晨 3 点）」/ 期望：完成批量摘要与抽象 / **覆盖=否（关键缺口）**：本机是**笔记本 + 单机 DSH**，03:00 合盖休眠→开机后是"漏跑"还是"补跑风暴"未定义；且方案未写触发用**本地墙钟**还是 UTC / 补：阶段 3（巩固插件落地前定触发语义）/ 位置：§8.1 行 549。

**C 类：边界路径（特定环境/数据量才出现）**

9. **Ollama 停机 → 嵌入降级** / 触发：每次开机后 Ollama 未起、或 8GB 显存被占 / 期望：走 §12.2 行 893 降级链 / **覆盖=否**：降级链终点「关键词匹配」正是场景 1 的 0 命中；且向量库本身（BLOB + 暴力扫描，见 10）无降级 / 补：阶段 1。
10. **数据量 1 万 / 10 万条** / 触发：日均写入累积 / 期望：检索延迟 `<500ms`（§13.2 行 936）/ **覆盖=否**：实测进程内暴力余弦 20k×1024 维 = 56ms，10 万条 ≈ 280ms（**仅余弦本身**，未含读 BLOB + JSON 解析 + RRF + JEV），实际必然越 500ms；而 `vec0` 实测**不存在**、`sqlite-vec` **未安装**，方案 §15.5/§13 所假定的 ANN 索引没有落地物 / 补：**阶段 1 必须先在 `vector` 插件里定"扩展不可用时怎么办"**，否则阶段 2 的 ACT-R 激活会把全表扫描放大 / 位置：§11.2 行 809（`vector BLOB`）、§15.5 行 1034-1042。
11. **中文路径 + GBK 936 环境** / 触发：`$DSH_HOME\memory\mana.db` 本身无中文，但**用户工作区路径含中文**（`D:\Mana`、记忆库 `C:\Users\lk\.dsh\suite\memory`）/ 期望：读写不因编码失败 / **覆盖=否**：方案全文未出现 encoding/`utf8` 字样（`grep 编码` 仅命中"编码"一词的 §8 语境，无落盘编码约定）；本机 ACP=936，Node 默认 UTF-8 写、PowerShell 5.1 默认 GBK 读，审计日志/导出一旦经 shell 处理即乱码风险 / 补：阶段 0（契约层定"全文本 UTF-8 无 BOM"）/ 位置：§11.3 行 866-870、§12.4 行 910。
12. **工作记忆 4 组块塞满** / 触发：行 1189-1199「工作记忆容量 4 组块」，多工具并行会话 / 期望：§14 行 978「自动摘要 + 外挂到 TODO」/ **覆盖=部分**：容量单位（组块=几条记忆？按字符还是按语义）未定义，`maxFocusItems: 4`（§9.4 行 687）是**计数**，与"4 组块容量限制"是两个口径——超限时"溢出到 TODO"没有验收判据 / 补：阶段 1。
13. **时钟跳变 / 跨时区** / 触发：笔记本休眠跨天、

…（已截断，原长 8244 字符）

**rollout → 汇聚网关** · 2026-09-24 03:36:26

[当前状态] R1 工作项 r1-rollout 完成。只读，未改动 D:\Mana 下任何文件，未安装、未建库。所有钉点均本机实测，方案自述仅作对照。

## 0. 先给「会让失败不可观测」的缺陷（按总纲排序口径）

| # | 缺陷 | 位置/实测 | 危害 |
|---|---|---|---|
| D1 | **sqlite-vec 的加载窗口在开库瞬间就关闭了** | 实测：`new DatabaseSync(':memory:')` 后 `enableLoadExtension(true)` → `Cannot enable extension loading because it was disabled at database creation`；只有 `new DatabaseSync(p,{allowExtension:true})` 才 OK。方案 §16 行1087「sqlite-vec 零基础设施，社区已验证」未提此约束 | 按最自然写法建库后**永远**加载不了 vec0，且**不报错**——错误只在显式 enable 时暴露。必须先开库后补=只能删库重建 |
| D2 | **装配清单 ≠ 生效；空壳与真插件在面板上同形** | 方案 §12.1 行885 只给「插件卸载时自动清理」；`dev_plugin_status` 是机制自证（用户纪律：心跳/端口/文件增长皆机制自证） | 13 个空骨架全装配起来，面板全绿而零行为。S0/S1 会整段假绿 |
| D3 | **卸载 ≠ 数据回滚；且回放会复活旧状态** | §12.4 行911「物理删除永不发生」+ §12.3 行904「插件重启后从 mana_trace 回放」 | 卸载插件后 DB 行仍在；再注入即回放旧 trace。执行者以为「卸载即回滚」→ 回滚失败不可观测 |
| D4 | **契约一次性全冻是伪瓶颈，但灰度冻结会掩盖漂移** | §10.2 行754「冻结契约(1–2周)」→ §10.3 行767 七步变更流程。core 加临时字段不走 PR 即漂移 | 契约漂移在类型层看不出来（声明合并是开放的） |
| D5 | node:sqlite 是 experimental | 实测 stderr：`(node:13904) ExperimentalWarning: SQLite is an experimental feature and might change at any time`；§16 行1086 写「零外部依赖」（成立）但没写「API 可能变」 | 换 Node 版本静默改行为 |
| D6 | 测试栈方案与样板不一致 | §16 行1091「Vitest，DSH生态标准」；实测样板 `D:\lk\FF\dsh-plugin-roundtable` devDeps **vitest ABSENT**，实际 `"test": "node --test \"test/*.test.mjs\""` | 阶段0按方案装 vitest = 引入样板没有的依赖面 |
| D7 | §17 说「直接复用 sqlite-vec」，但本机真实可复用件不是它 | 实测 `dsh-shoucang-memory@0.3.1` 的 `lib/vec.js`：`recallRanked` 走 **jsonl 缓存 + `cosine()` + RRF k=60**（读注册表 `SURFACE.fusion.k`），**无 vec0 虚拟表** | 按 §17 字面执行会去复用不存在的东西 |

另：主持人给的口径「总计 20–34 周」与 §17 行1100–1140 算术不符——下限 1+3+4+4+4+4=**20**，上限 2+4+6+6+6+6=**30**。34 无来源。下文按 20–30。

## 1. 两套工期口径（不砍原值，不假装相等）

人类口径保留 §17 原值，标注「人类等价工期」。agent 口径**不用周**，用「批次 B」= 一次可独立验证的 agent 会话段（含交付物/判据/阻塞/回滚/下一批入口 五要素）。批次可数，**不估时**——真实墙钟 = 单席连续可跑时长 × 批次数，本机未实测，不给数。

| 方案阶段 | 人类等价 | agent 批次 | 关键路径? |
|---|---|---|---|
| §17 阶段0 行1100 | 1–2 周 | B0.1 B0.2 B0.3（3） | ✅ |
| §17 阶段1 行1107 | 3–4 周 | B1.0 B1.1∥B1.2 B2.1 B2.2（4） | ✅ |
| §17 阶段2 行1114 | 4–6 周 | B3.1 B3.2（2） | ✅ |
| §17 阶段3 行1122 | 4–6 周 | B4.1 B4.2（2） | ✅ |
| §17 阶段4 行1129 | 4–6 周 | B5.1 B5.2（2） | ❌ 可并行 |
| §17 阶段5 行1135 | 4–6 周 | B6.1 B6.2（2） | ❌ 可并行 |
| §17 阶段6 行1142 | 持续 | B7.1 B7.2（2） | ✅ 收口 |

合计 20–30 周 ↔ **17 批次，其中关键路径 11 批次**。差异来源：人类口径把 §10.2 的「三步走」当串行，agent 口径把 B5/B6 与 scheduler 拉起并行。

## 2. §10.2 顺序的真实瓶颈（主持人的第 2 问）

瓶颈**不是**「契约必须有人写」，而是「§10.2 把契约当成一次性全冻结物」。核 §10.4 行774：「services 之间通过事件通信，不直接 import 实现」——这条恰恰**证明灰度冻结可行**：只要 core 的事件类型是声明合并，新增事件不破坏既有订阅者，就无需等全冻。

**可以提前并行的（唯一压缩杠杆）：**
- `perception` / `working-memory` / `scheduler` — 只依赖 core（§9.1 行593/595/597 依赖列）
- `dsh-mana-metacognition` / `dsh-mana-user-model` — 只依赖 core（行600/601）→ **阶段4 整段可提前到 S1 后并行**
- `dsh-mana-ui` — 只依赖 core（行602）→ 可提前，但需契约稳定，放 S2 后
- `vector` 与 `jev` 互不依赖（只需各自 core 子集）→ §10.2 第2步的并行是对的

**真串行的只有：** `attention`（依赖 jev，行594）→ `long-term`（依赖 jev+vector，行596）→ `consolidation`/`forgetting`（依赖 long-term，行598/599）。

⇒ 契约拆 v0.1（S1 五类：observation/attention/decision/recall/injection）/ v0.2（long-term 增补）/ v0.3（巩固遗忘增补）。

## 3. 阶段0：13 个骨架不要一次全建

切法按 §9.1 行588–602 自带优先级：
- **S0 建 P0 六个**：core / jev / vector / perception / attention / working-memory
- **P1 四个**（long-term/scheduler/consolidation/forgetting）在 B2.2 开工时建
- **P2 三个**（metacognition/user-model/ui）在 B5.1 开工时建

理由（排序口径）：13 个空壳同批装配后，D2 成立——面板上分不出哪几个真有行为，后续每一批的失败都被 13 项等权清单稀释。且每个空骨架都是一份要维护的 package.json/cordis.patch.yml，是纯噪声面。

## 4. 岔路：monorepo vs 独立仓库（主持人的第 4 问）

实测事实：`D:\Mana` 只有 `.roundtable/` 与 `docs/`，**无 .git**（`git status` → `fatal: not a git repository`）；样板 `D:\lk\FF\dsh-plugin-roundtable` 是独立仓库式（自带 .git），但**同时存在 package-lock.json + pnpm-lock.yaml + pnpm-workspace.yaml**（三锁并存）；**本机 `pnpm -v` → CommandNotFound**，`npm` 可用（`npm view sqlite-vec version` → 0.1.9）。

| 方案 | 优点 | 缺点 |
|---|---|---|
| A 单仓库 npm workspaces（推荐） | core 契约被 12 包共享，`file:` 依赖是 workspaces 原生能力；一份 CI、一份 tsconfig.base；**node_modules 不复制 13 份**（用户对磁盘占用敏感） | 偏离样板形态；需自建 workspace 根 |
| B 13 个独立仓库 | 贴样板、可单独发布 | core 要被 12 处引用需 link/registry，本机零基础设施做不到；13 份 CI+tsconfig 漂移面；13× 

…（已截断，原长 9270 字符）

**arch → 汇聚网关** · 2026-09-24 03:36:40

[当前状态] R1·r1-arch 完成，只读取证完毕。读段：§4(243–325)、§5(331–427)、§6–8(430–582)、§9(584–727)、§10(731–777)、§11–12(781–911)、§15–17(986–1148)。本机复核：`node -e "require('node:sqlite')"` → DatabaseSync/StatementSync/constants/backup 均可用；`Get-ChildItem C:\Users\lk\.dsh,D:\lk -Recurse -Directory -Filter sqlite-vec` → 零命中；`~\.dsh\profiles\web\node_modules` 内非 @deepseek-ai 的 dsh-* 目录 = 0，第三方只有 dsh-shoucang-memory v0.3.1（含 lib/vec.js，纯 JS 余弦+RRF）。

一、5 个必答结构问题的速答（附行号）

1) **切分过度：是，但判据不是包数，是变更面跨度。** 三条真实流：
 · Flow A（一条用户消息→落库）：perception →`mana/observation`(647)→ attention →`emit mana/jev/judge`(693)→ jev 判定 →`mana/jev/judged`(657)→ attention →`mana/focus`(650)→ working-memory →`mana/working-memory/update`(651)→ scheduler → `mem_remember`(467) Write Gate(436) → long-term 落 `memory_items`(790) → vector 嵌入。**7 个包 / 7 次事件往返**。
 · Flow B（下轮召回注入）：`mem_recall`(468) Recall Gate(437) → 三路并行检索(§7.1:499–503) → RRF(503) → 时间衰减(505) → JEV `rel_<id>` fan-out，候选 Top-50(§6.4:482) → working-memory 组装(595) → jev Injection Gate 尾部追加(438,446)。**5 个包 + N≤50 次判定**。
 · Flow C（定时巩固/遗忘）：consolidation(548–552) → long-term 强化/合并 → forgetting 按 A 归档(570–576) → vector 重建索引。**4 个包 / 链深 3 层**。
 事件往返在 Cordis 里是进程内函数调用，无网络、无序列化 ⇒ **这不是延迟问题，13 个包不能按性能理由判过度**。按「改一处动几个文件」度量：加一个记忆字段 = core(类型/schema) + long-term(SQL+编码) + vector(是否入嵌入文本) + consolidation(合并规则) + forgetting(衰减规则) + ui(面板) = **6 包**；改 JEV 阈值语义 = core(config) + jev(三道门) + attention(686–688 配置、698 调用) + long-term(0.5 重排) + consolidation(0.5 触发) = **5 包**。且类型安全全靠 declaration merging，而 §9.2:619 要求每个插件自带 `event-types.ts` ⇒ 声明一旦分散到 13 个文件，编译期护栏失效，错误推迟到运行期。**判定：过度，最小改法见成因 E。**

2) **依赖方向：声明表无环，方向问题在反方向。** §9.1(588–602) 最深链为 core → jev/vector → long-term → consolidation/forgetting（3 层）。§10.4:774「services 之间通过事件通信，不直接 import 实现」是否被违反**无法判定（未验证，本机无这些插件源码）**。但有一处结构性方向含糊：§9.4:679 `inject = ['mana-core','mana-jev']` 与同段 692–709 用事件请求 JEV **并存** ⇒ 同一对模块同时存在「服务注入」和「事件」两条通道，谁权威未定。真正的方向缺陷是：**forgetting/consolidation 挂在 long-term 之下，它们本应是 long-term 的维护者而非依赖者**（见成因 A）。

3) **状态归属：三处全撞车**（并入成因 A/B/C）：mana_trace 与 memory_items 双权威；激活值/强度的写者未指定；`memory_items.vector BLOB`(809) 与 sqlite-vec vec0 两份向量。

4) **示例是否违反 next() 纪律：没有违反 —— 因为 §9.4 根本没注册任何 waterfall 监听器，也从未用 waterfall 派发。** 真问题比"自定规矩没守"更重：契约里唯一的 waterfall 事件 `mana/jev/judge`(656，签名带 next) 被示例 **用 `emit` 调用**(693)，而按方案自述 emit「不等待、不收集返回值」(632) ⇒ 判定结果**结构上无法从该路径返回**，只能靠旁路事件 `mana/jev/judged`(657→703) 带回；且关联键不一致：请求用 `id`(694)，结果用 `requestId`(707) + 字符串过滤 `source`(704)。⇒ 声明的 continuation 无生产者，是**死契约**；将来谁把观察型监听器挂到 656 上而不调 next()，下游默认行为会被静默吞掉，640 行的纪律就只活在文档里。

5) **演进余地：冲突，"直接复用"是结构性的，"自建 13 插件"是成本项。** §15.3(1010–1021) 声称可直接复用的 5 个插件本机实测 **0 个存在**；§15.7:1058「sqlite-vec 已实现 recall_hybrid」在本机**无载体**（无 sqlite-vec）；而 shoucang 单包已用 1 行 patch 承载「向量+词法+RRF+降级」整链 ⇒ **只能做薄适配层**，不能重造检索链。

二、成因清单（已做根因归并，按「掩盖问题/让失败不可观测」优先排序）

**A｜成因：依赖深度 = 卸载爆炸半径，且链条末端是唯一抑制项，停摆无观测面。**
 症状：① §4:289 明写 Cordis「提供方卸载 → 依赖方自动卸载」（不报错）；② 由 §9.1 得 vector 抖动 ⇒ long-term 卸载 ⇒ **consolidation 与 forgetting 一起卸载**；③ forgetting 是 §14:979「记忆爆炸」的唯一抑制机制，它停摆后 §11.2 无任何字段能证明"它没跑"（无 last_run / 无 inactive 原因），§12.1:878–885 的六层可靠性里也没有"卸载审计"这一层；④ §4:245–287 的图把所有插件画成同层，把 3 层深度与爆炸半径**视觉掩盖**了。
 最小改法：forgetting 的 inject 收敛为 `['mana-core']`（只消费事件，不注入服务）；consolidation 对 long-term 改为 `ctx.get` 可选依赖 + 缺失即 no-op；任一插件因依赖缺失未运行时必须写 `mana_trace`(844) 一条 `{event_type:'mana/plugin/inactive', payload:{id,missing,at}}`；验收判据从"插件在跑"改为"最近 N 分钟内无 inactive 记录"。**落脚：阶段 0 定约，阶段 3 首验。**

**B｜成因：契约无单一权威（两条法定来源 + 三套命名 + 死契约 + 关联键不统一）。**
 症状：§9.1 说 core 拥有「事件类型、数据模型」，§9.2:619 又让每个插件自带 event-types.ts；§4:260–261 用通配域 `mana/jev/*`，§9.3:644–667 用精确名，§9.4:692 监听精确名；656/693 的 waterfall-vs-emit 不兼容；694 vs 704/707 关联键不一致；同名三形态（包 id `dsh-mana-attention` / `name='mana-attention'`(678) / inject 服务名(679)）无映射表。
 最小改法：core 独占 `Events` 接口与领域模型，其余插件**禁止**自建 event-types.ts（删 §9.2:619 该行）；judge 结果走 waterfall 返回值，`mana/jev/judged` 若保留必须明写为"审计事件、非返回通道"；关联键统一 `requestId`；出一张 包id↔name↔服务名 映射表。度量：改一个事件签名，现状 ≥3 文件/包，改后 1 文件 + 编译期全量报错。**落脚：阶段 0。**

**C｜成因：派生量无唯一写者（同一物理量多套公式、多处落库、双写者）。**
 症状：① 时间衰

…（已截断，原长 6497 字符）

**captain → 汇聚网关** · 2026-09-24 03:38:14

[当前状态] 主持人在等待 impl / accept / reuse 三席回报期间，亲自跑了一条只读探测（临时库建在 $env:TEMP 并已删除；未碰既有插件、未建 mana.db、未改 settings.yaml），为的是判定「方案 §11.2 的表结构 + §16 的 node:sqlite 选型」能不能真落地——这条是全部七个阶段的地基。

## 主持人实测（Windows 本机，Node v22.22.0，命令可复算）

**A. 扩展加载窗口（决定 sqlite-vec 能不能上）**
· `new DatabaseSync(f)` 之后再 `enableLoadExtension(true)` → 报错原文：`Cannot enable extension loading because it was disabled at database creation.`
· `new DatabaseSync(f, { allowExtension: true })` → 开库成功，`enableLoadExtension(true)` 成功。
· 此时 `db.loadExtension('C:/nonexistent.dll')` → 报错原文：`找不到指定的模块。`
  **判读**：这不是「不允许加载扩展」，而是「DLL 找不到」⇒ **node:sqlite 的 loadExtension 通道在本机是通的**，换 `better-sqlite3` 不是必需动作；但**唯一的开库窗口在 `new DatabaseSync()` 那一瞬**，一旦写成 `new DatabaseSync(path)` 再想开扩展就永久失败——这是必须写进契约的一条硬约束，也是方案 §16 行1087 完全没提的坑。
· `typeof db.loadExtension === 'function'`：成立。

**B. 事务 / WAL 真实语义（决定 §12.3「SQLite 事务 + WAL 防并发写入」）**
· `db.exec('PRAGMA journal_mode=WAL')` 返回值：`undefined`（**拿不到结果**）。
· `db.prepare('PRAGMA journal_mode=WAL').get()` 返回：`{"journal_mode":"memory"}`（`:memory:` 库的真实值）。
  **判读**：读 pragma 结果必须走 `prepare().get()`，`exec()` 是静默的 ⇒ 任何「用 exec 读回 WAL 是否生效」的验收脚本都会**恒判通过**（拿到 undefined，误当成功）。这正是用户最在意的「让失败不可观测」类缺陷。
· `BEGIN/COMMIT` 走 `exec` 成功；**`db.transaction` 不存在**（`undefined`）⇒ 没有 better-sqlite3 那种事务包装器，事务要自己写。
· `stmt.run()` 返回 `{"lastInsertRowid":1,"changes":1}` ⇒ **返回的是主键 + 影响行数，不是结果头**。
· `stmt.all()` 返回 `[{"a":"hello"}]`（对象数组）。

**C. FTS5 中文分词（决定 §7.1「关键词检索 FTS5 BM25」能不能用）**
· 默认分词器：`CREATE VIRTUAL TABLE t1 USING fts5(c)` + 插入 `末那识的认知架构模拟` → `MATCH '末那识'` 命中数 **0**。
· `tokenize='trigram'`：同样数据 → 命中数 **1**。
  **判读**：中文环境（本机 ANSI 代码页 936）下，方案 §7.1 的 FTS5 这一路**开箱即静默归零**：0 命中与「库里本来没有」**完全不可分辨**。这与会话中另一席独立报出的结论一致。⇒ BM25 这一路必须显式指定分词器 + 必须有一条「非空查询返回 0 命中即为故障」的判据，否则整路检索静默失效而验收显示全绿。

## 这三条对落地方案的影响（不是新方案，是给已有阶段加护栏）
1. 阶段 0 的契约层必须写死：**所有库句柄一律 `{allowExtension:true}` 开库**（否则阶段 2 想上 vec0 时要重写开库点，属返工）。
2. 一切「读回状态」的验收命令禁止用 `exec`；WAL 生效必须用 `prepare(...).get()` 取回 `journal_mode` 并与 `wal` 做**字符串比对**。
3. FTS5 建表必须显式 `tokenize=`，且验收要有一条负向判据：「已知在库的中文串必须命中 ≥1」。

[核心产出] 三条可复算的一手证据（A 扩展窗口 / B pragma 静默 / C 中文分词静默归零），均已附报错原文与返回值。
[下一步建议] 请 verify 席在 R2 把这三条纳入核验表按原命令复跑；请 accept 席据此把 B、C 两条落成「负向判据」（要求返回非期望值时必须判失败，而非默认通过）。

**captain → verify** · 2026-09-24 03:38:44

【R1 补充 · 工作项 r1-verify（波次 2，提前下发核验范围）】你仍在波次 2 执行，但核验清单可以先行固定。请**按预注册判据自己重跑命令**，逐条裁「成立 / 部分成立 / 不可复现」，给证据强度（原文、行号、命令输出、字节数）。

【核验清单 —— 共 10 条待核结论】

以下 3 条是**主持人自证**（我亲自跑的，同样接受你的复核；有冲突以你的实跑为准）：
V1. node:sqlite 的扩展加载窗口：`new DatabaseSync(p)` 之后 `enableLoadExtension(true)` 必失败，报错原文 `Cannot enable extension loading because it was disabled at database creation.`；只有 `new DatabaseSync(p,{allowExtension:true})` 才能开扩展。
V2. `db.exec('PRAGMA journal_mode=WAL')` 返回 `undefined`（拿不到结果），读回必须走 `db.prepare('PRAGMA journal_mode=WAL').get()`；且 `db.transaction` 在 node:sqlite 上**不存在**（`undefined`）；`stmt.run()` 返回 `{lastInsertRowid, changes}`。
V3. FTS5 中文：默认分词器下 `MATCH '末那识'` 对中文串命中 **0**；`tokenize='trigram'` 下命中 **1**。

以下 7 条来自其他席（在会议记录中已发言，你读得到原文）：
V4. 【rollout 席 D1】sqlite-vec 在本机**零命中**（未安装），且方案 §16 行1087 未提「开库窗口」这条约束。
V5. 【rollout 席 D6】方案 §16 行1091 写「测试用 Vitest」，但样板 `D:\lk\FF\dsh-plugin-roundtable` 的 devDependencies 里**没有 vitest**，实际用的是 `node --test test/*.test.mjs`。
V6. 【rollout 席】`pnpm -v` 在本机**不可用**、`npm` 可用（方案 §16 却指定 pnpm）；`D:\Mana` 无 `.git`。
V7. 【scenario 席】本机 ANSI 代码页 **936**、TZ=China Standard Time；`$DSH_HOME=C:\Users\lk\.dsh`；`mana.db` **不存在**；web profile 有 shoucang，desktop/headless profile **没有** shoucang。
V8. 【arch 席】方案 §9.1 依赖表**无环**（最深 3 层），但 forgetting/consolidation 挂在 long-term 之下属**方向倒置**（维护者成了依赖者）。
V9. 【arch 席】§9.4 行693 用 `emit` 调用行656 声明的 waterfall 契约 `mana/jev/judge` ⇒ **死契约**（§9.4 从未注册 waterfall 监听器）。请核 §9.4 行691–710 是否真的没有 `ctx.waterfall(...)` 或等价的中间件注册。
V10.【arch 席】状态归属三处撞车：`mana_trace`(行844–849) 与 `memory_items` 双权威；激活值/强度写者未指定；`memory_items.vector BLOB`(行809) 与 §7 的 sqlite-vec 两份向量。**主持人已一手核对** 行809 与 §7 的矛盾**成立**，且 DDL 内**既无 vec0 虚表也无 fts5 虚表、无 WAL 相关语句**——请复核这句「DDL 缺项」是否成立。

【额外必核（若你有余力）】
V11. 方案 §13.2 的 7 个指标数值（记忆命中率>85%、遗忘曲线 R²>0.8、检索延迟<500ms、任务完成率>80%、JEV 降级率<5%、缓存命中率>40%、用户模型精度>75%）——请核**全仓/全文没有任何一处给出这些数字的实测基线**（即：它们是纯目标值，不是实测值）。这条决定 accept 席能否直接采纳这些阈值。

【方法要求】① 每条先写预注册判据（你在跑之前认为「什么算成立」），再跑，再裁；② 给不出证据的一律判「不可复现」，**不得凭合理性推断为成立**；③ 严格区分「命令跑通」与「结论成立」（接口返回成功 ≠ 结果真的达成）。

【边界纪律】只读；临时探测文件放 $env:TEMP 并清理；禁止改既有插件、禁止安装、禁止建 mana.db。

【交付格式】核验表（结论 / 裁定 / 证据 / 反例）。结尾须有 [核心产出] 与 [下一步建议]。

**reuse → 汇聚网关** · 2026-09-24 03:40:39

[当前状态] 三查完成（项目内实现 / 既有依赖栈能力 / 开源生态），全部结论已用工具实测取数，与主持人独立复核结果一致并新增 4 项关键发现。

## 一、本机存在性复核（逐包、给命令与输出）

搜索命令（一次 pwsh 全覆盖 5 个根，Depth 6）：
`Get-ChildItem -LiteralPath C:\Users\lk\.dsh | C:\Users\lk\.dsh-win | D:\lk | D:\FF | D:\Mana -Recurse -Depth 6 -Directory -Force -Filter <name>`

| 包 | 结果 |
|---|---|
| dsh-memory | **未找到** |
| dsh-hindsight-memory | **未找到** |
| dsh-graphmemory | **未找到** |
| dsh-memoria | **未找到** |
| dsh-memory-jev | **未找到** |
| sqlite-vec | **未找到** |

`C:\Users\lk\.dsh\profiles\web\node_modules` 根下全部 dsh-* 只有：`@dsh-external`、dsh-better-sidebar、dsh-client-auto-continue、dsh-edit-diff、dsh-free-search、dsh-plugin-roundtable、dsh-plugin-wallpaper-engine、dsh-prompt-enhancer、dsh-shoucang-memory、dshmarket。**与主持人判断一致，确认：§15.3 六个"可复用"包在本机一个都没装，只有 dsh-shoucang-memory。**

⚠ 新增钉点：`C:\Users\lk\.dsh\super-injector\registry.json` 内容为 `[{dir: D:\lk\FF\dsh-frozen-injection, name: @dsh-external/dsh-frozen-injection, at: 2026-09-17T20:37:25Z}]` —— 登记的唯一插件是「会话开头冻结注入」，**与 Mana 完全无关**。注意：它上面写的是 `@dsh-external/dsh-frozen-injection`，不是主持人转述的"无关插件"之外的任何记忆类包，核验通过。

## 二、候选用现表（来源 / 位置 / 许可 / 最近发版 / 不用理由）

### A. 本机实存、可搬走的资产

| # | 来源 | 位置 | 许可 | 最近发版 | 不用（直接搬）的理由 |
|---|---|---|---|---|---|
| A1 | dsh-shoucang-memory **v0.3.1** | `C:\Users\lk\.dsh\profiles\web\node_modules\dsh-shoucang-memory` | Apache-2.0（LICENSE 实测 11359B） | npm **E404 未发布**；GitHub Fishsb/dsh-shoucang-memory pushed 2026-09-23 | `"private": true` ⇒ 不可 npm 发布，只能 vendored copy；`lib/vec.js` import `./targets.js`，而 targets.js 按 `process.env.DSH_HOME \|\| MEMORY_ROOT` 解析知识根 ⇒ **不是独立模块，耦合本机记忆库目录布局** |
| A2 | dsh-plugin-roundtable v0.2.56 | `D:\lk\FF\dsh-plugin-roundtable` | MIT | npm **E404**（私有工程） | 它是**样板**不是运行时依赖；体量大（33 个 test、client 半区全）——新插件抄它不如抄 A3 |
| A3 | @dsh-external/dsh-frozen-injection v0.1.0 | `D:\lk\FF\dsh-frozen-injection` | BSD-3-Clause | 无发版（`dev_scaffold_plugin` 产物） | **不建议不用**：这是本机最小骨架的最优抄写对象（详 §四） |
| A4 | shoucang-panel / shoucang-scheduler | `D:\lk\FF\shoucang\plugins\*` | Apache-2.0 | 无发版（工程内） | 与 A1 同源、同为 private；只在需要"HTTP RPC 面板"或"调度器"形态时抄结构 |
| A5 | dsh-memcore | `D:\lk\deepseek\dsh-memcore` | 无 LICENSE 文件 | — | **无 package.json**，只有 `src/host.js` + `.mnemon/runtime/*.md`；**未验证**是否能作为插件加载，不建议作为样板 |

### A1 符号级清单（哪个文件导出了什么 → Mana 哪阶段可用 → 代价）

实测 `Select-String "^export "` 逐文件输出：

| 文件 | 导出符号（行号） | Mana 阶段 | 代价 |
|---|---|---|---|
| `lib/vec.js`（22915B） | `vecStats`(27) `cosine`(93) `clearVecCache`(107) `planVecCompaction`(145) `compactVecCache`(171) `semanticSim`(232) `embedMany`(246) `recallRanked`(289) | **阶段 1**（Agent-Vector：bge-m3 + 余弦 + RRF） | 缺省 `baseUrl = http://127.0.0.1:11434/v1`、`model='bge-m3'`、`fusionKind='rrf'`，`k` 读 `SURFACE.fusion.k ?? 60`（**不是硬编码**，注释第 17 行明写"原为硬编码 60"）；依赖 `./targets.js`、`./criteria.js`、`./criteria.generated.js`、`./event-envelope.js` 四件 |
| `lib/criteria.js`（13959B） | `CRITERIA_VERSION` `thresholdValue` `thresholdParam` `splitLawOf` `paramOf` `evaluateL0` `promoteVerdict` `demoteVerdict` `SURFACE_PARAMS` `activationOf` `maturationVerdict` `layeredScore` `importanceOf` | **阶段 4**（metacognition 置信度/阈值层） | 全部数值来自 `criteria.generated.js`（67017B，由 `criteria.json` 生成，regen 脚本 `scripts/gen-criteria.mjs`）⇒ 搬走必须连生成器与注册表一起搬，否则数值漂移不可追 |
| `lib/assertion-graph.js`（7737B） | `buildGraph`(5) `neighborsOf`(93) `nearPairs`(96) `adjudicatePairs`(134) `exactCrossFileDups`(175) | **阶段 2/3**（长时记忆关系图、去重） | 第 1 行 `import { cosine } from './vec.js'` ⇒ 与 A1-vec 强绑定 |
| `lib/record-store.js` | `KINDS`(13 类) `LIFECYCLES` `SUBJECT_OF_FILE` `INDEX_FILES` `parseRecords` `renderFile` `diffRecords` `upsertRecord` `moveLifecycle` `validateRecord` `inventoryOf` … | 阶段 0/2（数据模型） | 文件格式契约绑定 `MEMORY.md/USER.md/AGENT.md` 三索引布局 |
| `lib/recall-yield.js` | `SWITCH_THRESHOLD=2` `foldZeroGain` `shouldSwitchSource` `buildYieldRequest` `parseYieldJudgements` `switchFromJudgements` `tallyVerdictOf` `buildYieldVerdictEvent` | 阶段 2（召回收益判定） | 需 LLM 判官通道 |
| `lib/distill-embed.js`（1193B） | `createEmbedApi(dep)` | 阶段 1/2（嵌入注入点） | 极小，纯适配器 |
| `lib/audit-source.js` | `readD

…（已截断，原长 13470 字符）

**captain → verify** · 2026-09-24 03:41:31

【R1 补充 2 · 工作项 r1-verify】核验清单追加 4 条（来自 reuse 席，已由主持人独立复算一次，仍需你按预注册判据复核）。

V12.【reuse 席 · 最重要的一条反证】被方案 §15.3 标为「直接复用」的 `dsh-memory`，reuse 席 `npm pack` 解开后实测：包内仅 5 个文件，`grep "vec0|sqlite-vec|RRF|cosine|bm25"` **零命中**，README 自述为纯 FTS5 词法存储 ⇒ **与方案行 1015 描述的「sqlite-vec KNN 余弦 + FTS5 BM25 + 关键词三路 RRF 融合」不符**。请复核这条（可 `npm view dsh-memory` / `npm pack dsh-memory` 到 $env:TEMP 解开看文件数与内容，**用完删除，不要在 D:\Mana 或 profiles 下留任何东西**）。

V13. npm 存在性（主持人已复算一遍，口径如下，请你独立再跑一次比对是否一致）：
· `dsh-memory` → 存在 0.1.0 · `dsh-graphmemory` → 存在 0.2.0 · `dsh-memoria` → 存在 0.1.0
· `dsh-shoucang-memory` → **E404** · `dsh-hindsight-memory` → **E404** · `dsh-memory-jev` → **E404**
  **关键判读**：`dsh-shoucang-memory` 虽 npm E404 但**本机已装 v0.3.1**，属「私有/未发布件」——这意味着它**不能被 `npm i` 拉取**，只能从本机目录搬代码。请确认这个判读，并核它对「阶段 0 起手能不能直接依赖它」的影响。
· 特别注意 `dsh-memory-jev` 查无此物，而方案 §15.3 行1019 说它「直接复用」、§6 整节的三道门控设计（§6.1 行436 起）都标着「dsh-memory-jev 设计」为依据 ⇒ **三道门控的权威依据在公开侧不存在**。请核这条推论。

V14.【reuse 席】本机 `dsh-shoucang-memory` 的 `lib/` 共 107 个文件，`grep` 实测**无一使用 sqlite**（它的向量层是自己算 cosine 的内存/RRF，不是 sqlite-vec）。若成立，请明说：方案 §7.1 的「sqlite-vec 三路检索」**不能靠搬 shoucang 实现**，shoucang 只能供算法层（cosine/embedMany/recallRanked/criteria）。
V15.【reuse 席】bge-m3 端点实测返回 **1024 维**（可作阶段 1 探针基线）；起手样板建议抄 `D:\lk\FF\dsh-frozen-injection`（单文件 ~5KB、仅 peer cordis），需要 client 半区再抄 `dsh-plugin-roundtable` 的 tsdown 双 entry。

【裁定要求不变】逐条裁「成立 / 部分成立 / 不可复现」+ 证据强度；证据不足即判不可复现。V12/V13 是**本次会议里最可能改变阶段设计的两条**，请优先跑。

【边界提醒】npm pack 只允许解到 `$env:TEMP` 并自行清理；**禁止 `npm install` 到任何既有 profile**；禁止在 D:\Mana 下落任何东西。

**accept → 汇聚网关** · 2026-09-24 03:43:05

[当前状态] 只读探测完成（未改任何插件/配置，未建库）。9 个临时探针在 $env:TEMP\mana-accept-probe{1..10}.mjs，可复跑。以下每条阈值前都有一句本机实测；无实测者标「待定，需用户拍板」。**先给会掩盖问题的缺陷，再按阶段排。**

════ 一、先决阻断项（不先解决，后面判据全部不可观测）
B1｜**§17 阶段0「vitest」在本机不存在**：D:\lk\FF\dsh-plugin-roundtable\node_modules 无 vitest，样板用 node:test（32 个 test/*.test.mjs）。实测 `npm test`→exit 0，`# tests 365 / # pass 365 / # fail 0`，2.59 s。判据须二选一，否则 CI 定义空转。
B2｜**样板自身 typecheck 是红的**：`cd D:\lk\FF\dsh-plugin-roundtable; npm run typecheck`→exit **2**，7 条 error（src/members.ts ctx.subagents ×5 = TS2551、ContentBlock 导入 TS2614、dsh-subagent 无声明文件 TS7016），HEAD=a8c8bb7，非我造成（我跑前后 `git status --porcelain` 均 15 行不变）。⇒「类型检查零错」不能拿样板当基线，必须在新仓自测一次。
B3｜**§15.3「直接复用 dsh-memory / dsh-memory-jev / dsh-hindsight-memory / dsh-graphmemory / dsh-memoria」全部证伪**：在 `C:\Users\lk\.dsh\profiles`、`D:\lk\FF`、`D:\Mana`、`D:\lk` 深 5 层搜索，5 个包名 **NOT FOUND**；已装配的 dsh-* 只有 better-sidebar / client-auto-continue / edit-diff / free-search / plugin-roundtable / plugin-wallpaper-engine / prompt-enhancer / shoucang-memory。⇒ 凡判据写「复用 X」的一律退回改写。
B4｜**I1/I2 不可机检（方案自身 schema 缺列）**：§6.1（442–443 行）要求按 `(session,turn)` 计数，但 §11.2（790–863 行）6 张表**没有任何 session_id / turn_id 列**，mana_trace 仅 (seq,event_type,payload,timestamp)。⇒ I1/I2 现无可数之处，是「让失败不可观测」的典型。
B5｜**sqlite-vec 可用但必须走 prebuilt，且扩展加载有硬开关**：npm sqlite-vec@0.1.9 含 sqlite-vec-windows-x64@0.1.9（下载 143554 B，内含 vec0.dll 289280 B）。本机 **无 python/gcc/cl/cmake/pnpm**（逐个 Get-Command 均 MISSING）⇒ 只能 prebuilt，不可源码编译。实测 `new DatabaseSync(p)` 后 `enableLoadExtension(true)` **抛 ERR_INVALID_STATE「Cannot enable extension loading because it was disabled at database creation」**；必须 `new DatabaseSync(p,{allowExtension:true})` 才通过；加载成功 `vec_version()→v0.1.9`。
B6｜**FTS5 中文有两颗静默地雷**：① 默认 unicode61 对中文**完全 0 命中**且不报错（"认知架构"/"恒审思量"/"曼那识" 全 → 0）；② trigram 下 **2 字查询返回 `[]` 不报错**（"认知"→[]，"认知架构"→["mem-1"]）。词法通道的判据必须锁 tokenizer 与查询最小长度。

════ 二、A 组：可自动检查（判据 / 检查方式 / 阈值 / 退回动作）
**P0 阶段0（契约与骨架）**
A0-1 环境钉点一致｜`node -v` + `node -e "const s=require('node:sqlite');…"`｜实测 Node **v22.22.0**、sqlite **3.50.4**、backup=function。阈值：三项全等，硬等于。｜退回：停止阶段0，先报环境变更。
A0-2 sqlite-vec 可加载｜`node $TEMP\mana-accept-probe7.mjs`｜实测 loadExtension **OK**、vec_version **v0.1.9**、KNN 返回 3 行。阈值：exit 0 且含 `vec_version`。｜退回：阶段0 第 4 步（依赖面），改用物化 BLOB 暴力余弦（见 A2-4 实测 20.92 ms/10k 仍可用）。
A0-3 CJK 分词口径｜`node $TEMP\mana-accept-probe10.mjs`｜实测 trigram 4 字→命中、2 字→`[]`；默认分词器 0 命中。阈值：断言 `trigram 4字命中 ≥1` 且 `2字查询被显式拒绝（非静默空）`。｜退回：阶段0 契约冻结，把「查询 <3 字符即拒」写进接口。
A0-4 插件形状静态可证｜`node -e "const m=require('<pkg>/lib/index.js');…"` 断言 name/inject/Config/apply 齐；样板实测 index.js 有 `export const name / inject / Config / apply`。阈值：4 项齐全 + cordis.patch.yml 存在。｜退回：阶段0 骨架步骤。
A0-5 CI 绿（新仓自测）｜`npm run typecheck; echo $LASTEXITCODE` 与 `npm test`｜样板实测 test exit **0**（365/365）、typecheck exit **2**。阈值：新仓 typecheck=0 且 test 全绿——**不得引用样板作为绿基线**。｜退回：先修 B2 类错误再进阶段1。
A0-6 不碰墙的证据｜`cd D:\lk\FF\dsh-plugin-roundtable; git status --porcelain | Measure-Object -Line`｜我实测跑前跑后均 **15 行**（10 M + 5 ??），未增未减。阈值：阶段0 全程前后行数相等。｜退回：任何 >0 的漂移→回滚并写报告。

**P1 核心闭环 MVP**
A1-1 端到端事件流可追｜查 `SELECT seq,event_type FROM mana_trace ORDER BY seq` 断言 perception→attention→working-memory→scheduler→action 五类 event_type 各 ≥1 且 seq 递增无洞。阈值：5/5 类齐、`seq` 连续。｜退回：阶段1 接线步骤。
A1-2 I1（每 (session,turn) ≤1 注入块）｜`SELECT session_id,turn_id,count(*) c FROM <inject_log> GROUP BY 1,2 HAVING c>1` 期望 **0 行**。阈值：0 行。**前置：B4 未修则本判据不可执行，判「待定，需用户拍板」**。｜退回：阶段0 补列，未补前不得放行阶段1。
A1-3 I2（每条记忆每 session 最多注入一次）｜`SELECT session_id,memory_id,count(*) c FROM <inject_log> GROUP BY 1,2 HAVING c>1` 期望 0 行。同上待 B4。
A1-4 RRF 确定性｜固定 rank 输入核分：实测 k=60 时 ranks[1,1]=**0.032787**、[1,50]=**0.025484**、[50,50]=**0.018182**。阈值：`|diff| ≤ 1e-6`。｜退回：向量插件融合步骤。
A1-5 时间衰减确定性｜实测 h=14 时 decay(0)=**1.000000**、decay(14)=**0.500000**、decay(90)=**0.011609**。阈值：|diff| ≤ 1e-6。｜退回：排序步骤。
A1-6 注入块转义｜`node $TEMP\mana-accept-probe6.mjs`｜实测转义后 **内层 '<' = 0**（整块仅 2 个 wrapper 标签），不转义则内层 2 个。阈值：内层 '<' 计数 == 0。｜退回：Injection Gate 组装步骤。
A1-7 前缀缓存友好｜对「系统提示+历史」取 `sha256` 前后比对｜实测哈希工具可用（同串同值）。阈值：注入前后该前缀哈希**逐字节相等**。｜退回：改写为尾部追加。
A1-8 门控失败可区

…（已截断，原长 9338 字符）

**captain → 汇聚网关** · 2026-09-24 03:43:46

[当前状态] 主持人复核 accept 席两条关键实测，**全部证实**，并挖出一条连 accept 席都还没展开的后果。

## 主持人复算（命令可重跑，只读，未写任何文件）

**B1 证实**：`D:\lk\FF\dsh-plugin-roundtable\node_modules\vitest` **不存在**；其 `package.json` 全文**未提及 vitest**；实际测试脚本是 `"test": "node --test ..."`，`test/*.test.mjs` 共 **32** 个。
⇒ 方案 §16 行1091 指定 Vitest，而本机唯一可对照的真实工程用的是 node:test。**阶段 0 的 CI 若无此实测，会写出一条跑不起来的 `npm run test` 定义**。

**B2 证实**：`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` → **exit code = 2**，`error TS` **7 行**。

## 但真正的发现在错误内容里（这是本条的重点）

7 条错误不是「样板写得烂」，而是**样板对不上的宿主 API**：
· `src/members.ts` 5 处：`Property 'subagents' does not exist on type 'Context'. Did you mean 'agents'?`
· `src/members.ts(15,15)`：`Module '"@deepseek-ai/dsh-llm"' has no exported member 'ContentBlock'`
· `src/index.ts(20,21)`：`Could not find a declaration file for module '@deepseek-ai/dsh-subagent'`

**判读**：本机 DSH 是 `0.1.5-rc.2`，而这份样板是按更早的宿主 API 写的（`ctx.subagents` 已被改名为 `ctx.agents`）。⇒ 若落地方案写「照抄 `dsh-plugin-roundtable` 骨架起手」，**会把一组已失效的 API 用法一并继承进 Mana 的 13 个插件**，且因为 `build` 脚本第一步就是 `tsc --noEmit`，**新工程第一次 `npm run build` 就会红**——而使用者很可能照方案先写代码、最后才跑构建，届时 13 个包的报错会混在一起，**真因被淹没**。

## 对落地方案的三条硬要求（不是新方案，是给既有阶段加护栏）
1. **阶段 0 必须把「宿主 API 对齐」列为独立可验证步骤**：起手第一件事是跑一次真实的 `tsc --noEmit` 确认骨架对得上 `0.1.5-rc.2`，而不是默认样板可用。样板只能抄袭「工程外形」（package.json 的 dsh.bundle 声明、tsdown 双 entry、node:test 布局），**不能抄袭其 API 用法**。
2. **阶段 0 的验收必须包含一条负向判据**：故意引用一个不存在的宿主成员（如 `ctx.subagents`），确认 typecheck **必须报错**。若不报错，说明该工程的类型检查根本没接上宿主类型（假绿），此时后续所有 typecheck 判据都不可信。
3. **构建链口径必须二选一并写死**：Vitest（方案 §16 原文，但本机不存在）或 node:test（本机真实可用，样板 32 个测试文件 365/365 绿）。**推荐 node:test**：零新增依赖、与唯一成功样板一致、符合用户「零外部依赖」取向。

[核心产出] B1/B2 复算证实 + 一条新后果（样板继承的是失效宿主 API，会让新工程第一次构建即红且真因被淹没）+ 三条给阶段 0 的护栏。
[下一步建议] 请 verify 席把 B1/B2 与「样板 API 过期」这条一并纳入 R2 核验（判据：`tsc --noEmit` 的 exit code 与 TS 错误内容是否与我的复算一致）；请 accept 席在判据表里把「负向判据：不存在的宿主成员必须报错」补进阶段 0。

**captain → 汇聚网关** · 2026-09-24 03:44:35

[当前状态] 会议里出现一处**席间冲突**，主持人亲自跑真机实证裁定：`sqlite-vec` 到底能不能在本机用。结论——**能用**，但有一处极易踩空的陷阱，两位专家的说法都只对了一半。

## 冲突原文
· 一席报：`vec0 模块不存在`、`sqlite-vec 未安装`（据此倾向「走纯 JS 余弦」）。
· 另一席报：`sqlite-vec 0.1.9 prebuilt 加载成功`、`vec0 KNN 10k = 35.877ms`（据此倾向「直接用」）。

## 主持人实证（全程在 $env:TEMP，未装任何包、未碰既有 profile，探针已清理）

**第 1 步 · `npm pack sqlite-vec@0.1.9`** → 主包**只有 5 个文件**，`files: []`，**不含任何 .dll**。它是元包，靠可选依赖分发：
```
optionalDependencies: { sqlite-vec-windows-x64: 0.1.9, sqlite-vec-linux-x64: 0.1.9, sqlite-vec-darwin-x64: 0.1.9, ... }
```
⇒ **「未安装」为真**：本机确实一个都没装，所以「vec0 模块不存在」是**当前状态的正确描述**。

**第 2 步 · `npm pack sqlite-vec-windows-x64@0.1.9`** → 拿到 `vec0.dll`（**289,280 字节**）。

**第 3 步 · 用 node:sqlite 真机加载该 DLL**：
```
new DatabaseSync(':memory:', { allowExtension: true }) → db.enableLoadExtension(true) → db.loadExtension(vec0.dll)
  loadExtension 成功
  vec_version() = {"v":"v0.1.9"}
  create virtual table vv using vec0(embedding float[4])
  insert rowid 1,2 → KNN 查询返回 [{"rowid":1,"distance":0},{"rowid":2,"distance":1.0954450368881226}]
```
**⇒ 阶段 2 的向量检索在本机是「可真落地」的，不需要放弃 vec0 改走纯 JS。而且距离语义（distance，越小越近）也当场取到了。**
⇒ 但另一席的「未安装」同样为真——**两者冲突的根源是「包存在 ≠ 本机已装」**，而 `npm pack` 只取包不装依赖，所以只看主包永远看不到 DLL。

## 这条实证对落地方案的三条硬约束（不装就必踩）
1. **阶段 0/2 的依赖必须显式声明平台包**：只写 `sqlite-vec` 会依赖 optionalDependencies 自动解析；一旦 `--no-optional`、离线、或 npm 平台判定偏差，DLL **静默缺席**，而 `vec0` 报错极易被 catch 吞成「词法降级」——**正是用户最在意的「让失败不可观测」**。落地方案须要求：显式装 `sqlite-vec-windows-x64`，且**启动时做一次 `vec_version()` 探针**，拿不到就**显式报错**而不是静默降级。
2. **开库必须 `{allowExtension:true}`**（与本席此前那条实测一致，二者叠加才是完整链条）：写错则连 DLL 都加载不了，且**没有任何办法事后补救**（只能重开库）。
3. **检索延迟判据可据此定基线**：本席实测 vec0 KNN 10k 条 = **35.877ms**（另一席取数），远优于方案 §13.2 的 `<500ms` 目标；**但方案给的是「从查询到返回记忆」的端到端口径**，须含嵌入调用（热 p95 19.2ms / 冷启 1037ms，另一席取数）——最终阈值应以「冷启 1037ms」为**首次调用**的失败线，不能拿 35ms 当整体判据。

[核心产出] 席间冲突裁定：sqlite-vec **真机可用**（附 vec0.dll 289KB、vec_version v0.1.9、KNN 返回实测），两席说法各自成立但都需补一半；三条硬约束（显式平台包 + allowExtension + 探针不静默降级）。
[下一步建议] 请 verify 席把「sqlite-vec 真机可用 + 距离语义」纳入核验表复算（命令我已给全：npm pack 两个包 → node:sqlite allowExtension 加载）；请 accept 席把「启动时 vec_version() 探针」写成阶段 2 的**先决判据**。

**captain → verify** · 2026-09-24 03:46:07

【R1 补充 3 · 工作项 r1-verify】核验清单再追加 5 条（V16–V20）。这些都是本轮新出现的、**会改变阶段设计**的主张，必须进你的核验表。

════ V16（最高优先 · 主持人真机实证，结论与另一处意见冲突，需要你独立裁定）════
会议内部对 `sqlite-vec` 是否可用出现**两种相反说法**，我已亲自跑通，但请你复算并裁定：
· 说法 A（报「不可用」）：本机 `vec0 模块不存在`、`sqlite-vec 未安装`。
· 说法 B（报「可用」）：`sqlite-vec 0.1.9 prebuilt 加载成功`、`vec0 KNN 10k = 35.877ms`。
· **主持人实测**（写在 $env:TEMP，已清理）：
  1. `npm pack sqlite-vec@0.1.9` → 主包**仅 5 个文件**，`files: []`，**不含 .dll**；靠 `optionalDependencies` 分发（含 `sqlite-vec-windows-x64@0.1.9`）。
  2. `npm pack sqlite-vec-windows-x64@0.1.9` → `vec0.dll` **289,280 字节**。
  3. `new DatabaseSync(':memory:', { allowExtension: true })` → `enableLoadExtension(true)` → `loadExtension(vec0.dll)` → **成功**；`select vec_version()` 返回 `{"v":"v0.1.9"}`；`create virtual table vv using vec0(embedding float[4])` 成功；插入两条后 KNN 查询返回 `[{"rowid":1,"distance":0},{"rowid":2,"distance":1.0954450368881226}]`。
  **请裁定**：可用/不可用，以及「两说法的冲突根源是否为『包存在 ≠ 本机已装；npm pack 只取包不取可选依赖，只看主包永远看不到 DLL』」。这条直接决定阶段 2 是走 vec0 还是走纯 JS 余弦。

════ V17 ════
另有意见认为：`D:\lk\FF\dsh-plugin-roundtable` **样板自身 typecheck 是红的**。主持人已复算：`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` → **exit code = 2**，`error TS` **7 行**，内容为 `src/members.ts` 5 处 `Property 'subagents' does not exist on type 'Context'. Did you mean 'agents'?`、`src/members.ts(15,15)` `Module '"@deepseek-ai/dsh-llm"' has no exported member 'ContentBlock'`、`src/index.ts(20,21)` 缺 `@deepseek-ai/dsh-subagent` 声明文件。请复核 exit code 与错误内容，并裁定「这是否意味着样板对不上本机 DSH 0.1.5-rc.2 的宿主 API（`ctx.subagents` 已改名 `ctx.agents`）」。

════ V18 ════
另有意见认为：本机**不存在 vitest**，样板 `test` 脚本实为 `node --test "test/*.test.mjs"`，共 **32** 个测试文件、实测 365/365 通过、2.59s。主持人已复算证实（`node_modules\vitest` 不存在、package.json 未提及 vitest、test 目录 32 个 .test.mjs）。请复核，并裁定方案 §16 行1091「测试 Vitest」在本机是否**不可执行**。

════ V19（主持人新实测，供你复算，无冲突）════
`node --test` 的调用写法有陷阱：在 Node v22.22.0 下
· `node --test tests/`（传目录）→ **失败**，报 `Error: Cannot find module ...\tests`，但仍打印 `# tests 1 / # fail 1`，**看起来像「测试失败」而非「命令写错」**；
· `node --test "tests/*.test.mjs"`（glob）→ `pass 1 / fail 0`，**exit 0**；
· `node --test`（无参数自动发现）→ `pass 1 / fail 0`，**exit 0**；
· 真红（断言失败）→ `pass 1 / fail 1`，**exit 1**（exit code 真能区分红绿）。
请复算上述四条，并裁定「把 `node --test tests/` 写进 CI 会造成什么后果」。

════ V20 ════
另有意见认为 `dsh-memory`（方案 §15.3 标「直接复用」）包内仅 5 个文件、`grep "vec0|sqlite-vec|RRF|cosine|bm25"` **零命中**、README 自述纯 FTS5 词法存储，与方案行 1015 描述的「sqlite-vec KNN 余弦 + FTS5 BM25 + 关键词三路 RRF」不符。主持人已独立复算 npm 存在性（`dsh-memory`/`dsh-graphmemory`/`dsh-memoria` 存在；`dsh-shoucang-memory`/`dsh-hindsight-memory`/`dsh-memory-jev` **E404**），但**包内容**这条由你复核（`npm pack dsh-memory` 解到 $env:TEMP，用完清理）。

【裁定要求】逐条裁「成立 / 部分成立 / 不可复现」+ 证据强度；证据不足即判不可复现。**V16 优先**。
【边界】npm pack 只允许解到 `$env:TEMP` 并自行清理；禁止 `npm install` 到任何既有 profile；禁止在 D:\Mana 下落任何东西；禁止建 mana.db。

**verify → 汇聚网关** · 2026-09-24 03:46:25

[当前状态] R1 · 工作项 r1-verify 完成。15 条待核结论 + 1 条主持人派单数字，全部按「先预注册判据 → 再跑 → 再裁」执行。只读；临时探测件全在 $env:TEMP（已删）；未碰 profiles/settings.yaml，未安装，未建库，D:\Mana 除原有 docs/ 与 .roundtable/ 外无任何残留（已列目录自证）。

## 一、裁定汇总（证据强度：强=本机独立复跑出可复制输出；中=部分要素复现、部分要素错；——=未取得）

| # | 待核结论（缩） | 裁定 | 强度 |
|---|---|---|---|
| V1 | 扩展加载窗口只在开库时可开 | **成立** | 强 |
| V2 | PRAGMA 无返回 / 无 db.transaction / run() 返 {lastInsertRowid,changes} | **成立**（3/3，另补 backup 是模块级导出） | 强 |
| V3 | FTS5 默认分词中文 0 命中，trigram 命中 | **成立** | 强 |
| V4 | sqlite-vec 本机零命中 + §16 行1087 未提开库窗口 | **成立**（另证 npm 有 win-x64 prebuilt） | 强 |
| V5 | 方案指 Vitest，样板无 vitest、实为 node --test | **成立** | 强 |
| V6 | pnpm 不可用 / npm 可用 / D:\Mana 无 .git | **成立** | 强 |
| V7 | ACP 936 / TZ CST / DSH_HOME / mana.db 无 / 仅 web 装 shoucang | **成立** | 强 |
| V8 | §9.1 无环、最深 3；但 forgetting/consolidation「方向倒置」 | **部分成立**（前段成立，后段未验证） | 中 |
| V9 | §9.4 用 emit 调 waterfall 契约、从未注册 middleware | **成立** | 强 |
| V10 | DDL 缺 vec0/fts5 虚表与 WAL 语句；三处状态撞车 | **成立**（DDL 缺项）；「双权威冲突」部分成立 | 强 |
| V11 | §13.2 七个数值全文无实测基线 | **成立**（并给出正确定性：它们是「目标」列，缺陷是无可达性基线） | 强 |
| V12 | dsh-memory 仅 5 文件、向量关键词零命中、实为纯 FTS5 | **成立** | 强 |
| V13 | npm 存在性矩阵 | **部分成立**（矩阵 6/6 成立；「私有件」定性 ✗） | 中 |
| — | C-1（V13 推论）三道门控权威依据在公开侧不存在 | **不可复现，且与之相反** | 强反证 |
| V14 | shoucang lib/ 107 文件无一用 sqlite | **成立** | 强 |
| V15 | bge-m3=1024 维；起手样板 ~5KB/仅 peer cordis；roundtable tsdown 双 entry | **部分成立**（1024 维与双 entry 成立；样板属性成立但**路径错**） | 中 |
| P1 | 主持人派单「总计 20–34 周」 | **部分成立**（下限 20 成立，34 无来源） | 强 |

**计：成立 11 · 部分成立 4 · 不可复现 1（C-1，反证）。**

---

## 二、逐条取证（判据 / 证据 / 反例）

### V1 —— 判据：若 `new DatabaseSync(p)` 后 `enableLoadExtension(true)` 抛「disabled at database creation」且 `{allowExtension:true}` 可开，则成立
```
V1a enableLoadExtension after plain open :: ERR: Cannot enable extension loading because it was disabled at database creation.
V1a loadExtension after failed enable :: ERR: extension loading is not allowed
V1b enableLoadExtension with allowExtension:true :: OK
V1b loadExtension(bogus) :: ERR: 找不到指定的模块。
V1c plain open again :: ERR: Cannot enable extension loading because it was disabled at database creation.
```
**裁定：成立。** 报错原文与主持人给的一字不差。**反例/补证**：V1c 证明「关掉再开一次就能修」不成立 —— 该窗口对**每一个**新句柄都重新关闭，只能靠开库参数；「先建库再补」必然失败，只能删库重建（rollout 席 D1 的后果判断成立）。

### V2 —— 判据：三个子断言逐一在 `node -e` 里取返回值
```
V2a db.exec('PRAGMA journal_mode=WAL') return value :: undefined
V2b db.prepare('PRAGMA journal_mode=WAL').get() @ :memory: :: {"journal_mode":"memory"}
file-db exec(PRAGMA journal_mode=WAL) -> undefined
file-db read back get() -> {"journal_mode":"wal"}
V2c typeof db.transaction :: undefined   （原型成员表无 transaction）
   原型成员：open,close,prepare,exec,function,location,aggregate,createSession,applyChangeset,enableLoadExtension,loadExtension,constructor
V2d stmt.run() -> {"lastInsertRowid":1,"changes":1}   （第二次 -> 2，AUTOINCREMENT 正常）
```
**裁定：成立（3/3）。反例/需收紧**：(a) engine 断言「node:sqlite 可用（DatabaseSync / StatementSync / backup）」有精度问题 —— 实测 `typeof DatabaseSync.backup === 'undefined'`，`backup` 是**模块级导出**（`typeof backup === 'function'`，已端到端跑通：备份文件 8192B、头 15 字节 `SQLite format 3`、回读 2 行一致）。写实施步骤时若按 `DatabaseSync.backup(...)` 写会直接 TypeError。(b) 方案 §12.3 行901 写「SQLite 事务 + WAL 模式」，而 node:sqlite **没有 `db.transaction` 封装** —— 必须手写 `exec('BEGIN')/('COMMIT')`；这条是 V2 成立后的直接后果，不是新方案。

### V3 —— 判据：造一条真实中文串，分别用默认与 trigram 建表 MATCH
```
V3a default(unicode61) MATCH 末那识 :: {"n":0}
V3b default MATCH 藏识        :: {"n":0}
V3c trigram MATCH 末那识      :: {"n":1}
V3d trigram MATCH 量子纠缠(不存在) :: {"n":0}
FTS5 unicode61 MATCH 降级 :: 0；FTS5 英文 MATCH test :: 1
sqlite_version = 3.50.4
```
**裁定：成立。** 对照组关键：**英文能命中、中文不能** —— 所以这不是「查不到」「库空」而是分词器口径，V3d 同时证明 trigram 不是「恒返回 1」。这正是 scenario 席判的「降级归零与无记忆不可分辨」。

### V4 —— 判据：`require.resolve` / `npm ls -g` / 全盘搜；再核 §16 行1087 原文与全文 extension 关键词
```
npm ls -g sqlite-vec -> (empty)      require.resolve('sqlite-vec') -> MODULE_NOT_FOUND
D:\Mana / D:\lk\FF 递归搜 sqlite-vec -> 0 个文件
方案行1087: | 向量库 | sqlite-vec | 零基础设施，社区已验证 |
全文 allowExtension|loadExtension|extension 命中数 = 0
```
**裁定：成立。反例/补证**：`npm view sqlite-vec@0.

…（已截断，原长 18525 字符）

**captain → scenario** · 2026-09-24 03:46:51

【R1 · 追问（非计划内工作项，故不带 work_item 标签）】

你上一轮的产出我完整收到。A 类 4 条（中文词法降级静默归零、降级率/缓存命中率缺分母恒真、I1/I2 被 reset 日志掩盖、"不注入"与"没记忆可用"不可分辨）已按你建议全部纳入阶段 0/1 验收方案的候选——这几条是本轮质量最高的发现之一。

追加一件**你已具备全部材料、但尚未展开**的事，请补齐（只读，不必重跑已完成的场景枚举）：

**题目：把「不可观测」类缺陷从 4 条扩到全阶段覆盖，并逐条给出「怎么才算可观测」的判别动作。**

理由：本项目的使用者只有一个人（你自己实测结论），**没有"用户报障"通道**，所以「不可观测」不是体验问题，是全局风险。而方案 §14 列了 10 条故障模式，我怀疑其中大部分在实现后**根本无法被察觉**。

请对方案 §14（文件 D:/Mana/docs/mana-v5-plan.md，行 969–984）的 10 条故障模式逐条判定：
| 故障模式 | 方案给的「检测方式」是真是假（真有信号 / 只是写了句愿望） | 若为真：信号落在哪（表/日志/字段） | 若为假：补什么最小探针才能发现它 |

**特别请你重点判这 4 条**（我怀疑它们是「写了检测方式但其实测不出来」）：
1. 「JEV 误判 → 审计日志对比」——审计日志（§6.3 `mem_gate_log`）只记 ID 和哈希、不含内容体（§12.4），**拿它怎么对比出"误判"？**
2. 「记忆爆炸 → 存储监控」——**用什么信号区分「正常增长」与「爆炸」？**方案没给阈值也没给基线。
3. 「前缀缓存失效 → 缓存命中率」——**这个命中率从哪读？**§13.2 说 >40%，但全文没有任何一处说它落在哪个字段。
4. 「输入截断 → 输入长度检查」——**谁检查、结果记在哪？**且 §3.4 自己写了「输入截断可能导致判断模型失明」，说明这坑作者已知，却没给观测点。

**输出格式**：一张 10 行的判定表 + 上述 4 条的展开（每条给：当前为什么测不出 → 最小可观测探针是什么 → 该探针落在哪个阶段）。凡是方案没给依据的，直接写「检测方式为愿望，无信号」——**不要替方案圆场**。

【边界】只读，禁止改任何文件、禁止安装、禁止建库。交付后用 roundtable_speak 提交。

**scenario → 汇聚网关** · 2026-09-24 03:47:41

[当前状态] R1 追问完成（只读，非计划内工作项）。对 §14 十行逐条判定，未替方案圆场。

[核心产出]

## 一、§14 十行判定表（源：D:/Mana/docs/mana-v5-plan.md 行 969–984）
判定口径：**真有信号**＝该信号有落点（表/字段/日志，可在实现后读出数）；**半真**＝信号存在但缺"异常/正常"的判别基线或不能区分成因；**愿望**＝只有名词，全方案无落点。

| # | 故障模式（行） | 检测方式 | 判定 | 若真：落点 | 若假/半真：补什么最小探针 |
|---|---|---|---|---|---|
| 1 | JEV API 超时（973） | 超时计时器 | **半真** | `jev_log.latency_ms`（行 860）；`mem_gate_status` 熔断器（行 473） | 缺"超时阈值"字段、缺超时事件本身。`jev_log.degraded=1 且 latency_ms IS NULL` 时无法区分 TIMEOUT/拒绝/预算耗尽。补：`jev_log.outcome` 枚举（OK\|TIMEOUT\|REFUSED\|BUDGET\|CIRCUIT） |
| 2 | JEV 误判（974） | 审计日志对比 | **愿望** | 无 | 见下方【展开 1】 |
| 3 | 向量库不可用（975） | 健康检查 | **半真** | `mem_recall` 返回 `{gate, degraded}`（行 468） | "向量库挂了"可观测，但降级后的召回质量不可观测（见我上轮场景 1：中文 FTS5 0 命中）。补：降级态下同 query 记 `lex_hits` 与 `vec_hits` 两数，`degraded=1 且 lex_hits=0 且库非空` 判红 |
| 4 | SQLite 锁竞争（976） | 重试计数 | **愿望** | 无字段 | 见下方【展开 2】 |
| 5 | 插件加载失败（977） | Cordis 加载日志 | **愿望** | 无（且不在 Mana 数据面） | 见下方【展开 5】 |
| 6 | 工作记忆溢出（978） | token 计数 | **半真** | 无落点 | `maxFocusItems:4`（行 687）是**计数**，与"4 组块容量"是两个口径（行 1199）。补：每次 pre-step 落 `focus_count / focus_tokens / dropped[]` 三数，"溢出到 TODO"（行 978）的 TODO 需有实体 |
| 7 | 记忆爆炸（979） | 存储监控 | **愿望** | 无 | 见下方【展开 3】 |
| 8 | 前缀缓存失效（980） | 缓存命中率 | **愿望（且张冠李戴）** | `jev_log.cached`（行 858）只是 JEV 判断缓存 | 见下方【展开 4】 |
| 9 | 输入截断（981） | 输入长度检查 | **愿望** | 无 | 见下方【展开 6】 |
| 10 | 用户模型漂移（982） | 精度监控 | **愿望** | 无 | 见下方【展开 7】 |

**汇总：真有信号 0 条；半真 3 条（1/3/6）；愿望 7 条（2/4/5/7/8/9/10）。**
对照 §18 风险表（行 1153–1165）"依据"列：7 条依据写成「dsh-memory-jev 设计」「社区实测数据」「多 Agent 开发最佳实践」等——**均非本机可复算的实测数**，与 §15.3 宣称"直接复用 dsh-memory-jev"同源（本机实测该插件不存在，且 web profile 内只有 shoucang）。⇒ §14 的"检测方式"列整体是**对策清单的装饰**，不能作为验收依据。

## 二、四条重点展开

### 展开 1｜JEV 误判（974）——「审计日志对比」测不出
- **为什么测不出**：`mem_gate_log` 自述「仅 ID 和哈希，不包含内容体」（行 474），§12.4 行 910 再确认一次。误判的定义是"这条判断错了"，而"错"必须拿**判断输入的内容**去比。只有哈希的日志能回答"这条被判断过、哈希是 X"，**永远回答不了"判错了没"**。且 §6.2（行 454-455）的阈值是概率门（0.5/0.6），概率本身可正常落在库里而结论错误——`jev_log.probability`（行 858）不是"对错"的证据。
- **最小的可观测探针**：`jev_log` 加两列——① `verdict`（本次判定采取的动作：KEEP/DROP/INJECT/SKIP）；② `verify_state`，取值 `unverified`（缺省）/`verified_agree`/`verified_disagree`，由"低概率触发 LLM 复核"（行 974）这条对策在抽样后写回。**判定"误判率"= verified_disagree / verified 总数**，而**核验覆盖率 = verified / 总数 必须一并暴露**，否则"误判率 0%"与"从未核验过"同形——这正是本项目的头号病。
- **落点阶段**：**阶段 1**（jev_log 建表时一次到位）。推到阶段 6 会导致阶段 1–5 全部无标注材料。

### 展开 2｜SQLite 锁竞争（976）——「重试计数」七个字，无字段无归属
- **为什么测不出**：§11.2（行 790–863）六张表**没有任何一张**有重试/错误字段；`jev_log` 只服务 JEV。更糟的是：**重试成功时系统表面完全正常**，"重试计数"这个量本身就藏起来了——用户只看得到结果，看不到内部在打架。
- **最小的可观测探针**：不新表，直接复用 `mana_trace`（行 844-849）——加一类事件 `db/busy`，payload 记 `{op, attempts, waited_ms, final:'ok'|'fail'}`。判据：**① `final='fail'` 计数 > 0 即红（真失败）；② `attempts>1` 的占比是"并发压力"指标，不是失败**。必须两条分开，否则高并发压力会被当成故障、真失败会被当成压力。
- **落点阶段**：**阶段 0**（`mana_trace` 是契约层表，事件类型在阶段 0 冻结）。

### 展开 3｜记忆爆炸（979）——「存储监控」没有阈值、没有基线、没有量
- **为什么测不出**：全文 grep「阈值」相关，§8.2 归档条件只写"90 天"（行 554-576 区间），§13.2 无任何存储指标，附录 B（行 1189-1211）**没有一条存储参数**。⇒ 无法回答"多大算爆炸"。
- **最小的可观测探针**：每日巩固时（行 549）落一行 `mana_trace` 事件 `store/snapshot`：`memory_items 行数 / 已退休行数 / 活跃 BLOB 字节 / mana.db 文件字节 / WAL 字节`。判据用**增速**不用绝对值：`本周行数增量 / 上周增量`（滚动比），比值 > 3 且绝对增量 > 1000 条即红。**绝对值判据会误报**——从 0 涨到 1000 是正常的，从 5 万涨到 15 万才是爆炸，只有增速能区分。
- **落点阶段**：**阶段 3**（巩固插件存在后才有定时点）。但 §8.3 行 578-582「物理删除永不发生」与无限归档是**直接冲突**，必须同时在阶段 3 给归档留存上限，否则监控只会告诉你它在爆。

### 展开 4｜前缀缓存失效（980）——这个「缓存命中率」读不到，且它指的不是那回事
- **为什么测不出**：`jev_log.cached`（行 858）与 §6.4 行 486「相同 state hash + question 缓存 TTL 300s」讲的是 **JEV 判断去重缓存**；而 980 行的故障模式讲的是 **LLM 前缀缓存**（行 446「前缀缓存友好」、行 980「保持前缀一致」）。**两个不同的缓存共用"缓存命中率"一个词**，§13.2 行 947 的 `>40%` 没有指明是哪一个——按 §6.4 那个算，它衡量的是 JEV 省钱；按 LLM 那个算，方案**全文没有任何一处说前缀缓存命中数落在哪个字段**。
- **最小的可观测探针**：前者现在就能算（`cached=1 / 总数`，落点行 858，但 §13.2 必须写明口径）。后者需要一个独立落点：LLM 调用结果若回调里带缓存命中信息，则每次 `ctx.llm` 调用落 `mana_trace` 事件 `llm/call{prefix_hit, prompt_tokens, cached_tokens}`；**若该信息取不到，就如实标"不可观测"，改用代理量并在文档里注明是代理量**——代理量不能当判据（本机已有"代理指标非判据"的教训）。
- **落点阶段**：**阶段 1**（定 §13.2 口径）；代理量若需真信号，看阶段 0 契约能否拿到 `ctx.llm` 回调字段。

### 展开 5｜插件加载失败（977）——「Cordis 加载日志」的观测者本身可能是被判死的那个
- **为什么测不出**：宿主的加载日志是 stdout/文件，不在 Mana 数据面，**用户不会主动去看**。若挂掉的

…（已截断，原长 6677 字符）

**impl → 汇聚网关** · 2026-09-24 03:49:06

[当前状态] r1-impl 完成一轮只读核对：6 项前置全部实测取数（node:sqlite / sqlite-vec / 嵌入服务 / cordis 五模式 / JEV 通道 / token 量级）。探测文件建在 $env:TEMP 并已删除；未建 mana.db（`Test-Path D:\Mana\mana.db` = False）；未改任何既有插件与 settings.yaml。D:\Mana 下除 .roundtable 外无新文件。

【阻塞项清单（按"会掩盖其他问题/让失败不可观测"优先）】

■ B1 · 掩盖型·最高｜§9.4 的示例代码跑不起来，且会把错误伪装成别的问题
- 真实语义（实测，cordis `lib/index.js:281` map 分发 / `:920` apply）：为 waterfall 型事件注册 `(req,next)` 监听器、却用 `ctx.emit()` 分发 → **同步抛 `TypeError: next is not a function`**。输出：`1) emit(waterfall-event) 同步返回 = undefined` + 监听器收到 `next` 类型 = `undefined`。
- §9.4 恰恰这么写：`ctx.on('mana/jev/judge', ...)` 由 `ctx.emit('mana/jev/judge', {...})` 触发（方案 692–700 行）。而 `Events['mana/jev/judge']` 在 §9.3（656 行）被声明成 `(req,next)=>Promise<...>`。⇒ 按方案原样实现，第一个 observation 事件就炸。
- 正确写法：`ctx.waterfall('mana/jev/judge', req, next)`。实测 `waterfall() -> {"base":true,"inner":true,"outer":true} chain= outer>inner`（后注册者在外层，`next()` 向内）。
- 影响阶段：0（骨架）、1（核心闭环）。

■ B2 · 掩盖型｜§12.3「SQLite 事务 + WAL 防并发写入」在本机是假的，且默认失败是**立即**失败
- 实测（TEMP 临时库，已删）：`PRAGMA journal_mode=WAL` 走 `exec` 生效 → `{"journal_mode":"wal"}`；但同进程第二个连接在写事务内写同一文件仍 **`ERR_SQLITE_ERROR` errcode 5 `database is locked`**，且因为我先设了 `busy_timeout=2000`，才"卡 2247ms 后失败"。**默认 `PRAGMA busy_timeout` = `{"timeout":0}`** ⇒ 不显式设置就是**立刻**抛错。
- 关键 API 缺口（实测）：**`db.transaction` = undefined、`db.pragma` = undefined**。better-sqlite3 风格写法全部不可用，必须手写 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`，并显式 `PRAGMA busy_timeout`。方案 §9.2/§12.1 全文无一处提到 busy_timeout。
- 出错不自动回滚（实测）：事务内 SQL 报错后 `count` 仍为 1（事务还开着），必须自己 `ROLLBACK`。DSH 官方 `dsh-session-query-sqlite/lib/index.js:679-696` 正是 `try{BEGIN IMMEDIATE}catch{ROLLBACK}` 手写式——官方也没用封装。
- 影响阶段：1、2（一切写记忆的路径）。失败不可观测形态：`catch{}` 一吞 → 静默丢记忆。

■ B3 · 地基型｜sqlite-vec 本机没有，且方案对它的描述有两处事实错误
- 可得性：`profiles/web/node_modules`、DSH 安装目录、super-injector registry **全无** sqlite-vec。npm 侧存在：`sqlite-vec@0.1.9`（optionalDeps 带平台包）+ `sqlite-vec-windows-x64@0.1.9`（`exports: {"./vec0.dll": ...}`，unpackedSize 289628）。
- **node:sqlite 加载扩展的三个硬前提（逐条实测）**：① 默认 ctor → `loadExtension` 报 `ERR_INVALID_STATE: extension loading is not allowed`；② **必须在建库时** `new DatabaseSync(p,{allowExtension:true})`，事后 `enableLoadExtension(true)` 报 `ERR_INVALID_STATE: Cannot enable extension loading because it was disabled at database creation`；③ 开对了之后才走进真正加载（假路径报 `ERR_LOAD_SQLITE_EXTENSION 找不到指定的模块`，证明已进 dlopen）。⇒ "node:sqlite + sqlite-vec" 可行，但 ctor 参数是**不可后补**的。
- **事实错误**：§15.7（1058 行）「sqlite-vec 已实现 `recall_hybrid` 方法」——sqlite-vec 是扩展（vec0 虚拟表 + 距离函数），`recall_hybrid` 不是它的方法。§15.5/§7.1 把 vec0 写法当既定事实。
- **最小绕行（已实测代价）**：不需要 sqlite-vec。只读基准脚本跑本机 shoucang 的 `~/.dsh/suite/knowledge/.vector-cache.jsonl`（30,235,918 B / 2321 行 / 1024 维）：read 83ms + JSON.parse 203ms + **全量暴力余弦 11ms** = **297ms**，已优于 §13.2 目标的 <500ms。10 万条量级前，BLOB + 常驻 Float32Array 比装扩展更稳（且不碰 allowExtension 这面墙）。
- **附带炸弹（同属"假绿"）**：FTS5 内置可用（`CREATE VIRTUAL TABLE ... USING fts5` OK、`bm25()` OK），但 **unicode61 对中文完全不切词**：`MATCH '记忆命中率'`→0 行、`MATCH '命中'`→0 行；**trigram 才行**：`MATCH '记忆命中率'`→1 行、`MATCH '命中率'`→1 行、但 `MATCH '命中'`（<3 字）→0 行。§7.1「关键词检索（FTS5 BM25）→ Top 50」不指定 `tokenize='trigram'` 时中文召回恒为 0，**有结果=空、无报错**。
- 影响阶段：1（向量层）、2（混合检索）。

■ B4 · 掩盖型｜"宿主 fetch 打 11434 不通"这条注释在当前运行态下不成立，但静默降级是真的
- shoucang 源码注释（`panel-inject.js:237-238`）写「宿主进程全局 fetch 被 DSH patch（实测 11434 经 fetch 不通、node:http 通）」。
- 实测反证三条：① 独立 node 进程 `fetch('http://127.0.0.1:11434/api/tags')` → OK，17 个模型；② shoucang 自己的 `vec.js:264` 用的就是 `await fetch(url,...)`，且向量缓存**当前持续在长**（`~/.dsh/suite/knowledge/.vector-cache.jsonl` = 30,235,918 B / 2321 行，mtime `2026/9/24 3:31`，脚本写入者见 `vec.js:11/20`）；③ 宿主内存内端点实测 HTTP 200：`/api/shoucang-panel/vector/status2` → `{"running":{"baseUrl":"http://127.0.0.1:11434/v1","model":"bge-m3:latest"},"provider":"gpu-ready","localOk":true,"cache":{"lines":2321},"stats":{"queries":1564,"lastMode":"fusion","lastMs":36,"lastAt":1790192630648}}`（lastAt 解码 = 2026-09-24 03:43:50，即我探测前 32 秒）。
- 相关机制已定位：DSH 装了 `dsh-http-proxy`，它 `undici.setGlobalDispatcher(agent)` 覆盖全局 dispatcher（该包 `index.js:403-450`，注释原话「Installing replaces u

…（已截断，原长 11675 字符）

### 第 2 轮

**captain → rollout** · 2026-09-24 03:51:13

【R2 · 工作项 r2-write】你要产出**成品文档**：`D:\Mana\docs\mana-rollout-plan.md`。

**第一步：先读作业书 `D:\Mana\docs\_synthesis-brief.md`（我写的，你必须完整读一遍）。**
那里面已经整合了 7 席全部产出并替你把口径裁定了（C1–C12）、把「方案声称 vs 本机实测」的 14 条相悖清单列全了、把成品的文档结构规定好了。**你不需要重新论证任何方案**，只需要按结构把内容组织出来并写细。

**第二步：读素材**（都在 `D:\Mana\.roundtable\_extract\`）：
· `08-rollout.md` —— **这是你自己 R1 的产出**（17 批次分期表、硬依赖、回滚、三条验收模板），是你的分期骨架主源，直接扩写成第 3、4 章。
· `14-accept.md` —— 26 条自动判据 + 6 条人工判据，四要素齐备且带实测数值锚点，是**验收方案主源**，按阶段对号入座。
· `21-impl.md` —— 11 条阻塞项（node:sqlite 语义 / 嵌入服务 / cordis 五模式 / JEV 承载 / token 量级），填进各阶段「阻塞点与回滚」。
· `12-reuse.md` —— 可复用件核查（含符号级清单、许可证），填进阶段 0/1 的取材说明。
· `09-arch.md` —— 5 个结构成因，填进第 2 章先决阻断项。
· `07-scenario.md` + `20-scenario.md` —— 场景清单 + §14 十条故障模式可观测性判定（0 真信号/3 半真/7 愿望），这是 C9 的依据。
· `18-verify.md` —— 15 条核验裁定，决定哪些主张可信。
· `D:\Mana\docs\mana-v5-plan.md` —— 方案原件，引用行号时对照，**不要改它**。

**三条口径纪律（作业书里也写了，这里再强调）**：
1. **抄实测数字不许走样**。原文是 `289,280 B`、`20.92 ms`、`55.46 ms`、`vec_version()=v0.1.9`、`365/365`、`exit 2`，就照抄；不要写成「约 290KB」「20 毫秒左右」。素材里标「未验证」的，成品里继续标「未验证」，**不许升格成已确认**。
2. **判据必须是可粘贴执行的命令**或确定性比对。禁止「性能良好」「响应及时」这类词。凡方案 §13.2 那 7 个目标值（85%/0.8/500ms/80%/5%/40%/75%），一律写「待定，需首测后自设」，**不得当阈值采纳**（见 C7）。
3. **数字要对得上**：正文说「七阶段 / 17 批次 / 关键路径 11」，第 3 章的表就必须逐行可数。若你发现算不平，以你的表为准并显式说明差异。

**成品必须覆盖的两个用户原话要求**（这是他的原始指令）：
· 「阶段性每个阶段要有**实施方案**」→ 每阶段的 N.1 节：目标 + 批次表（批次/交付物/步骤要点/硬依赖/可并行/涉及文件）+ 关键技术约束。
· 「每个阶段要有**验收方案**，尽量做细节」→ 每阶段的 N.2 节：自动判据表（判据/命令/阈值/退回动作）+ 人工判据（若有）+ **反证判据**（你自己 R1 提的第三条模板：卸载后同一触发不再产生新行）。

**边界纪律（严格遵守）**：
· 只新建/覆盖 `D:\Mana\docs\mana-rollout-plan.md` **这一个文件**；不改 `mana-v5-plan.md`、不改 `_synthesis-brief.md`、不改 `.roundtable` 下任何素材。
· 不动任何已装配插件与配置、不安装任何包、不建库（**绝不创建 mana.db**）。
· 你的工具集里**没有 `dev_*` 注入工具**——这一点你 R1 已经诚实标注过，**保持诚实**：涉及注入/卸载的判据照写命令，但注明「须由具备 dsh-super-injector 工具链的执行席运行」。

**篇幅要求**：这是要能照着执行的册子。七个阶段都要写细，不要因为长就压缩后半部分——用户明确要求「尽量做细节」。允许 1000+ 行。

写完用 roundtable_speak 交回，附：成品路径、总行数、七阶段是否齐全（7/7 自检）、以及你对作业书哪里觉得不对（如有，直说，我裁定）。

**captain → rollout** · 2026-09-24 03:51:41

【R2 补充 · 工作项 r2-write（追加要求，不影响你正在进行的写作）】

你写作期间我复核了 impl 席素材，发现**作业书里漏了一条必须写进成品的硬约束**。请在你已开写的成品里补上（放在「先决阻断项」章 + 阶段 1 或阶段 2 的验收节，位置你判断）：

**新增第 15 条「方案与本机相悖」**（作业书第四节那张表原是 14 条，补成 15 条）：
· 方案声称：§6.1 Injection Gate 挂在 `agent/pre-step` 阶段注入记忆（行 438）。
· 本机实测：`agent/pre-step` 是 DSH 官方 **waterfall** 扩展点（签名见 `dsh-agent/lib/types/runtime-types.d.ts`），而**本机已装的 shoucang 插件已经注册了两个监听器**：`panel-inject.js:773` 与 `mcl.js:372`。
· 后果：waterfall 是环绕中间件，**不调 `next()` 就吞掉下游全部行为、且不报错**。Mana 的 Injection Gate 若也挂这里而漏调 `next()`，会**静默掐死用户现有的热记忆注入**。这是「拆东墙补西墙」的最典型形态——而且现有「不改 shoucang」的 notDoing 清单**挡不住它，因为破坏方是新代码**。
· 处理：① 阶段 0 契约必须写明「本插件所有 `agent/pre-step` 监听器**必须调用 `next()`**」；② 阶段 1/2 验收须有一条**回归判据**：Mana 注入插件启用前后，shoucang 的热记忆注入**仍照常发生**（取证方式：注入块仍在、`/api/shoucang-panel/vector/status2` 的 `stats.queries` 仍增长）；③ 建议 Mana 优先用自己的独立扩展点，避免与 shoucang 争同一处。

**同时请把以下 3 条实测正面写入成品**（它们决定实施写法，比方案原文准）：

1. **waterfall 必须用 `ctx.waterfall()` 分发**：方案 §9.4 行 692–700 用 `ctx.emit('mana/jev/judge', …)` 分发一个声明为 `(req,next)=>Promise<…>` 的 waterfall 事件 → 实测**同步抛 `TypeError: next is not a function`**（cordis `lib/index.js:281` map 分发）。正确写法 `ctx.waterfall('mana/jev/judge', req, next)`，实测链路 `outer>inner`（后注册者在外层，`next()` 向内）。⇒ 按方案原样实现，**第一个 observation 事件就炸**。

2. **`busy_timeout` 必须显式设置**：实测 `PRAGMA busy_timeout` 默认 `{"timeout":0}` ⇒ 并发写**立即**抛 `database is locked`（先设 2000 才「卡 2247ms 后失败」）。且 `db.transaction` 与 `db.pragma` **皆 undefined**（实测），better-sqlite3 风格写法全部不可用 ⇒ 必须手写 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` + 显式 `PRAGMA busy_timeout`。方案全文**无一处**提到 busy_timeout。另：事务内 SQL 报错**不自动回滚**（实测 count 仍为 1，事务还开着）。

3. **`bail` 的判据不是「非空」**：实测 `null/undefined/false` **不算** bail（继续），而 `0/''/[]/{}` **算** bail（截断后续）。方案 §9.3 行 634 写「serial：第一个**非空**返回值胜出」——**这句是错的**。JEV 的概率返回 `0` 会截断整条链。另两条偏差：`parallel` 的监听器抛错会聚合成 `AggregateError`（与 §12.2「单路失败不影响整体」在代码层冲突）；`emit` 不 await async 监听器（错误逃逸为 `unhandledRejection`）。

以上都有命令与输出可复算，照抄时**保留原始报错文本**（`TypeError: next is not a function`、`database is locked`、`{"timeout":0}`）。

【边界提醒不变】只写 `D:\Mana\docs\mana-rollout-plan.md` 一个文件。写完照常交回。

**captain → rollout** · 2026-09-24 03:51:56

【R2 · 收口提示 · 工作项 r2-write】主持人已把你要补的第 15 条约束**亲自核实到行号**，直接把这段抄进成品即可，不必再自己查：

**核实结论（主持人实测，可复算）**：
`C:\Users\lk\.dsh\profiles\web\node_modules\dsh-shoucang-memory\lib\` 下，`agent/pre-step` 在**两个文件共 6 处**出现：
· `panel-inject.js` 行 **525 / 626 / 773**
· `mcl.js` 行 **6 / 372 / 477**
其中 `panel-inject.js:773` 是真实注册点（impl 席已核），其余为注释与取值处。

源码注释自述两件事，正是风险与约束的来源：
· 行 546 附近原文：**「`agent/pre-step` 可追加消息」**（说明它确实挂在这个扩展点做注入）。
· `mcl.js` 行 6 附近原文：**「零抛出（异常只审计，绝不打断了 agent 循环）」**（说明 shoucang 自己的纪律是绝不打断 agent 循环）。

⇒ **对 Mana 的硬约束（写进阶段 0 契约 + 阶段 1/2 验收）**：
1. Mana 凡在 `agent/pre-step` 注册的监听器，**必须调用 `next()`**。漏调 = 静默掐死 shoucang 的注入与 MCL 慢通道，且**不报错**（waterfall 语义）。
2. 验收须有一条**跨插件回归判据**：Mana 注入插件「启用前 / 启用后」两次取证比对，要求 —— ① shoucang 的注入块**仍照常出现**；② `GET http://127.0.0.1:11434/... ` 不便时改用宿主面板端点 `/api/shoucang-panel/vector/status2` 的 `stats.queries` **仍在增长**（impl 席实测该端点返回 200 且含 `"queries":1564` 字段，可作为活体读数）。
3. 若判据 2 取证不便，**降级方案**是让 Mana 优先使用自己的独立扩展点，不与 shoucang 争同一处。
4. 这条要写明它**为什么不受 notDoing 清单保护**：「不改 shoucang」挡不住新代码把 shoucang 掐死 —— **破坏方是新代码**，这正是「拆东墙补西墙」的判定样例。

请把上面这段作为成品里该条的正式内容（含 6 处行号）。其余写作要求不变，写完照常交回。

**captain → 汇聚网关** · 2026-09-24 03:52:19

[当前状态] R2 进行中。主持人在作者席写作期间做了一次**纠正性核实**：会议早期有一席（含我本人）把方案 §15.3 的复用承诺判为「查无此物」，我复核后发现**该判定偏严，须纠正**——这会直接影响阶段 1/2 的取材决策，属必须入册的事实。

## 主持人纠正（GitHub API 通道实证，非搜索）

会议过程中出现过两种相反判断，我用 GitHub API 逐仓库求证（搜索通道当时返回空，不可作为"不存在"的证据）：

| 仓库 | API 结果 | 许可 | 最近推送 |
|---|---|---|---|
| `Towzai/dsh-memory-jev` | **存在** | MIT | 2026-09-20 |
| `Fishsb/dsh-shoucang-memory` | **存在** | Apache-2.0 | 2026-09-23 |
| `Fishsb/dsh-plugin-roundtable` | 存在 | MIT | 2026-09-23 |

⇒ **正确的三分法是**：
1. **本机已装**：仅 `dsh-shoucang-memory` v0.3.1。
2. **npm 可得**：`dsh-memory` 0.1.0 / `dsh-graphmemory` 0.2.0 / `dsh-memoria` 0.1.0。
3. **npm 无、GitHub 有**：`dsh-memory-jev`（v0.4.1）、`dsh-shoucang-memory`。
——先前的「npm E404 ⇒ 查无此物」把第 3 类误判了，**必须按第 3 类处理：可 clone/取包，不可 `npm i`**。

## 更要紧的一条：`dsh-memory-jev` 与方案 §6 **逐条对得上**

我取到它的 README / package.json / cordis.patch.yml 原文：

· **三道门控完全一致**：Write gate（本地 bigram 预过滤 → 一次 Jev fan-out：`worth_keeping` noul + `supersedes` choice over candidates + none；失败 **fail-open，仍写入**，仅标 `gate=unavailable|budget`）；Recall gate（词法预过滤 top-N → 每候选一次 `rel_<id>` noul → 按概率过滤排序；失败**回退本地排序并标 `degraded`**）；Injection gate（挂在 **`agent/pre-step`**，廉价文本门 → 候选池减法 → Jev 相关性判断 → **尾部追加**框架化快照；失败 **fail-closed，什么都不注入**）。
· **I1/I2 不变式逐字一致**：每 `(session,turn)` 至多一块；每条记忆每 session 至多注入一次，且**已注入 id 在 Jev 调用前就从候选池移除**（连请求成本都不花）；压缩后 id 重新可注入（记 `reset`）。
· **安全边界一致**：`<retrieved-memories …>` 自标识 + 内容中每个 `<` 转义为 `\u003c`（**记忆无法伪造分隔符**）；前缀缓存友好（仅尾部追加，系统提示与历史逐字节不变）。
· **工具集一致**：`mem_remember/recall/list/view/forget/restore/merge/pin/gate_status/gate_log`，且 `mem_gate_log` 明写「ids and hashes only — **no bodies**」；**物理删除永不发生**。
· **工程细节方案没写但实现有**：`injectLimit: 3 / injectMinProbability: 0.6 / prefilterLimit: 40 / supersedeCandidates: 12 / dailyBudgetCny: 3.5 / dailyCallLimit: 3000 / storePath: ''`；`engines.node >= 22`；`test` 脚本是 `node --import ./tools/load-plugin.mjs tools/verify_all.mjs`（**同样是 node:test 系，不是 vitest**）。
· 依赖与通道：peer 为 `@deepseek-ai/cordis >=4`、`dsh-llm >=0.1`、`dsh-tools >=0.1`；**声明了云端网络面 `openrouter.ai/api/alpha/decisions` + `OPENROUTER_API_KEY`**（但 `offlineMode: true`）。

## 对落地方案的三条修正（请作者席据此改成品）
1. **阶段 1/2 不必从零自研三道门控**：`dsh-memory-jev` 是 MIT、Node≥22、行为与方案 §6 同构，**可作为「参考实现 + 可移植候选」**。但取件路径是 **clone/复制，不是 `npm i`**（npm 无此包）。若采用，须显式处理它的**云端 JEV 通道**（OpenRouter key）——本机无 key 时走 `offlineMode` 降级路径，这与本册 C8（改用本机 Ollama logprob 合成 noul）是同一问题的两种解法，**须二选一写死**。
2. **本机 `git clone github.com` 实测 443 不通**（主持人实测：`Failed to connect to github.com port 443`），而 **API 通道通**（可 `api.github.com/.../contents/<file>` 取单文件、`git/trees?recursive=1` 取全树）。⇒ 阶段 1 若需取件，**先解决通道问题或改用 API 逐文件取**，否则会卡在网络上。这条必须写进阻塞项。
3. **「未验证」不得升格，但「不存在」也不得误判**：成品里凡涉及这 6 个可复用件的表述，一律按上面三分法写，并注明取证方式（npm registry vs GitHub API vs 本机目录）——**三种通道结论不同，混用会得出相反的结论**。

[核心产出] 纠正性核实：① 三分法取代「查无此物」判定；② `dsh-memory-jev` v0.4.1 与方案 §6 逐条同构（含 7 个方案未写的实现参数），可作参考实现但须 clone 取件并处理其云端通道；③ 本机 clone 不通、API 通道通，取件路径须写明。
[下一步建议] 请作者席把本条并入成品第 1 章对照表（作为「判定纠正」条目）与阶段 1/2 取材节；请 verify 席在 R2 复核时把「三分法」与「API 通道实证」纳入核验。

**captain → rollout** · 2026-09-24 03:52:33

【R2 · 重要修正 · 工作项 r2-write】主持人在你写作期间做了一次**纠正性核实**，涉及成品的内容准确性，请务必并入。

**要纠正的是什么**：会议早期（含我本人）把方案 §15.3 的复用承诺判为「本机没装 ⇒ 查无此物」。这个判定**偏严**。我用 GitHub API 逐仓库求证（注意：**搜索通道当时返回空，不能当作"不存在"的证据**；clone 通道实测 443 不通；只有 API 通道通）：

| 仓库 | GitHub API 结果 | 许可 | 最近推送 |
|---|---|---|---|
| `Towzai/dsh-memory-jev` | **存在** | MIT | 2026-09-20 |
| `Fishsb/dsh-shoucang-memory` | **存在** | Apache-2.0 | 2026-09-23 |

⇒ 请把成品的复用件清单改为**三分法**（替换作业书第四节的第 1 条表述）：
1. **本机已装**：仅 `dsh-shoucang-memory` v0.3.1。
2. **npm 可得**：`dsh-memory` 0.1.0 / `dsh-graphmemory` 0.2.0 / `dsh-memoria` 0.1.0。
3. **npm 无、GitHub 有**：`dsh-memory-jev`（**v0.4.1**）、`dsh-shoucang-memory` —— 可 clone/取包，**不可 `npm i`**。
并注明三种取证通道结论不同（npm registry / GitHub API / 本机目录），混用会得出相反结论。

**第二条（更重要，直接改阶段 1/2 的实施写法）**：`dsh-memory-jev` v0.4.1 与方案 §6 **逐条同构**，我已取到 README/package.json/cordis.patch.yml 原文：
· 三道门控语义**完全一致**：Write gate（bigram 预过滤 → 一次 fan-out：`worth_keeping` noul + `supersedes` choice + none；失败 **fail-open 仍写入**，标 `gate=unavailable|budget`）；Recall gate（词法 top-N → 每候选 `rel_<id>` noul；失败**回退本地排序标 `degraded`**）；Injection gate（挂 **`agent/pre-step`**，失败 **fail-closed 什么都不注入**）。
· I1/I2 不变式逐字一致（含「已注入 id 在 Jev 调用前就从候选池移除」）。
· 安全边界一致：`<retrieved-memories …>` 自标识 + 内容 `<` 转义 `\u003c`（**记忆无法伪造分隔符**）；前缀缓存友好（仅尾部追加）。
· 工具集一致：`mem_remember/recall/list/view/forget/restore/merge/pin/gate_status/gate_log`；审计日志**只有 id 与哈希、无正文**；**物理删除永不发生**。
· **方案没写、实现有的 7 个参数**：`injectLimit: 3`、`injectMinProbability: 0.6`、`prefilterLimit: 40`、`supersedeCandidates: 12`、`dailyBudgetCny: 3.5`、`dailyCallLimit: 3000`、`storePath: ''`。
· `engines.node >= 22`；其 `test` 脚本是 `node --import ./tools/load-plugin.mjs tools/verify_all.mjs` ⇒ **同样是 node:test 系，再次佐证 C3「不用 vitest」是对的**。
· 它声明了**云端通道** `openrouter.ai/api/alpha/decisions` + `OPENROUTER_API_KEY`，但同时 `offlineMode: true`。

⇒ 写成品的两条结论：
(a) **阶段 1/2 不必从零自研三道门控**：可把 `dsh-memory-jev` 作「参考实现 + 可移植候选」，但取件是 **clone/复制**、不是 `npm i`。
(b) **JEV 承载须二选一写死**：沿用它的 OpenRouter 云端通道（本机无 key，须处理降级），或按本册 C8 改用本机 Ollama logprob 合成 noul（实测 `yes=0.887/no=0.101`）。**两条不能都留着不决定**。

**第三条（阻塞项）**：主持人实测本机 `git clone https://github.com/...` **443 不通**（原文 `Failed to connect to github.com port 443`），而 **API 通道通**（可取单文件 contents、可取全树 trees?recursive=1）。⇒ 阶段 1 若依赖取件，须先解决通道或改走 API 逐文件取，否则会卡在网络上。这条要写进阻塞项清单。

**边界不变**：只写 `D:\Mana\docs\mana-rollout-plan.md`。其余照旧，写完交回。

**captain → verify** · 2026-09-24 03:52:56

【R2 · 第二波预告 · 工作项 r2-review-verify】作者席正在写成品（`D:\Mana\docs\mana-rollout-plan.md`），你将在它交付后开工复核。**先把判据与方法固定**，届时直接跑。

你的三个复核面（按重要性排序）：

**面 1 · 实测数字保真（最重要）**
成品会大量引用各席实测数字。请抽查**至少 8 个**，回素材原文逐字比对，看有没有被四舍五入、截断或升格。重点抽查这几个（它们最容易被「美化」）：
· `vec0.dll` 体积 **289,280 B**（有没有被写成「约 290KB」）
· 暴力 JS 余弦 10k = **20.92 ms** vs vec0 KNN 10k = **35.877 ms**（这一对是 C4 决策依据，若被写成「量级相当」则决策依据失真）
· 热态三件套和 = **55.46 ms**
· `vec_version()` = **v0.1.9**
· 样板测试 **365/365** 通过、`2.59 s`；`typecheck` **exit 2 / 7 条 error**
· bge-m3 **dim=1024**、重复 cos=**1.000000**、改写 **0.784169**、无关 **0.336102**、冷启 **1037 ms**、热 p95 **19.2 ms**
· RRF k=60 锚点：ranks[1,1]=**0.032787**、[1,50]=**0.025484**、[50,50]=**0.018182**
· 衰减 h=14：decay(0)=**1.000000**、decay(14)=**0.500000**、decay(90)=**0.011609**
· ACT-R：B{[1]}=**0.000000**、B{[1,2]}=**0.534800**、B{[1,2,4,8]}=**0.940265**、B{[1,1]}=**0.693147**
· 样本量门槛：p=0.5→**385**、0.75→**289**、0.8→**246**、0.85→**196**、0.9→**139**
素材在 `D:\Mana\.roundtable\_extract\`（`14-accept.md` 数字最密、`21-impl.md` 次之、`18-verify.md` 是你自己 R1 的核验表）。

**面 2 · 命令真能跑（抽 3 条实跑）**
成品里的判据命令要求「可直接粘贴到 PowerShell」。请至少实跑 3 条，优先选这几类：
· `node --test` 类（注意：写 `node --test tests/` 是**错的**——实测报 `Cannot find module ...\tests` 但会打印 `# tests 1 / # fail 1`，形似测试失败；正确是 `node --test "tests/*.test.mjs"` 或 `node --test` 无参。**这是主持人已实测的陷阱，若成品写错请标出**）
· `git status --porcelain` 类（基线应为 **15 行**、HEAD `a8c8bb7`）
· node:sqlite 探针类（`{allowExtension:true}` 开库；`exec('PRAGMA ...')` 返回 `undefined`，读回必须 `prepare().get()`）

**面 3 · 「未验证」是否被升格**
各席诚实标注了未验证项，成品**不得把它们升级成已确认**。请核这几处：
· 宿主进程内 `fetch` 打 11434 —— impl 席只做了三条间接实证（无法注入运行中宿主进程），**仍属未验证**
· §9.3 事件契约全文语义、§13.1/§13.2 死阈值 —— rollout 席 R1 未读，属未读不属已证
· `dev_*` 工具的注入/卸载可调用性 —— rollout 席工具集内无此工具，**未由本席验证**
· 方案 §17 各阶段时长的实测依据 —— 不存在
· 多设备同步 —— 全文五字零设计

**边界**：只读。临时探测放 `$env:TEMP` 并自行清理；禁止 `npm install` 到任何既有 profile；禁止在 `D:\Mana` 下落任何东西（`.roundtable` 与会话记录除外）。

**现在不必动作**——作者席交付后我会立刻唤醒你开工。届时请按「预注册判据 → 实跑 → 裁定」的顺序出核验表，逐条裁「成立 / 部分成立 / 不可复现」并给证据强度。

**verify → 汇聚网关** · 2026-09-24 03:54:51

[当前状态] R2 工作项 r2-review-verify 开工前准备完成（成品尚未存在，`D:\Mana\docs\mana-rollout-plan.md` = False；素材目录 `D:\Mana\.roundtable\_extract\` 已就位 8 份 md）。本席**趁等待期把三条复核面的判据预注册完毕，并独立重算了全部会比对到的锚点值** —— 这样成品一到手，凡被四舍五入/截断/升格的数字都会在比对中显形。**已经发现 5 处「主持人给我的数字与我独立实测不符」**，必须在作者席定稿前处理，否则会被原样抄进成品。

## 一、预注册判据（成品到手即直接跑）

**面 1 · 数字保真**：判据 = 成品中每个数值与素材原文**逐字符相同**（含位数、量级词、单位）。凡「约/≈/量级相当/几十毫秒」等替换精确值的写法 **一律判失真**，不判「简化」。抽 ≥8 个。
**面 2 · 命令可跑**：判据 = 把成品里的命令**原样复制**到 pwsh 跑，exit code 与输出必须与成品声称一致；跑不通或需人工改写即判不可执行。抽 ≥3 条。
**面 3 · 未验证升级**：判据 = 成品中任何被素材标注「未验证/未读/本席工具集内无」的事项，若在成品里失去该标注（或被写成「已确认/已实证/可复用」），判升格。逐条对 5 项清单 + R1 核验表的「未验证项」段。

## 二、我已独立重算的锚点（成品数字将以这些为比对基准）

**逐字复现（与主持人所给完全一致，可直接采信）**
```
RRF k=60:  [1,1]=0.032787  [1,50]=0.025484  [50,50]=0.018182
衰减 h=14: decay(0)=1.000000  decay(14)=0.500000  decay(90)=0.011609
ACT-R:     B{[1]}=0.000000  B{[1,2]}=0.534800  B{[1,2,4,8]}=0.940265  B{[1,1]}=0.693147
样本量(e=0.05,z=1.96): p=0.5→385  0.75→289  0.8→246  0.85→196  0.9→139
vec0:      vec_version()="v0.1.9"  vec0.dll=289280 B
typecheck: exit code=2，error TS 恰 7 条（内容亦逐条对上，见 §三）
测试:      365 tests / 365 pass / 0 fail（静态 test( 注册数亦 = 365）
bt 基线:   git status --porcelain = 15 行；HEAD = a8c8bb7e1f2d64302ca91c69d7a4e32f73803c40
```
以上 9 组是**可作死数写进验收判据**的确定性锚点（算术类与版本类，跨运行稳定）。

**⚠ 不符（5 处，请作者席不要照抄主持人数字）**

| 项 | 主持人数字 | 本席实测 | 处置建议 |
|---|---|---|---|
| 暴力 JS 余弦 10k×1024 | 20.92 ms | **avg 8.40 / min 7.53 / max 9.58 ms** | 见下 §三-A |
| vec0 KNN 10k×1024 | 35.877 ms | **avg 11.17 / min 10.77 / max 11.42 ms** | 同上（同进程、同数据、同维度） |
| bge-m3 冷启 | 1037 ms | **77.2 ms**（该次模型已在显存） | 冷启强依赖模型是否常驻，**不可作死数** |
| 改写相似度 | 0.784169 | **0.979985**（近义改写句对） | 强依赖具体句对，**不可作死数** |
| 无关相似度 | 0.336102 | **0.393894**（换主题句对） | 同上 |
| 样板测试耗时 | 2.59 s | **1.83 s（duration_ms）/ 1.96 s（wall）** | 耗时随负载浮动，**判据只钉 365/365** |
| 重复 cos | 1.000000 | **1.000000** ✓ | 唯一稳定的那档，可作死数 |

## 三、等待期新发现的 4 个硬缺陷（会直接写坏实施步骤/验收判据）

**A. C4 决策依据（vec0 vs 纯 JS）在两方实测下方向一致，但比值不同 —— 结论稳、数字不稳**
我做的 A/B 是**同进程、同 10k×1024 数据、同查询向量**：
```
JS 暴力余弦 10k×1024  x5: min=7.53  max=9.58  avg=8.40 ms
vec0 KNN   10k×1024  x5: min=10.77 max=11.42 avg=11.17 ms   →  vec0 慢 1.33 倍
```
与主持人口径（20.92 vs 35.877 → 慢 1.71 倍）**方向一致、比值不同**。⇒「量级相当、vec0 在 1 万条规模下无优势」这个**结论成立且稳健**；但**任何一个绝对毫秒数都不能写进成品**（跨机、跨负载、含/不含预热都会变）。请写成「两法同为十毫秒量级，差值 <1.8 倍」，并把死数判据改成**比值上界**（如 `vec0_ms / js_ms < 3`），而不是绝对毫秒。

**B. vec0 默认度量是 L2 不是余弦 —— 方案 §15.5 行1042「vec0 虚拟表（余弦相似度）」欠一句建表参数**
```
t1 默认:        距离=[0, 0.8944271802902222]   ← 等于 L2 期望 0.8944271910
t2 distance_metric=cosine: 距离=[0, 0.3999999761581421]  ← 等于 1-cos 期望 0.4
```
⇒ 不写 `distance_metric=cosine` 就**默认 L2**。这对方案 §7.1/§15.5 的「余弦」语义是**静默偏离**（不报错、结果排序会变），属「让失败不可观测」类。实施步骤必须显式写建表语句。

**C. vec0 的两个运行期硬约束（不写进文档，实施者必踩）**
```
① rowid 必须 BigInt：ins.run(1, buf) → ERR: Only integers are allows for primary key values on vv
   （对照：普通表 plain(id integer primary key) 插 JS number 7 → typeof='integer' 正常）
   ins.run(1n, buf) → OK
② KNN 查询必须有 LIMIT：select ... where embedding match ? order by distance  → ERR: A LIMIT or 'k = ?' constraint is required on vec0 knn queries
   加 limit 5 后 OK
```
这两条都是**报错但信息不完整**的失败模式（`'Only integers are allows'` 里的 `allows` 是上游拼写错误），实施者极易误判为库损坏。

**D. 样板测试套件有一个隐藏前置依赖：`.gitattributes`**
```
复制 test/ + package.json + .gitignore 到影子副本跑 → 364 pass / 1 fail，not ok 239「行尾契约：.gitattributes 存在且把源文件固定为 LF」
补上 .gitattributes 再跑 → 365 pass / 0 fail
```
⇒ 若阶段 0 照抄样板测试面却漏 `.gitattributes`，**365 变 364 且红项是「行尾契约」而非任何实现问题** —— 这正是「失败不可观测」的教科书形态。成品若引用 365/365，必须同时写明该前置件。

## 四、面 2 「命令真能跑」——我已在等待期把 3 条候选全部预跑，等你成品落地直接比对

| 命令 | 预跑结果 |
|---|---|
| `node --test "test/*.test.mjs"`（glob） | `# pass 365 / # fail 0`，exit **0** ✓ |
| `node --test`（无参自动发现） | `# pass 1 / # fail 0`，exit **0** ✓ |
| `node --test tests/`（目录） | `Error: Cannot find module '...\tests'` + `# tests 1 / # fail 1`，exit **1** ← **形似测试失败，实为命令写错**。已验证 `tests` / `tests/` / `./tests` / `./tests/` **四种写法全败**，主持人所报陷阱成立 |
| 真红对照（断言失败） | `# pass 0 / # fail 1`，exit **1** ✓（exit code 确能区分红绿） |
| `git status --porcelain` | 15 行；`git rev-parse --short HEAD` → `a8c8bb7` ✓ |
| 

…（已截断，原长 5969 字符）

**captain → rollout** · 2026-09-24 03:55:27

【R2 · 紧急修正 · 工作项 r2-write】主持人此前给你的「抄实测数字不许走样」这条指令，**需要加一个重要限定**。请务必按本条改，否则成品会钉进不可复现的数字。

**发生了什么**：另一席在等待期把成品将引用的数字**独立重算了一遍**（同机、不同时刻），结果如下：

| 项 | 主持人/accept 席测得 | 该席独立复算 | 差异 |
|---|---|---|---|
| JS 暴力余弦 10k | 20.92 ms | **8.40 ms** | 2.5× |
| vec0 KNN 10k | 35.877 ms | **11.17 ms** | 3.2× |
| bge-m3 冷启 | 1037 ms | **77.2 ms** | 13× |
| 改写句相似度 | 0.784169 | **0.979985** | 显著 |
| 无关句相似度 | 0.336102 | **0.393894** | 显著 |

**根因**：这些是**单次采样的性能/浮点量**，受负载、缓存warm/cold、文本选择影响 ⇒ **跨运行不可复现**。而 RRF / 衰减 / ACT-R 那些**数学闭式值**两席逐字复现（`0.032787`/`0.500000`/`0.534800` 等完全一致）。

**因此请把「抄数字」规则改成分档**：

**A 档 · 确定性值 ⇒ 照抄，保留原始精度**（两席复现一致）
· `vec_version()` = `v0.1.9`；`vec0.dll` = `289,280 B`
· RRF k=60：`[1,1]=0.032787`、`[1,50]=0.025484`、`[50,50]=0.018182`
· 衰减 h=14：`decay(0)=1.000000`、`decay(14)=0.500000`、`decay(90)=0.011609`
· ACT-R：`B{[1]}=0.000000`、`B{[1,2]}=0.534800`、`B{[1,2,4,8]}=0.940265`、`B{[1,1]}=0.693147`
· 样本量门槛：`385/289/246/196/139`
· 测试 `365/365`、`2.59 s`；`typecheck` **exit 2 / 7 条 error**；`git status --porcelain` **15 行**、HEAD `a8c8bb7`
· 各类 **exit code / 计数 / 版本号** —— 这些是稳定的，照抄

**B 档 · 浮动量 ⇒ 不许写成固定阈值**（上表 5 个）
· 写法一（推荐）：**改成比值上界**。原文「vec0 比 JS 余弦快 1.71×」这个比值经复算收敛到 **1.33×**，两席结论方向一致（**一万条规模下 vec0 无优势**）⇒ 写成「vec0 ÷ 暴力余弦 **≤ 1.5×**（两席独立采样落在 1.33–1.71 之间）」。
· 写法二：写**同一进程内 A/B 对照的比值**，不写绝对毫秒。
· 写法三：绝对毫秒只作为「**测量条件说明**」出现（注明采样时刻/负载/样本数），**不得进判据的阈值列**。
· 冷启同理：不要写 `1037 ms` 当阈值，写「首次调用含模型加载，实测跨采样 77 ms–1037 ms ⇒ 首调失败线由阶段 2 首日自测自设」。

**这条本身就是成品价值的一部分**：请在成品里写明「为什么性能数字不进阈值列」——因为同一台机器两次独立采样差 2.5–13 倍，**绝对毫秒跨负载不可判**；能进放行闸的是比值上界、计数与 exit code。这正是本册「禁止不可判定表述」的延伸。

---

**另有 4 个硬缺陷须写进实施步骤**（该席等待期实测新发现，都很关键）：

1. **vec0 默认度量是 L2，不是余弦** —— 不显式写 `distance_metric=cosine` 会**静默偏离**方案 §7.1/§15.5 的「余弦」语义（实测同一对向量：L2 距离 `0.8944` vs 余弦距离 `0.4000`）。⇒ 建表必须显式指定度量，否则「检索语义」与设计不符且**不报错**。
2. **vec0 的 `rowid` 必须是 BigInt** —— 传 `1` 报 `Only integers are allows for primary key values`，必须传 `1n`；而普通表用 number 正常。⇒ 同一进程里两套 id 语义并存，是易错点。
3. **vec0 KNN 查询必须带 `LIMIT` 或 `k=?`** —— 否则直接报错。
4. **样板测试套件依赖 `.gitattributes`** —— 缺失则测试数从 `365` 变 `364`，且红的项是「行尾契约」而非实现问题。⇒ 阶段 0 起手抄样板时须一并抄 `.gitattributes`，否则会得到一个看起来像 bug 的假红。

以上 4 条都请落到对应的实施步骤里（vec0 三条落阶段 2 向量检索、`.gitattributes` 落阶段 0 工程骨架）。

【边界不变】只写 `D:\Mana\docs\mana-rollout-plan.md`。写完交回。

**captain → verify** · 2026-09-24 04:01:00

【R2 · 开工指令 · 工作项 r2-review-verify】成品已落盘，请立即按你已预注册的判据开始复核。

**成品**：`D:\Mana\docs\mana-rollout-plan.md`
· 67808 字节 / 389 行（**用 `Get-Content -Encoding UTF8` 读**；本机 PowerShell 是 5.1，缺省编码为 gb2312，不显式指定会显示乱码——文件本身是合法 UTF-8、无 BOM、无替换字符，我已用严格解码校验过）。
· 结构：§0 速览 / §1 基线核验（15 条相悖清单）/ §2 先决阻断项（G1–G15 + vec0 四条语义）/ §3 分期总览 / §4 七阶段详述 / §5 人工判据 / §6 阈值与数字纪律 / §7 未验证项 / §8 决策记录 C1–C15 / §9 取证方式。

**重要背景（影响你的复核口径）**：作者席**上下文耗尽退场**，只写到第 2 章头（前 100 行）就停了；**第 2 章之后的全部内容由主持人（我）亲自续写**。所以本件是「作者席的前 100 行 + 主持人的其余部分」。请**照常按判据复核，不必顾忌作者是谁**——你此前的判据就是为复核而预注册的，我的部分同样接受复核（有冲突以你的实跑为准）。

**三个复核面照原计划执行**：

**面 1 · 实测数字保真（抽 ≥8 个）** —— 重点看我有没有把你的重算结果用错。
特别请你核这几处（我改写过口径，最容易出错）：
1. §6.0 分档表里，我把 JS 余弦 `20.92` vs `8.40 ms`、vec0 KNN `35.877` vs `11.17 ms`、冷启 `1037` vs `77.2 ms`、改写 `0.784169` vs `0.979985`、无关 `0.336102` vs `0.393894` 列为 **B 档（浮动）**——这与你的重算一致吗？
2. §8 C4 我写的是「两席采样比值 `1.33–1.71`，**方向一致：一万条规模 vec0 无优势**」——比值区间对不对？
3. A 档清单（RRF / 衰减 / ACT-R / 样本量 / 版本号 / 计数 / exit code）是否**全部**经你独立复现？
4. §2 的 G1 与 §6.0 是否口径自洽（B 档定义是否一致）？

**面 2 · 命令真能跑（抽 ≥3 条实跑）** —— 我写的命令都要能粘贴执行。请至少实跑：
· A0-7（`node --test "tests/*.test.mjs"` vs `node --test tests/` 的对照）
· A0-10 / A6-3（受保护仓 `git status --porcelain` 行数与 HEAD）
· §2.1 的 V-1/V-3（vec0 `distance_metric=cosine` 与「KNN 必须带 LIMIT」——**我已亲自复现 V-3**：不带 LIMIT 报 `A LIMIT or 'k = ?' constraint is required on vec0 knn queries.` errcode 1）

**面 3 · 「未验证」是否被升格（逐项）** —— 我列了 10 条未验证项在 §7，请逐条核**有没有被我偷偷升格**。特别核：
· 宿主进程内 `fetch` 打 11434（我写成「当前可直接用，但**此结论仍属未验证**」——这个措辞够不够保守？）
· `dev_*` 可调用性（我标「须由具备该工具链的执行席运行」）
· §9.3 全文 / §13.1-13.2 死阈值 / §17 时长 / 多设备同步 / 认知参数数值

**另加一条我自查发现、需要你独立验证的事**：
我在 §0 把批次数从姊妹稿的「17」改正为「**18**」（逐行 `3+5+2+2+2+2+2`），关键路径仍标 11。请核这个数**算得对不对**、以及「关键路径 11」与 §3.2 的依赖图是否自洽。

**边界**：只读成品与素材；临时探测放 `$env:TEMP` 并清理；不得 `npm install`；不得改 `D:\Mana\docs\mana-rollout-plan.md`（发现问题写进核验表，由我改）。

出核验表（结论 / 裁定 / 证据 / 反例），逐条裁「成立 / 部分成立 / 不可复现」并给证据强度。

**captain → accept** · 2026-09-24 04:01:13

【R2 · 开工指令 · 工作项 r2-review-accept】成品已落盘，请开始复核**验收完整性**。

**成品**：`D:\Mana\docs\mana-rollout-plan.md`（67808 字节 / 389 行）
⚠ **读取姿势**：本机是 PowerShell 5.1，缺省编码 gb2312，必须 `Get-Content -Encoding UTF8`，否则会显示乱码（文件本身是合法 UTF-8、无 BOM，我已严格校验）。

**重要背景**：作者席上下文耗尽退场，只写到第 2 章头（前 100 行）；**其余部分由主持人亲自续写**。你的验收判据（A 组 26 条 / B 组 6 条）是我写作时的主要素材来源，所以我**最需要你查的就是：我在搬运你的判据时有没有走样**。请照常复核，不必顾忌作者是谁。

**你要查的三件事（按你原定判据）**：

**① 七阶段是否每阶段四要素齐备（判据 / 检查方式 / 阈值 / 退回动作）——逐阶段计数**
请核对：§4 的每个「N.2 验收方案」节里，判据表是否**四列俱全**（ID / 判据 / 检查方式 / 阈值 / 退回动作）。
我自检的计数是：阶段 0 = **10** 条、阶段 1 = **12** 条、阶段 2 = **8** 条、阶段 3 = **5** 条、阶段 4 = **3** 条、阶段 5 = **3** 条、阶段 6 = **3** 条，**合计 44** 条自动判据 + 6 条人工判据（§5）。请核这个数，并指出**有没有哪条缺了四要素中的某一项**。

**② 有无不可判定表述残留**（「良好」「及时」「较大」「基本」「尽量」等）
请全书扫一遍，凡不可判定表述**逐条列出位置与原文**。我写作时刻意避免了，但可能有漏网。

**③ 有无未经实测的目标值被当阈值采纳**
这是最关键的一条 —— 方案 §13.2 的 7 个目标值（`>85%` / `R²>0.8` / `<500ms` / `>80%` / `<5%` / `>40%` / `>75%`）**全部无实测基线**。
我的处理是：**一律不写进阈值列**，改标「待定，需首测后自设」，并在 §6.1 列了「首次实测落在哪个阶段 + 所需样本量」。
请你核：① 有没有哪一处我**偷偷把它们当阈值用了**？② §6.1 的样本量（`385/289/246/196/139`）与你算的是否一致？③ §6.1 里「检索延迟用阶段 2 首日 p95 × 1.2 自基线」这个替代口径是否可执行？

**另请特别核这两处（我做了改写，怕改变你原意）**：
- **A2-4 检索延迟**：我写成「B 档，端到端未做 ⇒ 放行线 = 阶段 2 首日实测 p95 × 1.2 自设基线。**不采用方案固定 500ms**」。是否忠实于你的原判？
- **缓存命中率口径**：我在 §6.1 末尾写「`jev_log.cached`（JEV 判断缓存）与 §14 行980 的 LLM 前缀缓存是**两个不同的缓存共用一个词**；后者全文无落点 ⇒ 若取不到就**如实标不可观测**，不得用代理量当判据」。这个处理是否与你的原意一致？

**④（追加）反证判据完整性**
我在每阶段末尾都加了「反证判据」（R0–R5）：卸载后同一触发**不再产生新行**。请核：**七阶段是否每阶段都有反证判据**？有没有哪个阶段的反证判据实际上**判不了**（例如 A5-3 多设备同步我直接标了「不得写进验收」，那阶段 5 的反证是否还成立）？

**边界**：只读。**不要改** `D:\Mana\docs\mana-rollout-plan.md`（发现问题写进复核意见，由我统一修订）；临时探测放 `$env:TEMP` 并清理；不得安装任何包。

出验收完整性核验表（阶段 / 四要素齐备性 / 问题项 / 裁定）。

**accept → 汇聚网关** · 2026-09-24 04:11:27

[当前状态] R2 只读复核完成。成品 sha256 `8D2281CD…E943`、67808 B、578 行、LF-only、无 BOM，复核前后未变（复核期间我只读，未改一字）。**结论先行：你自检的计数全部属实（44 + 6），§6.1 样本量与我的算式逐字相同；但有 3 类问题会让「门禁看起来是绿的」。**

════ 一、① 七阶段四要素齐备性 —— 逐阶段计数（机检）

| 阶段 | 判据数 | 你自检 | 裁定 |
|---|---|---|---|
| 阶段 0 | **10**（A0-1…A0-10） | 10 | ✅ 一致 |
| 阶段 1 | **12**（A1-1…A1-12） | 12 | ✅ 一致 |
| 阶段 2 | **8**（A2-1…A2-8） | 8 | ✅ 一致 |
| 阶段 3 | **5**（A3-1…A3-5） | 5 | ✅ 一致 |
| 阶段 4 | **3**（A4-1…A4-3） | 3 | ✅ 一致 |
| 阶段 5 | **3**（A5-1…A5-3） | 3 | ✅ 一致 |
| 阶段 6 | **3**（A6-1…A6-3） | 3 | ✅ 一致 |
| **合计** | **44** | 44 | ✅ 一致 |
| 人工 | §5 表 H1–H6 = **6** | 6 | ✅ 一致 |

**但「齐备」在 GFM 渲染口径下不成立 —— 有一条会掩盖其他问题的缺陷（排在第一）：**

**★ D-1｜5 行表格被未转义的 `|` 撑裂，整行错位（最严重，因为它让判据本身不可读）**
`|diff|` 这个绝对值符号里的两个 `|` 没有转义，按 GFM 会被当成列分隔符。实测有效列数（未转义竖线计数）：
- **L280（A1-4）列数 7**、**L281（A1-5）列数 7**、**L329（A2-1）列数 7**、**L330（A2-2）列数 7**、**L373（A3-4）列数 7** —— 表头只有 5 列。
- 后果（逐格直读证实）：这 5 行的**阈值列被截断在 `` 处**，而**退回动作列里只剩 `diff` 或 `diff`**。即：**5 条核心判据（RRF / 时间衰减 / ACT-R / 检索概率 / 衰减自洽）的「退回动作」在文档里已经丢失**，只剩一个字符串 `diff`。这不是排版问题——第 4 要素消失。
- **修法**：把这 5 处 `|diff| ≤ 1e-6` 改为 `\|diff\| ≤ 1e-6`（或直接写 `abs(diff) ≤ 1e-6`）。
- 反例佐证修法可行：**L235 与 L436 用了 `\|` 转义，有效列数 = 5，未被撑裂**（L183 里程碑行同样裸写，但那是 3 列表，多出的竖线只把 M4 行撑成 5 列，影响较小，建议同修）。

**其余四要素缺项（真实缺项，非渲染问题）：**

| 行 | ID | 缺什么 | 判定 |
|---|---|---|---|
| L333 | A2-5 | **缺退回动作**（填 `—`） | 阈值本就是「待定」，退回动作可暂缺 → **可接受，但须标「随阈值一并定」** |
| L406 | A4-1 | **缺退回动作**（填 `—`） | 同上 |
| L407 | A4-2 | **缺退回动作**（填 `—`） | 同上 |
| L437 | A5-3 | **缺检查方式 + 缺退回动作**（都填 `—`） | **不算缺** —— 该条自我声明「不得写进验收」，本就不该以判据形式占据表格行；建议移出表格改作注记（否则读者会以为它是可通过/不通过的门） |

**★ D-2｜A5-3 占了判据 ID 却不是判据，且它是阶段 5 唯一的「实质缺口出口」**
A5-3「多设备同步」的检查方式是 `—`、阈值是「标未验证」——**一个没有检查方式的行坐在放行闸的表格里**，是最容易被误读成「这条我们验过了」的形态。建议：从 A 表删除，移入 §7 未验证项（那里已有第 6 条「多设备同步」）。

**★ D-3｜判据表内出现 `degraded=1 且显式标记` —— 「显式标记」本身不可判定**
**L287（A1-11）阈值列**原文：`` `degraded=1` 且**显式标记**；不得出现「provider 失败但结果与正常空结果同形」``。前半句可判（数值），后半句「显式标记」未指字段名。建议收紧为：**「`jev_log.degraded` 与 `jev_log.gate` 至少一个非空且取值 ∈ {unavailable, budget, degraded}」** —— 你在 A1-8 已经这么写了（L284），A1-11 只需复用 A1-8 的字段口径即可。这是全书唯一一处阈值列内的模糊词（全表扫过，其余干净）。

════ 二、② 不可判定表述残留 —— 全书广扫（12 个词族，逐处）

扫「良好/及时/较大/大幅/基本/尽量/合理/适当/快速/较快/较多/明显/显著/足够/差不多/大概/优秀/充分/较高/较低/尽快/大致/稳定/可靠/可接受/符合预期/较好」等：**全书命中 9 行，其中 8 行无害、1 行须改。**

- **L186（M7 里程碑）★须改**：「6/6 消融组各有 output 且差异方向**符合预期**」——「符合预期」= 无判据。你在 A6-1（L458）已经写对了（「差异方向与方案预期一致」，且方案 §13.3 给出了每组的方向），但里程碑表这里留了模糊版。**修法**：把 A6-1 的「按 §13.3 逐组写出方向」抄进来。
- L182（M3）：`**有数**（非「性能良好」类表述）` —— 这是**引用反面例子**，不是自用，**不算残留**（我原话里就点了这个词作反例）。
- L122（G14）：`（基本无区分度）` —— 该行紧接着给了硬数 `[0.266, 0.405]` 窄带，属修辞。建议顺手删「基本」，不影响判定。
- L23 / L110 / L445 / L452 / L406（「可靠性加固」「可靠性曲线」）—— 「可靠性」在此是**领域名词**（reliability engineering），非判据形容词，**不算残留**。
- L398（阶段 4 内 `不是错误，是「这个偏好不稳定」`）—— 「不稳定」有硬口径（30 天内改 ≥3 次），是解释性措辞，**不算残留**。

════ 三、③ 未经实测的目标值是否被偷偷当阈值 —— **未发现**

逐值穷举全书出现位置（机检）：
- `>85%` → 仅 **L502**（§6.1 表格「方案原值（不可直接采用）」列）✅ 未被当阈值
- `R²>0.8` → 仅 **L503**（同上）✅
- `<500ms` → L38 / L58 / L122 / L303 / L504 是**批判性引述**；**L332（A2-4）明确写「不采用方案固定 500ms」** ✅
- `>80%` → 仅 **L505** ✅
- `<5%` → 仅 **L506** ✅
- `>40%` → **L507、L512**（§6.1 正文，并明确要求限定是哪个缓存）✅
- `>75%` → L184（M5 里程碑写「需首测后自设」）、L407（A4-2 写「无实测」）、L508 ✅
- **裁定：零处被当阈值采用。** 且 §0 第 36–39 行与 §8 C7 两处显式把「七个目标值」列为不可采信项，处理得当。

**★ D-4｜§6.1 样本量的口径与用途不匹配（最关键的一条 —— 会导致「样本够了但判不出来」）**
我复核了你的四个数：`p=0.85→196`、`p=0.80→246`、`p=0.75→289`、`p=0.50→385` —— **与我算的逐字相同**（正态近似，95%，±5pp，z=1.959964）。`p=0.90→139` 亦同。**算式无误。**
但**这些 n 只能「估准」，不能「证成」**：半宽 ±5pp 意味着你只能确认「真实命中率落在 85%±5pp = [80%, 90%]」，**永远无法据此判定「是否 >85%」**。要「判定」，半宽必须显著小于 5pp：
- 半宽 ≤3pp：p=0.85 需 **545**、p=0.80 需 **683**、p=0.75 需 **801**、p=0.40 需 **1025**
- 半宽 ≤2pp：p=0.85 需 **1225**、p=0.80 需 **1537**、p=0.75 需 **1801**
**修法**：§6.1 表头把「所需样本量」拆成两列 ——**「估准（±5pp）」与「可判定（半宽 ≤ 目标距离的 40%）」**，或至少加一行注：「本列样本量只保证估准，不足以判定是否达标；判定用样本量见下」。

**★ D-5｜两个「—」是漏算，不是「无」**
- **缓存命中率 `>40%` → 册中写「—」**，实测应有 `n ≥ 369`（p=0.40, ±5pp）。
- **JEV 降级率 `<5%` → 册中写「—」**，这是**「零事件」型判据**，公式不同：连续 **60** 次无降级 ⇒ 95% 上界恰 **5.00%**（58 次=5.17%、100 次=3.00%、200 次=1.50%）。**建议直接写「连续 ≥60 次调用无降级 = 通过」** —— 这是可直接粘进验收的可判定阈值。
- **遗忘曲线 R²>0.8 → 册中写「—」**，这是一个**会给出假通过的

…（已截断，原长 10720 字符）

**captain → accept** · 2026-09-24 04:14:35

【R2 · 修订复核 · 工作项 r2-review-accept】你的 9 项复核意见**全部采纳并已修订**。请复核修订是否真的到位（尤其 D-1 那种「表面看不出、实际丢列」的）。

**成品已更新**：`D:\Mana\docs\mana-rollout-plan.md`（**71838 字节 / 592 行**，原 67808/389）。读取务必 `Get-Content -Encoding UTF8`。

**逐条修订说明（请对应核）**：

| 你的编号 | 修订动作 | 请你核什么 |
|---|---|---|
| **D-1** | 五处 `|diff|` 全部改为「绝对差」文字（行280/281/329/330/373 附近），模板行 M4 同改 | **列数是否真回到 5**；五条判据的「退回动作」是否**在渲染后仍可见** |
| **D-4** | §6.1 记忆命中率一栏改为：明写「±5pp 只能**估准**不能**证成**，区间 `[80%,90%]` 覆盖 `85%` ⇒ 永远判不出 `>85%`；证成需 **n ≥ 545–1801**，估值需 `n ≥ 196`」 | 这段表述是否准确反映你的原意；545–1801 这个区间对不对 |
| **D-6** | A2-4 **删掉我自加的 `×1.2`**，改为「放行线不采用方案 500ms，**也不采用 p95×1.2**（裕度小于实测浮动下限 **2.5×**，该闸会被当噪声忽略）⇒ 只写同进程 A/B 比值，绝对值仅作测量条件说明」 | 是否回到你的原判；「2.5×」引用是否恰当 |
| **D-7** | 阶段 6 补 **A6-4 装配判据** + **R6 反证判据**（三条腿补齐） | 阶段 6 现在是否三条腿齐全 |
| **D-8** | R5 删掉「Slot 消失」，改为照抄 R1-b 的**活体端点形态**（并引用你实测的 `queries`=**1771**） | 改后的 R5 判得了吗；1771 这个读数引用是否恰当 |
| **D-5** | §6.1 三处「—」补全：缓存率 `n ≥ 369`；降级率改「**连续 ≥60 次判定无降级 = 5.00% 上界**」；R² 改「**CI 下界 > 0.8**（需观测 ≥0.90 且 n≥100，点估计>0.8 会给假通过）」 | 三个数对不对 |
| **D-2** | **A5-3 撤回**（多设备同步已移出范围，占 ID 会给假覆盖感），改为声明段落；新 A5-3 改为「认知轨迹回放可复现」 | 这样处理是否恰当 |
| **D-3** | A1-11 的「显式标记」改为**可枚举字段断言**：`degraded === true` 且 `gate` 非空**且** `items[]` 排序依据字段为 `local_score` | 现在可判定了吗 |
| 悬挂引用 | `§2 B12` → **§2 G9**；`§2 B13` → **§2 G12**（作者席早期编号 B12/B13 与我续写的 G1–G15 未同步，已修） | 是否还有别的悬挂引用（请全书扫一遍） |
| 零判据交付物 | 补 4 条：**A0-11**（独立心跳新鲜度≤10min）/ **A0-12**（契约快照哈希）/ **A4-4**（`user_model_history` 可回溯）/ **A5-3**（轨迹回放逐项相等且不写回） | 四处是否都补齐；有无遗漏的其他交付物 |
| 不可判定表述 | M7「符合预期」→ 改为「方向与其**预注册假设**一致（方向写死在消融设计里，不靠事后判断）」 | 全书是否已无不可判定表述 |
| 表落点 | 阶段 1 验收节开头补 **`<inject_log>` 落点声明**（最小列集 10 列），并注明方案 §11.2 无此表、属阶段 0 必补契约 | 声明是否够用：A1-2/A1-3/A1-11 现在有表可查了吗 |

**我自己复检的结果**（供你交叉验证，但**以你的为准**）：
- 判据行列数异常 = **0**（我写了个按 `|` 切分的检查脚本，逐行断言判据行必须 5 列——第一次跑查出 2 处新引入的断裂，已修）
- 七阶段：实施方案节 **7/7**、验收方案节 **7/7**、反证判据段 **7** 处
- 判据条数更新为：阶段 0 = **12**、1 = **12**、2 = **8**、3 = **5**、4 = **4**、5 = **3**、6 = **4**，合计 **48** 条自动判据
- `|diff|` 残留 **0**；`B12`/`B13` 悬挂引用 **0**

**特别请你复核（这是我修的，最怕修出新问题）**：
① 列数是否真为 5（别只看源码，按 Markdown 表格语义判）；
② 我新增的 A0-11/A0-12/A4-4/A5-3/A6-4 五条判据，**四要素是否齐备**（别新增出缺项）；
③ §6.1 改完后，**七个目标值是否仍无一处被当阈值采纳**。

**边界**：只读；**不要改成品**（逐条写复核意见给我，我统一改）；临时探测放 `$env:TEMP` 并清理。

**captain → 汇聚网关** · 2026-09-24 04:16:04

[当前状态] R2 修订已完成，两席复核对账中。主持人此刻做**决策面收敛**：把全程浮现的分歧按「是否真需要用户拍板」筛一遍，避免把可自决的问题也推给用户（用户明确忌讳逐项请示）。

## 一、已由主持人自决、**不必**打扰用户的（依据在册，可复核）

| 议题 | 裁定 | 依据类型 |
|---|---|---|
| 仓库形态 | 单仓库 + npm workspaces | 本机实测（无 pnpm、有 npm；磁盘敏感） |
| 测试/CI 工具链 | node:test（非 vitest） | 本机实测（vitest 不存在） |
| 包管理器 | npm（非 pnpm） | 本机实测（`pnpm` 不在 PATH） |
| 检索路线 | 纯 JS 余弦为主，vec0 作升级项 + 保留 `{allowExtension:true}` 窗口 | 本机实测（两席采样比值收敛，方向一致） |
| 装配单元 | 13 目录 → 3 patch + 1 client | 结构度量（单变更横跨 5–6 包） |
| 多设备同步 | 移出范围 | 零设计（全文五字） |
| 工期口径 | 双口径并列（人类 20–30 周 / agent 18 批次） | 算术实算 |
| 契约冻结方式 | 灰度分版 v0.1→v0.2→v0.3 | 方案 §10.4 自述 |
| 阶段 0 骨架范围 | 只建 P0 六个 | 结构性（避免 13 项等权稀释） |
| §13.2 七个目标值 | 全部标「待定，需首测后自设」 | 全无实测基线 |
| 取件通道 | 走 GitHub API 逐文件（clone 443 不通） | 本机实测 |
| §14 检测方式 | 入阶段 0 硬判据 | 判定结果（0 真信号 / 7 愿望） |

## 二、真正需要用户拍板的 —— **只剩 2 条**（都是不可逆或影响全线的岔路）

**拍板项 1｜JEV 层到底靠什么跑（阶段 1 首日就撞，决定整批实施写法）**
- 选项 A：本机 Ollama `/api/chat` + logprob 单 token 原语（实测 `qwen3.5:0.8b` → `yes=0.887 / no=0.101`）——**零新依赖、本机可跑**，但需自建判据层与并发约束（50 并发实测 5785ms）。
- 选项 B：沿用 `dsh-memory-jev` v0.4.1 的 OpenRouter 云端通道 —— 有现成实现，但**本机无 `OPENROUTER_API_KEY`**，需处理降级；且该插件在 npm 无包（E404），只能 clone/API 取件。
- 选项 C：阶段 1 先做纯本地规则 + 词法，JEV 延到阶段 2。
- **主持人推荐 A**：LitJev（方案 §15.4 首选）需 H100 80GB，本机 RTX 2070S 8GB 物理不可行；A 的同一原语已被实测证实可得且零新依赖。

**拍板项 2｜是否接受本册的「先决阻断项」作为阶段 0 的硬门槛（会推迟开工）**
本册列出 **G1–G15** 十五条必须先进场闸的问题，其中 **G3（补 `session_id`/`turn_id` 列）、G4（开库 `{allowExtension:true}`）、G5（FTS5 分词口径）** 属「阶段 0 不定死、后面要删库重建」类。
- 选项 A：全部纳入阶段 0（工期略增，但避免返工；**推荐**）。
- 选项 B：只做 G3/G4/G5 三条硬约束，其余挂账。
- 选项 C：先按原方案开工，边做边补。

## 三、**不建议**现在拍板的（证据不足，拍了也是猜）

- **§5.1/§5.3/§6.2/附录B 的认知参数数值**（τ=-2.0、σ=0.3、四大 JEV 阈值 0.7/0.5/0.3/0.8、4 组块、14 天半衰期）是否站得住 —— 本册只保证**公式可复现**，数值品味需实测校准（另有实测概率窄带 `[0.266, 0.405]` 可作输入）。
- **§13.2 七个目标值的具体阈值** —— 无基线，须首测后自设。
- **多设备同步的重启判据** —— 现无设计可评。

[核心产出] 决策面收敛：**已自决 12 条**（附依据类型）、**真需拍板 2 条**（JEV 承载 / 先决阻断项是否作硬门槛）、**建议暂缓 3 条**（证据不足）。
[下一步建议] 若用户接受主持人推荐（JEV 走 A、阻断项全纳入），则本册可直接作为开工依据；若选 B/C 路径，则阶段 1 的实施写法需改写（§4 阶段 1 的 B1.2 与 §8 C8 对应改）。

**accept → 汇聚网关** · 2026-09-24 04:20:19

[当前状态] R2 修订复核完成（只读，成品 sha256 `1B6F8CE6BC1057B3…FBDB` / 71838 B / 592 行，复核前后未变，本轮临时探针已清理）。**你自检的 5 项数字全部属实**：48 条判据、行数异常 0、`|diff|` 残留 0、`B12`/`B13` 悬挂 0、七阶段验证节 7/7。**但修订引入 2 个新问题，另有 4 项你标"已修"的其实没修到位。**

════ 一、D-1 复核 —— ✅ **修到位**（这是我最担心的一条，验法用 GFM 语义切分）

按未转义 `|` 切分（而非看源码文字）：
- L286(A1-4) 列数 **5** 阈值尾 `…，绝对差 ≤ 1e-6` **退回动作 = 「回向量融合步骤」** ✅
- L287(A1-5) 列数 **5** **「回排序步骤」** ✅
- L335(A2-1) 列数 **5** **「回激活方程步骤」** ✅
- L336(A2-2) 列数 **5** **「回检索步骤」** ✅
- L379(A3-4) 列数 **5** **「回衰减步骤」** ✅
- **全书逐表扫描：无一行列数 ≠ 表头** ✅（含 L183 M4 模板行，3 列齐）
**裁定：五条核心判据的「退回动作」在渲染后恢复可见，D-1 闭合。**

════ 二、★ 新问题 N-1｜A6-4 的「装配判据」阈值不可判定（本轮最严重）

A6-4（L471）检查方式：「七阶段全部插件逐个注入 → 记装配计数 `N`；断言 `N` 与 §3.1 的批次交付物清单**逐项对应**」；阈值「**逐一对应**；缺项即判红」。
**问题**：「§3.1 的批次交付物清单」**根本不存在**。§3.1（L144-153）是**工期表**（列：方案阶段 / 人类等价 / agent 批次 / 关键路径），列的是 `B0.1 / B0.2 / B0.3` 这类**批次号**，**没有任何「交付物」列**。交付物在**各阶段的 .1 实施方案表**里。⇒ 判据指向一个不存在的清单，「逐一对应」无法执行 = 又一条**不可判定表述**，出现在**你新加的那条判据**里。
**修法**：改为「断言装配计数 == §3.1 表中 agent 批次列展开后的 **18** 项」或「== §4 各阶段 .1 表的批次行合计」，并把「18」写进阈值列（这是可数的确定性值）。

**次要（同条）**：A6-4 的检查方式依赖 `dev_*` 注入工具链 —— 而 L540（§7 未验证项 2）自己写着「`dev_*` 注入/卸载可调用性**未验证**」。**R0 已经处理过这个前置**（L241「本条须由具备 `dsh-super-injector` 工具链的执行席运行」，并说明作者席工具集内无 `dev_*`），**A6-4 与 R6 都漏了同一句前置说明**。建议三条统一加同一备注。

════ 三、★ 新问题 N-2｜R5「照抄 R1-b」抄错了对象，且判据在语义上不可判

R5（L449）：「取证宿主端点（如 `/api/shoucang-panel/vector/status2` 一类返回 200 且含计数器的端点）在卸载**前后**的读数变化，以**读数停止随 UI 操作变化**为判据」。
本机实测三个问题：
1. **该端点是 shoucang 的，不是 mana-ui 的** —— 卸 `mana-ui` 不可能改变它的读数。R1-b 用它是**对的**（R1-b 验的是「Mana 有没有掐死 shoucang」，对象正是 shoucang）。R5 要验的是 mana-ui 的卸载，**必须换成 mana-ui 自己的端点**，而 mana-ui 尚未存在 ⇒ 该端点在阶段 5 才诞生。
2. **该端点会 401 与 200 同时出现，无法用「返回 200」当存在性判据**：我实测 `/api/shoucang-panel/vector/status2` → **200**，而 `/api/definitely-not-a-real-endpoint-xyz` → **401**，`/api/mana-panel` → **401**。**不存在的端点也返回 401 而非 404** ⇒ 「返回 200」这一个条件同时筛掉了「不存在」和「无权限」，判据只能靠**读数值**。
3. **「读数停止随 UI 操作变化」本身不可判定，且我实测它是静止的**：`queries` 只由 `vec.js:293` 的 `noteQuery()` 在**真实检索**时自增（`vecStats.queries++`，vec.js:85）。我发起两次读取（间隔 20 s、期间不做任何检索）：`before=1866 after=1866 delta=0` —— **它不随面板轮询增长**（`panel-inject.js:179` 只**读**它）。⇒ 「随 UI 操作变化」这个基准行为在 shoucang 上**不成立**（它随**知识检索**变化，不随 UI 变化）。照抄这句会得到一条永远判红或永远判绿的闸。

**你引用 1771 是否恰当**：读数本身是真实活体（我此刻读到 **1860 / 1866**），引用没问题；但 1771 是**采样时刻值**不是阈值 —— 文中已把它写成「实测…且在增长」，**定性描述正确**。R1-b（L301）里的 **1564** 同属采样值。**建议把两个数都改写成可判定形态**：`t0` 读一次 → 触发一次真实知识检索 → `t1` 再读 → 断言 `queries(t1) > queries(t0)`（增量 ≥1）。这既是活体读数又是确定性判据。

**修法（三选一）**：① R5 改验 **mana-ui 自己的端点**（阶段 5 诞生时定义），并明确判据形态为「触发一次面板操作 → 对应计数器增量 ≥1」；② 若 mana-ui 无自身端点，则 R5 降级为「**不可判，标未验证**」（与 A5-3 原案同处置），不要伪装成活体读数；③ 退一步：R5 改断言**产物侧**——卸载后 `client` 产物不再被加载（读宿主模块清单），但这又回到机制自证，**不推荐**。

════ 四、★ 新问题 N-3｜A0-8 未覆盖 `<inject_log>`，表落点声明与 A0-8 不一致

L277 的表落点声明说「`<inject_log>` 指**阶段 0 新建的注入审计表**…属阶段 0 必须补建的契约（对应 G3 与 §8 C6）」。但：
- **A0-8（L233）只验 `mana_trace` 与「各表」的 `session_id`/`turn_id` 列**，没有验 `<inject_log>` **这张表本身是否被建**。
- **B0.2（L208）第⑤项只说「建表须补全 `session_id`/`turn_id` 列…」**，也没说「新建注入审计表」。
⇒ 声明要求建一张表，但**阶段 0 的验收与实施两处都没接住**。结果：A1-2/A1-3/A1-11 到阶段 1 仍会「无表可查」——**这正是你声明要解决的问题，却原样留在了下游**。
**修法**：把 A0-8 的检查方式改为「`PRAGMA table_info(mana_trace)` + **`PRAGMA table_info(inject_log)` 存在性**」，阈值加「`inject_log` 表存在且含声明的 10 列」；B0.2 第⑤项加「建 `inject_log` 表」。

════ 五、D-3 复核 —— ✅ 已可判定（判定形态正确）

A1-11（L293）现为「`degraded === true` 且 `gate` 字段**非空字符串**；同时断言此时 `items[]` 的排序依据字段为 `local_score`（而非 `jev_prob`）」。**三个都是可枚举字段断言，可判定** ✅。
**唯一补充**：`gate` 与 `local_score`/`jev_prob` 的**落点**要落实 —— 方案 §11.2 的 `jev_log`（行851-863）**只有** `id/request_type/source/state_hash/result_value/probability/cached/degraded/latency_ms/cost_usd/created_at`，**没有 `gate` 列**。你已在 L278 的 inject_log 最小列集里放了 `gate`/`degraded`/`local_score`/`jev_prob`（解法正确），但 A1-8（L290）写的是「读 `jev_log`」 —— **两张表混用**。建议 A1-8/A1-11 统一注明「`gate`/`degraded` 读 `inject_log`；`cached` 读 `jev_log`」。

════ 六、D-4 复核 —— ⚠️ 表述准确，但「545–1801」这个区间**来源不清**

表述层：`±5pp 只能估准不能证成，区间 [80%,90%] 恰好覆盖 85% ⇒ 永远判不出是否 >85%` ✅ **准确反映我的原意**。
数字层：我复核了来源 —— **545 = p=0.85 半宽 3pp**；**1801 = p=0.75 半宽 2pp**，**两个不同参数的下端与上端被拼成一个区间**。若按同一参数 p=0.85

…（已截断，原长 10103 字符）

**verify → 汇聚网关** · 2026-09-24 04:20:48

[当前状态] R2 工作项 r2-review-verify 完成。三个复核面全部按预注册判据执行；面 1 抽 25 个数字逐字比对、面 2 实跑 6 类命令、面 3 逐条查 10 项未验证标注。**先说一件必须先说的事：复核期间成品被改动** —— 字节 67808→71838、行数 578→592、md5 `02F2D521…`→`2AD716E6…`（mtime 2026-09-24 04:14:09）。下表针对**当前版**（592 行 / 71838 B / md5 `2AD716E60CAFDA8CC0F57A20F341AE98`）；凡我引用到的行号均以该版为准。只读；TEMP 探测物已全部清理（残留 0）；未改成品、未装任何包、未建库；受保护仓 `git status` 仍 15 行。

## 一、裁定汇总

| # | 待核 | 裁定 | 强度 |
|---|---|---|---|
| **F1** | A 档 9 组数字全部经独立复现 | **成立** | 强 |
| **F2** | B 档 5 例标为浮动、不进阈值列 | **成立** | 强 |
| **F3** | 「B 档跨采样差 2.5–13 倍」 | **部分成立**（下界不符，见下） | 强 |
| **F4** | §6.0「比值上界 ≤1.5×」自洽 | **部分成立**（与同段 1.33–1.71 冲突） | 强 |
| **F5** | C4 比值 `1.33–1.71`、方向一致 | **成立**（1.330 / 1.715） | 强 |
| **F6** | §2 G1 与 §6.0 口径自洽 | **成立** | 强 |
| **F7** | C1 磁盘 `32.5 GB / 229.7 GB` | **部分成立**（实测 32.4 / **227.7**；且未标 B 档） | 强 |
| **F8** | A2-2 `lat(A=−3,τ=−2)=1733.561349` | **不可复现**（公式反解不出） | 强反例 |
| **F9** | A 档 `20.92/8.40` 等成对并列未四舍五入 | **成立** | 强 |
| **P1** | 批次数 **18** 算得对 | **成立**（3+5+2+2+2+2+2=18，唯一编号亦 18） | 强 |
| **P2** | 「关键路径 11 **不受影响**」 | **不可复现（且自相矛盾）** | 强反例 |
| **P3** | §3.2 有「11 段路径」可查 | **不可复现**（该枚举不存在） | 强反例 |
| **C1** | A0-1 `node -v` + sqlite keys | **成立**（逐字相等） | 强 |
| **C2** | A0-7 glob vs 目录对照 | **成立**（exit 0 / exit 1，报错原文一致） | 强 |
| **C3** | A0-10/A6-3 受保护仓 15 行 / `a8c8bb7` | **成立** | 强 |
| **C4** | §2.1 V-1 默认 L2 非余弦 | **成立**（0.8944 vs 0.4000） | 强 |
| **C5** | §2.1 V-2 rowid 必须 BigInt | **成立** | 强 |
| **C6** | §2.1 V-3 KNN 必须带 LIMIT（主持人已复现） | **成立**（errcode 1 逐字） | 强 |
| **C7** | §1.2 `tools/fake-jev.mjs` = 6884 B | **部分成立**（clone 后实测 **7053 B**） | 强 |
| **C8** | §1 条6「corepack 0.34.0 在 PATH」 | **成立** | 强 |
| **C9** | §1.1 / G12 / §1.3 / C15「`git clone` 443 不通」 | **不可复现，与实测相反** | 强反例 |
| **U1** | §7 十条未验证标注无一升格 | **成立**（10/10 保留；6 个升格词全 0 命中） | 强 |
| **U2** | §1 条15 六处行号 | **部分成立**（行号全对，但「真实注册点」漏一处） | 强 |
| **U3** | §1 条15 引文行号（546 / mcl.js:6） | **部分成立**（引文真实、行号错） | 强 |
| **U4** | §2 G8 `vec.js:254` | **部分成立**（引文真实、**行号错 23 行**） | 强 |
| **U5** | §1 条14 「7 条 error 源于宿主 API 改名」 | **部分成立**（5 条是改名，2 条是**上游发包缺 .d.ts**） | 强 |
| **U6** | 主持人自述「389 行」 | **不可复现**（同文件三种读法 578/579/592） | 强反例 |

---

## 二、面 1 · 数字保真（逐字比对）

### F1 成立 —— A 档 9 组，我全部独立复跑，**逐字相同**
```
RRF k=60  [1,1]=0.032787  [1,50]=0.025484  [50,50]=0.018182        ✓
衰减 h=14 1.000000 / 0.500000 / 0.011609                            ✓
ACT-R     0.000000 / 0.534800 / 0.940265 / 0.693147                 ✓
样本量     385 / 289 / 246 / 196 / 139                               ✓
vec_version()="v0.1.9"                                              ✓
vec0.dll = 289280 B（npm pack 实测 Get-Item .Length）                ✓
typecheck exit 2 / 7 条 error（TS2551×5 + TS2614 + TS7016）          ✓
365 tests / 365 pass / 0 fail（影子副本实跑）                        ✓
git 15 行 / HEAD a8c8bb7e1f2d64302ca91c69d7a4e32f73803c40           ✓
```
另 A2-2 概率组 `s(σ=0.3)=0.165399`、`P=0.500000/0.997638/0.002362`、A3-4 `5.059273`、`0.367879`、`0.135335` 亦全部复现。

### F8 ★ 不可复现 —— `1733.561349` 反解不出（A 档里的一个例外）
素材只有一处（`14-accept.md:35`），无推导过程。我用方案附录 B 参数（`F=0.35s`、`f=0.8`、`τ=−2.0`）反解：
```
lat = F·exp(−f·A)         @A=−3  →  3858.111733   ≠ 1733.561349
lat = F·exp(−f·(A−τ))     @A=−3,τ=−2 → 778.939325  ≠ 1733.561349
反解目标: ln(1733.561349/350) = 1.600000 = 0.8×2 = f·|τ|      ← 用了 |τ|=2，而非 |A|=3
```
**裁定不可复现**：该值既不能由「按 A 衰减」也不能由「按 (A−τ) 衰减」得出，唯一凑出的组合（`f·|τ|`）在物理上讲不通（延迟不该只依赖阈值）。**反例**：同行的 `350.000000` 我精确复现（`0.35s×1000`）。**处置建议**：把 `1733.561349` 从 A 档移到「**待复算**」，写明它出自某实现（疑为 pyactup 的 `latency` 定义）而**本册未复现其推导**——否则实施者拿它当死数会先红在 A2-1 之外。

### F3/F4 部分成立 —— 分档纪律内部不自洽
我复算 5 例倍差：`JS余弦 2.49×` / `vec0 3.21×` / `冷启 13.43×` / `改写 1.25×` / `无关 1.17×`。
- 「**2.5–13 倍**」的**下界 2.5 排除了改写(1.25) 与无关(1.17)** —— 这两例明明被同一张表列为 B 档。⇒ 缩略语应为「**1.2–13 倍**」或不给区间。
- §6.0「比值上界（推荐）：vec0 ÷ 暴力余弦 **≤ 1.5×**」与同句「两席独立采样落在 `1.33–1.71` 之间」**直接冲突**：若阈值取 1.5，**主持人自己那次 1.715 的采样就不合格**。⇒ 上界应取 **≤ 2.0×**（含 1.71 且留余量），或明写「以两席较大者 1.72 为观测上界」。
- F5 成立：C4 的 `1.33–1.71` 与我的重算（1.330 / 1.715）一致，方向判断（一万条规模 vec0 无优势）在双方数据下均成立。

### F7 部分成立 —— C1 用了会漂的数当决策证据
```
实测 2026-09-23T20:11Z：C 可用 32.4 G

…（已截断，原长 13955 字符）

**captain → 汇聚网关** · 2026-09-24 04:26:09

[当前状态] R2 两路复核完成，**全部意见已处置**（采纳并修 / 判不成立并给反证）。成品定稿：**78,209 字节 / 616 行**，sha256 `622757BAD2FA741B…`。

## 一、采纳并已修（accept 席 3 新 + verify 席 3 硬伤 + 次要 8 处）

| 来源 | 问题 | 处置 |
|---|---|---|
| accept N-3 | `inject_log` 表「声明修了、阶段 0 实施与验收两处都没接住」 | B0.2 步骤补「⑤ 新建 `inject_log` 表」；A0-8 补 `PRAGMA table_info(inject_log)` 单独校验 + 注明「只验已存在表的列不够」 |
| accept N-2 | R5 抄错对象（那是 shoucang 的端点；且该计数器**不随面板轮询增长**，20s delta=0） | R5 改为「`mana-ui` 须**自建**产物侧落点（`mana_trace` 的 `ui/render` 行）」；并注明**不存在的端点返回 401 而非 404** ⇒ 不能靠状态码筛存在性 |
| accept N-1 | A6-4 指向 §3.1（那是工期表，**无交付物列**） | 改指「各阶段 N.1 表的**交付物列**」，并显式说明「不是 §3.1」 |
| accept D-8 / D-9 | R3 写法方向相反（其余反证是「不再产生新行」，R3 后半句要求「须有记录」）；M6 仍写「Slot 消失可验」与 R5 冲突 | R3 拆成「反证（不再产生新行）」与「正向可观测性（须留 inactive 记录）」两条并注明**不得混写**；M6 与 R5 口径对齐 |
| accept 补 | `545–1801` 是跨参数拼合；A0-11「写入方须外部」文件本身判不了 | 命中率栏改写为「±5pp 只估准不证成，证成需 545–1801」；A0-11 改为**可判定形态**「卸载全部 Mana 插件后该文件仍继续更新」 |
| accept 补 | 三处悬挂引用 | `B2 类`→具体到 A0-4 类；`阶段 3 展开 5`→改写为独立说明；`§0.2 的模板`→`§4 每阶段的统一验收模板` |
| **verify 硬伤 1** | **C9/C15「git clone 443 不通」不可复现、与实测相反** | **主持人亲自复测：clone 3/3 成功**（shoucang 取到 **105 个 TS 源**）⇒ 确认我原判**错**，系瞬时抖动。C15 改为「**优先 clone**，失败才回退 API」，并保留错误记录说明 |
| **verify 硬伤 2** | 「关键路径 11」不成立（11 来源于 `3+4+2+2`，那个 `4` 正是被订正的笔误值） | 删除单一数字，改为 **§3.1.1 两种口径分列**：口径 A 最长依赖链 = **8 批次**（附链的枚举）、口径 B 不可并行 = **10 批次**（附可并行清单）；并声明与另一席「9/14」的差异源于依赖图边集读法，**以图为唯一依据** |
| **verify 硬伤 3** | §1 条15 漏第二个注册点，导致 G9/R1-b **假绿** | 主持人逐行核实：**`panel-inject.js:773` 与 `mcl.js:372` 都是真实注册点**（后者 `ctx.on(...) → handlePreStep`）。§1 条15 / G9 / R1-b 全部改写：**回归观察点必须分链落地**（链 1 = 773 热记忆注入；链 2 = 372 MCL 慢通道） |
| verify 次要 | §6.0「≤1.5×」与同段「1.33–1.71」冲突 | 上界改 **≤2.0×**（1.5× 会把自己一侧判不合格）；并声明「决策证据列同适用分档」 |
| verify 次要 | 「2.5–13 倍」下界不符 | 改 **1.2–13 倍**（含改写 1.25×、无关句 1.17×） |
| verify 次要 | C1 磁盘数字过期 | 改实测值 **32.3 / 227.6 GB** 并标注「随使用浮动」 |

## 二、判**不成立**（附反证，不盲从复核意见）

- **verify 席报「`lat(A=−3,τ=−2)=1733.561349` 反解不出，A 档唯一不可复现值」** ⇒ **该意见不成立**。主持人按册中公式复算：`F·e^(−f·τ)·1000 = 0.35 × e^1.6 × 1000 = 1733.5613485`，**与册中逐字相同**。核验席大概是按 `A=−3` 直接代入（未走钳位分支）而算不出。
  **但该意见暴露了一个真问题**：`A<τ` 时钳到 τ ⇒ **`A=−3` 与 `A=−2` 同值**，标签有歧义。已把夹具改写为 `lat(A=−2,τ=−2)` 并**写明钳位语义**，同时按纪律在册中**保留这次冲突记录**（「曾有复核意见判不可复现——以实跑为准，判该意见不成立」）。

## 三、本轮的方法论产出（已固化进册）

三条取证纪律：**① 搜索通道返回空 ≠ 不存在；② 三种取证通道（npm / GitHub API / 本机目录）结论不同，禁跨通道混用；③ 机制自证 ≠ 生效**（装配清单、心跳、端口、文件增长皆机制自证，验收一律落到产物侧 + 反证）。
另加一条本次踩出来的：**④ 单次采样不可作决策依据** —— 我自己就因一次 `clone` 失败写错了一条决策（C15），被复核推翻后实测 3/3 成功。

[核心产出] 成品定稿 **78,209 B / 616 行**；两路复核全部意见处置完毕（采纳 14 处 / 判不成立 1 处并给反证）；表格列数异常 0；七阶段两节齐备 7/7。
[下一步建议] 可关闭会议并交付。**待用户拍板仅剩 2 条**：① JEV 层承载方式（推荐本机 Ollama logprob）② G1–G15 是否全纳入阶段 0 硬门槛（推荐全纳入）。

---

## 用户调整记录（0）

> 只包含尚未被主持人清空的记录；已执行并清空的调整不会出现在导出里。

（无）
