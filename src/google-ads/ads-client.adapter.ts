import type { Customer, services } from 'google-ads-api';
import type {
  AdsClient,
  GenerateKeywordHistoricalMetricsRequest,
  GenerateKeywordIdeasRequest,
  KeywordHistoricalResult,
  KeywordIdeaResult,
} from './ads-client.port';

/**
 * Opteo `Customer` 的 Adapter（NFR-8 / M1-R1）：把具體 google-ads-api client 收斂到 `AdsClient` Port。
 *
 * - 請求一律 **snake_case** 並注入 `customer_id`（此 service path 不自動注入）。
 * - `generateKeywordIdeas` 為**分頁**，runtime resolve 成陣列（型別 cast 至 `services.*Request` 類別）。
 * - `generateKeywordHistoricalMetrics` 為 **unary**，回 `{ results }` 物件 → 取 `.results`。
 * - 節流／退避**不**在此（ADR-0001 集中式 AdsRateLimiter，後續里程碑）。
 */
export class AdsClientAdapter implements AdsClient {
  constructor(
    private readonly customer: Customer,
    private readonly customerId: string,
  ) {}

  async generateKeywordIdeas(req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    const request = { ...req, customer_id: this.customerId };
    // 分頁端點：gapic 合併各頁、runtime 回陣列（套件 .d.ts 誤宣告為物件，故 cast）。
    const results = await this.customer.keywordPlanIdeas.generateKeywordIdeas(
      request as services.GenerateKeywordIdeasRequest,
    );
    return results as unknown as KeywordIdeaResult[];
  }

  async generateKeywordHistoricalMetrics(
    req: GenerateKeywordHistoricalMetricsRequest,
  ): Promise<KeywordHistoricalResult[]> {
    const request = { ...req, customer_id: this.customerId };
    // unary 端點：runtime 回 `{ results }` 物件，須取 `.results`（勿當陣列）。
    const response = await this.customer.keywordPlanIdeas.generateKeywordHistoricalMetrics(
      request as services.GenerateKeywordHistoricalMetricsRequest,
    );
    const { results } = response as unknown as { results?: KeywordHistoricalResult[] };
    return results ?? [];
  }
}
