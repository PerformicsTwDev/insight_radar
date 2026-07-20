import type { ConfigType } from '@nestjs/config';
import type { serpAiConfig } from '../config/serp-ai.config';
import {
  aiOverviewInlineV1,
  aiOverviewPageTokenStep1V1,
  aiOverviewPageTokenStep2V1,
} from './__fixtures__/serp-ai';
import { SerpApiAiProvider } from './serpapi-ai.provider';
import {
  SERPAPI_AI_SCHEMA_VERSION,
  type SerpApiAiClient,
  type SerpApiAiOverviewFetchParams,
  type SerpApiAiOverviewInline,
  type SerpApiAiSearchParams,
  type SerpApiGoogleAiOverviewResponse,
  type SerpApiGoogleSearchResponse,
} from './serpapi-ai.types';

const AI_CONFIG: ConfigType<typeof serpAiConfig> = {
  enabled: true,
  aioPageTokenTimeoutMs: 50000,
  creditsBudget: 1000,
  hl: 'zh-tw',
  gl: 'tw',
};

interface FakeClientOpts {
  onSearch: (params: SerpApiAiSearchParams) => SerpApiGoogleSearchResponse;
  onFetchAiOverview?: (
    params: SerpApiAiOverviewFetchParams,
  ) => SerpApiGoogleAiOverviewResponse | Promise<SerpApiGoogleAiOverviewResponse>;
}

function fakeClient(opts: FakeClientOpts): {
  client: SerpApiAiClient;
  searchCalls: SerpApiAiSearchParams[];
  fetchCalls: SerpApiAiOverviewFetchParams[];
} {
  const searchCalls: SerpApiAiSearchParams[] = [];
  const fetchCalls: SerpApiAiOverviewFetchParams[] = [];
  const client: SerpApiAiClient = {
    searchGoogle: (params) => {
      searchCalls.push(params);
      return Promise.resolve(opts.onSearch(params));
    },
    fetchAiOverview: (params) => {
      fetchCalls.push(params);
      if (!opts.onFetchAiOverview) {
        return Promise.reject(new Error('unexpected fetchAiOverview call'));
      }
      return Promise.resolve(opts.onFetchAiOverview(params));
    },
  };
  return { client, searchCalls, fetchCalls };
}

