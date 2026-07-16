import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { cacheConfig } from '../config/cache.config';
import { IntentModule } from '../intent/intent.module';
import { KeywordsModule } from '../keywords/keywords.module';
import { AI_INSIGHT_CONFIG, AiInsightService } from './ai-insight.service';

/**
 * per-view AI 洞察模組（T12.3，FR-32）。**service + cache only**（HTTP 端點為 T12.4）。
 * imports `IntentModule`（複用 `AzureOpenAiService`）、`KeywordsModule`（複用 `SnapshotQueryService`：owner-scoped
 * snapshot 解析 + `/query` 聚合）；`CacheService` 為全域。`AI_INSIGHT_CONFIG` 由 cache + azure config 組裝
 * （schema 版本 + 部署名 + TTL）。
 */
@Module({
  imports: [
    IntentModule,
    KeywordsModule,
    ConfigModule.forFeature(cacheConfig),
    ConfigModule.forFeature(azureConfig),
  ],
  providers: [
    AiInsightService,
    {
      provide: AI_INSIGHT_CONFIG,
      useFactory: (
        cache: ConfigType<typeof cacheConfig>,
        azure: ConfigType<typeof azureConfig>,
      ) => ({
        schemaVersion: cache.aiInsightSchemaVersion,
        deployment: azure.deployment,
        cacheTtlMs: cache.aiInsightTtlMs,
      }),
      inject: [cacheConfig.KEY, azureConfig.KEY],
    },
  ],
  exports: [AiInsightService],
})
export class AiInsightModule {}
