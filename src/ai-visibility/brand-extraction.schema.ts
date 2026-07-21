import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * 品牌抽取輸出 schema（T15.1，FR-42/AC-42.1 / S17）——搬自 brand_intent_radar `extract-brands-from-text-blocks`
 * 的 `{ [blockId]: string[] }`（record）。**適配 Azure structured-outputs strict**（動態 key record 會生
 * `additionalProperties`/`propertyNames`——strict 不支援）→ 改為 **array 形** `{ results: [{ id, brands[] }] }`，
 * 語意等價、且 `results` 命名可直接沿用共用 `resilientChunk`（`{results:[…]}`）批次骨架（T15.2）。
 *
 * **S17 業務規則（不可「修正」）**：`brands` 陣列**刻意不去重**＝品牌露出次數（同品牌多次出現即多筆）。
 * structured-outputs 約束同 intent（Design §4.2）：所有欄位 required、`additionalProperties:false`、root 非 anyOf、
 * enum-only。
 */
export const brandExtractionSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      brands: z.array(z.string()),
    }),
  ),
});

export type BrandExtractionResult = z.infer<typeof brandExtractionSchema>;

/** 固定重用的 structured-outputs response_format（避免每批重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = Object.freeze(zodResponseFormat(brandExtractionSchema, 'brand_extraction'));

/** 回傳固定的品牌抽取 `json_schema` response format（strict）。 */
export function brandExtractionResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
