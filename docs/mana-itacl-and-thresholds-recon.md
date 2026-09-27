# ITACL 对应表 + §26 三项阈值归属 · 只读勘察报告

> **卡**：`t-mujnh5yh-huenbw`（只读勘察；**不写任何 `packages/**`**）· 分支 `task/ITACL勘察+t-mujnh5yh-huenbw`
> **取数坐标**：worktree `/home/lk/Mana/.dsh-worktrees/t-mujnh5yh-huenbw` · HEAD `b32e20f`（=`git rev-parse --short HEAD`）
> **本文唯一写面**：本文件。所有结论给 `文件:行号`，给不出的一律标「未验证」（见 §4）。

---

## 0. 一句话结论

- **任务一**：ITACL 在本仓**不是状态机，是"事件 + 表列"的等价实现** —— 但 **12 个状态名里只有 4 个（PLANNING/ACTING/OBSERVING/COMPLETED）能落到具体代码位置**；`CONTINUE` 半落（有出边无入边）；**`VERIFYING` 与 `PRE_TASK` 的部分语义无对应**；`RETRIEVE`/`DIAGNOSE`/`COMPLETE` 只有"名字对得上、语义对不上"的落点，**如实标语义无对应**。§19.4 的 **9 条转移里：7 条无对应、2 条降级/半对应、0 条完全对应**。
- **任务二**：三项阈值**全部无对应场景，建议不改**（理由逐项见 §3）—— 其中「安全守门」要澄清一点：**场景（工具调用前的安全检查）在本仓是存在的，缺的是"接进那条 waterfall"的线**；另两项（任务前充足性 / 遗忘优先级）连场景都不存在。

---

## 1. 任务一：ITACL 对应表（v10 §19 ⇄ 本仓）

### 1.1 复验：12 状态名与 `itacl` 的命中面

命令（worktree 根，逐字复跑）：

```bash
for s in PRE_TASK EXECUTING VERIFYING COMPLETED PLANNING ACTING OBSERVING JUDGING CONTINUE RETRIEVE DIAGNOSE COMPLETE; do
  printf "%-12s " $s; grep -rn --include=*.ts "\b$s\b" packages/*/src | wc -l; done
# 实测输出：12 行全 0；再单跑 grep 任取一个状态名 packages/*/src ⇒ rc=1（无命中，退出码直取）
grep -rln 'itacl' packages/*/src     # ⇒ packages/prompts/src/index.ts、packages/prompts/src/registry.ts（仅 §25.8 两条 prompt，见 §1.4）
```

⇒ 与既有实测一致（`docs/mana-v10-status-plan.md:1049`：「三级状态机**一行代码都没有**」）。

### 1.2 v10 三阶段 ⇄ 本仓落点（含事件类型核实）

| v10 阶段（§19.2 / §20） | 本仓落点（文件:行号） | 事件类型（宿主人脸） | 语义是否等价 |
|---|---|---|---|
| **阶段一 · 任务前信息采集** | `packages/attention/src/index.ts:817`（`ctx.on('agent/pre-step')`，waterfall） | 宿主 waterfall：`node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:304-310` | **降级**：本仓只做「注入/拦截」，不做「采集够不够」 |
| ↳ 判定链（阶段一的 JEV） | `attention/src/index.ts:1166`（`ctx.waterfall('mana/jev/judge', req, …)`）→ 监听器 `packages/jev/src/index.ts:531` | Mana waterfall：`packages/core/src/event-types.ts:49-53` | 部分等价（问的是「这条记忆该不该注入」`attention/src/index.ts:250`，不是「信息够不够」） |
| **阶段二 · 执行中观察-反馈** | `packages/core/src/event-types.ts:34`（`mana/observation`）、`:38`（`mana/decision`） | Mana emit（`:33-42` 五类注释写明 `@mode emit`） | **名对实不对**：见 §1.3 |
| ↳ 观察的生产者 | `packages/perception/src/index.ts:225`（`ctx.emit('mana/observation', obs)`） | 同上 | — |
| ↳ 决策的生产者 | `attention/src/index.ts:1204`（写 trace）、`:1211`（`emitSyncGuarded('mana/decision', decision)`） | 同上 | — |
| **阶段三 · 完成与固化** | `packages/scheduler/src/index.ts:289`（`ctx.on('agent/turn-stopping')`）→ `packages/scheduler/src/chains.ts:1314`（`onTurnBoundary`） | 宿主 **serial**：`runtime-types.d.ts:387-391`（注释 `:385` 明写 `@mode serial`） | **部分**：巩固/遗忘/关窗/学习/生成/蒸馏都真跑，但**无「结果验证」** |
| ↳ 七链条表（唯一口径表） | `chains.ts:311-379`（`SEVEN_CHAIN_TABLE`，7 行） | — | — |
| ↳ 蒸馏链（§12.3，不属七行） | `chains.ts:394-408`（`DISTILL_CHAIN_ROW`） | — | — |

