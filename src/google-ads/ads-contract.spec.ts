import type { services } from 'google-ads-api';
import { AdsClientAdapter } from './ads-client.adapter';
import {
  buildGenerateKeywordIdeasRequest,
  buildHistoricalMetricsRequest,
} from './ads-request.builder';
import type { ExpandParams } from './google-ads.service';

const PARAMS: ExpandParams = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
  network: 'GOOGLE_SEARCH_AND_PARTNERS',
};

/**
 * Real-contract guard (M1-R1). google-ads-api keywordPlanIdeas gRPC path is snake_case
 * both ways; ideas seeds nest under keyword_seed; historical returns a {results} object.
 * These assertions FAIL against the prior camelCase/flat implementation.
 */
describe('Ads request contract (M1-R1)', () => {
  it('builds the ideas request with snake_case fields and nested keyword_seed', () => {
    const req = buildGenerateKeywordIdeasRequest(['coffee', 'tea'], PARAMS);
    // The request must be assignable to the real proto interface (compile-time guard).
    const _typed: services.IGenerateKeywordIdeasRequest = req;
    expect(_typed).toBeDefined();

    expect(req.keyword_seed).toEqual({ keywords: ['coffee', 'tea'] });
    expect((req as unknown as Record<string, unknown>).keywords).toBeUndefined(); // NOT top-level for ideas
    expect(req.geo_target_constants).toEqual(['geoTargetConstants/2158']);
    expect(req.language).toBe('languageConstants/1018');
    expect(req.keyword_plan_network).toBe('GOOGLE_SEARCH_AND_PARTNERS');
    // no camelCase leakage
    expect((req as unknown as Record<string, unknown>).geoTargetConstants).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).keywordPlanNetwork).toBeUndefined();
  });

  it('builds the historical request with top-level keywords (no keyword_seed), snake_case', () => {
    const req = buildHistoricalMetricsRequest(['car', 'cars'], PARAMS);
    const _typed: services.IGenerateKeywordHistoricalMetricsRequest = req;
    expect(_typed).toBeDefined();

    expect(req.keywords).toEqual(['car', 'cars']); // top-level for historical
    expect((req as unknown as Record<string, unknown>).keyword_seed).toBeUndefined();
    expect(req.geo_target_constants).toEqual(['geoTargetConstants/2158']);
    expect(req.keyword_plan_network).toBe('GOOGLE_SEARCH_AND_PARTNERS');
  });
});

describe('AdsClientAdapter contract (M1-R1)', () => {
  type FakeCustomer = {
    keywordPlanIdeas: {
      generateKeywordIdeas: (req: unknown) => Promise<unknown>;
      generateKeywordHistoricalMetrics: (req: unknown) => Promise<unknown>;
    };
  };

  it('injects customer_id into every request from the adapter-held CID', async () => {
    const ideaReqs: Array<Record<string, unknown>> = [];
    const histReqs: Array<Record<string, unknown>> = [];
    const customer: FakeCustomer = {
      keywordPlanIdeas: {
        generateKeywordIdeas: (req) => {
          ideaReqs.push(req as Record<string, unknown>);
          return Promise.resolve([]); // ideas → bare array
        },
        generateKeywordHistoricalMetrics: (req) => {
          histReqs.push(req as Record<string, unknown>);
          return Promise.resolve({ results: [] }); // historical → object
        },
      },
    };
    const adapter = new AdsClientAdapter(customer as never, '1234567890');

    await adapter.generateKeywordIdeas(buildGenerateKeywordIdeasRequest(['coffee'], PARAMS));
    await adapter.generateKeywordHistoricalMetrics(buildHistoricalMetricsRequest(['car'], PARAMS));

    expect(ideaReqs[0].customer_id).toBe('1234567890');
    expect(histReqs[0].customer_id).toBe('1234567890');
  });

  it('unwraps the historical UNARY response object to its .results array', async () => {
    const histResults = [{ text: 'car', close_variants: ['cars'], keyword_metrics: null }];
    const customer: FakeCustomer = {
      keywordPlanIdeas: {
        generateKeywordIdeas: () => Promise.resolve([]),
        generateKeywordHistoricalMetrics: () => Promise.resolve({ results: histResults }),
      },
    };
    const adapter = new AdsClientAdapter(customer as never, '1234567890');
    const out = await adapter.generateKeywordHistoricalMetrics(
      buildHistoricalMetricsRequest(['car'], PARAMS),
    );
    expect(out).toEqual(histResults); // NOT the wrapping object
  });

  it('returns an empty array when the historical response has no results', async () => {
    const customer: FakeCustomer = {
      keywordPlanIdeas: {
        generateKeywordIdeas: () => Promise.resolve([]),
        generateKeywordHistoricalMetrics: () => Promise.resolve({}),
      },
    };
    const adapter = new AdsClientAdapter(customer as never, '1234567890');
    expect(
      await adapter.generateKeywordHistoricalMetrics(buildHistoricalMetricsRequest(['x'], PARAMS)),
    ).toEqual([]);
  });
});
