# Mana（末那识）：认知架构模拟与长期 AI 助手

> 版本：v5.0（Mana 终版）
> 项目名：Mana（末那识）
> 定位：基于 DSH（DeepSeek Harness）插件体系，融合 ACT-R 认知架构理论、SOAR 目标栈与 chunking、JEV 决策模型、向量混合检索，构建可长期辅助用户的认知型 AI Agent。
> 核心思路：ACT-R 提供记忆激活与遗忘的数学基础，SOAR 提供目标栈与技能学习机制，JEV 实现 System One 快判断，向量检索实现语义召回，LLM 实现 System Two 深推理。
> 插件前缀：`dsh-mana-*`
> 文化根基：佛教唯识学第七识「末那识」——恒审思量，我执，连接感知与藏识

---

## 目录

1. 项目概述
2. 文化根基：末那识与认知架构
3. 理论基础与权威来源
4. 总体架构
5. 认知内核机制详述
6. JEV 决策层设计
7. 向量模型与混合检索
8. 记忆巩固与遗忘机制
9. DSH 插件化实现
10. 多 Agent 并行开发
11. 存储与数据模型
12. 可靠性保障体系
13. 评估框架
14. 故障模式与对策
15. 算法与框架决策
16. 技术选型
17. 路线图
18. 风险评估
19. 附录

---

## 1. 项目概述

### 1.1 项目名

| 项 | 内容 |
|---|---|
| 中文名 | **末那识** |
| 英文名 | **Mana** |
| 拼音 | Mònà |
| 梵文 | Manas |
| 全称 | Mana：认知架构模拟与长期 AI 助手 |
| 副标题 | 恒审思量的认知内核 |
| 插件前缀 | `dsh-mana-*` |
| 数据库 | `mana.db` |
| 事件域 | `mana/*` |
| 认知轨迹表 | `mana_trace` |

### 1.2 项目目标

构建一个**认知架构模拟系统**，作为 DSH 插件集合运行，实现：

- 模拟人类记忆机制（感觉、工作、长时记忆），基于 ACT-R 的激活方程建模记忆的编码、检索、衰减和巩固
- 通过 JEV 模型实现 System One 快速认知决策（注意力门控、记忆写入判断、检索重排）
- 通过向量模型 + BM25 + 图遍历实现混合检索
- 通过 LLM 实现 System Two 深度推理和任务执行
- 作为长期 AI 助手，通过 SOAR 风格的 chunking 机制持续学习任务技能
- 通过末那识「恒审思量」的文化内核，构建持续运行、持续陪伴、持续判断的长期助手

### 1.3 核心设计原则

| 原则 | 理论来源 | 工程实现 |
|---|---|---|
| 快慢双系统 | 卡尼曼双过程理论 / Jev-Mem 论文 | JEV（System One）+ LLM（System Two） |
| 记忆激活衰减 | ACT-R 激活方程 | 基础激活 + 关联激活 + 时间衰减 |
| 目标驱动学习 | SOAR chunking | 任务完成后自动编译产生式规则 |
| 有限工作记忆 | ACT-R 容量限制假设 | 工作记忆窗口 ≤ 4 个组块 |
| 混合检索 | 向量 + 关键词 + 图 | RRF 融合 + JEV 重排 |
| 记忆三道门控 | dsh-memory-jev 设计 | Write Gate / Recall Gate / Injection Gate |
| 恒审思量 | 唯识学末那识 | 持续运行的元认知与用户模型 |
| 可靠降级 | 故障模式分析 | 每层独立降级策略 + 熔断 + 审计 |

---

## 2. 文化根基：末那识与认知架构

### 2.1 末那识的定义

末那识（梵语：Manas-vijñāna）是佛教唯识学中的**第七识**，梵文 Manas，意为「意」或「思量」。

根据《佛学大辞典》和《成唯识论》等权威资料：

| 特性 | 含义 |
|---|---|
| **梵语** | Manas（音译「末那」），意为「意」或「思量」 |
| **地位** | 八识中的第七识 |
| **核心功能** | **恒审思量**（持续不断地思量、判断） |
| **根本作用** | **我执**（执第八识阿赖耶识为「我」） |
| **与第六识的区别** | 第六识名为「意识」，为「依主释」（依末那而生）；第七识为「持业释」（本身就是意） |

《成唯识论》卷四说：「是识圣教别名末那，**恒审思量胜余识故**。」意思是，虽然八个识都有思量作用，但只有第七识同时具备「恒」（不间断）和「审」（有分别、有判断）两个特点，因此独得「末那」之名。

### 2.2 四识思量特性对比

| 识 | 恒 | 审 | 说明 |
|---|---|---|---|
| 前五识 | ✗ | ✗ | 非恒非审，有间断、无深度思量 |
| 第六识 | ✗ | ✓ | 审而非恒，思量强烈但有间断 |
| **第七识（末那识）** | **✓** | **✓** | **亦恒亦审，持续不断地执我** |
| 第八识 | ✓ | ✗ | 恒而非审，相续不断但无分别 |

这一对比清晰地说明了为什么末那识是「恒审思量」的专属。它是唯一一个**从不间断、且持续进行判断**的识，这正是长期 AI 助手「持续陪伴、持续认知」的完美隐喻。

### 2.3 八识体系中的定位

```
第八识（阿赖耶识）── 异熟能变 ── 根本识，含藏一切种子
        │
        ▼
第七识（末那识 / Mana）── 思量能变 ── 恒审思量，执第八识为我
        │
        ▼
前六识（眼耳鼻舌身意）── 了别境能变 ── 感知与思维
```

末那识的双重角色：

1. **作为「意根」**：它是第六意识生起的所依。前五识各有自己的俱有依，而第六意识以末那识为俱有依。
2. **作为「我执」的根源**：它恒常执取阿赖耶识的见分为「我」，是我痴、我见、我慢、我爱四种根本烦恼的载体。

### 2.4 与项目的精确映射

| 项目概念 | 末那识隐喻 |
|---|---|
| **认知内核持续运行层** | 恒审思量，从不间断 |
| **用户模型 + 个性化** | 我执——持续执取用户为「我」的长期模型 |
| **元认知** | 末那识的「审」——持续的自我监控 |
| **JEV 快判断** | 末那识的「恒审」——持续快速、不假思索的判断 |
| **工作记忆 ↔ 长时记忆的枢纽** | 末那识作为第六意识与第八识之间的依止 |
| **长期 AI 助手** | 恒审思量，持续陪伴 |

### 2.5 学术合理性

关于末那识与 AI 自我模型的对应关系，已有学术研究指出：**当系统开始将过去经验认作自己的经验，将长期记忆认作自己的记忆，将持续目标认作自己的目标时，便开始形成类似末那识所代表的主体认同机制**。这一论断直接验证了 Mana 项目命名的学术合理性。

另有研究者将末那识的功能类比为**强化学习的策略网络与动态奖励偏置系统**，其功能是持续地、潜意识地执取「自我」。这为 `dsh-mana-user-model` 插件提供了更深层的设计思路。

---

## 3. 理论基础与权威来源

### 3.1 ACT-R 认知架构

ACT-R 是卡内基梅隆大学开发的认知架构，将人类认知分为两个核心记忆系统：陈述性记忆（存储事实、事件和经历）和程序性记忆（存储技能和动作）。ACT-R 不区分情景记忆和语义记忆，所有陈述性知识都表示为模型经历过的所有 chunk 的完整集合。

**记忆激活方程（核心公式）**：

```
A_i = B_i + S_i + P_i + ε
```

其中：
- **A_i**：chunk i 的总激活值
- **B_i**：基础激活值，由过去使用频率和时间决定
- **S_i**：关联激活，来自当前工作记忆中的源元素
- **P_i**：部分匹配惩罚
- **ε**：噪声项，服从逻辑分布

