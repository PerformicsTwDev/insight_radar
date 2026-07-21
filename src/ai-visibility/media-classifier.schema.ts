import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * 引用媒體分類輸出 schema（T15.1，FR-42/AC-42.3）——搬自 brand_intent_radar `url-media-classifier` 的
 * `{ references: [{ id, type }] }`（原形即物件、直接沿用）。domain → 9 類媒體 enum。
 * structured-outputs 約束同 intent（Design §4.2）：所有欄位 required、`additionalProperties:false`、root 非 anyOf、
 * enum 值 ≤ 500（此處 9）。
 */

/** 允許的媒體類別 enum（9 類；順序＝來源 prompt 定義序）。 */
export const MEDIA_TYPES = [
  'ecommerce',
  'retail',
  'review',
  'news',
  'content',
  'blog',
  'social',
  'gov',
  'other',
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export const mediaClassifierSchema = z.object({
  references: z.array(
    z.object({
      id: z.string(),
      type: z.enum(MEDIA_TYPES),
    }),
  ),
});

export type MediaClassifierResult = z.infer<typeof mediaClassifierSchema>;

/** 固定重用的 structured-outputs response_format。 */
const RESPONSE_FORMAT = Object.freeze(
  zodResponseFormat(mediaClassifierSchema, 'media_classification'),
);

/** 回傳固定的媒體分類 `json_schema` response format（strict）。 */
export function mediaClassifierResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
