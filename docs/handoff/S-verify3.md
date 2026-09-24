# S-verify3 · 独立复核席 3（只读）· 报告

**会议**：mana-jev-framework-2026-09-24 · 轮 1 · 工作项 `vf`（kind=survey）
**本席写面**：仅本文件。仓库其余只读；变异/实验**全部在 `/tmp` 内**，仓库零写入。
**快照时刻**：`2026-09-24T12:57:27Z`（= 本地 20:57:27 +08:00）

```
sha256  packages/jev/tests/b12-jev.test.mjs  cbc1a5d3d1832646cecaf29c51816f19d0831c5ebae6a5cd0b303551b400d4cd
        20460 bytes  mtime=2026-09-24 19:51:51 +0800
sha256  packages/jev/src/ollama.ts           bf4e292f7c9b7c62c0672a07ce3833617780c007768ce9a2aca571e02e125aee
sha256  packages/jev/src/index.ts            2f0df127b3015a3887cea1accadda094f3c670cefb1f8b9d0aff0785d0c26081
git HEAD ee9e22e7c07eb6be20c24c7b81807a3dfc54c65d
git status packages/jev:  M src/index.ts | ?? src/ollama.ts | ?? tests/
```

⚠ **施工席正在改这个包** ⇒ 上表是**在途快照**。wave 2（`rf`/`rd`）**必须重新取 hash**，本席的计数只对 `cbc1a5d3…` 这一版有效。

---

## ① 「零网络判据」这把尺子

### 1.1 静态腿：真连网络痕迹（文件 + 行号 + 命中数）

被测文件：`packages/jev/tests/b12-jev.test.mjs`（唯一测试文件；`tests/` 下无其他 `*.test.mjs`）。

| 模式 | 命中数 | 行号 | 定性 |
|---|---|---|---|
| `127.0.0.1:11434` | **5** | 67, 78, 282, 283, 284 | **只有 1 处真调用**（L67）；L78 是断言文案字符串；L282–284 是纯函数 `chatUrl()` 的**字符串入参**，不联网 |
| `ollamaReachable` | **5** | 65(def), 77, 131, 230, 342 | 4 个调用点，全部是「不可达即 `assert.fail`」的**显式硬失败**（非 skip，非假绿） |
| `liveJudge` | **4** | 58(def), 81, 133, 234 | 3 个调用点，全部**真调模型** |
| `fetch(` | **1** | 67 | 就是那句 `fetch('http://127.0.0.1:11434/api/tags')` —— 唯一未走桩的真网络出口 |
| `fetchImpl` | **2** | 217, 257 | 纯桩（500 / 无 yes-no 族响应），零网络 |
| `127.0.0.1:1` | **3** | 172, 175, 376 | 设计好的 `ECONNREFUSED`，非桩、非真模型 ⇒ 定性「**半真**」（需环回，不需模型） |

**结论（静态）**：该文件里**唯一的真网络出口是 L67**，其余 `127.0.0.1:11434` 命中是文案/纯函数入参。**`grep 11434` 的命中数会高估依赖面（5 命中 vs 1 真出口/SUT）** —— 静态腿只能筛出「可疑面」，落锤必须靠动态腿。

### 1.2 动态腿：掐断网络后判据是否仍绿

**选定方案（首选）—— 新建网络命名空间 + 只开环回**：

```bash
unshare -rn sh -c 'ip link set lo up 2>/dev/null; cd /home/lk/Mana/packages/jev && node --test tests/b12-jev.test.mjs'
```

**为什么必须 `ip link set lo up`**（而不是干脆无网）：`lo` 打开 ⇒ **本地桩服务器仍然可用、非本机的一切不可达**。这是比「全断」更严也更有意义的隔离：
- 若连 `lo` 都没有，任何 loopback 相关失败都会与「桩没配好」**同形**，判不出真因；
- 打开 `lo` 后，判红只可能是**真外部依赖**。

**本席实测的控制组（证明尺子真的有劲，不是摆设）**：

| 对照 | 命令 | 实测 |
|---|---|---|
| 尺度内 11434 | `unshare -rn sh -c 'ip link set lo up; curl -m2 http://127.0.0.1:11434/api/tags'` | `curl_rc=7`（连不上） |
| 尺度内 外网 | 同上 + `https://example.com` | `ext_rc=7`（连不上） |
| 尺度外 外网（正常环境） | `curl -m4 https://example.com` | `http=200`（正常可达） |
| 尺度内 本地桩服务器 | netns 内 `http.createServer().listen(0,'127.0.0.1')` + `fetch` | `local_stub_in_netns_ok 1` ✅ 桩**仍可用** |
| 尺度内 跑全套判据 | 见上命令 | **EXIT=1** · `# tests 11 / pass 7 / fail 4 / skipped 0` |

