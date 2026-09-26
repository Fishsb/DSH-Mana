# Mana 完成度实况增量（对照 v10 参考档 · 2026-09-26）

> **本册是什么**：按用户指令「对照项目参考文档，对当前项目做梳理标记完成情况」出具的**增量实况档**。
> 它**不改**任何既有册（ADR-25 冻结 `docs/mana-project-status-plan.md`；`docs/mana-v10-status-plan.md` 为 REFERENCE ONLY），
> 只记录**自上一份实况册（HEAD `8474def`）以来 34 个提交**之后的差异与复测读数。
>
> **取数坐标**：开工 HEAD `1bb82f5` · 取数期间 HEAD 前进至 `8a2bfae`（仅 1 个 docs/contract 提交，不影响源码读数）
> · 2026-09-26 17:2x–17:3x +0800 · 工作树**非独占**（另有一席 `session-6375a247` 在同一仓上活动）
>
> **回归自检（本册碰了哪些既有行为、凭什么确认仍成立）**：
> ① 本册为**新建文件**（`?? docs/mana-status-delta-2026-09-26.md`），零覆盖既有件 ⇒ 无既有行为被改；
> ② **未动** `packages/**` · `tools/**` · `docs/contract/**` · 既有册（本席全程只读 + 唯一新建）；
> ③ 所有断言带**可复跑命令**或 `文件:行`，给不出者标「未验证」（本册无此类条目）；
> ④ 六条链 / 事件契约 / 领域模型**零改动**。

---

## 〇、一句话结论

**v10 参考档声明的 40 节里，本仓已把「可机检」的部分做实**（17 包 / 23644 行 src / 74 个测试文件 / `npm test` **660 pass · 0 fail**），
**但三处结构性缺口仍在，且都不在「包写没写完」这个维度上**：

1. **生成层零消费者** —— `dsh-mana-llm` 全仓**唯一引用在装配清单里**（`tools/r0-assembly-check.mjs:77`），生产调用点 **0**；
2. **Prompt 库零消费者** —— 新建的 `dsh-mana-prompts`（§25 二十条常量）**没有包引用它**；
3. **判据门自己把自己锁住了** —— `tools/a0-check.mjs` 的单实例锁被**另一席的实例持有**，本席复跑被拒 ⇒ **门读数本轮不可得**（这本身是 F-05b 设计正确，但它暴露了「门不是随时可读的」）。

---

## 一、对照基准：这份参考档的实际身份

| 项 | 实测 |
|---|---|
| 路径 | `docs/deepseek_markdown_20260924_968609.md`（**已入仓**，非只读挂载） |
| 行数 / sha256 | **2345 行** / `1f6fd16c2a4f170584db9f460e6afecf504c732da2d8bdf8c4723a55b5511e41` |
| 版本自称 | v10.0（最终整合版）；**骨架 = 13 部分 / 40 节 + 附录 A/B/C** |

> ✅ **既有未决项由此解除**：`docs/mana-v10-status-plan.md` §D.4-1 记「v10 参考档未入仓 ⇒ `v10:NNN` 行号无法在仓内就近复核」。
> 该件现**已在仓内**且 sha256 与该册 banner 所记**逐字相同** ⇒ **行号引用可在仓内就近复核**，该条未决项**消解**。

---

## 二、总体完成度（按 v10 §40 路线图六阶段）

