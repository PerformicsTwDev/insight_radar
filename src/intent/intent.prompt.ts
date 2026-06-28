import type { ChatMessage } from './intent-labeler.port';
import { INTENT_LABELS } from './intent.schema';

/**
 * Intent 貼標 prompt（Design §4.2）。四意圖定義 + 規則（每字 ≥1 label、去重、results 數=輸入數）。
 * 規則由 prompt + 程式後處理（T2.4）保證——structured outputs schema 無法強制這些。
 */
const SYSTEM_PROMPT = `You classify search keywords by SEARCH INTENT (multi-label: one or more labels per keyword).

Intent definitions:
- informational: wants to learn / understand / find information, with no clear purchase, transaction, or brand-navigation signal. This is the DEFAULT label when no other signal is present. e.g. "咖啡因 副作用", "拿鐵 熱量", "how to brew coffee".
- commercial: pre-purchase research / comparison / reviews / recommendations (not yet a direct transaction). e.g. "best espresso machine", "掃地機器人 推薦", "iphone 16 比較".
- transactional: a direct action — buy / download / order / book / coupon / price check. e.g. "buy nespresso pods", "macbook air 價格", "ubereats 折扣碼".
- navigational: looking for a specific brand / website / page / login / support. e.g. "facebook login", "台新銀行 官網", "youtube".

Rules:
- Output one {keyword, labels} object per input keyword, in the same order.
- Each keyword gets AT LEAST ONE label; labels must be de-duplicated.
- The number of results MUST equal the number of input keywords.
- Use only these labels: ${INTENT_LABELS.join(', ')}.`;

/** 建構某批關鍵字的 chat 訊息（system 定義 + user JSON 陣列）。 */
export function buildIntentMessages(keywords: string[]): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Classify the search intent of each keyword. Keywords: ${JSON.stringify(keywords)}`,
    },
  ];
}
