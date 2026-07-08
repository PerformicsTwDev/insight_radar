import type { FeatureKey } from '../../keyword-analysis/features';
import { selectPage } from '../paginate';
import {
  type ColumnDef,
  FILTER_KEYS,
  type TableViewResult,
  type ViewContext,
  type ViewDefinition,
} from './view-definition';

/**
 * 尚未實作 compute 的未來 dashboard view（`serp_questions`=M7 SERP、`intent_topics`=M8 分群，Design §6.5）。
 * 僅宣告 view 名 + 依賴 feature + 欄位；QueryViewService 在該 feature 未 ready 時 **gate**（回 `FEATURE_NOT_READY`
 * 而非誤導空表，AC-14.7），故 M6 期間 `build` 不會被呼叫。待對應 milestone 落地時把 `build` 換成查真實資料來源
 * 即可上線（免新 endpoint / 免 migration，AC-14.6）；此處回**空表形狀**（欄位正確、rows 空）作為過渡。
 */
export function placeholderTableView(
  name: string,
  requiresFeature: FeatureKey,
  columns: ColumnDef[],
): ViewDefinition {
  return {
    name,
    kind: 'table',
    requiresFeature,
    allowedSelect: columns.map((c) => c.key),
    allowedFilters: FILTER_KEYS,
    allowedSort: columns.map((c) => c.key),
    build(ctx: ViewContext): TableViewResult {
      const { meta } = selectPage([], {}, ctx.request.pagination ?? {});
      return { view: name, columns, rows: [], pagination: meta };
    },
  };
}

/** `serp_questions`（SERP 問題 entity-grain，需先跑 SERP＝`serp` feature）。 */
export const serpQuestionsView: ViewDefinition = placeholderTableView('serp_questions', 'serp', [
  { key: 'questionText', label: '搜尋問題', type: 'text' },
  { key: 'intentType', label: '意圖類型', type: 'text' },
  { key: 'appearedKeywords', label: '出現關鍵字', type: 'array' },
  { key: 'estimatedImpressions', label: '曝光估算', type: 'number' },
]);

/** `intent_topics`（意圖主題分群 topic-grain，需先跑分群＝`topics` feature）。 */
export const intentTopicsView: ViewDefinition = placeholderTableView('intent_topics', 'topics', [
  { key: 'topic', label: '主題', type: 'text' },
  { key: 'parentTopic', label: '母主題', type: 'text' },
  { key: 'keywordCount', label: '關鍵字數', type: 'number' },
  { key: 'intentLabel', label: '意圖標籤', type: 'text' },
]);
