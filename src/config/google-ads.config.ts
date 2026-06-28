import { registerAs } from '@nestjs/config';

export interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  loginCustomerId: string;
  customerId: string;
}

/** Google Ads 六項憑證（已由 Joi schema 驗證）。 */
export const googleAdsConfig = registerAs('googleAds', (): GoogleAdsConfig => ({
  clientId: process.env.GOOGLE_ADS_CLIENT_ID as string,
  clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET as string,
  refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN as string,
  developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
  loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID as string,
  customerId: process.env.GOOGLE_ADS_CUSTOMER_ID as string,
}));
