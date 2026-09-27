# VERIFYING 回路设计（执行-诊断-验证）· 只读设计档

> **卡**：`t-mujpp159-2m224i`（只读设计；**本席不写任何 `packages/**`**）
> **分支**：`task/VERIFYING设计+t-mujpp159-2m224i`
> **唯一写面**：本文件
> **取数坐标**（并发纪律 §3 四项齐）：
> commit `706a1e5` · node `v22.22.1` · `NODE_USE_ENV_PROXY=1`
> checker-md5 `a0-check.mjs=6baaf3c8e797f17d6382f79ed17faa32` / `a1-check.mjs=4d79b0873b603c00d85f53d7871e8287` / `packages/scheduler/verify.mjs=08372f43348ba1893d90b1968f95c3e5`
> 时刻 `2026-09-27T19:16+08:00`（后续复跑见各节）
>
> **本文的边界（先读这条）**：本文写的是**本仓怎么落**，不是 v10 §19 的转述。
> 结论给 `文件:行号`；**读的是声明/源码，不是运行态** ⇒ 凡"真跑过一次才成立"的一律记入 §6 未验证项。

---

## 0. 一句话结论

1. **缺口是真的，且不止"缺充足度通道"**：`VERIFYING` 在本仓**无对应**，其根因是**没有任何一条链消费"本回合的执行结果"**（§1）。
2. **"验证不通过 ⇒ 退回"在本仓有一条现成的宿主通道**：不是改回执类型（三条路全堵死），而是 `agent.steer()`（宿主自述+宿主实现，§3.2）。代价是**会真的改变宿主回合行为**，故必须缺省关 + 有界。
3. **`RESULT_CLASSIFICATION_PROMPT` 转正不是改一个布尔**：它被**契约层**挡住 —— `JevJudgeResult.value` 只有三值，5 路 choice 答案会被**主动折成 `'unknown'`**（§3.3）。
4. **第一刀不建议碰"退回"**：第一刀只落**一条可数的验证行**（含"没有结果可验"这一态），把不可见的缺口变成可数的读数（§5）。

---

## 1. 缺口完整清单（每条给 `文件:行号`）

### 1.1 已验证成立（本席复验）

| # | 缺口 | 证据（文件:行号） | 本席复验方式 |
|---|---|---|---|
| G1 | **驱动者的标签集里无 verify/result 类** | `packages/scheduler/src/chains.ts:82-114`（`TRACE_EVENTS` **恰好 10 个键**：encoding/retrieval/consolidation/reconsolidation/forgetting/learning/generation/distillation/coverage/error） | 逐行数 `:82-114` 的键行；全仓 `grep TRACE_EVENTS` 在 `packages/scheduler/tests/` **0 命中** ⇒ **该键集未被任何判据钉住**（这一点对 §5 的切片成本很关键） |
| G2 | **七链条口径表无"验证"行，且被钉死** | 表体 `chains.ts:311-379`；钉死腿 `packages/scheduler/tests/chains-e2e.test.mjs:489`（`SEVEN_CHAIN_TABLE.length === 7`）、`:491-494`（id 与顺序逐字）、`:508`（`sched.chains().length === 7`）、`:514`（`cov.rows.length === 7`） | 读四条断言原文 |
| G3 | **`RESULT_CLASSIFICATION_PROMPT` 定义在册但不得接线** | 定义 `packages/prompts/src/itacl.ts:24-33`；注册表 `wired:false` `packages/prompts/src/registry.ts:94`；`wired` 字段语义原文 `registry.ts:56`；机检腿 `packages/prompts/tests/prompts.test.mjs:297-307`（⑥）与 `:309-324`（⑥b）；服务面 `packages/prompts/src/index.ts:80-82`（`unwired` 计数）、`:101-102`、`:124` | 逐行读；全仓 `grep RESULT_CLASSIFICATION_PROMPT`（排除 node_modules 与 lib/）**共 10 处**，无一处是运行时消费者 |
| G4 | **`turn-stopping` 是 serial 型、回执 void** | 宿主声明 `node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:385-391`（`@mode serial`，返回 `Promise<void> \| void`）；宿主 await `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:984`；本仓驱动者接口 `chains.ts:778`（`onTurnBoundary(payload): Promise<void>`）、实现 `:1314` | 读宿主声明 + **读宿主真实实现体**（agent-loop 的 `turn()` 循环） |
| G5 | **驱动者的 `ctx.on` 包装层还会再吞一次返回值** | `packages/scheduler/src/index.ts:289-296`（`async (payload) => { try { await driver.onTurnBoundary(payload) } catch ... }` ⇒ 回调本身不 return） | 读源码 |
| G6 | **§18.2 的 `tool-result` 行自述"无源可接"** | `chains.ts:320-329`（`hostTrigger: null` + `notDrivenReason`："工具结果落 session log 的 tool/result …**不是 ctx 事件** ⇒ 本驱动者无源可接（不伪造）"） | 读原文。⚠ 本席另发现：**"不是 ctx 事件"与"读不到"是两件事** —— 见 §5.1 的 `session.snapshotEvents()` 面 |
| G7 | **`agent/error` / `agent/request-error` 本仓零监听** | 声明 `runtime-types.d.ts:402-407`（emit）/ `:348-356`（waterfall）；本仓生产侧 `ctx.on` 实测集合 = `mana/observation`(4) / `mana/attention`(2) / `agent/pre-step`(2) / `mana/jev/judge`(1) / `mana/injection`(1) / `mana/decision`(1) / `agent/turn-stopping`(1) / `agent/inbox/inserted`(1) / `agent/disposed`(1) —— **无 `agent/error`、无 `agent/request-error`** | `grep -rho "ctx\.on('[^']*'" --include=*.ts packages/*/src/ \| sort \| uniq -c`（结果见上）；与勘察席结论一致 |