⚠ 卡里给的 `chains.ts:334/342/404` 是**表行**（`scheduled` 行 `:334`、`goal-done` 行 `:342`、蒸馏行 `:404`），不是函数入口；函数入口是 `:1314`。两处都对，看的是不同的东西（表 vs 行为），此点如实标出避免下一位读者按错位置找。

### 1.3 状态级对应表（§19.3 三级状态机）

| v10 状态 | 本仓落点（文件:行号） | 判定 |
|---|---|---|
| `PLANNING` | **目标栈三阶段循环**：`packages/scheduler/src/index.ts:99`（`goals: GoalStack`）→ `:193`（`run()`）→ `:196-204`（`runCycle`），阶段枚举 `packages/scheduler/src/goal-stack.ts:155`（`SoarPhase` = analyze / decide / act / impasse 四值，字面量分别落在 `:222` 与 `:228`） | **降级对应**：SOAR 的 `analyze`/`decide` 就是"规划"，但它是**包内服务面**、需调用方调 —— 生产侧 `run()` 的调用点 0 命中（实测 `grep -rn '\.run(' packages/*/src` 只命中 `db.prepare(...).run(...)` 这类 SQL 执行，**无一处是 SoarCycle 三阶段**；`ctx.get('mana-scheduler')` 亦 0 命中 ⇒ 见 §4 未验证项 3） |
| `ACTING` | 同上，`goal-stack.ts:228`（`phase: 'act'`）；**另一处 ACT 语义**：七链条"执行"= `chains.ts:1423/1465/1490/1509` 四条链任务 | **降级对应**（两套"执行"：SOAR 算子执行 vs 链任务执行，不同物） |
| `OBSERVING` | `perception/src/index.ts:225`（观察的生产者）→ `attention/src/index.ts:806`（`ctx.on('mana/observation')`，`ingest` 在 `:599` 写 trace、`:672` 写 attention 行） | **对应**（名字不同、职责同：观察进入认知核） |
| `JUDGING` | 判定链：`attention/src/index.ts:1166` → `jev/src/index.ts:531`；结果落 `mana/decision`（`attention/src/index.ts:1191-1211`） | **对应**，但它是**阶段一（pre-step）的判定**，不是 v10 阶段二的「结果分类（success/failure/anomaly/uncertain/partial）」 |
| `COMPLETED` | 目标栈节点 `status === 'done'`：`chains.ts:1429`（`goals.toSerial().filter((node) => node.status === 'done')`）→ 喂 `consolidation.plan`（`:1430`）做 chunking | **对应**（"目标完成"在 v10 里正是 chunking 的触发源，见 `chains.ts:341` 的 `v10Chains: ['学习（chunking）']`） |
| → 触发源映射 | `chains.ts:339-347`（`goal-done` 行：v10Trigger=`目标完成`，hostTrigger=`agent/turn-stopping`，substitution=回合边界扫 done 节点） | **对应（有替代说明）** |
| `PRE_TASK` | **无对应** | 见下方「不得替它圆」 |
| `EXECUTING` | **无对应** | 见下方 |
| `VERIFYING` | **无对应**（**本报告唯一新发现的语义缺口**） | 见下方 |
| `CONTINUE` | **半落**：`attention/src/index.ts:1274`（返回 `enter`，回执仍是**事件 + 输出**、**无状态机对象**） | 出边有、入边无；不冒充"有状态机" |
| `RETRIEVE` | **语义无对应**（近邻是**名字误导**的落点）：`attention` 的 `ingest`（`index.ts:599`）**不检索任何东西**（入队 + 广播 + 落 trace） | 见 `:806-810` 行内注释自证：「阶段 0 只保证通路存在」（阶段 2 才接检索） |
| `DIAGNOSE` | **无对应** | 见下方 |
| `COMPLETE` | **语义无对应**（近邻是嵌入在 "completed" 一词里的那个 `COMPLETED`） | 全仓无独立 token |

#### ⚠ 「不得替它圆」逐条（这几条我**拒绝**给一个漂亮落点）

