import { Test } from '@nestjs/testing';
import { googleAdsConfig } from '../config/google-ads.config';
import { ADS_CLIENT } from './ads-client.port';
import type { AdsClient, GenerateKeywordIdeasRequest, KeywordIdeaResult } from './ads-client.port';
import { GoogleAdsModule } from './google-ads.module';
import { GoogleAdsService } from './google-ads.service';

class FakeAdsClient implements AdsClient {
  generateKeywordIdeas(): Promise<KeywordIdeaResult[]> {
    return Promise.resolve([{ text: 'fake idea', keyword_idea_metrics: null }]);
  }
  generateKeywordHistoricalMetrics(): Promise<never[]> {
    return Promise.resolve([]);
  }
}

/** 記錄每批 seed 數，用於驗證 config 經 module DI 真正驅動切批（M1-R3）。 */
class BatchRecordingClient implements AdsClient {
  public readonly ideaBatches: number[] = [];
  generateKeywordIdeas(req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    this.ideaBatches.push(req.keyword_seed.keywords.length);
    return Promise.resolve([]);
  }
  generateKeywordHistoricalMetrics(): Promise<never[]> {
    return Promise.resolve([]);
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

  it('injects googleAds config through module DI so its batch size drives chunking (M1-R3)', async () => {
    const client = new BatchRecordingClient();
    const moduleRef = await Test.createTestingModule({
      imports: [GoogleAdsModule],
    })
      .overrideProvider(ADS_CLIENT)
      .useValue(client)
      .overrideProvider(googleAdsConfig.KEY)
      .useValue({ seedBatchSize: 2, historicalBatchSize: 1000 })
      .compile();

    const service = moduleRef.get(GoogleAdsService);
    await service.expand(['a', 'b', 'c', 'd', 'e'], {
      geo: 'geoTargetConstants/2158',
      language: 'languageConstants/1018',
      currencyCode: 'TWD',
    });
    // 配置經真實 module DI 注入 → 批量為 2（非 hardcode 15）。
    expect(client.ideaBatches).toEqual([2, 2, 1]);

    await moduleRef.close();
  });
});
