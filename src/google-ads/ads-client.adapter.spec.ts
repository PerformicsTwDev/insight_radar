import { AdsClientAdapter } from './ads-client.adapter';
import type { GenerateKeywordIdeasRequest } from './ads-client.port';

/** 最小 fake Opteo customer：只實作本案用到的 keywordPlanIdeas.generateKeywordIdeas。 */
interface FakeCustomer {
  keywordPlanIdeas: {
    generateKeywordIdeas: (req: unknown) => Promise<unknown>;
    generateKeywordHistoricalMetrics: (req: unknown) => Promise<unknown>;
  };
}

const REQ: GenerateKeywordIdeasRequest = {
  keywords: ['coffee'],
  language: 'languageConstants/1018',
  geoTargetConstants: ['geoTargetConstants/2158'],
  keywordPlanNetwork: 'GOOGLE_SEARCH',
};

describe('AdsClientAdapter (T1.8)', () => {
  it('delegates generateKeywordIdeas to the wrapped customer and returns its results', async () => {
    const results = [{ text: 'coffee beans', keywordIdeaMetrics: null }];
    const calls: unknown[] = [];
    const customer: FakeCustomer = {
      keywordPlanIdeas: {
        generateKeywordIdeas: (req) => {
          calls.push(req);
          return Promise.resolve(results);
        },
        generateKeywordHistoricalMetrics: () => Promise.resolve([]),
      },
    };
    const adapter = new AdsClientAdapter(customer as never);

    const out = await adapter.generateKeywordIdeas(REQ);
    expect(out).toEqual(results);
    expect(calls).toEqual([REQ]);
  });

  it('delegates generateKeywordHistoricalMetrics to the wrapped customer', async () => {
    const results = [{ text: 'car', closeVariants: ['cars'], keywordMetrics: null }];
    const calls: unknown[] = [];
    const customer: FakeCustomer = {
      keywordPlanIdeas: {
        generateKeywordIdeas: () => Promise.resolve([]),
        generateKeywordHistoricalMetrics: (req) => {
          calls.push(req);
          return Promise.resolve(results);
        },
      },
    };
    const adapter = new AdsClientAdapter(customer as never);

    const out = await adapter.generateKeywordHistoricalMetrics(REQ);
    expect(out).toEqual(results);
    expect(calls).toEqual([REQ]);
  });
});
