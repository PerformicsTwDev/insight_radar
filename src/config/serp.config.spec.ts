import { serpConfig } from './serp.config';

describe('serpConfig (T8.3)', () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
  });

  it('parses retentionDays when set and treats non-"true" SERP_ENABLED as disabled', () => {
    process.env = {
      ...original,
      SERP_ENABLED: 'false',
      SERP_PROVIDER: 'serper',
      SERP_TOP_N: '10',
      SERP_FRESHNESS_DAYS: '7',
      SERP_RETENTION_DAYS: '90',
      SERP_MAX_RETRIES: '2',
      SERP_BACKOFF_BASE_MS: '250',
    };
    expect(serpConfig()).toEqual({
      enabled: false,
      provider: 'serper',
      apiKey: undefined,
      apiUrl: undefined,
      topN: 10,
      freshnessDays: 7,
      retentionDays: 90,
      maxRetries: 2,
      backoffBaseMs: 250,
    });
  });
});