| v10 阶段 | v10 条目 | **本仓实测（2026-09-26 复测）** |
|---|---|---|
| **阶段 0** 契约与骨架 | monorepo / 契约冻结 / 骨架 / CI | ✅ **全部落地**。契约三件套（哈希/清单/HEAD）+ 六腿机检；骨架逐包可装配；CI = `node --test`（**非 vitest**，v10 写 vitest 属未采纳项） |
| **阶段 1** 核心闭环 MVP | JEV 适配 / LLM 适配 / Vector(RRF) / **ITACL** / 最小闭环 / 守藏混合召回 | ✅ JEV（真通道 `systemone` 为缺省）· ⚠ LLM 适配器**已交付但零消费者** · ✅ Vector（RRF+FTS5；**sqlite-vec 未装**，挂 W-1..3）· ⛔ **ITACL 不移植** · ✅ 最小闭环真跑 · ✅ 混合召回本仓自实现 |
| **阶段 2** 巩固与遗忘 | 巩固链 / 遗忘链 / ACT-R 激活 / 守藏深睡 | ✅ `consolidation` · ✅ `forgetting` · ✅ `long-term`（ACT-R 方程已落）· ⚠ **A1-5 仍挂账**（跨阶段）· ⚠ 深睡在守藏侧 |
| **阶段 3** 再巩固与学习 | 再巩固链 / 学习链 / 守藏白名单门禁 | ⚠ 再巩固**只落窗口+更新**（提取诱发遗忘 / 测试效应**明令不做**）· ⚠ 学习链 chunking+Hebbian ✅、**FSRS 不移植** · ⛔ **白名单门禁未实现**（Write Gate 已接线，准入判据未落） |
| **阶段 4** 末那识核心 | metacognition / user-model / MCL / 双画像 | ✅ 两包已交付 · ⚠ MCL 在守藏侧现役、本仓缺消费点 · ⚠ 双画像写入口 ✅、**内容生成归守藏** |
| **阶段 5** UI 与评估 | mana-ui / 可视化 / 四层评估 / 消融 | ✅ ui（装配三态 + 渲染落点已机检）· ✅ 面板 · ⛔ **四层评估无落点** · ⚠ 消融**部分可判**（`tools/a6-ablation.mjs`，**不承诺 6/6**） |

**口径声明**：`⛔ 不移植` 与 `⚠ 未实现` **都不是 PASS**（沿用 v10 实况册四态语义）。

---

## 三、插件清单对照（v10 声明 18，本仓在盘 17）

| v10 插件 | 本仓 | 说明 |
|---|---|---|
| `dsh-mana-itacl` | ⛔ 不在盘 | 已裁定**不移植**（宿主无信息充足度通道） |
| `dsh-mana-shoucang-adapter` | ⛔ 不在盘 | 前次「shoucang 不会两个插件并用」约束已撤销 ⇒ **可重新评估**，本轮未开工 |
| 其余 16 包 | ✅ 在盘 | 逐包有实现与测试 |
| **`dsh-mana-prompts`** | ✅ **在盘（v10 未列）** | **本仓超出 v10 的一包**：§25 二十条 Prompt 常量的唯一真源，14 例自检 |

```
$ ls packages | wc -l          → 17
$ find packages -name '*.ts' -not -path '*/lib/*' | wc -l   → 91   （src 文件）
$ find packages -name '*.ts' ... -exec cat {} + | wc -l     → 23644（src 行数）
$ ls packages/*/tests/*.test.mjs | wc -l                    → 74
```

---

## 四、本轮新实测（既有实况册未覆盖的增量）

### 4.1 生成链与 Prompt 链：**零消费者**（本轮亲测，非转述）

```
$ grep -rn "mana-llm" packages/*/src tools/*.mjs | grep -v '^packages/llm/'
tools/r0-assembly-check.mjs:77:  llm: 'mana-llm',        ← 唯一引用在装配清单里

$ grep -rln "mana-prompts|dsh-mana-prompts" packages/*/src packages/*/tests | grep -v '^packages/prompts'
（无输出）                                                ← 0 个包引用
```

⇒ `dsh-mana-llm` 与 `dsh-mana-prompts` **各自提供了一整套能力，却没有任何生产调用点**。
这正是 v10 §22「LLM 做生成」那一半**尚未接线**的可机检形态 —— 与 v10 实况册所记一致，但**本轮的增量是**：
新增的 `prompts` 包**出生即孤儿**（W2-C1 交付后无人接）。

### 4.2 服务消费面（**代理指标，非判据**，如实标注）

