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
find packages -name '*.ts' -not -path '*/node_modules/*' | sort > docs/contract/_freeze.files.txt
git rev-parse HEAD > docs/contract/_freeze.head
```

**全员在开工前核一遍这个三元组**（哈希 + 文件清单 + HEAD）。哈希变了清单没变 ⇒ 先查 git 索引与暂存区，**别先怀疑对方**（既有教训）。

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

## 八、本设计的已知约束（不藏）

1. **W0 是纯串行瓶颈**，无法靠加会话压缩——它与 `册:277` 的「7 路并行」是**同一件事的两端**。
2. **本设计未经验证**：Mana 尚无源码，上述写面所有权是基于「批次→包」的**设计推导**，不是实测。第一轮真实并发跑完后须回来订正本档。
3. **未覆盖**：阶段 3–6 的会话分配（依赖 B2.1 的真实形状），待 W3 收口后再排。
4. **环境漂移未回写进方案正文**：`docs/plan-review-2026-09-24.md` 只记录，未改 `mana-rollout-plan.md`（该册的订正权归用户，见 §四 两件拍板项）。
