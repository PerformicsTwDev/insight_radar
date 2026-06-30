import RedisMockUntyped from 'ioredis-mock';
import type { ConfigType } from '@nestjs/config';
import type { googleAdsConfig } from '../config/google-ads.config';
import { AdsRateLimiter } from './ads-rate-limiter';
import type { AdsLimiterRedis } from './ads-rate-limiter';
import { GoogleAdsService } from './google-ads.service';
import type {
  AdsClient,
  GenerateKeywordHistoricalMetricsRequest,
  GenerateKeywordIdeasRequest,
  KeywordHistoricalResult,
  KeywordIdeaResult,
} from './ads-client.port';

const RedisMock = RedisMockUntyped as unknown as new () => AdsLimiterRedis & {
  flushall(): Promise<unknown>;
};
type AdsCfg = ConfigType<typeof googleAdsConfig>;

function cfg(over: Partial<AdsCfg> = {}): AdsCfg {
  return {
    customerId: 'C-1',
    seedBatchSize: 1,
    historicalBatchSize: 1,
    qps: 1,
    adsMaxRetries: 5,
    adsBackoffBaseMs: 5000,
    ...over,
  } as AdsCfg;
}

const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};

/** 記錄每次 Ads 呼叫的虛擬時刻；可程式化丟錯。 */
class RecordingClient implements AdsClient {
  readonly ideaCallTimes: number[] = [];
  constructor(
    private readonly clock: () => number,
    private readonly onIdeas: () => Promise<KeywordIdeaResult[]> = () => Promise.resolve([]),
  ) {}
  generateKeywordIdeas(_req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    this.ideaCallTimes.push(this.clock());
    return this.onIdeas();
  }
  generateKeywordHistoricalMetrics(
    _req: GenerateKeywordHistoricalMetricsRequest,
  ): Promise<KeywordHistoricalResult[]> {
    return Promise.resolve([]);
  }
}

function makeThrottle(over: Partial<AdsCfg> = {}) {
  const limiter = new AdsRateLimiter(new RedisMock(), cfg(over));
  const state = { clock: 1_000_000, sleeps: [] as number[] };
  limiter.now = () => state.clock;
  limiter.sleep = (ms: number) => {
    state.sleeps.push(ms);
    state.clock += ms;
    return Promise.resolve();
  };
  limiter.random = () => 0;
  return { limiter, state };
}

describe('GoogleAdsService throttling (T3.6 / TC-16)', () => {
  // ioredis-mock 跨實例共用 store → 每測前清空，隔離 per-CID 預約時槽。
  beforeEach(async () => {
    await new RedisMock().flushall();
  });

  it('spaces each Ads client call ≥1000ms via the centralized limiter (single job)', async () => {
    const { limiter, state } = makeThrottle();
    const client = new RecordingClient(() => state.clock);
    const service = new GoogleAdsService(client, cfg(), limiter);

    await service.expand(['a', 'b', 'c'], PARAMS); // seedBatchSize=1 → 3 ideas calls

    expect(client.ideaCallTimes).toHaveLength(3);
    expect(client.ideaCallTimes[1] - client.ideaCallTimes[0]).toBeGreaterThanOrEqual(1000);
    expect(client.ideaCallTimes[2] - client.ideaCallTimes[1]).toBeGreaterThanOrEqual(1000);
  });

  it('keeps ~1 QPS for the same CID across concurrent jobs (shared Redis bucket)', async () => {
    const { limiter, state } = makeThrottle();
    const client = new RecordingClient(() => state.clock);
    const service = new GoogleAdsService(client, cfg(), limiter);

    // 兩個並發 job（各 1 seed → 1 Ads 呼叫）打同一 CID。
    await Promise.all([service.expand(['x'], PARAMS), service.expand(['y'], PARAMS)]);

    expect(client.ideaCallTimes).toHaveLength(2);
    // 同一 CID 被跨 job 序列化：第二個 Ads 呼叫至少被節流等待 ≥ 1000ms（~1 QPS）。
    expect(Math.max(...state.sleeps)).toBeGreaterThanOrEqual(1000);
  });

  it('propagates InvalidArgument without retry', async () => {
    const { limiter, state } = makeThrottle();
    const err = Object.assign(new Error('RESOURCE_NAME_MALFORMED'), {
      errors: [{ error_code: { request_error: 'RESOURCE_NAME_MALFORMED' } }],
    });
    const client = new RecordingClient(
      () => state.clock,
      () => Promise.reject(err),
    );
    const service = new GoogleAdsService(client, cfg(), limiter);

    await expect(service.expand(['a'], PARAMS)).rejects.toBe(err);
    expect(client.ideaCallTimes).toHaveLength(1); // called once, not retried
  });

  it('works without a limiter injected (pass-through; preserves unit-test construction)', async () => {
    const client = new RecordingClient(
      () => 0,
      () => Promise.resolve([{ text: 'idea', keyword_idea_metrics: null }]),
    );
    const service = new GoogleAdsService(client); // no config, no limiter
    const out = await service.expand(['a'], PARAMS);
    expect(out.find((k) => k.normalizedText === 'idea')).toBeDefined();
  });
});
