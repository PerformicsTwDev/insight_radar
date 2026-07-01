import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from './cache';
import { CommonModule } from './common';
import { HealthModule } from './health';
import { KeywordAnalysisModule } from './keyword-analysis';
import { KeywordsModule } from './keywords/keywords.module';
import { LoggerModule } from './logger';
import { PrismaModule } from './prisma';
import { configNamespaces, validationSchema } from './config';

/**
 * 應用根模組。全域 ConfigModule（Joi fail-fast，T0.4）+ CommonModule（ApiKeyGuard/filter/pipe，T0.5/T0.6）
 * + CacheModule（T0.8）+ PrismaModule（lazy connect，T0.9/T0.7）+ HealthModule（terminus 探 DB/Cache，T0.7）
 * + KeywordAnalysisModule（POST/GET keyword-analyses，T3.3+）。
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
    LoggerModule,
    CommonModule,
    CacheModule,
    PrismaModule,
    HealthModule,
    KeywordAnalysisModule,
    KeywordsModule,
  ],
})
export class AppModule {}
