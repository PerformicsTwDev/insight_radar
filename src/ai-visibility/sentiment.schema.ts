import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * 品牌情緒輸出 schema（T15.1，FR-42/AC-42.2 / S17）——搬自 brand_intent_radar `aio-brand-sentiment-batch-analyzer`
 * 的 `[{ id, positive:0|1, negative:0|1 }]`（裸陣列）。**適配 Azure structured-outputs strict**（root 須為物件、非
 * 陣列）→ 包成 `{ results: [{ id, positive, negative }] }`（`results` 命名沿用共用 `resilientChunk` 骨架，T15.3）。
 *
 * **S17 業務規則（不可「修正」）**：褒貶**混合**時 `positive=1` **且** `negative=1`（各 +1，非二選一、非三分類）。
 * `positive`/`negative` 以 `z.literal([0,1])` 表達 → render 成 `{type:number, enum:[0,1]}`（enum-only、無 anyOf/const，
 * 符合 Azure strict；`z.number().min/max` 會生 structured-outputs 不支援的 minimum/maximum，故不用）。
 */
export const sentimentSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      positive: z.literal([0, 1]),
      negative: z.literal([0, 1]),
    }),
  ),
});

export type SentimentResult = z.infer<typeof sentimentSchema>;

/** 固定重用的 structured-outputs response_format。 */
const RESPONSE_FORMAT = Object.freeze(zodResponseFormat(sentimentSchema, 'brand_sentiment'));

/** 回傳固定的情緒 `json_schema` response format（strict）。 */
export function sentimentResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
