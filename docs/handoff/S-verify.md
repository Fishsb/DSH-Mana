# S-verify · 独立复核席 · 交付单

> **本席不产出改动**，只独立判「这是从根因解决，还是拆东墙补西墙」。持有写面仅本文件。
> **纪律**：只复跑、不代改；判不出写「未验证」；结论必须带**快照时间**（四席包在复核期间仍在被写）。
> 全部命令均在 `/home/lk/Mana` 下执行（除非另行 `cd`）。**退出码一律不经管道取**。

---

## 〇、基线裁定（第 1 轮 · 2026-09-24T19:30–19:42 快照）

### [baseline-F1] 判据「退出码 0」对空集恒真 ⇒ **假绿**（判真）
```
$ timeout 30 node --test "packages/scheduler/tests/*.test.mjs"   # 目录不存在
exit=0
1..0
# tests 0
# pass 0
$ node --test packages/scheduler/tests/x.test.mjs                # 显式路径（非 glob）
exit=1  Could not find 'packages/scheduler/tests/x.test.mjs'
```
⇒ 未开工的席位会被读成通过。**修法**：`/tmp/ruler/ruler.sh`（三段腿：`find` 显式列文件 + TAP `# tests N` 断言 `N>0` + 退出码不经管道）。

### [baseline-F3] `--only <不存在的判据 id>` 静默通过（判真）
```
$ timeout 60 node tools/a0-check.mjs --only A0-999
共 0 项：PASS 0 · FAIL 0 · 挂账 0
✅ 无 FAIL        exit=0
```

### [baseline-F4] 契约三元组：哈希腿完好，清单腿漂 12 行（判真）
```
$ sha256sum -c <(grep -E 'event-types|domain' docs/contract/_freeze.sha256)
packages/core/src/event-types.ts: OK
packages/core/src/domain.ts: OK          exit=0
$ comm -23 live frozen | wc -l → 12      $ comm -13 → 0
```
漂移 12 行 = `packages/core/src/open.ts` + 11 个 `packages/*/lib/types/*.d.ts`（含 `core/lib/types/open.d.ts`）。
`_freeze.head`=**0083341** vs `HEAD`=**ee9e22e**。方向单一（只增不减）⇒ S0 在途新增，非内容篡改。
`docs/contract/handoff-protocol.md:35` 给的重取命令（`find packages …`）与冻存件格式不自洽（冻存件为无 `packages/` 前缀的裸相对路径）；`tools/a0-check.mjs` 的 A0-12 只逐字比两个哈希、**不校验清单腿**。

### [baseline-F6] `user_model_history` 缺表 + 判据面无覆盖（判真）
```
$ grep -c "user_model_history" packages/core/src/schema.ts
0                      ← grep exit=1
$ grep -n "CREATE TABLE" packages/core/src/schema.ts
37 memory_items / 64 production_rules / 77 goals / 89 user_model / 98 mana_trace / 109 jev_log / 127 inject_log
$ grep -c "user_model_history" tools/a0-check.mjs
0                      ← grep exit=1（不用管道）
```
逐表核对 A0 覆盖：`memory_items→1 mana_trace→1 jev_log→1 inject_log→4` / `production_rules→0 goals→0 user_model→0 user_model_history→0`。
`docs/mana-rollout-plan.md:561`：「`user_model_history` 属表结构 ⇒ **阶段 0 冻结表结构时必须预留**，否则阶段 4 要改契约」。探针 `tools/probes/a08-schema.mjs:11` 硬编码只查 4 张表。**归属 S0 写面，本会议不动手**（主持人已裁：回落用户）。

### [baseline-shoucang] S1 判据基础：三投影齐且与注册表一致（**"过期"是假问题**）
```
$ cd /mnt/d/FF/shoucang && node scripts/gen-criteria.mjs --check
PASS：五处投影与注册表一致（A TS / B 判据表 / C 脚本参数）        exit=0
$ /tmp 隔离重算 sha256（不写源仓）
9648342892ccc…0969  /tmp/sc-probe/src/criteria.generated.ts
9648342892ccc…0969  shoucang/src/criteria.generated.ts             ← 逐字相同（criteria.md / criteria-gate.json 同）
$ 用 HEAD 版注册表重算 → 同一 sha256 9648342892ccc…0969
```
机制：生成器第 285 行 `if (cur === t.text) { … continue }` —— 内容相同即跳过写入，mtime 停在「最后一次内容真变了」的时刻（实测同内容重跑 mtime `1790249498`→`1790249498` 不变）。
**真风险（成立）**：`lib/criteria.generated.js` 带 `AUTO-GENERATED` 横幅却**不在生成器 `targets`（3 个）内**，而脚本打印「五处投影」⇒ 声明的投影面 > 生成器真覆盖的面；若被当判据源会读到无 `--check` 守卫的影子。

