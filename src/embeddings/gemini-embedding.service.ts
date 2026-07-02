import { Inject, Injectable, Logger } from '@nestjs/common';
import pLimit from 'p-limit';
import { scrubSecrets } from '../logger/redaction';
import type { EmbeddingProvider } from './embedding-provider.port';
import {
  GEMINI_EMBED_CLIENT,
  GEMINI_EMBED_CONFIG,
  type GeminiEmbedClient,
  type GeminiEmbedConfig,
} from './gemini-embed.port';
import { GEMINI_NATIVE_DIM, l2normalize } from './l2-normalize';

/** 429/5xx 就地退避起始延遲（ms）；指數 2^(n-1)*base。 */
const BACKOFF_BASE_MS = 500;

/** 陣列切批（每批 ≤ size）。 */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** SDK 是否回報可重試錯誤（429 或 5xx）——以 status/code 數值判定，避免綁特定 SDK 錯誤類別。 */
function isRetryableEmbedError(err: unknown): boolean {
  const status = (err as { status?: unknown; code?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  const value = typeof status === 'number' ? status : typeof code === 'number' ? code : undefined;
  return value === 429 || (typeof value === 'number' && value >= 500 && value < 600);
}

/**
 * Gemini embedding adapter（T8.2b，FR-16/NFR-13）。實作 {@link EmbeddingProvider}：切批（≤batchSize）+ p-limit
 * 並發 + 429/5xx 指數退避；`taskType`/`outputDimensionality` 放 **config 物件**（非 deprecated 頂層）。
 *
 * **normalize 規則（TC-40）**：gemini 原生 `GEMINI_NATIVE_DIM`(3072) 已為單位長度 → **原樣回、免手動 normalize**；
 * 僅**截短 <3072**（config.dim < 3072）的輸出才 L2 normalize。維度不符即拋（守 wire-shape，避免污染 pgvector）。
 */
@Injectable()
export class GeminiEmbeddingService implements EmbeddingProvider {
  private readonly logger = new Logger(GeminiEmbeddingService.name);

  constructor(
    @Inject(GEMINI_EMBED_CLIENT) private readonly client: GeminiEmbedClient,
    @Inject(GEMINI_EMBED_CONFIG) private readonly config: GeminiEmbedConfig,
  ) {}

  async embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }
    const limit = pLimit(this.config.concurrency);
    const batches = chunk(inputs, this.config.batchSize);
    const embedded = await Promise.all(batches.map((batch) => limit(() => this.embedBatch(batch))));
    return embedded.flat();
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const response = await this.callWithBackoff(batch);
    const embeddings = response.embeddings ?? [];
    // 批次順序/數量必與輸入對齊（"in the same order as provided"）——不符即形狀漂移，拋（不靜默截斷）。
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Gemini embedding count mismatch: got ${embeddings.length}, expected ${batch.length}`,
      );
    }
    return embeddings.map((embedding, index) => {
      const values = embedding.values;
      if (!values || values.length !== this.config.dim) {
        throw new Error(
          `Gemini embedding dim mismatch at ${index}: got ${values?.length ?? 'none'}, expected ${this.config.dim}`,
        );
      }
      // 原生 3072 已 normalize → 原樣；截短 <3072 才手動 L2 normalize。
      return this.config.dim < GEMINI_NATIVE_DIM ? l2normalize(values) : values;
    });
  }

  private async callWithBackoff(
    batch: string[],
  ): ReturnType<GeminiEmbedClient['models']['embedContent']> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.client.models.embedContent({
          model: this.config.model,
          contents: batch,
          // ⚠ taskType/outputDimensionality 放 config 物件（非 deprecated 頂層）；dim = GEMINI_EMBEDDING_DIM。
          config: {
            taskType: this.config.taskType,
            outputDimensionality: this.config.dim,
          },
        });
      } catch (error) {
        attempt += 1;
        if (attempt > this.config.maxRetries || !isRetryableEmbedError(error)) {
          throw error;
        }
        const delayMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        // 祕密不入 log（NFR-5）：SDK 錯誤訊息可夾帶端點/金鑰片段。
        this.logger.warn(
          `Gemini embed retry ${attempt}/${this.config.maxRetries} after ${delayMs}ms: ${scrubSecrets(String(error))}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}
