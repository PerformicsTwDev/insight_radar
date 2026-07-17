/** 自訂分類階段二 run 狀態（T12.8，FR-34/AC-34.2；沿用 async job 契約終態集）。LLM 失敗降級為
 * `unclassified`（非 run-level partial），故只 completed / failed（無 partial / canceled）。 */
export type CustomClassifyRunStatus = 'queued' | 'running' | 'completed' | 'failed';

/** 階段二 classify run 的參數（入 idempotency key + 持久化）；bump `schemaVersion` 或改確認標籤（`labelsHash`）→ 新 run。 */
export interface CustomClassifyRunParams {
  schemaVersion: string;
  deployment: string;
  /** 確認標籤集的 canonical hash（reorder-invariant）——改標籤 → 新 run（HITL 正確重跑）。 */
  labelsHash: string;
}

/** 終態集（SSE 據此停止串流；completed 有結果、failed 為失敗）。 */
export const TERMINAL_CUSTOM_CLASSIFY_STATUSES: ReadonlySet<CustomClassifyRunStatus> =
  new Set<CustomClassifyRunStatus>(['completed', 'failed']);

/** 階段二 job 進度階段（SSE / GET 回報）。 */
export type CustomClassifyPhase = 'loading' | 'classifying' | 'persisting' | 'done';

/** GET .../assignments 回應投影（最新 run）。 */
export interface CustomClassifyRunView {
  id: string;
  classificationId: string;
  status: string;
  progress: unknown;
  keywordCount: number | null;
}
