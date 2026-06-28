import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

/**
 * T0.8 red stub：方法皆未實作（回固定/空值），讓 namespacing / round-trip / TTL 測試轉紅。
 * green 階段委派給注入的 cache-manager v6 `Cache`（TTL 以**毫秒**）。
 */
@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) _cache: Cache) {}

  buildKey(_namespace: string, ..._parts: (string | number)[]): string {
    return 'stub';
  }

  get<T>(_key: string): Promise<T | undefined> {
    return Promise.resolve(undefined);
  }

  set<T>(_key: string, _value: T, _ttlMs?: number): Promise<void> {
    return Promise.resolve();
  }

  mget<T>(_keys: string[]): Promise<(T | undefined)[]> {
    return Promise.resolve([]);
  }

  del(_key: string): Promise<void> {
    return Promise.resolve();
  }
}
