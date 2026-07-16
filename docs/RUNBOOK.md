# insight_radar — 維運手冊（Runbook）

面向部署與值班：節流、退避/重試、快取失效、部署、優雅關閉。可調參數集中在 env（見 [`.env.example`](../.env.example) / `src/config/env.validation.ts`），改行為前優先調 config 而非改碼。

---

## 1. 節流 — Google Ads ~1 QPS / CID

- **機制**：集中式、Redis-backed、以 CID 為 key 的 `AdsRateLimiter`（ADR-0001；**不是** BullMQ worker limiter）。每次 `schedule(cid, fn)` 先向 Redis 用 Lua **原子預約** per-CID 下一個可用時槽（`minTime = ceil(1000 / GOOGLE_ADS_QPS)`），跨多 worker 序列化。
- **參數**：`GOOGLE_ADS_QPS`（預設 1）。時槽 key TTL = `(slot-now) + minTime + buffer`，故意大於它所存的未來時槽 —— 勿手動縮短，否則 burst 尾段 key 提早過期 → 反 1 QPS 突發。
- **每批 seed ≤ 20**（`GOOGLE_ADS_SEED_BATCH_SIZE`，預設保守 15）：>20 → Ads `InvalidArgument`（不可重試）。歷史批 `GOOGLE_ADS_HISTORICAL_BATCH_SIZE`（預設 1000，硬上限 10000）。
- **worker 並發**：`WORKER_CONCURRENCY`（預設 5）與 Ads QPS、LLM `LLM_CONCURRENCY`（預設 6）為三個獨立維度。調高 worker 並發**不會**放大 Ads QPS（限流器跨 worker 生效）。

**症狀 → 處置**：Ads `RESOURCE_EXHAUSTED` 頻繁 → 確認 `GOOGLE_ADS_QPS` 未被調高、Redis 可用（限流器需 Redis）；LLM 429/超時 → 降 `LLM_CONCURRENCY` 或 `LLM_BATCH_SIZE`。

---

## 2. 退避與重試 — 兩層分工（NFR-9 / Design §11）

**關鍵：兩層互斥，避免整 job 重跑放大 Ads 用量。**

| 層                        | 範圍              | 觸發                                                                       | 參數                                                                                                                         |
| ------------------------- | ----------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Job 內就地退避**        | 單一 Ads/LLM 呼叫 | Ads 暫時性錯誤（`RESOURCE_EXHAUSTED`/`TEMPORARILY_EXHAUSTED`）、LLM 暫時錯 | `GOOGLE_ADS_MAX_RETRIES`（5）、`GOOGLE_ADS_BACKOFF_BASE_MS`（5s→10s→20s + jitter）、`AZURE_OPENAI_MAX_RETRIES`               |
| **BullMQ job-level 重試** | 整個 job          | **僅**暫時性基礎設施/Redis 故障                                            | `JOB_ATTEMPTS`（5）、`JOB_BACKOFF_MS`（3000，指數 `2^(n-1)*delay`）、`JOB_BACKOFF_JITTER`（0.2，散開重試防 thundering herd） |

- Ads 配額由 **job 內**退避處理；耗盡 → processor 以 `UnrecoverableError` 收尾 → **不**觸發整 job 重跑（否則重打 Ads、放大用量）。Ads 不可重試錯（InvalidArgument）亦 → `UnrecoverableError`。
- job retry 命中暖快取即 **0 Ads 呼叫**（cache-first idempotency，T4）。
- **partial 保留**：終態 Ads 錯但已收集部分資料 → 固化 `status=partial` 的 snapshot（不被 retry 覆寫）。

**症狀 → 處置**：job 反覆整個重跑且重打 Ads → 檢查錯誤分類（`error-classification.ts`）是否誤把 Ads 配額歸為 `INFRA_RETRY_WHOLE_JOB`；正確應為 `UnrecoverableError`。

---

## 3. 快取失效

cache-manager v6 + Keyv/Redis。**TTL 一律毫秒**。namespace（`CacheNamespace`）：

| namespace  | 內容                         | TTL env                         |
| ---------- | ---------------------------- | ------------------------------- |
| `metrics`  | Ads 指標（per-CID+hash）     | `CACHE_TTL_METRICS_MS`（21 天） |
| `intent`   | LLM intent 標籤              | `CACHE_TTL_INTENT_MS`（60 天）  |
| `idemp`    | idempotency key → analysisId | `IDEMP_TTL_MS`（1 天）          |
| `job`      | `job:{id}` 狀態摘要          | `JOB_TTL_MS`（3 天）            |
| `snapshot` | 讀取層快取                   | —                               |

