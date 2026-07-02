import { HttpSerpApiClient, type FetchLike } from './http-serp-api.client';

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('HttpSerpApiClient (T8.3)', () => {
  it('builds the serpapi URL with q/gl/hl/num/device + api_key and parses JSON', async () => {
    const seen: string[] = [];
    const fetchFn: FetchLike = (url) => {
      seen.push(url);
      return Promise.resolve(okResponse({ organic_results: [{ title: 't' }] }));
    };
    const client = new HttpSerpApiClient('https://serpapi.com/search', 'secret-key', fetchFn);

    const res = await client.search({ q: 'coffee', gl: 'US', hl: 'en', num: 5, device: 'mobile' });

    const url = new URL(seen[0]);
    expect(url.origin + url.pathname).toBe('https://serpapi.com/search');
    expect(url.searchParams.get('q')).toBe('coffee');
    expect(url.searchParams.get('gl')).toBe('US');
    expect(url.searchParams.get('hl')).toBe('en');
    expect(url.searchParams.get('num')).toBe('5');
    expect(url.searchParams.get('device')).toBe('mobile');
    expect(url.searchParams.get('api_key')).toBe('secret-key');
    expect(url.searchParams.get('engine')).toBe('google');
    expect(res.organic_results?.[0].title).toBe('t');
  });

  it('omits optional params when not provided', async () => {
    let captured = '';
    const fetchFn: FetchLike = (url) => {
      captured = url;
      return Promise.resolve(okResponse({}));
    };
    const client = new HttpSerpApiClient('https://serpapi.com/search', 'k', fetchFn);

    await client.search({ q: 'coffee' });

    const url = new URL(captured);
    expect(url.searchParams.has('gl')).toBe(false);
    expect(url.searchParams.has('num')).toBe(false);
    expect(url.searchParams.has('device')).toBe(false);
  });

  it('throws with a numeric status on a non-2xx response (for backoff classification)', async () => {
    const fetchFn: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    const client = new HttpSerpApiClient('https://serpapi.com/search', 'k', fetchFn);

    await expect(client.search({ q: 'coffee' })).rejects.toMatchObject({ status: 429 });
  });
});
