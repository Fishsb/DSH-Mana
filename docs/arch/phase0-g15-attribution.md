# G1–G15 先决阻断项归属表（A0-13 的比对基准）

> **来源**：《落地册》§2 的 G1–G15。**拍板记录（2026-09-24）**：G1–G15 **全数纳入阶段 0 硬门槛**
> ⇒ **阶段 0 完成的定义 = 15 条每条都有产物、或显式挂账并写明挂到哪个阶段**。
> **纪律**：**不得以「已在正文提过」代替归属**。`✅` = 阶段 0 有对应产物；`⏳` = 显式挂账。
>
> 口径：产物一律给**可复算的路径/表名/判据 ID/命令**，不接受「已处理」这类表述。

| G | 一句话 | 状态 | 阶段 0 归宿（产物 / 挂账） |
|---|---|---|---|
| **G1** | 性能数字跨采样浮动 1.2–13 倍，绝对毫秒不可作阈值 | ✅ 产物 | `docs/contract/threshold-discipline.md`（三档分档规则：A 档确定性值可进阈值列 / B 档浮动量只进测量条件） |
| **G2** | 方案 §14「检测方式」列 0 真信号 | ✅ 产物 | `docs/arch/spec14-observability-map.md`（10 条逐条落点；真信号 3 / 半真 5 / 不可观测 2）+ A0-9 机检 |
| **G3** | I1/I2 不变式无可数之处（六表无 `session_id`/`turn_id`） | ✅ 产物 | `packages/core/src/schema.ts`：`mana_trace`/`memory_items`/`jev_log` 补两列；A0-8 机检（`tools/probes/a08-schema.mjs`） |
| **G4** | `node:sqlite` 扩展加载窗口不可后补 | ✅ 产物 | `packages/core/src/db.ts#openManaDb()`（唯一写点，一律 `{allowExtension:true}`）+ A0-2 负向判据（默认 ctor 必须抛错） |
| **G5** | 中文 FTS5 静默归零（MATCH 命中 0 且与库空同形） | ✅ 产物 | `schema.ts`：`memory_items_fts` 显式 `tokenize='trigram'` + `MIN_QUERY_CHARS=3` 显式拒绝 + A0-3 负向判据 |
| **G6** | 方案 §9.4 用 `emit` 分发 waterfall 契约（死契约） | ✅ 产物 | `event-types.ts` 声明 `mana/jev/judge` 为 `@mode waterfall` 并写明「必须用 `ctx.waterfall`」；关联键统一 `requestId`（I-6） |
| **G7** | `busy_timeout` 默认 0 / 无事务封装 | ✅ 产物 | `db.ts`：开库即设 `busy_timeout`（可读回取证）+ `withImmediateTransaction()` 手写 `BEGIN IMMEDIATE`/`ROLLBACK`；`tests/core.test.mjs` 有「报错必须回滚」实测 |
| **G8** | 静默降级先例（`catch { return null }`） | ✅ 产物 | `docs/contract/degradation.md`：降级必须落显式字段；`domain.ts` 的 `ManaDecision.degraded/reason`、`probability: number \| null`（**不得用 0 冒充**） |
| **G9** | Mana 与 shoucang 争同一 `agent/pre-step` waterfall | ✅ 产物 | `index.ts#registerPassThroughPreStep()`（骨架第一天起就调 `next()`）+ 集成测试「六插件各自注册且都调用 next()」（末端哨兵可达 = 链条未被吞） |
| **G10** | 卸载 ≠ 数据回滚 / 回放复活旧状态 | ✅ 产物 | `docs/contract/_freeze.sha256`（契约快照哈希，A0-12）+ `docs/contract/handoff-protocol.md`（每阶段**双层**回滚：插件层 + 数据层） |
| **G11** | 装配清单 ≠ 生效，空壳与真插件同形 | ✅ 产物 | R0 反证判据（卸载后同一触发不再产生新行）**且 attention 骨架真写行**（否则反证平凡通过）；`tests/skeleton.test.mjs` 含「空壳平凡通过」对照用例 |
| **G12** | 「直接复用」承诺不实 + 复用件须分三档 | ✅ 产物 | `docs/contract/reuse-inventory.md`（三分法：本机已装 / npm 可得 / npm 无但 GitHub 有），禁跨通道混用 |
| **G13** | JEV 承载方式未定 | ✅ 已拍板 | 走**本机 Ollama logprob**（`qwen3.5:0.8b` + `think:false` + `num_predict=1`）；不用 OpenRouter 云通道（无 key）；`packages/jev` 配置面已留 `maxConcurrency` 等参数 |
| **G14** | §6.4 Top-50 fan-out 与 `<500ms` 目标脱节 | ⏳ 挂账 | **挂账到阶段 1 · B1.2**（并发策略：分批 + 早停 + 预算）；阶段 0 已在 `packages/jev` 的 `Config.maxConcurrency`（缺省 4）预留落点 |
| **G15** | 存储目录与资源上限未定 | ✅ 产物 | `~/.dsh/memory/` 已建并实测（`mana.db` 98304 B、`mana.heartbeat`）；`core` 的 `resolveStorePath()` 以 `$DSH_HOME` 解析 |

## 机检

```bash
node tools/a0-check.mjs --only A0-13
```

判据：**15/15 有归宿**；出现「既无产物又无挂账」即判红。

## 状态统计

| 状态 | 条数 | 说明 |
|---|---|---|
| ✅ 阶段 0 有产物 | **14** | 其中 G13 属「已拍板」（决策已定，非待办） |
| ⏳ 显式挂账 | **1** | G14 → 阶段 1 B1.2（已在代码里预留配置落点） |

> ⚠ **挂账 ≠ 通过**：G14 在阶段 1 验收时才计入完成；
> 本表的作用是让「没做的」**显式可见**，而不是被 13 项等权清单稀释掉（G11 的教训）。
