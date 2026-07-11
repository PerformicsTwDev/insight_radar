import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyAuthResolver } from './api-key-auth.resolver';
import { CompositeAuthGuard } from './composite-auth.guard';
import { HttpExceptionFilter } from './http-exception.filter';
import { SessionAuthResolver } from './session-auth.resolver';
import { createValidationPipe } from './validation.pipe';

/**
 * 跨模組共用的全域提供者：
 * - `APP_GUARD` → `CompositeAuthGuard`（FR-25；`@Public()` 放行；session 或 x-api-key 任一通過），依序委派
 *   `SessionAuthResolver`（→ `SessionService` + `PrismaService`）與 `ApiKeyAuthResolver`（→ `ConfigService`）。
 * - `APP_FILTER` → `HttpExceptionFilter`（T0.6，統一錯誤格式、不洩漏細節）。
 * - `APP_PIPE` → 全域 `ValidationPipe`（whitelist/forbidNonWhitelisted/transform）。
 *
 * 匯入 `AuthModule` 取得 `SessionService`（單向：`AuthModule` 只相依 `@Public` 這個 leaf decorator，無反向
 * 相依 `CommonModule`，故無循環）；`PrismaService`/`ConfigService` 由全域模組供給。
 */
@Module({
  imports: [AuthModule],
  providers: [
    SessionAuthResolver,
    ApiKeyAuthResolver,
    { provide: APP_GUARD, useClass: CompositeAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class CommonModule {}
