import { buildTrend } from '../build-trend';
import { applyFilter } from '../filter-spec';
import {
  FILTER_KEYS,
  type TrendViewResult,
  type ViewContext,
  type ViewDefinition,
} from './view-definition';

/** trend view 的 top-N 個別 series 數（Design §9.2 預設 10）。 */
const TREND_TOP_N = 10;

/**
 * trend（月度趨勢）：`applyFilter` → `buildTrend`（union 月軸 + 加總 series[null 不計、缺月補 0] +
 * top-N 個別 series[缺月/null 補 null]，Design §9.2）。無 select/sort（月軸序固定）。
 */
export const trendView: ViewDefinition = {
  name: 'trend',
  allowedSelect: [],
  allowedFilters: FILTER_KEYS,
  allowedSort: [],
  build(ctx: ViewContext): TrendViewResult {
    const filtered = applyFilter(ctx.rows, ctx.request.filters ?? {});
    const trend = buildTrend(filtered, TREND_TOP_N);
    return { view: 'trend', axis: trend.axis, total: trend.total, series: trend.series };
  },
};