⇒ **尺子有抓取力**：今天它抓出 4 条，且这 4 条**恰好**是 ① 计数为「依赖真模型」的那 4 条（见 ②）。**静态计数 == 动态失败集**，两条独立路径互证。

**选定方案（备选，无需特权）—— 代理黑洞**：

```bash
env HTTP_PROXY=http://127.0.0.1:1 http_proxy=http://127.0.0.1:1 \
    HTTPS_PROXY=http://127.0.0.1:1 https_proxy=http://127.0.0.1:1 \
    ALL_PROXY=http://127.0.0.1:1 all_proxy=http://127.0.0.1:1 \
    NO_PROXY= no_proxy= \
    node --test tests/b12-jev.test.mjs
```

本机实测与 netns **同结果**（EXIT=1 / pass 7 / fail 4）。
⚠ **该备选有一个静默失效点**：本机有 `NODE_USE_ENV_PROXY=1`，undici 才认 `*_PROXY`；**该变量缺失的 Node 上，备选尺子会静默失效（判据照常连上 11434，尺子变成摆设）**。⇒ **用备选时必须先跑控制组**（`curl` 拒绝 + 判据当前仍红）；**首选始终是 netns**。

**⚠ 本机一个易踩的坑（会影响「拔掉 Ollama」的实现方式）**：
`ss -ltn` **看不到 11434 的监听者**（只有 3080/53 在听），但 `curl 127.0.0.1:11434/api/tags` 返回 **200** —— Ollama 跑在 **Windows 宿主**，经 WSL 镜像网络到 `127.0.0.1`。
⇒ **「端口是否在听」不能用来判断 Ollama 在不在**（本机此判法必然误判）；同理，**停不掉 Windows 侧服务时，netns 是唯一可靠的「拔掉」手段**。

### 1.3 防三种已知假绿形态（全部本席亲手复现）

| 形态 | 命令 | 实测 | ⇒ 尺子必须加的前置门 |
|---|---|---|---|
| 零字节测试文件 | `: > /tmp/vf_zero.test.mjs; node --test /tmp/vf_zero.test.mjs` | **EXIT=0**，`# tests 1 / # pass 1 / # fail 0` | 断言 `bytes > 0` |
| 通配 + 空目录 | 空目录内 `node --test "tests/*.test.mjs"`（带引号） | **EXIT=0**，`# tests 0` | 断言 TAP `# tests > 0` |
| 同上（不带引号，shell 展开为空） | 空目录内 `node --test tests/*.test.mjs` | **EXIT=0**，`# tests 0` | 同上门 + **禁通配，传显式文件路径** |

**尺子模板（wave 2 的 `rd` 直接抄）**：

```bash
F=/home/lk/Mana/packages/jev/tests/b12-jev.test.mjs
# 门 1：文件存在且非零字节
test -f "$F" && [ "$(wc -c < "$F")" -gt 0 ] || { echo "GATE1_FAIL"; exit 9; }
# 门 2：静态用例数（显式路径，不通配）
S=$(grep -c '^test(' "$F"); [ "$S" -gt 0 ] || { echo "GATE2_FAIL static=0"; exit 9; }
# 门 3：动态腿（掐网），退出码不经管道取
unshare -rn sh -c "ip link set lo up 2>/dev/null; cd /home/lk/Mana/packages/jev && node --test $F" > /tmp/ruler.out 2>&1
RC=$?
T=$(awk '/^# tests/{print $3}' /tmp/ruler.out)
# 门 4：TAP 不许是空集，且与静态计数相符
[ "${T:-0}" -gt 0 ] || { echo "GATE4_FAIL tap_tests=0"; exit 9; }
[ "$T" = "$S" ] || { echo "GATE4_FAIL tap=$T static=$S"; exit 9; }
echo "ruler: exit=$RC tests=$T pass=$(awk '/^# pass/{print $3}' /tmp/ruler.out) fail=$(awk '/^# fail/{print $3}' /tmp/ruler.out)"
```

**本席用此模板对当前快照实跑（逐字粘贴，非改写）**：

```
ruler: exit=1  tests=11  pass=7  fail=4
```

⇒ 门 1/2/4 全过、门 3 判红（= 当前框架判据**尚未**零网络，符合预期，因为 f1 还没交付）。模板里的 awk 解析已在本机验证（`/^# tests/{print $3}` 取到 `11`）。

### 1.4 本席**未能**验证的（不凑数）

- **停掉生产 Ollama 服务**做「真拔线」：会碰运行态（宿主 Windows 侧服务，且不属本席只读面）⇒ **未验证**，以 netns 作替代，并在 1.2 给出控制组说明替代为何可信。
- `--test-force-exit` / 测试文件是否残留后台句柄：**未验证**（不属本项范围）。

