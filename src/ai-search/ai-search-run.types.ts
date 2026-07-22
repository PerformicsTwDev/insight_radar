/** AI Search 抓取 run 狀態（T14.6，FR-41/AC-41.x；沿用 INV-3 async job 契約終態集）。 */
export type AiSearchRunStatus =
  'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'canceled';

/**
 * AI Search 抓取 run 的版本參數（入 idempotency key + 持久化）；bump 任一版本 → 新 run。
 * keywords/channels/brandProfileId 不入此物件——它們是 idempotency 的**語意輸入**（於 key 直接編碼），
 * 且 processor 由 job payload 取得（reset 重入列時由當次請求 DTO 重建），故 run 只需存版本 provenance。
 *
 * **兩層版本皆納入（M15-R5/#687）**：`schemaVersion`＝抓取層（`AI_SEARCH_SCHEMA_VERSION`）；
 * `analysisSchemaVersion`＝分析層（`AI_VISIBILITY_SCHEMA_VERSION`，T15.5 in-job 分析用它 tag
 * `ai_answers`/`ai_cited_references`/`ai_visibility_metrics` 落列）。缺後者則 bump 分析版本 + 同輸入 POST 會命中
 * 既有 completed run（不在 RESETTABLE_TERMINAL_STATUSES → 不 reset）→ 分析永不重跑、rows 停留舊版本。
 */
export interface AiSearchRunParams {
  schemaVersion: string;
  analysisSchemaVersion: string;
}

/**
 * AI Search 抓取管線的 schema 版本（入 params + idempotency key）；抓取形狀/合流語意變動即 bump → 允許新 run。
 * 與 M15 分析層 `AI_VISIBILITY_SCHEMA_VERSION` 分工（此為抓取層）。
 */
export const AI_SEARCH_SCHEMA_VERSION = 'ai-search-v1';

/** 終態集（SSE 據此停止串流；completed/partial 有結果、failed/canceled 為失敗）。 */
export const TERMINAL_AI_SEARCH_STATUSES: ReadonlySet<AiSearchRunStatus> =
  new Set<AiSearchRunStatus>(['completed', 'partial', 'failed', 'canceled']);

/** AI Search job 進度階段（SSE / GET 回報）。`analyzing`＝T15.5 分析 stage（三線 pipeline + 指標落庫）。 */
export type AiSearchPhase = 'pulling' | 'collecting' | 'persisting' | 'analyzing' | 'done';

/** GET /ai-search-analyses/:id 回應（run 狀態，供輪詢）。captures 明細另經 M15 讀取層 view-router。 */
export interface AiSearchStatusResponse {
  jobId: string;
  status: string;
  progress: unknown;
  captureCount: number | null;
}

/** run 投影（repository → service）。 */
export interface AiSearchRunView {
  id: string;
  ownerId: string | null;
  status: string;
  progress: unknown;
  captureCount: number | null;
}
