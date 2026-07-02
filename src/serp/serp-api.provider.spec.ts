import type { ConfigType } from '@nestjs/config';
import type { serpConfig } from '../config/serp.config';
import { SerpApiProvider } from './serp-api.provider';
import type { SerpApiClient, SerpApiResponse, SerpApiSearchParams } from './serp-api.types';
import type { SerpQuery } from './serp.types';

const CONFIG: ConfigType<typeof serpConfig> = {
  enabled: true,
  provider: 'serpapi',
  apiKey: 'k',
  apiUrl: 'https://serpapi.com/search',
  topN: 5,
  freshnessDays: 30,
  retentionDays: undefined,
  maxRetries: 3,
  backoffBaseMs: 500,
};

function query(keyword: string): SerpQuery {
  return { normalizedText: keyword, keyword, geo: 'US', language: 'en' };
}

const RESPONSE: SerpApiResponse = {
  organic_results: [{ position: 1, title: 't', link: 'https://a.com/x', snippet: 's' }],
};

function fakeClient(
  respond: (params: SerpApiSearchParams, call: number) => SerpApiResponse | Error,
): { client: SerpApiClient; calls: SerpApiSearchParams[] } {
  const calls: SerpApiSearchParams[] = [];
  const client: SerpApiClient = {
    search: (params) => {
      const result = respond(params, calls.length);
      calls.push(params);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return { client, calls };
}

describe('SerpApiProvider (T8.3 / TC-47)', () => {
  it('fetches each query and maps to a neutral SerpFetchResult (provider, parsed results, timestamp)', async () => {
    const { client, calls } = fakeClient(() => RESPONSE);
    const provider = new SerpApiProvider(client, CONFIG);

    const out = await provider.fetch([query('coffee'), query('latte')]);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ q: 'coffee', gl: 'US', hl: 'en', num: 5 });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      normalizedText: 'coffee',
      keyword: 'coffee',
      geo: 'US',
      language: 'en',
      provider: 'serpapi',
    });
    expect(out[0].results.organic[0].domain).toBe('a.com');
    expect(out[0].fetchedAt).toBeInstanceOf(Date);
  });

  it('passes device through when present', async () => {
    const { client, calls } = fakeClient(() => RESPONSE);
    const provider = new SerpApiProvider(client, CONFIG);
    await provider.fetch([{ ...query('coffee'), device: 'mobile' }]);
    expect(calls[0].device).toBe('mobile');
  });

  it('retries a 429 with backoff then succeeds', async () => {
    jest.useFakeTimers();
    try {
      const { client, calls } = fakeClient((_p, i) =>
        i === 0 ? Object.assign(new Error('rate limited'), { status: 429 }) : RESPONSE,
      );
      const provider = new SerpApiProvider(client, CONFIG);

      const promise = provider.fetch([query('coffee')]);
      await jest.advanceTimersByTimeAsync(500);
      const out = await promise;

      expect(calls).toHaveLength(2); // 429 一次 + 成功一次
      expect(out).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a transport transient (ECONNRESET) then succeeds', async () => {
    jest.useFakeTimers();
    try {
      const { client, calls } = fakeClient((_p, i) =>
        i === 0 ? Object.assign(new Error('reset'), { code: 'ECONNRESET' }) : RESPONSE,
      );
      const provider = new SerpApiProvider(client, CONFIG);

      const promise = provider.fetch([query('coffee')]);
      await jest.advanceTimersByTimeAsync(500);
      await promise;

      expect(calls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    [
      'AbortError (httpOptions timeout)',
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    ],
    ['undici fetch failed', new Error('fetch failed')],
  ])('retries a transport transient (%s) then succeeds', async (_label, transientError) => {
    jest.useFakeTimers();
    try {
      const { client, calls } = fakeClient((_p, i) => (i === 0 ? transientError : RESPONSE));
      const provider = new SerpApiProvider(client, CONFIG);

      const promise = provider.fetch([query('coffee')]);
      await jest.advanceTimersByTimeAsync(500);
      await promise;

      expect(calls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry a non-retryable error (400) — throws immediately', async () => {
    const { client, calls } = fakeClient(() => Object.assign(new Error('bad'), { status: 400 }));
    const provider = new SerpApiProvider(client, CONFIG);

    await expect(provider.fetch([query('coffee')])).rejects.toThrow(/bad/);
    expect(calls).toHaveLength(1);
  });

  it('returns [] for no queries without calling the client', async () => {
    const { client, calls } = fakeClient(() => RESPONSE);
    const provider = new SerpApiProvider(client, CONFIG);
    expect(await provider.fetch([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
