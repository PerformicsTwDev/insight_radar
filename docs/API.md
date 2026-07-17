# insight_radar — API 契約

後端對外 HTTP API。除 `GET /health` 外，所有端點掛在 **`/api/v1`** 前綴下；除 `@Public` 標記者（見下）外皆需認證（session cookie 或 `x-api-key`）。此文件以 controller/DTO 為事實來源（API e2e 測試守契約）。

## 認證（M10：session cookie 或 `x-api-key` 二擇一）

全域 `CompositeAuthGuard`（`@Public` 標記者除外）依序試兩種身分，任一通過即放行；皆不符 → **401 `Authentication required`**（單一通用訊息，不區分細節）：

1. **Session cookie（瀏覽器，FR-24/25）**：`POST /api/v1/auth/login` 驗證成功後，伺服器建立 Redis session 並回 `Set-Cookie: <SESSION_COOKIE_NAME>=<opaque sid>`，帶 `HttpOnly` + `SameSite=Lax` + `Secure`（非 test）+ `Path=/`。後續請求瀏覽器自動附 cookie；伺服器以 sid 查 Redis session（**真理在 Redis**，登出/過期即失效）。cookie 內只有 opaque sid，**不含** JWT 或使用者資料。
2. **`x-api-key`（機器對機器，FR-11）**：帶 `x-api-key: <API_KEY>` header（常數時間比對，避免 timing side-channel）。與 session 完全相容共存。

