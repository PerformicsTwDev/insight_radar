/**
 * 已知 cache namespace（集中管理，避免散落字串；對齊 DevelopmentRules / Design 的快取鍵慣例）。
 * 搭配 `CacheService.buildKey` 使用：`cache.buildKey(CacheNamespace.METRICS, cid, hash)`。
 */
export const CacheNamespace = {
  METRICS: 'metrics',
  INTENT: 'intent',
  IDEMP: 'idemp',
} as const;

export type CacheNamespace = (typeof CacheNamespace)[keyof typeof CacheNamespace];
