import { computeTopicIdempotencyKey } from './topic-idempotency';

describe('computeTopicIdempotencyKey (T8.9 / TC-46)', () => {
  const params = { serpEnabled: false, topK: 20, promptVersion: 'v1', schemaVersion: 'v1' };

  it('is stable for the same checksum + params', () => {
    expect(computeTopicIdempotencyKey('abc', params)).toBe(
      computeTopicIdempotencyKey('abc', params),
    );
  });

  it('is independent of param key order (canonical JSON)', () => {
    const reordered = { schemaVersion: 'v1', promptVersion: 'v1', topK: 20, serpEnabled: false };
    expect(computeTopicIdempotencyKey('abc', params)).toBe(
      computeTopicIdempotencyKey('abc', reordered),
    );
  });

  it('differs when the snapshot checksum differs (bound to a specific snapshot)', () => {
    expect(computeTopicIdempotencyKey('abc', params)).not.toBe(
      computeTopicIdempotencyKey('xyz', params),
    );
  });

  it('differs when params differ (e.g. prompt/schema version bump → allow re-run)', () => {
    expect(computeTopicIdempotencyKey('abc', params)).not.toBe(
      computeTopicIdempotencyKey('abc', { ...params, promptVersion: 'v2' }),
    );
  });

  it('canonicalizes nested objects but preserves array order', () => {
    const a = { umap: { n_neighbors: 15, metric: 'cosine' } };
    const b = { umap: { metric: 'cosine', n_neighbors: 15 } };
    expect(computeTopicIdempotencyKey('c', a)).toBe(computeTopicIdempotencyKey('c', b));

    const arr1 = { seeds: ['a', 'b'] };
    const arr2 = { seeds: ['b', 'a'] };
    expect(computeTopicIdempotencyKey('c', arr1)).not.toBe(computeTopicIdempotencyKey('c', arr2));
  });

  it('returns a 64-char sha256 hex', () => {
    expect(computeTopicIdempotencyKey('abc', params)).toMatch(/^[0-9a-f]{64}$/);
  });
});
