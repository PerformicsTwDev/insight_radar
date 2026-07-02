import { l2normalize } from './l2-normalize';

describe('l2normalize (T8.2b)', () => {
  it('scales a non-unit vector to unit length', () => {
    const out = l2normalize([3, 4]); // norm 5
    expect(out).toEqual([0.6, 0.8]);
  });

  it('leaves an already-unit vector effectively unchanged', () => {
    const out = l2normalize([1, 0, 0]);
    expect(out).toEqual([1, 0, 0]);
  });

  it('returns a zero vector unchanged (no divide-by-zero → NaN)', () => {
    const out = l2normalize([0, 0, 0]);
    expect(out).toEqual([0, 0, 0]);
  });
});
