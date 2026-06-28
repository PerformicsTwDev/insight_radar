import { enums } from 'google-ads-api';
import { GoogleAdsService } from './google-ads.service';
import type { AdsClient, GenerateKeywordIdeasRequest, KeywordIdeaResult } from './ads-client.port';

/** 可程式化的 fake AdsClient：記錄每次呼叫，回傳預先安排的結果。 */
class FakeAdsClient implements AdsClient {
  public readonly calls: GenerateKeywordIdeasRequest[] = [];
  constructor(
    private readonly responder: (req: GenerateKeywordIdeasRequest) => KeywordIdeaResult[],
  ) {}
  generateKeywordIdeas(req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    this.calls.push(req);
    return Promise.resolve(this.responder(req));
  }
}

const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};

const idea = (text: string, avg?: number | null): KeywordIdeaResult => ({
  text,
  keywordIdeaMetrics: {
    avgMonthlySearches: avg ?? null,
    competition: enums.KeywordPlanCompetitionLevel.LOW,
    competitionIndex: 33,
    lowTopOfPageBidMicros: '1000000',
    highTopOfPageBidMicros: '2000000',
    monthlySearchVolumes: [{ year: 2025, month: 'JANUARY', monthlySearches: 10 }],
  },
});

describe('GoogleAdsService.expand (T1.6)', () => {
  it('chunks seeds into batches of <=20 across multiple generateKeywordIdeas calls', async () => {
    const fake = new FakeAdsClient(() => []);
    const service = new GoogleAdsService(fake);
    await service.expand(
      Array.from({ length: 21 }, (_, i) => `seed-${i}`),
      PARAMS,
    );
    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call.keywords.length).toBeLessThanOrEqual(20);
    }
  });

  it('includes every seed (source=seed) plus expansions, deduped across batches', async () => {
    const fake = new FakeAdsClient((req) =>
      req.keywords.flatMap((k) => [idea(`${k} cheap`, 50), idea(`${k} cheap`, 50)]),
    );
    const service = new GoogleAdsService(fake);
    const out = await service.expand(['coffee'], PARAMS);

    const coffee = out.find((kw) => kw.normalizedText === 'coffee');
    expect(coffee?.source).toBe('seed');
    // cross-batch / within-response duplicate "coffee cheap" collapses to one row
    expect(out.filter((kw) => kw.normalizedText === 'coffee cheap')).toHaveLength(1);
  });

  it('produces no duplicate normalizedText in the merged result', async () => {
    const fake = new FakeAdsClient(() => [idea('Cold Brew', 5), idea('cold   brew', 5)]);
    const service = new GoogleAdsService(fake);
    const out = await service.expand(['cold brew'], PARAMS);
    const keys = out.map((kw) => kw.normalizedText);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('takes expansion text and metrics from the SAME response (no separate historical call)', async () => {
    const fake = new FakeAdsClient(() => [idea('latte art', 1234)]);
    const service = new GoogleAdsService(fake);
    const out = await service.expand(['latte'], PARAMS);

    const expanded = out.find((kw) => kw.normalizedText === 'latte art');
    expect(expanded?.source).toBe('expanded');
    expect(expanded?.avgMonthlySearches).toBe(1234);
    expect(expanded?.cpcLow).toBe(1); // 1,000,000 micros / 1e6
    expect(expanded?.cpcHigh).toBe(2);
    expect(expanded?.competition).toBe('LOW');
    expect(expanded?.competitionIndex).toBe(33);
    expect(expanded?.monthlyVolumes).toEqual([{ year: 2025, month: 1, searches: 10 }]);
    expect(expanded?.currencyCode).toBe('TWD');
    // 只呼叫拓展端點，不另打 historical metrics（同一回應即帶指標）
    expect((fake as unknown as { calls: unknown[] }).calls).toHaveLength(1);
  });

  it('flattens an expansion with no metrics to null cpc/competition and empty volumes', async () => {
    const fake = new FakeAdsClient(() => [{ text: 'no metrics kw', keywordIdeaMetrics: null }]);
    const service = new GoogleAdsService(fake);
    const out = await service.expand(['seed'], PARAMS);

    const kw = out.find((k) => k.normalizedText === 'no metrics kw');
    expect(kw?.avgMonthlySearches).toBeNull();
    expect(kw?.cpcLow).toBeNull();
    expect(kw?.cpcHigh).toBeNull();
    expect(kw?.competition).toBe('UNSPECIFIED');
    expect(kw?.competitionIndex).toBeNull();
    expect(kw?.monthlyVolumes).toEqual([]);
    expect(kw?.currencyCode).toBeUndefined();
  });

  it('records seedOrigins on expansions and builds requests with geo/language/network', async () => {
    const fake = new FakeAdsClient(() => [idea('coffee beans', 9)]);
    const service = new GoogleAdsService(fake);
    const out = await service.expand(['coffee'], PARAMS);

    const expanded = out.find((kw) => kw.normalizedText === 'coffee beans');
    expect(expanded?.seedOrigins).toEqual(['coffee']);

    const req = fake.calls[0];
    expect(req.geoTargetConstants).toEqual(['geoTargetConstants/2158']);
    expect(req.language).toBe('languageConstants/1018');
    expect(req.keywordPlanNetwork).toBe('GOOGLE_SEARCH'); // 預設
  });
});
