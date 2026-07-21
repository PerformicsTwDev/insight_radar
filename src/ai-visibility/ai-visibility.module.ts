import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { IntentModule } from '../intent/intent.module';
import { BRAND_EXTRACTION_CONFIG, BrandExtractionService } from './brand-extraction.service';

/**
 * AI 回答 LLM 分析模組（M15，FR-42）。**T15.2**：`BrandExtractionService.extractBrands`（batch + 共用
 * `resilientChunk` 骨架 + `BrandProfile.aliases` 正規化 + 不去重＝露出次數，S17）。情緒/引用媒體服務於 **T15.3**
 * 加入本模組（共用 batch/後處理骨架）。imports `IntentModule`（複用 `INTENT_LABELER` + Azure 分類骨架）；
 * batch/concurrency 沿用既有 `LLM_BATCH_SIZE`/`LLM_CONCURRENCY`（brand-specific env + Joi 併入 T15.7 config namespace）。
 */
@Module({
  imports: [IntentModule, ConfigModule.forFeature(azureConfig)],
  providers: [
    BrandExtractionService,
    {
      provide: BRAND_EXTRACTION_CONFIG,
      useFactory: (azure: ConfigType<typeof azureConfig>) => ({
        batchSize: azure.llmBatchSize,
        llmConcurrency: azure.llmConcurrency,
      }),
      inject: [azureConfig.KEY],
    },
  ],
  exports: [BrandExtractionService],
})
export class AiVisibilityModule {}
