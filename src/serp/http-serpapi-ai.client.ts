import type { FetchLike } from './http-serp-api.client';
import type {
  SerpApiAiClient,
  SerpApiAiOverviewFetchParams,
  SerpApiAiSearchParams,
  SerpApiBingCopilotResponse,
  SerpApiGoogleAiModeResponse,
  SerpApiGoogleAiOverviewResponse,
  SerpApiGoogleSearchResponse,
} from './serpapi-ai.types';

/**
 * SerpApi AI HTTP client（T14.2，reserved）：實作 {@link SerpApiAiClient}——組
 * `apiUrl?engine&…&api_key` GET → JSON。憑證只放 query（不入 log）；非 2xx 拋帶 `status` 的錯
 * （供上層 degradation 判定）。憑證/端點沿用 SERP（`SERP_API_KEY`/`SERP_API_URL`）。
 *
 * 四個 engine：`engine=google`（`ai_overview` 內嵌 / `page_token` 兩路）、`engine=google_ai_overview`
 * （以 `page_token` 二次抓取，接受 `AbortSignal` 供時限取消，AC-38.1 <1min 過期）、`engine=google_ai_mode`
 * （AC-38.3）與 `engine=bing_copilot`（AC-38.4，could）——後兩者 top-level `text_blocks`/`references`，共用
 * `searchTopLevel`。**`SERPAPI_AI_ENABLED=false` 時整條不被呼叫**（reserved、provider 短路）。
 */
export class HttpSerpApiAiClient implements SerpApiAiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async searchGoogle(params: SerpApiAiSearchParams): Promise<SerpApiGoogleSearchResponse> {
    const url = new URL(this.apiUrl);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', params.q);
    url.searchParams.set('hl', params.hl);
    url.searchParams.set('gl', params.gl);
    url.searchParams.set('api_key', this.apiKey);

    const response = await this.fetchFn(url.toString());
    if (!response.ok) {
      throw Object.assign(new Error(`SERP HTTP ${response.status}`), { status: response.status });
    }
    return (await response.json()) as SerpApiGoogleSearchResponse;
  }

  async fetchAiOverview(
    params: SerpApiAiOverviewFetchParams,
  ): Promise<SerpApiGoogleAiOverviewResponse> {
    const url = new URL(this.apiUrl);
    url.searchParams.set('engine', 'google_ai_overview');
    url.searchParams.set('page_token', params.pageToken);
    url.searchParams.set('api_key', this.apiKey);

    const response = await this.fetchFn(
      url.toString(),
      params.signal ? { signal: params.signal } : undefined,
    );
    if (!response.ok) {
      throw Object.assign(new Error(`SERP HTTP ${response.status}`), { status: response.status });
    }
    return (await response.json()) as SerpApiGoogleAiOverviewResponse;
  }

  async searchAiMode(params: SerpApiAiSearchParams): Promise<SerpApiGoogleAiModeResponse> {
    return this.searchTopLevel<SerpApiGoogleAiModeResponse>('google_ai_mode', params);
  }

  async searchBingCopilot(params: SerpApiAiSearchParams): Promise<SerpApiBingCopilotResponse> {
    return this.searchTopLevel<SerpApiBingCopilotResponse>('bing_copilot', params);
  }

  /**
   * `engine=<google_ai_mode|bing_copilot>` 搜尋（top-level `text_blocks`/`references` engine，AC-38.3/38.4）——共用 GET
   * 組裝：`api_key` 只放 query（不入 log）；非 2xx 拋帶 `status` 的錯（供上層 degradation 分類）。
   */
  private async searchTopLevel<T>(
    engine: 'google_ai_mode' | 'bing_copilot',
    params: SerpApiAiSearchParams,
  ): Promise<T> {
    const url = new URL(this.apiUrl);
    url.searchParams.set('engine', engine);
    url.searchParams.set('q', params.q);
    url.searchParams.set('hl', params.hl);
    url.searchParams.set('gl', params.gl);
    url.searchParams.set('api_key', this.apiKey);

    const response = await this.fetchFn(url.toString());
    if (!response.ok) {
      throw Object.assign(new Error(`SERP HTTP ${response.status}`), { status: response.status });
    }
    return (await response.json()) as T;
  }
}