| 项 | 为什么标「无对应」 |
|---|---|
| `PRE_TASK` | 「任务**开始前**」在本仓**没有独立时刻**：`agent/pre-step` **每一步都触发**（宿主契约 `runtime-types.d.ts:293-310` 是 step 级 waterfall，不是 turn 开始前钩子），且 `payload.step` 存在。**没有任何代码区分 step===0 与 step>0**（`attention/src/index.ts` 全文无 step 分支，已逐行核）。⇒ 「PRE」这个前缀在本仓**不可表达**，不是在别处改了个名。<br>（口径更正机会：`docs/mana-v10-status-plan.md:1218` 把「不熟悉检测」归因为「MCL 在守藏侧」——**与 ITACL 域无关**；其 v10 归属是 §23 调度链条，对应的 prompt `UNFAMILIAR_TASK_PROMPT` 在 `packages/prompts/src/scheduling.ts:13` 且 `wired:true`，但生产调用点 0。） |
| `EXECUTING` | 「执行一步」的归属者是**宿主 agent loop**（v10 自己也承认，见 `docs/mana-v10-status-plan.md:1099`）。本仓在 `agent/pre-step` 上只能**每步拦一次**，不能"执行一步再回来"。 |
| `VERIFYING` | ① `agent/turn-stopping` 的回执面是 `Promise<void>`（`runtime-types.d.ts:391`）——**没有返回值通道**，"验证未通过 ⇒ 退回执行"表达不出来（宿主给的替代面是 `agent.steer(...)`，见 `:373-375` 注释）；<br>② 「任务完成前对结果做验证」这条链在本仓**不存在**：`chains.ts` 的 **10** 类 label（`:82-114`：encoding / retrieval / consolidation / reconsolidation / forgetting / learning / generation / distillation / coverage / error）里**没有 verify/result 类**；唯一"结果分类"的常量 `RESULT_CLASSIFICATION_PROMPT`（`packages/prompts/src/itacl.ts:24`）是 `wired:false`（`packages/prompts/src/registry.ts:94`）。 |
| `DIAGNOSE` | 「失败 → 问题诊断 → 回到执行」在本仓**没有触发面**：`agent/error`（`runtime-types.d.ts:402-407`，emit 型）与 `agent/request-error`（`:348-356`，waterfall）本仓**均零监听**（全仓 `ctx.on` 事件集合实测 = `agent/disposed`、`agent/inbox/inserted`、`agent/pre-step`、`agent/turn-stopping` + 5 个 `mana/*`）。 |
| `RETRIEVE` | 唯一名字沾边的是 `attention/src/index.ts:817` 的 `ctx.on('agent/pre-step')`（谁都会写），**零检索代码**（`ingest` 只入队，见 `:644-669`）。⇒ 标「语义无对应」，不拿它充数。 |
| `COMPLETE` | 全仓无独立 token（正则 `\bCOMPLETE\b` 与 `\bCOMPLETED\b` 实测各 0 命中；该词只作为别的标识符的一部分存在）。 |

#### 1.3.1 两处"沾边但不能算"的落点（`RETRIEVE` / `mana/decision`；如实列出，标**未接线/未验证**）

- **跑不起来的**：`packages/vector/src/index.ts:435` 发 `mana/recall`（trace 在 `:430` 就地写）—— 但**全仓 `ctx.on('mana/recall')` = 0**（实测），即**契约里声明了、无人消费**。
- **不接主路径的**：`attention/src/index.ts:47-50` 的文件头自己写着（⚠ **引用这句话时别用裸 grep**：它本身就会命中 `ctx.on('mana/decision'` 的**字面量** ⇒ 把"说明它不存在的那句注释"读成"它存在"。判据：`grep -vE ': *[*/]'` 剥注释后为 0）「`mana/decision` **全仓零消费者** … 它是**为阶段 2+ 预留的事件面**」—— 这段注释自 HEAD 起准确（`ctx.on('mana/decision')` 在 `packages/**` 零命中，仅出现在 `packages/attention/tests/f2-new-gaps.test.mjs:216/237` 当测试桩）。**不据此设计任何改动**（`attention` 在冻结集内，见 `docs/contract/_freeze.files.txt:1`）。

### 1.4 §19.4 状态转移表逐条核（9 条）

| # | 当前 | 条件 | 下一状态 | 本仓是否有对应 | 依据 |
|---|---|---|---|---|---|
| 1 | PRE_TASK | 信息充足 ≥0.7 | EXECUTING | **无对应** | 宿主 `PreStepDecision` 是二值（`runtime-types.d.ts:92-99`：`{kind:'reject'}` 与 `{kind:'enter', messages}` 二选一），**无充足度通道** |
| 2 | PRE_TASK | 信息不足 <0.7 | PRE_TASK | **无对应** | 同上；且 PRE 时刻不可表达（§1.3） |
| 3 | EXECUTING | success + 充足 | CONTINUE | **无对应** | 「success 分类」的常量 `RESULT_CLASSIFICATION_PROMPT` 存在但 `wired:false`（`prompts/src/itacl.ts:24` + `registry.ts:94`） |
| 4 | EXECUTING | failure/anomaly | DIAGNOSE | **无对应** | 见 §1.3 的 `DIAGNOSE` 行 |
| 5 | EXECUTING | 信息不足 <0.6 | RETRIEVE | **无对应** | 同上 + §1.3 的 `RETRIEVE` 行 |
| 6 | EXECUTING | 任务完成 ≥0.7 | VERIFYING | **无对应** | 见 §1.3 的 `VERIFYING` 行 |
| 7 | RETRIEVE | 检索完成 | ACTING | **降级对应**（且**未接线**）⚠ 这是**转移边**的降级对应；**状态 `RETRIEVE` 本身仍是语义无对应**（§1.3）：`vector/index.ts:435` 发 `mana/recall`，**零消费者**（实测）⇒ "检索完成 ⇒ 动作"在本仓**不可达**。**不替它圆成"有"** | 见 §1.3.1 |
| 8 | DIAGNOSE | 诊断完成 | ACTING | **无对应** | 同 #4 |
| 9 | VERIFYING | 验证通过 | COMPLETED | **半对应**：`chains.ts:1429-1430` 有「目标 done ⇒ 喂 chunking」，但**没有"验证"这一步**（`done` 是调用方自己标的状态，不是判定出来的） | `chains.ts:1429` |

