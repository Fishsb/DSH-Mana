# N4 收口 · 最终判定（执行席 session-taskboard-a596d9e0 / 执行 e-muidf6xk）

> 生成时刻：2026-09-26 20:47 (+0800)；main HEAD = `83ca8cb`
> 本席**零删除**：未发 `git worktree remove`、未发 `git branch -D`、未改任何既有文件。唯一写入 = 本文件（新增）。

---

## 一、结论先行

**存活 4 席，逐棵做内容级判定后：4 棵全部不可删。本次零删除。**

任务点名的两棵（`t-muhxatig-q8n9vq` / `t-muhxatm7-dt4inu`）在**本席进场前**已被同一张卡的前席删除（执行 e-mui8u3lo，18:14）。本席复算其证明成立（§四）。
剩余 4 棵按卡原文规则 4「不得删除任何未合入的内容 —— 若发现某个分支有 main 没有的实质改动，停下来报告，不许删」处置。

---

## 二、改前 / 改后原文对照

| 读数 | 卡面基线（派单时） | 前席交接（20:2x） | **本席改后（20:47）** |
|---|---|---|---|
| `git worktree list` 行数 | 2 棵 | 5 行（main+4） | **5 行（main+4）** |
| task/ 分支数 | 2 | 4 | **4** |
| `.git/worktrees` 目录数 | 2 | 4 | **4** |
| `worktree prune --dry-run -v` | — | 0 行 | **0 行** |
| main HEAD | 6d3762f | 83ca8cb | **83ca8cb（未变）** |

```
$ git worktree list
/home/lk/Mana                                  83ca8cb [main]
/home/lk/Mana/.dsh-worktrees/t-muhxatiz-jpb9a0 8fb2025 [task/W2-C2-working-memory+t-muhxatiz-jpb9a0]
/home/lk/Mana/.dsh-worktrees/t-mui74mnb-bwisjs 9abfc6b [task/N1-门禁收口：重取-_freeze-基+t-mui74mnb-bwisjs]
/home/lk/Mana/.dsh-worktrees/t-mui74mpx-y3ri21 00e8165 [task/N3-A1-5-清账：ACT-R-衰减由+t-mui74mpx-y3ri21]
/home/lk/Mana/.dsh-worktrees/t-mui74mqg-kjik85 83ca8cb [task/N4-隔离树收口：删除两个已完成任务的+t-mui74mqg-kjik85]

$ git branch -a
* main
+ task/N1-门禁收口：重取-_freeze-基+t-mui74mnb-bwisjs
+ task/N3-A1-5-清账：ACT-R-衰减由+t-mui74mpx-y3ri21
+ task/N4-隔离树收口：删除两个已完成任务的+t-mui74mqg-kjik85
+ task/W2-C2-working-memory+t-muhxatiz-jpb9a0
```

---

## 三、逐棵判定（内容级，非提交计数）

判据：`git rev-list --count main..<branch>` 只数"独有提交"，**不判内容**；squash 入 main 后提交计数**永远不为 0**。故一律以**内容级**为准。

| # | worktree | 判定 | 命令级依据 | 处置 |
|---|---|---|---|---|
| 1 | `t-mui74mnb-bwisjs` (N1) | ⛔ 不可删 | 分支独有 **4 提交 / 10 文件 / +468 行**，**且仍在增长**（本席观测窗内 906eefd→d1eafed→9abfc6b）；树内 20:34、20:42 仍被写 | 保留 |
| 2 | `t-mui74mpx-y3ri21` (N3) | ⛔ 不可删 | 卡 `in_progress`；执行 `e-muic3vcv` `outcome=running`；树内 `.a15-evidence/` 持续增长（20:41 最新）；独有 2 提交 / +278-94 | 保留 |
| 3 | `t-muhxatiz-jpb9a0` (W2-C2) | ⛔ 不可删 | 独有 1 提交 / 5 文件 / **+1614-57**；`capacityReached` main=**0** / 分支=**4**；`overflowRemaining` main=**0** / 分支=**3** | 保留 |
| 4 | `t-mui74mqg-kjik85` (N4) | ⛔ 不可删 | **本席自身工作目录** | 保留 |

### 一条必须点明的新读数：N1 分支"重取了基线"

`git reflog show task/N1…`：

```
9abfc6b …@{2026-09-26 20:42:03}: commit: docs(n1): 留档 worktree 内改后全量门读数
d1eafed …@{2026-09-26 20:36:40}: commit: docs(n1): 补反证加强
906eefd …@{2026-09-26 20:17:06}: commit: docs(n1): 实测反证「重取基线不能消除锚点/跃迁报红」
99bc1ba …@{2026-09-26 20:09:17}: commit: chore(n1): .gitignore 收 .dsh-worktrees
3c6eb64 …@{2026-09-26 18:54:48}: branch: Created from HEAD
```

⇒ N1 卡面标题是「重取 _freeze 基线」，其执行会话**真的把分支重建到了新 HEAD（3c6eb64）**，而**旧树尖端 6d3762f 本身是 main 的祖先**（`git merge-base --is-ancestor 6d3762f main` → **exit 0**）。
即：**"旧树"与"新树"同名同卡，但基线不同** —— 这正是本卡要防的形态，且**已经发生过一次**。

---

## 四、已删两棵：证明（复算，非转述）

