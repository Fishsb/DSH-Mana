# 评估器的模型通道：本地 / 云端（缺省云端）

> 用户指令原文：「评估器的模型通道**本地与云端都要有**，**切需要在 UI 让用户设定**，**当前默认用云端**」。
> 落地：卡 `t-mujxaj57-2tekce`。实现面：`tools/eval-l1-l4.mjs` · `packages/ui/src/{panel,store,index}.ts` ·
> `packages/ui/src/client/index.ts`。判据：`packages/ui/tests/channel.test.mjs`。

## 1. 怎么切（三档，优先级从高到低）

| 方式 | 怎么写 | 说什么 |
|---|---|---|
| 命令行（本次） | `node tools/eval-l1-l4.mjs --online-judge --channel local` | 只影响这一跑，**不改任何配置** |
| UI（持久） | 面板里选「模型通道」 | 落 `user_model`，**下次跑评估器照样生效** |
| 缺省 | 什么都不做 | **cloud**（用户指令） |

⚠ 「不改代码切回 local」的落点就是第一/第二行：通道名是一个**数据**，不是编译期分支。

## 2. 两条通道的形状（**唯一归属地**：`packages/ui/src/panel.ts` 的 `CHANNEL_ROUTES`）

| 通道 | jev `channel` | 端点 `base` | 缺省模型 | 凭据 |
|---|---|---|---|---|
| `local` | `ollama` | `http://127.0.0.1:11434` | `qwen3.5:0.8b` | 无 |
| `cloud` | `systemone` | `https://nano-gpt.com` | `jev-1.13` | 环境变量 `NANOGPT_API_KEY` |

评估器、UI 端点、渲染面**读的是同一份**：评估器按**路径**动态 import `panel.ts` 的 `resolveChannel`。
判据 CH⑦ 机检这一点 —— 判定若被复制成两份，UI 存 A、评估器跑 B，而两边读数**同形**（都只印一个通道名）。

### ⚠ 端点串的坑（本卡实测，已机器化拦住）

代码是 `{base} + SYSTEMONE_DEFAULT_PATH`（`packages/jev/src/systemone.ts:58` = `/api/v1/systemone`）。
⇒ **base 必须传 `https://nano-gpt.com`**。传成 `https://nano-gpt.com/api/v1` 会拼出
`/api/v1/api/v1/systemone`，症状是「云端不可用」—— 会被顺手归因成 KEY / 网络问题（**归因反向错位**）。
评估器在 `cloud` 下跑之前会**读源码取那个常量**做一次预检（`probeCloudUrlShape`），不对就当场停。

## 3. 读数在哪看「用了哪条通道 + 哪个模型」

三处，**互不替代**：

1. **banner**（stdout 第一行）：`模型通道：cloud · 模型 jev-1.13 · 端点 … · 来源 default(缺省) · 凭据(NANOGPT_API_KEY)=true`
2. **每层 detail 的 `pre`**（L2 无论落哪一态都印）：`通道=cloud（模型 jev-1.13·来源 default）｜…`
3. **`--json` 的 `report.channel`**：机器可读，含 `source` / `credentialPresent`（**只回布尔**）。

`source` 三态**不同形**（本仓最忌同形）：

| `source` | 含义 | 谁会看到 |
|---|---|---|
| `user` | 用户在 UI 里设的 | 面板写成功后 |
| `default` | 没人设过 ⇒ 缺省 cloud | 全新环境 |
| `invalid-fallback` | 存量是非法值，已回落缺省（原值随 `storedValue` 回显） | 外部写入 / 版本漂移 |

## 4. 云端不可用时：`env-unavailable`，**不裸红**

新增 **L0 层**（模型通道可用性）：一枪**真调用**（`judgeGuarded`，它才跟 `config.channel` 走）验通道。
落态口径照抄 `docs/mana-endpoint-attribution.md` §2：

| 情形 | 落态 | 退出码 | 文案给的下一步 |
|---|---|---|---|
| 真调用拿到判定 | `MEASURED` | 0 | — |
| **无凭据 / 连不上 / 超时** | **`NO_DATA`** | **2** | 查 `NANOGPT_API_KEY`（`source ~/.dsh/secrets/nanogpt.env`）· 查网络能否到 `https://nano-gpt.com`。**明说这不是被测代码的问题** |
| 环境在场、应答形状不对 | `FAIL` | 5 | 查被测面 |

⇒ 「不得默认红到底」的落点就是**第二行**：`NO_DATA` 是「这一次没测成」，`FAIL` 是「行为不对」，
两者**不同形**，退出码也不同（2 vs 5）。

## 5. 凭据纪律（硬约束）

· key **只从环境变量读**：评估器把它写成**变量名**（`systemoneApiKeyEnv`）交给 jev，程序从不持有它的值；
· 读数只回**布尔** `credentialPresent` 与**变量名**，**不回 key、连前缀都不回**；
· 判据 CH⑥ 用**运行时真值反证**（不把任何凭据字面量写进测试文件 —— 写进夹具等于把纪律改写成「别让它出现在别处」）；
· 提交前自查：`git diff | grep -c 'sk-nano'` ⇒ **0**。

## 6. 一处实现细节：为什么 UI 包里有个「评估器通道」

按常识它该在 `tools/` 里。放 UI 包的理由是**判定归属唯一**：用户设置由 UI 写、由 UI 读，
评估器只是**消费者**。若评估器自己也判一遍（例如「环境变量优先」），就出现两个判定点，
而分叉的表现是「我在面板里选了 local，评估器还跑 cloud」—— 两边读起来都只是`一个通道名`。
`resolveChannel` 是纯函数（零 IO、零 node 依赖），因此可以直接被断言（CH①/CH③）。

## 7. 已知边界（如实记，不当作通过）

· **L0 的真调用是`探针`**：它证明通道此刻可用，**不**替代 L3 的链内往返读数（两者分列，不得互相冒充）；
· **非选中腿不真调用**：`--channel local` 时不会去打云端（省一次出网），故那一跑**只有一条腿**有真读数；
· **偏好只在评估器进程启动时读一次**：面板里改了设置后要**重跑**评估器才生效（不热加载）；
· 面板已挂上并持久化，但**本卡未做浏览器端到端**（渲染树判据 CH⑤ 覆盖到`选择框与三态`，未覆盖真实点击 → 宿主往返）。