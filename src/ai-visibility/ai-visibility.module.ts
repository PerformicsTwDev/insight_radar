import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { azureConfig } from '../config/azure.config';
import { IntentModule } from '../intent/intent.module';
import { PrismaModule } from '../prisma';
import { AI_ANALYSIS_CONFIG, AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisRepository } from './ai-analysis.repository';
import { BRAND_EXTRACTION_CONFIG, BrandExtractionService } from './brand-extraction.service';
import { aiVisibilitySchemaVersion } from './prompt-versions';
import { SENTIMENT_CONFIG, SentimentService } from './sentiment.service';
import { MEDIA_CLASSIFIER_CONFIG, MediaClassifierService } from './media-classifier.service';

/** 三段分析線共用的批次設定工廠（batch/concurrency 沿用既有 `LLM_BATCH_SIZE`/`LLM_CONCURRENCY`）。 */
const llmBatchConfig = (azure: ConfigType<typeof azureConfig>) => ({
  batchSize: azure.llmBatchSize,
  llmConcurrency: azure.llmConcurrency,
});

/**
 * AI 回答 LLM 分析模組（M15，FR-42）。三段分析線共用批次骨架 {@link ResilientLlmBatchService}（切批 + 全域
 * p-limit + `resilientChunk` length 拆批 / refusal fallback）：**T15.2** `BrandExtractionService`（不去重＝露出
 * 次數 + `BrandProfile.aliases` 正規化，S17）；**T15.3** `SentimentService`（褒貶各+1，S17）+ `MediaClassifierService`
 * （domain→9-enum）。imports `IntentModule`（複用 `INTENT_LABELER` + Azure 分類骨架）；batch/concurrency 沿用
 * 既有 `LLM_BATCH_SIZE`/`LLM_CONCURRENCY`（每線 env + Joi 併入 T15.7 config namespace）。
 */
@Module({
  imports: [IntentModule, PrismaModule, ConfigModule.forFeature(azureConfig)],
  providers: [
    BrandExtractionService,
    { provide: BRAND_EXTRACTION_CONFIG, useFactory: llmBatchConfig, inject: [azureConfig.KEY] },
    SentimentService,
    { provide: SENTIMENT_CONFIG, useFactory: llmBatchConfig, inject: [azureConfig.KEY] },
    MediaClassifierService,
    { provide: MEDIA_CLASSIFIER_CONFIG, useFactory: llmBatchConfig, inject: [azureConfig.KEY] },
    // T15.5 AI 分析 job 編排（captures → 三線 pipeline → buildAiVisibility → 持久化 + partial 收斂）。
    AiAnalysisService,
    AiAnalysisRepository,
    {
      provide: AI_ANALYSIS_CONFIG,
      useFactory: () => ({ schemaVersion: aiVisibilitySchemaVersion() }),
    },
  ],
  exports: [BrandExtractionService, SentimentService, MediaClassifierService, AiAnalysisService],
})
export class AiVisibilityModule {}
