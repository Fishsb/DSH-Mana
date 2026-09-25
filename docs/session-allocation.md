# Mana 多会话分工与接口契约设计

> **本档解决两个问题**：① 分几个会话、每个会话做什么（**按写面切，不按逻辑依赖切**）；② 会话之间靠什么交接（**冻结契约 + 交接单**，不靠口头约定）。
> **前置**：先读 `docs/plan-review-2026-09-24.md`（环境已漂 5 项，其中 `A0-1` 按原样执行必红）。
> **行号口径**：`册:N` = `docs/mana-rollout-plan.md` 物理行号。

---

## 〇、一句话结论

**分 6 个会话**：1 个契约席（S0，独占前置，串行）+ 4 个并行席（S1–S4）+ 1 个集成绩（S5，串行收口）。
**切分判据不是「谁依赖谁」，是「谁写哪些文件」**——逻辑上并行、物理上同写一个目录的两个批次，**必须合并到同一会话**（`B0.2 ∥ B0.3` 就是这种，见检查报告 L1-5）。

---

## 一、为什么不能照方案的 §10.1「13 个 Agent 一人一包」

`方案:735` 的分工表是**一插件一 Agent**，共 13 席。它有两个硬问题：

| 问题 | 实测/依据 | 后果 |
|---|---|---|
| **① 器件数 ≠ 席位数** | `册:733`（C2）：单个变更横跨 **5–6 包**（写 7 包 / 召回 5 包 / 巩固 4 包）；装配单元已收敛为 **3 个 patch + 1 个 client** | 13 席里**没有任何一席能独立交付一个可验证的纵向切片**——每席都得等 5 个邻居 |
| **② 逻辑依赖 ≠ 物理可并行** | `册:258` 的「可并行 8 项」是逻辑口径；但 `B0.3`（建骨架）在**物理上先于** `B1.0/B1.1/B1.2/B2.2/B5.1/B6.1`（后六者要往骨架里填实现） | 照 `册:277`「B0.2 之后同时可动 7 个批次」开工 ⇒ **7 个会话同时改不存在的目录** |

**⇒ 正确的切法是三层**：`根配置（1 写者） → 共享契约（冻结后只读） → 各包目录（互不相交）`。

---

## 二、波次表（按写面切，可直接执行）

```
W0 ── S0: B0.1 → B0.2 → B0.3            ← 独占，串行，全项目阻塞点
      ↓ 【门】契约冻结 + A0-12 快照哈希 + A0-5 形状可证 + R0 反证
W1 ── S0: B1.0(开库器)   S1: B5.1   S2: B1.2   S3: B2.2   S4: B6.1
      ↓ 【门】各自反证判据绿（卸载后不再产生新行）
W2 ── S1 → S1b?: B1.1(向量，依赖 B1.0)   S2/S3/S4 续作
      ↓ 【门】A1-4/A1-5/A1-12 确定性锚点 + A1-11 降级可区分
W3 ── S5: B2.1 端到端贯通（跨 4 包，独占）← 必须等 B1.1 + B1.2
      ↓ 【门】A1-1 seq 无洞 + A1-13/A1-14 fail-closed 留痕
W4 ── S1: B3.1 → B3.2（long-term，依赖 B1.1+B1.2）   S5: 收口 W3
W5 ── 并行: B4.1 / B4.2（依赖 B3.1）· B5.2（依赖 B5.1）· 阶段 6 收口
```

**关键读法**：
- **W0 无法并行**——`B0.1→B0.2→B0.3` 是硬串行，且 `B0.2`/`B0.3` 同写 `packages/core`（检查报告 L1-5）。**别在这一波开多个会话**。
- **W1 是唯一的高扇出点**：`册:277` 说的「7 路」在这里，且**必须先完成 B0.3**。
- **W3 的 `B2.1` 必须独占**：它跨 `perception`/`attention`/`working-memory`/`scheduler` 四包，是集成面。

---

## 三、写面所有权表（**并发纪律的机器可判依据**）

> 规则：**同一时刻，一个路径只有一个写者**。跨所有权写入 = 违约，须先交接所有权。

