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
});
