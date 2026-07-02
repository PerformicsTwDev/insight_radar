import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { embeddingsConfig } from '../config/embeddings.config';
import { scrubSecrets } from '../logger/redaction';
import { JobMetricsContext } from '../observability/job-metrics.context';

/** 一筆待寫入快取的 embedding（input_hash → 向量）。 */
export interface EmbeddingCacheEntry {
  inputHash: string;
  vector: number[];
}

/**
 * Embedding 快取（T8.2c，FR-16/NFR-4/TC-50）。Redis（cache-manager v6 + Keyv），key =
 * `embedding:{input_hash}`。`input_hash` 已由 {@link buildEmbeddingInput} 內含 `EMBEDDING_SCHEMA_VERSION`
 * 與**是否帶 SERP** → bump schema version 即整批失效、SERP/純關鍵字互不污染（無需額外 namespace 版本）。
 * 命中省 Gemini 呼叫。**best-effort**：快取讀寫失敗只降級為「重打 Gemini」，絕不拖垮 job（吞錯記 warn、遮罩祕密）。
 */
@Injectable()
export class EmbeddingCache {
  private readonly logger = new Logger(EmbeddingCache.name);

  constructor(
    private readonly cache: CacheService,
    @Inject(embeddingsConfig.KEY) private readonly config: ConfigType<typeof embeddingsConfig>,
    // 可觀測（T7.2）：mget 記命中/查詢數（命中＝省 Gemini 呼叫）；無 job 上下文 no-op。
    @Optional() private readonly metrics?: JobMetricsContext,
  ) {}

  private key(inputHash: string): string {
    return this.cache.buildKey(CacheNamespace.EMBEDDING, inputHash);
  }

  /** 批查快取；回與 `inputHashes` 對齊的向量（未命中 = undefined）。失敗 → 全 miss（降級重打）。 */
  async mget(inputHashes: string[]): Promise<(number[] | undefined)[]> {
    if (inputHashes.length === 0) {
      return [];
    }
    try {
      const values = await this.cache.mget<number[]>(inputHashes.map((h) => this.key(h)));
      const hits = values.filter((v) => v !== undefined).length;
      this.metrics?.current()?.recordCacheLookup(hits, inputHashes.length);
      return values;
    } catch (error) {
      this.logger.warn(`embedding cache read failed (best-effort): ${scrubSecrets(String(error))}`);
      return inputHashes.map(() => undefined);
    }
  }

  /** 回寫命中率為 0 的 miss 向量（暖機）。失敗只記 warn，不拋（下次重打 Gemini）。 */
  async mset(entries: EmbeddingCacheEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    try {
      await Promise.all(
        entries.map((entry) =>
          this.cache.set(this.key(entry.inputHash), entry.vector, this.config.cacheTtlMs),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `embedding cache writeback failed (best-effort): ${scrubSecrets(String(error))}`,
      );
    }
  }
}
