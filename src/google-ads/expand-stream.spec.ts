import type { ConfigType } from '@nestjs/config';
import type { googleAdsConfig } from '../config/google-ads.config';
import { GoogleAdsService } from './google-ads.service';
import type { KeywordCandidate } from './keyword.types';
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
const ideaWithVolume = (text: string, avg: number): KeywordIdeaResult => ({
  text,
  keyword_idea_metrics: { avg_monthly_searches: avg },
});

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

async function collectRaw(
  stream: AsyncIterable<KeywordCandidate[]>,
): Promise<KeywordCandidate[][]> {
  const out: KeywordCandidate[][] = [];
  for await (const batch of stream) {
    out.push(batch);
  }
  return out;
}

describe('GoogleAdsService.expandStreamRaw + mergeExpansion (T3.7 overlap + T3.10 authoritative)', () => {
  it('yields user seeds first, then per-Ads-batch raw result candidates (with metrics)', async () => {
    const client = new SeqClient([[idea('a'), ideaWithVolume('apple', 300)]]);
    const service = new GoogleAdsService(client, cfg({ seedBatchSize: 1 }));

    const batches = await collectRaw(service.expandStreamRaw(['a'], PARAMS));

    expect(batches[0]).toEqual([{ text: 'a', source: 'seed' }]); // seeds first
    expect(batches[1].map((c) => c.text)).toEqual(['a', 'apple']); // batch result candidates
    expect(batches[1].find((c) => c.text === 'apple')?.source).toBe('expanded');
    expect(batches[1].find((c) => c.text === 'apple')?.metrics?.avgMonthlySearches).toBe(300);
  });

  it('mergeExpansion over all streamed candidates equals expand() (authoritative, single Ads pass)', async () => {
    const seqA = [
      [idea('a'), idea('apple')],
      [idea('apple'), idea('banana')],
    ];
    const streamed = (
      await collectRaw(
        new GoogleAdsService(new SeqClient(seqA), cfg()).expandStreamRaw(['a', 'b'], PARAMS),
      )
    ).flat();
    const merged = new GoogleAdsService(new SeqClient(seqA), cfg())
      .mergeExpansion(streamed, PARAMS)
      .map((k) => k.normalizedText)
      .sort();
    const expanded = (
      await new GoogleAdsService(new SeqClient(seqA), cfg()).expand(['a', 'b'], PARAMS)
    )
      .map((k) => k.normalizedText)
      .sort();
    expect(merged).toEqual(expanded);
  });

  it('mergeExpansion prefers the non-null-metrics occurrence across batches (M1 regression, FR-2/FR-6)', async () => {
    // 'latte' 在 batch1 無指標、batch2 有指標 → 權威合併須擇有指標者（first-occurrence 會錯成 null）。
    const client = new SeqClient([[idea('latte')], [ideaWithVolume('latte', 500)]]);
    const service = new GoogleAdsService(client, cfg({ seedBatchSize: 1 }));

    const candidates = (await collectRaw(service.expandStreamRaw(['a', 'b'], PARAMS))).flat();
    const keywords = service.mergeExpansion(candidates, PARAMS);

    expect(keywords.find((k) => k.normalizedText === 'latte')?.avgMonthlySearches).toBe(500);
  });
});
