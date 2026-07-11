import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import { authConfig } from '../config/auth.config';

/** Redis session 內容（`session:{sid}` → 此，TTL `SESSION_TTL_MS`；不落 DB，撤銷＝刪 key，Design §17.2）。 */
export interface SessionData {
  userId: string;
  createdAt: string; // ISO8601
}

/** Set-Cookie 選項（結構相容 express `CookieOptions`；避免直接相依 express 型別）。 */
export interface SessionCookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  maxAge: number;
  path: string;
}

/**
 * Session 服務（T10.2，FR-24/AC-24.2、NFR-15）：Redis-backed server-side session + opaque httpOnly cookie
 * （ADR-0006）。建立/驗證/撤銷；撤銷即時（刪 Redis key）。cookie flags httpOnly+SameSite+Secure（S6）。
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly cache: CacheService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {
    void this.cache;
    void this.config;
    void randomBytes;
    void CacheNamespace;
  }

  /** 建立 session：mint opaque sid → 存 Redis（TTL `sessionTtlMs`）→ 回 sid。 */
  create(_userId: string): Promise<string> {
    throw new Error('SessionService.create not implemented');
  }

  /** 驗證 sid：命中回 userId，未命中/過期回 null。 */
  verify(_sid: string): Promise<string | null> {
    throw new Error('SessionService.verify not implemented');
  }

  /** 撤銷 session（登出）：刪 key，即時失效。 */
  revoke(_sid: string): Promise<void> {
    throw new Error('SessionService.revoke not implemented');
  }

  /** session cookie 名稱。 */
  get cookieName(): string {
    throw new Error('SessionService.cookieName not implemented');
  }

  /** Set-Cookie 選項（httpOnly + SameSite + Secure + maxAge），S6/NFR-15。 */
  cookieOptions(): SessionCookieOptions {
    throw new Error('SessionService.cookieOptions not implemented');
  }
}
