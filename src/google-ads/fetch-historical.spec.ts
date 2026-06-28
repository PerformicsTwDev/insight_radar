import { enums } from 'google-ads-api';
import { GoogleAdsService } from './google-ads.service';
import type {
  AdsClient,
  GenerateKeywordHistoricalMetricsRequest,
  KeywordHistoricalResult,
  KeywordIdeaResult,
} from './ads-client.port';

class FakeAdsClient implements AdsClient {
  public readonly histCalls: GenerateKeywordHistoricalMetricsRequest[] = [];
  public ideasCalled = 0;
  constructor(
    private readonly responder: (
      req: GenerateKeywordHistoricalMetricsRequest,
    ) => KeywordHistoricalResult[],
  ) {}
  generateKeywordIdeas(): Promise<KeywordIdeaResult[]> {
    this.ideasCalled += 1;
    return Promise.resolve([]);
  }
  generateKeywordHistoricalMetrics(
    req: GenerateKeywordHistoricalMetricsRequest,
  ): Promise<KeywordHistoricalResult[]> {
    this.histCalls.push(req);
    return Promise.resolve(this.responder(req));
  }
}

const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};

const metrics = (avg: number) => ({
  avgMonthlySearches: avg,
  competition: enums.KeywordPlanCompetitionLevel.MEDIUM,
  competitionIndex: 40,
  lowTopOfPageBidMicros: '500000',
  highTopOfPageBidMicros: '1500000',
  monthlySearchVolumes: [{ year: 2025, month: 'JANUARY', monthlySearches: avg }],
});

describe('GoogleAdsService.fetchHistoricalMetrics (T1.9 / TC-34)', () => {
  it('calls generateKeywordHistoricalMetrics and never expands (no generateKeywordIdeas)', async () => {
    const fake = new FakeAdsClient((req) =>
      req.keywords.map((k) => ({ text: k, keywordMetrics: metrics(10) })),
    );
    const service = new GoogleAdsService(fake);
    await service.fetchHistoricalMetrics(['coffee'], PARAMS);
    expect(fake.histCalls).toHaveLength(1);
    expect(fake.ideasCalled).toBe(0);
  });

  it('batches keywords at <= GOOGLE_ADS_HISTORICAL_BATCH_SIZE', async () => {
    const fake = new FakeAdsClient((req) =>
      req.keywords.map((k) => ({ text: k, keywordMetrics: metrics(1) })),
    );
    const service = new GoogleAdsService(fake);
    // batchSize=2 → 5 keywords → 3 calls, none > 2
    await service.fetchHistoricalMetrics(['a', 'b', 'c', 'd', 'e'], { ...PARAMS, batchSize: 2 });
    expect(fake.histCalls.map((c) => c.keywords.length)).toEqual([2, 2, 1]);
  });

  it('emits every row as source=seed (exact mode never produces expanded)', async () => {
    const fake = new FakeAdsClient(() => [{ text: 'coffee', keywordMetrics: metrics(99) }]);
    const service = new GoogleAdsService(fake);
    const out = await service.fetchHistoricalMetrics(['coffee'], PARAMS);
    expect(out.every((k) => k.source === 'seed')).toBe(true);
  });

  it('reuses the shared mapper (micros/competition/monthlyVolumes) like expand', async () => {
    const fake = new FakeAdsClient(() => [{ text: 'coffee', keywordMetrics: metrics(120) }]);
    const service = new GoogleAdsService(fake);
    const [kw] = await service.fetchHistoricalMetrics(['coffee'], PARAMS);
    expect(kw).toMatchObject({
      avgMonthlySearches: 120,
      competition: 'MEDIUM',
      competitionIndex: 40,
      cpcLow: 0.5,
      cpcHigh: 1.5,
      currencyCode: 'TWD',
      monthlyVolumes: [{ year: 2025, month: 1, searches: 120 }],
    });
  });

  it('maps close variants back to every original input (car/cars -> one row, both in seedOrigins)', async () => {
    // 上游把 car/cars near-exact 聚合為一筆（text=car、closeVariants=[cars]）。
    const fake = new FakeAdsClient(() => [
      { text: 'car', closeVariants: ['cars'], keywordMetrics: metrics(5000) },
    ]);
    const service = new GoogleAdsService(fake);
    const out = await service.fetchHistoricalMetrics(['car', 'cars'], PARAMS);

    // car/cars 併為一筆（同 normalizedText 或經 closeVariants 對回），兩個輸入都記在 seedOrigins。
    const row = out.find((k) => k.normalizedText === 'car');
    expect(row).toBeDefined();
    expect(row?.seedOrigins?.sort()).toEqual(['car', 'cars']);
    expect(out).toHaveLength(1);
  });

  it('drops a result that maps to no submitted input (output only user inputs)', async () => {
    // 上游回了一筆 text 不在輸入、closeVariants 也對不到的列 → 不得出現在輸出（AC-13.2）。
    const fake = new FakeAdsClient(() => [
      { text: 'unsolicited keyword', keywordMetrics: metrics(1) },
      { text: 'coffee', keywordMetrics: metrics(2) },
    ]);
    const service = new GoogleAdsService(fake);
    const out = await service.fetchHistoricalMetrics(['coffee'], PARAMS);
    expect(out.map((k) => k.normalizedText)).toEqual(['coffee']);
  });

  it('marks an input with no returned data as a no-data seed row', async () => {
    // 只回 car 的資料；cars 無對應 → 仍須有一列（無指標）對應 cars。
    const fake = new FakeAdsClient(() => [{ text: 'car', keywordMetrics: metrics(5000) }]);
    const service = new GoogleAdsService(fake);
    const out = await service.fetchHistoricalMetrics(['car', 'truck'], PARAMS);

    const truck = out.find((k) => k.normalizedText === 'truck');
    expect(truck?.source).toBe('seed');
    expect(truck?.avgMonthlySearches).toBeNull();
  });
});
