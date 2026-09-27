# Mana 进度检查（对照 v10 · 全量审计 · 2026-09-27）

> **取数口径**：每一项结论都由本席**当场跑命令**得出。凡未实测者显式标「未验证」。
> 本档**不引用任何文档自述**为完成依据 —— 只认"src 里有落点 + 有生产路径"。

---

## 〇、一句话结论

**17 个包全部在盘，v10 的 40 章里绝大多数模块有实现。**
真缺口**只有 3 项**（下表 §2），且**都不是"没写代码"，而是"契约要求了、实现没跟上"**。
另有 1 项属**契约级未落**（I3/I4 只落一半）。

---

## 一、逐章核对（v10 §1–§40）

### ✅ 已实现且实测在盘

| v10 章节 | 本仓落点（实测） |
|---|---|
| §4 ACT-R 激活方程 | `long-term/src/activation.ts`（幂律 + 时间衰减，`params.ts`） |
| §5 SOAR 三阶段 | `consolidation`（chunking）+ `learning` |
| §6 JEV 决策模型 | `jev/`（`framework`/`ollama`/`systemone`/`jev-log-gate`） |
| §8 神经科学四过程 | `consolidation` / `forgetting` / `reconsolidation` 三包 |
| §10 七链条 | `scheduler/src/chains.ts`（`SEVEN_CHAIN_TABLE`，5 wired / 2 attributed） |
| §12.1 编码流程 8 步 | ①perception ②③LLM ④Write Gate ⑤**vector（K1 已通）** ⑥long-term ⑦storage ⑧broadcast |
| §12.3 会话蒸馏 | `consolidation/src/distill.ts`（E1 已接 scheduler） |
| §12.4 内在奖励 SN/VTA | `intrinsicReward` 在盘 |
| §12.5 大环路递归 | `vector/src/bigloop.ts` + `bigloop-wiring.ts`（E2 已接） |
| §13.5 深度睡眠 | `深度睡眠` 在盘 |
| §13.6 突触重归一化 | `forgetting/src/renorm.ts`（E3 已 done） |
| §14.3 混合召回 | `vector/src/rrf.ts` + `recall.ts`（⚠ 见 §2.1 的结构性边界） |
| §14.4 RRF 融合 | `rrf.ts` |
| §14.5 三道门控 | Recall / Injection / Write Gate **三处都在** |
| §16.3 记忆活性分级 | `activityLevel` 在盘 |
| §16.5 小胶质细胞修剪 | `microglia` 在盘 |
| §16.7 幂律遗忘 | `powerLaw` 在盘 |
| §17.1 学习三条路径 | Hebbian 已真接（scheduler learning 链 → `applyCoActivations`） |
| §18.3 认知环 MCL | 在盘 |
| §21 子代理委派 | 在盘 |
| §24 JEV 批量调用 | `batch` 在盘（5 处） |
| §26 阈值校准 | **部分**：Recall/Injection/Write 三个已消费（见 §2.3） |
| §30 三层上下文压缩 | `working-memory` 在盘 |
| §31 长任务三件套 | `goalStack` 在盘 |
| §35 核心插件代码 | JEV/LLM/Vector 三件在盘 |
| §36 核心表结构 | `memory_items`（25 列实测）+ `vec0Semantics` |
| §38.2 降级链路 | `degraded` 分类在盘（J1 又补了 `unsupported-by-server`） |
| §39 四层评估 | `tools/eval-l1-l4.mjs`（MEASURED 4） |
| §39.3 消融实验 | `tools/a6-ablation.mjs` 在盘 |
| §19 ITACL | **架构选型差异**（见 §3），非缺功能 |

### ❌ 真缺口（3 项，逐条实测）

见下 §2。

---

## 二、真缺口逐条（全部实测，可复算）

### 2.1 🔴 G-1：检索不变式 **I3 未落**

**v10 §14.6 原文**（四条不变式）：
> I1：每个 (session, turn) 最多注入一个记忆块
> **I2：每条记忆在每个 session 中最多注入一次**
> **I3：压缩后不永久沉默**
> I4：前缀缓存友好

**实测**：
| 不变式 | 落点 | 状态 |
|---|---|---|
| I1 | `core` 有 | ✅ |
| I2 | `attention/src/index.ts:354`（**有完整判据 + 假绿防护 + 逐出留痕**） | ✅ 很扎实 |
| **I3** | `grep 永久沉默 / silence / uncollapse` ⇒ **零命中** | ❌ **未见落点** |
| I4 | `attention:22/1231`（尾部追加、前缀哈希逐字节相等） | ✅ |

