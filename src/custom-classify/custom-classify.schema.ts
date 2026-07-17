import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * 自訂分類**階段一**標籤生成的固定 strict `json_schema`（T12.7，FR-34/AC-34.1，TC-70 部分）。
 *
 * structured-outputs 約束（Design §4.2）：所有欄位 required、每物件 `additionalProperties:false`、root 非 anyOf、
 * property 總數 ≤100、巢狀 ≤5。本 schema property 數 = 3（labels / label / description），巢狀 3 層——安全。
 * **數量上限（≤ `CUSTOM_CLASSIFY_MAX_LABELS`）由後處理截斷**（structured-outputs 不支援 `maxItems`）。
 */
export const customLabelSchema = z.object({
  labels: z.array(
    z.object({
      label: z.string(),
      description: z.string(),
    }),
  ),
});

export type CustomLabel = z.infer<typeof customLabelSchema>['labels'][number];
export type CustomLabelSet = z.infer<typeof customLabelSchema>;

/** 固定重用的 structured-outputs response_format（避免每次重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = Object.freeze(
  zodResponseFormat(customLabelSchema, 'custom_classification_labels'),
);

/** 回傳固定的自訂分類標籤 `json_schema` response format（strict）。 */
export function customLabelResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
