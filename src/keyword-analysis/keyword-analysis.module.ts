import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { cacheConfig } from '../config/cache.config';
import { queueConfig } from '../config/queue.config';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { MetricsCache } from '../google-ads/metrics-cache';
import { IntentModule } from '../intent/intent.module';
import { JobEventsModule } from '../queue/job-events.module';
import { QueueModule } from '../queue/queue.module';
import { KeywordAnalysisController } from './keyword-analysis.controller';
import { KeywordAnalysisProcessor } from './keyword-analysis.processor';
import { KeywordAnalysisService } from './keyword-analysis.service';
import { ResultSnapshotService } from './result-snapshot.service';

/**
 * KeywordAnalysis 模組（T3.2/T3.3/T3.5，FR-1/12/13）。匯入 {@link QueueModule}（`keyword-analysis`
 * queue 的 `@InjectQueue` / `@Processor`）+ queue/cache config + {@link GoogleAdsModule}/{@link IntentModule}
 * （processor 編排取數/貼標）；掛 controller + service + {@link KeywordAnalysisProcessor} + {@link MetricsCache}
 * （T4.1 metrics 快取 cache-first，processor 注入）。
 *
 * CacheService、PrismaService 為全域模組（@Global），無需在此 import。
 */
@Module({
  imports: [
    QueueModule,
    JobEventsModule,
    ConfigModule.forFeature(queueConfig),
    ConfigModule.forFeature(cacheConfig),
    GoogleAdsModule,
    IntentModule,
  ],
  controllers: [KeywordAnalysisController],
  providers: [
    KeywordAnalysisService,
    KeywordAnalysisProcessor,
    ResultSnapshotService,
    MetricsCache,
  ],
  exports: [KeywordAnalysisService],
})
export class KeywordAnalysisModule {}
