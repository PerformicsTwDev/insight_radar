import type { SerpApiClient, SerpApiResponse, SerpApiSearchParams } from './serp-api.types';

/** 自訂 fetch（測試注入；型別與全域 fetch 相容）。 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * serpapi HTTP client（T8.3）：組 `apiUrl?engine&q&gl&hl&num&device&api_key` GET → JSON → `SerpApiResponse`。
 * 憑證只放 query（不入 log）；非 2xx 拋帶 `status` 的錯（供 SerpApiProvider 退避判定）。**SERP_ENABLED=false
 * 時整條不會被呼叫**（SerpService 短路）。正式由 SerpModule factory 以 config + 全域 `fetch` 建構。
 */
export class HttpSerpApiClient implements SerpApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async search(params: SerpApiSearchParams): Promise<SerpApiResponse> {
    const url = new URL(this.apiUrl);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', params.q);
    if (params.gl) url.searchParams.set('gl', params.gl);
    if (params.hl) url.searchParams.set('hl', params.hl);
    if (params.num !== undefined) url.searchParams.set('num', String(params.num));
    if (params.device) url.searchParams.set('device', params.device);
    url.searchParams.set('api_key', this.apiKey);

    const response = await this.fetchFn(url.toString());
    if (!response.ok) {
      throw Object.assign(new Error(`SERP HTTP ${response.status}`), { status: response.status });
    }
    return (await response.json()) as SerpApiResponse;
  }
}
