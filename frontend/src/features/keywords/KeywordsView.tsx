import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useMemo, type ReactElement } from 'react';
import { getKeywordsView } from '../../api/keywords';
import { postQueryAllPages } from '../../api/query';
import { CopyTsvButton } from '../../components/CopyTsvButton';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { deserializeFiltersFromUrl } from '../../lib/filterSpec';
import { featureStatusOf } from '../../lib/featureGate';
import { keywordsToTsv } from '../../lib/keywordsTsv';
import { selectionKey } from '../../lib/selection';
import { useSelectionStore } from '../../stores/selectionStore';
import { useJourney } from '../journey/useJourney';
import { useTopics } from '../topics/useTopics';
import { TrendView } from '../trend/TrendView';
import { BulkSelectBar } from '../tracking/BulkSelectBar';
import {
  cellStateForRow,
  dimensionHeaderPhase,
  journeyStageByKey,
  topicLabelByKey,
} from './keywordDimensions';
import { KeywordsPagination } from './KeywordsPagination';
import {
  KeywordsTable,
  type DimensionColumnConfig,
  type KeywordsTableSelection,
} from './KeywordsTable';

/**
 * Keywords grand-table container (T6.0, FR-4 / FR-1). The data hook the T2.1 table
 * was built to receive: it reads the URL search state (filters / pagination / sort,
 * Design §5 「URL 即狀態」), fetches `GET :id/keywords` via the typed egress, and
 * feeds the presentational {@link KeywordsTable} its rows + the analysis context for
 * the ✦ on-demand column. The router-bound {@link KeywordsFilters} / {@link
 * KeywordsPagination} own their own URL writes; here we only mirror the same URL
 * state into the query key + request so a filter / page / sort change re-fetches
 * (Design §5). Async states go through the shared StateViews (T6.1).
 *
 * Two FR-existing exports mount here now that T6.0 route-mounts the table: 複製表格
 * (TSV, FR-13) over the current rows, and per-row tracking selection (FR-19). Selection
 * is enabled only when the analysis (geo, language) context is in the URL (create /
 * reopen carry it, Design §5) — a picked keyword must know its list-layer-fixed context;
 * without it the table stays selection-free rather than seeding an empty context.
 */

