# S1v · dsh-mana-vector · 批次 B1.1 向量适配

> 六段（`docs/contract/handoff-protocol.md` 出口标准）。凡未跑过的一律写「未验证」，不编。
> 口径：A 档（确定性、可逐字复现）才进阈值列；B 档浮动量只作测量条件说明。
> **本席写面**：`packages/vector/**`（唯一）。前一席的 S1 工作（B5.1 判据阈值层）**零改动**。

## 1. 交付文件

包内新增 7 个实现文件 + 1 个测试文件；`src/index.ts` 由骨架扩为含实现的入口（`name`/`inject`/`Config`/G9 直通链**逐字保留**）。

| 文件（绝对路径） | 职责 | 关键取舍 |
|---|---|---|
| `/home/lk/Mana/packages/vector/src/cosine.ts` | 纯 JS 余弦 + `assertDim` | 算法逐字移植上游 `vec.js` 的 `cosine`（**不 import 它**：跨仓 import 会拖进它的依赖树，且它是活跃开发树非只读件）。**不把 dim 契约塞进 cosine** —— 那会让「非法输入」与「降级」由同一个 `0` 表示（G8 禁的不可分辨形态） |
| `/home/lk/Mana/packages/vector/src/rrf.ts` | RRF 自实现（k=60）+ 平局裁决 | 平局三级裁决（score↓ / hits↓ / key字典序↑）**显式写死**，不依赖 `sort` 稳定性 ⇒ 逐位可复现。修掉上游 `denseRank.get(k) \|\| 0` 的坑（rank 0 与缺失同义）⇒ 缺失即不加分 |
| `/home/lk/Mana/packages/vector/src/vec-blob.ts` | BLOB ⇄ **常驻 `Float32Array`** | **显式小端**编解码（不依赖宿主字节序）；解码三参构造（`byteOffset`/`byteLength`）—— 单参 `new Float32Array(buf)` 会按**元素**解释字节且忽略 offset，是静默的错 |
| `/home/lk/Mana/packages/vector/src/embed.ts` | 嵌入适配（`fetch`，零 node 内置依赖） | 上游 `catch{return null}` **改写为显式信封**；保留上游两处真踩坑口径：本机端点超时 30s（统一 8s 会把首次召回误判超时静默降级）、文本截断 512 字符 |
| `/home/lk/Mana/packages/vector/src/recall.ts` | 召回管道：词法打底 → 常驻 → 余弦 → RRF | 三处按本仓契约改写上游（见文件头对照表）；**降级时 `rankBy='local_score'`**（A1-11 原文）；`'degraded'`（想走没走成，必须留痕）与 `'lexical'`（本来就不走）**不同义** |
| `/home/lk/Mana/packages/vector/src/vec0.ts` | vec0 三条语义 W-1/W-2/W-3 的机检锚点 | **本轮未启用**：`route='vec0'` 一律**显式降级**并点名三条语义，**不静默回落 js**。不做「填了就以为生效」的空壳配置字段 |
| `/home/lk/Mana/packages/vector/src/adapt.ts` | 信封类型 + 批次维度校验 | 失败信封有**唯一**构造出口（避免各处手写漏字段） |
| `/home/lk/Mana/packages/vector/src/index.ts` | 服务面（**唯一写库点** `putMemoryVector`） | 写 `memory_items.vector` 走 core 的 `withTransaction`；**本包不自己开库**（开库器是 core 独占写点）。卸载时 `store.clear()` = 插件层即净，**库中 BLOB 不动** |
| `/home/lk/Mana/packages/vector/tests/b11-vector.test.mjs` | 判据测试（14 条） | 首条为**判据自检**（本文件 `test(` 计数 ≥13 + 交付文件存在 + 路径解析断言），防「空文件也绿」的假绿形态 |

交付面清单（**实测** sha256 前 16 位；命令 `cd packages/vector && sha256sum src/*.ts tests/*.test.mjs`）：
```
6d225fcdf7a0cff9  packages/vector/src/adapt.ts
10ff34be6655083b  packages/vector/src/cosine.ts
d0c1185289f2d8c8  packages/vector/src/embed.ts
4ea6c1ef0739e0f3  packages/vector/src/index.ts
9817063f37466183  packages/vector/src/recall.ts
352dcf5847ab190b  packages/vector/src/rrf.ts
4b166ce5228e4f6e  packages/vector/src/vec-blob.ts
bb32469a8966625f  packages/vector/src/vec0.ts
466d545a4496bec0  packages/vector/tests/b11-vector.test.mjs
```
（`recall.ts` 的 `9817063f37466183` 与 `rrf.ts` 的 `352dcf5847ab190b` 即 §2.1 旋钮往返的恢复值，**前后逐字相同**。）