检索机制：所有 chunk 的激活值被计算后，声明性模块返回激活值最高且超过阈值 τ 的 chunk；否则信号检索失败。

**遗忘与学习定律**：该方程同时产生幂律遗忘（个体经历强度按幂函数衰减）和幂律学习（个体经历按暴露次数的幂函数累积强度）。

**检索概率**（逻辑分布）：

```
Prob_i = 1 / (1 + e^(-(A_i - τ) / s))
```

其中 s 与激活方差相关：s = √3σ/π。

**检索延迟**：

```
Time_i = F · e^(-f · A_i)
```

其中 F 是时间尺度因子，f 是激活缩放因子。

**容量限制假设**：ACT-R 假设注意力资源有限，源激活总和受到约束：∑W_j = 1。

### 3.2 ACT-R 工程实现库调研

| 库 | 类型 | 特点 | 适用场景 |
|---|---|---|---|
| **pyactup** | 声明性记忆 | 轻量级 ACT-R 声明性记忆子集实现，最新版本 2.2.5（2026-03） | 算法参考，TypeScript 移植 |
| **python_actr** | 完整架构 | Carleton 大学维护，**不支持 Python 3.12+** | 不直接使用 |
| **pyactr** | 完整架构 | 更新活跃 | 认知建模实验 |
| **Clarion** | 混合架构 | 实验性 Python 实现，显性/隐性双系统 | 暂不采用 |

**决策**：参考 pyactup 的算法实现，用 TypeScript 复现核心激活方程。pyactup 的声明性记忆模块提供了基础激活的幂律衰减计算、关联激活的源激活传播、检索概率的逻辑分布和部分匹配惩罚机制。

### 3.3 SOAR 认知架构

SOAR 是一个通用问题求解认知架构，使用算子（operator）在状态之间转换并产生结果，基于知识 chunk 并使用基于规则的记忆实现更高效的问题求解。

SOAR 的学习机制包括：

- **Chunking**：从目标导向的经验中获取规则。当子目标成功完成时，chunking 将解决该子目标所产生的结果编译为新的产生式规则，存储在长时记忆中。
- **强化学习**：优化算子的效用值
- **情景记忆集成**：chunking 将学到的动作序列编码为产生式规则

SOAR 的三个工作阶段：分析阶段检查当前状态与存储规则的匹配；决策阶段基于规则偏好选择算子；行动阶段应用选定的算子更新系统状态。

### 3.4 JEV 决策模型

JEV 是 TypeSafe AI 发布的 System One 决策模型，不生成任何文字，直接输出带概率的结构化判定。支持三种类型化原语：

| 原语 | 回答的问题 | 返回内容 |
|---|---|---|
| **Choice** | 从给定选项中选一个 | 选中选项 + 每个选项的概率 + 置信度 |
| **Noul** | 某个陈述成立的概率 | 是/否的概率（0–1） |
| **Score** | 在有序量表上的位置 | 加权位置 + 每级概率 + 置信度 |

**关键特性**：JEV 从不生成文本，仅返回类型化决策。所有文本内容始终由插件控制。这个特性构成了记忆系统的安全边界：模型决定「是否值得保留」「替换哪条旧记忆」「检索到的记忆是否真正相关」，但**模型永远无法创造记忆内容**。

**实测数据修正**：JEV 在记忆筛选中的表现并非在所有场景下都优于 LLM。增加判断层既能提升准确性，也可能引入新错误和增加成本。输入截断可能导致判断模型「失明」。**结论**：JEV 应作为**可选优化层**而非强制层，并提供完整的降级路径。

### 3.5 Jev-Mem 论文

Jev-Mem（arXiv:2609.23986）提出了 System-One 控制的 Agentic Memory 架构。System One 捕获快速、轻量级决策，System Two 执行较慢的审慎推理。System-One 控制器在构建期间管理记忆类型和关系组织，并在检索期间动态执行查询路由、检索预算分配、图遍历、候选评分和自适应停止。

**LoCoMo 基准测试数据**（GPT-4o-mini 作为答案模型，LLM-as-Judge 评分）：

| 方法 | Overall Score ↑ | 构建时间(s) ↓ | 查询延迟(s) ↓ |
|---|---|---|---|
| Full Context | 0.481 | N/A | 1.74 |
| A-MEM | 0.580 | 3,636 | 2.26 |
| MemoryOS | 0.553 | 3,276 | 32.68 |
| Nemori | 0.590 | 1,044 | 2.59 |
| MAGMA | 0.700 | 1,404 | 1.47 |
| **Jev-Mem** | **0.777** | **158** | **0.93** |

- 答案质量：0.777 vs MAGMA 的 0.700，**绝对增益 0.077，相对提升 11.0%**
- 构建速度：158s vs Nemori 的 1,044s，**6.6 倍加速**
- 查询延迟：0.93s vs MAGMA 的 1.47s，**降低 36.7%**

---

