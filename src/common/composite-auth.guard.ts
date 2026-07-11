import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_RESOLVERS, type AuthResolver, type AuthenticatedRequest } from './authenticated-user';
import { scrubSecrets } from '../logger/redaction';
import { IS_PUBLIC_KEY } from './public.decorator';

/** 認證失敗的**單一通用訊息**（NFR-5 反枚舉：不區分「缺 session」「缺 key」「key 錯」）。 */
export const AUTHENTICATION_REQUIRED = 'Authentication required';

/**
 * 全域複合認證守衛（FR-25 / TC-60；`ApiKeyGuard` 的升級版）。
 *
 * - `@Public()` 標記的 handler/controller → 放行（`@Public` metadata key 不變，`/health`、`/auth/*` 免認證）。
 * - 其餘（受保護資料端點）**依序**試各認證策略（session 優先、x-api-key 後備，見 {@link resolvers}）：任一命中
 *   即附掛 `request.user`（供 T10.6 owner 過濾）並放行。session→`{ id, email, kind:'session' }`（人類 actor）、
 *   x-api-key→`{ kind:'apiKey' }`（機器 actor，行為與 M9 前完全相容）。
 * - 全部落空（AC-25.3）→ `401`，**單一通用訊息**（不洩漏是哪個因子失敗、亦不枚舉，NFR-5）。
 *
 * 兩策略各抽為可組合 `AuthResolver`（session/api-key），守衛只負責「依序試 + 附掛 + 401」的編排（Task §T10.4
 * 重構重點）；新增策略＝多一個 resolver 加進 {@link resolvers}，守衛不動。
 */
@Injectable()
export class CompositeAuthGuard implements CanActivate {
  private readonly logger = new Logger(CompositeAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    /** 有序認證策略（module factory 注入：session 先、x-api-key 後）；守衛只相依 `AuthResolver` 抽象。 */
    @Inject(AUTH_RESOLVERS) private readonly resolvers: readonly AuthResolver[],
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
    for (const resolver of this.resolvers) {
      let user: Awaited<ReturnType<AuthResolver['resolve']>>;
      try {
        user = await resolver.resolve(request);
      } catch (error) {
        // 某策略內部依賴（Redis/DB）短暫故障**不得**擊穿「任一策略通過即放行」語意：記錄後視為 miss、
        // 續試下一策略——保住 AC-25.2（x-api-key 不依賴 Redis/DB，Redis 抖動時機器 actor 仍應通過，與 M9 前相容）。
        this.logger.warn(scrubSecrets(`auth resolver failed, treating as miss: ${String(error)}`));
        user = null;
      }
      if (user) {
        request.user = user;
        return true;
      }
    }

    throw new UnauthorizedException(AUTHENTICATION_REQUIRED);
  }
}
