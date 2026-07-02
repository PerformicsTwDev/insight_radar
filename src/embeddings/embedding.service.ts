import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { embeddingsConfig } from '../config/embeddings.config';
import { buildEmbeddingInput } from './build-embedding-input';
import { EmbeddingCache } from './embedding-cache';
import { EmbeddingRepository, type EmbeddingRecord } from './embedding.repository';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from './embedding-provider.port';
import type { SerpContext } from './embedding.types';

/** 待嵌入的關鍵字（repository 複合鍵 varying 部分 + 可選 SERP）。 */
export interface EmbedItem {
  geo: string;
  language: string;
  normalizedText: string;
  serp?: SerpContext;
}

/**
 * Embedding 編排（T8.2c，FR-16/NFR-13/TC-50）：cache-first。對每個關鍵字組裝 {@link buildEmbeddingInput}，
 * 先 `EmbeddingCache.mget`（命中省 Gemini），只對 **cache-miss** 呼叫 {@link EmbeddingProvider}，結果同時
 * 回寫 pgvector（{@link EmbeddingRepository}，供分群 T8.9）與 Redis 快取，回與輸入對齊的向量。
 */
@Injectable()
export class EmbeddingService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
    private readonly cache: EmbeddingCache,
    private readonly repository: EmbeddingRepository,
    @Inject(embeddingsConfig.KEY) private readonly config: ConfigType<typeof embeddingsConfig>,
  ) {}

  async embed(items: EmbedItem[]): Promise<number[][]> {
    if (items.length === 0) {
      return [];
    }
    const { model, taskType, dim, schemaVersion } = this.config;
    const inputs = items.map((item) =>
      buildEmbeddingInput(item.normalizedText, item.serp, { schemaVersion }),
    );

    const cached = await this.cache.mget(inputs.map((input) => input.inputHash));

    // 只對 miss 收集要送 Gemini 的文字（保留原索引以回填）。
    const missIndexes: number[] = [];
    const missTexts: string[] = [];
    cached.forEach((vector, index) => {
      if (!vector) {
        missIndexes.push(index);
        missTexts.push(inputs[index].text);
      }
    });

    let missVectors: number[][] = [];
    if (missTexts.length > 0) {
      missVectors = await this.provider.embed(missTexts);
      const records: EmbeddingRecord[] = missIndexes.map((index, k) => ({
        geo: items[index].geo,
        language: items[index].language,
        normalizedText: items[index].normalizedText,
        model,
        taskType,
        dim,
        inputHash: inputs[index].inputHash,
        embedding: missVectors[k],
      }));
      // 先固化（durable，供分群）再暖快取；兩者皆 miss 才做。
      await this.repository.upsertMany(records);
      await this.cache.mset(
        missIndexes.map((index, k) => ({
          inputHash: inputs[index].inputHash,
          vector: missVectors[k],
        })),
      );
    }

    // 組裝：命中用快取值，miss 用剛取得的向量（依 missIndexes 順序回填）。
    let missCursor = 0;
    return cached.map((vector) => vector ?? missVectors[missCursor++]);
  }
}