**统计**：无对应 **7**（#1–#6、#8）· 降级/半对应 **2**（#7、#9）· 完全对应 **0**。

> 与 v10 自述的差异：v10 那张表把 9 条**全标**⛔「无充足度通道」（`docs/mana-v10-status-plan.md:1055-1063`）。本报告按**逐条实际语义**重核，**结论相同但依据更细**：9 条里有 3 条（#4/#6/#8）连"缺的那个通道"都不是充足度，而是**缺整个执行-诊断-验证回路** —— 即使日后补上充足度通道，这 3 条**依然无对应**。

### 1.5 建议：对应表该写进哪个文件

**结论：不新建文件，写进 `docs/arch/mana-MA-F01-cognition-loop.md`（L2 特征主链）；`docs/contract/**` 一个都不加。**

理由（逐条可核）：

1. **不能进契约**：`docs/contract/_freeze.files.txt` **91 行全部是 `packages/**` 源码**（0 条 `docs`），`_freeze.sha256` **2 行**只钉 `packages/core/src/event-types.ts` 与 `packages/core/src/domain.ts`（实测 `wc -l`）⇒ `docs/contract/*.md` **不在冻结三件套内**；而 `tools/a0-check.mjs` 有 7 处引用 `naming.md`（`:473`/`:477`/`:487`/`:488`/`:521`/`:524`，A0-5 机检面）。⇒ 往 `naming.md` 里加非"包↔插件↔服务名"的内容会把机检面搅浑，**不采纳**。
2. **可以进源码注释，但要动冻结件的"手写块"**：`packages/core/src/event-types.ts:2` 自述「Mana 事件契约 v0.1」，`packages/core/src/domain.ts:4` 自述「**本文件是 Mana 契约的唯一归属地**」—— 对应表若进源码，**唯一合法落点是 `domain.ts`**（那里的声明合并是编译期强制门）。**代价照实写**：`domain.ts` 在 `_freeze.files.txt:10` 与 `_freeze.sha256` 内，改一行 ⇒ 三件套哈希立刻漂移。⚠ `packages/core/src/schema.ts:61-64` 正好有一条**同类裁定**（「只补这两列、不预补其余 10 列」，理由「无写者的列进来只会变成下一个『列在写者不在』」）——**同一把尺子**用在对应表上：**没有消费者的映射表，就是下一个「表在读者不在」**。
3. **L2 档是既有先例**：`docs/arch/mana-MA-F01-cognition-loop.md:1` 自述「**L2 特征主链（贯通式流程）**」，`:4` 的"读法一行"给的正是「从一条用户消息进入 … 看每一步靠什么触发」= **和对应表要回答的同一个问题**。
4. ⚠ **该文件当前自相矛盾（如实指出）**：`docs/arch/mana-overview.md` / `docs/arch/mana-MA-F01-cognition-loop.md` 两档的档案事实是 **Mana 零源码**（`docs/arch/mana-overview.md:3-6`、`docs/arch/mana-MA-F01-cognition-loop.md:4`：「**Mana 全仓 20 个文件、零源码**」），而现仓是 20+ 包、3 万行 TS（`wc -l packages/*/src/*.ts` = **30919**）；两档里的行号全部指向 **v5 方案 / 落地册**，不是源码（`mana-MA-F01-cognition-loop.md:12-14` 的"依据"列全是 `方案:N`）。⇒ **写之前必须先重生成 L2 档**（`arch-view` 技能的 `nav` 模型直出），否则对应表会被写进一份**事实已过期**的文档里 —— 那比不写更坏。**这一条需要拍板**（属"改哪份文档"的范围决定，不在本席写面内）。

---

## 2. 任务二总览：§26 三项阈值的归属判断（结论先行）

