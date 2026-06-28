import type { RawKeywordMetrics } from './mapping/map-metrics';
import type { RawMonthlySearchVolume } from './mapping/map-monthly-volumes';

/**
 * Google Ads 客戶端 Port（DI 可替換；完整 Adapter 見 T1.8）。
 * 只暴露本案需要的方法，讓 `GoogleAdsService` 不直接依賴具體 Opteo client（NFR-8、可測）。
 */
export const ADS_CLIENT = Symbol('ADS_CLIENT');

/** `keyword_idea_metrics`（= KeywordPlanHistoricalMetrics）原始形狀子集。 */
export interface RawKeywordIdeaMetrics extends RawKeywordMetrics {
  competition?: string | number | null;
  competitionIndex?: number | null;
  monthlySearchVolumes?: RawMonthlySearchVolume[];
}

/** `generateKeywordIdeas` 回應的單筆結果。 */
export interface KeywordIdeaResult {
  text: string;
  keywordIdeaMetrics?: RawKeywordIdeaMetrics | null;
}

/** `generateKeywordIdeas` 請求（camelCase；geo/language 為完整 resource name）。 */
export interface GenerateKeywordIdeasRequest {
  keywords: string[];
  language: string;
  geoTargetConstants: string[];
  keywordPlanNetwork: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  includeAdultKeywords?: boolean;
}

export interface AdsClient {
  generateKeywordIdeas(req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]>;
}
