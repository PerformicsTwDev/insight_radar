import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';

/**
 * AI 可見度指標純函式（T15.4；FR-43，AC-43.1/43.2/43.3，TC-79）。**純函式**（無 IO/LLM/DB）。
 *
 * TDD red stub —— 綠燈階段以真實實作取代（此處僅提供型別骨架，讓失敗測試可執行）。
 */

/** 可見度分組維度（AC-43.3）：keyword / 意圖主題 / 購買歷程主題。 */
export type VisibilityDimension = 'keyword' | 'intent' | 'journey';

/** BrandProfile 的可見度相關面（T14.5）：canonical `name`（報告/歸戶用）+ `sites`（citations 命中用）。 */
export interface VisibilityBrand {
  name: string;
  sites: readonly string[];
}

/** 一個 (channel × dimension × group) 範疇的觀測。純資料，無 IO。 */
export interface AiVisibilityScope {
  channel: CaptureChannel;
  dimension: VisibilityDimension;
  /** 分組值：keyword 文字 / 意圖主題 / 購買歷程主題。 */
  group: string;
  /** 該範疇 AI 回答抽出的品牌提及（canonical names，**不去重＝露出次數**，T15.2/S17）。 */
  mentions: readonly string[];
  /** 該範疇 AI 回答的引用連結（URL 或 domain）；命中某品牌 sites → 該品牌 citations +1。 */
  citations: readonly string[];
  /** 該範疇涉及關鍵字的 `avgMonthlySearches`（複用 Search 線）；**任一 null → 不計入（不補 0）**。 */
  searchVolumes: readonly (number | null)[];
}

/** 單一 (channel × dimension × group × brand) 的可見度指標列（指標值，**不含 view 格式**，解耦）。 */
export interface AiVisibilityCell {
  channel: CaptureChannel;
  dimension: VisibilityDimension;
  group: string;
  brand: string;
  mentions: number;
  shareOfVoice: number | null;
  citations: number;
  exposure: number | null;
}

export function shareOfVoice(_brandMentions: number, _totalMentions: number): number | null {
  throw new Error('not implemented');
}

export function sumExposure(_searchVolumes: readonly (number | null)[]): number | null {
  throw new Error('not implemented');
}

export function countMentions(_mentions: readonly string[], _brand: string): number {
  throw new Error('not implemented');
}

export function citationHitsBrand(_link: string, _siteDomains: readonly string[]): boolean {
  throw new Error('not implemented');
}

export function countCitations(
  _citations: readonly string[],
  _siteDomains: readonly string[],
): number {
  throw new Error('not implemented');
}

export function buildAiVisibility(
  _scopes: readonly AiVisibilityScope[],
  _brands: readonly VisibilityBrand[],
): AiVisibilityCell[] {
  throw new Error('not implemented');
}
