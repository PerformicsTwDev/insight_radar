import { GoogleGenAI } from '@google/genai';
import type { ConfigType } from '@nestjs/config';
import type { embeddingsConfig } from '../config/embeddings.config';
import type { GeminiEmbedClient, GeminiEmbedConfig } from './gemini-embed.port';

/** 可注入的 GoogleGenAI 建構子（測試以 mock 替換、驗 apiKey 對映；不真連 Gemini）。 */
export type GoogleGenAICtor = new (options: { apiKey: string }) => GeminiEmbedClient;

/**
 * 由 embeddings config（已 Joi 驗證）建構 `@google/genai` client（M8，Design §16）。憑證從 config 注入、
 * 不寫死、不入測試（測試以 `overrideProvider(GEMINI_EMBED_CLIENT)` 替換）。建構為 lazy（不發網路呼叫）。
 */
export function createGeminiEmbedClient(
  config: ConfigType<typeof embeddingsConfig>,
  Ctor: GoogleGenAICtor = GoogleGenAI,
): GeminiEmbedClient {
  return new Ctor({ apiKey: config.apiKey });
}

/** embeddings config → GeminiEmbedConfig（adapter 執行參數）。Number.isFinite fallback = defense-in-depth（M8-R1）。 */
export function toGeminiEmbedConfig(
  config: ConfigType<typeof embeddingsConfig>,
): GeminiEmbedConfig {
  return {
    model: config.model,
    taskType: config.taskType,
    dim: config.dim,
    batchSize: config.batchSize,
    concurrency: config.concurrency,
    maxRetries: config.maxRetries,
    backoffBaseMs: config.backoffBaseMs,
  };
}
