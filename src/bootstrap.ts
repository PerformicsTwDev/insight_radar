import type { INestApplication } from '@nestjs/common';

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
}
