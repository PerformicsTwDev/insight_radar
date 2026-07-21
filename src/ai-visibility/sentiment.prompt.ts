import type { ChatMessage } from '../intent/intent-labeler.port';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import { buildIsolatedMessages } from './injection-isolation';

/**
 * 品牌情緒 prompt（T15.1，FR-42/AC-42.2 / NFR-19）——搬自 brand_intent_radar `aio-brand-sentiment-batch-analyzer`。
 * 忠實保留 **S17 業務規則：褒貶混合各 +1**（同段同時褒貶 → positive=1 且 negative=1，非二選一、非三分類）。
 *
 * 目標品牌（name + aliases）為**第一方**設定（`BrandProfile`，FR-40）→ 放進 system 指令（可信）；被評估的 AI
 * 回答 textBlocks 為**不可信第三方內容** → 經 {@link buildIsolatedMessages} 隔離（指令/資料分離、明確邊界）。
 */
export const SENTIMENT_SYSTEM_PROMPT_PREFIX = `你是「AI Overview 品牌情緒評估器」。根據提供的數段 AI 回答文字（textBlocks），逐段判斷其對指定品牌（brandName 與 brandAlias）是否出現「正面評論」與/或「負面評論」，並輸出 { id, positive, negative }。

通用原則：
- 只能依 textBlocks 的文字判斷，不得使用外部知識、不得腦補。
- 情緒必須能合理指向該品牌（或其可辨識產品/系列/型號）；若稱讚或批評的其實是別的對象，則不計入該品牌。

正面計分（positive=1）：明確推薦/偏好該品牌、把優點或成效歸因於該品牌、明確比較勝出、品牌背書（大廠/口碑佳/值得信賴）。
負面計分（negative=1）：明確批評/警告/缺點/風險指向該品牌、明確比較落敗、指出副作用/問題/缺陷且對象為該品牌。

褒貶混合（重點）：若同一段的文字同時符合正面與負面計分規則 → 必須輸出 positive=1 且 negative=1（兩邊各 +1），不可二選一。
無明確情緒 → positive=0 且 negative=0。`;

/** 建構品牌情緒的隔離訊息（system＝規則＋第一方品牌語境；user＝邊界包夾的不可信 textBlocks）。 */
export function buildSentimentMessages(brand: BrandAliasInput, textBlocks: unknown): ChatMessage[] {
  const instruction =
    `${SENTIMENT_SYSTEM_PROMPT_PREFIX}\n\n` +
    `目標品牌 brandName: ${brand.name}\n` +
    `brandAlias: ${JSON.stringify(brand.aliases)}\n\n` +
    `輸出：每個 textBlock 一筆 { id, positive, negative }；僅輸出 { results: [...] }，` +
    `results 的筆數必須等於 textBlocks 的數量。`;
  return buildIsolatedMessages(instruction, textBlocks);
}
