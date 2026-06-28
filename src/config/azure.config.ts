import { registerAs } from '@nestjs/config';
import type { AzureOpenAiApiVersion } from './azure-api-version.allowlist';

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: AzureOpenAiApiVersion;
  /** intent 貼標每批關鍵字數（已 Joi 驗證 min1，預設 30；Design §14 LLM_BATCH_SIZE）。 */
  llmBatchSize: number;
  /** intent 貼標並發上限（已 Joi 驗證 min1，預設 6；Design §14 LLM_CONCURRENCY）。 */
  llmConcurrency: number;
  /** SDK 自動重試次數（已 Joi 驗證 min0，預設 5；Design §14 AZURE_OPENAI_MAX_RETRIES）。 */
  maxRetries: number;
}

/** Azure OpenAI 設定（apiVersion 已由 Joi allowlist 驗證，故可安全斷言為聯合型別）。 */
export const azureConfig = registerAs('azure', (): AzureConfig => ({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT as string,
  apiKey: process.env.AZURE_OPENAI_API_KEY as string,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT as string,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION as AzureOpenAiApiVersion,
  llmBatchSize: Number(process.env.LLM_BATCH_SIZE),
  llmConcurrency: Number(process.env.LLM_CONCURRENCY),
  maxRetries: Number(process.env.AZURE_OPENAI_MAX_RETRIES),
}));