| v10 场景 | v10 阈值 | 归属判断 | 本仓现状（依据） |
|---|---|---|---|
| 任务前充足性 | 0.7（`docs/mana-v10-status-plan.md:1405`） | **无此场景 · 建议不改** | 宿主无充足度通道（`runtime-types.d.ts:92-99`）；`packages/**` 零命中 |
| 安全守门 | 0.8（`:1411`） | **场景在、线没接 · 建议不改（但登记为可选接线项）** | prompt 已落地（`prompts/src/scheduling.ts:39`）；`tools/pre-execute` **零消费者**（全仓 `ctx.on` 实测） |
| 遗忘优先级 | 0.3（`:1412`） | **无此场景 · 建议不改** | 值锚定在**错误量纲**上（v10 自己把「活性级别」标 Choice、把「遗忘优先级」标 Score：`docs/mana-v10-status-plan.md:1208-1209`）；本仓已用确定性闭式裁决（`forgetting/src/prune.ts`） |

**为什么三项都判"不改"（不是懒，是同一把尺子）**：`packages/core/src/schema.ts:61-64` 那条既有裁定 ——「**无写者的列进来只会变成下一个『列在写者不在』**」，本仓还有一条口诀「**假旋钮**」（声明了却不起作用的开关与静默失效同类，见 `packages/core/src/index.ts:480-482`）。给这三项挂阈值 = 造三个**没有被测对象的阈值**。

---

## 3. §26 三项阈值逐项归属判断（读码依据）

### 3.1 任务前充足性（0.7）→ **无此场景，建议不改**

**① 它属不属于 ITACL 域？—— 是**，但它依存的**量在本仓不存在**。

- v10 §19.2 阶段一第 ⑤ 步「信息充足性判断（JEV Noul, 阈值 0.7）」：`docs/mana-v10-status-plan.md:1022`；§20.1 第 ⑤ 步：`:1082`。⇒ 归属无争议 = 阶段一，事件本应是 `agent/pre-step`。
- **宿主接口面的硬事实**：`pre-step` 的返回类型二值（`runtime-types.d.ts:92-99`：`{kind:'reject'}` | `{kind:'enter', messages, startsRequestSeries?}`），**没有充足度通道** ⇒ 阈值 0.7 **无落点**。
- **"能不能退一步、只做判定不接回执？"——技术上可行，但生产上不可分辨**：`attention` 在同一个 `agent/pre-step` 上已经有一次 noul 判定（`:1154-1177`），差别只在 `question` 一个字符串。跑第二次 ⇒ 两个判定共用同一个 `requestId` 口径，"没判成"与"判了没过阈"在库里同形**，且结论**无人消费**（无通道）。⇒ 这不是"实现成本"问题，是**判据口径**问题。
- **本仓自己的落点**：唯一提到这件事的地方是**说明为什么不做** —— `packages/working-memory/src/compression.ts:17-21`：「第一层不是 ITACL 专属（C16 已拍板不移植 ITACL：宿主 agent/pre-step 只返回 reject/enter，**没有「信息充足度」通道** ⇒ 无处安放「JEV 判断哪些步骤还要用」）」。**单条 grep 命中"充足度"，且内容是"没有通道"**（实测：`grep -rn '充足性' packages/*/src` = 0；`充足度` = 1 行，即此）。

**② 结论**：**无此场景**。**建议不改**（不建阈值、不建判定点）。若日后真要做，前置条件是**宿主先给出充足度回执面**，属上游变更，不是本仓能"补"的。

### 3.2 安全守门（0.8）→ **场景存在、线没接；建议不改（登记为可选接线项）**

**① 属不属于 ITACL 域？—— 不属于。**

- v10 §23 把它挂在「**调度**」链条（`docs/mana-v10-status-plan.md:1222` 逐列读作：链条=调度 · 接入点=安全守门 · 模型=JEV · 原语=Noul · 阈值=0.8 · 策略=Fail-closed），**不在 §19/§20 的 ITACL 域**。（同一张表里 ITACL 行是 `:1223-1230`，逐行标「整块不移植」。）
- ⚠ **口径更正**：`docs/mana-next-plan-2026-09-27.md:175` 写「如『安全守门』属 §19 的 ITACL 域」—— **与 v10 原文不符**（§23 表把它归调度）。本席按原文标出，**不代表它就该做**。

**② 该归到哪个模块/事件？—— `tools/pre-execute`（工具调用前 waterfall），属宿主扩展点，不是 Mana 事件。**

