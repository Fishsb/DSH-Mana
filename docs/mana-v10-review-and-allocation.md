# Mana v10 方案评审 + 后续任务分配方案

> **评审对象**：`C:\Users\lk\Downloads\deepseek_markdown_20260924_968609.md`（《Mana（末那识）：完整记忆插件方案 v10.0 最终整合版》，2346 行）
> **评审方式**：圆桌会议 `mana-v10-review-2026-09-25`（7 席 · 3 轮 · 逐条实读复核）；会议记录 `.roundtable/mana-v10-review-2026-09-25/export.md`（138 KB）
> **取数坐标（本文件所有数字绑定于此，非恒定真值）**：HEAD `98ae46c` · `tools/a1-check.mjs` 项数 **16** · 取数窗口 2026-09-25 06:38–08:01
> **⚠ 本仓非独占工作树**：会议进行中 HEAD 移动 3 次（`b3fa4cb → 76fcce7 → 98ae46c`）、判据项数 15→16、`docs/contract/_freeze.head` 被第三方走过一个完整改动循环。**引用本文任何读数前须先复跑。**

---

## 一、v10 评审结论：三类判定

| 判定 | 内容 | 依据 |
|---|---|---|
| **协议面可采** | §6.1 三原语（noul/choice/score）、§22 职责边界、§24.3 请求体形状 | 与 `packages/jev` 实测一致 |
| **接入面零落点** | §23 接入点速查表 **39 行只有 Injection Gate 1 行真落地**；§25 的 Prompt 模板 23/23 不存在；§26 阈值校准五步无落点 | 全仓 `grep worth_keeping\|supersedes\|decay_priority\|rel_\|tool_choice\|urgency` 命中仅 schema 列名 |
| **已订正冲突复发** | ① OpenRouter 首选端点（v10:240/1033）② `ctx.credentials.get('openrouter')`（v10:1036）③「50 问≈1 问」（v10:231/1017） | 本仓缺省 `ollama`、真通道 `nano-gpt`（`systemone.ts:55`）；全仓 `credentials` 命中 0；本仓实测 50 问单次 1046–1228ms vs 50 并发 7599ms |

> ⚠ **主持人自纠记录**：曾把「options 内 logprobs」列为 v10 冲突复发 —— 实测 v10 全文 `grep -c logprobs` = **0**，那是前代文档（`docs/deepseek_markdown_20260924_c7ffea.md`）的坑。**该条已撤回，不写进结论**。

### 1.1 规模对照（实测）

| 维度 | v10 | 本仓 HEAD | 交集 |
|---|---|---|---|
| 插件 | 18 | **13** | 13（v10 独有 5：llm / reconsolidation / learning / itacl / shoucang-adapter） |
| 事件 | 78 | **8** | 3（observation、jev/judge、jev/judged） |
| 表 | 13 | **9**（含 1 虚表） | 6 |

同表异列（最易被表名对照掩盖）：`jev_log` 本仓多 `gate` 列（`schema.ts:150`）；`memory_items` 少 v10 的 12 列、多 `session_id`/`turn_id`。

### 1.2 v10 真增量（5 块）与非增量

**增量**：① `dsh-mana-llm` 生成通道（无包无批次）② ITACL 全套（§19–21，全仓 0 命中）③ 再巩固 + 学习链条（Hebbian / FSRS / 白名单）④ MCL + 双画像 ⑤ §39 指标与消融（其中 4 个是涌现项非独立块；§39.3「去掉批量调用」在本仓**无开关可关**）

**非增量**：§37 十八 Agent 分工表（本仓已实测否决该形态，见 `docs/session-allocation.md:18-25`）、§37.2 依赖规则（落地册 C13 更强）

**机制移植判定**：**0 移植 / 3 改造后用 / 4 不移植**

| 不移植 | 理由 |
|---|---|
| MCL（§18.3） | 守藏现役 `mcl.js:372` 已在跑；本仓只缺消费点 |
| ITACL（§19–21） | 宿主 `agent/pre-step` 返回类型只有 reject/enter（`dsh-agent/lib/types/runtime-types.d.ts:304-310`），**无「信息充足度」通道** ⇒ 0.7/0.6 阈值无处落 |
| FSRS（§17.1） | 与已冻结的 A1-5 `decay(14)=0.500000` 冲突；落地册 C14 正要求收敛公式 |
| §8 神经科学 | 无表/字段落点，不可判据化 |

