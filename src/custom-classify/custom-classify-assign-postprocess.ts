import { normalizeText } from '../google-ads/normalize';
import { UNCLASSIFIED_LABEL } from './custom-classify-assign.schema';

/**
 * 後處理的暫態 DTO（非 canonical 實體）。下游 service / repository 才組裝成 snapshot-scoped assignment。
 * 用 `keyword`/`label` 對齊 LLM 回應與 TC-70 語意（single-label：每字恰一 label）。
 */
export interface AssignedKeyword {
  keyword: string;
  label: string;
}

/**
 * 後處理的輸入形狀——**刻意寬鬆**：此函式是驗證邊界，`label` 視為未驗證字串（strict schema 只在「非 refusal /
 * 非截斷」時保證，LLM 仍可能回非確認集值），故在此清洗。
 */
export interface RawCustomAssignBatch {
  results: Array<{ keyword: string; label: string }>;
}

/**
 * 清洗單一 label：在**確認集** `allowed` 內 → 原值；否則 → `null`（後處理補 sentinel）。**驗證邊界單點**：後處理
 * （TC-70）與快取回寫共用此函式，確保「raw LLM label 視為不可信」在兩條路徑上一致清洗（不污染下游）。
 */
export function cleanLabel(label: string, allowed: Set<string>): string | null {
  return allowed.has(label) ? label : null;
}

/**
 * 自訂分類階段二後處理（FR-34 / AC-34.2，TC-70）。純函式：把 LLM 結果對回**每個**原始輸入。
 *
 * - 以 `normalizedText` 對回輸入（與快取/去重共用同一 key，跨大小寫/空白）。
 * - single-label：每字恰一 label；非確認集 / 缺漏 → sentinel `unclassified`（保證每輸入恰一列，S11——**不**退取第一
 *   確認標籤以免靜默污染真桶）。
 * - 輸出恰好每個輸入一列、依輸入順序；不產生使用者未輸入的列（drop 幻覺）。
 * - 同 key 多筆結果以**最後一筆**為準（含最後一筆非法時 → unclassified）。
 */
export function postProcessCustomAssign(
  inputs: string[],
  parsed: RawCustomAssignBatch,
  labels: string[],
): AssignedKeyword[] {
  const allowed = new Set(labels);
  // 建 normalizedText → cleaned label 對照（後到覆蓋先到；最後一筆非法 → null → 下方補 sentinel）。
  const byKey = new Map<string, string | null>();
  for (const result of parsed.results) {
    byKey.set(normalizeText(result.keyword), cleanLabel(result.label, allowed));
  }

  return inputs.map((keyword) => ({
    keyword, // 保留使用者原字
    label: byKey.get(normalizeText(keyword)) ?? UNCLASSIFIED_LABEL,
  }));
}
