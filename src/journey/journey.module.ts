import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { cacheConfig } from '../config/cache.config';
import { IntentModule } from '../intent/intent.module';
import { JourneyCache } from './journey-cache';
import { JourneyRepository } from './journey.repository';
import { JOURNEY_SERVICE_CONFIG, JourneyService } from './journey.service';

/**
 * 購買歷程分類模組（T12.5 pipeline + 快取 + 持久化，FR-33）。imports `IntentModule`（複用其
 * `INTENT_LABELER` port + `AZURE_OPENAI_DEPLOYMENT`）；`CacheService`/`PrismaService` 為全域。
 * `JourneyService.classify`（cache-first + 共用 resilientChunk 骨架）；`JourneyRepository.saveAssignments`
 * 寫 snapshot-scoped `keyword_journey_assignments`（AC-33.5，不覆寫 keyword_intents）。view/漏斗/async job
 * 端點於 T12.6 掛入。`JOURNEY_SERVICE_CONFIG` 由 azure config 組裝（batch 沿用 JOURNEY_LLM_BATCH_SIZE、並發沿用 LLM_CONCURRENCY）。
 */
@Module({
  imports: [
    IntentModule,
    ConfigModule.forFeature(cacheConfig),
    ConfigModule.forFeature(azureConfig),
  ],
  providers: [
    JourneyService,
    JourneyCache,
    JourneyRepository,
    {
      provide: JOURNEY_SERVICE_CONFIG,
      useFactory: (azure: ConfigType<typeof azureConfig>) => ({
        batchSize: azure.journeyLlmBatchSize,
        llmConcurrency: azure.llmConcurrency,
      }),
      inject: [azureConfig.KEY],
    },
  ],
  exports: [JourneyService, JourneyRepository],
})
export class JourneyModule {}