---

## 一、r3（S3 调度席）—— 全部判完

**快照**：`packages/scheduler/src/index.ts` md5 `678c2c6a8cd805653ae57de081f176aa`、`src/goal-stack.ts` md5 `a37a51e54b7e569ef34dde524aac1b55`（复核前后一致）。

### [r3-A] 「`reached=2` 是断言口径写错，不是重复放行」⇒ **判真**
自建哨兵（不用其 fixtures）：真实装载 `core`+`scheduler`，连调 3 次 `ctx.waterfall('agent/pre-step', …)`：
```
装载: core= true  scheduler= true
第1次: inner=1 sentinel=1 比值=1:1 返回={"messages":[]}
第2次: inner=2 sentinel=2 比值=2:2 返回={"messages":[]}
第3次: inner=3 sentinel=3 比值=3:3 返回={"messages":[]}
```
**对照实验**（哨兵「不调 next」）证明该计数确实有牙：
```
组1（哨兵调 next）  第1..3次: 哨兵=1/2/3  内层=1/2/3  返回={"messages":[]}
组2（哨兵不调 next）第1..3次: 哨兵=1/2/3  内层=0/0/0  返回="VETO"
```
⇒ **`sentinel === innerRuns`（1:1）是正确的不变量**；不存在重复放行。
**额外发现（假旋钮）**：`ctx.waterfall` 未调 `next()` 时**静默 veto 且计数不动**——既无异常也无日志（`node_modules/@deepseek-ai/cordis/lib/index.js:317-324`，`next = () => (cbs.shift() ?? inner)(...args)`）。这正是 G9 要防的形态：漏调 `next()` 只能靠**下游哨兵**发现，任何「看返回值像成功」的判据都测不到。

### [r3-B] `unhandledRejection` 探针是否真能测到东西 ⇒ **能，但覆盖面窄于用例标题**
自建五场景探针（子进程外独立跑，`/tmp/r3b.mjs`）：
```
V1 async 调 next（方案§9.4 原样）: 计数增量=1 syncError=无 末条=next is not a function
V2 async 调 next 但抛错         : 计数增量=1 syncError=无 末条=next is not a function
V3 async 不调 next（静默 veto） : 计数增量=0 syncError=无
V4 同步 不调 next              : 计数增量=0 syncError=无
V5 同步 调 next 但抛错         : 计数增量=0 syncError=有
```
⇒ 探针**有牙**：`emit` 分发下 async 监听器抛错确实变成 `unhandledRejection`（增量 1），同步则同步可见（V5 syncError=有）。**降级说明**：所有场景增量都是 1，即探针量的是「`emit` 误用 waterfall 事件」这一个通道；**它对 V3/V4（async 漏调 `next()` 静默 veto）零响应**——那一类漏调不产生 rejection，只能用 r3-A 的下游哨兵抓。

