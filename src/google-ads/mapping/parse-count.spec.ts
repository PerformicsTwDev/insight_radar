import { parseCount } from './parse-count';

describe('parseCount (M1-R2: int64-as-string count, null≠0)', () => {
  it('parses numeric strings and numbers', () => {
    expect(parseCount('110000')).toBe(110000);
    expect(parseCount(110000)).toBe(110000);
    expect(parseCount('0')).toBe(0);
    expect(parseCount(0)).toBe(0);
  });

  it('maps missing / blank / non-finite to null (never 0, never NaN)', () => {
    expect(parseCount(null)).toBeNull();
    expect(parseCount(undefined)).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(parseCount('   ')).toBeNull();
    expect(parseCount('abc')).toBeNull();
    expect(parseCount(Number.NaN)).toBeNull();
  });
});