**改造后用**：睡眠振荡取 Spindle+Ripple 两层并入 B4.1 · 修剪并入 B4.2 归档候选视图 · 内在奖励落守藏离线核验

**v10 周数不得换算批次**（本仓 agent 口径不估时；落地册自认各阶段时长实测依据不存在）。

---

## 二、本仓实锤缺陷（六条 + 终审新增一条）

> 排序口径：先「会掩盖其他问题 / 让失败不可观测」，再按严重度。

### D1 · A1-1 五类事件从未被验，且两个事件族零生产者
- 判据原文 `docs/mana-rollout-plan.md:346/:451` 要求五类裸名 event_type 各 ≥1
- 断言 `packages/core/tests/chain-e2e.test.mjs:97` 实为 `['observation','mana/working-memory','mana/scheduler/attention']` —— **2 个名字不在契约 8 个事件名内**
- `mana/decision`（`event-types.ts:38`）与 `mana/injection`（:42）**全仓零 `ctx.emit`** ⇒ 改成契约五名后**结构上不可能变绿**
- 机检 `tools/a1-check.mjs` 按**用例名**取结果，**从不执行判据原文**
- **定性：判据被放宽**（缺的是生产侧写入点，不是断言写法）

### D2 · A1-3 / I2 不变式结构性不可验
- `packages/attention/src/index.ts:199` 的 `finish(gate, extra)` 支持 `memoryId`
- **7 个调用点（:246/:253/:260/:265/:302/:308/:331）无一传它** ⇒ `inject_log.memory_id` **恒 NULL**
- 「每条记忆每 session 最多注入一次」这条硬不变式**没有可数之处**

### D3 · A1-14 用自造降级行代替真降级
- `tools/a1-check.mjs:571` 只取 `[P5, P6]`；P6 在 `injection-gate.test.mjs:243-252` 由测试**自己直写** `writeInjectLog({gate:'degraded_unavailable'})`（注释自认「服务面直写」）
- **真造降级的 P13（`:399`）已被 A1-13 的批调用（`a1-check.mjs:472`）** ⇒ 修法是把 `:571` 指向已存在的 P13

### D4 · A1-8 夹具自证
- `packages/core/tests/jev-gate.test.mjs:44` 自写 `insert()` 直塞 `jev_log.gate`
- 生产写者 `packages/jev/src/ollama.ts:262-265` 的 INSERT 列清单**不含 gate**（`grep -n gate packages/jev/src/*.ts` = **0**）
- ⇒ 由 A1-8 PASS **推不出运行态可归因**；与 A1-13 不是同一机制（另一张表、另一套夹具），但报告层面互相掩盖

### D5 · 装配态（lib）与真源（src）双向漂移
- `packages/core/package.json:8` main → `./lib/index.js`
- **分层**：解析型腿（按包名→lib，会绿错：W2-5 / R0）· 黑盒装配 6（A1-1/A1-2/A1-6/A1-13/A1-14/P5-UI）· 白盒 5 可排除（A1-4/A1-11/A1-12/A0-5/A0-8）
- ARTIFACTS 项自述「过期产物不改变任何判据的绿」**不成立**；且它是**挂账（HANG）**，门只查 FAIL ⇒ 过期可长期存在不报警

### D6 · 判据读数取自共享可变工作树，工作树无独占期（根因）
会议期间实测：HEAD 移动 3 次 · 判据项数 15→16 · `ps` 拍到三方并发跑同一检查器 · `tools/a0-check.mjs:300` 的 A0-10 比的是**另一个仓**（Mana 本仓「不碰既有件」无人看守）· `a1-check` 变异自证腿有**两分支字面相同的死分支**（行号会中位移）

### D7 · F-09 判据③会制造假通过（终审席发现，本会议最严重）
- 追踪到的不是「被覆写」，而是**写 → 回滚走完一个完整循环**：
  - `_freeze.head` 现值 = `ee9e22e…`（= 初始值），`git status docs/contract/` **为空**，三件套**均与 HEAD 版一致**
  - 但 mtime 露馅：`_freeze.sha256` / `_freeze.files.txt` 均为 **07:30:31**，`_freeze.head` 为 **07:53:27**（晚 23 分钟）