- **`@Public`（免認證）**：`GET /health`、`POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`GET /api/v1/auth/me`（自身讀 cookie 把關）。
- **CSRF（FR-26）**：對 **session cookie** 發動的狀態變更請求（`POST/PUT/PATCH/DELETE`）額外檢查 `Origin`（缺則退 `Referer`；`Origin` 存在即權威）須 ∈ `ALLOWED_ORIGINS`，否則 **403 `Origin not allowed`**。`x-api-key`（瀏覽器不會自動附）與 `GET/HEAD` 免檢查。
- **owner scope（FR-27）**：session 使用者只能存取自己（`ownerId` = 自身或共享 `null`）的資源；越權 id 一律回 **404**（反枚舉，不洩漏存在性）。`x-api-key` 機器身分不套 owner 過濾。

### 認證端點（4，掛 `/api/v1/auth`）

| Method | Path                    | 說明                             | 成功碼  | `@Public`                  |
| ------ | ----------------------- | -------------------------------- | ------- | -------------------------- |
| POST   | `/api/v1/auth/register` | 建帳號 `{email,password}`        | **201** | ✔                          |
| POST   | `/api/v1/auth/login`    | 登入（設 session cookie）        | 200     | ✔                          |
| POST   | `/api/v1/auth/logout`   | 登出（撤銷 session + 清 cookie） | 200     | —（受 CompositeAuth+Csrf） |
| GET    | `/api/v1/auth/me`       | 取當前使用者                     | 200     | ✔                          |

- **register**：`{email,password}`（`password` 長度 ≥ `AUTH_MIN_PASSWORD_LEN`）→ `201 { user:{id,email} }`；email 重複 → **409**；格式錯 → 400。**密碼/hash 絕不回應/入 log**（argon2id，NFR-5）。
- **login**：`{email,password}` → `200 { user:{id,email} }` + `Set-Cookie`（opaque sid，不入 body）。憑證錯（含 email 不存在）一律 **401**（不枚舉；對不存在 email 亦執行 dummy verify，使 timing 相近）。
- **logout**：撤銷 Redis session + `clearCookie`；無有效 session → 401。**非 `@Public`**——是 session 狀態變更，受 `CompositeAuthGuard` + `CsrfGuard` 保護（防跨站強制登出）。
- **me**：有效 session → `{id,email}`；無/失效 session → 401。

## 端點總覽（35）

認證端點（#2–#5）細節見上方「認證端點」節；以下為完整對外 HTTP 介面（`/health` 除外皆掛 `/api/v1`）。詳細 request/response 契約以下方分節與 controller/DTO 為準（M8/M9 list/topics/views、**M11 追蹤清單（#17–#25）與 M12 Search 線 AI 功能（#26–#35）**尚未補逐一分節，以此表 + 下方「M11–M12 端點契約」節 + `openapi.json`（自省產出、權威契約來源）為準）。

| #   | Method | Path                                                                          | 說明                                         | 成功碼                     |
| --- | ------ | ----------------------------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| 1   | GET    | `/health`                                                                     | 健康檢查（DB + cache probe）                 | 200 / 503                  |
| 2   | POST   | `/api/v1/auth/register`                                                       | 建帳號（`@Public`）                          | **201**                    |
| 3   | POST   | `/api/v1/auth/login`                                                          | 登入（設 session cookie，`@Public`）         | 200                        |
| 4   | POST   | `/api/v1/auth/logout`                                                         | 登出（撤銷 session，受 CsrfGuard）           | 200                        |
| 5   | GET    | `/api/v1/auth/me`                                                             | 取當前使用者（`@Public`，self-guard）        | 200                        |
| 6   | POST   | `/api/v1/keyword-analyses`                                                    | 建立分析（入列，enqueue-only）               | **202**                    |
| 7   | GET    | `/api/v1/keyword-analyses`                                                    | 分析歷史清單（分頁/status 過濾，FR-23）      | 200                        |
| 8   | GET    | `/api/v1/keyword-analyses/:id`                                                | 輪詢分析狀態                                 | 200                        |
| 9   | DELETE | `/api/v1/keyword-analyses/:id`                                                | 取消分析                                     | 200                        |
| 10  | GET    | `/api/v1/keyword-analyses/:id/stream`                                         | SSE 進度串流                                 | 200（`text/event-stream`） |
| 11  | GET    | `/api/v1/keyword-analyses/:id/keywords`                                       | 讀取關鍵字列表（篩選/排序/分頁）             | 200                        |
| 12  | POST   | `/api/v1/keyword-analyses/:id/query`                                          | 具名視圖 view router（dashboard 表/圖/趨勢） | 200                        |
| 13  | POST   | `/api/v1/keyword-analyses/:id/topics`                                         | 觸發主題分群（入列，FR-15）                  | **202**                    |
| 14  | GET    | `/api/v1/keyword-analyses/:id/topics`                                         | 讀取主題分群結果                             | 200                        |
| 15  | GET    | `/api/v1/keyword-analyses/:id/topics/stream`                                  | 主題分群 SSE 進度串流                        | 200（`text/event-stream`） |
| 16  | GET    | `/api/v1/views`                                                               | view metadata（allowedSelect/Filters/Sort）  | 200                        |
| 17  | POST   | `/api/v1/tracking-lists`                                                      | 建立追蹤清單（FR-28）                        | **201**                    |
| 18  | GET    | `/api/v1/tracking-lists`                                                      | 追蹤清單列表                                 | 200                        |
| 19  | GET    | `/api/v1/tracking-lists/:listId`                                              | 清單詳情                                     | 200                        |
| 20  | GET    | `/api/v1/tracking-lists/:listId/series`                                       | 搜量時序（月粒度快照，FR-30）                | 200                        |
| 21  | POST   | `/api/v1/tracking-lists/:listId/members`                                      | 加成員（normalizedText 去重聯集，FR-28）     | 200                        |
| 22  | DELETE | `/api/v1/tracking-lists/:listId/members/:normalizedText`                      | 移除成員                                     | 200                        |
| 23  | PATCH  | `/api/v1/tracking-lists/:listId`                                              | 改名（同 owner 名稱唯一→409）                | 200                        |
| 24  | DELETE | `/api/v1/tracking-lists/:listId`                                              | 刪除清單（級聯搜量快照）                     | 200                        |
| 25  | POST   | `/api/v1/tracking-lists/:listId/refresh`                                      | 手動刷新搜量（入列，FR-29）                  | **202**                    |
| 26  | POST   | `/api/v1/keyword-analyses/:id/ai-insight`                                     | per-view AI 洞察（**同步**，FR-32）          | 200                        |
| 27  | POST   | `/api/v1/keyword-analyses/:id/journey`                                        | 觸發購買歷程分類（入列，FR-33）              | **202**                    |
| 28  | GET    | `/api/v1/keyword-analyses/:id/journey`                                        | 讀取歷程分類 run 狀態                        | 200                        |
| 29  | GET    | `/api/v1/keyword-analyses/:id/journey/stream`                                 | 歷程分類 SSE 進度串流                        | 200（`text/event-stream`） |
| 30  | POST   | `/api/v1/keyword-analyses/:id/custom-classifications`                         | 自訂分類階段一：標籤生成（**同步**，FR-34）  | **201**                    |
| 31  | DELETE | `/api/v1/keyword-analyses/:id/custom-classifications/:cid`                    | 刪除自訂分類（級聯定義+指派+run）            | 200                        |
| 32  | POST   | `/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments`        | 階段二：動態 enum 歸類（入列）               | **202**                    |
| 33  | GET    | `/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments`        | 歸類 run 狀態                                | 200                        |
| 34  | GET    | `/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments/stream` | 歸類 SSE 進度                                | 200（`text/event-stream`） |
| 35  | POST   | `/api/v1/ai-ideation`                                                         | AI 輔助發想（**同步**，FR-35）               | 200                        |

> **購買歷程 / 自訂分類的「表/圖」查詢免新端點**：`journey`/`journey_funnel` 與 `custom:{classificationId}` 皆為 **view**，經 #12 `POST /:id/query {view}` 查（view-router，資料來自既有表；custom view 動態解析）。
> **FR-31（per-keyword AI 意圖摘要，SERP-grounded）之 `POST /:id/ai-intent-summary` 尚未實作**——依 v3.5 排程調整**延至 M14 之後**（歸納輸入＝extension `googleSearch` SERP 捕獲，相依 M13 ingestion + M14 捕獲）。

---

## 1. `GET /health`

免認證。回 `@nestjs/terminus` 健康檢查結果；DB（Prisma `SELECT 1`）或 cache（Redis/Keyv probe）任一 down → **503**。

```json
{
  "status": "ok",
  "info": { "database": { "status": "up" }, "cache": { "status": "up" } },
  "error": {},
  "details": { "database": { "status": "up" }, "cache": { "status": "up" } }
}
```

---

## 2. `POST /api/v1/keyword-analyses` — 建立分析

Enqueue-only：驗證入參 → 算 idempotency key → 建 `KeywordAnalysis`（status=`queued`）+ 入列 → 回 **202**。**不**呼叫任何外部 API（NFR-1）。相同 seeds+params 重送 → idempotent，回同一 `analysisId`（不重複入列）。

**Request body**（`CreateKeywordAnalysisDto`，`whitelist + forbidNonWhitelisted`）：

| 欄位           | 型別       | 必填 | 預設            | 限制                                            |
| -------------- | ---------- | ---- | --------------- | ----------------------------------------------- |
| `seeds`        | `string[]` | ✅   | —               | 至少 1 筆（`ArrayMinSize(1)`）                  |
| `geo`          | `string`   | ✅   | —               |                                                 |
| `language`     | `string`   | ✅   | —               |                                                 |
| `network`      | `string`   |      | `GOOGLE_SEARCH` | `GOOGLE_SEARCH` \| `GOOGLE_SEARCH_AND_PARTNERS` |
| `includeAdult` | `boolean`  |      | `false`         |                                                 |
| `mode`         | `string`   |      | `expand`        | `expand`（拓展）\| `exact`（指定取歷史指標）    |

```jsonc
// 200-shaped body → 實際回 202
{ "analysisId": "3f8c…-uuid" }
```

空 `seeds`、缺 `geo`/`language`、非法 `mode`/`network`、未宣告欄位 → **400**（含欄位級錯誤）。

---

## 3. `GET /api/v1/keyword-analyses/:id` — 輪詢狀態

**DB `KeywordAnalysis` 為真實來源**（BullMQ JobState 無 `partial`/`canceled` 語意且會被 retention 逐出）。不存在 → **404**。

```jsonc
{
  "status": "running", // queued|running|completed|partial|failed|canceled（§6.8 狀態機）
  "progress": { "phase": "intent", "percent": 60, "expanded": 120, "labeled": 80, "total": 200 },
  "result": { "resultSnapshotId": null, "count": null }, // completed/partial 時帶實值
  "features": { "keywords": "ready", "trend": "ready", "cpc_histogram": "ready", "…": "…" },
}
```

`features` 回報各 dashboard feature 是否 ready（AC-14.7），前端據此對依賴未產生 compute 的 view 顯示「先執行 X」而非誤導空表。

---

## 4. `DELETE /api/v1/keyword-analyses/:id` — 取消

不存在 → **404**；已終態（completed/failed/canceled）→ 回現狀不覆寫；否則標 `canceled` 並 best-effort 移除佇列任務（active job 鎖住無法 remove → DB status 為權威）。

```jsonc
{ "status": "canceled" }
```

---

## 5. `GET /api/v1/keyword-analyses/:id/stream` — SSE 進度串流

`Content-Type: text/event-stream`。事件（Design §6.3）：

| `event:`    | `data:`                                           | 時機                           |
| ----------- | ------------------------------------------------- | ------------------------------ |
| `progress`  | `{ phase, percent, expanded?, labeled?, total? }` | 進度推進                       |
| `completed` | `{ resultSnapshotId, count }`                     | 完成（串流隨後 complete）      |
| `failed`    | `{ error }`                                       | 失敗/取消（串流隨後 complete） |

行為：先查 DB 狀態 —— 不存在 → 回**空串流**即完成（正確 404 由 `GET :id` 負責，SSE 已送 200 header 無法改碼）；已終態 → 回一筆終態快照並完成；進行中 → 訂閱即時串流。多 client 同 job 互不干擾。輪詢（端點 3）為 SSE 後備。

---

## 6. `GET /api/v1/keyword-analyses/:id/keywords` — 關鍵字列表

`:id` 經 `ParseUUIDPipe`（非 UUID → **400**，避免 Prisma P2023 → 500）。回 §6.4 `{ data, meta }`（五欄列：`keyword` / `avgMonthlySearches` / `competition` / `cpc` / `intentLabels`）。

**Query 參數**（`FilterKeywordsQueryDto`；空字串 → 未設篩選，非誤轉 `0`/`['']`，M5-R1）：

- 篩選：`volumeMin`/`volumeMax`、`q`（文字 contains）、`intent`（multi-select）、`intentMode`（`any` 預設 \| `all`）、`competition`（multi-select）、`competitionIndexMin`/`Max`、`cpcMin`/`cpcMax`
- 排序：`sortBy`（限白名單欄位）、`sortDir`（`asc`/`desc`；預設 `avgMonthlySearches desc`）
- 分頁：`page`、`pageSize`（≤ `QUERY_MAX_PAGE_SIZE`=200，超出 → 400）、`cursor`

任一 range `min > max`、非法值、未宣告欄位 → **400 + 欄位錯誤**。

---

## 7. `POST /api/v1/keyword-analyses/:id/query` — 具名視圖 view router

前端只給 `view` + select/filters/sort/pagination；`QueryViewService` 依 view 白名單/上限驗證。新增 dashboard 表 = 多註冊一個 `ViewDefinition`（免新 endpoint、免 migration）。

**Request body**（`QueryDto`）：`view`（必填）、`select?`、`filters?`（共用 `FilterSpec`，同端點 6）、`sort?`（`{ field, direction }[]`）、`pagination?`（`{ page?, pageSize?, cursor? }`）。

**內建 view**：

| `view`                | 型別  | 回傳形狀                              | 狀態                                             |
| --------------------- | ----- | ------------------------------------- | ------------------------------------------------ |
| `keywords`            | table | `{ view, columns, rows, pagination }` | ✅                                               |
| `trend`               | trend | `{ view, axis, total, series }`       | ✅                                               |
| `intent_distribution` | chart | `{ view, groups, meta }`              | ✅                                               |
| `cpc_histogram`       | chart | `{ view, groups, meta }`              | ✅                                               |
| `serp_questions`      | table | —                                     | 已註冊、compute 未實作（M7 SERP）→ feature-gated |
| `intent_topics`       | table | —                                     | 已註冊、compute 未實作（M8 分群）→ feature-gated |

驗證失敗（未知 view / 非 allowedSelect·Filters·Sort / `pageSize` 超上限 / `min>max` / 引擎 bounds）→ **400**；分析不存在 → **404**；view 依賴的 feature 未 ready → **409 FEATURE_NOT_READY**（先於載入整份 snapshot，M6-R6）。

**M12 新增 view（經同一 view-router，#12 `/query`）**：`journey`（購買歷程表，每字一 `stage`）、`journey_funnel`（7 階段漏斗 chart）、`custom:{classificationId}`（自訂分類表，每字一 `label`；**動態解析**——view 名含 cid，由 `SnapshotQueryService` 解析、以 `keyword_custom_assignments` left-join `label`）。gating：journey 依賴 completed journey run（否則 409）；`custom:{cid}` 未知 cid/不屬此分析→404、無 completed 歸類 run→409。

---

## M11–M12 端點契約（#17–#35）

M11 追蹤清單（#17–#25）與 M12 Search 線 AI 功能（#26–#35）的完整 request/response 以 `openapi.json`（`pnpm openapi:generate` 自省產出）+ controller/DTO 為權威；以下為要點與**同步 vs async job 取捨**。

### M11 追蹤清單（FR-28~30，M11）

owner-scoped（session actor 受 owner 過濾、非 owner→404；`x-api-key` 機器身分不套 owner 過濾）。加成員以 `normalizedText` 去重聯集、主題列展開攤平、geo/language 不一致→400；同 owner 清單名唯一→409；成員/清單上限→409。`GET /:listId/series` 回月粒度搜量時序（缺點 `null` 不補 0，store-on-change dedup，`fetchedAt`＝觀測時點）。`POST /:listId/refresh`＝入列 repeatable-style 手動刷新（202，經 `AdsRateLimiter` exact ≤20 批）。

### M12 Search 線 AI 功能（FR-32~35，M12）— 同步 vs async job 取捨

| 功能（FR）                    | 端點                                                                          | 模式                                                                                      | 取捨理由                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **per-view AI 洞察**（FR-32） | #26 `POST /:id/ai-insight`                                                    | **同步 200**                                                                              | 單次 LLM、輸入＝view 聚合結果、無外部長流程；快取 by `(snapshotId,view,filters-hash)`。LLM 失敗→**502** `AI_INSIGHT_GENERATION_FAILED`。                                                                                                               |
| **購買歷程分類**（FR-33）     | #27–#29 `POST/GET/@Sse /:id/journey` + `/query{view:journey\|journey_funnel}` | **async job**（202→GET/SSE）                                                              | 整批 LLM 貼標（7 階段固定 enum）、成本高；idempotency + partial；不覆寫 `keyword_intents`（獨立 `keyword_journey_assignments`）。                                                                                                                      |
| **自訂分類 HITL**（FR-34）    | #30–#34 + `DELETE` + `/query{view:custom:{cid}}`                              | 階段一**同步 201**（標籤生成）／階段二 **async job 202**（動態 enum 歸類）／查詢/刪除同步 | 階段一單次 LLM；階段二整批動態 enum LLM（確認標籤為 enum、results 數＝輸入數、缺漏→sentinel `unclassified`）；動態 view 免新端點/免 migration。                                                                                                        |
| **AI 輔助發想**（FR-35）      | #35 `POST /ai-ideation`                                                       | **同步 200**                                                                              | 單次 LLM、不打 Ads、不拓展、無外部長流程；`template`＝allowlist key→server-controlled directive（未知→400）、`seeds` S19 注入隔離；輸出 `{keywords}` 去重+上限、形狀相容 #6 `seeds`（不自動建立分析）。LLM 失敗→**502** `IDEATION_GENERATION_FAILED`。 |

**同步小端點刻意偏離 INV-3 async 契約**（單次 LLM 完成、無外部長流程 → 走 202 job 反增延遲與輪詢成本）；「超量降級短 job」門檻（如 `IDEATION_SYNC_MAX`）本期未定、留待未來 p95 壓力（Design §17.4）。**FR-31（per-keyword AI 意圖摘要）延至 M14 後**（SERP-grounded、相依 M13+M14）。

---

## 錯誤信封

所有例外經全域 `HttpExceptionFilter` 統一序列化（`ErrorResponse`）：

```jsonc
{
  "statusCode": 400,
  "code": "BAD_REQUEST", // HttpStatus 名或驗證自帶 code（如 FEATURE_NOT_READY）
  "message": "volumeMin must not be greater than volumeMax",
  "fields": { "volumeMin": ["…"] }, // 僅驗證錯誤帶欄位級細節
  "path": "/api/v1/keyword-analyses/…/keywords",
  "timestamp": "2026-07-02T00:00:00.000Z",
}
```

非 `HttpException`（未預期 500）：完整錯誤只進 server log（stack 經 `scrubSecrets` 遮罩連線字串/token），回應僅回通用 `Internal server error`（不洩漏 stack/祕密，NFR-5）。

## 常見狀態碼

| 碼  | 情境                                                     |
| --- | -------------------------------------------------------- |
| 201 | 建帳號成功（`auth/register`）                            |
| 202 | 建立分析 / 主題分群已入列（enqueue-only）                |
| 400 | 入參/query 驗證失敗、非 UUID id、`min>max`、未知 view    |
| 401 | 缺/錯 `x-api-key`、缺/失效 session、登入憑證錯           |
| 403 | CSRF：session 狀態變更 `Origin` ∉ `ALLOWED_ORIGINS`      |
| 404 | analysisId 不存在、或越權存取他人資源（反枚舉）          |
| 409 | view feature 未 ready（`FEATURE_NOT_READY`）、email 重複 |
| 500 | 未預期伺服器錯誤（不洩漏細節）                           |
| 503 | `/health` DB 或 cache down                               |