### 1.2 v10 §19.4 九条转移的对应性（采纳勘察席结论，本席复验其**依据**成立）

**采纳**：无对应 7 · 半对应 2 · 完全对应 0（`docs/mana-itacl-and-thresholds-recon.md:80-96`）。
本席**复验的是依据而非数字**：该表的每条"无对应"都指向本清单 G1–G7 中的具体一条，逐条成立。

**并采纳该报告的订正**（`docs/mana-itacl-and-thresholds-recon.md:96`）：
v10 自述「9 条全因缺充足度通道」（`docs/mana-v10-status-plan.md:1055-1063`）**不准确** ——
`#4`(failure/anomaly→DIAGNOSE) / `#6`(任务完成→VERIFYING) / `#8`(DIAGNOSE→ACTING) 缺的是**整个执行-诊断-验证回路**（G1+G6+G7），补上充足度通道这 3 条**依然无对应**。

### 1.3 本席**新增**的缺口（勘察席未列出，逐条有证据）

| # | 新增缺口 | 证据（文件:行号） | 为什么算缺口 |
|---|---|---|---|
| G8 | **5 路结果分类被三值契约结构性地压掉** | 契约 `packages/core/src/domain.ts:149-156`（`JevJudgeResult.value: 'yes' \| 'no' \| 'unknown'`）；唯一监听器 `packages/jev/src/index.ts:531`，收窄点在 `:560`（`value: outcome.value === 'yes' \|\| outcome.value === 'no' ? outcome.value : 'unknown'`） | `RESULT_CLASSIFICATION_PROMPT` 的 criteria 是 **5 值**（`itacl.ts:27-33`：success/failure/anomaly/uncertain/partial）。即便把 `wired` 改成 `true` 并真去问 `mana/jev/judge`，**答案回到调用方时已被折成 `'unknown'`** —— 「判了」与「没判」在返回值上同形。**这是转正的真实阻塞点，不是 flag** |
| G9 | **新拉一条判据会改既有 `jev_log` 读数的口径已被本仓自己点名"须另开一批"** | `packages/jev/src/index.ts:550-556`：「不转发 `requestType`/`source` … 转发会**改变既有调用方（attention）的落库行** … 属需拍板项，须另开一批」 | 验证链若走 judge，必然新增 `jev_log` 行；若还要带 `request_type`/`source`，就撞上这条**既有裁定**。设计必须显式选择"不带归属列"或"另开一批" |
| G10 | **`generation-chain.test.mjs` 未进外部防线** | `packages/scheduler/verify.mjs:36-39` 的 `EXPECTED` 只登记两个文件；盘上第三个测试文件 `packages/scheduler/tests/generation-chain.test.mjs`（`EXPECTED_CASES = 8` 在 `:36`，`grep -c "^test(" = 9`）**未登记**；全仓 `grep generation-chain` 在 `packages/*/verify.mjs` 与 `tools/` **0 命中** | 与 `verify.mjs:16-19` 自述的扩面理由（"新文件被清空/截断时没有任何东西会报"）**同一条病因复发**。任何新增验证用例若落在这个文件里，**外部防线不会报** |
| G11 | **`fakeAgent` 夹具只造 `{session:{id}}`，不含 `steer`** | `packages/scheduler/tests/chains-e2e.test.mjs:72-74` | §3.2 的退回通道依赖 `payload.agent.steer`。**测试侧会静默拿到 undefined**（若实现不显式判空，则退化为"退回通道在测试里没跑过却全绿"） |

### 1.4 「未发现」的部分（不凑数）

- **未发现**「v10 §19.3 的 12 个状态名在本仓有独立 token」：勘察席实测 12 个全 0（`docs/mana-itacl-and-thresholds-recon.md:23-27`），本席未重复跑，**不另立条目**。
- **未发现**「`agent/pre-step` 有第三态（充足度）被漏读」：`runtime-types.d.ts:92-99` 是二值联合，无第三分支。这是**宿主契约事实**，不是本仓缺口。

---

## 2. 设计方案总览（本仓怎么落）

### 2.1 结论先行

| 问题 | 本设计的选择 | 一句话理由 |
|---|---|---|
| 验证语义挂在哪？ | **新链 + 新 trace 标签**，挂在**既有 `agent/turn-stopping`** 上（async、不 await） | 见 §2.2 的三候选评估 |
| 要不要加 Mana 事件？ | **第一刀不加** | 加事件 = 改 `core/event-types.ts` + `domain.ts` ⇒ 两份文件都在 `_freeze.sha256` 里（§4.2） |
| 要不要进七行表 / coverage？ | **不进**（照 `DISTILL_CHAIN_ROW` 先例） | 进表即撞 T10 四条钉死断言（G2） |
| "退回"怎么办？ | **第一刀不做**；第二刀用 `agent.steer()` + 缺省关 + 每回合有界 | 见 §3.2 |
| `wired:false` 怎么转正？ | **先有消费者，再改 flag**，且必须同时改契约与两处机检腿 | 见 §3.3 |

### 2.2 「验证语义该挂在哪」——三候选逐条论证

