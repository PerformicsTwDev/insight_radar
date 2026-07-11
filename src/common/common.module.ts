import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { CompositeAuthGuard } from './composite-auth.guard';
import { HttpExceptionFilter } from './http-exception.filter';
import { createValidationPipe } from './validation.pipe';

/**
 * 跨模組共用的全域提供者：
 * - `APP_GUARD` → `CompositeAuthGuard`（FR-25；`@Public()` 放行；session 或 x-api-key 任一通過）。
 *   注入 `SessionService`（`AuthModule` 匯出）+ `PrismaService`（全域）+ `ConfigService`（全域）。
 * - `APP_FILTER` → `HttpExceptionFilter`（T0.6，統一錯誤格式、不洩漏細節）。
 * - `APP_PIPE` → 全域 `ValidationPipe`（whitelist/forbidNonWhitelisted/transform）。
 *
 * 匯入 `AuthModule` 取得 `SessionService`（單向：`AuthModule` 只相依 `@Public` 這個 leaf decorator，無反向
 * 相依 `CommonModule`，故無循環）。
 */
@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: CompositeAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class CommonModule {}
