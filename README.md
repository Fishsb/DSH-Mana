# Mana（末那识）

> **基于人类记忆架构的认知内核，融合 DSH Agent 架构与上下文工程。**
> 从编码到遗忘，从学习到调度，完整模拟记忆的全生命周期。
>
> **JEV 做判断，LLM 做生成，插件做控制。**

Mana 是一套 **DSH 插件集**（17 个 npm workspace 包 · 23k 行 TypeScript · 660 条判据），把 ACT-R 激活方程、SOAR 目标栈、JEV 判定原语、
RRF 混合检索与认知链条调度落成可机检的工程实现。

---

## 它是什么

人类记忆不是"存了就能取"——它有一套完整生命周期。Mana 把这套生命周期拆成**七条链**，每条链是一个独立插件：

| 链 | 包 | 做什么 |
|---|---|---|
| **编码** | `perception` | 输入采集、分块、信号词预筛 |
| **检索** | `vector` / `long-term` | 词法 + 向量 **RRF 融合**（k=60），ACT-R 激活方程 |
| **巩固** | `consolidation` | 合并、SOAR chunking、睡眠振荡（Spindle + Ripple） |
| **再巩固** | `reconsolidation` | 提取后的窗口期、记忆更新、提取诱发遗忘 |
| **遗忘** | `forgetting` | 幂律衰减、活性分级（热/温/冷）、多通路遗忘 |
| **学习** | `learning` | Hebbian 共激活、双画像维护（USER.md / AGENT.md） |
| **调度** | `scheduler` | 目标栈、SOAR 三阶段、**七链条驱动者** |

支撑层：`core`（契约与存储）· `jev`（判定原语）· `llm`（生成出口）·
`attention`（注意力门控 / Injection Gate）· `working-memory`（工作记忆）·
`metacognition`（置信度 / 知识缺口）· `user-model`（用户模型）· `ui`（认知轨迹可视化）

---

## 快速开始

**要求**：Node.js **^22.22.0**（用 `node:sqlite` 内置模块，无需额外数据库）

```bash
git clone https://github.com/Fishsb/DSH-Mana.git
cd DSH-Mana
npm install          # 安装 workspace 依赖

npm test             # 全量测试
npm run typecheck    # 类型检查
npm run build        # 构建各包 lib/
```

### 判据门禁

除了单元测试，本仓还有**可复跑的判据门禁**（`tools/`）：

```bash
node tools/r0-assembly-check.mjs   # 装配闸：三源互证 + 卸载即净
node tools/a0-check.mjs            # 阶段 0 契约闸（16 项）
node tools/a1-check.mjs            # 阶段 1 判据闸（17 项 + 项集腿）
```

> ⚠ `a0-check` 会**同时持有 a1 锁**，两门**必须串行跑**。

---

## 设计原则

这套代码库有一条贯穿始终的工程纪律：**失败必须可观测**。

- **四态语义**：`PASS` / `FAIL` / `HANG` / `NONE` —— **挂账（HANG）与无实现者（NONE）都不是 PASS**
- **禁止静默吞异常**：不用 `catch { return null }`；降级必须**显式留字段**（`degraded` / `reason`）
- **代理指标非判据**：mtime、心跳、文件增长只反映机制自身，不作结论依据
- **负向对拍**：每条判据都要能证明**它会红** —— 造扰动 ⇒ 必红 ⇒ 逐字节恢复
- **产出者 ≠ 验收者**：改了代码的席位不能审自己的改动

判据契约见 `docs/contract/`（阈值纪律、降级口径、并发纪律、命名规范）。

---

## 目录结构

```
packages/          16 个插件的源码与判据
  <name>/src/      实现（TypeScript）
  <name>/tests/    判据（node:test）
  <name>/verify.mjs 包内防线（四道闸）
tools/             跨包判据器（a0 / a1 / r0）与探针
docs/
  contract/        判据契约（工具真依赖）
  arch/            架构文档
  mana-*.md        设计与落地册
```

---

## 状态

本项目处于**积极开发中**（v0.1.0）。部分链条已接通生产路径，部分仍在推进 ——
各批次的完成度与**未闭合项**记录在 `docs/mana-rollout-plan.md` 与各期收尾报告中，
**不做"看起来都完成了"的表述**。

---

## 许可

[MIT](LICENSE)
