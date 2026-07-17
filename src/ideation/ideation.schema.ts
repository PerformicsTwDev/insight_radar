import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

/**
 * AI 發想的固定 strict `json_schema`（T12.10，FR-35 / AC-35.1 / TC-71；同 intent/ai-insight 慣例 Design §4.2）。
 * structured-outputs 約束：所有欄位 required、`additionalProperties:false`、root 非 anyOf。**數量上限
 * （≤ `IDEATION_MAX_KEYWORDS`）與去重由後處理**（structured-outputs 不支援 `maxItems`）。
 */
export const ideationSchema = z.object({
  keywords: z.array(z.string()),
});

export type IdeationPayload = z.infer<typeof ideationSchema>;

/** 固定重用的 structured-outputs response_format（避免每次重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = Object.freeze(zodResponseFormat(ideationSchema, 'ai_ideation'));

/** 回傳固定的 AI 發想 `json_schema` response format（strict）。 */
export function ideationResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
