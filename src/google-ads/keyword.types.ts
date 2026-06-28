/**
 * GoogleAds 拓展/去重的關鍵字領域型別（M1）。
 *
 * 對映 Design §5.1「Keyword（canonical / snapshot row 共用結構）」的子集——T1.1 只需
 * 去重所需欄位；指標（micros/competition/monthlyVolumes）由 T1.3–T1.5 的 mapper 補上。
 */

/** 來源：`seed`（使用者原字，一律納入並標記）／`expanded`（拓展字）。 */
export type KeywordSource = 'seed' | 'expanded';

/**
 * 去重前的候選字（拓展回應或使用者輸入的單筆）。
 * - `hasMetrics`：此筆是否帶 `keyword_idea_metrics`；合併同字時偏好保留 `true` 者（FR-2）。
 * - `seedOrigins`：expanded 專用——此拓展字來自哪些 seed 的 `normalizedText`。
 */
export interface KeywordCandidate {
  text: string;
  source: KeywordSource;
  hasMetrics?: boolean;
  seedOrigins?: string[];
}

/** 去重後的關鍵字：附 `normalizedText`（去重 + 快取共用 key）。 */
export interface DedupedKeyword extends KeywordCandidate {
  normalizedText: string;
}
