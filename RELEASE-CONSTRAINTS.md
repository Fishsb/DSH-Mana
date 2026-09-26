## 发布约束（用户拍板，2026-09-26 · 第 2 条追加）

### ⛔ 约束：**除用户明确说明外，不发布版本包体**

含义（按本仓实际解释）：
1. **不发 npm 包** —— 不执行 `npm publish`，不推送任何包到 registry
2. **不打 GitHub Release / 不挂附件** —— 不建 tag、不附加 tgz/zip 包体
3. **只推源码仓库本体** —— 即 git 仓库内容（源码 + 判据 + 文档）

**为何本就一致（实测）**：全部 17 个包的 `package.json` 均为 `"private": true`` ⇒ `npm publish` 会被 npm 自身拒绝。
⇒ 该约束在本仓**不需要额外机制**即成立；但仍登记，作为**行为纪律**（防将来有人把 private 改掉）。

### 与先前约束的合并清单（发布全程对照）

| # | 约束 | 来源 |
|---|---|---|
| 1 | **只推当前树**（新仓库 + 单次提交），不带 79 提交历史 | 用户拍板 · 方案 A |
| 2 | **排除内部管理档**：`w4-session-prompts.md` · `session-allocation.md` · `w4-decisions.md` | 用户拍板 |
| 3 | **排除开发资料**：`docs/handoff/`（153 文件）· `.roundtable/`（21 文件） | 用户拍板 |
| 4 | **只上传项目主体** | 用户拍板 |
| 5 | **本机路径不脱敏**（不动 `/home/lk/` 等，保判据原文一致） | 用户拍板 |
| 6 | **等 K1/C2 完成再发**（不推半成品） | 用户拍板 |
| 7 | ⛔ **除明确说明外不发布版本包体**（不发 npm / 不打 Release 附件） | 用户拍板（本轮） |

### 发布树实测（已构建，待推）

```
构建方式：git archive HEAD | tar -x  ⇒ 478 文件（只含已提交内容，树干净）
删除排除项后                ⇒ 296 文件 · 4.5M
顶层：.gitattributes .gitignore docs package-lock.json package.json packages tools tsconfig.base.json
```
