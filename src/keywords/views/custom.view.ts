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

/** 自訂分類 table view 的可選欄位（`label` 由 load path 以 normalizedText left-join 帶入）。 */
const COLUMNS: Record<string, ColumnDef> = {
  text: { key: 'text', label: '關鍵字', type: 'text' },
  normalizedText: { key: 'normalizedText', label: '正規化文字', type: 'text' },
  label: { key: 'label', label: '自訂標籤', type: 'text' },
  avgMonthlySearches: { key: 'avgMonthlySearches', label: '月均搜量', type: 'number' },
};
const ALLOWED_SELECT = Object.keys(COLUMNS);

/** 取列上被選欄位（select 已由 service 驗證 ⊆ allowedSelect）。 */
function pick(row: SnapshotRowData, keys: string[]): Record<string, unknown> {
  const rec = row as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, rec[key]]));
}

/**
 * 自訂分類**動態 view** 工廠（T12.9，FR-34/AC-34.3；鏡像 `journeyView` 但 `label` 換 `stage`）。view 名為
 * `custom:{classificationId}`（**參數化**，故為工廠而非常數 def）——`ViewRegistry` 於 boot 凍結、不支援 per-cid
 * 註冊，改由 `SnapshotQueryService` 以 `view.startsWith('custom:')` 動態解析並產生本 def（Option a，Design §17.4）。
 *
 * `build` 與 keywords/journey view 同一 filter/分頁；`label` 由 SnapshotQueryService 的 custom load path 以
 * normalizedText left-join 自 `keyword_custom_assignments`（`where:{classificationId:cid}`）帶入（未指派字 → label 缺）。
 * per-cid gating（未知 cid→404 / 無 completed run→409）於 load path 決定，**不**走 `requiresFeature`（FeatureKey 無 per-cid 槽）。
 */
export function customView(classificationId: string): ViewDefinition {
  const name = `custom:${classificationId}`;
  return {
    name,
    kind: 'table',
    grain: 'keyword',
    allowedSelect: ALLOWED_SELECT,
    selectColumns: Object.values(COLUMNS),
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
        view: name,
        columns: select.map((key) => COLUMNS[key]), // select 已由 service 驗證 ⊆ allowedSelect
        rows: page.rows.map((row) => pick(row, select)),
        pagination: page.meta,
      };
    },
  };
}
