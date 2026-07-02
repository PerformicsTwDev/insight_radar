import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { embeddingsConfig } from '../config/embeddings.config';
import { EmbeddingCache } from './embedding-cache';

const CONFIG = { cacheTtlMs: 5184000000 } as ConfigType<typeof embeddingsConfig>;

function buildCache(cacheOverrides: Partial<Record<'mget' | 'set' | 'buildKey', jest.Mock>> = {}): {
  cache: EmbeddingCache;
  mget: jest.Mock;
  set: jest.Mock;
} {
  const buildKey =
    cacheOverrides.buildKey ?? jest.fn((ns: string, part: string) => `${ns}:${part}`);
  const mget = cacheOverrides.mget ?? jest.fn().mockResolvedValue([]);
  const set = cacheOverrides.set ?? jest.fn().mockResolvedValue(undefined);
  const cacheService = { buildKey, mget, set } as unknown as CacheService;
  return { cache: new EmbeddingCache(cacheService, CONFIG), mget, set };
}

describe('EmbeddingCache (T8.2c / TC-50)', () => {
  it('mget keys each input_hash under the embedding namespace and returns aligned values', async () => {
    const { cache, mget } = buildCache({ mget: jest.fn().mockResolvedValue([[1], undefined]) });

    const out = await cache.mget(['h1', 'h2']);

    expect(mget).toHaveBeenCalledWith(['embedding:h1', 'embedding:h2']);
    expect(out).toEqual([[1], undefined]);
  });

  it('mget returns all-undefined and warns on a cache error (best-effort, never throws)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { cache } = buildCache({ mget: jest.fn().mockRejectedValue(new Error('redis down')) });

    const out = await cache.mget(['h1', 'h2']);

    expect(out).toEqual([undefined, undefined]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('mset writes each entry with the TTL; swallows write errors (best-effort)', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const { cache } = buildCache({ set });

    await cache.mset([
      { inputHash: 'h1', vector: [1] },
      { inputHash: 'h2', vector: [2] },
    ]);

    expect(set).toHaveBeenCalledWith('embedding:h1', [1], CONFIG.cacheTtlMs);
    expect(set).toHaveBeenCalledWith('embedding:h2', [2], CONFIG.cacheTtlMs);
  });

  it('mset warns and does not throw when the cache write fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { cache } = buildCache({ set: jest.fn().mockRejectedValue(new Error('redis down')) });

    await expect(cache.mset([{ inputHash: 'h1', vector: [1] }])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('short-circuits empty mget/mset without touching the cache', async () => {
    const { cache, mget, set } = buildCache();
    expect(await cache.mget([])).toEqual([]);
    await cache.mset([]);
    expect(mget).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
