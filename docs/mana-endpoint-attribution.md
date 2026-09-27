# 端点判据的归因读数：分清「环境坏了」与「代码坏了」

> 适用对象：一切**跑真端点**的判据（本机 Ollama 的嵌入面 / 聊天面）。
> 状态：2026-09-27 落地（卡 `t-mujtowyp-3dcdhz`）；实现见 `packages/vector/tests/_live-endpoints.mjs`。

## 1. 由来（先把"别改错方向"钉住）

本席实测（宿主 Ollama 负载抖动时）：**同一提交、同一命令**连续三次跑出 **1 红 → 4 红 → 0 红**，
红的全在真端点判据（`B1.1-⑩` / `B1.2-*` / `J1-⑫` / `dense` / `dual` 的真数据前提）。环境恢复后 846/846/0。

⚠ 初判**被实测推翻**，如实记：我原以为缺口是「环境不可用时该报 NO_DATA 而不是 FAIL」。
本仓对此早有明确立场，且**带判据**：

| 位置 | 原话 |
|---|---|
| `packages/jev/tests/gate.mjs:11` | 「④ **显式红腿**：现场用**无凭据**环境跑真通道判据，要求它 **必须红且零跳过**」；能力边界栏写明「**凭据存在但服务端真的坏了 —— 那由真通道判据本体的读数负责**」 |
| `packages/jev/tests/gate-checks.mjs:16` | 「**抓不到**：`assert.fail` 存在但被 `if` 包住；以及"凭据在但服务端坏了"⇒ ……后者由**判据本体的读数**负责」 |

⇒ **「环境不可用时判据变红」是刻意设计，不是缺陷**。改它 = 拆 ④ 显式红腿那道防线（假绿②）。
⇒ 真缺口只有一条：**红的时候读者分不清是哪一种红**。改前的形态把环境事实塞在 `reason` 字符串里
（例：`'本机 bge-m3 必须可达（这是测量条件）：' + emb.reason`），**读者要自己翻**才知道是环境问题。

## 2. 三态（**前两者都仍然是红**，区别只在文案与诊断）

| 类别 | 何时 | 颜色 | 下一步动作（文案里必须写出来） |
|---|---|---|---|
| `env-unavailable` | 传输出错 / 端点不可达 / 超时 / 服务端明确回「不支持嵌入」 | **红** | 查**测量环境**：宿主 Ollama 是否在跑 · 端点是否指对 · 是否以 `--embeddings` 启动 · 所选模型是否具嵌入能力 |
| `behavior-wrong` | 环境已应答且格式合法，读数仍不达 | **红** | 查**被测代码**：缺陷在被测面，别去重启服务 |
| `ok` | 测量条件成立且读数达 | 绿 | 无需动作 |

三条**不得同形**的判据（可机检）：
1. 类别名不同（`[live-endpoint · env-unavailable]` / `[live-endpoint · behavior-wrong]`）；
2. 判定语不同（`环境不可用` / `环境可用但被测行为不对`）；
3. **下一步动作不同**，且**互斥**：环境态文案含「不是被测代码的问题」，行为态文案含「不是环境问题」。

## 3. 读数形状（一把标尺，两边共用）

```js
{ baseUrl, model, degraded, failureKind, reason, ms, vectorCount, dims }
```

⚠ 命名陷阱（**踩过**）：向量管道里也有一个 `degraded`（`AdaptOutcome.degraded`，A1-11 契约字段）。
那是**被测面**的事，这里是**环境态**的事。本模块的输入里 `degraded === true` 只表示
「这一次真调用没拿到可用应答」；`out.degraded`（RecallOutcome）走的是 `.out` 那条路，两者**不得混读**。

## 4. 怎么写（照抄即可）