- **宿主面确实存在**：`node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:47`：`'tools/pre-execute'(this, exec, next): Promise<PreToolDecision>`，注释 `:37-46`：「Allow, deny, cancel, or ask before dispatch」；`PreToolDecision` 定义在 **`:444-455`**（`allow` / `deny{reason}` / `cancel` / `ask`）—— **正是 v10「安全守门（fail-closed）」所需要的形态**；`exec` 带 `name`（`:223`）与 `arguments`（`:227`）。
- **本仓的现有落点（只有半条链）**：
  - **prompt 有**：`packages/prompts/src/scheduling.ts:39-47`（`SAFETY_GATE_PROMPT(action)`），已进注册表 `packages/prompts/src/registry.ts:91`，**`wired:true`**。
  - **消费面没有**：它的消费者是 `packages/prompts/src/index.ts:186`（re-export）、`packages/prompts/tests/prompts.test.mjs:59`（判据）；**无任何运行时消费者**（实测 `SAFETY_GATE_PROMPT` 全仓 8 条引用：定义 1 + import 1 + 注册表 1 + re-export 1 + 判据 4，逐条核过，**无调用点**）。
  - **⚠ 该 `wired:true` 的语义是"注册表级"、不是"接线到宿主"**：同一字段在 `packages/prompts/src/registry.ts:56` 的注释原文是「`false` = 定义在册但**不得接线到宿主**」，反例是 ITACL 两条（`registry.ts:93-94`）。`SAFETY_GATE_PROMPT` 标 true 并**不**意味着有人调它 —— **标 true 与"真被消费"是两件事**。此点如实标出（否则会被读成"安全守门已接线"）。
  - **本仓零监听**：`tools/pre-execute` 在 `packages/**` **零消费者**（全仓 `ctx.on` 事件集合实测，唯一出现是在 `chains.ts:325` 的一句注释里被提及）。

**③ 结论**：**场景存在**（工具调用前的安全检查），**归属清楚**（`tools/pre-execute` + `SAFETY_GATE_PROMPT` + `mana/jev/judge` 三块现成件**都在**，缺的只是一条接线），但 —— **建议本卡不改**，理由三条：
1. **0.8 这个数没有本机基线**：按 `docs/contract/threshold-discipline.md:12` 的 A 档口径（确定性、跨运行逐字复现），0.8 是**被测分布未知**的目标值；本仓既有闸（`attention` 0.7、`recall-gate` 0.7、`write-gate` 0.7）也**都不是校准结果**（缺省值，samples=0 口径见 `packages/forgetting/src/criteria.ts:112-121`）。⇒ 直接写 0.8 = 造第 4 个未校准数。
2. **它是新功能，不是缺口修补**：本卡是只读勘察；接一条 fail-closed 工具闸会**改变工具调用的放行行为**（写面外、影响面大，需独立批次 + 独立审查）。
3. **⚠ 最大的现实风险是"反成松绑"**：fail-closed 的本意是"判不出就不放行"。若接线时缺省写成 fail-open，本仓既有安全姿态（宿主 approval 面：`dsh-user-approval`、`dsh-sandbox-policy`）**会被静默削弱** —— 这正是「拆东墙补西墙」。要做必须**前置拍板缺省语义**（推荐 fail-closed：`degraded ⇒ deny`）。

**④ 若日后拍板要做，最小接线面（供决策，不在本卡实施）**：`ctx.on('tools/pre-execute', …)`（waterfall，**必须调 next()**，同 `agent/pre-step` 的 G9 义务）→ 取 `exec.name` + `exec.arguments` 渲染 `SAFETY_GATE_PROMPT` → `ctx.waterfall('mana/jev/judge', …)`（**复用既有判定链，不新造**）→ `prob ≥ threshold ? allow : deny{reason}`，降级按拍板语义。**未实施、未验证。**

### 3.3 遗忘优先级（0.3）→ **无此场景，建议不改**

**① 属不属于 ITACL 域？—— 不属于。** v10 §23 挂在「遗忘」链条（`docs/mana-v10-status-plan.md:1209` 逐列读作：链条=遗忘 · 接入点=遗忘优先级 · 模型=JEV · 原语=**Score** · 阈值=0.3 · 策略=按激活值），§26 在 `:1412`。

**② 值锚定在错误量纲上（决定性的读码依据）**：

- v10 **同页相邻两行自相矛盾**：`:1208`（活性分级）= `JEV | **Choice**`，`:1209`（遗忘优先级）= `JEV | **Score** | 0.3`。Choice 的取值是**离散标签**（本仓对应的 `ACTIVITY_LEVEL_PROMPT` 的 criteria 是 `{hot, warm, cold}`，`packages/prompts/src/forgetting.ts:7-15`）—— **不存在"活性级别 ≥ 0.3"这个比较**。
- 在本仓语义下，0.3 只可能被解释成 **"修剪评分 > 0.3 即遗忘候选"**。而这个数**已经存在等价物**：`packages/forgetting/src/criteria.ts:64`（`PRUNE_SCORE_THRESHOLD_V10 = 0.7`，v10 自述值），登记项 `forgetting.prune.scoreThreshold`（`criteria.ts:122-138`，**`samples: 0`，结论 `insufficient-data（无本机基线）`**），**缺省不启用**（`packages/forgetting/src/prune.ts:47-51`：只有调用方**显式**传 `scoreThreshold` 才生效，且读数恒带 `scoreThresholdCalibrated: false`）。
- ⇒ 把 0.3 搬进来 = 在同一个模块里放**第二个**未校准的评分阈值，且**没有任何被测对象**：全仓**不产出任何剪枝评分分布**（`criteria.ts:134` 的 recheck 原文：「产生修剪评分分布（**≥30 条**）后按『候选命中率』预注册判据校准」—— 该前置**未满足**）。
- **本仓实际怎么裁决"忘不忘"**：确定性闭式，**不是 JEV** —— `packages/forgetting/src/prune.ts`（激活缺口 `A ≤ τ − 0.5`，τ 缺省 `-2.0`，见 `criteria.ts:78-103` 两条登记项）与 `packages/forgetting/src/retention.ts:2`（`retention(t)=exp(-t/S)`）。而且遗忘链在生产侧**只列候选、不写 `retired`**（`chains.ts:60`、`:1473-1482` 的 `retiredWritten: 0`）。
- **顺带如实指出一处措辞**：v10 §26 的"失败策略=**按激活值**"在本仓是**现状描述**而非"失败降级"（`:1412`；v10 自己也写 `按激活值排序`，见 `docs/deepseek_markdown_20260924_c7ffea.md:179`）—— 这项**本来就不需要 JEV**，它的"失败策略"栏等于"照旧跑"。

