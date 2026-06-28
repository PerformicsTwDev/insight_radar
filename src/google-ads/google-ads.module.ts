import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { googleAdsConfig } from '../config/google-ads.config';
import { createAdsClient } from './ads-client.factory';
import { ADS_CLIENT } from './ads-client.port';
import { GoogleAdsService } from './google-ads.service';

/**
 * Google Ads 模組（T1.8）。**只 export `GoogleAdsService`**；`ADS_CLIENT`（具體 client）為內部 provider。
 * client 建構邏輯抽至 `createAdsClient`（factory，可單元測 key 對映；見 ads-client.factory.ts）。
 */
@Module({
  imports: [ConfigModule.forFeature(googleAdsConfig)],
  providers: [
    GoogleAdsService,
    {
      provide: ADS_CLIENT,
      useFactory: (config: Parameters<typeof createAdsClient>[0]) => createAdsClient(config),
      inject: [googleAdsConfig.KEY],
    },
  ],
  exports: [GoogleAdsService],
})
export class GoogleAdsModule {}
