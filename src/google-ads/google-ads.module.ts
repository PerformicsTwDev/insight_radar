import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import IORedis from 'ioredis';
import { googleAdsConfig } from '../config/google-ads.config';
import { redisConfig } from '../config/redis.config';
import { createAdsClient } from './ads-client.factory';
import { ADS_CLIENT } from './ads-client.port';
import { AdsRateLimiter, type AdsLimiterRedis } from './ads-rate-limiter';
import { ADS_RATE_LIMITER, ADS_RATE_LIMITER_REDIS } from './ads-rate-limiter.constants';
import { GoogleAdsService } from './google-ads.service';

/**
 * Google Ads 模組（T1.8 + T3.6）。**只 export `GoogleAdsService`**；`ADS_CLIENT` 與
 * `AdsRateLimiter`（集中式 per-CID ~1 QPS 限流器）為內部 provider。
 *
 * 限流器以 `ADS_RATE_LIMITER` token 綁定並由 `GoogleAdsService` 注入，確保**正式環境每個 Ads
 * client 呼叫都經節流 + 退避**（非 silent pass-through）；其 Redis 連線**懶連線**（import 不連、
 * 首次節流才連），跨 worker 共享同一 per-CID 時槽桶。
 */
@Module({
  imports: [ConfigModule.forFeature(googleAdsConfig), ConfigModule.forFeature(redisConfig)],
  providers: [
    GoogleAdsService,
    {
      provide: ADS_CLIENT,
      useFactory: (config: Parameters<typeof createAdsClient>[0]) => createAdsClient(config),
      inject: [googleAdsConfig.KEY],
    },
    {
      provide: ADS_RATE_LIMITER_REDIS,
      // 懶連線：避免 import/單元測試時連真 Redis；首次 eval（節流）才建連線。
      useFactory: (config: ConfigType<typeof redisConfig>): AdsLimiterRedis =>
        new IORedis(config.url, { lazyConnect: true }),
      inject: [redisConfig.KEY],
    },
    AdsRateLimiter,
    { provide: ADS_RATE_LIMITER, useExisting: AdsRateLimiter },
  ],
  exports: [GoogleAdsService],
})
export class GoogleAdsModule {}
