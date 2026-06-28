import { Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { CacheService } from '../cache';
import { CacheHealthIndicator } from './cache-health.indicator';

/** 只需 indicator 用到的方法，避免 CacheService 泛型簽名造成 mock 型別困難。 */
interface CacheMock {
  buildKey: (namespace: string, ...parts: (string | number)[]) => string;
  set: (key: string, value: unknown, ttlMs?: number) => Promise<void>;
  get: (key: string) => Promise<unknown>;
}

const buildKey = (namespace: string, ...parts: (string | number)[]): string =>
  [namespace, ...parts].join(':');

function makeIndicator(cache: CacheMock): CacheHealthIndicator {
  return new CacheHealthIndicator(new HealthIndicatorService(), cache as unknown as CacheService);
}

describe('CacheHealthIndicator', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('reports up when the cache probe round-trips', async () => {
    const store = new Map<string, unknown>();
    const result = await makeIndicator({
      buildKey,
      set: (key, value) => {
        store.set(key, value);
        return Promise.resolve();
      },
      get: (key) => Promise.resolve(store.get(key)),
    }).isHealthy('cache');

    expect(result.cache.status).toBe('up');
  });

  it('reports down when the probe value mismatches', async () => {
    const result = await makeIndicator({
      buildKey,
      set: () => Promise.resolve(),
      get: () => Promise.resolve('wrong'),
    }).isHealthy('cache');

    expect(result.cache.status).toBe('down');
  });

  it('reports down when the cache throws', async () => {
    const result = await makeIndicator({
      buildKey,
      set: () => Promise.reject(new Error('redis down')),
      get: () => Promise.resolve(undefined),
    }).isHealthy('cache');

    expect(result.cache.status).toBe('down');
  });
});