⚠ **I3 是"压缩后不永久沉默"** —— 而本仓 `working-memory/src/compression.ts` **确有压缩**。

**✅ 已深挖确认（从"未验证"升为"实测确认未落"）**：
```
compression.ts:250  const foldedSeqs = new Set(head.map((c) => c.seq))
compression.ts:251  const tail = chunks.filter((c) => !foldedSeqs.has(c.seq))   ← 折叠的**直接剔除**
```
- 被折叠的 N 条**直接移出 chunks**，只留一条 `foldSummary`；
- `working-memory` 的导出面（`index.ts:68-198`）**没有**"把折叠过的块放回来"的任何入口；
- `attention`（注入侧）**对 compression 零引用**（`grep compress` 命中 0）⇒ 注入侧也不知道有块被折叠过。

⇒ **I3「压缩后不永久沉默」在本仓无实现、无判据、无观测点** —— 被折叠的记忆**在本轮内即永久消失**。
⚠ 后果形态（本仓首位缺陷类）：**"压缩生效"与"内容被丢弃"在读数上同形** ——
`CompressionRecord` 记了 `foldedChunks`/`savedChars`（**压缩了多少**），
但**没有任何字段回答"被折叠的那些还能不能被找回"**。
**推进动作**：补 I3（至少要有"可再注入/复活"路径 + 判据；只记账不算落）。

**② §14.6 的 I3 与 `working-memory` 的 `keepRecent` 是两件事**（勿混）：
`keepRecent` 保证"**留 N 条原文不压**"，那防的是"全压成摘要丢一手内容"；
I3 要求的是"**压掉的不得永久沉默**" —— 前者管**压谁**，后者管**压了之后的命运**。

### 2.2 🔴 G-2：§15.4 **测试效应**无落点

**v10 §15.4 原文**：
> | 检索类型 | 保持增强 |
> | 再认 | 0.05 |
> | 回忆 | 0.15 |
> | 精细提取 | 0.25 |

**实测**：`再认`/`精细提取`/`recognition`/`elaborat` ⇒ **全部零命中**；
`testingEffect`/`retrievalBoost`/`保持增强` ⇒ **零命中**；
`reconsolidation/src/params.ts` 只有 `WINDOW_MS_BY_TYPE`（窗口），**没有按检索类型的保持增益**。

⇒ **测试效应（testing effect）在本仓未实现**。这是**真缺一个模块**。
⚠ 但它属 §15 再巩固链条的一个**子特性**（不是整条链缺失）。
**推进动作**：可作为独立小卡（给"检索行为"加保持增益，且须**可分辨**再认/回忆/精细三档）。

### 2.3 🟡 G-3：§26 **阈值表 8 项只消费 3 项**

**实测**（逐项 grep）：
| v10 §26 场景 | 本仓落点 |
|---|---|
| Recall Gate | ✅ `long-term` |
| Injection Gate | ✅ `attention` |
| Write Gate | ✅ `long-term` |
| 任务前充足性 | ❌ 零命中（仅 `working-memory` 注释提到"没有充足度通道"） |
| 安全守门 | ❌ 零命中 |
| 遗忘优先级 | ❌ 零命中 |

⚠ **"未消费"≠"该做"**：这三项可能属 §19/§20 的 ITACL 域（本仓用事件驱动实现，见 §3）。
⇒ **须与 ITACL 一并判断**，不单独开工。

### 2.4 🟡 G-4：§13.4 **系统巩固三阶段**只有"再巩固"具名

**v10 §13.4 原文**：突触巩固（分钟-小时）/ **系统巩固（海马→新皮层转移，小时-年）** / 再巩固。

**实测**：`突触巩固`/`synaptic` ⇒ 零命中；`系统巩固`/`systemsConsolidation` ⇒ 零命中；
`再巩固` ⇒ 7 文件（**有**）；`neocort` ⇒ 3 文件（`consolidate.ts` 有 `NeocortexEntry`/`no_neocortex`）。

⇒ **"再巩固"具名实现**；**"系统巩固"有 neocortex 概念但没有三阶段的显式建模**。

