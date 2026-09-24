# 交接与回滚协议（G10 的产物）

> **G10 的成因**：方案 §12.4 行911「物理删除永不发生」+ §12.3 行904「插件重启后从 mana_trace 回放」。
> 后果：**卸载插件后 DB 行仍在**；再注入即**回放旧 trace**。执行者以为「卸载即回滚」
> ⇒ **回滚失败不可观测**。

## 每阶段回滚必须双层

| 层 | 动作 | 确认回滚成功的判据 |
|---|---|---|
| **插件层** | 卸载目标插件（fiber dispose） | 装配计数归零 **且** 反证判据成立：同一触发**不再产生新行** |
| **数据层** | 明示处置 DB 行（保留 / 归档 / 删除） | 逐项写出：`mana_trace` 行数、`inject_log` 行数、`jeva_log` 行数在回滚前后各是多少 |

⚠ **「卸载即净」只对插件层成立，对数据层不成立** —— 二者必须分开写，否则等于没写。

## 交接单（每席出口标准，6 段缺段即视为未交付）

```markdown
## S<n> · <包名> · 批次 <Bx.x>
- [ ] 交付文件：<逐条列绝对路径>
- [ ] 判据执行：<判据ID> · 命令 <原文> · 输出 <原文/退出码>
- [ ] 反证判据：卸载后同一触发不再产生新行 —— 实测结果 <原文>
- [ ] 回归自检：本次改动碰了哪些既有行为？凭什么确认它们仍成立？<一句话+证据>
- [ ] 未决项：<挂账清单，无则写「无」>
- [ ] 契约版本：已核 _freeze 三元组 @ <哈希前8位>
```

**为什么第 4 段不可省**：本仓明令「**不接受以文件在长为通过依据**」；
**碰了别的行为却不说 = 静默回归**，正是最该防的那类失败。

## 契约冻结三件套（A0-12）

```bash
# 哈希腿：契约唯一归属地的两个源文件
sha256sum packages/core/src/event-types.ts packages/core/src/domain.ts > docs/contract/_freeze.sha256
# 清单腿：**全部源文件**（⚠ 必须排 lib/：它是 tsc 构建产物且被 .gitignore 忽略，
#   纳入清单会让清单随「有没有 build 过」漂移 —— 实测排与不排 = 35 vs 57 件）
find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/lib/*' | sort > docs/contract/_freeze.files.txt
git rev-parse HEAD > docs/contract/_freeze.head
```

> ⚠ **为什么清单腿要排 `lib/`**（本仓 2026-09-24 实测）：`packages/*/lib/` 是 `tsc` 产物、
> 已进 `.gitignore`。若纳入清单，**「跑没跑过 build」会改变清单内容**，而清单的意义是
> 「源码面有无变动」—— 让构建产物参与就是不稳定的真源。且旧清单正是 `find` 忘了排 `lib/`
> 的产物，7 个会话各自撞到它并标记「清单腿已漂，待 S0 收口」。

**三条腿都必须被机检真正读取**（A0-12）：只存不验 = 漂移不可见。历史缺陷正是
「`_freeze.sha256` 只哈希 2 个硬编码文件、`_freeze.files.txt` 与 `_freeze.head` 全仓无人读」⇒
清单漂了 25 行（10 → 35）**没有任何判据报警**。现 A0-12 同时校验哈希腿、清单腿与 HEAD 腿。

**变更协议**：改契约的那一席独占 `packages/core` → 追加 `docs/contract/CHANGELOG.md` 一行
→ **重取三件套，旧值存档不覆盖** → 各席跑 `npm run typecheck`（**编译期报错即适配清单**）。
> **为什么靠编译器而不是靠通知**：`core` 独占契约后，改一个事件签名**必然**产生全量编译错误
> —— 编译器就是最可靠的「通知各组」，别自建通知机制。


---

## 装配面实测约定（2026-09-24 补 · S0 席踩坑记录）