```js
import { assertLiveEmbed, attributionText, behaviorWrongText, readLiveService, classifyLiveEndpoint }
  from './_live-endpoints.mjs'

// ① 测量条件那一腿（真端点可达性）：期望值恒为 false —— 与改前的 assert.equal(x.degraded, false, ...) 逐字同义
assertLiveEmbed(probe, { title: 'B1.1-⑩ 嵌入端点的测量条件', baseUrl: cfg.baseUrl, model: cfg.model })

// ② 环境已应答之后的读数：用 behavior-wrong 文案（读者不会又去查 Ollama）
assert.equal(dim, 1024, behaviorWrongText('维度契约（A1-12）', 'dim=' + dim))

// ③ 端点层前置（要"显式红"而不是断言读数时，如 jev 的真调用腿）：
await requireOllama('B1.2-1 真调 Ollama 的测量条件')   // 内部仍走 assert.fail ⇒ ④ 显式红腿的扫描面一字未动
```

## 5. 硬边界（改判据时逐条自检）

1. **不许 skip**：不得出现 `t.skip` / 静默 `return` / `if (可达) { … }` 包整个用例。
   环境不可用仍是红 ⇒ 该断言**必红**这一性质不变。
2. **不改被测读数**：本模块只产出文案与类别；被断言字段与期望值一字不动。
3. **不自己发请求**：判据自己发（或调用方已发的那一份读数），本模块只读
   （vector 侧有「一次真端点请求都不发」的硬约束，见 `embed-unsupported.test.mjs` 的 J1-⓪ 自检）。
4. **不另立失败判据**：归类复用被测面已有的 `failureKind` 与 `unsupportedMarkerIn`（直接 import，不抄第二份特征串）。
4b. ⚠⚠ **不得绕过分类器**（2026-09-27 复验退回的根因，**本条是硬纪律**）：
   「端点层前置探测刚通过」**不等于**「这一次调用拿到了可用应答」——
   复验实测：前置通过之后，真调用仍被负载拖到 **30s 超时**（`latencyMs=30001 · aborted due to timeout`）。
   若调用点直接用 `behaviorWrongText`，就会把**一个环境性超时**说成「行为不对 ⇒ 查代码」，
   还附一句「别去重启服务」⇒ **归因反向错位**（本卡要治的病，换了个方向复现）。
   ⇒ **规则**：凡文案里的读数来自一次真调用，就把那份读数作为第 3 参传给 `behaviorWrongText`，
     或直接用 `assertLiveEmbed` / `assertLiveService`（它们内部已分类）。**不许自己猜是哪种红。**
5. **stub 端点的调用方也要用同一把标尺**：同进程 stub 的红**由分类器判定**
   （例：`recall-graph.test.mjs` 的 W2-C3-⑩ 前提腿 —— stub 挂了就是环境态，该去查 stub/端口）。
   ⚠ 早期版本在此写死了"一律落 behavior-wrong"，那是**猜**不是判；现已统一交分类器。
   否则"有的红归因得了、有的归因不了"。
6. **一处实现**：两包（vector / jev）共用 `packages/vector/tests/_live-endpoints.mjs`，
   不各写一套措辞（措辞漂移 = 又一种"同形"）。

## 6. 盲区（如实登记，不许当成已解决）

- **「服务端活着但回得慢」**：读到的是 `degraded:true + reason='嵌入请求失败（…）：TimeoutError'`，
  按本口径归 `env-unavailable`（下一步查环境）—— **类别对，但文案点的是"服务在不在"，
  不是"为什么慢"**。`docs/handoff/S12.md` 记录过该腿在 `npm test` 负载下从 23ms 飙到 6581/7055ms。

  ⚠ 2026-09-27 本席**当场观测到这一类**（不是复述旧记录），原始读数：

  | 时刻 | 并发 | 宿主单次嵌入 | 判据读数 |
  |---|---|---|---|
  | 21:15 | 另一工作树正跑 `npm test` | 超 8s | `ms=8004 · TimeoutError` |
  | 21:19 | 同上（load 2.25） | **26.9s** | `ms=30003 · TimeoutError`（30000ms 阈值被打穿） |
  | 21:21 | 并发退去 | — | 判据全绿 `95/95` |

  ⇒ 这类红的**归因方向是对的**（查环境），但它与被测代码问题的**分辨力来自 timeout 是否被打穿**：
  `embed.ts` 的本地缺省 30000ms **不得调大**（调大 = 改测量条件，
  `docs/handoff/w4-session-prompts.md:157` 明禁），正确处置是**等负载退去后复跑**并比对。
  `a1-check.mjs` 的 A1-12 已用 TCP 探针 + 两态留档正面处理这一类（能报出"TCP 通但嵌入慢"），
  测试面本期**未做**同名探针 —— 这是本改造**未覆盖**的一段，如实登记。