### [r3-C] 「4 个骨架」的结构义务与行为 ⇒ **G9 义务判真；行为与机检判假**
```
$ for p in long-term consolidation forgetting; do … grep -c writeTrace/ctx.on/ctx.emit …
long-term      writeTrace=0 ctx.on=0 ctx.emit=0
consolidation  writeTrace=0 ctx.on=0 ctx.emit=0
forgetting     writeTrace=0 ctx.on=0 ctx.emit=0
scheduler      writeTrace=1 ctx.on=1
$ grep -rn "skeleton" packages/scheduler/tests/       → 空（无人机检断言 behavior==='skeleton'）
```
四个包的 `apply` **都**调了 `registerPassThroughPreStep`（`long-term/src/index.ts:66`、`consolidation/src/index.ts:66`、`forgetting/src/index.ts:66`、`scheduler/src/index.ts:143`）⇒ **G9 结构义务每个骨架都履行，判真**。
**判假（新增）**：三个壳声明的 `Config.enabled`（`long-term/src/index.ts:36`、`consolidation:36`、`forgetting:36`）是**假旋钮**——实测：
```
long-term      enabled=true → inner=1 sentinel=1 | enabled=false → inner=1 sentinel=1
consolidation  enabled=true → inner=1 sentinel=1 | enabled=false → inner=1 sentinel=1
forgetting     enabled=true → inner=1 sentinel=1 | enabled=false → inner=1 sentinel=1
scheduler      enabled=true → inner=1 sentinel=1 | enabled=false → inner=1 sentinel=1
```
`apply` 里 `void config`（`long-term:67`、`consolidation:67`、`forgetting:67`）——文档说「false 时只装配、不接事件（用于灰度与回滚对照）」，实测 false 与 true **完全同形**：监听器照注册、事件照透传。
**判假（新增·可观测性）**：`behavior: 'skeleton'` 在 JSDoc 里声明「使"没有行为"成为**可机检的事实**」，但 `grep -rn "skeleton" packages/scheduler/tests/` **零命中** ⇒ 它是**注释承诺，不是机检事实**。三包任一被填成真实现（或反向），现有 12 条判据都不会变色。

### [r3-D] D2 的修复是否引入新回归 ⇒ **修复本身不堵死正常收敛；但 `runCycle` 的断链使「修好」是表层的**
先直读停止条件（`packages/scheduler/src/index.ts:96-104`）：`impasse` 停 + `factsAfter.join('\n') === factsBefore.join('\n')` 停。
反向用例（自建，复刻其 `run()` 语义）：
```
① 链式推进（a→m1, b:m1→m2, c:m2→m3）：事实集恒为 ['m1','s']，每轮都不变
   带不动点停（现状） : 1:act[a] 2:act[a] | 轮数= 2
   不带（修复前行为）  : 1:act[a] 2:act[a] … 8:act[a] | 轮数= 8
   两者是否都到不了 b : true
② 需要「先产 m2 再触发 d」：1:act[e] 2:act[d] 3:act[d]   ← 正常收敛不受阻
```
⇒ **结论（判真）**：「不动点即停」没有把「真的该继续循环」堵死——每轮事实真变化时照常迭代（用例②），只在事实集真的不动时收敛（用例①）。
⚠ **但暴露一条更值得报的事实（根因，非本次改动引入）**：`installed` 事实不动**不等于**无事可做——`runCycle`（`goal-stack.ts:213-233`）每轮**重算并只应用 1 个算子**，而 `act()` 是幂等并入（`goal-stack.ts:203-205`）⇒ 一旦所选算子的 effects 已全部在事实集里，后续轮次会**永远选同一个算子**（用例①里第 2..8 轮全是 `act[a]`，`operatorId` 恒为 `a`）。**「不收敛」与「收敛」在修复前后都到不了 `b`**（`两者是否都到不了 b = true`）。故这次修复是**对的**（消掉空转、轮数语义恢复），但它**没有**触碰「同轮只应用一个算子 / 重选规则不排除已用算子」这一条；`maxCycles` 仍是唯一兜底。**这不是「顺带修好了 X」的越界，是修复面与缺陷面不重合——需在后续批次挂号，不在本轮判红。**

---

## 二、r2（S2 JEV 席）—— 全部判完

**快照**：`src/ollama.ts` md5 `b934d86d631e10640bac350057a88c57`、`src/index.ts` md5 `13c5393a11416667a689389b1d787112`（复核前后一致）。

