import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { SessionService } from '../auth/session.service';
import type { PrismaService } from '../prisma';
import type { AuthenticatedRequest } from './authenticated-user';
import { CompositeAuthGuard } from './composite-auth.guard';

const API_KEY = 'test-api-key';
const SID = 'valid-sid';
const USER = { id: 'user-uuid-1', email: 'user@example.com' };

/** 建構帶 `headers` 的 ExecutionContext + 可觀察的 request（守衛應在通過時寫回 `request.user`）。 */
function makeContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request: AuthenticatedRequest = { headers, user: undefined };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, request };
}

/**
 * TC-60（FR-25 · AC-25.1~25.4）：`CompositeAuthGuard` 單元。逐分支覆蓋——
 * `@Public` 放行；先試 session（cookie→Redis→User 投影，附 `{ id, email, kind:'session' }`）、
 * 後備 x-api-key（常數時間比對，附 `{ kind:'apiKey' }`）；兩者皆無/無效→401。
 */
describe('CompositeAuthGuard (TC-60)', () => {
  let guard: CompositeAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let sessions: { cookieName: string; verify: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let config: { get: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    sessions = { cookieName: 'sid', verify: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };
    config = { get: jest.fn().mockReturnValue(API_KEY) };
    guard = new CompositeAuthGuard(
      reflector as unknown as Reflector,
      sessions as unknown as SessionService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('bypasses @Public routes without any credential (AC-25.4)', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context, request } = makeContext({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined(); // 公開路由不附掛 actor
    expect(sessions.verify).not.toHaveBeenCalled();
  });

  it('accepts a valid session and attaches { id, email, kind:session } (AC-25.1)', async () => {
    sessions.verify.mockResolvedValue(USER.id);
    prisma.user.findUnique.mockResolvedValue({ id: USER.id, email: USER.email });
    const { context, request } = makeContext({ cookie: `sid=${SID}` });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.verify).toHaveBeenCalledWith(SID);
    expect(request.user).toEqual({ kind: 'session', id: USER.id, email: USER.email });
    expect(config.get).not.toHaveBeenCalled(); // session 命中即短路，不落 api-key 分支
  });

  it('falls back to a valid x-api-key and attaches { kind:apiKey } (AC-25.2)', async () => {
    const { context, request } = makeContext({ 'x-api-key': API_KEY });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ kind: 'apiKey' });
    expect(sessions.verify).not.toHaveBeenCalled(); // 無 cookie → 不打 session
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to x-api-key when the session cookie is invalid (verify miss)', async () => {
    sessions.verify.mockResolvedValue(null); // 過期/撤銷
    const { context, request } = makeContext({ cookie: `sid=${SID}`, 'x-api-key': API_KEY });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ kind: 'apiKey' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects (401) a valid session whose User no longer exists and no api-key (truth in session)', async () => {
    sessions.verify.mockResolvedValue(USER.id);
    prisma.user.findUnique.mockResolvedValue(null); // User 已刪
    const { context, request } = makeContext({ cookie: `sid=${SID}` });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });

  it('rejects (401) when neither a session nor a valid x-api-key is present (AC-25.3)', async () => {
    const { context, request } = makeContext({ 'x-api-key': 'wrong-key' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });

  it('rejects (401) when no api key is configured (server misconfig, no session)', async () => {
    config.get.mockReturnValue(undefined);
    const { context } = makeContext({ 'x-api-key': API_KEY });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
