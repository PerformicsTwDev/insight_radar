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

## 端點總覽（44）

認證端點（#2–#5）細節見上方「認證端點」節；以下為完整對外 HTTP 介面（`/health` 除外皆掛 `/api/v1`）。詳細 request/response 契約以下方分節與 controller/DTO 為準（M8/M9 list/topics/views、**M11 追蹤清單（#17–#25）與 M12 Search 線 AI 功能（#26–#35）**尚未補逐一分節，以此表 + 下方「M11–M12 端點契約」節 + `openapi.json`（自省產出、權威契約來源）為準；**M13 capture ingestion（#36）見下方「M13 Capture ingestion」分節**；**M14 品牌檔案（#37–41）與 AI Search 抓取（#42–44）見下方「M14 品牌檔案 + AI Search 抓取」分節**）。

| #   | Method | Path                                                                          | 說明                                                 | 成功碼                     |
| --- | ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| 1   | GET    | `/health`                                                                     | 健康檢查（DB + cache probe）                         | 200 / 503                  |
| 2   | POST   | `/api/v1/auth/register`                                                       | 建帳號（`@Public`）                                  | **201**                    |
| 3   | POST   | `/api/v1/auth/login`                                                          | 登入（設 session cookie，`@Public`）                 | 200                        |
| 4   | POST   | `/api/v1/auth/logout`                                                         | 登出（撤銷 session，受 CsrfGuard）                   | 200                        |
| 5   | GET    | `/api/v1/auth/me`                                                             | 取當前使用者（`@Public`，self-guard）                | 200                        |
| 6   | POST   | `/api/v1/keyword-analyses`                                                    | 建立分析（入列，enqueue-only）                       | **202**                    |
| 7   | GET    | `/api/v1/keyword-analyses`                                                    | 分析歷史清單（分頁/status 過濾，FR-23）              | 200                        |
| 8   | GET    | `/api/v1/keyword-analyses/:id`                                                | 輪詢分析狀態                                         | 200                        |
| 9   | DELETE | `/api/v1/keyword-analyses/:id`                                                | 取消分析                                             | 200                        |
| 10  | GET    | `/api/v1/keyword-analyses/:id/stream`                                         | SSE 進度串流                                         | 200（`text/event-stream`） |
| 11  | GET    | `/api/v1/keyword-analyses/:id/keywords`                                       | 讀取關鍵字列表（篩選/排序/分頁）                     | 200                        |
| 12  | POST   | `/api/v1/keyword-analyses/:id/query`                                          | 具名視圖 view router（dashboard 表/圖/趨勢）         | 200                        |
| 13  | POST   | `/api/v1/keyword-analyses/:id/topics`                                         | 觸發主題分群（入列，FR-15）                          | **202**                    |
| 14  | GET    | `/api/v1/keyword-analyses/:id/topics`                                         | 讀取主題分群結果                                     | 200                        |
| 15  | GET    | `/api/v1/keyword-analyses/:id/topics/stream`                                  | 主題分群 SSE 進度串流                                | 200（`text/event-stream`） |
| 16  | GET    | `/api/v1/views`                                                               | view metadata（allowedSelect/Filters/Sort）          | 200                        |
| 17  | POST   | `/api/v1/tracking-lists`                                                      | 建立追蹤清單（FR-28）                                | **201**                    |
| 18  | GET    | `/api/v1/tracking-lists`                                                      | 追蹤清單列表                                         | 200                        |
| 19  | GET    | `/api/v1/tracking-lists/:listId`                                              | 清單詳情                                             | 200                        |
| 20  | GET    | `/api/v1/tracking-lists/:listId/series`                                       | 搜量時序（月粒度快照，FR-30）                        | 200                        |
| 21  | POST   | `/api/v1/tracking-lists/:listId/members`                                      | 加成員（normalizedText 去重聯集，FR-28）             | 200                        |
| 22  | DELETE | `/api/v1/tracking-lists/:listId/members/:normalizedText`                      | 移除成員                                             | 200                        |
| 23  | PATCH  | `/api/v1/tracking-lists/:listId`                                              | 改名（同 owner 名稱唯一→409）                        | 200                        |
| 24  | DELETE | `/api/v1/tracking-lists/:listId`                                              | 刪除清單（級聯搜量快照）                             | 200                        |
| 25  | POST   | `/api/v1/tracking-lists/:listId/refresh`                                      | 手動刷新搜量（入列，FR-29）                          | **202**                    |
| 26  | POST   | `/api/v1/keyword-analyses/:id/ai-insight`                                     | per-view AI 洞察（**同步**，FR-32）                  | 200                        |
| 27  | POST   | `/api/v1/keyword-analyses/:id/journey`                                        | 觸發購買歷程分類（入列，FR-33）                      | **202**                    |
| 28  | GET    | `/api/v1/keyword-analyses/:id/journey`                                        | 讀取歷程分類 run 狀態                                | 200                        |
| 29  | GET    | `/api/v1/keyword-analyses/:id/journey/stream`                                 | 歷程分類 SSE 進度串流                                | 200（`text/event-stream`） |
| 30  | POST   | `/api/v1/keyword-analyses/:id/custom-classifications`                         | 自訂分類階段一：標籤生成（**同步**，FR-34）          | **201**                    |
| 31  | DELETE | `/api/v1/keyword-analyses/:id/custom-classifications/:cid`                    | 刪除自訂分類（級聯定義+指派+run）                    | 200                        |
| 32  | POST   | `/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments`        | 階段二：動態 enum 歸類（入列）                       | **202**                    |
| 33  | GET    | `/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments`        | 歸類 run 狀態                                        | 200                        |
| 34  | GET    | `/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments/stream` | 歸類 SSE 進度                                        | 200（`text/event-stream`） |
| 35  | POST   | `/api/v1/ai-ideation`                                                         | AI 輔助發想（**同步**，FR-35）                       | 200                        |
| 36  | POST   | `/api/v1/captures`                                                            | Capture 批次 ingestion（raw append-only，FR-36）     | **202**                    |
| 37  | POST   | `/api/v1/brand-profiles`                                                      | 建立品牌檔案（brand+competitors+aliases，FR-40）     | **201**                    |
| 38  | GET    | `/api/v1/brand-profiles`                                                      | 品牌檔案列表（owner-scoped）                         | 200                        |
| 39  | GET    | `/api/v1/brand-profiles/:id`                                                  | 品牌檔案詳情                                         | 200                        |
| 40  | PATCH  | `/api/v1/brand-profiles/:id`                                                  | 改品牌檔案（同 owner 名稱唯一→409）                  | 200                        |
| 41  | DELETE | `/api/v1/brand-profiles/:id`                                                  | 刪除品牌檔案                                         | 200                        |
| 42  | POST   | `/api/v1/ai-search-analyses`                                                  | 觸發 AI Search 抓取 job（入列，enqueue-only，FR-41） | **202**                    |
| 43  | GET    | `/api/v1/ai-search-analyses/:id`                                              | 輪詢抓取 run 狀態                                    | 200                        |
| 44  | GET    | `/api/v1/ai-search-analyses/:id/stream`                                       | 抓取 SSE 進度串流                                    | 200（`text/event-stream`） |

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

