# S-verify2 · 独立复核席 2 · 交付单

> **本席不产出任何改动**，只独立判「这是从根因解决，还是拆东墙补西墙」。写面仅本文件，其余一律只读。
> **纪律**：只复跑、不代改；判不出写「未验证」；退出码一律不经管道取；判据先证「有东西被测」再看 pass/fail。
> 全部命令在 `/home/lk/Mana` 下执行。**四席此刻都在写盘，每条结论标快照时间。**
> 前任报告：`docs/handoff/S-verify.md`（21.7 KB，基线四条 + r1/r2/r3）。本席**接续**，不重复其已判项。

---

## 一、v2 · 只读基线（第 1 项：全仓判据现状）

### [v2-1] 全仓九包判据现状 · **基线复现成功**（判真）

**尺子**：`/tmp/verify2/ruler.sh`（自建，绝对路径版）。三段防护：
① `find "$D/tests" -maxdepth 1 -name '*.test.mjs'` **显式列文件**（非 shell 通配）；
② 命中 0 ⇒ 立刻 `NOFILES` 判红并**exit 1**（空集不许静默通过）；
③ 跑完断 TAP `# tests N` 且 **N>0** 才认绿；退出码直接取（不经管道）。

**关于前任尺子的「路径 bug」——实测结论：不是内部拼接 bug，是 API 口径不符**
```
$ bash /tmp/ruler/ruler.sh packages/metacognition          # 传相对路径
RED① [packages/metacognition] 测试文件命中 0
  注: 目录不存在 /home/lk/Mana/packages/packages/metacognition/tests（= 尚未开工）
```
该脚本第 3 行 `D="/home/lk/Mana/packages/$pkg"` —— 它要的是**包名**（`metacognition`），传**路径**才会拼成 `packages/packages/`。
⇒ 主持人「传相对路径会拼成 packages/packages/...」的描述**成立**，但成因是**用法/接口不符**（脚本注释即写 `<包目录名>`），**不是脚本拼接逻辑坏**。我用**绝对路径入参**重写了一版消除该歧义。

**测量条件**：快照 `2026-09-24T12:08:51Z`（UTC）= 本地 `20:08:51`。

| 包名 | 测试文件数 | tests | pass | fail | exit |
|---|---|---|---|---|---|
| core | 3 | 34 | 34 | 0 | 0 |
| metacognition | 2 | 15 | 15 | 0 | 0 |
| user-model | 1 | 4 | 4 | 0 | 0 |
| scheduler | 1 | 12 | 12 | 0 | 0 |
| ui | 1 | 10 | 10 | 0 | 0 |
| jev | 1 | 11 | 11 | 0 | 0 |
| vector | 0 | — | — | — | **1** |
| long-term | 0 → 1 ※ | — → 3 ※ | — | — | **1** → 0 ※ |
| consolidation | 0 → 1 ※ | — → 3 ※ | — | — | **1** → 0 ※ |
| forgetting | 0 → 1 ※ | — → 3 ※ | — | — | **1** → 0 ※ |
| attention | 0 | — | — | — | **1** |
| perception | 0 | — | — | — | **1** |
| working-memory | 0 | — | — | — | **1** |

**与主持人基线对照**：metacognition 15/15、user-model 4/4、scheduler 12/12、ui 10/10、jev 11/11 —— **逐项一致，独立复现成立**。
`vector`/`long-term`/`consolidation`/`forgetting` 无测试文件 —— **亦复现**。

※ **本席实测到一条主持人基线未含的动态（时序）**：sweep 期间（20:08:51）这三个包**确无测试文件**，但在 **20:09:57**（sweep 之后 66 秒）`long-term`/`consolidation`/`forgetting` **各出现 1 个 `tests/skeleton.test.mjs`**（三件同一秒落盘，见 `stat` 输出）。**重跑得 3/3/3 全绿 exit 0**：
```
$ stat -c '%y  %n' packages/{long-term,consolidation,forgetting}/tests/skeleton.test.mjs
2026-09-24 20:09:57.881197856 +0800  …/long-term/tests/skeleton.test.mjs
2026-09-24 20:09:57.881789881 +0800  …/consolidation/tests/skeleton.test.mjs
2026-09-24 20:09:57.882278696 +0800  …/forgetting/tests/skeleton.test.mjs
$ bash /tmp/verify2/ruler.sh /home/lk/Mana/packages/long-term        # 同法跑三包
ROW|long-term|files=1|tests=3|pass=3|fail=0|exit=0
ROW|consolidation|files=1|tests=3|pass=3|fail=0|exit=0
ROW|forgetting|files=1|tests=3|pass=3|fail=0|exit=0
$ md5sum packages/{long-term,consolidation,forgetting}/tests/skeleton.test.mjs
79332ab21a6debe838856f6289668c62  …/long-term/tests/skeleton.test.mjs
24bf9e51cfc866d69350c1c85a31da44  …/consolidation/tests/skeleton.test.mjs
08704199f2593c7c816500e459b6d308  …/forgetting/tests/skeleton.test.mjs
```
⇒ 「无测试文件」对这三包**已过期**（另一席在途补齐 B1.0 壳的测试）。**尚未判**其断言内容是否满足 G9 —— 那是另一项，本项只报现状。

**⚠ 未开工是静默的（同族于前任 F1，本席独立复现并给出机制）**：`vector`/`attention`/`perception`/`working-memory` 四包的 `tests/` **目录真实存在但为空**（`ls -A` 输出空）。故：
- 用 `node --test "packages/vector/tests/*.test.mjs"`（shell 传通配）⇒ **静默 exit 0、`# tests 0`**，会把「未开工」读成「通过」；
- 用 `node --test packages/vector/tests/x.test.mjs`（显式路径）⇒ `exit 1 Could not find`；
- **本席尺子取前者已知假绿的反面**：命中文件数 0 即判红并 exit 1（表里四包 exit=1 即此腿生效）。
⇒ 主持人「向量席无测试文件」若**只**用 wildcard 口径检查，会得到与前席 F1 相同的**假绿**。**本席的判红口径更严，不与主持人基线冲突（是加严）。**

