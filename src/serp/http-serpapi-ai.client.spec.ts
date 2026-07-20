import type { FetchLike } from './http-serp-api.client';
import { HttpSerpApiAiClient } from './http-serpapi-ai.client';

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('HttpSerpApiAiClient (T14.2, reserved)', () => {
  describe('searchGoogle (engine=google)', () => {
    it('builds engine=google URL with q/hl/gl + api_key and parses JSON', async () => {
      let captured = '';
      const fetchFn: FetchLike = (url) => {
        captured = url;
        return Promise.resolve(okResponse({ ai_overview: { text_blocks: [], references: [] } }));
      };
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'secret-key', fetchFn);

      const res = await client.searchGoogle({ q: '露營', hl: 'zh-tw', gl: 'tw' });

      const url = new URL(captured);
      expect(url.origin + url.pathname).toBe('https://serpapi.com/search');
      expect(url.searchParams.get('engine')).toBe('google');
      expect(url.searchParams.get('q')).toBe('露營');
      expect(url.searchParams.get('hl')).toBe('zh-tw');
      expect(url.searchParams.get('gl')).toBe('tw');
      expect(url.searchParams.get('api_key')).toBe('secret-key');
      expect(res.ai_overview).toBeDefined();
    });

    it('throws with numeric status on non-2xx (for degradation classification)', async () => {
      const fetchFn: FetchLike = () =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'k', fetchFn);

      await expect(client.searchGoogle({ q: 'x', hl: 'zh-tw', gl: 'tw' })).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  describe('fetchAiOverview (engine=google_ai_overview)', () => {
    it('builds engine=google_ai_overview URL with page_token + api_key and forwards the AbortSignal', async () => {
      let captured = '';
      let seenInit: RequestInit | undefined;
      const fetchFn: FetchLike = (url, init) => {
        captured = url;
        seenInit = init;
        return Promise.resolve(okResponse({ ai_overview: { text_blocks: [], references: [] } }));
      };
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'secret-key', fetchFn);
      const controller = new AbortController();

      const res = await client.fetchAiOverview({ pageToken: 'tok-123', signal: controller.signal });

      const url = new URL(captured);
      expect(url.searchParams.get('engine')).toBe('google_ai_overview');
      expect(url.searchParams.get('page_token')).toBe('tok-123');
      expect(url.searchParams.get('api_key')).toBe('secret-key');
      expect(seenInit?.signal).toBe(controller.signal);
      expect(res.ai_overview).toBeDefined();
    });

    it('omits init when no signal is provided', async () => {
      let seenInit: RequestInit | undefined = { signal: new AbortController().signal };
      const fetchFn: FetchLike = (_url, init) => {
        seenInit = init;
        return Promise.resolve(okResponse({ ai_overview: { text_blocks: [], references: [] } }));
      };
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'k', fetchFn);

      await client.fetchAiOverview({ pageToken: 'tok' });

      expect(seenInit).toBeUndefined();
    });

    it('throws with numeric status on non-2xx', async () => {
      const fetchFn: FetchLike = () =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'k', fetchFn);

      await expect(client.fetchAiOverview({ pageToken: 'tok' })).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('searchAiMode (engine=google_ai_mode)', () => {
    it('builds engine=google_ai_mode URL with q/hl/gl + api_key and parses JSON', async () => {
      let captured = '';
      const fetchFn: FetchLike = (url) => {
        captured = url;
        return Promise.resolve(okResponse({ text_blocks: [], references: [] }));
      };
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'secret-key', fetchFn);

      const res = await client.searchAiMode({ q: '電動牙刷推薦', hl: 'zh-tw', gl: 'tw' });

      const url = new URL(captured);
      expect(url.origin + url.pathname).toBe('https://serpapi.com/search');
      expect(url.searchParams.get('engine')).toBe('google_ai_mode');
      expect(url.searchParams.get('q')).toBe('電動牙刷推薦');
      expect(url.searchParams.get('hl')).toBe('zh-tw');
      expect(url.searchParams.get('gl')).toBe('tw');
      expect(url.searchParams.get('api_key')).toBe('secret-key');
      expect(res.text_blocks).toBeDefined();
    });

    it('throws with numeric status on non-2xx (for degradation classification)', async () => {
      const fetchFn: FetchLike = () =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'k', fetchFn);

      await expect(client.searchAiMode({ q: 'x', hl: 'zh-tw', gl: 'tw' })).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  describe('searchBingCopilot (engine=bing_copilot, could)', () => {
    it('builds engine=bing_copilot URL with q/hl/gl + api_key and parses JSON', async () => {
      let captured = '';
      const fetchFn: FetchLike = (url) => {
        captured = url;
        return Promise.resolve(okResponse({ text_blocks: [], references: [] }));
      };
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'secret-key', fetchFn);

      const res = await client.searchBingCopilot({ q: '筆電推薦', hl: 'zh-tw', gl: 'tw' });

      const url = new URL(captured);
      expect(url.searchParams.get('engine')).toBe('bing_copilot');
      expect(url.searchParams.get('q')).toBe('筆電推薦');
      expect(url.searchParams.get('hl')).toBe('zh-tw');
      expect(url.searchParams.get('gl')).toBe('tw');
      expect(url.searchParams.get('api_key')).toBe('secret-key');
      expect(res.text_blocks).toBeDefined();
    });

    it('throws with numeric status on non-2xx', async () => {
      const fetchFn: FetchLike = () =>
        Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      const client = new HttpSerpApiAiClient('https://serpapi.com/search', 'k', fetchFn);

      await expect(
        client.searchBingCopilot({ q: 'x', hl: 'zh-tw', gl: 'tw' }),
      ).rejects.toMatchObject({ status: 503 });
    });
  });
});
