import { Injectable } from '@nestjs/common';
import { parseCookies } from '../auth/cookie.util';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma';
import type { AuthResolver, AuthenticatedRequest, SessionActor } from './authenticated-user';

/**
 * session 認證策略（FR-25 / AC-25.1）：cookie → opaque sid → Redis `verify` → User 投影（`{ id, email }`）。
 * 任一環節缺（無 cookie / session 過期·撤銷 / 對應 User 不存在）→ `null`（未命中、讓守衛續試 x-api-key，而非
 * 拋 401，保住「任一通過即放行」語意）。cookie 僅載 opaque sid；**真理在 Redis session**（AC-24.6 同理）。
 */
@Injectable()
export class SessionAuthResolver implements AuthResolver {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(request: AuthenticatedRequest): Promise<SessionActor | null> {
    const sid = parseCookies(request.headers.cookie)[this.sessions.cookieName];
    if (!sid) {
      return null;
    }
    const userId = await this.sessions.verify(sid);
    if (!userId) {
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      return null;
    }
    return { kind: 'session', id: user.id, email: user.email };
  }
}
