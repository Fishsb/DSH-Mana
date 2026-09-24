# Mana 环境前提（Phase 0 基线）

> **本档的定位**：`A0-1` 说「**DSH 版本必须记录在案**」，并规定退回动作是「停止阶段 0，先报环境变更」。而两册的「实测」全部产自 **Windows 侧**（`D:\Mana` + `C:\Users\lk\.dsh-win`），项目现已在 **WSL**。**本档是那份「记录在案」的现役版本**——方案册里的环境段应视为历史快照。
> **每条带复验命令**，且**全部于 2026-09-24 在本机实跑**。凡未跑过的写「未验证」，不写推测值。
> **读法**：要开工前核对 → 跑 §六 一把梭；要查某项为什么是硬前提 → 看 §一的「如果错会怎样」。

---

## 一、平台与环境（**新前提，两册完全没写**）

| 项 | 实测值 | 为什么是硬前提 |
|---|---|---|
| 发行版 | **Ubuntu 26.04.1 LTS**（WSL2，内核 `6.18.33.2-microsoft-standard-WSL2`） | 两册的可粘贴命令全是 **PowerShell**（`$LASTEXITCODE`、`Test-Path`、`Measure-Object`）⇒ **全部不可直接执行** |
| CPU / 内存 | 12 vCPU · 15 GiB（available 14 GiB） | JEV 并发上限 4、50 fan-out 实测的前提 |
| **项目根** | `/home/lk/Mana`（**ext4**，`/dev/sdd`，余 **950G**） | `D:\Mana` 是它的**软链**（`readlink -f` 验证）⇒ 在 Windows 侧编辑即改 WSL 文件 |
| **`DSH_HOME`** | **`/home/lk/.dsh`**（**ext4**） | `mana.db` 落 `$DSH_HOME/memory/` ⇒ **数据库在 ext4，不在 9p** |
| `/mnt/d`（治理根、既有件） | **9p** 文件系统（`aname=drvfs;cache=0x5`） | 9p 是网络式 FS；跨设备语义与 ext4 不同 |
| 时区/区域 | 见 `date` | 阶段 3 的「每日凌晨 3 点」巩固定时依赖本地时区 |
| systemd | `true`（`/etc/wsl.conf`） | 服务化/开机自启可用 |

**⚠ 三条由此产生的环境危险（两册未覆盖）**

1. **行尾**：`.gitattributes` 为 `* -text`（禁止任何行尾改写），而 `mana-rollout-plan.md` 是 **CRLF**。跨 Windows/WSL 编辑必须保住行尾，否则**污染 sha256 对账**（册的检查器按 `\r?\n` 切分）。
2. **跨盘访问成本**：`/mnt/d`（9p）上做 `npm install` 或大量小文件 IO 会显著慢于 ext4。**Mana 项目根在 ext4 上，这个坑天然避开了**——但若误把工作区建在 `/mnt/d` 下就会踩。
3. **`~/.dsh` ≠ `/mnt/c/Users/lk/.dsh`**：见 §三（双 DSH 并存）。

---

## 二、工具链（逐项实测）

| 工具 | 实测 | 册中记载 | 判定 |
|---|---|---|---|
| `node` | **v22.22.1** | 要求 `v22.22.0`（`册:336`） | ⚠ **漂移**：按「逐字相等」执行会**假红** |
| `npm` | **11.19.1** | `10.9.4`（`册:70`、`册:732`） | 漂移（结论不受影响） |
| `pnpm` | **12.4.2**（真二进制 `/usr/local/bin/pnpm`） | **「不存在」**（`册:70`、`册:328`、`册:732`） | ⚠ **已被推翻**：C1 的决策证据失效 |
| `corepack` | 0.24.0 | `0.34.0`（`册:70`） | 漂移 |
| `git` | 2.53.0 | 未记 | — |
| `python3` | **3.14.4**（存在） | 「`uv`/`python` 均未找到」（`册:179` G13） | 漂移（G13 结论已被 Ollama 方案取代，不影响） |
| `uv` | **不存在** | 不存在 | ✓ 一致 |
| `sqlite3` CLI | **不存在** | 未记 | 需用 `node:sqlite` 代替（方案本就如此） |

