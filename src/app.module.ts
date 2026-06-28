import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from './cache';
import { CommonModule } from './common';
import { HealthModule } from './health';
import { configNamespaces, validationSchema } from './config';

/**
 * 應用根模組。
 *
 * M0 起逐步掛上功能模組（CacheModule/PrismaModule…）。
 * 目前：全域 ConfigModule（Joi fail-fast 驗證，T0.4）+ HealthModule（liveness placeholder，T0.1）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // 測試載入 .env.test（dummy 合法值，通過 Joi/allowlist）；其餘載入 .env。
      envFilePath: process.env.NODE_ENV === 'test' ? ['.env.test'] : ['.env'],
      load: configNamespaces,
      validationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    CommonModule,
    CacheModule,
    HealthModule,
  ],
})
export class AppModule {}
