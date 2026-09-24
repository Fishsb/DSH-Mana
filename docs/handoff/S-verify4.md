# S-verify4 —— 独立复核席 4（Mana【独立复核席 4】）

写面：本文件。其余只读。本席**不产出任何改动**。

## 快照

| 项 | 值 |
|---|---|
| 快照时刻 | `2026-09-24T21:50+08:00`（首次测量） |
| 结论适用性 | 施工席**正在改** `packages/jev` ⇒ 每条结论都绑此快照；改动后须重测 |
| src md5 | framework.ts `c53ba8f922fb501c08db6bfc86a3ac50` · index.ts `d2a6c283462253e7c049f2bfec980486` · ollama.ts `3f62173f01fc7393e83b58d0f64333d2` |
| tests md5 | framework.test.mjs `7c34cee310bfaaa41c0dc1f8b382f723` · b12-jev.test.mjs `e548019ae8a5422c7d05c4df935e03e3` · gate.mjs `0e6d5b9b35de10580f730ecd00a02195` · gate-checks.mjs `3c00b1322a1f6d8aa38e8f62000e8794` |

工作项：**vf2**（kind=survey，只读基线）。未做 vf3。

---

## 判 1 · 基线数字独立复跑（不受空集欺骗）

**判据先证「有东西被测」**（命令直取，退出码不经管道）：

```
wc -c  packages/jev/tests/framework.test.mjs → 41341 字节（非零）
wc -c  packages/jev/tests/b12-jev.test.mjs   → 20460 字节（非零）
grep -c "^test(" framework.test.mjs          → 23
grep -c "^test(" b12-jev.test.mjs            → 11
```

**复跑读数**（cwd=`packages/jev`）：

| 命令 | exit | TAP |
|---|---|---|
| `node --test tests/framework.test.mjs` | 0 | `# tests 23 / pass 23 / fail 0 / skipped 0` |
| `node --test tests/b12-jev.test.mjs` | 0 | `# tests 11 / pass 11 / fail 0 / skipped 0` |
| `node --test "tests/*.test.mjs"` | 0 | `# tests 34 / pass 34 / fail 0 / skipped 0` |
| `npm test` | 0 | `# tests 34 / pass 34 / fail 0 / skipped 0` |
| `node tests/gate.mjs` | 0 | 三腿通过（自检/静态/动态离线 23/23） |

⇒ **与主持人自述 23/23、11/11、34/34 逐字一致**。TAP `# tests` 均 > 0，非零字节已先证 ⇒ 不是空集假绿。

---

## 判 2 · 本地通道默认端点/模型（给行号）

| 项 | 值 | 位置 |
|---|---|---|
| 默认端点 | `http://127.0.0.1:11434` | `packages/jev/src/ollama.ts:30`（`OLLAMA_DEFAULT_ENDPOINT`） |
| 默认模型 | `qwen3.5:0.8b` | `packages/jev/src/ollama.ts:33`（`JEV_DEFAULT_MODEL`） |
| Config 绑定 | `endpoint` / `model` 缺省取上述常量 | `packages/jev/src/index.ts:78-79` |
| 护栏拒绝路径回填同默认 | — | `packages/jev/src/framework.ts:427-428` |
| URL 拼装 | `chatUrl()` 补 `/api/chat` | `packages/jev/src/ollama.ts`；判据 `b12-jev.test.mjs:282-284` |

**本地通道当前真可达（非自述）**：
`curl -s -o /dev/null -w %{http_code} --max-time 5 http://127.0.0.1:11434/api/tags` → `200`，curl exit 0。
`/api/tags` 实测含 `qwen3.5:0.8b`（默认模型在位）。

⇒ 本地通道**现在能真跑**（b12 的 4 条真调用用例全绿即端到端证据）。这与"离线时应红"不矛盾，见判 3。

---

## 判 3 · 离线时旧通道判据是**显式红**，不是 skip（D 口径的实证）

```
timeout 120 unshare -rn node --test tests/b12-jev.test.mjs
```

| 读数 | 值 |
|---|---|
| exit | **1** |
| TAP | `# tests 11 / pass 7 / fail 4 / skipped 0 / todo 0` |
| `not ok` 条数 | 4 |

失败的 4 条（逐字）：
```
not ok 1  - B1.2-1 真调 Ollama：pos0 取到候选，且 yes/no 归一对得上原始 top_logprobs
not ok 2  - B1.2-2 大小写变体不得被静默漏掉（真返回上的直接断言）
not ok 5  - B1.2-5 正常反例：degraded=false 且 reason===null，并落一行 degraded=0 的痕
not ok 10 - B1.2-10 服务面 judge 真写进 core 的库（装配态证据，非机制自证）
```

**机制**（不是巧合）：这 4 条各有一句前置守卫，不可达即 `assert.fail` 而非 `t.skip()` ——
`tests/b12-jev.test.mjs:65-72`（`ollamaReachable()`）+ `:77-79` + `:131`（`assert.fail('… 不静默跳过（否则是假绿）')`）。

⇒ **离线时旧通道判据显式红，`skipped 0`** ⇒ 该判据**不会静默变绿**。判据有负荷。

