/** 購買歷程 run 狀態（T12.6，FR-33/AC-33.6；沿用 async job 契約終態集）。 */
export type JourneyRunStatus =
  'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'canceled';

/** journey classify run 的參數（入 idempotency key + 持久化）；bump `schemaVersion` → 新 run。 */
export interface JourneyRunParams {
  schemaVersion: string;
  deployment: string;
}

/** 終態集（SSE 據此停止串流；completed/partial 有結果、failed/canceled 為失敗）。 */
export const TERMINAL_JOURNEY_STATUSES: ReadonlySet<JourneyRunStatus> = new Set<JourneyRunStatus>([
  'completed',
  'partial',
  'failed',
  'canceled',
]);

/** journey job 進度階段（SSE / GET 回報）。 */
export type JourneyPhase = 'loading' | 'classifying' | 'persisting' | 'done';

/** GET /:id/journey 回應投影（最新 run）。 */
export interface JourneyRunView {
  id: string;
  snapshotId: string;
  status: string;
  progress: unknown;
  keywordCount: number | null;
}
