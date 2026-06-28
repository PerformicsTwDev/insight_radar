import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

/**
 * 快取存取封裝（T0.8）。委派給 cache-manager **v6**（Keyv-based，**非**舊 cache-manager-redis-store）。
 * 所有 TTL 一律**毫秒**（cache-manager v6 / Keyv 原生單位）。
 */
@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /** 以 `:` 串接 namespace 與片段作為 cache key（如 `metrics:cid:hash`）。 */
  buildKey(namespace: string, ...parts: (string | number)[]): string {
    return [namespace, ...parts].join(':');
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.cache.get<T>(key)) ?? undefined;
  }

  /** 寫入快取；`ttlMs` 為**毫秒**（省略則不過期）。 */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.cache.set(key, value, ttlMs);
  }

  /** 批次取值，回傳與 `keys` 對齊的陣列（未命中為 `undefined`）。 */
  async mget<T>(keys: string[]): Promise<(T | undefined)[]> {
    const values = await this.cache.mget<T>(keys);
    return values.map((value) => value ?? undefined);
  }

  async del(key: string): Promise<void> {
    await this.cache.del(key);
  }
}