**离线对照组**：`unshare -rn node --test tests/framework.test.mjs` → exit **0**，23/23/`skipped 0`。
⇒ 框架层确实零网络（与通道解耦）。

---

## 判 4 · 双通道现状：**真 JEV 通道在快照里根本不存在**（关键缺口）

直取退出码：
```bash
grep -rn "systemone"   packages/jev/src/ packages/jev/tests/   → exit 1（零命中）
grep -rn "nano-gpt\|jev-1.13\|NANOGPT" packages/jev/src/ packages/jev/tests/ → exit 1（零命中）
```

`packages/jev/src/` 目录仅三件：`framework.ts` · `index.ts` · `ollama.ts`（无 jEV/cloud 适配件）。

⇒ 快照下：**B（真通道）与 C（映射保真）两类目前"无物可测"**。
按本席纪律「判不出写未验证，不许凑数」：
- **B 项当前状态 = 未落地**（不是"红"，也不是"绿"，是**没有判据**）；
- **C 项当前状态 = 未落地**（无映射层 ⇒ 无信息丢失面可验）。

⚠ 对本轮 done 标准的直接影响：标准③要求「真通道判据在无凭据时**显式红**」。
**该判据现在不存在** ⇒ 施工席落地后，此项才可判；落地前凡称"已满足③"皆无证据。

（口径写法见下节，供施工席落地后直接套用；本席不代改。）

---

## 判 5 · 凭据面（**不回显 key**）

| 项 | 观测 |
|---|---|
| `~/jev/.env` | 存在，权限 `-rw-------`（600），未进 git（`git status` 无该路径） |
| 键名（仅名字与长度） | `NANOGPT_API_KEY`（值长 44）· `JEV_CHANNEL`（值长 7） |
| 值 | **本席未读、未回显、未写入任何文件** |
| `~/jev/jev_client.py` | 存在 7362 字节，只读参考，未改 |

⇒ 口径 B 的取凭据方式：从 `~/jev/.env` 读 `NANOGPT_API_KEY` 注入进程环境，端点 `https://nano-gpt.com/api/v1/systemone`、模型 `jev-1.13`。

---

## 四类判据口径（vf2 交付物 ①）

> 通则：**任何一类都不得以 skip 表态**。不可达/无凭据 ⇒ `assert.fail`（显式红），并在 TAP `# skipped 0` 上可核。

### A 离线桩
- 命令：`unshare -rn node --test packages/jev/tests/framework.test.mjs`（或 `node tests/gate.mjs` 的动态腿）。
- 算绿：exit 0 **且** `# tests > 0` **且** `# fail 0` **且** `# skipped 0`。
- 算红：exit ≠ 0；或 `# tests 0`（空集）；或 `# skipped > 0`（有人把真判据降级成 skip）。
- 反假绿前置：先 `wc -c` 证非零 + `grep -c "^test("` 计数 + TAP `# tests N > 0`。

### B 真通道（落地后适用）
- 取凭据：`~/jev/.env` 的 `NANOGPT_API_KEY` ⇒ 进程环境；**不得回显、不得写仓库、不得写进 handoff**。
- 端点 `https://nano-gpt.com/api/v1/systemone`、模型 `jev-1.13`。
- A 档锚点（逐字、与官方自测同口径）：noul 正向 `> 0.5`、反向 `< 0.5`、choice 三例取值正确。
- **无凭据 ⇒ 显式红**（`assert.fail`），不是 skip。判据：无凭据运行时 `not ok` 计数 ≥1 且 `# skipped 0`。
- B 档浮动量（单次 ~$1.2e-5、p50 1.1–3.9s）**不得进阈值列**（不得断言成本/延迟范围）。

### C 映射保真（落地后适用；本席 competence 对齐点）
真 JEV 一次调用可带**多问**（`questions{type,instructions,criteria}`），契约 `JevJudgeRequest` 只有**单个** `state`+`question`（`packages/core/src/domain.ts:138`）。
⇒ 判「没丢信息」必须**可观测**，三条至少取其一，否则不算判过：
1. **计数钉**：映射层断言 `questions.length === 1`；长度 >1 时**显式红**（禁止"只取第一个、其余静默丢")。
2. **带出数**：若允许聚合，则落痕里必须带出「输入 n 问 / 消费 m 问」两个数（`n > m` 必须可见），且 n≠m 时 `degraded=true` 或 `reason` 非空（对齐标准⑤）。
3. **逐问对账**：n 问返回 n 条答案时，映射对第 k 问的取值必须能反查到真返回 `answers` 里对应项（不得张冠李戴）。
- **反例（必须显式红）**：给 3 问、只处理第 1 问、返回 `degraded=false / reason=null` ⇒ 红。
- 另须钉：`probability ∈ [0,1]` 或 `null`；`value` 只允许 `'yes'|'no'|'unknown'`；失败**不得默认成 `'no'`**（`src/ollama.ts:68-71` 的既有口径，映射层不得放宽）。

