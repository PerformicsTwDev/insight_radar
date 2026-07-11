import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiKeyActor, AuthResolver, AuthenticatedRequest } from './authenticated-user';
import { timingSafeEqualStr } from './timing-safe-equal';

/** API key header 名（小寫；Express header 一律小寫）。 */
export const API_KEY_HEADER = 'x-api-key';

/**
 * x-api-key 認證策略（FR-25 / AC-25.2；沿用既有 `ApiKeyGuard` 的憑證檢查）：**常數時間**比對 `x-api-key`
 * 與 config `app.apiKey`（避免 timing 洩漏）。缺/未設定/不符 → `null`（機器 actor 行為與 M9 前完全相容）。
 */
@Injectable()
export class ApiKeyAuthResolver implements AuthResolver {
  constructor(private readonly config: ConfigService) {}

  resolve(request: AuthenticatedRequest): ApiKeyActor | null {
    const provided = request.headers[API_KEY_HEADER];
    const expected = this.config.get<string>('app.apiKey');
    if (!provided || !expected || !timingSafeEqualStr(provided, expected)) {
      return null;
    }
    return { kind: 'apiKey' };
  }
}
