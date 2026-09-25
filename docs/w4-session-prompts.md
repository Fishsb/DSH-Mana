# Mana W4 会话分配与席位派单册

> **依据**：`docs/mana-v10-review-and-allocation.md`（v10 评审结论 + F-01…F-11 批次）· 圆桌会议 `mana-v10-review-2026-09-25`
> **编排原则**：**写面隔离**（同一时刻一个路径只有一个写者）+ **依赖序分波**，不按功能清单平铺。
> **取数坐标**：HEAD `98ae46c`（**引用前须复跑**；本仓非独占工作树，会议期间 HEAD 移动 3 次）。
> **配套旧档**：`docs/session-allocation.md`（W1–W3 波次，**其所有权表已过期**——把三个包标为「S5（B2.1 期）」而 B2.1 早已完成，且未列 `tools/**` 与 `docs/mana-*.md`）。本册是它的续编，冲突处**以本册为准**。

---

## 〇、一页速览

**6 席 5 波**；**本轮可开 2 席**（写面不相交），其余各有明确阻塞原因。

| 波次 | 席位 | 批次 | 写面 | 本轮可开 |
|---|---|---|---|---|
| **W0′** | **S6 治理席** | F-05a 纪律 + F-09 在途收口 | `tools/a0-check.mjs` · `docs/contract/**` · git 写 | ✅ **开** |
| **W1′** | **S7 判据席** | F-03（A1-14 真降级 + A1-8 夹具 + 变异腿） | `tools/a1-check.mjs` · 两个测试文件 · `packages/jev/src/ollama.ts` | ✅ **开** |
| W1′ | S8 不变式席 | F-02（I2 补可数处） | `packages/attention/src/index.ts` · injection-gate 测试 | ⛔ 与 S7 **争同一测试文件** ⇒ W2′ |
| W2′ | S9 构建席 | F-04 → F-06 | `packages/*/lib/**` · 两 checker | ⛔ 需 W0′ 清树 + F-05a 生效 |
| W3′ | S10 文档席 | F-10 → F-11 | `docs/mana-rollout-plan.md` | ⛔ 需拍板「v10 参照口径」 |
| W4′ | S11 long-term 席 | F-08 | `packages/long-term/**` | ⛔ 挂 B3.1（关键路径唯一未开工节点） |
| 挂账 | — | F-01 · F-05b · F-07b | — | ⛔ 等拍板（见 §四） |

**并行上限 = 2**，理由**不是**写面而是**挂账**：F-01/F-05b/F-07b 等拍板、F-08 挂 B3.1、F-10 挂拍板。
**解锁**：拍板「v10 参照口径」⇒ S10 可并入 W1′ ⇒ **上限升到 3**。

---

## 一、并发纪律（W0′ 的交付物，**全席适用**）

> 来源：圆桌会议三轮实测（三方并发跑同一检查器 · `_freeze.head` 被写→回滚 · HEAD 移动 3 次 · 判据项数 15→16）。

1. **判据器带锁**：同一 checker 单实例；锁内容 = pid + 起始时刻 + commit；第二个实例**非零退出并打印持有者**。**禁静默排队**（排队＝失败不可观测）。
2. **`--record-baseline` 唯一基线席**（本册指 **S6**），且前置 `git status --porcelain` 为空。任何其他席**不得**执行该开关。
3. **取数三元组**：`commit / checker-md5 / env 关键变量 / 时刻`。缺一项即标「浮动读数」，**不得进结论**。
4. **git 单写者 + 禁 `git add -A` / `git add .`**：只 `git add` 你自己写面内的文件 + 你自己的 `docs/handoff/<席>.md`。开工记 HEAD、收工复核。
5. **禁并发 build 同一 workspace**：会把别席在途码编进你的 `lib/` ⇒ 归属错乱。要验，只 build 自己那个包。
6. **改 `tools/*-check.mjs` 须在提交信息写明期望项数变化**（例：`15 → 16`）。不声明的项数变化＝下一个执行席的假红/假绿来源。

