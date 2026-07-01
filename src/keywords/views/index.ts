import { cpcHistogramView } from './cpc-histogram.view';
import { intentDistributionView } from './intent-distribution.view';
import { keywordsView } from './keywords.view';
import { trendView } from './trend.view';
import { ViewRegistry } from './view-registry';
import type { ViewDefinition } from './view-definition';

export * from './view-definition';
export { ViewRegistry } from './view-registry';
export { keywordsView } from './keywords.view';
export { trendView } from './trend.view';
export { intentDistributionView } from './intent-distribution.view';
export { cpcHistogramView } from './cpc-histogram.view';

/** 本期內建 view（新增 dashboard 表 = 在此多加一個 ViewDefinition，免新 endpoint / 免 migration）。 */
export const BUILTIN_VIEWS: ViewDefinition[] = [
  keywordsView,
  trendView,
  intentDistributionView,
  cpcHistogramView,
];

/** 建立含所有內建 view 的登錄（供 QueryViewService / DI）。 */
export function createViewRegistry(): ViewRegistry {
  return new ViewRegistry(BUILTIN_VIEWS);
}