**自洽核对**：sweep 前后各取一次全部 9 个测试文件 md5，**逐字相同**（无文件在 sweep 中被改动）⇒ 本表是**自洽的一次快照**。

### [v2-1b] `vector` 席现状核对（只读补充）

`packages/vector/tests/` 为空目录（`mtime 18:36`，自 W0 起未动）。**未验证**：vector 席本轮是否已有在途产物（目录 mtime 停在 18:36 提示未动，但**不能据 mtime 断言无在途写**）。

⚠ **[v2-1b-补]** 快照 `2026-09-24T12:21:12Z`（本地 20:21）复查 ⇒ **vector 席已开工但无判据**：
```
$ find packages/vector -type f | sort
packages/vector/cordis.patch.yml
packages/vector/lib/index.js
packages/vector/lib/types/index.d.ts
packages/vector/package.json
packages/vector/src/cosine.ts          ← 新
packages/vector/src/index.ts
packages/vector/src/rrf.ts             ← 新
packages/vector/src/vec-blob.ts        ← 新
packages/vector/tsconfig.json
$ ls -la packages/vector/tests/
（空，mtime 仍停在 18:36）
$ md5sum packages/vector/src/*.ts
d9fd5586ec0b772e29d76eb855275750  packages/vector/src/cosine.ts
3bf2f9cc8a98fe8e09d2ee2cc6e6e6ea  packages/vector/src/index.ts
979340eeeea1899ac5658e430bb66202  packages/vector/src/rrf.ts
abae762bdb89c219fd426a34abc06b90  packages/vector/src/vec-blob.ts
```
⇒ **`src/` 已有真实现（rrf / cosine / vec-blob 三个模块），`tests/` 仍为空**。
**这正是 [v2-1]（前任 F1）假绿机制的高危落点**：此时若用 `node --test "packages/vector/tests/*.test.mjs"` 检查，会得到 **`# tests 0` + exit 0 = 通过**，而该席**一条判据都没有**。
**本席不判其内容合规**（属另一项），只报「**有实现、无判据、且默认检查口径会读成绿**」这一事实。

### [v2-1c] `ui` 判据条数又变（收口引用须带快照）

快照 `2026-09-24T12:21:00Z`（本地 20:21）：
```
$ bash /tmp/verify2/ruler.sh /home/lk/Mana/packages/ui
ROW|ui|files=1|tests=13|pass=13|fail=0|exit=0
```
⇒ 20:14 时是 **10/13（d2-①②③ 红）**，20:21 已是 **13/13 全绿** —— S4 在途把槽判据（d2）跑通了。
**故本席 [r4-2] 的判假结论（A5-5 恒真）不受此影响**（那是**判据表达式**的性质，与 10 条还是 13 条无关，已用 /tmp 对照组端到端证明），但**主持人收口若引用「13/13 全绿」必须带 20:21 这个快照**。

---

## 二、v2 · 第 2 项：r4（S4 产物面）—— 补上一轮欠账

⚠ **时序（必须连结论一起读）**：S4 此刻正在补「接 `ctx.slots`」，其 `lib/client.js` 在我测量期间**正在变**：
```
20:10:45  lib/client.js  19,272 B   ← S4 自报口径是 9,557 B（已过期）
20:14     tests/ui.test.mjs md5 b3c2b4bdbc15558411fcfb31c9888247, test() 计数 = 13（原为 10）
```
故本节结论**分两个快照**给出，且**每条注明快照**。S4 自报的「10/10」对应**旧快照**，不是当前盘面。

### [r4-1] A5-2 对 client **产物字节** grep `node:fs|node:sqlite|process\.env` ⇒ **命中 0（判真）**

快照 `2026-09-24T12:11:14Z`（本地 20:11:14）。
```
$ for f in packages/ui/lib/client.js packages/ui/lib/client/index.js packages/ui/lib/client/host.js; do
    cnt=$(grep -c -E "node:fs|node:sqlite|process\.env" "$f"); printf '%-40s hits=%s (grep-exit=%s)\n' "$f" "$cnt" "$?"; done
packages/ui/lib/client.js                hits=0 (grep-exit=1)
packages/ui/lib/client/index.js          hits=0 (grep-exit=1)
packages/ui/lib/client/host.js           hits=0 (grep-exit=1)
```
**与主持人复验一致（三个文件均 0）**，本席独立复现成立。
**加严补充**：对**整个 `lib/` 树** grep（不止三个文件），命中 3 个文件：`lib/types/store.d.ts`、`lib/types/panel.d.ts`、`lib/panel.js` —— 均为 **Host 半区**（`panel.js` 里 `process.env` 是宿主侧合法用法），**不是 client 产物**。⇒ 边界正确，但**该边界是靠「人工挑三个文件」维持的，不是靠判据自身的目录范围**（见 [r4-4]）。

### [r4-2] 「单一 client 产物」⇒ ⚠ **判据恒真（假绿），判假**

`tests/ui.test.mjs:56-58` 原文：
```js
const files = readdirSync(libDir)
const clients = files.filter((f) => f === 'client.js')      // ← 谓词恒等于文件名自身
assert.equal(clients.length, 1, `client 产物必须唯一，实测 ${files.join(', ')}`)
```
`filter(f => f === 'client.js')` 的结果**只可能是空或恰好 1 个**（每个目录项名唯一）⇒ 该断言**无论目录里有多少个 client 产物都恒绿**。独立复现（/tmp，未写仓库）：
```
$ node -e "readdirSync('/tmp/verify2/vac/lib').filter(f=>f==='client.js')"   # 目录内含 client.js / client-2.js / client.bundle.js
readdirSync = [ 'client-2.js', 'client.bundle.js', 'client.js' ]
filter(f=>f===client.js) = [ 'client.js' ] length= 1
断言 assert.equal(clients.length,1) 结果 = PASS(绿)
--- 反证：目录里其实有几个 client* 文件 ---
glob client* = [ 'client-2.js', 'client.bundle.js', 'client.js' ]
```
**端到端负向控制**（在 `/tmp/verify2/ctl`，用 `core`/`node_modules` 软链复刻同构树；**未动仓库任何字节**）：