```
$ git merge-base --is-ancestor 14268c4 main   → exit=0
$ git merge-base --is-ancestor 52f7356 main   → exit=0
$ git merge-base --is-ancestor bd7bb87 main   → exit=0

$ diff <(git ls-tree -r ad004ee -- packages/prompts) \
       <(git ls-tree -r 14268c4 -- packages/prompts)   → exit=0（0 行差异）
$ git ls-tree -r ad004ee -- packages/prompts | awk '{print $3}' | sort | md5sum
  8315343b407673c41cdba1e633801e1b
$ git ls-tree -r 14268c4 -- packages/prompts | awk '{print $3}' | sort | md5sum
  8315343b407673c41cdba1e633801e1b      ← 逐 blob 哈希全同（14 个）

$ diff <(git ls-tree -r e6bfd96 -- packages/vector) \
       <(git ls-tree -r 52f7356 -- packages/vector)    → exit=0
  两侧 md5 均 = a1a4b37c62a8d7cbb39879c32016e390
```

**长期可复算性（重要）**：`ad004ee` / `e6bfd96` 已**无任何 ref 指向**（`git for-each-ref --contains` 为空），`git fsck` 已把它们列为 **dangling commit**，随时可被 gc 回收 ⇒ 依赖这两个对象哈希的命令将来会失效。
**永久替身**：`14268c4` / `52f7356` / `bd7bb87` 是 main 的祖先（三条 `is-ancestor` 均 exit 0），永久可达。

---

## 五、⛔ 根因：隔离树分支会被静默强重置（本卡真正的风险源）

**本仓无任何 remote**（`git remote` → 0 条）⇒ 分支被重置后**没有任何第二份**。

插件 `dsh-taskboard@0.8.2` 的代码路径：

```
execution.js:264   reuse: options?.reuseWorktree === true
isolation.js:95    info = await git.prepareWorktree(…, args.reuse ? "reuse" : "fresh")
git.js:159         prepareWorktree(root, path, branch, mode = "fresh")
git.js:182-193     if (mode === "reuse") { …命中则返回 { reused: true } }
                      否则（fresh）：
                        git worktree remove --force <path>
                        git worktree prune
                        git branch -f <branch> HEAD      ← 强重置到当前 main HEAD
                        git worktree add <path> <branch>
```

**实测后果（本席亲历）**：本卡 N4 分支的 reflog：

```
83ca8cb …@{2026-09-26 20:33:35}: branch: Reset to HEAD     ← 本会话启动
27d5136 …@{2026-09-26 20:23:29}: commit: docs(n4): 收口后盘点…   ← 前席交付，被冲掉
83ca8cb …@{2026-09-26 20:08:51}: branch: Reset to HEAD
6d3762f …@{2026-09-26 18:08:32}: branch: Created from HEAD
```

前席 e-muicjdon 的交付提交 `27d5136`：
- 分支独有提交 = **0**（`git log --oneline main..task/N4…` 空）
- 被 ref 指向数 = **0**（`git for-each-ref --contains 27d5136` 空）
- 工作区文件 **已消失**（`docs/handoff/w1-execution/N4-postdelete-verification.md` → No such file）
- 对象仍在：`git cat-file -t 27d5136` → `commit`

⇒ **在 worktree 隔离下，只要同一张卡再派一次执行（reuse=false 是默认），上一次的交付提交会被 `branch -f` 静默重置，工作区文件同时消失，而看板报告层面完全看不出来。** 这是"重做与首次完成同形"的**真实机制**，比原始派单设想的"过时基线重做"更严重：**不是重做，是抹除**。

⚠ **同一机制会作用于本文件**：下次本卡再派执行时，本提交也会被 `branch -f` 重置。故本席同时把结论全文写入卡评论（耐久面）。若需找回本文件对应对象，用提交哈希即可（`git cat-file -p <hash>`，只要未 gc）。

---

## 六、反补丁自检（纪律 17b/17e）

**一句话**：本席**零删除、零改既有文件**，唯一写入是**新增**本档。
**改动了哪些既有行为**：无。**凭什么确认仍成立**——
- main HEAD `83ca8cb` 未变（改前=改后）；
- worktree/branch 读数改前=改后逐字相同（5 行 / 4 条）；
- `git worktree prune --dry-run -v` → 0 行（无悬挂管理目录）；
- `.git/worktrees` 目录数 4 = 存活树 4 棵（一一对应）；
- 本任务树提交前 `git status --porcelain` = 1（本文件），提交后 = 0。

---

## 七、剩余风险 / 未闭合

1. **DoD#2/#3 与卡规则 4 结构性互斥**：要"只剩主树 / 无残留 task 分支"，必须删 N1(未合入且在写)、N3(在途)、C2(未合入)、N4(自身) —— 正面违反规则 4。本席**不勾**这两项。
2. **N1 失配态**：卡已 `done`，但其树/分支**仍在被写**（20:42 仍有提交，`docs/handoff/N1/README.md` 20:34）。该树内容**无第二份**（无 remote）。删它 = 毁在写工作面。
3. **`.dsh-worktrees/` 未进 main 的 .gitignore**：`git grep -c 'dsh-worktrees' main -- .gitignore` → **exit 1（零命中）**，故 main 里它是 `??`。该处置在 **N1 分支上已做**（提交 `99bc1ba`），**只是尚未合入 main**。本卡不重复动手。
4. **插件默认 reuse=false** 是本仓"隔离树收口"要做成可持续动作的根本障碍；在它修好之前，任何"删隔离树"的收口都会被下一次执行重新生出来。
