import type { Customer } from 'google-ads-api';
import type { AdsClient, GenerateKeywordIdeasRequest, KeywordIdeaResult } from './ads-client.port';

/**
 * Opteo `Customer` 的 Adapter（NFR-8）：把具體 google-ads-api client 收斂到 `AdsClient` Port，
 * 讓 `GoogleAdsService` 不直接依賴套件型別（DI 可替換、可測）。
 *
 * 節流／退避**不**在此（見 ADR-0001 集中式 AdsRateLimiter，後續里程碑）；此處僅委派。
 */
export class AdsClientAdapter implements AdsClient {
  constructor(private readonly customer: Customer) {}

  async generateKeywordIdeas(req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    const results = await this.customer.keywordPlanIdeas.generateKeywordIdeas(req as never);
    return results as unknown as KeywordIdeaResult[];
  }
}
