import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * 自訂分類**階段二**逐字歸類的**動態** strict `json_schema`（T12.8，FR-34 / AC-34.2 / TC-70）。
 *
 * 與 journey（FR-33）同構——每字恰一 `label`、single-label——但 enum 由**確認後標籤**動態建（每 run 不同），
 * 故**非** frozen 常數。structured-outputs 約束（Design §4.2）：所有欄位 required、每物件 `additionalProperties:false`、
 * root 非 anyOf、property 總數 ≤100、巢狀 ≤5、enum ≤500（標籤上限 `CUSTOM_CLASSIFY_MAX_LABELS` 預設 12 ⊂ 500）。
 * 本 schema property 數 = 3（results / keyword / label）、巢狀 3 層——安全。
 *
 * sentinel **`unclassified`（{@link UNCLASSIFIED_LABEL}）不入 enum**——模型永不主動輸出；只有後處理對「LLM 未涵蓋 /
 * 吐出非確認集」的關鍵字派此值（S11，避免退取第一標籤靜默污染真桶）。呼叫端須傳**去重後**的確認標籤。
 */

/** 缺漏 / 非確認集關鍵字的保留 sentinel（不入 LLM enum、後處理專用）。 */
export const UNCLASSIFIED_LABEL = 'unclassified';

/** 階段二逐字歸類結果（single-label）。 */
export interface CustomAssignResult {
  keyword: string;
  label: string;
}

/** batch 分類的形狀：`results: [{ keyword, label }]`。 */
export interface CustomAssignBatch {
  results: CustomAssignResult[];
}

/**
 * 依確認後標籤動態建 strict response_format（`label` = 這些標籤的 enum）。
 * @throws 當 `labels` 為空（無法建 enum；run-service 於此前以 409 擋）。
 */
export function buildCustomAssignResponseFormat(labels: string[]) {
  if (labels.length === 0) {
    throw new Error(
      'custom classification stage-2 requires at least one confirmed label to build the enum',
    );
  }
  const schema = z.object({
    results: z.array(
      z.object({
        keyword: z.string(),
        label: z.enum(labels as [string, ...string[]]),
      }),
    ),
  });
  return zodResponseFormat(schema, 'custom_classification_assignments');
}
