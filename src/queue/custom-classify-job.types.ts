/**
 * `custom-classify` queue 的 job payload（T12.8，FR-34）。producer（`POST /:id/custom-classify/:classificationId`）
 * 建 run 後 enqueue；processor 據此讀 snapshot 關鍵字、跑階段二 LLM 歸類 → 寫 assignments。
 */
export interface CustomClassifyJobPayload {
  runId: string;
  analysisId: string;
  classificationId: string;
  snapshotId: string;
  params: {
    schemaVersion: string;
    deployment: string;
    labelsHash: string;
  };
}

/** processor 回傳（BullMQ job return value）。 */
export interface CustomClassifyJobResult {
  status: string;
  keywordCount: number;
}
