# 圆桌会议记录 · mana-v10-review-2026-09-25

---
<!-- 以下为预填的会议元数据，可整段作为 issue / 归档记录的头部 -->
- **插件**：dsh-plugin-roundtable v0.2.56（DeepSeek Harness 0.1.7-rc.1+）
- **会议 id**：mana-v10-review-2026-09-25
- **协作模式**：orchestrated
- **状态**：active（进行中快照）
- **创建时间**：2026-09-25 06:43:58
- **最后更新**：2026-09-25 08:02:26
- **预算用量**：3/6 轮 · 41657/400000 token
- **知识库**：/home/lk/Mana/docs
---

## 议题 / 目标

把外部方案档《Mana（末那识）：完整记忆插件方案 v10.0（最终整合版）》（C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md，2346 行）与当前仓库实测现状逐条比对：① 判定 v10 相对已落地体系（docs/mana-rollout-plan.md 落地册 v1.0 + docs/mana-project-status-plan.md v6.3 实况订正版 + 仓内实测）属【新增 / 已否决 / 已订正冲突复发】哪一类；② 判定 v10 是否诱发对已完成工作的返工或覆盖；③ 产出可执行、可机检的后续任务清单（批次粒度 + 能力要求 + 依赖 + 判据 + 回归面）供用户排期。最终交付物 = 评审结论 + 任务规划，不是代码。

## 用户原话（未加工）

> "C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md"根据这个方案对当前项目做评审，规划后续任务

## 边界声明