## M13 Capture ingestion（FR-36/37，M13）

統一 capture ingestion 端點。前端**代 extension 轉發**（push primary，走 session cookie），把橋接抓到的 AI 回答 / 社群貼文批次推進 **raw append-only** 層（`captures` 表），供後續分析線（M14+）消費。extension direct-push（v2/PAT）為預留、本期不啟用（見 `CAPTURE_PAT_ENABLED`）。

### #36 `POST /api/v1/captures` — 批次 ingestion

**請求**（`CaptureIngestDto`；全域 `ValidationPipe` whitelist + forbidNonWhitelisted）：

```jsonc
{
  "source": "extension", // 必填 enum（S20）：extension（primary）｜serpapi｜threadsApi（reserved）；未知→400。內部產物 `merged` 不可 push
  "channel": "chatGpt", // AI 類選填（S20）：chatGpt｜geminiApp｜googleAiMode｜googleSearch｜aiOverview｜aiMode｜bingCopilot；給值須在 enum
  "platform": "threads", // Social 類選填（S20）：threads｜facebook｜dcard｜ptt｜customDomain；channel/platform 二擇一（皆給→mapper 層 ambiguous）
  "schemaVersion": "v1", // 必填非空（S15）；值須在 CAPTURE_ACCEPTED_SCHEMA_VERSIONS allowlist（service 層斷言）
  "items": [{/* 該來源原始 payload */}], // 非空陣列、每筆為物件；item 內部形狀不驗（raw 保留，per-source mapper 於分析線收斂）
}
```

