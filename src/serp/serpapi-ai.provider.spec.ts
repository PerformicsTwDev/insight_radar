import type { ConfigType } from '@nestjs/config';
import type { serpAiConfig } from '../config/serp-ai.config';
import {
  aiModeV1,
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
  type SerpApiBingCopilotResponse,
  type SerpApiGoogleAiModeResponse,
  type SerpApiGoogleAiOverviewResponse,
  type SerpApiGoogleSearchResponse,
  type SerpCreditLedger,
} from './serpapi-ai.types';

const AI_CONFIG: ConfigType<typeof serpAiConfig> = {
  enabled: true,
  aiModeEnabled: false,
  bingCopilotEnabled: false,
  aioPageTokenTimeoutMs: 50000,
  creditsBudget: 1000,
  hl: 'zh-tw',
  gl: 'tw',
};

interface FakeClientOpts {
  onSearch?: (params: SerpApiAiSearchParams) => SerpApiGoogleSearchResponse;
  onFetchAiOverview?: (
    params: SerpApiAiOverviewFetchParams,
  ) => SerpApiGoogleAiOverviewResponse | Promise<SerpApiGoogleAiOverviewResponse>;
  onSearchAiMode?: (
    params: SerpApiAiSearchParams,
  ) => SerpApiGoogleAiModeResponse | Promise<SerpApiGoogleAiModeResponse>;
  onSearchBingCopilot?: (
    params: SerpApiAiSearchParams,
  ) => SerpApiBingCopilotResponse | Promise<SerpApiBingCopilotResponse>;
}

