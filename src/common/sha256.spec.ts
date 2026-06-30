import { createHash } from 'node:crypto';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('returns the lowercase hex sha256 of the input', () => {
    expect(sha256Hex('running shoes')).toBe(
      createHash('sha256').update('running shoes').digest('hex'),
    );
  });

  it('is deterministic and collision-distinct for different inputs', () => {
    expect(sha256Hex('a')).toBe(sha256Hex('a'));
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});