| 路径 | 唯一写者 | 何时冻结 | 备注 |
|---|---|---|---|
| `/package.json` `/package-lock.json` `/tsconfig.base.json` `/.gitattributes` | **S0** | — | ⚠ **只有 S0 可跑 `npm install`**（会改写 lock） |
| `packages/core/**` | **S0** | W1 起只读 | 契约真源；含 `B1.0` 的开库器 |
| `docs/contract/**` | **S0** | W0 结束即冻结 | 全员**只读** |
| `packages/vector/**` | **S1** | — | |
| `packages/jev/**` | **S2** | — | |
| `packages/scheduler/**` | **S3** | — | |
| `packages/metacognition/**` | **S1**（B5.1 期） | — | ⚠ 同一会话可轮换持有多个包，但**同一时刻只持一个** |
| `packages/perception/**` `packages/working-memory/**` `packages/attention/**` | **S5**（B2.1 期） | — | 集成面，禁止他人改 |
| `docs/handoff/<你的会话>.md` | 各自 | — | 一人一个文件，天然不撞 |
| `docs/plan-review-*.md` | 只读 | — | 本席产出，勿改 |

**两条硬规矩（来自既有教训「多会话共用工作树时写路径串行」）**：
1. **禁 `git add -A` / `git add .`** —— 会把别席的在途改动一起提交。只 `git add packages/<你的包>` + 你自己的 `docs/handoff/`。
2. **冻结期不 build 全局产物** —— 他席在途码会被编进你的产物，归属就乱了。要验，只 build 自己那个包。

---

## 四、接口契约（会话之间的「接口」在这里，不在口头）

> **契约的唯一载体是 `docs/contract/` 下的文件**，不是聊天记录、不是某席的记忆。**冻结一次，全员只读**；变更走 §五 的协议。

### 4.1 必须冻结的 8 件（`B0.2` 的交付物清单，`册:317`）

| # | 接口件 | 形态 | 消费者 | 变更代价 |
|---|---|---|---|---|
| **I-1** | **`Events` 接口**（S1 五类事件） | `packages/core/src/event-types.ts` 的 TS 类型 | **全体** | 改一处 ⇒ 编译期全量报错（这正是 `C13` 想要的效果，`册:740`） |
| **I-2** | **领域模型**（`Observation`/`Focus`/`JevJudgeRequest`…） | 同上 | 全体 | 同上 |
| **I-3** | **`inject_log` 表结构**（10 列 + `gate` 5 枚举） | `docs/contract/schema.md` + DDL | S5（验证）、S1（写入） | 改表 ⇒ 动已上线数据面（`册:343` A0-8） |
| **I-4** | **`mana_trace` 表结构**（含补 `session_id`/`turn_id`） | 同上 | 全体 | 同上 |
| **I-5** | **包 id ↔ name ↔ 服务名 映射表** | `docs/contract/naming.md` | 全体 | 三名混用是 `成因 B` 的根源（`册:317` ③） |
| **I-6** | **关联键统一 = `requestId`** | 写入 I-2 + naming | S2/S5 | 方案原用 `id`/`requestId` 两套（`方案:694` vs `方案:707`） |
| **I-7** | **开库器 API 签名** | `packages/core/src/db.ts` 的导出 | S1（向量）、S5 | 必须 `{allowExtension:true}` + WAL + busy_timeout（G4/G7，**不可后补**） |
| **I-8** | **「降级必须落显式字段」约定** | `docs/contract/degradation.md` | S1/S2/S5 | 禁 `catch{return null}`（G8，`册:174`） |

### 4.2 契约冻结的证明物（**没有它就不算冻结**）

`A0-12`（`册:347`）要求：对 `Events` + 领域模型取 **sha256** 存盘。
**建议同时冻结这三份清单**（只存哈希无法定位变化——既有教训原文）：

```bash
# 契约快照三件套，落 docs/contract/
sha256sum packages/core/src/event-types.ts > docs/contract/_freeze.sha256
# ⚠ 必须排 lib/（tsc 产物 + .gitignore 忽略项）：纳入则清单随「跑没跑过 build」漂移
find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/lib/*' | sort > docs/contract/_freeze.files.txt
git rev-parse HEAD > docs/contract/_freeze.head
```

