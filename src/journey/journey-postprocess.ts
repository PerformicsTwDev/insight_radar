import type { JourneyStage } from './journey.schema';

/**
 * 後處理的暫態 DTO（非 canonical 實體）。下游 service / repository 才組裝成 snapshot-scoped assignment。
 * 用 `keyword`/`stage` 對齊 LLM 回應與 TC-69 語意（single-label：每字恰一 stage）。
 */
export interface StagedKeyword {
  keyword: string;
  stage: JourneyStage;
}

/**
 * 後處理的輸入形狀——**刻意寬鬆**：此函式是驗證邊界，`stage` 視為未驗證字串
 * （strict schema 只在「非 refusal/非截斷」時保證，LLM 仍可能回非法值），故在此清洗。
 */
export interface RawJourneyBatch {
  results: Array<{ keyword: string; stage: string }>;
}

/**
 * 清洗單一 stage：合法（在 `JOURNEY_STAGES` 內）→ 原值；否則 → `null`。**驗證邊界單點**：後處理（TC-69）
 * 與 journey 快取回寫共用此函式，確保「raw LLM stage 視為不可信」在兩條路徑上一致清洗（不污染下游）。
 */
export function cleanStage(_stage: string): JourneyStage | null {
  throw new Error('not implemented');
}

/**
 * 購買歷程分類後處理（FR-33 / AC-33.2，TC-69）。純函式：把 LLM 結果對回**每個**原始輸入。
 *
 * - 以 `normalizedText` 對回輸入（與快取/去重共用同一 key，跨大小寫/空白）。
 * - single-label：每字恰一 stage；非法/缺漏 → 補 fallback `need_definition`（保證每輸入恰一列）。
 * - 輸出恰好每個輸入一列、依輸入順序；不產生使用者未輸入的列（drop 幻覺）。
 * - 同 key 多筆結果以**最後一筆**為準（含最後一筆非法時 → fallback）。
 */
export function postProcessJourney(_inputs: string[], _parsed: RawJourneyBatch): StagedKeyword[] {
  throw new Error('not implemented');
}