| 组 | 目录内容 | 13 条判定 |
|---|---|---|
| 对照组 | 原样 | `# tests 13 / pass 10 / fail 3` |
| 实验组 | **原样 + 注入 `lib/client-2.js`**（一个合法的 `window.__ModuleLoader__.load` 工厂壳，**且含 `require('node:fs')`**） | `# tests 13 / pass 10 / fail 3` |

```
$ diff <(grep -E "^(not ok|ok) [0-9]+ -" ctl.out) <(grep -E "^(not ok|ok) [0-9]+ -" arm2.out)
*** VERDICT IDENTICAL: 注入第二个含 node:fs 的 client 产物后，13 条判定逐条不变 ***
$ ls /tmp/verify2/ctl/ui/lib/ ; grep -c "node:fs" /tmp/verify2/ctl/ui/lib/client-2.js
client  client-2.js  client.js  index.js  panel.js  store.js  types
1
```
其中 `ok 1 - A5-1/A5-5 …产品必须唯一` 与 `ok 3 - A5-2 …` **照旧全绿**。
⇒ **A5-5「产物唯一」与 A5-2「产物不得含宿主 API」都不会因「多出一个含 `node:fs` 的 client 产物」变色。** 这正是本仓最防的形态：**缺陷引入后判据不变色**。

**⚠ 但我不据此判 S4 现状为红 —— 必须区分「判据缺陷」与「现状缺陷」**：
- **判据缺陷（成立，判假）**：A5-5 的断言表达式恒真，**它证明不了它声称的事**。
- **现状（未判红）**：当前盘面 `lib/client.js` **确实只有 1 个**（`ls lib/` = `client.js` 单件）。
- **⚠ 另需主持人注意的真风险**：`lib/client/` **子目录里还有 `index.js` + `host.js`**（各 4,430 / 2,948 B，**ESM，含 `import`/`export`**，由 `tsconfig.client.json` 的 tsc 编译产出）。它们**不是** ModuleLoader 形态 ⇒ **按我实测的形态判据不是 client 产物**；但 `readdirSync(lib)` 是**非递归**的，故 A5-5 **连「lib/ 下是否存在其他 client 候选」都没枚举**。**未验证**：DSH 宿主按哪个路径发现 client 产物（我在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/` 下 grep `__ModuleLoader__` **零命中**，未能定位发现逻辑）⇒ **我不断言 `lib/client/index.js` 是会产生实际影响的第二产物**，只报「判据没有枚举它、也没有排除它」。**建议判据改成**：`readdirSync(libDir).filter(f => /^client/.test(f))` 长度必须为 1，或显式断言「除 `client.js` 外 lib/ 根下不得有其他 `client*.js`」。

### [r4-3] Host 入口体积同量级 ⇒ **判真（数值精确复现）**

快照 20:11:14。
```
$ wc -c packages/ui/src/index.ts packages/ui/lib/index.js /mnt/d/lk/FF/dsh-frozen-injection/src/index.ts
  4413 packages/ui/src/index.ts
  2480 packages/ui/lib/index.js
  5002 /mnt/d/lk/FF/dsh-frozen-injection/src/index.ts
```
⇒ **4,413 B** 与 S4 自报**逐字一致**，样板 **5,002 B** 亦与 S4 自报一致（同量级、个位数 KB）。**判真**。
补充核对 `tests/ui.test.mjs:100-106` 的两条加严断言：`bytes < 50_000`、`bytes < panel.ts+store.ts` 之和 —— **非恒真、有负荷**（把逻辑塞进入口会被抓）。

### [r4-4] A5-2「三模式命中 0」的守卫面 ⇒ **有效但范围固定在硬编码的三个文件**

S4 判据里 grep 的是**单一文件** `lib/client.js`（`tests/ui.test.mjs:93`），**不是**主持人列的三个文件：
```js
const code = readFileSync(new URL('lib/client.js', PKG), 'utf8')
const hits = code.match(/node:fs|node:sqlite|process\.env/g) ?? []
assert.equal(hits.length, 0, …)
```
主持人说「判的是产物字节不是源码语义 —— 三个文件」——**这三是复验时的取材范围，不是判据自身的范围**。二者在当前盘面**结果相同**（都 0），但**强度不同**：判据只覆盖 1 个文件。
⇒ **判真（当前 0 命中）**，但**覆盖面比复验口径窄**，且与 [r4-2] 同因：**产物集合由硬编码文件名决定，不由目录枚举决定**。

### [r4-5] `lib/client.js` 体积异常 ⇒ **未验证（S4 正在写，不可判）**

S4 自报 9,557 B ⇒ 实测 **19,272 B**（`20:10:45`），**翻了一倍**。S4 同时在补 `ctx.slots` 接线，`lib/client.js` 由 `scripts/build-client.mjs` 把 `src/client/{index,host}.ts` **文本级内联**生成 ⇒ 体积增长与该在途工作一致。**但本席不判其合规**：A5-4 只管 Host 入口（`src/index.ts`），**client 产物无体积上限判据**。**未验证**：19,272 B 是否为最终态。

**⚠ 一条方法论提醒（供主持人收口时用）**：`tests/ui.test.mjs` 在 20:14 已含 **13** 条（新增 d2-①②③ 槽判据），其中 d2-①②③ **当前为红**（`# fail 3`）——这是 S4 在途工作的**预期中间态**，**不构成本轮判红**。但**「10/10 全绿」的说法已对不上当前盘面**（当前是 10/13）。收口引用 S4 证据时**须带快照时间**。