- **本模块不覆盖「判据根本没跑到端点」的形态**（如被测面在更早处就降级为环境态）：那由被测面读数负责。
- **`behavior-wrong` 的自动判定**只覆盖「应答里没有向量」；其余读数缺失需调用方用
  `behaviorWrongText` 显式标注（给不出就写「未验证」，不许默认成通过）。
- **登记表**（本仓两次栽在"新文件没登记 ⇒ 外部防线不看它"，故逐处核对，不只写一句"无需同步"）：
  | 登记表 | 管什么 | 本次是否需要同步 | 核对方式 |
  |---|---|---|---|
  | `packages/vector/tests/gate.mjs` 的 `FILES` | 逐文件**用例条数等式** | **否**（未新增用例文件、未改条数） | 现值与登记值逐字相同，见 §7 自证输出 |
  | `packages/jev/tests/gate.mjs` 的 `OFFLINE`/`COUNTED_OTHER` | 同上（+ 总和等式） | **否** | `b12-jev.test.mjs` 仍 11 条 |
  | `packages/vector/tests/pkg-registration.guard.mjs` | **包**（`packages/*/package.json` 的 main） | 不适用 | `_live-endpoints.mjs` 不是包 ⇒ 无需登记 |
  | `tools/a1-check.mjs` 的 `readdirSync('packages')` | 只扫 `packages/*/src` | 不适用 | 不扫 tests ⇒ 无涉 |
  ⚠ 将来若**新增**测试文件或**增删用例**，上表前两行必须同步（改条数要**同时**改闸与文件内 ⓪ 自检）。


## 7. 自证（原始输出，2026-09-27）

### 7.1 全量：`npm run build && npm test`

```
build-exit=0
test-exit=0
# tests 858
# pass 858
# fail 0
# skipped 0
```

### 7.2 两个方向的断言文案（**同一份坏读数**喂给改前/改后判据，受控对拍）

读数：`{ degraded: true, failureKind: 'degraded', vectors: 0 }`（真死端口 `127.0.0.1:1`，走真 `embedTexts`）

**改前**（`git show HEAD~:<dense 文件>` 原文，环境事实塞在 reason 里）：
```
本机 bge-m3 必须可达（这是测量条件）：嵌入请求失败（http://127.0.0.1:1/v1，timeoutMs=5000）：TypeError: fetch failed
```

**改后**（同一份读数）：
```
[live-endpoint · env-unavailable] dense-⑦⑧⑨ 真数据前提（生产写面嵌入）｜环境不可用：传输出错 / 端点不可达 / 超时（这一次调用没拿到可用应答）｜实测：端点=http://127.0.0.1:1/v1 · model=bge-m3 · degraded=true · failureKind=degraded · ms=3 · vectors=0 · reason=嵌入请求失败（http://127.0.0.1:1/v1，timeoutMs=5000）：TypeError: fetch failed｜下一步：查**测量环境**：宿主 Ollama 是否在跑 · 端点是否指对 · 该服务是否以 --embeddings 启动 · 所选模型是否具嵌入能力（这一条**不是**被测代码的问题，别去翻被测面）
```

**行为态**（环境可用、维度契约不满足 —— 真·代码缺陷形态）：
```
[live-endpoint · behavior-wrong] B1.1-⑩ 维度契约（A1-12，A 档）｜环境可用但被测行为不对｜实测：dim=768（应 1024）｜下一步：查**被测代码**：测量环境已应答且格式合法，读数却不对 ⇒ 缺陷在被测面（这一条**不是**环境问题，别去重启服务）
```

**服务端明确回「不支持嵌入」**（真 501 原文，走本机真 http 服务）：
```
[live-endpoint · env-unavailable] …｜环境不可用：服务端**明确回**「本服务不支持嵌入」（命中语义特征「does not support embeddings」）⇒ 处置方向是**服务端启动参数或模型能力**｜…
```

**方向①（环境正常）**：真实端点 `degraded=false · dim=1024` ⇒ `三态分类=ok`、判据绿。
`vector gate` 复跑 `# tests 95 / # pass 95 / # fail 0 / # skipped 0`（exit 0）。

