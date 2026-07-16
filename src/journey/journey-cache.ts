import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import { cacheConfig } from '../config/cache.config';
import { AZURE_OPENAI_DEPLOYMENT } from '../intent/intent-labeler.port';
import type { JourneyStage } from './journey.schema';
import type { StagedKeyword } from './journey-postprocess';

/**
 * 購買歷程分類快取（T12.5，FR-33/AC-33.3）。**Redis-only、nt-keyed**：key =
 * `journey:v{JOURNEY_SCHEMA_VERSION}:{deployment}:sha256(normalizedText)`。stage 由 normalizedText 決定
 * （keyword-intrinsic、跨 snapshot 一致），故快取為「keyword→stage 記憶」。與 snapshot-scoped 的
 * `keyword_journey_assignments`（view/漏斗物化結果）為**兩層**（後者無 modelVersion、由 T12.6 讀取）。
 *
 * - **mget**：批查（依 `normalizedTexts` 對齊）；讀取 best-effort（錯誤=miss，落 LLM，不拖垮 job）。
 * - **schemaVer + deployment** 入 namespace → bump 版本/換部署整批失效、不污染舊結果（AC-33.3）。
 * - sha256(normalizedText)：去重 key = 快取 key 共用同一 normalizedText；TTL 一律毫秒（`CACHE_TTL_JOURNEY_MS`）。
 */
@Injectable()
export class JourneyCache {
  constructor(
    private readonly cache: CacheService,
    @Inject(cacheConfig.KEY) private readonly config: ConfigType<typeof cacheConfig>,
    @Inject(AZURE_OPENAI_DEPLOYMENT) private readonly deployment: string,
  ) {}

  /** 批次查 stage（依 `normalizedTexts` 對齊；miss = `undefined`）。 */
  mget(_normalizedTexts: string[]): Promise<(JourneyStage | undefined)[]> {
    return Promise.reject(new Error('not implemented'));
  }

  /** 回寫（writeback）：寫 Redis。**不快取非法 stage**（cleanStage null → 略，避免近乎永久的錯誤命中）。 */
  mset(_entries: StagedKeyword[]): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
}