> 以下各条都是**本仓实测踩出来的**，写在这里以免每席各踩一次。

| # | 现象 | 真因 | 约定 |
|---|---|---|---|
| 1 | 注入后 `host ✗` | 入口指向 `src/index.ts`；宿主以 `node /usr/local/bin/dsh web` 启动，**不带类型剥离开关** | `main`/`exports` 指向 `lib/`；**改完源码必须 `npm run build` 再注入**。生态既有插件全部如此（shoucang / roundtable / motion / super-injector） |
| 2 | `dev_uninject_plugin` 后重新注入失败 | 卸载时写入 `- id: <pkg> / disabled: true`（防 refresh 加回的阻断项），它**同时挡住重新注入** | 重装前先删该条；v0.3.3 的注入器**不**自动移除 |
| 3 | `loader.create(...)` 看起来成功但插件没起来 | 它**立即返回字符串 id**，真正的模块加载与 fiber 激活是**异步**的 | **装配判据 = 服务是否可读**（`ctx.get(name)`），**不是调用是否抛错** |
| 4 | 判据脚本在卸载后崩 `database is not open` | **卸载即净生效了** —— core 关闭了自己的库句柄 | 判据读行数一律用**独立只读连接**，不要复用插件句柄 |
| **5** | **`host ✗` 的第二条真因（2026-09-24 定位，非注入器缺陷）** | **注入的 profile ≠ 宿主运行的 profile**。`dev_inject_plugin` 把 junction 建在 **`web`**，而活体宿主跑的是 `node /usr/local/bin/dsh --profile system --port 3088`（`cwd=/home/lk/.dsh/profiles/system`）⇒ 插件从未被宿主加载过。**这不是误报，`host ✗` 是正确报告。** | **判装配前先核宿主跑的是哪个 profile**：`ps -o cmd= -p <pid>` + `readlink /proc/<pid>/cwd`。注入器**只写它认定的 profile**（`~/.dsh/profiles/<name>/node_modules`），若宿主用别的 profile 启动，装了也白装。要真生效须满足二者一致（改宿主启动参数，或把插件装到宿主实际使用的 profile）。 |

**第 5 条的实测证据**（同插件、两个 profile，唯一变量是 profile）：

```
$ node probe: loader.create({name:'dsh-mana-core'}) 在各自 profile 的 baseUrl 下
web      mana-core 可读: ✅ 是
system   mana-core 可读: ❌ 否          ← 宿主实际使用的 profile

$ ps -o cmd= -p 2024
node /usr/local/bin/dsh --profile system --port 3088 --no-open
$ readlink /proc/2024/cwd
/home/lk/.dsh/profiles/system
$ ls /proc/2024/fd | grep -c mana.db
0                                        ← 宿主根本没打开过 mana 库
```

> ⚠ **教训**：早前把这条记为「注入器 `hasActiveEntry` 有 bug」（`host ✗` / `[no-fiber]`），
> 并在 `docs/handoff/S0.md` 的未决项里挂账 —— 那是**归因错误**。真因在**观测面**：
> 判据问的是「插件在你注入的 profile 里活了吗」，而该问的问题本是
> 「**宿主正在跑哪个 profile，那里的插件活了吗**」。同一现象在错误的观测面上
> 永远只能得到「未解决」。定位方式：`ps` + `/proc/<pid>/cwd`（不是读文档、不是猜注入器）。

**另一条**：`ctx.loader.entries` 是**方法**（`entries()`）不是数组；`group.remove(id)` 收的是 **entry id**。

### 判据必须自足

`tools/r0-assembly-check.mjs` 的 baseUrl 指向**本仓**（`npm workspaces` 已建好 `node_modules/dsh-mana-* → packages/*` 链接），
**不依赖 profile 里的 junction**。早前指向 profile 时，一旦有别的步骤清掉 junction，R0 会以「装配 0/6」失败 ——
那是**判据自身的环境依赖**，不是被测对象的缺陷。
