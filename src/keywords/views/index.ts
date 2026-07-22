import { AI_SEARCH_VIEWS } from './ai-search-views';
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
export { AI_SEARCH_VIEWS, AI_SEARCH_VIEW_NAMES, AI_VIEW_SOURCE } from './ai-search-views';
// 動態 view 工廠（`custom:{cid}`，T12.9）：**不**入 BUILTIN_VIEWS（per-cid、由 SnapshotQueryService 動態解析）。
export { customView } from './custom.view';

/**
 * 本期內建 view（新增 dashboard 表 = 在此多加一個 ViewDefinition，免新 endpoint / 免 migration）。
 * `serp_questions`（M7 SERP）/`intent_topics`（M8 分群）/AI Search views（M15，`ai_search` feature）已註冊但其
 * compute 尚未接線 → 由 feature-gating 擋（AC-14.7；AI views 之維度組裝/落庫讀取＝後續 slice #678）。
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
  ...AI_SEARCH_VIEWS,
];

/** 建立含所有內建 view 的登錄（供 QueryViewService / DI）。 */
export function createViewRegistry(): ViewRegistry {
  return new ViewRegistry(BUILTIN_VIEWS);
}
