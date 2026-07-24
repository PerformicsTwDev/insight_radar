import { useState, type ReactElement } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { config } from '../../config/env';
import type { KeywordsMeta } from '../../api/keywords';
import {
  SORT_DIRS,
  SORT_FIELDS,
  pageWindow,
  paginationReducer,
  showingRange,
  toPaginationState,
  totalPages,
  type PaginationAction,
  type PaginationState,
  type SortBy,
  type SortDir,
} from '../../lib/pagination';

/**
 * Server pagination + sort footer (T2.6, FR-7, Design §6 C5). Router-bound like
 * {@link KeywordsFilters}: it reads page/pageSize/cursor/sortBy/sortDir off the
 * URL search params (the shared T2.5 schema) and writes the next state back via
 * `navigate`, so paging is authoritative in the URL and stable over the immutable
 * analysis snapshot (fixed `analysisId` → deterministic re-paging).
 *
 * The C5 keyset/offset decision lives entirely in the pure `lib/pagination` core
 * ({@link paginationReducer}). The current request mode is read straight off
 * cursor presence — exactly how the backend interprets it. Keyset back-navigation
 * uses a session-local cursor history (below): a cold-loaded deep keyset link can
 * always page forward and jump back to page 1 / the offset zone, and re-gains full
 * `prev` once it has paged forward (standard cursor-pagination trade-off).
 *
 * `meta.cursor` is the backend's *next*-page cursor (`null` on the last page) and
 * is opaque here — it is only ever handed straight back on the next request.
 */
export function KeywordsPagination({ meta }: { readonly meta: KeywordsMeta }): ReactElement {
  const navigate = useNavigate();
  const raw = useSearch({
    strict: false,
    select: (s) => ({
      page: s.page,
      pageSize: s.pageSize,
      cursor: s.cursor,
      sortBy: s.sortBy,
      sortDir: s.sortDir,
    }),
  });
  const state = toPaginationState(raw, {
    pageSize: config.defaultPageSize,
    maxPageSize: config.maxPageSize,
  });

  // Session-local trail of the cursors we paged *from*, so keyset `prev` can walk
  // back (the backend cursor is forward-only). Survives navigation re-renders;
  // reset whenever a keyset session ends (sort / page-size / page-number jump).
  const [history, setHistory] = useState<readonly (string | undefined)[]>([]);

  const mode = state.cursor !== undefined ? 'keyset' : 'offset';
  const pages = totalPages(meta.total, state.pageSize);

  function apply(next: PaginationState): void {
    void navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        page: next.page,
        pageSize: next.pageSize,
        cursor: next.cursor,
        sortBy: next.sortBy,
        sortDir: next.sortDir,
      }),
    });
  }

  function dispatch(action: PaginationAction): void {
    apply(paginationReducer(state, action));
  }

  // Sort / page-size / page-number all reset to offset page 1 → end the keyset session.
  function endKeysetSession(): void {
    setHistory([]);
  }

  function handleSort(sortBy: SortBy, sortDir: SortDir): void {
    endKeysetSession();
    dispatch({ type: 'sort', sortBy, sortDir });
  }

  function handlePageSize(requested: number): void {
    endKeysetSession();
    dispatch({ type: 'pageSize', requested, max: config.maxPageSize });
  }

  function handleGoto(page: number): void {
    endKeysetSession();
    dispatch({ type: 'goto', page });
  }

  function handleNext(): void {
    // The sort is always a deterministic total order here (backend tie-breaks by
    // normalizedText), so keyset is always safe once past the cap → sortStable=true.
    const next = paginationReducer(state, {
      type: 'next',
      nextCursor: meta.cursor,
      offsetMaxPage: config.offsetMaxPage,
      sortStable: true,
    });
    if (next.cursor !== undefined) {
      // Entering or continuing keyset — remember where we came from for `prev`.
      setHistory((h) => [...h, state.cursor]);
    }
    apply(next);
  }

  function handlePrev(): void {
    let prevCursor: string | undefined;
    if (mode === 'keyset') {
      prevCursor = history[history.length - 1];
      setHistory((h) => h.slice(0, -1));
    }
    apply(
      paginationReducer(state, { type: 'prev', prevCursor, offsetMaxPage: config.offsetMaxPage }),
    );
  }

  const prevDisabled = mode === 'keyset' ? history.length === 0 : state.page <= 1;
  const nextDisabled = mode === 'keyset' ? meta.cursor === null : state.page >= pages;
  const currentPage = mode === 'keyset' ? meta.page : state.page;
  const range = showingRange(currentPage, state.pageSize, meta.total);
  // Windowed page list capped at the offset zone (deep pages go via keyset 下一頁).
  const window = pageWindow(currentPage, Math.min(pages, config.offsetMaxPage));

  return (
    <div
      role="group"
      aria-label="分頁與排序"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-3 py-2 text-sm text-white/70"
    >
      <SortControls
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        pageSize={state.pageSize}
        onSort={handleSort}
        onPageSize={handlePageSize}
      />

      <div className="flex items-center gap-2">
        {mode === 'offset' ? (
          <span className="tabular-nums text-white/50">
            顯示 {range.from}–{range.to} 筆，共 {meta.total} 筆
          </span>
        ) : (
          <span className="tabular-nums text-white/50">第 {currentPage} 頁</span>
        )}

        <button
          type="button"
          aria-label="上一頁"
          disabled={prevDisabled}
          onClick={handlePrev}
          className={NAV_BTN}
        >
          上一頁
        </button>

        {mode === 'offset' ? (
          <div className="flex items-center gap-1">
            {window.map((p, i) =>
              p === 'ellipsis' ? (
                <span key={`ellipsis-${i}`} aria-hidden="true" className="px-1 text-white/40">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  aria-label={`第 ${p} 頁`}
                  aria-current={p === currentPage ? 'page' : undefined}
                  onClick={() => handleGoto(p)}
                  className={p === currentPage ? PAGE_BTN_ACTIVE : PAGE_BTN}
                >
                  {p}
                </button>
              ),
            )}
          </div>
        ) : null}

        <button
          type="button"
          aria-label="下一頁"
          disabled={nextDisabled}
          onClick={handleNext}
          className={NAV_BTN}
        >
          下一頁
        </button>
      </div>
    </div>
  );
}

