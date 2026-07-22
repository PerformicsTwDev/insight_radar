import type { JobStatus } from '@prisma/client';

/**
 * Dashboard feature 目錄（T6.8，FR-14 · AC-14.7）。每個 view 依賴一個 feature 的 compute；
 * `GET /keyword-analyses/:id` 回報各 feature 狀態，前端據此顯示「先執行 X」而非誤導空表。
 *
 * - `keyword_metrics`：既有 keyword-analysis pipeline（expand→metrics→intent→snapshot）。
 * - `serp`：SERP 抓取（FR-15，M7 落地）——目前尚未實作 compute。
 * - `topics`：意圖主題分群（FR-17/18，M8 落地）——目前尚未實作 compute。
 * - `journey`：購買歷程分類（FR-33，M12/T12.6）——狀態由 `JourneyRun` 推導（於 job slice 接線；此前 not_generated）。
 * - `ai_search`：AI Search 分析（FR-41 抓取 + FR-42/43 分析，M15）——AI view（`ai_answers`/`ai_cited_*`/
 *   `*_ai_visibility`(+`_summary`)）依賴之。**由該 analysis 最新 linked `AiSearchRun.status` 動態推導**
 *   （`aiSearchFeatureStatus`，owner-scoped，T15.8a/#678 G1）；view `build` 實讀 T15.5 落庫屬後續 slice（G2）。
 */
export const FEATURE_KEYS = ['keyword_metrics', 'serp', 'topics', 'journey', 'ai_search'] as const;
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
 * 由最新 `JourneyRun.status` 推導 `journey` feature 狀態（T12.6，AC-33.6）：completed/partial→`ready`
 * （有 assignments、view 可讀）；queued/running→`running`；failed→`failed`；無 run / canceled→`not_generated`。
 * 與 keyword_metrics「有物化結果即 ready」的判準一致。
 */
export function journeyFeatureStatus(runStatus: string | undefined): FeatureStatus {
  switch (runStatus) {
    case 'completed':
    case 'partial':
      return 'ready';
    case 'queued':
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    default:
      return 'not_generated'; // undefined（無 run）/ canceled
  }
}

/**
 * 由最新 linked `AiSearchRun.status` 推導 `ai_search` feature 狀態（T15.8a，#678 G1，AC-44.2/S25）：
 * completed/partial→`ready`（T15.5 已落 `ai_answers`/`ai_visibility_metrics`、資料已物化）；queued/running→`running`；
 * failed→`failed`；無 run / canceled→`not_generated`。鏡射 `journeyFeatureStatus`（「有物化結果即 ready」判準一致）。
 */
export function aiSearchFeatureStatus(runStatus: string | undefined): FeatureStatus {
  switch (runStatus) {
    case 'completed':
    case 'partial':
      return 'ready';
    case 'queued':
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    default:
      return 'not_generated'; // undefined（無 linked run）/ canceled
  }
}

/** computeFeatures 的可選外部狀態（由呼叫端查各 job/durable 資料帶入；省略→保守預設）。 */
export interface FeatureExtras {
  /** 最新 `JourneyRun.status`（AC-33.6）；省略 → journey 視為 `not_generated`（view 被 gate）。 */
  journeyStatus?: string;
  /** 最新 linked `AiSearchRun.status`（AC-44.2/S25）；省略 → ai_search 視為 `not_generated`。 */
  aiSearchStatus?: string;
}

/**
 * 聚合各 feature 對外狀態（AC-14.7 / AC-33.6 / AC-44.2）。`serp`/`topics` 之 compute 尚未接線（M7/M8）→ 一律
 * `not_generated`；`journey` 由 `extras.journeyStatus`（最新 JourneyRun）推導（T12.6）；`ai_search` 由
 * `extras.aiSearchStatus`（該 analysis 最新 linked `AiSearchRun`，owner-scoped）推導（T15.8a/#678 G1）。
 */
export function computeFeatures(
  analysis: AnalysisFeatureInput,
  extras: FeatureExtras = {},
): FeaturesMap {
  return {
    keyword_metrics: { status: keywordMetricsStatus(analysis) },
    serp: { status: 'not_generated' },
    topics: { status: 'not_generated' },
    journey: { status: journeyFeatureStatus(extras.journeyStatus) },
    ai_search: { status: aiSearchFeatureStatus(extras.aiSearchStatus) },
  };
}
