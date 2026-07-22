import { registerAs } from '@nestjs/config';

export interface CacheConfig {
  /** metrics 快取 TTL（毫秒，已 Joi 驗證 min0，預設 21 天；Design §5.3 `metrics:{geo}:{lang}:{nt}`）。 */
  metricsTtlMs: number;
  /** intent 快取 TTL（毫秒，已 Joi 驗證 min0，預設 60 天；`intent:v{ver}:{dep}:sha256(nt)`）。 */
  intentTtlMs: number;
  /**
   * intent 快取 namespace 版本（key 的 `v{ver}` 段；env `INTENT_SCHEMA_VERSION`，預設 `v1`）。
   * **bump 即整批失效**：schema / prompt / 標籤語意變更時調此值 → 舊 key 自然不命中、不污染新結果（FR-10）。
   */
  intentSchemaVersion: string;
  /**
   * per-view AI 洞察快取 namespace 版本（key `ai_insight:v{ver}:{dep}:{snapshotId}:{view}:sha256(canonical(filters))`
   * 的 `v{ver}` 段；env `AI_INSIGHT_SCHEMA_VERSION`，預設 `v1`；bump 即整批失效，AC-32.2/FR-32）。
   */
  aiInsightSchemaVersion: string;
  /** per-view AI 洞察快取 TTL（毫秒；env `CACHE_TTL_AI_INSIGHT_MS`，預設 60 天）。 */
  aiInsightTtlMs: number;
  /** table-grain view 洞察的有界代表樣本上限（top-N by volume；env `AI_INSIGHT_MAX_ROWS`，預設 200，M12-R2）。 */
  aiInsightMaxRows: number;
  /**
   * per-keyword AI 意圖摘要（FR-31 SERP-grounded）快取 namespace 版本（key
   * `ai_intent_summary:v{ver}:{dep}:sha256(nt+serpHash)` 的 `v{ver}` 段；env `AI_SUMMARY_SCHEMA_VERSION`，
   * 預設 `v1`；bump 即整批失效，AC-31.3/FR-31）。
   */
  aiSummarySchemaVersion: string;
  /** per-keyword AI 意圖摘要快取 TTL（毫秒；env `CACHE_TTL_AI_SUMMARY_MS`，預設 60 天）。 */
  aiSummaryTtlMs: number;
  /** 意圖摘要 long-form `max_completion_tokens`（env `AI_SUMMARY_MAX_TOKENS`，預設 800；AC-31.4）。 */
  aiSummaryMaxTokens: number;
  /**
   * 購買歷程分類快取 namespace 版本（key `journey:v{ver}:{dep}:sha256(nt)` 的 `v{ver}` 段；
   * env `JOURNEY_SCHEMA_VERSION`，預設 `v1`；**schema 或 prompt 變更皆 bump**→整批失效，FR-33/AC-33.3）。
   */
  journeySchemaVersion: string;
  /** 購買歷程分類 Redis 快取 TTL（毫秒；env `CACHE_TTL_JOURNEY_MS`，預設 60 天）。 */
  journeyTtlMs: number;
  /**
   * 自訂分類 schema/快取 namespace 版本（env `CUSTOM_CLASSIFY_SCHEMA_VERSION`，預設 `v1`；階段二歸類
   * 快取用，schema/prompt 變更皆 bump，FR-34）。
   */
  customClassifySchemaVersion: string;
  /** 自訂分類階段二歸類 Redis 快取 TTL（毫秒；env `CACHE_TTL_CUSTOM_CLASSIFY_MS`，預設 60 天）。 */
  customClassifyTtlMs: number;
}

/** 快取設定（值已由 env.validation Joi schema 驗證/補預設；TTL 一律毫秒，FR-10）。 */
export const cacheConfig = registerAs('cache', (): CacheConfig => ({
  metricsTtlMs: Number(process.env.CACHE_TTL_METRICS_MS),
  intentTtlMs: Number(process.env.CACHE_TTL_INTENT_MS),
  intentSchemaVersion: process.env.INTENT_SCHEMA_VERSION as string,
  aiInsightSchemaVersion: process.env.AI_INSIGHT_SCHEMA_VERSION as string,
  aiInsightTtlMs: Number(process.env.CACHE_TTL_AI_INSIGHT_MS),
  aiInsightMaxRows: Number(process.env.AI_INSIGHT_MAX_ROWS),
  aiSummarySchemaVersion: process.env.AI_SUMMARY_SCHEMA_VERSION as string,
  aiSummaryTtlMs: Number(process.env.CACHE_TTL_AI_SUMMARY_MS),
  aiSummaryMaxTokens: Number(process.env.AI_SUMMARY_MAX_TOKENS),
  journeySchemaVersion: process.env.JOURNEY_SCHEMA_VERSION as string,
  journeyTtlMs: Number(process.env.CACHE_TTL_JOURNEY_MS),
  customClassifySchemaVersion: process.env.CUSTOM_CLASSIFY_SCHEMA_VERSION as string,
  customClassifyTtlMs: Number(process.env.CACHE_TTL_CUSTOM_CLASSIFY_MS),
}));
