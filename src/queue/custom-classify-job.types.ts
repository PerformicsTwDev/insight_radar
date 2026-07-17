/**
 * `custom-classify` queue 的 job payload（T12.8，FR-34）。producer（`POST /:id/custom-classifications/:cid/assignments`）
 * 建 run 後 enqueue；processor 據此讀 snapshot 關鍵字、跑階段二 LLM 歸類 → 寫 assignments。
 *
 * `labels`＝**此 run 建立當下**的確認標籤快照（含 description，對齊 `params.labelsHash`）；processor 以此歸類、
 * **不**於 process time 重讀 `custom_classifications.labels`——避免同 cid 快速連續 HITL 改動時舊 run 以新標籤歸類
 * （run 與其 labelsHash 一致，reviewer #490）。
 */
export interface CustomClassifyJobPayload {
  runId: string;
  analysisId: string;
  classificationId: string;
  snapshotId: string;
  labels: { label: string; description: string }[];
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