**候选 A：新增 Mana 事件（如 `mana/verification`）**
- **成本**：事件名与载荷类型必须落 `packages/core/src/event-types.ts`（`:30-61` 的 `declare module`）与 `packages/core/src/domain.ts`。**这两份文件正是 `docs/contract/_freeze.sha256` 的全部 2 行**（`docs/contract/_freeze.sha256:1-2`，本席 `wc -l` = 2 且逐字节复算相等）。
- **收益**：零 —— `emit` 型事件**同样没有回执**（`event-types.ts:33-42` 五类全是 `@mode emit`），买不到"退回"通道。
- **裁定**：**否**。用最大的契约成本换最小的收益。

**候选 B：新链（新 trace 标签 + 驱动者内一个新链任务）**
- **先例**：`chains.ts:381-408` 的 `DISTILL_CHAIN_ROW` —— 形状同源（`SevenChainRow`）、字段逐条齐，但**刻意不并进七行表**，理由逐字写在 `:384-393`：「并进去 = 篡改那张表的口径，并会让 T10 变红 —— 那是**拆东墙补西墙**」。这正是本设计要复用的先例。
- **成本**：`chains.ts` 是**已在** `_freeze.files.txt:68` 的文件 ⇒ 改它**不动清单腿**（文件仍在），也**不动哈希腿**（哈希腿只钉 `event-types.ts`/`domain.ts`）。
- **裁定**：**是**。

**候选 C：直接加在既有 `turn-stopping` 上（不再起新标签，混进已有行）**
- **先例反对**：`chains.ts:95-100` 明写"生成链与巩固链**分开一条事件名**是刻意的：混在一行里，「巩固判定跑没跑」与「生成调没调」就同形"。蒸馏链同理（`:102-109`）。
- **裁定**：挂点用 `turn-stopping`（同意），**但必须独立标签**（不同意混行）。

**⇒ 最终落法 = B 的标签 + C 的挂点**：在 `TRACE_EVENTS`（`chains.ts:82-114`）新增第 11 个键 `verification: \`\${DRIVER_NAMESPACE}/verification\``，在 `onTurnBoundary`（`:1314`）里作为一个**新链任务**发起。

**与既有七链条的关系（必须说清）**：
- 七链条是**记忆生命周期**（编码/检索/巩固/再巩固/遗忘/学习/生成+蒸馏）；验证链是**执行结果判定** —— **不同族**。故它以"并列"身份存在，**不冒充**七行中的任何一行，**不进 `coverage()`**（`:995-1046`，T10 `:508/:514` 钉死恰好 7 行）。
- 与 `coverage` 行的关系：**不落 coverage**。验证链的运行态由**它自己的** trace 行 + `DriverReadings`（`chains.ts:614-648`）承载 —— 与蒸馏链选择"有自己的读数、不冒充覆盖率行"完全同源（`:391-392`）。

### 2.3 链体设计（第一刀的口径）

**触发**：`onTurnBoundary` 内，**在 `noteActivity` 之前**（`:1560`）—— 理由与蒸馏链的排序注释同源（`:1326-1328`）。

**时序**：**必须不 await**。`turn-stopping` 由宿主 await（G4），真走一次 LLM 往返会把宿主卡在网络调用上 —— 这条理由本仓已写过两遍（`chains.ts:1213-1217` 生成链、`:1544-1549` 蒸馏链），本设计**照抄既有取舍、不另发明**。

**三态纪律（每一态各有自己的 status，不得硬写一个）**：照 `chains.ts:1331-1333` 的既有教训（"硬写会让「开关关着」与「没到点」在库里同形"）。至少需要可分辨的：
- `disabled`（开关关着，**不是**"没结果可验"）
- `no-session-identity`（`resolveSessionId` 返回 undefined，`:669-675`）
- `no-result-material`（**本回合没有可验的执行结果** —— 第一刀的诚实态，见 §5.2）
- `unassembled`（判定通道未装配；用**非空 reason 点名缺哪个服务**）
- `pending` → `ran` / `degraded` / `threw`（两行同 `trigger` 可配对，使"发起了没回来"可分辨 —— 照 `:1250-1262` 生成链的 dispatched/settled 形态）

**读数**：`DriverReadings` 增加**分列**计数（照 `:624-647` 蒸馏链的写法）：`verificationScanned` / `verificationDispatched` / `verificationSettled` / `verificationErrors` / `lastVerification`。**「扫描了」与「发起了」必须分列** —— 合并会让"链在跑但一直没材料"与"链压根没接"同形（`:626-629` 的原文理由）。

**旋钮**：任何新旋钮**必须同时**落三处，否则按本仓 "假旋钮" 纪律（`chains.ts:569-571`：**每一个旋钮都必须改变可观测行为**）不成立：
① `DriverConfig`（`chains.ts:570-611`）；② `packages/scheduler/src/index.ts:53-93`（`Config` schema + 缺省）；③ **`index.ts:168-182` 的 `createChainDriver` 实参必须转发**。
⚠ 第 ③ 点是**已具名的坑**：蒸馏链的四个旋钮**刻意不转发**，其后果被显式登记在 `chains.ts:593-602`（"在 profile 配置里写它们**不会**生效"，由 `distill-wiring.test.mjs` ⑥ 断言）。**验证链的开关不得复制这个坑** —— 它是"生产可调项"而非"装配层判据专用项"。

---

## 3. 三个关键问题的逐条回答

### 3.1 验证语义为什么不挂在 `agent/pre-step`