---

## ② 模型依赖面计数（**本席自数，不采信自述**）

快照：`b12-jev.test.mjs` @ `cbc1a5d3…` / `20460 bytes` / 11 条用例（`grep -c '^test('` = 11，TAP `# tests 11`，两者相符）。

### 2.1 逐条判定表

| # | 用例（行号） | 需要真模型？ | 依据（判据形态 + 行号） |
|---|---|---|---|
| 1 | B1.2-1（L76） | **是·硬依赖** | 门 L77–79 `ollamaReachable()` ⇒ 不可达即 `assert.fail`；主体 L81 `liveJudge()` 真调 |
| 2 | B1.2-2（L130） | **是·硬依赖** | 门 L131；主体 L133 `liveJudge()` 真调 |
| 3 | B1.2-3（L167） | 否（**半真**：需环回） | 端点 L175 `127.0.0.1:1` ⇒ `ECONNREFUSED`；**无 `ollamaReachable` 门**；断言降级字段 + `count()===1` 留痕 |
| 4 | B1.2-4（L212） | 否（纯桩） | L217 `fetchImpl: async () => new Response('boom',{status:500})` |
| 5 | B1.2-5（L229） | **是·硬依赖** | 门 L230；主体 L234 `liveJudge({db,…})` 真调 |
| 6 | B1.2-6（L252） | 否（纯桩） | L257 `fetchImpl` 返回无 yes/no 族响应 |
| 7 | B1.2-7（L278） | 否（纯函数） | 只断言 `stateHash` / `chatUrl`；L282–284 的 `11434` 是**字符串入参**，不联网 |
| 8 | B1.2-8（L287） | 否（纯函数） | 只断言 `extractPos0Candidates(null/{}/…)` 的异常形态 |
| 9 | B1.2-9（L298） | 否（纯函数） | **手写候选**（L301–307）+ `normalizeYesNo`；文件头已声明这是「负向补例，不替代真返回断言」 |
| 10 | B1.2-10（L318） | **是·硬依赖**（仅后半段） | **L319–341 纯本地**（`Context` 装配 + 临时库 + `status().wired`），**门在 L342**；L345 `svc.judge(...)` 走缺省端点 = 真调 |
| 11 | B1.2-11（L355） | 否（**半真**：需环回） | 触发 L376 `endpoint: 'http://127.0.0.1:1'`；卸载反证，**不触模型** |

### 2.2 汇总（快照 `cbc1a5d3…`）

| 分类 | 条数 | 用例 |
|---|---|---|
| **硬依赖真模型** | **4 / 11（36.4%）** | 1, 2, 5, 10 |
| 半真（需 loopback，不需要模型/外网） | 2 / 11 | 3, 11 |
| 纯桩 / 纯函数（当前已零网络） | 5 / 11 | 4, 6, 7, 8, 9 |

### 2.3 两条独立通道互证（不靠自述）

**通道 A（静态）**：`ollamaReachable` 4 个调用点（L77/131/230/342）⇒ 4 条硬门。
**通道 B（动态）**：掐网跑全量 ⇒ **恰好** `pass 7 / fail 4`；再逐条 `--test-name-pattern` 在净网下跑 ⇒ 集合**精确等于** `{B1.2-1, B1.2-2, B1.2-5, B1.2-10}`。

```bash
# 可复跑（判据不受空集欺骗：先证文件非零 + 静态计数非 0）
cd /home/lk/Mana/packages/jev
dep=0; tot=0
for i in $(seq 1 11); do
  tot=$((tot+1))
  unshare -rn sh -c "ip link set lo up 2>/dev/null; cd /home/lk/Mana/packages/jev; \
    node --test --test-name-pattern='B1\.2-$i\b' tests/b12-jev.test.mjs" >/dev/null 2>&1
  [ $? -ne 0 ] && { dep=$((dep+1)); echo "B1.2-$i NEEDS-REAL-MODEL"; }
done
echo "$dep / $tot"
# 实测输出：B1.2-1 / B1.2-2 / B1.2-5 / B1.2-10 NEEDS-REAL-MODEL → 4 / 11
```

⚠ 已核 `--test-name-pattern` **真的在过滤**（不是偷偷跑全量）：单条运行时 TAP 报 `# tests 1`（抽查 -1/-3/-10 均为 1）。

### 2.4 给 wave 2 的三条判读（本席在这三项上**不越界设计，只报证据**）

