import { computeTopicIdempotencyKey } from './topic-idempotency';

describe('computeTopicIdempotencyKey (T8.9 / TC-46 · M8-R7)', () => {
  const params = { serpEnabled: false, topK: 20, promptVersion: 'v1', schemaVersion: 'v1' };

  it('is stable for the same analysisId + checksum + params', () => {
    expect(computeTopicIdempotencyKey('a1', 'abc', params)).toBe(
      computeTopicIdempotencyKey('a1', 'abc', params),
    );
  });

  it('is independent of param key order (canonical JSON)', () => {
    const reordered = { schemaVersion: 'v1', promptVersion: 'v1', topK: 20, serpEnabled: false };
    expect(computeTopicIdempotencyKey('a1', 'abc', params)).toBe(
      computeTopicIdempotencyKey('a1', 'abc', reordered),
    );
  });

  it('differs when the analysisId differs even with identical checksum + params (M8-R7 scope)', () => {
    // 兩個內容位元相同的**不同分析** → 必得不同 key（否則後者複用前者 run、GET 永遠 404）。
    expect(computeTopicIdempotencyKey('analysis-A', 'abc', params)).not.toBe(
      computeTopicIdempotencyKey('analysis-B', 'abc', params),
    );
  });

  it('differs when the snapshot checksum differs (bound to a specific snapshot)', () => {
    expect(computeTopicIdempotencyKey('a1', 'abc', params)).not.toBe(
      computeTopicIdempotencyKey('a1', 'xyz', params),
    );
  });

  it('differs when params differ (e.g. prompt/schema version bump → allow re-run)', () => {
    expect(computeTopicIdempotencyKey('a1', 'abc', params)).not.toBe(
      computeTopicIdempotencyKey('a1', 'abc', { ...params, promptVersion: 'v2' }),
    );
  });

  it('canonicalizes nested objects but preserves array order', () => {
    const a = { umap: { n_neighbors: 15, metric: 'cosine' } };
    const b = { umap: { metric: 'cosine', n_neighbors: 15 } };
    expect(computeTopicIdempotencyKey('a1', 'c', a)).toBe(computeTopicIdempotencyKey('a1', 'c', b));

    const arr1 = { seeds: ['a', 'b'] };
    const arr2 = { seeds: ['b', 'a'] };
    expect(computeTopicIdempotencyKey('a1', 'c', arr1)).not.toBe(
      computeTopicIdempotencyKey('a1', 'c', arr2),
    );
  });

  it('returns a 64-char sha256 hex', () => {
    expect(computeTopicIdempotencyKey('a1', 'abc', params)).toMatch(/^[0-9a-f]{64}$/);
  });
});
