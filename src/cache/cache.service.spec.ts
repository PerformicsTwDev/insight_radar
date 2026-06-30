import { type Cache, createCache } from 'cache-manager';
import Keyv from 'keyv';
import { CacheService } from './cache.service';

function makeService(): CacheService {
  const cache: Cache = createCache({ stores: [new Keyv()] });
  return new CacheService(cache);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('CacheService', () => {
  it('buildKey joins namespace and parts with ":"', () => {
    const service = makeService();
    expect(service.buildKey('metrics', 'cid', 'hash')).toBe('metrics:cid:hash');
    expect(service.buildKey('intent', 42)).toBe('intent:42');
  });

  it('disconnects the cache on module destroy (NFR-9 / TC-26, no connection leak)', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const service = new CacheService({ disconnect } as unknown as Cache);
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('set then get round-trips a value', async () => {
    const service = makeService();
    await service.set('k', { a: 1 });
    expect(await service.get('k')).toEqual({ a: 1 });
  });

  it('get returns undefined for a missing key', async () => {
    const service = makeService();
    expect(await service.get('nope')).toBeUndefined();
  });

  it('mget returns values aligned to keys (undefined for misses)', async () => {
    const service = makeService();
    await service.set('a', 1);
    await service.set('c', 3);
    expect(await service.mget(['a', 'b', 'c'])).toEqual([1, undefined, 3]);
  });

  it('del removes a key', async () => {
    const service = makeService();
    await service.set('k', 'v');
    await service.del('k');
    expect(await service.get('k')).toBeUndefined();
  });

  it('interprets TTL as milliseconds (expires after the ms window)', async () => {
    const service = makeService();
    await service.set('short', 'v', 60); // 60 ms
    expect(await service.get('short')).toBe('v');
    await sleep(120);
    expect(await service.get('short')).toBeUndefined();

    await service.set('long', 'v', 10_000); // 10 s — still present
    await sleep(20);
    expect(await service.get('long')).toBe('v');
  });

  // —— M0-R1：區分「故意快取的 null」與「miss」（負快取正確性） ——
  it('distinguishes a cached null from a miss on get', async () => {
    const service = makeService();
    await service.set<number | null>('explicit-null', null);
    expect(await service.get<number | null>('explicit-null')).toBeNull();
    expect(await service.get('never-set')).toBeUndefined();
  });

  it('distinguishes a cached null from a miss on mget', async () => {
    const service = makeService();
    await service.set<number | null>('n', null);
    await service.set('v', 7);
    expect(await service.mget<number | null>(['n', 'missing', 'v'])).toEqual([null, undefined, 7]);
  });

  // —— M0-R1：ttlMs <= 0 不得「永久快取」（Keyv 視 0 為 no-expiry）——
  it('does not cache forever when ttlMs is 0 (treats <=0 as no-cache)', async () => {
    const service = makeService();
    await service.set('zero', 'v', 0);
    expect(await service.get('zero')).toBeUndefined();
    await service.set('neg', 'v', -1);
    expect(await service.get('neg')).toBeUndefined();
  });

  // —— M4-R5：clear() 清空整個快取（整合測試隔離用，避免跨測試殘留）——
  it('clear() flushes all keys (test isolation)', async () => {
    const service = makeService();
    await service.set('a', 1);
    await service.set('b', 2);
    await service.clear();
    expect(await service.mget(['a', 'b'])).toEqual([undefined, undefined]);
  });
});
