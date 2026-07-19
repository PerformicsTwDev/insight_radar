# insight_radar

關鍵字分析儀表板 — 以 Google Ads 關鍵字資料為核心，串接意圖判讀、關鍵字擴展、嵌入與分群，輸出可視化的洞察。

**多專案儲存庫（monorepo，非 pnpm workspace——各自獨立 lockfile）**：

- **後端 API 服務**（NestJS 11）— 儲存庫根目錄（`src/`、`test/`、根 `package.json`…）。
- **前端 SPA**（React 19 + Vite 6）— [`frontend/`](./frontend/)（**獨立 pnpm 子專案、自有 `frontend/pnpm-lock.yaml`**；同源部署、契約先行消費後端 `openapi.json`）。開發中（frontend M0 起）。

- **API 契約**：[`docs/API.md`](./docs/API.md)（36 端點：`/health` + 4 auth + 11 keyword-analyses（含 M12 AI 洞察/購買歷程/自訂分類）+ 9 tracking-lists（M11）+ `/ai-ideation`（M12）+ `/views` + `/captures`（M13 ingestion）；+ DTO + 錯誤信封 + 認證 + 同步 vs async job 取捨）
- **維運手冊**：[`docs/RUNBOOK.md`](./docs/RUNBOOK.md)（節流／退避／快取失效／部署／優雅關閉）

## 技術堆疊

- **框架**：NestJS 11 + TypeScript（strict）
- **佇列／快取**：BullMQ（`@nestjs/bullmq`）+ Redis；cache-manager v6 + Keyv
- **資料庫**：PostgreSQL + Prisma（含 pgvector / halfvec，供 M8 分群）
- **外部服務**：Google Ads API、Azure OpenAI、Gemini Embeddings、SerpAPI
- **分群微服務**：Python（FastAPI + UMAP + HDBSCAN）— M8，尚未實作
- **測試**：Jest + Supertest + Testcontainers（Postgres）+ ioredis-mock
- **套件管理**：pnpm（請勿使用 npm／yarn）

## 架構總覽

單一 NestJS 進程對外提供 HTTP API，重工作（Ads/LLM 呼叫）一律丟進 BullMQ 佇列由 worker 非同步處理（NFR-1：請求路徑不呼叫外部 API）。

```
HTTP client ──x-api-key──▶ Controller ─┬─ POST /keyword-analyses ─▶ enqueue（202，只入列）
                                        └─ GET  …/keywords、query ─▶ 讀 ResultSnapshot（DB 真實來源）
                                                    │
                       BullMQ「keyword-analysis」queue（Redis）
                                                    │
                          KeywordAnalysisProcessor（worker，concurrency=N）
                       expand（Google Ads，~1 QPS/CID 集中式限流）
                       └▶ 邊拓展邊貼標（Azure OpenAI intent，p-limit 並發）
                       └▶ 固化 ResultSnapshot（不可變、分頁穩定）
                                                    │
                       Postgres（KeywordAnalysis 狀態機 + ResultSnapshot/SnapshotRow）
                       Redis cache（Ads metrics 21d / intent 60d / idemp 1d）
```

模組（`src/app.module.ts` 匯入序，DI 依賴敏感）：

| 模組                    | 職責                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `LoggerModule`          | nestjs-pino 結構化日誌（`LOG_LEVEL`），err serializer 遮罩祕密（NFR-5）     |
| `ObservabilityModule`   | 每 job metrics 的 `JobMetricsContext`（AsyncLocalStorage）                  |
| `CommonModule`          | 全域 `ApiKeyGuard`、`ValidationPipe`、`HttpExceptionFilter`（統一錯誤信封） |
| `CacheModule`           | cache-manager v6 + Keyv/Redis；namespace + TTL（毫秒）                      |
| `PrismaModule`          | `@Global` PrismaService（lazy connect）                                     |
| `HealthModule`          | `GET /health`（DB + cache probe，`@Public`）                                |
| `KeywordAnalysisModule` | 寫入層 + worker：create/status/cancel/SSE + `KeywordAnalysisProcessor`      |
| `KeywordsModule`        | 讀取層：`GET …/keywords`、`POST …/query`（具名 view router）                |

**正確性單點**（改動前務必確認，細節見 `docs/_p/` SSOT）：`micros ÷ 1e6`（任一 null → cpc=null，不補 0）、`MonthOfYear` 以名稱映射 1–12（非 proto 整數）、`normalizedText`=`lowercase(collapseWhitespace(trim(NFKC)))`（去重 key = 快取 key）、每批 seed ≤ 20（保守 15）、TTL 一律毫秒、Ads ~1 QPS/CID 集中式限流器（非 BullMQ limiter）。

## 環境需求

