import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedRequest } from './authenticated-user';

/**
 * RED 空殼（T10.5 · TC-61）：typed not-implemented，讓測試以**斷言**紅（非編譯紅）。
 * GREEN 於後續 commit 實作 CSRF Origin 檢查。
 */

/** CSRF Origin 檢查失敗的**單一通用訊息**（403，不洩漏內部因子）。 */
export const CSRF_ORIGIN_FORBIDDEN = 'Origin not allowed';

/** RED 空殼：真正判定於 GREEN 實作。 */
export function isOriginAllowed(
  _origin: string | undefined,
  _referer: string | undefined,
  _allowedOrigins: readonly string[],
): boolean {
  return false;
}

/** 最小 request 表面：CSRF 守衛需讀 `method`（狀態變更判定）+ `headers`（Origin/Referer）+ `user`（kind）。 */
interface CsrfRequest extends AuthenticatedRequest {
  method: string;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    // RED 空殼：一律放行 → 期待 403 的斷言會紅（GREEN 實作真正檢查）。
    void this.config;
    return true;
  }
}

// RED 空殼保留型別引用（避免 unused import），GREEN 時移除。
export type { CsrfRequest };