1. **两个口径差就是坑**：`grep 11434` 得 **5** 命中，而真出口/SUT 只有 **1**（L67）；同理「掐网即红」判出 4 条，但静态指纹是 5 个调用点 + 3 个 `127.0.0.1:1`。⇒ **口径必须写明「数的是真出口还是字符串命中」**，否则自述数字与复核数字会各说各话。
2. **「半真」这 2 条（3/11）是尺子的盲区来源**：它们**不需要模型**，但**需要环回**。任何「断网就绿」的粗尺子会把它们误判成「依赖模型」，或反过来在真断环回时误判框架坏了。⇒ 尺子必须区分「模型依赖」与「环回依赖」。
3. **既有先例可用**：**B1.2-3 在零网络（仅环回）下已全绿**，且它恰恰断言了本轮最核心的义务 —— 降级时 `degraded:true` + `reason` 非空 + `probability:null` + **仍写一行 `jev_log`**（L180–205）。⇒ 「框架判据零网络跑绿」在本仓**已有可复制的样板**，不是新要求。
4. ⚠ **本快照带时效**：f1 正在改这个包。上述 4/11 只对 `cbc1a5d3…` 成立；**f1 交付后必须重数**，且必须用同一把尺子（否则「依赖面缩小」无法比较）。

### 2.5 在途漂移实测（本席只读观测，非结论）

本项开工期间（21:08 复取）施工面已动：

| 文件 | 开工时 | 21:08 | 说明 |
|---|---|---|---|
| `tests/b12-jev.test.mjs` | `cbc1a5d3…` | `cbc1a5d3…`（未变） | ⇒ **② 的 4/11 仍对该文件成立** |
| `src/index.ts` | `2f0df127…`（1975 B） | `c301784a…`（5522 B） | 已改 |
| `src/framework.ts` | 不存在 | `c116651e…`（19270 B） | 新增（= f1 的框架模块） |

⇒ **wave 2（`rf`/`rd`）判读前必须重取三件 hash**，本报告与实测只能按 hash 对齐，不能按文件名对齐。

### 2.6 预登记：`rd` 该给出什么（先立判据，避免事后凑口径）

掐网跑全量后，`pass` 只有两种可能有意义的读数，**必须报清是哪一种**：

- **情形 A（9/11 绿，挂的正是 1/2/5/10）**：只证「剩余判据零网络」。框架「解耦」仍**未被证** —— 框架本身无独立判据（B1.2-3 除外），属「框架好不好」的**证据面缺口**，不是失败，但**不得**记成「已解耦」。
- **情形 B（11/11 绿 + 框架判据条数明显增加且全绿）**：才构成「框架判据零网络跑绿」的硬证据。此时必须同时给：① TAP `# tests` 与 `grep -c '^test('` 是否相符；② 快照 hash；③ 三条时间量是否用**注入时钟**（本席在 `rf` 项判，不在 `rd` 项判）。

**两种情形都不许用「skip 变多」冒充绿**：`# skipped` 必须为 **0**。

---

## 二、rf/rd 复核（第 2 轮）

**复核快照**：`2026-09-24T13:25:59Z`（本地 21:25:59 +08:00）

```
sha256  src/framework.ts        b0c5d82c559e7abe4c78e5de60ff5d2e952f261f5944f2df7d320267db5da8fd  (21744 B)
sha256  src/index.ts            580f1c8699f0d40f4bb82e3876a753826eab5c300d318dce250b1fe79bd67ef2  ( 7455 B)
sha256  src/ollama.ts           cf3a34d5b7f7dc131b5400e88f010e87200b63170d7c8fb47d22deeabc4df001  (14542 B)
sha256  tests/framework.test.mjs 681e6500bef61562f78c04b0b568110d545a4b49011401e9658719b04621ef33  (30568 B, 16 条)
sha256  tests/b12-jev.test.mjs   cbc1a5d3d1832646cecaf29c51816f19d0831c5ebae6a5cd0b303551b400d4cd  (20460 B, 11 条)
sha256  tests/gate.mjs           4db4e42c9602379a3ba6a7c70bfd4775bbd7bb83f975d8b84598a0fc4de0932e  ( 4907 B)
```

**本席零污染自证**（变异全部在 `/tmp/jev-mut/` 副本内）：复核结束后重取上列**全部六个**文件 hash，**与复核开始时逐字相同**（含 `tests/framework.test.mjs` = `681e6500…`、`src/framework.ts` = `b0c5d82c…`）。

### 基线复跑（先证可复现，再谈变异）

| 命令 | 退出码 | TAP |
|---|---|---|
| `node --test tests/framework.test.mjs` | **0** | `# tests 16 / pass 16 / fail 0 / skipped 0` |
| `node --test tests/b12-jev.test.mjs tests/framework.test.mjs` | **0** | `# tests 27 / pass 27 / fail 0 / skipped 0` |
| `node tests/gate.mjs` | **0** | `[jev·gate] 绿：16/16，零网络依赖，退出码 0` |

⇒ 自报 #3（16/16、27/27）**属实**。

---

### A. 「配置项真被消费」——**成立，但只有一条防线**（裁定：真，附保留）

