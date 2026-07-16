import type { ChatMessage } from '../intent/intent-labeler.port';
import { JOURNEY_STAGES } from './journey.schema';

/**
 * 購買歷程分類 prompt（Design §17.5，FR-33）。7 階段定義 + 規則（每字恰一 stage、results 數=輸入數）。
 * 規則由 prompt + 程式後處理（{@link postProcessJourney}）雙重保證——structured outputs schema 無法強制這些。
 */
const SYSTEM_PROMPT = `You classify search keywords by BUYER JOURNEY STAGE (single-label: EXACTLY ONE stage per keyword).

The buyer journey is a linear path from noticing a problem to buying and re-buying. Stage definitions:
- pain_awareness: the searcher is aware of a problem/symptom but not yet a solution category. e.g. "早上起床腰痛", "衣服油漬洗不掉".
- need_definition: naming a generic need/product category without a specific solution or comparison yet. This is the DEFAULT stage when the signal is unclear. e.g. "人體工學椅", "洗衣精 推薦".
- solution_exploration: exploring possible solution types / brands / options. e.g. "掃地機器人 有哪些牌子", "站立辦公桌 好用嗎".
- spec_comparison: comparing specific products/models/specs/prices side by side. e.g. "iphone 16 vs 15 pro", "dyson v12 v15 差別".
- reputation_validation: validating a chosen product via reviews / ratings / real-user feedback / complaints. e.g. "特斯拉 model y 缺點", "xx 診所 評價".
- final_decision: ready to buy — price check, where-to-buy, coupon, order, booking. e.g. "macbook air momo 價格", "nespresso 折扣碼".
- repurchase_retention: post-purchase — refill / accessory / renewal / support / loyalty. e.g. "咖啡機 濾網 更換", "netflix 續約".

Rules:
- Output one {keyword, stage} object per input keyword, in the same order.
- Each keyword gets EXACTLY ONE stage.
- The number of results MUST equal the number of input keywords.
- Use only these stages: ${JOURNEY_STAGES.join(', ')}.`;

/** 建構某批關鍵字的 chat 訊息（system 定義 + user JSON 陣列）。 */
export function buildJourneyMessages(keywords: string[]): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Classify the buyer journey stage of each keyword. Keywords: ${JSON.stringify(keywords)}`,
    },
  ];
}