---

## 二、每席验收自检（三件套 + 证据格式）

- **装配判据**：`node tools/r0-assembly-check.mjs` —— 判据＝**服务可读**，不是「调用没抛错」
- **行为判据**：相关 `node --test <file>` 的**用例名集合 + 计数**（不是只有 exit code）
- **反证判据**：卸载该插件后**不再产生新行**（仍产生即不通过）
- **证据格式（缺一即不合格）**：`命令 → exit code → 关键读数 → 与开工基线的差 → 取数三元组`
- **四态语义**：`PASS / FAIL / HANG / NONE` —— **挂账与无实现者都不是 PASS**；不得以「挂在原定阶段」当放行理由
- **交接单**：`docs/handoff/<席>.md` 固定 6 段（交付文件 / 判据执行 / 反证判据 / **回归自检** / 未决项 / 契约版本）。第 4 段不可省：**碰了别的行为却不说＝静默回归**。

---

## 三、席位派单（可直接粘贴）

### S6 · 治理席（W0′ · 先开这一席）

> 你是 Mana 项目的【S6 治理席】。工作目录：/home/lk/Mana
> 本席是本轮唯一授权动「全局取数面」的会话，也是唯一 git 写者。
>
> 必读（勿改）：docs/mana-v10-review-and-allocation.md §二 D6/D7 · §四.3 六条并发纪律 · docs/session-allocation.md §三（两条硬规矩）
>
> **写面（唯一写者）**：`tools/a0-check.mjs` · `docs/contract/**` · `.gitignore`（如需）
> **禁写**：`packages/**`（全部只读）· `tools/a1-check.mjs`（属 S7）· `docs/mana-rollout-plan.md`（属 S10）· 根 `package.json`
> **禁**：`npm i` · `git add -A` · 任何 workspace 级 build
>
> **批次 F-05a：并发纪律落地（零代码，立即可做）**
> 把 §一 的六条写进 `docs/contract/concurrency-discipline.md`（新建）。
>
> **批次 F-09：A0-10 改判本仓 + 在途收口**
> 问题（已实测）：`tools/a0-check.mjs:300` 的 `SAMPLE = /home/lk/dsh-src/dsh-plugin-roundtable`，
> 且 `:312-313` 用它跑 `git rev-parse` / `git status --porcelain`
> ⇒ A0-10「不碰既有件」判的是**另一个仓**，Mana 本仓无人看守。
>
> 判据（三条都要真）：
> ① A0-10 的基线对象**含本仓路径**，语义＝「与本批开工前实测值相等」（不是固定数字）
> ② 收工后 `git status --porcelain` 只剩本批预期文件
> ③ ⚠ **判据③必须重写 —— 原形态会制造假通过**：实测 `docs/contract/_freeze.head` 被一个完整循环走过
> （07:30:31 写 → 07:53:27 回滚），现值＝初始值 `ee9e22e`、`git status` 为空、三件套均与 HEAD 版一致，
> **但 mtime 露馅**（sha256 / files.txt = 07:30:31，head = 07:53:27，晚 23 分钟），且 A0-12 的 HEAD 腿
> （「快照锚点仍是祖先」）**照样通过** ⇒ 一个什么都没做的动作被判通过。
> 重写要求：**记录变更历史 + 负向对拍**（造一次「写了又回滚」的扰动，断言该扰动**必须被检出**）。
>
> ⚠ 边界：`docs/contract/**` 是全员只读面 ⇒ 本席是**唯一授权窗口**。任何改动须在
> `docs/contract/CHANGELOG.md` 追加一行（含理由），并写明「碰了哪面墙 + 凭什么确认没碰坏」。
>
> **出口**：`docs/handoff/S6.md` 六段齐全 + 六条纪律落盘 + F-09 三条判据实测输出（含负向对拍证据）。

