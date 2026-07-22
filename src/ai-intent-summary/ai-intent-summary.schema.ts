import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

/**
 * per-keyword AI 意圖摘要的固定 strict `json_schema`（FR-31 / TC-67；同 intent/insight 慣例 Design §4.2）。
 * structured-outputs 約束：所有欄位 required、`additionalProperties:false`、root 非 anyOf。
 * 單欄 `summary`（long-form 意圖摘要）——refusal/malformed/空由後處理（service）判定 → `summary=null`（AC-31.4）。
 */
export const aiIntentSummarySchema = z.object({
  summary: z.string(),
});

export type AiIntentSummaryPayload = z.infer<typeof aiIntentSummarySchema>;

/** 固定重用的 structured-outputs response_format（避免每次重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = Object.freeze(
  zodResponseFormat(aiIntentSummarySchema, 'ai_intent_summary'),
);

/** 回傳固定的意圖摘要 `json_schema` response format（strict）。 */
export function aiIntentSummaryResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