**全员在开工前核一遍这个三元组**（哈希 + 文件清单 + HEAD）。三条腿都由 `A0-12` 机检
**真正读取**（只存不验 = 漂移不可见）：哈希腿逐字比对、清单腿与实际 `find` 结果 diff、
HEAD 腿比对 `git rev-parse HEAD`。哈希变了清单没变 ⇒ 先查 git 索引与暂存区，**别先怀疑对方**（既有教训）。

---

## 五、契约变更协议（`方案:767` 的可执行版）

方案写的是「提 PR → 架构评审 → 更新版本 → 更新 Mock → 通知各组 → 各组适配」。落到本仓（无 PR 流程、无 CI 服务器）：

| 步 | 动作 | 产物 |
|---|---|---|
| 1 | 在 `docs/contract/CHANGELOG.md` **追加一行**：`v0.1→v0.2 · 事件 X 加字段 Y · 申请人 S2 · 日期` | 变更记录 |
| 2 | **改契约的那一席独占 `packages/core`**（其余席暂停写 core） | — |
| 3 | 重取 `_freeze.sha256` 三件套，**旧值存档不覆盖** | 可回滚锚点 |
| 4 | 需要适配的席，在自己的会话里跑 `npm run typecheck` | **编译期报错即适配清单**（这是灰度分版的价值，`册:742` C11） |
| 5 | 全部绿后，在 `docs/handoff/` 各席记一行「已适配 v0.2」 | 对账 |

> **为什么靠编译器而不是靠通知**：`C13` 让 `core` 独占契约后，改一个事件签名**必然**产生全量编译错误（`册:740` 原话：「改后 1 文件 + 编译期全量报错」）。**编译器就是最可靠的「通知各组」**——别自建通知机制。

---

## 六、交接单（每个会话的出口标准）

每席在收工前写 `docs/handoff/<会话名>.md`，**固定 6 段**（缺段即视为未交付）：

```markdown
## S<n> · <包名> · 批次 <Bx.x>
- [ ] 交付文件：<逐条列绝对路径>
- [ ] 判据执行：<判据ID> · 命令 <原文> · 输出 <原文/退出码>
- [ ] 反证判据：卸载后同一触发不再产生新行 —— 实测结果 <原文>
- [ ] 回归自检：本次改动碰了哪些既有行为？凭什么确认它们仍成立？<一句话+证据>
- [ ] 未决项：<挂账清单，无则写「无」>
- [ ] 契约版本：已核 _freeze 三元组 @ <哈希前8位>
```

**为什么第 4 段不可省**：本仓明令「不接受以文件在长为通过依据」。**碰了别的行为却不说**＝静默回归，正是最该防的那类失败。

---

## 七、可直接粘贴的会话启动提示词

### S0 · 契约席（先开，其余会话等它）

