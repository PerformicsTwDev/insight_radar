import type { JourneyRunParams } from '../journey/journey-run.types';

/**
 * `journey` queue 的 job payload（T12.6，FR-33/AC-33.6）。producer（`POST /:id/journey`）建 JourneyRun 後 enqueue；
 * processor 據此讀 snapshot 關鍵字、跑 `JourneyService.classify` → 寫 `keyword_journey_assignments`。
 */
export interface JourneyJobPayload {
  runId: string;
  analysisId: string;
  snapshotId: string;
  params: JourneyRunParams;
}

/** processor 回傳（BullMQ job return value）。 */
export interface JourneyJobResult {
  status: 'completed' | 'partial';
  keywordCount: number;
}
