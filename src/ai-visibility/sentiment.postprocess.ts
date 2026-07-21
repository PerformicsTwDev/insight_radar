/**
 * 品牌情緒後處理（T15.3；FR-42/AC-42.2 / S17，TC-78）。純函式：把 LLM 每筆 `{id,positive,negative}` 對回
 * **每個**輸入 block（依 `id`），並清洗成 0|1。
 *
 * **S17 業務規則（不可「修正」）**：褒/貶各自獨立——**絕不** collapse 成單邊/二選一/三分類。同段同時褒貶
 * （LLM 回 `positive=1` 且 `negative=1`）→ 原樣保留雙邊各 1。
 *
 * - 驗證邊界：`positive`/`negative` 視為未驗證 number（strict schema 僅「非 refusal/非截斷」時保證），
 *   在此各自 clamp（`=== 1 ? 1 : 0`，互不影響）。
 * - 每輸入 block 恰一列、依輸入順序；缺漏/降級 block 補 `{positive:0, negative:0}`（**部分失敗不污染他筆**，AC-42.5）。
 * - 同 `id` 多筆結果以**最後一筆**為準（沿用 intent last-wins）。
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

/** 清洗成 0|1（驗證邊界；只有嚴格 `=== 1` 才算 1，其餘/缺值 → 0）。 */
function toBinary(value: number | undefined): 0 | 1 {
  return value === 1 ? 1 : 0;
}

export function postProcessSentiment(
  blocks: readonly SentimentTextBlock[],
  parsed: RawSentimentBatch,
): BlockSentiment[] {
  // id → raw {positive,negative}（後到覆蓋先到）。
  const byId = new Map<string, { positive: number; negative: number }>();
  for (const result of parsed.results) {
    byId.set(result.id, { positive: result.positive, negative: result.negative });
  }

  return blocks.map((block) => {
    const raw = byId.get(block.id);
    // 缺漏/降級 → raw undefined → toBinary(undefined)=0 → 補 {0,0}（AC-42.5，不污染他筆）。
    // S17：褒/貶**各自**獨立 clamp——混合 {1,1} 原樣保留，絕不 collapse。
    return {
      id: block.id,
      positive: toBinary(raw?.positive),
      negative: toBinary(raw?.negative),
    };
  });
}
