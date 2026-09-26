# Mana 全量并发推进方案（v1）

> **产出**：圆桌会议 \`mana-full-line-parallel-2026-09-26\`（8 席 · 第 1 轮 · 只读勘察）
> **用户原始指令（逐字）**：能多少并发就多少并发，全量并发推进，启用原作会议先做整体推进方案然后高并发全线推进
> **取数坐标**：HEAD `4de9b87` · \`npm test\` **492 pass / 0 fail** · A1 门 **17 项 PASS 14·FAIL 0·挂账 3**（判据腿+项集腿皆过）· A0 门 **16 项 PASS 13·FAIL 2·挂账 1** · 16 包
> ⚠ **本仓非独占工作树**：勘察期间 HEAD 漂移 **5 次**（\`1b4a3cd→fa48ee4→cc44cac→d5718dd→4de9b87\`）。**引用任何读数前必须先复跑**；本文所有「平台约束」已由主持人复跑定裁，不再逐席验证。
> ⚠ **本轮 8 席零改动面**（只读勘察）；两处「回退」告警经主持人复跑**均不成立**（详见 §7）。

---

## 一、一句话结论

**并发上限不是被依赖卡住的，是被三条「非依赖」的约束卡住的**：

| # | 真实约束 | 依据（实测） | 后果 |
|---|---|---|---|
| 1 | **跑门并发 = 1**，且**单实例锁在本 harness 下结构性失效** | \`a0-check.mjs:139/:142\` 双锁把两门压成一条通路；\`bwrap --unshare-pid --tmpfs /tmp\` ⇒ 锁跨调用不可见 | **必须「一席跑、全席引用」**，不能靠锁 |
| 2 | **产物内容腿 42s 窗口与 build 互斥** | \`a1-check.mjs:1456\` 重编 16 包（实测 42073ms / 局部 12925ms），逐字节比 73 个产物 | **build 与跑门二者总数 = 1** |
| 3 | **全局共享基线闸与并行写入不相容** | \`tools/.a0-10-baseline.json\` 的 \`expect=["docs/contract/"]\` 是 19:04 的**单写面快照**；锚点 \`66ef2bb\` 之后已有 12 提交、4 个 \`packages/*/src\` 文件变更 | **A0-10 在并行下持续假红 ⇒ 全员学会无视它**（越界腿永久失效） |

⇒ **可并行的真实结构上限 = 4 席写 + 1 席跑门**（写面互斥 4 组 + 1 条门通路）。这与 \`docs/mana-work-summary.md:141\` 独立实测的「≈4 席」**互相印证**，非单一席主张。

---

## 二、并发上限的六步推导（过程，不是结论）

| 步 | 约束面 | 上限 | 依据 |
|---|---|---|---|
| 1 | 资源 | 核 12 / 内存可用 10.7GB / **swap 已用 3220 于 4096（79%）** | \`nproc\`/\`free\` 实测 |
| 2 | **共享可变状态** | **跑门 = 1** | \`a0-check.mjs:139\` 取 a0 锁、\`:142\` 再取 **a1 锁** ⇒ 两门结构互斥 |
| 3 | 写面互斥 | 改 src ≤ 12；**同文件 = 1** | 写面清单（§3） |
| 4 | 产物耦合 | **build 与跑门互斥** | 内容腿逐字节比；\`lib/\` 对 git 不可见（\`git ls-files packages/*/lib\` = **0**） |
| 5 | 只读勘察 | ≈12，**但不受锁保护** | 命名空间隔离（§5） |
| 6 | **取交集** | **1（跑门或 build）+ min(11, 写席+只读席)** | — |

**每类操作的并发上限**：

| 操作 | 上限 | 依据 |
|---|---|---|
| 跑门（a0/a1/r0） | **1** | 双锁 + 锁跨调用失效 |
| 改 src（不同包） | ≤12 | 单包 tsc 3381ms / 200MB；核 12 |
| 改 src（同文件） | **1** | 写面互斥 |
| build（写 \`lib/\`） | **1，且与跑门互斥** | §2 步 4 |
| \`npm test\` | 未测（不给数） | 计时输出随命名空间丢失 |
| 只读勘察 | ≈12，不受锁保护 | 步 1 |

---

## 三、写面互斥切分表（并发的关键依据）

| 项 | 写面 | 冲突 |
|---|---|---|
| **B3.2-R** Recall Gate | \`packages/long-term/src/**\` | 独占 ✅ |
| **B3.2-W** Write Gate | \`packages/jev/src/**\` + \`packages/core/src/index.ts\`(\`writeMemoryItem\`) | ⚠ 与 core 独占波冲突 |
| **B3.2-I** Injection Gate | ✅ **已实现**（见 §7.2），无需再开工 | — |
| **A1-5** 衰减锚点 | \`packages/forgetting/src/{criteria,params}.ts\` | 独占 ✅ |
| **B7.1** 消融 | \`tools/a6-ablation.mjs\` · \`tools/ablation/**\` | 独占 tools ✅ |
| **B7.2** 探针 | \`tools/probes/**\` | ⚠ 与在途 \`a08-schema.mjs\` 冲突 |
| **A0-10** 基线 | \`tools/.a0-10-baseline.json\` | ⚠ 与一切写不相容 |
| **A0-12** 快照 | \`docs/contract/_freeze.*\` | ⚠ 与 A0-10 同波同目录 |
| **判据登记** | \`tools/a1-check.mjs\` + \`docs/mana-rollout-plan.md\` | ⚠ **全项共用 ⇒ 单席独占** |
| **core 任何改动** | \`packages/core/**\` | ⚠ **被 16 包 import ⇒ 独占波** |

**可真并行 4 组**：\`B3.2-R\`(long-term) ∥ \`B3.2-W\`(jev) ∥ \`B7.1\`(tools/ablation) ∥ \`A1-5\`(forgetting)
**必须串行 3 链**：① \`core\` 独占波 ② \`判据登记\` 单席独占 ③ \`A0-10 → A0-12\`（同目录，收口期）

> ⚠ **与既有切分的分歧**：\`docs/mana-work-summary.md:121\` 把 B3.2 写成**一个**火力项。实测三门分属三个包、Recall/Write 之间无依赖 ⇒ **应拆 3 项**（Injection 已完成，故实际新增 2 项并发余量）。

---

## 四、波次图

```
W0  基线对齐（纯读，可满并发）
    一席跑 a0/a1/r0 并广播三元组；其余席引用 —— 因锁失效，禁止各席各跑