**intent 整批失效**：intent 快取 key 含 `INTENT_SCHEMA_VERSION`（限 `v\d+`）。**schema 或 prompt 變更 → bump 此版本（如 `v1`→`v2`）**，舊 key 自然不再命中（免手動清 Redis）→ 下批重新標。這是 intent 失效的唯一正確手段。

**Ads metrics 失效**：key 含 `normalizedText`（=`lowercase(collapseWhitespace(trim(NFKC)))`，去重 key = 快取 key）。指標刷新靠 TTL 到期；無手動 bump 機制（Ads 資料變動慢）。

**全清（緊急）**：直接對 Redis `FLUSHDB`（會一併清 BullMQ！慎用）——通常改用 bump 版本或等 TTL。

---

## 4. 部署

前置：Node 22.x/24.x、pnpm 9.x、可達的 Postgres + Redis、已設所有 ✅ 必填 env（缺值 → 啟動 Joi fail-fast，服務不會起）。

```bash
pnpm install --frozen-lockfile        # postinstall 會 prisma generate
pnpm prisma:migrate:deploy            # 套用既有 migration（生產用 deploy，非 dev）
pnpm build                            # nest build → dist/
pnpm start:prod                       # node dist/main
```

- **Migration**：`prisma migrate deploy` 只前進、不生成/不改既有 migration。涉 `pg_trgm`/GIN/trgm 索引者已在 migration 手動補 SQL。**勿改已套用的 migration**（hook 會擋）。
- **env / 祕密**：`API_KEY`、六項 Google Ads 憑證、`AZURE_OPENAI_API_KEY` 等祕密由部署環境注入，**絕不進 repo/log/fixture**（NFR-5）。`AZURE_OPENAI_API_VERSION` 須在 allowlist 內（非字典序 `>=`），否則啟動失敗。
- **健康檢查**：部署後打 `GET /health`（免認證）；DB 或 cache down → 503，據此設 readiness probe。
- **前端 SPA（`frontend/`）**：**同源部署**——正式環境靜態檔（`pnpm -C frontend build` → `frontend/dist`）由 NestJS `ServeStatic` 或同一 reverse proxy 供應，與 API 同源（cookie 天然同源、無 CORS）。開發自 frontend M0 起、尚未併入上述後端部署流程；併入時本節補前端 build/serve 步驟。
- **水平擴展**：多 instance 共享同一 Redis/Postgres 安全 —— Ads 限流跨 instance 生效、idempotency 以 DB `@unique` 仲裁、worker 並發由 BullMQ 分派。

---

## 5. 優雅關閉（SIGTERM / `app.close()`，T7.5 / TC-26）

**順序保證：先停 worker 收 job、排空 in-flight，再關相依連線** —— 避免 in-flight job 在 Prisma/cache/Redis 已關後才排空（連線洩漏 / 寫入失敗）。

- `KeywordAnalysisProcessor.onModuleDestroy` `await worker.close()`（停收新 job + 排空目前 job）。因 `KeywordAnalysisModule` 相依 `QueueModule`/`JobEventsModule`，Nest 反相依序**先**銷毀本模組 → drain 早於連線 quit。
- 連線擁有者各自 `onModuleDestroy` 收回 socket：`BullConnectionLifecycle`（Queue Redis）、`JobEventsConnectionLifecycle` + `JobEventsService`（QueueEvents）、`CacheService`（Keyv/Redis）、`AdsRateLimiter`（disconnect Redis）；Prisma lazy connect。
- **部署注意**：SIGTERM 後給足 grace period 讓 in-flight job 排空（依最長 job 時間，含 Ads ~1 QPS 拉取）再強制殺。未排空完就 SIGKILL → 該 job 靠 BullMQ stalled 機制之後重跑（cache-first 下多為 0 Ads 呼叫）。

**驗證**：`test/e2e/graceful-shutdown.e2e-spec.ts` 斷言 worker drain 早於連線 quit 且 `app.close()` 不 hang。

---

## 6. 值班速查

| 症狀                  | 可能原因                   | 處置                                            |
| --------------------- | -------------------------- | ----------------------------------------------- |
| 啟動即 crash          | env 缺值/格式錯            | 看 Joi 錯誤訊息補齊 `.env`；對照 `.env.example` |
| 401 全部請求          | `x-api-key` 未帶/不符      | 確認 client header 與 `API_KEY`                 |
| job 卡 `queued` 不動  | worker 未起 / Redis 不可達 | 查 `/health` cache、worker 日誌、Redis 連線     |
| Ads 用量暴增          | 整 job 重跑放大            | 查錯誤分類是否誤判可重試（見 §2）               |
| intent 標籤過時       | prompt/schema 變更未 bump  | bump `INTENT_SCHEMA_VERSION`（見 §3）           |
| `/health` 503         | DB 或 cache down           | 查 Postgres/Redis 連線                          |
| 關閉時 Jest/程序 hang | 連線未在 shutdown 收回     | 查各 provider `onModuleDestroy`（見 §5）        |

