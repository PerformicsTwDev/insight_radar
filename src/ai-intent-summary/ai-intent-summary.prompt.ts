import { buildIsolatedMessages } from '../ai-visibility/injection-isolation';
import type { ChatMessage } from '../intent/intent-labeler.port';
import type { SerpCapture } from './ai-intent-summary.types';

/**
 * per-keyword AI 意圖摘要 prompt（T12.1，FR-31/AC-31.6 / S19）。**grounding-first**：歸納一律以捕獲的
 * SERP 內容為據，不得臆造未出現在 SERP 的事實/品牌/引用。
 *
 * SERP（AI Overview blocks / 自然結果 / PAA / references）＝**第三方不可信內容** → 一律經
 * {@link buildIsolatedMessages} 隔離（指令/資料分離、明確邊界、偽造邊界中和），**絕不** `JSON.stringify` 拼進
 * 指令尾（S19）。第一方資訊（本案分析的關鍵字 `normalizedText`）放 system 指令；SERP 放 user 資料區。
 */
export const AI_INTENT_SUMMARY_SYSTEM_PROMPT = `你是一位資深 SEO 搜尋意圖分析師。你會拿到某個關鍵字經擷取的 Google 搜尋結果頁（SERP）內容（AI Overview 文字區塊、自然搜尋結果、People-Also-Ask，以及引用來源）。請據此寫一段結構完整的「AI 歸納搜尋意圖」長文摘要（zh-TW，數段），說明搜尋此關鍵字的使用者想解決什麼、背後的資訊需求與購買/研究階段，以及對應的內容策略建議。

規則：
- **grounding-first**：所有論述一律以提供的 SERP 內容為據；**不得**編造未出現在 SERP 的事實、品牌或引用來源。
- SERP 內容稀疏或不足時，據實說明「資訊有限」，不要為了湊字數而臆測。
- 缺少的引用來源為 []——絕不引用未出現在 SERP 的來源。
- 只輸出 summary 欄位（一段人類可讀的長文），不加 markdown 標題。`;

/**
 * 建構某關鍵字 SERP 的隔離 chat 訊息：system＝摘要規則 + 該關鍵字（第一方）；user＝邊界包夾的不可信 SERP。
 */
export function buildAiIntentSummaryMessages(nt: string, serpCapture: SerpCapture): ChatMessage[] {
  const instruction = `${AI_INTENT_SUMMARY_SYSTEM_PROMPT}\n\nKeyword (normalized): ${nt}`;
  return buildIsolatedMessages(instruction, {
    blocks: serpCapture.blocks,
    references: serpCapture.references ?? [],
  });
}