**③ 结论**：**无此场景**（本仓没有"JEV 判遗忘优先级"这个动作，也不需要：有确定性闭式 + 只列候选）。**建议不改**。若将来真有评分分布（≥30 条），正确动作是**校准既有的 `forgetting.prune.scoreThreshold`**（它已经登记在册、有 recheck 与 rollback 计划），**而不是新加一个 0.3**。

---

## 4. 未验证项清单（如实列，不许省）

1. **运行态未验证**：本报告全部是**静态读码 + grep + `wc -l`**，**没有真跑过** `npm test` / `tools/a0-check.mjs` / `tools/a1-check.mjs`，没有执行过任何链路。`agent/pre-step` 与 `agent/turn-stopping` 的**实际触发次数/时序**未实测（结论只依据宿主 `.d.ts` 契约文本）。
2. **`RETRIEVE` 行（§1.4 #7）判为"降级对应且未接线"**：依据是「`ctx.on('mana/recall')` 全仓 0 命中」这一条**静态事实**；**未跑过** `vector.recall()` 端点，故「`mana/recall` 是否在别的通道（如 UI 面板直连 service）被消费」**未验证**（本席只 grep 了 `packages/*/src` 与 `tests`）。
3. **`chains.ts` 的 10 类 label 是否只写不读**：`packages/scheduler/src/chains.ts:82-114` 的 10 个 `TRACE_EVENTS` 标签，本席核了"写点"与导出面，**没有**逐个反查"谁在读这些 trace 行" ⇒ 「标签是否有消费者」**未验证**（不影响 MA-F01 的"4 状态有效"结论，因为那 4 个状态用的是另两个事件名）。
4. **`payload.step`**：已核 `node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:308` 声明存在、且 `attention/src/index.ts` 全程未读它；但**未验证**宿主在 `step` 上放的值在实践中的分布（是否恒从 0 起）。
5. **`docs/arch/mana-overview.md` / `mana-MA-F01-cognition-loop.md` 的"零源码"判断已过期**：这是**读注释文字**得出的（`overview.md:4`、`MA-F01:4`），未核对两档的生成时间与 `nav` 模型版本；「该文件该不该重生成」**未验证、需拍板**。
6. **`_freeze.*` 的当下判据状态未跑**：本席只读了 `_freeze.files.txt`（91 行）/ `_freeze.sha256`（2 行）/ `_freeze.head`（= `8a2bfae`）与 `_freeze.log` 的**前 20 条**；流水共 **21 条**，第 20 条之后的 A0-12 六腿**真实跑态未验证**（引用了 `docs/handoff/N1/` 的记录称有"已知不可收口项"，本席**未复核**）。
7. **§3.2「安全守门」接线面**：`tools/pre-execute` 的 `exec.arguments` 在**真实调用中**的形状（`read`/`write`/`bash` 各自参数结构）**未验证** —— 若日后做，需要先取一份真实 `exec` 样本。
8. **审计时间线未用**：`mana_trace` / `inject_log` 的实际库内容（`/home/lk/.dsh/memory/mana.db`）**未读**，本报告不含任何运行数据（本卡只读勘察，未开库）。
9. **"未发现"项（如实报，不凑数）**：`docs/mana-v10-status-plan.md` 的**行号锚点全部有效** —— 仓内 4 处带行号的引用（`packages/forgetting/src/renorm.ts:4` + `tests/renorm.test.mjs:4` → `:674-683` = 「### 13.6 突触重归一化」✅；`packages/reconsolidation/src/index.ts:19` → `:1840` = 「26 列 vs 23/25 列」口径提示 ✅；`docs/handoff/B3.2-R-recall-gate.md:87` → `:1256` = Recall Gate 行 ✅）。本席按"文档锚点可能漂移"的既有教训核查了这 4 处，**未发现漂移**。