### S7 · 判据席（W1′ · 与 S6 写面不相交，可同时开）

> 你是 Mana 项目的【S7 判据席】。工作目录：/home/lk/Mana
> 本席消灭**夹具自证**（判据 PASS 但测的不是判据要求的那件事）。
>
> 必读（勿改）：docs/mana-v10-review-and-allocation.md §二 D3/D4 · docs/mana-rollout-plan.md:458（A1-8）/:474（A1-14）
>
> **写面（唯一写者）**：`tools/a1-check.mjs` · `packages/core/tests/injection-gate.test.mjs` ·
> `packages/core/tests/jev-gate.test.mjs` · `packages/jev/src/ollama.ts`
> **禁写**：`tools/a0-check.mjs`（属 S6）· `packages/attention/**`（属 S8）· `docs/contract/**`（只读）
> **禁**：`npm i` · `git add -A` · workspace 级 build
>
> **【F-03-a】A1-14 改用真降级用例（一行改动 + 同步计数与文案）**
> 现状：`tools/a1-check.mjs:571` 是 `runCases(W3_TESTS.gate, [P5 A1-14, P6 A1-14])`，
> P6 在 `injection-gate.test.mjs:243-252` 由测试**自己直写**
> `core.writeInjectLog({gate:degraded_unavailable})`（该文件注释自认「服务面直写」）。
> 真用例已存在：P13「判定链降级」在 `injection-gate.test.mjs:399-414`，**且已被 A1-13 的批调用**（`tools/a1-check.mjs:472`）。
> ⚠ 不要新写用例；改 `:571` 的批指向 P13 即可。
> ⚠ 改批到 3 项**必须同步改同一处的计数比较与文案行**（不是只改一行字符串）。
> 改完用 `node tools/a1-check.mjs --json` 断言：A1-14 仍 PASS 且**用例数从 2 变 3**。
>
> **【F-03-b】A1-8 消灭夹具自证**
> 现状：`jev-gate.test.mjs:44` 的 `insert()` 自写 SQL 直塞 `jev_log.gate`（用例 `:69`/`:88`）；
> 生产写者 `packages/jev/src/ollama.ts:262-265` 的 INSERT 列清单**不含 gate**（`grep -n gate packages/jev/src/*.ts` = 0）。
> ⇒ A1-8 PASS 推不出「运行态可归因」。
> 要求：让 gate 由**生产路径**写入（补 `ollama.ts` 的 INSERT 列或在 driver 层补写），
> 测试改为断言「经真通道跑一次后，`jev_log` 里出现词表内的 gate 值」；
> 删掉自写 `insert()` 里对 gate 的直塞后，该文件**必须仍绿**（否则说明降级不是来自生产路径）。
>
> **【F-03-c】变异自证腿的死分支**
> 现状：`tools/a1-check.mjs` 有一段 `const injected = mt.selfKernel ? mutApplied.has(m) : mutApplied.has(m)`
> —— **两个分支字面相同**，自证分支是死功能。
> ⚠ 该行行号会中位移（会中曾被记在 `:650`，实读时已不在该行）⇒ **先定位真行再改**，不要按行号直接改。
> 要求：修正分支语义，并让「同一判据被注入多个变异器」在**判据腿之前**报错 exit 2（现在晚于全绿输出）。
>
> **出口**：`docs/handoff/S7.md` 六段齐全（第 4 段必须写明：本席碰了 `tools/a1-check.mjs` 的哪几处、
> 项数是否变化、凭什么确认 A1-13 等其他判据没被误伤）。

### S8 · 不变式席（W2′ · **等 S7 交文件**）