function fakeClient(opts: FakeClientOpts): {
  client: SerpApiAiClient;
  searchCalls: SerpApiAiSearchParams[];
  fetchCalls: SerpApiAiOverviewFetchParams[];
  aiModeCalls: SerpApiAiSearchParams[];
  copilotCalls: SerpApiAiSearchParams[];
} {
  const searchCalls: SerpApiAiSearchParams[] = [];
  const fetchCalls: SerpApiAiOverviewFetchParams[] = [];
  const aiModeCalls: SerpApiAiSearchParams[] = [];
  const copilotCalls: SerpApiAiSearchParams[] = [];
  const client: SerpApiAiClient = {
    searchGoogle: (params) => {
      searchCalls.push(params);
      if (!opts.onSearch) {
        return Promise.reject(new Error('unexpected searchGoogle call'));
      }
      return Promise.resolve(opts.onSearch(params));
    },
    fetchAiOverview: (params) => {
      fetchCalls.push(params);
      if (!opts.onFetchAiOverview) {
        return Promise.reject(new Error('unexpected fetchAiOverview call'));
      }
      return Promise.resolve(opts.onFetchAiOverview(params));
    },
    searchAiMode: (params) => {
      aiModeCalls.push(params);
      if (!opts.onSearchAiMode) {
        return Promise.reject(new Error('unexpected searchAiMode call'));
      }
      return Promise.resolve(opts.onSearchAiMode(params));
    },
    searchBingCopilot: (params) => {
      copilotCalls.push(params);
      if (!opts.onSearchBingCopilot) {
        return Promise.reject(new Error('unexpected searchBingCopilot call'));
      }
      return Promise.resolve(opts.onSearchBingCopilot(params));
    },
  };
  return { client, searchCalls, fetchCalls, aiModeCalls, copilotCalls };
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

    // ── issue #580 [3]：主 AIO searchGoogle 失敗須 degrade（比照 sibling），不得整批中止 ──
    it('degrades to aiOverview=null when the PRIMARY searchGoogle fails (5xx) — not thrown (#580 [3])', async () => {
      const { client, searchCalls, fetchCalls } = fakeClient({
        onSearch: () => {
          throw Object.assign(new Error('SERP HTTP 500'), { status: 500 });
        },
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['primary fails']);

      expect(searchCalls).toHaveLength(1);
      expect(fetchCalls).toHaveLength(0); // 主查詢就失敗 → 無二次抓取
      expect(result.aiOverview).toBeNull();
      expect(result.creditsUsed).toBe(1); // 主查詢已發送 → 計費（比照 sibling degradation）
    });

    it('a single primary failure degrades only that query while the rest of the batch still succeeds (#580 [3])', async () => {
      const { client, searchCalls } = fakeClient({
        onSearch: (params) => {
          if (params.q === 'boom') {
            throw Object.assign(new Error('SERP HTTP 502'), { status: 502 });
          }
          return aiOverviewInlineV1;
        },
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const results = await provider.fetchAiOverviews(['boom', 'ok']);

      expect(searchCalls).toHaveLength(2); // 第一筆失敗未中止全批（INV-6 partial）
      expect(results[0].aiOverview).toBeNull();
      expect(results[0].creditsUsed).toBe(1);
      expect(results[1].aiOverview).not.toBeNull();
      expect(results[1].creditsUsed).toBe(1);
    });

    // ── issue #580 [4]：ai_overview 為 non-object primitive（schema 漂移）→ isInline 不得 TypeError ──
    it('degrades to null (not TypeError) when ai_overview is a non-object primitive — schema drift (#580 [4])', async () => {
      const { client, fetchCalls } = fakeClient({
        onSearch: () => ({ ai_overview: 'unavailable' }) as unknown as SerpApiGoogleSearchResponse,
      });
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const [result] = await provider.fetchAiOverviews(['drifted primitive']);

      expect(fetchCalls).toHaveLength(0);
      expect(result.aiOverview).toBeNull();
      expect(result.creditsUsed).toBe(1);
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

  // ─────────────────────────────────────────────────────────────────────────
  // AC-38.3 · AI Mode（engine=google_ai_mode）→ AiSearchCapture（channel=aiMode）
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC-38.3 · AI Mode（engine=google_ai_mode，top-level blocks/references）', () => {
    const AI_MODE_ON = { ...AI_CONFIG, aiModeEnabled: true };

    it('parses google_ai_mode top-level text_blocks/references into an AiSearchCapture (channel=aiMode)', async () => {
      const { client, aiModeCalls } = fakeClient({ onSearchAiMode: () => aiModeV1 });
      const provider = new SerpApiAiProvider(client, AI_MODE_ON);

      const [result] = await provider.fetchAiModes(['電動牙刷推薦 2026']);

      expect(aiModeCalls).toHaveLength(1);
      expect(result.query).toBe('電動牙刷推薦 2026');
      expect(result.creditsUsed).toBe(1); // 單次呼叫（無 page_token 兩路）
      expect(result.aiMode).not.toBeNull();
      expect(result.aiMode).toMatchObject({
        source: 'serpapi',
        channel: 'aiMode',
        schemaVersion: SERPAPI_AI_SCHEMA_VERSION,
        query: '電動牙刷推薦 2026',
      });
      // blocks 取 top-level text_blocks（原樣保留，§18.3；reconstructed_markdown 不覆寫已有 text_blocks）
      expect(result.aiMode!.blocks).toEqual(aiModeV1.text_blocks);
      // references 統一為中立形狀（複用 normalizeReferences，與 AIO 同一套）
      expect(result.aiMode!.references).toHaveLength(3);
      expect(result.aiMode!.references[0]).toEqual({
        index: 0,
        title: '電動牙刷選購指南',
        link: 'https://review.example.tw/electric-toothbrush-guide',
        snippet: '整理清潔模式、刷頭與續航等挑選重點。',
        source: 'review.example.tw',
      });
    });

    it('AC-38.5: sends hl=zh-tw / gl=tw for AI Mode', async () => {
      const { client, aiModeCalls } = fakeClient({ onSearchAiMode: () => aiModeV1 });
      const provider = new SerpApiAiProvider(client, AI_MODE_ON);

      await provider.fetchAiModes(['露營新手裝備推薦']);

      expect(aiModeCalls[0]).toEqual({ q: '露營新手裝備推薦', hl: 'zh-tw', gl: 'tw' });
    });

    it('does not enable AI Mode when SERPAPI_AI_MODE_ENABLED=false (per-engine gate off)', async () => {
      const { client, aiModeCalls } = fakeClient({ onSearchAiMode: () => aiModeV1 });
      // master enabled 但 aiModeEnabled=false（AI_CONFIG 預設）→ 不啟用
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const results = await provider.fetchAiModes(['a', 'b']);

      expect(aiModeCalls).toHaveLength(0);
      expect(results).toEqual([
        { query: 'a', aiMode: null, creditsUsed: 0 },
        { query: 'b', aiMode: null, creditsUsed: 0 },
      ]);
    });

    it('does not enable AI Mode when the master SERPAPI_AI_ENABLED=false (even if aiModeEnabled=true)', async () => {
      const { client, aiModeCalls } = fakeClient({ onSearchAiMode: () => aiModeV1 });
      const provider = new SerpApiAiProvider(client, {
        ...AI_CONFIG,
        enabled: false,
        aiModeEnabled: true,
      });

      const results = await provider.fetchAiModes(['a']);

      expect(aiModeCalls).toHaveLength(0);
      expect(results).toEqual([{ query: 'a', aiMode: null, creditsUsed: 0 }]);
    });

    it('degrades to aiMode=null when the AI Mode fetch fails (not an error, credit still spent)', async () => {
      const { client, aiModeCalls } = fakeClient({
        onSearchAiMode: () => {
          throw Object.assign(new Error('SERP HTTP 500'), { status: 500 });
        },
      });
      const provider = new SerpApiAiProvider(client, AI_MODE_ON);

      const [result] = await provider.fetchAiModes(['fails']);

      expect(aiModeCalls).toHaveLength(1);
      expect(result.aiMode).toBeNull();
      expect(result.creditsUsed).toBe(1); // 已發送 → 計費
    });

    it('degrades to null when the response is malformed (no top-level text_blocks)', async () => {
      const { client } = fakeClient({
        onSearchAiMode: () =>
          ({ search_metadata: { status: 'Success' } }) as unknown as SerpApiGoogleAiModeResponse,
      });
      const provider = new SerpApiAiProvider(client, AI_MODE_ON);

      const [result] = await provider.fetchAiModes(['malformed']);

      expect(result.aiMode).toBeNull();
      expect(result.creditsUsed).toBe(1);
    });

    it('stops issuing AI Mode searches once the credit budget is exhausted across the batch', async () => {
      const { client, aiModeCalls } = fakeClient({ onSearchAiMode: () => aiModeV1 });
      const provider = new SerpApiAiProvider(client, { ...AI_MODE_ON, creditsBudget: 1 });

      const results = await provider.fetchAiModes(['first', 'second']);

      expect(aiModeCalls).toHaveLength(1); // 只發第一個
      expect(results[0].aiMode).not.toBeNull();
      expect(results[0].creditsUsed).toBe(1);
      expect(results[1].aiMode).toBeNull(); // 預算耗盡 → 不發送
      expect(results[1].creditsUsed).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC-38.4 · Bing Copilot（engine=bing_copilot，could，SERPAPI_BING_COPILOT_ENABLED 預設關）
  // ─────────────────────────────────────────────────────────────────────────
  describe('AC-38.4 · Bing Copilot（could，flag-gated）', () => {
    const copilotResponse: SerpApiBingCopilotResponse = {
      search_metadata: { status: 'Success' },
      search_parameters: { engine: 'bing_copilot', q: '筆電推薦', hl: 'zh-tw', gl: 'tw' },
      header: 'Copilot 摘要',
      text_blocks: [
        { type: 'paragraph', snippet: '依用途與預算挑選筆電。', reference_indexes: [0] },
      ],
      references: [
        {
          index: 0,
          title: '筆電選購指南',
          link: 'https://tech.example.tw/laptop-guide',
          source: 'tech.example.tw',
        },
      ],
    };

    it('does not enable Copilot when SERPAPI_BING_COPILOT_ENABLED=false (default; primary DoD)', async () => {
      const { client, copilotCalls } = fakeClient({ onSearchBingCopilot: () => copilotResponse });
      // master enabled 但 bingCopilotEnabled=false（AI_CONFIG 預設）→ 不啟用
      const provider = new SerpApiAiProvider(client, AI_CONFIG);

      const results = await provider.fetchBingCopilot(['a', 'b']);

      expect(copilotCalls).toHaveLength(0);
      expect(results).toEqual([
        { query: 'a', copilot: null, creditsUsed: 0 },
        { query: 'b', copilot: null, creditsUsed: 0 },
      ]);
    });

    it('does not enable Copilot when the master SERPAPI_AI_ENABLED=false (even if flag on)', async () => {
      const { client, copilotCalls } = fakeClient({ onSearchBingCopilot: () => copilotResponse });
      const provider = new SerpApiAiProvider(client, {
        ...AI_CONFIG,
        enabled: false,
        bingCopilotEnabled: true,
      });

      const results = await provider.fetchBingCopilot(['a']);

      expect(copilotCalls).toHaveLength(0);
      expect(results).toEqual([{ query: 'a', copilot: null, creditsUsed: 0 }]);
    });

    it('when enabled, maps bing_copilot top-level blocks/references into an AiSearchCapture (channel=bingCopilot)', async () => {
      const { client, copilotCalls } = fakeClient({ onSearchBingCopilot: () => copilotResponse });
      const provider = new SerpApiAiProvider(client, {
        ...AI_CONFIG,
        bingCopilotEnabled: true,
      });

      const [result] = await provider.fetchBingCopilot(['筆電推薦']);

      expect(copilotCalls).toHaveLength(1);
      expect(copilotCalls[0]).toEqual({ q: '筆電推薦', hl: 'zh-tw', gl: 'tw' });
      expect(result.creditsUsed).toBe(1);
      expect(result.copilot).not.toBeNull();
      expect(result.copilot).toMatchObject({
        source: 'serpapi',
        channel: 'bingCopilot',
        query: '筆電推薦',
      });
      expect(result.copilot!.blocks).toEqual(copilotResponse.text_blocks);
      expect(result.copilot!.references).toHaveLength(1);
      expect(result.copilot!.references[0].link).toBe('https://tech.example.tw/laptop-guide');
    });

    it('degrades to copilot=null when the enabled Copilot fetch fails', async () => {
      const { client, copilotCalls } = fakeClient({
        onSearchBingCopilot: () => {
          throw Object.assign(new Error('SERP HTTP 503'), { status: 503 });
        },
      });
      const provider = new SerpApiAiProvider(client, { ...AI_CONFIG, bingCopilotEnabled: true });

      const [result] = await provider.fetchBingCopilot(['fails']);

      expect(copilotCalls).toHaveLength(1);
      expect(result.copilot).toBeNull();
      expect(result.creditsUsed).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // M14-R5 / #581 · per-job credit ledger 跨渠道共享（NFR-18）
  // 缺陷：fetchAiOverviews / fetchAiModes / fetchBingCopilot 各自 reset spent=0，故單一 job 同時抓多個 serpapi
  // 渠道時，各 method 各起一份 accumulator against 同 SERPAPI_AI_CREDITS_BUDGET → 總花費達 N×（此處 3×）per-job
  // 上限（Design §14「每 job」/ NFR-18）。修正＝傳入單一 ledger 讓三個 method 共用同一 per-job 預算。
  // ─────────────────────────────────────────────────────────────────────────
  describe('M14-R5 / #581 · per-job credit ledger shared across serpapi channels (NFR-18)', () => {
    const copilotResponse: SerpApiBingCopilotResponse = {
      search_metadata: { status: 'Success' },
      search_parameters: { engine: 'bing_copilot', q: 'x', hl: 'zh-tw', gl: 'tw' },
      header: 'Copilot',
      text_blocks: [{ type: 'paragraph', snippet: 'copilot 摘要', reference_indexes: [0] }],
      references: [
        { index: 0, title: 't', link: 'https://c.example.tw/a', source: 'c.example.tw' },
      ],
    };

    it('caps TOTAL credits at the per-job budget across aiOverview+aiMode+bingCopilot (not N× per method)', async () => {
      const { client, searchCalls, aiModeCalls, copilotCalls } = fakeClient({
        onSearch: () => aiOverviewInlineV1, // 內嵌路 = 1 credit/query（無二次抓取）
        onSearchAiMode: () => aiModeV1,
        onSearchBingCopilot: () => copilotResponse,
      });
      // 全渠道啟用、per-job budget = 2；單一 job 抓 2 個關鍵字 × 3 渠道。
      const provider = new SerpApiAiProvider(client, {
        ...AI_CONFIG,
        aiModeEnabled: true,
        bingCopilotEnabled: true,
        creditsBudget: 2,
      });
      const ledger: SerpCreditLedger = { spent: 0 };
      const keywords = ['k1', 'k2'];

      // caller（processor）建一次 ledger、傳給三個 method 共用 → 跨渠道累計同一 per-job 預算。
      const aio = await provider.fetchAiOverviews(keywords, ledger);
      const modes = await provider.fetchAiModes(keywords, ledger);
      const copilots = await provider.fetchBingCopilot(keywords, ledger);

      const totalCredits =
        aio.reduce((s, r) => s + r.creditsUsed, 0) +
        modes.reduce((s, r) => s + r.creditsUsed, 0) +
        copilots.reduce((s, r) => s + r.creditsUsed, 0);
      // 缺陷現況：每 method 各花 2 → 6；修正後：跨渠道共享 → ≤ 2（per-job cap，NFR-18）。
      expect(totalCredits).toBeLessThanOrEqual(2);

      // over-budget 的請求**不發送**（不打供應商）：總送出數 = per-job budget。
      const totalSends = searchCalls.length + aiModeCalls.length + copilotCalls.length;
      expect(totalSends).toBe(2);

      // aiOverview 先跑用滿預算 → 兩筆皆有 capture；aiMode / copilot 預算已耗盡 → 全 degrade null。
      expect(aio.every((r) => r.aiOverview !== null)).toBe(true);
      expect(modes.every((r) => r.aiMode === null)).toBe(true);
      expect(copilots.every((r) => r.copilot === null)).toBe(true);
    });

    it('omitting the ledger keeps each method on its own per-invocation budget (backward compatible)', async () => {
      const { client } = fakeClient({ onSearch: () => aiOverviewInlineV1 });
      const provider = new SerpApiAiProvider(client, { ...AI_CONFIG, creditsBudget: 2 });

      // 不傳 ledger（standalone/契約呼叫）→ 該 method 獨立一份預算，行為與既有單 method 測試一致。
      const aio = await provider.fetchAiOverviews(['k1', 'k2']);

      expect(aio.reduce((s, r) => s + r.creditsUsed, 0)).toBe(2);
      expect(aio.every((r) => r.aiOverview !== null)).toBe(true);
    });
  });
});