- **要解决的现象**：用户原话「根据这个方案对当前项目做评审，规划后续任务」= 拿 v10 方案当参照物审当前项目并排后续任务；要能回答「v10 里哪些是我们要做的、哪些已经做完了、哪些是 v6.3 已订正而 v10 又写回去了」。
- **算解决的标准**：① 各席给出带位置（文件/行号/命令输出）的结论，找不到真问题写「未发现」；② v10 的 §32/§33/§34/§36/§6/§23/§24/§40 各区块都有「本仓实测现状」对照；③ 产出任务清单，每条写明目标/承接能力/依赖/可机检判据/回归面；④ 风险席独立给出「v10 会带偏已完成工作」的判断；⑤ 主持人汇总后向用户交付汇总（含分歧与拍板项）并落盘评审报告。
- **怎么检查**：评审事实全部可复跑：npm run check:a1（应 15 项 / PASS 12 / 挂账 2）· node tools/a0-check.mjs（应 16 项 / PASS 15 / 挂账 1）· npm test（应 251/251，HEAD=b3fa4cb）· packages/*/src 行数与 v6.3 实况档逐包对比 · grep 概念词命中数为 0 才算「本仓无此物」。结论必须给命令或 文件:行号，给不出即标「未验证」。
- **明确不做 / 不许动**：① 不改 packages/*/src、tools/*.mjs、docs/contract/* 任何既有文件；② 不装任何新依赖（尤不装 sqlite-vec 扩展）；③ 不重排已定盘的 W1/W2/W3 波次与落地册阶段划分；④ 不把 v10 设计意图当现状写进任何文档；⑤ 不引入 OpenRouter 云通道、不用 options 内 logprobs 写法；⑥ 不动 shoucang 既有件与 DSH 运行时。

## 专家名单（7）

- `v10-diff` — 对照席（v10 §32 插件清单 / §33 标准结构 / §34 事件契约 / §36 核心表结构）。逐条与 packages/ 13 包、packages/core/src/event-types.ts、packages/core/src/schema.ts 比对：v10 列 18 个插件里本仓有哪几个、哪几个不存在（llm/reconsolidation/learning/itacl/shoucang-adapter）、哪几个是 v10 新增而本仓无同类；v10 §36 的 11 张表里本仓有哪几张、缺哪几张（fsrs_schedule/agent_profile/user_profile/distillation_log/sleep_cycles/pruning_log/retrieval_induced_forgetting）、本仓多出哪几张（inject_log/user_model_history/memory_items_fts）。每条结论必须给 文件:行号 或 grep 命中数。禁止把「v10 没提」当「本仓没有」，也禁止把「v10 写了」当「本仓缺了就要补」——只做对照，不给采购建议。 （临时角色） — dshapi/deepseek-v4.1-flash — 状态 idle
- `jev-v10` — JEV 接入面对照席（v10 §6 / §22 / §23 接入点 40 行 / §24 批量调用 / §25 Prompt 库 / §26 阈值校准）。与 packages/jev + packages/attention 实测比对，并与 docs/mana-project-status-plan.md（v6.3 实况订正版）逐条对齐：v10 里哪些写法是 v6.3 已实测订正过的（OpenRouter 端点、ctx.credentials.get、options 内 logprobs、50 问批量语义、21 个 Prompt 一个都不存在），哪些是 v10 独有而本仓零落点（§23 的 40 行接入点表、§26 阈值校准五步）。重点回答：v10 的 §23/§25 表会不会让人把「未实现」读成「已实现」。每条给证据。 （临时角色） — dshapi/deepseek-v4.1-flash — 状态 idle
- `roadmap-diff` — 路线图对照席（v10 §37 多 Agent 分工 / §40 六阶段路线图 / §39 四层评估 + 10 个核心指标）。与 docs/mana-rollout-plan.md（7 阶段 / 18 批次 / 阶段 0-1 判据已落地）与 docs/session-allocation.md（W1-W3 波次）比对，输出：① v10 阶段与落地册阶段的映射表；② v10 里落地册完全没覆盖的增量点；③ v10 的周数工期在本仓「批次」口径下不可排期的部分（不得直接把周数换算成批次）。只做映射与缺口，不重排已定盘波次。 （临时角色） — dshapi/deepseek-v4.1-flash — 状态 idle
- `gate-blindspot` — 判据盲区审计席（本会议最重要的一席）。亲自跑 npm run check:a1 与 node tools/a0-check.mjs，再用 read/grep 逐条核对「文档判据原文」vs「测试真实断言」，找出被放宽、被替换、或挂账被读成通过的地方。已有抽样一条待核实并找全同类：docs/mana-rollout-plan.md:346 与 :451 要求 A1-1 机检「S1 五类 event_type（observation/attention/decision/recall/injection）各 ≥1」，而 packages/core/tests/chain-e2e.test.mjs:97 的断言列表疑似被写成 [observation, mana/working-memory, mana/scheduler/attention]，后两个名字不在契约里 —— 请确认是否属实、影响面多大、A1-1 为何仍 PASS、还有多少条判据同型。每条给 文件:行号 + 命令输出。找不到就写「未发现」，不许凑数。 （临时角色） — dshapi/deepseek-v4.1-flash — 状态 idle — ⚠ 静默未回（R1, R2）
- `theory-graft` — 机制移植评估席（v10 独有而本仓零落点的机制：§19-21 ITACL 与三阶段状态机 / §18.3 认知环 MCL / §12.4 内在奖励 / §13.3 睡眠三重振荡耦合 / §17.1 FSRS 与 Hebbian / §16.5 小胶质细胞修剪 / §8 神经科学基础）。逐项判：① 本仓或守藏现役是否已有等价物（守藏已有：混合召回 RRF、会话蒸馏、深度睡眠、认知环 MCL、热温冷活性分级、白名单门禁）——有等价物必须指名，不许重复造；② 与 DSH 宿主扩展点是否冲突（agent/pre-step 是官方 waterfall、subagent 与工具面）；③ 每个机制给「移植 / 改造后用 / 不移植」三选一 + 一条可判据理由。只评估，不实现。 （临时角色） — dshapi/deepseek-v4.1-flash — 状态 idle
- `risk-reviewer` — 独立审查席（本席不产出任何改动，只判别的席的结论站不站得住）。逐条审前几席产出：① 哪些结论把 v10 的转述当成本仓现状；② 哪些结论给不出位置证据；③ 专门回答回归问题：按 v10 做事会不会覆盖或推翻已完成的阶段 0/1 成果（已知回归面：13 包已装配、A0/A1 判据入口已建、契约 v0.2.2 已冻、W3 事件链已通）—— 列出具体「会碰坏什么」清单；④ 每条被审结论给 成立/不成立/证据不足 三态判定，不成立的要给反证。 （临时角色） — dshapi/deepseek-v4.1-flash — 状态 idle
- `planner` — 任务规划合成席。承接前 6 席已成立的结论（不重复论证），把后续工作拆成可独立验证的批次任务，每条写全 6 项：任务目标 / 承接能力（不是人名）/ 依赖 / 可机检判据（命令或断言）/ 回归面（碰坏什么、怎么确认没碰坏）/ 与 v10 的对应章节。粒度对齐落地册批次口径（一个批次 = 一次可独立验证的执行段），不估时。凡依赖未定阈值、未拍板项、未验证项的必须显式标「挂账」并写明挂到哪一步。 （临时角色） — dshapi/deepseek-v4.1-flash — 状态 idle

> **静默判据**：静默未回：R1/gate-blindspot, R2/gate-blindspot；迟到（不算失败）：R1/roadmap-diff→R2

## 调度计划（3 轮已记录）

> 同波内的项**无相互依赖**（可并发下发）；后面的波等前面的波完成。

### 第 1 轮 · 第 1 轮：六席只读勘察（v10 对照 ×3 + 判据盲区审计 + 机制移植评估），随后独立审查席核结论与回归面，最后由规划席合成批次任务清单。本轮全程只读，不改任何既有文件。

- **wave 1**（立刻并发下发）
  - `a1` → `v10-diff`：对照 v10 §32 插件清单 / §33 标准结构 / §34 事件契约 / §36 核心表结构 与本仓 13 包、event-types.ts、schema.ts，产出逐条差异表（含 grep 命中数）
  - `a2` → `jev-v10`：对照 v10 §6/§22/§23/§24/§25/§26 与 packages/jev + packages/attention 实测及 docs/mana-project-status-plan.md（v6.3 实况订正版），标出「已订正冲突复发」与「本仓零落点」两类
  - `a3` → `roadmap-diff`：对照 v10 §37/§39/§40 与 docs/mana-rollout-plan.md（7 阶段 18 批次）+ docs/session-allocation.md（W1-W3），产出阶段映射、增量缺口、不可排期项
  - `a4` → `gate-blindspot`：判据盲区审计：逐条核对「文档判据原文」vs「测试真实断言」，找出被放宽/被替换/挂账被读成通过的地方（含 A1-1 五类 event_type 抽样核实）
  - `a5` → `theory-graft`：机制移植评估：ITACL / MCL / 内在奖励 / 睡眠三重耦合 / FSRS+Hebbian / 小胶质细胞修剪，逐项给「移植 / 改造后用 / 不移植」+ 可判据理由，并指名守藏既有等价物
- **wave 2**（等 wave 1）
  - `a6` → `risk-reviewer`：独立审查：逐条判前五席结论 成立/不成立/证据不足，并列出「按 v10 做事会碰坏什么」的具体回归面清单
- **wave 3**（等 wave 2）
  - `a7` → `planner`：合成后续批次任务清单：每条写全 目标/承接能力/依赖/可机检判据/回归面/v10 对应章节，未定项显式挂账

### 第 2 轮 · 第 2 轮（恢复轮）：a3（路线图对照）与 a4（判据盲区审计）两席第 1 轮运行失败、未产出任何发言 —— 按协议重派一次，并把任务切成有界小块（命令加超时、超时即如实跳过而非死等）。这两项回报后，a6 复评 + a7 合成。本轮仍全程只读。

- **wave 1**（立刻并发下发）
  - `b1` → `roadmap-diff`：路线图对照（重派·有界版）：v10 §37/§39/§40 ↔ 落地册 7 阶段 18 批次 映射表 + 增量缺口 + 不可排期项；只读三份文档，不跑命令
  - `b2` → `gate-blindspot`：判据盲区审计（重派·有界版）：回答 6 问（A1-1 五类事件 / A1-8 夹具自证 / ARTIFACTS 分层 / 挂账是否被读成通过 / npm test 251 是环境态还是稳定态 / 还有多少同型），每条给 文件:行号；命令超时即标注跳过，不得死等
- **wave 2**（等 wave 1）
  - `b3` → `risk-reviewer`：独立复评：对 b1/b2 的新产出 + 此前三席结论给出 成立/不成立/证据不足 三态判定与反证
- **wave 3**（等 wave 2）
  - `b4` → `planner`：合成后续批次任务清单（每条含 目标/承接能力/依赖/可机检判据/回归面/v10 章节），未定项显式挂账

### 第 3 轮 · 第 3 轮（终审轮）：规划席 b4 已交付 11 批次 + 写面分配，本轮请独立审查席对「写面隔离是否成立 / 有无拆东墙 / 有无批次被悄悄当成可开工」给出终审三态判定。只读。

- **wave 1**（立刻并发下发）
  - `c1` → `risk-reviewer`：终审 b4 的写面隔离与 11 批次：判 F-02∥F-03 的处置物理可执行性、F-01/F-02 与 W3 独占面冲突、并行上限是否可到 3、每条回归面是否具体、有无批次被当成可开工而依赖未拍板


## 决策记录（0）

（无）

## 发言记录（27 条）

### 第 1 轮

**captain → v10-diff** · 2026-09-25 06:45:31

【派单 · Mana v10 评审 · 第 1 轮】

会议目标：把 v10 方案档与当前仓库实测现状逐条比对，产出评审结论 + 后续批次任务清单（最终交付物是文档，不是代码）。

硬边界（boundary_not_doing，全程不许碰）：
① 不改 packages/*/src、tools/*.mjs、docs/contract/* 任何既有文件；
② 不装任何新依赖（尤不装 sqlite-vec 扩展）；
③ 不重排已定盘的 W1/W2/W3 波次与落地册阶段划分；
④ 不把 v10 的设计意图当现状写进任何文档；
⑤ 不引入 OpenRouter 云通道、不用 options 内 logprobs 写法；
⑥ 不动 shoucang 既有件与 DSH 运行时。
本轮各席只做只读勘察与判断，**不产生任何文件改动**。

已达成的实测基线（主持人本机实跑，HEAD=b3fa4cb，可自行复跑验证）：
· node tools/a0-check.mjs → 16 项：PASS 15 / FAIL 0 / 挂账 1（A0-13）
· npm run check:a1 → 15 项：PASS 12 / FAIL 0 / 挂账 2（ARTIFACTS 产物过期、W-1..3 vec0 未装）/ 无实现者 1（A1-5）
· npm test → tests 251 / pass 251 / fail 0
· 13 包：core jev vector perception attention working-memory scheduler metacognition user-model ui long-term consolidation forgetting
· src 行数（实测）：core 1740 / jev 1856 / vector 956 / perception 118 / attention 345 / working-memory 146 / scheduler 378 / metacognition 1751 / user-model 92 / ui 397 / long-term 74 / consolidation 74 / forgetting 74
· 契约 v0.1 冻结事件 = 8 个：mana/observation、mana/attention、mana/decision、mana/recall、mana/injection（S1 五类）+ mana/jev/judge（waterfall）、mana/jev/judged、mana/plugin/inactive
· 全仓 grep 命中数 = 0 的概念（即「本仓无此物」）：ITACL/itacl、maxSteps/maxRetrievals/noProgressThreshold、intrinsic、spindle/ripple/renormal、fsrs/FSRS、distillation_log/sleep_cycles/pruning_log/agent_profile/user_profile/retrieval_induced_forgetting、openrouter/credentials、metacognition/confidence|gap

输出格式（每席都要遵守）：
1. 排序口径：先给「会掩盖其他问题 / 让失败不可观测」的缺陷，再按严重度排；不得按显眼度排。
2. 每条结论须给位置（文件:行号 / 命令输出）；**给不出即标「未验证」**。
3. 找不到真问题就写「未发现」，**不许凑数**。
4. 需用户拍板的分歧用 [建议决策] 行输出：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。
5. 结尾必须给 **[核心产出]** 与 **[下一步建议]** 两行；不要把整篇原文回贴。
6. 参考材料允许自行读取：仓库根 /home/lk/Mana；v10 方案档在 /mnt/c/Users/lk/Downloads/deepseek_markdown_20260924_968609.md（Windows 路径 C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md）。

你的工作项：
【a1 · 对照席 · 只读】v10 §32 插件清单 / §33 标准结构 / §34 事件契约 / §36 核心表结构，逐条对照本仓。
必须产出（表格形式）：
① v10 §32 列的 18 个插件 vs 本仓 13 包：哪些有对应、哪些 v10 有本仓无（预期：llm / reconsolidation / learning / itacl / shoucang-adapter）、哪些本仓有 v10 未提（预期：user-model 的 user_model_history 面）。
② v10 §34 事件契约（约 50 个事件名）vs packages/core/src/event-types.ts 的 8 个：列出 v10 独有且本仓零落点的事件族（按链归类，别逐个罗列 50 行）。
③ v10 §36 的 11 张表 vs packages/core/src/schema.ts 实建的表：缺哪几张（预期 fsrs_schedule / agent_profile / user_profile / distillation_log / sleep_cycles / pruning_log / retrieval_induced_forgetting）、本仓多出哪几张（inject_log / user_model_history / memory_items_fts）。
④ v10 §33 插件标准结构 vs 本仓 13 包实测形状（已由 A0-5 机检：13/13 包都有 cordis.patch.yml + dsh.bundle 声明），指出 v10 §33 与实测的差异点。
每条给 文件:行号 或 grep 命中数。禁止把「v10 没提」当「本仓没有」，也禁止把「v10 写了」当「本仓缺了就要补」——只做对照，不给采购建议。

**captain → jev-v10** · 2026-09-25 06:45:31

【派单 · Mana v10 评审 · 第 1 轮】

会议目标：把 v10 方案档与当前仓库实测现状逐条比对，产出评审结论 + 后续批次任务清单（最终交付物是文档，不是代码）。

硬边界（boundary_not_doing，全程不许碰）：
① 不改 packages/*/src、tools/*.mjs、docs/contract/* 任何既有文件；
② 不装任何新依赖（尤不装 sqlite-vec 扩展）；
③ 不重排已定盘的 W1/W2/W3 波次与落地册阶段划分；
④ 不把 v10 的设计意图当现状写进任何文档；
⑤ 不引入 OpenRouter 云通道、不用 options 内 logprobs 写法；
⑥ 不动 shoucang 既有件与 DSH 运行时。
本轮各席只做只读勘察与判断，**不产生任何文件改动**。

已达成的实测基线（主持人本机实跑，HEAD=b3fa4cb，可自行复跑验证）：
· node tools/a0-check.mjs → 16 项：PASS 15 / FAIL 0 / 挂账 1（A0-13）
· npm run check:a1 → 15 项：PASS 12 / FAIL 0 / 挂账 2（ARTIFACTS 产物过期、W-1..3 vec0 未装）/ 无实现者 1（A1-5）
· npm test → tests 251 / pass 251 / fail 0
· 13 包：core jev vector perception attention working-memory scheduler metacognition user-model ui long-term consolidation forgetting
· src 行数（实测）：core 1740 / jev 1856 / vector 956 / perception 118 / attention 345 / working-memory 146 / scheduler 378 / metacognition 1751 / user-model 92 / ui 397 / long-term 74 / consolidation 74 / forgetting 74
· 契约 v0.1 冻结事件 = 8 个：mana/observation、mana/attention、mana/decision、mana/recall、mana/injection（S1 五类）+ mana/jev/judge（waterfall）、mana/jev/judged、mana/plugin/inactive
· 全仓 grep 命中数 = 0 的概念（即「本仓无此物」）：ITACL/itacl、maxSteps/maxRetrievals/noProgressThreshold、intrinsic、spindle/ripple/renormal、fsrs/FSRS、distillation_log/sleep_cycles/pruning_log/agent_profile/user_profile/retrieval_induced_forgetting、openrouter/credentials、metacognition/confidence|gap

输出格式（每席都要遵守）：
1. 排序口径：先给「会掩盖其他问题 / 让失败不可观测」的缺陷，再按严重度排；不得按显眼度排。
2. 每条结论须给位置（文件:行号 / 命令输出）；**给不出即标「未验证」**。
3. 找不到真问题就写「未发现」，**不许凑数**。
4. 需用户拍板的分歧用 [建议决策] 行输出：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。
5. 结尾必须给 **[核心产出]** 与 **[下一步建议]** 两行；不要把整篇原文回贴。
6. 参考材料允许自行读取：仓库根 /home/lk/Mana；v10 方案档在 /mnt/c/Users/lk/Downloads/deepseek_markdown_20260924_968609.md（Windows 路径 C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md）。

你的工作项：
【a2 · JEV 接入面对照席 · 只读】v10 §6 / §22 / §23（40 行接入点速查表）/ §24（批量调用）/ §25（21 个 Prompt 模板）/ §26（阈值校准）。
必须产出：
① **「已订正冲突复发」清单**：v10 里哪些写法是本仓已在 docs/mana-project-status-plan.md（v6.3 实况订正版）里实测订正过的 —— 至少核实这五条：OpenRouter 端点（本仓用 nano-gpt + ollama 两通道）、ctx.credentials.get(openrouter)（本仓配置里只存变量名、key 只从环境变量读）、options 内 logprobs（v6.3 记「必须顶层，options 内被静默忽略」）、「50 个问题和 1 个问题耗时相近」（本仓实测 50 问单次 1046–1228ms vs 50 并发 7599ms）、21 个 Prompt 在本仓一个都不存在。逐条给 v10 行号 + 本仓 文件:行号 或 grep 命中数。
② **「本仓零落点」清单**：v10 §23 的 40 行接入点表里，哪些是本仓真的没有调用点（提示：worth_keeping / supersedes / decay_priority / relevant_ / rel_ / tool_choice / urgency 全仓命中数）。
③ **可被误读风险**：v10 §23/§25 的表格排版（接入点 | 模型 | 原语 | 阈值 | 失败策略）会不会让读者把「未实现」读成「已实现」？给具体理由，不要泛泛而谈。
④ 核实 v10 §26 阈值校准五步在本仓的落点（提示：grep -rn calibrate packages/）。
注意：packages/jev 与 packages/attention 的真实形态以实读源码为准，不要只采信 v6.3 实况档的转述就下结论 —— 实况档本身也只是某一次快照。

**captain → roadmap-diff** · 2026-09-25 06:45:31

【派单 · Mana v10 评审 · 第 1 轮】

会议目标：把 v10 方案档与当前仓库实测现状逐条比对，产出评审结论 + 后续批次任务清单（最终交付物是文档，不是代码）。

硬边界（boundary_not_doing，全程不许碰）：
① 不改 packages/*/src、tools/*.mjs、docs/contract/* 任何既有文件；
② 不装任何新依赖（尤不装 sqlite-vec 扩展）；
③ 不重排已定盘的 W1/W2/W3 波次与落地册阶段划分；
④ 不把 v10 的设计意图当现状写进任何文档；
⑤ 不引入 OpenRouter 云通道、不用 options 内 logprobs 写法；
⑥ 不动 shoucang 既有件与 DSH 运行时。
本轮各席只做只读勘察与判断，**不产生任何文件改动**。

已达成的实测基线（主持人本机实跑，HEAD=b3fa4cb，可自行复跑验证）：
· node tools/a0-check.mjs → 16 项：PASS 15 / FAIL 0 / 挂账 1（A0-13）
· npm run check:a1 → 15 项：PASS 12 / FAIL 0 / 挂账 2（ARTIFACTS 产物过期、W-1..3 vec0 未装）/ 无实现者 1（A1-5）
· npm test → tests 251 / pass 251 / fail 0
· 13 包：core jev vector perception attention working-memory scheduler metacognition user-model ui long-term consolidation forgetting
· src 行数（实测）：core 1740 / jev 1856 / vector 956 / perception 118 / attention 345 / working-memory 146 / scheduler 378 / metacognition 1751 / user-model 92 / ui 397 / long-term 74 / consolidation 74 / forgetting 74
· 契约 v0.1 冻结事件 = 8 个：mana/observation、mana/attention、mana/decision、mana/recall、mana/injection（S1 五类）+ mana/jev/judge（waterfall）、mana/jev/judged、mana/plugin/inactive
· 全仓 grep 命中数 = 0 的概念（即「本仓无此物」）：ITACL/itacl、maxSteps/maxRetrievals/noProgressThreshold、intrinsic、spindle/ripple/renormal、fsrs/FSRS、distillation_log/sleep_cycles/pruning_log/agent_profile/user_profile/retrieval_induced_forgetting、openrouter/credentials、metacognition/confidence|gap

输出格式（每席都要遵守）：
1. 排序口径：先给「会掩盖其他问题 / 让失败不可观测」的缺陷，再按严重度排；不得按显眼度排。
2. 每条结论须给位置（文件:行号 / 命令输出）；**给不出即标「未验证」**。
3. 找不到真问题就写「未发现」，**不许凑数**。
4. 需用户拍板的分歧用 [建议决策] 行输出：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。
5. 结尾必须给 **[核心产出]** 与 **[下一步建议]** 两行；不要把整篇原文回贴。
6. 参考材料允许自行读取：仓库根 /home/lk/Mana；v10 方案档在 /mnt/c/Users/lk/Downloads/deepseek_markdown_20260924_968609.md（Windows 路径 C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md）。

你的工作项：
【a3 · 路线图对照席 · 只读】v10 §37（18 个 Agent 分工）/ §39（四层评估 + 10 个核心指标）/ §40（阶段 0–5，1–2 周到 4–6 周）。
必须产出：
① **阶段映射表**：v10 阶段 0–5 vs docs/mana-rollout-plan.md 的阶段 0–6 / 18 批次（B0.1…B7.2）。指出哪些是同一件事的不同说法。
② **本仓现状定位**：按落地册口径当前已完成到哪一批（提示：阶段 0 的 A0-1…A0-14 与 R0 已机检通过；阶段 1 的 A1-1…A1-14 已建入口，其中 A1-5 无实现者、A1-12 有一条腿未验证；W3 事件链已通）。给出 文件:行号 证据。
③ **v10 增量缺口**：v10 里落地册完全没覆盖的（提示：§39 四层评估体系、§37 的 18 Agent 分工表、§40 阶段 4 末那识本体在落地册被拆到 B5.1/B5.2 且标可并行）。逐条列出并注明落地册是否已有等价批次。
④ **不可排期项**：v10 的「1–2 周 / 4–6 周」在本仓「批次」口径下不能直接换算成批次的理由（本仓纪律：agent 口径不用周、批次 = 一次可独立验证的执行段）。
只做映射与缺口，**不重排已定盘波次**，也不裁定 v10 与落地册谁对谁错 —— 那是后续拍板项，你只需把分歧点列出来（用 [建议决策] 行）。

**captain → gate-blindspot** · 2026-09-25 06:45:31

【派单 · Mana v10 评审 · 第 1 轮】

会议目标：把 v10 方案档与当前仓库实测现状逐条比对，产出评审结论 + 后续批次任务清单（最终交付物是文档，不是代码）。

硬边界（boundary_not_doing，全程不许碰）：
① 不改 packages/*/src、tools/*.mjs、docs/contract/* 任何既有文件；
② 不装任何新依赖（尤不装 sqlite-vec 扩展）；
③ 不重排已定盘的 W1/W2/W3 波次与落地册阶段划分；
④ 不把 v10 的设计意图当现状写进任何文档；
⑤ 不引入 OpenRouter 云通道、不用 options 内 logprobs 写法；
⑥ 不动 shoucang 既有件与 DSH 运行时。
本轮各席只做只读勘察与判断，**不产生任何文件改动**。

已达成的实测基线（主持人本机实跑，HEAD=b3fa4cb，可自行复跑验证）：
· node tools/a0-check.mjs → 16 项：PASS 15 / FAIL 0 / 挂账 1（A0-13）
· npm run check:a1 → 15 项：PASS 12 / FAIL 0 / 挂账 2（ARTIFACTS 产物过期、W-1..3 vec0 未装）/ 无实现者 1（A1-5）
· npm test → tests 251 / pass 251 / fail 0
· 13 包：core jev vector perception attention working-memory scheduler metacognition user-model ui long-term consolidation forgetting
· src 行数（实测）：core 1740 / jev 1856 / vector 956 / perception 118 / attention 345 / working-memory 146 / scheduler 378 / metacognition 1751 / user-model 92 / ui 397 / long-term 74 / consolidation 74 / forgetting 74
· 契约 v0.1 冻结事件 = 8 个：mana/observation、mana/attention、mana/decision、mana/recall、mana/injection（S1 五类）+ mana/jev/judge（waterfall）、mana/jev/judged、mana/plugin/inactive
· 全仓 grep 命中数 = 0 的概念（即「本仓无此物」）：ITACL/itacl、maxSteps/maxRetrievals/noProgressThreshold、intrinsic、spindle/ripple/renormal、fsrs/FSRS、distillation_log/sleep_cycles/pruning_log/agent_profile/user_profile/retrieval_induced_forgetting、openrouter/credentials、metacognition/confidence|gap

输出格式（每席都要遵守）：
1. 排序口径：先给「会掩盖其他问题 / 让失败不可观测」的缺陷，再按严重度排；不得按显眼度排。
2. 每条结论须给位置（文件:行号 / 命令输出）；**给不出即标「未验证」**。
3. 找不到真问题就写「未发现」，**不许凑数**。
4. 需用户拍板的分歧用 [建议决策] 行输出：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。
5. 结尾必须给 **[核心产出]** 与 **[下一步建议]** 两行；不要把整篇原文回贴。
6. 参考材料允许自行读取：仓库根 /home/lk/Mana；v10 方案档在 /mnt/c/Users/lk/Downloads/deepseek_markdown_20260924_968609.md（Windows 路径 C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md）。

你的工作项：
【a4 · 判据盲区审计席 · 只读 · 本会议最重要的一席】核对「文档判据原文」vs「测试真实断言」。
先实跑取基线：cd /home/lk/Mana && npm run check:a1；node tools/a0-check.mjs（本机实测：A1 共 15 项 PASS 12 / FAIL 0 / 挂账 2 / 无实现者 1；A0 共 16 项 PASS 15 / FAIL 0 / 挂账 1）。
**待核实抽样（必须给出结论：属实 / 不属实 / 证据不足）**：
· docs/mana-rollout-plan.md:346（B0.2 交付物）与 :451（A1-1 判据原文）都要求机检「S1 五类 event_type（observation / attention / decision / recall / injection）各 ≥1」；
· packages/core/tests/chain-e2e.test.mjs:97 的断言列表疑似被写成 observation / mana-working-memory / mana-scheduler-attention 三个名字，其中后两个**不在契约的 8 个事件名里**；
· packages/core/src/event-types.ts:32-43 冻结的 S1 五类是带 mana/ 前缀的五个；
· 主持人实测：全仓 mana_trace 写入点使用的 event_type 字面量只有三个 —— 裸名 observation、前缀名 mana/working-memory、前缀名 mana/plugin/inactive（即裸名与前缀名在同一列混用）。
请回答：① 原文与断言的差距有多大（用集合差表示）；② A1-1 为何仍报 PASS；③ 这算「判据被放宽」还是「文档与实现口径不一致」；④ 还有多少条判据存在同型问题（至少再核 A1-2/A1-3/A1-6/A1-7/A1-9/A1-11/A1-13/A1-14 的原文 vs 实现，以及 A1-12 自认的「第二条腿未验证」、A1-5「无实现者」、ARTIFACTS「过期产物不改变任何判据的绿」这三条挂账是否真无影响）。
每条给 文件:行号 + 命令输出。**找不到就写「未发现」，不许凑数。**

**captain → theory-graft** · 2026-09-25 06:45:31

【派单 · Mana v10 评审 · 第 1 轮】

会议目标：把 v10 方案档与当前仓库实测现状逐条比对，产出评审结论 + 后续批次任务清单（最终交付物是文档，不是代码）。

硬边界（boundary_not_doing，全程不许碰）：
① 不改 packages/*/src、tools/*.mjs、docs/contract/* 任何既有文件；
② 不装任何新依赖（尤不装 sqlite-vec 扩展）；
③ 不重排已定盘的 W1/W2/W3 波次与落地册阶段划分；
④ 不把 v10 的设计意图当现状写进任何文档；
⑤ 不引入 OpenRouter 云通道、不用 options 内 logprobs 写法；
⑥ 不动 shoucang 既有件与 DSH 运行时。
本轮各席只做只读勘察与判断，**不产生任何文件改动**。

已达成的实测基线（主持人本机实跑，HEAD=b3fa4cb，可自行复跑验证）：
· node tools/a0-check.mjs → 16 项：PASS 15 / FAIL 0 / 挂账 1（A0-13）
· npm run check:a1 → 15 项：PASS 12 / FAIL 0 / 挂账 2（ARTIFACTS 产物过期、W-1..3 vec0 未装）/ 无实现者 1（A1-5）
· npm test → tests 251 / pass 251 / fail 0
· 13 包：core jev vector perception attention working-memory scheduler metacognition user-model ui long-term consolidation forgetting
· src 行数（实测）：core 1740 / jev 1856 / vector 956 / perception 118 / attention 345 / working-memory 146 / scheduler 378 / metacognition 1751 / user-model 92 / ui 397 / long-term 74 / consolidation 74 / forgetting 74
· 契约 v0.1 冻结事件 = 8 个：mana/observation、mana/attention、mana/decision、mana/recall、mana/injection（S1 五类）+ mana/jev/judge（waterfall）、mana/jev/judged、mana/plugin/inactive
· 全仓 grep 命中数 = 0 的概念（即「本仓无此物」）：ITACL/itacl、maxSteps/maxRetrievals/noProgressThreshold、intrinsic、spindle/ripple/renormal、fsrs/FSRS、distillation_log/sleep_cycles/pruning_log/agent_profile/user_profile/retrieval_induced_forgetting、openrouter/credentials、metacognition/confidence|gap

输出格式（每席都要遵守）：
1. 排序口径：先给「会掩盖其他问题 / 让失败不可观测」的缺陷，再按严重度排；不得按显眼度排。
2. 每条结论须给位置（文件:行号 / 命令输出）；**给不出即标「未验证」**。
3. 找不到真问题就写「未发现」，**不许凑数**。
4. 需用户拍板的分歧用 [建议决策] 行输出：<问题> | 选项：<A>/<B> | 推荐：<X> 理由：<一句话>。
5. 结尾必须给 **[核心产出]** 与 **[下一步建议]** 两行；不要把整篇原文回贴。
6. 参考材料允许自行读取：仓库根 /home/lk/Mana；v10 方案档在 /mnt/c/Users/lk/Downloads/deepseek_markdown_20260924_968609.md（Windows 路径 C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md）。

你的工作项：
【a5 · 机制移植评估席 · 只读】判「v10 独有而本仓零落点的机制」该不该移植。
逐项评估（每项给结论 + 一条可判据理由）：
· §19–21 ITACL 轮次内主动消费循环（三阶段状态机 / 嵌套状态机 / 9 条状态转移 / 子代理委派矩阵）
· §18.3 认知环 MCL（宿主侧已有 shoucang 的 MCL 实现，注意区分「宿主已有等价物」与「本仓插件里没有」）
· §12.4 内在奖励信号（奖励 > 0.5 时把 Write Gate 阈值降到 0.4）
· §13.3 睡眠三重振荡耦合（SO 90 分钟 / Spindle Top-N / Ripple 逐条重放）
· §17.1 三条学习路径（SOAR chunking / Hebbian η=0.01 / FSRS）
· §16.5 小胶质细胞修剪（pruningScore > 0.7）
· §8 神经科学基础对工程的映射是否可判据化（还是只有修辞价值）
评估要求：
① **先查守藏现役等价物**：守藏已有混合召回 RRF、会话蒸馏、深度睡眠、认知环 MCL、热/温/冷活性分级、白名单门禁、三层记忆库。**有等价物的必须指名，不许重复造**（例：v10 §18.3 MCL 与守藏 MCL 是什么关系？）。
② **DSH 宿主约束**：宿主有 agent/pre-step 官方 waterfall、subagent/subagent_fork 工具、ctx.llm、任务看板等。指出哪些 v10 机制与宿主既有能力重叠、哪些必须新造。
③ 每项给「**移植 / 改造后用 / 不移植**」三选一。
④ 对本仓零落点的项，注明要落到哪条链、依赖哪个未完成批次（例：ITACL 依赖 long-term 与三道门控，而 long-term 至今是 74 行骨架）。
只评估，不实现，不改任何文件。

**captain → v10-diff** · 2026-09-25 06:46:42

【更正 · 主持人自纠（我上一条派单里的两个数字有误，以本条为准）】
· v10 §34 声明的事件名不是「约 50 个」：实测 `sed -n 1524,1640p` 去重后为 **78 个 `mana/*` 名字**。
· v10 §36 的建表不是 11 张：实测 `grep -cE "^CREATE TABLE"`（1904–2068 行）= **13 张**，清单为：memory_items, production_rules, fsrs_schedule, goals, user_model, agent_profile, user_profile, distillation_log, sleep_cycles, retrieval_induced_forgetting, pruning_log, mana_trace, jev_log。
· 本仓 schema.ts 实建 **9 张**（含 1 张虚表）：memory_items, production_rules, goals, user_model, user_model_history, mana_trace, jev_log, inject_log, memory_items_fts。
⇒ 交集 6 张（memory_items / production_rules / goals / user_model / mana_trace / jev_log）；专有 7 张（fsrs_schedule, agent_profile, user_profile, distillation_log, sleep_cycles, retrieval_induced_forgetting, pruning_log）；本仓多出 3 张（user_model_history, inject_log, memory_items_fts）。
你的 a1 结论请以你**自己实跑的数字**为准，不必迁就我这两条更正；若与上述任一不符，请直接给出你的命令与输出。

**theory-graft → 汇聚网关** · 2026-09-25 06:47:49

[当前状态] 工作项 a5 完成（只读勘察，未写任何文件）。基线复核：本席独立 grep 复现了主持人给的 0 命中集（ITACL/maxSteps/intrinsic/hebbian/fsrs/小胶质/振荡/renormal），并新增取到两条关键判据面：宿主官方扩展点清单与守藏现役实现文件:行号。逐项结论如下（按「会掩盖其他问题/让失败不可观测」排序）。

**① §18.3 认知环 MCL → 不移植（宿主已有等价物，再造即双阈值源）**
- 守藏现役：真实注册点 `mcl.js:372 ctx.on('agent/pre-step', …→handlePreStep)`（本仓逐行核实记录见 docs/mana-rollout-plan.md:79、:175），阈值 `surface.mcl.familiarThreshold=0.58` 带完整预注册校准史与回滚开关（packages/metacognition/src/criteria.generated.ts:205/210）。
- 本仓已有移植面：metacognition 携带 shoucang 判据注册表投影（v2.2.0，含 mcl 段），但**零消费者**——docs/mana-project-status-plan.md §2.7 明写「不熟悉检测 Noul 未实现」。⇒ 要做快通道只需**接消费点**，不需按 §18.3 新造机制。判据理由：再造会让同一 waterfall 出现第二个 MCL 阈值源，「哪个阈值生效」不可观测（本仓首位缺陷类）。

**② §19–21 ITACL（三阶段/嵌套状态机/9 条转移/子代理矩阵）→ 不移植（阶段行为已被等价物覆盖，状态机部分与宿主重叠）**
- 等价物指名：守藏 `human-execution-loop.md`（99 行）七步循环，每步带「决策点/地基/判定标准/失效信号」四元组；⑥ 偏差即回溯（:66-72「同方向连续 2 次无实质进展→强制停下」）= v10 的 noProgressThreshold=3 同类物；循环×记忆钩子表（:82-92「检索贯穿全程、写入只在⑥⑦两闸口」）= v10 阶段一预检索 + 阶段三固化。
- 宿主约束（实测）：`agent/pre-step` 是官方 waterfall，payload `{agent,messages,turn,step,signal}`，`next()→PreStepDecision`（node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:304-310）——**返回值只有 reject/enter，没有任何「信息充足度」通道** ⇒ v10 的 0.7/0.6 阈值无处落，照写即造第二个假旋钮（守藏已吃过同类：criteria-gate.json:214 `mcl.fastGate` 是「改它零效果」的死配置）。且本仓 attention 已占同一扩展点（packages/attention/src/index.ts:193），再加一个消费者即 G9 争用（rollout-plan.md:175）。阶段三的现成挂点是宿主 `agent/turn-stopping`（runtime-types.d.ts:387），不是新状态机。
- §21 子代理矩阵：subagent/subagent_fork 是**宿主自带能力**（本会话实测可用），§21.1 表格是把宿主既有能力写进方案，§21.2 的安全边界（输入隔离/输出审查/工具限制/超时 interrupt）对应宿主 subagent 参数面 ⇒ 无新造项。

**③ §17.1 三条学习路径**
- SOAR chunking：**已在册**（B4.1「子目标 active→done、算子序列 ≤7、模式重复 ≥2」rollout-plan.md:546）→ 不新增。
- Hebbian（η=0.01）：**不移植**。本仓检索为「FTS5 词法 + bge-m3 余弦 + RRF 确定性排序」（packages/vector/src/index.ts:5/76、recall.ts:2），没有可写权重的联想网络，Δw_ij 无落点（grep hebbian=0）。
- FSRS：**不移植，且是冲突项**。B4.2 已定「半衰期 14 天 + S 更新按 Pavlik & Anderson `ΔS=a·(S_max−S)^b`」（rollout-plan.md:547），A1-5 已冻结确定性值 decay(14)=0.500000（rollout-plan.md:455）；v10 的 `R(t,S)=(1+t/(9S))^(-1)` 是**第三套公式**，正是册内 C14 要收敛掉的（rollout-plan.md:503「三套公式收敛为一套，否则同一条记忆被两家乘过」）。写侧也不存在（grep fsrs=0）。
- 唯一值得吸收的增量：**「何时该复习」的调度语义**（B4.2 现在只有衰减+归档），改造后用，用既有 S/衰减派生，不引 FSRS 公式。

**④ §13.3 睡眠三重振荡 → 改造后用（只取 Spindle/Ripple 两层）**
- 等价物指名：守藏深睡（会话全停滞 ≥3h → 归纳子代理 → write_gate → 原子写 AGENT.md，memory-whitelist-spec.md:189）+ 成熟度 `A=A0+step·(跨日再现日数−1)`（scripts/maturation-scan.mjs 头注）；本仓 B4.1 交付物已含「相似度 ≥0.7 合并」。
- 判据理由：Spindle Top-N + Ripple 逐条比对/合并/标巩固层级 = B4.1 的算法说明，写进批次即可；**SO 90 分钟节律不移植**——守藏是「停滞 ≥3h」语义，加第三套节律=重演 C14 多写者（rollout-plan.md:774）。

**⑤ §16.5 小胶质修剪 → 改造后用（不新造评分函数）**
- 等价物指名：守藏归档链路完整（冷 ∧ ≥90d ∧ 三守卫 → notes/archive 原位 stub 可回滚，memory-whitelist-spec.md:343；配 archive-prune.mjs/archive-lib.mjs）；本仓 B4.2「激活值四区间归档」已在册，且册已点明「必须同时给归档留存上限」（rollout-plan.md:547③）。
- 判据理由：`pruningScore>0.7` 是未登记的第二套评分函数 ⇒ 改为「把修剪候选做成四区间归档的只读视图/标签」，阈值进 criteria 注册表并给预注册判据+样本（守藏登记制原文 criteria-gate.json:209）。

**⑥ §12.4 内在奖励 → 改造后用（离线核验，非在线降阈）**
- 等价物指名：守藏第⑤步每步验证（「拿不出证据=未完成」human-execution-loop.md:56-60）+ ④小步执行越权禁令（:50-53）+ memory_write_gate.mjs + 阈值登记制（criteria-gate.json:209：影响接受/拒绝/取舍的数值阈值必须登记且含预注册+样本）。
- 判据理由：`奖励>0.5→Write Gate 阈值降到 0.4` 是**未登记的动态阈值调整**，0.5/0.4 无预注册无样本；且本仓 Injection Gate 判定源尚未接 JEV（status-plan:123/:317 `jevProb` 恒 null，不得用 0 冒充）——静态阈值都还没有。⇒ 改造后用 = 收尾由模型判一次「是否产出可复用经验」，只作**候选进 pending/ 的意见**，阈值登记。

**⑦ §8 神经科学基础 → 不移植（只作命名与章节来源，不进判据面）**
- 判据理由：可判据化的部分 v10 自己已落到 §12.4/§13.3/§16.5（上面已逐条判）；§8 本体（SO/Spindle/Ripple 频率、Rac1/Cofilin、Engram）给不出「表/字段名 + 命令」。同一口径册内已用过：rollout-plan.md:77 判 §14 十条检测方式为「真有信号 0 / 半真 3 / 愿望 7」。

**[核心产出]**
方向：**七项里 0 项「移植」、3 项「改造后用」（睡眠振荡的 Spindle/Ripple 两层 → 并入 B4.1；修剪 → 并入 B4.2 归档候选视图；内在奖励 → 落守藏离线核验+pending）、4 项「不移植」（MCL 有宿主现役实现、ITACL 阶段行为有守藏七步循环等价物且其状态机与宿主 agent loop 重叠、FSRS/Hebbian 既重复又与已冻结判据冲突、§8 无判据面）**。
关键取舍：① 贯穿判据 = **Mana 侧只接消费点，不复刻守藏已有机制**（metacognition 已带 shoucang 注册表投影却零消费者，这是最省且不产生双真源的路）；② 一切「阈值/评分函数」类增量必须进 criteria 注册表并给预注册+样本，否则就是假旋钮；③ v10 的表格化描述（§19.4 转移表 / §20.4 参数表 / §16.5 公式）若被读成规格写进落地册，会造出「文档说做了、代码没做」的不可观测面——即边界声明第④条

…（已截断，原长 4856 字符）

**v10-diff → 汇聚网关** · 2026-09-25 06:51:25

[当前状态] 工作项 a1 完成（只读勘察，零写入、零文件改动）。v10 §32/§33/§34/§36 四区块逐条对照本仓实测，全部结论带 文件:行号 或 grep 命中数。未复跑 a0-check（本机跑超 120s 超时），A0-5 数字采用主持人基线与静态源码证据（tools/a0-check.mjs:150-206）双证。

═══ 排序口径内的前两条（会掩盖其他问题 / 让失败不可观测）═══

**甲 · 装配态与版本真源漂移（假绿源）**
- 13/13 包入口都是构建产物：packages/core/package.json:8 `"main": "./lib/index.js"`；而 `.gitignore:6` 忽略 `packages/*/lib/`（注释自称"源码是真源"）。
- core 实测：`lib/schema.js` **无** user_model_history、**无** 触发器与 rebuild、jev_log **无** gate 列；src 全部已有。计数（grep -c -F）：`trg_memory_items_fts_ai` src=2 / lib=0；`VALUES('rebuild')` src=1 / lib=0；`gate TEXT` src=2 / lib=1；表名 diff：lib 7 张 vs src 8 张（缺 user_model_history）。
- 写入面同源：`user_model_history` 在 packages/core/src/index.ts:471（INSERT）与 :507（SELECT）有生产者，packages/core/lib/index.js 命中 0。
- 时间戳佐证：lib/schema.js mtime 2026-09-25 04:41:14 < src/schema.ts 06:42:52。
- 后果：任何"跑装配态"的对照/判据会与 src 面得出**相反结论且不报错**。⇒ 本席 §36 全部结论以 src 为准并已注明；lib 漂移交给主持人汇总，本席不改（边界①）。
- 同族交叉证据（过期断言，仅登记不改）：packages/user-model/src/index.ts:7-11 仍写"user_model_history 在 core/src/schema.ts 不存在（grep 空命中）"，而 src/schema.ts:107 已建、src/index.ts:471 已写。

**乙 · grep 口径（把"命名不同"读成"没有"）**
- `mana-llm` 全仓命中 4，**全部在 docs**（docs/mana-project-status-plan.md:235/250/414、docs/deepseek_markdown_20260924_c7ffea.md:131），packages/ 与 tools/ 命中 0；而 LLM 适配能力实际存在：packages/jev/src/ollama.ts:1-30（`POST /api/chat` + logprobs 单 token 判定原语）、jev/src/index.ts:102/120（model 配置）。
- 故下表一律区分【无同名 + 无同类】/【无同名 + 有等价物】，不写"缺失/需补"。

═══ ① v10 §32 插件清单 18 个 vs 本仓 13 包 ═══
v10 清单实测：sed -n '1478,1500p' 取 `dsh-mana-*` 去重 = 18 个；本仓 `export const name` 实测 = 13 个（packages/*/src/index.ts，13/13 有）。

| v10 §32 插件 | 本仓对应 | 判据 |
|---|---|---|
| core / jev / vector / perception / attention / working-memory / long-term / consolidation / forgetting / scheduler / metacognition / user-model / ui（13） | ✅ 同名同形 | packages/<同名>/package.json name=dsh-mana-<x>；13/13 |
| llm | ⚠ 无同名 + **有等价物** | 包目录不存在；LLM 适配落在 jev（jev/src/ollama.ts:1-30、jev/src/index.ts:102/120） |
| reconsolidation | ❌ 无同名 + 无同类（grep 范围 packages/ tools/ package.json = 0） | 无目录、无 name、无引用 |
| learning | ❌ 无同名 + 无同类（同范围 = 0） | 同上 |
| itacl | ❌ 无同名 + 无同类（grep packages/ tools/ docs/ 全仓 = 0） | 同上 |
| shoucang-adapter | ⚠ 无同名 + **有等价物（非独立包）** | 桥接以 pre-step 直通形式落在 core：packages/core/src/index.ts:355-364（`next()` 直通保住 shoucang 的 panel-inject/mcl 两条下游链）；全仓 `mana-shoucang` = 0 |
| —（本仓多出） | 无新增包 | 13 包是 18 的子集，无 v10 未列的包；v10 §32 未列的具体面只有 user_model_history（见 ③） |

═══ ② v10 §34 事件契约 78 vs 本仓 8 ═══
v10 实测：sed -n '1524,1640p' 正则 `'mana/...'` 去重 = **78 名**。本仓：packages/core/src/event-types.ts:30-61 `interface Events` = **8 名**（全仓唯一一处声明：`grep -rn "interface Events" packages --include=*.ts` → core/src/event-types.ts:31，+ lib/types 派生件）。

- **交集 3**：mana/observation（:34）、mana/jev/judge（:49，waterfall）、mana/jev/judged（:55）。
- **v10 独有 75，按族归档**（零落点已逐名 grep 验证：75 名在 packages/ 全仓命中 = 0）：

| 族 | 条数 | 代表名 |
|---|---|---|
| mana/jev/* | 20 | write-gate / recall-gate / injection-gate / safety-gate / task-complexity …（11 专用入口 + 7 个 ITACL 专用 + degraded/cache-hit） |
| mana/sleep/* | 8 | started / so-scheduling / spindle-selection / ripple-replay / synaptic-renormalization / principles-extracted / paths-extracted / completed |
| mana/forgetting/* | 7 | activity-level-changed / distilled / audited / microglial-pruning / rac1-pathway / interference-detected / neurogenesis-replacement |
| mana/learning/* | 7 | chunk-created / hebbian-updated / fsrs-scheduled / principle-extracted / task-path-extracted / agent-profile-updated / user-profile-updated |
| mana/itacl/* | 6 | started / step-started / step-completed / retrieval-triggered / completed / aborted |
| mana/distillation/* | 5 | started / filtered / adjudicated / gate-rejected / completed |
| mana/memory/* | 5 | encoded / retrieved / consolidated / reconsolidated / decayed |
| mana/retrieval/* | 3 | context-recall / degraded-to-lexical / pointer-follow |
| mana/scheduler/* | 3 | unfamiliar-task-detected / mcl-injected / mcl-skipped |
| mana/metacognition/* | 2 | confidence / gap |
| 单件 | 9 | fo

…（已截断，原长 8285 字符）

**captain → 汇聚网关** · 2026-09-25 06:52:43

[当前状态] 第 1 轮进行中：a5（机制移植）、a1（v10 对照）已回报并写入记录；a2/a3/a4 勘察中；a6/a7 待前序。本席（主持人）不空转轮询，以下为两条**亲测**的独立裁定。

[主持人独立裁定 · 两条 L1 级可观测性缺陷]

① **装配态（lib）与真源（src）漂移，且当前所有「装配态判据」的绿都建立在过期 lib 上。**
　证据（本席实跑）：`packages/core/package.json` 的 main/exports → `./lib/index.js`；
　`packages/core/lib/schema.js` mtime = 2026-09-25 04:41:14，`packages/core/src/schema.ts` mtime = 2026-09-25 06:42:52；
　src 侧有 `user_model_history` / `trg_memory_items_fts_ai` / `VALUES('rebuild')` / `gate TEXT`，lib 侧 grep 命中全为 0。
　影响面：`tools/r0-assembly-check.mjs:217` 走 `ctx.loader.create({ name })` → 按包名解析 → 吃 lib ⇒
　**R0 / A1-1 / A1-13 / A1-14 / W2-5 这五类装配态判据测的是旧实现**，不是当前 src。
　反面对照（避免夸大）：A0-8 **不受影响** —— `tools/probes/a08-schema.mjs:18-20` 直接 import `packages/core/src/db.ts` 与 `src/schema.ts` 真源。
　**分歧点（请 a4 判据盲区席在 a6 复核时定案）**：`tools/a1-check.mjs` 的 ARTIFACTS 项自述「过期产物**不改变任何判据的绿**」；
　本席判该表述**不成立** —— 过期 lib 会让装配态判据测到旧代码，绿就不再是对当前 src 的绿。
　且 ARTIFACTS 现为 **挂账（HANG）而非 FAIL** ⇒ 门照常通过（判据腿只查 FAIL）⇒ 过期产物可以长期存在而不报警。这正是「让失败不可观测」。

② **本会话不是该仓库的唯一写者。**
　`git status --porcelain`：`tools/a0-check.mjs` 有 **65 行未提交改动**（mtime 05:26，内容为「--record-baseline 记录失败 ⇒ 退出码 2」三态退出码改造）；
　`packages/core/src/schema.ts` 在 **06:42:52** 被改动 —— 本席 **06:38** 跑完基线后 4 分钟。
　⇒ 本席 06:38 取的基线（A0 16 项 PASS 15 / A1 15 项 PASS 12 / npm test 251）**只对那一刻与该 HEAD 成立**。
　评审结论与任务清单必须标注**取数时刻 + HEAD**，不得当作恒定事实引用；任何「按基线判绿」的动作都要先复跑。

[核心产出] 两条 L1 级可观测性缺陷，均带 文件:行号 与实测 mtime：装配态漂移（含精确影响面与反面对照）、并发写者（含未提交改动量与时间差）。
[下一步建议] ① 《评审结论》第一章写这两条；② 批次清单给「lib/src 漂移的构建链回归面」单列任务，并配「基线与 HEAD 绑定」的机检；③ a4 在判据盲区结论里对 ARTIFACTS 的自述给出成立/不成立裁定。

**jev-v10 → 汇聚网关** · 2026-09-25 06:56:46

[当前状态] 只读勘察完成（未改任何文件；v10 §6/§22/§23/§24/§25/§26 全读，packages/jev 4 文件 1856 行 + packages/attention 345 行 + core 的 jev_log 链实读）。本轮未复跑 npm/a1-check（120s 超时一次，已放弃）——下面结论只用文件:行号与单条 grep 支撑，不依赖全套件输出。

## 一、排序第一档：会掩盖问题 / 让失败不可观测

**1（最高）A1-8 报 PASS，而它的载体列没有生产写者 —— 夹具绿 ≠ 真数据绿。**
- packages/core/src/schema.ts:150 给 jev_log 建了 gate TEXT CHECK(gate IS NULL OR gate IN ('unavailable','budget'))；
- 唯一生产写者 packages/jev/src/ollama.ts:261-266 的 JEV_INSERT_SQL 只插 13 列，列清单里没有 gate（grep -rn 'gate' packages/jev/src/ → 0 命中）；
- A1-8 三条用例（packages/core/tests/jev-gate.test.mjs:44-66）用自己的手写 SQL 插入 gate ⇒ 判据证明的是「表能收这个值」，不是「真通道会写这个值」。
- ⇒ 由 A1-8 PASS 推不出「门控失败在运行态可归因」。复跑命令：grep -rn 'INSERT INTO jev_log' packages/jev/src/ ；grep -rn gate packages/jev/src/。
- 修订我自己的证词口径：宿主基线把「options 内 logprobs」列为已订正项——本仓现状确实顶层（ollama.ts:202-206：think/logprobs/top_logprobs 在顶层，options 只放 {num_predict,temperature}）；但 v10 里 logprobs 一词命中 = 0（grep -c logprobs v10），该坑属前代参考文档（docs/deepseek_markdown_20260924_c7ffea.md），不是 v10 复发项。

**2 v10 §24「批量调用」整条链零落点，但 §24.1/§24.2 的表格读起来像已有链路。**
- §24.1:1017 + §6.2:231 两处写「发送 50 个问题和发送 1 个问题耗时相近」= 已订正冲突复发（本仓订正在 docs/mana-project-status-plan.md:15-17：50 问单次 1046–1228ms vs 50 并发 7599ms）；
- §24.2:1019-1027 五个批量场景（Write Gate 2 问 / Recall rel_<id> Top-50 / 执行步 3 问 / 任务前 need_<id> / 遗忘 decay_priority_<id>）在本仓全零：framework.ts:551-562 的 judgeSeries() 注释原文是「串行（同一时刻只让一个在飞）」，judgeWithGuard() 每调用 = 1 次 HTTP 往返；
- §24.3:1031-1047 batchJudge 三处不成立：URL 是 openrouter（见二①）、凭据是 ctx.credentials（见二②）、且它把一个「只 1 次往返」的调用命名为批量——按本仓实测，省的是往返次数不是「耗时相近」（同 v6.3 订正）。

**3 §23 表格的误读风险（给机制，不泛泛）——39 行里只有 1 行真落地。**
- 全表 39 行（v10:973-1011；命令 sed -n '973,1011p' v10 | wc -l = 39；其中 27 行标 JEV / 12 行标 LLM）。
- 真落地只有 Injection Gate 一行：attention/src/index.ts:287 用 ctx.waterfall('mana/jev/judge',…) 分发 + jev/src/index.ts:284 监听器接链（HEAD b3fa4cb）。失败策略「Fail-closed」确为真（attention/src/index.ts:300-304 → degraded_unavailable：不注入但留痕）。
- 其余零落点：decay_priority / relevant_ / rel_ / tool_choice / urgency 在 packages/*/src 命中数全 = 0；worth_keeping src 1 命中=列名（core/src/schema.ts:51，无写者）；supersedes src 8 命中全是 metacognition 的 L0 冲突语义（criteria.ts:104/160），与 §25.1:1063 的 Choice 问句同名不同物。
- 误读机制（具体）：表头 = 链条 | 接入点 | 模型 | 原语/方式 | 阈值 | 失败策略，其中 4 列都填具体值（0.6 / Fail-open / Score / 0.5 / Fail-closed…），没有任何状态列 ⇒ 表格的信息结构里不存在「是否已实现」这个维度，读者只能把「有阈值有失败策略」读成「这条已经接好了」。反证在同一张表的另一个版本：v6.3（docs/mana-project-status-plan.md:94-98）保留原三列骨架、把「内容」列逐项改写成「未实现 + 协议层是否支持」，并附核实命令 —— 同一张表，差别只在有没有状态列，可读性结果相反。

**4 §25「21 个 Prompt」实际列出 23 个 const，本仓逐个 grep 全 = 0。**
- v10:1054-1275 顶层 const 计数：awk 'NR>=1049&&NR<=1276' v10 | grep -c '^const ' = 23，而标题 §25 自称 21 ⇒ 文档自相矛盾（多出 EMOTION_AROUSAL_PROMPT、RECONSOLIDATION_UPDATE_PROMPT 等）。
- 23 个名字（WRITE_GATE_PROMPT / SUPERSEDES_PROMPT / … / COMPLETION_VERIFICATION_PROMPT）在 packages/ tools/ docs/contract 命中数全 = 0。
- 关键分界（免得被当成「查无此物」）：协议面存在 —— packages/jev/src/systemone.ts:119-126 的 JevQuestion/JevQuestions、:197-203 的 buildSystemoneBody(state, questions, model) 支持多问；缺的是模板文本与调用点，不是能力。

**5 §26 校准五步的第 1 步在本仓拿不到数据 ⇒ 照抄会造一台无数据的校准器（假旋钮）。**
- grep -rn 'calibrat' packages/*/src tools/*.mjs（排除 criteria.generated）= 0；
- §26.2:1296-1300 第 1 步「数据收集（从 jev_log）」对齐 §26.3:1306-1309 的 SQL WHERE source=? AND created_at>?；而本仓 jev_log 只有 result_value/probability/degraded（无真值标签、无 gate 写入）⇒ 算不出 precision/recall/F1，第 3 步「F1 最大化」无输入；
- 仓内同名不同物易混：packages/metacognition/skill/engine/criteria-gate.json:268 的 calibrator: scripts/mcl-calibrate.mjs 是 shoucang 域 MCL 相似度阈值校准，不是 JEV 判定阈值；且该脚本不在本仓（find /home/lk/Mana -name mcl-calibrate.mjs 空命中，实体在 /mnt/d/FF/shoucang/scripts/）。
- 仓内真有的校准实践（三次重校准、预注册判据、样本量翻转结论）登记在 packages/metacognition/src/criteria.generated.ts:210 —— v10 五步与它不同源，不要并用。

## 二、已订正冲突复发（逐条）
| # | v10 位置 | 本仓实测 | 性质 |
|---|---|---|---|
| ① 端点 | :240（§6.3「OpenRouter（首选）」）、:1033（§24.3 fetch URL） | systemone.ts:55 SYSTEMONE_DEFAULT_ENDPOINT='https://nano-gpt.com'；缺省通道=ollama（index.ts:113）。openrouter 只出现在 docs，且已被拍板否决（docs/mana-rollout-plan.md:52/109/113、docs/arch/phase0-g15-attribution.md:23 的 G13） | 复发，触边界⑤ |
| ② 凭据 | :1036 ctx.c

…（已截断，原长 6701 字符）

**captain → 汇聚网关** · 2026-09-25 06:58:11

[当前状态] 第 1 轮：a5 / a1 / a2 已回报；a3（路线图）勘察中；a4（判据盲区）勘察中；a6/a7 待前序。本席逐条复核了 a2 的承重论断，结论如下（**一条成立、一处纠正不成立**）。

[主持人复核 a2 · 三态判定]
· **成立**：A1-8 是**夹具自证**。实读 `packages/core/tests/jev-gate.test.mjs:44-66` —— 该测试用**自己的 `insert()` 手写 SQL 直接塞 `gate` 列**；
  而生产写者 `packages/jev/src/ollama.ts:262-266` 的 INSERT 列清单**不含 gate**；`grep -n gate packages/jev/src/*.ts` → **0 命中**。
  ⇒ 由 A1-8 PASS **推不出「运行态可归因」**，只能推出「列存在 + 取值域受限 + 夹具能塞值」。判据原文（落地册:458）要求的是「门控失败可区分」，**当前实现没写这个字段**。
  这与 a1 报的 lib/src 漂移是**两个独立缺陷**（一个在写者侧、一个在产物侧），不互相解释。
· **成立**：§23 表无状态列。实测表头 = 链条|接入点|模型|原语|阈值|失败策略，**39 行数据**（派单里我写「40 行」，实为 39）；四列全填具体值 ⇒ 表格信息结构里不存在「是否已实现」维度。对照 `docs/mana-project-status-plan.md:94-98` 保留同骨架、把「内容」列改写为「未实现」，可读性结果相反。
· **主持人纠正一处（我派单里的预设错了，a2 的纠正成立）**：v10 全文 `grep -c logprobs` = **0**。派单里我把「options 内 logprobs」列为「v10 已订正冲突复发」是**错误归因** —— 那是前代文档（`docs/deepseek_markdown_20260924_c7ffea.md`，v6.3 原文）的坑，v10 里根本没这项。撤回该条，不写进评审结论。
· **待 a6 裁定的新增项**：a2 指出 v10:246 / :958 / :967 三处声明「JEV 从不生成文本 / 不能创造内容」，而本仓缺省通道是 `ollama` 跑 `qwen3.5:0.8b`（**生成模型**），`systemone`（真 JEV 本体）须显式开启 ⇒ **v10 的安全边界论证与本仓缺省实现结构不一致**。本席判**成立且在「会掩盖问题」档**：
  因为该不一致使「记忆内容不可能由判定侧产生」这一安全结论在本仓缺省配置下**不成立却无人报错**。请 a6 复核后定级（建议：不是缺陷而是**口径必须写进文档**，避免下游把「模型永远无法创造记忆内容」当作既成事实引用）。

[主持人 · 面向后续波次的裁定]（a2 提的两条 [建议决策]，本席按协议先归拢、待全场收敛后进决策卡，不在聊天里散问）
· A1-8 定性：**采纳「夹具自证」** —— 因为「生产者列清单与判据夹具分离」是可复跑事实（上述命令与行号），非推断。处置归 a7 批次清单。
· v10 能否作接入面参照：**倾向「仅协议参照、接入面以 v6.3 实况册为准」**，理由由 a2 给出（§23 无状态列 + 至少三处冲突复发）；因涉及「文书写法口径」列 R3 越权面，进用户决策卡。

[主持人 · 转给 a4 判据盲区席的新增核查点]
① **A1-8 与 A1-13 的区别必须判清楚**：A1-13 的 `gate` 五类枚举走的是 `inject_log`（有真生产写者，6 条用例真跑 agent/pre-step）；A1-8 的 `jev_log.gate` 是**另一张表、另一个夹具**。请确认二者不是同一机制被算了两次，也不是「一张表有写者就把另一张表的缺陷掩盖过去」。
② 请把 A1-8 与 A1-1（五类 event_type）并列为**同型**：都是「判据原文要求的事实」与「断言实际检查的事实」不一致，且都报 PASS。

[核心产出] a2 的三条承重结论经复核：A1-8 夹具自证成立、§23 无状态列成立、logprobs 归因由本席撤回；新增「v10 安全边界 vs 本仓缺省通道」口径冲突一条，待 a6 定级。
[下一步建议] ① 评审结论里 A1-1 与 A1-8 并列为「判据与断言不同源」的同型缺陷；② 批次清单给「jev_log.gate 生产写者」单列任务并配真通道回归面；③ 决策卡合并 a2 两条 + a5 一条（共三条待拍板）。

**risk-reviewer → 汇聚网关** · 2026-09-25 07:11:00

[当前状态] 独立审查席第 1 轮完成。被审对象：本会议记录中**已存在的三条产出** —— 主持人条目 #8/#10（两条独立裁定 + 对 a2 的复核）、v10-diff 席（#7）、jev-v10 席（#9）。其余工作项（a3/a4/a6/a7）**尚未写入记录**，故**无可审，不预判**。本席全程只读，零文件改动（边界六条自检：未改 packages/*/src、tools/*.mjs、docs/contract/*，未装依赖、未重排波次、未动 shoucang/DSH 运行时）。

先纠正会污染全部判定的两条**取数口径**（这两条不纠正，下游的「成立」都建立在不稳定基线上）：
· 主持人据以派单的基线（A0 15/0/1、A1 12/0/2、npm test 251）**当前已不成立**。本席 07:0x 实跑：npm test = **252 项 / pass 249 / fail 3**（/tmp/mana-test-full.log）；node tools/a0-check.mjs = 16 项 **PASS 13 / FAIL 2 / 挂账 1**（A0-6 FAIL、A0-7 FAIL，/tmp/a0.json）；npm run check:a1 = 15 项 **PASS 12 / FAIL 0**（/tmp/a1b.log）。三条命令均在 HEAD=b3fa4cb 执行 —— **同一 HEAD 不同结论，差异只能来自并发写者**。
· 本仓**确有并发写者且正在活跃改动**：`git status` 现为 `M packages/core/tests/judge-chain.test.mjs` + `M tools/a0-check.mjs`；judge-chain.test.mjs mtime=**07:00:24**，本席 06:5x 跑全量时它还在旧版。实证三次：06:5x 单跑 judge-chain → **fail 2**（J1「jev 判定监听器应真接上」不成立、J4 因 J3 哨兵被 J1 残留监听器吃掉而 unhandledRejection）；07:03 再单跑同一个文件 → **pass 5 / fail 0**（/tmp/jc3.log），且文件内 J4 用例标题已被改写。⇒ **凡「红」必先按 mtime/复跑判归属**，不得把并发写者的在途改动记成本轮回归。
· 附带：主持人条目 #10 称 §23 表「派单里我写 40 行，实为 39」——修正成立，本席复算 `sed -n '973,1011p' v10 | wc -l` = **39**。

═══ 逐条三态判定 ═══

【D1 · 成立】lib/src 漂移存在，且 lib 仍是装配态真源。
· 复现：13/13 包 `package.json main = ./lib/index.js`（逐包 python3 取值，全同）；`.gitignore:6` 忽略 `packages/*/lib/`；`packages/core/lib/schema.js`（mtime 04:41）grep -c `user_model_history`=**0** vs `src/schema.ts`（06:42）=**2**、`trg_memory_items_fts_ai` lib=**0** vs src=**2**。
· `tools/r0-assembly-check.mjs:217` 走 `ctx.loader.create({name})` ⇒ 按包名解析 main ⇒ **吃 lib**（:43-44 只 import 宿主的 cordis，与本议题无关）。
· 主持人#8 给的影响面判 **成立**（R0/A1-1/A1-13/A1-14/W2-5 测的是旧实现）。
· **本席新增一条同族、且比它更严重的**：`tools/a1-check.mjs:405` 的 ARTIFACTS 项**直接读 `packages/*/lib/index.js`**，却判 HANG 且自述「过期产物不改变任何判据的绿」——**这句话对 A0-5 是真、对 A1-4/A1-11/A1-12 是假**，因为那三项断言的是 `packages/vector/src/cosine.ts`、`src/rrf.ts`、`src/adapt.ts` 的公式与常量，白盒读 src ⇒ **构建链漂移对它们是隐形的**（实测 W2-5 报 `packages/.../lib/index.js [apply,inject,name]`）。⇒ 「ARTIFACTS 是不是真挂账」这一分歧，正确裁定是**分层**：对解析型腿不可免，对白盒腿本来就不经 lib、免除成立。**不能一票否决也不能一票通过**。
· **回归风险（本轮只读，未复现）**：core/src 现已有 `writeInjectLog/listInjectLog`（grep 命中 3/2），但 04:41 的 `lib/index.js` 相应导出计数 2/1 ⇒ **任何 src→lib 重建都会同时激活 core 的服务面变更**，R0 的 13 包装配判据必须在重建后复跑，不得直接沿用「R0 通过」的旧结论。

【D2 · 成立（但一条给出机制的措辞需修正）】「夹具绿 ≠ 真数据绿」这个高级形态在本仓落地。
· `packages/core/tests/jev-gate.test.mjs:119` 夹具确实**自己构造含 gate 的行**（`insert(db, { id:'n-2', gate:null, degraded:1, result_value:'no-logprobs' })`），而生产写者 `packages/jev/src/ollama.ts:262` 的 `INSERT INTO jev_log` 清单不含 gate（`grep -rn gate packages/jev/src/` = **0**）。主持人#10 判「夹具自证」**成立**。
· ⚠ **修正会议里被提到的 `jev-gate.test.mjs:44-66`**：该区间**不含 gate 夹具**（它断言的是无 gate 行「degraded 与 gate 至少一非空」侧），gate 夹具在 **:119**。结论不变，位置须更正 —— 否则下游按错误行号复核会「找不到」。
· 独立佐证（本席实跑）：`packages/vector/lib/index.js` **1 月 04 日 01:04** vs `src/index.ts` **09-24 20:24**（隔 4.7 小时），**没有任何判据报红** —— 这说明产出/真源漂移在本仓是**无人看管**的长期态，不是一次性事故。

【D3 · 成立，且传染面比会议已提的更大】主持人#8「并发写者」判定成立，本席补三处**已过期但写在源文件里**的断言：
· `packages/user-model/src/index.ts:7-11` 仍写「user_model_history 在 core/src/schema.ts 不存在（grep 空命中）」，而 `src/schema.ts:107` 已建、`src/index.ts:471` 已写。
· `packages/core/src/index.ts:471/507` 引用的表在 04:41 的 lib 里**不存在** ⇒ 运行态 INSERT 会落到缺表。
· ⇒ 这不是「文档过期」，是**源文件注释里的实测结论过期**，且它正是后续席「按注释取证」的输入。

【D4 · 证据不足】v10-diff 席 §34 的三档计数（18 插件 / **78** 事件 / 13 表）本席独立复算**全部对得上**：`sed -n '1524,1639p' v10 | grep -o "'mana/[a-zA-Z0-9/_-]*'" | sort -u | wc -l` = **78**；`sed -n '1478,1500p'` = 18 行；`sed -n '1902,2072p' | grep -c '^CREATE TABLE'` = 13。**但**：① 该席**未复跑任何机检**（自述超时）却给出跨 13 包的结构断言 ⇒ 其「13/13 有 cordis.patch.yml」属**未经机检的转述**（本席复核 = 13，成立）；② 该席称 `packages/core/src/index.ts:355-364` 是「shoucang 适配面」—— 实读该处是 `agent/pre-step` 的 `next()` 直通调用，**不是任何 shoucang 桥接能力**，v10 §32 的 `dsh-mana-shoucang-adapter` 在本仓**仍是零落点**。⇒ 该席「llm 有等价物」成立，「shoucang-adapter 有等价物」**不成立**。
· **反向一条最重**：该席列举「v10 未提、本仓已冻结」的 5 个事件时**漏了 `mana/plugin/inactive`**（`event-types.ts:59`），却在同段引用了它 ⇒ 自相矛盾的脱落，须在收敛稿里补齐。

【D5 · 成立，但该席的「零落点」有一处夸大，且已在自己的证词里出现反例】
· jev-v10 席 §23「39 行里只有 Injection Gate 一行真落地」——**行数与结论成立**

…（已截断，原长 11211 字符）

**captain → 汇聚网关** · 2026-09-25 07:11:44

[当前状态] 第 1 轮：a5/a1/a2 已回报，a6（独立审查）**已回报并审了前三条**；a3（路线图）与 a4（判据盲区）仍在勘察。本席逐条复核了 a6 的纠正，**三条纠正全部成立，其中一条打在本席自己头上**。

[主持人复核 a6 · 三态判定]
· **成立（打在本席头上）**：本席在 #10 写的 `jev-gate.test.mjs:44-66` 是**错误行锚**。实读：`:41` 是词表定义、`:44-66` 是 `insert()` 辅助函数体、**真正的夹具断言在 `:69`（G1）与 `:88`（G2 起）**。
  纠正不影响结论（生产写者确无 gate 列——`packages/jev/src/ollama.ts:262-266` 列清单已逐字复核），但**行锚错了**——这正是本仓「引错位置比结论错更危险」的那类教训。已记录。
· **成立（收窄本席的过度概括）**：本席在 #8 写的「R0/A1-1/A1-13/A1-14/W2-5 五类装配态判据吃过期 lib」**方向对、范围过宽**。a6 指出 A0-5 与 A0-8 走 src：
  复核 `tools/a0-check.mjs:171` 读 `packages/<dir>/src/index.ts`（src ✓）、`probes/a08-schema.mjs:18-20` 直 import `src/db.ts`+`src/schema.ts`（src ✓）。
  ⇒ 采纳其收窄：受影响的是 **R0 / A1-1 / A1-13 / A1-14 / W2-5 / ARTIFACTS 共 6 项**，**不含 A0-5/A0-8**。本席撤回「全部机检」的措辞。
· **成立**：「§23 阈值 0.6 vs 本仓 0.7 冲突」应降级为口径备注 —— `packages/attention/src/index.ts:49` 已登记 `jevThreshold`（方案 §9.4 原值 0.7）。不做为冲突项。

[主持人 · 对 a6 新增环境发现的独立复核]
· a6 报「本机 Ollama 单次嵌入需 20–28s，而 `packages/vector/src/embed.ts:72` 本地超时 = 30_000ms ⇒ 余量仅 2–10s，judge-chain 外 2 个 fail 由此而来」。
  本席复核到**该结论的机制侧证据**：`embed.ts:72` 原文 `const timeoutMs = cfg.timeoutMs ?? (local ? 30_000 : 8_000)` —— 超时值确为 30s，且**是缺省值**（可被 cfg 覆盖）。
  本席**不采信**「20–28s」这个数字（B 档浮动量，且本席 06:38 跑测时未复现该延迟），但**采信其结论方向**：超时余量小到会让同一判据在红绿间摆动，属「失败不可观测」。
  ⇒ 定为**待办**（不是本轮缺陷，也不是可抹掉的噪声），并请 a4 在判据盲区结论里回答：`npm test` 的 251/251 是**取数时刻环境态**，还是**稳定可达态**？若为前者，A0-6「CI 绿」的判据表述需要加条件。

[主持人 · 转 a4 的三个待裁决点（累加，a4 仍是唯一承接席）]
① ARTIFACTS 是否应**分层**：解析型腿（必须不过 lib）与白盒腿（本来就不过 lib）分开判——a6 的原话。
② ARTIFACTS 自述「过期产物不改变任何判据的绿」是否成立（本席判**不成立**，a6 判**成立但范围 6 项**）。
③ A1-8 与 A1-13 是否**同机制被算两次**，以及 A1-8 的夹具是否必须改成「经生产通道写入的行」（a6 建议：禁自产自审）。

[核心产出] a6 的三条纠正全部成立：本席行锚错（:44-66 → :69/:88）、影响面过宽（6 项非全部）、§23 阈值冲突降级为备注；并复核确认 embed.ts:72 的 30s 缺省超时机制成立，其延迟数字不采信、结论方向采纳为待办。
[下一步建议] ① 收敛稿的每条结论须标「取数时刻 + HEAD + 是否复跑」（a6 建议，本席采纳）；② 本席自纠两条须写进评审报告的过程记录——**主持人也会错，且错误要被看见**；③ 等 a3/a4 回报后进 wave 2。

### 第 2 轮

**captain → roadmap-diff** · 2026-09-25 07:20:47

【第 2 轮 · 重派单 · 只读】

说明：你（或同席位）第 1 轮运行**失败且未产出任何发言**，本轮按协议**重派一次**。上一次的失败原因无从查证，因此本轮把任务切成**有界小块**，并给三条硬约束：
① 任何命令必须加超时（例：`timeout 60 node tools/a0-check.mjs`），**超时即如实写「超时未取数」，不得死等或反复重试**；
② 结论先写已经拿到的，拿不到的标「未验证」；**宁可结论少，不要卡住不回报**；
③ 单席预算有限，**不要把整篇文档或整份 transcript 贴回来**，用例证行号说话。

边界不变（boundary_not_doing）：不改 packages/*/src、tools/*.mjs、docs/contract/*；不装依赖；不重排已定盘波次；不把 v10 设计意图当现状；不引入 OpenRouter 通道；不动 shoucang 与 DSH 运行时。本轮**只读**。

已完成的可复用基线（主持人实跑，2026-09-25 06:38，HEAD=b3fa4cb；**注意仓库非本会话独占写者，引用前须复跑**）：
· node tools/a0-check.mjs → 16 项 PASS 15 / FAIL 0 / 挂账 1 · npm run check:a1 → 15 项 PASS 12 / FAIL 0 / 挂账 2 / 无实现者 1 · npm test → 251/251
· 13 包 / 契约事件 8 个 / schema 实建 9 张表（含 1 虚表）/ v10 = 18 插件 · 78 事件 · 13 表
· 全仓 grep 命中 0：ITACL、maxSteps 组、intrinsic、spindle/ripple/renormal、fsrs、7 张 v10 专有表、openrouter/credentials

输出格式：结论须给 文件:行号 或命令输出；给不出即标「未验证」；找不到真问题写「未发现」；需拍板的用 [建议决策] 行；结尾给 [核心产出] 与 [下一步建议]。

你的工作项：
【b1 · 路线图对照席 · 只读】v10 §37（18 个 Agent 分工）/ §39（四层评估 + 10 个核心指标）/ §40（阶段 0–5，1–2 周到 4–6 周）。
**本项不跑命令**，只读这三份文件（这是为了避开上一轮卡住的原因）：
· /mnt/c/Users/lk/Downloads/deepseek_markdown_20260924_968609.md（v10，§37 在 2073 行起、§39 在 2164 行起、§40 在 2203 行起）
· /home/lk/Mana/docs/mana-rollout-plan.md（落地册：§0 速览 17-57 行、§3 分期 260-321 行、§4 各阶段 324-695 行）
· /home/lk/Mana/docs/session-allocation.md（W1-W3 波次）
必须产出：
① **阶段映射表**：v10 阶段 0–5 ↔ 落地册阶段 0–6 / 18 批次（B0.1…B7.2），逐行指出哪些是同一件事的不同说法。
② **本仓现状定位**：按落地册口径当前完成到哪一批（提示：阶段 0 的 A0-1…A0-14 与 R0 已机检通过；阶段 1 的 A1-1…A1-14 已建入口，A1-5 无实现者、A1-12 有一条腿未验证；W3 事件链已通）。
③ **v10 增量缺口**：v10 里落地册完全没覆盖的（提示：§39 四层评估体系、§37 的 18 Agent 分工表、§40 阶段 4 本仓被拆到 B5.1/B5.2 且标可并行）。逐条注明落地册是否已有等价批次。
④ **不可排期项**：v10 的「1–2 周 / 4–6 周」在本仓「批次」口径下不能直接换算的理由（本仓纪律：agent 口径不用周，批次 = 一次可独立验证的执行段）。
只做映射与缺口，**不重排已定盘波次**，不裁定 v10 与落地册谁对谁错（那是拍板项，用 [建议决策] 行列出）。

**captain → gate-blindspot** · 2026-09-25 07:20:47

【第 2 轮 · 重派单 · 只读】

说明：你（或同席位）第 1 轮运行**失败且未产出任何发言**，本轮按协议**重派一次**。上一次的失败原因无从查证，因此本轮把任务切成**有界小块**，并给三条硬约束：
① 任何命令必须加超时（例：`timeout 60 node tools/a0-check.mjs`），**超时即如实写「超时未取数」，不得死等或反复重试**；
② 结论先写已经拿到的，拿不到的标「未验证」；**宁可结论少，不要卡住不回报**；
③ 单席预算有限，**不要把整篇文档或整份 transcript 贴回来**，用例证行号说话。

边界不变（boundary_not_doing）：不改 packages/*/src、tools/*.mjs、docs/contract/*；不装依赖；不重排已定盘波次；不把 v10 设计意图当现状；不引入 OpenRouter 通道；不动 shoucang 与 DSH 运行时。本轮**只读**。

已完成的可复用基线（主持人实跑，2026-09-25 06:38，HEAD=b3fa4cb；**注意仓库非本会话独占写者，引用前须复跑**）：
· node tools/a0-check.mjs → 16 项 PASS 15 / FAIL 0 / 挂账 1 · npm run check:a1 → 15 项 PASS 12 / FAIL 0 / 挂账 2 / 无实现者 1 · npm test → 251/251
· 13 包 / 契约事件 8 个 / schema 实建 9 张表（含 1 虚表）/ v10 = 18 插件 · 78 事件 · 13 表
· 全仓 grep 命中 0：ITACL、maxSteps 组、intrinsic、spindle/ripple/renormal、fsrs、7 张 v10 专有表、openrouter/credentials

输出格式：结论须给 文件:行号 或命令输出；给不出即标「未验证」；找不到真问题写「未发现」；需拍板的用 [建议决策] 行；结尾给 [核心产出] 与 [下一步建议]。

你的工作项：
【b2 · 判据盲区审计席 · 只读 · 本会议最重要的一席】请回答以下 6 问，每问都要给 文件:行号 或命令输出。

**Q1（五类事件）**：docs/mana-rollout-plan.md:346 与 :451 要求 A1-1 机检「S1 五类 event_type（observation/attention/decision/recall/injection）各 ≥1」。
　实读 packages/core/tests/chain-e2e.test.mjs:97 的断言列表是 [observation, mana/working-memory, mana/scheduler/attention]。请判：① 集合差是多少；② A1-1 为何仍 PASS；③ 这是「判据被放宽」还是「文档与实现口径不一致」。
　（主持人已核：该文件自 commit acdcabe 建立以来只有这一版；全仓 mana_trace 写入点使用的 event_type 字面量只有三个：裸名 observation、mana/working-memory、mana/plugin/inactive。）

**Q2（夹具自证）**：packages/core/tests/jev-gate.test.mjs 用自写 insert() 直接塞 jev_log.gate 列（真夹具断言在 :69 G1 与 :88 G2，**不是 :44-66**），而生产写者 packages/jev/src/ollama.ts:262-266 的 INSERT 列清单不含 gate（grep -n gate packages/jev/src/*.ts = 0 命中）。
　请判：由 A1-8 PASS 能否推出「运行态可归因」？并确认 A1-8（jev_log.gate）与 A1-13（inject_log.gate，有真写者、6 条真跑 agent/pre-step 的用例）**不是同一机制被算两次**、也不是一张表有写者就掩盖另一张表的缺陷。

**Q3（ARTIFACTS 分层）**：tools/a1-check.mjs 的 ARTIFACTS 项自述「过期产物**不改变任何判据的绿**」。
　主持人判**该表述不成立**（过期 lib 会让按包名解析的装配态判据测到旧代码）；独立审查席判**成立但范围 6 项**（R0/A1-1/A1-13/A1-14/W2-5/ARTIFACTS，而 A0-5 走 src/index.ts、A0-8 直 import src/*.ts 不受影响）。请裁定并给出「解析型腿 / 白盒腿」的分层判法。

**Q4（挂账语义）**：a1-check 现为「挂账 2 项（ARTIFACTS、W-1..3）+ 无实现者 1 项（A1-5）」且**判据腿只查 FAIL ⇒ 门照常通过**。请判：这三项在什么条件下会被读成「已通过」，以及门是否需要把「挂账存续时长」纳入判据。

**Q5（取数时刻 vs 稳定态）**：主持人 06:38 跑出 npm test 251/251，但 packages/core/src/schema.ts 在 06:42 被改动（本会话非唯一写者）；独立审查席另报本机 Ollama 单次嵌入 20–28s，而 packages/vector/src/embed.ts:72 的本地缺省超时 = 30_000ms（余量 2–10s），并称 judge-chain 外 2 个 fail 由此而来。
　请判：A0-6「CI 绿（新仓自测）」的判据表述应否加「取数时刻 + 环境态」条件？若 Ollama 延迟回到 20–28s 导致测试红，是「回归」还是「环境」——这个分辨机制现在存在吗？

**Q6（同型普查）**：请再核 A1-2/A1-3/A1-6/A1-7/A1-9/A1-10/A1-11/A1-12/A1-14 的**判据原文（docs/mana-rollout-plan.md:449-474）vs 实现（tools/a1-check.mjs + packages/core/tests/*.mjs）**，列出还有多少条存在「判据原文要求的事实 ≠ 断言实际检查的事实」同型问题。A1-12 自认的「第二条腿未验证」是否属同型？

命令请一律加超时（例 `timeout 90 node tools/a1-check.mjs > /tmp/x 2>&1; echo exit=$?`），超时即写「超时未取数」。**找不到就写「未发现」，不许凑数。**

**captain → 汇聚网关** · 2026-09-25 07:25:01

[当前状态] 第 2 轮：b2（判据盲区审计席）**已回报且质量最高**；b1（路线图）仍在跑。第 1 轮失败的三席中，gate-blindspot 是本轮重派后唯一回报的 —— 重派有效。

[主持人独立复核 b2 · 承重论断逐条实读]
· **Q1 成立（且已用反证钉死）**：本席复核 `docs/mana-rollout-plan.md:346/:451` 要五类裸名；`packages/core/src/event-types.ts:34-42` 契约是**带前缀**五类；`packages/core/tests/chain-e2e.test.mjs:97` 断言的是三个名字（含 2 个非契约名）。
  机检取数方式实读确认为 `tools/a1-check.mjs:452` `runCases(W3_TESTS.chain, [C1 A1-1])` —— **按用例名取结果，不执行判据原文**。
  ⇒ 定性采纳 b2 的「**判据被放宽**」：可写而未写，且门按用例名放行。其反证（改名为契约五名后 C1 立红）是可复跑事实，非推断。
· **Q2 成立**：实读 `packages/attention/src/index.ts:199` 的 `finish(gate, extra)` 支持 `memoryId`，而**唯一调用点 `:331` 是 `finish(injected, { blockId })`** —— 未传 memoryId ⇒ `inject_log.memory_id` 恒 NULL。
  ⇒ A1-3 的原文要求「按 `memory_id` 分组」在当前生产侧**物理不可满足**，这条比 a2 报的 A1-8 更隐蔽（A1-8 至少列还在，A1-3 是**列在值不在**）。
· **Q2 补充成立**：实读 `packages/core/tests/injection-gate.test.mjs:243-252`，P6 的降级行确由**测试自己调用服务面直写**（注释原文自认「用服务面直写验证落点契约」），而**真造降级的 P13（:399）不在 A1-14 的批里**：
  `tools/a1-check.mjs:547` 只取 `[P5 A1-14, P6 A1-14]`。⇒ A1-14 与 A1-1/A1-3 **同型**（三条，与 b2 的 Q6 普查一致）。
· **Q4 补充成立**：实读 `tools/a1-check.mjs:650` —— `const injected = mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)`，**两个分支字面相同**，自证分支是死功能。
· **Q3 裁定**：采纳 b2 的「解析型腿 / 白盒腿」分层，**本席原判词与独立审查席判词都不完整**，接受其纠正：① 本席「该表述不成立」对解析型腿成立；② 审查席「6 项」方向对但混了白盒/半白盒。且 b2 指出判据名不是分层线、ARTIFACTS 现行 3 包过期（core/vector/user-model），落点 `tools/a1-check.mjs:583-599`。

[主持人 · Q5 基线漂移：已亲验，且比 b2 报告的更严重]
· b2 报「同一 HEAD 30 分钟内 A0 从 PASS 15/FAIL 0 变 PASS 14/FAIL 1（A0-6）」。本席**当场复跑** `timeout 200 node tools/a0-check.mjs`：
  **后台任务仍在运行**（已耗时 >2 分钟未返回），而本席 06:38 那次**几十秒内返回 exit 0**。
  ⇒ 同一命令、同一工作树、相隔约 40 分钟：**耗时从「秒级」变到「分钟级仍未返回」**。无论最终红绿，「A0 门通过」这个说法在当前工作树上**已不可作恒定引用**。
· 结论采纳并升级：本席 06:38 的基线（A0 15/0/1、A1 12/0/2、test 251）**宣布失效**，理由两条：① `packages/core/src/schema.ts` 06:42:52 在途改动；② 本会议进行期间该树上还有 `tools/a0-check.mjs` 的 65 行未提交改动与他人写入。
· **评审结论与任务清单的全部数字都将带「commit + 取数时刻 + 是否复跑」三元组**；凡未复跑者标「历史读数」。

[主持人 · 对 b2 [越界转派] 的处置]（协议要求：转派必须落地或折进汇总，不得丢弃）
· 转派①「A0-6 取数时刻/环境态口径 → 主持人」：**接收**，进用户决策卡。
· 转派②「机检器实现缺陷（:650 死分支 / :739-744 报错时序 / ARTIFACTS 表述）→ 执行席」：**接收**，进批次清单（工具维护批），因涉及 tools/ 写面，**本会议只写清单不动手**。
· 转派③「Ollama 冷启动 30s 与回归/环境分辨机制 → 执行席或环境席」：**接收**，进批次清单并单列。

[core] b2 的 Q1/Q2/Q6 三条同型缺陷（A1-1 五类事件 / A1-3 memory_id 恒 NULL / A1-14 自造降级行）经本席实读复核**全部成立**，按「会掩盖其他问题」置于评审结论顶端；A1-8 夹具自证、lib/src 漂移、基线漂移、a1-check 死分支四条第 1 轮结论亦成立。
[下一步建议] ① 三条同型缺陷必须给出「原文要求的事实 ↔ 断言实际检查的事实」对照表并进批次；② 建议决策「是否把原文↔断言对拍固化成机检腿」由本席收进决策卡；③ 等 b1 回报后进 b3 独立复评。

**roadmap-diff → 汇聚网关** · 2026-09-25 07:27:04

[当前状态] 只读勘察完成（未产生任何文件改动）。复跑值：npm test = 251/251 pass / fail 0；npm run check:a1 = 15 项 PASS 12 / FAIL 0 / 挂账 2 / 无实现者 1；node tools/a0-check.mjs = 16 项 PASS 14 / FAIL 0 / 挂账 1（A0-13）+ 一条 A1 入口腿。所有引文按 v10:行号 / 册:行号 / 分配:行号 / 状态档:行号 标注。

## 0. 一条必须先说的取证事实（影响主持人基线）
我 07:05–07:09 连跑两次 a0-check，**两次都报 1 FAIL，但红的是不同项**：07:05 红 A0-6（CI 绿）、07:09 红 A0-7（测试命令写法）。两次的红都是 npm test 子腿失败所致，而该瞬间 packages/core/tests/judge-chain.test.mjs 处于**他席在途编辑**（mtime 2026-09-25 07:00:24，git diff --stat = 63 insertions / 29 deletions，未提交）；我读到的主持人基线（06:38，PASS 15 / FAIL 0 / 挂账 1）落在该编辑窗口**之外**。07:25 用 node tools/a0-check.mjs --only A0-7 单跑 → PASS 1 / FAIL 0，且 npm test 复跑仍 251/251。⇒ 结论：**a0-check 的 A0-6/A0-7 两腿读共享工作树，他席在途编辑会把它们打成瞬态红**；「FAIL 0」在并发期不是可默认成立的值，须按 mtime 归属后再复跑（本仓既有纪律，非我新增）。

## 1. v10 §40 阶段 ↔ 落地册阶段/批次 映射表

| v10 §40（行号） | 落地册（册:行号） | 判定 |
|---|---|---|
| 阶段 0 契约与骨架（1–2 周）· v10:2205-2210 | 阶段 0 = B0.1/B0.2/B0.3（册:345-347）；判据 A0-1…A0-14 + R0（册:365-377） | **同一件事**。差异两处：① v10:2210「配 CI：typecheck + **vitest** + plugin-shape」vs 本仓 C3 = node:test（册:763），且册:371 A0-7 把 node --test <目录> 写法列为**负向判据**；② v10:2208「新增 dsh-mana-shoucang-adapter 骨架」本仓无（见 §3-8） |
| 阶段 1 核心闭环 MVP（4–5 周）· v10:2212-2218 | 阶段 1 = B1.0/B1.1/B1.2/B2.1/B2.2（册:422-426）；实际分批 = W1–W3（分配:34-38） | **同一件事**（B1.2↔JEV、B1.1↔Vector、B2.1↔最小闭环）。v10 多两项本仓无批次：v10:2214 Agent-LLM、v10:2216 Agent-ITACL |
| 阶段 2 巩固与遗忘（4–6 周）· v10:2220-2224 | 跨本仓**两个**阶段：阶段 2 = B3.1/B3.2（册:503-504）＋ 阶段 3 = B4.1/B4.2（册:546-547） | **同一批交付物、不同切法**。⚠ v10 删掉了「长时记忆」阶段名并把 ACT-R 并入「巩固与遗忘」（v10:2223）；册:538 阶段 3 目标行反而写明依赖方向（巩固/遗忘是 long-term 的维护者却成依赖者 ⇒ 依赖方向要正）。**阶段划分与依赖图不同构，不可 1:1 映射** |
| 阶段 3 再巩固与学习（4–6 周）· v10:2226-2229 | **无对应阶段、无对应批次**（再巩固/learning/Hebbian/FSRS 于 docs/mana-rollout-plan.md 命中 0；仅状态档:125/321 把再巩固列「未实现」、状态档:143 FSRS「未实现」） | **净增量**（见 §3-4） |
| 阶段 4 末那识核心特性（4–6 周）· v10:2231-2235 | B5.1（册:584）+ B5.2（册:585），且阶段 4 表标「∥ 整段可提到阶段 1 后」 | **metacognition/user-model 是同一件事**；v10:2234「认知环 MCL」/ v10:2235「双画像维护」落地册**零覆盖**（MCL 在 rollout 命中 0，仅 G9「册:79/175」提到 shoucang 侧 MCL 慢通道作**回归观察点**） |
| 阶段 5 UI 与评估（4–6 周）· v10:2237-2241 | 落地册**拆成两阶段**：阶段 5 UI = B6.1/B6.2（册:618-619）；阶段 6 评估 = B7.1/B7.2（册:663-664） | 同一件事、本仓更细。差异：消融组不同（见 §3-7）；v10:2240「四层评估体系」对应册:663「L1–L4 评估」+ 册:136 的 §13 覆盖映射 |

**并行/串行口径**：v10 §37.1（v10:2098-2105）「第 1 步契约 1–2 周 → 第 2 步 JEV+LLM+Vector 2–3 周 → 第 3 步**所有认知 Agent 并行** 4–6 周」—— 与本仓 W 波次（分配:34-38）不同构：本仓的并行点数由**写面**决定（W1 五路 → W3 必须独占），且分配:9-27 已实测推翻「一人一包」（同变更横跨 5–6 包）。

## 2. 本仓现状定位（落地册口径，含位置证据）
- **阶段 0：已完成**。证据 = node tools/a0-check.mjs 16 项：PASS 14 / FAIL 0 / 挂账 1（A0-13「G1–G15 全数归属 15/15，产物 14 / 挂账 1」）+ A1 入口腿 PASS。契约快照三腿：哈希逐字相等 53c92707…、清单 35 件、HEAD 腿 ee9e22e ⊑ b3fa4cb。
- **已达批次**：B0.1/B0.2/B0.3、B1.0、B1.1、B2.2、B5.1、B6.1（与分配:34-38 的 W1 清单一致）；W2-1…W2-5、W3-1、W3-2 为在途/刚收口（分配:282-293）。
- **阶段 1 未收口项**：① A1-5 = 「无实现者」（依赖链 B4.2 前置于 B3.1，a1-check 输出原文「仓内**无实现者**」）；② A1-12 有一腿未验证 —— 我实测**暖机通过、冷启失败**：冷启第 1 次 POST /v1/embeddings {model:bge-m3} 30s 超时，随后 POST /api/embed 冷启 12.98s 回 HTTP 200、再跑 a1-check = PASS 12 / FAIL 0。即「本机 Ollama 必须可达」这一**测量条件**在首次加载时不被满足 ⇒ **该红是环境测量条件，不是判据本身错**（归属判据面，已转派）。③ 全 13 包（状态档:168-180）与主持人基线一致；npm test 251/251。
- **当前关键路径节点**：册 §3.1.1 口径 A 的 8 批次链为 B0.1→B0.2→B1.1→B2.1→B3.1→B3.2→B7.1→B7.2（册:285）。**B3.1 是链上唯一尚未开工的节点**，且阶段 2/3 全部批次都在它之后。

## 3. v10 增量缺口（逐条 + 落地册有无等价批次）
1. **§37 的 18 Agent 分工表**（v10:2079-2096）—— 落地册**无等价批次**，但**不必补**：本仓已给出可执行替代并已实测，分配:9-27 明文「为什么不能照 §10.1 的 13 个 Agent 一人一包」（① 器件数≠席位数：单变更横跨 5–6 包；② 逻辑依赖≠物理可并行：7 席同时改不存在的目录）。⇒ 判定「本仓已否决的形态」，非缺口。
2. **LLM 生成通道（dsh-mana-llm）**（v10:2214）—— 落地册 B1.0–B2.2 **无此批次**（B1.2 只做 JEV 判断面）；本仓无该包（状态档:168-180 的 13 包清单），状态档:235/414 明写「无 dsh-mana-llm 包、无适配器注册、无调用点」。⇒ **真缺口**（影响 v10 阶段 2/3 所有「LLM 生成」类动作：深度睡眠归纳、压缩摘要、原则提炼、意图识别 —— 状态档:115/136/142/143/121 逐条标未实现）。
3. **ITACL（§19–§21 + §40 阶段 1）**（v10:2216；设计 v10:806-953）—— 全仓 grep ITACL/maxSteps/maxRetrievals/noProgressThreshold = 0（主持人已实测，我复核 grep -c 于三份档 = 0）。落地册**无批次、无判据、无表**。⇒ **净增量，且是体量最大的一块**（状态机 + 5 参数 + 复杂度三档阈值表）。
4. **再巩固链条 + 学习链条（§40 阶段 3）**（v10:2227-2229）—— 落地册无阶段无批次；仅 B4.1（册:546）覆盖「chunking 触发条件」一条

…（已截断，原长 7577 字符）

**captain → risk-reviewer** · 2026-09-25 07:28:00

【b3 · 独立复评 · 只读】第 2 轮工作项：对 b1（路线图对照）与 b2（判据盲区审计）的新产出给出 **成立 / 不成立 / 证据不足** 三态判定，并给反证。

**你第 1 轮已审过**：主持人 #8/#10、v10-diff、jev-v10 三席，三态判定 成立 5 · 证据不足 2 · 不成立 1。本轮**只需审增量**，不重复上一轮。

**待审清单（逐条给三态判定）**：

**(甲) b2 的三条同型缺陷**（主持人已逐条实读复核，你要独立判「主持人复核是否够格」）：
· A1-1：原文 `docs/mana-rollout-plan.md:346/:451` 要五类裸名 event_type 各 ≥1；断言 `packages/core/tests/chain-e2e.test.mjs:97` 是 3 个名字（2 个非契约名）；机检 `tools/a1-check.mjs:452` 按**用例名**取结果。
· A1-3：原文 `:453` 要按 `memory_id` 分组；`packages/attention/src/index.ts:199` 的 `finish(gate, extra)` 支持 memoryId，但**唯一调用点 `:331` 只传 blockId** ⇒ `inject_log.memory_id` 恒 NULL。
· A1-14：原文 `:474` 要「造一次 JEV 不可用」；测试 `packages/core/tests/injection-gate.test.mjs:243-252` **自己直写**降级行（注释自认「服务面直写」），而 `tools/a1-check.mjs:547` 只取 `[P5, P6]`，真造降级的 P13（`:399`）不在批里。

**(乙) b2 的 Q3 裁定**：正确分层是「解析型腿（按包名→lib，会绿错）/ 白盒腿（直 import src，不受影响）」，**主持人判词与你的第 1 轮判词都不完整**（你说 6 项，b2 说那 6 项里混了白盒/半白盒）。请判：b2 的裁定是否成立？你原来的「6 项」是否应撤回或收窄？

**(丙) b2 的 Q4**：`tools/a1-check.mjs:711` 的 `gateOk` 只看 FAIL ⇒ 挂账/NONE 不置位；b2 举出 4 条会被读成「通过」的读法（摘要行/判据腿/退出码/经 a0-check 转述）。主持人给的 06:38 基线正是第 (d) 种形态。请判成立与否，并回答：挂账是否必须带「首现时刻 + 原定阶段」并可升级为 FAIL。

**(丁) 新增铁证（主持人 07:27 实测，你务必纳入判断）**：本席杀查 `ps` 发现**同一工作树上有三方并发跑同一判据器**：
　`timeout 900 node tools/a0-check.mjs`（他人，已跑 3:45）· `timeout 200 node tools/a0-check.mjs`（本席，2:57）· `timeout 400 node tools/a0-check.mjs --record-baseline`（他人，刚起）。
　⇒ 请据此判：① 「A0 全绿/全红」在本仓当前状态下**是否根本不可作恒定引用**；② `--record-baseline` 并发执行会不会**互相覆盖基线文件**（A0-10 判据语义是「与本批开工前实测值相等」）；③ b2 的 Q5「回归 vs 环境分辨机制不存在」是否应升级为「**并发写者污染测量**」这一更上级的根因。
　参考：`packages/core/tests/judge-chain.test.mjs` mtime 07:00:24、`packages/core/src/schema.ts` mtime 06:42:52、`tools/a0-check.mjs` mtime 05:26（且 `git status` 显示它带 65 行未提交改动）。

**(戊) b1 的结论**（路线图席）：v10 §40 六阶段 ↔ 落地册 18 批次映射；本仓已达 B0.1–B0.3/B1.0/B1.1/B2.2/B5.1/B6.1，**B3.1 是关键路径上唯一未开工节点**；v10 真增量 5 块（LLM 通道 / ITACL 全套 / 再巩固+学习链条 / MCL+双画像 / §39 指标与消融）；v10 周数不得换算批次。请判其映射表与「真增量 5 块」是否成立，有无漏项或误判（尤其：§39 四层评估是否该算增量、§37 十八 Agent 分工被 v10-diff 与路线图席判为「非增量」是否成立）。

[当前状态] 第 1 轮失败的三席已在第 2 轮重派：gate-blindspot 与 roadmap-diff **均已回报**，planning 席待你之后。
[核心产出] 对本轮增量逐条三态判定 + 反证；不得重复上一轮已审内容；给不出证据的判「证据不足」。
[下一步建议] 结尾给 [核心产出] 与 [下一步建议]；拍板项用 [建议决策] 行。

**risk-reviewer → 汇聚网关** · 2026-09-25 07:37:10

[当前状态] 独立审查席第 2 轮完成，只审增量（b1 路线图席 #16；b2 判据盲区席的正文至今未进记录，主持人条目 #15 是其转述）。本轮全程只读、零文件改动。先报一条改变全场的实测：本轮取证期间工作树被第三方继续改写、且基线文件已被重取（见 (丁)②）。

═══ 第 0 条 · 取数口径现状（先报，它决定下面每条判定的效力）═══
· HEAD 已前进：b3fa4cb → 76fcce7（提交信息「fix(mana): judge-chain 判据改零网络（此前污染并行真调用判据，致 A0-7 假红）」）。会议派单与全部基线锚在旧 HEAD，已过期。
· tools/a1-check.mjs mtime 07:32:36，git 状态已从「M tools/a0-check.mjs」变为「M tools/a0-check.mjs + M tools/a1-check.mjs」⇒ 机检器正在被追加内容（我读到 :550-577 新增第 16 项 P5-UI、EXPECTED_IDS 扩到 16）。
· 我 07:33 实跑 node tools/a1-check.mjs（输出 /tmp/a1c.log）：共 16 项 / PASS 13 / FAIL 0 / 挂账 2 / 无实现者 1，门通过。⇒ 06:38 基线的「15 项 / PASS 12」与 07:2x 我读到的「15 项」均已作废；且 a0-check 的 A1 腿做交叉核对（tools/a0-check.mjs:486-490 读 a1-check 自报的 declared/measured），该腿读数随之改变。

═══ (甲) b2 三条同型缺陷 + 主持人复核是否够格 ═══
【甲1 · A1-1 · 成立，但轮不到 b2 指出】我实读三处：docs/mana-rollout-plan.md:451 =「五类 event_type 各 ≥1 且 seq 连续无洞」；:346 = 五类裸名（observation/attention/decision/recall/injection）；packages/core/tests/chain-e2e.test.mjs:97 = for (const expected of ['observation','mana/working-memory','mana/scheduler/attention'])；tools/a1-check.mjs:457 = runCases(W3_TESTS.chain, ['C1 A1-1'])（按用例名取结果）。
⇒ 这与我在第 1 轮独立查到的同一处结论一致（A1-1 的判据原文要求与断言对象不同源），故判定成立、但不计为 b2 的新发现。主持人「判据被放宽 ⇒ 可写而未写」的定性成立。
新增反证（比 b2 更硬）：契约五类中 mana/decision(event-types.ts:38) 与 mana/injection(:42) 在全仓 src 假零生产者 —— grep 只命中 event-types.ts 的声明行，无一处 ctx.emit；mana/recall 只有 packages/vector/src/index.ts:168 一处。⇒ 把 :97 改成契约五名后不是「C1 立红」，而是结构上不可能变绿：要变绿必须先补两个真实生产者。这把该缺陷从「判据放宽」升级为「判据原文要求的可观测面在契约里有名无实」。

【甲2 · A1-3 · 成立，且我给出比 b2 更完整的生产侧清单】packages/attention/src/index.ts:199 的 finish(gate, extra) 确声明 memoryId?: string | null；我 grep 全部 7 个 finish 调用点：:246 / :253 / :260 / :265 / :302 / :308 / :331 —— memoryId 只出现在 :199 的形参与 :207 的传值处，7 个调用点无一传入（:331 是 finish('injected', { blockId })）。⇒ inject_log.memory_id 恒 NULL，A1-3 的「按 memory_id 分组」在生产侧物理不可满足。
⚠ 措辞更正：主持人/b2 的「唯一调用点 :331」不准 —— :331 是唯一传 extra 的点，但共有 7 个调用点，其余 6 个连 extra 都不传。结论方向对，措辞须改，否则下游会以为「只有注入成功那条路没传」。

【甲3 · A1-14 · 成立，但主持人行锚有一处错，须更正】tools/a1-check.mjs:547 = runCases(W3_TESTS.gate, ['P5 A1-14','P6 A1-14']) —— 与 b2 判定成立。真造降级的 P13 在 packages/core/tests/injection-gate.test.mjs:399（boot({ judgeProbability: null }) + perceive + firePreStep），确不在该批里。
⚠ 但 b2 的双证有一条不成立：P13 并非唯一从零线做起的降级用例 —— tools/a1-check.mjs:472 的 A1-13 批里就有 'P13 判定链降级'。⇒ 事实是「A1-13 批跑了 P13，A1-14 批没跑」。这不动摇结论（A1-14 那两条仍不合格），但改变处置写法：不是要新写用例，而是把 :547 的批改指向已存在的 P13。
⚠ 另一更正在第 1 轮已提、此处重申：A1-8 的夹具断言不在 :44-66（该区间是 insert() 辅助函数体），真正在 :69（G1）与 :88 起（G2）。
⇒ Q6 的「三条同型」应拆开：A1-8 是「有列无写者」、A1-3 是「有列有通道但值恒 NULL」、A1-14 是「有真用例但批选错」—— 机制不同，并排会让「先修哪条」不可判。

【甲4 · 主持人复核是否够格 · 基本够格，三条保留】够格处：逐条实读、自纠行锚、撤回过度概括 —— 本会议唯一做到自纠的一席，方法论合格。保留：① A1-1 在主持人 #15 的「三条」里实际缺席（只见于派单），收敛稿须补回并单列；② 行锚 :44-66 与「唯一调用点 :331」须改；③ 主持人把三条一律置于顶端，但 A1-14 的机制是批选错误（工具面），比 A1-1/A1-3 的「断言语义与判据原文不同源」低一档，混排会掩盖真正该先修的那条。

═══ (乙) Q3 分层裁定 —— b2 成立；我第 1 轮的「6 项」撤回，替换为分型表 ═══
我实读判据的取数通道：
· 解析型腿（按包名 → main → lib，会吃旧实现）：W2-5（a1-check.mjs:390 import.meta.resolve(pkg)）、R0（r0-assembly-check.mjs:217 ctx.loader.create({name})）。→ 2 项。
· 黑盒装配腿（Loader 按包名装，但 payload 由测试自造、判的是事件/行而非公式）：A1-1（chain-e2e:58 Loader）、A1-2 / A1-6（injection-gate:103 Loader）、A1-13、A1-14、P5-UI。→ 6 项：吃 lib，但吃过期 lib 与吃新 lib 结论可能相同 ⇒ 属「须重建后复跑才能排除」，不能一律喊红。
· 白盒腿（直 import src，几何不受影响）：A1-4（vecModule('rrf.ts') → import(join(SRC,'rrf.ts'))，a1-check.mjs:53/172，SRC = packages/vector/src）、A1-11、A1-12（cosine.ts）；A0-5（a0-check.mjs:171 读 src/index.ts）、A0-8（probes/a08-schema.mjs 直 import src）。→ 5 项，可正式排除。
· ARTIFACTS 本身自相矛盾：它自述「过期产物不改变任何判据的绿」，而它的存在理由正是「按包名解析的判据会吃到旧实现」（a1-check.mjs:604）—— 自述与理由互斥，是全场最该单列的一条。
⇒ 裁定：主持人原判词「该表述不成立」对解析型腿成立；我的「6 项」撤回，替换为上表 2/6/5 三档。

═══ (丙) Q4 · 成立（不可辩驳），且入口腿同样只看 FAIL ═══
· tools/a1-check.mjs:711 const gateOk = itemSetOk && n.FAIL === 0 && !harnessFail —— 确无 HANG/NONE 项；:718 的 ✓ 行只加括号注「挂账≠通过」，不置位 gateOk；退出码 :747 也只看 FAIL / 项集 / harness ⇒ 挂账对退出码零影响。
· 我补一条 b2 没提的：tools/a0-check.mjs:483 的 A1 腿判据是对文本做正则（/✓ 判据腿：无 FAIL/ 与 /✓ 项集腿：期望 == 实测/），同样不读 HANG。⇒ 经 a0 转述的 A1 项即使挂账再多仍报 PASS，且计入 A0 的「通过」数。这就是 06:38 基线「A0 16 项 PASS 15」的构成方式 —— 主持人第 (d) 种读法成立。
· 回答「挂账是否必须带首现时刻 + 原定阶段且可

…（已截断，原长 8766 字符）

**captain → 汇聚网关** · 2026-09-25 07:37:38

[当前状态] b3（独立复评席）已回报并**逐条复核成立**，且抓到一条改变全场的事实。本席 07:35 逐条实读复验，全部坐实。

[**边界已被触碰 · 必须点名**（boundary_not_doing 第①条：不改 docs/contract/*）]
· `git status` = **`M docs/contract/_freeze.head`**（入库契约文件，1 insertion / 1 deletion）。现值 `76fcce75ff3784c1cdbe51f983a75b86699b0dda`。
· 成因（b3 报、本席复验）：`node tools/a0-check.mjs --record-baseline` **无锁覆写**契约快照；本席 07:27 的 `ps` 正拍到**三方并发**（`timeout 900` 他人 / `timeout 200` 本席 / `timeout 400 --record-baseline` 他人）。
· **归因声明**：**非任何专家席所为，亦非本席所为** —— 本会议全程只读。破坏方是**同仓的并发写者**。
· 这正好是本项目 notDoing 清单挡不住的形态（与落地册 G9 同型：**破坏方是新代码/新进程，不是被保护对象本身**）。
· 附证：`tools/a0-check.mjs:300` 的 A0-10 比的是**另一个仓** `/home/lk/dsh-src/dsh-plugin-roundtable` ⇒ **Mana 本仓的「不碰既有件」其实无人看守**。

[主持人复验 b3 的承重断言 · 全部成立]
· **HEAD 已移动**：`76fcce7`（`fix(mana): judge-chain 判据改零网络（此前污染并行真调用判据，致 A0-7 假红）`）。⇒ 本席 06:38 基线**正式作废**，且 b1 报的「07:05 红 A0-6 / 07:09 红 A0-7」已被他席**以提交形式修掉**——这是「瞬态红」而非「本席回归」的**事后确证**。
· **A1-14 的修法被纠正**：本席与 b2 都以为要新写用例；b3 实读 `tools/a1-check.mjs:472` 证明 **`P13 判定链降级` 已在 A1-13 的批里被调用** ⇒ 修法是「把 `:547` 的批指向**已存在**的 P13」，**一行改动**，非新写判据。本席采纳。
· **A1-3 措辞纠正**：不是「唯一调用点 :331」，而是 **7 个 `finish(` 调用点（:246/:253/:260/:265/:302/:308/:331）无一传 memoryId**。b3 的措辞更准，采纳。
· **A1-1 的反证被加强**：`mana/decision`（`event-types.ts:38`）与 `mana/injection`（:42）**全仓零生产者**（只命中声明行，无 `ctx.emit`）⇒ 把 `chain-e2e.test.mjs:97` 改成契约五名后不是「立红」而是**结构上不可能变绿**。这比「判据被放宽」更严重：**缺的是生产侧写入点，不是断言写法**。
· **Q3「6 项」撤回**：b3 撤回自己第 1 轮的判词，替换为 **解析型 2（W2-5/R0）/ 黑盒装配 6（A1-1,A1-2,A1-6,A1-13,A1-14,P5-UI）/ 白盒 5 可排除（A1-4,A1-11,A1-12,A0-5,A0-8）**。本席采纳该分层。
· **a1-check 已被他席改写**：`EXPECTED_IDS` 现为 **16 项**（新增 `P5-UI`，`:651`）；`tools/a1-check.mjs` mtime 07:32。⇒ 门项数与判据集**在会议进行中变了**，任何「15 项/16 项」的引用都须带时刻。

[主持人 · 对 b3 两条 [建议决策] 的处置]
· **A1-1 处置**（A 补两个真实生产者 / B 改判据原文 / C 维持现状）：本席倾向 **A**（因为缺的是生产侧写入点，改原文等于把缺陷写进契约），但**涉及契约与判据原文，属 R3 越权面 ⇒ 进用户决策卡**。
· **`_freeze.head` 被覆写**（A 单列并先修并发 / B 回滚 / C 不管）：本席倾向 **A**（先修并发再谈回滚，否则回滚后会被下一次 `--record-baseline` 再覆盖），**同样进决策卡**。

[核心产出] 边界触碰已点名并归因（并发写者，非本席非专家席）；b3 的 6 项成立结论与 3 项收窄（含其自撤「6 项」）经实读全部采纳；HEAD=76fcce7、a1-check 项数 15→16 两项「会议进行中已变」的事实入档。
[下一步建议] ① 评审报告必须含「会议期间工作树漂移」专章；② 决策卡至少 4 项（v10 参照口径 / A1-1 处置 / _freeze.head 处置 / 挂账是否加时限）；③ 进 b4 规划席合成批次清单。

**captain → planner** · 2026-09-25 07:51:40

【b4 · 任务规划合成席 · 只读 · 本会议最后一波】**本轮用户追加了一项明确要求：他要在任务清单之外，拿到「多 agent 开发的任务分配」**（谁写哪个面、哪些能并行、哪些必须串行、怎么防止互相踩）。

[已成立、可直接采信的结论（前六席产出，不再重复论证；你只做合成）]

**A. v10 评审结论（六席 + 主持人实读复核）**
· v10 数字：18 插件 / 78 事件 / 13 表；本仓：13 包 / 8 事件 / 9 表（含 1 虚表）。交集：插件 13、事件 3（observation, jev/judge, jev/judged）、表 6。
· v10 三类：**协议面可采**（§6.1 三原语 / §22 职责边界 / §24.3 请求体形状）、**接入面全零落点**（§23 39 行只有 Injection Gate 1 行真落地）、**已订正冲突复发**（OpenRouter 端点 :240/:1033、ctx.credentials :1036、「50 问≈1 问」:231/:1017；logprobs 那条经复核**不是** v10 项，主持人已撤回）。
· v10 真增量 5 块：① `dsh-mana-llm` 通道（无包无批次）② ITACL 全套（§19–21，全仓 0 命中）③ 再巩固+学习链条（Hebbian/FSRS/白名单）④ MCL+双画像 ⑤ §39 指标与消融（其中 4 个是涌现项、非独立块；§39.3「去掉批量调用」在本仓**无开关可关**）。
· **非增量**：§37 十八 Agent 分工表（本仓已实测否决该形态）、§37.2 依赖规则（落地册 C13 更强）。
· v10 周数**不得换算批次**（本仓口径不估时；落地册自认各阶段时长实测依据不存在）。
· v10 机制移植判定：0 移植 / 3 改造后用（睡眠振荡取 Spindle+Ripple 并入 B4.1；修剪并入 B4.2 归档候选视图；内在奖励落守藏离线核验）/ 4 不移植（MCL 守藏现役已在跑；ITACL 阶段行为有守藏七步循环等价物且宿主 `agent/pre-step` 返回类型只有 reject/enter（`dsh-agent/lib/types/runtime-types.d.ts:304-310`），无「信息充足度」通道 ⇒ 0.7/0.6 阈值无处落；FSRS 与冻结的 A1-5 `decay(14)=0.500000` 冲突；§8 神经科学无表/字段落点）。

**B. 本仓实锤缺陷（六条，全部带 文件:行号，主持人已逐条实读复验）**
　排序口径 = 先「会掩盖其他问题 / 让失败不可观测」，再按严重度：
· **D1 · A1-1 五类事件从未被验，且两个事件族零生产者**：原文 `docs/mana-rollout-plan.md:346/:451` 要五类裸名各 ≥1；断言 `packages/core/tests/chain-e2e.test.mjs:97` 是 3 个名字（2 个非契约名）；`mana/decision`（`packages/core/src/event-types.ts:38`）与 `mana/injection`（:42）**全仓零 `ctx.emit`**（只有声明）⇒ 改成契约五名后**结构上不可能变绿**。机检 `tools/a1-check.mjs:452` 按**用例名**取结果，从不执行原文。
· **D2 · A1-3 / I2 不变式结构性不可验**：`inject_log.memory_id` 恒 NULL —— `packages/attention/src/index.ts` 的 **7 个 `finish(` 调用点（:246/:253/:260/:265/:302/:308/:331）无一传 `memoryId`**（:199 的 `finish(gate, extra)` 支持它）。即「每条记忆每 session 最多注入一次」这条硬不变式**没有可数之处**。
· **D3 · A1-14 用自造降级行代替真降级**：`packages/core/tests/injection-gate.test.mjs:243-252` 由测试**自己直写** `writeInjectLog({gate:degraded_unavailable})`（注释自认「服务面直写」），而 `tools/a1-check.mjs:547` 只取 `[P5, P6]`；**真造降级的 P13（`:399`）已被 A1-13 的批调用（`a1-check.mjs:472`）** ⇒ **修法是把 `:547` 的批指向已存在的 P13，一行改动**。
· **D4 · A1-8 夹具自证**：`packages/core/tests/jev-gate.test.mjs` 自写 `insert()` 直塞 `jev_log.gate`（真夹具在 `:69` G1 与 `:88` G2）；生产写者 `packages/jev/src/ollama.ts:261-266` 的 INSERT 列清单**不含 gate**（`grep -n gate packages/jev/src/*.ts` = 0）⇒ PASS 推不出运行态可归因。与 A1-13 不是同一机制（另一张表、另一套夹具）。
· **D5 · 装配态（lib）与真源（src）漂移**：包入口 `packages/core/package.json` main/exports → `./lib/index.js`；三层分层 = **解析型腿（按包名→lib，会绿错；受影响 W2-5/R0）· 黑盒装配 6（A1-1,A1-2,A1-6,A1-13,A1-14,P5-UI）· 白盒 5 可排除（A1-4,A1-11,A1-12,A0-5,A0-8）**。ARTIFACTS 项自述「过期产物不改变任何判据的绿」**不成立**，且它现在是**挂账（HANG）**，门只查 FAIL ⇒ 过期可长期存在不报警。
· **D6 · 判据读数取自共享可变工作树，工作树无独占期**（**这是根因，其余五条都在它之下**）：会议期间实测 —— 同一 HEAD 30 分钟内 A0 从 PASS 15/FAIL 0 翻成 PASS 14/FAIL 1；`ps` 拍到**三方并发**跑同一检查器；`docs/contract/_freeze.head` 被 `--record-baseline` **无锁覆写**（`M docs/contract/_freeze.head`，值 `ee9e22e → 76fcce7`）；**HEAD 在会议中从 `b3fa4cb` 移到 `76fcce7`**；`tools/a1-check.mjs` 的 `EXPECTED_IDS` 从 15 项变 **16 项**（新增 `P5-UI`）。
　附证：`tools/a0-check.mjs:300` 的 A0-10 比的是**另一个仓** `/home/lk/dsh-src/dsh-plugin-roundtable` ⇒ Mana 本仓的「不碰既有件」无人看守。
　次生：`tools/a1-check.mjs:650` 的 `mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)` **两分支字面相同**（变异自证腿是死功能）；`:739-744` 报错晚于全绿输出。

**C. 边界与纪律**
· 本次会议全程只读；`_freeze.head` 被覆写**非任何专家席、非主持人**所为，是并发写者。
· 落地册口径：7 阶段 / 18 批次；**B3.1 是关键路径上唯一未开工节点**；已完成 B0.1–B0.3 / B1.0 / B1.1 / B2.2 / B5.1 / B6.1。

[你要产出的两样东西]

**产出 ①：批次任务清单**（每条写全 6 项，粒度对齐落地册批次口径，不估时；凡依赖未定阈值/未拍板项/未验证项的**显式标挂账**并写明挂到哪一步）：
　任务目标 / 承接能力（**能力要求，不是人名**）/ 依赖 / **可机检判据（命令或断言）** / **回归面（碰坏什么、怎么确认没碰坏）** / 与 v10 的对应章节。
　要求：D1–D6 每条都要落到至少一个批次；把「会掩盖其他问题」的三条（D1/D2/D3）排在清单最前。
　**注意 A1-1 的处置有三种口径（补真实生产者 / 改判据原文 / 维持现状）尚未拍板** ⇒ 该批次必须标挂账，不得当成可开工任务。

**产出 ②：多 agent 任务分配（用户本轮明确追加）** —— 请以「**写面隔离**」为第一原则给出：
　① **写面清单**：按落地册 `docs/session-allocation.md` 的 I-1…I-N 独占项口径，列出每个批次的**写面**（具体到 文件 / 目录 / 共享件），并标出**共享写面**（多人会撞的那些，例：`packages/core/src/event-types.ts`、`packages/core/src/schema.ts`、`tools/a0-check.mjs`、`tools/a1-check.mjs`、`docs/contract/*`）。
　② **波次与并行度**：哪些批次**写面不相交可并行**、哪些**必须串行**（给出串行理由：同文件、依赖产物、判据

…（已截断，原长 4494 字符）

**planner → captain** · 2026-09-25 07:56:16

[当前状态] 接单（b4 · 任务规划合成席 · 只读）。已收六席结论，**不重复论证**，只做合成 + 落成可机检批次。本席本轮只写 `/tmp/*`，**仓内零写入**（`git status` 里的 `?? .a0-rerun.txt` / `?? .checks-run.log` 不是我建的）。

【取数坐标（必读·本清单所有读数绑定于此）】HEAD `98ae46c` · `tools/a1-check.mjs` md5 `fe194036` · `packages/core/tests/judge-chain.test.mjs` `58aef6e6` · `packages/attention/src/index.ts` `020b6e41` · env `NODE_USE_ENV_PROXY=1`（`http_proxy=127.0.0.1:10808`）· 取数窗口 07:0x–07:4x。
**本席实测的 D6 活证**：同一工作树上 A1 项数 **15 → 16**（`EXPECTED_IDS` 增 `P5-UI`）；HEAD `b3fa4cb → 76fcce7 → 98ae46c`；`M docs/contract/_freeze.head`（`ee9e22e… → 76fcce7…`）；`tools/a1-check.mjs` mtime 07:32（会中被改写）。⇒ **本清单是快照，不是常驻真值**；每次执行前必须重取三元组。

---

## 产出 ① 批次清单（11 批；F-01…F-03 按「会掩盖其他问题」置顶；不新开阶段，全部映射进既有 W 波次）

每条含 6 项：目标 / 承接能力 / 依赖 / 可机检判据 / 回归面 / v10 对应。

### F-01（D1）A1-1 判据口径裁决 —— **挂账·不可开工**
- **目标**：裁决「原文要五类裸名 ≥1」vs「断言是三个非契约名」的口径差，落成唯一一条。
- **证据（我复验）**：原文 `docs/mana-rollout-plan.md:451`；断言 `packages/core/tests/chain-e2e.test.mjs:97-99` = `['observation','mana/working-memory','mana/scheduler/attention']`（2 个宿主机名，非契约名）；`tools/a1-check.mjs:457` 按**用例名** `C1 A1-1` 取结果；`ctx.emit('mana/decision'|'mana/injection')` 全仓命中 **0**（声明在 `packages/core/src/event-types.ts:38/:42`）。
- **承接能力**：契约面（事件声明合并 / waterfall 语义）+ 判据面（读 `node --test` 输出）。
- **依赖**：**用户裁决**（A/B/C 未拍板，见 [建议决策] 1）+ F-05a 取数纪律先生效。
- **可机检判据**：口径 A ⇒ `grep -c "ctx.emit('mana/decision'" packages/*/src/*.ts` ≥1 **且** `mana/injection` ≥1（现值 0/0）；A1-1 取数改为按 `mana_trace.event_type ∈ 五类裸名`；**负向**：撤掉一个 `emit` ⇒ 该判据必须红。口径 B ⇒ `docs/mana-rollout-plan.md:451` 与 `:97` 逐字一致，**且**必须同时补负向锚（删一个 `emit` 须红）。口径 C（维持现状）**不作为选项**。
- **回归面**：`docs/mana-rollout-plan.md`、`tools/a1-check.mjs`、`packages/core/tests/chain-e2e.test.mjs`（三者皆共享写面）；口径 A 还要写 `packages/{perception,attention,working-memory,scheduler}/src/**`（**W3 独占面**）。确认未碰坏：`npm test` 计数不降 + `node tools/r0-assembly-check.mjs` 6/6 + `node tools/a0-check.mjs` 无 FAIL。
- **v10**：§34 事件契约（78 事件）/ §23 接入点 39 行 / §12 编码链条写路径。

### F-02（D2）I2 不变式补可数处
- **目标**：让「每条记忆每 session ≤1 次」（A1-3/I2）有可数之处。
- **证据（我复验）**：`packages/attention/src/index.ts:199` 的 `finish(gate, extra)` 已支持 `memoryId`，7 个调用点（:246/:253/:260/:265/:302/:308/:331）**无一传它**（我逐点复验了 reset / skip_no_candidate / 门控关闭 三处形态）⇒ `inject_log.memory_id` 恒 NULL。
- **承接能力**：集成面（attention ↔ core 落痕链）。
- **依赖**：F-05a；与 F-03 同碰 `injection-gate.test.mjs` ⇒ **串行**。
- **可机检判据**：`node --test packages/core/tests/injection-gate.test.mjs` 后对临时库断言 `count(gate='injected' AND memory_id IS NULL) == 0` 且 `count(memory_id IS NOT NULL) ≥ 1`；**负向**：去掉 `{memoryId}` ⇒ 前者 >0。
- **回归面**：`packages/attention/**`（S5 所有权）+ `inject_log` 写入列 + A1-2/A1-3/A1-13 三判据。确认：`npm run check:a1` 无 FAIL、A1-13 五类枚举仍齐、项集腿仍等。
- **v10**：§34 `mana/injection` / §14.5 三道门控 / §36（`inject_log` 是本仓独有表，v10 §36 无此表）。

### F-03（D3 + 次生）A1-14 取真降级用例 + A1-8 夹具改造 + 变异腿复活
- **目标**：消灭两处夹具自证。
- **证据（我复验）**：`tools/a1-check.mjs:571` 取 `['P5 A1-14','P6 A1-14']`；P6 在 `packages/core/tests/injection-gate.test.mjs:243-252` 由测试**自写** `degraded_unavailable`；真降级 P13 已存在（`:399`）且已被 A1-13 批取（`tools/a1-check.mjs:472`）。A1-8 夹具 `packages/core/tests/jev-gate.test.mjs:44 insert()` 直塞 `gate`（用例 :78/:83/:94/:117），而生产写者 `packages/jev/src/ollama.ts:262-265` 的 INSERT 列清单**不含 gate**（`grep -c gate packages/jev/src/*.ts` = **0**）。
- **承接能力**：判据面 + 写负向用例。
- **依赖**：**本清单唯一今天即可开工的批次**；改 `tools/a1-check.mjs` ⇒ 与该文件其他改者串行。
- **可机检判据**：① `:571` 的批含 `P13`；② 删 P6 直写块后该文件仍绿（证明降级来自生产路径）；③ `grep -n gate packages/jev/src/ollama.ts` ≥1 且新用例断言 gate 由 driver 写；④ 变异自证腿能报红——⚠ 前席记的 `tools/a1-check.mjs:650` 在我读到的窗口是 `EXPECTED_IDS` 行 ⇒ **该行号未复验**，执行席须先定位真行（会中该文件被改写，行号已位移）。
- **回归面**：`tools/a1-check.mjs`、`packages/core/tests/{injection-gate,jev-gate}.test.mjs`、可能 `packages/jev/src/ollama.ts`。确认：项集腿仍等、`npm test` 计数不降、`PRAGMA table_info(jev_log)` 逐列不变。
- **v10**：§38.2 降级链路 / §13.2 巩固任务的失败策略。

### F-04（D5）判据取真源：消灭 lib/src 双向漂移
- **目标**：让「按包名解析到 lib」的判据面不再冒充真源绿。
- **证据（我实测）**：`packages/core/package.json:8` main→`./lib/index.js`；`packages/core/src/schema.ts` 06:42:52 **新于** `packages/core/lib/index.js` 04:41:14；`p

…（已截断，原长 12895 字符）

### 第 3 轮

**captain → risk-reviewer** · 2026-09-25 07:57:44

【c1 · 终审席 · 只读 · 本会议最后一单】审 b4 规划席的产出（11 批次 F-01…F-11 + 多 agent 写面分配），**只审增量**。

[b4 的关键产出（你需要审的要点）]
· **11 批次**：F-01 A1-1 判据口径裁决（挂账）· F-02 I2 补可数处 · F-03 A1-14 取真降级 + A1-8 夹具改造 + 变异腿复活 · F-04 消灭 lib/src 双向漂移 · F-05a 纪律 / F-05b 加锁 · F-06 取数三元组进报告 · F-07 A1-12 网络两腿 · F-08 A1-5 转真判据（挂 B3.1）· F-09 A0-10 改判本仓 + 在途收口 · F-10 v10 增量落点裁定（挂账）· F-11 §39 可判性（挂 B7）。
· **写面热点**：`tools/a1-check.mjs` 被 **6 批**触碰（F-01/03/04/05/06/07）＝本轮唯一真瓶颈；`tools/a0-check.mjs` 3 批；`docs/mana-rollout-plan.md` 4 批。
· **波次**：W0′ 串行单席（F-05a + F-09 + 拍板后 F-05b）→ W1′ **并行上限 2**（A 路 F-02 / B 路 F-03）→ W2′ 串行单席（F-04→F-07→F-06）→ W3′ 文档面（F-10→F-11）→ W4′ F-08 等 B3.1。
· **F-02 ∥ F-03 的冲突处置原文**：「同一 `injection-gate.test.mjs` 冲突 ⇒ 该文件 owner 给 A 路，B 路只允许改 `tools/a1-check.mjs:571` 一行且不得动该测试文件；做不到就串行。」
· **并发纪律 6 条**：判据器带锁（第二实例非零退出并打印持有者、禁静默排队）· `--record-baseline` 唯一基线席且前置工作树干净 · 取数三元组（commit/checker-md5/env/时刻）· git 单写者 + 禁 `git add -A` · 禁并发 build 同一 workspace · 改 checker 须在提交信息写明期望项数变化。
· **b4 的新证据**：A1-12/A0-6 的红是**代理延迟**而非 Ollama 不可达（`NODE_USE_ENV_PROXY=1` node fetch 20.1s，`=0` 时 117ms）。

[你要做的三件事]

**① 判「写面隔离」是否真的成立**（用户本轮最关心的是多 agent 任务分配）：
　· F-02 与 F-03 都碰 `packages/core/tests/injection-gate.test.mjs`。b4 的处置（该文件 owner 给 A 路，B 路只改 `tools/a1-check.mjs:571` 一行）**在物理上是否可执行**？B 路改的那一行会不会要求同时改测试文件？
　· F-01 若走口径 A，要写 `packages/{perception,attention,working-memory,scheduler}/src/**`，而 `docs/session-allocation.md:64` 把这三个包划给 **S5 的 W3 集成面**；F-02 也要写 `packages/attention/**`。这两批与「W3 独占面」是否冲突？b4 是否处理了？
　· b4 说并行上限 2、瓶颈是 `tools/a1-check.mjs`。**是否存在某两批写面完全不相交因而可提到并行上限 3**（例：F-08 只写 `packages/long-term/**`、F-11 只写文档）？若存在而 b4 没提，属漏项。

**② 判 11 批次里有没有「拆东墙补西墙」**（用户红线）：每条改动的 `回归面` 是**具体到可确认**还是套话？特别核 F-04（要 build，会把他人在途码编进产物 —— b4 自己写了禁令，判是否足够）与 F-09（要动 `docs/contract/**` ＝全员只读面）。

**③ 判挂账是否成立**：F-01/F-10/F-11 标挂账，F-05b/F-07 依赖拍板。**有没有批次被悄悄当成「可开工」而其实依赖未拍板项**？

[输出] 每条给三态判定（成立 / 不成立 / 证据不足）+ 反证；找不到就写「未发现」。结尾给 [核心产出] 与 [下一步建议]；拍板项用 [建议决策] 行。**只读，不改任何文件。**

**captain → 汇聚网关** · 2026-09-25 07:57:54

[当前状态] 第 3 轮（终审轮）已开：b4 规划席**已交付 11 批次 + 多 agent 写面分配**，c1 终审已派出。本席在此期间复核了 b4 的承重论断，**一处成立、一处不成立、两处行锚纠正**。

[主持人复核 b4 · 三态判定]
· **成立**：`packages/core/package.json:8` 确为 `"main": "./lib/index.js"`（lib/src 漂移的入口证据）。
· **成立**：`tools/a1-check.mjs:571` 确为 `runCases(W3_TESTS.gate, [P5 A1-14, P6 A1-14])` —— 只取 P5/P6，真降级的 P13 不在批里。
· **成立**：`tools/a0-check.mjs:300` `SAMPLE = /home/lk/dsh-src/dsh-plugin-roundtable`，且 `:312-313` 用它取 `git rev-parse` 与 `status --porcelain` ⇒ **A0-10 确实比的是另一个仓，Mana 本仓的「不碰既有件」无人看守**。这条是本席第 2 轮报的，b4 独立复现。
· **不成立（b4 的代理论断，本席实测推翻）**：b4 报「`NODE_USE_ENV_PROXY=1` → node fetch 20.1s；`=0` → 117ms」。本席实测**两次都是 110ms**（且都成功取到 7473 字节）：
　`NODE_USE_ENV_PROXY=1 elapsed=110ms` / `NODE_USE_ENV_PROXY=0 elapsed=110ms`。
　⇒ **当前时刻代理不是延迟主因**。但这**不是**说 b4 错了 —— 它的读数取自 07:2x 的窗口，而本席此刻（08:0x）复现不出。这正是 D6 的形态：**环境读数不可跨时刻复用**。
　处置：F-07 的**结论方向保留**（A1-12/A0-6 的红必须能分辨「本地服务不可达」与「代理/延迟」），但「20.1s vs 117ms」这组数字**标为浮动读数、不进结论**；F-07 的判据①`env -u NODE_USE_ENV_PROXY npm test = 251/251` 须改为「**两态都留档 + 报错文本必须点名延迟来源**」。
· **行锚纠正**：b4 报 A0-10 的 `SAMPLE` 在「:312-313 被消费」—— 实读 `SAMPLE` 定义在 `:300`、消费在 `:312-313`（b4 未给定义处）；另 b4 报 `tools/a1-check.mjs:650` 是 `EXPECTED_IDS` 行 —— 实读该文件现 **`EXPECTED_IDS` 在 `:651`**（b4 自己也说「该行号未复验，执行席须先定位真行」）。→ 两处均在会中因他席改写而位移，**不是 b4 的错，是 D6 的又一活证**。

[当前坐标（本会议最后一次取数，须写入交付物）]
· HEAD = **`98ae46c`**（`docs(handoff): S0 出口交接单加 ACT-15 批次（P1–P6 + vec0 三语义）`）
· `tools/a1-check.mjs` 的 `EXPECTED_IDS` = **16 项**（含 `P5-UI`），落 `:651`
· `git status` 仍有 ` M docs/contract/_freeze.head` · ` M tools/a0-check.mjs`
· 本席已清理自己产生的两个临时文件（`.checks-run.log` / `.a0-rerun.txt`），当前未跟踪项只剩 `.roundtable/**` 与 `docs/*.Zone.Identifier`、`docs/mana-project-status-plan.md`（非本席所建）。

[核心产出] b4 三条行锚/事实成立（package.json main、:571 批选、A0-10 比外仓）；其代理论断**本席复现不出**，已按浮动读数处置（结论方向保留、数字剔除、判据改为两态留档）。
[下一步建议] ① c1 终审回报后即可收口；② 交付物须含「会议期间工作树漂移」专章（HEAD 三次移动 / 项数 15→16 / `_freeze.head` 被覆写）；③ 决策卡 ≥6 条待用户拍板。

**risk-reviewer → 汇聚网关** · 2026-09-25 08:01:02

[当前状态] 终审席 c1 完成，只审增量（b4 规划席 #21）。全程只读、零文件改动。已复验 b4 引用的绝大多数行锚，**其中一条我拿到了比 b4 报告更严重的事实**（见 ② -2）。

═══ ① 写面隔离：三问逐条 ═══

【① -1 · F-02/F-03 的 B 路只改 :571 一行 · 判定：不成立（物理上不可执行）】
tools/a1-check.mjs 现 md5=fe194036 / 777 行（与 b4 取数坐标一致）。A1-14 块实读：
  :571  const r = runCases(W3_TESTS.gate, ['P5 A1-14', 'P6 A1-14'])
  :572  if (r.failed.length === 0 && r.passed.length === 2)
  :573  pass(..., 无候选/降级两条路径...)
  :575  fail(..., 本项用例未全绿（passed=${r.passed.length}/2）)
⇒ 把批从 2 项改到含 P13 的 3 项，**必须同时改 :572 的计数比较与 :573/:575 两处文案**，否则第二项「预期 3 实得 3 而判据写 2」会直接判红。**一行改不动**。
更关键：**b4 自己的 F-03 判据②就自相矛盾** —— 判据②原文「删 P6 直写块后该文件仍绿」，而 P6 直写块在 packages/core/tests/injection-gate.test.mjs:243-262（我实读确认：:250-253 是自写 writeInjectLog）。⇒ **B 路要想满足 F-03 的判据②，就必须改那个测试文件**，与「不得动该测试文件」直接冲突。
⇒ b4 的冲突处置**两条路都不通**。可行解只有两个：(i) 把 injection-gate.test.mjs 整文件 owner 给 B 路（F-02 改判据为只读观测，或与 B 串行）；(ii) 保留两路并行但**把 F-03 判据②从 W1' 摘出去**，留到串行窗口。

【① -2 · F-01/F-02 与 W3 独占面 · 判定：b4 标注了，但不完整，且用了一份已过期的所有权表】
b4 **确实标了**（F-01 回归面明写「口径 A 还要写 packages/{perception,attention,working-memory,scheduler}/src/**（W3 独占面）」；F-02 写「packages/attention/**（S5 所有权）」）—— 这一点不能算漏。
**但漏了两层**：
· 第一层：F-02 的判据①要跑并观察 packages/core/tests/injection-gate.test.mjs，而契约表 docs/session-allocation.md:58 写的是「packages/core/** | **S0** | **W1 起只读**」。⇒ 撞的不止 W3 独占面，还有 **S0 的冻结面**。b4 只标了 S5，没标 S0。
· 第二层（更要紧）：**那份所有权表本身已过期，而 b4 把它当现行法**。实测：docs/handoff/ 下 S0/S1/S2/S3/S4/S5 的出口交接单**全部存在**（S5.md mtime 09-25 04:56，S0.md 07:51）；W3 的活早已落盘（提交 acdcabe → b3fa4cb）；HEAD 从 b3fa4cb 又前进四次到 98ae46c。而 allocation:64 写的是「S5（**B2.1 期**）」—— B2.1 已经做完了。⇒ 拿一份「B2.1 期」的表去判「谁能写 attention」，判的是**历史快照**，不是当前占用。
⇒ 判定：b4 的标注**方向对、依据过期**。要把「独占面当前是否仍被持有」写成前置检查（读 docs/handoff/ 的完成声明与最近提交），而不是引 allocation 的一行。

【① -3 · 能否提到并行上限 3 · 判定：有真漏项，但 b4 的 2 在它自己的约束下是对的】
先给反证（b4 的理由不成立）：b4 说上限 2 是因为 tools/a1-check.mjs 被 6 批争用 —— 这是**把由自己的挂账决定的上限说成了由写面决定的上限**。若 F-10 拍板放行（只写 docs/mana-rollout-plan.md）、F-02 在跑（packages/attention + core/tests），写面**完全不相交**，上限立刻是 3。
再看有没有可直接开的三条：F-08 只写 packages/long-term/**（该目录在 allocation:60-64 的所有权表里**根本没被列** ⇒ 无主），但 b4 把 F-08 标「挂 B3.1」而 B3.1 未开工（册:286 关键路径唯一未开工节点）⇒ **不可开**；F-10/F-11 挂账 ⇒ **不可开**；F-04/F-06/F-07 全与 F-03 争 a1-check ⇒ **不可并行**。
⇒ **结论：b4 报 2 是正确数字，但理由错**（是挂账造成的，不是写面造成的），且它**没有把谁不可开、为什么写成可核的表**，所以读者会以为树的性质就是 2。这是一条**会掩盖排期空间**的表述缺陷：拍板 F-10 后上限即变 3，而 b4 的文案会让人不去看。

【① -4 · 新发现：F-03 的写面声明不完整】b4 对 F-03 写面写「**可能** packages/jev/src/ollama.ts」。但它的判据③是「grep -n gate packages/jev/src/ollama.ts ≥1 且新用例断言 gate 由 driver 写」—— **这是要真的改该文件**，而 packages/jev/** 在 allocation:61 是 **S2 独占**。⇒ F-03 实际有**两个**跨席写面（S2 的 jev + core/tests），b4 只承认了后一个。

═══ ② 拆东墙补西墙：逐条回归面审查 ═══

【② -1 · F-04 · 判定：禁令方向正确、但覆盖不足，缺一道前置机检】
b4 给了三条同向禁令（F-04 内文「禁在他人未提交改动期跑 workspace 级 build」+ 纪律5「禁并发 build 同一 workspace」+ allocation:70「冻结期不 build 全局产物」）—— **够不够？不够，因为它在 F-04 里只是一句禁，没有门**。
实测反证（此刻即可推翻「没人正在改」的假设）：packages/core/lib/schema.js mtime 04:41 vs packages/core/src/schema.ts 06:42:52；lib 侧 grep user_model_history = **0**，src 侧 = **5 处命中**；packages/core/src/index.ts mtime **07:41:50**、packages/ui/src/panel.ts **07:35:22**、store.ts **07:36:38**、packages/jev/src/index.ts **07:40:54** —— 这些都不是本会议六席的产物（六席全程只读）。⇒ **F-04 一执行，就会把这些在途 src 编进产物**。
⇒ 判定：**不构成拆东墙（目标正确）**，但**回归面是套话不是判据**。要可确认，必须写成两道机检：开工前 git status --porcelain 为空 **且** 与本清单取数坐标的 HEAD/md5 逐项相等；收工后同一条命令复跑并比对差集。现在这两道都不存在。

【② -2 · F-09 · 判定：目标正确，但判据③会制造一个假通过 —— 这是本轮最严重的一条】
先报我拿到的事实，它比 b4 报告的更严重。b4 报「_freeze.head 被覆写（ee9e22e → 76fcce7）」。我按 mtime 追踪到的完整序列是：
  07:29:5x  cat = ee9e22e7c07eb6be20c24c7b81807a3dfc54c65d（读自 docs/contract/_freeze.head）
  07:30:31  _freeze.{head,files.txt,sha256} 与 tools/.a0-10-baseline.json 四处 mtime 同时更新；head 内容 = 76fcce75ff3784c1cdbe51f983a75b86699b0dda；git status 显示 **M docs/contract/_freeze.head**
  07:3x-07:5x  **又被回滚回 ee9e22e7c07eb6be20c24c7b81807a3dfc54c65d**
  现在：cat _freeze.head = ee9e22e…；git status **不再出现** docs/contract/_freeze.head；git log -3 -- docs/contract/_freeze.head 仍停在 8d6b051
⇒ **契约面在无提交、无 CHANGELOG 记录、无任何席位介入的情况下被写→回滚走完一个完整循环，而结果与初始态逐字相同。** 这比 b4 描述的「被覆写」严重一档：**连「发生过」这件事本身都消失了**

…（已截断，原长 7835 字符）

**captain → 汇聚网关** · 2026-09-25 08:01:39

[当前状态] 第 3 轮终审已回报，**抓到本会议最严重的一条**。本席 08:01 逐条复验，全部坐实。

[主持人复验 c1 · 三态判定]
· **成立（本会议最严重）**：F-09 判据③会**制造假通过**。本席实测证据链：
　`docs/contract/_freeze.head` 现值 = `ee9e22e7c07eb6be20c24c7b81807a3dfc54c65d`（= 初始值），`git status docs/contract/` **为空**，三个快照文件**均与 HEAD 版一致**。
　但 mtime 露馅：`_freeze.sha256` 与 `_freeze.files.txt` 均为 **07:30:31**，而 `_freeze.head` 为 **07:53:27** —— 比另两个**晚 23 分钟**。
　⇒ 完整序列：07:30:31 `--record-baseline` 写入（head=当时的 HEAD=76fcce7）→ 07:53:27 被**回滚**回 `ee9e22e`。**净结果与初始态逐字相同、无提交、无 CHANGELOG 记录**。
　而 A0-12 的 HEAD 腿判据是「快照锚点仍是祖先（`ee9e22e ⊑ 现 HEAD`）」⇒ 回滚后**照样通过**。执行席按原判据只会看到「已经是 ee9e22e」并**通过一个什么都没做的动作**。
　这条与 D6 同源但更狠：**D6 是"改动可见但归属不明"，这条是"改动走完整循环后不可见"**。
· **成立**：b4 的「B 路只改 `tools/a1-check.mjs:571` 一行」物理不可执行 —— 本席实读 `:571` 取 `[P5 A1-14, P6 A1-14]`，改成 3 项必须同步改计数比较与文案行；且 b4 自己的 F-03 判据②要求改 `injection-gate.test.mjs`，与「不得动该测试文件」**直接冲突**。
· **成立**：b4 引的是**过期所有权表** —— `docs/session-allocation.md:64` 把三个包标为「S5（B2.1 期）」，而 B2.1 **早已完成**（`docs/handoff/S5.md` 存在），且漏了 `:58` 的 S0 冻结面（`packages/core/**`）。
· **成立**：并行上限 2 的**理由错了**（真实上限来自挂账项 F-08/F-10/F-11，不是写面）；拍板 F-10 后即可到 3。数字对、理由错会让人看不到那层空间。
· **成立**：F-04 缺**开工门** —— 本席实测 `packages/core/src/index.ts` 07:41:50、`packages/jev/src/index.ts` 07:40:54、`packages/ui/src/panel.ts` 07:35:22 均有在途 mtime（此刻 `git status packages/` 又已为空 = 他席已提交）。F-04 一跑就会把他人在途码编进产物。
· **成立**：F-03 写面漏了 `packages/jev/src/ollama.ts`（**S2 独占**），b4 只写「可能」。

[核心产出] c1 的 5 条不成立/漏项全部经实读复验成立，其中「F-09 判据③假通过」为本会议最高优先级发现（一个留痕为零的完整改动循环）。六席 + 三轮的评审已收敛。
[下一步建议] 交付物按 c1 建议重写：F-09 判据③（记录变更历史 + 负向对拍）· F-02∥F-03 二选一 · F-04 加开工门 · F-07 拆 a/b 腿 · F-03 补 S2 写面 · 并行上限改「理由 + 解锁条件」。

**captain → 汇聚网关** · 2026-09-25 08:02:26

[当前状态] 会议收敛，交付物已落盘：`docs/mana-v10-review-and-allocation.md`（10,689 B）。7 席 · 3 轮，全部结算（无 error/refusal/无产出）。

[交付物内容]
· 一、v10 评审结论（三类判定 + 规模对照 + 真增量 5 块 + 机制 0/3/4 判定）
· 二、本仓实锤缺陷 **D1–D7**（含终审席新发现的 D7：F-09 判据③假通过 —— 一个留痕为零的完整改动循环）
· 三、任务清单 **11 批次**（含终审修正：F-03 补 S2 写面、F-07 拆 a/b 腿、F-09 判据③重写）
· 四、**多 agent 任务分配**（写面热点表 / 波次 / 并行上限≈2 及其修正理由与解锁条件 / 六条并发纪律 / 每席验收三件套 / 边界六条逐席翻译）
· 五、待拍板 **7 条**（含倾向与理由）
· 六、会议过程记录（**含主持人自纠 4 条**）

[边界自检（boundary_not_doing 六条逐条）]
① 不改 packages/*/src、tools/*.mjs、docs/contract/* —— ✅ 全程只读；**唯一写入是本席的交付物 docs/mana-v10-review-and-allocation.md**（新增评审文档，非既有文件的改动）
② 不装任何依赖 —— ✅ 未装（`node_modules` 未变）
③ 不重排已定盘波次 —— ✅ F-* 全部映射进既有 W 波次；F-08→B3.1、F-11→B7
④ 不把 v10 设计意图当现状 —— ✅ F-10 只写「不移植 + 理由锚点」
⑤ 不引入 OpenRouter 通道 / options 内 logprobs —— ✅ 交付物中该两条均为「冲突复发」记录，非采纳
⑥ 不动 shoucang 既有件与 DSH 运行时 —— ✅ 未动

[必须点名的边界触碰（非本席、非专家席所为）]
· `docs/contract/_freeze.head` 被同仓并发写者走过一个**完整改动循环**（写 → 回滚），净结果与初始态逐字相同、无提交、无 CHANGELOG；而 A0-12 的 HEAD 腿判据「快照锚点仍是祖先」**照样通过** ⇒ 该动作**不可观测**（D7）。
· 会议期间 HEAD 由 `b3fa4cb` 移到 `98ae46c`（3 次），判据项数 15→16。
· 本席已清理自己产生的 2 个临时文件。

[核心产出] 交付物 1 份（评审结论 + 11 批次任务 + 多 agent 写面分配 + 7 条拍板项 + 过程记录）；缺陷 D1–D7 全部带 文件:行号 与实读复核；六条并发纪律与边界六条逐席禁令可直接下发。
[下一步建议] 会议可关闭。剩余动作全在用户侧：7 条拍板 → 拍板后按 W0′→W4′ 派席。

---

## 用户调整记录（0）

> 只包含尚未被主持人清空的记录；已执行并清空的调整不会出现在导出里。

（无）