> 你是 Mana 项目的【S8 不变式席】。开工前提：S7 已交付（`injection-gate.test.mjs` 写面已释放）。
>
> **批次 F-02：让 I2 不变式有可数之处**
> 问题：`packages/attention/src/index.ts:199` 的 `finish(gate, extra)` 已支持 `memoryId`，
> 但 7 个调用点（`:246/:253/:260/:265/:302/:308/:331`）**无一传它**
> ⇒ `inject_log.memory_id` 恒 NULL ⇒「每条记忆每 session 最多注入一次」无表可查。
>
> **写面**：`packages/attention/src/index.ts` · `packages/core/tests/injection-gate.test.mjs`
> **判据**：跑 `node --test` 后对临时库断言
> ① `count(gate='injected' AND memory_id IS NULL) == 0`
> ② `count(memory_id IS NOT NULL) >= 1`
> 负向：去掉 `{memoryId}` ⇒ ① > 0（必须真的能红）。
> **回归面**：`inject_log` 写入列 + A1-2 / A1-3 / A1-13 三条判据 —— 收工须逐条复跑并贴输出。
> ⚠ 与 S7 的 F-03-a 同碰 `injection-gate.test.mjs` ⇒ 两席**不得同时开**。

### S9 · 构建席（W2′ 之后）

> 你是 Mana 项目的【S9 构建席】。开工前提：S6 已清树（`git status` 干净）+ F-05a 纪律生效。
>
> **F-04（消灭 lib/src 双向漂移）** ⚠ **两道开工门必须先过**：
> ① `git status --porcelain` 为空（否则会把他人在途码编进产物）
> ② 记录每包 src/lib 的 mtime 对（作为本批基线）
> 问题：`packages/core/package.json:8` main → `./lib/index.js`，而 lib 与 src **双向漂移**（core: src 新于 lib；vector: lib 新于 src）。
> 判据：`node tools/a1-check.mjs --require-fresh-artifacts` 由 HANG→PASS；断言「每包 lib mtime ≥ 其 src 最新 mtime」；负向：touch 任一 src ⇒ 该项必红。
> ⚠ 只 build 你负责的包，**禁 workspace 级 build**。
>
> **F-07a（纯测量，无需拍板）**：A1-12 的「本机 Ollama 必须可达」须改成**两态可分辨** ——
> 默认态与 `env -u NODE_USE_ENV_PROXY` 两态**都留档**；报错文本必须**点名延迟来源**（而非笼统「Ollama 不可达」）。
> ⚠ 会中该条的「20.1s vs 117ms」**未复现**（主持人实测两态均 110ms）⇒ 数字标浮动读数，不进结论。
> ⚠ **不得以调大 timeout 当修法**。
>
> **F-06**：`node tools/a0-check.mjs --json` 每项 detail 须含 commit-short，且输出可 `JSON.parse`
> （须分离 stdout/stderr —— 会中该管道被 UNDICI 提示污染过）。

### S10 · 文档席（**等拍板「v10 参照口径」**）

> 你是 Mana 项目的【S10 文档席】。开工前提：用户已拍板「v10 参照口径」（选项 A：仅协议参照）。
>
> **F-10**：把「0 移植 / 3 改造后用 / 4 不移植」写进 `docs/mana-rollout-plan.md` 阶段 3/4/5 的
> **实施要点列**（不是脚注）。不移植理由锚点：ITACL —— 宿主 `agent/pre-step` 返回类型只有 reject/enter
> （`dsh-agent/lib/types/runtime-types.d.ts:304-310`），无「信息充足度」通道 ⇒ 0.7/0.6 阈值无处落。
> 判据：`grep -rn ITACL packages/*/src` 保持 0；命中行须同含「不移植 + 理由锚点」。
> ⚠ 只写「不移植 + 理由」，**不把 v10 设计意图当现状**。
>
> **F-11**：§39 的 10 指标 / 8 消融在 §5 人工判据节显式列全，逐条标「待定 / 未验证」。
> ⚠ 「去掉批量调用」在本仓**无开关可关** ⇒ 必须如实标注，不得编造开关名。