export function KeywordsView({
  analysisId,
  features,
}: {
  analysisId: string;
  /** The `GET :id` features map (opaque) — gates the AI 洞察面板 (T7.4). */
  readonly features?: unknown;
}): ReactElement {
  const search = useSearch({
    strict: false,
    select: (s) => ({
      filters: s.filters,
      page: s.page,
      pageSize: s.pageSize,
      cursor: s.cursor,
      sortBy: s.sortBy,
      sortDir: s.sortDir,
      geo: s.geo,
      language: s.language,
    }),
  });
  const filters = deserializeFiltersFromUrl(search.filters);

  const query = useQuery({
    // Filters + pagination + sort are all in the key → any URL change re-fetches
    // with the new row set (Design §5). `?? null` keeps the key JSON-stable.
    queryKey: [
      'keywords',
      analysisId,
      search.filters ?? null,
      search.page ?? null,
      search.pageSize ?? null,
      search.cursor ?? null,
      search.sortBy ?? null,
      search.sortDir ?? null,
    ],
    // M7-R1: read via the view-router (POST /query {view:keywords}) so rows carry
    // monthlyVolumes + normalizedText (the lean GET /keywords omits them, AC-6.1). Same
    // { ok, rows, meta } shape — filters / pagination / sort / selection are unchanged.
    queryFn: () =>
      getKeywordsView(analysisId, {
        ...filters,
        page: search.page,
        pageSize: search.pageSize,
        cursor: search.cursor,
        sortBy: search.sortBy,
        sortDir: search.sortDir,
      }),
  });

  const items = useSelectionStore((s) => s.items);
  const toggle = useSelectionStore((s) => s.toggle);
  const selectedKeys = useMemo(() => new Set(items.map(selectionKey)), [items]);

  const { geo, language } = search;
  // Selection is enabled only with a (geo, language) context; inside the guard a picked
  // keyword carries that source context so a new list is fixed to it (FR-19 list layer).
  const selection: KeywordsTableSelection | undefined =
    geo && language
      ? {
          isSelected: (row) =>
            selectedKeys.has(selectionKey({ kind: 'keyword', text: row.text, geo, language })),
          onToggle: (row) => toggle({ kind: 'keyword', text: row.text, geo, language, analysisId }),
        }
      : undefined;

  const result = query.data;
  const rows = result?.ok ? result.rows : [];

  // 搜尋意圖主題 on-demand column (M7-R2b, FR-18): each keyword's topic comes from the topics job,
  // client-joined by normalizedText (D2). Its gate status is read off the GET :id features; the
  // header ✦「generate all」runs the topics analysis but — per C13 — does NOT unlock the left
  // 意圖主題 view (useTopics.start only enqueues + tracks the run).
  const topics = useTopics(analysisId, featureStatusOf(features, 'topics'));
  const topicMap = useMemo(() => topicLabelByKey(topics.topics), [topics.topics]);
  // 購買歷程主題 on-demand column (M7-R2c, FR-15/FR-18): each keyword's stage comes from the journey
  // job's stage 表 (`POST /query {view:journey}`, default select carries normalizedText), client-joined
  // by normalizedText (D2). Same C13 gate-decoupling — generating runs the journey run, no view unlock.
  const journey = useJourney(analysisId, featureStatusOf(features, 'journey'));
  // M7-R12/R20: the column's stage map must cover EVERY keyword, not `useJourney.rows` (the journey
  // view's default first-50 page) — otherwise a classified keyword surfaced by a later table page /
  // sort / filter renders `—` as if unclassified. The backend `/query` caps a single page at 200
  // (Design §6.5) — the old single 100k-row page was silently 400'd — so `postQueryAllPages` follows
  // the cursor to gather all stages (M7-R20). Light normalizedText+stage select → a Map, no DOM render.
  const journeyStagesQuery = useQuery({
    queryKey: ['journey-stages', analysisId],
    queryFn: () =>
      postQueryAllPages(analysisId, { view: 'journey', select: ['normalizedText', 'stage'] }),
    enabled: journey.status === 'ready',
  });
  const journeyStageRows = journeyStagesQuery.data?.ok ? journeyStagesQuery.data.rows : undefined;
  const journeyMap = useMemo(() => journeyStageByKey(journeyStageRows), [journeyStageRows]);
  const dimensionColumns = useMemo<DimensionColumnConfig[]>(
    () => [
      {
        id: 'intentTopic',
        label: '搜尋意圖主題',
        accent: 'topic',
        phase: dimensionHeaderPhase(topics.status),
        onGenerate: () => void topics.start(),
        // `loaded` = the topics result has arrived (topics.topics defined); until then a classified
        // keyword shows the generating shimmer, not the definitive — (M7-R15).
        cellState: (row) =>
          cellStateForRow(topics.status, row.normalizedText, topicMap, topics.topics !== undefined),
      },
      {
        id: 'journeyStage',
        label: '購買歷程主題',
        accent: 'journey',
        phase: dimensionHeaderPhase(journey.status),
        onGenerate: () => void journey.start(),
        // `loaded` = the all-stages query has arrived (M7-R15) — else generating shimmer, not —.
        cellState: (row) =>
          cellStateForRow(
            journey.status,
            row.normalizedText,
            journeyMap,
            journeyStageRows !== undefined,
          ),
      },
    ],
    [topics, topicMap, journey, journeyMap, journeyStageRows],
  );

  return (
    // 搜尋詞總表 centre content (M7-R17): the shared results frame ({@link ResultsLayout})
    // supplies the 分析維度 menu, filter bar and AI 洞察 panel; this view just fills the centre
    // column — the 趨勢 card pinned on top, then the data card (table + pagination) taking the
    // rest with the table scrolling internally.
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* v4: 趨勢圖卡置於總表頁頂（TrendView/TrendChart 自帶卡片外框 + 載入/錯誤/空態）。固定高。 */}
      <TrendView analysisId={analysisId} />

      {/* Data card: 複製表格 (FR-13) + 表格（✦ AI 欄 + sparklines）+ 分頁；填滿剩餘高度、表格獨立捲動。 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {query.isPending ? (
          <LoadingState label="載入搜尋詞…" />
        ) : !result || !result.ok ? (
          <ErrorState message="無法載入搜尋詞，請稍後再試。" onRetry={() => void query.refetch()} />
        ) : result.rows.length === 0 ? (
          <EmptyState message="沒有符合條件的搜尋詞。" />
        ) : (
          <>
            {rows.length > 0 ? (
              <div className="flex shrink-0 justify-end">
                <CopyTsvButton getTsv={() => keywordsToTsv(rows)} />
              </div>
            ) : null}
            <KeywordsTable
              rows={result.rows}
              analysisId={analysisId}
              selection={selection}
              dimensionColumns={dimensionColumns}
            />
            {/* Pagination stays pinned below the filling table (shrink-0). */}
            <div className="shrink-0">
              <KeywordsPagination meta={result.meta} />
            </div>
          </>
        )}
      </div>

      {/* Floating bulk bar (renders null when nothing is selected) — the write side of FR-19. */}
      <BulkSelectBar />
    </div>
  );
}