### D 旧通道回归（"不得静默变成只有云端"）
- **保活证据**：真跑一次本地判定成功（b12 真调用用例绿，且 `/api/tags` 200 且含 `qwen3.5:0.8b`）。
- **默认不被换掉**：缺省配置解析后 `endpoint === 'http://127.0.0.1:11434'` 且 `model === 'qwen3.5:0.8b'`（绑 `src/index.ts:78-79`）。若施工把云端设成缺省 ⇒ **红**。
- **离线仍显式红**：`unshare -rn` 下 b12 必须 `fail > 0` 且 `skipped === 0`（实测见判 3）。若变成 `skipped > 0` 或 exit 0 ⇒ **红**（这才是"被静默破坏"）。
- **可切换**：两通道并存时，选择开关必须是**显式配置项**，且两个方向各有一条判据（切到本地 → 不发云端请求；切到云端 → 不发本地请求），用 fetch 计数证明，不得只断言配置值。

---

## 判 6 · 变异实验（**全在 `/tmp` 副本内**）

**沙箱基线先证绿**（防上一席踩的环境伪影假红）：

```
/tmp/vf2_sandbox/{jev,core} ← cp -a 自仓库；/tmp/vf2_sandbox/node_modules → symlink 到 /home/lk/Mana/node_modules
```

| 基线 | exit | TAP |
|---|---|---|
| `node --test tests/framework.test.mjs` | 0 | 23/23, fail 0, skipped 0 |
| `node --test tests/b12-jev.test.mjs` | 0 | 11/11, fail 0, skipped 0 |
| `node tests/gate.mjs` | 0 | 三腿通过 |

⇒ 沙箱副本与仓库同绿 ⇒ 后续变异结果**不是**环境伪影。

### 假绿形态复现（D 档判据的负荷证据）

| # | 变异 | `node --test` | `gate.mjs` |
|---|---|---|---|
| **M1** | 把 `framework.test.mjs` 截成 **0 字节** | **exit 0，`# tests 1 / pass 1 / fail 0`** ←主持人所述假绿形态**逐字复现** | exit 1 —— **抓到了**（`文件为空（0 字节）—— 空文件会让 node --test 报 tests 1/pass 1/exit 0`） |
| **M1b** | 空目录跑通配 `node --test "tests/*.test.mjs"` | **exit 0，`# tests 0`** | —（闸用逐个列名，不用通配） |

⇒ 结论：**主机自述的两个假绿形态属实**；且 `gate.mjs` 对形态①**真有负荷**（M1 红）。
**但这不代表 `npm test` 安全** —— `npm test` 用的正是通配式，见 M4。

### 判据强度（会掩盖其他问题的优先级最高）

| # | 变异（模拟"看起来正常"的坏改动） | 结果 | 判定 |
|---|---|---|---|
| **M2** | 删掉 1 条用例（23→22） | `node --test` **exit 0**（无感）；`gate.mjs` **exit 1**（`用例条数 22 ≠ 期望 23`） | 内部判据**无感**，闸**抓住了** |
| **M3** | **把默认端点 `OLLAMA_DEFAULT_ENDPOINT` 从 `http://127.0.0.1:11434` 悄悄改成云端 `https://nano-gpt.com/api/v1/systemone`** | `framework` **23/23 绿**；`b12` exit 1（3 fail，靠真调用暴露）；**`gate.mjs` exit 0 —— 全绿** | ⚠ **最易被"看起来正常"掩盖的缺陷：旧通道被判据静默丢掉的形态，当前**无任何闸能抓**（详见下节高优先级发现） |
| **M4** | **整份删掉 `tests/b12-jev.test.mjs`（旧通道全部判据）** | `node --test "tests/*.test.mjs"` → **exit 0**，`# tests 23 / pass 23 / fail 0 / skipped 0`；**`gate.mjs` exit 0，绿** | ⚠ **旧通道判据可被整份删除而全链路仍绿** ⇒ 回归面**没有闸** |
| **M5** | 把 b12 里 4 处**显式红**守卫（`assert.fail`）全改成**静默 `return`** | 离线 `unshare -rn node --test b12` → **exit 0，11/11 绿，`# skipped 0`**；`gate.mjs` **exit 0**，且仍打印"4 条以真模型可达为前置（不可达即 assert.fail，非 skip）" | ⚠⚠ **本轮 D 项最致命的形态**：诚实红一旦被改成静默通过，**连闸的"如实报数"都照抄了旧文案**，全绿 ⇒ **当前无闸能抓** |
| **M6** | **悄悄丢掉请求体里的 `question`**（`ollama.ts:160` 的 `` `${question}\n\nSTATE:…` `` → 只留 STATE） | `gate.mjs` **exit 0 绿**；`framework` 23/23；`b12` exit 1（真调用被抓） | 离线判据**结构性无感**（全部走注入桩）；只有真调用能碰 ⇒ 这是 **C 类口径必须补**的形态：桩判据不得只验"有请求"，须验**请求内容** |
| **M7** | 契约违例：失败路径 `value:'unknown'/probability:null` → 改成 `'no'/0` | `framework` **exit 1（19 pass / 4 fail）**；`gate.mjs` **exit 1** | ✅ **抓得住** —— 契约三态（不得默认 no / 不得用 0 冒充）有真负荷 |

