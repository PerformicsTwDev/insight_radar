import { registerAs } from '@nestjs/config';

export interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  loginCustomerId: string;
  customerId: string;
  /** 拓展模式每批 seed 數（已 Joi 驗證 min1/max20，預設 15）。 */
  seedBatchSize: number;
  /** 指定模式每批 keyword 數（已 Joi 驗證 min1/max10000，預設 1000）。 */
  historicalBatchSize: number;
}

/** Google Ads 六項憑證 + 批量參數（已由 Joi schema 驗證、含預設）。 */
export const googleAdsConfig = registerAs('googleAds', (): GoogleAdsConfig => ({
  clientId: process.env.GOOGLE_ADS_CLIENT_ID as string,
  clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET as string,
  refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN as string,
  developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
  loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID as string,
  customerId: process.env.GOOGLE_ADS_CUSTOMER_ID as string,
  seedBatchSize: Number(process.env.GOOGLE_ADS_SEED_BATCH_SIZE),
  historicalBatchSize: Number(process.env.GOOGLE_ADS_HISTORICAL_BATCH_SIZE),
}));
