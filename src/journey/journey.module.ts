import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { cacheConfig } from '../config/cache.config';
import { queueConfig } from '../config/queue.config';
import { IntentModule } from '../intent/intent.module';
import { JourneyJobEventsModule } from '../queue/journey-job-events.module';
import { QueueModule } from '../queue/queue.module';
import { JOURNEY_QUEUE } from '../queue/queue.constants';
import { JourneyCache } from './journey-cache';
import { JourneyController } from './journey.controller';
import { JOURNEY_PROCESSOR_CONFIG, JourneyProcessor } from './journey.processor';
import { JourneyRepository } from './journey.repository';
import { JOURNEY_RUN_CONFIG, JourneyRunService } from './journey-run.service';
import { JourneyRunRepository } from './journey-run.repository';
import { JOURNEY_SERVICE_CONFIG, JourneyService } from './journey.service';

/**
 * 購買歷程分類模組（FR-33）。**T12.5**：`JourneyService.classify`（cache-first + 共用 resilientChunk 骨架）+
 * `JourneyCache`（Redis nt-keyed）+ `JourneyRepository.saveAssignments`（snapshot-scoped，AC-33.5，不覆寫
 * keyword_intents）。**T12.6**：`journey` BullMQ queue + `JourneyProcessor`（load→classify→persist）+
 * `JourneyRunService`/`JourneyRunRepository`（202→GET/SSE/idempotency，AC-33.6）+ `JourneyController`。
 * imports `IntentModule`（複用 `INTENT_LABELER` + 部署名）、`QueueModule`（BullMQ 連線）、`JourneyJobEventsModule`
 * （SSE `forJob`）；`CacheService`/`PrismaService` 為全域。`journey` view/漏斗經 view-router（KeywordsModule，免專屬端點）。
 */
@Module({
  imports: [
    IntentModule,
    QueueModule,
    BullModule.registerQueue({ name: JOURNEY_QUEUE }),
    JourneyJobEventsModule,
    ConfigModule.forFeature(cacheConfig),
    ConfigModule.forFeature(azureConfig),
    ConfigModule.forFeature(queueConfig),
  ],
  controllers: [JourneyController],
  providers: [
    JourneyService,
    JourneyCache,
    JourneyRepository,
    JourneyRunRepository,
    JourneyRunService,
    JourneyProcessor,
    {
      provide: JOURNEY_SERVICE_CONFIG,
      useFactory: (azure: ConfigType<typeof azureConfig>) => ({
        batchSize: azure.journeyLlmBatchSize,
        llmConcurrency: azure.llmConcurrency,
      }),
      inject: [azureConfig.KEY],
    },
    {
      provide: JOURNEY_RUN_CONFIG,
      useFactory: (
        cache: ConfigType<typeof cacheConfig>,
        azure: ConfigType<typeof azureConfig>,
        queue: ConfigType<typeof queueConfig>,
      ) => ({
        schemaVersion: cache.journeySchemaVersion,
        deployment: azure.deployment,
        maxKeywords: azure.journeyMaxKeywords,
        jobAttempts: queue.jobAttempts,
        jobBackoffMs: queue.jobBackoffMs,
        jobBackoffJitter: queue.jobBackoffJitter,
      }),
      inject: [cacheConfig.KEY, azureConfig.KEY, queueConfig.KEY],
    },
    {
      provide: JOURNEY_PROCESSOR_CONFIG,
      useFactory: () => ({ queueConcurrency: Number(process.env.JOURNEY_QUEUE_CONCURRENCY) }),
    },
  ],
  exports: [JourneyService, JourneyRepository],
})
export class JourneyModule {}
