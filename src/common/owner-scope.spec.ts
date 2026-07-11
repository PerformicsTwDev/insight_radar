import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user';
import { assertOwnerAccess, canAccess, ownerIdOf, ownerWhere } from './owner-scope';

/**
 * TC-62（FR-27 / NFR-15）：owner 過濾**唯一單點**的純函式契約——session 只見自己 + 共享（null）列、
 * 他人 → 拒（→ 404、不洩漏存在性）；apiKey 機器 actor 不過濾；建立時 session 歸屬 actor.id、apiKey 為 null。
 * `?ownerId=` 之類請求參數無法拓寬 scope（owner 只源自 actor）。
 */
const SESSION_A: AuthenticatedUser = { kind: 'session', id: 'user-a', email: 'a@example.com' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: 'user-b', email: 'b@example.com' };
const API_KEY: AuthenticatedUser = { kind: 'apiKey' };

describe('owner-scope canAccess (TC-62 / AC-27.3/27.5)', () => {
  it('session actor CAN access its own row (ownerId === actor.id)', () => {
    expect(canAccess({ ownerId: 'user-a' }, SESSION_A)).toBe(true);
  });

  it('session actor CANNOT access another owner row (ownerId === B)', () => {
    expect(canAccess({ ownerId: 'user-b' }, SESSION_A)).toBe(false);
  });

  it('session actor CAN access a legacy/shared null-owner row', () => {
    expect(canAccess({ ownerId: null }, SESSION_A)).toBe(true);
  });

  it('apiKey (machine) actor is NOT owner-filtered — accesses any row', () => {
    expect(canAccess({ ownerId: 'user-b' }, API_KEY)).toBe(true);
    expect(canAccess({ ownerId: null }, API_KEY)).toBe(true);
  });
});

describe('owner-scope assertOwnerAccess (TC-62 / AC-27.3/27.4 — cross-owner → 404)', () => {
  it('does NOT throw for the owner accessing its own row', () => {
    expect(() => assertOwnerAccess({ ownerId: 'user-a' }, SESSION_A, 'nope')).not.toThrow();
  });

  it('does NOT throw for a shared null-owner row', () => {
    expect(() => assertOwnerAccess({ ownerId: null }, SESSION_A, 'nope')).not.toThrow();
  });

  it('throws 404 NotFoundException (NOT 403) for cross-owner access — no existence leak', () => {
    expect(() =>
      assertOwnerAccess({ ownerId: 'user-b' }, SESSION_A, 'Analysis X not found'),
    ).toThrow(NotFoundException);
    // 訊息與「未知 id」相同 → 不可區分（不洩漏存在性）。
    try {
      assertOwnerAccess({ ownerId: 'user-b' }, SESSION_A, 'Analysis X not found');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe('Analysis X not found');
    }
  });

  it('does NOT throw for an apiKey actor accessing any row', () => {
    expect(() => assertOwnerAccess({ ownerId: 'user-b' }, API_KEY, 'nope')).not.toThrow();
  });
});

describe('owner-scope ownerWhere (TC-62 / AC-27.5 — list scope)', () => {
  it('apiKey actor → empty where ({}) — no owner filter (sees all)', () => {
    expect(ownerWhere(API_KEY)).toEqual({});
  });

  it('session actor → OR of own id + null (own + shared), never another owner', () => {
    expect(ownerWhere(SESSION_B)).toEqual({ OR: [{ ownerId: 'user-b' }, { ownerId: null }] });
  });
});

describe('owner-scope ownerIdOf (AC-27.1 — create attribution)', () => {
  it('session actor → persists ownerId = actor.id', () => {
    expect(ownerIdOf(SESSION_A)).toBe('user-a');
  });

  it('apiKey (machine) actor → persists ownerId = null (machine resource)', () => {
    expect(ownerIdOf(API_KEY)).toBeNull();
  });
});
