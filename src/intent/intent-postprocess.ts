import { normalizeText } from '../google-ads/normalize';
import { INTENT_LABELS, type IntentLabel } from './intent.schema';

/**
 * 後處理的暫態 DTO（非 canonical 實體）。下游 service 才組裝成 Design §5.1 的 `Keyword`
 * （`text` / `intentLabels`）；此處用 `keyword`/`labels` 對齊 LLM 回應與 TC-7 語意。
 */
export interface LabeledKeyword {
  keyword: string;
  labels: IntentLabel[];
}

/**
 * 後處理的輸入形狀——**刻意寬鬆**：此函式是驗證邊界，labels 視為未驗證字串
 * （strict schema 只在「非 refusal/非截斷」時保證，LLM 仍可能回非法值），故在此清洗。
 */
export interface RawIntentBatch {
  results: Array<{ keyword: string; labels: string[] }>;
}

/** fallback：無其他明確訊號時的預設標籤（Design §4.2）。 */
const FALLBACK_LABEL: IntentLabel = 'informational';
const VALID_LABELS = new Set<string>(INTENT_LABELS);

/** 去重並只保留合法 label，保持首見順序。 */
function cleanLabels(labels: string[]): IntentLabel[] {
  const out: IntentLabel[] = [];
  for (const label of labels) {
    if (VALID_LABELS.has(label) && !out.includes(label as IntentLabel)) {
      out.push(label as IntentLabel);
    }
  }
  return out;
}

/**
 * Intent 貼標後處理（FR-4 / NFR-3，TC-7）。純函式：把 LLM 結果對回**每個**原始輸入。
 *
 * - 以 `normalizedText` 對回輸入（與快取/去重共用同一 key，跨大小寫/空白）。
 * - labels 去重、丟棄非法值；清空後（或缺漏輸入）補 fallback `informational`（保證每輸入 ≥1 label）。
 * - 輸出恰好每個輸入一列、依輸入順序；不產生使用者未輸入的列（drop 幻覺）。
 * - 同 key 多筆結果以**最後一筆**為準。
 */
export function postProcessIntent(inputs: string[], parsed: RawIntentBatch): LabeledKeyword[] {
  // 建 normalizedText → cleaned labels 對照（後到覆蓋先到）。
  const byKey = new Map<string, IntentLabel[]>();
  for (const result of parsed.results) {
    byKey.set(normalizeText(result.keyword), cleanLabels(result.labels));
  }

  return inputs.map((keyword) => {
    const labels = byKey.get(normalizeText(keyword));
    return {
      keyword, // 保留使用者原字
      labels: labels && labels.length > 0 ? labels : [FALLBACK_LABEL],
    };
  });
}