### 判 6 小结

- **有负荷的**：契约三态（M7）· 用例数等式（M2）· 0 字节（M1）· 真调用面（M3/M6 的 b12 侧）—— 这些**不是**装饰。
- **无负荷的（本轮 competence 对齐点）**：M3/M4/M5 —— 全部指向**旧通道被打包换掉/整份删掉/静默降级成 skip，而闸全绿**。M5 尤其严重：闸打印的文案与实测相反（说"是 assert.fail"，实际已是静默 return）。

---

## 高优先级发现（优先级最高，因为它让失败不可观测）

### 发现 1 · M5：显式红守卫可被改成静默通过而不触发任何闸
- 位置：`packages/jev/tests/b12-jev.test.mjs:77-79` · `:131`（4 处 `assert.fail`）。
- 证据：变异后离线跑 `exit 0 / 11 pass / skipped 0`，`gate.mjs` 仍 exit 0 且**照抄**旧文案"不可达即 assert.fail，非 skip"。
- 为什么优先级最高：它使**本轮 done 标准③**（"真通道判据无凭据时显式红，不得静默 skip"）**无法自证** —— 因为判据自身声明与实际行为可以被解耦且不可观测。
- 口径修正建议（给施工席）：
  - 闸的"模型依赖面普查"不得**只报数**，须**真验**：离线跑一次被普查文件，断言 `fail > 0 && skipped === 0`；若 `fail === 0 && skipped === 0` 而文件声明含真调用 ⇒ **红**。
  - 真 JEV 判据落地时同口径：**无凭据 ⇒ 跑一次并断言 `fail ≥ 1`**，而不是检查"有没有写 assert.fail"。

### 发现 2 · M4：旧通道（D 项）的回归面没有闸
- `gate.mjs` 的 `FILES = ['framework.test.mjs']`（唯一进闸）+ `PREV_FILES = ['b12-jev.test.mjs']`（只普查）。
- 证据：整份删除 `b12-jev.test.mjs` ⇒ `gate.mjs` exit 0 绿（仅打印"文件不存在"），`npm test` 的 `# tests 23` 也绿。
- 风险正对 D 项："旧通道保留可切换"这条 done 标准，其判据可被**整体移除**而无人察觉。
- 口径修正建议：把"旧通道可切换"的判据**纳入闸的等式计数**（`EXPECTED_CASES` 覆盖两个文件），或至少对 `PREV_FILES` 的存在性/条数做等式。

### 发现 3 · M3：默认通道可被整包换成云端而闸全绿
- 位置：`src/ollama.ts:30`（`OLLAMA_DEFAULT_ENDPOINT`）。
- 证据：改成云端端点后 `framework` 23/23 绿、`gate.mjs` 绿；**当前没有任何断言钉住"缺省 = 本地"**（`grep OLLAMA_DEFAULT_ENDPOINT` 在 tests/ 下**零命中**，exit 1）。
- 风险：新一轮施工要加第二通道，最可能的实现动作就是动 `Config.endpoint` 缺省 —— 一旦把云端设成缺省，**判据侧无人发现**。
- 口径修正建议（D 类第 2 条）：加一条断言 —— 缺省配置解析后 `endpoint === 'http://127.0.0.1:11434'` 且 `model === 'qwen3.5:0.8b'`；两通道各自的"另一侧不发请求"用 fetch 计数钉住。

### 发现 4 · M6：桩判据不验请求内容 ⇒ C 类（映射保真）用桩测不出来
- 证据：丢掉 `question` 后，全部 23 条离线判据 + 闸仍绿（只有真调用炸）。
- 与 C 项的关系：映射层要判"多问未丢信息"，**若只写注入 `fetchImpl` 的桩**，那么"桩被喂了 3 问、实际只发出 1 问"这类丢失**恰好落在桩外面**。
- 口径修正建议：C 类判据必须**双向**——① 桩侧断言 **请求体**内容（发出的 `questions` 条数/内容与你给的输入对账）；② 真通道侧断言返回映射。只做②或只做①都不足以判"没丢"。

---

## 待办

- vf3（`rg` / `rb` 两项）未派，未做。
- 本席不对上述发现提出改动；修正口径已写成可套用的断言形式，交由主持人派单。

---

# 轮 2 · rg（kind=review）—— 复核施工席改动

## 快照 2

| 项 | 值 |
|---|---|
| 快照时刻 | `2026-09-24T22:15+08:00` |
| 顶层结论 | 施工席**确实动了**这个包；本席逐条独立复验 |
| src md5 | ollama.ts `49e43b97954ab11d05a1701bec1cbb42` · framework.ts `c6ef39ec8e069098af73f36b2a35fa98` · index.ts `b2c3e97548b1fac1405cb8c7058995ad` · systemone.ts `a129012f5439ddd9d558eab6180a565c` |
| tests md5 | gate.mjs `0f30842a484d536837da1c270e8db59c` · gate-checks.mjs `90f5c14eeddb6e4e209a52797436b4de` · systemone.test.mjs `95b944d8bc4aa76c1f65b7e856172953` · live/systemone-live.test.mjs `345825b57f5dd93e4d5a658d1ecf5646` · framework.test.mjs `7c34cee310bfaaa41c0dc1f8b382f723`（**未变**）· b12-jev.test.mjs `e548019ae8a5422c7d05c4df935e03e3`（**未变**） |

