import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { GoogleAdsApi } from 'google-ads-api';
import { googleAdsConfig } from '../config/google-ads.config';
import { AdsClientAdapter } from './ads-client.adapter';
import { ADS_CLIENT } from './ads-client.port';
import { GoogleAdsService } from './google-ads.service';

/**
 * 由 googleAds 憑證（已 Joi 驗證）建構 Opteo client，包成 `AdsClientAdapter`（NFR-8）。
 * 憑證從 config 注入，不寫死、不入測試（測試以 `overrideProvider(ADS_CLIENT)` 替換）。
 */
function createAdsClient(config: ConfigType<typeof googleAdsConfig>): AdsClientAdapter {
  const api = new GoogleAdsApi({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    developer_token: config.developerToken,
  });
  const customer = api.Customer({
    customer_id: config.customerId,
    login_customer_id: config.loginCustomerId,
    refresh_token: config.refreshToken,
  });
  return new AdsClientAdapter(customer);
}

/**
 * Google Ads 模組（T1.8）。**只 export `GoogleAdsService`**；`ADS_CLIENT`（具體 client）為內部 provider。
 */
@Module({
  imports: [ConfigModule.forFeature(googleAdsConfig)],
  providers: [
    GoogleAdsService,
    {
      provide: ADS_CLIENT,
      useFactory: createAdsClient,
      inject: [googleAdsConfig.KEY],
    },
  ],
  exports: [GoogleAdsService],
})
export class GoogleAdsModule {}
