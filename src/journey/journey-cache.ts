import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { sha256Hex } from '../common/sha256';
import { cacheConfig } from '../config/cache.config';
import { normalizeText } from '../google-ads/normalize';
import { AZURE_OPENAI_DEPLOYMENT } from '../intent/intent-labeler.port';
import { scrubSecrets } from '../logger/redaction';
import { cleanStage, type StagedKeyword } from './journey-postprocess';
import type { JourneyStage } from './journey.schema';

/**
 * 購買歷程分類快取（T12.5，FR-33/AC-33.3）。**Redis-only、nt-keyed**：key =
 * `journey:v{JOURNEY_SCHEMA_VERSION}:{deployment}:sha256(normalizedText)`。stage 由 normalizedText 決定
 * （keyword-intrinsic、跨 snapshot 一致），故快取為「keyword→stage 記憶」。與 snapshot-scoped 的
 * `keyword_journey_assignments`（view/漏斗物化結果）為**兩層**（後者無 modelVersion、由 T12.6 讀取）。
 *
 * - **mget**：批查（依 `normalizedTexts` 對齊）；讀取 best-effort（錯誤=miss，落 LLM，不拖垮 job）。讀出仍
 *   `cleanStage` 防禦（stale/非法值不回傳）。
 * - **schemaVer + deployment** 入 namespace → bump 版本/換部署整批失效、不污染舊結果（AC-33.3）。
 * - sha256(normalizedText)：去重 key = 快取 key 共用同一 normalizedText；TTL 一律毫秒（`CACHE_TTL_JOURNEY_MS`）。
 */
@Injectable()
export class JourneyCache {
  private readonly logger = new Logger(JourneyCache.name);

  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
    @Inject(AZURE_OPENAI_DEPLOYMENT) private readonly deployment: string,
  ) {}

  /** key 一律以 `normalizeText` 後再 sha256（去重 key = 快取 key；LLM 回 echo 大小寫/空白差異不致漏命中）。 */
  private keyFor(normalizedText: string): string {
    return this.cache.buildKey(
      CacheNamespace.JOURNEY,
      this.config.journeySchemaVersion,
      this.deployment,
      sha256Hex(normalizedText),
    );
  }

  /**
   * 讀取 best-effort（cache-aside）：快取讀取錯誤 = miss（回 `fallback`），降級落 LLM，**不**拖垮 job。
   * 讀取失敗只是少一次命中，不應讓已付費的 job 失敗、重打全部 LLM。
   */
  private async bestEffortRead<T>(work: Promise<T>, fallback: T, context: string): Promise<T> {
    try {
      return await work;
    } catch (error) {
      this.logger.warn(`${context} failed (best-effort): ${scrubSecrets(String(error))}`);
      return fallback;
    }
  }

  /** 回寫純屬快取暖機：寫入失敗只降級為「下次重打 LLM」，不可拖垮已付費的 job——吞錯記 warn（祕密清洗）。 */
  private async bestEffort(work: Promise<unknown>, context: string): Promise<void> {
    try {
      await work;
    } catch (error) {
      this.logger.warn(`${context} failed (best-effort): ${scrubSecrets(String(error))}`);
    }
  }

  /** 批次查 stage（依 `normalizedTexts` 對齊；miss = `undefined`）。 */
  async mget(normalizedTexts: string[]): Promise<(JourneyStage | undefined)[]> {
    if (normalizedTexts.length === 0) {
      return [];
    }
    const normalized = normalizedTexts.map(normalizeText);
    const raw = await this.bestEffortRead<(string | undefined)[]>(
      this.cache.mget<string>(normalized.map((nt) => this.keyFor(nt))),
      normalized.map(() => undefined),
      'journey cache read',
    );
    // 讀出仍 cleanStage（防 stale/非法值污染下游）：非法 → 視同 miss（undefined）。
    return raw.map((v) => (v == null ? undefined : (cleanStage(v) ?? undefined)));
  }

  /** 回寫（writeback）：寫 Redis。**不快取非法 stage**（cleanStage null → 略，避免近乎永久的錯誤命中）。 */
  async mset(entries: StagedKeyword[]): Promise<void> {
    const valid = entries
      .map((e) => ({ nt: normalizeText(e.keyword), stage: cleanStage(e.stage) }))
      .filter((e): e is { nt: string; stage: JourneyStage } => e.stage !== null);
    await this.bestEffort(
      Promise.all(
        valid.map((e) => this.cache.set(this.keyFor(e.nt), e.stage, this.config.journeyTtlMs)),
      ),
      'journey cache writeback',
    );
  }
}