### 2.1 `node:sqlite`（阶段 0 的核心依赖）

```
导出（逐字）：DatabaseSync,StatementSync,constants,backup     ← 与册:336 声明逐字相符 ✓
实验态：ExperimentalWarning: SQLite is an experimental feature and might change at any time
```
> ⚠ **实验态警告两册都没记**。它意味着 `node:sqlite` 的 API 可能在**补丁版本间变动**——这正是 `A0-1` 要锁版本的原因，也说明 `engines.node` **不宜精确钉死单点**（见检查报告 L1-2）。

### 2.2 `node:test`（册 C3 的选型依据）

实测可用（`node --test` 正常执行）。册 C3 结论「本机无 `vitest` ⇒ 用 `node:test`」**依然成立**（`vitest` 实测 `MODULE_NOT_FOUND`）。

---

## 三、DSH 宿主（**三处复账**）

册 §2.1 纪律 3 要求核对三处版本是否一致。实测：

| # | 位置 | 版本 | 备注 |
|---|---|---|---|
| ① | `/usr/local/lib/node_modules/@deepseek-ai/dsh` | **`0.1.7-rc.1`** | `dsh` 命令实际来源（`/usr/local/bin/dsh`） |
| ② | `~/.dsh/profiles/*/node_modules` | 无 `@deepseek-ai/dsh` | profile 里装配的是插件与 `cosmokit`/`schemastery` |
| ③ | 全局 npm | **`0.1.7-rc.1`** | 与 ① 同 |

**结论：本机三处一致（①=③），不同于册中记载的「三处并不一致」。**

| 项 | 实测 | 册中记载 |
|---|---|---|
| DSH | **`0.1.7-rc.1`** | `0.1.5-rc.2`（`册:191`） |
| cordis | **`4.0.4`** | 本机 `4.0.2`、0.1.7 要求 `~4.0.4`（`册:196`） |
| npm `latest` 通道 | **`0.1.5-rc.3`** | 同（`册:192`） |
| profiles | **`headless` / `system` / `web`**（+`node_modules`） | `desktop` / `headless` / `web`（`册:379`）⇒ ⚠ **无 `desktop`** |
| 现役进程 | `dsh web --port 3080`（pid **30154**） | — |

> ⚠ **DSH 已经升到 `0.1.7-rc.1`**，而册明确建议「阶段 0–1 期间留在 `0.1.5-rc.2`」（`册:216`）。**该建议已被现实越过**——须按 `册:211` 的「升级 = 重跑受影响判据」执行，不是重写全册。

---

## 四、依赖服务

### 4.1 Ollama（**阶段 1 的两个核心依赖都在这上面**）

| 项 | 实测 |
|---|---|
| 版本 | **`0.34.3`**（`/api/version`） |
| 可达地址 | **`http://127.0.0.1:11434`** |
| 在哪一侧 | **Windows 侧**（WSL 内无 ollama 进程；`127.0.0.1` 直达是靠 **`.wslconfig` 的 `networkingMode=mirrored`**） |
| 模型数 | **17 个** |

**关键模型（方案的两个硬依赖）**

| 模型 | 实测 | 用途 |
|---|---|---|
| `bge-m3:latest` | ✓ 1158 MB | 嵌入（方案 §7.3） |
| `qwen3.5:0.8b` | ✓ 1036 MB | JEV logprob 载体（册 C8） |

### 4.2 ✅ **已闭合：宿主进程内 `fetch` 打 11434**（册 §7 未验证项 1）

册 §7 第 1 条挂了 6 天的未验证项——**为什么未验证**：「无法把代码注入运行中的宿主进程」。本轮**用 staging 后侧工具在宿主进程内取证**（`dev_stage_add` → 宿主执行 → 已自行清理）：

```json
{"version_http":200,"version":"0.34.3","embed_http":200,"embed_dim":1024,
 "pid":30154,"dsh_home":"(unset)","proxy_env":"http://127.0.0.1:10808"}
```