**沙箱基线先证绿（防环境伪影假红）**：`/tmp/rg_sb/{jev,core}` ← `cp -a`；`node_modules` → 软链到仓库。
`node tests/gate.mjs` → **exit 0**，`离线 46/46 · 合计 62`，四腿全过 ⇒ 后续变异结果非环境伪影。

## 判 7 · D 档基线复跑（先证"有东西被测"）

| 文件 | 字节 | `grep -c "^test("` |
|---|---|---|
| `tests/framework.test.mjs` | 41341 | 23 |
| `tests/systemone.test.mjs` | 38321 | 23 |
| `tests/b12-jev.test.mjs` | 20460 | 11 |
| `tests/live/systemone-live.test.mjs` | 10202 | 5 |

仓库内**闸自跑**：exit 0，逐字：
`[jev·gate] 绿：离线 46/46 · 合计 62 条判据全在等式内；自检腿 + 静态腿 + 动态腿（离线）+ 显式红腿 四通过`
`[jev·gate] 显式红腿通过：无凭据跑真通道判据 ⇒ exit=1 tests=5 fail=5 skipped=0`

⇒ 与施工席自述（46 离线 / 62 合计 / 显式红腿 exit1·tests=5·fail=5·skipped=0）**逐字一致**。

## A · M6 是否真被覆盖 —— **是，判据真红（本席已换三种形态验证）**

⚠ 先纠一处**上轮的错**：上轮 M6 我打的是 `ollama.ts:160` 的 `messages` 内容；本轮真 JEV 的请求体是 `questions`，
落点是 `src/systemone.ts:202`（`return { model, state, questions }`）与 `:400`（缺省合成）。
本轮的变异打在这两处。

全部在 `/tmp/rg_sb` 副本内：

| # | 变异（目标：让"多问压成单问/丢内容"而看起来正常） | 命中判据 | 结果 |
|---|---|---|---|
| **A1** | `:400` 后加一层 `Object.fromEntries(...slice(0,1))` ⇒ **3 问静默截成 1 问** | `systemone.test.mjs` **S1-3「多问不压扁」** | **exit 1，22 pass / 1 fail**；闸 exit 1 ⇒ **红** |
| **A2** | `:202` 改成 `return { model, state }` ⇒ **`questions` 字段整体消失** | S1-1 / S1-3 / S1-4 / **S1-17** | **exit 1，19 pass / 4 fail**；闸 exit 1 ⇒ **红** |
| **A3** | **读侧**变异：`:499` 后把 `raw.answers` 收成只剩 `primaryQuestion` ⇒ 返回的多问答案静默丢弃 | S1-3 + **S1-8**（次要答案形状认不出须进 `unusableAnswers`，不静默丢） | **exit 1，21 pass / 2 fail**；闸 exit 1 ⇒ **红** |

A1 逐字命中：`not ok 3 - S1-3 **多问不压扁**：桩收到的 body 恰有 3 题且逐题 type/instructions/criteria 对上；返回 answers 三键全在`

⇒ **判定：M6 真被覆盖，判红成立。** 桩**确实断言了请求体内容**（`tests/systemone.test.mjs:167-173`：`body` 恰为 `model/state/questions` 三件、
题数=1、`instructions` 逐字；`:218-226`：3 题逐题对账），不是"只验调用发生了"。
**A3 尤其关键**：读侧的静默塌缩（比写侧更隐蔽）也被抓住了 —— 这正好补上我上轮指出的"丢失落在桩外面"。

## B · M4 是否真被覆盖 —— **是，闸真红**

| # | 变异 | 结果 |
|---|---|---|
| **B1** | 删 `tests/live/systemone-live.test.mjs` | 闸 **exit 1**：`红：3 项（自检腿 / 静态腿 / 显式红腿·源码面）` |
| **B2** | 删 `tests/b12-jev.test.mjs` | 闸 **exit 1**：`缺判据文件：b12-jev.test.mjs（**整份文件消失必须红** —— 这正是 M4 抓到的假绿形态）` |

⇒ 与上轮 M4（删了照旧绿）相比**已闭环**：所有测试文件都进了等式（`gate.mjs:41-52`：`OFFLINE` 46 + `COUNTED_OTHER` 16 = **62**，逐文件 + 两级总和等式）。

## C · M3 是否真被覆盖 —— **是，判据真红**

变异：`src/ollama.ts:30` 默认端点改 `http://127.0.0.1:11434` → `https://nano-gpt.com/api/v1/systemone`。
结果：**exit 1，22 pass / 1 fail**，逐字命中：
`not ok 16 - S1-16 缺省值钉死：Config 缺省 = **ollama 通道 + 本地端点 + 本地模型**；systemone 常量独立且正确`
（`tests/systemone.test.mjs:426`）⇒ 上轮"缺省端无任何断言钉住"的缺口已补。

