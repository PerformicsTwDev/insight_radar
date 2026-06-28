## 摘要 Summary
<!-- 一句話：這個 PR 做了什麼、為什麼 -->

## Spec 追溯 Traceability（必填，須與 Task.md 一致）
- 對映 Task：T<!-- 1.3 -->
- 功能需求 FR：FR-<!-- 3 -->
- 非功能需求 NFR：NFR-<!-- 7 / 無 -->
- 測試案例 TC：TC-<!-- 3, 5 -->
- 里程碑 Milestone：M<!-- 1 -->
- 關聯 Issue：Closes #<!-- 42 -->

## TDD 紅綠說明 red → green → refactor（必填）
- [ ] 先有**失敗測試**：對映 commit `test: red TC-...`（貼 SHA 或連結）
- [ ] 最小實作讓測試轉綠：commit `feat/fix: green ...`
- [ ] 重構且維持綠燈（**未改測試期望**）：commit `refactor: ...`（如無重構請註明）

## 測試證據 Evidence（必填）
- [ ] `pnpm test:cov` 本地通過；覆蓋率：global __% / 本模組 __%（門檻 global ≥85% / core ≥90%，未下降）
- [ ] 外部 API（Google Ads / Azure OpenAI / Redis）皆 **mock / fixture / ioredis-mock**，未呼叫真實服務
- [ ] 涉 DB 的測試使用 **Testcontainers Postgres**（非 SQLite）；CI 無真實憑證
- [ ] 引入 Queue/Worker/QueueEvents/cache 者已在 `afterAll` 關閉（TC-26，不 hang）
<!-- 貼覆蓋率摘要或 CI 連結 -->

## 變更類型（每項獨立成行，GitHub 才會 render 成可勾選 checkbox）
- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] perf
- [ ] test
- [ ] docs
- [ ] chore
- [ ] 含 BREAKING CHANGE

<!--
⚠ 破壞性變更：**勾選框不具機器效力**，release-please 偵測不到。若為破壞性變更，務必擇一讓它進 squash body / 標題：
  (a) PR 標題用 `type!:`（如 `feat(api)!: ...`），或
  (b) 在「破壞性說明」區塊寫**正規 footer**（會原樣進 squash body，被 release-please 解析）：
-->
## 破壞性說明 Breaking（僅破壞性變更需填；填了下行 footer 才會被 release-please 解析升版）

```
BREAKING CHANGE: <對外契約 / 欄位語意 / 讀取層 grammar 的不相容變更說明>
```

## 是否動到 spec / migration / 設定（必勾，無則勾「無」）
- [ ] 動到 **spec**：已同步 Requirement.md / Design.md / Task.md（含新增 TC 已回填 Design.md + Task.md 附錄 A）
- [ ] 動到 **Prisma migration**：本機已 `prisma migrate dev` 生成、**未改既有 migration**；若涉 `pg_trgm`/GIN/trgm 索引已手動補 SQL（T0.9，見 §15.4）
- [ ] 動到 **設定/env**：已更新 `.env.example` / `.env.test`（dummy 通過 Joi/allowlist）；`AZURE_OPENAI_API_VERSION` 仍在 allowlist（AC-11.4 / TC-19，見 §13.2）
- [ ] 以上皆無

## Self-review Checklist（送審前作者自核）
- [ ] PR 標題符合 Conventional Commit（squash 後即為 `main` 的 commit）
- [ ] diff ≤ 400 行（理想 ≤ 200）；超過已說明無法再拆的理由
- [ ] **無祕密外洩**：無金鑰 / x-api-key / Ads/Azure 憑證 / OAuth refresh token 進 code、log、fixture、snapshot（NFR-5 / TC-29 / AC-11.5）
- [ ] 命名與既有規格一致（micros、normalizedText、MonthOfYear、competition enum、FilterSpec…）
- [ ] 新增/異動對外端點維持 `/api/v1` 前綴（`/health` 除外，NFR-10 / FR-14）
- [ ] 已 rebase 至最新 `main`，CI 全綠

## 風險與回滾 Risk & Rollback
<!-- 影響範圍、相容性、如何 rollback -->
