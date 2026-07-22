import type { VisibilityDimension } from '../../ai-visibility/visibility-metrics';
import {
  type AiMetricReadRow,
  buildAiAnswersTable,
  buildCitedMediaTable,
  buildCitedPagesTable,
  buildVisibilitySummary,
  buildVisibilityTable,
} from './ai-view-shape';
import {
  type ColumnDef,
  FILTER_KEYS,
  type TableViewResult,
  type ViewContext,
  type ViewDefinition,
} from './view-definition';

/**
 * AI Search 讀取層 view 註冊 + 實讀 build（T15.6 註冊 / T15.8b build，#678 G2；FR-44/AC-44.1~44.3；Design §18.4）。
 * 9 view 皆經既有 `POST /keyword-analyses/:id/query` primitive + 統一 `FilterSpec`（無專屬 endpoint，INV-1/2）。
 *
 * **build 分工（比照 journey/custom 動態 view）**：SnapshotQueryService 解析最新 completed linked `AiSearchRun.id`、
 * gate（`ai_search` feature 未 ready→409 `FEATURE_NOT_READY`，非誤導空表 INV-6）、由 {@link AI_VIEW_SOURCE} 載入該
 * job 的 T15.5 落庫列（`ai_answers`/`ai_cited_references`/`ai_visibility_metrics`）後注入 `ctx.rows`；此處 `build`
 * 為**純形狀函式**（`ai-view-shape`：filter → sort → paginate → 投影）。`ctx.rows` 型別為 snapshot 列（靜態 pipeline
 * 之形狀），動態 AI 讀取層以 `as unknown as` 收斂（同 custom/journey 對 augmented 列的處理）。
 */

/** 載入來源描述（view → 該讀哪張 T15.5 表 + 可見度維度）。SnapshotQueryService 依此載入後注入 `ctx.rows`。 */
export type AiViewTable = 'answers' | 'cited' | 'metrics';
export interface AiViewSource {
  table: AiViewTable;
  /** `metrics` 表的 dimension 篩選（keyword/intent/journey）；`answers`/`cited` 無。 */
  dimension?: VisibilityDimension;
}

/** AI 回答（`ai_answers`）——brands=露出次數不去重、positive/negative=褒貶各自累計（S17）。 */
const ANSWER_COLUMNS: ColumnDef[] = [
  { key: 'channel', label: '渠道', type: 'text' },
  { key: 'query', label: '查詢', type: 'text' },
  { key: 'answerText', label: 'AI 回答', type: 'text' },
  { key: 'brands', label: '品牌提及', type: 'array' },
  { key: 'positive', label: '褒', type: 'number' },
  { key: 'negative', label: '貶', type: 'number' },
];

/** 引用媒體總覽（依 `media_type` 聚合佔比；`ai_cited_references`）。 */
const CITED_MEDIA_COLUMNS: ColumnDef[] = [
  { key: 'mediaType', label: '媒體類型', type: 'text' },
  { key: 'count', label: '引用數', type: 'number' },
  { key: 'share', label: '佔比', type: 'number' },
];

/** 引用頁面逐頁列表（`ai_cited_references`；與 ai_cited_media 共用來源，DRY）。 */
const CITED_PAGES_COLUMNS: ColumnDef[] = [
  { key: 'channel', label: '渠道', type: 'text' },
  { key: 'query', label: '查詢', type: 'text' },
  { key: 'link', label: '連結', type: 'text' },
  { key: 'domain', label: '網域', type: 'text' },
  { key: 'title', label: '標題', type: 'text' },
  { key: 'mediaType', label: '媒體類型', type: 'text' },
];

/** 可見度概覽欄位（`ai_visibility_metrics`；brand/intent/journey 三維共用形狀，差異在 dimension 篩選）。 */
const VISIBILITY_COLUMNS: ColumnDef[] = [
  { key: 'channel', label: '渠道', type: 'text' },
  { key: 'groupKey', label: '分組', type: 'text' },
  { key: 'brand', label: '品牌', type: 'text' },
  { key: 'mentions', label: '提及數', type: 'number' },
  { key: 'shareOfVoice', label: 'AI 聲量', type: 'number' },
  { key: 'citations', label: '引用數', type: 'number' },
  { key: 'exposure', label: '曝光數', type: 'number' },
];

/** table view 純形狀函式契約（`ai-view-shape` 的 build*Table 皆符合）。 */
type TableShape<T> = (
  viewName: string,
  columns: readonly ColumnDef[],
  allowedSelect: readonly string[],
  rows: readonly T[],
  request: ViewContext['request'],
) => TableViewResult;

