import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

/**
 * 跨模組共用設定。目前以 `APP_GUARD` 全域註冊 `ApiKeyGuard`
 * （FR-11；`@Public()` 路由放行）。
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class CommonModule {}