**✅ 已深挖（结论：不是缺口，是"只落了 v10 表格里的一格"）**：
`consolidate.ts:68` 有 `readonly neocortex: readonly NeocortexEntry[]`，
`:82` 有 `novel(no_neocortex)`、`:108` 有 `no_neocortex` 分支 ——
即：**"往新皮层转移"的判定与入口在盘**（这正是 §13.4 表格里"系统巩固"那格的内容）。
v10 的"三阶段"是**神经科学的分类叙述**（突触/系统/再巩固三者的时间尺度对比），
**不是要求三个独立模块**；本仓把"再巩固"与"系统巩固（neocortex）"分别落在
`reconsolidation/` 与 `consolidation/consolidate.ts` ⇒ **覆盖了表格的两格**。
⇒ **判定：非缺口**（原先的"零命中"是**中文关键词**造成的假阴性 —— 本仓用 `neocortex` 而非"系统巩固"）。
⚠ 此行**推翻本席本档 §2.4 的原判**，如实记。

---

## 三、ITACL（§19–§21）：架构选型差异，**非缺口**（已勘察）

**v10 §19 的 12 个状态名**：`PRE_TASK`/`EXECUTING`/`VERIFYING`/`COMPLETED`/
`PLANNING`/`ACTING`/`OBSERVING`/`JUDGING`/`CONTINUE`/`RETRIEVE`/`DIAGNOSE`/`COMPLETE`
⇒ **实测全部零命中**。

**但 ITACL 三阶段功能都在**，只是**按事件摊开**：
| v10 阶段 | 本仓落点 |
|---|---|
| 一 任务前信息采集 | `agent/pre-step`（attention waterfall） |
| 二 执行中观察-反馈 | `mana/observation` + `mana/decision`（契约已冻结） |
| 三 完成与固化 | `agent/turn-stopping` → 七链条 |

⇒ **不补状态机**（会与既有事件面重复并引入第二真源）。
**可做的低风险小事**：加一段「v10 状态名 ⇄ 本仓事件名」对应表，让"ITACL 在哪"有唯一归属地。

---

## 四、按严重度排序的推进建议

| # | 缺口 | 性质 | 建议 |
|---|---|---|---|
| **1** | **G-1 I3 未落** | **契约要求了、实现没跟上**（最该先做） | 只读勘察 → 补实现或补判据 |
| 2 | G-2 测试效应 | 真缺一个子模块 | 可独立开卡（须三档可分辨） |
| 3 | G-4 系统巩固三阶段 | **可能是命名差异** | 只读勘察即可结清 |
| 4 | G-3 §26 三项阈值 | 依赖 ITACL 判断 | 与 §3 一并判断 |
| 5 | §3 ITACL 对应表 | 文档小事 | 低风险，可顺手做 |

**排序口径**：先"契约要求了但没落"（会让人以为有保证而其实没有），再缺功能，最后命名/文档。

---

## 五、诚实声明

- **本档所有"零命中"结论都是 grep 级证据**，其中 G-1/G-4 已标「未验证」（未逐行读码）
  ⇒ 推进动作一律是**先只读勘察**，不在未勘察前开工。本席此前已有**两次 grep 假阳性**教训
  （模块扫描正则写错 77 条假阳性、章节核对中文关键词造成 6 条假阴性），故本轮**每一项都做了英文/别名复验**。
- **G-1 的严重性判断依据**：I1/I2/I4 都有实测落点且 I2 判据扎实 ⇒ I3 的缺失是**孤立**的，
  而非"这个包整体没做"。
- 本档**不含**任何未实测的"应该已经做了"式推断。

## 六、复算命令

```bash
# 逐章关键词核对（含英文/别名复验）
for p in packages/*/src/*.ts; do grep -l "关键词" "$p"; done

# I1-I4
grep -rn "I1\|I2\|I3\|I4" packages/attention/src/index.ts packages/core/src/*.ts | grep -v "^\s*\*"

# §15.4 测试效应（应零命中）
grep -rn "testingEffect\|retrievalBoost\|保持增强\|再认\|精细提取" packages/*/src/*.ts

# §26 阈值
for k in 任务前充足性 安全守门 遗忘优先级; do grep -rl "$k" packages/*/src/*.ts; done

# §13.4 系统巩固
grep -rn "突触巩固\|系统巩固\|synaptic\|neocort" packages/*/src/*.ts
```
