import type { SnapshotRowData } from '../../keyword-analysis/result-snapshot.checksum';
import { applyFilter } from '../filter-spec';
import { SORT_FIELDS, type SortField, selectPage } from '../paginate';
import {
  type ColumnDef,
  FILTER_KEYS,
  type TableViewResult,
  type ViewContext,
  type ViewDefinition,
} from './view-definition';

/** journey table view 的可選欄位 + 欄位中繼資料（`stage` 由 load path 以 normalizedText left-join 帶入）。 */
const COLUMNS: Record<string, ColumnDef> = {
  text: { key: 'text', label: '關鍵字', type: 'text' },
  normalizedText: { key: 'normalizedText', label: '正規化文字', type: 'text' },
  stage: { key: 'stage', label: '購買歷程階段', type: 'text' },
  avgMonthlySearches: { key: 'avgMonthlySearches', label: '月均搜量', type: 'number' },
};
const ALLOWED_SELECT = Object.keys(COLUMNS);

/** 取列上被選欄位（select 已由 service 驗證 ⊆ allowedSelect）。 */
function pick(row: SnapshotRowData, keys: string[]): Record<string, unknown> {
  const rec = row as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, rec[key]]));
}

/**
 * journey（每關鍵字一列 + `stage`，FR-33/AC-33.4）：`applyFilter` → `selectPage`（keyset 分頁）→ 投影所選欄位。
 * 與 keywords view 同一 filter/分頁；`stage` 由 SnapshotQueryService 的 journey load path 以 normalizedText
 * left-join 自 `keyword_journey_assignments` 帶入（未分類字 → stage 缺）。`requiresFeature:'journey'` 由 gate 把關。
 */
export const journeyView: ViewDefinition = {
  name: 'journey',
  kind: 'table',
  grain: 'keyword', // Design §17.1
  allowedSelect: ALLOWED_SELECT,
  selectColumns: Object.values(COLUMNS),
  allowedFilters: FILTER_KEYS,
  allowedSort: SORT_FIELDS,
  requiresFeature: 'journey',
  build(ctx: ViewContext): TableViewResult {
    const filtered = applyFilter(ctx.rows, ctx.request.filters ?? {});
    const sort0 = ctx.request.sort?.[0];
    const page = selectPage(
      filtered,
      sort0 ? { sortBy: sort0.field as SortField, sortDir: sort0.direction } : {},
      ctx.request.pagination ?? {},
    );
    const select =
      ctx.request.select && ctx.request.select.length > 0 ? ctx.request.select : ALLOWED_SELECT;
    return {
      view: 'journey',
      columns: select.map((key) => COLUMNS[key]), // select 已由 service 驗證 ⊆ allowedSelect
      rows: page.rows.map((row) => pick(row, select)),
      pagination: page.meta,
    };
  },
};
