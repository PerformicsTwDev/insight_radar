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
  ) {}

  /** 建立 session：mint opaque sid（256-bit，base64url、不可猜）→ 存 Redis（TTL `sessionTtlMs`）→ 回 sid。 */
  async create(userId: string): Promise<string> {
    const sid = randomBytes(32).toString('base64url');
    const data: SessionData = { userId, createdAt: new Date().toISOString() };
    await this.cache.set(this.key(sid), data, this.config.sessionTtlMs);
    return sid;
  }

  /** 驗證 sid：命中回 userId，未命中/過期（Redis TTL 到期）回 null。 */
  async verify(sid: string): Promise<string | null> {
    const data = await this.cache.get<SessionData>(this.key(sid));
    return data ? data.userId : null;
  }

  /** 撤銷 session（登出）：刪 key，即時失效（撤銷是刪 key，Design §17.2）。 */
  async revoke(sid: string): Promise<void> {
    await this.cache.del(this.key(sid));
  }

  /** session cookie 名稱。 */
  get cookieName(): string {
    return this.config.cookieName;
  }

  /** Set-Cookie 選項（httpOnly + SameSite + Secure + maxAge），S6/NFR-15。 */
  cookieOptions(): SessionCookieOptions {
    return {
      httpOnly: true,
      sameSite: this.config.cookieSameSite,
      secure: this.config.cookieSecure,
      maxAge: this.config.sessionTtlMs,
      path: '/',
    };
  }

  private key(sid: string): string {
    return this.cache.buildKey(CacheNamespace.SESSION, sid);
  }
}