```
$ for svc in ...; do grep -rn "get('$svc')" packages/*/src | wc -l; done
mana-long-term        get=6
mana-user-model       get=3
mana-reconsolidation  get=1
mana-llm              get=1   ← 在 llm 包自身目录之外，属装配/清单面
其余（attention / perception / vector / consolidation / forgetting /
      learning / scheduler / metacognition）  get=0
```

⚠ **读法纪律**：本仓多数包**不用 `ctx.get` 连接**，而走 `ctx.waterfall` 事件 + `ctx.provide` 服务
（`packages/scheduler/src/chains.ts:493` 明确写「运行期解析 + 本地结构接口」）。
故上面的 `get=0` **不等于「无人消费」** —— 它是**代理指标**，只能与事件面读数**并列对照**，
**不得单独当作结论**（本仓原则「代理指标非判据」）。

### 4.3 测试面：较 v10 实况册有实质增长

| 包 | 测试文件 | 用例数 | 包 | 测试文件 | 用例数 |
|---|---|---|---|---|---|
| core | 15 | 116 | long-term | 6 | 55 |
| attention | 9 | **68** | metacognition | 5 | 47 |
| user-model | 7 | 47 | forgetting | 4 | 37 |
| working-memory | 3 | 37 | jev | 4 | 66 |
| ui | 3 | 32 | vector | 3 | 32 |
| reconsolidation | 6 | 31 | scheduler | 2 | 27 |
| consolidation | 3 | 26 | prompts | 1 | 14 |
| learning | 1 | 10 | llm | 1 | 9 |
| perception | 1 | 6 | **合计** | **74** | **660（`npm test` 实测 pass 660 / fail 0）** |

### 4.4 ⚠ 两个**未合并**的隔离工作树分支（本轮新发现，可能咬人）

```
$ git worktree list
/home/lk/Mana/.dsh-worktrees/t-muhxatig-q8n9vq   ad004ee  [task/W2-C1-新建-prompts-包…]
/home/lk/Mana/.dsh-worktrees/t-muhxatm7-dt4inu   e6bfd96  [task/W2-C3-vector-补-§14.3…]
$ git merge-base --is-ancestor e6bfd96 HEAD  → NOT in main
```

两个分支的**内容已由 squash 提交进入 main**（`14268c4` W2-C1 prompts、`52f7356` W2-C3 vector 图检索腿），
但**分支引用仍停在旧基 `bd7bb87`** ⇒ 若再对这两张卡派执行会话，它会在**过时基线**上重做一遍。
**处置建议**：删除这两个已完成任务的隔离工作树与分支，或标注「已交付、勿复跑」。

### 4.5 并发面：本席复跑门禁**被另一席挡住**（实测）

```
$ node tools/a0-check.mjs
✗ 另一个 a0-check 实例正在运行 —— 本实例拒绝启动（**不排队**）
  持有者：pid=415855 起始时刻=2026-09-26T09:26:02.731Z commit=1bb82f5
```

**这是 F-05b 单实例锁按设计工作**（禁静默排队，防止两实例互相把对方在途码读进读数）。
**但它的事实后果是**：多席并行时，**门读数不是随时可得的公共资源**。
⇒ 门读数在跨席汇报里必须带「**谁在跑、跑没跑成**」，不能默认「昨天绿＝今天绿」。

---

## 五、门禁读数（本轮复跑，逐腿可核）

| 门 | 本轮读数 | 说明 |
|---|---|---|
| `npm test` | ✅ **660 pass / 0 fail**（耗时 ~50s） | 本席亲跑，`exit 0` |
| **A1 门** | ✅ **exit 0**；判据腿**无 FAIL**（3 项挂账：A1-5 / ARTIFACTS / W-1..3）；**项集腿 17==17**；册行号腿 14/14 | 本席亲跑，含 `checker-md5=ec5573095e95` · `commit=a2012f2` 坐标 |
| **A0 门** | ⚠ **本轮不可得**（单实例锁被另一席持有，见 §4.5） | 改以**逐腿直测**替代（下表） |
| ├ 哈希腿 | ✅ `sha256sum -c` 两件全 OK | `event-types.ts` / `domain.ts` **逐字未变** |
| ├ 清单腿 | ✅ `91 == 91`，`diff` **空** | 与 `_freeze.files.txt` 逐行一致 |
| └ HEAD 腿 | ⚠ `_freeze.head=1963e88` **是现 HEAD 的祖先**（非过期，属正常前移） | 但 `_freeze.log` **seq=19 已如实登记**：gc 清理使**跃迁腿/锚点腿报红**（锚点被回收 ⇒ 区间不可枚举）。判据行为正确，**修法是重取一次基线**，不是删流水 |

