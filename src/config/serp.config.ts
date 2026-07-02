import { registerAs } from '@nestjs/config';

/** SERP 設定（值已由 env.validation Joi schema 驗證/補預設；M8，Design §14/§16）。 */
export interface SerpConfig {
  /** 是否啟用 SERP（MVP 預設 false → 純文字 embedding）。 */
  enabled: boolean;
  /** 供應商（serpapi | serper）。 */
  provider: string;
  /** 供應商 API 憑證（祕密，不入 log/fixture；僅 enabled 時必填）。 */
  apiKey: string | undefined;
  /** 供應商端點（僅 enabled 時必填）。 */
  apiUrl: string | undefined;
  /** 取前 N 筆 organic（預設 5）。 */
  topN: number;
  /** durable `serp_fetches` 重用新鮮窗（天，預設 30；窗內不重抓）。 */
  freshnessDays: number;
  /** `serp_fetches` 歷史保留天數；undefined = 保留全部（SERP-over-time）。 */
  retentionDays: number | undefined;
  /** 429/5xx/傳輸層退避重試上限。 */
  maxRetries: number;
  /** 退避起始延遲（ms，指數 `2^(n-1)*base`）。 */
  backoffBaseMs: number;
}

export const serpConfig = registerAs('serp', (): SerpConfig => ({
  enabled: process.env.SERP_ENABLED === 'true',
  provider: process.env.SERP_PROVIDER ?? 'serpapi',
  apiKey: process.env.SERP_API_KEY,
  apiUrl: process.env.SERP_API_URL,
  topN: Number(process.env.SERP_TOP_N),
  freshnessDays: Number(process.env.SERP_FRESHNESS_DAYS),
  retentionDays:
    process.env.SERP_RETENTION_DAYS === undefined
      ? undefined
      : Number(process.env.SERP_RETENTION_DAYS),
  maxRetries: Number(process.env.SERP_MAX_RETRIES),
  backoffBaseMs: Number(process.env.SERP_BACKOFF_BASE_MS),
}));