- A0-12 的 HEAD 腿判据是「快照锚点仍是祖先」⇒ **回滚后照样通过**
- 执行席按原判据只会看到「已经是 ee9e22e」并**通过一个什么都没做的动作**
- **D6 是"改动可见但归属不明"，这条是"改动走完整循环后不可见"**

---

## 三、任务清单（11 批次，含终审修正）

> 粒度＝落地册批次口径（一次可独立验证的执行段），**不估时**。每条含：目标 / 承接能力 / 依赖 / 可机检判据 / 回归面 / v10 对应。

| # | 目标 | 承接能力 | 依赖 | 可机检判据（要点） | 回归面 | v10 |
|---|---|---|---|---|---|---|
| **F-01** | A1-1 判据口径裁决 | 契约面 + 判据面 | **用户拍板**（三口径） | 口径 A ⇒ `grep -c "ctx.emit('mana/decision'" packages/*/src/*.ts` ≥1 **且** `mana/injection` ≥1（现 0/0）；负向：撤一个 emit 必红 | 判据原文 + 断言 + 〔口径 A〕4 个包 src（**W3 集成面**） | §34 / §23 |
| **F-02** | I2 补可数处 | 集成面（attention↔core） | F-05a；**与 F-03 二选一** | `count(gate='injected' AND memory_id IS NULL)==0` 且 `count(memory_id IS NOT NULL)≥1`；负向：去掉 `{memoryId}` ⇒ 前者 >0 | `attention/src/index.ts` + inject_log 写入列 + A1-2/A1-3/A1-13 | §34 / §14.5 |
| **F-03** | A1-14 取真降级 + A1-8 夹具改造 + 变异腿复活 | 判据面 + 负向用例 | **今天即可开工** | ① `:571` 批含 P13 ② 删 P6 直写块后该文件仍绿 ③ `grep -n gate packages/jev/src/ollama.ts` ≥1 | `tools/a1-check.mjs` + 两个测试文件 + **`packages/jev/src/ollama.ts`（S2 独占，须写进写面）** | §38.2 |
| **F-04** | 消灭 lib/src 双向漂移 | 构建链 + 判据面 | F-05a；**须加两道开工门** | `--require-fresh-artifacts` 由 HANG→PASS；断言「每包 lib mtime ≥ 其 src 最新 mtime」；负向：touch 任一 src 必红 | `packages/*/lib/**` + checker + package.json | §33 |
| **F-05a** | 并发纪律（零代码·立即） | 工具链 + 并发面 | 无 | 见 §四 六条 | 全局取数面 | — |
| **F-05b** | 判据器加锁 | 工具链 | **拍板锁粒度** | 并发起两个实例，第二个**非零退出并打印持有者**，禁静默排队；锁被占时 `--record-baseline` exit ≠0 | `tools/*-check.mjs` | — |
| **F-06** | 取数三元组进报告 | 工具链 | F-05a | `--json` 每项 detail 含 commit-short 且可 `JSON.parse`（须分离 stdout/stderr） | 同 F-05b | §39.1 |
| **F-07a** | A1-12 网络腿两态留档（**纯测量，无需拍板**） | 环境面 | 无 | `env -u NODE_USE_ENV_PROXY npm test` 与默认态**两态都留档**；报错文本须**点名延迟来源**（非「Ollama 不可达」） | checker + embed 超时缺省（须先判该不该动） | §22 |
| **F-07b** | 「本地服务不走代理」是否写进契约 | 环境/契约面 | **拍板** | 契约文档新增条目 + 负向对拍 | 契约 | §22 |
| **F-08** | A1-5 转真判据 | long-term / ACT-R | **挂 B3.1**（关键路径唯一未开工节点） | A1-5 由 NONE→PASS；负向：改半衰期必红；三锚点逐字复现 | `packages/long-term/**`（74 行骨架） | §16.7（**只接 decay，不接 FSRS**） |
| **F-09** | A0-10 改判本仓 + 在途收口 | 工具链 + git 纪律（**唯一 git 写席**） | F-05a | ① 基线对象含本仓 ② `git status --porcelain` 只剩预期文件 ③ **判据③重写：记录变更历史 + 负向对拍**（原判据会假通过，见 D7） | `docs/contract/**`（**唯一授权窗口**） | — |
| **F-10** | v10 增量落点裁定（只落文档） | 文档 | **挂拍板「v10 参照口径」** | `grep -rn ITACL packages/*/src` 保持 0；落地册命中行须同含「不移植 + 理由锚点」 | `docs/mana-rollout-plan.md` | §19–21/§15/§17/§18.3 |
| **F-11** | §39 指标与消融可判性 | 文档 | **挂 B7** | 落地册人工判据节显式列全并逐条标「待定/未验证」 | 仅文档 | §39 |

