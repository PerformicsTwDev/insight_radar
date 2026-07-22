import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { cacheConfig } from '../config/cache.config';
import { IntentModule } from '../intent/intent.module';
import { AI_INTENT_SUMMARY_CONFIG, AiIntentSummaryService } from './ai-intent-summary.service';

/**
 * per-keyword AI 意圖摘要模組（T12.1 service + 快取，FR-31 SERP-grounded）。imports `IntentModule`（複用
 * `AzureOpenAiService`）；`CacheService` 為全域。`AI_INTENT_SUMMARY_CONFIG` 由 cache + azure config 組裝
 * （schema 版本 + 部署名 + TTL + max tokens）。HTTP 端點（scope keyword/snapshot、409 `serp_not_captured`）為
 * T12.2——屆時於本模組加 controller。
 */
@Module({
  imports: [
    IntentModule,
    ConfigModule.forFeature(cacheConfig),
    ConfigModule.forFeature(azureConfig),
  ],
  providers: [
    AiIntentSummaryService,
    {
      provide: AI_INTENT_SUMMARY_CONFIG,
      useFactory: (
        cache: ConfigType<typeof cacheConfig>,
        azure: ConfigType<typeof azureConfig>,
      ) => ({
        schemaVersion: cache.aiSummarySchemaVersion,
        deployment: azure.deployment,
        cacheTtlMs: cache.aiSummaryTtlMs,
        maxCompletionTokens: cache.aiSummaryMaxTokens,
      }),
      inject: [cacheConfig.KEY, azureConfig.KEY],
    },
  ],
  exports: [AiIntentSummaryService],
})
export class AiIntentSummaryModule {}
