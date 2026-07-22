import { createHash } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { cacheConfig } from '../config/cache.config';
import { CustomClassifyAssignCache } from './custom-classify-assign-cache';
import type { AssignedKeyword } from './custom-classify-assign-postprocess';

const TTL_MS = 5_184_000_000;
const CID = 'cid-1';
const LH = 'lh-1'; // labelsHash (label + description); isolates HITL edits in the key
const LABELS = new Set(['transactional', 'informational']);

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
function keyFor(nt: string, labelsHash = LH, ver = 'v1'): string {
  return `custom_classify:${ver}:${CID}:${labelsHash}:${sha(nt)}`;
}

interface SetCall {
  key: string;
  value: unknown;
  ttlMs?: number;
}

function build(
  opts: { store?: Map<string, unknown>; failRead?: boolean; failWrite?: boolean } = {},
) {
  const store = opts.store ?? new Map<string, unknown>();
  const setCalls: SetCall[] = [];
  const set = jest.fn(<T>(key: string, value: T, ttlMs?: number): Promise<void> => {
    if (opts.failWrite) {
      return Promise.reject(new Error('redis down'));
    }
    store.set(key, value);
    setCalls.push({ key, value, ttlMs });
    return Promise.resolve();
  });
  const mget = jest.fn(<T>(keys: string[]): Promise<(T | undefined)[]> =>
    opts.failRead
      ? Promise.reject(new Error('redis down'))
      : Promise.resolve(keys.map((k) => (store.has(k) ? (store.get(k) as T) : undefined))),
  );
  const cache = {
    buildKey: (namespace: string, ...parts: (string | number)[]) => [namespace, ...parts].join(':'),
    mget,
    set,
  } as unknown as CacheService;
  const config: ConfigType<typeof cacheConfig> = {
    metricsTtlMs: 1,
    intentTtlMs: 1,
    intentSchemaVersion: 'v1',
    aiInsightSchemaVersion: 'v1',
    aiInsightTtlMs: 1,
    aiInsightMaxRows: 200,
    aiSummarySchemaVersion: 'v1',
    aiSummaryTtlMs: 1,
    aiSummaryMaxTokens: 800,
    journeySchemaVersion: 'v1',
    journeyTtlMs: 1,
    customClassifySchemaVersion: 'v1',
    customClassifyTtlMs: TTL_MS,
  };
  const assignCache = new CustomClassifyAssignCache(cache, config);
  return { assignCache, mget, set, setCalls, store };
}

describe('CustomClassifyAssignCache (T12.8 / FR-34 / AC-34.2)', () => {
  describe('mget', () => {
    it('returns [] without touching Redis for empty input', async () => {
      const { assignCache, mget } = build();
      expect(await assignCache.mget(CID, LH, [], LABELS)).toEqual([]);
      expect(mget).not.toHaveBeenCalled();
    });

    it('returns a cached label when it is still in the confirmed set', async () => {
      const store = new Map<string, unknown>([[keyFor('buy shoes'), 'transactional']]);
      const { assignCache } = build({ store });
      expect(await assignCache.mget(CID, LH, ['buy shoes'], LABELS)).toEqual(['transactional']);
    });

    it('treats a cached label no longer in the confirmed set as a miss (defensive membership check)', async () => {
      const store = new Map<string, unknown>([[keyFor('x'), 'removed_label']]);
      const { assignCache } = build({ store });
      expect(await assignCache.mget(CID, LH, ['x'], LABELS)).toEqual([undefined]);
    });

    it('does NOT serve a value cached under a different labelsHash (coherency: HITL edit incl. description-only)', async () => {
      // same label TEXT still confirmed, but the taxonomy changed (e.g. a description edit) → new labelsHash.
      // The value was cached under the OLD labelsHash; a read under the NEW labelsHash must MISS, not reuse a
      // verdict computed under stale classification guidance (reviewer #490 blocking finding).
      const store = new Map<string, unknown>([[keyFor('buy shoes', 'OLD-hash'), 'transactional']]);
      const { assignCache } = build({ store });
      expect(await assignCache.mget(CID, 'NEW-hash', ['buy shoes'], LABELS)).toEqual([undefined]);
      // sanity: reading under the SAME (old) hash would have hit.
      expect(await assignCache.mget(CID, 'OLD-hash', ['buy shoes'], LABELS)).toEqual([
        'transactional',
      ]);
    });

    it('returns undefined for a miss', async () => {
      const { assignCache } = build();
      expect(await assignCache.mget(CID, LH, ['never'], LABELS)).toEqual([undefined]);
    });

    it('degrades a read error to all-miss (best-effort, does not throw)', async () => {
      const { assignCache } = build({ failRead: true });
      expect(await assignCache.mget(CID, LH, ['a', 'b'], LABELS)).toEqual([undefined, undefined]);
    });

    it('keys by (namespace, ver, cid, labelsHash, sha256(normalizedText)) — normalized before hashing', async () => {
      const store = new Map<string, unknown>([[keyFor('buy shoes'), 'transactional']]);
      const { assignCache } = build({ store });
      // 'Buy  SHOES' normalizes to 'buy shoes' → same key → hit.
      expect(await assignCache.mget(CID, LH, ['Buy  SHOES'], LABELS)).toEqual(['transactional']);
    });
  });

  describe('mset', () => {
    it('writes only confirmed-set labels with the custom-classify TTL', async () => {
      const { assignCache, setCalls } = build();
      const entries: AssignedKeyword[] = [
        { keyword: 'buy shoes', label: 'transactional' },
        { keyword: 'review', label: 'informational' },
      ];
      await assignCache.mset(CID, LH, entries, LABELS);
      expect(setCalls).toHaveLength(2);
      expect(setCalls.every((c) => c.ttlMs === TTL_MS)).toBe(true);
      expect(setCalls.map((c) => c.value).sort()).toEqual(['informational', 'transactional']);
    });

    it('never caches the unclassified sentinel or a removed label', async () => {
      const { assignCache, setCalls } = build();
      const entries: AssignedKeyword[] = [
        { keyword: 'a', label: 'unclassified' },
        { keyword: 'b', label: 'removed_label' },
        { keyword: 'c', label: 'transactional' },
      ];
      await assignCache.mset(CID, LH, entries, LABELS);
      expect(setCalls.map((c) => c.value)).toEqual(['transactional']); // only the confirmed one
    });

    it('does not throw when the write fails (best-effort writeback)', async () => {
      const { assignCache } = build({ failWrite: true });
      await expect(
        assignCache.mset(CID, LH, [{ keyword: 'a', label: 'transactional' }], LABELS),
      ).resolves.toBeUndefined();
    });
  });
});
