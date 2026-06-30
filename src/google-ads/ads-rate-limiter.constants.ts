/** `AdsThrottle` Port 的 DI token（GoogleAdsService 以 `@Optional()` 注入，缺則 pass-through）。 */
export const ADS_RATE_LIMITER = Symbol('ADS_RATE_LIMITER');

/** 限流器專用 Redis 連線的 DI token（config 驅動、跨 worker 共享；測試可 override 成 ioredis-mock）。 */
export const ADS_RATE_LIMITER_REDIS = Symbol('ADS_RATE_LIMITER_REDIS');
