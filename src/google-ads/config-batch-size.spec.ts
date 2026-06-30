import { GoogleAdsService } from './google-ads.service';
import type {
  AdsClient,
  GenerateKeywordHistoricalMetricsRequest,
  GenerateKeywordIdeasRequest,
  KeywordHistoricalResult,
  KeywordIdeaResult,
} from './ads-client.port';
import type { GoogleAdsConfig } from '../config/google-ads.config';

class RecordingClient implements AdsClient {
  public readonly ideaBatches: number[] = [];
  public readonly histBatches: number[] = [];
  generateKeywordIdeas(req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    this.ideaBatches.push(req.keyword_seed.keywords.length);
    return Promise.resolve([]);
  }
  generateKeywordHistoricalMetrics(
    req: GenerateKeywordHistoricalMetricsRequest,
  ): Promise<KeywordHistoricalResult[]> {
    this.histBatches.push(req.keywords.length);
    return Promise.resolve([]);
  }
}

const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};

const config = (seed: number, historical: number): GoogleAdsConfig => ({
  clientId: 'x',
  clientSecret: 'x',
  refreshToken: 'x',
  developerToken: 'x',
  loginCustomerId: '1234567890',
  customerId: '1234567890',
  seedBatchSize: seed,
  historicalBatchSize: historical,
  qps: 1,
  adsMaxRetries: 5,
  adsBackoffBaseMs: 5000,
});

describe('GoogleAdsService batch size from config (M1-R3)', () => {
  it('uses GOOGLE_ADS_SEED_BATCH_SIZE from config for expand chunking', async () => {
    const client = new RecordingClient();
    const service = new GoogleAdsService(client, config(3, 1000));
    await service.expand(['a', 'b', 'c', 'd', 'e', 'f', 'g'], PARAMS);
    expect(client.ideaBatches).toEqual([3, 3, 1]); // size 3, not the hardcoded 15
  });

  it('uses GOOGLE_ADS_HISTORICAL_BATCH_SIZE from config for exact-mode chunking', async () => {
    const client = new RecordingClient();
    const service = new GoogleAdsService(client, config(15, 2));
    await service.fetchHistoricalMetrics(['a', 'b', 'c', 'd', 'e'], PARAMS);
    expect(client.histBatches).toEqual([2, 2, 1]); // size 2, not the hardcoded 1000
  });

  it('still honours an explicit params.batchSize over the config default (exact mode)', async () => {
    const client = new RecordingClient();
    const service = new GoogleAdsService(client, config(15, 1000));
    await service.fetchHistoricalMetrics(['a', 'b', 'c'], { ...PARAMS, batchSize: 1 });
    expect(client.histBatches).toEqual([1, 1, 1]);
  });
});
