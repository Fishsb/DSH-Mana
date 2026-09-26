# 独立审查 c3 · accept 席 · A1-5 转真判据

开工 HEAD `4de9b87`（实测未移动）· 时刻 2026-09-25T18:2x Z · 本席**未跑门**（遵守硬约束 1）· 未改任何被判面文件
本文件 = 本席读数载体（`docs/handoff/` 下新文件，不碰 `packages/**` 与 `tools/**`）

## 一、主断言（data 席自报）：证实 / 推翻？

断言原文：「A1-5 在 `tools/a1-check.mjs` 里仍是 HANG，且结构上不可能变 PASS：该块从不 import `long-term`，只判自己内联的闭式；三条分支里没有能把『真实现算对了』判成 PASS 的那条。」

**裁定 = 证实（成立）。三条独立证据：**

| # | 证据 | 命令 / 位置 | 读数 |
|---|---|---|---|
| 1 | 块内**零 import** | `tools/a1-check.mjs:829-884` 逐行读；全脚本 import 只有 fs/os/path/url/child_process/crypto（:48-53）+ 动态 import net（:371）/embed.ts（:414）/rrf.ts（:795）/recall.ts（:892）/vec-blob.ts（:893）/cosine.ts（:949）/checker-lock（:501） | A1-5 块**只读文件文本**（:859-867 `readFileSync` 扫 `packages/*/src/*.ts` 的正则），**从不加载 long-term 模块** ⇒ 判的是内联闭式 `const decay = (t,h) => Math.exp((-t*Math.LN2)/h)`（:841） |
| 2 | 块内**无 PASS 分支** | `sed -n '829,884p' tools/a1-check.mjs \| grep -o 'fail(\|hang(\|none(\|pass(' \| sort \| uniq -c` | `fail`×1（:869）/ `hang`×1（:871）/ `none`×1（:878）/ **`pass`×0** |
| 3 | 实际落到哪条分支 | 本席在临时进程里逐字复现 :859-867 的正则：扫 **73** 个 .ts，命中 `["packages/long-term/src/decay.ts"]` | `impls.length` 非空 ⇒ `:870 else if` 成立 ⇒ `hang()` ⇒ **A1-5 = HANG（不是 PASS）** |

`tools/a1-check.mjs` 本席实测 `git status --porcelain` 为空（**未被任何人改动**，可单独接线）。

## 二、三条核验

### ① 三锚点逐字复现 —— 证实
真源 sha256 `packages/long-term/src/decay.ts = 9604da6aeda02e0cd03ed943c41d1c6631acf6dec43cae38aa5731f378b22ece`（与 data 席记录**逐字节相同**）。

| 路径 | decay(0) | decay(14) | decay(90) | Δ |
|---|---|---|---|---|
| 独立闭式 `Math.exp(-t*Math.LN2/14)` | 1.000000 | 0.500000 | 0.01160933038388241 | 0 / 0 / **3.304e-7** |
| 走真核 `decayAnchorReadings({decay})` | 1.000000 | 0.500000 | 0.01160933038388241 | 0 / 0 / **3.304e-7** |

⇒ 三点 `ok=true`，孔径 1e-6 内。**逐字复现成立。**

### ② 负向对拍 —— 证实（本席**独立重建**，未采信其读数文件）
在 `/tmp/accept-mut-*/decay.mut.ts` 上把 `halfLifeDays: number = HALF_LIFE_DAYS` 改为 `= 7`（仓内真源**零写入**）：
- 扰动核 ⇒ `decay(0)=1|ok=true` · **`decay(14)=0.25|ok=false`** · **`decay(90)=0.0001347765519621353|ok=false`** ⇒ `any(ok=false) = true`（**必红**）
- 真源 sha256 before `9604da6a…` == after `9604da6a…` ⇒ **逐字节恢复**（现场痕迹成立）

### ③ `decayAnchors()` 未接核必抛 —— 证实（不回退闭式）
`packages/forgetting/src/index.ts:303-311`：`if (!kernel) throw new Error('…未装配 mana-long-term ⇒ **无真核可判**（不得回退本包闭式自证）…')`；
`packages/forgetting/src/retention.ts:142-147`：第二道独立 guard。
本席实测：`decayAnchorReadings(null)` ⇒ 抛「kernel 必须提供 decay」；`({})` ⇒ 抛；`eps=NaN` ⇒ 抛。
`resolveKernel()`（:249-268）取不到就 `kernel=null` 且 `readings().kernelSource='fallback'`（**如实回报**，不静默）⇒ 服务面 `decayAnchors()` 因此抛。**无闭式回退路径。**

## 三、本席新发现（data 席未覆盖）

