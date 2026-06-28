import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { timingSafeEqualStr } from './timing-safe-equal';

/** API key header 名（小寫；Express header 一律小寫）。 */
export const API_KEY_HEADER = 'x-api-key';

/**
 * 全域 API key 守衛（FR-11 / TC-12）。
 *
 * - `@Public()` 標記的 handler/controller → 放行（如 `/health`）。
 * - 其餘路由：比對 `x-api-key` 與 config `app.apiKey`（**常數時間** `timingSafeEqual`，避免 timing 洩漏）。
 * - 缺/錯/未設定 key → `401 Unauthorized`。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const provided = request.headers[API_KEY_HEADER];
    const expected = this.config.get<string>('app.apiKey');

    if (!provided || !expected || !timingSafeEqualStr(provided, expected)) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