**变异 A**（主持人指定形态）：把 `apply()` 退回 `void config`，`JevGuard` 换成 `new JevGuard({})`
（`/tmp/jev-mut/packages/jev/src/index.ts`）：

```diff
-  const guard = new JevGuard({
-    cacheTtlSeconds: config.cacheTtlSeconds,
-    circuitBreakerFailures: config.circuitBreakerFailures,
-    circuitBreakerCooldownSeconds: config.circuitBreakerCooldownSeconds,
-    maxConcurrency: config.maxConcurrency,
-    sessionBudget: config.sessionBudget,
-  })
-  guard.setWaitTimeoutMs(config.concurrencyWaitTimeoutMs)
+  const guard = new JevGuard({})   // MUTANT: 退回"假旋钮"时代
+  void config
```

**实测**：`exit=1` · `# tests 16 / pass 15 / fail 1 / skipped 0`
**唯一变红**：`F14/F15 装配面`，报错原文：

```
生效配置必须逐项等于装配传入值（`void config` 时代这里全是缺省值）
+ actual - expected
  {
+   cacheTtlSeconds: 300,        -   cacheTtlSeconds: 7,
+   circuitBreakerFailures: 5,   -   circuitBreakerFailures: 3,
+   circuitBreakerCooldownSeconds: 60, - 11,
+   maxConcurrency: 4,           -   maxConcurrency: 2,
+   sessionBudget: 200           -   sessionBudget: 5
  }
```

⇒ **假旋钮已被抓住**，主持人设的判红门槛（「只有一两条红甚至全绿 ⇒ 判红」）**未触发**（红 1 条 ≥ 1）。

⚠ **但有保留，这条保留正是本轮最值得知道的**：整轮「配置项真被消费」**只有 F14/F15 一条用例在守**。
本席实测：`grep -n "^test(" tests/framework.test.mjs` 共 **16 个 test 块**；
其中**只有 F14/F15（L520）** 走到 `ctx.plugin(jevMod, CFG)`（即 `apply()`）——
**其余 15 条全部用 `new JevGuard({显式配置})` 直接构造护栏，绕开 `apply()`**（逐块核过：`ctx.plugin(jevMod` 全文只出现 **1** 次）。
⇒ 若 F14/F15 这条用例被删/被改松，**「假旋钮」会立刻复活且其余 15 条全绿**。

**为验证这一点，本席做了八个变异**（V1–V8；`/tmp` 副本内，**每处替换先校验命中数 =1 才跑**）：

| 变异 | 改法 | 退出码 | 变红用例 |
|---|---|---|---|
| **V1 并发** | `if (this.#inFlight < this.config.maxConcurrency)` → `< JEV_DEFAULT_MAX_CONCURRENCY` | 1 | **F10 + F14/F15**（2 条） |
| **V2 TTL** | `nowMs - hit.storedMs >= this.config.cacheTtlSeconds * 1000` → `>= JEV_DEFAULT_CACHE_TTL_SECONDS * 1000` | 1 | **仅 F3**（1 条） |
| **V3 预算** | `used >= this.config.sessionBudget` → `>= 200` | 1 | **F11 + F12**（2 条） |
| **V4 熔断阈值** | `this.config.circuitBreakerFailures` → `5`（L169 + L286 两处） | 1 | **仅 F16**（1 条） |
| **V5 冷却秒数** | `this.config.circuitBreakerCooldownSeconds * 1000` → `60 * 1000` | 1 | **仅 F16**（1 条） |
| **V6 等待超时** | 删 `guard.setWaitTimeoutMs(config.concurrencyWaitTimeoutMs)` 一行 | 1 | **仅 F14/F15**（1 条） |
| **V7 强制串行** | `if (this.#inFlight < this.config.maxConcurrency)` → `< 1` | 1 | **F9 + F14/F15**（2 条） |
| **V8 半开单探针闸** | 删 `if (!guard.beginProbe()) return refused(...)` 一行 | 1 | **仅 F8**（1 条） |

⇒ **六个旋钮每一个都可被单独观测到**（无「记录了但没用」的死旋钮），这一点**成立**。
⇒ V7 另证 F9 的「恰为 4」**有下界**（强制串行必被抓住）；V8 另证半开闸**不是装饰**（删掉即 F8 红）。
⚠ 但 V4（熔断阈值）与 V5（冷却秒数）**只被 F16 一条抓到** —— 而 F16 用的是「熔断 2 次 / 冷却 30s」，
即两者都**不是**在缺省值（5 / 60）上被判。本席未验证 V4/V5 在另设阈值下的独立性（见「未验证」）。

**另一条本席实测的辅助证据**：单独的 `--test-name-pattern='F14'` 跑变异 A ⇒ `fail 1`；
⇒ F14/F15 自己就能独立抓住假旋钮，不依赖其他用例连带失败。

