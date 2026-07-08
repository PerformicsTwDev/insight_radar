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

/** keywords table view 的可選欄位 + 欄位中繼資料。 */
const COLUMNS: Record<string, ColumnDef> = {
  text: { key: 'text', label: '關鍵字', type: 'text' },
  normalizedText: { key: 'normalizedText', label: '正規化文字', type: 'text' },
  avgMonthlySearches: { key: 'avgMonthlySearches', label: '月均搜量', type: 'number' },
  competition: { key: 'competition', label: '競爭度', type: 'text' },
  competitionIndex: { key: 'competitionIndex', label: '競爭指數', type: 'number' },
  cpcLow: { key: 'cpcLow', label: 'CPC 低', type: 'number' },
  cpcHigh: { key: 'cpcHigh', label: 'CPC 高', type: 'number' },
  intent: { key: 'intent', label: '意圖標籤', type: 'array' },
  monthlyVolumes: { key: 'monthlyVolumes', label: '逐月搜量', type: 'array' },
};
const ALLOWED_SELECT = Object.keys(COLUMNS);

/** 取列上被選欄位（select 已由 service 驗證 ⊆ allowedSelect）。 */
function pick(row: SnapshotRowData, keys: string[]): Record<string, unknown> {
  const rec = row as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, rec[key]]));
}

/**
 * keywords（每關鍵字一列）：`applyFilter` → `selectPage`（keyset 分頁）→ 投影所選欄位。
 * 亦可走 `GET /keywords`（同一 predicate/分頁，Design §6.5）。
 */
export const keywordsView: ViewDefinition = {
  name: 'keywords',
  kind: 'table',
  allowedSelect: ALLOWED_SELECT,
  allowedFilters: FILTER_KEYS,
  allowedSort: SORT_FIELDS,
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
      view: 'keywords',
      columns: select.map((key) => COLUMNS[key]), // select 已由 service 驗證 ⊆ allowedSelect
      rows: page.rows.map((row) => pick(row, select)),
      pagination: page.meta,
    };
  },
};