**成功回應 `202 Accepted`**（`IngestResult`）：

```jsonc
{
  "accepted": 2, // 本請求實際新落列數
  "deduped": 1, // 命中既有列數（同批內重複 + 跨批重送）
  "ids": ["<uuid>", "<uuid>", "<uuid>"], // 逐輸入 item 對齊（長度＝items.length）；accepted + deduped === items.length
}
```

**契約重點**：

- **content-hash idempotency（S16 / AC-36.2）**：去重鍵 `contentHash = sha256(canonical(source, schemaVersion, item))`（`captures.content_hash` NOT NULL + `@@unique`）。同批內同 hash 只落一列、重複位置回同一 id 並計入 `deduped`；跨批重送同內容→命中既有列、**不重複落列、不覆寫**（raw append-only）、回既有 id 計 `deduped`。並發同 hash 以 `createMany({ skipDuplicates })` 的 `ON CONFLICT DO NOTHING` 由 DB `@@unique` 仲裁（不拋 P2002），回讀權威 id 對帳——`accepted` 僅計「權威 id === 本請求 mint 的 uuid」者（並發下唯一贏家）。
- **schemaVersion allowlist（S15 / AC-36.3）**：缺（DTO 擋非空）或值不在 `CAPTURE_ACCEPTED_SCHEMA_VERSIONS`（逗號分隔 env，預設 `v1`）→ **400**（於 DB 前、不靜默套預設、不猜形狀）。extension 契約現況無 schema versioning，本端點以此欄補上缺口。
- **請求形狀守門（AC-36.5 / NFR-17）**：批次 `items` 數 > `INGEST_BATCH_MAX`（預設 500）→ **413**（service 層先於 contentHash/DB，防 DoS 放大）；request body > `INGEST_BODY_LIMIT_MB`（預設 10MB，**獨立於全域 `BODY_LIMIT_MB`**，端點掛專屬 body parser）→ **413**。DTO 驗證失敗（缺 `source`/未知 enum/空 `items`）→ **400**。
- **認證 + owner 歸屬（FR-27 / AC-36.4）**：全域 `CompositeAuthGuard`（缺/錯認證→**401**）+ `CsrfGuard`（session 狀態變更需同源 Origin）。owner 唯一強制點在 service 落庫：session→`ownerId = user.id`、`x-api-key` 機器身分→`ownerId = null`。
- **能力協商 gating（S21 / NFR-21 / AC-51.4）**：extension `EXTERNAL_PONG.features[]` 對照 `EXTENSION_BRIDGE_REQUIRED_FEATURES`（期望渠道基準）；**未回報的渠道→not-available（gating：前端轉發鏈不轉發、不編造）**，非硬崩、非套空資料。純函式 `negotiateCapabilities`（`src/captures/capability-negotiation.ts`）供前端 gating 與後端契約測試。

### schema versioning