### 7.3 零 skip 自查

改动面 9 个文件（含两个闸本体），**剥掉注释后**扫 `t.skip( / context.skip( / it.skip( / test.skip( / skip: true / skip:true`：

```
⇒ skip 形态命中 0 处（零 skip）
```

### 7.4 登记表等式对账（13 处，逐处现算现值 vs 登记值）

```
vector: b11-vector=15/15 · recall-graph=11/11 · recall-gate-wiring=7/7 · bigloop=12/12 ·
        bigloop-wiring=11/11 · embed-unsupported=16/16 · recall-dense=11/11 · recall-dualpath=12/12
jev   : framework=23/23 · systemone=23/23 · w12-real-channel=9/9 · b12-jev=11/11 · live/systemone-live=9/9
⇒ 全部逐字相同
```

### 7.5 假绿②防线未被削弱

`node packages/jev/tests/gate.mjs` → **exit 0**，四腿全过：

```
[jev·gate] **动态腿通过**：离线命名空间下 55/55 绿（exit 0）⇒ 判据确实零网络
[jev·gate] **显式红腿通过**：无凭据跑真通道判据 ⇒ exit=1 tests=9 fail=9 **skipped=0**（红 + 零跳过）
[jev·gate] 绿：离线 55/55 · 合计 75 条判据全在等式内；自检腿 + 静态腿 + 动态腿（离线）+ 显式红腿 四通过
```

`git diff --name-only 0684600..HEAD -- packages/jev/tests/gate.mjs packages/jev/tests/gate-checks.mjs packages/vector/tests/gate.mjs` ⇒ **空**（判据本体一字未动）。



### 7.6 复验退回的修复（归因反向错位 · 2026-09-27）

**现象（复验实测原文，非本席自述）**：他席并发时，`B1.2-1` 打出
`[live-endpoint · behavior-wrong] …｜实测：latencyMs=30001 · reason=…aborted due to timeout｜下一步：查**被测代码**…（这一条不是环境问题，**别去重启服务**）`
⇒ **一个 30 秒超时被标成"行为不对 ⇒ 去查代码"，还明说"别去重启服务"** —— 归因反向错位。

**根因（两处，缺一不可）**：
1. `b12-jev.test.mjs` 三处调用点**绕过了分类器**，直接用恒定文案的 `behaviorWrongText`；
2. 我在那里写的理由「前置已过 ⇒ 这里的红只能是行为面」**前提不成立**：
   端点层前置只证明**那一刻**可达，**本次真调用仍可能超时**（本次即 30s）。

**修法**（不动被测读数、不放宽期望值）：`behaviorWrongText` 增第 3 参 `reading`，
**先过分类器**；三处调用点改用 `assertLiveService`（内部已分类）。

**受控对拍**（同一份「30s 超时」坏读数）：

| | 文案 |
|---|---|
| 修复前 | `[live-endpoint · behavior-wrong] B1.2-1 正常路径｜环境可用但被测行为不对｜实测：latencyMs=30001 · reason=…aborted due to timeout｜下一步：查**被测代码**…（…别去重启服务）` |
| 修复后 | `[live-endpoint · env-unavailable] B1.2-1 正常路径｜环境不可用：传输出错 / 端点不可达 / 超时（这一次调用没拿到可用应答）｜实测：端点=… · ms=30001 · reason=…aborted due to timeout｜下一步：查**测量环境**：宿主 Ollama 是否在跑…（这一条不是被测代码的问题，别去翻被测面）` |
| 防回退（调用点仍误用 `behaviorWrongText`，但传了读数） | `[live-endpoint · env-unavailable] …｜**读数实为环境态，不是行为错**｜…｜下一步：查**测量环境**…` |

**行为态对照**（真行为错 dim=768）⇒ 仍是 `behavior-wrong` + 查代码，两态**不同形**（文案逐字不同）。

**红线自查**：`assert.equal(reading.degraded, false, …)` 期望值**恒为 false 未放宽**；
`degraded=true` 喂进去仍**红**（受控实测）；零 skip 自查剥注释后命中 **0** 处。