---

## 三、v2 · 第 3 项：四席交付物边界核对

**快照**：`2026-09-24T12:17:28Z`（本地 20:17:28）。**W0 收口点** = `ee9e22e` @ `2026-09-24 19:06:43 +0800`。

### [b1] 契约哈希腿 ⇒ **逐字未变（判真）**

```
$ sha256sum packages/core/src/event-types.ts packages/core/src/domain.ts
53c92707954562b160afbb83b72e21fd33cd14ef023092fcf2f2cb24ccac1ebe  packages/core/src/event-types.ts
3a80122b7fa789a7c471056c442cce1af7e237fc10b97bef0f78abc16fbce8f6  packages/core/src/domain.ts
$ cat docs/contract/_freeze.sha256
53c92707954562b160afbb83b72e21fd33cd14ef023092fcf2f2cb24ccac1ebe  packages/core/src/event-types.ts
3a80122b7fa789a7c471056c442cce1af7e237fc10b97bef0f78abc16fbce8f6  packages/core/src/domain.ts
```
⇒ **两行逐字相等**，与主持人「复验多次」的基线一致。本席**独立复现成立**。

### [b2] 禁改面（根配置 / 契约档）⇒ **零写入（判真）**

```
$ git status --porcelain package.json package-lock.json tsconfig.base.json .gitattributes
（空）
$ git status --porcelain docs/contract/
（空）
```
**加严复验（按 mtime，比 git 更能抓「改了又改回来」）**：
```
$ find package.json package-lock.json tsconfig.base.json .gitattributes docs/contract -type f -newermt "2026-09-24 19:40"
（空）
```
⇒ 自 W1 开工（19:40）以来，**禁改面零字节写入**。

### [b3] `packages/core/**` 写者归属 ⇒ **写入确实存在，但全部落在 W1 开工前，指向 S0（判真·非本会议四席越界）**

```
$ git status --porcelain packages/core/
 M packages/core/src/index.ts
?? packages/core/src/open.ts
?? packages/core/tests/b10-open.test.mjs
```
**归属判据 = mtime 与 W1 开工点对比**（19:40 = 本会议四席开工量级），且与 W0 收口 commit `19:06:43` 对比：
```
$ stat -c '%y  %n' packages/core/src/index.ts packages/core/src/open.ts packages/core/tests/b10-open.test.mjs
2026-09-24 19:33:11  packages/core/src/index.ts
2026-09-24 19:13:30  packages/core/src/open.ts
2026-09-24 19:32:46  packages/core/tests/b10-open.test.mjs
$ find packages/core -type f -newermt "2026-09-24 19:40"     # W1 期内是否有人写 core
（空）
```
⇒ **三个 core 文件全部在 19:06（W0 收口）之后、19:40（W1 开工）之前落盘**；W1 期内 **core 零写入**。
**内容核对**：`git diff packages/core/src/index.ts` = `66 insertions(+), 1 deletion(-)`，内容是 **B1.0 定期备份**（`backupNow`/`pruneBackups`/`resolveBackupDir`/`startBackupTimer` + Config 四项 `backupEnabled/backupIntervalMs/backupKeep/backupDir`，缺省 `backupEnabled=false`），`open.ts` 即会议前提所述 **S0 在途件**。
⇒ **与 S0（B1.0 开库器）的写面完全吻合**；**四席（S1/S2/S3/S4）对 core 零写入**。**判真：无越界。**
（`tools/a0-check.mjs` +12 行 = 新增 `A0-14` 源文件可解析元门禁，依赖 `tools/check-comment-guard.mjs`；两件 mtime `19:34:22`/`19:33:23`，**同在 W1 开工前**，**归 S0 的 W0 收尾面**，非四席越界。）

### [b4] 各席包写面 ⇒ **各写自己的包，无交叉（判真）**

| 包 | git 状态 | 19:40 后被写文件数 |
|---|---|---|
| vector | （无条目） | **0** |
| metacognition | `??`（新增） | 17 |
| user-model | `??`（新增） | 7 |
| jev | `??` + ` M src/index.ts` | 7 |
| scheduler | `??`（新增） | 12 |
| ui | `??`（新增） | 22 |

⇒ **无一处是「他席包被本席写」**：六包中五包为**全新目录**（`??`），`jev` 的 `M` 是 **S2 对自己包**的追加式改动（`38 insertions(+), 9 deletions(-)`）。**`vector` 19:40 后零写入** —— 与 [v2-1]「vector 无测试文件」一致，**vector 席尚未开工**。

### [b5] 主持人裁定项复核：**S1 未越界建 `ui` 骨架（判真）**

裁定要求「S1 只建 metacognition + user-model 两个骨架，ui 骨架归 S4」。独立核对：
```
$ find packages/metacognition packages/user-model -iname "*ui*"     → （空）
$ ls packages/metacognition/src/ packages/user-model/src/
metacognition: criteria.generated.ts  criteria.ts  index.ts
user-model:    index.ts
$ grep -rn "slots|SLOT_KEY|ctx.slots" packages/metacognition/src/ packages/user-model/src/   → （空）
```
⇒ S1 两包**无 ui 文件、无 slot 相关代码**；`SLOT_KEY`/`slots.register` 仅存在于 `packages/ui/src/client/index.ts:67,315-346`（**S4 面**）。
⇒ **裁定被执行，无同目录两写者。判真。**

### [b6] handoff 写面 ⇒ **各写各的，本席零越界（判真）**

