import type { FeatureKey } from '../../keyword-analysis/features';
import type { SnapshotRowData } from '../../keyword-analysis/result-snapshot.checksum';
import type { AggregateGroup } from '../aggregate';
import type { TrendSeries } from '../build-trend';
import type { FilterSpec } from '../filter-spec';
import type { PageMeta } from '../paginate';

/**
 * View-router 型別（T5.5，FR-14/NFR-10，Design §6.5）。`POST /query` 前端只給 `view` + select/filters/sort/
 * pagination；後端映射到白名單化的 `ViewDefinition`。新增 dashboard 表 = 多註冊一個 ViewDefinition（免新 endpoint）。
 */

export interface QuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryPagination {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

/** 查詢請求：**白名單/上限**由 QueryViewService 於 build 前把關；**型別**由 `POST /query` controller DTO 驗證。 */
export interface QueryRequest {
  view: string;
  select?: string[];
  filters?: FilterSpec;
  sort?: QuerySort[];
  pagination?: QueryPagination;
}

export interface QueryLimits {
  maxPageSize: number;
  aggMaxBuckets: number;
  aggMaxGroups: number;
}

export interface ViewContext {
  /** 已載入的不可變 snapshot 列（含 intent + monthlyVolumes）。 */
  rows: SnapshotRowData[];
  request: QueryRequest;
  limits: QueryLimits;
}

export interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'array';
}

/** table view（keywords）。 */
export interface TableViewResult {
  view: string;
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  pagination: PageMeta;
}

/** trend view（月軸 + 加總 + top-N series）。 */
export interface TrendViewResult {
  view: string;
  axis: string[];
  total: number[];
  series: TrendSeries[];
}

/** chart view（intent_distribution / cpc_histogram：分組 groups + meta）。 */
export interface ChartViewResult {
  view: string;
  groups: AggregateGroup[];
  meta: { total: number; truncated: boolean };
}

export type ViewResult = TableViewResult | TrendViewResult | ChartViewResult;

/** view 回應形狀（前端據此挑渲染器：表格 / 趨勢折線 / 圖表分組）。對映 `ViewResult` 三型。 */
export type ViewKind = 'table' | 'trend' | 'chart';

/** view 未指定 `requiresFeature` 時的預設 feature（既有 snapshot pipeline，snapshot 就緒即 ready）。 */
export const DEFAULT_VIEW_FEATURE: FeatureKey = 'keyword_metrics';

/**
 * `GET /views` 自省 metadata（FR-22/NFR-10）：由 `ViewDefinition` 直接導出（單一來源，與 `/query`
 * 白名單同源、不另抄），前端據此驅動 tab/欄位/篩選 config。
 */
export interface ViewMetadata {
  name: string;
  kind: ViewKind;
  allowedSelect: string[];
  allowedFilters: string[];
  allowedSort: string[];
  requiresFeature: FeatureKey;
}

/**
 * 具名視圖定義：固定其可選/可篩/可排欄位（白名單）、回應形狀 `kind` 與 `build`（filter → shape → format）。
 * `build` 假設 `ctx.request` **已驗證**（白名單/型別/上限由 QueryViewService 於呼叫前把關）。
 */
export interface ViewDefinition {
  name: string;
  kind: ViewKind;
  allowedSelect: readonly string[];
  allowedFilters: readonly string[];
  allowedSort: readonly string[];
  /**
   * 此 view 依賴的 compute feature（feature-gating，AC-14.7）。未指定 → `keyword_metrics`（既有 snapshot
   * pipeline，snapshot 就緒即 ready）。指定 `serp`/`topics` 者在該 feature 未 ready 時由 QueryViewService
   * gate（回 `FEATURE_NOT_READY` 而非誤導空表）。
   */
  requiresFeature?: FeatureKey;
  build(ctx: ViewContext): ViewResult;
}

/**
 * 共用 `FilterSpec` 的欄位鍵（各 view 的 allowedFilters 子集皆取自此）。`satisfies` 綁定 `keyof FilterSpec`：
 * FilterSpec 欄位改名/拼錯即編譯失敗，防白名單漂移。
 */
export const FILTER_KEYS = [
  'volumeMin',
  'volumeMax',
  'q',
  'intent',
  'intentMode',
  'competition',
  'competitionIndexMin',
  'competitionIndexMax',
  'cpcMin',
  'cpcMax',
] as const satisfies readonly (keyof FilterSpec)[];