---

### B. 计时器是否真用注入时钟 —— **成立**（裁定：真）

**静态**：`tests/framework.test.mjs` 内 `setTimeout` 仅有 **2 处**：L144（`sleep` 辅助函数定义）+ L240（`JevGuard.#enqueue` 的**业务**等待超时，在 `src/framework.ts`）。
测试里所有真实等待都是 `sleep(5/15/20/60/150/300)` —— **毫秒量级**，最大 300ms。

**动态（主持人要的 `time` 读数）**：`/usr/bin/time` 实测

```
framework.test.mjs 单跑：wall = 0.87 s   （TAP # duration_ms 824.2）
两文件合跑：             wall = 6.36 s
```

**逐条耗时（TAP `duration_ms`）**，最大值与时间量量级对比：

| 用例 | duration_ms | 若真等会是多少 |
|---|---|---|
| F1 缓存 TTL | 21.77 | 300s（TTL）或 301s |
| F6 冷却半开 | 1.03 | 60s（冷却）|
| F7 冷却重计时 | 0.80 | 60s |
| F9 并发 | 65.29 | — |
| F10 等槽超时 | 62.91 | — |
| F14/F15 装配面 | 527.35 | — |
| **全部** | **824.21** | `# duration_ms 824.207281` |

⇒ **任何一条的耗时都远小于 60s / 300s**；`clock.set(T0 + 299_000)` / `clock.set(T0 + 301_000)` / `clock.set(T0 + 59_000)` / `clock.set(T0 + 60_000)` 全是**注入时钟跳变**，不是真等。**判红门槛未触发**。

---

### C. 并发上限是否**可数**（桩记 vs 实现自报）—— **成立**（裁定：真）

主持人问的关键点「峰值是桩记的，还是实现自报的」。**两者是分开的两次断言，且都真**：

- **桩记（独立于实现）**：F9 L347–354 **在测试文件内自带**一个 `inFlight/peak` 计数器，在被调用的 `fetchImpl` 里自增/自减：
  ```js
  let inFlight = 0; let peak = 0
  const fetchImpl = async () => { inFlight += 1; if (inFlight > peak) peak = inFlight; await sleep(20); inFlight -= 1; return okResponse(0.6) }
  ```
  断言 **L359**：`assert.equal(peak, 4, ...)` ← **这一条是桩记的**。
- **实现自报**：断言 **L360 / L581**：`assert.equal(guard.snapshot().peakInFlight, 4)` ← 这一条来自 `JevGuard`。
  ⇒ 两者**相等**才过 ⇒ 「实现自报」不是唯一来源，桩与实现互相钉死。
- ⚠ **本席实测的一个反例**：`makeFetch()`（L94–116）里**也有**一个 `peak()` 计数器，但 **`grep -n "\.peak()" tests/framework.test.mjs` 命中 0** ⇒ **它是死代码，从未被断言**。
  F9 的桩是**另外手写的**（L348），不是 `makeFetch` 的那个。⇒ 「桩记峰值」成立，但**不是**靠 `makeFetch.peak()`；那个 API 建议删掉，否则后人会以为并发已被它守住。
- **下界有效性（本席追问：只断言"≤4"会不会让"根本没并发"也通过？）**：
  **变异 V7**（`< this.config.maxConcurrency` → `< 1`，即强制串行）⇒ `exit=1 / pass 14 / fail 2`，
  变红 **F9 + F14/F15**。⇒ 「恰为 4 / 恰为 2」的下界**有效**，串行实现必被抓住。
  断言文案 L359 自己就写明了这个设计意图（"断言 ≤4 而不给下界会让'根本没并发'也通过"）。

---

### D. 独立复跑无网络下的**框架**判据 —— **16/16 绿**（裁定：真）

**用本席上轮自立的尺子**（§1.2，非施工席命令）：

```bash
unshare -rn sh -c 'ip link set lo up 2>/dev/null; cd /home/lk/Mana/packages/jev && node --test /home/lk/Mana/packages/jev/tests/framework.test.mjs'
```

**输出原文**：

```
D_EXIT=0
# tests 16
# pass 16
# fail 0
# skipped 0
# todo 0
```

**环境差异说明（主持人要求写出）**：本席与施工席的命令**唯二差别**是 ① 本席显式 `ip link set lo up`；② 绝对路径。
**本席已验证这不会改变结果**：加/不叫 `lo up` 对 framework 文件都不影响（它 0 条 loopback 依赖）。
本席选 `lo up` 的理由是**保守**：不打开 `lo` 时，loopback 相关失败会与「桩没配好」同形，判不出真因（见 §1.2）。
**控制组**（证明尺子真的有切断）：netns 内 `curl -m2 http://127.0.0.1:11434/api/tags` ⇒ `ollama=000`（连不上），
而正常环境同命令 ⇒ **200**。⇒ 隔离是真的，D 的绿不是在联网环境下误得的。