```
$ ls -la docs/handoff/
S-verify.md (20:03)  S-verify2.md (20:17)  S1.md (19:53)  S2.md (19:54)  S3.md (19:50)  S4.md (19:54)
$ find . -newermt "2026-09-24 20:07" -type f -not -path "./.git/*" -not -path "./node_modules/*" -not -name "S-verify2.md"
…（列出的 24 个文件全部属他席：consolidation/long-term/forgetting/ui/scheduler 的在途产物 + .roundtable 会议状态）
```
⇒ 本席在 20:07 之后**唯一写过的文件是 `docs/handoff/S-verify2.md`**；列出的其他文件均属**他席在途工作**（B1.0 三壳补测试、S4 接 slots、S3 新增 fixtures），**本席零写入**。⇒ **本席写面纪律成立。**
（注：`packages/scheduler/tests/fixtures/effect-probe.mjs` 为新出现件 ⇒ **S3 正在写**，属其本职续作。）

### [b7] 结论：**未发现任何越界**

四席均未碰：`packages/core/**`（W1 期内零写入）、根 `package.json`/`package-lock.json`/`tsconfig.base.json`/`.gitattributes`、`docs/contract/**`、他人包、他人 handoff。**契约哈希腿逐字未变**。
⚠ **唯一未定项**：清单腿。会议前提已述「`files.txt`/`_freeze.head` 已漂（S0 在途新增 `open.ts` + lib 产物）⇒ 待 S0 收口后重取」。本席**复现该漂移**（见 [b3] 的 core 三件在途 ⇒ 必然使清单腿漂），**但本项判据不在本席本轮派单内，未深查**。

---

## 四、本席写面自检

- 本席**只写** `docs/handoff/S-verify2.md`；**未改动任何被测文件**（前后快照 md5 逐字比对见 [v2-1] 自洽核对、[r4-*] 的 pre/post hash）。
- 全部负向控制实验在 **`/tmp/verify2/`** 下进行（`ctl`/`arm2`/`vac`/`uicopy`），**未在仓库内写任何字节**。
- 本席**未跑**任何 `npm install` / 全局 build / profile 装配 / `~/.dsh/` 写入。

## 五、未验证清单（不含猜测）

| # | 事项 | 状态 |
|---|---|---|
| U1 | DSH 宿主**按哪个路径**发现 client 产物（决定 `lib/client/index.js` 是否构成真实第二产物） | **未验证**：`grep -rln "__ModuleLoader__" /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/` **零命中**，未能定位发现逻辑。故 [r4-2] 只断言「**判据没枚举它**」，**未断言它有害** |
| U2 | `lib/client.js` 19,272 B 是否为最终态 | **未验证**：S4 在途写（`build-client.mjs` 文本级内联，体积随 `ctx.slots` 接线增长）；client 产物**无体积上限判据** |
| U3 | `tests/ui.test.mjs` d2-①②③（槽判据）当前为红 | **未验证属预期中间态**：S4 在途；**本席不判红**，仅记录当前盘面是 10/13 而非 10/10 |
| U4 | B1.0 三壳（long-term/consolidation/forgetting）新增的 3 条断言内容是否满足 G9 | **未验证**：本项只报「测试文件已出现且 3/3 绿」，**断言内容属另一项** |
| U5 | 清单腿（`_freeze.files.txt` / `_freeze.head`）漂移量 | **未验证**：不在本轮派单内（会议前提已裁「待 S0 收口后重取」） |
| U6 | vector 席是否有在途产物 | **未验证**：`packages/vector/` 19:40 后零写入、`tests/` 空且 mtime 停在 18:36，但**不据 mtime 断言无在途写** |

## 六、契约版本

**已核 `_freeze` 三元组（哈希腿）@ 快照 2026-09-24T12:17:28Z**：
`sha256sum -c` 对 `packages/core/src/event-types.ts`（`53c92707…`）、`packages/core/src/domain.ts`（`3a80122b…`）与 `docs/contract/_freeze.sha256` **逐字相等**。
⚠ **清单腿已漂**（S0 在途新增 `packages/core/src/open.ts` + `core/src/index.ts` 改动 + `lib/types/*.d.ts` 产物）—— 与会议前提描述一致，**本席复现该状态**，按裁定**待 S0 收口后重取**。
本席**复核期间未改动任何被测文件**。

---

## 四、r6 · 复核 S3 席 d3 修复（快照 2026-09-24T12:25–12:33Z）

**被测快照（md5）**：`scheduler/src/index.ts 678c2c6a8cd805653ae57de081f176aa`（**与前任 r3 快照逐字相同 ⇒ d3 未改 scheduler）**、`goal-stack.ts a37a51e54b7e569ef34dde524aac1b55`（同前）；三壳 `long-term/src/index.ts 02d07a0283ca04b9ac20a25422a8fdba`、`consolidation abbbaedadc8cf0fefe897b52aca4aa6c`、`forgetting 817978304d19b424dfc8465766b17f70`；`scheduler/tests/scheduler.test.mjs a748f237c4947f8b5bcd94f250ef265f`。
**纪律说明**：**本席未改动仓库任何被测文件**；全部变异/负向控制都在 `/tmp/verify2/` 的副本内做（`r6a`/`r6b`/`r6c`/`r6c2`），**故「改完必须复原」在本席不适用——因为从未改过源仓**。

### [r6-5] 自报的判据读数 ⇒ **逐项复现（判真）**

```
$ for p in scheduler long-term consolidation forgetting; do bash /tmp/verify2/ruler.sh /home/lk/Mana/packages/$p; done
ROW|scheduler|files=1|tests=14|pass=14|fail=0|exit=0
ROW|long-term|files=1|tests=6|pass=6|fail=0|exit=0
ROW|consolidation|files=1|tests=6|pass=6|fail=0|exit=0
ROW|forgetting|files=1|tests=6|pass=6|fail=0|exit=0
$ for p in scheduler long-term consolidation forgetting; do (cd packages/$p && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit); echo "$p tsc-exit=$?"; done
scheduler tsc-exit=0 / long-term tsc-exit=0 / consolidation tsc-exit=0 / forgetting tsc-exit=0
$ git status --porcelain package.json package-lock.json tsconfig.base.json .gitattributes
（空）
```
⇒ scheduler **14/14**、三架 **各 6/6**、四包 **tsc exit 0**、**根配置零改** —— **全部与自报一致**。**判真。**

