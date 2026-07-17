import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { cacheConfig } from '../config/cache.config';
import { queueConfig } from '../config/queue.config';
import { IntentModule } from '../intent/intent.module';
import { KeywordsModule } from '../keywords/keywords.module';
import { CustomClassifyJobEventsModule } from '../queue/custom-classify-job-events.module';
import { QueueModule } from '../queue/queue.module';
import { CUSTOM_CLASSIFY_QUEUE } from '../queue/queue.constants';
import { CustomClassifyController } from './custom-classify.controller';
import { CUSTOM_CLASSIFY_CONFIG, CustomClassifyService } from './custom-classify.service';
import { CustomClassifyAssignCache } from './custom-classify-assign-cache';
import { CustomClassifyAssignController } from './custom-classify-assign.controller';
import { CustomClassifyAssignRepository } from './custom-classify-assign.repository';
import {
  CUSTOM_CLASSIFY_ASSIGN_CONFIG,
  CustomClassifyAssignService,
} from './custom-classify-assign.service';
import {
  CUSTOM_CLASSIFY_PROCESSOR_CONFIG,
  CustomClassifyAssignProcessor,
} from './custom-classify-assign.processor';
import {
  CUSTOM_CLASSIFY_RUN_CONFIG,
  CustomClassifyRunService,
} from './custom-classify-run.service';
import { CustomClassifyRunRepository } from './custom-classify-run.repository';

/**
 * 自訂分類模組（FR-34）。**T12.7 階段一**：`CustomClassifyService`（instruction + 樣本 → LLM 生標籤）+
 * `CustomClassifyController`（`POST /:id/custom-classifications`）。**T12.8 階段二**：`custom-classify` BullMQ queue
 * + `CustomClassifyAssignProcessor`（load labels+keywords→動態 enum classify→persist）+ `CustomClassifyAssignService`
 * （cache-first + resilientChunk）+ `CustomClassifyAssignCache`（Redis per-(cid,nt)）+ `CustomClassifyAssignRepository`
 * （`keyword_custom_assignments`，不覆寫 keyword_intents）+ `CustomClassifyRunService`/`CustomClassifyRunRepository`
 * （202→GET/SSE/idempotency）+ `CustomClassifyAssignController`。imports `IntentModule`（複用 `INTENT_LABELER` +
 * 部署名）、`KeywordsModule`（階段一 `SnapshotQueryService`）、`QueueModule`（BullMQ 連線）、
 * `CustomClassifyJobEventsModule`（SSE `forJob`）；`CacheService`/`PrismaService` 為全域。`custom:{cid}` view 經
 * view-router（T12.9，免專屬端點）。
 */
@Module({
  imports: [
    IntentModule,
    KeywordsModule,
    QueueModule,
    BullModule.registerQueue({ name: CUSTOM_CLASSIFY_QUEUE }),
    CustomClassifyJobEventsModule,
    ConfigModule.forFeature(azureConfig),
    ConfigModule.forFeature(cacheConfig),
    ConfigModule.forFeature(queueConfig),
  ],
  controllers: [CustomClassifyController, CustomClassifyAssignController],
  providers: [
    // 階段一（T12.7）
    CustomClassifyService,
    {
      provide: CUSTOM_CLASSIFY_CONFIG,
      useFactory: (azure: ConfigType<typeof azureConfig>) => ({
        maxLabels: azure.customClassifyMaxLabels,
      }),
      inject: [azureConfig.KEY],
    },
    // 階段二（T12.8）
    CustomClassifyAssignService,
    CustomClassifyAssignCache,
    CustomClassifyAssignRepository,
    CustomClassifyRunRepository,
    CustomClassifyRunService,
    CustomClassifyAssignProcessor,
    {
      provide: CUSTOM_CLASSIFY_ASSIGN_CONFIG,
      useFactory: (azure: ConfigType<typeof azureConfig>) => ({
        batchSize: azure.customClassifyLlmBatchSize,
        llmConcurrency: azure.llmConcurrency,
      }),
      inject: [azureConfig.KEY],
    },
    {
      provide: CUSTOM_CLASSIFY_RUN_CONFIG,
      useFactory: (
        cache: ConfigType<typeof cacheConfig>,
        azure: ConfigType<typeof azureConfig>,
        queue: ConfigType<typeof queueConfig>,
      ) => ({
        schemaVersion: cache.customClassifySchemaVersion,
        deployment: azure.deployment,
        maxKeywords: azure.customClassifyMaxKeywords,
        jobAttempts: queue.jobAttempts,
        jobBackoffMs: queue.jobBackoffMs,
        jobBackoffJitter: queue.jobBackoffJitter,
      }),
      inject: [cacheConfig.KEY, azureConfig.KEY, queueConfig.KEY],
    },
    {
      provide: CUSTOM_CLASSIFY_PROCESSOR_CONFIG,
      useFactory: () => ({
        queueConcurrency: Number(process.env.CUSTOM_CLASSIFY_QUEUE_CONCURRENCY),
      }),
    },
  ],
  exports: [CustomClassifyService, CustomClassifyAssignService],
})
export class CustomClassifyModule {}
