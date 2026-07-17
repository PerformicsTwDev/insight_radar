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
  /** 購買歷程分類每批關鍵字數（已 Joi 驗證 min1，預設 30；Design §14 JOURNEY_LLM_BATCH_SIZE）。 */
  journeyLlmBatchSize: number;
  /** 購買歷程 async job 單次分類的關鍵字數上限（成本護欄，已 Joi 驗證 min1，預設 5000；#484）。 */
  journeyMaxKeywords: number;
  /** 自訂分類標籤數上限（動態 enum 大小，已 Joi 驗證 min1，預設 12；AC-34.1）。 */
  customClassifyMaxLabels: number;
  /** 自訂分類階段二歸類每批關鍵字數（已 Joi 驗證 min1，預設 30；Design §14 CUSTOM_CLASSIFY_LLM_BATCH_SIZE）。 */
  customClassifyLlmBatchSize: number;
  /** 自訂分類 async job 單次歸類的關鍵字數上限（成本護欄，已 Joi 驗證 min1，預設 5000；FR-34）。 */
  customClassifyMaxKeywords: number;
  ideationMaxKeywords: number;
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
  journeyLlmBatchSize: Number(process.env.JOURNEY_LLM_BATCH_SIZE),
  journeyMaxKeywords: Number(process.env.JOURNEY_MAX_KEYWORDS),
  customClassifyMaxLabels: Number(process.env.CUSTOM_CLASSIFY_MAX_LABELS),
  customClassifyLlmBatchSize: Number(process.env.CUSTOM_CLASSIFY_LLM_BATCH_SIZE),
  customClassifyMaxKeywords: Number(process.env.CUSTOM_CLASSIFY_MAX_KEYWORDS),
  ideationMaxKeywords: Number(process.env.IDEATION_MAX_KEYWORDS),
  maxRetries: Number(process.env.AZURE_OPENAI_MAX_RETRIES),
}));
