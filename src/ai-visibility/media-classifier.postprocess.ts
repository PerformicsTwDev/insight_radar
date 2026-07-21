import { MEDIA_TYPES, type MediaType } from './media-classifier.schema';

/**
 * 引用媒體分類後處理（T15.3；FR-42/AC-42.3，TC-78）。純函式：把 LLM 每筆 `{id,type}` 對回**每個**輸入
 * reference（依 `id`），並把 `type` 清洗成合法 9-enum。
 *
 * - 驗證邊界：`type` 視為未驗證字串（strict schema 僅「非 refusal/非截斷」時保證）；非 `MEDIA_TYPES` 成員
 *   的雜訊值收斂為 `other`（不讓非法 enum 污染下游可見度指標，FR-43）。
 * - 每輸入 reference 恰一列、依輸入順序；缺漏/降級 reference 補 `other`（**部分失敗不污染他筆**，AC-42.5）。
 * - 同 `id` 多筆結果以**最後一筆**為準（沿用 last-wins）。
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

/** 合法 9-enum 的成員集（O(1) 驗成員）；非成員/缺值 → `other` fallback。 */
const VALID_TYPES = new Set<string>(MEDIA_TYPES);
const FALLBACK_TYPE: MediaType = 'other';

/** 清洗成合法 9-enum（驗證邊界；非法/缺值 → other）。 */
function cleanType(raw: string | undefined): MediaType {
  return raw !== undefined && VALID_TYPES.has(raw) ? (raw as MediaType) : FALLBACK_TYPE;
}

export function postProcessMedia(
  refs: readonly MediaReference[],
  parsed: RawMediaBatch,
): BlockMedia[] {
  // id → raw type（後到覆蓋先到）。
  const byId = new Map<string, string>();
  for (const result of parsed.references) {
    byId.set(result.id, result.type);
  }

  return refs.map((ref) => ({ id: ref.id, type: cleanType(byId.get(ref.id)) }));
}