三条硬事实（每条有行号）：
1. `agent/pre-step` 是 **step 级**（`runtime-types.d.ts:299` 的 `payload.step` 存在），**不是"结果产生后"**；
2. 它的回执是**二值**（`runtime-types.d.ts:92-99`：`{kind:'reject'}\|{kind:'enter',messages}`），**无"充足度"、无"验证结论"通道**；
3. "结果"（tool/result 或 assistant message）在**该 step 提交之后**才进入会话日志（`dsh-session/lib/types/types.d.ts:374` `tool/result`），pre-step 时点**结构上看不到它**。
⇒ 把验证挂 pre-step 只能验"输入够不够"，验不了"上一步的结果对不对"。

### 3.2 「验证不通过 ⇒ 退回」的通道：代价分析与替代方案

#### 3.2.1 先说**不通**的路（三条全堵死，逐条给证据）

| 路 | 为什么不通 | 证据 |
|---|---|---|
| 改 `onTurnBoundary` 返回类型 | 宿主声明就是 `Promise<void> \| void` | `runtime-types.d.ts:391` |
| 让 listener `return` 一个"退回"值 | ① 本仓包装层不 return（G5）；② 宿主 `dispatch.serial` 的返回**不被循环消费** | `index.ts:289-296`；`dsh-agent/lib/index.js:264-267`；宿主循环只 `await` 不看返回值 `dsh-agent-loop/lib/index.js:984-990` |
| 用 `agent/cancel` 之类的强干预 | 会把整条回合判为 aborted（`AgentCancelCause`），语义是"取消"不是"退回重做" | `runtime-types.d.ts:150-157` |

**⇒ 直接"改成能退回"确实会动别人的行为，而且动的是宿主，不是本仓** —— 这条路**本设计不建议走**。

#### 3.2.2 再说**通**的路：`agent.steer()`（宿主自述的替代面）

**宿主自述**（`runtime-types.d.ts:370-380`，`turn-stopping` 的文档注释原文）：
> "Awaited before the boundary commits — a listener that objects **steers** (`agent.steer(...)`) and the machine **re-reads its inbox**: fresh steering runs another step, none closes the turn."

**宿主实现（本席实读实现体，不是只读声明）**：
- `dsh-agent-loop/lib/index.js:984-990`：
  `await this.dispatch.serial("agent/turn-stopping", …)` → `if (turnEnds && this.inbox.nextStep.length === 0) break;`
  ⇒ **steering 写进 `inbox.nextStep`，循环就不 break，跑下一个 step**。
- `steer` 的实现 `dsh-agent-loop/lib/index.js:809`：`steer(input) { this.send(input, "next-step", true); }`
- `agent` 对象从哪来：`turn-stopping` 的 payload **自带 `agent`**（`runtime-types.d.ts:387-390`）。

**⇒ 结论：不回改回执、不动宿主契约，"退回重做"在本仓是可表达的。** 通道名 = `payload.agent.steer(createUserMessage({...}))`。

#### 3.2.3 `steer` 方案的**代价**（逐条，不许省）

| # | 代价 | 证据 / 为什么 |
|---|---|---|
| C1 | **真的会多跑一个模型 step**（多一次 LLM 往返、多一次工具调用面） | 宿主 `index.js:990` 的 break 条件 |
| C2 | **会动别人的行为，且是连锁的**：新 step 会再过 `agent/pre-step`（`index.js:902` `async preStep`，派发点在 `:913-920` 的 `dispatch.waterfall("agent/pre-step", …)`）⇒ `attention` 的 Injection Gate（`packages/attention/src/index.ts:817`）会再判一次、`working-memory` 会再消费一次 `mana/attention`（`packages/working-memory/src/index.ts:413`） | 三处监听器行号 |
| C3 | **无界退回 = 活锁**（"验证总不过 ⇒ 永远再跑一步"） | 本仓有同型先例与解法：`vector/src/bigloop.ts` 的"收敛可判定 + 硬上限防活锁"（提交 `5925c45`）。**上界必须进 payload 且丢弃可数**（照 `chains.ts:573-578` 的 `bufferDropped` 纪律） |
| C4 | **消息必须用宿主构造函数**，手搓 `{role,content}` 会被宿主拒绝或**静默丢弃** | 既有实测教训：`packages/attention/src/index.ts:1233`、`packages/llm/src/index.ts:206-219`（`manaUserMessage` 是唯一出口兼唯一入口） |
| C5 | **测试夹具要扩**：`fakeAgent` 只有 `{session:{id}}`（G11） ⇒ 不退化的实现必须**显式判空**并把"无 steer 面"记成独立 status（否则测试里退回通道从没跑过却全绿） | `chains-e2e.test.mjs:72-74` |
| C6 | **它会改变"回合已结束"这件事对用户的可观测形态**（用户看到模型又说话了一次） —— 这属于产品行为变更，**须用户拍板**，不是工程自决 | 本仓口径：改既有可观测面 = 需拍板（`jev/src/index.ts:550-556` 同型裁定） |

#### 3.2.4 替代方案（按代价升序，本设计推荐序号 ①）

| 序 | 方案 | 代价 | 换来什么 | 推荐 |
|---|---|---|---|---|
| ① | **只记账不退回**：落一行 `verification`，verdict 进 payload；退回动作留给用户/下一回合 | **最低**（不动宿主、不加 step） | 把 G1/G6/G7 的缺口从"不可见"变成"可数"；满足本仓"失败必须可观测"的第一优先 | ✅ **第一刀** |
| ② | ①+ `steer` **但缺省 `false`**，开启后每回合最多 N 次 | 中（C1–C6 全部） | 真闭环，但仅在显式开启的会话上 | 第二刀 |
| ③ | ①+ 在 `turn-stopping` 里**同步**判并直接退回 | 高（**阻塞宿主回合**，违反 `chains.ts:1213-1217` 已写明的取舍） | 无额外收益 | ❌ |

