import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { registerSecretValues } from './logger/redaction';

/** 對外前綴；可由 `API_PREFIX` 覆寫（NFR-10）。 */
export const DEFAULT_API_PREFIX = 'api/v1';

/**
 * 套用全域應用設定，**由 `main.ts` 與 e2e harness（`test/utils/createTestApp`）共用**，
 * 確保測試啟動與正式啟動一致、不漂移。
 *
 * 目前：全域 `/api/v1` 前綴、`/health` 排除（NFR-10）。
 * 後續在此集中擴充：APP_GUARD（T0.5）、全域 ValidationPipe（T0.6）、HttpExceptionFilter（T0.6）等。
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(process.env.API_PREFIX ?? DEFAULT_API_PREFIX, { exclude: ['health'] });

  // NFR-5/TC-29：把執行期祕密**值**註冊給 redaction（value-based）——即使某祕密值不慎內嵌於自由文字（非 keyed、
  // 非連線字串、非 Bearer），任何 log/error 路徑（scrubSecrets/errSerializer/HttpExceptionFilter）皆遮蔽。
  const config = app.get(ConfigService);
  registerSecretValues([
    config.get<string>('app.apiKey'),
    config.get<string>('googleAds.developerToken'),
    config.get<string>('googleAds.refreshToken'),
    config.get<string>('googleAds.clientSecret'),
    config.get<string>('azure.apiKey'),
    config.get<string>('embeddings.apiKey'),
    config.get<string>('serp.apiKey'),
  ]);
}
