#!/usr/bin/env bash
# 批次建立 repo labels（DevelopmentRules §5.4）。需 gh CLI 已登入。
# 用法：（在 repo 目錄）./scripts/setup-labels.sh
# 原則：Status / Priority / Milestone 優先用 Project 欄位 / 原生 Milestone；label 主攻 type: 與 area:。
set -euo pipefail

# type:（對齊 commit / 分支 type）
for l in feat fix chore docs test refactor; do
  gh label create "type:$l" --color 1f6feb -f
done

# area:（≈ commit scope；對映模組）
for l in googleAds intent keyword-analysis keywords embeddings clustering topics serp cache config common health ci queue db; do
  gh label create "area:$l" --color 2ea043 -f
done

# priority:
for l in must should could; do
  gh label create "priority:$l" --color d29922 -f
done

# 輔助旗標
gh label create "status:blocked"    --color b60205 -f
gh label create "status:needs-info" --color cccccc -f
gh label create "spike"             --color fbca04 -f   # spike.yml 模板引用，需先建立否則被靜默忽略

# 註：`dependencies` 由 Dependabot 自動建立；dependabot.yml 的 github-actions 區塊用既有的 `area:ci`（非裸 `ci`）
# milestone：不用 label，改用原生 GitHub Milestone（M0–M7，§4.4）
echo "✓ labels 已建立"
