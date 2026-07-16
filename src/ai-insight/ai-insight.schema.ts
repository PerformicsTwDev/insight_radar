import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

/**
 * per-view AI 洞察的固定 strict `json_schema`（FR-32 / TC-68；同 intent/topic 慣例 Design §4.2）。
 * structured-outputs 約束：所有欄位 required、`additionalProperties:false`、root 非 anyOf。
 * 單欄 `insight`（人類可讀的一段總結）——由後處理（service）對 refusal/malformed 做明確錯誤、不回半截（AC-32.4）。
 */
export const aiInsightSchema = z.object({
  insight: z.string(),
});

export type AiInsightPayload = z.infer<typeof aiInsightSchema>;

/** 固定重用的 structured-outputs response_format（避免每次重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = Object.freeze(zodResponseFormat(aiInsightSchema, 'ai_insight'));

/** 回傳固定的 AI 洞察 `json_schema` response format（strict）。 */
export function aiInsightResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