- Node.js 22.x 或 24.x（CI 矩陣）
- pnpm 9.x（`package.json#packageManager` 釘版本）
- Docker（跑 integration 測試的 Testcontainers Postgres；本機開發亦需 Postgres + Redis）

## 快速開始（後端，儲存庫根目錄）

```bash
pnpm install --frozen-lockfile     # 安裝（postinstall 會 prisma generate）
cp .env.example .env               # 複製後填入憑證；缺值/格式錯 → 啟動 Joi fail-fast（TC-19）
pnpm prisma:migrate:dev            # 套用 migration（需 DATABASE_URL 指向本機 Postgres）
pnpm start:dev                     # watch 模式啟動（預設 http://localhost:3000）
```

驗證：`curl localhost:3000/health`（免認證）應回 `status: "ok"`。業務端點需認證——**機器對機器**帶 `x-api-key: <API_KEY>` header；**瀏覽器**先 `POST /api/v1/auth/login` 取得 httpOnly session cookie（登入流程 / cookie flags / CSRF / owner scope 見 [`docs/API.md`](./docs/API.md) 的「認證」節）。

所有對外業務路由掛載於 `/api/v1` 之下（`/health` 例外，不帶版本前綴，NFR-10）。環境變數清單與預設值見 [`.env.example`](./.env.example)（與 `src/config/env.validation.ts` 的 Joi schema 逐一對映）。

## 測試（後端）

外部 API（Google Ads / Azure / Redis）**一律 mock / ioredis-mock**；涉 DB 的測試用 **Testcontainers Postgres**（非 SQLite）；CI 不需真實憑證。

```bash
pnpm test:unit           # 純函式 / 服務單元測試（快，無 Docker）
pnpm test:integration    # Testcontainers Postgres（--runInBand，需 Docker daemon）
pnpm test:e2e            # supertest 端到端（ioredis-mock，不起真 Worker）
pnpm test:cov --ci --runInBand   # 全部 3 projects + 覆蓋率門檻（CI 使用的指令）
```

> ⚠ 本機請用 `pnpm test:cov --ci --runInBand`（對齊 CI）。裸 `pnpm test:cov` 會讓 integration specs 平行打同一
> Testcontainer → 互踩資料假紅（FK/pagination）；加 `--runInBand` 序列化即綠。

**覆蓋率門檻**：global ≥ 85%、core（映射/正規化/去重/篩選/趨勢/intent 後處理/embeddings）≥ 90%。引入 Queue/Worker/QueueEvents/cache 的測試須在 `afterAll` 關連線（TC-26，防 Jest hang）。

## 品質閘門（提交前）

```bash
pnpm lint && pnpm typecheck && pnpm test:cov --ci --runInBand
```

## 前端（`frontend/`）

React 19 + Vite 6 SPA，**同源部署**（正式：靜態檔由 NestJS `ServeStatic` 或同一 reverse proxy 供應 → 無 CORS、cookie 天然同源；開發期 Vite dev proxy 轉 `/api` 到後端）。**契約先行**：唯一 API 型別來源 = 後端 `openapi.json`，前端 codegen 產出 typed client（不手寫 API 型別）。

- **技術堆疊**：React 19 + Vite 6 + TypeScript **strict**、TanStack Router/Query/Table/Virtual、Zustand（少量 client state）、Tailwind CSS v4 + Radix、Chart.js 4、openapi-typescript + openapi-fetch、MSW、Vitest + Testing Library、Playwright（e2e + visual regression）。
- **獨立 pnpm 子專案**（非 workspace）：自有 `frontend/package.json` + `frontend/pnpm-lock.yaml`；根層 `eslint` / `prettier` / `lint-staged` 已排除 `frontend/**`（各自工具鏈互不干擾）。

```bash
pnpm -C frontend install --frozen-lockfile   # 安裝（preinstall 守 Node ≥ 22）
pnpm -C frontend dev                          # Vite dev server
pnpm -C frontend verify                       # lint + format:check + typecheck + build + test:cov（提交前）
```

> 前端規格（Requirement/Design/Task）見 `docs/_p/spec/frontend/`（團隊內部文件，不隨原始碼發佈）。開發自 frontend M0（骨架 + 工具鏈）起。

## 專案管理

- 工程流程、規格（Requirement/Design/Task）、ADR 與任務板對映規則為團隊內部文件（`docs/_p/`，不隨原始碼發佈）。
- 分支策略：GitHub Flow（多 spec 短命分支 `<type>/<spec-slug>-T<x.y>-<kebab>`，如 `feat/frontend-T1.2-app-shell`；squash 合併、`main` 恆綠）。
- 提交訊息遵循 Conventional Commits 1.0.0（scope 限定 enum，含 `frontend`）。

## 授權

Proprietary — 版權所有，內部使用。詳見 [LICENSE](./LICENSE)。
