import { createHash } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { cacheConfig } from '../config/cache.config';
import { IntentCache } from './intent-cache';

const TTL_MS = 5_184_000_000; // 60 天
const DEPLOYMENT = 'gpt-4o-mini';

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface SetCall {
  key: string;
  value: unknown;
  ttlMs?: number;
}

function buildCache(intentSchemaVersion = 'v1', store = new Map<string, unknown>()) {
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
    metricsTtlMs: 1,
    intentTtlMs: TTL_MS,
    intentSchemaVersion,
  };
  return { service: new IntentCache(cache, config, DEPLOYMENT), store, setCalls };
}

describe('IntentCache (T4.2 / FR-10 / NFR-4 / TC-13)', () => {
  it('writes back labels under intent:v{ver}:{deployment}:sha256(nt) with the intent TTL (ms)', async () => {
    const { service, setCalls } = buildCache();
    await service.mset([{ keyword: 'running shoes', labels: ['informational'] }]);

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].key).toBe(`intent:v1:${DEPLOYMENT}:${sha('running shoes')}`);
    expect(setCalls[0].ttlMs).toBe(TTL_MS);
    expect(setCalls[0].value).toEqual(['informational']);
  });

  it('mget returns cached labels aligned to input order, miss = undefined', async () => {
    const { service } = buildCache();
    await service.mset([{ keyword: 'running shoes', labels: ['informational'] }]);

    const got = await service.mget(['running shoes', 'unseen']);

    expect(got[0]).toEqual(['informational']);
    expect(got[1]).toBeUndefined();
  });

  it('keys by sha256(normalizedText) so the dedupe key and the cache key share normalizedText', async () => {
    const { service, store } = buildCache();
    await service.mset([{ keyword: 'running shoes', labels: ['x'] }]);
    expect([...store.keys()]).toEqual([`intent:v1:${DEPLOYMENT}:${sha('running shoes')}`]);
  });

  it('separates by deployment (namespace isolation: another deployment is a miss)', async () => {
    const { service, store } = buildCache(); // deployment = DEPLOYMENT
    await service.mset([{ keyword: 'running shoes', labels: ['x'] }]);
    // 同 nt、不同 deployment → 不同 key（schemaVer/deployment namespace 隔離 → bump 整批失效）。
    expect(store.has(`intent:v1:${DEPLOYMENT}:${sha('running shoes')}`)).toBe(true);
    expect(store.has(`intent:v1:other-deploy:${sha('running shoes')}`)).toBe(false);
  });

  it('keys by normalizeText(keyword) on writeback so a non-normalized LLM echo still hits later', async () => {
    const { service } = buildCache();
    // LLM 回 echo 帶大小寫差異 'Running Shoes'；查正規化字 'running shoes' 仍須命中（key 經 normalizeText）。
    await service.mset([{ keyword: 'Running Shoes', labels: ['informational'] }]);
    expect((await service.mget(['running shoes']))[0]).toEqual(['informational']);
  });

  it('does not cache empty labels (would otherwise become a permanent fallback hit)', async () => {
    const { service, setCalls } = buildCache();
    await service.mset([
      { keyword: 'x', labels: [] },
      { keyword: 'y', labels: ['informational'] },
    ]);
    // 只快取非空標籤的 'y'。
    expect(setCalls.map((c) => c.key)).toEqual([`intent:v1:${DEPLOYMENT}:${sha('y')}`]);
  });

  it('mget on an empty list returns [] without touching the cache', async () => {
    const { service } = buildCache();
    expect(await service.mget([])).toEqual([]);
  });

  it('bumping intentSchemaVersion isolates the namespace: old keys miss, old results not polluted (T4.3)', async () => {
    const store = new Map<string, unknown>();
    const { service: v1 } = buildCache('v1', store);
    await v1.mset([{ keyword: 'running shoes', labels: ['informational'] }]);

    // bump v1 → v2：新版本查不到舊 key（整批失效）。
    const { service: v2 } = buildCache('v2', store);
    expect((await v2.mget(['running shoes']))[0]).toBeUndefined();
    expect(store.has(`intent:v2:${DEPLOYMENT}:${sha('running shoes')}`)).toBe(false);

    // 舊版本仍命中（舊結果隔離、不被污染）。
    expect((await v1.mget(['running shoes']))[0]).toEqual(['informational']);
  });
});