## 2. 判据执行

| # | 判据 | 命令（**原文**） | 输出 / 退出码 |
|---|---|---|---|
| ① | 包内测试（**显式路径**，不用通配） | `cd /home/lk/Mana && node --test packages/vector/tests/b11-vector.test.mjs` | `# tests 14 / # pass 14 / # fail 0`，**exit 0** |
| ② | 类型检查（主持人口径②） | `cd /home/lk/Mana && npm run typecheck --workspace dsh-mana-vector` | `tsc -p tsconfig.json --noEmit`，**exit 0** |
| ③ | 类型检查（裸 tsc） | `cd packages/vector && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit` | **exit 0**（无输出） |
| ④ | 既有骨架不失效 | `node --test packages/core/tests/skeleton.test.mjs` | `# tests 5 / # pass 5 / # fail 0`，**exit 0** |
| ⑤ | RRF 三锚点（A 档，逐字） | `node --input-type=module -e "…rrfTerm…"` | `[1,1] = 0.032787`（差 `1.148e-7`）· `[1,50] = 0.025484`（差 `3.517e-7`）· `[50,50] = 0.018182`（差 `1.818e-7`）—— **三处均 ≤1e-6** |
| ⑥ | 余弦边界（A 档） | 同上 | `self-sim = 1`（**不 clamp**，IEEE754 固有）· `cosine([1,2],[1,2,3]) = 0` · `cosine([0,0],[1,2]) = 0` |
| ⑦ | RRF 融合（真结果） | 同上 | 两路一致 `a=0.032786885`/`b=0.032258065`（hits 均 2）· 交叉 `a=b=0.032522475` → 平局按 key 升序 · 单路命中 `only=0.016393443`、`rank={"dense":1}`（**无 `lexical` 键**）· 重复键 `[k,k,j]` → `k=0.016393443`（只记首次名次，无膨胀）· 全并列顺序 `a,b` |
| ⑧ | 真嵌入（本机 Ollama，A+B 档分离） | 测试 ⑩ 内 | `dim == 1024`（A 档）；同文重复 `cos=1.000000`（≥0.999999），改写句 `cos=0.345421` ⇒ 同文 > 改写（A 档方向）；**B 档测量条件说明**：耗时 `32ms/20ms/28ms`（**不进阈值列**） |
| ⑨ | 真库落点 + 真装配 | 测试 ⑪ 内 | `memory_items.vector` 真写入 `4096 B (=1024×4)`、真库往返**逐位相等**、新 ctx 从库解码成功（`resident 0→1`） |
| ⑩ | 反证判据 | 测试 ⑬ 内 | 装载态 `+1 行 / +1 事件（0→1）`；卸载后 `0 新行 / 0 新事件（1→1）` |

### 2.1 负向判据（转旋钮：证明判据有牙，不是"看着绿"）

两处**独立**旋钮、**已逐字恢复**：

| 旋钮 | 改动 | 实测 | 恢复 |
|---|---|---|---|
| **RRF k** | `RRF_DEFAULT_K 60 → 61` | `not ok 2 - B1.1-① A1-4 RRF 三锚点…`；`# pass 13 / # fail 1`，**exit 1** | sha256 恢复为 `352dcf5847ab190b…`（前后逐字相同） |
| **降级 channel** | `recall.ts` 内 `channel: 'degraded' → 'lexical'` | `not ok 8 - B1.1-⑦ 降级可枚举断言…`；`# pass 13 / # fail 1`，**exit 1** | sha256 恢复为 `9817063f37466183…`（前后逐字相同） |

⇒ 判据不是恒真的：改口径即红。且**第二条**正是本席最在意的形态（把「想走没走成」标成「本来就不走」= 上游 `catch{return null}` 的同族病）。

## 3. 反证判据

**R0「卸载 `vector` → 同一触发不再产生新行」：已跑（进程内真装配），成立，附正向对照。**

- 触发定义（两件都真做，不只数其一）：① `putMemoryVector('rev-<tag>', 1024维)` 真写 `memory_items.vector`；② `recall(..., envelope)` 真 `emit` `mana/recall`。
- **正向对照（防平凡通过 = G11 假绿）**：装载态下 `0 → 1` 行、`0 → 1` 事件 —— 若装载态也不增行，下面的"卸载后不增"毫无信息量。
- **卸载后**：`fiber.dispose()` → `ctx.get('mana-vector') === undefined` ⇒ 同一触发取不到服务 ⇒ `0` 新行、`0` 新事件。
- 诊断行原文：`[反证 · 进程内装配] 装载态 +1 行 / +1 事件（0→1）；卸载后 0 新行 / 0 新事件（1→1）`。

