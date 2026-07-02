/**
 * serpapi.com 回應的**最小子集**（只取本案解析的欄位；typed against 供應商 wire 形狀，勿 `as never`）。
 * 真實 client 走 HTTP（SERP_API_URL + api_key）；測試以 fake 替換（fixture，不真打）。
 */
export interface SerpApiOrganicResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
}

export interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  related_questions?: { question?: string }[];
  related_searches?: { query?: string }[];
}

/** serpapi search 參數子集（q + 地區/語言/筆數/裝置）。 */
export interface SerpApiSearchParams {
  q: string;
  gl?: string;
  hl?: string;
  num?: number;
  device?: string;
}

/** SERP HTTP client 的 Port（DI 可換、測試可 mock；正式為 serpapi HTTP adapter，slice 3 於 SerpModule 建構）。 */
export const SERP_API_CLIENT = Symbol('SERP_API_CLIENT');

export interface SerpApiClient {
  search(params: SerpApiSearchParams): Promise<SerpApiResponse>;
}
