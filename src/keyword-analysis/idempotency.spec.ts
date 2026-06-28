import { computeIdempotencyKey } from './idempotency';

describe('computeIdempotencyKey (T3.2, TC-10)', () => {
  const params = { geo: 'TW', language: 'zh-TW', mode: 'expand' };

  it('is stable: same input → same key', () => {
    expect(computeIdempotencyKey(['a', 'b'], params)).toBe(
      computeIdempotencyKey(['a', 'b'], params),
    );
  });

  it('is seed-order invariant', () => {
    expect(computeIdempotencyKey(['b', 'a'], params)).toBe(
      computeIdempotencyKey(['a', 'b'], params),
    );
  });

  it('normalizes seeds (case/whitespace) and dedups before hashing', () => {
    expect(computeIdempotencyKey(['  RUNNING   shoes ', 'running shoes'], params)).toBe(
      computeIdempotencyKey(['running shoes'], params),
    );
  });

  it('is param key-order invariant', () => {
    expect(computeIdempotencyKey(['a'], { mode: 'expand', language: 'zh-TW', geo: 'TW' })).toBe(
      computeIdempotencyKey(['a'], params),
    );
  });

  it('canonicalizes nested object params by key (order invariant, value preserved)', () => {
    const left = computeIdempotencyKey(['a'], {
      nested: { y: 2, x: 1 },
      list: [1, 2],
    });
    const right = computeIdempotencyKey(['a'], {
      list: [1, 2],
      nested: { x: 1, y: 2 },
    });
    expect(left).toBe(right);
  });

  it('respects array order (semantically significant) in params', () => {
    expect(computeIdempotencyKey(['a'], { list: [1, 2] })).not.toBe(
      computeIdempotencyKey(['a'], { list: [2, 1] }),
    );
  });

  it('differs when a scalar param value changes', () => {
    expect(computeIdempotencyKey(['a'], { ...params, geo: 'US' })).not.toBe(
      computeIdempotencyKey(['a'], params),
    );
  });

  it('handles null param values without throwing', () => {
    expect(computeIdempotencyKey(['a'], { network: null })).toBe(
      computeIdempotencyKey(['a'], { network: null }),
    );
  });

  it('returns a sha256 hex string', () => {
    expect(computeIdempotencyKey(['a'], params)).toMatch(/^[0-9a-f]{64}$/);
  });
});
