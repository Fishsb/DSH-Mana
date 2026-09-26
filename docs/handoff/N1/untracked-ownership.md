# N1 · 无主未跟踪件归属清单（2026-09-26）

> **本清单解决什么**：`git status --porcelain` 里的 `??` 行此前**无人逐件认领** ——
> 「未跟踪」在 A0-10 里**不判红**（`??` 不是既有件，见 `tools/a0-check.mjs` A0-10 块头注），
> 所以它们既不会让门变红，也不会被任何人处理，长期沉淀成**归属不明**。
> 本清单把每一件钉到「谁产出 / 为何存在 / 处置结论 / 依据」。

## 取数坐标（读数前须复跑）

```
$ git rev-parse HEAD   → 3c6eb6465d127930949346cf37a18c252b836ada   (main @ 2026-09-26 19:5x +0800)
$ git status --porcelain | grep -c '^??'   → 28
```

处置分四类：**A 已定（本批落 .gitignore）** · **B 已有主（登记归属，保留）** · **C 待用户拍板（不自行删除）**

---

## A 类 · 本批直接处置（1 件）

| # | 路径 | 处置 | 依据 |
|---|---|---|---|
| A1 | `.dsh-worktrees/` | **入 `.gitignore`**（本批改动） | 任务看板执行隔离树：`git worktree add` 可重建（运行态产物，非源码）。此前**未入任何忽略规则**（`git check-ignore -v .dsh-worktrees/` → exit 1），故每次 `git status` 都报一行 `??`，而 worktree 隔离的合并闸按 status 判脏 ⇒ 会让**每一次**一键合并失败。 |

⚠ **附带代价（如实登记，不掩饰）**：忽略之后，worktree **树内**的未跟踪残留对 `git status` **不可见**。
本仓已有实例：`t-muhxatiz-jpb9a0`（W2-C2，在途）树内若落有证据文件，删树时会一并消失。
⇒ 已把该缺口写进 `.gitignore` 注释：**删除 worktree 前必须另落「删除前证据清单」**（N4 卡已如此做：
`docs/handoff/w1-execution/N4-predelete-manifest.md`）。

## A′ 类 · 上收 `.git/info/exclude` → `.gitignore`（16 条模式，本批改动）

原先这些探针/读数残留只靠 `.git/info/exclude` 隐藏 —— 那是**本机私有、不进版本**的文件
（`git clone` 不带它、他人克隆看不到）⇒ 「哪些东西被隐藏了」**不可审计、不可复现**。
本批把同一组模式上收进 `.gitignore`，使其进版本、可审计、跨克隆一致。

```
$ git ls-files -- <每条模式>   → 全部 0 命中（上收前实测，无既有件被误伤）
```

## B 类 · 已有主（27 件，登记归属，**保留不删**）

| # | 路径 | 归属 | 依据 |
|---|---|---|---|
| B1 | `docs/deepseek_markdown_20260924_968609.md` | **用户提供的外部参考档**（v10.0 完整方案，79,100 B，mtime 2026-09-25 06:22） | 被 `docs/mana-v10-status-plan.md` 等 8 份**已跟踪**文档按文件名引用 ⇒ 是**真源材料**。本任务书原文即把它的 `:Zone.Identifier` 列为待处置件 ⇒ 其本体必须留。**未跟踪**是因为它由用户从 Windows 侧放入（`Zone.Identifier` 即旁证）。 |
| B2 | `docs/deepseek_markdown_20260924_968609.md:Zone.Identifier` | **Windows 下载标记**（内容 `[ZoneTransfer] ZoneId=3`） | 已由 `*:Zone.Identifier` 模式覆盖（原 `.git/info/exclude`，本批上收）。**非源码、无信息量**，留在盘上不影响 status。 |
| B3 | `docs/handoff/w1-execution/` 25 件（K1-*.txt/err/json、K2/K3/K4-readings.txt、N4-predelete-manifest.md） | **各执行席的判据读数**（K1/K2/K3/K4 席位产出） | 同目录**已有 14 件同类文件被跟踪**（`BASELINE.txt`/`W1-REPORT.md`/`w1-1-mutation.mjs` 等）⇒ 有既定先例。这 25 件是**证据**（K1 负向对拍 6 组、K3 38 KB 读数），**不得删**。归「W1 执行证据」组，待 W1 收口时由该批统一追认入版本或明确归档。 |
| B4 | `tools/eval-l1-l4.mjs` | **在途席**（L1–L4 评估器，28,634 B，mtime **本席读数前 19 分钟**） | 文件头自述「Mana L1–L4 四层评估器（v10 §39.1 的可机检落点）」；mtime 极新 ⇒ **别席正在写**。按并发纪律 §4「不得动别席在途件」⇒ **保留、不碰、不入 .gitignore**（它是源码，应被提交）。 |

## C 类 · 待用户拍板（0 件）

本批**未发现**必须由用户裁决的件：B 类全部可定归属，A 类处置有明确依据。
⇒ 无须「交清单给用户等回复」的悬置项。

---

## 回归自检（本仓纪律 17b/17e）

**这次改动碰了哪些既有行为、凭什么确认它们仍然成立：**

碰了 **`.gitignore` 的匹配面**（新增 16 条模式 + `.dsh-worktrees/`）。既有行为 = 「哪些路径对 `git status` 不可见」。
确认未改坏：① 上收前对每条模式跑 `git ls-files` ⇒ **已跟踪文件命中 0**（无既有件被隐藏）；
② 改动只增不减：原有 6 条规则（`.roundtable/*/transcript.jsonl` 等）逐字未动；
③ 未跟踪面**只减不增**：`.dsh-worktrees/` 由可见转隐藏（1 件），其余 27 件仍可见（逐件实测）。

---

**取数坐标**：HEAD `3c6eb64` · `tools/a0-check.mjs` md5 `6baaf3c8e797` · node v22.22.1 · 2026-09-26 +0800
**产出席**：N1（t-mui74mnb-bwisjs 执行会话）
