import type { EmbedContentParameters, EmbedContentResponse } from '@google/genai';

/**
 * `@google/genai` 低階 embedding 呼叫的 Port（T8.2b，FR-16，NFR-3）。**typed against 真實 SDK 型別**
 * （`EmbedContentParameters`/`EmbedContentResponse`）——避免 M1 類 wire-shape bug（錯形狀通過所有 mock 測試、
 * 只在真呼叫爆）。正式由 `GoogleGenAI` 實例（`ai.models.embedContent`）提供，測試以 fake 替換。
 */
export const GEMINI_EMBED_CLIENT = Symbol('GEMINI_EMBED_CLIENT');
export const GEMINI_EMBED_CONFIG = Symbol('GEMINI_EMBED_CONFIG');

export interface GeminiEmbedClient {
  models: {
    embedContent(params: EmbedContentParameters): Promise<EmbedContentResponse>;
  };
}

/** GeminiEmbeddingService 的執行參數（由 config 提供；DI 注入 → 可測、不寫死）。 */
export interface GeminiEmbedConfig {
  /** gemini-embedding-001（鎖此 id）。 */
  model: string;
  /** CLUSTERING。 */
  taskType: string;
  /** 輸出維度（= GEMINI_EMBEDDING_DIM；放 config 物件的 outputDimensionality，非 deprecated 頂層）。 */
  dim: number;
  /** 每批 ≤ 500（>500 有順序 bug）；預設 100。 */
  batchSize: number;
  /** 批次並發上限（p-limit）。 */
  concurrency: number;
  /** 429/5xx 就地退避重試上限。 */
  maxRetries: number;
}
