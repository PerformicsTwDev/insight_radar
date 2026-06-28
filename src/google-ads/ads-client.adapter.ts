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
    // req 結構與套件的 IGenerateKeywordIdeasRequest 相容（camelCase），但套件型別較寬，故 cast。
    const results = await this.customer.keywordPlanIdeas.generateKeywordIdeas(req as never);
    // ⚠ 套件把回傳「誤宣告」成物件（GenerateKeywordIdeaResponse），但 Opteo 由 gapic tuple 解構出
    //   first element，**執行期實為陣列**（套件原始碼於該呼叫點亦標 `@ts-expect-error Response is an
    //   array type`）。故雙重 cast 為陣列——勿改成 `.results` 存取（會 runtime 壞）。
    return results as unknown as KeywordIdeaResult[];
  }
}
