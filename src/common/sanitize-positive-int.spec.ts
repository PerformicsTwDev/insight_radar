import { sanitizePositiveInt } from './sanitize-positive-int';

describe('sanitizePositiveInt (M12-C5)', () => {
  it('floors a valid positive number', () => {
    expect(sanitizePositiveInt(4.9, 5)).toBe(4);
    expect(sanitizePositiveInt(1, 5)).toBe(1);
  });

  it('falls back when value is undefined', () => {
    expect(sanitizePositiveInt(undefined, 5)).toBe(5);
  });

  it('falls back for zero / negative / non-finite (avoids 0 concurrency / infinite loops)', () => {
    expect(sanitizePositiveInt(0, 5)).toBe(5);
    expect(sanitizePositiveInt(0.4, 5)).toBe(5); // floors to 0 → fallback
    expect(sanitizePositiveInt(-3, 5)).toBe(5);
    expect(sanitizePositiveInt(Number.NaN, 5)).toBe(5);
    expect(sanitizePositiveInt(Number.POSITIVE_INFINITY, 5)).toBe(5);
  });
});
