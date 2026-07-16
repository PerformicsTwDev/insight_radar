import { canonicalStringify, canonicalize } from './canonical-json';

describe('canonical-json (S9 SSOT canonical serialization)', () => {
  it('produces the same string regardless of object key order', () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });

  it('sorts nested object keys too (deep, recursive)', () => {
    const left = canonicalStringify({ z: { d: 4, c: 3 }, a: 1 });
    const right = canonicalStringify({ a: 1, z: { c: 3, d: 4 } });
    expect(left).toBe(right);
    expect(left).toBe('{"a":1,"z":{"c":3,"d":4}}');
  });

  it('preserves array order (arrays carry ordered semantics; not sorted)', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalStringify({ xs: ['b', 'a'] })).not.toBe(canonicalStringify({ xs: ['a', 'b'] }));
  });

  it('passes scalars and null through unchanged', () => {
    expect(canonicalize(1)).toBe(1);
    expect(canonicalize('x')).toBe('x');
    expect(canonicalize(null)).toBeNull();
    expect(canonicalStringify(null)).toBe('null');
  });

  it('sorts keys inside array elements (canonicalize maps into arrays)', () => {
    expect(canonicalStringify([{ b: 2, a: 1 }])).toBe('[{"a":1,"b":2}]');
  });
});
