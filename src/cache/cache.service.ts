import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

/**
 * 寫入快取的 sentinel 信封。cache-manager v6 的 `get`/`mget` 對 **miss** 與 **已存的 `null`**
 * 都回 `null`，無法區分；故所有值一律包成 `{ v }` 寫入：miss → 取回 `null`/`undefined`（信封不存在），
 * 已快取的 `null` → 取回 `{ v: null }`（信封存在）。讀取時解封即可分辨負快取與 miss（M0-R1）。
 */
interface Envelope<T> {
  v: T;
}

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

  /** 取值；命中（含已快取的 `null`）回原值，miss 回 `undefined`。 */
  async get<T>(key: string): Promise<T | undefined> {
    const envelope = await this.cache.get<Envelope<T>>(key);
    return envelope == null ? undefined : envelope.v;
  }

  /**
   * 寫入快取；`ttlMs` 為**毫秒**（省略則不過期）。
   * `ttlMs <= 0` 視為「已過期 / 不快取」——刪除既有值且不寫入（Keyv 會把 ttl=0 當永不過期，故須自行攔截）。
   */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (ttlMs !== undefined && ttlMs <= 0) {
      await this.cache.del(key);
      return;
    }
    await this.cache.set<Envelope<T>>(key, { v: value }, ttlMs);
  }

  /** 批次取值，回傳與 `keys` 對齊的陣列（miss 為 `undefined`，已快取的 `null` 保留為 `null`）。 */
  async mget<T>(keys: string[]): Promise<(T | undefined)[]> {
    const envelopes = await this.cache.mget<Envelope<T>>(keys);
    return envelopes.map((envelope) => (envelope == null ? undefined : envelope.v));
  }

  async del(key: string): Promise<void> {
    await this.cache.del(key);
  }
}
