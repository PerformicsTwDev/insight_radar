/**
 * TopicRun 狀態機 + 分群 job 參數/階段型別（T8.9，Design §16.3/§16.4）。
 */

/** 分群 job 狀態（對應 keyword-analysis 的角色，獨立實體）。 */
export type TopicRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial' // 任一外部階段達重試上限/降級 → 保留已完成階段（NFR-12）
  | 'failed'
  | 'canceled';

/** 終態集合（進入後不再流轉；processor markStatus 據此守 idempotent finalize）。 */
export const TERMINAL_TOPIC_STATUSES: ReadonlySet<TopicRunStatus> = new Set<TopicRunStatus>([
  'completed',
  'partial',
  'failed',
  'canceled',
]);

/** 分群 job 階段（progress.phase + `load→serp→embed→cluster→represent→name→persist`，Design §16.3）。 */
export const TOPIC_PHASES = [
  'load',
  'serp',
  'embed',
  'cluster',
  'represent',
  'name',
  'persist',
] as const;

export type TopicPhase = (typeof TOPIC_PHASES)[number];

/** job 進度（SSE / GET 回報）。 */
export interface TopicProgress {
  phase: TopicPhase;
  percent: number;
  total?: number;
}

/**
 * 分群 job 參數（進 `TopicRun.params` + idempotency hash）：embedding + UMAP/HDBSCAN + serpEnabled +
 * prompt/schema 版本（版本變更 → 不同 key → 允許重跑）。
 */
export interface TopicRunParams {
  serpEnabled: boolean;
  embeddingModel: string;
  embeddingSchemaVersion: string;
  promptVersion: string;
  schemaVersion: string;
  umap?: Record<string, unknown>;
  hdbscan?: Record<string, unknown>;
  topK?: number;
}