## 4. 总体架构

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ DSH 宿主进程（Node.js / TypeScript）                                    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Mana 认知内核插件层（每个 = 独立 DSH Bundle 插件）                  │ │
│  │                                                                    │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │ │
│  │  │perception  │  │attention   │  │working-mem │  │scheduler   │ │ │
│  │  │前五识·感知 │  │作意·门控   │  │第六识·思维 │  │目标栈调度  │ │ │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ │ │
│  │        │               │               │               │        │ │
│  │        ▼               ▼               ▼               ▼        │ │
│  │  ┌──────────────────────────────────────────────────────────────┐│ │
│  │  │  Cordis 事件总线（类型化声明合并 + 5 种分发模式）            ││ │
│  │  │  mana/observation/* · mana/memory/* · mana/goal/*           ││ │
│  │  │  mana/action/* · mana/jev/* · mana/metacognition/*         ││ │
│  │  └──────────────────────────────────────────────────────────────┘│ │
│  │        │               │               │               │        │ │
│  │        ▼               ▼               ▼               ▼        │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │ │
│  │  │long-term   │  │consolidat. │  │forgetting  │  │metacognit. │ │ │
│  │  │第八识·藏识 │  │熏习·巩固   │  │种子·衰减   │  │末那识·审   │ │ │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘ │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐│ │
│  │  │ 决策与检索层                                                 ││ │
│  │  │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         ││ │
│  │  │ │mana-jev      │ │mana-vector   │ │mana-ui       │         ││ │
│  │  │ │末那识·恒审   │ │向量检索      │ │可视化面板    │         ││ │
│  │  │ └──────────────┘ └──────────────┘ └──────────────┘         ││ │
│  │  │ ┌──────────────┐                                           ││ │
│  │  │ │mana-user-model│  末那识·我执                              ││ │
│  │  │ └──────────────┘                                           ││ │
│  │  └──────────────────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ DSH 官方服务（插件通过 inject 声明依赖）                           │ │
│  │ ctx.tools · ctx.llm · ctx.sessions · ctx.storage · ctx.client    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

**Cordis 框架核心特性**：Cordis 的核心假设是「服务可以随时出现，也可以随时消失」。提供方被卸载时，所有依赖它的插件自动卸载（effect 回滚）；新提供方就绪后自动重载，依赖方不需要写任何重连代码。此外还有 `ctx.isolate(key, realm)` 隔离机制和 `ctx.intercept(key, meta)` 拦截机制。

### 4.1 八识映射图

```text
┌─────────────────────────────────────────────────────────────┐
│               末那识（Mana）── 恒审思量 · 我执                │
│                                                             │
│    ┌──────────────────────────────────────────────────┐    │
│    │  认知内核持续运行层                               │    │
│    │  = 元认知 + 用户模型 + JEV 恒审判断               │    │
│    │  = dsh-mana-metacognition                        │    │
│    │  + dsh-mana-user-model                           │    │
│    │  + dsh-mana-jev                                  │    │
│    └──────────────────────────────────────────────────┘    │
│                          │                                  │
│         ┌────────────────┼────────────────┐                │
│         ▼                ▼                ▼                │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐           │
│   │ 前五识   │    │ 第六识   │    │ 第八识   │           │
│   │ 感知     │    │ 意识     │    │ 藏识     │           │
│   │          │    │          │    │          │           │
│   │ 眼耳鼻   │    │ 思维     │    │ 记忆     │           │
│   │ 舌身     │    │ 判断     │    │ 种子     │           │
│   │          │    │ 工作记忆 │    │ 长时记忆 │           │
│   │perception│    │working-mem│   │long-term │           │
│   │attention │    │scheduler │    │consolid. │           │
│   └──────────┘    └──────────┘    └──────────┘           │
│         │                │                │                │
│         └────────────────┼────────────────┘                │
│                          ▼                                  │
│                   ┌──────────────┐                          │
│                   │  JEV 快判断  │  ← 末那识的"恒审"       │
│                   │  LLM 深推理  │  ← 第六识的"审"         │
│                   └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 认知内核机制详述

### 5.1 陈述性记忆激活机制（ACT-R 工程化）

```
A(memory) = B(memory) + S(memory) + P(memory) + ε

其中：
  B(memory) = ln( Σ_j (t_j)^(-d) )          基础激活：幂律衰减
    t_j = 第 j 次访问至今的时间（秒）
    d   = 衰减指数（默认 0.5）

  S(memory) = Σ_k W_k · S_kj               关联激活：源激活传播
    W_k = 源 k 的注意力权重（∑W_k = 1）
    S_kj = 源 k 与记忆 j 的关联强度

  P(memory) = 部分匹配惩罚（默认 0）

  ε ~ Logistic(0, s)                        噪声项
    s = √3 · σ / π
```

**工程参数建议**：

| 参数 | 值 | 说明 |
|---|---|---|
| 衰减指数 d | 0.5 | 控制遗忘速度，越大遗忘越快 |
| 检索阈值 τ | -2.0 | 低于此值不返回 |
| 噪声 σ | 0.3 | 产生检索随机性 |
| 时间尺度 F | 0.35s | ACT-R 默认检索时间因子 |
| 缩放因子 f | 0.8 | 激活到延迟的映射 |
| 基础产出时间 | 50ms | 产生式规则执行时间 |

**检索概率与延迟计算**：

```typescript
const probability = 1 / (1 + Math.exp(-(activation - threshold) / s));

const latency = activation >= threshold
  ? F * Math.exp(-f * activation) * 1000
  : F * Math.exp(-f * threshold) * 1000;
```

### 5.2 程序性记忆与 Chunking 学习（SOAR 工程化）

当工作记忆中的子目标成功完成时，触发 chunking 机制：

1. **编码阶段**：记录子目标的初始状态、使用的算子序列和最终状态
2. **解码阶段**：回溯产生式规则的触发条件
3. **连接阶段**：将新规则添加到程序性记忆，建立与其他规则的关联

```typescript
interface ProductionRule {
  id: string
  conditions: WorkingMemoryPattern[]
  actions: WorkingMemoryAction[]
  utility: number
  successRate: number
  cost: number
  strength: number
  sourceGoalId?: string
}
```

**Chunking 触发条件**：
- 子目标状态从 active → done
- 该子目标关联的算子序列长度 ≤ 可配置上限（建议 7）
- 该模式重复出现 ≥ 2 次

### 5.3 工作记忆容量限制

基于 ACT-R 的容量限制假设，工程实现约束：

- 工作记忆窗口最多持有 **4 个组块**（源于 Miller 7±2 的修正）
- 源激活权重总和约束为 1：`∑W_j = 1`
- 超过容量时，按激活值排序，低激活项自动外挂到 TODO / 笔记

### 5.4 调度器与目标栈

基于 SOAR 的三阶段工作循环：

```text
分析阶段：当前工作记忆状态与产生式规则匹配 → 候选算子集合
决策阶段：按效用值 + 成功率 + 成本选择最优算子
行动阶段：执行算子 → 更新工作记忆状态
```

目标栈结构：

```text
GoalStack:
├─ [Goal-1] 完成项目文档          priority=8, status=active
│  ├─ [Goal-1.1] 收集资料         priority=6, status=done
│  ├─ [Goal-1.2] 写大纲           priority=7, status=active
│  │  └─ [Action-1.2.1] 整理第3节 priority=5, status=running
│  └─ [Goal-1.3] 写初稿           priority=5, status=paused
└─ [Interrupt] 同事消息           priority=9, status=pending
```

---

## 6. JEV 决策层设计

### 6.1 三道门控机制

| 门控 | 触发时机 | JEV 判断 | 失败策略 |
|---|---|---|---|
| **Write Gate** | `mem_remember` 调用时 | 本地 bigram 预过滤 → Jev fan-out：`worth_keeping` (noul) + `supersedes` (choice over candidates + none) | **Fail-open**：仍然写入；仅标记 `gate=unavailable\|budget` |
| **Recall Gate** | `mem_recall` 调用时 | 词法预过滤 Top-N → 每个候选执行 `rel_<id>` noul → 按概率过滤和排序 | **Fail-degraded**：回退本地排序，标记 `degraded` |
| **Injection Gate** | `agent/pre-step` 阶段 | 廉价文本门控 → 候选池减法 → Jev 相关性判断 → 在尾部追加框架化用户快照 | **Fail-closed**：不注入任何内容（沉默优于噪音） |

**不变式约束**：

- **I1**：每个 `(session, turn)` 最多注入一个记忆块；同一 turn 的后续步骤不再判断或注入
- **I2**：每条记忆在每个 session 中最多注入一次；已注入的 ID 在 JEV 调用前从候选池中移除
- **压缩后不永久沉默**：注入块离开上下文后，其 ID 重新变为可注入（日志记录 `reset`）
- **自标识块**：用 `<retrieved-memories>` 框架标记；内容中的 `<` 转义为 `\u003c`
- **前缀缓存友好**：仅在尾部追加；系统提示和历史记录保持字节级一致

### 6.2 JEV 在各认知模块中的应用表

| 认知模块 | 唯识对应 | JEV 原语 | 判断问题 | 阈值 |
|---|---|---|---|---|
| 注意力门控 | 作意 | Noul | 此信息是否与当前目标高度相关？ | 0.7 |
| 工作记忆更新 | 第六识 | Choice | 保留哪个/丢弃哪个？ | — |
| 长时记忆写入 | 第八识·熏习 | Noul | 此信息是否值得长期保存？ | 0.6 |
| 记忆检索重排 | 第八识·现行 | Noul | 此记忆是否真的有助于回答当前问题？ | 0.5 |
| 巩固触发 | 熏习 | Noul | 当前会话是否值得巩固？ | 0.5 |
| 遗忘决策 | 种子衰减 | Score | 此记忆的衰减优先级？ | 0.3 |
| 目标优先级 | 第六识 | Choice | 当前应该聚焦哪个目标？ | — |
| 工具路由 | 第六识 | Choice | 调用哪个工具？ | — |
| 安全守门 | 末那识·审 | Noul | 此操作是否安全？ | 0.8 |
| 用户模型更新 | 末那识·我执 | Choice | 用户偏好如何变化？ | — |

### 6.3 JEV 插件提供的完整工具集

| 工具 | 用途 |
|---|---|
| `mem_remember` | Write Gate；无论门控结果如何都持久化（返回 `persisted`） |
| `mem_recall` | Recall Gate；返回 `{gate, degraded, items[]}`，`jev_prob` 和 `local_score` 分别保留 |
| `mem_list` / `mem_view` | 列表 / 查看记忆详情 |
| `mem_forget` / `mem_restore` | 软删除 / 恢复 |
| `mem_merge` | 将一个旧条目的内容折叠到新条目中，然后软删除旧条目 |
| `mem_pin` | 跳过相关性阈值，每个 session 最多一次 |
| `mem_gate_status` | 查询消耗/预留/剩余/调用次数/熔断器/密钥存在性/存储路径 |
| `mem_gate_log` | 审计日志查询（仅 ID 和哈希，不包含内容体） |

**关键设计原则**：物理删除永不发生 — 删除始终是 `retired=true` 且可逆。

### 6.4 批量判断与缓存设计

- 同一场景的多个判断合并为一次 JEV fan-out
- Write Gate 示例：同时问 `worth_keeping` (noul) + `supersedes` (choice over candidates + none)
- Recall Gate 示例：对 Top-50 候选同时发起 `rel_<id>` noul 判断

| 策略 | 实现 |
|---|---|
| 缓存 | 相同 state hash + question 缓存 TTL 300s |
| 降级 | JEV 不可用时回退本地规则/向量相似度排序 |
| 熔断 | 连续失败 ≥ 5 次触发熔断，冷却 60s |
| 成本控制 | 每次 session 设置 JEV 调用预算上限 |

---

## 7. 向量模型与混合检索

### 7.1 检索流水线

```text
查询 → 查询意图识别
     → 并行执行：
       ├─ 向量检索（纯 JS 余弦；sqlite-vec 为可选加速）→ Top 50
       ├─ 关键词检索（FTS5 BM25）→ Top 50
       └─ 图遍历（可选）→ Top 20
     → RRF 融合 → 统一排序
     → JEV Recall Gate 逐条判断相关性
     → 时间衰减加权
     → 返回 Top N
```

### 7.2 RRF 融合算法

```
RRF_score(d) = Σ_r  1 / (k + rank_r(d))

其中：
  k = 60（标准平滑常数）
  rank_r(d) = 文档 d 在第 r 路检索中的排名
```

### 7.3 嵌入模型选型

| 模型 | 维度 | 上下文 | 特点 | 成本 |
|---|---|---|---|---|
| BGE-M3 | 1024 | 8192 | 多语言、混合检索（dense+sparse+multi-vector） | 免费（自托管） |
| text-embedding-3-small | 1536 | 8191 | 英文为主、API 调用 | $0.02/1M tokens |
| text-embedding-3-large | 3072 | 8191 | 高精度需求 | $0.13/1M tokens |

**推荐**：BGE-M3，支持多语言、混合检索表示，且在含噪声文本中表现优异。

### 7.4 时间衰减加权

```
final_score = RRF_score · decay(time_elapsed, half_life)
decay(t, h) = exp(-t · ln(2) / h)

其中：
  h = 14 天（默认半衰期，可配置）
  t = 记忆最后访问至今的天数
```

---

## 8. 记忆巩固与遗忘机制

### 8.1 巩固触发与动作

| 触发条件 | 动作 | 唯识对应 |
|---|---|---|
| 任务结束（Goal status → done） | 总结会话、合并相似记忆 | 熏习 |
| 每日定时（凌晨 3 点） | 批量摘要、抽象成语义知识 | 熏习 |
| 用户强调（情绪效价 > 0.7） | 强化记忆强度 +0.2 | 有漏种子 |
| 相似记忆重复出现 ≥ 3 次 | 合并为高层语义记忆 | 种子增长 |
| 子目标成功完成 | 触发 SOAR chunking，生成产生式规则 | 无记种子 |

### 8.2 遗忘策略（基于艾宾浩斯遗忘曲线）

```
retention(t) = exp(-t / S)

其中：
  t = 距上次访问的时间
  S = 记忆强度（随重复访问增加）

S 的更新规则（Pavlik & Anderson 2005 间隔重复模型）：
  S_new = S_old + ΔS
  ΔS = a · (S_max - S_old)^b
```

**遗忘执行规则**：

| 激活值区间 | 动作 |
|---|---|
| A > τ + 1.0 | 正常保留，高优先级检索 |
| τ < A ≤ τ + 1.0 | 正常保留 |
| τ - 0.5 < A ≤ τ | 标记为「衰退中」，降低注入优先级 |
| A ≤ τ - 0.5 | 归档（retired=true），可恢复 |
| 超过 90 天未访问且 A < τ - 1.0 | 压缩为统计摘要 |

### 8.3 物理删除原则

物理删除永不发生，删除始终是 `retired=true` 且可逆。支持 `mem_merge` 将一个旧条目的内容折叠到新条目中，然后软删除旧条目。

---

## 9. DSH 插件化实现

### 9.1 Mana 插件清单

| 插件名 | 职责 | 唯识对应 | 优先级 | 依赖 |
|---|---|---|---|---|
| `dsh-mana-core` | 事件类型、数据模型、共享 schema | — | P0 | 无 |
| `dsh-mana-jev` | JEV 适配层、缓存、降级、熔断 | **末那识·恒审** | P0 | core |
| `dsh-mana-vector` | 嵌入模型适配、向量检索、RRF 融合 | — | P0 | core |
| `dsh-mana-perception` | 输入采集、分块、实体抽取 | 前五识 | P0 | core |
| `dsh-mana-attention` | 注意力门控、JEV 筛选 | 作意 | P0 | core, jev |
| `dsh-mana-working-memory` | 工作记忆、容量管理、上下文组装 | 第六识 | P0 | core |
| `dsh-mana-long-term` | 记忆编码、激活方程、检索 | 第八识·藏识 | P1 | core, jev, vector |
| `dsh-mana-scheduler` | 目标栈、SOAR 三阶段循环 | 第六识·思维 | P1 | core |
| `dsh-mana-consolidation` | 巩固、合并、chunking | 熏习 | P1 | core, long-term |
| `dsh-mana-forgetting` | 衰减、归档、压缩 | 种子衰减 | P1 | core, long-term |
| `dsh-mana-metacognition` | 置信度、知识缺口检测 | **末那识·审** | P2 | core |
| `dsh-mana-user-model` | 用户偏好、习惯、项目 | **末那识·我执** | P2 | core |
| `dsh-mana-ui` | Client 半区、记忆可视化 | — | P2 | core |

**核心特性**：`dsh-mana-jev`、`dsh-mana-metacognition`、`dsh-mana-user-model` 三个插件是末那识的直接对应，应作为项目核心特性重点标注。

### 9.2 插件标准结构

DSH 插件的最小可安装 bundle 需要三个文件：`package.json`（声明 `dsh.bundle`）、`cordis.patch.yml`（定义该 bundle 挂载哪些插件 id）、`index.js`（插件模块本体）。插件本体仍是完整 Cordis 插件（`apply(ctx)` + `defineTool` 等）。

```text
dsh-mana-attention/
├── package.json          # dsh.bundle 声明 + exports
├── cordis.patch.yml      # 向 host 组合插入插件行
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts          # name / inject / Config / apply
│   ├── attention.ts      # 核心逻辑
│   ├── event-types.ts    # 事件声明（零 import，declaration merging）
│   └── client/
│       └── index.tsx     # 可选：Client 半区
├── tests/
└── README.md
```

### 9.3 事件契约设计

Cordis 的事件系统是类型化的，事件名和监听器签名靠 TypeScript 声明合并获得全链路类型安全。

| 模式 | 语义 | 适用场景 |
|---|---|---|
| `emit` | 同步广播；不等待、不收集返回值 | 通知类事件 |
| `parallel` | 所有监听器并发执行并等待 | 并行检索 |
| `serial` | 按序执行；第一个非空返回值胜出 | 优先级决策 |
| `bail` | serial 的同步版本 | 同步决策 |
| `waterfall` | 环绕中间件，每个监听器收到参数和 next() continuation | 决策链、拦截 |

**waterfall 模式**是 DSH 用得最多的模式，本质是把 Koa、Express 的中间件搬进事件系统。在 DSH 里：工具执行管道 `tools/pre-execute → tools/execute → tools/post-execute` 就是一条 waterfall 链。

**DSH 明文纪律**：只负责观察和记录的 waterfall 监听器必须调用 `next()`，否则会无声地吞掉下游所有默认行为。

```typescript
// dsh-mana-core/src/event-types.ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    // 前五识：感知
    'mana/observation': Observation

    // 第六识：工作记忆与思维
    'mana/focus': Focus
    'mana/working-memory/update': WorkingMemoryUpdate
    'mana/goal/created': Goal
    'mana/action/executed': ActionResult

    // 末那识：恒审与元认知
    'mana/jev/judge': (req: JevJudgeRequest, next: () => Promise<JevJudgeResult>) => Promise<JevJudgeResult>
    'mana/jev/judged': JevJudgeResult
    'mana/metacognition/confidence': ConfidenceReport
    'mana/metacognition/gap': KnowledgeGap

    // 第八识：藏识
    'mana/memory/encoded': MemoryEncoded
    'mana/memory/retrieved': MemoryRetrieved

    // 检索（parallel）
    'mana/retrieval/search': RetrievalRequest
  }
}
```

### 9.4 插件入口示例

```typescript
// dsh-mana-attention/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'mana-attention'
export const inject = ['mana-core', 'mana-jev']

export interface Config {
  maxFocusItems: number
  jevThreshold: number
}

export const Config: Schema<Config> = Schema.object({
  maxFocusItems: Schema.number().default(4),
  jevThreshold: Schema.number().default(0.7),
})

export function apply(ctx: Context, config: Config) {
  ctx.on('mana/observation', async (obs) => {
    ctx.emit('mana/jev/judge', {
      id: `att-${obs.id}`,
      type: 'noul',
      state: obs.content,
      question: `这条信息是否与当前目标"${getCurrentGoal()}"高度相关？`,
      threshold: config.jevThreshold,
      source: 'attention',
    })
  })

  ctx.on('mana/jev/judged', (result) => {
    if (result.source !== 'attention') return
    if (result.degraded) return fallbackAttention(result)
    if (result.value && result.probability > config.jevThreshold) {
      ctx.emit('mana/focus', { id: result.requestId, content: result.state })
    }
  })
}
```

### 9.5 Schema 校验与配置管理

插件用 schema 声明配置结构（schemastery），Cordis 在调用 `apply` 前校验。配置非法则加载失败并给出精确错误，**插件绝不会在配置不完整时半启动**。

### 9.6 本地调试流程

DSH 支持 HMR：服务启动后，用户 `cordis.patch.yml` 的变更会被 boot 事务性重读。Profile 概念将应用拆成可叠加的层。

```bash
mkdir dsh-mana-attention && cd dsh-mana-attention
# 在 DSH 的 cordis.patch.yml 中加一行指向你的 src/index.ts
dsh --profile dev --dump-config
npm run build
dsh plugin --profile dev add ./dsh-mana-attention
```

---

## 10. 多 Agent 并行开发

### 10.1 Agent 分工表

| Agent | 负责插件 | 交付物 | 依赖 |
|---|---|---|---|
| Agent-Contract | `dsh-mana-core` | 事件类型、数据模型、共享 schema | 无 |
| Agent-JEV | `dsh-mana-jev` | JEV 适配层、缓存、降级、熔断 | Contract |
| Agent-Vector | `dsh-mana-vector` | 嵌入适配、RRF 融合、重排 | Contract |
| Agent-Perception | `dsh-mana-perception` | 输入采集、分块、实体抽取 | Contract |
| Agent-Attention | `dsh-mana-attention` | JEV 门控、筛选逻辑 | Contract, JEV |
| Agent-WorkingMem | `dsh-mana-working-memory` | 容量管理、上下文组装 | Contract |
| Agent-LongTerm | `dsh-mana-long-term` | 激活方程、编码、检索 | Contract, JEV, Vector |
| Agent-Scheduler | `dsh-mana-scheduler` | 目标栈、SOAR 循环 | Contract |
| Agent-Consolidation | `dsh-mana-consolidation` | 巩固、合并、chunking | Contract, LongTerm |
| Agent-Forgetting | `dsh-mana-forgetting` | 衰减、归档、压缩 | Contract, LongTerm |
| Agent-Metacognition | `dsh-mana-metacognition` | 置信度、知识缺口 | Contract |
| Agent-UserModel | `dsh-mana-user-model` | 用户偏好、习惯、项目 | Contract |
| Agent-UI | `dsh-mana-ui` | Client 半区、可视化 | Contract |

### 10.2 并行开发流程

```text
第 1 步：Agent-Contract 冻结契约（1–2 周）
  → 产出 dsh-mana-core v0.1.0
  → 定义所有事件类型和领域模型

第 2 步：Agent-JEV + Agent-Vector 并行开发适配层（2–3 周）

第 3 步：所有认知 Agent 并行开发（4–6 周）

第 4 步：每日集成
```

### 10.3 契约变更流程

1. 提契约 PR → 2. 架构 Agent 评审 → 3. 更新 contracts 版本 → 4. 更新 Mock 和 Fixture → 5. 通知所有依赖组 → 6. 各组适配 → 7. 每日集成验证

### 10.4 依赖规则

```text
contracts 不依赖任何业务模块
services 依赖 contracts
services 之间通过事件通信，不直接 import 实现
apps 依赖 services
禁止循环依赖、跨模块数据库访问
```

---

## 11. 存储与数据模型

### 11.1 存储方案

DSH 生态推荐 SQLite（`node:sqlite`），零外部依赖。存储路径：`$DSH_HOME/memory/mana.db`。

### 11.2 核心表结构

```sql
CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  source TEXT,
  tags TEXT,
  base_level_activation REAL DEFAULT 0,
  strength REAL DEFAULT 0.5,
  decay_factor REAL DEFAULT 0.5,
  retrieval_threshold REAL DEFAULT -2.0,
  jev_relevance REAL,
  jev_worth_keeping REAL,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_timestamps TEXT,
  access_count INTEGER DEFAULT 0,
  emotional_valence REAL DEFAULT 0,
  emotional_arousal REAL DEFAULT 0,
  vector BLOB,
  related_ids TEXT,
  retired INTEGER DEFAULT 0
);

CREATE TABLE production_rules (
  id TEXT PRIMARY KEY,
  conditions TEXT NOT NULL,
  actions TEXT NOT NULL,
  utility REAL DEFAULT 0.5,
  success_rate REAL DEFAULT 0.5,
  cost REAL DEFAULT 0,
  strength REAL DEFAULT 0.5,
  source_goal_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  priority INTEGER DEFAULT 0,
  deadline TEXT,
  success_criteria TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE user_model (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  updated_at TEXT NOT NULL
);

CREATE TABLE mana_trace (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE jev_log (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,
  source TEXT NOT NULL,
  state_hash TEXT,
  result_value TEXT,
  probability REAL,
  cached INTEGER DEFAULT 0,
  degraded INTEGER DEFAULT 0,
  latency_ms INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL
);
```

### 11.3 存储路径

```text
$DSH_HOME/memory/mana.db
```

---

## 12. 可靠性保障体系

### 12.1 多层级可靠性设计

| 层级 | 保障机制 | 说明 |
|---|---|---|
| 数据层 | SQLite WAL 模式 + 定期备份 | 防止数据丢失 |
| 存储层 | 软删除 + 恢复 + 审计日志 | 操作可追溯、可逆 |
| JEV 层 | 缓存 + 熔断 + 降级 | 服务不可用时流程不中断 |
| 检索层 | 多路检索 + RRF 融合 | 单路失败不影响整体 |
| 调度层 | 事务性事件 + 幂等操作 | 防止重复执行 |
| 插件层 | Cordis effect 回滚 | 插件卸载时自动清理 |

### 12.2 降级链路总表

| 组件 | 正常路径 | 降级路径 | 最终兜底 |
|---|---|---|---|
| JEV 判断 | JEV API 调用 | 缓存命中 → 本地规则 | 向量相似度排序 |
| 向量检索 | 纯 JS 余弦（BLOB 物化） | 关键词 FTS5（trigram） | 时间排序 |
| 嵌入模型 | BGE-M3 自托管 | API 调用 | 关键词匹配 |
| LLM 推理 | DSH ctx.llm | 小模型降级 | 模板回复 |
| 记忆注入 | JEV Injection Gate | 本地规则门控 | 不注入（沉默） |

### 12.3 一致性保障

| 场景 | 机制 |
|---|---|
| 并发写入 | SQLite 事务 + WAL 模式 |
| 事件顺序 | mana_trace 表记录 seq 序列号 |
| 幂等操作 | 每个操作带唯一 ID，重复执行安全 |
| 状态恢复 | 插件重启后从 mana_trace 回放 |

### 12.4 安全边界

- JEV 只做判断，不生成内容：模型无法创造记忆内容
- 记忆块自标识：`<retrieved-memories>` 框架 + 转义 `<` 为 `\u003c`
- 审计日志仅记录 ID 和哈希，不包含内容体
- 物理删除永不发生：删除始终是 `retired=true` 且可逆

---

## 13. 评估框架

### 13.1 评估分层

| 层级 | 评估内容 | 指标 | 工具/基准 |
|---|---|---|---|
| L1 任务有效性 | 任务完成情况 | 成功率、事实正确率、计划完成率 | AMA-Bench |
| L2 记忆质量 | 记忆准确性、完整性 | 记忆命中率、检索精度、遗忘曲线拟合度 | LoCoMo / LoCoMo-Plus |
| L3 效率 | 性能与成本 | 延迟、token 消耗、检索调用次数、存储增长 | 自定义仪表盘 |
| L4 认知仿真 | 认知机制是否像人 | 反应时分布、错误模式、学习曲线、双任务干扰 | CogArena 范式 |

CogArena 提供了一个程序化生成的 13 范式基准，覆盖工作记忆、认知控制、情景记忆、心智理论和元认知五个分组。

### 13.2 核心评估指标

**认知指标**：

| 指标 | 定义 | 目标 |
|---|---|---|
| 记忆命中率 | 能检索到该检索的记忆的比例 | > 85% |
| 遗忘曲线拟合度 | 实际遗忘与艾宾浩斯曲线的 R² | > 0.8 |
| 检索延迟 | 从查询到返回记忆的时间 | < 500ms |
| 巩固效果 | 巩固后记忆强度的提升幅度 | 可量化 |
| Chunking 加速 | 重复任务的执行时间下降 | > 30% |

**助手指标**：

| 指标 | 定义 | 目标 |
|---|---|---|
| 任务完成率 | 用户任务被成功完成的比例 | > 80% |
| 用户满意度 | 用户主观评分 | > 4/5 |
| JEV 降级率 | JEV 不可用时的降级比例 | < 5% |
| 缓存命中率 | JEV 判断缓存命中比例 | > 40% |
| 用户模型精度 | 用户偏好预测准确率 | > 75% |

### 13.3 消融实验设计

| 实验 | 去掉的模块 | 预期结果 |
|---|---|---|
| 去掉 JEV | 所有 JEV 判断替换为本地规则 | 任务完成率下降，延迟降低 |
| 去掉 ACT-R 衰减 | 记忆永不衰减 | 检索精度下降 |
| 去掉工作记忆限制 | 不限制工作记忆容量 | 上下文超限，成本上升 |
| 去掉巩固 | 不做定时巩固 | 长期记忆碎片化 |
| 去掉元认知 | 不做置信度评估 | 错误率上升 |
| 去掉用户模型 | 不做我执 | 个性化下降 |

### 13.4 行为测试方法论

参考认知架构的行为测试方法论，使用行为测试来明确架构实现中对理论至关重要的方面。通过将架构的性能拟合到观察到的行为，并使用适当的优化算法来调整参数。

Newell Test 的 12 条标准可用于评估认知架构的理论完备性：灵活行为、实时性能、自适应行为、庞大知识库、动态行为、知识整合、自然语言、学习、发展、进化、大脑实现。

---

## 14. 故障模式与对策

| 故障模式 | 影响 | 检测方式 | 对策 |
|---|---|---|---|
| JEV API 超时 | 判断延迟 | 超时计时器 | 熔断 + 降级到本地规则 |
| JEV 误判 | 错误记忆被写入/丢弃 | 审计日志对比 | 低概率触发 LLM 复核 |
| 向量库不可用 | 检索失败 | 健康检查 | 降级到 FTS5 |
| SQLite 锁竞争 | 写入失败 | 重试计数 | 事务重试 + WAL 模式 |
| 插件加载失败 | 认知循环断裂 | Cordis 加载日志 | effect 回滚 + 自动重载 |
| 工作记忆溢出 | 上下文超限 | token 计数 | 自动摘要 + 外挂到 TODO |
| 记忆爆炸 | 存储无限增长 | 存储监控 | 衰减 + 归档 + 压缩 |
| 前缀缓存失效 | 成本上升 | 缓存命中率 | 仅尾部追加，保持前缀一致 |
| 输入截断 | JEV 判断失明 | 输入长度检查 | 分段判断 + 合并结果 |
| 用户模型漂移 | 个性化失效 | 精度监控 | 定期重训 + 用户确认 |

---

## 15. 算法与框架决策

### 15.1 认知架构框架：算法参考，实现自研

| 框架 | 语言 | 可用性 | 决策 |
|---|---|---|---|
| python_actr | Python | 完整 ACT-R 实现，不支持 Python 3.12+ | 不直接使用 |
| pyactup | Python | 轻量级 ACT-R 声明性记忆子集，最新 2.2.5（2026-03） | 算法参考 |
| pyClarion | Python | CLARION 实验性实现 | 暂不采用 |
| JSoar | Java | 纯 Java SOAR，OpenSSF 评分 3/10 | 不直接使用 |
| LIDA | Java | 需填写表格接受许可 | 不采用 |

**决策**：参考 pyactup 的算法实现，用 TypeScript 复现 ACT-R 核心激活方程和 SOAR chunking 机制。

### 15.2 Agent 记忆框架：工程模式借鉴，不直接集成

| 框架 | 核心模式 | 优势 | 局限 |
|---|---|---|---|
| Mem0 | 通用记忆层，输入与已有记忆做相似性查询后融合关联 | 声称准确率提升 26%，延迟降低 91% | 被质疑基准测试数据造假 |
| Letta/MemGPT | 显式记忆块 + 归档/召回记忆 | 状态化 Agent，记忆管理更可控 | 架构较重，与 DSH 重叠 |
| Zep | 时序知识图谱记忆 | 时序推理能力强 | 集成复杂度高 |

**决策**：不直接集成 Mem0/Letta。借鉴其核心设计模式：写入门控、来源追溯 + 审计轨迹、可逆性、每日日志 + 摘要的情景记忆模式。

### 15.3 DSH 插件生态：直接复用已有插件

| 插件 | 功能 | 与 Mana 的关系 |
|---|---|---|
| dsh-shoucang-memory（守藏） | 会话蒸馏自动沉淀 + 深度睡眠反思归纳 + 词法+向量混合召回 + 主动遗忘 | 核心参考：本地向量 bge-m3 + RRF 融合，未配置向量服务自动降级为纯词法 |
| ~~dsh-memory~~ | ~~分层 + 图谱 + 时间维度 + 向量语义检索，sqlite-vec KNN 余弦 + FTS5 BM25 + 关键词三路 RRF 融合~~ ⇒ **实测不符实**：`dsh-memory@0.1.0` 仅 5 个文件、`grep vec0/sqlite-vec/rrf/cosine/bm25` 零命中，README 自述无嵌入服务 ⇒ 纯 FTS5 词法件 | **不采用** |
| dsh-hindsight-memory | 本地 Hindsight daemon（PostgreSQL + pgvector + DeepSeek embeddings） | 参考：pgvector 方案 |
| dsh-graphmemory | 知识图谱记忆，双路召回，PageRank 社区发现 | 参考：图记忆层实现 |
| dsh-memoria | 向量 + 图记忆层接入 DSH | 参考 |
| dsh-memory-jev | JEV 三道门控记忆 | 直接复用 |

**决策**：DSH 插件层直接复用社区成熟插件。sqlite-vec + FTS5 + RRF 融合直接采用 dsh-memory 的实现模式；bge-m3 + Ollama 采用 dsh-shoucang-memory 的本地向量方案；所有插件遵循「未配置向量服务自动降级为纯词法」的模式。

### 15.4 JEV 开源复现：多方案可选

| 项目 | 方案 | 特点 |
|---|---|---|
| APUS fast-browser-use | 单 Token Logits 快速决策，跳过自回归解码 | 全球最早一批跨平台复现 |
| JEV-CPU | 在 CPU 上运行 Jev-style 语义 if 决策 | 适合无 GPU 环境 |
| ~~LitJev~~ | 将 Qwen 全系列模型变成 Jev 式快速决策层，无需训练 | ⚠ **本机不可行**：需 Qwen3.8-27B + H100 80GB（本机 RTX 2070S 8GB）；改用本机 Ollama logprob |
| jev-forge | 端到端工具包 | 适合需要自定义训练的场景 |

**决策（2026-09-24 按本机环境适配）**：**改用本机 Ollama 的 logprob 单 token 原语**合成 Jev 式决策 —— `/api/chat` + `think:false` + `logprobs:true` + `top_logprobs:5` + `num_predict:1` + `temperature:0`，从 pos0 取 yes/no 归一概率。理由：LitJev 需 H100 80GB，本机物理不可行；且本机 Ollama 已常驻（`:11434`）零 token 成本。⚠ **判据只认 `logprobs`**：实测 `content` 在 `temperature:0` 下仍不确定、且与 `logprobs` 的 argmax 可不一致（采样 token ≠ argmax）。备选：JEV-CPU（原方案备选，未实测）。

### 15.5 向量检索索引算法

| 算法 | 召回率 | 查询速度 | 内存占用 | 适用场景 |
|---|---|---|---|---|
| HNSW | 95%+ | 极快 | 较高 | 高精度实时查询 |
| IVF-Flat | 95%+ | 快 | 中等 | 平衡精度与内存 |
| IVF-PQ | 70-90% | 快 | 低 | 内存受限、大规模向量 |

**决策**：**主通道为物化 BLOB + 常驻 `Float32Array` 的纯 JS 余弦**（一万条规模实测优于 vec0）；`sqlite-vec` 的 `vec0` 虚表作**规模化升级项**（数据量 >10 万条启用），启用时须固定 `distance_metric=cosine` 并用 `float[]` 维度显式声明。若未来增长到需要独立向量数据库，再考虑 pgvector（HNSW 索引）。

### 15.6 记忆遗忘与巩固算法

| 方案 | 核心机制 | 借鉴价值 |
|---|---|---|
| FadeMem | 生物启发的 Agent 记忆主动遗忘机制 | 主动遗忘机制设计 |
| Oblivion | 将遗忘定义为衰减驱动的可访问性降低，而非显式删除 | 与 ACT-R 衰减方案一致 |
| ACT-R-Inspired Memory | 将 ACT-R 与 LLM 集成，实现基于上下文、时间和使用频率的动态检索与遗忘 | 直接验证了本方案的可行性 |
| SAGE | 基于艾宾浩斯遗忘曲线的记忆优化 | 巩固策略参考 |
| CORTEX | 学习、巩固、衰减、情绪、再巩固的认知架构 | 情绪模块参考 |

**决策**：采用 ACT-R 激活方程 + 艾宾浩斯遗忘曲线的组合方案。已有学术工作验证了这一组合在 LLM Agent 中的有效性。FadeMem 和 Oblivion 的主动遗忘机制可以作为 forgetting 插件的增强参考。

### 15.7 混合检索 RRF

**决策**：直接采用标准 RRF 算法（k=60），**自行实现**（约 30 行，闭式值 `1/(60+rank)`，`[1,1]` 融合分 `0.032787` 可逐字复现）。⚠ 原稿称「sqlite-vec 已实现 `recall_hybrid` 方法」**不实** —— `sqlite-vec` 仅提供 `vec0` KNN（本机实测 `vec_version()=v0.1.9`，无 RRF 接口），融合层必须自研。

### 15.8 完整技术决策汇总表

| 层级 | 组件 | 决策 | 理由 |
|---|---|---|---|
| 认知架构 | ACT-R 激活方程 | 参考 pyactup，TypeScript 自研 | 跨语言运行时增加复杂度 |
| 认知架构 | SOAR chunking | TypeScript 自研 | 同上 |
| 认知架构 | CLARION | 暂不采用 | 实验性实现，重叠度低 |
| JEV 决策 | JEV 适配层 | ~~首选 LitJev~~ ⇒ **本机 Ollama logprob 单 token**，备选 JEV-CPU | LitJev 需 H100 80GB 不可行；Ollama 已常驻、零 token |
| 记忆框架 | Mem0/Letta | 不直接集成，借鉴工程模式 | 与 DSH 架构冲突 |
| 向量检索 | 纯 JS 余弦 + 物化 BLOB | 直接采用 | 一万条实测优于 vec0；sqlite-vec 列为 >10 万条升级项 |
| 向量检索 | bge-m3 + Ollama | 直接采用 | 本地运行，零外部依赖 |
| 混合检索 | RRF (k=60) | **自研**（约 30 行） | sqlite-vec 无 RRF 接口，原「已实现」描述不实 |
| DSH 插件 | ~~dsh-memory~~ | **不采用** | 实测为纯 FTS5 词法件，无向量能力 |
| DSH 插件 | dsh-shoucang-memory | 核心参考 | 本地向量 + 降级策略 |
| DSH 插件 | dsh-memory-jev | 直接复用 | JEV 三道门控实现 |
| 遗忘算法 | ACT-R + 艾宾浩斯 | 组合采用 | 已有学术验证 |
| 遗忘算法 | FadeMem/Oblivion | 参考 | 主动遗忘机制增强 |

---

## 16. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript | DSH 插件强制要求 |
| 框架 | Cordis（DSH 内置） | 类型化事件、依赖注入、服务热插拔 |
| 存储 | SQLite（`node:sqlite`） | DSH 生态默认，零外部依赖 |
| 向量库 | 纯 JS 余弦（可选 sqlite-vec） | 零基础设施；vec0 在 <10 万条无优势 |
| 嵌入模型 | BGE-M3（自托管 / Ollama） | 多语言、8192 上下文、混合检索 |
| JEV 通道 | 本机 Ollama logprob（`:11434`） | 零 token 成本；LitJev 需 H100 80GB 不可行 |
| LLM | DSH `ctx.llm` | 通过插件注入 |
| 测试 | `node:test` | 本机可用且样板即此；Vitest 非必需 |
| 包管理 | npm（workspaces） | 本机 pnpm 可用，但项目统一 npm 以对齐样板与 DSH profile |
| 运行平台 | WSL2 / Ubuntu（ext4） | 全部命令为 Linux/bash 口径，不用 PowerShell |
| ACT-R 参考 | pyactup 算法移植 | Python 库无法直接在 DSH 运行 |

---

## 17. 路线图

### 阶段 0：契约与骨架（1–2 周）

- 创建 monorepo 和所有 Mana 插件目录
- Agent-Contract 冻结事件类型和数据模型
- 每个插件搭空骨架（name + inject + apply）
- 配 CI：typecheck + `node:test` + plugin-shape 校验

### 阶段 1：核心闭环 MVP（3–4 周）

- Agent-JEV 基于**本机 Ollama logprob** 实现 JEV 适配插件（含缓存、降级、熔断）
- Agent-Vector 自研纯 JS 余弦 + FTS5(trigram) + RRF（约 30 行）实现
- 实现最小闭环：perception → attention → working-memory → scheduler → action
- 跑通端到端事件流

### 阶段 2：长时记忆与 ACT-R 激活（4–6 周）

- 实现 long-term-memory 插件，接入 ACT-R 激活方程
- 参考 pyactup 的算法实现，用 TypeScript 复现
- 集成 dsh-memory 或 dsh-shoucang-memory 的混合检索流水线
- 实现 Write Gate / Recall Gate / Injection Gate
- 验证记忆命中率和遗忘曲线

### 阶段 3：巩固、遗忘与 Chunking（4–6 周）

- 实现 consolidation 插件（含 SOAR chunking）
- 实现 forgetting 插件（含艾宾浩斯衰减 + 间隔重复）
- 参考 FadeMem 和 Oblivion 的主动遗忘机制增强
- 验证 chunking 对重复任务效率的提升

### 阶段 4：末那识核心特性（4–6 周）

- 实现 metacognition 插件（末那识·审：置信度、知识缺口检测）
- 实现 user-model 插件（末那识·我执：偏好、习惯、项目持续更新）
- 验证用户模型精度和个性化效果

### 阶段 5：UI 与集成（4–6 周）

- 实现 mana-ui 插件（Client 半区）
- 记忆可视化面板（激活值热力图、目标栈树、认知轨迹时间线）
- 认知轨迹回放
- 多设备同步

### 阶段 6：评估与优化（持续）

- 四层评估体系（L1-L4）
- 消融实验
- 性能优化：JEV 缓存命中率、向量检索延迟
- 可靠性加固

---

## 18. 风险评估

| 风险 | 对策 | 依据 |
|---|---|---|
| JEV 服务不可用 | 三道门控各自独立的降级策略 | dsh-memory-jev 设计 |
| JEV 误判 | 置信度阈值 + 低概率触发 LLM 复核 + 熔断机制 | 社区实测数据 |
| 向量检索不准 | 混合检索（向量 + BM25 + 图）+ JEV 重排 | AMA-Bench 发现 |
| 上下文超限 | 工作记忆窗口 ≤ 4 组块 + JEV 过滤 | ACT-R 容量限制假设 |
| 隐私泄露 | 本地优先、SQLite 存储、软删除 | dsh-memory-jev 设计 |
| 成本过高 | JEV 输出免费、批量判断、缓存、BGE-M3 自托管 | Jev-Mem 论文 |
| Agent 冲突 | 目录所有权、小 PR、每日合并 | 多 Agent 开发最佳实践 |
| 契约漂移 | 契约版本管理、契约测试 | Cordis 类型化事件系统 |
| 记忆爆炸 | 分层存储、ACT-R 衰减、自动归档 | 艾宾浩斯遗忘曲线 |
| 输入截断导致 JEV 失明 | 分段判断 + 合并结果 | 社区实测发现 |
| 用户模型漂移 | 定期重训 + 用户确认 | 我执的动态特性 |

---

## 19. 附录

### 附录 A：Mana 插件速查表

| 插件 | 一句话职责 | 唯识对应 |
|---|---|---|
| `dsh-mana-core` | 事件类型、数据模型、共享 schema | — |
| `dsh-mana-jev` | JEV 适配层、缓存、降级、熔断 | **末那识·恒审** |
| `dsh-mana-vector` | 嵌入模型适配、向量检索、RRF 融合 | — |
| `dsh-mana-perception` | 输入采集、分块、实体抽取 | 前五识 |
| `dsh-mana-attention` | 注意力门控、JEV 筛选 | 作意 |
| `dsh-mana-working-memory` | 工作记忆、容量管理、上下文组装 | 第六识 |
| `dsh-mana-long-term` | 记忆编码、激活方程、检索 | 第八识·藏识 |
| `dsh-mana-scheduler` | 目标栈、SOAR 三阶段循环 | 第六识·思维 |
| `dsh-mana-consolidation` | 巩固、合并、chunking | 熏习 |
| `dsh-mana-forgetting` | 衰减、归档、压缩 | 种子衰减 |
| `dsh-mana-metacognition` | 置信度、知识缺口检测 | **末那识·审** |
| `dsh-mana-user-model` | 用户偏好、习惯、项目 | **末那识·我执** |
| `dsh-mana-ui` | Client 半区、记忆可视化 | — |

### 附录 B：关键参数速查表

| 参数 | 默认值 | 来源/说明 |
|---|---|---|
| ACT-R 衰减指数 d | 0.5 | ACT-R 标准参数 |
| ACT-R 检索阈值 τ | -2.0 | 可配置 |
| ACT-R 噪声 σ | 0.3 | 产生检索随机性 |
| ACT-R 时间尺度 F | 0.35s | ACT-R 默认 |
| ACT-R 缩放因子 f | 0.8 | 激活到延迟映射 |
| 基础产出时间 | 50ms | ACT-R 产生式执行 |
| 工作记忆容量 | 4 组块 | ACT-R 容量限制 |
| 源激活总权重 | 1.0 | ∑W_j = 1 |
| JEV 注意力阈值 | 0.7 | 高阈值，只关注高度相关 |
| JEV 记忆检索阈值 | 0.5 | 中阈值，保留合理范围 |
| JEV 遗忘阈值 | 0.3 | 低阈值，宁多不忘 |
| JEV 安全阈值 | 0.8 | 高阈值，安全优先 |
| JEV 缓存 TTL | 300s | 平衡实时性与成本 |
| JEV 熔断阈值 | 连续 5 次失败 | 冷却 60s |
| RRF 平滑常数 k | 60 | 标准值 |
| 时间衰减半衰期 h | 14 天 | 可配置 |
| 巩固触发相似度 | ≥ 0.7 | 相似记忆合并阈值 |
| Chunking 重复阈值 | ≥ 2 次 | 模式重复出现次数 |
| 用户模型精度目标 | > 75% | 我执的预测准确率 |

### 附录 C：参考资料

**认知架构：**
- **ACT-R 官方**：Anderson et al., "An integrated theory of the mind", Psychological Review, 2004
- **ACT-R 激活方程**：ACT-R 7.27 官方文档
- **pyactup**：ACT-R 声明性记忆的轻量级 Python 实现
- **SOAR**：Laird, J. E., "The Soar Cognitive Architecture", MIT Press, 2012

**AI 记忆与决策：**
- **JEV**：TypeSafe AI 官方文档
- **Jev-Mem**：arXiv:2609.23986, Jiang, Li & Li, September 2026
- **dsh-memory-jev**：GitHub Towzai/dsh-memory-jev
- **AMA-Bench**：ICML 2026, Zhao et al.
- **CogArena**：arXiv:2607.24999, Hou et al.
- **LoCoMo**：Maharana et al., 2024
- **Newell Test**：Anderson & Lebiere, 2003

**DSH 与 Cordis：**
- **Cordis 框架**：DeepSeek Harness 官方文档
- **DSH 插件开发指南**：DeepSeek Harness 官方文档

**唯识学：**
- **《成唯识论》**：世亲菩萨造，玄奘译
- **《佛学大辞典》**：丁福保编
- **《瑜伽师地论》**：弥勒菩萨说，玄奘译

---

> **Mana（末那识）：恒审思量的认知内核，连接感知与藏识，持续执取用户模型，从不间断地陪伴与判断的长期 AI 助手。**