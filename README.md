# insight_radar

關鍵字分析儀表板的後端服務 — 以 Google Ads 關鍵字資料為核心，串接意圖判讀、關鍵字擴展、嵌入與分群，輸出可視化的洞察。

## 技術堆疊

- **框架**：NestJS 11 + TypeScript（strict）
- **佇列／快取**：BullMQ + Redis
- **資料庫**：PostgreSQL + Prisma（含 pgvector / halfvec）
- **外部服務**：Google Ads API、Azure OpenAI、Gemini Embeddings、SerpAPI
- **分群微服務**：Python（FastAPI + UMAP + HDBSCAN）
- **測試**：Jest + Supertest + Testcontainers
- **套件管理**：pnpm（請勿使用 npm／yarn）

## 開發

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
```

API 對外路由掛載於 `/api/v1` 之下（`/health` 例外，不帶版本前綴）。

## 專案管理

- 工程流程、規格、ADR 與任務板對映規則為團隊內部文件（不隨原始碼發佈）。
- 分支策略：GitHub Flow（短命分支 `<type>/T<x.y>-<slug>`、squash 合併、`main` 恆綠）。
- 提交訊息遵循 Conventional Commits 1.0.0。

## 授權

Proprietary — 版權所有，內部使用。詳見 [LICENSE](./LICENSE)。
