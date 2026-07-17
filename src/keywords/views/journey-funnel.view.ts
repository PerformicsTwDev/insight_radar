import { JOURNEY_STAGES } from '../../journey/journey.schema';
import { type AggregateGroup, type AggregateRow, aggregate } from '../aggregate';
import { applyFilter } from '../filter-spec';
import {
  type ChartViewResult,
  FILTER_KEYS,
  type ViewContext,
  type ViewDefinition,
} from './view-definition';

/**
 * journey_funnel（漏斗 chart，FR-33/AC-33.4）：`applyFilter` → `aggregate`（`value` 維度 on `stage` → 每階段一組、
 * `count` 出現次數 + `keywords` 去重列數）→ **重排為 `JOURNEY_STAGES` 固定 7 階段順序、缺階補 0**（漏斗語意；
 * chart 引擎無自訂 ordinal sort、且只產出現存 stage 的組）。bucket/group 上限沿用 chart 引擎 bounds。
 * 未分類列（`stage` 缺/非 7 階段）不落任一漏斗桶。`requiresFeature:'journey'`。
 */
export const journeyFunnelView: ViewDefinition = {
  name: 'journey_funnel',
  kind: 'chart',
  grain: 'journeyStage', // Design §17.1
  allowedSelect: [],
  allowedFilters: FILTER_KEYS,
  allowedSort: [],
  requiresFeature: 'journey',
  build(ctx: ViewContext): ChartViewResult {
    const filtered = applyFilter(ctx.rows, ctx.request.filters ?? {});
    const res = aggregate(
      filtered as unknown as AggregateRow[],
      {
        dimensions: [{ as: 'stage', field: 'stage', kind: 'value' }],
        measures: [
          { as: 'count', fn: 'count' },
          { as: 'keywords', fn: 'countDistinct' },
        ],
      },
      { maxBuckets: ctx.limits.aggMaxBuckets, maxGroups: ctx.limits.aggMaxGroups },
    );
    // 固定 7 階段順序、缺階補 0（引擎只產出現存 stage；非 7 階段的組—含未分類 null—自然被丟棄）。
    const byStage = new Map(res.groups.map((g) => [String(g.key.stage), g]));
    const groups: AggregateGroup[] = JOURNEY_STAGES.map(
      (stage) => byStage.get(stage) ?? { key: { stage }, measures: { count: 0, keywords: 0 } },
    );
    return { view: 'journey_funnel', groups, meta: res.meta };
  },
};
