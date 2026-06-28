import type { RawKeywordMetrics } from './mapping/map-metrics';
import type { RawMonthlySearchVolume } from './mapping/map-monthly-volumes';

/**
 * Google Ads 客戶端 Port（DI 可替換；完整 Adapter 見 T1.8 / M1-R1）。
 * 只暴露本案需要的方法，讓 `GoogleAdsService` 不直接依賴具體 Opteo client（NFR-8、可測）。
 *
 * ⚠ keywordPlanIdeas gRPC service path 的 request/response **兩向皆 snake_case**（已驗證自
 * google-ads-api@24.1.0），故下列型別一律 snake_case，與真實 proto 對齊。
 */
export const ADS_CLIENT = Symbol('ADS_CLIENT');

/** `keyword_idea_metrics`（= KeywordPlanHistoricalMetrics）原始形狀子集（snake_case）。 */
export interface RawKeywordIdeaMetrics extends RawKeywordMetrics {
  competition?: string | number | null;
  competition_index?: number | string | null;
  monthly_search_volumes?: RawMonthlySearchVolume[] | null;
}

/** `generateKeywordIdeas` 回應的單筆結果（snake_case）。 */
export interface KeywordIdeaResult {
  text: string;
  keyword_idea_metrics?: RawKeywordIdeaMetrics | null;
  close_variants?: string[] | null;
}

/** `generateKeywordHistoricalMetrics`（指定模式）回應的單筆結果。metrics 欄位為 `keyword_metrics`。 */
export interface KeywordHistoricalResult {
  text: string;
  close_variants?: string[] | null;
  keyword_metrics?: RawKeywordIdeaMetrics | null;
}

/**
 * `generateKeywordIdeas` 請求（snake_case；seeds 巢狀於 `keyword_seed.keywords`）。
 * `customer_id` 由 Adapter 注入（不在 builder 產出）。
 */
export interface GenerateKeywordIdeasRequest {
  keyword_seed: { keywords: string[] };
  language: string;
  geo_target_constants: string[];
  keyword_plan_network: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  include_adult_keywords?: boolean;
}

/** `generateKeywordHistoricalMetrics` 請求（snake_case；keywords 為 top-level）。 */
export interface GenerateKeywordHistoricalMetricsRequest {
  keywords: string[];
  language: string;
  geo_target_constants: string[];
  keyword_plan_network: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  include_adult_keywords?: boolean;
}

export interface AdsClient {
  generateKeywordIdeas(req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]>;
  generateKeywordHistoricalMetrics(
    req: GenerateKeywordHistoricalMetricsRequest,
  ): Promise<KeywordHistoricalResult[]>;
}