---

## 四、多 agent 任务分配（写面隔离为第一原则）

### 4.1 写面热点（本轮真瓶颈）

| 写面 | 争用批次数 | 性质 |
|---|---|---|
| **`tools/a1-check.mjs`** | **6**（F-01/03/04/05/06/07） | **唯一真瓶颈** |
| `docs/mana-rollout-plan.md` | 4 | 共享 |
| `tools/a0-check.mjs` | 3 | 共享 |
| `docs/contract/**` | 1（F-09） | **全员只读面，本周唯一授权窗口** |
| `packages/jev/src/ollama.ts` | 1（F-03） | **S2 独占** |
| `packages/{perception,attention,working-memory,scheduler}/src/**` | 1（F-01 口径 A） | **W3 集成面（已过期标注：B2.1 已完成）** |

> ⚠ **`docs/session-allocation.md` 的所有权表已过期** —— 它把三个包标为「S5（B2.1 期）」，而 B2.1 早已完成（`docs/handoff/S5.md` 存在）；且未列 `tools/**` 与 `docs/mana-*.md` —— **这正是 D6 在治理层的同型表现**。

### 4.2 波次（并行上限实数 = 2，理由修正）

```
W0′ 串行·单席   F-05a 纪律  +  F-09 在途收口  （+ 拍板后 F-05b）
      ↓ 【门】工作树干净 + 取数三元组可打印
W1′ 并行 2      A 路 F-02   ∥   B 路 F-03
      ↓         ⚠ 同一 injection-gate.test.mjs ⇒ 二选一（见下）
W2′ 串行·单席   F-04（加开工门）→ F-07a → F-06
      ↓         同一 checker + 判据互锁
W3′ 文档面      F-10 → F-11（同文件）
      ↓
W4′ 等 B3.1     F-08
```

**并行上限为什么是 2（修正后的理由）**：上限**来自挂账项**（F-08 挂 B3.1、F-10/F-11 挂拍板、F-01 挂裁决），**不是**写面限制。
**解锁条件**：拍板 F-10 ⇒ 文档面可并入 W1′ ⇒ **上限升至 3**（F-08 只写 `packages/long-term/**` 独占，届时亦可入场）。

**W1′ 的二选一（终审裁定）**：b4 原方案「B 路只改 `a1-check.mjs:571` 一行」**物理不可执行** —— 改批到 3 项须同步改计数比较与文案行；且 F-03 判据②本身就要求改 `injection-gate.test.mjs`。**二选一**：
- 方案甲：整个 `injection-gate.test.mjs` 给 F-02 一路，F-03 只做 A1-8 夹具 + 变异腿（不含 P13 批次）
- 方案乙：F-03 独占该文件，F-02 进 W2′ 串行窗口

### 4.3 六条并发纪律（本轮实锤教训换来的，可执行）

1. **判据器带锁**：同 checker 单实例；锁内容 = pid + 起始时刻 + commit；第二个实例**非零退出并打印持有者**，**禁静默排队**（排队 = 失败不可观测）
2. **`--record-baseline` 唯一基线席**，且前置 `git status --porcelain` 为空。（反例：本轮 `_freeze.head` 在脏树上被写并回滚，见 D7）
3. **取数三元组**：`commit / checker-md5 / env 关键变量 / 时刻`，缺一项即标「浮动读数」，**不得进结论**
4. **git 单写者 + 禁 `git add -A`**（沿用 `docs/session-allocation.md` §三）；开工记 HEAD、收工复核
5. **禁并发 build 同一 workspace**（会把别席在途码编进你的 lib ⇒ 归属错乱）；要验只 build 自己包
6. **改 `tools/*-check.mjs` 须在提交信息写明期望项数变化**（本轮 15→16 无声明，是实测发现而非机器报警）

