import type { MediaType } from './media-classifier.schema';

/**
 * 引用媒體分類後處理（RED 空殼，T15.3；FR-42/AC-42.3，TC-78）。型別為真、`postProcessMedia` 尚未實作。
 * green 時：把 LLM 每筆 `{id,type}` 對回每個輸入 reference，非合法 enum 值收斂為 `other`（驗證邊界），
 * 缺漏/降級補 `other`（partial 不污染他筆，AC-42.5）。
 */

/** 一則 AI 回答引用（`id` + `link`）——媒體分類的輸入單位（依 domain/subdomain 判類）。 */
export interface MediaReference {
  id: string;
  link: string;
}

/** 單則引用的媒體類別結果（9 類 enum 之一）。 */
export interface BlockMedia {
  id: string;
  type: MediaType;
}

/** LLM 媒體分類輸出的原始形狀（**刻意寬鬆**：後處理為驗證邊界，type 視為未驗證字串）。 */
export interface RawMediaBatch {
  references: Array<{ id: string; type: string }>;
}

export function postProcessMedia(
  _refs: readonly MediaReference[],
  _parsed: RawMediaBatch,
): BlockMedia[] {
  throw new Error('postProcessMedia not implemented (T15.3 red)');
}