### 3.3 `RESULT_CLASSIFICATION_PROMPT` 从 `wired:false` 转正需要什么

**结论：需要的不是改一个布尔，而是四件事按序做完。**

**（0）先解决 G8：契约层装不下 5 路答案。**
`JevJudgeResult.value` 只有三值（`domain.ts:149-156`），唯一监听器在 `jev/src/index.ts:560` 把"非 yes/no"**一律折成 `'unknown'`**。⇒ 经 `mana/jev/judge` waterfall 走这条路，**答案必然被压掉**。
**两条出路**：
- (a) 改 `JevJudgeResult`（**动 `domain.ts` ⇒ 动 `_freeze.sha256`**，见 §4.2）；
- (b) **不走 judge**，走 `mana-llm` 的 `generate()`（`packages/llm/src/index.ts:178` 服务面）+ `mana-prompts` 模板，自己解析 5 路字符串。**不动契约**，且与生成链/蒸馏链的既有通道同源（`packages/consolidation/src/generation.ts`）。
**本设计推荐 (b)** —— 成本更低且不碰冻结面。

**（1）先有真消费者，再改 flag。**
「注册表里有」≠「生产在用」是**本仓首位缺陷类**（卡面原文）。实证：`SAFETY_GATE_PROMPT` 是 `wired:true`（`registry.ts:91`）但**零运行时消费者**（全仓 6 处引用 = 定义 1 / import 1 / 注册表 1 / re-export 1 / 判据 2，无调用点）。
⇒ **若先翻 flag，"接线"就是假的**。正确顺序：链先真调它 → 再改 `wired`。

**（2）改 flag 必须同步改**两处机检腿**（否则必红）**：
- `packages/prompts/tests/prompts.test.mjs:297-307`：`UNWIRED_PROMPT_NAMES` **集合相等**断言（`:298`）与 `status().unwired` 断言（`:306`）；
- `prompts/src/registry.ts:14-17` 与 `packages/prompts/src/itacl.ts:4-8` 的文件头（"ITACL 不移植、不得接线"）—— 不改则**注释与事实不符**（本仓已具名该形态，见 `jev/src/index.ts:585-588` 的"文档强于代码"教训）。

**（3）走治理流程**：C16 拍板「ITACL 不移植」的**重开条件**写在 `docs/mana-rollout-plan.md:823`：
> "① 宿主 `agent/pre-step` 若**新增**「信息充足度」通道（或返回类型扩出第三态），ITACL 可重开"

**实测该条件未满足**：`runtime-types.d.ts:92-99` 仍是二值。
⇒ **转正 `RESULT_CLASSIFICATION_PROMPT` 的第一步不是写码，是请用户就 C16 的重开作一句拍板。**
（可由第二刀之前的`[建议决策]`提出）

---

## 4. 与既有面的冲突分析

### 4.1 会不会动 A1-11？

| 面 | 结论 | 证据 |
|---|---|---|
| **A1-11 本体**（向量降级信封 `degraded===true` + `gate` 非空 + `rankBy==='local_score'`） | **不动** | 判据原文 `docs/mana-rollout-plan.md:462`；机检与变异锚点全打在 `recall.ts`（`tools/a1-check.mjs:292-310`）⇒ 与 `chains.ts` 无交集 |
| **A1-8**（`jev_log` 的 `gate`/`degraded` 至少一个非空） | **可能被间接波及**：验证链若走 judge，会**新增 `jev_log` 行** | `docs/mana-rollout-plan.md:459`；A1-8 判的是**字段可枚举**不是行数，故**新增行本身不破坏它**；但若新增行带 `request_type`/`source`，则撞 G9 的既有裁定（`jev/src/index.ts:550-556`）⇒ **设计上必须选择"不带归属列"或另开一批** |
| **A1 的 `ARTIFACTS` 腿**（内容级：重编译 src 与 lib 逐字节比） | **会变红直到重新 build** | `tools/a1-check.mjs:41-44`。且**并发纪律 §5 禁止并行波次里跑 workspace 级 build**（`docs/contract/concurrency-discipline.md` §5）⇒ 改 `chains.ts` 之后必须**单独排一次**本包 build |

**⇒ 结论：A1-11 无冲突；A1-8 无直接冲突但有"新增行口径"的连带约束；A1 的产物腿要求串行 build。**

### 4.2 会不会动事件契约？

**第一刀不动。** 理由（可核）：
- 加事件名要改 `packages/core/src/event-types.ts` 与 `packages/core/src/domain.ts`；
- **这两份文件就是 `docs/contract/_freeze.sha256` 的全部内容**（`wc -l = 2`，本席逐字节复算：两条哈希与磁盘**逐字相等**）；
- 冻结规则原文（`docs/contract/CHANGELOG.md:3-5`）：「冻结不是「不许改」，而是「**改了必须留痕、留痕必须能被下游看到**」」，并要求按五列格式（版本/变更/涉及接口件/申请人/日期/下游适配）追加一行。

