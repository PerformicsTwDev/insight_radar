import { type AggregateRow, aggregate } from '../aggregate';
import { applyFilter } from '../filter-spec';
import {
  type ChartViewResult,
  FILTER_KEYS,
  type ViewContext,
  type ViewDefinition,
} from './view-definition';

/** CPC 直方圖桶寬（左閉右開；`cpcLow` 落桶，Design §9.3）。 */
const CPC_BUCKET_WIDTH = 1;

/**
 * cpc_histogram（直方圖）：`applyFilter` → `aggregate`（`cpcLow` 左閉右開分桶、width=1、`null` 略過，
 * Design §9.3）。asc by 桶下界；桶數 > maxBuckets → 400（AggregateBoundsError）。
 */
export const cpcHistogramView: ViewDefinition = {
  name: 'cpc_histogram',
  kind: 'chart',
  allowedSelect: [],
  allowedFilters: FILTER_KEYS,
  allowedSort: [],
  build(ctx: ViewContext): ChartViewResult {
    const filtered = applyFilter(ctx.rows, ctx.request.filters ?? {});
    const res = aggregate(
      filtered as unknown as AggregateRow[],
      {
        dimensions: [{ as: 'bucket', field: 'cpcLow', kind: 'bucket', width: CPC_BUCKET_WIDTH }],
        measures: [{ as: 'count', fn: 'count' }],
        sort: { by: 'bucket', dir: 'asc' },
      },
      { maxBuckets: ctx.limits.aggMaxBuckets, maxGroups: ctx.limits.aggMaxGroups },
    );
    return { view: 'cpc_histogram', groups: res.groups, meta: res.meta };
  },
};