### [r2-A] 归一化是否覆盖全部变体、是否把 `Yes`/`yes` 当同一 token 相加 ⇒ **判真**
自建真调用（不走其测试）：
```
HTTP 200 4825ms
原始 pos0 top_logprobs = [{"token":"yes","logprob":-0.18241},{"token":"no","logprob":-2.04160},
                          {"token":"Yes","logprob":-3.98829},{"token":"No","logprob":-5.35938},{"token":"y","logprob":-5.81600}]
yesFamily= [{"token":"yes",-0.18241},{"token":"Yes",-3.98829}]
noFamily = [{"token":"no",-2.04160},{"token":"No",-5.35938}]
unmatched= [{"token":"y",-5.81600}]
pYes= 0.851789138254888   pNo= 0.134524385794659   pYes+pNo= 0.986313524049547
人工复算 myYes= 0.851789138254888  myNo= 0.134524385794659   |差值|=0 / 0
```
⇒ 大写两个 token **没被漏掉**（`yesFamily` 逐项保留原始词表项），**也不是「当成同一个 token」**：按 `token.trim().toLowerCase()` 归族后**对原始 logprob 逐项 `Math.exp` 求和**（`ollama.ts:197-213`），与我的手工复算**逐位相同**。`pYes+pNo=0.986<1` 未重归一 —— 与 `ollama.ts:51` 自述「不重归一，直接求和」一致。
**一处口径提醒**：`pYes+pNo<1` 时 `threshold=0.5` 的判定语义是「yes 族绝对概率过半」而非「yes 占 yes/no 之比」；本轮两项都远超/远低于 0.5，不影响结论，但换模型后该口径需重述（非缺陷，记备）。

### [r2-B] 降级是否真留痕（直查库，不看返回对象）⇒ **判真**
自建真故障（不可达端点 `http://127.0.0.1:1`，5 ms）+ 独立只读连接直查：
```
返回对象: value=unknown probability=null degraded=true reason="ollama-request-failed: http://127.0.0.1:1/api/chat → fetch failed" traceError=null
库里行数: before=0 after=1 新增=1
库里那一行(逐列)= {"id":"r2b-1","request_type":"jev","source":"mana-jev","state_hash":"e8bc163c82eee187",
                 "result_value":"unknown","probability":null,"cached":0,"degraded":1,"latency_ms":4,
                 "cost_usd":null,"session_id":"sess","turn_id":7,"created_at":"2026-09-24T12:00:11.809Z"}
```
⇒ 真故障**确实新增一行**（A1-14 的「沉默地不判，但必须留痕」成立）。结构保证来自 `ollama.ts:296-312` 的 `finish()` 作为**唯一出口**（正常与降级都经它），`degrade()`（`:314-322`）强制 `value:'unknown'` + `probability:null` + `degraded:true` + 非空 `reason`；`cost_usd` 显式 `null` 而非 0（`ollama.ts:240`）。落痕自身失败另有 `traceError` 字段（`:307-309`），「写不进」不与「写成功」同形。

### [r2-C] 正常反例：`probability` 不是 0 冒充、`degraded===false` 且 `reason===null` ⇒ **判真**
```
耗时 64 ms
value=yes probability=0.8509480826083217 (typeof=number) degraded=false reason=null
probability===0 ? false   |  ===null ? false
normalization.pYes= 0.8509480826083217  pNo= 0.1398095133097478
库里新增行数= 1
库行= {"id":"r2c-1","result_value":"yes","probability":0.8509480826083217,"degraded":0,"cached":0}
```
⇒ 概率是**真数值**（非 0 占位）、正常路径也落痕（`degraded=0`）、`reason` 为 `null`（不是空串冒充）。

### [r2-D] Ollama 停掉时这套测试会怎样 ⇒ **显式红（可接受），不会吞成绿**
```
端点 http://127.0.0.1:11434 → ollamaReachable=true  ⇒ 走真调用
端点 http://127.0.0.1:1     → ollamaReachable=false ⇒ assert.fail 显式红
   实际抛出: AssertionError | Ollama 不可达 —— 本判据要求真调用 | code= ERR_ASSERTION
不可达时 judgeWithOllama 是否抛错? 未抛（返回降级对象）: degraded=true reason=ollama-request-failed: …
```
⇒ 守卫（`tests/b12-jev.test.mjs:65-72, 77-79`）把「不可达」转成 `assert.fail` ⇒ `exit 1`。**注意这里有真风险面**：`judgeWithOllama` 自身**不抛**（降级返回对象），故**真调用类判据一旦省掉守卫，就会拿着降级对象继续断言 = 假绿**；现有 11 条里 3 条（B1.2-1/-2/-5）依赖在线并带守卫，其余 8 条不依赖。
**复跑**：`node --test packages/jev/tests/b12-jev.test.mjs` → `exit=0 / # tests 11 / # pass 11 / # fail 0`。

---

## 三、r1（S1 判据/向量席）—— 全部判完

