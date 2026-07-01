/**
 * Embeddings 模組共用型別（T8.2，FR-16）。`SerpContext` 為 buildEmbeddingInput 消費的**中立** SERP 輸入
 * 契約（T8.3 的 `SerpProvider` 產出此形狀；未帶 SERP 時 undefined → 降級純關鍵字）。
 */

/** 單一 organic 結果（title + snippet）。 */
export interface SerpOrganic {
  title: string;
  snippet: string;
}

/** 組裝 embedding 輸入用的中立 SERP 上下文（top-N organic + PAA + related）。 */
export interface SerpContext {
  organic: SerpOrganic[];
  /** People-Also-Ask 問句。 */
  peopleAlsoAsk?: string[];
  /** 相關搜尋詞。 */
  relatedSearches?: string[];
}

/** buildEmbeddingInput 產出：送 embedding 的文字 + 穩定 input_hash（含是否帶 SERP）。 */
export interface EmbeddingInput {
  /** 實際送 Gemini 的組裝文字（已截到 token 上限）。 */
  text: string;
  /** 內容定址雜湊（快取 key；含 schemaVersion 與是否帶 SERP，避免污染，TC-39/TC-50）。 */
  inputHash: string;
  /** SERP 是否實際貢獻了內容（缺失/全空 → false，降級純關鍵字）。 */
  hasSerp: boolean;
}