### S11 · long-term 席（**挂 B3.1**）

> 你是 Mana 项目的【S11 long-term 席】。开工前提：B3.1 开工（**关键路径上唯一未开工节点**）。
>
> **批次 F-08：A1-5 由 NONE 转真判据**
> **写面**：`packages/long-term/**`（现 74 行骨架）
> 判据：A1-5 由 NONE→PASS；负向：改半衰期参数 ⇒ 必红；
> A 档三锚点逐字复现 `decay(0)=1.000000 / decay(14)=0.500000 / decay(90)=0.011609`。
> ⚠ 只接 decay（Pavlik & Anderson 那套），**不接 FSRS** —— v10 §17.1 的 FSRS 与已冻结的
> A1-5 值冲突，前席已判不移植（`docs/mana-rollout-plan.md` C14 正要求公式收敛）。

---

## 四、待拍板（未拍板不得开工的批次）

| # | 议题 | 阻塞批次 | 倾向 |
|---|---|---|---|
| 1 | **A1-1 处置**：补两个真实生产者 / 改判据原文 / 维持现状 | F-01 | **补生产者** |
| 2 | **v10 参照口径**：仅协议参照 / 两版并列 / 不再引用 | F-10、F-11（**解锁 S10 与并行上限 3**） | **仅协议参照** |
| 3 | **`_freeze.head` 处置** | F-09 判据③ | **先修并发**（D7 表明回滚已发生且不可见） |
| 4 | **挂账是否加「首现时刻 + 原定阶段」** | A1-5 / ARTIFACTS / W-1..3 | **加，且可升级为 FAIL** |
| 5 | **A0-6 是否加「取数时刻 + 环境态 + 是否并发」** | F-06 | **加** |
| 6 | **F-05b 锁粒度与失败语义** | F-05b | **单实例锁 + 非零退出** |
| 7 | **S7 ∥ S8 二选一**（同碰 injection-gate 测试文件） | W1′/W2′ 排班 | 本册默认 **S7 先、S8 后** |

---

## 五、启用顺序（一句话）

**现在开两席：S6（治理席）+ S7（判据席）** —— 两者写面不相交
（`tools/a0-check.mjs` + `docs/contract/**` vs `tools/a1-check.mjs` + 两个测试文件 + `packages/jev/src/ollama.ts`）。
其余四席各按 §〇 速览的阻塞原因排队；拍板「v10 参照口径」后 S10 可提前入场，并行上限升到 3。

---

## 六、W4 第一波执行结果（2026-09-25 · 4 席并行）

> 取数坐标：HEAD `d26c661` · 窗口 08:39–09:21 +0800 · `md5 tools/a0-check.mjs` = `b6a8fc66…`
> **本仓非独占工作树** —— 会话中 HEAD 由 `f24b6a8` 推到 `d26c661`（5 次），下列读数绑定于取数时刻。

| 席位 | 状态 | 交付 | 主持人独立复核 |
|---|---|---|---|
| **S6 治理席** | 收工（已提交 4 个 commit） | `docs/contract/concurrency-discipline.md`（六条纪律）· `_freeze.log`（append-only 流水）· A0-10 加**本仓腿 + 越界腿** · A0-12 由 3 腿扩到 **7 腿** | `--only A0-12` 实跑七腿全 PASS（哈希/清单 36 件/HEAD/流水 seq=8/锚点 7 条单调/时序/跃迁）；完整跑 `共 16 项 PASS 15 · FAIL 0 · 挂账 1` exit 0 |
| **S7 判据席** | 收工（**未提交**，见 §6.3） | A1-14 批加 `P13 判定链降级`（真降级）· A1-8 夹具自写 SQL **清零**（新建 `packages/jev/src/jev-log-gate.ts` 作唯一生产写者）· 死分支拆成 `mutApplied`/`selfApplied` 并前移用法闸 · ARTIFACTS 文案订正 | `grep -c "INSERT INTO jev_log" packages/core/tests/jev-gate.test.mjs` = **0**；`:816` 两分支不再相同；门 `16 项 PASS 14 · FAIL 0` exit 0；`npm test` **252/252** |
| **S9 构建席** | 收工 | core/vector/user-model 三包 lib 重建（`lib ≥ src`）· **隔离对照实证**「ARTIFACTS 文案不成立」 | 三包 lib `08:41:0x`；隔离副本换旧 lib ⇒ A1-2/A1-13/A1-14 FAIL（唯一变量是 lib 内容） |
| **S10 文档席** | 收工 | `docs/mana-rollout-plan.md` §5 追加 v10 §39 落册 | `git diff --numstat` = **`46 0`**（纯插入）；标题数 66→66；落在 §5–§6 之间 |

