# 复用件清单（G12 的产物 · 三分法，禁跨通道混用）

> **纪律**：npm registry / GitHub API / 本机目录是**三条取证通道，结论不同** ⇒
> **混用会得出相反结论**（实测：某包在 npm 上 E404，在 GitHub 上实存）。
> 另：**GitHub 搜索通道返回空不得当作「不存在」的证据**（搜索返回空而 API 逐仓库求证实存，二者结论相反）。

| 档 | 包 | 版本 / 证据 | 取件方式 | 本项目是否采用 |
|---|---|---|---|---|
| **① 本机已装** | `dsh-shoucang-memory` | **v0.3.1**，`~/.dsh/profiles/web/node_modules/dsh-shoucang-memory`（WSL 实存），Apache-2.0 | 目录即用 | ⚠ **只作行为对照**（`lib/vec.js` 的 `cosine`/`embedMany`/`recallRanked` 可借鉴算法）。**它是 `link:` 装配的活跃开发树，非只读件，禁止写入** |
| **② npm 可得** | `dsh-memory` | 0.1.0 | `npm i` | ❌ **不采用**：包内仅 5 文件，`grep vec0/sqlite-vec/rrf/cosine/bm25` **零命中**，是**纯 FTS5 词法件**，与方案描述逐字不符 |
| | `dsh-graphmemory` | 0.2.0，3.62 MB | `npm i` | ❌ 其 `peerDependencies` 含本机不可用的平台包 |
| | `dsh-memoria` | 0.1.0 | `npm i` | ❌ README 自述「owns one long-lived **Python subprocess**」，与「零外部依赖」冲突 |
| **③ npm 无、GitHub 有** | `dsh-memory-jev` | npm **E404**；GitHub `Towzai/dsh-memory-jev` **v0.4.1**，MIT | **clone / API 逐文件** | ✅ **作参考实现**：三道门控与方案 §6 **逐条同构**；`tools/fake-jev.mjs`（零网络、确定性、含 4 种失败模式注入）**可直接复用于阶段 1 降级链测试** |
| | `dsh-shoucang-memory` | npm E404；GitHub `Fishsb/dsh-shoucang-memory` **public**，Apache-2.0，**105 个 TS 源文件** | 同上 | ✅ 有 TS 源可取（不必只搬 `lib/*.js`） |

## 取件通道与前置（实测）

- `git clone` **依赖环境代理**（`http_proxy`/`https_proxy` = `http://127.0.0.1:10808`，WSL autoProxy 注入）。
  实测：**带代理** clone 成功（210 个 TS 文件）；**清空代理变量后 clone 超时**。
  ⇒ 取件策略：**优先 clone**；失败先确认代理变量存在并重试，再回退 **API 逐文件**。
- 早前一次「443 不通」的判定系**瞬时抖动**所致，**已撤销**（属「单次采样不可作决策依据」的实例）。
