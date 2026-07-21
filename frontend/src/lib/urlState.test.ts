import { deserialize, serialize, type AppSearch } from './urlState';

// TC-11 / TC-37 (FR-1, AC-1.2, Design §5 "URL 即狀態"): URL search-params ↔ typed
// AppSearch round-trip. `view` is any non-empty string — the authoritative set is
// backend view-metadata driven (T3.1, GET /views), so the URL codec must NOT
// hardcode a view allowlist; unknown-view→not-found is a runtime/registry concern
// (T3.3). Only a malformed (empty / non-string) view, or a malformed analysisId,
// normalises to undefined. Never throws.
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
        geo: 'TW',
        language: 'zh-TW',
      };
      expect(deserialize(serialize(s))).toEqual(s);
    });

    it('preserves the analysis (geo, language) context (FR-19 selection seed)', () => {
      const s: AppSearch = { analysisId: UUID, view: 'keywords', geo: 'US', language: 'en' };
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

    it('preserves a sort state (shared T2.6 schema)', () => {
      const s: AppSearch = { view: 'keywords', sortBy: 'text', sortDir: 'asc' };
      expect(deserialize(serialize(s))).toEqual(s);
    });

    it('round-trips the empty state', () => {
      expect(deserialize(serialize({}))).toEqual({});
    });

    it('round-trips real metadata-driven view names, incl. ones the retired static allowlist dropped (AC-1.2)', () => {
      for (const view of [
        'keywords',
        'trend',
        'intent_distribution',
        'cpc_histogram',
        'intent_topics', // AC-1.1 example — the retired KNOWN_VIEWS wrongly dropped this
        'serp_questions',
        'custom:42', // dynamic custom-classification view (M5)
      ]) {
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
    it('preserves any non-empty view string for the registry to resolve (AC-1.2); only malformed → undefined', () => {
      // A real, currently-registered view the retired static allowlist wrongly dropped
      // (AC-1.1 uses `view=intent_topics`) is now kept — the registry resolves validity.
      expect(deserialize({ view: 'intent_topics', analysisId: UUID })).toEqual({
        view: 'intent_topics',
        analysisId: UUID,
      });
      // The URL layer no longer hardcodes a view allowlist; it only rejects a
      // malformed (empty / non-string) value.
      expect(deserialize({ view: '' }).view).toBeUndefined();
      expect(deserialize({ view: 42 }).view).toBeUndefined();
    });

    it('normalises a malformed analysisId to undefined (not-found), keeping the rest', () => {
      const result = deserialize({ analysisId: 'not-a-uuid', view: 'trend' });
      expect(result.analysisId).toBeUndefined();
      expect(result.view).toBe('trend');
    });

    it('drops an empty geo / language (absent context ≠ empty-string filter)', () => {
      expect(deserialize({ geo: '', language: '' })).toEqual({});
      expect(deserialize({ geo: 'TW', language: 'zh-TW' })).toEqual({
        geo: 'TW',
        language: 'zh-TW',
      });
    });

    it('drops a non-numeric / non-positive page', () => {
      expect(deserialize({ page: 'abc' }).page).toBeUndefined();
      expect(deserialize({ page: '0' }).page).toBeUndefined();
      expect(deserialize({ page: '-4' }).page).toBeUndefined();
    });

    it('coerces string-number params back to numbers', () => {
      expect(deserialize({ page: '2', pageSize: '25' })).toEqual({ page: 2, pageSize: 25 });
    });

    it('normalises an unknown sortBy / sortDir to undefined (server default sort)', () => {
      const result = deserialize({ sortBy: 'bogusCol', sortDir: 'sideways', page: '2' });
      expect(result.sortBy).toBeUndefined();
      expect(result.sortDir).toBeUndefined();
      expect(result.page).toBe(2);
    });

    it('returns an empty state for empty / junk-only input without throwing', () => {
      expect(() => deserialize({})).not.toThrow();
      expect(deserialize({})).toEqual({});
      expect(deserialize({ unknownKey: 'x' })).toEqual({});
    });

    it('never throws even for non-object input (null / number / array / string)', () => {
      for (const bad of [null, undefined, 42, 'x', [], true]) {
        expect(() => deserialize(bad)).not.toThrow();
        expect(deserialize(bad)).toEqual({});
      }
    });
  });
});