**若将来确要加事件，须走的流程（逐条）**：
1. 在 `docs/contract/CHANGELOG.md` **追加一行**（不覆盖旧值），列清涉及接口件与**下游适配**（下游 = 全体插件，编译期报错即清单）；
2. 走 `--record-baseline` 重取三件套 —— **前置门是 `git status --porcelain` 为空**（`docs/contract/concurrency-discipline.md` §2），且只能由**唯一基线席**执行；
3. 重取后 `_freeze.sha256` 的**哈希腿**才会一致；在此之前 A0-12 的哈希腿必红。

### 4.3 会不会动 `_freeze` 基线？

| 变更 | 清单腿（`_freeze.files.txt`） | 哈希腿（`_freeze.sha256`） | 需走什么 |
|---|---|---|---|
| **改 `chains.ts` 内容**（第一刀） | **不动**（文件仍在清单上，`_freeze.files.txt:68`） | **不动** | 无需契约流程；仅需本包 build + 判据复跑 |
| **新增一个 `.ts` 源文件** | **漂移**（清单少一件） | 不动 | 需重取基线 |
| **改 `event-types.ts` / `domain.ts`** | 不动 | **漂移** | 必须走 §4.2 的 CHANGELOG 流程 |

### 4.4 ⚠ 实测：A0-12 **在改动之前就已经是红的**（主树与工作树都红）

**复跑命令（两棵树各跑一次，只读）**：
```bash
cd <树> && node tools/a0-check.mjs --only A0-12 ; echo $?
```
**实测结果**：主树 `/home/lk/Mana` **exit 1**；本工作树 **exit 1**。理由逐条：

| 腿 | 实测 | 成因（本席定位） |
|---|---|---|
| 哈希腿 | ✅ 逐字相等 | — |
| **清单腿** | ❌ **少 11 件**（工作树少 12 件） | 快照（seq=20，`8a2bfae`，2026-09-26 17:32）**之后**才落的 11 个源文件：`consolidation/src/distill.ts`(`2a7263e`) / `generation.ts`(`2d937c2`) / `forgetting/src/renorm.ts`(`2c7ba55`) / `long-term/src/summarize.ts`(`06f35e4`) / `perception/src/parse.ts`(`379df4b`) / `signal-words.ts`+`signal.ts`(`066a456`) / `vector/src/bigloop.ts`(`5925c45`) / `bigloop-wiring.ts`+`retrieve-port.ts`(`0d65a29`) —— **无一件是本次改动**（本席只读） |
| 锚点腿 | ❌ 锚点回退（第 12→13 条：`1963e88 ⊄ a17daf4`） | 流水 seq=16/18/19 已登记的既有历史（`docs/contract/_freeze.log`），**不是新缺陷**；N1 席已在 seq=21 判定"永久存在、不可收口" |
| **时序腿** | ❌ **记录之后仍被写过**（+91669s） | ⚠ **本席定位到一条新的假红机制**：`git worktree add` / checkout 会**重写 mtime**。实证：**主树**三件套 mtime = `2026-09-26T09:37:29.325Z`（≤ 末条 record `09:37:29.342Z`，**不红**）；**本工作树**同三件套 mtime = `2026-09-27T11:05:18.139Z`（= 装配检出时刻，`+91669s`，**判红**）。即：**同一份字节、同一个 HEAD，在新建工作树里必然报这一条** |
| 跃迁腿 | ❌ 6 段 | seq=11/15/18/19/21 已登记的既有流程事实 |

**⇒ 对本卡的影响（必须前置说明，否则本席的自验会被读成"我把它弄红了"）**：
1. 本席**只读** `packages/**`（见 §7 自证），上列红**全部早于本席开工**；
2. 但**时序腿的红**会让**任何**在本工作树内跑 A0-12 的人看到红 —— 这是**工作树装配的固有代价**，须在报告里点名，不得归因到别处；
3. **重取基线消不掉它**：N1 席已实测并登记（`_freeze.log` seq=21）「重取无法消除锚点腿/跃迁腿，且会让跃迁腿更红」；时序腿则**会在重取后由 `git checkout` 再次触发**（只要该树再被检出一次）。
4. **前置门也不满足**：主树 `git status --porcelain` **非空**（` M docs/mana-next-plan-2026-09-27.md` + ` D packages/prompts/src/__verify_mask_probe.ts`）⇒ 按 §2 **现在根本不能重取基线**。

---

## 5. 建议的最小可落地切片（"第一刀切哪"）

### 5.1 第一刀：**只落"验证行"的骨架与三态，不接 LLM、不接退回**

**做什么（4 处改动，全在 `packages/scheduler/`）**：

| # | 改动 | 落点 | 为什么先做这条 |
|---|---|---|---|
| 1 | `TRACE_EVENTS` 增第 11 键 `verification` | `chains.ts:82-114` | 键集**未被任何判据钉住**（`grep TRACE_EVENTS packages/scheduler/tests/` = 0）；且 `chains-e2e.test.mjs:131-133` 的 `driverRows()` 按**命名空间前缀**认领（`:61` `DRIVER_PREFIX = 'mana-scheduler/chain'`）⇒ **新标签自动被既有判据跟随**，不需要改测试认领逻辑 |
| 2 | `onTurnBoundary` 内新增一个**不 await** 的验证任务 | `chains.ts:1314-1579`（发起点放 `:1560` 的 `noteActivity` **之前**） | 时序与不阻塞的取舍与生成链/蒸馏链**逐字同源**（`:1213-1217`、`:1544-1549`） |
| 3 | `DriverReadings` 增 5 个分列读数 | `chains.ts:614-648` | "扫描了没发起"与"压根没接"必须分列（`:626-629` 原文理由）；且 `readings()` **无 deepEqual 全等断言**（实测：`distill-wiring.test.mjs` 只做逐字段断言）⇒ 增字段是**纯增量** |
| 4 | 开关 + 三态 status + 非空 reason | `chains.ts:570-611`（`DriverConfig`）+ `index.ts:53-93`（`Config`）+ **`index.ts:168-182`（必须转发）** | §2.3 的"假旋钮"三条落点；漏掉第③处就复刻 `chains.ts:593-602` 登记的坑 |

