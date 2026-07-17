import { createHash } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { cacheConfig } from '../config/cache.config';
import { JourneyCache } from './journey-cache';
import type { StagedKeyword } from './journey-postprocess';

const TTL_MS = 5_184_000_000;
const DEPLOYMENT = 'gpt-4o-mini';

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function keyFor(nt: string, ver = 'v1'): string {
  return `journey:${ver}:${DEPLOYMENT}:${sha(nt)}`;
}

interface SetCall {
  key: string;
  value: unknown;
  ttlMs?: number;
}

function build(opts: { schemaVersion?: string; store?: Map<string, unknown> } = {}) {
  const store = opts.store ?? new Map<string, unknown>();
  const setCalls: SetCall[] = [];
  const set = jest.fn(<T>(key: string, value: T, ttlMs?: number): Promise<void> => {
    store.set(key, value);
    setCalls.push({ key, value, ttlMs });
    return Promise.resolve();
  });
  const mget = jest.fn(<T>(keys: string[]): Promise<(T | undefined)[]> =>
    Promise.resolve(keys.map((k) => (store.has(k) ? (store.get(k) as T) : undefined))),
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
    journeySchemaVersion: opts.schemaVersion ?? 'v1',
    journeyTtlMs: TTL_MS,
    customClassifySchemaVersion: 'v1',
    customClassifyTtlMs: 1,
  };
  const journeyCache = new JourneyCache(cache, config, DEPLOYMENT);
  return { journeyCache, cache, mget, set, setCalls, store };
}

describe('JourneyCache (T12.5 / FR-33 / AC-33.3)', () => {
  describe('mget', () => {
    it('returns [] without touching Redis for empty input', async () => {
      const { journeyCache, mget } = build();
      expect(await journeyCache.mget([])).toEqual([]);
      expect(mget).not.toHaveBeenCalled();
    });

    it('reads by journey:v{ver}:{dep}:sha256(normalizedText); case/space-insensitive key', async () => {
      const store = new Map<string, unknown>([[keyFor('coffee'), 'final_decision']]);
      const { journeyCache, mget } = build({ store });
      const out = await journeyCache.mget(['  COFFEE ']);
      expect(out).toEqual(['final_decision']);
      expect(mget).toHaveBeenCalledWith([keyFor('coffee')]);
    });

    it('returns undefined for a miss', async () => {
      const { journeyCache } = build();
      expect(await journeyCache.mget(['unknown'])).toEqual([undefined]);
    });

    it('treats a stale / invalid cached value as a miss (cleanStage null → undefined)', async () => {
      const store = new Map<string, unknown>([[keyFor('x'), 'not_a_stage']]);
      const { journeyCache } = build({ store });
      expect(await journeyCache.mget(['x'])).toEqual([undefined]);
    });

    it('bumping the schema version misses old keys (namespace isolation)', async () => {
      const store = new Map<string, unknown>([[keyFor('coffee', 'v1'), 'final_decision']]);
      const { journeyCache } = build({ store, schemaVersion: 'v2' });
      expect(await journeyCache.mget(['coffee'])).toEqual([undefined]);
    });

    it('best-effort read: a Redis error degrades to all-miss (no throw)', async () => {
      const { journeyCache, cache } = build();
      (cache.mget as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
      expect(await journeyCache.mget(['a', 'b'])).toEqual([undefined, undefined]);
    });
  });

  describe('mset', () => {
    it('writes valid stages to Redis keyed by normalizedText, with the journey TTL', async () => {
      const { journeyCache, setCalls } = build();
      const entries: StagedKeyword[] = [{ keyword: ' Coffee ', stage: 'final_decision' }];
      await journeyCache.mset(entries);
      expect(setCalls).toEqual([{ key: keyFor('coffee'), value: 'final_decision', ttlMs: TTL_MS }]);
    });

    it('does NOT cache an invalid stage (cleanStage null → skipped)', async () => {
      const { journeyCache, set } = build();
      await journeyCache.mset([{ keyword: 'x', stage: 'bogus' as StagedKeyword['stage'] }]);
      expect(set).not.toHaveBeenCalled();
    });

    it('is a no-op for empty entries', async () => {
      const { journeyCache, set } = build();
      await journeyCache.mset([]);
      expect(set).not.toHaveBeenCalled();
    });

    it('best-effort writeback: a Redis error is swallowed (no throw)', async () => {
      const { journeyCache, cache } = build();
      (cache.set as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
      await expect(
        journeyCache.mset([{ keyword: 'a', stage: 'need_definition' }]),
      ).resolves.toBeUndefined();
    });
  });
});