### [r6-A] 缺陷 A：`Config.enabled` 是否真删、是否还有零消费假旋钮 ⇒ **真删；scheduler 写面无零消费键（判真）**

**① 真删**（非「注释说删了」）：
```
$ for p in long-term consolidation forgetting; do printf '%-14s ' "$p"; grep -c "export const Config\|export interface Config" packages/$p/src/index.ts; done
long-term      Config 导出数=0
consolidation  Config 导出数=0
forgetting     Config 导出数=0
```
且三包 `apply` 签名已无 config 形参；`schemastery` 引用随之清零。

**② 扫「契约里存在、但行为上无效」的键** —— 机械扫描**全部 13 包**（抽 `Schema.object` 声明的键，数 `config.<键>` 消费次数）：
```
--- scheduler ---          maxCycles=2   maxGoals=2      ← 本席写面，两键均被消费
--- long-term / consolidation / forgetting --- （无 Config 声明 ⇒ 无键可查）
```
**行为级复核（不只数引用次数，而是看行为是否真的变）**：
```
$ node probe.mjs   # /tmp 内装载真 Context，经插件选项传 config（不改源码）
maxGoals=1 ⇒ 首次拒绝发生在第 2 次入栈（栈内 1 个）
maxGoals=3 ⇒ 首次拒绝发生在第 null 次入栈（栈内 3 个）
$ node probe2.mjs
maxCycles=1 ⇒ run() 轮数 = 1
maxCycles=4 ⇒ run() 轮数 = 2
```
⇒ 两键**都改变可观测行为**（`maxGoals` 改变拒绝点、`maxCycles` 改变轮数上界）⇒ **不是假旋钮**。**判真**：S3 写面（scheduler + 三壳）**无零消费配置项**。

**⚠ 越界发现（不是 S3 的缺陷，属他席在途，本席只报不判）**：全仓扫描命中**若干零消费键**，其中 `packages/jev/src/index.ts:30,32,34,36` 的 4 项**已自带** `⚠ B1.2 **尚未实现**` 标注（**已披露，非静默**）；另有一批**无该标注**：`attention.jevThreshold`、`metacognition.confidenceTarget`、`perception.maxChunkChars`、`perception.chunkOverlapChars`、`working-memory.budgetChars`。
⇒ 这些是 **S5/W2 写面**（`perception`/`working-memory`/`attention` 属 S5，`metacognition` 属 S1），**不在本席派单内、也不在 S3 写面内**，**本席不判红**，仅按「会让失败不可观测」排序上报：**契约里声明了、行为上零消费、且无「尚未实现」标注** —— 与 S3 被判的缺陷 A **同族**。**建议主持人按写面归属派单**。

### [r6-B] 缺陷 B：`behavior==='skeleton'` 断言是否真能变红 ⇒ **能（判真）**，且**有附加缺陷（判假）**

**① 正向断言能变红**（`/tmp/verify2/r6b`，副本内把 `behavior` 改成 `'active'`）：
```
$ sed -i "s/behavior: 'skeleton'/behavior: 'active'/" src/index.ts   # 仅在 /tmp 副本内
$ node --test tests/skeleton.test.mjs
MUT_EXIT=1
# tests 6 / # pass 5 / # fail 1
not ok 1 - ① behavior 由运行时服务面机检（填了实现在忘改 ⇒ 必红）
  error: 本包尚无行为 ⇒ behavior 必须为 'skeleton'，实测 active
         + actual - expected  + 'active'  - 'skeleton'
```
⇒ 断言**有牙**、**读的是运行时服务面**（`svc.status()`）而非 grep 源码 ⇒ **是机检而非注释承诺**。**判真。**

**② ⚠ 但它声称的「反向约束」不成立（README 承诺 > 实际能力）** —— `src/index.ts:12-13` 原文：
> 「**反向约束**：若实现了真行为又把 `behavior` 留成 `'skeleton'`，判据同样变红」

**独立反例（`/tmp/verify2/r6b`，副本内注入真行为、`behavior` 保持 `'skeleton'`）**：
```
$ node --test tests/skeleton.test.mjs
REV_EXIT=0
# tests 6 / # pass 6 / # fail 0      ← 六条全绿
$ node probe.mjs   # 同副本，证注入的是"真行为"
behavior 读口径 = skeleton
mana_trace 行数 before= 0  after= 1  增量= 1     ← 真落痕，行为是真的
```
⇒ **「有真行为但仍标 skeleton」这一形态：6/6 全绿，判据一分不变。** 与文档承诺**相反**。
**机制**：六条判据中，① 断言 `behavior==='skeleton'`（只读自报字符串）、② 断言 effect 面有 pre-step 监听器（**监听器存在 ≠ 无行为**）、③ 断言链完好、⑤ 断言不导出 `Config` —— **没有一条**断言「本包不产生 `mana_trace` 行」。故**行为有无**这一维度**零覆盖**。
```
$ for p in long-term consolidation forgetting; do grep -c "writeTrace\|mana_trace\|反证" packages/$p/tests/skeleton.test.mjs; done
0 / 0 / 0        ← 三包测试对"是否真写行"零断言
```
⇒ **判假（判据面缺口）**：`behavior: 'skeleton'` 目前是**自报字符串**，**其真实性不被任何判据校验**。文档把它写成双向约束（「填了实现忘改 ⇒ 红」+「有行为留 skeleton ⇒ 红」），**只有前半句成立**。
**建议改法（供 S3/后续，本席不代改）**：加一条**行为反证**——装载态跑一次 `agent/pre-step`，断言 `mana_trace` **行数不变**（`after === before`）；一旦有人填实现，该条必红，`behavior` 才真正被双向钉住。

