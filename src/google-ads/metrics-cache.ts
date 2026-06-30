import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { cacheConfig } from '../config/cache.config';
import type { Keyword } from './keyword.types';

/** metrics 快取所需情境（地區/語言）——ExpandParams / HistoricalParams 的共用子集。 */
export interface MetricsCacheParams {
  geo: string;
  language: string;
}

/**
 * Metrics 快取（T4.1，FR-10/NFR-4）。以 `metrics:{geo}:{lang}:{normalizedText}` 為 key 批次查/回寫
 * 關鍵字指標，讓批次處理前先 `mget`、只對 cache-miss 打 Ads（命中省 `GenerateKeywordIdeas` 呼叫）。
 *
 * **去重 key 與快取 key 共用同一 `normalizedText`**（否則 cache miss + 重複取指標）；TTL 一律**毫秒**
 * （`CACHE_TTL_METRICS_MS`，預設 21 天，貼近 Keyword Planner 月更新）。geo/language 入 key → 自然分離。
 */
@Injectable()
export class MetricsCache {
  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
  ) {}

  private keyFor(params: MetricsCacheParams, normalizedText: string): string {
    return this.cache.buildKey(CacheNamespace.METRICS, params.geo, params.language, normalizedText);
  }

  /** 批次查 metrics（依 `normalizedTexts` 對齊；miss = `undefined`，命中回完整 `Keyword`）。 */
  async mget(
    normalizedTexts: string[],
    params: MetricsCacheParams,
  ): Promise<(Keyword | undefined)[]> {
    if (normalizedTexts.length === 0) {
      return [];
    }
    return this.cache.mget<Keyword>(normalizedTexts.map((nt) => this.keyFor(params, nt)));
  }

  /** 回寫（writeback）：每筆以其 `normalizedText` 為 key、TTL 毫秒寫入（之後命中即省 Ads 呼叫）。 */
  async mset(keywords: Keyword[], params: MetricsCacheParams): Promise<void> {
    await Promise.all(
      keywords.map((kw) =>
        this.cache.set(this.keyFor(params, kw.normalizedText), kw, this.config.metricsTtlMs),
      ),
    );
  }
}
