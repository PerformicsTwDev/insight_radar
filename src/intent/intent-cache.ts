import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { sha256Hex } from '../common/sha256';
import { cacheConfig } from '../config/cache.config';
import { normalizeText } from '../google-ads/normalize';
import { PrismaService } from '../prisma';
import { AZURE_OPENAI_DEPLOYMENT } from './intent-labeler.port';

/** intent 快取項：每字（normalizedText）對應的標籤集。 */
export interface IntentCacheEntry {
  keyword: string;
  labels: string[];
}

/**
 * Intent 快取（T4.2/T4.6，FR-10/NFR-4/TC-13）。**分層**：Redis 為快取、**DB `keyword_intents` 為持久後備**。
 * Redis key = `intent:v{schemaVer}:{deployment}:sha256(normalizedText)`；DB PK = `[normalizedText, modelVersion]`，
 * `modelVersion = {schemaVer}:{deployment}`（與 Redis namespace 對齊）。`IntentService` 貼標前 `mget`、只對
 * cache-miss 送 LLM（命中省 `AzureOpenAiService`）。
 *
 * - **mget**：Redis 先查 → miss 落 DB canonical 回填 → 命中即 warm Redis（Redis 失效不致重打全部 LLM，T4.6）。
 * - **schemaVer + deployment** 入 namespace/modelVersion → bump 版本/換部署整批失效、不污染舊結果（T4.3）。
 * - sha256(normalizedText)：去重 key = 快取 key 共用同一 normalizedText；TTL 一律毫秒（`CACHE_TTL_INTENT_MS`）。
 */
@Injectable()
export class IntentCache {
  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
    @Inject(AZURE_OPENAI_DEPLOYMENT) private readonly deployment: string,
    private readonly prisma: PrismaService,
  ) {}

  /** DB canonical（`keyword_intents`）的版本維度——對齊 Redis namespace（schema 或 prompt 變更皆 bump）。 */
  private get modelVersion(): string {
    return `${this.config.intentSchemaVersion}:${this.deployment}`;
  }

  /** key 一律以 `normalizeText` 後再 sha256（去重 key = 快取 key；LLM 回 echo 大小寫/空白差異不致漏命中）。 */
  private keyFor(normalizedText: string): string {
    return this.cache.buildKey(
      CacheNamespace.INTENT,
      this.config.intentSchemaVersion,
      this.deployment,
      sha256Hex(normalizedText),
    );
  }

  /** 批次查標籤（依 `normalizedTexts` 對齊；Redis miss 落 DB 後備、命中即 warm Redis；皆 miss = `undefined`）。 */
  async mget(normalizedTexts: string[]): Promise<(string[] | undefined)[]> {
    if (normalizedTexts.length === 0) {
      return [];
    }
    const normalized = normalizedTexts.map(normalizeText);
    const redis = await this.cache.mget<string[]>(normalized.map((nt) => this.keyFor(nt)));

    const missNts = normalized.filter((_nt, i) => redis[i] === undefined);
    if (missNts.length === 0) {
      return redis;
    }
    // DB 後備：以 [normalizedText, modelVersion] 查 canonical；命中回填 Redis（Redis 失效不重打 LLM）。
    const rows = await this.prisma.keywordIntent.findMany({
      where: { modelVersion: this.modelVersion, normalizedText: { in: [...new Set(missNts)] } },
    });
    const dbByNt = new Map(rows.map((r) => [r.normalizedText, r.labels as string[]]));
    await Promise.all(
      [...dbByNt].map(([nt, labels]) =>
        this.cache.set(this.keyFor(nt), labels, this.config.intentTtlMs),
      ),
    );
    return normalized.map((nt, i) => redis[i] ?? dbByNt.get(nt));
  }

  /**
   * 回寫（writeback）：寫 Redis + **upsert DB canonical**（`keyword_intents`）。**不快取空標籤**（退化結果）
   * ——否則會變成永久 fallback 命中、永不重試（M2）。
   */
  async mset(entries: IntentCacheEntry[]): Promise<void> {
    const valid = entries
      .filter((e) => e.labels.length > 0)
      .map((e) => ({ nt: normalizeText(e.keyword), labels: e.labels }));
    await Promise.all([
      ...valid.map((e) => this.cache.set(this.keyFor(e.nt), e.labels, this.config.intentTtlMs)),
      ...valid.map((e) =>
        this.prisma.keywordIntent.upsert({
          where: {
            normalizedText_modelVersion: { normalizedText: e.nt, modelVersion: this.modelVersion },
          },
          create: { normalizedText: e.nt, modelVersion: this.modelVersion, labels: e.labels },
          update: { labels: e.labels, labeledAt: new Date() },
        }),
      ),
    ]);
  }
}