`schemaVersion` 是**每筆 capture 的 payload 形狀契約版本**（extension 各站 raw 形狀 → per-source mapper 於分析線依 `(source, discriminator, schemaVersion)` 選對應 mapper 收斂）。營運上以 `CAPTURE_ACCEPTED_SCHEMA_VERSIONS`（env allowlist）控制「本服務**願意受理**的版本集合」：extension 升級 payload 形狀 → 先在 repo 加對應 exact-version mapper → 再把新版本加入 allowlist（避免收到無 mapper 可解的版本）。`source`/`channel`/`platform` 三個 allowlist**不是 env**——為封閉集合，由 DTO const enum（`@IsIn` + OpenAPI `enum`）＋ mapper registry 共同界定/強制（新增渠道/平台＝加 mapper + 擴 enum 的程式變更，非 env 開關；env-gating 無 mapper 支撐＝fake configurability）。

---

## M14 品牌檔案 + AI Search 抓取（FR-40/41，M14）

AI 線資料面。**extension push 為主管道**（前端代 extension 把 AI 回答經 #36 `POST /captures` 推入 raw 層），**SerpAPI pull 為 reserved 來源**（`SERPAPI_AI_ENABLED=false` 預設關，保留 adapter 骨架供未來切換）。AI Search 抓取 job（#42–44）把兩路依 query 集合流成 `ai_search_captures`（以 jobId 關聯），供 M15 可見度分析讀取。品牌檔案（#37–41）綁 `ownerId`，供 M15 品牌抽取/別名比對。

### #37–41 品牌檔案 CRUD（`/api/v1/brand-profiles`，FR-40）

**請求**（`CreateBrandProfileDto`；`PATCH` 為欄位級 partial）：

```jsonc
{
  "brand": { "name": "Asus", "aliases": ["華碩"], "sites": ["asus.com"] }, // 必填；name 非空（缺→400）
  "competitors": [{ "name": "Acer", "aliases": ["宏碁"], "sites": ["acer.com"] }], // 選填，缺省 []；≤100
}
```

**契約重點**：

- **owner scope 唯一強制點在 service 層（AC-27.4/S8）**：建立歸屬 actor（session→`ownerId=user.id`、`x-api-key`→`ownerId=null`）；列表以 `ownerWhere` 過濾；單列越權/不存在 → **同一 404**（不洩漏存在性）。`?ownerId=`/body `ownerId` 無法覆寫（`forbidNonWhitelisted`→400）。
- **同 owner `brand.name` 唯一**（`@@unique([ownerId,name])`）：重名建立/改名撞 P2002 → **409**。
- **成功碼**：`POST`→**201**、`GET`/`PATCH`/`DELETE`→200；非 UUID `:id`→400（`ParseUUIDPipe`）；缺/錯認證→401。
- **別名 AI 補全（AC-40.2 should）延 M15**（與 FR-42 LLM pipeline 一併搬）；本期 aliases 為純函式正規化比對（`brand-match.ts`，複用 `normalizeText`）。

### #42–44 AI Search 抓取 job（`/api/v1/ai-search-analyses`，FR-41，INV-3 async job）

抓取線的 async job 契約（藍本＝keyword-analysis：202 enqueue-only / GET 輪詢 / SSE 進度 / idempotency / partial）。

**請求**（`CreateAiSearchAnalysisDto`）：

```jsonc
{
  "keywords": ["asus zenbook", "macbook air"], // 必填非空；共用 normalizeText 去重排序（入 idempotency key）
  "channels": ["chatGpt", "googleAiMode", "aiOverview"], // 必填非空、去重；渠道 enum（S20）；未知→400
  "brandProfileId": "<uuid>", // 選填（FR-40）；供 M15 可見度分析，本抓取層僅記錄關聯；非 UUID→400
}
```

**成功回應 `202 Accepted`**：`{ "jobId": "<uuid>" }`（idempotency 命中回同一 jobId，不重複入列）。