describe('TC-74: SerpApiAiProvider — AI Overview adapter (FR-38, reserved)', () => {
  describe('AC-38.1 路一 · 內嵌解析（ai_overview.text_blocks 直接在）', () => {
    it('parses inline ai_overview into an AiSearchCapture canonical (no secondary fetch)', async () => {
      const { client, searchCalls, fetchCalls } = fakeClient({
        onSearch: () => aiOverviewInlineV1,
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['間歇性斷食 減肥有效嗎']);

      expect(searchCalls).toHaveLength(1);
      expect(fetchCalls).toHaveLength(0); // 內嵌路不二次抓取
      expect(result.query).toBe('間歇性斷食 減肥有效嗎');
      expect(result.creditsUsed).toBe(1);
      expect(result.aiOverview).not.toBeNull();
      expect(result.aiOverview).toMatchObject({
        source: 'serpapi',
        channel: 'aiOverview',
        schemaVersion: SERPAPI_AI_SCHEMA_VERSION,
        query: '間歇性斷食 減肥有效嗎',
      });
      // blocks 原樣保留（§18.3）
      const inlineAio = aiOverviewInlineV1.ai_overview as SerpApiAiOverviewInline;
      expect(result.aiOverview!.blocks).toEqual(inlineAio.text_blocks);
      // references 統一為中立形狀（複用 normalizeReferences；thumbnail 非中立欄 → 落掉）
      expect(result.aiOverview!.references).toHaveLength(3);
      expect(result.aiOverview!.references[0]).toEqual({
        index: 0,
        title: '間歇性斷食與體重管理的臨床證據',
        link: 'https://www.nih.gov.example/intermittent-fasting',
        snippet: '2024 年一項隨機試驗比較 16:8 斷食與標準飲食控制的減重成效。',
        source: 'NIH',
      });
    });

    it('AC-38.5: sends hl=zh-tw / gl=tw', async () => {
      const { client, searchCalls } = fakeClient({ onSearch: () => aiOverviewInlineV1 });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      await provider.fetchAiOverviews(['露營新手裝備推薦']);

      expect(searchCalls[0]).toEqual({ q: '露營新手裝備推薦', hl: 'zh-tw', gl: 'tw' });
    });
  });

  describe('AC-38.1 路二 · page_token 二次抓取（engine=google_ai_overview）', () => {
    it('follows ai_overview.page_token with a secondary fetch and maps the returned blocks/references', async () => {
      const { client, searchCalls, fetchCalls } = fakeClient({
        onSearch: () => aiOverviewPageTokenStep1V1,
        onFetchAiOverview: () => aiOverviewPageTokenStep2V1,
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['露營新手裝備推薦']);

      expect(searchCalls).toHaveLength(1);
      expect(fetchCalls).toHaveLength(1);
      // 二次抓取沿用第一路回傳的 page_token（token 連續性）
      const step1Aio = aiOverviewPageTokenStep1V1.ai_overview!;
      expect('page_token' in step1Aio && fetchCalls[0].pageToken).toBe(
        'page_token' in step1Aio && step1Aio.page_token,
      );
      expect(result.creditsUsed).toBe(2); // 內嵌 1 + 二次 1
      expect(result.aiOverview).not.toBeNull();
      expect(result.aiOverview!.blocks).toEqual(aiOverviewPageTokenStep2V1.ai_overview.text_blocks);
      expect(result.aiOverview!.references).toHaveLength(2);
      expect(result.aiOverview!.references[0].link).toBe(
        'https://outdoor.example.tw/camping-starter',
      );
    });
  });

  describe('AC-38.2 · graceful degradation（aiOverview=null，非錯誤）', () => {
    it('degrades to aiOverview=null when the response has no ai_overview field', async () => {
      const { client, fetchCalls } = fakeClient({ onSearch: () => ({ organic_results: [] }) });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['no aio query']);

      expect(fetchCalls).toHaveLength(0);
      expect(result.aiOverview).toBeNull();
      expect(result.creditsUsed).toBe(1);
    });

    it('degrades to null when ai_overview only carries an error (SerpApi could not fetch AIO)', async () => {
      const { client, fetchCalls } = fakeClient({
        onSearch: () => ({
          ai_overview: {
            page_token: 'ignored',
            serpapi_link: 'https://serpapi.com/x',
            error: 'Google AI Overview not present in the results.',
          },
        }),
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['errored aio']);

      expect(fetchCalls).toHaveLength(0); // 有 error → 不二次抓取
      expect(result.aiOverview).toBeNull();
      expect(result.creditsUsed).toBe(1);
    });

    it('degrades to null when the secondary page_token fetch fails (not an error)', async () => {
      const { client, fetchCalls } = fakeClient({
        onSearch: () => aiOverviewPageTokenStep1V1,
        onFetchAiOverview: () => {
          throw Object.assign(new Error('SERP HTTP 500'), { status: 500 });
        },
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['secondary fails']);

      expect(fetchCalls).toHaveLength(1);
      expect(result.aiOverview).toBeNull();
      expect(result.creditsUsed).toBe(2); // 二次請求已發送 → 計費
    });

    it('degrades to null when the secondary fetch returns a malformed body without ai_overview', async () => {
      const { client, fetchCalls } = fakeClient({
        onSearch: () => aiOverviewPageTokenStep1V1,
        // 二次抓取回覆缺 ai_overview（供應商 schema 漂移/異常）→ 防禦性 null（不臆造）。
        onFetchAiOverview: () =>
          ({
            search_metadata: { status: 'Success' },
          }) as unknown as SerpApiGoogleAiOverviewResponse,
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['malformed secondary']);

      expect(fetchCalls).toHaveLength(1);
      expect(result.aiOverview).toBeNull();
      expect(result.creditsUsed).toBe(2);
    });

    it('degrades to null when the secondary fetch exceeds SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS', async () => {
      jest.useFakeTimers();
      try {
        const { client, fetchCalls } = fakeClient({
          onSearch: () => aiOverviewPageTokenStep1V1,
          onFetchAiOverview: () => new Promise<SerpApiGoogleAiOverviewResponse>(() => {}), // never resolves
        });
        const provider = new SerpApiAiProvider(client, AI_CONFIG);

        const promise = provider.fetchAiOverviews(['times out']);
        await jest.advanceTimersByTimeAsync(50000);
        const [result] = await promise;

        expect(fetchCalls).toHaveLength(1);
        expect(result.aiOverview).toBeNull();
        expect(result.creditsUsed).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('AC-38.5 · credit 預算治理（SERPAPI_AI_CREDITS_BUDGET）', () => {
    it('does not issue the secondary fetch when it would exceed the credit budget (degrades that query)', async () => {
      const { client, searchCalls, fetchCalls } = fakeClient({
        onSearch: () => aiOverviewPageTokenStep1V1,
        onFetchAiOverview: () => aiOverviewPageTokenStep2V1,
      });
      const provider = new SerpApiAiProvider(client, { ...AI_CONFIG, creditsBudget: 1 });

      const [result] = await provider.fetchAiOverviews(['budget one']);

      expect(searchCalls).toHaveLength(1); // 主查詢用掉唯一 1 credit
      expect(fetchCalls).toHaveLength(0); // 二次抓取會超出預算 → 不發送
      expect(result.aiOverview).toBeNull();
      expect(result.creditsUsed).toBe(1);
    });

    it('stops issuing primary searches once the budget is exhausted across the batch', async () => {
      const { client, searchCalls } = fakeClient({ onSearch: () => aiOverviewInlineV1 });
      const provider = new SerpApiAiProvider(client, { ...AI_CONFIG, creditsBudget: 1 });

      const results = await provider.fetchAiOverviews(['first', 'second']);

      expect(searchCalls).toHaveLength(1); // 只發第一個主查詢
      expect(results[0].aiOverview).not.toBeNull();
      expect(results[0].creditsUsed).toBe(1);
      expect(results[1].aiOverview).toBeNull(); // 預算耗盡 → 不發送
      expect(results[1].creditsUsed).toBe(0);
    });
  });

  describe('reserved · SERPAPI_AI_ENABLED=false', () => {
    it('short-circuits to all-null without calling the client when disabled', async () => {
      const { client, searchCalls, fetchCalls } = fakeClient({
        onSearch: () => aiOverviewInlineV1,
      });
      const provider = new SerpApiAiProvider(client, { ...AI_CONFIG, enabled: false });

      const results = await provider.fetchAiOverviews(['a', 'b']);

      expect(searchCalls).toHaveLength(0);
      expect(fetchCalls).toHaveLength(0);
      expect(results).toEqual([
        { query: 'a', aiOverview: null, creditsUsed: 0 },
        { query: 'b', aiOverview: null, creditsUsed: 0 },
      ]);
    });
  });
});
