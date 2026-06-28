import { AzureOpenAI } from 'openai';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import type { OpenAiChatClient } from './intent-labeler.port';

/** 可注入的 AzureOpenAI 建構子（測試以 mock 替換，驗 option 對映）。 */
export type AzureOpenAICtor = new (opts: {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deployment: string;
  maxRetries: number;
}) => OpenAiChatClient;

/** SDK 預設重試次數（NFR-3 / AC-4.6；429/5xx/連線錯誤交給 SDK 重試、尊重 Retry-After，見 T2.6）。 */
export const AZURE_OPENAI_MAX_RETRIES = 5;

/**
 * 由 azure config（已 Joi/allowlist 驗證）建構 `AzureOpenAI` client（Design §4.2）。
 * 憑證從 config 注入、不寫死、不入測試（測試以 `overrideProvider(AZURE_OPENAI_CLIENT)` 替換）。
 */
export function createAzureOpenAiClient(
  config: ConfigType<typeof azureConfig>,
  Ctor: AzureOpenAICtor = AzureOpenAI,
): OpenAiChatClient {
  return new Ctor({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
    maxRetries: AZURE_OPENAI_MAX_RETRIES,
  });
}
