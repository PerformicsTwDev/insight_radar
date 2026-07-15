import type { GetKeywordsParams } from '../api/keywords';

/**
 * Server pagination + sort decision core (T2.6, FR-7, Design §6 C5). Pure `core`
 * lib — **no React / no IO** — so the keyset/offset switch rule is exhaustively
 * unit-testable (TC-12) and hits the ≥90% core coverage gate.
 *
 * **C5 (keyset vs offset):** the list defaults to **offset** (needs `meta.total`
 * for page numbers); once navigation goes strictly **deeper than
 * `OFFSET_MAX_PAGE`** *and* the sort is stable it switches to **keyset** (opaque
 * `cursor`, no `total`). The two cursor styles are never mixed for the same list
 * in one session: once keyset is engaged navigation stays keyset, and a
 * sort / filter / page-size change resets to offset page 1 (see
 * {@link paginationReducer}). Deep offset would force a backend re-scan and
 * total/cursor mixing would drift — both avoided here.
 *
 * The backend (`src/keywords/paginate.ts`) keys the request off **cursor
 * presence**: a request carrying `cursor` runs keyset (start-after that opaque
 * position), otherwise offset (`page`/`pageSize`). The cursor is produced by the
 * backend (`meta.cursor` = the *next* page's cursor, `null` on the last page) and
 * is only valid under the **same** `sortBy`/`sortDir` — which the reset-on-sort
 * rule guarantees. The frontend treats it as opaque (never decodes it).
 */

export type PageMode = 'offset' | 'keyset';

/**
 * Sortable columns — mirror of the backend `SORT_FIELDS` (`src/keywords/paginate.ts`).
 * Single frontend source for the sort UI options + the URL `sortBy` enum.
 */
export const SORT_FIELDS = [
  'avgMonthlySearches',
  'competitionIndex',
  'cpcLow',
  'cpcHigh',
  'text',
] as const;
export type SortBy = (typeof SORT_FIELDS)[number];

export const SORT_DIRS = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIRS)[number];

/**
 * The pagination/sort subset of the `getKeywords` egress params. Offset carries
 * `page`; keyset carries `cursor` (never both) — see {@link buildPageParams}.
 * Pinned to {@link GetKeywordsParams} so a drift in the sort union is a compile error.
 */
export type PageParams = Pick<
  GetKeywordsParams,
  'page' | 'cursor' | 'pageSize' | 'sortBy' | 'sortDir'
>;

/** Current pagination position (mirrors the URL search params, normalised + defaulted). */
export interface PaginationState {
  readonly page: number;
  readonly pageSize: number;
  /** Present iff keyset navigation is engaged (opaque backend cursor). */
  readonly cursor?: string;
  readonly sortBy: SortBy;
  readonly sortDir: SortDir;
}

/** Raw pagination fields as read off the URL (all optional). */
export type PaginationSearch = Partial<
  Pick<PaginationState, 'page' | 'pageSize' | 'cursor' | 'sortBy' | 'sortDir'>
>;

/**
 * Navigation intents. `next`/`prev` carry the cursors the caller holds (the
 * current response's `meta.cursor` for `next`; a session-history cursor for a
 * deep keyset `prev`) so the reducer stays pure.
 */
export type PaginationAction =
  | { readonly type: 'sort'; readonly sortBy: SortBy; readonly sortDir: SortDir }
  | { readonly type: 'pageSize'; readonly requested: number; readonly max: number }
  | { readonly type: 'reset' }
  | { readonly type: 'goto'; readonly page: number }
  | {
      readonly type: 'next';
      readonly nextCursor: string | null;
      readonly offsetMaxPage: number;
      readonly sortStable: boolean;
    }
  | {
      readonly type: 'prev';
      readonly prevCursor: string | undefined;
      readonly offsetMaxPage: number;
    };

/** Clamp a requested page size to `[1, max]` (mirrors backend `QUERY_MAX_PAGE_SIZE`). */
export function clampPageSize(_requested: number, _max: number): number {
  throw new Error('pagination: not implemented');
}

/** Page count for offset mode (≥ 1, so an empty list still reads as "1 of 1"). */
export function totalPages(_total: number, _pageSize: number): number {
  throw new Error('pagination: not implemented');
}

/** C5 switch: keyset iff the sort is stable **and** the page is strictly deeper than the offset cap. */
export function resolveMode(_page: number, _offsetMaxPage: number, _sortStable: boolean): PageMode {
  throw new Error('pagination: not implemented');
}

/** Project state onto the `getKeywords` params for the given mode (offset → `page`; keyset → `cursor`). */
export function buildPageParams(_mode: PageMode, _state: PaginationState): PageParams {
  throw new Error('pagination: not implemented');
}

/** Normalise raw URL pagination params into a defaulted, clamped {@link PaginationState}. */
export function toPaginationState(
  _raw: PaginationSearch,
  _defaults: { readonly pageSize: number; readonly maxPageSize: number },
): PaginationState {
  throw new Error('pagination: not implemented');
}

/** Pure transition that enforces the C5 "never mix cursor styles in a session" rule. */
export function paginationReducer(
  _state: PaginationState,
  _action: PaginationAction,
): PaginationState {
  throw new Error('pagination: not implemented');
}
