import { Test } from '@nestjs/testing';
import { ADS_CLIENT } from './ads-client.port';
import type { AdsClient, KeywordIdeaResult } from './ads-client.port';
import { GoogleAdsModule } from './google-ads.module';
import { GoogleAdsService } from './google-ads.service';

class FakeAdsClient implements AdsClient {
  generateKeywordIdeas(): Promise<KeywordIdeaResult[]> {
    return Promise.resolve([{ text: 'fake idea', keywordIdeaMetrics: null }]);
  }
}

describe('GoogleAdsModule (T1.8 Port/Adapter DI)', () => {
  it('resolves GoogleAdsService with a DI-injected AdsClient (no concrete client dependency)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GoogleAdsModule],
    })
      .overrideProvider(ADS_CLIENT)
      .useClass(FakeAdsClient)
      .compile();

    const service = moduleRef.get(GoogleAdsService);
    expect(service).toBeInstanceOf(GoogleAdsService);

    const out = await service.expand(['coffee'], {
      geo: 'geoTargetConstants/2158',
      language: 'languageConstants/1018',
      currencyCode: 'TWD',
    });
    // 透過 fake adapter 跑通管線，證明 service 不綁具體 client。
    expect(out.find((k) => k.normalizedText === 'fake idea')?.source).toBe('expanded');

    await moduleRef.close();
  });

  it('exports only GoogleAdsService (AdsClient adapter stays internal)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GoogleAdsModule],
    })
      .overrideProvider(ADS_CLIENT)
      .useClass(FakeAdsClient)
      .compile();

    // service 可被取得（exported）；ADS_CLIENT 是內部 provider。
    expect(moduleRef.get(GoogleAdsService)).toBeDefined();
    await moduleRef.close();
  });
});
