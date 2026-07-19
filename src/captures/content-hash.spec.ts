import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';
import { captureContentHash } from './content-hash';

// canonical 序列化本身（鍵序無關/陣列保序/undefined 略過）由 common/canonical-json.spec 覆蓋（單一 SSOT）；
// 此檔專驗 captureContentHash 以該序列化組出 S16 去重鍵。

describe('captureContentHash (S16 dedup key = sha256(canonical(source,schemaVersion,item)))', () => {
  const base = { source: 'extension', schemaVersion: 'v1', item: { q: 'a', r: 'b' } };

  it('is a 64-char hex sha256 digest', () => {
    expect(captureContentHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('equals sha256Hex(canonicalStringify([source, schemaVersion, item])) — shared SSOT, no parallel impl', () => {
    expect(captureContentHash(base)).toBe(
      sha256Hex(canonicalStringify([base.source, base.schemaVersion, base.item])),
    );
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
