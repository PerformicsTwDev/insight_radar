import { type AggregateRow, aggregate } from '../aggregate';
import { applyFilter } from '../filter-spec';
import {
  type ChartViewResult,
  FILTER_KEYS,
  type ViewContext,
  type ViewDefinition,
} from './view-definition';

/**
 * intent_distribution（pie/長條）：`applyFilter` → `aggregate`（explode `intent` → 每 label 一組；
 * `count` 為出現次數、`keywords` 為去重列數 `countDistinct(normalizedText)`，Design §9.3）。desc by count。
 */
export const intentDistributionView: ViewDefinition = {
  name: 'intent_distribution',
  kind: 'chart',
  grain: 'intentLabel', // Design §17.1
  allowedSelect: [],
  allowedFilters: FILTER_KEYS,
  allowedSort: [],
  build(ctx: ViewContext): ChartViewResult {
    const filtered = applyFilter(ctx.rows, ctx.request.filters ?? {});
    const res = aggregate(
      filtered as unknown as AggregateRow[],
      {
        dimensions: [{ as: 'intentLabel', field: 'intent', kind: 'explode' }],
        measures: [
          { as: 'count', fn: 'count' },
          { as: 'keywords', fn: 'countDistinct' },
        ],
        sort: { by: 'count', dir: 'desc' },
      },
      { maxBuckets: ctx.limits.aggMaxBuckets, maxGroups: ctx.limits.aggMaxGroups },
    );
    return { view: 'intent_distribution', groups: res.groups, meta: res.meta };
  },
};