## D · M5 是否真被覆盖 —— **是，但需要"行为腿"而非源码扫描（本席踩到自己的坑，如实记录）**

本席做了**三次**尝试，前两次是**我自己的变异写错了**，必须记录以防误导：

| # | 变异 | 结果 | 说明 |
|---|---|---|---|
| D1 | 直接删掉 `requireCredential()` 里的 `assert.fail` 整块 | 闸 **exit 1** | 被**源码面**抓：`live/systemone-live.test.mjs 内没有 assert.fail(...) ⇒ 无凭据/不可达时会静默通过或跳过` |
| D2 | 把 `if ('missing' in cred)` 改 `if (false && …)`（**保留 assert.fail 文本**） | **闸 exit 0（绿）** | ⚠ **但这是我的变异写错了**：真实调用点是 `apiKey: requireCredential()`（非 `const key=`），我的第二处补丁没命中 ⇒ `requireCredential()` 真实路径**仍会 assert.fail**，`fail=5` 是真红而非假绿。**此条不构成缺陷证据，作废。** |
| **D2p** | 正确形态：`if (false && 'missing' in cred)`（文本保留）**＋** 在 5 个 test 体首插入 `if (mutSkipIfNoCredential()) return` | **闸 exit 1**：`红：**显式红腿** —— 无凭据时真通道判据却**通过了**（exit 0）⇒ 它静默跳过了。` | ✅ 真·M5 形态（`assert.fail` 文本在场、实测离线 **`exit 0 / 5 pass / skipped 0`**）**被抓** |

⇒ **判定：M5 真被覆盖。** 且证据强度比我上轮要求的更高：
- 我上轮建议"离线真跑一次并断言 `fail>0 ∧ skipped===0`" —— 闸的 ④b 腿**正是这么做的**（`gate.mjs:192-215`：`delete redEnv.NANOGPT_API_KEY` **并** `redEnv.JEV_ENV_FILE='/nonexistent/…'`）。
- ⚠ 且它避开了一个我没预见的陷阱：只删环境变量**不够** —— 判据会从 `~/jev/.env` 回退读到真 key，于是**在开发机上永远红不了**（假绿）。闸显式注释了这一条并同时断掉文件回退。
- `gate-checks.mjs` 的自检腿还把自己的盲区钉住了：`D腿·已知盲区已复现：assert.fail 在场但被条件包住时本检查器抓不到 ⇒ 兜住它的是闸的 ④b 行为腿`。

## E · 旧通道回归 —— **仍真可用，未静默变成只有云端**

| 检查 | 命令 | 输出 |
|---|---|---|
| 本地可达 | `curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:11434/api/tags` | **HTTP=200**，curl exit **0** |
| 旧通道真调用判据 | `node --test tests/b12-jev.test.mjs` | exit **0**，`# tests 11 / pass 11 / fail 0 / skipped 0` |
| 框架判据 | `node --test tests/framework.test.mjs` | exit **0**，`# tests 23 / pass 23 / fail 0` |
| 缺省钉住 | `grep -n "S1-16" tests/systemone.test.mjs` | `:426` 命中（见 C 段，该条被变异打红 = 有负荷） |

⇒ 本地通道**仍在且真能判定**（非仅"配置里还在"）。结合 C 段：破坏缺省会红 ⇒ **"不得静默变成只有云端"有闸**。

## F · key 未泄漏 —— **0 命中**

```
grep -rE 'sk-[A-Za-z0-9-]{20,}' packages/jev/ docs/handoff/S2.md   → 命中行数 0（只报数，未回显任何匹配串）
```

**扩大检查（本席额外做的，因为该正则挡不住"非 `sk-` 前缀"的 key）**：
- 真实 key 长度 44。用**前缀比对**（不回显）：`~/jev/.env` 中 key 的前 8 字符在 `packages/jev/**` 与 `docs/handoff/S2.md` 中命中 **0**；完整 key 命中 **0**。
- 另一次宽扫描 `[A-Za-z0-9_-]{40,}` 在 `docs/handoff/S2.md` 命中 2 处，逐一分型后**均为 64 字符纯十六进制（SHA-256 hash）**，非凭据。
⇒ **判定：key 未泄漏。** 本席全程未读 key 值、未回显、未写入任何文件。

## rg 小结（净结论）

- 施工席自报的 **5 项数字全部复现无误**，且**四条我上轮点名的盲区（M3/M4/M5/M6）经独立变异验证：全部真被覆盖**。
- 闸从四腿升为**五腿**（自检 / 静态 / 动态离线 46 / **显式红行为腿** / 用例等式 62），其中**显式红腿是行为面**（真跑 + 断言 exit≠0 且 skipped=0），
  不是源码扫描 —— 这一点比"源码里有 assert.fail"强得多，也正是抓 D2p 的那条腿。
- 本席**未发现**新增的"拆东墙补西墙"形态。**唯一需要记录的是我自己的 D2 变异写错**（已作废并在上表留痕），
  它一度显示"闸绿"，若不复验调用点就会被我误报成缺陷 —— 记录在此以防后续席位重蹈。