---

### E. 反向对照：同样无网络下跑**旧** `b12-jev.test.mjs` —— **红 4 条**（裁定：真）

```bash
unshare -rn sh -c 'ip link set lo up 2>/dev/null; cd /home/lk/Mana/packages/jev && node --test /home/lk/Mana/packages/jev/tests/b12-jev.test.mjs'
```

**输出原文**：

```
E_EXIT=1
# tests 11
# pass 7
# fail 4
# skipped 0        ← ⚠ 关键：不是 skip
# todo 0
```

**红的 4 条 + 错误原文**：

| # | 用例 | duration_ms | error 原文 |
|---|---|---|---|
| 1 | B1.2-1 真调 Ollama…（L76） | 9.58 | `Ollama 127.0.0.1:11434 不可达 —— 本判据要求真调用，不静默跳过（否则是假绿）` |
| 2 | B1.2-2 大小写变体…（L130） | — | `Ollama 不可达 —— 本判据要求真调用` |
| 5 | B1.2-5 正常反例…（L229） | 2.43 | `Ollama 不可达 —— 本判据要求真调用` |
| 10 | B1.2-10 服务面 judge…（L318） | — | `Ollama 不可达 —— 本判据要求真调用` |

**⇔ 这是「解耦」的完整两半**：

| 无网络条件下 | 结果 |
|---|---|
| `framework.test.mjs`（框架面） | **16 / 16 绿**，`exit 0` |
| `b12-jev.test.mjs`（适配面） | **7 / 11**，红 4，`exit 1` |

⇒ **框架绿 + 适配红，两者同时成立** ⇒ 框架与适配**确实分得开**。
**判定门槛未触发**：本体**没有**全绿 ⇒ 那 4 条**不是**被静默跳过（`# skipped 0` 三次复跑一致，且 `assert.fail` 是硬失败而非 skip）。
**与本席上轮 4/11 计数完全一致**（上轮独立的逐条 `--test-name-pattern` 矩阵给的就是 {1,2,5,10}）⇒ 第三次互证。

---

### F. `gate.mjs` 的「零网络静态核」是否真有牙 —— **有牙，但可被绕过**（裁定：真·有保留）

**控制组**（`/tmp` 未变异副本）：`node tests/gate.mjs` ⇒ `GATE_CTRL_EXIT=0`，末尾 `[jev·gate] 绿：16/16，零网络依赖，退出码 0`。

**主持人要求的变异**（往 `framework.test.mjs` 塞一处真调用 `fetch('http://127.0.0.1:11434/api/tags')`）：

```
GATE_F_EXIT=1
[jev·gate] 红：1 项
  · framework.test.mjs 含真模型调用标记 "127.0.0.1:11434" ⇒ 框架判据重新依赖模型（本轮红线：零网络）
```

⇒ **必红，且红因正是静态核本身**（不是靠后面的跑测试连带）。**F 成立**。

⚠ **但本席发现静态核有一个可绕过的形态**（这是「让失败不可观测」的形态，必须记下）：
把端点写成**动态拼接**（不含任何禁词字面量）后，闸**变绿**：

```js
await fetch('http://127.0.0.1:' + (11434) + '/api/tags')   // MUTANT: 动态拼端点
```

| 腿 | 对「动态拼端点」变异的结果 |
|---|---|
| 静态腿 `gate.mjs` | **`GATE_EXIT=0`（全绿，漏抓）** |
| 动态腿（本席 netns 尺子） | **`exit=1`，`pass 15 / fail 1`** —— **抓住了** |

⇒ **结论**：`gate.mjs` 的静态核是「**字面量黑名单**」，挡得住直白写法（本轮真实风险），
**挡不住刻意绕过**；但 **动态腿补上了这个缺口**（实测已证）。⇒ **两条腿必须同时跑，缺一不可**。
另外：`ollamaReachable` 这个禁词若被改名（如 `probe()`），静态核同样失效 —— 同一个缺口，不重复列。

**F3 旁证（不构成独立结论）**：把端点拆成 `['http://127.0.0.1','11434','api','tags'].join('/')` 时，闸报了红，
但红因是 **`node --test` 退出码 1**（F1 真去连、10.5s 超时失败），**不是**静态核命中。
⇒ 说明静态核漏抓时，**动态行为**仍会暴露它（`duration_ms: 10517` 是真网络超时的指纹）。

---

### G. 模型依赖面：`gate.mjs` 自报 4 vs 本席上轮 4 —— **一致**（裁定：一致）

