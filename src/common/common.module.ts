import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import { HttpExceptionFilter } from './http-exception.filter';
import { createValidationPipe } from './validation.pipe';

/**
 * 跨模組共用的全域提供者：
 * - `APP_GUARD` → `ApiKeyGuard`（FR-11；`@Public()` 放行）。
 * - `APP_FILTER` → `HttpExceptionFilter`（T0.6，統一錯誤格式、不洩漏細節）。
 * - `APP_PIPE` → 全域 `ValidationPipe`（whitelist/forbidNonWhitelisted/transform）。
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class CommonModule {}
