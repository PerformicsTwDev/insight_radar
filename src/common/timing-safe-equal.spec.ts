import { timingSafeEqualStr } from './timing-safe-equal';

describe('timingSafeEqualStr', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqualStr('test-api-key', 'test-api-key')).toBe(true);
  });

  it('returns false for same-length but different strings', () => {
    expect(timingSafeEqualStr('aaaa', 'bbbb')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeEqualStr('short', 'a-much-longer-value')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timingSafeEqualStr('', '')).toBe(true);
    expect(timingSafeEqualStr('', 'x')).toBe(false);
  });
});
