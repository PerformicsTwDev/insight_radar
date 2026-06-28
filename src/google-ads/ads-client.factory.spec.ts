import { createAdsClient } from './ads-client.factory';
import type { GoogleAdsApiCtor } from './ads-client.factory';
import { AdsClientAdapter } from './ads-client.adapter';
import type { GoogleAdsConfig } from '../config/google-ads.config';

const CONFIG: GoogleAdsConfig = {
  clientId: 'CID',
  clientSecret: 'CSECRET',
  refreshToken: 'RTOKEN',
  developerToken: 'DTOKEN',
  loginCustomerId: '1112223333',
  customerId: '4445556666',
};

describe('createAdsClient (T1.8)', () => {
  it('maps config to client-level and customer-level keys (login_customer_id on Customer)', () => {
    const clientOpts: unknown[] = [];
    const customerOpts: unknown[] = [];
    const FakeCtor = function (this: unknown, opts: unknown) {
      clientOpts.push(opts);
      return {
        Customer: (cOpts: unknown) => {
          customerOpts.push(cOpts);
          return { keywordPlanIdeas: { generateKeywordIdeas: () => Promise.resolve([]) } };
        },
      };
    } as unknown as GoogleAdsApiCtor;

    const adapter = createAdsClient(CONFIG, FakeCtor);

    expect(adapter).toBeInstanceOf(AdsClientAdapter);
    // client 級三鍵（snake_case）
    expect(clientOpts).toEqual([
      { client_id: 'CID', client_secret: 'CSECRET', developer_token: 'DTOKEN' },
    ]);
    // customer 級三鍵；login_customer_id 必在此、非 client 建構子
    expect(customerOpts).toEqual([
      { customer_id: '4445556666', login_customer_id: '1112223333', refresh_token: 'RTOKEN' },
    ]);
    expect((clientOpts[0] as Record<string, unknown>).login_customer_id).toBeUndefined();
  });
});
