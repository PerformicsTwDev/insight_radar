import type { ConfigType } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { cacheConfig } from '../config/cache.config';
import type { Keyword } from './keyword.types';
import { MetricsCache } from './metrics-cache';

const TTL_MS = 1_814_400_000; // 21 天

function keyword(text: string, overrides: Partial<Keyword> = {}): Keyword {
  return {
    text,
    normalizedText: text.toLowerCase(),
    source: 'seed',
    geo: 'geoTargetConstants/2158',
    language: 'languageConstants/1018',
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: null,
    cpcHigh: null,
    cpcLowMicros: null,
    cpcHighMicros: null,
    currencyCode: 'TWD',
    monthlyVolumes: [],
    ...overrides,
  };
}

interface SetCall {
  key: string;
  value: unknown;
  ttlMs?: number;
}

/** 以 in-memory store 模擬 CacheService（保留 buildKey 真實串接、mget 對齊、set TTL 記錄）。 */
function buildCache() {
  const store = new Map<string, unknown>();
  const setCalls: SetCall[] = [];
  const cache = {
    buildKey: (namespace: string, ...parts: (string | number)[]) => [namespace, ...parts].join(':'),
    mget: jest.fn(<T>(keys: string[]): Promise<(T | undefined)[]> =>
      Promise.resolve(keys.map((k) => (store.has(k) ? (store.get(k) as T) : undefined))),
    ),
    set: jest.fn(<T>(key: string, value: T, ttlMs?: number): Promise<void> => {
      store.set(key, value);
      setCalls.push({ key, value, ttlMs });
      return Promise.resolve();
    }),
  } as unknown as CacheService;
  const config: ConfigType<typeof cacheConfig> = {
    metricsTtlMs: TTL_MS,
    intentTtlMs: 1,
    intentSchemaVersion: 'v1',
  };
  return { service: new MetricsCache(cache, config), store, setCalls };
}

const params = { geo: 'geoTargetConstants/2158', language: 'languageConstants/1018' };

describe('MetricsCache (T4.1 / FR-10 / NFR-4)', () => {
  it('writes back each keyword under metrics:{geo}:{lang}:{normalizedText} with the configured TTL (ms)', async () => {
    const { service, setCalls } = buildCache();
    await service.mset([keyword('running shoes'), keyword('trail shoes')], params);

    expect(setCalls).toHaveLength(2);
    expect(setCalls[0].key).toBe(
      'metrics:geoTargetConstants/2158:languageConstants/1018:running shoes',
    );
    expect(setCalls.every((c) => c.ttlMs === TTL_MS)).toBe(true); // TTL 毫秒
  });

  it('writes back under each seedOrigins key so a close-variant input is cached by what was requested', async () => {
    const { service, setCalls } = buildCache();
    // Ads near-exact 聚合：canonical 'cars' 涵蓋輸入 'car' → 須快取於**輸入** key '…:car'，否則 'car' 永遠 miss。
    await service.mset([keyword('cars', { seedOrigins: ['car', 'cars'] })], params);

    const keys = setCalls.map((c) => c.key);
    expect(keys).toContain('metrics:geoTargetConstants/2158:languageConstants/1018:car');
    expect(keys).toContain('metrics:geoTargetConstants/2158:languageConstants/1018:cars');
  });

  it('a close-variant input hits on the next lookup (no perpetual miss, NFR-4)', async () => {
    const { service } = buildCache();
    await service.mset([keyword('cars', { seedOrigins: ['car'] })], params);
    const got = await service.mget(['car'], params);
    expect(got[0]?.normalizedText).toBe('cars'); // 'car' 命中、回 canonical keyword
  });

  it('mget returns hits aligned to input order, miss = undefined', async () => {
    const { service } = buildCache();
    await service.mset([keyword('running shoes')], params);

    const got = await service.mget(['running shoes', 'unseen', 'running shoes'], params);

    expect(got[0]?.normalizedText).toBe('running shoes');
    expect(got[1]).toBeUndefined(); // miss
    expect(got[2]?.normalizedText).toBe('running shoes');
  });

  it('keys by normalizedText so the dedupe key and the cache key are the same', async () => {
    const { service, store } = buildCache();
    await service.mset([keyword('running shoes')], params);
    // 同一 normalizedText（不同原字大小寫）→ 同一 cache key（命中）。
    const got = await service.mget(['running shoes'], params);
    expect(got[0]).toBeDefined();
    expect([...store.keys()]).toEqual([
      'metrics:geoTargetConstants/2158:languageConstants/1018:running shoes',
    ]);
  });

  it('separates by geo/language (different geo → different key → miss)', async () => {
    const { service } = buildCache();
    await service.mset([keyword('running shoes')], params);
    const otherGeo = { geo: 'geoTargetConstants/2840', language: 'languageConstants/1018' };
    expect((await service.mget(['running shoes'], otherGeo))[0]).toBeUndefined();
  });

  it('mget on an empty list returns an empty array without touching the cache', async () => {
    const { service } = buildCache();
    expect(await service.mget([], params)).toEqual([]);
  });

  it('msetByText keys each keyword by its OWN normalizedText, ignoring seedOrigins (T4.4 expand)', async () => {
    const { service, setCalls } = buildCache();
    // 拓展字：seedOrigins=[parent seed]（**非**指標等價輸入）。回寫須以自身 nt 為 key，不可寫到 seed 的 key。
    const expansion = keyword('trail running shoes', {
      source: 'expanded',
      seedOrigins: ['running shoes'],
    });
    await service.msetByText([expansion], params);

    const keys = setCalls.map((c) => c.key);
    // 寫在拓展字自身 key；**不**寫在 parent seed 'running shoes' 的 key（否則污染 seed 指標）。
    expect(keys).toEqual([
      'metrics:geoTargetConstants/2158:languageConstants/1018:trail running shoes',
    ]);
    expect(keys).not.toContain(
      'metrics:geoTargetConstants/2158:languageConstants/1018:running shoes',
    );
  });
});
