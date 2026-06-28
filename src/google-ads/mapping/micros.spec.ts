import { microsToAmount } from './micros';

describe('microsToAmount (TC-3)', () => {
  it('divides micros by 1,000,000', () => {
    expect(microsToAmount('2500000')).toBe(2.5);
    expect(microsToAmount(2500000)).toBe(2.5);
    expect(microsToAmount('1000000')).toBe(1);
  });

  it('returns null for null / undefined (never 0)', () => {
    expect(microsToAmount(null)).toBeNull();
    expect(microsToAmount(undefined)).toBeNull();
  });

  it('keeps cents precise without float drift', () => {
    // 1,230,000 micros = 1.23 — must not surface as 1.2299999999999998
    expect(microsToAmount('1230000')).toBe(1.23);
    expect(microsToAmount('10')).toBe(0.00001);
  });

  it('handles large bigint-as-string micros', () => {
    expect(microsToAmount('123456789000000')).toBe(123456789);
  });

  it('treats 0 micros as 0 (a real value, distinct from null)', () => {
    expect(microsToAmount('0')).toBe(0);
    expect(microsToAmount(0)).toBe(0);
  });

  it('treats empty / whitespace micros as null (never 0 — guards the null≠0 single-point)', () => {
    expect(microsToAmount('')).toBeNull();
    expect(microsToAmount('   ')).toBeNull();
  });
});