W1  4 组并行（写面互斥已成立）
    a: B3.2-R  Recall Gate      packages/long-term/src/**
    b: B3.2-W  Write Gate       packages/jev/src/** + core/writeMemoryItem
    c: B7.1   消融 harness      tools/a6-ablation.mjs, tools/ablation/**
    d: A1-5   衰减锚点转真判据   packages/forgetting/src/{criteria,params}.ts

W2  独占波（core，被 16 包 import，不可与任何写同波）
    e: core 侧改动（writeMemoryItem 分列 UPSERT + 判据登记单席）

W3  产物波（build 与跑门互斥，且必须在 src 写完之后）
    f: 各包 npm run build -w packages/<pkg>（禁 workspace 级 build）

W4  收口（全席停手）
    g: A0-10 基线重取（写面 = 本波全席写面并集）→ A0-12 快照重取（同目录，先后）
    h: 判据登记单席（tools/a1-check.mjs + 册）
    i: 集中跑门 + npm test，取最终读数
```

---

## 五、平台约束（已复跑定裁，不再逐席验证）

### 5.1 单实例锁**结构性失效**（本轮最重要的单一发现）

**事实**：本 harness 的**每次 bash 调用 = 独立 PID 命名空间 + 独立 tmpfs \`/tmp\`**。
- \`ps\` 实拍：\`PID 1 = bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent --tmpfs /tmp\`；
- **主持人独立复现**：调用 A 写 \`/tmp/probeA.txt\` 成功 → **调用 B \`cat\` 报 \`No such file or directory\`**。

**后果**：\`tools/checker-lock.mjs\` 的活性锚点是 \`kill(pid,0)\`（\`:35-43\`）+ \`/proc/<pid>/stat\` starttime（\`:52-61\`）；\`/proc\` 是**本命名空间的 proc**，锁文件又在**每次调用私有的 tmpfs** ⇒ **跨调用完全看不见**。
⇒ ① 该锁提供的安全性**目前不存在**；② 接管留痕也随之蒸发。

**处置（写成硬规则）**：
1. **跑门一律「一席跑、全席引用」**——不靠锁，靠流程；
2. 每份读数带**四元组**：\`命令 → exit code → 关键读数 → 取数坐标(commit + checker-md5 + 时刻)\`；
3. **读数落盘到仓内**（非 \`/tmp\`），且每席/每批用**不可复用文件名**——否则跨调用取不回（本轮两席已实测「读数文件消失」）。

### 5.2 取数不可归因（已实证）

同一命令、同一会话、相隔数十分钟，\`npm test\` 结论从「1 红/4 红」翻成「**492 全绿**」，A1 从「FAIL 1」翻成「**FAIL 0**」。
⇒ **非独占工作树上的任何单次读数都不是结论**，必须带四元组 + 逐条复跑。

---

## 六、进程纪律（6 条，本轮实锤换来）

1. **跑门单席制**（替代失效的锁）；
2. **读数落仓**，文件名唯一，禁 \`/tmp\`；
3. **禁 workspace 级 \`npm run build\`**——只 \`npm run build -w packages/<pkg>\`（否则把他席在途码编进共享 \`lib/\`）；
4. **改 src 与 build 同席同波完成**（\`lib/\` 在 \`.gitignore\`，\`git ls-files packages/*/lib\` = 0，漂移不可见）；
5. **git 单写者 + 禁 \`git add -A\`**；开工记 HEAD、收工复核；
6. **基线重取只在收口窗口做**，写面填**本波全席写面并集**（不是 \`["docs/contract/"]\` 单条）。

---

## 七、裁决与更正（主持人复跑定裁）

### 7.1 两处「回退」告警：**均不成立**

| 告警 | 席位报告 | 主持人复跑（HEAD \`4de9b87\`） |
|---|---|---|
| \`npm test\` 红 | impl \`492例1红\`；accept \`fail 4\` | **\`# tests 492 / # pass 492 / # fail 0\`**（WALL=29.11s） |
| A1 门回退 | arch \`A1_EXIT=1\`、判据腿 ✗ | **\`PASS 14 · FAIL 0 · 挂账 3\`**，判据腿✓项集腿✓ \`A1_EXIT=0\` ✅门通过 |

⇒ 两席读的是**在途脏树**。**但这恰是 §5.2 的实证**：读数不可归因。

### 7.2 席间冲突定裁：Injection Gate **已实现**

- rollout 席称「仓内无 Injection Gate 注册 ⇒ W2 不可开工」；
- **定裁：该席错**。证据：\`packages/attention/src/index.ts:236\` \`ctx.on('agent/pre-step', ...)\` 是真注册点；\`:322\` \`const downstream = await next()\` 真调且在所有早退分支之前；五类 gate 全有生产写入点（\`injected\` / \`skip_no_candidate\`×3 / \`skip_below_threshold\` / \`degraded_unavailable\` / \`reset\`）。
- ⇒ **W2 不是待开工项**；rollout 席的「包归属未定」阻塞判断连带失效。

### 7.3 主持人新发现的「拆东墙」风险（两席均未报）

**\`packages/core/src/index.ts:522-525\` 的 \`writeMemoryItem\` 是 \`INSERT OR REPLACE\`，列清单只有 \`(id, type, content, summary, created_at)\`。**
⇒ 对**已退休行**（\`retired=1\`）重写同 id ⇒ 整行替换 ⇒ \`retired\` 回落 \`DEFAULT 0\`、\`strength\` 回落 \`0.5\`、\`vector\`/\`related_ids\` 归 NULL。
⇒ **「软删除可逆」被悄悄改成「可复活」，与边界④正面冲突**；现**无任何对拍**覆盖（\`grep 复活|resurrect packages/*/tests\` 无命中）。
⇒ **B3.2-W 一旦成为 \`writeMemoryItem\` 的第一个生产调用方，这条静默复活路径即被激活**。

**强制回归面**：\`writeMemoryItem\` 改**分列 UPSERT**（签名不变）+ **新增「重写不得复活 retired 行」负向对拍**。

---

## 八、每项的可机检判据

| 项 | 装配判据 | 行为判据 | **反证对拍（缺一不算过）** |
|---|---|---|---|
| **B3.2-R** | 按包名可解析 | Recall 三态可分辨（vector/lexical/degraded） | 去掉 \`degraded\` 标记 ⇒ 必红 |
| **B3.2-W** | 按包名可解析 | Write Gate 三类到达证据（judged/unavailable/budget） | **重写 retired 行 ⇒ 必须仍为 retired=1**（新增，§7.3） |
| **A1-5** | — | \`decay(14)=0.500000\` 三锚点逐字复现 | 改半衰期 ⇒ 必红 |
| **B7.1** | \`tools/a6-ablation.mjs\` 可跑 | 6 组各产指标差（不加假旋钮） | 对 \`packages/**\` 只读（该文件头已声明） |
| **A0-10** | — | 越界腿按**路径**判归属 | 写面并集外动一件 ⇒ 必红 |
| **A0-12** | 三件套在位 | 七腿逐条 | 篡改一件 ⇒ 必红 |

**证据格式**：\`命令 → exit code → 关键读数 → 与开工基线的差 → 取数坐标\`；**四态语义 PASS/FAIL/HANG/NONE —— 挂账与无实现者都不是 PASS**。

---

## 九、不可立即开工清单（诚实，非「以后再说」）

| 项 | 阻塞类型 | 依据 |
|---|---|---|
| **W-1..3**（vec0 三语义） | **结构性不可达** | 被边界③「禁装 sqlite-vec」冻结；C4 已定其 >10 万条才启用 ⇒ 固定记 **HANG** |
| **B7.1 跑数 / B7.2 加固** | 依赖「全部」 | 册面 \`rollout-plan.md:664-665\` 硬依赖 = 「全部」；现开工只能产出空跑分器 |
| **A0-12 收口** | **反身性** | 判据对象是 HEAD 区间，只要还有写者提交就会再红 ⇒ 只能最后做 |
| **Mana 装进活体 profile** | 前置债未清 | G9 当前**未触发**（活体 profile 未装任何 \`dsh-mana-*\`）；装上那天三条债同时生效（§10） |

---

## 十、装 profile 之前必须关闭的三条债（放行前置）

> G9 当前**潜伏**：\`~/.dsh/profiles/web/package.json\` 的 bundles 只有 \`dsh-shoucang-memory\`，**无任何 \`dsh-mana-*\`**。触发条件 = 「把 mana-attention 写进 profile bundles 并热重载」。

| # | 债 | 位置 | 后果 |
|---|---|---|---|
| 1 | **attention 跨会话单例状态** | \`attention/src/index.ts:144 pending\` / \`:146 injectedRequests\` / \`:156 injectedBlocks\` / \`:165 lastJudgeProbability\` 均**不按 sid 分区** | 并发会话下 A 会话候选注入 B 会话；**I2 变跨会话全局去重 ⇒ 判据假绿** |
| 2 | **waterfall 替换型返回值无 \`undefined\` 防御** | \`attention/src/index.ts:482-514\` 的 \`Array.isArray(downstream?.messages)?…:[]\` | 上游「调了 next() 但不 return」⇒ **宿主本步消息被整批吞掉**，与正常态同形 |
| 3 | **A0-10 基线口径与并行不相容** | \`tools/.a0-10-baseline.json\` \`expect=["docs/contract/"]\` | 并行下持续假红 ⇒ 越界腿永久失效 |

---

## 十一、诚实缺口（未验证，不得当 PASS）

- \`a0-check\` 全量耗时与峰值 RSS（**未测**）；
- \`r0-assembly-check\` 耗时（**未测**）；
- **8 席并发实测上限**（rollout 席自认给不出；本轮只给出**结构性上限**）；
- **Mana 与 shouchang 真链联跑**（仓外件，属 notDoing 面；现有「双链」判据是**自建桩**，非真链——\`next-call-surface.test.mjs:73-77\`）；
- \`learning\` 三件 lib/src 的**行为**对拍（只做到导出面相等）。

---

## 十二、待拍板（R3 越权面，未拍板不开工）

| # | 议题 | 选项 | 推荐 |
|---|---|---|---|
| 1 | **\`jev_log.gate\` 词表** | A 维持两值（未过阈走 \`result_value\`/\`probability\`/\`request_type\`，**零结构变更**）／ B 扩词表（须重建表迁移 M0–M4 + 回滚语义） | **A** —— A 无需动 CHECK，三处承载列实测都在；B 唯一收益是把「非降级语义」塞进按 \`degradation.md\` 定义为**降级归因**的列 |
| 2 | **若选 B：回滚语义** | A 覆盖式（丢迁移后新写入）／ B 反向迁移（点名被拒行） | **B** —— 覆盖式让「回滚」与「丢数据」同形 |
| 3 | **并行期是否冻结 HEAD** | A 冻结／ B 不冻结、每波头部重取 | **A** —— A0-12 判据对象就是 HEAD 区间，不冻结则该腿每提交必红，真回归与记账时点永久同形 |
| 4 | **W-1..3 转正** | A 解禁装 sqlite-vec 取 PASS/FAIL ／ B 维持禁装、固定记 HANG | **B** —— C4 已定 vec0 为 >10 万条才启用，为一个绿而装扩展违反边界③ |
| 5 | **HANG/NONE 是否设门内额度并强制列 id** | A 维持现状（只计数）／ B 设额度 + summary 强制列 id | **B** —— 现状「14/17」与「全绿」读数相近，事实差 3 项从未被验证 |
| 6 | **Mana 装进活体 profile** | A 先修三条债再装／ B 先装但只挂 core（attention 不挂）观察一轮／ C 接受桩证据直接装 | **B** —— core 不注册 \`agent/pre-step\`，能拿真 profile 读数而不触碰 shouchang 同点链 |

---

> **一句话**：并发上限是 **4 席写 + 1 席跑门**（结构性，非依赖）；单实例锁在本 harness 下**失效**，故跑门必须「一席跑、全席引用」；A0-10 的基线口径是并行推进的**唯一硬阻塞**，须在收口期按「全席写面并集」重取。