**不做什么（第一刀的硬边界）**：
- ❌ 不改 `SEVEN_CHAIN_TABLE`、不改 `coverage()` —— T10 四条断言（`chains-e2e.test.mjs:489/491/508/514`）；
- ❌ 不改 `core/event-types.ts` / `core/domain.ts` —— `_freeze.sha256`（§4.2）；
- ❌ 不做 `steer` 退回 —— §3.2.4 序号 ③ 的代价；
- ❌ 不调 LLM —— 第一次真跑 LLM 往返应另开一刀，带独立判据。

**为什么这算"真切片"而不是"没干活"**：它的产物是一条**会一直存在的可数行**。当前"本仓没有任何东西在追踪执行结果"这件事**在库里完全没有痕迹**；第一刀之后，每个回合边界都会留一行带 `status`/非空 `reason` 的 `verification` 行 —— 这正是本仓的既有口径（`chains.ts:43-44`「未到点也照写行 … 不写的话，「没到点」与「压根没接」**同形**」）。缺口从**不可见**变成**可数**，这是本仓排序第一优先的缺陷类。

**代价（量化）**：
- 写面：`packages/scheduler/src/chains.ts` + `packages/scheduler/src/index.ts` + 判据（`tests/` 内）+ `packages/scheduler/verify.mjs`（登记数须同步，`:36-39`）。
- 构建：**必须** build scheduler 包（A1 `ARTIFACTS` 腿是内容级比对，`a1-check.mjs:41-44`）；且按并发纪律 §5 **不得**跑 workspace 级 build。
- 判据：`chains-e2e.test.mjs` 用例数变化 ⇒ 同步 `EXPECTED_CASES`（`:51`，现值 12）与 `verify.mjs:38` 的 `declared/counted`（现值 13/12）。⚠ **别把新用例放进 `generation-chain.test.mjs`** —— 它没进外部防线（G10）。
- 契约流程：**零**（不改冻结面、不改契约）。**但**新增 `.ts` 文件会让清单腿漂移件数 +1（若把逻辑全放进 `chains.ts` 则 +0）。**推荐放进 `chains.ts`**，把清单腿的漂移保持在"与本席无关的既有 11 件"。

### 5.2 第一刀里"结果材料"从哪来（这是本设计的技术核心，也是最需要验证的一点）

`chains.ts:320-329` 自述 "工具结果…**不是 ctx 事件** ⇒ 本驱动者无源可接（不伪造）"。
**这句话对**（作为 *事件* 确实无源），但**不等于读不到**：

- `payload.agent.session` 是 `Session`（宿主声明 `runtime-types.d.ts:143`）；
- `Session.snapshotEvents(fromSeq?, toSeqExclusive?)` 是公开读面（`node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:192`）；
- 会话日志里有 `'tool/result'` 事件，其 `message` 带 `isError?: boolean`（`dsh-session/lib/types/types.d.ts:374-388`，`isError` 在 `dsh-llm/lib/types/message.d.ts:159`），以及 `'assistant/message'`（`types.d.ts:330-338`）。
- **实现路径**：不 import 宿主运行期（保持 `:11-17` 的硬约束①），只做**结构读取**（照 `resolveSessionId` `chains.ts:669-675` 的既有写法）。

**⚠ 三条必须写清的边界**：
1. 这是**读日志**，不是"接事件" ⇒ **不得**把它写成 `SEVEN_CHAIN_TABLE` `tool-result` 行的 `hostTrigger`（那会伪造一个事件面）。若将来要用它，正确做法是**新增一行`v10Trigger` 的口径说明**（照 `DISTILL_CHAIN_ROW` 先例），并在 row 里标 `substitution: '读 session log，非 ctx 事件'`。
2. **本席未实跑`snapshotEvents()`**（§6 U3）⇒ 这条在设计上成立、在运行上**未验证**。
3. 第一刀的 `no-result-material` 态**正是因为这条还没接**而存在 —— 它是**诚实的中间态**，不是占位符。

### 5.3 第二刀（不在本卡，供排期参考）

① 接 `snapshotEvents` 取材料 → ② 判定通道（推荐 `mana-llm.generate`，理由见 §3.3 的 (b)）→ ③ 若用户拍板 C16 重开且同意 C6，再接 `agent.steer` 退回（缺省 false + 每回合硬上界 + 丢弃可数）。

---

## 6. 未验证项清单（如实列，不许省）

