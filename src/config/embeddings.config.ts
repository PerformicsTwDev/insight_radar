import { registerAs } from '@nestjs/config';

/** Embeddings 設定（值已由 env.validation Joi schema 驗證/補預設；M8，Design §14）。 */
export interface EmbeddingsConfig {
  /** @google/genai client 憑證（GEMINI_API_KEY；祕密，不入 log/fixture）。 */
  apiKey: string;
  /** embedding 模型 id（gemini-embedding-001）。 */
  model: string;
  /** taskType（CLUSTERING）。 */
  taskType: string;
  /** 輸出維度（固定 3072 = halfvec 欄；M8-R1）。 */
  dim: number;
  /** 每批大小（≤500）。 */
  batchSize: number;
  /** 批次並發（p-limit）。 */
  concurrency: number;
  /** 429/5xx/傳輸層退避重試上限。 */
  maxRetries: number;
  /** 退避起始延遲（ms，指數 `2^(n-1)*base`）。 */
  backoffBaseMs: number;
  /** embedding 快取 namespace 版本（bump 整批失效）。 */
  schemaVersion: string;
  /** embedding 快取 TTL（毫秒）。 */
  cacheTtlMs: number;
}

export const embeddingsConfig = registerAs('embeddings', (): EmbeddingsConfig => ({
  apiKey: process.env.GEMINI_API_KEY ?? '',
  model: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
  taskType: process.env.GEMINI_EMBEDDING_TASK_TYPE ?? 'CLUSTERING',
  dim: Number(process.env.GEMINI_EMBEDDING_DIM),
  batchSize: Number(process.env.GEMINI_EMBEDDING_BATCH_SIZE),
  concurrency: Number(process.env.GEMINI_EMBEDDING_CONCURRENCY),
  maxRetries: Number(process.env.GEMINI_EMBEDDING_MAX_RETRIES),
  backoffBaseMs: Number(process.env.GEMINI_EMBEDDING_BACKOFF_BASE_MS),
  schemaVersion: process.env.EMBEDDING_SCHEMA_VERSION ?? 'v1',
  cacheTtlMs: Number(process.env.CACHE_TTL_EMBEDDING_MS),
}));