### 6.1 本波新增的待拍板项（4 条）

| # | 议题 | 提出席 | 倾向 |
|---|---|---|---|
| 8 | **ARTIFACTS 是否从「比 mtime」升级为「比内容/导出面」** | S7 + S9（独立同判） | **B 升级** —— S9 已实测其假绿可达「报 PASS 而三项 FAIL」；mtime 是代理指标 |
| 9 | **Write 面 budget 一支该不该有「注入侧可达」的真路径** | S7 | **A 维持现状** —— `attention/src/index.ts:269-302` 只认 `degraded`，注入侧本就不该感知预算闸 |
| 10 | **v10 §39.3 八组 vs 本册 B7.1/A6-1 六组集合不同** | S10 | **B 维持六组、仅登记不并** —— v10 独有 5 组中 4 组无落点，并组＝把无落点项写进放行闸 |
| 11 | **F-05b 判据器内置锁** | S6 | **A 单实例锁 + 非零退出打印持有者** —— 本轮 `ps` 已实拍到三方并发；纪律第 1 条现仍**无机器落点** |

### 6.2 未决 / 未覆盖面（S6 如实登记，未掩盖）

- **F-09 判据②「git status 只剩预期文件」结构上不可达**：工作树非独占，常驻 4 件他席在途。替代判据 = A0-10 的**越界腿**（提交 ⊆ 声明写面 + 无主脏件报红）。
- **完全绕开记录路径的手工写→手工回滚**：若发生在末条 `record` **之前**，检不出（与「不得用 mtime 判红」同源）。已写进 `CHANGELOG` 的未覆盖面。
- **A0-12 第 7 腿（锚点跃迁腿）是 S6 席收尾时自行补上的**，超出派单确认的六腿清单 —— 经复核**合规且必要**：它修的是「记录→提交→再记录会把提交面证据洗掉」，前六腿结构上解决不了。
  **评议**：属正当行使写面内职责，不算越界；但派单方须把「允许在写面内自主补腿」的边界写清楚（本册此后照此执行）。

### 6.3 待你决策：S7 的产出尚未提交

S7 的 4 件在途（`packages/jev/src/jev-log-gate.ts` 新增 143 行 · `packages/jev/src/ollama.ts` · `packages/core/tests/jev-gate.test.mjs` · `tools/a1-check.mjs`）**均未 `git add`**，是它按纪律留下的。
主持人**没有替你提交** —— 提交动作归你或持有 git 写权的会话。**在你决定前，这 4 件是工作树上的未修改/未跟踪状态。**

### 6.4 下一波可开（写面已释放）

- **S8 不变式席**（F-02 补 `inject_log.memory_id`）—— S7 已释放 `injection-gate.test.mjs` 写面（该席本轮并未改动此文件），**现在可开**。
- **S11 long-term 席**（F-08 A1-5 转真判据）—— 需 B3.1 开工。
- **F-06 / F-07a**（取数三元组进报告 / 网络两腿）—— S6 已释放 `tools/a0-check.mjs`；`tools/a1-check.mjs` 待 S7 产出提交后释放。
