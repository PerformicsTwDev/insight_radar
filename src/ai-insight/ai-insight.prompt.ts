import type { ChatMessage } from '../intent/intent-labeler.port';
import type { ViewResult } from '../keywords/views';

const SYSTEM_PROMPT = `You are an SEO keyword-research analyst. You are given the aggregated result of a single dashboard view (a table, trend, or chart) that has already had the user's filters applied. Write one concise, actionable insight summary (a few sentences, zh-TW) highlighting the key patterns, standouts, and what the analyst should notice in THIS filtered view.

Rules:
- Summarize ONLY the aggregated data provided; do not invent numbers or keywords not present.
- Missing metrics are null (not zero) — never treat null as 0 or claim a value dropped to zero.
- Keep it to a short paragraph; no markdown headings, no bullet lists unless truly clearer.
- Return the summary in the "insight" field.`;

/**
 * 建構某 view 聚合結果的 chat 訊息（system 定義 + user 帶 view 名與聚合 JSON）。輸入 = 該 view 經
 * `/query` 產出的**聚合結果**（AC-32.1；非原始全表）。聚合為第一方關鍵字資料（非第三方不可信內容），
 * 故不需 prompt-injection 隔離（S19 僅適用 Social/AI-answer 第三方文本）。
 */
export function buildAiInsightMessages(view: string, aggregate: ViewResult): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `View: ${view}\nAggregated result (JSON): ${JSON.stringify(aggregate)}`,
    },
  ];
}