⚠ **数据层未回滚（按契约必须分开写）**：卸载后 `memory_items` 里 `rev-a` 那行**仍在**（用例内显式断言 `rows() >= 1`）。
「卸载即净」只对**插件层**成立（`docs/contract/handoff-protocol.md` 双层表）。本轮**未**装配到运行态 profile、未改 `~/.dsh/`（硬纪律）⇒
「运行态装配下」的反证判据**未验证**（判据口径要求"独立只读连接读行数"，本席在进程内用 core 句柄读，**不是**独立连接 —— 见 §5 U3）。

## 4. 回归自检

**改了哪些既有行为？**

1. **`packages/core/**` 零字节改动**（读口是 `import type` + 运行期 `ctx.get`）。
   证据：`sha256sum packages/core/src/event-types.ts packages/core/src/domain.ts` 输出
   `53c92707954562b160afbb83b72e21fd33cd14ef023092fcf2f2cb24ccac1ebe` / `3a80122b7fa789a7c471056c442cce1af7e237fc10b97bef0f78abc16fbce8f6`，
   与 `docs/contract/_freeze.sha256` 两行**逐字相同**。
2. **`/mnt/d/FF/shoucang` 零字节改动**：`vec.js` sha256 `6fd22cac9162c55bc049cb10ef4994fd02fc88c2fdca8066cd4dda6f8344cea6`，mtime 仍为开工前快照 `2026-09-24 17:58:47.587 +0800`（我 20:19 才开始写盘）。本包**不 import 它**，算法是独立实现 + 对拍取证。
3. **根配置未碰**：`git diff --stat package.json package-lock.json tsconfig.base.json .gitattributes` → **空**。未跑 `npm install`，未跑全局 build（只 `tsc -p packages/vector/tsconfig.json`）。
4. **既有骨架未失效**：`name='mana-vector'` / `inject=['mana-core']` / `Config` 的 `model/dim/rrfK/route` 四字段与 union 写法逐字保留（新增 3 个字段有缺省值，老配置不炸）；G9 直通链末端哨兵 `reached=2`（漏调即 1，这就是"静默掐死下游"）；`packages/core/tests/skeleton.test.mjs` 5/5 绿。
5. **测试自身的一处修订**（报备）：首版用例 ⑨ 的断言串里混入一处非中文残留（`память`），已改为中文；首版另有一处 `assert.equal(..., "…（"…" ≠ "…"）")` 因嵌套同型引号导致 **SyntaxError（模块编译失败 → exit 1）**，已改为「」括注。二者都是**测试自身**的错，不影响实现。

**一处已知非本席所致的红**：`npm test`（根）当前红，失败落在**他席在途包**（`packages/ui` 等）。本席只对自包取证；若收口时看到根红，先看失败文件归属，**不要据此回退本包**。

## 5. 未决项

