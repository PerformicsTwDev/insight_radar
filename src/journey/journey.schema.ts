import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * 購買歷程分類 single-label 的固定 strict `json_schema`（T12.5，FR-33 / AC-33.1 / TC-69）。
 *
 * 類比 intent（FR-4）但**單標籤**：每字恰一 `stage`（7 值 enum）。structured-outputs 約束（Design §4.2）：
 * 所有欄位 required、每物件 `additionalProperties:false`、root 非 anyOf、property 總數 ≤100、巢狀 ≤5、enum ≤500。
 * 本 schema property 數 = 3（results / keyword / stage），巢狀 3 層、enum 7 值——安全。**勿在 item 內任意加欄位**。
 */

/** 購買歷程 7 階段（線性購買旅程；順序＝漏斗由淺到深）。 */
export const JOURNEY_STAGES = [
  'pain_awareness',
  'need_definition',
  'solution_exploration',
  'spec_comparison',
  'reputation_validation',
  'final_decision',
  'repurchase_retention',
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

// journey 快取 namespace 版本已移至 config（env `JOURNEY_SCHEMA_VERSION`，預設 v1）——bump 整批失效（AC-33.3）。

/** batch 分類的 zod schema：`results: [{ keyword, stage }]`（single-label）。 */
export const journeyBatchSchema = z.object({
  results: z.array(
    z.object({
      keyword: z.string(),
      stage: z.enum(JOURNEY_STAGES),
    }),
  ),
});

export type JourneyBatch = z.infer<typeof journeyBatchSchema>;

/** 固定重用的 structured-outputs response_format（避免每批重建 schema 的預處理延遲）。 */
const RESPONSE_FORMAT = Object.freeze(
  zodResponseFormat(journeyBatchSchema, 'journey_classification'),
);

/** 回傳固定的 journey `json_schema` response format（strict）。 */
export function journeyResponseFormat(): typeof RESPONSE_FORMAT {
  return RESPONSE_FORMAT;
}
