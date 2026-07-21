import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useMemo, type ReactElement } from 'react';
import { getKeywords } from '../../api/keywords';
import { CopyTsvButton } from '../../components/CopyTsvButton';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { deserializeFiltersFromUrl } from '../../lib/filterSpec';
import { keywordsToTsv } from '../../lib/keywordsTsv';
import { selectionKey } from '../../lib/selection';
import { useSelectionStore } from '../../stores/selectionStore';
import { BulkSelectBar } from '../tracking/BulkSelectBar';
import { KeywordsFilters } from './filters/KeywordsFilters';
import { KeywordsPagination } from './KeywordsPagination';
import { KeywordsTable, type KeywordsTableSelection } from './KeywordsTable';

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
export function KeywordsView({ analysisId }: { analysisId: string }): ReactElement {
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
    queryFn: () =>
      getKeywords(analysisId, {
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
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <KeywordsFilters />
        {rows.length > 0 ? <CopyTsvButton getTsv={() => keywordsToTsv(rows)} /> : null}
      </div>
      {query.isPending ? (
        <LoadingState label="載入搜尋詞…" />
      ) : !result || !result.ok ? (
        <ErrorState message="無法載入搜尋詞，請稍後再試。" onRetry={() => void query.refetch()} />
      ) : result.rows.length === 0 ? (
        <EmptyState message="沒有符合條件的搜尋詞。" />
      ) : (
        <>
          <KeywordsTable rows={result.rows} analysisId={analysisId} selection={selection} />
          <KeywordsPagination meta={result.meta} />
        </>
      )}
      {/* Floating bulk bar (renders null when nothing is selected) — the write side of FR-19. */}
      <BulkSelectBar />
    </div>
  );
}