### [r6-C] 主张 4：空文件在显式路径下也假绿 + 「真计数自检」是否挡住 ⇒ **主张成立（判真）；自检挡住「截断」但挡不住「零字节」（判假·防线缺口）**

**① 主持人要求复核的形态，独立复现成立**：
```
$ : > empty.test.mjs            # 0 字节
$ node --test empty.test.mjs
EMPTY_EXIT=0
# tests 1 / # pass 1 / # fail 0
```
⇒ **0 字节文件报 `tests 1 / pass 1 / exit 0`**（计的是「文件加载成功」）⇒ **主张 4 成立**，且与主持人独立复现一致。**判真。**

**② 它的「真计数自检」是什么**：`tests/skeleton.test.mjs:124-127` 第⑥条 —— `let ran=0` 每条 `ran+=1`，末条 `assert.equal(ran, EXPECTED_CASES=6)`。

**③ 自检对「部分截断」有效**（`/tmp/verify2/r6c2/arm`，副本内删掉①–⑤只留⑥）：
```
$ grep -c "^test(" long-term/tests/skeleton.test.mjs   → 1
$ node --test tests/skeleton.test.mjs
ARM_A_EXIT=1
# tests 1 / # pass 0 / # fail 1
not ok 1 - ⑥ 用例计数自检
  error: 本次执行到的用例数必须为 6；实测 1（有用例被删即红）
```
⇒ **自检有牙，截断会被抓。判真。**

**④ ⚠ 但它对「零字节」形态**天然**无效**（同一副本次第做，把测试文件清空）：
```
$ : > tests/skeleton.test.mjs ; wc -c tests/skeleton.test.mjs   → 0
$ node --test tests/skeleton.test.mjs
ARM_B_EXIT=0
# tests 1 / # pass 1 / # fail 0        ← 仍然全绿
```
**机制**：自检是**文件内**的断言 —— **文件被清空时，自检代码本身也随之消失**，故该形态下它**不可能生效**（不是「没写好」，是「位置不对」）。
⇒ **判假（防线缺口）**：**文件内自检只能防「部分删减」，防不了「整体清空」**。要防零字节必须靠**外部**断言（见 ⑤）。

**⑤ 外部防线也不覆盖**（本席加严核查 `tools/a0-check.mjs`）：
```
$ sed -n '167,170p' tools/a0-check.mjs
const m = /# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/.exec(tt.out + tt.err)
…
if (tcOk && ttOk && m && Number(m[3]) === 0) { pass('A0-6', …) }
$ # 模拟「全部测试文件清空」后 node --test 的聚合输出
$ node --test "packages/*/tests/*.test.mjs"    → EXIT=0；# tests 2 / # pass 2 / # fail 0
A0-6 判定 = PASS（绿）    ← 门只有 Number(m[3])===0（只数 fail）
```
⇒ **A0-6 的门是「fail 数为 0」，既不要求 `tests > 0`，也不与用例总数比对** ⇒ **「所有测试文件被清空」时 A0-6 照绿**。
⚠ **但当前盘面 `npm test` 实测 `# tests 123 / pass 123 / fail 0`（exit 0）**，**无实际损失**；本项是**防线缺口**（对未来形态不设防），**不是现状缺陷**。
**建议（供主持人裁定归属）**：A0-6 加一条 `Number(m[1]) > 0`（或与预期总数比对）—— **该文件属 S0 写面（W0 期新增 A0-14 亦在此）**，故**本席不代改，转派**。

### [r6-D] C1 修复：`fiber.getEffects()` 能否区分「在链上 / 不在链上」⇒ **能，两个不同读数（判真）**

**对照组（同一份 pristine 代码，装载态 vs 卸载态）**：
```
装载态 labels = ["dsh-mana-long-term: service","ctx.provide(\"mana-long-term\")"]
装载态 服务可读 = true
卸载态 labels = []
卸载态 服务可读 = false
```
**实验组（`/tmp/verify2/r6c/long-term`，副本内删掉 `registerPassThroughPreStep` 调用 = 本包不在链上）**：
```
$ node --test tests/skeleton.test.mjs
N3_EXIT=1
# tests 6 / # pass 4 / # fail 2
ok 1 - ① behavior 由运行时服务面机检
not ok 2 - ② 本包真在 agent/pre-step 链上：effect 面出现监听器 + 卸载后消失
   error: 本包必须注册 pre-step 监听器（G9 / 册:318）；实测 effect 标签 = ["dsh-mana-long-term: service","ctx.provide(\"mana-long-term\")"]
ok 3 - ③ 链完整性：哨兵与最内层各走一次（漏调 next() ⇒ 哨兵 0）     ← ★ 仍绿
not ok 4 - ④ 传 {enabled:false} 不得关掉 G9 义务
ok 5 - ⑤ 不得导出 Config
ok 6 - ⑥ 用例计数自检
```
⇒ **C1 自述成立，且本席复现了它声称的「假绿」**：本包**不在链上**时，
- ③ **哨兵依旧绿**（因为 `core` 自己的监听器还在，链没断、哨兵照样走 1 次）⇒ **旧判据确实抓不到「本包没挂链」**；
- ② 用 `getEffects()` 的**标签存在性**抓到，且**卸载后标签清空**（对照组 `[]`）⇒ **两个读数可分辨**。
**判真**：`fiber.getEffects()` 有效区分在链/不在链；**C1 的修复方向正确**（把「链没断」与「本包在链上」这两件事分开断言）。

### [r6-E] 回归自检：原 12 条是否有一条变红 ⇒ **未发现变红（判真）**