## 7. SSE 串流與 reverse proxy（FR-9 heartbeat）

兩條 SSE 串流（`GET /api/v1/keyword-analyses/:id/stream`、`.../:id/topics/stream`）為長連線。部署於 LB / nginx 等 reverse proxy 後時：

- **關閉回應緩衝**，否則事件會被 proxy 緩衝、前端收不到即時進度：nginx `proxy_buffering off;`（或後端已送 `X-Accel-Buffering: no` header，NestJS SSE 預設帶）。
- **idle timeout 對策已內建**：後端每 `SSE_HEARTBEAT_MS`（預設 15000ms）發一則 `event: heartbeat` 保活事件（named event，非 `:` comment——NestJS `@Sse` serializer 無 comment 支援；前端忽略此事件名）。**確保 proxy 的 idle/read timeout > `SSE_HEARTBEAT_MS`**（常見預設 60s 即安全）；若調長 heartbeat 週期，需同步確認未超過 proxy timeout。
- heartbeat 於串流收到 `completed`/`failed` 終態、或 client 斷線時自動停止（`clearInterval`），無殘留 timer。

## 8. 追蹤刷新 Ads 配額治理（M11，FR-29 / NFR-16）

追蹤清單是**持續**的 Ads 用量來源（與一次性分析不同）：排程 job（`TRACKING_REFRESH_CRON`，預設每日）對**每個清單的每個成員**打 `GenerateKeywordHistoricalMetrics`（exact 模式）刷新搜量。用量由**上限直接治理**：

- **每日 Ads 呼叫量估算**：`≈ ceil(Σ 所有清單成員數 / 20)`（每批 ≤20 seed）。worst-case 上界 = `TRACKING_MAX_LISTS × TRACKING_MAX_MEMBERS_PER_LIST`（預設 `50 × 500 = 25,000` 關鍵字）→ `~1,250` 批。**串行 ~1 QPS/CID**（沿用既有 `AdsRateLimiter`，**不新增限流器、不放大 QPS**，ADR-0001）→ 每日刷新 wall-clock `~1,250 s ≈ 21 分鐘`（worst case，單 CID）。
- **⚠ store-on-change dedup 省的是「儲存」不是「配額」**：dedup（同值略過落列）減少 `VolumeSnapshot` **列數**，但**每日仍需 fetch 每個成員**以比對是否變動——故 Ads **呼叫量 = 全部被追蹤關鍵字 × 每日**，不因 dedup 減少。調高上限前，以上式估算是否撞每日 Ads 用量 / 可在合理 wall-clock 內完成。
- **月粒度語意（S1 / AC-29.3）**：Ads Keyword Plan 指標為**月粒度**；每日刷新追蹤的是「Google 對這些指標的**修訂變化**」而非「每日搜量」。時間軸維度＝觀測時點 `fetchedAt`，勿誤呈現成每日搜量。
- **worker 並發固定 = 1**（BullMQ 預設）：手動刷新（`POST /:listId/refresh`）與排程刷新共用 `tracking-refresh` queue，per-list single-flight（jobId=`refresh:<listId>` + `removeOnComplete`）+ 並發 1 serialize 同清單刷新。**若日後調高 worker concurrency，須加 per-list 鎖**，否則手動與排程可能並發刷新同清單 → store-on-change race 落近似重複列。
- **調參**：`TRACKING_MAX_LISTS` / `TRACKING_MAX_MEMBERS_PER_LIST` 依「每日刷新總關鍵字數 × ~1 QPS/CID」估算天花板；`TRACKING_KEEP_SERIES_ON_DELETE=false`（預設）刪清單連帶刪時序、`true` 保留孤立快照（`VolumeSnapshot` 無 FK cascade，由 service 顯式 `deleteMany`）。`TRACKING_HISTORY_RETENTION_DAYS` 為 reserved（未接線，pruning 為未來任務）。

（值班速查補充：`Ads 用量暴增` 除 §2 錯誤分類外，另查追蹤清單/成員數是否暴增、`TRACKING_REFRESH_CRON` 是否誤設高頻。）
