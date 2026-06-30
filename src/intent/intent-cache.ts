import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { sha256Hex } from '../common/sha256';
import { cacheConfig } from '../config/cache.config';
import { normalizeText } from '../google-ads/normalize';
import { AZURE_OPENAI_DEPLOYMENT } from './intent-labeler.port';

/** intent 快取項：每字（normalizedText）對應的標籤集。 */
export interface IntentCacheEntry {
  keyword: string;
  labels: string[];
}

/**
 * Intent 快取（T4.2，FR-10/NFR-4/TC-13）。以 `intent:v{schemaVer}:{deployment}:sha256(normalizedText)`
 * 為 key 批次查/回寫每字的 intent 標籤，讓 `IntentService` 貼標前 `mget`、只對 cache-miss 送 LLM（命中省
 * `AzureOpenAiService` 呼叫，LLM 成本隨重複率線性下降）。
 *
 * - **schemaVer**（config `intentSchemaVersion`，env `INTENT_SCHEMA_VERSION`）+ **deployment** 入 namespace →
 *   bump 版本/換部署整批失效、不污染舊結果（T4.3）。
 * - sha256(normalizedText)：**去重 key 與快取 key 共用同一 normalizedText**；TTL 一律毫秒（`CACHE_TTL_INTENT_MS`）。
 */
@Injectable()
export class IntentCache {
  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
    @Inject(AZURE_OPENAI_DEPLOYMENT) private readonly deployment: string,
  ) {}

  /** key 一律以 `normalizeText` 後再 sha256（去重 key = 快取 key；LLM 回 echo 大小寫/空白差異不致漏命中）。 */
  private keyFor(text: string): string {
    return this.cache.buildKey(
      CacheNamespace.INTENT,
      this.config.intentSchemaVersion, // bump（env INTENT_SCHEMA_VERSION）→ namespace 整批失效（T4.3）
      this.deployment,
      sha256Hex(normalizeText(text)),
    );
  }

  /** 批次查標籤（依 `normalizedTexts` 對齊；miss = `undefined`）。 */
  async mget(normalizedTexts: string[]): Promise<(string[] | undefined)[]> {
    if (normalizedTexts.length === 0) {
      return [];
    }
    return this.cache.mget<string[]>(normalizedTexts.map((nt) => this.keyFor(nt)));
  }

  /**
   * 回寫（writeback）：每筆以 `sha256(normalizeText(keyword))` 為 key、TTL 毫秒寫入標籤。
   * **不快取空標籤**（退化結果）——否則會變成永久 fallback 命中、永不重試（M2）。
   */
  async mset(entries: IntentCacheEntry[]): Promise<void> {
    await Promise.all(
      entries
        .filter((e) => e.labels.length > 0)
        .map((e) => this.cache.set(this.keyFor(e.keyword), e.labels, this.config.intentTtlMs)),
    );
  }
}
