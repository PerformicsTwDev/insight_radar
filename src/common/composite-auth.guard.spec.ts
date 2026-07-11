import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ApiKeyAuthResolver } from './api-key-auth.resolver';
import type { ApiKeyActor, AuthenticatedRequest, SessionActor } from './authenticated-user';
import { CompositeAuthGuard } from './composite-auth.guard';
import type { SessionAuthResolver } from './session-auth.resolver';

const SESSION_ACTOR: SessionActor = {
  kind: 'session',
  id: 'user-uuid-1',
  email: 'user@example.com',
};
const API_KEY_ACTOR: ApiKeyActor = { kind: 'apiKey' };

/** 建構 ExecutionContext + 可觀察的 request（守衛應在通過時寫回 `request.user`）。 */
function makeContext(): { context: ExecutionContext; request: AuthenticatedRequest } {
  const request: AuthenticatedRequest = { headers: {}, user: undefined };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, request };
}

/**
 * TC-60（FR-25 · AC-25.1~25.4）：`CompositeAuthGuard` 編排單元。守衛只負責「`@Public` 放行 → 依序試各
 * `AuthResolver` → 命中即附掛 `request.user` 並放行 → 全落空 401」；各策略的解析細節由 resolver 專屬 spec
 * 覆蓋（session-auth.resolver.spec / api-key-auth.resolver.spec）。
 */
describe('CompositeAuthGuard (TC-60)', () => {
  let guard: CompositeAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let sessionResolver: { resolve: jest.Mock };
  let apiKeyResolver: { resolve: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    sessionResolver = { resolve: jest.fn().mockResolvedValue(null) };
    apiKeyResolver = { resolve: jest.fn().mockReturnValue(null) };
    guard = new CompositeAuthGuard(
      reflector as unknown as Reflector,
      sessionResolver as unknown as SessionAuthResolver,
      apiKeyResolver as unknown as ApiKeyAuthResolver,
    );
  });

  it('bypasses @Public routes without consulting any resolver (AC-25.4)', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context, request } = makeContext();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(sessionResolver.resolve).not.toHaveBeenCalled();
    expect(apiKeyResolver.resolve).not.toHaveBeenCalled();
  });

  it('accepts a session actor first and attaches { kind:session, id, email } (AC-25.1)', async () => {
    sessionResolver.resolve.mockResolvedValue(SESSION_ACTOR);
    const { context, request } = makeContext();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(SESSION_ACTOR);
    expect(apiKeyResolver.resolve).not.toHaveBeenCalled(); // session 命中即短路
  });

  it('falls back to the api-key actor and attaches { kind:apiKey } (AC-25.2)', async () => {
    sessionResolver.resolve.mockResolvedValue(null);
    apiKeyResolver.resolve.mockReturnValue(API_KEY_ACTOR);
    const { context, request } = makeContext();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(API_KEY_ACTOR);
    expect(sessionResolver.resolve).toHaveBeenCalledTimes(1); // 先試 session、後試 api-key
  });

  it('rejects (401) when every resolver misses (AC-25.3)', async () => {
    const { context, request } = makeContext();
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(request.user).toBeUndefined();
    expect(sessionResolver.resolve).toHaveBeenCalledTimes(1);
    expect(apiKeyResolver.resolve).toHaveBeenCalledTimes(1);
  });

  // —— 韌性（AC-25.2 相容性）：某策略內部依賴（Redis/DB）故障不得擊穿「任一通過即放行」——
  it('treats a throwing resolver as a miss and still passes via a later strategy', async () => {
    // session resolver 因 Redis 短暫故障拋錯；x-api-key 不依賴 Redis/DB，仍應通過（不 500）。
    sessionResolver.resolve.mockRejectedValue(new Error('redis down'));
    apiKeyResolver.resolve.mockReturnValue(API_KEY_ACTOR);
    const { context, request } = makeContext();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(API_KEY_ACTOR);
  });

  it('rejects with 401 (not a 500) when a resolver throws and no other strategy matches', async () => {
    sessionResolver.resolve.mockRejectedValue(new Error('redis down'));
    apiKeyResolver.resolve.mockReturnValue(null);
    const { context } = makeContext();
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
