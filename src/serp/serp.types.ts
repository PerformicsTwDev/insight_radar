/**
 * SERP 模組共用**中立**型別（T8.3，FR-15）。與供應商解耦：`SerpApiProvider`（serpapi）、`SerpProvider`
 * （serper）、`BrowserExtensionProvider`（Phase 2）皆產出此形狀。持久化於 `serp_fetches.results`。
 * 可 map 到 embeddings 的 `SerpContext`（buildEmbeddingInput 消費，T8.9 組裝時轉換）。
 */

/** 單筆 organic 結果（position 由 1 起；domain 由 url host 萃取）。 */
export interface SerpOrganicResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

/** 中立 SERP 結果（persist 進 serp_fetches.results 的形狀）。 */
export interface SerpResult {
  organic: SerpOrganicResult[];
  /** People-Also-Ask 問句。 */
  paa?: string[];
  /** 相關搜尋詞。 */
  related?: string[];
}

/** 要抓 SERP 的關鍵字（供應商查詢維度；normalizedText 為去重/持久鍵）。 */
export interface SerpQuery {
  normalizedText: string;
  keyword: string;
  geo: string;
  language: string;
  device?: string;
}

/** 一筆 SERP 抓取結果（含查詢維度 + provider + 中立 results + 抓取時間）。 */
export interface SerpFetchResult extends SerpQuery {
  provider: string;
  results: SerpResult;
  fetchedAt: Date;
}