**契約重點**：

- **enqueue-only（NFR-1）**：`POST` 路徑零外部呼叫，委派 service 入列即回 202。SerpAPI pull / extension push 合流皆在 worker（processor）。
- **渠道 → 來源路由（AC-41.2，同一 enum 分工）**：`chatGpt/geminiApp/googleAiMode/googleSearch`＝**extension push（primary）**——job 內收 `POST /captures` 已推入的 raw extension capture，經 `mapAiCapture` 收斂 + 依 query 集（共用 `normalizeText`）合流；`aiOverview/aiMode/bingCopilot`＝**SerpAPI pull（reserved）**——job 內經 `SerpAiProvider` 拉取，`SERPAPI_AI_ENABLED=false` 時 short-circuit null（零外部呼叫）。
- **jobId 關聯（合流）**：raw `captures` 無 jobId → canonical 層以 query-set 關聯、tag `runId(=jobId)` 落 `ai_search_captures`；重入列/retry 先 `deleteByJobId` 清舊合流列（idempotent re-run）。
- **partial（INV-6）**：任一請求渠道零 capture（reserved 關閉、或 extension 未推該渠道）→ **`partial`**（該格 null，**不整批失敗**）；全渠道覆蓋 → `completed`。mapper malformed / provider degradation 皆回 null-不拋，故正常路徑恆完成；僅基礎設施錯（Prisma/Redis）於**最終 attempt** 標 `failed` 並依 `JOB_ATTEMPTS` 重試。
- **idempotency（AC-41.1）**：key = `sha256(canonical(ownerScope, normalizedKeywords, channels 排序, brandProfileId, {schemaVersion}))`——**owner 分範圍**（跨租戶不撞、杜絕回不可讀 jobId）；`AI_SEARCH_SCHEMA_VERSION`（`ai-search-v1`，抓取層版本）bump 即新 run；並發 P2002 慢路徑仲裁；terminal-failed/canceled → reset queued 重入列。
- **owner scope（FR-27/AC-41.3）**：`GET :id` / SSE 未知或他人 run → **404**（GET，`assertOwnedRow`）／空串流（SSE，`canAccess` 不拋，不洩漏存在性）。`x-api-key` 機器身分不套 owner 過濾。
- **成功碼**：`POST`→**202**、`GET :id`→200、`GET :id/stream`→200（`text/event-stream`）；非 UUID `:id`→400；空 keywords/空或未知 channel/非 UUID brandProfileId→400；缺/錯認證→401。
- **狀態機**：`queued|running|completed|partial|failed|canceled`；`GET :id` 回 `{jobId,status,progress,captureCount}`；抓取 captures 明細另經 M15 讀取層 view-router（不在此端點）。

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

| 碼  | 情境                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------- |
| 201 | 建帳號成功（`auth/register`）                                                                                   |
| 202 | 建立分析 / 主題分群已入列（enqueue-only）；capture 批次已受理（`captures`）                                     |
| 400 | 入參/query 驗證失敗、非 UUID id、`min>max`、未知 view、`schemaVersion` 不在 allowlist                           |
| 413 | request body 逾上限（全域 `BODY_LIMIT_MB` / capture `INGEST_BODY_LIMIT_MB`）、capture 批次逾 `INGEST_BATCH_MAX` |
| 401 | 缺/錯 `x-api-key`、缺/失效 session、登入憑證錯                                                                  |
| 403 | CSRF：session 狀態變更 `Origin` ∉ `ALLOWED_ORIGINS`                                                             |
| 404 | analysisId 不存在、或越權存取他人資源（反枚舉）                                                                 |
| 409 | view feature 未 ready（`FEATURE_NOT_READY`）、email 重複                                                        |
| 500 | 未預期伺服器錯誤（不洩漏細節）                                                                                  |
| 503 | `/health` DB 或 cache down                                                                                      |
