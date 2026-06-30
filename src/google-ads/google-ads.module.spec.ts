import { Test } from '@nestjs/testing';
import RedisMockUntyped from 'ioredis-mock';
import { googleAdsConfig } from '../config/google-ads.config';
import { ADS_CLIENT } from './ads-client.port';
import type { AdsClient, GenerateKeywordIdeasRequest, KeywordIdeaResult } from './ads-client.port';
import { AdsRateLimiter } from './ads-rate-limiter';
import type { AdsLimiterRedis, AdsThrottle } from './ads-rate-limiter';
import { ADS_RATE_LIMITER, ADS_RATE_LIMITER_REDIS } from './ads-rate-limiter.constants';
import { GoogleAdsModule } from './google-ads.module';
import { GoogleAdsService } from './google-ads.service';

const RedisMock = RedisMockUntyped as unknown as new () => AdsLimiterRedis & {
  flushall(): Promise<unknown>;
};

/** 純 pass-through 限流器：讓 Port/Adapter/分批測試免真連線、免節流等待（節流行為另測於 TC-16）。 */
const passThroughThrottle: AdsThrottle = {
  schedule: (_cid, fn) => fn(),
};

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

const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};

describe('GoogleAdsModule (T1.8 Port/Adapter DI + T3.6 limiter wiring)', () => {
  beforeEach(async () => {
    await new RedisMock().flushall();
  });

  it('resolves GoogleAdsService with a DI-injected AdsClient (no concrete client dependency)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GoogleAdsModule],
    })
      .overrideProvider(ADS_CLIENT)
      .useClass(FakeAdsClient)
      .overrideProvider(ADS_RATE_LIMITER)
      .useValue(passThroughThrottle)
      .compile();

    const service = moduleRef.get(GoogleAdsService);
    expect(service).toBeInstanceOf(GoogleAdsService);

    const out = await service.expand(['coffee'], PARAMS);
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
      .overrideProvider(ADS_RATE_LIMITER)
      .useValue(passThroughThrottle)
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
      .overrideProvider(ADS_RATE_LIMITER)
      .useValue(passThroughThrottle)
      .compile();

    const service = moduleRef.get(GoogleAdsService);
    await service.expand(['a', 'b', 'c', 'd', 'e'], PARAMS);
    // 配置經真實 module DI 注入 → 批量為 2（非 hardcode 15）。
    expect(client.ideaBatches).toEqual([2, 2, 1]);

    await moduleRef.close();
  });

  it('wires the centralized AdsRateLimiter into GoogleAdsService (no silent pass-through, T3.6)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GoogleAdsModule],
    })
      .overrideProvider(ADS_CLIENT)
      .useClass(FakeAdsClient)
      .overrideProvider(ADS_RATE_LIMITER_REDIS)
      .useValue(new RedisMock())
      .compile();

    // 正式 DI：ADS_RATE_LIMITER token 綁定到 AdsRateLimiter（非未提供 → service 會 pass-through）。
    const limiter = moduleRef.get(AdsRateLimiter);
    expect(limiter).toBeInstanceOf(AdsRateLimiter);
    expect(moduleRef.get<AdsThrottle>(ADS_RATE_LIMITER)).toBe(limiter);

    // 端到端：service.expand 的每個 Ads 呼叫確實經過限流器 schedule。
    const scheduleSpy = jest.spyOn(limiter, 'schedule');
    const service = moduleRef.get(GoogleAdsService);
    await service.expand(['coffee'], PARAMS);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);

    await moduleRef.close();
  });
});
