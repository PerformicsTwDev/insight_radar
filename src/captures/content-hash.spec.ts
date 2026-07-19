import { canonicalJson, captureContentHash } from './content-hash';

describe('canonicalJson (S16 canonical serialization)', () => {
  it('sorts object keys recursively (key order irrelevant → same output)', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it('preserves array order (semantically significant)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('skips undefined properties (JSON convention) and keeps null/primitives', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 'x' })).toBe('{"b":null,"c":"x"}');
    expect(canonicalJson('plain')).toBe('"plain"');
    expect(canonicalJson(42)).toBe('42');
  });
});

describe('captureContentHash (S16 dedup key = sha256(canonical(source,schemaVersion,item)))', () => {
  const base = { source: 'extension', schemaVersion: 'v1', item: { q: 'a', r: 'b' } };

  it('is a 64-char hex sha256 digest', () => {
    expect(captureContentHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and key-order-independent (same content → same hash)', () => {
    const reordered = { ...base, item: { r: 'b', q: 'a' } };
    expect(captureContentHash(reordered)).toBe(captureContentHash(base));
  });

  it('differs when source, schemaVersion, or item content differ', () => {
    expect(captureContentHash({ ...base, source: 'serpapi' })).not.toBe(captureContentHash(base));
    expect(captureContentHash({ ...base, schemaVersion: 'v2' })).not.toBe(captureContentHash(base));
    expect(captureContentHash({ ...base, item: { q: 'a', r: 'c' } })).not.toBe(
      captureContentHash(base),
    );
  });
});