`tests/scheduler.test.mjs` 14 条含新增的 `G 用例计数自检` + `B3 本包真在 pre-step 链上`（新增两条 ⇒ 12→14 与自报吻合）；**其余 12 条标题与前任 r3 复核时逐一对应**（A1/A2/B1/B2/C1/D1/D2/D3/D4/E1/F1/F2）。本席复跑 **14/14 全绿**。
⚠ **未验证**：**断言内容**是否与前任 r3 时逐字相同（**未做逐条文本 diff**，故不能断言「一条未改」；能断言的是**条数与标题集合一致、且无红**）。

### [r6-F] 汇总裁定

| 项 | 裁定 |
|---|---|
| 缺陷 A 真删 | **判真**（`Config` 导出数=0；三壳 `apply` 无 config 形参） |
| scheduler 写面无零消费键 | **判真**（`maxGoals`/`maxCycles` 均改变可观测行为） |
| 缺陷 B 正向断言有牙 | **判真**（改 `behavior` ⇒ ① 变红，读运行时服务面非 grep） |
| 缺陷 B 的「反向约束」承诺 | **判假**：有真行为 + 留 `skeleton` ⇒ **6/6 仍全绿**（三包测试对「是否真写行」零断言） |
| 主张 4（空文件假绿） | **判真**（0 字节 ⇒ `tests 1 / pass 1 / exit 0`） |
| 真计数自检 | **部分判真**：挡「截断」（删①–⑤ ⇒ ⑥ 红）；**挡不住「零字节」**（自检随文件一起消失） |
| 外部防线 A0-6 | **判假（缺口）**：门只有 `fail===0`，无 `tests>0` ⇒ 全空时照绿 |
| C1（getEffects） | **判真**（装载 `[service, provide, on×2]` vs 卸载 `[]`；缺监听器 ⇒ ② 红而 ③ 绿） |
| 回归（原 12 条） | **未发现变红**；**未验证**断言文本是否逐字未改 |

**「拆东墙补西墙」判定**：**未发现**。d3 的两处修复（删假旋钮 / 改用运行时服务面）都在**自包内**，且各自**负向控制可证有牙**；无越界写入（根配置空、core 契约哈希未变、scheduler 源 md5 与前任快照逐字相同 ⇒ **d3 对 scheduler 实现零改动**）。
**本轮判假的两条都不是「修坏了」，而是「承诺 > 实际能力」**：① 文档声称的双向约束只有单向成立；② 空文件防线对最极端形态无效。**属判据面缺口，不等于实现缺陷。**

---

## 五、r5（向量席）小结 · 主动停手前的状态（快照 2026-09-24T12:34–12:45Z）

**状态：四项（A/B/C/D）均已判到，结论如下**；未做的是「断言文本逐条 diff」这类延伸项。**全程在 `/tmp/verify2/r5*` 副本内变异，仓库零写入**（`diff -r src 仓库/src` 逐字相同、仓库 md5 未变、副本复原后回 14/14）。

- **[r5-A] 判据有负荷（判真）**：三处变异**全部被抓**——① `rrfTerm` 的 `k+rank`→`k+rank+1` ⇒ **B1.1-① 红**；② 降级信封 `rankBy` 改 `'jev_prob'` ⇒ **B1.1-⑦ 红**；③ 删 `assertDim` 维度校验 ⇒ **B1.1-④ 与 ⑧ 双红**。
- **[r5-B] 有计数自检但门槛偏松（部分判真）**：自检在 `tests/b11-vector.test.mjs:31-37`，用 `n >= 13` **而非相等**。实测：删掉整条 ⑤（14→13 条）⇒ **13/13 全绿 exit 0，自检未抓**。⚠ 对照：S3 三壳同族自检用 `assert.equal(ran, EXPECTED_CASES)`（**相等**）⇒ 删 1 条即红（[r6-C] 已证）。**本包门槛弱于 S3**。
- **[r5-C] 降级字段判真，但**无持久化痕迹****：真故障（`http://127.0.0.1:1/v1`）⇒ `degraded=true / channel='degraded' / rankBy='local_score' / reason` 含端点与原始错误 ⇒ **契约 `degradation.md` §1/§3 满足**。**但**独立查库：`mana_trace`/`jev_log`/`inject_log`/`memory_items` **增量全 0**；`mana/recall` 事件虽 `emit`，**全仓无消费者**（仅 `core/src/event-types.ts:40` 声明）。⇒ G8 只落在**返回对象**上，**跨进程/事后不可查**。**未验证**：契约是否要求 vector recall 落库（`degradation.md` §5 的 `inject_log` 要求针对 injection gate，非本包）——**本席不判红，报事实**。
- **[r5-D] 上游等价性判真，另发现两处文档不实**：`cosine` 与上游 `/mnt/d/FF/shoucang/lib/vec.js:93` 对拍 **13 用例（含空/长度不等/零向量/极小值/普通数组）最大绝对差 = 0**（**逐位相同**）；上游 sha256 `6fd22cac9162c55b…` **与其自述一致**（只读，未改）；RRF 三锚点 Δ=`1.15e-7/3.52e-7/1.82e-7` ≤1e-6；`RRF_DEFAULT_K=60` **== 上游 `criteria.json` 的 `surface.fusion.k=60`**。
  ⚠ **①** `rrf.ts:6` 称上游有 `denseRank.get(key) || 0` 的坑 —— 上游实际是 **`|| dense.length + 1`**（`vec.js:361`）；全库 grep **无 rank 类 `|| 0` 命中**（仅 `hits||0` 两处，非名次）⇒ **引述不实**（结论「本实现更严格」仍成立，但**理由描述错了**）。⚠ **②** 重复键去重后**不重排名次**：`rrfFuse([{keys:['x','x','y']}])` ⇒ `y` 得 **rank 3**（非 2）。
- **[r5] 拆东墙补西墙：未发现**；越界面干净（唯一写面 `packages/vector/**`）。
