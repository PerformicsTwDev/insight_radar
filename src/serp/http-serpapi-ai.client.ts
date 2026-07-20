import type { FetchLike } from './http-serp-api.client';
import type {
  SerpApiAiClient,
  SerpApiAiOverviewFetchParams,
  SerpApiAiSearchParams,
  SerpApiGoogleAiOverviewResponse,
  SerpApiGoogleSearchResponse,
} from './serpapi-ai.types';

/**
 * SerpApi AI HTTP client（T14.2，reserved）：實作 {@link SerpApiAiClient}——組
 * `apiUrl?engine&…&api_key` GET → JSON。憑證只放 query（不入 log）；非 2xx 拋帶 `status` 的錯
 * （供上層 degradation 判定）。憑證/端點沿用 SERP（`SERP_API_KEY`/`SERP_API_URL`）。
 *
 * 兩個 engine：`engine=google`（`ai_overview` 內嵌 / `page_token` 兩路）與 `engine=google_ai_overview`
 * （以 `page_token` 二次抓取，接受 `AbortSignal` 供時限取消，AC-38.1 <1min 過期）。
 * **`SERPAPI_AI_ENABLED=false` 時整條不被呼叫**（reserved、provider 短路）。
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
}
