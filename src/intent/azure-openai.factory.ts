import { AzureOpenAI } from 'openai';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import type { OpenAiChatClient } from './intent-labeler.port';

/** 自訂 fetch（測試注入；型別與 SDK ClientOptions.fetch 相容）。 */
type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** 可注入的 AzureOpenAI 建構子（測試以 mock 替換，驗 option 對映）。 */
export type AzureOpenAICtor = new (opts: {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deployment: string;
  maxRetries: number;
  fetch?: FetchLike;
}) => OpenAiChatClient;

/** 預設重試次數（fallback；實際由 config `AZURE_OPENAI_MAX_RETRIES` 提供，NFR-3 / AC-4.6）。 */
export const AZURE_OPENAI_MAX_RETRIES = 5;

/**
 * 由 azure config（已 Joi/allowlist 驗證）建構 `AzureOpenAI` client（Design §4.2）。
 * 憑證從 config 注入、不寫死、不入測試（測試以 `overrideProvider(AZURE_OPENAI_CLIENT)` 替換）。
 *
 * - `maxRetries` 取自 config（`AZURE_OPENAI_MAX_RETRIES`，預設 5）；429/5xx/連線錯誤交 SDK 重試、
 *   尊重 `Retry-After`（T2.6，**不在外層重複實作**）。
 * - `fetch` 選填（測試注入 fake 以驗重試；正式為 undefined → SDK 預設）。
 */
export function createAzureOpenAiClient(
  config: ConfigType<typeof azureConfig>,
  Ctor: AzureOpenAICtor = AzureOpenAI as unknown as AzureOpenAICtor,
  fetch?: FetchLike,
): OpenAiChatClient {
  const maxRetries =
    Number.isFinite(config.maxRetries) && config.maxRetries >= 0
      ? config.maxRetries
      : AZURE_OPENAI_MAX_RETRIES;
  return new Ctor({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
    maxRetries,
    ...(fetch ? { fetch } : {}),
  });
}
