import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * Intent multi-label 的固定 strict `json_schema`（T2.2，FR-4 / TC-15）。
 *
 * structured-outputs 約束（Design §4.2）：所有欄位 required、每物件 `additionalProperties:false`、
 * root 非 anyOf、整份 schema property 總數 ≤100、巢狀 ≤5、enum 值 ≤500。本 schema property 數 = 3
 * （results / keyword / labels），巢狀 3 層——安全。**勿在 item 內任意加欄位**（會累加進總額）。
 */

/** 四種搜尋意圖 label（multi-label）。 */
export const INTENT_LABELS = [
  'informational',
  'commercial',
  'transactional',
  'navigational',
] as const;

export type IntentLabel = (typeof INTENT_LABELS)[number];

/** schema 版本——bump 即整批 intent 快取失效（快取 namespace 用）。 */
export const INTENT_SCHEMA_VERSION = 'v1';

/** batch 貼標的 zod schema：`results: [{ keyword, labels[] }]`。 */
export const intentBatchSchema = z.object({
  results: z.array(
    z.object({
      keyword: z.string(),
      labels: z.array(z.enum(INTENT_LABELS)),
    }),
  ),
});

export type IntentBatch = z.infer<typeof intentBatchSchema>;

/** 固定重用的 structured-outputs response_format（避免每批重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = zodResponseFormat(intentBatchSchema, 'intent_labeling');

/** 回傳固定的 intent `json_schema` response format（strict）。 */
export function intentResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
