import type { JobStatus } from '@prisma/client';

/**
 * Dashboard feature 目錄（T6.8，FR-14 · AC-14.7）。每個 view 依賴一個 feature 的 compute；
 * `GET /keyword-analyses/:id` 回報各 feature 狀態，前端據此顯示「先執行 X」而非誤導空表。
 *
 * - `keyword_metrics`：既有 keyword-analysis pipeline（expand→metrics→intent→snapshot）。
 * - `serp`：SERP 抓取（FR-15，M7 落地）——目前尚未實作 compute。
 * - `topics`：意圖主題分群（FR-17/18，M8 落地）——目前尚未實作 compute。
 */
export const FEATURE_KEYS = ['keyword_metrics', 'serp', 'topics'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_STATUSES = ['not_generated', 'running', 'ready', 'failed'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export type FeaturesMap = Record<FeatureKey, { status: FeatureStatus }>;

/** 分析行的最小投影（feature 狀態推導所需）。 */
export interface AnalysisFeatureInput {
  status: JobStatus;
  resultSnapshotId: string | null;
}

/**
 * 由分析狀態推導 `keyword_metrics` feature 狀態：**有不可變 snapshot（`resultSnapshotId`）→ `ready`**
 * （completed 或已持久化 partial，讀取層可讀）；否則依 job 狀態——`failed`→`failed`、`canceled`→`not_generated`、
 * 其餘（queued/running/未持久化 partial）→ `running`。與 T6.3 讀取層 readiness 判準（snapshot 存在性）一致。
 */
function keywordMetricsStatus(analysis: AnalysisFeatureInput): FeatureStatus {
  if (analysis.resultSnapshotId) {
    return 'ready';
  }
  switch (analysis.status) {
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'not_generated';
    default:
      return 'running';
  }
}

/**
 * 聚合各 feature 對外狀態（AC-14.7）。`serp`/`topics` 之 compute 尚未實作（M7/M8）→ 一律 `not_generated`；
 * 待對應 milestone 落地時，改由各自 job/durable 資料推導。 */
export function computeFeatures(analysis: AnalysisFeatureInput): FeaturesMap {
  return {
    keyword_metrics: { status: keywordMetricsStatus(analysis) },
    serp: { status: 'not_generated' },
    topics: { status: 'not_generated' },
  };
}
