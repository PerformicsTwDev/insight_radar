# insight_radar — API 契約

後端對外 HTTP API。除 `GET /health` 外，所有端點掛在 **`/api/v1`** 前綴下，且需認證。此文件以 controller/DTO 為事實來源（API e2e 測試守契約）。

## 認證

- 全域 `ApiKeyGuard`：每個請求（`@Public` 標記者除外）須帶 `x-api-key: <API_KEY>` header。
- 缺 key / key 不符 → **401 Unauthorized**（常數時間比對，避免 timing side-channel）。
- `GET /health` 為 `@Public`，免認證。

## 端點總覽（7）

| #   | Method | Path                                    | 說明                                         | 成功碼                     |
| --- | ------ | --------------------------------------- | -------------------------------------------- | -------------------------- |
| 1   | GET    | `/health`                               | 健康檢查（DB + cache probe）                 | 200 / 503                  |
| 2   | POST   | `/api/v1/keyword-analyses`              | 建立分析（入列，enqueue-only）               | **202**                    |
| 3   | GET    | `/api/v1/keyword-analyses/:id`          | 輪詢分析狀態                                 | 200                        |
| 4   | DELETE | `/api/v1/keyword-analyses/:id`          | 取消分析                                     | 200                        |
| 5   | GET    | `/api/v1/keyword-analyses/:id/stream`   | SSE 進度串流                                 | 200（`text/event-stream`） |
| 6   | GET    | `/api/v1/keyword-analyses/:id/keywords` | 讀取關鍵字列表（篩選/排序/分頁）             | 200                        |
| 7   | POST   | `/api/v1/keyword-analyses/:id/query`    | 具名視圖 view router（dashboard 表/圖/趨勢） | 200                        |

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

| 碼  | 情境                                                  |
| --- | ----------------------------------------------------- |
| 202 | 建立分析已入列（端點 2）                              |
| 400 | 入參/query 驗證失敗、非 UUID id、`min>max`、未知 view |
| 401 | 缺/錯 `x-api-key`                                     |
| 404 | analysisId 不存在                                     |
| 409 | view 依賴的 feature 未 ready（`FEATURE_NOT_READY`）   |
| 500 | 未預期伺服器錯誤（不洩漏細節）                        |
| 503 | `/health` DB 或 cache down                            |