```text
你是 Mana 项目的【S0 契约席】，独占执行阶段 0（批次 B0.1 → B0.2 → B0.3），并随后交付 B1.0 开库器。

工作目录：/home/lk/Mana
必读（勿改）：docs/plan-review-2026-09-24.md（环境已漂 5 项）· docs/mana-rollout-plan.md §4 阶段 0 · docs/session-allocation.md §三/§四
你的写面（唯一写者）：根 package.json / package-lock.json / tsconfig.base.json / .gitattributes / packages/core/** / docs/contract/**
禁写：packages/ 下其余任何包；禁 git add -A

开工第一步（不要跳过）：覆写 B0.1 的环境钉点 —— 实测本机 node v22.22.1 / npm 11.19.1 / pnpm 12.4.2 存在 / DSH 0.1.7-rc.1 / cordis 4.0.4 / profiles = headless,system,web。
⚠ A0-1 原写「v22.22.0 逐字相等」会假红；engines.node 用 ^22.22.0（见检查报告 L1-2）。
⚠⚠ **Node 必须是官方构建**（`/opt/nodejs/bin/node`，经 `/usr/local/bin/node` 接线）：Ubuntu 自带的 `/usr/bin/node` **编译时未启用 TypeScript 支持**，`import './x.ts'` 直接报 `ERR_UNKNOWN_FILE_EXTENSION` ⇒ 全仓 `import ../src/*.ts` 的测试**一条都加载不了**、而 `typecheck` 仍绿（假绿）。开工前先跑 `printf 'export const a: number = 1\n' > /tmp/t.ts && node -e "import('/tmp/t.ts').then(m=>console.log('TS-OK',m.a)).catch(e=>console.log('TS-FAIL',e.code))"` 须打印 `TS-OK 1`。详见 `docs/env-baseline.md` §2.0 与 `docs/mana-rollout-plan.md §A.2`。

完成定义：A0-1..A0-13 全绿 + R0 反证 + docs/contract/ 冻结三件套落盘 + docs/handoff/S0.md 六段齐全。
收工用一条消息汇报：契约冻结哈希 + A0-* 通过清单 + 未决项。
```

### S1 · 向量席

```text
你是 Mana 项目的【S1 向量席】。开工前提：S0 已交付冻结契约（docs/contract/_freeze.*）。
工作目录：/home/lk/Mana
你的写面：packages/vector/**（B5.1 期间可轮换持有 packages/metacognition/**，但同一时刻只持一个）
禁写：packages/core/**（只读）· 根 package.json · 任何他人包；禁 git add -A；禁 npm install（找 S0）

批次：B1.1 向量适配 —— 走纯 JS 通道，复用 /mnt/d/FF/shoucang/lib/vec.js 的 cosine(93)/embedMany(246)/recallRanked(289)；RRF 自实现 k=60；BLOB + 常驻 Float32Array。sqlite-vec 为可选加速，一旦启用必须承接 W-1/W-2/W-3（册:403）。
判据：A1-4 RRF 确定性（[1,1]=0.032787）· A1-5 衰减 · A1-11 降级可区分（degraded===true 且 gate 非空）· A1-12 dim==1024。
降级禁止 catch{return null} —— 必须落显式字段（G8；注意册引的 vec.js:254 是错的，真 catch 在 277-279，见检查报告 L1-3）。

碰了哪些既有行为、凭什么确认它们仍成立 —— 写进 docs/handoff/S1.md 第 4 段。
```

### S2 · JEV 席

```text
你是 Mana 项目的【S2 JEV 席】。开工前提：S0 已交付冻结契约。
工作目录：/home/lk/Mana
你的写面：packages/jev/**　　禁写：packages/core/**（只读）· 根配置 · 他人包；禁 git add -A

批次：B1.2 JEV 适配 —— 本机 Ollama logprob 单 token 原语：/api/chat + think:false + logprobs:true + top_logprobs:5 + num_predict:1 + temperature:0，从 pos0 取 yes/no 归一。
已实测可用：127.0.0.1:11434 可达，bge-m3:latest 与 qwen3.5:0.8b 均在库（qwen3.5:0.8b → yes=0.887/no=0.101）。
硬约束：串行 + 全局并发 ≤4 + 同 state-hash 缓存 + 每 session 预算上限；缓存 TTL 300s / 熔断 5 次 / 冷却 60s；降级必须落 degraded:true。
⚠ 方案 §6.4 的 Top-50 fan-out 不可达（实测 50 并发 5785ms，超目标十倍）⇒ 改分批 + 早停（G14）。
⚠ 模型选型：禁用 qwen3:8b（"yes"=1.000 饱和无区分度）。

出口：docs/handoff/S2.md 六段齐全（含第 4 段回归自检）。
```

### S3 · 调度席

```text
你是 Mana 项目的【S3 调度席】。开工前提：S0 已交付冻结契约。
工作目录：/home/lk/Mana
你的写面：packages/scheduler/**　　禁写：packages/core/**（只读）· 根配置 · 他人包；禁 git add -A

批次：B2.2 scheduler 目标栈 + SOAR 三阶段循环，并建 P1 四个骨架。硬依赖仅 B0.2。
注意：骨架的 apply 必须注册一条 waterfall 监听器并调 next()（把 G9 钉成结构约束，册:318）。
⚠ 实测（cordis 4.0.4）：emit 分发 waterfall 时，同步监听器抛 TypeError，而 async 监听器（方案 §9.4 正是 async）变成 unhandledRejection —— 静默得多。故必须加 unhandledRejection 计数断言（检查报告 L1-4）。

出口：docs/handoff/S3.md 六段齐全。
```

### S4 · UI 席

```text
你是 Mana 项目的【S4 UI 席】。开工前提：S0 已交付冻结契约。
工作目录：/home/lk/Mana
你的写面：packages/ui/**（含 client 半区）　　禁写：packages/core/**（只读）· 根配置 · 他人包；禁 git add -A

批次：B6.1 Client 半区面板。抄样板 dsh-plugin-roundtable（/mnt/d/lk/FF/dsh-plugin-roundtable）的 tsdown 双 entry；Client 与 Host 走 Package-private JSON 方法（harness.handle / host.call），只有无损 JSON 可跨界。
合规基线（册:620）：Host 入口体积同量级 ~4KB（不把面板逻辑塞进入口）· Client 单产物 · 不得引 node:fs/node:sqlite/process.env（A5-2 断言命中 0）。
⚠ R5：不得照抄 shoucang 的 /api/shoucang-panel/vector/status2 端点（那是 shoucang 的，卸 mana-ui 改不了它）⇒ 须自建产物侧落点（mana_trace 的 ui/render 行）。

出口：docs/handoff/S4.md 六段齐全。
```

### S5 · 集成绩（W3 才开工）

```text
你是 Mana 项目的【S5 集成绩】。开工前提：S1 的 B1.1 与 S2 的 B1.2 均已交付（看 docs/handoff/S1.md 与 S2.md）。
工作目录：/home/lk/Mana
你的写面：packages/perception/** + packages/working-memory/** + packages/attention/**（独占，因为 B2.1 跨这四包）
禁写：packages/core/**（只读）· 根配置 · S1/S2/S3/S4 的包；禁 git add -A

批次：B2.1 端到端事件流。⚠ mana/jev/judge 必须用 ctx.waterfall(...) 分发（用 emit 会炸，见上）；bail 判据是非 null/false/undefined（0/''/[] 也算 bail —— 方案 §9.3 行634 写的「非空」是错的）。
判据：A1-1 seq 连续无洞 + 五类 event_type 各 ≥1 · A1-13「没注入」必须可分辨 5 类枚举 · A1-14 fail-closed 不得吞掉「未判」（注入块 0 但 inject_log 仍须新增 gate='degraded_unavailable' 行）。

出口：docs/handoff/S5.md 六段齐全。
```

---

## 七点五、W1 实测回写 + W2/W3 并行派单（2026-09-24 收口轮 · S0 实测）

> **本节的作用**：§八 第 2 条要求「第一轮真实并发跑完后回来订正本档」。W1 四席已交付，
> 本节是**实测回写** + 下一波可并行任务的派单表。所有数字均为**本机实测**（命令与输出见
> `docs/handoff/S0.md` 与各席 handoff），不是设计推导。

### A. W1 实测回写（订正 §二/§三 的设计推导）

| # | 原设计 | 实测结果 | 处置 |
|---|---|---|---|
| 1 | 「新包免 `npm install` 即可落地」 | **类型检查成立**（新包靠根 `node_modules` 提升解析，`tsc` exit 0），**但装配不成立**：无 `node_modules/dsh-mana-<pkg>` 软链 ⇒ `import('dsh-mana-scheduler')` 报 `ERR_MODULE_NOT_FOUND`，真 Loader 装配**静默不生效**。 | **已修**：S0 跑 `npm install`（dry-run 确认只新增 7 条本地包、零网络拉取）建链；现 13 包中 10 个可按包名解析（余 3 个是 `lib/` 未构建的 P1 骨架，见 D 表）。 |
| 2 | 「契约冻结 ⇒ 全员只读」 | 成立，且**被验证席变异测试证实有效**：哈希腿逐字未变（`53c92707`/`3a80122b`）。 | 保留。 |
| 3 | §三 写面表「一人一包」 | 成立：W1 四席**零跨席写入**（各席 handoff 均有 `git diff --stat` 自证）。 | 保留。 |
| 4 | 未预料 | **闸（gate）自身是缺陷面**：验证席 `S-verify4` 用变异实验发现 4 处「归零不被察觉」形态（闸只普查不真跑、旧通道判据可整份删除、缺省端点可被换成云端而全绿、桩判据不验请求体）。 | 施工席已修（闸升为**四腿**：自检/静态/离线动态/显式红）；**口径修正**：闸的「模型依赖面普查」不得只报数，须**真跑一次断言 `fail ≥ 1 && skipped === 0`**。 |

### B. 当前实测状态（13 包矩阵）

| 包 | 性质 | 源码行 | `lib/` | 软链 | 测试 | 状态 |
|---|---|---|---|---|---|---|
| `core` | P0 | 1740 | ✅ | ✅ | 11 文件 91 例 | **已交付**（含 B1.0 开库器 + ACT-4 迁移 + ACT-15 历史表/触发器） |
| `jev` | P0 | 1856 | ✅ | ✅ | 3 文件 57 例 + 闸 | **已交付**（B1.2 原语/护栏/真通道，B1.3 框架） |
| `vector` | P0 | 956 | ✅ | ✅ | 1 文件 15 例 + 闸 | **已交付**（B1.1；vec0 三语义真机负例见 `tools/probes/vec0-semantics.mjs`） |
| `perception` | P0 | 118 | ✅ | ✅ | **0** | ⚠ **无测试**（W3 已接事件链：真发 `mana/observation`，源头） |
| `attention` | P0 | 345 | ✅ | ✅ | **0** | ⚠ **无测试**（W3 已接判定链 + Injection Gate 写入点） |
| `working-memory` | P0 | 146 | ✅ | ✅ | **0** | ⚠ **无测试**（W3 已在链上：消费 `mana/attention`、广播 `mana/working-memory`） |
| `scheduler` | P1 | 378 | ✅ | ✅ | 14 例 | 已交付（B2.2），**待接 B2.1** |
| `metacognition` | P2 | 1751 | ✅ | ✅ | 3 文件 21 例 | 已交付（B5.1） |
| `user-model` | P2 | 92 | ✅ | ✅ | 2 文件 12 例 | 骨架 + 判据（`user_model_history` 由 ACT-15 补上） |
| `ui` | P2 | 906 | ✅ | ✅ | 2 文件 17 例 | 已交付（B6.1；装配证据已接机检） |
| `long-term` | P1 | 74 | ✅ | ✅ | 8 例 | **仅骨架**（lib 已构建；待 W4） |
| `consolidation` | P1 | 74 | ✅ | ✅ | 8 例 | **仅骨架**（lib 已构建；待 W5） |
| `forgetting` | P1 | 74 | ✅ | ✅ | 8 例 | **仅骨架**（lib 已构建；待 W5） |

> ⚠ **本表订正说明（2026-09-25 实测）**：源码行改用 `find <pkg>/src -name '*.ts' | xargs cat | wc -l`
> 口径（含 `src/client/` 等子目录；旧的粗算法会漏子目录 ⇒ `ui` 曾因此被重算错）；测试列按
> `packages/<pkg>/tests/*.test.mjs` 的 `^test(` 计数。W3 波次（`acdcabe` 起）已把
> `perception`/`attention`/`working-memory` 接进事件链，故三者的「仅骨架」标注**已改为「无测试」**
> ——三包仍无任何测试文件，这是真缺口，不因接线而消失。

**全仓现状（实测，2026-09-25 · HEAD 98ae46c）**：`npm test` → **251/251 pass**；`npm run typecheck` → exit 0；
`node tools/a0-check.mjs` → **16 项 · 15 PASS / 0 FAIL / 1 挂账**；`r0-assembly-check` → **13/13 装配归零**（`N=13`）。

### C. W2 可并行派单（**关键路径已解锁**）

> **前置已满足**（S0 本轮实测解除）：① 7 个新包软链已建 ⇒ 可装配；② `lib/` 构建链可用；
> ③ 契约三件套三腿真核 ⇒ 各席可自信核对版本。

| 序 | 任务 | 承接席 | 写面 | 判据（可机检） | 依赖 |
|---|---|---|---|---|---|
| **W2-1** | **B1.2 补全**：缓存 TTL300/熔断5/冷却60/并发≤4/预算上限（S2 明令切窄后的欠账） | S2 | `packages/jev/**` | `node packages/jev/tests/gate.mjs` exit 0；`cached` 列**真出现 1**（现恒 0）；熔断判据：第 6 次失败**不再发起请求**（请求计数不开）；并发峰值 ≤4（桩可数） | 无（B1.2 原语已在盘） |
| **W2-2** | **A1 判据机检入口**：把散在各包测试里的 A1-4/A1-5/A1-11/A1-12 汇总成一个 `tools/a1-check.mjs`（现**只有 A0 级入口**，A1 级无） | **S0** 或专职 | `tools/**` | `node tools/a1-check.mjs` 逐项 PASS/FAIL；**负向自证**：故意改坏 RRF k 值 ⇒ 该判据红 | 各包测试已是真源 |
| **W2-3** | **UI 面板真装配**：`ui` 现只在测试里验证渲染，未接 profile 运行态 | S4 | `packages/ui/**` | A5-2：对 client 产物 grep `node:fs|node:sqlite|process.env` **命中 0**；单产物；Host 入口 ~4KB 量级 | 软链已建（本轮） |
| **W2-4** | **user-model / metacognition 接线**：两包已交付但无消费方（B4.x 才接） | S1 | `packages/user-model/**`、`packages/metacognition/**` | 现判据 + 新增「消费方调用后 `user_model` 表真增行」 | 无 |
| **W2-5** | **P1 三骨架补 `lib/` 构建**：`long-term`/`consolidation`/`forgetting` 无 `lib/` ⇒ 按包名不可解析 | 任意席（互不重叠） | 各自包 | `npm run build --workspace dsh-mana-<pkg>` exit 0；`node -e "import('dsh-mana-long-term')"` 不报 `ERR_MODULE_NOT_FOUND` | 无 |

### D. W3 关键路径（**必须独占，不能并行**）

| 序 | 任务 | 承接席 | 写面 | 判据 | 依赖 |
|---|---|---|---|---|---|
| **W3-1** | **B2.1 端到端事件流**：`perception → attention → working-memory → scheduler → action`（现 `perception`/`working-memory` 仅骨架，链**有断点**） | **S5 独占** | 这四包 | `A1-1`：五类 `event_type` 各 ≥1 且 `seq` **连续无洞** | W2-1 + W2-2 |
| **W3-2** | **Injection Gate 实现**（`inject_log` 表已建但**从无生产侧写入**；`agent/pre-step` 全是直通） | S5 独占 | 同上 | `A1-13`：`gate` 恒落 5 类枚举之一，且 `gate='injected'` 至少 1 次；`A1-14`：JEV 不可用时注入块 **==0** **且** `inject_log` 仍新增 `degraded_unavailable` 行 | W3-1 |

> ⚠ **W3 不可并行**：`B2.1` 跨 `perception`/`attention`/`working-memory`/`scheduler` 四包
> （`session-allocation` §二 原文），同目录两写者必然打架。

### C′. W2/W3 完成回写（2026-09-25 实测 · 订正 C/D 两表的「现状」措辞）

> 上表 C/D 是**派单时的设计基线**，其「现状」措辞已过时；此处按实测回写，**不改原表文字**。

| 序 | 派单时写的现状 | 实测（2026-09-25） | 落点 |
|---|---|---|---|
| **W2-1** | 「`cached` 列现恒 0」 | **已完工**：`framework.ts` 落地 TTL300/熔断5/冷却60/并发4/预算200 五面；`packages/jev/tests/gate.mjs` exit 0（四腿）；`cached` 0→1 有断言 | `packages/jev/src/framework.ts`（`bfa3b57` 前后） |
| **W2-2** | 「只有 A0 级入口，A1 级无」 | **已完工并扩到 15 项**：`tools/a1-check.mjs` 有**项集等式**（集合对拍，缺项/多项皆红）+ `--mutate` 变异自证腿；已接进 `a0-check` 门链（`npm run check:a1`） | `tools/a1-check.mjs`、`tools/a0-check.mjs` |
| **W2-3** | 「只在测试里验证渲染，未接 profile 运行态」 | **已完工**：`packages/ui/tests/assembly.test.mjs` 走真 Loader（计数 1→2→0）；client 产物禁词判据改用 `packages/ui/scripts/check-client-api.mjs`（AST+TS scanner，**不再用裸 grep**——原 grep 计注释，属假阳性） | `packages/ui/**`、`tools/a1-check.mjs` 的 `uiAssembly` 腿 |
| **W2-4** | 「两包已交付但无消费方」 | **裁定：本轮不接线**（消费方 = Injection Gate，属 W3-2/S5 独占写面）；就地修掉 1 处真缺陷（schemastery 的 `.default(null)` 被静默丢弃 ⇒ `precisionTarget` 在真宿主路径下为 `undefined`） | `packages/{user-model,metacognition}/src/index.ts` |
| **W2-5** | 「三骨架无 `lib/` ⇒ 按包名不可解析」 | **已完工**：三包 `lib/` 已构建且真导出 `apply,inject,name`（根因是「从没跑过 build」，构建配置本就正确） | `packages/{long-term,consolidation,forgetting}/` |
| **W3-1** | 「`perception`/`working-memory` 仅骨架，链有断点」 | **已接通**：`perception` 真发 `mana/observation`；`working-memory` 消费 `mana/attention` 并广播 `mana/working-memory`；判定链走 `ctx.waterfall` | `packages/{perception,attention,working-memory,core}/**`（`acdcabe` 起） |
| **W3-2** | 「`inject_log` 从无生产侧写入；`agent/pre-step` 全是直通」 | **已实现**：五类 `gate` 枚举全部接通生产侧（此前 3/5 可达）；`inject_log` 有真写入点 | 同上（`b3fa4cb`） |

> **落地后仍存在的真缺口（不因接线而消失）**：`perception`/`attention`/`working-memory` **三包零测试文件**
> （见 §B 表）；`r0-assembly-check` 的覆盖核对仍可被「协调性同时删清单行+盘上目录」绕过
> （现由 `A0-12` 清单腿间接兜住，属语义错位，已记账）；`a1-check` 的 `ARTIFACTS` 腿是 **mtime 代理**
> 且**只扫 `src/` 顶层**（非递归）⇒ `src/client/` 这类子目录的改动**不被计入**。

### E. 立即可并行 vs 必须串行（一句话）

- **可并行**：W2-1…W2-5 之间**写面互不相交**，可同时开工。
- **串行**：W3-1 → W3-2（同写四包，且 W3-2 依赖 W3-1 的事件链先通）。
- **门**：进 W3 前须 `A1-4/A1-5` 确定性锚点绿 + `A1-11` 降级可区分（`册:285` M1）。

---

## 八、本设计的已知约束（不藏）

1. **W0 是纯串行瓶颈**，无法靠加会话压缩——它与 `册:277` 的「7 路并行」是**同一件事的两端**。
2. ~~**本设计未经验证**：Mana 尚无源码，上述写面所有权是基于「批次→包」的**设计推导**，不是实测。第一轮真实并发跑完后须回来订正本档。~~ **✅ 已订正（2026-09-24）**：见 §七点五 A 表 —— W1 四席已跑完，写面切分成立（零跨席写入），但发现「免 `npm install`」这条前提只对类型检查成立、对**装配**不成立。
3. **未覆盖**：阶段 3–6 的会话分配（依赖 B2.1 的真实形状），待 W3 收口后再排。
4. **环境漂移未回写进方案正文**：`docs/plan-review-2026-09-24.md` 只记录，未改 `mana-rollout-plan.md`（该册的订正权归用户，见 §四 两件拍板项）。