**快照**：`packages/metacognition` 于 19:55 全树（`src/criteria.ts` 19:43:05、`src/criteria.generated.ts` 19:41:56）。

### [r1-A] 「`lib/criteria.generated.js` 是 tsc 产物，不是第二份真源」⇒ **判真**（主持人的「一半误报」结论**不成立**——它是**真**的，只是理由要补）
```
$ grep -oE "^export (const|interface|type|function|class) [A-Za-z0-9_]+" src/criteria.generated.ts | sort -u > a_src ; 同法取 lib/criteria.generated.js > a_lib
src 导出=23  lib 导出=18
仅 lib 有： (空 = 无额外定义)          ← 关键判据：lib 不含 src 没有的定义
仅 src 有： ContentType / ContentTypeConsumer / ContentTypeStructural / ContentTypeVocab / ThresholdEntry
$ grep -nE "^export (interface|type|const|function|class) (那 5 个)" src/criteria.generated.ts
359: export interface ThresholdEntry …  849: export interface ContentTypeConsumer …
850: export interface ContentType { … }  861: export interface ContentTypeStructural …  862: export interface ContentTypeVocab …
```
⇒ 5 个差额**全部是 `interface`（纯类型，编译期擦除）**，正是 `tsc` 的正常行为；`lib/` 那份**不含 `src/` 没有的定义** ⇒ **不是第二份真源**。
旁证：`.gitignore:6` `packages/*/lib/`（构建产物口径）；`package.json` `"build": "tsc -p tsconfig.json"`、`"./criteria" → lib/criteria.js`。
**我上轮「影子产物」一半的措辞需订正**：它不是「第二份真源」，但**「无 `--check` 守卫」这一点仍成立**（生成器 `targets` 只 3 个、脚本打印「五处」）——误报的是「第二份真源」，成立的仍是「影子」。

### [r1-B] 「转旋钮」负向判据是否真能转 ⇒ **判真**（已按授权临时改并**已恢复**）
```
改前： thresholdValue("mcl.familiarThreshold") = 0.58
改：   skill/engine/criteria.json 0.58 → 0.61（9 处）sha256 192f65c1… → ff45c466…
重跑： node scripts/gen-criteria.mjs → ✎ 生成 src/criteria.generated.ts（45120 字节）等 3 份   exit=0
投影： src/criteria.generated.ts:206 "familiarThreshold": 0.61,   sha256 9648342892cc… → 24c148fcd63c85…
读口： thresholdValue("mcl.familiarThreshold") = 0.61
恢复： cp /tmp/r1b.criteria.json.bak skill/engine/criteria.json → sha256 回到 192f65c103e1d44a…（逐字）
      重跑生成器 → 投影 sha256 回到 9648342892cccb85…；读口 = 0.58
      差分核对：registry 与源仓逐字一致 ✓   TS 投影与源仓逐字一致 ✓
```
⇒ 注册表 → 投影 → 读口**三段贯通**，「假旋钮」风险在本包排除。**我唯一动过的文件**是 `packages/metacognition/skill/engine/criteria.json`（临时改 + 重跑生成器改 3 份投影），**已逐字恢复并通过 sha256 与源仓对拍**。

### [r1-C] handoff 的源锚点是否仍等于源仓当前值 ⇒ **判真（未漂）**
```
$ cd /mnt/d/FF/shoucang && sha256sum skill/engine/criteria.json scripts/gen-criteria.mjs src/criteria.generated.ts
192f65c103e1d44a31ce66864c8329ecbe85aaca08290553a0142f007780df8e  skill/engine/criteria.json
2f1ae78e34875d6ed84d8b1d1d3379699e8963b8b9ff6be18109a7ea47951be7  scripts/gen-criteria.mjs
9648342892cccb8541d41e9d74601f92c782d5d792fc7197abfeded3046f0969  src/criteria.generated.ts
$ stat -c '%y %n' …
2026-09-23 19:37:04.878 +0800  criteria.json      ← 与 S1 记录逐字一致
2026-09-20 20:57:42.442 +0800  gen-criteria.mjs   ← 同上
2026-09-22 12:50:41.116 +0800  criteria.generated.ts ← 同上
```
三处 sha256 + 三处 mtime **与 `docs/handoff/S1.md:12-13` 记录逐字相同**；本包 `scripts/gen-criteria.mjs` 与源仓 `2f1ae78e…` 亦逐字相同。⇒ **移植源钉得住**，源仓在此期间未变。

