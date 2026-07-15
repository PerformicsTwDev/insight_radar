import type { ReactElement } from 'react';

/**
 * 分析歷史 view (T3.5, FR-10; TC-21). Lists past analyses (`GET /keyword-analyses`,
 * createdAt desc) with a status filter (restricted to the valid enum) + offset
 * pagination (FR-7 semantics), and reopens a row's analysis by navigating to the
 * dashboard with its `analysisId` (URL restore, FR-1). Empty list → empty state.
 */
export function HistoryView(): ReactElement {
  return <div>history-view-todo</div>; // red stub — implemented in the green commit
}