- 残余未验证：真通道**带凭据 5/5** 我**未独立复跑**（需真调 `jev-1.13`，见"未验证"节）。

## 未验证

1. **真通道带凭据 5/5**：本席未跑（未读 key 值）。施工席与主持人均称 5/5，**本席无独立证据** ⇒ 记未验证。
   复跑方式（主持人可就地执行，本席不代跑）：`set -a; . ~/jev/.env; set +a; node --test packages/jev/tests/live/systemone-live.test.mjs`
2. `scripts/probe-systemone.mjs` 的实测读数（noul 0.97/0.06、choice 三例）本席未复跑 ⇒ 未验证。
3. 本席**未审** `src/systemone.ts` 的语义正确性（映射是否在语义上恰当、阈值口径），只验了"变异能否被抓"。

---

# 轮 3 · rb（kind=review）—— 最后一击：复核修复

## 快照 3

| 项 | 值 |
|---|---|
| 快照时刻 | `2026-09-24T22:20+08:00` |
| **勘误（本席自查）** | 轮 2 我记的 `live/systemone-live.test.mjs` md5 `345825b5…` **是陈旧值**：该文件 mtime `22:15:19`，我的 md5 采集早于它 13 秒。**当前值 = `019f72cc49d5ba809c2aff0d23b720d2`**（`/tmp/rg_sb` 副本与之 `diff` 无差异 ⇒ 轮 2 的 A/B/C/D 变异**实际跑在现内容上**，结论不受影响）。轮 2 其余 md5 均未变。 |
| src md5 | ollama.ts `49e43b97…` · framework.ts `c6ef39ec…` · index.ts `b2c3e975…` · systemone.ts `a129012f…`（与轮 2 全同 ⇒ **src 未再改**） |
| tests md5 | framework `7c34cee3…`（未变）· b12 `e548019a…`（未变）· systemone.test `95b944d8…` · live `019f72cc…` · gate.mjs `0f30842a…` · gate-checks.mjs `90f5c14e…` |
| 沙箱 | `/tmp/rb_sb/{jev,core}` + node_modules 软链；基线 `gate.mjs` **exit 0**（`离线 46/46 · 合计 62`）⇒ 后续变异非环境伪影 |

**用例数（不受空集欺骗）**：framework 23 · b12 11 · systemone 23 · live 5 ⇒ **62**。

## A · 旧通道回归 —— **真可用，非被云端顶替、非静默跳过**

```bash
curl -s -o /dev/null -w "HTTP=%{http_code}" --max-time 5 http://127.0.0.1:11434/api/tags   # → HTTP=200, exit 0
node --test packages/jev/tests/b12-jev.test.mjs
```
输出：**exit 0**，`# tests 11 / pass 11 / fail 0 / skipped 0`。

四条独立证据表明它打的是**本地**而非云端：
1. `b12-jev.test.mjs` 内 `127.0.0.1:11434` 出现 **5** 处（`grep -c`）；
2. `/api/tags` 200 ⇒ 本机 Ollama 在跑；
3. `b12` 全程用 `judgeWithOllama`（走 `/api/chat` + `logprobs` 单 token），与真通道不同构；
4. 旧两文件 md5 与轮 1 **一字未改**（`7c34cee3…` / `e548019a…`）⇒ 施工席未动旧判据。

## B · 双通道是否真可切 —— **是，两个方向都真红**

| # | 变异（`/tmp/rb_sb/mB*/src/index.ts`，`:255-257` 的通道三元选择） | 结果 |
|---|---|---|
| **B1** | 选择器**失效并恒走 ollama**（"选云端实际打本地"） | **exit 1**，22 pass / 1 fail：`not ok 17 - S1-17 双通道**都能被选中**且各自端点/模型正确（经 apply 装配 + 桩；不静默只剩云端）` |
| **B2** | 选择器**失效并恒走 systemone**（"选本地实际打云端"） | **exit 1**，22 pass / 1 fail：同样 **S1-17** |

S1-17（`tests/systemone.test.mjs:470-518`）的强度够：两腿各自断言 **URL 后缀**（`/api/chat` vs `${SYSTEMONE_DEFAULT_ENDPOINT}${SYSTEMONE_DEFAULT_PATH}`）、
**请求体形态互斥**（`messages` 在场 ⇔ `questions` 在场）、**model 必须是各自的**、`status().channel` 如实报出生效通道；
还额外钉了一条"无凭据时**不得偷偷回落去打本地 Ollama**"（`stubC.calls.length === 0`）。
⇒ **"选了本地实际打云端"这类错配抓得住。**

## C · 我原来那四条是否真被修 —— **逐条重放，四条全红**

