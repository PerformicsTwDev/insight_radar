import type { FilterSpec } from '../keywords/filter-spec';

/**
 * per-view AI 洞察請求（FR-32 / AC-32.1 輸入）：對某 `view` 套用選配 `filters`（+ `select`）後的
 * 聚合結果為 LLM 輸入。`filters` 與 `/query` 共用同一 {@link FilterSpec}（S9：cache filters-hash 一致）。
 */
export interface AiInsightRequest {
  view: string;
  filters?: FilterSpec;
  select?: string[];
}

/** per-view AI 洞察結果（AC-32.1 回應形狀 `{ view, insight, generatedAt }`）。 */
export interface AiInsight {
  view: string;
  insight: string;
  /** ISO-8601 產生時點（快取命中時保留原始生成時間）。 */
  generatedAt: string;
}
