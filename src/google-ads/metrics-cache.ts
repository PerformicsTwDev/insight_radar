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

  /**
   * 回寫（writeback）：以**每個原始輸入**（`seedOrigins`）的 normalizedText 為 key 寫入該 keyword，TTL 毫秒。
   * Ads near-exact 聚合會把 `'car'` 對回 canonical `'cars'`（輸入↔輸出非 1:1）；若只用 `kw.normalizedText`
   * （= canonical）當 key，原輸入 `'car'` 永遠 cache-miss、每次重打 Ads（NFR-4 失效）。故用 `seedOrigins`
   * 把指標快取在「被查詢的輸入」上；無 `seedOrigins`（無資料 seed 列，其 nt 即輸入）→ 退回 `normalizedText`。
   */
  async mset(keywords: Keyword[], params: MetricsCacheParams): Promise<void> {
    await Promise.all(
      keywords.flatMap((kw) => {
        const inputs = kw.seedOrigins?.length ? kw.seedOrigins : [kw.normalizedText];
        return inputs.map((input) =>
          this.cache.set(this.keyFor(params, input), kw, this.config.metricsTtlMs),
        );
      }),
    );
  }
}