| 原变异 | 落点 | 重放结果（本轮） |
|---|---|---|
| **M3** 默认端点改云端 | `src/ollama.ts:30` | 闸 **exit 1**；`not ok 16 - S1-16 缺省值钉死：Config 缺省 = **ollama 通道 + 本地端点 + 本地模型**`（22/1）⇒ **已修** |
| **M4** 删判据文件 | `tests/b12-jev.test.mjs` | 闸 **exit 1**：`缺判据文件：b12-jev.test.mjs（**整份文件消失必须红**）`⇒ **已修** |
| **M4b** 删判据文件 | `tests/live/systemone-live.test.mjs` | 闸 **exit 1**：`缺判据文件：live/systemone-live.test.mjs（…）`⇒ **已修** |
| **M5** 显式红改静默 skip | `tests/live/…:60-74` + 5 个 test 体 | 先证变异真生效：离线跑 `env -u NANOGPT_API_KEY JEV_ENV_FILE=/nonexistent/env node --test …` → **exit 0 / 5 pass / skipped 0**（真·静默跳过）；闸 **exit 1**：`红：**显式红腿** —— 无凭据时真通道判据却**通过了**（exit 0）⇒ 它静默跳过了。`⇒ **已修** |
| **M6a** 写侧 3 问压成 1 问 | `src/systemone.ts:400` 后加 `slice(0,1)` | `not ok 3 - S1-3 **多问不压扁**`（22/1），闸 **exit 1**⇒ **已修** |
| **M6b** 读侧塌缩（只留主问题） | `src/systemone.ts:499` | `not ok 3 - S1-3` + `not ok 8 - S1-8 次要答案…不静默丢`（21/2），闸 **exit 1**⇒ **已修** |

⚠ **两次我自己的变异写错，如实留痕（均已在下方以正确变异重做）**：
- M6a 首版补丁造成 `SyntaxError: Identifier 'questions' has already been declared` ⇒ 报 `# tests 1 / fail 1`（**文件级加载失败，不是真断言红**）。以 `mC6a2` 重做后才是真红（22/1，S1-3）。
  记录在此以防后续席位把"文件炸了"误读成"判据抓到了"。
- 轮 2 的 D2 变异写错调用点（已在上轮作废）。

## D · 施工席自报"变异逼出的新缺口（主问题形状认不出零覆盖）"—— **有牙，且是唯一覆盖**

判法：把该分支**改成静默放行**（`src/systemone.ts:535-538` 的 `reasonForUnknown` 三元 → 恒 `null`，即"认不出的主问题形状"不再降级）。

| 结果 | 值 |
|---|---|
| 闸 | **exit 1** |
| `systemone.test.mjs` | **exit 1**，23 pass 中 `# pass 22 / fail 1` |
| 逐字命中 | `not ok 23 - S1-23 主问题形状**认不出**（服务端可能新增 type）⇒ 显式降级 + reason 可枚举（不得当正常路径放行）` |

`S1-23`（`tests/systemone.test.mjs:619-632`）断言齐：`degraded:true`（**不得当正常路径放行**）、`reason` 前缀 `systemone-primary-not-noul` 且点名 `quantum`、`value:'unknown'`（不得默认 no）、`probability:null`（不得用 0 冒充）、原始形状原样保留。
⇒ **有牙。** 且该条注释自述"原判据面 22/22 全绿"与我实测一致（**变异前** 22 条覆盖不到这一支；**补后** 该支被单独钉住）⇒ 施工席关于"变异逼出缺口"的自报**属实**。

## E · 离线解耦是否仍成立 —— **是**

| 检查 | 命令 | 结果 |
|---|---|---|
| 离线桩全绿 | `unshare -rn node --test tests/framework.test.mjs tests/systemone.test.mjs` | **exit 0**，`# tests 46 / pass 46 / fail 0 / skipped 0` |
| 真通道显式红 | `unshare -rn node --test tests/live/systemone-live.test.mjs` | **exit 1**，`# tests 5 / pass 0 / **fail 5** / skipped 0`，`not ok` 5 条 |

⇒ **离线时框架+桩全绿、真通道显式红**，`skipped 0` ⇒ 解耦仍成立，且"没凭据就是没验证过"是行为事实而非文案（对应闸的 ④b 行为腿）。

## rb 小结（净结论）

- **四条原缺陷（M3/M4/M5/M6）经独立重放：全部真被修复** —— 不是"改文案"，而是变异必红。
- **双通道可切换有真判据**（S1-17 双向抓"选择器失效"，含"不得偷偷回落"）。
- **旧通道仍真可用**（b12 11/11 真绿、本机 200、旧文件未改）。
- **S1-23 这条补充有牙**，且我复现了它自述的"补前零覆盖"前提。
- 本席**未发现**新增的拆东墙补西墙形态；本轮**两次变异是我自己写错**（M6a 语法错、轮 2 的 D2 调用点错），已如实记录防误导。

## 未验证（跨轮累计）

1. **真通道带凭据 5/5**：本席未跑（未读 key 值）⇒ 未验证。复跑：`set -a; . ~/jev/.env; set +a; node --test packages/jev/tests/live/systemone-live.test.mjs`（主持人经手，本席不代跑）。
2. `scripts/probe-systemone.mjs` 实测读数 ⇒ 未验证。
3. `src/systemone.ts` 的**语义**恰当性（映射是否语义正确、阈值口径、模型白名单是否有据）⇒ 未审；本席只验"变异能否被抓"。
4. 根 CI 全量 `node --test "packages/*/tests/*.test.mjs"` 的 ≥153 全绿，本席**未跑**（只测了 `packages/jev`）⇒ 未验证。
