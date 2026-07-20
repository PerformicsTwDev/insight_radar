import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';
import { captureContentHash } from './content-hash';

// canonical 序列化本身（鍵序無關/陣列保序/undefined 略過）由 common/canonical-json.spec 覆蓋（單一 SSOT）；
// 此檔專驗 captureContentHash 以該序列化組出 S16 去重鍵（owner-scoped，M13-R1/#552）。

describe('captureContentHash (S16 owner-scoped dedup key = sha256(canonical(ownerId?,source,schemaVersion,item)))', () => {
  const base = {
    ownerId: 'owner-a' as string | null,
    source: 'extension',
    schemaVersion: 'v1',
    item: { q: 'a', r: 'b' },
  };

  it('is a 64-char hex sha256 digest', () => {
    expect(captureContentHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('equals sha256Hex(canonicalStringify({owner,source,schemaVersion,item})) — shared SSOT, no parallel impl', () => {
    expect(captureContentHash(base)).toBe(
      sha256Hex(
        canonicalStringify({
          owner: base.ownerId,
          source: base.source,
          schemaVersion: base.schemaVersion,
          item: base.item,
        }),
      ),
    );
  });

  it('is deterministic and key-order-independent (same content+owner → same hash)', () => {
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

  // M13-R1/#552：owner 分範圍——不同 session owner 送位元相同內容 → 不同 hash（各落自己一列、各回自己 id，
  // 杜絕跨租戶 ON CONFLICT DO NOTHING 回不可讀 id/丟列）。
  it('differs when ownerId differs, even for byte-identical (source,schemaVersion,item) (#552 cross-tenant)', () => {
    const a = captureContentHash({ ...base, ownerId: 'owner-a' });
    const b = captureContentHash({ ...base, ownerId: 'owner-b' });
    expect(a).not.toBe(b);
  });

  it('session owner hash differs from machine null-owner hash for identical content (#552)', () => {
    const session = captureContentHash({ ...base, ownerId: 'owner-a' });
    const machine = captureContentHash({ ...base, ownerId: null });
    expect(session).not.toBe(machine);
  });

  // 機器 x-api-key null-owner 之間仍全域去重（S12b line 1863 同型）：兩 null-owner 同內容 → 同 hash。
  it('two null-owner (machine) requests of identical content → same hash (global dedup, S12b)', () => {
    const first = captureContentHash({ ...base, ownerId: null });
    const second = captureContentHash({ ...base, ownerId: null, item: { r: 'b', q: 'a' } });
    expect(first).toBe(second);
  });
});
