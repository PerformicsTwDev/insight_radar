import type { ConfigType } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { cacheConfig } from '../config/cache.config';
import type { PrismaService } from '../prisma';
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
  // DB canonical 替身（keywords）：findMany 依 geo/language + normalizedText∈ 過濾；記錄 upsert。
  const dbRows: KeywordRow[] = [];
  const upsert = jest.fn().mockResolvedValue({});
  const findMany = jest.fn(
    (args: { where: { geo: string; language: string; normalizedText: { in: string[] } } }) =>
      Promise.resolve(
        dbRows.filter(
          (r) =>
            r.geo === args.where.geo &&
            r.language === args.where.language &&
            args.where.normalizedText.in.includes(r.normalizedText),
        ),
      ),
  );
  const prisma = { keyword: { findMany, upsert } } as unknown as PrismaService;
  return {
    service: new MetricsCache(cache, config, prisma),
    store,
    setCalls,
    dbRows,
    findMany,
    upsert,
  };
}

/** DB `keywords` 列形狀（測試用最小子集）。 */
interface KeywordRow {
  geo: string;
  language: string;
  normalizedText: string;
  text: string;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  cpcLowMicros: bigint | null;
  cpcHighMicros: bigint | null;
  monthlyVolumes: unknown;
  currencyCode: string | null;
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

  it('upserts metrics to the DB canonical keywords by [geo,language,nt], micros as BigInt (T4.6)', async () => {
    const { service, upsert } = buildCache();
    await service.mset(
      [keyword('running shoes', { cpcLowMicros: '500000', cpcHighMicros: null })],
      params,
    );

    const arg = (upsert.mock.calls[0] as unknown[])[0] as {
      where: {
        geo_language_normalizedText: { geo: string; language: string; normalizedText: string };
      };
      create: { normalizedText: string; cpcLowMicros: bigint | null; cpcHighMicros: bigint | null };
    };
    expect(arg.where.geo_language_normalizedText).toEqual({
      geo: params.geo,
      language: params.language,
      normalizedText: 'running shoes',
    });
    expect(arg.create.normalizedText).toBe('running shoes');
    expect(arg.create.cpcLowMicros).toBe(500000n); // micros → BigInt
    expect(arg.create.cpcHighMicros).toBeNull(); // 缺值≠0
  });

  it('falls back to the DB canonical on a Redis miss, reconstructs CPC from micros, warms Redis (T4.6)', async () => {
    const { service, store, dbRows, findMany } = buildCache();
    dbRows.push({
      geo: params.geo,
      language: params.language,
      normalizedText: 'running shoes',
      text: 'running shoes',
      avgMonthlySearches: 100,
      competition: 'LOW',
      competitionIndex: 10,
      cpcLowMicros: 1_230_000n,
      cpcHighMicros: null,
      monthlyVolumes: [],
      currencyCode: 'TWD',
    });

    const got = await service.mget(['running shoes', 'unseen'], params);

    expect(findMany).toHaveBeenCalled();
    expect(got[0]?.normalizedText).toBe('running shoes');
    expect(got[0]?.cpcLow).toBe(1.23); // micros 1,230,000 ÷ 1e6
    expect(got[0]?.cpcHigh).toBeNull(); // null micros → null（缺值≠0）
    expect(got[1]).toBeUndefined(); // Redis + DB 皆 miss
    // warm Redis：回填後同字 Redis 命中。
    expect(store.has(`metrics:${params.geo}:${params.language}:running shoes`)).toBe(true);
  });
});
