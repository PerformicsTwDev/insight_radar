import type { FilterSpec } from '../keywords/filter-spec';

/**
 * per-view AI 洞察請求（FR-32 / AC-32.1 輸入）：對某 `view` 套用選配 `filters` 後的聚合結果為 LLM 輸入。
 * **刻意不含 `select`/`sort`/`pagination`**（#476）：洞察總結的是「套用篩選後的訊號」而非欄位子集；快取 key
 * （AC-32.2）僅 by `(snapshotId, view, filters-hash)`，若另收 `select` 並轉進 `/query` 會使不同 `select`＋同
 * filters 撞同一 cache entry（same-owner 陳舊/髒命中）。故聚合確定性地只由 `(view, filters)` 決定。
 * `filters` 與 `/query` 共用同一 {@link FilterSpec}（S9：cache filters-hash 一致）。
 */
export interface AiInsightRequest {
  view: string;
  filters?: FilterSpec;
}

/** per-view AI 洞察結果（AC-32.1 回應形狀 `{ view, insight, generatedAt }`）。 */
export interface AiInsight {
  view: string;
  insight: string;
  /** ISO-8601 產生時點（快取命中時保留原始生成時間）。 */
  generatedAt: string;
}