| # | 未决项 | 为什么不能由本席解决 | 建议承接 |
|---|---|---|---|
| **U1** | **vec0 未启用**（本轮明确）：`route='vec0'` 显式降级并点名 W-1/W-2/W-3。启用时**必须**三条各造一次负例（W-1 显式 `distance_metric=cosine`；W-2 `rowid` 用 **BigInt**；W-3 KNN 必带 `LIMIT`/`k=?`），本机**尚未**验 `vec0` 扩展装载（`ctx.get('mana-core').vecVersion()` 可读才是正面证据） | 规模化升级项（§8 C4），本轮范围外；且需先证扩展装载 | 后续批次（>10 万条时） |
| **U2** | **活性降权 / 分层打分 v2 / 按 § 去重** 三项**未移植**（上游 `recallRanked` 有）。它们依赖 shoucang 的 `activity.jsonl` 与 `criteria.generated` 真源 | 搬进来等于把跨仓依赖拖过界（且 S1 席已搬判据层，重复搬会撞同一写面） | B3.x 长时记忆批次，或用户拍板口径 |
| **U3** | 反证判据用的是 **core 句柄**读行数，不是契约口径要求的「**独立只读连接**」（`handoff-protocol.md` 装配面约定第 4 条：插件卸载会关闭自己的库句柄） | 本席未装配到运行态 profile，进程内没有"插件之外的连接"可用 | 收口席（S5）在真装配态补一次独立连接版反证 |
| **U4** | `packages/vector/package.json` 的 `"test"` 脚本仍是 `node --test "tests/*.test.mjs"` 通配。主持人口径要求**显式路径**（通配在目录不存在时静默 exit 0） | 改它碰的是**包级** script 口径，会与他席同名脚本分叉（已入 [越界转派]） | S0/收口席统一各包 test script 口径后一次性改 |
| **U5** | 本席**未**改 `docs/handoff/S1.md`（前一席的 B5.1 报告），本轮结果独立成 `docs/handoff/S1v.md` 以避免同文件两写者 | 写面纪律 | 收口席按需合并 |
| **U6** | 上游 `embedMany` 的 `cfg.enabled=false ⇒ 返回 null` 语义，本席改写为**显式降级信封**（信封 `disabled` 与"端点不通"共用 `degraded:true`，但 `reason` 文案可分辨） | 有意为之（契约硬约定 1 优先于上游语义）；若验收要求「显式声明走词法」与「故障降级」在**字段级**可分（而非仅文案），需拍板加枚举字段 | 用户/收口席 |
| **U7** | **降级态仅存于返回对象，未落库 ⇒ 跨进程 / 事后不可查**（复核抓到，本席复验成立）：真故障时 `mana_trace` / `jev_log` / `inject_log` / `memory_items` **增量全 0**；`mana/recall` 事件虽 `emit`，但**全仓无消费者**（仅 `core/src/event-types.ts` 有声明）⇒ G8「降级必须落显式字段」目前**只在返回对象里**，进程结束即丢 | **不判红**：`docs/contract/degradation.md` §5 的 `inject_log` 要求针对 **injection gate**，**不覆盖** vector recall；本包是否应落库属**下一席/契约面决策**，本席不越界改 `packages/core/**`。**已把缺口钉成机检事实**：`tests/b11-vector.test.mjs` 用例 ⑭ 真造降级并断言四表增量**仍为 0**，一旦补上写入落点该用例**变红并点名本条 U7** ⇒ 缺口不会静默消失 | 下一席（若要使降级可事后审计）：**(a)** 给 `mana/recall` 加消费者，或 **(b)** 在 injection gate 接线时一并落 `inject_log` —— **两条都需跨包协调**（(b) 涉及 `packages/attention/**` 等他人写面） |
| **U4′** | ⚠ 上表 **U4 已在本轮 d1b 解决**（`test` 已改走 `tests/gate.mjs` 外部闸，真跑留成 `test:raw`）——保留原文以存证，**勿据 U4 再提** | — | — |

## 6. 契约版本

已核 `_freeze` 三元组 @ `ee9e22e`（`docs/contract/_freeze.head`）。
- **哈希腿可信**：`packages/core/src/{event-types.ts,domain.ts}` 两行 sha256 与 `_freeze.sha256` **逐字相同**（开工前 + 收工各核一次）。
- **清单腿已漂（非本席所致）**：`_freeze.files.txt` 未含 S0 在途的 `packages/core/src/open.ts` 等 ⇒ 按主持人口径待 S0 收口后重取；本席**不重取**（重取 = 写 `docs/contract/**`，冻结只读面）。
- 引用契约：`docs/contract/degradation.md`（硬约定 1/3：禁 `catch{return null}`、降级落 `degraded:true`+非空 `reason`）· `threshold-discipline.md`（A/B 档分列）· `handoff-protocol.md`（双层回滚）· `naming.md`（`dsh-mana-vector` ↔ `mana-vector` ↔ `mana-vector`）。

---

## 7. 补口 d1b —— 复核四缺陷的处置（2026-09-24 20:45）

独立复核在本席交付里抓到四处，**逐条已复验、逐条已办**。判据：`npm test --workspace dsh-mana-vector`
（= `node tests/gate.mjs`）→ `# tests 15 / # pass 15 / # fail 0`，**exit 0**；`npm run typecheck --workspace dsh-mana-vector` **exit 0**。