### D-A（重要）三锚点腿对「死半衰期参数」的核**无牙**
本席实测反例：注入一个**把 `halfLifeDays` 参数整个忽略**的核
`decay:(t,_h)=>Math.exp(-t*Math.LN2/14)` ⇒ **三点全 `ok=true`，全过**。
这正是本仓明令追杀的 `budgetChars`「死开关」形态在 A1-5 里的镜像。
「参数真被消费」只由 `packages/long-term/tests/activation.test.mjs:64-65`（`assert.equal(decay(14), decay(14, HALF_LIFE_DAYS))` + h=7 负向对拍）钉住 —— **在包内测试里，不在 A1-5 判据腿里**。
⇒ 接线时须连这条一起搬，否则「真核可判」是个**更弱**的判据。

### D-B t<0 guard 不在锚点覆盖内
无负值 guard 的核同样**三点全过**（本席实测）。真核 `decay(-7)` ⇒ 抛（实测）。该 guard 亦只由包内测试兜。data 席已在读数文件 ③ 自陈，**属实**。

### D-C（重要）`IMPLEMENTED_A15_EXPORTS` 是**自指清单**
`packages/forgetting/src/index.ts:369`；唯一消费者 `packages/forgetting/tests/a15-anchor.test.mjs:220-222`，断言仅 `Array.isArray && length===2` + `n in mod`。
`length===2` 是**写死常数**，名单与任何其它真源**不互覆盖** ⇒ **删掉 `'decayAnchorReadings'` 并把 length 改成 1 ⇒ 全绿**（本席按断言逐字推演，未改任何文件）。
对照：`long-term` 的两条清单另有 `skeleton.test.mjs` 的**逐名 `deepEqual` 集合相等**腿钉着（互覆盖）；`IMPLEMENTED_A15_EXPORTS` **没有对应腿**。其自身注释（index.ts:365-368）自称"与 `IMPLEMENTED_RETIREMENT_EXPORTS` 同一处置"，但**少了那道集合相等腿** ⇒ 少了一环。
形态与 `tools/r0-assembly-check.mjs` 文件头点名的自指等式（`N !== PKGS.length` 被 `sed` 删行后仍打印 `⇒ R0 通过` exit 0）**同源**。

### D-D（次要）`packages/forgetting/src/params.ts:21` 的 `S = h/ln2 = 20.2027…` 是错值
本席复算 `14/Math.LN2 = 20.19773057244549`，误差 4.969e-3。data 席已自报（读数 ⑨），**属实**。
（该注释只在 `S = h/ln2` 的**重合点**论述段，不进任何判据寄存器；但它是"下限值当结论"的形态。）

## 四、裁定

**主断言：证实。三条核验：全部证实。data 席交付的整体裁定 = 部分成立。**

必须把两件事分开，否则会得到相反的错误结论：
- ✅ **「A1-5 的读数面已就绪」= 真**：`decayAnchors()` 走装配期真核、fail-closed、装配面读数与直连真核逐位一致、不回落闭式 —— 本席**独立复验通过**。这是真工作，不是包装。
- ❌ **「A1-5 已解决」= 假**：门（`tools/a1-check.mjs`）**本席实测 `git status` 为空、A1-5 块零 import、块内零 `pass()` 分支** ⇒ 门仍记 **HANG**。

⇒ 按四态语义（**HANG 与 NONE 都不是 PASS**）：**A1-5 仍是 HANG，本批不得记作「A1-5 已解决」。**
⇒ 且这是本仓最忌形态之一：**读数面建好、判据门未接线** —— 只看门的人以为没进展，只看交付说明的人以为已解决。两侧读数不可互相校准。

机制本身**有牙**（本席实测）：若 `decay.ts` 消失/改名 ⇒ `impls` 空 ⇒ 转 NONE。故这不是"假机制"，是"**机制正确但等级停在 HANG，且无人接线**"。

## 五、未验证项（本席未做，如实标注）
1. **未跑任何门**（a0 / a1 / r0）—— 硬约束 1，收口窗口单席统一做。故「A1-5 = HANG」的结论来自**源码逐字复现 + 正则复跑**，非跑门读数。
2. **未跑 `npm test`**（禁跑门；data 席报 512/512，本席**未独立复核**该数字）。
3. **本席的 D-C 反例是推演，未真删**（审查席不得改文件）⇒ 该条应视为"高置信推演，待判据登记席实删验证"。
4. `packages/forgetting/lib/**` 的重建产物与 `src` 是否逐字节一致：**未验证**（须收口窗口的 ARTIFACTS 腿判）。
5. `git diff --stat` 显示 13 文件 +700/-65 **仍在未提交态**（含 `packages/forgetting/src/index.ts`、`retention.ts`、`packages/long-term/src/index.ts`、`tools/a0-check.mjs`）⇒ data 席的"逐字节恢复"证据钉在**脏树**上，收口时须重新对齐。