**⇒ 宿主进程内（pid 30154）`fetch` 打 11434 通，嵌入 `dim=1024`。该未验证项可以关闭。**
副产品：`DSH_HOME` 在宿主进程内**未设置**（`(unset)`），而 shell 里是 `/home/lk/.dsh`——插件取路径时**不能依赖父进程环境**，这也解释了注入器为什么要写「DSH_HOME 优先，homedir 推导会错位」。

### 4.3 网络与代理（**新前提，两册没写**）

```
http_proxy/https_proxy = http://127.0.0.1:10808   （v2rayN/xray）
no_proxy 含 127.0.0.1, localhost, 192.168.*, 10.* …
NODE_USE_ENV_PROXY = 1
```
- 来源：`.wslconfig` 的 **`autoProxy=true`**，由 WSL 注入，**非 shell 配置**（不写进 `.bashrc`）。
- **`no_proxy` 覆盖 `127.0.0.1`** ⇒ Ollama 访问**不走代理**，这是它能通的原因。
- 实测：GitHub 直连 `200`；`git ls-remote` 到 `Fishsb/dsh-shoucang-memory` **成功**（`exit=0`）⇒ 册 C15「优先 clone」**成立**。
- 实测：`npm view @deepseek-ai/dsh version` → **`0.1.5-rc.3`**（registry 可达）。

---

## 五、既有件与装配面（Mana 的复用/共存对象）

### 5.1 现役插件（`~/.dsh/profiles/web/node_modules`）

| 包 | 版本 | 与 Mana 的关系 |
|---|---|---|
| `dsh-shoucang-memory` | **0.3.1** | **直接复用对象**（`lib/vec.js` 三个导出）＋ **G9 冲突对象**（争 `agent/pre-step`） |
| `dsh-plugin-roundtable` | — | 样板仓（tsdown 双 entry） |
| `dsh-prompt-enhancer` / `dsh-free-search` / `dsh-edit-diff` / `dsh-better-sidebar` / `dsh-client-auto-continue` | — | 无关，但同进程装配 |
| `@dsh-external/dsh-super-injector` | **0.3.3** | R0 反证判据要用 `dev_*` 工具链 |
| `@dsh-external/project-nav` / `@dsh-external/dsh-motion` | — | 治理/UI |

### 5.2 ⚠ 双 DSH 并存（**新发现，两册没写**）

| | WSL（**现役**） | Windows（遗留） |
|---|---|---|
| `DSH_HOME` | `/home/lk/.dsh` | `C:\Users\lk\.dsh` |
| 注入器 registry | **不存在**（无注入记录） | `registry.json` 有 1 条（`dsh-frozen-injection`，2026-09-17） |
| 日志 | `self-heal.log` 11 KB | `self-heal.log` 134 KB + `.1` 1 MB |

⇒ **Windows 侧是历史遗留，查既有件时勿误读**。`dev_injected_list` 实测「无注入记录」，与 WSL registry 不存在一致。

### 5.3 G9 冲突面（实测复核）

`agent/pre-step` 在 shoucang `lib/` 下**共 12 处**提及，**真实注册点 2 个**（`panel-inject.js:773` 的 `hook.on`、`mcl.js:372` 的 `ctx.on`）——**与册 §2 G9 描述一致 ✓**。现役 shoucang 实例在跑（同进程）。

### 5.4 G8 行锚 ⛔ **册引错 23 行**

册称 `lib/vec.js:254` 是 `catch { return null }`。实测 **254 行是 `try {`**，真 catch 在 **277–279**：
```
277 |     catch {
278 |         return null;
279 |     } // 网络/超时/格式 → 词法降级，闭环不中断
```
语义结论不变，**位置必须更正**，否则下轮按 254 取证会取到 `try {`。

---

## 六、一把梭复验（**开工前跑这个**）

