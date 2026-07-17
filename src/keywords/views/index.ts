import { cpcHistogramView } from './cpc-histogram.view';
import { intentDistributionView } from './intent-distribution.view';
import { journeyFunnelView } from './journey-funnel.view';
import { journeyView } from './journey.view';
import { keywordsView } from './keywords.view';
import { intentTopicsView, serpQuestionsView } from './placeholder-view';
import { trendView } from './trend.view';
import { ViewRegistry } from './view-registry';
import type { ViewDefinition } from './view-definition';

export * from './view-definition';
export { ViewRegistry } from './view-registry';
export { keywordsView } from './keywords.view';
export { trendView } from './trend.view';
export { intentDistributionView } from './intent-distribution.view';
export { cpcHistogramView } from './cpc-histogram.view';
export { serpQuestionsView, intentTopicsView } from './placeholder-view';
export { journeyView } from './journey.view';
export { journeyFunnelView } from './journey-funnel.view';
// 動態 view 工廠（`custom:{cid}`，T12.9）：**不**入 BUILTIN_VIEWS（per-cid、由 SnapshotQueryService 動態解析）。
export { customView } from './custom.view';

/**
 * 本期內建 view（新增 dashboard 表 = 在此多加一個 ViewDefinition，免新 endpoint / 免 migration）。
 * `serp_questions`（M7 SERP）/`intent_topics`（M8 分群）已註冊但其 compute 尚未實作 → 由 feature-gating 擋（AC-14.7）。
 */
export const BUILTIN_VIEWS: ViewDefinition[] = [
  keywordsView,
  trendView,
  intentDistributionView,
  cpcHistogramView,
  serpQuestionsView,
  intentTopicsView,
  journeyView,
  journeyFunnelView,
];

/** 建立含所有內建 view 的登錄（供 QueryViewService / DI）。 */
export function createViewRegistry(): ViewRegistry {
  return new ViewRegistry(BUILTIN_VIEWS);
}
