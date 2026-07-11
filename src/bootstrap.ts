import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { registerSecretValues } from './logger/redaction';

/** 對外前綴；可由 `API_PREFIX` 覆寫（NFR-10）。 */
export const DEFAULT_API_PREFIX = 'api/v1';

/** 解析對外前綴（`API_PREFIX` 覆寫，否則預設）；`configureApp` 與 OpenAPI 產出共用，確保 paths 一致。 */
export function resolveApiPrefix(): string {
  return process.env.API_PREFIX ?? DEFAULT_API_PREFIX;
}

/**
 * 套用全域應用設定，**由 `main.ts` 與 e2e harness（`test/utils/createTestApp`）共用**，
 * 確保測試啟動與正式啟動一致、不漂移。
 *
 * 目前：全域 `/api/v1` 前綴、`/health` 排除（NFR-10）。
 * 後續在此集中擴充：APP_GUARD（T0.5）、全域 ValidationPipe（T0.6）、HttpExceptionFilter（T0.6）等。
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(resolveApiPrefix(), { exclude: ['health'] });

  const config = app.get(ConfigService);

  // NFR-14：CORS 白名單。`credentials:true` 為 M10 session cookie 預備（瀏覽器攜 cookie 的跨域請求）
  // → origin 必為反射式白名單（`cors` 依 `ALLOWED_ORIGINS` 精確比對後回填對應 origin，**不**用萬用 `*`）。
  // 空白名單 → 無 origin 命中 → 不回 `Access-Control-Allow-Origin`（等同不允許跨域，安全預設）。
  app.enableCors({
    origin: config.get<string[]>('app.allowedOrigins') ?? [],
    credentials: true,
  });

  // NFR-14：安全 header（helmet）——nosniff / frameguard / HSTS 等。可由 `HELMET_ENABLED=false` 關閉
  // （本機除錯 / 特定測試）；預設開。
  if (config.get<boolean>('app.helmetEnabled')) {
    app.use(helmet());
  }

  // NFR-14：JSON body 上限。自 express 預設 100kb 提高到 `BODY_LIMIT_MB`（exact 模式大 seeds 需要）；
  // 逾此 body-parser 拋 PayloadTooLargeError → 413（由 HttpExceptionFilter 尊重 http-errors 的 4xx status）。
  // 於 `init()` 前呼叫 → 註冊具名 `jsonParser`，Nest 的 registerParserMiddleware 因 isMiddlewareApplied 命中
  // 而略過預設 100kb parser（單一 parser、單一上限，不雙註冊）。
  (app as NestExpressApplication).useBodyParser('json', {
    limit: `${config.get<number>('app.bodyLimitMb')}mb`,
  });

  // NFR-5/TC-29：把執行期祕密**值**註冊給 redaction（value-based）——即使某祕密值不慎內嵌於自由文字（非 keyed、
  // 非連線字串、非 Bearer），任何 log/error 路徑（scrubSecrets/errSerializer/HttpExceptionFilter）皆遮蔽。
  registerSecretValues([
    config.get<string>('app.apiKey'),
    config.get<string>('googleAds.developerToken'),
    config.get<string>('googleAds.refreshToken'),
    config.get<string>('googleAds.clientSecret'),
    config.get<string>('azure.apiKey'),
    config.get<string>('embeddings.apiKey'),
    config.get<string>('serp.apiKey'),
    config.get<string>('auth.sessionSecret'),
  ]);
}
