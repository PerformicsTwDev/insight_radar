import type { TopicRunParams } from './topic-run.types';

/**
 * `topics` queue 的 job payload（T8.9）。producer（T8.10 POST /topics）建 TopicRun 後 enqueue；
 * processor 據此讀 snapshot、跑分群。geo/language 為該分析的統一維度（embedding repository 複合鍵 + SERP 查詢）。
 */
export interface TopicJobPayload {
  runId: string;
  analysisId: string;
  snapshotId: string;
  geo: string;
  language: string;
  params: TopicRunParams;
}

/** processor 回傳（BullMQ job return value）。 */
export interface TopicJobResult {
  status: 'completed' | 'partial';
  clusterCount: number;
  noiseCount: number;
}
