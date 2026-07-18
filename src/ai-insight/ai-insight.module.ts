import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { cacheConfig } from '../config/cache.config';
import { queryConfig } from '../config/query.config';
import { IntentModule } from '../intent/intent.module';
import { KeywordsModule } from '../keywords/keywords.module';
import { AiInsightController } from './ai-insight.controller';
import { AI_INSIGHT_CONFIG, AiInsightService } from './ai-insight.service';

/**
 * per-view AI 洞察模組（T12.3 service + T12.4 HTTP 端點，FR-32）。imports `IntentModule`（複用
 * `AzureOpenAiService`）、`KeywordsModule`（複用 `SnapshotQueryService`：owner-scoped snapshot 解析 + `/query`
 * 聚合）；`CacheService` 為全域。`AI_INSIGHT_CONFIG` 由 cache + azure config 組裝（schema 版本 + 部署名 + TTL）。
 * `AiInsightController` 為純委派 shell（狀態映射沿用既有單點；LLM 失敗→502 由 `AiInsightGenerationFilter`）。
 */
@Module({
  imports: [
    IntentModule,
    KeywordsModule,
    ConfigModule.forFeature(cacheConfig),
    ConfigModule.forFeature(azureConfig),
    ConfigModule.forFeature(queryConfig),
  ],
  controllers: [AiInsightController],
  providers: [
    AiInsightService,
    {
      provide: AI_INSIGHT_CONFIG,
      useFactory: (
        cache: ConfigType<typeof cacheConfig>,
        azure: ConfigType<typeof azureConfig>,
        query: ConfigType<typeof queryConfig>,
      ) => ({
        schemaVersion: cache.aiInsightSchemaVersion,
        deployment: azure.deployment,
        cacheTtlMs: cache.aiInsightTtlMs,
        maxRows: cache.aiInsightMaxRows,
        queryMaxPageSize: query.maxPageSize,
      }),
      inject: [cacheConfig.KEY, azureConfig.KEY, queryConfig.KEY],
    },
  ],
  exports: [AiInsightService],
})
export class AiInsightModule {}
