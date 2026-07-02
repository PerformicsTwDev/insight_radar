import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

/**
 * 群命名的固定 strict `json_schema`（T8.7，FR-18 / TC-44；Design §16.3 name / §16.4 TopicCluster）。
 *
 * structured-outputs 約束（同 intent，Design §4.2）：所有欄位 required、`additionalProperties:false`、
 * root 非 anyOf、property 總數 ≤100、巢狀 ≤5、enum ≤500。property 數 = topics + 5 欄 = 6，巢狀 2 層——安全。
 */

/** 群層級單一主導意圖（4 值 enum）；與 FR-4 每字 multi-label 分表互補、**不覆寫**（Design §16.1 註）。 */
export const TOPIC_INTENT_LABELS = [
  'informational',
  'commercial',
  'transactional',
  'navigational',
] as const;

export type TopicIntentLabel = (typeof TOPIC_INTENT_LABELS)[number];

/** 批數群命名的 zod schema：`topics: [{ topic_name, parent_topic, intent_label, topic_type, reason }]`。 */
export const topicNamingBatchSchema = z.object({
  topics: z.array(
    z.object({
      topic_name: z.string(),
      parent_topic: z.string(),
      intent_label: z.enum(TOPIC_INTENT_LABELS),
      topic_type: z.string(),
      reason: z.string(),
    }),
  ),
});

export type TopicNamingBatch = z.infer<typeof topicNamingBatchSchema>;

/** 固定重用的 structured-outputs response_format（避免每批重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = Object.freeze(zodResponseFormat(topicNamingBatchSchema, 'topic_naming'));

/** 回傳固定的群命名 `json_schema` response format（strict）。 */
export function topicNamingResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
