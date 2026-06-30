import type { ConfigType } from '@nestjs/config';
import type { googleAdsConfig } from '../config/google-ads.config';
import { GoogleAdsService } from './google-ads.service';
import type {
  AdsClient,
  GenerateKeywordHistoricalMetricsRequest,
  GenerateKeywordIdeasRequest,
  KeywordHistoricalResult,
  KeywordIdeaResult,
} from './ads-client.port';

type AdsCfg = ConfigType<typeof googleAdsConfig>;
function cfg(over: Partial<AdsCfg> = {}): AdsCfg {
  return { customerId: 'C-1', seedBatchSize: 1, historicalBatchSize: 1, qps: 1, ...over } as AdsCfg;
}
const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};
const idea = (text: string): KeywordIdeaResult => ({ text, keyword_idea_metrics: null });

/** 依序回每批 Ads 結果（每次 generateKeywordIdeas 取下一批）。 */
class SeqClient implements AdsClient {
  private i = 0;
  constructor(private readonly batches: KeywordIdeaResult[][]) {}
  generateKeywordIdeas(_req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    const out = this.batches[this.i] ?? [];
    this.i += 1;
    return Promise.resolve(out);
  }
  generateKeywordHistoricalMetrics(
    _req: GenerateKeywordHistoricalMetricsRequest,
  ): Promise<KeywordHistoricalResult[]> {
    return Promise.resolve([]);
  }
}

async function collect(stream: AsyncIterable<{ normalizedText: string }[]>): Promise<string[][]> {
  const out: string[][] = [];
  for await (const batch of stream) {
    out.push(batch.map((k) => k.normalizedText));
  }
  return out;
}

describe('GoogleAdsService.expandStream (T3.7 A/B overlap source)', () => {
  it('yields per Ads batch, dedupes cross-batch, emits unsurfaced seeds last', async () => {
    const client = new SeqClient([
      [idea('a'), idea('apple')], // batch for seed 'a'
      [idea('apple'), idea('banana')], // batch for seed 'b' — apple is a cross-batch dup
    ]);
    const service = new GoogleAdsService(client, cfg({ seedBatchSize: 1 }));

    const batches = await collect(service.expandStream(['a', 'b'], PARAMS));
    // batch1: a + apple ; batch2: banana（apple 去重）; 結尾: b（未出現在任何結果的 seed）
    expect(batches).toEqual([['a', 'apple'], ['banana'], ['b']]);
  });

  it('covers the same unique keyword set as expand() (count parity)', async () => {
    const client1 = new SeqClient([
      [idea('a'), idea('apple')],
      [idea('apple'), idea('banana')],
    ]);
    const client2 = new SeqClient([
      [idea('a'), idea('apple')],
      [idea('apple'), idea('banana')],
    ]);
    const streamed = (
      await collect(new GoogleAdsService(client1, cfg()).expandStream(['a', 'b'], PARAMS))
    )
      .flat()
      .sort();
    const expanded = (await new GoogleAdsService(client2, cfg()).expand(['a', 'b'], PARAMS))
      .map((k) => k.normalizedText)
      .sort();
    expect(streamed).toEqual(expanded);
  });

  it('marks seeds as source=seed and expanded keywords as source=expanded', async () => {
    const client = new SeqClient([[idea('a'), idea('apple')]]);
    const service = new GoogleAdsService(client, cfg());
    const all: { normalizedText: string; source: string }[] = [];
    for await (const batch of service.expandStream(['a'], PARAMS)) {
      all.push(...batch);
    }
    expect(all.find((k) => k.normalizedText === 'a')?.source).toBe('seed');
    expect(all.find((k) => k.normalizedText === 'apple')?.source).toBe('expanded');
  });
});
