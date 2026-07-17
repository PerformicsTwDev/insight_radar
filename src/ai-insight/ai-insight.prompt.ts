import type { ChatMessage } from '../intent/intent-labeler.port';
import type { ViewResult } from '../keywords/views';

const SYSTEM_PROMPT = `You are an SEO keyword-research analyst. You are given the aggregated result of a single dashboard view (a table, trend, or chart) that has already had the user's filters applied. Write one concise, actionable insight summary (a few sentences, zh-TW) highlighting the key patterns, standouts, and what the analyst should notice in THIS filtered view.

Rules:
- Summarize ONLY the aggregated data provided; do not invent numbers or keywords not present.
- If a "Coverage" note says you are shown the top N of M rows, your summary MUST be based only on those N rows and MUST explicitly state it reflects the top N of M rows (by search volume), NOT the entire view. Never present a bounded sample as the full set.
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
      content: `View: ${view}\n${coverageNote(aggregate)}Aggregated result (JSON): ${JSON.stringify(aggregate)}`,
    },
  ];
}

/**
 * 誠實揭露有界樣本（M12-R2/AC-32.1）：table-grain view 的 `/query` 聚合是分頁列（top-N by volume），若 filters 後
 * 總列數 `pagination.total` > 示出列數 → 注入 coverage 句，令摘要聲明只反映 top-N/M（非全體）。全集/小表
 * （`total ≤ 示出列數`）與 chart-grain view（無 `pagination`/無截斷）→ 空字串、不加註記。
 */
function coverageNote(aggregate: ViewResult): string {
  const pagination = (aggregate as { pagination?: { total?: number } }).pagination;
  const rows = (aggregate as { rows?: unknown[] }).rows;
  if (
    pagination &&
    Array.isArray(rows) &&
    typeof pagination.total === 'number' &&
    pagination.total > rows.length
  ) {
    return (
      `Coverage: this table has ${pagination.total} rows after filters; you are shown only the top ${rows.length} ` +
      `by monthly search volume (avgMonthlySearches, desc). Base your summary on these and explicitly state it ` +
      `reflects the top ${rows.length} of ${pagination.total} rows by volume, not the entire view.\n`
    );
  }
  return '';
}
