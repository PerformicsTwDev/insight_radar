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

/** Default sort — mirrors the backend (`avgMonthlySearches desc`, tie-broken by normalizedText). */
const DEFAULT_SORT_BY: SortBy = 'avgMonthlySearches';
const DEFAULT_SORT_DIR: SortDir = 'desc';

/** Clamp a requested page size to `[1, max]` (mirrors backend `QUERY_MAX_PAGE_SIZE`). */
export function clampPageSize(requested: number, max: number): number {
  return Math.min(Math.max(1, requested), max);
}

/** Page count for offset mode (≥ 1, so an empty list still reads as "1 of 1"). */
export function totalPages(total: number, pageSize: number): number {
  // `Math.max(1, pageSize)` guards a 0 page size against a divide-by-zero (Infinity).
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/**
 * The "顯示 X–Y 筆，共 N 筆" footer range (M7-R8, FR-7 / TC-18). `from` is 1-based; an empty
 * result reads as `0–0`. `to` is clamped to `total` so the last page never over-counts.
 */
export function showingRange(
  page: number,
  pageSize: number,
  total: number,
): { readonly from: number; readonly to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  return { from, to };
}

/**
 * Windowed page list with `…` gaps (M7-R8): always shows page 1 and the last page, plus a
 * `windowSize`-wide run centred on `current` (clamped to the ends), e.g. `[1,2,3,'…',12]` for
 * page 1 of 12. Returns `[1..total]` verbatim when it already fits. Pure; unit-tested.
 */
export function pageWindow(
  current: number,
  total: number,
  windowSize = 3,
): readonly (number | 'ellipsis')[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const end = Math.min(total, Math.max(1, current - Math.floor(windowSize / 2)) + windowSize - 1);
  const start = Math.max(1, end - windowSize + 1);
  const items: (number | 'ellipsis')[] = [];
  if (start > 1) {
    items.push(1);
    if (start > 2) items.push('ellipsis');
  }
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < total) {
    if (end < total - 1) items.push('ellipsis');
    items.push(total);
  }
  return items;
}

/** C5 switch: keyset iff the sort is stable **and** the page is strictly deeper than the offset cap. */
export function resolveMode(page: number, offsetMaxPage: number, sortStable: boolean): PageMode {
  return sortStable && page > offsetMaxPage ? 'keyset' : 'offset';
}

/**
 * Project state onto the `getKeywords` params for the given mode. Offset sends
 * `page` (backend runs offset); keyset sends `cursor` and NO `page` (backend keys
 * off cursor presence). Both carry `pageSize` + the sort.
 */
export function buildPageParams(mode: PageMode, state: PaginationState): PageParams {
  const base = { pageSize: state.pageSize, sortBy: state.sortBy, sortDir: state.sortDir };
  return mode === 'keyset' ? { ...base, cursor: state.cursor } : { ...base, page: state.page };
}

/** Normalise raw URL pagination params into a defaulted, clamped {@link PaginationState}. */
export function toPaginationState(
  raw: PaginationSearch,
  defaults: { readonly pageSize: number; readonly maxPageSize: number },
): PaginationState {
  return {
    page: raw.page ?? 1,
    pageSize: clampPageSize(raw.pageSize ?? defaults.pageSize, defaults.maxPageSize),
    cursor: raw.cursor,
    sortBy: raw.sortBy ?? DEFAULT_SORT_BY,
    sortDir: raw.sortDir ?? DEFAULT_SORT_DIR,
  };
}

/** Reset to offset page 1 (drops the cursor), keeping the current page size + sort. */
function offsetFirstPage(state: PaginationState): PaginationState {
  return { page: 1, pageSize: state.pageSize, sortBy: state.sortBy, sortDir: state.sortDir };
}

/** An offset position at `page` (no cursor), keeping the current page size + sort. */
function offsetAt(state: PaginationState, page: number): PaginationState {
  return { page, pageSize: state.pageSize, sortBy: state.sortBy, sortDir: state.sortDir };
}

/**
 * Pure transition enforcing C5 "never mix cursor styles in one session":
 * - `sort` / `pageSize` / `reset` (filter change) → offset page 1, cursor dropped.
 * - `goto` → an offset page-number jump (cursor dropped).
 * - `next` → advances; crosses offset→keyset once strictly past the cap with a
 *   stable sort (seeding the response cursor), and **stays keyset once engaged**.
 * - `prev` → steps back; a keyset step that falls back within the cap re-enters
 *   offset, otherwise it uses the caller's session-history cursor.
 */
export function paginationReducer(
  state: PaginationState,
  action: PaginationAction,
): PaginationState {
  switch (action.type) {
    case 'sort':
      return { page: 1, pageSize: state.pageSize, sortBy: action.sortBy, sortDir: action.sortDir };
    case 'pageSize':
      return {
        page: 1,
        pageSize: clampPageSize(action.requested, action.max),
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      };
    case 'reset':
      return offsetFirstPage(state);
    case 'goto':
      return offsetAt(state, action.page);
    case 'next': {
      const target = state.page + 1;
      // Once keyset (cursor present) stay keyset; otherwise the C5 rule decides.
      const keyset =
        state.cursor !== undefined ||
        resolveMode(target, action.offsetMaxPage, action.sortStable) === 'keyset';
      if (!keyset) {
        return offsetAt(state, target);
      }
      if (action.nextCursor === null) {
        return state; // already on the last page — nothing to advance to
      }
      return {
        page: target,
        pageSize: state.pageSize,
        cursor: action.nextCursor,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      };
    }
    case 'prev': {
      const target = state.page - 1;
      if (target < 1) {
        return state; // already on the first page
      }
      if (target <= action.offsetMaxPage) {
        return offsetAt(state, target); // back inside the offset zone
      }
      if (action.prevCursor === undefined) {
        return state; // deep keyset prev with no session history (e.g. cold-loaded link)
      }
      return {
        page: target,
        pageSize: state.pageSize,
        cursor: action.prevCursor,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      };
    }
  }
}
