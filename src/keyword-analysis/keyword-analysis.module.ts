import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { queueConfig } from '../config/queue.config';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { IntentModule } from '../intent/intent.module';
import { JobEventsModule } from '../queue/job-events.module';
import { QueueModule } from '../queue/queue.module';
import { KeywordAnalysisController } from './keyword-analysis.controller';
import { KeywordAnalysisProcessor } from './keyword-analysis.processor';
import { KeywordAnalysisService } from './keyword-analysis.service';

/**
 * KeywordAnalysis 模組（T3.2/T3.3/T3.5，FR-1/12/13）。匯入 {@link QueueModule}（`keyword-analysis`
 * queue 的 `@InjectQueue` / `@Processor`）+ queue config + {@link GoogleAdsModule}/{@link IntentModule}
 * （processor 編排取數/貼標）；掛 controller + service + {@link KeywordAnalysisProcessor}。
 *
 * CacheService、PrismaService 為全域模組（@Global），無需在此 import。
 */
@Module({
  imports: [
    QueueModule,
    JobEventsModule,
    ConfigModule.forFeature(queueConfig),
    GoogleAdsModule,
    IntentModule,
  ],
  controllers: [KeywordAnalysisController],
  providers: [KeywordAnalysisService, KeywordAnalysisProcessor],
  exports: [KeywordAnalysisService],
})
export class KeywordAnalysisModule {}