---

## 5. 建议汇总（改什么 / 不改什么）

| # | 建议 | 理由（一句话） |
|---|---|---|
| 1 | **不改代码**（三项阈值全部不落） | 三项里两项无场景、一项（安全守门）缺接线且 0.8 无基线；挂上去 = 造"没有被测对象的阈值"（`schema.ts:61-64` 的既有尺子） |
| 2 | **不改 `docs/contract/**`** | 冻结集的 `files.txt` 91 行**全是源码**、`sha256` 只钉 2 个源文件（实测 `wc -l`）；`docs/contract/*.md` 不在冻结面内，但 `naming.md` 有 A0-5 机检面（`tools/a0-check.mjs:487-521`），掺入非命名内容会把机检面搅浑 |
| 3 | **对应表的落点 = `docs/arch/mana-MA-F01-cognition-loop.md`（需先重生成）** | 它是 L2 特征主链档、问的正是同一个问题（`MA-F01:4` 的"读法一行"）；但该档现述"零源码"已过期，**先重生成再写**，否则是往过期文档里加内容 |
| 4 | **若一定要进源码：只进 `packages/core/src/domain.ts`** | 它是契约唯一归属地（`domain.ts:4`）；代价是 `_freeze.files.txt:10` + `_freeze.sha256` 哈希漂移，三件套须走 `--record-baseline` 授权路径重取 |
| 5 | **`VERIFYING` 是唯一"新发现"的真缺口（登记，不实现）** | 连"结果验证"这一步都不存在（`chains.ts` 的 10 类 label 无 verify/result 类 + `RESULT_CLASSIFICATION_PROMPT` 为 `wired:false`）；且 `turn-stopping` 回执为 `void`，宿主无"验证不通过 ⇒ 退回"通道 |
| 6 | **登记"安全守门可接线"为可选批次（不本卡做）** | 三件现成件都在（prompt / 判定链 / 宿主 waterfall），缺的是一条接线；但属新功能 + 需先拍板 fail-closed 语义，**须独立批次与独立审查** |
| 7 | **口径更正（供文档订正，不在本卡改）** | ① `docs/mana-next-plan-2026-09-27.md:175`「安全守门属 §19 ITACL 域」与 v10 §23 原文不符（它在调度链）；② `docs/mana-v10-status-plan.md:1218` 把"不熟悉检测"归因于"MCL 在守藏侧"，与 ITACL 域无关（其 prompt `UNFAMILIAR_TASK_PROMPT` 已在册且 `wired:true`，但生产调用点 0） |

---

## 6. 复算命令（本报告全部数字的取证）

```bash
# ① 12 状态名零命中（逐条；单跑 rc=1）
for s in PRE_TASK EXECUTING VERIFYING COMPLETED PLANNING ACTING OBSERVING JUDGING CONTINUE RETRIEVE DIAGNOSE COMPLETE; do
  printf "%-12s " $s; grep -rn --include=*.ts "\b$s\b" packages/*/src | wc -l; done

# ② 全仓监听的事件集合（用于 "tools/pre-execute / agent/error / mana/recall / mana/decision 零消费者"）
# ⚠ 必须先剥注释：attention/src/index.ts:48 的注释**原文就写着** "无任何 ctx.on('mana/decision', …)"
#   ⇒ 裸 grep 会把"说明它不存在的那句话"当成"它存在"（本席实测踩到一次，属本仓点名的"注释冒充代码"形态）
grep -rn "ctx\.on('mana/\|ctx\.on('agent/\|ctx\.on('tools/" packages/*/src | grep -vE ': *[*/]'
# 实测（代码行，非注释）= mana/observation ×2 · mana/jev/judge · mana/attention ×2 · mana/injection
#   · agent/pre-step ×2 · agent/disposed · agent/inbox/inserted · agent/turn-stopping
#   ⇒ 代码里**没有** mana/decision · mana/recall · agent/error · tools/pre-execute（四者零监听）

# ③ §26 三项零命中
for k in 任务前充足性 安全守门 遗忘优先级; do printf "%-14s " "$k"; grep -rn "$k" packages/*/src | wc -l; done

# ④ 冻结三件套规模（证明 files.txt 全是源码、sha256 只有 2 个源文件）
wc -l docs/contract/_freeze.files.txt docs/contract/_freeze.sha256   # 91 / 2
grep -c '^docs' docs/contract/_freeze.files.txt                     # 0

# ⑤ mana/recall 的发送点与零消费者
grep -rn "emit('mana/recall'" packages/*/src                        # vector/src/index.ts:435
grep -rn "ctx.on('mana/recall'" packages/*/src || echo '(0 消费者)'

# ⑥ 源码规模（用于 L2 档"零源码"已过期的核对）
wc -l packages/*/src/*.ts | tail -1                                  # 30919 total
```
