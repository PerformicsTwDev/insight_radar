import { computeIdempotencyKey } from './idempotency';

describe('computeIdempotencyKey (T3.2, TC-10)', () => {
  const params = { geo: 'TW', language: 'zh-TW', mode: 'expand' };
  // 既有 canonicalization 斷言固定同一 owner scope（比較兩次呼叫，owner 不變 → 只驗 seeds/params 語意）。
  const OWNER = 'owner-1';

  it('is stable: same input → same key', () => {
    expect(computeIdempotencyKey(['a', 'b'], params, OWNER)).toBe(
      computeIdempotencyKey(['a', 'b'], params, OWNER),
    );
  });

  it('is seed-order invariant', () => {
    expect(computeIdempotencyKey(['b', 'a'], params, OWNER)).toBe(
      computeIdempotencyKey(['a', 'b'], params, OWNER),
    );
  });

  it('normalizes seeds (case/whitespace) and dedups before hashing', () => {
    expect(computeIdempotencyKey(['  RUNNING   shoes ', 'running shoes'], params, OWNER)).toBe(
      computeIdempotencyKey(['running shoes'], params, OWNER),
    );
  });

  it('is param key-order invariant', () => {
    expect(
      computeIdempotencyKey(['a'], { mode: 'expand', language: 'zh-TW', geo: 'TW' }, OWNER),
    ).toBe(computeIdempotencyKey(['a'], params, OWNER));
  });

  it('canonicalizes nested object params by key (order invariant, value preserved)', () => {
    const left = computeIdempotencyKey(
      ['a'],
      {
        nested: { y: 2, x: 1 },
        list: [1, 2],
      },
      OWNER,
    );
    const right = computeIdempotencyKey(
      ['a'],
      {
        list: [1, 2],
        nested: { x: 1, y: 2 },
      },
      OWNER,
    );
    expect(left).toBe(right);
  });

  it('respects array order (semantically significant) in params', () => {
    expect(computeIdempotencyKey(['a'], { list: [1, 2] }, OWNER)).not.toBe(
      computeIdempotencyKey(['a'], { list: [2, 1] }, OWNER),
    );
  });

  it('differs when a scalar param value changes', () => {
    expect(computeIdempotencyKey(['a'], { ...params, geo: 'US' }, OWNER)).not.toBe(
      computeIdempotencyKey(['a'], params, OWNER),
    );
  });

  it('handles null param values without throwing', () => {
    expect(computeIdempotencyKey(['a'], { network: null }, OWNER)).toBe(
      computeIdempotencyKey(['a'], { network: null }, OWNER),
    );
  });

  it('returns a sha256 hex string', () => {
    expect(computeIdempotencyKey(['a'], params, OWNER)).toMatch(/^[0-9a-f]{64}$/);
  });

  // owner 分範圍（AC-1.4/#358）：owner scope 是 key 的一等維度。
  describe('owner scope (AC-1.4, 358)', () => {
    it('produces DIFFERENT keys for different session owners (identical seeds+params)', () => {
      expect(computeIdempotencyKey(['a'], params, 'owner-A')).not.toBe(
        computeIdempotencyKey(['a'], params, 'owner-B'),
      );
    });

    it('produces the SAME key for the same session owner', () => {
      expect(computeIdempotencyKey(['a'], params, 'owner-A')).toBe(
        computeIdempotencyKey(['a'], params, 'owner-A'),
      );
    });

    it('treats machine (null) scope as a stable shared scope, distinct from any session owner', () => {
      expect(computeIdempotencyKey(['a'], params, null)).toBe(
        computeIdempotencyKey(['a'], params, null),
      );
      expect(computeIdempotencyKey(['a'], params, null)).not.toBe(
        computeIdempotencyKey(['a'], params, 'owner-A'),
      );
    });
  });
});
