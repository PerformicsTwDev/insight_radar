/**
 * 品牌情緒後處理（RED 空殼，T15.3；FR-42/AC-42.2 / S17，TC-78）。型別為真、`postProcessSentiment` 尚未實作。
 * green 時：把 LLM 每筆 `{id,positive,negative}` 對回每個輸入 block，缺漏/降級補 `{0,0}`（partial 不污染他筆）；
 * **S17 業務規則（不可「修正」）**：褒貶**混合**時 positive 與 negative 皆保留為 1（各 +1，不 collapse 成單邊）。
 */

/** 一段 AI 回答 text block（合成 `id` + 餵 LLM 的文字）——情緒判定的輸入單位。 */
export interface SentimentTextBlock {
  id: string;
  text: string;
}

/** 單一 block 的情緒結果（褒/貶各自 0|1，混合＝皆 1，S17）。 */
export interface BlockSentiment {
  id: string;
  positive: 0 | 1;
  negative: 0 | 1;
}

/** LLM 情緒輸出的原始形狀（**刻意寬鬆**：後處理為驗證邊界，positive/negative 視為未驗證 number）。 */
export interface RawSentimentBatch {
  results: Array<{ id: string; positive: number; negative: number }>;
}

export function postProcessSentiment(
  _blocks: readonly SentimentTextBlock[],
  _parsed: RawSentimentBatch,
): BlockSentiment[] {
  throw new Error('postProcessSentiment not implemented (T15.3 red)');
}