### [r1-D] 「顺带修好了 X」：对 `src/criteria.ts` 的 2 处相对上游订正 ⇒ **判真（行为等价，非越界）**
```
$ diff -u /mnt/d/FF/shoucang/src/criteria.ts packages/metacognition/src/criteria.ts   → 24 行，恰好 2 处
① 第 13 行 import 说明符： './criteria.generated.js' → './criteria.generated.ts'
   ⚠ 该订正**未传播到编译产物**： lib/criteria.js:13 仍是 "./criteria.generated.js"，与上游 lib/criteria.js:13 同形
   ⇒ 语义上**无行为差**（TS 直载测试需要 .ts 说明符；编译后 Node ESM 需要 .js），属**通道适配**，不是行为变更
② 第 274-280 行 importanceOf： (TAG_IMP[m[1]] ?? 0.6) → (TAG_IMP[m[1] ?? ''] ?? 0.6)
   自述理由：本仓 tsconfig.base 开了 noUncheckedIndexedAccess，m[1] 为 string|undefined ⇒ TS2538
```
**等价性独立对拍**（上游编译产物 `lib/criteria.js` 的 `importanceOf` vs 本包 `src/criteria.ts`，10 组含边界）：
```
"[原则] x" 0.5357142857142857 / 0.5357142857142857 EQ      "no tag"  0.2857142857142857 / … EQ
"[路径] y" 0.4857142857142857 / … EQ                      "[abc] z" 0.34285714285714286 / … EQ
"[教训]"   0.4785714285714286 / … EQ                      ""        0.25 / 0.25 EQ
"[tag"     0.2785714285714286 / … EQ                      "]["      0.2642857142857143 / … EQ
"[原则]+80a" 1 / 1 EQ                                     "[env] e" 0.39285714285714285 / … EQ
差异条数 = 0
```
⇒ **零差异**，包括未命中标签、空串、畸形标签三类边界。**未发现「拆东墙补西墙」**：两处都不改变既有行为（① 通道适配、② 类型层加不变式），且有对拍为证。
（我未逐条验证其 `tests/criteria.test.mjs` 15 条断言内容——派单说明该条由主持人复验 `tests=15 pass=15 fail=0`，本席不重复。**未验证：断言内容是否真覆盖等价性**，只验了行为等价本身。）

---

## 四、未验证 / 挂账

| # | 事项 | 状态 |
|---|---|---|
| U1 | r3 的 B1/D1/D2 三条「原判红」的成因定级（是判据写错还是实现缺陷） | **未验证：尚未判到**（D2 已判：修复正确且未堵死正常收敛；B1 已判 1:1；D1「确定性序」未单独深查） |
| U2 | 三个壳 `behavior:'skeleton'` 的机检落点归属（该加在哪一席的测试面） | **未验证：属建议，非判据** |
| U3 | S1 `tests/criteria.test.mjs` 15 条断言的**内容**是否真覆盖 `importanceOf` 等价性 | **未验证：尚未判到**（只验了行为等价本身，零差异） |
| U4 | `pYes+pNo<1` 时 `threshold=0.5` 的判定语义（绝对 vs 相对） | **未验证：口径提醒**，本轮数值不影响结论 |
| U5 | r4（S4 UI 席） | **未验证：尚未派到本席** |
| U6 | `S-verify.md` 之外的任何文件 | 本席**未写**（`git status` 核对：无 handoff 之外命中） |

## 五、契约版本

**已核 `_freeze` 三元组 @ `53c92707954562b1`（哈希腿）**：
`sha256sum -c` 对 `packages/core/src/event-types.ts`、`packages/core/src/domain.ts` 均 `OK`（exit 0，复核期间三度复验）。
⚠ **清单腿已漂**（`_freeze.files.txt` 少 12 行、`_freeze.head`=0083341 ≠ HEAD=ee9e22e）—— 见 [baseline-F4]。
本席**复核期间未改动任何被测文件**；唯一例外是 [r1-B] 的注册表临时改动，**已逐字恢复并 sha256 对拍通过**。
