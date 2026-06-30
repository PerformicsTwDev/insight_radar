import { registerAs } from '@nestjs/config';

export interface CacheConfig {
  /** metrics 快取 TTL（毫秒，已 Joi 驗證 min0，預設 21 天；Design §5.3 `metrics:{geo}:{lang}:{nt}`）。 */
  metricsTtlMs: number;
  /** intent 快取 TTL（毫秒，已 Joi 驗證 min0，預設 60 天；`intent:v{ver}:{dep}:sha256(nt)`）。 */
  intentTtlMs: number;
}

/** 快取 TTL 設定（值已由 env.validation Joi schema 驗證/補預設；TTL 一律毫秒，FR-10）。 */
export const cacheConfig = registerAs('cache', (): CacheConfig => ({
  metricsTtlMs: Number(process.env.CACHE_TTL_METRICS_MS),
  intentTtlMs: Number(process.env.CACHE_TTL_INTENT_MS),
}));