```bash
echo "— 平台 —"; uname -r; . /etc/os-release && echo "$PRETTY_NAME"; nproc; free -g | head -2
echo "— 工具链 —"; node -v; npm -v; pnpm -v; git --version
node -e "const s=require('node:sqlite');console.log(Object.keys(s).join(','))"
echo "— DSH —"; dsh --version
node -e "console.log(require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version)"
node -e "console.log(require('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/package.json').version)"
ls ~/.dsh/profiles/
echo "— 服务 —"; curl -s http://127.0.0.1:11434/api/version
curl -s http://127.0.0.1:11434/api/tags | grep -o 'bge-m3:latest\|qwen3.5:0.8b' | sort -u
echo "— 文件系统 —"; df -T /home/lk/Mana ~/.dsh /mnt/d | tail -3
echo "— 网络 —"; env | grep -i proxy | head -3; timeout 12 git ls-remote --heads https://github.com/Fishsb/dsh-shoucang-memory | head -1
echo "— 既有件 —"; ls ~/.dsh/profiles/web/node_modules/dsh-* -d
echo "— G8 行锚 —"; sed -n '277,279p' /mnt/d/FF/shoucang/lib/vec.js
```

**期望**：§二/§三/§四 的表逐项对上。**任一项变** = 环境已漂，按 `A0-1` 退回动作**先报环境变更**，不要带病开工。

---

## 七、对阶段 0 的直接影响（**这才是本档的目的**）

| # | 前提 | 影响 | 处置 |
|---|---|---|---|
| 1 | **平台 = WSL，两册命令全是 PowerShell** | `册` 里所有「可粘贴命令」**不可执行** | 阶段 0 须**产出 Linux 版命令集**（这是一项**两册都没有的交付物**） |
| 2 | `node v22.22.1` ≠ 册要求的 `v22.22.0` | `A0-1` 按「逐字相等」**假红**；`engines.node=22.22.0` + `engine-strict` ⇒ **EBADENGINE**（已实测） | 改 `^22.22.0`，真判据用「`node:sqlite` 四项导出逐字相等」 |
| 3 | `pnpm` 存在 | C1 决策证据失效（**结论仍成立**：单仓 + workspaces 因磁盘与 `core` 共享） | 保留 C1 结论，**订正其证据句** |
| 4 | DSH 已是 `0.1.7-rc.1` | `册:211` 的 V-1/V-2/V-3 须**复跑** | 已代跑 V-1 一项（G6：cordis 4.0.4 上**同步监听器仍抛**；**async 监听器转 unhandledRejection**⇒ 比册描述的更隐蔽）；V-2（`ctx.agents` 仍在）✓；V-3 待阶段 1 |
| 5 | `DSH_HOME` 宿主进程内 `(unset)` | 插件取路径不能依赖父进程环境 | 阶段 0 的存储路径须**显式推导 + 落盘可查** |
| 6 | 宿主 fetch 打 11434 **已实证可通** | 册 §7 未验证项 1 **可关闭** | 从「未验证」移入「已实证」 |
| 7 | `mana.db` 在 **ext4**（非 9p） | SQLite WAL/锁**行为正常**（已实测：ext4 与 9p 的 `busy_timeout` 均按 2000ms 生效，**无平台差异**） | 无需为 9p 做特殊处理 |

---

## 八、仍未验证（**保持标注，不得升格**）

| # | 项 | 为什么仍未验证 | 由谁可解 |
|---|---|---|---|
| 1 | `A0-11` 独立心跳的**写入方** | 心跳必须由 Mana 之外的东西写；写入方（宿主脚本 vs 插件）与权限面未定 | 阶段 0 设计时定 |
| 2 | 阶段 3 巩固定时「凌晨 3 点」的**时区/触发机制** | 依赖调度器设计，尚无实现 | 阶段 3 |
| 3 | `dsh-memory` 的**归属**（npm vs GitHub 同名仓库） | 方案未指明指哪个（册 §7 第 9 条） | 用户澄清 |
| 4 | V-3（`interpolate` / `defineTool` 归一化）在 0.1.7 上的实际行为 | 需阶段 1 的注入块组装代码才能测 | 阶段 1 |

---

`nav_graph mode="health"` 状态摘要：本次为**只读盘点**，未改动 `docs/` 既有档（`plan-review-2026-09-24.md` 与 `session-allocation.md` 保持原样，仅本档新增）。
