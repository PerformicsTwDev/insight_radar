import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedRequest } from './authenticated-user';

/** CSRF Origin 檢查失敗的**單一通用訊息**（403，不洩漏內部因子）。 */
export const CSRF_ORIGIN_FORBIDDEN = 'Origin not allowed';

/** 狀態變更方法（會改變狀態、需 CSRF 保護）；其餘（GET/HEAD/OPTIONS…）為安全方法免檢查。 */
const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 從 `Origin`/`Referer` header 值取出 scheme+host+port 的 origin；缺或不可解析 → `null`。 */
function toOrigin(headerValue: string | undefined): string | null {
  if (!headerValue || !URL.canParse(headerValue)) {
    return null;
  }
  return new URL(headerValue).origin;
}

/**
 * 純判定（AC-26.1）：request 的來源 origin 是否 ∈ 白名單。`Origin` 優先、缺時才 fallback 到 `Referer`
 * （`Origin` 存在但不可解析/不在白名單 → false，**不** silently 退回 `Referer`；兩者皆缺 → false）。
 * 比對用 `URL(...).origin`（scheme+host+port），與 CORS 的反射式白名單同源。
 */
export function isOriginAllowed(
  origin: string | undefined,
  referer: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  const source = origin !== undefined ? toOrigin(origin) : toOrigin(referer);
  return source !== null && allowedOrigins.includes(source);
}

/** 最小 request 表面：CSRF 守衛需讀 `method`（狀態變更判定）+ `headers`（Origin/Referer）+ `user`（kind）。 */
interface CsrfRequest extends AuthenticatedRequest {
  method: string;
}

/**
 * CSRF Origin 檢查守衛（FR-26 / AC-26.1~26.4；`SameSite=Lax` 之上的第二層）。
 *
 * 全域 `APP_GUARD`，**登記於 `CompositeAuthGuard` 之後**——故執行時 `request.user` 已被填好（session→
 * `{ kind:'session', ... }`、x-api-key→`{ kind:'apiKey' }`、`@Public`/未認證→`undefined`）。
 *
 * **僅在**「狀態變更（`POST/PUT/PATCH/DELETE`）**且** cookie-borne（`kind:'session'`）認證」時檢查
 * `Origin`（缺則 `Referer` fallback）∈ `ALLOWED_ORIGINS`——不在/皆缺 → `403`（單一通用訊息）。
 *
 * **免檢查**（放行）：安全方法（`GET/HEAD/OPTIONS`…，AC-26.4）；`x-api-key` 機器 actor（瀏覽器不會自動
 * 附 header，無 CSRF 面，AC-26.3）；`@Public`/未帶身分（無 `request.user`——登入/註冊在 session 設立之前，
 * 且 `SameSite=Lax` 已護 cookie，不對公開路由 403）。
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CsrfRequest>();

    // AC-26.4：安全方法（非狀態變更）不改變狀態 → 免檢查。
    if (!STATE_CHANGING_METHODS.has(request.method)) {
      return true;
    }
    // AC-26.3：CSRF 僅針對 cookie-borne（session）認證；x-api-key（機器 actor）與 @Public/未帶身分免檢查。
    if (request.user?.kind !== 'session') {
      return true;
    }
    // AC-26.1：Origin/Referer ∈ ALLOWED_ORIGINS（與 CORS 同一反射式白名單，取自 app config）才放行。
    const allowedOrigins = this.config.get<string[]>('app.allowedOrigins') ?? [];
    if (isOriginAllowed(request.headers.origin, request.headers.referer, allowedOrigins)) {
      return true;
    }
    throw new ForbiddenException(CSRF_ORIGIN_FORBIDDEN);
  }
}