const SORT_LABELS: Record<SortBy, string> = {
  avgMonthlySearches: '搜尋量',
  competitionIndex: '競爭度',
  cpcLow: 'CPC 低',
  cpcHigh: 'CPC 高',
  text: '搜尋詞',
};
const DIR_LABELS: Record<SortDir, string> = { asc: '遞增', desc: '遞減' };
// Page-size presets, capped to the config max so the control can never request an over-cap page.
const PAGE_SIZES = [25, 50, 100].filter((s) => s <= config.maxPageSize);

const SELECT =
  'rounded-lg bg-bg-input px-2 py-1 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-brand';
const NAV_BTN =
  'rounded-lg px-2.5 py-1 text-xs text-white/70 ring-1 ring-white/10 enabled:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40';
const PAGE_BTN =
  'rounded-lg px-2 py-1 text-xs tabular-nums text-white/60 ring-1 ring-white/10 hover:bg-white/5';
const PAGE_BTN_ACTIVE =
  'rounded-lg bg-brand/15 px-2 py-1 text-xs tabular-nums text-white ring-1 ring-brand/40';

function SortControls({
  sortBy,
  sortDir,
  pageSize,
  onSort,
  onPageSize,
}: {
  readonly sortBy: SortBy;
  readonly sortDir: SortDir;
  readonly pageSize: number;
  readonly onSort: (sortBy: SortBy, sortDir: SortDir) => void;
  readonly onPageSize: (requested: number) => void;
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-white/50">
        排序
        <select
          aria-label="排序欄位"
          value={sortBy}
          onChange={(e) => onSort(e.target.value as SortBy, sortDir)}
          className={SELECT}
        >
          {SORT_FIELDS.map((field) => (
            <option key={field} value={field}>
              {SORT_LABELS[field]}
            </option>
          ))}
        </select>
        <select
          aria-label="排序方向"
          value={sortDir}
          onChange={(e) => onSort(sortBy, e.target.value as SortDir)}
          className={SELECT}
        >
          {SORT_DIRS.map((dir) => (
            <option key={dir} value={dir}>
              {DIR_LABELS[dir]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-white/50">
        每頁
        <select
          aria-label="每頁筆數"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className={SELECT}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