### 4.4 每席验收自检（三件套 + 证据格式）

- **装配判据**：`node tools/r0-assembly-check.mjs`（真 Loader 按包名，判据＝**服务可读**，非调用成功）
- **行为判据**：相关 `node --test <file>` 的**用例名集合 + 计数**
- **反证判据**：卸载该插件后**不再产生新行**
- **证据格式（缺一即不合格）**：`命令 → exit code → 关键读数 → 与开工基线的差 → 取数三元组`
- 四态语义：**PASS / FAIL / HANG / NONE —— 挂账与无实现者都不是 PASS**

### 4.5 不得越界项（boundary 六条 → 逐席禁令）

① `packages/*/src`、`tools/*.mjs`、`docs/contract/*` **默认只读**；仅 F-04/F-05/F-09 在显式拍板后可按写面动，且须写明「碰了哪面墙 + 证据」
② **禁任何 `npm i`**（尤不装 sqlite-vec）；`node_modules` 变化即违约
③ 不重排 W1/W2/W3 与阶段划分：F-* 全部**映射进既有波次**；F-08→B3.1、F-11→B7
④ 不把 v10 设计意图当现状写进文档：F-10 只写「不移植 + 理由锚点」
⑤ `grep -rin openrouter packages/*/src` 须保持 **0**（现 0）
⑥ 不动 shoucang 既有件与 DSH 运行时

---

## 五、待用户拍板（R3 越权面，未拍板不得开工）

| # | 议题 | 选项 | 倾向 |
|---|---|---|---|
| 1 | **A1-1 处置** | A 补两个真实生产者 / B 改判据原文 / C 维持现状 | **A**（缺的是生产侧写入点；改原文＝把缺陷写进契约） |
| 2 | **v10 参照口径** | A 仅协议参照、接入面以 v6.3 实况册为准 / B 两版并列 / C 不再引用 | **A**（§23 无状态列 + 三处冲突复发） |
| 3 | **`_freeze.head` 处置** | A 单列并先修并发 / B 回滚 / C 不管 | **A**（先修并发，否则回滚后会被再覆盖）—— 且 D7 表明「回滚」本身已发生且不可见 |
| 4 | **挂账是否加「首现时刻 + 原定阶段」** | A 加且可升级为 FAIL / B 维持现状 | **A**（ARTIFACTS 挂账跨越多次提交；A1-5 属阶段 2/3，阶段 1 门读它通过＝跨阶段静默） |
| 5 | **A0-6 是否加「取数时刻 + 环境态 + 是否并发」条件** | A 加 / B 不加 | **A**（同一工作树 30 分钟内 A0 翻转已实测） |
| 6 | **F-05b 锁粒度与失败语义** | A 单实例锁 + 非零退出 / B 排队等待 / C 不加锁 | **A**（静默排队＝失败不可观测） |
| 7 | **W1′ 二选一** | 甲：测试文件给 F-02 / 乙：给 F-03 | 视你的优先序（F-02 = 不变式可数；F-03 = 消灭夹具自证） |

---

## 六、会议过程记录（含主持人自纠）

本会议**主持人自己的结论被独立席驳回两次**，均已写进过程记录：

1. **行锚错**：主持人引 `jev-gate.test.mjs:44-66` 作 gate 夹具 —— 实为 `:41` 词表 / `:44-66` 是 `insert()` 函数体 / **真夹具在 `:69`(G1) 与 `:88`(G2)**
2. **范围过宽**：主持人称「全部机检建立在过期 lib 上」—— 实为 **6 项**；`A0-5` 走 `src/index.ts`、`A0-8` 直 import `src/*.ts`，**不受影响**
3. **归因错误（自撤）**：「options 内 logprobs」被列为 v10 冲突复发 —— v10 全文该词命中 **0**
4. **数字未复现（自撤）**：规划席报「代理导致 node fetch 20.1s」—— 主持人实测两态均 110ms，已标为浮动读数

**会议全程只读**；`docs/contract/_freeze.head` 的改动循环**非任何专家席、非主持人**所为，是同仓并发写者（见 D6/D7）。