---

## 六、缺口清单（不藏 · 按「会掩盖其他问题」优先排序）

| # | 缺口 | 为什么排在前面 | 证据 |
|---|---|---|---|
| **1** | **A0 门锚点/跃迁两腿报红**（gc 清理副作用未收口） | 门是**其余一切结论的信任来源**；它红着，别的绿都要打折 | `_freeze.log` seq=19 |
| **2** | **生成层零消费者**（llm / prompts 双孤儿） | 「实现完成」与「系统能跑」在报告层面**同形** —— 正是 v10 §22 那一半 | §4.1 |
| **3** | **A1-5 挂账跨阶段**（ACT-R 衰减未转真判据） | 挂账 **≠ 通过**；它是关键路径上**唯一未开工节点** | A1 门输出 |
| **4** | **四层评估体系无落点**（v10 §39.1） | 没有评估 ⇒ 「做好了」永远只能是自述 | v10 实况册 §五 |
| **5** | **两个未合并 worktree 分支** | 会诱导后续执行会话在过时基线上**重做一遍** | §4.4 |
| **6** | **白名单门禁未实现**（阶段 3 末条） | Write Gate 已接线，但准入判据空缺 ⇒ 闸门是「有门无锁」 | v10 实况册 |

---

## 七、下一步任务（候选 · 已建卡，**claim 模式不自动跑**）

> 用户指令是「**讨论**做下一步任务」，故四张卡一律 `execution.mode=claim`（人工认领），**不设 runAt**。
> 四卡**写面两两不相交**（见下表末列），可直接并行。

| 卡 | 目标 | 写面 | 依赖 |
|---|---|---|---|
| **N1 · 门禁收口** | 重取 `_freeze` 基线（令跃迁/锚点腿回到可枚举区间）+ 处置 `.dsh-worktrees/` 与 `docs/deepseek_*.md:Zone.Identifier` 等**无主未跟踪件**归属 | `docs/contract/_freeze.*` · `tools/.a0-10-baseline.json` · `.gitignore` | **无（先做）** |
| **N2 · 生成层落地** | 给 `dsh-mana-llm` 落**第一个生产消费者**（生成扇出层），并让 `dsh-mana-prompts` 被真引用（§25 常量接进 §12/§13 两条链） | `packages/llm/**` · `packages/prompts/**` · `packages/consolidation/**` | 建议 N1 后（避免在门红时开工） |
| **N3 · A1-5 清账** | `long-term` 的 ACT-R 衰减由**挂账**转**真判据**（负向：改半衰期必红；三锚点逐字复现） | `packages/long-term/**` · `tools/a1-check.mjs`（**与 N2/N4 争用，须串行**） | 与 N2 争 `a1-check` ⇒ 串行 |
| **N4 · 隔离树收口** | 删除两个已完成任务的隔离工作树/分支（`W2-C1` `ad004ee` / `W2-C3` `e6bfd96`）+ 留下「勿复跑」标记，防后续会话在过时基线重做 | git refs + `docs/handoff/` | 无 |

⚠ **跨席协调**：另有一席（`session-6375a247`）正持 `in_progress` 卡**做同一份参考档**（`t-muh1l89m-9izrf1`：
「检索分析当前项目实际情况，**修改这个方案**」）。四张候选卡**开工前必须先查在途**，否则会撞车。

---

> **Mana（末那识）：JEV 做判断，LLM 做生成，插件做控制。**
> **本册为增量实况档**：凡本仓未实现者如实标注，**不以设计意图冒充现状**；引用任何数字前请先复跑对应命令。
