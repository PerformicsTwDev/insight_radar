#!/usr/bin/env bash
# setup-local-excludes.sh — 本機 only 政策自包含（狗糧 test2 F-3 回寫）。
#
# 把 docs/_p/、.claude/、CLAUDE.md 寫入 .git/info/exclude：
# - 為什麼不用 ~/.gitignore_global：政策依賴 repo 外的機器狀態——新機器/新協作者漏設定
#   ＝本機 only 檔被 git add 進 repo 或 hooks/守則靜默失效；info/exclude 跟著 repo 的 .git 走。
# - worktree 共用主 repo 的 .git → excludes 天然對全部 worktree 生效。
# - 冪等：已有標記段則跳過。改為入庫政策時清掉本段（INIT.md 附錄 C）。
#
# 用法：git init 之後（且 git add -A 之前）執行：./scripts/setup-local-excludes.sh
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "✗ 不在 git repo（先 git init）" >&2
  exit 1
}
exclude_file="$(git rev-parse --git-path info/exclude)"
marker="# proj_init kit — 本機 only（setup-local-excludes.sh）"

# ⚠ 變數後緊接全形字元必須用 ${} ——macOS bash 3.2 會把多位元組字元誤併入變數名（實測炸 unbound）
if grep -qF "$marker" "$exclude_file" 2>/dev/null; then
  echo "✓ 已設定過（${exclude_file}）"
  exit 0
fi

mkdir -p "$(dirname "$exclude_file")"
{
  echo ""
  echo "$marker"
  echo "docs/_p/"
  echo ".claude/"
  echo "CLAUDE.md"
} >>"$exclude_file"
echo "✓ 本機 only excludes 已寫入 ${exclude_file}"

# 逐一驗證（⚠ check-ignore 帶 -q 時多 path 會 fatal——狗糧實證，須逐一）
for p in docs/_p .claude CLAUDE.md; do
  if [ -e "$root/$p" ]; then
    if git -C "$root" check-ignore -q "$p"; then
      echo "  ✓ $p"
    else
      echo "  ⚠ $p 未被忽略（可能已被 git 追蹤——改入庫政策見 INIT.md 附錄 C）"
    fi
  fi
done
exit 0
