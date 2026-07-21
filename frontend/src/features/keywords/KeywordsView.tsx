import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { getKeywords } from '../../api/keywords';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { deserializeFiltersFromUrl } from '../../lib/filterSpec';
import { KeywordsFilters } from './filters/KeywordsFilters';
import { KeywordsPagination } from './KeywordsPagination';
import { KeywordsTable } from './KeywordsTable';

/**
 * Keywords grand-table container (T6.0, FR-4 / FR-1). The data hook the T2.1 table
 * was built to receive: it reads the URL search state (filters / pagination / sort,
 * Design §5 「URL 即狀態」), fetches `GET :id/keywords` via the typed egress, and
 * feeds the presentational {@link KeywordsTable} its rows + the analysis context for
 * the ✦ on-demand column. The router-bound {@link KeywordsFilters} / {@link
 * KeywordsPagination} own their own URL writes; here we only mirror the same URL
 * state into the query key + request so a filter / page / sort change re-fetches
 * (Design §5). Async states go through the shared StateViews (T6.1).
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

  const result = query.data;
  return (
    <div className="flex flex-col gap-3">
      <KeywordsFilters />
      {query.isPending ? (
        <LoadingState label="載入搜尋詞…" />
      ) : !result || !result.ok ? (
        <ErrorState message="無法載入搜尋詞，請稍後再試。" onRetry={() => void query.refetch()} />
      ) : result.rows.length === 0 ? (
        <EmptyState message="沒有符合條件的搜尋詞。" />
      ) : (
        <>
          <KeywordsTable rows={result.rows} analysisId={analysisId} />
          <KeywordsPagination meta={result.meta} />
        </>
      )}
    </div>
  );
}
