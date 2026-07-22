import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { AiVisibilityModule } from '../ai-visibility/ai-visibility.module';
import { queueConfig } from '../config/queue.config';
import { AiSearchJobEventsModule } from '../queue/ai-search-job-events.module';
import { AI_SEARCH_QUEUE } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { SerpModule } from '../serp/serp.module';
import { AiSearchController } from './ai-search.controller';
import { AiSearchCaptureRepository } from './ai-search-capture.repository';
import { AI_SEARCH_PROCESSOR_CONFIG, AiSearchProcessor } from './ai-search.processor';
import { AI_SEARCH_RUN_CONFIG, AiSearchRunService } from './ai-search-run.service';
import { AiSearchRunRepository } from './ai-search-run.repository';
import { AI_SEARCH_SCHEMA_VERSION } from './ai-search-run.types';
import { aiVisibilitySchemaVersion } from '../ai-visibility/prompt-versions';

/**
 * AI Search 抓取模組（T14.6，FR-41/AC-41.x）。`ai-search` BullMQ queue + `AiSearchProcessor`（SerpAPI pull reserved +
 * extension push 合流 → `ai_search_captures`）+ `AiSearchRunService`/`AiSearchRunRepository`（202→GET/SSE/idempotency）
 * + `AiSearchCaptureRepository`（合流落列）+ `AiSearchController`。imports `SerpModule`（複用 `SERP_AI_PROVIDER`）、
 * `QueueModule`（BullMQ 連線）、`AiSearchJobEventsModule`（SSE `forJob`）。`PrismaService`/appConfig 為全域。
 */
@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: AI_SEARCH_QUEUE }),
    AiSearchJobEventsModule,
    SerpModule,
    // T15.5：分析 stage 需 `AiAnalysisService`（三線 pipeline + buildAiVisibility + 持久化）。
    AiVisibilityModule,
    ConfigModule.forFeature(queueConfig),
  ],
  controllers: [AiSearchController],
  providers: [
    AiSearchRunService,
    AiSearchRunRepository,
    AiSearchCaptureRepository,
    AiSearchProcessor,
    {
      provide: AI_SEARCH_RUN_CONFIG,
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        schemaVersion: AI_SEARCH_SCHEMA_VERSION,
        // 分析層版本入 idempotency key（M15-R5/#687）；同 AiVisibilityModule 的 AI_ANALYSIS_CONFIG 讀同一
        // env（AI_VISIBILITY_SCHEMA_VERSION），故 run 版本 provenance 與落列 tag 一致。
        analysisSchemaVersion: aiVisibilitySchemaVersion(),
        jobAttempts: queue.jobAttempts,
        jobBackoffMs: queue.jobBackoffMs,
        jobBackoffJitter: queue.jobBackoffJitter,
      }),
      inject: [queueConfig.KEY],
    },
    {
      provide: AI_SEARCH_PROCESSOR_CONFIG,
      useFactory: () => ({
        queueConcurrency: Number(process.env.AI_SEARCH_QUEUE_CONCURRENCY),
        // M14-R3/#579 [8]：收斂掃描有界（Joi 已驗值域，§14）。
        captureLookbackDays: Number(process.env.AI_SEARCH_CAPTURE_LOOKBACK_DAYS),
        captureScanLimit: Number(process.env.AI_SEARCH_CAPTURE_SCAN_LIMIT),
      }),
    },
  ],
})
export class AiSearchModule {}
