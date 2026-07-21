import type { ColumnDef } from './view-definition';
import { placeholderSummaryView, placeholderTableView } from './placeholder-view';
import type { ViewDefinition } from './view-definition';

/**
 * AI Search 讀取層 view 註冊（T15.6，FR-44/AC-44.1~44.3；Design §18.4）。沿用 M5/M6 `serp_questions`/
 * `intent_topics` **gated placeholder** 先例：view 名 + grain + 欄位 + 依賴 `ai_search` feature 先就位，`build`
 * 過渡回**正確空形狀**；compute 未接線（`ai_search` 恆 `not_generated`）→ 由 QueryViewService gate（409
 * `FEATURE_NOT_READY`，非誤導空表、非 500，INV-6）。實際查 T15.5 落庫（`ai_answers`/`ai_cited_references`/
 * `ai_visibility_metrics`，keyed by `ai_search_runs.id`）之 `build` + intent/journey 維度組裝屬後續 slice（#678）。
 * 皆經既有 `POST /keyword-analyses/:id/query` primitive + 統一 `FilterSpec`（無專屬 endpoint，INV-1/2）。
 */

/** AI 回答（per-answer；`ai_answers` 表）——channel/query/answerText/brands(露出次數)/positive/negative（S17）。 */
export const aiAnswersView: ViewDefinition = placeholderTableView(
  'ai_answers',
  'ai_search',
  'ai_answer',
  [
    { key: 'channel', label: '渠道', type: 'text' },
    { key: 'query', label: '查詢', type: 'text' },
    { key: 'answerText', label: 'AI 回答', type: 'text' },
    { key: 'brands', label: '品牌提及', type: 'array' },
    { key: 'positive', label: '褒', type: 'number' },
    { key: 'negative', label: '貶', type: 'number' },
  ],
);

/** 引用媒體總覽（依 `media_type` 聚合佔比；`ai_cited_references` 表）。 */
export const aiCitedMediaView: ViewDefinition = placeholderTableView(
  'ai_cited_media',
  'ai_search',
  'media_type',
  [
    { key: 'mediaType', label: '媒體類型', type: 'text' },
    { key: 'count', label: '引用數', type: 'number' },
    { key: 'share', label: '佔比', type: 'number' },
  ],
);

/** 引用頁面逐頁列表（`ai_cited_references` 表；與 ai_cited_media 共用來源，DRY）。 */
export const aiCitedPagesView: ViewDefinition = placeholderTableView(
  'ai_cited_pages',
  'ai_search',
  'cited_page',
  [
    { key: 'channel', label: '渠道', type: 'text' },
    { key: 'query', label: '查詢', type: 'text' },
    { key: 'link', label: '連結', type: 'text' },
    { key: 'domain', label: '網域', type: 'text' },
    { key: 'title', label: '標題', type: 'text' },
    { key: 'mediaType', label: '媒體類型', type: 'text' },
  ],
);

/** 可見度概覽欄位（`ai_visibility_metrics` 表；brand/intent/journey 三維共用形狀，差異在 dimension 篩選）。 */
const VISIBILITY_COLUMNS: ColumnDef[] = [
  { key: 'channel', label: '渠道', type: 'text' },
  { key: 'groupKey', label: '分組', type: 'text' },
  { key: 'brand', label: '品牌', type: 'text' },
  { key: 'mentions', label: '提及數', type: 'number' },
  { key: 'shareOfVoice', label: 'AI 聲量', type: 'number' },
  { key: 'citations', label: '引用數', type: 'number' },
  { key: 'exposure', label: '曝光數', type: 'number' },
];

/** 品牌可見度概覽（`ai_visibility_metrics`）。 */
export const brandAiVisibilityView: ViewDefinition = placeholderTableView(
  'brand_ai_visibility',
  'ai_search',
  'brand',
  VISIBILITY_COLUMNS,
);

/** 意圖可見度概覽（`ai_visibility_metrics`，dimension=intent）。 */
export const intentAiVisibilityView: ViewDefinition = placeholderTableView(
  'intent_ai_visibility',
  'ai_search',
  'intent',
  VISIBILITY_COLUMNS,
);

/** 購買歷程可見度概覽（`ai_visibility_metrics`，dimension=journey）。 */
export const journeyAiVisibilityView: ViewDefinition = placeholderTableView(
  'journey_ai_visibility',
  'ai_search',
  'journey',
  VISIBILITY_COLUMNS,
);

/** 品牌可見度 KPI score cards（單列聚合；responseShape=summary）。 */
export const brandAiVisibilitySummaryView: ViewDefinition = placeholderSummaryView(
  'brand_ai_visibility_summary',
  'ai_search',
  'brand',
);

/** 意圖可見度 KPI score cards。 */
export const intentAiVisibilitySummaryView: ViewDefinition = placeholderSummaryView(
  'intent_ai_visibility_summary',
  'ai_search',
  'intent',
);

/** 購買歷程可見度 KPI score cards。 */
export const journeyAiVisibilitySummaryView: ViewDefinition = placeholderSummaryView(
  'journey_ai_visibility_summary',
  'ai_search',
  'journey',
);

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
