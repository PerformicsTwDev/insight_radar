import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * 把已認證 actor（`request.user`）注入 handler 參數（FR-27 owner 過濾）。
 *
 * 只掛在受 `CompositeAuthGuard` 保護的路由——守衛先於參數解析執行，命中即填 `request.user`
 * （session→`{kind:'session',...}` / x-api-key→`{kind:'apiKey'}`），故此值非 optional。
 * 結構化取值（`getRequest<{ user }>()`）避免直接相依 express 型別（與 `CookieRequest`/`*Like` 慣例一致）。
 *
 * owner scope **只**由此 actor 推導——**永不**由請求參數（`?ownerId=` 等）覆寫（AC-27.4）。
 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
