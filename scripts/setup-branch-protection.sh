#!/usr/bin/env bash
# 套用 main 分支保護（DevelopmentRules §12.5「目標態」）。需 gh CLI 已登入且具 repo admin。
# ⚠ 現況（2026-07，ADR-0003）：Free 方案 private repo 不支援 branch protection——本腳本
#   對本 repo 會回 403（"Upgrade to GitHub Pro or make this repository public"）。
#   保留為目標態：升級 GitHub Team／轉 public 後執行即可恢復 server-side 保護
#   （屆時 release-please 的 token 須改 PAT/App token，見 DevelopmentRules §12.6 / ADR-0002）。
#   在此之前，「CI 綠才合併」由 .claude/hooks/guard-bash.sh 的 gh pr merge 驗綠 hook 強制。
# 用法：REPO=<owner>/insight_radar ./scripts/setup-branch-protection.sh
# 註：required contexts 須與各 workflow 的 job name 完全一致：
#   - "lint · typecheck · build" / "test (node 22.x)" / "test (node 24.x)"（ci.yml）
#   - "lint-pr-title"（pr-title.yml）  - "secret-scan"（secret-scan.yml）
# 提醒：每個 check 須至少在 repo 上跑過一次，才能被選為 required。
set -euo pipefail
REPO="${REPO:?請設定 REPO=<owner>/insight_radar_v3}"

gh api -X PUT "repos/${REPO}/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "lint · typecheck · build",
      "test (node 22.x)",
      "test (node 24.x)",
      "lint-pr-title",
      "secret-scan"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": true,
    "require_code_owner_reviews": true
  },
  "required_conversation_resolution": true,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON

echo "✓ main 分支保護已套用於 ${REPO}"