| # | 未验证项 | 为什么没验 | 影响 |
|---|---|---|---|
| U1 | **`agent.steer` 在 `turn-stopping` 期间调用的真实效果**（是否真的再跑一个 step） | 本席只**读实现体**（`dsh-agent-loop/lib/index.js:984-990` 的 break 条件 + `:809` 的 `steer→send('next-step', true)`），**未跑过** | §3.2.2 的通道成立性是**读码级**结论；第二刀开工前必须**先跑一次探针**（造一个 `turn-stopping` listener 调 `steer`，数 step 数） |
| U2 | **本仓生产会话里 `payload.agent` 是否恒带可用 `steer`** | 未跑生产会话 | C5 的判空分支可能是**必需**而非防御性 |
| U3 | **`session.snapshotEvents()` 在驱动者里读 `tool/result` 的可达性与开销** | 未实跑（只读声明 `:192` 与类型 `types.d.ts:374`） | §5.2 的技术核心；第一刀不含它，故不阻塞第一刀 |
| U4 | **`JevJudgeResult` 收窄点在真跑时的实际行为**（`value='success'` 是否真被折成 `'unknown'`） | 只读代码 `jev/src/index.ts:560`，未造样例跑 | §3.3 的 (a)/(b) 选择依据；**建议第二刀开工前用一条最小探针证伪/证实** |
| U5 | **`A1-8`/`A1-11` 的机检是否会因 `jev_log` 新增行而改变绿红** | 未跑 `npm run check:a1`（会 build，撞并发纪律 §5；且本席只读） | 第二刀（真调 judge）前必须补跑一次基线 |
| U6 | **`a1-check` `ARTIFACTS` 腿在本工作树的当前态** | 未跑（同上，且它会重编译） | 第一刀落地后必须单独排一次 build + 复跑 |
| U7 | **`docs/arch/mana-MA-F01-cognition-loop.md` 与 `mana-overview.md` 已过期**（自述"Mana 零源码" `mana-overview.md:4` / `mana-MA-F01-cognition-loop.md:4`，而实测 `packages/*/src/*.ts` = **29896 行**） | 只复算行数，未重生成 L2 档 | 若将来把"对应表"写进 L2 档（勘察席 `docs/mana-itacl-and-thresholds-recon.md:107` 的建议），**必须先重生成** —— 否则表会写进一份事实已过期的文档里 |
| U8 | **`packages/prompts/src/__verify_mask_probe.ts` 的性质**（19 字节 `export const z = 3`，在 `8a2bfae`（`ad5eec8` 提交）入库；主树 ` D` 已删未提交） | 只读 git 状态，未追提交意图 | 它是**清单腿漂移的第 12 件**（工作树内），且其未提交删除**使 `--record-baseline` 的前置门不满足** |
| U9 | **`chapter` 卡面给的 `chains.ts:1314` 实现体那一段的逐行语义**（本席读了 `:1300-1601` 全文，但未跑 `chains-e2e`） | 全卡只读，未跑测试 | 第一刀的落点行号需在开工时以**当时的 HEAD** 重锚（本仓已知：行号会随他席合并漂移） |

---

## 7. 本席只读自证

- 本卡**唯一写文件** = 本文件。
- `packages/**` 一个字节未改：本工作树开工时 `git status --porcelain` = `?? .provision-build.log`（装配期产物，非本席）；收工复查同值（见任务卡评论）。
- 未执行 `--record-baseline`、未执行任何 build、未跑 `npm test`（只跑了 `node tools/a0-check.mjs --only A0-12` 两次：主树一次、本树一次 —— 该命令只读，且**未触发** `checker-lock` 之外的任何写；实测它不写任何文件，只打印）。

---

## 附：本文引用到的关键坐标速查

| 面 | 坐标 |
|---|---|
| 驱动者标签集（10 键） | `packages/scheduler/src/chains.ts:82-114` |
| 七行口径表 | `chains.ts:311-379`；钉死 `packages/scheduler/tests/chains-e2e.test.mjs:489/491/508/514` |
| 蒸馏链**独立行**先例（不进七行表、不进 coverage） | `chains.ts:381-408` |
| `onTurnBoundary` 声明 / 实现 | `chains.ts:778` / `:1314` |
| 挂点注册 | `packages/scheduler/src/index.ts:289-296` |
| 不 await 的既有理由 | `chains.ts:1213-1217`（生成链）· `:1544-1549`（蒸馏链） |
| 宿主 serial 声明 / 真实 await | `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:385-391` / `dsh-agent-loop/lib/index.js:984` |
| 宿主 steer 自述 / 声明 / 实现 | `runtime-types.d.ts:370-380` / `:200` / `dsh-agent-loop/lib/index.js:809` |
| 宿主 pre-step 二值回执 | `runtime-types.d.ts:92-99`（`:304-310` 声明） |
| 契约三值结果 | `packages/core/src/domain.ts:149-156`；收窄点 `packages/jev/src/index.ts:560` |
| ITACL prompt 定义 / 注册 / 语义 | `packages/prompts/src/itacl.ts:24-33` / `registry.ts:94` / `registry.ts:56` |
| 6⑥/⑥b 机检腿 | `packages/prompts/tests/prompts.test.mjs:297-307` / `:309-324` |
| C16 重开条件 | `docs/mana-rollout-plan.md:823` |
| A1-11 原文 / 变异锚点 | `docs/mana-rollout-plan.md:462` / `tools/a1-check.mjs:292-310` |
| 冻结三件套构成 | `docs/contract/_freeze.sha256`（2 行）· `_freeze.files.txt:68`（chains.ts）· `docs/contract/CHANGELOG.md:3-5`（改动规则） |
| 并发纪律（锁/base/取数/git/构建/项数） | `docs/contract/concurrency-discipline.md` §1-§6 |
| 外部防线登记表 | `packages/scheduler/verify.mjs:36-39` |
| session log 读面 | `@deepseek-ai/dsh-session/lib/types/index.d.ts:192`（`snapshotEvents`）；`types.d.ts:374`（`tool/result`） |
