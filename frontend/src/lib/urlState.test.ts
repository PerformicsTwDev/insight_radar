import { deserialize, serialize, KNOWN_VIEWS, type AppSearch } from './urlState';

// TC-11 (FR-1, Design §5 "URL 即狀態"): URL search-params ↔ typed AppSearch
// serialization round-trip; unknown view / malformed analysisId normalise to a
// not-found (undefined) state instead of throwing.
describe('TC-11 · urlState (URL 即狀態序列化)', () => {
  const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  describe('round-trip: deserialize(serialize(s)) deep-equals s', () => {
    it('preserves a fully-populated valid state', () => {
      const s: AppSearch = {
        analysisId: UUID,
        view: 'trend',
        page: 2,
        pageSize: 25,
        cursor: 'eyJpZCI6MTIzfQ',
        filters: 'volume:gte:100',
      };
      expect(deserialize(serialize(s))).toEqual(s);
    });

    it('preserves an analysisId-only state', () => {
      const s: AppSearch = { analysisId: UUID };
      expect(deserialize(serialize(s))).toEqual(s);
    });

    it('preserves a view-only state', () => {
      const s: AppSearch = { view: 'keywords' };
      expect(deserialize(serialize(s))).toEqual(s);
    });

    it('preserves a pagination-only state', () => {
      const s: AppSearch = { page: 5, pageSize: 50 };
      expect(deserialize(serialize(s))).toEqual(s);
    });

    it('preserves a keyset (cursor) pagination state', () => {
      const s: AppSearch = { view: 'keywords', cursor: 'abc123' };
      expect(deserialize(serialize(s))).toEqual(s);
    });

    it('round-trips the empty state', () => {
      expect(deserialize(serialize({}))).toEqual({});
    });

    it('round-trips every known view', () => {
      for (const view of KNOWN_VIEWS) {
        expect(deserialize(serialize({ view }))).toEqual({ view });
      }
    });
  });

  describe('serialize', () => {
    it('omits undefined fields (no empty params in the URL)', () => {
      expect(serialize({ view: 'trend' })).toEqual({ view: 'trend' });
    });

    it('stringifies numeric pagination', () => {
      expect(serialize({ page: 3, pageSize: 100 })).toEqual({ page: '3', pageSize: '100' });
    });
  });

  describe('deserialize normalises invalid input (never throws)', () => {
    it('normalises an unknown view to undefined, keeping the rest', () => {
      const result = deserialize({ view: 'bogus-view', analysisId: UUID });
      expect(result.view).toBeUndefined();
      expect(result.analysisId).toBe(UUID);
    });

    it('normalises a malformed analysisId to undefined (not-found), keeping the rest', () => {
      const result = deserialize({ analysisId: 'not-a-uuid', view: 'trend' });
      expect(result.analysisId).toBeUndefined();
      expect(result.view).toBe('trend');
    });

    it('drops a non-numeric / non-positive page', () => {
      expect(deserialize({ page: 'abc' }).page).toBeUndefined();
      expect(deserialize({ page: '0' }).page).toBeUndefined();
      expect(deserialize({ page: '-4' }).page).toBeUndefined();
    });

    it('coerces string-number params back to numbers', () => {
      expect(deserialize({ page: '2', pageSize: '25' })).toEqual({ page: 2, pageSize: 25 });
    });

    it('returns an empty state for empty / junk-only input without throwing', () => {
      expect(() => deserialize({})).not.toThrow();
      expect(deserialize({})).toEqual({});
      expect(deserialize({ unknownKey: 'x' })).toEqual({});
    });
  });
});
