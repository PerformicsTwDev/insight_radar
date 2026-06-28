import type {
  GenerateKeywordHistoricalMetricsRequest,
  GenerateKeywordIdeasRequest,
} from './ads-client.port';
import type { ExpandParams } from './google-ads.service';

/** 共用的 keyword-plan 請求欄位（snake_case；geo/language 為完整 resource name）。 */
function commonRequestFields(params: ExpandParams): {
  language: string;
  geo_target_constants: string[];
  keyword_plan_network: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';
  include_adult_keywords?: boolean;
} {
  return {
    language: params.language,
    geo_target_constants: [params.geo],
    keyword_plan_network: params.network ?? 'GOOGLE_SEARCH',
    ...(params.includeAdult === undefined ? {} : { include_adult_keywords: params.includeAdult }),
  };
}

/**
 * 建構 `generateKeywordIdeas` 請求（FR-2）。**snake_case**；seeds 巢狀於 `keyword_seed.keywords`
 * （proto 無 top-level `keywords`）；network 預設 `GOOGLE_SEARCH`。`customer_id` 由 Adapter 注入。
 */
export function buildGenerateKeywordIdeasRequest(
  keywords: string[],
  params: ExpandParams,
): GenerateKeywordIdeasRequest {
  return {
    keyword_seed: { keywords },
    ...commonRequestFields(params),
  };
}

/**
 * 建構 `generateKeywordHistoricalMetrics` 請求（FR-13）。**snake_case**；keywords 為 **top-level**
 * （指定模式無 seed）；其餘欄位同 ideas。`customer_id` 由 Adapter 注入。
 */
export function buildHistoricalMetricsRequest(
  keywords: string[],
  params: ExpandParams,
): GenerateKeywordHistoricalMetricsRequest {
  return {
    keywords,
    ...commonRequestFields(params),
  };
}
