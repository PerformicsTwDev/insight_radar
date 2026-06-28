import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { queueConfig } from '../config/queue.config';
import { QueueModule } from '../queue/queue.module';
import { KeywordAnalysisController } from './keyword-analysis.controller';
import { KeywordAnalysisService } from './keyword-analysis.service';

/**
 * KeywordAnalysis 模組（T3.2/T3.3，FR-1）。匯入 {@link QueueModule}（提供 `keyword-analysis` queue 的
 * `@InjectQueue`）+ queue config namespace；提供/匯出 {@link KeywordAnalysisService}；
 * 掛 {@link KeywordAnalysisController}（POST /keyword-analyses）。
 *
 * CacheService、PrismaService 為全域模組（@Global），無需在此 import。
 */
@Module({
  imports: [QueueModule, ConfigModule.forFeature(queueConfig)],
  controllers: [KeywordAnalysisController],
  providers: [KeywordAnalysisService],
  exports: [KeywordAnalysisService],
})
export class KeywordAnalysisModule {}