| # | 缺陷（复核原文） | 处置 | 证据 |
|---|---|---|---|
| **①** | `package.json` 的 test script 用**通配** ⇒ 空目录静默 `exit 0` | **已改**：`"test": "node tests/gate.mjs"` + `"test:raw": "node --test tests/b11-vector.test.mjs"`；新增**外部闸** `tests/gate.mjs`（跑测试**之前**独立检查：文件存在 / 非 0 字节 / 用例条数**等于**期望 / 含 `assert.` 再才 spawn `--test`，**显式路径非通配**）。⚠ 只改**自包** `package.json`，根 `package.json` 未碰（diff 0 行） | 负向控制见下 |
| **②** | 计数自检门槛**偏松**（`n >= 13`）⇒ 删一条用例不变色 | **已改**：`assert.ok(n >= 13)` → `assert.equal(n, EXPECTED_CASES)`（=15），闸内同值同源 | NC-2 实测见下 |
| **③** | 降级**只落在返回对象**，四表增量全 0、`mana/recall` 全仓无消费者 ⇒ 跨进程/事后不可查 | **按复核口径不判红**（契约是否要求 vector recall 落库不在 `degradation.md` §5 范围），**改为把缺口钉成可机检断言**：新增用例 ⑭ 真造降级并断言四表增量**仍为 0**；一旦下一席补了写入落点，**该用例变红并直接点出**"缺口已闭合，请更新本条与未决项 U7" | 用例 ⑭ 诊断行：`[缺陷③ 钉住] 真降级（degraded=true, channel=degraded）但四表增量 = {"trace":0,"inject":0,"items":0,"jev":0}` |
| **④** | `rrf.ts` 两处**文档不实**：称上游是 `\|\| 0`（实为 `\|\| dense.length + 1`）；去重**不重排**（`['x','x','y']` ⇒ `y` rank 3） | **两条都办**：① 文案更正为 `\|\| dense.length + 1` 并说明"为何刻意与之不同"（未命中 vs 命中得很差必须可分辨）；② **改代码**：去重后**重排**（`y` 得 rank 2），并加"与入参本就无重复时逐位相同"的等价断言 | NC-4 实测见下 |

### 7.1 负向控制（每条修法各配一次，证明新防线**有牙**）

| NC | 操作 | 旧行为 | 新行为（实测） |
|---|---|---|---|
| **NC-1** | **清空**测试文件（0 字节） | `node --test <空文件>` ⇒ `# tests 1 / pass 1 / exit 0`（假绿） | `node tests/gate.mjs` ⇒ **exit 1**，`[vector·gate] 红：1 项 · 文件为空（0 字节）…` |
| **NC-2** | **删掉一整条用例**（15→14） | 旧 `>=13` 自检**不变色**（复核实测：`# tests 13/pass 13/exit 0`） | 两道同时红：外部闸 `用例条数 14 ≠ 期望 15` **exit 1**；文件内自检 `not ok 1 - B1.1-⓪` **exit 1** |
| **NC-3** | 空目录跑**旧通配**写法（对照） | `node --test "/tmp/emptyglob/*.test.mjs"` ⇒ **exit 0**、`# tests 0 / pass 0`（确认缺陷①为真） | 该写法**已在自包内移除**（现走 `tests/gate.mjs`） |
| **NC-4** | 把 `rrf.ts` 退回「**只去重不重排**」 | 原实现 `['x','x','y']` ⇒ `y` rank **3** | `not ok 3 - B1.1-② …去重**并重排**`，`# pass 14 / # fail 1`，**exit 1**；恢复后 sha256 `c469a8d541cdaa4f` 与改前**逐字相同** |

> NC-2/NC-4 的旋钮**均已逐字恢复**（`rrf.ts` `c469a8d541cdaa4f`、测试文件 `926a10f8c2c81bdb`），恢复后复跑 `# tests 15 / # pass 15 / # fail 0`。

### 7.2 本轮新增/改动的文件

```
87f8c6b27b2729e2  packages/vector/package.json        （test script 改显式路径 + 新增 test:raw）
6cbd9d6e7a111803  packages/vector/tests/gate.mjs      （新：外部闸）
926a10f8c2c81bdb  packages/vector/tests/b11-vector.test.mjs （15 条；②计数改相等、④重排断言、⑭缺口钉住）
c469a8d541cdaa4f  packages/vector/src/rrf.ts           （④：文案更正 + 去重重排）
```

### 7.3 未碰墙（补口期复验）

- 根配置：`git diff --stat package.json package-lock.json tsconfig.base.json .gitattributes` → **0 行**（**只改 `packages/vector/package.json`**，自包内）。
- `packages/core/**`：`53c92707954562b160afbb83b72e21fd33cd14ef023092fcf2f2cb24ccac1ebe` / `3a80122b7fa789a7c471056c442cce1af7e237fc10b97bef0f78abc16fbce8f6`，与 `_freeze.sha256` **逐字相同**（缺陷③**未**为此改 core，按令照办）。
- `/mnt/d/FF/shoucang/lib/vec.js`：sha256 `6fd22cac9162c55bc049cb10ef4994fd02fc88c2fdca8066cd4dda6f8344cea6`，mtime 仍 `2026-09-24 17:58:47.587 +0800`（开工前快照）。
- `git status` 里的 `packages/core/src/index.ts`(19:33) / `packages/jev/src/index.ts`(19:48) / `tools/a0-check.mjs`(19:34) 均为**他席在途**（mtime 早于本席开工 `20:19`），非本席所改；本轮**未执行 `git add`**。