`gate.mjs` 的 `census()`（L60–67）用正则 `if \(!\(await ollamaReachable\(\)\)\)` 计数。
实测输出：`b12-jev.test.mjs：11 条用例，其中 4 条以真模型可达为前置`。

本席上轮**独立**用**动态**方法（净网逐条 `--test-name-pattern` 矩阵）数得 **4/11**，集合 `{1,2,5,10}`。
本席本轮**再查静态**：`grep -n "ollamaReachable"` 命中 4 个调用点（L77/131/230/342），与 gate 的 4 一致。

⚠ **口径差异（两者恰好同数，但定义不同，须写清）**：
- 本席的 4 = 「**离线时真的变红**」（动态行为）——包含 **B1.2-10** 那条「前半段纯本地、后半段才真调」的用例；
- gate 的 4 = 「**文本里有 `ollamaReachable` 门**」（静态字面）——恰好也是这 4 条。
- **两口径重合是巧合式的**：若某条用例改用 `try{...}catch{fail}` 而非 `ollamaReachable()`，gate 会漏数而本席的动态法仍会数到。
  ⇒ **不要用 gate 的普查数替代动态计数**；它只是「不静默、如实报数」的参考读数，`gate.mjs` L97 自己也这么标注（"不代跑那只文件"）。

---

### 自报逐条裁定汇总

| # | 自报内容 | 裁定 | 证据 |
|---|---|---|---|
| 1 | 五件框架落地 + `sessionBudget` 缺省 200 | **真** | `src/framework.ts` L34–46 缺省全对；F1–F16 逐件断言 |
| 2 | `void config` 已删，六项 Config 进 `JevGuard` | **真** | `src/index.ts` L118–125；变异 A 即证（退回它 ⇒ 变红） |
| 3 | 16/16、两文件 27/27 exit 0 | **真** | 本席复跑，退出码直取 |
| 4 | 反证①：`unshare -rn` 下 16/16 | **真** | D 段；另加控制组证隔离有效 |
| 5 | 变异 6 组，组 6 ⇒ 9/16 | **部分可复现** | 本席变异 A ⇒ **15/16**（不是 9/16）；见下方说明 |
| 6 | 自建外部闸 + 自报 4/11 | **真（附一个可绕过形态）** | F 段控制组 + 变异；G 段一致 |
| 7 | `lib/` 曾落后，已 build 并自证 | **真** | `lib/framework.js` 17938 B 存在；`node -e "import('./lib/index.js')"` ⇒ `name=mana-jev inject=["mana-core"] Config? true`；`lib` mtime(21:24) 晚于 `src`(21:18) |

⚠ **关于 #5 的差异说明（不判红，如实报）**：本席复现的是**15/16**（只红 F14/F15），而施工席自报 **9/16**。
两者**测的不是同一个变异**：本席按主持人指定形态做的是「`apply()` 退回 `void config`」——
它只影响**装配面**那一条用例；施工席的「组 6」若同时改了别处（例如连同 `judgeWithGuard` 的护栏接线一起退回），
红的条数自然更多。**本席无法复现 9/16 这个具体数字，也无法看到它的变异脚本**（`scripts/` 下只有 `probe-model.mjs`，无变异脚本）
⇒ 该项标 **「部分未验证：9/16 这个具体数字未复现」**，但**不掩盖 A 的结论**：假旋钮**确实被抓住**。

### 本轮复核**未验证**（不凑数）

1. **M4/M5 在非缺省阈值下的独立性**：熔断阈值（5）/ 冷却（60s）两个旋钮，本席只在「熔断 2 次 / 冷却 30s」的 F16 上验证了它们可被观测；缺省值档位的独立判据未逐条跑。**未验证**。
2. **施工席变异组 1–5、组 6 的 9/16 具体数字**：无脚本可复跑（`scripts/` 无变异脚本），且 `git` 未跟踪 `tests/`。**未验证**。
3. **运行态装配**（真 profile 注入后探针行为）：不属本席只读面，且会碰 `~/.dsh/`。**未验证**。
4. **随机化/时序抖动的稳定性**：F9/F10 用 `sleep(20/60)` 做时序断言，在极慢机器上是否偶发不稳 —— 本席只单次复跑，**未做多次采样**。**未验证**。

### 本席对 `rd` 的最终裁定（一句话）

**解耦成立**：同一无网络条件下，框架判据 **16/16 绿**、适配判据 **红 4 条**（且 `skipped 0`，非静默跳过）——「框架好不好」与「模型好不好」现已各有独立证据面，这正是用户那句「先做好功能框架」所要的可分性。
**唯一保留**：「配置项真被消费」整轮只靠 **F14/F15 一条用例**守着（其余 15 条绕开 `apply()` 直接构造护栏）—— 建议加一条独立用例，避免单点。
