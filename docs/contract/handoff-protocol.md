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
sha256sum packages/core/src/event-types.ts packages/core/src/domain.ts > docs/contract/_freeze.sha256
find packages -name '*.ts' -not -path '*/node_modules/*' | sort > docs/contract/_freeze.files.txt
git rev-parse HEAD > docs/contract/_freeze.head
```

**变更协议**：改契约的那一席独占 `packages/core` → 追加 `docs/contract/CHANGELOG.md` 一行
→ **重取三件套，旧值存档不覆盖** → 各席跑 `npm run typecheck`（**编译期报错即适配清单**）。
> **为什么靠编译器而不是靠通知**：`core` 独占契约后，改一个事件签名**必然**产生全量编译错误
> —— 编译器就是最可靠的「通知各组」，别自建通知机制。


---

## 装配面实测约定（2026-09-24 补 · S0 席踩坑记录）

> 以下四条都是**本仓实测踩出来的**，写在这里以免每席各踩一次。

| # | 现象 | 真因 | 约定 |
|---|---|---|---|
| 1 | 注入后 `host ✗` | 入口指向 `src/index.ts`；宿主以 `node /usr/local/bin/dsh web` 启动，**不带类型剥离开关** | `main`/`exports` 指向 `lib/`；**改完源码必须 `npm run build` 再注入**。生态既有插件全部如此（shoucang / roundtable / motion / super-injector） |
| 2 | `dev_uninject_plugin` 后重新注入失败 | 卸载时写入 `- id: <pkg> / disabled: true`（防 refresh 加回的阻断项），它**同时挡住重新注入** | 重装前先删该条；v0.3.3 的注入器**不**自动移除 |
| 3 | `loader.create(...)` 看起来成功但插件没起来 | 它**立即返回字符串 id**，真正的模块加载与 fiber 激活是**异步**的 | **装配判据 = 服务是否可读**（`ctx.get(name)`），**不是调用是否抛错** |
| 4 | 判据脚本在卸载后崩 `database is not open` | **卸载即净生效了** —— core 关闭了自己的库句柄 | 判据读行数一律用**独立只读连接**，不要复用插件句柄 |

**另一条**：`ctx.loader.entries` 是**方法**（`entries()`）不是数组；`group.remove(id)` 收的是 **entry id**。

### 判据必须自足

`tools/r0-assembly-check.mjs` 的 baseUrl 指向**本仓**（`npm workspaces` 已建好 `node_modules/dsh-mana-* → packages/*` 链接），
**不依赖 profile 里的 junction**。早前指向 profile 时，一旦有别的步骤清掉 junction，R0 会以「装配 0/6」失败 ——
那是**判据自身的环境依赖**，不是被测对象的缺陷。
