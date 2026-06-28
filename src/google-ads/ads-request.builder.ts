import type { GenerateKeywordIdeasRequest } from './ads-client.port';
import type { ExpandParams } from './google-ads.service';

/**
 * 建構 `generateKeywordIdeas` 請求（FR-2）。geo/language 為**完整 resource name**，
 * network 預設 `GOOGLE_SEARCH`（Design §4.1）。
 */
export function buildGenerateKeywordIdeasRequest(
  keywords: string[],
  params: ExpandParams,
): GenerateKeywordIdeasRequest {
  return {
    keywords,
    language: params.language,
    geoTargetConstants: [params.geo],
    keywordPlanNetwork: params.network ?? 'GOOGLE_SEARCH',
    ...(params.includeAdult === undefined ? {} : { includeAdultKeywords: params.includeAdult }),
  };
}
