import { AdsClientAdapter } from './ads-client.adapter';
import { buildGenerateKeywordIdeasRequest } from './ads-request.builder';
import type { ExpandParams } from './google-ads.service';

/** 最小 fake Opteo customer。 */
interface FakeCustomer {
  keywordPlanIdeas: {
    generateKeywordIdeas: (req: unknown) => Promise<unknown>;
    generateKeywordHistoricalMetrics: (req: unknown) => Promise<unknown>;
  };
}

const PARAMS: ExpandParams = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};

describe('AdsClientAdapter (T1.8 / M1-R1)', () => {
  it('delegates generateKeywordIdeas to the wrapped customer and returns its (array) results', async () => {
    const results = [{ text: 'coffee beans', keyword_idea_metrics: null }];
    const calls: unknown[] = [];
    const customer: FakeCustomer = {
      keywordPlanIdeas: {
        generateKeywordIdeas: (req) => {
          calls.push(req);
          return Promise.resolve(results); // ideas → bare array
        },
        generateKeywordHistoricalMetrics: () => Promise.resolve({ results: [] }),
      },
    };
    const adapter = new AdsClientAdapter(customer as never, '1234567890');

    const out = await adapter.generateKeywordIdeas(
      buildGenerateKeywordIdeasRequest(['coffee'], PARAMS),
    );
    expect(out).toEqual(results);
    // delegated request carries the injected customer_id + nested keyword_seed
    expect(calls[0]).toMatchObject({
      customer_id: '1234567890',
      keyword_seed: { keywords: ['coffee'] },
    });
  });
});
