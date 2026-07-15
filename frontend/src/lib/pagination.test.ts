import {
  buildPageParams,
  clampPageSize,
  paginationReducer,
  resolveMode,
  toPaginationState,
  totalPages,
  type PaginationState,
} from './pagination';

/**
 * TC-12 (FR-7, Design §6 C5): the keyset vs offset switch rule as a pure function.
 * Default offset (needs `meta.total` for page numbers); switch to keyset (`cursor`)
 * only when the sort is stable AND the page is strictly deeper than `OFFSET_MAX_PAGE`;
 * never mix the two cursor styles in one session (a sort/filter/pageSize change
 * resets to offset page 1). Every branch is exercised — the switch is a correctness
 * single point (deep offset re-scan / total-cursor drift).
 */
describe('TC-12 · pagination (keyset/offset switch rule)', () => {
  const OFFSET_MAX_PAGE = 40;

  const base: PaginationState = {
    page: 1,
    pageSize: 25,
    sortBy: 'avgMonthlySearches',
    sortDir: 'desc',
  };

  describe('clampPageSize', () => {
    it('clamps above the max down to the max', () => {
      expect(clampPageSize(500, 100)).toBe(100);
    });
    it('clamps below 1 up to 1', () => {
      expect(clampPageSize(0, 100)).toBe(1);
      expect(clampPageSize(-7, 100)).toBe(1);
    });
    it('passes an in-range size through unchanged', () => {
      expect(clampPageSize(25, 100)).toBe(25);
    });
    it('keeps the exact boundaries (1 and max)', () => {
      expect(clampPageSize(1, 100)).toBe(1);
      expect(clampPageSize(100, 100)).toBe(100);
    });
  });

  describe('totalPages', () => {
    it('is 1 for an empty list (reads as page 1 of 1, never 0)', () => {
      expect(totalPages(0, 25)).toBe(1);
    });
    it('is exact for a whole multiple', () => {
      expect(totalPages(100, 25)).toBe(4);
    });
    it('rounds a partial last page up', () => {
      expect(totalPages(101, 25)).toBe(5);
    });
    it('is 1 when the list fits one page', () => {
      expect(totalPages(25, 25)).toBe(1);
    });
    it('guards a zero page size against a divide-by-zero (never Infinity)', () => {
      expect(Number.isFinite(totalPages(10, 0))).toBe(true);
    });
  });

  describe('resolveMode — the exact `> OFFSET_MAX_PAGE` boundary', () => {
    it('stays offset AT the cap (page === OFFSET_MAX_PAGE is not deep enough)', () => {
      expect(resolveMode(OFFSET_MAX_PAGE, OFFSET_MAX_PAGE, true)).toBe('offset');
    });
    it('switches to keyset one page past the cap', () => {
      expect(resolveMode(OFFSET_MAX_PAGE + 1, OFFSET_MAX_PAGE, true)).toBe('keyset');
    });
    it('stays offset below the cap', () => {
      expect(resolveMode(OFFSET_MAX_PAGE - 1, OFFSET_MAX_PAGE, true)).toBe('offset');
      expect(resolveMode(1, OFFSET_MAX_PAGE, true)).toBe('offset');
    });
    it('stays offset for an unstable sort even when deep (keyset precondition)', () => {
      expect(resolveMode(OFFSET_MAX_PAGE + 1, OFFSET_MAX_PAGE, false)).toBe('offset');
      expect(resolveMode(1000, OFFSET_MAX_PAGE, false)).toBe('offset');
    });
  });

  describe('buildPageParams — offset carries page, keyset carries cursor (never both)', () => {
    it('offset → { page, pageSize, sort } with no cursor', () => {
      const params = buildPageParams('offset', { ...base, page: 3 });
      expect(params).toEqual({
        page: 3,
        pageSize: 25,
        sortBy: 'avgMonthlySearches',
        sortDir: 'desc',
      });
      expect('cursor' in params).toBe(false);
    });
    it('keyset → { cursor, pageSize, sort } with NO page', () => {
      const params = buildPageParams('keyset', { ...base, page: 41, cursor: 'CURSOR41' });
      expect(params).toEqual({
        cursor: 'CURSOR41',
        pageSize: 25,
        sortBy: 'avgMonthlySearches',
        sortDir: 'desc',
      });
      expect('page' in params).toBe(false);
    });
  });

  describe('toPaginationState — URL params → defaulted, clamped state', () => {
    it('applies defaults for an empty URL', () => {
      expect(toPaginationState({}, { pageSize: 25, maxPageSize: 100 })).toEqual({
        page: 1,
        pageSize: 25,
        cursor: undefined,
        sortBy: 'avgMonthlySearches',
        sortDir: 'desc',
      });
    });
    it('passes explicit values through', () => {
      expect(
        toPaginationState(
          { page: 3, pageSize: 50, cursor: 'C', sortBy: 'text', sortDir: 'asc' },
          { pageSize: 25, maxPageSize: 100 },
        ),
      ).toEqual({ page: 3, pageSize: 50, cursor: 'C', sortBy: 'text', sortDir: 'asc' });
    });
    it('clamps an over-max URL pageSize down to the max (TC-18 defence)', () => {
      expect(
        toPaginationState({ pageSize: 500 }, { pageSize: 25, maxPageSize: 100 }).pageSize,
      ).toBe(100);
    });
  });

  describe('paginationReducer — never mix cursor styles in a session', () => {
    const keysetState: PaginationState = { ...base, page: 41, cursor: 'CURSOR41' };

    it('a sort change resets to offset page 1 and drops the cursor', () => {
      expect(
        paginationReducer(keysetState, { type: 'sort', sortBy: 'text', sortDir: 'asc' }),
      ).toEqual({ page: 1, pageSize: 25, sortBy: 'text', sortDir: 'asc' });
    });

    it('a pageSize change resets to offset page 1, clamps, and drops the cursor', () => {
      expect(
        paginationReducer(keysetState, { type: 'pageSize', requested: 500, max: 100 }),
      ).toEqual({ page: 1, pageSize: 100, sortBy: 'avgMonthlySearches', sortDir: 'desc' });
    });

    it('a filter reset returns to offset page 1 (sort preserved, cursor dropped)', () => {
      expect(paginationReducer(keysetState, { type: 'reset' })).toEqual({
        page: 1,
        pageSize: 25,
        sortBy: 'avgMonthlySearches',
        sortDir: 'desc',
      });
    });

    it('a goto jump lands on an offset page with no cursor', () => {
      expect(paginationReducer(keysetState, { type: 'goto', page: 5 })).toEqual({
        page: 5,
        pageSize: 25,
        sortBy: 'avgMonthlySearches',
        sortDir: 'desc',
      });
    });

    describe('next', () => {
      it('stays offset while the target is still within the cap', () => {
        expect(
          paginationReducer(
            { ...base, page: 2 },
            { type: 'next', nextCursor: 'IGNORED', offsetMaxPage: 40, sortStable: true },
          ),
        ).toEqual({ page: 3, pageSize: 25, sortBy: 'avgMonthlySearches', sortDir: 'desc' });
      });

      it('crosses offset→keyset at the cap, seeding the response cursor (C5 switch)', () => {
        expect(
          paginationReducer(
            { ...base, page: 40 },
            { type: 'next', nextCursor: 'CURSOR41', offsetMaxPage: 40, sortStable: true },
          ),
        ).toEqual({
          page: 41,
          pageSize: 25,
          cursor: 'CURSOR41',
          sortBy: 'avgMonthlySearches',
          sortDir: 'desc',
        });
      });

      it('does NOT cross when the sort is unstable — stays offset past the cap', () => {
        expect(
          paginationReducer(
            { ...base, page: 40 },
            { type: 'next', nextCursor: 'CURSOR41', offsetMaxPage: 40, sortStable: false },
          ),
        ).toEqual({ page: 41, pageSize: 25, sortBy: 'avgMonthlySearches', sortDir: 'desc' });
      });

      it('stays keyset once engaged, advancing the cursor', () => {
        expect(
          paginationReducer(keysetState, {
            type: 'next',
            nextCursor: 'CURSOR42',
            offsetMaxPage: 40,
            sortStable: true,
          }),
        ).toEqual({
          page: 42,
          pageSize: 25,
          cursor: 'CURSOR42',
          sortBy: 'avgMonthlySearches',
          sortDir: 'desc',
        });
      });

      it('is a no-op at the last keyset page (null next cursor)', () => {
        expect(
          paginationReducer(keysetState, {
            type: 'next',
            nextCursor: null,
            offsetMaxPage: 40,
            sortStable: true,
          }),
        ).toBe(keysetState);
      });
    });

    describe('prev', () => {
      it('is a no-op at page 1', () => {
        expect(
          paginationReducer(base, { type: 'prev', prevCursor: undefined, offsetMaxPage: 40 }),
        ).toBe(base);
      });

      it('re-enters offset (no cursor) when the target falls back within the cap', () => {
        expect(
          paginationReducer(keysetState, {
            type: 'prev',
            prevCursor: undefined,
            offsetMaxPage: 40,
          }),
        ).toEqual({ page: 40, pageSize: 25, sortBy: 'avgMonthlySearches', sortDir: 'desc' });
      });

      it('stays keyset for a deep prev using the session-history cursor', () => {
        expect(
          paginationReducer(
            { ...base, page: 43, cursor: 'CURSOR43' },
            { type: 'prev', prevCursor: 'CURSOR42', offsetMaxPage: 40 },
          ),
        ).toEqual({
          page: 42,
          pageSize: 25,
          cursor: 'CURSOR42',
          sortBy: 'avgMonthlySearches',
          sortDir: 'desc',
        });
      });

      it('is a no-op for a deep prev with no history cursor (e.g. cold-loaded link)', () => {
        const deep: PaginationState = { ...base, page: 43, cursor: 'CURSOR43' };
        expect(
          paginationReducer(deep, { type: 'prev', prevCursor: undefined, offsetMaxPage: 40 }),
        ).toBe(deep);
      });
    });
  });
});
