import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from './authenticated-user';
import { CsrfGuard } from './csrf.guard';

const SESSION_ACTOR: AuthenticatedUser = {
  kind: 'session',
  id: 'user-uuid-1',
  email: 'user@example.com',
};
const API_KEY_ACTOR: AuthenticatedUser = { kind: 'apiKey' };

const ALLOWED = 'http://localhost:5173';
const FOREIGN = 'http://evil.example';

/** 建構 ExecutionContext + request（method / headers / user 可控）。 */
function makeContext(opts: {
  method: string;
  user?: AuthenticatedUser;
  origin?: string;
  referer?: string;
}): ExecutionContext {
  const headers: Record<string, string | undefined> = {};
  if (opts.origin !== undefined) {
    headers.origin = opts.origin;
  }
  if (opts.referer !== undefined) {
    headers.referer = opts.referer;
  }
  const request = { method: opts.method, headers, user: opts.user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeConfig(allowedOrigins: string[] | undefined): ConfigService {
  return {
    get: jest.fn((key: string) => (key === 'app.allowedOrigins' ? allowedOrigins : undefined)),
  } as unknown as ConfigService;
}

/**
 * TC-61（FR-26 · AC-26.1~26.4）：`CsrfGuard` 分支單元。守衛只在「狀態變更（POST/PUT/PATCH/DELETE）
 * **且** session（cookie-borne）認證」時檢查 `Origin`/`Referer` ∈ `ALLOWED_ORIGINS`——否則 403；
 * 安全方法（GET/HEAD…）、`x-api-key`（機器 actor）、無 `request.user`（@Public/未帶身分）一律免檢查。
 */
describe('CsrfGuard (TC-61)', () => {
  let guard: CsrfGuard;

  beforeEach(() => {
    guard = new CsrfGuard(makeConfig([ALLOWED]));
  });

  it('AC-26.1: session + state-change + whitelisted Origin → allow', () => {
    const ctx = makeContext({ method: 'POST', user: SESSION_ACTOR, origin: ALLOWED });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('AC-26.1: session + state-change + foreign Origin → 403', () => {
    const ctx = makeContext({ method: 'POST', user: SESSION_ACTOR, origin: FOREIGN });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AC-26.1: session + state-change + malformed Origin → 403', () => {
    const ctx = makeContext({ method: 'PUT', user: SESSION_ACTOR, origin: 'garbage' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AC-26.1: session + state-change + no Origin but whitelisted Referer → allow (referer fallback)', () => {
    const ctx = makeContext({
      method: 'PATCH',
      user: SESSION_ACTOR,
      referer: `${ALLOWED}/some/path?q=1`,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('AC-26.1: session + state-change + foreign Referer (no Origin) → 403', () => {
    const ctx = makeContext({ method: 'DELETE', user: SESSION_ACTOR, referer: `${FOREIGN}/x` });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AC-26.1: session + state-change + missing Origin and Referer → 403', () => {
    const ctx = makeContext({ method: 'POST', user: SESSION_ACTOR });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AC-26.4: session + GET + foreign Origin → allow (safe method, not state-changing)', () => {
    const ctx = makeContext({ method: 'GET', user: SESSION_ACTOR, origin: FOREIGN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('AC-26.3: apiKey + state-change + foreign Origin → allow (machine actor免 CSRF)', () => {
    const ctx = makeContext({ method: 'POST', user: API_KEY_ACTOR, origin: FOREIGN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('no request.user (@Public/unauthenticated) + state-change + foreign Origin → allow', () => {
    const ctx = makeContext({ method: 'POST', user: undefined, origin: FOREIGN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('session + state-change + whitelist unset (config undefined → empty) → 403', () => {
    const g = new CsrfGuard(makeConfig(undefined));
    const ctx = makeContext({ method: 'POST', user: SESSION_ACTOR, origin: ALLOWED });
    expect(() => g.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
