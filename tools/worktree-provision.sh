#!/usr/bin/env bash
#
# 并发工作树装配 —— 把「隔离跑」从一次性操作变成可复用配方。
#
# ── 存在理由（本席 2026-09-26 实测，逐条踩过）──────────────────────────────────
# 本仓的门禁锁按 `sha1(repoRoot)` 隔离（`tools/checker-lock.mjs:130`）⇒ **不同工作树可并行跑门禁**，
# 不会互挡。这是并发推进的**技术前提**。但要让工作树「真能跑」，需补三件事，缺一件就假绿或崩：
#
#   ① **node_modules 必须逐项链接，不能整目录软链**
#      ⚠ 本仓 `node_modules/dsh-mana-core` 本身是相对链接（`-> ../packages/core`）。
#       若把工作树的 `node_modules` 整目录软链到根树，则**相对链接会解析回根树** ⇒
#       工作树里 import `dsh-mana-core` 拿到的是**根树**的代码 ⇒「判据读错树」
#       （本仓已具名的缺陷形态；后果：工作树里改的代码不影响判据，测试恒绿）。
#      ⇒ 正确做法：workspace 包（`dsh-mana-*`）**逐个**指向**本工作树**的 `packages/<dir>`；
#        外部依赖指根树（共享只读）。
#
#   ② **必须自建 lib/**：本仓判据读 `packages/<pkg>/lib/`（gitignored）⇒ 新工作树无产物
#      ⇒ 测试会因 `undefined` 而大面积红（实测 301 fail），而那是「没构建」不是「代码错」。
#
#   ③ **构建必须先于测试**：`npm run build` 在工作树内跑（tsc 的 outDir 相对本树，
#      不受 node_modules 链接影响）⇒ 产物落在本树。
#
# ── 用法 ─────────────────────────────────────────────────────────────────────
#   bash tools/worktree-provision.sh <worktree-name> [<worktree-name> ...]
#   或用 `--all` 装配 `.dsh-worktrees/` 下全部。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT_BASE="$ROOT/.dsh-worktrees"

if [ "$#" -eq 0 ]; then
  echo "用法: bash tools/worktree-provision.sh <worktree-name> [...] | --all" >&2
  exit 2
fi

targets=("$@")
if [ "${1:-}" = "--all" ]; then
  mapfile -t targets < <(cd "$WT_BASE" 2>/dev/null && ls -1 || true)
fi

fail=0
for w in "${targets[@]}"; do
  WT="$WT_BASE/$w"
  if [ ! -d "$WT" ]; then
    echo "  ✗ $w：工作树不存在（$WT）" >&2
    fail=1
    continue
  fi

  echo "── $w"
  D="$WT/node_modules"
  rm -rf "$D"
  mkdir -p "$D/@deepseek-ai"

  # ① workspace 包 → 本工作树（**显式枚举 packages/**，不用通配推导命中集）
  for pkgdir in "$ROOT"/packages/*; do
    [ -d "$pkgdir" ] || continue
    bn="$(basename "$pkgdir")"
    ln -sfn "$WT/packages/$bn" "$D/dsh-mana-$bn"
  done

  # ② 顶层外部依赖 → 根树（共享只读；跳过 workspace 件与 @scope）
  for e in "$ROOT"/node_modules/*; do
    bn="$(basename "$e")"
    case "$bn" in
      dsh-mana-*|@*|.package-lock.json|.bin) : ;;
      *) ln -sfn "$e" "$D/$bn" ;;
    esac
  done
  # .bin 需要（npm run 用）
  [ -d "$ROOT/node_modules/.bin" ] && ln -sfn "$ROOT/node_modules/.bin" "$D/.bin"

  # ③ @scope 下的每个条目：workspace 件指本树，其余指根树
  for e in "$ROOT"/node_modules/@*/*; do
    [ -e "$e" ] || continue
    scope="$(basename "$(dirname "$e")")"
    bn="$(basename "$e")"
    mkdir -p "$D/$scope"
    case "$bn" in
      dsh-mana-*) ln -sfn "$WT/packages/$(printf %s "$bn" | cut -d- -f3-)" "$D/$scope/$bn" ;;
      *) ln -sfn "$e" "$D/$scope/$bn" ;;
    esac
  done

  # ②③ 之一：必须**自建 lib**（判据读它）
  if ! ( cd "$WT" && npm run build > "$WT/.provision-build.log" 2>&1 ); then
    echo "  ✗ $w：构建失败，详 $(basename "$WT")/.provision-build.log" >&2
    fail=1
    continue
  fi

  nlib="$(ls -d "$WT"/packages/*/lib 2>/dev/null | wc -l)"
  # 自检：workspace 包必须指向本树（否则「判据读错树」）
  resolved="$(readlink "$D/dsh-mana-core" 2>/dev/null || echo '(非链接)')"
  case "$resolved" in
    "$WT"/*) ok="✓ 指向本树" ;;
    *) ok="✗ **指向别处**：$resolved" ; fail=1 ;;
  esac
  printf "  %s · 有 lib 的包=%s · dsh-mana-core %s\n" "$w" "$nlib" "$ok"
done

exit "$fail"
