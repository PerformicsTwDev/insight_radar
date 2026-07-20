import { findUnsafeJsonNumberPath } from './json-number-safety';

/**
 * M13-R2 (#553): capture content-hash is computed over the **already-JSON.parsed** payload. JS numbers
 * are IEEE-754 doubles → any integer whose magnitude exceeds `Number.MAX_SAFE_INTEGER` (2^53-1) loses
 * precision on parse, so two distinct 64-bit ids sent as JSON numbers collapse to the same double →
 * same canonical string → same hash → S16 dedup drops a distinct capture (silent data loss).
 *
 * Contract (Design §18.2): capture item numeric values must not exceed `Number.MAX_SAFE_INTEGER`; large
 * ids must be sent as strings (Threads/IG/Twitter id convention). `findUnsafeJsonNumberPath` is the pure,
 * recursive detector that the ingest boundary uses to reject unsafe payloads with a precise path.
 *
 * NB: unsafe values are written as arithmetic on MAX_SAFE_INTEGER (not literals) so the source itself
 * carries no precision-losing constant — which is exactly the failure mode under test.
 */
const MAX = Number.MAX_SAFE_INTEGER; // 2^53 - 1 = 9007199254740991
const UNSAFE = MAX + 1; // 2^53 = 9007199254740992, the smallest value that violates the contract

describe('findUnsafeJsonNumberPath (M13-R2 / #553 · capture numeric-precision contract)', () => {
  it('documents the root cause: adjacent >2^53 integers collapse to the same double (precision loss)', () => {
    // MAX+1 and MAX+2 are mathematically distinct but round to the SAME IEEE-754 double.
    expect(MAX + 1 === MAX + 2).toBe(true);
    // Below the boundary, distinct integers round-trip exactly (no collision).
    expect(MAX - 1 === MAX).toBe(false);
  });

  describe('safe payloads → null (no unsafe number)', () => {
    it.each([
      ['MAX_SAFE_INTEGER itself', MAX],
      ['negative MAX_SAFE_INTEGER', -MAX],
      ['small integer', 42],
      ['zero', 0],
      ['fractional in range', 3.14159],
      ['small negative fractional', -0.5],
    ])('%s → null', (_label, value) => {
      expect(findUnsafeJsonNumberPath(value)).toBeNull();
    });

    it('non-number leaves → null', () => {
      expect(findUnsafeJsonNumberPath('9007199254740993')).toBeNull(); // large id as string = safe
      expect(findUnsafeJsonNumberPath(true)).toBeNull();
      expect(findUnsafeJsonNumberPath(null)).toBeNull();
    });

    it('nested object/array of safe values → null', () => {
      expect(
        findUnsafeJsonNumberPath({
          postId: '9007199254740993',
          likes: 1234,
          tags: ['a', 'b'],
          meta: { score: 0.98, nested: [{ x: 1 }] },
        }),
      ).toBeNull();
    });
  });

  describe('unsafe payloads → path of first offending number', () => {
    it('top-level unsafe integer (2^53) → its path', () => {
      expect(findUnsafeJsonNumberPath(UNSAFE)).toBe('$');
    });

    it('unsafe integer nested in object → dotted path', () => {
      expect(findUnsafeJsonNumberPath({ postId: UNSAFE })).toBe('$.postId');
    });

    it('unsafe integer nested in array → indexed path', () => {
      expect(findUnsafeJsonNumberPath({ ids: [12, UNSAFE] })).toBe('$.ids[1]');
    });

    it('deeply nested unsafe integer → full path', () => {
      expect(findUnsafeJsonNumberPath({ a: { b: [{ c: 2 ** 60 }] } })).toBe('$.a.b[0].c');
    });

    it('negative unsafe integer → path', () => {
      expect(findUnsafeJsonNumberPath({ n: -UNSAFE })).toBe('$.n');
    });

    it('returns the FIRST offending path (deterministic scan order)', () => {
      const hit = findUnsafeJsonNumberPath({ a: 1, b: UNSAFE, c: 2 ** 60 });
      expect(hit).toBe('$.b');
    });

    it('honours a custom base path prefix', () => {
      expect(findUnsafeJsonNumberPath(UNSAFE, 'items[3]')).toBe('items[3]');
    });
  });
});
