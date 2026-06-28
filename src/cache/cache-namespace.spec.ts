import { type Cache, createCache } from 'cache-manager';
import Keyv from 'keyv';
import { CacheNamespace } from './cache-namespace';
import { CacheService } from './cache.service';

describe('CacheNamespace', () => {
  it('exposes the known cache namespaces', () => {
    expect(CacheNamespace.METRICS).toBe('metrics');
    expect(CacheNamespace.INTENT).toBe('intent');
    expect(CacheNamespace.IDEMP).toBe('idemp');
  });

  it('composes with CacheService.buildKey', () => {
    const cache: Cache = createCache({ stores: [new Keyv()] });
    const service = new CacheService(cache);
    expect(service.buildKey(CacheNamespace.METRICS, 'cid', 'hash')).toBe('metrics:cid:hash');
  });
});
