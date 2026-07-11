import type { PrismaService } from '../prisma';
import type { SessionService } from '../auth/session.service';
import type { AuthenticatedRequest } from './authenticated-user';
import { SessionAuthResolver } from './session-auth.resolver';

const SID = 'opaque-sid-123';
const USER = { id: 'user-uuid-1', email: 'user@example.com' };

function req(headers: Record<string, string | undefined>): AuthenticatedRequest {
  return { headers, user: undefined };
}

/**
 * TC-60（FR-25 · AC-25.1）：session 認證策略。cookie → sid → Redis `verify` → User 投影；任一環節缺 → `null`
 * （未命中、讓守衛續試 x-api-key，非拋 401）。逐分支：無 cookie / 畸形 cookie（無 sid）/ verify miss /
 * User 不存在 / 命中。
 */
describe('SessionAuthResolver (TC-60)', () => {
  let resolver: SessionAuthResolver;
  let sessions: { cookieName: string; verify: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    sessions = { cookieName: 'sid', verify: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };
    resolver = new SessionAuthResolver(
      sessions as unknown as SessionService,
      prisma as unknown as PrismaService,
    );
  });

  it('returns null and does not hit Redis when there is no cookie header', async () => {
    await expect(resolver.resolve(req({}))).resolves.toBeNull();
    expect(sessions.verify).not.toHaveBeenCalled();
  });

  it('returns null when the cookie carries no session sid (malformed / other cookies)', async () => {
    await expect(resolver.resolve(req({ cookie: 'other=1; foo=bar' }))).resolves.toBeNull();
    expect(sessions.verify).not.toHaveBeenCalled();
  });

  it('returns null (and skips the DB) when the session is expired / revoked (verify miss)', async () => {
    sessions.verify.mockResolvedValue(null);
    await expect(resolver.resolve(req({ cookie: `sid=${SID}` }))).resolves.toBeNull();
    expect(sessions.verify).toHaveBeenCalledWith(SID);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the session is valid but its User no longer exists (truth in session)', async () => {
    sessions.verify.mockResolvedValue(USER.id);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(resolver.resolve(req({ cookie: `sid=${SID}` }))).resolves.toBeNull();
  });

  it('resolves { kind:session, id, email } for a valid session (AC-25.1)', async () => {
    sessions.verify.mockResolvedValue(USER.id);
    prisma.user.findUnique.mockResolvedValue({ id: USER.id, email: USER.email });
    await expect(resolver.resolve(req({ cookie: `sid=${SID}` }))).resolves.toEqual({
      kind: 'session',
      id: USER.id,
      email: USER.email,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER.id },
      select: { id: true, email: true },
    });
  });
});
