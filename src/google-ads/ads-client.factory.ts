import { GoogleAdsApi } from 'google-ads-api';
import type { ConfigType } from '@nestjs/config';
import { googleAdsConfig } from '../config/google-ads.config';
import { AdsClientAdapter } from './ads-client.adapter';

/** 抽象成可注入的 GoogleAdsApi 建構子，讓 factory 可在測試以 mock 替換（驗 key 對映）。 */
export type GoogleAdsApiCtor = new (opts: {
  client_id: string;
  client_secret: string;
  developer_token: string;
}) => Pick<GoogleAdsApi, 'Customer'>;

/**
 * 由 googleAds 憑證（已 Joi 驗證）建構 Opteo client，包成 `AdsClientAdapter`（NFR-8、T1.8 核心）。
 *
 * - client 級：`client_id` / `client_secret` / `developer_token`。
 * - customer 級：`customer_id` / `login_customer_id`（MCC）/ `refresh_token`。
 *   ⚠ `login_customer_id` 屬 `Customer()`，**不**在 `GoogleAdsApi()` 建構子（常見放錯位置）。
 * - 憑證從 config 注入、不寫死、不入測試（測試以 `overrideProvider(ADS_CLIENT)` 替換）。
 */
export function createAdsClient(
  config: ConfigType<typeof googleAdsConfig>,
  Ctor: GoogleAdsApiCtor = GoogleAdsApi,
): AdsClientAdapter {
  const api = new Ctor({
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
