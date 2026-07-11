import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { parseCookies } from '../auth/cookie.util';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma';
import type { AuthenticatedRequest, AuthenticatedUser } from './authenticated-user';
import { IS_PUBLIC_KEY } from './public.decorator';
import { timingSafeEqualStr } from './timing-safe-equal';

/** API key header 名（小寫；Express header 一律小寫）。 */
export const API_KEY_HEADER = 'x-api-key';

/** 認證失敗的**單一通用訊息**（NFR-5 反枚舉：不區分「缺 session」「缺 key」「key 錯」）。 */
export const AUTHENTICATION_REQUIRED = 'Authentication required';

/**
 * 全域複合認證守衛（FR-25 / TC-60；`ApiKeyGuard` 的升級版）。
 *
 * - `@Public()` 標記的 handler/controller → 放行（`@Public` metadata key 不變，`/health`、`/auth/*` 免認證）。
 * - 其餘（**受保護資料端點**）**依序**試兩種認證，任一通過即放行並附掛 `request.user`（供 T10.6 owner 過濾）：
 *   1. **session**（AC-25.1）：讀 session cookie → `SessionService.verify`（Redis）→ 命中 userId 再取 User 投影，
 *      附 `{ id, email, kind:'session' }`（人類 actor）。session 缺/過期/撤銷/對應 User 不存在 → 視為未命中、續試 api-key。
 *   2. **x-api-key**（AC-25.2）：常數時間比對 `x-api-key` 與 `app.apiKey`，附 `{ kind:'apiKey' }`（機器 actor，
 *      **行為與 M9 前完全相容**）。
 * - 兩者皆無/皆無效（AC-25.3）→ `401`，**單一通用訊息**（不洩漏是哪個因子失敗、亦不枚舉，NFR-5）。
 */
@Injectable()
export class CompositeAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const sessionUser = await this.resolveSession(request);
    if (sessionUser) {
      request.user = sessionUser;
      return true;
    }

    const apiKeyUser = this.resolveApiKey(request);
    if (apiKeyUser) {
      request.user = apiKeyUser;
      return true;
    }

    throw new UnauthorizedException(AUTHENTICATION_REQUIRED);
  }

  /**
   * session 認證：cookie → sid → Redis `verify` → User 投影（`{ id, email }`）。任一環節缺 → `null`（未命中、
   * 續試 api-key，而非拋 401——保住「任一通過即放行」語意）。cookie 僅載 opaque sid；真理在 Redis session。
   */
  private async resolveSession(request: AuthenticatedRequest): Promise<AuthenticatedUser | null> {
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
      return null; // session 有效但對應 User 不存在（truth in session，AC-24.6 同理）
    }
    return { kind: 'session', id: user.id, email: user.email };
  }

  /** x-api-key 認證：常數時間比對（避免 timing 洩漏）。缺/未設定/不符 → `null`。 */
  private resolveApiKey(request: AuthenticatedRequest): AuthenticatedUser | null {
    const provided = request.headers[API_KEY_HEADER];
    const expected = this.config.get<string>('app.apiKey');
    if (!provided || !expected || !timingSafeEqualStr(provided, expected)) {
      return null;
    }
    return { kind: 'apiKey' };
  }
}