/** AI table view 工廠：固定白名單（allowedSelect＝欄位、allowedFilters＝統一 FILTER_KEYS）+ 注入純形狀函式。 */
function aiTableView<T>(
  name: string,
  grain: string,
  columns: ColumnDef[],
  shape: TableShape<T>,
): ViewDefinition {
  const allowedSelect = columns.map((c) => c.key);
  return {
    name,
    kind: 'table',
    grain,
    allowedSelect,
    selectColumns: columns,
    allowedFilters: FILTER_KEYS,
    allowedSort: allowedSelect,
    requiresFeature: 'ai_search',
    build(ctx: ViewContext): TableViewResult {
      // ctx.rows＝SnapshotQueryService 由 AI_VIEW_SOURCE 載入注入的 T15.5 列（非 snapshot 列，動態讀取層收斂）。
      return shape(name, columns, allowedSelect, ctx.rows as unknown as T[], ctx.request);
    },
  };
}

/** AI 可見度 `*_summary` KPI score-cards 工廠（單列聚合，responseShape=summary）。 */
function aiSummaryView(name: string, grain: string): ViewDefinition {
  return {
    name,
    kind: 'summary',
    grain,
    allowedSelect: [],
    allowedFilters: FILTER_KEYS,
    allowedSort: [],
    requiresFeature: 'ai_search',
    build(ctx: ViewContext) {
      return buildVisibilitySummary(name, ctx.rows as unknown as AiMetricReadRow[], ctx.request);
    },
  };
}

export const aiAnswersView: ViewDefinition = aiTableView(
  'ai_answers',
  'ai_answer',
  ANSWER_COLUMNS,
  buildAiAnswersTable,
);
export const aiCitedMediaView: ViewDefinition = aiTableView(
  'ai_cited_media',
  'media_type',
  CITED_MEDIA_COLUMNS,
  buildCitedMediaTable,
);
export const aiCitedPagesView: ViewDefinition = aiTableView(
  'ai_cited_pages',
  'cited_page',
  CITED_PAGES_COLUMNS,
  buildCitedPagesTable,
);
export const brandAiVisibilityView: ViewDefinition = aiTableView(
  'brand_ai_visibility',
  'brand',
  VISIBILITY_COLUMNS,
  buildVisibilityTable,
);
export const intentAiVisibilityView: ViewDefinition = aiTableView(
  'intent_ai_visibility',
  'intent',
  VISIBILITY_COLUMNS,
  buildVisibilityTable,
);
export const journeyAiVisibilityView: ViewDefinition = aiTableView(
  'journey_ai_visibility',
  'journey',
  VISIBILITY_COLUMNS,
  buildVisibilityTable,
);
export const brandAiVisibilitySummaryView: ViewDefinition = aiSummaryView(
  'brand_ai_visibility_summary',
  'brand',
);
export const intentAiVisibilitySummaryView: ViewDefinition = aiSummaryView(
  'intent_ai_visibility_summary',
  'intent',
);
export const journeyAiVisibilitySummaryView: ViewDefinition = aiSummaryView(
  'journey_ai_visibility_summary',
  'journey',
);

/**
 * view → T15.5 載入來源（keyed by 最新 completed linked `AiSearchRun.id`）。`metrics` view 依 dimension 篩選：
 * `brand_*`→keyword、`intent_*`→intent、`journey_*`→journey（AC-43.3；brand 概覽＝keyword 維度逐字，其餘為 G3 維度）。
 */
export const AI_VIEW_SOURCE: Record<string, AiViewSource> = {
  ai_answers: { table: 'answers' },
  ai_cited_media: { table: 'cited' },
  ai_cited_pages: { table: 'cited' },
  brand_ai_visibility: { table: 'metrics', dimension: 'keyword' },
  intent_ai_visibility: { table: 'metrics', dimension: 'intent' },
  journey_ai_visibility: { table: 'metrics', dimension: 'journey' },
  brand_ai_visibility_summary: { table: 'metrics', dimension: 'keyword' },
  intent_ai_visibility_summary: { table: 'metrics', dimension: 'intent' },
  journey_ai_visibility_summary: { table: 'metrics', dimension: 'journey' },
};

/** AI Search view 名集（供 SnapshotQueryService 路由至專屬載入 + build 路徑）。 */
export const AI_SEARCH_VIEW_NAMES = new Set<string>(Object.keys(AI_VIEW_SOURCE));

/** 全部 AI Search view（供 BUILTIN_VIEWS 註冊；順序＝明細/可見度表 → *_summary KPI）。 */
export const AI_SEARCH_VIEWS: ViewDefinition[] = [
  aiAnswersView,
  aiCitedMediaView,
  aiCitedPagesView,
  brandAiVisibilityView,
  intentAiVisibilityView,
  journeyAiVisibilityView,
  brandAiVisibilitySummaryView,
  intentAiVisibilitySummaryView,
  journeyAiVisibilitySummaryView,
];
