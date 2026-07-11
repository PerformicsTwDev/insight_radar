import { UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CacheNamespace } from '../cache/cache-namespace';
import type { authConfig } from '../config/auth.config';
import { SessionService } from '.'; // 經 barrel 匯入（測公開入口，亦覆蓋 index re-export）

/** in-memory CacheService 替身（保留 buildKey/get/set/del + 記 set 呼叫以驗 TTL）。 */
class FakeCache {
  readonly store = new Map<string, unknown>();
  readonly setCalls: Array<{ key: string; value: unknown; ttlMs?: number }> = [];
  buildKey(namespace: string, ...parts: (string | number)[]): string {
    return [namespace, ...parts].join(':');
  }
  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.store.get(key) as T | undefined);
  }
  set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.setCalls.push({ key, value, ttlMs });
    this.store.set(key, value);
    return Promise.resolve();
  }
  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}

const CFG: ConfigType<typeof authConfig> = {
  argon2MemoryKib: 19456,
  argon2TimeCost: 2,
  argon2Parallelism: 1,
  minPasswordLen: 10,
  sessionSecret: 'x'.repeat(32),
  sessionTtlMs: 604800000,
  cookieName: 'sid',
  cookieSecure: true,
  cookieSameSite: 'lax',
};

const build = (over: Partial<typeof CFG> = {}) => {
  const cache = new FakeCache();
  const service = new SessionService(
    cache as unknown as import('../cache/cache.service').CacheService,
    { ...CFG, ...over },
  );
  return { service, cache };
};

/**
 * TC-63（FR-24/AC-24.2、NFR-15、S6）：Redis session store + cookie flags。
 * session 建立存 Redis（TTL）→ verify 回 userId；撤銷即時（verify→null）；未命中/過期→null；
 * cookie flags httpOnly + SameSite=Lax + Secure（自 config）。
 */
describe('SessionService (TC-63, FR-24/NFR-15)', () => {
  it('create stores {userId} under session:{sid} with TTL and returns an opaque sid; verify → userId', async () => {
    const { service, cache } = build();
    const sid = await service.create('user-1');

    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThanOrEqual(32); // opaque、不可猜
    const set = cache.setCalls.find((c) => c.key.startsWith(`${CacheNamespace.SESSION}:`));
    expect(set).toBeDefined();
    expect(set?.ttlMs).toBe(CFG.sessionTtlMs); // Redis TTL 套用（過期即失效）
    expect((set?.value as { userId: string }).userId).toBe('user-1');
    expect(await service.verify(sid)).toBe('user-1');
  });

  it('revoke invalidates the session immediately (verify → null)', async () => {
    const { service } = build();
    const sid = await service.create('user-2');
    await service.revoke(sid);
    expect(await service.verify(sid)).toBeNull();
  });

  it('verify returns null for an unknown / expired sid', async () => {
    const { service } = build();
    expect(await service.verify('no-such-sid')).toBeNull();
  });

  it('cookieOptions: httpOnly + SameSite=lax + Secure + maxAge=ttl (S6)', () => {
    const { service } = build();
    expect(service.cookieName).toBe('sid');
    expect(service.cookieOptions()).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: CFG.sessionTtlMs,
      path: '/',
    });
  });

  it('cookieOptions honours SESSION_COOKIE_SECURE=false (test/local http)', () => {
    const { service } = build({ cookieSecure: false });
    expect(service.cookieOptions().secure).toBe(false);
  });

  /**
   * authenticate（AC-24.6）：由 Cookie header 解出 sid → verify Redis session。憑證判定集中於 service 層
   * （與 `AuthService` 同慣例），使 controller 維持純路由。真理在 Redis：cookie 有值但 session 失效仍 → 401。
   */
  describe('authenticate(cookieHeader)', () => {
    it('有效 session cookie → { sid, userId }', async () => {
      const { service } = build();
      const sid = await service.create('user-42');
      await expect(service.authenticate(`sid=${sid}`)).resolves.toEqual({ sid, userId: 'user-42' });
    });

    it('缺 Cookie header → 401（UnauthorizedException）', async () => {
      const { service } = build();
      await expect(service.authenticate(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('header 無 sid cookie → 401', async () => {
      const { service } = build();
      await expect(service.authenticate('other=1; foo=bar')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('sid 有值但 session 已失效（撤銷/TTL 到期）→ 401（真理在 Redis，AC-24.6）', async () => {
      const { service } = build();
      const sid = await service.create('user-7');
      await service.revoke(sid);
      await expect(service.authenticate(`sid=${sid}`)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
